import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';

export const MANIFOLD_URL = 'https://cdn.jsdelivr.net/npm/manifold-3d@2.5.1';
export const BEZIER_STEPS = 16;

export const FONTS = {
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

// ===== Manifold (CSG) and fonts =====
let manifoldPromise;
export function loadManifold() {
    manifoldPromise ??= import(`${MANIFOLD_URL}/manifold.js`).then(async ({ default: init }) => {
        const wasm = await init({ locateFile: file => `${MANIFOLD_URL}/${file}` });
        wasm.setup();
        return wasm;
    });
    return manifoldPromise;
}

const fontCache = new Map();
export function loadFont(name) {
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
export function circlePoly(radius, segs = 48) {
    return Array.from({ length: segs }, (_, i) => {
        const a = (2 * Math.PI * i) / segs;
        return [radius * Math.cos(a), radius * Math.sin(a)];
    });
}

// Closed rounded-rectangle outline centered on the origin; hw and hh are half sizes.
export function roundRectPoly(hw, hh, r, segs = 8) {
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

export function signedArea(pts) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i];
        const [x2, y2] = pts[(i + 1) % pts.length];
        a += x1 * y2 - x2 * y1;
    }
    return a / 2;
}

export function bounds(contours) {
    const pts = contours.flat();
    return {
        minX: Math.min(...pts.map(p => p[0])),
        maxX: Math.max(...pts.map(p => p[0])),
        minY: Math.min(...pts.map(p => p[1])),
        maxY: Math.max(...pts.map(p => p[1])),
    };
}

// Flattens opentype glyph outlines into closed polylines scaled to targetHeight.
export function textContours(font, text, targetHeight) {
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

// Converts a Manifold solid into a Y-up, creased-normal mesh geometry (30° crease angle).
export function manifoldToGeometry(manifold) {
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

// Signed tetrahedron sum over the closed mesh (divergence theorem), in mm³.
export function manifoldVolume(manifold) {
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

// ===== STL export =====
const stlExporter = new STLExporter();

export function stlBlob(meshes) {
    const group = new THREE.Group();
    group.add(...meshes.map(m => m.clone()));
    return new Blob([stlExporter.parse(group, { binary: true })], { type: 'application/octet-stream' });
}

export function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    Object.assign(document.createElement('a'), { href: url, download: filename }).click();
    URL.revokeObjectURL(url);
}
