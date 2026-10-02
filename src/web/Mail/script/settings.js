/*
    Mail — preferences, labels, address book and administration

    One tabbed dialog. Administrators get an extra tab that configures the
    OAuth applications (Google, Microsoft) and the network policy for every
    user of this ArozOS server.
*/

var Mail = window.Mail || {};
window.Mail = Mail;

Mail.settings = (function () {
    "use strict";
    var util = Mail.util;
    var ui = Mail.ui;
    var api = Mail.api;
    var el = util.el;
    var icon = util.icon;

    var LABEL_COLORS = ["#3b82f6", "#22c55e", "#ef4444", "#f59e0b", "#a855f7", "#06b6d4", "#ec4899", "#64748b", "#84cc16", "#f97316"];

    function selectField(label, value, options, help) {
        var select = el("select", { class: "select" });
        options.forEach(function (option) {
            select.appendChild(el("option", { value: String(option[0]), text: option[1] }));
        });
        select.value = String(value);
        return { el: el("div", { class: "field" }, [el("label", { text: label }), select, help ? el("div", { class: "help", text: help }) : null]), input: select };
    }

    function checkField(label, checked, description) {
        var input = el("input", { type: "checkbox" });
        input.checked = !!checked;
        return {
            el: el("label", { class: "checkline" }, [input, el("span", {}, [label, description ? el("span", { class: "desc", text: description }) : null])]),
            input: input
        };
    }

    /* ---------- Preferences ---------- */

    function preferencesPanel(settings) {
        var panel = el("div");
        var fields = {};

        panel.appendChild(el("h3", { text: "Appearance" }));
        fields.theme = selectField("Theme", settings.theme, [["system", "Follow ArozOS"], ["light", "Light"], ["dark", "Dark"]]);
        fields.density = selectField("Message list density", settings.density, [["comfortable", "Comfortable"], ["compact", "Compact"]]);
        panel.appendChild(el("div", { class: "row" }, [fields.theme.el, fields.density.el]));
        fields.showPreview = checkField("Show a preview line under each subject", settings.showPreview);
        panel.appendChild(fields.showPreview.el);

        panel.appendChild(el("h3", { text: "Reading" }));
        fields.markReadDelay = selectField("Mark messages as read", settings.markReadDelay, [
            [0, "Immediately"], [2, "After 2 seconds"], [5, "After 5 seconds"], [-1, "Never automatically"]
        ]);
        fields.pageSize = selectField("Messages per page", settings.pageSize, [[25, "25"], [50, "50"], [100, "100"], [200, "200"]]);
        panel.appendChild(el("div", { class: "row" }, [fields.markReadDelay.el, fields.pageSize.el]));
        fields.confirmDelete = checkField("Ask before deleting messages", settings.confirmDelete);
        panel.appendChild(fields.confirmDelete.el);

        panel.appendChild(el("h3", { text: "New mail" }));
        fields.pollMinutes = selectField("Check for new mail", settings.pollMinutes, [[1, "Every minute"], [2, "Every 2 minutes"], [5, "Every 5 minutes"], [15, "Every 15 minutes"], [30, "Every 30 minutes"]]);
        panel.appendChild(fields.pollMinutes.el);
        fields.notify = checkField("Show a notification when new mail arrives", settings.notify, "Notifications are shown while Mail is open, on the desktop too when the window is in the background.");
        panel.appendChild(fields.notify.el);

        return {
            el: panel,
            apply: function (target) {
                target.theme = fields.theme.input.value;
                target.density = fields.density.input.value;
                target.showPreview = fields.showPreview.input.checked;
                target.markReadDelay = parseInt(fields.markReadDelay.input.value, 10);
                target.pageSize = parseInt(fields.pageSize.input.value, 10);
                target.confirmDelete = fields.confirmDelete.input.checked;
                target.pollMinutes = parseInt(fields.pollMinutes.input.value, 10);
                target.notify = fields.notify.input.checked;
            }
        };
    }

    function privacyPanel(settings) {
        var panel = el("div");
        var trusted = (settings.trustedSenders || []).slice();
        panel.appendChild(el("h3", { text: "Remote content" }));
        var remote = selectField("Images and other remote content", settings.remoteImages, [
            ["ask", "Block, ask for each message (recommended)"], ["always", "Always load"]
        ], "Remote images tell senders when and where you open their mail. Blocked content can be loaded per message.");
        panel.appendChild(remote.el);

        panel.appendChild(el("h3", { text: "Trusted senders" }));
        panel.appendChild(el("p", { class: "muted", text: "Remote content always loads for these addresses and domains." }));
        var list = el("div");
        var render = function () {
            util.clear(list);
            if (trusted.length === 0) {
                list.appendChild(el("div", { class: "muted", text: "No trusted senders yet." }));
                return;
            }
            var table = el("table", { class: "list-table" });
            trusted.forEach(function (sender, index) {
                table.appendChild(el("tr", {}, [
                    el("td", { text: sender }),
                    el("td", { style: { width: "40px", textAlign: "right" } }, el("button", {
                        class: "iconbtn small", title: "Remove", on: { click: function () { trusted.splice(index, 1); render(); } }
                    }, icon("trash alternate outline")))
                ]));
            });
            list.appendChild(table);
        };
        render();
        panel.appendChild(list);
        var addInput = el("input", { class: "input", type: "text", placeholder: "name@example.com or example.com" });
        var addButton = el("button", { class: "btn", text: "Add" });
        addButton.addEventListener("click", function () {
            var value = addInput.value.trim().toLowerCase();
            if (value && trusted.indexOf(value) < 0) {
                trusted.push(value);
                addInput.value = "";
                render();
            }
        });
        panel.appendChild(el("div", { style: { display: "flex", gap: "8px", marginTop: "10px" } }, [addInput, addButton]));
        return {
            el: panel,
            apply: function (target) {
                target.remoteImages = remote.input.value;
                target.trustedSenders = trusted;
            }
        };
    }

    function composingPanel(settings, accounts) {
        var panel = el("div");
        var fields = {};
        panel.appendChild(el("h3", { text: "Sending" }));
        fields.undo = selectField("Undo send period", settings.undoSendSeconds, [[0, "Off"], [5, "5 seconds"], [10, "10 seconds"], [20, "20 seconds"], [30, "30 seconds"]],
            "Gives you a moment to take a message back after pressing Send. The message is delivered by the server even if you close Mail.");
        var defaults = [["", "The account I'm viewing"]];
        accounts.forEach(function (account) { defaults.push([account.id, account.email]); });
        fields.defaultAccount = selectField("Send new messages from", settings.defaultAccount || "", defaults);
        panel.appendChild(el("div", { class: "row" }, [fields.undo.el, fields.defaultAccount.el]));
        fields.sendShortcut = checkField("Send with Ctrl + Enter", settings.sendShortcut !== "none");
        panel.appendChild(fields.sendShortcut.el);
        fields.collect = checkField("Remember the people I write to for address completion", settings.autoCollectContacts);
        panel.appendChild(fields.collect.el);

        panel.appendChild(el("h3", { text: "Default text style" }));
        fields.font = selectField("Font", settings.composeFont || "", [
            ["", "Sans serif"], ["Georgia, 'Times New Roman', serif", "Serif"], ["Consolas, 'Courier New', monospace", "Monospace"],
            ["Arial, Helvetica, sans-serif", "Arial"], ["Verdana, Geneva, sans-serif", "Verdana"]
        ]);
        fields.size = selectField("Size", settings.composeFontSize || "14px", [["12px", "Small"], ["14px", "Normal"], ["16px", "Large"], ["18px", "Extra large"]]);
        panel.appendChild(el("div", { class: "row" }, [fields.font.el, fields.size.el]));
        panel.appendChild(el("p", { class: "muted", text: "Signatures are set per account under each account's settings." }));
        return {
            el: panel,
            apply: function (target) {
                target.undoSendSeconds = parseInt(fields.undo.input.value, 10);
                target.defaultAccount = fields.defaultAccount.input.value;
                target.sendShortcut = fields.sendShortcut.input.checked ? "ctrl-enter" : "none";
                target.autoCollectContacts = fields.collect.input.checked;
                target.composeFont = fields.font.input.value;
                target.composeFontSize = fields.size.input.value;
            }
        };
    }

    /* ---------- Labels ---------- */

    function labelsPanel(labels) {
        var panel = el("div");
        var working = labels.map(function (label) { return { id: label.id, name: label.name, color: label.color }; });
        panel.appendChild(el("h3", { text: "Labels" }));
        panel.appendChild(el("p", { class: "muted", text: "Labels work for every account. Assign them from a message's menu or by dragging messages onto a label." }));
        var list = el("div");
        var render = function () {
            util.clear(list);
            working.forEach(function (label, index) {
                var dot = el("button", { class: "iconbtn small", title: "Colour", type: "button" }, el("span", { class: "dot", style: { width: "14px", height: "14px", borderRadius: "50%", background: label.color, display: "inline-block" } }));
                dot.addEventListener("click", function () {
                    ui.menu(dot, LABEL_COLORS.map(function (value) {
                        return { label: value, dot: value, checked: value === label.color, onClick: function () { label.color = value; render(); } };
                    }));
                });
                var name = el("input", { class: "input", type: "text", value: label.name, maxlength: "40" });
                name.addEventListener("input", function () { label.name = name.value; });
                list.appendChild(el("div", { style: { display: "flex", gap: "8px", alignItems: "center", marginBottom: "8px" } }, [
                    dot, name,
                    el("button", { class: "iconbtn", title: "Delete label", on: { click: function () { working.splice(index, 1); render(); } } }, icon("trash alternate outline"))
                ]));
            });
        };
        render();
        panel.appendChild(list);
        panel.appendChild(el("button", {
            class: "btn", on: {
                click: function () {
                    working.push({ id: "", name: "New label", color: LABEL_COLORS[working.length % LABEL_COLORS.length] });
                    render();
                    var inputs = list.querySelectorAll("input");
                    if (inputs.length > 0) {
                        inputs[inputs.length - 1].select();
                    }
                }
            }
        }, [icon("plus"), "Add label"]));
        return { el: panel, value: function () { return working.filter(function (label) { return label.name.trim() !== ""; }); } };
    }

    /* ---------- Address book ---------- */

    function parseVCards(text) {
        var contacts = [];
        String(text).replace(/\r\n[ \t]/g, "").split(/BEGIN:VCARD/i).forEach(function (card) {
            var contact = { name: "", email: "", company: "", phone: "" };
            card.split(/\r?\n/).forEach(function (line) {
                var colon = line.indexOf(":");
                if (colon < 0) {
                    return;
                }
                var key = line.slice(0, colon).split(";")[0].toUpperCase();
                var value = line.slice(colon + 1).trim();
                if (key === "FN") {
                    contact.name = value;
                } else if (key === "EMAIL" && !contact.email) {
                    contact.email = value;
                } else if (key === "ORG") {
                    contact.company = value.replace(/;/g, " ").trim();
                } else if (key === "TEL" && !contact.phone) {
                    contact.phone = value;
                }
            });
            if (contact.email) {
                contacts.push(contact);
            }
        });
        return contacts;
    }

    function parseCSV(text) {
        var rows = [];
        var row = [];
        var field = "";
        var quoted = false;
        for (var i = 0; i < text.length; i++) {
            var ch = text[i];
            if (quoted) {
                if (ch === '"' && text[i + 1] === '"') {
                    field += '"';
                    i++;
                } else if (ch === '"') {
                    quoted = false;
                } else {
                    field += ch;
                }
            } else if (ch === '"') {
                quoted = true;
            } else if (ch === ",") {
                row.push(field);
                field = "";
            } else if (ch === "\n" || ch === "\r") {
                if (ch === "\r" && text[i + 1] === "\n") {
                    i++;
                }
                row.push(field);
                rows.push(row);
                row = [];
                field = "";
            } else {
                field += ch;
            }
        }
        if (field !== "" || row.length > 0) {
            row.push(field);
            rows.push(row);
        }
        if (rows.length < 2) {
            return [];
        }
        var header = rows[0].map(function (cell) { return cell.trim().toLowerCase(); });
        var find = function (names) {
            for (var i = 0; i < header.length; i++) {
                for (var j = 0; j < names.length; j++) {
                    if (header[i] === names[j] || header[i].indexOf(names[j]) >= 0) {
                        return i;
                    }
                }
            }
            return -1;
        };
        var emailIndex = find(["email", "e-mail address", "mail"]);
        var nameIndex = find(["name", "display name", "full name"]);
        var companyIndex = find(["company", "organization"]);
        var phoneIndex = find(["phone", "mobile"]);
        if (emailIndex < 0) {
            return [];
        }
        return rows.slice(1).map(function (cells) {
            return {
                email: (cells[emailIndex] || "").trim(),
                name: nameIndex >= 0 ? (cells[nameIndex] || "").trim() : "",
                company: companyIndex >= 0 ? (cells[companyIndex] || "").trim() : "",
                phone: phoneIndex >= 0 ? (cells[phoneIndex] || "").trim() : ""
            };
        }).filter(function (contact) { return util.isValidEmail(contact.email); });
    }

    function csvCell(value) {
        value = String(value || "");
        return /[",\n]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
    }

    function contactDialog(contact, onSaved) {
        contact = contact || { name: "", email: "", company: "", phone: "", notes: "" };
        var name = el("input", { class: "input", type: "text", value: contact.name || "" });
        var address = el("input", { class: "input", type: "email", value: contact.email || "", autofocus: true });
        var company = el("input", { class: "input", type: "text", value: contact.company || "" });
        var phone = el("input", { class: "input", type: "tel", value: contact.phone || "" });
        var notes = el("textarea", { class: "textarea", text: contact.notes || "" });
        ui.modal({
            title: contact.email ? "Edit contact" : "New contact",
            body: el("div", {}, [
                el("div", { class: "field" }, [el("label", { text: "Name" }), name]),
                el("div", { class: "field" }, [el("label", { text: "Email" }), address]),
                el("div", { class: "row" }, [
                    el("div", { class: "field" }, [el("label", { text: "Company" }), company]),
                    el("div", { class: "field" }, [el("label", { text: "Phone" }), phone])
                ]),
                el("div", { class: "field" }, [el("label", { text: "Notes" }), notes])
            ]),
            buttons: [
                { label: "Cancel" },
                {
                    label: "Save", primary: true, onClick: function (modal) {
                        modal.setBusy(true);
                        return api.compose("saveContact", {
                            contact: { name: name.value.trim(), email: address.value.trim(), company: company.value.trim(), phone: phone.value.trim(), notes: notes.value }
                        }).then(function (saved) {
                            modal.close();
                            if (onSaved) {
                                onSaved(saved);
                            }
                        }).catch(function (error) {
                            modal.setBusy(false);
                            ui.errorToast(error);
                        });
                    }
                }
            ]
        });
    }

    function contactsPanel(handlers) {
        var panel = el("div");
        var contacts = [];
        var search = el("input", { class: "input", type: "search", placeholder: "Search contacts" });
        var table = el("div");
        var fileInput = el("input", { type: "file", accept: ".vcf,.csv,text/vcard,text/csv", class: "hidden" });

        var load = function () {
            util.clear(table);
            table.appendChild(el("div", { class: "progress-line" }, [el("div", { class: "spinner" }), "Loading contacts…"]));
            api.compose("contacts", {}).then(function (list) {
                contacts = list || [];
                render();
            }).catch(function (error) {
                util.clear(table);
                table.appendChild(el("div", { class: "notice danger" }, [icon("exclamation circle"), el("div", { text: error.message })]));
            });
        };
        var render = function () {
            util.clear(table);
            var query = search.value.trim().toLowerCase();
            var visible = contacts.filter(function (contact) {
                return !query || (contact.email + " " + (contact.name || "") + " " + (contact.company || "")).toLowerCase().indexOf(query) >= 0;
            });
            if (visible.length === 0) {
                table.appendChild(el("div", { class: "muted", style: { padding: "18px 4px" }, text: contacts.length === 0 ? "Your address book is empty. People you write to are added automatically." : "No contacts match." }));
                return;
            }
            var list = el("table", { class: "list-table" }, el("tr", {}, [el("th", { text: "Name" }), el("th", { text: "Email" }), el("th", { text: "Company" }), el("th", { text: "" })]));
            visible.slice(0, 500).forEach(function (contact) {
                list.appendChild(el("tr", {}, [
                    el("td", {}, el("div", { style: { display: "flex", alignItems: "center", gap: "8px" } }, [util.avatar(contact, "small"), el("span", { text: contact.name || "" })])),
                    el("td", { text: contact.email }),
                    el("td", { text: contact.company || "" }),
                    el("td", { style: { whiteSpace: "nowrap", textAlign: "right" } }, [
                        el("button", { class: "iconbtn small", title: "Write to " + contact.email, on: { click: function () { if (handlers.onWrite) { handlers.onWrite(contact); } } } }, icon("edit outline")),
                        el("button", { class: "iconbtn small", title: "Edit", on: { click: function () { contactDialog(contact, load); } } }, icon("pencil alternate")),
                        el("button", {
                            class: "iconbtn small", title: "Delete", on: {
                                click: function () {
                                    api.compose("deleteContact", { email: contact.email }).then(load).catch(function (error) { ui.errorToast(error); });
                                }
                            }
                        }, icon("trash alternate outline"))
                    ])
                ]));
            });
            table.appendChild(list);
        };
        search.addEventListener("input", util.debounce(render, 120));
        fileInput.addEventListener("change", function () {
            var file = fileInput.files[0];
            fileInput.value = "";
            if (!file) {
                return;
            }
            var reader = new FileReader();
            reader.onload = function () {
                var text = String(reader.result || "");
                var parsed = /BEGIN:VCARD/i.test(text) ? parseVCards(text) : parseCSV(text);
                if (parsed.length === 0) {
                    ui.toast("No contacts with email addresses were found in " + file.name, { error: true });
                    return;
                }
                api.compose("importContacts", { contacts: parsed }).then(function (count) {
                    ui.toast(util.plural(count, "contact") + " imported");
                    load();
                }).catch(function (error) { ui.errorToast(error); });
            };
            reader.readAsText(file);
        });
        var exportCSV = function () {
            var lines = ["Name,Email,Company,Phone"];
            contacts.forEach(function (contact) {
                lines.push([contact.name, contact.email, contact.company, contact.phone].map(csvCell).join(","));
            });
            var blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
            var link = el("a", { href: URL.createObjectURL(blob), download: "contacts.csv" });
            document.body.appendChild(link);
            link.click();
            setTimeout(function () { URL.revokeObjectURL(link.href); link.remove(); }, 500);
        };

        panel.appendChild(el("h3", { text: "Address book" }));
        panel.appendChild(el("div", { style: { display: "flex", gap: "8px", marginBottom: "10px", flexWrap: "wrap" } }, [
            el("div", { style: { flex: "1", minWidth: "160px" } }, search),
            el("button", { class: "btn", on: { click: function () { contactDialog(null, load); } } }, [icon("plus"), "New"]),
            el("button", { class: "btn", title: "Import vCard or CSV", on: { click: function () { fileInput.click(); } } }, [icon("upload"), "Import"]),
            el("button", { class: "btn", title: "Export as CSV", on: { click: exportCSV } }, [icon("download"), "Export"]),
            fileInput
        ]));
        panel.appendChild(table);
        load();
        return { el: panel };
    }

    /* ---------- Administration ---------- */

    function adminPanel(config) {
        var panel = el("div");
        var redirect = Mail.accounts.redirectURI();
        var fields = {};

        var copyField = function (value) {
            var input = el("input", { class: "input", type: "text", value: value, readonly: true });
            var copy = el("button", { class: "btn", title: "Copy" }, icon("copy outline"));
            copy.addEventListener("click", function () {
                input.select();
                if (navigator.clipboard) {
                    navigator.clipboard.writeText(value).then(function () { ui.toast("Copied"); });
                }
            });
            return el("div", { class: "copy-field" }, [input, copy]);
        };
        var secretField = function (label, hasSecret) {
            var input = el("input", { class: "input", type: "password", autocomplete: "new-password", placeholder: hasSecret ? "Stored — leave empty to keep" : "" });
            var clearBox = checkField("Remove the stored secret", false);
            return {
                el: el("div", { class: "field" }, [el("label", { text: label }), input, hasSecret ? clearBox.el : null]),
                input: input,
                changed: function () { return input.value.trim() !== "" || clearBox.input.checked; },
                value: function () { return clearBox.input.checked ? "" : input.value.trim(); }
            };
        };

        //Google
        panel.appendChild(el("h3", {}, [el("i", { class: "google icon", style: { color: "#ea4335", marginRight: "6px" } }), "Sign in with Google"]));
        fields.googleEnabled = checkField("Allow users to connect Gmail and Google Workspace with \"Sign in with Google\"", config.google.enabled);
        fields.googleId = el("input", { class: "input", type: "text", value: config.google.clientId || "", placeholder: "xxxxxxxx.apps.googleusercontent.com", spellcheck: "false" });
        fields.googleSecret = secretField("Client secret", config.google.hasSecret);
        fields.googleFlow = selectField("Sign-in method", config.google.flow || "redirect", [
            ["redirect", "Redirect back to ArozOS (Web application client)"], ["loopback", "Paste the result URL (Desktop app client)"]
        ]);
        panel.appendChild(fields.googleEnabled.el);
        panel.appendChild(el("div", { class: "field" }, [el("label", { text: "Client ID" }), fields.googleId]));
        panel.appendChild(fields.googleSecret.el);
        panel.appendChild(fields.googleFlow.el);
        panel.appendChild(el("div", { class: "field" }, [el("label", { text: "Authorised redirect URI (Web application client)" }), copyField(redirect)]));
        panel.appendChild(el("div", { class: "notice", style: { marginBottom: "18px" } }, [icon("info circle"), el("div", {}, [
            el("div", { text: "In the Google Cloud console: configure the OAuth consent screen with the scope https://mail.google.com/, then create an OAuth client ID. For \"Redirect\" choose Web application and add the redirect URI above (Google requires HTTPS unless the address is localhost). For \"Paste the result URL\" choose Desktop app, which works on any address." }),
            el("div", { style: { marginTop: "6px" }, text: "While the consent screen is in testing mode only listed test users can sign in, and Google expires their sign-in after 7 days." })
        ])]));

        //Microsoft
        panel.appendChild(el("h3", {}, [el("i", { class: "microsoft icon", style: { color: "#0078d4", marginRight: "6px" } }), "Sign in with Microsoft"]));
        fields.msEnabled = checkField("Allow users to connect Outlook.com, Hotmail and Microsoft 365 with \"Sign in with Microsoft\"", config.microsoft.enabled);
        fields.msId = el("input", { class: "input", type: "text", value: config.microsoft.clientId || "", placeholder: "00000000-0000-0000-0000-000000000000", spellcheck: "false" });
        fields.msSecret = secretField("Client secret (redirect method only)", config.microsoft.hasSecret);
        fields.msTenant = el("input", { class: "input", type: "text", value: config.microsoft.tenant || "common", spellcheck: "false" });
        fields.msFlow = selectField("Sign-in method", config.microsoft.flow || "device", [
            ["device", "Device code (works on any address, recommended)"], ["redirect", "Redirect back to ArozOS (needs HTTPS)"]
        ]);
        panel.appendChild(fields.msEnabled.el);
        panel.appendChild(el("div", { class: "row" }, [
            el("div", { class: "field", style: { flex: "2" } }, [el("label", { text: "Application (client) ID" }), fields.msId]),
            el("div", { class: "field" }, [el("label", { text: "Tenant" }), fields.msTenant, el("div", { class: "help", text: "common, consumers, organizations or your tenant ID" })])
        ]));
        panel.appendChild(fields.msFlow.el);
        panel.appendChild(fields.msSecret.el);
        panel.appendChild(el("div", { class: "notice", style: { marginBottom: "18px" } }, [icon("info circle"), el("div", {}, [
            el("div", { text: "In the Microsoft Entra admin center, register an application for \"Accounts in any organizational directory and personal Microsoft accounts\". Under API permissions add the delegated permissions IMAP.AccessAsUser.All, SMTP.Send and offline_access." }),
            el("div", { style: { marginTop: "6px" }, text: "Device code: under Authentication enable \"Allow public client flows\"; no secret is needed. Redirect: add a Web platform with the redirect URI " + redirect + " and create a client secret." })
        ])]));

        //Policy
        panel.appendChild(el("h3", { text: "Security and limits" }));
        fields.privateHosts = checkField("Allow users to connect to mail servers on the local network", config.allowPrivateHosts,
            "Off by default so accounts cannot be used to reach other services on this network. Administrators are always allowed.");
        fields.insecure = checkField("Allow unencrypted connections", config.allowInsecure, "Passwords would travel in plain text. Administrators are always allowed.");
        panel.appendChild(fields.privateHosts.el);
        panel.appendChild(fields.insecure.el);
        fields.maxAttachment = el("input", { class: "input", type: "number", min: "1", max: "1024", value: config.maxAttachmentMB || 25 });
        fields.maxAccounts = el("input", { class: "input", type: "number", min: "0", max: "100", value: config.maxAccounts || 0 });
        panel.appendChild(el("div", { class: "row" }, [
            el("div", { class: "field" }, [el("label", { text: "Attachment limit per message (MB)" }), fields.maxAttachment]),
            el("div", { class: "field" }, [el("label", { text: "Accounts per user" }), fields.maxAccounts, el("div", { class: "help", text: "0 means unlimited" })])
        ]));

        return {
            el: panel,
            value: function () {
                return {
                    google: { enabled: fields.googleEnabled.input.checked, clientId: fields.googleId.value.trim(), clientSecret: fields.googleSecret.value(), flow: fields.googleFlow.input.value },
                    googleSecretSet: fields.googleSecret.changed(),
                    microsoft: { enabled: fields.msEnabled.input.checked, clientId: fields.msId.value.trim(), clientSecret: fields.msSecret.value(), tenant: fields.msTenant.value.trim(), flow: fields.msFlow.input.value },
                    microsoftSecretSet: fields.msSecret.changed(),
                    allowPrivateHosts: fields.privateHosts.input.checked,
                    allowInsecure: fields.insecure.input.checked,
                    maxAttachmentMB: parseInt(fields.maxAttachment.value, 10) || 25,
                    maxAccounts: parseInt(fields.maxAccounts.value, 10) || 0
                };
            }
        };
    }

    /* ---------- Dialog ---------- */

    //open shows the preferences. context: {settings, labels, accounts, isAdmin,
    //onSettings(settings), onLabels(labels), onWrite(contact)}; tab picks the first tab
    function open(context, tab) {
        var settings = JSON.parse(JSON.stringify(context.settings));
        var tabs = [
            { id: "general", label: "General", icon: "sliders horizontal" },
            { id: "privacy", label: "Privacy", icon: "shield alternate" },
            { id: "composing", label: "Composing", icon: "edit outline" },
            { id: "labels", label: "Labels", icon: "tags" },
            { id: "contacts", label: "Address book", icon: "address book outline" }
        ];
        if (context.isAdmin) {
            tabs.push({ id: "admin", label: "Administration", icon: "server" });
        }
        var panels = {
            general: preferencesPanel(settings),
            privacy: privacyPanel(settings),
            composing: composingPanel(settings, context.accounts),
            labels: labelsPanel(context.labels),
            contacts: contactsPanel({ onWrite: function (contact) { dialog.close(); if (context.onWrite) { context.onWrite(contact); } } })
        };

        var tabList = el("div", { class: "tabs" });
        var panelHost = el("div", { class: "panel" });
        var wrap = el("div", { class: "tabbed" }, [tabList, panelHost]);
        var show = function (id) {
            tabList.querySelectorAll(".tab").forEach(function (node) { node.classList.toggle("active", node.dataset.id === id); });
            util.clear(panelHost);
            if (id === "admin" && !panels.admin) {
                panelHost.appendChild(el("div", { class: "progress-line" }, [el("div", { class: "spinner" }), "Loading…"]));
                api.settings("admin", {}).then(function (config) {
                    panels.admin = adminPanel(config);
                    if (tabList.querySelector(".tab.active").dataset.id === "admin") {
                        util.clear(panelHost);
                        panelHost.appendChild(panels.admin.el);
                    }
                }).catch(function (error) {
                    util.clear(panelHost);
                    panelHost.appendChild(el("div", { class: "notice danger" }, [icon("exclamation circle"), el("div", { text: error.message })]));
                });
                return;
            }
            panelHost.appendChild(panels[id].el);
        };
        tabs.forEach(function (definition) {
            var node = el("div", { class: "tab", dataset: { id: definition.id } }, [icon(definition.icon), el("span", { text: definition.label })]);
            node.addEventListener("click", function () { show(definition.id); });
            tabList.appendChild(node);
        });

        var dialog = ui.modal({
            title: "Mail settings",
            xwide: true,
            flush: true,
            body: wrap,
            buttons: [
                { label: "Cancel" },
                {
                    label: "Save", primary: true, onClick: function (modal) {
                        panels.general.apply(settings);
                        panels.privacy.apply(settings);
                        panels.composing.apply(settings);
                        modal.setBusy(true);
                        var jobs = [
                            api.settings("save", { settings: settings }).then(function (saved) {
                                if (context.onSettings) {
                                    context.onSettings(saved);
                                }
                            }),
                            api.settings("saveLabels", { labels: panels.labels.value() }).then(function (labels) {
                                if (context.onLabels) {
                                    context.onLabels(labels);
                                }
                            })
                        ];
                        if (panels.admin) {
                            jobs.push(api.settings("saveAdmin", { config: panels.admin.value() }));
                        }
                        return Promise.all(jobs).then(function () {
                            modal.close();
                            ui.toast("Settings saved");
                        }).catch(function (error) {
                            modal.setBusy(false);
                            ui.errorToast(error, "Could not save");
                        });
                    }
                }
            ]
        });
        show(tab && panels[tab] !== undefined || tab === "admin" ? tab : "general");
        return dialog;
    }

    function shortcuts() {
        var rows = [
            ["c", "New message"], ["r", "Reply"], ["a", "Reply all"], ["f", "Forward"],
            ["e", "Archive"], ["# or Delete", "Delete"], ["s", "Star / unstar"], ["u", "Mark as unread"],
            ["Shift + i", "Mark as read"], ["j / ↓", "Next message"], ["k / ↑", "Previous message"],
            ["x", "Select message"], ["/", "Search"], ["Esc", "Clear selection"], ["Ctrl + Enter", "Send (while writing)"],
            ["Ctrl + S", "Save draft (while writing)"], ["?", "This help"]
        ];
        var table = el("table", { class: "list-table" });
        rows.forEach(function (row) {
            table.appendChild(el("tr", {}, [el("td", { style: { width: "150px" } }, el("b", { text: row[0] })), el("td", { text: row[1] })]));
        });
        ui.modal({ title: "Keyboard shortcuts", body: table, buttons: [{ label: "Close", primary: true }] });
    }

    return { open: open, shortcuts: shortcuts, contactDialog: contactDialog, LABEL_COLORS: LABEL_COLORS };
})();
