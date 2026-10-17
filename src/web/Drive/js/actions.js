/*
    actions.js

    Everything the user can do to an item, and the menus that offer it:
    open / open with, download, move and copy, rename, trash (with undo),
    restore, star, compress, extract, clipboard and new items.
*/

(function (global) {
    "use strict";

    var I = DriveUI.I;
    var esc = DriveUI.esc;
    var API = DriveAPI;

    function S() {
        return Drive.state;
    }

    function view() {
        return S().view || {};
    }

    function plural(n, one, many, key) {
        return T(n == 1 ? key + "1" : key, n == 1 ? one : many, { n: n });
    }

    function copyText(text) {
        if (navigator.clipboard && window.isSecureContext) {
            return navigator.clipboard.writeText(text);
        }
        return new Promise(function (resolve, reject) {
            var ta = document.createElement("textarea");
            ta.value = text;
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.select();
            try {
                document.execCommand("copy") ? resolve() : reject(new Error("copy failed"));
            } catch (e) {
                reject(e);
            }
            ta.remove();
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Openers                                                            */
    /* ------------------------------------------------------------------ */
    function extOf(item) {
        return DriveIcons.getExt(item.name);
    }

    function launchURL(mod) {
        if (mod.SupportEmb && mod.LaunchEmb) {
            return mod.LaunchEmb;
        }
        if (mod.SupportFW && mod.LaunchFWDir) {
            return mod.LaunchFWDir;
        }
        return mod.StartDir;
    }

    function fileHash(items) {
        return "#" + encodeURIComponent(JSON.stringify(items.map(function (i) {
            return { filename: i.name, filepath: i.path };
        })));
    }

    //Modules the user may open that registered this extension
    function compatibleModules(item) {
        var ext = "." + extOf(item);
        if (ext == ".") {
            return [];
        }
        return S().modules.filter(function (m) {
            if (!m.SupportedExt || m.Group == "Interface Module" || m.Name == "Trash Bin") {
                return false;
            }
            if (!launchURL(m)) {
                return false;
            }
            return m.SupportedExt.some(function (e) { return String(e).toLowerCase() == ext; });
        }).sort(function (a, b) { return a.Name.localeCompare(b.Name); });
    }

    function defaultModuleFor(item) {
        var ext = "." + extOf(item);
        return API.defaultOpener(ext).then(function (info) {
            if (info && info.Name && Drive.module(info.Name)) {
                return Drive.module(info.Name);
            }
            var list = compatibleModules(item);
            return list.length == 1 ? list[0] : null;
        });
    }

    function openWithModule(item, mod) {
        API.recentAdd(item.path);
        DriveHost.open({
            url: launchURL(mod) + fileHash([item]),
            title: mod.Name,
            icon: mod.IconPath,
            appName: mod.Name
        });
    }

    function openShortcut(item) {
        API.readText(item.path).then(function (text) {
            var lines = String(text).replace(/\r\n/g, "\n").trim().split("\n");
            var type = lines[0], name = lines[1], target = lines[2], icon = lines[3];
            if (type == "folder") {
                location.hash = Drive.folderRoute(target);
            } else if (type == "module") {
                var m = Drive.module(target);
                if (m) {
                    DriveHost.openModule(m.Name);
                } else {
                    DriveUI.toast(T("err/noModule", "You do not have access to {name}", { name: target }), { type: "error" });
                }
            } else if (type == "url") {
                DriveHost.open({ url: target, title: name, icon: icon });
            } else if (type == "app") {
                window.open(API.ROOT + "app/" + encodeURIComponent(target) + "/");
            } else {
                DrivePreview.open(item);
            }
        }).catch(DriveUI.error);
    }

    function open(item) {
        if (!item) {
            return;
        }
        var v = view();
        if (item.trashed) {
            if (!item.isDir) {
                DrivePreview.open(item);
            }
            return;
        }
        if (item.shareOnly) {
            DriveHost.open({ url: "/share/" + item.share.UUID, title: item.name, icon: "img/system/favicon.png" });
            return;
        }
        if (item.isDir) {
            location.hash = Drive.folderRoute(item.path);
            return;
        }
        if (extOf(item) == "shortcut") {
            openShortcut(item);
            return;
        }
        if (S().settings.openIn == "tab") {
            openInNewTab(item);
            return;
        }
        defaultModuleFor(item).then(function (mod) {
            if (mod) {
                openWithModule(item, mod);
            } else if (DrivePreview.canPreview(item)) {
                API.recentAdd(item.path);
                DrivePreview.open(item);
            } else {
                openWithChooser(item);
            }
        });
        if (v.kind == "recent") {
            //Bump the item in the open history without a full reload
            item.activity = Math.floor(Date.now() / 1000);
            item.openedLast = true;
        }
    }

    function openInNewTab(item) {
        if (item.isDir) {
            window.open(location.pathname + Drive.folderRoute(item.path), "_blank");
            return;
        }
        if (item.shareOnly) {
            window.open("/share/" + item.share.UUID, "_blank");
            return;
        }
        API.recentAdd(item.path);
        defaultModuleFor(item).then(function (mod) {
            if (mod) {
                window.open(API.ROOT + launchURL(mod) + fileHash([item]), "_blank");
            } else {
                window.open(API.mediaURL(item.path), "_blank");
            }
        });
    }

    function openWithItems(item) {
        var mods = compatibleModules(item);
        var list = mods.map(function (m) {
            return { img: API.ROOT + m.IconPath, label: m.Name, action: function () { openWithModule(item, m); } };
        });
        if (DrivePreview.canPreview(item)) {
            list.unshift({ icon: "eye", label: T("open/preview", "Drive preview"), action: function () { DrivePreview.open(item); } });
        }
        list.push("-", { icon: "apps", label: T("open/choose", "Choose another app..."), action: function () { openWithChooser(item); } });
        return list;
    }

    function openWithChooser(item) {
        var ext = extOf(item);
        var mods = compatibleModules(item);
        var all = S().modules.filter(function (m) {
            return launchURL(m) && m.Group != "Interface Module" && mods.indexOf(m) < 0 && m.SupportedExt && m.SupportedExt.length;
        }).sort(function (a, b) { return a.Name.localeCompare(b.Name); });
        var body = DriveUI.el('<div></div>');
        function row(m, idx) {
            return '<button class="picker-item" data-mod="' + esc(m.Name) + '"><img src="' + esc(API.ROOT + m.IconPath) + '" alt="" style="width:26px;height:26px;object-fit:contain">' +
                '<span>' + esc(m.Name) + '<small class="muted" style="display:block;font-size:12px">' + esc(m.Desc || m.Group || "") + '</small></span></button>';
        }
        var html = "";
        if (mods.length) {
            html += '<div class="field-label" style="margin-bottom:6px">' + esc(T("open/suggested", "Suggested apps")) + '</div><div class="list-plain" style="margin-bottom:14px">' + mods.map(row).join("") + '</div>';
        } else {
            html += '<p>' + esc(T("open/noApp", "No installed app registered .{ext} files. You can still preview, download, or try another app.", { ext: ext })) + '</p>';
        }
        if (all.length) {
            html += '<details><summary class="field-label" style="cursor:pointer;margin-bottom:6px">' + esc(T("open/otherApps", "Other apps")) + '</summary><div class="list-plain scroll-y" style="max-height:220px">' + all.map(row).join("") + '</div></details>';
        }
        if (ext) {
            html += '<label class="toggle-row" style="margin:16px 0 0"><span>' + esc(T("open/always", "Always open .{ext} files with the selected app", { ext: ext })) +
                '</span><span class="switch"><input type="checkbox" id="openAlways"><span></span></span></label>';
        }
        body.innerHTML = html;
        var ctx = DriveUI.modal({
            title: T("open/withTitle", "Open \"{name}\" with", { name: item.name }),
            iconHTML: DriveIcons.file(item.name, false),
            body: body,
            footLeft: DrivePreview.canPreview(item) ? '<button class="btn ghost small" id="owPreview">' + I("eye") + esc(T("open/preview", "Drive preview")) + '</button>' : "",
            buttons: [
                { label: T("toolbar/download", "Download"), action: function () { download([item]); } },
                { label: T("common/cancel", "Cancel") }
            ]
        });
        body.querySelectorAll("[data-mod]").forEach(function (b) {
            b.addEventListener("click", function () {
                var m = Drive.module(b.getAttribute("data-mod"));
                var always = body.querySelector("#openAlways");
                if (always && always.checked && ext) {
                    API.setDefaultOpener("." + ext, m.Name).catch(DriveUI.error);
                }
                ctx.close();
                openWithModule(item, m);
            });
        });
        var pv = ctx.node.querySelector("#owPreview");
        if (pv) {
            pv.addEventListener("click", function () {
                ctx.close();
                DrivePreview.open(item);
            });
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Download and links                                                 */
    /* ------------------------------------------------------------------ */
    function download(items) {
        items = (items || []).filter(function (i) { return i && !i.shareOnly; });
        if (!items.length) {
            return;
        }
        if (items.length == 1 && !items[0].isDir) {
            DriveTransfers.saveURL(API.downloadURL(items[0].path), items[0].name);
            return;
        }
        if (!API.caps.fm) {
            var files = items.filter(function (i) { return !i.isDir; });
            if (files.length < items.length) {
                DriveUI.toast(T("err/zipNeedFM", "Folders can only be downloaded as a zip with the File Manager permission"), { type: "error" });
            }
            files.forEach(function (f, idx) {
                setTimeout(function () { DriveTransfers.saveURL(API.downloadURL(f.path), f.name); }, idx * 400);
            });
            return;
        }
        DriveTransfers.zipDownload(items);
    }

    function activeShare(info) {
        var list = (info && info.Shares) || [];
        for (var i = 0; i < list.length; i++) {
            if (!list[i].IsExpired) {
                return list[i];
            }
        }
        return null;
    }

    function copyLink(item) {
        if (item.share && item.share.UUID) {
            copyText(API.shareURL(item.share.UUID)).then(function () {
                DriveUI.toast(T("share/copied", "Link copied"), { type: "success" });
            }).catch(DriveUI.error);
            return;
        }
        API.shareInfo(item.path).then(function (info) {
            var share = activeShare(info);
            if (share) {
                return share;
            }
            if (info && info.CanManage === false) {
                throw new Error(T("share/notOwnerShort", "This item is shared by someone else"));
            }
            return API.shareCreate(item.path, { permission: "anyone" });
        }).then(function (share) {
            var url = API.shareURL(share.UUID || share.uuid);
            return copyText(url).then(function () {
                DriveUI.toast(T("share/linkCopied", "Link copied. Anyone with the link can view."), {
                    type: "success",
                    action: { label: T("share/manage", "Manage"), fn: function () { DriveShare.open(item); } }
                });
                if (!item.shared) {
                    item.shared = true;
                    DriveList.render();
                }
            });
        }).catch(DriveUI.error);
    }

    function copyPath(item) {
        copyText(item.path).then(function () {
            DriveUI.toast(T("misc/pathCopied", "Path copied"), { type: "success" });
        }).catch(DriveUI.error);
    }

    /* ------------------------------------------------------------------ */
    /*  Move and copy                                                      */
    /* ------------------------------------------------------------------ */
    function askConflict(dupes, total) {
        return new Promise(function (resolve) {
            var answered = false;
            var names = dupes.slice(0, 8).map(function (p) {
                return '<div>' + DriveIcons.file(API.baseName(p), false) + '<span>' + esc(API.baseName(p)) + '</span></div>';
            }).join("") + (dupes.length > 8 ? '<div class="muted">+ ' + (dupes.length - 8) + '</div>' : "");
            DriveUI.modal({
                title: T("conflict/title", "Some items already exist"),
                icon: "alert",
                body: '<p>' + esc(T("conflict/text", "{n} of {total} items have the same name as items in the destination.", { n: dupes.length, total: total })) + '</p><div class="name-list">' + names + '</div>',
                buttons: [
                    { label: T("conflict/skip", "Skip"), action: function () { answered = true; resolve("skip"); } },
                    { label: T("conflict/replace", "Replace"), action: function () { answered = true; resolve("overwrite"); } },
                    { label: T("conflict/keep", "Keep both"), cls: "primary", action: function () { answered = true; resolve("keep"); } }
                ],
                onClose: function () {
                    if (!answered) {
                        resolve(null);
                    }
                }
            });
        });
    }

    function transfer(items, dest, mode) {
        dest = Drive.normDir(dest);
        items = items.filter(Boolean);
        if (mode == "move") {
            items = items.filter(function (i) {
                return Drive.normDir(API.parentOf(i.path)) != dest;
            });
        }
        if (!items.length) {
            return Promise.resolve();
        }
        for (var i = 0; i < items.length; i++) {
            if (items[i].isDir && dest.indexOf(Drive.normDir(items[i].path)) == 0) {
                DriveUI.toast(T("err/intoItself", "A folder cannot be moved into itself"), { type: "error" });
                return Promise.resolve();
            }
        }
        if (!Drive.isWritable(dest)) {
            DriveUI.toast(T("err/readonly", "This location is read only"), { type: "error" });
            return Promise.resolve();
        }
        var paths = items.map(function (i) { return i.path; });
        return API.duplicates(paths, dest).catch(function () { return []; }).then(function (dupes) {
            if (dupes && dupes.length) {
                return askConflict(dupes, items.length);
            }
            return "keep";
        }).then(function (resp) {
            if (!resp) {
                return;
            }
            var label = Drive.pathParts(dest);
            label = label[label.length - 1].label;
            return DriveTransfers.operation(mode, items, dest, resp, {
                doneText: mode == "move" ? T("xfer/movedTo", "Moved to {name}", { name: label }) : T("xfer/copiedTo", "Copied to {name}", { name: label })
            }).then(function () {
                if (mode == "move") {
                    //Keep stars on the items that moved
                    var moved = paths.filter(function (p) { return S().starred.has(p); });
                    if (moved.length) {
                        var renamed = moved.map(function (p) { return API.joinPath(dest, API.baseName(p)); });
                        API.star(moved, false).then(function () { return API.star(renamed, true); }).then(function (list) {
                            S().starred = new Set(list || []);
                        }).catch(function () { });
                    }
                }
                DriveUI.toast(mode == "move" ? plural(items.length, "Moved 1 item to {name}", "Moved {n} items to {name}", "toast/moved").replace("{name}", label) :
                    plural(items.length, "Copied 1 item to {name}", "Copied {n} items to {name}", "toast/copied").replace("{name}", label), {
                    type: "success",
                    action: Drive.normDir(view().path || "") != dest ? { label: T("toast/show", "Show"), fn: function () { location.hash = Drive.folderRoute(dest); } } : null
                });
            }).catch(function (err) {
                DriveUI.error(err);
            });
        });
    }

    function startFolder() {
        var v = view();
        if (v.kind == "drive") {
            return v.path;
        }
        return null;
    }

    function moveTo(items) {
        items = items || Drive.selectedItems();
        if (!items.length) {
            return;
        }
        DriveUI.pickFolder({
            title: items.length == 1 ? T("move/titleOne", "Move \"{name}\"", { name: items[0].name }) : T("move/title", "Move {n} items", { n: items.length }),
            okLabel: T("move/here", "Move here"), icon: "move", start: startFolder(),
            sources: items.filter(function (i) { return i.isDir; }).map(function (i) { return i.path; })
        }).then(function (dest) {
            if (dest) {
                transfer(items, dest, "move");
            }
        });
    }

    function copyTo(items) {
        items = items || Drive.selectedItems();
        if (!items.length) {
            return;
        }
        DriveUI.pickFolder({
            title: items.length == 1 ? T("copy/titleOne", "Copy \"{name}\"", { name: items[0].name }) : T("copy/title", "Copy {n} items", { n: items.length }),
            okLabel: T("copy/here", "Copy here"), icon: "copy", start: startFolder(),
            sources: items.filter(function (i) { return i.isDir; }).map(function (i) { return i.path; })
        }).then(function (dest) {
            if (dest) {
                transfer(items, dest, "copy");
            }
        });
    }

    function duplicate(items) {
        items = items.filter(function (i) { return !i.isDir; });
        if (!items.length) {
            DriveUI.toast(T("err/copyFolder", "Use Copy to... for folders"), { type: "error" });
            return;
        }
        var parent = API.parentOf(items[0].path);
        DriveTransfers.operation("copy", items, parent, "keep", { doneText: T("xfer/copyMade", "Copy created") }).then(function () {
            DriveUI.toast(plural(items.length, "Made a copy", "Made {n} copies", "toast/duplicated"), { type: "success" });
        }).catch(DriveUI.error);
    }

    /* Clipboard -------------------------------------------------------------- */
    function clipboard(mode, items) {
        S().clipboard = { mode: mode, paths: items.map(function (i) { return i.path; }), items: items.slice() };
        DriveList.render();
        DriveUI.toast(mode == "cut" ? plural(items.length, "1 item cut. Paste it in another folder.", "{n} items cut. Paste them in another folder.", "toast/cut") :
            plural(items.length, "1 item copied to the clipboard", "{n} items copied to the clipboard", "toast/clip"));
    }

    function paste(target) {
        var clip = S().clipboard;
        var v = view();
        target = target || (v.kind == "drive" ? v.path : null);
        if (!clip || !target) {
            return;
        }
        var mode = clip.mode == "cut" ? "move" : "copy";
        if (mode == "move") {
            S().clipboard = null;
        }
        transfer(clip.items, target, mode);
    }

    /* ------------------------------------------------------------------ */
    /*  Rename, trash, delete, restore                                     */
    /* ------------------------------------------------------------------ */
    function commitRename(item, newName) {
        if (/[\/\\]/.test(newName)) {
            DriveUI.toast(T("err/badName", "Names cannot contain / or \\"), { type: "error" });
            DriveList.render();
            return;
        }
        var oldPath = item.path;
        API.rename(oldPath, newName).then(function () {
            var newPath = API.joinPath(API.parentOf(oldPath), newName);
            if (S().starred.has(oldPath)) {
                API.star([oldPath], false).then(function () { return API.star([newPath], true); }).then(function (list) {
                    S().starred = new Set(list || []);
                }).catch(function () { });
            }
            if (item.isCurrentFolder) {
                location.hash = Drive.folderRoute(newPath);
                return;
            }
            Drive.setSelection([newPath], { anchor: newPath, focus: newPath });
            Drive.refresh();
            DriveUI.toast(T("toast/renamed", "Renamed to {name}", { name: newName }), { type: "success" });
        }).catch(function (err) {
            DriveUI.error(err);
            DriveList.render();
        });
    }

    function rename(item) {
        if (!item || item.trashed || item.shareOnly) {
            return;
        }
        if (!Drive.isWritable(item.path)) {
            DriveUI.toast(T("err/readonly", "This location is read only"), { type: "error" });
            return;
        }
        if (!item.isCurrentFolder && DriveList.startRename(item, function (v) { commitRename(item, v); })) {
            return;
        }
        DriveUI.prompt({
            title: T("menu/rename", "Rename"), label: T("prompt/newName", "New name"), value: item.name,
            selectStem: !item.isDir, ok: T("menu/rename", "Rename")
        }).then(function (name) {
            if (name && name != item.name) {
                commitRename(item, name);
            }
        });
    }

    function undoTrash(items) {
        API.trashList().then(function (list) {
            var jobs = items.map(function (it) {
                var parent = Drive.normDir(API.parentOf(it.path));
                var match = list.filter(function (t) {
                    return t.name == it.name && Drive.normDir(t.origin || "") == parent;
                }).sort(function (a, b) { return b.mtime - a.mtime; })[0];
                return match ? API.trashRestore(match.path) : Promise.resolve();
            });
            return Promise.all(jobs);
        }).then(function () {
            DriveUI.toast(T("toast/restored", "Restored"), { type: "success" });
            Drive.refresh();
        }).catch(DriveUI.error);
    }

    function trash(items) {
        items = (items || []).filter(function (i) { return !i.trashed && !i.shareOnly && !i.isRoot; });
        if (!items.length || view().kind == "shared") {
            return;
        }
        if (items.some(function (i) { return !Drive.isWritable(i.path); })) {
            DriveUI.toast(T("err/readonly", "This location is read only"), { type: "error" });
            return;
        }
        var permanent = !API.caps.fm;
        var ask = permanent || S().settings.confirmTrash ? DriveUI.confirm({
            title: permanent ? T("delete/title", "Delete forever?") : T("trash/confirmTitle", "Move to trash?"),
            message: permanent ? T("delete/reducedText", "Deleted items cannot be restored in limited mode.") :
                plural(items.length, "\"{name}\" will be moved to the trash.", "{n} items will be moved to the trash.", "trash/confirmText").replace("{name}", items[0].name),
            ok: permanent ? T("delete/ok", "Delete forever") : T("trash/move", "Move to trash"), danger: true
        }) : Promise.resolve(true);
        ask.then(function (ok) {
            if (!ok) {
                return;
            }
            var paths = items.map(function (i) { return i.path; });
            API.recycle(paths).then(function () {
                Drive.setSelection([]);
                Drive.refresh();
                Drive.refreshQuota();
                if (permanent) {
                    DriveUI.toast(plural(items.length, "Deleted 1 item", "Deleted {n} items", "toast/deleted"), { type: "success" });
                } else {
                    DriveUI.toast(plural(items.length, "Moved 1 item to the trash", "Moved {n} items to the trash", "toast/trashed"), {
                        type: "success", timeout: 7000,
                        action: { label: T("toast/undo", "Undo"), fn: function () { undoTrash(items); } }
                    });
                }
            }).catch(function (err) {
                if (err.message == "TRASH_QUOTA_EXCEEDED" || /Incompatible File System/i.test(err.message)) {
                    DriveUI.confirm({
                        title: T("trash/fullTitle", "Cannot move to trash"),
                        message: err.message == "TRASH_QUOTA_EXCEEDED" ? T("trash/fullText", "The trash is full. Delete these items forever instead?") :
                            T("trash/unsupported", "This storage has no trash. Delete these items forever instead?"),
                        ok: T("delete/ok", "Delete forever"), danger: true
                    }).then(function (yes) {
                        if (yes) {
                            removeNow(items);
                        }
                    });
                } else {
                    DriveUI.error(err);
                }
            });
        });
    }

    function removeNow(items) {
        API.remove(items.map(function (i) { return i.path; })).then(function () {
            Drive.setSelection([]);
            Drive.refresh();
            Drive.refreshQuota();
            DriveUI.toast(plural(items.length, "Deleted 1 item", "Deleted {n} items", "toast/deleted"), { type: "success" });
        }).catch(DriveUI.error);
    }

    function deleteForever(items) {
        items = (items || []).filter(function (i) { return !i.shareOnly && !i.isRoot; });
        if (!items.length || view().kind == "shared") {
            return;
        }
        DriveUI.confirm({
            title: T("delete/title", "Delete forever?"),
            message: plural(items.length, "\"{name}\" will be deleted forever. This cannot be undone.", "{n} items will be deleted forever. This cannot be undone.", "delete/text").replace("{name}", items[0].name),
            ok: T("delete/ok", "Delete forever"), danger: true
        }).then(function (ok) {
            if (ok) {
                removeNow(items);
            }
        });
    }

    function restore(items) {
        items = (items || []).filter(function (i) { return i.trashed; });
        if (!items.length) {
            return;
        }
        items.reduce(function (p, it) {
            return p.then(function () { return API.trashRestore(it.path); });
        }, Promise.resolve()).then(function () {
            Drive.setSelection([]);
            Drive.refresh();
            DriveUI.toast(plural(items.length, "Restored 1 item", "Restored {n} items", "toast/restoredN"), {
                type: "success",
                action: items.length == 1 && items[0].origin ? { label: T("toast/show", "Show"), fn: function () { location.hash = Drive.folderRoute(items[0].origin); } } : null
            });
        }).catch(DriveUI.error);
    }

    function emptyTrash() {
        DriveUI.confirm({
            title: T("trash/emptyTitle", "Empty trash?"),
            message: T("trash/emptyText", "All items in the trash will be deleted forever. This cannot be undone."),
            ok: T("trash/empty", "Empty trash"), danger: true
        }).then(function (ok) {
            if (!ok) {
                return;
            }
            API.trashClear().then(function () {
                Drive.refresh();
                Drive.refreshQuota();
                DriveUI.toast(T("toast/trashEmptied", "Trash emptied"), { type: "success" });
            }).catch(DriveUI.error);
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Star, compress, extract                                            */
    /* ------------------------------------------------------------------ */
    function star(items, on) {
        var paths = items.map(function (i) { return i.path; });
        API.star(paths, on).then(function (list) {
            S().starred = new Set(list || []);
            if (view().kind == "starred" && !on) {
                Drive.refresh();
            } else {
                DriveList.render();
                DriveDetails.refresh();
            }
            DriveUI.toast(on ? plural(items.length, "Added to Starred", "Added {n} items to Starred", "toast/starred") :
                plural(items.length, "Removed from Starred", "Removed {n} items from Starred", "toast/unstarred"));
        }).catch(DriveUI.error);
    }

    function allStarred(items) {
        return items.length > 0 && items.every(function (i) { return S().starred.has(i.path); });
    }

    function zip(items) {
        if (!API.caps.fm) {
            DriveUI.toast(T("err/needFM", "This action needs the File Manager permission"), { type: "error" });
            return;
        }
        var dest = API.parentOf(items[0].path);
        DriveTransfers.operation("zip", items, dest, "keep", { doneText: T("xfer/zipped", "Archive created") }).catch(function () { });
    }

    function isArchive(item) {
        return !item.isDir && ["zip"].indexOf(DriveIcons.getExt(item.name)) >= 0;
    }

    function unzip(item) {
        if (!API.caps.fm) {
            DriveUI.toast(T("err/needFM", "This action needs the File Manager permission"), { type: "error" });
            return;
        }
        var dest = API.parentOf(item.path);
        DriveTransfers.operation("unzip", [item], dest, "keep", { doneText: T("xfer/extracted", "Extracted") }).catch(function () { });
    }

    /* ------------------------------------------------------------------ */
    /*  New items and uploads                                              */
    /* ------------------------------------------------------------------ */
    function freeName(base, ext) {
        var names = {};
        S().items.forEach(function (i) { names[i.name.toLowerCase()] = true; });
        var candidate = base + (ext ? "." + ext : "");
        var n = 2;
        while (names[candidate.toLowerCase()]) {
            candidate = base + " (" + n + ")" + (ext ? "." + ext : "");
            n++;
        }
        return candidate;
    }

    function targetFolder() {
        var v = view();
        return v.kind == "drive" && v.writable ? v.path : null;
    }

    function newFolder() {
        var dir = targetFolder();
        if (!dir) {
            return;
        }
        DriveUI.prompt({
            title: T("toolbar/newFolder", "New folder"), label: T("prompt/folderName", "Folder name"),
            value: freeName(T("prompt/untitledFolder", "Untitled folder")), icon: "folderPlus", ok: T("common/create", "Create")
        }).then(function (name) {
            if (!name) {
                return;
            }
            API.mkdir(dir, name).then(function () {
                var p = API.joinPath(dir, name);
                Drive.setSelection([p], { anchor: p, focus: p });
                Drive.refresh();
            }).catch(DriveUI.error);
        });
    }

    function newFile(tpl) {
        var dir = targetFolder();
        if (!dir) {
            return;
        }
        DriveUI.prompt({
            title: T("new/fileTitle", "New {type}", { type: tpl.Desc }), label: T("prompt/fileName", "File name"),
            value: freeName(T("new/untitled", "Untitled"), tpl.Ext), selectStem: true, icon: "filePlus", ok: T("common/create", "Create")
        }).then(function (name) {
            if (!name) {
                return;
            }
            if (tpl.Ext && name.toLowerCase().lastIndexOf("." + tpl.Ext.toLowerCase()) != name.length - tpl.Ext.length - 1) {
                name += "." + tpl.Ext;
            }
            API.newFile(dir, name).then(function () {
                var p = API.joinPath(dir, name);
                Drive.setSelection([p], { anchor: p, focus: p });
                Drive.refresh();
                DriveUI.toast(T("toast/created", "Created {name}", { name: name }), {
                    type: "success", action: { label: T("toast/open", "Open"), fn: function () { open({ name: name, path: p, isDir: false, size: 0, mtime: 0 }); } }
                });
            }).catch(DriveUI.error);
        });
    }

    var templateCache = null;
    function templateItems() {
        var p = templateCache ? Promise.resolve(templateCache) : API.templates().then(function (list) {
            templateCache = list || [];
            return templateCache;
        });
        return p.then(function (list) {
            return list.map(function (tpl) {
                return { img: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(DriveIcons.file("x." + tpl.Ext, false).replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ')), label: tpl.Desc, hint: "." + tpl.Ext, action: function () { newFile(tpl); } };
            });
        }).catch(function () { return []; });
    }

    function upload() {
        var dir = targetFolder();
        if (dir) {
            DriveTransfers.pick(dir, false);
        }
    }

    function uploadFolder() {
        var dir = targetFolder();
        if (dir) {
            DriveTransfers.pick(dir, true);
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Menus                                                              */
    /* ------------------------------------------------------------------ */
    function newMenuItems() {
        return [
            { icon: "folderPlus", label: T("toolbar/newFolder", "New folder"), hint: "Shift+F", action: newFolder },
            "-",
            { icon: "fileUp", label: T("toolbar/uploadFiles", "File upload"), hint: "Shift+U", action: upload },
            { icon: "folderUp", label: T("toolbar/uploadFolder", "Folder upload"), action: uploadFolder },
            "-",
            { icon: "filePlus", label: T("toolbar/newFile", "New file"), submenu: templateItems }
        ];
    }

    function newMenu(pos) {
        DriveUI.menu(pos, newMenuItems());
    }

    function pasteItem() {
        var clip = S().clipboard;
        if (!clip || !targetFolder()) {
            return null;
        }
        return { icon: "paste", label: T("menu/paste", "Paste") + " (" + clip.paths.length + ")", hint: "Ctrl+V", action: function () { paste(); } };
    }

    function folderMenu(pos) {
        var folder = Drive.currentFolderItem();
        var w = view().writable;
        DriveUI.menu(pos, [
            w ? { icon: "folderPlus", label: T("toolbar/newFolder", "New folder"), action: newFolder } : null,
            w ? { icon: "fileUp", label: T("toolbar/uploadFiles", "File upload"), action: upload } : null,
            w ? { icon: "folderUp", label: T("toolbar/uploadFolder", "Folder upload"), action: uploadFolder } : null,
            w ? { icon: "filePlus", label: T("toolbar/newFile", "New file"), submenu: templateItems } : null,
            pasteItem(),
            "-",
            !folder.isRoot ? { icon: "link", label: T("toolbar/share", "Share"), action: function () { DriveShare.open(folder); } } : null,
            !folder.isRoot ? { icon: "link", label: T("menu/copyLink", "Copy link"), action: function () { copyLink(folder); } } : null,
            { icon: "download", label: T("menu/downloadFolder", "Download as zip"), action: function () { download([folder]); } },
            !folder.isRoot && w ? { icon: "pencil", label: T("menu/rename", "Rename"), action: function () { rename(folder); } } : null,
            !folder.isRoot ? { icon: S().starred.has(folder.path) ? "starFill" : "star", label: S().starred.has(folder.path) ? T("menu/unstar", "Remove from Starred") : T("menu/star", "Add to Starred"), action: function () { star([folder], !S().starred.has(folder.path)); } } : null,
            "-",
            { icon: "info", label: T("menu/details", "View details"), action: function () { Drive.setSelection([]); Drive.toggleDetails(true); } },
            { icon: "refresh", label: T("menu/refresh", "Refresh"), action: function () { Drive.refresh(); } }
        ]);
    }

    function moreMenu(pos) {
        var items = Drive.selectedItems();
        var v = view();
        if (!items.length) {
            DriveUI.menu(pos, [
                { icon: "checkSquare", label: T("menu/selectAll", "Select all"), hint: "Ctrl+A", action: function () { DriveList.selectAll(); } },
                pasteItem(),
                { icon: "refresh", label: T("menu/refresh", "Refresh"), action: function () { Drive.refresh(); } },
                "-",
                { checkable: true, checked: S().settings.showHidden, label: T("menu/showHidden", "Show hidden files"), action: function () { Drive.saveSettings({ showHidden: !S().settings.showHidden }); Drive.refresh(); } },
                v.kind == "drive" ? { icon: "info", label: T("menu/details", "View details"), action: function () { Drive.toggleDetails(true); } } : null,
                v.kind == "recent" ? { icon: "x", label: T("recent/clear", "Clear open history"), action: function () { API.recentClear().then(function () { Drive.refresh(); }); } } : null
            ]);
            return;
        }
        DriveUI.menu(pos, selectionMenu(items, true));
    }

    //The full set of actions for the selected items, shared by More and right click
    function selectionMenu(items, fromToolbar) {
        var v = view();
        var one = items.length == 1 ? items[0] : null;
        var writable = items.every(function (i) { return Drive.isWritable(i.path); }) && v.kind != "shared";
        var starredAll = allStarred(items);

        if (v.kind == "trash") {
            return [
                one && !one.isDir ? { icon: "eye", label: T("menu/preview", "Preview"), action: function () { DrivePreview.open(one); } } : null,
                { icon: "restore", label: T("trash/restore", "Restore"), action: function () { restore(items); } },
                { icon: "trash", label: T("trash/deleteForever", "Delete forever"), danger: true, hint: "Del", action: function () { deleteForever(items); } },
                "-",
                { icon: "info", label: T("menu/details", "View details"), action: function () { Drive.toggleDetails(true); } }
            ];
        }

        var moreSub = function () {
            return [
                one && !one.isDir ? { icon: "eye", label: T("menu/preview", "Preview"), hint: "Space", action: function () { DrivePreview.open(one); } } : null,
                one && !one.isDir && !one.shareOnly ? { icon: "apps", label: T("menu/openWith", "Open with"), submenu: function () { return openWithItems(one); } } : null,
                writable ? { icon: "cut", label: T("menu/cut", "Cut"), hint: "Ctrl+X", action: function () { clipboard("cut", items); } } : null,
                !fromToolbar ? null : { icon: "copy", label: T("menu/copyTo", "Copy to..."), action: function () { copyTo(items); } },
                writable && items.every(function (i) { return !i.isDir; }) ? { icon: "copy", label: T("menu/duplicate", "Make a copy"), action: function () { duplicate(items); } } : null,
                writable && API.caps.fm ? { icon: "archive", label: T("menu/compress", "Compress to ZIP"), action: function () { zip(items); } } : null,
                one && isArchive(one) && writable && API.caps.fm ? { icon: "extract", label: T("menu/extract", "Extract here"), action: function () { unzip(one); } } : null,
                v.kind != "shared" ? { icon: starredAll ? "starFill" : "star", label: starredAll ? T("menu/unstar", "Remove from Starred") : T("menu/star", "Add to Starred"), action: function () { star(items, !starredAll); } } : null,
                one ? { icon: "code", label: T("menu/copyPath", "Copy path"), action: function () { copyPath(one); } } : null,
                one && v.kind != "drive" && !one.shareOnly ? { icon: "folderOpen", label: T("menu/showLocation", "Show file location"), action: function () { location.hash = Drive.folderRoute(API.parentOf(one.path)); } } : null,
                one && !one.isDir && API.caps.fm && !one.shareOnly ? { icon: "history", label: T("menu/versions", "Version history"), action: function () { Drive.setSelection([one.path]); DriveDetails.open("versions"); Drive.toggleDetails(true); } } : null
            ];
        };

        if (fromToolbar) {
            return [
                one && !one.isDir && !one.shareOnly ? { icon: "apps", label: T("menu/openWith", "Open with"), submenu: function () { return openWithItems(one); } } : null,
                { icon: "download", label: T("toolbar/download", "Download"), hint: "Ctrl+S", action: function () { download(items); } },
                one ? { icon: "link", label: T("menu/copyLink", "Copy link"), action: function () { copyLink(one); } } : null,
                writable && one ? { icon: "pencil", label: T("menu/rename", "Rename"), hint: "F2", action: function () { rename(one); } } : null,
                "-"
            ].concat(moreSub()).concat([
                "-",
                writable ? { icon: "trash", label: T("menu/trash", "Move to trash"), danger: true, hint: "Del", action: function () { trash(items); } } : null
            ]);
        }

        if (v.kind == "shared") {
            var s = one && one.share;
            return [
                one ? { icon: "open", label: T("menu/open", "Open"), hint: "Enter", action: function () { open(one); } } : null,
                one ? { icon: "newTab", label: T("menu/openNewTab", "Open in new tab"), action: function () { openInNewTab(one); } } : null,
                one && s ? { icon: "link", label: T("menu/copyLink", "Copy link"), action: function () { copyLink(one); } } : null,
                one && s && v.key == "shared:byme" ? { icon: "users", label: T("share/manageSharing", "Manage sharing"), action: function () { DriveShare.open(one); } } : null,
                items.some(function (i) { return !i.shareOnly; }) ? { icon: "download", label: T("toolbar/download", "Download"), action: function () { download(items); } } : null,
                "-",
                { icon: "info", label: T("menu/details", "View details"), action: function () { Drive.toggleDetails(true); } },
                v.key == "shared:byme" ? {
                    icon: "x", label: T("share/stop", "Stop sharing"), danger: true, action: function () {
                        Promise.all(items.map(function (i) { return API.shareDelete(i.share.UUID, i.path); })).then(function () {
                            Drive.refresh();
                            DriveUI.toast(T("share/stopped", "Sharing stopped"), { type: "success" });
                        }).catch(DriveUI.error);
                    }
                } : null
            ];
        }

        return [
            one ? { icon: "open", label: T("menu/open", "Open"), hint: "Enter", action: function () { open(one); } } : null,
            one ? { icon: "newTab", label: T("menu/openNewTab", "Open in new tab"), action: function () { openInNewTab(one); } } : null,
            "-",
            one ? { icon: "share", label: T("toolbar/share", "Share"), action: function () { DriveShare.open(one); } } : null,
            one ? { icon: "link", label: T("menu/copyLink", "Copy link"), action: function () { copyLink(one); } } : null,
            "-",
            { icon: "download", label: T("toolbar/download", "Download"), hint: "Ctrl+S", action: function () { download(items); } },
            writable ? { icon: "move", label: T("toolbar/move", "Move"), action: function () { moveTo(items); } } : null,
            { icon: "copy", label: T("menu/copy", "Copy"), hint: "Ctrl+C", action: function () { clipboard("copy", items); } },
            { icon: "folder", label: T("menu/copyTo", "Copy to..."), action: function () { copyTo(items); } },
            writable && one ? { icon: "pencil", label: T("menu/rename", "Rename"), hint: "F2", action: function () { rename(one); } } : null,
            one && one.isDir && S().clipboard && writable ? { icon: "paste", label: T("menu/pasteInto", "Paste into folder"), action: function () { paste(Drive.normDir(one.path)); } } : null,
            "-",
            writable ? { icon: "trash", label: T("menu/delete", "Delete"), danger: true, hint: "Del", action: function () { trash(items); } } : null,
            "-",
            { icon: "info", label: T("menu/details", "View details"), action: function () { Drive.toggleDetails(true); } },
            { icon: "moreH", label: T("toolbar/more", "More"), submenu: moreSub }
        ];
    }

    function contextMenu(pos, item) {
        DriveUI.menu(pos, selectionMenu(Drive.selectedItems().length ? Drive.selectedItems() : [item], false));
    }

    function backgroundMenu(pos) {
        var v = view();
        var items = [];
        if (v.kind == "drive" && v.writable) {
            items = items.concat(newMenuItems(), ["-"]);
        }
        items.push(pasteItem());
        items.push({ icon: "checkSquare", label: T("menu/selectAll", "Select all"), hint: "Ctrl+A", action: function () { DriveList.selectAll(); } });
        items.push({ icon: "refresh", label: T("menu/refresh", "Refresh"), action: function () { Drive.refresh(); } });
        items.push("-");
        var grid = Drive.currentViewMode() == "grid";
        items.push({ icon: grid ? "list" : "grid", label: grid ? T("view/list", "List view") : T("view/grid", "Grid view"), action: function () { document.querySelector('[data-mode="' + (grid ? "list" : "grid") + '"]').click(); } });
        if (v.kind == "drive") {
            items.push({ icon: "info", label: T("menu/folderDetails", "Folder details"), action: function () { Drive.setSelection([]); Drive.toggleDetails(true); } });
        }
        if (v.kind == "trash" && S().items.length) {
            items.push("-", { icon: "x", label: T("trash/empty", "Empty trash"), danger: true, action: emptyTrash });
        }
        DriveUI.menu(pos, items);
    }

    global.DriveActions = {
        open: open,
        openInNewTab: openInNewTab,
        openWithModule: openWithModule,
        openWithChooser: openWithChooser,
        openWithItems: openWithItems,
        compatibleModules: compatibleModules,
        defaultModuleFor: defaultModuleFor,
        download: download,
        copyLink: copyLink,
        copyText: copyText,
        copyPath: copyPath,
        moveTo: moveTo,
        copyTo: copyTo,
        transfer: transfer,
        duplicate: duplicate,
        clipboard: clipboard,
        paste: paste,
        rename: rename,
        trash: trash,
        deleteForever: deleteForever,
        restore: restore,
        emptyTrash: emptyTrash,
        star: star,
        zip: zip,
        unzip: unzip,
        isArchive: isArchive,
        newFolder: newFolder,
        newFile: newFile,
        upload: upload,
        uploadFolder: uploadFolder,
        newMenu: newMenu,
        folderMenu: folderMenu,
        moreMenu: moreMenu,
        contextMenu: contextMenu,
        backgroundMenu: backgroundMenu,
        launchURL: launchURL,
        fileHash: fileHash
    };
})(window);
