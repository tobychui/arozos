/*
    3D Modeler - feature property panel

    Builds the floating panel a feature tool shows (the Inventor "Properties"
    panel) from a list of rows, so every feature looks and behaves the same:
    drag by the title, Enter is OK, Esc is Cancel, size boxes take formulas.
    (extrude.js predates this helper and builds its own panel the same way.)

    createPanel(stage, spec)
        spec.title          text of the title
        spec.rows           [row, ...], each one of
            { type: "section", label }
            { type: "static", key, label }                  a line of text
            { type: "pick", key, label, title }             a button; click calls onAction(key)
            { type: "number", key, label, unit }            a size box (formulas allowed)
                signed: true takes zero and negative values (offsets,
                positions, angles); min, max and step limit the wheel
            { type: "range", key, label, unit }             a slider with a size box
                beside it; its limits are set with range(key, min, max)
            { type: "seg", key, label, items: [{ id, label, title }] }
                illustrate: a family of illustrations.js (e.g. "constraint"):
                a card beside the panel animates what the chosen item does
            { type: "check", key, label }
            { type: "text", key, label, placeholder, multiline }   free text
            { type: "select", key, label, items: [{ id, label }] }  a drop-down
            { type: "color", key, label }                   a colour picker ("#rrggbb")
            { type: "figure", key }     a picture the width of the panel, set
                with html(key, markup); a click on an element with
                data-focus="<row key>" puts the caret in that row
        spec.onChange(key, value)   a number, seg, check, text or select row changed
        spec.onFocus(key | null)    a number row got (or lost) the caret
        spec.onAction(key)          a pick button was clicked
        spec.onOk(), spec.onCancel()
        spec.okLabel, spec.cancelLabel   other words on the two buttons
        spec.onApply()              adds an Apply button between them: do it
                                    and keep the panel open for the next one

    The returned object: show(), hide(), isOpen(), title(text, sub),
    text(key, text, warn), set(key, value), get(key), visible(key, shown),
    note(text, bad), ok(enabled), focus(key), unit(key, text),
    items(key, list) (the entries of a select row).
*/

import { evaluate } from '../expr.js';
import { wheelStep } from '../ui.js';
import { createIllustration } from './illustrate.js';

