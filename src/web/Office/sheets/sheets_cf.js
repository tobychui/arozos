/*
    ArozOS Office - Sheets: conditional formatting.
    Requires sheets.js (SheetsApp core API) and formula.js.

    Rules belong to CELLS, not to the sheet. Each cell lists the rules it
    carries and the sheet holds the rule bodies, keyed by id:

        cell.cf    = ["cf-a1b2", ...]     // this cell's rules, in order
        sheet.cfDefs["cf-a1b2"] = {
            anchor: "B2",                 // cell the relative refs are read from
            type:   "gt" | "contains" | "formula" | ...   (see CONDS)
            v1:     "200",                // operand(s), kept as typed
            v2:     "",                   // second operand for between
            style:  { bg, fc, b, i, u }   // what a matching cell gets
        }

    Ownership per cell is what makes a rule behave like the rest of a cell's
    formatting: it shows up in the panel only for the cells that actually
    carry it, and it travels on move, copy and fill because those already
    move whole cell objects. Applying to a range simply stamps the id onto
    every cell in it, so range-wide rules still take one action.

    The id is shared, so editing a rule is copy-on-write: the edit mints a
    new def and swaps it onto just the cells being edited, leaving any other
    cells that happened to share the old rule alone. Defs nobody references
    are swept up afterwards.

    Rules are first-match-wins *per property*, the way Google Sheets does it:
    the topmost matching rule that sets a background decides the background,
    and a later rule can still contribute a text color the first one left
    alone. Only bg/fc/b/i/u are conditional - number format, alignment and
    borders always come from the cell's own style.

    Operands may be cell references or formulas ("=AVERAGE($F$2:$F$99)"),
    and a "Custom formula" rule evaluates its formula per cell. Both shift
    relative references by the cell's offset from the rule's anchor, so
    "=$F2>=SUM($C2:$E2)" stamped down a column tests every row against its
    own total.
*/

