import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';

const MANIFOLD_URL = 'https://cdn.jsdelivr.net/npm/manifold-3d@2.5.1';
const BEZIER_STEPS = 16;
// Text recess depth as a share of base thickness; the text piece sits in it and rises Text Height above the base.
const RECESS_RATIO = 0.5;

const FONTS = {
    Lobster: 'https://fonts.gstatic.com/s/lobster/v32/neILzCirqoswsqX9_oU.ttf',
    Pacifico: 'https://fonts.gstatic.com/s/pacifico/v23/FwZY7-Qmy14u9lezJ96A.ttf',
    'Dancing Script': 'https://fonts.gstatic.com/s/dancingscript/v29/If2cXTr6YS-zF4S-kcSWSVi_sxjsohD9F50Ruu7B1i0HTQ.ttf',
    'Playfair Display': 'https://fonts.gstatic.com/s/playfairdisplay/v40/nuFvD-vYSZviVYUb_rj3ij__anPXJzDwcbmjWBN2PKeiukDQ.ttf',
    Montserrat: 'https://fonts.gstatic.com/s/montserrat/v31/JTUHjIg1_i6t8kCHKm4532VJOt5-QNFgpCuM70w-.ttf',
    Poppins: 'https://fonts.gstatic.com/s/poppins/v24/pxiByp8kv8JHgFVrLCz7V1s.ttf',
    Oswald: 'https://fonts.gstatic.com/s/oswald/v57/TK3_WkUHHAIjg75cFRf3bXL8LICs1xZogUE.ttf',
    Righteous: 'https://fonts.gstatic.com/s/righteous/v18/1cXxaUPXBpj2rGoU7C9mjw.ttf',
    Creepster: 'https://fonts.gstatic.com/s/creepster/v13/AlZy_zVUqJz4yMrniH4hdQ.ttf',
};

const PRESETS = {
    classic: { width: 80, height: 30, baseThk: 2.5, borderW: 3, borderH: 1.5, cornerR: 6, textH: 1.5, tolerance: 0.15, shape: 'rounded-rect', font: 'Lobster', holeLayout: 'top-center', holeD: 4, holePad: 6 },
    badge: { width: 90, height: 35, baseThk: 2, borderW: 4, borderH: 2, cornerR: 4, textH: 1.8, tolerance: 0.15, shape: 'rounded-rect', font: 'Montserrat', holeLayout: 'top-center', holeD: 4, holePad: 5 },
    slim: { width: 100, height: 22, baseThk: 2, borderW: 2, borderH: 1, cornerR: 3, textH: 1.2, tolerance: 0.15, shape: 'stadium', font: 'Poppins', holeLayout: 'left-right', holeD: 3.5, holePad: 5 },
    large: { width: 150, height: 50, baseThk: 3, borderW: 5, borderH: 2, cornerR: 10, textH: 2, tolerance: 0.15, shape: 'rounded-rect', font: 'Playfair Display', holeLayout: 'top-two', holeD: 5, holePad: 8 },
    oval: { width: 90, height: 40, baseThk: 2.5, borderW: 3.5, borderH: 1.5, cornerR: 20, textH: 1.5, tolerance: 0.15, shape: 'oval', font: 'Pacifico', holeLayout: 'top-center', holeD: 4, holePad: 8 },
};

const COLOR_PRESETS = [
    { base: '#cc2222', text: '#ffffff' },
    { base: '#1e3a5f', text: '#f0f0f0' },
    { base: '#f0f0f0', text: '#222222' },
    { base: '#10b981', text: '#ffffff' },
    { base: '#8b5cf6', text: '#fbbf24' },
    { base: '#222222', text: '#f59e0b' },
];

const params = { nameText: 'Name', phoneText: '', nfc: false, nfcD: 25, nfcUrl: '', ...PRESETS.classic };

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
camera.position.set(0, 30, 180);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

// Environment map keeps embossed text and chamfers readable; flat lights don't.
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
pmrem.dispose();

