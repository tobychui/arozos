/*
    fsicons.js

    Inline SVG icon set for the ArozOS file system web apps.

    Drawn locally rather than pulled from an icon font so the toolbar glyphs
    match the file icons in shared/filethumb.js and stay crisp at any size.
    No emoji anywhere - see CLAUDE.md rule 6.

    Usage:
        element.innerHTML = FSIcons.back;
        FSIcons.inject(document);        // fills every [data-fsicon] element

    Icons are 24x24 stroke outlines that take their colour from the element's
    CSS `color`, so they theme automatically.
*/

(function (global) {
    "use strict";

    var S = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';

    var ICONS = {
        back:       S + '<path d="M19 12H5M12 19l-7-7 7-7"/></svg>',
        forward:    S + '<path d="M5 12h14M12 5l7 7-7 7"/></svg>',
        up:         S + '<path d="M12 19V5M5 12l7-7 7 7"/></svg>',
        refresh:    S + '<path d="M21 12a9 9 0 1 1-3.2-6.9"/><path d="M21 4v5h-5"/></svg>',
        menu:       S + '<path d="M4 6h16M4 12h16M4 18h16"/></svg>',
        //Descending bars with a direction arrow - the sort control
        sort:       S + '<path d="M4 6h11M4 12h7M4 18h4"/><path d="M18 8v12M14.5 16.5L18 20l3.5-3.5"/></svg>',
        search:     S + '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/></svg>',
        close:      S + '<path d="M18 6L6 18M6 6l12 12"/></svg>',
        more:       S + '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg>',
        check:      S + '<path d="M20 6L9 17l-5-5"/></svg>',
        home:       S + '<path d="M3 10.5L12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5"/></svg>',

        /* View modes */
        viewGrid:   S + '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
        viewList:   S + '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg>',
        viewDetails: S + '<path d="M3 5h18M3 12h18M3 19h18"/><path d="M9 5v14"/></svg>',
        sidePanel:  S + '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></svg>',

        /* File operations */
        open:       S + '<path d="M5 12h14M13 6l6 6-6 6"/></svg>',
        openWith:   S + '<path d="M15 3h6v6"/><path d="M10.5 13.5L21 3"/><path d="M18 13.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5.5"/></svg>',
        copy:       S + '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>',
        cut:        S + '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.5 15.5M14.5 14.5L20 20M8.5 8.5L12 12"/></svg>',
        paste:      S + '<path d="M9 3h6v3H9z"/><path d="M15 4.5h2.5A1.5 1.5 0 0 1 19 6v13.5A1.5 1.5 0 0 1 17.5 21h-11A1.5 1.5 0 0 1 5 19.5V6a1.5 1.5 0 0 1 1.5-1.5H9"/></svg>',
        rename:     S + '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
        trash:      S + '<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13h10l1-13"/></svg>',
        upload:     S + '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 20h16"/></svg>',
        download:   S + '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/></svg>',
        newFolder:  S + '<path d="M3 7a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 12v5M9.5 14.5h5"/></svg>',
        newFile:    S + '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 12v5M9.5 14.5h5"/></svg>',
        zip:        S + '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M10.5 6h1M11.5 8.5h1M10.5 11h1M11.5 13.5h1"/></svg>',
        unzip:      S + '<path d="M21 8v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8"/><path d="M2 4h20v4H2z"/><path d="M12 12v5M9.5 14.5L12 17l2.5-2.5"/></svg>',
        share:      S + '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>',
        info:       S + '<circle cx="12" cy="12" r="9"/><path d="M12 16v-5M12 8h.01"/></svg>',
        selectAll:  S + '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 12l3 3 5-6"/></svg>',
        clearSel:   S + '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9l6 6M15 9l-6 6"/></svg>',
        moon:       S + '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>',

        /* Sidebar roots */
        clock:      S + '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/></svg>',
        document:   S + '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
        globe:      S + '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3z"/></svg>',
        cube:       S + '<path d="M12 2.8l8 4.4v9.6l-8 4.4-8-4.4V7.2z"/><path d="M4 7.2l8 4.4 8-4.4M12 21.2v-9.6"/></svg>',
        code:       S + '<path d="M9 18l-6-6 6-6M15 6l6 6-6 6"/></svg>',
        drive:      S + '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M6.5 15h6"/><circle cx="17.5" cy="15" r="1"/></svg>',
        folder:     S + '<path d="M3 7a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',

        /* Filled sidebar glyphs, matching the coloured tiles in the design */
        desktop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="2.5" y="4" width="19" height="13" rx="2.5"/><path d="M8 20.5h8a1 1 0 0 0 0-2H8a1 1 0 0 0 0 2z"/></svg>',
        image:   '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="2.5" y="4" width="19" height="16" rx="3"/><circle cx="8.6" cy="9.4" r="1.8" fill="#ffffff"/><path d="M4.2 18.6l4.6-5.1 3.1 3.3 3-3.4 4.9 5.2z" fill="#ffffff"/></svg>',
        video:   '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="2.5" y="4" width="19" height="16" rx="3"/><path d="M6.4 4v16M17.6 4v16" stroke="#ffffff" stroke-width="1.4"/><path d="M2.5 12h19" stroke="#ffffff" stroke-width="1.4"/></svg>',
        music:   '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 3.4v11.2a3.4 3.4 0 1 1-2-3.1V7.3l-7 1.5v8.8a3.4 3.4 0 1 1-2-3.1V6.4z"/></svg>',
        download_filled: S + '<path d="M12 3v12M7 11l5 5 5-5"/><path d="M4 20h16"/></svg>',

        /* Transfer panel */
        minus:       S + '<path d="M5 12h14"/></svg>',
        chevronDown: S + '<path d="M6 9.5l6 6 6-6"/></svg>',
        chevronUp:   S + '<path d="M6 14.5l6-6 6 6"/></svg>',
        cloudUpload: S + '<path d="M6.5 19a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 17.7 9.2 3.9 3.9 0 0 1 17.5 19z"/><path d="M12 18v-7M9.2 13.3L12 10.5l2.8 2.8"/></svg>',
        pause:       S + '<path d="M9.5 5.5v13M14.5 5.5v13"/></svg>',
        play:        S + '<path d="M8 5.4l10 6.6-10 6.6z"/></svg>',
        pauseCircle: S + '<circle cx="12" cy="12" r="9"/><path d="M10.1 9.2v5.6M13.9 9.2v5.6"/></svg>',
        playCircle:  S + '<circle cx="12" cy="12" r="9"/><path d="M10.2 8.6l5.2 3.4-5.2 3.4z"/></svg>',
        checkCircle: S + '<circle cx="12" cy="12" r="9"/><path d="M8 12.3l2.7 2.7L16 9.7"/></svg>',
        closeCircle: S + '<circle cx="12" cy="12" r="9"/><path d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6"/></svg>',

        /* Trash bin view */
        restore:     S + '<path d="M3 12a9 9 0 1 0 3.2-6.9"/><path d="M3 4v5h5"/></svg>',
        trashBig:    S + '<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/></svg>'
    };

    //Fill every element carrying data-fsicon="<name>" with its glyph
    ICONS.inject = function (scope) {
        var root = scope || document;
        var nodes = root.querySelectorAll('[data-fsicon]');
        for (var i = 0; i < nodes.length; i++) {
            var name = nodes[i].getAttribute('data-fsicon');
            if (ICONS[name] != undefined && typeof ICONS[name] === 'string') {
                nodes[i].innerHTML = ICONS[name];
            }
        }
    };

    global.FSIcons = ICONS;
})(window);
