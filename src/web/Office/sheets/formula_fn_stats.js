/*
    ArozOS Office Sheets - aggregate and statistical functions
    ==========================================================
    Registers into the formula engine (formula.js); load after it.

        aggregate   SUM AVERAGE MIN MAX COUNT COUNTA COUNTBLANK COUNTUNIQUE
                    SUMPRODUCT SUBTOTAL AVERAGEA MAXA MINA AVERAGE.WEIGHTED
        conditional COUNTIF COUNTIFS SUMIF SUMIFS AVERAGEIF AVERAGEIFS
                    MAXIFS MINIFS
        database    DSUM DAVERAGE DCOUNT DCOUNTA DGET DMAX DMIN DPRODUCT
                    DSTDEV DSTDEVP DVAR DVARP
        descriptive MEDIAN MODE MODE.SNGL LARGE SMALL RANK RANK.EQ RANK.AVG
                    PERCENTILE(.INC/.EXC) QUARTILE(.INC/.EXC)
                    PERCENTRANK(.INC/.EXC) STDEV STDEV.S STDEVP STDEV.P STDEVA
                    STDEVPA VAR VAR.S VARP VAR.P VARA VARPA GEOMEAN HARMEAN
                    AVEDEV DEVSQ TRIMMEAN SKEW SKEW.P KURT STANDARDIZE
                    FISHER FISHERINV PERMUT PERMUTATIONA PROB
        paired      CORREL PEARSON RSQ SLOPE INTERCEPT STEYX FORECAST
                    FORECAST.LINEAR COVAR COVARIANCE.P COVARIANCE.S
                    SUMX2MY2 SUMX2PY2 SUMXMY2
*/
(function (F) {
    "use strict";
    var ERR = F.ERR, FErr = F.FErr, isErr = F.isErr, isArr = F.isArr, Arr = F.Arr;

    function def(name, min, max, fn, extra) {
        var spec = { min: min, max: max, fn: fn, cat: "Statistical" };
        for (var k in extra || {}) spec[k] = extra[k];
        F.defineFunction(name, spec);
    }
    function num(msg) { return new FErr(ERR.NUM, msg); }
    function div0(msg) { return new FErr(ERR.DIV0, msg); }
    function fin(v) {
        if (typeof v === "number" && !isFinite(v)) return num("Result is not a finite number");
        return v;
    }

    /* ---------- math over number lists ---------- */
    function sum(xs) { var s = 0; for (var i = 0; i < xs.length; i++) s += xs[i]; return s; }
    function mean(xs) { return sum(xs) / xs.length; }
    function sorted(xs) { return xs.slice().sort(function (a, b) { return a - b; }); }
    function devsq(xs) {
        var m = mean(xs), s = 0;
        for (var i = 0; i < xs.length; i++) s += (xs[i] - m) * (xs[i] - m);
        return s;
    }
    function variance(xs, sample) {
        if (xs.length < (sample ? 2 : 1)) return div0("Not enough values");
        return devsq(xs) / (xs.length - (sample ? 1 : 0));
    }
    var AGG = {
        SUM: function (xs) { return sum(xs); },
        AVERAGE: function (xs) { return xs.length ? mean(xs) : div0("AVERAGE of no numbers"); },
        MIN: function (xs) { return xs.length ? Math.min.apply(null, xs) : 0; },
        MAX: function (xs) { return xs.length ? Math.max.apply(null, xs) : 0; },
        PRODUCT: function (xs) { return xs.length ? xs.reduce(function (p, x) { return p * x; }, 1) : 0; },
        STDEV: function (xs) { var v = variance(xs, true); return isErr(v) ? v : Math.sqrt(v); },
        STDEVP: function (xs) { var v = variance(xs, false); return isErr(v) ? v : Math.sqrt(v); },
        VAR: function (xs) { return variance(xs, true); },
        VARP: function (xs) { return variance(xs, false); }
    };

    /* "numbers" functions: one list of numbers from every argument */
    function listFn(name, mode, fn, syntax, extra) {
        def(name, 1, -1, function (a, E) {
            var st = E.numbers(a, mode);
            if (st.err) return st.err;
            var r = fn(st.nums, st, a, E);
            return isErr(r) ? r : fin(r);
        }, Object.assign({ syntax: syntax || name + "(value1, [value2, ...])" }, extra || {}));
    }
    listFn("SUM", "sum", AGG.SUM, null, { cat: "Math" });
    listFn("AVERAGE", "sum", AGG.AVERAGE);
    listFn("MIN", "sum", AGG.MIN);
    listFn("MAX", "sum", AGG.MAX);
    listFn("AVERAGEA", "a", AGG.AVERAGE);
    listFn("MINA", "a", AGG.MIN);
    listFn("MAXA", "a", AGG.MAX);
    def("COUNT", 1, -1, function (a, E) {
        var st = E.numbers(a, "count");
        return st.err ? st.err : st.count;
    }, { syntax: "COUNT(value1, [value2, ...])" });
    def("COUNTA", 1, -1, function (a, E) {
        // errors are values too: COUNTA counts them
        var n = 0;
        for (var i = 0; i < a.length; i++) {
            if (a[i].t === "empty") continue;
            var vals = a[i].t === "str" || a[i].t === "num" || a[i].t === "bool" ? [E.val(a[i])] : E.flat(a[i]);
            if (isErr(vals)) return vals;
            vals.forEach(function (v) { if (v !== null && v !== undefined) n++; });
        }
        return n;
    }, { syntax: "COUNTA(value1, [value2, ...])" });
    def("COUNTBLANK", 1, 1, function (a, E) {
        var vals = E.flat(a[0]);
        if (isErr(vals)) return vals;
        return vals.filter(function (v) { return v === null || v === undefined || v === ""; }).length;
    }, { cat: "Math", syntax: "COUNTBLANK(range)" });
    def("COUNTUNIQUE", 1, -1, function (a, E) {
        var seen = {};
        for (var i = 0; i < a.length; i++) {
            if (a[i].t === "empty") continue;
            var vals = E.flat(a[i]);
            if (isErr(vals)) return vals;
            for (var k = 0; k < vals.length; k++) {
                var v = vals[k];
                if (v === null || v === undefined || v === "") continue;
                seen[(isErr(v) ? "e" + v.code : typeof v + ":" + v)] = true;
            }
        }
        return Object.keys(seen).length;
    }, { cat: "Math", syntax: "COUNTUNIQUE(value1, [value2, ...])" });

    /*
        SUMPRODUCT(array1, [array2, ...]): every argument is evaluated in
        array context, all must be the same size, and the element-wise
        products are summed. Text, blanks and logicals count as 0 (hence
        the usual (A1:A9="x")*(B1:B9) idiom, where the multiplication has
        already turned the logicals into numbers); an error anywhere is the
        result.
    */
    def("SUMPRODUCT", 1, -1, function (a, E) {
        var arrs = [];
        for (var i = 0; i < a.length; i++) {
            var v = E.arr(a[i]);
            if (isErr(v)) return v;
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
    }, { cat: "Math", syntax: "SUMPRODUCT(array1, [array2, ...])" });

    /*
        SUBTOTAL(function_code, range1, ...): 1 AVERAGE, 2 COUNT, 3 COUNTA,
        4 MAX, 5 MIN, 6 PRODUCT, 7 STDEV, 8 STDEVP, 9 SUM, 10 VAR, 11 VARP.
        Rows a filter hides never count; 101-111 also skip rows the user hid.
        Cells that are themselves SUBTOTALs are skipped, so subtotals nest.
    */
    var SUBTOTAL_FNS = [null, "AVERAGE", "COUNT", "COUNTA", "MAX", "MIN", "PRODUCT", "STDEV", "STDEVP", "SUM", "VAR", "VARP"];
    def("SUBTOTAL", 2, -1, function (a, E) {
        var code = E.int(a[0]);
        if (isErr(code)) return code;
        var skipHidden = code > 100;
        var fname = SUBTOTAL_FNS[skipHidden ? code - 100 : code];
        if (!fname) return new FErr(ERR.VALUE, "Unknown SUBTOTAL function code " + code);
        var nums = [], counta = 0;
        for (var i = 1; i < a.length; i++) {
            var n = a[i];
            if (!E.isRef(n)) return new FErr(ERR.VALUE, "SUBTOTAL needs cell ranges");
            var b = n.t === "ref" ? { c1: n.col, c2: n.col, r1: n.row, r2: n.row } : E.box(n);
            for (var r = b.r1; r <= b.r2; r++) {
                var state = E.rowState(r, n.sheet);
                if (state === 2 || (state === 1 && skipHidden)) continue;
                for (var c = b.c1; c <= b.c2; c++) {
                    var raw = E.raw(c, r, n.sheet);
                    if (typeof raw === "string" && /^=.*\bSUBTOTAL\s*\(/i.test(raw)) continue;
                    var v = E.cell(c, r, n.sheet);
                    if (isErr(v)) return v;
                    if (v === null || v === undefined) continue;
                    counta++;
                    if (typeof v === "number") nums.push(v);
                }
            }
        }
        if (fname === "COUNT") return nums.length;
        if (fname === "COUNTA") return counta;
        var res = AGG[fname](nums);
        return isErr(res) ? res : fin(res);
    }, { cat: "Math", syntax: "SUBTOTAL(function_code, range1, [range2, ...])" });

    /* ---------- conditional aggregates ---------- */
    // an argument's cells as an Arr; ranges keep their shape
    function cells(E, node) {
        if (!node || node.t === "empty") return new FErr(ERR.VALUE, "Missing range");
        return E.arr(node);
    }
    // the range SUMIF adds up: same shape as the criteria range, anchored at
    // the top-left of the range it was given (Excel resizes it)
    function shaped(E, node, like) {
        if (node.t === "range" || node.t === "ref") {
            var c1 = node.t === "ref" ? node.col : Math.min(node.a.col, node.b.col);
            var r1 = node.t === "ref" ? node.row : Math.min(node.a.row, node.b.row);
            var data = [];
            for (var r = 0; r < like.rows; r++) {
                for (var c = 0; c < like.cols; c++) data.push(E.cell(c1 + c, r1 + r, node.sheet));
            }
            return new Arr(like.rows, like.cols, data);
        }
        var v = E.arr(node);
        if (isErr(v)) return v;
        if (v.rows !== like.rows || v.cols !== like.cols) return new FErr(ERR.VALUE, "Ranges must be the same size");
        return v;
    }
    // indices of elements that pass every (range, criterion) pair
    function matchIndices(E, pairs) {
        var first = null, tests = [];
        for (var i = 0; i < pairs.length; i += 2) {
            var rg = cells(E, pairs[i]);
            if (isErr(rg)) return rg;
            if (first && (rg.rows !== first.rows || rg.cols !== first.cols)) {
                return new FErr(ERR.VALUE, "Criteria ranges must be the same size");
            }
            first = first || rg;
            var crit = E.val(pairs[i + 1]);
            tests.push({ data: rg.data, test: F.criteria(crit) });
        }
        var out = [];
        for (var k = 0; k < first.data.length; k++) {
            var ok = true;
            for (var t = 0; t < tests.length && ok; t++) ok = tests[t].test(tests[t].data[k]);
            if (ok) out.push(k);
        }
        out.shape = first;
        return out;
    }
    function numbersAt(data, idx) {
        var xs = [];
        for (var i = 0; i < idx.length; i++) {
            var v = data[idx[i]];
            if (isErr(v)) return v;
            if (typeof v === "number") xs.push(v);
        }
        return xs;
    }
    def("COUNTIF", 2, 2, function (a, E) {
        var idx = matchIndices(E, a);
        return isErr(idx) ? idx : idx.length;
    }, { cat: "Math", syntax: "COUNTIF(range, criterion)" });
    def("COUNTIFS", 2, -1, function (a, E) {
        if (a.length % 2) return new FErr(ERR.NA, "COUNTIFS expects range/criterion pairs");
        var idx = matchIndices(E, a);
        return isErr(idx) ? idx : idx.length;
    }, { cat: "Math", syntax: "COUNTIFS(criteria_range1, criterion1, [criteria_range2, criterion2, ...])" });
    function ifFn(name, agg, withOwnRange) {
        def(name, 2, 3, function (a, E) {
            var idx = matchIndices(E, [a[0], a[1]]);
            if (isErr(idx)) return idx;
            var src = a.length > 2 && !E.missing(a[2]) ? shaped(E, a[2], idx.shape) : idx.shape;
            if (isErr(src)) return src;
            var xs = numbersAt(src.data, idx);
            if (isErr(xs)) return xs;
            return agg(xs);
        }, { cat: name === "SUMIF" ? "Math" : "Statistical", syntax: name + "(criteria_range, criterion, [" + (withOwnRange || "sum_range") + "])" });
    }
    ifFn("SUMIF", AGG.SUM);
    ifFn("AVERAGEIF", function (xs) { return xs.length ? mean(xs) : div0("No cells matched"); }, "average_range");
    function ifsFn(name, agg, cat) {
        def(name, 3, -1, function (a, E) {
            if (a.length % 2 === 0) return new FErr(ERR.NA, name + " expects a range then range/criterion pairs");
            var target = cells(E, a[0]);
            if (isErr(target)) return target;
            var idx = matchIndices(E, a.slice(1));
            if (isErr(idx)) return idx;
            if (target.rows !== idx.shape.rows || target.cols !== idx.shape.cols) {
                return new FErr(ERR.VALUE, name + " ranges must be the same size");
            }
            var xs = numbersAt(target.data, idx);
            if (isErr(xs)) return xs;
            return agg(xs);
        }, { cat: cat || "Statistical", syntax: name + "(range, criteria_range1, criterion1, [criteria_range2, criterion2, ...])" });
    }
    ifsFn("SUMIFS", AGG.SUM, "Math");
    ifsFn("AVERAGEIFS", function (xs) { return xs.length ? mean(xs) : div0("No cells matched"); });
    ifsFn("MAXIFS", AGG.MAX);
    ifsFn("MINIFS", AGG.MIN);

    /* ---------- database functions ---------- */
    /*
        D*(database, field, criteria): database is a range whose first row
        holds column labels. field is a label (case-insensitive) or a 1-based
        column number. criteria is a range with labels in its first row and
        conditions below: conditions on one row must all hold, any row may
        match. A blank condition matches anything.
    */
    function dbValues(E, a) {
        var db = cells(E, a[0]);
        if (isErr(db)) return db;
        if (db.rows < 2) return new FErr(ERR.VALUE, "The database needs a label row and data");
        var labels = db.data.slice(0, db.cols).map(function (v) { return String(F.toStr(v)).toLowerCase().trim(); });
        var col = -1;
        if (!E.missing(a[1])) {
            var f = E.val(a[1]);
            if (isErr(f)) return f;
            if (typeof f === "number") col = Math.trunc(f) - 1;
            else col = labels.indexOf(String(f).toLowerCase().trim());
            if (col < 0 || col >= db.cols) return new FErr(ERR.VALUE, "No database field " + F.toStr(f));
        }
        var cr = cells(E, a[2]);
        if (isErr(cr)) return cr;
        var conds = [];
        for (var r = 1; r < cr.rows; r++) {
            var row = [];
            for (var c = 0; c < cr.cols; c++) {
                var cv = cr.data[r * cr.cols + c];
                if (cv === null || cv === undefined || cv === "") continue;
                var label = String(F.toStr(cr.data[c])).toLowerCase().trim();
                var at = labels.indexOf(label);
                if (at < 0) return new FErr(ERR.VALUE, "Criteria label " + label + " is not in the database");
                row.push({ col: at, test: F.criteria(cv) });
            }
            conds.push(row);
        }
        if (!conds.length) conds.push([]);
        var out = [];
        for (var rr = 1; rr < db.rows; rr++) {
            var rec = db.data.slice(rr * db.cols, (rr + 1) * db.cols);
            var hit = conds.some(function (row) {
                return row.every(function (cd) { return cd.test(rec[cd.col]); });
            });
            if (hit) out.push(col >= 0 ? rec[col] : rec);
        }
        return out;
    }
    function dbFn(name, fn) {
        def(name, 3, 3, function (a, E) {
            var vals = dbValues(E, a);
            if (isErr(vals)) return vals;
            return fn(vals, a, E);
        }, { cat: "Database", syntax: name + "(database, field, criteria)" });
    }
    function dbNums(vals) {
        var xs = [];
        for (var i = 0; i < vals.length; i++) {
            if (isErr(vals[i])) return vals[i];
            if (typeof vals[i] === "number") xs.push(vals[i]);
        }
        return xs;
    }
    function dbAgg(fn) {
        return function (vals) {
            var xs = dbNums(vals);
            if (isErr(xs)) return xs;
            var r = fn(xs);
            return isErr(r) ? r : fin(r);
        };
    }
    dbFn("DSUM", dbAgg(AGG.SUM));
    dbFn("DAVERAGE", dbAgg(function (xs) { return xs.length ? mean(xs) : div0("No records matched"); }));
    dbFn("DMAX", dbAgg(AGG.MAX));
    dbFn("DMIN", dbAgg(AGG.MIN));
    dbFn("DPRODUCT", dbAgg(AGG.PRODUCT));
    dbFn("DSTDEV", dbAgg(AGG.STDEV));
    dbFn("DSTDEVP", dbAgg(AGG.STDEVP));
    dbFn("DVAR", dbAgg(AGG.VAR));
    dbFn("DVARP", dbAgg(AGG.VARP));
    dbFn("DCOUNT", function (vals, a, E) {
        if (E.missing(a[1])) return vals.length;
        return vals.filter(function (v) { return typeof v === "number"; }).length;
    });
    dbFn("DCOUNTA", function (vals, a, E) {
        if (E.missing(a[1])) return vals.length;
        return vals.filter(function (v) { return v !== null && v !== undefined && v !== ""; }).length;
    });
    dbFn("DGET", function (vals) {
        if (!vals.length) return new FErr(ERR.VALUE, "DGET found no matching record");
        if (vals.length > 1) return num("DGET found more than one matching record");
        return vals[0];
    });

    /* ---------- descriptive statistics ---------- */
    listFn("MEDIAN", "sum", function (xs) {
        if (!xs.length) return num("MEDIAN of no numbers");
        var s = sorted(xs), m = s.length >> 1;
        return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    });
    function mode(xs) {
        var counts = new Map(), best = null, bestN = 1;
        xs.forEach(function (x) {
            var n = (counts.get(x) || 0) + 1;
            counts.set(x, n);
            if (n > bestN) { bestN = n; best = x; }
        });
        // ties keep the value that reached the count first
        return best === null ? new FErr(ERR.NA, "No value repeats") : best;
    }
    listFn("MODE", "sum", mode);
    listFn("MODE.SNGL", "sum", mode);
    function kth(name, largest) {
        def(name, 2, 2, function (a, E) {
            var st = E.numbers([a[0]], "sum");
            if (st.err) return st.err;
            var k = E.num(a[1]);
            if (isErr(k)) return k;
            k = Math.ceil(k);
            if (k < 1 || k > st.nums.length) return num(name + " k is out of range");
            var s = sorted(st.nums);
            return largest ? s[s.length - k] : s[k - 1];
        }, { syntax: name + "(data, n)" });
    }
    kth("LARGE", true);
    kth("SMALL", false);
    function rankFn(name, avg) {
        def(name, 2, 3, function (a, E) {
            var v = E.num(a[0]);
            if (isErr(v)) return v;
            var st = E.numbers([a[1]], "sum");
            if (st.err) return st.err;
            var asc = E.bool(a[2], false);
            if (isErr(asc)) return asc;
            var better = 0, same = 0;
            st.nums.forEach(function (x) {
                if (x === v) same++;
                else if (asc ? x < v : x > v) better++;
            });
            if (!same) return new FErr(ERR.NA, name + " value is not in the list");
            return avg ? better + (same + 1) / 2 : better + 1;
        }, { syntax: name + "(value, data, [is_ascending])" });
    }
    rankFn("RANK", false);
    rankFn("RANK.EQ", false);
    rankFn("RANK.AVG", true);

    function percentileInc(xs, k) {
        if (!xs.length || k < 0 || k > 1) return num("Percentile out of range");
        var s = sorted(xs), h = (s.length - 1) * k, lo = Math.floor(h);
        return lo + 1 < s.length ? s[lo] + (h - lo) * (s[lo + 1] - s[lo]) : s[lo];
    }
    function percentileExc(xs, k) {
        var n = xs.length;
        if (!n || k <= 0 || k >= 1) return num("Percentile out of range");
        var h = (n + 1) * k - 1;
        if (h < 0 || h > n - 1) return num("Percentile out of range for this many values");
        var s = sorted(xs), lo = Math.floor(h);
        return lo + 1 < n ? s[lo] + (h - lo) * (s[lo + 1] - s[lo]) : s[lo];
    }
    function pctFn(name, fn, quart) {
        def(name, 2, 2, function (a, E) {
            var st = E.numbers([a[0]], "sum");
            if (st.err) return st.err;
            var k = E.num(a[1]);
            if (isErr(k)) return k;
            if (quart) {
                k = Math.trunc(k);
                if (quart === "exc" ? (k < 1 || k > 3) : (k < 0 || k > 4)) return num("Quartile must be " + (quart === "exc" ? "1-3" : "0-4"));
                k = k / 4;
            }
            return fn(st.nums, k);
        }, { syntax: name + "(data, " + (quart ? "quartile_number" : "percentile") + ")" });
    }
    pctFn("PERCENTILE", percentileInc);
    pctFn("PERCENTILE.INC", percentileInc);
    pctFn("PERCENTILE.EXC", percentileExc);
    pctFn("QUARTILE", percentileInc, "inc");
    pctFn("QUARTILE.INC", percentileInc, "inc");
    pctFn("QUARTILE.EXC", percentileExc, "exc");
    function percentRank(name, exc) {
        def(name, 2, 3, function (a, E) {
            var st = E.numbers([a[0]], "sum");
            if (st.err) return st.err;
            var x = E.num(a[1]), sig = E.int(a[2], 3);
            if (isErr(x)) return x;
            if (isErr(sig)) return sig;
            if (sig < 1) return num("Significance must be 1 or more");
            var s = sorted(st.nums), n = s.length;
            if (!n || x < s[0] || x > s[n - 1]) return new FErr(ERR.NA, name + " value is outside the data");
            var less = 0;
            while (less < n && s[less] < x) less++;
            var pos;
            if (s[less] === x) pos = exc ? less + 1 : less;
            else {
                var lo = s[less - 1], hi = s[less];
                pos = (exc ? less : less - 1) + (x - lo) / (hi - lo);
            }
            var r;
            if (exc) r = pos / (n + 1);
            else r = n === 1 ? 1 : pos / (n - 1);
            var f = Math.pow(10, sig);
            return Math.floor(+(r * f).toPrecision(12)) / f;
        }, { syntax: name + "(data, value, [significant_digits])" });
    }
    percentRank("PERCENTRANK", false);
    percentRank("PERCENTRANK.INC", false);
    percentRank("PERCENTRANK.EXC", true);

    listFn("STDEV", "sum", AGG.STDEV);
    listFn("STDEV.S", "sum", AGG.STDEV);
    listFn("STDEVP", "sum", AGG.STDEVP);
    listFn("STDEV.P", "sum", AGG.STDEVP);
    listFn("STDEVA", "a", AGG.STDEV);
    listFn("STDEVPA", "a", AGG.STDEVP);
    listFn("VAR", "sum", AGG.VAR);
    listFn("VAR.S", "sum", AGG.VAR);
    listFn("VARP", "sum", AGG.VARP);
    listFn("VAR.P", "sum", AGG.VARP);
    listFn("VARA", "a", AGG.VAR);
    listFn("VARPA", "a", AGG.VARP);
    listFn("GEOMEAN", "sum", function (xs) {
        if (!xs.length || xs.some(function (x) { return x <= 0; })) return num("GEOMEAN needs positive numbers");
        return Math.exp(sum(xs.map(Math.log)) / xs.length);
    });
    listFn("HARMEAN", "sum", function (xs) {
        if (!xs.length || xs.some(function (x) { return x <= 0; })) return num("HARMEAN needs positive numbers");
        return xs.length / sum(xs.map(function (x) { return 1 / x; }));
    });
    listFn("AVEDEV", "sum", function (xs) {
        if (!xs.length) return num("AVEDEV of no numbers");
        var m = mean(xs);
        return sum(xs.map(function (x) { return Math.abs(x - m); })) / xs.length;
    });
    listFn("DEVSQ", "sum", function (xs) { return xs.length ? devsq(xs) : 0; });
    def("TRIMMEAN", 2, 2, function (a, E) {
        var st = E.numbers([a[0]], "sum");
        if (st.err) return st.err;
        var p = E.num(a[1]);
        if (isErr(p)) return p;
        if (p < 0 || p >= 1 || !st.nums.length) return num("TRIMMEAN percent must be 0 <= p < 1");
        var s = sorted(st.nums), k = Math.floor(s.length * p / 2);
        return mean(s.slice(k, s.length - k));
    }, { syntax: "TRIMMEAN(data, exclude_proportion)" });
    function moment(xs, pow, sd) {
        var m = mean(xs), s = 0;
        for (var i = 0; i < xs.length; i++) s += Math.pow((xs[i] - m) / sd, pow);
        return s;
    }
    listFn("SKEW", "sum", function (xs) {
        var n = xs.length;
        if (n < 3) return div0("SKEW needs at least 3 values");
        var sd = Math.sqrt(devsq(xs) / (n - 1));
        if (sd === 0) return div0("SKEW of identical values");
        return n / ((n - 1) * (n - 2)) * moment(xs, 3, sd);
    });
    listFn("SKEW.P", "sum", function (xs) {
        var n = xs.length;
        if (n < 1) return div0("SKEW.P of no values");
        var sd = Math.sqrt(devsq(xs) / n);
        if (sd === 0) return div0("SKEW.P of identical values");
        return moment(xs, 3, sd) / n;
    });
    listFn("KURT", "sum", function (xs) {
        var n = xs.length;
        if (n < 4) return div0("KURT needs at least 4 values");
        var sd = Math.sqrt(devsq(xs) / (n - 1));
        if (sd === 0) return div0("KURT of identical values");
        return n * (n + 1) / ((n - 1) * (n - 2) * (n - 3)) * moment(xs, 4, sd) -
            3 * (n - 1) * (n - 1) / ((n - 2) * (n - 3));
    });
    def("STANDARDIZE", 3, 3, function (a, E) {
        var x = E.num(a[0]), m = E.num(a[1]), sd = E.num(a[2]);
        var bad = [x, m, sd].filter(isErr)[0];
        if (bad) return bad;
        if (sd <= 0) return num("STANDARDIZE needs a positive standard deviation");
        return (x - m) / sd;
    }, { elem: true, syntax: "STANDARDIZE(value, mean, standard_deviation)" });
    def("FISHER", 1, 1, function (a, E) {
        var x = E.num(a[0]);
        if (isErr(x)) return x;
        if (x <= -1 || x >= 1) return num("FISHER needs -1 < value < 1");
        return 0.5 * Math.log((1 + x) / (1 - x));
    }, { elem: true, syntax: "FISHER(value)" });
    def("FISHERINV", 1, 1, function (a, E) {
        var y = E.num(a[0]);
        if (isErr(y)) return y;
        return fin(Math.tanh(y));
    }, { elem: true, syntax: "FISHERINV(value)" });
    def("PERMUT", 2, 2, function (a, E) {
        var n = E.int(a[0]), k = E.int(a[1]);
        if (isErr(n)) return n;
        if (isErr(k)) return k;
        if (n < 0 || k < 0 || n < k) return num("PERMUT needs 0 <= k <= n");
        var r = 1;
        for (var i = 0; i < k; i++) r *= n - i;
        return fin(r);
    }, { elem: true, syntax: "PERMUT(n, k)" });
    def("PERMUTATIONA", 2, 2, function (a, E) {
        var n = E.int(a[0]), k = E.int(a[1]);
        if (isErr(n)) return n;
        if (isErr(k)) return k;
        if (n < 0 || k < 0) return num("PERMUTATIONA needs non-negative numbers");
        return fin(Math.pow(n, k));
    }, { elem: true, syntax: "PERMUTATIONA(number, number_chosen)" });
    def("AVERAGE.WEIGHTED", 2, -1, function (a, E) {
        if (a.length % 2) return new FErr(ERR.NA, "AVERAGE.WEIGHTED expects value/weight pairs");
        var total = 0, weights = 0;
        for (var i = 0; i < a.length; i += 2) {
            var vs = E.flat(a[i]), ws = E.flat(a[i + 1]);
            if (isErr(vs)) return vs;
            if (isErr(ws)) return ws;
            if (vs.length !== ws.length) return new FErr(ERR.VALUE, "Values and weights must be the same size");
            for (var k = 0; k < vs.length; k++) {
                var v = vs[k], w = ws[k];
                if (isErr(v)) return v;
                if (isErr(w)) return w;
                if (typeof v !== "number" || typeof w !== "number") continue;
                if (w < 0) return num("Weights cannot be negative");
                total += v * w;
                weights += w;
            }
        }
        if (weights === 0) return div0("The weights add up to zero");
        return total / weights;
    }, { syntax: "AVERAGE.WEIGHTED(values, weights, [additional values], [additional weights])" });
    def("PROB", 3, 4, function (a, E) {
        var xs = E.flat(a[0]), ps = E.flat(a[1]);
        if (isErr(xs)) return xs;
        if (isErr(ps)) return ps;
        if (xs.length !== ps.length) return new FErr(ERR.NA, "PROB ranges must be the same size");
        var lo = E.num(a[2]);
        if (isErr(lo)) return lo;
        var hi = E.num(a[3], lo);
        if (isErr(hi)) return hi;
        var total = 0, hit = 0;
        for (var i = 0; i < xs.length; i++) {
            if (typeof ps[i] !== "number" || typeof xs[i] !== "number") continue;
            if (ps[i] < 0 || ps[i] > 1) return num("Probabilities must be 0..1");
            total += ps[i];
            if (xs[i] >= lo && xs[i] <= hi) hit += ps[i];
        }
        if (Math.abs(total - 1) > 1e-9) return num("Probabilities must add up to 1");
        return hit;
    }, { syntax: "PROB(data, probabilities, low_limit, [high_limit])" });

    /* ---------- paired data ---------- */
    // (y, x) number pairs where both sides are numbers, sizes must match
    function pairs(E, ny, nx) {
        var ys = E.flat(ny), xs = E.flat(nx);
        if (isErr(ys)) return ys;
        if (isErr(xs)) return xs;
        if (ys.length !== xs.length) return new FErr(ERR.NA, "The two ranges must be the same size");
        var py = [], px = [];
        for (var i = 0; i < ys.length; i++) {
            if (isErr(ys[i])) return ys[i];
            if (isErr(xs[i])) return xs[i];
            if (typeof ys[i] === "number" && typeof xs[i] === "number") { py.push(ys[i]); px.push(xs[i]); }
        }
        return { y: py, x: px, n: py.length };
    }
    function sums(p) {
        var mx = mean(p.x), my = mean(p.y), sxx = 0, syy = 0, sxy = 0;
        for (var i = 0; i < p.n; i++) {
            var dx = p.x[i] - mx, dy = p.y[i] - my;
            sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
        }
        return { mx: mx, my: my, sxx: sxx, syy: syy, sxy: sxy };
    }
    function pairFn(name, fn, syntax, cat) {
        def(name, 2, 2, function (a, E) {
            var p = pairs(E, a[0], a[1]);
            if (isErr(p)) return p;
            var r = fn(p, p.n ? sums(p) : null);
            return isErr(r) ? r : fin(r);
        }, { syntax: syntax || name + "(data_y, data_x)", cat: cat || "Statistical" });
    }
    function correl(p, s) {
        if (p.n < 2 || s.sxx === 0 || s.syy === 0) return div0("Not enough variation to correlate");
        return s.sxy / Math.sqrt(s.sxx * s.syy);
    }
    pairFn("CORREL", correl);
    pairFn("PEARSON", correl);
    pairFn("RSQ", function (p, s) { var r = correl(p, s); return isErr(r) ? r : r * r; });
    pairFn("SLOPE", function (p, s) {
        if (p.n < 2 || s.sxx === 0) return div0("SLOPE needs varying x values");
        return s.sxy / s.sxx;
    }, "SLOPE(data_y, data_x)");
    pairFn("INTERCEPT", function (p, s) {
        if (p.n < 2 || s.sxx === 0) return div0("INTERCEPT needs varying x values");
        return s.my - s.sxy / s.sxx * s.mx;
    }, "INTERCEPT(data_y, data_x)");
    pairFn("STEYX", function (p, s) {
        if (p.n < 3 || s.sxx === 0) return div0("STEYX needs at least 3 points");
        return Math.sqrt((s.syy - s.sxy * s.sxy / s.sxx) / (p.n - 2));
    }, "STEYX(data_y, data_x)");
    pairFn("COVAR", function (p, s) { return p.n ? s.sxy / p.n : div0("No data"); }, "COVAR(data_y, data_x)");
    pairFn("COVARIANCE.P", function (p, s) { return p.n ? s.sxy / p.n : div0("No data"); }, "COVARIANCE.P(data_y, data_x)");
    pairFn("COVARIANCE.S", function (p, s) { return p.n > 1 ? s.sxy / (p.n - 1) : div0("Not enough data"); }, "COVARIANCE.S(data_y, data_x)");
    function forecast(name) {
        def(name, 3, 3, function (a, E) {
            var x = E.num(a[0]);
            if (isErr(x)) return x;
            var p = pairs(E, a[1], a[2]);
            if (isErr(p)) return p;
            if (p.n < 2) return div0("FORECAST needs at least 2 points");
            var s = sums(p);
            if (s.sxx === 0) return div0("FORECAST needs varying x values");
            var b = s.sxy / s.sxx;
            return fin(s.my - b * s.mx + b * x);
        }, { syntax: name + "(x, data_y, data_x)" });
    }
    forecast("FORECAST");
    forecast("FORECAST.LINEAR");
    function sumPairs(name, fn) {
        pairFn(name, function (p) {
            var s = 0;
            for (var i = 0; i < p.n; i++) s += fn(p.y[i], p.x[i]);
            return s;
        }, name + "(array_x, array_y)", "Array");
    }
    // pairFn hands (first, second) as (y, x): keep the documented order
    sumPairs("SUMX2MY2", function (a, b) { return a * a - b * b; });
    sumPairs("SUMX2PY2", function (a, b) { return a * a + b * b; });
    sumPairs("SUMXMY2", function (a, b) { return (a - b) * (a - b); });
})(typeof module !== "undefined" && module.exports ? require("./formula.js") : SheetFormula);
