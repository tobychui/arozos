/*
    Parameters, "fx" (PROPOSAL.md 14.9, built in 14.28).
    Run with: node tests/run.mjs a8
*/

import init from '../lib/occt/replicad_single.js';
import { evaluate, namesIn, setScope } from '../js/expr.js';
import { evaluateParameters, applyParameters, nameProblem, normalizeParameters, dimensionValue, keptFormula } from '../js/parameters.js';
import { validate } from '../js/document/document.js';
import * as M from '../js/sketch/model.js';
import { createSolver } from '../js/sketch/solver.js';
import { createRebuilder } from '../js/kernel/rebuild.js';

let failed = 0;
const a = (c, m, x) => {
    if (!c) {
        failed++;
        console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x));
    }
};
const near = (x, y, t) => Math.abs(x - y) < (t || 1e-6);

// ---- formulas with names ----
a(evaluate('wall * 2', { wall: 3 }) === 6 && evaluate('WALL+1', { wall: 3 }) === 4, 'names in a formula, any case');
a(isNaN(evaluate('wall * 2', {})), 'an unknown name is not a number');
a(JSON.stringify(namesIn('sqrt(width) + pi * r_2 - sin(30)')) === '["width","r_2"]', 'names used, functions and pi left out', namesIn('sqrt(width) + pi * r_2 - sin(30)'));
setScope({ Gap: 0.4 });
a(near(evaluate('gap*5'), 2), 'the open part\'s parameters are the default scope');
setScope({});
a(isNaN(evaluate('gap*5')), 'and only while they are set');
a(keptFormula('wall*2') === 'wall*2' && keptFormula('35/2') === null && keptFormula(' 12 ') === null, 'only formulas with a name are kept');

// ---- the table ----
const params = [
    { name: 'height', expr: 'width / 2' },
    { name: 'width', expr: '40' },
    { name: 'wall', expr: 'height * 0.1 + 1' }
];
let r = evaluateParameters(params);
a(r.values.width === 40 && r.values.height === 20 && near(r.values.wall, 3) && !Object.keys(r.errors).length, 'worked out in dependency order', r);
r = evaluateParameters([{ name: 'a', expr: 'b + 1' }, { name: 'b', expr: 'a * 2' }, { name: 'c', expr: '5' }]);
a(/loop/.test(r.errors.a || '') && /loop/.test(r.errors.b || '') && r.values.c === 5, 'a loop is an error on its parameters, the rest still work', r);
r = evaluateParameters([{ name: 'a', expr: 'zz + 1' }, { name: 'b', expr: 'a * 2' }]);
a(/not a parameter/.test(r.errors.a || '') && /has an error/.test(r.errors.b || ''), 'an unknown name, and what uses it', r.errors);
r = evaluateParameters([{ name: 'a', expr: '' }]);
a(/Enter a value/.test(r.errors.a || ''), 'an empty equation', r.errors);
a(nameProblem('2wide', []) && nameProblem('pi', []) && nameProblem('Wall', ['wall']) && !nameProblem('wall_2', ['wall']), 'names: start with a letter, not a formula word, unique');
a(normalizeParameters([{ name: 'ok', expr: 3 }, { name: 'bad name' }, { name: 'OK', expr: '1' }, null]).length === 1, 'stored parameters are cleaned');
const opened = validate({ format: 'aopart', version: 1, features: [], parameters: params });
a(opened.parameters && opened.parameters.length === 3 && opened.parameters[0].expr === 'width / 2', 'a part file keeps its parameters', opened.parameters);

