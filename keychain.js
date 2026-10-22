import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
    FONTS, bounds, circlePoly, download, loadFont, loadManifold, manifoldToGeometry, roundRectPoly, signedArea,
    stlBlob, textContours,
} from './common.js';

const EDGE_MARGIN_MM = 2.5;
const LETTER_CLEARANCE_MM = 2;
const SLOT_RATIO = 1.6;
const PX_PER_MM = 6;

const charm = {
    text: 'A',
    font: 'Montserrat',
    shape: 'rounded',
    width: 30,
    height: 40,
    thickness: 3,
    textH: 1.5,
    knot: 'round',
    cordD: 4,
    tolerance: 0.3,
    cordColor: '#2b6cb0',
    baseColor: '#e8e4dc',
    textColor: '#1d1d1d',
};

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
camera.position.set(0, 120, 120);

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
    base: new THREE.MeshStandardMaterial({ roughness: 0.55 }),
    text: new THREE.MeshStandardMaterial({ roughness: 0.5 }),
};
const baseMesh = new THREE.Mesh(new THREE.BufferGeometry(), materials.base);
const textMesh = new THREE.Mesh(new THREE.BufferGeometry(), materials.text);
scene.add(baseMesh, textMesh);

// ===== Geometry =====
function ellipsePoly(rx, ry, segs = 64) {
    return circlePoly(1, segs).map(([x, y]) => [x * rx, y * ry]);
}

function outlinePoly(s) {
    const hw = s.width / 2, hh = s.height / 2;
    return s.shape === 'oval' ? ellipsePoly(hw, hh, 96) : roundRectPoly(hw, hh, Math.min(s.width, s.height) * 0.2);
}

// Eyelet for the cord, plus the vertical band left for the letters.
function holeGeometry(s) {
    const r = s.cordD / 2 + s.tolerance;
    const isSlot = s.knot === 'slot';
    const rx = isSlot ? r * SLOT_RATIO : r;
    const ry = r;
    const cy = s.height / 2 - EDGE_MARGIN_MM - ry;
    const contour = ellipsePoly(rx, ry).map(([x, y]) => [x, y + cy]);
    // Letters fill the space between the eyelet and the bottom edge.
    const textTop = cy - ry - LETTER_CLEARANCE_MM;
    const textBottom = -s.height / 2 + EDGE_MARGIN_MM;
    return { contour, cy, rx, ry, textTop, textBottom };
}

// Letters fill the space below the eyelet, scaled to fit both the height and the charm width.
function letterContours(font, s, hole) {
    if (!s.text.trim()) return null;

    const regionH = hole.textTop - hole.textBottom;
    if (regionH < 3) throw new Error('Charm is too small for this eyelet; increase Height.');

    const contours = textContours(font, s.text, regionH * 0.9);
    if (!contours.length) return null;

    const b = bounds(contours);
    const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    const midY = (hole.textTop + hole.textBottom) / 2;
    const maxW = s.width * 0.7;
    const sx = b.maxX - b.minX > maxW ? maxW / (b.maxX - b.minX) : 1;
    for (const c of contours) for (const pt of c) {
        pt[0] = (pt[0] - cx) * sx;
        pt[1] = -(pt[1] - cy) + midY;
    }
    const largest = contours.reduce((a, c) => (Math.abs(signedArea(c)) > Math.abs(signedArea(a)) ? c : a));
    if (signedArea(largest) < 0) contours.forEach(c => c.reverse());
    return contours;
}

