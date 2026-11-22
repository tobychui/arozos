/*
    Step: Storage

    Lists the disks of the server (Linux) and turns one into a drive:
    a partition nobody mounts is mounted under /media by ArozOS at every
    start, one the host already mounts is used as a folder. A disk nothing
    uses can be formatted first, after the admin types their password.
    Any platform can also add a folder of the server as a drive, through
    the Storage Pools endpoints.

    The drives the guide adds are kept in Wizard.progress.drives, so the
    accounts step can set who may use them.
*/

(function () {
    "use strict";
    var W = window.Wizard, T = W.T, esc = W.esc;

    var USE_TEXT = {
        system: ["Holds the operating system", "danger"],
        mounted: ["Mounted by the server", "warn"],
        drive: ["Already a drive", "ok"],
        swap: ["Swap space", "warn"],
        raid: ["Part of a RAID array", "warn"],
        lvm: ["Part of an LVM volume", "warn"],
        encrypted: ["Encrypted volume", "warn"],
        holder: ["In use by another device", "warn"]
    };

    function useChip(reason, driveId) {
        if (reason === "drive" && driveId) {
            return '<span class="wz-chip ok">' + esc(T("storage/use/driveId", "Drive {id}:/", { id: driveId })) + "</span>";
        }
        var info = USE_TEXT[reason];
        if (!info) {
            return "";
        }
        return '<span class="wz-chip ' + info[1] + '">' + esc(T("storage/use/" + reason, info[0])) + "</span>";
    }

    function diskNoteText(note) {
        if (note === "sudo") {
            return T("storage/note/sudo", "ArozOS is not running as root, so it can only use disks the server has already mounted. Start it with sudo to mount and format disks here.");
        }
        if (note === "hardware") {
            return T("storage/note/hardware", "Hardware management is turned off (-enable_hwman=false), so disks cannot be mounted or formatted here.");
        }
        return T("storage/note/platform", "Disks can be listed and mounted here on Linux. On this server, add a folder as a drive instead.");
    }

    W.wizardDrives = function (kind) {
        return W.progress.drives.filter(function (d) {
            return kind === "network" ? d.kind === "network" : d.kind !== "network";
        });
    };

    W.addWizardDrive = function (drive) {
        W.progress.drives = W.progress.drives.filter(function (d) { return d.uuid !== drive.uuid; });
        W.progress.drives.push(drive);
        W.save();
    };

    //Removes a drive the guide added, keeping the files on it
    W.removeWizardDrive = function (drive, done) {
        ssConfirm({
            title: T("drive/remove/title", "Remove {name}?", { name: drive.name }),
            text: T("drive/remove/text", "ArozOS stops using this drive. The files on it are not deleted."),
            confirmLabel: T("drive/remove/confirm", "Remove"),
            cancelLabel: T("common/cancel", "Cancel"),
            danger: true
        }, function () {
            W.api("POST", "system/storage/pool/removeHandler", { group: "system", uuid: drive.uuid }).then(function () {
                W.progress.drives = W.progress.drives.filter(function (d) { return d.uuid !== drive.uuid; });
                delete W.progress.access[drive.uuid];
                W.save();
                W.toast(T("drive/removed", "{name} was removed", { name: drive.name }));
                done();
            }, function (err) {
                W.toast(err.message, true);
            });
        });
    };

    W.renderAddedDrives = function ($target, kind, onChange) {
        var drives = W.wizardDrives(kind);
        $target.empty();
        if (drives.length === 0) {
            return;
        }
        $target.append('<div class="wz-section-title">' + esc(T("drive/added", "Added in this guide")) + "</div>");
        drives.forEach(function (drive) {
            var icon = drive.kind === "network" ? "cloud" : (drive.kind === "folder" ? "folder" : "disk");
            var $row = $('<div class="wz-added"></div>').html(
                '<div class="wz-card-icon">' + W.icon(icon) + "</div>" +
                '<div class="wz-grow"><div class="wz-row-title">' + esc(drive.name) + ' <span class="wz-chip">' + esc(drive.uuid) + ":/</span></div>" +
                '<div class="wz-row-sub wz-mono">' + esc(drive.path || "") + "</div></div>" +
                '<button type="button" class="wz-btn small ghost">' + W.icon("trash") + "<span>" + esc(T("drive/remove/confirm", "Remove")) + "</span></button>");
            $row.find("button").on("click", function () {
                W.removeWizardDrive(drive, onChange);
            });
            $target.append($row);
        });
    };

    /* Disks */

    var disksCache = null;

    function loadDisks(el, openDevice) {
        var $box = $(el).find("#wzDisks").html('<div class="wz-loading" style="padding:30px 0"><span class="wz-spinner"></span></div>');
        W.api("GET", "system/setup/disks").then(function (disks) {
            disksCache = Array.isArray(disks) ? disks : [];
            renderDisks(el);
            if (openDevice) {
                var $row = $(el).find('.wz-row[data-device="' + openDevice + '"]');
                $row.find("[data-action=add]").trigger("click");
            }
        }, function (err) {
            $box.html('<div class="wz-note warn">' + W.icon("warning") + "<div>" + esc(err.message) + "</div></div>");
        });
    }

    function renderDisks(el) {
        var $box = $(el).find("#wzDisks").empty();
        var canMount = W.state.canMountDisks;
        if (disksCache.length === 0) {
            $box.html('<div class="wz-empty">' + esc(T("storage/disks/none", "No extra disks were found. Plug one in and press Refresh.")) + "</div>");
            return;
        }
        disksCache.forEach(function (disk) {
            var $card = $('<div class="wz-card"></div>');
            var sub = [disk.path, W.sizeText(disk.size)];
            if (disk.removable) {
                sub.push(T("storage/removable", "Removable"));
            }
            $card.append('<div class="wz-card-head"><div class="wz-card-icon">' + W.icon(disk.removable ? "usb" : "disk") + "</div>" +
                '<div class="wz-grow"><div class="wz-card-title">' + esc(disk.model || disk.name) + "</div>" +
                '<div class="wz-card-sub">' + esc(sub.join("  ·  ")) + "</div></div>" +
                (disk.inUse === "system" ? useChip("system") : "") + "</div>");

            var $rows = $('<div class="wz-rows"></div>');
            disk.partitions.forEach(function (part) {
                var title = part.label || (disk.whole ? T("storage/wholeDisk", "Whole disk") : part.name);
                var facts = [part.fstype ? part.fstype.toUpperCase() : T("storage/blank", "Not formatted"), W.sizeText(part.size)];
                if (part.mountpoint) {
                    facts.push(part.mountpoint);
                }
                var actions = "";
                if (part.canAdd && (part.addMode === "folder" || canMount)) {
                    actions += '<button type="button" class="wz-btn small primary" data-action="add">' + W.icon("plus") + "<span>" + esc(T("storage/use", "Use for storage")) + "</span></button>";
                }
                if (part.canFormat && canMount) {
                    actions += '<button type="button" class="wz-btn small" data-action="format">' + W.icon("eraser") + "<span>" + esc(T("storage/format", "Format")) + "</span></button>";
                }
                var hint = "";
                if (!part.canAdd && part.canFormat && !part.inUse && !part.driveId) {
                    hint = part.fstype ? T("storage/hint/unsupported", "ArozOS cannot use this file system. Format the disk to use it.")
                        : T("storage/hint/blank", "Format this disk to use it.");
                }
                var $row = $('<div class="wz-row"></div>').attr("data-device", part.path).html(
                    '<div class="wz-row-main"><div class="wz-row-title"><span>' + esc(title) + '</span><span class="wz-chip wz-mono">' + esc(part.name) + "</span>" +
                    (part.inUse ? useChip(part.inUse, part.driveId) : "") + "</div>" +
                    '<div class="wz-row-sub">' + esc(facts.join("  ·  ")) + "</div>" +
                    (hint ? '<div class="wz-hint">' + esc(hint) + "</div>" : "") + "</div>" +
                    '<div class="wz-row-actions">' + actions + "</div>");
                $row.find("[data-action=add]").on("click", function () {
                    openAddPanel(el, $row, disk, part);
                });
                $row.find("[data-action=format]").on("click", function () {
                    openFormat(el, disk, part);
                });
                $rows.append($row);
            });
            $card.append($rows);
            if (disk.inUse && disk.inUse !== "system" && disk.partitions.some(function (p) { return !p.inUse && !p.canFormat; })) {
                $card.append('<div class="wz-hint">' + esc(T("storage/hint/diskInUse", "Part of this disk is in use, so it cannot be formatted here.")) + "</div>");
            }
            $box.append($card);
        });
    }

    function openAddPanel(el, $row, disk, part) {
        $(el).find(".wz-inline-panel").remove();
        var name = part.label || disk.model || part.name;
        var id = W.suggestId(name) || part.name;
        var $panel = $('<div class="wz-inline-panel wide" style="flex-basis:100%"></div>').html(
            '<div class="wz-form">' +
            field("name", T("drive/field/name", "Name"), name) +
            field("id", T("drive/field/id", "Drive ID"), id, T("drive/field/id/hint", "Files on it will be at {id}:/", { id: id })) +
            layoutField("public") +
            '<div class="wz-form-actions"><button type="button" class="wz-btn primary" data-action="save">' + W.icon("check") + "<span>" + esc(T("drive/add", "Add drive")) + "</span></button>" +
            '<button type="button" class="wz-btn ghost" data-action="cancel">' + esc(T("common/cancel", "Cancel")) + "</button>" +
            (part.addMode === "folder" ? '<span class="wz-hint">' + esc(T("storage/folderMode", "Already mounted at {path}, so it is used as it is.", { path: part.mountpoint })) + "</span>"
                : '<span class="wz-hint">' + esc(T("storage/mountMode", "ArozOS mounts it at /media/{id} every time it starts.", { id: id })) + "</span>") +
            "</div></div>");
        bindIdField($panel);
        $panel.find("[data-action=cancel]").on("click", function () {
            $panel.remove();
        });
        $panel.find("[data-action=save]").on("click", function () {
            var button = this;
            var data = {
                device: part.path,
                name: $panel.find("[data-field=name]").val().trim(),
                id: $panel.find("[data-field=id]").val().trim(),
                hierarchy: $panel.find("[data-field=hierarchy]").val()
            };
            if (!W.validId(data.id)) {
                $panel.find("[data-field=id]").addClass("invalid").trigger("focus");
                W.toast(T("drive/field/id/invalid", "A drive ID can only use letters, numbers, - and _"), true);
                return;
            }
            W.working(button, true);
            W.api("POST", "system/setup/disk/add", data).then(function (reply) {
                W.addWizardDrive({ uuid: data.id, name: data.name || data.id, kind: "disk", path: reply.path || "" });
                W.toast(T("drive/addedToast", "{name} is ready as {id}:/", { name: data.name || data.id, id: data.id }));
                refreshAdded(el);
                loadDisks(el);
            }, function (err) {
                W.working(button, false);
                W.toast(err.message, true);
            });
        });
        $row.append($panel);
        $panel.find("input").first().trigger("focus");
    }

    function openFormat(el, disk, part) {
        var defaultLabel = (part.label || disk.model || "Storage").replace(/[^A-Za-z0-9 _-]/g, "").trim().substring(0, 16);
        var body =
            '<div class="wz-note danger">' + W.icon("warning") + "<div>" +
            esc(T("format/warning", "Everything on {device} ({size}) will be erased. This cannot be undone.", { device: part.path, size: W.sizeText(part.size) })) +
            "</div></div>" +
            '<div class="wz-field"><label>' + esc(T("format/fs", "File system")) + "</label>" +
            '<select class="wz-select" data-field="fstype">' +
            '<option value="ext4">' + esc(T("format/fs/ext4", "ext4 (recommended for a NAS)")) + "</option>" +
            '<option value="ntfs">' + esc(T("format/fs/ntfs", "NTFS (can also be read by Windows)")) + "</option>" +
            '<option value="vfat">' + esc(T("format/fs/vfat", "FAT32 (USB sticks, files up to 4 GB)")) + "</option>" +
            "</select></div>" +
            '<div class="wz-field"><label>' + esc(T("format/label", "Disk name")) + "</label>" +
            '<input class="wz-input" data-field="label" maxlength="32" value="' + esc(defaultLabel) + '"></div>' +
            '<div class="wz-field"><label>' + esc(T("format/password", "Your password")) + "</label>" +
            '<input class="wz-input" type="password" data-field="password" autocomplete="current-password"></div>' +
            '<label class="wz-check"><input type="checkbox" data-field="agree"><span>' +
            esc(T("format/agree", "I understand that all data on this disk will be erased")) + "</span></label>";
        W.modal({
            title: T("format/title", "Format {name}?", { name: part.label || disk.model || part.name }),
            icon: "warning",
            body: body,
            actions: [
                { label: T("common/cancel", "Cancel") },
                {
                    label: T("format/confirm", "Erase and format"),
                    kind: "danger",
                    onClick: function (dialog, button) {
                        var $m = $(dialog.el);
                        if (!$m.find("[data-field=agree]").prop("checked")) {
                            W.toast(T("format/needAgree", "Tick the box to confirm that the data may be erased"), true);
                            return;
                        }
                        var password = $m.find("[data-field=password]").val();
                        if (!password) {
                            $m.find("[data-field=password]").addClass("invalid").trigger("focus");
                            return;
                        }
                        W.working(button, true);
                        $m.find("input, select").prop("disabled", true);
                        W.api("POST", "system/setup/disk/format", {
                            device: part.path,
                            fstype: $m.find("[data-field=fstype]").val(),
                            label: $m.find("[data-field=label]").val(),
                            password: password
                        }).then(function () {
                            dialog.close();
                            W.toast(T("format/done", "{device} was formatted", { device: part.path }));
                            loadDisks(el, part.path);
                        }, function (err) {
                            W.working(button, false);
                            $m.find("input, select").prop("disabled", false);
                            W.toast(err.message, true);
                        });
                    }
                }
            ]
        });
    }

    /* Folder drive */

    function field(name, label, value, hint, type) {
        return '<div class="wz-field"><label>' + esc(label) + "</label>" +
            '<input class="wz-input" data-field="' + name + '" type="' + (type || "text") + '" value="' + esc(value || "") + '" autocomplete="off" spellcheck="false">' +
            (hint !== undefined ? '<div class="wz-hint" data-hint="' + name + '">' + esc(hint) + "</div>" : "") + "</div>";
    }

    function layoutField(value) {
        return '<div class="wz-field"><label>' + esc(T("drive/field/layout", "Folder layout")) + "</label>" +
            '<select class="wz-select" data-field="hierarchy">' +
            '<option value="public"' + (value === "public" ? " selected" : "") + ">" + esc(T("drive/layout/public", "One shared folder for everyone")) + "</option>" +
            '<option value="user"' + (value === "user" ? " selected" : "") + ">" + esc(T("drive/layout/user", "A private folder for each person")) + "</option>" +
            "</select></div>";
    }

    //Keeps the drive id following the name until the user edits it
    function bindIdField($scope) {
        var touched = false;
        $scope.find("[data-field=id]").on("input", function () {
            touched = true;
            $(this).removeClass("invalid");
            $scope.find("[data-hint=id]").text(T("drive/field/id/hint", "Files on it will be at {id}:/", { id: $(this).val() || "id" }));
        });
        $scope.find("[data-field=name]").on("input", function () {
            if (!touched) {
                var id = W.suggestId($(this).val());
                $scope.find("[data-field=id]").val(id);
                $scope.find("[data-hint=id]").text(T("drive/field/id/hint", "Files on it will be at {id}:/", { id: id || "id" }));
            }
        });
    }
    W.bindIdField = bindIdField;
    W.driveField = field;
    W.layoutField = layoutField;

    function folderConfig($form) {
        return {
            name: $form.find("[data-field=name]").val().trim(),
            uuid: $form.find("[data-field=id]").val().trim(),
            path: $form.find("[data-field=path]").val().trim(),
            access: "readwrite",
            hierarchy: $form.find("[data-field=hierarchy]").val(),
            automount: false
        };
    }

    function renderFolderForm(el) {
        var $form = $(el).find("#wzFolderForm");
        var placeholder = W.state.platform === "windows" ? "D:\\Media" : "/mnt/storage";
        $form.html('<div class="wz-form">' +
            field("name", T("drive/field/name", "Name"), "") +
            field("id", T("drive/field/id", "Drive ID"), "", T("drive/field/id/hint", "Files on it will be at {id}:/", { id: "id" })) +
            '<div class="wz-field wide"><label>' + esc(T("folder/path", "Folder on this server")) + "</label>" +
            '<input class="wz-input wz-mono" data-field="path" placeholder="' + esc(placeholder) + '" autocomplete="off" spellcheck="false"></div>' +
            layoutField("public") +
            '<div class="wz-form-actions">' +
            '<button type="button" class="wz-btn" data-action="test">' + esc(T("folder/test", "Check folder")) + "</button>" +
            '<button type="button" class="wz-btn primary" data-action="add">' + W.icon("plus") + "<span>" + esc(T("drive/add", "Add drive")) + "</span></button>" +
            '<span class="wz-result" data-result></span></div></div>');
        bindIdField($form);

        $form.find("[data-action=test]").on("click", function () {
            var $result = $form.find("[data-result]").attr("class", "wz-result").text(T("common/checking", "Checking..."));
            W.api("POST", "system/storage/pool/test", { config: JSON.stringify(folderConfig($form)), group: "system" }).then(function () {
                $result.attr("class", "wz-result ok").text(T("folder/ok", "The folder exists"));
            }, function (err) {
                $result.attr("class", "wz-result bad").text(err.message);
            });
        });

        $form.find("[data-action=add]").on("click", function () {
            var button = this;
            var config = folderConfig($form);
            if (!config.name || !config.path) {
                W.toast(T("folder/missing", "Enter a name and a folder"), true);
                return;
            }
            if (!W.validId(config.uuid)) {
                $form.find("[data-field=id]").addClass("invalid").trigger("focus");
                W.toast(T("drive/field/id/invalid", "A drive ID can only use letters, numbers, - and _"), true);
                return;
            }
            W.working(button, true);
            W.api("POST", "system/storage/pool/edit", { opr: "new", group: "system", config: JSON.stringify(config) }).then(function (reply) {
                W.working(button, false);
                W.addWizardDrive({ uuid: config.uuid, name: config.name, kind: "folder", path: config.path });
                if (reply && reply.mounted === false) {
                    W.toast(T("drive/offline", "Saved, but the drive could not be opened: {reason}", { reason: reply.reason || "" }), true);
                } else {
                    W.toast(T("drive/addedToast", "{name} is ready as {id}:/", { name: config.name, id: config.uuid }));
                }
                renderFolderForm(el);
                refreshAdded(el);
            }, function (err) {
                W.working(button, false);
                W.toast(err.message, true);
            });
        });
    }

    function refreshAdded(el) {
        W.renderAddedDrives($(el).find("#wzAddedDrives"), "local", function () {
            refreshAdded(el);
            if (W.state.canListDisks) {
                loadDisks(el);
            }
        });
        W.setNextLabel(W.wizardDrives("local").length ? T("nav/continue", "Continue") : T("storage/next/builtin", "Continue with built-in storage"));
    }

    W.register({
        id: "storage",
        title: function () {
            return T("step/storage", "Storage");
        },
        nextLabel: function () {
            return W.wizardDrives("local").length ? T("nav/continue", "Continue") : T("storage/next/builtin", "Continue with built-in storage");
        },
        render: function (el) {
            var st = W.state;
            var html = '<div class="wz-eyebrow">' + esc(T("storage/eyebrow", "Storage")) + "</div>" +
                '<h1 class="wz-title">' + esc(T("storage/title", "Where should your files live?")) + "</h1>" +
                '<p class="wz-lead">' + esc(T("storage/lead", "Your server can already store files: each person has a home folder (user:/) on its system disk. Add a disk to get more room, or keep it simple and continue.")) + "</p>";

            if (st.canListDisks) {
                if (!st.canMountDisks) {
                    html += '<div class="wz-note warn">' + W.icon("info") + "<div>" + esc(diskNoteText(st.diskNote)) + "</div></div>";
                }
                html += '<div class="wz-section-title"><span class="wz-grow">' + esc(T("storage/disks", "Disks in this server")) + "</span>" +
                    '<button type="button" class="wz-btn small ghost" id="wzDiskRefresh">' + W.icon("refresh") + "<span>" + esc(T("common/refresh", "Refresh")) + "</span></button></div>" +
                    '<div id="wzDisks"></div>';
            } else {
                html += '<div class="wz-note">' + W.icon("info") + "<div>" + esc(diskNoteText(st.diskNote)) + "</div></div>";
            }

            html += '<div id="wzAddedDrives"></div>';
            html += '<div class="wz-section-title">' + esc(st.canListDisks ? T("folder/titleAlt", "Or use a folder on this server") : T("folder/title", "Use a folder on this server")) + "</div>" +
                '<div class="wz-card"><p class="wz-card-sub" style="margin:0 0 14px">' +
                esc(T("folder/lead", "Any folder the server can reach, such as a disk your system already mounts, can become a drive.")) +
                '</p><div id="wzFolderForm"></div></div>';
            el.innerHTML = html;

            renderFolderForm(el);
            refreshAdded(el);
            if (st.canListDisks) {
                $(el).find("#wzDiskRefresh").on("click", function () {
                    loadDisks(el);
                });
                loadDisks(el);
            }
        }
    });
})();
