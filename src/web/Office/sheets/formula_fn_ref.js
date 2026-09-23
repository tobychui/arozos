/*
    ArozOS Office Sheets - reference, sheet and conversion functions
    ================================================================
    Registers into the formula engine (formula.js); load after it.

        references  OFFSET INDIRECT ADDRESS ISREF FORMULATEXT CELL
        workbook    SHEET SHEETS
        links       HYPERLINK
        conversion  TO_DATE TO_PERCENT TO_DOLLARS TO_TEXT TO_PURE_NUMBER

    OFFSET / INDIRECT hand back a reference value, so they can be used
    wherever a range can: SUM(OFFSET(A1,0,0,10,1)), A1:INDIRECT("B5").
*/
(function (F) {
    "use strict";
    var ERR = F.ERR, FErr = F.FErr, isErr = F.isErr;

    function def(name, min, max, fn, extra) {
        var spec = { min: min, max: max, fn: fn, cat: "Lookup" };
        for (var k in extra || {}) spec[k] = extra[k];
        F.defineFunction(name, spec);
    }
    function valueErr(msg) { return new FErr(ERR.VALUE, msg); }
    function refErr(msg) { return new FErr(ERR.REF, msg); }
    // the reference an argument points at, or an error
    function needRef(E, node, name) {
        var r = E.ref(node);
        return r || refErr(name + " needs a cell or range reference");
    }

    def("OFFSET", 3, 5, function (a, E) {
        var base = needRef(E, a[0], "OFFSET");
        if (isErr(base)) return base;
        var dr = E.int(a[1]), dc = E.int(a[2]);
        if (isErr(dr)) return dr;
        if (isErr(dc)) return dc;
        var h = E.int(a[3], base.r2 - base.r1 + 1), w = E.int(a[4], base.c2 - base.c1 + 1);
        if (isErr(h)) return h;
        if (isErr(w)) return w;
        if (h < 1 || w < 1) return refErr("OFFSET height and width must be at least 1");
        var r1 = base.r1 + dr, c1 = base.c1 + dc;
        if (r1 < 0 || c1 < 0) return refErr("OFFSET lands outside the sheet");
        return E.makeRef(base.sheet, c1, r1, c1 + w - 1, r1 + h - 1);
    }, { volatile: true, array: true, syntax: "OFFSET(cell_reference, offset_rows, offset_columns, [height], [width])" });

    def("INDIRECT", 1, 2, function (a, E) {
        var text = E.str(a[0]);
        if (isErr(text)) return text;
        var a1 = E.bool(a[1], true);
        if (isErr(a1)) return a1;
        if (!a1) return refErr("INDIRECT only understands A1-style references");
        var ast;
        try { ast = F.parse(String(text).trim()); }
        catch (e) { return refErr("INDIRECT cannot read the reference " + text); }
        var r = E.ref(ast);
        return r || refErr("INDIRECT cannot read the reference " + text);
    }, { volatile: true, array: true, syntax: "INDIRECT(cell_reference_as_string, [is_A1_notation])" });

    def("ADDRESS", 2, 5, function (a, E) {
        var row = E.int(a[0]), col = E.int(a[1]), abs = E.int(a[2], 1);
        if (isErr(row)) return row;
        if (isErr(col)) return col;
        if (isErr(abs)) return abs;
        var a1 = E.bool(a[3], true);
        if (isErr(a1)) return a1;
        var sheet = E.str(a[4], "");
        if (isErr(sheet)) return sheet;
        if (row < 1 || col < 1 || abs < 1 || abs > 4) return valueErr("ADDRESS row, column or absolute mode is out of range");
        var addr;
        if (a1) {
            addr = (abs === 1 || abs === 3 ? "$" : "") + F.colToName(col - 1) +
                (abs === 1 || abs === 2 ? "$" : "") + row;
        } else {
            var rp = abs === 1 || abs === 2 ? "R" + row : "R[" + row + "]";
            var cp = abs === 1 || abs === 3 ? "C" + col : "C[" + col + "]";
            addr = rp + cp;
        }
        return sheet ? F.quoteSheetName(sheet) + "!" + addr : addr;
    }, { elem: true, syntax: "ADDRESS(row, column, [absolute_relative_mode], [use_a1_notation], [sheet])" });

    def("ISREF", 1, 1, function (a, E) {
        return !!E.ref(a[0]);
    }, { cat: "Info", syntax: "ISREF(value)" });

    def("FORMULATEXT", 1, 1, function (a, E) {
        var r = E.ref(a[0]);
        if (!r) return new FErr(ERR.NA, "FORMULATEXT needs a cell reference");
        var raw = E.raw(r.c1, r.r1, r.sheet);
        if (raw === undefined || raw === null || String(raw).charAt(0) !== "=") {
            return new FErr(ERR.NA, "That cell has no formula");
        }
        return String(raw);
    }, { syntax: "FORMULATEXT(cell)" });

    /*
        CELL(info_type, [reference]) - the subset a spreadsheet without
        windows and protection can answer: address, col, row, contents, type,
        prefix, format, width, color, parentheses, protect, filename.
    */
    var FORMAT_CODES = { general: "G", number: "F2", percent: "P2", currency: "C2", date: "D1", text: "G" };
    def("CELL", 1, 2, function (a, E) {
        var info = E.str(a[0]);
        if (isErr(info)) return info;
        info = info.toLowerCase();
        var r = E.ref(a[1]);
        if (!r && E.self) r = E.makeRef(undefined, E.self.col, E.self.row, E.self.col, E.self.row);
        if (!r) return refErr("CELL needs a cell reference");
        var value = E.cell(r.c1, r.r1, r.sheet);
        switch (info) {
            case "address": return "$" + F.colToName(r.c1) + "$" + (r.r1 + 1);
            case "col": return r.c1 + 1;
            case "row": return r.r1 + 1;
            case "contents": return value;
            case "type": return value === null || value === undefined || value === "" ? "b" :
                (typeof value === "string" ? "l" : "v");
            case "prefix": return typeof value === "string" ? "'" : "";
            case "format": {
                var fmt = E.format(r.c1, r.r1, r.sheet) || "general";
                return FORMAT_CODES[fmt] || "G";
            }
            case "width": return 10;
            case "color": return 0;
            case "parentheses": return 0;
            case "protect": return 1;
            case "filename": return "";
        }
        return valueErr("CELL does not know the information type " + info);
    }, { volatile: true, cat: "Info", syntax: "CELL(info_type, reference)" });

    /* ---------- workbook ---------- */
    def("SHEET", 0, 1, function (a, E) {
        var info = E.sheets();
        if (!info) return new FErr(ERR.NA, "SHEET needs a workbook");
        if (E.missing(a[0])) return info.current + 1;
        var r = E.ref(a[0]);
        if (r) {
            var idx = r.sheet === undefined ? info.current : info.indexOf(r.sheet);
            return idx < 0 ? new FErr(ERR.NA, "No sheet called " + r.sheet) : idx + 1;
        }
        var name = E.str(a[0]);
        if (isErr(name)) return name;
        var at = info.indexOf(name);
        return at < 0 ? new FErr(ERR.NA, "No sheet called " + name) : at + 1;
    }, { cat: "Info", syntax: "SHEET([value])" });
    def("SHEETS", 0, 1, function (a, E) {
        var info = E.sheets();
        if (!info) return new FErr(ERR.NA, "SHEETS needs a workbook");
        // a reference never spans sheets here, so it always covers one
        return E.missing(a[0]) ? info.count : 1;
    }, { cat: "Info", syntax: "SHEETS([reference])" });

    /* ---------- links ---------- */
    def("HYPERLINK", 1, 2, function (a, E) {
        var url = E.str(a[0]);
        if (isErr(url)) return url;
        var label = E.missing(a[1]) ? url : E.val(a[1]);
        if (isErr(label)) return label;
        // the grid paints the result as a link
        if (/^(https?:|mailto:|#)/i.test(url.trim())) E.link(url.trim());
        return label === null ? url : label;
    }, { cat: "Web", syntax: "HYPERLINK(url, [link_label])" });

    /* ---------- conversion: value plus the format it should wear ---------- */
    function toFn(name, fmt, convert, cat) {
        def(name, 1, 1, function (a, E) {
            var v = E.val(a[0]);
            if (isErr(v)) return v;
            var out = convert(v, E);
            if (!isErr(out) && fmt) E.hint(fmt);
            return out;
        }, { elem: true, cat: cat || "Parser", syntax: name + "(value)" });
    }
    function asNumber(v) {
        if (v === null || v === undefined) return 0;
        if (typeof v === "number") return v;
        var n = F.toNum(v);
        return isErr(n) ? valueErr("That value is not a number") : n;
    }
    toFn("TO_DATE", "date", asNumber);
    toFn("TO_PERCENT", "percent", asNumber);
    toFn("TO_DOLLARS", "currency", asNumber);
    toFn("TO_PURE_NUMBER", "general", asNumber);
    toFn("TO_TEXT", null, function (v) { return F.toStr(v); });
})(typeof module !== "undefined" && module.exports ? require("./formula.js") : SheetFormula);
