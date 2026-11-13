/*
    3D Modeler - small interface helpers

    The drop-down / context menu and the in-page dialog. System pages must not
    use the browser's own alert, confirm or prompt, so every question goes
    through ask().
*/

import { evaluate } from './expr.js';

/* ================= size boxes ================= */
// The mouse wheel over a size box steps its value: one notch is `step`
// (0.5 by default), landing on whole steps (2.3 goes to 2.5 or 2). A
// formula is worked out first. The value never leaves the box's range:
// `min` / `max`, with `above` true when the minimum itself is not allowed
// (a radius of 0); a notch that would cross the limit leaves the value as
// it is. The box gets an "input" event, as if the value had been typed.
export function wheelStep(input, options) {
    const opts = options || {};
    input.addEventListener('wheel', function (event) {
        if (input.disabled || input.readOnly || input.hidden || !event.deltaY) {
            return;
        }
        const current = evaluate(input.value);
        if (!isFinite(current)) {
            return;
        }
        event.preventDefault();
        const step = opts.step || 0.5;
        const up = event.deltaY < 0;
        const steps = current / step;
        // The next whole step in the direction of the wheel
        let next = (up ? Math.floor(steps + 1e-9) + 1 : Math.ceil(steps - 1e-9) - 1) * step;
        next = +next.toFixed(6);
        const min = opts.min === undefined ? -Infinity : opts.min;
        const max = opts.max === undefined ? Infinity : opts.max;
        if (next > max || next < min || (opts.above && next <= min)) {
            return;
        }
        input.value = String(next);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }, { passive: false });
}

export function icon(name, extraClass) {
    return '<svg class="ic' + (extraClass ? ' ' + extraClass : '') + '"><use href="#ic-' + name + '"/></svg>';
}

/* ================= menu ================= */
function menuEl() {
    return document.getElementById('menu');
}

// Show a menu below an element, or at a point { x, y }.
// entries: [{ id, label, hint }]; onPick receives the id.
export function openMenu(anchor, entries, onPick) {
    const menu = menuEl();
    menu.innerHTML = '';
    entries.forEach(function (entry) {
        const button = document.createElement('button');
        button.className = 'mi';
        const label = document.createElement('span');
        label.textContent = entry.label;
        button.appendChild(label);
        if (entry.hint) {
            const hint = document.createElement('span');
            hint.className = 'hint';
            hint.textContent = entry.hint;
            button.appendChild(hint);
        }
        button.addEventListener('click', function () {
            closeMenu();
            onPick(entry.id);
        });
        menu.appendChild(button);
    });
    menu.hidden = false;
    let left;
    let top;
    if (anchor instanceof Element) {
        const rect = anchor.getBoundingClientRect();
        left = rect.left;
        top = rect.bottom + 2;
    } else {
        left = anchor.x;
        top = anchor.y;
    }
    menu.style.left = Math.max(4, Math.min(left, window.innerWidth - menu.offsetWidth - 4)) + 'px';
    menu.style.top = Math.max(4, Math.min(top, window.innerHeight - menu.offsetHeight - 4)) + 'px';
}

export function closeMenu() {
    menuEl().hidden = true;
}

document.addEventListener('pointerdown', function (event) {
    const menu = menuEl();
    if (menu && !menu.hidden && !menu.contains(event.target) && !event.target.closest('.rb')) {
        closeMenu();
    }
}, true);

