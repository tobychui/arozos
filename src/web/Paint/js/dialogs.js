/*
    Modal dialogs: a generic dialog(), and the New picture, Resize and
    Canvas size dialogs.
*/
import { App } from './app.js';
import { T, TF, el } from './util.js';
import { MAX_SIZE } from './imageops.js';

let openCount = 0;

export function isDialogOpen() {
    return openCount > 0;
}

/*
    dialog({ title, body: Element | string, buttons: [{ label, primary,
    action: () => false keeps the dialog open }], onCancel })
    Enter runs the primary button, Escape cancels.
*/
export function dialog(opts) {
    const back = el('div', { class: 'dlg-back' });
    const box = el('div', { class: 'dlg', role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title || '' });
    const head = el('div', { class: 'dlg-title' }, opts.title || '');
    const body = el('div', { class: 'dlg-body' });
    if (typeof opts.body === 'string') {
        body.appendChild(el('p', null, opts.body));
    } else if (opts.body) {
        body.appendChild(opts.body);
    }
    const foot = el('div', { class: 'dlg-buttons' });
    let closed = false;
    const close = () => {
        if (closed) {
            return;
        }
        closed = true;
        openCount--;
        document.removeEventListener('keydown', onKey, true);
        back.remove();
    };
    const run = (b) => {
        if (b.action && b.action() === false) {
            return;
        }
        close();
    };
    (opts.buttons || [{ label: T('ok', 'OK'), primary: true }]).forEach((b) => {
        foot.appendChild(el('button', {
            type: 'button',
            class: 'btn' + (b.primary ? ' primary' : ''),
            onclick: () => run(b)
        }, b.label));
    });
    const cancel = () => {
        if (opts.onCancel) {
            opts.onCancel();
        }
        close();
    };
    const onKey = (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            cancel();
        } else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'TEXTAREA') {
            const primary = (opts.buttons || []).find((b) => b.primary);
            if (primary) {
                e.preventDefault();
                e.stopPropagation();
                run(primary);
            }
        }
        e.stopPropagation();
    };
    document.addEventListener('keydown', onKey, true);
    back.addEventListener('pointerdown', (e) => {
        if (e.target === back) {
            cancel();
        }
    });
    box.appendChild(head);
    box.appendChild(body);
    box.appendChild(foot);
    back.appendChild(box);
    document.body.appendChild(back);
    openCount++;
    setTimeout(() => {
        const first = box.querySelector('input:not([type=checkbox]):not([type=radio]), select') || box.querySelector('.btn.primary');
        if (first) {
            first.focus();
            if (first.select) {
                first.select();
            }
        }
    }, 0);
    return { close: close };
}

/* ------------------------------------------------------------ small form helpers */

function numberField(label, value, min, max, unit) {
    const input = el('input', { type: 'number', min: String(min), max: String(max), value: String(value), step: '1' });
    const row = el('label', { class: 'field' }, el('span', { class: 'field-label' }, label), el('span', { class: 'field-input' }, input, unit ? el('span', { class: 'unit' }, unit) : null));
    return { row: row, input: input };
}

function intOf(input, min, max, fallback) {
    const v = Math.round(parseFloat(input.value));
    if (!isFinite(v)) {
        return fallback;
    }
    return Math.max(min, Math.min(max, v));
}

function segmented(options, value, onChange) {
    const wrap = el('div', { class: 'seg', role: 'radiogroup' });
    const set = (v) => {
        value = v;
        wrap.querySelectorAll('button').forEach((b) => {
            const on = b.dataset.value === v;
            b.classList.toggle('on', on);
            b.setAttribute('aria-checked', on ? 'true' : 'false');
        });
        if (onChange) {
            onChange(v);
        }
    };
    options.forEach((o) => {
        wrap.appendChild(el('button', {
            type: 'button', role: 'radio', 'data-value': o.value,
            onclick: () => set(o.value)
        }, o.label));
    });
    set(value);
    return { el: wrap, get: () => value };
}

/* ------------------------------------------------------------ New picture */

const PRESETS = [
    [800, 600], [1024, 768], [1280, 720], [1920, 1080], [3840, 2160], [1080, 1080], [512, 512], [1240, 1754]
];

export function newImageDialog(onCreate) {
    const body = el('div', { class: 'form' });
    const w = numberField(T('width', 'Width'), App.W, 1, MAX_SIZE, 'px');
    const h = numberField(T('height', 'Height'), App.H, 1, MAX_SIZE, 'px');
    const preset = el('select', { class: 'preset' });
    preset.appendChild(el('option', { value: '' }, T('preset-custom', 'Custom size')));
    PRESETS.forEach((p) => {
        let name = p[0] + ' × ' + p[1];
        if (p[0] === 1280) { name += ' (HD)'; }
        if (p[0] === 1920) { name += ' (Full HD)'; }
        if (p[0] === 3840) { name += ' (4K)'; }
        if (p[0] === 1240) { name += ' (' + T('preset-a4', 'A4, 150 dpi') + ')'; }
        preset.appendChild(el('option', { value: p[0] + 'x' + p[1] }, name));
    });
    preset.addEventListener('change', () => {
        if (preset.value) {
            const [pw, ph] = preset.value.split('x');
            w.input.value = pw;
            h.input.value = ph;
        }
    });
    const clearPreset = () => {
        preset.value = '';
    };
    w.input.addEventListener('input', clearPreset);
    h.input.addEventListener('input', clearPreset);
    const bg = segmented([
        { value: 'white', label: T('bg-white', 'White') },
        { value: 'transparent', label: T('bg-transparent', 'Transparent') }
    ], 'white');
    body.appendChild(el('label', { class: 'field' }, el('span', { class: 'field-label' }, T('preset', 'Preset')), el('span', { class: 'field-input' }, preset)));
    body.appendChild(w.row);
    body.appendChild(h.row);
    body.appendChild(el('div', { class: 'field' }, el('span', { class: 'field-label' }, T('background', 'Background')), bg.el));
    dialog({
        title: T('new-picture', 'New picture'),
        body: body,
        buttons: [
            { label: T('cancel', 'Cancel') },
            {
                label: T('create', 'Create'), primary: true, action: () => {
                    onCreate(intOf(w.input, 1, MAX_SIZE, 800), intOf(h.input, 1, MAX_SIZE, 600), bg.get() === 'transparent');
                }
            }
        ]
    });
}

