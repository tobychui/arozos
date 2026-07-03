/*
    Cine Studio - UI primitives
    Toasts, anchored dropdown menus, modal dialogs and small helpers.
*/
"use strict";

window.CS = window.CS || {};

/* ---------- toast ---------- */

CS.toast = function (message, isError) {
    var holder = document.getElementById("toast-holder");
    var el = document.createElement("div");
    el.className = "toast" + (isError ? " error" : "");
    el.textContent = message;
    holder.appendChild(el);
    setTimeout(function () {
        el.style.transition = "opacity 0.25s";
        el.style.opacity = "0";
        setTimeout(function () { el.remove(); }, 260);
    }, isError ? 3600 : 2200);
};

/* ---------- dropdown / context menu ---------- */

// items: [{label, icon, checked, disabled, action}] or {sep:true}
CS.showMenu = function (items, x, y) {
    CS.closeMenu();
    var holder = document.getElementById("menu-holder");
    var menu = document.createElement("div");
    menu.className = "ctx-menu";

    items.forEach(function (item) {
        if (item.sep) {
            var sep = document.createElement("div");
            sep.className = "ctx-sep";
            menu.appendChild(sep);
            return;
        }
        var btn = document.createElement("button");
        btn.className = "ctx-item" + (item.checked ? " checked" : "");
        if (item.disabled) { btn.disabled = true; }
        btn.innerHTML = (item.icon ? '<span data-icon="' + item.icon + '"></span>' : "") +
            "<span></span>";
        btn.lastChild.textContent = item.label;
        btn.addEventListener("click", function (ev) {
            ev.stopPropagation();
            CS.closeMenu();
            if (item.action) { item.action(); }
        });
        menu.appendChild(btn);
    });

    holder.appendChild(menu);
    CS.applyIcons(menu);

    //Keep inside the viewport
    var rect = menu.getBoundingClientRect();
    var px = Math.min(x, window.innerWidth - rect.width - 8);
    var py = Math.min(y, window.innerHeight - rect.height - 8);
    menu.style.left = Math.max(4, px) + "px";
    menu.style.top = Math.max(4, py) + "px";

    setTimeout(function () {
        document.addEventListener("mousedown", CS._menuDismiss, true);
    }, 0);
};

CS.showMenuUnder = function (anchorEl, items) {
    var r = anchorEl.getBoundingClientRect();
    CS.showMenu(items, r.left, r.bottom + 6);
};

CS._menuDismiss = function (ev) {
    var holder = document.getElementById("menu-holder");
    if (!holder.contains(ev.target)) { CS.closeMenu(); }
};

CS.closeMenu = function () {
    document.getElementById("menu-holder").innerHTML = "";
    document.removeEventListener("mousedown", CS._menuDismiss, true);
};

/* ---------- modal dialogs ---------- */

// opts: { title, build(body), buttons:[{label, primary, keepOpen, action(modal)}], onClose }
CS.modal = function (opts) {
    CS.closeModal();
    var holder = document.getElementById("modal-holder");
    var modal = document.createElement("div");
    modal.className = "modal";

    var title = document.createElement("div");
    title.className = "modal-title";
    title.textContent = opts.title || "";
    modal.appendChild(title);

    var body = document.createElement("div");
    body.className = "modal-body";
    modal.appendChild(body);
    if (opts.build) { opts.build(body); }

    var btnRow = document.createElement("div");
    btnRow.className = "modal-buttons";
    (opts.buttons || [{ label: "Close" }]).forEach(function (b) {
        var btn = document.createElement("button");
        btn.className = "modal-btn" + (b.primary ? " primary" : "");
        btn.textContent = b.label;
        btn.addEventListener("click", function () {
            //An action returning false keeps / manages the modal itself
            var result = b.action ? b.action(modal) : undefined;
            if (result === false) { return; }
            if (!b.keepOpen) { CS.closeModal(); }
        });
        btnRow.appendChild(btn);
    });
    modal.appendChild(btnRow);

    holder.appendChild(modal);
    CS.applyIcons(modal);
    CS._modalOnClose = opts.onClose || null;
    return { modal: modal, body: body, buttons: btnRow };
};

CS.closeModal = function () {
    var holder = document.getElementById("modal-holder");
    if (holder.childNodes.length && CS._modalOnClose) {
        var cb = CS._modalOnClose;
        CS._modalOnClose = null;
        cb();
    }
    holder.innerHTML = "";
};

//Simple labelled row inside a modal body; control is a DOM element
CS.modalRow = function (body, labelText, control) {
    var row = document.createElement("div");
    row.className = "modal-row";
    var label = document.createElement("span");
    label.textContent = labelText;
    row.appendChild(label);
    row.appendChild(control);
    body.appendChild(row);
    return control;
};

CS.textInput = function (value) {
    var inp = document.createElement("input");
    inp.type = "text";
    inp.value = value || "";
    inp.setAttribute("autocomplete", "off");
    return inp;
};

CS.selectInput = function (options, value) {
    var sel = document.createElement("select");
    options.forEach(function (o) {
        var opt = document.createElement("option");
        opt.value = o.v;
        opt.textContent = o.l;
        sel.appendChild(opt);
    });
    sel.value = value;
    return sel;
};

CS.confirm = function (title, message, onYes) {
    CS.modal({
        title: title,
        build: function (body) {
            var p = document.createElement("div");
            p.className = "modal-note";
            p.style.fontSize = "12.5px";
            p.style.color = "var(--text-dim)";
            p.textContent = message;
            body.appendChild(p);
        },
        buttons: [
            { label: "Cancel" },
            { label: "OK", primary: true, action: onYes }
        ]
    });
};

/* ---------- misc helpers ---------- */

CS.clamp = function (v, min, max) { return v < min ? min : (v > max ? max : v); };

CS.uid = function () {
    return "c" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
};

CS.extOf = function (name) {
    var i = name.lastIndexOf(".");
    return i < 0 ? "" : name.slice(i + 1).toLowerCase();
};

CS.baseName = function (name) {
    var i = name.lastIndexOf(".");
    return i < 0 ? name : name.slice(0, i);
};

CS.dirOf = function (vpath) {
    var parts = vpath.split("/");
    parts.pop();
    return parts.join("/");
};

//Format seconds as HH:MM:SS:FF using the project frame rate
CS.timecode = function (seconds, fps) {
    fps = fps || (CS.project ? CS.project.settings.fps : 30);
    if (!isFinite(seconds) || seconds < 0) { seconds = 0; }
    var totalFrames = Math.round(seconds * fps);
    var f = totalFrames % fps;
    var totalSec = Math.floor(totalFrames / fps);
    var s = totalSec % 60;
    var m = Math.floor(totalSec / 60) % 60;
    var h = Math.floor(totalSec / 3600);
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return p(h) + ":" + p(m) + ":" + p(s) + ":" + p(f);
};

//Short mm:ss duration badge used in the media bin
CS.shortDuration = function (seconds) {
    if (!isFinite(seconds) || seconds <= 0) { return "00:00"; }
    var s = Math.round(seconds);
    var m = Math.floor(s / 60);
    s = s % 60;
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return p(m) + ":" + p(s);
};

//Update the --fill custom property so the slider track shows its filled part
CS.paintSlider = function (slider) {
    var min = parseFloat(slider.min) || 0;
    var max = parseFloat(slider.max) || 100;
    var v = parseFloat(slider.value);
    var pct = ((v - min) / (max - min)) * 100;
    slider.style.setProperty("--fill", pct + "%");
};
