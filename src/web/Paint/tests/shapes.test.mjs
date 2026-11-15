/*
    Shape outlines, line and arrow geometry, and the shape gallery icons
    (js/shapes.js).
    Run with: node tests/run.mjs shapes
*/
import {
    SHAPES, isLineShape, SvgPathBuilder, buildShape, quadPoint, controlFromMid, lineMid,
    lineGeometry, arrowHeadSize, distanceToLine, distToSegment, snapAngle, shapeIconPath
} from '../js/shapes.js';

let failed = 0;
const a = (c, m, x) => {
    if (!c) {
        failed++;
        console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x));
    }
};
const near = (x, y, t) => Math.abs(x - y) < (t || 1e-6);

// Records every point a shape passes through (end points and control points)
class Recorder {
    constructor() {
        this.pts = [];
        this.closed = 0;
        this.moves = 0;
    }
    moveTo(x, y) { this.moves++; this.pts.push([x, y]); }
    lineTo(x, y) { this.pts.push([x, y]); }
    quadraticCurveTo(cx, cy, x, y) { this.pts.push([cx, cy], [x, y]); }
    bezierCurveTo(a, b, c, d, x, y) { this.pts.push([a, b], [c, d], [x, y]); }
    closePath() { this.closed++; }
    bounds() {
        const xs = this.pts.map((p) => p[0]), ys = this.pts.map((p) => p[1]);
        return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    }
}

/* ---------- every box shape fills its box exactly ---------- */
{
    const box = { x: 10, y: 20, w: 200, h: 100 };
    const boxShapes = SHAPES.filter((s) => !s.line).map((s) => s.id);
    a(boxShapes.length === 15, 'fifteen box shapes', boxShapes.length);
    for (const id of boxShapes) {
        const r = new Recorder();
        buildShape(r, id, box.x, box.y, box.w, box.h);
        const b = r.bounds();
        a(near(b.x0, box.x, 1e-6) && near(b.y0, box.y, 1e-6) && near(b.x1, box.x + box.w, 1e-6) && near(b.y1, box.y + box.h, 1e-6),
            id + ' touches all four sides of its box', b);
        a(r.moves === 1 && r.closed === 1, id + ' is one closed outline', { moves: r.moves, closed: r.closed });
        a(r.pts.every((p) => isFinite(p[0]) && isFinite(p[1])), id + ' has finite points');
    }
}
{
    // Block arrows point the right way: the tip is the point on the far side
    const tips = { arrowright: [110, 50], arrowleft: [10, 50], arrowup: [60, 0], arrowdown: [60, 100] };
    for (const id in tips) {
        const r = new Recorder();
        buildShape(r, id, 10, 0, 100, 100);
        a(r.pts.some((p) => near(p[0], tips[id][0]) && near(p[1], tips[id][1])), id + ' tip', tips[id]);
    }
}
{
    // A star alternates outer and inner points around the centre
    const r = new Recorder();
    buildShape(r, 'star', 0, 0, 100, 100);
    a(r.pts.length === 10, 'star has 10 points', r.pts.length);
}

/* ---------- lines ---------- */
{
    a(isLineShape('line') && isLineShape('arrow') && !isLineShape('rect'), 'line shapes');
    const p0 = { x: 0, y: 0 }, p1 = { x: 100, y: 0 };
    const mid = { x: 50, y: 40 };
    const c = controlFromMid(p0, p1, mid);
    const back = quadPoint(p0, c, p1, 0.5);
    a(near(back.x, 50) && near(back.y, 40), 'bend handle passes through the dragged point', back);
    const m = lineMid(p0, p1, c);
    a(near(m.x, 50) && near(m.y, 40), 'lineMid of a bent line', m);
    const s = lineMid(p0, p1, null);
    a(s.x === 50 && s.y === 0, 'lineMid of a straight line', s);
}
{
    // A straight arrow: the head tip is the end point, the body stops at the head
    const w = 4;
    const hs = arrowHeadSize(w);
    a(hs.len === 16 && near(hs.half, 8.8), 'head size scales with the width', hs);
    a(arrowHeadSize(1).len === 12, 'head has a minimum size', arrowHeadSize(1));
    const g = lineGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }, null, true, w);
    a(g.head[0].x === 100 && g.head[0].y === 0, 'head tip at the end point', g.head[0]);
    a(near(g.body[2].x, 100 - hs.len * 0.9), 'body stops inside the head', g.body[2]);
    a(near(g.head[1].x, 100 - hs.len) && near(Math.abs(g.head[1].y), hs.half), 'head base corners', g.head[1]);
    const plain = lineGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }, null, false, w);
    a(plain.head === null && plain.body[2].x === 100, 'a line without arrow keeps its end');
}
{
    // A bent arrow: the head points along the curve at its end
    const p0 = { x: 0, y: 0 }, p1 = { x: 100, y: 0 }, c = { x: 50, y: 100 };
    const g = lineGeometry(p0, p1, c, true, 2);
    const [tip, l, r] = g.head;
    const baseMid = { x: (l.x + r.x) / 2, y: (l.y + r.y) / 2 };
    // the curve arrives going up and to the right, so the base is below-left of the tip
    a(tip.x === 100 && baseMid.x < 100 && baseMid.y > 0, 'bent arrow head follows the curve', baseMid);
    a(g.body[1] !== null, 'bent body is still a curve');
    const end = g.body[2];
    a(near(Math.hypot(end.x - 100, end.y), arrowHeadSize(2).len * 0.9, 1), 'bent body stops a head length away', end);
}
{
    a(near(distToSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 }), 5), 'distance to a segment');
    a(near(distToSegment({ x: -3, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 }), 5), 'distance past the segment end');
    const d = distanceToLine({ x: 50, y: 50 }, { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 100 });
    a(d < 1, 'a bent line passes near its middle', d);
    const cases = [
        [{ x: 10, y: 1 }, { x: 10, y: 0 }],
        [{ x: 10, y: 9 }, { x: 9.49, y: 9.49 }],
        [{ x: -1, y: 10 }, { x: 0, y: 10.05 }]
    ];
    for (const [p, want] of cases) {
        const q = snapAngle({ x: 0, y: 0 }, p);
        a(near(q.x, want.x, 0.05) && near(q.y, want.y, 0.05), 'snapAngle ' + JSON.stringify(p), q);
    }
}

/* ---------- SVG output for the gallery ---------- */
{
    const pb = new SvgPathBuilder();
    pb.moveTo(1, 2);
    pb.lineTo(3.14159, 4);
    pb.quadraticCurveTo(1, 1, 2, 2);
    pb.bezierCurveTo(1, 2, 3, 4, 5, 6);
    pb.closePath();
    a(pb.toString() === 'M1 2L3.14 4Q1 1 2 2C1 2 3 4 5 6Z', 'svg path string', pb.toString());
    for (const s of SHAPES) {
        const d = shapeIconPath(s.id);
        a(/^M[-\d. LQCZM]+$/.test(d), 'icon path for ' + s.id, d);
    }
}

console.log(failed ? failed + ' checks failed' : 'shapes: all checks passed');
process.exitCode = failed ? 1 : 0;
