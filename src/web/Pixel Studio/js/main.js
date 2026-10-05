/*
    Pixel Studio - boot
*/
"use strict";

PS.toolOrder = [
    "move",
    "marquee-rect", "marquee-ellipse",
    "lasso", "lasso-poly",
    "wand",
    "brush", "pencil",
    "eraser",
    "fill",
    "eyedropper",
    "text",
    "shape",
    "hand",
    "zoom"
];

window.addEventListener("DOMContentLoaded", function () {
    PS.installTypeTools();
    PS.renderer.init(PS.el("doc-canvas"));
    PS.registerPanels();
    PS.ws.init();
    PS.bindWorkspaceEvents();
    PS.buildMenubar();
    PS.bindHotkeys();
    PS.bindChrome();
    PS.bindGuides();
    PS.bindDropTarget();
    PS.renderColorPanel();

    PS.loadPrefs(function () {
        PS.loadCustomTips();
        PS.setFg(PS.fg, true);
        PS.setBg(PS.bg);
        if (PS.prefs && PS.prefs.snapToGuides === false) { PS.snapToGuides = false; }
        PS.gridOn = !!(PS.prefs && PS.prefs.gridOn);
        PS.setRulers(!!(PS.prefs && PS.prefs.rulersOn));

        // fonts load in the background; refresh the text options when done
        PS.loadFonts(function () {
            if (PS.tool === "text") { PS.renderOptionsBar(); }
        });

        var startTool = (PS.prefs && PS.prefs.tool && PS.tools[PS.prefs.tool])
            ? PS.prefs.tool : "brush";
        PS.setTool(startTool);

        PS.startOverlayLoop();

        PS.saveManager.init();

        // file passed from the file manager ("open with")? otherwise start
        // with an empty editor (dark background) until the user picks
        // File > New or File > Open - no document is created on launch.
        // Without a file, offer artwork a previous session left unsaved.
        if (!PS.openLaunchFiles()) { PS.saveManager.offerRecovery(); }
    });
});

// wire static chrome: color wells, zoom select
PS.bindChrome = function () {
    PS.el("fg-well").addEventListener("click", function () {
        PS.openColorPicker("fg");
    });
    PS.el("bg-well").addEventListener("click", function () {
        PS.openColorPicker("bg");
    });

    PS.el("quickmask-btn").addEventListener("click", function () { PS.toggleQuickMask(); });
    PS.el("screenmode-btn").addEventListener("click", function () { PS.cycleScreenMode(); });
    PS.el("screenmode-btn").addEventListener("contextmenu", function (e) {
        e.preventDefault();
        var r = e.currentTarget.getBoundingClientRect();
        PS.contextMenu(r.right + 2, r.top, PS.SCREEN_MODES.map(function (label, i) {
            return { label: label, checked: function () { return PS.screenMode === i; }, action: function () { PS.setScreenMode(i); } };
        }));
    });

    PS.el("status-zoom").addEventListener("change", function (e) {
        if (e.target.value === "fit") { PS.zoomFit(); }
        else { PS.setZoom(parseFloat(e.target.value), PS.viewportCenterDocPt()); }
    });

    // the view panels follow scrolling
    PS.el("workspace").addEventListener("scroll", function () { PS.refreshViewPanels(); });

    // flush pending preference writes when leaving
    window.addEventListener("beforeunload", function () {
        if (PS._prefsTimer) { PS.savePrefsNow(); }
    });
};
