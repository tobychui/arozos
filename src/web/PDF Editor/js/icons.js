/*
    PDF Editor - icon set

    Drawn 24x24 line icons, injected once as an SVG sprite. PE.icon(name)
    returns the markup of one icon; extra classes size it (sm / lg).
    Paths use currentColor; class "acc" strokes with the accent colour,
    "accf" fills with it and "dk" fills with the text colour.
*/
window.PE = window.PE || {};

(function (PE) {
    'use strict';

    var PAGE = 'M13.5 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8.5zM13.5 3.5v5h5';
    var FILLPAGE = '<path class="fill" d="M7 2.5h7.3L19.5 7.7V20A1.5 1.5 0 0 1 18 21.5H7A1.5 1.5 0 0 1 5.5 20V4A1.5 1.5 0 0 1 7 2.5z"/><path d="M14.3 2.5v5.2h5.2" stroke="#fff" stroke-opacity=".55"/>';

    var I = {
        hand: '<path d="M8 13.5V6.5a1.5 1.5 0 0 1 3 0V12M11 11.5V4.8a1.5 1.5 0 0 1 3 0v6.7M14 11.5V5.8a1.5 1.5 0 0 1 3 0V12M17 12V8.8a1.5 1.5 0 0 1 3 0V15a6.5 6.5 0 0 1-6.5 6.5h-1.3a6.2 6.2 0 0 1-4.7-2.2L3.7 15.5a1.6 1.6 0 0 1 2.4-2.1L8 15.4"/>',
        select: '<path d="M6.5 3.5v15.3l4-3.8 2.6 6 2.6-1.1-2.6-6 5.4-.4z"/>',
        text: '<path d="M5 7V4.5h14V7M12 4.5v15M9 19.5h6"/>',
        image: '<rect x="3.5" y="5" width="17" height="14" rx="1.5"/><circle cx="8.8" cy="9.8" r="1.6"/><path d="M3.8 16.5 8.5 12.3l3.4 3 3.1-2.6 5.3 4.6"/>',
        link: '<path d="M10.2 13.8a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.1 1.1M13.8 10.2a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.1-1.1"/>',
        editpdf: '<path d="M10.5 20.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5h6.5l5 5V10M13.5 3.5v5h5"/><path class="acc" d="M19.8 12.8a1.6 1.6 0 0 1 2.2 2.2l-6.1 6.1-3 .8.8-3z"/>',
        redact: '<path d="' + PAGE + '"/><rect class="dk" x="8" y="11.2" width="8.5" height="3.2" rx=".5"/><path d="M8.5 8h3M8.5 17.5h6"/>',
        addtext: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5" stroke-dasharray="2.2 2"/><path d="M8.5 9.5V8.5h7v1M12 8.5v7M10.5 15.5h3"/>',
        addimage: '<path d="M12.5 5H5A1.5 1.5 0 0 0 3.5 6.5v11A1.5 1.5 0 0 0 5 19h13a1.5 1.5 0 0 0 1.5-1.5V12"/><circle cx="8.5" cy="10" r="1.4"/><path d="M3.8 16.3 8 12.6l3 2.6 2.7-2.3 5.6 4.6"/><path class="acc" d="M18.5 2.5v6M15.5 5.5h6"/>',
        headerfooter: '<rect x="5.5" y="3.5" width="13" height="17" rx="1.5"/><path class="acc" d="M8 6.8h8M8 17.2h8"/><path d="M8 10.2h8M8 12.8h5.5" stroke-opacity=".5"/>',
        pagenumber: '<rect x="5.5" y="3.5" width="13" height="17" rx="1.5"/><path d="M8.5 7h7M8.5 9.8h7M8.5 12.6h4" stroke-opacity=".5"/><path class="acc" d="M13.6 15.6l1.4-.9v4.2"/>',
        rotate: '<path d="M19.5 12a7.5 7.5 0 1 1-2.3-5.4M19.6 3.8v3.9h-3.9"/>',
        rotateleft: '<path d="M4.5 12a7.5 7.5 0 1 0 2.3-5.4M4.4 3.8v3.9h3.9"/>',
        crop: '<path d="M6.5 2.5v13.8a1.2 1.2 0 0 0 1.2 1.2h13.8M2.5 6.5h13.8a1.2 1.2 0 0 1 1.2 1.2v13.8"/>',
        extract: '<path d="M11 20.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5h6.5l5 5V11M13.5 3.5v5h5"/><path class="acc" d="M14 17.5h7.5M18.8 14.8l2.7 2.7-2.7 2.7"/>',
        split: '<rect x="5" y="3" width="14" height="6.5" rx="1.2"/><rect x="5" y="14.5" width="14" height="6.5" rx="1.2"/><path class="acc" d="M2.5 12h2.2M7.2 12h2.2M11.9 12h2.2M16.6 12h2.2M21.3 12h.2"/>',
        watermark: '<path d="' + PAGE + '"/><path class="acc" d="M12 10.3c-1.7 2.2-2.6 3.6-2.6 4.8a2.6 2.6 0 0 0 5.2 0c0-1.2-.9-2.6-2.6-4.8z"/>',
        background: '<path d="' + PAGE + '"/><path class="acc" d="M5.8 12.5 12 6.3M5.8 17.3l9.9-9.9M8.3 20 18.3 10M13 20l5.3-5.3"/>',
        more: '<circle class="fill" cx="5.5" cy="12" r="1.5"/><circle class="fill" cx="12" cy="12" r="1.5"/><circle class="fill" cx="18.5" cy="12" r="1.5"/>',
        todocs: FILLPAGE + '<path d="M8.3 11.2h8.4M8.3 14.2h8.4M8.3 17.2h5.4" stroke="#fff" stroke-width="1.6"/>',
        tosheets: FILLPAGE + '<path d="M8.3 10.6h8.4v7.6H8.3zM8.3 14.4h8.4M12.5 10.6v7.6" stroke="#fff" stroke-width="1.4"/>',
        toslides: FILLPAGE + '<rect x="8.2" y="10.6" width="8.6" height="5.6" rx=".6" stroke="#fff" stroke-width="1.4"/><path d="M10.6 18.8h3.8" stroke="#fff" stroke-width="1.4"/>',
        toimages: FILLPAGE + '<circle cx="10.3" cy="11.4" r="1.2" stroke="#fff" stroke-width="1.3"/><path d="M7.8 18.2l3.2-3 2 1.7 1.8-1.5 2.4 2.3" stroke="#fff" stroke-width="1.4"/>',
        totext: FILLPAGE + '<path d="M9 11.2v-.8h7v.8M12.5 10.4v7.6M11.2 18h2.6" stroke="#fff" stroke-width="1.5"/>',
        sign: '<path d="M14.2 4.8l3.2 3.2-8.2 8.2-4 .8.8-4z"/><path class="acc" d="M3.5 20.5c2-1.6 3.4-2 4.3-1 .8.9 1.6 1.2 2.6.2s2-1.4 2.8-.4c.6.8 1.5.9 2.4.3"/>',
        newdoc: '<path d="M11 20.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5h6.5l5 5V11M13.5 3.5v5h5"/><path class="acc" d="M17.5 14v7M14 17.5h7"/>',
        open: '<path d="M3.5 18.5V5.6a1.1 1.1 0 0 1 1.1-1.1h4.3l2 2h7.4a1.1 1.1 0 0 1 1.1 1.1V9.5"/><path d="M3.5 18.5l2.3-7.7a1.2 1.2 0 0 1 1.1-.8H20a1 1 0 0 1 1 1.3l-2 6.6a1.2 1.2 0 0 1-1.1.8H4.5a1 1 0 0 1-1-1.2z"/>',
        save: '<path d="M5 3.5h11.4l4.1 4.1V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V5A1.5 1.5 0 0 1 5 3.5z"/><path d="M8 3.5V8h7.5V3.5M7 20.5v-6.2h10v6.2"/>',
        saveas: '<path d="M11 20.5H5A1.5 1.5 0 0 1 3.5 19V5A1.5 1.5 0 0 1 5 3.5h11.4l4.1 4.1V10"/><path d="M8 3.5V8h7.5V3.5M7 20.5v-6.2h4"/><path class="acc" d="M19.7 12.4a1.5 1.5 0 0 1 2.1 2.1l-5.2 5.2-2.8.7.7-2.8z"/>',
        download: '<path d="M12 3.5v11.5M7.5 10.5 12 15l4.5-4.5M4.5 19.5h15"/>',
        upload: '<path d="M12 15.5V4M7.5 8.5 12 4l4.5 4.5M4.5 19.5h15"/>',
        print: '<path d="M7 8.5v-5h10v5M7 17.5H5A1.5 1.5 0 0 1 3.5 16v-6A1.5 1.5 0 0 1 5 8.5h14a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5h-2"/><rect x="7" y="14" width="10" height="6.5" rx=".8"/>',
        exportf: '<path d="M14 3.5h6.5V10M20.5 3.5 11 13M17.5 14v4.5A1.5 1.5 0 0 1 16 20H5.5A1.5 1.5 0 0 1 4 18.5V8a1.5 1.5 0 0 1 1.5-1.5H10"/>',
        close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
        info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.9v.3"/>',
        undo: '<path d="M9 14.5 4.5 10 9 5.5M4.5 10h10a5 5 0 0 1 0 10H12"/>',
        redo: '<path d="M15 14.5l4.5-4.5L15 5.5M19.5 10h-10a5 5 0 0 0 0 10H12"/>',
        cut: '<circle cx="7" cy="18" r="2.5"/><circle cx="17" cy="18" r="2.5"/><path d="M8.6 16 18 3.5M15.4 16 6 3.5"/>',
        copy: '<rect x="8" y="8" width="12" height="12.5" rx="1.5"/><path d="M15.5 8V5A1.5 1.5 0 0 0 14 3.5H5.5A1.5 1.5 0 0 0 4 5v9a1.5 1.5 0 0 0 1.5 1.5H8"/>',
        paste: '<path d="M9 4.5H6.5A1.5 1.5 0 0 0 5 6v13a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V6a1.5 1.5 0 0 0-1.5-1.5H15"/><rect x="9" y="3" width="6" height="3.2" rx=".8"/>',
        trash: '<path d="M4.5 6.5h15M9.5 6.5v-2h5v2M6.5 6.5l1 13a1 1 0 0 0 1 .9h7a1 1 0 0 0 1-.9l1-13M10 10.5v6M14 10.5v6"/>',
        duplicate: '<rect x="8" y="7.5" width="11" height="13" rx="1.5"/><path d="M5.5 16.5H5V4.5A1 1 0 0 1 6 3.5h9.5V4"/><path class="acc" d="M13.5 11v6M10.5 14h6"/>',
        highlight: '<path d="M14.6 4.6l4.8 4.8-6.7 6.7H9.5v-3.2z"/><path d="M9.5 16.1l-3 3h4.2"/><path class="hl" d="M3.5 21h17" stroke-width="2.4"/>',
        underline: '<path d="M7 4v7a5 5 0 0 0 10 0V4"/><path class="acc" d="M5 20.5h14"/>',
        strike: '<path d="M16.5 7.3a4 4 0 0 0-4.3-2.8C9.6 4.5 8 5.9 8 7.7c0 1.5 1 2.4 2.6 3M16.4 14.6c.1.3.1.6.1 1 0 2.1-1.9 3.4-4.5 3.4a4.7 4.7 0 0 1-4.5-2.7"/><path class="acc" d="M4.5 12.5h15"/>',
        draw: '<path d="M3.5 18.5c2.7-5.5 5.2-8.2 6.7-8.2 2.3 0-1.2 6.6 1.3 6.6 1.6 0 3.4-2.7 4.4-5.1"/><path class="acc" d="M17.3 4.2l2.5 2.5-4.6 4.6-3.1.6.6-3.1z"/>',
        shapes: '<rect x="3.5" y="11" width="8.5" height="8.5" rx="1"/><circle cx="16.5" cy="7.5" r="4"/><path d="M15.5 13.5l4.5 6.5h-9z" stroke-opacity=".7"/>',
        rect: '<rect x="4" y="6" width="16" height="12" rx="1"/>',
        ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="6.2"/>',
        line: '<path d="M5 19 19 5"/>',
        arrow: '<path d="M5 19 19 5M11 5h8v8"/>',
        stamp: '<path d="M12 3.5a3 3 0 0 0-3 3c0 1.5 1 2.3 1 3.7v2.3h4v-2.3c0-1.4 1-2.2 1-3.7a3 3 0 0 0-3-3z"/><rect x="4.5" y="12.5" width="15" height="4" rx="1"/><path d="M6.5 20h11"/>',
        date: '<rect x="4" y="5.5" width="16" height="14.5" rx="1.5"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/><path class="acc" d="M8 13.5h2M11 13.5h2M14 13.5h2M8 16.5h2M11 16.5h2"/>',
        blankpage: '<path d="' + PAGE + '"/><path class="acc" d="M12 11.5v6M9 14.5h6"/>',
        insertpdf: '<path d="' + PAGE + '"/><path class="acc" d="M12 11v6.5M9.3 14.8l2.7 2.7 2.7-2.7"/>',
        images: '<rect x="6.5" y="6.5" width="14" height="12" rx="1.5"/><path d="M4 15.5V5a1.5 1.5 0 0 1 1.5-1.5H17"/><circle cx="11" cy="10.5" r="1.3"/><path d="M6.8 16.5 10.5 13l2.6 2.3 2.4-2 5 4.2"/>',
        zoomin: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.9-4.9M10.5 7.8v5.4M7.8 10.5h5.4"/>',
        zoomout: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.9-4.9M7.8 10.5h5.4"/>',
        fitwidth: '<path d="M3.5 12h17M6.8 8.7 3.5 12l3.3 3.3M17.2 8.7l3.3 3.3-3.3 3.3"/>',
        fitpage: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
        actual: '<path d="M5.5 9 7.5 7.5v9M16 9l2-1.5v9M12 10.5v.3M12 14v.3"/>',
        single: '<rect x="6.5" y="3" width="11" height="18" rx="1.2"/>',
        continuous: '<rect x="6.5" y="2.5" width="11" height="8.5" rx="1"/><rect x="6.5" y="13" width="11" height="8.5" rx="1"/>',
        twopage: '<rect x="3" y="5" width="8" height="14" rx="1"/><rect x="13" y="5" width="8" height="14" rx="1"/>',
        thumbs: '<rect x="4.5" y="3" width="15" height="18" rx="1.5"/><rect x="7.5" y="6" width="9" height="6" rx=".6"/><path d="M7.5 15h9M7.5 17.8h6"/>',
        bookmark: '<path d="M7 3.5h10a1 1 0 0 1 1 1v16l-6-4.2-6 4.2v-16a1 1 0 0 1 1-1z"/>',
        attach: '<path d="M19.5 11.6 12 19.1a5 5 0 0 1-7.1-7.1l8.3-8.3a3.3 3.3 0 0 1 4.7 4.7l-8.2 8.2a1.7 1.7 0 0 1-2.4-2.4l7.5-7.5"/>',
        objects: '<path d="M12 3.5 3.5 8 12 12.5 20.5 8z"/><path d="M3.5 12 12 16.5 20.5 12M3.5 16 12 20.5 20.5 16"/>',
        panel: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M14.5 4.5v15"/>',
        sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
        moon: '<path d="M19.5 14.6A8 8 0 0 1 9.4 4.5a8 8 0 1 0 10.1 10.1z"/>',
        search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.9-4.9"/>',
        keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="1.5"/><path d="M6 9.5h.5M9.5 9.5h.5M13 9.5h.5M16.5 9.5h1M6 12.5h.5M9.5 12.5h.5M13 12.5h.5M16.5 12.5h1M8 15.5h8"/>',
        help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.7 9.6a2.4 2.4 0 0 1 4.7.6c0 1.6-2.4 2-2.4 3.6M12 16.6v.3"/>',
        chevdown: '<path d="M6 9l6 6 6-6"/>',
        chevup: '<path d="M6 15l6-6 6 6"/>',
        chevright: '<path d="M9 6l6 6-6 6"/>',
        chevleft: '<path d="M15 6l-6 6 6 6"/>',
        first: '<path d="M6.5 6v12M17 6l-6 6 6 6"/>',
        last: '<path d="M17.5 6v12M7 6l6 6-6 6"/>',
        minus: '<path d="M5 12h14"/>',
        plus: '<path d="M12 5v14M5 12h14"/>',
        check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
        moveup: '<path d="M12 19.5v-15M6.5 10 12 4.5l5.5 5.5"/>',
        movedown: '<path d="M12 4.5v15M6.5 14l5.5 5.5 5.5-5.5"/>',
        reverse: '<path d="M7.5 4v16M4.5 7l3-3 3 3M16.5 20V4M13.5 17l3 3 3-3"/>',
        whiteout: '<path d="M8.5 20.5h11"/><path d="M4.6 14.4l8.9-8.9a1.5 1.5 0 0 1 2.1 0l3.7 3.7a1.5 1.5 0 0 1 0 2.1l-8.4 8.4a1.5 1.5 0 0 1-1 .4H8.6a1.5 1.5 0 0 1-1-.4l-3-3a1.5 1.5 0 0 1 0-2.3zM9.4 9.6l5 5"/>',
        bold: '<path d="M7.5 4.5h5.5a3.5 3.5 0 0 1 0 7H7.5zM7.5 11.5h6.5a4 4 0 0 1 0 8H7.5z" stroke-width="2"/>',
        italic: '<path d="M10 4.5h8M6 19.5h8M14.5 4.5l-5 15"/>',
        underl: '<path d="M7 4v7a5 5 0 0 0 10 0V4M5 20.5h14"/>',
        alignleft: '<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>',
        aligncenter: '<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>',
        alignright: '<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>',
        front: '<rect x="3.5" y="3.5" width="11" height="11" rx="1" stroke-opacity=".55"/><rect class="accf" x="9.5" y="9.5" width="11" height="11" rx="1"/>',
        back: '<rect class="accf" x="3.5" y="3.5" width="11" height="11" rx="1"/><rect x="9.5" y="9.5" width="11" height="11" rx="1" fill="var(--card)"/>',
        fileicon: '<path d="M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5zM13.5 3v5.5H19"/>',
        pdf: '<path d="M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5zM13.5 3v5.5H19"/><path class="acc" d="M8.5 13.5h7M8.5 16.5h5"/>',
        folder: '<path d="M3.5 6.6A1.1 1.1 0 0 1 4.6 5.5h4.3l2 2h8.5a1.1 1.1 0 0 1 1.1 1.1v9.8a1.1 1.1 0 0 1-1.1 1.1H4.6a1.1 1.1 0 0 1-1.1-1.1z"/>',
        device: '<rect x="4" y="5" width="16" height="11" rx="1.2"/><path d="M2.5 19.5h19"/>',
        clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
        grip: '<circle class="fill" cx="9" cy="7" r="1.2"/><circle class="fill" cx="15" cy="7" r="1.2"/><circle class="fill" cx="9" cy="12" r="1.2"/><circle class="fill" cx="15" cy="12" r="1.2"/><circle class="fill" cx="9" cy="17" r="1.2"/><circle class="fill" cx="15" cy="17" r="1.2"/>',
        ribbonup: '<path d="M6 14.5l6-6 6 6"/>',
        ribbondown: '<path d="M6 9.5l6 6 6-6"/>',
        lock: '<rect x="5" y="10.5" width="14" height="10" rx="1.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
        warning: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17v.3"/>',
        pin: '<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>'
    };

    var injected = false;

    PE.injectIcons = function () {
        if (injected) {
            return;
        }
        injected = true;
        var parts = ['<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true"><defs><style>' +
            '.fill{fill:currentColor;stroke:none}.acc{stroke:var(--accent)}.accf{fill:var(--accent);stroke:none}' +
            '.dk{fill:var(--text);stroke:none}.hl{stroke:#e8b800}</style></defs>'];
        Object.keys(I).forEach(function (k) {
            parts.push('<symbol id="pe-i-' + k + '" viewBox="0 0 24 24">' + I[k] + '</symbol>');
        });
        parts.push('</svg>');
        var holder = document.createElement('div');
        holder.innerHTML = parts.join('');
        document.body.insertBefore(holder.firstChild, document.body.firstChild);
    };

    PE.icon = function (name, cls) {
        return '<svg class="ic' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#pe-i-' + name + '"/></svg>';
    };

    PE.hasIcon = function (name) {
        return Object.prototype.hasOwnProperty.call(I, name);
    };
})(window.PE);
