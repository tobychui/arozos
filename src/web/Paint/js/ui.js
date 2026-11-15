/*
    The interface around the canvas: menu bar, ribbon (clipboard, image,
    options of the current tool, colours), tool rail, status bar and the
    keyboard shortcuts.
*/
import { App } from './app.js';
import { View } from './view.js';
import { Sel, Clipboard } from './selection.js';
import { Ops } from './imageops.js';
import { FileIO } from './fileio.js';
import { resizeDialog, canvasSizeDialog, isDialogOpen, dialog } from './dialogs.js';
import { availableFonts, fontCss } from './texttool.js';
import { SHAPES } from './shapes.js';
import { icon } from './icons.js';
import { T, $, el, clamp, shortcutLabel, toast } from './util.js';

/* ------------------------------------------------------------ actions */

const has = () => Sel.has();

const ACTIONS = {
    new: { icon: 'newfile', label: () => T('new', 'New'), run: () => FileIO.newDialog() },
    open: { icon: 'open', label: () => T('open', 'Open...'), key: 'Ctrl+O', run: () => FileIO.openDialog() },
    save: { icon: 'save', label: () => T('save', 'Save'), key: 'Ctrl+S', run: () => FileIO.save() },
    saveas: { icon: 'saveas', label: () => T('save-as', 'Save as...'), key: 'Ctrl+Shift+S', run: () => FileIO.saveAs(), visible: () => App.backend },
    download: { icon: 'download', label: () => T('download', 'Download a copy'), run: () => FileIO.download() },
    close: { icon: 'close', label: () => T('close', 'Close'), run: () => FileIO.requestClose(), visible: () => FileIO.canClose() },

    undo: { icon: 'undo', label: () => T('undo', 'Undo'), key: 'Ctrl+Z', run: () => App.history.undo(), enabled: () => App.history.canUndo() },
    redo: { icon: 'redo', label: () => T('redo', 'Redo'), key: 'Ctrl+Y', run: () => App.history.redo(), enabled: () => App.history.canRedo() },
    cut: { icon: 'cut', label: () => T('cut', 'Cut'), key: 'Ctrl+X', run: () => Clipboard.copy(true), enabled: has },
    copy: { icon: 'copy', label: () => T('copy', 'Copy'), key: 'Ctrl+C', run: () => Clipboard.copy(false) },
    paste: { icon: 'paste', label: () => T('paste', 'Paste'), key: 'Ctrl+V', run: () => Clipboard.pasteButton() },
    pastefile: { icon: 'pastefile', label: () => T('paste-from', 'Paste from file...'), run: () => FileIO.pasteFromFile() },
    selectall: { icon: 'selectall', label: () => T('select-all', 'Select all'), key: 'Ctrl+A', run: () => Sel.selectAll() },
    deselect: { icon: 'deselect', label: () => T('deselect', 'Deselect'), key: 'Esc', run: () => App.finalize(), enabled: has },
    delete: { icon: 'trash', label: () => T('delete-sel', 'Delete selection'), key: 'Del', run: () => Sel.remove(), enabled: has },

    crop: { icon: 'crop', label: () => T('crop', 'Crop to selection'), key: 'Ctrl+Shift+X', run: () => Ops.crop(), enabled: has },
    resize: { icon: 'resize', label: () => T('resize-image-menu', 'Resize image...'), run: () => { App.finalize(); resizeDialog((w, h, s) => Ops.resize(w, h, s)); } },
    canvassize: { icon: 'canvassize', label: () => T('canvas-size-menu', 'Canvas size...'), run: () => { App.finalize(); canvasSizeDialog((w, h, a) => Ops.canvasSize(w, h, a)); } },
    rotcw: { icon: 'rotcw', label: () => T('rotate-right', 'Rotate right 90°'), run: () => Ops.rotate(90) },
    rotccw: { icon: 'rotccw', label: () => T('rotate-left', 'Rotate left 90°'), run: () => Ops.rotate(-90) },
    rot180: { icon: 'rot180', label: () => T('rotate-180', 'Rotate 180°'), run: () => Ops.rotate(180) },
    fliph: { icon: 'fliph', label: () => T('flip-h', 'Flip horizontal'), run: () => Ops.flip('h') },
    flipv: { icon: 'flipv', label: () => T('flip-v', 'Flip vertical'), run: () => Ops.flip('v') },
    invert: { icon: 'invert', label: () => T('invert', 'Invert colours'), run: () => Ops.invert() },
    grayscale: { icon: 'grayscale', label: () => T('grayscale', 'Black and white'), run: () => Ops.grayscale() },
    clear: { icon: 'trash', label: () => T('clear', 'Clear image'), run: () => Ops.clear() },

    zoomin: { icon: 'zoomin', label: () => T('zoom-in', 'Zoom in'), key: 'Ctrl+=', run: () => View.zoomStep(1) },
    zoomout: { icon: 'zoomout', label: () => T('zoom-out', 'Zoom out'), key: 'Ctrl+-', run: () => View.zoomStep(-1) },
    actual: { icon: 'actual', label: () => T('actual-size', 'Actual size (100%)'), run: () => View.setZoom(1) },
    fit: { icon: 'fit', label: () => T('fit', 'Fit to window'), key: 'Ctrl+0', run: () => View.fit() },
    grid: {
        icon: 'grid', label: () => T('pixel-grid', 'Pixel grid'), key: 'Ctrl+G',
        checked: () => App.state.grid,
        run: () => {
            App.state.grid = !App.state.grid;
            App.savePrefs();
            View.layout();
            if (App.state.grid && View.zoom < 4) {
                toast(T('grid-hint', 'The pixel grid shows at 400% zoom and more'));
            }
        }
    },
    theme: { icon: 'moon', label: () => T('dark-mode', 'Dark mode'), checked: () => document.body.classList.contains('dark'), run: () => toggleTheme() },
    shortcuts: { icon: 'keyboard', label: () => T('shortcuts', 'Keyboard shortcuts'), run: () => showShortcuts() }
};

