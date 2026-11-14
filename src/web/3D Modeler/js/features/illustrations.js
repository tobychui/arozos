/*
    3D Modeler - the scenes of the illustration card

    Small animated pictures of what a choice in a panel does (the type of
    an assembly constraint, the Boolean of an extrusion or a revolution),
    drawn by illustrate.js beside the panel. A scene is
        { title, text, frame(t) }
    where frame(t), t from 0 (before) to 1 (after, already eased), returns
        { faces: [face], lines: [line], arrows: [arrow], labels: [label] }
    in model units, Z up:
        face   { p: [[x, y, z], ...], n: [x, y, z], color, alpha, stroke, bias }
        line   { a, b, color, dash, width }
        arrow  { from, dir, len, color }
        label  { at, text }
    The renderer projects them isometrically and sorts the faces back to
    front, so scenes are kept to a few convex shapes that do not cross.

    Colours are names (COLORS): grey is the part that stays, orange the
    one that moves, blue what the user picks, red a cut, green a join.
*/

export const COLORS = {
    grey: [186, 190, 198],
    orange: [214, 146, 78],
    blue: [104, 160, 245],
    ink: [29, 78, 216],
    red: [214, 69, 69],
    green: [76, 175, 109],
    teal: [64, 170, 190],
    dark: [44, 48, 56]
};

/* ================= shapes ================= */
const FACES = {
    '+x': [[1, 2, 6, 5], [1, 0, 0]],
    '-x': [[0, 4, 7, 3], [-1, 0, 0]],
    '+y': [[3, 7, 6, 2], [0, 1, 0]],
    '-y': [[0, 1, 5, 4], [0, -1, 0]],
    '+z': [[4, 5, 6, 7], [0, 0, 1]],
    '-z': [[0, 3, 2, 1], [0, 0, -1]]
};

// A box from corner `a` to corner `b`. look: { color, alpha, hi: { '+z': true, ... } }
export function box(a, b, look) {
    const l = look || {};
    const v = [
        [a[0], a[1], a[2]], [b[0], a[1], a[2]], [b[0], b[1], a[2]], [a[0], b[1], a[2]],
        [a[0], a[1], b[2]], [b[0], a[1], b[2]], [b[0], b[1], b[2]], [a[0], b[1], b[2]]
    ];
    return Object.keys(FACES).map(function (key) {
        const f = FACES[key];
        return {
            p: f[0].map(function (i) {
                return v[i].slice();
            }),
            n: f[1].slice(),
            color: l.hi && l.hi[key] ? 'blue' : l.color || 'grey',
            alpha: l.alpha === undefined ? 1 : l.alpha,
            key: key
        };
    });
}

// The two directions across an axis
function across(axis) {
    return axis === 'x' ? [[0, 1, 0], [0, 0, 1]] : axis === 'y' ? [[0, 0, 1], [1, 0, 0]] : [[1, 0, 0], [0, 1, 0]];
}

function along(axis) {
    return axis === 'x' ? [1, 0, 0] : axis === 'y' ? [0, 1, 0] : [0, 0, 1];
}

function add(p, v, k) {
    return [p[0] + v[0] * k, p[1] + v[1] * k, p[2] + v[2] * k];
}

// Points of a circle of radius r about centre c, across `axis`
export function circle(c, axis, r, n) {
    const uv = across(axis);
    const out = [];
    const count = n || 28;
    for (let i = 0; i < count; i++) {
        const t = i / count * 2 * Math.PI;
        out.push(add(add(c, uv[0], r * Math.cos(t)), uv[1], r * Math.sin(t)));
    }
    return out;
}

