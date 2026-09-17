/*
    ArozOS Office - Sheets: core grid application
    ==============================================================
    Body schema (what serialize() returns / deserialize() receives):

    {
        sheets: [
            {
                name: "Sheet1",
                color: "#hex" | null,            // tab color
                cols: 26, rows: 200,             // logical grid size
                cells: {                         // sparse, keyed "A1"
                    "A1": { v: "raw input ('=' prefix = formula)",
                            n: "cell note",      // optional; xlsx comment
                            cf: ["cf-a1b2"],     // conditional rules this
                                                 // cell carries (sheets_cf.js)
                            s: {                 // style, all optional
                                b,i,u: bool,
                                al: "l"|"c"|"r",
                                bg: "#hex", fc: "#hex",
                                fs: 13,          // font size px
                                fmt: "general"|"number"|"percent"|
                                     "currency"|"date"|"text",
                                dec: 2,          // decimals for number fmts
                                wrap: bool, bd: 1 // darker borders
                            } }
                },
                colW: { "3": 120 },              // by 0-based col index
                rowH: { "5": 40 },               // by 0-based row index
                merges: ["A1:B2", ...],
                freeze: { r: 0, c: 0 },          // frozen row/col COUNT
                filter: { range: "A1:D20",
                          excl: { "2": {"value": 1} } } | null,
                charts: [ { id, x, y, w, h,      // px in grid space
                            range: "A1:B5",
                            opts: { type: "bar"|"line"|"pie", title,
                                    headerRow: bool, labelCol: bool,
                                    stacked: bool } } ],
                pivot: { srcSheet: 0,            // only on generated pivot
                         range: "A1:C10",        // sheets (sheets_io.js);
                         rowField: 0,            // fields are 0-based col
                         colField: 1,            // offsets in range, -1=none
                         valField: 2,
                         agg: "sum"|"count"|"avg"|"min"|"max" },
                cfDefs: { "cf-a1b2": {           // conditional rule bodies;
                    anchor: "B2",                // cells reference them by id
                    type: "gt"|"contains"|"formula"|...,
                    v1, v2,                      // operands, as typed
                    style: { bg, fc, b, i, u } } }
            }
        ],
        active: 0
    }

    Formula engine: formula.js (SheetFormula). Charts/import/export/print:
    sheets_io.js (SheetsIO). Conditional formatting: sheets_cf.js (SheetsCF).
    Cross-sheet references are not supported yet.

    Cell styling has two layers: styleAt() is what the cell itself carries
    (what the toolbar edits and what gets saved), effStyleAt() adds whatever
    conditional rule currently matches. Paint and export read the second;
    anything that edits or reports formatting reads the first.
*/

