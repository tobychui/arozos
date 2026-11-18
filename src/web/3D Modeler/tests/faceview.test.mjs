// The view a finished sketch turns to: in front of the face, leaning
// FACE_TILT degrees off its normal towards the home view's side
import { faceView, FACE_TILT, HOME_VIEW } from '../js/faceview.js';
let failed = 0;
const a = (c, m, x) => { if (!c) { failed++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } };
const near = (x, y) => Math.abs(x - y) < 1e-9;
const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const unit = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const tilt = Math.cos(FACE_TILT * Math.PI / 180);

const normals = [[0, 0, 1], [0, 0, -1], [0, -1, 0], [0, 1, 0], [1, 0, 0], [-1, 0, 0], HOME_VIEW, HOME_VIEW.map((x) => -x), [0.3, -2, 0.7], [0, 0, 5]];
for (const normal of normals) {
    const n = unit(normal);
    const v = faceView(normal);
    a(near(Math.hypot(v.dir[0], v.dir[1], v.dir[2]), 1), 'a unit direction for ' + normal, v);
    a(near(dot(v.dir, n), tilt), 'in front of the face, ' + FACE_TILT + ' degrees off its normal, for ' + normal, [v.dir, dot(v.dir, n)]);
    a(Math.abs(dot(v.dir, v.up)) < 0.99, 'an up that is not along the view for ' + normal, v);
}

// A sketch on the XY plane (or a top face) is seen from above, front right, as the home view
const top = faceView([0, 0, 1]).dir;
a(top[0] > 0 && top[1] < 0 && near(top[0], -top[1]) && top[2] > 0, 'top face: from the front right, above', top);
// A bottom face is seen from below, still from the front right, world Z still up
const bottom = faceView([0, 0, -1]);
a(bottom.dir[2] < 0 && bottom.dir[0] > 0 && bottom.dir[1] < 0 && bottom.up[2] === 1, 'bottom face: from below, Z up', bottom);
// A front face (XZ plane, normal -Y) is seen from the front, a little right and above
const front = faceView([0, -1, 0]).dir;
a(front[1] < 0 && front[0] > 0 && front[2] > 0, 'front face: from the front, right and above', front);
// A back face is seen from behind, not through the model
a(faceView([0, 1, 0]).dir[1] > 0, 'back face: from behind');

console.log(failed ? failed + ' FAILED' : 'all face view tests passed');
process.exitCode = failed ? 1 : 0;