/* ================= dialog ================= */
// Ask a question. buttons: [{ label, value, primary }]. Resolves to the value
// of the pressed button; Escape or a click outside resolves to `cancelValue`.
export function ask(title, text, buttons, cancelValue) {
    return new Promise(function (resolve) {
        const veil = document.createElement('div');
        veil.className = 'veil';
        const box = document.createElement('div');
        box.className = 'dialog';
        box.setAttribute('role', 'dialog');
        const h = document.createElement('div');
        h.className = 'dialog-title';
        h.textContent = title;
        const p = document.createElement('div');
        p.className = 'dialog-text';
        p.textContent = text;
        const row = document.createElement('div');
        row.className = 'dialog-buttons';
        box.appendChild(h);
        box.appendChild(p);
        box.appendChild(row);
        veil.appendChild(box);

        function done(value) {
            document.removeEventListener('keydown', onKey, true);
            veil.remove();
            resolve(value);
        }

        function onKey(event) {
            if (event.key === 'Escape') {
                event.stopPropagation();
                done(cancelValue);
            }
        }

        buttons.forEach(function (b) {
            const button = document.createElement('button');
            button.className = 'dialog-btn' + (b.primary ? ' primary' : '');
            button.textContent = b.label;
            button.addEventListener('click', function () {
                done(b.value);
            });
            row.appendChild(button);
            if (b.primary) {
                setTimeout(function () {
                    button.focus();
                }, 0);
            }
        });
        veil.addEventListener('pointerdown', function (event) {
            if (event.target === veil) {
                done(cancelValue);
            }
        });
        document.addEventListener('keydown', onKey, true);
        document.body.appendChild(veil);
    });
}

// Tell the user something that needs acknowledging.
export function tell(title, text) {
    return ask(title, text, [{ label: 'OK', value: true, primary: true }], true);
}

/* ================= File > New ================= */
const NEW_KINDS = [
    { id: 'part', icon: 'part', name: 'Part', ext: '.aopart', hint: 'Sketch and model one solid part' },
    { id: 'assembly', icon: 'assembly', name: 'Assembly', ext: '.aoasm', hint: 'Bring parts together and constrain them' },
    { id: 'drawing', icon: 'drawing', name: 'Drawing', ext: '.aodrw', hint: '2D printable blueprints of parts and assemblies' }
];

// Ask what kind of document to start. Resolves to "part", "assembly",
// "drawing" or null (Escape, Cancel or a click outside).
export function chooseNew() {
    return new Promise(function (resolve) {
        const veil = document.createElement('div');
        veil.className = 'veil';
        const box = document.createElement('div');
        box.className = 'dialog chooser';
        box.setAttribute('role', 'dialog');
        const title = document.createElement('div');
        title.className = 'dialog-title';
        title.textContent = 'New';
        const tiles = document.createElement('div');
        tiles.className = 'chooser-tiles';
        const row = document.createElement('div');
        row.className = 'dialog-buttons';
        box.appendChild(title);
        box.appendChild(tiles);
        box.appendChild(row);
        veil.appendChild(box);

        function done(value) {
            document.removeEventListener('keydown', onKey, true);
            veil.remove();
            resolve(value);
        }

        function onKey(event) {
            if (event.key === 'Escape') {
                event.stopPropagation();
                done(null);
            }
        }

        NEW_KINDS.forEach(function (kind, i) {
            const tile = document.createElement('button');
            tile.className = 'chooser-tile';
            tile.disabled = !!kind.disabled;
            tile.dataset.kind = kind.id;
            tile.title = kind.disabled ? kind.name + ' is planned for a later version' : 'Start a new ' + kind.name.toLowerCase();
            tile.innerHTML = icon(kind.icon) + '<span class="chooser-name"></span><span class="chooser-ext"></span><span class="chooser-hint"></span>';
            tile.querySelector('.chooser-name').textContent = kind.name;
            tile.querySelector('.chooser-ext').textContent = kind.disabled ? 'Coming later' : kind.ext;
            tile.querySelector('.chooser-hint').textContent = kind.hint;
            tile.addEventListener('click', function () {
                done(kind.id);
            });
            tiles.appendChild(tile);
            if (i === 0) {
                setTimeout(function () {
                    tile.focus();
                }, 0);
            }
        });
        const cancel = document.createElement('button');
        cancel.className = 'dialog-btn';
        cancel.textContent = 'Cancel';
        cancel.addEventListener('click', function () {
            done(null);
        });
        row.appendChild(cancel);
        veil.addEventListener('pointerdown', function (event) {
            if (event.target === veil) {
                done(null);
            }
        });
        document.addEventListener('keydown', onKey, true);
        document.body.appendChild(veil);
    });
}
