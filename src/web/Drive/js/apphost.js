/*
    apphost.js

    Opens web apps (and System Settings) inside Drive instead of new browser
    windows. Each app is a tab over the file area; "Back to Drive" leaves
    them running and a pill in the top bar brings them back.

    Web apps detect a host through parent.isDesktopMode and then call the
    float window API of the desktop (newFloatWindow, closeFwProcess,
    setFloatWindowTitle, ...). Drive implements that API here, with the same
    .floatWindowWrapper > .floatWindow[windowId] > .fwtab > iframe markup the
    apps walk to find their own window id, parent window and callback. So
    file pickers, "open with" dialogs and parent callbacks of the apps keep
    working, all inside this page.
*/

(function (global) {
    "use strict";

    var I = DriveUI.I;
    var esc = DriveUI.esc;
    var API = DriveAPI;

    var windows = [];   //{id, url, title, icon, parent, callback}
    var activeId = null;
    var visible = false;
    var seq = 0;

    /*
        Apps pass web root relative paths, and the document base of Drive is
        the web root, so they are used as they are. Keeping them unprefixed in
        the iframe src matters: apps compare and rewrite that attribute.
    */
    function resolve(url) {
        return String(url || "");
    }

    /*
        Theme bridge

        Hosted apps take their theme from the account wide ArozOS preference
        (system/file_system/preference?key=file_explorer/theme), read with an
        async $.get. That reply can land after Drive pushed its own theme in
        through desktopThemeChanged and flip the app back, or turn it dark
        when the preference was never set. Inside Drive the preference reads
        as Drive's theme instead: each jQuery of a hosted app gets a transport
        that answers those reads locally, so no request goes out at all.

        The hook point is ao_module.js, which reads parent.isDesktopMode at
        its top: after the app loaded jQuery, before any app code runs. Pages
        that load another copy of jQuery later (System Settings loads every
        settings page with its own script tags) get the transport too,
        through a setter on window.jQuery and window.$. Writes of the
        preference, like the theme button of File Manager, still go out.
    */
    var THEME_KEY = /[?&]key=file_explorer(?:\/|%2F)theme(?:[&#]|$)/i;

    function isThemeRead(opts) {
        var url = String(opts.url || "");
        return String(opts.type || "GET").toUpperCase() == "GET" &&
            url.indexOf("system/file_system/preference") >= 0 &&
            THEME_KEY.test(url) && !/[?&](?:value|remove)=/i.test(url);
    }

    function themePref() {
        return Drive.effectiveTheme() == "dark" ? "darkTheme" : "whiteTheme";
    }

    function patchJQuery(jq) {
        if (!jq || typeof jq.ajaxTransport !== "function" || jq.__driveTheme) {
            return;
        }
        jq.__driveTheme = true;
        jq.ajaxTransport("+*", function (opts) {
            if (!isThemeRead(opts)) {
                return;
            }
            var timer = null;
            return {
                send: function (headers, done) {
                    //Same shape as the server's reply: the bare value as text
                    timer = setTimeout(function () {
                        done(200, "success", { text: themePref() }, "Content-Type: text/plain; charset=utf-8\r\n");
                    }, 0);
                },
                abort: function () {
                    clearTimeout(timer);
                }
            };
        });
    }

    function trapJQuery(cw) {
        ["jQuery", "$"].forEach(function (name) {
            var current = cw[name];
            var desc = Object.getOwnPropertyDescriptor(cw, name);
            if (desc && !desc.configurable) {
                return;
            }
            try {
                Object.defineProperty(cw, name, {
                    configurable: true,
                    enumerable: true,
                    get: function () { return current; },
                    set: function (v) {
                        current = v;
                        patchJQuery(v);
                    }
                });
            } catch (e) { }
        });
    }

    function bridgeTheme(cw) {
        try {
            if (!cw || cw.__driveThemeBridge || !cw.jQuery) {
                return;
            }
            cw.__driveThemeBridge = true;
            patchJQuery(cw.jQuery);
            patchJQuery(cw.$);
            trapJQuery(cw);
        } catch (e) {
            //Cross origin page: it cannot read the preference of this server anyway
        }
    }

    function bridgeAll() {
        document.querySelectorAll("#fw-body iframe").forEach(function (f) {
            try {
                bridgeTheme(f.contentWindow);
            } catch (e) { }
        });
    }

    function iconURL(icon) {
        if (!icon) {
            return API.ROOT + "img/system/favicon.png";
        }
        return resolve(icon);
    }

    function find(id) {
        for (var i = 0; i < windows.length; i++) {
            if (String(windows[i].id) == String(id)) {
                return windows[i];
            }
        }
        return null;
    }

    function wrapperOf(id) {
        return document.querySelector('#fw-body .floatWindowWrapper[windowId="' + String(id).replace(/"/g, "") + '"]');
    }

    function show() {
        visible = true;
        document.getElementById("apphost").hidden = false;
        DriveUI.closeMenus(0);
        updatePill();
    }

    function hide() {
        visible = false;
        document.getElementById("apphost").hidden = true;
        updatePill();
    }

    function updatePill() {
        var pill = document.getElementById("appsPill");
        if (!windows.length || visible) {
            pill.hidden = true;
            return;
        }
        pill.hidden = false;
        var w = find(activeId) || windows[windows.length - 1];
        pill.innerHTML = '<img src="' + esc(iconURL(w.icon)) + '" alt="" style="width:18px;height:18px;object-fit:contain" onerror="this.style.display=\'none\'">' +
            '<span class="hide-xs">' + esc(windows.length == 1 ? w.title : T("host/openApps", "{n} apps open", { n: windows.length })) + '</span>' +
            '<span class="only-sm">' + windows.length + '</span>';
        pill.title = T("host/return", "Return to open apps");
    }

    function renderTabs() {
        var tabs = document.getElementById("hostTabs");
        tabs.innerHTML = "";
        windows.forEach(function (w) {
            var tab = DriveUI.el('<div class="app-tab' + (w.id == activeId ? " active" : "") + '" data-id="' + esc(w.id) + '" title="' + esc(w.title) + '">' +
                '<img src="' + esc(iconURL(w.icon)) + '" alt="" onerror="this.style.visibility=\'hidden\'"><span class="t">' + esc(w.title) + '</span>' +
                '<span class="x" role="button" aria-label="' + esc(T("common/close", "Close")) + '">' + I("x") + '</span></div>');
            tab.addEventListener("click", function (e) {
                if (e.target.closest(".x")) {
                    closeWindow(w.id);
                } else {
                    focus(w.id);
                }
            });
            tab.addEventListener("auxclick", function (e) {
                if (e.button == 1) {
                    closeWindow(w.id);
                }
            });
            tabs.appendChild(tab);
        });
        var active = tabs.querySelector(".app-tab.active");
        if (active && active.scrollIntoView) {
            active.scrollIntoView({ block: "nearest", inline: "nearest" });
        }
        updatePill();
    }

    function focus(id) {
        var w = find(id);
        if (!w) {
            return;
        }
        activeId = w.id;
        document.querySelectorAll("#fw-body .floatWindowWrapper").forEach(function (n) {
            n.classList.toggle("on", n.getAttribute("windowId") == String(w.id));
        });
        renderTabs();
        show();
    }

    /*
        open({url, title, icon, uid, parent, callback}) -> window id
        url is web root relative, like every ModuleInfo path.
    */
    function open(cfg) {
        cfg = cfg || {};
        if (cfg.uid && find(cfg.uid)) {
            var existing = find(cfg.uid);
            if (cfg.url && existing.url != cfg.url) {
                existing.url = cfg.url;
                var frame = wrapperOf(existing.id).querySelector("iframe");
                frame.src = resolve(cfg.url);
            }
            focus(existing.id);
            return existing.id;
        }
        var id = cfg.uid || ("w" + Date.now() + "_" + (++seq));
        var w = {
            id: id,
            url: cfg.url || "",
            title: cfg.title || T("host/untitled", "App"),
            icon: cfg.appicon || cfg.icon || "",
            parent: cfg.parent || "",
            callback: cfg.callback || ""
        };
        windows.push(w);
        var wrap = DriveUI.el('<div class="floatWindowWrapper" windowId="' + esc(id) + '">' +
            '<div class="floatWindow" windowId="' + esc(id) + '" parent="' + esc(w.parent) + '" callback="' + esc(w.callback) + '">' +
            '<div class="fwtab"><iframe allow="fullscreen; clipboard-read; clipboard-write; camera; microphone; autoplay" title="' + esc(w.title) + '"></iframe></div>' +
            '</div><div class="apphost-loading"><div class="spinner"></div></div></div>');
        var iframe = wrap.querySelector("iframe");
        iframe.addEventListener("load", function () {
            var loading = wrap.querySelector(".apphost-loading");
            if (loading) {
                loading.classList.add("done");
                setTimeout(function () { loading.remove(); }, 250);
            }
            try {
                var cw = iframe.contentWindow;
                //A standalone style close lands on this page; treat it as closing the tab
                if (/closeTabInsturction\.html/i.test(cw.location.pathname)) {
                    closeFwProcess(id);
                    return;
                }
                //Pages without ao_module.js are bridged here instead, late but still useful
                bridgeTheme(cw);
                if (typeof cw.desktopThemeChanged === "function") {
                    cw.desktopThemeChanged(Drive.effectiveTheme());
                }
            } catch (e) {
                //Cross origin page: nothing to wire up
            }
        });
        document.getElementById("fw-body").appendChild(wrap);
        iframe.src = resolve(w.url);
        focus(id);
        return id;
    }

    function closeFwProcess(id) {
        var w = find(id);
        if (!w) {
            return;
        }
        var wrap = wrapperOf(id);
        if (wrap) {
            wrap.remove();
        }
        var idx = windows.indexOf(w);
        windows.splice(idx, 1);
        if (!windows.length) {
            activeId = null;
            renderTabs();
            hide();
            return;
        }
        if (activeId == w.id) {
            var next = (w.parent && find(w.parent)) || windows[Math.max(0, idx - 1)];
            focus(next.id);
        } else {
            renderTabs();
        }
    }

    //Ask the app to close itself first, so it can warn about unsaved work
    function closeWindow(id) {
        var wrap = wrapperOf(id);
        if (!wrap) {
            return;
        }
        try {
            var cw = wrap.querySelector("iframe").contentWindow;
            if (cw && typeof cw.ao_module_close === "function" && cw.ao_module_virtualDesktop) {
                cw.ao_module_close();
                return;
            }
        } catch (e) { }
        closeFwProcess(id);
    }

    function broadcastTheme(theme) {
        document.querySelectorAll("#fw-body iframe").forEach(function (f) {
            try {
                if (typeof f.contentWindow.desktopThemeChanged === "function") {
                    f.contentWindow.desktopThemeChanged(theme);
                }
            } catch (e) { }
        });
    }

    function openModule(name) {
        var m = Drive.module(name);
        var go = function (info) {
            var url = info.SupportFW && info.LaunchFWDir ? info.LaunchFWDir : info.StartDir;
            open({ url: url, title: info.Name, icon: info.IconPath });
        };
        if (m) {
            go(m);
        } else {
            API.launchInfo(name).then(go).catch(DriveUI.error);
        }
    }

    function openSystemSettings(group, name) {
        var url = "SystemAO/system_setting/index.html";
        if (group || name) {
            url += "#" + encodeURIComponent(JSON.stringify({ group: group || "", name: name || "" }));
        }
        open({ url: url, title: T("user/systemSettings", "System Settings"), icon: "SystemAO/system_setting/img/small_icon.png", uid: "drive-system-settings" });
    }

    //ao_module_startFileOperation() from a hosted app
    function startFileOperation(cfg) {
        var opr = cfg.opr == "unzipAndOpen" ? "unzip" : cfg.opr;
        var items = (cfg.src || []).map(function (p) { return { name: API.baseName(p), path: p, isDir: false }; });
        var mode = cfg.overwriteMode && cfg.overwriteMode != "ask" ? cfg.overwriteMode : "keep";
        DriveTransfers.operation(opr, items, cfg.dest, mode).then(function () {
            if (cfg.opr == "unzipAndOpen") {
                hide();
                location.hash = Drive.folderRoute(cfg.dest);
            }
            if (cfg.callbackWindowID && cfg.callbackFunction) {
                var wrap = wrapperOf(cfg.callbackWindowID);
                try {
                    wrap.querySelector("iframe").contentWindow.eval(cfg.callbackFunction);
                } catch (e) { }
            }
        }).catch(function () { });
    }

    function install() {
        //Read by ao_module.js at the top of every hosted app, see the theme bridge
        Object.defineProperty(global, "isDesktopMode", {
            configurable: true,
            get: function () {
                bridgeAll();
                return true;
            },
            set: function () { }
        });
        global.ime = null;

        global.newFloatWindow = function (config, callback) {
            var id = open(config || {});
            if (typeof callback === "function") {
                callback(id);
            }
            return id;
        };
        global.closeFwProcess = closeFwProcess;
        global.closeFloatWindow = closeWindow;
        global.getFloatWindowByID = function (id) {
            var wrap = wrapperOf(id);
            return wrap ? $(wrap) : null;
        };
        global.MoveFloatWindowToTop = function (fw) {
            var id = $(fw).attr("windowId") || $(fw).find(".floatWindow").attr("windowId");
            if (id) {
                focus(id);
            }
        };
        global.setFloatWindowTitle = function (id, title) {
            var w = find(id);
            if (w) {
                w.title = title;
                renderTabs();
            }
        };
        global.setFloatWindowSize = function () { };
        global.setFloatWindowMinSize = function () { };
        global.setFloatWindowResizePolicy = function () { };
        global.setFloatWindowMinimizePolicy = function () { };
        global.setFloatWindowTheme = function () { };
        global.PinFloatWindowToTopMostMode = function () { };
        global.UnpinFloatWindowFromTopMostMode = function () { };
        global.bindObjectToIMEEvents = function () { };
        global.openModule = openModule;
        global.openFileWithModule = function (info, files) {
            var url = DriveActions.launchURL(info);
            open({ url: url + "#" + encodeURIComponent(JSON.stringify(files || [])), title: info.Name, icon: info.IconPath });
        };
        global.startFileOperation = startFileOperation;
        global.toggleDesktopTheme = function () {
            Drive.saveSettings({ theme: Drive.effectiveTheme() == "dark" ? "light" : "dark" });
        };
        //The theme button of File Manager calls this on its host after flipping itself
        global.initTheme = function (theme) {
            var dark = theme == "darkTheme" || theme == "dark";
            if (theme && dark != (Drive.effectiveTheme() == "dark")) {
                Drive.saveSettings({ theme: dark ? "dark" : "light" });
            }
        };
        global.showDesktop = hide;
        global.openSystemSettings = openSystemSettings;
        global.openContainerAppShortcut = function (s) {
            window.open(API.ROOT + "app/" + encodeURIComponent(s.ShortcutPath) + "/", "_blank");
        };

        document.getElementById("hostBack").addEventListener("click", hide);
        document.getElementById("appsPill").addEventListener("click", function () {
            focus(activeId || windows[windows.length - 1].id);
        });
        document.getElementById("hostClose").addEventListener("click", function () {
            if (activeId) {
                closeWindow(activeId);
            }
        });
        document.getElementById("hostNewTab").addEventListener("click", function () {
            var w = find(activeId);
            if (!w) {
                return;
            }
            var src = resolve(w.url);
            try {
                //Keep where the app navigated to, when it is still on this origin
                src = wrapperOf(w.id).querySelector("iframe").contentWindow.location.href;
            } catch (e) { }
            window.open(src, "_blank");
        });
    }

    global.DriveHost = {
        install: install,
        open: open,
        openModule: openModule,
        openSystemSettings: openSystemSettings,
        closeWindow: closeWindow,
        isVisible: function () { return visible; },
        show: function () {
            if (windows.length) {
                focus(activeId || windows[windows.length - 1].id);
            }
        },
        hide: hide,
        broadcastTheme: broadcastTheme,
        renderTabs: renderTabs,
        count: function () { return windows.length; }
    };
})(window);
