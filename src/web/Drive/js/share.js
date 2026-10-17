/*
    share.js

    The share dialog, inside the page. It reads the state through
    share/info and only changes it through share/create, share/update and
    share/delete, the same contract as the File Manager's share dialog, so
    shares made in either place look the same in both.

    A path can carry several links, each with its own audience (anyone,
    signed-in users, the same group, invited users or groups), access
    level, password, download option and expiry.
*/

(function (global) {
    "use strict";

    var I = DriveUI.I;
    var esc = DriveUI.esc;
    var API = DriveAPI;
    var DAY = 86400;

    var recipientsCache = null;

    function recipients() {
        if (recipientsCache) {
            return Promise.resolve(recipientsCache);
        }
        return API.shareRecipients().then(function (r) {
            recipientsCache = r || { Users: [], Groups: [] };
            return recipientsCache;
        }).catch(function () {
            return { Users: [], Groups: [] };
        });
    }

    function audienceTitle(share) {
        switch (share.Permission) {
            case "anyone": return share.HasPassword ? T("audience/anyonePw", "Anyone with the link and password") : T("audience/anyone", "Anyone with the link");
            case "signedin": return T("audience/signedin", "Signed-in users");
            case "samegroup": return T("audience/samegroup", "People in the same group");
            case "users": return T("audience/users", "Invited people");
            case "groups": return T("audience/groupsTitle", "Invited groups");
        }
        return share.Permission;
    }

    function audienceIcon(share) {
        switch (share.Permission) {
            case "anyone": return share.HasPassword ? "lock" : "globe";
            case "signedin": return "shield";
            case "samegroup": return "users";
            case "users": return "user";
            case "groups": return "users";
        }
        return "link";
    }

    function detailText(share, isFolder) {
        var bits = [];
        bits.push(share.AccessLevel == "edit" ? T("level/edit", "Can edit") : T("level/view", "Can view"));
        if (share.ExpireAt > 0) {
            bits.push(share.IsExpired ? T("share/expired", "Expired") : T("share/expires", "Expires {date}", { date: DriveUI.fmtDay(share.ExpireAt) }));
        }
        if (share.HasPassword) {
            bits.push(T("share/hasPassword", "Password"));
        }
        if (!share.AllowDownload) {
            bits.push(T("share/noDownload", "No download"));
        }
        if (isFolder && !share.ShowFileList) {
            bits.push(T("share/noList", "File list hidden"));
        }
        return bits.join(" · ");
    }

    function showQR(share) {
        var url = API.shareURL(share.UUID);
        var ctx = DriveUI.modal({
            title: T("share/qr", "QR code"),
            icon: "qr",
            body: '<div class="qr-box"><div id="qrTarget"></div></div><div class="share-link-row"><input class="input" readonly value="' + esc(url) + '"></div>',
            buttons: [{ label: T("common/close", "Close"), cls: "primary" }]
        });
        var draw = function () {
            try {
                new QRCode(ctx.body.querySelector("#qrTarget"), { text: url, width: 200, height: 200 });
            } catch (e) {
                ctx.body.querySelector("#qrTarget").textContent = url;
            }
        };
        if (global.QRCode) {
            draw();
        } else {
            var s = document.createElement("script");
            s.src = API.ROOT + "script/qrcode.min.js";
            s.onload = draw;
            document.head.appendChild(s);
        }
    }

    /* ------------------------------------------------------------------ */
    function open(item) {
        if (!item) {
            return;
        }
        var state = { info: null, editing: null, formOpen: false };
        var body = DriveUI.el('<div><div id="shLinks"><div class="state" style="padding:30px"><div class="spinner"></div></div></div><div id="shForm"></div></div>');
        var ctx = DriveUI.modal({
            title: T("share/title", "Share \"{name}\"", { name: item.name }),
            iconHTML: DriveIcons.file(item.name, item.isDir),
            size: "wide",
            body: body,
            footLeft: '<button class="btn" id="shCopy">' + I("link") + esc(T("menu/copyLink", "Copy link")) + '</button>',
            buttons: [{ label: T("common/done", "Done"), cls: "primary" }],
            onClose: function () {
                Drive.refresh();
            }
        });
        var copyBtn = ctx.node.querySelector("#shCopy");

        function shares() {
            return (state.info && state.info.Shares) || [];
        }

        function reload() {
            return API.shareInfo(item.path).then(function (info) {
                state.info = info;
                if (!shares().length && info.CanManage !== false) {
                    state.formOpen = true;
                }
                render();
            }).catch(function (err) {
                body.querySelector("#shLinks").innerHTML = '<div class="banner">' + I("alert") + '<span>' + esc(err.message) + '</span></div>';
            });
        }

        function render() {
            var info = state.info;
            var links = body.querySelector("#shLinks");
            var isFolder = !!(info.IsFolder || item.isDir);
            var html = "";
            if (info.CanManage === false) {
                html += '<div class="banner info">' + I("info") + '<span>' + esc(T("share/notOwner", "This item is shared by someone else. Only they can change its links.")) + '</span></div>';
            }
            if (!shares().length) {
                html += '<div class="audience"><div class="bubble private">' + I("lock") + '</div><div class="body"><b>' + esc(T("share/private", "Not shared")) +
                    '</b><small>' + esc(T("share/privateText", "Only you and people with access to this location can open it.")) + '</small></div></div>';
            }
            shares().forEach(function (s) {
                var chips = (s.Accessibles || []).map(function (n) { return '<span class="chip">' + esc(n) + '</span>'; }).join("");
                html += '<div class="audience" data-uuid="' + esc(s.UUID) + '"><div class="bubble' + (s.Permission == "anyone" && !s.HasPassword ? "" : " private") + '">' + I(audienceIcon(s)) + '</div>' +
                    '<div class="body"><b>' + esc(audienceTitle(s)) + (s.IsExpired ? ' <span class="chip danger">' + esc(T("share/expired", "Expired")) + '</span>' : "") + '</b>' +
                    '<small>' + esc(detailText(s, isFolder)) + '</small>' + (chips ? '<div class="chips">' + chips + '</div>' : "") + '</div>' +
                    '<button class="icon-btn small" data-act="copy" title="' + esc(T("menu/copyLink", "Copy link")) + '">' + I("copy") + '</button>' +
                    '<button class="icon-btn small hide-xs" data-act="qr" title="' + esc(T("share/qr", "QR code")) + '">' + I("qr") + '</button>' +
                    (info.reduced || info.CanManage === false ? "" : '<button class="icon-btn small" data-act="edit" title="' + esc(T("share/edit", "Edit link")) + '">' + I("pencil") + '</button>') +
                    (info.CanManage === false ? "" : '<button class="icon-btn small" data-act="remove" title="' + esc(T("share/remove", "Remove link")) + '">' + I("trash") + '</button>') +
                    '</div>';
            });
            if (info.CanManage !== false && !state.formOpen) {
                if (!info.reduced || !shares().length) {
                    html += '<button class="btn" id="shNew">' + I("plus") + esc(T("share/newLink", "Create a link")) + '</button>';
                }
            }
            links.innerHTML = html;
            copyBtn.disabled = !shares().some(function (s) { return !s.IsExpired; }) && info.CanManage === false;

            links.querySelectorAll(".audience[data-uuid]").forEach(function (row) {
                var s = shares().filter(function (x) { return x.UUID == row.getAttribute("data-uuid"); })[0];
                row.querySelectorAll("[data-act]").forEach(function (b) {
                    b.addEventListener("click", function () {
                        var act = b.getAttribute("data-act");
                        if (act == "copy") {
                            DriveActions.copyText(API.shareURL(s.UUID)).then(function () {
                                DriveUI.toast(T("share/copied", "Link copied"), { type: "success" });
                            });
                        } else if (act == "qr") {
                            showQR(s);
                        } else if (act == "edit") {
                            state.editing = s;
                            state.formOpen = true;
                            render();
                        } else if (act == "remove") {
                            API.shareDelete(s.UUID, item.path).then(function () {
                                DriveUI.toast(T("share/removed", "Link removed"), { type: "success" });
                                reload();
                            }).catch(DriveUI.error);
                        }
                    });
                });
            });
            var nb = links.querySelector("#shNew");
            if (nb) {
                nb.addEventListener("click", function () {
                    state.editing = null;
                    state.formOpen = true;
                    render();
                });
            }
            renderForm(isFolder);
        }

        function renderForm(isFolder) {
            var holder = body.querySelector("#shForm");
            if (!state.formOpen || state.info.CanManage === false) {
                holder.innerHTML = "";
                return;
            }
            if (state.info.reduced) {
                holder.innerHTML = '<div class="share-form"><p>' + esc(T("share/reducedText", "In limited mode Drive can create one public link per item.")) + '</p>' +
                    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-bottom:12px"><button class="btn" data-f="cancel">' + esc(T("common/cancel", "Cancel")) + '</button>' +
                    '<button class="btn primary" data-f="save">' + esc(T("share/create", "Create link")) + '</button></div></div>';
                holder.querySelector('[data-f="cancel"]').addEventListener("click", function () { state.formOpen = false; render(); });
                holder.querySelector('[data-f="save"]').addEventListener("click", function () {
                    API.shareCreate(item.path, {}).then(function () {
                        state.formOpen = false;
                        reload();
                    }).catch(DriveUI.error);
                });
                return;
            }
            var e = state.editing || { Permission: "anyone", Accessibles: [], AccessLevel: "view", AllowDownload: true, ShowFileList: true, HasPassword: false, ExpireAt: 0 };
            var expiry = "never";
            if (e.ExpireAt > 0) {
                expiry = "custom";
            }
            var dateVal = e.ExpireAt > 0 ? new Date(e.ExpireAt * 1000) : new Date(Date.now() + 7 * DAY * 1000);
            var pad = function (n) { return (n < 10 ? "0" : "") + n; };
            var dateStr = dateVal.getFullYear() + "-" + pad(dateVal.getMonth() + 1) + "-" + pad(dateVal.getDate());

            holder.innerHTML = '<div class="share-form">' +
                '<div class="field-label" style="margin-bottom:10px;font-size:13.5px;color:var(--text)">' + esc(state.editing ? T("share/editTitle", "Edit link") : T("share/newLink", "Create a link")) + '</div>' +
                '<div class="form-grid">' +
                '<div class="field"><label>' + esc(T("share/who", "Who can open it")) + '</label><select class="select" data-f="perm">' +
                ['anyone', 'signedin', 'samegroup', 'users', 'groups'].map(function (p) {
                    var labels = {
                        anyone: T("audience/anyone", "Anyone with the link"), signedin: T("audience/signedin", "Signed-in users"),
                        samegroup: T("audience/samegroup", "People in the same group"), users: T("audience/pickUsers", "Specific people"), groups: T("audience/pickGroups", "Specific groups")
                    };
                    return '<option value="' + p + '"' + (e.Permission == p ? " selected" : "") + '>' + esc(labels[p]) + '</option>';
                }).join("") + '</select></div>' +
                '<div class="field"><label>' + esc(T("share/level", "Access")) + '</label><select class="select" data-f="level"' + (isFolder ? "" : " disabled") + '>' +
                '<option value="view"' + (e.AccessLevel != "edit" ? " selected" : "") + '>' + esc(T("level/view", "Can view")) + '</option>' +
                '<option value="edit"' + (e.AccessLevel == "edit" ? " selected" : "") + '>' + esc(T("level/editFolder", "Can edit (upload and change files)")) + '</option></select></div>' +
                '</div>' +
                '<div class="field" data-f="pickWrap" hidden><label data-f="pickLabel"></label><div class="picklist" data-f="pick"><span class="muted" style="padding:4px 6px">' + esc(T("common/loading", "Loading...")) + '</span></div></div>' +
                '<div class="form-grid">' +
                '<div class="field"><label>' + esc(T("share/expiry", "Link expires")) + '</label><select class="select" data-f="expiry">' +
                '<option value="never"' + (expiry == "never" ? " selected" : "") + '>' + esc(T("share/never", "Never")) + '</option>' +
                '<option value="1">' + esc(T("share/in1", "In 1 day")) + '</option>' +
                '<option value="7">' + esc(T("share/in7", "In 7 days")) + '</option>' +
                '<option value="30">' + esc(T("share/in30", "In 30 days")) + '</option>' +
                '<option value="custom"' + (expiry == "custom" ? " selected" : "") + '>' + esc(T("share/onDate", "On a date...")) + '</option></select></div>' +
                '<div class="field" data-f="dateWrap"' + (expiry == "custom" ? "" : " hidden") + '><label>' + esc(T("share/date", "Expiry date")) + '</label><input class="input" type="date" data-f="date" value="' + dateStr + '"></div>' +
                '</div>' +
                '<label class="toggle-row"><span>' + esc(T("share/password", "Require a password")) + '<small>' + esc(e.HasPassword ? T("share/passwordSet", "A password is set. Type a new one to change it.") : T("share/passwordHint", "Only people with the password can open the link")) + '</small></span>' +
                '<span class="switch"><input type="checkbox" data-f="pwOn"' + (e.HasPassword ? " checked" : "") + '><span></span></span></label>' +
                '<div class="field" data-f="pwWrap"' + (e.HasPassword ? "" : " hidden") + '><input class="input" type="password" data-f="pw" autocomplete="new-password" placeholder="' + esc(e.HasPassword ? T("share/keepPassword", "Leave empty to keep the current password") : T("share/newPassword", "Password")) + '"></div>' +
                '<label class="toggle-row"><span>' + esc(T("share/allowDownload", "Allow download")) + '</span><span class="switch"><input type="checkbox" data-f="dl"' + (e.AllowDownload ? " checked" : "") + '><span></span></span></label>' +
                (isFolder ? '<label class="toggle-row"><span>' + esc(T("share/showList", "Show the file list")) + '</span><span class="switch"><input type="checkbox" data-f="list"' + (e.ShowFileList ? " checked" : "") + '><span></span></span></label>' : "") +
                '<div style="display:flex;gap:8px;justify-content:flex-end;margin-bottom:14px"><button class="btn" data-f="cancel">' + esc(T("common/cancel", "Cancel")) + '</button>' +
                '<button class="btn primary" data-f="save">' + esc(state.editing ? T("common/save", "Save") : T("share/create", "Create link")) + '</button></div></div>';

            var q = function (k) { return holder.querySelector('[data-f="' + k + '"]'); };
            var chosen = (e.Accessibles || []).slice();

            function syncPick() {
                var perm = q("perm").value;
                var wrap = q("pickWrap");
                if (perm != "users" && perm != "groups") {
                    wrap.hidden = true;
                    return;
                }
                wrap.hidden = false;
                q("pickLabel").textContent = perm == "users" ? T("share/pickUsers", "Choose people") : T("share/pickGroups", "Choose groups");
                recipients().then(function (r) {
                    var names = perm == "users" ? r.Users.filter(function (u) { return !u.IsSelf; }).map(function (u) { return u.Username; }) : r.Groups;
                    if (!names.length) {
                        q("pick").innerHTML = '<span class="muted" style="padding:4px 6px">' + esc(T("share/nobody", "Nobody to choose from")) + '</span>';
                        return;
                    }
                    q("pick").innerHTML = names.map(function (n) {
                        var on = chosen.indexOf(n) >= 0;
                        return '<label class="' + (on ? "on" : "") + '"><input type="checkbox" value="' + esc(n) + '"' + (on ? " checked" : "") + '>' + I(perm == "users" ? "user" : "users") + esc(n) + '</label>';
                    }).join("");
                    q("pick").querySelectorAll("input").forEach(function (cb) {
                        cb.addEventListener("change", function () {
                            cb.parentNode.classList.toggle("on", cb.checked);
                            var v = cb.value;
                            var at = chosen.indexOf(v);
                            if (cb.checked && at < 0) {
                                chosen.push(v);
                            } else if (!cb.checked && at >= 0) {
                                chosen.splice(at, 1);
                            }
                        });
                    });
                });
            }

            q("perm").addEventListener("change", function () {
                chosen = [];
                syncPick();
            });
            q("expiry").addEventListener("change", function () {
                q("dateWrap").hidden = q("expiry").value != "custom";
            });
            q("pwOn").addEventListener("change", function () {
                q("pwWrap").hidden = !q("pwOn").checked;
                if (q("pwOn").checked) {
                    q("pw").focus();
                }
            });
            q("cancel").addEventListener("click", function () {
                state.formOpen = false;
                state.editing = null;
                render();
            });
            q("save").addEventListener("click", function () {
                var perm = q("perm").value;
                if ((perm == "users" || perm == "groups") && !chosen.length) {
                    DriveUI.toast(perm == "users" ? T("share/needUsers", "Choose at least one person") : T("share/needGroups", "Choose at least one group"), { type: "error" });
                    return;
                }
                var settings = {
                    permission: perm,
                    accessibles: chosen.join(","),
                    accessLevel: isFolder ? q("level").value : "view",
                    allowDownload: q("dl").checked ? "true" : "false"
                };
                if (isFolder) {
                    settings.showFileList = q("list").checked ? "true" : "false";
                }
                var exp = q("expiry").value;
                if (exp == "never") {
                    settings.expireAt = "0";
                } else if (exp == "custom") {
                    var d = new Date(q("date").value + "T23:59:59");
                    if (isNaN(d.getTime()) || d.getTime() < Date.now()) {
                        DriveUI.toast(T("share/badDate", "Choose a date in the future"), { type: "error" });
                        return;
                    }
                    settings.expireAt = String(Math.floor(d.getTime() / 1000));
                } else {
                    settings.expireIn = String(parseInt(exp, 10) * DAY);
                }
                if (!q("pwOn").checked) {
                    if (e.HasPassword) {
                        settings.clearPassword = "true";
                    }
                } else if (q("pw").value) {
                    settings.password = q("pw").value;
                } else if (!e.HasPassword) {
                    DriveUI.toast(T("share/needPassword", "Type a password or turn the option off"), { type: "error" });
                    return;
                }
                var req = state.editing ? API.shareUpdate(state.editing.UUID, settings) : API.shareCreate(item.path, settings);
                q("save").disabled = true;
                req.then(function (saved) {
                    var wasNew = !state.editing;
                    state.formOpen = false;
                    state.editing = null;
                    if (wasNew && saved && saved.UUID) {
                        DriveActions.copyText(API.shareURL(saved.UUID)).then(function () {
                            DriveUI.toast(T("share/createdCopied", "Link created and copied"), { type: "success" });
                        }).catch(function () {
                            DriveUI.toast(T("share/created", "Link created"), { type: "success" });
                        });
                    } else {
                        DriveUI.toast(T("share/saved", "Link updated"), { type: "success" });
                    }
                    reload();
                }).catch(function (err) {
                    q("save").disabled = false;
                    DriveUI.error(err);
                });
            });
            syncPick();
        }

        copyBtn.addEventListener("click", function () {
            DriveActions.copyLink(item);
            setTimeout(reload, 600);
        });
        reload();
    }

    global.DriveShare = {
        open: open,
        audienceTitle: audienceTitle,
        audienceIcon: audienceIcon,
        detailText: detailText
    };
})(window);