// A cylinder standing on centre `c` along `axis` ('x' | 'y' | 'z'), radius
// r, length h. look: { color, alpha, hi: { side, top, bottom } }
export function cylinder(c, axis, r, h, look) {
    const l = look || {};
    const d = along(axis);
    const uv = across(axis);
    const n = 28;
    const faces = [];
    const top = add(c, d, h);
    const ring0 = circle(c, axis, r, n);
    const ring1 = circle(top, axis, r, n);
    const side = l.hi && l.hi.side ? 'blue' : l.color || 'grey';
    const normalOf = function (i) {
        const mid = (i + 0.5) / n * 2 * Math.PI;
        return add(add([0, 0, 0], uv[0], Math.cos(mid)), uv[1], Math.sin(mid));
    };
    // The view is fixed, so the outline of the round side is known here:
    // the long edges where a quad facing the viewer meets one facing away
    const seen = function (i) {
        const m = normalOf((i + n) % n);
        return m[0] + m[1] + m[2] > 0;
    };
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const outline = [];
        if (seen(i) && !seen(i - 1)) {
            outline.push([ring0[i], ring1[i]]);
        }
        if (seen(i) && !seen(i + 1)) {
            outline.push([ring0[j], ring1[j]]);
        }
        faces.push({
            p: [ring0[i], ring0[j], ring1[j], ring1[i]],
            n: normalOf(i),
            color: side, alpha: l.alpha === undefined ? 1 : l.alpha, stroke: false, outline: outline
        });
    }
    faces.push({ p: ring1.slice(), n: d.slice(), color: l.hi && l.hi.top ? 'blue' : l.color || 'grey', alpha: l.alpha === undefined ? 1 : l.alpha });
    faces.push({ p: ring0.slice().reverse(), n: d.map(function (x) {
        return -x;
    }), color: l.hi && l.hi.bottom ? 'blue' : l.color || 'grey', alpha: l.alpha === undefined ? 1 : l.alpha });
    return faces;
}

// A flat patch lying on a face (a hole's opening, a sketch profile): drawn
// just after the face under it
export function decal(points, n, color, alpha) {
    return { p: points, n: n, color: color, alpha: alpha === undefined ? 1 : alpha, bias: 0.05, stroke: false };
}

// Draw these faces after the others (the part that moves sits on or in
// front of the other, which sorting single faces by depth gets wrong for a
// large face under a small part)
export function layer(faces, n) {
    return faces.map(function (f) {
        return Object.assign({}, f, { bias: (f.bias || 0) + 1000 * (n === undefined ? 1 : n) });
    });
}

// Move faces by v
export function moved(faces, v) {
    const move = function (p) {
        return add(p, v, 1);
    };
    return faces.map(function (f) {
        return Object.assign({}, f, { p: f.p.map(move), outline: f.outline && f.outline.map(function (seg) {
            return seg.map(move);
        }) });
    });
}

// Turn faces by `angle` radians about the line through `pivot` along Y
export function turnedY(faces, pivot, angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const turn = function (p) {
        const x = p[0] - pivot[0];
        const z = p[2] - pivot[2];
        return [pivot[0] + x * c + z * s, p[1], pivot[2] - x * s + z * c];
    };
    return faces.map(function (f) {
        return Object.assign({}, f, { p: f.p.map(turn), n: [f.n[0] * c + f.n[2] * s, f.n[1], -f.n[0] * s + f.n[2] * c], outline: f.outline && f.outline.map(function (seg) {
            return seg.map(turn);
        }) });
    });
}

// Keep the part of faces above height z (a pin going into a hole):
// polygons are clipped against the plane
export function above(faces, z) {
    const out = [];
    faces.forEach(function (f) {
        const pts = [];
        for (let i = 0; i < f.p.length; i++) {
            const a = f.p[i];
            const b = f.p[(i + 1) % f.p.length];
            const ina = a[2] >= z;
            const inb = b[2] >= z;
            if (ina) {
                pts.push(a);
            }
            if (ina !== inb) {
                const t = (z - a[2]) / (b[2] - a[2]);
                pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, z]);
            }
        }
        if (pts.length >= 3) {
            // Outline edges are cut at the same height
            const outline = (f.outline || []).map(function (seg) {
                const lo = seg[0][2] <= seg[1][2] ? seg[0] : seg[1];
                const hi = lo === seg[0] ? seg[1] : seg[0];
                if (hi[2] <= z) {
                    return null;
                }
                if (lo[2] >= z) {
                    return seg;
                }
                const t = (z - lo[2]) / (hi[2] - lo[2]);
                return [[lo[0] + (hi[0] - lo[0]) * t, lo[1] + (hi[1] - lo[1]) * t, z], hi];
            }).filter(Boolean);
            out.push(Object.assign({}, f, { p: pts, outline: outline }));
        }
    });
    return out;
}