function buildCharm(wasm, font, s) {
    const outline = outlinePoly(s);
    if (signedArea(outline) < 0) outline.reverse();
    let base = wasm.Manifold.extrude(new wasm.CrossSection([outline]), s.thickness);

    const hole = holeGeometry(s);
    const holeCS = new wasm.CrossSection([hole.contour]);
    const cutter = wasm.Manifold.extrude(holeCS, s.thickness + 2).translate([0, 0, -1]);
    const cut = base.subtract(cutter);
    holeCS.delete();
    cutter.delete();
    base.delete();
    base = cut;

    const contours = letterContours(font, s, hole);
    let text = null;
    if (contours) {
        const textCS = new wasm.CrossSection(contours);
        text = wasm.Manifold.extrude(textCS, s.textH).translate([0, 0, s.thickness]);
        textCS.delete();
    }
    return { base, text, hole };
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

let lastHole = null;

async function regenerate() {
    const [wasm, font] = await Promise.all([loadManifold(), loadFont(charm.font)]);
    const { base, text, hole } = buildCharm(wasm, font, charm);
    setMesh(baseMesh, base);
    setMesh(textMesh, text);
    lastHole = hole;
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

function draw2d() {
    const s = charm;
    // Canvas leaves room for the cord above the charm.
    const cordRoom = 30;
    preview.width = (s.width + 20) * PX_PER_MM;
    preview.height = (s.height + cordRoom + 10) * PX_PER_MM;
    const mm = v => v * PX_PER_MM;
    const ox = preview.width / 2;
    const oy = mm(cordRoom) + mm(s.height / 2) + mm(5);
    ctx.clearRect(0, 0, preview.width, preview.height);

    const holeTop = lastHole ? oy - mm(lastHole.cy) - mm(lastHole.ry) : oy - mm(s.height / 2);

    // Cord: a loop above the eyelet, drawn in the chosen color (not part of the STL).
    ctx.strokeStyle = s.cordColor;
    ctx.lineWidth = mm(s.cordD);
    ctx.lineCap = 'round';
    ctx.beginPath();
    const loopR = mm(s.width * 0.4);
    ctx.arc(ox, holeTop - loopR, loopR, Math.PI * 0.1, Math.PI * 0.9 + Math.PI, false);
    ctx.stroke();

    ctx.beginPath();
    if (s.shape === 'oval') {
        ctx.ellipse(ox, oy, mm(s.width / 2), mm(s.height / 2), 0, 0, Math.PI * 2);
    } else {
        ctx.roundRect(ox - mm(s.width / 2), oy - mm(s.height / 2), mm(s.width), mm(s.height), mm(Math.min(s.width, s.height) * 0.2));
    }
    ctx.fillStyle = s.baseColor;
    ctx.fill();

    if (lastHole) {
        ctx.beginPath();
        ctx.ellipse(ox, oy - mm(lastHole.cy), mm(lastHole.rx), mm(lastHole.ry), 0, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
    }

    if (s.text.trim() && lastHole) {
        const regionMidY = (lastHole.textTop + lastHole.textBottom) / 2;
        ctx.fillStyle = s.textColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `${mm(lastHole.textTop - lastHole.textBottom) * 0.9}px "${s.font}", sans-serif`;
        ctx.fillText(s.text, ox, oy - mm(regionMidY), mm(s.width * 0.7));
    }
}

// ===== Stats and export =====
function renderStats() {
    const meshes = [baseMesh, textMesh].filter(m => m.visible);
    const tris = meshes.reduce((n, m) => n + m.geometry.attributes.position.count / 3, 0);
    document.getElementById('statTris').textContent = tris.toLocaleString();
    if (lastHole) {
        document.getElementById('statHole').textContent = charm.knot === 'slot'
            ? `Slot ${(lastHole.rx * 2).toFixed(1)} × ${(lastHole.ry * 2).toFixed(1)} mm`
            : `Round Ø ${(lastHole.ry * 2).toFixed(1)} mm`;
    }
}

function downloadStl() {
    const meshes = [baseMesh, textMesh].filter(m => m.visible);
    if (meshes.length) download(stlBlob(meshes), `keychain_${charm.text.trim() || 'charm'}.stl`);
}

function showError(err) {
    console.error('[Keychain]', err);
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
    for (const el of fieldEls) el.value = charm[el.dataset.field];
    for (const el of document.querySelectorAll('[data-out]')) el.textContent = charm[el.dataset.out];
}

for (const el of fieldEls) {
    el.addEventListener('input', () => {
        const key = el.dataset.field;
        charm[key] = el.type === 'range' ? Number(el.value) : el.value;
        const out = document.querySelector(`[data-out="${key}"]`);
        if (out) out.textContent = charm[key];

        if (key === 'baseColor') materials.base.color.set(charm.baseColor);
        if (key === 'textColor') materials.text.color.set(charm.textColor);
        if (key === 'baseColor' || key === 'textColor' || key === 'cordColor') {
            draw2d();
            return;
        }
        if (key === 'font') loadFont(charm.font).then(() => scheduleRegen(), showError);
        else scheduleRegen();
        draw2d();
    });
}

document.getElementById('btnStl').addEventListener('click', downloadStl);
document.getElementById('btnStlSidebar').addEventListener('click', downloadStl);

populateFontSelect();
renderControls();
materials.base.color.set(charm.baseColor);
materials.text.color.set(charm.textColor);

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
    const box = new THREE.Box3().setFromObject(baseMesh);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    camera.position.set(center.x, center.y + maxDim * 0.9, center.z + maxDim * 1.6);
    controls.target.copy(center);
    controls.update();
}
