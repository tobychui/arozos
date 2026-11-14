/*
    3D Modeler - the picture in the Hole panel

    A section through the hole, as Inventor's Hole panel shows it: the
    seat (none, counterbore, countersink), the termination (to a depth or
    through all), the drill point and the direction (flipped: drilled the
    other way from the sketch plane), with every size the panel asks for
    written where it applies. Not to scale, so small and large holes read
    the same; the values are the real ones.

    holeFigure(draft, focus) -> SVG markup
        draft   the panel's values: { kind, diameter, through, depth,
                drillPoint, flip, cbDiameter, cbDepth, csDiameter, csAngle }
        focus   the key of the box with the caret: its size is coloured
    Every label carries data-focus="<key>", so a click on it can put the
    caret in that box (panel.js figure rows).
*/

const W = 260;
const H = 200;
const CX = 114;         // the hole's axis
const LEFT = 56;        // the material, across
const RIGHT = 172;
const TOP = 50;         // the face the hole starts at (the sketch plane)
const R = 13;           // the hole's radius in the picture

function mm(v) {
    const n = Number(v);
    return (isFinite(n) ? +n.toFixed(3) : 0) + ' mm';
}

function deg(v) {
    const n = Number(v);
    return (isFinite(n) ? +n.toFixed(2) : 0) + '°';
}

function f(v) {
    return (+v.toFixed(2)).toString();
}

// The outline of the hole as [x offset from the axis, depth below TOP]
// pairs for the right half, and the depths the sizes are measured to
export function holeShape(draft) {
    const through = !!draft.through;
    const bottom = through ? 128 : 104;     // where the material ends
    const end = through ? bottom + 10 : 96; // where the round part ends
    const half = [];
    let seatDepth = 0;
    let seatR = 0;
    if (draft.kind === 'counterbore') {
        seatR = 28;
        seatDepth = 28;
        half.push([seatR, 0], [seatR, seatDepth], [R, seatDepth]);
    } else if (draft.kind === 'countersink') {
        seatR = 30;
        const a = Math.max(20, Math.min(170, Number(draft.csAngle) || 90)) / 2 * Math.PI / 180;
        seatDepth = Math.max(6, Math.min(44, (seatR - R) / Math.tan(a)));
        half.push([seatR, 0], [R, seatDepth]);
    } else {
        half.push([R, 0]);
    }
    half.push([R, end]);
    let tip = end;
    if (!through && draft.drillPoint) {
        tip = end + R / Math.tan(59 * Math.PI / 180);
    }
    return { half: half, end: end, tip: tip, bottom: bottom, seatR: seatR, seatDepth: seatDepth, through: through };
}

