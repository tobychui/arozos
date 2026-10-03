/*
    Mail — UI primitives

    Pop-up menus, toasts, modal dialogs, confirm / prompt and a date-time
    picker, shared by the main window and the .eml viewer.
*/

var Mail = window.Mail || {};
window.Mail = Mail;

Mail.ui = (function () {
    "use strict";
    var el = Mail.util.el;
    var icon = Mail.util.icon;

    /* ---------- Toasts ---------- */

    function toastRoot() {
        var root = document.getElementById("toastRoot");
        if (!root) {
            root = el("div", { id: "toastRoot", class: "toasts", "aria-live": "polite" });
            document.body.appendChild(root);
        }
        return root;
    }

    //toast shows a transient message; options: {action: {label, fn}, error, duration}
    function toast(message, options) {
        options = options || {};
        var node = el("div", { class: "toast" + (options.error ? " error" : ""), role: options.error ? "alert" : "status" });
        var text = el("div", { class: "msg", text: message });
        node.appendChild(text);
        var timer = null;
        var closed = false;
        var close = function () {
            if (closed) {
                return;
            }
            closed = true;
            clearTimeout(timer);
            node.style.transition = "opacity 0.15s";
            node.style.opacity = "0";
            setTimeout(function () { node.remove(); }, 160);
            if (options.onClose) {
                options.onClose();
            }
        };
        if (options.action) {
            node.appendChild(el("button", {
                class: "act", text: options.action.label,
                on: { click: function () { options.action.fn(); close(); } }
            }));
        }
        node.appendChild(el("button", { class: "x", title: "Dismiss", on: { click: close } }, icon("close")));
        toastRoot().appendChild(node);
        var duration = options.duration === undefined ? (options.error ? 7000 : 4000) : options.duration;
        if (duration > 0) {
            timer = setTimeout(close, duration);
        }
        return {
            close: close,
            setText: function (value) { text.textContent = value; }
        };
    }

    function errorToast(error, prefix) {
        var message = (error && error.message) ? error.message : String(error || "Something went wrong");
        if (error && error.hint) {
            message += " — " + error.hint;
        }
        return toast((prefix ? prefix + ": " : "") + message, { error: true });
    }

    /* ---------- Menus ---------- */

    //menuStack holds the open menu and its open submenus, outermost first
    var menuStack = [];
    var menuSession = null;

    function closeMenu() {
        if (menuStack.length === 0) {
            return;
        }
        var stack = menuStack;
        var session = menuSession;
        menuStack = [];
        menuSession = null;
        stack.forEach(function (level) { level.node.remove(); });
        if (session) {
            clearTimeout(session.hoverTimer);
            document.removeEventListener("mousedown", session.outside, true);
            document.removeEventListener("keydown", session.keys, true);
            window.removeEventListener("blur", closeMenu);
            window.removeEventListener("resize", closeMenu);
            if (session.onClose) {
                session.onClose();
            }
        }
    }

    //closeLevelsAbove closes the submenus deeper than level
    function closeLevelsAbove(level) {
        while (menuStack.length > level + 1) {
            var closing = menuStack.pop();
            closing.node.remove();
            if (closing.parentRow) {
                closing.parentRow.classList.remove("open");
            }
        }
    }

    function setFocus(level, index) {
        var entry = menuStack[level];
        if (!entry) {
            return;
        }
        if (entry.focus >= 0 && entry.rows[entry.focus]) {
            entry.rows[entry.focus].classList.remove("focus");
        }
        entry.focus = index;
        if (index >= 0 && entry.rows[index]) {
            entry.rows[index].classList.add("focus");
            entry.rows[index].scrollIntoView({ block: "nearest" });
        }
    }

    //buildMenu renders one menu level. Items: {label, icon, hint, onClick,
    //danger, checked, disabled, dot, submenu}, "-" or {title}
    function buildMenu(items, level) {
        var node = el("div", { class: "menu", role: "menu" });
        var rows = [];
        items.forEach(function (item) {
            if (!item) {
                return;
            }
            if (item === "-") {
                node.appendChild(el("div", { class: "menu-sep" }));
                return;
            }
            if (item.title) {
                node.appendChild(el("div", { class: "menu-title", text: item.title }));
                return;
            }
            var row = el("div", {
                class: "menu-item" + (item.danger ? " danger" : "") + (item.checked ? " checked" : "") + (item.disabled ? " disabled" : "") + (item.submenu ? " has-sub" : ""),
                role: "menuitem", tabindex: "-1"
            });
            if (item.submenu) {
                row.setAttribute("aria-haspopup", "true");
            }
            if (item.dot) {
                row.appendChild(el("span", { class: "dot", style: { background: item.dot } }));
            } else if (item.icon) {
                row.appendChild(icon(item.icon));
            }
            row.appendChild(el("span", { class: "grow", text: item.label }));
            if (item.hint) {
                row.appendChild(el("span", { class: "hint", text: item.hint }));
            }
            if (item.submenu) {
                row.appendChild(icon("caret right", "sub-caret"));
            }
            var index = rows.length;
            row.addEventListener("click", function (event) {
                event.stopPropagation();
                if (item.disabled) {
                    return;
                }
                if (item.submenu) {
                    openSubmenu(level, row, item, false);
                    return;
                }
                if (!item.keepOpen) {
                    closeMenu();
                }
                if (item.onClick) {
                    item.onClick(event);
                }
            });
            row.addEventListener("mouseenter", function () {
                if (!menuSession) {
                    return;
                }
                setFocus(level, index);
                clearTimeout(menuSession.hoverTimer);
                if (item.submenu && !item.disabled) {
                    //A short delay keeps a diagonal mouse path from flickering
                    //through the neighbouring items' submenus
                    menuSession.hoverTimer = setTimeout(function () {
                        if (menuStack[level + 1] && menuStack[level + 1].parentRow === row) {
                            return;
                        }
                        openSubmenu(level, row, item, false);
                    }, 160);
                } else {
                    menuSession.hoverTimer = setTimeout(function () { closeLevelsAbove(level); }, 160);
                }
            });
            rows.push(row);
            node.appendChild(row);
        });
        return { node: node, rows: rows };
    }

    function placeNear(node, rect, alignRight) {
        var width = node.offsetWidth;
        var height = node.offsetHeight;
        var left = alignRight ? rect.right - width : rect.left;
        var top = rect.bottom + 4;
        if (left + width > window.innerWidth - 8) {
            left = window.innerWidth - width - 8;
        }
        if (left < 8) {
            left = 8;
        }
        if (top + height > window.innerHeight - 8) {
            top = Math.max(8, rect.top - height - 4);
        }
        node.style.left = left + "px";
        node.style.top = top + "px";
    }

    //placeBeside puts a submenu to the right of its parent menu with its top
    //edge level with the item that opened it, flipping left near the edge
    function placeBeside(node, rowRect, parentRect) {
        var width = node.offsetWidth;
        var height = node.offsetHeight;
        var left = parentRect.right + 2;
        if (left + width > window.innerWidth - 8) {
            left = Math.max(8, parentRect.left - width - 2);
        }
        var top = rowRect.top;
        if (top + height > window.innerHeight - 8) {
            top = Math.max(8, window.innerHeight - height - 8);
        }
        node.style.left = left + "px";
        node.style.top = top + "px";
    }

    function openSubmenu(level, row, item, focusFirst) {
        closeLevelsAbove(level);
        var items = typeof item.submenu === "function" ? item.submenu() : item.submenu;
        var built = buildMenu(items || [], level + 1);
        built.node.classList.add("submenu");
        document.body.appendChild(built.node);
        placeBeside(built.node, row.getBoundingClientRect(), menuStack[level].node.getBoundingClientRect());
        menuStack.push({ node: built.node, rows: built.rows, parentRow: row, focus: -1 });
        row.classList.add("open");
        if (focusFirst) {
            setFocus(level + 1, 0);
        }
    }

    //menu shows items next to an anchor element or at {x, y}. An item with a
    //submenu (array or function returning one) opens it beside the menu.
    function menu(anchor, items, options) {
        closeMenu();
        options = options || {};
        var built = buildMenu(items, 0);
        document.body.appendChild(built.node);

        var rect;
        if (anchor && anchor.getBoundingClientRect) {
            rect = anchor.getBoundingClientRect();
        } else {
            rect = { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y, width: 0, height: 0 };
        }
        placeNear(built.node, rect, options.alignRight);
        menuStack = [{ node: built.node, rows: built.rows, parentRow: null, focus: -1 }];

        var keys = function (event) {
            var level = menuStack.length - 1;
            var entry = menuStack[level];
            if (!entry) {
                return;
            }
            var handled = true;
            if (event.key === "Escape") {
                if (level > 0) {
                    closeLevelsAbove(level - 1);
                } else {
                    closeMenu();
                }
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                if (entry.rows.length > 0) {
                    var next = (entry.focus + (event.key === "ArrowDown" ? 1 : -1) + entry.rows.length) % entry.rows.length;
                    setFocus(level, next);
                }
            } else if (event.key === "ArrowRight" && entry.focus >= 0 && entry.rows[entry.focus].classList.contains("has-sub")) {
                entry.rows[entry.focus].click();
                setFocus(level + 1, 0);
            } else if (event.key === "ArrowLeft" && level > 0) {
                closeLevelsAbove(level - 1);
            } else if (event.key === "Enter" && entry.focus >= 0) {
                var row = entry.rows[entry.focus];
                row.click();
                if (row.classList.contains("has-sub")) {
                    setFocus(level + 1, 0);
                }
            } else {
                handled = false;
            }
            if (handled) {
                event.preventDefault();
                event.stopPropagation();
            }
        };
        var outside = function (event) {
            var inside = menuStack.some(function (entry) { return entry.node.contains(event.target); });
            if (!inside) {
                closeMenu();
            }
        };
        menuSession = { outside: outside, keys: keys, onClose: options.onClose, hoverTimer: null };
        setTimeout(function () {
            if (menuSession && menuSession.outside === outside) {
                document.addEventListener("mousedown", outside, true);
            }
        }, 0);
        document.addEventListener("keydown", keys, true);
        window.addEventListener("blur", closeMenu);
        window.addEventListener("resize", closeMenu);
        return { close: closeMenu, node: built.node };
    }

    /* ---------- Modals ---------- */

    var modalStack = [];

    //modal opens a dialog. options: {title, subtitle, body, wide, xwide,
    //buttons: [{label, primary, danger, left, onClick}], onClose, dismissable}
    function modal(options) {
        var backdrop = el("div", { class: "modal-backdrop" });
        var box = el("div", {
            class: "modal" + (options.wide ? " wide" : "") + (options.xwide ? " xwide" : ""),
            role: "dialog", "aria-modal": "true"
        });
        var head = el("div", { class: "modal-head" });
        var titleWrap = el("div", { class: "grow" }, [el("h2", { text: options.title || "" })]);
        if (options.subtitle) {
            titleWrap.appendChild(el("div", { class: "sub", text: options.subtitle }));
        }
        head.appendChild(titleWrap);
        var dismissable = options.dismissable !== false;
        if (dismissable) {
            head.appendChild(el("button", { class: "iconbtn", title: "Close", on: { click: function () { close(); } } }, icon("close")));
        }
        box.appendChild(head);

        var body = el("div", { class: "modal-body" + (options.flush ? " flush" : "") });
        if (options.body) {
            body.appendChild(options.body);
        }
        if (options.flush) {
            body.style.padding = "0";
        }
        box.appendChild(body);

        var foot = null;
        var buttons = [];
        if (options.buttons && options.buttons.length > 0) {
            foot = el("div", { class: "modal-foot" });
            var left = el("div", { class: "left" });
            foot.appendChild(left);
            options.buttons.forEach(function (definition) {
                var button = el("button", {
                    class: "btn" + (definition.primary ? " primary" : "") + (definition.danger ? " danger" : ""),
                    text: definition.label
                });
                button.addEventListener("click", function () {
                    var result = definition.onClick ? definition.onClick(api) : undefined;
                    if (result === false) {
                        return;
                    }
                    if (result && typeof result.then === "function") {
                        return;
                    }
                    close();
                });
                buttons.push(button);
                (definition.left ? left : foot).appendChild(button);
            });
            box.appendChild(foot);
        }

        backdrop.appendChild(box);
        document.body.appendChild(backdrop);

        var closed = false;
        function close() {
            if (closed) {
                return;
            }
            closed = true;
            backdrop.remove();
            modalStack = modalStack.filter(function (entry) { return entry !== api; });
            document.removeEventListener("keydown", keys, true);
            if (options.onClose) {
                options.onClose();
            }
        }
        function keys(event) {
            if (modalStack[modalStack.length - 1] !== api) {
                return;
            }
            if (event.key === "Escape" && dismissable && menuStack.length === 0) {
                event.preventDefault();
                event.stopPropagation();
                close();
            }
        }
        document.addEventListener("keydown", keys, true);
        backdrop.addEventListener("mousedown", function (event) {
            if (event.target === backdrop && dismissable && options.clickOutside !== false) {
                close();
            }
        });

        var api = {
            close: close,
            box: box,
            body: body,
            foot: foot,
            buttons: buttons,
            isClosed: function () { return closed; },
            setTitle: function (title) { head.querySelector("h2").textContent = title; },
            setBusy: function (busy) {
                buttons.forEach(function (button) { button.disabled = busy; });
            }
        };
        modalStack.push(api);
        setTimeout(function () {
            var focusTarget = box.querySelector("[autofocus]") || box.querySelector("input:not([type=hidden]), textarea, select");
            if (focusTarget) {
                focusTarget.focus();
            }
        }, 30);
        return api;
    }

    function hasOpenModal() {
        return modalStack.length > 0;
    }

    function confirmDialog(title, message, options) {
        options = options || {};
        return new Promise(function (resolve) {
            var answered = false;
            modal({
                title: title,
                body: el("p", { text: message }),
                buttons: [
                    { label: options.cancelLabel || "Cancel", onClick: function () { answered = true; resolve(false); } },
                    { label: options.okLabel || "OK", primary: !options.danger, danger: options.danger, onClick: function () { answered = true; resolve(true); } }
                ],
                onClose: function () { if (!answered) { resolve(false); } }
            });
        });
    }

    //choice offers several buttons and resolves with the chosen value
    function choice(title, message, choices) {
        return new Promise(function (resolve) {
            var answered = false;
            modal({
                title: title,
                body: el("p", { text: message }),
                buttons: choices.map(function (option) {
                    return {
                        label: option.label, primary: option.primary, danger: option.danger, left: option.left,
                        onClick: function () { answered = true; resolve(option.value); }
                    };
                }),
                onClose: function () { if (!answered) { resolve(null); } }
            });
        });
    }

    function prompt(title, label, initial, options) {
        options = options || {};
        return new Promise(function (resolve) {
            var input = el("input", { class: "input", type: "text", value: initial || "", placeholder: options.placeholder || "", autofocus: true });
            var answered = false;
            var submit = function () {
                var value = input.value.trim();
                if (value === "" && !options.allowEmpty) {
                    input.classList.add("invalid");
                    return false;
                }
                answered = true;
                resolve(value);
                return true;
            };
            var dialog = modal({
                title: title,
                body: el("div", { class: "field" }, [label ? el("label", { text: label }) : null, input]),
                buttons: [
                    { label: "Cancel" },
                    { label: options.okLabel || "OK", primary: true, onClick: function () { return submit(); } }
                ],
                onClose: function () { if (!answered) { resolve(null); } }
            });
            input.addEventListener("keydown", function (event) {
                if (event.key === "Enter") {
                    event.preventDefault();
                    if (submit()) {
                        dialog.close();
                    }
                }
            });
            setTimeout(function () { input.select(); }, 40);
        });
    }

    function pad(n) {
        return (n < 10 ? "0" : "") + n;
    }

    function toLocalInput(date) {
        return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + "T" + pad(date.getHours()) + ":" + pad(date.getMinutes());
    }

    //pickDateTime asks for a future moment and resolves with unix ms or null
    function pickDateTime(title, initial, okLabel) {
        return new Promise(function (resolve) {
            var start = initial ? new Date(initial) : new Date(Date.now() + 3600 * 1000);
            var input = el("input", { class: "input", type: "datetime-local", value: toLocalInput(start), min: toLocalInput(new Date()) });
            var error = el("div", { class: "help", style: { color: "var(--danger)" } });
            var answered = false;
            modal({
                title: title,
                body: el("div", { class: "field" }, [el("label", { text: "Date and time" }), input, error]),
                buttons: [
                    { label: "Cancel" },
                    {
                        label: okLabel || "OK", primary: true, onClick: function () {
                            var value = new Date(input.value).getTime();
                            if (!value || value <= Date.now()) {
                                error.textContent = "Choose a time in the future.";
                                return false;
                            }
                            answered = true;
                            resolve(value);
                        }
                    }
                ],
                onClose: function () { if (!answered) { resolve(null); } }
            });
        });
    }

    //presetTimes are the quick choices offered by snooze and send later
    function presetTimes() {
        var now = new Date();
        var laterToday = new Date(now.getTime() + 3 * 3600 * 1000);
        laterToday.setMinutes(0, 0, 0);
        var tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 8, 0, 0);
        var nextWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ((8 - now.getDay()) % 7 || 7), 8, 0, 0);
        var weekend = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ((6 - now.getDay() + 7) % 7 || 7), 9, 0, 0);
        var describe = function (date) {
            return date.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
        };
        var options = [];
        if (laterToday.getDate() === now.getDate()) {
            options.push({ label: "Later today", hint: describe(laterToday), value: laterToday.getTime() });
        }
        options.push({ label: "Tomorrow", hint: describe(tomorrow), value: tomorrow.getTime() });
        if (weekend.getTime() > tomorrow.getTime()) {
            options.push({ label: "This weekend", hint: describe(weekend), value: weekend.getTime() });
        }
        options.push({ label: "Next week", hint: describe(nextWeek), value: nextWeek.getTime() });
        return options;
    }

    return {
        toast: toast, errorToast: errorToast, menu: menu, closeMenu: closeMenu,
        modal: modal, hasOpenModal: hasOpenModal, confirm: confirmDialog, choice: choice, prompt: prompt,
        pickDateTime: pickDateTime, presetTimes: presetTimes,
        isMenuOpen: function () { return menuStack.length > 0; }
    };
})();
