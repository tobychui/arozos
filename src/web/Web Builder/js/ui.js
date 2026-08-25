/*
    ui.js

    Small UI primitives shared by every panel: element creation, popup menus,
    modal dialogs, confirm/prompt, toasts and the busy overlay.

    Kept dependency-free (no jQuery, no Semantic UI) so the builder chrome
    matches the design exactly and stays isolated from the page being edited.
*/

var WBUI = (function () {

    /* ------------------------------------------------------------ dom -- */

    function el(tag, opts, children) {
        var node = document.createElement(tag);
        opts = opts || {};
        for (var k in opts) {
            if (k === "class") { node.className = opts[k]; }
            else if (k === "html") { node.innerHTML = opts[k]; }
            else if (k === "text") { node.textContent = opts[k]; }
            else if (k === "style") { node.setAttribute("style", opts[k]); }
            else if (k.indexOf("on") === 0 && typeof opts[k] === "function") {
                node.addEventListener(k.substring(2).toLowerCase(), opts[k]);
            } else if (opts[k] !== undefined && opts[k] !== null) {
                node.setAttribute(k, opts[k]);
            }
        }
        if (children) {
            for (var i = 0; i < children.length; i++) {
                if (children[i]) { node.appendChild(children[i]); }
            }
        }
        return node;
    }

    function iconBtn(icon, title, onClick, cls, size) {
        return el("button", {
            class: cls || "wb-row-btn",
            title: title || "",
            type: "button",
            html: WBIcon(icon, size || 14),
            onclick: onClick
        });
    }

    function clear(node) {
        while (node.firstChild) { node.removeChild(node.firstChild); }
        return node;
    }

    function debounce(fn, ms) {
        var t = null;
        return function () {
            var args = arguments, self = this;
            if (t) { clearTimeout(t); }
            t = setTimeout(function () { fn.apply(self, args); }, ms || 180);
        };
    }

    /* ----------------------------------------------------------- menu -- */

    var openMenu = null;

    function closeMenu() {
        if (openMenu && openMenu.parentNode) { openMenu.parentNode.removeChild(openMenu); }
        openMenu = null;
    }

    /*
        anchor - a DOM element to align under, or {x, y} client coordinates.
        items  - [{label, icon, key, action, danger, disabled, checked}]
                 use {separator:true} or {header:"..."} for structure.
    */
    function menu(anchor, items, opts) {
        closeMenu();
        opts = opts || {};
        var m = el("div", { class: "wb-menu" });

        items.forEach(function (it) {
            if (!it) { return; }
            if (it.separator) { m.appendChild(el("div", { class: "wb-menu-sep" })); return; }
            if (it.header) { m.appendChild(el("div", { class: "wb-menu-head", text: it.header })); return; }

            var btn = el("button", {
                class: "wb-menu-item" + (it.danger ? " danger" : ""),
                type: "button"
            });
            btn.disabled = !!it.disabled;
            btn.appendChild(el("span", {
                class: "wb-menu-icon",
                html: it.icon ? WBIcon(it.icon, 15) : '<span style="width:15px;display:block"></span>'
            }));
            btn.appendChild(el("span", { text: it.label }));
            if (it.checked) {
                btn.appendChild(el("span", { class: "wb-menu-key", html: WBIcon("check", 13) }));
            } else if (it.key) {
                btn.appendChild(el("span", { class: "wb-menu-key", text: it.key }));
            }
            btn.addEventListener("click", function (e) {
                e.stopPropagation();
                closeMenu();
                if (it.action) { it.action(); }
            });
            m.appendChild(btn);
        });

        document.body.appendChild(m);
        openMenu = m;

        var mw = m.offsetWidth, mh = m.offsetHeight;
        var x, y, flipTo;
        if (anchor && anchor.getBoundingClientRect) {
            var r = anchor.getBoundingClientRect();
            x = opts.alignRight ? r.right - mw : r.left;
            y = r.bottom + 5;
            flipTo = r.top - mh - 5;          /* above the anchor */
        } else {
            x = anchor.x; y = anchor.y;
            flipTo = anchor.y - mh;           /* above the click point */
        }

        /* open upwards rather than covering the thing that opened it */
        if (y + mh > window.innerHeight - 6 && flipTo >= 6) { y = flipTo; }

        x = Math.max(6, Math.min(x, window.innerWidth - mw - 6));
        y = Math.max(6, Math.min(y, window.innerHeight - mh - 6));
        m.style.left = Math.round(x) + "px";
        m.style.top = Math.round(y) + "px";
        return m;
    }

    document.addEventListener("mousedown", function (e) {
        if (openMenu && !openMenu.contains(e.target)) { closeMenu(); }
    }, true);
    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") { closeMenu(); }
    });

    /* ---------------------------------------------------------- modal -- */

    var modalLayer = null;
    var modalResolve = null;

    /*
        modal({ title, body, buttons:[{label, kind, value, primary}], width })
        body may be a string of HTML or a DOM node.
        Resolves with the chosen button's value (null when dismissed).
    */
    function modal(cfg) {
        return new Promise(function (resolve) {
            closeModal(null);
            modalLayer = document.getElementById("wb-modal-layer");
            var box = el("div", {
                class: "wb-modal" + (cfg.wide ? " wide" : "") + (cfg.size ? " " + cfg.size : "")
            });

            var hd = el("div", { class: "wb-modal-hd" }, [
                el("div", { class: "wb-modal-title", text: cfg.title || "" })
            ]);
            hd.appendChild(iconBtn("close", "Close", function () { closeModal(null); }, "wb-icon-btn", 16));
            box.appendChild(hd);

            var bd = el("div", { class: "wb-modal-bd" });
            if (typeof cfg.body === "string") { bd.innerHTML = cfg.body; }
            else if (cfg.body) { bd.appendChild(cfg.body); }
            box.appendChild(bd);

            var buttons = cfg.buttons || [{ label: "Close", value: null }];
            var ft = el("div", { class: "wb-modal-ft" });
            if (cfg.footerLeft) { ft.appendChild(el("div", { class: "wb-modal-ft-left" }, [cfg.footerLeft])); }
            buttons.forEach(function (b) {
                ft.appendChild(el("button", {
                    class: "wb-btn" + (b.primary ? " wb-btn-primary" : "") + (b.danger ? " wb-btn-danger" : ""),
                    type: "button",
                    text: b.label,
                    onclick: function () {
                        if (b.validate && b.validate() === false) { return; }
                        closeModal(b.value !== undefined ? b.value : b.label);
                    }
                }));
            });
            box.appendChild(ft);

            clear(modalLayer).appendChild(box);
            modalLayer.classList.add("show");
            modalResolve = resolve;

            modalLayer.onmousedown = function (e) {
                if (e.target === modalLayer && cfg.dismissable !== false) { closeModal(null); }
            };
            setTimeout(function () {
                var first = bd.querySelector("input, textarea, select");
                if (first) { first.focus(); if (first.select) { first.select(); } }
            }, 30);
        });
    }

    function closeModal(value) {
        var layer = document.getElementById("wb-modal-layer");
        if (layer) { layer.classList.remove("show"); clear(layer); }
        if (modalResolve) {
            var r = modalResolve;
            modalResolve = null;
            r(value);
        }
    }

    function confirm(title, message, okLabel, danger) {
        return modal({
            title: title,
            body: el("div", { text: message }),
            buttons: [
                { label: "Cancel", value: false },
                { label: okLabel || "Confirm", value: true, primary: !danger, danger: !!danger }
            ]
        }).then(function (v) { return v === true; });
    }

    function prompt(title, label, value, placeholder) {
        var input = el("input", { class: "wb-input", type: "text", value: value || "", placeholder: placeholder || "" });
        var body = el("div", {}, [
            el("label", { class: "wb-label", text: label || "" }),
            input
        ]);
        input.addEventListener("keydown", function (e) {
            if (e.key === "Enter") { closeModal(input.value.trim()); }
        });
        return modal({
            title: title,
            body: body,
            buttons: [
                { label: "Cancel", value: null },
                { label: "OK", value: "__ok__", primary: true }
            ]
        }).then(function (v) {
            if (v === null) { return null; }
            return input.value.trim();
        });
    }

    /* ---------------------------------------------------------- toast -- */

    function toast(message, kind) {
        var layer = document.getElementById("wb-toast-layer");
        var t = el("div", { class: "wb-toast" + (kind ? " " + kind : "") });
        if (kind === "err") { t.innerHTML = WBIcon("alert", 15); }
        else if (kind === "ok") { t.innerHTML = WBIcon("check", 15); }
        t.appendChild(el("span", { text: message }));
        layer.appendChild(t);
        setTimeout(function () {
            t.style.transition = "opacity .3s, transform .3s";
            t.style.opacity = "0";
            t.style.transform = "translateY(6px)";
            setTimeout(function () { if (t.parentNode) { t.parentNode.removeChild(t); } }, 320);
        }, kind === "err" ? 4200 : 2400);
    }

    /* ----------------------------------------------------------- busy -- */

    function busy(show, message) {
        var b = document.getElementById("wb-busy");
        b.querySelector("span").textContent = message || "Working...";
        b.classList.toggle("show", !!show);
    }

    /* ------------------------------------------------------- controls -- */

    /*
        A labelled field wrapper.
        WBUI.field("Text", controlNode)
    */
    function field(label, control, help) {
        var kids = [];
        if (label) { kids.push(el("label", { class: "wb-label", text: label })); }
        kids.push(control);
        if (help) { kids.push(el("div", { class: "wb-note", text: help })); }
        return el("div", { class: "wb-field" }, kids);
    }

    function searchBox(placeholder, onInput) {
        var input = el("input", { type: "text", placeholder: placeholder || "Search..." });
        input.addEventListener("input", debounce(function () { onInput(input.value.trim().toLowerCase()); }, 120));
        return el("div", { class: "wb-search" }, [
            el("span", { html: WBIcon("search", 14) }).firstChild,
            input
        ]);
    }

    function segment(options, value, onChange) {
        var wrap = el("div", { class: "wb-segment" });
        options.forEach(function (o) {
            var b = el("button", {
                type: "button",
                class: (o.value === value ? "active" : ""),
                title: o.title || o.label || "",
                html: o.icon ? WBIcon(o.icon, 14) : "",
                onclick: function () {
                    var all = wrap.querySelectorAll("button");
                    for (var i = 0; i < all.length; i++) { all[i].classList.remove("active"); }
                    b.classList.add("active");
                    onChange(o.value);
                }
            });
            if (!o.icon && o.label) { b.textContent = o.label; }
            wrap.appendChild(b);
        });
        return wrap;
    }

    function switchControl(checked, onChange) {
        var input = el("input", { type: "checkbox" });
        input.checked = !!checked;
        input.addEventListener("change", function () { onChange(input.checked); });
        var lab = el("label", { class: "wb-switch" }, [input, el("i", {})]);
        return lab;
    }

    /* number + unit control, value like "48px" */
    function unitInput(value, onChange, opts) {
        opts = opts || {};
        var units = opts.units || ["px", "%", "em", "rem", "vh", "vw", "auto"];
        var parsed = parseLength(value);
        var num = el("input", { type: "number", value: parsed.num, step: opts.step || 1 });
        var sel = el("select");
        units.forEach(function (u) {
            sel.appendChild(el("option", { value: u, text: u, selected: u === parsed.unit ? "selected" : null }));
        });
        var box = el("div", { class: "wb-unit-input" }, [num, sel]);

        function fire() {
            if (sel.value === "auto") { onChange("auto"); return; }
            if (num.value === "") { onChange(""); return; }
            onChange(num.value + sel.value);
        }
        num.addEventListener("input", fire);
        sel.addEventListener("change", fire);
        num.addEventListener("focus", function () { box.classList.add("focus"); });
        num.addEventListener("blur", function () { box.classList.remove("focus"); });

        box.setValue = function (v) {
            var p = parseLength(v);
            num.value = p.num;
            sel.value = p.unit;
        };
        return box;
    }

    function parseLength(v) {
        if (v === undefined || v === null || v === "") { return { num: "", unit: "px" }; }
        v = String(v).trim();
        if (v === "auto") { return { num: "", unit: "auto" }; }
        var m = v.match(/^(-?[\d.]+)\s*([a-z%]*)$/i);
        if (!m) { return { num: "", unit: "px" }; }
        return { num: m[1], unit: m[2] || "px" };
    }

    /* slider bound to a unit input */
    function sliderRow(value, onChange, opts) {
        opts = opts || {};
        var parsed = parseLength(value);
        var range = el("input", {
            type: "range",
            min: opts.min !== undefined ? opts.min : 0,
            max: opts.max !== undefined ? opts.max : 200,
            step: opts.step || 1,
            value: parsed.num === "" ? (opts.min || 0) : parsed.num
        });
        var box = unitInput(value, function (v) {
            var p = parseLength(v);
            if (p.num !== "") { range.value = p.num; }
            onChange(v);
        }, opts);
        range.addEventListener("input", function () {
            var unit = box.querySelector("select").value;
            box.setValue(range.value + (unit === "auto" ? "px" : unit));
            onChange(range.value + (unit === "auto" ? "px" : unit));
        });
        var row = el("div", { class: "wb-slider-row" }, [range, box]);
        row.setValue = function (v) {
            var p = parseLength(v);
            if (p.num !== "") { range.value = p.num; }
            box.setValue(v);
        };
        return row;
    }

    /*
        Colour field: a swatch that opens the builder's own picker (js/colorpicker.js)
        plus a text box for typing any CSS colour directly.

        The native <input type="color"> is deliberately not used - it renders as
        the operating system's dialog, which cannot be themed and looks different
        on every machine.
    */
    function colorRow(value, onChange) {
        var current = value || "";
        var swatch = el("button", {
            class: "wb-color-swatch",
            type: "button",
            title: "Pick a colour"
        }, [
            el("i", { style: "background:" + (current || "transparent") })
        ]);
        var text = el("input", { type: "text", value: current });

        function paint(v) {
            swatch.querySelector("i").style.background = v || "transparent";
        }
        function apply(v) {
            current = v;
            paint(v);
            onChange(v);
        }

        swatch.addEventListener("click", function () {
            var before = current;
            WBColorPicker.open({
                value: current || "#ffffff",
                anchor: swatch,
                /* live feedback on the canvas while dragging */
                onPreview: function (v) { text.value = v; paint(v); onChange(v); },
                onApply: function (v) { text.value = v; apply(v); },
                onCancel: function () { text.value = before; apply(before); }
            });
        });

        text.addEventListener("input", function () { apply(text.value.trim()); });

        var row = el("div", { class: "wb-color-row" }, [swatch, text]);
        row.setValue = function (v) {
            current = v || "";
            text.value = current;
            paint(current);
        };
        return row;
    }

    function selectControl(options, value, onChange) {
        var sel = el("select", { class: "wb-select" });
        options.forEach(function (o) {
            var opt = el("option", { value: o.value, text: o.label });
            if (String(o.value) === String(value)) { opt.selected = true; }
            sel.appendChild(opt);
        });
        sel.addEventListener("change", function () { onChange(sel.value); });
        return sel;
    }

    function textInput(value, onChange, opts) {
        opts = opts || {};
        var input = el("input", {
            class: "wb-input" + (opts.mono ? " mono" : ""),
            type: opts.type || "text",
            value: value === undefined || value === null ? "" : value,
            placeholder: opts.placeholder || ""
        });
        if (opts.min !== undefined) { input.min = opts.min; }
        if (opts.max !== undefined) { input.max = opts.max; }
        if (opts.step !== undefined) { input.step = opts.step; }
        input.addEventListener("input", function () { onChange(input.value); });
        return input;
    }

    function textArea(value, onChange, opts) {
        opts = opts || {};
        var ta = el("textarea", {
            class: "wb-textarea" + (opts.mono ? " mono" : ""),
            placeholder: opts.placeholder || "",
            rows: opts.rows || 4
        });
        ta.value = value === undefined || value === null ? "" : value;
        ta.addEventListener("input", function () { onChange(ta.value); });
        return ta;
    }

    function group(title, contentNode, openByDefault, hasValue) {
        var g = el("div", { class: "wb-prop-group" + (openByDefault ? " open" : "") + (hasValue ? " modified" : "") });
        var hd = el("button", { class: "wb-prop-group-hd", type: "button" }, [
            el("span", { text: title }),
            el("span", { class: "wb-mod-dot" }),
            el("span", { class: "wb-caret", html: WBIcon("caret-down", 14) })
        ]);
        hd.addEventListener("click", function () { g.classList.toggle("open"); });
        g.appendChild(hd);
        g.appendChild(el("div", { class: "wb-prop-group-bd" }, [contentNode]));
        return g;
    }

    return {
        el: el,
        iconBtn: iconBtn,
        clear: clear,
        debounce: debounce,
        menu: menu,
        closeMenu: closeMenu,
        modal: modal,
        closeModal: closeModal,
        confirm: confirm,
        prompt: prompt,
        toast: toast,
        busy: busy,
        field: field,
        searchBox: searchBox,
        segment: segment,
        switchControl: switchControl,
        unitInput: unitInput,
        sliderRow: sliderRow,
        colorRow: colorRow,
        selectControl: selectControl,
        textInput: textInput,
        textArea: textArea,
        group: group,
        parseLength: parseLength
    };
})();
