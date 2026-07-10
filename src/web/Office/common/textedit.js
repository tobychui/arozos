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
            anchor: domElement,          // float above this element
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
            var sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(savedRange);
            return true;
        } catch (e) { return false; }
    }
    function hasTextSelection() {
        return savedRange && !savedRange.collapsed;
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

        var $font = $('<select class="of-te-font" title="Font family"></select>');
        FONTS.forEach(function (f) {
            $font.append($('<option></option>').attr("value", f).text(f).css("font-family", f));
        });
        $font.on("mousedown", saveSelection);
        $font.on("change", function () { exec("fontName", $font.val()); });
        $bar.append($font);

        var $size = $('<input type="number" class="of-te-size" min="6" max="200" step="1" title="Font size (px)">');
        $size.on("mousedown", saveSelection);
        $size.on("change", function () {
            var v = Math.max(6, Math.min(200, parseInt($size.val(), 10) || 24));
            $size.val(v);
            applyFontSizePx(v);
        });
        $bar.append($size);
        $bar.append('<span class="of-te-sep"></span>');

        function btn(icon, title, fn) {
            var $b = $('<button type="button" class="of-te-btn" title="' + title + '"><i class="' + icon + ' icon"></i></button>');
            // preventDefault keeps the text selection alive
            $b.on("mousedown", function (e) { e.preventDefault(); saveSelection(); });
            $b.on("click", fn);
            return $b;
        }
        $bar.append(btn("bold", "Bold (Ctrl+B)", function () { exec("bold"); }));
        $bar.append(btn("italic", "Italic (Ctrl+I)", function () { exec("italic"); }));
        $bar.append(btn("underline", "Underline (Ctrl+U)", function () { exec("underline"); }));
        $bar.append('<span class="of-te-sep"></span>');

        var $color = $('<input type="color" class="of-te-color" title="Text color" value="#202124">');
        $color.on("mousedown", saveSelection);
        $color.on("change", function () { exec("foreColor", $color.val()); });
        $bar.append($color);
        $bar.append('<span class="of-te-sep"></span>');

        $bar.append(btn("align left", "Align left", function () { exec("justifyLeft"); }));
        $bar.append(btn("align center", "Align center", function () { exec("justifyCenter"); }));
        $bar.append(btn("align right", "Align right", function () { exec("justifyRight"); }));

        // keep selection fresh while the user works inside the editor
        $(document).on("selectionchange.oftexbar", saveSelection);
        $("body").append($bar);
    }

    /* ---------- position ---------- */
    function reposition() {
        if (!$bar || !anchorEl) return;
        var r = anchorEl.getBoundingClientRect();
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
        reposition();
    }
    function hide() {
        if ($bar) {
            $bar.remove();
            $bar = null;
        }
        $(document).off("selectionchange.oftexbar");
        anchorEl = null;
        opts = null;
        savedRange = null;
    }
    function contains(node) {
        return !!($bar && node && $bar[0].contains(node));
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