function runAction(id) {
    const a = ACTIONS[id];
    if (!a) {
        return;
    }
    if (a.enabled && !a.enabled()) {
        return;
    }
    a.run();
}

const MENUS = {
    file: { label: () => T('menu-file', 'File'), items: ['new', 'open', 'save', 'saveas', 'download', '-', 'close'] },
    edit: { label: () => T('menu-edit', 'Edit'), items: ['undo', 'redo', '-', 'cut', 'copy', 'paste', 'pastefile', '-', 'selectall', 'deselect', 'delete'] },
    image: { label: () => T('menu-image', 'Image'), items: ['crop', 'resize', 'canvassize', '-', 'rotcw', 'rotccw', 'rot180', 'fliph', 'flipv', '-', 'invert', 'grayscale', '-', 'clear'] },
    view: { label: () => T('menu-view', 'View'), items: ['zoomin', 'zoomout', 'actual', 'fit', '-', 'grid', 'theme', '-', 'shortcuts'] }
};

/* ------------------------------------------------------------ popover menus */

let openMenuEl = null;
let openMenuAnchor = null;

function closeMenu() {
    if (openMenuEl) {
        openMenuEl.remove();
        openMenuEl = null;
    }
    if (openMenuAnchor) {
        openMenuAnchor.classList.remove('open');
        openMenuAnchor.setAttribute('aria-expanded', 'false');
        openMenuAnchor = null;
    }
}

function placePopover(pop, anchor, alignRight) {
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let x = alignRight ? r.right - pw : r.left;
    let y = r.bottom + 4;
    if (y + ph > window.innerHeight - 4) {
        y = Math.max(4, r.top - ph - 4);
    }
    x = clamp(x, 4, Math.max(4, window.innerWidth - pw - 4));
    pop.style.left = x + 'px';
    pop.style.top = y + 'px';
}

// items: action ids, '-' separators, or { label, icon, run, checked }
function openMenu(anchor, items, alignRight) {
    closeMenu();
    const m = el('div', { class: 'menu', role: 'menu' });
    let lastSep = true;
    items.forEach((it) => {
        if (it === '-') {
            if (!lastSep) {
                m.appendChild(el('div', { class: 'menu-sep', role: 'separator' }));
                lastSep = true;
            }
            return;
        }
        const a = typeof it === 'string' ? ACTIONS[it] : it;
        if (!a || (a.visible && !a.visible())) {
            return;
        }
        lastSep = false;
        const disabled = a.enabled ? !a.enabled() : false;
        const checked = a.checked ? a.checked() : null;
        const b = el('button', { type: 'button', class: 'menu-item', role: checked === null ? 'menuitem' : 'menuitemcheckbox', disabled: disabled, 'aria-checked': checked === null ? null : String(checked) });
        b.innerHTML = '<span class="mi-icon">' + (checked === true ? icon('check') : a.icon ? icon(a.icon) : '') + '</span>';
        b.appendChild(el('span', { class: 'mi-label' }, typeof a.label === 'function' ? a.label() : a.label));
        b.appendChild(el('span', { class: 'mi-key' }, shortcutLabel(a.key)));
        b.addEventListener('click', () => {
            closeMenu();
            a.run();
        });
        m.appendChild(b);
    });
    if (m.lastChild && m.lastChild.classList.contains('menu-sep')) {
        m.lastChild.remove();
    }
    placePopover(m, anchor, alignRight);
    openMenuEl = m;
    openMenuAnchor = anchor;
    anchor.classList.add('open');
    anchor.setAttribute('aria-expanded', 'true');
    const first = m.querySelector('.menu-item:not([disabled])');
    if (first) {
        first.focus({ preventScroll: true });
    }
    m.addEventListener('keydown', (e) => {
        const list = [...m.querySelectorAll('.menu-item:not([disabled])')];
        const i = list.indexOf(document.activeElement);
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            list[(i + 1) % list.length].focus();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            list[(i - 1 + list.length) % list.length].focus();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            const a2 = openMenuAnchor;
            closeMenu();
            if (a2) {
                a2.focus();
            }
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            const bar = anchor.closest('#menus');
            if (bar) {
                const btns = [...bar.querySelectorAll('.menu-btn')];
                const j = btns.indexOf(anchor);
                const next = btns[(j + (e.key === 'ArrowRight' ? 1 : -1) + btns.length) % btns.length];
                next.click();
            }
        }
    });
}

// A popover holding arbitrary content (shape gallery, zoom presets)
function openPopover(anchor, content, alignRight) {
    closeMenu();
    const p = el('div', { class: 'menu popover' }, content);
    placePopover(p, anchor, alignRight);
    openMenuEl = p;
    openMenuAnchor = anchor;
    anchor.classList.add('open');
}

document.addEventListener('pointerdown', (e) => {
    if (openMenuEl && !openMenuEl.contains(e.target) && !(openMenuAnchor && openMenuAnchor.contains(e.target))) {
        closeMenu();
    }
}, true);
window.addEventListener('blur', closeMenu);
window.addEventListener('resize', closeMenu);

/* ------------------------------------------------------------ small controls */

