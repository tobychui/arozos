/*
    Mail — message rendering

    HTML mail is shown in an iframe that is sandboxed without scripts, forms
    or top navigation, and carries a Content-Security-Policy that blocks every
    network load unless the user allowed remote content. The server already
    sanitised the HTML; the sandbox is the security boundary. The frame is
    same-origin only so its height can follow the content and links can be
    previewed and intercepted (mailto: opens the composer).
*/

var Mail = window.Mail || {};
window.Mail = Mail;

Mail.render = (function () {
    "use strict";
    var util = Mail.util;
    var el = util.el;
    var icon = util.icon;

    var FRAME_STYLE =
        "html{overflow-y:hidden;overflow-x:auto;}" +
        "body{margin:0;padding:18px 20px;background:#fff;color:#1d2433;" +
        "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue','Noto Sans','PingFang TC','Microsoft JhengHei',sans-serif;" +
        "font-size:14px;line-height:1.55;overflow-wrap:anywhere;}" +
        "img{max-width:100%;height:auto;}" +
        "img[data-remote-src]{display:inline-block;min-width:12px;min-height:12px;background:#eef1f6;}" +
        //Blocked tracking pixels would otherwise show up as small grey squares
        "img[data-remote-src][width='0'],img[data-remote-src][width='1'],img[data-remote-src][height='0'],img[data-remote-src][height='1']{display:none;}" +
        "pre{white-space:pre-wrap;}" +
        "blockquote{margin:0 0 0 6px;padding-left:12px;border-left:3px solid #d5dae3;color:#4a5466;}" +
        "a{color:#1f63d8;}";

    //frameDocument prepares the srcdoc of a sanitised HTML message
    function frameDocument(html, allowRemote) {
        var remote = allowRemote ? " https: http:" : "";
        var csp = "default-src 'none'; img-src data: blob:" + remote + "; style-src 'unsafe-inline'" + remote +
            "; font-src data:" + remote + "; media-src data:" + remote + "; script-src 'none'; form-action 'none'; frame-src 'none'";
        var injected = '<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' + csp + '">' +
            '<meta name="referrer" content="no-referrer"><base target="_blank"><style>' + FRAME_STYLE + "</style>";
        html = String(html || "");
        var headMatch = html.match(/<head[^>]*>/i);
        if (headMatch) {
            return html.replace(headMatch[0], headMatch[0] + injected);
        }
        return "<!DOCTYPE html><html><head>" + injected + "</head><body>" + html + "</body></html>";
    }

    //htmlFrame renders sanitised HTML into a self-sizing sandboxed iframe
    function htmlFrame(container, html, options) {
        options = options || {};
        var frame = el("iframe", {
            sandbox: "allow-same-origin allow-popups allow-popups-to-escape-sandbox",
            referrerpolicy: "no-referrer",
            title: "Message content"
        });
        var preview = el("div", { class: "link-preview hidden" });
        container.appendChild(frame);
        container.appendChild(preview);

        var observer = null;
        var lastHeight = -1;
        var ready = false;

        //contentHeight measures the content itself. The document and body
        //cannot be used: they are at least as tall as the frame (mail without
        //a doctype renders in quirks mode, where the body fills the viewport),
        //so measuring them feeds the frame's own height back and it creeps.
        var contentHeight = function (doc) {
            var body = doc.body;
            var view = doc.defaultView;
            var range = doc.createRange();
            range.selectNodeContents(body);
            var rect = range.getBoundingClientRect();
            if (!rect || (rect.height === 0 && rect.bottom === 0)) {
                return 60;
            }
            var style = view.getComputedStyle(body);
            var bottom = rect.bottom + view.scrollY + (parseFloat(style.paddingBottom) || 0) +
                (parseFloat(style.marginBottom) || 0) + (parseFloat(style.borderBottomWidth) || 0);
            //Room for the horizontal scroll bar of wide newsletters
            if (doc.documentElement.scrollWidth > doc.documentElement.clientWidth + 1) {
                bottom += 18;
            }
            return Math.max(60, Math.ceil(bottom));
        };

        var resize = function () {
            try {
                var doc = frame.contentDocument;
                if (!doc || !doc.body) {
                    return;
                }
                var height = contentHeight(doc);
                if (Math.abs(height - lastHeight) > 1) {
                    lastHeight = height;
                    frame.style.height = height + "px";
                }
                if (!ready) {
                    ready = true;
                    frame.style.visibility = "visible";
                    if (options.onReady) {
                        options.onReady();
                    }
                }
            } catch (e) { /* frame navigated away */ }
        };

        //Hidden and flat until measured, so nothing below it jumps around
        frame.style.height = "0px";
        frame.style.visibility = "hidden";

        frame.addEventListener("load", function () {
            var doc;
            try {
                doc = frame.contentDocument;
            } catch (e) {
                return;
            }
            if (!doc) {
                return;
            }
            resize();
            doc.querySelectorAll("img").forEach(function (image) {
                image.addEventListener("load", resize);
                image.addEventListener("error", resize);
            });
            if (window.ResizeObserver && doc.body) {
                observer = new ResizeObserver(resize);
                observer.observe(doc.body);
            }
            //Web fonts may still change the layout once
            if (doc.fonts && doc.fonts.ready) {
                doc.fonts.ready.then(resize).catch(function () { });
            }

            doc.addEventListener("click", function (event) {
                var link = event.target.closest ? event.target.closest("a[href]") : null;
                if (!link) {
                    return;
                }
                var href = link.getAttribute("href") || "";
                if (/^mailto:/i.test(href)) {
                    event.preventDefault();
                    if (options.onMailto) {
                        options.onMailto(href);
                    }
                } else if (href.charAt(0) === "#") {
                    event.preventDefault();
                    var target = doc.getElementById(href.slice(1)) || doc.querySelector('[name="' + CSS.escape(href.slice(1)) + '"]');
                    if (target) {
                        target.scrollIntoView();
                    }
                }
            });
            //Show where a link really goes, a basic phishing aid
            doc.addEventListener("mouseover", function (event) {
                var link = event.target.closest ? event.target.closest("a[href]") : null;
                if (link) {
                    preview.textContent = link.getAttribute("href");
                    preview.classList.remove("hidden");
                } else {
                    preview.classList.add("hidden");
                }
            });
            doc.addEventListener("mouseleave", function () { preview.classList.add("hidden"); });
        });
        frame.srcdoc = frameDocument(html, options.allowRemote);
        return {
            frame: frame,
            destroy: function () {
                if (observer) {
                    observer.disconnect();
                }
            }
        };
    }

    function plainBody(container, text, options) {
        var node = el("div", { class: "plain-body" });
        node.appendChild(util.linkifyText(text || "", options && options.onMailto ? function (address) {
            options.onMailto("mailto:" + address);
        } : null));
        container.appendChild(node);
    }

    //body renders a message's content (HTML or plain text)
    function body(container, message, options) {
        options = options || {};
        if (message.html) {
            return htmlFrame(container, message.html, {
                allowRemote: message.remoteAllowed,
                onMailto: options.onMailto,
                onReady: options.onReady
            });
        }
        if (message.text) {
            plainBody(container, message.text, options);
        } else {
            container.appendChild(el("div", { class: "muted", text: message.encrypted ? "This message is encrypted." : "This message has no text." }));
        }
        if (options.onReady) {
            options.onReady();
        }
        return null;
    }

    function addressSpan(address, onClick) {
        var span = el("span", { text: util.addressName(address), title: address.email });
        if (onClick) {
            span.style.cursor = "pointer";
            span.addEventListener("click", function () { onClick(address); });
        }
        return span;
    }

    function addressList(list, onClick) {
        var fragment = document.createDocumentFragment();
        (list || []).forEach(function (address, index) {
            if (index > 0) {
                fragment.appendChild(document.createTextNode(", "));
            }
            fragment.appendChild(addressSpan(address, onClick));
        });
        return fragment;
    }

    //header renders sender, recipients, date and quick actions
    function header(message, options) {
        options = options || {};
        var from = (message.from && message.from[0]) || { name: "", email: "" };
        var wrap = el("div", { class: "reader-head" });
        wrap.appendChild(util.avatar(from, "large"));

        var who = el("div", { class: "who" });
        var sender = el("div", { class: "sender" }, [
            el("span", { class: "name", text: from.name || from.email || "(unknown sender)" }),
            from.name ? el("span", { class: "addr", text: "<" + from.email + ">" }) : null
        ]);
        who.appendChild(sender);

        var recipients = el("div", { class: "recipients" });
        if (message.to && message.to.length > 0) {
            recipients.appendChild(document.createTextNode("To: "));
            recipients.appendChild(addressList(message.to.slice(0, 4), options.onAddress));
            if (message.to.length > 4) {
                recipients.appendChild(document.createTextNode(" and " + (message.to.length - 4) + " more"));
            }
        } else {
            recipients.appendChild(document.createTextNode("To: (undisclosed recipients)"));
        }
        var details = el("div", { class: "details" });
        var detailRow = function (label, content) {
            details.appendChild(el("div", {}, [el("b", { text: label }), content]));
        };
        detailRow("From:", document.createTextNode(util.addressFull(from)));
        if (message.replyTo && message.replyTo.length > 0) {
            detailRow("Reply-To:", document.createTextNode(message.replyTo.map(util.addressFull).join(", ")));
        }
        detailRow("To:", document.createTextNode((message.to || []).map(util.addressFull).join(", ") || "-"));
        if (message.cc && message.cc.length > 0) {
            detailRow("Cc:", document.createTextNode(message.cc.map(util.addressFull).join(", ")));
        }
        if (message.bcc && message.bcc.length > 0) {
            detailRow("Bcc:", document.createTextNode(message.bcc.map(util.addressFull).join(", ")));
        }
        detailRow("Date:", document.createTextNode(util.formatFullDate(message.date)));
        if (message.auth) {
            var verdicts = [];
            ["spf", "dkim", "dmarc"].forEach(function (key) {
                if (message.auth[key]) {
                    verdicts.push(key.toUpperCase() + " " + message.auth[key]);
                }
            });
            detailRow("Security:", document.createTextNode(verdicts.join(" · ")));
        }
        var toggle = el("span", { class: "toggle", title: "Show details" }, icon("caret down"));
        toggle.addEventListener("click", function () {
            details.classList.toggle("show");
            toggle.firstChild.className = details.classList.contains("show") ? "caret up icon" : "caret down icon";
        });
        if (message.cc && message.cc.length > 0) {
            recipients.appendChild(document.createTextNode(" · Cc: "));
            recipients.appendChild(addressList(message.cc.slice(0, 3), options.onAddress));
        }
        recipients.appendChild(toggle);
        who.appendChild(recipients);
        who.appendChild(details);
        wrap.appendChild(who);

        var meta = el("div", { class: "meta" }, [el("div", { class: "date", text: util.formatReaderDate(message.date), title: util.formatFullDate(message.date) })]);
        if (options.actions) {
            meta.appendChild(options.actions);
        }
        wrap.appendChild(meta);
        return wrap;
    }

    //notices explains blocked images, signatures and failed authentication
    function notices(message, handlers) {
        handlers = handlers || {};
        var wrap = el("div", { class: "reader-notices" });
        var add = function (kind, iconName, text, actions) {
            var content = el("div", { class: "grow" }, [el("div", { text: text })]);
            if (actions && actions.length > 0) {
                var row = el("div", { class: "actions" });
                actions.forEach(function (action) {
                    row.appendChild(el("button", { class: "btn small", text: action.label, on: { click: action.onClick } }));
                });
                content.appendChild(row);
            }
            wrap.appendChild(el("div", { class: "notice " + kind }, [icon(iconName), content]));
        };

        var auth = message.auth;
        if (auth && (auth.dmarc === "fail" || (auth.spf === "fail" && auth.dkim !== "pass"))) {
            add("danger", "exclamation triangle", "This message failed sender verification. It may not really be from " +
                (((message.from || [])[0] || {}).email || "the address shown") + ". Be careful with links and attachments.");
        }
        if (message.hasRemoteContent && !message.remoteAllowed) {
            var sender = ((message.from || [])[0] || {}).email || "";
            var actions = [{ label: "Load images", onClick: function () { if (handlers.loadRemote) { handlers.loadRemote(); } } }];
            if (sender && handlers.trustSender) {
                actions.push({ label: "Always load from " + sender, onClick: function () { handlers.trustSender(sender); } });
            }
            add("", "eye slash outline", "Images and other remote content are blocked to protect your privacy.", actions);
        }
        if (message.encrypted) {
            add("warning", "lock", "This message is encrypted (S/MIME or PGP) and cannot be read in ArozOS Mail.");
        } else if (message.signed) {
            add("success", "certificate", "This message is digitally signed.");
        }
        if (message.calendar) {
            add("", "calendar alternate outline", "This message contains a calendar invitation (.ics attachment).");
        }
        if (message.readReceiptTo) {
            add("", "info circle", "The sender asked for a read receipt. ArozOS Mail does not send receipts automatically.");
        }
        return wrap.childNodes.length > 0 ? wrap : null;
    }

    //attachments renders attachment cards. handlers: {open, save, download, saveAll}
    function attachments(list, handlers) {
        //The server already leaves out images embedded in the HTML body
        list = list || [];
        if (list.length === 0) {
            return null;
        }
        handlers = handlers || {};
        var total = list.reduce(function (sum, item) { return sum + (item.size || 0); }, 0);
        var wrap = el("div", { class: "attachments" });
        var head = el("div", { class: "head" }, [
            icon("paperclip"),
            el("span", { class: "grow", text: util.plural(list.length, "attachment") + " · " + util.formatSize(total) })
        ]);
        if (handlers.saveAll && list.length > 1) {
            head.appendChild(el("button", { class: "btn small", on: { click: function () { handlers.saveAll(list); } } }, [icon("folder open outline"), "Save all to ArozOS"]));
        }
        wrap.appendChild(head);

        var grid = el("div", { class: "attachment-grid" });
        list.forEach(function (attachment) {
            var kind = util.fileIcon(attachment.contentType, attachment.filename);
            var acts = el("div", { class: "acts" });
            if (handlers.open) {
                acts.appendChild(el("button", { class: "iconbtn small", title: "Open in ArozOS", on: { click: function () { handlers.open(attachment); } } }, icon("external alternate")));
            }
            if (handlers.save) {
                acts.appendChild(el("button", { class: "iconbtn small", title: "Save to ArozOS", on: { click: function () { handlers.save(attachment); } } }, icon("folder open outline")));
            }
            if (handlers.download) {
                acts.appendChild(el("button", { class: "iconbtn small", title: "Download", on: { click: function () { handlers.download(attachment); } } }, icon("download")));
            }
            var card = el("div", { class: "attachment", title: attachment.filename }, [
                el("i", { class: kind.icon + " icon ficon " + kind.kind }),
                el("div", { class: "info" }, [
                    el("div", { class: "name", text: attachment.filename }),
                    el("div", { class: "size", text: util.formatSize(attachment.size) })
                ]),
                acts
            ]);
            card.addEventListener("dblclick", function () {
                if (handlers.open) {
                    handlers.open(attachment);
                }
            });
            grid.appendChild(card);
        });
        wrap.appendChild(grid);
        return wrap;
    }

    return {
        frameDocument: frameDocument, htmlFrame: htmlFrame, body: body, header: header,
        notices: notices, attachments: attachments, addressList: addressList
    };
})();