// ---- dimension values ----
a(dimensionValue({ type: 'distance', value: 10 }, 12) === 12, 'a length');
a(dimensionValue({ type: 'distance', value: -10 }, 12) === -12, 'a length keeps its side');
a(near(dimensionValue({ type: 'angle', value: 1 }, 90), Math.PI / 2), 'an angle in degrees');
a(near(dimensionValue({ type: 'axisangle', value: 0.1 }, -30), -Math.PI / 6), 'an angle to the X axis with its sign');
a(isNaN(dimensionValue({ type: 'radius', value: 3 }, 0)), 'a size of zero does not fit');
a(isNaN(dimensionValue({ type: 'distance', value: 3 }, 0)), 'two points cannot be 0 apart (that is Coincident)');
a(isNaN(dimensionValue({ type: 'angle', value: 1 }, 0)), 'an angle of zero does not fit');
a(dimensionValue({ type: 'pldistance', value: 3 }, 0) === 0, 'a point to line distance of 0 puts the point on the line');
a(dimensionValue({ type: 'hdistance', value: -3 }, 0) === 0 && dimensionValue({ type: 'vdistance', value: 3 }, 0) === 0, 'an X or Y distance of 0 lines the points up');
a(isNaN(dimensionValue({ type: 'pldistance', value: 3 }, -1)), 'a negative distance still does not fit');

// ---- a part that follows its parameters ----
// A rectangle 40 wide (dimension "width"), 20 high (dimension "width / 2"),
// extruded "depth"
const sk = { id: 's1', type: 'sketch', name: 'Sketch1', plane: { ref: 'origin:xy' }, geometry: [], constraints: [] };
const pts = [[0, 0], [40, 0], [40, 20], [0, 20]].map(c => M.addPoint(sk, c[0], c[1]));
const ls = [0, 1, 2, 3].map(i => M.addLine(sk, pts[i], pts[(i + 1) % 4]));
['horizontal', 'vertical', 'horizontal', 'vertical'].forEach((t, i) => M.addConstraint(sk, { type: t, line: ls[i] }));
M.addConstraint(sk, { type: 'coincident', a: pts[0], b: M.ORIGIN });
const wid = M.addConstraint(sk, { type: 'hdistance', a: pts[0], b: pts[1], value: 40 });
const hei = M.addConstraint(sk, { type: 'vdistance', a: pts[1], b: pts[2], value: 20 });
const find = id => sk.constraints.find(c => c.id === id);
find(wid).expr = 'width';
find(hei).expr = 'width / 2';
const data = {
    format: 'aopart', version: 1, units: 'mm',
    parameters: [{ name: 'width', expr: '60' }, { name: 'depth', expr: 'width / 10' }],
    features: [sk, { id: 'e1', type: 'extrude', name: 'Extrusion1', sketch: 's1', regions: [[5, 5]], operation: 'join',
        extent: { type: 'distance', value: 10, direction: 'positive', expr: 'depth' } }]
};
const solver = await createSolver();
a(solver.solve(sk).ok, 'the sketch solves as drawn');
const out = applyParameters(data);
a(JSON.stringify(out.sketches) === '["s1"]' && !out.problems.length, 'the sketch with changed dimensions is listed', out);
a(find(wid).value === 60 && find(hei).value === 30 && data.features[1].extent.value === 6, 'dimensions and the distance follow', [find(wid).value, find(hei).value, data.features[1].extent.value]);
a(solver.solve(sk).ok, 'the sketch solves with the new sizes');
a(near(M.point(sk, pts[2])[0], 60) && near(M.point(sk, pts[2])[1], 30), 'the corner moved to 60 x 30', M.point(sk, pts[2]));
const oc = await init();
const built = createRebuilder(oc).rebuild(data);
a(built.features.e1.status === 'ok' && near(built.bodies[0].volume, 60 * 30 * 6, 1e-3), 'the solid is 60 x 30 x 6', built.bodies[0] && built.bodies[0].volume);
// a parameter that gives an impossible size is reported, nothing changes
data.parameters[0].expr = '-5';
const bad = applyParameters(data);
a(bad.problems.length === 3 && find(wid).value === 60, 'sizes that do not fit are reported and kept', bad.problems);

console.log(failed ? failed + ' checks failed' : 'a8: all checks passed');
process.exitCode = failed ? 1 : 0;