function iconBtn(name, title, onClick, extra) {
    const attrs = Object.assign({ type: 'button', title: title, 'aria-label': title }, extra || {});
    attrs.class = 'ib' + (extra && extra.class ? ' ' + extra.class : '');
    const b = el('button', attrs);
    b.innerHTML = icon(name);
    if (onClick) {
        b.addEventListener('click', onClick);
    }
    return b;
}

function actionBtn(id) {
    const a = ACTIONS[id];
    const title = a.label() + (a.key ? ' (' + shortcutLabel(a.key) + ')' : '');
    const b = iconBtn(a.icon, title, () => runAction(id));
    b.dataset.action = id;
    return b;
}

function sep() {
    return el('div', { class: 'rb-sep' });
}

// Slider + number box for a size in px
function sizeControl(key, min, max, label) {
    const s = App.state.sizes;
    const range = el('input', { type: 'range', min: String(min), max: String(max), value: String(s[key]), class: 'size-range', 'aria-label': label || T('size', 'Size') });
    const num = el('input', { type: 'number', min: String(min), max: String(max), value: String(s[key]), class: 'size-num', 'aria-label': label || T('size', 'Size') });
    const set = (v, from) => {
        v = clamp(Math.round(v) || min, min, max);
        s[key] = v;
        if (from !== range) {
            range.value = String(v);
        }
        if (from !== num) {
            num.value = String(v);
        }
        App.savePrefs();
        App.emit('options');
        View.queueOverlay();
    };
    range.addEventListener('input', () => set(parseFloat(range.value), range));
    num.addEventListener('change', () => set(parseFloat(num.value), num));
    const wrap = el('div', { class: 'opt size-opt', 'data-size': key }, el('span', { class: 'opt-label' }, label || T('size', 'Size')), range, el('span', { class: 'num-wrap' }, num, el('span', { class: 'unit' }, 'px')));
    wrap.refresh = () => {
        range.value = String(s[key]);
        num.value = String(s[key]);
    };
    return wrap;
}

function checkOpt(label, title, get, set) {
    const input = el('input', { type: 'checkbox' });
    input.checked = get();
    input.addEventListener('change', () => {
        set(input.checked);
        App.savePrefs();
        App.emit('options');
    });
    return el('label', { class: 'opt check-opt', title: title || label }, input, el('span', null, label));
}

function toggleBtn(name, title, get, set, text) {
    const b = el('button', { type: 'button', class: 'ib toggle' + (text ? ' text' : ''), title: title, 'aria-label': title, 'aria-pressed': String(!!get()) });
    if (text) {
        b.innerHTML = text;
    } else {
        b.innerHTML = icon(name);
    }
    b.classList.toggle('on', !!get());
    // Keep the focus in the text box while it is open
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => {
        set(!get());
        b.classList.toggle('on', !!get());
        b.setAttribute('aria-pressed', String(!!get()));
        App.savePrefs();
        App.emit('options');
    });
    return b;
}

function segIcons(options, get, set, label) {
    const wrap = el('div', { class: 'seg icons', role: 'radiogroup', 'aria-label': label || '' });
    const refresh = () => {
        wrap.querySelectorAll('button').forEach((b) => {
            const on = b.dataset.value === get();
            b.classList.toggle('on', on);
            b.setAttribute('aria-checked', String(on));
        });
    };
    options.forEach((o) => {
        const b = el('button', { type: 'button', role: 'radio', class: 'ib', 'data-value': o.value, title: o.title, 'aria-label': o.title });
        b.innerHTML = icon(o.icon);
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', () => {
            set(o.value);
            refresh();
            App.savePrefs();
            App.emit('options');
        });
        wrap.appendChild(b);
    });
    refresh();
    return wrap;
}

/* ------------------------------------------------------------ tools */

const TOOLS = [
    { id: 'select', icon: 'select', key: 'S', label: () => T('tool-select', 'Select') },
    { id: 'lasso', icon: 'lasso', key: 'L', label: () => T('tool-lasso', 'Free-form select') },
    { id: 'pencil', icon: 'pencil', key: 'P', label: () => T('tool-pencil', 'Pencil') },
    { id: 'brush', icon: 'brush', key: 'B', label: () => T('tool-brush', 'Brush') },
    { id: 'eraser', icon: 'eraser', key: 'E', label: () => T('tool-eraser', 'Eraser') },
    { id: 'fill', icon: 'fill', key: 'F', label: () => T('tool-fill', 'Fill') },
    { id: 'text', icon: 'text', key: 'T', label: () => T('tool-text', 'Text') },
    { id: 'picker', icon: 'picker', key: 'I', label: () => T('tool-picker', 'Colour picker') },
    { id: 'shapes', icon: 'shapes', key: 'U', label: () => T('tool-shapes', 'Shapes') }
];

function buildToolRail() {
    const rail = $('toolrail');
    rail.innerHTML = '';
    TOOLS.forEach((t, i) => {
        if (i === 2 || i === 6 || i === 8) {
            rail.appendChild(el('div', { class: 'rail-sep' }));
        }
        const title = t.label() + ' (' + t.key + ')';
        const b = iconBtn(t.icon, title, () => App.setTool(t.id), { 'data-tool': t.id, role: 'radio' });
        rail.appendChild(b);
    });
    const sync = () => {
        rail.querySelectorAll('[data-tool]').forEach((b) => {
            const on = b.dataset.tool === App.state.tool;
            b.classList.toggle('on', on);
            b.setAttribute('aria-checked', String(on));
        });
    };
    App.on('tool', sync);
    sync();
}

