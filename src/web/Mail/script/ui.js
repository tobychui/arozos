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

    var openMenu = null;

    function closeMenu() {
        if (openMenu) {
            var current = openMenu;
            openMenu = null;
            current.node.remove();
            document.removeEventListener("mousedown", current.outside, true);
            document.removeEventListener("keydown", current.keys, true);
            window.removeEventListener("blur", closeMenu);
            window.removeEventListener("resize", closeMenu);
            if (current.onClose) {
                current.onClose();
            }
        }
    }

    //menu shows items next to an anchor element or at {x, y}. Items:
    //{label, icon, hint, onClick, danger, checked, disabled, dot}, "-" or {title}
    function menu(anchor, items, options) {
        closeMenu();
        options = options || {};
        var node = el("div", { class: "menu", role: "menu" });
        var actionable = [];
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
                class: "menu-item" + (item.danger ? " danger" : "") + (item.checked ? " checked" : "") + (item.disabled ? " disabled" : ""),
                role: "menuitem", tabindex: "-1"
            });
            if (item.dot) {
                row.appendChild(el("span", { class: "dot", style: { background: item.dot } }));
            } else if (item.icon) {
                row.appendChild(icon(item.icon));
            }
            row.appendChild(el("span", { class: "grow", text: item.label }));
            if (item.hint) {
                row.appendChild(el("span", { class: "hint", text: item.hint }));
            }
            row.addEventListener("click", function (event) {
                event.stopPropagation();
                if (item.disabled) {
                    return;
                }
                if (!item.keepOpen) {
                    closeMenu();
                }
                if (item.onClick) {
                    item.onClick(event);
                }
            });
            actionable.push(row);
            node.appendChild(row);
        });
        document.body.appendChild(node);

        //Position: below the anchor, flipped to stay on screen
        var rect;
        if (anchor && anchor.getBoundingClientRect) {
            rect = anchor.getBoundingClientRect();
        } else {
            rect = { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y, width: 0, height: 0 };
        }
        var width = node.offsetWidth;
        var height = node.offsetHeight;
        var left = options.alignRight ? rect.right - width : rect.left;
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

        var focusIndex = -1;
        var keys = function (event) {
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                closeMenu();
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                event.stopPropagation();
                if (actionable.length === 0) {
                    return;
                }
                if (focusIndex >= 0) {
                    actionable[focusIndex].classList.remove("focus");
                }
                focusIndex = (focusIndex + (event.key === "ArrowDown" ? 1 : -1) + actionable.length) % actionable.length;
                actionable[focusIndex].classList.add("focus");
                actionable[focusIndex].scrollIntoView({ block: "nearest" });
            } else if (event.key === "Enter" && focusIndex >= 0) {
                event.preventDefault();
                event.stopPropagation();
                actionable[focusIndex].click();
            }
        };
        var outside = function (event) {
            if (!node.contains(event.target)) {
                closeMenu();
            }
        };
        setTimeout(function () {
            document.addEventListener("mousedown", outside, true);
        }, 0);
        document.addEventListener("keydown", keys, true);
        window.addEventListener("blur", closeMenu);
        window.addEventListener("resize", closeMenu);
        openMenu = { node: node, outside: outside, keys: keys, onClose: options.onClose };
        return { close: closeMenu, node: node };
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
            if (event.key === "Escape" && dismissable && !openMenu) {
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
        isMenuOpen: function () { return openMenu !== null; }
    };
})();