var SheetsApp = (function () {
    "use strict";

    var F = SheetFormula;

    /* ================= constants ================= */
    var DEF_COLW = 92, DEF_ROWH = 24, HDR_W = 46, HDR_H = 24;
    var MAX_COLS = 512, MAX_ROWS = 10000;
    var GROW_COLS = 13, GROW_ROWS = 100;

    /* ================= state ================= */
    var body = null;
    var calc = null;              // SheetFormula calculator for active sheet
    var anchor = { c: 0, r: 0 };  // selection anchor
    var head = { c: 0, r: 0 };    // selection head (active cell = anchor)
    var selCols = null;           // full-column selection {c1,c2} or null
    var selRows = null;
    var editing = null;           // {c,r,viaFx} while cell editor open
    var undo = null;
    var zoomF = 1;
    var colX = [0], rowY = [0];   // prefix pixel offsets (geometry cache)
    var mergeAnchor = {};         // "A1" -> {c,r,cs,rs}
    var mergeCover = {};          // covered "B1" -> anchor key
    var hiddenRows = {};          // row index -> true (sheet.hiddenRows + filter)
    var clipInternal = null;      // {w,h,src:{c,r},cells:[[{v,s}|null]]}
    var clipTsv = "";             // what we last wrote to system clipboard
    var clipCut = false;
    var selChart = null;          // selected chart id (cell sel suspended)
    var drag = null;
    var rafPending = false, lastPointerEvt = null;
    var gridEl, cellsEl, spacerEl, colHeadIn, rowHeadIn, inputEl, rangeBoxEl, fillEl, spillBoxEl;
    var frozenRowsEl, frozenColsEl, frozenCornerEl;

    function esc(t) { return OfficeApp.escapeHtml(t); }
    function deep(o) { return JSON.parse(JSON.stringify(o)); }
    function snap() { return JSON.stringify(body); }
    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
    function sheet() { return body.sheets[body.active]; }
    function key(c, r) { return F.cellName(c, r); }

    /* ================= model ================= */
    function newSheetData(name) {
        return {
            name: name, color: null, cols: 26, rows: 200,
            cells: {}, colW: {}, rowH: {}, merges: [],
            freeze: { r: 0, c: 0 }, filter: null, charts: [], cfDefs: {},
            hiddenRows: []
        };
    }
    function defaultBody() {
        return { sheets: [newSheetData("Sheet1")], active: 0 };
    }
    function normalizeBody(b) {
        if (!b || typeof b !== "object") b = {};
        if (!Array.isArray(b.sheets) || b.sheets.length === 0) {
            b.sheets = [newSheetData("Sheet1")];
        }
        b.sheets.forEach(function (s, i) {
            s.name = s.name || ("Sheet" + (i + 1));
            s.color = s.color || null;
            s.cols = clamp(parseInt(s.cols, 10) || 26, 1, MAX_COLS);
            s.rows = clamp(parseInt(s.rows, 10) || 200, 1, MAX_ROWS);
            if (!s.cells || typeof s.cells !== "object") s.cells = {};
            s.colW = s.colW || {};
            s.rowH = s.rowH || {};
            s.merges = Array.isArray(s.merges) ? s.merges : [];
            s.freeze = s.freeze || { r: 0, c: 0 };
            s.freeze.r = clamp(parseInt(s.freeze.r, 10) || 0, 0, 20);
            s.freeze.c = clamp(parseInt(s.freeze.c, 10) || 0, 0, 10);
            s.filter = s.filter || null;
            s.charts = Array.isArray(s.charts) ? s.charts : [];
            s.cfDefs = (s.cfDefs && typeof s.cfDefs === "object") ? s.cfDefs : {};
            s.hiddenRows = cleanRowList(s.hiddenRows, s.rows);
        });
        /* Workbook defined names: [{name, formula, sheet}] where sheet is
           the index a sheet-local name belongs to (absent = global). */
        b.names = (Array.isArray(b.names) ? b.names : []).filter(function (n) {
            return n && validName(n.name) && typeof n.formula === "string" && n.formula !== "";
        }).map(function (n) {
            var out = { name: String(n.name), formula: String(n.formula) };
            if (n.sheet !== undefined && n.sheet !== null && n.sheet >= 0 && n.sheet < b.sheets.length) {
                out.sheet = parseInt(n.sheet, 10);
            }
            return out;
        });
        b.active = clamp(parseInt(b.active, 10) || 0, 0, b.sheets.length - 1);
        return b;
    }
    /* A usable name: letters, digits, underscores and dots, not starting
       with a digit, and not something the parser would read as a cell. */
    function validName(name) {
        name = String(name === undefined || name === null ? "" : name);
        return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) && !/^[A-Za-z]{1,3}[0-9]+$/.test(name) &&
            name.toUpperCase() !== "TRUE" && name.toUpperCase() !== "FALSE" &&
            !F.lookupFunction(name);
    }
    function nameEntry(name) {
        var want = String(name).toUpperCase();
        for (var i = 0; i < body.names.length; i++) {
            if (body.names[i].name.toUpperCase() === want) return body.names[i];
        }
        return null;
    }
    // sorted, de-duplicated 0-based row indices inside the sheet
    function cleanRowList(list, rows) {
        if (!Array.isArray(list)) return [];
        var seen = {}, out = [];
        list.forEach(function (v) {
            var r = parseInt(v, 10);
            if (isNaN(r) || r < 0 || r >= rows || seen[r]) return;
            seen[r] = true;
            out.push(r);
        });
        return out.sort(function (a, b) { return a - b; });
    }
    // a cell stays in the map while it still carries anything at all
    function cellIsBare(cell) {
        return !cell || (!cell.v && !cell.s && !cell.n &&
            !(cell.cf && cell.cf.length));
    }
    function cellObj(c, r, create) {
        var s = sheet(), k = key(c, r);
        var cell = s.cells[k];
        if (!cell && create) { cell = { v: "" }; s.cells[k] = cell; }
        return cell || null;
    }
    function rawAt(c, r) {
        var cell = sheet().cells[key(c, r)];
        return cell ? cell.v : "";
    }
    function styleAt(c, r) {
        var cell = sheet().cells[key(c, r)];
        return (cell && cell.s) ? cell.s : {};
    }
    /*
        What a cell actually looks like: its own style with any matching
        conditional-format rule layered on top. Painting and PDF export use
        this; everything that edits or reports the cell's OWN formatting
        (the toolbar, the Format menu, applyStyle) keeps using styleAt, so a
        rule never gets mistaken for something the user set by hand.
    */
    function effStyleAt(c, r) {
        var s = styleAt(c, r);
        var cf = window.SheetsCF ? SheetsCF.styleFor(c, r) : null;
        if (!cf) return s;
        var out = {}, k;
        for (k in s) if (Object.prototype.hasOwnProperty.call(s, k)) out[k] = s[k];
        for (k in cf) if (Object.prototype.hasOwnProperty.call(cf, k)) out[k] = cf[k];
        return out;
    }
    function setRaw(c, r, v) {
        var s = sheet(), k = key(c, r);
        if (v === "" || v === null || v === undefined) {
            var cell = s.cells[k];
            if (cell) {
                delete cell.v;
                cell.v = "";
                if (cellIsBare(cell)) delete s.cells[k];
            }
        } else {
            if (!s.cells[k]) s.cells[k] = { v: "" };
            s.cells[k].v = String(v);
        }
        growTo(c + 1, r + 1);
    }
    function growTo(cols, rows) {
        var s = sheet();
        var changed = false;
        while (s.cols < cols && s.cols < MAX_COLS) { s.cols = Math.min(MAX_COLS, s.cols + GROW_COLS); changed = true; }
        while (s.rows < rows && s.rows < MAX_ROWS) { s.rows = Math.min(MAX_ROWS, s.rows + GROW_ROWS); changed = true; }
        if (changed) rebuildGeometry();
    }
    function usedRange() {
        var s = sheet(), maxC = 0, maxR = 0, any = false;
        Object.keys(s.cells).forEach(function (k) {
            var cell = s.cells[k];
            if (!cell || (!cell.v && !cell.s)) return;
            var p = F.parseCellKey(k);
            if (!p) return;
            any = true;
            if (p.col > maxC) maxC = p.col;
            if (p.row > maxR) maxR = p.row;
        });
        return any ? { c1: 0, r1: 0, c2: maxC, r2: maxR } : { c1: 0, r1: 0, c2: 0, r2: 0 };
    }

    /* ================= merges ================= */
    function parseRange(str) {
        var parts = String(str).split(":");
        var a = F.parseCellKey(parts[0]);
        var b = parts[1] ? F.parseCellKey(parts[1]) : a;
        if (!a || !b) return null;
        return {
            c1: Math.min(a.col, b.col), r1: Math.min(a.row, b.row),
            c2: Math.max(a.col, b.col), r2: Math.max(a.row, b.row)
        };
    }
    function rangeStr(rg) {
        return key(rg.c1, rg.r1) + ":" + key(rg.c2, rg.r2);
    }
    function rebuildMerges() {
        mergeAnchor = {};
        mergeCover = {};
        sheet().merges.forEach(function (m) {
            var rg = parseRange(m);
            if (!rg || (rg.c1 === rg.c2 && rg.r1 === rg.r2)) return;
            var ak = key(rg.c1, rg.r1);
            mergeAnchor[ak] = { c: rg.c1, r: rg.r1, cs: rg.c2 - rg.c1 + 1, rs: rg.r2 - rg.r1 + 1 };
            for (var r = rg.r1; r <= rg.r2; r++) {
                for (var c = rg.c1; c <= rg.c2; c++) {
                    if (c === rg.c1 && r === rg.r1) continue;
                    mergeCover[key(c, r)] = ak;
                }
            }
        });
    }
    function mergeAt(c, r) {
        var ak = mergeCover[key(c, r)];
        if (ak) return mergeAnchor[ak];
        return mergeAnchor[key(c, r)] || null;
    }

    /* ================= hidden rows (user-hidden + filter) ================= */
    function rebuildFilter() {
        hiddenRows = {};
        sheet().hiddenRows.forEach(function (r) { hiddenRows[r] = true; });
        var f = sheet().filter;
        if (!f) return;
        var rg = parseRange(f.range);
        if (!rg) return;
        for (var r = rg.r1 + 1; r <= rg.r2; r++) {
            for (var c = rg.c1; c <= rg.c2; c++) {
                var ex = f.excl && f.excl[String(c)];
                if (!ex) continue;
                var txt = displayText(c, r);
                if (ex[txt]) { hiddenRows[r] = true; break; }
            }
        }
    }

    /* ================= geometry ================= */
    function colWidth(c) {
        var w = sheet().colW[String(c)];
        return Math.round((w !== undefined ? w : DEF_COLW) * zoomF);
    }
    function rowHeight(r) {
        if (hiddenRows[r]) return 0;
        var h = sheet().rowH[String(r)];
        return Math.round((h !== undefined ? h : DEF_ROWH) * zoomF);
    }
    function rebuildGeometry() {
        var s = sheet();
        colX = [0];
        for (var c = 0; c < s.cols; c++) colX.push(colX[c] + colWidth(c));
        rowY = [0];
        for (var r = 0; r < s.rows; r++) rowY.push(rowY[r] + rowHeight(r));
        if (spacerEl) {
            spacerEl.style.width = colX[s.cols] + "px";
            spacerEl.style.height = rowY[s.rows] + "px";
        }
    }
    function idxAt(arr, px) {
        var lo = 0, hi = arr.length - 2;
        if (px <= 0) return 0;
        while (lo < hi) {
            var mid = (lo + hi + 1) >> 1;
            if (arr[mid] <= px) lo = mid; else hi = mid - 1;
        }
        return lo;
    }
    function cellRect(c, r) {
        var m = mergeAt(c, r);
        if (m) { c = m.c; r = m.r; }
        var x = colX[c], y = rowY[r];
        var w = 0, h = 0, i;
        var cs = m ? m.cs : 1, rs = m ? m.rs : 1;
        for (i = 0; i < cs; i++) w += colWidth(c + i);
        for (i = 0; i < rs; i++) h += rowHeight(r + i);
        return { x: x, y: y, w: w, h: h, c: c, r: r };
    }

    /* ================= calculation & display ================= */
    /* One calculator for the whole workbook: values are memoized per sheet,
       so Sheet!A1 references resolve across tabs and switching tabs keeps
       everything already computed. */
    function rebuildCalc() {
        boundsCache = {};
        formulaCellsCache = {};
        calc = F.createCalculator(function (c, r, s) {
            var sh = body.sheets[s];
            var cell = sh && sh.cells[key(c, r)];
            return cell ? cell.v : "";
        }, {
            activeSheet: function () { return body.active; },
            sheetIndex: sheetIndexByName,
            sheetCount: function () { return body.sheets.length; },
            sheetName: function (i) { return body.sheets[i] ? body.sheets[i].name : ""; },
            definedName: function (name) {
                var e = nameEntry(name);
                return e ? { formula: e.formula, sheet: e.sheet } : undefined;
            },
            // used range of a sheet, for A:A / 2:5 / A2:A
            bounds: usedBounds,
            formulaCells: formulaCells,
            // SUBTOTAL: 1 = hidden by the user, 2 = hidden by a filter (the
            // filter map only exists for the active sheet)
            rowState: function (s, r) {
                var sh = body.sheets[s];
                if (!sh) return 0;
                if (sh.hiddenRows && sh.hiddenRows.indexOf(r) >= 0) return 1;
                return s === body.active && hiddenRows[r] ? 2 : 0;
            },
            // ISDATE: the cell's number format
            cellFormat: function (s, c, r) {
                var sh = body.sheets[s];
                var cell = sh && sh.cells[key(c, r)];
                return cell && cell.s ? cell.s.fmt : undefined;
            }
        });
    }
    /* The used range of a sheet as {rows, cols}, cached for the life of one
       calculator (whole-column ranges ask for it in every formula). */
    var boundsCache = {};
    var formulaCellsCache = {};
    // every formula cell of a sheet (spilled arrays look for their anchors)
    function formulaCells(si) {
        if (Object.prototype.hasOwnProperty.call(formulaCellsCache, si)) return formulaCellsCache[si];
        var out = [], sh = body.sheets[si];
        if (sh) {
            Object.keys(sh.cells).forEach(function (k) {
                var cell = sh.cells[k];
                if (!cell || typeof cell.v !== "string" || cell.v.charAt(0) !== "=") return;
                var p = F.parseCellKey(k);
                if (p) out.push({ col: p.col, row: p.row });
            });
        }
        formulaCellsCache[si] = out;
        return out;
    }
    function usedBounds(si) {
        if (Object.prototype.hasOwnProperty.call(boundsCache, si)) return boundsCache[si];
        var sh = body.sheets[si], rows = 0, cols = 0;
        if (sh) {
            Object.keys(sh.cells).forEach(function (k) {
                var cell = sh.cells[k];
                if (!cell || (!cell.v && !cell.s && !cell.n)) return;
                var p = F.parseCellKey(k);
                if (!p) return;
                if (p.row + 1 > rows) rows = p.row + 1;
                if (p.col + 1 > cols) cols = p.col + 1;
            });
        }
        boundsCache[si] = { rows: rows, cols: cols };
        return boundsCache[si];
    }
    function sheetIndexByName(name) {
        var want = String(name).toLowerCase();
        for (var i = 0; i < body.sheets.length; i++) {
            if (String(body.sheets[i].name).toLowerCase() === want) return i;
        }
        return -1;
    }
    // run fn(cell, sheetIndex) over every formula cell of every sheet
    function eachFormulaCell(fn) {
        body.sheets.forEach(function (sh, si) {
            Object.keys(sh.cells).forEach(function (k) {
                var cell = sh.cells[k];
                if (cell && cell.v && String(cell.v).charAt(0) === "=") fn(cell, si);
            });
        });
    }
    function recalc() {
        boundsCache = {};
        formulaCellsCache = {};
        if (calc) calc.reset();
    }
    function valueAt(c, r) {
        var m = mergeCover[key(c, r)];
        if (m) { var p = F.parseCellKey(m); c = p.col; r = p.row; }
        return calc.value(c, r);
    }
    function thousands(str) {
        var parts = str.split(".");
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        return parts.join(".");
    }
    function formatValue(v, s) {
        if (v === null || v === undefined) return { text: "", num: false };
        if (F.isErr(v)) return { text: v.code, num: false, err: true };
        if (typeof v === "boolean") return { text: v ? "TRUE" : "FALSE", num: true };
        var fmt = s.fmt || "general";
        if (typeof v !== "number") {
            return { text: String(v), num: false };
        }
        var dec = (s.dec === undefined || s.dec === null) ? null : s.dec;
        switch (fmt) {
            case "number":
                return { text: thousands(v.toFixed(dec === null ? 2 : dec)), num: true };
            case "percent":
                return { text: (v * 100).toFixed(dec === null ? 2 : dec) + "%", num: true };
            case "currency":
                var av = Math.abs(v).toFixed(dec === null ? 2 : dec);
                return { text: (v < 0 ? "-$" : "$") + thousands(av), num: true };
            case "date": {
                var d = F.serialToDate(v);
                var pad = function (n) { return (n < 10 ? "0" : "") + n; };
                return {
                    text: d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()),
                    num: true
                };
            }
            case "text":
                return { text: F.numToText(v), num: false };
            default:
                return { text: F.numToText(v), num: true };
        }
    }
    function displayText(c, r) {
        // evaluate first: that is what records the format hint below
        var v = valueAt(c, r);
        var s = effFormat(c, r);
        if ((s.fmt || "general") === "text") {
            var raw = rawAt(c, r);
            return raw === undefined ? "" : String(raw);
        }
        return formatValue(v, s).text;
    }
    /* A formula may ask for a number format (TODAY, EDATE, TO_PERCENT ...).
       It only applies when the cell has no format of its own, so anything
       the user picked always wins. */
    function formulaHint(c, r) {
        var m = mergeCover[key(c, r)];
        if (m) { var p = F.parseCellKey(m); c = p.col; r = p.row; }
        return calc && calc.hintAt ? calc.hintAt(c, r, body.active) : null;
    }
    function effFormat(c, r) {
        var s = styleAt(c, r);
        // (the caller evaluates the cell first, so the hint is already in)
        if (s.fmt) return s;
        var hint = formulaHint(c, r);
        if (!hint || !hint.fmt || hint.fmt === "general") return s;
        var out = {}, k;
        for (k in s) if (Object.prototype.hasOwnProperty.call(s, k)) out[k] = s[k];
        out.fmt = hint.fmt;
        return out;
    }
    // the URL a HYPERLINK() result points at, if any
    function linkAt(c, r) {
        var hint = formulaHint(c, r);
        return hint && hint.link ? hint.link : "";
    }

    /* ================= selection ================= */
    function selRange() {
        if (selCols) return { c1: selCols.c1, r1: 0, c2: selCols.c2, r2: sheet().rows - 1 };
        if (selRows) return { c1: 0, r1: selRows.r1, c2: sheet().cols - 1, r2: selRows.r2 };
        var rg = {
            c1: Math.min(anchor.c, head.c), r1: Math.min(anchor.r, head.r),
            c2: Math.max(anchor.c, head.c), r2: Math.max(anchor.r, head.r)
        };
        // expand over merges intersecting the range (one pass is enough for MVP)
        Object.keys(mergeAnchor).forEach(function (k) {
            var m = mergeAnchor[k];
            if (m.c <= rg.c2 && m.c + m.cs - 1 >= rg.c1 && m.r <= rg.r2 && m.r + m.rs - 1 >= rg.r1) {
                rg.c1 = Math.min(rg.c1, m.c);
                rg.r1 = Math.min(rg.r1, m.r);
                rg.c2 = Math.max(rg.c2, m.c + m.cs - 1);
                rg.r2 = Math.max(rg.r2, m.r + m.rs - 1);
            }
        });
        return rg;
    }
    function setActive(c, r, keepAnchor) {
        var s = sheet();
        c = clamp(c, 0, s.cols - 1);
        r = clamp(r, 0, s.rows - 1);
        var m = mergeAt(c, r);
        if (m) { c = m.c; r = m.r; }
        head = { c: c, r: r };
        if (!keepAnchor) anchor = { c: c, r: r };
        selCols = null;
        selRows = null;
        selChart = null;
        afterSelChange();
    }
    function afterSelChange() {
        renderGrid();
        syncFxBar();
        updateStatusStats();
        syncToolbarFromSel();
    }
    function scrollIntoView(c, r) {
        var rect = cellRect(c, r);
        var fz = sheet().freeze;
        var fx = colX[fz.c], fy = rowY[fz.r];
        var vw = gridEl.clientWidth, vh = gridEl.clientHeight;
        if (rect.x < gridEl.scrollLeft + fx && c >= fz.c) gridEl.scrollLeft = Math.max(0, rect.x - fx);
        else if (rect.x + rect.w > gridEl.scrollLeft + vw) gridEl.scrollLeft = rect.x + rect.w - vw;
        if (rect.y < gridEl.scrollTop + fy && r >= fz.r) gridEl.scrollTop = Math.max(0, rect.y - fy);
        else if (rect.y + rect.h > gridEl.scrollTop + vh) gridEl.scrollTop = rect.y + rect.h - vh;
    }
    function updateStatusStats() {
        var rg = selRange();
        var sum = 0, cnt = 0, n = 0;
        var limit = 100000;
        outer:
        for (var r = rg.r1; r <= rg.r2; r++) {
            for (var c = rg.c1; c <= rg.c2; c++) {
                if (--limit < 0) break outer;
                if (mergeCover[key(c, r)]) continue;
                var v = valueAt(c, r);
                if (v === null || v === undefined || F.isErr(v)) continue;
                n++;
                if (typeof v === "number") { sum += v; cnt++; }
            }
        }
        var txt = "";
        if (cnt > 1) {
            txt = "Sum: " + F.numToText(sum) + "   Avg: " + F.numToText(sum / cnt) + "   Count: " + n;
        } else if (n > 1) {
            txt = "Count: " + n;
        }
        OfficeApp.updateStatusItem("stats", esc(txt));
    }

    /* ================= rendering ================= */
    function renderAll() {
        rebuildMerges();
        rebuildFilter();
        fitSpills();
        rebuildGeometry();
        renderGrid();
        renderTabs();
        syncFxBar();
        updateStatusStats();
        // a full render can mean a different sheet or document, so the
        // toolbar's toggles have to be re-read rather than left as they were
        syncToolbarFromSel();
    }
    /* A spilled array can reach past the grid (SEQUENCE(500) in a 200-row
       sheet): grow the sheet so every spilled cell can be seen. */
    function fitSpills() {
        if (!calc || !calc.spillList) return;
        var s = sheet(), needC = 0, needR = 0;
        calc.spillList(body.active).forEach(function (sp) {
            needC = Math.max(needC, sp.c2 + 2);
            needR = Math.max(needR, sp.r2 + 2);
        });
        if (needC > s.cols || needR > s.rows) growTo(needC, needR);
    }
    function cellClasses(c, r, s, fmtd, inSel) {
        var cls = "sh-cell";
        if (inSel) cls += " sel";
        if (fmtd.err) cls += " err";
        if (s.b) cls += " b";
        if (s.i) cls += " i";
        if (s.u) cls += " u";
        if (s.wrap) cls += " wrap";
        if (s.al === "c") cls += " ctr";
        else if (s.al === "r") cls += " rgt";
        else if (s.al === "l") cls += " lft";
        else if (fmtd.num) cls += " num";
        return cls;
    }
    function cellStyleCss(s, rect) {
        var css = "left:" + rect.x + "px;top:" + rect.y + "px;width:" + rect.w + "px;height:" + rect.h + "px;";
        if (s.bg) css += "background-color:" + esc(s.bg) + ";";
        if (s.fc) css += "color:" + esc(s.fc) + ";";
        css += "font-size:" + Math.round((s.fs || 13) * zoomF) + "px;";
        if (s.bd) css += "border:1px solid var(--of-fg-soft);";
        return css;
    }
    /* One cell at its sheet position. Frozen cells use the same coordinates:
       they go into a sticky layer (#shFrozenRows/Cols/Corner) whose origin
       is the sheet's, and the browser keeps that layer pinned. */
    function renderCellHtml(c, r, sel, frozen) {
        var k = key(c, r);
        if (mergeCover[k]) return "";
        var rect = cellRect(c, r);
        if (rect.w === 0 || rect.h === 0) return "";
        var s = effStyleAt(c, r);
        // evaluate before reading the hint: it is recorded while evaluating
        var value = valueAt(c, r);
        var hint = formulaHint(c, r);
        if (hint && hint.fmt && hint.fmt !== "general" && !s.fmt) {
            var withHint = {}, hk;
            for (hk in s) if (Object.prototype.hasOwnProperty.call(s, hk)) withHint[hk] = s[hk];
            withHint.fmt = hint.fmt;
            s = withHint;
        }
        var text, fmtd;
        if ((s.fmt || "general") === "text") {
            text = String(rawAt(c, r) || "");
            fmtd = { num: false };
        } else {
            fmtd = formatValue(value, s);
            text = fmtd.text;
        }
        var inSel = sel && c >= sel.c1 && c <= sel.c2 && r >= sel.r1 && r <= sel.r2;
        var cls = cellClasses(c, r, s, fmtd, inSel);
        if (frozen) cls += " frozen";
        var link = hint && hint.link ? hint.link : "";
        if (link) cls += " sh-link";
        var cellData = sheet().cells[k];
        var noteAttr = link ? ' data-link="' + esc(link) + '" title="' + esc(link) + ' (Ctrl+click to open)"' : "";
        if (fmtd.err && F.isErr(value) && value.message && value.message !== value.code) {
            noteAttr = ' title="' + esc(value.code + ": " + value.message) + '"';
        }
        if (cellData && cellData.n) {
            cls += " note";
            noteAttr = ' title="' + esc(cellData.n) + '"';
        }
        return '<div class="' + cls + '" data-c="' + c + '" data-r="' + r + '"' + noteAttr + ' style="' +
            cellStyleCss(s, rect) + '">' + esc(text) + "</div>";
    }
    function renderGrid() {
        if (!gridEl) return;
        var s = sheet();
        var sl = gridEl.scrollLeft, st = gridEl.scrollTop;
        var vw = gridEl.clientWidth, vh = gridEl.clientHeight;
        var fz = s.freeze;
        var sel = selChart ? null : selRange();

        var c1 = Math.max(fz.c, idxAt(colX, sl) - 1);
        var c2 = Math.min(s.cols - 1, idxAt(colX, sl + vw) + 1);
        var r1 = Math.max(fz.r, idxAt(rowY, st) - 1);
        var r2 = Math.min(s.rows - 1, idxAt(rowY, st + vh) + 1);

        var out = [], rowsOut = [], colsOut = [], cornerOut = [];
        var c, r;
        // main quadrant
        for (r = r1; r <= r2; r++) {
            if (hiddenRows[r]) continue;
            for (c = c1; c <= c2; c++) out.push(renderCellHtml(c, r, sel, false));
        }
        // frozen rows (sticky to the top, scroll sideways with the sheet)
        for (r = 0; r < fz.r; r++) {
            if (hiddenRows[r]) continue;
            for (c = c1; c <= c2; c++) rowsOut.push(renderCellHtml(c, r, sel, true));
        }
        // frozen cols (sticky to the left, scroll vertically with the sheet)
        for (c = 0; c < fz.c; c++) {
            for (r = r1; r <= r2; r++) {
                if (hiddenRows[r]) continue;
                colsOut.push(renderCellHtml(c, r, sel, true));
            }
        }
        // frozen corner (sticky both ways)
        for (r = 0; r < fz.r; r++) {
            if (hiddenRows[r]) continue;
            for (c = 0; c < fz.c; c++) cornerOut.push(renderCellHtml(c, r, sel, true));
        }
        setLayerHtml(cellsEl, out);
        setLayerHtml(frozenRowsEl, rowsOut);
        setLayerHtml(frozenColsEl, colsOut);
        setLayerHtml(frozenCornerEl, cornerOut);

        renderHeaders(c1, c2, r1, r2, sl, st, sel);
        renderRangeBox(sel);
        if (window.SheetsIO) SheetsIO.renderCharts();
    }
    // skip the DOM rebuild when a layer's markup did not change (the frozen
    // corner never does while scrolling)
    function setLayerHtml(el, parts) {
        var html = parts.join("");
        if (el._shHtml === html) return;
        el._shHtml = html;
        el.innerHTML = html;
    }
    function renderHeaders(c1, c2, r1, r2, sl, st, sel) {
        var s = sheet(), fz = s.freeze;
        var out = [], c, r, x, y, w, h;
        var f = s.filter ? parseRange(s.filter.range) : null;
        function colHead(c, pin) {
            x = pin ? sl + colX[c] : colX[c];
            w = colWidth(c);
            if (w === 0) return;
            var isSel = sel && c >= sel.c1 && c <= sel.c2;
            var fBtn = "";
            if (f && c >= f.c1 && c <= f.c2) {
                var on = s.filter.excl && s.filter.excl[String(c)] &&
                    Object.keys(s.filter.excl[String(c)]).length > 0;
                fBtn = '<span class="sh-filter-btn' + (on ? " on" : "") + '" data-fc="' + c + '">▼</span>';
            }
            out.push('<div class="sh-colh' + (isSel ? " sel" : "") + (pin ? " frozen" : "") +
                '" data-c="' + c + '" style="left:' + x + "px;top:0;width:" + w + "px;height:" +
                HDR_H + 'px;">' + F.colToName(c) + fBtn +
                '<span class="sh-rz sh-rz-col" data-rzc="' + c + '" style="left:' + (w - 4) + 'px;"></span></div>');
        }
        for (c = c1; c <= c2; c++) colHead(c, false);
        for (c = 0; c < fz.c; c++) colHead(c, true);
        colHeadIn.innerHTML = out.join("");
        colHeadIn.style.transform = "translateX(" + (-sl) + "px)";

        out = [];
        function rowHead(r, pin) {
            y = pin ? st + rowY[r] : rowY[r];
            h = rowHeight(r);
            if (h === 0) return;
            var isSel = sel && r >= sel.r1 && r <= sel.r2;
            out.push('<div class="sh-rowh' + (isSel ? " sel" : "") + (pin ? " frozen" : "") +
                '" data-r="' + r + '" style="top:' + y + "px;left:0;width:" + HDR_W + "px;height:" +
                h + 'px;">' + (r + 1) +
                '<span class="sh-rz sh-rz-row" data-rzr="' + r + '" style="top:' + (h - 4) + 'px;"></span></div>');
        }
        for (r = r1; r <= r2; r++) { if (!hiddenRows[r]) rowHead(r, false); }
        for (r = 0; r < fz.r; r++) { if (!hiddenRows[r]) rowHead(r, true); }
        // a marker on the boundary where user-hidden rows collapsed (hidden
        // rows have no height, so rowY[first] is that boundary); frozen-area
        // runs are pinned like their rows
        hiddenRuns().forEach(function (run) {
            var pinned = run.r1 < fz.r;
            if (!pinned && (run.r2 < r1 - 1 || run.r1 > r2 + 1)) return;
            var my = Math.max(6, (pinned ? st : 0) + rowY[run.r1]);
            var label = run.r1 === run.r2 ? "Row " + (run.r1 + 1) + " is hidden" :
                "Rows " + (run.r1 + 1) + "-" + (run.r2 + 1) + " are hidden";
            out.push('<div class="sh-rowh-hidden" data-hr1="' + run.r1 + '" data-hr2="' + run.r2 +
                '" title="' + label + ' - click to show" style="top:' + my + 'px;"></div>');
        });
        rowHeadIn.innerHTML = out.join("");
        rowHeadIn.style.transform = "translateY(" + (-st) + "px)";
    }
    function renderSpillBox() {
        if (!spillBoxEl) return;
        var sp = !editing && calc && calc.spillAt ? calc.spillAt(head.c, head.r, body.active) : null;
        if (!sp) { spillBoxEl.style.display = "none"; return; }
        var a = cellRect(sp.c1, sp.r1), b = cellRect(sp.c2, sp.r2);
        spillBoxEl.style.display = "block";
        spillBoxEl.style.left = a.x + "px";
        spillBoxEl.style.top = a.y + "px";
        spillBoxEl.style.width = (b.x + b.w - a.x) + "px";
        spillBoxEl.style.height = (b.y + b.h - a.y) + "px";
    }
    function renderRangeBox(sel) {
        renderSpillBox();
        if (!sel || editing) {
            rangeBoxEl.style.display = "none";
            fillEl.style.display = "none";
            return;
        }
        var a = cellRect(sel.c1, sel.r1);
        var b = cellRect(sel.c2, sel.r2);
        var x = a.x, y = a.y, w = b.x + b.w - a.x, h = b.y + b.h - a.y;
        rangeBoxEl.style.display = "block";
        rangeBoxEl.style.left = x + "px";
        rangeBoxEl.style.top = y + "px";
        rangeBoxEl.style.width = w + "px";
        rangeBoxEl.style.height = h + "px";
        fillEl.style.display = "block";
        fillEl.style.left = (x + w - 4) + "px";
        fillEl.style.top = (y + h - 4) + "px";
    }

    /* ================= sheet tabs ================= */
    function renderTabs() {
        var $t = $("#shTabList").empty();
        body.sheets.forEach(function (s, i) {
            var $tab = $('<div class="sh-tab' + (i === body.active ? " active" : "") + '"></div>');
            if (s.color) $tab.append('<span class="sh-tab-color" style="background:' + esc(s.color) + ';"></span>');
            $tab.append($("<span></span>").text(s.name));
            $tab.on("click", function () { switchSheet(i); });
            $tab.on("dblclick", function () { renameSheetDialog(i); });
            $tab.on("contextmenu", function (e) {
                e.preventDefault();
                switchSheet(i);
                sheetTabMenu(e.clientX, e.clientY, i);
            });
            $t.append($tab);
        });
    }
    function switchSheet(i) {
        if (i === body.active) return;
        commitEdit(true);
        body.active = clamp(i, 0, body.sheets.length - 1);
        anchor = { c: 0, r: 0 };
        head = { c: 0, r: 0 };
        selCols = selRows = null;
        selChart = null;
        // no rebuildCalc: the calculator is workbook-wide and follows body.active
        renderAll();
    }
    function addSheet() {
        var n = 1;
        var names = body.sheets.map(function (s) { return s.name; });
        while (names.indexOf("Sheet" + n) >= 0) n++;
        body.sheets.push(newSheetData("Sheet" + n));
        body.active = body.sheets.length - 1;
        rebuildCalc();
        commit();
        renderAll();
    }
    /* ================= cell notes ================= */
    function noteAt(c, r) {
        var cell = sheet().cells[key(c, r)];
        return (cell && cell.n) || "";
    }
    function setNote(c, r, text) {
        text = String(text || "").trim();
        var s = sheet(), k = key(c, r);
        var cell = s.cells[k];
        if (text) {
            if (!cell) { cell = { v: "" }; s.cells[k] = cell; }
            cell.n = text;
        } else if (cell) {
            delete cell.n;
            if (cellIsBare(cell)) delete s.cells[k];
        }
        commit();
    }
    function noteDialog(c, r) {
        var $b = $('<label>Note for ' + esc(key(c, r)) + '</label>' +
            '<textarea id="shNoteText" rows="5" style="width:100%;resize:vertical;"></textarea>');
        $b.filter("textarea").val(noteAt(c, r));
        var existing = noteAt(c, r) !== "";
        var buttons = [{ label: "Cancel" }];
        if (existing) {
            buttons.push({
                label: "Delete note", danger: true,
                action: function (close) { close(); setNote(c, r, ""); }
            });
        }
        buttons.push({
            label: "Save", primary: true,
            action: function (close, $bd) {
                var v = $bd.find("#shNoteText").val();
                close();
                setNote(c, r, v);
            }
        });
        OfficeApp.dialog({ title: existing ? "Edit note" : "Add note", body: $b, buttons: buttons });
        setTimeout(function () { $("#shNoteText").focus(); }, 50);
    }

    function renameSheetDialog(i) {
        OfficeApp.prompt("Rename sheet", "Sheet name", body.sheets[i].name, function (v) {
            if (!v) return;
            v = v.trim().substring(0, 40);
            if (!v) return;
            var old = body.sheets[i].name;
            if (v !== old && sheetIndexByName(v) >= 0 && sheetIndexByName(v) !== i) {
                OfficeApp.toast("A sheet called " + v + " already exists", "error");
                return;
            }
            body.sheets[i].name = v;
            // formulas (and defined names) that name the sheet follow the rename
            if (v !== old) {
                eachFormulaCell(function (cell) { cell.v = F.renameSheetRefs(cell.v, old, v); });
                body.names.forEach(function (n) { n.formula = F.renameSheetRefs(n.formula, old, v); });
            }
            commit();
            renderTabs();
        });
    }
    function sheetTabMenu(x, y, i) {
        OfficeApp.showContextMenu(x, y, [
            { label: "Rename", icon: "i cursor", action: function () { renameSheetDialog(i); } },
            {
                label: "Duplicate", icon: "clone outline", action: function () {
                    var copy = deep(body.sheets[i]);
                    copy.name = body.sheets[i].name + " copy";
                    body.sheets.splice(i + 1, 0, copy);
                    body.active = i + 1;
                    rebuildCalc();
                    commit();
                    renderAll();
                }
            },
            {
                label: "Delete", icon: "trash alternate outline",
                enabled: function () { return body.sheets.length > 1; },
                action: function () {
                    OfficeApp.confirm("Delete sheet?", "Delete <b>" + esc(body.sheets[i].name) + "</b> and all of its data?",
                        "Delete", "Cancel", function (yes) {
                            if (!yes) return;
                            body.sheets.splice(i, 1);
                            body.active = clamp(body.active, 0, body.sheets.length - 1);
                            rebuildCalc();
                            commit();
                            renderAll();
                        });
                }
            },
            { sep: true },
            {
                label: "Move left", icon: "angle left",
                enabled: function () { return i > 0; },
                action: function () { moveSheet(i, i - 1); }
            },
            {
                label: "Move right", icon: "angle right",
                enabled: function () { return i < body.sheets.length - 1; },
                action: function () { moveSheet(i, i + 1); }
            },
            { sep: true },
            {
                label: "Tab color", icon: "paint brush", sub: [null, "#e05555", "#e0a03d", "#3dbb61", "#4c9be8", "#b06ae8"].map(function (col) {
                    return {
                        label: col ? col : "None",
                        checked: function () { return body.sheets[i].color === col; },
                        action: function () { body.sheets[i].color = col; commit(); renderTabs(); }
                    };
                })
            }
        ]);
    }
    function moveSheet(from, to) {
        var s = body.sheets.splice(from, 1)[0];
        body.sheets.splice(to, 0, s);
        body.active = to;
        commit();
        renderTabs();
    }

    /* ================= commit / undo ================= */
    function commit() {
        recalc();
        rebuildMerges();
        rebuildFilter();
        rebuildGeometry();
        renderGrid();
        updateStatusStats();
        OfficeApp.markDirty();
        undo.push(snap());
    }
    function applyUndoState(state) {
        try { body = normalizeBody(JSON.parse(state)); } catch (e) { return; }
        var s = sheet();
        anchor.c = clamp(anchor.c, 0, s.cols - 1);
        anchor.r = clamp(anchor.r, 0, s.rows - 1);
        head.c = clamp(head.c, 0, s.cols - 1);
        head.r = clamp(head.r, 0, s.rows - 1);
        selCols = selRows = null;
        rebuildCalc();
        renderAll();
        OfficeApp.markDirty();
    }
    function doUndo() { commitEdit(false); undo.undo(); }
    function doRedo() { commitEdit(false); undo.redo(); }

    /* ================= editing ================= */
    function startEdit(initial, viaFx) {
        if (editing) return;
        var c = head.c, r = head.r;
        editing = { c: c, r: r, viaFx: !!viaFx };
        var rect = cellRect(c, r);
        var s = styleAt(c, r);
        inputEl.style.display = "block";
        inputEl.style.left = rect.x + "px";
        inputEl.style.top = rect.y + "px";
        inputEl.style.width = Math.max(rect.w, 60) + "px";
        inputEl.style.height = Math.max(rect.h, 22) + "px";
        inputEl.style.fontSize = Math.round((s.fs || 13) * zoomF) + "px";
        var val = (initial !== undefined && initial !== null) ? initial : rawAt(c, r);
        inputEl.value = val;
        $("#shFxInput").val(val);
        if (!viaFx) {
            inputEl.focus();
            if (initial === undefined) inputEl.select();
            else inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
        }
        renderRangeBox(null);
    }
    function commitEdit(keepFocus) {
        if (!editing) return;
        var c = editing.c, r = editing.r;
        var val = editing.viaFx ? $("#shFxInput").val() : inputEl.value;
        editing = null;
        refPick = null;
        inputEl.style.display = "none";
        if (val !== rawAt(c, r)) {
            setRaw(c, r, val);
            commit();
        } else {
            renderGrid();
        }
        if (keepFocus) gridEl.focus();
        syncFxBar();
    }
    function cancelEdit() {
        if (!editing) return;
        editing = null;
        refPick = null;
        inputEl.style.display = "none";
        gridEl.focus();
        syncFxBar();
        renderGrid();
    }
    function syncFxBar() {
        var rg = selRange();
        var name = key(anchor.c, anchor.r);
        if (rg.c1 !== rg.c2 || rg.r1 !== rg.r2) name = rangeStr(rg);
        $("#shNameBox").val(name);
        if (!editing) {
            var own = rawAt(head.c, head.r), ghost = false;
            if (own === "" || own === undefined) {
                var sp = calc && calc.spillAt ? calc.spillAt(head.c, head.r, body.active) : null;
                if (sp && (sp.anchor.c !== head.c || sp.anchor.r !== head.r)) {
                    own = rawAt(sp.anchor.c, sp.anchor.r);
                    ghost = true;
                }
            }
            $("#shFxInput").val(own).toggleClass("sh-fx-ghost", ghost);
        }
    }

    /* ================= keyboard ================= */
    function isTypingTarget(t) {
        return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ""));
    }
    function moveHead(dc, dr, extend) {
        var s = sheet();
        var c = head.c, r = head.r;
        var m = mergeAt(c, r);
        if (m && !extend) {
            if (dc > 0) c = m.c + m.cs - 1;
            if (dr > 0) r = m.r + m.rs - 1;
        }
        c = clamp(c + dc, 0, s.cols - 1);
        r = clamp(r + dr, 0, s.rows - 1);
        while (hiddenRows[r] && r + dr >= 0 && r + dr < s.rows && dr !== 0) r += (dr > 0 ? 1 : -1);
        if (extend) {
            head = { c: c, r: r };
            selCols = selRows = null;
            afterSelChange();
        } else {
            setActive(c, r);
        }
        scrollIntoView(head.c, head.r);
        if (c + 2 >= s.cols || r + 2 >= s.rows) growTo(c + 2, r + 2);
    }
    function jumpEdge(dc, dr, extend) {
        var s = sheet();
        var c = head.c, r = head.r;
        var hasVal = function (cc, rr) { return rawAt(cc, rr) !== ""; };
        var stepC = dc, stepR = dr;
        if (hasVal(c, r) && hasVal(clamp(c + stepC, 0, s.cols - 1), clamp(r + stepR, 0, s.rows - 1))) {
            while (c + stepC >= 0 && c + stepC < s.cols && r + stepR >= 0 && r + stepR < s.rows &&
                hasVal(c + stepC, r + stepR)) { c += stepC; r += stepR; }
        } else {
            while (c + stepC >= 0 && c + stepC < s.cols && r + stepR >= 0 && r + stepR < s.rows &&
                !hasVal(c + stepC, r + stepR)) { c += stepC; r += stepR; }
        }
        if (extend) { head = { c: c, r: r }; afterSelChange(); }
        else setActive(c, r);
        scrollIntoView(c, r);
    }
    function onKeyDown(e) {
        // grid range picking for a hidden dialog: Escape cancels it
        if (rangePickCb && e.key === "Escape") {
            e.preventDefault();
            var cb = rangePickCb;
            rangePickCb = null;
            cb(null);
            return;
        }
        if ($(".of-dialog-overlay").length) return;
        var ctrl = e.ctrlKey || e.metaKey;
        var k = e.key;

        if (editing && !editing.viaFx) return;       // textarea handles its own keys
        if (isTypingTarget(e.target) && e.target !== gridEl) return;

        if (selChart) {
            if (k === "Delete" || k === "Backspace") {
                e.preventDefault();
                if (window.SheetsIO) SheetsIO.deleteChart(selChart);
                return;
            }
            if (k === "Escape") { selChart = null; renderGrid(); return; }
        }

        if (ctrl && k.toLowerCase() === "a") {
            e.preventDefault();
            var ur = usedRange();
            anchor = { c: ur.c1, r: ur.r1 };
            head = { c: ur.c2, r: ur.r2 };
            selCols = selRows = null;
            afterSelChange();
            return;
        }
        if (ctrl && k === "Home") { e.preventDefault(); setActive(0, 0); scrollIntoView(0, 0); return; }
        if (ctrl) return;   // Ctrl+C/V/X flow through native events; Ctrl+B etc via shortcuts

        switch (k) {
            case "ArrowLeft": e.preventDefault(); moveHead(-1, 0, e.shiftKey); return;
            case "ArrowRight": e.preventDefault(); moveHead(1, 0, e.shiftKey); return;
            case "ArrowUp": e.preventDefault(); moveHead(0, -1, e.shiftKey); return;
            case "ArrowDown": e.preventDefault(); moveHead(0, 1, e.shiftKey); return;
            case "Tab": e.preventDefault(); moveHead(e.shiftKey ? -1 : 1, 0, false); return;
            case "Enter": e.preventDefault(); moveHead(0, e.shiftKey ? -1 : 1, false); return;
            case "Home": e.preventDefault(); setActive(0, head.r); scrollIntoView(0, head.r); return;
            case "PageDown": e.preventDefault(); moveHead(0, 20, e.shiftKey); return;
            case "PageUp": e.preventDefault(); moveHead(0, -20, e.shiftKey); return;
            case "F2":
                e.preventDefault();
                if (e.shiftKey) noteDialog(anchor.c, anchor.r);
                else startEdit();
                return;
            case "Delete":
            case "Backspace":
                e.preventDefault();
                clearSelection(false);
                return;
            case "Escape":
                selCols = selRows = null;
                setActive(head.c, head.r);
                return;
        }
        // printable character starts editing
        if (k.length === 1 && !e.altKey) {
            e.preventDefault();
            startEdit(k);
        }
    }
    function onInputKeyDown(e) {
        var k = e.key;
        if (k === "Enter" && !e.altKey) {
            e.preventDefault();
            commitEdit(true);
            moveHead(0, e.shiftKey ? -1 : 1, false);
        } else if (k === "Tab") {
            e.preventDefault();
            commitEdit(true);
            moveHead(e.shiftKey ? -1 : 1, 0, false);
        } else if (k === "Escape") {
            e.preventDefault();
            cancelEdit();
        } else if (k === "Enter" && e.altKey) {
            // newline inside the cell
            var pos = inputEl.selectionStart;
            inputEl.value = inputEl.value.substring(0, pos) + "\n" + inputEl.value.substring(inputEl.selectionEnd);
            inputEl.setSelectionRange(pos + 1, pos + 1);
            e.preventDefault();
        }
        setTimeout(function () { if (editing) $("#shFxInput").val(inputEl.value); }, 0);
    }

    /* ================= cross-sheet reads + sheet creation (pivot) ================= */
    /* Computed values of a range on ANY sheet. */
    function readRangeValues(sheetIdx, rgStr) {
        var rg = parseRange(rgStr);
        if (!rg || sheetIdx < 0 || sheetIdx >= body.sheets.length) return null;
        var out = [];
        for (var r = rg.r1; r <= rg.r2; r++) {
            var row = [];
            for (var c = rg.c1; c <= rg.c2; c++) row.push(calc.value(c, r, sheetIdx));
            out.push(row);
        }
        return out;
    }
    /* Print model for the server-side PDF exporter (sheets_io exportPdf):
       per sheet, the used-range grid of formatted display strings plus the
       print-relevant styles and the raw (unzoomed) column widths / row
       heights in css px. Flips the active sheet so the per-sheet helpers
       (styles, merges, conditional formats) read the right one; the
       calculator is workbook-wide and needs no rebuild. */
    function buildPrintModel() {
        var saved = body.active;
        var out = { sheets: [] };
        try {
            for (var i = 0; i < body.sheets.length; i++) {
                if (body.active !== i) body.active = i;
                var s = sheet();
                var ur = usedRange();
                var colW = [], rowH = [], rows = [];
                for (var c = ur.c1; c <= ur.c2; c++) {
                    var w = s.colW[String(c)];
                    colW.push(w !== undefined ? w : DEF_COLW);
                }
                for (var r = ur.r1; r <= ur.r2; r++) {
                    if (s.hiddenRows.indexOf(r) >= 0) continue;     // hidden rows do not print
                    var h = s.rowH[String(r)];
                    rowH.push(h !== undefined ? h : DEF_ROWH);
                    var row = [];
                    for (var cc = ur.c1; cc <= ur.c2; cc++) {
                        // effective style: conditional colours print too
                        var st = effStyleAt(cc, r);
                        var pv = valueAt(cc, r);
                        var ph = calc.hintAt ? calc.hintAt(cc, r, i) : null;
                        if (ph && ph.fmt && ph.fmt !== "general" && !st.fmt) {
                            var pcopy = {}, pk;
                            for (pk in st) if (Object.prototype.hasOwnProperty.call(st, pk)) pcopy[pk] = st[pk];
                            pcopy.fmt = ph.fmt;
                            st = pcopy;
                        }
                        var t, num = false;
                        if ((st.fmt || "general") === "text") {
                            var raw = rawAt(cc, r);
                            t = raw === undefined ? "" : String(raw);
                        } else {
                            var fv = formatValue(pv, st);
                            t = fv.text;
                            num = !!fv.num;
                        }
                        var cell = { t: t };
                        if (st.b) cell.b = true;
                        if (st.i) cell.i = true;
                        if (st.u) cell.u = true;
                        if (st.fc) cell.fc = st.fc;
                        if (st.bg) cell.bg = st.bg;
                        // numbers right-align on screen when no explicit align
                        var al = st.al || (num ? "r" : "");
                        if (al) cell.al = al;
                        row.push(cell);
                    }
                    rows.push(row);
                }
                out.sheets.push({ name: s.name, colW: colW, rowH: rowH, rows: rows });
            }
        } finally {
            body.active = saved;
        }
        return out;
    }

    // append a sheet (unique name derived from base) and make it active
    function addSheetNamed(base, data) {
        var names = body.sheets.map(function (s) { return s.name; });
        var name = base, n = 2;
        while (names.indexOf(name) >= 0) name = base + " " + (n++);
        data.name = name;
        body.sheets.push(normalizeBody({ sheets: [data], active: 0 }).sheets[0]);
        body.active = body.sheets.length - 1;
        rebuildCalc();
        commit();
        renderAll();
        return body.sheets[body.active];
    }

    /* ================= range picking (formulas + dialogs) ================= */
    /* While editing an "=" formula, pressing the mouse on the grid inserts
       the cell/range reference at the caret and live-updates it during the
       drag - the Excel/Google Sheets gesture. */
    var refPick = null;      // {insertAt, len, lastVal, start:{c,r}}
    var rangePickCb = null;  // dialog "pick a range on the grid" callback
    function refEditorEl() {
        return editing && editing.viaFx ? document.getElementById("shFxInput") : inputEl;
    }
    function refCaret(el) {
        return el.selectionStart !== null && el.selectionStart !== undefined ?
            el.selectionStart : el.value.length;
    }
    // a reference may be inserted when the caret follows an operator /
    // opening paren / comma / "=" - or sits right after a just-picked ref
    function canPickRef() {
        if (!editing) return false;
        var el = refEditorEl();
        var v = el.value;
        if (v.charAt(0) !== "=") return false;
        var caret = refCaret(el);
        if (refPick && refPick.lastVal === v && caret === refPick.insertAt + refPick.len) return true;
        return /[=+\-*\/(,:<>&^%]\s*$/.test(v.substring(0, caret));
    }
    function refPickApply(a, b) {
        var el = refEditorEl();
        var txt = (a.c === b.c && a.r === b.r) ? key(a.c, a.r) :
            rangeStr({
                c1: Math.min(a.c, b.c), r1: Math.min(a.r, b.r),
                c2: Math.max(a.c, b.c), r2: Math.max(a.r, b.r)
            });
        var v = el.value;
        el.value = v.substring(0, refPick.insertAt) + txt + v.substring(refPick.insertAt + refPick.len);
        refPick.len = txt.length;
        refPick.lastVal = el.value;
        try {
            el.setSelectionRange(refPick.insertAt + txt.length, refPick.insertAt + txt.length);
        } catch (err) { }
        // keep the twin editor in sync (cell input <-> formula bar)
        if (editing.viaFx) inputEl.value = el.value;
        else $("#shFxInput").val(el.value);
        // outline the picked range on the grid
        var ra = cellRect(Math.min(a.c, b.c), Math.min(a.r, b.r));
        var rb = cellRect(Math.max(a.c, b.c), Math.max(a.r, b.r));
        rangeBoxEl.style.display = "block";
        rangeBoxEl.style.left = ra.x + "px";
        rangeBoxEl.style.top = ra.y + "px";
        rangeBoxEl.style.width = (rb.x + rb.w - ra.x) + "px";
        rangeBoxEl.style.height = (rb.y + rb.h - ra.y) + "px";
    }
    function beginRefPick(pos) {
        var el = refEditorEl();
        var caret = refCaret(el);
        // clicking again right after a picked ref replaces that ref
        if (!(refPick && refPick.lastVal === el.value && caret === refPick.insertAt + refPick.len)) {
            refPick = { insertAt: caret, len: 0, lastVal: el.value };
        }
        refPick.start = pos;
        refPickApply(pos, pos);
    }
    /* Dialogs call this (via SheetsApp.pickRangeFromGrid) to let the user
       drag a range while the dialog is temporarily hidden; cb gets the
       "A1:B5" string, or null when cancelled with Escape. */
    function pickRangeFromGrid(cb) {
        var $ov = $(".of-dialog-overlay");
        $ov.hide();
        OfficeApp.setStatus("Drag on the grid to select a range (Esc cancels)", "info", 0);
        rangePickCb = function (rgStr) {
            $ov.show();
            OfficeApp.setStatus("");
            cb(rgStr);
        };
    }

    /* ================= mouse ================= */
    function gridPos(e) {
        var r = gridEl.getBoundingClientRect();
        return {
            x: e.clientX - r.left + gridEl.scrollLeft,
            y: e.clientY - r.top + gridEl.scrollTop
        };
    }
    function cellAtPos(p) {
        var s = sheet();
        // frozen panes: coordinates near the top/left viewport edge map to frozen cells
        var fz = s.freeze;
        var vx = p.x - gridEl.scrollLeft, vy = p.y - gridEl.scrollTop;
        var x = (fz.c > 0 && vx < colX[fz.c]) ? vx : p.x;
        var y = (fz.r > 0 && vy < rowY[fz.r]) ? vy : p.y;
        return {
            c: clamp(idxAt(colX, x), 0, s.cols - 1),
            r: clamp(idxAt(rowY, y), 0, s.rows - 1)
        };
    }
    // true when the press landed on the grid's own scrollbar (or its corner):
    // the scrollbar sits outside clientWidth/clientHeight of the padding box
    function onGridScrollbar(e) {
        if (e.target !== gridEl) return false;
        var r = gridEl.getBoundingClientRect();
        var x = e.clientX - r.left - gridEl.clientLeft;
        var y = e.clientY - r.top - gridEl.clientTop;
        return x >= gridEl.clientWidth || y >= gridEl.clientHeight;
    }
    function onGridPointerDown(e) {
        // leave scrollbar drags to the browser: no selection, no capture
        if (onGridScrollbar(e)) return;
        if (e.button === 2) {
            // right-click inside current selection keeps it
            var pos0 = cellAtPos(gridPos(e));
            var rg0 = selRange();
            if (!(pos0.c >= rg0.c1 && pos0.c <= rg0.c2 && pos0.r >= rg0.r1 && pos0.r <= rg0.r2)) {
                setActive(pos0.c, pos0.r);
            }
            return;
        }
        OfficeApp.closeAllMenus();
        if (e.target === inputEl) return;
        var linkEl = e.target.closest ? e.target.closest(".sh-link") : null;
        if (linkEl && (e.ctrlKey || e.metaKey) && e.button === 0) {
            var href = linkEl.getAttribute("data-link");
            if (href) {
                window.open(href, "_blank", "noopener");
                e.preventDefault();
                return;
            }
        }
        if (e.target.closest && e.target.closest(".sh-chart")) return;   // charts handle their own
        if (e.target === fillEl) {
            drag = { mode: "fill", startRg: selRange() };
            gridEl.classList.add("sh-filling");
            try { gridEl.setPointerCapture(e.pointerId); } catch (err) { }
            e.preventDefault();
            return;
        }
        // editing a formula: the press picks a reference instead of
        // committing the edit
        if (editing && canPickRef()) {
            beginRefPick(cellAtPos(gridPos(e)));
            drag = { mode: "refpick" };
            try { gridEl.setPointerCapture(e.pointerId); } catch (err) { }
            e.preventDefault();   // also keeps focus in the editor
            return;
        }
        // grab the selection border to move the whole block
        var gp = gridPos(e);
        if (onSelBorder(gp)) {
            commitEdit(false);
            drag = { mode: "movesel", srcRg: selRange(), grab: cellAtPos(gp), mv: { dC: 0, dR: 0 } };
            gridEl.classList.add("sh-movesel");
            try { gridEl.setPointerCapture(e.pointerId); } catch (err) { }
            e.preventDefault();
            return;
        }
        commitEdit(false);
        var pos = cellAtPos(gridPos(e));
        if (e.shiftKey) {
            head = { c: pos.c, r: pos.r };
            selCols = selRows = null;
            afterSelChange();
        } else {
            setActive(pos.c, pos.r);
        }
        drag = { mode: "sel" };
        try { gridEl.setPointerCapture(e.pointerId); } catch (err) { }
        gridEl.focus();
        e.preventDefault();
    }
    function onGridPointerMove(e) {
        if (!drag) {
            // hover feedback: the selection border is grabbable
            var onEdge = e.target !== fillEl && !onGridScrollbar(e) && onSelBorder(gridPos(e));
            gridEl.classList.toggle("sh-movesel", onEdge);
            return;
        }
        lastPointerEvt = e;
        if (!rafPending) {
            rafPending = true;
            requestAnimationFrame(applyDragFrame);
        }
    }
    function applyDragFrame() {
        rafPending = false;
        if (!drag || !lastPointerEvt) return;
        var e = lastPointerEvt;
        var pos = cellAtPos(gridPos(e));
        if (drag.mode === "sel") {
            if (pos.c !== head.c || pos.r !== head.r) {
                head = { c: pos.c, r: pos.r };
                selCols = selRows = null;
                afterSelChange();
            }
        } else if (drag.mode === "movesel") {
            var srg = drag.srcRg;
            var dC = clamp(pos.c - drag.grab.c, -srg.c1, sheet().cols - 1 - srg.c2);
            var dR = clamp(pos.r - drag.grab.r, -srg.r1, sheet().rows - 1 - srg.r2);
            drag.mv = { dC: dC, dR: dR };
            var ga = cellRect(srg.c1 + dC, srg.r1 + dR);
            var gb = cellRect(srg.c2 + dC, srg.r2 + dR);
            rangeBoxEl.style.display = "block";
            rangeBoxEl.style.left = ga.x + "px";
            rangeBoxEl.style.top = ga.y + "px";
            rangeBoxEl.style.width = (gb.x + gb.w - ga.x) + "px";
            rangeBoxEl.style.height = (gb.y + gb.h - ga.y) + "px";
        } else if (drag.mode === "refpick") {
            if (refPick && editing) refPickApply(refPick.start, pos);
        } else if (drag.mode === "fill") {
            var rg = drag.startRg;
            // constrain to a single axis: whichever dominates
            var dC = pos.c < rg.c1 ? pos.c - rg.c1 : (pos.c > rg.c2 ? pos.c - rg.c2 : 0);
            var dR = pos.r < rg.r1 ? pos.r - rg.r1 : (pos.r > rg.r2 ? pos.r - rg.r2 : 0);
            if (Math.abs(dC) > Math.abs(dR)) dR = 0; else dC = 0;
            drag.fillTo = { dC: dC, dR: dR };
            var box = {
                c1: Math.min(rg.c1, rg.c1 + dC), c2: Math.max(rg.c2, rg.c2 + dC),
                r1: Math.min(rg.r1, rg.r1 + dR), r2: Math.max(rg.r2, rg.r2 + dR)
            };
            var a = cellRect(box.c1, box.r1), b = cellRect(box.c2, box.r2);
            rangeBoxEl.style.display = "block";
            rangeBoxEl.style.left = a.x + "px";
            rangeBoxEl.style.top = a.y + "px";
            rangeBoxEl.style.width = (b.x + b.w - a.x) + "px";
            rangeBoxEl.style.height = (b.y + b.h - a.y) + "px";
        }
    }
    function onGridPointerUp(e) {
        if (!drag) return;
        var d = drag;
        drag = null;
        gridEl.classList.remove("sh-filling");
        gridEl.classList.remove("sh-movesel");
        try { gridEl.releasePointerCapture(e.pointerId); } catch (err) { }
        if (d.mode === "fill" && d.fillTo && (d.fillTo.dC || d.fillTo.dR)) {
            applyFill(d.startRg, d.fillTo.dC, d.fillTo.dR);
        } else if (d.mode === "fill") {
            renderGrid();
        } else if (d.mode === "movesel") {
            if (d.mv && (d.mv.dC || d.mv.dR)) moveRange(d.srcRg, d.mv.dC, d.mv.dR);
            else renderGrid();   // restore the range box
        } else if (d.mode === "refpick") {
            // keep editing; put the caret back in the formula editor
            if (editing) try { refEditorEl().focus(); } catch (err) { }
        } else if (d.mode === "sel" && rangePickCb) {
            var cb = rangePickCb;
            rangePickCb = null;
            cb(rangeStr(selRange()));
        }
    }
    function onGridDblClick(e) {
        if (onGridScrollbar(e)) return;
        if (e.target.closest && e.target.closest(".sh-chart")) return;
        var pos = cellAtPos(gridPos(e));
        setActive(pos.c, pos.r);
        startEdit();
    }
    function onGridContextMenu(e) {
        e.preventDefault();
        if (onGridScrollbar(e)) return;
        cellContextMenu(e.clientX, e.clientY);
    }

    /* header interactions */
    function onColHeadDown(e) {
        var t = e.target;
        if (t.hasAttribute && t.hasAttribute("data-rzc")) {
            var c = parseInt(t.getAttribute("data-rzc"), 10);
            drag = { mode: "rzc", c: c, startW: colWidth(c) / zoomF, startX: e.clientX };
            document.addEventListener("pointermove", onDocResizeMove);
            document.addEventListener("pointerup", onDocResizeUp);
            e.preventDefault();
            return;
        }
        if (t.classList && t.classList.contains("sh-filter-btn")) {
            var fc = parseInt(t.getAttribute("data-fc"), 10);
            if (window.SheetsIO) SheetsIO.filterDialog(fc);
            e.preventDefault();
            return;
        }
        var h = t.closest ? t.closest(".sh-colh") : null;
        if (!h) return;
        commitEdit(false);
        var c2 = parseInt(h.getAttribute("data-c"), 10);
        if (e.shiftKey && selCols) selCols = { c1: Math.min(selCols.c1, c2), c2: Math.max(selCols.c2, c2) };
        else selCols = { c1: c2, c2: c2 };
        selRows = null;
        selChart = null;
        anchor = { c: c2, r: 0 };
        head = { c: c2, r: 0 };
        afterSelChange();
        e.preventDefault();
    }
    function onRowHeadDown(e) {
        var t = e.target;
        // the marker left where rows are hidden: click to show them again
        var mark = t.closest ? t.closest(".sh-rowh-hidden") : null;
        if (mark) {
            e.preventDefault();
            if (e.button !== 0) return;
            unhideRows(parseInt(mark.getAttribute("data-hr1"), 10), parseInt(mark.getAttribute("data-hr2"), 10));
            e.preventDefault();
            return;
        }
        // right-click inside the selected rows keeps them for the menu
        if (e.button === 2 && selRows) {
            var rh = t.closest ? t.closest(".sh-rowh") : null;
            var rr = rh ? parseInt(rh.getAttribute("data-r"), 10) : -1;
            if (rr >= selRows.r1 && rr <= selRows.r2) { e.preventDefault(); return; }
        }
        if (t.hasAttribute && t.hasAttribute("data-rzr")) {
            var r = parseInt(t.getAttribute("data-rzr"), 10);
            drag = { mode: "rzr", r: r, startH: rowHeight(r) / zoomF, startY: e.clientY };
            document.addEventListener("pointermove", onDocResizeMove);
            document.addEventListener("pointerup", onDocResizeUp);
            e.preventDefault();
            return;
        }
        var h = t.closest ? t.closest(".sh-rowh") : null;
        if (!h) return;
        commitEdit(false);
        var r2 = parseInt(h.getAttribute("data-r"), 10);
        if (e.shiftKey && selRows) selRows = { r1: Math.min(selRows.r1, r2), r2: Math.max(selRows.r2, r2) };
        else selRows = { r1: r2, r2: r2 };
        selCols = null;
        selChart = null;
        anchor = { c: 0, r: r2 };
        head = { c: 0, r: r2 };
        afterSelChange();
        e.preventDefault();
    }
    function onDocResizeMove(e) {
        if (!drag) return;
        if (drag.mode === "rzc") {
            var w = clamp(drag.startW + (e.clientX - drag.startX) / zoomF, 24, 600);
            sheet().colW[String(drag.c)] = Math.round(w);
            rebuildGeometry();
            renderGrid();
        } else if (drag.mode === "rzr") {
            var h = clamp(drag.startH + (e.clientY - drag.startY) / zoomF, 14, 400);
            sheet().rowH[String(drag.r)] = Math.round(h);
            rebuildGeometry();
            renderGrid();
        }
    }
    function onDocResizeUp() {
        document.removeEventListener("pointermove", onDocResizeMove);
        document.removeEventListener("pointerup", onDocResizeUp);
        if (drag && (drag.mode === "rzc" || drag.mode === "rzr")) {
            drag = null;
            OfficeApp.markDirty();
            undo.push(snap());
        }
    }

    /* ================= cell operations ================= */
    function eachSel(fn) {
        var rg = selRange();
        for (var r = rg.r1; r <= rg.r2; r++) {
            for (var c = rg.c1; c <= rg.c2; c++) fn(c, r);
        }
    }
    function clearSelection(stylesToo) {
        var s = sheet();
        eachSel(function (c, r) {
            var k = key(c, r);
            if (s.cells[k]) {
                if (stylesToo) delete s.cells[k];
                else s.cells[k].v = "";
            }
        });
        commit();
    }
    function applyStyle(fn) {
        eachSel(function (c, r) {
            if (mergeCover[key(c, r)]) return;
            var cell = cellObj(c, r, true);
            if (!cell.s) cell.s = {};
            fn(cell.s);
            // prune empty style objects / cells
            if (Object.keys(cell.s).length === 0) delete cell.s;
            if (cellIsBare(cell)) delete sheet().cells[key(c, r)];
        });
        commit();
        syncToolbarFromSel();
    }
    function toggleStyleFlag(flag) {
        var cur = !!styleAt(anchor.c, anchor.r)[flag];
        applyStyle(function (st) {
            if (cur) delete st[flag]; else st[flag] = true;
        });
    }
    function setNumFmt(fmt) {
        var cur = styleAt(anchor.c, anchor.r).fmt || "general";
        var next = (cur === fmt) ? "general" : fmt;
        applyStyle(function (st) {
            if (next === "general") { delete st.fmt; delete st.dec; }
            else st.fmt = next;
        });
    }
    function bumpDecimals(delta) {
        applyStyle(function (st) {
            if (!st.fmt || st.fmt === "general") st.fmt = "number";
            var d = (st.dec === undefined || st.dec === null) ? 2 : st.dec;
            st.dec = clamp(d + delta, 0, 10);
        });
    }

    /* merge / unmerge */
    function mergeSelection() {
        var rg = selRange();
        if (rg.c1 === rg.c2 && rg.r1 === rg.r2) return;
        var s = sheet();
        // remove merges inside the new one
        s.merges = s.merges.filter(function (m) {
            var mr = parseRange(m);
            return !(mr && mr.c1 >= rg.c1 && mr.c2 <= rg.c2 && mr.r1 >= rg.r1 && mr.r2 <= rg.r2);
        });
        s.merges.push(rangeStr(rg));
        // keep only the anchor's content
        for (var r = rg.r1; r <= rg.r2; r++) {
            for (var c = rg.c1; c <= rg.c2; c++) {
                if (c === rg.c1 && r === rg.r1) continue;
                var k = key(c, r);
                if (s.cells[k]) s.cells[k].v = "";
            }
        }
        setActive(rg.c1, rg.r1);
        commit();
    }
    function unmergeSelection() {
        var rg = selRange();
        var s = sheet();
        s.merges = s.merges.filter(function (m) {
            var mr = parseRange(m);
            return !(mr && mr.c1 <= rg.c2 && mr.c2 >= rg.c1 && mr.r1 <= rg.r2 && mr.r2 >= rg.r1);
        });
        commit();
    }

    /* rows / cols insert & delete */
    function shiftKeyedMap(map, index, count) {
        var out = {};
        Object.keys(map).forEach(function (k) {
            var i = parseInt(k, 10);
            if (count > 0) out[i >= index ? String(i + count) : k] = map[k];
            else {
                var del = -count;
                if (i >= index && i < index + del) return;
                out[i >= index + del ? String(i - del) : k] = map[k];
            }
        });
        return out;
    }
    /* Reposition the sparse cell map, then adjust every formula once.
       Deleted-range refs become #REF!, later refs shift. */
    function insertDeleteFixed(axis, index, count) {
        commitEdit(false);
        var s = sheet();
        var cells = {};
        Object.keys(s.cells).forEach(function (k) {
            var p = F.parseCellKey(k);
            if (!p) return;
            var v = axis === "col" ? p.col : p.row;
            var nv = v;
            if (count > 0) { if (v >= index) nv = v + count; }
            else {
                var del = -count;
                if (v >= index && v < index + del) return;
                if (v >= index + del) nv = v - del;
            }
            cells[key(axis === "col" ? nv : p.col, axis === "row" ? nv : p.row)] = s.cells[k];
        });
        s.cells = cells;
        // formulas on every sheet that point at this one shift with it
        eachFormulaCell(function (cell, si) {
            cell.v = F.adjustInsertDelete(cell.v, axis, index, count,
                { target: s.name, home: body.sheets[si].name });
        });
        if (axis === "col") {
            s.colW = shiftKeyedMap(s.colW, index, count);
            s.cols = clamp(s.cols + count, 1, MAX_COLS);
        } else {
            s.rowH = shiftKeyedMap(s.rowH, index, count);
            s.rows = clamp(s.rows + count, 1, MAX_ROWS);
            s.hiddenRows = cleanRowList(s.hiddenRows.map(function (r) {
                if (count > 0) return r >= index ? r + count : r;
                if (r >= index && r < index - count) return -1;     // deleted
                return r >= index - count ? r + count : r;
            }), s.rows);
        }
        s.merges = s.merges.map(function (m) {
            var rg = parseRange(m);
            if (!rg) return null;
            var lo = axis === "col" ? "c1" : "r1", hi = axis === "col" ? "c2" : "r2";
            [lo, hi].forEach(function (kk) {
                var v = rg[kk];
                if (count > 0) { if (v >= index) rg[kk] = v + count; }
                else {
                    var del = -count;
                    if (v >= index + del) rg[kk] = v - del;
                    else if (v >= index) rg[kk] = index;
                }
            });
            if (rg.c1 === rg.c2 && rg.r1 === rg.r2) return null;
            return rangeStr(rg);
        }).filter(function (m) { return !!m; });
        // rule ids ride along inside the cells; only the anchors that their
        // relative references are measured from need moving
        if (window.SheetsCF) SheetsCF.shiftAnchors(axis, index, count);
        setActive(clamp(head.c, 0, s.cols - 1), clamp(head.r, 0, s.rows - 1));
        commit();
    }

    /* ================= clipboard ================= */
    function tsvOfRange(rg, computed) {
        var lines = [];
        for (var r = rg.r1; r <= rg.r2; r++) {
            var row = [];
            for (var c = rg.c1; c <= rg.c2; c++) {
                var t = computed ? displayText(c, r) : String(rawAt(c, r));
                row.push(t.replace(/\t/g, " ").replace(/\r?\n/g, " "));
            }
            lines.push(row.join("\t"));
        }
        return lines.join("\n");
    }
    function buildInternalClip(rg) {
        var rows = [];
        var s = sheet();
        for (var r = rg.r1; r <= rg.r2; r++) {
            var row = [];
            for (var c = rg.c1; c <= rg.c2; c++) {
                var cell = s.cells[key(c, r)];
                row.push(cell ? deep(cell) : null);
            }
            rows.push(row);
        }
        // the cells carry rule ids; the bodies must ride along too, or a
        // paste onto another sheet would land ids that resolve to nothing
        var defs = {};
        rows.forEach(function (row) {
            row.forEach(function (cell) {
                (cell && cell.cf ? cell.cf : []).forEach(function (id) {
                    if (s.cfDefs && s.cfDefs[id]) defs[id] = deep(s.cfDefs[id]);
                });
            });
        });
        return {
            w: rg.c2 - rg.c1 + 1, h: rg.r2 - rg.r1 + 1,
            src: { c: rg.c1, r: rg.r1 }, cells: rows, rg: rg, defs: defs
        };
    }
    /* charts ride the system clipboard as marker JSON, like cells ride
       it as TSV - so Ctrl+C on a selected chart pastes a chart, even
       into another Sheets window */
    var CHART_CLIP_MARKER = "arozos-sheets-chart";
    function selectedChartObj() {
        if (!selChart) return null;
        var charts = sheet().charts || [];
        for (var i = 0; i < charts.length; i++) {
            if (charts[i].id === selChart) return charts[i];
        }
        return null;
    }
    function parseChartClipboardText(t) {
        if (!t || t.indexOf(CHART_CLIP_MARKER) < 0) return null;
        try {
            var o = JSON.parse(t);
            if (o && o.app === CHART_CLIP_MARKER && o.chart && o.chart.range) return o.chart;
        } catch (e) { }
        return null;
    }
    // e = ClipboardEvent for sync writes (Ctrl+C); null = menu path (async)
    function copySelectedChart(isCut, e) {
        var ch = selectedChartObj();
        if (!ch) return false;
        var txt = JSON.stringify({ app: CHART_CLIP_MARKER, version: 1, chart: deep(ch) });
        var html = (window.SheetsIO && SheetsIO.chartToImageHtml) ? SheetsIO.chartToImageHtml(ch) : "";
        if (e && e.clipboardData) {
            e.clipboardData.setData("text/plain", txt);
            if (html) e.clipboardData.setData("text/html", html);
            e.preventDefault();
        } else {
            OfficeClipboard.writeAsync({ text: txt, html: html }).catch(function () { });
        }
        if (isCut) {
            var s = sheet();
            s.charts = (s.charts || []).filter(function (c) { return c.id !== ch.id; });
            selChart = null;
            commit();
        }
        OfficeApp.setStatus(isCut ? "Chart cut" : "Chart copied");
        return true;
    }
    function pasteChart(ch) {
        var s = sheet();
        var n = deep(ch);
        n.id = "ch-" + Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
        n.x = (Number(n.x) || 0) + 20;
        n.y = (Number(n.y) || 0) + 20;
        if (!s.charts) s.charts = [];
        s.charts.push(n);
        selChart = n.id;
        commit();
        OfficeApp.setStatus("Chart pasted");
    }
    // an HTML <table> snapshot of a range so cells paste into Docs/Slides
    function htmlOfRange(rg) {
        var rows = [];
        for (var r = rg.r1; r <= rg.r2; r++) {
            var row = [];
            for (var c = rg.c1; c <= rg.c2; c++) {
                row.push(esc(displayText(c, r)));
            }
            rows.push(row);
        }
        return OfficeClipboard.tableHtml(rows);
    }
    function onCopy(e, isCut) {
        if (editing || isTypingTarget(document.activeElement) && document.activeElement !== gridEl) return;
        if (copySelectedChart(isCut, e)) return;
        var rg = selRange();
        clipInternal = buildInternalClip(rg);
        clipTsv = tsvOfRange(rg, true);
        clipCut = !!isCut;
        if (e && e.clipboardData) {
            e.clipboardData.setData("text/plain", clipTsv);
            e.clipboardData.setData("text/html", htmlOfRange(rg));
            e.preventDefault();
        }
        OfficeApp.setStatus((isCut ? "Cut " : "Copied ") + (clipInternal.w * clipInternal.h) + " cell(s)");
    }
    function onPaste(e) {
        if (editing) return;
        if (isTypingTarget(document.activeElement) && document.activeElement !== gridEl) return;
        var cd = e.clipboardData;
        var text = cd ? cd.getData("text/plain") : "";
        var html = cd ? cd.getData("text/html") : "";
        e.preventDefault();
        var chp = parseChartClipboardText(text);
        if (chp) { pasteChart(chp); return; }
        // same-app cells: full fidelity (formulas / styles)
        if (clipInternal && text === clipTsv) { pasteInternal(); return; }
        // a foreign app's marker JSON is never real cell text - use the
        // shared text/html instead (Slides table -> cells)
        if (OfficeClipboard.isMarker(text)) { pasteForeignHtml(html); return; }
        if (text) { pasteText(text); return; }
        pasteForeignHtml(html);
    }
    // ingest a shared text/html payload into the grid; images have no cell
    // home so they are declined with a hint
    function pasteForeignHtml(html) {
        var p = OfficeClipboard.parse(html);
        if (p.tables.length) { pasteHtmlTable(p.tables[0]); return; }
        if (p.images.length) {
            OfficeApp.setStatus("Can't paste an image into a cell - paste it into Slides or Docs", "error");
            return;
        }
        if (p.text.replace(/\s/g, "")) pasteText(p.text);
    }
    function pasteHtmlTable(rows) {
        var s = sheet();
        rows.forEach(function (tr, r) {
            tr.forEach(function (cell, c) {
                var tc = anchor.c + c, tr2 = anchor.r + r;
                if (tc >= MAX_COLS || tr2 >= MAX_ROWS) return;
                growTo(tc + 1, tr2 + 1);
                setRaw(tc, tr2, (cell.textContent || "").replace(/\s+/g, " ").trim());
            });
        });
        head = {
            c: clamp(anchor.c + (rows[0] ? rows[0].length - 1 : 0), 0, s.cols - 1),
            r: clamp(anchor.r + rows.length - 1, 0, s.rows - 1)
        };
        commit();
    }
    function pasteInternal() {
        var s = sheet();
        var w = clipInternal.w, h = clipInternal.h;
        // bring any rule bodies the copied cells refer to onto this sheet
        if (clipInternal.defs) {
            if (!s.cfDefs) s.cfDefs = {};
            Object.keys(clipInternal.defs).forEach(function (id) {
                if (!s.cfDefs[id]) s.cfDefs[id] = deep(clipInternal.defs[id]);
            });
        }
        var dC = anchor.c - clipInternal.src.c;
        var dR = anchor.r - clipInternal.src.r;
        for (var r = 0; r < h; r++) {
            for (var c = 0; c < w; c++) {
                var cell = clipInternal.cells[r][c];
                var tc = anchor.c + c, tr = anchor.r + r;
                if (tc >= MAX_COLS || tr >= MAX_ROWS) continue;
                growTo(tc + 1, tr + 1);
                var k = key(tc, tr);
                if (!cell) { delete s.cells[k]; continue; }
                var nc = deep(cell);
                if (nc.v && String(nc.v).charAt(0) === "=") {
                    nc.v = F.rewriteRelative(nc.v, dC, dR);
                }
                s.cells[k] = nc;
            }
        }
        if (clipCut) {
            var rg = clipInternal.rg;
            for (var rr = rg.r1; rr <= rg.r2; rr++) {
                for (var cc = rg.c1; cc <= rg.c2; cc++) {
                    // don't wipe overlap of the paste target
                    if (cc >= anchor.c && cc < anchor.c + w &&
                        rr >= anchor.r && rr < anchor.r + h) continue;
                    delete s.cells[key(cc, rr)];
                }
            }
            clipCut = false;
            clipInternal = null;
            clipTsv = "";
        }
        // reselect the pasted block
        head = {
            c: clamp(anchor.c + w - 1, 0, sheet().cols - 1),
            r: clamp(anchor.r + h - 1, 0, sheet().rows - 1)
        };
        commit();
    }
    function pasteText(text) {
        var rows = text.replace(/\r/g, "").split("\n");
        if (rows.length && rows[rows.length - 1] === "") rows.pop();
        var s = sheet();
        rows.forEach(function (line, r) {
            line.split("\t").forEach(function (val, c) {
                var tc = anchor.c + c, tr = anchor.r + r;
                if (tc >= MAX_COLS || tr >= MAX_ROWS) return;
                growTo(tc + 1, tr + 1);
                setRaw(tc, tr, val);
            });
        });
        head = {
            c: clamp(anchor.c + (rows[0] ? rows[0].split("\t").length - 1 : 0), 0, s.cols - 1),
            r: clamp(anchor.r + rows.length - 1, 0, s.rows - 1)
        };
        commit();
    }

    /* ================= fill handle ================= */
    function applyFill(rg, dC, dR) {
        var s = sheet();
        var srcW = rg.c2 - rg.c1 + 1, srcH = rg.r2 - rg.r1 + 1;
        var horizontal = dC !== 0;
        var count = Math.abs(horizontal ? dC : dR);
        var dir = (horizontal ? dC : dR) > 0 ? 1 : -1;

        // linear series detection: single row/col of >=2 pure numbers
        var series = null;
        if (horizontal && srcH === 1 && srcW >= 2) {
            series = detectSeries(function (i) { return valueAt(rg.c1 + i, rg.r1); }, srcW);
        } else if (!horizontal && srcW === 1 && srcH >= 2) {
            series = detectSeries(function (i) { return valueAt(rg.c1, rg.r1 + i); }, srcH);
        }

        for (var i = 1; i <= count; i++) {
            var srcIdx = (i - 1) % (horizontal ? srcW : srcH);
            if (dir < 0) srcIdx = (horizontal ? srcW : srcH) - 1 - srcIdx;
            for (var j = 0; j < (horizontal ? srcH : srcW); j++) {
                var sc = horizontal ? (dir > 0 ? rg.c1 + srcIdx : rg.c2 - ((i - 1) % srcW)) : rg.c1 + j;
                var sr = horizontal ? rg.r1 + j : (dir > 0 ? rg.r1 + srcIdx : rg.r2 - ((i - 1) % srcH));
                var tc = horizontal ? (dir > 0 ? rg.c2 + i : rg.c1 - i) : rg.c1 + j;
                var tr = horizontal ? rg.r1 + j : (dir > 0 ? rg.r2 + i : rg.r1 - i);
                if (tc < 0 || tr < 0 || tc >= MAX_COLS || tr >= MAX_ROWS) continue;
                growTo(tc + 1, tr + 1);
                var srcCell = s.cells[key(sc, sr)];
                var k = key(tc, tr);
                if (!srcCell) { delete s.cells[k]; continue; }
                var nc = deep(srcCell);
                if (series && (!nc.v || String(nc.v).charAt(0) !== "=")) {
                    var base = dir > 0 ? series.last : series.first;
                    nc.v = F.numToText(base + series.step * i * dir);
                } else if (nc.v && String(nc.v).charAt(0) === "=") {
                    nc.v = F.rewriteRelative(nc.v, tc - sc, tr - sr);
                }
                s.cells[k] = nc;
            }
        }
        // extend selection over the filled area
        if (horizontal) {
            if (dir > 0) head = { c: rg.c2 + count, r: rg.r2 };
            else anchor = { c: rg.c1 - count, r: rg.r1 };
        } else {
            if (dir > 0) head = { c: rg.c2, r: rg.r2 + count };
            else anchor = { c: rg.c1, r: rg.r1 - count };
        }
        commit();
    }
    function detectSeries(getVal, n) {
        var vals = [];
        for (var i = 0; i < n; i++) {
            var v = getVal(i);
            if (typeof v !== "number") return null;
            vals.push(v);
        }
        var step = vals[1] - vals[0];
        for (var j = 2; j < n; j++) {
            if (Math.abs((vals[j] - vals[j - 1]) - step) > 1e-9) return null;
        }
        return { first: vals[0], last: vals[n - 1], step: step };
    }

    /* ================= move selection (drag the range border) ================= */
    /* Excel semantics: the block's cells (values + styles) relocate;
       every formula reference pointing INTO the source range - from inside
       or outside the block - follows it. Other references are untouched. */
    function moveRange(rg, dC, dR) {
        if (!dC && !dR) return;
        var s = sheet();
        growTo(rg.c2 + dC + 2, rg.r2 + dR + 2);
        // snapshot + clear source
        var snapCells = {};
        var r, c, k;
        for (r = rg.r1; r <= rg.r2; r++) {
            for (c = rg.c1; c <= rg.c2; c++) {
                k = key(c, r);
                if (s.cells[k]) {
                    snapCells[c + "," + r] = s.cells[k];
                    delete s.cells[k];
                }
            }
        }
        // write to target (overwrites whatever was there)
        for (r = rg.r1; r <= rg.r2; r++) {
            for (c = rg.c1; c <= rg.c2; c++) {
                k = key(c + dC, r + dR);
                var cell = snapCells[c + "," + r];
                if (cell) s.cells[k] = cell;
                else delete s.cells[k];
            }
        }
        // references into the moved range follow it (moved formulas included,
        // and formulas on other sheets that point here)
        eachFormulaCell(function (cl, si) {
            cl.v = F.rewriteMovedRange(cl.v, rg, dC, dR, { target: s.name, home: body.sheets[si].name });
        });
        // merges wholly inside the source range move with it
        s.merges = s.merges.map(function (m) {
            var mr = parseRange(m);
            if (!mr) return null;
            if (mr.c1 >= rg.c1 && mr.c2 <= rg.c2 && mr.r1 >= rg.r1 && mr.r2 <= rg.r2) {
                return rangeStr({ c1: mr.c1 + dC, r1: mr.r1 + dR, c2: mr.c2 + dC, r2: mr.r2 + dR });
            }
            return m;
        }).filter(function (m) { return !!m; });
        // select the block at its new home
        anchor = { c: rg.c1 + dC, r: rg.r1 + dR };
        head = { c: rg.c2 + dC, r: rg.r2 + dR };
        selCols = selRows = null;
        commit();
        OfficeApp.setStatus("Moved " + rangeStr(rg) + " to " + rangeStr(selRange()));
    }

    /* is the pointer on the selection border band (but not the fill handle)? */
    function onSelBorder(p) {
        if (editing || selChart || selCols || selRows) return false;
        var rg = selRange();
        var a = cellRect(rg.c1, rg.r1), b = cellRect(rg.c2, rg.r2);
        var x1 = a.x, y1 = a.y, x2 = b.x + b.w, y2 = b.y + b.h;
        var t = 5;
        if (Math.abs(p.x - x2) <= 8 && Math.abs(p.y - y2) <= 8) return false;   // fill handle corner
        var inX = p.x >= x1 - t && p.x <= x2 + t;
        var inY = p.y >= y1 - t && p.y <= y2 + t;
        var nearL = Math.abs(p.x - x1) <= t, nearR = Math.abs(p.x - x2) <= t;
        var nearT = Math.abs(p.y - y1) <= t, nearB = Math.abs(p.y - y2) <= t;
        return (inY && (nearL || nearR)) || (inX && (nearT || nearB));
    }

    /* ================= sort ================= */
    function sortSelection(asc) {
        commitEdit(false);
        var rg = selRange();
        if (rg.r1 === rg.r2) {
            // single row selected: sort the used range of that column instead
            var ur = usedRange();
            rg = { c1: rg.c1, c2: rg.c2, r1: 0, r2: ur.r2 };
        }
        var byCol = anchor.c;
        var s = sheet();
        var rows = [];
        var r, c;
        for (r = rg.r1; r <= rg.r2; r++) {
            var row = { cells: {}, key: valueAt(byCol, r), srcRow: r };
            for (c = rg.c1; c <= rg.c2; c++) {
                var cell = s.cells[key(c, r)];
                if (cell) row.cells[c] = deep(cell);
            }
            rows.push(row);
        }
        rows.sort(function (a, b) {
            var va = a.key, vb = b.key;
            var ea = (va === null || va === undefined || F.isErr(va));
            var eb = (vb === null || vb === undefined || F.isErr(vb));
            if (ea && eb) return 0;
            if (ea) return 1;             // empties always last
            if (eb) return -1;
            var na = typeof va === "number" || typeof va === "boolean";
            var nb = typeof vb === "number" || typeof vb === "boolean";
            var d;
            if (na && nb) d = Number(va) - Number(vb);
            else if (!na && !nb) {
                var sa = String(va).toLowerCase(), sb = String(vb).toLowerCase();
                d = sa < sb ? -1 : (sa > sb ? 1 : 0);
            } else d = na ? -1 : 1;
            return asc ? d : -d;
        });
        for (r = rg.r1; r <= rg.r2; r++) {
            var src = rows[r - rg.r1];
            var dRow = r - src.srcRow;
            for (c = rg.c1; c <= rg.c2; c++) {
                var k = key(c, r);
                var cell = src.cells[c];
                if (cell) {
                    // moved formulas keep pointing at the same relative cells
                    if (dRow !== 0 && cell.v && String(cell.v).charAt(0) === "=") {
                        cell.v = F.rewriteRelative(cell.v, 0, dRow);
                    }
                    s.cells[k] = cell;
                } else {
                    delete s.cells[k];
                }
            }
        }
        commit();
        OfficeApp.setStatus("Sorted " + rangeStr(rg) + " by column " + F.colToName(byCol));
    }

    /* ================= freeze ================= */
    function freezeTo(r, c) {
        sheet().freeze = { r: r, c: c };
        commit();
        renderAll();
    }

    /* ================= hide / unhide rows ================= */
    function userHiddenIn(r1, r2) {
        return sheet().hiddenRows.filter(function (r) { return r >= r1 && r <= r2; });
    }
    // maximal runs [{r1, r2}] of user-hidden rows, for the header markers
    function hiddenRuns() {
        var runs = [], list = sheet().hiddenRows;
        for (var i = 0; i < list.length; i++) {
            var last = runs[runs.length - 1];
            if (last && list[i] === last.r2 + 1) last.r2 = list[i];
            else runs.push({ r1: list[i], r2: list[i] });
        }
        return runs;
    }
    function hideRows(r1, r2) {
        commitEdit(false);
        var s = sheet();
        r1 = clamp(r1, 0, s.rows - 1);
        r2 = clamp(r2, r1, s.rows - 1);
        if (r1 === 0 && r2 === s.rows - 1) {
            OfficeApp.toast("At least one row has to stay visible", "error");
            return;
        }
        var list = s.hiddenRows.slice();
        for (var r = r1; r <= r2; r++) list.push(r);
        s.hiddenRows = cleanRowList(list, s.rows);
        // the selection now has no height: move to the first visible row
        // below the block (or above it, at the end of the sheet)
        var next = r2 + 1;
        while (next < s.rows && s.hiddenRows.indexOf(next) >= 0) next++;
        if (next >= s.rows) {
            next = r1 - 1;
            while (next > 0 && s.hiddenRows.indexOf(next) >= 0) next--;
        }
        commit();       // rebuilds the hidden-row map and geometry
        setActive(clamp(anchor.c, 0, s.cols - 1), clamp(next, 0, s.rows - 1));
        OfficeApp.setStatus(r1 === r2 ? "Row " + (r1 + 1) + " hidden" :
            "Rows " + (r1 + 1) + "-" + (r2 + 1) + " hidden");
    }
    // show the user-hidden rows inside r1..r2 (select the rows around a
    // hidden block to unhide it, as in Excel)
    function unhideRows(r1, r2) {
        commitEdit(false);
        var s = sheet();
        var gone = userHiddenIn(r1, r2);
        if (!gone.length) {
            OfficeApp.setStatus("No hidden rows in the selection");
            return;
        }
        s.hiddenRows = s.hiddenRows.filter(function (r) { return r < r1 || r > r2; });
        commit();
        renderAll();
        OfficeApp.setStatus(gone.length === 1 ? "Row " + (gone[0] + 1) + " shown" : gone.length + " rows shown");
    }
    // Ctrl+Shift+9 / menu on a plain cell selection: widen by one row each
    // side so a block hidden between the selected rows is found
    function unhideAroundSelection() {
        var rg = selRange();
        unhideRows(Math.max(0, rg.r1 - (selRows ? 0 : 1)), rg.r2 + (selRows ? 0 : 1));
    }

    /* ================= defined names ================= */
    /*
        Names are workbook-wide labels for a range or value: SUM(Sales)
        instead of SUM(Data!B2:B99). Each is stored as the formula text it
        stands for, so it survives round-tripping through xlsx.
    */
    function nameManagerDialog() {
        commitEdit(false);
        var $b = $('<div class="sh-names"><table class="sh-name-list"><tbody></tbody></table>' +
            '<div class="sh-name-add"><input id="shNameNew" placeholder="Name" spellcheck="false">' +
            '<input id="shNameRef" placeholder="Range or value, e.g. Data!A1:A9" spellcheck="false">' +
            '<button class="of-btn" id="shNameAdd">Add</button></div>' +
            '<div class="of-dim" id="shNameMsg"></div></div>');
        function refresh() {
            var $t = $b.find(".sh-name-list tbody").empty();
            if (!body.names.length) {
                $t.append('<tr><td colspan="3" class="of-dim">No names yet. ' +
                    'Select a range first to fill the box below with it.</td></tr>');
            }
            body.names.forEach(function (n, i) {
                var $tr = $("<tr></tr>");
                $tr.append($("<td></td>").text(n.name));
                var $ref = $('<input spellcheck="false">').val(n.formula);
                $ref.on("change", function () {
                    var v = String($ref.val()).trim();
                    if (!v) return;
                    body.names[i].formula = v.charAt(0) === "=" ? v : "=" + v;
                    commit();
                    renderAll();
                });
                $tr.append($("<td></td>").append($ref));
                var $del = $('<button class="of-btn" title="Delete"><i class="trash alternate outline icon"></i></button>');
                $del.on("click", function () {
                    body.names.splice(i, 1);
                    commit();
                    renderAll();
                    refresh();
                });
                $tr.append($("<td></td>").append($del));
                $t.append($tr);
            });
        }
        refresh();
        var rg = selRange();
        $b.find("#shNameRef").val(quoteSheetName(sheet().name) + "!" + absRangeStr(rg));
        $b.find("#shNameAdd").on("click", function () {
            var name = String($b.find("#shNameNew").val()).trim();
            var ref = String($b.find("#shNameRef").val()).trim();
            var msg = $b.find("#shNameMsg");
            if (!validName(name)) {
                msg.text("A name must start with a letter and cannot look like a cell or a function.");
                return;
            }
            if (nameEntry(name)) {
                msg.text("There is already a name called " + name + ".");
                return;
            }
            if (!ref) {
                msg.text("Enter the range or value the name stands for.");
                return;
            }
            body.names.push({ name: name, formula: ref.charAt(0) === "=" ? ref : "=" + ref });
            msg.text("");
            $b.find("#shNameNew").val("");
            commit();
            renderAll();
            refresh();
        });
        OfficeApp.dialog({
            title: "Named ranges", body: $b, wide: true,
            buttons: [{ label: "Close", primary: true }]
        });
    }
    function quoteSheetName(n) { return F.quoteSheetName(n); }
    function absRangeStr(rg) {
        return "$" + F.colToName(rg.c1) + "$" + (rg.r1 + 1) +
            (rg.c1 === rg.c2 && rg.r1 === rg.r2 ? "" : ":$" + F.colToName(rg.c2) + "$" + (rg.r2 + 1));
    }

    /* ================= row header context menu ================= */
    function rowHeaderMenu(x, y) {
        var rg = selRange();
        var n = rg.r2 - rg.r1 + 1;
        var rowsLabel = n === 1 ? "row " + (rg.r1 + 1) : "rows " + (rg.r1 + 1) + "-" + (rg.r2 + 1);
        var fz = sheet().freeze;
        var items = [
            { label: "Cut", icon: "cut", key: "Ctrl+X", action: function () { execClipboard("cut"); } },
            { label: "Copy", icon: "copy", key: "Ctrl+C", action: function () { execClipboard("copy"); } },
            { label: "Paste", icon: "paste", key: "Ctrl+V", action: function () { execClipboard("paste"); } },
            { sep: true },
            {
                label: "Insert " + n + " row" + (n > 1 ? "s" : "") + " above", icon: "plus",
                action: function () { insertDeleteFixed("row", rg.r1, n); }
            },
            {
                label: "Insert " + n + " row" + (n > 1 ? "s" : "") + " below", icon: "plus",
                action: function () { insertDeleteFixed("row", rg.r2 + 1, n); }
            },
            {
                label: "Delete " + rowsLabel, icon: "minus",
                action: function () { insertDeleteFixed("row", rg.r1, -n); }
            },
            {
                label: "Clear " + rowsLabel, icon: "eraser", key: "Del",
                action: function () { clearSelection(false); }
            },
            { sep: true },
            {
                label: "Hide " + rowsLabel, icon: "eye slash outline", key: "Ctrl+Alt+9",
                action: function () { hideRows(rg.r1, rg.r2); }
            },
            {
                label: "Unhide rows", icon: "eye", key: "Ctrl+Shift+9",
                enabled: function () { return userHiddenIn(rg.r1, rg.r2).length > 0; },
                action: function () { unhideRows(rg.r1, rg.r2); }
            },
            {
                label: "Unhide all rows", icon: "eye",
                enabled: function () { return sheet().hiddenRows.length > 0; },
                action: function () { unhideRows(0, sheet().rows - 1); }
            },
            { sep: true },
            {
                label: "Resize " + rowsLabel + "...", icon: "arrows alternate vertical",
                action: function () { rowHeightDialog(rg.r1, rg.r2); }
            },
            { sep: true },
            {
                label: "Freeze up to row " + (rg.r2 + 1), icon: "lock",
                enabled: function () { return rg.r2 + 1 <= 20; },
                action: function () { freezeTo(rg.r2 + 1, fz.c); }
            },
            {
                label: "Unfreeze rows", icon: "lock open",
                enabled: function () { return fz.r > 0; },
                action: function () { freezeTo(0, fz.c); }
            }
        ];
        OfficeApp.showContextMenu(x, y, items);
    }
    function rowHeightDialog(r1, r2) {
        var cur = sheet().rowH[String(r1)];
        OfficeApp.prompt("Row height", "Height in pixels (14-400)", String(Math.round(cur !== undefined ? cur : DEF_ROWH)), function (v) {
            if (v === null || v === undefined) return;
            var h = parseInt(v, 10);
            if (isNaN(h)) return;
            h = clamp(h, 14, 400);
            for (var r = r1; r <= r2; r++) sheet().rowH[String(r)] = h;
            commit();
            renderAll();
        });
    }
    function onRowHeadContextMenu(e) {
        e.preventDefault();
        var h = e.target.closest ? e.target.closest(".sh-rowh") : null;
        if (h) {
            var r = parseInt(h.getAttribute("data-r"), 10);
            // right-clicking outside the selected rows selects that row first
            if (!selRows || r < selRows.r1 || r > selRows.r2) {
                commitEdit(false);
                selRows = { r1: r, r2: r };
                selCols = null;
                selChart = null;
                anchor = { c: 0, r: r };
                head = { c: 0, r: r };
                afterSelChange();
            }
        } else if (!selRows) {
            return;
        }
        rowHeaderMenu(e.clientX, e.clientY);
    }

    /* ================= context menus ================= */
    function cellContextMenu(x, y) {
        var rg = selRange();
        var multi = rg.c1 !== rg.c2 || rg.r1 !== rg.r2;
        var items = [
            { label: "Cut", icon: "cut", key: "Ctrl+X", action: function () { execClipboard("cut"); } },
            { label: "Copy", icon: "copy", key: "Ctrl+C", action: function () { execClipboard("copy"); } },
            { label: "Paste", icon: "paste", key: "Ctrl+V", action: function () { execClipboard("paste"); } },
            { sep: true },
            {
                label: "Insert " + (selRows ? (selRows.r2 - selRows.r1 + 1) + " row(s)" : "row above"),
                icon: "plus", action: function () {
                    insertDeleteFixed("row", rg.r1, selRows ? selRows.r2 - selRows.r1 + 1 : 1);
                }
            },
            {
                label: "Insert " + (selCols ? (selCols.c2 - selCols.c1 + 1) + " column(s)" : "column left"),
                icon: "plus", action: function () {
                    insertDeleteFixed("col", rg.c1, selCols ? selCols.c2 - selCols.c1 + 1 : 1);
                }
            },
            {
                label: "Delete row(s)", icon: "minus", action: function () {
                    insertDeleteFixed("row", rg.r1, -(rg.r2 - rg.r1 + 1));
                }
            },
            {
                label: "Delete column(s)", icon: "minus", action: function () {
                    insertDeleteFixed("col", rg.c1, -(rg.c2 - rg.c1 + 1));
                }
            },
            {
                label: "Hide row(s)", icon: "eye slash outline", key: "Ctrl+Alt+9",
                action: function () { hideRows(rg.r1, rg.r2); }
            },
            {
                label: "Unhide rows", icon: "eye", key: "Ctrl+Shift+9",
                enabled: function () { return userHiddenIn(Math.max(0, rg.r1 - 1), rg.r2 + 1).length > 0; },
                action: unhideAroundSelection
            },
            { sep: true },
            {
                label: "Sort range A → Z", icon: "sort amount down",
                action: function () { sortSelection(true); }
            },
            {
                label: "Sort range Z → A", icon: "sort amount up",
                action: function () { sortSelection(false); }
            },
            { sep: true },
            {
                label: (noteAt(anchor.c, anchor.r) ? "Edit note..." : "Add note..."),
                icon: "sticky note outline", key: "Shift+F2",
                action: function () { noteDialog(anchor.c, anchor.r); }
            },
            {
                label: "Delete note", icon: "sticky note",
                enabled: function () { return noteAt(anchor.c, anchor.r) !== ""; },
                action: function () { setNote(anchor.c, anchor.r, ""); }
            },
            { sep: true }
        ];
        if (multi) items.push({ label: "Merge cells", icon: "compress", action: mergeSelection });
        items.push({ label: "Unmerge", icon: "expand", action: unmergeSelection });
        items.push({ sep: true });
        items.push({ label: "Clear contents", icon: "eraser", key: "Del", action: function () { clearSelection(false); } });
        items.push({ label: "Clear all (incl. format)", icon: "trash alternate outline", action: function () { clearSelection(true); } });
        OfficeApp.showContextMenu(x, y, items);
    }
    function execClipboard(op) {
        // menu-driven clipboard: fall back to internal buffer + async API
        if (op === "copy" || op === "cut") {
            if (copySelectedChart(op === "cut", null)) return;
            var rg = selRange();
            clipInternal = buildInternalClip(rg);
            clipTsv = tsvOfRange(rg, true);
            clipCut = op === "cut";
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(clipTsv).catch(function () { });
            }
            OfficeApp.setStatus((op === "cut" ? "Cut" : "Copied") + " " + (clipInternal.w * clipInternal.h) + " cell(s)");
        } else {
            if (navigator.clipboard && navigator.clipboard.readText) {
                navigator.clipboard.readText().then(function (t) {
                    var chp = parseChartClipboardText(t);
                    if (chp) pasteChart(chp);
                    else if (OfficeClipboard.isMarker(t)) OfficeApp.setStatus("Use Ctrl+V to paste this here", "info");
                    else if (clipInternal && t === clipTsv) pasteInternal();
                    else if (t) pasteText(t);
                    else if (clipInternal) pasteInternal();
                }).catch(function () {
                    if (clipInternal) pasteInternal();
                    else OfficeApp.setStatus("Use Ctrl+V to paste here", "error");
                });
            } else if (clipInternal) {
                pasteInternal();
            }
        }
    }

    /* ================= toolbar ================= */
    function tbtn(icon, title, fn, id) {
        var $b = $('<button type="button" class="of-tbtn"' + (id ? ' id="' + id + '"' : "") +
            ' title="' + esc(title) + '"><i class="' + icon + ' icon"></i></button>');
        $b.on("mousedown", function (e) { e.preventDefault(); });
        $b.on("click", fn);
        return $b;
    }
    function buildToolbar() {
        var $tb = $("#toolbar").empty();
        $tb.append(tbtn("undo", "Undo (Ctrl+Z)", doUndo));
        $tb.append(tbtn("redo", "Redo (Ctrl+Y)", doRedo));
        $tb.append('<div class="of-tsep"></div>');
        $tb.append(tbtn("dollar sign", "Format as currency", function () { setNumFmt("currency"); }, "shBtnCurrency"));
        $tb.append(tbtn("percent", "Format as percent", function () { setNumFmt("percent"); }, "shBtnPercent"));
        var $dm = $('<button type="button" class="of-tbtn" title="Decrease decimal places">.0</button>');
        $dm.on("mousedown", function (e) { e.preventDefault(); });
        $dm.on("click", function () { bumpDecimals(-1); });
        var $dp = $('<button type="button" class="of-tbtn" title="Increase decimal places">.00</button>');
        $dp.on("mousedown", function (e) { e.preventDefault(); });
        $dp.on("click", function () { bumpDecimals(1); });
        $tb.append($dm).append($dp);
        $tb.append('<div class="of-tsep"></div>');
        $tb.append(tbtn("bold", "Bold (Ctrl+B)", function () { toggleStyleFlag("b"); }, "shBtnBold"));
        $tb.append(tbtn("italic", "Italic (Ctrl+I)", function () { toggleStyleFlag("i"); }, "shBtnItalic"));
        $tb.append(tbtn("underline", "Underline (Ctrl+U)", function () { toggleStyleFlag("u"); }, "shBtnUnderline"));
        var $tc = OfficeColorPicker.swatchInput({
            id: "shTextColor", title: "Text color", value: "#202124"
        });
        $tc.on("change", function () {
            var v = $tc.val();
            applyStyle(function (st) { st.fc = v; });
        });
        $tb.append($tc);
        var $fc = OfficeColorPicker.swatchInput({
            id: "shFillColor", title: "Fill color", value: "#ffff88",
            allowNone: true, noneLabel: "No fill"
        });
        $fc.on("change", function () {
            var v = $fc.val();
            applyStyle(function (st) { if (v) st.bg = v; else delete st.bg; });
        });
        $tb.append($fc);
        $tb.append(tbtn("th", "Toggle borders", function () {
            var cur = !!styleAt(anchor.c, anchor.r).bd;
            applyStyle(function (st) { if (cur) delete st.bd; else st.bd = 1; });
        }));
        $tb.append('<div class="of-tsep"></div>');
        $tb.append(tbtn("compress", "Merge cells", function () {
            var rg = selRange();
            if (rg.c1 === rg.c2 && rg.r1 === rg.r2) unmergeSelection();
            else if (mergeAnchor[key(rg.c1, rg.r1)]) unmergeSelection();
            else mergeSelection();
        }));
        [["align left", "l"], ["align center", "c"], ["align right", "r"]].forEach(function (a) {
            $tb.append(tbtn(a[0], "Align " + a[1], function () {
                applyStyle(function (st) {
                    if (st.al === a[1]) delete st.al; else st.al = a[1];
                });
            }));
        });
        $tb.append(tbtn("text width", "Wrap text", function () { toggleStyleFlag("wrap"); }));
        $tb.append('<div class="of-tsep"></div>');
        $tb.append(tbtn("chart bar", "Insert chart from selection", function () {
            if (window.SheetsIO) SheetsIO.chartDialog(null);
        }));
        $tb.append(tbtn("filter", "Create / remove filter on selection", function () {
            if (window.SheetsIO) SheetsIO.toggleFilter();
        }, "shBtnFilter"));
        $tb.append(tbtn("paint brush", "Conditional formatting", function () {
            if (window.SheetsCF) SheetsCF.open();
        }, "shBtnCondFmt"));
    }
    function syncToolbarFromSel() {
        var s = styleAt(anchor.c, anchor.r);
        $("#shBtnBold").toggleClass("active", !!s.b);
        $("#shBtnItalic").toggleClass("active", !!s.i);
        $("#shBtnUnderline").toggleClass("active", !!s.u);
        $("#shBtnFilter").toggleClass("active", !!sheet().filter);
        // lit when the cell under the cursor carries a rule of its own
        var ac = sheet().cells[key(anchor.c, anchor.r)];
        $("#shBtnCondFmt").toggleClass("active", !!(ac && ac.cf && ac.cf.length));
        $("#shBtnCurrency").toggleClass("active", s.fmt === "currency");
        $("#shBtnPercent").toggleClass("active", s.fmt === "percent");
    }

    /* ================= menus ================= */
    function insertMenuItems() {
        var rg = selRange();
        return [
            { label: "Row above", icon: "plus", action: function () { insertDeleteFixed("row", rg.r1, 1); } },
            { label: "Row below", icon: "plus", action: function () { insertDeleteFixed("row", rg.r2 + 1, 1); } },
            { label: "Column left", icon: "plus", action: function () { insertDeleteFixed("col", rg.c1, 1); } },
            { label: "Column right", icon: "plus", action: function () { insertDeleteFixed("col", rg.c2 + 1, 1); } },
            { sep: true },
            {
                label: "Chart...", icon: "chart bar",
                action: function () { if (window.SheetsIO) SheetsIO.chartDialog(null); }
            },
            { label: "New sheet", icon: "plus square outline", action: addSheet }
        ];
    }
    function formatMenuItems() {
        var fmts = [
            ["general", "Automatic"], ["number", "Number (1,234.56)"],
            ["percent", "Percent (12.34%)"], ["currency", "Currency ($1,234.00)"],
            ["date", "Date (2026-07-10)"], ["text", "Plain text"]
        ];
        return [
            {
                label: "Number format", icon: "hashtag", sub: fmts.map(function (f) {
                    return {
                        label: f[1],
                        checked: function () { return (styleAt(anchor.c, anchor.r).fmt || "general") === f[0]; },
                        action: function () { setNumFmt(f[0]); }
                    };
                })
            },
            { label: "Increase decimals", action: function () { bumpDecimals(1); } },
            { label: "Decrease decimals", action: function () { bumpDecimals(-1); } },
            { sep: true },
            { label: "Bold", icon: "bold", key: "Ctrl+B", action: function () { toggleStyleFlag("b"); } },
            { label: "Italic", icon: "italic", key: "Ctrl+I", action: function () { toggleStyleFlag("i"); } },
            { label: "Underline", icon: "underline", key: "Ctrl+U", action: function () { toggleStyleFlag("u"); } },
            { label: "Wrap text", checked: function () { return !!styleAt(anchor.c, anchor.r).wrap; }, action: function () { toggleStyleFlag("wrap"); } },
            { sep: true },
            {
                label: "Conditional formatting...", icon: "paint brush",
                action: function () { if (window.SheetsCF) SheetsCF.open(); }
            },
            {
                label: "Clear conditional formatting", icon: "eraser",
                enabled: function () {
                    return !!(window.SheetsCF && SheetsCF.selectionHasRules());
                },
                action: function () { if (window.SheetsCF) SheetsCF.clearForSelection(); }
            },
            { sep: true },
            { label: "Merge cells", icon: "compress", action: mergeSelection },
            { label: "Unmerge", icon: "expand", action: unmergeSelection },
            { sep: true },
            { label: "Clear formatting", icon: "eraser", action: function () { applyStyle(function (st) { Object.keys(st).forEach(function (k) { delete st[k]; }); }); } }
        ];
    }
    function dataMenuItems() {
        var fz = sheet().freeze;
        return [
            { label: "Sort range A → Z", icon: "sort amount down", action: function () { sortSelection(true); } },
            { label: "Sort range Z → A", icon: "sort amount up", action: function () { sortSelection(false); } },
            { sep: true },
            {
                label: sheet().filter ? "Remove filter" : "Create filter", icon: "filter",
                action: function () { if (window.SheetsIO) SheetsIO.toggleFilter(); }
            },
            { sep: true },
            {
                label: "Named ranges...", icon: "tag",
                action: nameManagerDialog
            },
            { sep: true },
            {
                label: "Pivot table...", icon: "table",
                action: function () { if (window.SheetsIO) SheetsIO.pivotDialog(); }
            },
            {
                label: "Refresh pivot table", icon: "sync alternate",
                enabled: function () { return !!sheet().pivot; },
                action: function () { if (window.SheetsIO) SheetsIO.refreshPivot(); }
            },
            { sep: true },
            {
                label: "Freeze up to row " + (head.r + 1),
                action: function () { freezeTo(head.r + 1, fz.c); }
            },
            {
                label: "Freeze up to column " + F.colToName(head.c),
                action: function () { freezeTo(fz.r, head.c + 1); }
            },
            {
                label: "Unfreeze", enabled: function () { return fz.r > 0 || fz.c > 0; },
                action: function () { freezeTo(0, 0); }
            }
        ];
    }

    /* ================= init ================= */
    function initDomRefs() {
        gridEl = document.getElementById("shGrid");
        cellsEl = document.getElementById("shCells");
        spacerEl = document.getElementById("shSpacer");
        frozenRowsEl = document.getElementById("shFrozenRows");
        frozenColsEl = document.getElementById("shFrozenCols");
        frozenCornerEl = document.getElementById("shFrozenCorner");
        colHeadIn = document.getElementById("shColHeadIn");
        rowHeadIn = document.getElementById("shRowHeadIn");
        inputEl = document.getElementById("shCellInput");
        rangeBoxEl = document.getElementById("shRangeBox");
        spillBoxEl = document.getElementById("shSpillBox");
        fillEl = document.getElementById("shFillHandle");

        gridEl.setAttribute("tabindex", "0");
        gridEl.addEventListener("scroll", function () {
            if (!rafPending) {
                rafPending = true;
                requestAnimationFrame(function () {
                    rafPending = false;
                    renderGrid();
                });
            }
        });
        gridEl.addEventListener("pointerdown", onGridPointerDown);
        gridEl.addEventListener("pointermove", onGridPointerMove);
        gridEl.addEventListener("pointerup", onGridPointerUp);
        gridEl.addEventListener("dblclick", onGridDblClick);
        gridEl.addEventListener("contextmenu", onGridContextMenu);

        document.getElementById("shColHead").addEventListener("pointerdown", onColHeadDown);
        document.getElementById("shRowHead").addEventListener("pointerdown", onRowHeadDown);
        document.getElementById("shRowHead").addEventListener("contextmenu", onRowHeadContextMenu);
        document.getElementById("shCorner").addEventListener("click", function () {
            var ur = usedRange();
            anchor = { c: 0, r: 0 };
            head = { c: ur.c2, r: ur.r2 };
            selCols = selRows = null;
            afterSelChange();
        });

        inputEl.addEventListener("keydown", onInputKeyDown);
        inputEl.addEventListener("blur", function () {
            setTimeout(function () {
                if (editing && !editing.viaFx && document.activeElement !== inputEl &&
                    document.activeElement !== document.getElementById("shFxInput")) {
                    commitEdit(false);
                }
            }, 0);
        });

        // formula bar
        var $fx = $("#shFxInput");
        $fx.on("focus", function () {
            if (!editing) startEdit(rawAt(head.c, head.r), true);
        });
        $fx.on("input", function () {
            if (editing) inputEl.value = $fx.val();
        });
        $fx.on("keydown", function (e) {
            if (e.key === "Enter") {
                e.preventDefault();
                commitEdit(true);
                moveHead(0, 1, false);
            } else if (e.key === "Escape") {
                e.preventDefault();
                cancelEdit();
            } else if (e.key === "Tab") {
                e.preventDefault();
                commitEdit(true);
                moveHead(1, 0, false);
            }
        });
        var $nb = $("#shNameBox");
        $nb.on("keydown", function (e) {
            if (e.key !== "Enter") return;
            e.preventDefault();
            var rg = parseRange($nb.val());
            if (rg) {
                growTo(rg.c2 + 1, rg.r2 + 1);
                anchor = { c: rg.c1, r: rg.r1 };
                head = { c: rg.c2, r: rg.r2 };
                selCols = selRows = null;
                afterSelChange();
                scrollIntoView(rg.c1, rg.r1);
                gridEl.focus();
            }
        });

        $("#shAddSheet").on("click", addSheet);

        document.addEventListener("copy", function (e) { onCopy(e, false); });
        document.addEventListener("cut", function (e) {
            if (editing || (isTypingTarget(document.activeElement) && document.activeElement !== gridEl)) return;
            onCopy(e, true);
        });
        document.addEventListener("paste", onPaste);
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("resize", function () { renderGrid(); });
    }

    function init() {
        undo = new OfficeUndoStack({ limit: 80, apply: applyUndoState });
        initDomRefs();

        OfficeApp.init({
            appName: "Sheets",
            appType: "spreadsheet",
            appIcon: "../img/sheets.svg",
            extension: ".xlsa",
            fileTypeName: "Spreadsheet",
            packed: true,
            defaultFileName: "New Spreadsheet",

            serialize: function () { return deep(body); },
            deserialize: function (b) {
                body = normalizeBody(b);
                anchor = { c: 0, r: 0 };
                head = { c: 0, r: 0 };
                selCols = selRows = null;
                rebuildCalc();
                renderAll();
                undo.init(snap());
            },
            create: function () {
                body = defaultBody();
                anchor = { c: 0, r: 0 };
                head = { c: 0, r: 0 };
                rebuildCalc();
                renderAll();
                undo.init(snap());
            },

            importers: {
                ".csv": function (text, fn) { SheetsIO.importDelimited(text, fn, ","); },
                ".tsv": function (text, fn) { SheetsIO.importDelimited(text, fn, "\t"); }
            },
            binaryImporters: {
                ".xlsx": function (fp, fn) { SheetsIO.importXlsx(fp, fn); },
                ".ods": function (fp, fn) { SheetsIO.importOds(fp, fn); }
            },
            // a workbook opened from one of these keeps saving back into it
            // (File > Save as offers the same list)
            saveFormats: SheetsIO.saveFormats,

            onUndo: doUndo,
            onRedo: doRedo,
            canUndo: function () { return undo.canUndo(); },
            canRedo: function () { return undo.canRedo(); },

            onCut: function () { execClipboard("cut"); },
            onCopy: function () { execClipboard("copy"); },
            onPaste: function () { execClipboard("paste"); },

            menus: [
                { title: "Insert", items: insertMenuItems },
                { title: "Format", items: formatMenuItems },
                { title: "Data", items: dataMenuItems }
            ],
            /*
                .xlsx / .ods need the Office converters - the AGI backend in
                ArozOS, the WebAssembly module in the web edition. The
                real-text .pdf renderer is still server-only, so the web
                edition points at File > Print / PDF for that. The delimited
                exports are written right here and always available.
            */
            fileMenuExtras: [
                !OfficePlatform.canConvert() ? null : {
                    label: "Import Excel / OpenDocument...", icon: "file excel outline",
                    action: function () { SheetsIO.importXlsxDialog(); }
                },
                {
                    label: "Export", icon: "external alternate", sub: function () {
                        var items = [];
                        if (OfficePlatform.canConvert()) {
                            items.push({ label: "Excel (.xlsx)", icon: "file excel outline", action: function () { SheetsIO.exportXlsx(); } });
                            items.push({ label: "OpenDocument (.ods)", icon: "file alternate outline", action: function () { SheetsIO.exportOds(); } });
                        }
                        if (OfficePlatform.hasBackend()) {
                            items.push({ label: "PDF document (.pdf)", icon: "file pdf outline", action: function () { SheetsIO.exportPdf(); } });
                        }
                        items.push({ label: "CSV (current sheet)", icon: "file alternate outline", action: function () { SheetsIO.exportDelimited(","); } });
                        items.push({ label: "TSV (current sheet)", icon: "file alternate outline", action: function () { SheetsIO.exportDelimited("\t"); } });
                        return items;
                    }
                }
            ],

            onZoomChanged: function (pct) {
                zoomF = pct / 100;
                rebuildGeometry();
                renderGrid();
            },
            onBeforePrint: function () { SheetsIO.fillPrintArea(); },
            onAfterPrint: function () { $("#shPrintArea").empty(); }
        });

        OfficeApp.registerShortcut("Ctrl+B", function () { toggleStyleFlag("b"); });
        OfficeApp.registerShortcut("Ctrl+I", function () { toggleStyleFlag("i"); });
        OfficeApp.registerShortcut("Ctrl+U", function () { toggleStyleFlag("u"); });
        // Google Sheets' keys (Excel's Ctrl+9 is taken by the browser's tab switch)
        var hideOpts = { description: "Hide selected rows", group: "Rows", allowInInput: false, inDialogs: false };
        OfficeApp.registerShortcut("Ctrl+Alt+9", function () {
            if (editing) return false;
            var rg = selRange();
            hideRows(rg.r1, rg.r2);
        }, hideOpts);
        var unhideOpts = { description: "Unhide rows in / around the selection", group: "Rows", allowInInput: false, inDialogs: false };
        var unhide = function () {
            if (editing) return false;
            unhideAroundSelection();
        };
        OfficeApp.registerShortcut("Ctrl+Shift+9", unhide, unhideOpts);
        // with Shift held most layouts report "(" for the 9 key
        OfficeApp.registerShortcut("Ctrl+Shift+(", unhide, { group: "Rows", allowInInput: false, inDialogs: false });

        buildToolbar();
        OfficeApp.addStatusItem("stats", "");
        zoomF = OfficeApp.getZoom() / 100;
        rebuildGeometry();
        renderGrid();
        setTimeout(function () { renderGrid(); gridEl.focus(); }, 120);
    }

    $(document).ready(init);

    /* ---------- API used by sheets_io.js ---------- */
    return {
        getBody: function () { return body; },
        /* The body for a converter: a copy where every spill anchor carries
           "a" = the range its array fills, so the xlsx writer can mark it as
           a dynamic-array formula. */
        exportBody: function () {
            var copy = JSON.parse(JSON.stringify(body));
            copy.sheets.forEach(function (sh, si) {
                if (!calc || !calc.spillList) return;
                calc.spillList(si).forEach(function (sp) {
                    var cell = sh.cells[key(sp.c1, sp.r1)];
                    if (cell) cell.a = key(sp.c1, sp.r1) + ":" + key(sp.c2, sp.r2);
                });
            });
            return copy;
        },
        sheet: sheet,
        selRange: selRange,
        setSelection: function (rg) {
            anchor = { c: rg.c1, r: rg.r1 };
            head = { c: rg.c2, r: rg.r2 };
            selCols = selRows = null;
            afterSelChange();
        },
        selectChart: function (id) { selChart = id; renderGrid(); },
        selectedChart: function () { return selChart; },
        copySelectedChart: copySelectedChart,
        pickRangeFromGrid: pickRangeFromGrid,
        readRangeValues: readRangeValues,
        buildPrintModel: buildPrintModel,
        addSheetNamed: addSheetNamed,
        activeSheetIndex: function () { return body.active; },
        valueAt: valueAt,
        displayText: displayText,
        rawAt: rawAt,
        // evaluation context for conditional-format formulas: shares the
        // active sheet's memoized calculator, so rules cost a lookup
        calcCtx: function () { return calc.ctx; },
        cellObj: cellObj,
        // drop a cell that has nothing left on it (used after removing rules)
        pruneCell: function (c, r) {
            var k = key(c, r);
            if (cellIsBare(sheet().cells[k])) delete sheet().cells[k];
        },
        usedRange: usedRange,
        parseRange: parseRange,
        rangeStr: rangeStr,
        commit: commit,
        renderAll: renderAll,
        rebuildCalc: rebuildCalc,
        normalizeBody: normalizeBody,
        setBody: function (b) {
            body = normalizeBody(b);
            anchor = { c: 0, r: 0 };
            head = { c: 0, r: 0 };
            selCols = selRows = null;
            rebuildCalc();
            renderAll();
            undo.init(snap());
        },
        newSheetData: newSheetData,
        gridEl: function () { return gridEl; },
        zoomFactor: function () { return zoomF; },
        markDirtyUndo: function () { OfficeApp.markDirty(); undo.push(snap()); }
    };
})();