/* ------------------------------------------------------------ tool options */

const SHAPE_LABELS = {
    line: ['shape-line', 'Line'], arrow: ['shape-arrow', 'Arrow'], rect: ['shape-rect', 'Rectangle'],
    roundrect: ['shape-roundrect', 'Rounded rectangle'], ellipse: ['shape-ellipse', 'Ellipse'],
    triangle: ['shape-triangle', 'Triangle'], righttriangle: ['shape-righttriangle', 'Right triangle'],
    diamond: ['shape-diamond', 'Diamond'], pentagon: ['shape-pentagon', 'Pentagon'], hexagon: ['shape-hexagon', 'Hexagon'],
    star: ['shape-star', 'Star'], heart: ['shape-heart', 'Heart'], arrowright: ['shape-arrowright', 'Right arrow'],
    arrowleft: ['shape-arrowleft', 'Left arrow'], arrowup: ['shape-arrowup', 'Up arrow'], arrowdown: ['shape-arrowdown', 'Down arrow'],
    callout: ['shape-callout', 'Speech bubble']
};

function shapeLabel(id) {
    const l = SHAPE_LABELS[id] || [id, id];
    return T(l[0], l[1]);
}

function transparentOpt() {
    return checkOpt(T('transparent-bg', 'Transparent background'),
        T('transparent-bg-tip', 'Erasing and moving a selection leave transparent pixels instead of the secondary colour'),
        () => App.state.transparentBg, (v) => { App.state.transparentBg = v; });
}

function hint(text) {
    return el('div', { class: 'opt hint' }, text);
}

const OPTIONS = {
    select() {
        return [actionBtn('selectall'), actionBtn('crop'), actionBtn('delete'), sep(),
            actionBtn('rotccw'), actionBtn('rotcw'), actionBtn('fliph'), actionBtn('flipv'), sep(), transparentOpt()];
    },
    lasso() {
        return OPTIONS.select();
    },
    pencil() {
        return [sizeControl('pencil', 1, 64)];
    },
    brush() {
        return [segIcons([
            { value: 'round', icon: 'roundbrush', title: T('brush-round', 'Round brush') },
            { value: 'calligraphy', icon: 'calligraphy', title: T('brush-calligraphy', 'Calligraphy pen') },
            { value: 'highlighter', icon: 'highlighter', title: T('brush-highlighter', 'Highlighter') },
            { value: 'spray', icon: 'spray', title: T('brush-spray', 'Airbrush') }
        ], () => App.state.brushType, (v) => { App.state.brushType = v; }, T('brush-type', 'Brush')), sep(), sizeControl('brush', 1, 200)];
    },
    eraser() {
        return [sizeControl('eraser', 1, 200), sep(), transparentOpt()];
    },
    fill() {
        const s = App.state;
        const range = el('input', { type: 'range', min: '0', max: '100', value: String(s.tolerance), class: 'size-range', 'aria-label': T('tolerance', 'Tolerance') });
        const val = el('span', { class: 'opt-value' }, s.tolerance + '%');
        range.addEventListener('input', () => {
            s.tolerance = parseInt(range.value, 10);
            val.textContent = s.tolerance + '%';
            App.savePrefs();
        });
        return [el('div', { class: 'opt', title: T('tolerance-tip', 'How different a colour may be and still be filled') }, el('span', { class: 'opt-label' }, T('tolerance', 'Tolerance')), range, val)];
    },
    text() {
        const s = App.state;
        const fonts = availableFonts();
        if (fonts.indexOf(s.font) < 0) {
            s.font = fonts.indexOf('Arial') >= 0 ? 'Arial' : fonts[0];
        }
        const font = el('select', { class: 'font-select', 'aria-label': T('font', 'Font'), title: T('font', 'Font') });
        fonts.forEach((f) => {
            font.appendChild(el('option', { value: f, style: { fontFamily: fontCss(f) } }, f));
        });
        font.value = s.font;
        font.style.fontFamily = fontCss(s.font);
        font.addEventListener('change', () => {
            s.font = font.value;
            font.style.fontFamily = fontCss(s.font);
            App.savePrefs();
            App.emit('options');
            App.tools.text.refocus();
        });
        const sizes = el('datalist', { id: 'font-sizes' });
        [8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 64, 72, 96, 128].forEach((n) => sizes.appendChild(el('option', { value: String(n) })));
        const size = el('input', { type: 'number', min: '4', max: '999', list: 'font-sizes', value: String(s.fontSize), class: 'size-num', 'aria-label': T('font-size', 'Font size'), title: T('font-size', 'Font size') });
        const applySize = () => {
            s.fontSize = clamp(Math.round(parseFloat(size.value)) || 28, 4, 999);
            App.savePrefs();
            App.emit('options');
        };
        size.addEventListener('input', applySize);
        size.addEventListener('change', () => {
            applySize();
            size.value = String(s.fontSize);
            App.tools.text.refocus();
        });
        return [
            el('div', { class: 'opt' }, font),
            el('div', { class: 'opt' }, el('span', { class: 'num-wrap' }, size, el('span', { class: 'unit' }, 'px')), sizes),
            sep(),
            toggleBtn(null, T('bold', 'Bold'), () => s.bold, (v) => { s.bold = v; }, '<b>B</b>'),
            toggleBtn(null, T('italic', 'Italic'), () => s.italic, (v) => { s.italic = v; }, '<i>I</i>'),
            toggleBtn(null, T('underline', 'Underline'), () => s.underline, (v) => { s.underline = v; }, '<u>U</u>'),
            sep(),
            segIcons([
                { value: 'left', icon: 'alignleft', title: T('align-left', 'Align left') },
                { value: 'center', icon: 'aligncenter', title: T('align-center', 'Centre') },
                { value: 'right', icon: 'alignright', title: T('align-right', 'Align right') }
            ], () => s.align, (v) => { s.align = v; }, T('align', 'Alignment')),
            sep(),
            checkOpt(T('text-bg', 'Background'), T('text-bg-tip', 'Fill the text box with the secondary colour'), () => s.textBg, (v) => { s.textBg = v; })
        ];
    },
    picker() {
        return [hint(T('picker-hint', 'Click to pick the primary colour, right-click for the secondary. Tip: hold Alt with any painting tool.'))];
    },
    shapes() {
        const s = App.state;
        const gallery = el('button', { type: 'button', class: 'ib wide shape-btn', title: T('shape', 'Shape'), 'aria-haspopup': 'true' });
        const showShape = () => {
            gallery.innerHTML = icon(s.shape) + icon('chevron', 'chev');
            gallery.title = T('shape', 'Shape') + ': ' + shapeLabel(s.shape);
        };
        showShape();
        gallery.addEventListener('click', () => {
            if (openMenuAnchor === gallery) {
                closeMenu();
                return;
            }
            const grid = el('div', { class: 'shape-grid' });
            SHAPES.forEach((sh) => {
                const b = el('button', { type: 'button', class: 'ib' + (sh.id === s.shape ? ' on' : ''), title: shapeLabel(sh.id), 'aria-label': shapeLabel(sh.id) });
                b.innerHTML = icon(sh.id);
                b.addEventListener('click', () => {
                    s.shape = sh.id;
                    App.savePrefs();
                    showShape();
                    closeMenu();
                    App.tools.shapes.setShape(sh.id);
                });
                grid.appendChild(b);
            });
            openPopover(gallery, grid);
        });
        const dash = el('select', { 'aria-label': T('line-style', 'Line style'), title: T('line-style', 'Line style') });
        [['solid', T('line-solid', 'Solid')], ['dash', T('line-dash', 'Dashed')], ['dot', T('line-dot', 'Dotted')]].forEach((o) => dash.appendChild(el('option', { value: o[0] }, o[1])));
        dash.value = s.dash;
        dash.addEventListener('change', () => {
            s.dash = dash.value;
            App.savePrefs();
            App.emit('options');
        });
        return [
            el('div', { class: 'opt' }, gallery),
            sep(),
            toggleBtn('outline', T('outline-tip', 'Outline (primary colour)'), () => s.outline, (v) => { s.outline = v; if (!v && !s.filled) { s.filled = true; refreshOptions(); } }),
            toggleBtn('filled', T('fill-tip', 'Fill (secondary colour)'), () => s.filled, (v) => { s.filled = v; if (!v && !s.outline) { s.outline = true; refreshOptions(); } }),
            el('div', { class: 'opt' }, dash),
            sep(),
            sizeControl('shape', 1, 64, T('width-label', 'Width'))
        ];
    }
};

