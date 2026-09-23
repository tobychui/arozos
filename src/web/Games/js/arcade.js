/*
    arcade.js

    Shared front-end runtime for the Games module's retro shell.

    Responsibilities:
      1. PX_FONT       a 5x7 bitmap typeface rendered to SVG, so headings and
                       buttons are true pixel art instead of an anti-aliased
                       web font (and no remote font has to be fetched).
      2. pxSprite()    turns a grid from sprites.js into an inline <svg>.
      3. boot()        upgrades [data-px] / [data-icon] nodes, paints the star
                       field and the moon scenes, and wraps a plain game page
                       in the .px-screen shell so every page shares the layout.

    Nothing here touches game logic -- pages keep their own scripts.
*/

/* ------------------------------------------------------------ pixel font */

/*
    Each glyph is 5 wide by 7 tall, written a row at a time so the shapes stay
    readable in a diff. '1' is an inked pixel.
*/
var PX_FONT = {
    'A': ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
    'B': ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
    'C': ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
    'D': ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
    'E': ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
    'F': ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
    'G': ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
    'H': ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
    'I': ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
    'J': ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
    'K': ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
    'L': ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
    'M': ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
    'N': ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
    'O': ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
    'P': ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
    'Q': ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
    'R': ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
    'S': ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
    'T': ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
    'U': ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
    'V': ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
    'W': ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
    'X': ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
    'Y': ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
    'Z': ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
    '0': ['01110', '10011', '10011', '10101', '11001', '11001', '01110'],
    '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
    '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
    '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
    '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
    '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
    '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
    '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
    '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
    '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
    ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
    '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
    '?': ['01110', '10001', '00001', '00010', '00100', '00000', '00100'],
    '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
    ',': ['00000', '00000', '00000', '00000', '01100', '01100', '01000'],
    ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
    ';': ['00000', '01100', '01100', '00000', '01100', '01100', '01000'],
    '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
    '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
    '=': ['00000', '00000', '11111', '00000', '11111', '00000', '00000'],
    '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
    '(': ['00010', '00100', '01000', '01000', '01000', '00100', '00010'],
    ')': ['01000', '00100', '00010', '00010', '00010', '00100', '01000'],
    "'": ['00100', '00100', '00000', '00000', '00000', '00000', '00000'],
    '"': ['01010', '01010', '00000', '00000', '00000', '00000', '00000'],
    '&': ['01100', '10010', '10010', '01100', '10101', '10010', '01101'],
    '%': ['11001', '11010', '00010', '00100', '01000', '01011', '10011'],
    '#': ['01010', '01010', '11111', '01010', '11111', '01010', '01010'],
    '<': ['00010', '00100', '01000', '10000', '01000', '00100', '00010'],
    '>': ['01000', '00100', '00010', '00001', '00010', '00100', '01000'],
    '*': ['00000', '10101', '01110', '11111', '01110', '10101', '00000']
};

var PX_FONT_W = 5;
var PX_FONT_H = 7;
var PX_FONT_GAP = 1;

