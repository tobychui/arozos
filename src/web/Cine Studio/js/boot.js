/*
    Cine Studio - bootstrap and global chrome wiring
*/
"use strict";

document.addEventListener("DOMContentLoaded", function () {

    CS.applyIcons(document);
    CS.newProject({});

    CS.media.init();
    CS.player.init();
    CS.previewctl.init();
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
            activateNav(nav);
            if (nav === "media") {
                CS.state.binKind = "all";
                kindLabel.textContent = "All Clips";
                CS.panels.show("media");
                CS.media.renderBin();
            } else if (nav === "audio") {
                CS.state.binKind = "audio";
                kindLabel.textContent = "Audio";
                CS.panels.show("media");
                CS.media.renderBin();
            } else if (nav === "effects") {
                CS.panels.show("fx");
            } else if (nav === "titles" || nav === "text") {
                CS.panels.show("titles");
            } else if (nav === "transitions") {
                CS.panels.show("transitions");
            } else if (nav === "elements") {
                CS.panels.show("elements");
            } else if (nav === "filters") {
                CS.panels.show("filters");
            } else if (nav === "libraries") {
                CS.panels.show("libraries");
            }
        });
    }
    CS.panels.show("media");

    /* ---------- selection hook: keep inspector tab sensible ---------- */

    var origSelect = CS.selectClip;
    CS.selectClip = function (clipId) {
        origSelect(clipId);
        CS.inspector.autoTab();
        CS.inspector.render();
        CS.panels.refresh();
        CS.previewctl.redraw();
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
        } else if (ev.key.toLowerCase() === "t" && !ev.ctrlKey && !ev.metaKey) {
            CS.titles.insertPreset("title");
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