function refreshOptions() {
    const box = $('tool-options');
    box.innerHTML = '';
    const t = TOOLS.find((x) => x.id === App.state.tool);
    if (t) {
        box.appendChild(el('div', { class: 'opt-title' }, t.label()));
    }
    const build = OPTIONS[App.state.tool];
    if (build) {
        build().forEach((c) => box.appendChild(c));
    }
    box.scrollLeft = 0;
    markOverflow();
    syncActionButtons();
}

// Fade the right edge of the tool options while more of them are hidden
function markOverflow() {
    const box = $('tool-options');
    box.classList.toggle('more', box.scrollWidth - box.scrollLeft > box.clientWidth + 2);
}

function bindOptionsScroll() {
    const box = $('tool-options');
    box.addEventListener('wheel', (e) => {
        if (box.scrollWidth > box.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX) && !e.ctrlKey) {
            box.scrollLeft += e.deltaY;
            e.preventDefault();
        }
    }, { passive: false });
    box.addEventListener('scroll', markOverflow);
    window.addEventListener('resize', markOverflow);
}

/* ------------------------------------------------------------ colours */

const PALETTE = [
    '#000000', '#4b5563', '#dc2626', '#f97316', '#facc15', '#16a34a', '#06b6d4', '#2563eb', '#7c3aed', '#db2777',
    '#ffffff', '#9ca3af', '#92400e', '#fdba74', '#fef08a', '#86efac', '#a5f3fc', '#93c5fd', '#c4b5fd', '#f9a8d4'
];

function addCustomColor(hex) {
    const list = App.state.customColors.filter((c) => c !== hex && PALETTE.indexOf(c) < 0);
    if (PALETTE.indexOf(hex) < 0) {
        list.unshift(hex);
    }
    App.state.customColors = list.slice(0, 10);
    App.savePrefs();
    renderCustomColors();
}

let colorInput = null;
let colorTarget = 'primary';

function editColor(which, anchor) {
    colorTarget = which;
    colorInput.value = App.state[which];
    const r = anchor.getBoundingClientRect();
    const host = colorInput.parentElement.getBoundingClientRect();
    colorInput.style.left = r.left - host.left + 'px';
    colorInput.style.top = r.bottom - host.top + 'px';
    try {
        if (colorInput.showPicker) {
            colorInput.showPicker();
        } else {
            colorInput.click();
        }
    } catch (e) {
        colorInput.click();
    }
}

