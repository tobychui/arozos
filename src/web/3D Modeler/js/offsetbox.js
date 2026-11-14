/*
    3D Modeler - the offset box

    The value box by the pointer while a plane is dragged into an offset
    sketch plane (planedrag.js): it shows the offset while dragging, then
    takes the exact value on release, with OK and Cancel.

    createOffsetBox(stage) -> {
        show(x, y, value)               the value while dragging
        edit(x, y, value, onInput)      -> Promise of the value, or null
        hide(), isOpen()
    }
*/

import { evaluate } from './expr.js';
import { icon, wheelStep } from './ui.js';

function format(value) {
    return (+value.toFixed(3)).toFixed(3) + ' mm';
}

export function createOffsetBox(stage) {
    const box = document.createElement('div');
    box.className = 'offset-box';
    box.hidden = true;
    box.innerHTML = '<input class="offset-input" autocomplete="off" spellcheck="false" aria-label="Offset">' +
        '<div class="offset-buttons"><button type="button" class="offset-ok" title="Make the plane and sketch on it (Enter)">' + icon('finish') + '</button>' +
        '<button type="button" class="offset-cancel" title="Cancel (Esc)">' + icon('close') + '</button></div>';
    stage.appendChild(box);
    const input = box.querySelector('.offset-input');
    wheelStep(input, { step: 1 });
    let pending = null;     // { resolve, onInput, value }

    function place(x, y) {
        const w = box.offsetWidth || 150;
        const h = box.offsetHeight || 60;
        box.style.left = Math.max(4, Math.min(stage.clientWidth - w - 4, x + 14)) + 'px';
        box.style.top = Math.max(4, Math.min(stage.clientHeight - h - 4, y + 14)) + 'px';
    }

    function finish(value) {
        const p = pending;
        pending = null;
        box.hidden = true;
        box.classList.remove('editing');
        if (p) {
            p.resolve(value);
        }
    }

    function accept() {
        if (!pending) {
            return;
        }
        const v = evaluate(input.value);
        if (!isFinite(v)) {
            input.classList.add('bad');
            input.focus();
            return;
        }
        finish(v);
    }

    input.addEventListener('input', function () {
        if (!pending) {
            return;
        }
        const v = evaluate(input.value);
        const ok = isFinite(v);
        input.classList.toggle('bad', !ok);
        if (ok) {
            pending.value = v;
            pending.onInput(v);
        }
    });
    input.addEventListener('keydown', function (event) {
        event.stopPropagation(); // typing here is not a shortcut
        if (event.key === 'Enter') {
            event.preventDefault();
            accept();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            finish(null);
        }
    });
    // Leaving the box replaces a formula by its result
    input.addEventListener('blur', function () {
        if (pending && isFinite(evaluate(input.value))) {
            input.value = format(evaluate(input.value)).replace(' mm', '');
        }
    });
    box.querySelector('.offset-ok').addEventListener('click', accept);
    box.querySelector('.offset-cancel').addEventListener('click', function () {
        finish(null);
    });

    return {
        show: function (x, y, value) {
            box.hidden = false;
            input.readOnly = true;
            input.value = format(value);
            place(x, y);
        },
        edit: function (x, y, value, onInput) {
            if (pending) {
                finish(null);
            }
            return new Promise(function (resolve) {
                pending = { resolve: resolve, onInput: onInput, value: value };
                box.hidden = false;
                box.classList.add('editing');
                input.readOnly = false;
                input.classList.remove('bad');
                input.value = String(+value.toFixed(3));
                place(x, y);
                input.focus();
                input.select();
            });
        },
        hide: function () {
            finish(null);
        },
        isOpen: function () {
            return !!pending;
        }
    };
}
