/*
    ass.js — Advanced SubStation Alpha parser and DOM renderer

    Renders ASS/SSA subtitle tracks with their original styling instead of
    flattening them to plain text. That matters for releases which show two
    languages at once: a Japanese line pinned near the top and a Chinese line
    below it are two separate events with different styles, and any renderer
    that only shows "the cue at time t" will silently drop one of them.

    Written in-repo rather than pulling in libass/WASM, so there is no binary
    blob to vendor and nothing to fetch at runtime.

    Supported
      • [V4+ Styles] and [V4 Styles]: font, size, colours, bold/italic/underline/
        strikeout, outline, shadow, opaque box, alignment, margins, spacing,
        ScaleX/ScaleY
      • Positioning: \an, \a, \pos, \move (animated), \org, margins, PlayRes
        scaling, \frz rotation about the alignment point
      • Vector drawings (\p) — rendered as SVG paths, which is what typesetters
        use to paint the opaque plates that cover on-screen Japanese signage
      • Vertical text — an "@"-prefixed font name plus the customary \frz270
        becomes real CSS vertical writing rather than a sideways line
      • Inline overrides: \b \i \u \s \fn \fs \fsp \fscx \fscy \c \1c \2c \3c \4c
        \alpha \1a \2a \3a \4a \bord \shad \blur \be \frz \fad \fade \r
      • Line breaks (\N, \n, \h), layer ordering, simultaneous events
      • Karaoke tags are stripped so the text still reads correctly

    Not supported (degrades rather than breaks)
      • Animation (\t), clipping (\clip), 3D rotation (\frx, \fry)
      • B-spline drawing commands (\p's s/p/c) are approximated by straight
        segments; m/n/l/b are exact
      • \fscx without a matching \fscy leaves the *layout* width unscaled, so a
        horizontally squashed run can sit a few pixels off centre

    Font sizing note — this is the one thing a naive renderer always gets wrong.
    ASS `Fontsize` is not the em size. VSFilter asks FreeType for a face whose
    ascender plus descender equals Fontsize, and libass copies that for
    compatibility, so the em ends up at Fontsize × upem / (winAscent+winDescent).
    CSS `font-size` is the em square. Rendering \fs60 as `font-size:60px` in a
    typical CJK face therefore draws ~16% too large, and because the surplus
    lands above the baseline the line also sits too high. Every run here is
    measured (see fontMetrics) and scaled back down.
*/
(function (global) {
'use strict';

// ─── Parsing ──────────────────────────────────────────────────────────────────

// "0:03:02.65" -> 182.65
function parseTime(value) {
    var m = String(value).trim().match(/^(\d+):(\d+):(\d+)(?:[.,](\d+))?$/);
    if (!m) { return 0; }
    var frac = m[4] ? parseFloat('0.' + m[4]) : 0;
    return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10) + frac;
}

// ASS colours are &HAABBGGRR — alpha is inverted (00 = opaque)
function parseColour(value) {
    var hex = String(value).trim().replace(/^&[Hh]/, '').replace(/&$/, '');
    if (!/^[0-9a-fA-F]+$/.test(hex)) { return { r: 255, g: 255, b: 255, a: 1 }; }
    var n = parseInt(hex.padStart(8, '0').slice(-8), 16);
    return {
        r: n & 0xff,
        g: (n >> 8) & 0xff,
        b: (n >> 16) & 0xff,
        a: 1 - (((n >> 24) & 0xff) / 255)
    };
}

function colourToCss(c) {
    return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + c.a.toFixed(3) + ')';
}

// ASS alpha overrides are &HAA& where 00 is opaque
function parseAlpha(value) {
    var hex = String(value).trim().replace(/^&[Hh]/, '').replace(/&$/, '');
    if (!/^[0-9a-fA-F]+$/.test(hex)) { return 1; }
    return 1 - (parseInt(hex.slice(-2), 16) / 255);
}

function toNumber(value, fallback) {
    var n = parseFloat(value);
    return isNaN(n) ? fallback : n;
}

// Split a "Format:" line into trimmed field names
function parseFormat(line) {
    return line.slice(line.indexOf(':') + 1).split(',').map(function (s) { return s.trim(); });
}

// Split a data line into values, keeping the final field (Text) intact even
// though it legitimately contains commas.
function splitFields(line, count) {
    var body = line.slice(line.indexOf(':') + 1);
    var parts = [];
    var start = 0;
    for (var i = 0; i < body.length && parts.length < count - 1; i++) {
        if (body[i] === ',') {
            parts.push(body.slice(start, i).trim());
            start = i + 1;
        }
    }
    parts.push(body.slice(start));
    return parts;
}

function defaultStyle() {
    return {
        name: 'Default',
        fontname: 'Arial',
        fontsize: 48,
        primary: { r: 255, g: 255, b: 255, a: 1 },
        secondary: { r: 255, g: 0, b: 0, a: 1 },
        outlineColour: { r: 0, g: 0, b: 0, a: 1 },
        backColour: { r: 0, g: 0, b: 0, a: 1 },
        bold: false, italic: false, underline: false, strikeout: false,
        spacing: 0, angle: 0,
        scaleX: 100, scaleY: 100,
        borderStyle: 1, outline: 2, shadow: 0, blur: 0,
        alignment: 2,
        marginL: 10, marginR: 10, marginV: 10
    };
}

function parseStyleLine(fields, values) {
    var s = defaultStyle();
    for (var i = 0; i < fields.length && i < values.length; i++) {
        var v = values[i];
        switch (fields[i]) {
            case 'Name':            s.name = v; break;
            case 'Fontname':        s.fontname = v; break;
            case 'Fontsize':        s.fontsize = toNumber(v, 48); break;
            case 'PrimaryColour':   s.primary = parseColour(v); break;
            case 'SecondaryColour': s.secondary = parseColour(v); break;
            case 'OutlineColour':
            case 'TertiaryColour':  s.outlineColour = parseColour(v); break;
            case 'BackColour':      s.backColour = parseColour(v); break;
            // ASS booleans are -1 for true
            case 'Bold':            s.bold = toNumber(v, 0) !== 0; break;
            case 'Italic':          s.italic = toNumber(v, 0) !== 0; break;
            case 'Underline':       s.underline = toNumber(v, 0) !== 0; break;
            case 'StrikeOut':       s.strikeout = toNumber(v, 0) !== 0; break;
            case 'ScaleX':          s.scaleX = toNumber(v, 100); break;
            case 'ScaleY':          s.scaleY = toNumber(v, 100); break;
            case 'Spacing':         s.spacing = toNumber(v, 0); break;
            case 'Angle':           s.angle = toNumber(v, 0); break;
            case 'BorderStyle':     s.borderStyle = toNumber(v, 1); break;
            case 'Outline':         s.outline = toNumber(v, 2); break;
            case 'Shadow':          s.shadow = toNumber(v, 0); break;
            case 'Alignment':       s.alignment = normaliseAlignment(toNumber(v, 2), false); break;
            case 'MarginL':         s.marginL = toNumber(v, 10); break;
            case 'MarginR':         s.marginR = toNumber(v, 10); break;
            case 'MarginV':         s.marginV = toNumber(v, 10); break;
        }
    }
    return s;
}

// Legacy SSA uses a different alignment numbering (1-3 bottom, 5-7 top,
// 9-11 middle); ASS uses numpad layout. Normalise everything to numpad.
function normaliseAlignment(value, isLegacy) {
    if (!isLegacy) {
        return (value >= 1 && value <= 9) ? value : 2;
    }
    var horizontal = ((value - 1) % 4);      // 0 left, 1 centre, 2 right
    if (horizontal > 2) { horizontal = 1; }
    if (value >= 9)      { return 4 + horizontal; }   // middle row
    if (value >= 5)      { return 7 + horizontal; }   // top row
    return 1 + horizontal;                            // bottom row
}

// Numpad alignment -> the fractions of the text block that sit at the anchor.
// hf 0/0.5/1 across, vf 1/0.5/0 down (bottom row anchors at the block's bottom).
function alignFractions(align) {
    var h = ((align - 1) % 3);
    var v = Math.floor((align - 1) / 3);
    return { h: h, v: v, hf: h / 2, vf: [1, 0.5, 0][v] };
}

function parse(text) {
    var track = {
        playResX: 384, playResY: 288,
        wrapStyle: 0,
        scaledBorderAndShadow: true,
        styles: {},
        events: []
    };

    var lines = String(text).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    var section = '';
    var styleFormat = null;
    var eventFormat = null;
    var legacyStyles = false;

    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line || line.charAt(0) === ';') { continue; }

        if (line.charAt(0) === '[') {
            section = line.replace(/^\[|\]$/g, '').toLowerCase();
            legacyStyles = (section === 'v4 styles');
            continue;
        }

        if (section === 'script info') {
            var kv = line.split(':');
            if (kv.length < 2) { continue; }
            var key = kv[0].trim().toLowerCase();
            var val = kv.slice(1).join(':').trim();
            if (key === 'playresx') { track.playResX = toNumber(val, 384); }
            else if (key === 'playresy') { track.playResY = toNumber(val, 288); }
            else if (key === 'wrapstyle') { track.wrapStyle = toNumber(val, 0); }
            else if (key === 'scaledborderandshadow') {
                track.scaledBorderAndShadow = /^yes$/i.test(val);
            }
            continue;
        }

        if (section === 'v4+ styles' || section === 'v4 styles') {
            if (/^Format\s*:/i.test(line)) { styleFormat = parseFormat(line); continue; }
            if (/^Style\s*:/i.test(line) && styleFormat) {
                var sv = splitFields(line, styleFormat.length);
                var style = parseStyleLine(styleFormat, sv);
                if (legacyStyles) {
                    // re-normalise using the legacy numbering
                    var rawAlign = sv[styleFormat.indexOf('Alignment')];
                    style.alignment = normaliseAlignment(toNumber(rawAlign, 2), true);
                }
                track.styles[style.name] = style;
            }
            continue;
        }

        if (section === 'events') {
            if (/^Format\s*:/i.test(line)) { eventFormat = parseFormat(line); continue; }
            if (/^Dialogue\s*:/i.test(line) && eventFormat) {
                var ev = parseEventLine(eventFormat, splitFields(line, eventFormat.length));
                if (ev) { track.events.push(ev); }
            }
            continue;
        }
    }

    if (!track.styles.Default) { track.styles.Default = defaultStyle(); }
    // Stable ordering: by layer, then by start, so z-index follows the format's
    // rules. Array.prototype.sort is stable, which keeps events that share a
    // layer and a start time in file order — that is what puts a typesetter's
    // opaque plate behind the text meant to sit on it.
    track.events.sort(function (a, b) {
        return (a.layer - b.layer) || (a.start - b.start);
    });
    return track;
}

