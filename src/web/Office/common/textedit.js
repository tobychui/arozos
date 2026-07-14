/*
    ArozOS Office - shared floating text-edit bar
    ==============================================
    A PowerPoint-style mini formatting toolbar that floats above a
    contenteditable element while it is being edited. Shared by Slides
    (text boxes / shapes) and, later, Docs.

    Operates on the live selection with document.execCommand, so the host
    only has to serialize the resulting innerHTML afterwards.

    Usage:
        OfficeTextEditBar.show({
            anchor: domElement,          // editing root (selection scoping +
                                         // default float position)
            getRect: function(){...},    // OPTIONAL: DOMRect to float above
                                         // instead of the anchor box (e.g.
                                         // the live text selection in Docs)
            fontSize: 24,                // initial size shown in the box
            onFontSize: function(px){…}  // OPTIONAL: also apply size to the
                                         // whole object (host model), used
                                         // when there is no text selection
        });
        OfficeTextEditBar.reposition();  // after the anchor moved/resized
        OfficeTextEditBar.hide();
        OfficeTextEditBar.contains(node) // host focusout checks: focus moved
                                         // into the bar is still "editing"
*/

var OfficeTextEditBar = (function () {
    var FONTS = [
        "Arial", "Georgia", "Times New Roman", "Courier New", "Verdana",
        "Segoe UI", "Tahoma", "Trebuchet MS", "Impact", "Comic Sans MS"
    ];
    // ladder the enlarge / shrink buttons step through
    var SIZE_STEPS = [6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36,
        40, 44, 48, 54, 60, 66, 72, 80, 88, 96, 120, 144];
    var $bar = null;
    var anchorEl = null;
    var opts = null;
    var savedRange = null;

    /* ---------- selection keeping ---------- */
    // interacting with bar controls (select/input) steals focus from the
    // contenteditable - save the range on the way in, restore before exec
    function saveSelection() {
        var sel = window.getSelection();
        if (sel && sel.rangeCount > 0 && anchorEl &&
            anchorEl.contains(sel.getRangeAt(0).commonAncestorContainer)) {
            savedRange = sel.getRangeAt(0).cloneRange();
        }
    }
    function restoreSelection() {
        if (!savedRange) return false;
        try {
            // focus the contenteditable that owns the range so execCommand
            // targets it - after a modal (the Insert-link prompt) closes,
            // document.activeElement is <body> and commands would no-op
            var host = savedRange.commonAncestorContainer;
            if (host && host.nodeType === 3) host = host.parentNode;
            var ce = host && host.closest ?
                host.closest('[contenteditable=""],[contenteditable="true"]') : null;
            if (ce && ce.focus) ce.focus({ preventScroll: true });
            var sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(savedRange);
            return true;
        } catch (e) { return false; }
    }
    function hasTextSelection() {
        return savedRange && !savedRange.collapsed;
    }

    /* ---------- reflect the selection's formatting in the controls ---------- */
    function rgbToHex(c) {
        if (!c) return null;
        if (c.charAt(0) === "#") {
            if (c.length === 4) {
                return ("#" + c[1] + c[1] + c[2] + c[2] + c[3] + c[3]).toLowerCase();
            }
            return c.toLowerCase();
        }
        var m = /^rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(c);
        if (!m) return null;
        var h = function (n) { return ("0" + parseInt(n, 10).toString(16)).slice(-2); };
        return "#" + h(m[1]) + h(m[2]) + h(m[3]);
    }
    /* text nodes intersecting the range (capped - enough to detect "mixed") */
    function rangeTextNodes(range, cap) {
        var out = [];
        try {
            var walker = document.createTreeWalker(
                range.commonAncestorContainer, NodeFilter.SHOW_TEXT, null);
            var n;
            while ((n = walker.nextNode()) && out.length < (cap || 40)) {
                if (n.nodeValue.trim() === "") continue;
                if (range.intersectsNode(n)) out.push(n);
            }
        } catch (e) { }
        return out;
    }
    /* update color / size / font inputs from the current selection: a single
       uniform value shows as-is; mixed values fall back to defaults */
    function syncFromSelection() {
        if (!$bar || !anchorEl) return;
        var sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return;
        var range = sel.getRangeAt(0);
        if (!anchorEl.contains(range.commonAncestorContainer)) return;

        var nodes = rangeTextNodes(range);
        if (nodes.length === 0) {
            var an = sel.anchorNode;
            if (an && an.nodeType === 3) an = an.parentNode;
            if (an && an.nodeType === 1 && anchorEl.contains(an)) nodes = [{ parentNode: an }];
        }
        if (nodes.length === 0) return;

        var color = null, size = null, family = null, mixedC = false, mixedS = false, mixedF = false;
        for (var i = 0; i < nodes.length; i++) {
            var el = nodes[i].parentNode;
            if (!el || el.nodeType !== 1) continue;
            var cs = getComputedStyle(el);
            var c = rgbToHex(cs.color);
            var s = Math.round(parseFloat(cs.fontSize));
            var f = (cs.fontFamily || "").split(",")[0].replace(/["']/g, "").trim().toLowerCase();
            if (color === null) { color = c; size = s; family = f; }
            else {
                if (c !== color) mixedC = true;
                if (s !== size) mixedS = true;
                if (f !== family) mixedF = true;
            }
        }
        var $fc = $bar.find(".of-te-forecolor");
        $fc.data("cur", mixedC || !color ? "#000000" : color);
        $fc.find(".of-te-cbar").css("background", mixedC || !color ? "#000000" : color);
        if (!mixedS && size) $bar.find(".of-te-size").val(size);
        if (!mixedF && family) {
            $bar.find(".of-te-font option").each(function () {
                if (this.value.toLowerCase() === family) {
                    $bar.find(".of-te-font").val(this.value);
                    return false;
                }
            });
        }
    }
    var syncTimer = null;
    function scheduleSync() {
        clearTimeout(syncTimer);
        syncTimer = setTimeout(syncFromSelection, 120);
    }
    function exec(cmd, val) {
        restoreSelection();
        try { document.execCommand(cmd, false, val); } catch (e) { }
        saveSelection();
    }

    /* ---------- font size: execCommand only knows 1-7, so apply the
       classic trick - set size 7 then rewrite the font tags to px ---------- */
    function applyFontSizePx(px) {
        if (!hasTextSelection()) {
            // no selection: let the host resize the whole object
            if (opts && opts.onFontSize) opts.onFontSize(px);
            return;
        }
        restoreSelection();
        try {
            document.execCommand("fontSize", false, "7");
            var fonts = anchorEl.querySelectorAll('font[size="7"]');
            for (var i = 0; i < fonts.length; i++) {
                fonts[i].removeAttribute("size");
                fonts[i].style.fontSize = px + "px";
            }
        } catch (e) { }
        saveSelection();
    }

    /* ---------- build ---------- */
    function build() {
        $bar = $('<div class="of-textedit-bar of-noprint"></div>');
        var $row1 = $('<div class="of-te-row"></div>');
        var $row2 = $('<div class="of-te-row"></div>');
        $bar.append($row1).append($row2);

        var $font = $('<select class="of-te-font" title="Font family"></select>');
        FONTS.forEach(function (f) {
            $font.append($('<option></option>').attr("value", f).text(f).css("font-family", f));
        });
        $font.on("mousedown", saveSelection);
        $font.on("change", function () { exec("fontName", $font.val()); });
        $row1.append($font);

        var $size = $('<input type="number" class="of-te-size" min="6" max="200" step="1" title="Font size (px)">');
        $size.on("mousedown", saveSelection);
        $size.on("change", function () {
            var v = Math.max(6, Math.min(200, parseInt($size.val(), 10) || 24));
            $size.val(v);
            applyFontSizePx(v);
        });
        $row1.append($size);

        function btn(icon, title, fn) {
            var $b = $('<button type="button" class="of-te-btn" title="' + title + '"><i class="' + icon + ' icon"></i></button>');
            // preventDefault keeps the text selection alive
            $b.on("mousedown", function (e) { e.preventDefault(); saveSelection(); });
            $b.on("click", fn);
            return $b;
        }
        // step to the next / previous size on the ladder (falls back to +/-4)
        function stepFontSize(dir) {
            var cur = parseInt($size.val(), 10) || 24;
            var v = cur, i;
            if (dir > 0) {
                for (i = 0; i < SIZE_STEPS.length; i++) {
                    if (SIZE_STEPS[i] > cur) { v = SIZE_STEPS[i]; break; }
                }
                if (v === cur) v = cur + 4;
            } else {
                for (i = SIZE_STEPS.length - 1; i >= 0; i--) {
                    if (SIZE_STEPS[i] < cur) { v = SIZE_STEPS[i]; break; }
                }
                if (v === cur) v = cur - 4;
            }
            v = Math.max(6, Math.min(200, v));
            $size.val(v);
            applyFontSizePx(v);
        }
        $row1.append(btn("plus", "Increase font size", function () { stepFontSize(1); }));
        $row1.append(btn("minus", "Decrease font size", function () { stepFontSize(-1); }));
        $row1.append('<span class="of-te-sep"></span>');
        $row1.append(btn("bold", "Bold (Ctrl+B)", function () { exec("bold"); }));
        $row1.append(btn("italic", "Italic (Ctrl+I)", function () { exec("italic"); }));
        $row1.append(btn("underline", "Underline (Ctrl+U)", function () { exec("underline"); }));
        //$row1.append('<span class="of-te-sep"></span>');
        $row2.append(btn("align left", "Align left", function () { exec("justifyLeft"); }));
        $row2.append(btn("align center", "Align center", function () { exec("justifyCenter"); }));
        $row2.append(btn("align right", "Align right", function () { exec("justifyRight"); }));

        /* Split colour control: the icon (with a colour bar underneath)
           applies the CURRENT colour directly; the narrow caret opens the
           picker to change it. The returned wrapper carries data("cur") and
           the .of-te-cbar so syncFromSelection keeps working unchanged. */
        function colorBtn(icon, title, initial, cpOpts, apply) {
            var $wrap = $('<span class="of-te-split"></span>');
            var $main = $('<button type="button" class="of-te-btn of-te-cbtn of-te-cmain" title="' +
                title + '"><i class="' + icon + ' icon"></i><span class="of-te-cbar"></span></button>');
            var $caret = $('<button type="button" class="of-te-btn of-te-ccaret" title="Choose ' +
                title.toLowerCase() + '"><i class="caret down icon"></i></button>');
            $wrap.append($main).append($caret);
            $wrap.data("cur", initial);
            $main.find(".of-te-cbar").css("background", initial);

            // keep the text selection alive when clicking either half
            $wrap.on("mousedown", function (e) { e.preventDefault(); saveSelection(); });
            // icon -> apply the current colour immediately
            $main.on("click", function () { apply($wrap.data("cur")); });
            // caret -> open the picker; picking updates the current colour
            $caret.on("click", function () {
                OfficeColorPicker.open({
                    anchor: $wrap[0],
                    value: $wrap.data("cur") || initial,
                    allowNone: !!cpOpts.allowNone,
                    noneLabel: cpOpts.noneLabel,
                    onPick: function (hex) {
                        $wrap.data("cur", hex);
                        $main.find(".of-te-cbar").css("background", hex || "transparent");
                        apply(hex);
                    }
                });
            });
            return $wrap;
        }
        $row2.append(colorBtn("font", "Text color", "#202124", {}, function (hex) {
            if (hex) exec("foreColor", hex);
        }).addClass("of-te-forecolor"));
        $row2.append(colorBtn("paint brush", "Highlight color", "#ffff00",
            { allowNone: true, noneLabel: "No highlight" }, function (hex) {
                // hiliteColor targets just the selected text; some engines
                // only know backColor
                restoreSelection();
                try {
                    if (!document.execCommand("hiliteColor", false, hex || "transparent")) {
                        document.execCommand("backColor", false, hex || "transparent");
                    }
                } catch (e) {
                    try { document.execCommand("backColor", false, hex || "transparent"); } catch (e2) { }
                }
                saveSelection();
            }));
        $row2.append('<span class="of-te-sep"></span>');

        $row2.append(btn("linkify", "Insert link (empty removes)", function () {
            if (!hasTextSelection()) {
                if (window.OfficeApp) OfficeApp.setStatus("Select the text to link first", "error");
                return;
            }
            // current link at the selection start, if any
            var cur = "";
            try {
                var n = savedRange.startContainer;
                if (n.nodeType === 3) n = n.parentNode;
                var a = n.closest ? n.closest("a") : null;
                if (a) cur = a.getAttribute("href") || "";
            } catch (e) { }
            OfficeApp.prompt("Insert link", "Web address (leave empty to remove the link)",
                cur || "https://", function (v) {
                    if (v === null) return;   // cancelled
                    v = String(v).trim();
                    if (v === "" || v === "https://") {
                        exec("unlink");
                        return;
                    }
                    if (!/^(https?:\/\/|#)/i.test(v)) v = "https://" + v;
                    exec("createLink", v);
                });
        }));
        $row2.append('<span class="of-te-sep"></span>');
        $row2.append(btn("list ul", "Bulleted list", function () { exec("insertUnorderedList"); }));
        $row2.append(btn("list ol", "Numbered list", function () { exec("insertOrderedList"); }));
        $row2.append(btn("eraser", "Clear formatting", function () { exec("removeFormat"); }));

        // keep selection fresh while the user works inside the editor, and
        // mirror its color/size/font in the controls
        $(document).on("selectionchange.oftexbar", function () {
            saveSelection();
            scheduleSync();
        });
        $("body").append($bar);
    }

    /* ---------- position ---------- */
    function reposition() {
        if (!$bar || !anchorEl) return;
        var r = null;
        if (opts && opts.getRect) {
            try { r = opts.getRect(); } catch (e) { r = null; }
        }
        if (!r) r = anchorEl.getBoundingClientRect();
        var w = $bar.outerWidth(), h = $bar.outerHeight();
        var x = r.left + (r.width - w) / 2;
        var y = r.top - h - 8;
        if (y < 4) y = Math.min(window.innerHeight - h - 4, r.bottom + 8);
        if (x + w > window.innerWidth - 4) x = window.innerWidth - w - 4;
        if (x < 4) x = 4;
        $bar.css({ left: x + "px", top: y + "px" });
    }

    /* ---------- public ---------- */
    function show(options) {
        hide();
        opts = options || {};
        anchorEl = opts.anchor;
        if (!anchorEl) return;
        build();
        if (opts.fontSize) $bar.find(".of-te-size").val(Math.round(opts.fontSize));
        savedRange = null;
        saveSelection();
        syncFromSelection();
        reposition();
    }
    function hide() {
        if ($bar) {
            $bar.remove();
            $bar = null;
            if (window.OfficeColorPicker) OfficeColorPicker.close();
        }
        $(document).off("selectionchange.oftexbar");
        anchorEl = null;
        opts = null;
        savedRange = null;
    }
    function contains(node) {
        if ($bar && node && $bar[0].contains(node)) return true;
        // the color picker popup belongs to the bar: focus inside it (e.g.
        // its hex field) must still count as "editing" for the host
        return !!(window.OfficeColorPicker && OfficeColorPicker.contains(node));
    }
    function isVisible() { return !!$bar; }

    return {
        show: show,
        hide: hide,
        reposition: reposition,
        contains: contains,
        isVisible: isVisible
    };
})();
