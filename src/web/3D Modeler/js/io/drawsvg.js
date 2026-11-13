/*
    3D Modeler - drawing as SVG

    Writes the primitives of drawing/layout.js as SVG: the whole sheet as a
    file (export), or the inner markup the sheet editor puts on screen.
    SVG runs y downwards, so every y becomes height - y; arcs keep their
    turn (counter-clockwise on paper is counter-clockwise on screen).
    Lines are black on white, sized in millimetres (1 user unit = 1 mm).
*/

import { LAYERS } from '../drawing/layout.js';
import { fontSize } from '../drawing/font.js';

export const FONT_FAMILY = 'Helvetica, Arial, sans-serif';

function n(v) {
    return String(Math.round(v * 1000) / 1000);
}

export function escapeXML(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function strokeOf(layer, color) {
    const style = LAYERS[layer] || LAYERS.thin;
    let out = ' fill="none" stroke="' + color + '" stroke-width="' + n(style.width) + '" stroke-linecap="round" stroke-linejoin="round"';
    if (style.dash) {
        out += ' stroke-dasharray="' + style.dash.map(n).join(' ') + '"';
    }
    return out;
}

// One primitive as an SVG element; H is the sheet height
export function primitiveSVG(it, H, color) {
    const c = color || '#000';
    const P = function (p) {
        return n(p[0]) + ' ' + n(H - p[1]);
    };
    if (it.t === 'line') {
        return '<line x1="' + n(it.a[0]) + '" y1="' + n(H - it.a[1]) + '" x2="' + n(it.b[0]) + '" y2="' + n(H - it.b[1]) + '"' + strokeOf(it.layer, c) + '/>';
    }
    if (it.t === 'poly') {
        const pts = it.pts.map(function (p) {
            return n(p[0]) + ',' + n(H - p[1]);
        }).join(' ');
        return '<' + (it.closed ? 'polygon' : 'polyline') + ' points="' + pts + '"' + strokeOf(it.layer, c) + '/>';
    }
    if (it.t === 'fill') {
        const pts = it.pts.map(function (p) {
            return n(p[0]) + ',' + n(H - p[1]);
        }).join(' ');
        return '<polygon points="' + pts + '" fill="' + c + '" stroke="none"/>';
    }
    if (it.t === 'circle') {
        if (it.filled) {
            return '<circle cx="' + n(it.c[0]) + '" cy="' + n(H - it.c[1]) + '" r="' + n(it.r) + '" fill="' + c + '" stroke="none"/>';
        }
        return '<circle cx="' + n(it.c[0]) + '" cy="' + n(H - it.c[1]) + '" r="' + n(it.r) + '"' + strokeOf(it.layer, c) + '/>';
    }
    if (it.t === 'arc') {
        if (it.sweep >= 2 * Math.PI - 1e-6) {
            return primitiveSVG({ t: 'circle', c: it.c, r: it.r, layer: it.layer }, H, color);
        }
        const a1 = it.a0 + it.sweep;
        const s = [it.c[0] + it.r * Math.cos(it.a0), it.c[1] + it.r * Math.sin(it.a0)];
        const e = [it.c[0] + it.r * Math.cos(a1), it.c[1] + it.r * Math.sin(a1)];
        return '<path d="M' + P(s) + 'A' + n(it.r) + ' ' + n(it.r) + ' 0 ' + (it.sweep > Math.PI ? 1 : 0) + ' 0 ' + P(e) + '"' + strokeOf(it.layer, c) + '/>';
    }
    if (it.t === 'text') {
        const x = n(it.p[0]);
        const y = n(H - it.p[1]);
        const rot = it.rot ? ' transform="rotate(' + n(-it.rot) + ' ' + x + ' ' + y + ')"' : '';
        const anchor = it.anchor && it.anchor !== 'start' ? ' text-anchor="' + it.anchor + '"' : '';
        return '<text x="' + x + '" y="' + y + '" font-size="' + n(fontSize(it.h)) + '" font-family="' + FONT_FAMILY + '" fill="' + c + '"' + anchor + rot + ' xml:space="preserve">' + escapeXML(it.text) + '</text>';
    }
    return '';
}

// The groups of a layout as SVG markup, each in a <g data-owner="...">
export function groupsSVG(groups, H, color) {
    return groups.map(function (g) {
        return '<g data-owner="' + escapeXML(g.owner) + '">' + g.items.map(function (it) {
            return primitiveSVG(it, H, color);
        }).join('') + '</g>';
    }).join('');
}

// A whole SVG file of the sheet, sized in millimetres
export function toSVG(groups, sheet, opts) {
    const options = opts || {};
    const W = sheet.width;
    const H = sheet.height;
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="' + n(W) + 'mm" height="' + n(H) + 'mm" viewBox="0 0 ' + n(W) + ' ' + n(H) + '">\n' +
        (options.title ? '<title>' + escapeXML(options.title) + '</title>\n' : '') +
        '<rect x="0" y="0" width="' + n(W) + '" height="' + n(H) + '" fill="#ffffff"/>\n' +
        groups.map(function (g) {
            return '<g id="' + escapeXML(g.owner.replace(':', '-')) + '">' + g.items.map(function (it) {
                return primitiveSVG(it, H, '#000');
            }).join('') + '</g>';
        }).join('\n') + '\n</svg>\n';
}