const keyLight = new THREE.DirectionalLight(0xffffff, 1.15);
keyLight.position.set(60, 120, 80);
const fillLight = new THREE.DirectionalLight(0xffffff, 0.25);
fillLight.position.set(-50, 40, -60);
scene.add(keyLight, fillLight, new THREE.GridHelper(400, 40, 0xc4ccd8, 0xdfe4ec));

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

const plateMaterials = {
    base: new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0 }),
    text: new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0 }),
};
const baseMesh = new THREE.Mesh(new THREE.BufferGeometry(), plateMaterials.base);
const textMesh = new THREE.Mesh(new THREE.BufferGeometry(), plateMaterials.text);
scene.add(baseMesh, textMesh);

// ===== Manifold (CSG) and fonts =====
let manifoldPromise;
function loadManifold() {
    manifoldPromise ??= import(`${MANIFOLD_URL}/manifold.js`).then(async ({ default: init }) => {
        const wasm = await init({ locateFile: file => `${MANIFOLD_URL}/${file}` });
        wasm.setup();
        return wasm;
    });
    return manifoldPromise;
}

const fontCache = new Map();
function loadFont(name) {
    if (!fontCache.has(name)) {
        const promise = fetch(FONTS[name])
            .then(async res => {
                if (!res.ok) throw new Error(`Font fetch failed: ${res.status}`);
                return opentype.parse(await res.arrayBuffer());
            })
            .catch(err => {
                fontCache.delete(name);
                throw err;
            });
        fontCache.set(name, promise);
    }
    return fontCache.get(name);
}

// ===== Geometry helpers =====
function shapePoly(hw, hh, cornerR, shape, segs = 32) {
    const pts = [];
    if (shape === 'oval') {
        for (let i = 0; i < segs * 2; i++) {
            const a = (2 * Math.PI * i) / (segs * 2);
            pts.push([hw * Math.cos(a), hh * Math.sin(a)]);
        }
    } else if (shape === 'stadium') {
        const r = Math.min(hw, hh);
        const sx = hw - r;
        const halfSegs = Math.max(8, Math.round(segs / 2));
        for (let i = 0; i <= halfSegs; i++) {
            const a = Math.PI / 2 + (Math.PI * i) / halfSegs;
            pts.push([-sx + r * Math.cos(a), r * Math.sin(a)]);
        }
        for (let i = 0; i <= halfSegs; i++) {
            const a = -Math.PI / 2 + (Math.PI * i) / halfSegs;
            pts.push([sx + r * Math.cos(a), r * Math.sin(a)]);
        }
    } else {
        const r = shape === 'rectangle' ? 0 : Math.min(cornerR, hw, hh);
        if (r < 0.1) return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
        const steps = Math.max(4, Math.round(segs / 4));
        const corners = [[hw - r, hh - r], [-hw + r, hh - r], [-hw + r, -hh + r], [hw - r, -hh + r]];
        const startAngles = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
        corners.forEach(([cx, cy], c) => {
            for (let i = 0; i <= steps; i++) {
                const a = startAngles[c] + ((Math.PI / 2) * i) / steps;
                pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
            }
        });
    }
    return pts;
}

function circlePoly(radius, segs = 48) {
    return Array.from({ length: segs }, (_, i) => {
        const a = (2 * Math.PI * i) / segs;
        return [radius * Math.cos(a), radius * Math.sin(a)];
    });
}

// Half-width of the outline at height y; used to fit holes and text inside the plate.
function shapeMaxXAt(hw, hh, cornerR, shape, y) {
    const ay = Math.abs(y);
    if (shape === 'oval') {
        if (ay >= hh) return 0;
        return hw * Math.sqrt(1 - (ay * ay) / (hh * hh));
    }
    const r = shape === 'stadium' ? Math.min(hw, hh) : shape === 'rectangle' ? 0 : Math.min(cornerR, hw, hh);
    if (shape !== 'stadium' && r < 0.1) return hw;
    const flat = hh - r;
    if (ay <= flat) return hw;
    const dy = ay - flat;
    if (dy >= r) return 0;
    return hw - r + Math.sqrt(r * r - dy * dy);
}