// A closed loop of points as line segments
export function loop(points, style) {
    return points.map(function (p, i) {
        return Object.assign({ a: p, b: points[(i + 1) % points.length] }, style || {});
    });
}

// A dashed outline of a face that cannot be seen from here (it points
// away), so the user still sees where it is
export function hiddenOutline(face, color) {
    return loop(face.p, { color: color || 'ink', dash: true, width: 1.2 });
}

function faceOf(faces, key) {
    return faces.filter(function (f) {
        return f.key === key;
    })[0];
}

function centre(points) {
    const c = [0, 0, 0];
    points.forEach(function (p) {
        c[0] += p[0] / points.length;
        c[1] += p[1] / points.length;
        c[2] += p[2] / points.length;
    });
    return c;
}

function mix(a, b, t) {
    return a + (b - a) * t;
}

/* ================= scenes ================= */
export const SCENES = {
    'constraint.mate': {
        title: 'Mate',
        text: 'The two faces meet, pointing at each other: the moving part sits against the other one. An offset leaves a gap.',
        frame: function (t) {
            const a = box([0, 0, 0], [34, 30, 14], { hi: { '+z': true } });
            const b = layer(moved(box([0, 0, 0], [24, 20, 12], { color: 'orange' }), [6, 5, mix(36, 14, t)]));
            const under = faceOf(b, '-z');
            const top = faceOf(a, '+z');
            return {
                faces: a.concat(b),
                lines: hiddenOutline(under),
                // Pointing at each other while apart; gone once they meet
                arrows: t > 0.95 ? [] : [
                    { from: centre(top.p), dir: [0, 0, 1], len: 9, color: 'ink' },
                    { from: centre(under.p), dir: [0, 0, -1], len: 9, color: 'ink' }
                ]
            };
        }
    },
    'constraint.flush': {
        title: 'Flush',
        text: 'The two faces line up side by side, pointing the same way. An offset moves one past the other.',
        frame: function (t) {
            const a = box([0, 0, 0], [28, 30, 18], { hi: { '+z': true } });
            const b = layer(moved(box([0, 0, 0], [22, 24, 14], { color: 'orange', hi: { '+z': true } }), [32, 3, mix(-14, 4, t)]));
            return {
                faces: a.concat(b),
                // Once flush, one line runs along both faces
                lines: t > 0.98 ? [{ a: [0, 30, 18], b: [56, 30, 18], color: 'ink', dash: true, width: 1 }] : [],
                arrows: [
                    { from: centre(faceOf(a, '+z').p), dir: [0, 0, 1], len: 9, color: 'ink' },
                    { from: centre(faceOf(b, '+z').p), dir: [0, 0, 1], len: 9, color: 'ink' }
                ]
            };
        }
    },
    'constraint.angle': {
        title: 'Angle',
        text: 'The two faces (or axes) keep the angle you enter between them; the moving part turns about where they meet.',
        frame: function (t) {
            const a = box([0, 0, 0], [40, 28, 4], { hi: { '+z': true } });
            const angle = mix(0, 55, t) * Math.PI / 180;
            const b = layer(turnedY(moved(box([0, 0, 0], [40, 28, 3], { color: 'orange', hi: { '+z': true } }), [0, 0, 4.2]), [40, 0, 4.2], angle));
            const arc = [];
            for (let i = 0; i <= 16; i++) {
                const k = i / 16 * angle;
                arc.push([40 - 18 * Math.cos(k), 28, 4.2 + 18 * Math.sin(k)]);
            }
            const lines = arc.slice(1).map(function (p, i) {
                return { a: arc[i], b: p, color: 'ink', width: 1.4 };
            });
            const half = angle / 2;
            return {
                faces: a.concat(b),
                lines: lines,
                labels: t > 0.05 ? [{ at: [40 - 24 * Math.cos(half), 28, 4.2 + 24 * Math.sin(half)], text: Math.round(mix(0, 55, t)) + '°' }] : []
            };
        }
    },
    'constraint.tangent': {
        title: 'Tangent',
        text: 'A round face touches a flat or another round face along a line, as a roller rests on a plate.',
        frame: function (t) {
            const a = box([0, 0, 0], [46, 30, 4], { hi: { '+z': true } });
            const z = mix(30, 13, t);
            const b = layer(cylinder([18, 2, z], 'y', 9, 26, { color: 'orange', hi: { side: true } }));
            return {
                faces: a.concat(b),
                lines: t > 0.98 ? [{ a: [18, 2, 4], b: [18, 28, 4], color: 'ink', width: 2 }] : []
            };
        }
    },
    'constraint.insert': {
        title: 'Insert',
        text: 'A round edge goes onto another: the two axes line up and the faces meet, as a bolt goes into a hole.',
        frame: function (t) {
            const top = 14;
            const a = box([0, 0, 0], [40, 32, top]);
            const hole = [20, 16, top];
            const opening = decal(circle(hole, 'z', 5.2), [0, 0, 1], 'dark');
            const over = Math.min(1, t * 2);
            const down = Math.max(0, t * 2 - 1);
            const x = mix(36, 20, over);
            const zHead = mix(top + 26, top, down);
            const shank = layer(above(cylinder([x, 16, zHead - 16], 'z', 4.6, 16, { color: 'orange' }), top));
            const head = layer(cylinder([x, 16, zHead], 'z', 8, 4.5, { color: 'orange' }), 2);
            const rim = loop(circle(hole, 'z', 5.2), { color: 'ink', width: 1.6 });
            const headRim = loop(circle([x, 16, zHead], 'z', 8), { color: 'ink', width: 1.6 });
            return {
                faces: a.concat([opening], shank, head),
                lines: rim.concat(headRim, [{ a: [20, 16, top - 6], b: [20, 16, top + 36], color: 'ink', dash: true, width: 0.9 }])
            };
        }
    },

    // The Boolean of an extrusion or a revolution
    'operation.join': {
        title: 'Join',
        text: 'The new shape is added to the solid it touches: one solid comes out.',
        frame: function (t) {
            const a = box([0, 0, 0], [40, 30, 10]);
            const h = Math.max(0.01, mix(0, 16, t));
            const color = t > 0.98 ? 'grey' : 'green';
            const tool = layer(cylinder([26, 15, 10], 'z', 8, h, { color: color, alpha: t > 0.98 ? 1 : 0.8 }));
            return {
                faces: a.concat(tool),
                lines: loop(circle([26, 15, 10], 'z', 8), { color: 'green', width: 1.2 })
            };
        }
    },
    'operation.cut': {
        title: 'Cut',
        text: 'The new shape is taken away from the solid: a hole or a pocket is left.',
        frame: function (t) {
            const top = 14;
            const a = box([0, 0, 0], [40, 30, top]);
            const zBase = mix(top + 4, top - 18, t);
            const tool = layer(above(cylinder([24, 15, zBase], 'z', 7, 18, { color: 'red', alpha: mix(0.75, 0.25, t) }), top));
            const opening = decal(circle([24, 15, top], 'z', 7), [0, 0, 1], 'dark', Math.max(0, Math.min(1, (top - zBase) / 18)));
            return {
                faces: a.concat([opening], tool),
                lines: loop(circle([24, 15, top], 'z', 7), { color: 'red', width: 1.2 })
            };
        }
    },
    'operation.intersect': {
        title: 'Intersect',
        text: 'Only what the solid and the new shape have in common is kept; the rest of both goes.',
        frame: function (t) {
            const keep = box([14, 0, 0], [28, 30, 10]);
            const left = box([0, 0, 0], [14, 30, 10], { alpha: mix(1, 0, t) });
            const right = box([28, 0, 0], [40, 30, 10], { alpha: mix(1, 0, t) });
            const tool = layer(box([14, -8, -4], [28, 38, 20], { color: 'red', alpha: mix(0.35, 0, t) }));
            return {
                faces: left.concat(right, keep, tool).filter(function (f) {
                    return f.alpha > 0.02;
                })
            };
        }
    },
    'operation.new': {
        title: 'New Solid',
        text: 'The new shape becomes a solid of its own, apart from the others, even where they touch.',
        frame: function (t) {
            const a = box([0, 0, 0], [30, 30, 10]);
            const h = Math.max(0.01, mix(0, 18, t));
            const tool = layer(cylinder([42, 15, 0], 'z', 8, h, { color: 'teal' }));
            return {
                faces: a.concat(tool),
                lines: loop(circle([42, 15, 0], 'z', 8), { color: 'teal', width: 1.2 })
            };
        }
    }
};

