/*
    3D Modeler - polygon triangulation

    Ear clipping of one polygon with holes, in a plane: the last resort of the
    mesher (heal.js fallbackTriangles) when OpenCascade gives up on a face.
    The face's boundary is followed in its (u, v) surface space and cut into
    triangles here. Slow (n squared) but only used for the odd face.

    Pure functions, no kernel: tested under Node (tests/repair.test.mjs).
*/

function area(loop) {
    let a = 0;
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
        a += (loop[j][0] - loop[i][0]) * (loop[j][1] + loop[i][1]);
    }
    return a / 2; // positive when counter clockwise
}

function cross(a, b, c) {
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function inTriangle(p, a, b, c) {
    return cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
}

function same(p, q) {
    return p[0] === q[0] && p[1] === q[1];
}

// Points that repeat the one before them are dropped (closing point included)
function tidy(loop) {
    const out = [];
    loop.forEach(function (p) {
        if (!out.length || !same(out[out.length - 1], p)) {
            out.push(p);
        }
    });
    while (out.length > 1 && same(out[0], out[out.length - 1])) {
        out.pop();
    }
    return out;
}

// Join a hole (clockwise) into the outline (counter clockwise) through a
// bridge from the hole's right-most point to a vertex of the outline it can
// see (Eberly, "Triangulation by ear clipping", section 3)
function bridge(outline, hole) {
    let m = 0;
    hole.forEach(function (p, i) {
        if (p[0] > hole[m][0]) {
            m = i;
        }
    });
    const M = hole[m];
    // nearest crossing of the ray from M towards +u with an outline edge
    let best = Infinity;
    let at = -1;
    for (let i = 0; i < outline.length; i++) {
        const a = outline[i];
        const b = outline[(i + 1) % outline.length];
        if (Math.min(a[1], b[1]) > M[1] || Math.max(a[1], b[1]) < M[1] || a[1] === b[1]) {
            continue;
        }
        const t = (M[1] - a[1]) / (b[1] - a[1]);
        if (t < 0 || t > 1) {
            continue;
        }
        const x = a[0] + t * (b[0] - a[0]);
        if (x >= M[0] && x - M[0] < best) {
            best = x - M[0];
            at = a[0] > b[0] ? i : (i + 1) % outline.length;
        }
    }
    if (at < 0) {
        // no crossing (a hole that pokes outside): the nearest vertex
        let d = Infinity;
        outline.forEach(function (p, i) {
            const e = Math.hypot(p[0] - M[0], p[1] - M[1]);
            if (e < d) {
                d = e;
                at = i;
            }
        });
    } else {
        // a reflex vertex inside the triangle M, crossing, candidate blocks
        // the view: take the one closest in angle to the ray instead
        const P = outline[at];
        const I = [M[0] + best, M[1]];
        let angle = Infinity;
        for (let i = 0; i < outline.length; i++) {
            const q = outline[i];
            const prev = outline[(i + outline.length - 1) % outline.length];
            const next = outline[(i + 1) % outline.length];
            if (i === at || cross(prev, q, next) >= 0) {
                continue;
            }
            const tri = cross(M, I, P) >= 0 ? inTriangle(q, M, I, P) : inTriangle(q, M, P, I);
            if (tri) {
                const a = Math.abs(Math.atan2(q[1] - M[1], q[0] - M[0]));
                if (a < angle) {
                    angle = a;
                    at = i;
                }
            }
        }
    }
    const joined = outline.slice(0, at + 1);
    for (let k = 0; k <= hole.length; k++) {
        joined.push(hole[(m + k) % hole.length]);
    }
    joined.push(outline[at]);
    return joined.concat(outline.slice(at + 1));
}

// Triangles of a polygon with holes: `outer` and each hole are lists of
// [x, y]. Returns { points: [[x, y]], tris: [a, b, c, ...] } with counter
// clockwise triangles. Holes that fall outside or touch are tolerated: the
// result may then be imperfect, never endless.
export function triangulate(outer, holes) {
    let outline = tidy(outer);
    if (outline.length < 3) {
        return { points: [], tris: [] };
    }
    if (area(outline) < 0) {
        outline.reverse();
    }
    (holes || []).map(tidy).filter(function (h) {
        return h.length >= 3;
    }).map(function (h) {
        return area(h) > 0 ? h.slice().reverse() : h;
    }).sort(function (a, b) {
        return Math.max.apply(null, b.map(function (p) {
            return p[0];
        })) - Math.max.apply(null, a.map(function (p) {
            return p[0];
        }));
    }).forEach(function (h) {
        outline = bridge(outline, h);
    });

    const points = outline;
    const index = points.map(function (p, i) {
        return i;
    });
    const tris = [];
    let guard = index.length * index.length + 10;
    while (index.length > 3 && guard-- > 0) {
        let clipped = false;
        for (let i = 0; i < index.length; i++) {
            const ia = index[(i + index.length - 1) % index.length];
            const ib = index[i];
            const ic = index[(i + 1) % index.length];
            const a = points[ia];
            const b = points[ib];
            const c = points[ic];
            if (cross(a, b, c) <= 0) {
                continue; // reflex or flat
            }
            let blocked = false;
            for (let k = 0; k < index.length && !blocked; k++) {
                const ip = index[k];
                if (ip === ia || ip === ib || ip === ic) {
                    continue;
                }
                const p = points[ip];
                if (same(p, a) || same(p, b) || same(p, c)) {
                    continue; // the two ends of a bridge
                }
                blocked = inTriangle(p, a, b, c);
            }
            if (!blocked) {
                tris.push(ia, ib, ic);
                index.splice(i, 1);
                clipped = true;
                break;
            }
        }
        if (!clipped) {
            // Nothing is an ear (rounding, or a hole across the outline):
            // drop the flattest corner so the loop always ends
            let flat = 0;
            let smallest = Infinity;
            for (let i = 0; i < index.length; i++) {
                const a = points[index[(i + index.length - 1) % index.length]];
                const b = points[index[i]];
                const c = points[index[(i + 1) % index.length]];
                const s = Math.abs(cross(a, b, c));
                if (s < smallest) {
                    smallest = s;
                    flat = i;
                }
            }
            const ia = index[(flat + index.length - 1) % index.length];
            const ic = index[(flat + 1) % index.length];
            if (cross(points[ia], points[index[flat]], points[ic]) > 0) {
                tris.push(ia, index[flat], ic);
            }
            index.splice(flat, 1);
        }
    }
    if (index.length === 3 && cross(points[index[0]], points[index[1]], points[index[2]]) > 0) {
        tris.push(index[0], index[1], index[2]);
    }
    return { points: points, tris: tris };
}

export { area as signedArea };