function signedArea(pts) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i];
        const [x2, y2] = pts[(i + 1) % pts.length];
        a += x1 * y2 - x2 * y1;
    }
    return a / 2;
}

function bounds(contours) {
    const pts = contours.flat();
    return {
        minX: Math.min(...pts.map(p => p[0])),
        maxX: Math.max(...pts.map(p => p[0])),
        minY: Math.min(...pts.map(p => p[1])),
        maxY: Math.max(...pts.map(p => p[1])),
    };
}

// Flattens opentype glyph outlines into closed polylines scaled to targetHeight.
function textContours(font, text, targetHeight) {
    const path = font.getPath(text, 0, 0, 200);
    const box = path.getBoundingBox();
    const height = box.y2 - box.y1;
    if (height < 0.001) return [];
    const sc = targetHeight / height;

    const contours = [];
    let cur = [];
    const close = () => {
        if (cur.length > 2) contours.push(cur);
        cur = [];
    };

    for (const cmd of path.commands) {
        switch (cmd.type) {
            case 'M':
                close();
                cur = [[cmd.x * sc, cmd.y * sc]];
                break;
            case 'L':
                cur.push([cmd.x * sc, cmd.y * sc]);
                break;
            case 'Q': {
                const [p0] = cur.slice(-1);
                for (let i = 1; i <= BEZIER_STEPS; i++) {
                    const t = i / BEZIER_STEPS, mt = 1 - t;
                    cur.push([
                        mt * mt * p0[0] + 2 * mt * t * cmd.x1 * sc + t * t * cmd.x * sc,
                        mt * mt * p0[1] + 2 * mt * t * cmd.y1 * sc + t * t * cmd.y * sc,
                    ]);
                }
                break;
            }
            case 'C': {
                const [p0] = cur.slice(-1);
                for (let i = 1; i <= BEZIER_STEPS; i++) {
                    const t = i / BEZIER_STEPS, mt = 1 - t;
                    cur.push([
                        mt ** 3 * p0[0] + 3 * mt * mt * t * cmd.x1 * sc + 3 * mt * t * t * cmd.x2 * sc + t ** 3 * cmd.x * sc,
                        mt ** 3 * p0[1] + 3 * mt * mt * t * cmd.y1 * sc + 3 * mt * t * t * cmd.y2 * sc + t ** 3 * cmd.y * sc,
                    ]);
                }
                break;
            }
            case 'Z':
                close();
                break;
        }
    }
    close();
    return contours;
}

// One line per non-empty text: pet name and phone stack when both are set.
function textLines(p) {
    const texts = [p.nameText, p.phoneText].filter(Boolean);
    const sizes = texts.length > 1 ? [0.34, 0.2] : [0.45];
    return texts.map((text, i) => ({ text, size: p.height * (sizes[i] ?? sizes[0]) }));
}