function swatch(hex) {
    const b = el('button', { type: 'button', class: 'swatch', title: hex, 'aria-label': hex, style: { background: hex } });
    b.addEventListener('click', () => App.setColor('primary', hex));
    b.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        App.setColor('secondary', hex);
    });
    return b;
}

function renderCustomColors() {
    const row = $('custom-colors');
    if (!row) {
        return;
    }
    row.innerHTML = '';
    const list = App.state.customColors;
    for (let i = 0; i < 10; i++) {
        if (list[i]) {
            row.appendChild(swatch(list[i]));
        } else {
            row.appendChild(el('span', { class: 'swatch empty', 'aria-hidden': 'true' }));
        }
    }
}

function buildColors() {
    const box = $('colors');
    box.innerHTML = '';
    const primary = el('button', { type: 'button', class: 'well primary', title: T('primary-tip', 'Primary colour: left mouse button. Click to change.') });
    const secondary = el('button', { type: 'button', class: 'well secondary', title: T('secondary-tip', 'Secondary colour: right mouse button, eraser and shape fill. Click to change.') });
    const swapB = iconBtn('swap', T('swap-colors', 'Swap colours (X)'), () => App.swapColors(), { class: 'mini swap' });
    const resetB = iconBtn('reset', T('reset-colors', 'Default colours (D)'), () => resetColors(), { class: 'mini reset' });
    colorInput = el('input', { type: 'color', class: 'color-input', tabindex: '-1', 'aria-hidden': 'true' });
    colorInput.addEventListener('input', () => App.setColor(colorTarget, colorInput.value));
    colorInput.addEventListener('change', () => {
        App.setColor(colorTarget, colorInput.value);
        addCustomColor(colorInput.value);
    });
    primary.addEventListener('click', () => editColor('primary', primary));
    secondary.addEventListener('click', () => editColor('secondary', secondary));
    const wells = el('div', { class: 'wells' }, secondary, primary, swapB, resetB, colorInput);
    const pal = el('div', { class: 'palette' });
    PALETTE.forEach((c) => pal.appendChild(swatch(c)));
    const custom = el('div', { class: 'palette custom', id: 'custom-colors', title: T('custom-colors', 'Your colours') });
    const edit = iconBtn('palette', T('edit-colors', 'More colours...'), () => editColor('primary', edit));
    box.appendChild(wells);
    box.appendChild(el('div', { class: 'palettes' }, pal, custom));
    box.appendChild(edit);
    renderCustomColors();
    const sync = () => {
        primary.style.setProperty('--c', App.state.primary);
        secondary.style.setProperty('--c', App.state.secondary);
    };
    App.on('colors', sync);
    sync();
}

function resetColors() {
    App.setColor('primary', '#000000');
    App.setColor('secondary', '#ffffff');
}

/* ------------------------------------------------------------ menu bar and ribbon */

function buildMenuBar() {
    const menus = $('menus');
    menus.innerHTML = '';
    Object.keys(MENUS).forEach((id) => {
        const m = MENUS[id];
        const b = el('button', { type: 'button', class: 'menu-btn', 'aria-haspopup': 'true', 'aria-expanded': 'false' }, m.label());
        b.addEventListener('click', () => {
            if (openMenuAnchor === b) {
                closeMenu();
                return;
            }
            openMenu(b, m.items);
        });
        b.addEventListener('pointerenter', () => {
            if (openMenuEl && openMenuAnchor && openMenuAnchor !== b && openMenuAnchor.classList.contains('menu-btn')) {
                openMenu(b, m.items);
            }
        });
        menus.appendChild(b);
    });
    const quick = $('quick');
    quick.innerHTML = '';
    quick.appendChild(actionBtn('save'));
    quick.appendChild(actionBtn('undo'));
    quick.appendChild(actionBtn('redo'));
    const theme = iconBtn('moon', T('dark-mode', 'Dark mode'), () => toggleTheme(), { id: 'theme-btn' });
    $('menubar-right').innerHTML = '';
    $('menubar-right').appendChild(theme);
}

function buildRibbon() {
    const clip = $('g-clipboard');
    clip.innerHTML = '';
    const paste = el('button', { type: 'button', class: 'big-btn', title: T('paste', 'Paste') + ' (' + shortcutLabel('Ctrl+V') + ')' });
    paste.innerHTML = icon('paste') + '<span>' + T('paste', 'Paste') + '</span>';
    paste.addEventListener('click', () => runAction('paste'));
    clip.appendChild(paste);
    clip.appendChild(el('div', { class: 'stack' }, actionBtn('cut'), actionBtn('copy')));

    const img = $('g-image');
    img.innerHTML = '';
    const rotate = iconBtn('rotcw', T('rotate-flip', 'Rotate and flip'), null, { 'aria-haspopup': 'true' });
    rotate.addEventListener('click', () => {
        if (openMenuAnchor === rotate) {
            closeMenu();
            return;
        }
        openMenu(rotate, ['rotcw', 'rotccw', 'rot180', '-', 'fliph', 'flipv']);
    });
    img.appendChild(el('div', { class: 'stack' }, actionBtn('crop'), actionBtn('resize')));
    img.appendChild(el('div', { class: 'stack' }, rotate, actionBtn('canvassize')));
}

function syncActionButtons() {
    document.querySelectorAll('[data-action]').forEach((b) => {
        const a = ACTIONS[b.dataset.action];
        if (a && a.enabled) {
            b.disabled = !a.enabled();
        }
    });
}

/* ------------------------------------------------------------ status bar */

