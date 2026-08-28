/*
    ArozOS Office - Sheets: conditional formatting.
    Requires sheets.js (SheetsApp core API) and formula.js.

    A sheet carries its rules in `cf: [rule, ...]`, evaluated top-down every
    time the grid paints:

        rule = {
            id:    "cf-...",              // stable id, used by the editor
            range: "A1:F1000",            // where the rule applies
            type:  "gt" | "contains" | "formula" | ...   (see CONDS)
            v1:    "200",                 // operand(s), kept as typed
            v2:    "",                    // second operand for between
            style: { bg, fc, b, i, u }    // what a matching cell gets
        }

    Rules are first-match-wins *per property*, the way Google Sheets does it:
    the topmost matching rule that sets a background decides the background,
    and a later rule can still contribute a text color the first one left
    alone. Only bg/fc/b/i/u are conditional - number format, alignment and
    borders always come from the cell's own style.

    Operands may be formulas themselves ("=AVERAGE($F$2:$F$99)"), which is
    what makes range rules work: the operand is evaluated once against the
    sheet, so "is greater than =AVERAGE(...)" highlights above-average cells.
    A "Custom formula" rule instead evaluates its formula per cell, with
    relative references shifted from the range's top-left corner, so
    "=$F2>=SUM($C2:$E2)" tests every row against its own total.
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
    /* An operand is either a literal the user typed or a formula. Formulas
       are evaluated once per rule (not per cell) against the anchor, so
       "=AVERAGE($F$2:$F$99)" costs the same as a plain number. */
    function operandValue(raw, anchor) {
        var s = String(raw === undefined || raw === null ? "" : raw);
        if (/^\s*=/.test(s)) return evalAt(compile(s), anchor.c, anchor.r);
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

        var a = operandValue(rule.v1, anchor);
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
                var b = numOf(operandValue(rule.v2, anchor));
                if (b === null) return false;
                var lo = Math.min(an, b), hi = Math.max(an, b);
                var within = n >= lo && n <= hi;
                return cond.id === "between" ? within : !within;
            }
        }
        return false;
    }

    /* ================= render hook ================= */
    var rangeCache = {};    // range string -> parsed range | null

    function rangeOf(str) {
        if (!Object.prototype.hasOwnProperty.call(rangeCache, str)) {
            rangeCache[str] = Core.parseRange(str);
        }
        return rangeCache[str];
    }
    // caches are keyed by text, so they only need clearing when rules change
    function invalidate() {
        compiled = {};
        rangeCache = {};
    }

    function rules() {
        var s = Core.sheet();
        return (s && Array.isArray(s.cf)) ? s.cf : [];
    }
    /*
        The conditional part of a cell's style, or null when no rule applies.
        Called for every painted cell, so it stays allocation-free until
        something actually matches.
    */
    function styleFor(c, r) {
        var list = rules();
        if (!list.length) return null;
        var out = null;
        for (var i = 0; i < list.length; i++) {
            var rule = list[i];
            if (!rule || !rule.style) continue;
            var rg = rangeOf(rule.range || "");
            if (!rg || c < rg.c1 || c > rg.c2 || r < rg.r1 || r > rg.r2) continue;
            var anchor = { c: rg.c1, r: rg.r1 };
            if (!matches(rule, c, r, anchor)) continue;
            var st = rule.style;
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

    /* row/column insert or delete moves the ranges rules point at */
    function shiftRanges(axis, index, count) {
        var s = Core.sheet();
        if (!Array.isArray(s.cf) || !s.cf.length) return;
        s.cf.forEach(function (rule) {
            var rg = Core.parseRange(rule.range || "");
            if (!rg) return;
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
            rule.range = Core.rangeStr(rg);
        });
        invalidate();
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
    function newRule() {
        return {
            id: genId(),
            range: Core.rangeStr(Core.selRange()),
            type: "notempty", v1: "", v2: "",
            style: {
                bg: DEFAULT_STYLE.bg, fc: DEFAULT_STYLE.fc,
                b: false, i: false, u: false
            }
        };
    }
    function commitRules() {
        invalidate();
        Core.commit();
        Core.renderAll();
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
        var list = rules();
        $body.empty();
        if (!list.length) {
            $body.append('<div class="sh-cf-empty">No rules on this sheet yet. ' +
                'A rule paints cells in a range whenever their value matches a condition.</div>');
        }
        var $rows = $('<div class="sh-cf-list"></div>');
        list.forEach(function (rule, i) {
            var $row = $('<div class="sh-cf-row"></div>');
            $row.append($('<div class="sh-cf-swatch"></div>')
                .attr("style", swatchCss(rule.style || {})).text("123"));
            $row.append($('<div class="sh-cf-info"><div class="sh-cf-desc"></div>' +
                '<div class="sh-cf-range"></div></div>')
                .find(".sh-cf-desc").text(describe(rule)).end()
                .find(".sh-cf-range").text(rule.range || "").end());
            var $del = $('<button type="button" class="of-tbtn sh-cf-del" ' +
                'title="Delete rule"><i class="trash alternate outline icon"></i></button>');
            $del.on("click", function (e) {
                e.stopPropagation();
                Core.sheet().cf.splice(i, 1);
                commitRules();
                showList($body);
            });
            $row.append($del);
            $row.on("click", function () { showEditor($body, rule, false); });
            $rows.append($row);
        });
        $body.append($rows);
        var $add = $('<button type="button" class="of-btn sh-cf-add">' +
            '<i class="plus icon"></i> Add another rule</button>');
        $add.on("click", function () { showEditor($body, newRule(), true); });
        $body.append($add);
    }

    function showEditor($body, rule, isNew) {
        $body.empty();
        var $ed = $(
            '<label>Apply to range</label>' +
            '<div style="display:flex;gap:6px;">' +
            '<input type="text" id="shCfRange" style="flex:1;min-width:0;">' +
            '<button type="button" class="of-tbtn" id="shCfPick" title="Select the range on the grid"' +
            ' style="flex:0 0 auto;border:1px solid var(--of-border);"><i class="crosshairs icon"></i></button>' +
            "</div>" +
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

        var draft = {
            id: rule.id, range: rule.range, type: rule.type,
            v1: rule.v1 || "", v2: rule.v2 || "",
            style: $.extend({}, rule.style)
        };

        $ed.filter("#shCfRange").val(draft.range);
        $body.find("#shCfRange").val(draft.range).on("change", function () {
            draft.range = $(this).val().trim();
        });
        $body.find("#shCfPick").on("click", function () {
            Core.pickRangeFromGrid(function (rgStr) {
                if (rgStr) {
                    draft.range = rgStr;
                    $body.find("#shCfRange").val(rgStr);
                }
            });
        });

        var $type = $body.find("#shCfType");
        CONDS.forEach(function (cd) {
            $type.append($("<option></option>").attr("value", cd.id).text(cd.label));
        });
        $type.val(draft.type);

        var HINTS = {
            formula: "Relative references are read from the top-left cell of the range, " +
                "so =$F2&gt;=SUM($C2:$E2) tests every row against its own total.",
            text: "Matching ignores upper/lower case.",
            date: "Type a date as YYYY-MM-DD or MM/DD/YYYY.",
            num: "A value, or a formula such as =AVERAGE($F$2:$F$99) to compare " +
                "against the whole range."
        };
        function renderArgs() {
            var cond = condById(draft.type);
            var $args = $body.find("#shCfArgs").empty();
            var ph = cond.kind === "formula" ? "=$F2>100" :
                (cond.kind === "date" ? "2026-01-31" :
                    (cond.kind === "text" ? "text to look for" : "value or =formula"));
            if (cond.args >= 1) {
                $args.append($('<input type="text" id="shCfV1" style="margin-top:6px;">')
                    .attr("placeholder", ph).val(draft.v1)
                    .on("input", function () { draft.v1 = $(this).val(); }));
            }
            if (cond.args >= 2) {
                $args.append($('<input type="text" id="shCfV2" style="margin-top:6px;">')
                    .attr("placeholder", "and").val(draft.v2)
                    .on("input", function () { draft.v2 = $(this).val(); }));
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
            var s = Core.sheet();
            if (!Array.isArray(s.cf)) s.cf = [];
            var at = -1;
            for (var i = 0; i < s.cf.length; i++) if (s.cf[i].id === draft.id) at = i;
            if (at >= 0) s.cf[at] = draft; else s.cf.push(draft);
            commitRules();
            showList($body);
        });
        $actions.append($cancel).append($save);
        if (!isNew) {
            var $del = $('<button type="button" class="of-btn danger">Delete</button>');
            $del.on("click", function () {
                var s = Core.sheet();
                s.cf = (s.cf || []).filter(function (x) { return x.id !== draft.id; });
                commitRules();
                showList($body);
            });
            $actions.prepend($del);
        }
        $body.append($actions);
    }

    /* clear every rule that covers the current selection */
    function clearForSelection() {
        var s = Core.sheet();
        if (!Array.isArray(s.cf) || !s.cf.length) {
            OfficeApp.toast("This sheet has no conditional formatting", "error");
            return;
        }
        var sel = Core.selRange();
        var before = s.cf.length;
        s.cf = s.cf.filter(function (rule) {
            var rg = Core.parseRange(rule.range || "");
            if (!rg) return false;
            // drop rules whose range overlaps what the user selected
            var hit = !(rg.c2 < sel.c1 || rg.c1 > sel.c2 || rg.r2 < sel.r1 || rg.r1 > sel.r2);
            return !hit;
        });
        commitRules();
        OfficeApp.setStatus("Removed " + (before - s.cf.length) + " conditional format rule(s)");
    }

    return {
        styleFor: styleFor,
        shiftRanges: shiftRanges,
        invalidate: invalidate,
        open: open,
        clearForSelection: clearForSelection,
        describe: describe,
        conditions: CONDS
    };
})();
