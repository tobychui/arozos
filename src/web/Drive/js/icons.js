/*
    icons.js

    Every glyph Drive draws, as inline SVG: the stroked interface icons and
    the filled file type icons used in the listings. Nothing here is an
    emoji or an icon font (CLAUDE.md rule 6).

        DriveIcons.ui("star")                  -> <svg> markup, 1em, currentColor
        DriveIcons.ui("star", {size: 20})      -> fixed pixel size
        DriveIcons.file("report.pdf", false)   -> file type tile
        DriveIcons.file("Music", true)         -> folder, with an emblem for
                                                  well known folder names
        DriveIcons.category("report.pdf")      -> "pdf"
*/

(function (global) {
    "use strict";

    /* ------------------------------------------------------------------ */
    /*  Interface icons (24 x 24, stroked)                                 */
    /* ------------------------------------------------------------------ */

    //An 8 tooth cog, built from polar coordinates rather than drawn by hand
    function cogPath() {
        var cx = 12, cy = 12, outer = 9.2, inner = 7.1, teeth = 8;
        var pts = [];
        for (var i = 0; i < teeth; i++) {
            var base = (Math.PI * 2 / teeth) * i;
            var half = Math.PI / teeth;
            var a1 = base - half * 0.62, a2 = base - half * 0.32;
            var a3 = base + half * 0.32, a4 = base + half * 0.62;
            pts.push([cx + inner * Math.cos(a1), cy + inner * Math.sin(a1)]);
            pts.push([cx + outer * Math.cos(a2), cy + outer * Math.sin(a2)]);
            pts.push([cx + outer * Math.cos(a3), cy + outer * Math.sin(a3)]);
            pts.push([cx + inner * Math.cos(a4), cy + inner * Math.sin(a4)]);
        }
        var d = "M" + pts.map(function (p) { return p[0].toFixed(2) + " " + p[1].toFixed(2); }).join("L") + "Z";
        return '<path d="' + d + '"/><circle cx="12" cy="12" r="2.9"/>';
    }

    function dots(points, r) {
        return points.map(function (p) {
            return '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="' + (r || 1.35) + '" fill="currentColor" stroke="none"/>';
        }).join("");
    }

    var FOLDER = '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>';
    var PAGE = '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>';

    var UI = {
        home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>',
        users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8"/><path d="M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/>',
        user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
        userPlus: '<circle cx="10" cy="8" r="4"/><path d="M2.5 20.5a7.5 7.5 0 0 1 15 0"/><path d="M19 7v6M16 10h6"/>',
        clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
        star: '<path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-3-5.4 3 1.1-6-4.5-4.2 6.1-.8z"/>',
        starFill: '<path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-3-5.4 3 1.1-6-4.5-4.2 6.1-.8z" fill="currentColor"/>',
        trash: '<path d="M4 7h16"/><path d="M9.5 7V4.5h5V7"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/><path d="M10 11v6M14 11v6"/>',
        drive: '<rect x="3" y="13" width="18" height="7" rx="2"/><path d="M5.5 13 8 5h8l2.5 8"/><path d="M7 16.5h.01M10 16.5h.01"/>',
        globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
        cloud: '<path d="M7 18a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.4 1.5A3.75 3.75 0 0 1 17.5 18z"/>',
        hourglass: '<path d="M7 3h10M7 21h10"/><path d="M8 3v3.5a4 4 0 0 0 1.6 3.2L12 12l2.4-2.3A4 4 0 0 0 16 6.5V3"/><path d="M8 21v-3.5a4 4 0 0 1 1.6-3.2L12 12l2.4 2.3a4 4 0 0 1 1.6 3.2V21"/>',
        cluster: '<rect x="3" y="4" width="7" height="6" rx="1.5"/><rect x="14" y="4" width="7" height="6" rx="1.5"/><rect x="8.5" y="14" width="7" height="6" rx="1.5"/><path d="M6.5 10v2h11v-2M12 12v2"/>',
        share: '<path d="M14 5l6 6-6 6"/><path d="M20 11h-9a7 7 0 0 0-7 7v1"/>',
        link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
        upload: '<path d="M12 15V4"/><path d="M7.5 8.5 12 4l4.5 4.5"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
        download: '<path d="M12 4v11"/><path d="M7.5 10.5 12 15l4.5-4.5"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
        move: FOLDER + '<path d="M9.5 13.5h6.5"/><path d="M13.5 11l2.5 2.5-2.5 2.5"/>',
        copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
        cut: '<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M7.9 16.4 18 4M16.1 16.4 6 4"/>',
        paste: '<rect x="5" y="5" width="14" height="16" rx="2"/><path d="M9 5V3.5h6V5"/><path d="M9 11h6M9 15h4"/>',
        pencil: '<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M14.5 7.5l3 3"/>',
        plus: '<path d="M12 5v14M5 12h14"/>',
        folder: FOLDER,
        folderPlus: FOLDER + '<path d="M12 10.5v6M9 13.5h6"/>',
        folderUp: FOLDER + '<path d="M12 16.5v-6M9.5 13 12 10.5l2.5 2.5"/>',
        folderOpen: '<path d="M3 18V7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v1"/><path d="M3 18l2.5-6.5A1.5 1.5 0 0 1 7 10.5h13.2a1 1 0 0 1 .95 1.3L19 18.5a2 2 0 0 1-1.9 1.5H5a2 2 0 0 1-2-2z"/>',
        file: PAGE,
        filePlus: PAGE + '<path d="M12 11v6M9 14h6"/>',
        fileUp: PAGE + '<path d="M12 17.5v-6M9.5 14 12 11.5l2.5 2.5"/>',
        doc: PAGE + '<path d="M8.5 12.5h7M8.5 16h7"/>',
        moreH: dots([[5, 12], [12, 12], [19, 12]], 1.5),
        moreV: dots([[12, 5], [12, 12], [12, 19]], 1.5),
        chevronDown: '<path d="M6 9l6 6 6-6"/>',
        chevronUp: '<path d="M6 15l6-6 6 6"/>',
        chevronRight: '<path d="M9 6l6 6-6 6"/>',
        chevronLeft: '<path d="M15 6l-6 6 6 6"/>',
        arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
        arrowDown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
        arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
        arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
        list: '<path d="M9 6h11M9 12h11M9 18h11"/>' + dots([[4.5, 6], [4.5, 12], [4.5, 18]], 1.3),
        grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
        sortAsc: '<path d="M7 20V4M3.5 7.5 7 4l3.5 3.5"/><path d="M13 7h8M13 12h6M13 17h4"/>',
        sortDesc: '<path d="M7 4v16M3.5 16.5 7 20l3.5-3.5"/><path d="M13 7h4M13 12h6M13 17h8"/>',
        panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/><path d="M17.5 8.5h1M17.5 11.5h1"/>',
        spread: '<rect x="2.5" y="5" width="8.5" height="14" rx="1.5"/><rect x="13" y="5" width="8.5" height="14" rx="1.5"/>',
        info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><path d="M12 7.6h.01"/>',
        x: '<path d="M6 6l12 12M18 6 6 18"/>',
        check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
        search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.3-4.3"/>',
        bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
        help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.6"/><path d="M12 17h.01"/>',
        cog: cogPath(),
        logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 16l-4-4 4-4"/><path d="M6 12h10"/>',
        sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
        moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
        monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
        external: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
        open: '<rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M10 14l6-6M11 8h5v5"/>',
        newTab: '<rect x="3" y="7" width="14" height="14" rx="2"/><path d="M7 3h12a2 2 0 0 1 2 2v12"/><path d="M10 11v6M7 14h6"/>',
        eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
        eyeOff: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/><path d="M4 4l16 16"/>',
        lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
        qr: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2v2h-2zM18 18h2v2h-2zM18 14h2M14 18v2"/>',
        calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/>',
        history: '<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5"/><path d="M4 4v4.5h4.5"/><path d="M12 8v4.5l3 2"/>',
        activity: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
        refresh: '<path d="M20 12a8 8 0 1 1-2.4-5.7L20 8.5"/><path d="M20 4v4.5h-4.5"/>',
        checkSquare: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12.5l3 3 5-6"/>',
        image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="9.5" r="1.6"/><path d="M4 17l5-5 4 4 2.5-2.5L20 18"/>',
        video: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M10.5 9.5v5l4.5-2.5z"/>',
        music: '<path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
        archive: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M12 4v2.5M12 8.5v2M12 12.5v1.5"/><rect x="10.5" y="14.5" width="3" height="3.5" rx=".8"/>',
        extract: '<path d="M4 9V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3"/><path d="M12 8v11M8 15l4 4 4-4"/>',
        menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
        layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 12.5l9 5 9-5"/><path d="M3 16.5l9 5 9-5"/>',
        pause: '<path d="M9 6v12M15 6v12"/>',
        play: '<path d="M8 5.5v13l10-6.5z"/>',
        alert: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.4h.01"/>',
        translate: '<path d="M4 5h9M8.5 3v2M6 5c.8 3 3 5.5 6 7M11 5c-.8 3.2-3.2 6-6.5 7.5"/><path d="M12.5 21l4-9 4 9M14 17.5h5"/>',
        keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M7 14.5h10"/>',
        sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
        minimize: '<path d="M5 12h14"/>',
        apps: dots([[6, 6], [12, 6], [18, 6], [6, 12], [12, 12], [18, 12], [6, 18], [12, 18], [18, 18]], 1.6),
        zoomIn: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.3-4.3M11 8.5v5M8.5 11h5"/>',
        zoomOut: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.3-4.3M8.5 11h5"/>',
        rotate: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/>',
        restore: '<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5"/><path d="M4 4v4.5h4.5"/>',
        shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/>',
        mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6.5 12 13l8.5-6.5"/>',
        code: '<path d="M8.5 7 3.5 12l5 5M15.5 7l5 5-5 5"/>',
        hide: '<path d="M4 4l16 16"/><path d="M9.9 5.7A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.4M6.4 6.9C3.9 8.6 2.5 12 2.5 12S6 18.5 12 18.5c1.7 0 3.2-.5 4.5-1.2"/>',
        dot: dots([[12, 12]], 3),
        logo: ''
    };

    function ui(name, opts) {
        opts = opts || {};
        var body = UI[name] || UI.file;
        var size = opts.size ? ' width="' + opts.size + '" height="' + opts.size + '"' : "";
        var cls = "ic" + (opts.cls ? " " + opts.cls : "");
        return '<svg class="' + cls + '"' + size + ' viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
            'stroke-width="' + (opts.stroke || 1.8) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            body + '</svg>';
    }

    //The ArozOS mark shown in the top bar
    function logo(size) {
        size = size || 32;
        return '<svg class="logo" width="' + size + '" height="' + size + '" viewBox="0 0 40 40" aria-hidden="true">' +
            '<defs><linearGradient id="drvLogoBg" x1="0" y1="0" x2="1" y2="1">' +
            '<stop offset="0" stop-color="#4f8ff8"/><stop offset="1" stop-color="#1d5fe0"/></linearGradient></defs>' +
            '<rect width="40" height="40" rx="10" fill="url(#drvLogoBg)"/>' +
            '<path d="M20 8.5 30.5 30h-6.2L20 20.6 15.7 30H9.5z" fill="#fff"/>' +
            '<path d="M20 24.4l2.3 5.6h-4.6z" fill="#cfe0ff"/>' +
            '</svg>';
    }

    /* ------------------------------------------------------------------ */
    /*  File type classification                                           */
    /* ------------------------------------------------------------------ */
    var EXT = {};
    function map(cat, list) {
        list.split(" ").forEach(function (e) { EXT[e] = cat; });
    }
    map("image", "jpg jpeg png gif bmp webp svg tif tiff ico heic heif avif jxl raw cr2 nef arw dng");
    map("video", "mp4 webm mkv avi mov flv wmv m4v 3gp ts mts m2ts vob ogv");
    map("audio", "mp3 flac wav aac ogg oga m4a opus wma aiff alac mid midi");
    map("pdf", "pdf");
    map("doc", "doc docx odt rtf pages wpd fodt docm dot dotx");
    map("sheet", "xls xlsx ods csv tsv numbers xlsm xlsb fods");
    map("slide", "ppt pptx odp key pptm fodp");
    map("text", "txt md markdown log ini cfg conf nfo srt ass vtt");
    map("code", "js mjs ts tsx jsx html htm css scss less json xml yaml yml toml go py java c cpp cc h hpp cs php rb rs swift kt sh bat ps1 lua sql agi vue svelte dart");
    map("archive", "zip 7z rar tar gz tgz bz2 xz zst lz4 cab");
    map("design", "psd ai xd sketch fig indd eps cdr afdesign afphoto kra xcf");
    map("font", "ttf otf woff woff2 eot fon");
    map("ebook", "epub mobi azw azw3 djvu fb2 cbz cbr");
    map("exe", "exe msi apk ipa deb rpm app run com dmg");
    map("model", "stl obj step stp fbx glb gltf blend 3ds dae iges igs 3mf ply");
    map("disk", "iso img vhd vhdx vmdk qcow2 vdi");
    map("data", "db sqlite sqlite3 mdb accdb parquet");
    map("shortcut", "shortcut lnk url");

    function getExt(filename) {
        var name = String(filename || "");
        var dot = name.lastIndexOf(".");
        if (dot <= 0 || dot == name.length - 1) {
            return "";
        }
        return name.substring(dot + 1).toLowerCase();
    }

    function category(filename, isDir) {
        if (isDir) {
            return "folder";
        }
        return EXT[getExt(filename)] || "unknown";
    }

    //Sidebar categories group the fine grained file types
    var GROUPS = {
        documents: ["pdf", "doc", "sheet", "slide", "text", "ebook"],
        photos: ["image"],
        videos: ["video"],
        music: ["audio"]
    };

    function group(filename) {
        var cat = category(filename, false);
        for (var g in GROUPS) {
            if (GROUPS[g].indexOf(cat) >= 0) {
                return g;
            }
        }
        return "others";
    }

    function extensionsOf(groupName) {
        var cats = GROUPS[groupName] || [];
        return Object.keys(EXT).filter(function (e) { return cats.indexOf(EXT[e]) >= 0; });
    }

    /* ------------------------------------------------------------------ */
    /*  File type icons (32 x 32, filled)                                  */
    /* ------------------------------------------------------------------ */
    var COLOR = {
        image: "#2f8be6", video: "#8b5cf6", audio: "#ec4899", pdf: "#ef4444",
        doc: "#2563eb", sheet: "#16a34a", slide: "#f97316", text: "#94a3b8",
        code: "#0d9488", archive: "#38a3f1", design: "#a855f7", font: "#64748b",
        ebook: "#c2410c", exe: "#475569", model: "#7c3aed", disk: "#6366f1",
        data: "#0891b2", shortcut: "#64748b", unknown: "#9aa3b2"
    };

    var PAGE_SHAPE = "M9 2.5h10.6L26.5 9.4V27a2.5 2.5 0 0 1-2.5 2.5H9A2.5 2.5 0 0 1 6.5 27V5A2.5 2.5 0 0 1 9 2.5z";
    var PAGE_FOLD = "M19.6 2.5 26.5 9.4h-5A1.9 1.9 0 0 1 19.6 7.5z";

    function label(text, size) {
        return '<text x="16.5" y="23.4" text-anchor="middle" font-family="Segoe UI, Roboto, Helvetica, Arial, sans-serif" ' +
            'font-size="' + size + '" font-weight="700" fill="#fff" letter-spacing=".2">' + text + '</text>';
    }

    var GLYPH = {
        image: '<circle cx="12.8" cy="15.2" r="1.9" fill="#fff"/><path d="M9.3 25.2l4.6-5.4 2.9 3.1 2.4-2.7 3.9 5z" fill="#fff"/>',
        video: '<rect x="9.6" y="14" width="13.8" height="10.4" rx="2.2" fill="#fff" opacity=".28"/><path d="M14.6 15.9v6.6l5.4-3.3z" fill="#fff"/>',
        audio: '<circle cx="13.9" cy="23" r="2.3" fill="#fff"/><path d="M15.3 23v-9.2l5.6 1.7v2.8l-3.8-1.1V23z" fill="#fff"/>',
        pdf: label("PDF", 6.6),
        doc: '<rect x="10.4" y="13.6" width="12.4" height="1.7" rx=".85" fill="#fff"/><rect x="10.4" y="17.2" width="12.4" height="1.7" rx=".85" fill="#fff"/><rect x="10.4" y="20.8" width="12.4" height="1.7" rx=".85" fill="#fff"/><rect x="10.4" y="24.4" width="7.6" height="1.7" rx=".85" fill="#fff"/>',
        sheet: '<rect x="10" y="13.4" width="13.2" height="12" rx="1.4" fill="#fff"/><path d="M10 17.4h13.2M10 21.4h13.2M14.6 13.4v12" stroke="#16a34a" stroke-width="1.3"/>',
        slide: '<rect x="9.8" y="13.6" width="13.6" height="9" rx="1.2" fill="#fff"/><path d="M16.6 22.6v3M13.8 26.2h5.6" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/><rect x="12.4" y="17.6" width="2" height="3" fill="#f97316"/><rect x="15.6" y="16" width="2" height="4.6" fill="#f97316"/><rect x="18.8" y="18.6" width="2" height="2" fill="#f97316"/>',
        text: '<rect x="10.4" y="14.2" width="12.4" height="1.6" rx=".8" fill="#fff"/><rect x="10.4" y="18" width="12.4" height="1.6" rx=".8" fill="#fff"/><rect x="10.4" y="21.8" width="8.6" height="1.6" rx=".8" fill="#fff"/>',
        code: '<path d="M13.8 15.4 10.6 19.3l3.2 3.9M19.4 15.4l3.2 3.9-3.2 3.9" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
        archive: '<rect x="15.1" y="4.2" width="2.8" height="2" rx=".5" fill="#fff"/><rect x="15.1" y="7.8" width="2.8" height="2" rx=".5" fill="#fff"/><rect x="15.1" y="11.4" width="2.8" height="2" rx=".5" fill="#fff"/><rect x="14.2" y="15.2" width="4.6" height="6.6" rx="1.3" fill="#fff"/><rect x="15.4" y="18.4" width="2.2" height="1.8" rx=".4" fill="#38a3f1"/>',
        design: '<path d="M16.5 12.6l5 6.2-5 7.4-5-7.4z" fill="#fff"/><circle cx="16.5" cy="19.3" r="1.5" fill="#a855f7"/><path d="M16.5 12.6v5.2" stroke="#a855f7" stroke-width="1"/>',
        font: label("Aa", 7.6),
        ebook: '<path d="M9.8 15a1 1 0 0 1 1-1h3.4a2.3 2.3 0 0 1 2.3 2.3v9.2a1.9 1.9 0 0 0-1.9-1.9H9.8zM23.2 15a1 1 0 0 0-1-1h-3.4a2.3 2.3 0 0 0-2.3 2.3v9.2a1.9 1.9 0 0 1 1.9-1.9h4.8z" fill="#fff"/>',
        exe: '<rect x="9.8" y="14" width="13.4" height="11" rx="1.6" fill="#fff"/><rect x="9.8" y="14" width="13.4" height="2.8" rx="1.4" fill="#fff" opacity=".7"/><path d="M9.8 16.8h13.4" stroke="#475569" stroke-width="1"/><path d="M13 20l2 1.6-2 1.6M16.6 23.2h3" fill="none" stroke="#475569" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>',
        model: '<path d="M16.5 12.8l5.8 3.2v6.6l-5.8 3.2-5.8-3.2V16z" fill="#fff"/><path d="M10.7 16l5.8 3.2 5.8-3.2M16.5 19.2v6.6" fill="none" stroke="#7c3aed" stroke-width="1.1"/>',
        disk: '<circle cx="16.5" cy="19.6" r="6.2" fill="#fff"/><circle cx="16.5" cy="19.6" r="1.8" fill="#6366f1"/>',
        data: '<ellipse cx="16.5" cy="15" rx="5.6" ry="2" fill="#fff"/><path d="M10.9 15v9.2c0 1.1 2.5 2 5.6 2s5.6-.9 5.6-2V15c0 1.1-2.5 2-5.6 2s-5.6-.9-5.6-2z" fill="#fff" opacity=".85"/><path d="M10.9 19.6c0 1.1 2.5 2 5.6 2s5.6-.9 5.6-2" fill="none" stroke="#0891b2" stroke-width="1"/>',
        shortcut: '<path d="M12 24.5v-2.6a5 5 0 0 1 5-5h3.6" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/><path d="M18.6 14.2l3.2 2.7-3.2 2.7" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
    };

    //Emblems drawn on the front of well known folders (centred near 16,19)
    var EMBLEM = {
        desktop: '<rect x="11.2" y="14.4" width="9.6" height="6.6" rx="1" fill="none" stroke="#fff" stroke-width="1.5"/><path d="M14 23.4h4M16 21v2.4" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>',
        document: '<path d="M12.6 14.6h6.8M12.6 17.8h6.8M12.6 21h4.4" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>',
        music: '<circle cx="14.3" cy="21.7" r="1.7" fill="#fff"/><path d="M15.4 21.7v-6.8l4.2 1.3v2l-2.8-.8v4.3" fill="none" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/>',
        photo: '<circle cx="13.8" cy="15.6" r="1.4" fill="#fff"/><path d="M11 22.6l3.4-3.9 2.2 2.3 1.8-2 2.6 3.6z" fill="#fff"/>',
        video: '<path d="M14.4 14.8v7.2l5.8-3.6z" fill="#fff"/>',
        download: '<path d="M16 14v7M13 18.3l3 3 3-3M12.4 23.4h7.2" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
        web: '<circle cx="16" cy="18.6" r="4.6" fill="none" stroke="#fff" stroke-width="1.3"/><path d="M11.4 18.6h9.2M16 14c1.3 1.3 1.9 2.8 1.9 4.6s-.6 3.3-1.9 4.6c-1.3-1.3-1.9-2.8-1.9-4.6s.6-3.3 1.9-4.6z" fill="none" stroke="#fff" stroke-width="1.1"/>',
        code: '<path d="M13.6 15.6 11.2 18.6l2.4 3M18.4 15.6l2.4 3-2.4 3" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
        shared: '<circle cx="14.2" cy="16.4" r="1.9" fill="#fff"/><path d="M10.8 22.6a3.4 3.4 0 0 1 6.8 0z" fill="#fff"/><circle cx="18.8" cy="16.9" r="1.5" fill="#fff" opacity=".85"/><path d="M18.4 19.4a3 3 0 0 1 3.4 3.2h-3.2" fill="#fff" opacity=".85"/>',
        model: '<path d="M16 13.8l4.4 2.4v5l-4.4 2.4-4.4-2.4v-5z" fill="none" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/><path d="M11.6 16.2l4.4 2.4 4.4-2.4M16 18.6v5" fill="none" stroke="#fff" stroke-width="1.1"/>',
        trash: '<path d="M12 15.2h8M14.6 15.2v-1.2h2.8v1.2M13 15.2l.6 7.4h4.8l.6-7.4" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>'
    };

    var FOLDER_ALIAS = {
        desktop: "desktop", document: "document", documents: "document", music: "music", audio: "music",
        photo: "photo", photos: "photo", picture: "photo", pictures: "photo", image: "photo", images: "photo",
        video: "video", videos: "video", film: "video", movies: "video", download: "download", downloads: "download",
        www: "web", web: "web", mysite: "web", appdata: "code", code: "code", model: "model", models: "model",
        shared: "shared", share: "shared", trash: "trash"
    };

    function folderSVG(emblem) {
        return '<svg class="ft ft-folder" viewBox="0 0 32 32" aria-hidden="true">' +
            '<path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h6.4a2.5 2.5 0 0 1 1.9.9L15.6 9h10.9A2.5 2.5 0 0 1 29 11.5V14H3z" fill="#3b7fef"/>' +
            '<path d="M3 12.4A2.4 2.4 0 0 1 5.4 10h21.2A2.4 2.4 0 0 1 29 12.4v12.1a2.5 2.5 0 0 1-2.5 2.5h-21A2.5 2.5 0 0 1 3 24.5z" fill="#5c9cf8"/>' +
            '<path d="M3 12.4A2.4 2.4 0 0 1 5.4 10h21.2A2.4 2.4 0 0 1 29 12.4v.8H3z" fill="#fff" opacity=".18"/>' +
            (emblem ? '<g opacity=".95">' + emblem + '</g>' : "") +
            '</svg>';
    }

    function file(filename, isDir, opts) {
        opts = opts || {};
        if (isDir) {
            var key = FOLDER_ALIAS[String(filename).toLowerCase()];
            if (opts.shared) {
                key = "shared";
            }
            return folderSVG(opts.plain ? "" : (EMBLEM[key] || ""));
        }
        var cat = category(filename, false);
        var color = COLOR[cat] || COLOR.unknown;
        var glyph = GLYPH[cat];
        if (!glyph) {
            var ext = getExt(filename).substring(0, 4).toUpperCase();
            glyph = ext == "" ? "" : label(ext, ext.length >= 4 ? 5 : (ext.length == 3 ? 6.2 : 7.4));
        }
        return '<svg class="ft ft-' + cat + '" viewBox="0 0 32 32" aria-hidden="true">' +
            '<path d="' + PAGE_SHAPE + '" fill="' + color + '"/>' +
            '<path d="' + PAGE_FOLD + '" fill="#fff" opacity=".42"/>' +
            glyph + '</svg>';
    }

    global.DriveIcons = {
        ui: ui,
        logo: logo,
        file: file,
        getExt: getExt,
        category: category,
        group: group,
        extensionsOf: extensionsOf,
        color: function (cat) { return COLOR[cat] || COLOR.unknown; }
    };
})(window);
