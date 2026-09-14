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
        evaluate(ast, ctx)                       ctx.cell(col,row,sheetName) -> value
        createCalculator(getRaw, opts)           memoized workbook calc w/ cycle detection
            .value(col,row,[sheetIdx]) -> number|string|boolean|null|FErr
            .reset()
        literalValue(raw)                        raw typed text -> value
        rewriteRelative(formula, dCol, dRow)     shift relative refs (copy/fill)
        adjustInsertDelete(formula, axis, index, count, [sheet])
                                                 axis "row"|"col", count<0 = delete
        renameSheetRefs(formula, oldName, newName)
        isErr(v), FErr, ERR                      error values
        dateToSerial(date) / serialToDate(n)     Excel-style 1900 date serials

    Values: number | string | boolean | null (empty) | FErr.
    Errors: #DIV/0! #NAME? #REF! #VALUE! #CYCLE! #NUM! #N/A.

    References: A1, $A$1, A1:B9, Sheet2!A1, 'Closed Tickets'!$C$3:$C$5000.
    Ranges inside SUMPRODUCT (and array expressions handed to SUM & co.)
    evaluate as arrays, with operators applied element by element.

    Functions:
        logical    IF IFS IFERROR IFNA AND OR NOT
        lookup     VLOOKUP HLOOKUP CHOOSE
        aggregate  SUM AVERAGE MIN MAX COUNT COUNTA SUMPRODUCT
        math       ROUND ABS INT MOD
        text       CONCAT (=CONCATENATE) LEN UPPER LOWER TRIM
        date       TODAY NOW DATE YEAR MONTH DAY WEEKDAY HOUR MINUTE SECOND

    IF / IFS / IFERROR evaluate only the branch they return, so
    IF(A1=0,"",1/A1) never divides by zero. IF's value_if_false is optional
    and blank when omitted (the Sheets rule - Excel answers FALSE there).
    Text comparison is case-insensitive throughout, again matching Sheets.
