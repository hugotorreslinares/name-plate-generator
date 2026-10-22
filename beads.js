import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
    FONTS, bounds, circlePoly, download, loadFont, loadManifold, manifoldToGeometry, roundRectPoly, signedArea,
    stlBlob, textContours,
} from './common.js';

const MAX_BEADS = 12;
const LETTER_CENTER_RATIO = -0.08;
const LETTER_HEIGHT_RATIO = 0.4;
const LETTER_HOLE_RATIO = 0.3;
const MIN_WALL_MM = 0.8;
const PX_PER_MM = 6;
const TIP_LENGTH_MM = 6;
const RING = { outer: 8, inner: 6, thickness: 2.5 };
const CELL_GAP_MM = 4;

const config = {
    font: 'Montserrat',
    beadD: 16,
    beadT: 3,
    textH: 1.2,
    cordD: 4,
    tolerance: 0.3,
    tips: true,
    ring: true,
    cordColor: '#7ad9c1',
    tipColor: '#8b5cf6',
    beads: [
        { type: 'letter', label: 'A', color: '#ff5c8a' },
        { type: 'letter', label: 'B', color: '#ffb703' },
        { type: 'heart', label: '', color: '#e63946' },
        { type: 'letter', label: 'C', color: '#4cc9f0' },
        { type: 'star', label: '', color: '#ffd60a' },
    ],
};

const BEAD_TYPES = ['letter', 'heart', 'star', 'round', 'square'];

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
camera.position.set(0, 150, 150);

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

// Each entry: { name, geometry, mesh } for the current build.
let pieces = [];

// ===== Outlines =====
function heartPoly(D) {
    const pts = Array.from({ length: 96 }, (_, i) => {
        const t = (2 * Math.PI * i) / 96;
        return [16 * Math.sin(t) ** 3, 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)];
    });
    const b = bounds([pts]);
    const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    const s = D / (b.maxX - b.minX);
    return pts.map(([x, y]) => [(x - cx) * s, (y - cy) * s]);
}

function starPoly(outerR, innerR, points = 5) {
    return Array.from({ length: points * 2 }, (_, i) => {
        const a = Math.PI / 2 + (Math.PI * i) / points;
        const r = i % 2 === 0 ? outerR : innerR;
        return [r * Math.cos(a), r * Math.sin(a)];
    });
}

function beadOutline(type, D) {
    switch (type) {
        case 'heart': return heartPoly(D);
        case 'star': return starPoly(D / 2, D / 4);
        case 'square': return roundRectPoly(D / 2, D / 2, D * 0.2);
        default: return circlePoly(D / 2, 64);
    }
}

// Letter centered in the lower part of the bead so the cord hole above it stays clear.
function letterContours(font, label, D) {
    const clean = label.trim();
    if (!clean) return null;

    const contours = textContours(font, clean, D * LETTER_HEIGHT_RATIO);
    if (!contours.length) return null;

    const b = bounds(contours);
    const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    const maxW = D * 0.7;
    const sx = b.maxX - b.minX > maxW ? maxW / (b.maxX - b.minX) : 1;
    for (const c of contours) for (const pt of c) {
        pt[0] = (pt[0] - cx) * sx;
        pt[1] = -(pt[1] - cy) + D * LETTER_CENTER_RATIO;
    }
    const largest = contours.reduce((a, c) => (Math.abs(signedArea(c)) > Math.abs(signedArea(a)) ? c : a));
    if (signedArea(largest) < 0) contours.forEach(c => c.reverse());
    return contours;
}

// ===== Solids =====
function buildBead(wasm, font, bead) {
    const { beadD: D, beadT: T, textH, cordD, tolerance } = config;
    const r = cordD / 2 + tolerance;
    const holeY = bead.type === 'letter' ? D * LETTER_HOLE_RATIO : 0;
    if (D / 2 - holeY - r < MIN_WALL_MM) {
        throw new Error(`Bead diameter ${D} mm is too small for the cord; increase it.`);
    }

    const outline = beadOutline(bead.type, D);
    if (signedArea(outline) < 0) outline.reverse();
    let solid = wasm.Manifold.extrude(new wasm.CrossSection([outline]), T);

    const contours = bead.type === 'letter' ? letterContours(font, bead.label, D) : null;
    if (contours) {
        const cs = new wasm.CrossSection(contours);
        const top = wasm.Manifold.extrude(cs, textH).translate([0, 0, T]);
        cs.delete();
        const merged = solid.add(top);
        solid.delete();
        top.delete();
        solid = merged;
    }

    const holeCS = new wasm.CrossSection([circlePoly(r).map(([x, y]) => [x, y + holeY])]);
    const hole = wasm.Manifold.extrude(holeCS, T + textH + 2).translate([0, 0, -1]);
    holeCS.delete();
    const cut = solid.subtract(hole);
    solid.delete();
    hole.delete();
    return cut;
}

