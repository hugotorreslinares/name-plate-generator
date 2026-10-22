import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
    FONTS, bounds, download, loadFont, loadManifold, manifoldToGeometry, roundRectPoly, signedArea, stlBlob, textContours,
} from './common.js';

const CARD = { width: 140, height: 210, thickness: 2, radius: 8, margin: 10, textH: 1 };
const PHOTO = { width: 100, height: 70, top: 12 };
const BAR = { width: 120, height: 2.5, y: -CARD.height / 2 + 14 };
const LINE_GAP_MM = 3;
const MAX_LYRIC_LINES = 3;
// Text stops above the progress bar.
const TEXT_BOTTOM_Y = BAR.y + 8;

const song = {
    title: 'Song Title',
    artist: 'Artist',
    album: '',
    duration: '',
    positionSec: 0,
    lyrics: '',
    printed: [],
    touched: [],
    highlightLine: -1,
    font: 'Lobster',
    baseColor: '#f5efe0',
    accentColor: '#e0a526',
    textColor: '#1d1d1d',
    photoWindow: true,
};
let photoImage = null;

// ===== Time and lyric selection =====
function durationSeconds(s) {
    const m = /^(\d{1,3}):([0-5]\d)$/.exec(s.duration.trim());
    return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

function formatTime(sec) {
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function printedIndices(s) {
    return s.lyrics.split('\n').flatMap((text, i) => (text.trim() && s.printed[i] ? [i] : []));
}

// Lines the user has not toggled fill the free print slots in order; toggled lines keep their choice.
function syncLyricState() {
    const lines = song.lyrics.split('\n');
    const isLine = i => lines[i].trim() !== '';
    const touchedPrinted = lines.filter((_, i) => isLine(i) && song.touched[i] && song.printed[i]).length;
    let slots = MAX_LYRIC_LINES - touchedPrinted;

    lines.forEach((_, i) => {
        if (!isLine(i)) {
            song.printed[i] = false;
        } else if (!song.touched[i]) {
            song.printed[i] = slots > 0;
            if (slots > 0) slots--;
        }
    });
    song.printed.length = lines.length;
    song.touched.length = lines.length;
    if (!printedIndices(song).includes(song.highlightLine)) {
        song.highlightLine = printedIndices(song)[0] ?? -1;
    }
}

function togglePrinted(i, on) {
    song.printed[i] = on;
    song.touched[i] = true;
    if (!on && song.highlightLine === i) song.highlightLine = printedIndices(song)[0] ?? -1;
    if (on && song.highlightLine < 0) song.highlightLine = i;
    refreshLyrics();
}

function setHighlight(i) {
    song.highlightLine = i;
    refreshLyrics();
}

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

const materials = {
    card: new THREE.MeshStandardMaterial({ roughness: 0.6 }),
    text: new THREE.MeshStandardMaterial({ roughness: 0.5 }),
    accent: new THREE.MeshStandardMaterial({ roughness: 0.5 }),
};
const cardMesh = new THREE.Mesh(new THREE.BufferGeometry(), materials.card);
const textMesh = new THREE.Mesh(new THREE.BufferGeometry(), materials.text);
const accentMesh = new THREE.Mesh(new THREE.BufferGeometry(), materials.accent);
scene.add(cardMesh, textMesh, accentMesh);

// ===== Geometry =====
function rectPoly(cx, cy, hw, hh) {
    return [[cx - hw, cy - hh], [cx + hw, cy - hh], [cx + hw, cy + hh], [cx - hw, cy + hh]];
}

function songLines(s) {
    const lyrics = s.lyrics.split('\n')
        .map((text, i) => ({ text: text.trim(), i }))
        .filter(({ text, i }) => text && s.printed[i])
        .slice(0, MAX_LYRIC_LINES)
        .map(({ text, i }) => ({ text, size: 5, highlight: i === s.highlightLine }));
    return [
        { text: s.title, size: 11, highlight: false },
        { text: s.artist, size: 7, highlight: false },
        ...lyrics,
        { text: s.album, size: 4, highlight: false },
    ].filter(line => line.text.trim());
}

// Stacks the lines from topY downward, centered on the card. Highlighted lines go to a separate layer.
function layoutText(font, lines, topY) {
    const maxW = CARD.width - 2 * CARD.margin;
    const bottomY = -CARD.height / 2 + CARD.margin;
    const layers = { normal: [], accent: [] };
    let y = topY;

    for (const { text, size, highlight } of lines) {
        const contours = textContours(font, text, size);
        if (!contours.length) continue;

        const b = bounds(contours);
        const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
        const h = b.maxY - b.minY;
        if (y - h < Math.max(bottomY, TEXT_BOTTOM_Y)) break;

        const sx = b.maxX - b.minX > maxW ? maxW / (b.maxX - b.minX) : 1;
        const yc = y - h / 2;
        for (const c of contours) for (const pt of c) {
            pt[0] = (pt[0] - cx) * sx;
            pt[1] = -(pt[1] - cy) + yc;
        }
        const largest = contours.reduce((a, c) => (Math.abs(signedArea(c)) > Math.abs(signedArea(a)) ? c : a));
        if (signedArea(largest) < 0) contours.forEach(c => c.reverse());

        (highlight ? layers.accent : layers.normal).push(...contours);
        y -= h + LINE_GAP_MM;
    }
    return layers;
}

// Progress bar: the filled part is accent-colored, the remaining track is text-colored. Null when no duration.
function progressRects(s) {
    const duration = durationSeconds(s);
    if (!duration) return { track: null, fill: null };

    const fraction = Math.min(1, s.positionSec / duration);
    const left = -BAR.width / 2;
    const fillW = BAR.width * fraction;
    const fill = fillW > 0.1 ? rectPoly(left + fillW / 2, BAR.y, fillW / 2, BAR.height / 2) : null;
    const trackW = BAR.width - fillW;
    const track = trackW > 0.1 ? rectPoly(left + fillW + trackW / 2, BAR.y, trackW / 2, BAR.height / 2) : null;
    return { track, fill };
}

function extrudeContours(wasm, contours) {
    const cs = new wasm.CrossSection(contours);
    const solid = wasm.Manifold.extrude(cs, CARD.textH).translate([0, 0, CARD.thickness]);
    cs.delete();
    return solid;
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
    const { normal, accent } = layoutText(font, songLines(s), topY);
    const { track, fill } = progressRects(s);
    if (track) normal.push(track);
    if (fill) accent.push(fill);

    return {
        card,
        text: normal.length ? extrudeContours(wasm, normal) : null,
        accent: accent.length ? extrudeContours(wasm, accent) : null,
    };
}

// ===== Regeneration (serialized) =====
function setMesh(mesh, solid) {
    if (!solid) {
        mesh.visible = false;
        return;
    }
    mesh.visible = true;
    mesh.geometry.dispose();
    mesh.geometry = manifoldToGeometry(solid);
    solid.delete();
}

async function regenerate() {
    const [wasm, font] = await Promise.all([loadManifold(), loadFont(song.font)]);
    const { card, text, accent } = buildCard(wasm, font, song);
    setMesh(cardMesh, card);
    setMesh(textMesh, text);
    setMesh(accentMesh, accent);
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

    if (song.photoWindow) {
        const x = (w - mm(PHOTO.width)) / 2, y = mm(PHOTO.top), pw = mm(PHOTO.width), ph = mm(PHOTO.height);
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
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    for (const { text, size, highlight } of songLines(song)) {
        ctx.fillStyle = highlight ? song.accentColor : song.textColor;
        ctx.font = `${mm(size) * 1.1}px "${song.font}", sans-serif`;
        ctx.fillText(text, w / 2, mm(yFromTop + size * 0.8), mm(CARD.width - 2 * CARD.margin));
        yFromTop += size + LINE_GAP_MM;
    }

    const { track, fill } = progressRects(song);
    const barY = mm(CARD.height / 2 - BAR.y - BAR.height / 2);
    const barLeft = w / 2 - mm(BAR.width / 2);
    if (track || fill) {
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = song.textColor;
        ctx.fillRect(barLeft, barY, mm(BAR.width), mm(BAR.height));
        ctx.globalAlpha = 1;
    }
    if (fill) {
        ctx.fillStyle = song.accentColor;
        ctx.fillRect(barLeft, barY, mm(BAR.width * (song.positionSec / durationSeconds(song))), mm(BAR.height));
    }
}

function drawCover(img, x, y, w, h) {
    const scale = Math.max(w / img.width, h / img.height);
    const dw = img.width * scale, dh = img.height * scale;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

// ===== Stats and export =====
const visibleMeshes = () => [cardMesh, textMesh, accentMesh].filter(m => m.visible);

function renderStats() {
    const tris = visibleMeshes().reduce((n, m) => n + m.geometry.attributes.position.count / 3, 0);
    document.getElementById('statTris').textContent = tris.toLocaleString();
}

function downloadStl() {
    const meshes = visibleMeshes();
    if (meshes.length) download(stlBlob(meshes), `song_card_${song.title.replace(/\s+/g, '_')}.stl`);
}

function showError(err) {
    console.error('[SongCard]', err);
    loadingText.textContent = `Error: ${err.message}`;
    loading.classList.remove('hidden');
}

// ===== UI =====
const fieldEls = document.querySelectorAll('[data-field]');
const positionSlider = document.querySelector('input[data-field="positionSec"]');

function populateFontSelect() {
    const select = document.querySelector('select[data-field="font"]');
    for (const name of Object.keys(FONTS)) select.append(new Option(name, name));
}

function renderTimeControls() {
    const duration = durationSeconds(song);
    positionSlider.max = duration;
    positionSlider.disabled = duration === 0;
    song.positionSec = Math.min(song.positionSec, duration);
    positionSlider.value = song.positionSec;
    document.getElementById('positionOut').textContent =
        duration ? `${formatTime(song.positionSec)} / ${formatTime(duration)}` : 'Set a duration to show progress';
}

function renderLyricList() {
    const list = document.getElementById('lyricList');
    const lines = song.lyrics.split('\n');
    const printedCount = printedIndices(song).length;

    list.replaceChildren(...lines.flatMap((text, i) => {
        if (!text.trim()) return [];

        const print = Object.assign(document.createElement('input'), { type: 'checkbox', checked: Boolean(song.printed[i]) });
        print.disabled = !song.printed[i] && printedCount >= MAX_LYRIC_LINES;
        print.addEventListener('change', () => togglePrinted(i, print.checked));

        const highlight = Object.assign(document.createElement('input'), { type: 'radio', name: 'highlight', checked: song.highlightLine === i });
        highlight.disabled = !song.printed[i];
        highlight.addEventListener('change', () => setHighlight(i));

        const label = document.createElement('span');
        label.className = 'truncate';
        label.textContent = text.trim();

        const row = document.createElement('div');
        row.className = 'flex items-center gap-2 text-sm';
        row.append(print, highlight, label);
        return [row];
    }));
}

function renderControls() {
    for (const el of fieldEls) {
        const value = song[el.dataset.field];
        if (el.type === 'checkbox') el.checked = value;
        else el.value = value;
    }
    renderLyricList();
    renderTimeControls();
}

function refreshLyrics() {
    renderLyricList();
    draw2d();
    scheduleRegen();
}

for (const el of fieldEls) {
    el.addEventListener('input', () => {
        const key = el.dataset.field;
        if (el.type === 'checkbox') song[key] = el.checked;
        else if (el.type === 'range') song[key] = Number(el.value);
        else song[key] = el.value;

        if (key === 'lyrics') {
            syncLyricState();
            renderLyricList();
        }
        if (key === 'duration' || key === 'positionSec') renderTimeControls();
        if (key === 'font') loadFont(song.font).then(() => scheduleRegen(), showError);
        // Colors only change materials and the 2D preview; no need to rebuild the geometry.
        if (key === 'baseColor') materials.card.color.set(song.baseColor);
        if (key === 'textColor') materials.text.color.set(song.textColor);
        if (key === 'accentColor') materials.accent.color.set(song.accentColor);
        if (key === 'baseColor' || key === 'textColor' || key === 'accentColor') draw2d();
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
syncLyricState();
renderControls();
materials.card.color.set(song.baseColor);
materials.text.color.set(song.textColor);
materials.accent.color.set(song.accentColor);

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
