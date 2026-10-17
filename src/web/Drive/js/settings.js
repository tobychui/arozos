/*
    settings.js

    Drive's own settings page (#/settings). Like the Dashboard, Drive keeps
    its preferences apart from System Settings: they are stored per user by
    backend/prefs.agi and only change how Drive looks and behaves. System
    wide options stay in System Settings, which opens in the app host.
*/

(function (global) {
    "use strict";

    var I = DriveUI.I;
    var esc = DriveUI.esc;

    function S() {
        return Drive.state;
    }

    function group(icon, title, rows) {
        return '<div class="set-group"><div class="set-group-head">' + I(icon) + '<b>' + esc(title) + '</b></div>' + rows.join("") + '</div>';
    }

    function row(title, desc, control) {
        return '<div class="set-row"><div class="txt"><b>' + esc(title) + '</b>' + (desc ? '<small>' + esc(desc) + '</small>' : "") + '</div>' + control + '</div>';
    }

    function toggle(key) {
        return '<label class="switch"><input type="checkbox" data-set="' + key + '"' + (S().settings[key] ? " checked" : "") + '><span></span></label>';
    }

    function select(key, options, value) {
        return '<select class="select" data-set="' + key + '">' + options.map(function (o) {
            return '<option value="' + esc(o[0]) + '"' + (String(value) == String(o[0]) ? " selected" : "") + '>' + esc(o[1]) + '</option>';
        }).join("") + '</select>';
    }

    function render(container) {
        var st = S().settings;
        var themeCard = function (id, label) {
            return '<button class="theme-card' + (st.theme == id ? " active" : "") + '" data-theme="' + id + '"><div class="swatch ' + id + '"><i></i><i></i></div>' + esc(label) + '</button>';
        };
        var langs = [["default", T("set/langAuto", "Follow the browser")]].concat(DriveI18n.languages().map(function (l) { return [l.code, l.name]; }));
        var q = S().quota;

        var html = '<div class="settings"><div class="settings-inner">';
        html += group("sun", T("set/appearance", "Appearance"), [
            '<div class="set-row" style="flex-wrap:wrap"><div class="txt"><b>' + esc(T("set/theme", "Theme")) + '</b><small>' +
            esc(T("set/themeDesc", "Apps opened inside Drive follow this theme when they support it")) + '</small></div><div class="theme-cards">' +
            themeCard("auto", T("set/themeAuto", "Match device")) + themeCard("light", T("set/themeLight", "Light")) + themeCard("dark", T("set/themeDark", "Dark")) + '</div></div>',
            row(T("set/density", "Density"), T("set/densityDesc", "How much space each row takes"),
                select("density", [["comfortable", T("set/comfortable", "Comfortable")], ["compact", T("set/compact", "Compact")]], st.density)),
            row(T("set/language", "Language"), T("set/languageDesc", "Also used by other ArozOS apps in this browser"),
                select("language", langs, DriveI18n.current()))
        ]);
        html += group("folder", T("set/files", "Files and folders"), [
            row(T("set/view", "Default layout"), "", select("view", [["list", T("view/list", "List view")], ["grid", T("view/grid", "Grid view")]], st.view)),
            row(T("set/sort", "Sort by"), "", select("sortKey", [["name", T("col/name", "Name")], ["mtime", T("col/modified", "Modified")], ["size", T("col/size", "Size")], ["type", T("col/type", "Type")]], st.sortKey)),
            row(T("set/order", "Order"), "", select("sortDir", [["asc", T("sort/asc", "Ascending")], ["desc", T("sort/desc", "Descending")]], st.sortDir)),
            row(T("sort/foldersFirst", "Folders on top"), T("set/foldersFirstDesc", "List folders before files"), toggle("foldersFirst")),
            row(T("menu/showHidden", "Show hidden files"), T("set/hiddenDesc", "Files and folders whose name starts with a dot"), toggle("showHidden")),
            row(T("set/thumbs", "Thumbnails"), T("set/thumbsDesc", "Show previews of photos and videos in the list"), toggle("thumbnails")),
            row(T("set/pageSize", "Items per page"), T("set/pageSizeDesc", "Very large folders stay quick with paging"),
                select("pageSize", [["50", "50"], ["100", "100"], ["200", "200"], ["0", T("set/all", "All")]], st.pageSize))
        ]);
        html += group("open", T("set/behaviour", "Opening and deleting"), [
            row(T("set/viewer", "Use Drive's viewers"), T("set/viewerDesc", "Open photos, videos, music, PDF, Markdown and text files in Drive's own viewers"), toggle("viewer")),
            row(T("set/openIn", "Open files"), T("set/openInDesc", "Where an app opens when you open a file"),
                select("openIn", [["drive", T("set/inDrive", "Inside Drive")], ["tab", T("set/inTab", "In a new browser tab")]], st.openIn)),
            row(T("set/confirmTrash", "Ask before moving to trash"), T("set/confirmTrashDesc", "Items in the trash can always be restored"), toggle("confirmTrash"))
        ]);
        html += group("cloud", T("storage/title", "Storage"), [
            row(T("set/used", "Used space"), q.total > 0 ? T("storage/usedOf", "{used} of {total} used", { used: DriveUI.fmtSize(q.used), total: DriveUI.fmtSize(q.total) }) :
                T("storage/usedUnlimited", "{used} used · no quota", { used: DriveUI.fmtSize(q.used || 0) }),
                DriveAPI.caps.settings ? '<button class="btn small" data-go="quota">' + esc(T("set/details", "Details")) + '</button>' : ""),
            row(T("set/fileAccess", "File access"), DriveAPI.caps.fm ? T("about/full", "Full (File Manager API)") : T("set/reducedDesc", "Limited: ask your administrator for the File Manager permission to use the trash, version history and large uploads"), "")
        ]);
        var accountRows = [
            row(S().user.name, S().user.groups.join(", "), DriveAPI.caps.settings ? '<button class="btn small" data-go="account">' + I("user") + esc(T("set/account", "My account")) + '</button>' : "")
        ];
        if (DriveAPI.caps.settings) {
            accountRows.push(row(T("user/systemSettings", "System Settings"), T("set/systemDesc", "Password, language coverage, network, users and everything system wide"),
                '<button class="btn small" data-go="system">' + I("cog") + esc(T("set/open", "Open")) + '</button>'));
        }
        if (S().interfaces.length > 1) {
            accountRows.push(row(T("user/switchInterface", "Switch workspace"), T("set/switchDesc", "Your account can also use another interface such as the desktop"),
                '<button class="btn small" data-go="switch">' + I("apps") + esc(T("set/switch", "Switch")) + '</button>'));
        }
        html += group("user", T("set/accountGroup", "Account"), accountRows);
        html += '</div></div>';
        container.innerHTML = html;

        container.querySelectorAll(".theme-card").forEach(function (b) {
            b.addEventListener("click", function () {
                Drive.saveSettings({ theme: b.getAttribute("data-theme") });
                container.querySelectorAll(".theme-card").forEach(function (x) { x.classList.toggle("active", x === b); });
            });
        });
        container.querySelectorAll("[data-set]").forEach(function (c) {
            c.addEventListener("change", function () {
                var key = c.getAttribute("data-set");
                if (key == "language") {
                    DriveI18n.setLanguage(c.value, function () {
                        Drive.retranslate();
                    });
                    return;
                }
                var patch = {};
                if (c.type == "checkbox") {
                    patch[key] = c.checked;
                } else if (key == "pageSize") {
                    patch[key] = parseInt(c.value, 10);
                } else {
                    patch[key] = c.value;
                }
                Drive.saveSettings(patch);
                DriveUI.toast(T("set/saved", "Settings saved"), { type: "success", timeout: 1600 });
            });
        });
        container.querySelectorAll("[data-go]").forEach(function (b) {
            b.addEventListener("click", function () {
                var go = b.getAttribute("data-go");
                if (go == "system") {
                    DriveHost.openSystemSettings();
                } else if (go == "quota") {
                    DriveHost.openSystemSettings("Disk", "Storage Quota");
                } else if (go == "account") {
                    DriveHost.openSystemSettings("Users", "My Account");
                } else if (go == "switch") {
                    window.location.href = DriveAPI.ROOT + "SystemAO/boot/interface_selector.html";
                }
            });
        });
    }

    global.DriveSettings = {
        render: render
    };
})(window);
