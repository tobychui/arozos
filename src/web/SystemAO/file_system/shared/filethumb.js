/*
    filethumb.js

    Shared file icon and thumbnail logic for the ArozOS file system web apps.
    Both the File Manager (file_explorer.html) and the File Selector
    (file_selector.html) render the same visual language for a file, so the
    glyph drawing, thumbnail streaming and default-opener lookup all live here
    instead of being duplicated per app.

    Everything is exposed on the global FileThumb object.

        FileThumb.getExt("a.tar.gz")            -> "gz"
        FileThumb.smallGlyph(name, isDir)       -> markup for list rows
        FileThumb.largeGlyph(name, isDir)       -> markup for grid tiles / previews
        FileThumb.loadThumbnails({...})         -> streams thumbnails into the DOM
        FileThumb.getDefaultOpener(".mp3", cb)  -> registered WebApp for an extension

    No emoji anywhere - every glyph is drawn as inline SVG (CLAUDE.md rule 6).
*/

(function (global) {
    "use strict";

    /* ------------------------------------------------------------------ */
    /*  File type classification                                           */
    /* ------------------------------------------------------------------ */
    var EXT_CATEGORY = {
        pdf: "pdf",
        doc: "doc", docx: "doc", odt: "doc", rtf: "doc",
        xls: "sheet", xlsx: "sheet", ods: "sheet", csv: "sheet",
        ppt: "slide", pptx: "slide", odp: "slide",
        txt: "text", md: "text", log: "text", ini: "text", cfg: "text",
        zip: "archive", "7z": "archive", rar: "archive", tar: "archive",
        gz: "archive", bz2: "archive", xz: "archive",
        jpg: "image", jpeg: "image", png: "image", gif: "image", bmp: "image",
        webp: "image", svg: "image", psd: "image", tiff: "image", ico: "image",
        mp3: "audio", flac: "audio", wav: "audio", aac: "audio", ogg: "audio",
        m4a: "audio", opus: "audio",
        mp4: "video", webm: "video", mkv: "video", avi: "video", mov: "video",
        flv: "video", wmv: "video",
        js: "code", ts: "code", html: "code", htm: "code", css: "code",
        json: "code", xml: "code", go: "code", py: "code", java: "code",
        c: "code", cpp: "code", h: "code", php: "code", sh: "code",
        agi: "code", sql: "code"
    };

    var CATEGORY_COLOR = {
        pdf: "#e5484d",
        doc: "#2b6cb0",
        sheet: "#188a42",
        slide: "#dd6b20",
        text: "#4a90d9",
        archive: "#3b82f6",
        image: "#7c4dff",
        audio: "#e8467c",
        video: "#8b5cf6",
        code: "#0f9d94",
        unknown: "#7a8290"
    };

    function getExt(filename) {
        if (filename == undefined || String(filename).indexOf(".") < 1) {
            return "";
        }
        return String(filename).split(".").pop().toLowerCase();
    }

    function getCategory(ext) {
        return EXT_CATEGORY[ext] || "unknown";
    }

    function getCategoryColor(ext) {
        return CATEGORY_COLOR[getCategory(ext)];
    }

    function escapeHTML(text) {
        return String(text)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    /*
        Human readable type name for the "Type" column, e.g. "PDF File".
        translate() is an optional (key, fallback) lookup so each app can feed in
        its own applocale instance without this library depending on one.
    */
    function getTypeName(filename, isDir, translate) {
        var t = translate || function (key, fallback) { return fallback; };
        if (isDir) {
            return t("list/typefolder", "File folder");
        }
        var ext = getExt(filename);
        if (ext == "") {
            return t("list/typefile", "File");
        }
        return ext.toUpperCase() + " " + t("list/typefile", "File");
    }

    /* ------------------------------------------------------------------ */
    /*  Drawn glyphs                                                       */
    /* ------------------------------------------------------------------ */
    function folderGlyph() {
        return '<svg viewBox="0 0 48 40">' +
            '<path d="M2 8a4 4 0 0 1 4-4h11.2a3 3 0 0 1 2.4 1.2L22 8h20a4 4 0 0 1 4 4v20a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4z" fill="#f0b429"/>' +
            '<path d="M2 14h44v18a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4z" fill="#fcd34d"/>' +
            '</svg>';
    }

    //Small icon for list rows: a solid rounded tile carrying the extension
    function smallGlyph(filename, isDir) {
        if (isDir) {
            return '<div class="fsSmallIcon">' + folderGlyph() + '</div>';
        }
        var ext = getExt(filename);
        var color = getCategoryColor(ext);
        var label = ext.substring(0, 4).toUpperCase();
        var fontSize = label.length >= 4 ? 5.6 : (label.length == 3 ? 7 : 8.5);
        return '<div class="fsSmallIcon"><svg viewBox="0 0 24 24">' +
            '<path d="M5 3.6h9.2L20 9.4V20a1.6 1.6 0 0 1-1.6 1.6H5A1.6 1.6 0 0 1 3.4 20V5.2A1.6 1.6 0 0 1 5 3.6z" fill="' + color + '"/>' +
            '<path d="M14.2 3.6L20 9.4h-5.8z" fill="#ffffff" fill-opacity="0.42"/>' +
            '<text x="11.7" y="17.4" text-anchor="middle" fill="#ffffff" font-size="' + fontSize + '" font-family="Arial, Helvetica, sans-serif" font-weight="bold">' + escapeHTML(label) + '</text>' +
            '</svg></div>';
    }

    //Large icon for grid tiles and preview panes: a document sheet with a
    //coloured extension badge in the lower left corner
    function largeGlyph(filename, isDir) {
        if (isDir) {
            return '<div class="fsBigIcon">' + folderGlyph() + '</div>';
        }
        var ext = getExt(filename);
        var color = getCategoryColor(ext);
        var label = ext.substring(0, 4).toUpperCase();
        var badgeWidth = 9 + label.length * 4.6;
        var fontSize = label.length >= 4 ? 5.4 : 6.4;
        /*
            The viewBox starts at -1.6, not 0, so the glyph sits centred.

            The sheet spans x 5.2..41.8 (its stroke included) but the extension
            badge deliberately overhangs its left edge down to x=3, with nothing
            balancing it on the right - so the drawn content's centre is 22.4,
            not the 24 a 0..48 window would assume. Shifting the window rather
            than the paths keeps every coordinate below unchanged, and the
            badge's width does not affect it: the sheet always defines the right
            edge and the badge always the left.
        */
        return '<div class="fsBigIcon"><svg viewBox="-1.6 0 48 60">' +
            '<path d="M8 3.5h20.5L41 16v39a2.5 2.5 0 0 1-2.5 2.5h-30A2.5 2.5 0 0 1 6 55V6a2.5 2.5 0 0 1 2-2.5z" fill="#ffffff" stroke="#d3d7dd" stroke-width="1.6"/>' +
            '<path d="M28.5 3.5V16H41" fill="none" stroke="#d3d7dd" stroke-width="1.6"/>' +
            '<path d="M13 25h21M13 31h21M13 37h14" stroke="#dfe3e8" stroke-width="2.2" stroke-linecap="round"/>' +
            (label == "" ? "" :
                '<rect x="3" y="40" width="' + badgeWidth + '" height="12" rx="2.6" fill="' + color + '"/>' +
                '<text x="' + (3 + badgeWidth / 2) + '" y="48.7" text-anchor="middle" fill="#ffffff" font-size="' + fontSize + '" font-family="Arial, Helvetica, sans-serif" font-weight="bold">' + escapeHTML(label) + '</text>') +
            '</svg></div>';
    }

    /*
        Icon envelope

        A drawn glyph has to sit in the same envelope as the themed PNG icons in
        img/desktop/files_icon/, or a folder holding both shows one file type
        noticeably larger than its neighbours. Those PNGs put their artwork in
        68x82 of a 128x128 canvas, which is the ratio below.

        The content boxes are the glyphs' painted bounds in their own viewBox
        units, stroke widths included - measured, not read off the path data,
        because the sheet's 1.6 stroke and the badge's overhang both extend past
        the coordinates written in the markup. They do not depend on the badge
        label: the sheet always defines the right edge and the badge the left.
    */
    var GLYPH_ENVELOPE_W = 68 / 128;
    var GLYPH_ENVELOPE_H = 82 / 128;
    var GLYPH_CONTENT = {
        file:   { x0: 2.90, y0: 2.63, x1: 41.77, y1: 58.25 },
        folder: { x0: 2.00, y0: 4.00, x1: 45.88, y1: 35.88 }
    };

    /*
        Same drawn glyph as largeGlyph(), but as a data: URI so it can be used as
        an <img src>. The File Manager renders its grid tiles with a single <img>
        whose src is later swapped for a real thumbnail, so it needs the fallback
        icon in that form rather than as inline markup.

        The viewBox is replaced with a square one padded so the artwork lands in
        the envelope above. Only this data: URI form is adjusted - largeGlyph()
        is also used inline by the File Selector, where the surrounding CSS box
        already sets the size.
    */
    function glyphDataURL(filename, isDir) {
        var markup = isDir ? folderGlyph() : largeGlyph(filename, isDir);
        //largeGlyph/folderGlyph may be wrapped in a sizing div - take the svg
        var start = markup.indexOf('<svg');
        var end = markup.lastIndexOf('</svg>');
        var svg = (start >= 0 && end > start) ? markup.substring(start, end + 6) : markup;

        //Square window sized by whichever axis reaches its limit first
        var box = isDir ? GLYPH_CONTENT.folder : GLYPH_CONTENT.file;
        var contentW = box.x1 - box.x0;
        var contentH = box.y1 - box.y0;
        var side = Math.max(contentW / GLYPH_ENVELOPE_W, contentH / GLYPH_ENVELOPE_H);
        var minX = (box.x0 + box.x1) / 2 - side / 2;
        var minY = (box.y0 + box.y1) / 2 - side / 2;
        var viewBox = minX.toFixed(3) + ' ' + minY.toFixed(3) + ' ' + side.toFixed(3) + ' ' + side.toFixed(3);

        //An <img> needs an explicit size and namespace on a standalone SVG
        svg = svg.replace(/viewBox="[^"]*"/, 'viewBox="' + viewBox + '"');
        svg = svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" preserveAspectRatio="xMidYMid meet" ');
        return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    }

    /* ------------------------------------------------------------------ */
    /*  Formatting helpers                                                 */
    /* ------------------------------------------------------------------ */
    function formatBytes(bytes) {
        if (bytes == undefined || bytes == null || bytes < 0) {
            return "--";
        }
        if (bytes < 1024) {
            return bytes + " B";
        }
        var units = ["KB", "MB", "GB", "TB", "PB"];
        var value = bytes / 1024;
        var i = 0;
        while (value >= 1024 && i < units.length - 1) {
            value = value / 1024;
            i++;
        }
        return (value < 10 ? value.toFixed(1) : Math.round(value)) + " " + units[i];
    }

    function formatTimestamp(unixSeconds) {
        if (!unixSeconds) {
            return "--";
        }
        var d = new Date(unixSeconds * 1000);
        function pad(n) { return (n < 10 ? "0" : "") + n; }
        return d.getFullYear() + "/" + pad(d.getMonth() + 1) + "/" + pad(d.getDate()) +
            " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
    }

    /*
        Thumbnails come back as bare base64 with no mime header, so the image
        type is inferred from the first character of the encoded payload.
    */
    function thumbExtFromBase64(base64String) {
        var ext = "jpeg";
        if (typeof base64String === "string" || base64String instanceof String) {
            var tid = base64String.charAt(0);
            if (tid == "i") {
                ext = "png";
            } else if (tid == "R") {
                ext = "gif";
            } else if (tid == "U") {
                ext = "webp";
            }
        }
        return ext;
    }

    function base64ToDataURL(base64String) {
        return "data:image/" + thumbExtFromBase64(base64String) + ";base64," + base64String;
    }

    /* ------------------------------------------------------------------ */
    /*  Default opener lookup                                              */
    /* ------------------------------------------------------------------ */
    var openerCache = {};

    /*
        Resolves the WebApp registered to open a given extension (leading dot
        included, e.g. ".mp3"). Results - including "no opener" - are cached for
        the lifetime of the page so a directory of 200 mp3 files only asks once.
    */
    function getDefaultOpener(ext, callback, apiRoot) {
        var root = apiRoot == undefined ? "../../" : apiRoot;
        if (openerCache[ext] !== undefined) {
            callback(openerCache[ext]);
            return;
        }
        $.ajax({
            url: root + "system/modules/getDefault",
            method: "GET",
            data: { opr: "launch", ext: ext },
            success: function (data) {
                openerCache[ext] = (data && data.error == undefined) ? data : null;
                callback(openerCache[ext]);
            },
            error: function () {
                openerCache[ext] = null;
                callback(null);
            }
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Thumbnail streaming                                                */
    /* ------------------------------------------------------------------ */
    /*
        loadThumbnails(options) streams thumbnails for one directory.

        options = {
            root:           API prefix, defaults to "../../"
            folder:         virtual path of the directory being listed
            targets:        [{filename, filepath, isDir}] to request
            includeFolders: request folder previews too. The File Manager wants
                            these (the server builds a layered preview from
                            .metadata/.cache); the File Selector does not.
            onLoad:         function(target, dataURL) called per thumbnail
        }

        Returns a handle with .cancel(). Always cancel before listing another
        directory, otherwise late arrivals paint onto the wrong listing.

        The cache renderer WebSocket does the whole directory in one connection;
        if it is unavailable this falls back to sequential AJAX requests.
    */
    function loadThumbnails(options) {
        var root = options.root == undefined ? "../../" : options.root;
        var targets = options.targets || [];
        var onLoad = options.onLoad || function () { };
        var includeFolders = options.includeFolders === true;

        var wanted = [];
        for (var i = 0; i < targets.length; i++) {
            if (!includeFolders && targets[i].isDir) {
                continue;
            }
            wanted.push(targets[i]);
        }

        var cancelled = false;
        var socket = null;

        var handle = {
            cancel: function () {
                cancelled = true;
                if (socket != null) {
                    try { socket.close(); } catch (ex) { }
                    socket = null;
                }
            }
        };

        if (wanted.length == 0) {
            return handle;
        }

        //Index by filename so websocket frames can be matched back to a target
        var byName = {};
        for (var j = 0; j < wanted.length; j++) {
            byName[wanted[j].filename] = wanted[j];
        }

        function deliver(filename, base64Data) {
            if (cancelled || base64Data == undefined || base64Data == "") {
                return;
            }
            var target = byName[filename];
            if (target == undefined) {
                return;
            }
            onLoad(target, base64ToDataURL(base64Data));
        }

        function startFallback() {
            var index = 0;
            function next() {
                if (cancelled || index >= wanted.length) {
                    return;
                }
                var target = wanted[index];
                index++;
                $.ajax({
                    url: root + "system/file_system/loadThumbnail",
                    data: { vpath: target.filepath },
                    success: function (data) {
                        if (cancelled) {
                            return;
                        }
                        if (data != undefined && data != "" && data.error == undefined) {
                            deliver(target.filename, data);
                        }
                        next();
                    },
                    error: function () {
                        next();
                    }
                });
            }
            next();
        }

        var endpoint = "";
        try {
            endpoint = ao_module_utils.getWebSocketEndpoint() +
                "/system/file_system/handleCacheRender?folder=" + encodeURIComponent(options.folder);
            socket = new WebSocket(endpoint);
        } catch (ex) {
            startFallback();
            return handle;
        }

        socket.onmessage = function (event) {
            if (cancelled) {
                return;
            }
            var frame;
            try {
                frame = JSON.parse(event.data);
            } catch (ex) {
                return;
            }
            if (frame && frame.length > 1) {
                deliver(frame[0], frame[1]);
            }
        };

        socket.onerror = function () {
            //Cache renderer unreachable, fall back to plain AJAX requests
            if (!cancelled) {
                startFallback();
            }
        };

        return handle;
    }

    /* ------------------------------------------------------------------ */
    global.FileThumb = {
        EXT_CATEGORY: EXT_CATEGORY,
        CATEGORY_COLOR: CATEGORY_COLOR,
        getExt: getExt,
        getCategory: getCategory,
        getCategoryColor: getCategoryColor,
        getTypeName: getTypeName,
        escapeHTML: escapeHTML,
        folderGlyph: folderGlyph,
        smallGlyph: smallGlyph,
        largeGlyph: largeGlyph,
        glyphDataURL: glyphDataURL,
        formatBytes: formatBytes,
        formatTimestamp: formatTimestamp,
        thumbExtFromBase64: thumbExtFromBase64,
        base64ToDataURL: base64ToDataURL,
        getDefaultOpener: getDefaultOpener,
        loadThumbnails: loadThumbnails
    };
})(window);
