/*
    app.js

    Boot, state, routing and the chrome around the file list: top bar,
    sidebar, view header and toolbar, notifications and keyboard shortcuts.

    Routes (location.hash)
        #/drive/<vpath>        a folder (user:/ is "My Drive")
        #/shared[?tab=byme]    shares with me / by me
        #/recent  #/starred  #/trash
        #/category/<group>     documents | photos | videos | music | others
        #/search/<query>?in=<vpath>
        #/settings             Drive settings (System Settings opens in the
                               app host instead, see apphost.js)
*/

(function (global) {
    "use strict";

    var I = DriveUI.I;
    var esc = DriveUI.esc;
    var API = DriveAPI;

    var DEFAULT_SETTINGS = {
        theme: "auto", density: "comfortable", view: "list", sortKey: "name", sortDir: "asc",
        foldersFirst: true, showHidden: false, thumbnails: true, pageSize: 100, openIn: "drive",
        confirmTrash: false, viewer: true, detailsOpen: false
    };

    var state = {
        user: { name: "", icon: "", groups: [], isAdmin: false },
        hostName: "",
        version: "",
        settings: $.extend({}, DEFAULT_SETTINGS),
        starred: new Set(),
        roots: [],
        modules: [],
        moduleByName: {},
        interfaces: [],
        quota: { total: -1, used: 0 },
        route: null,
        view: null,
        items: [],
        sorted: [],
        page: 1,
        selection: new Set(),
        anchor: null,
        focus: null,
        clipboard: null,
        loadToken: 0,
        loading: false,
        loadError: null,
        searchScope: null,
        recentOpened: {},
        notifications: [],
        detailsOpen: false
    };

    /* ------------------------------------------------------------------ */
    /*  Paths and roots                                                    */
    /* ------------------------------------------------------------------ */
    function rootById(id) {
        for (var i = 0; i < state.roots.length; i++) {
            if (state.roots[i].uuid == id) {
                return state.roots[i];
            }
        }
        return null;
    }

    function rootIdOf(vpath) {
        var at = String(vpath).indexOf(":/");
        return at > 0 ? vpath.substring(0, at) : "";
    }

    function rootOf(vpath) {
        return rootById(rootIdOf(vpath));
    }

    function rootLabel(root) {
        if (!root) {
            return "";
        }
        if (root.uuid == "user") {
            return T("nav/myDrive", "My Drive");
        }
        if (root.uuid == "tmp" && (!root.name || root.name.toLowerCase() == "tmp")) {
            return T("nav/tmp", "Temporary");
        }
        return root.name || root.uuid;
    }

    function rootIcon(root) {
        if (!root) {
            return "drive";
        }
        var fs = String(root.fs || "").toLowerCase();
        if (root.uuid == "user") {
            return "home";
        }
        if (root.uuid == "tmp") {
            return "hourglass";
        }
        if (root.uuid == "cluster" || fs == "clusterfs") {
            return "cluster";
        }
        if (["smb", "ftp", "sftp", "webdav", "nfs"].indexOf(fs) >= 0) {
            return "globe";
        }
        if (root.hierarchy == "public") {
            return "users";
        }
        if (root.hierarchy == "backup") {
            return "history";
        }
        return "drive";
    }

    function normDir(path) {
        path = String(path || "user:/");
        if (path.substring(path.length - 1) != "/") {
            path += "/";
        }
        return path.replace(/([^:])\/\/+/g, "$1/");
    }

    function pathParts(vpath) {
        var m = /^([^:\/]+):\/(.*)$/.exec(vpath || "");
        if (!m) {
            return [{ label: vpath, path: vpath }];
        }
        var root = rootById(m[1]) || { uuid: m[1], name: m[1] };
        var parts = [{ label: rootLabel(root), path: m[1] + ":/" }];
        var acc = m[1] + ":/";
        m[2].split("/").filter(Boolean).forEach(function (seg) {
            acc += seg + "/";
            parts.push({ label: seg, path: acc });
        });
        return parts;
    }

    function locationLabel(vpath) {
        var parts = pathParts(API.parentOf(vpath));
        return parts.map(function (p) { return p.label; }).join(" / ");
    }

    function isWritable(vpath) {
        var r = rootOf(vpath);
        return !(r && r.readonly);
    }

    function folderRoute(vpath) {
        return "#/drive/" + encodeURIComponent(normDir(vpath));
    }

    //An in-page link. The document base is the web root, so a bare "#/..."
    //href would point at the root page instead of Drive
    function href(route) {
        return location.pathname + location.search + route;
    }

    function module(name) {
        return state.moduleByName[String(name).toLowerCase()] || null;
    }

    /* ------------------------------------------------------------------ */
    /*  Settings and theme                                                 */
    /* ------------------------------------------------------------------ */
    var darkQuery = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

    function effectiveTheme() {
        var t = state.settings.theme;
        if (t == "auto") {
            return darkQuery && darkQuery.matches ? "dark" : "light";
        }
        return t;
    }

    function applyTheme() {
        var theme = effectiveTheme();
        document.documentElement.setAttribute("data-theme", theme);
        document.documentElement.classList.toggle("density-compact", state.settings.density == "compact");
        var meta = document.querySelector('meta[name="theme-color"]');
        if (meta) {
            meta.setAttribute("content", theme == "dark" ? "#0e1117" : "#f3f6fb");
        }
        try {
            localStorage.setItem("drive_ui_cache", JSON.stringify({ theme: state.settings.theme, density: state.settings.density }));
        } catch (e) { }
        if (global.DriveHost) {
            DriveHost.broadcastTheme(theme);
        }
    }

    if (darkQuery) {
        var onScheme = function () {
            if (state.settings.theme == "auto") {
                applyTheme();
            }
        };
        if (darkQuery.addEventListener) {
            darkQuery.addEventListener("change", onScheme);
        } else if (darkQuery.addListener) {
            darkQuery.addListener(onScheme);
        }
    }

    var saveTimer = null;
    function saveSettings(partial, silent) {
        $.extend(state.settings, partial || {});
        applyTheme();
        clearTimeout(saveTimer);
        saveTimer = setTimeout(function () {
            API.saveSettings(state.settings).then(function (clean) {
                if (clean && typeof clean === "object") {
                    $.extend(state.settings, clean);
                }
            }).catch(function (err) {
                if (!silent) {
                    DriveUI.error(err);
                }
            });
        }, 300);
    }

    /* ------------------------------------------------------------------ */
    /*  Boot                                                               */
    /* ------------------------------------------------------------------ */
    function paintStaticIcons() {
        document.getElementById("brand").setAttribute("href", href(folderRoute("user:/")));
        document.getElementById("navToggle").innerHTML = I("menu");
        document.getElementById("searchIcon").outerHTML = I("search");
        document.getElementById("searchToggle").innerHTML = I("search");
        document.getElementById("searchClose").innerHTML = I("x");
        document.getElementById("bellBtn").innerHTML = I("bell") + '<span class="badge" id="bellBadge" hidden></span>';
        document.getElementById("helpBtn").innerHTML = I("help");
        document.getElementById("userCaret").outerHTML = I("chevronDown");
        document.getElementById("hostNewTab").innerHTML = I("external");
        document.getElementById("hostClose").innerHTML = I("x");
    }

    function boot() {
        paintStaticIcons();
        DriveI18n.load(function () {
            DriveI18n.translate(document);
            document.getElementById("hostBack").innerHTML = I("arrowLeft") + '<span class="lbl">' + esc(T("host/back", "Back to Drive")) + '</span>';
            renderSkeletonHead();
            loadSession();
        });
    }

    function renderSkeletonHead() {
        document.getElementById("listWrap").innerHTML = skeletonRows();
    }

    function skeletonRows() {
        var html = '<div class="rows">';
        for (var i = 0; i < 8; i++) {
            html += '<div class="skeleton-row" style="opacity:' + (1 - i * 0.1) + '"></div>';
        }
        return html + "</div>";
    }

    function loadSession() {
        var bootP = API.boot().catch(function (err) {
            console.warn("[Drive] prefs.agi unavailable, using defaults", err);
            return null;
        });
        var userP = API.userInfo().catch(function () { return null; });
        var modP = API.modules().catch(function () { return null; });
        var ifP = API.interfaces().catch(function () { return []; });
        var hostP = API.hostInfo().catch(function () { return null; });

        Promise.all([bootP, userP, modP, ifP, hostP]).then(function (r) {
            var bootData = r[0], user = r[1], modules = r[2], interfaces = r[3], host = r[4];

            if (user && user.Username) {
                state.user.name = user.Username;
                state.user.icon = user.Icondata || "";
                state.user.groups = user.Usergroup || [];
            }
            if (bootData) {
                state.user.name = state.user.name || bootData.username;
                state.user.isAdmin = !!bootData.isAdmin;
                if (!state.user.groups.length) {
                    state.user.groups = bootData.groups || [];
                }
                state.settings = $.extend({}, DEFAULT_SETTINGS, bootData.settings || {});
                state.starred = new Set(bootData.starred || []);
                state.recentOpened = {};
                (bootData.recent || []).forEach(function (r) {
                    if (r && r.path) {
                        state.recentOpened[r.path] = r.time;
                    }
                });
                state.roots = bootData.roots || [];
                state.quota = bootData.quota || state.quota;
            }

            if (Array.isArray(modules)) {
                state.modules = modules;
                state.moduleByName = {};
                modules.forEach(function (m) {
                    state.moduleByName[String(m.Name).toLowerCase()] = m;
                });
                API.caps.fm = !!module("File Manager");
                API.caps.settings = !!module("System Setting");
            } else {
                //Unknown: try the REST API and fall back on the first denial
                API.caps.fm = true;
                API.caps.settings = false;
            }
            state.interfaces = Array.isArray(interfaces) ? interfaces : [];
            if (host) {
                state.hostName = host.HostName || "";
                state.version = host.BuildVersion || "";
            }
            //Only a wide screen keeps the panel open across visits; on a phone it is a sheet
            state.detailsOpen = !!state.settings.detailsOpen && window.innerWidth > 1100;

            applyTheme();

            var rootsReady = state.roots.length ? Promise.resolve() : loadRootsREST();
            rootsReady.then(function () {
                renderUser();
                renderSidebar();
                renderStorage();
                DriveHost.install();
                bindGlobalEvents();
                startNotifications();
                if (!location.hash || location.hash == "#" || location.hash == "#/") {
                    history.replaceState(null, "", href(folderRoute("user:/")));
                }
                route();
                setInterval(refreshQuota, 90000);
            });
        });
    }

    function loadRootsREST() {
        return API.request({ url: "system/file_system/listRoots" }).then(function (list) {
            state.roots = (list || []).map(function (r) {
                var uuid = String(r.RootPath).replace(":/", "");
                return { name: r.RootName, uuid: uuid, path: r.RootPath, hierarchy: uuid == "user" ? "user" : "", readonly: false, fs: "" };
            });
        }).catch(function () {
            state.roots = [{ name: "User", uuid: "user", path: "user:/", hierarchy: "user", readonly: false, fs: "" }];
        });
    }

    function refreshQuota() {
        API.quota().then(function (q) {
            if (q && q.Total !== undefined) {
                state.quota = { total: q.Total, used: q.Used };
                renderStorage();
            }
        }).catch(function () { });
    }

    /* ------------------------------------------------------------------ */
    /*  Top bar: user, notifications, help                                 */
    /* ------------------------------------------------------------------ */
    function avatarHTML(cls) {
        if (state.user.icon) {
            return '<img class="avatar ' + (cls || "") + '" src="' + esc(state.user.icon) + '" alt="">';
        }
        return '<span class="avatar ' + (cls || "") + '">' + esc((state.user.name || "?").charAt(0).toUpperCase()) + '</span>';
    }

    function userSubtitle() {
        if (state.user.groups.length) {
            return state.user.groups.join(", ");
        }
        return state.hostName ? state.user.name + "@" + state.hostName : "";
    }

    function renderUser() {
        var holder = document.getElementById("userAvatar");
        holder.outerHTML = avatarHTML().replace('class="avatar ', 'id="userAvatar" class="avatar ');
        document.getElementById("userName").textContent = state.user.name;
        document.getElementById("userSub").textContent = userSubtitle();
        document.title = T("app/title", "Drive") + (state.hostName ? " - " + state.hostName : "");
    }

    function openUserMenu() {
        var anchor = document.getElementById("userBtn");
        var node = DriveUI.el('<div class="popover" style="width:300px"></div>');
        node.innerHTML = '<div class="user-card">' + avatarHTML() + '<div style="min-width:0"><b>' + esc(state.user.name) + '</b><small>' +
            esc(userSubtitle()) + '</small></div></div><div class="popover-body" style="padding:6px"></div>';
        var body = node.querySelector(".popover-body");
        var items = [
            { icon: "sliders", label: T("user/driveSettings", "Drive settings"), action: function () { location.hash = "#/settings"; } },
            API.caps.settings ? { icon: "cog", label: T("user/systemSettings", "System Settings"), action: function () { DriveHost.openSystemSettings(); } } : null,
            state.interfaces.length > 1 ? { icon: "apps", label: T("user/switchInterface", "Switch workspace"), action: function () { window.location.href = API.ROOT + "SystemAO/boot/interface_selector.html"; } } : null,
            "-",
            { icon: "logout", label: T("user/logout", "Sign out"), danger: true, action: logout }
        ];
        items.forEach(function (item) {
            if (!item) {
                return;
            }
            if (item === "-") {
                body.appendChild(DriveUI.el('<div class="menu-sep"></div>'));
                return;
            }
            var b = DriveUI.el('<button class="menu-item' + (item.danger ? " danger" : "") + '">' + I(item.icon) + '<span class="label">' + esc(item.label) + '</span></button>');
            b.addEventListener("click", function () {
                DriveUI.closePopover();
                item.action();
            });
            body.appendChild(b);
        });
        DriveUI.openPopover(anchor, node);
    }

    function logout() {
        DriveUI.confirm({ title: T("user/logout", "Sign out"), message: T("user/logoutConfirm", "Sign out of ArozOS on this browser?"), ok: T("user/logout", "Sign out") }).then(function (ok) {
            if (!ok) {
                return;
            }
            API.logout().then(function () {
                window.location.href = API.ROOT;
            }).catch(function () {
                window.location.href = API.ROOT;
            });
        });
    }

    function openHelpMenu() {
        var anchor = document.getElementById("helpBtn");
        DriveUI.menu({ anchor: anchor, align: "end" }, [
            { icon: "keyboard", label: T("help/shortcuts", "Keyboard shortcuts"), hint: "?", action: showShortcuts },
            { icon: "info", label: T("help/about", "About Drive"), action: showAbout },
            state.interfaces.length > 1 ? { icon: "apps", label: T("user/switchInterface", "Switch workspace"), action: function () { window.location.href = API.ROOT + "SystemAO/boot/interface_selector.html"; } } : null
        ]);
    }

    function showShortcuts() {
        var rows = [
            ["shortcut/open", "Open", "Enter"], ["shortcut/preview", "Preview", "Space"],
            ["shortcut/select", "Select all", "Ctrl + A"], ["shortcut/copy", "Copy / Cut / Paste", "Ctrl + C / X / V"],
            ["shortcut/rename", "Rename", "F2"], ["shortcut/trash", "Move to trash", "Delete"],
            ["shortcut/delete", "Delete forever", "Shift + Delete"], ["shortcut/download", "Download", "Ctrl + S"],
            ["shortcut/newFolder", "New folder", "Shift + F"], ["shortcut/upload", "Upload files", "Shift + U"],
            ["shortcut/up", "Parent folder", "Backspace"], ["shortcut/details", "Show or hide details", "I"],
            ["shortcut/search", "Search", "/"], ["shortcut/move", "Move the focus", "Arrow keys"]
        ];
        var html = '<div class="shortcut-grid">' + rows.map(function (r) {
            return '<span>' + esc(T(r[0], r[1])) + '</span><span>' + r[2].split(" / ").map(function (k) {
                return k.split(" + ").map(function (p) { return '<span class="kbd">' + esc(p) + '</span>'; }).join(" + ");
            }).join(" / ") + '</span>';
        }).join("") + '</div>';
        DriveUI.modal({ title: T("help/shortcuts", "Keyboard shortcuts"), icon: "keyboard", body: html, buttons: [{ label: T("common/close", "Close"), cls: "primary" }] });
    }

    function showAbout() {
        var html = '<div style="display:flex;gap:16px;align-items:center;margin-bottom:14px">' +
            '<img src="Drive/img/module_icon.svg" width="64" height="64" alt="">' +
            '<div><b style="font-size:16px">ArozOS Drive</b><div class="muted">' + esc(T("about/desc", "A cloud drive workspace for your ArozOS files")) + '</div></div></div>' +
            '<dl class="kv"><dt>' + esc(T("about/host", "Host")) + '</dt><dd>' + esc(state.hostName || "-") + '</dd>' +
            '<dt>' + esc(T("about/version", "ArozOS")) + '</dt><dd>' + esc(state.version || "-") + '</dd>' +
            '<dt>' + esc(T("about/mode", "File access")) + '</dt><dd>' + esc(API.caps.fm ? T("about/full", "Full (File Manager API)") : T("about/reduced", "Limited (AGI fallback)")) + '</dd></dl>';
        DriveUI.modal({ title: T("help/about", "About Drive"), icon: "info", body: html, buttons: [{ label: T("common/close", "Close"), cls: "primary" }] });
    }

    /* Notifications ---------------------------------------------------- */
    function notifKey() {
        return "drive_notifications_" + state.user.name;
    }

    function loadStoredNotifications() {
        try {
            state.notifications = JSON.parse(localStorage.getItem(notifKey()) || "[]");
        } catch (e) {
            state.notifications = [];
        }
    }

    function storeNotifications() {
        try {
            localStorage.setItem(notifKey(), JSON.stringify(state.notifications.slice(0, 60)));
        } catch (e) { }
    }

    function updateBell() {
        var unread = state.notifications.filter(function (n) { return !n.read; }).length;
        var badge = document.getElementById("bellBadge");
        if (!badge) {
            return;
        }
        badge.hidden = unread == 0;
        badge.textContent = unread > 9 ? "9+" : String(unread);
    }

    function pollNotifications() {
        API.notifications().then(function (items) {
            if (!Array.isArray(items) || items.length == 0) {
                return;
            }
            var known = {};
            state.notifications.forEach(function (n) { known[n.id] = true; });
            items.forEach(function (item) {
                if (item.id && known[item.id]) {
                    return;
                }
                item.read = false;
                state.notifications.unshift(item);
                DriveUI.toast((item.title || T("notif/title", "Notification")) + (item.message ? ": " + item.message : ""), {
                    action: notificationTarget(item) ? { label: T("notif/open", "Open"), fn: function () { openNotification(item); } } : null
                });
            });
            storeNotifications();
            updateBell();
        }).catch(function () { });
    }

    function startNotifications() {
        loadStoredNotifications();
        updateBell();
        pollNotifications();
        setInterval(pollNotifications, 15000);
    }

    function notificationTarget(item) {
        if (!item.payload) {
            return null;
        }
        try {
            var p = JSON.parse(item.payload);
            if (p && typeof p.url === "string") {
                return p;
            }
        } catch (e) { }
        return null;
    }

    function openNotification(item) {
        var target = notificationTarget(item);
        item.read = true;
        storeNotifications();
        updateBell();
        if (target) {
            DriveHost.open({ url: target.url, title: target.title || item.title, icon: target.appicon });
        }
    }

    function openNotifications() {
        var anchor = document.getElementById("bellBtn");
        var node = DriveUI.el('<div class="popover"><div class="popover-head">' + I("bell") + '<span>' + esc(T("top/notifications", "Notifications")) +
            '</span><span class="spacer"></span><button class="btn ghost small" data-act="read">' + esc(T("notif/markRead", "Mark all read")) +
            '</button><button class="icon-btn small" data-act="clear" title="' + esc(T("notif/clear", "Clear all")) + '">' + I("trash") + '</button></div>' +
            '<div class="popover-body"></div></div>');
        var body = node.querySelector(".popover-body");
        function paint() {
            if (state.notifications.length == 0) {
                body.innerHTML = '<div class="state" style="padding:36px 16px">' + I("bell", { size: 34 }) + '<p>' + esc(T("notif/none", "You are all caught up")) + '</p></div>';
                return;
            }
            body.innerHTML = "";
            state.notifications.forEach(function (n) {
                var clickable = !!notificationTarget(n);
                var row = DriveUI.el('<div class="notif' + (n.read ? "" : " unread") + (clickable ? " clickable" : "") + '">' +
                    '<div class="dot ' + (n.priority == "high" || n.priority == "critical" ? "high" : "") + '">' + I(n.priority == "high" ? "alert" : "bell") + '</div>' +
                    '<div class="body"><b>' + esc(n.title || T("notif/title", "Notification")) + '</b>' +
                    (n.message ? '<p>' + esc(n.message) + '</p>' : "") +
                    '<small>' + esc((n.sender ? n.sender + " · " : "") + DriveUI.fmtRelative(n.timestamp)) + '</small></div></div>');
                if (clickable) {
                    row.addEventListener("click", function () {
                        DriveUI.closePopover();
                        openNotification(n);
                    });
                }
                body.appendChild(row);
            });
        }
        node.querySelector('[data-act="read"]').addEventListener("click", function () {
            state.notifications.forEach(function (n) { n.read = true; });
            storeNotifications();
            updateBell();
            paint();
        });
        node.querySelector('[data-act="clear"]').addEventListener("click", function () {
            state.notifications = [];
            storeNotifications();
            updateBell();
            paint();
        });
        paint();
        DriveUI.openPopover(anchor, node, {
            onClose: function () {
                state.notifications.forEach(function (n) { n.read = true; });
                storeNotifications();
                updateBell();
            }
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Sidebar                                                            */
    /* ------------------------------------------------------------------ */
    function navItem(route, icon, label, extra) {
        extra = extra || {};
        return '<a class="nav-item" href="' + esc(href(route)) + '" data-route="' + esc(extra.key || route) + '"' +
            (extra.drop ? ' data-drop="' + esc(extra.drop) + '"' : "") + (extra.title ? ' title="' + esc(extra.title) + '"' : "") + '>' +
            I(icon) + '<span>' + esc(label) + '</span>' + (extra.small ? '<small>' + esc(extra.small) + '</small>' : "") + '</a>';
    }

    function renderSidebar() {
        var nav = document.getElementById("sidebarNav");
        var html = '<nav class="nav-group">' +
            navItem(folderRoute("user:/"), "home", T("nav/myDrive", "My Drive"), { key: "drive:user", drop: "user:/" }) +
            navItem("#/shared", "users", T("nav/shared", "Shared with me"), { key: "shared" }) +
            navItem("#/recent", "clock", T("nav/recent", "Recent"), { key: "recent" }) +
            navItem("#/starred", "star", T("nav/starred", "Starred"), { key: "starred" }) +
            navItem("#/trash", "trash", T("nav/trash", "Trash"), { key: "trash" }) +
            '</nav>';
        var others = state.roots.filter(function (r) { return r.uuid != "user"; });
        if (others.length) {
            html += '<div class="nav-sep"></div><div class="nav-title">' + esc(T("nav/drives", "Storage")) + '</div><nav class="nav-group">';
            others.forEach(function (r) {
                html += navItem(folderRoute(r.path), rootIcon(r), rootLabel(r), {
                    key: "drive:" + r.uuid, drop: r.readonly ? "" : r.path, title: rootLabel(r) + " (" + r.path + ")",
                    small: r.readonly ? T("nav/readonly", "Read only") : ""
                });
            });
            html += '</nav>';
        }
        html += '<div class="nav-sep"></div><div class="nav-title">' + esc(T("nav/categories", "Categories")) + '</div><nav class="nav-group">' +
            navItem("#/category/documents", "doc", T("cat/documents", "Documents"), { key: "category:documents" }) +
            navItem("#/category/photos", "image", T("cat/photos", "Photos"), { key: "category:photos" }) +
            navItem("#/category/videos", "video", T("cat/videos", "Videos"), { key: "category:videos" }) +
            navItem("#/category/music", "music", T("cat/music", "Music"), { key: "category:music" }) +
            navItem("#/category/others", "layers", T("cat/others", "Others"), { key: "category:others" }) +
            '</nav>';
        nav.innerHTML = html;
        nav.querySelectorAll(".nav-item").forEach(function (a) {
            a.addEventListener("click", function () {
                closeDrawer();
                if (DriveHost.isVisible()) {
                    DriveHost.hide();
                }
                if (a.getAttribute("href") == href(location.hash)) {
                    refresh();
                }
            });
        });
        DriveList.bindDropTargets(nav);
        highlightNav();
    }

    function navKey() {
        var r = state.route;
        if (!r) {
            return "";
        }
        if (r.kind == "drive") {
            return "drive:" + rootIdOf(r.arg || "user:/");
        }
        if (r.kind == "category") {
            return "category:" + r.arg;
        }
        return r.kind;
    }

    function highlightNav() {
        var key = navKey();
        document.querySelectorAll("#sidebarNav .nav-item, #storage .storage-card").forEach(function (a) {
            a.classList.toggle("active", a.getAttribute("data-route") == key);
        });
    }

    function renderStorage() {
        var box = document.getElementById("storage");
        var q = state.quota;
        var text, pct = 0;
        if (q.total > 0) {
            pct = Math.min(100, q.used / q.total * 100);
            text = T("storage/usedOf", "{used} of {total} used", { used: DriveUI.fmtSize(q.used), total: DriveUI.fmtSize(q.total) });
        } else {
            text = T("storage/usedUnlimited", "{used} used · no quota", { used: DriveUI.fmtSize(q.used || 0) });
        }
        box.innerHTML = '<a class="storage-card" href="' + esc(href("#/storage")) + '" data-route="storage">' +
            '<div class="storage-head">' + I("cloud") + '<span>' + esc(T("storage/title", "Storage")) + '</span></div>' +
            '<div class="meter"><i class="' + (pct > 95 ? "full" : pct > 80 ? "warn" : "") + '" style="width:' + (q.total > 0 ? pct.toFixed(1) : 2) + '%"></i></div>' +
            '<div class="storage-text">' + esc(text) + '</div></a>';
        var link = box.querySelector(".storage-card");
        link.classList.toggle("active", navKey() == "storage");
        link.addEventListener("click", function () {
            closeDrawer();
            if (DriveHost.isVisible()) {
                DriveHost.hide();
            }
            if (location.hash == "#/storage") {
                route();
            }
        });
    }

    function openDrawer() {
        document.documentElement.classList.add("nav-open");
    }

    function closeDrawer() {
        document.documentElement.classList.remove("nav-open");
    }

    /* ------------------------------------------------------------------ */
    /*  Routing and views                                                  */
    /* ------------------------------------------------------------------ */
    function parseRoute() {
        var h = location.hash.replace(/^#\/?/, "");
        var query = "";
        var qi = h.indexOf("?");
        if (qi >= 0) {
            query = h.substring(qi + 1);
            h = h.substring(0, qi);
        }
        var seg = h.split("/");
        var kind = seg[0] || "drive";
        var arg = "";
        try {
            arg = decodeURIComponent(seg.slice(1).join("/"));
        } catch (e) {
            arg = seg.slice(1).join("/");
        }
        var params = {};
        query.split("&").forEach(function (kv) {
            if (!kv) {
                return;
            }
            var p = kv.split("=");
            try {
                params[decodeURIComponent(p[0])] = decodeURIComponent(p.slice(1).join("="));
            } catch (e) { }
        });
        return { kind: kind, arg: arg, params: params };
    }

    function colDefault() {
        return [
            { key: "mtime", label: T("col/modified", "Modified"), cls: "col-mtime" },
            { key: "size", label: T("col/size", "Size"), cls: "col-size" },
            { key: "type", label: T("col/type", "Type"), cls: "col-type" }
        ];
    }

    function colWithLocation() {
        return [
            { key: "mtime", label: T("col/modified", "Modified"), cls: "col-mtime" },
            { key: "size", label: T("col/size", "Size"), cls: "col-size" },
            { key: "location", label: T("col/location", "Location"), cls: "col-type" }
        ];
    }

    function buildView(r) {
        var v;
        switch (r.kind) {
            case "shared":
                var byMe = r.params.tab == "byme";
                v = {
                    kind: "shared", key: "shared:" + (byMe ? "byme" : "withme"),
                    crumbs: [{ label: T("nav/shared", "Shared with me") }],
                    subtitle: byMe ? T("sub/sharedByMe", "Links you have created") : T("sub/sharedWithMe", "Files other people shared with you"),
                    tabs: [
                        { label: T("shared/withMe", "Shared with me"), route: "#/shared", active: !byMe },
                        { label: T("shared/byMe", "Shared by me"), route: "#/shared?tab=byme", active: byMe }
                    ],
                    toolbar: "items",
                    columns: [
                        { key: "owner", label: T("col/owner", "Owner"), cls: "col-mtime" },
                        { key: "access", label: T("col/access", "Who has access"), cls: "col-size" },
                        { key: "expire", label: T("col/expires", "Expires"), cls: "col-type" }
                    ],
                    noSize: true,
                    empty: byMe ?
                        { icon: "link", title: T("empty/sharedByMe", "You have not shared anything yet"), text: T("empty/sharedByMeText", "Select a file and press Share to create a link.") } :
                        { icon: "users", title: T("empty/shared", "Nothing shared with you yet"), text: T("empty/sharedText", "Files and folders other people share with you appear here.") },
                    load: function () { return loadShares(byMe); }
                };
                if (!API.caps.fm) {
                    v.load = function () { return Promise.resolve([]); };
                    v.empty = { icon: "lock", title: T("empty/needFM", "Not available in limited mode"), text: T("empty/needFMText", "Your account does not have the File Manager permission this view needs.") };
                }
                return v;
            case "recent":
                return {
                    kind: "recent", key: "recent",
                    crumbs: [{ label: T("nav/recent", "Recent") }],
                    subtitle: T("sub/recent", "Files you opened or changed in the last 30 days"),
                    toolbar: "items",
                    columns: [
                        { key: "activity", label: T("col/activity", "Last activity"), cls: "col-mtime" },
                        { key: "size", label: T("col/size", "Size"), cls: "col-size" },
                        { key: "location", label: T("col/location", "Location"), cls: "col-type" }
                    ],
                    fixedSort: { key: "activity", dir: "desc" },
                    showLocation: true,
                    empty: { icon: "clock", title: T("empty/recent", "No recent files"), text: T("empty/recentText", "Files you open or edit show up here.") },
                    load: loadRecent
                };
            case "starred":
                return {
                    kind: "starred", key: "starred",
                    crumbs: [{ label: T("nav/starred", "Starred") }],
                    subtitle: T("sub/starred", "Quick access to the items you starred"),
                    toolbar: "items",
                    columns: colWithLocation(),
                    showLocation: true,
                    empty: { icon: "star", title: T("empty/starred", "No starred items"), text: T("empty/starredText", "Star files and folders you use often to find them here.") },
                    load: loadStarred
                };
            case "trash":
                v = {
                    kind: "trash", key: "trash",
                    crumbs: [{ label: T("nav/trash", "Trash") }],
                    subtitle: T("sub/trash", "Items in the trash are removed for good after the retention period"),
                    toolbar: "trash",
                    columns: [
                        { key: "mtime", label: T("col/deleted", "Deleted"), cls: "col-mtime" },
                        { key: "size", label: T("col/size", "Size"), cls: "col-size" },
                        { key: "origin", label: T("col/origin", "Original location"), cls: "col-type" }
                    ],
                    fixedSort: null,
                    empty: { icon: "trash", title: T("empty/trash", "Trash is empty"), text: T("empty/trashText", "Items you delete are kept here until the trash is emptied.") },
                    load: function () { return API.trashList(); }
                };
                if (!API.caps.fm) {
                    v.load = function () { return Promise.resolve([]); };
                    v.empty = { icon: "lock", title: T("empty/needFM", "Not available in limited mode"), text: T("empty/trashNeedFM", "Without the File Manager permission deleted files are removed immediately.") };
                }
                return v;
            case "category":
                var group = ["documents", "photos", "videos", "music", "others"].indexOf(r.arg) >= 0 ? r.arg : "documents";
                var labels = { documents: T("cat/documents", "Documents"), photos: T("cat/photos", "Photos"), videos: T("cat/videos", "Videos"), music: T("cat/music", "Music"), others: T("cat/others", "Others") };
                var icons = { documents: "doc", photos: "image", videos: "video", music: "music", others: "layers" };
                return {
                    kind: "category", key: "category:" + group, group: group,
                    crumbs: [{ label: labels[group] }],
                    subtitle: T("sub/category", "Newest {what} in My Drive", { what: labels[group].toLowerCase() }),
                    toolbar: "items",
                    columns: colWithLocation(),
                    showLocation: true,
                    defaultView: group == "photos" || group == "videos" ? "grid" : null,
                    empty: { icon: icons[group], title: T("empty/category", "Nothing here yet"), text: T("empty/categoryText", "Files of this kind in My Drive appear here.") },
                    load: function () { return loadCategory(group); }
                };
            case "search":
                var scope = normDir(r.params["in"] || "user:/");
                return {
                    kind: "search", key: "search:" + r.arg + "@" + scope, query: r.arg, scope: scope,
                    crumbs: [{ label: T("search/title", "Search results") }],
                    subtitle: T("search/sub", "\"{q}\" in {where}", { q: r.arg, where: pathParts(scope).map(function (p) { return p.label; }).join(" / ") }),
                    toolbar: "items",
                    columns: colWithLocation(),
                    showLocation: true,
                    empty: { icon: "search", title: T("empty/search", "No matching files"), text: T("empty/searchText", "Try another keyword, or search a different location.") },
                    load: function () { return API.search(scope, r.arg); }
                };
            case "storage":
                return {
                    kind: "storage", key: "storage", page: true,
                    crumbs: [{ label: T("storage/title", "Storage") }],
                    subtitle: T("sub/storage", "Your share of the storage pool on this ArozOS server"),
                    toolbar: "none"
                };
            case "settings":
                return {
                    kind: "settings", key: "settings", page: true,
                    crumbs: [{ label: T("user/driveSettings", "Drive settings") }],
                    subtitle: T("sub/settings", "These settings only apply to Drive. System wide options live in System Settings."),
                    toolbar: "none"
                };
            default:
                var path = normDir(r.arg || "user:/");
                var root = rootOf(path);
                var parts = pathParts(path);
                var isRoot = parts.length == 1;
                return {
                    kind: "drive", key: "drive:" + path, path: path, folder: path, root: root,
                    crumbs: parts.map(function (p) { return { label: p.label, path: p.path }; }),
                    subtitle: isRoot ? (root && root.uuid == "user" ? T("sub/myDrive", "Personal storage space") :
                        (root ? (root.readonly ? T("sub/readonlyRoot", "{name} · read only", { name: root.path }) : root.path) : "")) : "",
                    toolbar: "folder",
                    writable: isWritable(path),
                    columns: colDefault(),
                    empty: {
                        icon: "folderOpen", title: T("empty/folder", "This folder is empty"),
                        text: isWritable(path) ? T("empty/folderText", "Drop files here or use the New button to add something.") : T("empty/readonlyText", "This location is read only."),
                        action: isWritable(path) ? { label: T("toolbar/upload", "Upload"), icon: "upload", fn: function () { DriveActions.upload(); } } : null
                    },
                    load: function () { return loadFolder(path); }
                };
        }
    }

    function loadFolder(path) {
        return API.list(path, state.settings.showHidden).catch(function (err) {
            if (API.caps.fm && /permission denied/i.test(err.message)) {
                //No File Manager permission after all: switch to the reduced mode
                API.caps.fm = false;
                return API.list(path, state.settings.showHidden);
            }
            throw err;
        }).then(function (items) {
            return (items || []).filter(function (i) {
                return state.settings.showHidden || i.name.charAt(0) != ".";
            });
        });
    }

    function loadShares(byMe) {
        return API.shareList().then(function (list) {
            return (list || []).filter(function (s) {
                return byMe ? s.IsOwnerOfShare : (!s.IsOwnerOfShare && s.CanAccess);
            }).map(function (s) {
                return {
                    name: API.baseName(s.FileVirtualPath) || s.FileVirtualPath,
                    path: s.FileVirtualPath,
                    isDir: s.IsFolder,
                    size: -1,
                    mtime: 0,
                    share: s,
                    owner: s.Owner,
                    shareOnly: !byMe && !s.CanOpenInFileManager
                };
            });
        });
    }

    function loadRecent() {
        return Promise.all([
            API.recentOpened().catch(function () { return []; }),
            API.scan({ mode: "recent", days: 30, limit: 200 }).catch(function () { return { items: [] }; })
        ]).then(function (r) {
            var map = {};
            (r[0] || []).forEach(function (i) {
                i.activity = Math.max(i.opened || 0, i.mtime || 0);
                i.openedLast = (i.opened || 0) >= (i.mtime || 0);
                map[i.path] = i;
            });
            ((r[1] && r[1].items) || []).forEach(function (i) {
                if (map[i.path]) {
                    return;
                }
                i.activity = i.mtime;
                i.openedLast = false;
                map[i.path] = i;
            });
            return Object.keys(map).map(function (k) { return map[k]; });
        });
    }

    function loadStarred() {
        return API.starred().then(function (r) {
            if (r.missing && r.missing.length) {
                r.missing.forEach(function (p) { state.starred.delete(p); });
                API.star(r.missing, false).catch(function () { });
            }
            return r.items || [];
        });
    }

    function knownExtensions() {
        var all = [];
        ["documents", "photos", "videos", "music"].forEach(function (g) {
            all = all.concat(DriveIcons.extensionsOf(g));
        });
        return all;
    }

    function loadCategory(group) {
        var opts = { mode: "ext", limit: 500 };
        if (group == "others") {
            opts.exts = "[]";
            opts.exclude = JSON.stringify(knownExtensions());
        } else {
            opts.exts = JSON.stringify(DriveIcons.extensionsOf(group));
        }
        return API.scan(opts).then(function (r) {
            state.view.truncated = !!(r && r.truncated);
            state.view.total = r ? r.total : 0;
            return (r && r.items) || [];
        });
    }

    function route() {
        var r = parseRoute();
        var prevKey = state.view ? state.view.key : null;
        state.route = r;
        var view = buildView(r);
        var sameView = prevKey == view.key;
        state.view = view;
        if (!sameView) {
            state.selection.clear();
            state.anchor = null;
            state.focus = null;
            state.page = 1;
        }
        highlightNav();
        closeDrawer();
        DriveUI.closeMenus(0);
        renderHead();
        var wrap = document.getElementById("listWrap");
        wrap.classList.toggle("is-settings", !!view.page);
        if (view.page) {
            state.items = [];
            document.getElementById("paneFoot").hidden = true;
            document.getElementById("paneBanner").innerHTML = "";
            if (view.kind == "storage") {
                DriveStorage.render(wrap);
            } else {
                DriveSettings.render(wrap);
            }
            DriveDetails.close(true);
            return;
        }
        document.getElementById("paneFoot").hidden = false;
        renderBanner();
        load(!sameView);
    }

    function load(showSkeleton) {
        var view = state.view;
        var token = ++state.loadToken;
        state.loading = true;
        state.loadError = null;
        if (showSkeleton) {
            state.items = [];
            document.getElementById("listWrap").innerHTML = skeletonRows();
            renderFoot();
        }
        view.load().then(function (items) {
            if (token != state.loadToken) {
                return;
            }
            state.loading = false;
            state.items = items || [];
            //Drop selections that no longer exist
            var paths = {};
            state.items.forEach(function (i) { paths[i.path] = true; });
            state.selection.forEach(function (p) {
                if (!paths[p]) {
                    state.selection.delete(p);
                }
            });
            if (view.kind == "drive") {
                view.subtitle = view.subtitle || "";
            }
            renderHead();
            renderBanner();
            DriveList.render();
            DriveDetails.invalidate();
            DriveDetails.refresh();
        }).catch(function (err) {
            if (token != state.loadToken) {
                return;
            }
            state.loading = false;
            state.loadError = err;
            state.items = [];
            document.getElementById("listWrap").innerHTML = '<div class="state">' + I("alert", { size: 40 }) +
                '<h3>' + esc(T("err/loadTitle", "This location cannot be opened")) + '</h3><p>' + esc(T("srv/" + err.message, err.message)) + '</p>' +
                '<button class="btn" id="retryBtn">' + I("refresh") + esc(T("common/retry", "Try again")) + '</button></div>';
            document.getElementById("retryBtn").addEventListener("click", function () { refresh(); });
            renderFoot();
        });
    }

    function refresh() {
        if (!state.view || state.view.kind == "settings") {
            return;
        }
        if (state.view.kind == "storage") {
            DriveStorage.render(document.getElementById("listWrap"));
            return;
        }
        load(false);
    }

    /* ------------------------------------------------------------------ */
    /*  View header and toolbar                                            */
    /* ------------------------------------------------------------------ */
    function renderHead() {
        var view = state.view;
        var head = document.getElementById("paneHead");
        var crumbsHTML = "";
        var crumbs = view.crumbs || [];
        //Long paths keep the root and the last two folders
        var shown = crumbs;
        var collapsed = [];
        if (crumbs.length > 4) {
            shown = [crumbs[0], { more: true }].concat(crumbs.slice(-2));
            collapsed = crumbs.slice(1, -2);
        }
        shown.forEach(function (c, i) {
            if (i > 0) {
                crumbsHTML += '<span class="crumb-sep">' + I("chevronRight") + '</span>';
            }
            if (c.more) {
                crumbsHTML += '<button class="crumb crumb-more" data-more>' + I("moreH") + '</button>';
                return;
            }
            var isLast = i == shown.length - 1;
            if (isLast) {
                var menuable = view.kind == "drive";
                crumbsHTML += '<button class="crumb current" ' + (menuable ? 'data-folder-menu' : '') + (c.path ? ' data-drop="' + esc(c.path) + '"' : "") + '>' +
                    '<span style="overflow:hidden;text-overflow:ellipsis">' + esc(c.label) + '</span>' + (menuable ? I("chevronDown") : "") + '</button>';
            } else {
                crumbsHTML += '<a class="crumb" href="' + esc(href(folderRoute(c.path))) + '" data-drop="' + esc(c.path) + '">' + esc(c.label) + '</a>';
            }
        });

        var tools = '';
        if (view.toolbar != "none") {
            var gridOn = currentViewMode() == "grid";
            tools = '<div class="view-tools">' +
                '<div class="segmented hide-xs" role="group">' +
                '<button data-mode="list" class="' + (gridOn ? "" : "active") + '" title="' + esc(T("view/list", "List view")) + '">' + I("list") + '</button>' +
                '<button data-mode="grid" class="' + (gridOn ? "active" : "") + '" title="' + esc(T("view/grid", "Grid view")) + '">' + I("grid") + '</button></div>' +
                (view.fixedSort ? "" : '<button class="btn seg-sort" id="sortBtn">' + I(sortState().dir == "asc" ? "sortAsc" : "sortDesc") +
                    '<span class="lbl">' + esc(sortLabel(sortState().key)) + '</span>' + I("chevronDown", { cls: "caret" }) + '</button>') +
                '<button class="icon-btn' + (state.detailsOpen ? " active" : "") + '" id="detailsBtn" title="' + esc(T("view/details", "Show details")) + '">' + I("panel") + '</button>' +
                '</div>';
        }

        var html = '<div class="title-row"><div class="title-block"><div class="crumbs">' + crumbsHTML + '</div>' +
            '<div class="subtitle">' + esc(view.subtitle || "") + '</div></div>' + tools + '</div>';

        if (view.tabs) {
            html += '<div class="tabs" style="margin:10px -12px 0;padding:0 12px">' + view.tabs.map(function (t) {
                return '<a class="tab' + (t.active ? " active" : "") + '" href="' + esc(href(t.route)) + '">' + esc(t.label) + '</a>';
            }).join("") + '</div>';
        }

        if (view.toolbar != "none") {
            html += '<div class="toolbar" id="toolbar"></div>';
        }
        head.innerHTML = html;

        var more = head.querySelector("[data-more]");
        if (more) {
            more.addEventListener("click", function () {
                DriveUI.menu({ anchor: more }, collapsed.map(function (c) {
                    return { icon: "folder", label: c.label, action: function () { location.hash = folderRoute(c.path); } };
                }));
            });
        }
        var fm = head.querySelector("[data-folder-menu]");
        if (fm) {
            fm.addEventListener("click", function () {
                DriveActions.folderMenu({ anchor: fm });
            });
        }
        head.querySelectorAll("[data-mode]").forEach(function (b) {
            b.addEventListener("click", function () {
                setViewMode(b.getAttribute("data-mode"));
            });
        });
        var sortBtn = head.querySelector("#sortBtn");
        if (sortBtn) {
            sortBtn.addEventListener("click", function () { openSortMenu(sortBtn); });
        }
        var detailsBtn = head.querySelector("#detailsBtn");
        if (detailsBtn) {
            detailsBtn.addEventListener("click", function () { toggleDetails(); });
        }
        DriveList.bindDropTargets(head);
        renderToolbar();
    }

    function tb(id, icon, label, opts) {
        opts = opts || {};
        return '<button class="btn ' + (opts.cls || "") + '" id="' + id + '"' + (opts.disabled ? " disabled" : "") +
            ' title="' + esc(opts.title || label) + '">' + I(icon) + '<span class="lbl">' + esc(label) + '</span>' +
            (opts.caret ? I("chevronDown", { cls: "caret" }) : "") + '</button>';
    }

    function renderToolbar() {
        var bar = document.getElementById("toolbar");
        if (!bar) {
            return;
        }
        var view = state.view;
        var sel = selectedItems();
        var n = sel.length;
        var html = "";
        if (view.toolbar == "folder") {
            var w = view.writable;
            html += tb("tbNew", "plus", T("toolbar/new", "New"), { cls: "primary", caret: true, disabled: !w });
            html += tb("tbUpload", "upload", T("toolbar/upload", "Upload"), { disabled: !w });
            html += tb("tbShare", "link", T("toolbar/share", "Share"), { disabled: n > 1 || (n == 0 && pathParts(view.path).length == 1) });
            html += tb("tbMove", "move", T("toolbar/move", "Move"), { disabled: n == 0 || !w });
            html += tb("tbMore", "moreH", T("toolbar/more", "More"), { caret: true });
        } else if (view.toolbar == "items") {
            html += tb("tbShare", "link", T("toolbar/share", "Share"), { disabled: n != 1 });
            html += tb("tbDownload", "download", T("toolbar/download", "Download"), { disabled: n == 0 });
            html += tb("tbMove", "move", T("toolbar/move", "Move"), { disabled: n == 0 || view.kind == "shared" });
            html += tb("tbMore", "moreH", T("toolbar/more", "More"), { caret: true });
        } else if (view.toolbar == "trash") {
            html += tb("tbRestore", "restore", T("trash/restore", "Restore"), { cls: "primary", disabled: n == 0 });
            html += tb("tbPurge", "trash", T("trash/deleteForever", "Delete forever"), { disabled: n == 0 });
            html += tb("tbEmpty", "x", T("trash/empty", "Empty trash"), { disabled: state.items.length == 0 });
        }
        bar.innerHTML = html;

        var on = function (id, fn) {
            var b = document.getElementById(id);
            if (b) {
                b.addEventListener("click", function (e) { fn(b, e); });
            }
        };
        on("tbNew", function (b) { DriveActions.newMenu({ anchor: b }); });
        on("tbUpload", function () { DriveActions.upload(); });
        on("tbShare", function () {
            var s = selectedItems();
            if (s.length == 1) {
                DriveShare.open(s[0]);
            } else if (state.view.kind == "drive") {
                DriveShare.open(currentFolderItem());
            }
        });
        on("tbMove", function () { DriveActions.moveTo(selectedItems()); });
        on("tbDownload", function () { DriveActions.download(selectedItems()); });
        on("tbMore", function (b) { DriveActions.moreMenu({ anchor: b }); });
        on("tbRestore", function () { DriveActions.restore(selectedItems()); });
        on("tbPurge", function () { DriveActions.deleteForever(selectedItems()); });
        on("tbEmpty", function () { DriveActions.emptyTrash(); });
    }

    function renderBanner() {
        var box = document.getElementById("paneBanner");
        var html = "";
        var view = state.view;
        if (!API.caps.fm && view && view.kind == "drive") {
            html = '<div class="banner">' + I("alert") + '<span>' + esc(T("banner/reduced", "Limited mode: your account cannot use the File Manager service, so deleting is permanent and some actions are unavailable.")) + '</span></div>';
        } else if (view && view.kind == "drive" && !view.writable) {
            html = '<div class="banner info">' + I("lock") + '<span>' + esc(T("banner/readonly", "This location is read only. You can open and download files but not change them.")) + '</span></div>';
        } else if (view && view.truncated) {
            html = '<div class="banner info">' + I("info") + '<span>' + esc(T("banner/truncated", "Showing the newest results found so far. Your drive is large, so the scan stopped early.")) + '</span></div>';
        }
        box.innerHTML = html;
    }

    function renderFoot() {
        var foot = document.getElementById("paneFoot");
        if (!state.view || state.view.page) {
            return;
        }
        var total = state.items.length;
        var n = state.selection.size;
        var text = state.loading ? T("foot/loading", "Loading...") :
            (total == 1 ? T("foot/item", "{n} item", { n: total }) : T("foot/items", "{n} items", { n: total }));
        var html = '<span>' + esc(text) + '</span>';
        //The selection lives down here, not in the toolbar: a chip appearing
        //up there made the toolbar wrap on phones and pushed the list down
        //between the two taps of a double tap
        if (n > 0) {
            html += '<span class="select-bar">' + esc(T("sel/count", "{n} selected", { n: n })) +
                '<button class="icon-btn small" data-clear-sel title="' + esc(T("sel/clear", "Clear selection")) + '">' + I("x") + '</button></span>';
        }
        var pages = DriveList.pageCount();
        if (pages > 1) {
            var p = state.page;
            html += '<div class="pager"><button data-page="' + (p - 1) + '"' + (p <= 1 ? " disabled" : "") + ' aria-label="' + esc(T("pager/prev", "Previous page")) + '">' + I("chevronLeft") + '</button>';
            var list = [];
            for (var i = 1; i <= pages; i++) {
                if (i == 1 || i == pages || Math.abs(i - p) <= 1) {
                    list.push(i);
                } else if (list[list.length - 1] != "...") {
                    list.push("...");
                }
            }
            list.forEach(function (x) {
                html += x == "..." ? '<span class="muted">...</span>' : '<button data-page="' + x + '" class="' + (x == p ? "active" : "") + '">' + x + '</button>';
            });
            html += '<button data-page="' + (p + 1) + '"' + (p >= pages ? " disabled" : "") + ' aria-label="' + esc(T("pager/next", "Next page")) + '">' + I("chevronRight") + '</button></div>';
        }
        foot.innerHTML = html;
        var clear = foot.querySelector("[data-clear-sel]");
        if (clear) {
            clear.addEventListener("click", function () { setSelection([]); });
        }
        foot.querySelectorAll("[data-page]").forEach(function (b) {
            b.addEventListener("click", function () {
                state.page = parseInt(b.getAttribute("data-page"), 10);
                DriveList.render();
                document.getElementById("listWrap").scrollTop = 0;
            });
        });
    }

    /* View mode and sorting ----------------------------------------------- */
    function currentViewMode() {
        var v = state.view;
        if (v && v.viewOverride) {
            return v.viewOverride;
        }
        if (v && v.defaultView && !state.settings["viewSet_" + v.kind]) {
            return v.defaultView;
        }
        return state.settings.view;
    }

    function setViewMode(mode) {
        if (state.view && state.view.defaultView) {
            state.view.viewOverride = mode;
        } else {
            saveSettings({ view: mode }, true);
        }
        renderHead();
        DriveList.render();
    }

    function sortState() {
        var v = state.view;
        if (v && v.fixedSort) {
            return v.fixedSort;
        }
        if (v && v.sortOverride) {
            return v.sortOverride;
        }
        return { key: state.settings.sortKey, dir: state.settings.sortDir };
    }

    function sortLabel(key) {
        var labels = {
            name: T("col/name", "Name"), mtime: T("col/modified", "Modified"), size: T("col/size", "Size"),
            type: T("col/type", "Type"), owner: T("col/owner", "Owner"), access: T("col/access", "Who has access"),
            expire: T("col/expires", "Expires"), location: T("col/location", "Location"), origin: T("col/origin", "Original location"),
            activity: T("col/activity", "Last activity")
        };
        return labels[key] || key;
    }

    function setSort(key, dir) {
        var v = state.view;
        var global = ["name", "mtime", "size", "type"].indexOf(key) >= 0 && v.kind == "drive";
        if (global) {
            saveSettings({ sortKey: key, sortDir: dir }, true);
            v.sortOverride = null;
        } else {
            v.sortOverride = { key: key, dir: dir };
        }
        renderHead();
        DriveList.render();
    }

    function toggleSortColumn(key) {
        var s = sortState();
        if (state.view.fixedSort) {
            return;
        }
        setSort(key, s.key == key && s.dir == "asc" ? "desc" : "asc");
    }

    function openSortMenu(anchor) {
        var s = sortState();
        var keys = ["name"].concat(state.view.columns.map(function (c) { return c.key; }));
        var items = [{ title: T("sort/by", "Sort by") }];
        keys.forEach(function (k) {
            items.push({ checkable: true, checked: s.key == k, label: sortLabel(k), action: function () { setSort(k, s.dir); } });
        });
        items.push("-", { title: T("sort/order", "Order") });
        items.push({ checkable: true, checked: s.dir == "asc", label: T("sort/asc", "Ascending"), action: function () { setSort(s.key, "asc"); } });
        items.push({ checkable: true, checked: s.dir == "desc", label: T("sort/desc", "Descending"), action: function () { setSort(s.key, "desc"); } });
        items.push("-");
        items.push({ checkable: true, checked: state.settings.foldersFirst, label: T("sort/foldersFirst", "Folders on top"), action: function () { saveSettings({ foldersFirst: !state.settings.foldersFirst }); DriveList.render(); } });
        DriveUI.menu({ anchor: anchor, align: "end" }, items);
    }

    /* ------------------------------------------------------------------ */
    /*  Selection                                                          */
    /* ------------------------------------------------------------------ */
    function itemByPath(path) {
        for (var i = 0; i < state.items.length; i++) {
            if (state.items[i].path == path) {
                return state.items[i];
            }
        }
        return null;
    }

    function selectedItems() {
        var out = [];
        state.sorted.forEach(function (i) {
            if (state.selection.has(i.path)) {
                out.push(i);
            }
        });
        if (out.length != state.selection.size) {
            //Selected on another page
            state.items.forEach(function (i) {
                if (state.selection.has(i.path) && out.indexOf(i) < 0) {
                    out.push(i);
                }
            });
        }
        return out;
    }

    function setSelection(paths, opts) {
        opts = opts || {};
        state.selection = new Set(paths);
        if (opts.anchor !== undefined) {
            state.anchor = opts.anchor;
        }
        if (opts.focus !== undefined) {
            state.focus = opts.focus;
        }
        selectionChanged();
    }

    function selectionChanged() {
        DriveList.updateSelection();
        renderToolbar();
        renderFoot();
        DriveDetails.refresh();
    }

    function currentFolderItem() {
        var v = state.view;
        if (!v || v.kind != "drive") {
            return null;
        }
        var parts = pathParts(v.path);
        return { name: parts[parts.length - 1].label, path: v.path.replace(/\/$/, ""), isDir: true, size: -1, mtime: 0, isCurrentFolder: true, isRoot: parts.length == 1 };
    }

    /* Details panel ---------------------------------------------------- */
    function toggleDetails(force) {
        state.detailsOpen = force === undefined ? !state.detailsOpen : !!force;
        document.documentElement.classList.toggle("details-open", state.detailsOpen);
        var btn = document.getElementById("detailsBtn");
        if (btn) {
            btn.classList.toggle("active", state.detailsOpen);
        }
        if (state.detailsOpen) {
            DriveDetails.open();
        } else {
            DriveDetails.close();
        }
        if (window.innerWidth > 1100) {
            saveSettings({ detailsOpen: state.detailsOpen }, true);
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Search                                                             */
    /* ------------------------------------------------------------------ */
    function defaultScope() {
        var v = state.view;
        if (v && v.kind == "drive") {
            return v.path;
        }
        if (v && v.kind == "search") {
            return v.scope;
        }
        return "user:/";
    }

    function scopeLabel(path) {
        var parts = pathParts(path);
        return parts[parts.length - 1].label;
    }

    function updateScopeChip() {
        var chip = document.getElementById("searchScope");
        var scope = state.searchScope || defaultScope();
        chip.innerHTML = I("folder") + '<span>' + esc(scopeLabel(scope)) + '</span>' + I("chevronDown");
        chip.title = T("search/in", "Search in {where}", { where: pathParts(scope).map(function (p) { return p.label; }).join(" / ") });
    }

    function bindSearch() {
        var form = document.getElementById("searchBox");
        var input = document.getElementById("searchInput");
        var chip = document.getElementById("searchScope");
        form.addEventListener("submit", function (e) {
            e.preventDefault();
            var q = input.value.trim();
            if (!q) {
                return;
            }
            var scope = state.searchScope || defaultScope();
            location.hash = "#/search/" + encodeURIComponent(q) + "?in=" + encodeURIComponent(scope);
            input.blur();
            document.documentElement.classList.remove("search-open");
            if (DriveHost.isVisible()) {
                DriveHost.hide();
            }
        });
        input.addEventListener("focus", function () {
            if (!state.searchScope) {
                updateScopeChip();
            }
        });
        input.addEventListener("keydown", function (e) {
            if (e.key == "Escape") {
                input.value = "";
                input.blur();
                document.documentElement.classList.remove("search-open");
            }
        });
        chip.addEventListener("click", function () {
            var cur = state.searchScope || defaultScope();
            var options = [];
            var here = defaultScope();
            if (here != "user:/") {
                options.push({ path: here, label: T("search/thisFolder", "This folder") + " (" + scopeLabel(here) + ")" });
            }
            state.roots.forEach(function (r) {
                options.push({ path: r.path, label: rootLabel(r), icon: rootIcon(r) });
            });
            DriveUI.menu({ anchor: chip, align: "end" }, [{ title: T("search/where", "Search in") }].concat(options.map(function (o) {
                return {
                    checkable: true, checked: normDir(o.path) == normDir(cur), label: o.label, action: function () {
                        state.searchScope = normDir(o.path);
                        updateScopeChip();
                        input.focus();
                    }
                };
            })));
        });
        document.getElementById("searchToggle").addEventListener("click", function () {
            document.documentElement.classList.add("search-open");
            updateScopeChip();
            setTimeout(function () { input.focus(); }, 30);
        });
        document.getElementById("searchClose").addEventListener("click", function () {
            document.documentElement.classList.remove("search-open");
        });
        updateScopeChip();
    }

    /* ------------------------------------------------------------------ */
    /*  Global events                                                      */
    /* ------------------------------------------------------------------ */
    function isTyping(e) {
        var t = e.target;
        return t && (t.tagName == "INPUT" || t.tagName == "TEXTAREA" || t.tagName == "SELECT" || t.isContentEditable);
    }

    function onKeyDown(e) {
        if (DriveUI.menuOpen() && DriveUI.menuKeyNav(e)) {
            e.preventDefault();
            return;
        }
        if (e.key == "Escape" && DriveUI.popoverOpen()) {
            DriveUI.closePopover();
            return;
        }
        if (DrivePreview.isOpen()) {
            DrivePreview.onKey(e);
            return;
        }
        var top = DriveUI.topModal();
        if (top) {
            if (e.key == "Escape") {
                top.close();
            }
            return;
        }
        if (isTyping(e)) {
            return;
        }
        if (DriveHost.isVisible()) {
            return;
        }
        var view = state.view;
        if (!view || view.page) {
            return;
        }
        var ctrl = e.ctrlKey || e.metaKey;
        var key = e.key;
        var sel = selectedItems();

        if (key == "/" && !ctrl) {
            e.preventDefault();
            if (window.innerWidth <= 760) {
                document.documentElement.classList.add("search-open");
            }
            document.getElementById("searchInput").focus();
            return;
        }
        if (key == "?" && !ctrl) {
            showShortcuts();
            return;
        }
        if (ctrl && (key == "a" || key == "A")) {
            e.preventDefault();
            DriveList.selectAll();
            return;
        }
        if (ctrl && (key == "s" || key == "S")) {
            e.preventDefault();
            if (sel.length) {
                DriveActions.download(sel);
            }
            return;
        }
        if (ctrl && (key == "c" || key == "C") && sel.length) {
            DriveActions.clipboard("copy", sel);
            return;
        }
        if (ctrl && (key == "x" || key == "X") && sel.length && view.kind != "trash") {
            DriveActions.clipboard("cut", sel);
            return;
        }
        if (ctrl && (key == "v" || key == "V")) {
            DriveActions.paste();
            return;
        }
        if (ctrl) {
            return;
        }
        if (key == "Enter" && sel.length) {
            e.preventDefault();
            DriveActions.open(sel[0]);
            return;
        }
        if (key == " " && sel.length) {
            e.preventDefault();
            DrivePreview.open(sel[0]);
            return;
        }
        if (key == "Delete" && sel.length) {
            e.preventDefault();
            if (e.shiftKey || view.kind == "trash") {
                DriveActions.deleteForever(sel);
            } else {
                DriveActions.trash(sel);
            }
            return;
        }
        if (key == "F2" && sel.length == 1) {
            e.preventDefault();
            DriveActions.rename(sel[0]);
            return;
        }
        if ((key == "Backspace" || (e.altKey && key == "ArrowUp")) && view.kind == "drive") {
            e.preventDefault();
            var parts = pathParts(view.path);
            if (parts.length > 1) {
                location.hash = folderRoute(parts[parts.length - 2].path);
            }
            return;
        }
        if (e.shiftKey && (key == "F" || key == "f") && view.kind == "drive") {
            e.preventDefault();
            DriveActions.newFolder();
            return;
        }
        if (e.shiftKey && (key == "U" || key == "u") && view.kind == "drive") {
            e.preventDefault();
            DriveActions.upload();
            return;
        }
        if (key == "i" || key == "I") {
            toggleDetails();
            return;
        }
        if (key == "Escape") {
            if (state.selection.size) {
                setSelection([]);
            } else if (state.detailsOpen && window.innerWidth <= 1100) {
                toggleDetails(false);
            }
            return;
        }
        if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].indexOf(key) >= 0) {
            if (DriveList.moveFocus(key, e.shiftKey)) {
                e.preventDefault();
            }
        }
    }

    function bindGlobalEvents() {
        window.addEventListener("hashchange", route);
        document.addEventListener("keydown", onKeyDown);
        document.getElementById("navToggle").addEventListener("click", openDrawer);
        document.getElementById("scrim").addEventListener("click", function () {
            closeDrawer();
            //On a phone the scrim also sits behind the details sheet
            if (state.detailsOpen && window.innerWidth <= 600) {
                toggleDetails(false);
            }
        });
        document.getElementById("userBtn").addEventListener("click", openUserMenu);
        document.getElementById("bellBtn").addEventListener("click", openNotifications);
        document.getElementById("helpBtn").addEventListener("click", openHelpMenu);
        document.getElementById("brand").addEventListener("click", function () {
            if (DriveHost.isVisible()) {
                DriveHost.hide();
            }
        });
        bindSearch();
        DriveList.bindContainer();
        //Re-render the header once per resize so collapsed labels follow the width
        var resizeTimer = null;
        window.addEventListener("resize", function () {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(function () {
                if (window.innerWidth > 1024) {
                    closeDrawer();
                }
                if (window.innerWidth > 760) {
                    document.documentElement.classList.remove("search-open");
                }
            }, 150);
        });
    }

    /* ------------------------------------------------------------------ */
    global.Drive = {
        state: state,
        boot: boot,
        refresh: refresh,
        route: route,
        rootById: rootById,
        rootOf: rootOf,
        rootIdOf: rootIdOf,
        rootLabel: rootLabel,
        rootIcon: rootIcon,
        pathParts: pathParts,
        locationLabel: locationLabel,
        normDir: normDir,
        folderRoute: folderRoute,
        href: href,
        isWritable: isWritable,
        module: module,
        effectiveTheme: effectiveTheme,
        applyTheme: applyTheme,
        saveSettings: saveSettings,
        selectedItems: selectedItems,
        setSelection: setSelection,
        selectionChanged: selectionChanged,
        itemByPath: itemByPath,
        currentFolderItem: currentFolderItem,
        renderHead: renderHead,
        renderToolbar: renderToolbar,
        renderFoot: renderFoot,
        renderSidebar: renderSidebar,
        renderStorage: renderStorage,
        refreshQuota: refreshQuota,
        sortState: sortState,
        toggleSortColumn: toggleSortColumn,
        currentViewMode: currentViewMode,
        toggleDetails: toggleDetails,
        updateScopeChip: updateScopeChip,
        retranslate: function () {
            DriveI18n.translate(document);
            document.getElementById("hostBack").innerHTML = I("arrowLeft") + '<span class="lbl">' + esc(T("host/back", "Back to Drive")) + '</span>';
            renderUser();
            renderSidebar();
            renderStorage();
            updateScopeChip();
            DriveHost.renderTabs();
            route();
        }
    };

    $(boot);
})(window);
