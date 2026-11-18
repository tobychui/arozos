/*
    3D Modeler - the Parameters table

    3D Model > Parameters, as the "fx" of desktop CAD: a table of named values
    (name, equation, value, comment) for the part. An equation may use
    other parameters; values are worked out as you type, and an error is
    shown on the row it belongs to (an unknown name, a loop). Every size box
    takes the names; sketch dimensions and extrusion distances typed with
    one keep the formula and follow it. OK hands the list to the app
    (options.onApply), which works the formulas out again and solves the
    sketches they change, as one undo step.

    options: { stage, doc, onStatus, onApply(list), onClose }
*/

import { createPanel } from './panel.js';
import { evaluateParameters, nameProblem } from '../parameters.js';

function cleanNumber(v) {
    return Math.abs(v) >= 1e6 || (Math.abs(v) < 1e-4 && v !== 0) ? v.toExponential(4) : String(+v.toFixed(6));
}

export function createParameterTable(options) {
    const doc = options.doc;
    let open = false;
    let rows = [];   // [{ name, expr, comment }]

    const panel = createPanel(options.stage, {
        title: 'Parameters',
        rows: [{ type: 'custom', key: 'table' }],
        onOk: function () {
            const list = rows.map(function (r) {
                return { name: r.name.trim(), expr: r.expr.trim(), comment: r.comment.trim() };
            });
            close();
            options.onApply(list);
        },
        onCancel: close
    });
    panel.element().classList.add('props-params');
    const host = panel.container('table');

    function problems() {
        const names = [];
        const out = rows.map(function (r) {
            const problem = nameProblem(r.name.trim(), names);
            names.push(r.name.trim());
            return problem;
        });
        return out;
    }

    function render(focus) {
        const result = evaluateParameters(rows.map(function (r) {
            return { name: r.name.trim(), expr: r.expr, comment: r.comment };
        }));
        const bad = problems();
        host.innerHTML = '';
        const table = document.createElement('div');
        table.className = 'param-table';
        const head = document.createElement('div');
        head.className = 'param-row param-head';
        ['Name', 'Equation', 'Value', 'Comment', ''].forEach(function (t) {
            const cell = document.createElement('span');
            cell.textContent = t;
            head.appendChild(cell);
        });
        table.appendChild(head);
        rows.forEach(function (r, i) {
            const line = document.createElement('div');
            line.className = 'param-row';
            const field = function (key, placeholder) {
                const input = document.createElement('input');
                input.className = 'props-input';
                input.value = r[key];
                input.placeholder = placeholder;
                input.spellcheck = false;
                input.autocomplete = 'off';
                input.dataset.row = i;
                input.dataset.key = key;
                input.addEventListener('input', function () {
                    r[key] = input.value;
                    update();
                });
                input.addEventListener('keydown', function (event) {
                    event.stopPropagation(); // typing is not a command
                    if (event.key === 'Enter') {
                        input.blur();
                    }
                });
                line.appendChild(input);
                return input;
            };
            field('name', 'name');
            field('expr', 'e.g. 12 or wall * 2');
            const value = document.createElement('span');
            value.className = 'param-value';
            line.appendChild(value);
            field('comment', '');
            const drop = document.createElement('button');
            drop.className = 'param-drop';
            drop.type = 'button';
            drop.title = 'Delete this parameter';
            drop.textContent = '×';
            drop.addEventListener('click', function () {
                rows.splice(i, 1);
                render();
            });
            line.appendChild(drop);
            table.appendChild(line);
            const note = document.createElement('div');
            note.className = 'param-error';
            table.appendChild(note);
            line.update = function () {
                const name = r.name.trim();
                const problem = bad[i] || result.errors[name] || '';
                value.textContent = name && isFinite(result.values[name]) ? cleanNumber(result.values[name]) : '';
                note.textContent = problem;
                note.hidden = !problem;
                line.classList.toggle('bad', !!problem);
            };
            line.update();
        });
        const add = document.createElement('button');
        add.className = 'param-add';
        add.type = 'button';
        add.textContent = '+ Add Parameter';
        add.addEventListener('click', function () {
            let n = rows.length + 1;
            while (rows.some(function (r) {
                return r.name.toLowerCase() === 'param' + n;
            })) {
                n++;
            }
            rows.push({ name: 'param' + n, expr: '10', comment: '' });
            render(rows.length - 1);
        });
        table.appendChild(add);
        host.appendChild(table);
        summarize(result, bad);
        if (focus !== undefined) {
            const input = host.querySelector('input[data-row="' + focus + '"][data-key="name"]');
            if (input) {
                input.focus();
                input.select();
            }
        }
    }

    // Values and errors again after a keystroke, without rebuilding the inputs
    function update() {
        const result = evaluateParameters(rows.map(function (r) {
            return { name: r.name.trim(), expr: r.expr, comment: r.comment };
        }));
        const bad = problems();
        const lines = host.querySelectorAll('.param-row:not(.param-head)');
        lines.forEach(function (line, i) {
            const r = rows[i];
            const name = r.name.trim();
            const problem = bad[i] || result.errors[name] || '';
            line.querySelector('.param-value').textContent = name && isFinite(result.values[name]) ? cleanNumber(result.values[name]) : '';
            const note = line.nextSibling;
            note.textContent = problem;
            note.hidden = !problem;
            line.classList.toggle('bad', !!problem);
        });
        summarize(result, bad);
    }

    function summarize(result, bad) {
        const wrong = bad.some(Boolean) || Object.keys(result.errors).length > 0;
        panel.ok(!wrong);
        panel.note(wrong ? 'Fix the rows marked red first.' : rows.length
            ? 'Use a name in any size box, e.g. wall * 2. Sketch dimensions and extrusion distances keep the formula and follow it.'
            : 'No parameters yet: + Add Parameter.', wrong);
    }

    function close() {
        if (!open) {
            return;
        }
        open = false;
        panel.hide();
        if (options.onClose) {
            options.onClose();
        }
    }

    return {
        start: function () {
            rows = (doc.data().parameters || []).map(function (p) {
                return { name: p.name, expr: String(p.expr), comment: p.comment || '' };
            });
            open = true;
            panel.show();
            render();
            options.onStatus('Parameters: named values for formulas in size boxes');
        },
        cancel: close,
        isOpen: function () {
            return open;
        }
    };
}