function parseEventLine(fields, values) {
    var ev = { layer: 0, start: 0, end: 0, style: 'Default', marginL: 0, marginR: 0, marginV: 0, text: '' };
    for (var i = 0; i < fields.length && i < values.length; i++) {
        switch (fields[i]) {
            case 'Layer':
            case 'Marked':  ev.layer = toNumber(String(values[i]).replace(/^Marked=/i, ''), 0); break;
            case 'Start':   ev.start = parseTime(values[i]); break;
            case 'End':     ev.end = parseTime(values[i]); break;
            case 'Style':   ev.style = String(values[i]).replace(/^\*+/, '') || 'Default'; break;
            case 'MarginL': ev.marginL = toNumber(values[i], 0); break;
            case 'MarginR': ev.marginR = toNumber(values[i], 0); break;
            case 'MarginV': ev.marginV = toNumber(values[i], 0); break;
            case 'Text':    ev.text = values[i]; break;
        }
    }
    if (ev.end <= ev.start) { return null; }
    return ev;
}

// ─── Font metrics ─────────────────────────────────────────────────────────────
//
// See the header note: ASS Fontsize means "ascent + descent", CSS font-size
// means "em". Canvas TextMetrics reports the very same ascent/descent the
// layout engine will use for the inline box, so one probe per (face, weight,
// slant, script) yields both the em correction and where the baseline sits.
var PROBE_PX = 1024;
var metricsCanvas = null;
var metricsCache = {};

// Embedded fonts arrive after the first frames have already been drawn, so the
// player invalidates the cache once a face lands and lets the renderer redraw.
function invalidateFontMetrics() { metricsCache = {}; }

// Metrics follow the face actually chosen for the glyphs, so probe with a
// character out of the run itself rather than a fixed latin letter.
function probeGlyph(sample) {
    var s = String(sample || '');
    for (var i = 0; i < s.length; i++) {
        if (!/[\s\u00a0]/.test(s.charAt(i))) { return s.charAt(i); }
    }
    return 'M';
}

function fontMetrics(state, sample) {
    var stack = cssFontStack(state.fontname);
    var head = (state.italic ? 'italic ' : '') + (state.bold ? 'bold ' : '');
    var ch = probeGlyph(sample);
    var key = head + stack + '\u0000' + ch;
    if (metricsCache[key]) { return metricsCache[key]; }

    var m = { scale: 1, ascent: 0.8, space: 0.25 };   // sane fallback if the probe fails
    try {
        if (!metricsCanvas) { metricsCanvas = document.createElement('canvas'); }
        var ctx = metricsCanvas.getContext('2d');
        ctx.font = head + PROBE_PX + 'px ' + stack;
        var t = ctx.measureText(ch);
        var asc = t.fontBoundingBoxAscent, desc = t.fontBoundingBoxDescent;
        if (typeof asc === 'number' && typeof desc === 'number' && asc + desc > 0) {
            m = {
                scale: PROBE_PX / (asc + desc),
                ascent: asc / (asc + desc),
                space: ctx.measureText(' ').width / PROBE_PX
            };
        }
    } catch (e) {}
    metricsCache[key] = m;
    return m;
}