*/
var SheetFormula = (function () {
    "use strict";

    var ERR = {
        DIV0: "#DIV/0!",
        NAME: "#NAME?",
        REF: "#REF!",
        VALUE: "#VALUE!",
        CYCLE: "#CYCLE!",
        NUM: "#NUM!",
        NA: "#N/A"          // lookup found nothing (VLOOKUP / MATCH / IFS)
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
    /* token: {t:"num"|"str"|"err"|"ref"|"name"|"op", v, pos, len,
               [col,row,absC,absR, sheet, prefix]}
       A sheet-qualified ref carries sheet (the unquoted name) and prefix
       (the source text up to and including "!"); pos/len cover both. */
    var REF_RE = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![\w.(!])/;
    // an unquoted sheet name must be followed by "!" and a cell address
    var SHEET_PREFIX_RE = /^([A-Za-z_][A-Za-z0-9_.]*)!(?=\$?[A-Za-z]{1,3}\$?\d)/;
    var PLAIN_SHEET_RE = /^[A-Za-z_][A-Za-z0-9_.]*$/;

    // how a sheet name is written in front of "!": quoted unless it is a
    // plain identifier that cannot be mistaken for a cell address
    function quoteSheetName(name) {
        name = String(name);
        if (PLAIN_SHEET_RE.test(name) && !/^[A-Za-z]{1,3}\d+$/.test(name)) return name;
        return "'" + name.replace(/'/g, "''") + "'";
    }
    function sameSheetName(a, b) {
        return String(a).toLowerCase() === String(b).toLowerCase();
    }
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
            // sheet-qualified reference: 'Closed Tickets'!$C$3 or Analysis!H2.
            // The prefix is kept in the token so reference rewriting can put
            // it back in front of the shifted address.
            var sheetName = null, prefixLen = 0;
            if (ch === "'") {
                var q = i + 1, qname = "";
                while (q < n) {
                    if (src.charAt(q) === "'") {
                        if (src.charAt(q + 1) === "'") { qname += "'"; q += 2; continue; }
                        break;
                    }
                    qname += src.charAt(q);
                    q++;
                }
                if (q >= n || src.charAt(q + 1) !== "!") throw new FErr(ERR.REF, "Malformed sheet name");
                sheetName = qname;
                prefixLen = q + 2 - i;
            } else {
                m = SHEET_PREFIX_RE.exec(src.slice(i));
                if (m) { sheetName = m[1]; prefixLen = m[0].length; }
            }
            // cell reference (possibly $-anchored); a trailing "(" means function name instead
            m = REF_RE.exec(src.slice(i + prefixLen));
            if (m) {
                var tok = {
                    t: "ref",
                    absC: m[1] === "$", col: nameToCol(m[2]),
                    absR: m[3] === "$", row: parseInt(m[4], 10) - 1,
                    pos: i, len: prefixLen + m[0].length
                };
                if (sheetName !== null) {
                    tok.sheet = sheetName;
                    tok.prefix = src.substr(i, prefixLen);
                } else if (toks.length >= 2 && toks[toks.length - 1].t === "op" && toks[toks.length - 1].v === ":" &&
                    toks[toks.length - 2].t === "ref" && toks[toks.length - 2].sheet !== undefined) {
                    // the end of Sheet!A1:B2 is on Sheet too (no prefix to rewrite)
                    tok.sheet = toks[toks.length - 2].sheet;
                }
                toks.push(tok);
                i += tok.len;
                continue;
            }
            if (sheetName !== null) throw new FErr(ERR.REF, "Expected a cell reference after " + sheetName + "!");
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
                    // Sheet!A1:B2 names the sheet once; Sheet!A1:Sheet!B2 is also legal
                    var rs = t.sheet !== undefined ? t.sheet : t2.sheet;
                    if (t.sheet !== undefined && t2.sheet !== undefined && !sameSheetName(t.sheet, t2.sheet)) {
                        throw new FErr(ERR.REF, "A range cannot span two sheets");
                    }
                    return { t: "range", a: t, b: t2, sheet: rs };
                }
                return { t: "ref", col: t.col, row: t.row, absC: t.absC, absR: t.absR, sheet: t.sheet };
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

    /* An array value: what a range (or an operator applied to ranges)
       yields inside an array context such as SUMPRODUCT's arguments.
       data is row-major, rows x cols long. */
    function Arr(rows, cols, data) {
        this.rows = rows;
        this.cols = cols;
        this.data = data;
    }
    function isArr(v) { return v instanceof Arr; }

    /*
        Evaluate an AST. ctx.cell(col, row, sheet) returns a cell's value;
        sheet is the name written in the formula, or undefined for the
        formula's own sheet. ctx.range(c1, r1, c2, r2, sheet), when present,
        returns the values of a whole range as an Arr (the calculator caches
        these, which is what keeps thousands of SUMPRODUCTs over the same
        column affordable); without it ranges are read cell by cell.
    */
    function evaluate(ast, ctx) {

        function ev(n) {
            switch (n.t) {
                case "num": return n.v;
                case "str": return n.v;
                case "bool": return n.v;
                case "errlit": return new FErr(n.v, "Error value");
                case "empty": return null;
                case "ref": return ctx.cell(n.col, n.row, n.sheet);
                case "range": return new FErr(ERR.VALUE, "A range cannot be used as a single value");
                case "pct": {
                    var pv = toNum(ev(n.e));
                    return isErr(pv) ? pv : pv / 100;
                }
                case "un": return unValue(n.op, ev(n.e));
                case "bin":
                    // comparisons and arithmetic need both sides anyway
                    return binValue(n.op, ev(n.l), ev(n.r));
                case "call": return call(n, false);
                default: return new FErr(ERR.VALUE, "Bad expression");
            }
        }

        /* Array-context evaluation: ranges become Arr values and operators
           apply element by element (Excel's array semantics), so
           ('Data'!A2:A99="x")*('Data'!B2:B99) is an array of numbers. */
        function evA(n) {
            switch (n.t) {
                case "range": return rangeArr(n);
                case "pct": return lift1(evA(n.e), function (v) {
                    v = toNum(v);
                    return isErr(v) ? v : v / 100;
                });
                case "un": {
                    var op = n.op;
                    return lift1(evA(n.e), function (v) { return unValue(op, v); });
                }
                case "bin": {
                    var bop = n.op, l = evA(n.l), r = evA(n.r);
                    if (!isArr(l) && !isArr(r)) return binValue(bop, l, r);
                    return binArr(bop, l, r);
                }
                case "call": return call(n, true);
                default: return ev(n);
            }
        }

        function rangeArr(node) {
            var b = rangeBox(node);
            if ((b.c2 - b.c1 + 1) * (b.r2 - b.r1 + 1) > MAX_RANGE_CELLS) {
                return new FErr(ERR.VALUE, "Range too large");
            }
            if (ctx.range) return ctx.range(b.c1, b.r1, b.c2, b.r2, node.sheet);
            var data = [];
            for (var r = b.r1; r <= b.r2; r++) {
                for (var c = b.c1; c <= b.c2; c++) data.push(ctx.cell(c, r, node.sheet));
            }
            return new Arr(b.r2 - b.r1 + 1, b.c2 - b.c1 + 1, data);
        }

        function lift1(v, fn) {
            if (!isArr(v)) return fn(v);
            var out = new Array(v.data.length);
            for (var i = 0; i < out.length; i++) out[i] = fn(v.data[i]);
            return new Arr(v.rows, v.cols, out);
        }
        /* Element-wise over two values with Excel broadcasting: a scalar or a
           single row / column stretches to fit; cells that exist in neither
           operand (mismatched sizes) are #N/A. */
        function lift2(a, b, fn) {
            var A = isArr(a) ? a : new Arr(1, 1, [a]);
            var B = isArr(b) ? b : new Arr(1, 1, [b]);
            var rows = Math.max(A.rows, B.rows), cols = Math.max(A.cols, B.cols);
            var out = new Array(rows * cols);
            if (A.rows === B.rows && A.cols === B.cols) {
                for (var i = 0; i < out.length; i++) out[i] = fn(A.data[i], B.data[i]);
            } else {
                for (var r = 0; r < rows; r++) {
                    for (var c = 0; c < cols; c++) {
                        var av = pick(A, r, c), bv = pick(B, r, c);
                        out[r * cols + c] = (av === undefined || bv === undefined) ?
                            new FErr(ERR.NA, "Array sizes do not match") : fn(av, bv);
                    }
                }
            }
            return new Arr(rows, cols, out);
        }
        /*
            An operator over arrays. Same-size arrays and array-with-scalar
            (the shapes SUMPRODUCT criteria produce) run a tight loop that
            handles number/number, text/text and logical arithmetic inline;
            anything else falls back to binValue, so results are identical.
            Text is compared through a lower-cased copy that is cached on the
            array, and cached ranges keep it across formulas.
        */
        function binArr(op, l, r) {
            var A = isArr(l) ? l : new Arr(1, 1, [l]);
            var B = isArr(r) ? r : new Arr(1, 1, [r]);
            var la = A.data.length, lb = B.data.length;
            var same = A.rows === B.rows && A.cols === B.cols;
            if (!same && la !== 1 && lb !== 1) {
                return lift2(A, B, function (a, b) { return binValue(op, a, b); });
            }
            var rows = la === 1 ? B.rows : A.rows, cols = la === 1 ? B.cols : A.cols;
            var len = Math.max(la, lb), out = new Array(len);
            var sa = la === 1, sb = lb === 1;
            var ad = A.data, bd = B.data, i, x, y, d, res;
            var cmp = op === "=" || op === "<>" || op === "<" || op === ">" || op === "<=" || op === ">=";
            // a cached range against a constant: the same criterion shows up
            // in every formula of a report, so compute it once per recalc
            var memoArr = null, memoKey = null;
            if (cmp && (A.shared ? sb && !isErr(bd[0]) : B.shared && sa && !isErr(ad[0]))) {
                memoArr = A.shared ? A : B;
                var other = A.shared ? bd[0] : ad[0];
                memoKey = (A.shared ? "L" : "R") + op + typeof other + ":" + other;
                if (!memoArr.cmp) memoArr.cmp = {};
                if (Object.prototype.hasOwnProperty.call(memoArr.cmp, memoKey)) return memoArr.cmp[memoKey];
            }
            if (cmp) {
                var ax = lowered(A), bx = lowered(B);
                for (i = 0; i < len; i++) {
                    x = ax[sa ? 0 : i];
                    y = bx[sb ? 0 : i];
                    var tx = typeof x, ty = typeof y;
                    if (tx === "number" && ty === "number") d = x - y;
                    else if (tx === "string" && ty === "string") d = x < y ? -1 : (x > y ? 1 : 0);
                    else { out[i] = compare(op, ad[sa ? 0 : i], bd[sb ? 0 : i]); continue; }
                    switch (op) {
                        case "=": out[i] = d === 0; break;
                        case "<>": out[i] = d !== 0; break;
                        case "<": out[i] = d < 0; break;
                        case ">": out[i] = d > 0; break;
                        case "<=": out[i] = d <= 0; break;
                        default: out[i] = d >= 0;
                    }
                }
            } else if (op === "+" || op === "-" || op === "*" || op === "/") {
                for (i = 0; i < len; i++) {
                    x = ad[sa ? 0 : i];
                    y = bd[sb ? 0 : i];
                    if (typeof x === "boolean") x = x ? 1 : 0;
                    else if (x === null) x = 0;
                    if (typeof y === "boolean") y = y ? 1 : 0;
                    else if (y === null) y = 0;
                    if (typeof x !== "number" || typeof y !== "number" || (op === "/" && y === 0)) {
                        out[i] = binValue(op, ad[sa ? 0 : i], bd[sb ? 0 : i]);
                        continue;
                    }
                    res = op === "*" ? x * y : op === "+" ? x + y : op === "-" ? x - y : x / y;
                    out[i] = isFinite(res) ? res : new FErr(ERR.NUM, "Numeric overflow");
                }
            } else {
                for (i = 0; i < len; i++) out[i] = binValue(op, ad[sa ? 0 : i], bd[sb ? 0 : i]);
            }
            var result = new Arr(rows, cols, out);
            // results are never mutated, so handing the same one out is safe
            if (memoArr) memoArr.cmp[memoKey] = result;
            return result;
        }
        // the array's values with text lower-cased (compare() is case-insensitive)
        function lowered(A) {
            if (A.lower) return A.lower;
            var src = A.data, out = new Array(src.length), any = false;
            for (var i = 0; i < src.length; i++) {
                var v = src[i];
                if (typeof v === "string") { out[i] = v.toLowerCase(); any = true; }
                else out[i] = v;
            }
            A.lower = any ? out : src;
            return A.lower;
        }
        function pick(A, r, c) {
            var rr = A.rows === 1 ? 0 : r, cc = A.cols === 1 ? 0 : c;
            if (rr >= A.rows || cc >= A.cols) return undefined;
            return A.data[rr * A.cols + cc];
        }

        function unValue(op, v) {
            v = toNum(v);
            if (isErr(v)) return v;
            return op === "-" ? -v : v;
        }

        function binValue(op, l, r) {
            if (op === "&") {
                var ls = toStr(l);
                if (isErr(ls)) return ls;
                var rs = toStr(r);
                if (isErr(rs)) return rs;
                return ls + rs;
            }
            if (op === "=" || op === "<>" || op === "<" || op === ">" || op === "<=" || op === ">=") {
                return compare(op, l, r);
            }
            var a = toNum(l);
            if (isErr(a)) return a;
            var b = toNum(r);
            if (isErr(b)) return b;
            var res;
            switch (op) {
                case "+": res = a + b; break;
                case "-": res = a - b; break;
                case "*": res = a * b; break;
                case "/":
                    if (b === 0) return new FErr(ERR.DIV0, "Division by zero");
                    res = a / b;
                    break;
                case "^": res = Math.pow(a, b); break;
                default: return new FErr(ERR.VALUE, "Bad operator " + op);
            }
            if (typeof res !== "number" || !isFinite(res)) return new FErr(ERR.NUM, "Numeric overflow");
            return res;
        }

        function compare(op, l, r) {
            if (isErr(l)) return l;
            if (isErr(r)) return r;
            // a blank cell compares as "" against text (so =A1="" is TRUE)
            // and as 0 against numbers
            if (l === null && typeof r === "string") l = "";
            if (r === null && typeof l === "string") r = "";
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

        // normalized bounds of a range node, for functions that index into a
        // range in two dimensions (lookups) rather than just sweeping it
        function rangeBox(node) {
            return {
                c1: Math.min(node.a.col, node.b.col), c2: Math.max(node.a.col, node.b.col),
                r1: Math.min(node.a.row, node.b.row), r2: Math.max(node.a.row, node.b.row)
            };
        }
        function eachRangeCell(node, fn) {
            return eachArrCell(rangeArr(node), fn);
        }
        function eachArrCell(arr, fn) {
            if (isErr(arr)) return arr;
            for (var i = 0; i < arr.data.length; i++) {
                var stop = fn(arr.data[i]);
                if (stop !== undefined) return stop;
            }
            return undefined;
        }

        /* Collect numeric/count statistics over the argument list.
           Range cells: numbers counted, strings/booleans only for COUNTA.
           Array expressions (=SUM((A1:A9>0)*B1:B9)) count like ranges.
           Direct scalars: numbers/booleans/numeric strings are numeric;
           non-numeric strings poison SUM-style aggregates (#VALUE!). */
        function collect(args) {
            var st = { nums: [], count: 0, counta: 0, badString: false, err: null };
            function fromCells(v) {
                if (isErr(v)) return v;
                if (v === null || v === undefined) return undefined;
                st.counta++;
                if (typeof v === "number") { st.nums.push(v); st.count++; }
                return undefined;
            }
            for (var i = 0; i < args.length; i++) {
                var a = args[i];
                var stop;
                if (a.t === "range") {
                    stop = eachRangeCell(a, fromCells);
                    if (stop !== undefined) { st.err = stop; return st; }
                } else {
                    var v = (a.t === "bin" || a.t === "un" || a.t === "call") ? evA(a) : ev(a);
                    if (isArr(v)) {
                        stop = eachArrCell(v, fromCells);
                        if (stop !== undefined) { st.err = stop; return st; }
                        continue;
                    }
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

        /*
            VLOOKUP(search_key, range, index, [is_sorted]) and its transposed
            twin HLOOKUP. `index` is 1-based *within the range*, so column 1
            is the range's own first column, not the sheet's.

            is_sorted defaults to TRUE, meaning "closest match at or below the
            key". Excel and Sheets binary-search for that, which silently
            returns nonsense when the data is not actually sorted; this scans
            instead and keeps the best match at or below the key. On sorted
            data - the only case those two define - the answer is identical,
            and on unsorted data this one is merely imperfect rather than
            arbitrary. FALSE means exact match only.
        */
        function lookup(name, args) {
            if (args.length < 3 || args.length > 4) {
                return new FErr(ERR.VALUE, name + " expects 3 or 4 arguments");
            }
            var keyv = ev(args[0]);
            if (isErr(keyv)) return keyv;
            if (args[1].t !== "range") {
                return new FErr(ERR.VALUE, name + " needs a range to search, e.g. B2:D9");
            }
            var box = rangeBox(args[1]);
            var idx = oneNum(args, 2);
            if (isErr(idx)) return idx;
            idx = Math.trunc(idx);
            var vertical = name === "VLOOKUP";
            var depth = vertical ? box.c2 - box.c1 + 1 : box.r2 - box.r1 + 1;
            if (idx < 1) return new FErr(ERR.VALUE, name + " index must be 1 or more");
            if (idx > depth) {
                return new FErr(ERR.REF, name + " index " + idx + " is past the end of the range");
            }
            var sorted = true;
            if (args.length > 3 && args[3].t !== "empty") {
                var sv = boolify(ev(args[3]));
                if (isErr(sv)) return sv;
                sorted = sv;
            }
            var span = vertical ? box.r2 - box.r1 + 1 : box.c2 - box.c1 + 1;
            if (span * depth > MAX_RANGE_CELLS) {
                return new FErr(ERR.VALUE, "Range too large");
            }
            var sh = args[1].sheet;
            var keyAt = vertical ?
                function (i) { return ctx.cell(box.c1, box.r1 + i, sh); } :
                function (i) { return ctx.cell(box.c1 + i, box.r1, sh); };
            var resultAt = vertical ?
                function (i) { return ctx.cell(box.c1 + idx - 1, box.r1 + i, sh); } :
                function (i) { return ctx.cell(box.c1 + i, box.r1 + idx - 1, sh); };

            var best = -1, bestVal = null, i, cv, cmp;
            for (i = 0; i < span; i++) {
                cv = keyAt(i);
                if (isErr(cv) || cv === null || cv === undefined) continue;
                if (compare("=", keyv, cv) === true) return resultAt(i);
                if (!sorted) continue;
                // approximate: remember the largest entry still <= the key
                if (compare("<=", cv, keyv) !== true) continue;
                if (best < 0 || compare(">", cv, bestVal) === true) {
                    best = i;
                    bestVal = cv;
                }
            }
            if (best >= 0) return resultAt(best);
            return new FErr(ERR.NA, name + " found no match for " + toStr(keyv));
        }

        // whole days of a date serial, as a UTC Date (see serialToDate)
        function serialDate(args) {
            var sv = oneNum(args, 0);
            if (isErr(sv)) return sv;
            if (sv < 0) return new FErr(ERR.NUM, "Dates cannot be negative");
            return serialToDate(Math.floor(sv));
        }
        // seconds into the day of a date/time serial, rounded like Excel
        function serialSeconds(args) {
            var sv = oneNum(args, 0);
            if (isErr(sv)) return sv;
            if (sv < 0) return new FErr(ERR.NUM, "Times cannot be negative");
            return Math.round((sv - Math.floor(sv)) * 86400) % 86400;
        }

        /*
            SUMPRODUCT(array1, [array2, ...]): every argument is evaluated in
            array context, all must be the same size, and the element-wise
            products are summed. Text, blanks and logicals count as 0 (hence
            the usual (A1:A9="x")*(B1:B9) idiom, where the multiplication has
            already turned the logicals into numbers); an error anywhere is
            the result.
        */
        function sumproduct(args) {
            if (!args.length) return new FErr(ERR.VALUE, "SUMPRODUCT needs an argument");
            var arrs = [];
            for (var i = 0; i < args.length; i++) {
                var v = evA(args[i]);
                if (isErr(v)) return v;
                if (!isArr(v)) v = new Arr(1, 1, [v]);
                if (arrs.length && (v.rows !== arrs[0].rows || v.cols !== arrs[0].cols)) {
                    return new FErr(ERR.VALUE, "SUMPRODUCT arrays must be the same size");
                }
                arrs.push(v);
            }
            var total = 0, len = arrs[0].data.length;
            for (var k = 0; k < len; k++) {
                var prod = 1;
                for (var j = 0; j < arrs.length; j++) {
                    var x = arrs[j].data[k];
                    if (typeof x === "number") prod *= x;
                    else if (isErr(x)) return x;
                    else prod = 0;
                }
                total += prod;
            }
            return total;
        }

        function call(n, arrayCtx) {
            var name = n.name === "CONCATENATE" ? "CONCAT" : n.name;
            var args = n.args;
            var st, v, d;
            switch (name) {
                case "IF": {
                    if (args.length < 2 || args.length > 3) {
                        return new FErr(ERR.VALUE, "IF expects 2 or 3 arguments");
                    }
                    if (arrayCtx) {
                        // IF over an array condition picks element by element
                        var ac = evA(args[0]);
                        if (isArr(ac)) {
                            var at = evA(args[1]);
                            var af = args.length > 2 ? evA(args[2]) : null;
                            return lift2(lift2(ac, at, function (c, t) { return [c, t]; }), af, function (ct, f) {
                                var cb = boolify(ct[0]);
                                if (isErr(cb)) return cb;
                                return cb ? ct[1] : f;
                            });
                        }
                        var acb = boolify(ac);
                        if (isErr(acb)) return acb;
                        if (acb) return evA(args[1]);
                        return args.length > 2 ? evA(args[2]) : null;
                    }
                    var cond = boolify(ev(args[0]));
                    if (isErr(cond)) return cond;
                    // only the taken branch is evaluated, so
                    // IF(A1=0,"",1/A1) never divides by zero
                    if (cond) return ev(args[1]);
                    // value_if_false is optional and blank by default (the
                    // Sheets rule); Excel would answer FALSE here
                    return args.length > 2 ? ev(args[2]) : null;
                }
                case "IFERROR":
                case "IFNA": {
                    if (args.length < 1 || args.length > 2) {
                        return new FErr(ERR.VALUE, name + " expects 1 or 2 arguments");
                    }
                    var tryv;
                    try { tryv = ev(args[0]); }
                    catch (e) { tryv = isErr(e) ? e : new FErr(ERR.VALUE, "Formula error"); }
                    var caught = name === "IFNA" ?
                        (isErr(tryv) && tryv.code === ERR.NA) : isErr(tryv);
                    if (!caught) return tryv;
                    return args.length > 1 ? ev(args[1]) : null;
                }
                case "IFS": {
                    // condition / value pairs, first true one wins
                    if (args.length < 2 || args.length % 2 !== 0) {
                        return new FErr(ERR.VALUE, "IFS expects condition/value pairs");
                    }
                    for (var ifsI = 0; ifsI < args.length; ifsI += 2) {
                        var ifsC = boolify(ev(args[ifsI]));
                        if (isErr(ifsC)) return ifsC;
                        if (ifsC) return ev(args[ifsI + 1]);
                    }
                    return new FErr(ERR.NA, "No IFS condition was true");
                }
                case "AND":
                case "OR": {
                    if (!args.length) return new FErr(ERR.VALUE, name + " needs an argument");
                    // blanks are skipped, and so is text that comes from a
                    // referenced cell or range (Excel's rule); only text
                    // typed straight into the call is an error
                    var seen = 0, acc = name === "AND";
                    for (var lI = 0; lI < args.length; lI++) {
                        var vals = [];
                        var fromRef = args[lI].t === "range" || args[lI].t === "ref";
                        if (args[lI].t === "range") {
                            var lStop = eachRangeCell(args[lI], function (cv) {
                                if (isErr(cv)) return cv;
                                vals.push(cv);
                                return undefined;
                            });
                            if (lStop !== undefined) return lStop;
                        } else {
                            var lv = ev(args[lI]);
                            if (isErr(lv)) return lv;
                            vals.push(lv);
                        }
                        for (var vI = 0; vI < vals.length; vI++) {
                            if (vals[vI] === null || vals[vI] === undefined) continue;
                            if (fromRef && typeof vals[vI] === "string") continue;
                            var b = boolify(vals[vI]);
                            if (isErr(b)) return b;
                            seen++;
                            if (name === "AND") acc = acc && b;
                            else acc = acc || b;
                        }
                    }
                    if (!seen) return new FErr(ERR.VALUE, name + " found no logical values");
                    return acc;
                }
                case "NOT": {
                    if (args.length !== 1) return new FErr(ERR.VALUE, "NOT expects 1 argument");
                    var nv = boolify(ev(args[0]));
                    return isErr(nv) ? nv : !nv;
                }
                case "VLOOKUP":
                case "HLOOKUP":
                    return lookup(name, args);
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
                case "SUMPRODUCT":
                    return sumproduct(args);
                case "CHOOSE": {
                    // CHOOSE(index, value1, value2, ...) - only the chosen one is evaluated
                    if (args.length < 2) return new FErr(ERR.VALUE, "CHOOSE expects an index and values");
                    v = oneNum(args, 0);
                    if (isErr(v)) return v;
                    v = Math.trunc(v);
                    if (v < 1 || v >= args.length) return new FErr(ERR.VALUE, "CHOOSE index " + v + " is out of range");
                    return arrayCtx ? evA(args[v]) : ev(args[v]);
                }
                case "MOD": {
                    v = oneNum(args, 0);
                    if (isErr(v)) return v;
                    d = oneNum(args, 1);
                    if (isErr(d)) return d;
                    if (d === 0) return new FErr(ERR.DIV0, "MOD by zero");
                    // the result takes the divisor's sign, as in Excel
                    return v - d * Math.floor(v / d);
                }
                case "YEAR": case "MONTH": case "DAY": {
                    var dt = serialDate(args);
                    if (isErr(dt)) return dt;
                    if (name === "YEAR") return dt.getUTCFullYear();
                    return name === "MONTH" ? dt.getUTCMonth() + 1 : dt.getUTCDate();
                }
                case "WEEKDAY": {
                    // return_type 1 (default): Sunday=1 .. Saturday=7;
                    // 2: Monday=1 .. Sunday=7; 3: Monday=0 .. Sunday=6;
                    // 11-17: 1 on Monday .. Sunday respectively
                    var wd = serialDate(args);
                    if (isErr(wd)) return wd;
                    var wt = oneNum(args, 1, 1);
                    if (isErr(wt)) return wt;
                    var dow = wd.getUTCDay();   // 0 = Sunday
                    wt = Math.trunc(wt);
                    if (wt === 1) return dow + 1;
                    if (wt === 2) return (dow + 6) % 7 + 1;
                    if (wt === 3) return (dow + 6) % 7;
                    // 11 starts the week on Monday (getUTCDay 1) .. 17 on Sunday (0)
                    if (wt >= 11 && wt <= 17) return (dow - (wt - 10) % 7 + 7) % 7 + 1;
                    return new FErr(ERR.NUM, "WEEKDAY return type " + wt + " is not supported");
                }
                case "HOUR": case "MINUTE": case "SECOND": {
                    var secs = serialSeconds(args);
                    if (isErr(secs)) return secs;
                    if (name === "HOUR") return Math.floor(secs / 3600);
                    return name === "MINUTE" ? Math.floor(secs / 60) % 60 : secs % 60;
                }
                case "DATE": {
                    var y = oneNum(args, 0), mo = oneNum(args, 1), dd = oneNum(args, 2);
                    if (isErr(y)) return y;
                    if (isErr(mo)) return mo;
                    if (isErr(dd)) return dd;
                    y = Math.trunc(y);
                    if (y >= 0 && y < 1900) y += 1900;     // Excel: DATE(12,1,1) is 1912
                    if (y < 0 || y > 9999) return new FErr(ERR.NUM, "DATE year out of range");
                    var ser = (Date.UTC(y, Math.trunc(mo) - 1, Math.trunc(dd)) - EPOCH) / DAY_MS;
                    return ser < 0 ? new FErr(ERR.NUM, "DATE before 1900") : ser;
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
    /*
        createCalculator(getRaw, [opts])
            getRaw(col, row, sheetIdx) -> the raw text of a cell
            opts.sheetIndex(name) -> index of the sheet called name, or -1
            opts.activeSheet()    -> index unqualified lookups default to (0)
        Without opts there is one anonymous sheet and Sheet!A1 is #REF!.

        Values are memoized per sheet + cell, and whole ranges are cached
        as arrays, until reset(). Every formula evaluates its unqualified
        references against its own sheet. ctx always follows the active
        sheet, so callers can keep a reference to it across tab switches.
    */
    function createCalculator(getRaw, opts) {
        opts = opts || {};
        var memo = {};
        var ranges = {};
        var inStack = {};
        var astCache = {};
        var ctxs = {};

        function active() { return opts.activeSheet ? opts.activeSheet() : 0; }
        function resolve(home, name) {
            if (name === undefined || name === null) return home;
            return opts.sheetIndex ? opts.sheetIndex(name) : -1;
        }
        function refErr(name) {
            return new FErr(ERR.REF, "There is no sheet called " + name);
        }
        function ctxFor(s) {
            if (!ctxs[s]) {
                ctxs[s] = {
                    cell: function (c, r, name) {
                        var si = resolve(s, name);
                        return si < 0 ? refErr(name) : cellValue(c, r, si);
                    },
                    range: function (c1, r1, c2, r2, name) {
                        var si = resolve(s, name);
                        return si < 0 ? refErr(name) : rangeValues(c1, r1, c2, r2, si);
                    }
                };
            }
            return ctxs[s];
        }

        function rangeValues(c1, r1, c2, r2, s) {
            var k = s + "!" + c1 + "," + r1 + ":" + c2 + "," + r2;
            if (Object.prototype.hasOwnProperty.call(ranges, k)) return ranges[k];
            var data = new Array((c2 - c1 + 1) * (r2 - r1 + 1)), i = 0;
            for (var r = r1; r <= r2; r++) {
                for (var c = c1; c <= c2; c++) data[i++] = cellValue(c, r, s);
            }
            var arr = new Arr(r2 - r1 + 1, c2 - c1 + 1, data);
            arr.shared = true;      // lives until reset(): binArr may memoize on it
            ranges[k] = arr;
            return arr;
        }

        function cellValue(col, row, s) {
            if (s === undefined || s === null) s = active();
            var k = s + "!" + col + "," + row;
            if (Object.prototype.hasOwnProperty.call(memo, k)) return memo[k];
            if (inStack[k]) {
                return new FErr(ERR.CYCLE, "Circular reference through " + cellName(col, row));
            }
            var raw = getRaw(col, row, s);
            var v;
            if (raw === undefined || raw === null || raw === "") {
                v = null;
            } else {
                raw = String(raw);
                if (raw.charAt(0) === "=") {
                    inStack[k] = true;
                    try {
                        // identical formula text (fill-down columns) parses once
                        var body = raw.slice(1);
                        var ast = Object.prototype.hasOwnProperty.call(astCache, body) ? astCache[body] : null;
                        if (!ast) {
                            ast = parse(body);
                            astCache[body] = ast;
                        }
                        v = evaluate(ast, ctxFor(s));
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
            ctx: {
                cell: function (c, r, name) { return ctxFor(active()).cell(c, r, name); },
                range: function (c1, r1, c2, r2, name) { return ctxFor(active()).range(c1, r1, c2, r2, name); }
            },
            reset: function () { memo = {}; ranges = {}; inStack = {}; }
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
            // the fn rewrites the address; a sheet prefix stays in front of it
            if (t.prefix && rep !== ERR.REF) rep = t.prefix + rep;
            out += body.slice(last, t.pos) + rep;
            last = t.pos + t.len;
        }
        out += body.slice(last);
        return (hasEq ? "=" : "") + out;
    }
    function refText(absC, col, absR, row) {
        return (absC ? "$" : "") + colToName(col) + (absR ? "$" : "") + (row + 1);
    }
    /* true when a ref token points at sheet `target` from a formula living
       on sheet `home`; with no target given every ref qualifies (the
       single-sheet behaviour) */
    function refOnSheet(t, target, home) {
        if (target === undefined || target === null) return true;
        var s = t.sheet !== undefined ? t.sheet : home;
        return s !== undefined && s !== null && sameSheetName(s, target);
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
    /* Excel "move cells" semantics: every reference (absolute ones too)
       that points INSIDE the moved source range follows it to the new
       location; references outside the range are untouched. rg is
       {c1,r1,c2,r2} inclusive, 0-based. Optional sheet {target, home}:
       only refs to sheet target count, for a formula on sheet home. */
    function rewriteMovedRange(formula, rg, dCol, dRow, sheet) {
        return transformRefs(formula, function (t) {
            if (sheet && !refOnSheet(t, sheet.target, sheet.home)) return null;
            if (t.col < rg.c1 || t.col > rg.c2 || t.row < rg.r1 || t.row > rg.r2) return null;
            var c = t.col + dCol;
            var r = t.row + dRow;
            if (c < 0 || r < 0) return ERR.REF;
            return refText(t.absC, c, t.absR, r);
        });
    }
    /* After renaming a sheet, point Old!A1 / 'Old'!A1 at the new name */
    function renameSheetRefs(formula, oldName, newName) {
        var src = String(formula);
        var hasEq = src.charAt(0) === "=";
        var body = hasEq ? src.slice(1) : src;
        var toks;
        try { toks = tokenize(body); } catch (e) { return src; }
        var out = "", last = 0;
        for (var i = 0; i < toks.length; i++) {
            var t = toks[i];
            if (t.t !== "ref" || !t.prefix || !sameSheetName(t.sheet, oldName)) continue;
            out += body.slice(last, t.pos) + quoteSheetName(newName) + "!";
            last = t.pos + t.prefix.length;
        }
        if (!last) return src;
        out += body.slice(last);
        return (hasEq ? "=" : "") + out;
    }
    /* Optional sheet {target, home} as for rewriteMovedRange: rows/cols are
       inserted on sheet target, the formula lives on sheet home. */
    function adjustInsertDelete(formula, axis, index, count, sheet) {
        return transformRefs(formula, function (t) {
            if (sheet && !refOnSheet(t, sheet.target, sheet.home)) return null;
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
        rewriteMovedRange: rewriteMovedRange,
        adjustInsertDelete: adjustInsertDelete,
        renameSheetRefs: renameSheetRefs,
        quoteSheetName: quoteSheetName,
        dateToSerial: dateToSerial,
        serialToDate: serialToDate
    };
})();

/* Node (CommonJS) export for unit tests; harmless in the browser */
if (typeof module !== "undefined" && module.exports) {
    module.exports = SheetFormula;
}
