/*
    Mail — composer

    One composer at a time, floating over the reading pane (it can be
    minimised or maximised). The body is edited in an iframe so the styles of
    a quoted message never leak into the app, and so the app's styles never
    leak into the message.

    Attachments are either files in the ArozOS file system (uploads land in a
    private tmp:/Mail folder first) or parts of an existing message on the
    server (forwarding, reopened drafts). Every draft save turns all of them
    into parts of the new draft, so nothing depends on temporary files for
    long.
*/

var Mail = window.Mail || {};
window.Mail = Mail;

Mail.compose = (function () {
    "use strict";
    var util = Mail.util;
    var ui = Mail.ui;
    var api = Mail.api;
    var el = util.el;
    var icon = util.icon;

    var host = null;
    var context = null;
    var current = null;

    var AUTOSAVE_MS = 20000;
    var FONTS = [
        { label: "Sans serif", value: "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" },
        { label: "Serif", value: "Georgia, 'Times New Roman', serif" },
        { label: "Monospace", value: "Consolas, 'Courier New', monospace" },
        { label: "Arial", value: "Arial, Helvetica, sans-serif" },
        { label: "Verdana", value: "Verdana, Geneva, sans-serif" },
        { label: "Georgia", value: "Georgia, serif" },
        { label: "Trebuchet", value: "'Trebuchet MS', sans-serif" }
    ];
    var ATTACHMENT_WORDS = /\b(attach(ed|ment|ments|ing)?|enclosed)\b|附件|附檔|附上|添付|anbei|ci-joint|adjunto/i;

    //init wires the composer to the app: host element and app callbacks
    //(accounts, settings, onSent, onDraftChanged)
    function init(options) {
        host = options.host;
        context = options.context;
    }

    function isOpen() {
        return current !== null;
    }

    /* ---------- Address field ---------- */

    function AddressField(placeholder) {
        var values = [];
        var wrap = el("div", { class: "address-field" });
        var input = el("input", { type: "text", placeholder: placeholder || "", autocomplete: "off", spellcheck: "false" });
        var suggestions = null;
        var focusIndex = -1;
        var lastQuery = "";
        var changeHandlers = [];
        wrap.appendChild(input);
        wrap.addEventListener("mousedown", function (event) {
            if (event.target === wrap) {
                event.preventDefault();
                input.focus();
            }
        });

        function changed() {
            changeHandlers.forEach(function (fn) { fn(); });
        }

        function render() {
            wrap.querySelectorAll(".addr-chip").forEach(function (chip) { chip.remove(); });
            values.forEach(function (value, index) {
                var valid = util.isValidEmail(value.email);
                var chip = el("span", {
                    class: "addr-chip" + (valid ? "" : " invalid"),
                    title: valid ? util.addressFull(value) : "Not a valid email address"
                }, [
                    util.avatar(value, "small"),
                    el("span", { class: "txt", text: value.name || value.email }),
                    el("button", {
                        type: "button", title: "Remove", on: {
                            click: function (event) {
                                event.stopPropagation();
                                values.splice(index, 1);
                                render();
                                changed();
                            }
                        }
                    }, icon("close"))
                ]);
                chip.addEventListener("dblclick", function () {
                    //Edit a chip by putting it back into the input
                    values.splice(index, 1);
                    render();
                    input.value = util.formatAddressForInput(value);
                    input.focus();
                    changed();
                });
                wrap.insertBefore(chip, input);
            });
        }

        function commit(text) {
            var added = false;
            util.splitAddresses(text).forEach(function (piece) {
                var parsed = util.parseAddress(piece);
                if (!parsed || !parsed.email) {
                    return;
                }
                var exists = values.some(function (value) { return value.email.toLowerCase() === parsed.email.toLowerCase(); });
                if (!exists) {
                    values.push(parsed);
                    added = true;
                }
            });
            if (added) {
                render();
                changed();
            }
        }

        function closeSuggestions() {
            if (suggestions) {
                suggestions.remove();
                suggestions = null;
            }
            focusIndex = -1;
        }

        function showSuggestions(list) {
            closeSuggestions();
            if (list.length === 0) {
                return;
            }
            suggestions = el("div", { class: "suggestions" });
            list.forEach(function (contact) {
                var row = el("div", { class: "suggestion" }, [
                    util.avatar(contact, "small"),
                    el("div", { class: "who" }, [
                        el("div", { class: "n", text: contact.name || contact.email }),
                        el("div", { class: "e", text: contact.email })
                    ])
                ]);
                row.addEventListener("mousedown", function (event) {
                    event.preventDefault();
                    pick(contact);
                });
                suggestions.appendChild(row);
            });
            suggestions.contacts = list;
            wrap.appendChild(suggestions);
        }

        function pick(contact) {
            input.value = "";
            commit(util.formatAddressForInput(contact));
            closeSuggestions();
            input.focus();
        }

        var search = util.debounce(function () {
            var query = input.value.trim();
            if (query.length < 1) {
                closeSuggestions();
                return;
            }
            lastQuery = query;
            api.compose("searchContacts", { query: query, limit: 8 }).then(function (contacts) {
                if (input.value.trim() !== lastQuery || document.activeElement !== input) {
                    return;
                }
                showSuggestions((contacts || []).filter(function (contact) {
                    return !values.some(function (value) { return value.email.toLowerCase() === contact.email.toLowerCase(); });
                }));
            }).catch(function () { /* completion is best effort */ });
        }, 140);

        input.addEventListener("input", function () {
            if (/[,;]/.test(input.value)) {
                var text = input.value;
                input.value = "";
                commit(text);
                closeSuggestions();
                return;
            }
            search();
        });
        input.addEventListener("keydown", function (event) {
            var rows = suggestions ? suggestions.querySelectorAll(".suggestion") : [];
            if ((event.key === "ArrowDown" || event.key === "ArrowUp") && rows.length > 0) {
                event.preventDefault();
                if (focusIndex >= 0) {
                    rows[focusIndex].classList.remove("focus");
                }
                focusIndex = (focusIndex + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
                rows[focusIndex].classList.add("focus");
                return;
            }
            if ((event.key === "Enter" || event.key === "Tab") && suggestions && focusIndex >= 0) {
                event.preventDefault();
                pick(suggestions.contacts[focusIndex]);
                return;
            }
            if ((event.key === "Enter" || (event.key === "Tab" && input.value.trim() !== "")) && input.value.trim() !== "") {
                event.preventDefault();
                commit(input.value);
                input.value = "";
                closeSuggestions();
                return;
            }
            if (event.key === "Backspace" && input.value === "" && values.length > 0) {
                values.pop();
                render();
                changed();
            }
            if (event.key === "Escape" && suggestions) {
                event.stopPropagation();
                closeSuggestions();
            }
        });
        input.addEventListener("paste", function (event) {
            var text = (event.clipboardData || window.clipboardData).getData("text");
            if (/[,;\n]/.test(text)) {
                event.preventDefault();
                commit(text);
            }
        });
        input.addEventListener("blur", function () {
            setTimeout(closeSuggestions, 120);
            if (input.value.trim() !== "") {
                commit(input.value);
                input.value = "";
            }
        });

        return {
            el: wrap,
            input: input,
            focus: function () { input.focus(); },
            set: function (list) {
                values = [];
                commit((list || []).join(", "));
                render();
            },
            //values returns RFC 5322 mailboxes, including text still being typed
            values: function () {
                if (input.value.trim() !== "") {
                    commit(input.value);
                    input.value = "";
                }
                return values.map(util.formatAddressForInput);
            },
            invalid: function () {
                return values.filter(function (value) { return !util.isValidEmail(value.email); });
            },
            count: function () { return values.length; },
            onChange: function (fn) { changeHandlers.push(fn); }
        };
    }

    /* ---------- Body helpers ---------- */

    //bodyInnerHTML extracts the body of a sanitised message document without
    //its style sheets, ready to be quoted
    function bodyInnerHTML(html) {
        var doc = new DOMParser().parseFromString(String(html || ""), "text/html");
        doc.querySelectorAll("style, script, link, meta, title").forEach(function (node) { node.remove(); });
        return doc.body ? doc.body.innerHTML : "";
    }

    function textToHTML(text) {
        return util.escapeHTML(text || "").replace(/\r?\n/g, "<br>");
    }

    function messageBodyHTML(message) {
        if (message.html) {
            return bodyInnerHTML(message.html);
        }
        return '<div style="white-space:pre-wrap">' + util.escapeHTML(message.text || "") + "</div>";
    }

    function quoteBlock(message) {
        var from = (message.from && message.from[0]) || {};
        var attribution = "On " + util.formatFullDate(message.date) + ", " + util.escapeHTML(util.addressFull(from)) + " wrote:";
        return '<div class="aroz-quote"><div>' + attribution + '</div><blockquote type="cite" style="margin:0 0 0 0.8ex;border-left:2px solid #ccd2dc;padding-left:1ex;color:#4a5466">' +
            messageBodyHTML(message) + "</blockquote></div>";
    }

    function forwardBlock(message) {
        var from = (message.from && message.from[0]) || {};
        var rows = [
            ["From", util.addressFull(from)],
            ["Date", util.formatFullDate(message.date)],
            ["Subject", message.subject || ""],
            ["To", (message.to || []).map(util.addressFull).join(", ")]
        ];
        if (message.cc && message.cc.length > 0) {
            rows.push(["Cc", message.cc.map(util.addressFull).join(", ")]);
        }
        var header = rows.map(function (row) { return "<b>" + row[0] + ":</b> " + util.escapeHTML(row[1]); }).join("<br>");
        return '<div class="aroz-forward"><div>---------- Forwarded message ----------</div><div>' + header + "</div><br>" + messageBodyHTML(message) + "</div>";
    }

    function prefixed(prefix, subject) {
        subject = subject || "";
        var pattern = new RegExp("^\\s*" + prefix + "\\s*:", "i");
        return pattern.test(subject) ? subject : prefix + ": " + subject;
    }

    function ownAddresses() {
        return context.accounts().map(function (account) { return account.email.toLowerCase(); });
    }

    /* ---------- Opening helpers ---------- */

    function replyOptions(message, all) {
        var own = ownAddresses();
        var from = message.from || [];
        var isOwn = from.length > 0 && own.indexOf(from[0].email.toLowerCase()) >= 0;
        var to = isOwn ? (message.to || []) : ((message.replyTo && message.replyTo.length > 0) ? message.replyTo : from);
        var cc = [];
        if (all) {
            var seen = {};
            to.concat(own.map(function (address) { return { email: address }; })).forEach(function (address) { seen[address.email.toLowerCase()] = true; });
            (message.to || []).concat(message.cc || []).forEach(function (address) {
                var key = address.email.toLowerCase();
                if (!seen[key]) {
                    seen[key] = true;
                    cc.push(address);
                }
            });
        }
        var references = (message.references || []).slice();
        if (message.messageId && references.indexOf(message.messageId) < 0) {
            references.push(message.messageId);
        }
        return {
            accountId: message.accountId,
            to: to.map(util.formatAddressForInput),
            cc: cc.map(util.formatAddressForInput),
            subject: prefixed("Re", message.subject),
            quoteHTML: quoteBlock(message),
            inReplyTo: message.messageId || "",
            references: references,
            replyMode: "reply",
            originalFolder: message.folder,
            originalUid: message.uid,
            focus: "body"
        };
    }

    function forwardOptions(message, asAttachment) {
        var options = {
            accountId: message.accountId,
            subject: prefixed("Fwd", message.subject),
            replyMode: "forward",
            originalFolder: message.folder,
            originalUid: message.uid,
            focus: "to",
            attachments: []
        };
        if (asAttachment) {
            options.attachments.push({
                kind: "part", accountId: message.accountId, folder: message.folder, uid: message.uid, partId: "",
                name: (message.subject || "Message") + ".eml", size: message.size
            });
        } else {
            options.quoteHTML = forwardBlock(message);
            (message.attachments || []).forEach(function (attachment) {
                options.attachments.push({
                    kind: "part", accountId: message.accountId, folder: message.folder, uid: message.uid,
                    partId: attachment.id, name: attachment.filename, size: attachment.size
                });
            });
        }
        return options;
    }

    function draftOptions(message) {
        return {
            accountId: message.accountId,
            to: (message.to || []).map(util.formatAddressForInput),
            cc: (message.cc || []).map(util.formatAddressForInput),
            bcc: (message.bcc || []).map(util.formatAddressForInput),
            subject: message.subject || "",
            html: message.html ? bodyInnerHTML(message.html) : textToHTML(message.text),
            noSignature: true,
            inReplyTo: message.inReplyTo || "",
            references: message.references || [],
            draft: { folder: message.folder, uid: message.uid },
            priority: message.priority === 1 ? "high" : (message.priority === 5 ? "low" : "normal"),
            attachments: (message.attachments || []).map(function (attachment) {
                return {
                    kind: "part", accountId: message.accountId, folder: message.folder, uid: message.uid,
                    partId: attachment.id, name: attachment.filename, size: attachment.size
                };
            })
        };
    }

    //mailtoOptions understands mailto:a@b?cc=…&subject=…&body=…
    function mailtoOptions(href, accountId) {
        var options = { accountId: accountId, to: [], focus: "body" };
        var raw = String(href || "").replace(/^mailto:/i, "");
        var parts = raw.split("?");
        if (parts[0]) {
            options.to = util.splitAddresses(decodeURIComponent(parts[0]));
        }
        if (parts[1]) {
            parts[1].split("&").forEach(function (pair) {
                var kv = pair.split("=");
                var key = decodeURIComponent(kv[0] || "").toLowerCase();
                var value = decodeURIComponent((kv[1] || "").replace(/\+/g, " "));
                if (key === "subject") {
                    options.subject = value;
                } else if (key === "body") {
                    options.html = textToHTML(value);
                } else if (key === "cc" || key === "bcc") {
                    options[key] = util.splitAddresses(value);
                } else if (key === "to") {
                    options.to = options.to.concat(util.splitAddresses(value));
                }
            });
        }
        if (options.to.length === 0) {
            options.focus = "to";
        }
        return options;
    }

    /* ---------- Composer ---------- */

    //open starts a message. Inside the ArozOS desktop every message gets its
    //own float window (compose.html); elsewhere it opens over the page.
    function open(options) {
        options = options || {};
        if (!context.windowMode && Mail.shared && Mail.shared.isDesktop()) {
            return Promise.resolve(Mail.shared.openComposeWindow(options));
        }
        return openHere(options);
    }

    //openHere always opens the composer inside the current page
    function openHere(options) {
        options = options || {};
        if (current) {
            return current.confirmReplace().then(function (ok) {
                if (ok) {
                    current = new Composer(options);
                }
                return ok;
            });
        }
        current = new Composer(options);
        return Promise.resolve(true);
    }

    function Composer(options) {
        var self = this;
        var settings = context.settings();
        var accounts = context.accounts();
        var state = {
            accountId: options.accountId || context.defaultAccountId(),
            draft: options.draft || null,
            inReplyTo: options.inReplyTo || "",
            references: options.references || [],
            replyMode: options.replyMode || "",
            originalFolder: options.originalFolder || "",
            originalUid: options.originalUid || 0,
            priority: options.priority || "normal",
            readReceipt: false,
            plainOnly: options.plainOnly === true,
            sendAt: 0,
            attachments: [],
            dirty: false,
            saving: false,
            sending: false,
            closed: false,
            tempFolder: null,
            inFlight: null,
            uploadCounter: 0,
            lastSaved: null
        };
        if (!accounts.some(function (account) { return account.id === state.accountId; }) && accounts.length > 0) {
            state.accountId = accounts[0].id;
        }
        self.state = state;
        self.options = options;

        /* Layout */
        var root = el("div", { class: "composer", role: "dialog", "aria-label": "New message" });
        var title = el("div", { class: "title", text: options.subject || "New message" });
        var statusText = el("div", { class: "status" });
        var minimizeButton = el("button", { class: "iconbtn small", title: "Minimise" }, icon("window minimize outline"));
        var maximizeButton = el("button", { class: "iconbtn small", title: "Expand" }, icon("window maximize outline"));
        var closeButton = el("button", { class: "iconbtn small", title: "Save draft and close" }, icon("close"));
        var head = el("div", { class: "composer-head" }, [title, statusText, minimizeButton, maximizeButton, closeButton]);
        root.appendChild(head);
        //In its own window the float window's title bar replaces the header
        var windowMode = context.windowMode === true;
        if (windowMode) {
            root.classList.add("window-mode");
            head.classList.add("hidden");
        }

        var body = el("div", { class: "composer-body" });
        root.appendChild(body);

        //From
        var fromSelect = el("select", { class: "from-select", title: "Send from" });
        accounts.forEach(function (account) {
            var label = (account.displayName ? account.displayName + " <" + account.email + ">" : account.email);
            fromSelect.appendChild(el("option", { value: account.id, text: label }));
        });
        fromSelect.value = state.accountId;
        body.appendChild(el("div", { class: "compose-row" }, [el("span", { class: "lbl", text: "From" }), fromSelect]));

        //Recipients
        var toField = AddressField("Recipients");
        var ccField = AddressField("");
        var bccField = AddressField("");
        var ccRow = el("div", { class: "compose-row hidden" }, [el("span", { class: "lbl", text: "Cc" }), ccField.el]);
        var bccRow = el("div", { class: "compose-row hidden" }, [el("span", { class: "lbl", text: "Bcc" }), bccField.el]);
        var ccToggle = el("button", { type: "button", text: "Cc" });
        var bccToggle = el("button", { type: "button", text: "Bcc" });
        body.appendChild(el("div", { class: "compose-row" }, [
            el("span", { class: "lbl", text: "To" }), toField.el, el("div", { class: "toggles" }, [ccToggle, bccToggle])
        ]));
        body.appendChild(ccRow);
        body.appendChild(bccRow);
        ccToggle.addEventListener("click", function () { ccRow.classList.remove("hidden"); ccToggle.classList.add("hidden"); ccField.focus(); });
        bccToggle.addEventListener("click", function () { bccRow.classList.remove("hidden"); bccToggle.classList.add("hidden"); bccField.focus(); });

        //Subject
        var subjectInput = el("input", { class: "plain", type: "text", placeholder: "Subject", value: options.subject || "" });
        body.appendChild(el("div", { class: "compose-row" }, [el("span", { class: "lbl", text: "Subject" }), subjectInput]));

        //Formatting toolbar
        var formatBar = el("div", { class: "format-bar" });
        body.appendChild(formatBar);

        //Editor
        var editorWrap = el("div", { class: "editor-wrap" });
        var frame = el("iframe", { class: "editor-frame", title: "Message body" });
        var textArea = el("textarea", { class: "editor-text hidden", spellcheck: "true", placeholder: "Write your message" });
        editorWrap.appendChild(frame);
        editorWrap.appendChild(textArea);
        body.appendChild(editorWrap);

        var attachmentList = el("div", { class: "compose-attachments" });
        body.appendChild(attachmentList);

        //Footer
        var sendButton = el("button", { class: "btn primary", title: "Send (Ctrl+Enter)" }, [icon("paper plane outline"), "Send"]);
        var sendMore = el("button", { class: "btn primary", title: "More send options" }, icon("caret down"));
        var attachButton = el("button", { class: "iconbtn", title: "Attach files from this computer" }, icon("paperclip"));
        var arozButton = el("button", { class: "iconbtn", title: "Attach files from ArozOS" }, icon("folder open outline"));
        var imageButton = el("button", { class: "iconbtn", title: "Insert image" }, icon("image outline"));
        var optionsButton = el("button", { class: "iconbtn", title: "Message options" }, icon("ellipsis horizontal"));
        var badges = el("div", { class: "opts" });
        var discardButton = el("button", { class: "iconbtn", title: "Discard" }, icon("trash alternate outline"));
        var fileInput = el("input", { type: "file", multiple: true, class: "hidden" });
        var imageInput = el("input", { type: "file", accept: "image/*", class: "hidden" });
        var foot = el("div", { class: "composer-foot" }, [
            el("div", { class: "send-group" }, [sendButton, sendMore]),
            attachButton, arozButton, imageButton, optionsButton, badges,
            el("div", { class: "grow" }), discardButton, fileInput, imageInput
        ]);
        root.appendChild(foot);
        if (windowMode) {
            foot.insertBefore(statusText, discardButton);
        }
        host.appendChild(root);
        self.root = root;

        /* Editor document */
        var font = settings.composeFont || FONTS[0].value;
        var fontSize = settings.composeFontSize || "14px";
        //The message is edited on white paper in both themes: mail is read on
        //white by almost everyone, and quoted HTML assumes it
        var editorCSS = "html,body{height:100%;}body{margin:0;padding:16px 18px;box-sizing:border-box;outline:none;" +
            "font-family:" + font + ";font-size:" + fontSize + ";line-height:1.55;word-wrap:break-word;" +
            "background:#fff;color:#1d2433;}" +
            "blockquote{margin:0 0 0 0.8ex;border-left:2px solid #ccd2dc;padding-left:1ex;}" +
            "img{max-width:100%;height:auto;}a{color:#1f63d8;}" +
            "p{margin:0 0 0.6em;}" +
            "img[data-remote-src]{min-width:16px;min-height:16px;outline:1px dashed #9aa3b2;}";
        frame.srcdoc = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' + editorCSS + '</style></head><body contenteditable="true" spellcheck="true"></body></html>';

        var editorDoc = null;
        var signatureHTML = function (accountId) {
            var account = accounts.filter(function (item) { return item.id === accountId; })[0];
            return account && account.signature ? account.signature : "";
        };
        var initialHTML = function () {
            var html = options.html || "";
            var signature = options.noSignature ? "" : signatureHTML(state.accountId);
            var parts = [html || "<div><br></div>"];
            if (signature) {
                parts.push('<div data-aroz-signature="1"><div><br></div>' + signature + "</div>");
            }
            if (options.quoteHTML) {
                parts.push("<div><br></div>" + options.quoteHTML);
            }
            return parts.join("");
        };

        frame.addEventListener("load", function () {
            editorDoc = frame.contentDocument;
            editorDoc.body.innerHTML = initialHTML();
            try {
                editorDoc.execCommand("styleWithCSS", false, true);
                editorDoc.execCommand("defaultParagraphSeparator", false, "div");
            } catch (e) { /* not supported */ }
            editorDoc.addEventListener("input", markDirty);
            editorDoc.addEventListener("keydown", handleKeys);
            editorDoc.addEventListener("paste", handlePaste);
            editorDoc.addEventListener("dragover", handleDragOver);
            editorDoc.addEventListener("drop", handleDrop);
            if (state.plainOnly) {
                switchToPlain(true);
                if (options.plainText) {
                    textArea.value = options.plainText;
                }
            }
            focusInitial();
        });

        function focusInitial() {
            if (options.focus === "to" || (options.focus !== "body" && toField.count() === 0)) {
                toField.focus();
            } else if (editorDoc) {
                editorDoc.body.focus();
                var range = editorDoc.createRange();
                range.setStart(editorDoc.body, 0);
                range.collapse(true);
                var selection = editorDoc.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
            }
        }

        /* Fields */
        toField.set(options.to || []);
        ccField.set(options.cc || []);
        bccField.set(options.bcc || []);
        if (ccField.count() > 0) {
            ccRow.classList.remove("hidden");
            ccToggle.classList.add("hidden");
        }
        if (bccField.count() > 0) {
            bccRow.classList.remove("hidden");
            bccToggle.classList.add("hidden");
        }
        [toField, ccField, bccField].forEach(function (field) { field.onChange(markDirty); });
        subjectInput.addEventListener("input", function () {
            title.textContent = subjectInput.value.trim() || "New message";
            if (context.onTitle) {
                context.onTitle(title.textContent);
            }
            markDirty();
        });
        fromSelect.addEventListener("change", function () {
            var previous = state.accountId;
            state.accountId = fromSelect.value;
            swapSignature(previous, state.accountId);
            markDirty();
        });
        [subjectInput, toField.input, ccField.input, bccField.input].forEach(function (input) {
            input.addEventListener("keydown", handleKeys);
        });
        textArea.addEventListener("input", markDirty);
        textArea.addEventListener("keydown", handleKeys);

        function swapSignature(previousAccount, nextAccount) {
            if (!editorDoc || state.plainOnly) {
                return;
            }
            var block = editorDoc.querySelector("[data-aroz-signature]");
            var signature = signatureHTML(nextAccount);
            if (block) {
                if (signature) {
                    block.innerHTML = "<div><br></div>" + signature;
                } else {
                    block.remove();
                }
            } else if (signature && !options.noSignature) {
                var wrapper = editorDoc.createElement("div");
                wrapper.setAttribute("data-aroz-signature", "1");
                wrapper.innerHTML = "<div><br></div>" + signature;
                var quote = editorDoc.querySelector(".aroz-quote, .aroz-forward");
                editorDoc.body.insertBefore(wrapper, quote ? quote.previousSibling || quote : null);
            }
        }

        function markDirty() {
            state.dirty = true;
        }

        /* Formatting */
        function exec(command, value) {
            if (!editorDoc || state.plainOnly) {
                return;
            }
            frame.contentWindow.focus();
            editorDoc.execCommand(command, false, value === undefined ? null : value);
            markDirty();
        }

        function toolbarButton(iconName, label, onClick) {
            var button = el("button", { class: "iconbtn", type: "button", title: label }, icon(iconName));
            button.addEventListener("mousedown", function (event) { event.preventDefault(); });
            button.addEventListener("click", onClick);
            formatBar.appendChild(button);
            return button;
        }
        function separator() {
            formatBar.appendChild(el("span", { class: "sep" }));
        }

        var fontSelect = el("select", { title: "Font" });
        FONTS.forEach(function (item) { fontSelect.appendChild(el("option", { value: item.value, text: item.label })); });
        fontSelect.value = FONTS.some(function (item) { return item.value === font; }) ? font : FONTS[0].value;
        fontSelect.addEventListener("change", function () { exec("fontName", fontSelect.value); });
        formatBar.appendChild(fontSelect);
        var sizeSelect = el("select", { title: "Size" });
        [["2", "Small"], ["3", "Normal"], ["4", "Medium"], ["5", "Large"], ["6", "Huge"]].forEach(function (item) {
            sizeSelect.appendChild(el("option", { value: item[0], text: item[1] }));
        });
        sizeSelect.value = "3";
        sizeSelect.addEventListener("change", function () { exec("fontSize", sizeSelect.value); });
        formatBar.appendChild(sizeSelect);
        separator();
        toolbarButton("bold", "Bold (Ctrl+B)", function () { exec("bold"); });
        toolbarButton("italic", "Italic (Ctrl+I)", function () { exec("italic"); });
        toolbarButton("underline", "Underline (Ctrl+U)", function () { exec("underline"); });
        toolbarButton("strikethrough", "Strikethrough", function () { exec("strikeThrough"); });
        var colorInput = el("input", { type: "color", value: "#d93025" });
        var highlightInput = el("input", { type: "color", value: "#fff59d" });
        formatBar.appendChild(colorInput);
        formatBar.appendChild(highlightInput);
        toolbarButton("tint", "Text colour", function () { colorInput.click(); });
        toolbarButton("marker", "Highlight", function () { highlightInput.click(); });
        colorInput.addEventListener("input", function () { exec("foreColor", colorInput.value); });
        highlightInput.addEventListener("input", function () { exec("hiliteColor", highlightInput.value); });
        separator();
        toolbarButton("list ul", "Bulleted list", function () { exec("insertUnorderedList"); });
        toolbarButton("list ol", "Numbered list", function () { exec("insertOrderedList"); });
        toolbarButton("outdent", "Decrease indent", function () { exec("outdent"); });
        toolbarButton("indent", "Increase indent", function () { exec("indent"); });
        toolbarButton("align left", "Align left", function () { exec("justifyLeft"); });
        toolbarButton("align center", "Centre", function () { exec("justifyCenter"); });
        toolbarButton("align right", "Align right", function () { exec("justifyRight"); });
        toolbarButton("quote right", "Quote", function () { exec("formatBlock", "blockquote"); });
        separator();
        toolbarButton("linkify", "Insert link", function () {
            if (!editorDoc) {
                return;
            }
            var selection = editorDoc.getSelection();
            var savedRange = selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
            var selectedText = selection.toString();
            ui.prompt("Insert link", "Web address", /^https?:\/\//i.test(selectedText) ? selectedText : "https://", { okLabel: "Insert" }).then(function (url) {
                if (!url) {
                    return;
                }
                if (!/^(https?:|mailto:|tel:)/i.test(url)) {
                    url = "https://" + url;
                }
                frame.contentWindow.focus();
                if (savedRange) {
                    selection.removeAllRanges();
                    selection.addRange(savedRange);
                }
                if (selectedText === "") {
                    editorDoc.execCommand("insertHTML", false, '<a href="' + util.escapeHTML(url) + '">' + util.escapeHTML(url) + "</a>");
                } else {
                    editorDoc.execCommand("createLink", false, url);
                }
                markDirty();
            });
        });
        toolbarButton("unlink", "Remove link", function () { exec("unlink"); });
        toolbarButton("minus", "Horizontal line", function () { exec("insertHorizontalRule"); });
        toolbarButton("eraser", "Clear formatting", function () { exec("removeFormat"); });
        separator();
        toolbarButton("undo", "Undo (Ctrl+Z)", function () { exec("undo"); });
        toolbarButton("redo", "Redo (Ctrl+Y)", function () { exec("redo"); });

        /* Plain text mode */
        function editorHTML() {
            if (!editorDoc) {
                return "";
            }
            return editorDoc.body.innerHTML;
        }

        function editorPlainText() {
            if (state.plainOnly) {
                return textArea.value;
            }
            return editorDoc ? editorDoc.body.innerText : "";
        }

        function switchToPlain(silent) {
            if (!silent && !state.plainOnly) {
                textArea.value = editorPlainText();
            } else if (silent && editorDoc) {
                textArea.value = editorDoc.body.innerText;
            }
            state.plainOnly = true;
            frame.classList.add("hidden");
            formatBar.classList.add("hidden");
            imageButton.disabled = true;
            textArea.classList.remove("hidden");
            renderBadges();
        }

        function switchToRich() {
            if (editorDoc) {
                editorDoc.body.innerHTML = textToHTML(textArea.value);
            }
            state.plainOnly = false;
            textArea.classList.add("hidden");
            frame.classList.remove("hidden");
            formatBar.classList.remove("hidden");
            imageButton.disabled = false;
            renderBadges();
        }

        /* Images */
        function insertImageFile(file) {
            if (!file || file.type.indexOf("image/") !== 0) {
                return;
            }
            if (file.size > 4 * 1024 * 1024) {
                //Very large pictures go as attachments instead of inline
                addLocalFiles([file]);
                return;
            }
            var reader = new FileReader();
            reader.onload = function () {
                exec("insertImage", reader.result);
            };
            reader.readAsDataURL(file);
        }
        imageButton.addEventListener("click", function () { imageInput.click(); });
        imageInput.addEventListener("change", function () {
            Array.prototype.forEach.call(imageInput.files, insertImageFile);
            imageInput.value = "";
        });

        function handlePaste(event) {
            var items = (event.clipboardData && event.clipboardData.items) || [];
            var images = [];
            Array.prototype.forEach.call(items, function (item) {
                if (item.kind === "file" && item.type.indexOf("image/") === 0) {
                    images.push(item.getAsFile());
                }
            });
            if (images.length > 0) {
                event.preventDefault();
                images.forEach(insertImageFile);
            }
        }

        /* Attachments */
        function attachmentFromOptions(item) {
            return {
                id: util.randomId(), kind: item.kind, name: item.name, size: item.size || 0,
                path: item.path || "", part: item.kind === "part" ? {
                    accountId: item.accountId, folder: item.folder, uid: item.uid, partId: item.partId
                } : null, progress: 100, error: ""
            };
        }
        (options.attachments || []).forEach(function (item) { state.attachments.push(attachmentFromOptions(item)); });

        function renderAttachments() {
            util.clear(attachmentList);
            state.attachments.forEach(function (attachment) {
                var kind = util.fileIcon("", attachment.name);
                var chip = el("div", { class: "att-chip" + (attachment.error ? " error" : ""), title: attachment.error || attachment.name }, [
                    icon(attachment.error ? "exclamation circle" : kind.icon),
                    el("span", { class: "nm", text: attachment.name }),
                    attachment.size ? el("span", { class: "sz", text: util.formatSize(attachment.size) }) : null,
                    el("button", {
                        type: "button", title: "Remove attachment", on: {
                            click: function () {
                                state.attachments = state.attachments.filter(function (item) { return item !== attachment; });
                                if (attachment.xhrAbort) {
                                    attachment.xhrAbort();
                                }
                                renderAttachments();
                                markDirty();
                            }
                        }
                    }, icon("close"))
                ]);
                if (attachment.progress < 100 && !attachment.error) {
                    chip.appendChild(el("div", { class: "bar", style: { width: attachment.progress + "%" } }));
                }
                attachmentList.appendChild(chip);
            });
        }

        function ensureTempFolder() {
            if (state.tempFolder) {
                return Promise.resolve(state.tempFolder);
            }
            return api.files("tempFolder", { purpose: "uploads" }).then(function (folder) {
                state.tempFolder = folder;
                return folder;
            });
        }

        function addLocalFiles(files) {
            Array.prototype.forEach.call(files, function (file) {
                var attachment = {
                    id: util.randomId(), kind: "file", name: file.name, size: file.size, path: "",
                    part: null, progress: 0, error: ""
                };
                state.attachments.push(attachment);
                renderAttachments();
                markDirty();
                ensureTempFolder().then(function (folder) {
                    var target = folder + "/" + (++state.uploadCounter);
                    var xhr = uploadFile(file, target, function (percent) {
                        attachment.progress = Math.min(99, Math.round(percent));
                        renderAttachments();
                    }, function () {
                        attachment.progress = 100;
                        attachment.path = target + "/" + file.name.replace(/%/g, "_");
                        renderAttachments();
                    }, function (message) {
                        attachment.error = message || "Upload failed";
                        renderAttachments();
                    });
                    attachment.xhrAbort = function () { xhr.abort(); };
                }).catch(function (error) {
                    attachment.error = error.message;
                    renderAttachments();
                });
            });
        }

        function uploadFile(file, targetFolder, onProgress, onDone, onFail) {
            var form = new FormData();
            form.append("file", file);
            form.append("path", targetFolder);
            var xhr = new XMLHttpRequest();
            xhr.open("POST", (typeof ao_root === "string" && ao_root ? ao_root : "../") + "system/file_system/upload", true);
            xhr.upload.addEventListener("progress", function (event) {
                if (event.lengthComputable) {
                    onProgress(event.loaded * 100 / event.total);
                }
            });
            xhr.addEventListener("load", function () {
                var failed = xhr.status !== 200;
                try {
                    var response = JSON.parse(xhr.responseText);
                    if (response && response.error) {
                        failed = true;
                        onFail(response.error);
                        return;
                    }
                } catch (e) { /* plain "ok" */ }
                if (failed) {
                    onFail("Upload failed (" + xhr.status + ")");
                } else {
                    onDone();
                }
            });
            xhr.addEventListener("error", function () { onFail("Upload failed"); });
            xhr.send(form);
            return xhr;
        }

        attachButton.addEventListener("click", function () { fileInput.click(); });
        fileInput.addEventListener("change", function () {
            addLocalFiles(fileInput.files);
            fileInput.value = "";
        });
        arozButton.addEventListener("click", function () {
            if (typeof ao_module_openFileSelector !== "function") {
                ui.toast("The ArozOS file picker is not available here", { error: true });
                return;
            }
            ao_module_openFileSelector(function (files) {
                addArozFiles(files);
            }, "user:/", "file", true, { path_memory_key: "mail-attach" });
        });

        function addArozFiles(files) {
            (files || []).forEach(function (file) {
                if (!file || !file.filepath) {
                    return;
                }
                state.attachments.push({
                    id: util.randomId(), kind: "file", name: file.filename || file.filepath.split("/").pop(),
                    size: 0, path: file.filepath, part: null, progress: 100, error: ""
                });
            });
            renderAttachments();
            markDirty();
        }

        function handleDragOver(event) {
            event.preventDefault();
            editorWrap.classList.add("dragover");
        }
        function handleDrop(event) {
            editorWrap.classList.remove("dragover");
            var transfer = event.dataTransfer;
            if (!transfer) {
                return;
            }
            var arozData = transfer.getData("filedata");
            if (arozData) {
                event.preventDefault();
                try {
                    addArozFiles(JSON.parse(arozData));
                } catch (e) { /* not ArozOS data */ }
                return;
            }
            if (transfer.files && transfer.files.length > 0) {
                event.preventDefault();
                var images = [];
                var others = [];
                Array.prototype.forEach.call(transfer.files, function (file) {
                    (file.type.indexOf("image/") === 0 && event.target !== root && !state.plainOnly && file.size < 4 * 1024 * 1024 ? images : others).push(file);
                });
                images.forEach(insertImageFile);
                addLocalFiles(others);
            }
        }
        root.addEventListener("dragover", handleDragOver);
        root.addEventListener("dragleave", function (event) {
            if (!root.contains(event.relatedTarget)) {
                editorWrap.classList.remove("dragover");
            }
        });
        root.addEventListener("drop", function (event) {
            //Files dropped on the form (not the editor) are always attachments
            editorWrap.classList.remove("dragover");
            var transfer = event.dataTransfer;
            if (!transfer) {
                return;
            }
            var arozData = transfer.getData("filedata");
            event.preventDefault();
            if (arozData) {
                try {
                    addArozFiles(JSON.parse(arozData));
                } catch (e) { /* ignore */ }
            } else if (transfer.files && transfer.files.length > 0) {
                addLocalFiles(transfer.files);
            }
        });
        renderAttachments();

        /* Options */
        function renderBadges() {
            util.clear(badges);
            if (state.priority === "high") {
                badges.appendChild(el("span", { class: "opt-badge" }, [icon("exclamation"), "High priority"]));
            } else if (state.priority === "low") {
                badges.appendChild(el("span", { class: "opt-badge" }, [icon("arrow down"), "Low priority"]));
            }
            if (state.readReceipt) {
                badges.appendChild(el("span", { class: "opt-badge" }, [icon("clipboard check"), "Receipt"]));
            }
            if (state.plainOnly) {
                badges.appendChild(el("span", { class: "opt-badge" }, [icon("font"), "Plain text"]));
            }
        }
        optionsButton.addEventListener("click", function () {
            ui.menu(optionsButton, [
                { title: "Priority" },
                { label: "High", icon: "exclamation", checked: state.priority === "high", onClick: function () { state.priority = "high"; renderBadges(); markDirty(); } },
                { label: "Normal", icon: "minus", checked: state.priority === "normal", onClick: function () { state.priority = "normal"; renderBadges(); markDirty(); } },
                { label: "Low", icon: "arrow down", checked: state.priority === "low", onClick: function () { state.priority = "low"; renderBadges(); markDirty(); } },
                "-",
                { label: state.readReceipt ? "Don't request a read receipt" : "Request a read receipt", icon: "clipboard check", onClick: function () { state.readReceipt = !state.readReceipt; renderBadges(); } },
                { label: state.plainOnly ? "Switch to rich text" : "Switch to plain text", icon: "font", onClick: function () { if (state.plainOnly) { switchToRich(); } else { switchToPlain(false); } markDirty(); } },
                "-",
                { label: "Save draft now", icon: "save outline", onClick: function () { saveDraft(true); } }
            ]);
        });
        renderBadges();

        /* Requests */
        function outgoingHTML() {
            var html = editorHTML();
            //Remote images the user never loaded still go to the recipient intact
            html = html.replace(/\sdata-remote-src=(["'])(.*?)\1/gi, function (match, quote, url) {
                return " src=" + quote + url + quote;
            });
            return '<div style="font-family:' + util.escapeHTML(font).replace(/&#39;/g, "'") + ";font-size:" + util.escapeHTML(fontSize) + ';">' + html + "</div>";
        }

        function buildRequest() {
            var files = [];
            var forwarded = [];
            //Files first, then server parts: the order the server writes them in,
            //which lets a draft save map them back to the new draft's parts
            state.attachments.forEach(function (attachment) {
                if (attachment.kind === "file" && attachment.path) {
                    files.push({ path: attachment.path, name: attachment.name });
                }
            });
            state.attachments.forEach(function (attachment) {
                if (attachment.kind === "part" && attachment.part) {
                    forwarded.push(attachment.part);
                }
            });
            var request = {
                accountId: state.accountId,
                to: toField.values(),
                cc: ccField.values(),
                bcc: bccField.values(),
                subject: subjectInput.value.trim(),
                html: state.plainOnly ? "" : outgoingHTML(),
                text: state.plainOnly ? textArea.value : "",
                plainOnly: state.plainOnly,
                priority: state.priority,
                readReceipt: state.readReceipt,
                inReplyTo: state.inReplyTo,
                references: state.references,
                replyMode: state.replyMode,
                originalFolder: state.originalFolder,
                originalUid: state.originalUid,
                draftFolder: state.draft ? state.draft.folder : "",
                draftUid: state.draft ? state.draft.uid : 0,
                files: files,
                forwarded: forwarded
            };
            return request;
        }

        function uploading() {
            return state.attachments.some(function (attachment) { return attachment.kind === "file" && !attachment.path && !attachment.error; });
        }

        function setStatus(text) {
            statusText.textContent = text || "";
        }

        /* Drafts */
        function saveDraft(manual) {
            if (state.saving || state.sending || state.closed) {
                return Promise.resolve(false);
            }
            if (uploading()) {
                if (manual) {
                    ui.toast("Wait for the uploads to finish before saving");
                }
                return Promise.resolve(false);
            }
            var request = buildRequest();
            var included = state.attachments.filter(function (attachment) {
                return (attachment.kind === "file" && attachment.path) || (attachment.kind === "part" && attachment.part);
            });
            var ordered = included.filter(function (attachment) { return attachment.kind === "file"; })
                .concat(included.filter(function (attachment) { return attachment.kind === "part"; }));
            state.saving = true;
            state.dirty = false;
            setStatus("Saving…");
            state.savePromise = api.compose("draft", { message: request }).then(function (result) {
                state.saving = false;
                state.draft = { folder: result.folder, uid: result.uid };
                //The attachments now live inside the new draft
                if (result.uid && result.attachments && result.attachments.length === ordered.length) {
                    ordered.forEach(function (attachment, index) {
                        var saved = result.attachments[index];
                        attachment.kind = "part";
                        attachment.path = "";
                        attachment.part = { accountId: state.accountId, folder: result.folder, uid: result.uid, partId: saved.id };
                    });
                }
                state.lastSaved = new Date();
                setStatus("Draft saved " + state.lastSaved.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
                if (context.onDraftChanged) {
                    context.onDraftChanged(state.accountId);
                }
                announce("draft-saved", {});
                return true;
            }).catch(function (error) {
                state.saving = false;
                state.dirty = true;
                setStatus("Draft not saved");
                if (manual) {
                    ui.errorToast(error, "Could not save the draft");
                }
                return false;
            });
            return state.savePromise;
        }

        //waitForSave settles an autosave that is still on its way, so a send
        //or discard acts on the newest draft instead of leaving a copy behind
        function waitForSave() {
            if (!state.saving || !state.savePromise) {
                return Promise.resolve();
            }
            return state.savePromise.then(function () { }, function () { });
        }

        //announce tells the other Mail windows (main window, lists) what happened
        function announce(type, data) {
            if (!Mail.shared) {
                return;
            }
            data = data || {};
            data.accountId = state.accountId;
            Mail.shared.emit(type, data);
        }

        var autosave = setInterval(function () {
            if (state.dirty && !state.closed && (toField.count() > 0 || subjectInput.value.trim() !== "" || editorPlainText().trim().length > 0)) {
                saveDraft(false);
            }
        }, AUTOSAVE_MS);

        /* Sending */
        function send(sendAt) {
            if (state.sending) {
                return;
            }
            if (uploading()) {
                ui.toast("Please wait for the attachments to finish uploading");
                return;
            }
            var failedUploads = state.attachments.filter(function (attachment) { return attachment.error; });
            if (failedUploads.length > 0) {
                ui.toast("Remove the attachments that failed to upload first", { error: true });
                return;
            }
            var request = buildRequest();
            var invalid = toField.invalid().concat(ccField.invalid(), bccField.invalid());
            if (invalid.length > 0) {
                ui.toast("\"" + (invalid[0].name || invalid[0].email) + "\" is not a valid email address", { error: true });
                return;
            }
            if (request.to.length + request.cc.length + request.bcc.length === 0) {
                ui.toast("Add at least one recipient", { error: true });
                toField.focus();
                return;
            }

            var checks = Promise.resolve(true);
            var text = state.plainOnly ? textArea.value : (editorDoc ? (editorDoc.body.innerText || "") : "");
            var ownText = text.split(/\n-{2,}\s*Forwarded message|\nOn .+ wrote:/)[0];
            if (state.attachments.length === 0 && ATTACHMENT_WORDS.test(ownText + " " + request.subject)) {
                checks = checks.then(function (ok) {
                    return ok && ui.confirm("Forgot an attachment?", "Your message mentions an attachment, but nothing is attached. Send it anyway?", { okLabel: "Send anyway" });
                });
            }
            if (request.subject === "") {
                checks = checks.then(function (ok) {
                    return ok && ui.confirm("Send without a subject?", "This message has no subject line.", { okLabel: "Send anyway" });
                });
            }
            checks.then(function (ok) {
                if (!ok) {
                    return;
                }
                state.sending = true;
                clearInterval(autosave);
                //An autosave still in flight would otherwise create a draft
                //the send does not know about, left behind once delivered
                return waitForSave().then(function () {
                    var undoSeconds = context.settings().undoSendSeconds || 0;
                    request = buildRequest();
                    request.undoSeconds = sendAt ? 0 : undoSeconds;
                    request.sendAt = sendAt || 0;
                    deliver(request, sendAt, undoSeconds);
                });
            });
        }

        function restartAutosave() {
            clearInterval(autosave);
            autosave = setInterval(function () {
                if (state.dirty && !state.closed) {
                    saveDraft(false);
                }
            }, AUTOSAVE_MS);
        }

        //deliver hands the message to the server and reports the outcome
        function deliver(request, sendAt, undoSeconds) {
            var snapshot = self.snapshot(request);
            if (windowMode) {
                deliverInWindow(request, sendAt, undoSeconds);
                return;
            }
            hide();
            var progress = ui.toast(sendAt ? "Scheduling…" : "Sending…", { duration: 0 });

            track(api.compose("send", { message: request }).then(function (result) {
                progress.close();
                destroy();
                announce("sent", { queued: result.queued === true, sendAt: result.sendAt || 0, outboxId: result.outboxId || "" });
                if (context.onSent) {
                    context.onSent(result, request);
                }
                if (result.queued) {
                    var label = sendAt ? "Scheduled for " + util.formatFullDate(result.sendAt) : "Message sent";
                    ui.toast(label, {
                        duration: sendAt ? 8000 : Math.max(3000, (undoSeconds - 1) * 1000),
                        action: {
                            label: "Undo", fn: function () {
                                api.compose("outboxCancel", { id: result.outboxId, toDrafts: false }).then(function () {
                                    ui.toast(sendAt ? "Scheduled message cancelled" : "Sending cancelled");
                                    openHere(snapshot);
                                    announce("send-cancelled", {});
                                    if (context.onSent) {
                                        context.onSent(null, null);
                                    }
                                }).catch(function (error) {
                                    ui.errorToast(error, "Too late to undo");
                                });
                            }
                        }
                    });
                } else if (result.warning) {
                    ui.toast("Message sent. " + result.warning, { duration: 9000 });
                } else {
                    ui.toast("Message sent");
                }
            }).catch(function (error) {
                progress.close();
                sendFailed(error);
            }));
        }

        //track remembers the send request on its way, handlers included.
        //Closing the window waits for it: closing earlier would abort the
        //request and leave it unknown whether the message went out.
        function track(chain) {
            state.inFlight = chain;
            chain.then(function () {
                if (state.inFlight === chain) {
                    state.inFlight = null;
                }
            });
        }

        function sendFailed(error) {
            state.sending = false;
            show();
            restartAutosave();
            ui.errorToast(error, "Not sent");
            if (error.authFailed && context.onAuthFailed) {
                context.onAuthFailed(state.accountId, error);
            }
        }

        //deliverInWindow sends from a composer window. The window stays open
        //through the undo period, showing a countdown, and then closes itself.
        //Closing it early is fine: the server outbox delivers regardless.
        function deliverInWindow(request, sendAt, undoSeconds) {
            var overlay = el("div", { class: "sent-overlay" });
            var spinner = el("div", { class: "spinner large" });
            var heading = el("div", { class: "heading", text: sendAt ? "Scheduling…" : "Sending…" });
            var detail = el("div", { class: "detail" });
            var actions = el("div", { class: "actions" });
            overlay.appendChild(el("div", { class: "card" }, [spinner, heading, detail, actions]));
            root.appendChild(overlay);
            var timer = null;

            var finish = function () {
                clearInterval(timer);
                state.closed = true;
                if (context.closeWindow) {
                    context.closeWindow();
                }
            };

            track(api.compose("send", { message: request }).then(function (result) {
                announce("sent", { queued: result.queued === true, sendAt: result.sendAt || 0, outboxId: result.outboxId || "" });
                if (context.onSent) {
                    context.onSent(result, request);
                }
                spinner.remove();
                overlay.querySelector(".card").insertBefore(icon(result.queued && sendAt ? "clock outline" : "paper plane outline", "big-icon"), heading);
                util.clear(actions);
                if (!result.queued) {
                    heading.textContent = "Message sent";
                    detail.textContent = result.warning || "";
                    setTimeout(finish, result.warning ? 4000 : 900);
                    return;
                }

                var undo = el("button", { class: "btn", text: sendAt ? "Cancel and edit" : "Undo" });
                var close = el("button", { class: "btn primary", text: "Close" });
                actions.appendChild(undo);
                actions.appendChild(close);
                close.addEventListener("click", finish);
                undo.addEventListener("click", function () {
                    clearInterval(timer);
                    undo.disabled = true;
                    api.compose("outboxCancel", { id: result.outboxId, toDrafts: false }).then(function () {
                        overlay.remove();
                        state.sending = false;
                        restartAutosave();
                        announce("send-cancelled", {});
                        ui.toast(sendAt ? "Scheduled message cancelled" : "Sending cancelled");
                    }).catch(function (error) {
                        undo.disabled = false;
                        ui.errorToast(error, "Too late to undo");
                    });
                });

                if (sendAt) {
                    heading.textContent = "Scheduled";
                    detail.textContent = "It will be sent " + util.formatFullDate(result.sendAt) + ".";
                    return;
                }
                var remaining = Math.max(1, Math.round((result.sendAt - Date.now()) / 1000));
                var tick = function () {
                    heading.textContent = "Sending in " + remaining + "s";
                    detail.textContent = "You can still undo.";
                    if (remaining <= 0) {
                        heading.textContent = "Message sent";
                        detail.textContent = "";
                        undo.disabled = true;
                        clearInterval(timer);
                        setTimeout(finish, 600);
                    }
                    remaining--;
                };
                tick();
                timer = setInterval(tick, 1000);
            }).catch(function (error) {
                overlay.remove();
                sendFailed(error);
            }));
        }

        //snapshot captures everything needed to reopen this message after an undo
        self.snapshot = function (request) {
            return {
                accountId: request.accountId, to: request.to, cc: request.cc, bcc: request.bcc,
                subject: request.subject, html: state.plainOnly ? "" : editorHTML(), noSignature: true,
                plainOnly: state.plainOnly, plainText: state.plainOnly ? textArea.value : "",
                inReplyTo: state.inReplyTo, references: state.references, replyMode: state.replyMode,
                originalFolder: state.originalFolder, originalUid: state.originalUid, priority: state.priority,
                draft: state.draft,
                attachments: state.attachments.filter(function (attachment) { return !attachment.error; }).map(function (attachment) {
                    return attachment.kind === "part" ? {
                        kind: "part", accountId: attachment.part.accountId, folder: attachment.part.folder, uid: attachment.part.uid,
                        partId: attachment.part.partId, name: attachment.name, size: attachment.size
                    } : { kind: "file", path: attachment.path, name: attachment.name, size: attachment.size };
                })
            };
        };
        sendButton.addEventListener("click", function () { send(0); });
        sendMore.addEventListener("click", function () {
            var items = [{ title: "Schedule send" }];
            ui.presetTimes().forEach(function (preset) {
                items.push({ label: preset.label, hint: preset.hint, icon: "clock outline", onClick: function () { send(preset.value); } });
            });
            items.push({
                label: "Pick date and time…", icon: "calendar alternate outline", onClick: function () {
                    ui.pickDateTime("Schedule send", null, "Schedule").then(function (value) {
                        if (value) {
                            send(value);
                        }
                    });
                }
            });
            ui.menu(sendMore, items);
        });

        function handleKeys(event) {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && context.settings().sendShortcut !== "none") {
                event.preventDefault();
                send(0);
            } else if ((event.ctrlKey || event.metaKey) && (event.key === "s" || event.key === "S")) {
                event.preventDefault();
                saveDraft(true);
            }
        }

        /* Window controls */
        function hide() {
            root.classList.add("hidden");
        }
        function show() {
            root.classList.remove("hidden");
        }
        function destroy() {
            state.closed = true;
            clearInterval(autosave);
            root.remove();
            if (current === self) {
                current = null;
            }
        }

        minimizeButton.addEventListener("click", function () {
            root.classList.toggle("minimized");
            root.classList.remove("maximized");
        });
        head.addEventListener("dblclick", function () {
            if (root.classList.contains("minimized")) {
                root.classList.remove("minimized");
            }
        });
        title.addEventListener("click", function () {
            if (root.classList.contains("minimized")) {
                root.classList.remove("minimized");
            }
        });
        maximizeButton.addEventListener("click", function () {
            root.classList.remove("minimized");
            root.classList.toggle("maximized");
        });

        function hasContent() {
            return toField.count() > 0 || ccField.count() > 0 || bccField.count() > 0 || subjectInput.value.trim() !== "" ||
                state.attachments.length > 0 || editorPlainText().replace(/\s+/g, "").length > 0;
        }

        //close saves a draft when there is something worth keeping. The
        //composer window calls it from ao_module_close before it closes.
        self.close = function () {
            if (state.inFlight) {
                return state.inFlight.then(function () { return self.close(); });
            }
            if (state.sending || state.closed) {
                return Promise.resolve(true);
            }
            if (state.saving) {
                return waitForSave().then(function () { return self.close(); });
            }
            if (state.dirty && hasContent()) {
                return saveDraft(true).then(function (saved) {
                    if (saved) {
                        destroy();
                        ui.toast("Draft saved");
                        return true;
                    }
                    return ui.confirm("Draft not saved", "The draft could not be saved. Close and lose this message?", { okLabel: "Close anyway", danger: true }).then(function (ok) {
                        if (ok) {
                            destroy();
                        }
                        return ok;
                    });
                });
            }
            destroy();
            return Promise.resolve(true);
        };
        closeButton.addEventListener("click", function () { self.close(); });

        discardButton.addEventListener("click", function () {
            var discard = function () {
                state.sending = true; //No autosave may start from here on
                clearInterval(autosave);
                waitForSave().then(function () {
                    var draft = state.draft;
                    destroy();
                    var removal = Promise.resolve();
                    if (draft && draft.uid) {
                        removal = api.compose("deleteDraft", { accountId: state.accountId, folder: draft.folder, uid: draft.uid }).then(function () {
                            if (context.onDraftChanged) {
                                context.onDraftChanged(state.accountId);
                            }
                            announce("draft-deleted", {});
                        }).catch(function () { /* draft may already be gone */ });
                    }
                    ui.toast("Message discarded");
                    //A window must outlive the request, or closing it aborts it
                    if (windowMode && context.closeWindow) {
                        removal.then(function () { context.closeWindow(); });
                    }
                });
            };
            if (hasContent()) {
                ui.confirm("Discard this message?", "The message and its saved draft will be deleted.", { okLabel: "Discard", danger: true }).then(function (ok) {
                    if (ok) {
                        discard();
                    }
                });
            } else {
                discard();
            }
        });

        //confirmReplace asks before another message replaces this one
        self.confirmReplace = function () {
            root.classList.remove("minimized");
            if (!hasContent()) {
                destroy();
                return Promise.resolve(true);
            }
            return ui.choice("You are writing another message", "Save the current message as a draft before starting a new one?", [
                { label: "Cancel", value: "cancel", left: true },
                { label: "Discard it", value: "discard", danger: true },
                { label: "Save draft", value: "save", primary: true }
            ]).then(function (answer) {
                if (answer === "save") {
                    return saveDraft(true).then(function (saved) {
                        if (saved) {
                            destroy();
                        }
                        return saved;
                    });
                }
                if (answer === "discard") {
                    destroy();
                    return true;
                }
                return false;
            });
        };

        self.focus = function () {
            root.classList.remove("minimized");
            focusInitial();
        };

        //unsavedDraft is what a browser tab tries to save when it is closed
        //without the composer's own close path (see compose.html)
        self.unsavedDraft = function () {
            if (state.sending || state.closed || !state.dirty || !hasContent() || uploading()) {
                return null;
            }
            return buildRequest();
        };
    }

    return {
        init: init,
        open: open,
        openHere: openHere,
        isOpen: isOpen,
        current: function () { return current; },
        newMessage: function (accountId) { return open({ accountId: accountId, focus: "to" }); },
        reply: function (message, all) { return open(replyOptions(message, all)); },
        forward: function (message, asAttachment) { return open(forwardOptions(message, asAttachment)); },
        editDraft: function (message) { return open(draftOptions(message)); },
        mailto: function (href, accountId) { return open(mailtoOptions(href, accountId)); },
        replyOptions: replyOptions,
        forwardOptions: forwardOptions,
        mailtoOptions: mailtoOptions
    };
})();
