import { bounds } from './common.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SHAPE_SELECTOR = 'path, rect, circle, ellipse, polygon, polyline';
const SAMPLES_ACROSS_SHAPE = 300;
const MIN_SAMPLES = 8;

// Start offsets (in path length) of each subpath. Measured on growing prefixes, so relative
// moves and transforms inside the path data are resolved by the browser.
function subpathStarts(probe, host, d) {
    const starts = [0];
    for (const match of d.matchAll(/[Mm]/g)) {
        if (match.index === 0) continue;
        probe.setAttribute('d', d.slice(0, match.index));
        host.replaceChildren(probe);
        starts.push(probe.getTotalLength());
    }
    return starts;
}

// Samples one SVG shape into closed polylines, in SVG units.
function shapeContours(host, shape) {
    const el = document.importNode(shape, true);
    host.replaceChildren(el);

    const total = el.getTotalLength();
    const box = el.getBBox();
    const step = Math.max(Math.hypot(box.width, box.height), 1) / SAMPLES_ACROSS_SHAPE;

    const starts = shape.localName === 'path'
        ? subpathStarts(document.createElementNS(SVG_NS, 'path'), host, shape.getAttribute('d') ?? '')
        : [0];
    host.replaceChildren(el);

    return starts.map((from, i) => {
        const to = starts[i + 1] ?? total;
        const n = Math.max(MIN_SAMPLES, Math.ceil((to - from) / step));
        // Skip the endpoint: it repeats the start point of a closed subpath.
        return Array.from({ length: n }, (_, k) => {
            const p = el.getPointAtLength(from + ((to - from) * k) / n);
            return [p.x, p.y];
        });
    }).filter(c => c.length > 2);
}

// Converts an SVG file into closed contours scaled to a unit height, centered on x = 0, y-up.
// Throws when the file is not SVG or has no drawable shapes, so the caller can report it.
export function parseSvgContours(svgText) {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const root = doc.documentElement;
    if (root.localName !== 'svg' || doc.querySelector('parsererror')) {
        throw new Error('The file is not a valid SVG.');
    }

    const shapes = [...root.querySelectorAll(SHAPE_SELECTOR)];
    if (!shapes.length) throw new Error('The SVG has no paths or basic shapes to use.');

    // Shapes are measured inside a hidden SVG in the page; getPointAtLength needs a rendered element.
    const host = document.createElementNS(SVG_NS, 'svg');
    Object.assign(host.style, { position: 'absolute', visibility: 'hidden', width: '0', height: '0' });
    document.body.append(host);
    try {
        const contours = shapes.flatMap(shape => shapeContours(host, shape));
        if (!contours.length) throw new Error('The SVG shapes have no area.');

        const b = bounds(contours);
        const height = b.maxY - b.minY;
        if (height <= 0) throw new Error('The SVG shapes have no height.');
        const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
        const scale = 1 / height;
        return contours.map(c => c.map(([x, y]) => [(x - cx) * scale, -(y - cy) * scale]));
    } finally {
        host.remove();
    }
}
