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
    PS.bindWorkspaceEvents();
    PS.buildMenubar();
    PS.bindHotkeys();
    PS.bindChrome();
    PS.renderColorPanel();

    PS.loadPrefs(function () {
        PS.setFg(PS.fg, true);
        PS.setBg(PS.bg);

        // fonts load in the background; refresh the text options when done
        PS.loadFonts(function () {
            if (PS.tool === "text") { PS.renderOptionsBar(); }
        });

        var startTool = (PS.prefs && PS.prefs.tool && PS.tools[PS.prefs.tool])
            ? PS.prefs.tool : "brush";
        PS.setTool(startTool);

        PS.startOverlayLoop();

        // file passed from the file manager ("open with")?
        if (!PS.openLaunchFiles()) {
            PS.newDocument({ width: 1000, height: 700, background: "white" });
        }
    });
});

// wire static chrome: color wells, zoom select
PS.bindChrome = function () {
    PS.el("fg-well").addEventListener("click", function () {
        PS.el("fg-input").click();
    });
    PS.el("bg-well").addEventListener("click", function () {
        PS.el("bg-input").click();
    });
    PS.el("fg-input").addEventListener("input", function (e) {
        PS.setFg(e.target.value);
    });
    PS.el("bg-input").addEventListener("input", function (e) {
        PS.setBg(e.target.value);
    });

    PS.el("status-zoom").addEventListener("change", function (e) {
        if (e.target.value === "fit") { PS.zoomFit(); }
        else { PS.setZoom(parseFloat(e.target.value), PS.viewportCenterDocPt()); }
    });

    // flush pending preference writes when leaving
    window.addEventListener("beforeunload", function () {
        if (PS._prefsTimer) { PS.savePrefsNow(); }
    });
};