// Centers each line, flips it to plate orientation, stacks the lines and shrinks any line that exceeds the usable width.
function fitTextContours(p, font) {
    const gap = p.height * 0.04;
    const lines = textLines(p)
        .map(({ text, size }) => ({ contours: textContours(font, text, size) }))
        .filter(({ contours }) => contours.length);
    if (!lines.length) return null;

    for (const line of lines) {
        const b = bounds(line.contours);
        const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
        for (const c of line.contours) for (const pt of c) { pt[0] -= cx; pt[1] = -(pt[1] - cy); }

        const largest = line.contours.reduce((a, c) => (Math.abs(signedArea(c)) > Math.abs(signedArea(a)) ? c : a));
        if (signedArea(largest) < 0) line.contours.forEach(c => c.reverse());

        const fit = bounds(line.contours);
        line.halfH = (fit.maxY - fit.minY) / 2;
    }

    const totalH = lines.reduce((sum, l) => sum + 2 * l.halfH, 0) + gap * (lines.length - 1);
    let top = totalH / 2;
    const hw = p.width / 2 - p.borderW - 2, hh = p.height / 2 - p.borderW - 2;
    const innerR = Math.max(0, p.cornerR - p.borderW - 2);

    for (const line of lines) {
        const yc = top - line.halfH;
        top -= 2 * line.halfH + gap;

        // Usable width at the line's outer and inner vertical edges.
        const outer = Math.abs(yc) + line.halfH;
        const inner = Math.max(0, Math.abs(yc) - line.halfH);
        const maxW = 2 * Math.min(
            shapeMaxXAt(hw, hh, innerR, p.shape, outer),
            shapeMaxXAt(hw, hh, innerR, p.shape, inner),
        );
        const textW = bounds(line.contours);
        const w = textW.maxX - textW.minX;
        const sx = maxW > 0 && w > maxW ? maxW / w : 1;

        for (const c of line.contours) for (const pt of c) { pt[0] *= sx; pt[1] += yc; }
    }
    return lines.flatMap(l => l.contours);
}

function holeCenters(p, innerHW, innerHH, innerCR) {
    const margin = p.holeD / 2 + 2;
    switch (p.holeLayout) {
        case 'top-center': {
            const y = Math.max(0, innerHH - margin);
            return y > 0 ? [[0, y]] : [];
        }
        case 'top-two': {
            const y = Math.max(0, innerHH - margin);
            const availX = shapeMaxXAt(innerHW, innerHH, innerCR, p.shape, y) - margin;
            if (availX <= p.holeD) return [];
            const x = Math.min(innerHW * 0.65, availX);
            return [[-x, y], [x, y]];
        }
        case 'left-right': {
            const availX = shapeMaxXAt(innerHW, innerHH, innerCR, p.shape, 0) - margin;
            const x = Math.min(innerHW - margin, availX);
            return x > 0 ? [[-x, 0], [x, 0]] : [];
        }
        default:
            return [];
    }
}

// Round pocket at the plate center for an NFC tag, cut through the base top and the text piece.
const NFC_POCKET_DEPTH_MM = 1;

function nfcPocket(wasm, p, baseThk) {
    const depth = Math.min(NFC_POCKET_DEPTH_MM, baseThk / 2);
    const cs = new wasm.CrossSection([circlePoly(p.nfcD / 2 + p.tolerance)]);
    const pocket = wasm.Manifold.extrude(cs, depth + p.textH + 1).translate([0, 0, baseThk - depth]);
    cs.delete();
    return pocket;
}

// Builds the base plate (border, holes, text recess) and the raised text piece as Manifold solids.
function buildPlate(wasm, font, p) {
    const { width, height, baseThk, borderW, borderH, cornerR, textH, tolerance, shape } = p;
    const hw = width / 2, hh = height / 2;
    const innerHW = hw - borderW, innerHH = hh - borderW, innerCR = Math.max(0, cornerR - borderW);

    const outerCS = new wasm.CrossSection([shapePoly(hw, hh, cornerR, shape)]);
    let base = wasm.Manifold.extrude(outerCS, baseThk);

    if (borderW > 0.1 && borderH > 0.1) {
        const innerCS = new wasm.CrossSection([shapePoly(innerHW, innerHH, innerCR, shape)]);
        const ringCS = outerCS.subtract(innerCS);
        const ring = wasm.Manifold.extrude(ringCS, borderH).translate([0, 0, baseThk]);
        const merged = base.add(ring);
        [innerCS, ringCS, ring, base].forEach(o => o.delete());
        base = merged;
    }

    for (const [x, y] of holeCenters(p, innerHW, innerHH, innerCR)) {
        const holeCS = new wasm.CrossSection([circlePoly(p.holeD / 2)]);
        const hole = wasm.Manifold.extrude(holeCS, baseThk + borderH + 1).translate([x, y, -0.5]);
        const cut = base.subtract(hole);
        [holeCS, hole, base].forEach(o => o.delete());
        base = cut;
    }

    const tag = p.nfc ? nfcPocket(wasm, p, baseThk) : null;
    if (tag) {
        const cut = base.subtract(tag);
        base.delete();
        base = cut;
    }

    let text = null;
    const contours = fitTextContours(p, font);
    if (contours) {
        const nameCS = new wasm.CrossSection(contours);
        const cutCS = tolerance > 0.01 ? nameCS.offset(tolerance, 'Round', 8) : nameCS;
        const recess = baseThk * RECESS_RATIO;
        const cutter = wasm.Manifold.extrude(cutCS, recess + textH + 0.01).translate([0, 0, baseThk - recess]);
        const cut = base.subtract(cutter);
        base.delete();
        cutter.delete();
        base = cut;
        text = wasm.Manifold.extrude(nameCS, recess + textH).translate([0, 0, baseThk - recess]);
        if (tag) {
            const cutText = text.subtract(tag);
            text.delete();
            text = cutText;
        }
        if (cutCS !== nameCS) cutCS.delete();
        nameCS.delete();
    }

    tag?.delete();
    outerCS.delete();
    return { base, text };
}

