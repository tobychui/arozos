/*
    file_share.js

    Logic of the File Share dialog (file_share.html).

    The dialog only reads the share state through share/info and changes it
    through share/create, share/update and share/delete - opening the dialog
    never creates a share by itself.

    A file can carry several shares. Each is one link with its own audience
    (anyone / signed in / same group / invited users / invited groups),
    access level, password, download and listing options and expiry:

        Quick Share          one link at a glance, or the list of all links
        Advanced Settings    create a link, or edit one, with every option
        Permissions          public links, invited users and invited groups
*/

var ShareDialog = (function () {
    "use strict";

    var API = "../../system/file_system/share/";
    var DAY = 86400;

    var state = {
        file: null,            //{filename, filepath, ...flags} from the hash
        info: null,            //Response of share/info
        stat: null,            //{Size, FileCount} once the folder walk returns
        recipients: null,      //Response of share/recipients (lazy)
        tab: "quick",
        editingUUID: null,     //Share edited in Advanced Settings, null = new share
        peopleView: "people",
        pendingAllowDownload: true
    };

    /* ------------------------------------------------------------------ */
    /*  Helpers                                                            */
    /* ------------------------------------------------------------------ */

    //Localised string with an English fallback and {placeholders}
    function T(key, fallback, vars) {
        var text = (typeof applocale !== "undefined") ? applocale.getString(key, fallback) : fallback;
        if (vars) {
            Object.keys(vars).forEach(function (k) {
                text = text.split("{" + k + "}").join(vars[k]);
            });
        }
        return text;
    }

    function esc(str) {
        return String(str == null ? "" : str)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;")
            .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    function api(endpoint, data, method) {
        var deferred = $.Deferred();
        $.ajax({
            url: API + endpoint,
            method: method || "GET",
            data: data || {},
            success: function (resp) {
                if (resp && resp.error !== undefined) {
                    deferred.reject(resp.error);
                } else {
                    deferred.resolve(resp);
                }
            },
            error: function (xhr) {
                deferred.reject("HTTP " + xhr.status);
            }
        });
        return deferred.promise();
    }

    function shareURL(share) {
        return window.location.origin + "/share/" + share.UUID;
    }

    function formatDate(unix) {
        var d = new Date(unix * 1000);
        var pad = function (n) { return (n < 10 ? "0" : "") + n; };
        return d.getFullYear() + "/" + pad(d.getMonth() + 1) + "/" + pad(d.getDate());
    }

    function expiryText(share) {
        return share.ExpireAt > 0 ? formatDate(share.ExpireAt) : T("expiry/never", "Forever");
    }

    function formatSize(bytes) {
        if (bytes == null || bytes < 0) {
            return "";
        }
        var units = ["B", "KB", "MB", "GB", "TB"];
        var i = 0;
        var value = bytes;
        while (value >= 1024 && i < units.length - 1) {
            value /= 1024;
            i++;
        }
        return (i == 0 ? value : value.toFixed(1)) + " " + units[i];
    }

    function isFolder() {
        return state.info && state.info.IsFolder;
    }

    function shares() {
        return (state.info && state.info.Shares) ? state.info.Shares : [];
    }

    function findShare(uuid) {
        return shares().filter(function (s) { return s.UUID == uuid; })[0] || null;
    }

    function isPublicShare(share) {
        return share.Permission == "anyone" || share.Permission == "signedin" || share.Permission == "samegroup";
    }

    function levelText(level) {
        return level == "edit" ? T("level/edit", "Can Edit") : T("level/view", "Can View");
    }

    function shareTitle(share) {
        switch (share.Permission) {
            case "anyone":
                return share.HasPassword ? T("kind/private", "Private Share (Password)") : T("kind/public", "Public Share");
            case "signedin":
                return T("kind/signedin", "Signed-in Users");
            case "samegroup":
                return T("kind/samegroup", "Same Group");
            case "users":
                return T("kind/user", "Invited User: {name}", {name: share.Accessibles.join(", ")});
            case "groups":
                return T("kind/group", "Group Share: {name}", {name: share.Accessibles.join(", ")});
        }
        return share.Permission;
    }

    function shareIcon(share) {
        if (share.HasPassword) {
            return "lock";
        }
        switch (share.Permission) {
            case "anyone": return "globe";
            case "signedin": return "user circle outline";
            case "samegroup": return "users";
            case "users": return "user friends";
            case "groups": return "sitemap";
        }
        return "share alternate";
    }

    function audienceText(share) {
        var key = {
            anyone: ["aud/anyone", "Anyone with the link can access"],
            signedin: ["aud/signedin", "Signed-in users with the link can access"],
            samegroup: ["aud/samegroup", "Users in the same group can access"],
            users: ["aud/users", "Only invited users can access"],
            groups: ["aud/groups", "Only members of the selected groups can access"]
        }[share ? share.Permission : "anyone"];
        var text = T(key[0], key[1]);
        if (share && share.HasPassword) {
            text += " · " + T("aud/password", "Password protected");
        }
        return text;
    }

    //Stable colour per name for the avatar circles
    function avatarColor(name) {
        var palette = ["#1a73e8", "#e8710a", "#188038", "#a142f4", "#d01884", "#007b83", "#c5221f", "#5f6368"];
        var hash = 0;
        for (var i = 0; i < name.length; i++) {
            hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
        }
        return palette[hash % palette.length];
    }

    var toastTimer = null;
    function toast(message, isError) {
        var el = $("#toast");
        el.text(message).toggleClass("error", !!isError).addClass("show");
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { el.removeClass("show"); }, isError ? 4000 : 2200);
    }

    function copyText(text) {
        if (navigator.clipboard && window.isSecureContext) {
            return navigator.clipboard.writeText(text);
        }
        var area = document.createElement("textarea");
        area.value = text;
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        document.body.removeChild(area);
        return $.Deferred().resolve().promise();
    }

    function copyLink(share, btn) {
        copyText(shareURL(share));
        toast(T("quick/copied", "Copied!"));
        if (btn) {
            var original = $(btn).html();
            $(btn).html(`<i class="check icon"></i> ${esc(T("quick/copied", "Copied!"))}`);
            setTimeout(function () { $(btn).html(original); }, 1800);
        }
    }

    function confirmAction(message, okLabel, callback) {
        $("#confirmText").text(message);
        $("#confirmOk").text(okLabel || T("menu/remove", "Remove Share"));
        $("#confirmOverlay").fadeIn(100);
        $("#confirmOk").off("click").on("click", function () {
            $("#confirmOverlay").fadeOut(100);
            callback();
        });
    }

    function showQRCode(share) {
        $("#qrCode").empty();
        new QRCode(document.getElementById("qrCode"), shareURL(share));
        $("#qrLink").text(shareURL(share));
        $("#qrOverlay").fadeIn(100);
    }

    /* ------------------------------------------------------------------ */
    /*  Parent frame integration                                           */
    /* ------------------------------------------------------------------ */

    //Tell whoever opened us that the share state of the file changed, so the
    //share badge in the File Manager / on the desktop stays in step.
    function notifyParent() {
        if (!state.info || window.parent === window) {
            return;
        }
        var isShared = !!state.info.IsShared;
        try {
            if (typeof parent.onShareStateChanged === "function") {
                parent.onShareStateChanged(state.file.filepath, isShared);
                return;
            }
            var dir = state.file.filepath.split("/").slice(0, -1).join("/");
            if (dir == "user:/Desktop") {
                var fn = isShared ? "setFileShareIndicator" : "removeFileShareIndicator";
                if (typeof parent[fn] === "function") {
                    parent[fn](state.file.filename);
                }
            }
        } catch (ex) {
            //Parent is gone or cross origin - not fatal
        }
    }

    function closeDialog() {
        try {
            if (window.parent !== window && typeof parent.hideShare === "function") {
                parent.hideShare();
                return;
            }
        } catch (ex) {}
        if (typeof ao_module_virtualDesktop !== "undefined" && ao_module_virtualDesktop) {
            ao_module_close();
        } else {
            window.close();
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Loading                                                            */
    /* ------------------------------------------------------------------ */

    function reload() {
        return api("info", {path: state.file.filepath}).then(function (info) {
            state.info = info;
            if (state.editingUUID && !findShare(state.editingUUID)) {
                state.editingUUID = null;
            }
            render();
            notifyParent();
            return info;
        }, function (err) {
            $("#loadingPane").html(`<i class="exclamation circle icon"></i><p>${esc(err)}</p>`);
        });
    }

    function loadFolderStat() {
        if (!isFolder()) {
            return;
        }
        api("info", {path: state.file.filepath, folderStat: true}).then(function (info) {
            state.stat = {Size: info.Size, FileCount: info.FileCount};
            renderFileCard();
        });
    }

    function loadRecipients() {
        if (state.recipients) {
            return $.Deferred().resolve(state.recipients).promise();
        }
        return api("recipients").then(function (data) {
            state.recipients = data;
            return data;
        });
    }

    //Legacy quick modes from the desktop context menu
    function applyShareMode(mode) {
        if (mode == "remove") {
            return api("delete", {vpath: state.file.filepath}, "POST").then(function () {
                toast(T("msg/removed", "Share removed"));
            }, function () {});
        }
        return api("info", {path: state.file.filepath}).then(function (info) {
            if (info.Shares.length > 0) {
                return api("update", {uuid: info.Shares[0].UUID, permission: mode}, "POST");
            }
            return api("create", {path: state.file.filepath, permission: mode}, "POST");
        }).then(function () {}, function (err) {
            toast(err, true);
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Rendering                                                          */
    /* ------------------------------------------------------------------ */

    function render() {
        $("#loadingPane").hide();
        renderFileCard();

        if (state.info && !state.info.CanManage) {
            $(".tabPane").hide();
            $(".tab").prop("disabled", true);
            $("#notManageablePane").show();
            setFooter("", `<button class="btn primary" data-act="close">${esc(T("btn/done", "Done"))}</button>`);
            return;
        }

        $(".tab").removeClass("active").filter(`[data-tab="${state.tab}"]`).addClass("active");
        $(".tabPane").hide();
        $("#tab-" + state.tab).show();

        if (state.tab == "quick") {
            renderQuick();
        } else if (state.tab == "advanced") {
            renderAdvanced();
        } else {
            renderPeople();
        }
    }

    function renderFileCard() {
        var info = state.info;
        var name = info ? info.Filename : state.file.filename;
        var folder = info ? info.IsFolder : false;
        $("#fileName").text(name).attr("title", name);
        $("#filePath").text(state.file.filepath).attr("title", state.file.filepath);
        if (typeof FileThumb !== "undefined") {
            $("#fileIcon").html(FileThumb.largeGlyph(name, folder));
        }

        var stat = "";
        if (info && !folder) {
            stat = formatSize(info.Size);
        } else if (folder && state.stat && state.stat.FileCount >= 0) {
            stat = T("file/items", "{n} files", {n: state.stat.FileCount}) + " · " + formatSize(state.stat.Size);
        } else if (folder) {
            stat = T("file/folder", "Folder");
        }
        $("#fileStat").text(stat || " ");
    }

    function setFooter(leftHTML, rightHTML) {
        $("#footLeft").html(leftHTML);
        $("#footRight").html(rightHTML);
    }

    function switchTab(tab) {
        state.tab = tab;
        render();
        $(".tabBody").scrollTop(0);
    }

    /* ---------- Quick share ---------- */

    function renderQuick() {
        var list = shares();
        if (list.length >= 2) {
            $("#quickSingle").hide();
            $("#quickList").show();
            $("#quickListTitle").text(T("quick/created", "Share Links Created ({n})", {n: list.length}));
            $("#quickListBody").html(list.map(shareRowHTML).join(""));
            setFooter(
                `<div class="footTip"><i class="lightbulb outline icon"></i><span>${esc(T("quick/tip", "Tip: You can revoke a share link or change its permission and expiry at any time."))}</span></div>`,
                `<button class="btn soft" data-act="close">${esc(T("btn/close", "Close"))}</button>`
            );
            return;
        }

        $("#quickList").hide();
        $("#quickSingle").show();
        var share = list[0] || null;
        $("#quickAudienceIcon").attr("class", "rowIcon " + (share ? shareIcon(share) : "globe") + " icon");
        $("#quickAudience").text(audienceText(share));
        $("#quickMenuBtn").toggle(!!share);
        if (share) {
            $("#quickLink").val(shareURL(share));
            $("#quickCopyIcon").show();
            $("#quickLinkBtn").html(esc(T("quick/copy", "Copy Link")));
            $("#quickAllowDownload").prop("checked", share.AllowDownload);
        } else {
            $("#quickLink").val("");
            $("#quickCopyIcon").hide();
            $("#quickLinkBtn").html(`<i class="linkify icon"></i> ${esc(T("quick/create", "Create Link"))}`);
            $("#quickAllowDownload").prop("checked", state.pendingAllowDownload);
        }

        var expiry = share ? expiryText(share) : T("expiry/never", "Forever");
        setFooter(
            `<button class="footPill" data-act="editExpiry"><span>${esc(T("quick/expiry", "Expiry: {x}", {x: expiry}))}</span><i class="angle right icon"></i></button>`,
            `<button class="btn primary" data-act="close">${esc(T("btn/done", "Done"))}</button>`
        );
    }

    function shareRowHTML(share) {
        var status = share.IsExpired
            ? `<span class="statusPill expired">${esc(T("status/expired", "Expired"))}</span>`
            : `<span class="statusPill">${esc(T("status/active", "Active"))}</span>`;
        var desc = shareURL(share);
        if (!isPublicShare(share)) {
            desc = levelText(share.AccessLevel) + " · " + desc;
        }
        return `<div class="shareRow" data-uuid="${esc(share.UUID)}" data-act="editShare">
            <i class="rowIcon ${shareIcon(share)} icon"></i>
            <div class="rowText">
                <div class="rowTitle">${esc(shareTitle(share))}</div>
                <div class="rowDesc">${esc(desc)}</div>
            </div>
            ${status}
            <span class="expiryText">${esc(expiryText(share))}</span>
            <button class="iconBtn" data-act="shareMenu" data-uuid="${esc(share.UUID)}" title="More"><i class="ellipsis horizontal icon"></i></button>
        </div>`;
    }

    function quickCreateLink() {
        var btn = $("#quickLinkBtn").prop("disabled", true);
        api("create", {
            path: state.file.filepath,
            permission: "anyone",
            allowDownload: state.pendingAllowDownload
        }, "POST").then(function () {
            toast(T("msg/created", "Share created"));
            return reload();
        }, function (err) {
            toast(err, true);
        }).always(function () {
            btn.prop("disabled", false);
        });
    }

    /* ---------- Advanced settings ---------- */

    function renderAdvanced() {
        var share = state.editingUUID ? findShare(state.editingUUID) : null;
        var folder = isFolder();

        //What is being edited
        if (share) {
            $("#advContext").html(`<span>${esc(T("adv/editing", "Editing:"))}</span>
                <span class="chip">${esc(shareTitle(share))}</span>
                <a data-act="newShare">${esc(T("adv/createInstead", "Create a new share instead"))}</a>`);
        } else {
            $("#advContext").html(`<span class="chip">${esc(T("adv/new", "New share link"))}</span>`);
        }

        //Expiry
        var mode = "never";
        $("#advExpiryDays").val("");
        $("#advExpiryDate").val("");
        if (share && share.ExpireAt > 0) {
            mode = "date";
            var d = new Date(share.ExpireAt * 1000);
            var pad = function (n) { return (n < 10 ? "0" : "") + n; };
            $("#advExpiryDate").val(d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()));
        }
        $(`input[name="expiryMode"][value="${mode}"]`).prop("checked", true);
        var tomorrow = new Date(Date.now() + DAY * 1000);
        $("#advExpiryDate").attr("min", tomorrow.toISOString().substring(0, 10));

        //Password
        var hasPassword = share ? share.HasPassword : false;
        $("#advPasswordToggle").prop("checked", hasPassword);
        $("#advPassword").val("").attr("type", "password")
            .attr("placeholder", hasPassword ? "••••••••" : T("adv/passwordPlaceholder", "Enter a password"));
        $("#advPasswordEye i").attr("class", "eye icon");
        $("#advPasswordHint").toggle(hasPassword);
        syncPasswordField();

        //Access level (edit is folder only)
        $("#advAccessLevel option[value='edit']").prop("disabled", !folder);
        $("#advAccessLevel").val(share && folder ? share.AccessLevel : "view");
        syncAccessLevelDesc();

        $("#advAllowDownload").prop("checked", share ? share.AllowDownload : true);
        $("#advShowFileList").prop("checked", folder ? (share ? share.ShowFileList : true) : false)
            .prop("disabled", !folder);
        $("#advShowListDesc").text(folder ? T("adv/showListDesc", "Recipients can browse the shared files") : T("adv/folderOnly", "Only available for folders"));

        //Audience (public links only; invites are managed in Permissions)
        var invite = share && !isPublicShare(share);
        $("#advAudience").val(share && !invite ? share.Permission : "anyone").prop("disabled", !!invite);
        $("#advAudienceHint").toggle(!!invite);

        setFooter(
            "",
            `<button class="btn primary" data-act="saveAdvanced" id="advSaveBtn">${esc(share ? T("btn/save", "Save Changes") : T("btn/createShare", "Create Share"))}</button>`
        );
    }

    function syncPasswordField() {
        var on = $("#advPasswordToggle").prop("checked");
        $("#advPasswordField").css("opacity", on ? 1 : 0.5);
        $("#advPassword").prop("disabled", !on);
    }

    function syncAccessLevelDesc() {
        var edit = $("#advAccessLevel").val() == "edit";
        $("#advAccessLevelDesc").text(edit
            ? T("level/editDesc", "Can also upload files into this folder")
            : T("level/viewDesc", "Can only view the content"));
    }

    function collectAdvancedSettings(share) {
        var data = {
            accessLevel: $("#advAccessLevel").val(),
            allowDownload: $("#advAllowDownload").prop("checked")
        };
        if (isFolder()) {
            data.showFileList = $("#advShowFileList").prop("checked");
        }

        //Expiry
        var mode = $('input[name="expiryMode"]:checked').val();
        if (mode == "never") {
            data.expireAt = 0;
        } else if (mode == "date") {
            var value = $("#advExpiryDate").val();
            if (!value) {
                throw T("msg/needDate", "Please choose an expiry date");
            }
            var parts = value.split("-");
            //Valid until the end of the chosen day, local time
            var end = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 23, 59, 59);
            data.expireAt = Math.floor(end.getTime() / 1000);
        } else {
            var days = parseInt($("#advExpiryDays").val(), 10);
            if (!(days > 0)) {
                throw T("msg/needDays", "Please enter the number of days");
            }
            data.expireIn = days * DAY;
        }

        //Password
        var passwordOn = $("#advPasswordToggle").prop("checked");
        var password = $("#advPassword").val();
        if (passwordOn) {
            if (password != "") {
                data.password = password;
            } else if (!share || !share.HasPassword) {
                throw T("msg/needPassword", "Please enter a password");
            }
        } else if (share && share.HasPassword) {
            data.clearPassword = true;
        }

        //Audience of public links
        if (!share || isPublicShare(share)) {
            data.permission = $("#advAudience").val();
        }
        return data;
    }

    function saveAdvanced() {
        var share = state.editingUUID ? findShare(state.editingUUID) : null;
        var data;
        try {
            data = collectAdvancedSettings(share);
        } catch (message) {
            toast(message, true);
            return;
        }

        var request;
        if (share) {
            data.uuid = share.UUID;
            request = api("update", data, "POST");
        } else {
            data.path = state.file.filepath;
            request = api("create", data, "POST");
        }

        var btn = $("#advSaveBtn").prop("disabled", true);
        request.then(function (saved) {
            toast(share ? T("msg/saved", "Changes saved") : T("msg/created", "Share created"));
            state.editingUUID = saved.UUID;
            if (!share) {
                state.tab = "quick";
            }
            return reload();
        }, function (err) {
            toast(err, true);
            btn.prop("disabled", false);
        });
    }

    function editShare(uuid) {
        state.editingUUID = uuid;
        switchTab("advanced");
    }

    /* ---------- Permission management ---------- */

    //Invites, one row per user / group, so a legacy share listing several
    //users still shows each of them
    function inviteRows(permission) {
        var rows = [];
        shares().forEach(function (share) {
            if (share.Permission == permission) {
                share.Accessibles.forEach(function (name) {
                    rows.push({name: name, share: share});
                });
            }
        });
        return rows;
    }

    function renderPeople() {
        var publicShares = shares().filter(isPublicShare);
        var userRows = inviteRows("users");
        var groupRows = inviteRows("groups");

        $("#navPublicDesc").text(T("people/publicDesc", "{n} links · Anyone can access", {n: publicShares.length}));
        $("#navPeopleDesc").text(T("people/sharedDesc", "{u} users · {g} groups", {u: userRows.length, g: groupRows.length}));

        var view = state.peopleView;
        $(".navItem").removeClass("active").filter(`[data-view="${view}"]`).addClass("active");
        $("#sectionPublic").toggle(view == "public");
        $("#sectionUsers, #sectionGroups").toggle(view == "people");

        //Public links
        $("#publicList").html(publicShares.length > 0
            ? publicShares.map(shareRowHTML).join("")
            : `<div class="emptyRow">${esc(T("people/noPublic", "No public link yet"))}</div>`);

        //Invites
        var head = `<div class="peopleHead">
            <span>${esc(T("people/name", "Name"))}</span>
            <span>${esc(T("people/permission", "Permission"))}</span>
            <span class="expiryText">${esc(T("people/expiry", "Expiry"))}</span>
            <span></span>
        </div>`;
        $("#userTable").html(userRows.length > 0
            ? head + userRows.map(function (r) { return personRowHTML(r, false); }).join("")
            : `<div class="emptyRow">${esc(T("people/noUsers", "No user has been invited yet"))}</div>`);
        $("#groupTable").html(groupRows.length > 0
            ? head + groupRows.map(function (r) { return personRowHTML(r, true); }).join("")
            : `<div class="emptyRow">${esc(T("people/noGroups", "No group has been invited yet"))}</div>`);

        //Level pickers of the invite rows
        var levelOptions = `<option value="view">${esc(T("level/view", "Can View"))}</option>` +
            (isFolder() ? `<option value="edit">${esc(T("level/edit", "Can Edit"))}</option>` : "");
        $("#inviteUserLevel, #inviteGroupLevel").each(function () {
            var current = $(this).val();
            $(this).html(levelOptions).val(current || "view");
        });

        setFooter("", `<button class="btn primary" data-act="close">${esc(T("btn/done", "Done"))}</button>`);
    }

    function personRowHTML(row, isGroup) {
        var share = row.share;
        var subtitle = "";
        if (isGroup) {
            subtitle = T("people/groupMember", "Permission group");
        } else if (state.recipients) {
            var user = state.recipients.Users.filter(function (u) { return u.Username == row.name; })[0];
            subtitle = user ? user.Groups.join(", ") : "";
        }
        if (share.IsExpired) {
            subtitle = T("status/expired", "Expired") + (subtitle ? " · " + subtitle : "");
        }

        var levelSelect = `<select class="field" data-act="setLevel" data-uuid="${esc(share.UUID)}" ${isFolder() ? "" : "disabled"}>
            <option value="view" ${share.AccessLevel == "view" ? "selected" : ""}>${esc(T("level/view", "Can View"))}</option>
            ${isFolder() ? `<option value="edit" ${share.AccessLevel == "edit" ? "selected" : ""}>${esc(T("level/edit", "Can Edit"))}</option>` : ""}
        </select>`;

        return `<div class="peopleRow">
            <div class="personCell">
                <div class="avatar ${isGroup ? "group" : ""}" style="background:${avatarColor(row.name)};">${isGroup ? '<i class="users icon"></i>' : esc(row.name.substring(0, 1))}</div>
                <div class="rowText">
                    <div class="rowTitle">${esc(row.name)}</div>
                    <div class="rowDesc">${esc(subtitle)}</div>
                </div>
            </div>
            ${levelSelect}
            <span class="expiryText" data-act="editShare" data-uuid="${esc(share.UUID)}">${esc(expiryText(share))}</span>
            <button class="iconBtn" data-act="inviteMenu" data-uuid="${esc(share.UUID)}" data-name="${esc(row.name)}" title="More"><i class="ellipsis horizontal icon"></i></button>
        </div>`;
    }

    function openInviteRow(isGroup) {
        var row = isGroup ? $("#inviteGroupRow") : $("#inviteUserRow");
        var select = isGroup ? $("#inviteGroupSelect") : $("#inviteUserSelect");
        loadRecipients().then(function (data) {
            var taken = inviteRows(isGroup ? "groups" : "users").map(function (r) { return r.name; });
            var options = isGroup
                ? data.Groups.filter(function (g) { return taken.indexOf(g) < 0; })
                    .map(function (g) { return `<option value="${esc(g)}">${esc(g)}</option>`; })
                : data.Users.filter(function (u) { return !u.IsSelf && taken.indexOf(u.Username) < 0; })
                    .map(function (u) { return `<option value="${esc(u.Username)}">${esc(u.Username)}${u.Groups.length ? " (" + esc(u.Groups.join(", ")) + ")" : ""}</option>`; });
            var placeholder = isGroup ? T("people/selectGroup", "Select a group") : T("people/selectUser", "Select a user");
            select.html(`<option value="">${esc(placeholder)}</option>` + options.join(""));
            row.slideDown(120);
            if (!isGroup) {
                //Subtitles of the user rows come from the recipient list
                renderPeople();
            }
        }, function (err) {
            toast(err, true);
        });
    }

    function confirmInvite(isGroup) {
        var name = (isGroup ? $("#inviteGroupSelect") : $("#inviteUserSelect")).val();
        if (!name) {
            toast(isGroup ? T("people/selectGroup", "Select a group") : T("people/selectUser", "Select a user"), true);
            return;
        }
        api("create", {
            path: state.file.filepath,
            permission: isGroup ? "groups" : "users",
            accessibles: name,
            accessLevel: (isGroup ? $("#inviteGroupLevel") : $("#inviteUserLevel")).val() || "view"
        }, "POST").then(function () {
            toast(T("msg/invited", "Access granted and a notification was sent"));
            (isGroup ? $("#inviteGroupRow") : $("#inviteUserRow")).slideUp(120);
            return reload();
        }, function (err) {
            toast(err, true);
        });
    }

    //Remove one invited user / group. Shares listing several names only lose that name.
    function removeInvite(share, name) {
        var remaining = share.Accessibles.filter(function (n) { return n != name; });
        var request = remaining.length == 0
            ? api("delete", {uuid: share.UUID}, "POST")
            : api("update", {uuid: share.UUID, permission: share.Permission, accessibles: remaining.join(",")}, "POST");
        request.then(function () {
            toast(T("msg/removed", "Share removed"));
            return reload();
        }, function (err) {
            toast(err, true);
        });
    }

    function removeShare(share) {
        confirmAction(T("msg/confirmRemove", "Remove this share link? People using it will lose access."), T("menu/remove", "Remove Share"), function () {
            api("delete", {uuid: share.UUID}, "POST").then(function () {
                toast(T("msg/removed", "Share removed"));
                return reload();
            }, function (err) {
                toast(err, true);
            });
        });
    }

    /* ---------- "..." menus ---------- */

    function openMenu(anchor, items) {
        var menu = $("#popMenu");
        menu.html(items.map(function (item, i) {
            return `<div class="menuItem ${item.danger ? "danger" : ""}" data-index="${i}"><i class="${item.icon} icon"></i><span>${esc(item.label)}</span></div>`;
        }).join(""));
        menu.find(".menuItem").each(function () {
            var item = items[parseInt($(this).attr("data-index"), 10)];
            $(this).on("click", function (e) {
                e.stopPropagation();
                closeMenu();
                item.action();
            });
        });

        var rect = anchor.getBoundingClientRect();
        menu.css({visibility: "hidden"}).show();
        var left = Math.min(rect.right - menu.outerWidth(), window.innerWidth - menu.outerWidth() - 8);
        var top = rect.bottom + 4;
        if (top + menu.outerHeight() > window.innerHeight - 8) {
            top = rect.top - menu.outerHeight() - 4;
        }
        menu.css({left: Math.max(8, left), top: Math.max(8, top), visibility: "visible"});
    }

    function closeMenu() {
        $("#popMenu").hide();
    }

    function shareMenuItems(share) {
        return [
            {icon: "copy outline", label: T("menu/copy", "Copy Link"), action: function () { copyLink(share); }},
            {icon: "external alternate", label: T("menu/open", "Open Link"), action: function () { window.open(shareURL(share), "_blank"); }},
            {icon: "qrcode", label: T("menu/qr", "QR Code"), action: function () { showQRCode(share); }},
            {icon: "edit outline", label: T("menu/edit", "Edit Settings"), action: function () { editShare(share.UUID); }},
            {icon: "trash alternate outline", label: T("menu/remove", "Remove Share"), danger: true, action: function () { removeShare(share); }}
        ];
    }

    /* ------------------------------------------------------------------ */
    /*  Events                                                             */
    /* ------------------------------------------------------------------ */

    function bindEvents() {
        $(".tab").on("click", function () {
            var tab = $(this).attr("data-tab");
            if (tab == "advanced" && state.tab != "advanced") {
                //Opening the tab directly edits the only share, or starts a new one
                var list = shares();
                state.editingUUID = list.length == 1 ? list[0].UUID : null;
            }
            switchTab(tab);
        });

        //Delegated actions
        $(document).on("click", "[data-act]", function (e) {
            var act = $(this).attr("data-act");
            var uuid = $(this).attr("data-uuid");
            var share = uuid ? findShare(uuid) : null;
            switch (act) {
                case "close":
                    closeDialog();
                    break;
                case "editExpiry":
                    editShare(shares().length == 1 ? shares()[0].UUID : null);
                    break;
                case "editShare":
                    if (share) {
                        editShare(share.UUID);
                    }
                    break;
                case "shareMenu":
                    e.stopPropagation();
                    if (share) {
                        openMenu(this, shareMenuItems(share));
                    }
                    break;
                case "inviteMenu":
                    e.stopPropagation();
                    if (share) {
                        var name = $(this).attr("data-name");
                        openMenu(this, [
                            {icon: "copy outline", label: T("menu/copy", "Copy Link"), action: function () { copyLink(share); }},
                            {icon: "calendar alternate outline", label: T("menu/edit", "Edit Settings"), action: function () { editShare(share.UUID); }},
                            {icon: "user times", label: T("menu/removeAccess", "Remove Access"), danger: true, action: function () { removeInvite(share, name); }}
                        ]);
                    }
                    break;
                case "newShare":
                    state.editingUUID = null;
                    renderAdvanced();
                    break;
                case "saveAdvanced":
                    saveAdvanced();
                    break;
            }
        });

        //Keep a select inside a row from triggering the row's own action
        $(document).on("click", "select[data-act]", function (e) {
            e.stopPropagation();
        });

        $(document).on("change", "select[data-act='setLevel']", function () {
            var share = findShare($(this).attr("data-uuid"));
            if (!share) {
                return;
            }
            api("update", {uuid: share.UUID, accessLevel: $(this).val()}, "POST").then(function () {
                toast(T("msg/saved", "Changes saved"));
                return reload();
            }, function (err) {
                toast(err, true);
                renderPeople();
            });
        });

        $(document).on("click", function (e) {
            if (!$(e.target).closest("#popMenu").length) {
                closeMenu();
            }
        });
        $(".tabBody").on("scroll", closeMenu);

        //Quick share
        $("#quickLinkBtn").on("click", function () {
            var share = shares()[0];
            if (share) {
                copyLink(share, this);
            } else {
                quickCreateLink();
            }
        });
        $("#quickCopyIcon").on("click", function () {
            var share = shares()[0];
            if (share) {
                copyLink(share);
            }
        });
        $("#quickLink").on("focus click", function () {
            $(this).select();
        });
        $("#quickMenuBtn").on("click", function (e) {
            e.stopPropagation();
            var share = shares()[0];
            if (share) {
                openMenu(this, shareMenuItems(share));
            }
        });
        $("#quickAllowDownload").on("change", function () {
            var checked = $(this).prop("checked");
            var share = shares()[0];
            if (!share) {
                state.pendingAllowDownload = checked;
                return;
            }
            api("update", {uuid: share.UUID, allowDownload: checked}, "POST").then(function () {
                toast(T("msg/saved", "Changes saved"));
                return reload();
            }, function (err) {
                toast(err, true);
                $("#quickAllowDownload").prop("checked", !checked);
            });
        });
        $("#quickNewShareBtn").on("click", function () {
            editShare(null);
        });

        //Advanced settings
        $("#advPasswordToggle").on("change", function () {
            syncPasswordField();
            if ($(this).prop("checked")) {
                $("#advPassword").focus();
            }
        });
        $("#advPasswordEye").on("click", function () {
            var input = $("#advPassword");
            var show = input.attr("type") == "password";
            input.attr("type", show ? "text" : "password");
            $(this).find("i").attr("class", show ? "eye slash icon" : "eye icon");
        });
        $("#advAccessLevel").on("change", syncAccessLevelDesc);
        $("#advExpiryDate").on("focus change", function () {
            $('input[name="expiryMode"][value="date"]').prop("checked", true);
        });
        $("#advExpiryDays").on("focus input", function () {
            $('input[name="expiryMode"][value="days"]').prop("checked", true);
        });

        //Permission management
        $(".navItem").on("click", function () {
            state.peopleView = $(this).attr("data-view");
            renderPeople();
            $(".tabBody").scrollTop(0);
        });
        $("#addPublicBtn").on("click", function () {
            editShare(null);
        });
        $("#addUserBtn").on("click", function () { openInviteRow(false); });
        $("#addGroupBtn").on("click", function () { openInviteRow(true); });
        $("#inviteUserConfirm").on("click", function () { confirmInvite(false); });
        $("#inviteGroupConfirm").on("click", function () { confirmInvite(true); });
        $("#inviteUserCancel").on("click", function () { $("#inviteUserRow").slideUp(120); });
        $("#inviteGroupCancel").on("click", function () { $("#inviteGroupRow").slideUp(120); });

        //Overlays
        $("#qrClose, #qrOverlay").on("click", function (e) {
            if (e.target === this) {
                $("#qrOverlay").fadeOut(100);
            }
        });
        $("#confirmCancel").on("click", function () {
            $("#confirmOverlay").fadeOut(100);
        });

        $(document).on("keydown", function (e) {
            if (e.key == "Escape") {
                if ($("#popMenu").is(":visible")) {
                    closeMenu();
                } else if ($(".overlay:visible").length > 0) {
                    $(".overlay").fadeOut(100);
                }
            }
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Theme and start up                                                 */
    /* ------------------------------------------------------------------ */

    function applyTheme(isDark) {
        $("body").toggleClass("darkTheme", isDark).toggleClass("whiteTheme", !isDark);
    }

    function initTheme() {
        //Embedded in the File Manager: follow its theme straight away
        try {
            if (window.parent !== window && parent.document.body.classList.contains("darkTheme")) {
                applyTheme(true);
            }
        } catch (ex) {}

        $.get("../../system/file_system/preference?key=file_explorer/theme", function (data) {
            applyTheme(data == "darkTheme");
        });

        if (typeof ao_module_onThemeChanged === "function") {
            ao_module_onThemeChanged(function (theme) {
                applyTheme(theme == "dark" || theme == "darkTheme");
            });
        }
    }

    function start() {
        initTheme();
        bindEvents();

        var input = ao_module_loadInputFiles();
        if (input == null || input.length == 0) {
            $("#loadingPane").html(`<i class="question circle outline icon"></i><p>${esc(T("msg/noFile", "No file selected"))}</p>`);
            setFooter("", "");
            return;
        }
        state.file = input[0];
        renderFileCard();

        var begin = function () {
            var mode = state.file.shareMode;
            var ready = mode ? applyShareMode(mode) : $.Deferred().resolve().promise();
            ready.always(function () {
                reload().then(loadFolderStat);
            });
        };

        //Translate first so dynamic strings come out localised
        applocale.init("../locale/file_share.json", function () {
            applocale.translate();
            begin();
        }, begin);
    }

    return {
        start: start,
        reload: reload
    };
})();

$(function () {
    ShareDialog.start();
});
