/*
    details.js

    The details panel on the right of the list: General (preview, file
    information, sharing summary, quick actions), Permissions (owner, access
    and every share link), Activity (a timeline built from the dates the
    server knows: created, modified, shared, versions, opened in Drive) and
    Versions (local version history, files only).

    It follows the selection: one item, several items (a summary), or
    nothing (the current folder).
*/

(function (global) {
    "use strict";

    var I = DriveUI.I;
    var esc = DriveUI.esc;
    var API = DriveAPI;

    var tab = "general";
    var token = 0;
    var lastKey = null;
    var cache = {};

    function S() {
        return Drive.state;
    }

    function panel() {
        return document.getElementById("details");
    }

    function target() {
        var sel = Drive.selectedItems();
        if (sel.length == 1) {
            return { kind: "one", item: sel[0] };
        }
        if (sel.length > 1) {
            return { kind: "many", items: sel };
        }
        var folder = Drive.currentFolderItem();
        if (folder) {
            return { kind: "one", item: folder };
        }
        return { kind: "none" };
    }

    function open(withTab) {
        if (withTab) {
            tab = withTab;
        }
        var p = panel();
        p.hidden = false;
        refresh(true);
    }

    function close(silent) {
        panel().hidden = true;
        document.documentElement.classList.remove("details-open");
        lastKey = null;
        if (!silent && S().detailsOpen) {
            S().detailsOpen = false;
            var btn = document.getElementById("detailsBtn");
            if (btn) {
                btn.classList.remove("active");
            }
        }
    }

    function refresh(force) {
        var p = panel();
        if (!S().detailsOpen || !S().view || S().view.kind == "settings") {
            p.hidden = true;
            return;
        }
        p.hidden = false;
        var t = target();
        var key = t.kind + ":" + (t.item ? t.item.path : t.items ? t.items.map(function (i) { return i.path; }).join("|") : "") + ":" + tab;
        if (!force && key == lastKey) {
            return;
        }
        lastKey = key;
        if (t.kind == "many") {
            renderMany(t.items);
        } else if (t.kind == "one") {
            renderOne(t.item);
        } else {
            p.innerHTML = head(null) + '<div class="details-body"><div class="state">' + I("info", { size: 36 }) +
                '<p>' + esc(T("details/pick", "Select a file or folder to see its details.")) + '</p></div></div>';
            bindHead();
        }
    }

    function head(item, sub) {
        var icon = item ? DriveIcons.file(item.name, item.isDir) : I("info", { size: 32 });
        return '<div class="details-head"><div class="big-icon">' + icon + '</div><div class="meta"><b>' +
            esc(item ? item.name : T("details/title", "Details")) + '</b><small>' + esc(sub || "") + '</small></div>' +
            '<button class="icon-btn small" data-close aria-label="' + esc(T("common/close", "Close")) + '">' + I("x") + '</button></div>';
    }

    function bindHead() {
        var c = panel().querySelector("[data-close]");
        if (c) {
            c.addEventListener("click", function () { Drive.toggleDetails(false); });
        }
    }

    function subtitleOf(item) {
        if (item.isDir) {
            return item.isCurrentFolder ? T("details/currentFolder", "Current folder") : T("type/folder", "Folder");
        }
        return DriveUI.fmtSize(item.size) + " · " + DriveList.typeLabel(item);
    }

    /* ------------------------------------------------------------------ */
    function renderMany(items) {
        var files = items.filter(function (i) { return !i.isDir; });
        var total = files.reduce(function (s, i) { return s + (i.size > 0 ? i.size : 0); }, 0);
        var folders = items.length - files.length;
        var p = panel();
        p.innerHTML = '<div class="details-head"><div class="big-icon">' + DriveIcons.file("", true, { plain: true }) + '</div><div class="meta"><b>' +
            esc(T("sel/count", "{n} selected", { n: items.length })) + '</b><small>' +
            esc(T("details/manySub", "{files} files, {folders} folders", { files: files.length, folders: folders })) + '</small></div>' +
            '<button class="icon-btn small" data-close>' + I("x") + '</button></div>' +
            '<div class="details-body scroll-y"><div class="section"><h4>' + I("info") + esc(T("details/summary", "Summary")) + '</h4><dl class="kv">' +
            '<dt>' + esc(T("details/items", "Items")) + '</dt><dd>' + items.length + '</dd>' +
            '<dt>' + esc(T("col/size", "Size")) + '</dt><dd>' + esc(DriveUI.fmtSize(total)) + (folders ? '<small>' + esc(T("details/excludesFolders", "Folders not counted")) + '</small>' : "") + '</dd>' +
            '</dl></div><div class="section"><h4>' + I("sliders") + esc(T("details/quick", "Quick actions")) + '</h4><div class="quick-actions" id="dQuick"></div></div></div>';
        bindHead();
        var quick = p.querySelector("#dQuick");
        var actions = [];
        if (S().view.kind == "trash") {
            actions = [
                ["restore", T("trash/restore", "Restore"), function () { DriveActions.restore(items); }],
                ["trash", T("trash/deleteForever", "Delete forever"), function () { DriveActions.deleteForever(items); }]
            ];
        } else {
            actions = [
                ["download", T("toolbar/download", "Download"), function () { DriveActions.download(items); }],
                ["move", T("menu/moveTo", "Move to..."), function () { DriveActions.moveTo(items); }],
                ["copy", T("menu/copyTo", "Copy to..."), function () { DriveActions.copyTo(items); }],
                ["star", T("menu/star", "Add to Starred"), function () { DriveActions.star(items, true); }],
                ["trash", T("menu/trash", "Move to trash"), function () { DriveActions.trash(items); }]
            ];
        }
        actions.forEach(function (a) {
            var b = DriveUI.el('<button>' + I(a[0]) + '<span>' + esc(a[1]) + '</span></button>');
            b.addEventListener("click", a[2]);
            quick.appendChild(b);
        });
    }

    /* ------------------------------------------------------------------ */
    function renderOne(item) {
        var p = panel();
        var tabs = [["general", T("details/general", "General")]];
        var canMeta = !item.trashed && !item.shareOnly;
        if (canMeta && API.caps.fm) {
            tabs.push(["permissions", T("details/permissions", "Permissions")]);
        }
        if (canMeta) {
            tabs.push(["activity", T("details/activity", "Activity")]);
        }
        if (canMeta && !item.isDir && API.caps.fm) {
            tabs.push(["versions", T("details/versions", "Versions")]);
        }
        if (!tabs.some(function (t) { return t[0] == tab; })) {
            tab = "general";
        }
        p.innerHTML = head(item, subtitleOf(item)) +
            '<div class="tabs">' + tabs.map(function (t) {
                return '<button class="tab' + (t[0] == tab ? " active" : "") + '" data-tab="' + t[0] + '">' + esc(t[1]) + '</button>';
            }).join("") + '</div><div class="details-body scroll-y" id="dBody"></div>';
        bindHead();
        p.querySelectorAll("[data-tab]").forEach(function (b) {
            b.addEventListener("click", function () {
                tab = b.getAttribute("data-tab");
                refresh(true);
            });
        });
        var body = p.querySelector("#dBody");
        var my = ++token;
        if (tab == "general") {
            general(item, body, my);
        } else if (tab == "permissions") {
            permissions(item, body, my);
        } else if (tab == "activity") {
            activity(item, body, my);
        } else if (tab == "versions") {
            versions(item, body, my);
        }
    }

    function propsOf(item) {
        if (item.trashed || item.shareOnly) {
            return Promise.resolve(null);
        }
        var key = "p:" + item.path + ":" + (item.mtime || "");
        if (cache[key]) {
            return Promise.resolve(cache[key]);
        }
        return API.props(item.path).then(function (p) {
            cache[key] = p;
            return p;
        }).catch(function () { return null; });
    }

    function shareInfoOf(item) {
        if (item.trashed) {
            return Promise.resolve(null);
        }
        if (item.shareOnly) {
            return Promise.resolve({ Shares: [item.share], CanManage: false });
        }
        return API.shareInfo(item.path).catch(function () { return null; });
    }

    function stillCurrent(my) {
        return my == token;
    }

    function previewHTML(item) {
        var thumb = API.caps.fm && DriveList.wantsThumb(item) && S().settings.thumbnails ?
            '<img src="' + esc(API.thumbURL(item.path) + "&t=" + (item.mtime || 0)) + '" alt="" onerror="this.remove()">' : "";
        var canPreview = !item.isDir && DrivePreview.canPreview(item);
        return '<div class="preview-box"><div class="preview-card">' + DriveIcons.file(item.name, item.isDir) +
            (thumb ? thumb.replace("<img ", '<img style="position:absolute;inset:0" ') : "") + '</div>' +
            (item.isDir ? (item.isCurrentFolder ? "" : '<button class="btn" data-act="openFolder">' + I("folderOpen") + esc(T("menu/open", "Open")) + '</button>') :
                '<button class="btn" data-act="' + (canPreview ? "preview" : "open") + '">' + I(canPreview ? "eye" : "open") + esc(canPreview ? T("menu/preview", "Preview") : T("menu/open", "Open")) + '</button>') +
            '</div>';
    }

    function general(item, body, my) {
        var writable = Drive.isWritable(item.path) && !item.trashed && !item.shareOnly && !item.isRoot && S().view.kind != "shared";
        var parentPath = item.trashed ? (item.origin || "") : API.parentOf(item.path);
        var html = previewHTML(item);
        html += '<div class="section"><h4>' + esc(item.isDir ? T("details/folderInfo", "Folder information") : T("details/fileInfo", "File information")) + '</h4><dl class="kv">' +
            '<dt>' + esc(T("col/name", "Name")) + '</dt><dd class="with-action"><span>' + esc(item.name) + '</span>' +
            (writable ? '<button class="icon-btn small" data-act="rename" title="' + esc(T("menu/rename", "Rename")) + '">' + I("pencil") + '</button>' : "") + '</dd>' +
            '<dt>' + esc(T("col/type", "Type")) + '</dt><dd>' + esc(DriveList.typeLabel(item)) + '</dd>' +
            '<dt>' + esc(T("col/size", "Size")) + '</dt><dd id="dSize">' + (item.isDir ? '<span class="spinner small"></span>' : esc(DriveUI.fmtSize(item.size)) + '<small>' + esc(DriveUI.fmtExact(item.size)) + '</small>') + '</dd>';
        if (item.trashed) {
            html += '<dt>' + esc(T("col/origin", "Original location")) + '</dt><dd><a href="' + esc(Drive.href(Drive.folderRoute(parentPath))) + '">' + I("folder") +
                esc(Drive.pathParts(Drive.normDir(parentPath)).map(function (x) { return x.label; }).join(" / ")) + '</a></dd>' +
                '<dt>' + esc(T("col/deleted", "Deleted")) + '</dt><dd>' + esc(DriveUI.fmtDate(item.mtime)) + '</dd>';
        } else if (item.shareOnly) {
            html += '<dt>' + esc(T("col/owner", "Owner")) + '</dt><dd>' + esc(item.owner) + '</dd>';
        } else {
            if (!item.isRoot) {
                html += '<dt>' + esc(T("col/location", "Location")) + '</dt><dd><a href="' + esc(Drive.href(Drive.folderRoute(parentPath))) + '">' + I("folder") +
                    esc(Drive.pathParts(Drive.normDir(parentPath)).map(function (x) { return x.label; }).join(" / ")) + '</a></dd>';
            }
            html += '<dt>' + esc(T("col/modified", "Modified")) + '</dt><dd id="dModified">' + esc(item.mtime ? DriveUI.fmtDate(item.mtime) : "-") + '</dd>' +
                '<dt>' + esc(T("details/created", "Created")) + '</dt><dd id="dCreated">-</dd>';
        }
        html += '</dl></div>';
        if (!item.trashed) {
            html += '<div class="section"><h4>' + I("users") + esc(T("details/sharing", "Sharing")) + '</h4><div id="dShare"><span class="spinner small"></span></div></div>';
        }
        html += '<div class="section"><h4>' + esc(T("details/quick", "Quick actions")) + '</h4><div class="quick-actions" id="dQuick"></div></div>';
        body.innerHTML = html;

        bindPreviewButtons(item, body);
        var rn = body.querySelector('[data-act="rename"]');
        if (rn) {
            rn.addEventListener("click", function () { DriveActions.rename(item); });
        }

        //Quick actions
        var quick = body.querySelector("#dQuick");
        var list = [];
        if (item.trashed) {
            list = [["restore", T("trash/restore", "Restore"), function () { DriveActions.restore([item]); }, false],
            ["trash", T("trash/deleteForever", "Delete forever"), function () { DriveActions.deleteForever([item]); }, false]];
        } else {
            if (!item.isDir && !item.shareOnly) {
                list.push(["apps", T("menu/openWith", "Open with"), function (b) {
                    DriveUI.menu({ anchor: b }, DriveActions.openWithItems(item));
                }, true]);
            }
            if (!item.shareOnly) {
                list.push(["download", item.isDir ? T("menu/downloadFolder", "Download as zip") : T("toolbar/download", "Download"), function () { DriveActions.download([item]); }, false]);
            }
            if (!item.isRoot) {
                list.push(["link", T("details/getLink", "Get link"), function () { DriveActions.copyLink(item); }, false]);
            }
            if (writable) {
                list.push(["move", T("menu/moveTo", "Move to..."), function () { DriveActions.moveTo([item]); }, false]);
            }
            if (!item.shareOnly && !item.isRoot) {
                list.push(["copy", T("menu/copyTo", "Copy to..."), function () { DriveActions.copyTo([item]); }, false]);
                var starred = S().starred.has(item.path);
                list.push([starred ? "starFill" : "star", starred ? T("menu/unstar", "Remove from Starred") : T("menu/star", "Add to Starred"), function () { DriveActions.star([item], !starred); }, false]);
            }
        }
        list.forEach(function (a) {
            var b = DriveUI.el('<button>' + I(a[0]) + '<span>' + esc(a[1]) + '</span>' + (a[3] ? I("chevronRight") : "") + '</button>');
            b.addEventListener("click", function () { a[2](b); });
            quick.appendChild(b);
        });

        //Async: properties and sharing
        propsOf(item).then(function (pr) {
            if (!stillCurrent(my) || !pr) {
                if (stillCurrent(my) && item.isDir) {
                    body.querySelector("#dSize").textContent = "-";
                }
                return;
            }
            var size = body.querySelector("#dSize");
            if (size && item.isDir) {
                size.innerHTML = pr.Filesize >= 0 ? esc(DriveUI.fmtSize(pr.Filesize)) + '<small>' + esc(DriveUI.fmtExact(pr.Filesize)) + '</small>' : esc(T("details/unknown", "Unknown"));
            }
            var by = pr.Owner && pr.Owner != "Unknown" ? '<small>' + esc(T("details/by", "by {name}", { name: pr.Owner })) + '</small>' : "";
            var mod = body.querySelector("#dModified");
            if (mod && pr.LastModUnix) {
                mod.innerHTML = esc(DriveUI.fmtDate(pr.LastModUnix)) + by;
            }
            var cr = body.querySelector("#dCreated");
            if (cr) {
                cr.innerHTML = pr.CreationUnix ? esc(DriveUI.fmtDate(pr.CreationUnix)) + by : '<span class="muted">' + esc(T("details/notRecorded", "Not recorded by this storage")) + '</span>';
            }
        });
        if (!item.trashed) {
            shareInfoOf(item).then(function (info) {
                if (!stillCurrent(my)) {
                    return;
                }
                var box = body.querySelector("#dShare");
                var shares = ((info && info.Shares) || []).filter(function (s) { return !s.IsExpired; });
                var canManage = !info || info.CanManage !== false;
                if (!shares.length) {
                    box.innerHTML = '<div class="share-summary"><div class="bubble">' + I("lock") + '</div><div class="txt">' + esc(T("share/private", "Not shared")) +
                        '<small>' + esc(T("details/onlyYou", "Only people with access to this location")) + '</small></div>' +
                        (item.isRoot || !canManage ? "" : '<button class="btn small" data-act="share">' + esc(T("toolbar/share", "Share")) + '</button>') + '</div>';
                } else {
                    var s = shares[0];
                    box.innerHTML = '<div class="share-summary"><div class="bubble">' + I(DriveShare.audienceIcon(s)) + '</div><div class="txt">' + esc(DriveShare.audienceTitle(s)) +
                        '<small>' + esc(DriveShare.detailText(s, item.isDir) + (shares.length > 1 ? " · " + T("details/moreLinks", "+{n} more links", { n: shares.length - 1 }) : "")) + '</small></div>' +
                        (canManage ? '<button class="btn small" data-act="share">' + esc(T("share/manage", "Manage")) + '</button>' : "") + '</div>';
                }
                var sb = box.querySelector('[data-act="share"]');
                if (sb) {
                    sb.addEventListener("click", function () { DriveShare.open(item); });
                }
            });
        }
    }

    function bindPreviewButtons(item, body) {
        var pv = body.querySelector('[data-act="preview"]');
        if (pv) {
            pv.addEventListener("click", function () { DrivePreview.open(item); });
        }
        var op = body.querySelector('[data-act="open"]');
        if (op) {
            op.addEventListener("click", function () { DriveActions.open(item); });
        }
        var of = body.querySelector('[data-act="openFolder"]');
        if (of) {
            of.addEventListener("click", function () { DriveActions.open(item); });
        }
    }

    /* ------------------------------------------------------------------ */
    function permissions(item, body, my) {
        body.innerHTML = '<div class="state" style="padding:30px"><div class="spinner"></div></div>';
        Promise.all([propsOf(item), shareInfoOf(item)]).then(function (r) {
            if (!stillCurrent(my)) {
                return;
            }
            var pr = r[0], info = r[1];
            var root = Drive.rootOf(item.path);
            var readonly = root && root.readonly;
            var owner = pr && pr.Owner && pr.Owner != "Unknown" ? pr.Owner : "";
            var html = '<div class="section" style="padding-top:0"><h4>' + I("user") + esc(T("perm/access", "Access")) + '</h4><div class="list-plain">' +
                '<div class="item-card"><div class="ic-wrap accent">' + I("user") + '</div><div class="body"><b>' + esc(owner || T("details/unknown", "Unknown")) +
                (owner == S().user.name ? " (" + esc(T("owner/me", "me")) + ")" : "") + '</b><small>' + esc(T("perm/owner", "Owner")) + '</small></div></div>' +
                '<div class="item-card"><div class="ic-wrap">' + I(readonly ? "lock" : "pencil") + '</div><div class="body"><b>' + esc(readonly ? T("perm/readOnly", "Read only") : T("perm/readWrite", "Read and write")) +
                '</b><small>' + esc(T("perm/yourAccess", "Your access through {root}", { root: Drive.rootLabel(root) })) + '</small></div></div>';
            if (pr && pr.Permission) {
                html += '<div class="item-card"><div class="ic-wrap">' + I("shield") + '</div><div class="body"><b class="mono">' + esc(pr.Permission) + '</b><small>' +
                    esc(T("perm/mode", "Storage permission bits")) + '</small></div></div>';
            }
            html += '</div></div>';

            var shares = (info && info.Shares) || [];
            html += '<div class="section"><h4>' + I("link") + esc(T("perm/links", "Share links")) + '</h4>';
            if (!shares.length) {
                html += '<p class="muted" style="margin:0 0 12px">' + esc(T("perm/noLinks", "There are no share links for this item.")) + '</p>';
            } else {
                html += '<div class="list-plain" style="margin-bottom:12px">' + shares.map(function (s) {
                    return '<div class="item-card"><div class="ic-wrap' + (s.Permission == "anyone" ? " accent" : "") + '">' + I(DriveShare.audienceIcon(s)) + '</div><div class="body"><b>' +
                        esc(DriveShare.audienceTitle(s)) + '</b><small>' + esc(DriveShare.detailText(s, item.isDir)) + '</small>' +
                        ((s.Accessibles || []).length ? '<small>' + esc(s.Accessibles.join(", ")) + '</small>' : "") + '</div>' +
                        '<div class="actions"><button class="icon-btn small" data-copy="' + esc(s.UUID) + '" title="' + esc(T("menu/copyLink", "Copy link")) + '">' + I("copy") + '</button></div></div>';
                }).join("") + '</div>';
            }
            if (!item.isRoot && (!info || info.CanManage !== false)) {
                html += '<button class="btn" data-act="share">' + I("users") + esc(T("share/manageSharing", "Manage sharing")) + '</button>';
            }
            html += '</div>';
            body.innerHTML = html;
            body.querySelectorAll("[data-copy]").forEach(function (b) {
                b.addEventListener("click", function () {
                    DriveActions.copyText(API.shareURL(b.getAttribute("data-copy"))).then(function () {
                        DriveUI.toast(T("share/copied", "Link copied"), { type: "success" });
                    });
                });
            });
            var sb = body.querySelector('[data-act="share"]');
            if (sb) {
                sb.addEventListener("click", function () { DriveShare.open(item); });
            }
        });
    }

    /* ------------------------------------------------------------------ */
    function activity(item, body, my) {
        body.innerHTML = '<div class="state" style="padding:30px"><div class="spinner"></div></div>';
        var versionsP = (!item.isDir && API.caps.fm) ? API.versions(item.path).catch(function () { return null; }) : Promise.resolve(null);
        Promise.all([propsOf(item), shareInfoOf(item), versionsP]).then(function (r) {
            if (!stillCurrent(my)) {
                return;
            }
            var pr = r[0], info = r[1], vers = r[2];
            var events = [];
            var owner = pr && pr.Owner && pr.Owner != "Unknown" ? pr.Owner : "";
            if (pr && pr.CreationUnix) {
                events.push({ t: pr.CreationUnix, icon: "plus", cls: "success", what: owner ? T("act/createdBy", "{name} created this item", { name: owner }) : T("act/created", "Created") });
            }
            var mt = (pr && pr.LastModUnix) || item.mtime;
            if (mt && (!pr || mt != pr.CreationUnix)) {
                events.push({ t: mt, icon: "pencil", cls: "accent", what: T("act/modified", "Last modified") });
            }
            ((info && info.Shares) || []).forEach(function (s) {
                if (s.CreatedAt) {
                    events.push({ t: s.CreatedAt, icon: DriveShare.audienceIcon(s), cls: "accent", what: T("act/shared", "{who} shared it with {audience}", { who: s.Owner || owner || "", audience: DriveShare.audienceTitle(s).toLowerCase() }).trim() });
                }
                if (s.ExpireAt > 0) {
                    events.push({ t: s.ExpireAt, icon: "clock", cls: "warning", what: s.IsExpired ? T("act/expired", "A share link expired") : T("act/willExpire", "A share link expires") });
                }
            });
            ((vers && vers.Versions) || []).forEach(function (v) {
                events.push({ t: v.ModTime, icon: "history", cls: "", what: T("act/version", "Version saved ({size})", { size: DriveUI.fmtSize(v.Filesize) }) });
            });
            var opened = S().recentOpened && S().recentOpened[item.path];
            if (opened) {
                events.push({ t: opened, icon: "eye", cls: "", what: T("act/opened", "You opened it in Drive") });
            }
            events.sort(function (a, b) { return b.t - a.t; });
            if (!events.length) {
                body.innerHTML = '<div class="state">' + I("activity", { size: 36 }) + '<p>' + esc(T("act/none", "No activity recorded yet.")) + '</p></div>';
                return;
            }
            body.innerHTML = '<ul class="timeline">' + events.map(function (e) {
                return '<li><div class="dot ' + e.cls + '">' + I(e.icon) + '</div><div><div class="what">' + esc(e.what) + '</div><div class="when">' +
                    esc(DriveUI.fmtDate(e.t) + " · " + DriveUI.fmtRelative(e.t)) + '</div></div></li>';
            }).join("") + '</ul><p class="muted" style="font-size:12px;margin:4px 0 0">' +
                esc(T("act/note", "Built from the dates the storage, share links and version history keep.")) + '</p>';
        });
    }

    /* ------------------------------------------------------------------ */
    function versions(item, body, my) {
        body.innerHTML = '<div class="state" style="padding:30px"><div class="spinner"></div></div>';
        API.versions(item.path).then(function (data) {
            if (!stillCurrent(my)) {
                return;
            }
            var list = (data && data.Versions) || [];
            var writable = Drive.isWritable(item.path);
            var parent = API.parentOf(item.path);
            var html = '<div class="item-card" style="margin-bottom:14px"><div class="ic-wrap accent">' + I("file") + '</div><div class="body"><b>' + esc(T("ver/current", "Current version")) +
                '</b><small>' + esc(DriveUI.fmtDate(data.LatestModtime || item.mtime) + " · " + DriveUI.fmtSize(item.size)) + '</small></div></div>';
            if (writable) {
                html += '<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap"><button class="btn small" data-act="snap">' + I("plus") + esc(T("ver/save", "Save a version now")) + '</button>' +
                    (list.length ? '<button class="btn small ghost" data-act="purge">' + I("trash") + esc(T("ver/deleteAll", "Delete all versions")) + '</button>' : "") + '</div>';
            }
            if (!list.length) {
                html += '<p class="muted" style="margin:0">' + esc(T("ver/none", "No earlier versions. Versions are kept when a file is overwritten, or when you save one here.")) + '</p>';
            } else {
                html += '<div class="list-plain">' + list.map(function (v) {
                    return '<div class="item-card"><div class="ic-wrap">' + I("history") + '</div><div class="body"><b>' + esc(v.OverwriteTime) + '</b><small>' +
                        esc(DriveUI.fmtSize(v.Filesize)) + '</small></div><div class="actions">' +
                        '<a class="icon-btn small" href="' + esc(API.downloadURL(parent + v.Relpath)) + '" download="' + esc(v.Filename) + '" title="' + esc(T("toolbar/download", "Download")) + '">' + I("download") + '</a>' +
                        (writable ? '<button class="icon-btn small" data-restore="' + esc(v.HistoryID) + '" title="' + esc(T("ver/restore", "Restore this version")) + '">' + I("restore") + '</button>' +
                            '<button class="icon-btn small" data-del="' + esc(v.HistoryID) + '" title="' + esc(T("ver/delete", "Delete this version")) + '">' + I("trash") + '</button>' : "") +
                        '</div></div>';
                }).join("") + '</div>';
            }
            body.innerHTML = html;
            var again = function () {
                if (stillCurrent(my)) {
                    versions(item, body, my);
                }
            };
            var snap = body.querySelector('[data-act="snap"]');
            if (snap) {
                snap.addEventListener("click", function () {
                    API.versionOp(item.path, "new").then(function () {
                        DriveUI.toast(T("ver/saved", "Version saved"), { type: "success" });
                        again();
                    }).catch(DriveUI.error);
                });
            }
            var purge = body.querySelector('[data-act="purge"]');
            if (purge) {
                purge.addEventListener("click", function () {
                    DriveUI.confirm({ title: T("ver/deleteAll", "Delete all versions"), message: T("ver/deleteAllText", "Every earlier version of this file will be deleted."), ok: T("common/delete", "Delete"), danger: true }).then(function (ok) {
                        if (ok) {
                            API.versionOp(item.path, "deleteAll").then(again).catch(DriveUI.error);
                        }
                    });
                });
            }
            body.querySelectorAll("[data-restore]").forEach(function (b) {
                b.addEventListener("click", function () {
                    DriveUI.confirm({ title: T("ver/restore", "Restore this version"), message: T("ver/restoreText", "The current content is replaced by this version."), ok: T("ver/restoreOk", "Restore") }).then(function (ok) {
                        if (!ok) {
                            return;
                        }
                        API.versionOp(item.path, "restore", b.getAttribute("data-restore")).then(function () {
                            DriveUI.toast(T("ver/restored", "Version restored"), { type: "success" });
                            Drive.refresh();
                            again();
                        }).catch(DriveUI.error);
                    });
                });
            });
            body.querySelectorAll("[data-del]").forEach(function (b) {
                b.addEventListener("click", function () {
                    API.versionOp(item.path, "delete", b.getAttribute("data-del")).then(again).catch(DriveUI.error);
                });
            });
        }).catch(function (err) {
            if (stillCurrent(my)) {
                body.innerHTML = '<div class="banner">' + I("alert") + '<span>' + esc(err.message) + '</span></div>';
            }
        });
    }

    global.DriveDetails = {
        open: open,
        close: close,
        refresh: function (force) {
            refresh(force);
        },
        invalidate: function () {
            cache = {};
            lastKey = null;
        }
    };
})(window);