// Converts a Manifold solid into a Y-up, creased-normal mesh geometry (30° crease angle).
function manifoldToGeometry(manifold) {
    const mesh = manifold.getMesh();
    const { numProp, numVert, vertProperties, triVerts } = mesh;

    const positions = new Float32Array(numVert * 3);
    for (let i = 0; i < numVert; i++) {
        positions.set(vertProperties.subarray(i * numProp, i * numProp + 3), i * 3);
    }
    const indexed = new THREE.BufferGeometry();
    indexed.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    indexed.setIndex(new THREE.BufferAttribute(new Uint32Array(triVerts), 1));

    const geo = toCreasedNormals(indexed, Math.PI / 6);
    geo.rotateX(-Math.PI / 2);
    indexed.dispose();
    mesh.delete?.();
    return geo;
}

// ===== Regeneration (serialized so Manifold calls never overlap) =====
async function regenerate() {
    const [wasm, font] = await Promise.all([loadManifold(), loadFont(params.font)]);
    const { base, text } = buildPlate(wasm, font, params);
    partVolumes = { base: manifoldVolume(base), text: text ? manifoldVolume(text) : 0 };

    baseMesh.geometry.dispose();
    baseMesh.geometry = manifoldToGeometry(base);
    base.delete();

    textMesh.visible = Boolean(text);
    if (text) {
        textMesh.geometry.dispose();
        textMesh.geometry = manifoldToGeometry(text);
        text.delete();
    }
    renderStats();
    renderFilament();
}

let regenTimer = null;
let regenQueue = Promise.resolve();
function scheduleRegen() {
    clearTimeout(regenTimer);
    regenTimer = setTimeout(() => {
        regenQueue = regenQueue.then(regenerate).catch(showError);
    }, 250);
}

// ===== Stats and export =====
const visibleMeshes = () => [baseMesh, textMesh].filter(m => m.visible);

function renderStats() {
    const meshes = visibleMeshes();
    const tris = meshes.reduce((n, m) => n + m.geometry.attributes.position.count / 3, 0);
    const box = new THREE.Box3();
    meshes.forEach(m => box.expandByObject(m));
    const size = box.getSize(new THREE.Vector3());

    document.getElementById('statTris').textContent = tris.toLocaleString();
    document.getElementById('statBBox').textContent = `${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)} mm`;
}

const stlExporter = new STLExporter();

function stlBlob(meshes) {
    const group = new THREE.Group();
    group.add(...meshes.map(m => m.clone()));
    return new Blob([stlExporter.parse(group, { binary: true })], { type: 'application/octet-stream' });
}

function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    Object.assign(document.createElement('a'), { href: url, download: filename }).click();
    URL.revokeObjectURL(url);
}

const fileStem = () => params.nameText.replace(/\s+/g, '_');

