/*
    Shape geometry for the Shapes tool.

    Every shape is described with moveTo / lineTo / quadraticCurveTo /
    bezierCurveTo / closePath only, so the same code fills a canvas Path2D
    (drawing) and an SVG path string (the icons of the shape gallery).
    Nothing here touches the DOM: the tests import it in Node.
*/

// The gallery, in display order. "line" shapes are drawn between two end
// points (and an optional bend); every other shape fills its bounding box.
export const SHAPES = [
    { id: 'line', line: true },
    { id: 'arrow', line: true },
    { id: 'rect' },
    { id: 'roundrect' },
    { id: 'ellipse' },
    { id: 'triangle' },
    { id: 'righttriangle' },
    { id: 'diamond' },
    { id: 'pentagon' },
    { id: 'hexagon' },
    { id: 'star' },
    { id: 'heart' },
    { id: 'arrowright' },
    { id: 'arrowleft' },
    { id: 'arrowup' },
    { id: 'arrowdown' },
    { id: 'callout' }
];

export function isLineShape(id) {
    return id === 'line' || id === 'arrow';
}

// Builds an SVG path "d" string through the same calls as a Path2D
export class SvgPathBuilder {
    constructor() {
        this.parts = [];
    }
    static n(v) {
        return String(Math.round(v * 100) / 100);
    }
    moveTo(x, y) {
        this.parts.push('M' + SvgPathBuilder.n(x) + ' ' + SvgPathBuilder.n(y));
    }
    lineTo(x, y) {
        this.parts.push('L' + SvgPathBuilder.n(x) + ' ' + SvgPathBuilder.n(y));
    }
    quadraticCurveTo(cx, cy, x, y) {
        const n = SvgPathBuilder.n;
        this.parts.push('Q' + n(cx) + ' ' + n(cy) + ' ' + n(x) + ' ' + n(y));
    }
    bezierCurveTo(c1x, c1y, c2x, c2y, x, y) {
        const n = SvgPathBuilder.n;
        this.parts.push('C' + n(c1x) + ' ' + n(c1y) + ' ' + n(c2x) + ' ' + n(c2y) + ' ' + n(x) + ' ' + n(y));
    }
    closePath() {
        this.parts.push('Z');
    }
    toString() {
        return this.parts.join('');
    }
}

// Circle-arc approximation constant for cubic Beziers
const K = 0.5522847498;

function polygon(pb, pts) {
    pb.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
        pb.lineTo(pts[i][0], pts[i][1]);
    }
    pb.closePath();
}

// Points of a unit-circle polygon, stretched to fill the box exactly
function regularPoints(count, startAngle, radii, x, y, w, h) {
    const raw = [];
    for (let i = 0; i < count; i++) {
        const a = startAngle + (i * 2 * Math.PI) / count;
        const r = radii[i % radii.length];
        raw.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    return fitPoints(raw, x, y, w, h);
}

function fitPoints(raw, x, y, w, h) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of raw) {
        minX = Math.min(minX, p[0]);
        minY = Math.min(minY, p[1]);
        maxX = Math.max(maxX, p[0]);
        maxY = Math.max(maxY, p[1]);
    }
    const sx = w / (maxX - minX || 1);
    const sy = h / (maxY - minY || 1);
    return raw.map((p) => [x + (p[0] - minX) * sx, y + (p[1] - minY) * sy]);
}

// Unit-square points (0..1) mapped into the box
function unitPoints(pts, x, y, w, h) {
    return pts.map((p) => [x + p[0] * w, y + p[1] * h]);
}

function roundRectPath(pb, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    const k = r * (1 - K);
    pb.moveTo(x + r, y);
    pb.lineTo(x + w - r, y);
    pb.bezierCurveTo(x + w - k, y, x + w, y + k, x + w, y + r);
    pb.lineTo(x + w, y + h - r);
    pb.bezierCurveTo(x + w, y + h - k, x + w - k, y + h, x + w - r, y + h);
    pb.lineTo(x + r, y + h);
    pb.bezierCurveTo(x + k, y + h, x, y + h - k, x, y + h - r);
    pb.lineTo(x, y + r);
    pb.bezierCurveTo(x, y + k, x + k, y, x + r, y);
    pb.closePath();
}

function ellipsePath(pb, x, y, w, h) {
    const rx = w / 2, ry = h / 2;
    const cx = x + rx, cy = y + ry;
    const ox = rx * K, oy = ry * K;
    pb.moveTo(cx + rx, cy);
    pb.bezierCurveTo(cx + rx, cy + oy, cx + ox, cy + ry, cx, cy + ry);
    pb.bezierCurveTo(cx - ox, cy + ry, cx - rx, cy + oy, cx - rx, cy);
    pb.bezierCurveTo(cx - rx, cy - oy, cx - ox, cy - ry, cx, cy - ry);
    pb.bezierCurveTo(cx + ox, cy - ry, cx + rx, cy - oy, cx + rx, cy);
    pb.closePath();
}

