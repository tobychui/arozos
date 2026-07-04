/*
    Cine Studio - project file I/O

    Native project format: .cine (JSON). Media is stored as ArozOS
    virtual path references; thumbnails, filmstrips and waveforms are
    re-probed when the project is opened. Files are read through the
    /media endpoint and written with ao_module_uploadFile, falling back
    to browser download / picker outside ArozOS.
*/
"use strict";

window.CS = window.CS || {};

CS.fileio = {

    /* ---------- serialization ---------- */

    serializeProject: function () {
        return JSON.stringify({
            app: "CineStudio",
            version: 1,
            name: CS.project.name,
            settings: CS.project.settings,
            media: CS.project.media.map(function (m) {
                return { id: m.id, name: m.name, vpath: m.vpath || "", type: m.type, srcKind: m.srcKind || "" };
            }),
            tracks: CS.project.tracks,
            clips: CS.project.clips,
            markers: CS.project.markers || []
        }, null, 1);
    },

    loadProject: function (data, filepath, filename) {
        if (!data || data.app !== "CineStudio" || !Array.isArray(data.clips)) {
            CS.toast("Not a Cine Studio project file", true);
            return;
        }

        CS.newProject({
            name: data.name || CS.baseName(filename || "My Project"),
            width: (data.settings && data.settings.width) || 1920,
            height: (data.settings && data.settings.height) || 1080,
            fps: (data.settings && data.settings.fps) || 30
        });
        CS.project.filePath = filepath || "";
        CS.project.fileName = filename || "";

        if (Array.isArray(data.tracks) && data.tracks.length) {
            CS.project.tracks = data.tracks;
        }

        //Restore media references and start probing them again
        (data.media || []).forEach(function (m) {
            var media = {
                id: m.id,
                name: m.name,
                vpath: m.vpath || "",
                blobUrl: "",
                compositeUrl: "",
                srcKind: m.srcKind || "",
                type: m.type,
                duration: m.type === "image" ? CS.IMAGE_DEFAULT_DURATION : 0,
                width: 0,
                height: 0,
                thumbs: [],
                peaks: null,
                offline: false,
                probed: false
            };
            CS.project.media.push(media);
            if (media.vpath && CS.inArozOS()) {
                CS.media.probe(media);
            } else if (media.vpath && !CS.inArozOS()) {
                CS.media.markOffline(media);
            } else {
                //Media that was imported from the device without upload
                CS.media.markOffline(media);
            }
        });

        //Restore clips: generated clips (titles / color boards) have no
        //media; anything else must reference a surviving media entry
        CS.project.clips = (data.clips || []).filter(function (c) {
            return c.kind === "title" || c.kind === "color" || CS.getMedia(c.mediaId);
        }).map(function (c) {
            var props = CS.defaultClipProps();
            Object.keys(c.props || {}).forEach(function (k) { props[k] = c.props[k]; });
            c.props = props;
            return c;
        });

        CS.project.markers = Array.isArray(data.markers) ? data.markers : [];

        CS.history = { stack: [], index: -1 };
        CS.pushHistory("Open Project");
        CS.markClean();
        if (CS.session && filepath) {
            CS.session.recordRecent(CS.project.name, filepath);
        }
        CS.player.applyProjectSize();
        CS.media.renderBin();
        CS.timeline.render();
        CS.inspector.render();
        CS.player.invalidate();
        CS.toast("Opened " + (filename || CS.project.name));
    },

    /* ---------- open ---------- */

    confirmDiscard: function (next) {
        if (!CS.state.dirty) { next(); return; }
        CS.confirm("Unsaved changes", "The current project has unsaved changes. Continue and discard them?", next);
    },

    openDialog: function () {
        CS.fileio.confirmDiscard(function () {
            if (CS.inArozOS() && typeof ao_module_openFileSelector !== "undefined") {
                window.csOpenCallback = function csOpenCallback(filedata) {
                    if (!filedata || !filedata.length) { return; }
                    CS.fileio.openFromPath(filedata[0].filepath, filedata[0].filename);
                };
                ao_module_openFileSelector(window.csOpenCallback, CS.APP_ROOT + "/Projects", "file", false, {
                    filter: [CS.PROJECT_EXT]
                });
            } else {
                var inp = document.createElement("input");
                inp.type = "file";
                inp.accept = "." + CS.PROJECT_EXT;
                inp.addEventListener("change", function () {
                    if (!inp.files.length) { return; }
                    inp.files[0].text().then(function (txt) {
                        try { CS.fileio.loadProject(JSON.parse(txt), "", inp.files[0].name); }
                        catch (e) { CS.toast("Invalid project file", true); }
                    });
                });
                inp.click();
            }
        });
    },

    openFromPath: function (filepath, filename) {
        fetch("../media?file=" + encodeURIComponent(filepath))
            .then(function (r) {
                if (!r.ok) { throw new Error("HTTP " + r.status); }
                return r.json();
            })
            .then(function (data) { CS.fileio.loadProject(data, filepath, filename); })
            .catch(function (err) {
                CS.toast("Cannot open project: " + err.message, true);
            });
    },

    //Files passed by the desktop when the app is launched as an opener
    openLaunchFiles: function () {
        var inputFiles = null;
        try {
            if (typeof ao_module_loadInputFiles !== "undefined") {
                inputFiles = ao_module_loadInputFiles();
            }
        } catch (e) { inputFiles = null; }
        if (inputFiles && inputFiles.length > 0) {
            var f = inputFiles[0];
            if (CS.extOf(f.filename) === CS.PROJECT_EXT) {
                CS.fileio.openFromPath(f.filepath, f.filename);
            } else {
                CS.media.addFromVpath(f.filepath, f.filename);
            }
            return true;
        }
        return false;
    },

    /* ---------- save ---------- */

    saveProject: function () {
        //Warn about media that cannot be re-opened later
        var volatile = CS.project.media.filter(function (m) { return !m.vpath; });
        if (volatile.length) {
            CS.toast(volatile.length + " media item(s) are not stored on the server and will be offline when reopened", true);
        }
        if (!CS.project.filePath) { CS.fileio.saveProjectAs(); return; }
        CS.fileio.writeProjectTo(CS.project.filePath, CS.project.fileName);
    },

    saveProjectAs: function () {
        var defaultName = (CS.project.name || "My Project") + "." + CS.PROJECT_EXT;
        if (CS.inArozOS() && typeof ao_module_openFileSelector !== "undefined") {
            window.csSaveAsCallback = function csSaveAsCallback(filedata) {
                if (!filedata || !filedata.length) { return; }
                var f = filedata[0];
                var filepath = f.filepath;
                var filename = f.filename;
                if (CS.extOf(filename) !== CS.PROJECT_EXT) {
                    filename += "." + CS.PROJECT_EXT;
                    filepath += "." + CS.PROJECT_EXT;
                }
                CS.fileio.writeProjectTo(filepath, filename);
            };
            ao_module_openFileSelector(window.csSaveAsCallback, CS.APP_ROOT + "/Projects", "new", false, {
                defaultName: defaultName
            });
        } else {
            var blob = new Blob([CS.fileio.serializeProject()], { type: "application/json" });
            CS.fileio.downloadBlob(blob, defaultName);
            CS.markClean();
        }
    },

    writeProjectTo: function (filepath, filename) {
        var blob = new Blob([CS.fileio.serializeProject()], { type: "application/json" });
        var file = new File([blob], filename, { type: "application/json" });
        try {
            ao_module_uploadFile(file, CS.dirOf(filepath), function () {
                CS.project.filePath = filepath;
                CS.project.fileName = filename;
                CS.project.name = CS.baseName(filename);
                CS.markClean();
                if (CS.session) { CS.session.recordRecent(CS.project.name, filepath); }
                CS.toast("Saved " + filename);
            }, undefined, function () {
                CS.toast("Save failed - check permissions", true);
            });
        } catch (e) {
            CS.fileio.downloadBlob(blob, filename);
            CS.markClean();
        }
    },

    downloadBlob: function (blob, filename) {
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    },

    /* ---------- project dialogs ---------- */

    newProjectDialog: function () {
        CS.fileio.confirmDiscard(function () {
            var nameIn, resIn, fpsIn;
            CS.modal({
                title: "New Project",
                build: function (body) {
                    nameIn = CS.modalRow(body, "Name", CS.textInput("My Project"));
                    resIn = CS.modalRow(body, "Resolution", CS.selectInput([
                        { v: "1920x1080", l: "1920 x 1080 (Full HD)" },
                        { v: "1280x720", l: "1280 x 720 (HD)" },
                        { v: "3840x2160", l: "3840 x 2160 (4K)" },
                        { v: "1080x1920", l: "1080 x 1920 (Vertical)" },
                        { v: "1080x1080", l: "1080 x 1080 (Square)" }
                    ], "1920x1080"));
                    fpsIn = CS.modalRow(body, "Frame rate", CS.selectInput([
                        { v: "24", l: "24 fps" },
                        { v: "25", l: "25 fps" },
                        { v: "30", l: "30 fps" },
                        { v: "60", l: "60 fps" }
                    ], "30"));
                },
                buttons: [
                    { label: "Cancel" },
                    {
                        label: "Create", primary: true,
                        action: function () {
                            var res = resIn.value.split("x");
                            CS.newProject({
                                name: nameIn.value.trim() || "My Project",
                                width: parseInt(res[0], 10),
                                height: parseInt(res[1], 10),
                                fps: parseInt(fpsIn.value, 10)
                            });
                            CS.player.applyProjectSize();
                            CS.media.renderBin();
                            CS.timeline.render();
                            CS.inspector.render();
                            CS.player.invalidate();
                            CS.updateSaveState();
                        }
                    }
                ]
            });
        });
    },

    renameDialog: function () {
        var nameIn;
        CS.modal({
            title: "Rename Project",
            build: function (body) {
                nameIn = CS.modalRow(body, "Name", CS.textInput(CS.project.name));
            },
            buttons: [
                { label: "Cancel" },
                {
                    label: "Rename", primary: true,
                    action: function () {
                        var v = nameIn.value.trim();
                        if (v) {
                            CS.project.name = v;
                            CS.markDirty();
                        }
                    }
                }
            ]
        });
    },

    settingsDialog: function () {
        var wIn, hIn, fpsIn;
        CS.modal({
            title: "Project Settings",
            build: function (body) {
                wIn = CS.modalRow(body, "Width (px)", CS.textInput(String(CS.project.settings.width)));
                hIn = CS.modalRow(body, "Height (px)", CS.textInput(String(CS.project.settings.height)));
                fpsIn = CS.modalRow(body, "Frame rate", CS.selectInput([
                    { v: "24", l: "24 fps" },
                    { v: "25", l: "25 fps" },
                    { v: "30", l: "30 fps" },
                    { v: "60", l: "60 fps" }
                ], String(CS.project.settings.fps)));
            },
            buttons: [
                { label: "Cancel" },
                {
                    label: "Apply", primary: true,
                    action: function () {
                        CS.project.settings.width = CS.clamp(parseInt(wIn.value, 10) || 1920, 16, 7680);
                        CS.project.settings.height = CS.clamp(parseInt(hIn.value, 10) || 1080, 16, 4320);
                        CS.project.settings.fps = parseInt(fpsIn.value, 10) || 30;
                        CS.player.applyProjectSize();
                        CS.markDirty();
                        CS.player.invalidate();
                    }
                }
            ]
        });
    },

    projectMenu: function (anchorEl) {
        CS.showMenuUnder(anchorEl, [
            { label: "New Project...", icon: "file", action: CS.fileio.newProjectDialog },
            { label: "Open Project...", icon: "folder", action: CS.fileio.openDialog },
            { label: "Open Recent", icon: "history", action: function () {
                CS.session.openRecentMenu(anchorEl);
            } },
            { sep: true },
            { label: "Save", icon: "save", action: CS.fileio.saveProject },
            { label: "Save As...", icon: "save", action: CS.fileio.saveProjectAs },
            { sep: true },
            { label: "Rename...", icon: "nav-text", action: CS.fileio.renameDialog },
            { label: "Project Settings...", icon: "gear", action: CS.fileio.settingsDialog }
        ]);
    }
};
