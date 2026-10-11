/*
    ArozOS Office - cross-app clipboard bridge (OfficeClipboard)
    =============================================================
    Each Office app keeps its own high-fidelity clipboard format in
    text/plain (Slides object JSON, Sheets TSV / chart JSON). This helper
    adds a SHARED text/html representation on copy and parses it on paste,
    so content moves between apps (and to external editors):

        Docs picture      -> Slides / Sheets(*)   as <img>
        Sheets chart       -> Slides / Docs         as <img> (SVG snapshot)
        Sheets cells       -> Slides / Docs         as <table>
        Slides image/text/ -> Docs / Sheets         as <img> / <div> /
              table/shape                            <table> / <img>

    (*) Sheets has no floating-image model, so an image pasted into a cell
        is declined with a hint rather than mangled.

    On paste an app first honours its OWN text/plain marker (same-app,
    full fidelity); only when that is absent does it fall back to the
    shared text/html here. isMarker() lets an app avoid dumping another
    app's raw JSON marker into itself as plain text.
*/

var OfficeClipboard = (function () {
    function escAttr(s) {
        return String(s == null ? "" : s)
            .replace(/&/g, "&amp;").replace(/"/g, "&quot;")
            .replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    /* ---------- builders (copy side) ---------- */
    function imageHtml(src, w, h) {
        var dim = "";
        if (w) dim += ' width="' + Math.round(w) + '"';
        if (h) dim += ' height="' + Math.round(h) + '"';
        return '<img src="' + escAttr(src) + '"' + dim + ">";
    }
    // rows: array of rows; each cell is an HTML string (caller pre-sanitizes)
    function tableHtml(rows, opts) {
        opts = opts || {};
        var out = '<table style="border-collapse:collapse;">';
        rows.forEach(function (row, ri) {
            out += "<tr>";
            row.forEach(function (cell) {
                var tag = (opts.headerRow && ri === 0) ? "th" : "td";
                out += "<" + tag + ' style="border:1px solid #b0b4bb;padding:3px 7px;">' +
                    (cell == null || cell === "" ? "<br>" : cell) + "</" + tag + ">";
            });
            out += "</tr>";
        });
        return out + "</table>";
    }
    // rasterizable SVG -> an <img>-ready data URL
    function svgImageSrc(svg) {
        // guarantee the namespace so the data URL renders as an image
        if (svg.indexOf("xmlns") < 0) {
            svg = svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
        }
        return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    }

    /* ---------- parser (paste side) ---------- */
    // returns { images:[{src,w,h}], tables:[[[cellEl,...],...]], text, html,
    //           hasContent }
    function parse(html) {
        var res = { images: [], tables: [], text: "", html: "", hasContent: false };
        if (!html) return res;
        var doc;
        try {
            doc = new DOMParser().parseFromString(String(html), "text/html");
        } catch (e) { return res; }
        var body = doc.body;
        if (!body) return res;

        var imgs = body.querySelectorAll("img[src]");
        for (var i = 0; i < imgs.length; i++) {
            var src = imgs[i].getAttribute("src");
            if (!src) continue;
            res.images.push({
                src: src,
                w: parseInt(imgs[i].getAttribute("width"), 10) || 0,
                h: parseInt(imgs[i].getAttribute("height"), 10) || 0
            });
        }
        var tables = body.querySelectorAll("table");
        for (var t = 0; t < tables.length; t++) {
            var rows = [];
            var trs = tables[t].querySelectorAll("tr");
            for (var r = 0; r < trs.length; r++) {
                var cells = trs[r].querySelectorAll("td,th");
                if (!cells.length) continue;
                var row = [];
                for (var c = 0; c < cells.length; c++) row.push(cells[c]);
                rows.push(row);
            }
            if (rows.length) res.tables.push(rows);
        }
        res.html = body.innerHTML;
        res.text = body.textContent || "";
        res.hasContent = !!(res.images.length || res.tables.length || res.text.replace(/\s/g, ""));
        return res;
    }

    // is this text/plain another app's raw marker JSON (never real text)?
    function isMarker(text) {
        return typeof text === "string" &&
            /^\s*\{\s*"app"\s*:\s*"arozos-(slides-objects|sheets-chart)"/.test(text);
    }

    /* ---------- async write (menu-driven copies) ----------
       Ctrl+C uses the synchronous copy event (setData on both types); menu
       actions have no event, so write both MIME types via the async API
       when the browser supports multi-type ClipboardItem. */
    function writeAsync(parts) {
        var text = parts.text || "";
        if (!parts.noHistory) record(parts);
        if (parts.html && window.ClipboardItem &&
            navigator.clipboard && navigator.clipboard.write) {
            try {
                var data = {
                    "text/html": new Blob([parts.html], { type: "text/html" }),
                    "text/plain": new Blob([text], { type: "text/plain" })
                };
                return navigator.clipboard.write([new window.ClipboardItem(data)]);
            } catch (e) { /* fall through to text-only */ }
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text);
        }
        return Promise.reject(new Error("clipboard unavailable"));
    }

    /* ---------- the Office clipboard (Home > Clipboard launcher) ----------
       What was copied or cut in any Office window of this browser tab,
       newest first, as {text, html, app, t}. It lives in sessionStorage, so
       Docs, Sheets and Slides opened as ArozOS windows share it and it is
       gone with the tab, like Office's clipboard when the last app closes. */
    var HKEY = "ofClipHistory", HMAX = 24, HTML_MAX = 1024 * 1024;
    function history() {
        try {
            var v = JSON.parse(window.sessionStorage.getItem(HKEY) || "[]");
            return Array.isArray(v) ? v : [];
        } catch (e) { return []; }
    }
    function storeHistory(list) {
        // a full store gives up its oldest entries first
        while (true) {
            try {
                if (list.length) window.sessionStorage.setItem(HKEY, JSON.stringify(list));
                else window.sessionStorage.removeItem(HKEY);
                return;
            } catch (e) {
                if (!list.length) return;
                list.pop();
            }
        }
    }
    function record(parts) {
        var text = String(parts.text || ""), html = String(parts.html || "");
        if (html.length > HTML_MAX) html = "";
        if (!text.replace(/\s/g, "") && !html) return;
        var list = history().filter(function (it) { return !(it.text === text && it.html === html); });
        list.unshift({
            text: text, html: html, t: Date.now(),
            app: (document.body && document.body.getAttribute("data-officeapp")) || ""
        });
        if (list.length > HMAX) list.length = HMAX;
        storeHistory(list);
    }
    function removeFromHistory(i) {
        var list = history();
        list.splice(i, 1);
        storeHistory(list);
    }
    function clearHistory() { storeHistory([]); }
    /* Ctrl+C / Ctrl+X and the Edit menu's copies: the window hears the event
       after the app's own document handler has filled it in; a copy the app
       left to the browser (selected text) is read from the selection, before
       a cut removes it. */
    function onCopyEvent(e) {
        var cd = e.clipboardData, text = "", html = "";
        try {
            text = cd ? cd.getData("text/plain") : "";
            html = cd ? cd.getData("text/html") : "";
        } catch (err) { }
        if (!text && !html) {
            var sel = window.getSelection ? window.getSelection() : null;
            if (sel && sel.rangeCount && !sel.isCollapsed) {
                text = sel.toString();
                var div = document.createElement("div");
                for (var i = 0; i < sel.rangeCount; i++) div.appendChild(sel.getRangeAt(i).cloneContents());
                html = div.innerHTML;
            }
        }
        record({ text: text, html: html });
    }
    window.addEventListener("copy", onCopyEvent);
    window.addEventListener("cut", onCopyEvent);

    return {
        history: history,
        record: record,
        removeFromHistory: removeFromHistory,
        clearHistory: clearHistory,
        imageHtml: imageHtml,
        tableHtml: tableHtml,
        svgImageSrc: svgImageSrc,
        parse: parse,
        isMarker: isMarker,
        writeAsync: writeAsync
    };
})();