// ─── Override tag handling ────────────────────────────────────────────────────

// Split event text into runs, each with its own formatting state. Block-level
// effects (position, alignment, fade) are collected onto the returned object.
function buildRuns(text, baseStyle, styles) {
    var block = { align: null, pos: null, move: null, org: null, fade: null, rotate: 0 };
    var runs = [];
    var current = cloneRunState(baseStyle);
    var buffer = '';

    function flush() {
        if (buffer.length > 0) {
            runs.push({ state: cloneRunState(current), text: buffer });
            buffer = '';
        }
    }

    var i = 0;
    while (i < text.length) {
        var ch = text.charAt(i);

        if (ch === '\\' && i + 1 < text.length) {
            var next = text.charAt(i + 1);
            if (next === 'N') { flush(); runs.push({ lineBreak: true }); i += 2; continue; }
            if (next === 'n') { flush(); runs.push({ lineBreak: true }); i += 2; continue; }
            if (next === 'h') { buffer += '\u00a0'; i += 2; continue; }
        }

        if (ch === '{') {
            var close = text.indexOf('}', i);
            if (close === -1) { buffer += text.slice(i); break; }
            flush();
            applyOverrides(text.slice(i + 1, close), current, block, baseStyle, styles);
            i = close + 1;
            continue;
        }

        buffer += ch;
        i++;
    }
    flush();

    return { runs: runs, block: block };
}

function cloneRunState(style) {
    return {
        fontname: style.fontname,
        fontsize: style.fontsize,
        primary: style.primary,
        outlineColour: style.outlineColour,
        backColour: style.backColour,
        bold: style.bold,
        italic: style.italic,
        underline: style.underline,
        strikeout: style.strikeout,
        spacing: style.spacing,
        scaleX: style.scaleX === undefined ? 100 : style.scaleX,
        scaleY: style.scaleY === undefined ? 100 : style.scaleY,
        outline: style.outline,
        shadow: style.shadow,
        blur: style.blur || 0,
        borderStyle: style.borderStyle,
        drawScale: style.drawScale || 0
    };
}

function applyOverrides(chunk, state, block, baseStyle, styles) {
    // Each override starts with a backslash; arguments may contain commas and
    // nested parentheses, so match the tag name then take everything up to the
    // next backslash that is not inside parentheses.
    var i = 0;
    while (i < chunk.length) {
        if (chunk.charAt(i) !== '\\') { i++; continue; }
        var j = i + 1;
        var depth = 0;
        while (j < chunk.length) {
            var c = chunk.charAt(j);
            if (c === '(') { depth++; }
            else if (c === ')') { depth--; }
            else if (c === '\\' && depth <= 0) { break; }
            j++;
        }
        applyOneOverride(chunk.slice(i + 1, j), state, block, baseStyle, styles);
        i = j;
    }
}

function applyOneOverride(tag, state, block, baseStyle, styles) {
    var m;

    if ((m = tag.match(/^an(\d+)$/i)))  { block.align = normaliseAlignment(parseInt(m[1], 10), false); return; }
    if ((m = tag.match(/^a(\d+)$/i)))   { block.align = normaliseAlignment(parseInt(m[1], 10), true); return; }
    if ((m = tag.match(/^pos\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)$/i))) {
        block.pos = { x: parseFloat(m[1]), y: parseFloat(m[2]) }; return;
    }
    if ((m = tag.match(/^org\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)$/i))) {
        block.org = { x: parseFloat(m[1]), y: parseFloat(m[2]) }; return;
    }
    if ((m = tag.match(/^move\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*(?:,\s*([\d.]+)\s*,\s*([\d.]+)\s*)?\)$/i))) {
        block.move = {
            x1: parseFloat(m[1]), y1: parseFloat(m[2]),
            x2: parseFloat(m[3]), y2: parseFloat(m[4]),
            t1: m[5] !== undefined ? parseFloat(m[5]) / 1000 : null,
            t2: m[6] !== undefined ? parseFloat(m[6]) / 1000 : null
        };
        block.pos = { x: block.move.x1, y: block.move.y1 };
        return;
    }
    if ((m = tag.match(/^fad\(\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/i))) {
        block.fade = { inMs: parseFloat(m[1]), outMs: parseFloat(m[2]) }; return;
    }
    if ((m = tag.match(/^fade\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i))) {
        block.fade = { inMs: parseFloat(m[2]), outMs: parseFloat(m[3]) }; return;
    }
    if ((m = tag.match(/^frz?([-\d.]+)$/i))) { block.rotate = parseFloat(m[1]); return; }
    if ((m = tag.match(/^p([\d.]+)$/i)) && !/^pos/i.test(tag)) {
        state.drawScale = Math.max(0, parseFloat(m[1])); return;
    }

    if ((m = tag.match(/^r(.*)$/i)) && !/^rnd/i.test(tag)) {
        var target = m[1].trim();
        var reset = (target && styles[target]) ? styles[target] : baseStyle;
        var drawing = state.drawScale;
        var fresh = cloneRunState(reset);
        for (var k in fresh) { if (Object.prototype.hasOwnProperty.call(fresh, k)) { state[k] = fresh[k]; } }
        state.drawScale = drawing;   // \r restores the style, not the drawing mode
        return;
    }

    if ((m = tag.match(/^b(\d+)$/i)))  { state.bold = parseInt(m[1], 10) !== 0; return; }
    if ((m = tag.match(/^i(\d)$/i)))   { state.italic = m[1] !== '0'; return; }
    if ((m = tag.match(/^u(\d)$/i)))   { state.underline = m[1] !== '0'; return; }
    if ((m = tag.match(/^s(\d)$/i)))   { state.strikeout = m[1] !== '0'; return; }
    if ((m = tag.match(/^fn(.+)$/i)))  { state.fontname = m[1].trim(); return; }
    if ((m = tag.match(/^fs([\d.]+)$/i)))  { state.fontsize = parseFloat(m[1]); return; }
    if ((m = tag.match(/^fsp([-\d.]+)$/i))) { state.spacing = parseFloat(m[1]); return; }
    if ((m = tag.match(/^fscx([\d.]+)$/i))) { state.scaleX = parseFloat(m[1]); return; }
    if ((m = tag.match(/^fscy([\d.]+)$/i))) { state.scaleY = parseFloat(m[1]); return; }
    if ((m = tag.match(/^bord([\d.]+)$/i))) { state.outline = parseFloat(m[1]); return; }
    if ((m = tag.match(/^shad([\d.]+)$/i))) { state.shadow = parseFloat(m[1]); return; }
    if ((m = tag.match(/^blur([\d.]+)$/i))) { state.blur = parseFloat(m[1]); return; }
    // \be is an iterated box blur; one pass is roughly a one pixel gaussian
    if ((m = tag.match(/^be([\d.]+)$/i)))   { state.blur = parseFloat(m[1]); return; }

    if ((m = tag.match(/^(?:1?c|1c)&?[Hh]([0-9a-fA-F]+)&?$/))) {
        state.primary = parseColour('&H' + m[1]); return;
    }
    if ((m = tag.match(/^3c&?[Hh]([0-9a-fA-F]+)&?$/))) {
        state.outlineColour = parseColour('&H' + m[1]); return;
    }
    if ((m = tag.match(/^4c&?[Hh]([0-9a-fA-F]+)&?$/))) {
        state.backColour = parseColour('&H' + m[1]); return;
    }
    if ((m = tag.match(/^(?:alpha|1a)&?[Hh]([0-9a-fA-F]+)&?$/i))) {
        var a = parseAlpha(m[1]);
        state.primary = withAlpha(state.primary, a); return;
    }
    if ((m = tag.match(/^3a&?[Hh]([0-9a-fA-F]+)&?$/i))) {
        state.outlineColour = withAlpha(state.outlineColour, parseAlpha(m[1])); return;
    }
    if ((m = tag.match(/^4a&?[Hh]([0-9a-fA-F]+)&?$/i))) {
        state.backColour = withAlpha(state.backColour, parseAlpha(m[1])); return;
    }
    // Everything else (\t, \clip, \k, \frx, \fry, \2c …) is ignored on purpose
}

