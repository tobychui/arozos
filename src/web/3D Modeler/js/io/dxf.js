/*
    3D Modeler - drawing as DXF

    Writes one sheet of drawing primitives (drawing/layout.js) as an ASCII
    DXF file of release 12 (AC1009), the plainest flavour of the format, so
    open source CAD (LibreCAD, QCAD, FreeCAD, Inkscape) and every commercial
    one can read it. Units are millimetres on paper ($INSUNITS 4): at the
    default 1:1 scale the views are at the model's true size.

    Each kind of line has its layer, with the line type and colour CAD users
    expect: VISIBLE, HIDDEN (dashed), CENTER (chain), TANGENT, DIMENSION,
    TEXT, BORDER and TITLE. Dimensions are written as the lines, arrow heads
    (SOLID) and texts they are made of, not as DIMENSION entities.
*/

const LAYER_NAMES = {
    border: 'BORDER', title: 'TITLE', thin: 'TITLE', visible: 'VISIBLE', tangent: 'TANGENT',
    hidden: 'HIDDEN', center: 'CENTER', dim: 'DIMENSION', text: 'TEXT'
};

// name: [colour, line type]
const LAYER_TABLE = {
    VISIBLE: [7, 'CONTINUOUS'],
    HIDDEN: [2, 'HIDDEN'],
    CENTER: [1, 'CENTER'],
    TANGENT: [8, 'CONTINUOUS'],
    DIMENSION: [3, 'CONTINUOUS'],
    TEXT: [7, 'CONTINUOUS'],
    BORDER: [7, 'CONTINUOUS'],
    TITLE: [7, 'CONTINUOUS']
};

function f(v) {
    const r = Math.round(v * 1e6) / 1e6;
    return String(r === 0 ? 0 : r);
}

// Text in DXF: the drawing symbols have their own codes, anything else
// outside ASCII is written as \U+XXXX
export function dxfText(text) {
    let out = '';
    for (const ch of String(text)) {
        const cp = ch.codePointAt(0);
        if (ch === '%') {
            out += '%%%';
        } else if (cp === 0xd8 || cp === 0xf8 || cp === 0x2300) {
            out += '%%c';
        } else if (cp === 0xb0) {
            out += '%%d';
        } else if (cp === 0xb1) {
            out += '%%p';
        } else if (cp >= 32 && cp <= 126) {
            out += ch;
        } else if (cp < 32) {
            out += ' ';
        } else if (cp <= 0xffff) {
            out += '\\U+' + cp.toString(16).toUpperCase().padStart(4, '0');
        } else {
            out += '?';
        }
    }
    return out;
}

