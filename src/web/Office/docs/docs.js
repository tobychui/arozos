/*
    ArozOS Office - Docs (word processor)
    =====================================
    Requires (loaded by index.html): jquery, ao_module, ../common/office.js,
    ../common/lib/marked.min.js (Markdown import).

    Envelope "body" schema (what serialize() returns / deserialize() accepts):

    {
        html: "<sanitized editor innerHTML>",       // rich text content
        page: {
            size: "A4" | "Letter" | "Legal",
            orientation: "portrait" | "landscape",
            margins: { top: 20, right: 20, bottom: 20, left: 20 }   // millimetres
        },
        header: "plain text shown at the top of the paper",
        footer: "plain text shown at the bottom of the paper",
        pageNumbers: false,     // print page numbers (best-effort @page margin box)
        comments: [ { id, text, at, resolved } ],   // review comments; anchored
                                // in html as <span class="doc-cmt" data-cid>
        trackChanges: false     // "suggest edits" mode; pending suggestions
                                // live in html as ins.doc-ins / del.doc-del
    }

    Notes:
      - html is produced by cleanedHtml(): find/replace highlight spans and
        image-selection classes are stripped before serialisation.
      - Known allowed classes inside html: doc-title (title paragraph),
        of-checklist (on UL), checked (on LI), of-table (on TABLE),
        doc-cmt (comment anchor), doc-ins / doc-del (tracked changes),
        doc-pagebreak (explicit page break block; exports as a real
        <w:br w:type="page"/> and is sized on screen by layoutPageBreaks).
      - Foreign exports (docx/html/md/txt) use resolvedHtml(): suggestions
        applied as if accepted, comment anchors unwrapped.
*/

