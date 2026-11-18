/*
    3D Modeler - looking at a face at an angle

    When a sketch is finished (also when Extrude or another feature command
    finishes it), the view turns to the face it was drawn on: from the front
    of the face, leaning off its normal, so a solid built out of it (an
    extrusion) shows its depth instead of being seen edge on or from behind.

    faceView(normal) -> { dir, up }
        normal  the face's outward normal (a sketch frame's n), any length
        dir     unit vector from the model towards the camera: the normal
                leaned FACE_TILT degrees towards the side the home view
                looks from (front right, above), so views stay familiar
        up      world Z, or world Y when the view looks almost straight
                down or up (as lookAlong in viewport.js)

    Plain arrays and no three.js, so the tests run it under Node.
*/

// The home view: from the front right, above (world Z is up)
export const HOME_VIEW = [1, -1, 1];

// Degrees the face view leans off the face's normal
export const FACE_TILT = 40;

function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function unit(v) {
    const len = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / len, v[1] / len, v[2] / len];
}

// v with its part along the unit vector n taken away
function across(v, n) {
    const k = dot(v, n);
    return [v[0] - k * n[0], v[1] - k * n[1], v[2] - k * n[2]];
}

export function faceView(normal) {
    const n = unit(normal);
    // The way to lean: towards the home view's side, else towards world Z,
    // else X (each only when it does not run along the normal)
    let side = across(unit(HOME_VIEW), n);
    if (Math.hypot(side[0], side[1], side[2]) < 1e-3) {
        side = across([0, 0, 1], n);
    }
    if (Math.hypot(side[0], side[1], side[2]) < 1e-3) {
        side = across([1, 0, 0], n);
    }
    side = unit(side);
    const t = FACE_TILT * Math.PI / 180;
    const dir = unit([
        n[0] * Math.cos(t) + side[0] * Math.sin(t),
        n[1] * Math.cos(t) + side[1] * Math.sin(t),
        n[2] * Math.cos(t) + side[2] * Math.sin(t)
    ]);
    const up = Math.abs(dir[2]) > 0.99 ? [0, dir[2] > 0 ? 1 : -1, 0] : [0, 0, 1];
    return { dir: dir, up: up };
}