/* ================= drawing a frame ================= */
// What illustrate.js shows: the card's drawing is W x H pixels
const W = 244;
const H = 150;
const VIEW = [1, 1, 1]; // the isometric view looks from here
const LIGHT = normalize([0.35, 0.15, 1]);

function normalize(v) {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
}

function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

// Isometric projection, Z up, screen Y down
export function project(p) {
    return [(p[0] - p[1]) * 0.866, (p[0] + p[1]) * 0.5 - p[2]];
}

function rgb(name, k, fallback) {
    const c = COLORS[name] || fallback || COLORS.grey;
    return 'rgb(' + c.map(function (v) {
        return Math.round(Math.min(255, v * k));
    }).join(',') + ')';
}

function fillOf(face) {
    if (face.color === 'dark') {
        return rgb('dark', 1);
    }
    const lit = Math.max(0, dot(normalize(face.n), LIGHT));
    return rgb(face.color, face.color === 'blue' ? 0.84 + 0.16 * lit : 0.62 + 0.38 * lit);
}

function pts(list) {
    return list.map(function (p) {
        const q = project(p);
        return q[0].toFixed(2) + ',' + q[1].toFixed(2);
    }).join(' ');
}

// The SVG of one frame of a scene; k is model units per pixel
export function renderFrame(out, k) {
    let svg = '';
    const faces = (out.faces || []).filter(function (f) {
        return f.alpha > 0.01 && f.p.length >= 3 && dot(f.n, VIEW) > 1e-6;
    }).map(function (f) {
        let depth = 0;
        f.p.forEach(function (p) {
            depth += (p[0] + p[1] + p[2]) / f.p.length;
        });
        return { f: f, depth: depth + (f.bias || 0) };
    });
    faces.sort(function (a, b) {
        return a.depth - b.depth;
    });
    faces.forEach(function (item) {
        const f = item.f;
        const fill = fillOf(f);
        const stroke = f.stroke === false ? (f.alpha < 1 ? 'none' : fill) : 'rgba(30,34,42,.6)';
        svg += '<polygon points="' + pts(f.p) + '" fill="' + fill + '"' + (f.alpha < 1 ? ' fill-opacity="' + f.alpha.toFixed(3) + '"' : '') +
            ' stroke="' + stroke + '" stroke-width="' + (f.stroke === false ? 0.6 : 0.9) + '" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>';
        (f.outline || []).forEach(function (seg) {
            const a = project(seg[0]);
            const b = project(seg[1]);
            svg += '<line x1="' + a[0].toFixed(2) + '" y1="' + a[1].toFixed(2) + '" x2="' + b[0].toFixed(2) + '" y2="' + b[1].toFixed(2) +
                '" stroke="rgba(30,34,42,.6)" stroke-width="0.9" vector-effect="non-scaling-stroke"/>';
        });
    });
    (out.lines || []).forEach(function (l) {
        const a = project(l.a);
        const b = project(l.b);
        svg += '<line x1="' + a[0].toFixed(2) + '" y1="' + a[1].toFixed(2) + '" x2="' + b[0].toFixed(2) + '" y2="' + b[1].toFixed(2) +
            '" stroke="' + rgb(l.color, 1) + '" stroke-width="' + (l.width || 1) + '" stroke-linecap="round"' +
            (l.dash ? ' stroke-dasharray="3 2.5"' : '') + ' vector-effect="non-scaling-stroke"/>';
    });
    (out.arrows || []).forEach(function (ar) {
        const a = project(ar.from);
        const tip = [ar.from[0] + ar.dir[0] * ar.len, ar.from[1] + ar.dir[1] * ar.len, ar.from[2] + ar.dir[2] * ar.len];
        const b = project(tip);
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const head = 5 * k;
        const wing = 3 * k;
        const color = rgb(ar.color, 1);
        const x2 = (b[0] - ux * head * 0.6).toFixed(2);
        const y2 = (b[1] - uy * head * 0.6).toFixed(2);
        // A halo in the card's colour keeps the arrow clear of the faces
        svg += '<line x1="' + a[0].toFixed(2) + '" y1="' + a[1].toFixed(2) + '" x2="' + x2 + '" y2="' + y2 +
            '" style="stroke: var(--panel-2)" stroke-width="4" stroke-linecap="round" vector-effect="non-scaling-stroke"/>';
        svg += '<line x1="' + a[0].toFixed(2) + '" y1="' + a[1].toFixed(2) + '" x2="' + x2 + '" y2="' + y2 +
            '" stroke="' + color + '" stroke-width="1.8" vector-effect="non-scaling-stroke"/>';
        svg += '<polygon points="' + [
            [b[0], b[1]],
            [b[0] - ux * head - uy * wing, b[1] - uy * head + ux * wing],
            [b[0] - ux * head + uy * wing, b[1] - uy * head - ux * wing]
        ].map(function (p) {
            return p[0].toFixed(2) + ',' + p[1].toFixed(2);
        }).join(' ') + '" fill="' + color + '"/>';
    });
    (out.labels || []).forEach(function (lb) {
        const p = project(lb.at);
        svg += '<text x="' + p[0].toFixed(2) + '" y="' + p[1].toFixed(2) + '" font-size="' + (10 * k).toFixed(2) +
            '" text-anchor="middle" dominant-baseline="middle" fill="currentColor">' + String(lb.text).replace(/[<&]/g, '') + '</text>';
    });
    return svg;
}

