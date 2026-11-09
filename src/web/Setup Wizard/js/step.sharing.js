/*
    Step: File sharing

    Turns on the file servers that let other computers open the drives over
    the network: Windows file sharing (the built-in SMB server, or Samba when
    that is what the host has), WebDAV and SFTP. Switches apply at once,
    through the same endpoints as System Settings > File Servers.

    The built-in SMB server needs a separate SMB password per person (NTLM
    cannot use the login hash), so turning it on also asks the admin for
    theirs, confirmed with their login password.
*/

(function () {
    "use strict";
    var W = window.Wizard, T = W.T, esc = W.esc;

    var SERVERS = {
        smb: {
            icon: "windows",
            title: function () { return T("share/smb", "Windows file sharing (SMB)"); },
            desc: function () { return T("share/smb/desc", "Open the server in Windows Explorer or the macOS Finder like any network drive. This server is still experimental."); }
        },
        smbd: {
            icon: "windows",
            title: function () { return T("share/samba", "Windows file sharing (Samba)"); },
            desc: function () { return T("share/samba/desc", "Share drives through Samba. Each person sets a Samba password in System Settings > File Servers."); }
        },
        webdav: {
            icon: "globe",
            title: function () { return "WebDAV"; },
            desc: function () { return T("share/webdav/desc", "For file managers, phones and sync apps that support WebDAV. Uses the same address as this page."); }
        },
        sftp: {
            icon: "terminal",
            title: function () { return "SFTP"; },
            desc: function () { return T("share/sftp/desc", "Secure transfers with apps such as FileZilla or WinSCP."); }
        }
    };
    var ORDER = ["smb", "smbd", "webdav", "sftp"];

    function offered() {
        var list = [];
        ORDER.forEach(function (id) {
            W.state.fileServers.forEach(function (s) {
                if (s.id === id) {
                    list.push(s);
                }
            });
        });
        //The built-in SMB server and Samba both take port 445: offer one
        if (list.some(function (s) { return s.id === "smb"; })) {
            list = list.filter(function (s) { return s.id !== "smbd"; });
        }
        return list;
    }

    function addressOf(ep) {
        var host = window.location.hostname;
        if (ep.ProtocolName === "smb://") {
            return ep.Port ? "smb://" + host + ":" + ep.Port : "\\\\" + host;
        }
        return ep.ProtocolName + host + (ep.Port ? ":" + ep.Port : "") + (ep.Subpath || "");
    }

    function showAddress($card, id) {
        var $addr = $card.find("[data-address]");
        W.api("GET", "system/network/server/endpoints?fserv=" + encodeURIComponent(id)).then(function (eps) {
            if (!Array.isArray(eps) || eps.length === 0) {
                $addr.empty();
                return;
            }
            $addr.html(esc(T("share/address", "Address")) + ': <span class="wz-mono">' + esc(addressOf(eps[0])) + "</span>");
        }, function () {
            $addr.empty();
        });
    }

    function setEnabled(server, on) {
        return W.api("POST", "system/network/server/toggle", { id: server.id, enable: on ? "true" : "false" }).then(function () {
            server.enabled = on;
            W.progress.sharing[server.id] = on;
            W.save();
        });
    }

    //The SMB password panel of the built-in server
    function smbPanel($card, server) {
        var $panel = $card.find("[data-panel]");
        W.api("GET", "system/storage/smb/status").then(function (status) {
            var activated = status && status.Activated;
            $panel.removeClass("wz-hidden").html(
                '<div class="wz-row-sub" style="margin-bottom:10px">' + esc(activated
                    ? T("share/smb/hasPassword", "You already have an SMB password. Set a new one here if you like.")
                    : T("share/smb/needPassword", "Windows signs in with a separate SMB password. Set yours now; each person sets their own in System Settings > File Servers.")) + "</div>" +
                '<div class="wz-form">' +
                '<div class="wz-field"><label>' + esc(T("share/smb/password", "New SMB password")) + '</label><input class="wz-input" type="password" data-field="smbpassword" autocomplete="new-password" minlength="8"></div>' +
                '<div class="wz-field"><label>' + esc(T("share/smb/login", "Your ArozOS password")) + '</label><input class="wz-input" type="password" data-field="password" autocomplete="current-password"></div>' +
                '<div class="wz-form-actions"><button type="button" class="wz-btn primary small" data-action="smbpw">' + esc(T("share/smb/save", "Save SMB password")) + "</button>" +
                '<span class="wz-hint">' + esc(T("share/smb/rule", "At least 8 characters")) + "</span></div></div>");
            $panel.find("[data-action=smbpw]").on("click", function () {
                var button = this;
                var smbpassword = $panel.find("[data-field=smbpassword]").val();
                var password = $panel.find("[data-field=password]").val();
                if (smbpassword.length < 8) {
                    $panel.find("[data-field=smbpassword]").addClass("invalid").trigger("focus");
                    W.toast(T("share/smb/short", "The SMB password must be at least 8 characters"), true);
                    return;
                }
                W.working(button, true);
                W.api("POST", "system/storage/smb/activate", { smbpassword: smbpassword, password: password }).then(function () {
                    W.working(button, false);
                    $panel.find("input").val("");
                    W.toast(T("share/smb/saved", "SMB password saved. Sign in from Windows as {user}.", { user: W.state.username }));
                }, function (err) {
                    W.working(button, false);
                    W.toast(err.message, true);
                });
            });
        }, function () {
            $panel.addClass("wz-hidden");
        });
    }

    function renderServer(server) {
        var info = SERVERS[server.id];
        var $card = $('<div class="wz-card"></div>').html(
            '<div class="wz-card-head"><div class="wz-card-icon">' + W.icon(info.icon) + "</div>" +
            '<div class="wz-grow"><div class="wz-card-title">' + esc(info.title()) + "</div>" +
            '<div class="wz-card-sub">' + esc(info.desc()) + "</div>" +
            '<div class="wz-hint" data-address></div></div>' +
            '<label class="wz-switch"><input type="checkbox"' + (server.enabled ? " checked" : "") + ' aria-label="' + esc(info.title()) + '"><span></span></label></div>' +
            '<div class="wz-inline-panel wz-hidden" data-panel></div>');
        var $toggle = $card.find(".wz-switch input");
        $toggle.on("change", function () {
            var on = this.checked;
            $toggle.prop("disabled", true);
            setEnabled(server, on).then(function () {
                $toggle.prop("disabled", false);
                W.toast(on ? T("share/on", "{name} is on", { name: info.title() }) : T("share/off", "{name} is off", { name: info.title() }));
                refresh($card, server);
            }, function (err) {
                $toggle.prop("disabled", false).prop("checked", !on);
                W.toast(err.message, true);
            });
        });
        refresh($card, server);
        return $card;
    }

    function refresh($card, server) {
        if (server.enabled) {
            showAddress($card, server.id);
            if (server.id === "smb") {
                smbPanel($card, server);
            }
        } else {
            $card.find("[data-address]").empty();
            $card.find("[data-panel]").addClass("wz-hidden").empty();
        }
    }

    W.register({
        id: "sharing",
        title: function () {
            return T("step/sharing", "File sharing");
        },
        render: function (el) {
            var html = '<div class="wz-eyebrow">' + esc(T("share/eyebrow", "File sharing")) + "</div>" +
                '<h1 class="wz-title">' + esc(T("share/title", "Open your files from other computers")) + "</h1>" +
                '<p class="wz-lead">' + esc(T("share/lead", "Turn on the ways your computers and phones can reach this server over your network. Everyone signs in with their own account and sees only the drives they may use.")) + "</p>" +
                '<div class="wz-note">' + W.icon("info") + "<div>" + esc(T("share/note", "All of these are optional. You can always use your files in the browser, and change this later in System Settings > File Servers.")) + "</div></div>" +
                '<div id="wzServers"></div>';
            var list = offered();
            if (W.state.platform === "windows" && !list.some(function (s) { return s.id === "smb" || s.id === "smbd"; })) {
                html += '<div class="wz-note warn">' + W.icon("windows") + "<div>" +
                    esc(T("share/noSmbWindows", "Windows file sharing is not offered while ArozOS itself runs on Windows, because Windows keeps that port for its own sharing.")) +
                    "</div></div>";
            }
            el.innerHTML = html;
            var $box = $(el).find("#wzServers");
            if (list.length === 0) {
                $box.html('<div class="wz-empty">' + esc(T("share/none", "No file servers are available on this system.")) + "</div>");
                return;
            }
            list.forEach(function (server) {
                $box.append(renderServer(server));
            });
            window.WizardFillIcons($box[0]);
        }
    });
})();
