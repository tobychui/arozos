/*
    reader.ui.js

    The small UI kit the PDF reader needs: inline SVG icons, menus with
    submenus, a modal and a prompt, toasts, and T() over locale/reader.json.

    This is a copy of the matching parts of Drive (Drive/js/icons.js, ui.js
    and i18n.js) so the PDF Viewer works on its own: apps never load files
    from each other, a user may have one app and not the other.
*/

(function (global) {
    "use strict";

    /* ------------------------------------------------------------------ */
    /*  Translations                                                       */
    /* ------------------------------------------------------------------ */
    var data = null;
    var lang = "en-us";

    function resolveLang() {
        var stored = null;
        try {
            stored = localStorage.getItem("global_language");
        } catch (e) {
            stored = null;
        }
        var l = (stored == null || stored == "default") ? navigator.language : stored;
        return String(l || "en-us").toLowerCase();
    }

    function table() {
        if (!data || !data.keys) {
            return null;
        }
        if (data.keys[lang]) {
            return data.keys[lang];
        }
        var base = lang.split("-")[0];
        if (base == "zh") {
            return data.keys[lang.indexOf("hans") >= 0 || lang.indexOf("cn") >= 0 || lang.indexOf("sg") >= 0 ? "zh-cn" : "zh-tw"] || null;
        }
        for (var k in data.keys) {
            if (k.split("-")[0] == base) {
                return data.keys[k];
            }
        }
        return null;
    }

    function T(key, fallback, vars) {
        var t = table();
        var text = (t && t.strings && t.strings[key] !== undefined) ? t.strings[key] : (fallback !== undefined ? fallback : key);
        if (vars) {
            Object.keys(vars).forEach(function (k) {
                text = text.split("{" + k + "}").join(vars[k]);
            });
        }
        return text;
    }

    function loadLocale() {
        lang = resolveLang();
        document.documentElement.setAttribute("lang", lang);
        return fetch("locale/reader.json?v=1.0", { credentials: "same-origin" }).then(function (r) {
            return r.ok ? r.json() : null;
        }).then(function (d) {
            data = d;
        }).catch(function () {
            data = null;
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Icons (24 x 24, stroked)                                           */
    /* ------------------------------------------------------------------ */
    var PAGE = '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>';

    function dots(points, r) {
        return points.map(function (p) {
            return '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="' + r + '" fill="currentColor" stroke="none"/>';
        }).join("");
    }

    var UI = {
        download: '<path d="M12 4v11"/><path d="M7.5 10.5 12 15l4.5-4.5"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
        plus: '<path d="M12 5v14M5 12h14"/>',
        minimize: '<path d="M5 12h14"/>',
        folderOpen: '<path d="M3 18V7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v1"/><path d="M3 18l2.5-6.5A1.5 1.5 0 0 1 7 10.5h13.2a1 1 0 0 1 .95 1.3L19 18.5a2 2 0 0 1-1.9 1.5H5a2 2 0 0 1-2-2z"/>',
        file: PAGE,
        doc: PAGE + '<path d="M8.5 12.5h7M8.5 16h7"/>',
        moreV: dots([[12, 5], [12, 12], [12, 19]], 1.5),
        chevronDown: '<path d="M6 9l6 6 6-6"/>',
        chevronUp: '<path d="M6 15l6-6 6 6"/>',
        chevronRight: '<path d="M9 6l6 6-6 6"/>',
        chevronLeft: '<path d="M15 6l-6 6 6 6"/>',
        panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/><path d="M17.5 8.5h1M17.5 11.5h1"/>',
        spread: '<rect x="2.5" y="5" width="8.5" height="14" rx="1.5"/><rect x="13" y="5" width="8.5" height="14" rx="1.5"/>',
        x: '<path d="M6 6l12 12M18 6 6 18"/>',
        check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
        search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.3-4.3"/>',
        newTab: '<rect x="3" y="7" width="14" height="14" rx="2"/><path d="M7 3h12a2 2 0 0 1 2 2v12"/><path d="M10 11v6M7 14h6"/>',
        lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
        keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M7 14.5h10"/>',
        rotate: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/>',
        printer: '<path d="M7 9V3.5h10V9"/><rect x="3.5" y="9" width="17" height="8" rx="2"/><path d="M7 14h10v6.5H7z"/><path d="M17.5 12h.01"/>',
        alert: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.5h.01"/>',
        info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5h.01"/>'
    };

    function I(name, opts) {
        opts = opts || {};
        var body = UI[name] || UI.file;
        var size = opts.size ? ' width="' + opts.size + '" height="' + opts.size + '"' : "";
        var cls = "ic" + (opts.cls ? " " + opts.cls : "");
        return '<svg class="' + cls + '"' + size + ' viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
            'stroke-width="' + (opts.stroke || 1.8) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            body + '</svg>';
    }

    //The red PDF file tile (32 x 32, filled)
    function fileIcon() {
        return '<svg class="ft ft-pdf" viewBox="0 0 32 32" aria-hidden="true">' +
            '<path d="M9 2.5h10.6L26.5 9.4V27a2.5 2.5 0 0 1-2.5 2.5H9A2.5 2.5 0 0 1 6.5 27V5A2.5 2.5 0 0 1 9 2.5z" fill="#ef4444"/>' +
            '<path d="M19.6 2.5 26.5 9.4h-5A1.9 1.9 0 0 1 19.6 7.5z" fill="#fff" opacity=".42"/>' +
            '<text x="16.5" y="23.4" text-anchor="middle" font-family="Segoe UI, Roboto, Helvetica, Arial, sans-serif" ' +
            'font-size="6.6" font-weight="700" fill="#fff" letter-spacing=".2">PDF</text></svg>';
    }

    /* ------------------------------------------------------------------ */
    /*  DOM and formatting                                                 */
    /* ------------------------------------------------------------------ */
    function esc(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
        });
    }

    function el(html) {
        var t = document.createElement("template");
        t.innerHTML = String(html).trim();
        return t.content.firstElementChild;
    }

    function fmtSize(bytes) {
        if (bytes == null || bytes < 0 || isNaN(bytes)) {
            return "-";
        }
        if (bytes < 1024) {
            return bytes + " B";
        }
        var units = ["KB", "MB", "GB", "TB", "PB"];
        var v = bytes / 1024;
        var i = 0;
        while (v >= 1024 && i < units.length - 1) {
            v /= 1024;
            i++;
        }
        return (v < 100 ? v.toFixed(1) : Math.round(v)) + " " + units[i];
    }

    function pad(n) {
        return (n < 10 ? "0" : "") + n;
    }

    function fmtDay(unix) {
        var d = new Date(unix * 1000);
        return d.getFullYear() + "/" + pad(d.getMonth() + 1) + "/" + pad(d.getDate());
    }

    function layer(id, cls) {
        var node = document.getElementById(id);
        if (!node) {
            node = document.createElement("div");
            node.id = id;
            if (cls) {
                node.className = cls;
            }
            document.body.appendChild(node);
        }
        return node;
    }

    /* ------------------------------------------------------------------ */
    /*  Toasts                                                             */
    /* ------------------------------------------------------------------ */
    function toast(message, opts) {
        opts = opts || {};
        var holder = layer("toastLayer", "toasts");
        var type = opts.type || "info";
        var icon = type == "error" ? "alert" : type == "success" ? "check" : "info";
        var node = el('<div class="toast ' + type + '" role="status">' + I(icon) + '<div class="msg">' + esc(message) + '</div></div>');
        var close = el('<button aria-label="' + esc(T("common/close", "Close")) + '">' + I("x") + '</button>');
        close.addEventListener("click", dismiss);
        node.appendChild(close);
        holder.appendChild(node);
        while (holder.children.length > 3) {
            holder.removeChild(holder.firstChild);
        }
        var timer = setTimeout(dismiss, opts.timeout || (type == "error" ? 6000 : 3500));
        function dismiss() {
            clearTimeout(timer);
            node.classList.add("leaving");
            setTimeout(function () { node.remove(); }, 220);
        }
        return dismiss;
    }

    function error(err) {
        toast(err && err.message ? err.message : String(err || "Error"), { type: "error" });
    }

    /* ------------------------------------------------------------------ */
    /*  Menus                                                              */
    /* ------------------------------------------------------------------ */
    var openMenus = [];
    var menuCloseHook = null;
    //Lowest edge the open menu and its submenus may reach (null: the viewport)
    var menuFloor = null;

    function closeMenus(depth) {
        depth = depth || 0;
        while (openMenus.length > depth) {
            openMenus.pop().remove();
        }
        if (depth == 0 && menuCloseHook) {
            var hook = menuCloseHook;
            menuCloseHook = null;
            hook();
        }
    }

    function placeAt(node, x, y, anchorRect) {
        layer("menuLayer").appendChild(node);
        var w = node.offsetWidth, h = node.offsetHeight;
        var vw = window.innerWidth, vh = window.innerHeight;
        if (anchorRect) {
            //Submenu: to the right, or to the left when there is no room
            x = anchorRect.right + 2;
            y = anchorRect.top - 6;
            if (x + w > vw - 8) {
                x = anchorRect.left - w - 2;
            }
        }
        if (x + w > vw - 8) {
            x = vw - w - 8;
        }
        var floor = menuFloor != null ? menuFloor : vh - 8;
        if (y + h > floor) {
            y = Math.max(8, floor - h);
        }
        node.style.left = Math.max(8, x) + "px";
        node.style.top = Math.max(8, y) + "px";
    }

    function buildMenu(items, depth) {
        var node = el('<div class="menu" role="menu"></div>');
        items.forEach(function (item) {
            if (!item) {
                return;
            }
            if (item === "-") {
                if (node.lastElementChild && !node.lastElementChild.classList.contains("menu-sep")) {
                    node.appendChild(el('<div class="menu-sep"></div>'));
                }
                return;
            }
            if (item.title) {
                node.appendChild(el('<div class="menu-title">' + esc(item.title) + '</div>'));
                return;
            }
            var iconHTML = item.checkable ? I("check", { cls: "check-mark" }) : (item.icon ? I(item.icon) : '<span style="width:18px"></span>');
            var btn = el('<button class="menu-item' + (item.checked ? " checked" : "") + '" role="menuitem">' +
                iconHTML + '<span class="label">' + esc(item.label) + '</span>' +
                (item.hint ? '<span class="hint">' + esc(item.hint) + '</span>' : "") +
                (item.submenu ? I("chevronRight", { cls: "sub-caret" }) : "") + '</button>');
            if (item.disabled) {
                btn.disabled = true;
            }
            if (item.submenu) {
                var openSub = function () {
                    closeMenus(depth + 1);
                    node.querySelectorAll(".menu-item.hover").forEach(function (b) { b.classList.remove("hover"); });
                    btn.classList.add("hover");
                    var subNode = buildMenu(typeof item.submenu === "function" ? item.submenu() : item.submenu, depth + 1);
                    openMenus.push(subNode);
                    placeAt(subNode, 0, 0, btn.getBoundingClientRect());
                };
                var hoverTimer = null;
                btn.addEventListener("mouseenter", function () { hoverTimer = setTimeout(openSub, 120); });
                btn.addEventListener("mouseleave", function () { clearTimeout(hoverTimer); });
                btn.addEventListener("click", function (e) {
                    e.stopPropagation();
                    openSub();
                });
            } else {
                btn.addEventListener("mouseenter", function () {
                    closeMenus(depth + 1);
                    node.querySelectorAll(".menu-item.hover").forEach(function (b) { b.classList.remove("hover"); });
                });
                btn.addEventListener("click", function (e) {
                    e.stopPropagation();
                    closeMenus(0);
                    if (item.action) {
                        item.action();
                    }
                });
            }
            node.appendChild(btn);
        });
        if (node.lastElementChild && node.lastElementChild.classList.contains("menu-sep")) {
            node.lastElementChild.remove();
        }
        node.addEventListener("contextmenu", function (e) { e.preventDefault(); });
        return node;
    }

    /*
        menu(position, items)
        position: {x, y} or {anchor: element, align: "start" | "end", above: bool | element}
    */
    function menu(position, items) {
        closeMenus(0);
        var node = buildMenu(items, 0);
        openMenus.push(node);
        menuFloor = null;
        if (position.anchor) {
            var r = position.anchor.getBoundingClientRect();
            layer("menuLayer").appendChild(node);
            var x = position.align == "end" ? r.right - node.offsetWidth : r.left;
            //above: true for the anchor itself, or an element to clear (a whole control bar)
            var top = position.above && position.above.getBoundingClientRect ? Math.min(r.top, position.above.getBoundingClientRect().top) : r.top;
            if (position.above && top - 6 - node.offsetHeight >= 8) {
                menuFloor = top - 6;
                placeAt(node, x, menuFloor - node.offsetHeight);
            } else {
                placeAt(node, x, r.bottom + 6);
            }
            position.anchor.setAttribute("aria-expanded", "true");
            menuCloseHook = function () {
                position.anchor.removeAttribute("aria-expanded");
            };
        } else {
            placeAt(node, position.x, position.y);
        }
        return node;
    }

    function menuKeyNav(e) {
        if (openMenus.length == 0) {
            return false;
        }
        var node = openMenus[openMenus.length - 1];
        var items = Array.prototype.slice.call(node.querySelectorAll(".menu-item:not(:disabled)"));
        var idx = items.indexOf(document.activeElement);
        if (e.key == "Escape") {
            closeMenus(openMenus.length > 1 ? openMenus.length - 1 : 0);
            return true;
        }
        if (e.key == "ArrowDown" || e.key == "ArrowUp") {
            var next = e.key == "ArrowDown" ? idx + 1 : idx - 1;
            if (next < 0) { next = items.length - 1; }
            if (next >= items.length) { next = 0; }
            if (items[next]) { items[next].focus(); }
            return true;
        }
        if (e.key == "ArrowRight" && idx >= 0 && items[idx].querySelector(".sub-caret")) {
            items[idx].click();
            return true;
        }
        if (e.key == "ArrowLeft" && openMenus.length > 1) {
            closeMenus(openMenus.length - 1);
            return true;
        }
        return false;
    }

    document.addEventListener("mousedown", function (e) {
        if (openMenus.length && !e.target.closest(".menu")) {
            closeMenus(0);
        }
    }, true);
    window.addEventListener("resize", function () { closeMenus(0); });
    window.addEventListener("blur", function () { closeMenus(0); });

    /* ------------------------------------------------------------------ */
    /*  Modal and prompt                                                   */
    /* ------------------------------------------------------------------ */
    var modalStack = [];

    /*
        modal({title, icon, body, buttons, onOpen(ctx), onClose})
        buttons: [{label, cls, action(ctx) -> false keeps it open}]
    */
    function modal(opts) {
        closeMenus(0);
        var backdrop = el('<div class="modal-backdrop"></div>');
        var box = el('<div class="modal" role="dialog" aria-modal="true"></div>');
        box.innerHTML = '<div class="modal-head">' + (opts.icon ? '<div class="head-icon">' + I(opts.icon) + '</div>' : "") +
            '<h3>' + esc(opts.title || "") + '</h3>' +
            '<button class="icon-btn" data-close aria-label="' + esc(T("common/close", "Close")) + '">' + I("x") + '</button></div>' +
            '<div class="modal-body"></div>';
        var body = box.querySelector(".modal-body");
        body.innerHTML = opts.body || "";
        var ctx = { node: box, body: body };
        if (opts.buttons && opts.buttons.length) {
            var foot = el('<div class="modal-foot"></div>');
            opts.buttons.forEach(function (b) {
                var btn = el('<button class="btn ' + (b.cls || "") + '">' + esc(b.label) + '</button>');
                btn.addEventListener("click", function () {
                    if ((b.action ? b.action(ctx) : undefined) !== false) {
                        close();
                    }
                });
                foot.appendChild(btn);
            });
            box.appendChild(foot);
        }
        backdrop.appendChild(box);
        layer("modalLayer").appendChild(backdrop);
        var closed = false;
        function close() {
            if (closed) {
                return;
            }
            closed = true;
            backdrop.remove();
            var i = modalStack.indexOf(entry);
            if (i >= 0) {
                modalStack.splice(i, 1);
            }
            if (opts.onClose) {
                opts.onClose();
            }
        }
        ctx.close = close;
        box.querySelector("[data-close]").addEventListener("click", close);
        backdrop.addEventListener("mousedown", function (e) {
            if (e.target === backdrop) {
                close();
            }
        });
        var entry = { close: close };
        modalStack.push(entry);
        if (opts.onOpen) {
            opts.onOpen(ctx);
        }
        setTimeout(function () {
            var f = box.querySelector("[autofocus]") || box.querySelector(".modal-foot .btn.primary");
            if (f) {
                f.focus();
            }
        }, 30);
        return ctx;
    }

    function topModal() {
        return modalStack.length ? modalStack[modalStack.length - 1] : null;
    }

    //prompt({title, label, icon, ok, password}) -> Promise<string | null>
    function prompt(opts) {
        return new Promise(function (resolve) {
            var answered = false;
            modal({
                title: opts.title,
                icon: opts.icon || "lock",
                body: '<div class="field"><label>' + esc(opts.label || "") + '</label>' +
                    '<input class="input" type="' + (opts.password ? "password" : "text") + '" autofocus spellcheck="false" autocomplete="off"></div>',
                buttons: [
                    { label: T("common/cancel", "Cancel") },
                    {
                        label: opts.ok || T("common/ok", "OK"), cls: "primary", action: function (ctx) {
                            var v = ctx.body.querySelector("input").value;
                            if (v == "") {
                                return false;
                            }
                            answered = true;
                            resolve(v);
                        }
                    }
                ],
                onOpen: function (ctx) {
                    ctx.body.querySelector("input").addEventListener("keydown", function (e) {
                        if (e.key == "Enter") {
                            e.preventDefault();
                            ctx.node.querySelector(".modal-foot .btn.primary").click();
                        }
                    });
                },
                onClose: function () {
                    if (!answered) {
                        resolve(null);
                    }
                }
            });
        });
    }

    global.T = T;
    global.ReaderUI = {
        I: I,
        el: el,
        esc: esc,
        fileIcon: fileIcon,
        fmtSize: fmtSize,
        fmtDay: fmtDay,
        toast: toast,
        error: error,
        menu: menu,
        closeMenus: closeMenus,
        menuOpen: function () { return openMenus.length > 0; },
        menuKeyNav: menuKeyNav,
        modal: modal,
        topModal: topModal,
        prompt: prompt,
        loadLocale: loadLocale
    };
})(window);
