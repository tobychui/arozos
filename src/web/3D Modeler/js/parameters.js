/*
    3D Modeler - parameters ("fx")

    A part keeps named values: data.parameters = [{ name, expr, comment }].
    An expression may use other parameters (wall * 2); they are worked out
    in dependency order, and a loop or an unknown name is an error on that
    parameter, never a crash. Sizes typed with a parameter name keep their
    formula: sketch dimensions (`expr` on the constraint, typed in degrees
    for angles) and extrusion distances (`extent.expr`, `extent.expr2`).
    When a parameter changes, applyParameters() works every kept formula
    out again; the sketches whose dimensions changed must then be solved
    again (the app does that with the sketch solver, headless).

    Pure: no DOM, no kernel; tested in Node (tests/a8.test.mjs).
*/

import { evaluate, namesIn } from './expr.js';

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED = ['pi', 'sqrt', 'abs', 'sin', 'cos', 'tan', 'mm', 'deg'];

// Why a name cannot be used (null when it can); `others` are the other
// parameters' names
export function nameProblem(name, others) {
    if (!NAME.test(name || '')) {
        return 'A name starts with a letter and holds letters, digits and _ only';
    }
    if (RESERVED.indexOf(name.toLowerCase()) >= 0) {
        return name + ' is a word formulas already use';
    }
    if ((others || []).some(function (o) {
        return String(o).toLowerCase() === name.toLowerCase();
    })) {
        return 'Another parameter is called ' + name;
    }
    return null;
}

// Clean stored parameters (an opened file): [{ name, expr, comment }]
export function normalizeParameters(list) {
    if (!Array.isArray(list)) {
        return [];
    }
    const out = [];
    list.slice(0, 500).forEach(function (p) {
        if (!p || typeof p !== 'object' || typeof p.name !== 'string' || nameProblem(p.name, out.map(function (q) {
            return q.name;
        }))) {
            return;
        }
        out.push({ name: p.name, expr: String(p.expr === undefined ? '' : p.expr).slice(0, 500), comment: String(p.comment || '').slice(0, 500) });
    });
    return out;
}

// The value of every parameter: { values: { name: number }, errors: { name:
// sentence } }. Names are matched without regard to case.
export function evaluateParameters(list) {
    const params = normalizeParameters(list);
    const byName = {};
    params.forEach(function (p) {
        byName[p.name.toLowerCase()] = p;
    });
    const values = {};
    const errors = {};
    const state = {}; // lower name -> "busy" | "done"

    function visit(key, path) {
        const p = byName[key];
        if (state[key] === 'done') {
            return;
        }
        if (state[key] === 'busy') {
            throw { loop: path.concat([p.name]) };
        }
        state[key] = 'busy';
        const uses = namesIn(p.expr);
        const missing = uses.filter(function (n) {
            return !byName[n];
        });
        try {
            uses.filter(function (n) {
                return byName[n];
            }).forEach(function (n) {
                visit(n, path.concat([p.name]));
            });
        } finally {
            state[key] = 'done';
        }
        if (missing.length) {
            errors[p.name] = 'Uses ' + missing.join(', ') + ', which ' + (missing.length === 1 ? 'is' : 'are') + ' not a parameter';
            return;
        }
        const failedUse = uses.find(function (n) {
            return errors[byName[n].name];
        });
        if (failedUse) {
            errors[p.name] = 'Uses ' + byName[failedUse].name + ', which has an error';
            return;
        }
        const scope = {};
        uses.forEach(function (n) {
            scope[n] = values[byName[n].name];
        });
        const v = evaluate(p.expr, scope);
        if (!isFinite(v)) {
            errors[p.name] = String(p.expr).trim() ? 'This is not a formula that can be worked out' : 'Enter a value or a formula';
        } else {
            values[p.name] = v;
        }
    }

    params.forEach(function (p) {
        try {
            visit(p.name.toLowerCase(), []);
        } catch (err) {
            if (err && err.loop) {
                err.loop.forEach(function (name) {
                    errors[name] = 'Goes round in a loop: ' + err.loop.join(' -> ');
                    delete values[name];
                });
            } else {
                throw err;
            }
        }
    });
    return { values: values, errors: errors };
}

// Sizes that may be typed as 0: a distance along X or Y (the two points line
// up) and the distance from a point to a line (the point goes on the line, so
// two parallel lines dimensioned to 0 become one line)
const ZERO_ALLOWED = ['hdistance', 'vdistance', 'pldistance'];

// A dimension's stored value from a typed number: angles are typed in
// degrees and keep their side (sign); an angle to the X axis is typed with
// its sign; other sizes must be above zero, or zero for ZERO_ALLOWED. NaN
// when it does not fit.
export function dimensionValue(constraint, typed) {
    const axis = constraint.type === 'axisangle';
    const fits = ZERO_ALLOWED.indexOf(constraint.type) >= 0 ? typed >= 0 : typed > 0;
    if (!isFinite(typed) || (!axis && !fits)) {
        return NaN;
    }
    const magnitude = constraint.type === 'angle' || axis ? typed * Math.PI / 180 : typed;
    return !axis && constraint.value < 0 ? -magnitude : magnitude;
}

// Work every kept formula out again with the parameters of `data` (changed
// in place). Returns { sketches: [id of sketches whose dimensions changed],
// problems: [sentence] }.
export function applyParameters(data) {
    const values = evaluateParameters(data.parameters).values;
    const sketches = [];
    const problems = [];
    (data.features || []).forEach(function (f) {
        if (f.type === 'sketch') {
            let changed = false;
            (f.constraints || []).forEach(function (c) {
                if (typeof c.expr !== 'string') {
                    return;
                }
                const v = dimensionValue(c, evaluate(c.expr, values));
                if (!isFinite(v)) {
                    problems.push(f.name + ': ' + c.expr + ' does not give a size that fits');
                } else if (Math.abs(v - c.value) > 1e-12) {
                    c.value = v;
                    changed = true;
                }
            });
            if (changed) {
                sketches.push(f.id);
            }
        } else if (f.extent && (typeof f.extent.expr === 'string' || typeof f.extent.expr2 === 'string')) {
            [['expr', 'value'], ['expr2', 'value2']].forEach(function (pair) {
                const text = f.extent[pair[0]];
                if (typeof text !== 'string') {
                    return;
                }
                const v = evaluate(text, values);
                if (v > 0) {
                    f.extent[pair[1]] = v;
                } else {
                    problems.push(f.name + ': ' + text + ' does not give a distance above zero');
                }
            });
        }
    });
    return { sketches: sketches, problems: problems };
}

// The formula to keep for a typed text: the text when it uses a parameter
// name, else null (a plain number or a formula of numbers is just a value)
export function keptFormula(text) {
    return namesIn(text).length ? String(text).trim() : null;
}
