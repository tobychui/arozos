/*
    ArozOS Office - ribbon icons (common/icons.js)
    ==============================================
    The glyphs the ribbon needs that Semantic UI's icon font does not have
    (grow / shrink font, borders, the format painter, vertical alignment,
    the slide sorter ...), drawn on a 24 x 24 grid. Strokes take the text
    colour; ".acc" parts are filled and ".accs" parts stroked with the
    app's accent, so the same icon fits Docs, Sheets and Slides and both
    themes (office.css, .of-ic).

        OfficeIcons.get("growFont")   // -> '<svg class="of-ic" ...>...</svg>'
        OfficeIcons.has("growFont")

    Every icon is drawn here, never an emoji (repo rule 6).
*/
var OfficeIcons = (function () {
    "use strict";

    var T = function (x, y, size, txt, extra) {
        return '<text x="' + x + '" y="' + y + '" font-size="' + size + '"' + (extra || "") + ">" + txt + "</text>";
    };
    var PAGE = '<path d="M6 2.5h8.5L19 7v14.5H6z"/><path d="M14.5 2.5V7H19"/>';

    var ICONS = {
        /* ---- text ---- */
        growFont: '<path d="M2.5 20 8 5l5.5 15M4.6 14.5h6.8"/><path class="acc" d="M15.5 10.5 19 5.5l3.5 5z"/>',
        shrinkFont: '<path d="M2.5 20 8 5l5.5 15M4.6 14.5h6.8"/><path class="acc" d="M15.5 6 19 11l3.5-5z"/>',
        changeCase: T(1, 18, 15, "Aa", ' font-weight="600"'),
        fontColor: '<path d="M6 16.5 12 3l6 13.5M8.4 11.3h7.2"/>',
        highlighter: '<path d="M14.5 3.5 20.5 9.5 12 18H7.5v-4.5z"/><path d="M11.5 6.5l6 6"/><path d="M7.5 18 5 20.5"/>',
        fill: '<path d="M4.5 11.5 11 5l7 7-6.5 6.5z"/><path d="M4.5 11.5h13.5"/><path d="M8 3.5 11 5"/><path class="fillc" d="M20 13.5s-2 2.4-2 3.6a2 2 0 0 0 4 0c0-1.2-2-3.6-2-3.6z"/>',
        clearFormat: '<path d="M4 20 9.5 5l5.5 15M6 14.5h7"/><path class="accs" d="M16 14l5 5M21 14l-5 5"/>',
        subscript: T(1.5, 15, 14, "X", ' font-weight="600"') + T(13.5, 21, 9, "2", ' class="acct"'),
        superscript: T(1.5, 20, 14, "X", ' font-weight="600"') + T(13.5, 10, 9, "2", ' class="acct"'),
        formatPainter: '<rect x="4" y="3" width="13" height="6" rx="1"/><path d="M17 6h2.5v5.5H11.5V14"/><rect class="fillc" x="10" y="14" width="3" height="7" rx="1"/>',
        borderBottom: '<path d="M4 4h16v16H4zM4 12h16M12 4v16" stroke-dasharray="1.2 2.4"/><path d="M3.5 20h17" stroke-width="2.4"/>',
        borderTop: '<path d="M4 4h16v16H4zM4 12h16M12 4v16" stroke-dasharray="1.2 2.4"/><path d="M3.5 4h17" stroke-width="2.4"/>',
        borderAll: '<path d="M4 4h16v16H4zM4 12h16M12 4v16" stroke-width="1.8"/>',
        borderOutside: '<path d="M4 12h16M12 4v16" stroke-dasharray="1.2 2.4"/><path d="M4 4h16v16H4z" stroke-width="2"/>',
        borderNone: '<path d="M4 4h16v16H4zM4 12h16M12 4v16" stroke-dasharray="1.2 2.4"/>',
        sortAZ: T(2, 10, 9, "A", ' font-weight="700"') + T(2, 21, 9, "Z", ' font-weight="700"') + '<path d="M17 4v15M13.5 15.5 17 19l3.5-3.5"/>',
        lineSpacing: '<path d="M10 6h11M10 12h11M10 18h11"/><path d="M5 3v18M2.5 5.5 5 3l2.5 2.5M2.5 18.5 5 21l2.5-2.5"/>',

        /* ---- paragraph / page ---- */
        pageBreak: '<path d="M5 2.5h14v7H5z"/><path d="M2.5 12h19" stroke-dasharray="2 2"/><path d="M5 14.5h14v7H5z"/>',
        margins: PAGE + '<path class="accs" d="M9 6.5h5M9 9.5h7M9 12.5h7M9 15.5h7M9 18.5h5" />',
        orientation: '<path d="M4 2.5h9v13H4z"/><path class="accs" d="M9 11.5h12v10H9z"/>',
        pageSize: PAGE + '<path class="accs" d="M9 17l6-6M15 14.5V11h-3.5"/>',
        columns: '<path d="M3 4h18v16H3z"/><path d="M12 4v16M5.5 8h4M5.5 11h4M5.5 14h4M14.5 8h4M14.5 11h4M14.5 14h4"/>',
        headerFooter: PAGE + '<path class="acc" d="M7.5 4h6v2.5h-6zM7.5 17.5h10V20h-10z"/>',
        pageNumbers: PAGE + T(10.5, 19.5, 7.5, "#", ' class="acct" font-weight="700"'),
        pageSetup: PAGE + '<path d="M9 10h7M9 13h7M9 16h4"/>',
        footnote: '<path d="M3 6h13M3 10h18M3 14h9"/>' + T(13, 15.5, 8, "1", ' class="acct" font-weight="700"') + '<path d="M3 19h7"/>',
        toc: '<path d="M3 5h11M3 10h9M6 15h8M6 20h8"/><path d="M15.5 5h1M15.5 10h1M15.5 15h1M15.5 20h1" stroke-dasharray="0.5 2"/>' +
            T(18, 7, 6, "1", ' font-weight="700"') + T(18, 12, 6, "2", ' font-weight="700"') + T(18, 17, 6, "3", ' font-weight="700"') + T(18, 22, 6, "4", ' font-weight="700"'),
        tocUpdate: '<path d="M3 5h11M3 10h9M3 15h7"/><path class="accs" d="M20.5 15a5 5 0 1 1-1.6-3.7M19.5 9v3h-3"/>',
        symbol: T(4, 19, 17, "&#937;"),
        hrule: '<path d="M3 12h18" stroke-width="2"/><path d="M6 7h12M6 17h8" opacity=".45"/>',
        drawing: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path class="accs" d="M6.5 15.5c2-4 3.5-6 5-3s3 1.5 5.5-3"/>',
        pen: '<path d="M4 20l1.4-5.2L16 4.2l3.8 3.8L9.2 18.6z"/><path d="M13.5 6.7l3.8 3.8"/>',
        markerPen: '<path d="M15 3l6 6-8.5 8.5-6-6z"/><path d="M6.5 11.5 4 18l2 2 6.5-2.5"/>',
        lasso: '<ellipse cx="12" cy="9" rx="8" ry="5" stroke-dasharray="2 2"/><path d="M8 13.5c-1 2 0 4 2 4s1.5 3-1 3"/>',

        /* ---- review / view ---- */
        wordCount: T(1.5, 11, 8.5, "ABC", ' font-weight="700"') + T(5.5, 21, 8.5, "123", ' font-weight="700" class="acct"'),
        spelling: T(1.5, 12, 9, "ABC", ' font-weight="700"') + '<path class="accs" d="M5 17l3.5 3.5L19 13"/>',
        newComment: '<path d="M3.5 4.5h17v11h-9l-5 4v-4h-3z"/><path class="accs" d="M12 7v6M9 10h6"/>',
        comments: '<path d="M3.5 4.5h12v8h-6l-3.5 3v-3H3.5z"/><path d="M18 8.5h2.5v8H18v3l-3.5-3H10"/>',
        trackChanges: PAGE + '<path class="accs" d="M9 19l1-3.5 6-6 2.5 2.5-6 6z"/>',
        accept: '<circle cx="12" cy="12" r="8.5"/><path class="accs" d="M8 12.2l2.8 2.8L16.5 9"/>',
        reject: '<circle cx="12" cy="12" r="8.5"/><path d="M9 9l6 6M15 9l-6 6"/>',
        marks: T(5, 19, 17, "&#182;", ' font-weight="700"'),
        layoutBoxes: '<path d="M3.5 3.5h17v7h-17zM3.5 13.5h7v7h-7zM13.5 13.5h7v7h-7z" stroke-dasharray="2 1.6"/>',
        zoomIn: '<circle cx="10" cy="10" r="6.5"/><path d="M15 15l5.5 5.5M7 10h6M10 7v6"/>',
        zoomOut: '<circle cx="10" cy="10" r="6.5"/><path d="M15 15l5.5 5.5M7 10h6"/>',
        zoom100: '<circle cx="10" cy="10" r="6.5"/><path d="M15 15l5.5 5.5"/>' + T(6, 12.5, 6.5, "1:1", ' font-weight="700"'),
        pageWidth: PAGE + '<path class="accs" d="M2.5 13h20M5 10.5 2.5 13 5 15.5M20 10.5l2.5 2.5-2.5 2.5"/>',
        darkTheme: '<path d="M19.5 14.5A8 8 0 1 1 10 4.5a6.5 6.5 0 0 0 9.5 10z"/>',
        gridlines: '<path d="M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18"/>',
        formulaBar: '<rect x="2.5" y="7" width="19" height="10" rx="1.5"/>' + T(5, 15.5, 8.5, "fx", ' font-style="italic" font-weight="700" class="acct"'),
        showFormulas: '<rect x="3" y="3" width="18" height="18" rx="1.5"/>' + T(5.5, 16, 10, "fx", ' font-style="italic" font-weight="700" class="acct"'),
        freeze: '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 13h18M13 3v18" opacity=".45"/><path class="accs" d="M3 8h18M8 3v18" stroke-width="2.4"/>',
        headings: '<rect x="3" y="3" width="18" height="18" rx="1"/><path class="acc" d="M3.8 3.8h16.4v3.4H3.8zM3.8 3.8h3.4v16.4H3.8z"/>',

        /* ---- cells ---- */
        alignTop: '<path d="M4 4h16" stroke-width="2"/><path d="M12 19V8.5M8.5 12 12 8.5l3.5 3.5"/>',
        alignMiddle: '<path d="M4 12h16" stroke-width="2"/><path d="M12 3v5M9.5 5.8 12 8.3l2.5-2.5M12 21v-5M9.5 18.2l2.5-2.5 2.5 2.5"/>',
        alignBottom: '<path d="M4 20h16" stroke-width="2"/><path d="M12 5v10.5M8.5 12 12 15.5l3.5-3.5"/>',
        wrapText: '<path d="M4 6h16M4 12h13a3 3 0 0 1 0 6h-4.5M15 15.8 12.5 18l2.5 2.2M4 18h5"/>',
        merge: '<rect x="2.5" y="5" width="19" height="14" rx="1"/><path class="accs" d="M3 12h5.5M6.5 9.5 9 12l-2.5 2.5M21 12h-5.5M17.5 9.5 15 12l2.5 2.5"/>',
        condFormat: '<rect x="3" y="3" width="18" height="18" rx="1.5"/><path d="M3 9h18M3 15h18M9 3v18"/><path class="acc" d="M9.8 9.8h10.4v4.4H9.8z"/>',
        formatTable: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path class="acc" d="M3.8 4.8h16.4v3.8H3.8z"/><path d="M3 12h18M3 16h18M9 8.6V20"/>',
        cellStyles: '<rect x="2.5" y="4" width="8.5" height="6" rx="1"/><rect class="acc" x="13" y="4" width="8.5" height="6" rx="1"/><rect x="2.5" y="14" width="8.5" height="6" rx="1" stroke-dasharray="1.5 1.5"/><rect x="13" y="14" width="8.5" height="6" rx="1"/>',
        autosum: '<path d="M18 4H6.5l6.5 8-6.5 8H18"/>',
        fx: T(3, 17.5, 15, "fx", ' font-style="italic" font-weight="700" font-family="Georgia, serif"'),
        insertCells: '<path d="M3 3h18v18H3zM3 12h18M12 3v18" opacity=".5"/><path class="accs" d="M17 14v8M13 18h8" stroke-width="2"/>',
        deleteCells: '<path d="M3 3h18v18H3zM3 12h18M12 3v18" opacity=".5"/><path d="M14 15l6 6M20 15l-6 6" stroke-width="2"/>',
        clearAll: '<path d="M4 20 9.5 5l5.5 15M6 14.5h7"/><path d="M15.5 17.5l4-4 2.5 2.5-4 4h-2.5z"/>',
        pivot: '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 8h18M8 3v18"/><path class="accs" d="M11.5 12.5h6.5v6M15.5 16 18 18.5l2.5-2.5"/>',
        recalc: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19 3.5v4h-4"/>',

        /* ---- slides ---- */
        newSlide: '<rect x="2" y="5" width="15" height="11" rx="1"/><path d="M4.5 8.5h7M4.5 11h10" opacity=".5"/><path class="accs" d="M19.5 13v8M15.5 17h8" stroke-width="2"/>',
        slideLayout: '<rect x="2.5" y="4.5" width="19" height="15" rx="1"/><path class="acc" d="M4.5 6.5h15v3h-15z"/><path d="M4.5 12h7v5.5h-7zM13.5 12h6M13.5 15h6"/>',
        textBox: '<rect x="3" y="5" width="18" height="14" rx="1" stroke-dasharray="2 1.8"/><path d="M8 9h8M12 9v6.5"/>',
        shapes: '<rect x="3" y="10.5" width="9.5" height="9.5" rx="1"/><circle class="accs" cx="16" cy="8" r="5"/>',
        arrange: '<rect x="3" y="3" width="11" height="11" rx="1"/><rect class="acc" x="10" y="10" width="11" height="11" rx="1"/>',
        alignObjects: '<path d="M4 3v18"/><rect x="7" y="5" width="13" height="5" rx="1"/><rect class="accs" x="7" y="14" width="8" height="5" rx="1"/>',
        formatPane: '<rect x="3" y="3" width="18" height="18" rx="1.5"/><rect class="accs" x="7.5" y="7.5" width="9" height="9" rx="1"/>',
        findReplace: '<circle cx="9.5" cy="9.5" r="6"/><path d="M14 14l6.5 6.5"/><path class="accs" d="M7 9.5h5M10 7.5l2 2-2 2"/>',
        theme: '<rect x="2.5" y="4.5" width="19" height="15" rx="1"/><path class="acc" d="M3.2 5.2h17.6v4H3.2z"/>' + T(6, 17.5, 7.5, "Aa", ' font-weight="700"'),
        background: '<rect x="2.5" y="4.5" width="19" height="15" rx="1"/><path class="acc" d="M3.2 12 9 7.5l5 4.5 3-2.2 3.8 3.2v6.2H3.2z" opacity=".75"/>',
        transition: '<rect x="2" y="3" width="13" height="10" rx="1"/><rect class="accs" x="9" y="11" width="13" height="10" rx="1"/><path d="M5.5 17h3M7 15.5 8.5 17 7 18.5"/>',
        animation: '<path class="acc" d="M15 3.5l1.6 3.6 3.9.4-2.9 2.6.8 3.9-3.4-2-3.4 2 .8-3.9-2.9-2.6 3.9-.4z"/><path d="M3 13h7M5 17h7M3 21h9"/>',
        present: '<rect x="2.5" y="3.5" width="19" height="13" rx="1"/><path d="M12 16.5v4M8 21h8"/><path class="acc" d="M10 7v6l5-3z"/>',
        fromStart: '<rect x="2.5" y="3.5" width="19" height="13" rx="1"/><path d="M12 16.5v4M8 21h8M8.5 7v6"/><path class="acc" d="M11 7v6l5-3z"/>',
        presenter: '<rect x="2.5" y="3.5" width="12" height="9" rx="1"/><rect class="accs" x="11" y="11" width="10.5" height="8" rx="1"/><path d="M5 16h4M5 19h4"/>',
        overview: '<rect x="2.5" y="4" width="8.5" height="6.5" rx="1"/><rect x="13" y="4" width="8.5" height="6.5" rx="1"/><rect x="2.5" y="13.5" width="8.5" height="6.5" rx="1"/><rect class="accs" x="13" y="13.5" width="8.5" height="6.5" rx="1"/>',
        normalView: '<rect x="2.5" y="4" width="5" height="16" rx="1"/><rect class="accs" x="9.5" y="4" width="12" height="10" rx="1"/><path d="M9.5 17h12M9.5 20h8"/>',
        notes: '<rect x="3" y="3" width="18" height="11" rx="1"/><path class="accs" d="M3 17.5h18M3 21h12"/>',
        snap: '<path d="M3 3h18v18H3zM9 3v18M15 3v18M3 9h18M3 15h18" opacity=".45"/><path class="accs" d="M6 18l3-3 3 3"/>',
        group: '<path d="M3 3h18v18H3z" stroke-dasharray="2 1.8"/><rect x="6" y="6" width="7" height="6" rx="1"/><rect class="accs" x="11" y="11" width="7" height="7" rx="1"/>',
        bringFront: '<rect x="3" y="3" width="11" height="11" rx="1" opacity=".5"/><rect class="acc" x="8" y="8" width="11" height="11" rx="1"/>',
        sendBack: '<rect class="acc" x="3" y="3" width="11" height="11" rx="1" opacity=".55"/><rect x="8" y="8" width="11" height="11" rx="1"/>',
        crop: '<path d="M6 2.5V18h15.5M2.5 6H18v15.5"/>',
        resetPicture: '<rect x="3" y="5" width="18" height="14" rx="1"/><path class="accs" d="M15.5 12.5a3.5 3.5 0 1 1-1-2.5M15 8v2.5h-2.5"/>',
        outline: '<path d="M4 20l1.4-5.2L16 4.2l3.8 3.8L9.2 18.6z"/>',
        lineWeight: '<path d="M3 5h18" stroke-width="1"/><path d="M3 11h18" stroke-width="2.2"/><path d="M3 18h18" stroke-width="3.6"/>',
        lineDash: '<path d="M3 7h4M10 7h4M17 7h4M3 13h2M8 13h2M13 13h2M18 13h2M3 19h9M15 19h6"/>',
        video: '<rect x="2.5" y="5" width="14" height="14" rx="1.5"/><path class="acc" d="M17.5 10l4-2.5v9l-4-2.5z"/>',
        audio: '<path d="M9 17V5l11-2v12"/><circle cx="6.5" cy="17" r="2.5"/><circle class="accs" cx="17.5" cy="15" r="2.5"/>',
        link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
        picture: '<rect x="2.5" y="4" width="19" height="16" rx="1.5"/><circle cx="8" cy="9.5" r="1.8"/><path class="accs" d="M3.5 17.5l5-5 4 4 3-3 5 4.5"/>',
        table: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9.5h18M3 15h18M9 4v16M15 4v16"/>',
        chart: '<path d="M3.5 20.5h17"/><path d="M6 17V11h3v6zM10.5 17V6h3v11z"/><path class="acc" d="M15 17V9h3v8z"/>',
        comment: '<path d="M3.5 4.5h17v11h-9l-5 4v-4h-3z"/>',
        paste: '<rect x="5" y="4" width="14" height="17" rx="1.5"/><rect class="acc" x="8.5" y="2.5" width="7" height="4" rx="1"/><path d="M8.5 11h7M8.5 14.5h7M8.5 18h4"/>',
        note: '<path d="M4 4h16v11l-5 5H4z"/><path d="M15 20v-5h5"/><path class="accs" d="M7.5 8.5h9M7.5 12h6"/>',
        sheet: '<path d="M3 4h18v16H3zM3 9h18M9 4v16"/><path class="accs" d="M17 13v6M14 16h6" stroke-width="2"/>'
    };

    function get(name, extraClass) {
        var body = ICONS[name];
        if (!body) return "";
        return '<svg class="of-ic' + (extraClass ? " " + extraClass : "") + '" viewBox="0 0 24 24" aria-hidden="true">' + body + "</svg>";
    }
    function has(name) { return Object.prototype.hasOwnProperty.call(ICONS, name); }

    return { get: get, has: has };
})();
