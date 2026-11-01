/*
    Blocky - weexpr.js

    The small expression language of //deform and //generate. It is parsed
    and compiled into closures here (never eval), so a typo can only give an
    error message.

        statements   a; b; c          (the value is the last one)
        assignment   x = 1, x += 1, -=, *=, /=, %=, ^=
        operators    ?: || && == != < <= > >= + - * / % ^ (power), unary - + !
        functions    abs sqrt cbrt sin cos tan asin acos atan atan2 sinh cosh
                     tanh exp ln log log10 floor ceil round rint min max pow
                     sign clamp random randint perlin(seed, x, y, z, freq,
                     octaves, persistence)
        constants    pi, e

    A value counts as true when it is above zero, comparisons give 1 or 0.
*/

import { Noise } from "./noise.js";

export class ExprError extends Error {}

const TOKEN = /\s*(?:(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+(?:e[+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|(\+=|-=|\*=|\/=|%=|\^=|==|!=|<=|>=|&&|\|\||[-+*/%^()<>=!?:;,]))/y;

function tokenize(src) {
    const out = [];
    TOKEN.lastIndex = 0;
    let pos = 0;
    while (pos < src.length) {
        if (/^\s*$/.test(src.slice(pos))) {
            break;
        }
        TOKEN.lastIndex = pos;
        const m = TOKEN.exec(src);
        if (!m) {
            throw new ExprError(`Unexpected "${src.slice(pos).trim()[0]}" at ${pos + 1}`);
        }
        pos = TOKEN.lastIndex;
        if (m[1] !== undefined) {
            out.push({ t: "num", v: Number(m[1]) });
        } else if (m[2] !== undefined) {
            out.push({ t: "id", v: m[2] });
        } else {
            out.push({ t: "op", v: m[3] });
        }
    }
    out.push({ t: "end", v: "" });
    return out;
}

const noises = new Map();
function perlin(seed, x, y, z, freq, octaves, persistence) {
    let n = noises.get(seed);
    if (!n) {
        if (noises.size > 16) {
            noises.clear();
        }
        n = new Noise(seed | 0);
        noises.set(seed, n);
    }
    const oct = Math.max(1, Math.min(8, Math.round(octaves || 1)));
    return n.fbm3(x * (freq || 1), y * (freq || 1), z * (freq || 1), oct, 2, persistence === undefined ? 0.5 : persistence);
}

const FUNCS = {
    abs: Math.abs, sqrt: Math.sqrt, cbrt: Math.cbrt, sin: Math.sin, cos: Math.cos, tan: Math.tan,
    asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2, sinh: Math.sinh, cosh: Math.cosh,
    tanh: Math.tanh, exp: Math.exp, ln: Math.log, log: Math.log, log10: Math.log10, floor: Math.floor,
    ceil: Math.ceil, round: Math.round, rint: (v) => Math.round(v), pow: Math.pow, sign: Math.sign,
    signum: Math.sign, min: Math.min, max: Math.max,
    clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
    random: () => Math.random(), rand: () => Math.random(),
    randint: (a, b) => (b === undefined ? Math.floor(Math.random() * a) : a + Math.floor(Math.random() * (b - a + 1))),
    perlin
};
const CONSTS = { pi: Math.PI, e: Math.E };
const truthy = (v) => v > 0;

class Parser {
    constructor(tokens) {
        this.tk = tokens;
        this.i = 0;
    }

    peek() {
        return this.tk[this.i];
    }

    next() {
        return this.tk[this.i++];
    }

    isOp(v) {
        const t = this.peek();
        return t.t === "op" && t.v === v;
    }

    expect(v) {
        const t = this.next();
        if (t.t !== "op" || t.v !== v) {
            throw new ExprError(`Expected "${v}"` + (t.t === "end" ? " before the end" : ` but found "${t.v}"`));
        }
    }

    program() {
        const list = [];
        while (this.peek().t !== "end") {
            if (this.isOp(";")) {
                this.next();
                continue;
            }
            list.push(this.assignment());
            if (!this.isOp(";") && this.peek().t !== "end") {
                throw new ExprError(`Unexpected "${this.peek().v}"`);
            }
        }
        if (!list.length) {
            throw new ExprError("The expression is empty");
        }
        if (list.length === 1) {
            return list[0];
        }
        return (env) => {
            let v = 0;
            for (const f of list) {
                v = f(env);
            }
            return v;
        };
    }

    assignment() {
        const t = this.peek(), n = this.tk[this.i + 1];
        if (t.t === "id" && n.t === "op" && ["=", "+=", "-=", "*=", "/=", "%=", "^="].includes(n.v)) {
            if (FUNCS[t.v] || CONSTS[t.v] !== undefined) {
                throw new ExprError(`"${t.v}" cannot be assigned to`);
            }
            this.i += 2;
            const name = t.v, op = n.v, rhs = this.assignment();
            switch (op) {
                case "=": return (env) => (env[name] = rhs(env));
                case "+=": return (env) => (env[name] = (env[name] || 0) + rhs(env));
                case "-=": return (env) => (env[name] = (env[name] || 0) - rhs(env));
                case "*=": return (env) => (env[name] = (env[name] || 0) * rhs(env));
                case "/=": return (env) => (env[name] = (env[name] || 0) / rhs(env));
                case "%=": return (env) => (env[name] = (env[name] || 0) % rhs(env));
                default: return (env) => (env[name] = Math.pow(env[name] || 0, rhs(env)));
            }
        }
        return this.ternary();
    }

    ternary() {
        const c = this.or();
        if (!this.isOp("?")) {
            return c;
        }
        this.next();
        const a = this.assignment();
        this.expect(":");
        const b = this.assignment();
        return (env) => (truthy(c(env)) ? a(env) : b(env));
    }

    or() {
        let l = this.and();
        while (this.isOp("||")) {
            this.next();
            const a = l, b = this.and();
            l = (env) => (truthy(a(env)) || truthy(b(env)) ? 1 : 0);
        }
        return l;
    }

    and() {
        let l = this.equality();
        while (this.isOp("&&")) {
            this.next();
            const a = l, b = this.equality();
            l = (env) => (truthy(a(env)) && truthy(b(env)) ? 1 : 0);
        }
        return l;
    }

    equality() {
        let l = this.relational();
        while (this.isOp("==") || this.isOp("!=")) {
            const op = this.next().v, a = l, b = this.relational();
            l = op === "==" ? (env) => (a(env) === b(env) ? 1 : 0) : (env) => (a(env) !== b(env) ? 1 : 0);
        }
        return l;
    }

    relational() {
        let l = this.additive();
        while (this.isOp("<") || this.isOp("<=") || this.isOp(">") || this.isOp(">=")) {
            const op = this.next().v, a = l, b = this.additive();
            switch (op) {
                case "<": l = (env) => (a(env) < b(env) ? 1 : 0); break;
                case "<=": l = (env) => (a(env) <= b(env) ? 1 : 0); break;
                case ">": l = (env) => (a(env) > b(env) ? 1 : 0); break;
                default: l = (env) => (a(env) >= b(env) ? 1 : 0);
            }
        }
        return l;
    }

    additive() {
        let l = this.multiplicative();
        while (this.isOp("+") || this.isOp("-")) {
            const op = this.next().v, a = l, b = this.multiplicative();
            l = op === "+" ? (env) => a(env) + b(env) : (env) => a(env) - b(env);
        }
        return l;
    }

    multiplicative() {
        let l = this.unary();
        while (this.isOp("*") || this.isOp("/") || this.isOp("%")) {
            const op = this.next().v, a = l, b = this.unary();
            l = op === "*" ? (env) => a(env) * b(env) : op === "/" ? (env) => a(env) / b(env) : (env) => a(env) % b(env);
        }
        return l;
    }

    //-x^2 is -(x^2), as in maths
    unary() {
        if (this.isOp("-")) {
            this.next();
            const a = this.unary();
            return (env) => -a(env);
        }
        if (this.isOp("+")) {
            this.next();
            return this.unary();
        }
        if (this.isOp("!")) {
            this.next();
            const a = this.unary();
            return (env) => (truthy(a(env)) ? 0 : 1);
        }
        return this.power();
    }

    power() {
        const base = this.primary();
        if (!this.isOp("^")) {
            return base;
        }
        this.next();
        const ex = this.unary();
        return (env) => Math.pow(base(env), ex(env));
    }

    primary() {
        const t = this.next();
        if (t.t === "num") {
            const v = t.v;
            return () => v;
        }
        if (t.t === "op" && t.v === "(") {
            const e = this.assignment();
            this.expect(")");
            return e;
        }
        if (t.t === "id") {
            const name = t.v;
            if (this.isOp("(")) {
                this.next();
                const fn = FUNCS[name.toLowerCase()];
                if (!fn) {
                    throw new ExprError(`Unknown function "${name}"`);
                }
                const args = [];
                if (!this.isOp(")")) {
                    args.push(this.assignment());
                    while (this.isOp(",")) {
                        this.next();
                        args.push(this.assignment());
                    }
                }
                this.expect(")");
                return (env) => fn(...args.map((a) => a(env)));
            }
            if (CONSTS[name.toLowerCase()] !== undefined) {
                const v = CONSTS[name.toLowerCase()];
                return () => v;
            }
            return (env) => env[name] || 0;
        }
        throw new ExprError(t.t === "end" ? "The expression ends too early" : `Unexpected "${t.v}"`);
    }
}

//Compile an expression; the result takes an env object ({ x, y, z, ... })
//that assignments write into, and returns the value of the last statement
export function compileExpression(src) {
    const p = new Parser(tokenize(String(src)));
    return p.program();
}
