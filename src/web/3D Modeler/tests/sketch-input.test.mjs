/*
    Typed sizes while drawing (the value boxes of the sketch tools): a line
    or a slot's centre line held to a typed length and angle, the angle to
    the sketch X axis kept as a dimension the solver honours, the live
    values the boxes show, and a click on a dimension in Dimension mode
    opening its editor.
    Run with: node tests/run.mjs sketch-input
*/
import * as M from '../js/sketch/model.js';
import { TOOLS } from '../js/sketch/tools.js';
import { createSolver } from '../js/sketch/solver.js';

let failed = 0;
const a = (c, m, x) => { if (!c) { failed++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } };
const near = (x, y, t) => Math.abs(x - y) < (t || 1e-6);
const solver = await createSolver();

// A stand-in for the sketcher: what the tools ask of it
function harness() {
    const h = { sk: { geometry: [], constraints: [] }, texts: [], fields: [], live: [], edited: null, committed: [] };
    h.ctx = {
        sk: () => h.sk,
        resolve: (snap) => snap.point || M.addPoint(h.sk, snap.pt[0], snap.pt[1]),
        commit: (label) => {
            h.committed.push(label);
            return solver.solve(h.sk).ok;
        },
        preview: () => {},
        prompt: () => {},
        fields: (labels) => {
            h.fields = labels;
            h.texts = labels.map(() => '');
        },
        live: (list) => {
            h.live = list;
        },
        typed: (i) => {
            const v = parseFloat(h.texts[i]);
            return v > 0 ? v : 0;
        },
        typedValue: (i) => h.texts[i] ? parseFloat(h.texts[i]) : NaN,
        construction: () => false,
        pixel: () => 0.1,
        editDimension: (id) => {
            h.edited = id;
        },
        frame: () => ({ o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], n: [0, 0, 1] })
    };
    return h;
}
const snap = (x, y, extra) => Object.assign({ pt: [x, y], raw: [x, y], point: null, curve: null, mid: null, h: false, v: false, hit: null }, extra || {});
const dims = (sk) => sk.constraints.filter(c => M.isDimension(c)).map(c => c.type);

/* ---- a line at a typed length and angle ---- */
{
    const h = harness();
    const tool = TOOLS.line(h.ctx);
    tool.click(snap(0, 0));
    a(h.fields.length === 2 && h.fields[0].unit === 'mm' && h.fields[1].unit === 'deg', 'a line has a length and an angle box', h.fields);
    tool.move(snap(30, 10));
    a(h.live.length === 2 && near(h.live[0].value, Math.hypot(30, 10)) && near(h.live[1].value, Math.atan2(10, 30) * 180 / Math.PI) && !h.live[1].hide, 'the boxes show the length and angle as drawn', h.live);
    tool.move(snap(30, 0, { h: true }));
    a(h.live[1].hide, 'the angle box hides while the line snaps level');
    h.texts = ['50', '30'];
    const s = tool.constrain(snap(10, 40));
    a(near(s.pt[0], 50 * Math.cos(Math.PI / 6)) && near(s.pt[1], 25), 'typed length and angle place the end', s.pt);
    tool.click(s);
    a(dims(h.sk).join() === 'distance,axisangle', 'the line keeps its length and its angle to the X axis', dims(h.sk));
    const angle = h.sk.constraints.filter(c => c.type === 'axisangle')[0];
    a(near(angle.value, Math.PI / 6) && near(M.measure(h.sk, angle), Math.PI / 6), 'the angle is stored in radians and measured back', angle.value);
    // The solver holds the angle when the line is pulled elsewhere
    const line = h.sk.geometry.filter(g => g.type === 'line')[0];
    const end = M.find(h.sk, line.p2);
    end.x += 7;
    end.y -= 3;
    const r = solver.solve(h.sk);
    a(r.ok && near(M.measure(h.sk, angle), Math.PI / 6, 1e-6) && near(M.measure(h.sk, h.sk.constraints.filter(c => c.type === 'distance')[0]), 50, 1e-6), 'the solver keeps 50 mm at 30 degrees', r);
}

/* ---- a typed level or upright angle is a constraint, not a dimension ---- */
{
    const h = harness();
    const tool = TOOLS.line(h.ctx);
    tool.click(snap(0, 0));
    h.texts = ['', '90'];
    const s = tool.constrain(snap(3, 20));
    a(s.v && near(s.pt[0], 0) && near(s.pt[1], 20), 'a typed 90 degrees is upright, the length from the pointer', s);
    tool.click(s);
    a(h.sk.constraints.some(c => c.type === 'vertical') && !dims(h.sk).length, 'kept as Vertical, no angle dimension', h.sk.constraints.map(c => c.type));
}

/* ---- a slot: centre line length and angle, then the diameter ---- */
{
    const h = harness();
    const tool = TOOLS.slot(h.ctx);
    tool.click(snap(0, 0));
    a(tool.anchor()[0] === 0 && h.fields.length === 2, 'the centre line has length and angle boxes and snaps level / upright from its start');
    h.texts = ['40', '15'];
    tool.click(tool.constrain(snap(30, 5)));
    a(h.fields.length === 1 && h.fields[0].label === 'Diameter', 'then a diameter box');
    tool.move(snap(40, 20));
    a(h.live.length === 1 && h.live[0].value > 0, 'it shows the diameter as drawn', h.live);
    h.texts = ['10'];
    tool.click(tool.constrain(snap(20, 30)));
    const kinds = dims(h.sk).sort().join();
    a(kinds === 'axisangle,diameter,distance', 'the slot keeps its length, angle and diameter', kinds);
    const arcs = h.sk.geometry.filter(g => g.type === 'arc');
    const c1 = M.point(h.sk, arcs[0].c);
    const c2 = M.point(h.sk, arcs[1].c);
    a(near(Math.hypot(c2[0] - c1[0], c2[1] - c1[1]), 40, 1e-6) && near(Math.atan2(c2[1] - c1[1], c2[0] - c1[0]), 15 * Math.PI / 180, 1e-6) && near(M.curve(h.sk, arcs[1].id).r, 5, 1e-6), 'solved: 40 long at 15 degrees, ends 10 across');
}

/* ---- a level slot gets Horizontal ---- */
{
    const h = harness();
    const tool = TOOLS.slot(h.ctx);
    tool.click(snap(0, 0));
    tool.click(snap(30, 0, { h: true }));
    tool.click(snap(30, 4));
    a(h.sk.constraints.some(c => c.type === 'horizontal' && c.a && c.b), 'a slot drawn level keeps its centres level');
}

/* ---- Dimension mode: a click on a dimension edits it ---- */
{
    const h = harness();
    const tool = TOOLS.dimension(h.ctx);
    tool.click(snap(0, 0, { hit: { kind: 'dim', id: 'k7' } }));
    a(h.edited === 'k7', 'clicking a dimension value in Dimension mode opens its editor');
}

console.log(failed ? failed + ' failed' : 'sketch-input: all passed');
process.exitCode = failed ? 1 : 0;
