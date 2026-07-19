/*
    Cine Studio - inline SVG icon registry

    All glyphs are drawn as inline SVG (24x24 stroke paths) per the
    project convention of never using literal emoji. Elements declare
    an icon with data-icon="name"; CS.applyIcons() injects the markup.
*/
"use strict";

window.CS = window.CS || {};

CS.iconPaths = {
    "folder":        '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>',
    "chevron-down":  '<path d="M6 9l6 6 6-6"/>',
    "chevron-right": '<path d="M9 6l6 6-6 6"/>',
    "save":          '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
    "check-circle":  '<circle cx="12" cy="12" r="9"/><path d="M8.5 12.2l2.4 2.4 4.6-5"/>',
    "dot-circle":    '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3" style="fill:currentColor;stroke:none"/>',
    "panel-right":   '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
    "share":         '<rect x="4" y="9" width="16" height="12" rx="2"/><path d="M12 2v11"/><path d="M8 6l4-4 4 4"/>',
    "export-up":     '<path d="M12 15V4"/><path d="M8 8l4-4 4 4"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',

    "nav-media":     '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 9h18"/><path d="M7 5v4"/><path d="M12 5v4"/><path d="M17 5v4"/>',
    "nav-audio":     '<circle cx="7" cy="17" r="3"/><circle cx="17" cy="15" r="3"/><path d="M10 17V6l10-2v11"/>',
    "nav-titles":    '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M8 10h8"/><path d="M12 10v5"/>',
    "nav-transitions": '<rect x="3" y="6" width="8" height="12" rx="2"/><rect x="13" y="6" width="8" height="12" rx="2" stroke-dasharray="2.5 2.5"/>',
    "nav-effects":   '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"/><path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z"/>',
    "nav-elements":  '<rect x="4" y="4" width="7" height="7" rx="1.8"/><rect x="13" y="4" width="7" height="7" rx="1.8"/><rect x="4" y="13" width="7" height="7" rx="1.8"/><rect x="13" y="13" width="7" height="7" rx="1.8"/>',
    "nav-text":      '<path d="M5 6V4h14v2"/><path d="M12 4v16"/><path d="M9 20h6"/>',
    "nav-filters":   '<circle cx="9" cy="9" r="5.5"/><circle cx="15" cy="15" r="5.5"/>',
    "nav-libraries": '<path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/>',
    "gear":          '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8l1.2 2.5 2.7-.6 1 2.5 2.7.7-.6 2.7 2 1.9-2 1.9.6 2.7-2.7.7-1 2.5-2.7-.6L12 21.2l-1.2-2.5-2.7.6-1-2.5-2.7-.7.6-2.7-2-1.9 2-1.9-.6-2.7 2.7-.7 1-2.5 2.7.6L12 2.8z"/>',

    "funnel":        '<path d="M4 5h16l-6.2 7.4V19l-3.6-2v-4.6L4 5z"/>',
    "list-view":     '<path d="M9 6h11"/><path d="M9 12h11"/><path d="M9 18h11"/><path d="M4 6h1"/><path d="M4 12h1"/><path d="M4 18h1"/>',
    "search":        '<circle cx="11" cy="11" r="7"/><path d="M16.5 16.5L21 21"/>',

    "skip-back":     '<path d="M7 5v14"/><path d="M18 6.5v11L10 12l8-5.5z"/>',
    "skip-fwd":      '<path d="M17 5v14"/><path d="M6 6.5v11L14 12 6 6.5z"/>',
    "play":          '<path d="M7.5 5.2v13.6c0 .8.9 1.3 1.6.9l10.5-6.8c.6-.4.6-1.4 0-1.8L9.1 4.3c-.7-.4-1.6.1-1.6.9z"/>',
    "pause":         '<rect x="6.5" y="5" width="3.6" height="14" rx="1.2"/><rect x="13.9" y="5" width="3.6" height="14" rx="1.2"/>',
    "display":       '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M9 21h6"/><path d="M12 17v4"/>',
    "fullscreen":    '<path d="M4 9V5a1 1 0 0 1 1-1h4"/><path d="M20 9V5a1 1 0 0 0-1-1h-4"/><path d="M4 15v4a1 1 0 0 0 1 1h4"/><path d="M20 15v4a1 1 0 0 1-1 1h-4"/>',

    "cursor":        '<path d="M6 3.5l12 7.6-5.2 1.2-2.6 4.9L6 3.5z"/>',
    "blade":         '<path d="M4 17L17 4l3 3L7 20H4v-3z"/><path d="M14 7l3 3"/>',
    "crop":          '<path d="M7 2v15a1 1 0 0 0 1 1h14"/><path d="M2 7h15a1 1 0 0 1 1 1v14"/>',
    "waveform":      '<path d="M4 10v4"/><path d="M8 7v10"/><path d="M12 4v16"/><path d="M16 8v8"/><path d="M20 10v4"/>',
    "undo":          '<path d="M8 5L3 10l5 5"/><path d="M3 10h11a6 6 0 0 1 6 6v1"/>',
    "redo":          '<path d="M16 5l5 5-5 5"/><path d="M21 10H10a6 6 0 0 0-6 6v1"/>',
    "trash":         '<path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 13a1 1 0 0 0 1 .9h8a1 1 0 0 0 1-.9L18 7"/><path d="M10 11v6"/><path d="M14 11v6"/>',
    "sliders":       '<path d="M4 8h10"/><path d="M18 8h2"/><circle cx="16" cy="8" r="2"/><path d="M4 16h2"/><path d="M10 16h10"/><circle cx="8" cy="16" r="2"/>',
    "minus":         '<path d="M5 12h14"/>',
    "plus":          '<path d="M12 5v14"/><path d="M5 12h14"/>',
    "plus-square":   '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 9v6"/><path d="M9 12h6"/>',
    "magnet":        '<path d="M5 4h4v8a3 3 0 0 0 6 0V4h4v8a7 7 0 0 1-14 0V4z"/><path d="M5 8h4"/><path d="M15 8h4"/>',
    "loop":          '<path d="M17 3l3 3-3 3"/><path d="M20 6H8a4 4 0 0 0-4 4v1"/><path d="M7 21l-3-3 3-3"/><path d="M4 18h12a4 4 0 0 0 4-4v-1"/>',
    "copy":          '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    "marker":        '<path d="M6 3h9l3 4-3 4H6"/><path d="M6 3v18"/>',
    "camera":        '<rect x="3" y="7" width="13" height="12" rx="2"/><path d="M16 12l5-3v8l-5-3"/>',
    "detach":        '<path d="M4 10v4h3l5 4V6l-5 4H4z"/><path d="M17 5l4 4"/><path d="M21 5l-4 4"/>',
    "history":       '<path d="M3 4v5h5"/><path d="M3.5 9a8.5 8.5 0 1 1-1 6"/><path d="M12 8v4l3 2"/>',

    "film":          '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 4v16"/><path d="M16 4v16"/><path d="M3 9h5"/><path d="M3 15h5"/><path d="M16 9h5"/><path d="M16 15h5"/>',
    "speaker":       '<path d="M4 10v4h3l5 4V6L7 10H4z"/><path d="M15.5 9.5a4 4 0 0 1 0 5"/><path d="M18 7a7.5 7.5 0 0 1 0 10"/>',
    "eye":           '<path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
    "eye-off":       '<path d="M2.5 12S6 5.8 12 5.8c1.9 0 3.6.6 5 1.5M21.5 12S18 18.2 12 18.2c-1.9 0-3.6-.6-5-1.5"/><path d="M4 20L20 4"/>',
    "lock":          '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    "rotate-ccw":    '<path d="M3 4v5h5"/><path d="M3.5 9a8.5 8.5 0 1 1-1 6"/>',
    "warning":       '<path d="M12 3L2.5 20h19L12 3z"/><path d="M12 9.5V14"/><path d="M12 16.8v.4"/>',
    "music":         '<circle cx="7" cy="17" r="3"/><path d="M10 17V5l9-2v11"/><circle cx="16" cy="14" r="3"/>',
    "image":         '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M3 17l5.5-5 4.5 4 3-2.5 5 4"/>',
    "upload":        '<path d="M12 15V4"/><path d="M8 8l4-4 4 4"/><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
    "server":        '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01"/><path d="M7 16.5h.01"/>',
    "file":          '<path d="M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><path d="M14 2v5h5"/>',
    "scissors":      '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8.2 7.6L20 19"/><path d="M20 5L8.2 16.4"/>'
};

CS.iconSVG = function (name, extraClass) {
    var path = CS.iconPaths[name] || "";
    return '<svg viewBox="0 0 24 24"' + (extraClass ? ' class="' + extraClass + '"' : "") + ">" + path + "</svg>";
};

//Replace every [data-icon] element's content with its SVG glyph
CS.applyIcons = function (rootEl) {
    var scope = rootEl || document;
    var nodes = scope.querySelectorAll("[data-icon]");
    for (var i = 0; i < nodes.length; i++) {
        var name = nodes[i].getAttribute("data-icon");
        nodes[i].innerHTML = CS.iconSVG(name);
    }
};

//Swap the icon of a single element in place
CS.setIcon = function (el, name) {
    el.setAttribute("data-icon", name);
    el.innerHTML = CS.iconSVG(name);
};