function buildTip(wasm) {
    const { cordD, tolerance } = config;
    const outerCS = new wasm.CrossSection([circlePoly(cordD / 2 + 1.5)]);
    const tip = wasm.Manifold.extrude(outerCS, TIP_LENGTH_MM);
    outerCS.delete();
    const holeCS = new wasm.CrossSection([circlePoly(cordD / 2 + tolerance)]);
    const hole = wasm.Manifold.extrude(holeCS, TIP_LENGTH_MM + 2).translate([0, 0, -1]);
    holeCS.delete();
    const cut = tip.subtract(hole);
    tip.delete();
    hole.delete();
    return cut;
}

function buildRing(wasm) {
    const outerCS = new wasm.CrossSection([circlePoly(RING.outer, 64)]);
    const innerCS = new wasm.CrossSection([circlePoly(RING.inner, 64)]);
    const ringCS = outerCS.subtract(innerCS);
    const ring = wasm.Manifold.extrude(ringCS, RING.thickness);
    [outerCS, innerCS, ringCS].forEach(cs => cs.delete());
    return ring;
}

function buildPieces(wasm, font) {
    if (!config.beads.length) throw new Error('Add at least one bead.');

    const list = config.beads.map((bead, i) => {
        const name = `${String(i + 1).padStart(2, '0')}_${bead.type}${bead.label ? `_${bead.label.replace(/\W/g, '')}` : ''}`;
        return { name, color: bead.color, solid: buildBead(wasm, font, bead) };
    });
    if (config.tips) {
        list.push({ name: 'tip_1', color: config.tipColor, solid: buildTip(wasm) });
        list.push({ name: 'tip_2', color: config.tipColor, solid: buildTip(wasm) });
    }
    if (config.ring) list.push({ name: 'ring', color: config.tipColor, solid: buildRing(wasm) });
    return list;
}

// ===== Regeneration (serialized) =====
function clearPieces() {
    for (const p of pieces) {
        scene.remove(p.mesh);
        p.geometry.dispose();
        p.mesh.material.dispose();
    }
    pieces = [];
}

async function regenerate() {
    const [wasm, font] = await Promise.all([loadManifold(), loadFont(config.font)]);
    const built = buildPieces(wasm, font);

    // Lay the pieces out on a flat grid so they print in one plate.
    const cell = Math.max(config.beadD, RING.outer * 2, 2 * 1.5 + config.cordD) + CELL_GAP_MM;
    const cols = Math.ceil(Math.sqrt(built.length));
    const next = built.map((piece, i) => {
        const geometry = manifoldToGeometry(piece.solid);
        piece.solid.delete();
        const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: piece.color, roughness: 0.5 }));
        mesh.position.set((i % cols - (cols - 1) / 2) * cell, 0, Math.floor(i / cols) * cell);
        return { name: piece.name, geometry, mesh };
    });

    clearPieces();
    pieces = next;
    pieces.forEach(p => scene.add(p.mesh));
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
    const mm = v => v * PX_PER_MM;
    const n = config.beads.length;
    const ringRoom = config.ring ? 20 : 4;
    const tipRoom = config.tips ? TIP_LENGTH_MM + 4 : 4;
    const height = ringRoom + n * (config.beadD + 1) + tipRoom;
    preview.width = mm(config.beadD + 16);
    preview.height = mm(height);
    const cx = preview.width / 2;
    ctx.clearRect(0, 0, preview.width, preview.height);

    let y = mm(4);
    if (config.ring) {
        ctx.strokeStyle = config.tipColor;
        ctx.lineWidth = mm(RING.thickness);
        ctx.beginPath();
        ctx.arc(cx, y + mm(RING.outer), mm(RING.outer), 0, Math.PI * 2);
        ctx.stroke();
    }
    y = mm(ringRoom);

    ctx.strokeStyle = config.cordColor;
    ctx.lineWidth = mm(config.cordD);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, y);
    ctx.lineTo(cx, mm(height - tipRoom));
    ctx.stroke();

    for (const bead of config.beads) {
        const r = mm(config.beadD / 2);
        const cy = y + r;
        ctx.fillStyle = bead.color;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        if (bead.type === 'letter' && bead.label.trim()) {
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = `${mm(config.beadD * LETTER_HEIGHT_RATIO)}px "${config.font}", sans-serif`;
            ctx.fillText(bead.label.trim(), cx, cy + mm(config.beadD * LETTER_CENTER_RATIO));
        }
        y += mm(config.beadD + 1);
    }

    if (config.tips) {
        ctx.fillStyle = config.tipColor;
        const tipH = mm(TIP_LENGTH_MM);
        const tipW = mm(config.cordD + 3);
        ctx.fillRect(cx - tipW / 2, mm(height - tipRoom), tipW, tipH);
    }
}

