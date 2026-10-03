/*
    Mail — actions shared by every Mail window

    The main window, the message window (message.html), the composer window
    (compose.html) and the .eml viewer all save attachments, print, show
    sources and talk to each other. That code lives here.

    Windows coordinate through a BroadcastChannel: a composer window announces
    saved drafts and sent mail, a message window announces moved or flagged
    mail, and the main window refreshes its lists and counters.
*/

var Mail = window.Mail || {};
window.Mail = Mail;

Mail.shared = (function () {
    "use strict";
    var util = Mail.util;
    var ui = Mail.ui;
    var api = Mail.api;
    var el = util.el;

    /* ---------- Windows ---------- */

    //isDesktop reports whether Mail runs inside the ArozOS virtual desktop,
    //where new windows are float windows rather than browser tabs
    function isDesktop() {
        return typeof ao_module_virtualDesktop !== "undefined" && ao_module_virtualDesktop === true;
    }

    function rootPath() {
        return (typeof ao_root === "string" && ao_root) ? ao_root : "../";
    }

    //handOff stores a payload too large for a URL and returns its key
    function handOff(payload) {
        var key = "handoff-" + util.randomId();
        localStorage.setItem("aroz-mail:" + key, JSON.stringify(payload));
        return key;
    }

    //takeHandOff reads (and removes) a payload stored by handOff
    function takeHandOff(key) {
        try {
            var storageKey = "aroz-mail:" + key;
            var raw = localStorage.getItem(storageKey);
            localStorage.removeItem(storageKey);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    }

    function newWindow(page, hash, title, width, height) {
        //The desktop opens windows 100px from the top and only keeps them
        //inside the screen, so on a small screen the bottom (and the Send
        //button) would end up under the taskbar
        try {
            if (isDesktop() && parent.innerHeight) {
                width = Math.max(380, Math.min(width, parent.innerWidth - 40));
                height = Math.max(360, Math.min(height, parent.innerHeight - 150));
            }
        } catch (e) { /* no access to the desktop */ }
        ao_module_newfw({
            url: "Mail/" + page + "#" + hash,
            width: width,
            height: height,
            appicon: "Mail/img/icon.svg",
            title: title
        });
    }

    //openMessageWindow shows one message in its own window
    function openMessageWindow(summary) {
        var target = {
            accountId: summary.accountId, folder: summary.folder, uid: summary.uid,
            messageId: summary.messageId || "", subject: summary.subject || ""
        };
        newWindow("message.html", encodeURIComponent(JSON.stringify(target)), summary.subject || "Message", 900, 720);
    }

    //openComposeWindow opens the composer in its own window
    function openComposeWindow(options) {
        var key;
        try {
            key = handOff(options || {});
        } catch (e) {
            ui.toast("The message is too large to open in a new window", { error: true });
            return false;
        }
        newWindow("compose.html", "handoff=" + key, (options && options.subject) || "New message", 820, 700);
        return true;
    }

    /* ---------- Event bus ---------- */

    var channel = null;
    var listeners = [];

    function ensureChannel() {
        if (channel || typeof BroadcastChannel === "undefined") {
            return;
        }
        channel = new BroadcastChannel("arozos-mail-events");
        channel.onmessage = function (event) {
            listeners.forEach(function (listener) {
                try {
                    listener(event.data || {});
                } catch (e) { /* a broken listener must not stop the others */ }
            });
        };
    }

    //emit tells the other Mail windows that something changed
    function emit(type, data) {
        ensureChannel();
        if (!channel) {
            return;
        }
        var message = { type: type };
        Object.keys(data || {}).forEach(function (key) { message[key] = data[key]; });
        channel.postMessage(message);
    }

    function on(listener) {
        ensureChannel();
        listeners.push(listener);
    }

    /* ---------- Files ---------- */

    function tempDownloads() {
        return api.files("tempFolder", { purpose: "downloads" });
    }

    function attachmentRequest(message, attachment, dest) {
        return api.files("saveAttachment", { accountId: message.accountId, folder: message.folder, uid: message.uid, partId: attachment.id, dest: dest });
    }

    function pickFolder(callback) {
        if (typeof ao_module_openFileSelector !== "function") {
            ui.toast("The ArozOS folder picker is not available", { error: true });
            return;
        }
        ao_module_openFileSelector(function (files) {
            if (files && files.length > 0) {
                callback(files[0].filepath);
            }
        }, "user:/Desktop", "folder", false, { path_memory_key: "mail-save" });
    }

    function savedToast(path) {
        var dir = path.substring(0, path.lastIndexOf("/"));
        var name = path.substring(path.lastIndexOf("/") + 1);
        ui.toast("Saved to " + path, {
            action: typeof ao_module_openPath === "function" ? { label: "Show", fn: function () { ao_module_openPath(dir, name); } } : null
        });
    }

    function downloadPath(path) {
        var link = el("a", { href: rootPath() + "media/?file=" + encodeURIComponent(path) + "&download=true", download: path.split("/").pop() });
        document.body.appendChild(link);
        link.click();
        setTimeout(function () { link.remove(); }, 1000);
    }

    //openWithDefaultApp opens a file with the WebApp registered for its type
    function openWithDefaultApp(path) {
        var filename = path.split("/").pop();
        var ext = "." + filename.split(".").pop().toLowerCase();
        $.ajax({
            url: rootPath() + "system/modules/getDefault",
            method: "GET",
            data: { opr: "launch", ext: ext, mode: "launch" },
            success: function (data) {
                if (!data || data.error !== undefined) {
                    ao_module_newfw({
                        url: "SystemAO/file_system/defaultOpener.html#" + encodeURIComponent(JSON.stringify({ filepath: path, filename: filename })),
                        width: 380, height: 560, appicon: "SystemAO/file_system/img/opener.png", title: "Open with"
                    });
                    return;
                }
                var url = data.StartDir;
                var size = [undefined, undefined];
                if (data.SupportFW && data.LaunchFWDir) {
                    url = data.LaunchFWDir;
                    size = data.InitFWSize || size;
                }
                if (data.SupportEmb && data.LaunchEmb) {
                    url = data.LaunchEmb;
                    size = data.InitEmbSize || size;
                }
                ao_module_newfw({
                    url: url + "#" + encodeURIComponent(JSON.stringify([{ filepath: path, filename: filename }])),
                    width: size[0], height: size[1], appicon: data.IconPath || "Mail/img/icon.svg", title: data.Name
                });
            },
            error: function () {
                downloadPath(path);
            }
        });
    }

    function openAttachment(message, attachment) {
        var progress = ui.toast("Opening " + attachment.filename + "…", { duration: 0 });
        tempDownloads().then(function (folder) {
            return attachmentRequest(message, attachment, folder);
        }).then(function (saved) {
            progress.close();
            openWithDefaultApp(saved.path);
        }).catch(function (error) {
            progress.close();
            ui.errorToast(error, "Could not open the attachment");
        });
    }

    function saveAttachment(message, attachment) {
        pickFolder(function (dir) {
            attachmentRequest(message, attachment, dir).then(function (saved) {
                savedToast(saved.path);
            }).catch(function (error) { ui.errorToast(error, "Could not save"); });
        });
    }

    function saveAllAttachments(message, list) {
        pickFolder(function (dir) {
            var progress = ui.toast("Saving " + util.plural(list.length, "attachment") + "…", { duration: 0 });
            api.files("saveAll", {
                accountId: message.accountId, folder: message.folder, uid: message.uid,
                partIds: list.map(function (item) { return item.id; }), dest: dir
            }).then(function (result) {
                progress.close();
                ui.toast(util.plural(result.paths.length, "file") + " saved to " + dir, {
                    action: typeof ao_module_openPath === "function" ? { label: "Show", fn: function () { ao_module_openPath(dir); } } : null
                });
            }).catch(function (error) {
                progress.close();
                ui.errorToast(error, "Could not save");
            });
        });
    }

    function downloadAttachment(message, attachment) {
        tempDownloads().then(function (folder) {
            return attachmentRequest(message, attachment, folder);
        }).then(function (saved) {
            downloadPath(saved.path);
        }).catch(function (error) { ui.errorToast(error, "Download failed"); });
    }

    //attachmentHandlers wires the attachment cards of a mailbox message
    function attachmentHandlers(message) {
        return {
            open: function (attachment) { openAttachment(message, attachment); },
            save: function (attachment) { saveAttachment(message, attachment); },
            download: function (attachment) { downloadAttachment(message, attachment); },
            saveAll: function (list) { saveAllAttachments(message, list); }
        };
    }

    function saveAsEML(message) {
        pickFolder(function (dir) {
            api.files("saveMessage", { accountId: message.accountId, folder: message.folder, uid: message.uid, dest: dir }).then(function (saved) {
                savedToast(saved.path);
            }).catch(function (error) { ui.errorToast(error, "Could not save"); });
        });
    }

    function downloadEML(message) {
        tempDownloads().then(function (folder) {
            return api.files("saveMessage", { accountId: message.accountId, folder: message.folder, uid: message.uid, dest: folder });
        }).then(function (saved) {
            downloadPath(saved.path);
        }).catch(function (error) { ui.errorToast(error, "Download failed"); });
    }

    function viewSource(message) {
        var pre = el("pre", { style: { whiteSpace: "pre-wrap", wordBreak: "break-all", fontFamily: "var(--mono)", fontSize: "12px", margin: "0", maxHeight: "65vh", overflow: "auto" }, text: "Loading…" });
        ui.modal({ title: "Message source", subtitle: message.subject || "", xwide: true, body: pre, buttons: [{ label: "Close", primary: true }] });
        api.message("raw", { accountId: message.accountId, folder: message.folder, uid: message.uid }).then(function (result) {
            pre.textContent = result.source + (result.truncated ? "\n\n[… source truncated, " + util.formatSize(result.size) + " in total]" : "");
        }).catch(function (error) {
            pre.textContent = error.message;
        });
    }

    function printMessage(message) {
        var popup = window.open("", "_blank", "width=860,height=900");
        if (!popup) {
            ui.toast("Allow pop-ups to print", { error: true });
            return;
        }
        var from = (message.from && message.from[0]) || {};
        var header = '<div style="font-family:sans-serif;border-bottom:1px solid #ccc;padding-bottom:10px;margin-bottom:14px">' +
            "<h2 style=\"margin:0 0 8px\">" + util.escapeHTML(message.subject || "(no subject)") + "</h2>" +
            "<div><b>From:</b> " + util.escapeHTML(util.addressFull(from)) + "</div>" +
            "<div><b>To:</b> " + util.escapeHTML((message.to || []).map(util.addressFull).join(", ")) + "</div>" +
            (message.cc && message.cc.length ? "<div><b>Cc:</b> " + util.escapeHTML(message.cc.map(util.addressFull).join(", ")) + "</div>" : "") +
            "<div><b>Date:</b> " + util.escapeHTML(util.formatFullDate(message.date)) + "</div></div>";
        var content = message.html ? new DOMParser().parseFromString(message.html, "text/html").body.innerHTML :
            '<pre style="white-space:pre-wrap;font-family:sans-serif">' + util.escapeHTML(message.text || "") + "</pre>";
        var csp = "default-src 'none'; img-src data:" + (message.remoteAllowed ? " https: http:" : "") + "; style-src 'unsafe-inline'";
        popup.document.open();
        popup.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' + csp + '"><title>' +
            util.escapeHTML(message.subject || "Message") + "</title></head><body>" + header + content + "</body></html>");
        popup.document.close();
        popup.focus();
        setTimeout(function () { popup.print(); }, 400);
    }

    function unsubscribe(message, onMailto) {
        var target = message.listUnsubscribe;
        if (/^mailto:/i.test(target)) {
            onMailto(target);
            return;
        }
        ui.confirm("Unsubscribe?", "This opens the sender's unsubscribe page: " + target, { okLabel: "Open page" }).then(function (ok) {
            if (ok) {
                window.open(target, "_blank", "noopener,noreferrer");
            }
        });
    }

    //summaryOf strips the heavy fields of a full message so it can be stored
    //with a label or snooze
    function summaryOf(message) {
        var summary = JSON.parse(JSON.stringify(message));
        ["html", "text", "attachments", "auth", "references", "replyTo", "bcc"].forEach(function (key) { delete summary[key]; });
        return summary;
    }

    /* ---------- Theme ---------- */

    //followTheme applies the user's theme choice, following ArozOS when it is
    //"system". It calls back whenever the effective theme changes.
    function followTheme(getChoice) {
        var system = (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
        var apply = function () {
            var choice = getChoice ? getChoice() : "system";
            var theme = (!choice || choice === "system") ? system : choice;
            document.documentElement.setAttribute("data-theme", theme === "dark" ? "dark" : "light");
        };
        apply();
        if (typeof ao_module_getSystemThemeColor === "function") {
            try {
                ao_module_getSystemThemeColor(function (theme) {
                    if (theme === "darkTheme" || theme === "whiteTheme") {
                        system = theme === "darkTheme" ? "dark" : "light";
                        apply();
                    }
                });
            } catch (e) { /* standalone */ }
        }
        if (typeof ao_module_onThemeChanged === "function") {
            ao_module_onThemeChanged(function (theme) {
                system = theme === "dark" ? "dark" : "light";
                apply();
            });
        }
        return apply;
    }

    return {
        isDesktop: isDesktop,
        handOff: handOff,
        takeHandOff: takeHandOff,
        openMessageWindow: openMessageWindow,
        openComposeWindow: openComposeWindow,
        emit: emit,
        on: on,
        tempDownloads: tempDownloads,
        pickFolder: pickFolder,
        savedToast: savedToast,
        downloadPath: downloadPath,
        openWithDefaultApp: openWithDefaultApp,
        attachmentHandlers: attachmentHandlers,
        saveAsEML: saveAsEML,
        downloadEML: downloadEML,
        viewSource: viewSource,
        printMessage: printMessage,
        unsubscribe: unsubscribe,
        summaryOf: summaryOf,
        followTheme: followTheme
    };
})();
