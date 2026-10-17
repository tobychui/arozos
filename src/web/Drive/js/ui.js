/*
    ui.js

    Generic interface pieces shared by every view: formatting helpers,
    toasts, menus (with submenus), popovers, modals, confirm / prompt, and
    the in-page folder picker used by Move to and Copy to. None of them
    open a browser window.
*/

(function (global) {
    "use strict";

    var I = function (name, opts) { return DriveIcons.ui(name, opts); };

    function esc(str) {
        return String(str == null ? "" : str)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;")
            .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    function el(html) {
        var t = document.createElement("template");
        t.innerHTML = html.trim();
        return t.content.firstElementChild;
    }

    /* ------------------------------------------------------------------ */
    /*  Formatting                                                         */
    /* ------------------------------------------------------------------ */
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
        return (v < 10 ? v.toFixed(1) : v < 100 ? v.toFixed(1) : Math.round(v)) + " " + units[i];
    }

    function fmtExact(bytes) {
        try {
            return Number(bytes).toLocaleString(DriveI18n.locale()) + " " + T("unit/bytes", "bytes");
        } catch (e) {
            return bytes + " bytes";
        }
    }

    function pad(n) {
        return (n < 10 ? "0" : "") + n;
    }

    function fmtDate(unix) {
        if (!unix) {
            return "-";
        }
        var d = new Date(unix * 1000);
        return d.getFullYear() + "/" + pad(d.getMonth() + 1) + "/" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
    }

    function fmtDay(unix) {
        var d = new Date(unix * 1000);
        return d.getFullYear() + "/" + pad(d.getMonth() + 1) + "/" + pad(d.getDate());
    }

    function fmtRelative(unix) {
        if (!unix) {
            return "-";
        }
        var diff = Math.floor(Date.now() / 1000) - unix;
        if (diff < -60) {
            var ahead = -diff;
            if (ahead < 3600) {
                return T("time/inMinutes", "In {n} min", { n: Math.ceil(ahead / 60) });
            }
            if (ahead < 86400) {
                return T("time/inHours", "In {n} h", { n: Math.round(ahead / 3600) });
            }
            return T("time/inDays", "In {n} d", { n: Math.round(ahead / 86400) });
        }
        if (diff < 60) {
            return T("time/justNow", "Just now");
        }
        if (diff < 3600) {
            return T("time/minutes", "{n} min ago", { n: Math.floor(diff / 60) });
        }
        if (diff < 86400) {
            return T("time/hours", "{n} h ago", { n: Math.floor(diff / 3600) });
        }
        if (diff < 86400 * 7) {
            return T("time/days", "{n} d ago", { n: Math.floor(diff / 86400) });
        }
        return fmtDay(unix);
    }

    /* ------------------------------------------------------------------ */
    /*  Toasts                                                             */
    /* ------------------------------------------------------------------ */
    function toast(message, opts) {
        opts = opts || {};
        var layer = document.getElementById("toastLayer");
        var type = opts.type || "info";
        var icon = type == "error" ? "alert" : type == "success" ? "check" : "info";
        var node = el('<div class="toast ' + type + '" role="status">' + I(icon) +
            '<div class="msg">' + esc(message) + '</div></div>');
        if (opts.action) {
            var btn = el('<button>' + esc(opts.action.label) + '</button>');
            btn.addEventListener("click", function () {
                opts.action.fn();
                dismiss();
            });
            node.appendChild(btn);
        }
        var close = el('<button aria-label="Close">' + I("x") + '</button>');
        close.addEventListener("click", dismiss);
        node.appendChild(close);
        layer.appendChild(node);
        while (layer.children.length > 3) {
            layer.removeChild(layer.firstChild);
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
        var msg = err && err.message ? err.message : String(err || T("err/unknown", "Something went wrong"));
        toast(T("srv/" + msg, msg), { type: "error" });
    }

    /* ------------------------------------------------------------------ */
    /*  Menus                                                              */
    /* ------------------------------------------------------------------ */
    var openMenus = [];
    var menuCloseHook = null;

    function closeMenus(depth) {
        depth = depth || 0;
        while (openMenus.length > depth) {
            var m = openMenus.pop();
            m.remove();
        }
        if (depth == 0 && menuCloseHook) {
            var hook = menuCloseHook;
            menuCloseHook = null;
            hook();
        }
    }

    //Lowest edge the open menu and its submenus may reach (null: the viewport)
    var menuFloor = null;

    function placeAt(node, x, y, anchorRect) {
        document.getElementById("menuLayer").appendChild(node);
        var w = node.offsetWidth, h = node.offsetHeight;
        var vw = window.innerWidth, vh = window.innerHeight;
        if (anchorRect) {
            //Submenu or dropdown: try right / below first, flip if needed
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
            var iconHTML = item.img ? '<img src="' + esc(item.img) + '" alt="">' :
                (item.checkable ? I("check", { cls: "check-mark" }) : (item.icon ? I(item.icon) : '<span style="width:18px"></span>'));
            var btn = el('<button class="menu-item' + (item.danger ? " danger" : "") + (item.checked ? " checked" : "") + '" role="menuitem">' +
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
                    Promise.resolve(typeof item.submenu === "function" ? item.submenu() : item.submenu).then(function (sub) {
                        if (openMenus[depth] !== node) {
                            return;
                        }
                        if (!sub || sub.length == 0) {
                            sub = [{ label: T("menu/nothing", "Nothing here"), disabled: true }];
                        }
                        var subNode = buildMenu(sub, depth + 1);
                        openMenus.push(subNode);
                        placeAt(subNode, 0, 0, btn.getBoundingClientRect());
                    });
                };
                var hoverTimer = null;
                btn.addEventListener("mouseenter", function () {
                    hoverTimer = setTimeout(openSub, 120);
                });
                btn.addEventListener("mouseleave", function () {
                    clearTimeout(hoverTimer);
                });
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
        menu(position, items, opts)
        position: {x, y} or {anchor: element, align: "start" | "end", above: bool | element}
        above opens the menu over its anchor and keeps the submenus above it
        too, for anchors in a bar along the bottom (the video controls).
    */
    function menu(position, items, opts) {
        closeMenus(0);
        closePopover();
        opts = opts || {};
        var node = buildMenu(items, 0);
        openMenus.push(node);
        menuFloor = null;
        if (position.anchor) {
            var r = position.anchor.getBoundingClientRect();
            document.getElementById("menuLayer").appendChild(node);
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
                if (opts.onClose) {
                    opts.onClose();
                }
            };
        } else {
            placeAt(node, position.x, position.y);
            menuCloseHook = opts.onClose || null;
        }
        var first = node.querySelector(".menu-item:not(:disabled)");
        if (first && opts.focus) {
            first.focus();
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
            if (openMenus.length > 1) {
                closeMenus(openMenus.length - 1);
            } else {
                closeMenus(0);
            }
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
            setTimeout(function () {
                var sub = openMenus[openMenus.length - 1];
                var f = sub && sub.querySelector(".menu-item:not(:disabled)");
                if (f) { f.focus(); }
            }, 30);
            return true;
        }
        if (e.key == "ArrowLeft" && openMenus.length > 1) {
            closeMenus(openMenus.length - 1);
            return true;
        }
        return false;
    }

    /* ------------------------------------------------------------------ */
    /*  Popovers (notifications, user menu)                                */
    /* ------------------------------------------------------------------ */
    var popover = null;

    function closePopover() {
        if (popover) {
            var p = popover;
            popover = null;
            if (p.anchor) {
                p.anchor.classList.remove("active");
            }
            p.node.remove();
            if (p.onClose) {
                p.onClose();
            }
        }
    }

    function openPopover(anchor, node, opts) {
        opts = opts || {};
        if (popover && popover.anchor === anchor) {
            closePopover();
            return null;
        }
        closeMenus(0);
        closePopover();
        document.getElementById("menuLayer").appendChild(node);
        var r = anchor.getBoundingClientRect();
        var w = node.offsetWidth;
        var x = Math.min(window.innerWidth - w - 10, r.right - w + (opts.offsetX || 0));
        node.style.left = Math.max(10, x) + "px";
        node.style.top = (r.bottom + 8) + "px";
        anchor.classList.add("active");
        popover = { node: node, anchor: anchor, onClose: opts.onClose };
        return node;
    }

    document.addEventListener("mousedown", function (e) {
        if (openMenus.length > 0 && !e.target.closest(".menu")) {
            closeMenus(0);
        }
        if (popover && !e.target.closest(".popover") && !popover.anchor.contains(e.target)) {
            closePopover();
        }
    }, true);

    window.addEventListener("resize", function () {
        closeMenus(0);
        closePopover();
    });

    window.addEventListener("blur", function () {
        closeMenus(0);
    });

    /* ------------------------------------------------------------------ */
    /*  Modals                                                             */
    /* ------------------------------------------------------------------ */
    var modalStack = [];

    /*
        modal({title, icon, iconHTML, iconClass, body, size, buttons, footLeft,
               onOpen(node), onClose, dismissable})
        buttons: [{label, cls, action(ctx) -> false keeps it open, id}]
        Returns {node, close, body, setBusy(bool)}
    */
    function modal(opts) {
        closeMenus(0);
        closePopover();
        var backdrop = el('<div class="modal-backdrop"></div>');
        var box = el('<div class="modal ' + (opts.size || "") + '" role="dialog" aria-modal="true"></div>');
        var head = '<div class="modal-head">' +
            (opts.iconHTML ? '<div class="head-icon file">' + opts.iconHTML + '</div>' :
                (opts.icon ? '<div class="head-icon ' + (opts.iconClass || "") + '">' + I(opts.icon) + '</div>' : "")) +
            '<h3>' + esc(opts.title || "") + '</h3>' +
            '<button class="icon-btn small" data-close aria-label="' + esc(T("common/close", "Close")) + '">' + I("x") + '</button></div>';
        box.innerHTML = head + '<div class="modal-body scroll-y"></div>';
        var body = box.querySelector(".modal-body");
        if (typeof opts.body === "string") {
            body.innerHTML = opts.body;
        } else if (opts.body) {
            body.appendChild(opts.body);
        }
        var ctx = { node: box, body: body };
        if (opts.buttons && opts.buttons.length) {
            var foot = el('<div class="modal-foot"></div>');
            if (opts.footLeft) {
                var left = el('<div class="left"></div>');
                if (typeof opts.footLeft === "string") {
                    left.innerHTML = opts.footLeft;
                } else {
                    left.appendChild(opts.footLeft);
                }
                foot.appendChild(left);
            }
            opts.buttons.forEach(function (b) {
                var btn = el('<button class="btn ' + (b.cls || "") + '"' + (b.id ? ' id="' + b.id + '"' : "") + '>' + esc(b.label) + '</button>');
                btn.addEventListener("click", function () {
                    var r = b.action ? b.action(ctx) : undefined;
                    if (r === false) {
                        return;
                    }
                    Promise.resolve(r).then(function (keep) {
                        if (keep !== false) {
                            close();
                        }
                    });
                });
                foot.appendChild(btn);
            });
            box.appendChild(foot);
        }
        backdrop.appendChild(box);
        document.getElementById("modalLayer").appendChild(backdrop);

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
        ctx.setBusy = function (busy) {
            box.querySelectorAll(".modal-foot .btn").forEach(function (b) { b.disabled = !!busy; });
        };
        box.querySelector("[data-close]").addEventListener("click", close);
        backdrop.addEventListener("mousedown", function (e) {
            if (e.target === backdrop && opts.dismissable !== false) {
                close();
            }
        });
        var entry = { close: close, opts: opts, ctx: ctx };
        modalStack.push(entry);
        if (opts.onOpen) {
            opts.onOpen(ctx);
        }
        setTimeout(function () {
            var f = box.querySelector("[autofocus]") || box.querySelector(".modal-foot .btn.primary, .modal-foot .btn.danger");
            if (f) {
                f.focus();
                if (f.select && f.hasAttribute("data-select")) {
                    var range = f.getAttribute("data-select").split(",");
                    f.setSelectionRange(parseInt(range[0], 10), parseInt(range[1], 10));
                }
            }
        }, 30);
        return ctx;
    }

    function topModal() {
        return modalStack.length ? modalStack[modalStack.length - 1] : null;
    }

    function confirm(opts) {
        return new Promise(function (resolve) {
            var answered = false;
            modal({
                title: opts.title,
                icon: opts.icon || (opts.danger ? "alert" : "info"),
                iconClass: opts.danger ? "danger" : "",
                body: (opts.message ? '<p>' + esc(opts.message) + '</p>' : "") + (opts.html || ""),
                buttons: [
                    { label: opts.cancel || T("common/cancel", "Cancel"), action: function () { answered = true; resolve(false); } },
                    { label: opts.ok || T("common/ok", "OK"), cls: opts.danger ? "danger" : "primary", action: function () { answered = true; resolve(true); } }
                ],
                onClose: function () {
                    if (!answered) {
                        resolve(false);
                    }
                }
            });
        });
    }

    function prompt(opts) {
        return new Promise(function (resolve) {
            var answered = false;
            var value = opts.value || "";
            var selEnd = value.length;
            if (opts.selectStem) {
                var dot = value.lastIndexOf(".");
                if (dot > 0) {
                    selEnd = dot;
                }
            }
            var ctxRef = modal({
                title: opts.title,
                icon: opts.icon || "pencil",
                body: '<div class="field"><label>' + esc(opts.label || "") + '</label>' +
                    '<input class="input"' + (opts.password ? ' type="password"' : "") + ' autofocus data-select="0,' + selEnd + '" value="' + esc(value) + '" spellcheck="false" autocomplete="off"></div>',
                buttons: [
                    { label: T("common/cancel", "Cancel") },
                    {
                        label: opts.ok || T("common/ok", "OK"), cls: "primary", action: function (ctx) {
                            var v = ctx.body.querySelector("input").value.trim();
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
            return ctxRef;
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Folder picker                                                      */
    /* ------------------------------------------------------------------ */
    /*
        pickFolder({title, okLabel, start, sources}) -> Promise<vpath | null>
        sources: paths being moved, so the picker refuses to drop a folder
        into itself.
    */
    function pickFolder(opts) {
        return new Promise(function (resolve) {
            var current = null; //null = list of roots
            var answered = false;
            var sources = opts.sources || [];
            var body = el('<div><div class="picker">' +
                '<div class="picker-bar"><button class="icon-btn small" data-up title="' + esc(T("picker/up", "Up one level")) + '">' + I("arrowLeft") + '</button>' +
                '<div class="picker-crumbs"></div>' +
                '<button class="icon-btn small" data-mkdir title="' + esc(T("toolbar/newFolder", "New folder")) + '">' + I("folderPlus") + '</button></div>' +
                '<div class="picker-list scroll-y"></div></div></div>');
            var list = body.querySelector(".picker-list");
            var crumbs = body.querySelector(".picker-crumbs");

            function insideSources(path) {
                for (var i = 0; i < sources.length; i++) {
                    var s = sources[i].replace(/\/+$/, "") + "/";
                    if ((path.replace(/\/+$/, "") + "/").indexOf(s) == 0) {
                        return true;
                    }
                }
                return false;
            }

            function renderCrumbs() {
                crumbs.innerHTML = "";
                var rootBtn = el('<button>' + esc(T("picker/locations", "Locations")) + '</button>');
                rootBtn.addEventListener("click", function () { go(null); });
                crumbs.appendChild(rootBtn);
                if (current == null) {
                    return;
                }
                var parts = Drive.pathParts(current);
                parts.forEach(function (p) {
                    crumbs.insertAdjacentHTML("beforeend", I("chevronRight"));
                    var b = el('<button title="' + esc(p.path) + '">' + esc(p.label) + '</button>');
                    b.addEventListener("click", function () { go(p.path); });
                    crumbs.appendChild(b);
                });
                crumbs.scrollLeft = crumbs.scrollWidth;
            }

            function go(path) {
                current = path;
                renderCrumbs();
                body.querySelector("[data-up]").disabled = current == null;
                body.querySelector("[data-mkdir]").disabled = current == null;
                var okBtn = ctx.node.querySelector(".modal-foot .btn.primary");
                if (okBtn) {
                    okBtn.disabled = current == null || insideSources(current);
                }
                list.innerHTML = '<div class="state"><div class="spinner"></div></div>';
                if (current == null) {
                    list.innerHTML = "";
                    Drive.state.roots.forEach(function (r) {
                        var item = el('<button class="picker-item"><span class="ic-box">' + I(Drive.rootIcon(r)) + '</span><span>' +
                            esc(Drive.rootLabel(r)) + '</span>' + I("chevronRight", { cls: "go" }) + '</button>');
                        item.addEventListener("click", function () { go(r.path); });
                        list.appendChild(item);
                    });
                    return;
                }
                var requested = current;
                DriveAPI.list(current, false).then(function (items) {
                    if (requested !== current) {
                        return;
                    }
                    list.innerHTML = "";
                    var folders = items.filter(function (i) { return i.isDir; });
                    folders.sort(function (a, b) { return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }); });
                    if (folders.length == 0) {
                        list.innerHTML = '<div class="state"><p>' + esc(T("picker/noFolders", "No folders here. You can still choose this folder.")) + '</p></div>';
                    }
                    folders.forEach(function (f) {
                        var blocked = insideSources(f.path);
                        var item = el('<button class="picker-item' + (blocked ? " disabled" : "") + '">' + DriveIcons.file(f.name, true) +
                            '<span>' + esc(f.name) + '</span>' + I("chevronRight", { cls: "go" }) + '</button>');
                        item.addEventListener("click", function () { go(f.path); });
                        list.appendChild(item);
                    });
                }).catch(function (err) {
                    list.innerHTML = '<div class="state"><p>' + esc(err.message) + '</p></div>';
                });
            }

            var ctx = modal({
                title: opts.title,
                icon: opts.icon || "move",
                size: "wide",
                body: body,
                buttons: [
                    { label: T("common/cancel", "Cancel") },
                    {
                        label: opts.okLabel || T("common/select", "Select"), cls: "primary", action: function () {
                            if (current == null) {
                                return false;
                            }
                            answered = true;
                            resolve(current);
                        }
                    }
                ],
                onClose: function () {
                    if (!answered) {
                        resolve(null);
                    }
                }
            });

            body.querySelector("[data-up]").addEventListener("click", function () {
                if (current == null) {
                    return;
                }
                var parts = Drive.pathParts(current);
                go(parts.length > 1 ? parts[parts.length - 2].path : null);
            });
            body.querySelector("[data-mkdir]").addEventListener("click", function () {
                if (current == null) {
                    return;
                }
                var target = current;
                prompt({ title: T("toolbar/newFolder", "New folder"), label: T("prompt/folderName", "Folder name"), value: T("prompt/untitledFolder", "Untitled folder"), icon: "folderPlus", ok: T("common/create", "Create") }).then(function (name) {
                    if (!name) {
                        return;
                    }
                    DriveAPI.mkdir(target, name).then(function () {
                        go(DriveAPI.joinPath(target, name));
                    }).catch(error);
                });
            });
            go(opts.start || null);
        });
    }

    global.DriveUI = {
        I: I,
        esc: esc,
        el: el,
        fmtSize: fmtSize,
        fmtExact: fmtExact,
        fmtDate: fmtDate,
        fmtDay: fmtDay,
        fmtRelative: fmtRelative,
        toast: toast,
        error: error,
        menu: menu,
        closeMenus: closeMenus,
        menuOpen: function () { return openMenus.length > 0; },
        menuKeyNav: menuKeyNav,
        openPopover: openPopover,
        closePopover: closePopover,
        popoverOpen: function () { return popover != null; },
        modal: modal,
        topModal: topModal,
        confirm: confirm,
        prompt: prompt,
        pickFolder: pickFolder
    };
})(window);