function withAlpha(colour, a) {
    return { r: colour.r, g: colour.g, b: colour.b, a: a };
}

// ─── Vector drawings (\p) ─────────────────────────────────────────────────────
//
// Typesetters use these for the opaque plates that cover printed Japanese
// signage before the translation is written over it, so skipping them leaves
// the original text showing through under the subtitle.
//
// Commands: m/n move, l line, b cubic bézier, s/p/c b-spline (approximated by
// straight segments). Coordinates are divided by 2^(scale-1).

function parseDrawing(text, scaleExp) {
    var div = Math.pow(2, Math.max(1, scaleExp || 1) - 1);
    var tokens = String(text).replace(/([a-zA-Z])/g, ' $1 ').trim().split(/[\s,]+/);
    var d = '';
    var open = false;
    var cmd = '';
    var nums = [];
    var cur = [0, 0];
    var bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

    function pt(x, y) {
        if (x < bounds.minX) { bounds.minX = x; }
        if (y < bounds.minY) { bounds.minY = y; }
        if (x > bounds.maxX) { bounds.maxX = x; }
        if (y > bounds.maxY) { bounds.maxY = y; }
    }

    function moveTo(x, y, close) {
        if (open && close) { d += 'Z'; }
        d += 'M' + fmt(x) + ' ' + fmt(y);
        cur = [x, y]; open = true; pt(x, y);
    }
    function lineTo(x, y) {
        if (!open) { moveTo(x, y, false); return; }
        d += 'L' + fmt(x) + ' ' + fmt(y);
        cur = [x, y]; pt(x, y);
    }
    function curveTo(x1, y1, x2, y2, x3, y3) {
        if (!open) { moveTo(x1, y1, false); }
        d += 'C' + fmt(x1) + ' ' + fmt(y1) + ' ' + fmt(x2) + ' ' + fmt(y2) + ' ' + fmt(x3) + ' ' + fmt(y3);
        var b = cubicBounds(cur, [x1, y1], [x2, y2], [x3, y3]);
        pt(b[0], b[1]); pt(b[2], b[3]);
        cur = [x3, y3];
    }

    // Consume however many coordinate pairs the pending command takes.
    function drain(final) {
        if (!cmd) { nums = []; return; }
        var i;
        if (cmd === 'm' || cmd === 'n') {
            for (i = 0; i + 1 < nums.length; i += 2) { moveTo(nums[i], nums[i + 1], cmd === 'm'); }
        } else if (cmd === 'l' || cmd === 'p') {
            for (i = 0; i + 1 < nums.length; i += 2) { lineTo(nums[i], nums[i + 1]); }
        } else if (cmd === 'b') {
            for (i = 0; i + 5 < nums.length; i += 6) {
                curveTo(nums[i], nums[i + 1], nums[i + 2], nums[i + 3], nums[i + 4], nums[i + 5]);
            }
        } else if (cmd === 's') {
            // B-spline approximated by its control polygon
            for (i = 0; i + 1 < nums.length; i += 2) { lineTo(nums[i], nums[i + 1]); }
        }
        nums = [];
        if (final && open) { d += 'Z'; }
    }

    for (var t = 0; t < tokens.length; t++) {
        var tok = tokens[t];
        if (!tok) { continue; }
        if (/^[a-zA-Z]$/.test(tok)) {
            drain(false);
            var lower = tok.toLowerCase();
            if (lower === 'c') { if (open) { d += 'Z'; open = false; } cmd = ''; continue; }
            cmd = lower;
            continue;
        }
        var n = parseFloat(tok);
        if (!isNaN(n)) { nums.push(n / div); }
    }
    drain(true);

    if (!d || bounds.minX === Infinity) { return null; }
    return {
        d: d,
        minX: bounds.minX, minY: bounds.minY,
        width: Math.max(0, bounds.maxX - bounds.minX),
        height: Math.max(0, bounds.maxY - bounds.minY)
    };
}

function fmt(n) {
    return (Math.round(n * 100) / 100).toString();
}

