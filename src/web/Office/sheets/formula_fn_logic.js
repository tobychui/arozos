/*
    ArozOS Office Sheets - logical, info and operator functions
    ===========================================================
    Registers into the formula engine (formula.js); load after it.

        logical   IF IFS IFERROR IFNA AND OR NOT XOR SWITCH TRUE FALSE CHOOSE
        info      ISBLANK ISNUMBER ISTEXT ISNONTEXT ISLOGICAL ISERROR ISERR
                  ISNA NA N TYPE ERROR.TYPE ISFORMULA ISDATE ISEMAIL ISURL
        operator  ADD MINUS MULTIPLY DIVIDE POW EQ NE GT GTE LT LTE UMINUS
                  UPLUS UNARY_PERCENT ISBETWEEN
*/
(function (F) {
    "use strict";
    var ERR = F.ERR, FErr = F.FErr, isErr = F.isErr, isArr = F.isArr;

    function def(name, min, max, fn, extra) {
        var spec = { min: min, max: max, fn: fn };
        for (var k in extra || {}) spec[k] = extra[k];
        F.defineFunction(name, spec);
    }

    /* ---------- logical ---------- */
    def("IF", 2, 3, function (a, E, arrayCtx) {
        if (arrayCtx) {
            // IF over an array condition picks element by element
            var ac = E.evA(a[0]);
            if (isArr(ac)) {
                var at = E.evA(a[1]);
                var af = a.length > 2 ? E.evA(a[2]) : null;
                var rows = Math.max(ac.rows, isArr(at) ? at.rows : 1, isArr(af) ? af.rows : 1);
                var cols = Math.max(ac.cols, isArr(at) ? at.cols : 1, isArr(af) ? af.cols : 1);
                var out = new Array(rows * cols);
                var pickv = function (v, r, c) {
                    if (!isArr(v)) return v;
                    var rr = v.rows === 1 ? 0 : r, cc = v.cols === 1 ? 0 : c;
                    if (rr >= v.rows || cc >= v.cols) return new FErr(ERR.NA, "Array sizes do not match");
                    return v.data[rr * v.cols + cc];
                };
                for (var r = 0; r < rows; r++) {
                    for (var c = 0; c < cols; c++) {
                        var cb = F.boolify(pickv(ac, r, c));
                        out[r * cols + c] = isErr(cb) ? cb : (cb ? pickv(at, r, c) : pickv(af, r, c));
                    }
                }
                return new F.Arr(rows, cols, out);
            }
            var acb = F.boolify(ac);
            if (isErr(acb)) return acb;
            if (acb) return E.evA(a[1]);
            return a.length > 2 ? E.evA(a[2]) : null;
        }
        var cond = E.bool(a[0]);
        if (isErr(cond)) return cond;
        // only the taken branch is evaluated, so IF(A1=0,"",1/A1) never
        // divides by zero; value_if_false is optional and blank by default
        // (the Sheets rule - Excel would answer FALSE)
        if (cond) return E.val(a[1]);
        return a.length > 2 ? E.val(a[2]) : null;
    }, { cat: "Logical", passthrough: true, syntax: "IF(logical_expression, value_if_true, [value_if_false])" });

    function tryValue(E, node, arrayCtx) {
        try { return arrayCtx ? E.evA(node) : E.val(node); }
        catch (e) { return isErr(e) ? e : new FErr(ERR.VALUE, "Formula error"); }
    }
    /* IFERROR / IFNA. Over an array the fallback replaces only the elements
       that are errors (IFERROR(1/A1:A3, 0)); a whole-array error (FILTER that
       found nothing) is replaced by the fallback as a whole. */
    function catcher(name, caught) {
        def(name, 1, 2, function (a, E, arrayCtx) {
            var v = tryValue(E, a[0], arrayCtx);
            var fallback = function () {
                if (a.length < 2) return null;
                return arrayCtx ? E.evA(a[1]) : E.val(a[1]);
            };
            if (arrayCtx && isArr(v)) {
                var fb, fbDone = false, out = new Array(v.data.length);
                for (var i = 0; i < v.data.length; i++) {
                    if (!caught(v.data[i])) { out[i] = v.data[i]; continue; }
                    if (!fbDone) { fb = fallback(); fbDone = true; }
                    if (isArr(fb)) {
                        var r = Math.floor(i / v.cols), c = i % v.cols;
                        var rr = fb.rows === 1 ? 0 : r, cc = fb.cols === 1 ? 0 : c;
                        out[i] = rr < fb.rows && cc < fb.cols ? fb.data[rr * fb.cols + cc] : new FErr(ERR.NA, "Array sizes do not match");
                    } else out[i] = fb;
                }
                return new F.Arr(v.rows, v.cols, out);
            }
            return caught(v) ? fallback() : v;
        }, { cat: "Logical", passthrough: true, syntax: name + "(value, [value_if_error])" });
    }
    catcher("IFERROR", function (v) { return isErr(v); });
    catcher("IFNA", function (v) { return isErr(v) && v.code === ERR.NA; });

    def("IFS", 2, -1, function (a, E, arrayCtx) {
        if (a.length % 2 !== 0) return new FErr(ERR.VALUE, "IFS expects condition/value pairs");
        for (var i = 0; i < a.length; i += 2) {
            var c = E.bool(a[i]);
            if (isErr(c)) return c;
            if (c) return arrayCtx ? E.evA(a[i + 1]) : E.val(a[i + 1]);
        }
        return new FErr(ERR.NA, "No IFS condition was true");
    }, { cat: "Logical", passthrough: true, syntax: "IFS(condition1, value1, [condition2, value2, ...])" });

    /* AND / OR / XOR: blanks are skipped, and so is text that comes from a
       referenced cell or range (Excel's rule); only text typed straight into
       the call is an error. */
    function logicals(a, E, name) {
        var out = [];
        for (var i = 0; i < a.length; i++) {
            var node = a[i];
            if (E.missing(node)) continue;
            var fromRef = E.isRef(node);
            var vals;
            if (fromRef || node.t === "lit") {
                vals = E.flat(node);
                if (isErr(vals)) return vals;
            } else {
                var v = node.t === "call" || node.t === "bin" ? E.evA(node) : E.ev(node);
                vals = isArr(v) ? v.data : [v];
            }
            for (var k = 0; k < vals.length; k++) {
                var x = vals[k];
                if (isErr(x)) return x;
                if (x === null || x === undefined) continue;
                if (typeof x === "string" && (fromRef || vals.length > 1)) continue;
                var b = F.boolify(x);
                if (isErr(b)) return b;
                out.push(b);
            }
        }
        if (!out.length) return new FErr(ERR.VALUE, name + " found no logical values");
        return out;
    }
    def("AND", 1, -1, function (a, E) {
        var l = logicals(a, E, "AND");
        if (isErr(l)) return l;
        return l.every(function (x) { return x; });
    }, { cat: "Logical", syntax: "AND(logical_expression1, [logical_expression2, ...])" });
    def("OR", 1, -1, function (a, E) {
        var l = logicals(a, E, "OR");
        if (isErr(l)) return l;
        return l.some(function (x) { return x; });
    }, { cat: "Logical", syntax: "OR(logical_expression1, [logical_expression2, ...])" });
    def("XOR", 1, -1, function (a, E) {
        var l = logicals(a, E, "XOR");
        if (isErr(l)) return l;
        return l.filter(function (x) { return x; }).length % 2 === 1;
    }, { cat: "Logical", syntax: "XOR(logical_expression1, [logical_expression2, ...])" });
    def("NOT", 1, 1, function (a, E) {
        var v = E.bool(a[0]);
        return isErr(v) ? v : !v;
    }, { cat: "Logical", elem: true, syntax: "NOT(logical_expression)" });
    def("TRUE", 0, 0, function () { return true; }, { cat: "Logical", syntax: "TRUE()" });
    def("FALSE", 0, 0, function () { return false; }, { cat: "Logical", syntax: "FALSE()" });

    def("SWITCH", 3, -1, function (a, E, arrayCtx) {
        var expr = E.val(a[0]);
        if (isErr(expr)) return expr;
        var pick = function (n) { return arrayCtx ? E.evA(n) : E.val(n); };
        var i = 1;
        for (; i + 1 < a.length; i += 2) {
            var c = E.val(a[i]);
            if (isErr(c)) return c;
            if (F.compare("=", expr, c) === true) return pick(a[i + 1]);
        }
        if (i < a.length) return pick(a[i]);         // default
        return new FErr(ERR.NA, "SWITCH found no match");
    }, { cat: "Logical", passthrough: true, syntax: "SWITCH(expression, case1, value1, [default or case2, value2], ...)" });

    def("CHOOSE", 2, -1, function (a, E, arrayCtx) {
        // only the chosen value is evaluated
        var v = E.int(a[0]);
        if (isErr(v)) return v;
        if (v < 1 || v >= a.length) return new FErr(ERR.VALUE, "CHOOSE index " + v + " is out of range");
        return arrayCtx ? E.evA(a[v]) : E.val(a[v]);
    }, { cat: "Lookup", passthrough: true, syntax: "CHOOSE(index, choice1, [choice2, ...])" });

    /* ---------- info ---------- */
    // the value an IS* function looks at (a range gives its first cell)
    function probe(E, node) {
        if (node.t === "range") {
            var f = E.flat(node);
            return isErr(f) ? f : f[0];
        }
        return E.val(node);
    }
    function is(name, test, syntax) {
        def(name, 1, 1, function (a, E) { return test(probe(E, a[0]), a[0], E); },
            { cat: "Info", elem: true, syntax: syntax || name + "(value)" });
    }
    is("ISBLANK", function (v) { return v === null || v === undefined; });
    is("ISNUMBER", function (v) { return typeof v === "number"; });
    is("ISTEXT", function (v) { return typeof v === "string"; });
    is("ISNONTEXT", function (v) { return typeof v !== "string"; });
    is("ISLOGICAL", function (v) { return typeof v === "boolean"; });
    is("ISERROR", function (v) { return isErr(v); });
    is("ISERR", function (v) { return isErr(v) && v.code !== ERR.NA; });
    is("ISNA", function (v) { return isErr(v) && v.code === ERR.NA; });
    is("ISEMAIL", function (v) {
        return typeof v === "string" && /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(v.trim());
    });
    is("ISURL", function (v) {
        return typeof v === "string" &&
            /^((https?|ftp):\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(v.trim());
    });
    // a date is a number shown with a date format, so only a cell can be one
    is("ISDATE", function (v, node, E) {
        if (typeof v !== "number" || !E.isRef(node)) return false;
        var fmt = E.format(node.t === "ref" ? node.col : Math.min(node.a.col, node.b.col),
            node.t === "ref" ? node.row : Math.min(node.a.row, node.b.row), node.sheet);
        return fmt === "date";
    });
    def("ISFORMULA", 1, 1, function (a, E) {
        var n = a[0];
        if (!E.isRef(n)) return new FErr(ERR.NA, "ISFORMULA needs a cell reference");
        var c = n.t === "ref" ? n.col : Math.min(n.a.col, n.b.col);
        var r = n.t === "ref" ? n.row : Math.min(n.a.row, n.b.row);
        var raw = E.raw(c, r, n.sheet);
        return raw !== undefined && raw !== null && String(raw).charAt(0) === "=";
    }, { cat: "Info", syntax: "ISFORMULA(cell)" });

    def("NA", 0, 0, function () { return new FErr(ERR.NA, "NA()"); }, { cat: "Info", syntax: "NA()" });
    def("N", 1, 1, function (a, E) {
        var v = probe(E, a[0]);
        if (isErr(v)) return v;
        if (typeof v === "number") return v;
        if (typeof v === "boolean") return v ? 1 : 0;
        return 0;
    }, { cat: "Info", elem: true, syntax: "N(value)" });
    def("TYPE", 1, 1, function (a, E) {
        var n = a[0];
        if (n.t === "range" || n.t === "call") {
            var av = E.evA(n);
            if (isArr(av) && av.data.length > 1) return 64;
        }
        var v = probe(E, n);
        if (isErr(v)) return 16;
        if (typeof v === "string") return 2;
        if (typeof v === "boolean") return 4;
        return 1;
    }, { cat: "Info", syntax: "TYPE(value)" });
    var ERROR_TYPES = {};
    ERROR_TYPES[ERR.NULL] = 1; ERROR_TYPES[ERR.DIV0] = 2; ERROR_TYPES[ERR.VALUE] = 3;
    ERROR_TYPES[ERR.REF] = 4; ERROR_TYPES[ERR.NAME] = 5; ERROR_TYPES[ERR.NUM] = 6;
    ERROR_TYPES[ERR.NA] = 7; ERROR_TYPES[ERR.CYCLE] = 8;
    def("ERROR.TYPE", 1, 1, function (a, E) {
        var v = probe(E, a[0]);
        if (!isErr(v)) return new FErr(ERR.NA, "Not an error");
        return ERROR_TYPES[v.code] || 8;
    }, { cat: "Info", elem: true, syntax: "ERROR.TYPE(reference)" });

    /* ---------- operators as functions ---------- */
    function op2(name, op, syntax) {
        def(name, 2, 2, function (a, E) {
            var l = E.val(a[0]), r = E.val(a[1]);
            return F.binValue(op, l, r);
        }, { cat: "Operator", elem: true, syntax: syntax });
    }
    op2("ADD", "+", "ADD(value1, value2)");
    op2("MINUS", "-", "MINUS(value1, value2)");
    op2("MULTIPLY", "*", "MULTIPLY(factor1, factor2)");
    op2("DIVIDE", "/", "DIVIDE(dividend, divisor)");
    op2("POW", "^", "POW(base, exponent)");
    op2("EQ", "=", "EQ(value1, value2)");
    op2("NE", "<>", "NE(value1, value2)");
    op2("GT", ">", "GT(value1, value2)");
    op2("GTE", ">=", "GTE(value1, value2)");
    op2("LT", "<", "LT(value1, value2)");
    op2("LTE", "<=", "LTE(value1, value2)");
    def("UMINUS", 1, 1, function (a, E) {
        var v = E.num(a[0]);
        return isErr(v) ? v : -v;
    }, { cat: "Operator", elem: true, syntax: "UMINUS(value)" });
    def("UPLUS", 1, 1, function (a, E) { return E.val(a[0]); },
        { cat: "Operator", elem: true, syntax: "UPLUS(value)" });
    def("UNARY_PERCENT", 1, 1, function (a, E) {
        var v = E.num(a[0]);
        return isErr(v) ? v : v / 100;
    }, { cat: "Operator", elem: true, syntax: "UNARY_PERCENT(percentage)" });
    def("ISBETWEEN", 3, 5, function (a, E) {
        var v = E.val(a[0]), lo = E.val(a[1]), hi = E.val(a[2]);
        var li = E.bool(a[3], true), hiInc = E.bool(a[4], true);
        var bad = [v, lo, hi, li, hiInc].filter(isErr)[0];
        if (bad) return bad;
        var dl = F.order(v, lo), dh = F.order(v, hi);
        return (li ? dl >= 0 : dl > 0) && (hiInc ? dh <= 0 : dh < 0);
    }, { cat: "Operator", elem: true, syntax: "ISBETWEEN(value_to_compare, lower_value, upper_value, lower_value_is_inclusive, upper_value_is_inclusive)" });
})(typeof module !== "undefined" && module.exports ? require("./formula.js") : SheetFormula);
