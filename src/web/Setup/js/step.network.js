/*
    Step: Network drives

    Optional: connect storage on another machine (SMB, WebDAV, SFTP, FTP or
    S3) as a drive, through the same endpoints as System Settings > Storage
    Pools. The connection can be tried before it is saved.
*/

(function () {
    "use strict";
    var W = window.Wizard, T = W.T, esc = W.esc;

    var PROTOCOLS = [
        ["smb", "SMB", "192.168.1.10/share"],
        ["webdav", "WebDAV", "https://example.com/dav"],
        ["sftp", "SFTP", "192.168.1.10:22/folder"],
        ["ftp", "FTP", "192.168.1.10:21/folder"],
        ["s3", "S3", "s3.amazonaws.com/my-bucket"]
    ];

    function protocolLabel(p) {
        switch (p[0]) {
            case "smb":
                return T("net/proto/smb", "SMB (Windows shared folder or another NAS)");
            case "s3":
                return T("net/proto/s3", "S3 or S3-compatible storage");
        }
        return p[1];
    }

    function config($form) {
        return {
            name: $form.find("[data-field=name]").val().trim(),
            uuid: $form.find("[data-field=id]").val().trim(),
            path: $form.find("[data-field=path]").val().trim(),
            access: "readwrite",
            hierarchy: $form.find("[data-field=hierarchy]").val(),
            automount: false,
            filesystem: $form.find("[data-field=filesystem]").val(),
            username: $form.find("[data-field=username]").val(),
            password: $form.find("[data-field=password]").val()
        };
    }

    function updateProtocol($form) {
        var proto = $form.find("[data-field=filesystem]").val();
        var hint = "";
        PROTOCOLS.forEach(function (p) {
            if (p[0] === proto) {
                hint = p[2];
            }
        });
        $form.find("[data-field=path]").attr("placeholder", hint);
        var s3 = proto === "s3";
        $form.find("[data-label=username]").text(s3 ? T("net/accessKey", "Access key ID") : T("net/username", "Username"));
        $form.find("[data-label=password]").text(s3 ? T("net/secretKey", "Secret access key") : T("net/password", "Password"));
    }

    function renderForm(el) {
        var $form = $(el).find("#wzNetForm");
        var options = PROTOCOLS.map(function (p) {
            return '<option value="' + p[0] + '">' + esc(protocolLabel(p)) + "</option>";
        }).join("");
        $form.html('<div class="wz-form">' +
            '<div class="wz-field wide"><label>' + esc(T("net/protocol", "Type")) + '</label><select class="wz-select" data-field="filesystem">' + options + "</select></div>" +
            '<div class="wz-field wide"><label>' + esc(T("net/server", "Server address")) + '</label><input class="wz-input wz-mono" data-field="path" autocomplete="off" spellcheck="false"></div>' +
            '<div class="wz-field"><label data-label="username"></label><input class="wz-input" data-field="username" autocomplete="off" spellcheck="false"></div>' +
            '<div class="wz-field"><label data-label="password"></label><input class="wz-input" type="password" data-field="password" autocomplete="new-password"></div>' +
            W.driveField("name", T("drive/field/name", "Name"), "") +
            W.driveField("id", T("drive/field/id", "Drive ID"), "", T("drive/field/id/hint", "Files on it will be at {id}:/", { id: "id" })) +
            '<div class="wide">' + W.layoutField("public") + "</div>" +
            '<div class="wz-form-actions">' +
            '<button type="button" class="wz-btn" data-action="test">' + esc(T("net/test", "Test connection")) + "</button>" +
            '<button type="button" class="wz-btn primary" data-action="add">' + W.icon("plus") + "<span>" + esc(T("drive/add", "Add drive")) + "</span></button>" +
            '<span class="wz-result" data-result></span></div></div>');
        W.bindIdField($form);
        updateProtocol($form);
        $form.find("[data-field=filesystem]").on("change", function () {
            updateProtocol($form);
        });

        $form.find("[data-action=test]").on("click", function () {
            var button = this;
            var $result = $form.find("[data-result]").attr("class", "wz-result").text(T("net/testing", "Connecting..."));
            W.working(button, true);
            W.api("POST", "system/storage/pool/test", { config: JSON.stringify(config($form)), group: "system" }).then(function () {
                W.working(button, false);
                $result.attr("class", "wz-result ok").text(T("net/testOk", "Connected"));
            }, function (err) {
                W.working(button, false);
                $result.attr("class", "wz-result bad").text(err.message);
            });
        });

        $form.find("[data-action=add]").on("click", function () {
            var button = this;
            var c = config($form);
            if (!c.path || !c.name) {
                W.toast(T("net/missing", "Enter the server address and a name"), true);
                return;
            }
            if (!W.validId(c.uuid)) {
                $form.find("[data-field=id]").addClass("invalid").trigger("focus");
                W.toast(T("drive/field/id/invalid", "A drive ID can only use letters, numbers, - and _"), true);
                return;
            }
            W.working(button, true);
            W.api("POST", "system/storage/pool/edit", { opr: "new", group: "system", config: JSON.stringify(c) }).then(function (reply) {
                W.addWizardDrive({ uuid: c.uuid, name: c.name, kind: "network", path: c.filesystem + "://" + c.path });
                if (reply && reply.mounted === false) {
                    W.toast(T("drive/offline", "Saved, but the drive could not be opened: {reason}", { reason: reply.reason || "" }), true);
                } else {
                    W.toast(T("drive/addedToast", "{name} is ready as {id}:/", { name: c.name, id: c.uuid }));
                }
                renderForm(el);
                refreshAdded(el);
            }, function (err) {
                W.working(button, false);
                W.toast(err.message, true);
            });
        });
    }

    function refreshAdded(el) {
        W.renderAddedDrives($(el).find("#wzNetAdded"), "network", function () {
            refreshAdded(el);
        });
    }

    W.register({
        id: "network",
        title: function () {
            return T("step/network", "Network drives");
        },
        render: function (el) {
            var choice = W.progress.network || (W.wizardDrives("network").length ? "yes" : "no");
            var html = '<div class="wz-eyebrow">' + esc(T("net/eyebrow", "Network drives")) + "</div>" +
                '<h1 class="wz-title">' + esc(T("net/title", "Do you keep files on another device?")) + "</h1>" +
                '<p class="wz-lead">' + esc(T("net/lead", "ArozOS can connect to another NAS, a shared folder on a Windows PC or cloud storage, and show it next to your own files.")) + "</p>" +
                '<div class="wz-choices stack" role="radiogroup">' +
                choiceHTML("no", "check", T("net/no", "No, not now"), T("net/no/desc", "You can connect network drives later in System Settings > Storage Pools."), choice) +
                choiceHTML("yes", "cloud", T("net/yes", "Yes, connect one"), T("net/yes/desc", "Enter the address and login of the other device."), choice) +
                "</div>" +
                '<div id="wzNetBody" class="' + (choice === "yes" ? "" : "wz-hidden") + '">' +
                '<div class="wz-section-title">' + esc(T("net/formTitle", "Connect a network drive")) + "</div>" +
                '<div class="wz-card" id="wzNetForm"></div><div id="wzNetAdded"></div></div>';
            el.innerHTML = html;
            renderForm(el);
            refreshAdded(el);

            $(el).find(".wz-choice").on("click", function () {
                W.progress.network = $(this).attr("data-value");
                $(el).find(".wz-choice").removeClass("selected").attr("aria-checked", "false");
                $(this).addClass("selected").attr("aria-checked", "true");
                $(el).find("#wzNetBody").toggleClass("wz-hidden", W.progress.network !== "yes");
            });
        },
        leave: function () {
            if (!W.progress.network) {
                W.progress.network = "no";
            }
            var typed = $("#wzNetForm [data-field=path]").val();
            if (W.progress.network === "yes" && typed && typed.trim() !== "") {
                return Promise.reject(new Error(T("net/unsaved", "Press Add drive to connect {address}, or clear the server address", { address: typed.trim() })));
            }
        }
    });

    function choiceHTML(value, icon, title, desc, current) {
        var selected = value === current;
        return '<button type="button" class="wz-choice' + (selected ? " selected" : "") + '" role="radio" aria-checked="' + selected + '" data-value="' + value + '">' +
            '<span class="wz-choice-check">' + W.icon("check") + "</span>" +
            '<div class="wz-choice-icon">' + W.icon(icon) + "</div>" +
            '<div class="wz-choice-body"><div class="wz-choice-title">' + esc(title) + "</div>" +
            '<div class="wz-choice-desc">' + esc(desc) + "</div></div></button>";
    }
    W.choiceHTML = choiceHTML;
})();
