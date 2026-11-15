/*
    Line icons of the Paint app, drawn on a 24 x 24 grid with
    stroke = currentColor so they follow the theme. Shape gallery icons
    are generated from the shape geometry itself (shapes.js).
*/
import { shapeIconPath } from './shapes.js';

const P = {
    select: '<rect x="4" y="4" width="16" height="16" rx="1" stroke-dasharray="3 2.6"/>',
    lasso: '<path d="M8.5 17.5C4.6 16.4 3 13.6 4.2 10.6 5.6 7 10.2 4.6 14.6 5.2c4.2.6 6.4 3.4 5 6.4-1.3 2.9-5.6 4.6-9.6 4.2" stroke-dasharray="3 2.6"/><path d="M9.5 15.5c-1.6.4-2.2 1.6-1.4 2.6.6.8.4 1.9-.6 2.9"/>',
    pencil: '<path d="M4 20l1.1-4.2L15.6 5.3a2 2 0 0 1 2.8 0l.3.3a2 2 0 0 1 0 2.8L8.2 18.9z"/><path d="M13.8 7.1l3.1 3.1"/>',
    brush: '<path d="M19.6 4.4c.8.8-5.3 7.8-8 10.2l-2.2-2.2c2.4-2.7 9.4-8.8 10.2-8z"/><path d="M9.3 13.1c-2.1-.3-3.9 1.2-4 3.4-.1 1.6-.9 2.5-2.3 3.1 3.1 1.3 7.4.6 7.8-3.7"/>',
    eraser: '<path d="M9 20h11"/><path d="M5.2 16.3l9.9-9.9a2 2 0 0 1 2.8 0l1.7 1.7a2 2 0 0 1 0 2.8L11 19.5H8.4l-3.2-3.2a0 0 0 0 1 0 0z"/><path d="M9.6 11.9l4.6 4.6"/>',
    fill: '<path d="M10.6 3.8l8.1 8.1-6.8 6.8a2 2 0 0 1-2.8 0L4 13.6a2 2 0 0 1 0-2.8z"/><path d="M3.6 12.4h15"/><path d="M20.4 15.6s1.6 2 1.6 3.1a1.6 1.6 0 0 1-3.2 0c0-1.1 1.6-3.1 1.6-3.1z"/>',
    text: '<path d="M5 7V4.5h14V7"/><path d="M12 4.5v15"/><path d="M9 19.5h6"/>',
    picker: '<path d="M14.6 5.2l1.3-1.3a2.1 2.1 0 0 1 3 0l1.2 1.2a2.1 2.1 0 0 1 0 3l-1.3 1.3"/><path d="M12.4 6.4l5.2 5.2"/><path d="M15.6 9.6L7.4 17.8 4.6 19.4l1.6-2.8 8.2-8.2"/>',
    shapes: '<rect x="3.5" y="10.5" width="10" height="10" rx="1.2"/><circle cx="15.5" cy="8.5" r="5"/>',
    spray: '<rect x="4.5" y="10.5" width="8" height="10.5" rx="1.6"/><path d="M6.5 10.5V7.5h4v3"/><path d="M8.5 7.5V5h3"/><circle cx="16" cy="4.5" r=".9" fill="currentColor" stroke="none"/><circle cx="19" cy="7" r=".9" fill="currentColor" stroke="none"/><circle cx="16.5" cy="9" r=".9" fill="currentColor" stroke="none"/><circle cx="20" cy="11" r=".9" fill="currentColor" stroke="none"/><circle cx="17" cy="13" r=".9" fill="currentColor" stroke="none"/>',
    highlighter: '<path d="M9.4 12.6l5.9-7.9a2 2 0 0 1 2.9-.3l1.4 1.4a2 2 0 0 1-.3 2.9l-7.9 5.9z"/><path d="M9.4 12.6l-1.6 3.6 1.6 1.6 3.6-1.6"/><path d="M7.8 16.2L4 20h4l1.4-2.2"/>',
    calligraphy: '<path d="M12 21.5V13"/><path d="M12 2.5l5.2 7.7L12 21.5 6.8 10.2z"/><circle cx="12" cy="11.2" r="1.6"/>',
    roundbrush: '<path d="M5 17c2.5-6 5.5-9 9-9 2 0 3 1 3 2.5 0 2.5-3.5 3-3.5 5 0 1.4 1.6 2 4 1.5"/>',
    undo: '<path d="M9 14.5L4 9.5l5-5"/><path d="M4 9.5h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    redo: '<path d="M15 14.5l5-5-5-5"/><path d="M20 9.5H9.5a5.5 5.5 0 0 0 0 11H13"/>',
    paste: '<rect x="8" y="2.5" width="8" height="4" rx="1"/><path d="M16 4.5h2a2 2 0 0 1 2 2V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2h2"/>',
    cut: '<circle cx="6" cy="6" r="2.8"/><circle cx="6" cy="18" r="2.8"/><path d="M20 4L8.1 15.9"/><path d="M14.5 14.5L20 20"/><path d="M8.1 8.1L12 12"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4.5A2.5 2.5 0 0 1 2 12.5v-8A2.5 2.5 0 0 1 4.5 2h8A2.5 2.5 0 0 1 15 4.5V5"/>',
    save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>',
    saveas: '<path d="M12 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v3"/><path d="M7 3v5h8"/><path d="M7 21v-6h5"/><path d="M15.5 21l.6-2.4 4.6-4.6a1.4 1.4 0 0 1 2 2l-4.6 4.6z"/>',
    open: '<path d="M3 7.5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    newfile: '<path d="M14 3H6.5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8.5z"/><path d="M14 3v5.5h5.5"/><path d="M12 11.5v6M9 14.5h6"/>',
    download: '<path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M4 20h16"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/>',
    close: '<path d="M18 6L6 18M6 6l12 12"/>',
    crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
    resize: '<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/>',
    canvassize: '<rect x="7" y="7" width="10" height="10" rx="1"/><path d="M3 7V3h4M17 3h4v4M21 17v4h-4M7 21H3v-4"/>',
    rotcw: '<path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1"/><path d="M20.5 3.5v5h-5"/>',
    rotccw: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 3.5v5h5"/>',
    rot180: '<path d="M4 12a8 8 0 0 1 14.9-4"/><path d="M19.5 3.5V8H15"/><path d="M20 12a8 8 0 0 1-14.9 4"/><path d="M4.5 20.5V16H9"/>',
    fliph: '<path d="M12 3v18" stroke-dasharray="2 2"/><path d="M9 7l-6 5 6 5z"/><path d="M15 7l6 5-6 5z"/>',
    flipv: '<path d="M3 12h18" stroke-dasharray="2 2"/><path d="M7 9l5-6 5 6z"/><path d="M7 15l5 6 5-6z"/>',
    zoomin: '<circle cx="11" cy="11" r="7"/><path d="M20.5 20.5l-4.5-4.5M11 8v6M8 11h6"/>',
    zoomout: '<circle cx="11" cy="11" r="7"/><path d="M20.5 20.5l-4.5-4.5M8 11h6"/>',
    fit: '<path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/>',
    actual: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 10l1.5-1v6M14.5 10l1.5-1v6"/><path d="M12 10.5v.01M12 14v.01"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20.5 13.2A8.5 8.5 0 1 1 10.8 3.5a6.6 6.6 0 0 0 9.7 9.7z"/>',
    swap: '<path d="M14 4h3a3 3 0 0 1 3 3v3"/><path d="M17.5 7.5L20 10l2.5-2.5"/><path d="M10 20H7a3 3 0 0 1-3-3v-3"/><path d="M6.5 16.5L4 14l-2.5 2.5"/>',
    reset: '<rect x="3" y="3" width="11" height="11" rx="1.5" fill="currentColor"/><rect x="10" y="10" width="11" height="11" rx="1.5"/>',
    chevron: '<path d="M6 9l6 6 6-6"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
    invert: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/>',
    grayscale: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17M12 7h7M12 11h8.5M12 15h8M12 18.5h5"/>',
    trash: '<path d="M3.5 6h17"/><path d="M8.5 6V4h7v2"/><path d="M18.5 6l-.9 13.1a2 2 0 0 1-2 1.9H8.4a2 2 0 0 1-2-1.9L5.5 6"/>',
    selectall: '<rect x="3.5" y="3.5" width="17" height="17" rx="1" stroke-dasharray="3 2.6"/><path d="M8 12.2l2.8 2.8 5.2-6"/>',
    deselect: '<rect x="3.5" y="3.5" width="17" height="17" rx="1" stroke-dasharray="3 2.6"/><path d="M9 9l6 6M15 9l-6 6"/>',
    pointer: '<path d="M5.5 3.5l13 6.3-5.7 1.7-2.4 5.8z"/><path d="M13 12l5 5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.3A4.7 4.7 0 0 0 21 9.7C21 5.9 17 3 12 3z"/><circle cx="7.5" cy="11.5" r="1.2"/><circle cx="10" cy="7.3" r="1.2"/><circle cx="15" cy="7.3" r="1.2"/>',
    outline: '<rect x="4" y="4" width="16" height="16" rx="2"/>',
    filled: '<rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor" fill-opacity=".35"/>',
    alignleft: '<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>',
    aligncenter: '<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>',
    alignright: '<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>',
    keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
    pastefile: '<path d="M14 3H6.5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8.5z"/><path d="M14 3v5.5h5.5"/><path d="M8.5 17l2.5-3 2 2 1.5-1.5 2 2.5"/>'
};

export function icon(name, cls) {
    let inner = P[name];
    if (inner === undefined) {
        const d = shapeIconPath(name);
        inner = '<path d="' + d + '"/>';
    }
    return '<svg class="ic' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
}

export function hasIcon(name) {
    return P[name] !== undefined;
}