(function () {
    "use strict";

    /* ================= constants ================= */
    var PAGE_SIZES = {
        "A4":     { w: 210,   h: 297 },
        "Letter": { w: 215.9, h: 279.4 },
        "Legal":  { w: 215.9, h: 355.6 }
    };
    var FONTS = [
        "Arial", "Georgia", "Times New Roman", "Courier New",
        "Verdana", "Segoe UI", "Tahoma", "Trebuchet MS"
    ];
    var FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72];
    var LINE_SPACINGS = ["1", "1.15", "1.5", "2"];
    var PARA_STYLES = [
        { v: "p",     label: "Normal text" },
        { v: "title", label: "Title" },
        { v: "h1",    label: "Heading 1" },
        { v: "h2",    label: "Heading 2" },
        { v: "h3",    label: "Heading 3" },
        { v: "h4",    label: "Heading 4" }
    ];
    var BLOCK_SEL = "p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,div";

    /* Special characters palette - every glyph is generated at runtime from
       code points (never a literal emoji in this source file). */
    var CHAR_TABS = [
        { name: "Smileys", cps: [
            0x1F600, 0x1F601, 0x1F602, 0x1F603, 0x1F604, 0x1F605, 0x1F606, 0x1F607,
            0x1F609, 0x1F60A, 0x1F60B, 0x1F60D, 0x1F60E, 0x1F60F, 0x1F610, 0x1F612,
            0x1F614, 0x1F618, 0x1F61C, 0x1F621, 0x1F622, 0x1F625, 0x1F62D, 0x1F631,
            0x1F634, 0x1F637, 0x1F642, 0x1F643, 0x1F644, 0x1F914, 0x1F917, 0x1F929,
            0x1F970, 0x1F973, 0x1F44D, 0x1F44E, 0x1F44F, 0x1F64F, 0x1F4AA, 0x1F389] },
        { name: "Objects", cps: [
            0x1F4C1, 0x1F4C2, 0x1F4C4, 0x1F4C5, 0x1F4C8, 0x1F4C9, 0x1F4CA, 0x1F4CB,
            0x1F4CC, 0x1F4CD, 0x1F4CE, 0x1F4DD, 0x1F4E6, 0x1F4E7, 0x1F4F1, 0x1F4BB,
            0x1F4BE, 0x1F4BC, 0x1F50D, 0x1F511, 0x1F512, 0x1F513, 0x1F514, 0x1F4A1,
            0x1F527, 0x1F528, 0x2699,  0x23F0,  0x1F3C6, 0x2B50,  0x2764,  0x2705,
            0x274C,  0x26A0,  0x2B55,  0x1F6A9] },
        { name: "Arrows", cps: [
            0x2190, 0x2191, 0x2192, 0x2193, 0x2194, 0x2195, 0x2196, 0x2197,
            0x2198, 0x2199, 0x21A9, 0x21AA, 0x21B5, 0x21C4, 0x21C6, 0x21D0,
            0x21D1, 0x21D2, 0x21D3, 0x21D4, 0x2794, 0x27A1, 0x2B05, 0x2B06,
            0x2B07, 0x2B95, 0x21E7, 0x21E9] },
        { name: "Math", cps: [
            0x00B1, 0x00D7, 0x00F7, 0x2212, 0x2260, 0x2264, 0x2265, 0x2248,
            0x221E, 0x2211, 0x220F, 0x221A, 0x222B, 0x2202, 0x2206, 0x2207,
            0x03C0, 0x03B1, 0x03B2, 0x03B3, 0x03B8, 0x03BB, 0x03BC, 0x03C3,
            0x03C6, 0x03A9, 0x2208, 0x2209, 0x2229, 0x222A, 0x2282, 0x2283,
            0x2200, 0x2203, 0x00B0, 0x00B2, 0x00B3, 0x00BD, 0x00BC, 0x00BE,
            0x2032, 0x2033] },
        { name: "Symbols", cps: [
            0x00A9, 0x00AE, 0x2122, 0x00A7, 0x00B6, 0x2020, 0x2021, 0x2022,
            0x2026, 0x2030, 0x20AC, 0x00A3, 0x00A5, 0x00A2, 0x00A1, 0x00BF,
            0x00AB, 0x00BB, 0x2018, 0x2019, 0x201C, 0x201D, 0x2013, 0x2014,
            0x2713, 0x2717, 0x2605, 0x2606, 0x25CF, 0x25CB, 0x25A0, 0x25A1,
            0x2660, 0x2663, 0x2665, 0x2666, 0x266A, 0x266B] }
    ];

    /* ================= state ================= */
    var editor, headerEl, footerEl, pageEl, workspaceEl;
    var savedRange = null;         // last selection range inside the editor
    var selectedImg = null;        // currently selected <img>
    var imgHandle = null;          // floating resize handle element
    var pageConf = defaultPageConf();
    var undo = null;
    var countTimer = null;
    var stateTimer = null;
    var $fontSel, $sizeSel, $styleSel;
    var findState = { hits: [], cur: -1 };
    var comments = [];             // review comments [{id,text,at,resolved}]
    var suggesting = false;        // track-changes ("suggest edits") mode

    function defaultPageConf() {
        return {
            size: "A4",
            orientation: "portrait",
            margins: { top: 20, right: 20, bottom: 20, left: 20 },
            pageNumbers: false,
            columns: 1,        // 1-3 text columns (2 = IEEE-style)
            colGap: 8          // gap between columns, mm
        };
    }
    function num(v, def) {
        var n = parseFloat(v);
        return isNaN(n) ? def : n;
    }
    function esc(t) { return OfficeApp.escapeHtml(t); }

    /* ================= selection helpers ================= */
    function trackSelection() {
        document.addEventListener("selectionchange", function () {
            var sel = window.getSelection();
            if (sel && sel.rangeCount > 0) {
                var r = sel.getRangeAt(0);
                if (editor.contains(r.commonAncestorContainer)) {
                    savedRange = r.cloneRange();
                    scheduleToolbarState();
                }
            }
        });
    }
    function restoreSel() {
        editor.focus();
        if (savedRange) {
            var sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(savedRange);
        }
    }
    function placeCaretAtEnd() {
        try {
            var r = document.createRange();
            r.selectNodeContents(editor);
            r.collapse(false);
            var sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(r);
            savedRange = r.cloneRange();
        } catch (e) { }
    }
    function inHeaderFooter() {
        var ae = document.activeElement;
        return ae === headerEl || ae === footerEl;
    }
    function getSelectedBlocks() {
        var out = [];
        var range = null;
        var sel = window.getSelection();
        if (sel && sel.rangeCount > 0 && editor.contains(sel.getRangeAt(0).commonAncestorContainer)) {
            range = sel.getRangeAt(0);
        } else {
            range = savedRange;
        }
        if (!range) return out;
        if (range.collapsed) {
            var n = range.startContainer;
            while (n && n !== editor) {
                if (n.nodeType === 1 && n.matches && n.matches(BLOCK_SEL)) { out.push(n); break; }
                n = n.parentNode;
            }
            return out;
        }
        var cand = editor.querySelectorAll(BLOCK_SEL);
        for (var i = 0; i < cand.length; i++) {
            try { if (range.intersectsNode(cand[i])) out.push(cand[i]); } catch (e) { }
        }
        // keep only the deepest blocks (drop ancestors of other selected blocks)
        return out.filter(function (b) {
            for (var j = 0; j < out.length; j++) {
                if (out[j] !== b && b.contains(out[j])) return false;
            }
            return true;
        });
    }

    /* ================= sanitizer ================= */
    function sanitizeHtml(html, opts) {
        opts = opts || {};
        var doc;
        try {
            doc = new DOMParser().parseFromString(String(html || ""), "text/html");
        } catch (e) { return ""; }
        var root = doc.body;
        var bad = root.querySelectorAll(
            "script,style,link,meta,base,iframe,frame,frameset,object,embed,applet,form,noscript,title,svg foreignObject");
        var i;
        for (i = bad.length - 1; i >= 0; i--) {
            if (bad[i].parentNode) bad[i].parentNode.removeChild(bad[i]);
        }
        var all = root.querySelectorAll("*");
        for (i = 0; i < all.length; i++) {
            var el = all[i];
            for (var a = el.attributes.length - 1; a >= 0; a--) {
                var at = el.attributes[a];
                var n = at.name.toLowerCase();
                if (n.indexOf("on") === 0) {
                    el.removeAttribute(at.name);
                } else if ((n === "href" || n === "src" || n === "xlink:href" || n === "action" || n === "formaction") &&
                        /^\s*(javascript|vbscript|data\s*:\s*text\/html)/i.test(at.value)) {
                    el.removeAttribute(at.name);
                } else if (!opts.keepClasses && (n === "class" || n === "id")) {
                    el.removeAttribute(at.name);
                }
            }
        }
        return root.innerHTML;
    }

    /* ================= serialize / deserialize ================= */
    function cleanedHtml() {
        var clone = editor.cloneNode(true);
        // strip layout-only automatic page spacers (visual pagination)
        removeAutoBreaks(clone);
        // strip find highlight spans
        var hits = clone.querySelectorAll("span.of-find-hit");
        for (var i = 0; i < hits.length; i++) {
            var s = hits[i];
            while (s.firstChild) s.parentNode.insertBefore(s.firstChild, s);
            s.parentNode.removeChild(s);
        }
        // strip image selection marker
        var imgs = clone.querySelectorAll("img.of-selimg");
        for (i = 0; i < imgs.length; i++) {
            imgs[i].classList.remove("of-selimg");
            if (!imgs[i].getAttribute("class")) imgs[i].removeAttribute("class");
        }
        clone.normalize();
        return clone.innerHTML;
    }
    function hfText(el) {
        return (el.textContent || "").replace(/\n+/g, " ").trim();
    }
    function currentBody() {
        return {
            html: cleanedHtml(),
            page: {
                size: pageConf.size,
                orientation: pageConf.orientation,
                margins: {
                    top: pageConf.margins.top, right: pageConf.margins.right,
                    bottom: pageConf.margins.bottom, left: pageConf.margins.left
                },
                columns: pageConf.columns,
                colGap: pageConf.colGap
            },
            header: hfText(headerEl),
            footer: hfText(footerEl),
            pageNumbers: !!pageConf.pageNumbers,
            comments: JSON.parse(JSON.stringify(comments)),
            trackChanges: suggesting
        };
    }
    function loadBody(b) {
        b = b || {};
        closeFind();
        deselectImage();
        editor.innerHTML = sanitizeHtml(b.html || "<p><br></p>", { keepClasses: true }) || "<p><br></p>";
        normalizePageBreaks();
        headerEl.textContent = b.header || "";
        footerEl.textContent = b.footer || "";
        var p = b.page || {};
        pageConf.size = PAGE_SIZES[p.size] ? p.size : "A4";
        pageConf.orientation = (p.orientation === "landscape") ? "landscape" : "portrait";
        var m = p.margins || {};
        pageConf.margins = {
            top: num(m.top, 20), right: num(m.right, 20),
            bottom: num(m.bottom, 20), left: num(m.left, 20)
        };
        pageConf.columns = Math.min(3, Math.max(1, Math.round(num(p.columns, 1))));
        pageConf.colGap = Math.min(30, Math.max(2, num(p.colGap, 8)));
        pageConf.pageNumbers = !!b.pageNumbers;
        comments = Array.isArray(b.comments) ?
            JSON.parse(JSON.stringify(b.comments)) : [];
        suggesting = !!b.trackChanges;
        applyPageSetup();
        updateCounts();
        renderCommentsPanel();
        updateSuggestStatus();
    }

    /* ================= undo / redo ================= */
    function snapshot() {
        return JSON.stringify(currentBody());
    }
    function applySnapshot(s) {
        try {
            loadBody(JSON.parse(s));
        } catch (e) { return; }
        OfficeApp.markDirty();
        placeCaretAtEnd();
        updateToolbarState();
    }
    function doUndo() { undo.flushDebounced(snapshot); undo.undo(); }
    function doRedo() { undo.redo(); }

    /* after any user edit: dirty flag, counters, undo bookkeeping */
    function afterEdit(immediate) {
        OfficeApp.markDirty();
        scheduleCounts();
        scheduleToolbarState();
        if (immediate) undo.push(snapshot());
        else undo.pushDebounced(snapshot, 600);
    }

    /* ================= editing commands ================= */
    function exec(cmd, val) {
        if (inHeaderFooter()) return;   // header/footer are plain text only
        restoreSel();
        try {
            document.execCommand(cmd, false, val === undefined ? null : val);
        } catch (e) { }
        afterEdit(true);
    }
    function applyFontSize(pt) {
        if (inHeaderFooter()) return;
        restoreSel();
        try {
            document.execCommand("styleWithCSS", false, false);
            document.execCommand("fontSize", false, "7");
        } catch (e) { }
        try { document.execCommand("styleWithCSS", false, true); } catch (e) { }
        var i;
        var fonts = editor.querySelectorAll('font[size="7"]');
        for (i = 0; i < fonts.length; i++) {
            var f = fonts[i];
            var span = document.createElement("span");
            span.style.fontSize = pt + "pt";
            while (f.firstChild) span.appendChild(f.firstChild);
            f.parentNode.replaceChild(span, f);
        }
        var spans = editor.querySelectorAll("span");
        for (i = 0; i < spans.length; i++) {
            if (spans[i].style && spans[i].style.fontSize === "xxx-large") {
                spans[i].style.fontSize = pt + "pt";
            }
        }
        afterEdit(true);
    }
    function applyParagraphStyle(v) {
        if (inHeaderFooter()) return;
        restoreSel();
        try {
            if (v === "title") {
                document.execCommand("formatBlock", false, "<h1>");
                getSelectedBlocks().forEach(function (b) {
                    if (b.tagName === "H1") b.classList.add("doc-title");
                });
            } else {
                document.execCommand("formatBlock", false, "<" + v + ">");
                getSelectedBlocks().forEach(function (b) {
                    b.classList.remove("doc-title");
                    if (!b.getAttribute("class")) b.removeAttribute("class");
                });
            }
        } catch (e) { }
        afterEdit(true);
    }
    function setLineSpacing(v) {
        if (inHeaderFooter()) return;
        restoreSel();
        var blocks = getSelectedBlocks();
        blocks.forEach(function (b) { b.style.lineHeight = v; });
        afterEdit(true);
    }
    function currentLineSpacing() {
        var blocks = getSelectedBlocks();
        if (blocks.length && blocks[0].style.lineHeight) return blocks[0].style.lineHeight;
        return "";
    }
    function toggleChecklist() {
        if (inHeaderFooter()) return;
        restoreSel();
        var li = null;
        getSelectedBlocks().forEach(function (b) { if (b.tagName === "LI") li = b; });
        var list = li ? li.closest("ul,ol") : null;
        try {
            if (list && list.tagName === "UL" && list.classList.contains("of-checklist")) {
                // toggle the whole list back off
                document.execCommand("insertUnorderedList");
            } else if (list && list.tagName === "UL") {
                list.classList.add("of-checklist");
            } else {
                document.execCommand("insertUnorderedList");
                var sel = window.getSelection();
                var n = sel.anchorNode;
                while (n && n !== editor) {
                    if (n.nodeType === 1 && n.tagName === "UL") { n.classList.add("of-checklist"); break; }
                    n = n.parentNode;
                }
            }
        } catch (e) { }
        afterEdit(true);
    }
    function clearFormatting() {
        if (inHeaderFooter()) return;
        restoreSel();
        try {
            document.execCommand("removeFormat");
            document.execCommand("formatBlock", false, "<p>");
        } catch (e) { }
        getSelectedBlocks().forEach(function (b) {
            b.removeAttribute("style");
            b.classList.remove("doc-title");
            if (!b.getAttribute("class")) b.removeAttribute("class");
        });
        afterEdit(true);
    }
    function selectAll() {
        editor.focus();
        var r = document.createRange();
        r.selectNodeContents(editor);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        savedRange = r.cloneRange();
    }

    /* ================= toolbar ================= */
    function buildToolbar() {
        var $t = $("#toolbar");
        function btn(icon, title, fn, cmdId) {
            var $b = $('<button type="button" class="of-tbtn"></button>')
                .attr("title", title)
                .append('<i class="' + icon + ' icon"></i>');
            if (cmdId) $b.attr("data-cmd", cmdId);
            $b.on("mousedown", function (e) { e.preventDefault(); });  // keep editor selection
            $b.on("click", fn);
            $t.append($b);
            return $b;
        }
        function sep() { $t.append('<div class="of-tsep"></div>'); }

        btn("undo", "Undo (Ctrl+Z)", doUndo);
        btn("redo", "Redo (Ctrl+Y)", doRedo);
        sep();

        // paragraph style / font family / font size
        $styleSel = $('<select class="of-tselect tb-style" title="Paragraph style"></select>');
        PARA_STYLES.forEach(function (s) {
            $styleSel.append($("<option></option>").attr("value", s.v).text(s.label));
        });
        $styleSel.on("change", function () { applyParagraphStyle(this.value); });
        // hidden file input for Insert > Image > From this device
        $("#deviceImageInput").on("change", function () {
            var files = this.files;
            for (var i = 0; i < files.length; i++) {
                (function (f) {
                    OfficeApp.blobToSrc(f, f.name || "image.png", function (src) {
                        insertImage(src);
                    }, function (msg) {
                        OfficeApp.toast(msg, "error");
                    });
                })(files[i]);
            }
            this.value = "";
        });
        $t.append($styleSel);

        $fontSel = $('<select class="of-tselect tb-font" title="Font family"></select>');
        FONTS.forEach(function (f) {
            $fontSel.append($("<option></option>").attr("value", f).text(f).css("font-family", f));
        });
        $fontSel.on("change", function () { exec("fontName", this.value); });
        $t.append($fontSel);

        $sizeSel = $('<select class="of-tselect tb-size" title="Font size (pt)"></select>');
        FONT_SIZES.forEach(function (s) {
            $sizeSel.append($("<option></option>").attr("value", String(s)).text(s));
        });
        $sizeSel.val("11");
        $sizeSel.on("change", function () { applyFontSize(parseInt(this.value, 10)); });
        $t.append($sizeSel);
        sep();

        btn("bold", "Bold (Ctrl+B)", function () { exec("bold"); }, "bold");
        btn("italic", "Italic (Ctrl+I)", function () { exec("italic"); }, "italic");
        btn("underline", "Underline (Ctrl+U)", function () { exec("underline"); }, "underline");
        btn("strikethrough", "Strikethrough (Ctrl+Shift+X)", function () { exec("strikeThrough"); }, "strikeThrough");

        // text color + highlight color (shared OfficeColorPicker popup)
        function colorControl(icon, title, defVal, cpOpts, applyFn) {
            var $w = $('<button type="button" class="of-tbtn of-te-cbtn"></button>').attr("title", title);
            $w.append('<i class="' + icon + ' icon"></i><span class="of-te-cbar"></span>');
            $w.find(".of-te-cbar").css("background", defVal);
            // selection is tracked globally (trackSelection); just keep it
            $w.on("mousedown", function (e) { e.preventDefault(); });
            $w.on("click", function () {
                OfficeColorPicker.open({
                    anchor: $w[0],
                    value: $w.data("cur") || defVal,
                    allowNone: !!cpOpts.allowNone,
                    noneLabel: cpOpts.noneLabel,
                    onPick: function (hex) {
                        if (inHeaderFooter()) return;
                        $w.data("cur", hex);
                        $w.find(".of-te-cbar").css("background", hex || "transparent");
                        restoreSel();
                        applyFn(hex);
                        OfficeApp.markDirty();
                        afterEdit(true);
                    }
                });
            });
            $t.append($w);
        }
        colorControl("font", "Text color", "#000000", {}, function (v) {
            if (!v) return;
            try { document.execCommand("foreColor", false, v); } catch (e) { }
        });
        colorControl("paint brush", "Highlight color", "#ffff00",
            { allowNone: true, noneLabel: "No highlight" }, function (v) {
                try {
                    if (!document.execCommand("hiliteColor", false, v || "transparent")) {
                        document.execCommand("backColor", false, v || "transparent");
                    }
                } catch (e) {
                    try { document.execCommand("backColor", false, v || "transparent"); } catch (e2) { }
                }
            });
        sep();

        btn("align left", "Align left", function () { exec("justifyLeft"); }, "justifyLeft");
        btn("align center", "Align center", function () { exec("justifyCenter"); }, "justifyCenter");
        btn("align right", "Align right", function () { exec("justifyRight"); }, "justifyRight");
        btn("align justify", "Justify", function () { exec("justifyFull"); }, "justifyFull");

        var $ls = btn("text height", "Line spacing", function () {
            var r = $ls[0].getBoundingClientRect();
            var cur = currentLineSpacing();
            OfficeApp.showContextMenu(r.left, r.bottom + 4, LINE_SPACINGS.map(function (v) {
                return {
                    label: v === "1" ? "Single (1)" : v,
                    checked: cur === v,
                    action: function () { setLineSpacing(v); }
                };
            }));
        });
        btn("outdent", "Decrease indent", function () { exec("outdent"); });
        btn("indent", "Increase indent (Tab)", function () { exec("indent"); });
        sep();

        btn("list ul", "Bulleted list (Ctrl+Shift+8)", function () { exec("insertUnorderedList"); }, "insertUnorderedList");
        btn("list ol", "Numbered list (Ctrl+Shift+7)", function () { exec("insertOrderedList"); }, "insertOrderedList");
        btn("check square outline", "Checklist", toggleChecklist, "checklist");
        sep();

        btn("linkify", "Insert link (Ctrl+K)", linkDialog);
        btn("image outline", "Insert image", function () {
            var b = this.getBoundingClientRect ? this.getBoundingClientRect() : { left: 200, bottom: 80 };
            OfficeApp.showContextMenu(b.left, b.bottom + 4, imageMenuItems());
        });
        btn("table", "Insert table", insertTableDialog);
        btn("smile outline", "Special characters", specialCharsDialog);
        sep();

        btn("eraser", "Clear formatting", clearFormatting);
    }

    function scheduleToolbarState() {
        clearTimeout(stateTimer);
        stateTimer = setTimeout(updateToolbarState, 90);
    }
    function updateToolbarState() {
        // contextual menubar menus (Table) follow the caret
        if (OfficeApp.updateMenus) OfficeApp.updateMenus();
        var states = ["bold", "italic", "underline", "strikeThrough",
            "justifyLeft", "justifyCenter", "justifyRight", "justifyFull",
            "insertUnorderedList", "insertOrderedList"];
        states.forEach(function (c) {
            var on = false;
            try { on = document.queryCommandState(c); } catch (e) { }
            $('#toolbar [data-cmd="' + c + '"]').toggleClass("active", !!on);
        });
        // font family
        var fn = "";
        try { fn = document.queryCommandValue("fontName") || ""; } catch (e) { }
        fn = String(fn).replace(/['"]/g, "").split(",")[0].trim();
        if (fn && $fontSel.find('option[value="' + fn + '"]').length) $fontSel.val(fn);
        // font size + paragraph style from the caret position
        var n = savedRange ? savedRange.startContainer : null;
        if (n && n.nodeType === 3) n = n.parentNode;
        if (n && n.nodeType === 1 && editor.contains(n)) {
            try {
                var px = parseFloat(window.getComputedStyle(n).fontSize);
                var pt = String(Math.round(px * 72 / 96));
                if ($sizeSel.find('option[value="' + pt + '"]').length) $sizeSel.val(pt);
            } catch (e) { }
            var b = n.closest ? n.closest("h1,h2,h3,h4,p,pre,blockquote,li,div") : null;
            var v = "p";
            if (b && editor.contains(b)) {
                if (b.classList.contains("doc-title")) v = "title";
                else if (/^H[1-4]$/.test(b.tagName)) v = b.tagName.toLowerCase();
            }
            $styleSel.val(v);
            // checklist button state
            var li = n.closest ? n.closest("li") : null;
            var inCheck = !!(li && li.parentElement && li.parentElement.classList.contains("of-checklist"));
            $('#toolbar [data-cmd="checklist"]').toggleClass("active", inCheck);
            if (inCheck) $('#toolbar [data-cmd="insertUnorderedList"]').removeClass("active");
        }
    }

    /* ================= links ================= */
    function linkDialog() {
        if (inHeaderFooter()) return;
        var existing = null;
        var n = savedRange ? savedRange.commonAncestorContainer : null;
        while (n && n !== editor) {
            if (n.nodeType === 1 && n.tagName === "A") { existing = n; break; }
            n = n.parentNode;
        }
        var initText = existing ? existing.textContent : (savedRange ? savedRange.toString() : "");
        var initUrl = existing ? (existing.getAttribute("href") || "") : "";
        var $b = $("<div></div>");
        $b.append("<label>Text to display</label>");
        var $text = $('<input type="text" class="lnk-text">').val(initText);
        $b.append($text);
        $b.append("<label>Link URL</label>");
        var $url = $('<input type="text" class="lnk-url" placeholder="https://example.com">').val(initUrl);
        $b.append($url);

        var buttons = [{ label: "Cancel" }];
        if (existing) {
            buttons.push({
                label: "Remove link", danger: true,
                action: function (close) {
                    close();
                    while (existing.firstChild) existing.parentNode.insertBefore(existing.firstChild, existing);
                    existing.parentNode.removeChild(existing);
                    afterEdit(true);
                }
            });
        }
        buttons.push({
            label: existing ? "Apply" : "Insert", primary: true,
            action: function (close, $body) {
                var text = $body.find(".lnk-text").val().trim();
                var href = $body.find(".lnk-url").val().trim();
                close();
                if (!href) return;
                if (!/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(href)) href = "https://" + href;
                if (existing) {
                    existing.setAttribute("href", href);
                    if (text) existing.textContent = text;
                    afterEdit(true);
                } else {
                    restoreSel();
                    var html = '<a href="' + esc(href) + '">' + esc(text || href) + "</a>";
                    try { document.execCommand("insertHTML", false, html); } catch (e) { }
                    afterEdit(true);
                }
            }
        });
        var d = OfficeApp.dialog({
            title: existing ? "Edit link" : "Insert link",
            body: $b,
            buttons: buttons
        });
        d.body.find(".lnk-url").trigger("focus");
    }

    /* ================= images ================= */
    function imageMenuItems() {
        return [
            { label: "From ArozOS storage...", icon: "hdd outline", action: insertImageFromStorage },
            { label: "From this device...", icon: "upload", action: function () { $("#deviceImageInput").trigger("click"); } },
            { label: "From URL...", icon: "world", action: insertImageFromUrl }
        ];
    }
    function insertImage(src) {
        if (!src) return;
        restoreSel();
        try {
            document.execCommand("insertHTML", false,
                '<img src="' + esc(src) + '" style="max-width:100%;">');
        } catch (e) { }
        afterEdit(true);
    }
    function insertImageFromStorage() {
        try {
            ao_module_openFileSelector(function (files) {
                if (files && files.length > 0) {
                    // reference the storage file - packToFile embeds it into
                    // the container at save time, keeping edits lightweight
                    insertImage(OfficeApp.mediaUrl(files[0].filepath));
                }
            }, "user:/Desktop", "file", false, {
                filter: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]
            });
        } catch (e) {
            OfficeApp.toast("File selector unavailable outside ArozOS", "error");
        }
    }
    function insertImageFromUrl() {
        OfficeApp.prompt("Insert image from URL", "Image URL", "", function (v) {
            if (v) insertImage(v.trim());
        });
    }
    function selectImage(img) {
        deselectImage();
        selectedImg = img;
        img.classList.add("of-selimg");
        // put the caret right after the image so Delete/typing behaves naturally
        try {
            var r = document.createRange();
            r.setStartAfter(img);
            r.collapse(true);
            var sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(r);
            savedRange = r.cloneRange();
        } catch (e) { }
        imgHandle = document.createElement("div");
        imgHandle.className = "of-img-handle of-noprint";
        imgHandle.title = "Drag to resize";
        document.body.appendChild(imgHandle);
        positionImgHandle();
        imgHandle.addEventListener("pointerdown", startImgResize);
    }
    function deselectImage() {
        if (selectedImg) {
            selectedImg.classList.remove("of-selimg");
            if (!selectedImg.getAttribute("class")) selectedImg.removeAttribute("class");
            selectedImg = null;
        }
        if (imgHandle) {
            if (imgHandle.parentNode) imgHandle.parentNode.removeChild(imgHandle);
            imgHandle = null;
        }
    }
    function positionImgHandle() {
        if (!selectedImg || !imgHandle) return;
        var r = selectedImg.getBoundingClientRect();
        imgHandle.style.left = (r.right - 7) + "px";
        imgHandle.style.top = (r.bottom - 7) + "px";
    }
    function startImgResize(e) {
        if (!selectedImg) return;
        e.preventDefault();
        e.stopPropagation();
        var startX = e.clientX;
        var startW = selectedImg.getBoundingClientRect().width;   // visual px
        var z = (OfficeApp.getZoom() || 100) / 100;
        function move(ev) {
            var w = Math.max(24, (startW + (ev.clientX - startX)) / z);
            selectedImg.style.width = Math.round(w) + "px";
            selectedImg.style.height = "auto";
            positionImgHandle();
        }
        function up() {
            document.removeEventListener("pointermove", move);
            document.removeEventListener("pointerup", up);
            afterEdit(true);
        }
        document.addEventListener("pointermove", move);
        document.addEventListener("pointerup", up);
    }
    function imageSizeDialog(img) {
        var curW = Math.round(img.getBoundingClientRect().width / ((OfficeApp.getZoom() || 100) / 100));
        var $b = $("<div></div>");
        $b.append("<label>Width (px)</label>");
        var $w = $('<input type="number" min="16" max="4000" class="img-w">').val(curW);
        $b.append($w);
        $b.append('<p style="color:var(--of-fg-soft);font-size:12px;margin:8px 0 0;">Height follows automatically to keep the aspect ratio.</p>');
        OfficeApp.dialog({
            title: "Image size",
            body: $b,
            buttons: [
                { label: "Cancel" },
                { label: "Reset", action: function (close) {
                    close();
                    img.style.width = "";
                    img.style.height = "";
                    afterEdit(true);
                } },
                { label: "Apply", primary: true, action: function (close, $body) {
                    var w = parseInt($body.find(".img-w").val(), 10);
                    close();
                    if (w && w >= 16) {
                        img.style.width = w + "px";
                        img.style.height = "auto";
                        afterEdit(true);
                    }
                } }
            ]
        });
    }

    /* ================= tables ================= */
    /* Word-style drag-over grid table creator (Insert > Table) */
    var TGRID_COLS = 10, TGRID_ROWS = 8;
    function insertTable(rows, cols) {
        var html = '<table class="of-table"><tbody>';
        for (var r = 0; r < rows; r++) {
            html += "<tr>";
            for (var c = 0; c < cols; c++) html += "<td><br></td>";
            html += "</tr>";
        }
        html += "</tbody></table><p><br></p>";
        restoreSel();
        try { document.execCommand("insertHTML", false, html); } catch (e) { }
        afterEdit(true);
    }
    function insertTableDialog() {
        if (inHeaderFooter()) return;
        var $b = $("<div></div>");
        var $label = $('<div class="doc-tgrid-label">1 × 1</div>');
        var $grid = $('<div class="doc-tgrid"></div>');
        var dlg;
        var hotR = 1, hotC = 1;
        function paint() {
            $grid.children().each(function () {
                var r = parseInt($(this).attr("data-r"), 10);
                var c = parseInt($(this).attr("data-c"), 10);
                $(this).toggleClass("hot", r <= hotR && c <= hotC);
            });
            $label.text(hotC + " × " + hotR);
        }
        for (var r = 1; r <= TGRID_ROWS; r++) {
            for (var c = 1; c <= TGRID_COLS; c++) {
                var $cell = $('<button type="button" class="doc-tgrid-cell"></button>')
                    .attr("data-r", r).attr("data-c", c);
                $grid.append($cell);
            }
        }
        // hover / drag over the grid selects the size, click (or release)
        // inserts - matching the Word ribbon gesture
        $grid.on("pointerover pointermove", ".doc-tgrid-cell", function () {
            hotR = parseInt($(this).attr("data-r"), 10);
            hotC = parseInt($(this).attr("data-c"), 10);
            paint();
        });
        $grid.on("click pointerup", ".doc-tgrid-cell", function () {
            var rr = parseInt($(this).attr("data-r"), 10);
            var cc = parseInt($(this).attr("data-c"), 10);
            dlg.close();
            insertTable(rr, cc);
        });
        var $custom = $('<div class="dlg-two-col" style="margin-top:10px;"></div>');
        $custom.append("<div><label>Rows</label><input type='number' min='1' max='50' class='tbl-rows' value='3'></div>");
        $custom.append("<div><label>Columns</label><input type='number' min='1' max='20' class='tbl-cols' value='3'></div>");
        $b.append($label).append($grid)
            .append('<label style="margin-top:12px;">Custom size</label>')
            .append($custom);
        dlg = OfficeApp.dialog({
            title: "Insert table",
            body: $b,
            buttons: [
                { label: "Cancel" },
                {
                    label: "Insert custom size", action: function (close, $body) {
                        var rows = Math.min(50, Math.max(1, parseInt($body.find(".tbl-rows").val(), 10) || 3));
                        var cols = Math.min(20, Math.max(1, parseInt($body.find(".tbl-cols").val(), 10) || 3));
                        close();
                        insertTable(rows, cols);
                    }
                }
            ]
        });
        paint();
    }

    /* ---------- table styling (themes / borders / banding) ----------
       The style state lives in data attributes on the <table> so toggles
       know it and re-application after row/column edits keeps banding
       consistent; the rendered look is plain inline CSS (survives the
       native format, HTML export and - for shading - docx). Cells with
       data-cellbg carry a user-picked background that themes/banding
       never overwrite. */
    var TABLE_THEMES = [
        { name: "Plain",       bc: "#b9bec7", headbg: "#eef1f5", bandbg: "#f4f6f9", headfc: "" },
        { name: "Blue",        bc: "#a9c6e8", headbg: "#d9e7f8", bandbg: "#eef4fc", headfc: "" },
        { name: "Green",       bc: "#b2d8b4", headbg: "#d9efdb", bandbg: "#effaf0", headfc: "" },
        { name: "Orange",      bc: "#f0c9a4", headbg: "#fbe3c9", bandbg: "#fdf3e7", headfc: "" },
        { name: "Dark header", bc: "#9aa0a6", headbg: "#3c4043", bandbg: "#f1f3f4", headfc: "#ffffff" }
    ];
    function applyTableStyle(table) {
        var bw = parseFloat(table.getAttribute("data-th-bw")) || 1;
        var bc = table.getAttribute("data-th-bc") || "#b9bec7";
        var headOn = table.getAttribute("data-th-head") === "1";
        var bandOn = table.getAttribute("data-th-band") === "1";
        var headBg = table.getAttribute("data-th-headbg") || "#e8eaed";
        var headFc = table.getAttribute("data-th-headfc") || "";
        var bandBg = table.getAttribute("data-th-bandbg") || "#f4f5f7";
        for (var r = 0; r < table.rows.length; r++) {
            var row = table.rows[r];
            for (var c = 0; c < row.cells.length; c++) {
                var cell = row.cells[c];
                cell.style.border = bw + "px solid " + bc;
                var custom = cell.getAttribute("data-cellbg");
                var isHead = headOn && r === 0;
                var isBand = bandOn && ((r - (headOn ? 1 : 0)) % 2 === 1);
                if (custom) cell.style.backgroundColor = custom;
                else if (isHead) cell.style.backgroundColor = headBg;
                else if (isBand) cell.style.backgroundColor = bandBg;
                else cell.style.backgroundColor = "";
                cell.style.fontWeight = isHead ? "700" : "";
                cell.style.color = (isHead && headFc) ? headFc : "";
            }
        }
        afterEdit(true);
    }
    function currentCell() {
        var n = savedRange ? savedRange.startContainer : null;
        if (n && n.nodeType === 3) n = n.parentNode;
        var cell = n && n.closest ? n.closest("td,th") : null;
        return cell && editor.contains(cell) ? cell : null;
    }
    function currentTable() {
        var cell = currentCell();
        return cell ? cell.closest("table") : null;
    }
    function tableAddRow(table, index) {
        var cols = (table.rows[0] ? table.rows[0].cells.length : 1);
        var tr = table.insertRow(index);
        for (var i = 0; i < cols; i++) tr.insertCell(-1).innerHTML = "<br>";
        applyTableStyle(table);
    }
    function tableAddCol(table, index) {
        for (var i = 0; i < table.rows.length; i++) {
            var row = table.rows[i];
            var at = Math.min(index, row.cells.length);
            row.insertCell(at).innerHTML = "<br>";
        }
        applyTableStyle(table);
    }
    function tableDelRow(table, ri) {
        table.deleteRow(ri);
        if (table.rows.length === 0 && table.parentNode) {
            table.parentNode.removeChild(table);
            afterEdit(true);
            return;
        }
        applyTableStyle(table);
    }
    function tableDelCol(table, ci) {
        var empty = true;
        for (var i = 0; i < table.rows.length; i++) {
            var row = table.rows[i];
            if (row.cells.length > ci) row.deleteCell(ci);
            if (row.cells.length > 0) empty = false;
        }
        if (empty && table.parentNode) {
            table.parentNode.removeChild(table);
            afterEdit(true);
            return;
        }
        applyTableStyle(table);
    }
    /* the contextual "Table" menubar menu (visible while the caret is in a
       table) - also reused as a submenu of the table context menu */
    function tableMenuItems() { return tableMenuItemsFor(currentCell()); }
    function tableMenuItemsFor(cell) {
        var table = cell ? cell.closest("table") : null;
        if (!table) {
            return [{ label: "Click inside a table first", enabled: function () { return false; }, action: function () { } }];
        }
        function toggleAttr(attr) {
            table.setAttribute(attr, table.getAttribute(attr) === "1" ? "" : "1");
            applyTableStyle(table);
        }
        var items = [
            {
                label: "Header row", icon: "heading",
                checked: function () { return table.getAttribute("data-th-head") === "1"; },
                action: function () { toggleAttr("data-th-head"); }
            },
            {
                label: "Banded rows", icon: "bars",
                checked: function () { return table.getAttribute("data-th-band") === "1"; },
                action: function () { toggleAttr("data-th-band"); }
            },
            {
                label: "Table theme", icon: "paint brush",
                sub: TABLE_THEMES.map(function (t) {
                    return {
                        label: t.name,
                        action: function () {
                            table.setAttribute("data-th-bc", t.bc);
                            table.setAttribute("data-th-headbg", t.headbg);
                            table.setAttribute("data-th-headfc", t.headfc);
                            table.setAttribute("data-th-bandbg", t.bandbg);
                            table.setAttribute("data-th-head", "1");
                            table.setAttribute("data-th-band", "1");
                            applyTableStyle(table);
                        }
                    };
                })
            },
            {
                label: "Border weight", icon: "window minimize outline",
                sub: [0.5, 1, 2, 3].map(function (w) {
                    return {
                        label: w + " px",
                        checked: function () { return (parseFloat(table.getAttribute("data-th-bw")) || 1) === w; },
                        action: function () {
                            table.setAttribute("data-th-bw", String(w));
                            applyTableStyle(table);
                        }
                    };
                })
            },
            {
                label: "Border color...", icon: "pencil alternate",
                action: function () {
                    OfficeColorPicker.open({
                        anchor: cell,
                        value: table.getAttribute("data-th-bc") || "#b9bec7",
                        onPick: function (hex) {
                            if (!hex) return;
                            table.setAttribute("data-th-bc", hex);
                            applyTableStyle(table);
                        }
                    });
                }
            },
            {
                label: "Cell background...", icon: "square full",
                action: function () {
                    OfficeColorPicker.open({
                        anchor: cell,
                        value: cell.getAttribute("data-cellbg") || "#ffffff",
                        allowNone: true, noneLabel: "Clear (use theme)",
                        onPick: function (hex) {
                            if (hex) cell.setAttribute("data-cellbg", hex);
                            else cell.removeAttribute("data-cellbg");
                            applyTableStyle(table);
                        }
                    });
                }
            },
            { sep: true }
        ];
        return items.concat(tableContextItems(cell));
    }
    function tableContextItems(cell) {
        var table = cell.closest("table");
        var row = cell.parentNode;
        var ci = cell.cellIndex;
        var ri = row.rowIndex;
        return [
            { label: "Insert row above", icon: "angle up", action: function () { tableAddRow(table, ri); } },
            { label: "Insert row below", icon: "angle down", action: function () { tableAddRow(table, ri + 1); } },
            { label: "Insert column left", icon: "angle left", action: function () { tableAddCol(table, ci); } },
            { label: "Insert column right", icon: "angle right", action: function () { tableAddCol(table, ci + 1); } },
            { sep: true },
            { label: "Delete row", icon: "minus", action: function () { tableDelRow(table, ri); } },
            { label: "Delete column", icon: "minus", action: function () { tableDelCol(table, ci); } },
            { label: "Delete table", icon: "trash alternate outline", action: function () {
                if (table.parentNode) table.parentNode.removeChild(table);
                afterEdit(true);
            } }
        ];
    }

    /* ================= special characters ================= */
    function specialCharsDialog() {
        if (inHeaderFooter()) return;
        var $b = $("<div></div>");
        var $tabs = $('<div class="sc-tabs"></div>');
        var $grid = $('<div class="sc-grid"></div>');
        function showTab(i) {
            $tabs.children().removeClass("active").eq(i).addClass("active");
            $grid.empty();
            CHAR_TABS[i].cps.forEach(function (cp) {
                var ch = String.fromCodePoint(cp);
                var $c = $('<button type="button" class="sc-char"></button>').text(ch)
                    .attr("title", "U+" + cp.toString(16).toUpperCase());
                $c.on("mousedown", function (e) { e.preventDefault(); });
                $c.on("click", function () {
                    restoreSel();
                    try { document.execCommand("insertText", false, ch); } catch (e) { }
                    afterEdit(true);
                });
                $grid.append($c);
            });
        }
        CHAR_TABS.forEach(function (t, i) {
            var $tb = $('<button type="button" class="sc-tab"></button>').text(t.name);
            $tb.on("click", function () { showTab(i); });
            $tabs.append($tb);
        });
        $b.append($tabs).append($grid);
        showTab(0);
        OfficeApp.dialog({
            title: "Special characters",
            body: $b,
            wide: true,
            buttons: [{ label: "Close" }]
        });
    }

    /* ================= find and replace ================= */
    function openFind(withReplace) {
        $("#findPanel").show();
        if (withReplace) $("#replaceRow").show();
        var selTxt = savedRange ? savedRange.toString() : "";
        if (selTxt && selTxt.length <= 80 && selTxt.indexOf("\n") < 0) {
            $("#findInput").val(selTxt);
        }
        $("#findInput").trigger("focus").trigger("select");
        runFind(false);
    }
    function closeFind() {
        $("#findPanel").hide();
        $("#replaceRow").hide();
        clearFindHits();
    }
    function clearFindHits() {
        var hits = editor.querySelectorAll("span.of-find-hit");
        for (var i = 0; i < hits.length; i++) {
            var s = hits[i];
            while (s.firstChild) s.parentNode.insertBefore(s.firstChild, s);
            s.parentNode.removeChild(s);
        }
        if (hits.length) editor.normalize();
        findState.hits = [];
        findState.cur = -1;
        updateFindCount();
    }
    function runFind(keepIndex) {
        var oldCur = keepIndex ? Math.max(findState.cur, 0) : 0;
        clearFindHits();
        var term = $("#findInput").val();
        if (!term) { updateFindCount(); return; }
        var tl = term.toLowerCase();
        var walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null, false);
        var nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        nodes.forEach(function (node) {
            var text = node.nodeValue;
            if (!text) return;
            var lower = text.toLowerCase();
            var idx = lower.indexOf(tl);
            if (idx < 0) return;
            var frag = document.createDocumentFragment();
            var pos = 0;
            while (idx >= 0) {
                if (idx > pos) frag.appendChild(document.createTextNode(text.slice(pos, idx)));
                var sp = document.createElement("span");
                sp.className = "of-find-hit";
                sp.textContent = text.substr(idx, term.length);
                frag.appendChild(sp);
                pos = idx + term.length;
                idx = lower.indexOf(tl, pos);
            }
            if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
            node.parentNode.replaceChild(frag, node);
        });
        findState.hits = Array.prototype.slice.call(editor.querySelectorAll("span.of-find-hit"));
        if (findState.hits.length > 0) {
            findState.cur = Math.min(oldCur, findState.hits.length - 1);
            setCurrentHit(findState.cur);
        } else {
            findState.cur = -1;
        }
        updateFindCount();
    }
    function setCurrentHit(i) {
        findState.hits.forEach(function (h) { h.classList.remove("of-find-cur"); });
        var h = findState.hits[i];
        if (h) {
            h.classList.add("of-find-cur");
            try { h.scrollIntoView({ block: "center", behavior: "smooth" }); }
            catch (e) { h.scrollIntoView(); }
        }
    }
    function findStep(dir) {
        var len = findState.hits.length;
        if (!len) { runFind(false); return; }
        findState.cur = (findState.cur + dir + len) % len;
        setCurrentHit(findState.cur);
        updateFindCount();
    }
    function updateFindCount() {
        var len = findState.hits.length;
        $("#findCount").text(len ? (findState.cur + 1) + "/" + len : "0/0");
    }
    function replaceCurrent() {
        if (findState.cur < 0 || !findState.hits.length) { findStep(1); return; }
        var hit = findState.hits[findState.cur];
        var rep = $("#replaceInput").val();
        hit.parentNode.replaceChild(document.createTextNode(rep), hit);
        editor.normalize();
        afterEdit(true);
        runFind(true);   // same index now points at the next match
    }
    function replaceAllMatches() {
        var n = findState.hits.length;
        if (!n) { runFind(false); n = findState.hits.length; }
        if (!n) { OfficeApp.toast("No matches to replace"); return; }
        var rep = $("#replaceInput").val();
        findState.hits.forEach(function (h) {
            h.parentNode.replaceChild(document.createTextNode(rep), h);
        });
        editor.normalize();
        findState.hits = [];
        findState.cur = -1;
        updateFindCount();
        afterEdit(true);
        OfficeApp.toast(n + " occurrence" + (n === 1 ? "" : "s") + " replaced");
    }
    function bindFindPanel() {
        $("#findInput").on("input", function () { runFind(false); });
        $("#findInput, #replaceInput").on("keydown", function (e) {
            if (e.key === "Enter") {
                e.preventDefault();
                if (this.id === "replaceInput") replaceCurrent();
                else findStep(e.shiftKey ? -1 : 1);
            } else if (e.key === "Escape") {
                e.preventDefault();
                closeFind();
                editor.focus();
            }
            e.stopPropagation();
        });
        $("#findNext").on("click", function () { findStep(1); });
        $("#findPrev").on("click", function () { findStep(-1); });
        $("#findClose").on("click", function () { closeFind(); editor.focus(); });
        $("#replaceOne").on("click", replaceCurrent);
        $("#replaceAllBtn").on("click", replaceAllMatches);
    }

    /* ================= page setup / print css ================= */
    function applyPageSetup() {
        var d = PAGE_SIZES[pageConf.size] || PAGE_SIZES.A4;
        var w = (pageConf.orientation === "landscape") ? d.h : d.w;
        var h = (pageConf.orientation === "landscape") ? d.w : d.h;
        var m = pageConf.margins;
        pageEl.style.width = w + "mm";
        pageEl.style.minHeight = h + "mm";
        pageEl.style.padding = m.top + "mm " + m.right + "mm " + m.bottom + "mm " + m.left + "mm";
        // multi-column text layout (2 = IEEE-paper style); blocks marked
        // with .col-span-all (title, authors) stretch across every column
        if (pageConf.columns > 1) {
            editor.style.columnCount = pageConf.columns;
            editor.style.columnGap = pageConf.colGap + "mm";
            editor.style.columnFill = "balance";
        } else {
            editor.style.columnCount = "";
            editor.style.columnGap = "";
            editor.style.columnFill = "";
        }
        updatePrintStyle();
        updatePageGuides();
    }
    function updatePrintStyle() {
        var m = pageConf.margins;
        var sizeKw = { "A4": "A4", "Letter": "letter", "Legal": "legal" }[pageConf.size] || "A4";
        var css = "@page {\n";
        css += "    size: " + sizeKw + " " + pageConf.orientation + ";\n";
        css += "    margin: " + m.top + "mm " + m.right + "mm " + m.bottom + "mm " + m.left + "mm;\n";
        if (pageConf.pageNumbers) {
            /* best effort - @page margin boxes print the page counter in
               engines that support them; ignored elsewhere */
            css += "    @bottom-center { content: counter(page); font-size: 10pt; color: #666; font-family: Arial, sans-serif; }\n";
        }
        css += "}\n";
        css += "@media print {\n";
        css += "    #page { width: auto !important; min-height: 0 !important; padding: 0 !important; }\n";
        css += "}\n";
        var tag = document.getElementById("pagePrintStyle");
        if (tag) tag.textContent = css;
    }
    /* ---------- page guides (visual pagination) ---------- */
    var MM_PX = 96 / 25.4;
    var PAGE_GAP_PX = 24;    // visual gap between two sheets at a page break
    function pageGuidesOn() { return OfficeApp.getSetting("pageGuides", true); }
    // element top in layout px relative to #page (CSS zoom safe - unlike
    // getBoundingClientRect, offsetTop is not scaled)
    function offsetTopInPage(el) {
        var y = 0;
        while (el && el !== pageEl) {
            y += el.offsetTop;
            el = el.offsetParent;
        }
        return y;
    }
    /* True multi-page rendering.
       Every page boundary - explicit (Insert > Page break) or automatic
       (content overflow) - is a real block in the flow that eats the rest
       of its sheet and paints the gap between two separate sheets:
         - explicit breaks are .doc-pagebreak (persisted, exported to docx)
         - automatic ones are .doc-pagebreak.doc-autobreak, layout-only
           spacers inserted before the block that crosses the boundary and
           STRIPPED from serialization (cleanedHtml)
       Blocks taller than a page cannot be split, and CSS multi-column
       layouts reflow around inserted blocks, so those cases fall back to
       the dotted guide line. */
    var GAP_OVERHANG_PX = 26;   // gap band reaches past the sheet edge so it
                                // also cuts the sheet's side shadow
    function gapMarkup() {
        return '<div class="doc-pb-gap"><div class="doc-pb-gap-in"></div></div>';
    }
    function removeAutoBreaks(root) {
        var list = root.querySelectorAll(".doc-autobreak");
        for (var i = 0; i < list.length; i++) {
            if (list[i].parentNode) list[i].parentNode.removeChild(list[i]);
        }
    }
    /* stretch a break element so the next content starts at the top of the
       following sheet; returns that sheet's content-top offset */
    function stretchBreak(el, pageStart, innerHpx, topPx, mLeftPx, mRightPx, mBotPx) {
        el.style.height = "0px";
        var top = offsetTopInPage(el);
        // a break can sit several auto-pages further down (guarded above,
        // but keep the math safe)
        while (top >= pageStart + innerHpx) pageStart += innerHpx;
        var rest = Math.max(0, pageStart + innerHpx - top);
        el.style.height = (rest + mBotPx + PAGE_GAP_PX + topPx) + "px";
        var gap = el.querySelector(".doc-pb-gap");
        if (gap) {
            gap.style.top = (rest + mBotPx) + "px";
            gap.style.height = PAGE_GAP_PX + "px";
            gap.style.left = -(mLeftPx + GAP_OVERHANG_PX) + "px";
            gap.style.right = -(mRightPx + GAP_OVERHANG_PX) + "px";
            var inner = gap.firstChild;
            if (inner) {
                // the sheet-edge shadows only span the actual sheet width
                inner.style.left = GAP_OVERHANG_PX + "px";
                inner.style.right = GAP_OVERHANG_PX + "px";
            }
        }
        return top + parseFloat(el.style.height);
    }
    // first top-level editor block extending past the boundary (the one that
    // must move to the next sheet)
    function blockAtBoundary(boundary) {
        for (var c = editor.firstElementChild; c; c = c.nextElementSibling) {
            var top = offsetTopInPage(c);
            if (top + c.offsetHeight > boundary + 1) return c;
        }
        return null;
    }
    function updatePageGuides() {
        var holder = document.getElementById("pageGuides");
        if (!holder) {
            holder = document.createElement("div");
            holder.id = "pageGuides";
            holder.className = "of-noprint";
            pageEl.appendChild(holder);
        }
        holder.innerHTML = "";
        var d = PAGE_SIZES[pageConf.size] || PAGE_SIZES.A4;
        var pageHmm = (pageConf.orientation === "landscape") ? d.w : d.h;
        var m = pageConf.margins;
        var innerHpx = Math.max(60, (pageHmm - m.top - m.bottom) * MM_PX);
        var topPx = m.top * MM_PX;
        var mL = m.left * MM_PX, mR = m.right * MM_PX, mB = m.bottom * MM_PX;
        var multiCol = pageConf.columns > 1;

        // relayout from the natural flow (self-heal breaks that arrived
        // without their gap markup, e.g. via raw HTML)
        removeAutoBreaks(editor);
        normalizePageBreaks();
        var breaks = Array.prototype.slice.call(editor.querySelectorAll(".doc-pagebreak"));
        var i;
        for (i = 0; i < breaks.length; i++) breaks[i].style.height = "0px";

        var pages = 1;
        var pageStart = topPx;
        var bi = 0;
        var guard = 0;
        while (guard++ < 400) {
            var boundary = pageStart + innerHpx;
            // (a) an explicit break on this page ends it early
            if (bi < breaks.length && offsetTopInPage(breaks[bi]) <= boundary + 0.5) {
                pageStart = stretchBreak(breaks[bi++], pageStart, innerHpx, topPx, mL, mR, mB);
                pages++;
                continue;
            }
            // small epsilon guards against 1px scrollHeight rounding creating
            // a phantom extra page
            if (boundary >= pageEl.scrollHeight - mB - 6 - 0.5) break;
            // (b) automatic overflow: separate the sheets for real by pushing
            // the crossing block onto the next sheet with a layout-only spacer
            if (!multiCol) {
                var block = blockAtBoundary(boundary);
                if (block && block === breaks[bi]) {
                    // the boundary lands just before an explicit break - the
                    // break itself owns this cut
                    pageStart = stretchBreak(breaks[bi++], pageStart, innerHpx, topPx, mL, mR, mB);
                    pages++;
                    continue;
                }
                if (block && offsetTopInPage(block) > pageStart + 1) {
                    var sp = document.createElement("div");
                    sp.className = "doc-pagebreak doc-autobreak";
                    sp.setAttribute("contenteditable", "false");
                    sp.innerHTML = gapMarkup();
                    block.parentNode.insertBefore(sp, block);
                    pageStart = stretchBreak(sp, pageStart, innerHpx, topPx, mL, mR, mB);
                    pages++;
                    continue;
                }
            }
            // (c) unsplittable block / multi-column layout: dotted fallback
            if (pageGuidesOn()) {
                var g = document.createElement("div");
                g.className = "doc-pageguide";
                g.style.top = boundary + "px";
                g.setAttribute("data-label", "Page " + (pages + 1));
                holder.appendChild(g);
            }
            pageStart = boundary;
            pages++;
        }
        // the last sheet always shows at full page height
        pageEl.style.minHeight = (pageStart + innerHpx + mB) + "px";
        return pages;
    }
    /* ---------- explicit page breaks ---------- */
    function pageBreakHtml() {
        return '<div class="doc-pagebreak" contenteditable="false">' +
            gapMarkup() + "</div>";
    }
    // imported / restored breaks may lack the gap child or the guard attribute
    function normalizePageBreaks() {
        var list = editor.querySelectorAll(".doc-pagebreak");
        for (var i = 0; i < list.length; i++) {
            list[i].setAttribute("contenteditable", "false");
            if (!list[i].querySelector(".doc-pb-gap-in")) {
                list[i].innerHTML = gapMarkup();
            }
        }
    }
    function insertPageBreak() {
        if (inHeaderFooter()) return;
        restoreSel();
        // trailing paragraph so there is always somewhere to type on the new page
        try {
            document.execCommand("insertHTML", false, pageBreakHtml() + "<p><br></p>");
        } catch (e) { return; }
        normalizePageBreaks();
        afterEdit(true);
        updatePageGuides();
        OfficeApp.setStatus("Page break inserted");
    }
    function toggleLayoutBoxes() {
        var on = !document.body.classList.contains("doc-show-boxes");
        document.body.classList.toggle("doc-show-boxes", on);
        OfficeApp.setSetting("layoutBoxes", on);
        OfficeApp.setStatus(on
            ? "Layout boxes on - orange = full width (spans all columns), blue = column text"
            : "Layout boxes off");
    }

    /* ---------- layout presets ---------- */
    function setColumns(count, gap) {
        pageConf.columns = Math.min(3, Math.max(1, count));
        if (gap !== undefined) pageConf.colGap = gap;
        applyPageSetup();
        afterEdit(true);
        OfficeApp.setStatus(count > 1 ? count + "-column layout applied" : "Single column layout");
    }
    function applyIeeePreset() {
        // IEEE conference paper geometry: US Letter, 0.75in top, 1in bottom,
        // 0.625in sides, two columns with a 0.17in gap
        pageConf.size = "Letter";
        pageConf.orientation = "portrait";
        pageConf.margins = { top: 19, right: 16, bottom: 25, left: 16 };
        pageConf.columns = 2;
        pageConf.colGap = 5;
        applyPageSetup();
        afterEdit(true);
        OfficeApp.setStatus("IEEE paper layout applied - mark the title block with Format > Page layout > Span all columns");
    }
    function toggleSpanAll() {
        var blocks = getSelectedBlocks();
        if (!blocks.length) {
            OfficeApp.setStatus("Place the cursor in the paragraph(s) to span first", "error");
            return;
        }
        var on = !blocks[0].classList.contains("col-span-all");
        blocks.forEach(function (b) { b.classList.toggle("col-span-all", on); });
        afterEdit(true);
    }
    function layoutMenuItems() {
        return [
            {
                label: "Single column",
                checked: function () { return pageConf.columns === 1; },
                action: function () { setColumns(1); }
            },
            {
                label: "Two columns",
                checked: function () { return pageConf.columns === 2; },
                action: function () { setColumns(2); }
            },
            {
                label: "Three columns",
                checked: function () { return pageConf.columns === 3; },
                action: function () { setColumns(3); }
            },
            { sep: true },
            { label: "IEEE paper preset", icon: "graduation cap", action: applyIeeePreset },
            { sep: true },
            {
                label: "Span all columns",
                checked: function () {
                    var b = getSelectedBlocks();
                    return b.length > 0 && b[0].classList.contains("col-span-all");
                },
                action: toggleSpanAll
            }
        ];
    }

    function pageSetupDialog() {
        var $b = $("<div></div>");
        var $grid = $('<div class="ps-grid"></div>');
        var $size = $('<select class="ps-size"></select>');
        Object.keys(PAGE_SIZES).forEach(function (k) {
            var d = PAGE_SIZES[k];
            $size.append($("<option></option>").attr("value", k)
                .text(k + " (" + d.w + " × " + d.h + " mm)"));
        });
        $size.val(pageConf.size);
        var $ori = $('<select class="ps-ori"></select>')
            .append('<option value="portrait">Portrait</option>')
            .append('<option value="landscape">Landscape</option>');
        $ori.val(pageConf.orientation);
        $grid.append($("<div></div>").append("<label>Paper size</label>").append($size));
        $grid.append($("<div></div>").append("<label>Orientation</label>").append($ori));
        var m = pageConf.margins;
        [["top", "Top margin (mm)", m.top], ["bottom", "Bottom margin (mm)", m.bottom],
         ["left", "Left margin (mm)", m.left], ["right", "Right margin (mm)", m.right]].forEach(function (f) {
            var $in = $('<input type="number" min="0" max="80" step="1">')
                .addClass("ps-m-" + f[0]).val(f[2]);
            $grid.append($("<div></div>").append("<label>" + f[1] + "</label>").append($in));
        });
        var $cols = $('<select class="ps-cols"><option value="1">1 (single)</option><option value="2">2 (IEEE style)</option><option value="3">3</option></select>');
        $cols.val(String(pageConf.columns));
        $grid.append($("<div></div>").append("<label>Text columns</label>").append($cols));
        var $gap = $('<input type="number" min="2" max="30" step="1" class="ps-gap">').val(pageConf.colGap);
        $grid.append($("<div></div>").append("<label>Column gap (mm)</label>").append($gap));
        $b.append($grid);
        var $chk = $('<label class="ps-check"><input type="checkbox" class="ps-pn"> Print page numbers (bottom center, browser support permitting)</label>');
        $chk.find("input").prop("checked", pageConf.pageNumbers);
        $b.append($chk);
        OfficeApp.dialog({
            title: "Page setup",
            body: $b,
            buttons: [
                { label: "Cancel" },
                { label: "Apply", primary: true, action: function (close, $body) {
                    pageConf.size = $body.find(".ps-size").val();
                    pageConf.orientation = $body.find(".ps-ori").val();
                    pageConf.margins = {
                        top: clampMm($body.find(".ps-m-top").val()),
                        right: clampMm($body.find(".ps-m-right").val()),
                        bottom: clampMm($body.find(".ps-m-bottom").val()),
                        left: clampMm($body.find(".ps-m-left").val())
                    };
                    pageConf.columns = Math.min(3, Math.max(1, parseInt($body.find(".ps-cols").val(), 10) || 1));
                    pageConf.colGap = Math.min(30, Math.max(2, num($body.find(".ps-gap").val(), 8)));
                    pageConf.pageNumbers = $body.find(".ps-pn").prop("checked");
                    close();
                    applyPageSetup();
                    afterEdit(true);
                } }
            ]
        });
    }
    function clampMm(v) {
        return Math.min(80, Math.max(0, num(v, 20)));
    }

    /* ================= word / character count ================= */
    function scheduleCounts() {
        clearTimeout(countTimer);
        countTimer = setTimeout(updateCounts, 300);
    }
    function updateCounts() {
        var text = editor.innerText || "";
        var words = (text.match(/\S+/g) || []).length;
        var chars = text.replace(/\n/g, "").length;
        var pages = updatePageGuides();
        OfficeApp.updateStatusItem("wc",
            words + " word" + (words === 1 ? "" : "s") + " · " +
            chars + " character" + (chars === 1 ? "" : "s") + " · " +
            pages + " page" + (pages === 1 ? "" : "s"));
        updateSuggestStatus();
    }

    /* ================= review: comments ================= */
    /* Comments live in body.comments [{id, text, at, resolved}] and are
       anchored in the content as <span class="doc-cmt" data-cid="...">.
       Resolving/deleting unwraps the anchor; anchors whose text was
       edited away show as orphaned cards. */
    function genCmtId() {
        return "cm-" + Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
    }
    function cmtSpan(id) {
        return editor.querySelector('span.doc-cmt[data-cid="' + id + '"]');
    }
    function unwrapEl(el) {
        while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el);
        el.parentNode.removeChild(el);
    }
    function commentDialog(existing) {
        restoreSel();
        var range = null;
        if (!existing) {
            var sel = window.getSelection();
            if (savedRange && !savedRange.collapsed && editor.contains(savedRange.commonAncestorContainer)) {
                range = savedRange.cloneRange();
            } else if (sel && sel.rangeCount && !sel.getRangeAt(0).collapsed &&
                editor.contains(sel.getRangeAt(0).commonAncestorContainer)) {
                range = sel.getRangeAt(0).cloneRange();
            }
            if (!range) {
                OfficeApp.setStatus("Select the text to comment on first", "error");
                return;
            }
        }
        var $b = $('<label>Comment</label>' +
            '<textarea id="docCmtText" rows="4" style="width:100%;resize:vertical;"></textarea>');
        if (existing) $b.filter("textarea").val(existing.text);
        OfficeApp.dialog({
            title: existing ? "Edit comment" : "Add comment",
            body: $b,
            buttons: [
                { label: "Cancel" },
                {
                    label: existing ? "Save" : "Comment", primary: true,
                    action: function (close, $bd) {
                        var text = String($bd.find("#docCmtText").val() || "").trim();
                        close();
                        if (!text) return;
                        if (existing) {
                            existing.text = text;
                        } else {
                            var id = genCmtId();
                            var span = document.createElement("span");
                            span.className = "doc-cmt";
                            span.setAttribute("data-cid", id);
                            try {
                                range.surroundContents(span);
                            } catch (e) {
                                // selection crosses element boundaries
                                span.appendChild(range.extractContents());
                                range.insertNode(span);
                            }
                            comments.push({ id: id, text: text, at: Date.now(), resolved: false });
                        }
                        afterEdit(true);
                        renderCommentsPanel();
                        showCommentsPanel(true);
                    }
                }
            ]
        });
        setTimeout(function () { $("#docCmtText").focus(); }, 50);
    }
    function commentById(id) {
        for (var i = 0; i < comments.length; i++) if (comments[i].id === id) return comments[i];
        return null;
    }
    function resolveComment(id, remove) {
        var span = cmtSpan(id);
        if (span) unwrapEl(span);
        if (remove) {
            comments = comments.filter(function (c) { return c.id !== id; });
        } else {
            var c = commentById(id);
            if (c) c.resolved = true;
        }
        editor.normalize();
        afterEdit(true);
        renderCommentsPanel();
    }
    function openComments() { return comments.filter(function (c) { return !c.resolved; }); }
    function showCommentsPanel(show) {
        $("#docCmtPanel").toggle(show);
        OfficeApp.setSetting("cmtPanel", show);
    }
    function commentsPanelVisible() { return $("#docCmtPanel").is(":visible"); }
    function renderCommentsPanel(activeId) {
        var $p = $("#docCmtPanel");
        if (!$p.length) return;
        var $list = $p.find(".doc-cmt-list").empty();
        var open = openComments();
        $p.find(".doc-cmt-count").text(open.length ? open.length : "");
        if (!open.length) {
            $list.append('<div class="doc-cmt-empty">No comments. Select some text and use ' +
                'Insert &gt; Comment (Ctrl+Alt+M).</div>');
            return;
        }
        open.forEach(function (c) {
            var span = cmtSpan(c.id);
            var quote = span ? span.textContent : "";
            if (quote.length > 60) quote = quote.substring(0, 60) + "…";
            var $card = $('<div class="doc-cmt-card' + (c.id === activeId ? " active" : "") + '"></div>');
            $card.append($('<div class="doc-cmt-quote"></div>')
                .text(quote || "(commented text was removed)"));
            $card.append($('<div class="doc-cmt-body"></div>').text(c.text));
            $card.append('<div class="doc-cmt-when">' +
                new Date(c.at).toLocaleString() + "</div>");
            var $acts = $('<div class="doc-cmt-actions"></div>');
            var act = function (icon, title, fn) {
                var $a = $('<button type="button" class="of-te-btn" title="' + title + '">' +
                    '<i class="' + icon + ' icon"></i></button>');
                $a.on("click", function (e) { e.stopPropagation(); fn(); });
                return $a;
            };
            $acts.append(act("check", "Resolve (remove the highlight)", function () { resolveComment(c.id, false); }));
            $acts.append(act("pencil alternate", "Edit comment", function () { commentDialog(c); renderCommentsPanel(c.id); }));
            $acts.append(act("trash alternate outline", "Delete comment", function () { resolveComment(c.id, true); }));
            $card.append($acts);
            $card.on("click", function () {
                var sp = cmtSpan(c.id);
                if (sp) {
                    sp.scrollIntoView({ block: "center", behavior: "smooth" });
                    $(".doc-cmt.flash").removeClass("flash");
                    sp.classList.add("flash");
                    setTimeout(function () { sp.classList.remove("flash"); }, 1600);
                }
                renderCommentsPanel(c.id);
            });
            $list.append($card);
        });
    }
    function buildCommentsPanel() {
        var $p = $('<div id="docCmtPanel" class="of-noprint">' +
            '<div class="doc-cmt-head"><i class="comments outline icon"></i> Comments ' +
            '<span class="doc-cmt-count"></span>' +
            '<button type="button" class="of-te-btn doc-cmt-close" title="Close panel">' +
            '<i class="close icon"></i></button></div>' +
            '<div class="doc-cmt-list"></div></div>');
        $p.find(".doc-cmt-close").on("click", function () { showCommentsPanel(false); });
        $("body").append($p);
        $p.hide();
    }

    /* ================= review: track changes (suggest mode) ================= */
    /* While "Suggest edits" is on, typing becomes <ins class="doc-ins"> and
       deleting wraps content in <del class="doc-del"> instead of removing
       it. Every suggestion can be accepted or rejected (context menu or
       Edit menu); foreign exports (docx/html/md/txt) behave as if all
       suggestions were accepted. Paragraph splits/merges are not tracked. */
    function tagOf(node, selector) {
        if (!node) return null;
        if (node.nodeType === 3) node = node.parentNode;
        return node && node.closest ? node.closest(selector) : null;
    }
    function suggestInsert(text) {
        if (!text) return;
        var sel = window.getSelection();
        if (!sel || !sel.rangeCount) return;
        var range = sel.getRangeAt(0);
        if (!range.collapsed) {
            suggestDeleteRange(range);
            sel = window.getSelection();
            range = sel.getRangeAt(0);
        }
        var tn = document.createTextNode(text);
        var insHost = tagOf(range.startContainer, "ins.doc-ins");
        var delHost = tagOf(range.startContainer, "del.doc-del");
        if (insHost && !delHost) {
            range.insertNode(tn);            // grow the existing suggestion
        } else {
            var ins = document.createElement("ins");
            ins.className = "doc-ins";
            ins.appendChild(tn);
            if (delHost) {
                // typing at a suggested deletion: the insertion goes after it
                delHost.parentNode.insertBefore(ins, delHost.nextSibling);
            } else {
                range.insertNode(ins);
            }
        }
        var r2 = document.createRange();
        r2.setStart(tn, tn.nodeValue.length);
        r2.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r2);
        afterEdit(false);
    }
    function suggestDeleteRange(range) {
        var texts = [];
        if (range.commonAncestorContainer.nodeType === 3) {
            texts = [range.commonAncestorContainer];
        } else {
            var walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT, null);
            var n;
            while ((n = walker.nextNode())) {
                if (n.nodeValue !== "" && range.intersectsNode(n)) texts.push(n);
            }
        }
        var caret = document.createRange();
        caret.setStart(range.startContainer, range.startOffset);
        caret.collapse(true);
        texts.forEach(function (tn) {
            var s = tn === range.startContainer ? range.startOffset : 0;
            var e2 = tn === range.endContainer ? range.endOffset : tn.nodeValue.length;
            if (e2 <= s) return;
            if (tagOf(tn, "del.doc-del")) return;          // already marked deleted
            var mid = tn;
            if (s > 0) mid = mid.splitText(s);
            if (e2 - s < mid.nodeValue.length) mid.splitText(e2 - s);
            if (tagOf(mid, "ins.doc-ins")) {
                // deleting our own suggestion: really remove it
                mid.parentNode.removeChild(mid);
                return;
            }
            var del = document.createElement("del");
            del.className = "doc-del";
            mid.parentNode.insertBefore(del, mid);
            del.appendChild(mid);
        });
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(caret);
    }
    function suggestDeleteCollapsed(forward) {
        var sel = window.getSelection();
        if (!sel || !sel.rangeCount || !sel.modify) return;
        sel.modify("extend", forward ? "forward" : "backward", "character");
        if (!sel.rangeCount) return;
        var r = sel.getRangeAt(0);
        if (r.collapsed) return;
        var probe = forward ? r.endContainer : r.startContainer;
        if (tagOf(probe, "ins.doc-ins") && !tagOf(probe, "del.doc-del")) {
            // deleting inside our own insertion: real delete
            try { document.execCommand(forward ? "forwardDelete" : "delete"); } catch (e) { }
            return;
        }
        if (tagOf(probe, "del.doc-del")) {
            // already suggested deleted: just step over it
            if (forward) sel.collapse(r.endContainer, r.endOffset);
            else sel.collapse(r.startContainer, r.startOffset);
            return;
        }
        suggestDeleteRange(r);
    }
    function onEditorBeforeInput(e) {
        if (!suggesting || inHeaderFooter()) return;
        var t = e.inputType || "";
        var sel = window.getSelection();
        if (!sel || !sel.rangeCount) return;
        if (!editor.contains(sel.getRangeAt(0).commonAncestorContainer)) return;
        if (t === "insertText") {
            // insertCompositionText is NOT handled: it is not cancelable, so
            // intercepting it would double-insert IME (e.g. CJK) input -
            // composed text stays untracked instead
            if (e.data === null || e.data === undefined) return;
            e.preventDefault();
            suggestInsert(e.data);
        } else if (t.indexOf("delete") === 0) {
            e.preventDefault();
            var r = sel.getRangeAt(0);
            if (!r.collapsed) suggestDeleteRange(r);
            else suggestDeleteCollapsed(t === "deleteContentForward" || t === "deleteWordForward");
            afterEdit(false);
        }
        // insertParagraph / formatting / drops stay untracked (limitation)
    }
    function allSuggestions() {
        return editor.querySelectorAll("ins.doc-ins, del.doc-del");
    }
    function resolveSuggestion(el, accept) {
        var isIns = el.tagName === "INS";
        if (isIns === accept) unwrapEl(el);    // keep the content
        else el.parentNode.removeChild(el);    // drop it
        editor.normalize();
        afterEdit(true);
    }
    function resolveAllSuggestions(accept) {
        var list = allSuggestions();
        if (!list.length) return;
        for (var i = 0; i < list.length; i++) {
            var el = list[i];
            if (el.tagName === "INS" === accept) unwrapEl(el);
            else if (el.parentNode) el.parentNode.removeChild(el);
        }
        editor.normalize();
        afterEdit(true);
        OfficeApp.setStatus((accept ? "Accepted " : "Rejected ") + list.length + " suggestion(s)");
    }
    function setSuggesting(on) {
        suggesting = !!on;
        OfficeApp.markDirty();
        updateSuggestStatus();
    }
    function updateSuggestStatus() {
        var pending = allSuggestions().length;
        var html = "";
        if (suggesting) {
            html = '<i class="pencil alternate icon"></i>Suggesting' +
                (pending ? " · " + pending + " pending" : "");
        } else if (pending) {
            html = pending + " suggestion(s) pending";
        }
        OfficeApp.updateStatusItem("suggest", html);
    }
    /* content with every suggestion accepted and comment anchors unwrapped -
       what foreign exports (docx/html/md/txt) should contain */
    function resolvedHtml() {
        var div = document.createElement("div");
        div.innerHTML = cleanedHtml();
        var list = div.querySelectorAll("ins.doc-ins, del.doc-del, span.doc-cmt");
        for (var i = 0; i < list.length; i++) {
            var el = list[i];
            if (el.tagName === "DEL") el.parentNode.removeChild(el);
            else unwrapEl(el);
        }
        div.normalize();
        return div.innerHTML;
    }

    /* ================= copy / cut of a selected image =================
       Image selection is app-level (selectImage), not a DOM range, so the
       browser's native copy has nothing to grab. Put the image on the
       system clipboard as HTML - handleEditorPaste's text/html branch
       (and other apps) take it from there. */
    function handleImageCopyCut(e, isCut) {
        if (!selectedImg) return;
        if (!e.clipboardData) return;
        var clone = selectedImg.cloneNode(false);
        clone.classList.remove("of-selimg");
        if (!clone.getAttribute("class")) clone.removeAttribute("class");
        // absolute URL so the image also resolves outside this page
        try { clone.src = selectedImg.src; } catch (err) { }
        e.clipboardData.setData("text/html", clone.outerHTML);
        e.clipboardData.setData("text/plain", "");
        e.preventDefault();
        if (isCut) {
            var img = selectedImg;
            deselectImage();
            if (img.parentNode) img.parentNode.removeChild(img);
            afterEdit(true);
        } else {
            OfficeApp.setStatus("Image copied");
        }
    }

    /* ================= menu-driven clipboard =================
       Ctrl+X/C/V go through the native events; menu clicks have no event,
       so use the async clipboard API (image > html > plain text, mirroring
       handleEditorPaste, including suggest-mode wrapping). */
    function menuCutCopy(isCut) {
        if (selectedImg) {
            // image selection is app-level - write it as HTML ourselves
            var clone = selectedImg.cloneNode(false);
            clone.classList.remove("of-selimg");
            if (!clone.getAttribute("class")) clone.removeAttribute("class");
            try { clone.src = selectedImg.src; } catch (e) { }
            OfficeClipboard.writeAsync({ html: clone.outerHTML, text: "" }).catch(function () { });
            if (isCut) {
                var img = selectedImg;
                deselectImage();
                if (img.parentNode) img.parentNode.removeChild(img);
                afterEdit(true);
            } else {
                OfficeApp.setStatus("Image copied");
            }
            return;
        }
        restoreSel();
        try { document.execCommand(isCut ? "cut" : "copy"); } catch (e) { }
        if (isCut) afterEdit(true);
    }
    function pasteFromMenu(plainOnly) {
        var fallbackText = function () {
            if (navigator.clipboard && navigator.clipboard.readText) {
                navigator.clipboard.readText().then(function (t) {
                    if (!t) return;
                    restoreSel();
                    if (suggesting && !inHeaderFooter()) suggestInsert(t);
                    else { try { document.execCommand("insertText", false, t); } catch (e) { } }
                    afterEdit(true);
                }).catch(function () {
                    OfficeApp.setStatus("Paste blocked by the browser - use Ctrl+V instead", "error");
                });
            } else {
                OfficeApp.setStatus("Use Ctrl+V to paste here", "error");
            }
        };
        if (plainOnly || !(navigator.clipboard && navigator.clipboard.read)) {
            fallbackText();
            return;
        }
        navigator.clipboard.read().then(function (cbItems) {
            var img = null, htmlIt = null;
            cbItems.forEach(function (it) {
                it.types.forEach(function (ty) {
                    if (!img && ty.indexOf("image/") === 0) img = { it: it, ty: ty };
                    if (!htmlIt && ty === "text/html") htmlIt = it;
                });
            });
            if (img) {
                img.it.getType(img.ty).then(function (blob) {
                    OfficeApp.blobToSrc(blob, "pasted.png", function (src) {
                        restoreSel();
                        insertImage(src);
                    }, function (msg) { OfficeApp.toast(msg, "error"); });
                }).catch(fallbackText);
                return;
            }
            if (htmlIt) {
                htmlIt.getType("text/html").then(function (blob) {
                    return blob.text();
                }).then(function (html) {
                    var clean = sanitizeHtml(html, { keepClasses: false });
                    if (!clean) { fallbackText(); return; }
                    if (suggesting && !inHeaderFooter()) {
                        clean = '<ins class="doc-ins">' + clean + "</ins>";
                    }
                    restoreSel();
                    try { document.execCommand("insertHTML", false, clean); } catch (e) { }
                    afterEdit(true);
                }).catch(fallbackText);
                return;
            }
            fallbackText();
        }).catch(fallbackText);
    }

    /* ================= paste ================= */
    function handleEditorPaste(e) {
        var cd = e.clipboardData;
        if (!cd) return;   // let the browser do its default thing
        e.preventDefault();
        // 1. image from clipboard -> dataURL <img>
        var items = cd.items || [];
        for (var i = 0; i < items.length; i++) {
            if (items[i].kind === "file" && items[i].type.indexOf("image/") === 0) {
                var f = items[i].getAsFile();
                if (f) {
                    // small images inline; big ones upload to the workdir
                    OfficeApp.blobToSrc(f, f.name || "pasted.png", function (src) {
                        insertImage(src);
                    }, function (msg) {
                        OfficeApp.toast(msg, "error");
                    });
                    return;
                }
            }
        }
        // 2. HTML clipboard -> sanitized (scripts/styles/classes/ids stripped)
        var html = cd.getData("text/html");
        if (html) {
            var clean = sanitizeHtml(html, { keepClasses: false });
            if (clean) {
                if (suggesting && !inHeaderFooter()) {
                    // pasted content is a suggestion too
                    clean = '<ins class="doc-ins">' + clean + "</ins>";
                }
                try { document.execCommand("insertHTML", false, clean); } catch (err) { }
                afterEdit(true);
                return;
            }
        }
        // 3. plain text (ignore another app's raw marker JSON - its rich
        //    text/html form was handled above)
        var t = cd.getData("text/plain");
        if (t && !(window.OfficeClipboard && OfficeClipboard.isMarker(t))) {
            if (suggesting && !inHeaderFooter()) {
                suggestInsert(t);
                afterEdit(true);
                return;
            }
            try { document.execCommand("insertText", false, t); } catch (err) { }
            afterEdit(true);
        }
    }

    /* ================= exporters ================= */
    function exportBaseName() {
        return OfficeApp.stripExt(OfficeApp.getFileName() || "document") || "document";
    }
    function downloadFile(name, mime, content) {
        var blob = new Blob([content], { type: mime + ";charset=utf-8" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
    }
    function exportPDF() {
        OfficeApp.toast('In the print dialog, choose "Save as PDF" as the destination');
        setTimeout(function () { OfficeApp.print(); }, 900);
    }
    var EXPORT_CSS =
        "body{font-family:Arial,Helvetica,sans-serif;font-size:11pt;line-height:1.5;" +
        "color:#1f2328;max-width:820px;margin:24px auto;padding:0 18px;}" +
        "h1{font-size:20pt;}h2{font-size:16pt;}h3{font-size:13pt;}h4{font-size:11pt;font-style:italic;}" +
        ".doc-title{font-size:26pt;font-weight:400;}" +
        "a{color:#1a58c2;}" +
        "table{border-collapse:collapse;width:100%;}td,th{border:1px solid #b9bec7;padding:4px 8px;vertical-align:top;}" +
        "pre{background:#f1f3f4;border:1px solid #e2e5e9;border-radius:6px;padding:10px 12px;" +
        "font-family:Consolas,'Courier New',monospace;font-size:10pt;overflow-x:auto;white-space:pre-wrap;}" +
        "blockquote{border-left:3px solid #c3c7cc;margin-left:0;padding-left:12px;color:#5f6368;}" +
        "img{max-width:100%;height:auto;}" +
        "hr{border:none;border-top:1px solid #c9cdd3;}" +
        "ul.of-checklist{list-style:none;padding-left:1.4em;}" +
        "ul.of-checklist li::before{content:\"\\2610  \";}" +
        "ul.of-checklist li.checked::before{content:\"\\2611  \";}" +
        "ul.of-checklist li.checked{text-decoration:line-through;color:#888;}" +
        ".hf{color:#777;font-size:9pt;margin:10px 0;}";
    function exportHTML() {
        var body = currentBody();
        var title = exportBaseName();
        var out = "<!DOCTYPE html>\n<html>\n<head>\n<meta charset=\"utf-8\">\n" +
            "<title>" + esc(title) + "</title>\n<style>" + EXPORT_CSS + "</style>\n</head>\n<body>\n";
        if (body.header) out += '<div class="hf">' + esc(body.header) + "</div>\n";
        out += resolvedHtml() + "\n";
        if (body.footer) out += '<div class="hf">' + esc(body.footer) + "</div>\n";
        out += "</body>\n</html>\n";
        downloadFile(title + ".html", "text/html", out);
    }
    function exportText() {
        var div = document.createElement("div");
        div.innerHTML = resolvedHtml();
        downloadFile(exportBaseName() + ".txt", "text/plain", div.innerText || "");
    }
    function exportMarkdown() {
        var div = document.createElement("div");
        div.innerHTML = resolvedHtml();
        var md = htmlToMarkdown(div).replace(/\n{3,}/g, "\n\n").trim() + "\n";
        downloadFile(exportBaseName() + ".md", "text/markdown", md);
    }

    /* --- basic HTML -> Markdown conversion (hand-written, MVP scope) --- */
    function htmlToMarkdown(rootEl) {
        function wrapMark(t, mark) {
            var m = t.match(/^(\s*)([\s\S]*?)(\s*)$/);
            if (!m || !m[2]) return "";
            return m[1] + mark + m[2] + mark + m[3];
        }
        function inline(node) {
            var out = "";
            var kids = node.childNodes;
            for (var i = 0; i < kids.length; i++) {
                var k = kids[i];
                if (k.nodeType === 3) { out += k.nodeValue.replace(/[ \t\r\n]+/g, " "); continue; }
                if (k.nodeType !== 1) continue;
                var tag = k.tagName;
                if (tag === "BR") { out += "  \n"; continue; }
                if (tag === "IMG") {
                    out += "![" + (k.getAttribute("alt") || "") + "](" + (k.getAttribute("src") || "") + ")";
                    continue;
                }
                var inner = inline(k);
                switch (tag) {
                    case "B": case "STRONG": out += wrapMark(inner, "**"); break;
                    case "I": case "EM": out += wrapMark(inner, "*"); break;
                    case "S": case "DEL": case "STRIKE": out += wrapMark(inner, "~~"); break;
                    case "CODE": out += inner.trim() ? "`" + inner.trim() + "`" : ""; break;
                    case "A":
                        out += "[" + (inner.trim() || k.getAttribute("href") || "") +
                            "](" + (k.getAttribute("href") || "") + ")";
                        break;
                    case "UL": case "OL": case "TABLE": case "PRE":
                    case "BLOCKQUOTE": case "P": case "DIV":
                        out += "\n" + block(k, "");
                        break;
                    default: out += inner;
                }
            }
            return out;
        }
        function list(el, indent) {
            var out = "";
            var isOl = el.tagName === "OL";
            var isCheck = el.classList.contains("of-checklist");
            var n = 0;
            for (var i = 0; i < el.children.length; i++) {
                var li = el.children[i];
                if (li.tagName !== "LI") continue;
                n++;
                var marker = isOl ? (n + ". ")
                    : (isCheck ? (li.classList.contains("checked") ? "- [x] " : "- [ ] ") : "- ");
                var liClone = li.cloneNode(true);
                var nested = liClone.querySelectorAll("ul,ol");
                for (var j = nested.length - 1; j >= 0; j--) {
                    if (nested[j].parentNode) nested[j].parentNode.removeChild(nested[j]);
                }
                out += indent + marker + inline(liClone).trim() + "\n";
                for (j = 0; j < li.children.length; j++) {
                    var c = li.children[j];
                    if (c.tagName === "UL" || c.tagName === "OL") out += list(c, indent + "    ");
                }
            }
            return out;
        }
        function mdTable(el) {
            if (!el.rows || !el.rows.length) return "";
            var out = "";
            for (var i = 0; i < el.rows.length; i++) {
                var cells = el.rows[i].cells;
                var line = "|";
                for (var j = 0; j < cells.length; j++) {
                    line += " " + inline(cells[j]).trim().replace(/\|/g, "\\|") + " |";
                }
                out += line + "\n";
                if (i === 0) {
                    var sepLine = "|";
                    for (j = 0; j < cells.length; j++) sepLine += " --- |";
                    out += sepLine + "\n";
                }
            }
            return out;
        }
        function block(node, indent) {
            var out = "";
            var kids = node.childNodes;
            for (var i = 0; i < kids.length; i++) {
                var k = kids[i];
                if (k.nodeType === 3) {
                    var raw = k.nodeValue.trim();
                    if (raw) out += raw + "\n\n";
                    continue;
                }
                if (k.nodeType !== 1) continue;
                var tag = k.tagName;
                if (/^H[1-6]$/.test(tag)) {
                    var lvl = k.classList.contains("doc-title") ? 1 : parseInt(tag.substring(1), 10);
                    out += new Array(lvl + 1).join("#") + " " + inline(k).trim() + "\n\n";
                } else if (tag === "UL" || tag === "OL") {
                    out += list(k, indent) + "\n";
                } else if (tag === "BLOCKQUOTE") {
                    var q = block(k, "").trim().split("\n").map(function (l) { return "> " + l; }).join("\n");
                    out += q + "\n\n";
                } else if (tag === "PRE") {
                    out += "```\n" + k.textContent.replace(/\n$/, "") + "\n```\n\n";
                } else if (tag === "HR") {
                    out += "---\n\n";
                } else if (tag === "TABLE") {
                    out += mdTable(k) + "\n";
                } else if (tag === "P" || tag === "DIV") {
                    if (tag === "DIV" && k.querySelector("ul,ol,table,pre,blockquote,h1,h2,h3,h4,p,div,hr")) {
                        out += block(k, indent);
                    } else {
                        var t = inline(k).trim();
                        if (t) out += t + "\n\n";
                    }
                } else {
                    var t2 = inline(k).trim();
                    if (t2) out += t2 + "\n\n";
                }
            }
            return out;
        }
        return block(rootEl, "");
    }

    /* ================= importers ================= */
    function setImportedContent(html) {
        pageConf = defaultPageConf();
        loadBody({ html: html, page: pageConf, header: "", footer: "", pageNumbers: false });
        undo.reset(snapshot());
    }
    function importTxt(text) {
        var paras = String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n").split(/\n{2,}/);
        var html = paras.map(function (p) {
            return "<p>" + (p.trim() ? esc(p).replace(/\n/g, "<br>") : "<br>") + "</p>";
        }).join("");
        setImportedContent(html);
    }
    function importMd(text) {
        var html = "";
        try {
            if (typeof marked !== "undefined") {
                html = (typeof marked.parse === "function") ? marked.parse(text) : marked(text);
            }
        } catch (e) { html = ""; }
        if (!html) {
            importTxt(text);
            return;
        }
        setImportedContent(sanitizeHtml(html, { keepClasses: false }));
    }
    function importHtml(text) {
        setImportedContent(sanitizeHtml(text, { keepClasses: false }));
    }

    /* ================= DOCX import / export (office AGI lib) ================= */
    var DOCX_BACKEND = "Office/docs/backend/docx.agi";

    function importDocx(fp, fn) {
        OfficeApp.showBusy("Importing " + fn + "...");
        ao_module_agirun(DOCX_BACKEND, { action: "import", src: fp }, function (data) {
            OfficeApp.hideBusy();
            if (!data || data.error) {
                OfficeApp.toast("Import failed: " + ((data && data.error) || "no response"), "error");
                return;
            }
            var b = data.body;
            if (typeof b === "string") {
                try { b = JSON.parse(b); } catch (e) { b = null; }
            }
            if (!b || typeof b.html !== "string") {
                OfficeApp.toast("Import failed: unexpected response", "error");
                return;
            }
            loadBody(b);
            undo.reset(snapshot());
            OfficeApp.markDirty();
            OfficeApp.setStatus("Imported " + fn + " - use Save to store it as .doca");
        }, function () {
            OfficeApp.hideBusy();
            OfficeApp.toast("Import failed: cannot reach the ArozOS backend", "error");
        }, 120000);
    }
    function importDocxDialog() {
        try {
            ao_module_openFileSelector(function (files) {
                if (files && files.length > 0) importDocx(files[0].filepath, files[0].filename);
            }, "user:/Desktop", "file", false, { filter: ["docx"] });
        } catch (e) {
            OfficeApp.toast("File selector is not available here", "error");
        }
    }

    /* inline storage-served images (media?file=...) as data URLs so the
       server-side exporter can embed them */
    function inlineImagesForExport(html) {
        var div = document.createElement("div");
        div.innerHTML = html;
        var imgs = Array.prototype.slice.call(div.querySelectorAll("img"));
        var jobs = imgs.filter(function (im) {
            return im.src && !/^data:/i.test(im.getAttribute("src") || "");
        }).map(function (im) {
            return fetch(im.src).then(function (r) {
                if (!r.ok) throw new Error("http " + r.status);
                return r.blob();
            }).then(function (blob) {
                return new Promise(function (resolve) {
                    var reader = new FileReader();
                    reader.onload = function () {
                        im.setAttribute("src", reader.result);
                        resolve();
                    };
                    reader.onerror = function () { resolve(); };
                    reader.readAsDataURL(blob);
                });
            }).catch(function () { /* leave the URL; exporter skips it */ });
        });
        return Promise.all(jobs).then(function () { return div.innerHTML; });
    }
    function exportDocx() {
        var defName = exportBaseName() + ".docx";
        try {
            ao_module_openFileSelector(function (files) {
                if (!files || !files.length) return;
                var fp = files[0].filepath;
                if (!/\.docx$/i.test(fp)) fp += ".docx";
                OfficeApp.showBusy("Exporting Word file...");
                var body = currentBody();
                // suggestions applied, comment anchors unwrapped
                body.html = resolvedHtml();
                inlineImagesForExport(body.html).then(function (inlined) {
                    body.html = inlined;
                    ao_module_agirun(DOCX_BACKEND, {
                        action: "export",
                        dest: fp,
                        data: JSON.stringify(body)
                    }, function (data) {
                        OfficeApp.hideBusy();
                        if (data && data.error) {
                            OfficeApp.toast("Export failed: " + data.error, "error");
                        } else {
                            OfficeApp.setStatus("Exported " + OfficeApp.basename(fp));
                            OfficeApp.toast("Exported " + OfficeApp.basename(fp));
                        }
                    }, function () {
                        OfficeApp.hideBusy();
                        OfficeApp.toast("Export failed: cannot reach the ArozOS backend", "error");
                    }, 180000);
                });
            }, "user:/Desktop", "new", false, { defaultName: defName });
        } catch (e) {
            OfficeApp.toast("File selector is not available here", "error");
        }
    }

    /* ================= floating selection format bar ================= */
    /* PowerPoint-style mini toolbar (shared OfficeTextEditBar) floating
       above the current text selection inside the editor. */
    function initSelectionBar() {
        if (!window.OfficeTextEditBar) return;
        var barTimer = null;
        function selRect() {
            var sel = window.getSelection();
            if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
            var range = sel.getRangeAt(0);
            if (!editor.contains(range.commonAncestorContainer)) return null;
            var r = range.getBoundingClientRect();
            if (!r || (r.width === 0 && r.height === 0)) return null;
            return r;
        }
        function currentSelFontPx() {
            var n = window.getSelection().anchorNode;
            if (n && n.nodeType === 3) n = n.parentNode;
            if (!n || !editor.contains(n)) return 15;
            var fs = parseFloat(getComputedStyle(n).fontSize);
            return isNaN(fs) ? 15 : Math.round(fs);
        }
        document.addEventListener("selectionchange", function () {
            clearTimeout(barTimer);
            barTimer = setTimeout(function () {
                if ($(".of-dialog-overlay").length) return;
                var r = selRect();
                if (r) {
                    if (!OfficeTextEditBar.isVisible()) {
                        OfficeTextEditBar.show({
                            anchor: editor,
                            getRect: selRect,
                            fontSize: currentSelFontPx(),
                            onFontSize: function (px) { applyFontSize(Math.round(px * 0.75)); }
                        });
                    } else {
                        OfficeTextEditBar.reposition();
                    }
                } else if (OfficeTextEditBar.isVisible() &&
                    !OfficeTextEditBar.contains(document.activeElement)) {
                    OfficeTextEditBar.hide();
                }
            }, 180);
        });
        // keep the bar glued to the text when the document scrolls
        workspaceEl.addEventListener("scroll", function () {
            if (OfficeTextEditBar.isVisible()) OfficeTextEditBar.reposition();
        });
    }

    /* ================= table column / row resizing ================= */
    /* Drag a cell's right border to resize its column (Word-style: the
       neighbour column compensates; the table's outer edge grows the
       table). Drag a bottom border to change the row height. */
    var tblDrag = null;
    function zoomFactor() { return (OfficeApp.getZoom() || 100) / 100; }
    function tableBorderHit(e) {
        if (inHeaderFooter()) return null;
        var cell = e.target.closest ? e.target.closest("td,th") : null;
        if (!cell || !editor.contains(cell)) return null;
        var r = cell.getBoundingClientRect();
        var HOT = 5;
        if (e.clientX >= r.right - HOT && e.clientX <= r.right + HOT) return { cell: cell, type: "col" };
        if (e.clientY >= r.bottom - HOT && e.clientY <= r.bottom + HOT) return { cell: cell, type: "row" };
        return null;
    }
    function cellColIndex(cell) {
        var i = 0;
        var n = cell;
        while (n.previousElementSibling) { n = n.previousElementSibling; i++; }
        return i;
    }
    /* give the table an explicit colgroup so column widths stick */
    function ensureColgroup(table) {
        var cg = table.querySelector("colgroup");
        var firstRow = table.rows.length ? table.rows[0] : null;
        if (!firstRow) return null;
        var cols = firstRow.cells.length;
        if (!cg || cg.children.length !== cols) {
            if (cg) cg.parentNode.removeChild(cg);
            cg = document.createElement("colgroup");
            for (var i = 0; i < cols; i++) {
                var col = document.createElement("col");
                col.style.width = firstRow.cells[i].offsetWidth + "px";
                cg.appendChild(col);
            }
            table.insertBefore(cg, table.firstChild);
            table.style.tableLayout = "fixed";
            table.style.width = table.offsetWidth + "px";
        }
        return cg;
    }
    function onTblPointerMove(e) {
        if (tblDrag) {
            var z = zoomFactor();
            if (tblDrag.type === "col") {
                var dx = (e.clientX - tblDrag.startX) / z;
                var cols = tblDrag.cg.children;
                var i = tblDrag.idx;
                if (i < cols.length - 1) {
                    // inner border: this column grows, the neighbour shrinks
                    var wA = Math.max(24, tblDrag.wA + dx);
                    var give = wA - tblDrag.wA;
                    var wB = Math.max(24, tblDrag.wB - give);
                    cols[i].style.width = Math.round(tblDrag.wA + tblDrag.wB - wB) + "px";
                    cols[i + 1].style.width = Math.round(wB) + "px";
                } else {
                    // outer border: the whole table grows/shrinks
                    var w = Math.max(24, tblDrag.wA + dx);
                    cols[i].style.width = Math.round(w) + "px";
                    tblDrag.table.style.width = Math.round(tblDrag.tw + (w - tblDrag.wA)) + "px";
                }
            } else {
                var dy = (e.clientY - tblDrag.startY) / z;
                tblDrag.row.style.height = Math.max(18, Math.round(tblDrag.h + dy)) + "px";
            }
            e.preventDefault();
            return;
        }
        var hit = tableBorderHit(e);
        editor.style.cursor = hit ? (hit.type === "col" ? "col-resize" : "row-resize") : "";
    }
    function onTblPointerDown(e) {
        var hit = tableBorderHit(e);
        if (!hit) return;
        var table = hit.cell.closest("table");
        if (!table) return;
        e.preventDefault();   // keep the caret where it is
        if (hit.type === "col") {
            var cg = ensureColgroup(table);
            if (!cg) return;
            var idx = cellColIndex(hit.cell);
            if (idx >= cg.children.length) idx = cg.children.length - 1;
            tblDrag = {
                type: "col", table: table, cg: cg, idx: idx,
                startX: e.clientX,
                wA: parseFloat(cg.children[idx].style.width) || hit.cell.offsetWidth,
                wB: (idx < cg.children.length - 1)
                    ? (parseFloat(cg.children[idx + 1].style.width) || 0)
                    : 0,
                tw: table.offsetWidth
            };
        } else {
            var row = hit.cell.parentElement;
            tblDrag = { type: "row", row: row, startY: e.clientY, h: row.offsetHeight };
        }
        document.addEventListener("pointermove", onTblPointerMove);
        document.addEventListener("pointerup", onTblPointerUp);
        document.body.style.userSelect = "none";
    }
    function onTblPointerUp() {
        document.removeEventListener("pointermove", onTblPointerMove);
        document.removeEventListener("pointerup", onTblPointerUp);
        document.body.style.userSelect = "";
        if (tblDrag) {
            tblDrag = null;
            afterEdit(true);
        }
    }
    function initTableResize() {
        editor.addEventListener("pointermove", onTblPointerMove);
        editor.addEventListener("pointerdown", onTblPointerDown);
    }

    /* ================= editor events ================= */
    function bindEditorEvents() {
        editor.addEventListener("input", function () {
            OfficeApp.markDirty();
            scheduleCounts();
            undo.pushDebounced(snapshot, 600);
        });
        editor.addEventListener("paste", handleEditorPaste);
        document.addEventListener("copy", function (e) { handleImageCopyCut(e, false); });
        document.addEventListener("cut", function (e) { handleImageCopyCut(e, true); });
        // track changes: intercept typing/deleting while suggesting
        editor.addEventListener("beforeinput", onEditorBeforeInput);
        editor.addEventListener("click", function (e) {
            var t = e.target;
            // checklist checkbox toggle (click lands in the ::before gutter)
            if (t.tagName === "LI" && t.parentElement &&
                    t.parentElement.classList.contains("of-checklist")) {
                var r = t.getBoundingClientRect();
                if (e.clientX < r.left) {
                    t.classList.toggle("checked");
                    afterEdit(true);
                    e.preventDefault();
                    return;
                }
            }
            if (t.tagName === "IMG") {
                selectImage(t);
                e.preventDefault();
                return;
            }
            if (selectedImg) deselectImage();
            var cmtHit = t.closest ? t.closest("span.doc-cmt") : null;
            if (cmtHit && editor.contains(cmtHit)) {
                showCommentsPanel(true);
                renderCommentsPanel(cmtHit.getAttribute("data-cid"));
            }
            var a = t.closest ? t.closest("a") : null;
            if (a && editor.contains(a)) {
                e.preventDefault();
                if (e.ctrlKey || e.metaKey) {
                    try { window.open(a.href, "_blank", "noopener"); } catch (err) { }
                } else {
                    OfficeApp.setStatus("Ctrl+Click to open link: " + (a.getAttribute("href") || ""), "info", 4000);
                }
            }
        });
        editor.addEventListener("dblclick", function (e) {
            if (e.target.tagName === "IMG") {
                selectImage(e.target);
                imageSizeDialog(e.target);
            }
        });
        editor.addEventListener("keydown", function (e) {
            if ((e.key === "Delete" || e.key === "Backspace") && selectedImg) {
                e.preventDefault();
                var img = selectedImg;
                deselectImage();
                if (img.parentNode) img.parentNode.removeChild(img);
                afterEdit(true);
                return;
            }
            if (e.key === "Tab") {
                e.preventDefault();
                try { document.execCommand(e.shiftKey ? "outdent" : "indent"); } catch (err) { }
                afterEdit(false);
            }
        });
        // editor context menu: table ops + multi-column region control
        editor.addEventListener("contextmenu", function (e) {
            var items = [];
            // review: accept/reject the suggestion under the pointer
            var sug = e.target.closest ? e.target.closest("ins.doc-ins, del.doc-del") : null;
            if (sug && editor.contains(sug)) {
                var what = sug.tagName === "INS" ? "insertion" : "deletion";
                items.push({
                    label: "Accept " + what, icon: "check",
                    action: function () { resolveSuggestion(sug, true); }
                });
                items.push({
                    label: "Reject " + what, icon: "times",
                    action: function () { resolveSuggestion(sug, false); }
                });
                items.push({ sep: true });
            }
            // review: comment actions
            var cmtEl = e.target.closest ? e.target.closest("span.doc-cmt") : null;
            if (cmtEl && editor.contains(cmtEl)) {
                var cm = commentById(cmtEl.getAttribute("data-cid"));
                if (cm) {
                    items.push({
                        label: "View comment", icon: "comment outline",
                        action: function () {
                            showCommentsPanel(true);
                            renderCommentsPanel(cm.id);
                        }
                    });
                    items.push({
                        label: "Resolve comment", icon: "check",
                        action: function () { resolveComment(cm.id, false); }
                    });
                    items.push({ sep: true });
                }
            } else {
                var selNow = window.getSelection();
                if (selNow && selNow.rangeCount && !selNow.getRangeAt(0).collapsed &&
                    editor.contains(selNow.getRangeAt(0).commonAncestorContainer)) {
                    items.push({
                        label: "Comment...", icon: "comment outline", key: "Ctrl+Alt+M",
                        action: function () { commentDialog(null); }
                    });
                    items.push({ sep: true });
                }
            }
            var cell = e.target.closest ? e.target.closest("td,th") : null;
            if (cell && cell.closest("table.of-table") && editor.contains(cell)) {
                items.push({ label: "Table", icon: "table", sub: tableMenuItemsFor(cell) });
                items.push({ sep: true });
            }
            if (pageConf.columns > 1) {
                // let the user pick which region spans the full page width
                var block = e.target.closest ? e.target.closest(BLOCK_SEL) : null;
                if (block && editor.contains(block)) {
                    items.push({
                        label: "Full width (span all columns)", icon: "columns",
                        checked: function () { return block.classList.contains("col-span-all"); },
                        action: function () {
                            block.classList.toggle("col-span-all");
                            afterEdit(true);
                        }
                    });
                    items.push({
                        label: "Show layout boxes",
                        checked: function () { return document.body.classList.contains("doc-show-boxes"); },
                        action: toggleLayoutBoxes
                    });
                    items.push({ sep: true });
                }
            }
            // standard edit block (like Google Docs / Word)
            var selNow2 = window.getSelection();
            var canCopy = !!selectedImg || !!(selNow2 && selNow2.rangeCount &&
                !selNow2.getRangeAt(0).collapsed &&
                editor.contains(selNow2.getRangeAt(0).commonAncestorContainer));
            var copyOk = function () { return canCopy; };
            items.push({ label: "Cut", icon: "cut", key: "Ctrl+X", enabled: copyOk, action: function () { menuCutCopy(true); } });
            items.push({ label: "Copy", icon: "copy", key: "Ctrl+C", enabled: copyOk, action: function () { menuCutCopy(false); } });
            items.push({ label: "Paste", icon: "paste", key: "Ctrl+V", action: function () { pasteFromMenu(false); } });
            items.push({ label: "Paste without formatting", icon: "clipboard outline", action: function () { pasteFromMenu(true); } });
            items.push({ sep: true });
            items.push({ label: "Bold", icon: "bold", key: "Ctrl+B", action: function () { exec("bold"); } });
            items.push({ label: "Italic", icon: "italic", key: "Ctrl+I", action: function () { exec("italic"); } });
            items.push({ label: "Underline", icon: "underline", key: "Ctrl+U", action: function () { exec("underline"); } });
            items.push({ label: "Clear formatting", icon: "eraser", action: clearFormatting });
            items.push({ sep: true });
            items.push({ label: "Insert link...", icon: "linkify", key: "Ctrl+K", action: linkDialog });
            items.push({ label: "Insert page break", icon: "file outline", key: "Ctrl+Enter", action: insertPageBreak });
            items.push({ sep: true });
            items.push({ label: "Select all", icon: "i cursor", key: "Ctrl+A", action: selectAll });
            e.preventDefault();
            OfficeApp.showContextMenu(e.clientX, e.clientY, items);
        });
        // deselect image when clicking anywhere else / typing starts elsewhere
        document.addEventListener("mousedown", function (e) {
            if (selectedImg && e.target !== selectedImg && e.target !== imgHandle) {
                deselectImage();
            }
        });
        workspaceEl.addEventListener("scroll", positionImgHandle);
        window.addEventListener("resize", positionImgHandle);

        // header / footer: plain single-line text only
        [headerEl, footerEl].forEach(function (el) {
            el.addEventListener("input", function () {
                OfficeApp.markDirty();
                undo.pushDebounced(snapshot, 600);
            });
            el.addEventListener("keydown", function (e) {
                if (e.key === "Enter") e.preventDefault();
            });
            el.addEventListener("paste", function (e) {
                e.preventDefault();
                var t = e.clipboardData ? e.clipboardData.getData("text/plain") : "";
                if (t) {
                    try { document.execCommand("insertText", false, t.replace(/\s*\n+\s*/g, " ")); }
                    catch (err) { }
                }
            });
        });
    }

    /* ================= shortcuts ================= */
    function bindShortcuts() {
        OfficeApp.registerShortcut("Ctrl+B", function () { exec("bold"); }, { description: "Bold", group: "Text" });
        OfficeApp.registerShortcut("Ctrl+I", function () { exec("italic"); }, { description: "Italic", group: "Text" });
        OfficeApp.registerShortcut("Ctrl+U", function () { exec("underline"); }, { description: "Underline", group: "Text" });
        OfficeApp.registerShortcut("Ctrl+Shift+X", function () { exec("strikeThrough"); }, { description: "Strikethrough", group: "Text" });
        OfficeApp.registerShortcut("Ctrl+K", linkDialog, { description: "Insert link", group: "Text" });
        OfficeApp.registerShortcut("Ctrl+Alt+M", function () { commentDialog(null); },
            { description: "Add comment", group: "Review" });
        OfficeApp.registerShortcut("Ctrl+Enter", insertPageBreak,
            { description: "Insert page break", group: "Text" });
        OfficeApp.registerShortcut("Ctrl+F", function () { openFind(false); }, { description: "Find" });
        OfficeApp.registerShortcut("Ctrl+H", function () { openFind(true); }, { description: "Find and replace" });
        // lists - register both the digit and the shifted symbol (layout dependent)
        OfficeApp.registerShortcut("Ctrl+Shift+7", function () { exec("insertOrderedList"); });
        OfficeApp.registerShortcut("Ctrl+Shift+&", function () { exec("insertOrderedList"); });
        OfficeApp.registerShortcut("Ctrl+Shift+8", function () { exec("insertUnorderedList"); });
        OfficeApp.registerShortcut("Ctrl+Shift+*", function () { exec("insertUnorderedList"); });
    }

    /* ================= boot ================= */
    $(document).ready(function () {
        editor = document.getElementById("editor");
        headerEl = document.getElementById("docHeader");
        footerEl = document.getElementById("docFooter");
        pageEl = document.getElementById("page");
        workspaceEl = document.getElementById("workspace");

        undo = new OfficeUndoStack({
            limit: 100,
            apply: function (s) { applySnapshot(s); }
        });

        buildToolbar();
        trackSelection();
        bindEditorEvents();
        bindFindPanel();

        try { document.execCommand("styleWithCSS", false, true); } catch (e) { }
        try { document.execCommand("defaultParagraphSeparator", false, "p"); } catch (e) { }

        OfficeApp.init({
            appName: "Docs",
            appType: "document",
            appIcon: "../img/docs.svg",
            extension: ".doca",
            fileTypeName: "Document",
            packed: true,
            defaultFileName: "New Document",

            serialize: function () { return currentBody(); },
            deserialize: function (body) {
                loadBody(body);
                undo.reset(snapshot());
            },
            create: function () {
                pageConf = defaultPageConf();
                loadBody({ html: "<p><br></p>", page: pageConf, header: "", footer: "", pageNumbers: false });
                undo.reset(snapshot());
            },

            importers: {
                ".txt": function (text) { importTxt(text); },
                ".md": function (text) { importMd(text); },
                ".html": function (text) { importHtml(text); },
                ".htm": function (text) { importHtml(text); }
            },
            binaryImporters: {
                ".docx": importDocx
            },

            onUndo: doUndo,
            onRedo: doRedo,
            canUndo: function () { return undo.canUndo(); },
            canRedo: function () { return undo.canRedo(); },

            // Edit menubar clipboard shares the context-menu implementations
            // (image-aware copy, async rich paste)
            onCut: function () { menuCutCopy(true); },
            onCopy: function () { menuCutCopy(false); },
            onPaste: function () { pasteFromMenu(false); },

            menus: [
                {
                    title: "Insert",
                    items: function () {
                        return [
                            { label: "Image", icon: "image outline", sub: imageMenuItems() },
                            { label: "Table...", icon: "table", action: insertTableDialog },
                            { label: "Link...", icon: "linkify", key: "Ctrl+K", action: linkDialog },
                            { label: "Comment...", icon: "comment outline", key: "Ctrl+Alt+M", action: function () { commentDialog(null); } },
                            { sep: true },
                            { label: "Page break", icon: "file outline", key: "Ctrl+Enter", action: insertPageBreak },
                            { label: "Horizontal rule", icon: "minus", action: function () { exec("insertHorizontalRule"); } },
                            { label: "Code block", icon: "code", action: function () { applyParagraphStyle("pre"); } },
                            { label: "Block quote", icon: "quote left", action: function () { applyParagraphStyle("blockquote"); } },
                            { sep: true },
                            { label: "Special characters...", icon: "smile outline", action: specialCharsDialog }
                        ];
                    }
                },
                {
                    title: "Format",
                    items: function () {
                        return [
                            { label: "Page layout", icon: "columns", sub: layoutMenuItems },
                            { sep: true },
                            {
                                label: "Paragraph style", icon: "paragraph",
                                sub: PARA_STYLES.map(function (s) {
                                    return { label: s.label, action: function () { applyParagraphStyle(s.v); } };
                                })
                            },
                            {
                                label: "Align", icon: "align left",
                                sub: [
                                    { label: "Left", icon: "align left", action: function () { exec("justifyLeft"); } },
                                    { label: "Center", icon: "align center", action: function () { exec("justifyCenter"); } },
                                    { label: "Right", icon: "align right", action: function () { exec("justifyRight"); } },
                                    { label: "Justify", icon: "align justify", action: function () { exec("justifyFull"); } }
                                ]
                            },
                            {
                                label: "Line spacing", icon: "text height",
                                sub: function () {
                                    var cur = currentLineSpacing();
                                    return LINE_SPACINGS.map(function (v) {
                                        return {
                                            label: v === "1" ? "Single (1)" : v,
                                            checked: cur === v,
                                            action: function () { setLineSpacing(v); }
                                        };
                                    });
                                }
                            },
                            { sep: true },
                            { label: "Bulleted list", icon: "list ul", key: "Ctrl+Shift+8", action: function () { exec("insertUnorderedList"); } },
                            { label: "Numbered list", icon: "list ol", key: "Ctrl+Shift+7", action: function () { exec("insertOrderedList"); } },
                            { label: "Checklist", icon: "check square outline", action: toggleChecklist },
                            { sep: true },
                            { label: "Clear formatting", icon: "eraser", action: clearFormatting }
                        ];
                    }
                },
                {
                    // contextual: only visible while the caret is in a table
                    title: "Table",
                    when: function () { return !!currentTable(); },
                    items: tableMenuItems
                }
            ],
            fileMenuExtras: [
                { label: "Page setup...", icon: "file alternate outline", action: pageSetupDialog },
                { label: "Import Word (.docx)...", icon: "file word outline", action: importDocxDialog },
                {
                    label: "Export", icon: "external alternate",
                    sub: [
                        { label: "Word (.docx)", icon: "file word outline", action: exportDocx },
                        { label: "PDF (via print dialog)", icon: "file pdf outline", action: exportPDF },
                        { label: "Web page (.html)", icon: "file code outline", action: exportHTML },
                        { label: "Markdown (.md)", icon: "file alternate outline", action: exportMarkdown },
                        { label: "Plain text (.txt)", icon: "file outline", action: exportText }
                    ]
                }
            ],
            editMenuExtras: [
                { label: "Find...", icon: "search", key: "Ctrl+F", action: function () { openFind(false); } },
                { label: "Find and replace...", icon: "exchange", key: "Ctrl+H", action: function () { openFind(true); } },
                { sep: true },
                { label: "Select all", icon: "i cursor", key: "Ctrl+A", action: selectAll },
                { sep: true },
                {
                    label: "Suggest edits", icon: "pencil alternate",
                    checked: function () { return suggesting; },
                    action: function () { setSuggesting(!suggesting); }
                },
                {
                    label: "Accept all suggestions", icon: "check circle outline",
                    enabled: function () { return allSuggestions().length > 0; },
                    action: function () { resolveAllSuggestions(true); }
                },
                {
                    label: "Reject all suggestions", icon: "times circle outline",
                    enabled: function () { return allSuggestions().length > 0; },
                    action: function () { resolveAllSuggestions(false); }
                }
            ],

            viewMenuExtras: [
                {
                    label: "Page guides",
                    checked: pageGuidesOn,
                    action: function () {
                        OfficeApp.setSetting("pageGuides", !pageGuidesOn());
                        updatePageGuides();
                    }
                },
                {
                    label: "Layout boxes",
                    checked: function () { return document.body.classList.contains("doc-show-boxes"); },
                    action: toggleLayoutBoxes
                },
                {
                    label: "Comments panel",
                    checked: function () { return commentsPanelVisible(); },
                    action: function () { showCommentsPanel(!commentsPanelVisible()); }
                },
                {
                    label: "Spell check",
                    checked: function () { return editor.spellcheck; },
                    action: function () {
                        editor.spellcheck = !editor.spellcheck;
                        OfficeApp.setSetting("spellcheck", editor.spellcheck);
                        editor.focus();
                    }
                }
            ],

            zoomTarget: "#page",
            onZoomChanged: function () { positionImgHandle(); },
            onBeforePrint: function () {
                closeFind();
                deselectImage();
                OfficeApp.closeAllMenus();
            },
            onBeforeSave: function () {
                clearFindHits();
                deselectImage();
            }
        });

        bindShortcuts();
        initSelectionBar();
        initTableResize();
        buildCommentsPanel();
        OfficeApp.addStatusItem("suggest", "");
        OfficeApp.addStatusItem("wc", "0 words · 0 characters");
        if (OfficeApp.getSetting("cmtPanel", false)) showCommentsPanel(true);
        updateSuggestStatus();
        if (OfficeApp.getSetting("layoutBoxes", false)) {
            document.body.classList.add("doc-show-boxes");
        }
        editor.spellcheck = OfficeApp.getSetting("spellcheck", true);
        updateCounts();
        editor.focus();
    });
})();
