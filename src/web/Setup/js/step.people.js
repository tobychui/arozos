/*
    Step: People

    Just me, people who are all administrators, or other people with limited
    access. The last one creates (or updates) a permission group with the
    apps, storage space and workspace the admin picks here.
*/

(function () {
    "use strict";
    var W = window.Wizard, T = W.T, esc = W.esc;

    var GB = 1000 * 1000 * 1000;
    var QUOTAS = [5, 15, 50, 100, 500, -1];
    var UNIVERSAL_GROUPS = ["utilities", "system tools"];
    var UNCHECKED_GROUPS = ["development"];
    var appsCache = null;

    function quotaLabel(gb) {
        return gb < 0 ? T("people/quota/unlimited", "No limit") : T("people/quota/gb", "{n} GB each", { n: gb });
    }

    function groupDefaults() {
        return {
            name: "users",
            quota: 15 * GB,
            interface: W.progress.interface || "Desktop",
            modules: null,
            saved: false
        };
    }

    //The apps a group can be given: interface modules and the apps every
    //user already has are left out
    function pickableApps(all) {
        return all.filter(function (m) {
            var group = String(m.Group || "").toLowerCase();
            return m.StartDir && group !== "interface module" && UNIVERSAL_GROUPS.indexOf(group) < 0;
        }).sort(function (a, b) {
            return (a.Group || "").localeCompare(b.Group || "") || a.Name.localeCompare(b.Name);
        });
    }

    function defaultModules(apps) {
        return apps.filter(function (m) {
            return UNCHECKED_GROUPS.indexOf(String(m.Group || "").toLowerCase()) < 0;
        }).map(function (m) { return m.Name; });
    }

    //Apps listed by category. A category's own checkbox selects or clears all
    //of its apps, and shows a dash when only some of them are picked.
    function renderApps(el) {
        var $box = $(el).find("#wzApps");
        var g = W.progress.group;
        var apps = pickableApps(appsCache || []);
        if (g.modules === null) {
            g.modules = defaultModules(apps);
        }
        var categories = [];
        var byCategory = {};
        apps.forEach(function (m) {
            var key = m.Group || T("people/apps/other", "Other");
            if (!byCategory[key]) {
                byCategory[key] = [];
                categories.push(key);
            }
            byCategory[key].push(m);
        });

        var html = "";
        categories.forEach(function (key, i) {
            html += '<div class="wz-app-category" data-category="' + i + '">' +
                '<label class="wz-app-group"><input type="checkbox" data-category="' + i + '">' +
                '<span class="wz-app-group-name">' + esc(key) + '</span><span class="wz-app-group-count"></span></label>' +
                '<div class="wz-app-list">';
            byCategory[key].forEach(function (m) {
                var checked = g.modules.indexOf(m.Name) >= 0;
                html += '<label class="wz-app" title="' + esc(m.Desc || m.Name) + '"><input type="checkbox" value="' + esc(m.Name) + '"' + (checked ? " checked" : "") + ">" +
                    '<img src="../' + esc(m.IconPath) + '" alt="" onerror="this.style.visibility=\'hidden\'"><span>' + esc(m.Name) + "</span></label>";
            });
            html += "</div></div>";
        });
        $box.html(html || '<div class="wz-empty">' + esc(T("people/apps/none", "No apps found")) + "</div>");

        var setModule = function (name, on) {
            g.modules = g.modules.filter(function (n) { return n !== name; });
            if (on) {
                g.modules.push(name);
            }
        };
        var refreshCategories = function () {
            $box.find(".wz-app-category").each(function () {
                var $apps = $(this).find(".wz-app input");
                var picked = $apps.filter(":checked").length;
                var $all = $(this).find(".wz-app-group input");
                $all.prop("checked", picked === $apps.length && picked > 0).prop("indeterminate", picked > 0 && picked < $apps.length);
                $(this).find(".wz-app-group-count").text(T("people/apps/count", "{n} of {total}", { n: picked, total: $apps.length }));
            });
        };

        $box.find(".wz-app input").on("change", function () {
            setModule($(this).val(), this.checked);
            refreshCategories();
        });
        $box.find(".wz-app-group input").on("change", function () {
            var on = this.checked;
            $(this).closest(".wz-app-category").find(".wz-app input").each(function () {
                this.checked = on;
                setModule($(this).val(), on);
            });
            refreshCategories();
        });
        refreshCategories();
    }

    function renderGroupForm(el) {
        var g = W.progress.group;
        var quotaOptions = QUOTAS.map(function (gb) {
            var bytes = gb < 0 ? -1 : gb * GB;
            return '<option value="' + bytes + '"' + (bytes === g.quota ? " selected" : "") + ">" + esc(quotaLabel(gb)) + "</option>";
        }).join("");
        var ifaceOptions = W.state.interfaces.map(function (i) {
            return '<option value="' + esc(i.name) + '"' + (i.name === g.interface ? " selected" : "") + ">" + esc(W.interfaceTitle(i.name)) + "</option>";
        }).join("");

        $(el).find("#wzGroupForm").html(
            '<div class="wz-form">' +
            '<div class="wz-field"><label>' + esc(T("people/group/name", "Group name")) + '</label><input class="wz-input" data-field="gname" value="' + esc(g.name) + '" maxlength="32" autocomplete="off" spellcheck="false">' +
            '<div class="wz-hint">' + esc(T("people/group/name/hint", "Lowercase letters, numbers, - and _")) + "</div></div>" +
            '<div class="wz-field"><label>' + esc(T("people/group/quota", "Storage space")) + '</label><select class="wz-select" data-field="quota">' + quotaOptions + "</select></div>" +
            '<div class="wz-field wide"><label>' + esc(T("people/group/interface", "Their workspace")) + '</label><select class="wz-select" data-field="iface">' + ifaceOptions + "</select></div>" +
            '<div class="wz-field wide"><div class="wz-apps-tools"><span class="wz-label wz-grow" style="margin:0">' + esc(T("people/group/apps", "Apps they can use")) + "</span>" +
            '<button type="button" class="wz-btn small ghost" data-action="all">' + esc(T("people/apps/all", "Select all")) + "</button>" +
            '<button type="button" class="wz-btn small ghost" data-action="none">' + esc(T("people/apps/clear", "Clear")) + "</button></div>" +
            '<div class="wz-apps" id="wzApps"><div class="wz-loading" style="padding:20px 0;grid-column:1/-1"><span class="wz-spinner"></span></div></div>' +
            '<div class="wz-hint">' + esc(T("people/apps/hint", "Utilities and system tools are always available. People never get administrator settings.")) + "</div></div>" +
            "</div>");

        var $f = $(el).find("#wzGroupForm");
        $f.find("[data-field=gname]").on("input", function () {
            g.name = $(this).val().trim();
            $(this).removeClass("invalid");
        });
        $f.find("[data-field=quota]").on("change", function () {
            g.quota = parseInt($(this).val(), 10);
        });
        $f.find("[data-field=iface]").on("change", function () {
            g.interface = $(this).val();
        });
        $f.find("[data-action=all]").on("click", function () {
            g.modules = pickableApps(appsCache || []).map(function (m) { return m.Name; });
            renderApps(el);
        });
        $f.find("[data-action=none]").on("click", function () {
            g.modules = [];
            renderApps(el);
        });

        if (appsCache) {
            renderApps(el);
        } else {
            W.api("GET", "system/modules/list").then(function (list) {
                appsCache = Array.isArray(list) ? list : [];
                renderApps(el);
            }, function (err) {
                $(el).find("#wzApps").html('<div class="wz-empty">' + esc(err.message) + "</div>");
            });
        }
    }

    function existingGroup(name) {
        var found = null;
        W.state.groups.forEach(function (g) {
            if (g.name.toLowerCase() === name.toLowerCase()) {
                found = g;
            }
        });
        return found;
    }

    function saveGroup() {
        var g = W.progress.group;
        if (g.modules === null) {
            return Promise.reject(new Error(T("people/apps/loading", "The app list is still loading, please try again in a moment")));
        }
        if (!/^[a-z0-9_-]{1,32}$/.test(g.name)) {
            $("[data-field=gname]").addClass("invalid").trigger("focus");
            return Promise.reject(new Error(T("people/group/name/invalid", "Use lowercase letters, numbers, - and _ for the group name")));
        }
        var current = existingGroup(g.name);
        if (current && current.isAdmin) {
            $("[data-field=gname]").addClass("invalid").trigger("focus");
            return Promise.reject(new Error(T("people/group/name/admin", "{name} is an administrator group. Choose another name.", { name: g.name })));
        }
        var data = {
            groupname: current ? current.name : g.name,
            permission: JSON.stringify(g.modules || []),
            isAdmin: "false",
            defaultQuota: String(g.quota),
            interfaceModule: g.interface
        };
        return W.api("POST", current ? "system/permission/editgroup" : "system/permission/newgroup", data).then(function () {
            g.saved = true;
            if (current) {
                current.interface = g.interface;
                current.quota = g.quota;
                current.modules = g.modules;
            } else {
                W.state.groups.push({ name: g.name, isAdmin: false, interface: g.interface, quota: g.quota, modules: g.modules });
            }
        });
    }

    W.peopleGroup = function () {
        if (W.progress.people === "admins") {
            return "administrator";
        }
        if (W.progress.people === "group" && W.progress.group) {
            return W.progress.group.name;
        }
        return "";
    };

    W.register({
        id: "people",
        title: function () {
            return T("step/people", "People");
        },
        render: function (el) {
            if (!W.progress.group) {
                W.progress.group = groupDefaults();
            }
            var choice = W.progress.people;
            var html = '<div class="wz-eyebrow">' + esc(T("people/eyebrow", "People")) + "</div>" +
                '<h1 class="wz-title">' + esc(T("people/title", "Who will use this server?")) + "</h1>" +
                '<p class="wz-lead">' + esc(T("people/lead", "Everyone gets their own account and their own home folder. Choose how much the others may do.")) + "</p>" +
                '<div class="wz-choices stack" role="radiogroup">' +
                W.choiceHTML("me", "user", T("people/me", "Just me"), T("people/me/desc", "Only you sign in. You can add people at any time later."), choice) +
                W.choiceHTML("admins", "crown", T("people/admins", "Me and people I fully trust"), T("people/admins/desc", "Everyone is an administrator: they can change every setting and see every drive. Fine for a couple or a small family."), choice) +
                W.choiceHTML("group", "users", T("people/group", "Me and others with limited access"), T("people/group/desc", "The others get normal accounts in a group: you pick their apps and storage space, and they cannot change system settings."), choice) +
                "</div>" +
                '<div id="wzAdminWarn" class="wz-note warn' + (choice === "admins" ? "" : " wz-hidden") + '" style="margin-top:16px">' + W.icon("warning") + "<div>" +
                esc(T("people/admins/warn", "Administrators can also delete accounts, format disks and read every drive. Only choose this for people you trust completely.")) + "</div></div>" +
                '<div id="wzGroupBody" class="' + (choice === "group" ? "" : "wz-hidden") + '">' +
                '<div class="wz-section-title">' + esc(T("people/group/title", "Their group")) + "</div>" +
                '<div class="wz-card" id="wzGroupForm"></div></div>';
            el.innerHTML = html;
            $(el).find(".wz-choices .wz-choice[data-value=group] .wz-choice-title").append('<span class="wz-badge">' + esc(T("people/recommended", "Recommended for sharing")) + "</span>");
            renderGroupForm(el);

            $(el).find(".wz-choice").on("click", function () {
                W.progress.people = $(this).attr("data-value");
                $(el).find(".wz-choice").removeClass("selected").attr("aria-checked", "false");
                $(this).addClass("selected").attr("aria-checked", "true");
                $(el).find("#wzGroupBody").toggleClass("wz-hidden", W.progress.people !== "group");
                $(el).find("#wzAdminWarn").toggleClass("wz-hidden", W.progress.people !== "admins");
                //The accounts step comes and goes with the choice
                W.renderStepList();
            });
        },
        leave: function () {
            if (!W.progress.people) {
                return Promise.reject(new Error(T("people/pick", "Choose who will use this server")));
            }
            if (W.progress.people === "group") {
                return saveGroup();
            }
            return null;
        }
    });
})();