export function holeFigure(draft, focus) {
    const s = holeShape(draft);
    const flip = !!draft.flip;
    // Depth below the face to picture Y: flipped, the hole goes up
    const y = function (d) {
        return flip ? H - (TOP + d) : TOP + d;
    };
    const on = function (key) {
        return key === focus ? ' on' : '';
    };
    let out = '<svg class="hole-figure" viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg">' +
        '<defs><pattern id="hf-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
        '<line x1="0" y1="0" x2="0" y2="6" class="hf-hatch"/></pattern></defs>';

    // The material, then the hole cut out of it
    out += '<rect class="hf-material" x="' + LEFT + '" y="' + f(Math.min(y(0), y(s.bottom))) + '" width="' + (RIGHT - LEFT) +
        '" height="' + s.bottom + '"/>';
    const right = s.half.map(function (p) {
        return [CX + p[0], y(p[1])];
    });
    const bottomPoint = [CX, y(s.through ? s.end : s.tip)];
    const lift = flip ? 6 : -6; // the cut starts a little outside the face
    // Down the left wall, the bottom, up the right wall
    const outline = [[CX - s.half[0][0], y(0)]];
    s.half.forEach(function (p) {
        outline.push([CX - p[0], y(p[1])]);
    });
    outline.push(bottomPoint);
    right.slice().reverse().forEach(function (p) {
        outline.push(p);
    });
    const pts = function (list) {
        return list.map(function (p) {
            return f(p[0]) + ',' + f(p[1]);
        }).join(' ');
    };
    const cut = [[CX - s.half[0][0], y(0) + lift]].concat(outline, [[CX + s.half[0][0], y(0) + lift]]);
    out += '<polygon class="hf-cavity" points="' + pts(cut) + '"/>';
    // The walls of the hole (an open bottom when it goes through)
    if (s.through) {
        out += '<polyline class="hf-edge" points="' + pts(outline.slice(0, s.half.length + 1)) + '"/>';
        out += '<polyline class="hf-edge" points="' + pts(outline.slice(s.half.length + 2)) + '"/>';
    } else {
        out += '<polyline class="hf-edge" points="' + pts(outline) + '"/>';
    }
    // The face and the bottom of the material
    out += '<line class="hf-edge" x1="' + LEFT + '" y1="' + f(y(0)) + '" x2="' + f(CX - s.half[0][0]) + '" y2="' + f(y(0)) + '"/>';
    out += '<line class="hf-edge" x1="' + f(CX + s.half[0][0]) + '" y1="' + f(y(0)) + '" x2="' + RIGHT + '" y2="' + f(y(0)) + '"/>';
    if (s.through) {
        out += '<line class="hf-edge" x1="' + LEFT + '" y1="' + f(y(s.bottom)) + '" x2="' + (CX - R) + '" y2="' + f(y(s.bottom)) + '"/>';
        out += '<line class="hf-edge" x1="' + (CX + R) + '" y1="' + f(y(s.bottom)) + '" x2="' + RIGHT + '" y2="' + f(y(s.bottom)) + '"/>';
    }
    // The axis
    out += '<line class="hf-axis" x1="' + CX + '" y1="' + f(y(-14)) + '" x2="' + CX + '" y2="' + f(y(s.bottom + 12)) + '"/>';
    // Which way it is drilled, from the sketch plane
    // The sketch plane the hole starts at, on the side away from the material
    out += '<line class="hf-plane" x1="4" y1="' + f(y(0)) + '" x2="' + LEFT + '" y2="' + f(y(0)) + '"/>' +
        '<text class="hf-note" x="4" y="' + f(y(-7)) + '" dominant-baseline="middle">Sketch plane</text>';

    // The sizes
    const label = function (key, x, yy, text, anchor) {
        return '<text class="hf-label' + on(key) + '" data-focus="' + key + '" x="' + f(x) + '" y="' + f(yy) + '" text-anchor="' + (anchor || 'start') +
            '" dominant-baseline="middle">' + text + '</text>';
    };
    const dimLine = function (key, x1, y1, x2, y2) {
        return '<line class="hf-dim' + on(key) + '" x1="' + f(x1) + '" y1="' + f(y1) + '" x2="' + f(x2) + '" y2="' + f(y2) + '"/>';
    };
    // Diameter: across the round part near its end, written on the left
    const dy = y(s.through ? s.bottom - 14 : s.end - 12);
    out += dimLine('diameter', CX - R, dy, CX + R, dy) + head(CX - R, dy, -1, 0, 'diameter', on) + head(CX + R, dy, 1, 0, 'diameter', on);
    out += dimLine('diameter', CX - R, dy, 50, dy) + label('diameter', 47, dy, '⌀' + mm(draft.diameter), 'end');
    // Depth (or Through All) on the right
    if (s.through) {
        out += arrow(CX, y(s.bottom - 2), CX, y(s.bottom + 18), 'hf-dim') +
            '<text class="hf-note" x="178" y="' + f(y(s.bottom)) + '" dominant-baseline="middle">Through All</text>';
    } else {
        out += dimLine('depth', RIGHT, y(0), 190, y(0)) + dimLine('depth', CX + R, y(s.end), 190, y(s.end)) +
            dimLine('depth', 185, y(0), 185, y(s.end)) + head(185, y(0), 0, flip ? 1 : -1, 'depth', on) + head(185, y(s.end), 0, flip ? -1 : 1, 'depth', on) +
            label('depth', 190, y(s.end / 2), mm(draft.depth));
        if (draft.drillPoint) {
            out += '<line class="hf-dim" x1="' + f(CX + 4) + '" y1="' + f(y(s.tip - 3)) + '" x2="190" y2="' + f(y(s.tip + 8)) + '"/>' +
                '<text class="hf-note" x="192" y="' + f(y(s.tip + 8)) + '" dominant-baseline="middle">118° point</text>';
        }
    }
    // The seat
    const seatY = y(-16);
    const seatLabelY = y(-27);
    if (draft.kind === 'counterbore') {
        out += dimLine('cbDiameter', CX - s.seatR, y(0), CX - s.seatR, seatY) + dimLine('cbDiameter', CX + s.seatR, y(0), CX + s.seatR, seatY) +
            dimLine('cbDiameter', CX - s.seatR, seatY, CX + s.seatR, seatY) +
            head(CX - s.seatR, seatY, -1, 0, 'cbDiameter', on) + head(CX + s.seatR, seatY, 1, 0, 'cbDiameter', on) +
            label('cbDiameter', CX, seatLabelY, '⌀' + mm(draft.cbDiameter), 'middle');
        out += dimLine('cbDepth', LEFT, y(0), 40, y(0)) + dimLine('cbDepth', CX - s.seatR, y(s.seatDepth), 40, y(s.seatDepth)) +
            dimLine('cbDepth', 45, y(0), 45, y(s.seatDepth)) +
            head(45, y(0), 0, flip ? 1 : -1, 'cbDepth', on) + head(45, y(s.seatDepth), 0, flip ? -1 : 1, 'cbDepth', on) +
            label('cbDepth', 40, y(s.seatDepth / 2), mm(draft.cbDepth), 'end');
    } else if (draft.kind === 'countersink') {
        out += dimLine('csDiameter', CX - s.seatR, y(0), CX - s.seatR, seatY) + dimLine('csDiameter', CX + s.seatR, y(0), CX + s.seatR, seatY) +
            dimLine('csDiameter', CX - s.seatR, seatY, CX + s.seatR, seatY) +
            head(CX - s.seatR, seatY, -1, 0, 'csDiameter', on) + head(CX + s.seatR, seatY, 1, 0, 'csDiameter', on) +
            label('csDiameter', CX, seatLabelY, '⌀' + mm(draft.csDiameter), 'middle');
        // The angle: a leader from the cone's side
        const mx = CX - (s.seatR + R) / 2;
        const my = y(s.seatDepth / 2);
        out += '<line class="hf-dim' + on('csAngle') + '" x1="' + f(mx) + '" y1="' + f(my) + '" x2="40" y2="' + f(my) + '"/>' +
            label('csAngle', 37, my, deg(draft.csAngle), 'end');
    }
    out += '</svg>';
    return out;
}

// An arrow head at (x, y) pointing along (dx, dy)
function head(x, y, dx, dy, key, on) {
    const l = 5;
    const w = 2.2;
    const bx = x - dx * l;
    const by = y - dy * l;
    return '<polygon class="hf-head' + (on ? on(key) : '') + '" points="' + [
        [x, y], [bx - dy * w, by + dx * w], [bx + dy * w, by - dx * w]
    ].map(function (p) {
        return f(p[0]) + ',' + f(p[1]);
    }).join(' ') + '"/>';
}

function arrow(x1, y1, x2, y2, cls) {
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    return '<line class="' + cls + '" x1="' + f(x1) + '" y1="' + f(y1) + '" x2="' + f(x2) + '" y2="' + f(y2) + '"/>' +
        head(x2, y2, (x2 - x1) / len, (y2 - y1) / len, null, null);
}
