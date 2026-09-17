/*
    ArozOS Office Sheets - lookup and reference functions
    =====================================================
    Registers into the formula engine (formula.js); load after it.

        VLOOKUP HLOOKUP LOOKUP MATCH XMATCH XLOOKUP INDEX ROW COLUMN ROWS
        COLUMNS

    Functions that can return several cells (INDEX with a 0 row / column,
    XLOOKUP with a multi-column result) hand back an array, which works
    inside SUMPRODUCT / SUM; in a plain cell it is #VALUE! until spilling
    arrives.
*/
(function (F) {
    "use strict";
    var ERR = F.ERR, FErr = F.FErr, isErr = F.isErr, isArr = F.isArr, Arr = F.Arr;

    function def(name, min, max, fn, extra) {
        var spec = { min: min, max: max, fn: fn, cat: "Lookup" };
        for (var k in extra || {}) spec[k] = extra[k];
        F.defineFunction(name, spec);
    }
    function na(msg) { return new FErr(ERR.NA, msg); }
    function at(A, r, c) { return A.data[r * A.cols + c]; }
    function row(A, r) { return new Arr(1, A.cols, A.data.slice(r * A.cols, (r + 1) * A.cols)); }
    function col(A, c) {
        var out = [];
        for (var r = 0; r < A.rows; r++) out.push(at(A, r, c));
        return new Arr(A.rows, 1, out);
    }
    // a 1-D array's values, or null when it is 2-D
    function vector(A) {
        if (A.rows !== 1 && A.cols !== 1) return null;
        return A.data;
    }
    function sameKind(a, b) {
        if (typeof a === "number" && typeof b === "number") return true;
        if (typeof a === "string" && typeof b === "string") return true;
        return typeof a === "boolean" && typeof b === "boolean";
    }
    function isWild(s) { return typeof s === "string" && /[*?~]/.test(s); }
    /* How many rows / columns a range node spans (Infinity for A:A style
       ranges, null when it is not a literal range). Used to guess, before
       evaluating, whether a lookup can answer with several cells. */
    function span(node, rows) {
        if (!node || node.t !== "range") return null;
        if (node.open === (rows ? "cols" : "rows") || (rows && node.open === "down")) return Infinity;
        var a = node.a, b = node.b;
        return rows ? Math.abs(b.row - a.row) + 1 : Math.abs(b.col - a.col) + 1;
    }
    function multi(node) {
        if (!node) return false;
        if (node.t === "name" || node.t === "rangeop" || node.t === "call") return true;
        return node.t === "range" && (span(node, true) > 1 && span(node, false) > 1);
    }

    /*
        find(key, values, mode, direction)
          mode 0: exact (case-insensitive text)
          mode 2: exact with * ? wildcards
          mode -1: exact, else the largest value below the key
          mode 1: exact, else the smallest value above the key
        direction 1 scans first-to-last, -1 last-to-first. Only values of
        the key's kind (number / text / logical) are candidates.
        Returns the index or -1.
    */
    function find(key, values, mode, direction) {
        var n = values.length, i, best = -1, bestVal;
        var re = mode === 2 && typeof key === "string" ? F.wildcardRegex(key) : null;
        for (var k = 0; k < n; k++) {
            i = direction < 0 ? n - 1 - k : k;
            var v = values[i];
            if (v === null || v === undefined || isErr(v)) continue;
            if (re) {
                if (typeof v === "string" && re.test(v)) return i;
                continue;
            }
            if (!sameKind(key, v)) continue;
            var d = F.order(v, key);
            if (d === 0) return i;
            if (mode === -1 && d < 0 && (best < 0 || F.order(v, bestVal) > 0)) { best = i; bestVal = v; }
            if (mode === 1 && d > 0 && (best < 0 || F.order(v, bestVal) < 0)) { best = i; bestVal = v; }
        }
        return best;
    }
    /* sorted-data approximate match (MATCH 1/-1, LOOKUP, VLOOKUP TRUE):
       Excel binary-searches, which is undefined on unsorted data; this scans
       and keeps the last candidate, which is the same answer on sorted data
       (including the last of duplicate keys). */
    function approx(key, values, descending) {
        var best = -1, bestVal;
        for (var i = 0; i < values.length; i++) {
            var v = values[i];
            if (v === null || v === undefined || isErr(v) || !sameKind(key, v)) continue;
            var d = F.order(v, key);
            if (descending ? d < 0 : d > 0) continue;
            if (best < 0 || (descending ? F.order(v, bestVal) <= 0 : F.order(v, bestVal) >= 0)) { best = i; bestVal = v; }
        }
        return best;
    }

    /*
        VLOOKUP(search_key, range, index, [is_sorted]) and its transposed twin
        HLOOKUP. index is 1-based within the range. is_sorted defaults to TRUE
        (closest match at or below the key); FALSE means exact, with * ?
        wildcards for text, and a miss is #N/A.
    */
    function vhlookup(name, vertical) {
        def(name, 3, 4, function (a, E) {
            var key = E.val(a[0]);
            if (isErr(key)) return key;
            var A = E.arr(a[1]);
            if (isErr(A)) return A;
            var idx = E.int(a[2]);
            if (isErr(idx)) return idx;
            var depth = vertical ? A.cols : A.rows;
            if (idx < 1) return new FErr(ERR.VALUE, name + " index must be 1 or more");
            if (idx > depth) return new FErr(ERR.REF, name + " index " + idx + " is past the end of the range");
            var sorted = E.bool(a[3], true);
            if (isErr(sorted)) return sorted;
            var keys = vertical ? col(A, 0).data : row(A, 0).data;
            var i = find(key, keys, isWild(key) && !sorted ? 2 : 0, 1);
            if (i < 0 && sorted) i = approx(key, keys, false);
            if (i < 0) return na(name + " found no match for " + F.toStr(key));
            return vertical ? at(A, i, idx - 1) : at(A, idx - 1, i);
        }, { syntax: name + "(search_key, range, index, [is_sorted])" });
    }
    vhlookup("VLOOKUP", true);
    vhlookup("HLOOKUP", false);

    def("MATCH", 2, 3, function (a, E) {
        var key = E.val(a[0]);
        if (isErr(key)) return key;
        var A = E.arr(a[1]);
        if (isErr(A)) return A;
        var values = vector(A);
        if (!values) return na("MATCH needs a single row or column");
        var type = E.int(a[2], 1);
        if (isErr(type)) return type;
        var i;
        if (type === 0) i = find(key, values, isWild(key) ? 2 : 0, 1);
        else i = approx(key, values, type < 0);
        return i < 0 ? na("MATCH found no match for " + F.toStr(key)) : i + 1;
    }, { syntax: "MATCH(search_key, range, [search_type])" });

    function xfind(E, a, keyNode, arrNode, modeNode, searchNode) {
        var key = E.val(keyNode);
        if (isErr(key)) return key;
        var A = E.arr(arrNode);
        if (isErr(A)) return A;
        var values = vector(A);
        if (!values) return new FErr(ERR.VALUE, "The lookup range must be a single row or column");
        var mode = E.int(modeNode, 0), search = E.int(searchNode, 1);
        if (isErr(mode)) return mode;
        if (isErr(search)) return search;
        if ([0, -1, 1, 2].indexOf(mode) < 0) return new FErr(ERR.VALUE, "match_mode must be 0, -1, 1 or 2");
        if ([1, -1, 2, -2].indexOf(search) < 0) return new FErr(ERR.VALUE, "search_mode must be 1, -1, 2 or -2");
        return { A: A, index: find(key, values, mode, search < 0 ? -1 : 1), key: key };
    }
    def("XMATCH", 2, 4, function (a, E) {
        var r = xfind(E, a, a[0], a[1], a[2], a[3]);
        if (isErr(r)) return r;
        return r.index < 0 ? na("XMATCH found no match for " + F.toStr(r.key)) : r.index + 1;
    }, { syntax: "XMATCH(search_key, lookup_range, [match_mode], [search_mode])" });
    def("XLOOKUP", 3, 6, function (a, E) {
        var r = xfind(E, a, a[0], a[1], a[4], a[5]);
        if (isErr(r)) return r;
        var R = E.arr(a[2]);
        if (isErr(R)) return R;
        var vertical = r.A.cols === 1 && r.A.rows > 1 || (r.A.rows === 1 && r.A.cols === 1 && R.cols === 1);
        if (vertical ? R.rows !== r.A.rows : R.cols !== r.A.cols) {
            return new FErr(ERR.VALUE, "XLOOKUP lookup and result ranges must be the same length");
        }
        if (r.index < 0) {
            if (!E.missing(a[3])) return E.val(a[3]);
            return na("XLOOKUP found no match for " + F.toStr(r.key));
        }
        return vertical ? row(R, r.index) : col(R, r.index);
    }, {
        // a column lookup with a wide result (or a row lookup with a tall
        // one) answers with a whole row / column
        array: function (args) {
            var l = args[1], r = args[2];
            if (!r || r.t === "arrlit" || r.t === "name" || r.t === "rangeop" || r.t === "call") return !!r && r.t !== "arrlit";
            if (r.t !== "range" || !l || l.t !== "range") return false;
            return (span(l, false) === 1 && span(r, false) > 1) || (span(l, true) === 1 && span(r, true) > 1);
        },
        syntax: "XLOOKUP(search_key, lookup_range, result_range, [missing_value], [match_mode], [search_mode])"
    });

    def("LOOKUP", 2, 3, function (a, E) {
        var key = E.val(a[0]);
        if (isErr(key)) return key;
        var A = E.arr(a[1]);
        if (isErr(A)) return A;
        var keys, results;
        if (!E.missing(a[2])) {
            keys = vector(A);
            var R = E.arr(a[2]);
            if (isErr(R)) return R;
            results = vector(R);
            if (!keys || !results) return na("LOOKUP ranges must be a single row or column");
        } else if (A.cols > A.rows) {
            keys = row(A, 0).data; results = row(A, A.rows - 1).data;
        } else {
            keys = col(A, 0).data; results = col(A, A.cols - 1).data;
        }
        var i = find(key, keys, 0, 1);
        if (i < 0) i = approx(key, keys, false);
        if (i < 0 || i >= results.length) return na("LOOKUP found no match for " + F.toStr(key));
        return results[i];
    }, { syntax: "LOOKUP(search_key, search_range|search_result_array, [result_range])" });

    def("INDEX", 1, 4, function (a, E) {
        var ref = E.ref(a[0]);
        var A = E.arr(a[0]);
        if (isErr(A)) return A;
        var r = E.int(a[1], 0), c = E.int(a[2], 0);
        if (isErr(r)) return r;
        if (isErr(c)) return c;
        if (r < 0 || c < 0) return new FErr(ERR.VALUE, "INDEX row and column cannot be negative");
        // a single row indexed by one number picks a column
        if (A.rows === 1 && E.missing(a[2]) && r > 0 && A.cols > 1) { c = r; r = 1; }
        if (r > A.rows || c > A.cols) return new FErr(ERR.REF, "INDEX is outside the range");
        /* Over cells, INDEX answers with a reference: it reads as its value
           in a formula, and A1:INDEX(B1:B9,3) can build a range from it. */
        if (ref) {
            var c1 = c > 0 ? ref.c1 + c - 1 : ref.c1, c2 = c > 0 ? ref.c1 + c - 1 : ref.c2;
            var r1 = r > 0 ? ref.r1 + r - 1 : ref.r1, r2 = r > 0 ? ref.r1 + r - 1 : ref.r2;
            return E.makeRef(ref.sheet, c1, r1, c2, r2);
        }
        if (r > 0 && c > 0) return at(A, r - 1, c - 1);
        if (r > 0) return A.cols === 1 ? at(A, r - 1, 0) : row(A, r - 1);
        if (c > 0) return A.rows === 1 ? at(A, 0, c - 1) : col(A, c - 1);
        return A;
    }, {
        // INDEX(A1:C9, 0, 2) or INDEX(A1:C9, 2) on a 2-D range: a whole column / row
        array: function (args) {
            var zero = function (n) { return !n || n.t === "empty" || (n.t === "num" && n.v === 0); };
            if (!multi(args[0]) && !(args[0] && args[0].t === "arrlit")) return false;
            return zero(args[1]) || zero(args[2]) || args[1].t !== "num";
        },
        syntax: "INDEX(reference, [row], [column])"
    });

    function rowCol(name, isRow) {
        def(name, 0, 1, function (a, E, arrayCtx) {
            if (E.missing(a[0])) {
                if (!E.self) return na(name + "() needs a cell");
                return (isRow ? E.self.row : E.self.col) + 1;
            }
            var ref = E.ref(a[0]);
            if (!ref) return new FErr(ERR.VALUE, name + " needs a cell reference");
            var b = { c1: ref.c1, r1: ref.r1, c2: ref.c2, r2: ref.r2 };
            var first = (isRow ? b.r1 : b.c1) + 1, count = isRow ? b.r2 - b.r1 + 1 : b.c2 - b.c1 + 1;
            if (!arrayCtx || count === 1) return first;
            var out = [];
            for (var i = 0; i < count; i++) out.push(first + i);
            return isRow ? new Arr(count, 1, out) : new Arr(1, count, out);
        }, {
            // ROW(A1:A9) spills the row numbers
            array: function (args) {
                var n = args[0];
                if (!n) return false;
                if (n.t === "name" || n.t === "rangeop") return true;
                return n.t === "range" && span(n, isRow) > 1;
            },
            syntax: name + "([cell_reference])"
        });
    }
    rowCol("ROW", true);
    rowCol("COLUMN", false);
    function size(name, isRows) {
        def(name, 1, 1, function (a, E) {
            var ref = E.ref(a[0]);
            if (ref) return isRows ? ref.r2 - ref.r1 + 1 : ref.c2 - ref.c1 + 1;
            var A = E.arr(a[0]);
            if (isErr(A)) return A;
            return isRows ? A.rows : A.cols;
        }, { syntax: name + "(range)" });
    }
    size("ROWS", true);
    size("COLUMNS", false);
})(typeof module !== "undefined" && module.exports ? require("./formula.js") : SheetFormula);
