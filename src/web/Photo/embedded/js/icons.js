/*
    Photo viewer icons, drawn as inline SVG on a 24 x 24 grid.
    Stroke icons use currentColor so CSS sets their colour.
*/
(function (root) {
    "use strict";

    function svg(body, fill) {
        return '<svg viewBox="0 0 24 24" width="24" height="24" fill="' + (fill ? "currentColor" : "none") +
            '" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
    }

    var I = {
        //tabs
        tabAdjust: svg('<circle cx="12" cy="12" r="9"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><circle cx="12" cy="12" r="3.2"/>'),
        tabFilters: svg('<circle cx="9" cy="9" r="5.2"/><circle cx="15" cy="9" r="5.2"/><circle cx="12" cy="14.6" r="5.2"/>'),
        tabCrop: svg('<path d="M6 2.5v15.5h15.5"/><path d="M2.5 6H18v15.5"/><path d="M14 10l3-3"/>'),

        //crop tools
        flip: svg('<path d="M12 3v18" stroke-dasharray="2 2.4"/><path d="M9 6L3.5 18H9z"/><path d="M15 6l5.5 12H15z" fill="currentColor"/>'),
        rotate: svg('<rect x="4" y="9" width="11" height="11" rx="1.5"/><path d="M9 4.5h4.5a5 5 0 0 1 5 5V12"/><path d="M11 2.5L9 4.5l2 2"/>'),
        aspect: svg('<rect x="3" y="6" width="13" height="13" rx="1.5"/><path d="M7 2.5h12.5a1.5 1.5 0 0 1 1.5 1.5V15"/>'),
        straighten: svg('<circle cx="12" cy="12" r="8.5"/><path d="M4 15.5L20 8.5"/>'),
        vertical: svg('<path d="M7 4h10l3 16H4z"/><path d="M12 7v10"/>'),
        horizontal: svg('<path d="M4 7v10l16 3V4z"/><path d="M7 12h10"/>'),

        //adjustments
        auto: svg('<path d="M4 20L15 9"/><path d="M14 10l1.8-1.8 1 1L15 11"/><path d="M18 3v3M16.5 4.5h3M20 9.5v2M19 10.5h2M10 3.5v2M9 4.5h2"/>'),
        exposure: svg('<circle cx="12" cy="12" r="8.5"/><path d="M6 18L18 6"/><path d="M8 8.5h3M9.5 7v3M13.5 15.5h3"/>'),
        brilliance: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17a4.25 4.25 0 0 1 0-8.5a4.25 4.25 0 0 0 0-8.5z" fill="currentColor"/>'),
        highlights: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17M12 6h6.2M12 9h8.2M12 12h8.5M12 15h8.2M12 18h6.2"/>'),
        shadows: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 0 0 17z" fill="currentColor"/>'),
        contrast: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/>'),
        brightness: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>'),
        black: svg('<circle cx="12" cy="12" r="8.5" fill="currentColor"/>'),
        saturation: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 7.4 12.7L12 12z" fill="currentColor"/>'),
        vibrance: svg('<path d="M12 3l9 16H3z"/><path d="M12 9l4.5 8h-9z" fill="currentColor"/>'),
        warmth: svg('<path d="M10 14.5V5a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0z"/><path d="M12 9v7"/>'),
        tint: svg('<path d="M12 3s6.5 7 6.5 11a6.5 6.5 0 0 1-13 0C5.5 10 12 3 12 3z"/><path d="M12 9v11" />'),
        sharpness: svg('<path d="M12 3.5l8.5 15H3.5z" fill="currentColor"/>'),
        definition: svg('<path d="M12 3.5l8.5 15H3.5z"/><path d="M12 10l3.8 6.8H8.2z" fill="currentColor"/>'),
        noise: svg('<circle cx="12" cy="12" r="8.5"/><circle cx="9" cy="9" r=".9" fill="currentColor"/><circle cx="15" cy="9" r=".9" fill="currentColor"/><circle cx="12" cy="12" r=".9" fill="currentColor"/><circle cx="9" cy="15" r=".9" fill="currentColor"/><circle cx="15" cy="15" r=".9" fill="currentColor"/>'),
        vignette: svg('<circle cx="12" cy="12" r="8.5" fill="currentColor" opacity=".35"/><circle cx="12" cy="12" r="5" fill="#000" stroke="none"/><circle cx="12" cy="12" r="8.5"/>'),

        //viewer
        download: svg('<path d="M12 3.5v11"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M4.5 15.5v2.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2.5"/>'),
        share: svg('<path d="M12 3v12"/><path d="M8 6.5L12 2.5l4 4"/><path d="M8 10H6.5A1.5 1.5 0 0 0 5 11.5v8A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 17.5 10H16"/>'),
        info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.6" r=".9" fill="currentColor"/>'),
        edit: svg('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>'),
        chevronLeft: svg('<path d="M15 4l-8 8 8 8"/>'),
        chevronRight: svg('<path d="M9 4l8 8-8 8"/>'),
        close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
        undo: svg('<path d="M9 5L4.5 9.5 9 14"/><path d="M4.5 9.5H15a5 5 0 0 1 0 10h-3"/>'),
        redo: svg('<path d="M15 5l4.5 4.5L15 14"/><path d="M19.5 9.5H9a5 5 0 0 0 0 10h3"/>'),
        link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
        camera: svg('<path d="M4 8h3l1.5-2.5h7L17 8h3v11H4z"/><circle cx="12" cy="13.2" r="3.6"/>'),
        photo: svg('<rect x="3" y="4.5" width="18" height="15" rx="2"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="M21 16l-5-5-9 8.5"/>'),
        portrait: svg('<rect x="7" y="3.5" width="10" height="17" rx="1.5"/>'),
        landscape: svg('<rect x="3.5" y="7" width="17" height="10" rx="1.5"/>')
    };

    root.PhotoIcons = I;
})(this);
