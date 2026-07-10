/*
    ArozOS Office Sheets - formula engine
    =====================================
    DOM-free parser + evaluator for spreadsheet formulas. Works both in the
    browser (global SheetFormula) and in Node (module.exports) so it can be
    unit-tested with `node test_formula.js`.

    Public API:
        colToName(i) / nameToCol("AB")          0-based column index helpers
        cellName(col,row)                        -> "A1" (0-based in, 1-based out)
        parseCellKey("A1")                       -> {col,row} or null
        tokenize(src) / parse(src)               tokens / AST ("src" WITHOUT "=")
        evaluate(ast, ctx)                       ctx.cell(col,row) -> value
        createCalculator(getRaw)                 memoized calc w/ cycle detection
            .value(col,row) -> number|string|boolean|null|FErr
            .reset()
        literalValue(raw)                        raw typed text -> value
        rewriteRelative(formula, dCol, dRow)     shift relative refs (copy/fill)
        adjustInsertDelete(formula, axis, index, count)
                                                 axis "row"|"col", count<0 = delete
        isErr(v), FErr, ERR                      error values
        dateToSerial(date) / serialToDate(n)     Excel-style 1900 date serials

    Values: number | string | boolean | null (empty) | FErr.
    Errors: #DIV/0! #NAME? #REF! #VALUE! #CYCLE! (plus #NUM!).
*/
var SheetFormula = (function () {
    "use strict";

    var ERR = {
        DIV0: "#DIV/0!",
        NAME: "#NAME?",
        REF: "#REF!",
        VALUE: "#VALUE!",
        CYCLE: "#CYCLE!",
        NUM: "#NUM!"
    };
    var ERR_LITERALS = ["#DIV/0!", "#NAME?", "#REF!", "#VALUE!", "#CYCLE!", "#NUM!", "#N/A", "#NULL!"];

    function FErr(code, msg) {
        this.code = code;
        this.message = msg || code;
    }
    FErr.prototype.toString = function () { return this.code; };
    function isErr(v) { return v instanceof FErr; }

    /* ---------- column / cell name helpers (0-based) ---------- */
    function colToName(i) {
        var s = "";
        i = i + 1;
        while (i > 0) {
            var m = (i - 1) % 26;
            s = String.fromCharCode(65 + m) + s;
            i = Math.floor((i - 1) / 26);
        }
        return s;
    }
    function nameToCol(s) {
        s = String(s).toUpperCase();
        var n = 0;
        for (var i = 0; i < s.length; i++) {
            n = n * 26 + (s.charCodeAt(i) - 64);
        }
        return n - 1;
    }
    function cellName(col, row) { return colToName(col) + (row + 1); }
    function parseCellKey(key) {
        var m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(String(key).trim());
        if (!m) return null;
        return { col: nameToCol(m[1]), row: parseInt(m[2], 10) - 1 };
    }

    /* ---------- date serials (days since 1899-12-30, Excel 1900 system) ---------- */
    var DAY_MS = 86400000;
    var EPOCH = Date.UTC(1899, 11, 30);
    function dateToSerial(d) {
        return (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(),
            d.getHours(), d.getMinutes(), d.getSeconds()) - EPOCH) / DAY_MS;
    }
    function serialToDate(n) {
        // returned Date should be read with getUTC* accessors
        return new Date(EPOCH + n * DAY_MS);
    }

    /* ---------- literal cell input -> value ---------- */
    var NUM_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
    var PCT_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)%$/;
    function literalValue(raw) {
        if (raw === undefined || raw === null) return null;
        var s = String(raw);
        if (s.charAt(0) === "'") return s.slice(1);   // forced text, Excel style
        var t = s.trim();
        if (t === "") return null;
        if (NUM_RE.test(t)) return parseFloat(t);
        if (PCT_RE.test(t)) return parseFloat(t.slice(0, -1)) / 100;
        var u = t.toUpperCase();
        if (u === "TRUE") return true;
        if (u === "FALSE") return false;
        if (ERR_LITERALS.indexOf(u) >= 0) return new FErr(u, "Error value");
        return s;
    }

    /* ---------- tokenizer ---------- */
    /* token: {t:"num"|"str"|"err"|"ref"|"name"|"op", v, pos, len, [col,row,absC,absR]} */
    function tokenize(src) {
        var toks = [], i = 0, n = src.length, m;
        while (i < n) {
            var ch = src.charAt(i);
            if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") { i++; continue; }
            if (ch === '"') {
                var j = i + 1, buf = "";
                while (j < n) {
                    if (src.charAt(j) === '"') {
                        if (src.charAt(j + 1) === '"') { buf += '"'; j += 2; }
                        else break;
                    } else { buf += src.charAt(j); j++; }
                }
                if (j >= n) throw new FErr(ERR.VALUE, "Unterminated string");
                toks.push({ t: "str", v: buf, pos: i, len: j + 1 - i });
                i = j + 1;
                continue;
            }
            if (ch === "#") {
                var lit = null;
                for (var k = 0; k < ERR_LITERALS.length; k++) {
                    if (src.substr(i, ERR_LITERALS[k].length).toUpperCase() === ERR_LITERALS[k]) {
                        lit = ERR_LITERALS[k];
                        break;
                    }
                }
                if (!lit) throw new FErr(ERR.NAME, "Unexpected '#'");
                toks.push({ t: "err", v: lit, pos: i, len: lit.length });
                i += lit.length;
                continue;
            }
            m = /^(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
            if (m) {
                toks.push({ t: "num", v: parseFloat(m[0]), pos: i, len: m[0].length });
                i += m[0].length;
                continue;
            }
            // cell reference (possibly $-anchored); a trailing "(" means function name instead
            m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![\w.(])/.exec(src.slice(i));
            if (m) {
                toks.push({
                    t: "ref",
                    absC: m[1] === "$", col: nameToCol(m[2]),
                    absR: m[3] === "$", row: parseInt(m[4], 10) - 1,
                    pos: i, len: m[0].length
                });
                i += m[0].length;
                continue;
            }
            m = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(src.slice(i));
            if (m) {
                toks.push({ t: "name", v: m[0].toUpperCase(), pos: i, len: m[0].length });
                i += m[0].length;
                continue;
            }
            var two = src.substr(i, 2);
            if (two === "<=" || two === ">=" || two === "<>") {
                toks.push({ t: "op", v: two, pos: i, len: 2 });
                i += 2;
                continue;
            }
            if ("+-*/^&%=<>(),:".indexOf(ch) >= 0) {
                toks.push({ t: "op", v: ch, pos: i, len: 1 });
                i++;
                continue;
            }
            throw new FErr(ERR.VALUE, "Unexpected character '" + ch + "'");
        }
        return toks;
    }

    /* ---------- parser ----------
       Precedence (low to high): comparison < & < +- < * / < ^ (right assoc,
       unary minus binds tighter than ^, Excel style) < % postfix < primary. */
    function parse(src) {
        var toks = tokenize(src);
        var p = 0;

        function peek() { return toks[p]; }
        function isOp(v) {
            var t = toks[p];
            return !!(t && t.t === "op" && t.v === v);
        }
        function expectOp(v) {
            if (!isOp(v)) throw new FErr(ERR.VALUE, "Expected '" + v + "'");
            p++;
        }
        function parseExpr() { return parseCompare(); }
        function parseCompare() {
            var l = parseConcat();
            while (peek() && peek().t === "op" &&
                ["=", "<>", "<", ">", "<=", ">="].indexOf(peek().v) >= 0) {
                var op = toks[p++].v;
                l = { t: "bin", op: op, l: l, r: parseConcat() };
            }
            return l;
        }
        function parseConcat() {
            var l = parseAdd();
            while (isOp("&")) { p++; l = { t: "bin", op: "&", l: l, r: parseAdd() }; }
            return l;
        }
        function parseAdd() {
            var l = parseMul();
            while (isOp("+") || isOp("-")) {
                var op = toks[p++].v;
                l = { t: "bin", op: op, l: l, r: parseMul() };
            }
            return l;
        }
        function parseMul() {
            var l = parsePower();
            while (isOp("*") || isOp("/")) {
                var op = toks[p++].v;
                l = { t: "bin", op: op, l: l, r: parsePower() };
            }
            return l;
        }
        function parsePower() {
            var b = parseUnary();
            if (isOp("^")) {
                p++;
                return { t: "bin", op: "^", l: b, r: parsePower() };
            }
            return b;
        }
        function parseUnary() {
            if (isOp("-") || isOp("+")) {
                var op = toks[p++].v;
                return { t: "un", op: op, e: parseUnary() };
            }
            return parsePostfix();
        }
        function parsePostfix() {
            var e = parsePrimary();
            while (isOp("%")) { p++; e = { t: "pct", e: e }; }
            return e;
        }
        function parsePrimary() {
            var t = peek();
            if (!t) throw new FErr(ERR.VALUE, "Unexpected end of formula");
            if (t.t === "num") { p++; return { t: "num", v: t.v }; }
            if (t.t === "str") { p++; return { t: "str", v: t.v }; }
            if (t.t === "err") { p++; return { t: "errlit", v: t.v }; }
            if (t.t === "ref") {
                p++;
                if (isOp(":")) {
                    p++;
                    var t2 = peek();
                    if (!t2 || t2.t !== "ref") throw new FErr(ERR.VALUE, "Malformed range");
                    p++;
                    return { t: "range", a: t, b: t2 };
                }
                return { t: "ref", col: t.col, row: t.row, absC: t.absC, absR: t.absR };
            }
            if (t.t === "name") {
                p++;
                if (isOp("(")) {
                    p++;
                    var args = [];
                    if (!isOp(")")) {
                        for (;;) {
                            if (isOp(",") || isOp(")")) args.push({ t: "empty" });
                            else args.push(parseExpr());
                            if (isOp(",")) { p++; continue; }
                            break;
                        }
                    }
                    expectOp(")");
                    return { t: "call", name: t.v, args: args };
                }
                if (t.v === "TRUE") return { t: "bool", v: true };
                if (t.v === "FALSE") return { t: "bool", v: false };
                throw new FErr(ERR.NAME, "Unknown name '" + t.v + "'");
            }
            if (t.t === "op" && t.v === "(") {
                p++;
                var e = parseExpr();
                expectOp(")");
                return e;
            }
            throw new FErr(ERR.VALUE, "Unexpected token '" + (t.v !== undefined ? t.v : t.t) + "'");
        }

        var ast = parseExpr();
        if (p < toks.length) throw new FErr(ERR.VALUE, "Unexpected input after formula");
        return ast;
    }

    /* ---------- evaluator ---------- */
    var MAX_RANGE_CELLS = 200000;

    function toNum(v) {
        if (isErr(v)) return v;
        if (v === null || v === undefined) return 0;
        if (typeof v === "number") return v;
        if (typeof v === "boolean") return v ? 1 : 0;
        var t = String(v).trim();
        if (NUM_RE.test(t)) return parseFloat(t);
        if (PCT_RE.test(t)) return parseFloat(t.slice(0, -1)) / 100;
        return new FErr(ERR.VALUE, "'" + v + "' is not a number");
    }
    function toStr(v) {
        if (isErr(v)) return v;
        if (v === null || v === undefined) return "";
        if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
        if (typeof v === "number") return numToText(v);
        return String(v);
    }
    function numToText(v) {
        if (!isFinite(v)) return "#NUM!";
        var s = String(v);
        if (s.indexOf("e") >= 0 || s.indexOf("E") >= 0) return s;
        // trim binary noise like 0.30000000000000004
        if (s.length > 12 && s.indexOf(".") >= 0) {
            s = String(parseFloat(v.toPrecision(12)));
        }
        return s;
    }
    function boolify(v) {
        if (isErr(v)) return v;
        if (typeof v === "boolean") return v;
        if (typeof v === "number") return v !== 0;
        if (v === null || v === undefined) return false;
        var u = String(v).trim().toUpperCase();
        if (u === "TRUE") return true;
        if (u === "FALSE") return false;
        return new FErr(ERR.VALUE, "Expected a logical value");
    }

    function evaluate(ast, ctx) {

        function ev(n) {
            switch (n.t) {
                case "num": return n.v;
                case "str": return n.v;
                case "bool": return n.v;
                case "errlit": return new FErr(n.v, "Error value");
                case "empty": return null;
                case "ref": return ctx.cell(n.col, n.row);
                case "range": return new FErr(ERR.VALUE, "A range cannot be used as a single value");
                case "pct": {
                    var pv = toNum(ev(n.e));
                    return isErr(pv) ? pv : pv / 100;
                }
                case "un": {
                    var uv = toNum(ev(n.e));
                    if (isErr(uv)) return uv;
                    return n.op === "-" ? -uv : uv;
                }
                case "bin": return binop(n);
                case "call": return call(n);
                default: return new FErr(ERR.VALUE, "Bad expression");
            }
        }

        function binop(n) {
            var op = n.op;
            if (op === "&") {
                var ls = toStr(ev(n.l));
                if (isErr(ls)) return ls;
                var rs = toStr(ev(n.r));
                if (isErr(rs)) return rs;
                return ls + rs;
            }
            if (op === "=" || op === "<>" || op === "<" || op === ">" || op === "<=" || op === ">=") {
                return compare(op, ev(n.l), ev(n.r));
            }
            var a = toNum(ev(n.l));
            if (isErr(a)) return a;
            var b = toNum(ev(n.r));
            if (isErr(b)) return b;
            var r;
            switch (op) {
                case "+": r = a + b; break;
                case "-": r = a - b; break;
                case "*": r = a * b; break;
                case "/":
                    if (b === 0) return new FErr(ERR.DIV0, "Division by zero");
                    r = a / b;
                    break;
                case "^": r = Math.pow(a, b); break;
                default: return new FErr(ERR.VALUE, "Bad operator " + op);
            }
            if (typeof r !== "number" || !isFinite(r)) return new FErr(ERR.NUM, "Numeric overflow");
            return r;
        }

        function compare(op, l, r) {
            if (isErr(l)) return l;
            if (isErr(r)) return r;
            if (typeof l === "boolean") l = l ? 1 : 0;
            if (typeof r === "boolean") r = r ? 1 : 0;
            var d;
            var ln = typeof l === "number" || l === null;
            var rn = typeof r === "number" || r === null;
            if (ln && rn) {
                d = (l === null ? 0 : l) - (r === null ? 0 : r);
            } else if (!ln && !rn) {
                var a = String(l).toLowerCase(), b = String(r).toLowerCase();
                d = a < b ? -1 : (a > b ? 1 : 0);
            } else {
                d = ln ? -1 : 1;    // any number sorts before any text (Excel)
            }
            switch (op) {
                case "=": return d === 0;
                case "<>": return d !== 0;
                case "<": return d < 0;
                case ">": return d > 0;
                case "<=": return d <= 0;
                case ">=": return d >= 0;
            }
            return new FErr(ERR.VALUE, "Bad comparison");
        }

        function eachRangeCell(node, fn) {
            var c1 = Math.min(node.a.col, node.b.col), c2 = Math.max(node.a.col, node.b.col);
            var r1 = Math.min(node.a.row, node.b.row), r2 = Math.max(node.a.row, node.b.row);
            if ((c2 - c1 + 1) * (r2 - r1 + 1) > MAX_RANGE_CELLS) {
                return new FErr(ERR.VALUE, "Range too large");
            }
            for (var r = r1; r <= r2; r++) {
                for (var c = c1; c <= c2; c++) {
                    var stop = fn(ctx.cell(c, r));
                    if (stop !== undefined) return stop;
                }
            }
            return undefined;
        }

        /* Collect numeric/count statistics over the argument list.
           Range cells: numbers counted, strings/booleans only for COUNTA.
           Direct scalars: numbers/booleans/numeric strings are numeric;
           non-numeric strings poison SUM-style aggregates (#VALUE!). */
        function collect(args) {
            var st = { nums: [], count: 0, counta: 0, badString: false, err: null };
            for (var i = 0; i < args.length; i++) {
                var a = args[i];
                if (a.t === "range") {
                    var stop = eachRangeCell(a, function (v) {
                        if (isErr(v)) return v;
                        if (v === null || v === undefined) return undefined;
                        st.counta++;
                        if (typeof v === "number") { st.nums.push(v); st.count++; }
                        return undefined;
                    });
                    if (stop !== undefined) { st.err = stop; return st; }
                } else {
                    var v = ev(a);
                    if (isErr(v)) { st.err = v; return st; }
                    if (v === null || v === undefined) continue;
                    st.counta++;
                    if (typeof v === "number") { st.nums.push(v); st.count++; }
                    else if (typeof v === "boolean") { st.nums.push(v ? 1 : 0); st.count++; }
                    else {
                        var t = String(v).trim();
                        if (NUM_RE.test(t)) { st.nums.push(parseFloat(t)); st.count++; }
                        else st.badString = true;
                    }
                }
            }
            return st;
        }

        function oneNum(args, idx, def) {
            if (idx >= args.length || args[idx].t === "empty") {
                return def !== undefined ? def : new FErr(ERR.VALUE, "Missing argument");
            }
            return toNum(ev(args[idx]));
        }
        function oneStr(args, idx) {
            if (idx >= args.length || args[idx].t === "empty") return "";
            return toStr(ev(args[idx]));
        }

        function call(n) {
            var name = n.name === "CONCATENATE" ? "CONCAT" : n.name;
            var args = n.args;
            var st, v, d;
            switch (name) {
                case "IF": {
                    if (args.length < 2 || args.length > 3) {
                        return new FErr(ERR.VALUE, "IF expects 2 or 3 arguments");
                    }
                    var cond = boolify(ev(args[0]));
                    if (isErr(cond)) return cond;
                    if (cond) return ev(args[1]);
                    return args.length > 2 ? ev(args[2]) : false;
                }
                case "SUM": {
                    st = collect(args);
                    if (st.err) return st.err;
                    if (st.badString) return new FErr(ERR.VALUE, "SUM argument is not numeric");
                    var s = 0;
                    for (var i = 0; i < st.nums.length; i++) s += st.nums[i];
                    return s;
                }
                case "AVERAGE": {
                    st = collect(args);
                    if (st.err) return st.err;
                    if (st.badString) return new FErr(ERR.VALUE, "AVERAGE argument is not numeric");
                    if (st.nums.length === 0) return new FErr(ERR.DIV0, "AVERAGE of no numbers");
                    var t = 0;
                    for (var j = 0; j < st.nums.length; j++) t += st.nums[j];
                    return t / st.nums.length;
                }
                case "MIN": case "MAX": {
                    st = collect(args);
                    if (st.err) return st.err;
                    if (st.badString) return new FErr(ERR.VALUE, name + " argument is not numeric");
                    if (st.nums.length === 0) return 0;
                    return name === "MIN" ? Math.min.apply(null, st.nums) : Math.max.apply(null, st.nums);
                }
                case "COUNT": {
                    st = collect(args);
                    if (st.err) return st.err;
                    return st.count;
                }
                case "COUNTA": {
                    st = collect(args);
                    if (st.err) return st.err;
                    return st.counta;
                }
                case "CONCAT": {
                    var out = "";
                    for (var k = 0; k < args.length; k++) {
                        if (args[k].t === "range") {
                            var stop = eachRangeCell(args[k], function (cv) {
                                if (isErr(cv)) return cv;
                                out += toStr(cv);
                                return undefined;
                            });
                            if (stop !== undefined) return stop;
                        } else {
                            var sv = toStr(ev(args[k]));
                            if (isErr(sv)) return sv;
                            out += sv;
                        }
                    }
                    return out;
                }
                case "ROUND": {
                    v = oneNum(args, 0);
                    if (isErr(v)) return v;
                    d = oneNum(args, 1, 0);
                    if (isErr(d)) return d;
                    var f = Math.pow(10, Math.trunc(d));
                    var r = Math.sign(v) * Math.round(Math.abs(v) * f) / f;
                    return r === 0 ? 0 : r;
                }
                case "ABS": {
                    v = oneNum(args, 0);
                    return isErr(v) ? v : Math.abs(v);
                }
                case "INT": {
                    v = oneNum(args, 0);
                    return isErr(v) ? v : Math.floor(v);
                }
                case "LEN": {
                    v = oneStr(args, 0);
                    return isErr(v) ? v : v.length;
                }
                case "UPPER": {
                    v = oneStr(args, 0);
                    return isErr(v) ? v : v.toUpperCase();
                }
                case "LOWER": {
                    v = oneStr(args, 0);
                    return isErr(v) ? v : v.toLowerCase();
                }
                case "TRIM": {
                    v = oneStr(args, 0);
                    return isErr(v) ? v : v.replace(/ +/g, " ").replace(/^ | $/g, "");
                }
                case "TODAY":
                    return Math.floor(dateToSerial(new Date()));
                case "NOW":
                    return dateToSerial(new Date());
                default:
                    return new FErr(ERR.NAME, "Unknown function " + name);
            }
        }

        return ev(ast);
    }

    /* ---------- memoized calculator with cycle detection ---------- */
    function createCalculator(getRaw) {
        var memo = {};
        var inStack = {};
        var ctx = { cell: cellValue };

        function cellValue(col, row) {
            var k = col + "," + row;
            if (Object.prototype.hasOwnProperty.call(memo, k)) return memo[k];
            if (inStack[k]) {
                return new FErr(ERR.CYCLE, "Circular reference through " + cellName(col, row));
            }
            var raw = getRaw(col, row);
            var v;
            if (raw === undefined || raw === null || raw === "") {
                v = null;
            } else {
                raw = String(raw);
                if (raw.charAt(0) === "=") {
                    inStack[k] = true;
                    try {
                        v = evaluate(parse(raw.slice(1)), ctx);
                    } catch (e) {
                        v = isErr(e) ? e : new FErr(ERR.VALUE, e && e.message ? e.message : "Formula error");
                    }
                    delete inStack[k];
                } else {
                    v = literalValue(raw);
                }
            }
            memo[k] = v;
            return v;
        }

        return {
            value: cellValue,
            ctx: ctx,
            reset: function () { memo = {}; inStack = {}; }
        };
    }

    /* ---------- reference rewriting (token-based, not string replace) ---------- */
    function transformRefs(formula, fn) {
        var src = String(formula);
        var hasEq = src.charAt(0) === "=";
        var body = hasEq ? src.slice(1) : src;
        var toks;
        try { toks = tokenize(body); } catch (e) { return src; }
        var out = "", last = 0;
        for (var i = 0; i < toks.length; i++) {
            var t = toks[i];
            if (t.t !== "ref") continue;
            var rep = fn(t);
            if (rep === null || rep === undefined) continue;
            out += body.slice(last, t.pos) + rep;
            last = t.pos + t.len;
        }
        out += body.slice(last);
        return (hasEq ? "=" : "") + out;
    }
    function refText(absC, col, absR, row) {
        return (absC ? "$" : "") + colToName(col) + (absR ? "$" : "") + (row + 1);
    }
    function rewriteRelative(formula, dCol, dRow) {
        return transformRefs(formula, function (t) {
            var c = t.absC ? t.col : t.col + dCol;
            var r = t.absR ? t.row : t.row + dRow;
            if (c < 0 || r < 0) return ERR.REF;
            if (c === t.col && r === t.row) return null;
            return refText(t.absC, c, t.absR, r);
        });
    }
    function adjustInsertDelete(formula, axis, index, count) {
        return transformRefs(formula, function (t) {
            var v = axis === "col" ? t.col : t.row;
            var nv;
            if (count > 0) {
                nv = v >= index ? v + count : v;
            } else {
                var del = -count;
                if (v >= index && v < index + del) return ERR.REF;
                nv = v >= index + del ? v - del : v;
            }
            if (nv === v) return null;
            var c = axis === "col" ? nv : t.col;
            var r = axis === "row" ? nv : t.row;
            return refText(t.absC, c, t.absR, r);
        });
    }

    return {
        ERR: ERR,
        FErr: FErr,
        isErr: isErr,
        colToName: colToName,
        nameToCol: nameToCol,
        cellName: cellName,
        parseCellKey: parseCellKey,
        tokenize: tokenize,
        parse: parse,
        evaluate: evaluate,
        createCalculator: createCalculator,
        literalValue: literalValue,
        numToText: numToText,
        rewriteRelative: rewriteRelative,
        adjustInsertDelete: adjustInsertDelete,
        dateToSerial: dateToSerial,
        serialToDate: serialToDate
    };
})();

/* Node (CommonJS) export for unit tests; harmless in the browser */
if (typeof module !== "undefined" && module.exports) {
    module.exports = SheetFormula;
}
