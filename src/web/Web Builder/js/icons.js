/*
    icons.js

    Inline SVG icon registry for the Site Builder.

    House rule 6 of this repository forbids emoji anywhere in the program, and
    this app does not load Semantic UI (it ships its own chrome), so every glyph
    used by the builder is drawn here as a stroked 24x24 path set that inherits
    currentColor.

    Usage:  el.innerHTML = WBIcon("trash", 16);
*/

var WBIconPaths = {
    /* ---- rail / navigation ---- */
    "plus-circle":  '<circle cx="12" cy="12" r="9"/><path d="M12 8.5v7M8.5 12h7"/>',
    "pages":        '<rect x="8" y="3.5" width="12" height="14" rx="2"/><path d="M16 20.5H6a2 2 0 0 1-2-2V7"/>',
    "layers":       '<path d="M12 3.5l8 4.2-8 4.2-8-4.2 8-4.2z"/><path d="M4 12.4l8 4.2 8-4.2"/><path d="M4 16.6l8 4.2 8-4.2"/>',
    "brush":        '<path d="M15.5 3.9l4.6 4.6-8.8 8.8-4.6-4.6 8.8-8.8z"/><path d="M6.7 12.7L4 20l7.3-2.7"/>',
    "gear":         '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v2.6M12 18.9v2.6M21.5 12h-2.6M5.1 12H2.5M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8M18.7 18.7l-1.8-1.8M7.1 7.1L5.3 5.3"/>',
    "help":         '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.2a2.5 2.5 0 1 1 3.3 2.4c-.6.2-.9.8-.9 1.5v.5"/><path d="M12 16.9v.1"/>',

    /* ---- top bar ---- */
    "logo":         '<path d="M12 3.4l7.6 4.4v8.4L12 20.6 4.4 16.2V7.8L12 3.4z"/><path d="M12 8.4l3.4 2v3.2L12 15.6l-3.4-2v-3.2l3.4-2z"/>',
    "desktop":      '<rect x="3" y="4.5" width="18" height="12" rx="1.6"/><path d="M9 20h6M12 16.5V20"/>',
    "tablet":       '<rect x="6" y="3" width="12" height="18" rx="2"/><path d="M11 18h2"/>',
    "mobile":       '<rect x="7.5" y="2.5" width="9" height="19" rx="2"/><path d="M11 19h2"/>',
    "undo":         '<path d="M4 9.5h10.5a5 5 0 0 1 0 10H9"/><path d="M7.5 6L4 9.5 7.5 13"/>',
    "redo":         '<path d="M20 9.5H9.5a5 5 0 0 0 0 10H15"/><path d="M16.5 6L20 9.5 16.5 13"/>',
    "cloud-check":  '<path d="M7 18.5h10.2a3.8 3.8 0 0 0 .4-7.6A5.6 5.6 0 0 0 6.8 9.7 3.9 3.9 0 0 0 7 18.5z"/><path d="M9.7 14.2l1.8 1.8 3.4-3.6"/>',
    "cloud-off":    '<path d="M7 18.5h10.2a3.8 3.8 0 0 0 2.7-6.5"/><path d="M17.6 10.9A5.6 5.6 0 0 0 6.8 9.7 3.9 3.9 0 0 0 7 18.5"/><path d="M3.5 3.5l17 17"/>',
    "play-circle":  '<circle cx="12" cy="12" r="9"/><path d="M10.2 8.8l5.4 3.2-5.4 3.2V8.8z"/>',
    "publish":      '<path d="M12 3.5c3 2.2 4.6 5.2 4.6 8.6 0 1-.1 1.9-.4 2.8H7.8c-.3-.9-.4-1.8-.4-2.8 0-3.4 1.6-6.4 4.6-8.6z"/><circle cx="12" cy="10.4" r="1.7"/><path d="M9.2 17.4l-2 3.1 3-.9M14.8 17.4l2 3.1-3-.9"/>',
    "more-v":       '<circle cx="12" cy="5.5" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="12" cy="18.5" r="1.3"/>',
    "more-h":       '<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>',
    "caret-down":   '<path d="M6 9.5l6 5.5 6-5.5"/>',
    "caret-right":  '<path d="M9.5 6l5.5 6-5.5 6"/>',
    "caret-up":     '<path d="M6 14.5l6-5.5 6 5.5"/>',

    /* ---- elements ---- */
    "text":         '<path d="M5 6.5h14"/><path d="M12 6.5V18"/><path d="M9 18h6"/>',
    "heading":      '<path d="M6 5v14M18 5v14M6 12h12"/>',
    "image":        '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4.5 17l4.6-4.6 3.3 3.3 2.5-2.4 4.6 4.6"/>',
    "button":       '<rect x="3" y="8" width="18" height="8" rx="4"/><path d="M8.5 12h7"/>',
    "divider":      '<path d="M4 12h16"/><path d="M7 7.5h10M7 16.5h10" opacity="0.4"/>',
    "spacer":       '<path d="M4 5h16M4 19h16"/><path d="M12 8.5v7"/><path d="M9.6 10.6L12 8.2l2.4 2.4M9.6 13.4L12 15.8l2.4-2.4"/>',
    "columns":      '<rect x="3.5" y="4.5" width="17" height="15" rx="1.6"/><path d="M9.2 4.5v15M14.8 4.5v15"/>',
    "section":      '<rect x="3.5" y="4.5" width="17" height="15" rx="1.6"/><path d="M3.5 9.5h17"/>',
    "container":    '<rect x="3.5" y="4.5" width="17" height="15" rx="1.6" stroke-dasharray="3 2.4"/><rect x="7.5" y="8.5" width="9" height="7" rx="1"/>',
    "gallery":      '<rect x="3.5" y="5" width="7.2" height="6.4" rx="1.2"/><rect x="13.3" y="5" width="7.2" height="6.4" rx="1.2"/><rect x="3.5" y="13.6" width="7.2" height="6.4" rx="1.2"/><rect x="13.3" y="13.6" width="7.2" height="6.4" rx="1.2"/>',
    "video":        '<rect x="2.8" y="5.5" width="13" height="13" rx="2"/><path d="M15.8 10.4l5.4-3v9.2l-5.4-3v-3.2z"/>',
    "icon-shape":   '<circle cx="12" cy="12" r="8.8"/><path d="M12 7.6l1.4 2.9 3.2.5-2.3 2.2.5 3.2-2.8-1.5-2.8 1.5.5-3.2-2.3-2.2 3.2-.5L12 7.6z"/>',
    "form":         '<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M7 8.5h10M7 12h10M7 15.5h5"/>',
    "input":        '<rect x="2.5" y="8" width="19" height="8" rx="1.6"/><path d="M6 10.5v3"/>',
    "textarea":     '<rect x="2.5" y="5.5" width="19" height="13" rx="1.6"/><path d="M6 9h8M6 12.2h11M6 15.4h6"/>',
    "checkbox":     '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M7.8 12.2l2.9 2.9 5.5-6"/>',
    "radio":        '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.4"/>',
    "submit":       '<path d="M20.5 3.5L10.8 13.2"/><path d="M20.5 3.5l-6.2 17-3.5-7.3-7.3-3.5 17-6.2z"/>',
    "map":          '<path d="M9.2 4.2L3.5 6.6v13.2l5.7-2.4 5.6 2.4 5.7-2.4V4.2l-5.7 2.4-5.6-2.4z"/><path d="M9.2 4.2v13.2M14.8 6.6v13.2"/>',
    "code":         '<path d="M8.6 7.5L4 12l4.6 4.5M15.4 7.5L20 12l-4.6 4.5"/>',
    "embed":        '<rect x="2.8" y="4.5" width="18.4" height="15" rx="2"/><path d="M9 9.8L7 12l2 2.2M15 9.8l2 2.2-2 2.2"/>',
    "navbar":       '<rect x="3" y="5.5" width="18" height="5" rx="1.4"/><path d="M4 15h6M4 18.5h9" opacity="0.5"/>',
    "list":         '<path d="M5 7h14M5 12h14M5 17h9"/>',
    "quote":        '<path d="M9.5 6.5C7 8 5.5 10 5.5 12.6c0 2.2 1.3 3.7 3.1 3.7 1.6 0 2.8-1.2 2.8-2.8 0-1.5-1.1-2.7-2.6-2.7-.3 0-.6 0-.8.1.3-1.3 1.2-2.5 2.6-3.4z"/><path d="M18 6.5c-2.5 1.5-4 3.5-4 6.1 0 2.2 1.3 3.7 3.1 3.7 1.6 0 2.8-1.2 2.8-2.8 0-1.5-1.1-2.7-2.6-2.7-.3 0-.6 0-.8.1.3-1.3 1.2-2.5 2.6-3.4z"/>',

    /* ---- editing ---- */
    "align-left":   '<path d="M4 6.5h16M4 11h10M4 15.5h14M4 20h8"/>',
    "align-center": '<path d="M4 6.5h16M7 11h10M5 15.5h14M8 20h8"/>',
    "align-right":  '<path d="M4 6.5h16M10 11h10M6 15.5h14M12 20h8"/>',
    "align-just":   '<path d="M4 6.5h16M4 11h16M4 15.5h16M4 20h16"/>',
    "bold":         '<path d="M7 4.8h6.2a3.6 3.6 0 0 1 0 7.2H7V4.8z"/><path d="M7 12h7a3.6 3.6 0 0 1 0 7.2H7V12z"/>',
    "italic":       '<path d="M15.5 4.8H10M14 19.2H8.5M13.6 4.8L10.4 19.2"/>',
    "underline":    '<path d="M7 4.5v6a5 5 0 0 0 10 0v-6"/><path d="M5.5 20h13"/>',
    "link":         '<path d="M10.4 13.6a3.6 3.6 0 0 0 5.4.4l2.6-2.6a3.6 3.6 0 0 0-5.1-5.1l-1.5 1.5"/><path d="M13.6 10.4a3.6 3.6 0 0 0-5.4-.4l-2.6 2.6a3.6 3.6 0 0 0 5.1 5.1l1.5-1.5"/>',
    "unlink":       '<path d="M8 11l-2 2a3.6 3.6 0 0 0 5.1 5.1l2-2M16 13l2-2a3.6 3.6 0 0 0-5.1-5.1l-2 2"/><path d="M3.5 3.5l17 17"/>',
    "pencil":       '<path d="M4.5 19.5l.9-3.6L16.1 5.2a2 2 0 0 1 2.8 2.8L8.1 18.6l-3.6.9z"/>',
    "grip":         '<circle cx="9" cy="6" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="18" r="1.2"/>',
    "copy":         '<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 5.5h-9a2 2 0 0 0-2 2v9"/>',
    "duplicate":    '<rect x="3.5" y="3.5" width="12" height="12" rx="2"/><path d="M8.5 20.5h10a2 2 0 0 0 2-2v-10"/>',
    "trash":        '<path d="M4.5 6.5h15"/><path d="M9.5 6.5V4.8c0-.7.6-1.3 1.3-1.3h2.4c.7 0 1.3.6 1.3 1.3v1.7"/><path d="M6.5 6.5l.9 12.4c.1.9.8 1.6 1.7 1.6h5.8c.9 0 1.6-.7 1.7-1.6l.9-12.4"/><path d="M10.5 10v7M13.5 10v7"/>',
    "eye":          '<path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    "eye-off":      '<path d="M9.9 5.9A9.4 9.4 0 0 1 12 5.8c6 0 9.5 6.2 9.5 6.2a17 17 0 0 1-2.7 3.5M6.4 7.6A16.6 16.6 0 0 0 2.5 12s3.5 6.2 9.5 6.2c1.7 0 3.2-.5 4.5-1.2"/><path d="M10 10a2.9 2.9 0 0 0 4 4"/><path d="M3.5 3.5l17 17"/>',
    "lock":         '<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7"/>',
    "unlock":       '<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7.8a4 4 0 0 1 7.6-1.7"/>',
    "search":       '<circle cx="10.8" cy="10.8" r="6.3"/><path d="M15.4 15.4l4.6 4.6"/>',
    "plus":         '<path d="M12 5v14M5 12h14"/>',
    "minus":        '<path d="M5 12h14"/>',
    "close":        '<path d="M6 6l12 12M18 6L6 18"/>',
    "check":        '<path d="M4.5 12.5l5 5 10-11"/>',
    "folder":       '<path d="M3.5 6.5a2 2 0 0 1 2-2h3.7a2 2 0 0 1 1.4.6l1.3 1.4h6.6a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-11z"/>',
    "folder-plus":  '<path d="M3.5 6.5a2 2 0 0 1 2-2h3.7a2 2 0 0 1 1.4.6l1.3 1.4h6.6a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-11z"/><path d="M12 11v5M9.5 13.5h5"/>',
    "home":         '<path d="M3.5 10.2L12 3.5l8.5 6.7v9.3a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-9.3z"/><path d="M9.3 20.5v-6.4h5.4v6.4"/>',
    "file":         '<path d="M13.5 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9l-5.5-5.5z"/><path d="M13.5 3.5V9H19"/>',
    "clock":        '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.2l3.2 2"/>',
    "alert":        '<path d="M12 3.6l9 15.8H3l9-15.8z"/><path d="M12 9.6v4.2M12 16.6v.1"/>',
    "info":         '<circle cx="12" cy="12" r="8.8"/><path d="M12 11v5.2M12 7.9v.1"/>',
    "external":     '<path d="M14 4.5h5.5V10"/><path d="M19.5 4.5L11 13"/><path d="M18 14.5v4a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6h4"/>',
    "download":     '<path d="M12 3.5v11"/><path d="M8 11l4 4 4-4"/><path d="M4.5 19.5h15"/>',
    "upload":       '<path d="M12 20.5v-11"/><path d="M8 13l4-4 4 4"/><path d="M4.5 4.5h15"/>',
    "save":         '<path d="M5.5 4.5h10L19.5 8v11a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 19V6a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M8 4.5v5h6v-5"/><path d="M8 20.5v-6h8v6"/>',
    "open":         '<path d="M3.5 7.5a2 2 0 0 1 2-2h3.4a2 2 0 0 1 1.5.7l1.2 1.3h6.9a2 2 0 0 1 2 2v1"/><path d="M3.5 9.5h17.2l-1.9 9.2a1.6 1.6 0 0 1-1.6 1.3H6a1.6 1.6 0 0 1-1.6-1.3L3.5 9.5z"/>',
    "new-file":     '<path d="M13.5 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9l-5.5-5.5z"/><path d="M12 11v6M9 14h6"/>',
    "globe":        '<circle cx="12" cy="12" r="8.8"/><path d="M3.2 12h17.6"/><path d="M12 3.2c2.2 2.4 3.4 5.5 3.4 8.8s-1.2 6.4-3.4 8.8c-2.2-2.4-3.4-5.5-3.4-8.8S9.8 5.6 12 3.2z"/>',
    "palette":      '<path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.2 0 2-.8 2-1.8 0-.5-.2-.9-.5-1.2-.3-.4-.5-.8-.5-1.2 0-1 .8-1.8 1.8-1.8h1.4a4.3 4.3 0 0 0 4.3-4.3c0-3.7-3.8-6.7-8.5-6.7z"/><circle cx="7.6" cy="11.4" r="1.1"/><circle cx="10.4" cy="7.4" r="1.1"/><circle cx="15" cy="8.2" r="1.1"/>',
    "type":         '<path d="M4 7V5h16v2"/><path d="M12 5v14"/><path d="M9 19h6"/>',
    "box":          '<path d="M12 3.2l8 4v9.6l-8 4-8-4V7.2l8-4z"/><path d="M4 7.2l8 4 8-4M12 11.2v9.6"/>',
    "sparkle":      '<path d="M12 4l1.7 4.6L18.3 10l-4.6 1.4L12 16l-1.7-4.6L5.7 10l4.6-1.4L12 4z"/><path d="M18.5 15.5l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7.7-1.9z"/>',
    "resize":       '<path d="M4 9V4h5M20 15v5h-5"/><path d="M4 4l6 6M20 20l-6-6"/>',
    "phone-rotate": '<rect x="4" y="7" width="16" height="10" rx="2"/><path d="M9 3.5h6"/>',
    "block":        '<rect x="3.5" y="3.5" width="17" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7.5" height="7" rx="1.6"/><rect x="13" y="13.5" width="7.5" height="7" rx="1.6"/>'
};

/*
    Build an SVG string for the named icon.
    size      - pixel size of the square icon (default 16)
    strokeW   - stroke width in viewBox units (default 1.6)
*/
function WBIcon(name, size, strokeW) {
    var body = WBIconPaths[name];
    if (body === undefined) {
        body = WBIconPaths["box"];
    }
    size = size || 16;
    strokeW = strokeW || 1.6;
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" ' +
        'stroke="currentColor" stroke-width="' + strokeW + '" stroke-linecap="round" ' +
        'stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
}
