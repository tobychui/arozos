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
        evaluate(ast, ctx, [self])               ctx.cell(col,row,sheetName) -> value
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

    References: A1, $A$1, A1:B9, Sheet2!A1, 'Closed Tickets'!$C$3:$C$5000,
    whole columns / rows (A:B, 2:5, A2:A), workbook defined names, array
    literals ({1,2;3,4}) and references built at run time (OFFSET, INDIRECT,
    A1:INDEX(...)), which evaluate to a reference value (F.Ref).
    Ranges inside SUMPRODUCT (and array expressions handed to SUM & co.)
    evaluate as arrays, with operators applied element by element.

    Functions live in formula_fn_*.js, which register into this engine with
    defineFunction(name, spec) and must load after this file (see the
    registry notes above evaluate()). functionNames() lists them.

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
        NA: "#N/A",         // lookup found nothing (VLOOKUP / MATCH / IFS)
        NULL: "#NULL!",
        SPILL: "#SPILL!",   // an array result would overwrite cells
        CALC: "#CALC!"      // Excel: a calculation with no answer (empty FILTER)
    };
    var ERR_LITERALS = ["#DIV/0!", "#NAME?", "#REF!", "#VALUE!", "#CYCLE!", "#NUM!", "#N/A", "#NULL!",
        "#SPILL!", "#CALC!"];

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
    var SHEET_PREFIX_RE = /^([A-Za-z_][A-Za-z0-9_.]*)!(?=\$?[A-Za-z]{1,3}(\$?\d|\s*:)|\$?\d+\s*:)/;
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
            // whole column / row: Data!A:B, Data!2:5 (the unqualified A:B and
            // 2:5 arrive as name / number tokens and are paired in the parser)
            var afterColon = toks.length && toks[toks.length - 1].t === "op" && toks[toks.length - 1].v === ":";
            var colTail = afterColon && toks[toks.length - 2] && toks[toks.length - 2].t === "colref";
            var rowTail = afterColon && toks[toks.length - 2] && toks[toks.length - 2].t === "rowref";
            m = /^(\$?)([A-Za-z]{1,3})(?=\s*:)/.exec(src.slice(i + prefixLen));
            if (!m && colTail) m = /^(\$?)([A-Za-z]{1,3})(?![\w.(!])/.exec(src.slice(i + prefixLen));
            if (m) {
                toks.push({
                    t: "colref", absC: m[1] === "$", col: nameToCol(m[2]),
                    sheet: sheetName === null ? undefined : sheetName,
                    prefix: prefixLen ? src.substr(i, prefixLen) : undefined,
                    pos: i, len: prefixLen + m[0].length
                });
                i += prefixLen + m[0].length;
                continue;
            }
            m = /^(\$?)(\d+)(?=\s*:)/.exec(src.slice(i + prefixLen));
            if (!m && rowTail) m = /^(\$?)(\d+)(?![\w.(!])/.exec(src.slice(i + prefixLen));
            if (m) {
                toks.push({
                    t: "rowref", absR: m[1] === "$", row: parseInt(m[2], 10) - 1,
                    sheet: sheetName === null ? undefined : sheetName,
                    prefix: prefixLen ? src.substr(i, prefixLen) : undefined,
                    pos: i, len: prefixLen + m[0].length
                });
                i += prefixLen + m[0].length;
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
            if ("+-*/^&%=<>(),:{};@".indexOf(ch) >= 0) {
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
        // the token after the current one
        function isOp2(v) {
            var t = toks[p + 1];
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
            if (isOp("@")) {
                // Excel implicit intersection: one cell out of a range
                p++;
                return { t: "at", e: parseUnary() };
            }
            if (isOp("-") || isOp("+")) {
                var op = toks[p++].v;
                return { t: "un", op: op, e: parseUnary() };
            }
            return parsePostfix();
        }
        function parsePostfix() {
            var e = parsePrimary();
            for (;;) {
                // ":" also joins whatever else produces a reference, as in
                // A1:INDEX(B1:B9,3) or MyName:B2
                if (isOp(":")) { p++; e = { t: "rangeop", l: e, r: parsePrimary() }; continue; }
                if (isOp("%")) { p++; e = { t: "pct", e: e }; continue; }
                break;
            }
            return e;
        }
        // a token that can be one end of a whole-column range (A:C) ...
        function colEnd(t) {
            if (!t) return null;
            if (t.t === "colref") return { col: t.col, absC: t.absC, sheet: t.sheet };
            if (t.t === "name" && /^[A-Z]{1,3}$/.test(t.v)) return { col: nameToCol(t.v), absC: false };
            return null;
        }
        // ... or of a whole-row range (2:5)
        function rowEnd(t) {
            if (!t) return null;
            if (t.t === "rowref") return { row: t.row, absR: t.absR, sheet: t.sheet };
            if (t.t === "num" && t.v > 0 && t.v === Math.floor(t.v)) return { row: t.v - 1, absR: false };
            return null;
        }
        /* Whole column/row range: the missing coordinate stays null and the
           evaluator fills it in from the used range of the sheet. */
        function openRange(a, b, rows) {
            var sheet = a.sheet !== undefined ? a.sheet : b.sheet;
            if (rows) {
                return { t: "range", sheet: sheet, open: "rows",
                    a: { col: null, row: a.row, absR: a.absR }, b: { col: null, row: b.row, absR: b.absR } };
            }
            return { t: "range", sheet: sheet, open: "cols",
                a: { col: a.col, row: null, absC: a.absC }, b: { col: b.col, row: null, absC: b.absC } };
        }
        function parsePrimary() {
            var t = peek();
            if (!t) throw new FErr(ERR.VALUE, "Unexpected end of formula");
            if (t.t === "num") {
                if (isOp2(":") && rowEnd(toks[p + 2]) && rowEnd(t)) {
                    // 2:5 - whole rows; plain digits reach us as number tokens
                    var rowA = rowEnd(t);
                    p += 2;
                    var rowB = rowEnd(toks[p]);
                    p++;
                    return openRange(rowA, rowB, true);
                }
                p++;
                return { t: "num", v: t.v };
            }
            if (t.t === "str") { p++; return { t: "str", v: t.v }; }
            if (t.t === "err") { p++; return { t: "errlit", v: t.v }; }
            if (t.t === "op" && t.v === "{") {
                // array literal: {1,2;3,4} is two rows of two
                p++;
                var rows = [], row = [];
                for (;;) {
                    row.push(parseExpr());
                    if (isOp(",")) { p++; continue; }
                    if (isOp(";")) { p++; rows.push(row); row = []; continue; }
                    break;
                }
                rows.push(row);
                expectOp("}");
                var width = rows[0].length;
                for (var ri = 1; ri < rows.length; ri++) {
                    if (rows[ri].length !== width) throw new FErr(ERR.VALUE, "Array rows must be the same length");
                }
                return { t: "arrlit", rows: rows };
            }
            if (t.t === "colref" || t.t === "rowref") {
                p++;
                var isRows = t.t === "rowref";
                if (!isOp(":")) throw new FErr(ERR.VALUE, "Malformed range");
                p++;
                var oe = isRows ? rowEnd(peek()) : colEnd(peek());
                if (!oe) throw new FErr(ERR.VALUE, "Malformed range");
                p++;
                return openRange(isRows ? { row: t.row, absR: t.absR, sheet: t.sheet } :
                    { col: t.col, absC: t.absC, sheet: t.sheet }, oe, isRows);
            }
            if (t.t === "ref") {
                p++;
                if (isOp(":") && (colEnd(toks[p + 1]) || (toks[p + 1] && toks[p + 1].t === "ref"))) {
                    p++;
                    var t2 = peek();
                    if (t2 && t2.t !== "ref" && colEnd(t2)) {
                        // A2:A - open-ended column range (the Sheets spelling)
                        var ce = colEnd(t2);
                        p++;
                        return { t: "range", sheet: t.sheet !== undefined ? t.sheet : ce.sheet, open: "down",
                            a: { col: t.col, row: t.row, absC: t.absC, absR: t.absR },
                            b: { col: ce.col, row: null, absC: ce.absC } };
                    }
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
                if (isOp(":")) {
                    // A:C written without $ arrives as two name tokens
                    var cl = colEnd(t), cr = colEnd(toks[p + 1]);
                    if (cl && cr) {
                        p += 2;
                        return openRange(cl, cr, false);
                    }
                }
                // a workbook defined name (Dept, Tax_Rate): resolved by ctx
                return { t: "name", v: t.v };
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

    /* ---------- date / time text ---------- */
    var MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july",
        "august", "september", "october", "november", "december"];
    // "Mar", "march", "Sept" -> 0-based month, or -1
    function monthIndex(word) {
        var w = String(word).toLowerCase();
        if (w.length < 3) return -1;
        for (var i = 0; i < 12; i++) {
            if (MONTH_NAMES[i].indexOf(w) === 0) return i;
        }
        return -1;
    }
    function ymdSerial(y, m, d) {
        if (m < 0 || m > 11 || d < 1 || d > 31) return null;
        var t = Date.UTC(y, m, d);
        var chk = new Date(t);
        if (chk.getUTCMonth() !== m) return null;       // 31 Feb and friends
        return (t - EPOCH) / DAY_MS;
    }
    // "h:mm", "h:mm:ss", "h:mm:ss.fff", "h AM", "h:mm PM" -> fraction of a day
    function parseTimeText(s) {
        var m = /^(\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}(?:\.\d+)?))?\s*([ap]\.?m\.?)?$/i.exec(s);
        if (!m || (m[2] === undefined && !m[4])) return null;
        var h = parseInt(m[1], 10), mi = m[2] ? parseInt(m[2], 10) : 0, se = m[3] ? parseFloat(m[3]) : 0;
        if (m[4]) {
            if (h < 1 || h > 12) return null;
            var pm = /^p/i.test(m[4]);
            h = h % 12 + (pm ? 12 : 0);
        }
        if (mi > 59 || se >= 60) return null;
        return (h * 3600 + mi * 60 + se) / 86400;
    }
    /*
        parseDateText(s) -> serial (days + fraction) or null
        Dates: 2024-05-01, 2024/5/1, 5/1/2024 (month first), 1-May-2024,
        1 May 2024, May 1, 2024, May 1 2024. Any of them may carry a time
        ("2024-05-01 13:30", "2024-05-01T13:30:00"); a bare time is a
        fraction of a day. Two-digit years are 1930-2029.
    */
    function parseDateText(text) {
        var s = String(text).trim();
        if (!s || s.length > 40) return null;
        var t = parseTimeText(s);
        if (t !== null) return t;
        var datePart = s, timePart = null, m;
        m = /^(.*?\d)(?:[T\s]+)(\d{1,2}:\d{1,2}(?::\d{1,2}(?:\.\d+)?)?(?:\s*[ap]\.?m\.?)?)$/i.exec(s);
        if (m) { datePart = m[1]; timePart = parseTimeText(m[2]); if (timePart === null) return null; }
        var serial = null, y;
        var fixYear = function (yy) {
            var n = parseInt(yy, 10);
            if (yy.length <= 2) n += n < 30 ? 2000 : 1900;
            return n;
        };
        if ((m = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/.exec(datePart))) {
            serial = ymdSerial(+m[1], +m[2] - 1, +m[3]);
        } else if ((m = /^(\d{1,2})[-\/](\d{1,2})[-\/](\d{2}|\d{4})$/.exec(datePart))) {
            serial = ymdSerial(fixYear(m[3]), +m[1] - 1, +m[2]);
        } else if ((m = /^(\d{1,2})[-\s]+([A-Za-z]{3,9})\.?[-\s,]+(\d{2}|\d{4})$/.exec(datePart))) {
            y = monthIndex(m[2]);
            if (y >= 0) serial = ymdSerial(fixYear(m[3]), y, +m[1]);
        } else if ((m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(datePart))) {
            y = monthIndex(m[1]);
            if (y >= 0) serial = ymdSerial(+m[3], y, +m[2]);
        }
        if (serial === null || serial < 0) return null;
        return timePart !== null ? serial + timePart : serial;
    }
    // text that a spreadsheet reads as a number: 12, -3.5e2, 45%, a date or a time
    function coerceNumber(text) {
        var t = String(text).trim();
        if (t === "") return null;
        if (NUM_RE.test(t)) return parseFloat(t);
        if (PCT_RE.test(t)) return parseFloat(t.slice(0, -1)) / 100;
        return parseDateText(t);
    }

    function toNum(v) {
        if (isErr(v)) return v;
        if (v === null || v === undefined) return 0;
        if (typeof v === "number") return v;
        if (typeof v === "boolean") return v ? 1 : 0;
        var n = coerceNumber(v);
        if (n !== null) return n;
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

    /* A reference value: what OFFSET / INDIRECT / INDEX hand back, and what
       the ":" operator joins. sheet is the sheet name as written (undefined
       = the sheet the formula lives on); the box is inclusive and 0-based. */
    function Ref(sheet, c1, r1, c2, r2) {
        this.sheet = sheet;
        this.c1 = Math.min(c1, c2);
        this.r1 = Math.min(r1, r2);
        this.c2 = Math.max(c1, c2);
        this.r2 = Math.max(r1, r2);
    }
    function isRefValue(v) { return v instanceof Ref; }

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
    function pick(A, r, c) {
        var rr = A.rows === 1 ? 0 : r, cc = A.cols === 1 ? 0 : c;
        if (rr >= A.rows || cc >= A.cols) return undefined;
        return A.data[rr * A.cols + cc];
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
            case "^":
                if (a === 0 && b < 0) return new FErr(ERR.DIV0, "Zero to a negative power");
                res = Math.pow(a, b);
                break;
            default: return new FErr(ERR.VALUE, "Bad operator " + op);
        }
        if (typeof res !== "number" || !isFinite(res)) return new FErr(ERR.NUM, "Numeric overflow");
        return res;
    }
    // -1 / 0 / 1 ordering of two values (numbers < text < logicals, text
    // case-insensitive, blank = 0 or "" depending on the other side); errors
    // are returned as-is
    function order(l, r) {
        if (isErr(l)) return l;
        if (isErr(r)) return r;
        // a blank cell compares as "" against text (so =A1="" is TRUE)
        // and as 0 against numbers
        if (l === null && typeof r === "string") l = "";
        if (r === null && typeof l === "string") r = "";
        if (typeof l === "boolean") l = l ? 1 : 0;
        if (typeof r === "boolean") r = r ? 1 : 0;
        var ln = typeof l === "number" || l === null;
        var rn = typeof r === "number" || r === null;
        if (ln && rn) {
            var d = (l === null ? 0 : l) - (r === null ? 0 : r);
            return d < 0 ? -1 : (d > 0 ? 1 : 0);
        }
        if (!ln && !rn) {
            var a = String(l).toLowerCase(), b = String(r).toLowerCase();
            return a < b ? -1 : (a > b ? 1 : 0);
        }
        return ln ? -1 : 1;    // any number sorts before any text (Excel)
    }
    function compare(op, l, r) {
        var d = order(l, r);
        if (isErr(d)) return d;
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

    /* ---------- criteria (COUNTIF, SUMIFS, D* ...) ---------- */
    /*
        criteria(c) -> function (cellValue) -> boolean
        A number or logical matches equal values (numeric text in a cell
        counts as that number). Text may start with = <> < > <= >=; the rest
        is a number, TRUE/FALSE, a date ("2024-05-01") or text. Text matches
        case-insensitively with * ? wildcards (~ escapes them). "" matches
        blank cells, "<>" non-blank ones.
    */
    function wildcardRegex(pattern) {
        var out = "", i = 0;
        while (i < pattern.length) {
            var ch = pattern.charAt(i);
            if (ch === "~" && i + 1 < pattern.length && "*?~".indexOf(pattern.charAt(i + 1)) >= 0) {
                out += "\\" + pattern.charAt(i + 1);
                i += 2;
                continue;
            }
            if (ch === "*") out += "[\\s\\S]*";
            else if (ch === "?") out += "[\\s\\S]";
            else out += ch.replace(/[\\^$.|+()[\]{}\/]/g, "\\$&");
            i++;
        }
        return new RegExp("^" + out + "$", "i");
    }
    function hasWildcards(s) { return /[*?]/.test(s.replace(/~[*?~]/g, "")); }
    function criteria(c) {
        if (isErr(c)) return function (v) { return isErr(v) && v.code === c.code; };
        if (c === null || c === undefined) c = "";
        if (typeof c === "number" || typeof c === "boolean") {
            return function (v) {
                if (typeof c === "boolean") return v === c;
                if (typeof v === "number") return v === c;
                if (typeof v === "string") { var n = coerceNumber(v); return n !== null && n === c; }
                return false;
            };
        }
        var s = String(c), op = "=";
        var m = /^(<=|>=|<>|=|<|>)/.exec(s);
        if (m) { op = m[1]; s = s.slice(op.length); }
        if (s === "") {
            if (op === "=") return function (v) { return v === null || v === ""; };
            if (op === "<>") return function (v) { return !(v === null || v === ""); };
            return function () { return false; };
        }
        var num = coerceNumber(s);
        if (num !== null) {
            return function (v) {
                var x = typeof v === "number" ? v : (typeof v === "string" ? coerceNumber(v) : null);
                if (x === null) return op === "<>";
                return compare(op, x, num) === true;
            };
        }
        var up = s.toUpperCase();
        if (up === "TRUE" || up === "FALSE") {
            var bv = up === "TRUE";
            return function (v) {
                if (typeof v !== "boolean") return op === "<>";
                return compare(op, v, bv) === true;
            };
        }
        if (op === "=" || op === "<>") {
            var re = hasWildcards(s) || /~/.test(s) ? wildcardRegex(s) : null;
            var low = s.toLowerCase();
            return function (v) {
                var hit = typeof v === "string" && (re ? re.test(v) : v.toLowerCase() === low);
                return op === "=" ? hit : !hit;
            };
        }
        return function (v) {
            return typeof v === "string" && compare(op, v, s) === true;
        };
    }

    /* ---------- function registry ---------- */
    /*
        defineFunction(name, spec)
            spec.fn(args, E, arrayCtx)  args are AST nodes; E is the helper
                                        API below; evaluate them as needed
            spec.min / spec.max         argument count (max -1 = any)
            spec.elem                   scalar function: inside an array
                                        context (SUMPRODUCT, SUM(...)) it is
                                        applied element by element
            spec.cat / spec.syntax      metadata for help and docs
        defineAlias("CONCATENATE", "CONCAT")
    */
    var REGISTRY = {};
    function defineFunction(name, spec) {
        spec.name = name;
        if (spec.min === undefined) spec.min = 0;
        if (spec.max === undefined) spec.max = spec.min;
        REGISTRY[name] = spec;
    }
    function defineAlias(alias, target) {
        REGISTRY[alias] = REGISTRY[target];
    }
    // Excel stores newer functions as _xlfn.NAME / _xlfn._xlws.NAME
    function canonicalName(name) {
        return String(name).toUpperCase().replace(/^(_XLFN\.)?(_XLWS\.)?/, "");
    }
    function lookupFunction(name) {
        var n = canonicalName(name);
        return Object.prototype.hasOwnProperty.call(REGISTRY, n) ? REGISTRY[n] : null;
    }
    function functionNames() {
        return Object.keys(REGISTRY).sort();
    }
    /*
        Can this formula produce an array (and so spill)? A cheap structural
        test so the calculator only treats likely spillers as spill anchors:
        ranges, array literals and names can; operators and element-wise
        functions pass it through; functions flagged spec.array produce one
        (spec.array may be a function of the argument nodes); functions
        flagged spec.passthrough (IF, CHOOSE, IFERROR ...) return one of their
        arguments. Everything else (SUM, VLOOKUP ...) answers with one value.
    */
    function maySpill(n) {
        if (!n) return false;
        switch (n.t) {
            case "range": case "rangeop": case "arrlit": case "name": return true;
            case "un": case "pct": return maySpill(n.e);
            case "at": return false;
            case "bin": return maySpill(n.l) || maySpill(n.r);
            case "call": {
                var spec = lookupFunction(n.name);
                if (!spec) return false;
                if (spec.array) return typeof spec.array === "function" ? !!spec.array(n.args) : true;
                if (spec.elem || spec.passthrough) {
                    for (var i = 0; i < n.args.length; i++) if (maySpill(n.args[i])) return true;
                }
                return false;
            }
        }
        return false;
    }

    /*
        Evaluate an AST. ctx.cell(col, row, sheet) returns a cell's value;
        sheet is the name written in the formula, or undefined for the
        formula's own sheet. Optional ctx members: range(c1, r1, c2, r2,
        sheet) -> Arr (cached by the calculator), raw(col, row, sheet) -> the
        cell's source text, rowState(row, sheet) -> 0 visible / 1 hidden by
        the user / 2 hidden by a filter, format(col, row, sheet) -> the
        cell's number format name. self = {col, row} is the cell being
        evaluated (ROW(), COLUMN(), ...), when known.
    */
    function evaluate(ast, ctx, self, wantRef, spillTop) {

        function ev(n) {
            switch (n.t) {
                case "num": return n.v;
                case "str": return n.v;
                case "bool": return n.v;
                case "lit": return arrValue(n.v);
                case "errlit": return new FErr(n.v, "Error value");
                case "empty": return null;
                case "ref": return ctx.cell(n.col, n.row, n.sheet);
                case "range": return new FErr(ERR.VALUE, "A range cannot be used as a single value");
                case "arrlit": return arrValue(arrLit(n));
                case "name": return arrValue(nameValue(n.v));
                case "rangeop": return arrValue(rangeOp(n));
                case "at": return implicit(n.e);
                case "pct": {
                    var pv = toNum(ev(n.e));
                    return isErr(pv) ? pv : pv / 100;
                }
                case "un": return unValue(n.op, ev(n.e));
                case "bin":
                    // comparisons and arithmetic need both sides anyway
                    return binValue(n.op, ev(n.l), ev(n.r));
                case "call": return arrValue(call(n, false));
                default: return new FErr(ERR.VALUE, "Bad expression");
            }
        }
        /* One value out of an array or a reference: a single cell is that
           cell, anything larger has no single value until spilling exists. */
        function arrValue(v) {
            if (isRefValue(v)) {
                if (v.c1 === v.c2 && v.r1 === v.r2) return ctx.cell(v.c1, v.r1, v.sheet);
                return new FErr(ERR.VALUE, "A range cannot be used as a single value");
            }
            if (!isArr(v)) return v;
            if (v.data.length === 1) return v.data[0];
            return new FErr(ERR.VALUE, "An array cannot be used as a single value");
        }
        function arrLit(n) {
            var rows = n.rows.length, cols = n.rows[0].length, data = [];
            for (var r = 0; r < rows; r++) {
                for (var c = 0; c < cols; c++) data.push(ev(n.rows[r][c]));
            }
            return new Arr(rows, cols, data);
        }
        // the cells a reference covers, as an array
        function refArr(ref) {
            if ((ref.c2 - ref.c1 + 1) * (ref.r2 - ref.r1 + 1) > MAX_RANGE_CELLS) {
                return new FErr(ERR.VALUE, "Range too large");
            }
            if (ctx.range) return ctx.range(ref.c1, ref.r1, ref.c2, ref.r2, ref.sheet);
            var data = [];
            for (var r = ref.r1; r <= ref.r2; r++) {
                for (var c = ref.c1; c <= ref.c2; c++) data.push(ctx.cell(c, r, ref.sheet));
            }
            return new Arr(ref.r2 - ref.r1 + 1, ref.c2 - ref.c1 + 1, data);
        }
        /* The reference an argument points at, or null when it is not one.
           Used by OFFSET, CELL, ROW, ISREF and by the range operator. */
        function nodeRef(n) {
            if (!n) return null;
            switch (n.t) {
                case "ref": return new Ref(n.sheet, n.col, n.row, n.col, n.row);
                case "range": {
                    var b = rangeBox(n);
                    return new Ref(n.sheet, b.c1, b.r1, b.c2, b.r2);
                }
                case "name": {
                    var nv = nameValue(n.v);
                    return isRefValue(nv) ? nv : null;
                }
                case "rangeop": {
                    var rv = rangeOp(n);
                    return isRefValue(rv) ? rv : null;
                }
                case "lit": return isRefValue(n.v) ? n.v : null;
                case "call": {
                    var cv = call(n, false);
                    return isRefValue(cv) ? cv : null;
                }
            }
            return null;
        }
        // A1:INDEX(...) and friends: the box around both references
        function rangeOp(n) {
            var l = nodeRef(n.l), r = nodeRef(n.r);
            if (!l || !r) return new FErr(ERR.REF, "Both sides of a range must be references");
            if (l.sheet !== undefined && r.sheet !== undefined && !sameSheetName(l.sheet, r.sheet)) {
                return new FErr(ERR.REF, "A range cannot span two sheets");
            }
            return new Ref(l.sheet !== undefined ? l.sheet : r.sheet,
                Math.min(l.c1, r.c1), Math.min(l.r1, r.r1), Math.max(l.c2, r.c2), Math.max(l.r2, r.r2));
        }
        /* Implicit intersection (@A1:A9, _xlfn.SINGLE): the cell of a range in
           the same row (for a column) or column (for a row) as the formula;
           an array gives its top-left value. */
        function implicit(node) {
            var r = nodeRef(node);
            if (!r) {
                var v = evA(node);
                if (isArr(v)) return v.data.length ? v.data[0] : null;
                return v;
            }
            if (r.c1 === r.c2 && r.r1 === r.r2) return ctx.cell(r.c1, r.r1, r.sheet);
            if (self && r.c1 === r.c2 && self.row >= r.r1 && self.row <= r.r2) return ctx.cell(r.c1, self.row, r.sheet);
            if (self && r.r1 === r.r2 && self.col >= r.c1 && self.col <= r.c2) return ctx.cell(self.col, r.r1, r.sheet);
            return new FErr(ERR.VALUE, "The range does not share a row or column with this cell");
        }
        /* A workbook defined name. ctx.name(name) hands back the reference or
           value it stands for; unknown names are #NAME?. */
        function nameValue(name) {
            if (!ctx.name) return new FErr(ERR.NAME, "Unknown name " + name);
            var v = ctx.name(name);
            return v === undefined ? new FErr(ERR.NAME, "Unknown name " + name) : v;
        }

        /* Array-context evaluation: ranges become Arr values and operators
           apply element by element (Excel's array semantics), so
           ('Data'!A2:A99="x")*('Data'!B2:B99) is an array of numbers. */
        function evA(n) {
            switch (n.t) {
                case "range": return rangeArr(n);
                case "lit": return isRefValue(n.v) ? refArr(n.v) : n.v;
                case "arrlit": return arrLit(n);
                case "at": return implicit(n.e);
                case "name": {
                    var nv = nameValue(n.v);
                    return isRefValue(nv) ? refArr(nv) : nv;
                }
                case "rangeop": {
                    var rv = rangeOp(n);
                    return isRefValue(rv) ? refArr(rv) : rv;
                }
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
                case "call": {
                    var cv = call(n, true);
                    return isRefValue(cv) ? refArr(cv) : cv;
                }
                default: return ev(n);
            }
        }

        /* A range node as a box. Whole-column (A:B), whole-row (2:5) and
           open-ended (A2:A) ranges leave one coordinate null; the used range
           of the sheet fills it in, so they stay as cheap as the data. */
        function rangeBox(node) {
            var a = node.a, b = node.b;
            if (!node.open) {
                return {
                    c1: Math.min(a.col, b.col), c2: Math.max(a.col, b.col),
                    r1: Math.min(a.row, b.row), r2: Math.max(a.row, b.row)
                };
            }
            var bounds = ctx.bounds ? ctx.bounds(node.sheet) : null;
            var rows = bounds && bounds.rows > 0 ? bounds.rows : 1;
            var cols = bounds && bounds.cols > 0 ? bounds.cols : 1;
            if (node.open === "rows") {
                return { c1: 0, c2: cols - 1, r1: Math.min(a.row, b.row), r2: Math.max(a.row, b.row) };
            }
            if (node.open === "cols") {
                return { c1: Math.min(a.col, b.col), c2: Math.max(a.col, b.col), r1: 0, r2: rows - 1 };
            }
            // "down": A2:A runs to the end of the used range
            return {
                c1: Math.min(a.col, b.col), c2: Math.max(a.col, b.col),
                r1: a.row, r2: Math.max(a.row, rows - 1)
            };
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

        var E = makeHelpers();

        function call(n, arrayCtx) {
            var spec = lookupFunction(n.name);
            if (!spec) return new FErr(ERR.NAME, "Unknown function " + canonicalName(n.name));
            var args = n.args;
            if (args.length < spec.min || (spec.max >= 0 && args.length > spec.max)) {
                return new FErr(ERR.NA, "Wrong number of arguments to " + spec.name + ": expected " +
                    (spec.max === spec.min ? spec.min : spec.min + (spec.max < 0 ? " or more" : " to " + spec.max)) +
                    ", got " + args.length);
            }
            if (arrayCtx && spec.elem) return callElementwise(spec, args);
            return spec.fn(args, E, arrayCtx);
        }
        // a scalar function inside an array context: evaluate its arguments
        // as arrays and apply it to each broadcast element
        function callElementwise(spec, args) {
            var vals = new Array(args.length), anyArr = false, i;
            for (i = 0; i < args.length; i++) {
                vals[i] = args[i].t === "empty" ? null : evA(args[i]);
                if (isArr(vals[i])) anyArr = true;
            }
            var lits = function (vs) {
                return vs.map(function (v, k) {
                    return args[k].t === "empty" ? args[k] : { t: "lit", v: v };
                });
            };
            if (!anyArr) return spec.fn(lits(vals), E, true);
            var rows = 1, cols = 1;
            vals.forEach(function (v) {
                if (isArr(v)) { rows = Math.max(rows, v.rows); cols = Math.max(cols, v.cols); }
            });
            var out = new Array(rows * cols);
            for (var r = 0; r < rows; r++) {
                for (var c = 0; c < cols; c++) {
                    var cur = new Array(vals.length), bad = false;
                    for (i = 0; i < vals.length; i++) {
                        if (!isArr(vals[i])) { cur[i] = vals[i]; continue; }
                        var pv = pick(vals[i], r, c);
                        if (pv === undefined) { bad = true; break; }
                        cur[i] = pv;
                    }
                    out[r * cols + c] = bad ? new FErr(ERR.NA, "Array sizes do not match") :
                        arrValue(spec.fn(lits(cur), E, false));
                }
            }
            return new Arr(rows, cols, out);
        }

        /* ---------- helper API handed to every function ---------- */
        function makeHelpers() {
            var H = {
                ctx: ctx,
                self: self || null,
                ev: ev,
                evA: evA,
                box: rangeBox,
                // missing / omitted argument
                missing: function (node) { return !node || node.t === "empty"; },
                // node points straight at cells (A1 or A1:B9)
                isRef: function (node) { return !!node && (node.t === "ref" || node.t === "range"); },
                val: function (node, def) {
                    if (H.missing(node)) return def !== undefined ? def : null;
                    return ev(node);
                },
                num: function (node, def) {
                    if (!node) return def !== undefined ? def : new FErr(ERR.VALUE, "Missing argument");
                    if (node.t === "empty") return def !== undefined ? def : 0;
                    return toNum(ev(node));
                },
                int: function (node, def) {
                    var v = H.num(node, def);
                    return isErr(v) ? v : Math.trunc(v);
                },
                str: function (node, def) {
                    if (H.missing(node)) return def !== undefined ? def : "";
                    return toStr(ev(node));
                },
                bool: function (node, def) {
                    if (H.missing(node)) return def !== undefined ? def : false;
                    return boolify(ev(node));
                },
                // any argument as an Arr: ranges, array results, or a 1x1
                // wrapper around a scalar
                arr: function (node) {
                    if (H.missing(node)) return new Arr(1, 1, [null]);
                    var v = node.t === "ref" ? ctx.cell(node.col, node.row, node.sheet) : evA(node);
                    if (isErr(v) && (node.t === "range" || node.t === "name" || node.t === "rangeop")) return v;
                    if (isRefValue(v)) return refArr(v);
                    return isArr(v) ? v : new Arr(1, 1, [v]);
                },
                // the reference an argument points at (OFFSET, CELL, ISREF ...)
                ref: function (node) { return nodeRef(node); },
                implicit: implicit,
                refArr: refArr,
                makeRef: function (sheet, c1, r1, c2, r2) { return new Ref(sheet, c1, r1, c2, r2); },
                isRefValue: isRefValue,
                bounds: function (sheet) {
                    return ctx.bounds ? ctx.bounds(sheet) : { rows: 1, cols: 1 };
                },
                sheets: function () { return ctx.sheets ? ctx.sheets() : null; },
                /* Result hints: the number format a date or percent function
                   would like the cell to use (only when the cell has none of
                   its own), and the URL HYPERLINK points at. */
                hint: function (fmt) { if (self) self.fmt = fmt; },
                link: function (url) { if (self) self.link = url; },
                // the value of every cell / element an argument covers
                flat: function (node) {
                    var a = H.arr(node);
                    return isErr(a) ? a : a.data;
                },
                cell: function (c, r, sheet) { return ctx.cell(c, r, sheet); },
                raw: function (c, r, sheet) { return ctx.raw ? ctx.raw(c, r, sheet) : undefined; },
                rowState: function (r, sheet) { return ctx.rowState ? ctx.rowState(r, sheet) : 0; },
                format: function (c, r, sheet) { return ctx.format ? ctx.format(c, r, sheet) : undefined; },
                /*
                    numbers(args, mode) -> {nums, count, counta, err}
                    "sum"  (SUM, AVERAGE, MIN ...): cells contribute numbers
                           only; arguments typed in directly also accept
                           logicals and numeric text, other text is #VALUE!
                    "count": like sum, but typed-in text is simply skipped
                    "a"    (AVERAGEA, MAXA ...): cells count text as 0 and
                           logicals as 1/0
                */
                numbers: function (args, mode) {
                    var st = { nums: [], count: 0, counta: 0, err: null };
                    for (var i = 0; i < args.length; i++) {
                        var a = args[i];
                        if (a.t === "empty") continue;
                        var fromCells = a.t === "ref" || a.t === "range";
                        var v = fromCells || a.t === "name" || a.t === "rangeop" ? H.arr(a) :
                            ((a.t === "bin" || a.t === "un" || a.t === "call" || a.t === "lit" ||
                                a.t === "arrlit") ? evA(a) : ev(a));
                        if (isErr(v)) { st.err = v; return st; }
                        if (isArr(v)) {
                            for (var k = 0; k < v.data.length; k++) {
                                var x = v.data[k];
                                if (isErr(x)) { st.err = x; return st; }
                                if (x === null || x === undefined) continue;
                                st.counta++;
                                if (typeof x === "number") { st.nums.push(x); st.count++; }
                                else if (mode === "a") {
                                    st.nums.push(typeof x === "boolean" ? (x ? 1 : 0) : 0);
                                    st.count++;
                                }
                            }
                            continue;
                        }
                        if (v === null || v === undefined) continue;
                        st.counta++;
                        if (typeof v === "number") { st.nums.push(v); st.count++; }
                        else if (typeof v === "boolean") { st.nums.push(v ? 1 : 0); st.count++; }
                        else {
                            var n = coerceNumber(String(v));
                            if (n !== null) { st.nums.push(n); st.count++; }
                            else if (mode === "sum") {
                                st.err = new FErr(ERR.VALUE, "'" + v + "' is not a number");
                                return st;
                            } else if (mode === "a") { st.nums.push(0); st.count++; }
                        }
                    }
                    return st;
                },
                criteria: criteria
            };
            return H;
        }

        // a defined name that stands for cells resolves to the reference
        if (wantRef) {
            var asRef = nodeRef(ast);
            if (asRef) return asRef;
        }
        // a spill anchor keeps its whole array; the calculator lays it out
        if (spillTop) {
            var top = evA(ast);
            if (isRefValue(top)) top = refArr(top);
            return top;
        }
        return arrValue(ev(ast));
    }

    /* ---------- memoized calculator with cycle detection ---------- */
    /*
        createCalculator(getRaw, [opts])
            getRaw(col, row, sheetIdx) -> the raw text of a cell
            opts.sheetIndex(name) -> index of the sheet called name, or -1
            opts.activeSheet()    -> index unqualified lookups default to (0)
            opts.rowState(sheetIdx, row) -> 0 visible, 1 hidden by the user,
                                    2 hidden by a filter (SUBTOTAL)
            opts.cellFormat(sheetIdx, col, row) -> number format name (ISDATE)
            opts.bounds(sheetIdx) -> {rows, cols} used range (A:A, 2:5)
            opts.definedName(name) -> {formula, sheet} for a workbook name
            opts.sheetName(sheetIdx) / opts.sheetCount() (SHEET, SHEETS)
            opts.formulaCells(sheetIdx) -> [{col, row}] of every formula cell,
                                    so empty cells can find the spill that
                                    covers them

        Spilling: a formula that may produce an array (see maySpill) is an
        anchor. When its result is larger than one cell, the values fill the
        cells to the right and below; they must all be empty in the model and
        not claimed by another spill, otherwise the anchor is #SPILL!.
        spillAt(col, row, sheet) describes the spill a cell belongs to.
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
        var nameCache = {};
        var hints = {};
        var spillAst = {};          // formula text -> maySpill verdict
        var spills = {};            // sheet -> spill state, see spillState()
        var MAX_SPILL_CELLS = 200000;

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
                    },
                    raw: function (c, r, name) {
                        var si = resolve(s, name);
                        return si < 0 ? undefined : getRaw(c, r, si);
                    },
                    rowState: function (r, name) {
                        var si = resolve(s, name);
                        return si < 0 || !opts.rowState ? 0 : opts.rowState(si, r);
                    },
                    format: function (c, r, name) {
                        var si = resolve(s, name);
                        return si < 0 || !opts.cellFormat ? undefined : opts.cellFormat(si, c, r);
                    },
                    bounds: function (name) {
                        var si = resolve(s, name);
                        if (si < 0 || !opts.bounds) return { rows: 1, cols: 1 };
                        return opts.bounds(si);
                    },
                    name: function (n) { return namedValue(n, s); },
                    sheets: function () {
                        return {
                            count: opts.sheetCount ? opts.sheetCount() : 1,
                            current: s,
                            nameOf: function (i) { return opts.sheetName ? opts.sheetName(i) : ""; },
                            indexOf: function (n) { return opts.sheetIndex ? opts.sheetIndex(n) : -1; }
                        };
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

        /* A workbook defined name: its formula is evaluated once per recalc,
           in the scope of the sheet that defines it (a sheet-local name) or
           of the sheet using it (a global name), and usually yields a
           reference rather than a value. */
        function namedValue(name, homeSheet) {
            if (!opts.definedName) return undefined;
            var def = opts.definedName(name);
            if (!def || !def.formula) return undefined;
            var scope = def.sheet === undefined || def.sheet === null || def.sheet < 0 ? homeSheet : def.sheet;
            var key = String(name).toUpperCase() + "@" + scope;
            if (Object.prototype.hasOwnProperty.call(nameCache, key)) return nameCache[key];
            nameCache[key] = new FErr(ERR.CYCLE, "Circular reference through the name " + name);
            var v;
            try {
                var body = String(def.formula);
                if (body.charAt(0) === "=") body = body.slice(1);
                v = evaluate(parse(body), ctxFor(scope), null, true);
            } catch (e) {
                v = isErr(e) ? e : new FErr(ERR.NAME, "The name " + name + " is not usable");
            }
            nameCache[key] = v;
            return v;
        }

        /* Per-sheet spill bookkeeping: the candidate anchors (formulas that
           may spill), the cells each finished spill covers, and whether every
           candidate has been evaluated yet. */
        function spillState(s) {
            if (spills[s]) return spills[s];
            var st = { candidates: [], cover: {}, anchors: {}, built: false, building: false };
            spills[s] = st;
            if (opts.formulaCells) {
                opts.formulaCells(s).forEach(function (fc) {
                    var raw = getRaw(fc.col, fc.row, s);
                    if (raw === undefined || raw === null) return;
                    raw = String(raw);
                    if (raw.charAt(0) !== "=") return;
                    if (spillable(raw.slice(1))) st.candidates.push({ c: fc.col, r: fc.row });
                });
                st.candidates.sort(function (a, b) { return a.r - b.r || a.c - b.c; });
            }
            return st;
        }
        function spillable(body) {
            if (Object.prototype.hasOwnProperty.call(spillAst, body)) return spillAst[body];
            var ok = false;
            /* Only ranges (":"), array literals, "@", array functions and
               defined names create arrays, so formulas without any of them
               (B3-C3, INT(C3), IF(A1>0,1,2)) never need the parser here. */
            if (/[:{@]/.test(body) || arrayCallRe().test(body) || usesDefinedName(body)) {
                try {
                    var ast = Object.prototype.hasOwnProperty.call(astCache, body) ? astCache[body] : parse(body);
                    astCache[body] = ast;
                    ok = maySpill(ast);
                } catch (e) { ok = false; }
            }
            spillAst[body] = ok;
            return ok;
        }
        var arrayCallCache = null;
        function arrayCallRe() {
            if (!arrayCallCache) {
                var names = Object.keys(REGISTRY).filter(function (n) { return REGISTRY[n].array; });
                arrayCallCache = names.length ? new RegExp("(^|[^A-Za-z0-9_.])(" + names.map(function (n) {
                    return n.replace(/\./g, "\\.");
                }).join("|") + ")\\s*\\(", "i") : /$^/;
            }
            return arrayCallCache;
        }
        function usesDefinedName(body) {
            if (!opts.definedName) return false;
            var ids = body.replace(/"([^"]|"")*"/g, "").replace(/'([^']|'')*'!/g, "").match(/[A-Za-z_][A-Za-z0-9_.]*/g) || [];
            for (var i = 0; i < ids.length; i++) {
                if (/^[A-Za-z]{1,3}[0-9]+$/.test(ids[i])) continue;
                if (opts.definedName(ids[i])) return true;
            }
            return false;
        }
        // the spill covering an empty cell, evaluating anchors as needed
        function spillCover(col, row, s) {
            var st = spillState(s);
            var key = col + "," + row;
            if (st.cover[key]) return st.cover[key];
            if (st.built) return null;
            if (!st.building) {
                st.building = true;
                for (var i = 0; i < st.candidates.length; i++) {
                    var cd = st.candidates[i];
                    if (!inStack[s + "!" + cd.c + "," + cd.r]) cellValue(cd.c, cd.r, s);
                }
                st.building = false;
                st.built = true;
                return st.cover[key] || null;
            }
            // asked while the sheet is still being laid out: evaluate the
            // anchors that could reach this cell first
            for (var j = 0; j < st.candidates.length; j++) {
                var c2 = st.candidates[j];
                if (c2.r > row) break;
                if (c2.c > col || inStack[s + "!" + c2.c + "," + c2.r]) continue;
                cellValue(c2.c, c2.r, s);
                if (st.cover[key]) return st.cover[key];
            }
            return null;
        }
        // place an anchor result; returns the anchor value or #SPILL!
        function layOut(col, row, s, arr) {
            var rows = arr.rows, cols = arr.cols;
            if (rows * cols > MAX_SPILL_CELLS) {
                return new FErr(ERR.SPILL, "The array result is too large to spill (" + rows + " x " + cols + ")");
            }
            var st = spillState(s);
            for (var r = 0; r < rows; r++) {
                for (var c = 0; c < cols; c++) {
                    if (r === 0 && c === 0) continue;
                    var raw = getRaw(col + c, row + r, s);
                    var taken = st.cover[(col + c) + "," + (row + r)];
                    if ((raw !== undefined && raw !== null && raw !== "") || taken) {
                        return new FErr(ERR.SPILL, "The array result would overwrite " + cellName(col + c, row + r));
                    }
                }
            }
            var entry = { c: col, r: row, rows: rows, cols: cols, data: arr.data };
            st.anchors[col + "," + row] = entry;
            for (r = 0; r < rows; r++) {
                for (c = 0; c < cols; c++) {
                    if (r === 0 && c === 0) continue;
                    st.cover[(col + c) + "," + (row + r)] = entry;
                }
            }
            return arr.data[0] === undefined ? null : arr.data[0];
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
                // an empty cell may hold part of a spilled array
                var cov = spillCover(col, row, s);
                if (cov) {
                    var sv = cov.data[(row - cov.r) * cov.cols + (col - cov.c)];
                    v = sv === undefined ? null : sv;
                } else if (Object.prototype.hasOwnProperty.call(memo, k)) {
                    return memo[k];         // evaluated while laying out spills
                } else {
                    v = null;
                }
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
                        var hint = { col: col, row: row, fmt: null, link: null };
                        var anchor = spillable(body);
                        v = evaluate(ast, ctxFor(s), hint, false, anchor);
                        if (isArr(v)) {
                            v = v.rows * v.cols === 1 ? v.data[0] : layOut(col, row, s, v);
                            if (v === undefined) v = null;
                        }
                        if (hint.fmt || hint.link) hints[k] = { fmt: hint.fmt, link: hint.link };
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
                range: function (c1, r1, c2, r2, name) { return ctxFor(active()).range(c1, r1, c2, r2, name); },
                raw: function (c, r, name) { return ctxFor(active()).raw(c, r, name); },
                rowState: function (r, name) { return ctxFor(active()).rowState(r, name); },
                format: function (c, r, name) { return ctxFor(active()).format(c, r, name); },
                bounds: function (name) { return ctxFor(active()).bounds(name); },
                name: function (n) { return ctxFor(active()).name(n); },
                sheets: function () { return ctxFor(active()).sheets(); }
            },
            /* What a formula asked its cell to look like: a number format
               (TODAY, EDATE, TO_PERCENT ...) that applies when the cell has
               none of its own, and the URL of a HYPERLINK result. */
            hintAt: function (col, row, s) {
                if (s === undefined || s === null) s = active();
                var own = hints[s + "!" + col + "," + row];
                if (own) return own;
                // a spilled cell wears the hint of its anchor
                var cov = spills[s] && spills[s].cover[col + "," + row];
                return cov ? hints[s + "!" + cov.c + "," + cov.r] || null : null;
            },
            /* The spill a cell belongs to, as {c1, r1, c2, r2, anchor: {c, r}}
               (for the anchor itself too), or null. Evaluates what it must. */
            spillAt: function (col, row, s) {
                if (s === undefined || s === null) s = active();
                cellValue(col, row, s);
                var st = spillState(s);
                var e = st.anchors[col + "," + row] || st.cover[col + "," + row];
                if (!e) return null;
                return { c1: e.c, r1: e.r, c2: e.c + e.cols - 1, r2: e.r + e.rows - 1, anchor: { c: e.c, r: e.r } };
            },
            /* Every spill on a sheet, as [{c1, r1, c2, r2}], after evaluating
               all of its spill anchors (the grid grows to fit them). */
            spillList: function (s) {
                if (s === undefined || s === null) s = active();
                spillCover(-1, -1, s);
                var st = spillState(s), out = [];
                Object.keys(st.anchors).forEach(function (key) {
                    var e = st.anchors[key];
                    out.push({ c1: e.c, r1: e.r, c2: e.c + e.cols - 1, r2: e.r + e.rows - 1 });
                });
                return out;
            },
            reset: function () {
                memo = {}; ranges = {}; inStack = {}; nameCache = {}; hints = {}; spills = {};
            }
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
        serialToDate: serialToDate,
        // for the function modules (formula_fn_*.js)
        defineFunction: defineFunction,
        defineAlias: defineAlias,
        lookupFunction: lookupFunction,
        maySpill: maySpill,
        functionNames: functionNames,
        canonicalName: canonicalName,
        Arr: Arr,
        isArr: isArr,
        toNum: toNum,
        toStr: toStr,
        boolify: boolify,
        compare: compare,
        order: order,
        binValue: binValue,
        criteria: criteria,
        Ref: Ref,
        isRefValue: isRefValue,
        wildcardRegex: wildcardRegex,
        coerceNumber: coerceNumber,
        parseDateText: parseDateText,
        EPOCH: EPOCH,
        DAY_MS: DAY_MS
    };
})();

/* Node (CommonJS) export for unit tests; harmless in the browser */
if (typeof module !== "undefined" && module.exports) {
    module.exports = SheetFormula;
}