function downloadStl() {
    const meshes = visibleMeshes();
    if (meshes.length) download(stlBlob(meshes), `name_plate_${fileStem()}.stl`);
}

async function downloadParts() {
    if (!textMesh.visible) return downloadStl();
    const zip = new JSZip();
    zip.file(`${fileStem()}_base.stl`, stlBlob([baseMesh]));
    zip.file(`${fileStem()}_text.stl`, stlBlob([textMesh]));
    // The app cannot write the tag; this file holds the URL to program into it.
    if (params.nfc && isValidUrl(params.nfcUrl)) zip.file('nfc_url.txt', `${params.nfcUrl}\n`);
    download(await zip.generateAsync({ type: 'blob' }), `name_plate_${fileStem()}_parts.zip`);
}

function buildScad(p) {
    return `// Parametric Name Plate Generator
// Generated by PrintPal — printpal.io/tools/name-plate-generator

/* [Text] */
Name = "${p.nameText}";
Phone = "${p.phoneText}";
Font = "${p.font}";

/* [Shape] */
Plate_Shape = "${p.shape}"; // [rounded-rect, rectangle, oval, stadium]

/* [Dimensions] */
Width = ${p.width}; // [40:200]
Height = ${p.height}; // [15:120]
Base_Thickness = ${p.baseThk}; // [1:0.1:6]
Border_Width = ${p.borderW}; // [0:0.5:10]
Border_Height = ${p.borderH}; // [0:0.1:5]
Corner_Radius = ${p.cornerR}; // [0:0.5:30]
Text_Height = ${p.textH}; // [0.4:0.1:5]
Fit_Tolerance = ${p.tolerance}; // [0:0.05:1]

/* [NFC Tag] */
NFC = ${p.nfc}; // Round pocket for a tag at the plate center
NFC_Diameter = ${p.nfcD}; // [10:0.5:40]
// Program this URL into the tag: ${p.nfcUrl}

/* [Mounting Holes] */
Hole_Layout = "${p.holeLayout}"; // [none, top-center, top-two, left-right]
Hole_Diameter = ${p.holeD}; // [2:0.5:8]
Hole_Padding = ${p.holePad}; // [2:0.5:15]

$fn = 64;

module plate_shape(w, h, r) {
    if (Plate_Shape == "oval") {
        scale([w, h]) circle(r = 1);
    } else if (Plate_Shape == "stadium") {
        hull() {
            sr = min(w, h);
            translate([w - sr, 0]) circle(r = sr);
            translate([-(w - sr), 0]) circle(r = sr);
        }
    } else if (Plate_Shape == "rectangle" || r < 0.1) {
        square([w * 2, h * 2], center = true);
    } else {
        offset(r = r) square([w * 2 - r * 2, h * 2 - r * 2], center = true);
    }
}

// Two lines when Phone is set; offsets approximate the web preview's stacked layout.
module label_text() {
    if (Phone == "") {
        text(Name, size = Height * 0.45, font = Font, halign = "center", valign = "center");
    } else {
        translate([0, Height * 0.13]) text(Name, size = Height * 0.34, font = Font, halign = "center", valign = "center");
        translate([0, -Height * 0.12]) text(Phone, size = Height * 0.2, font = Font, halign = "center", valign = "center");
    }
}

module nfc_pocket() {
    pocket_depth = min(1, Base_Thickness / 2);
    translate([0, 0, Base_Thickness - pocket_depth])
        cylinder(d = NFC_Diameter + 2 * Fit_Tolerance, h = pocket_depth + Text_Height + 1);
}

module name_plate() {
    hw = Width / 2; hh = Height / 2;
    recess = Base_Thickness / 2;
    difference() {
        union() {
            linear_extrude(Base_Thickness) plate_shape(hw, hh, Corner_Radius);
            if (Border_Width > 0.1 && Border_Height > 0.1)
                translate([0, 0, Base_Thickness])
                    linear_extrude(Border_Height)
                        difference() {
                            plate_shape(hw, hh, Corner_Radius);
                            plate_shape(hw - Border_Width, hh - Border_Width, max(0, Corner_Radius - Border_Width));
                        }
        }
        // Text recess
        translate([0, 0, Base_Thickness - recess])
            linear_extrude(recess + Text_Height + 0.01)
                offset(delta = Fit_Tolerance)
                    label_text();
        // Mounting holes
        if (Hole_Layout == "top-center")
            translate([0, hh - Hole_Padding, -0.5]) cylinder(d = Hole_Diameter, h = Base_Thickness + Border_Height + 2);
        if (Hole_Layout == "top-two") {
            translate([-(hw - Hole_Padding - Border_Width), hh - Hole_Padding, -0.5]) cylinder(d = Hole_Diameter, h = Base_Thickness + Border_Height + 2);
            translate([hw - Hole_Padding - Border_Width, hh - Hole_Padding, -0.5]) cylinder(d = Hole_Diameter, h = Base_Thickness + Border_Height + 2);
        }
        if (Hole_Layout == "left-right") {
            translate([-hw + Hole_Padding, 0, -0.5]) cylinder(d = Hole_Diameter, h = Base_Thickness + Border_Height + 2);
            translate([hw - Hole_Padding, 0, -0.5]) cylinder(d = Hole_Diameter, h = Base_Thickness + Border_Height + 2);
        }
        if (NFC) nfc_pocket();
    }
    // Text piece
    difference() {
        color("white")
        translate([0, 0, Base_Thickness - recess])
            linear_extrude(recess + Text_Height)
                label_text();
        if (NFC) nfc_pocket();
    }
}

name_plate();
`;
}

