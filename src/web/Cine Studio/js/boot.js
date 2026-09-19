/*
    Cine Studio - bootstrap and global chrome wiring
*/
"use strict";

document.addEventListener("DOMContentLoaded", function () {

    CS.applyIcons(document);
    CS.newProject({});

    CS.media.init();
    CS.player.init();
    CS.source.init();
    CS.previewctl.init();
    CS.timeline.init();
    CS.inspector.init();

    /* ---------- top bar ---------- */

    document.getElementById("btn-open-menu").addEventListener("click", function (ev) {
        CS.fileio.openMenu(ev.currentTarget);
    });
    document.getElementById("btn-edit-menu").addEventListener("click", function (ev) {
        CS.fileio.editMenu(ev.currentTarget);
    });
    //The window title carries the saved / edited state, so the name itself is
    //free to be the rename affordance
    document.getElementById("project-name-btn").addEventListener("click", CS.fileio.renameDialog);
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
        } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "c") {
            ev.preventDefault();
            CS.copySelectedClips();
        } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "v") {
            ev.preventDefault();
            CS.pasteClipsAtPlayhead();
        } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "d") {
            ev.preventDefault();
            CS.duplicateSelectedClips();
        } else if (ev.key === "Delete" || ev.key === "Backspace") {
            if (CS.state.selectedClipId) {
                ev.preventDefault();
                if (ev.shiftKey) { CS.rippleDeleteSelected(); }
                else { CS.deleteSelectedClip(); }
            }
        } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "k") {
            //Premiere: Ctrl+K adds an edit (cut) at the playhead
            ev.preventDefault();
            CS.splitAtPlayhead();
        } else if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && ev.key.toLowerCase() === "i") {
            ev.preventDefault();
            CS.clearInOut("in");
        } else if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && ev.key.toLowerCase() === "o") {
            ev.preventDefault();
            CS.clearInOut("out");
        } else if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && ev.key.toLowerCase() === "x") {
            ev.preventDefault();
            CS.clearInOut();
        } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "l") {
            ev.preventDefault();
            if (CS.selectedClips().length > 1) { CS.linkSelectedClips(); } else { CS.unlinkClips(); }
        } else if (ev.ctrlKey || ev.metaKey) {
            return; //other browser / OS chords stay untouched
        } else if (ev.key.toLowerCase() === "m") {
            if (ev.shiftKey) { CS.gotoMarker(1); }
            else { CS.toggleMarkerAtPlayhead(); }
        } else if (ev.key.toLowerCase() === "j") {
            CS.player.shuttle(-1);
        } else if (ev.key.toLowerCase() === "k") {
            CS.player.pause();
        } else if (ev.key.toLowerCase() === "l") {
            CS.player.shuttle(1);
        } else if (ev.key.toLowerCase() === "i" && !ev.shiftKey) {
            if (CS.source.active) { CS.source.markIn(); } else { CS.setInPoint(CS.state.playhead); }
        } else if (ev.key.toLowerCase() === "o" && !ev.shiftKey) {
            if (CS.source.active) { CS.source.markOut(); } else { CS.setOutPoint(CS.state.playhead); }
        } else if (ev.key === ";") {
            CS.rangeLift();
        } else if (ev.key === "'") {
            CS.rangeExtract();
        } else if (ev.key === ",") {
            if (CS.source) { CS.source.insert(); }
        } else if (ev.key === ".") {
            if (CS.source) { CS.source.overwrite(); }
        } else if (ev.key === "\\") {
            CS.timeline.zoomToSequence();
        } else if (ev.key === "=" || ev.key === "+") {
            CS.timeline.setZoom(CS.state.zoom * 1.35);
        } else if (ev.key === "-") {
            CS.timeline.setZoom(CS.state.zoom / 1.35);
        } else if (ev.key.toLowerCase() === "s" && ev.shiftKey) {
            document.getElementById("btn-snap").click();
        } else if (!ev.shiftKey && CS.timeline.TOOLS.some(function (t) { return t.key.toLowerCase() === ev.key.toLowerCase(); })) {
            //Tool shortcuts follow Premiere: V A B N R C Y U
            var toolKey = ev.key.toLowerCase();
            CS.timeline.TOOLS.forEach(function (t) {
                if (t.key.toLowerCase() === toolKey) { CS.timeline.setTool(t.id); }
            });
        } else if (ev.key.toLowerCase() === "t") {
            CS.titles.insertPreset("title");
        } else if (ev.key === "ArrowLeft" && ev.altKey) {
            ev.preventDefault();
            CS.nudgeSelected(ev.shiftKey ? -5 : -1);
        } else if (ev.key === "ArrowRight" && ev.altKey) {
            ev.preventDefault();
            CS.nudgeSelected(ev.shiftKey ? 5 : 1);
        } else if (ev.key === "ArrowLeft") {
            ev.preventDefault();
            var stepL = (ev.shiftKey ? 10 : 1) / fps;
            if (CS.source.active) { CS.source.seek(CS.source.time - stepL); } else { CS.player.seek(CS.state.playhead - stepL); }
        } else if (ev.key === "ArrowRight") {
            ev.preventDefault();
            var stepR = (ev.shiftKey ? 10 : 1) / fps;
            if (CS.source.active) { CS.source.seek(CS.source.time + stepR); } else { CS.player.seek(CS.state.playhead + stepR); }
        } else if (ev.key === "ArrowUp" || ev.key === "ArrowDown") {
            ev.preventDefault();
            CS.player.gotoEditPoint(ev.key === "ArrowUp" ? -1 : 1);
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
    var openedLaunchFile = CS.fileio.openLaunchFiles();

    //Auto-save loop + crash recovery offer (skip when launched with a file)
    CS.session.init();
    if (!openedLaunchFile) {
        CS.session.checkRecovery();
    }
});
