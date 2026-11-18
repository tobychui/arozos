/*
    3D Modeler - typed values

    Every box that takes a size accepts a small formula instead of a plain
    number: 35/2, (40 - 2*3)/4, 2^3, sqrt(2)*10, pi*12. This is a hand written
    parser, not eval(): only numbers, + - * / ^, brackets, pi and a few maths
    functions are understood. A trailing unit (mm, deg) is ignored.

    Names of the part's parameters (Manage > Parameters, parameters.js) may
    be used too: wall * 2. They come from `scope`, or from the scope the app
    set for the open part (setScope), so every size box takes them. Most
    boxes store the result; sketch dimensions and extrusion distances also
    keep a formula that uses a parameter, and follow it when it changes.
*/

let current = {}; // name (lower case) -> value: the open part's parameters

// The parameters every formula may use from now on: { name: value }
export function setScope(scope) {
    current = {};
    Object.keys(scope || {}).forEach(function (name) {
        if (isFinite(scope[name])) {
            current[name.toLowerCase()] = scope[name];
        }
    });
}

// The parameter names a formula uses (lower case, functions and pi left out)
export function namesIn(text) {
    const out = [];
    const re = /[a-z_][a-z0-9_]*/g;
    const src = String(text).toLowerCase().replace(/(mm|deg)\s*$/, '');
    let m;
    while ((m = re.exec(src))) {
        const word = m[0];
        const after = src.slice(re.lastIndex).replace(/^\s+/, '');
        if (word === 'pi' || (FUNCTIONS[word] && after.charAt(0) === '(') || out.indexOf(word) >= 0) {
            continue;
        }
        out.push(word);
    }
    return out;
}

const FUNCTIONS = {
    sqrt: Math.sqrt,
    abs: Math.abs,
    sin: function (d) {
        return Math.sin(d * Math.PI / 180);
    },
    cos: function (d) {
        return Math.cos(d * Math.PI / 180);
    },
    tan: function (d) {
        return Math.tan(d * Math.PI / 180);
    }
};

// The value of a formula, or NaN when it cannot be understood (or uses a
// name that is not a parameter). `scope` { name: value } replaces the
// open part's parameters.
export function evaluate(text, scope) {
    const names = scope ? lowered(scope) : current;
    const src = String(text).toLowerCase().replace(/\s+/g, '').replace(/(mm|deg)$/, '');
    let at = 0;

    function fail() {
        throw new Error('syntax');
    }

    function primary() {
        if (src[at] === '(') {
            at++;
            const v = sum();
            if (src[at] !== ')') {
                fail();
            }
            at++;
            return v;
        }
        const word = /^[a-z_][a-z0-9_]*/.exec(src.slice(at));
        if (word) {
            at += word[0].length;
            if (word[0] === 'pi') {
                return Math.PI;
            }
            if (FUNCTIONS[word[0]] && src[at] === '(') {
                return FUNCTIONS[word[0]](primary());
            }
            if (Object.prototype.hasOwnProperty.call(names, word[0])) {
                return names[word[0]];
            }
            fail();
        }
        const number = /^(\d+\.?\d*|\.\d+)/.exec(src.slice(at));
        if (!number) {
            fail();
        }
        at += number[0].length;
        return parseFloat(number[0]);
    }

    function factor() {
        if (src[at] === '-') {
            at++;
            return -factor();
        }
        if (src[at] === '+') {
            at++;
            return factor();
        }
        const base = primary();
        if (src[at] === '^') {
            at++;
            return Math.pow(base, factor());
        }
        return base;
    }

    function product() {
        let v = factor();
        while (src[at] === '*' || src[at] === '/') {
            const op = src[at++];
            const right = factor();
            v = op === '*' ? v * right : v / right;
        }
        return v;
    }

    function sum() {
        let v = product();
        while (src[at] === '+' || src[at] === '-') {
            const op = src[at++];
            const right = product();
            v = op === '+' ? v + right : v - right;
        }
        return v;
    }

    try {
        // "3 4" is two numbers, not 34
        if (!src || /[0-9.]\s+[0-9.]/.test(String(text))) {
            return NaN;
        }
        const value = sum();
        return at === src.length && isFinite(value) ? value : NaN;
    } catch (e) {
        return NaN;
    }
}

function lowered(scope) {
    const out = {};
    Object.keys(scope).forEach(function (name) {
        out[name.toLowerCase()] = scope[name];
    });
    return out;
}

// Is the text a formula rather than a plain number (so its result is worth showing)?
export function isFormula(text) {
    return !/^\s*\d*\.?\d*\s*$/.test(String(text));
}
