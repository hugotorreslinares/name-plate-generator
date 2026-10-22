import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
    FONTS, bounds, download, loadFont, loadManifold, manifoldToGeometry, signedArea, stlBlob, textContours,
} from './common.js';

const CARD = { width: 140, height: 210, thickness: 2, radius: 8, margin: 10, textH: 1 };
const PHOTO = { width: 100, height: 70, top: 12 };
const LINE_GAP_MM = 3;
const MAX_LYRIC_LINES = 3;

const song = {
    title: 'Song Title',
    artist: 'Artist',
    album: '',
    duration: '',
    lyrics: '',
    font: 'Lobster',
    baseColor: '#f5efe0',
    textColor: '#1d1d1d',
    photoWindow: true,
};
let photoImage = null;

// ===== Scene =====
const canvasArea = document.getElementById('canvasArea');
const canvas = document.getElementById('canvas');
const loading = document.getElementById('loading');
const loadingText = document.getElementById('loadingText');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0xeef1f5, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
camera.position.set(0, 200, 260);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
pmrem.dispose();

const keyLight = new THREE.DirectionalLight(0xffffff, 1.15);
keyLight.position.set(60, 120, 80);
scene.add(keyLight, new THREE.GridHelper(400, 40, 0xc4ccd8, 0xdfe4ec));

new ResizeObserver(() => {
    const w = canvasArea.clientWidth, h = canvasArea.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
}).observe(canvasArea);

renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
});

const cardMaterial = new THREE.MeshStandardMaterial({ roughness: 0.6 });
const textMaterial = new THREE.MeshStandardMaterial({ roughness: 0.5 });
const cardMesh = new THREE.Mesh(new THREE.BufferGeometry(), cardMaterial);
const textMesh = new THREE.Mesh(new THREE.BufferGeometry(), textMaterial);
scene.add(cardMesh, textMesh);

// ===== Geometry =====
function roundRectPoly(hw, hh, r, segs = 8) {
    const corners = [
        [hw - r, hh - r, 0],
        [-hw + r, hh - r, Math.PI / 2],
        [-hw + r, -hh + r, Math.PI],
        [hw - r, -hh + r, (3 * Math.PI) / 2],
    ];
    return corners.flatMap(([cx, cy, a0]) =>
        Array.from({ length: segs + 1 }, (_, i) => {
            const a = a0 + ((Math.PI / 2) * i) / segs;
            return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
        }),
    );
}

function rectPoly(cx, cy, hw, hh) {
    return [[cx - hw, cy - hh], [cx + hw, cy - hh], [cx + hw, cy + hh], [cx - hw, cy + hh]];
}

function songLines(s) {
    const lyrics = s.lyrics.split('\n').map(l => l.trim()).filter(Boolean).slice(0, MAX_LYRIC_LINES);
    return [
        { text: s.title, size: 11 },
        { text: s.artist, size: 7 },
        ...lyrics.map(text => ({ text, size: 5 })),
        { text: [s.album, s.duration].filter(Boolean).join(' · '), size: 4 },
    ].filter(line => line.text.trim());
}

// Stacks the lines from topY downward, centered on the card, shrinking any line wider than the margins.
function layoutText(font, lines, topY) {
    const maxW = CARD.width - 2 * CARD.margin;
    const bottomY = -CARD.height / 2 + CARD.margin;
    const placed = [];
    let y = topY;

    for (const { text, size } of lines) {
        const contours = textContours(font, text, size);
        if (!contours.length) continue;

        const b = bounds(contours);
        const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
        const h = b.maxY - b.minY;
        if (y - h < bottomY) break;

        const sx = b.maxX - b.minX > maxW ? maxW / (b.maxX - b.minX) : 1;
        const yc = y - h / 2;
        for (const c of contours) for (const pt of c) {
            pt[0] = (pt[0] - cx) * sx;
            pt[1] = -(pt[1] - cy) + yc;
        }
        const largest = contours.reduce((a, c) => (Math.abs(signedArea(c)) > Math.abs(signedArea(a)) ? c : a));
        if (signedArea(largest) < 0) contours.forEach(c => c.reverse());

        placed.push(...contours);
        y -= h + LINE_GAP_MM;
    }
    return placed;
}

function buildCard(wasm, font, s) {
    const hw = CARD.width / 2, hh = CARD.height / 2;
    let card = wasm.Manifold.extrude(new wasm.CrossSection([roundRectPoly(hw, hh, CARD.radius)]), CARD.thickness);

    // Photo window goes through the card; the printed photo is inserted from behind.
    const photoBottom = hh - PHOTO.top - PHOTO.height;
    if (s.photoWindow) {
        const window = wasm.Manifold.extrude(
            new wasm.CrossSection([rectPoly(0, hh - PHOTO.top - PHOTO.height / 2, PHOTO.width / 2, PHOTO.height / 2)]),
            CARD.thickness + 2,
        ).translate([0, 0, -1]);
        const cut = card.subtract(window);
        card.delete();
        window.delete();
        card = cut;
    }

    const topY = s.photoWindow ? photoBottom - 5 : hh - CARD.margin;
    const contours = layoutText(font, songLines(s), topY);
    if (!contours.length) return { card, text: null };

    const textCS = new wasm.CrossSection(contours);
    const text = wasm.Manifold.extrude(textCS, CARD.textH).translate([0, 0, CARD.thickness]);
    textCS.delete();
    return { card, text };
}

