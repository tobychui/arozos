/*
    3D Modeler - text metrics of drawings

    Drawings are written with Helvetica (Arial on screen, the same widths):
    it is one of the fonts every PDF reader has, so a PDF needs no font
    inside it. The widths below are Helvetica's (thousandths of the font
    size, from the standard Adobe metrics), used to centre dimension text and
    to size leader shoulders the same way on screen, in PDF and in DXF.

    The text height of a drawing (3.5 mm by default, as ISO 3098 asks) is
    the height of a capital letter; the font size is larger by the cap height
    of Helvetica (718 / 1000).
*/

const W = {
    ' ': 278, '!': 278, '"': 355, '#': 556, '$': 556, '%': 889, '&': 667, '\'': 191, '(': 333, ')': 333,
    '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278, ':': 278, ';': 278, '<': 584, '=': 584,
    '>': 584, '?': 556, '@': 1015, '[': 278, '\\': 278, ']': 278, '^': 469, '_': 556, '`': 333, '{': 334,
    '|': 260, '}': 334, '~': 584,
    A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500, K: 667, L: 556, M: 833,
    N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
    a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222, k: 500, l: 222, m: 833,
    n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
    '\u00d8': 778, '\u00f8': 611, '\u00b0': 400, '\u00b1': 584, '\u00d7': 584, '\u00b5': 556, '\u00b2': 333, '\u00b3': 333
};

export const CAP_HEIGHT = 0.718;

// The font size that gives capitals `height` mm tall
export function fontSize(height) {
    return height / CAP_HEIGHT;
}

function charWidth(ch) {
    if (/[0-9]/.test(ch)) {
        return 556;
    }
    if (W[ch] !== undefined) {
        return W[ch];
    }
    // Wide scripts (CJK and the like) take a full em
    return ch.charCodeAt(0) >= 0x2e80 ? 1000 : 556;
}

// The width (mm) of one line of text with capitals `height` mm tall
export function textWidth(text, height) {
    let units = 0;
    for (const ch of String(text)) {
        units += charWidth(ch);
    }
    return units / 1000 * fontSize(height);
}