function selectionSize() {
    if (Sel.draft && !Array.isArray(Sel.draft)) {
        return Sel.draft;
    }
    if (Sel.sel) {
        return Sel.sel;
    }
    const sh = App.tools.shapes && App.tools.shapes.sh;
    if (sh) {
        return { w: Math.abs(sh.x1 - sh.x0), h: Math.abs(sh.y1 - sh.y0) };
    }
    return null;
}

function buildStatus() {
    const pos = $('st-pos');
    const selEl = $('st-sel');
    const size = $('st-size');
    const pick = $('st-pick');
    const zoomLabel = $('zoom-label');
    const slider = $('zoom-slider');
    $('st-pos-icon').innerHTML = icon('pointer');
    document.querySelector('#statusbar .sel-icon').innerHTML = icon('select');
    $('st-size-icon').innerHTML = icon('image');
    $('zoom-out').innerHTML = icon('minus');
    $('zoom-in').innerHTML = icon('plus');
    $('zoom-out').title = ACTIONS.zoomout.label() + ' (' + shortcutLabel('Ctrl+-') + ')';
    $('zoom-in').title = ACTIONS.zoomin.label() + ' (' + shortcutLabel('Ctrl+=') + ')';
    $('zoom-out').addEventListener('click', () => View.zoomStep(-1));
    $('zoom-in').addEventListener('click', () => View.zoomStep(1));
    slider.addEventListener('input', () => View.setZoom(Math.pow(2, parseFloat(slider.value) / 100)));
    zoomLabel.addEventListener('click', () => {
        if (openMenuAnchor === zoomLabel) {
            closeMenu();
            return;
        }
        const items = [3200, 1600, 800, 400, 200, 100, 50, 25, 12.5].map((p) => ({
            label: p + '%', run: () => View.setZoom(p / 100), checked: () => Math.abs(View.zoom * 100 - p) < 0.5
        }));
        openMenu(zoomLabel, items.concat(['-', 'fit']), true);
    });

    App.on('pointer', (p) => {
        if (!p) {
            pos.textContent = '';
            return;
        }
        const x = Math.floor(p.x), y = Math.floor(p.y);
        pos.textContent = (x >= 0 && y >= 0 && x < App.W && y < App.H) ? x + ', ' + y + ' px' : '';
    });
    const showSel = () => {
        const r = selectionSize();
        selEl.textContent = r ? Math.round(r.w) + ' × ' + Math.round(r.h) + ' px' : '';
        selEl.parentElement.style.display = r ? '' : 'none';
        syncActionButtons();
    };
    App.on('selection', showSel);
    showSel();
    const showSize = (g) => {
        size.textContent = (g ? g.w : App.W) + ' × ' + (g ? g.h : App.H) + ' px';
    };
    App.on('docsize', () => showSize());
    App.on('gripsize', (g) => showSize(g));
    App.on('pickhover', (hex) => {
        pick.style.display = hex ? '' : 'none';
        if (hex) {
            pick.querySelector('.chip').style.background = hex;
            pick.querySelector('.hex').textContent = hex.toUpperCase();
        }
    });
    App.on('zoom', () => {
        const pct = View.zoom * 100;
        zoomLabel.textContent = (pct >= 10 ? Math.round(pct) : Math.round(pct * 10) / 10) + '%';
        slider.value = String(Math.round(Math.log2(View.zoom) * 100));
    });
    showSize();
}

/* ------------------------------------------------------------ title, busy */

function buildTitle() {
    const t = $('doc-title');
    const update = () => {
        t.textContent = '';
        t.appendChild(el('span', { class: 'doc-name' }, App.file.name));
        if (App.dirty) {
            t.appendChild(el('span', { class: 'dirty-dot', title: T('unsaved', 'Unsaved changes') }));
        }
        FileIO.updateTitle();
    };
    App.on('file', update);
    App.on('dirty', update);
    update();
    App.on('busy', (b) => document.body.classList.toggle('busy', !!b));
}

/* ------------------------------------------------------------ theme */

let systemDark = false;

function applyTheme(dark) {
    systemDark = dark;
    document.body.classList.toggle('dark', dark);
    try {
        ao_module_setWindowTheme(dark ? 'dark' : 'white');
    } catch (e) {
        //not in a float window
    }
    const b = $('theme-btn');
    if (b) {
        b.innerHTML = icon(dark ? 'sun' : 'moon');
        b.title = dark ? T('light-mode', 'Light mode') : T('dark-mode', 'Dark mode');
    }
}

export function initTheme() {
    if (App.backend && typeof ao_module_getSystemThemeColor === 'function') {
        applyTheme(false);
        try {
            ao_module_getSystemThemeColor((pref) => applyTheme(pref === 'darkTheme' || pref === 'dark'));
        } catch (e) {
            //no preference service
        }
    } else {
        let saved = null;
        try {
            saved = localStorage.getItem('arozos.paint.theme');
        } catch (e) {
            saved = null;
        }
        applyTheme(saved ? saved === 'dark' : !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches));
    }
    try {
        ao_module_onThemeChanged((theme) => applyTheme(theme === 'dark' || theme === 'darkTheme'));
    } catch (e) {
        //older ao_module
    }
}

function toggleTheme() {
    if (App.backend && typeof ao_module_toggleSystemTheme === 'function') {
        ao_module_toggleSystemTheme();
        return;
    }
    const dark = !systemDark;
    try {
        localStorage.setItem('arozos.paint.theme', dark ? 'dark' : 'light');
    } catch (e) {
        //no storage
    }
    applyTheme(dark);
}

/* ------------------------------------------------------------ shortcuts */

