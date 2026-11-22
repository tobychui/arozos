/*
    Step: Accounts and access

    Only shown when other people will use the server. Creates their accounts
    in the administrator group or in the group of the people step, and, for
    a limited group, sets who may use each drive the guide added.
*/

(function () {
    "use strict";
    var W = window.Wizard, T = W.T, esc = W.esc;

    //Same rule as auth.ValidateUsername on the server: letters of any script,
    //digits, and . - _ @ after the first character
    var USERNAME = /^[\p{L}\p{N}][\p{L}\p{N}\p{M}._@-]{0,63}$/u;

    function levelOptions(current) {
        var levels = [
            ["readwrite", T("access/readwrite", "Everyone can open and change files")],
            ["readonly", T("access/readonly", "Everyone can open files, only administrators change them")],
            ["admins", T("access/admins", "Only administrators")]
        ];
        return levels.map(function (l) {
            return '<option value="' + l[0] + '"' + (l[0] === current ? " selected" : "") + ">" + esc(l[1]) + "</option>";
        }).join("");
    }

    function renderAccounts(el) {
        var $list = $(el).find("#wzAccountList").empty();
        var others = W.state.users.filter(function (u) { return u !== W.state.username; });
        if (others.length === 0) {
            $list.html('<div class="wz-empty">' + esc(T("accounts/none", "No other accounts yet")) + "</div>");
            return;
        }
        others.forEach(function (name) {
            var created = W.progress.accounts.indexOf(name) >= 0;
            $list.append('<div class="wz-added"><div class="wz-card-icon">' + W.icon("user") + "</div>" +
                '<div class="wz-grow"><div class="wz-row-title">' + esc(name) + "</div>" +
                '<div class="wz-row-sub">' + esc(created ? T("accounts/created", "Added in this guide") : T("accounts/existing", "Existing account")) + "</div></div></div>");
        });
        window.WizardFillIcons($list[0]);
    }

    function addAccount(el, button) {
        var $f = $(el).find("#wzAccountForm");
        var username = $f.find("[data-field=username]").val().trim();
        var password = $f.find("[data-field=password]").val();
        var repeat = $f.find("[data-field=repeat]").val();
        $f.find(".wz-input").removeClass("invalid");

        if (!USERNAME.test(username) || username.indexOf("..") >= 0) {
            $f.find("[data-field=username]").addClass("invalid").trigger("focus");
            W.toast(T("accounts/username/invalid", "A username starts with a letter or number and can use letters, numbers, . - _ and @"), true);
            return;
        }
        if (W.state.users.some(function (u) { return u.toLowerCase() === username.toLowerCase(); })) {
            $f.find("[data-field=username]").addClass("invalid").trigger("focus");
            W.toast(T("accounts/username/taken", "{name} already has an account", { name: username }), true);
            return;
        }
        if (password.length < 6) {
            $f.find("[data-field=password]").addClass("invalid").trigger("focus");
            W.toast(T("accounts/password/short", "Use a password of at least 6 characters"), true);
            return;
        }
        if (password !== repeat) {
            $f.find("[data-field=repeat]").addClass("invalid").trigger("focus");
            W.toast(T("accounts/password/mismatch", "The passwords do not match"), true);
            return;
        }

        W.working(button, true);
        W.api("POST", "system/auth/register", { username: username, password: password, group: W.peopleGroup() }).then(function () {
            W.working(button, false);
            W.state.users.push(username);
            W.progress.accounts.push(username);
            W.save();
            $f.find("input").val("");
            $f.find("[data-field=username]").trigger("focus");
            W.toast(T("accounts/addedToast", "Account {name} created", { name: username }));
            renderAccounts(el);
        }, function (err) {
            W.working(button, false);
            W.toast(err.message, true);
        });
    }

    function saveAccess() {
        if (W.progress.people !== "group") {
            return Promise.resolve();
        }
        var jobs = [];
        $("#wzAccess select").each(function () {
            var uuid = $(this).attr("data-uuid");
            var level = $(this).val();
            if (W.progress.access[uuid] === level) {
                return;
            }
            var rule = { other: level === "admins" ? "denied" : level };
            jobs.push(W.api("POST", "system/storage/access", { uuid: uuid, rule: JSON.stringify(rule) }).then(function () {
                W.progress.access[uuid] = level;
            }));
        });
        return Promise.all(jobs);
    }

    W.register({
        id: "accounts",
        visible: function () {
            return W.progress.people === "admins" || W.progress.people === "group";
        },
        title: function () {
            return T("step/accounts", "Accounts");
        },
        render: function (el) {
            var admins = W.progress.people === "admins";
            var html = '<div class="wz-eyebrow">' + esc(T("accounts/eyebrow", "Accounts")) + "</div>" +
                '<h1 class="wz-title">' + esc(admins ? T("accounts/title/admins", "Add the people you trust") : T("accounts/title/group", "Add accounts for the others")) + "</h1>" +
                '<p class="wz-lead">' + esc(T("accounts/lead", "Create an account for each person. Give them their username and password; they can change the password after signing in.")) + "</p>" +
                '<div class="wz-card" id="wzAccountForm"><div class="wz-form">' +
                '<div class="wz-field wide"><label>' + esc(T("accounts/username", "Username")) + '</label><input class="wz-input" data-field="username" maxlength="64" autocomplete="off" spellcheck="false" autocapitalize="off"></div>' +
                '<div class="wz-field"><label>' + esc(T("accounts/password", "Password")) + '</label><input class="wz-input" type="password" data-field="password" autocomplete="new-password"></div>' +
                '<div class="wz-field"><label>' + esc(T("accounts/repeat", "Repeat password")) + '</label><input class="wz-input" type="password" data-field="repeat" autocomplete="new-password"></div>' +
                '<div class="wz-form-actions"><button type="button" class="wz-btn primary" data-action="add">' + W.icon("plus") + "<span>" + esc(T("accounts/add", "Add account")) + "</span></button>" +
                '<span class="wz-chip">' + W.icon(admins ? "crown" : "users") + "<span>" + esc(T("accounts/group", "Group: {name}", { name: W.peopleGroup() })) + "</span></span></div>" +
                "</div></div>" +
                '<div class="wz-section-title">' + esc(T("accounts/listTitle", "People on this server")) + "</div>" +
                '<div id="wzAccountList"></div>';

            var drives = W.progress.drives;
            if (!admins && drives.length) {
                html += '<div class="wz-section-title">' + esc(T("access/title", "Who can use the drives you added")) + "</div>" +
                    '<div class="wz-card" id="wzAccess"><div class="wz-rows" style="margin-top:0;border-top:none">';
                drives.forEach(function (d) {
                    html += '<div class="wz-row"><div class="wz-row-main"><div class="wz-row-title">' + esc(d.name) + ' <span class="wz-chip">' + esc(d.uuid) + ":/</span></div></div>" +
                        '<select class="wz-select" style="max-width:360px" data-uuid="' + esc(d.uuid) + '">' + levelOptions(W.progress.access[d.uuid] || "readwrite") + "</select></div>";
                });
                html += '</div><div class="wz-hint">' + esc(T("access/hint", "Administrators can always use every drive. Each person's home folder stays private.")) + "</div></div>";
            } else if (admins) {
                html += '<div class="wz-note" style="margin-top:22px">' + W.icon("info") + "<div>" +
                    esc(T("access/allAdmins", "Everyone is an administrator, so everyone can use every drive. Each person's home folder stays private.")) + "</div></div>";
            }
            el.innerHTML = html;
            renderAccounts(el);

            $(el).find("[data-action=add]").on("click", function () {
                addAccount(el, this);
            });
            $(el).find("#wzAccountForm input").on("keydown", function (e) {
                if (e.key === "Enter") {
                    e.preventDefault();
                    addAccount(el, $(el).find("[data-action=add]")[0]);
                }
            });
        },
        leave: function () {
            var typed = $("#wzAccountForm [data-field=username]").val();
            if (typed && typed.trim() !== "") {
                return Promise.reject(new Error(T("accounts/unsaved", "Press Add account to create {name}, or clear the fields", { name: typed.trim() })));
            }
            return saveAccess();
        }
    });
})();
