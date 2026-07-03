/*
    Cine Studio - bootstrap and global chrome wiring
*/
"use strict";

document.addEventListener("DOMContentLoaded", function () {

    CS.applyIcons(document);
    CS.newProject({});

    CS.media.init();
    CS.player.init();
    CS.timeline.init();
    CS.inspector.init();

    /* ---------- top bar ---------- */

    document.getElementById("btn-open-project").addEventListener("click", CS.fileio.openDialog);
    document.getElementById("btn-save-project").addEventListener("click", CS.fileio.saveProject);
    document.getElementById("btn-save-state").addEventListener("click", function () {
        CS.toast(CS.state.dirty ? "Project has unsaved changes" : "Project is saved");
    });
    document.getElementById("project-name-btn").addEventListener("click", function (ev) {
        CS.fileio.projectMenu(ev.currentTarget);
    });
    document.getElementById("btn-export").addEventListener("click", CS.exporter.dialog);
    document.getElementById("btn-export-menu").addEventListener("click", function (ev) {
        CS.exporter.quickMenu(ev.currentTarget.parentNode);
    });
    document.getElementById("btn-share").addEventListener("click", function () {
        if (CS.inArozOS()) {
            ao_module_openPath(CS.APP_ROOT + "/Exports");
        } else {
            CS.toast("Available inside ArozOS only");
        }
    });
    document.getElementById("btn-settings").addEventListener("click", CS.fileio.settingsDialog);

    //macOS traffic lights: red closes the float window
    document.querySelector(".tl-close").addEventListener("click", function () {
        function doClose() {
            if (typeof ao_module_close !== "undefined") { ao_module_close(); }
        }
        if (CS.state.dirty) {
            CS.confirm("Unsaved changes", "Close Cine Studio and discard unsaved changes?", doClose);
        } else {
            doClose();
        }
    });
    document.querySelector(".tl-min").addEventListener("click", function () {
        CS.toast("Use the desktop window controls to minimize");
    });
    document.querySelector(".tl-max").addEventListener("click", function () {
        var stage = document.getElementById("preview-stage");
        if (stage.requestFullscreen && !document.fullscreenElement) { stage.requestFullscreen(); }
        else if (document.fullscreenElement) { document.exitFullscreen(); }
    });

    /* ---------- nav rail ---------- */

    var navItems = document.querySelectorAll("#navrail .nav-item[data-nav]");
    function activateNav(nav) {
        for (var i = 0; i < navItems.length; i++) {
            navItems[i].classList.toggle("active", navItems[i].getAttribute("data-nav") === nav);
        }
    }
    for (var i = 0; i < navItems.length; i++) {
        navItems[i].addEventListener("click", function () {
            var nav = this.getAttribute("data-nav");
            var kindLabel = document.getElementById("bin-kind-label");
            if (nav === "media") {
                activateNav(nav);
                CS.state.binKind = "all";
                kindLabel.textContent = "All Clips";
                CS.media.renderBin();
            } else if (nav === "audio") {
                activateNav(nav);
                CS.state.binKind = "audio";
                kindLabel.textContent = "Audio";
                CS.media.renderBin();
            } else {
                CS.toast(this.querySelector("label").textContent + " is not available in this version");
            }
        });
    }

    /* ---------- selection hook: keep inspector tab sensible ---------- */

    var origSelect = CS.selectClip;
    CS.selectClip = function (clipId) {
        origSelect(clipId);
        CS.inspector.autoTab();
        CS.inspector.render();
    };

    /* ---------- keyboard shortcuts ---------- */

    document.addEventListener("keydown", function (ev) {
        var tag = (ev.target.tagName || "").toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select") { return; }

        var fps = CS.project.settings.fps;
        if (ev.code === "Space") {
            ev.preventDefault();
            CS.player.toggle();
        } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "s") {
            ev.preventDefault();
            CS.fileio.saveProject();
        } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "o") {
            ev.preventDefault();
            CS.fileio.openDialog();
        } else if ((ev.ctrlKey || ev.metaKey) && ((ev.key.toLowerCase() === "z" && ev.shiftKey) || ev.key.toLowerCase() === "y")) {
            ev.preventDefault();
            CS.redo();
        } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z") {
            ev.preventDefault();
            CS.undo();
        } else if (ev.key === "Delete" || ev.key === "Backspace") {
            if (CS.state.selectedClipId) {
                ev.preventDefault();
                CS.deleteSelectedClip();
            }
        } else if (ev.key.toLowerCase() === "v") {
            CS.timeline.setTool("select");
        } else if (ev.key.toLowerCase() === "b") {
            CS.timeline.setTool("blade");
        } else if (ev.key.toLowerCase() === "s" && !ev.ctrlKey && !ev.metaKey) {
            CS.splitAtPlayhead();
        } else if (ev.key === "ArrowLeft") {
            ev.preventDefault();
            CS.player.seek(CS.state.playhead - (ev.shiftKey ? 10 : 1) / fps);
        } else if (ev.key === "ArrowRight") {
            ev.preventDefault();
            CS.player.seek(CS.state.playhead + (ev.shiftKey ? 10 : 1) / fps);
        } else if (ev.key === "Home") {
            ev.preventDefault();
            CS.player.seek(0);
        } else if (ev.key === "End") {
            ev.preventDefault();
            CS.player.seek(CS.timelineDuration());
        }
    });

    /* ---------- ArozOS bootstrap ---------- */

    CS.ensureAppFolders();
    CS.checkServerFFmpeg();

    /* ---------- initial paint ---------- */

    CS.media.renderBin();
    CS.timeline.render();
    CS.inspector.render();
    CS.player.invalidate();
    CS.updateSaveState();

    //Open a project / media passed by the desktop (double-click on .cine)
    CS.fileio.openLaunchFiles();
});
