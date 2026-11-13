/*
    3D Modeler - typed values

    Every box that takes a size accepts a small formula instead of a plain
    number: 35/2, (40 - 2*3)/4, 2^3, sqrt(2)*10, pi*12. This is a hand written
    parser, not eval(): only numbers, + - * / ^, brackets, pi and a few maths
    functions are understood. A trailing unit (mm, deg) is ignored.

    The result is stored, not the formula. Named parameters that keep their
    formula are a later stage (PROPOSAL.md section 11).
*/

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

// The value of a formula, or NaN when it cannot be understood
export function evaluate(text) {
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
        const word = /^[a-z]+/.exec(src.slice(at));
        if (word) {
            at += word[0].length;
            if (word[0] === 'pi') {
                return Math.PI;
            }
            if (FUNCTIONS[word[0]] && src[at] === '(') {
                return FUNCTIONS[word[0]](primary());
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

// Is the text a formula rather than a plain number (so its result is worth showing)?
export function isFormula(text) {
    return !/^\s*\d*\.?\d*\s*$/.test(String(text));
}