// Right pointing block arrow in the unit square; other directions are this
// one turned around inside the square
const BLOCK_ARROW = [[0, 0.25], [0.6, 0.25], [0.6, 0], [1, 0.5], [0.6, 1], [0.6, 0.75], [0, 0.75]];
const ARROW_DIRS = {
    arrowright: (p) => [p[0], p[1]],
    arrowleft: (p) => [1 - p[0], p[1]],
    arrowup: (p) => [p[1], 1 - p[0]],
    arrowdown: (p) => [p[1], p[0]]
};

// Adds the outline of a box shape to a path builder. The box is x, y, w, h
// with w, h > 0.
export function buildShape(pb, id, x, y, w, h) {
    switch (id) {
        case 'rect':
            polygon(pb, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
            break;
        case 'roundrect':
            roundRectPath(pb, x, y, w, h, Math.min(w, h) * 0.2);
            break;
        case 'ellipse':
            ellipsePath(pb, x, y, w, h);
            break;
        case 'triangle':
            polygon(pb, [[x + w / 2, y], [x + w, y + h], [x, y + h]]);
            break;
        case 'righttriangle':
            polygon(pb, [[x, y], [x + w, y + h], [x, y + h]]);
            break;
        case 'diamond':
            polygon(pb, [[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2]]);
            break;
        case 'pentagon':
            polygon(pb, regularPoints(5, -Math.PI / 2, [1], x, y, w, h));
            break;
        case 'hexagon':
            polygon(pb, regularPoints(6, 0, [1], x, y, w, h));
            break;
        case 'star':
            polygon(pb, regularPoints(10, -Math.PI / 2, [1, 0.382], x, y, w, h));
            break;
        case 'heart': {
            const P = (u, v) => [x + u * w, y + v * h];
            const m = P(0.5, 0.28);
            pb.moveTo(m[0], m[1]);
            const curves = [
                [0.5, 0.12, 0.38, 0, 0.25, 0],
                [0.1, 0, 0, 0.12, 0, 0.3],
                [0, 0.55, 0.25, 0.72, 0.5, 1],
                [0.75, 0.72, 1, 0.55, 1, 0.3],
                [1, 0.12, 0.9, 0, 0.75, 0],
                [0.62, 0, 0.5, 0.12, 0.5, 0.28]
            ];
            for (const c of curves) {
                const a = P(c[0], c[1]), b = P(c[2], c[3]), e = P(c[4], c[5]);
                pb.bezierCurveTo(a[0], a[1], b[0], b[1], e[0], e[1]);
            }
            pb.closePath();
            break;
        }
        case 'arrowright':
        case 'arrowleft':
        case 'arrowup':
        case 'arrowdown':
            polygon(pb, unitPoints(BLOCK_ARROW.map(ARROW_DIRS[id]), x, y, w, h));
            break;
        case 'callout': {
            const by = y + h * 0.75;
            const bh = by - y;
            const r = Math.max(0, Math.min(w / 2, bh / 2, Math.min(w, bh) * 0.2));
            const k = r * (1 - K);
            pb.moveTo(x + r, y);
            pb.lineTo(x + w - r, y);
            pb.bezierCurveTo(x + w - k, y, x + w, y + k, x + w, y + r);
            pb.lineTo(x + w, by - r);
            pb.bezierCurveTo(x + w, by - k, x + w - k, by, x + w - r, by);
            pb.lineTo(x + w * 0.42, by);
            pb.lineTo(x + w * 0.18, y + h);
            pb.lineTo(x + w * 0.26, by);
            pb.lineTo(x + r, by);
            pb.bezierCurveTo(x + k, by, x, by - k, x, by - r);
            pb.lineTo(x, y + r);
            pb.bezierCurveTo(x, y + k, x + k, y, x + r, y);
            pb.closePath();
            break;
        }
        default:
            polygon(pb, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
    }
}

/* ------------------------------------------------------------ lines */

export function quadPoint(p0, c, p1, t) {
    const u = 1 - t;
    return {
        x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
        y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y
    };
}

// The control point that makes a quadratic pass through `mid` at t = 0.5
export function controlFromMid(p0, p1, mid) {
    return { x: 2 * mid.x - (p0.x + p1.x) / 2, y: 2 * mid.y - (p0.y + p1.y) / 2 };
}

// Point the bend handle sits on: the middle of the (possibly bent) line
export function lineMid(p0, p1, c) {
    if (!c) {
        return { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
    }
    return quadPoint(p0, c, p1, 0.5);
}

// Arrow head size for a stroke width
export function arrowHeadSize(width, minLen) {
    const len = Math.max(minLen === undefined ? 12 : minLen, width * 4);
    return { len: len, half: len * 0.55 };
}

/*
    Geometry of a straight or bent line, with an optional arrow head at p1.
    Returns { body: [p0, c|null, end], head: [tip, left, right] | null }: the
    body stops at the base of the head so a thick stroke does not poke out
    past the tip.
*/
export function lineGeometry(p0, p1, c, arrow, width, minHead) {
    if (!arrow) {
        return { body: [p0, c || null, p1], head: null };
    }
    const hs = arrowHeadSize(width, minHead);
    let base, dir;
    if (!c) {
        const dx = p1.x - p0.x, dy = p1.y - p0.y;
        const L = Math.hypot(dx, dy) || 1;
        dir = { x: dx / L, y: dy / L };
        const back = Math.min(hs.len * 0.9, L);
        base = { x: p1.x - dir.x * back, y: p1.y - dir.y * back };
        const tip = p1;
        const bx = p1.x - dir.x * hs.len, by = p1.y - dir.y * hs.len;
        return {
            body: [p0, null, base],
            head: [tip, { x: bx - dir.y * hs.half, y: by + dir.x * hs.half }, { x: bx + dir.y * hs.half, y: by - dir.x * hs.half }]
        };
    }
    // Walk back along the curve until we are a head length away from the tip
    let t = 1;
    let pt = p1;
    while (t > 0) {
        t -= 0.005;
        pt = quadPoint(p0, c, p1, Math.max(0, t));
        if (Math.hypot(p1.x - pt.x, p1.y - pt.y) >= hs.len * 0.9) {
            break;
        }
    }
    t = Math.max(0, t);
    // de Casteljau split: the part of the curve from 0 to t
    const c1 = { x: p0.x + (c.x - p0.x) * t, y: p0.y + (c.y - p0.y) * t };
    const dx = p1.x - pt.x, dy = p1.y - pt.y;
    const L = Math.hypot(dx, dy) || 1;
    dir = { x: dx / L, y: dy / L };
    const bx = p1.x - dir.x * hs.len, by = p1.y - dir.y * hs.len;
    return {
        body: [p0, c1, pt],
        head: [p1, { x: bx - dir.y * hs.half, y: by + dir.x * hs.half }, { x: bx + dir.y * hs.half, y: by - dir.x * hs.half }]
    };
}

export function buildLineBody(pb, geo) {
    const [a, c, b] = geo.body;
    pb.moveTo(a.x, a.y);
    if (c) {
        pb.quadraticCurveTo(c.x, c.y, b.x, b.y);
    } else {
        pb.lineTo(b.x, b.y);
    }
}

export function buildArrowHead(pb, geo) {
    if (!geo.head) {
        return;
    }
    const [t, l, r] = geo.head;
    pb.moveTo(t.x, t.y);
    pb.lineTo(l.x, l.y);
    pb.lineTo(r.x, r.y);
    pb.closePath();
}

// Distance from a point to a straight or bent line
export function distanceToLine(p, p0, p1, c) {
    const steps = c ? 32 : 1;
    let best = Infinity;
    let prev = p0;
    for (let i = 1; i <= steps; i++) {
        const cur = c ? quadPoint(p0, c, p1, i / steps) : p1;
        best = Math.min(best, distToSegment(p, prev, cur));
        prev = cur;
    }
    return best;
}

export function distToSegment(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const L2 = dx * dx + dy * dy;
    let t = L2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// Snap the end of a line to the nearest 45 degree direction (Shift)
export function snapAngle(p0, p1) {
    const dx = p1.x - p0.x, dy = p1.y - p0.y;
    const L = Math.hypot(dx, dy);
    const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    return { x: p0.x + Math.cos(a) * L, y: p0.y + Math.sin(a) * L };
}

// SVG path for a gallery icon, drawn into a 24 x 24 box
export function shapeIconPath(id) {
    const pb = new SvgPathBuilder();
    if (id === 'line') {
        pb.moveTo(4, 20);
        pb.lineTo(20, 4);
    } else if (id === 'arrow') {
        const geo = lineGeometry({ x: 4, y: 20 }, { x: 20, y: 4 }, null, true, 1.6, 7);
        buildLineBody(pb, geo);
        buildArrowHead(pb, geo);
    } else {
        buildShape(pb, id, 3.5, 4.5, 17, 15);
    }
    return pb.toString();
}