// ===== Stats and export =====
function renderStats() {
    const tris = pieces.reduce((n, p) => n + p.geometry.attributes.position.count / 3, 0);
    document.getElementById('statPieces').textContent = pieces.length;
    document.getElementById('statTris').textContent = tris.toLocaleString();
}

function downloadPlate() {
    if (pieces.length) download(stlBlob(pieces.map(p => p.mesh)), 'beaded_charm_plate.stl');
}

async function downloadZip() {
    if (!pieces.length) return;
    const zip = new JSZip();
    for (const p of pieces) {
        zip.file(`${p.name}.stl`, stlBlob([new THREE.Mesh(p.geometry)]));
    }
    download(await zip.generateAsync({ type: 'blob' }), 'beaded_charm_pieces.zip');
}

function showError(err) {
    console.error('[Beads]', err);
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
        const value = config[el.dataset.field];
        if (el.type === 'checkbox') el.checked = value;
        else el.value = value;
    }
    for (const el of document.querySelectorAll('[data-out]')) el.textContent = config[el.dataset.out];
}

function renderBeadRows() {
    const rows = document.getElementById('beadRows');
    rows.replaceChildren(...config.beads.map((bead, i) => {
        const type = document.createElement('select');
        type.className = 'input w-24';
        for (const t of BEAD_TYPES) type.append(new Option(t, t, false, t === bead.type));
        type.addEventListener('change', () => {
            bead.type = type.value;
            renderBeadRows();
            scheduleRegen();
        });

        const label = Object.assign(document.createElement('input'), {
            type: 'text', maxLength: 1, value: bead.label, className: 'input w-12',
        });
        label.disabled = bead.type !== 'letter';
        label.addEventListener('input', () => {
            bead.label = label.value;
            scheduleRegen();
        });

        const color = Object.assign(document.createElement('input'), { type: 'color', value: bead.color, className: 'h-8 w-10' });
        color.addEventListener('input', () => {
            bead.color = color.value;
            scheduleRegen();
        });

        const remove = Object.assign(document.createElement('button'), { type: 'button', textContent: '×', className: 'btn px-2' });
        remove.addEventListener('click', () => {
            config.beads.splice(i, 1);
            renderBeadRows();
            scheduleRegen();
        });

        const row = document.createElement('div');
        row.className = 'flex items-center gap-2';
        row.append(type, label, color, remove);
        return row;
    }));
    document.getElementById('btnAddBead').disabled = config.beads.length >= MAX_BEADS;
}

for (const el of fieldEls) {
    el.addEventListener('input', () => {
        const key = el.dataset.field;
        if (el.type === 'checkbox') config[key] = el.checked;
        else if (el.type === 'range') config[key] = Number(el.value);
        else config[key] = el.value;
        const out = document.querySelector(`[data-out="${key}"]`);
        if (out) out.textContent = config[key];
        if (key === 'font') loadFont(config.font).then(() => scheduleRegen(), showError);
        else scheduleRegen();
    });
}

document.getElementById('btnAddBead').addEventListener('click', () => {
    if (config.beads.length >= MAX_BEADS) return;
    config.beads.push({ type: 'round', label: '', color: '#ffffff' });
    renderBeadRows();
    scheduleRegen();
});
document.getElementById('btnStl').addEventListener('click', downloadPlate);
document.getElementById('btnZip').addEventListener('click', downloadZip);

populateFontSelect();
renderControls();
renderBeadRows();

// ===== Init =====
function frameCamera() {
    const box = new THREE.Box3();
    pieces.forEach(p => box.expandByObject(p.mesh));
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.z, 1);
    camera.position.set(center.x, center.y + maxDim * 0.9, center.z + maxDim * 1.1);
    controls.target.copy(center);
    controls.update();
}

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