// ===== Filament estimate =====
const PLA_DENSITY_G_CM3 = 1.24;
const FILAMENT_DIAMETER_MM = 1.75;
const FILAMENT_AREA_MM2 = Math.PI * (FILAMENT_DIAMETER_MM / 2) ** 2;

let partVolumes = { base: 0, text: 0 };

// Signed tetrahedron sum over the closed mesh (divergence theorem), in mm³.
function manifoldVolume(manifold) {
    const mesh = manifold.getMesh();
    const { numProp, vertProperties, triVerts } = mesh;
    const vertex = v => [vertProperties[v * numProp], vertProperties[v * numProp + 1], vertProperties[v * numProp + 2]];

    let volume = 0;
    for (let t = 0; t < triVerts.length; t += 3) {
        const [ax, ay, az] = vertex(triVerts[t]);
        const [bx, by, bz] = vertex(triVerts[t + 1]);
        const [cx, cy, cz] = vertex(triVerts[t + 2]);
        volume += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    }
    mesh.delete?.();
    return Math.abs(volume) / 6;
}

// Solid volume only: real usage is lower with infill, so this is an upper bound.
function renderFilament() {
    const rows = [
        ['Base', plateMaterials.base.color, partVolumes.base],
        ['Text', plateMaterials.text.color, partVolumes.text],
    ];
    document.getElementById('filamentRows').replaceChildren(...rows.map(([label, color, mm3]) => {
        const row = document.createElement('div');
        row.className = 'flex items-center justify-between';

        const name = document.createElement('span');
        name.className = 'flex items-center gap-2';
        const swatch = document.createElement('span');
        swatch.className = 'inline-block h-3 w-3 rounded-full border border-slate-300';
        swatch.style.background = `#${color.getHexString()}`;
        name.append(swatch, `${label} #${color.getHexString()}`);

        const grams = (mm3 / 1000) * PLA_DENSITY_G_CM3;
        const meters = mm3 / FILAMENT_AREA_MM2 / 1000;
        const amount = document.createElement('span');
        amount.className = 'font-semibold text-blue-600';
        amount.textContent = `${grams.toFixed(1)} g · ${meters.toFixed(2)} m`;

        row.append(name, amount);
        return row;
    }));
}

