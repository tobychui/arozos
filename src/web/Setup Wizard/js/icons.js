/*
    Setup Wizard icons

    Line icons drawn for the wizard on a 24 x 24 grid, in currentColor.
    WizardIcon(name) returns the markup, and any element with a data-icon
    attribute gets its icon when the page starts.
*/

(function () {
    var paths = {
        desktop: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
        drive: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2.5h6.5A2.5 2.5 0 0 1 21 10v6.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5z"/><path d="M8 14h8"/>',
        disk: '<rect x="3" y="6" width="18" height="12" rx="2.5"/><path d="M7 14h.01M11 14h6"/><path d="M3 11h18"/>',
        usb: '<rect x="7" y="9" width="10" height="12" rx="2"/><path d="M9 9V4h6v5M10.5 6.5h.01M13.5 6.5h.01"/>',
        folder: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2.5h6.5A2.5 2.5 0 0 1 21 10v6.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5z"/>',
        network: '<rect x="9" y="3" width="6" height="5" rx="1.2"/><rect x="3" y="16" width="6" height="5" rx="1.2"/><rect x="15" y="16" width="6" height="5" rx="1.2"/><path d="M12 8v4M6 16v-2h12v2"/>',
        cloud: '<path d="M7 18.5a4.5 4.5 0 0 1-.5-9 6 6 0 0 1 11.5 1.5 3.75 3.75 0 0 1-.5 7.5z"/>',
        user: '<circle cx="12" cy="8" r="3.6"/><path d="M5 20a7 7 0 0 1 14 0"/>',
        users: '<circle cx="9" cy="8" r="3.3"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 4.6a3.3 3.3 0 0 1 0 6.6M18 14.4a6 6 0 0 1 3 5.6"/>',
        shield: '<path d="M12 3l7.5 3v5.5c0 4.4-3.2 8.1-7.5 9.5-4.3-1.4-7.5-5.1-7.5-9.5V6z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
        crown: '<path d="M4 8l4 4 4-6 4 6 4-4-1.5 10h-13z"/>',
        share: '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.3 10.8l7.4-3.6M8.3 13.2l7.4 3.6"/>',
        windows: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
        globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
        terminal: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M7 10l3 2.5L7 15M12.5 15H17"/>',
        check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
        plus: '<path d="M12 5v14M5 12h14"/>',
        trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12.5h10L18 7M9 7V4h6v3"/>',
        refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5"/>',
        warning: '<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.5h.01"/>',
        info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8h.01"/>',
        arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
        arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
        sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
        flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
        eraser: '<path d="M8.5 20H20M4.6 14.6l8.8-8.8a2 2 0 0 1 2.8 0l3 3a2 2 0 0 1 0 2.8L12 18.8a2 2 0 0 1-1.4.6H8.4a2 2 0 0 1-1.4-.6l-2.4-2.4a1.2 1.2 0 0 1 0-1.8z"/><path d="M9 10l5.5 5.5"/>',
        lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
        sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/>',
        moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
        server: '<rect x="4" y="4" width="16" height="7" rx="2"/><rect x="4" y="13" width="16" height="7" rx="2"/><path d="M8 7.5h.01M8 16.5h.01M12 7.5h4M12 16.5h4"/>'
    };

    window.WizardIcon = function (name, extraClass) {
        var body = paths[name] || paths.info;
        return '<span class="wz-icon' + (extraClass ? " " + extraClass : "") + '" aria-hidden="true">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
            body + "</svg></span>";
    };

    window.WizardFillIcons = function (root) {
        var nodes = (root || document).querySelectorAll("[data-icon]");
        Array.prototype.forEach.call(nodes, function (node) {
            if (!node.firstChild) {
                node.innerHTML = window.WizardIcon(node.getAttribute("data-icon"));
            }
        });
    };
})();