// The area a scene uses over its whole animation, so it does not zoom
export function sceneBounds(scene) {
    const min = [Infinity, Infinity];
    const max = [-Infinity, -Infinity];
    [0, 0.25, 0.5, 0.75, 1].forEach(function (t) {
        const out = scene.frame(t);
        const all = [];
        (out.faces || []).forEach(function (f) {
            f.p.forEach(function (p) {
                all.push(p);
            });
        });
        (out.lines || []).forEach(function (l) {
            all.push(l.a, l.b);
        });
        (out.arrows || []).forEach(function (a) {
            all.push(a.from, [a.from[0] + a.dir[0] * a.len, a.from[1] + a.dir[1] * a.len, a.from[2] + a.dir[2] * a.len]);
        });
        all.forEach(function (p) {
            const q = project(p);
            min[0] = Math.min(min[0], q[0]);
            min[1] = Math.min(min[1], q[1]);
            max[0] = Math.max(max[0], q[0]);
            max[1] = Math.max(max[1], q[1]);
        });
    });
    // Keep the card's proportions, with a margin
    let w = (max[0] - min[0]) * 1.08 + 3;
    let h = (max[1] - min[1]) * 1.08 + 3;
    if (w / h < W / H) {
        w = h * W / H;
    } else {
        h = w * H / W;
    }
    const cx = (min[0] + max[0]) / 2;
    const cy = (min[1] + max[1]) / 2;
    return { x: cx - w / 2, y: cy - h / 2, w: w, h: h };
}

// The scene for a choice: `family` (the panel row's illustrate key) and
// the chosen id, or null when there is none
export function sceneFor(family, id) {
    return SCENES[family + '.' + id] || null;
}

// Before, then the change, then after: t of the loop (0..1) to the eased
// progress the scenes are drawn at
export function progress(phase) {
    const p = phase - Math.floor(phase);
    if (p < 0.15) {
        return 0;
    }
    if (p > 0.72) {
        return 1;
    }
    const x = (p - 0.15) / 0.57;
    return x * x * (3 - 2 * x);
}