/* ------------------------------------------------------------ Resize */

export function resizeDialog(onResize) {
    const W0 = App.W, H0 = App.H;
    const body = el('div', { class: 'form' });
    let mode = 'percent';
    const w = numberField(T('width', 'Width'), 100, 1, MAX_SIZE, '%');
    const h = numberField(T('height', 'Height'), 100, 1, MAX_SIZE, '%');
    const keep = el('input', { type: 'checkbox', checked: true });
    const smooth = el('input', { type: 'checkbox', checked: true });
    const result = el('div', { class: 'note' });
    const units = () => {
        w.row.querySelector('.unit').textContent = mode === 'percent' ? '%' : 'px';
        h.row.querySelector('.unit').textContent = mode === 'percent' ? '%' : 'px';
    };
    const target = () => {
        const a = parseFloat(w.input.value) || 0, b = parseFloat(h.input.value) || 0;
        if (mode === 'percent') {
            return { w: Math.round((W0 * a) / 100), h: Math.round((H0 * b) / 100) };
        }
        return { w: Math.round(a), h: Math.round(b) };
    };
    const show = () => {
        const t = target();
        result.textContent = TF('resize-result', 'New size: {w} × {h} px', { w: Math.max(1, t.w), h: Math.max(1, t.h) });
    };
    const seg = segmented([
        { value: 'percent', label: T('by-percent', 'Percentage') },
        { value: 'pixels', label: T('by-pixels', 'Pixels') }
    ], 'percent', (v) => {
        if (v === mode) {
            return;
        }
        const t = target();
        mode = v;
        if (mode === 'percent') {
            w.input.value = String(Math.round((t.w / W0) * 100));
            h.input.value = String(Math.round((t.h / H0) * 100));
        } else {
            w.input.value = String(t.w);
            h.input.value = String(t.h);
        }
        units();
        show();
    });
    w.input.addEventListener('input', () => {
        if (keep.checked) {
            const a = parseFloat(w.input.value) || 0;
            h.input.value = String(mode === 'percent' ? a : Math.round((a * H0) / W0));
        }
        show();
    });
    h.input.addEventListener('input', () => {
        if (keep.checked) {
            const b = parseFloat(h.input.value) || 0;
            w.input.value = String(mode === 'percent' ? b : Math.round((b * W0) / H0));
        }
        show();
    });
    body.appendChild(el('div', { class: 'field' }, el('span', { class: 'field-label' }, T('resize-by', 'Resize by')), seg.el));
    body.appendChild(w.row);
    body.appendChild(h.row);
    body.appendChild(el('label', { class: 'check' }, keep, T('keep-ratio', 'Keep aspect ratio')));
    body.appendChild(el('label', { class: 'check' }, smooth, T('smooth', 'Smooth (turn off for pixel art)')));
    body.appendChild(result);
    show();
    dialog({
        title: T('resize-image', 'Resize image'),
        body: body,
        buttons: [
            { label: T('cancel', 'Cancel') },
            {
                label: T('resize', 'Resize'), primary: true, action: () => {
                    const t = target();
                    onResize(Math.max(1, Math.min(MAX_SIZE, t.w)), Math.max(1, Math.min(MAX_SIZE, t.h)), smooth.checked);
                }
            }
        ]
    });
}

/* ------------------------------------------------------------ Canvas size */

export function canvasSizeDialog(onApply) {
    const body = el('div', { class: 'form' });
    const w = numberField(T('width', 'Width'), App.W, 1, MAX_SIZE, 'px');
    const h = numberField(T('height', 'Height'), App.H, 1, MAX_SIZE, 'px');
    let anchor = 'tl';
    const grid = el('div', { class: 'anchor-grid', role: 'radiogroup', 'aria-label': T('anchor', 'Anchor') });
    ['tl', 't', 'tr', 'l', 'c', 'r', 'bl', 'b', 'br'].forEach((a) => {
        grid.appendChild(el('button', {
            type: 'button', 'data-a': a, role: 'radio',
            onclick: () => {
                anchor = a;
                grid.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.a === a));
            }
        }));
    });
    grid.querySelector('[data-a="tl"]').classList.add('on');
    body.appendChild(w.row);
    body.appendChild(h.row);
    body.appendChild(el('div', { class: 'field' }, el('span', { class: 'field-label' }, T('anchor', 'Anchor')), grid));
    body.appendChild(el('div', { class: 'note' }, App.state.transparentBg
        ? T('canvas-note-transparent', 'New space is transparent.')
        : T('canvas-note', 'New space is filled with the secondary colour.')));
    dialog({
        title: T('canvas-size', 'Canvas size'),
        body: body,
        buttons: [
            { label: T('cancel', 'Cancel') },
            {
                label: T('apply', 'Apply'), primary: true, action: () => {
                    onApply(intOf(w.input, 1, MAX_SIZE, App.W), intOf(h.input, 1, MAX_SIZE, App.H), anchor);
                }
            }
        ]
    });
}