// Only shortcuts the browser lets a page take over
const KEYMAP = {
    'Ctrl+o': 'open', 'Ctrl+s': 'save', 'Ctrl+Shift+s': 'saveas',
    'Ctrl+z': 'undo', 'Ctrl+y': 'redo', 'Ctrl+Shift+z': 'redo',
    'Ctrl+x': 'cut', 'Ctrl+c': 'copy', 'Ctrl+a': 'selectall', 'Ctrl+Shift+x': 'crop',
    'Ctrl+=': 'zoomin', 'Ctrl+Shift++': 'zoomin', 'Ctrl+Shift+=': 'zoomin', 'Ctrl++': 'zoomin',
    'Ctrl+-': 'zoomout', 'Ctrl+Shift+_': 'zoomout', 'Ctrl+0': 'fit', 'Ctrl+g': 'grid'
};

const SIZE_KEY = { pencil: 'pencil', brush: 'brush', eraser: 'eraser', shapes: 'shape' };

function changeSize(dir) {
    const key = SIZE_KEY[App.state.tool];
    if (!key) {
        return;
    }
    const s = App.state.sizes;
    const v = s[key];
    const step = v < 10 ? 1 : v < 40 ? 2 : 5;
    s[key] = clamp(v + dir * step, 1, key === 'pencil' || key === 'shape' ? 64 : 200);
    App.savePrefs();
    App.emit('options');
    const ctl = document.querySelector('[data-size="' + key + '"]');
    if (ctl && ctl.refresh) {
        ctl.refresh();
    }
    View.queueOverlay();
}

function onKey(e) {
    if (isDialogOpen()) {
        return;
    }
    const mod = e.ctrlKey || e.metaKey;
    const typing = View.isTyping(e);
    const combo = (mod ? 'Ctrl+' : '') + (e.shiftKey && mod ? 'Shift+' : '') + (e.key.length === 1 ? e.key.toLowerCase() : e.key);
    if (typing) {
        // Saving and opening work while typing; everything else is the text box's
        if (mod && (combo === 'Ctrl+s' || combo === 'Ctrl+Shift+s' || combo === 'Ctrl+o')) {
            e.preventDefault();
            runAction(KEYMAP[combo]);
        }
        return;
    }
    if (openMenuEl) {
        return;
    }
    if (App.tool && App.tool.key && !mod && App.tool.key(e)) {
        e.preventDefault();
        return;
    }
    if (mod) {
        const id = KEYMAP[combo];
        if (id) {
            e.preventDefault();
            runAction(id);
        }
        return;
    }
    if (e.altKey) {
        return;
    }
    const k = e.key.toLowerCase();
    const tool = TOOLS.find((t) => t.key.toLowerCase() === k);
    if (tool) {
        e.preventDefault();
        App.setTool(tool.id);
        return;
    }
    if (k === 'x') {
        App.swapColors();
    } else if (k === 'd') {
        resetColors();
    } else if (k === '[') {
        changeSize(-1);
    } else if (k === ']') {
        changeSize(1);
    } else if (e.key === 'Escape') {
        App.finalize();
    } else if (e.key === 'Delete' && Sel.has()) {
        Sel.remove();
    } else {
        return;
    }
    e.preventDefault();
}

function showShortcuts() {
    const rows = [
        [T('tools', 'Tools'), 'S, L, P, B, E, F, T, I, U'],
        [T('swap-colors-short', 'Swap colours'), 'X'],
        [T('reset-colors-short', 'Default colours'), 'D'],
        [T('size-smaller-bigger', 'Smaller / bigger brush'), '[  ]'],
        [T('pick-color', 'Pick a colour while painting'), 'Alt + ' + T('click', 'click')],
        [T('pan', 'Move around'), T('space-drag', 'Space + drag, or middle mouse button')],
        [T('zoom', 'Zoom'), shortcutLabel('Ctrl+') + T('wheel', 'mouse wheel')],
        [T('constrain', 'Square, circle, 45° line'), 'Shift + ' + T('drag', 'drag')],
        [T('duplicate', 'Move a copy of the selection'), shortcutLabel('Ctrl+') + T('drag', 'drag')],
        [T('nudge', 'Nudge selection or shape'), T('arrow-keys', 'Arrow keys')],
        [T('finish', 'Finish shape or text'), 'Enter / Esc'],
        [T('paste', 'Paste'), shortcutLabel('Ctrl+V')]
    ];
    const table = el('table', { class: 'keys' });
    rows.forEach((r) => table.appendChild(el('tr', null, el('td', null, r[0]), el('td', null, el('kbd', null, r[1])))));
    dialog({ title: T('shortcuts', 'Keyboard shortcuts'), body: table, buttons: [{ label: T('ok', 'OK'), primary: true }] });
}

/* ------------------------------------------------------------ init */

export function buildUI() {
    buildMenuBar();
    buildRibbon();
    buildToolRail();
    buildColors();
    buildStatus();
    buildTitle();
    bindOptionsScroll();
    refreshOptions();
    App.on('tool', () => {
        closeMenu();
        refreshOptions();
    });
    App.on('history', syncActionButtons);
    document.querySelectorAll('.grip').forEach((g) => {
        g.title = T('grip-tip', 'Drag to change the canvas size');
    });
    window.addEventListener('keydown', onKey);
    document.addEventListener('paste', (e) => Clipboard.onPaste(e));
    window.ao_module_close = () => FileIO.requestClose();
    window.addEventListener('beforeunload', (e) => {
        if (App.dirty && !FileIO.canClose()) {
            e.preventDefault();
            e.returnValue = '';
        }
    });
    syncActionButtons();
}
