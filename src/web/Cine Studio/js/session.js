/*
    Cine Studio - session safety: auto-save / crash recovery and the
    recent projects list. Snapshots live in localStorage (projects are
    small: media is stored as virtual-path references).
*/
"use strict";

window.CS = window.CS || {};

CS.session = {
    AUTOSAVE_KEY: "cinestudio_autosave",
    RECENT_KEY: "cinestudio_recent",
    INTERVAL_MS: 20000,

    init: function () {
        setInterval(function () {
            if (CS.state.dirty) { CS.session.saveSnapshot(); }
        }, CS.session.INTERVAL_MS);
        window.addEventListener("beforeunload", function () {
            if (CS.state.dirty) { CS.session.saveSnapshot(); }
        });
    },

    /* ---------- auto-save snapshot ---------- */

    saveSnapshot: function () {
        try {
            localStorage.setItem(CS.session.AUTOSAVE_KEY, JSON.stringify({
                when: Date.now(),
                name: CS.project.name,
                filePath: CS.project.filePath,
                fileName: CS.project.fileName,
                data: JSON.parse(CS.fileio.serializeProject())
            }));
        } catch (e) { /* storage full or blocked: recovery just unavailable */ }
    },

    clearSnapshot: function () {
        try { localStorage.removeItem(CS.session.AUTOSAVE_KEY); } catch (e) {}
    },

    //Offer to restore an unsaved session left behind by a crash / close
    checkRecovery: function () {
        var raw = null;
        try { raw = localStorage.getItem(CS.session.AUTOSAVE_KEY); } catch (e) {}
        if (!raw) { return; }
        var snap;
        try { snap = JSON.parse(raw); } catch (e) { CS.session.clearSnapshot(); return; }
        if (!snap || !snap.data) { CS.session.clearSnapshot(); return; }

        var age = Math.max(1, Math.round((Date.now() - snap.when) / 60000));
        CS.modal({
            title: "Restore unsaved project?",
            build: function (body) {
                var p = document.createElement("div");
                p.className = "modal-note";
                p.style.fontSize = "12.5px";
                p.style.color = "var(--text-dim)";
                p.textContent = "An auto-saved copy of \"" + (snap.name || "Untitled") +
                    "\" from about " + age + " minute" + (age === 1 ? "" : "s") +
                    " ago was found. Restore it?";
                body.appendChild(p);
            },
            buttons: [
                {
                    label: "Discard", action: function () {
                        CS.session.clearSnapshot();
                    }
                },
                {
                    label: "Restore", primary: true,
                    action: function () {
                        CS.fileio.loadProject(snap.data, snap.filePath || "", snap.fileName || "");
                        CS.project.name = snap.name || CS.project.name;
                        CS.markDirty(); //restored content is not on disk yet
                    }
                }
            ]
        });
    },

    /* ---------- recent projects ---------- */

    recents: function () {
        try {
            return JSON.parse(localStorage.getItem(CS.session.RECENT_KEY)) || [];
        } catch (e) { return []; }
    },

    recordRecent: function (name, vpath) {
        if (!vpath) { return; }
        var list = CS.session.recents().filter(function (r) { return r.vpath !== vpath; });
        list.unshift({ name: name, vpath: vpath, when: Date.now() });
        list = list.slice(0, 8);
        try { localStorage.setItem(CS.session.RECENT_KEY, JSON.stringify(list)); } catch (e) {}
    },

    openRecentMenu: function (anchorEl) {
        var list = CS.session.recents();
        if (!list.length) { CS.toast("No recent projects yet"); return; }
        var items = list.map(function (r) {
            return {
                label: r.name || r.vpath.split("/").pop(),
                icon: "file",
                action: function () {
                    CS.fileio.confirmDiscard(function () {
                        CS.fileio.openFromPath(r.vpath, r.vpath.split("/").pop());
                    });
                }
            };
        });
        items.push({ sep: true });
        items.push({
            label: "Clear recent list", icon: "trash", action: function () {
                try { localStorage.removeItem(CS.session.RECENT_KEY); } catch (e) {}
            }
        });
        CS.showMenuUnder(anchorEl, items);
    }
};