export function createPanel(stage, spec) {
    const panel = document.createElement('div');
    panel.className = 'props';
    panel.hidden = true;
    const title = document.createElement('div');
    title.className = 'props-title';
    title.innerHTML = '<span></span><span class="props-sub"></span>';
    title.firstChild.textContent = spec.title;
    panel.appendChild(title);

    const rows = {};    // key -> { row, control, type, value }
    const illustrated = []; // seg rows with an illustration: { key, family, seg }
    let illus = null;
    spec.rows.forEach(function (def) {
        if (def.type === 'section') {
            const section = document.createElement('div');
            section.className = 'props-section';
            section.textContent = def.label;
            panel.appendChild(section);
            if (def.key) {
                // A section with a key can be hidden with visible(key, false)
                rows[def.key] = { row: section, type: 'section', value: null };
            }
            return;
        }
        const row = document.createElement('div');
        row.className = 'props-row';
        const label = document.createElement('label');
        label.textContent = def.type === 'check' ? '' : def.label;
        row.appendChild(label);
        const entry = { row: row, type: def.type, value: null };
        if (def.type === 'static') {
            entry.control = document.createElement('span');
            entry.control.className = 'props-static';
            row.appendChild(entry.control);
        } else if (def.type === 'figure') {
            row.classList.add('props-figure-row');
            entry.control = document.createElement('div');
            entry.control.className = 'props-figure';
            entry.control.addEventListener('click', function (event) {
                const target = event.target.closest('[data-focus]');
                if (target && rows[target.dataset.focus] && !rows[target.dataset.focus].row.hidden) {
                    api.focus(target.dataset.focus);
                }
            });
            row.appendChild(entry.control);
        } else if (def.type === 'pick') {
            entry.control = document.createElement('button');
            entry.control.className = 'props-pick';
            entry.control.title = def.title || '';
            entry.control.addEventListener('click', function () {
                spec.onAction(def.key);
            });
            row.appendChild(entry.control);
        } else if (def.type === 'number' || def.type === 'range') {
            const input = document.createElement('input');
            input.className = 'props-input';
            input.autocomplete = 'off';
            input.spellcheck = false;
            entry.control = input;
            entry.value = 0;
            entry.signed = !!def.signed || def.type === 'range';
            const good = function (v) {
                return entry.signed ? isFinite(v) && (def.min === undefined || v >= def.min) && (def.max === undefined || v <= def.max) : v > 0;
            };
            entry.good = good;
            wheelStep(input, entry.signed ? { min: def.min, max: def.max, step: def.step } : { min: 0, above: true, max: def.max, step: def.step });
            if (def.type === 'range') {
                // The slider moves the value in small steps; the box takes exact ones
                const slider = document.createElement('input');
                slider.type = 'range';
                slider.className = 'props-range';
                slider.min = '0';
                slider.max = '100';
                slider.step = 'any';
                slider.addEventListener('input', function () {
                    entry.value = +slider.value;
                    input.value = String(+entry.value.toFixed(2));
                    input.classList.remove('bad');
                    spec.onChange(def.key, entry.value);
                });
                entry.slider = slider;
                row.appendChild(slider);
            }
            input.addEventListener('input', function () {
                const v = evaluate(input.value);
                const ok = good(v);
                entry.value = ok ? v : entry.signed ? entry.value : 0;
                input.classList.toggle('bad', !ok);
                if (entry.slider && ok) {
                    entry.slider.value = String(v);
                }
                if (ok || !entry.signed) {
                    spec.onChange(def.key, entry.value);
                }
            });
            // Leaving the box replaces a formula by its result
            input.addEventListener('blur', function () {
                if (good(entry.value)) {
                    input.value = String(+entry.value.toFixed(3));
                    input.classList.remove('bad');
                }
                if (spec.onFocus) {
                    spec.onFocus(null);
                }
            });
            input.addEventListener('focus', function () {
                if (spec.onFocus) {
                    spec.onFocus(def.key);
                }
            });
            row.appendChild(input);
            const unit = document.createElement('span');
            unit.className = 'props-unit';
            unit.textContent = def.unit === undefined ? 'mm' : def.unit;
            row.appendChild(unit);
        } else if (def.type === 'seg') {
            const seg = document.createElement('div');
            seg.className = 'seg';
            seg.style.gridTemplateColumns = 'repeat(' + Math.min(def.items.length, def.columns || 2) + ', 1fr)';
            def.items.forEach(function (item) {
                const button = document.createElement('button');
                button.className = 'seg-btn';
                button.textContent = item.label;
                button.title = item.title || '';
                button.dataset.id = item.id;
                button.addEventListener('click', function () {
                    api.set(def.key, item.id);
                    spec.onChange(def.key, item.id);
                });
                seg.appendChild(button);
            });
            entry.control = seg;
            row.appendChild(seg);
            if (def.illustrate) {
                entry.illustrate = def.illustrate;
                illustrated.push({ key: def.key, family: def.illustrate, seg: seg });
            }
        } else if (def.type === 'text') {
            const input = document.createElement(def.multiline ? 'textarea' : 'input');
            input.className = 'props-input' + (def.multiline ? ' props-textarea' : '');
            input.autocomplete = 'off';
            input.spellcheck = false;
            input.placeholder = def.placeholder || '';
            if (def.multiline) {
                input.rows = 3;
            }
            entry.control = input;
            entry.value = '';
            input.addEventListener('input', function () {
                entry.value = input.value;
                spec.onChange(def.key, entry.value);
            });
            row.appendChild(input);
        } else if (def.type === 'color') {
            const input = document.createElement('input');
            input.type = 'color';
            input.className = 'props-color';
            const hex = document.createElement('span');
            hex.className = 'props-unit';
            entry.control = input;
            entry.hex = hex;
            entry.value = '#000000';
            input.addEventListener('input', function () {
                entry.value = input.value;
                hex.textContent = input.value;
                spec.onChange(def.key, entry.value);
            });
            row.appendChild(input);
            row.appendChild(hex);
        } else if (def.type === 'select') {
            const select = document.createElement('select');
            select.className = 'props-input props-select';
            entry.control = select;
            entry.value = null;
            const fill = function (list) {
                select.innerHTML = '';
                list.forEach(function (item) {
                    const option = document.createElement('option');
                    option.value = item.id;
                    option.textContent = item.label;
                    select.appendChild(option);
                });
            };
            fill(def.items || []);
            entry.fill = fill;
            select.addEventListener('change', function () {
                entry.value = select.value;
                spec.onChange(def.key, entry.value);
            });
            row.appendChild(select);
        } else if (def.type === 'check') {
            const wrap = document.createElement('label');
            wrap.className = 'props-check';
            const box = document.createElement('input');
            box.type = 'checkbox';
            wrap.appendChild(box);
            wrap.appendChild(document.createTextNode(' ' + def.label));
            entry.control = box;
            entry.value = false;
            box.addEventListener('change', function () {
                entry.value = box.checked;
                spec.onChange(def.key, entry.value);
            });
            row.appendChild(wrap);
        }
        rows[def.key] = entry;
        panel.appendChild(row);
    });

    const noteEl = document.createElement('div');
    noteEl.className = 'props-note';
    panel.appendChild(noteEl);
    const buttons = document.createElement('div');
    buttons.className = 'props-buttons';
    const okButton = document.createElement('button');
    okButton.className = 'dialog-btn primary';
    okButton.textContent = spec.okLabel || 'OK';
    okButton.addEventListener('click', function () {
        if (!okButton.disabled) {
            spec.onOk();
        }
    });
    const cancelButton = document.createElement('button');
    cancelButton.className = 'dialog-btn';
    cancelButton.textContent = spec.cancelLabel || 'Cancel';
    cancelButton.addEventListener('click', function () {
        spec.onCancel();
    });
    buttons.appendChild(okButton);
    let applyButton = null;
    if (spec.onApply) {
        applyButton = document.createElement('button');
        applyButton.className = 'dialog-btn';
        applyButton.textContent = 'Apply';
        applyButton.title = 'Add it and keep the panel open for the next one';
        applyButton.addEventListener('click', function () {
            if (!applyButton.disabled) {
                spec.onApply();
            }
        });
        buttons.appendChild(applyButton);
    }
    buttons.appendChild(cancelButton);
    panel.appendChild(buttons);
    stage.appendChild(panel);
    if (illustrated.length) {
        illus = createIllustration(panel);
        illustrated.forEach(function (r) {
            illus.attachSeg(r.seg, r.family);
        });
    }

    panel.addEventListener('keydown', function (event) {
        // Keys typed in the panel belong to it, not to the app shortcuts
        event.stopPropagation();
        // Enter makes a new line in a text box; Ctrl + Enter is OK there
        if (event.key === 'Enter' && event.target.tagName === 'TEXTAREA' && !(event.ctrlKey || event.metaKey)) {
            return;
        }
        if (event.key === 'Enter') {
            event.preventDefault();
            if (!okButton.disabled) {
                spec.onOk();
            }
        } else if (event.key === 'Escape') {
            spec.onCancel();
        }
    });

    // The panel can be moved out of the way by its title
    let grip = null;
    title.addEventListener('pointerdown', function (event) {
        grip = [event.clientX - panel.offsetLeft, event.clientY - panel.offsetTop];
        title.setPointerCapture(event.pointerId);
    });
    title.addEventListener('pointermove', function (event) {
        if (grip) {
            panel.style.left = Math.max(0, Math.min(event.clientX - grip[0], stage.clientWidth - panel.offsetWidth)) + 'px';
            panel.style.top = Math.max(0, Math.min(event.clientY - grip[1], stage.clientHeight - 40)) + 'px';
        }
    });
    title.addEventListener('pointerup', function () {
        grip = null;
    });

    const api = {
        show: function () {
            panel.hidden = false;
            if (illus) {
                illus.resume();
            }
        },
        hide: function () {
            panel.hidden = true;
            if (illus) {
                illus.stop();
            }
        },
        isOpen: function () {
            return !panel.hidden;
        },
        title: function (text, sub) {
            title.firstChild.textContent = text;
            // (the illustration button may come after the subtitle)
            title.querySelector('.props-sub').textContent = sub || '';
        },
        // The text of a static or pick row; warn marks a pick row as needing attention
        text: function (key, text, warn) {
            rows[key].control.textContent = text;
            rows[key].control.classList.toggle('empty', !!warn);
        },
        set: function (key, value) {
            const entry = rows[key];
            entry.value = value;
            if (entry.type === 'number' || entry.type === 'range') {
                const ok = entry.good(value);
                entry.control.value = ok ? String(+Number(value).toFixed(3)) : '';
                entry.control.classList.toggle('bad', !ok);
                if (entry.slider && ok) {
                    entry.slider.value = String(value);
                }
            } else if (entry.type === 'seg') {
                entry.control.querySelectorAll('.seg-btn').forEach(function (b) {
                    b.classList.toggle('on', b.dataset.id === value);
                });
                if (illus && entry.illustrate) {
                    illus.show(entry.illustrate, value);
                }
            } else if (entry.type === 'check') {
                entry.control.checked = !!value;
            } else if (entry.type === 'text' || entry.type === 'select') {
                entry.control.value = value === undefined || value === null ? '' : String(value);
            } else if (entry.type === 'color') {
                entry.control.value = value;
                entry.hex.textContent = value;
            }
        },
        get: function (key) {
            return rows[key].value;
        },
        visible: function (key, shown) {
            rows[key].row.hidden = !shown;
        },
        note: function (text, bad) {
            noteEl.textContent = text || '';
            noteEl.classList.toggle('bad', !!bad);
        },
        ok: function (enabled) {
            okButton.disabled = !enabled;
            if (applyButton) {
                applyButton.disabled = !enabled;
            }
        },
        // The limits of a range row's slider
        range: function (key, min, max) {
            const slider = rows[key].slider;
            if (slider) {
                slider.min = String(min);
                slider.max = String(max);
                slider.value = String(rows[key].value);
            }
        },
        // Grey a row out (and its control), or bring it back
        enable: function (key, enabled) {
            const entry = rows[key];
            entry.row.classList.toggle('disabled', !enabled);
            [entry.control, entry.slider].forEach(function (c) {
                if (c && 'disabled' in c) {
                    c.disabled = !enabled;
                }
            });
            if (entry.type === 'seg') {
                entry.control.querySelectorAll('.seg-btn').forEach(function (b) {
                    b.disabled = !enabled;
                });
            }
        },
        // Enable or disable single buttons of a seg row
        segEnabled: function (key, id, enabled) {
            const button = rows[key].control.querySelector('.seg-btn[data-id="' + id + '"]');
            if (button) {
                button.disabled = !enabled;
            }
        },
        element: function () {
            return panel;
        },
        // The markup of a figure row
        html: function (key, markup) {
            rows[key].control.innerHTML = markup;
        },
        // The unit shown after a number row
        unit: function (key, text) {
            const unit = rows[key].row.querySelector('.props-unit');
            if (unit) {
                unit.textContent = text;
            }
        },
        // The entries of a select row: [{ id, label }]
        items: function (key, list) {
            const entry = rows[key];
            entry.fill(list);
            entry.control.value = entry.value === null ? '' : String(entry.value);
        },
        focus: function (key) {
            rows[key].control.focus();
            if (rows[key].control.select) {
                rows[key].control.select();
            }
        }
    };
    return api;
}
