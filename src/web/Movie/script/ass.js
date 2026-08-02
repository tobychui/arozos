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
        strikeout, outline, shadow, opaque box, alignment, margins, spacing
      • Positioning: \an, \a, \pos, \move (start point), margins, PlayRes scaling
      • Inline overrides: \b \i \u \s \fn \fs \fsp \c \1c \2c \3c \4c
        \alpha \1a \2a \3a \4a \bord \shad \frz \fad \fade \r
      • Line breaks (\N, \n, \h), layer ordering, simultaneous events
      • Karaoke tags are stripped so the text still reads correctly

    Not supported (degrades rather than breaks)
      • Vector drawing (\p) — those events are skipped instead of drawn as text
      • Animation (\t), clipping (\clip), 3D rotation (\frx, \fry), \org
      • ScaleX/ScaleY, WrapStyle nuances beyond normal wrapping
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
        borderStyle: 1, outline: 2, shadow: 0,
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
    // Stable ordering: by layer, then by start, so z-index follows the format's rules
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

// ─── Override tag handling ────────────────────────────────────────────────────

// Split event text into runs, each with its own formatting state. Block-level
// effects (position, alignment, fade) are collected onto the returned object.
function buildRuns(text, baseStyle, styles) {
    var block = { align: null, pos: null, fade: null, rotate: 0, drawing: false };
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
        outline: style.outline,
        shadow: style.shadow,
        borderStyle: style.borderStyle
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
    if ((m = tag.match(/^move\(\s*([-\d.]+)\s*,\s*([-\d.]+)/i))) {
        // Animation is unsupported; anchor at the start point so the line at
        // least appears in a sensible place.
        block.pos = { x: parseFloat(m[1]), y: parseFloat(m[2]) }; return;
    }
    if ((m = tag.match(/^fad\(\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/i))) {
        block.fade = { inMs: parseFloat(m[1]), outMs: parseFloat(m[2]) }; return;
    }
    if ((m = tag.match(/^fade\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i))) {
        block.fade = { inMs: parseFloat(m[2]), outMs: parseFloat(m[3]) }; return;
    }
    if ((m = tag.match(/^frz?([-\d.]+)$/i))) { block.rotate = parseFloat(m[1]); return; }
    if (/^p[1-9]\d*$/i.test(tag))            { block.drawing = true; return; }
    if (/^p0$/i.test(tag))                   { block.drawing = false; return; }

    if ((m = tag.match(/^r(.*)$/i)) && !/^rnd/i.test(tag)) {
        var target = m[1].trim();
        var reset = (target && styles[target]) ? styles[target] : baseStyle;
        var fresh = cloneRunState(reset);
        for (var k in fresh) { if (Object.prototype.hasOwnProperty.call(fresh, k)) { state[k] = fresh[k]; } }
        return;
    }

    if ((m = tag.match(/^b(\d+)$/i)))  { state.bold = parseInt(m[1], 10) !== 0; return; }
    if ((m = tag.match(/^i(\d)$/i)))   { state.italic = m[1] !== '0'; return; }
    if ((m = tag.match(/^u(\d)$/i)))   { state.underline = m[1] !== '0'; return; }
    if ((m = tag.match(/^s(\d)$/i)))   { state.strikeout = m[1] !== '0'; return; }
    if ((m = tag.match(/^fn(.+)$/i)))  { state.fontname = m[1].trim(); return; }
    if ((m = tag.match(/^fs([\d.]+)$/i)))  { state.fontsize = parseFloat(m[1]); return; }
    if ((m = tag.match(/^fsp([-\d.]+)$/i))) { state.spacing = parseFloat(m[1]); return; }
    if ((m = tag.match(/^bord([\d.]+)$/i))) { state.outline = parseFloat(m[1]); return; }
    if ((m = tag.match(/^shad([\d.]+)$/i))) { state.shadow = parseFloat(m[1]); return; }

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
    // Everything else (\t, \clip, \k, \fr x/y, \org, \2c …) is ignored on purpose
}

function withAlpha(colour, a) {
    return { r: colour.r, g: colour.g, b: colour.b, a: a };
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

Renderer.prototype.activeEvents = function (time) {
    var out = [];
    if (!this.track) { return out; }
    var events = this.track.events;
    for (var i = 0; i < events.length; i++) {
        if (time >= events[i].start && time <= events[i].end) { out.push(events[i]); }
    }
    return out;
};

Renderer.prototype.setTime = function (time) {
    if (!this.overlay || !this.track) { return; }

    var active = this.activeEvents(time);

    // Redrawing every frame would thrash the DOM; only rebuild when the set of
    // visible events changes. Fades still need per-frame opacity, so events
    // carrying one are excluded from the reuse check.
    var hasFade = false;
    var key = active.map(function (e) {
        return e.start + '/' + e.end + '/' + e.style + '/' + e.text.length;
    }).join('|');
    for (var i = 0; i < active.length; i++) {
        if (active[i].text.indexOf('\\fad') !== -1) { hasFade = true; break; }
    }
    if (!hasFade && key === this._lastKey) { return; }
    this._lastKey = hasFade ? null : key;

    var html = '';
    for (var j = 0; j < active.length; j++) {
        html += this.renderEvent(active[j], time, j);
    }
    this.overlay.innerHTML = html;
};

Renderer.prototype.renderEvent = function (ev, time, order) {
    var track = this.track;
    var style = track.styles[ev.style] || track.styles.Default;
    var built = buildRuns(ev.text, style, track.styles);

    // Vector drawings would render as a stream of coordinates; skip them.
    if (built.block.drawing) { return ''; }

    var body = '';
    for (var i = 0; i < built.runs.length; i++) {
        var run = built.runs[i];
        if (run.lineBreak) { body += '<br>'; continue; }
        if (!run.text) { continue; }
        body += '<span style="' + this.runCss(run.state) + '">' + escapeHtml(run.text) + '</span>';
    }
    if (!body) { return ''; }

    var align = built.block.align !== null ? built.block.align : style.alignment;
    var opacity = this.fadeOpacity(built.block.fade, ev, time);
    var box = this.boxCss(ev, style, align, built.block, opacity, order);

    return '<div style="' + box + '">' + body + '</div>';
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

// Position the text block. Alignment uses the numpad layout, so 1-3 is the
// bottom row, 4-6 the middle and 7-9 the top.
Renderer.prototype.boxCss = function (ev, style, align, block, opacity, order) {
    var s = this.scale;
    var horizontal = ((align - 1) % 3);   // 0 left, 1 centre, 2 right
    var vertical = Math.floor((align - 1) / 3);   // 0 bottom, 1 middle, 2 top

    var marginL = (ev.marginL || style.marginL) * s;
    var marginR = (ev.marginR || style.marginR) * s;
    var marginV = (ev.marginV || style.marginV) * s;

    var css = 'position:absolute;';
    css += 'text-align:' + ['left', 'center', 'right'][horizontal] + ';';
    css += 'z-index:' + (10 + order) + ';';
    if (opacity < 1) { css += 'opacity:' + opacity.toFixed(3) + ';'; }

    if (block.pos) {
        var x = block.pos.x * s;
        var y = block.pos.y * s;
        var tx = ['0', '-50%', '-100%'][horizontal];
        var ty = ['-100%', '-50%', '0'][vertical];
        css += 'left:' + x.toFixed(1) + 'px;top:' + y.toFixed(1) + 'px;';
        css += 'transform:translate(' + tx + ',' + ty + ')';
        css += block.rotate ? ' rotate(' + (-block.rotate) + 'deg);' : ';';
        css += 'white-space:pre;';
    } else {
        css += 'left:' + marginL.toFixed(1) + 'px;right:' + marginR.toFixed(1) + 'px;';
        if (vertical === 0)      { css += 'bottom:' + marginV.toFixed(1) + 'px;'; }
        else if (vertical === 2) { css += 'top:' + marginV.toFixed(1) + 'px;'; }
        else                     { css += 'top:50%;transform:translateY(-50%);'; }
        if (block.rotate) { css += 'rotate:' + (-block.rotate) + 'deg;'; }
    }
    return css;
};

Renderer.prototype.runCss = function (st) {
    var s = this.scale;
    var css = '';
    css += 'font-family:' + cssFontStack(st.fontname) + ';';
    css += 'font-size:' + (st.fontsize * s).toFixed(2) + 'px;';
    css += 'color:' + colourToCss(st.primary) + ';';
    if (st.bold)      { css += 'font-weight:bold;'; }
    if (st.italic)    { css += 'font-style:italic;'; }
    if (st.underline || st.strikeout) {
        css += 'text-decoration:' +
            (st.underline ? 'underline ' : '') + (st.strikeout ? 'line-through' : '') + ';';
    }
    if (st.spacing)   { css += 'letter-spacing:' + (st.spacing * s).toFixed(2) + 'px;'; }

    if (st.borderStyle === 3) {
        // Opaque box instead of an outline
        css += 'background-color:' + colourToCss(st.outlineColour) + ';';
        css += 'padding:0.05em 0.2em;';
    } else if (st.outline > 0) {
        // paint-order keeps the stroke behind the glyph so thick outlines do not
        // eat into the letterforms.
        css += '-webkit-text-stroke:' + (st.outline * s).toFixed(2) + 'px ' + colourToCss(st.outlineColour) + ';';
        css += 'paint-order:stroke fill;';
    }
    if (st.shadow > 0) {
        var d = (st.shadow * s).toFixed(2);
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
    // exposed for tests
    _parseTime: parseTime,
    _parseColour: parseColour,
    _normaliseAlignment: normaliseAlignment,
    _buildRuns: buildRuns
};

})(window);