// ===== Regeneration (serialized) =====
async function regenerate() {
    const [wasm, font] = await Promise.all([loadManifold(), loadFont(song.font)]);
    const { card, text } = buildCard(wasm, font, song);

    cardMesh.geometry.dispose();
    cardMesh.geometry = manifoldToGeometry(card);
    card.delete();

    textMesh.visible = Boolean(text);
    if (text) {
        textMesh.geometry.dispose();
        textMesh.geometry = manifoldToGeometry(text);
        text.delete();
    }
    renderStats();
    draw2d();
}

let regenTimer = null;
let regenQueue = Promise.resolve();
function scheduleRegen() {
    clearTimeout(regenTimer);
    regenTimer = setTimeout(() => {
        regenQueue = regenQueue.then(regenerate).catch(showError);
    }, 250);
}

// ===== 2D preview (approximate; the STL is the reference) =====
const preview = document.getElementById('preview2d');
const ctx = preview.getContext('2d');
const PX_PER_MM = 3;

function draw2d() {
    preview.width = CARD.width * PX_PER_MM;
    preview.height = CARD.height * PX_PER_MM;
    const w = preview.width, h = preview.height;
    const mm = v => v * PX_PER_MM;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = song.baseColor;
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, mm(CARD.radius));
    ctx.fill();

    const photoTop = mm(PHOTO.top);
    if (song.photoWindow) {
        const x = (w - mm(PHOTO.width)) / 2, y = photoTop, pw = mm(PHOTO.width), ph = mm(PHOTO.height);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, pw, ph);
        ctx.clip();
        ctx.fillStyle = '#d9dde3';
        ctx.fillRect(x, y, pw, ph);
        if (photoImage) drawCover(photoImage, x, y, pw, ph);
        ctx.restore();
    }

    // yFromTop is measured in mm from the card's top edge, matching layoutText.
    let yFromTop = song.photoWindow ? PHOTO.top + PHOTO.height + 5 : CARD.margin;
    ctx.fillStyle = song.textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    for (const { text, size } of songLines(song)) {
        ctx.font = `${mm(size) * 1.1}px "${song.font}", sans-serif`;
        ctx.fillText(text, w / 2, mm(yFromTop + size * 0.8), mm(CARD.width - 2 * CARD.margin));
        yFromTop += size + LINE_GAP_MM;
    }
}

function drawCover(img, x, y, w, h) {
    const scale = Math.max(w / img.width, h / img.height);
    const dw = img.width * scale, dh = img.height * scale;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

// ===== Stats and export =====
function renderStats() {
    const meshes = [cardMesh, textMesh].filter(m => m.visible);
    const tris = meshes.reduce((n, m) => n + m.geometry.attributes.position.count / 3, 0);
    document.getElementById('statTris').textContent = tris.toLocaleString();
}

function downloadStl() {
    const meshes = [cardMesh, textMesh].filter(m => m.visible);
    if (meshes.length) download(stlBlob(meshes), `song_card_${song.title.replace(/\s+/g, '_')}.stl`);
}

function showError(err) {
    console.error('[SongCard]', err);
    loadingText.textContent = `Error: ${err.message}`;
    loading.classList.remove('hidden');
}

// ===== UI =====
const fieldEls = document.querySelectorAll('[data-field]');

function populateFontSelect() {
    const select = document.querySelector('select[data-field="font"]');
    for (const name of Object.keys(FONTS)) select.append(new Option(name, name));
}

function renderControls() {
    for (const el of fieldEls) {
        const value = song[el.dataset.field];
        if (el.type === 'checkbox') el.checked = value;
        else el.value = value;
    }
}

for (const el of fieldEls) {
    el.addEventListener('input', () => {
        const key = el.dataset.field;
        song[key] = el.type === 'checkbox' ? el.checked : el.value;
        if (key === 'font') loadFont(song.font).then(() => scheduleRegen(), showError);
        // Colors only change materials and the 2D preview; no need to rebuild the geometry.
        if (key === 'baseColor') cardMaterial.color.set(song.baseColor);
        if (key === 'textColor') textMaterial.color.set(song.textColor);
        if (key === 'baseColor' || key === 'textColor') draw2d();
        else scheduleRegen();
    });
}

document.getElementById('photoInput').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) {
        photoImage = null;
        draw2d();
        return;
    }
    const img = new Image();
    img.onload = () => {
        photoImage = img;
        draw2d();
    };
    img.src = URL.createObjectURL(file);
});

document.getElementById('btnStl').addEventListener('click', downloadStl);
document.getElementById('btnStlSidebar').addEventListener('click', downloadStl);

populateFontSelect();
renderControls();
cardMaterial.color.set(song.baseColor);
textMaterial.color.set(song.textColor);

// ===== Init =====
(async () => {
    try {
        loadingText.textContent = 'Loading 3D engine...';
        await regenerate();
        loading.classList.add('hidden');
        frameCamera();
    } catch (err) {
        showError(err);
    }
})();

function frameCamera() {
    const box = new THREE.Box3().setFromObject(cardMesh);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    camera.position.set(center.x, center.y + maxDim * 0.9, center.z + maxDim * 1.1);
    controls.target.copy(center);
    controls.update();
}
