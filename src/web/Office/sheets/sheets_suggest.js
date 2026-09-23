/*
    ArozOS Office Sheets - formula function suggestions
    ===================================================
    While a formula is being typed ("=AVE"), a popup under the editor lists
    the functions whose name matches the word at the caret. The highlighted
    entry (hovered, or picked with the arrow keys) expands to show what the
    function does, its usage line and a worked example.

        var s = SheetFnSuggest.create({
            names:  function () { return ["ABS", ...]; },
            syntax: function (name) { return "ABS(value)"; },
            help:   SheetFormulaHelp,             // { NAME: [desc, example] }
            onApply: function (el) { ... }        // after text was inserted
        });
        s.attach(inputElement);                   // cell editor, formula bar
        s.hide();

    Tab or Enter accepts, Up / Down move, Escape or the close button dismiss
    the popup until the word being typed changes.
*/
var SheetFnSuggest = (function () {
    "use strict";

    var MAX_ITEMS = 12;
    // everyday functions float to the top of an ambiguous prefix
    var POPULAR = ["SUM", "AVERAGE", "COUNT", "COUNTA", "COUNTIF", "MAX", "MIN", "IF", "IFERROR",
        "VLOOKUP", "XLOOKUP", "INDEX", "MATCH", "SUMIF", "SUMIFS", "ROUND", "TODAY", "NOW",
        "CONCAT", "LEFT", "RIGHT", "MID", "LEN", "TRIM", "TEXT", "AND", "OR", "DATE", "FILTER",
        "SORT", "UNIQUE"];
    // characters that may come right before a function name
    var BOUNDARY = "=+-*/(,:<>&^%;{} \t\n";

    function create(opts) {
        var el = null;              // the editor the popup belongs to
        var $pop = null;
        var items = [];             // matching names
        var active = 0;
        var token = null;           // {start, end, text}
        var dismissed = null;       // "start:text" of a token the user closed

        function help(name) { return (opts.help && opts.help[name]) || ["", ""]; }

        /* ---------- which word is being typed ---------- */
        function tokenAt(input) {
            var v = input.value;
            if (v.charAt(0) !== "=") return null;
            var caret = input.selectionStart;
            if (caret === null || caret === undefined || caret !== input.selectionEnd) return null;
            var before = v.substring(0, caret);
            // inside a string literal: an odd number of quotes precede the caret
            if ((before.match(/"/g) || []).length % 2 === 1) return null;
            var m = before.match(/[A-Za-z_][A-Za-z0-9_.]*$/);
            if (!m) return null;
            var start = caret - m[0].length;
            if (start === 0 || BOUNDARY.indexOf(v.charAt(start - 1)) < 0) return null;
            // the rest of the word after the caret is replaced too
            var after = v.substring(caret).match(/^[A-Za-z0-9_.]*/)[0];
            return { start: start, end: caret + after.length, text: m[0].toUpperCase() };
        }
        function rank(q) {
            var names = opts.names();
            var prefix = [], inner = [];
            names.forEach(function (n) {
                var at = n.indexOf(q);
                if (at === 0) prefix.push(n);
                else if (at > 0 && q.length >= 2) inner.push(n);
            });
            function pop(n) { var i = POPULAR.indexOf(n); return i < 0 ? 999 : i; }
            prefix.sort(function (a, b) {
                return (pop(a) - pop(b)) || (a.length - b.length) || (a < b ? -1 : a > b ? 1 : 0);
            });
            inner.sort(function (a, b) {
                return (a.indexOf(q) - b.indexOf(q)) || (a.length - b.length) || (a < b ? -1 : 1);
            });
            return prefix.concat(inner).slice(0, MAX_ITEMS);
        }

        /* ---------- popup ---------- */
        function build() {
            $pop = $('<div class="sh-fns" role="listbox">' +
                '<button type="button" class="sh-fns-close" title="Close"><i class="close icon"></i></button>' +
                '<div class="sh-fns-list"></div>' +
                '<div class="sh-fns-foot"><kbd>Tab</kbd> to accept, <kbd>&uarr;</kbd><kbd>&darr;</kbd> to navigate, ' +
                '<kbd>Esc</kbd> to close</div></div>');
            // keep the caret in the editor while the popup is clicked
            $pop.on("mousedown", function (e) { e.preventDefault(); });
            $pop.find(".sh-fns-close").on("click", dismiss);
            $pop.on("mouseenter", ".sh-fns-item", function () {
                var i = +$(this).attr("data-i");
                if (i !== active) { active = i; render(false); }
            });
            $pop.on("click", ".sh-fns-item", function () {
                active = +$(this).attr("data-i");
                accept();
            });
            $("body").append($pop);
        }
        function render(scroll) {
            var $list = $pop.find(".sh-fns-list").empty();
            items.forEach(function (n, i) {
                var $it = $('<div class="sh-fns-item" role="option"></div>').attr("data-i", i);
                var at = n.indexOf(token.text);
                $it.append($('<div class="sh-fns-name"></div>')
                    .append(document.createTextNode(n.substring(0, at)))
                    .append($("<b></b>").text(n.substr(at, token.text.length)))
                    .append(document.createTextNode(n.substring(at + token.text.length))));
                if (i === active) {
                    var h = help(n);
                    $it.addClass("active").attr("aria-selected", "true");
                    var $d = $('<div class="sh-fns-detail"></div>');
                    if (h[0]) $d.append($('<div class="sh-fns-desc"></div>').text(h[0]));
                    $d.append($('<div class="sh-fns-usage"><span>Usage</span></div>')
                        .append($("<code></code>").text(opts.syntax(n) || n + "()")));
                    if (h[1]) {
                        $d.append($('<div class="sh-fns-usage"><span>Example</span></div>')
                            .append($("<code></code>").text("=" + h[1])));
                    }
                    $it.append($d);
                }
                $list.append($it);
            });
            if (scroll) {
                var act = $list.find(".sh-fns-item.active")[0];
                if (act && act.scrollIntoView) act.scrollIntoView({ block: "nearest" });
            }
            place();
        }
        function place() {
            if (!$pop || !el) return;
            var r = el.getBoundingClientRect();
            var w = $pop.outerWidth(), h = $pop.outerHeight();
            var vw = window.innerWidth, vh = window.innerHeight;
            var left = Math.max(4, Math.min(r.left, vw - w - 4));
            var top = r.bottom + 2;
            if (top + h > vh - 4 && r.top - h - 2 >= 4) top = r.top - h - 2;
            $pop.css({ left: left + "px", top: top + "px" });
        }
        function hide() {
            if ($pop) { $pop.remove(); $pop = null; }
            items = [];
            token = null;
        }
        function dismiss() {
            if (token) dismissed = token.start + ":" + token.text;
            hide();
        }
        function update(input) {
            el = input;
            var t = tokenAt(input);
            if (!t) { dismissed = null; hide(); return; }
            if (dismissed === t.start + ":" + t.text) { hide(); return; }
            dismissed = null;
            var list = rank(t.text);
            if (!list.length) { hide(); return; }
            var keep = token && token.start === t.start ? items[active] : null;
            token = t;
            items = list;
            active = Math.max(0, items.indexOf(keep));
            if (!$pop) build();
            render(true);
        }
        function accept() {
            if (!token || !el || !items[active]) return;
            var name = items[active], v = el.value;
            var rest = v.substring(token.end);
            var ins = name + (rest.charAt(0) === "(" ? "" : "(");
            var caret = token.start + ins.length + (rest.charAt(0) === "(" ? 1 : 0);
            el.value = v.substring(0, token.start) + ins + rest;
            try { el.setSelectionRange(caret, caret); } catch (e) { }
            hide();
            if (opts.onApply) opts.onApply(el);
        }
        function onKeyDown(e) {
            if (!$pop || e.target !== el) return;
            var k = e.key, handled = true;
            if (k === "ArrowDown") { active = (active + 1) % items.length; render(true); }
            else if (k === "ArrowUp") { active = (active - 1 + items.length) % items.length; render(true); }
            else if ((k === "Tab" && !e.shiftKey) || (k === "Enter" && !e.altKey)) accept();
            else if (k === "Escape") dismiss();
            else handled = false;
            if (handled) {
                e.preventDefault();
                e.stopImmediatePropagation();
            }
        }

        function attach(input) {
            // capture: runs before the editor's own Enter / Tab / Escape handling
            input.addEventListener("keydown", onKeyDown, true);
            input.addEventListener("input", function () { update(input); });
            input.addEventListener("click", function () { if ($pop || tokenAt(input)) update(input); });
            input.addEventListener("keyup", function (e) {
                if (/^(ArrowLeft|ArrowRight|Home|End)$/.test(e.key)) update(input);
            });
            input.addEventListener("blur", function () {
                setTimeout(function () { if (el === input && document.activeElement !== input) hide(); }, 0);
            });
        }
        window.addEventListener("resize", function () { if ($pop) place(); });

        return {
            attach: attach,
            update: update,
            hide: hide,
            isOpen: function () { return !!$pop; }
        };
    }

    return { create: create };
})();
