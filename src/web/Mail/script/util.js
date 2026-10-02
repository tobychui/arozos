/*
    Mail — utilities

    DOM building, formatting (dates, sizes, addresses), avatars, file icons,
    plain-text linkification and small storage helpers. Everything that puts
    server text on screen goes through textContent, never innerHTML.
*/

var Mail = window.Mail || {};
window.Mail = Mail;

Mail.util = (function () {
    "use strict";

    //el builds an element: el("div", {class: "x", text: "hi", on: {click: fn}}, [children])
    function el(tag, attrs, children) {
        var node = document.createElement(tag);
        attrs = attrs || {};
        Object.keys(attrs).forEach(function (key) {
            var value = attrs[key];
            if (value === undefined || value === null || value === false) {
                return;
            }
            if (key === "class") {
                node.className = value;
            } else if (key === "text") {
                node.textContent = value;
            } else if (key === "on") {
                Object.keys(value).forEach(function (eventName) {
                    node.addEventListener(eventName, value[eventName]);
                });
            } else if (key === "style" && typeof value === "object") {
                Object.keys(value).forEach(function (prop) {
                    if (prop.indexOf("--") === 0) {
                        node.style.setProperty(prop, value[prop]);
                    } else {
                        node.style[prop] = value[prop];
                    }
                });
            } else if (key === "dataset") {
                Object.keys(value).forEach(function (name) { node.dataset[name] = value[name]; });
            } else if (value === true) {
                node.setAttribute(key, "");
            } else {
                node.setAttribute(key, value);
            }
        });
        appendChildren(node, children);
        return node;
    }

    function appendChildren(node, children) {
        if (children === undefined || children === null) {
            return;
        }
        if (!Array.isArray(children)) {
            children = [children];
        }
        children.forEach(function (child) {
            if (child === null || child === undefined || child === false) {
                return;
            }
            if (typeof child === "string" || typeof child === "number") {
                node.appendChild(document.createTextNode(String(child)));
            } else {
                node.appendChild(child);
            }
        });
    }

    function icon(name, extraClass) {
        return el("i", { class: name + " icon" + (extraClass ? " " + extraClass : "") });
    }

    function clear(node) {
        while (node && node.firstChild) {
            node.removeChild(node.firstChild);
        }
        return node;
    }

    function escapeHTML(text) {
        return String(text === undefined || text === null ? "" : text)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    /* ---------- Dates ---------- */

    function startOfDay(date) {
        return new Date(date.getFullYear(), date.getMonth(), date.getDate());
    }

    //formatListDate gives the compact date of a list row: time today,
    //"Yesterday", the weekday within a week, then a date
    function formatListDate(ms) {
        if (!ms) {
            return "";
        }
        var date = new Date(ms);
        var now = new Date();
        var days = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
        if (days === 0) {
            return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        }
        if (days === 1) {
            return "Yesterday";
        }
        if (days > 1 && days < 7) {
            return date.toLocaleDateString([], { weekday: "short" });
        }
        if (date.getFullYear() === now.getFullYear()) {
            return date.toLocaleDateString([], { month: "short", day: "numeric" });
        }
        return date.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
    }

    function formatFullDate(ms) {
        if (!ms) {
            return "";
        }
        return new Date(ms).toLocaleString([], {
            weekday: "short", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
        });
    }

    //formatReaderDate is the time shown at the top right of the reading pane
    function formatReaderDate(ms) {
        if (!ms) {
            return "";
        }
        var date = new Date(ms);
        var now = new Date();
        if (startOfDay(date).getTime() === startOfDay(now).getTime()) {
            return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        }
        return formatFullDate(ms);
    }

    function formatSize(bytes) {
        if (!bytes || bytes < 0) {
            return "0 B";
        }
        var units = ["B", "KB", "MB", "GB"];
        var index = 0;
        var size = bytes;
        while (size >= 1024 && index < units.length - 1) {
            size /= 1024;
            index++;
        }
        return (index === 0 ? size : size.toFixed(size < 10 ? 1 : 0)) + " " + units[index];
    }

    /* ---------- Addresses and avatars ---------- */

    function addressName(address) {
        if (!address) {
            return "";
        }
        return address.name || address.email || "";
    }

    function addressFull(address) {
        if (!address) {
            return "";
        }
        if (address.name && address.name !== address.email) {
            return address.name + " <" + address.email + ">";
        }
        return address.email;
    }

    //formatAddressForInput produces an RFC 5322 mailbox the server accepts
    function formatAddressForInput(address) {
        if (!address || !address.email) {
            return "";
        }
        if (!address.name || address.name === address.email) {
            return address.email;
        }
        var name = address.name;
        if (/[",;<>@()\[\]:\\.]/.test(name)) {
            name = '"' + name.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
        }
        return name + " <" + address.email + ">";
    }

    var EMAIL_PATTERN = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

    function isValidEmail(value) {
        return EMAIL_PATTERN.test(String(value || "").trim());
    }

    //parseAddress splits "Name <a@b>" / "a@b" into {name, email}
    function parseAddress(text) {
        text = String(text || "").trim();
        if (text === "") {
            return null;
        }
        var match = text.match(/^\s*"?([^"<]*?)"?\s*<\s*([^>\s]+)\s*>\s*$/);
        if (match) {
            return { name: match[1].trim(), email: match[2].trim() };
        }
        return { name: "", email: text.replace(/^mailto:/i, "") };
    }

    //splitAddresses breaks a pasted list on commas / semicolons / new lines
    //outside quotes and angle brackets
    function splitAddresses(text) {
        var parts = [];
        var current = "";
        var inQuotes = false;
        var inAngle = false;
        String(text || "").split("").forEach(function (ch) {
            if (ch === '"') {
                inQuotes = !inQuotes;
            } else if (ch === "<" && !inQuotes) {
                inAngle = true;
            } else if (ch === ">" && !inQuotes) {
                inAngle = false;
            }
            if ((ch === "," || ch === ";" || ch === "\n") && !inQuotes && !inAngle) {
                parts.push(current);
                current = "";
                return;
            }
            current += ch;
        });
        parts.push(current);
        return parts.map(function (part) { return part.trim(); }).filter(function (part) { return part !== ""; });
    }

    var AVATAR_COLORS = ["#7c8ea6", "#5b8def", "#9b7be0", "#e0729a", "#e48a54", "#3fae8c", "#4aa3c3", "#c79a3b", "#8a9a5b", "#d26a6a", "#6f7bd9", "#58a55c"];

    function hashString(text) {
        var hash = 0;
        text = String(text || "");
        for (var i = 0; i < text.length; i++) {
            hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
        }
        return Math.abs(hash);
    }

    function initials(address) {
        var name = String((address && (address.name || address.email)) || "?").trim();
        if (address && !address.name && address.email) {
            name = address.email.split("@")[0];
        }
        name = name.replace(/["'()\[\]]/g, "").trim();
        var words = name.split(/[\s._-]+/).filter(function (word) { return word.length > 0; });
        if (words.length === 0) {
            return "?";
        }
        if (words.length === 1) {
            return Array.from(words[0])[0].toUpperCase();
        }
        return (Array.from(words[0])[0] + Array.from(words[words.length - 1])[0]).toUpperCase();
    }

    function avatar(address, size) {
        var key = address ? (address.email || address.name || "") : "";
        return el("span", {
            class: "avatar" + (size ? " " + size : ""),
            style: { "--avatar": AVATAR_COLORS[hashString(key.toLowerCase()) % AVATAR_COLORS.length] },
            text: initials(address),
            "aria-hidden": "true"
        });
    }

    /* ---------- Files ---------- */

    function fileIcon(contentType, filename) {
        var type = String(contentType || "").toLowerCase();
        var ext = String(filename || "").toLowerCase().split(".").pop();
        if (type === "application/pdf" || ext === "pdf") return { icon: "file pdf outline", kind: "pdf" };
        if (type.indexOf("image/") === 0) return { icon: "file image outline", kind: "image" };
        if (type.indexOf("audio/") === 0) return { icon: "file audio outline", kind: "audio" };
        if (type.indexOf("video/") === 0) return { icon: "file video outline", kind: "video" };
        if (["doc", "docx", "odt", "rtf"].indexOf(ext) >= 0 || type.indexOf("wordprocessing") >= 0) return { icon: "file word outline", kind: "word" };
        if (["xls", "xlsx", "ods", "csv"].indexOf(ext) >= 0 || type.indexOf("spreadsheet") >= 0) return { icon: "file excel outline", kind: "excel" };
        if (["ppt", "pptx", "odp"].indexOf(ext) >= 0 || type.indexOf("presentation") >= 0) return { icon: "file powerpoint outline", kind: "powerpoint" };
        if (["zip", "7z", "rar", "gz", "tar", "bz2", "xz"].indexOf(ext) >= 0 || type.indexOf("zip") >= 0) return { icon: "file archive outline", kind: "archive" };
        if (ext === "ics" || type === "text/calendar") return { icon: "calendar alternate outline", kind: "calendar" };
        if (ext === "eml" || type === "message/rfc822") return { icon: "envelope outline", kind: "mail" };
        if (["js", "json", "html", "css", "go", "py", "xml", "sh", "c", "cpp", "java", "ts"].indexOf(ext) >= 0) return { icon: "file code outline", kind: "code" };
        if (type.indexOf("text/") === 0 || ext === "txt" || ext === "md") return { icon: "file alternate outline", kind: "text" };
        return { icon: "file outline", kind: "file" };
    }

    /* ---------- Plain text ---------- */

    var LINK_PATTERN = /((?:https?:\/\/|www\.)[^\s<>"']+[^\s<>"'.,;:!?)\]}])|([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

    //linkifyText renders plain text with clickable links, e-mail addresses
    //and dimmed quoted lines
    function linkifyText(text, onMailto) {
        var fragment = document.createDocumentFragment();
        var lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
        var isQuoteLine = function (line) { return /^\s*>/.test(line || ""); };
        var quoteBlock = null;

        lines.forEach(function (line, index) {
            var target = fragment;
            if (isQuoteLine(line)) {
                //Consecutive quoted lines share one block
                if (quoteBlock === null) {
                    quoteBlock = el("span", { class: "quote" });
                    fragment.appendChild(quoteBlock);
                } else {
                    quoteBlock.appendChild(document.createTextNode("\n"));
                }
                target = quoteBlock;
            } else {
                quoteBlock = null;
            }
            appendLinkified(target, line, onMailto);

            //A block element starts its own line, so no newline before one
            var next = lines[index + 1];
            if (target === fragment && next !== undefined && !isQuoteLine(next)) {
                fragment.appendChild(document.createTextNode("\n"));
            }
        });
        return fragment;
    }

    function appendLinkified(target, line, onMailto) {
        var lastIndex = 0;
        var match;
        LINK_PATTERN.lastIndex = 0;
        while ((match = LINK_PATTERN.exec(line)) !== null) {
            if (match.index > lastIndex) {
                target.appendChild(document.createTextNode(line.slice(lastIndex, match.index)));
            }
            if (match[1]) {
                var href = match[1].indexOf("www.") === 0 ? "https://" + match[1] : match[1];
                target.appendChild(el("a", { href: href, target: "_blank", rel: "noopener noreferrer", text: match[1] }));
            } else {
                target.appendChild(el("a", {
                    href: "mailto:" + match[2], text: match[2],
                    on: {
                        click: function (event) {
                            if (onMailto) {
                                event.preventDefault();
                                onMailto(event.currentTarget.textContent);
                            }
                        }
                    }
                }));
            }
            lastIndex = match.index + match[0].length;
        }
        if (lastIndex < line.length) {
            target.appendChild(document.createTextNode(line.slice(lastIndex)));
        }
    }

    /* ---------- Misc ---------- */

    function debounce(fn, wait) {
        var timer = null;
        return function () {
            var args = arguments;
            var self = this;
            clearTimeout(timer);
            timer = setTimeout(function () { fn.apply(self, args); }, wait);
        };
    }

    //store keeps small per-user UI state in localStorage, failing quietly
    var storePrefix = "aroz-mail:";
    var store = {
        setUser: function (username) { storePrefix = "aroz-mail:" + username + ":"; },
        get: function (key, fallback) {
            try {
                var raw = localStorage.getItem(storePrefix + key);
                return raw === null ? fallback : JSON.parse(raw);
            } catch (e) {
                return fallback;
            }
        },
        set: function (key, value) {
            try {
                localStorage.setItem(storePrefix + key, JSON.stringify(value));
            } catch (e) { /* storage full or disabled */ }
        }
    };

    function messageKey(message) {
        return message.accountId + "|" + message.folder + "|" + message.uid;
    }

    function plural(count, word, pluralWord) {
        return count + " " + (count === 1 ? word : (pluralWord || word + "s"));
    }

    function randomId() {
        return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    }

    return {
        el: el, icon: icon, clear: clear, appendChildren: appendChildren, escapeHTML: escapeHTML,
        formatListDate: formatListDate, formatFullDate: formatFullDate, formatReaderDate: formatReaderDate,
        formatSize: formatSize, addressName: addressName, addressFull: addressFull,
        formatAddressForInput: formatAddressForInput, isValidEmail: isValidEmail, parseAddress: parseAddress,
        splitAddresses: splitAddresses, avatar: avatar, initials: initials, hashString: hashString,
        fileIcon: fileIcon, linkifyText: linkifyText, debounce: debounce, store: store,
        messageKey: messageKey, plural: plural, randomId: randomId
    };
})();