export function toDXF(groups, sheet) {
    const out = [];
    const pair = function (code, value) {
        out.push(String(code), String(value));
    };
    const layerOf = function (it) {
        return LAYER_NAMES[it.layer] || 'TITLE';
    };
    // Header
    pair(0, 'SECTION');
    pair(2, 'HEADER');
    pair(9, '$ACADVER');
    pair(1, 'AC1009');
    pair(9, '$INSUNITS');
    pair(70, 4);
    pair(9, '$MEASUREMENT');
    pair(70, 1);
    pair(9, '$LTSCALE');
    pair(40, 1);
    pair(9, '$EXTMIN');
    pair(10, 0);
    pair(20, 0);
    pair(30, 0);
    pair(9, '$EXTMAX');
    pair(10, f(sheet.width));
    pair(20, f(sheet.height));
    pair(30, 0);
    pair(9, '$LIMMIN');
    pair(10, 0);
    pair(20, 0);
    pair(9, '$LIMMAX');
    pair(10, f(sheet.width));
    pair(20, f(sheet.height));
    pair(0, 'ENDSEC');
    // Tables: line types, layers, the text style
    pair(0, 'SECTION');
    pair(2, 'TABLES');
    const ltypes = [
        ['CONTINUOUS', 'Solid line', []],
        ['HIDDEN', 'Hidden __ __ __', [3, -1.5]],
        ['CENTER', 'Center ____ _ ____', [8, -1.5, 1.5, -1.5]]
    ];
    pair(0, 'TABLE');
    pair(2, 'LTYPE');
    pair(70, ltypes.length);
    ltypes.forEach(function (lt) {
        pair(0, 'LTYPE');
        pair(2, lt[0]);
        pair(70, 0);
        pair(3, lt[1]);
        pair(72, 65);
        pair(73, lt[2].length);
        pair(40, f(lt[2].reduce(function (s, v) {
            return s + Math.abs(v);
        }, 0)));
        lt[2].forEach(function (v) {
            pair(49, f(v));
        });
    });
    pair(0, 'ENDTAB');
    const names = Object.keys(LAYER_TABLE);
    pair(0, 'TABLE');
    pair(2, 'LAYER');
    pair(70, names.length + 1);
    pair(0, 'LAYER');
    pair(2, '0');
    pair(70, 0);
    pair(62, 7);
    pair(6, 'CONTINUOUS');
    names.forEach(function (name) {
        pair(0, 'LAYER');
        pair(2, name);
        pair(70, 0);
        pair(62, LAYER_TABLE[name][0]);
        pair(6, LAYER_TABLE[name][1]);
    });
    pair(0, 'ENDTAB');
    pair(0, 'TABLE');
    pair(2, 'STYLE');
    pair(70, 1);
    pair(0, 'STYLE');
    pair(2, 'STANDARD');
    pair(70, 0);
    pair(40, 0);
    pair(41, 1);
    pair(50, 0);
    pair(71, 0);
    pair(42, 3.5);
    pair(3, 'txt');
    pair(4, '');
    pair(0, 'ENDTAB');
    pair(0, 'ENDSEC');
    // Entities
    pair(0, 'SECTION');
    pair(2, 'ENTITIES');
    const point = function (code, p) {
        pair(code, f(p[0]));
        pair(code + 10, f(p[1]));
        pair(code + 20, 0);
    };
    groups.forEach(function (g) {
        g.items.forEach(function (it) {
            const layer = layerOf(it);
            if (it.t === 'line') {
                pair(0, 'LINE');
                pair(8, layer);
                point(10, it.a);
                point(11, it.b);
            } else if (it.t === 'circle') {
                pair(0, 'CIRCLE');
                pair(8, layer);
                point(10, it.c);
                pair(40, f(it.r));
            } else if (it.t === 'arc') {
                if (it.sweep >= 2 * Math.PI - 1e-9) {
                    pair(0, 'CIRCLE');
                    pair(8, layer);
                    point(10, it.c);
                    pair(40, f(it.r));
                    return;
                }
                const a0 = it.a0 * 180 / Math.PI;
                pair(0, 'ARC');
                pair(8, layer);
                point(10, it.c);
                pair(40, f(it.r));
                pair(50, f(((a0 % 360) + 360) % 360));
                pair(51, f((((a0 + it.sweep * 180 / Math.PI) % 360) + 360) % 360));
            } else if (it.t === 'poly') {
                pair(0, 'POLYLINE');
                pair(8, layer);
                pair(66, 1);
                pair(10, 0);
                pair(20, 0);
                pair(30, 0);
                pair(70, it.closed ? 1 : 0);
                it.pts.forEach(function (p) {
                    pair(0, 'VERTEX');
                    pair(8, layer);
                    point(10, p);
                });
                pair(0, 'SEQEND');
                pair(8, layer);
            } else if (it.t === 'fill') {
                // SOLID takes four corners in a zigzag order; a triangle repeats one
                const p = it.pts;
                const order = p.length >= 4 ? [p[0], p[1], p[3], p[2]] : [p[0], p[1], p[2], p[2]];
                pair(0, 'SOLID');
                pair(8, layer);
                order.forEach(function (q, i) {
                    point(10 + i, q);
                });
            } else if (it.t === 'text') {
                const align = it.anchor === 'middle' ? 1 : it.anchor === 'end' ? 2 : 0;
                pair(0, 'TEXT');
                pair(8, layer);
                point(10, it.p);
                pair(40, f(it.h));
                pair(1, dxfText(it.text));
                if (it.rot) {
                    pair(50, f(it.rot));
                }
                if (align) {
                    pair(72, align);
                    point(11, it.p);
                }
            }
        });
    });
    pair(0, 'ENDSEC');
    pair(0, 'EOF');
    return out.join('\r\n') + '\r\n';
}
