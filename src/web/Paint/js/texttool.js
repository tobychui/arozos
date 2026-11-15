/*
    Text tool. Click (or drag a box) on the picture to type; the text box
    can be moved by its frame and resized by its handles, and the font,
    size, style, alignment and colours apply while you type. The text is
    drawn into the picture when you click outside the box, press Escape or
    pick another tool.
*/
import { App } from './app.js';
import { wrapText } from './textwrap.js';
import { normRect } from './raster.js';
import { boxHandles, dragBoxHandle, handleCursor } from './shapetool.js';
import { el } from './util.js';

const LINE_HEIGHT = 1.25;

const GENERIC = ['sans-serif', 'serif', 'monospace', 'cursive'];
const CANDIDATES = ['Arial', 'Helvetica', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Segoe UI', 'Roboto', 'Noto Sans',
    'Georgia', 'Times New Roman', 'Garamond', 'Palatino', 'Courier New', 'Consolas', 'Menlo',
    'Comic Sans MS', 'Impact', 'Brush Script MT', 'Microsoft JhengHei', 'PingFang TC', 'Noto Sans CJK TC',
    'Microsoft YaHei', 'PingFang SC', 'Meiryo', 'Hiragino Sans', 'Malgun Gothic'];

export function fontCss(name) {
    return GENERIC.indexOf(name) >= 0 ? name : '"' + name.replace(/"/g, '') + '", sans-serif';
}

// Fonts installed on this device, found by comparing text widths
let fontList = null;
export function availableFonts() {
    if (fontList) {
        return fontList;
    }
    const c = document.createElement('canvas').getContext('2d');
    const sample = 'mmmmmmmmmmlli WQ永あ';
    const width = (f) => {
        c.font = '72px ' + f;
        return c.measureText(sample).width;
    };
    const base = { monospace: width('monospace'), serif: width('serif'), 'sans-serif': width('sans-serif') };
    fontList = CANDIDATES.filter((name) => {
        for (const g in base) {
            if (width('"' + name + '", ' + g) !== base[g]) {
                return true;
            }
        }
        return false;
    }).concat(GENERIC);
    return fontList;
}

export function textFont(scale) {
    const s = App.state;
    return (s.italic ? 'italic ' : '') + (s.bold ? 'bold ' : '') + Math.max(0.5, s.fontSize * scale) + 'px ' + fontCss(s.font);
}

/*
    Draw text into a box. `lines` are the lines as the text box on screen
    broke them; without them the text is wrapped here.
*/
export function renderText(ctx, text, b, opts, lines) {
    const s = App.state;
    const size = s.fontSize;
    const lh = size * LINE_HEIGHT;
    ctx.save();
    ctx.font = textFont(1);
    if (!lines) {
        lines = wrapText(text, b.w, (str) => ctx.measureText(str).width);
    }
    const h = Math.max(b.h, lines.length * lh);
    if (opts.background) {
        ctx.fillStyle = opts.background;
        ctx.fillRect(b.x, b.y, b.w, h);
    }
    const m = ctx.measureText('Mg');
    const asc = m.fontBoundingBoxAscent !== undefined ? m.fontBoundingBoxAscent : size * 0.8;
    const desc = m.fontBoundingBoxDescent !== undefined ? m.fontBoundingBoxDescent : size * 0.2;
    const baseline = (lh - (asc + desc)) / 2 + asc;
    ctx.fillStyle = opts.color;
    ctx.textBaseline = 'alphabetic';
    lines.forEach((line, i) => {
        const w = ctx.measureText(line).width;
        let x = b.x;
        if (s.align === 'center') {
            x = b.x + (b.w - w) / 2;
        } else if (s.align === 'right') {
            x = b.x + b.w - w;
        }
        const y = b.y + i * lh + baseline;
        ctx.fillText(line, x, y);
        if (s.underline && line !== '') {
            ctx.fillRect(x, y + Math.max(1, size * 0.1), w, Math.max(1, size / 16));
        }
    });
    ctx.restore();
    return { x: b.x, y: b.y, w: b.w, h: h };
}

const textTool = {
    id: 'text',
    cursor: 'text',
    box: null,
    mode: null,
    draft: null,

    isPending() {
        return !!this.box && this.ta && this.ta.value !== '';
    },

    editor() {
        if (this.wrap) {
            return this.ta;
        }
        this.ta = el('textarea', {
            spellcheck: 'false',
            autocomplete: 'off',
            'aria-label': 'Text'
        });
        // Same layout as the text box, to read back where it broke the lines
        this.mirror = el('div', { class: 'text-mirror', 'aria-hidden': 'true' });
        this.wrap = el('div', { class: 'text-editor' }, this.ta, this.mirror);
        App.view.box.appendChild(this.wrap);
        this.ta.addEventListener('input', () => this.grow());
        this.ta.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
                e.preventDefault();
                e.stopPropagation();
                this.commit();
            }
        });
        return this.ta;
    },

    /*
        The lines exactly as the text box shows them. Canvas and page measure
        text a little differently, so wrapping again could break elsewhere.
    */
    visualLines(text) {
        const m = this.mirror;
        const z = App.view.zoom;
        m.style.font = this.ta.style.font;
        m.style.lineHeight = this.ta.style.lineHeight;
        const half = (App.state.fontSize * z * LINE_HEIGHT) / 2;
        const out = [];
        const range = document.createRange();
        for (const para of text.replace(/\r\n?/g, '\n').split('\n')) {
            if (para === '') {
                out.push('');
                continue;
            }
            m.textContent = para;
            const node = m.firstChild;
            let start = 0, idx = 0, lastTop = null;
            for (const ch of para) {
                range.setStart(node, idx);
                range.setEnd(node, idx + ch.length);
                const r = range.getClientRects()[0];
                if (r) {
                    if (lastTop !== null && r.top > lastTop + half) {
                        out.push(para.slice(start, idx).replace(/\s+$/, ''));
                        start = idx;
                    }
                    lastTop = r.top;
                }
                idx += ch.length;
            }
            out.push(para.slice(start).replace(/\s+$/, ''));
        }
        m.textContent = '';
        return out;
    },

    colors() {
        const s = App.state;
        const swap = this.box && this.box.swap;
        return {
            color: swap ? s.secondary : s.primary,
            background: s.textBg ? (swap ? s.primary : s.secondary) : null
        };
    },

    style() {
        if (!this.box || !this.wrap) {
            return;
        }
        const z = App.view.zoom;
        const b = this.box;
        const s = App.state;
        const c = this.colors();
        const st = this.wrap.style;
        st.display = 'block';
        st.left = b.x * z + 'px';
        st.top = b.y * z + 'px';
        st.width = b.w * z + 'px';
        const ta = this.ta.style;
        ta.font = textFont(z);
        ta.lineHeight = String(LINE_HEIGHT);
        ta.color = c.color;
        ta.caretColor = c.color;
        ta.background = c.background || 'transparent';
        ta.textDecoration = s.underline ? 'underline' : 'none';
        ta.textAlign = s.align;
        this.grow();
    },

    // The box grows downwards with its text
    grow() {
        if (!this.box) {
            return;
        }
        const z = App.view.zoom;
        const ta = this.ta;
        ta.style.height = '0px';
        const need = ta.scrollHeight / z;
        this.box.h = Math.max(this.box.minH, need);
        ta.style.height = this.box.h * z + 'px';
        App.emit('overlay');
    },

    open(r, swap) {
        const s = App.state;
        this.box = { x: r.x, y: r.y, w: Math.max(r.w, s.fontSize), h: r.h, minH: r.h, swap: swap };
        const ta = this.editor();
        ta.value = '';
        this.style();
        ta.focus();
        setTimeout(() => ta.focus(), 0);
        App.emit('overlay');
    },

    inBox(p, margin) {
        const b = this.box;
        return p.x >= b.x - margin && p.x <= b.x + b.w + margin && p.y >= b.y - margin && p.y <= b.y + b.h + margin;
    },

    down(p, e) {
        if (this.box) {
            const h = App.view.hitHandles(p, boxHandles(this.box));
            if (h) {
                this.mode = h.id;
                this.grab = p;
                this.start = { x: this.box.x, y: this.box.y, w: this.box.w, h: this.box.h };
                return;
            }
            if (this.inBox(p, App.view.tol(10))) {
                this.mode = 'move';
                this.grab = p;
                this.start = { x: this.box.x, y: this.box.y, w: this.box.w, h: this.box.h };
                return;
            }
            // A click outside finishes the text; the next click starts new text
            this.commit();
            this.mode = 'idle';
            return;
        }
        this.mode = 'create';
        this.anchor = p;
        this.swap = e.button === 2;
        this.draft = { x: p.x, y: p.y, w: 0, h: 0 };
    },

    move(p, e) {
        if (this.mode === 'create') {
            this.draft = normRect(this.anchor.x, this.anchor.y, p.x, p.y);
            App.emit('overlay');
        } else if (this.mode === 'move') {
            this.box.x = Math.round(this.start.x + p.x - this.grab.x);
            this.box.y = Math.round(this.start.y + p.y - this.grab.y);
            this.style();
        } else if (this.mode && this.mode !== 'idle' && this.box) {
            const n = dragBoxHandle(this.start, this.mode, p.x - this.grab.x, p.y - this.grab.y, false);
            const r = normRect(n.x0, n.y0, n.x1, n.y1);
            this.box.x = Math.round(r.x);
            this.box.y = Math.round(r.y);
            this.box.w = Math.max(App.state.fontSize, Math.round(r.w));
            this.box.minH = Math.max(App.state.fontSize * LINE_HEIGHT, Math.round(r.h));
            this.style();
        }
    },

    up() {
        if (this.mode === 'create') {
            const s = App.state;
            const r = this.draft;
            this.draft = null;
            const lh = Math.ceil(s.fontSize * LINE_HEIGHT);
            let box;
            if (r.w < 8 && r.h < 8) {
                const x = Math.round(this.anchor.x), y = Math.round(this.anchor.y - lh / 2);
                const w = Math.max(Math.min(Math.max(240, s.fontSize * 8), App.W - x), s.fontSize * 3);
                box = { x: x, y: y, w: w, h: lh };
            } else {
                box = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.max(lh, Math.round(r.h)) };
            }
            this.open(box, this.swap);
        } else if (this.mode && this.ta) {
            this.ta.focus();
        }
        this.mode = null;
    },

    cancel() {
        if (this.mode === 'create') {
            this.draft = null;
        } else if (this.start && this.box) {
            Object.assign(this.box, this.start);
            this.style();
        }
        this.mode = null;
        App.emit('overlay');
    },

    hover(p) {
        if (!this.box) {
            return null;
        }
        const h = App.view.hitHandles(p, boxHandles(this.box));
        if (h) {
            return handleCursor(h.id);
        }
        return this.inBox(p, App.view.tol(10)) ? 'move' : null;
    },

    overlay(o) {
        if (this.draft) {
            o.rect(this.draft.x, this.draft.y, this.draft.w, this.draft.h, { cls: 'ov-dash' });
        }
        if (this.box) {
            const b = this.box;
            o.rect(b.x, b.y, b.w, b.h, { cls: 'ov-dash' });
            o.handles(boxHandles(b));
        }
    },

    commit() {
        const b = this.box;
        if (!b) {
            return;
        }
        const text = this.ta.value;
        const colors = this.colors();
        let lines = null;
        try {
            lines = text.trim() !== '' ? this.visualLines(text) : null;
        } catch (e) {
            lines = null;
        }
        this.box = null;
        this.wrap.style.display = 'none';
        this.ta.value = '';
        this.ta.blur();
        if (text.trim() !== '') {
            App.history.begin();
            const r = renderText(App.ctx, text, b, colors, lines);
            App.history.commit('Text', { x: r.x - 4, y: r.y - 4, w: r.w + 8, h: r.h + 8 });
            App.emit('changed');
        }
        App.emit('overlay');
    },

    deactivate() {
        this.commit();
    },

    // Back to typing after a font option was changed in the ribbon
    refocus() {
        if (this.box && this.ta) {
            this.ta.focus();
        }
    },

    key(e) {
        if (this.box && e.key === 'Escape') {
            this.commit();
            return true;
        }
        return false;
    }
};

export function registerTextTool() {
    App.registerTool(textTool);
    const restyle = () => textTool.style();
    App.on('zoom', restyle);
    App.on('colors', restyle);
    App.on('options', restyle);
}