// Tight bounding box of a cubic segment — the control hull would place a curved
// drawing several pixels off, because ASS anchors a drawing by its real extent.
function cubicBounds(p0, p1, p2, p3) {
    var minX = Math.min(p0[0], p3[0]), maxX = Math.max(p0[0], p3[0]);
    var minY = Math.min(p0[1], p3[1]), maxY = Math.max(p0[1], p3[1]);
    for (var axis = 0; axis < 2; axis++) {
        var a = -p0[axis] + 3 * p1[axis] - 3 * p2[axis] + p3[axis];
        var b = 2 * (p0[axis] - 2 * p1[axis] + p2[axis]);
        var c = p1[axis] - p0[axis];
        var roots = [];
        if (Math.abs(a) < 1e-9) {
            if (Math.abs(b) > 1e-9) { roots.push(-c / b); }
        } else {
            var disc = b * b - 4 * a * c;
            if (disc >= 0) {
                var sq = Math.sqrt(disc);
                roots.push((-b + sq) / (2 * a), (-b - sq) / (2 * a));
            }
        }
        for (var i = 0; i < roots.length; i++) {
            var u = roots[i];
            if (!(u > 0 && u < 1)) { continue; }
            var mt = 1 - u;
            var v = mt * mt * mt * p0[axis] + 3 * mt * mt * u * p1[axis] +
                    3 * mt * u * u * p2[axis] + u * u * u * p3[axis];
            if (axis === 0) { minX = Math.min(minX, v); maxX = Math.max(maxX, v); }
            else            { minY = Math.min(minY, v); maxY = Math.max(maxY, v); }
        }
    }
    return [minX, minY, maxX, maxY];
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Renderer draws events into an overlay element.
 *
 * The overlay must be positioned over the video's *displayed* rectangle; call
 * resize(width, height) whenever that changes so PlayRes coordinates map onto
 * real pixels.
 */
function Renderer(overlay) {
    this.overlay = overlay;
    this.track = null;
    this.width = 0;
    this.height = 0;
    this.scale = 1;
    this._lastKey = null;
    this._suppressBefore = 0;
}

Renderer.prototype.setTrack = function (track) {
    this.track = track;
    this._lastKey = null;
    this.clear();
};

Renderer.prototype.resize = function (width, height) {
    this.width = width;
    this.height = height;
    if (this.track && this.track.playResY > 0) {
        // Uniform scale off the vertical axis, matching how libass maps a script
        // onto a frame of a different size.
        this.scale = height / this.track.playResY;
    }
    this._lastKey = null;   // force a redraw at the new geometry
};

Renderer.prototype.clear = function () {
    if (this.overlay) { this.overlay.innerHTML = ''; }
    this._lastKey = null;
};

/**
 * Ignore any line that had already begun before `time`.
 *
 * Seeking into the middle of a line would otherwise drop the viewer into a
 * half-shown caption. Everything already in flight at the landing point is
 * skipped; the next line to *begin* after it plays normally.
 */
Renderer.prototype.setSuppressBefore = function (time) {
    this._suppressBefore = Math.max(0, time || 0);
    this._lastKey = null;   // rebuild now so a suppressed line disappears at once
};

Renderer.prototype.activeEvents = function (time) {
    var out = [];
    if (!this.track) { return out; }
    var floor = this._suppressBefore || 0;
    var events = this.track.events;
    for (var i = 0; i < events.length; i++) {
        var ev = events[i];
        if (time < ev.start || time > ev.end) { continue; }
        if (ev.start < floor) { continue; }   // was already on screen when we landed
        out.push(ev);
    }
    return out;
};

Renderer.prototype.setTime = function (time) {
    if (!this.overlay || !this.track) { return; }

    var active = this.activeEvents(time);

    // Rebuilding the DOM every frame would thrash layout — and most events in a
    // typical release carry a fade, so keying off "has a fade" would rebuild
    // almost constantly. Instead the DOM is rebuilt only when the visible set
    // changes, and fades and \move are applied by touching the existing nodes.
    var key = active.map(function (e) {
        return e.start + '/' + e.end + '/' + e.style + '/' + e.text.length;
    }).join('|');

    if (key !== this._lastKey) {
        this._lastKey = key;
        var html = '';
        var meta = [];
        for (var j = 0; j < active.length; j++) {
            var piece = this.renderEvent(active[j], meta.length);
            if (!piece) { continue; }
            html += piece.html;
            meta.push({ ev: active[j], fade: piece.fade, move: piece.move });
        }
        this.overlay.innerHTML = html;
        this._meta = meta;
        this._children = Array.prototype.slice.call(this.overlay.children);
        this.resolveCollisions();
    }

    this.applyDynamics(time);
};

// Nudge margin-positioned lines apart when they would overlap.
//
// Releases stack dual-language subtitles by giving each style a different
// MarginV, which assumes every line is exactly as tall as the author expected.
// One line wrapping — or a font whose metrics differ slightly from the one the
// script was typeset against — makes a block taller and it collides with its
// neighbour. libass resolves this the same way, by pushing the later event
// further from the anchored edge.
//
// Two limits matter, because without them the pass does more harm than good:
//
//   • Events only collide within their own layer. Karaoke is typeset as two
//     copies of the same line — a blurred glow on one layer and the sharp text
//     on the next — which are meant to land exactly on top of each other. Pull
//     them apart and every opening and ending shows its lyrics twice.
//   • Events only collide when their text boxes overlap horizontally. A note
//     pinned to the top-left corner and a centred line sit in the same band
//     without touching, so neither should move.
Renderer.prototype.resolveCollisions = function () {
    if (!this._children || this._children.length < 2 || !this.overlay) { return; }

    var placed = {};              // "edge|layer" -> bands already occupied
    var limit = this.height || 0;
    var base = this.overlay.getBoundingClientRect();
    var range = document.createRange();

    for (var i = 0; i < this._children.length; i++) {
        var el = this._children[i];
        var anchor = el.getAttribute('data-anchor');
        if (anchor !== 'top' && anchor !== 'bottom') { continue; }   // \pos and middle are left alone

        var layer = (this._meta && this._meta[i]) ? this._meta[i].ev.layer : 0;
        var key = anchor + '|' + layer;
        var bands = placed[key] || (placed[key] = []);

        // The block spans the full margin box, but only the text inside it can
        // collide, so measure the content rather than the element — and, where a
        // blurred border added a full-bleed layer behind the text, only the text
        // layer, or every line would look as wide as the picture.
        range.selectNodeContents(el.querySelector('[data-fill]') || el);
        var box = range.getBoundingClientRect();
        var left = box.left - base.left;
        var right = box.right - base.left;

        var offset = parseFloat(el.getAttribute('data-offset')) || 0;
        var height = el.offsetHeight;

        // Repeatedly push past whatever it overlaps until the slot is clear
        var moved = true;
        var guard = 0;
        while (moved && guard++ < 32) {
            moved = false;
            for (var b = 0; b < bands.length; b++) {
                var band = bands[b];
                if (offset >= band.end || band.start >= offset + height) { continue; }
                if (left >= band.right || band.left >= right) { continue; }
                offset = band.end;
                moved = true;
            }
        }
        // Never push a line off the picture; overlapping is better than invisible
        if (limit > 0 && offset + height > limit) {
            offset = Math.max(0, limit - height);
        }

        bands.push({ start: offset, end: offset + height, left: left, right: right });
        el.style[anchor] = offset.toFixed(1) + 'px';
    }
};

Renderer.prototype.applyDynamics = function (time) {
    if (!this._meta || !this._children) { return; }
    for (var i = 0; i < this._meta.length; i++) {
        var el = this._children[i];
        if (!el) { continue; }
        var entry = this._meta[i];

        var value = entry.fade ? this.fadeOpacity(entry.fade, entry.ev, time) : 1;
        var next = value >= 1 ? '' : value.toFixed(3);
        if (el.style.opacity !== next) { el.style.opacity = next; }

        if (entry.move) { this.applyMove(el, entry.move, entry.ev, time); }
    }
};

Renderer.prototype.applyMove = function (el, move, ev, time) {
    var s = this.scale;
    var from = (move.t1 === null ? 0 : move.t1);
    var to   = (move.t2 === null || move.t2 <= from) ? (ev.end - ev.start) : move.t2;
    var at   = time - ev.start;
    var k = to > from ? (at - from) / (to - from) : 1;
    k = Math.max(0, Math.min(1, k));

    var x = (move.x1 + (move.x2 - move.x1) * k + move.dx) * s;
    var y = (move.y1 + (move.y2 - move.y1) * k + move.dy) * s;
    el.style.left = x.toFixed(1) + 'px';
    el.style.top  = y.toFixed(1) + 'px';
};

Renderer.prototype.fadeOpacity = function (fade, ev, time) {
    if (!fade) { return 1; }
    var inSec = (fade.inMs || 0) / 1000;
    var outSec = (fade.outMs || 0) / 1000;
    if (inSec > 0 && time < ev.start + inSec) {
        return Math.max(0, Math.min(1, (time - ev.start) / inSec));
    }
    if (outSec > 0 && time > ev.end - outSec) {
        return Math.max(0, Math.min(1, (ev.end - time) / outSec));
    }
    return 1;
};

// Returns {html, fade, move} or null when the event produces nothing to draw.
Renderer.prototype.renderEvent = function (ev, order) {
    var track = this.track;
    var style = track.styles[ev.style] || track.styles.Default;
    var built = buildRuns(ev.text, style, track.styles);

    var drawRuns = [], textRuns = [], i, run;
    for (i = 0; i < built.runs.length; i++) {
        run = built.runs[i];
        if (run.lineBreak) { textRuns.push(run); continue; }
        if (run.state && run.state.drawScale > 0) { drawRuns.push(run); }
        else { textRuns.push(run); }
    }

    if (drawRuns.length) { return this.renderDrawing(ev, style, built.block, drawRuns, order); }
    return this.renderText(ev, style, built.block, textRuns, order);
};

Renderer.prototype.renderText = function (ev, style, block, runs, order) {
    var i, run;

    // An "@" prefixed family is Windows' vertical-writing variant: the glyphs
    // are pre-rotated, and the script pairs it with \frz270 to stand the line
    // up. CSS can do that natively, and doing it natively is the only way the
    // characters stay upright instead of lying on their side.
    var vertical = false;
    for (i = 0; i < runs.length; i++) {
        if (runs[i].state && /^@/.test(runs[i].state.fontname)) { vertical = true; break; }
    }

    var fill = '', outlineLayer = '';
    var needsOutlineLayer = false;
    for (i = 0; i < runs.length; i++) {
        run = runs[i];
        if (run.lineBreak) { continue; }
        if (run.text && run.state.blur > 0 && run.state.outline > 0 && run.state.borderStyle !== 3) {
            needsOutlineLayer = true;
        }
    }

    // A CSS block contributes a "strut" — an invisible inline box as tall as
    // its own line-height — to every line, so a style whose Fontsize is larger
    // than the \fs the line actually uses would silently pad the line (and, in
    // vertical writing, widen the column and push the text off its anchor).
    // ASS has no such thing, so the strut is zeroed and blank lines get an
    // explicit filler instead.
    var filler = '<span style="font-size:0;line-height:' +
                 (style.fontsize * this.scale).toFixed(2) + 'px;">\u200b</span>';
    var lineHasText = false;

    for (i = 0; i < runs.length; i++) {
        run = runs[i];
        if (run.lineBreak) {
            var lead = lineHasText ? '' : filler;
            fill += lead + '<br>';
            outlineLayer += lead + '<br>';
            lineHasText = false;
            continue;
        }
        if (!run.text) { continue; }
        lineHasText = true;
        var body = this.runBody(run.state, run.text, vertical);
        fill += '<span style="' + this.runCss(run.state, run.text, 'fill') + '">' + body + '</span>';
        if (needsOutlineLayer) {
            outlineLayer += '<span style="' + this.runCss(run.state, run.text, 'outline') + '">' + body + '</span>';
        }
    }
    if (!fill) { return null; }

    var align = block.align !== null ? block.align : style.alignment;
    var box = this.boxCss(ev, style, align, block, order, vertical);

    var inner = fill;
    if (needsOutlineLayer) {
        // A blurred border has to be its own layer: libass blurs the dilated
        // silhouette and then paints the sharp glyph on top of it, and there is
        // no single-element CSS equivalent. Both layers hold identical text at
        // identical metrics, so they line up exactly.
        inner = '<div style="position:absolute;left:0;top:0;width:100%;height:100%;">' +
                    outlineLayer +
                '</div><div data-fill="1" style="position:relative;">' + fill + '</div>';
    }

    return {
        html: '<div ' + box.attrs + ' style="' + box.css + '">' + inner + '</div>',
        fade: block.fade,
        move: box.move
    };
};

Renderer.prototype.renderDrawing = function (ev, style, block, runs, order) {
    var s = this.scale;
    var state = runs[0].state;
    var text = '';
    for (var i = 0; i < runs.length; i++) { text += runs[i].text; }

    var path = parseDrawing(text, state.drawScale);
    if (!path || (path.width <= 0 && path.height <= 0)) { return null; }

    var align = block.align !== null ? block.align : style.alignment;
    var f = alignFractions(align);

    // libass places a drawing by treating its bounding box as a glyph box: the
    // drawing's own origin lands at pos - (hf*width, vf*height), and the path
    // is then painted in its raw coordinates. The visible box therefore sits at
    // that origin plus the path's own minimum, which is *not* centred on \pos
    // unless the path starts at 0,0.
    var originX, originY;
    if (block.pos) {
        originX = block.pos.x - f.hf * path.width;
        originY = block.pos.y - f.vf * path.height;
    } else {
        var marginL = (ev.marginL || style.marginL);
        var marginR = (ev.marginR || style.marginR);
        var marginV = (ev.marginV || style.marginV);
        var availW = this.track.playResX - marginL - marginR;
        originX = f.h === 0 ? marginL
                : f.h === 2 ? (this.track.playResX - marginR - path.width)
                : (marginL + (availW - path.width) / 2);
        originY = f.v === 0 ? (this.track.playResY - marginV - path.height)
                : f.v === 2 ? marginV
                : ((this.track.playResY - path.height) / 2);
    }

    var border = state.borderStyle === 3 ? 0 : state.outline;
    var css = 'position:absolute;overflow:visible;';
    css += 'left:' + ((originX + path.minX) * s).toFixed(1) + 'px;';
    css += 'top:'  + ((originY + path.minY) * s).toFixed(1) + 'px;';
    css += 'width:'  + Math.max(1, path.width * s).toFixed(1) + 'px;';
    css += 'height:' + Math.max(1, path.height * s).toFixed(1) + 'px;';
    css += 'z-index:' + (10 + order) + ';';

    if (block.rotate) {
        css += 'transform-origin:' + ((f.hf * path.width - path.minX) * s).toFixed(1) + 'px ' +
               ((f.vf * path.height - path.minY) * s).toFixed(1) + 'px;';
        css += 'transform:rotate(' + (-block.rotate) + 'deg);';
    }

    var filters = [];
    if (state.shadow > 0) {
        var d = (state.shadow * this.effectScale()).toFixed(2);
        filters.push('drop-shadow(' + d + 'px ' + d + 'px 0 ' + colourToCss(state.backColour) + ')');
    }
    if (state.blur > 0) {
        filters.push('blur(' + (state.blur * this.effectScale()).toFixed(2) + 'px)');
    }
    if (filters.length) { css += 'filter:' + filters.join(' ') + ';'; }

    var svg = '<svg style="overflow:visible;display:block;" width="100%" height="100%" ' +
              'viewBox="' + fmt(path.minX) + ' ' + fmt(path.minY) + ' ' +
              fmt(Math.max(path.width, 0.01)) + ' ' + fmt(Math.max(path.height, 0.01)) + '" ' +
              'preserveAspectRatio="none">' +
              '<path d="' + path.d + '" fill="' + colourToCss(state.primary) + '"' +
              (border > 0
                  ? ' stroke="' + colourToCss(state.outlineColour) + '" stroke-width="' +
                    fmt(border * 2) + '" paint-order="stroke"'
                  : '') +
              '/></svg>';

    return {
        html: '<div style="' + css + '">' + svg + '</div>',
        fade: block.fade,
        move: block.move
            ? { x1: block.move.x1, y1: block.move.y1, x2: block.move.x2, y2: block.move.y2,
                t1: block.move.t1, t2: block.move.t2,
                dx: path.minX - f.hf * path.width, dy: path.minY - f.vf * path.height }
            : null
    };
};

// Border and shadow follow the picture only when ScaledBorderAndShadow is on;
// otherwise the script means literal pixels at the script's own resolution.
Renderer.prototype.effectScale = function () {
    return (this.track && this.track.scaledBorderAndShadow === false) ? 1 : this.scale;
};

// Position the text block. Alignment uses the numpad layout, so 1-3 is the
// bottom row, 4-6 the middle and 7-9 the top.
//
// Returns the inline CSS, the data attributes the collision pass needs, and the
// \move descriptor (with the offsets the per-frame update has to re-apply).
Renderer.prototype.boxCss = function (ev, style, align, block, order, vertical) {
    var s = this.scale;
    var f = alignFractions(align);

    // A zero event margin means "inherit the style's", per the format
    var marginL = (ev.marginL || style.marginL) * s;
    var marginR = (ev.marginR || style.marginR) * s;
    var marginV = (ev.marginV || style.marginV) * s;

    var css = 'position:absolute;';
    css += 'text-align:' + ['left', 'center', 'right'][f.h] + ';';
    css += 'font-size:0;line-height:0;';   // no strut — see renderText
    css += 'z-index:' + (10 + order) + ';';

    if (vertical) {
        // An "@" face carries a `vert` feature that swaps brackets and dashes
        // for pre-rotated forms; VSFilter applies it and then turns the whole
        // line back upright, so the glyph the viewer sees is the *unsubstituted*
        // one. Chrome applies `vert` on its own in vertical writing, which would
        // leave those characters lying on their side — turn it off.
        css += 'writing-mode:vertical-rl;text-orientation:upright;';
        // Single quotes: this lands inside a style="..." attribute.
        css += "font-feature-settings:'vert' 0,'vrt2' 0;";
    }

    var attrs = '';
    var move = null;

    if (block.pos) {
        // A positioned line is typeset to an exact spot; letting the browser
        // re-wrap it would move it. Only \N breaks such a line.
        css += 'white-space:pre;';
        var x = block.pos.x * s;
        var y = block.pos.y * s;
        var tx, ty, ox, oy, angle;

        if (vertical) {
            // The vertical box is the horizontal one turned a quarter turn, so
            // the anchor swaps axes: what was the bottom edge is now the left.
            tx = -(1 - f.vf) * 100; ty = -f.hf * 100;
            ox = (1 - f.vf) * 100;  oy = f.hf * 100;
            angle = 270 - block.rotate;   // \frz270 is what stands the line up
        } else {
            tx = -f.hf * 100; ty = -f.vf * 100;
            ox = f.hf * 100;  oy = f.vf * 100;
            angle = -block.rotate;
        }

        css += 'left:' + x.toFixed(1) + 'px;top:' + y.toFixed(1) + 'px;';
        css += 'transform-origin:' + ox + '% ' + oy + '%;';
        css += 'transform:translate(' + tx + '%,' + ty + '%)';
        css += angle ? ' rotate(' + angle.toFixed(3) + 'deg);' : ';';

        if (block.move) {
            move = {
                x1: block.move.x1, y1: block.move.y1,
                x2: block.move.x2, y2: block.move.y2,
                t1: block.move.t1, t2: block.move.t2,
                dx: 0, dy: 0
            };
        }
    } else {
        css += 'white-space:' + (this.wrapsAutomatically() ? 'pre-wrap' : 'pre') + ';';
        css += 'left:' + marginL.toFixed(1) + 'px;right:' + marginR.toFixed(1) + 'px;';
        if (f.v === 0) {
            css += 'bottom:' + marginV.toFixed(1) + 'px;';
            attrs = 'data-anchor="bottom" data-offset="' + marginV.toFixed(1) + '"';
        } else if (f.v === 2) {
            css += 'top:' + marginV.toFixed(1) + 'px;';
            attrs = 'data-anchor="top" data-offset="' + marginV.toFixed(1) + '"';
        } else {
            css += 'top:50%;transform:translateY(-50%);';
        }
        if (block.rotate) {
            css += 'transform-origin:' + (f.hf * 100) + '% ' + (f.vf * 100) + '%;';
            css += 'rotate:' + (-block.rotate) + 'deg;';
        }
    }
    return { css: css, attrs: attrs, move: move };
};

// WrapStyle 2 means the script is typeset to exact line lengths and must never
// be auto-wrapped — only \N breaks. Letting the browser wrap those lines makes
// a block taller than the author allowed for, which is what pushes stacked
// dual-language subtitles into each other.
Renderer.prototype.wrapsAutomatically = function () {
    return !this.track || this.track.wrapStyle !== 2;
};

/**
 * The escaped text of one run.
 *
 * In vertical writing CSS gives every character a full em cell, spaces
 * included. An "@" font is laid out horizontally and only then stood upright,
 * so ASS gives a space its ordinary — much narrower — horizontal advance, and
 * the difference accumulates: the two spaces a typesetter leaves as a slot for
 * a number stretch the column and shift everything below them. Emit those gaps
 * at their measured width instead.
 */
Renderer.prototype.runBody = function (st, text, vertical) {
    if (!vertical || !/\s/.test(text)) { return escapeHtml(text); }

    // letter-spacing is not applied after a replaced box, so \fsp has to be
    // folded into the gap itself.
    var metrics = fontMetrics(st, text);
    var gap = metrics.space * st.fontsize * this.scale * metrics.scale + st.spacing * this.scale;
    var spacer = '<span style="display:inline-block;width:0;height:' + gap.toFixed(2) + 'px;"></span>';
    var out = '';
    for (var i = 0; i < text.length; i++) {
        var ch = text.charAt(i);
        out += /\s/.test(ch) ? spacer : escapeHtml(ch);
    }
    return out;
};

/**
 * Inline CSS for one run.
 *
 * `mode` is "fill" for the normal pass, or "outline" for the copy that sits
 * behind it when a blurred border has to be drawn as its own layer: that copy
 * paints the glyph *and* its border in the border colour, which is the dilated
 * silhouette libass blurs.
 */
Renderer.prototype.runCss = function (st, sample, mode) {
    var s = this.scale;
    var es = this.effectScale();
    var metrics = fontMetrics(st, sample);
    var lineHeight = st.fontsize * s;
    var css = '';

    css += 'font-family:' + cssFontStack(st.fontname) + ';';
    // font-size is the em box; ASS sizes by ascent+descent — see the header.
    css += 'font-size:' + (lineHeight * metrics.scale).toFixed(3) + 'px;';
    // Matching line-height to the ASS size zeroes CSS half-leading, so the
    // inline box is exactly the box the script was typeset against.
    css += 'line-height:' + lineHeight.toFixed(2) + 'px;';
    if (st.bold)      { css += 'font-weight:bold;'; }
    if (st.italic)    { css += 'font-style:italic;'; }
    if (st.underline || st.strikeout) {
        css += 'text-decoration:' +
            (st.underline ? 'underline ' : '') + (st.strikeout ? 'line-through' : '') + ';';
    }
    if (st.spacing)   { css += 'letter-spacing:' + (st.spacing * s).toFixed(2) + 'px;'; }

    if (st.scaleX !== 100 || st.scaleY !== 100) {
        // Scaling from the baseline keeps the run sitting on the same line.
        css += 'display:inline-block;';
        css += 'transform-origin:0 ' + (metrics.ascent * 100).toFixed(2) + '%;';
        css += 'transform:scale(' + (st.scaleX / 100).toFixed(4) + ',' + (st.scaleY / 100).toFixed(4) + ');';
    }

    if (mode === 'outline') {
        css += 'color:' + colourToCss(st.outlineColour) + ';';
        css += '-webkit-text-stroke:' + (st.outline * 2 * es).toFixed(2) + 'px ' + colourToCss(st.outlineColour) + ';';
        css += 'filter:blur(' + (st.blur * es).toFixed(2) + 'px);';
        return css;
    }

    css += 'color:' + colourToCss(st.primary) + ';';

    if (st.borderStyle === 3) {
        // Opaque box instead of an outline
        css += 'background-color:' + colourToCss(st.outlineColour) + ';';
        css += 'box-decoration-break:clone;-webkit-box-decoration-break:clone;';
        css += 'padding:0 ' + Math.max(1, st.outline * es).toFixed(2) + 'px;';
    } else if (st.outline > 0) {
        // -webkit-text-stroke straddles the glyph edge, so a stroke of 2×bord
        // puts bord outside it — which is where ASS draws the border. paint-order
        // keeps the stroke behind the glyph so a thick one does not eat into the
        // letterforms.
        //
        // When the border is blurred the stroke lives on its own layer instead
        // (see renderText), and this run only paints the sharp fill.
        if (!(st.blur > 0)) {
            css += '-webkit-text-stroke:' + (st.outline * 2 * es).toFixed(2) + 'px ' + colourToCss(st.outlineColour) + ';';
            css += 'paint-order:stroke fill;';
        }
    } else if (st.blur > 0) {
        // No border to blur, so the glyph itself is what gets softened
        css += 'filter:blur(' + (st.blur * es).toFixed(2) + 'px);';
    }

    if (st.shadow > 0) {
        var d = (st.shadow * es).toFixed(2);
        css += 'text-shadow:' + d + 'px ' + d + 'px 0 ' + colourToCss(st.backColour) + ';';
    }
    return css;
};

// Quote the family name and keep a generic fallback so a missing embedded font
// still renders readable text.
//
// Single quotes are required: these declarations are emitted into a
// style="..." attribute, so a double-quoted family name would close the
// attribute early and silently discard every property after it.
function cssFontStack(name) {
    var clean = String(name || '').replace(/^@/, '').replace(/['"\\<>]/g, '').trim();
    if (!clean) { return 'sans-serif'; }
    return "'" + clean + "', sans-serif";
}

// Font families referenced anywhere in the track, so the player knows which
// attachments are worth downloading.
function referencedFonts(track) {
    var seen = {};
    var out = [];
    function add(name) {
        var clean = String(name || '').replace(/^@/, '').trim();
        if (clean && !seen[clean.toLowerCase()]) {
            seen[clean.toLowerCase()] = true;
            out.push(clean);
        }
    }
    for (var key in track.styles) {
        if (Object.prototype.hasOwnProperty.call(track.styles, key)) { add(track.styles[key].fontname); }
    }
    for (var i = 0; i < track.events.length; i++) {
        var tags = track.events[i].text.match(/\\fn([^\\}]+)/g);
        if (!tags) { continue; }
        for (var j = 0; j < tags.length; j++) { add(tags[j].slice(3)); }
    }
    return out;
}

global.ASS = {
    parse: parse,
    Renderer: Renderer,
    referencedFonts: referencedFonts,
    invalidateFontMetrics: invalidateFontMetrics,
    // exposed for tests
    _parseTime: parseTime,
    _parseColour: parseColour,
    _normaliseAlignment: normaliseAlignment,
    _alignFractions: alignFractions,
    _buildRuns: buildRuns,
    _parseDrawing: parseDrawing
};

})(window);