var SheetsCF = (function () {
    "use strict";

    var Core = SheetsApp;
    var F = SheetFormula;

    function esc(t) { return OfficeApp.escapeHtml(t); }

    /* ================= condition catalogue ================= */
    /* args: how many operand boxes the editor shows.
       kind: which help text / placeholder the editor uses. */
    var CONDS = [
        { id: "notempty", label: "Is not empty", args: 0 },
        { id: "empty", label: "Is empty", args: 0 },
        { id: "contains", label: "Text contains", args: 1, kind: "text" },
        { id: "notcontains", label: "Text does not contain", args: 1, kind: "text" },
        { id: "startswith", label: "Text starts with", args: 1, kind: "text" },
        { id: "endswith", label: "Text ends with", args: 1, kind: "text" },
        { id: "exact", label: "Text is exactly", args: 1, kind: "text" },
        { id: "eq", label: "Is equal to", args: 1, kind: "num" },
        { id: "ne", label: "Is not equal to", args: 1, kind: "num" },
        { id: "gt", label: "Is greater than", args: 1, kind: "num" },
        { id: "gte", label: "Is greater than or equal to", args: 1, kind: "num" },
        { id: "lt", label: "Is less than", args: 1, kind: "num" },
        { id: "lte", label: "Is less than or equal to", args: 1, kind: "num" },
        { id: "between", label: "Is between", args: 2, kind: "num" },
        { id: "notbetween", label: "Is not between", args: 2, kind: "num" },
        { id: "dbefore", label: "Date is before", args: 1, kind: "date" },
        { id: "dafter", label: "Date is after", args: 1, kind: "date" },
        { id: "don", label: "Date is", args: 1, kind: "date" },
        { id: "formula", label: "Custom formula is", args: 1, kind: "formula" }
    ];
    function condById(id) {
        for (var i = 0; i < CONDS.length; i++) if (CONDS[i].id === id) return CONDS[i];
        return CONDS[0];
    }

    var DEFAULT_STYLE = { bg: "#b7e1cd", fc: "", b: false, i: false, u: false };

    /* ================= value helpers ================= */
    function textOf(v) {
        if (v === null || v === undefined) return "";
        if (F.isErr(v)) return v.code;
        if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
        if (typeof v === "number") return F.numToText(v);
        return String(v);
    }
    // numeric view of a value, or null when it is not a number
    function numOf(v) {
        if (typeof v === "number") return v;
        if (typeof v === "boolean") return v ? 1 : 0;
        if (typeof v === "string") {
            var t = v.trim();
            if (t !== "" && !isNaN(Number(t))) return Number(t);
        }
        return null;
    }
    /* Date operands are typed by hand, so accept both the ISO form the app
       displays and the M/D/Y form a user is likely to paste. */
    function dateSerialOf(s) {
        var t = String(s).trim();
        var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
        if (m) return F.dateToSerial(new Date(+m[1], +m[2] - 1, +m[3]));
        m = /^(\d{1,2})[/](\d{1,2})[/](\d{4})$/.exec(t);
        if (m) return F.dateToSerial(new Date(+m[3], +m[1] - 1, +m[2]));
        return null;
    }

    /* ================= compiled formulas =================
       Parsing per cell would be far too slow on a repainting grid, so each
       distinct formula is parsed once and its reference nodes are collected.
       Evaluating for a cell just rewrites those nodes in place - relative
       refs shifted by the cell's offset from the range anchor, absolute ones
       left alone - which is what makes "=$F2>100" mean row-by-row. */
    var compiled = {};      // formula source -> {ast, refs} | null when broken

    function collectRefs(node, out) {
        if (!node || typeof node !== "object") return;
        if (node.t === "ref") {
            out.push({ n: node, c: node.col, r: node.row, absC: !!node.absC, absR: !!node.absR });
            return;
        }
        if (node.t === "range") {
            [node.a, node.b].forEach(function (e) {
                out.push({ n: e, c: e.col, r: e.row, absC: !!e.absC, absR: !!e.absR });
            });
            return;
        }
        Object.keys(node).forEach(function (k) {
            var v = node[k];
            if (Array.isArray(v)) v.forEach(function (x) { collectRefs(x, out); });
            else if (v && typeof v === "object") collectRefs(v, out);
        });
    }
    function compile(src) {
        var body = String(src).replace(/^\s*=/, "").trim();
        if (body === "") return null;
        if (!Object.prototype.hasOwnProperty.call(compiled, body)) {
            var entry = null;
            try {
                var ast = F.parse(body);
                var refs = [];
                collectRefs(ast, refs);
                entry = { ast: ast, refs: refs };
            } catch (e) {
                entry = null;   // a malformed rule simply never matches
            }
            compiled[body] = entry;
        }
        return compiled[body];
    }
    // shift the compiled formula's relative refs, then evaluate it
    function evalAt(entry, dC, dR) {
        if (!entry) return null;
        var ok = true;
        entry.refs.forEach(function (x) {
            var c = x.absC ? x.c : x.c + dC;
            var r = x.absR ? x.r : x.r + dR;
            if (c < 0 || r < 0) ok = false;
            x.n.col = c;
            x.n.row = r;
        });
        if (!ok) return null;   // shifted off the sheet: treat as no match
        try {
            return F.evaluate(entry.ast, Core.calcCtx());
        } catch (e) {
            return null;
        }
    }
    // a bare A1-style reference or range and nothing else: "B3", "$B$3", "B1:B3"
    var REF_RE = /^\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?$/;

    /*
        An operand is a literal the user typed, a cell reference, or a
        formula. References and formulas are shifted per cell exactly like a
        custom formula is, so a rule over B2:B10 comparing against "C2" tests
        every row against its own C - and a single-cell rule shifts by zero,
        which is simply the cell named.

        A bare "B3" counts as a reference for the number and date tests: the
        literal text could never match one of those anyway. Text tests keep
        it literal, because product codes really do look like "B3"; write
        "=B3" there when the cell is what is meant.
    */
    function operandValue(raw, cond, dC, dR) {
        var s = String(raw === undefined || raw === null ? "" : raw).trim();
        if (s === "") return null;
        if (s.charAt(0) === "=") return evalAt(compile(s), dC, dR);
        if (cond && cond.kind !== "text" && REF_RE.test(s)) {
            return evalAt(compile(s), dC, dR);
        }
        return F.literalValue(s);
    }

    /* ================= rule evaluation ================= */
    function matches(rule, c, r, anchor) {
        var cond = condById(rule.type);
        if (cond.id === "formula") {
            var v = evalAt(compile(rule.v1), c - anchor.c, r - anchor.r);
            if (v === null || F.isErr(v)) return false;
            if (typeof v === "boolean") return v;
            if (typeof v === "number") return v !== 0;
            return String(v).toUpperCase() === "TRUE";
        }
        var val = Core.valueAt(c, r);
        if (F.isErr(val)) return false;
        var isBlank = val === null || val === undefined || val === "";
        if (cond.id === "empty") return isBlank;
        if (cond.id === "notempty") return !isBlank;
        if (isBlank) return false;   // every other test needs something to test

        var dC = c - anchor.c, dR = r - anchor.r;
        var a = operandValue(rule.v1, cond, dC, dR);
        if (cond.kind === "text") {
            var hay = textOf(val).toLowerCase();
            var needle = textOf(a).toLowerCase();
            if (needle === "") return false;
            switch (cond.id) {
                case "contains": return hay.indexOf(needle) >= 0;
                case "notcontains": return hay.indexOf(needle) < 0;
                case "startswith": return hay.lastIndexOf(needle, 0) === 0;
                case "endswith": return hay.length >= needle.length &&
                    hay.indexOf(needle, hay.length - needle.length) >= 0;
                case "exact": return hay === needle;
            }
            return false;
        }
        if (cond.kind === "date") {
            var cellSerial = numOf(val);
            var want = numOf(a);
            if (want === null) want = dateSerialOf(rule.v1);
            if (cellSerial === null || want === null) return false;
            // compare whole days, so a timestamp still matches its date
            var cd = Math.floor(cellSerial), wd = Math.floor(want);
            if (cond.id === "dbefore") return cd < wd;
            if (cond.id === "dafter") return cd > wd;
            return cd === wd;
        }
        // numeric comparisons; equality also works for plain text
        var n = numOf(val), an = numOf(a);
        if (cond.id === "eq" || cond.id === "ne") {
            var same = (n !== null && an !== null) ? n === an :
                textOf(val).toLowerCase() === textOf(a).toLowerCase();
            return cond.id === "eq" ? same : !same;
        }
        if (n === null || an === null) return false;
        switch (cond.id) {
            case "gt": return n > an;
            case "gte": return n >= an;
            case "lt": return n < an;
            case "lte": return n <= an;
            case "between":
            case "notbetween": {
                var b = numOf(operandValue(rule.v2, cond, dC, dR));
                if (b === null) return false;
                var lo = Math.min(an, b), hi = Math.max(an, b);
                var within = n >= lo && n <= hi;
                return cond.id === "between" ? within : !within;
            }
        }
        return false;
    }

    /* ================= storage ================= */
    var anchorCache = {};   // anchor cell key -> {c,r}

    // caches are keyed by text, so they only need clearing when rules change
    function invalidate() {
        compiled = {};
        anchorCache = {};
    }
    function defs() {
        var s = Core.sheet();
        if (!s.cfDefs || typeof s.cfDefs !== "object") s.cfDefs = {};
        return s.cfDefs;
    }
    function defOf(id) { return defs()[id] || null; }
    function anchorOf(def) {
        var k = (def && def.anchor) || "A1";
        if (!Object.prototype.hasOwnProperty.call(anchorCache, k)) {
            var p = F.parseCellKey(k);
            anchorCache[k] = p ? { c: p.col, r: p.row } : { c: 0, r: 0 };
        }
        return anchorCache[k];
    }
    // ids on one cell, in the order they were applied
    function idsAt(c, r) {
        var cell = Core.sheet().cells[F.cellName(c, r)];
        return (cell && Array.isArray(cell.cf)) ? cell.cf : null;
    }

    /* ================= render hook ================= */
    /*
        The conditional part of a cell's style, or null when no rule applies.
        Called for every painted cell, so it does nothing at all until the
        cell actually carries a rule.
    */
    function styleFor(c, r) {
        var ids = idsAt(c, r);
        if (!ids || !ids.length) return null;
        var out = null;
        for (var i = 0; i < ids.length; i++) {
            var def = defOf(ids[i]);
            if (!def || !def.style) continue;
            if (!matches(def, c, r, anchorOf(def))) continue;
            var st = def.style;
            if (!out) out = {};
            // first rule to set a property owns it
            if (st.bg && !out.bg) out.bg = st.bg;
            if (st.fc && !out.fc) out.fc = st.fc;
            if (st.b && !out.b) out.b = true;
            if (st.i && !out.i) out.i = true;
            if (st.u && !out.u) out.u = true;
        }
        return out;
    }

    /*
        Inserting or deleting rows/columns moves the cells themselves - and
        their rule ids with them - so only the anchors that relative
        references are measured from have to be adjusted.
    */
    function shiftAnchors(axis, index, count) {
        var d = defs();
        Object.keys(d).forEach(function (id) {
            var p = F.parseCellKey(d[id].anchor || "A1");
            if (!p) return;
            var v = axis === "col" ? p.col : p.row;
            if (count > 0) { if (v >= index) v += count; }
            else {
                var del = -count;
                if (v >= index + del) v -= del;
                else if (v >= index) v = index;
            }
            d[id].anchor = F.cellName(axis === "col" ? v : p.col,
                axis === "row" ? v : p.row);
        });
        invalidate();
    }

    /* ================= per-cell bookkeeping ================= */
    var MAX_STAMP = 50000;      // guard against "apply to the whole sheet"

    function eachCellIn(rg, fn) {
        for (var r = rg.r1; r <= rg.r2; r++) {
            for (var c = rg.c1; c <= rg.c2; c++) fn(c, r);
        }
    }
    function rangeCellCount(rg) {
        return (rg.c2 - rg.c1 + 1) * (rg.r2 - rg.r1 + 1);
    }
    // stamp a rule id onto every cell of a range, replacing `replaces` when given
    function stampRange(rg, id, replaces) {
        eachCellIn(rg, function (c, r) {
            var cell = Core.cellObj(c, r, true);
            if (!Array.isArray(cell.cf)) cell.cf = [];
            var at = replaces ? cell.cf.indexOf(replaces) : -1;
            if (at >= 0) cell.cf[at] = id;
            else if (cell.cf.indexOf(id) < 0) cell.cf.push(id);
        });
    }
    function unstampRange(rg, id) {
        eachCellIn(rg, function (c, r) {
            var cell = Core.sheet().cells[F.cellName(c, r)];
            if (!cell || !Array.isArray(cell.cf)) return;
            cell.cf = cell.cf.filter(function (x) { return x !== id; });
            if (!cell.cf.length) delete cell.cf;
            Core.pruneCell(c, r);
        });
    }
    // forget rule bodies no cell refers to any more
    function sweepDefs() {
        var s = Core.sheet();
        if (!s.cfDefs) return;
        var live = {};
        Object.keys(s.cells).forEach(function (k) {
            var cell = s.cells[k];
            if (cell && cell.cf) cell.cf.forEach(function (id) { live[id] = true; });
        });
        Object.keys(s.cfDefs).forEach(function (id) {
            if (!live[id]) delete s.cfDefs[id];
        });
    }
    /*
        The rules present on the current selection, in the order the anchor
        cell lists them, each with the block of selected cells carrying it.
        This is what the panel shows - so it only ever describes the cells
        the user has actually got selected.
    */
    function rulesInSelection() {
        var sel = Core.selRange();
        var seen = {}, order = [];
        eachCellIn(sel, function (c, r) {
            var ids = idsAt(c, r);
            if (!ids) return;
            ids.forEach(function (id) {
                if (!defOf(id)) return;
                var e = seen[id];
                if (!e) {
                    e = seen[id] = { id: id, def: defOf(id), n: 0,
                        c1: c, c2: c, r1: r, r2: r };
                    order.push(e);
                }
                e.n++;
                if (c < e.c1) e.c1 = c;
                if (c > e.c2) e.c2 = c;
                if (r < e.r1) e.r1 = r;
                if (r > e.r2) e.r2 = r;
            });
        });
        return order;
    }
    function selectionHasRules() {
        var sel = Core.selRange();
        var found = false;
        eachCellIn(sel, function (c, r) {
            if (found) return;
            var ids = idsAt(c, r);
            if (ids && ids.length) found = true;
        });
        return found;
    }

    /* ================= rule descriptions ================= */
    function describe(rule) {
        var cond = condById(rule.type);
        if (cond.args === 0) return cond.label;
        if (cond.id === "between" || cond.id === "notbetween") {
            return cond.label + " " + (rule.v1 || "?") + " and " + (rule.v2 || "?");
        }
        return cond.label + " " + (rule.v1 || "?");
    }
    function swatchCss(st) {
        var css = "background:" + (st.bg || "transparent") + ";";
        if (st.fc) css += "color:" + st.fc + ";";
        if (st.b) css += "font-weight:700;";
        if (st.i) css += "font-style:italic;";
        if (st.u) css += "text-decoration:underline;";
        return css;
    }

    /* ================= editor UI ================= */
    function genId() {
        return "cf-" + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
    }
    // an editor draft: the rule body plus the cells it is being applied to
    function newDraft() {
        return {
            id: null,                                   // null = not saved yet
            range: tidyRef(Core.rangeStr(Core.selRange())),
            anchor: "", type: "notempty", v1: "", v2: "",
            style: {
                bg: DEFAULT_STYLE.bg, fc: DEFAULT_STYLE.fc,
                b: false, i: false, u: false
            }
        };
    }
    function draftFrom(entry) {
        return {
            id: entry.id,
            range: tidyRef(Core.rangeStr({
                c1: entry.c1, r1: entry.r1, c2: entry.c2, r2: entry.r2
            })),
            anchor: entry.def.anchor || "",
            type: entry.def.type, v1: entry.def.v1 || "", v2: entry.def.v2 || "",
            style: $.extend({}, entry.def.style)
        };
    }
    function commitRules() {
        sweepDefs();
        invalidate();
        Core.commit();
        Core.renderAll();
    }

    // the grid picker always hands back "B3:B3" for one cell; say "B3"
    function tidyRef(rgStr) {
        var p = String(rgStr).split(":");
        return (p.length === 2 && p[0] === p[1]) ? p[0] : String(rgStr);
    }
    /*
        A text box with a crosshair tucked into its right edge: click it,
        drag on the grid, and the reference lands back in the box. It goes in
        at the caret when the box has focus, so a range can be dropped into
        the middle of a half-typed formula; otherwise it replaces the whole
        value, which is what clicking straight into an untouched box means.
    */
    function refInput(id, placeholder, value, onInput) {
        var $wrap = $('<div class="sh-cf-refwrap"></div>');
        var $in = $('<input type="text">')
            .attr({ id: id, placeholder: placeholder }).val(value);
        var $btn = $('<button type="button" class="sh-cf-refpick" ' +
            'title="Select a cell or range on the grid"><i class="crosshairs icon"></i></button>');
        // keep the caret where it was: a plain click would blur the input first
        $btn.on("mousedown", function (e) { e.preventDefault(); });
        $btn.on("click", function () {
            var el = $in[0];
            var focused = document.activeElement === el;
            var from = focused ? el.selectionStart : null;
            var to = focused ? el.selectionEnd : null;
            Core.pickRangeFromGrid(function (rgStr) {
                if (!rgStr) return;
                var ref = tidyRef(rgStr);
                var pos;
                if (from === null) {
                    el.value = ref;
                    pos = ref.length;
                } else {
                    el.value = el.value.slice(0, from) + ref + el.value.slice(to);
                    pos = from + ref.length;
                }
                $in.trigger("input").trigger("change");
                el.focus();
                try { el.setSelectionRange(pos, pos); } catch (e) { }
            });
        });
        if (onInput) $in.on("input", onInput);
        return $wrap.append($in).append($btn);
    }

    // the dialog swaps between the rule list and the single-rule editor
    function open() {
        var $body = $('<div class="sh-cf"></div>');
        OfficeApp.dialog({
            title: "Conditional format rules",
            body: $body,
            buttons: [{ label: "Done", primary: true }]
        });
        showList($body);
    }

    function showList($body) {
        var sel = tidyRef(Core.rangeStr(Core.selRange()));
        var list = rulesInSelection();
        $body.empty();
        $body.append($('<div class="sh-cf-scope"></div>')
            .text("Rules on " + sel));
        if (!list.length) {
            $body.append('<div class="sh-cf-empty">These cells carry no rules. ' +
                'A rule belongs to the cells you apply it to and travels with them ' +
                'when they are moved, copied or filled.</div>');
        }
        var $rows = $('<div class="sh-cf-list"></div>');
        list.forEach(function (entry) {
            var covers = tidyRef(Core.rangeStr({
                c1: entry.c1, r1: entry.r1, c2: entry.c2, r2: entry.r2
            }));
            var $row = $('<div class="sh-cf-row"></div>');
            $row.append($('<div class="sh-cf-swatch"></div>')
                .attr("style", swatchCss(entry.def.style || {})).text("123"));
            $row.append($('<div class="sh-cf-info"><div class="sh-cf-desc"></div>' +
                '<div class="sh-cf-range"></div></div>')
                .find(".sh-cf-desc").text(describe(entry.def)).end()
                .find(".sh-cf-range").text(
                    covers + (entry.n > 1 ? "  -  " + entry.n + " cells" : "")).end());
            var $del = $('<button type="button" class="of-tbtn sh-cf-del" ' +
                'title="Remove this rule from the selected cells">' +
                '<i class="trash alternate outline icon"></i></button>');
            $del.on("click", function (e) {
                e.stopPropagation();
                unstampRange(Core.selRange(), entry.id);
                commitRules();
                showList($body);
            });
            $row.append($del);
            $row.on("click", function () { showEditor($body, draftFrom(entry), false); });
            $rows.append($row);
        });
        $body.append($rows);
        var $add = $('<button type="button" class="of-btn sh-cf-add">' +
            '<i class="plus icon"></i> Add another rule</button>');
        $add.on("click", function () { showEditor($body, newDraft(), true); });
        $body.append($add);
    }

    function showEditor($body, rule, isNew) {
        $body.empty();
        var $ed = $(
            '<label>Apply to range</label>' +
            '<div id="shCfRangeSlot"></div>' +
            '<label style="margin-top:10px;">Format cells if...</label>' +
            '<select id="shCfType"></select>' +
            '<div id="shCfArgs"></div>' +
            '<div class="sh-cf-hint" id="shCfHint"></div>' +
            '<label style="margin-top:10px;">Formatting style</label>' +
            '<div class="sh-cf-style">' +
            '<div class="sh-cf-preview" id="shCfPreview">123</div>' +
            '<button type="button" class="of-tbtn" id="shCfB" title="Bold"><i class="bold icon"></i></button>' +
            '<button type="button" class="of-tbtn" id="shCfI" title="Italic"><i class="italic icon"></i></button>' +
            '<button type="button" class="of-tbtn" id="shCfU" title="Underline"><i class="underline icon"></i></button>' +
            '<span id="shCfFcSlot"></span><span id="shCfBgSlot"></span>' +
            "</div>"
        );
        $body.append($ed);

        var draft = rule;   // already a draft object (newDraft / draftFrom)

        $body.find("#shCfRangeSlot").append(
            refInput("shCfRange", "A1:D20", draft.range, function () {
                draft.range = $(this).val().trim();
            }));
        $body.find("#shCfRange").on("change", function () {
            draft.range = $(this).val().trim();
        });

        var $type = $body.find("#shCfType");
        CONDS.forEach(function (cd) {
            $type.append($("<option></option>").attr("value", cd.id).text(cd.label));
        });
        $type.val(draft.type);

        var HINTS = {
            formula: "Relative references are read from the top-left cell of the range, " +
                "so =$F2&gt;=SUM($C2:$E2) tests every row against its own total.",
            text: "Matching ignores upper/lower case. Write =B3 to compare against " +
                "a cell rather than the text &quot;B3&quot;.",
            date: "A date as YYYY-MM-DD or MM/DD/YYYY, a cell such as B3, or a formula.",
            num: "A number, a cell such as B3, or a formula such as " +
                "=AVERAGE($F$2:$F$99). Relative references shift per row."
        };
        function renderArgs() {
            var cond = condById(draft.type);
            var $args = $body.find("#shCfArgs").empty();
            var ph = cond.kind === "formula" ? "=$F2>100" :
                (cond.kind === "date" ? "2026-01-31, B3 or =formula" :
                    (cond.kind === "text" ? "text to look for" : "value, B3 or =formula"));
            if (cond.args >= 1) {
                $args.append(refInput("shCfV1", ph, draft.v1, function () {
                    draft.v1 = $(this).val();
                }).css("margin-top", "6px"));
            }
            if (cond.args >= 2) {
                $args.append(refInput("shCfV2", "and", draft.v2, function () {
                    draft.v2 = $(this).val();
                }).css("margin-top", "6px"));
            }
            $body.find("#shCfHint").html(HINTS[cond.kind] || "");
        }
        $type.on("change", function () {
            draft.type = $(this).val();
            renderArgs();
        });
        renderArgs();

        function paintPreview() {
            $body.find("#shCfPreview").attr("style", swatchCss(draft.style));
            $body.find("#shCfB").toggleClass("active", !!draft.style.b);
            $body.find("#shCfI").toggleClass("active", !!draft.style.i);
            $body.find("#shCfU").toggleClass("active", !!draft.style.u);
        }
        [["#shCfB", "b"], ["#shCfI", "i"], ["#shCfU", "u"]].forEach(function (p) {
            $body.find(p[0]).on("click", function () {
                draft.style[p[1]] = !draft.style[p[1]];
                paintPreview();
            });
        });
        var $fc = OfficeColorPicker.swatchInput({
            id: "shCfFc", title: "Text color", value: draft.style.fc || "#202124",
            allowNone: true, noneLabel: "Automatic"
        });
        $fc.on("change", function () {
            draft.style.fc = $fc.val() || "";
            paintPreview();
        });
        $body.find("#shCfFcSlot").append($fc);
        var $bg = OfficeColorPicker.swatchInput({
            id: "shCfBg", title: "Fill color", value: draft.style.bg || DEFAULT_STYLE.bg,
            allowNone: true, noneLabel: "No fill"
        });
        $bg.on("change", function () {
            draft.style.bg = $bg.val() || "";
            paintPreview();
        });
        $body.find("#shCfBgSlot").append($bg);
        paintPreview();

        var $actions = $('<div class="sh-cf-actions"></div>');
        var $cancel = $('<button type="button" class="of-btn">Cancel</button>');
        $cancel.on("click", function () { showList($body); });
        var $save = $('<button type="button" class="of-btn primary">' +
            (isNew ? "Add rule" : "Save rule") + "</button>");
        $save.on("click", function () {
            if (!Core.parseRange(draft.range)) {
                OfficeApp.toast("Invalid range: " + draft.range, "error");
                return;
            }
            var cond = condById(draft.type);
            if (cond.args >= 1 && String(draft.v1).trim() === "") {
                OfficeApp.toast("This condition needs a value", "error");
                return;
            }
            if (cond.kind === "formula" && !compile(draft.v1)) {
                OfficeApp.toast("That formula cannot be parsed", "error");
                return;
            }
            if (!draft.style.bg && !draft.style.fc &&
                !draft.style.b && !draft.style.i && !draft.style.u) {
                OfficeApp.toast("Pick at least one formatting change", "error");
                return;
            }
            var rg = Core.parseRange(draft.range);
            if (rangeCellCount(rg) > MAX_STAMP) {
                OfficeApp.toast("That is " + rangeCellCount(rg) + " cells - apply the rule " +
                    "to at most " + MAX_STAMP + " at a time", "error");
                return;
            }
            /*
                Copy-on-write: the edit always mints a new rule body and swaps
                it in over the cells being edited. Cells elsewhere that happen
                to share the old rule keep it, which is what per-cell
                ownership has to mean once a rule can be copied around.
            */
            var id = genId();
            defs()[id] = {
                // relative references are read from where the rule was applied
                anchor: draft.anchor || F.cellName(rg.c1, rg.r1),
                type: draft.type, v1: draft.v1, v2: draft.v2,
                style: $.extend({}, draft.style)
            };
            if (draft.id) unstampRange(Core.selRange(), draft.id);
            stampRange(rg, id, null);
            commitRules();
            showList($body);
        });
        $actions.append($cancel).append($save);
        if (!isNew) {
            var $del = $('<button type="button" class="of-btn danger">Delete</button>');
            $del.on("click", function () {
                unstampRange(Core.selRange(), draft.id);
                commitRules();
                showList($body);
            });
            $actions.prepend($del);
        }
        $body.append($actions);
    }

    /* clear every rule that covers the current selection */
    /* strip every rule from the selected cells, leaving other cells alone */
    function clearForSelection() {
        if (!selectionHasRules()) {
            OfficeApp.toast("The selected cells have no conditional formatting", "error");
            return;
        }
        var sel = Core.selRange();
        var n = 0;
        eachCellIn(sel, function (c, r) {
            var cell = Core.sheet().cells[F.cellName(c, r)];
            if (!cell || !cell.cf) return;
            n++;
            delete cell.cf;
            Core.pruneCell(c, r);
        });
        commitRules();
        OfficeApp.setStatus("Cleared conditional formatting from " + n + " cell(s)");
    }

    return {
        styleFor: styleFor,
        shiftAnchors: shiftAnchors,
        invalidate: invalidate,
        open: open,
        clearForSelection: clearForSelection,
        selectionHasRules: selectionHasRules,
        rulesInSelection: rulesInSelection,
        describe: describe,
        conditions: CONDS
    };
})();