/* escapeAttr keeps caller-supplied text safe when it lands in an attribute. */
function pxEscape(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/*
    pxRowRects merges consecutive inked pixels on one row into a single <rect>,
    which keeps a headline down to a few dozen nodes instead of a few hundred.
*/
function pxRowRects(bits, x0, y, fill) {
    var out = '';
    var run = 0;
    var i;
    for (i = 0; i <= bits.length; i++) {
        if (i < bits.length && bits.charAt(i) === '1') {
            run++;
            continue;
        }
        if (run > 0) {
            out += '<rect x="' + (x0 + i - run) + '" y="' + y + '" width="' + run +
                '" height="1" fill="' + fill + '"/>';
            run = 0;
        }
    }
    return out;
}

/*
    pxTextSVG renders a string as an <svg> of 1x1 pixel rects.

    opts.scale   pixel size in CSS px (default 4)
    opts.color   ink colour, default currentColor so CSS can drive it
    opts.shadow  colour of the 1px drop shadow, or null for none
    opts.lines   text may contain "\n" or "|" to break lines
*/
function pxTextSVG(text, opts) {
    opts = opts || {};
    var scale = opts.scale || 4;
    var color = opts.color || 'currentColor';
    var shadow = opts.shadow === undefined ? 'rgba(0,0,0,0.85)' : opts.shadow;
    var lineGap = opts.lineGap === undefined ? 2 : opts.lineGap;

    var lines = String(text).toUpperCase().split(/\n|\|/);
    var longest = 0;
    var i;
    for (i = 0; i < lines.length; i++) {
        if (lines[i].length > longest) {
            longest = lines[i].length;
        }
    }

    var unitW = longest * (PX_FONT_W + PX_FONT_GAP) - PX_FONT_GAP;
    var unitH = lines.length * (PX_FONT_H + lineGap) - lineGap;
    if (unitW < 1) {
        unitW = 1;
    }

    var body = '';
    var pass;
    /* Pass 0 draws the shadow one pixel down-right, pass 1 the ink itself. */
    for (pass = shadow ? 0 : 1; pass < 2; pass++) {
        var fill = pass === 0 ? shadow : color;
        var off = pass === 0 ? 1 : 0;
        var li;
        for (li = 0; li < lines.length; li++) {
            var line = lines[li];
            var ci;
            for (ci = 0; ci < line.length; ci++) {
                var glyph = PX_FONT[line.charAt(ci)];
                if (!glyph) {
                    continue;
                }
                var gx = ci * (PX_FONT_W + PX_FONT_GAP) + off;
                var gy = li * (PX_FONT_H + lineGap) + off;
                var ry;
                for (ry = 0; ry < PX_FONT_H; ry++) {
                    body += pxRowRects(glyph[ry], gx, gy + ry, fill);
                }
            }
        }
    }

    var pad = shadow ? 1 : 0;
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + ((unitW + pad) * scale) +
        '" height="' + ((unitH + pad) * scale) + '" viewBox="0 0 ' + (unitW + pad) + ' ' +
        (unitH + pad) + '" shape-rendering="crispEdges" role="img" aria-label="' +
        pxEscape(text) + '">' + body + '</svg>';
}

/* ---------------------------------------------------------------- sprites */

/*
    pxSpriteSVG renders a named grid from sprites.js. Runs of the same colour
    on a row are merged into one <rect>, same as the font renderer.
*/
function pxSpriteSVG(name, opts) {
    opts = opts || {};
    var sprite = (typeof AROZ_SPRITES !== 'undefined') ? AROZ_SPRITES[name] : null;
    if (!sprite) {
        return '';
    }

    var rows = sprite.rows;
    var palette = sprite.p || {};
    var h = rows.length;
    var w = rows[0].length;
    var body = '';

    var y;
    for (y = 0; y < h; y++) {
        var row = rows[y];
        var runChar = null;
        var runStart = 0;
        var x;
        for (x = 0; x <= w; x++) {
            var ch = x < w ? row.charAt(x) : null;
            if (ch === runChar) {
                continue;
            }
            if (runChar !== null && runChar !== '.' && palette[runChar]) {
                body += '<rect x="' + runStart + '" y="' + y + '" width="' + (x - runStart) +
                    '" height="1" fill="' + palette[runChar] + '"/>';
            }
            runChar = ch;
            runStart = x;
        }
    }

    var attrs = 'viewBox="0 0 ' + w + ' ' + h + '" shape-rendering="crispEdges"';
    if (opts.size) {
        attrs += ' width="' + opts.size + '" height="' + (opts.size * h / w) + '"';
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" ' + attrs +
        ' role="img" aria-label="' + pxEscape(opts.label || name) + '">' + body + '</svg>';
}

/* ------------------------------------------------------------- star field */

function pxDrawStars(canvas) {
    var w = Math.max(120, Math.ceil(window.innerWidth / 4));
    var h = Math.max(120, Math.ceil(window.innerHeight / 4));
    canvas.width = w;
    canvas.height = h;

    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);

    var count = Math.floor(w * h / 260);
    var i;
    for (i = 0; i < count; i++) {
        var x = Math.floor(Math.random() * w);
        var y = Math.floor(Math.random() * h);
        var roll = Math.random();
        if (roll > 0.94) {
            /* A few four-point sparkles, like the mockup's twinkles. */
            ctx.fillStyle = '#ffe98a';
            ctx.fillRect(x, y - 1, 1, 3);
            ctx.fillRect(x - 1, y, 3, 1);
        } else if (roll > 0.72) {
            ctx.fillStyle = 'rgba(255, 231, 160, 0.85)';
            ctx.fillRect(x, y, 1, 1);
        } else {
            ctx.fillStyle = 'rgba(190, 180, 230, 0.55)';
            ctx.fillRect(x, y, 1, 1);
        }
    }
}

/*
    pxDrawScene paints the chunky backdrops. Everything is drawn at roughly a
    quarter of the CSS size and scaled back up by the browser with
    image-rendering: pixelated, which is what gives the hard pixel steps.
*/
function pxDrawScene(canvas, kind) {
    var rect = canvas.getBoundingClientRect();
    var w = Math.max(60, Math.round(rect.width / 4));
    var h = Math.max(20, Math.round(rect.height / 4));
    canvas.width = w;
    canvas.height = h;

    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);

    var i;

    if (kind === 'header') {
        /* Star speckle. */
        for (i = 0; i < w * h / 90; i++) {
            var sx = Math.floor(Math.random() * w);
            var sy = Math.floor(Math.random() * h);
            ctx.fillStyle = Math.random() > 0.6 ? 'rgba(255,231,160,0.9)' : 'rgba(180,170,220,0.5)';
            ctx.fillRect(sx, sy, 1, 1);
        }

        /* Distant purple ridge on the left. */
        ctx.fillStyle = '#2b1b4d';
        var ridgeY = h - 6;
        for (i = 0; i < Math.floor(w * 0.45); i++) {
            var bump = Math.round(Math.sin(i / 3.5) * 2 + Math.sin(i / 1.7) * 1.2);
            ctx.fillRect(i, ridgeY - bump, 1, h);
        }

        /* The big gold moon, bottom-centre-right. */
        /* Clamp against the width too, or a tall (wrapped) header fills up. */
        var mr = Math.max(10, Math.min(Math.round(h * 0.85), Math.round(w * 0.3)));
        var mx = Math.round(w * 0.55);
        var my = h + Math.round(mr * 0.45);
        ctx.fillStyle = '#e0a800';
        ctx.beginPath();
        ctx.arc(mx, my, mr, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffc61a';
        ctx.beginPath();
        ctx.arc(mx, my, mr - 2, 0, Math.PI * 2);
        ctx.fill();

        /* Craters. */
        ctx.fillStyle = '#c98a00';
        var craters = [[-0.45, -0.55, 0.16], [0.25, -0.72, 0.11], [0.55, -0.3, 0.2], [-0.1, -0.32, 0.09]];
        for (i = 0; i < craters.length; i++) {
            ctx.beginPath();
            ctx.arc(mx + craters[i][0] * mr, my + craters[i][1] * mr, Math.max(1, craters[i][2] * mr), 0, Math.PI * 2);
            ctx.fill();
        }
        return;
    }

    if (kind === 'moon') {
        /* Foreground lunar surface for the launcher footer. */
        ctx.fillStyle = '#c98a00';
        var baseY = Math.round(h * 0.42);
        for (i = 0; i < w; i++) {
            var y = baseY + Math.round(Math.sin(i / 9) * 3 + Math.sin(i / 3.1) * 1.4);
            ctx.fillRect(i, y, 1, h - y);
        }
        ctx.fillStyle = '#ffc61a';
        for (i = 0; i < w; i++) {
            var yy = baseY + Math.round(Math.sin(i / 9) * 3 + Math.sin(i / 3.1) * 1.4);
            ctx.fillRect(i, yy, 1, 2);
        }
        ctx.fillStyle = '#a77400';
        for (i = 0; i < Math.floor(w / 14); i++) {
            var cx = Math.floor(Math.random() * w);
            var cy = baseY + 5 + Math.floor(Math.random() * Math.max(1, h - baseY - 6));
            ctx.fillRect(cx, cy, 3, 1);
            ctx.fillRect(cx + 1, cy + 1, 1, 1);
        }
    }
}

/* ------------------------------------------------------------------- boot */

/* pxUpgradeText replaces the text of every [data-px] node with pixel-art SVG. */
function pxUpgradeText(root) {
    var nodes = (root || document).querySelectorAll('[data-px]');
    var i;
    for (i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        if (el.getAttribute('data-px-done') !== null) {
            continue;
        }
        var raw = el.getAttribute('data-px') || el.textContent;
        var scale = parseInt(el.getAttribute('data-px-scale'), 10) || 3;
        var shadowAttr = el.getAttribute('data-px-shadow');
        el.setAttribute('aria-label', raw.replace(/\|/g, ' '));
        el.innerHTML = pxTextSVG(raw, {
            scale: scale,
            shadow: shadowAttr === 'none' ? null : (shadowAttr || undefined)
        });
        el.setAttribute('data-px-done', '1');
    }
}

/* pxUpgradeIcons fills every [data-icon] node with its sprite. */
function pxUpgradeIcons(root) {
    var nodes = (root || document).querySelectorAll('[data-icon]');
    var i;
    for (i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        if (el.getAttribute('data-icon-done') !== null) {
            continue;
        }
        var svg = pxSpriteSVG(el.getAttribute('data-icon'), {
            label: el.getAttribute('data-icon-label') || ''
        });
        if (svg) {
            el.innerHTML = svg;
            el.setAttribute('data-icon-done', '1');
        }
    }
}

/*
    pxWrapScreen moves a game page's own markup into the shared .px-screen
    shell. Pages that already ship a .px-screen (the launcher) are left alone.
    Elements stay in the document, so references captured by the page's own
    scripts remain valid.
*/
function pxWrapScreen() {
    if (document.querySelector('.px-screen')) {
        return;
    }
    var screen = document.createElement('div');
    screen.className = 'px-screen';

    var kids = Array.prototype.slice.call(document.body.children);
    var i;
    for (i = 0; i < kids.length; i++) {
        var el = kids[i];
        var tag = el.tagName.toLowerCase();
        if (tag === 'script' || tag === 'link' || tag === 'style') {
            continue;
        }
        if (el.classList.contains('overlay') || el.classList.contains('px-stars')) {
            continue;
        }
        screen.appendChild(el);
    }
    document.body.insertBefore(screen, document.body.firstChild);
}

function pxBoot() {
    if (!document.body.classList.contains('arcade')) {
        return;
    }

    var stars = document.createElement('canvas');
    stars.className = 'px-stars';
    stars.setAttribute('aria-hidden', 'true');
    document.body.insertBefore(stars, document.body.firstChild);
    pxDrawStars(stars);

    pxWrapScreen();
    pxUpgradeIcons(document);
    pxUpgradeText(document);

    var scenes = document.querySelectorAll('[data-scene]');
    var i;
    for (i = 0; i < scenes.length; i++) {
        pxDrawScene(scenes[i], scenes[i].getAttribute('data-scene'));
    }

    var resizeTimer = null;
    window.addEventListener('resize', function () {
        if (resizeTimer) {
            clearTimeout(resizeTimer);
        }
        resizeTimer = setTimeout(function () {
            pxDrawStars(stars);
            var j;
            for (j = 0; j < scenes.length; j++) {
                pxDrawScene(scenes[j], scenes[j].getAttribute('data-scene'));
            }
        }, 200);
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', pxBoot);
} else {
    pxBoot();
}
