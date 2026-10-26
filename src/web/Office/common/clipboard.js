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

    return {
        imageHtml: imageHtml,
        tableHtml: tableHtml,
        svgImageSrc: svgImageSrc,
        parse: parse,
        isMarker: isMarker,
        writeAsync: writeAsync
    };
})();