// ===== UI =====
const controlEls = document.querySelectorAll('[data-param]');
const outputEls = document.querySelectorAll('[data-out]');

function isValidUrl(value) {
    try {
        return ['http:', 'https:'].includes(new URL(value).protocol);
    } catch {
        return false;
    }
}

function renderNfcFields() {
    document.getElementById('nfcFields').classList.toggle('hidden', !params.nfc);
    const invalid = params.nfc && !isValidUrl(params.nfcUrl);
    document.getElementById('nfcUrlError').classList.toggle('hidden', !invalid);
}

function renderControls() {
    for (const el of controlEls) {
        if (el.type === 'checkbox') el.checked = params[el.dataset.param];
        else el.value = params[el.dataset.param];
    }
    for (const el of outputEls) el.textContent = params[el.dataset.out];
    renderNfcFields();
}

function showStatus(text) {
    loadingText.textContent = text;
    loading.classList.remove('hidden');
}

function hideStatus() {
    loading.classList.add('hidden');
}

function showError(err) {
    console.error('[NamePlate]', err);
    showStatus(`Error: ${err.message}`);
}

function applyPreset(name) {
    Object.assign(params, PRESETS[name]);
    document.querySelectorAll('[data-preset]').forEach(b => b.classList.toggle('btn-active', b.dataset.preset === name));
    renderControls();
    scheduleRegen();
}

function populateFontSelect() {
    const select = document.querySelector('select[data-param="font"]');
    for (const name of Object.keys(FONTS)) {
        select.append(new Option(name, name));
    }
}

function populateColorPicker() {
    const picker = document.getElementById('colorPicker');
    COLOR_PRESETS.forEach((colors, i) => {
        const swatch = document.createElement('button');
        swatch.className = 'h-8 w-8 rounded-full border border-slate-300';
        swatch.style.background = `linear-gradient(135deg, ${colors.base} 50%, ${colors.text} 50%)`;
        swatch.addEventListener('click', () => {
            plateMaterials.base.color.set(colors.base);
            plateMaterials.text.color.set(colors.text);
            picker.querySelectorAll('button').forEach((b, j) => b.classList.toggle('ring-2', i === j));
            renderFilament();
        });
        picker.append(swatch);
    });
    picker.firstElementChild.click();
}

for (const el of controlEls) {
    el.addEventListener('input', () => {
        const key = el.dataset.param;
        if (el.type === 'checkbox') params[key] = el.checked;
        else params[key] = el.type === 'range' ? Number(el.value) : el.value;
        const out = document.querySelector(`[data-out="${key}"]`);
        if (out) out.textContent = params[key];
        renderNfcFields();
        if (key === 'font') {
            showStatus(`Loading ${params.font}...`);
            loadFont(params.font).then(hideStatus, showError);
        }
        scheduleRegen();
    });
}

document.querySelectorAll('[data-preset]').forEach(btn => {
    btn.addEventListener('click', () => applyPreset(btn.dataset.preset));
});

document.getElementById('btnStl').addEventListener('click', downloadStl);
document.getElementById('btnStlSidebar').addEventListener('click', downloadStl);
document.getElementById('btnParts').addEventListener('click', downloadParts);
document.getElementById('btnScad').addEventListener('click', () => {
    download(new Blob([buildScad(params)], { type: 'text/plain' }), `name_plate_${fileStem()}.scad`);
});

populateFontSelect();
populateColorPicker();
renderControls();

// ===== Init =====
(async () => {
    try {
        showStatus('Loading 3D engine...');
        await loadManifold();
        showStatus(`Loading ${params.font}...`);
        await regenerate();
        hideStatus();
        frameCamera();
    } catch (err) {
        showError(err);
    }
})();

function frameCamera() {
    const box = new THREE.Box3();
    visibleMeshes().forEach(m => box.expandByObject(m));
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    camera.position.set(center.x, center.y + maxDim * 0.9, center.z + maxDim);
    controls.target.copy(center);
    controls.update();
}
