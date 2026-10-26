/*
    Cine Studio - side panel switching (nav rail) + filters and
    libraries panels. The media bin column hosts one panel at a time,
    selected via the data-panel attribute on #mediabin.
*/
"use strict";

window.CS = window.CS || {};

CS.panels = {

    current: "media",

    show: function (name) {
        CS.panels.current = name;
        document.getElementById("mediabin").setAttribute("data-panel", name);
        if (name === "fx") { CS.effects.renderGallery(); }
        else if (name === "titles") { CS.titles.renderPanel(); }
        else if (name === "transitions") { CS.transitions.renderPanel(); }
        else if (name === "elements") { CS.titles.renderElementsPanel(); }
        else if (name === "filters") { CS.panels.renderFilters(); }
        else if (name === "libraries") { CS.panels.renderLibraries(); }
    },

    //Re-evaluate "applied" markers after the selection or clip data changes
    refresh: function () {
        if (CS.panels.current === "fx") { CS.effects.refreshApplied(); }
        else if (CS.panels.current === "transitions") { CS.transitions.refreshApplied(); }
        else if (CS.panels.current === "filters") { CS.panels.refreshFiltersApplied(); }
    },

    /* ---------- filters (color preset looks) ---------- */

    filterLooks: [
        { v: "default", l: "Default", css: "" },
        { v: "mono",    l: "Monochrome", css: "grayscale(1)" },
        { v: "warm",    l: "Warm", css: "sepia(0.45) saturate(1.2)" },
        { v: "cool",    l: "Cool", css: "hue-rotate(-18deg) saturate(1.05)" },
        { v: "vivid",   l: "Vivid", css: "saturate(1.5) contrast(1.12)" }
    ],

    _filtersBuilt: false,
    renderFilters: function () {
        if (CS.panels._filtersBuilt) { CS.panels.refreshFiltersApplied(); return; }
        CS.panels._filtersBuilt = true;
        var grid = document.getElementById("filters-grid");
        grid.innerHTML = "";
        CS.panels.filterLooks.forEach(function (look) {
            var card = document.createElement("div");
            card.className = "fx-card";
            card.dataset.preset = look.v;
            var thumb = document.createElement("div");
            thumb.className = "fx-thumb";
            var c = document.createElement("canvas");
            c.width = 150;
            c.height = 94;
            var ctx = c.getContext("2d");
            if (look.css && ctx.filter !== undefined) { ctx.filter = look.css; }
            ctx.drawImage(CS.effects.baseScene(150, 94), 0, 0);
            thumb.appendChild(c);
            var name = document.createElement("div");
            name.className = "fx-name";
            name.textContent = look.l;
            card.appendChild(thumb);
            card.appendChild(name);
            card.addEventListener("click", function () {
                var clip = CS.selectedClip();
                if (!clip) { CS.toast("Select a clip on the timeline first"); return; }
                var track = CS.getTrack(clip.trackId);
                if (!track || track.kind !== "video") {
                    CS.toast("Filters apply to clips on video tracks", true);
                    return;
                }
                CS.inspector.applyPreset(clip, look.v);
            });
            grid.appendChild(card);
        });
        CS.panels.refreshFiltersApplied();
    },

    refreshFiltersApplied: function () {
        var clip = CS.selectedClip();
        var current = clip ? (clip.props.preset || "default") : "";
        var cards = document.querySelectorAll("#filters-grid .fx-card");
        for (var i = 0; i < cards.length; i++) {
            cards[i].classList.toggle("applied", cards[i].dataset.preset === current);
        }
    },

    /* ---------- libraries (saved projects) ---------- */

    renderLibraries: function () {
        var list = document.getElementById("libraries-list");
        list.innerHTML = "";
        if (!CS.inArozOS()) {
            var hint = document.createElement("div");
            hint.className = "lib-empty";
            hint.textContent = "Saved projects are listed here when Cine Studio runs inside ArozOS.";
            list.appendChild(hint);
            return;
        }
        var loading = document.createElement("div");
        loading.className = "lib-empty";
        loading.textContent = "Loading projects...";
        list.appendChild(loading);

        ao_module_agirun("Cine Studio/backend/listprojects.js", {}, function (resp) {
            var items;
            try { items = typeof resp === "string" ? JSON.parse(resp) : resp; }
            catch (e) { items = null; }
            list.innerHTML = "";
            if (!items || items.error || !items.length) {
                var empty = document.createElement("div");
                empty.className = "lib-empty";
                empty.textContent = "No saved projects yet. Use Save As to store a project in Cine Studio/Projects.";
                list.appendChild(empty);
                return;
            }
            items.forEach(function (it) {
                var btn = document.createElement("button");
                btn.className = "lib-item";
                btn.innerHTML = '<span data-icon="file"></span><span class="lib-name"></span>';
                btn.querySelector(".lib-name").textContent = it.filename;
                btn.title = it.vpath;
                btn.addEventListener("click", function () {
                    CS.fileio.confirmDiscard(function () {
                        CS.fileio.openFromPath(it.vpath, it.filename);
                    });
                });
                list.appendChild(btn);
            });
            CS.applyIcons(list);
        }, function () {
            list.innerHTML = "";
            var err = document.createElement("div");
            err.className = "lib-empty";
            err.textContent = "Could not list projects.";
            list.appendChild(err);
        });
    }
};
