/*
    ArozOS Office Sheets - dynamic array functions
    ==============================================
    Registers into the formula engine (formula.js); load after it.
    These return arrays that spill into the cells to the right and below
    (see createCalculator in formula.js).

        filtering   FILTER SORT SORTN UNIQUE
        generating  SEQUENCE RANDARRAY SPLIT TEXTSPLIT
        reshaping   TRANSPOSE FLATTEN TOCOL TOROW HSTACK VSTACK CHOOSECOLS
                    CHOOSEROWS WRAPCOLS WRAPROWS ARRAY_CONSTRAIN TAKE DROP
                    EXPAND ARRAYFORMULA SINGLE
        matrices    MMULT MINVERSE MDETERM MUNIT
        statistics  FREQUENCY MODE.MULT LINEST LOGEST TREND GROWTH
*/
(function (F) {
    "use strict";
    var ERR = F.ERR, FErr = F.FErr, isErr = F.isErr, isArr = F.isArr, Arr = F.Arr;

    function def(name, min, max, fn, extra) {
        var spec = { min: min, max: max, fn: fn, cat: "Array", array: true };
        for (var k in extra || {}) spec[k] = extra[k];
        F.defineFunction(name, spec);
    }
    function valueErr(msg) { return new FErr(ERR.VALUE, msg); }
    function numErr(msg) { return new FErr(ERR.NUM, msg); }
    function na(msg) { return new FErr(ERR.NA, msg); }
    function at(A, r, c) { return A.data[r * A.cols + c]; }
    function make(rows, cols, fill) {
        var d = new Array(rows * cols);
        for (var i = 0; i < d.length; i++) d[i] = typeof fill === "function" ? fill(Math.floor(i / cols), i % cols) : fill;
        return new Arr(rows, cols, d);
    }
    function rowsOf(A) {
        var out = [];
        for (var r = 0; r < A.rows; r++) out.push(A.data.slice(r * A.cols, (r + 1) * A.cols));
        return out;
    }
    function fromRows(rows, cols) {
        var d = [];
        rows.forEach(function (row) { for (var c = 0; c < cols; c++) d.push(row[c] === undefined ? null : row[c]); });
        return new Arr(rows.length, cols, d);
    }
    function transpose(A) { return make(A.cols, A.rows, function (r, c) { return at(A, c, r); }); }
    function empty(msg) { return new FErr(ERR.CALC, msg); }
    // an argument as an array (errors pass through)
    function arr(E, node) { return E.arr(node); }

    /* ---------- ARRAYFORMULA / SINGLE ---------- */
    def("ARRAYFORMULA", 1, 1, function (a, E) {
        var v = E.evA(a[0]);
        return F.isRefValue(v) ? E.refArr(v) : v;
    }, { cat: "Google", syntax: "ARRAYFORMULA(array_formula)" });
    def("SINGLE", 1, 1, function (a, E) { return E.implicit(a[0]); },
        { array: false, cat: "Lookup", syntax: "SINGLE(value)" });

    /* ---------- FILTER ---------- */
    /*
        FILTER(range, condition1, [condition2, ...])   (Google Sheets)
        FILTER(array, include, [if_empty])              (Excel)
        A condition is a column of TRUE/FALSE with one entry per row (keeps
        rows) or a row with one entry per column (keeps columns). A trailing
        single value that is not such a condition is Excel's if_empty.
    */
    def("FILTER", 2, -1, function (a, E) {
        var A = arr(E, a[0]);
        if (isErr(A)) return A;
        var rowKeep = null, colKeep = null, ifEmpty, hasIfEmpty = false, i, k;
        for (i = 1; i < a.length; i++) {
            var C = arr(E, a[i]);
            if (isErr(C)) return C;
            var byRow = C.cols === 1 && C.rows === A.rows && A.rows > 1;
            var byCol = C.rows === 1 && C.cols === A.cols && A.cols > 1;
            if (!byRow && !byCol && A.rows === 1 && A.cols === 1 && C.data.length === 1 && i === 1) byRow = true;
            if (!byRow && !byCol) {
                if (i === a.length - 1 && i >= 2 && C.data.length === 1) { ifEmpty = C.data[0]; hasIfEmpty = true; continue; }
                return valueErr("FILTER conditions must match the rows or the columns of the range");
            }
            var keep = byRow ? (rowKeep = rowKeep || make(A.rows, 1, true).data) : (colKeep = colKeep || make(1, A.cols, true).data);
            for (k = 0; k < C.data.length; k++) {
                var cv = C.data[k];
                if (isErr(cv)) return cv;
                var b = cv === null || cv === "" ? false : F.boolify(cv);
                if (isErr(b)) b = false;
                keep[k] = keep[k] && b;
            }
        }
        var outRows = [];
        for (var r = 0; r < A.rows; r++) {
            if (rowKeep && !rowKeep[r]) continue;
            var row = [];
            for (var c = 0; c < A.cols; c++) {
                if (colKeep && !colKeep[c]) continue;
                row.push(at(A, r, c));
            }
            if (row.length) outRows.push(row);
        }
        if (!outRows.length || !outRows[0].length) {
            if (hasIfEmpty) return ifEmpty;
            return empty("FILTER found no matches");
        }
        return fromRows(outRows, outRows[0].length);
    }, { cat: "Filter", syntax: "FILTER(range, condition1, [condition2, ...])" });

    /* ---------- SORT / SORTN ---------- */
    // blanks sort last whatever the direction, like the spreadsheet apps
    function cmpValues(x, y) {
        var xb = x === null || x === undefined || x === "", yb = y === null || y === undefined || y === "";
        if (xb || yb) return xb === yb ? 0 : (xb ? 2 : -2);
        var d = F.order(x, y);
        return isErr(d) ? 0 : d;
    }
    // [{index, ascending}] or [{values, ascending}] sort keys from the arguments
    function sortKeys(E, a, from, A, byCol) {
        var keys = [];
        for (var i = from; i < a.length; i += 2) {
            if (E.missing(a[i])) continue;
            var ascV = E.missing(a[i + 1]) ? true : E.val(a[i + 1]);
            if (isErr(ascV)) return ascV;
            var asc = typeof ascV === "boolean" ? ascV : F.toNum(ascV) !== -1;
            var kv = E.arr(a[i]);
            if (isErr(kv)) return kv;
            if (kv.data.length === 1 && typeof kv.data[0] === "number") {
                var idx = Math.trunc(kv.data[0]);
                if (idx < 1 || idx > (byCol ? A.rows : A.cols)) return valueErr("Sort column " + idx + " is outside the range");
                keys.push({ index: idx - 1, asc: asc });
            } else {
                if (kv.data.length !== (byCol ? A.cols : A.rows)) return valueErr("A sort range must be as long as the data");
                keys.push({ values: kv.data, asc: asc });
            }
        }
        if (!keys.length) keys.push({ index: 0, asc: true });
        return keys;
    }
    function sortedRows(A, keys) {
        var rows = rowsOf(A).map(function (row, i) { return { row: row, i: i }; });
        rows.sort(function (p, q) {
            for (var k = 0; k < keys.length; k++) {
                var key = keys[k];
                var x = key.values ? key.values[p.i] : p.row[key.index];
                var y = key.values ? key.values[q.i] : q.row[key.index];
                var d = cmpValues(x, y);
                if (Math.abs(d) === 2) return d / 2;            // blanks last
                if (d) return key.asc ? d : -d;
            }
            return p.i - q.i;                                   // stable
        });
        return rows;
    }
    def("SORT", 1, -1, function (a, E) {
        var A = arr(E, a[0]);
        if (isErr(A)) return A;
        // Excel: SORT(array, [sort_index], [sort_order], [by_col])
        var byCol = false;
        if (a.length === 4) {
            var bc = E.val(a[3]);
            if (typeof bc === "boolean") byCol = bc;
        }
        var src = byCol ? transpose(A) : A;
        var keyArgs = byCol ? a.slice(0, 3) : a;
        var keys = sortKeys(E, keyArgs, 1, A, false);
        if (isErr(keys)) return keys;
        var out = fromRows(sortedRows(src, keys).map(function (x) { return x.row; }), src.cols);
        return byCol ? transpose(out) : out;
    }, { cat: "Filter", syntax: "SORT(range, sort_column, is_ascending, [sort_column2, is_ascending2, ...])" });
    def("SORTN", 1, -1, function (a, E) {
        var A = arr(E, a[0]);
        if (isErr(A)) return A;
        var n = E.int(a[1], 1), mode = E.int(a[2], 0);
        if (isErr(n)) return n;
        if (isErr(mode)) return mode;
        if (n < 0 || mode < 0 || mode > 3) return valueErr("SORTN n or ties mode is out of range");
        var keys = sortKeys(E, a, 3, A, false);
        if (isErr(keys)) return keys;
        var rows = sortedRows(A, keys);
        var keyOf = function (x) {
            return JSON.stringify(keys.map(function (k) {
                var v = k.values ? k.values[x.i] : x.row[k.index];
                return typeof v === "string" ? v.toLowerCase() : v;
            }));
        };
        var out = [];
        if (mode === 0) out = rows.slice(0, n);
        else if (mode === 1) {
            out = rows.slice(0, n);
            if (out.length === n && n > 0) {
                var last = keyOf(out[n - 1]);
                for (var i = n; i < rows.length && keyOf(rows[i]) === last; i++) out.push(rows[i]);
            }
        } else {
            var seen = {}, distinct = 0;
            for (var j = 0; j < rows.length; j++) {
                var key = keyOf(rows[j]);
                if (!seen[key]) {
                    if (distinct >= n) break;
                    seen[key] = true;
                    distinct++;
                    out.push(rows[j]);
                } else if (mode === 3) out.push(rows[j]);
            }
        }
        if (!out.length) return empty("SORTN returned no rows");
        return fromRows(out.map(function (x) { return x.row; }), A.cols);
    }, { cat: "Filter", syntax: "SORTN(range, [n], [display_ties_mode], [sort_column1, is_ascending1], ...)" });

    def("UNIQUE", 1, 3, function (a, E) {
        var A = arr(E, a[0]);
        if (isErr(A)) return A;
        var byCol = E.bool(a[1], false), once = E.bool(a[2], false);
        if (isErr(byCol)) return byCol;
        if (isErr(once)) return once;
        var src = byCol ? transpose(A) : A;
        var counts = {}, order = [];
        rowsOf(src).forEach(function (row) {
            var key = JSON.stringify(row.map(function (v) {
                if (isErr(v)) return "#" + v.code;
                return typeof v === "string" ? "s:" + v.toLowerCase() : v;
            }));
            if (!counts[key]) { counts[key] = { n: 0, row: row }; order.push(key); }
            counts[key].n++;
        });
        var rows = order.filter(function (k) { return !once || counts[k].n === 1; })
            .map(function (k) { return counts[k].row; });
        if (!rows.length) return empty("UNIQUE found no values");
        var out = fromRows(rows, src.cols);
        return byCol ? transpose(out) : out;
    }, { cat: "Filter", syntax: "UNIQUE(range, [by_column], [exactly_once])" });

    /* ---------- generating ---------- */
    def("SEQUENCE", 1, 4, function (a, E) {
        var rows = E.int(a[0]), cols = E.int(a[1], 1), start = E.num(a[2], 1), step = E.num(a[3], 1);
        var bad = [rows, cols, start, step].filter(isErr)[0];
        if (bad) return bad;
        if (rows < 1 || cols < 1) return valueErr("SEQUENCE needs at least one row and column");
        return make(rows, cols, function (r, c) { return start + (r * cols + c) * step; });
    }, { cat: "Math", syntax: "SEQUENCE(rows, [columns], [start], [step])" });
    def("RANDARRAY", 0, 5, function (a, E) {
        var rows = E.int(a[0], 1), cols = E.int(a[1], 1), lo = E.num(a[2], 0), hi = E.num(a[3], 1);
        var whole = E.bool(a[4], false);
        var bad = [rows, cols, lo, hi, whole].filter(isErr)[0];
        if (bad) return bad;
        if (rows < 1 || cols < 1 || lo > hi) return valueErr("RANDARRAY arguments are out of range");
        return make(rows, cols, function () {
            if (whole) return Math.ceil(lo) + Math.floor(Math.random() * (Math.floor(hi) - Math.ceil(lo) + 1));
            return lo + Math.random() * (hi - lo);
        });
    }, { cat: "Math", volatile: true, syntax: "RANDARRAY(rows, columns)" });

    function splitText(text, delims, eachChar, removeEmpty) {
        var parts;
        if (!delims.length) parts = [text];
        else if (eachChar) {
            var chars = {};
            delims.join("").split("").forEach(function (ch) { chars[ch] = true; });
            parts = [""];
            text.split("").forEach(function (ch) {
                if (chars[ch]) parts.push("");
                else parts[parts.length - 1] += ch;
            });
        } else {
            parts = [text];
            delims.forEach(function (d) {
                if (!d) return;
                var next = [];
                parts.forEach(function (p) { next = next.concat(p.split(d)); });
                parts = next;
            });
        }
        return removeEmpty ? parts.filter(function (p) { return p !== ""; }) : parts;
    }
    function numberish(s) {
        var n = F.coerceNumber(s);
        return n !== null && /^\s*[+-]?[\d.]/.test(s) ? n : s;
    }
    def("SPLIT", 2, 4, function (a, E) {
        var T = arr(E, a[0]);
        if (isErr(T)) return T;
        var d = E.str(a[1]);
        if (isErr(d)) return d;
        var each = E.bool(a[2], true), rm = E.bool(a[3], true);
        if (isErr(each)) return each;
        if (isErr(rm)) return rm;
        var rows = T.data.map(function (v) {
            if (isErr(v)) return [v];
            return splitText(F.toStr(v), [d], each, rm).map(numberish);
        });
        var width = Math.max.apply(null, rows.map(function (r) { return r.length; }).concat([1]));
        return fromRows(rows, width);
    }, { cat: "Text", syntax: "SPLIT(text, delimiter, [split_by_each], [remove_empty_text])" });
    def("TEXTSPLIT", 2, 6, function (a, E) {
        var text = E.str(a[0]);
        if (isErr(text)) return text;
        var colD = E.flat(a[1]);
        if (isErr(colD)) return colD;
        var rowD = E.missing(a[2]) ? [] : E.flat(a[2]);
        if (isErr(rowD)) return rowD;
        var ignore = E.bool(a[3], false), mode = E.int(a[4], 0);
        if (isErr(ignore)) return ignore;
        if (isErr(mode)) return mode;
        var pad = E.missing(a[5]) ? na("TEXTSPLIT padding") : E.val(a[5]);
        var norm = function (list) { return list.map(F.toStr).filter(function (s) { return s !== ""; }); };
        colD = norm(colD); rowD = norm(rowD);
        // split with case-insensitive matching but keep original text
        var splitKeep = function (s, delims) {
            if (!delims.length) return [s];
            var low = mode ? s.toLowerCase() : s, out = [], last = 0, i = 0;
            var ds = delims.map(function (d) { return mode ? d.toLowerCase() : d; });
            while (i <= low.length) {
                var hit = null;
                for (var k = 0; k < ds.length; k++) if (low.substr(i, ds[k].length) === ds[k]) { hit = ds[k]; break; }
                if (hit) { out.push(s.slice(last, i)); i += hit.length; last = i; }
                else i++;
            }
            out.push(s.slice(last));
            return out;
        };
        var rows = splitKeep(text, rowD).map(function (line) {
            var cells = splitKeep(line, colD);
            return ignore ? cells.filter(function (c) { return c !== ""; }) : cells;
        });
        if (ignore) rows = rows.filter(function (r) { return r.length; });
        var width = Math.max.apply(null, rows.map(function (r) { return r.length; }).concat([1]));
        return make(rows.length || 1, width, function (r, c) {
            var row = rows[r] || [];
            return c < row.length ? row[c] : pad;
        });
    }, { cat: "Text", syntax: "TEXTSPLIT(text, col_delimiter, [row_delimiter], [ignore_empty], [match_mode], [pad_with])" });

    /* ---------- reshaping ---------- */
    def("TRANSPOSE", 1, 1, function (a, E) {
        var A = arr(E, a[0]);
        return isErr(A) ? A : transpose(A);
    }, { cat: "Lookup", syntax: "TRANSPOSE(array_or_range)" });
    def("FLATTEN", 1, -1, function (a, E) {
        var out = [];
        for (var i = 0; i < a.length; i++) {
            var A = arr(E, a[i]);
            if (isErr(A)) return A;
            out = out.concat(A.data);
        }
        return new Arr(out.length, 1, out);
    }, { cat: "Array", syntax: "FLATTEN(range1, [range2, ...])" });
    function toVector(name, asCol) {
        def(name, 1, 3, function (a, E) {
            var A = arr(E, a[0]);
            if (isErr(A)) return A;
            var ignore = E.int(a[1], 0), byCol = E.bool(a[2], false);
            if (isErr(ignore)) return ignore;
            if (isErr(byCol)) return byCol;
            var src = byCol ? transpose(A) : A;
            var out = src.data.filter(function (v) {
                if ((ignore === 1 || ignore === 3) && (v === null || v === "")) return false;
                if ((ignore === 2 || ignore === 3) && isErr(v)) return false;
                return true;
            });
            if (!out.length) return empty(name + " has no values left");
            return asCol ? new Arr(out.length, 1, out) : new Arr(1, out.length, out);
        }, { syntax: name + "(array, [ignore], [scan_by_column])" });
    }
    toVector("TOCOL", true);
    toVector("TOROW", false);
    function stack(name, horizontal) {
        def(name, 1, -1, function (a, E) {
            var parts = [];
            for (var i = 0; i < a.length; i++) {
                var A = arr(E, a[i]);
                if (isErr(A)) return A;
                parts.push(A);
            }
            var pad = na(name + " padding");
            if (horizontal) {
                var rows = Math.max.apply(null, parts.map(function (p) { return p.rows; }));
                var cols = parts.reduce(function (n, p) { return n + p.cols; }, 0);
                var out = make(rows, cols, pad), off = 0;
                parts.forEach(function (p) {
                    for (var r = 0; r < p.rows; r++) for (var c = 0; c < p.cols; c++) out.data[r * cols + off + c] = at(p, r, c);
                    off += p.cols;
                });
                return out;
            }
            var width = Math.max.apply(null, parts.map(function (p) { return p.cols; }));
            var height = parts.reduce(function (n, p) { return n + p.rows; }, 0);
            var res = make(height, width, pad), top = 0;
            parts.forEach(function (p) {
                for (var r = 0; r < p.rows; r++) for (var c = 0; c < p.cols; c++) res.data[(top + r) * width + c] = at(p, r, c);
                top += p.rows;
            });
            return res;
        }, { syntax: name + "(array1, [array2, ...])" });
    }
    stack("HSTACK", true);
    stack("VSTACK", false);
    function choose(name, cols) {
        def(name, 2, -1, function (a, E) {
            var A = arr(E, a[0]);
            if (isErr(A)) return A;
            var size = cols ? A.cols : A.rows, picks = [];
            for (var i = 1; i < a.length; i++) {
                var list = E.flat(a[i]);
                if (isErr(list)) return list;
                for (var k = 0; k < list.length; k++) {
                    var n = Math.trunc(F.toNum(list[k]));
                    if (isNaN(n) || n === 0 || Math.abs(n) > size) return valueErr(name + " index " + list[k] + " is out of range");
                    picks.push(n > 0 ? n - 1 : size + n);
                }
            }
            return cols ? make(A.rows, picks.length, function (r, c) { return at(A, r, picks[c]); }) :
                make(picks.length, A.cols, function (r, c) { return at(A, picks[r], c); });
        }, { syntax: name + "(array, " + (cols ? "col_num1" : "row_num1") + ", ...)" });
    }
    choose("CHOOSECOLS", true);
    choose("CHOOSEROWS", false);
    function wrap(name, byRows) {
        def(name, 2, 3, function (a, E) {
            var V = arr(E, a[0]);
            if (isErr(V)) return V;
            if (V.rows !== 1 && V.cols !== 1) return valueErr(name + " needs a single row or column");
            var n = E.int(a[1]);
            if (isErr(n)) return n;
            if (n < 1) return numErr(name + " count must be at least 1");
            var pad = E.missing(a[2]) ? na(name + " padding") : E.val(a[2]);
            var lines = Math.ceil(V.data.length / n);
            var get = function (i) { return i < V.data.length ? V.data[i] : pad; };
            return byRows ? make(lines, n, function (r, c) { return get(r * n + c); }) :
                make(n, lines, function (r, c) { return get(c * n + r); });
        }, { syntax: name + "(range, wrap_count, [pad_with])" });
    }
    wrap("WRAPROWS", true);
    wrap("WRAPCOLS", false);
    def("ARRAY_CONSTRAIN", 3, 3, function (a, E) {
        var A = arr(E, a[0]);
        if (isErr(A)) return A;
        var r = E.int(a[1]), c = E.int(a[2]);
        if (isErr(r)) return r;
        if (isErr(c)) return c;
        if (r < 1 || c < 1) return valueErr("ARRAY_CONSTRAIN needs at least one row and column");
        r = Math.min(r, A.rows); c = Math.min(c, A.cols);
        return make(r, c, function (i, j) { return at(A, i, j); });
    }, { syntax: "ARRAY_CONSTRAIN(input_range, num_rows, num_cols)" });
    // TAKE / DROP: positive counts from the start, negative from the end
    function takeDrop(name, take) {
        def(name, 2, 3, function (a, E) {
            var A = arr(E, a[0]);
            if (isErr(A)) return A;
            var rn = E.missing(a[1]) ? null : E.int(a[1]), cn = E.missing(a[2]) ? null : E.int(a[2]);
            if (isErr(rn)) return rn;
            if (isErr(cn)) return cn;
            var span = function (n, size) {
                if (n === null) return [0, size];
                if (take) return n >= 0 ? [0, Math.min(n, size)] : [Math.max(0, size + n), size];
                return n >= 0 ? [Math.min(n, size), size] : [0, Math.max(0, size + n)];
            };
            var rs = span(rn, A.rows), cs = span(cn, A.cols);
            if (rs[1] <= rs[0] || cs[1] <= cs[0]) return empty(name + " left nothing");
            return make(rs[1] - rs[0], cs[1] - cs[0], function (r, c) { return at(A, rs[0] + r, cs[0] + c); });
        }, { syntax: name + "(array, rows, [columns])" });
    }
    takeDrop("TAKE", true);
    takeDrop("DROP", false);
    def("EXPAND", 2, 4, function (a, E) {
        var A = arr(E, a[0]);
        if (isErr(A)) return A;
        var r = E.missing(a[1]) ? A.rows : E.int(a[1]), c = E.missing(a[2]) ? A.cols : E.int(a[2]);
        if (isErr(r)) return r;
        if (isErr(c)) return c;
        if (r < A.rows || c < A.cols) return valueErr("EXPAND cannot make the array smaller");
        var pad = E.missing(a[3]) ? na("EXPAND padding") : E.val(a[3]);
        return make(r, c, function (i, j) { return i < A.rows && j < A.cols ? at(A, i, j) : pad; });
    }, { syntax: "EXPAND(array, rows, [columns], [pad_with])" });

    /* ---------- matrices ---------- */
    function numbers(A, name) {
        for (var i = 0; i < A.data.length; i++) {
            if (isErr(A.data[i])) return A.data[i];
            if (typeof A.data[i] !== "number") return valueErr(name + " needs numbers only");
        }
        return A;
    }
    function square(E, node, name) {
        var A = arr(E, node);
        if (isErr(A)) return A;
        if (A.rows !== A.cols) return valueErr(name + " needs a square matrix");
        return numbers(A, name);
    }
    // Gaussian elimination with partial pivoting: {det, inverse or null}
    function eliminate(A) {
        var n = A.rows, m = [], i, j, k;
        for (i = 0; i < n; i++) {
            m.push([]);
            for (j = 0; j < n; j++) m[i].push(at(A, i, j));
            for (j = 0; j < n; j++) m[i].push(i === j ? 1 : 0);
        }
        var det = 1;
        for (i = 0; i < n; i++) {
            var piv = i;
            for (k = i + 1; k < n; k++) if (Math.abs(m[k][i]) > Math.abs(m[piv][i])) piv = k;
            if (Math.abs(m[piv][i]) < 1e-14) return { det: 0, inv: null };
            if (piv !== i) { var t = m[piv]; m[piv] = m[i]; m[i] = t; det = -det; }
            var p = m[i][i];
            det *= p;
            for (j = 0; j < 2 * n; j++) m[i][j] /= p;
            for (k = 0; k < n; k++) {
                if (k === i) continue;
                var f = m[k][i];
                if (!f) continue;
                for (j = 0; j < 2 * n; j++) m[k][j] -= f * m[i][j];
            }
        }
        return { det: det, inv: make(n, n, function (r, c) { return m[r][n + c]; }) };
    }
    function multiply(A, B) {
        return make(A.rows, B.cols, function (r, c) {
            var s = 0;
            for (var k = 0; k < A.cols; k++) s += at(A, r, k) * at(B, k, c);
            return s;
        });
    }
    def("MMULT", 2, 2, function (a, E) {
        var A = arr(E, a[0]), B = arr(E, a[1]);
        if (isErr(A)) return A;
        if (isErr(B)) return B;
        if (isErr(numbers(A, "MMULT"))) return numbers(A, "MMULT");
        if (isErr(numbers(B, "MMULT"))) return numbers(B, "MMULT");
        if (A.cols !== B.rows) return valueErr("MMULT needs columns of the first to match rows of the second");
        return multiply(A, B);
    }, { cat: "Math", syntax: "MMULT(matrix1, matrix2)" });
    def("MINVERSE", 1, 1, function (a, E) {
        var A = square(E, a[0], "MINVERSE");
        if (isErr(A)) return A;
        var res = eliminate(A);
        return res.inv || numErr("MINVERSE: the matrix cannot be inverted");
    }, { cat: "Math", syntax: "MINVERSE(square_matrix)" });
    def("MDETERM", 1, 1, function (a, E) {
        var A = square(E, a[0], "MDETERM");
        if (isErr(A)) return A;
        return +eliminate(A).det.toPrecision(15);
    }, { array: false, cat: "Math", syntax: "MDETERM(square_matrix)" });
    def("MUNIT", 1, 1, function (a, E) {
        var n = E.int(a[0]);
        if (isErr(n)) return n;
        if (n < 1) return valueErr("MUNIT size must be at least 1");
        return make(n, n, function (r, c) { return r === c ? 1 : 0; });
    }, { cat: "Math", syntax: "MUNIT(dimension)" });

    /* ---------- statistics that return arrays ---------- */
    def("FREQUENCY", 2, 2, function (a, E) {
        var data = E.numbers([a[0]], "count"), bins = E.numbers([a[1]], "count");
        if (data.err) return data.err;
        if (bins.err) return bins.err;
        var order = bins.nums.map(function (b, i) { return { b: b, i: i }; }).sort(function (p, q) { return p.b - q.b; });
        var counts = new Array(bins.nums.length + 1).fill(0);
        data.nums.forEach(function (x) {
            for (var k = 0; k < order.length; k++) {
                if (x <= order[k].b) { counts[order[k].i]++; return; }
            }
            counts[bins.nums.length]++;
        });
        return new Arr(counts.length, 1, counts);
    }, { cat: "Statistical", syntax: "FREQUENCY(data, classes)" });
    def("MODE.MULT", 1, -1, function (a, E) {
        var st = E.numbers(a, "sum");
        if (st.err) return st.err;
        var counts = new Map(), first = [];
        st.nums.forEach(function (x) {
            if (!counts.has(x)) first.push(x);
            counts.set(x, (counts.get(x) || 0) + 1);
        });
        var best = 1;
        counts.forEach(function (n) { if (n > best) best = n; });
        if (best < 2) return na("No value repeats");
        var modes = first.filter(function (x) { return counts.get(x) === best; });
        return new Arr(modes.length, 1, modes);
    }, { cat: "Statistical", syntax: "MODE.MULT(value1, [value2, ...])" });

    /*
        Least-squares fit y = b + m1*x1 + ... (LINEST / TREND), and the same on
        ln(y) for the exponential y = b * m1^x1 ... (LOGEST / GROWTH).
        Returns {coef: [b, m1..mk], X, y, n, k, withConst} or an error.
    */
    function regression(E, yNode, xNode, constNode, logY) {
        var Y = arr(E, yNode);
        if (isErr(Y)) return Y;
        if (isErr(numbers(Y, "Regression"))) return numbers(Y, "Regression");
        var ys = Y.data.slice();
        if (logY) {
            for (var i = 0; i < ys.length; i++) {
                if (ys[i] <= 0) return numErr("Exponential fits need positive y values");
                ys[i] = Math.log(ys[i]);
            }
        }
        var n = ys.length, X;
        if (E.missing(xNode)) X = make(n, 1, function (r) { return r + 1; });
        else {
            X = arr(E, xNode);
            if (isErr(X)) return X;
            if (isErr(numbers(X, "Regression"))) return numbers(X, "Regression");
            // one column per variable: x values laid out like y, or as columns
            if (Y.cols === 1 && X.rows === n) { /* columns are variables */ }
            else if (Y.rows === 1 && X.cols === n) X = transpose(X);
            else if (X.data.length === n) X = new Arr(n, 1, X.data.slice());
            else return new FErr(ERR.REF, "known_x must have one row (or column) per y value");
        }
        var withConst = E.missing(constNode) ? true : E.bool(constNode, true);
        if (isErr(withConst)) return withConst;
        var k = X.cols, p = k + (withConst ? 1 : 0);
        if (n < p) return numErr("Not enough data points for the fit");
        // design matrix rows: [1?, x1..xk]
        var D = make(n, p, function (r, c) { return withConst ? (c === 0 ? 1 : at(X, r, c - 1)) : at(X, r, c); });
        var Dt = transpose(D);
        var inv = eliminate(multiply(Dt, D)).inv;
        if (!inv) return numErr("The x values are collinear");
        var beta = multiply(inv, multiply(Dt, new Arr(n, 1, ys))).data;
        var coef = withConst ? beta : [0].concat(beta);
        return { coef: coef, X: X, ys: ys, n: n, k: k, p: p, withConst: withConst, inv: inv, D: D };
    }
    function predict(fit, xRow) {
        var v = fit.coef[0];
        for (var j = 0; j < fit.k; j++) v += fit.coef[j + 1] * xRow[j];
        return v;
    }
    function linestLike(name, logY) {
        def(name, 1, 4, function (a, E) {
            var fit = regression(E, a[0], a[1], a[2], logY);
            if (isErr(fit)) return fit;
            var stats = E.bool(a[3], false);
            if (isErr(stats)) return stats;
            var k = fit.k, tr = function (v) { return logY ? Math.exp(v) : v; };
            // first row: m_k ... m_1, b
            var top = [];
            for (var j = k; j >= 1; j--) top.push(tr(fit.coef[j]));
            top.push(logY ? Math.exp(fit.coef[0]) : fit.coef[0]);
            if (!stats) return new Arr(1, k + 1, top);
            var n = fit.n, df = n - fit.p;
            var mean = 0;
            fit.ys.forEach(function (y) { mean += y; });
            mean /= n;
            var ssr = 0, sst = 0;
            for (var r = 0; r < n; r++) {
                var row = [];
                for (var c = 0; c < k; c++) row.push(at(fit.X, r, c));
                var e = fit.ys[r] - predict(fit, row);
                ssr += e * e;
                var dev = fit.withConst ? fit.ys[r] - mean : fit.ys[r];
                sst += dev * dev;
            }
            var ssreg = sst - ssr, sey = df > 0 ? Math.sqrt(ssr / df) : na("No degrees of freedom");
            var r2 = sst ? ssreg / sst : 1;
            var se = [];
            for (j = 0; j < fit.p; j++) se.push(df > 0 ? Math.sqrt(at(fit.inv, j, j) * ssr / df) : na("No degrees of freedom"));
            var seRow = [];
            for (j = k; j >= 1; j--) seRow.push(se[fit.withConst ? j : j - 1]);
            seRow.push(fit.withConst ? se[0] : na("No constant"));
            var dfReg = fit.withConst ? fit.p - 1 : fit.p;
            var fstat = df > 0 && ssr > 0 ? (ssreg / dfReg) / (ssr / df) : numErr("F is undefined");
            var fill = na("LINEST statistics");
            var rows = [top, seRow, [r2, sey], [fstat, df], [ssreg, ssr]];
            return make(5, k + 1, function (r, c) {
                return c < rows[r].length ? rows[r][c] : fill;
            });
        }, { cat: "Statistical", syntax: name + "(known_data_y, [known_data_x], [calculate_b], [verbose])" });
    }
    linestLike("LINEST", false);
    linestLike("LOGEST", true);
    function trendLike(name, logY) {
        def(name, 1, 4, function (a, E) {
            var fit = regression(E, a[0], a[1], a[3], logY);
            if (isErr(fit)) return fit;
            var NX = E.missing(a[2]) ? fit.X : arr(E, a[2]);
            if (isErr(NX)) return NX;
            if (isErr(numbers(NX, name))) return numbers(NX, name);
            var byRows = NX.cols === fit.k, rows = byRows ? NX.rows : NX.cols;
            if (!byRows && NX.rows !== fit.k) {
                if (fit.k === 1) { byRows = true; rows = NX.data.length; NX = new Arr(rows, 1, NX.data.slice()); }
                else return new FErr(ERR.REF, "new_x must have one column per x variable");
            }
            var out = [];
            for (var r = 0; r < rows; r++) {
                var xr = [];
                for (var c = 0; c < fit.k; c++) xr.push(byRows ? at(NX, r, c) : at(NX, c, r));
                var v = predict(fit, xr);
                out.push(logY ? Math.exp(v) : v);
            }
            var shaped = E.missing(a[2]) ? arr(E, a[0]) : NX;
            if (shaped.data.length === out.length) return new Arr(shaped.rows, shaped.cols, out);
            return new Arr(out.length, 1, out);
        }, { cat: "Statistical", syntax: name + "(known_data_y, [known_data_x], [new_data_x], [b])" });
    }
    trendLike("TREND", false);
    trendLike("GROWTH", true);
})(typeof module !== "undefined" && module.exports ? require("./formula.js") : SheetFormula);
