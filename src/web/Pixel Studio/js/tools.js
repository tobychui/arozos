/*
    Pixel Studio - tool framework and built-in tools
    Left toolbar, options bar, pointer event pipeline, brush engine,
    shape drawing, selection tools, move / zoom / hand.
*/
"use strict";

/* ---------- default tool options (persisted in prefs) ---------- */

// (the Brush, Pencil and Eraser options are defined in brushes.js)
PS.toolOpts = {
    fill: { tolerance: 32, contiguous: true },
    gradient: { preset: "fg-bg", style: "linear", reverse: false, opacity: 1, stops: [] },
    wand: { tolerance: 32, contiguous: true, smart: true, edgeThreshold: 60 },
    marquee: { feather: 0, mode: "replace", style: "normal", ratioW: 1, ratioH: 1, fixedW: 64, fixedH: 64, dragInside: "pixels" },
    move: { showBounds: false },
    shape: { kind: "rect", mode: "both", strokeWidth: 6, radius: 12, points: 5, target: "layer" },
    text: { font: "Arial", fontStyle: "Regular", size: 48, align: "left", antiAlias: "smooth", charDefaults: {}, paraDefaults: {} },
    zoom: {},
    eyedropper: { sampleSize: 1, sample: "all" }
};

/* ---------- toolbar grouping (fly-out submenus) ---------- */

// Toolbar entries: single tools, tool groups (one button + right-click
// fly-out), and the shape picker (fly-out chooses the shape kind visually).
PS.toolbarLayout = [
    { kind: "single", tool: "move" },
    { kind: "group", id: "select", tools: ["marquee-rect", "marquee-ellipse"] },
    { kind: "group", id: "lasso", tools: ["lasso", "lasso-poly"] },
    { kind: "single", tool: "wand" },
    { kind: "single", tool: "crop" },
    { kind: "group", id: "measure", tools: ["eyedropper", "ruler", "note"] },
    { kind: "group", id: "heal", tools: ["spotheal", "heal"] },
    { kind: "group", id: "paint", tools: ["brush", "pencil"] },
    { kind: "single", tool: "clone" },
    { kind: "group", id: "erase", tools: ["eraser", "magic-eraser"] },
    { kind: "group", id: "bucket", tools: ["gradient", "fill"] },
    { kind: "group", id: "focus", tools: ["blur", "sharpen", "smudge"] },
    { kind: "group", id: "tone", tools: ["dodge", "burn", "sponge"] },
    { kind: "single", tool: "text" },
    { kind: "shape" },
    { kind: "single", tool: "hand" },
    { kind: "single", tool: "zoom" }
];

// Last-selected member shown on each group's toolbar button.
PS.groupRep = { select: "marquee-rect", lasso: "lasso", measure: "eyedropper", paint: "brush", bucket: "gradient", heal: "spotheal", erase: "eraser", focus: "blur", tone: "dodge" };

// Per-shape-kind icons for the shape fly-out and toolbar button.
PS.shapeIcons = {
    rect: '<svg viewBox="0 0 24 24" stroke-width="1.6"><rect x="4" y="6" width="16" height="12"/></svg>',
    rounded: '<svg viewBox="0 0 24 24" stroke-width="1.6"><rect x="4" y="6" width="16" height="12" rx="3.5"/></svg>',
    ellipse: '<svg viewBox="0 0 24 24" stroke-width="1.6"><ellipse cx="12" cy="12" rx="8" ry="6"/></svg>',
    line: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M5 19 19 5"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M4 20 20 4M20 4h-6M20 4v6"/></svg>',
    triangle: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M12 5 20 19H4z"/></svg>',
    star: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M12 3.5l2.5 5.6 6.1.6-4.6 4 1.4 6-5.4-3.2L6.1 19.7l1.4-6L2.9 9.7l6.1-.6z"/></svg>'
};

/* ---------- framework ---------- */

PS.registerTool = function (id, def) {
    def.id = id;
    PS.tools[id] = def;
};

// the canvas cursor of a tool (def.cursor: a CSS cursor or a function returning one)
PS.toolCursor = function (def) {
    def = def || PS.tools[PS.tool];
    var c = def && def.cursor;
    if (typeof c === "function") { c = c(); }
    return c || "crosshair";
};

PS.setTool = function (id) {
    if (!PS.tools[id]) { return; }
    if (PS.commitTextEdit) { PS.commitTextEdit(); }
    // switching tools applies an open transform
    if (PS.transform && PS.transform.active) { PS.transform.commit(); }
    PS.closeToolFlyout();
    var old = PS.tools[PS.tool];
    if (old && old.deactivate) { old.deactivate(); }
    PS.tool = id;
    // remember this tool as its toolbar group's representative
    PS.toolbarLayout.forEach(function (entry) {
        if (entry.kind === "group" && entry.tools.indexOf(id) >= 0) {
            PS.groupRep[entry.id] = id;
        }
    });
    PS.renderToolbar();
    PS.renderOptionsBar();
    var ws = PS.el("workspace");
    ws.style.cursor = PS.toolCursor(PS.tools[id]);
    if (PS.closeBrushPicker) { PS.closeBrushPicker(); }
    // the Brush panels follow the paint tool in use
    if (PS.ws && PS.BRUSH_TOOLS && PS.BRUSH_TOOLS.indexOf(id) >= 0) { PS.ws.refresh(); }
    PS.savePrefsDebounced();
};

PS.renderToolbar = function () {
    var host = PS.el("toolbar-buttons");
    host.innerHTML = "";
    PS.toolbarLayout.forEach(function (entry) {
        if (entry.kind === "single") {
            host.appendChild(PS._singleToolBtn(entry.tool));
        } else if (entry.kind === "group") {
            host.appendChild(PS._groupToolBtn(entry));
        } else if (entry.kind === "shape") {
            host.appendChild(PS._shapeToolBtn());
        }
    });
};

// build the base toolbar button (icon, active state, optional fly-out triangle)
PS._toolBtn = function (icon, title, active, hasFlyout) {
    var btn = document.createElement("button");
    btn.className = "tool-btn" + (active ? " active" : "");
    btn.title = title;
    btn.innerHTML = icon;
    if (hasFlyout) {
        var tri = document.createElement("span");
        tri.className = "flyout-tri";
        btn.appendChild(tri);
    }
    return btn;
};

// tooltip of a tool: name, shortcut and how to use it
PS.toolTitle = function (def, extra) {
    return def.name + (def.key ? " (" + def.key.toUpperCase() + ")" : "") + (extra || "") + (def.hint ? "\n" + def.hint : "");
};

PS._singleToolBtn = function (id) {
    var def = PS.tools[id];
    var btn = PS._toolBtn(def.icon, PS.toolTitle(def), PS.tool === id, false);
    btn.addEventListener("click", function () { PS.setTool(id); });
    return btn;
};

PS._groupToolBtn = function (entry) {
    var inGroup = entry.tools.indexOf(PS.tool) >= 0;
    var rep = inGroup ? PS.tool : PS.groupRep[entry.id];
    if (entry.tools.indexOf(rep) < 0) { rep = entry.tools[0]; }
    var def = PS.tools[rep];
    var btn = PS._toolBtn(def.icon, PS.toolTitle(def, " \u2014 right-click for more"), inGroup, true);
    btn.addEventListener("click", function () { PS.setTool(rep); });
    btn.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        PS.openToolFlyout(btn, entry.tools.map(function (t) {
            var d = PS.tools[t];
            return {
                icon: d.icon, label: d.name, active: PS.tool === t, title: PS.toolTitle(d),
                onSelect: function () { PS.setTool(t); }
            };
        }));
    });
    return btn;
};

PS._shapeToolBtn = function () {
    var kind = PS.toolOpts.shape.kind;
    var icon = PS.shapeIcons[kind] || PS.tools.shape.icon;
    var btn = PS._toolBtn(icon, PS.toolTitle(PS.tools.shape, " \u2014 right-click to pick a shape"),
        PS.tool === "shape", true);
    btn.addEventListener("click", function () { PS.setTool("shape"); });
    btn.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        PS.openToolFlyout(btn, PS.shapeKinds.map(function (k) {
            return {
                icon: PS.shapeIcons[k.v] || PS.tools.shape.icon,
                label: k.l,
                active: PS.tool === "shape" && PS.toolOpts.shape.kind === k.v,
                onSelect: function () {
                    PS.toolOpts.shape.kind = k.v;
                    PS.setTool("shape");
                    PS.savePrefsDebounced();
                }
            };
        }));
    });
    return btn;
};

/* ---------- tool fly-out submenu ---------- */

PS._toolFlyout = null;

PS.openToolFlyout = function (btn, items) {
    PS.closeToolFlyout();
    var fly = document.createElement("div");
    fly.className = "tool-flyout";
    items.forEach(function (it) {
        var row = document.createElement("div");
        row.className = "tool-flyout-item" + (it.active ? " active" : "");
        if (it.title) { row.title = it.title; }
        var ic = document.createElement("span");
        ic.className = "tfi-icon";
        ic.innerHTML = it.icon;
        var lb = document.createElement("span");
        lb.className = "tfi-label";
        lb.textContent = it.label;
        row.appendChild(ic);
        row.appendChild(lb);
        row.addEventListener("click", function (e) {
            e.stopPropagation();
            PS.closeToolFlyout();
            it.onSelect();
        });
        fly.appendChild(row);
    });
    document.body.appendChild(fly);

    // open to the right of the button, top edge aligned with the button top
    var r = btn.getBoundingClientRect();
    fly.style.left = Math.round(r.right + 2) + "px";
    fly.style.top = Math.round(r.top) + "px";
    var fr = fly.getBoundingClientRect();
    if (fr.bottom > window.innerHeight - 4) {
        fly.style.top = Math.max(4, window.innerHeight - fr.height - 4) + "px";
    }

    PS._toolFlyout = fly;
    setTimeout(function () {
        document.addEventListener("pointerdown", PS._flyoutOutside, true);
        document.addEventListener("keydown", PS._flyoutKey, true);
    }, 0);
};

PS.closeToolFlyout = function () {
    if (PS._toolFlyout) { PS._toolFlyout.remove(); PS._toolFlyout = null; }
    document.removeEventListener("pointerdown", PS._flyoutOutside, true);
    document.removeEventListener("keydown", PS._flyoutKey, true);
};

PS._flyoutOutside = function (e) {
    if (PS._toolFlyout && !PS._toolFlyout.contains(e.target)) { PS.closeToolFlyout(); }
};

PS._flyoutKey = function (e) {
    if (e.key === "Escape") { PS.closeToolFlyout(); }
};

PS.renderOptionsBar = function () {
    var host = PS.el("optionsbar");
    var reopen = PS._optMore && PS._optMore.open;
    PS.closeOptionsOverflow();
    host.innerHTML = "";
    if (PS.transform && PS.transform.active) {
        PS.transform.options(host);
    } else {
        var def = PS.tools[PS.tool];
        if (!def) { return; }
        var name = document.createElement("span");
        name.className = "tool-name";
        name.textContent = def.name;
        host.appendChild(name);
        if (def.options) { def.options(host); }
    }
    PS.fitOptionsBar(reopen);
};

/* ---------- options bar overflow ---------- */

// The options bar never scrolls: whatever does not fit moves, in order, into
// a drop-down behind a ">>" button at the end of the bar. Items marked with
// the class "opt-pin" (Commit / Cancel) always stay in the bar.
PS._optMore = null;     // {btn, panel, open}

PS.fitOptionsBar = function (reopen) {
    var host = PS.el("optionsbar");
    if (!host || host.offsetParent === null) { return; }
    if (host.scrollWidth <= host.clientWidth + 1) { return; }
    var kids = Array.prototype.slice.call(host.children);
    var pinned = kids.filter(function (k) { return k.classList.contains("opt-pin") || k.querySelector(".opt-pin"); });
    var free = kids.filter(function (k) { return pinned.indexOf(k) < 0; });

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "opt-icon-btn opt-more";
    btn.title = "More options";
    btn.innerHTML = '<svg viewBox="0 0 24 24" stroke-width="1.8"><path d="M6 7l5 5-5 5M13 7l5 5-5 5"/></svg>';
    // keep focus where it is (the type tool's editor)
    btn.addEventListener("mousedown", function (e) { e.preventDefault(); });
    pinned.forEach(function (k) { host.appendChild(k); });
    host.insertBefore(btn, pinned[0] || null);

    var moved = [];
    // the tool name always stays
    while (host.scrollWidth > host.clientWidth + 1 && free.length > 1) {
        var k = free.pop();
        host.removeChild(k);
        moved.unshift(k);
    }
    // no separator at the edges
    while (free.length > 1 && free[free.length - 1].classList.contains("opt-sep")) { host.removeChild(free.pop()); }
    while (moved.length && moved[0].classList.contains("opt-sep")) { moved.shift(); }
    if (!moved.length) { btn.remove(); return; }

    var panel = document.createElement("div");
    panel.className = "opt-overflow";
    moved.forEach(function (k) { panel.appendChild(k); });
    PS._optMore = { btn: btn, panel: panel, open: false };
    btn.addEventListener("click", function () {
        if (PS._optMore && PS._optMore.open) { PS.closeOptionsOverflow(true); } else { PS.openOptionsOverflow(); }
    });
    if (reopen) { PS.openOptionsOverflow(); }
};

PS.openOptionsOverflow = function () {
    var m = PS._optMore;
    if (!m || m.open) { return; }
    // a child of the bar (so the bar's styles apply), fixed so it is not clipped
    PS.el("optionsbar").appendChild(m.panel);
    m.open = true;
    m.btn.classList.add("active");
    var r = m.btn.getBoundingClientRect();
    var pr = m.panel.getBoundingClientRect();
    m.panel.style.left = Math.round(PS.clamp(r.right - pr.width, 4, Math.max(4, window.innerWidth - pr.width - 4))) + "px";
    m.panel.style.top = Math.round(r.bottom + 4) + "px";
    setTimeout(function () {
        document.addEventListener("pointerdown", PS._optMoreOutside, true);
        document.addEventListener("keydown", PS._optMoreKey, true);
    }, 0);
};

// keepState: close the drop-down only (the bar is not being rebuilt)
PS.closeOptionsOverflow = function (keepState) {
    var m = PS._optMore;
    document.removeEventListener("pointerdown", PS._optMoreOutside, true);
    document.removeEventListener("keydown", PS._optMoreKey, true);
    if (!m) { return; }
    if (m.panel.parentNode) { m.panel.parentNode.removeChild(m.panel); }
    m.open = false;
    m.btn.classList.remove("active");
    if (!keepState) { PS._optMore = null; }
};

PS._optMoreOutside = function (e) {
    var m = PS._optMore;
    if (!m || m.panel.contains(e.target) || m.btn.contains(e.target)) { return; }
    // a native <select> list or a popup opened from inside stays usable
    if (e.target.closest && e.target.closest(".menu-dropdown, .tool-flyout, .brush-picker, .float-panel, .dialog-overlay")) { return; }
    PS.closeOptionsOverflow(true);
};

PS._optMoreKey = function (e) {
    if (e.key === "Escape") { PS.closeOptionsOverflow(true); }
};

(function () {
    var timer = null;
    window.addEventListener("resize", function () {
        if (timer) { clearTimeout(timer); }
        timer = setTimeout(function () { timer = null; if (PS.doc || PS.tool) { PS.renderOptionsBar(); } }, 120);
    });
})();

/* ---------- pointer event pipeline ---------- */

PS._pointer = { down: false, panning: false, panStart: null, transforming: false, toolId: null, outline: null };

PS.bindWorkspaceEvents = function () {
    var ws = PS.el("workspace");
    var P = PS._pointer;

    ws.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        if (!PS.doc || P.down || PS.transform.active) { return; }
        if (PS.noteContextMenu && PS.noteContextMenu(e, PS.eventToDoc(e))) { return; }
        // the Move tool (or Ctrl with another tool) lists the layers under the pointer
        var ctrlMove = (e.ctrlKey || e.metaKey) && PS.TEMP_MOVE_TOOLS.indexOf(PS.tool) >= 0 && !PS.textEdit;
        if (PS.tool === "move" || ctrlMove) { PS.moveLayerMenu(e); }
    });

    function defaultCursor() { return PS.toolCursor(); }

    ws.addEventListener("pointerdown", function (e) {
        if (!PS.doc) { return; }
        if (e.button === 2) { return; }
        // ignore presses on the workspace scrollbars
        var wsRect = ws.getBoundingClientRect();
        if (e.clientX - wsRect.left > ws.clientWidth ||
            e.clientY - wsRect.top > ws.clientHeight) {
            return;
        }
        ws.setPointerCapture(e.pointerId);
        P.down = true;

        if (e.button === 1 || PS.spacePan || PS.tool === "hand") {
            P.panning = true;
            P.panStart = {
                x: e.clientX, y: e.clientY,
                sl: ws.scrollLeft, st: ws.scrollTop
            };
            ws.style.cursor = "grabbing";
            e.preventDefault();
            return;
        }

        var raw = PS.eventToDoc(e);
        var pt = PS.snapDocPoint(raw);
        e.preventDefault();

        // Select > Color Range samples colours from the image
        if (PS.colorRangePick) {
            PS.colorRangePick(pt, e);
            P.down = false;
            return;
        }
        // an open Free Transform takes every press
        if (PS.transform.active) {
            PS.transform.pointerDown(pt, e);
            P.transforming = true;
            return;
        }
        // selection handles start a transform of the selected pixels
        if (PS.selTransform.onDown(pt, e)) {
            P.transforming = true;
            return;
        }
        // grab an existing guide (Move tool) before handing off to the tool
        if (PS.guideDragStart(raw)) { return; }

        var toolId = PS.tool;
        var busy = PS.tools[toolId] && PS.tools[toolId].isBusy && PS.tools[toolId].isBusy();
        if ((e.ctrlKey || e.metaKey) && !busy && PS.TEMP_MOVE_TOOLS.indexOf(toolId) >= 0 && !PS.textEdit) {
            // Ctrl temporarily switches to the Move tool
            toolId = "move";
        } else if (PS.SELECTION_TOOLS.indexOf(toolId) >= 0 && !busy && !e.shiftKey && !e.altKey &&
            PS.selModeFromEvent(e) === "replace" && PS.doc.selection && PS.pointInSelection(pt)) {
            // dragging inside a selection moves it
            if ((PS.toolOpts.marquee.dragInside || "pixels") === "outline") {
                P.outline = { start: pt, sel: PS.doc.selection, dx: 0, dy: 0 };
                return;
            }
            PS.setTool("move");
            toolId = "move";
        }
        P.toolId = toolId;
        var def = PS.tools[toolId];
        if (def && def.onDown) { def.onDown(pt, e); }
    });

    ws.addEventListener("pointermove", function (e) {
        if (!PS.doc) { return; }
        var raw = PS.eventToDoc(e);
        PS.cursorPos = PS.snapDocPoint(raw);
        PS.updateCursorStatus();
        if (PS.sampleInfo) { PS.sampleInfo(); }

        if (P.panning) {
            var p = P.panStart;
            ws.scrollLeft = p.sl - (e.clientX - p.x);
            ws.scrollTop = p.st - (e.clientY - p.y);
            return;
        }
        if (PS.guidesDragging()) {
            PS.guideDragMove(raw);
            return;
        }
        if (P.transforming || PS.transform.active) {
            PS.transform.pointerMove(PS.cursorPos, e);
            return;
        }
        if (P.outline) {
            var o = P.outline;
            o.dx = Math.round(PS.cursorPos.x - o.start.x);
            o.dy = Math.round(PS.cursorPos.y - o.start.y);
            var m = PS.makeMaskCanvas();
            m.getContext("2d").drawImage(o.sel.mask, o.dx, o.dy);
            PS.doc.selection = PS.buildSelectionObject(m) || o.sel;
            return;
        }

        // hover cursors (handles, guides, the Ctrl move shortcut)
        if (!P.down) {
            var tCursor = PS.selTransform.getCursor(PS.cursorPos) || PS.moveBoundsCursor(PS.cursorPos);
            if (!tCursor) {
                var gh = PS.guideHitTest(raw);
                if (gh) { tCursor = (gh.orient === "h") ? "row-resize" : "col-resize"; }
            }
            if (!tCursor && (e.ctrlKey || e.metaKey) && PS.TEMP_MOVE_TOOLS.indexOf(PS.tool) >= 0 && !PS.textEdit) {
                tCursor = PS.cursors.move;
            }
            if (!tCursor && PS.SELECTION_TOOLS.indexOf(PS.tool) >= 0 && !e.shiftKey && !e.altKey &&
                PS.selModeFromEvent(e) === "replace" && PS.doc.selection && PS.pointInSelection(PS.cursorPos)) {
                tCursor = PS.cursors.move;
            }
            if (!tCursor && PS.tool === "move" && e.altKey) { tCursor = PS.cursors.moveCopy; }
            ws.style.cursor = tCursor || defaultCursor();
        }

        var def = PS.tools[P.down && P.toolId ? P.toolId : PS.tool];
        if (def && def.onMove) { def.onMove(PS.cursorPos, e); }
    });

    function finish(e) {
        if (!PS.doc) { return; }
        if (P.panning) {
            P.panning = false;
            ws.style.cursor = defaultCursor();
        } else if (PS.guidesDragging()) {
            PS.guideDragEnd(PS.eventToDoc(e));
            ws.style.cursor = defaultCursor();
        } else if (P.transforming) {
            P.transforming = false;
            PS.transform.pointerUp();
        } else if (P.outline) {
            var o = P.outline;
            P.outline = null;
            PS.doc.selection = o.sel;
            if (o.dx || o.dy) {
                var m = PS.makeMaskCanvas();
                m.getContext("2d").drawImage(o.sel.mask, o.dx, o.dy);
                PS.setSelection(m, "replace", "Move Selection");
            }
        } else if (P.down) {
            var def = PS.tools[P.toolId || PS.tool];
            if (def && def.onUp) { def.onUp(PS.snapDocPoint(PS.eventToDoc(e)), e); }
        }
        P.down = false;
        P.toolId = null;
    }

    ws.addEventListener("pointerup", finish);
    ws.addEventListener("pointercancel", finish);

    ws.addEventListener("dblclick", function (e) {
        var pt = PS.eventToDoc(e);
        if (PS.transform.active) {
            // double-click inside the box commits
            var h = PS.transform.hit(pt);
            if (h && h.type === "move") { PS.transform.commit(); }
            return;
        }
        var def = PS.tools[PS.tool];
        if (def && def.onDblClick) { def.onDblClick(pt, e); }
    });

    // Ctrl+wheel zoom at pointer, plain wheel scrolls (default), Alt+wheel zooms too
    ws.addEventListener("wheel", function (e) {
        if (!PS.doc) { return; }
        if (e.ctrlKey || e.altKey) {
            e.preventDefault();
            var pt = PS.eventToDoc(e);
            PS.setZoom(PS.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), pt);
        }
    }, { passive: false });

    ws.addEventListener("pointerleave", function () {
        PS.cursorPos = null;
        PS.updateCursorStatus();
    });
};

// Tools Ctrl turns into the Move tool for one drag
PS.TEMP_MOVE_TOOLS = ["marquee-rect", "marquee-ellipse", "lasso", "lasso-poly", "wand", "brush", "pencil",
    "eraser", "fill", "gradient", "shape", "crop", "clone", "dodge", "burn", "sponge", "blur", "sharpen", "smudge",
    "pen", "eyedropper-color", "spotheal", "heal", "magic-eraser"];
PS.SELECTION_TOOLS = ["marquee-rect", "marquee-ellipse", "lasso", "lasso-poly", "wand"];

/* ---------- shared helpers ---------- */

// selection combine mode from modifier keys, else the options bar buttons
PS.selModeFromEvent = function (e) {
    if (e.shiftKey && e.altKey) { return "intersect"; }
    if (e.shiftKey) { return "add"; }
    if (e.altKey) { return "subtract"; }
    return PS.toolOpts.marquee.mode || "replace";
};

PS.SEL_MODE_ICONS = {
    replace: '<svg viewBox="0 0 24 24" stroke-width="1.4"><rect x="5" y="6" width="14" height="12" fill="currentColor" fill-opacity="0.35"/></svg>',
    add: '<svg viewBox="0 0 24 24" stroke-width="1.4"><path d="M3 4h11v5h7v11H10v-5H3z" fill="currentColor" fill-opacity="0.35"/></svg>',
    subtract: '<svg viewBox="0 0 24 24" stroke-width="1.4"><path d="M3 4h11v5h-4v6H3z" fill="currentColor" fill-opacity="0.35"/><rect x="10" y="9" width="11" height="11"/></svg>',
    intersect: '<svg viewBox="0 0 24 24" stroke-width="1.4"><rect x="3" y="4" width="11" height="11"/><rect x="10" y="9" width="11" height="11"/><rect x="10" y="9" width="4" height="6" fill="currentColor" fill-opacity="0.6"/></svg>'
};

// New / Add / Subtract / Intersect buttons and what dragging inside a
// selection does, shared by every selection tool's options bar
PS.selectionModeOptions = function (host) {
    var o = PS.toolOpts.marquee;
    var g = PS.ui.group(host);
    [["replace", "New selection"], ["add", "Add to selection (Shift)"], ["subtract", "Subtract from selection (Alt)"],
        ["intersect", "Intersect with selection (Shift+Alt)"]].forEach(function (m) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "opt-icon-btn" + ((o.mode || "replace") === m[0] ? " active" : "");
        b.title = m[1];
        b.innerHTML = PS.SEL_MODE_ICONS[m[0]];
        b.addEventListener("click", function () {
            o.mode = m[0];
            PS.savePrefsDebounced();
            PS.renderOptionsBar();
        });
        g.appendChild(b);
    });
    PS.ui.sep(host);
};

PS.selectionDragOption = function (host) {
    var o = PS.toolOpts.marquee;
    var s = PS.ui.select(host, "Drag inside:", [{ v: "pixels", l: "Move pixels" }, { v: "outline", l: "Move outline" }],
        o.dragInside || "pixels", function (v) { o.dragInside = v; PS.savePrefsDebounced(); });
    s.title = "Dragging inside a selection (New selection mode) switches to the Move tool, or moves only the selection outline";
};

// The canvas tools paint on: the active layer's pixels, or its mask while
// the mask thumbnail is targeted. Explains (toast) and returns null when the
// target cannot be painted: wrong layer kind, hidden, or pixels locked.
PS.requirePaintableLayer = function () {
    if (PS.doc && PS.doc.quickMask) { return PS.doc.quickMask.target; }
    var layer = PS.activeLayer();
    if (!layer) { return null; }
    var target = PS.paintTarget();
    if (target.isMaskTarget) {
        if (!layer.visible) { PS.toast("Layer is hidden", true); return null; }
        return target;
    }
    if (layer.kind !== "raster") {
        var what = {
            text: "Text layer", shape: "Shape layer", fill: "Fill layer", smart: "Smart object",
            adjustment: "Adjustment layer", group: "Group"
        }[layer.kind] || "This layer";
        if (layer.kind === "group" || layer.kind === "adjustment") {
            PS.toast(what + " has no pixels to paint on" + (layer.mask ? " - click its mask thumbnail to paint the mask" : ""), true);
        } else {
            PS.toast(what + ": rasterize it first (Layer menu) to paint on it", true);
        }
        return null;
    }
    if (!layer.visible) {
        PS.toast("Layer is hidden", true);
        return null;
    }
    if (layer.locks.pixels) {
        PS.toast("Layer pixels are locked", true);
        return null;
    }
    return layer;
};

// Pick a colour (Eyedropper, Alt-click with the paint tools): the average
// of the Eyedropper's sample size, from every layer or the current one
PS.sampleColorAt = function (pt, comp, toBg) {
    var x = Math.floor(pt.x), y = Math.floor(pt.y);
    if (x < 0 || y < 0 || x >= PS.doc.width || y >= PS.doc.height) { return; }
    var o = PS.toolOpts.eyedropper;
    var src = comp;
    if (o.sample === "layer") {
        var t = PS.activeLayer() ? PS.paintTarget() : null;
        if (t && t.canvas) { src = t.canvas; }
    }
    var n = Math.max(1, o.sampleSize || 1), h = Math.floor(n / 2);
    var x0 = Math.max(0, x - h), y0 = Math.max(0, y - h);
    var x1 = Math.min(PS.doc.width, x - h + n), y1 = Math.min(PS.doc.height, y - h + n);
    var d = src.getContext("2d").getImageData(x0, y0, x1 - x0, y1 - y0).data;
    var r = 0, g = 0, b = 0, a = 0;
    for (var i = 0; i < d.length; i += 4) {
        r += d[i] * d[i + 3]; g += d[i + 1] * d[i + 3]; b += d[i + 2] * d[i + 3]; a += d[i + 3];
    }
    if (a === 0) { return; }
    var hex = PS.rgbToHex(r / a, g / a, b / a, a / (d.length / 4));
    if (toBg) { PS.setBg(hex); } else { PS.setFg(hex); }
};

// draw helper used by tool overlays: transform overlay ctx into doc space
PS.overlayDocSpace = function (ctx, fn) {
    var origin = PS.docToOverlay(0, 0);
    ctx.save();
    ctx.translate(origin.x, origin.y);
    ctx.scale(PS.zoom, PS.zoom);
    fn(1 / PS.zoom); // pass screen-pixel size in doc units
    ctx.restore();
};

// circular size cursor for paint tools
PS.paintCursorOverlay = function (size, square) {
    return function (ctx) {
        if (!PS.cursorPos || PS._pointer.panning) { return; }
        var p = PS.docToOverlay(PS.cursorPos.x, PS.cursorPos.y);
        var r = (typeof size === "function" ? size() : size) * PS.zoom / 2;
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (square) {
            ctx.rect(p.x - r, p.y - r, r * 2, r * 2);
        } else {
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        }
        ctx.stroke();
        ctx.strokeStyle = "rgba(0,0,0,0.6)";
        ctx.beginPath();
        if (square) {
            ctx.rect(p.x - r - 1, p.y - r - 1, r * 2 + 2, r * 2 + 2);
        } else {
            ctx.arc(p.x, p.y, r + 1, 0, Math.PI * 2);
        }
        ctx.stroke();
    };
};

/* ============================================================
   TOOL DEFINITIONS
   ============================================================ */

/* ----- Move (V) ----- */
(function () {
    var drag = null;
    var HANDLE_PX = 8;   // handle square size, screen pixels
    var ROTATE_PX = 26;  // reach of the rotate zone outside the handles, screen pixels
    var hover = null;    // {layer, at}: what Auto-Select would pick under the pointer
    var hoverTimer = null;

    // the 8 transform handles of a box (Show Transform Controls)
    function cornerPositions(b) {
        var x = b.x, y = b.y, r = b.x + b.w, bot = b.y + b.h, mx = (x + r) / 2, my = (y + bot) / 2;
        return {
            tl: { x: x, y: y }, t: { x: mx, y: y }, tr: { x: r, y: y }, r: { x: r, y: my },
            br: { x: r, y: bot }, b: { x: mx, y: bot }, bl: { x: x, y: bot }, l: { x: x, y: my }
        };
    }

    function centreOf(b) { return { x: b.x + b.w / 2, y: b.y + b.h / 2 }; }

    // visible layers with a pixel under pt, topmost first
    PS.layersAtPoint = function (pt) {
        var x = Math.floor(pt.x), y = Math.floor(pt.y);
        if (!PS.doc || x < 0 || y < 0 || x >= PS.doc.width || y >= PS.doc.height) { return []; }
        var out = [];
        PS.layerDisplayList(true).forEach(function (row) {
            var l = row.layer;
            if (!l.canvas || !PS.isEffectivelyVisible(l)) { return; }
            if (l.canvas.getContext("2d").getImageData(x, y, 1, 1).data[3] > 16) { out.push(l); }
        });
        return out;
    };

    // Auto-Select: the topmost visible layer with a pixel under the pointer
    PS.layerAtPoint = function (pt, wantGroup) {
        var l = PS.layersAtPoint(pt)[0];
        if (!l) { return null; }
        if (wantGroup) {
            var anc = PS.ancestorsOf(l);
            return anc.length ? anc[anc.length - 1] : l;
        }
        return l;
    };

    // What the transform controls grab at pt: {type: "handle", id} |
    // {type: "rotate"} | null. The box is the one Free Transform would use.
    function boundsHit(pt) {
        if (!pt || PS.tool !== "move" || !PS.toolOpts.move.showBounds || PS.transform.active) { return null; }
        var b = PS.transform.layersBox();
        if (!b) { return null; }
        var corners = cornerPositions(b);
        var hitR = (HANDLE_PX / 2 + 3) / PS.zoom;
        var id;
        for (id in corners) {
            var c = corners[id];
            if (Math.abs(pt.x - c.x) <= hitR && Math.abs(pt.y - c.y) <= hitR) { return { type: "handle", id: id, box: b }; }
        }
        // a little further out than a handle, outside the box: rotate
        var inside = pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h;
        if (!inside) {
            var reach = ROTATE_PX / PS.zoom;
            for (id in corners) {
                if (Math.hypot(pt.x - corners[id].x, pt.y - corners[id].y) <= reach) { return { type: "rotate", box: b }; }
            }
        }
        return null;
    }

    // cursor hint for the central pointer pipeline (hover, not dragging)
    PS.moveBoundsCursor = function (pt) {
        var h = boundsHit(pt);
        if (!h) { return null; }
        var c = centreOf(h.box);
        if (h.type === "handle") {
            var hp = cornerPositions(h.box)[h.id];
            return PS.cursors.resize(Math.atan2(hp.y - c.y, hp.x - c.x));
        }
        return PS.cursors.rotate(Math.atan2(pt.y - c.y, pt.x - c.x));
    };

    function autoSelectOn(e) {
        return !!PS.toolOpts.move.autoSelect !== !!(e && (e.ctrlKey || e.metaKey));
    }

    // outline the layer Auto-Select would pick (checked a moment after the
    // pointer settles, so sweeping across the canvas stays cheap)
    PS.moveHoverUpdate = function (pt, e) {
        if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
        if (!pt || PS.tool !== "move" || drag || PS.transform.active || !autoSelectOn(e) || PS.doc.selection) {
            hover = null;
            return;
        }
        var wantGroup = PS.toolOpts.move.autoTarget === "group";
        hoverTimer = setTimeout(function () {
            hoverTimer = null;
            if (!PS.cursorPos || PS._pointer.down) { hover = null; return; }
            var l = PS.layerAtPoint(PS.cursorPos, wantGroup);
            hover = l ? { layer: l } : null;
        }, 40);
    };

    // right-click with the Move tool: pick from the layers under the pointer
    PS.moveLayerMenu = function (e) {
        var pt = PS.eventToDoc(e);
        var hits = PS.layersAtPoint(pt);
        if (!hits.length) { return false; }
        PS.contextMenu(e.clientX, e.clientY, hits.map(function (l) {
            return {
                label: l.name,
                checked: function () { return PS.activeLayer() === l; },
                action: function () {
                    PS.clearLayerSelection();
                    PS.setActiveLayer(l);
                    PS.renderLayersPanel();
                    PS.requestRender();
                }
            };
        }));
        return true;
    };

    function drawBox(ctx, b, color, handles, label) {
        var z = PS.zoom;
        var origin = PS.docToOverlay(0, 0);
        var sx = origin.x + b.x * z, sy = origin.y + b.y * z;
        var sw = b.w * z, sh = b.h * z;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.strokeRect(Math.round(sx) + 0.5, Math.round(sy) + 0.5, Math.round(sw), Math.round(sh));
        if (handles) {
            var hs = HANDLE_PX, hh = hs / 2;
            [{ x: sx, y: sy }, { x: sx + sw / 2, y: sy }, { x: sx + sw, y: sy }, { x: sx + sw, y: sy + sh / 2 },
                { x: sx + sw, y: sy + sh }, { x: sx + sw / 2, y: sy + sh }, { x: sx, y: sy + sh }, { x: sx, y: sy + sh / 2 }]
                .forEach(function (hp) {
                    var hx = Math.round(hp.x), hy = Math.round(hp.y);
                    ctx.fillStyle = "rgba(30,30,30,0.75)";
                    ctx.fillRect(hx - hh - 1, hy - hh - 1, hs + 2, hs + 2);
                    ctx.fillStyle = "#ffffff";
                    ctx.fillRect(hx - hh, hy - hh, hs, hs);
                });
        }
        if (label) {
            ctx.font = "11px sans-serif";
            var tw = ctx.measureText(label).width;
            var ly = sy - 8;
            ctx.fillStyle = "rgba(30,30,30,0.85)";
            ctx.fillRect(sx, ly - 12, tw + 8, 16);
            ctx.fillStyle = "#ffffff";
            ctx.textBaseline = "middle";
            ctx.fillText(label, sx + 4, ly - 4);
        }
        ctx.restore();
    }

    PS.registerTool("move", {
        name: "Move",
        key: "v",
        cursor: PS.cursors.move,
        icon: '<svg viewBox="0 0 24 24" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round">' +
            '<path d="M4 3v13.2l3.3-3.1 2.3 5.1 2.2-1-2.3-5h4.7z"/>' +
            '<path d="M17.5 11.5v9M13 16h9M16 13l1.5-1.5 1.5 1.5M16 19l1.5 1.5 1.5-1.5M14.5 14.5 13 16l1.5 1.5M20.5 14.5 22 16l-1.5 1.5"/></svg>',
        options: function (host) {
            var o = PS.toolOpts.move;
            var auto = PS.ui.checkbox(host, "Auto-Select:", o.autoSelect, function (v) {
                o.autoSelect = v;
                PS.savePrefsDebounced();
            });
            auto.parentNode.title = "Click picks the layer under the pointer (hold Ctrl to flip). Right-click lists every layer there.";
            PS.ui.select(host, "", [{ v: "layer", l: "Layer" }, { v: "group", l: "Group" }], o.autoTarget || "layer", function (v) {
                o.autoTarget = v;
                PS.savePrefsDebounced();
            });
            var stc = PS.ui.checkbox(host, "Show Transform Controls", o.showBounds, function (v) {
                o.showBounds = v;
                PS.savePrefsDebounced();
            });
            stc.parentNode.title = "Handles around the selected layers: drag a handle to scale, just outside one to rotate";
            PS.ui.sep(host);
            var g = PS.ui.group(host);
            [["left", "Align left edges"], ["hcenter", "Align horizontal centers"], ["right", "Align right edges"],
                ["top", "Align top edges"], ["vcenter", "Align vertical centers"], ["bottom", "Align bottom edges"]].forEach(function (a) {
                var b = document.createElement("button");
                b.className = "opt-icon-btn";
                b.innerHTML = PS.ALIGN_ICONS[a[0]];
                b.title = a[1] + " (selected layers, or to the selection)";
                b.addEventListener("click", function () { PS.alignLayers(a[0]); });
                g.appendChild(b);
            });
            PS.ui.sep(host);
            var g2 = PS.ui.group(host);
            [["dleft", "Distribute left edges"], ["dhcenter", "Distribute horizontal centers"],
                ["dtop", "Distribute top edges"], ["dvcenter", "Distribute vertical centers"]].forEach(function (a) {
                var b = document.createElement("button");
                b.className = "opt-icon-btn";
                b.innerHTML = PS.ALIGN_ICONS[a[0]];
                b.title = a[1] + " (three or more layers)";
                b.addEventListener("click", function () { PS.distributeLayers(a[0]); });
                g2.appendChild(b);
            });
        },
        onDown: function (pt, e) {
            var o = PS.toolOpts.move;
            hover = null;

            // the transform controls: a handle scales, just outside one rotates;
            // both open Free Transform with the drag already under way
            var bh = boundsHit(pt);
            if (bh && PS.transform.begin({ kind: "layers" })) {
                PS.transform.pointerDown(pt, e, bh.type === "rotate" ? "rotate" : bh.id);
                PS._pointer.transforming = true;
                return;
            }

            // Auto-Select picks the layer under the pointer (Ctrl flips the option)
            var auto = autoSelectOn(e) && PS.tool === "move";
            if (auto && !PS.doc.selection) {
                var hitLayer = PS.layerAtPoint(pt, o.autoTarget === "group");
                if (hitLayer && hitLayer !== PS.activeLayer()) {
                    if (e.shiftKey) {
                        var sel0 = PS.selectedLayers();
                        if (sel0.indexOf(hitLayer) < 0) { sel0.push(hitLayer); }
                        PS.setLayerSelection(sel0);
                    } else {
                        PS.clearLayerSelection();
                    }
                    PS.setActiveLayer(hitLayer);
                    PS.renderLayersPanel();
                }
            }
            var layer = PS.activeLayer();
            if (!layer) { return; }

            var sel = PS.doc.selection;
            var target = PS.paintTarget();
            var inSel = sel && PS.pointInSelection(pt) && PS.isPaintable(target);

            if (!inSel) {
                // move whole layers (every selected one; groups bring their contents)
                var movable = function (l) {
                    return !l.locks.position && !PS.ancestorsOf(l).some(function (a) { return a.locks.position; });
                };
                if (!PS.withLinkedLayers(PS.topLevelSelected()).filter(movable).length) {
                    PS.toast("Layer position is locked", true);
                    return;
                }
                // Alt-drag moves a copy
                if (e.altKey) { PS.duplicateLayer(); }
                var movers = PS.withLinkedLayers(PS.topLevelSelected()).filter(movable);
                drag = {
                    mode: "layers",
                    layers: movers,
                    start: pt,
                    dx: 0, dy: 0
                };
                PS.movePreview = { layers: PS.expandWithDescendants(movers), dx: 0, dy: 0 };
                return;
            }
            if (target.locks.pixels || target.locks.position) {
                PS.toast("Layer is locked", true);
                return;
            }
            layer = target;

            // the selected pixels float; Alt-drag leaves the originals in place
            var base = PS.cloneCanvas(layer.canvas);
            var float = PS.getSelectedPixels(layer.canvas).canvas;
            if (!e.altKey) {
                var bctx = base.getContext("2d");
                bctx.globalCompositeOperation = "destination-out";
                bctx.drawImage(sel.mask, 0, 0);
            }

            drag = {
                mode: "raster",
                layer: layer,
                start: pt,
                before: PS.snapshotLayer(layer),
                beforeSel: sel,
                base: base,
                float: float,
                withSel: true,
                copy: !!e.altKey,
                preview: PS.createCanvas(PS.doc.width, PS.doc.height),
                dx: 0, dy: 0
            };
        },
        onMove: function (pt, e) {
            if (!drag) { PS.moveHoverUpdate(pt, e); return; }
            var mdx = pt.x - drag.start.x, mdy = pt.y - drag.start.y;
            if (e && e.shiftKey) {
                // Shift constrains to horizontal / vertical
                if (Math.abs(mdx) > Math.abs(mdy)) { mdy = 0; } else { mdx = 0; }
            }
            drag.dx = Math.round(mdx);
            drag.dy = Math.round(mdy);
            if (drag.mode === "layers") {
                PS.movePreview.dx = drag.dx;
                PS.movePreview.dy = drag.dy;
                PS.requestRender();
                return;
            }
            var pctx = drag.preview.getContext("2d");
            pctx.clearRect(0, 0, drag.preview.width, drag.preview.height);
            pctx.drawImage(drag.base, 0, 0);
            pctx.drawImage(drag.float, drag.dx, drag.dy);
            PS.layerOverride = { layer: drag.layer, canvas: drag.preview };
            PS.requestRender();
        },
        onUp: function () {
            if (!drag) { return; }
            if (drag.mode === "layers") {
                PS.movePreview = null;
                if (drag.dx || drag.dy) { PS.translateLayers(drag.layers, drag.dx, drag.dy, "Move"); }
                drag = null;
                PS.requestRender();
                return;
            }

            PS.layerOverride = null;
            if (drag.dx !== 0 || drag.dy !== 0 || drag.copy) {
                var lyr = drag.layer;
                var ctx = lyr.canvas.getContext("2d");
                ctx.clearRect(0, 0, lyr.canvas.width, lyr.canvas.height);
                ctx.drawImage(drag.base, 0, 0);
                ctx.drawImage(drag.float, drag.dx, drag.dy);

                var beforeCanvas = drag.before;
                var afterCanvas = PS.cloneCanvas(lyr.canvas);
                var beforeSel = drag.beforeSel;
                var afterSel = beforeSel;
                if (drag.withSel) {
                    PS.translateSelection(drag.dx, drag.dy);
                    afterSel = PS.doc.selection;
                }
                PS.pushHistory(drag.copy ? "Duplicate" : "Move",
                    function () {
                        PS.restoreLayerCanvas(lyr, beforeCanvas);
                        PS.doc.selection = beforeSel;
                    },
                    function () {
                        PS.restoreLayerCanvas(lyr, afterCanvas);
                        PS.doc.selection = afterSel;
                    });
            }
            drag = null;
            PS.requestRender();
        },
        deactivate: function () { hover = null; },
        overlay: function (ctx) {
            if (PS.transform.active) { return; }
            // the layer Auto-Select would pick
            if (hover && !drag && hover.layer !== PS.activeLayer() && PS.allLayers().indexOf(hover.layer) >= 0) {
                var hb = PS.layerContentBounds(hover.layer);
                if (hb) { drawBox(ctx, hb, "#3d8ee6", false, null); }
            }
            if (!PS.toolOpts.move.showBounds) { return; }
            var b = PS.transform.layersBox();
            if (!b) { return; }
            if (drag && drag.mode === "layers" && (drag.dx || drag.dy)) { b = { x: b.x + drag.dx, y: b.y + drag.dy, w: b.w, h: b.h }; }
            drawBox(ctx, b, "#202020", true, Math.round(b.w) + " x " + Math.round(b.h) + " px");
        }
    });

    // arrow-key nudge (called from hotkeys)
    PS.nudgeMove = function (dx, dy) {
        var layer = PS.activeLayer();
        if (!layer) { return; }
        var target = PS.paintTarget();
        if (!PS.doc.selection || !PS.isPaintable(target)) {
            var movers = PS.withLinkedLayers(PS.topLevelSelected()).filter(function (l) { return !l.locks.position; });
            if (!movers.length) { PS.toast("Layer position is locked", true); return; }
            PS.translateLayers(movers, dx, dy, "Nudge");
            return;
        }
        layer = target;
        var before = PS.snapshotLayer(layer);
        var moved = PS.createCanvas(PS.doc.width, PS.doc.height);
        moved.getContext("2d").drawImage(layer.canvas, dx, dy);
        var ctx = layer.canvas.getContext("2d");
        ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
        ctx.drawImage(moved, 0, 0);
        if (PS.doc.selection) { PS.translateSelection(dx, dy); }
        PS.commitLayerCanvas("Nudge", layer, before);
        PS.requestRender();
    };

    PS.pointInSelection = function (pt) {
        var sel = PS.doc.selection;
        if (!sel) { return false; }
        var x = Math.floor(pt.x), y = Math.floor(pt.y);
        if (x < 0 || y < 0 || x >= PS.doc.width || y >= PS.doc.height) { return false; }
        var a = sel.mask.getContext("2d").getImageData(x, y, 1, 1).data[3];
        return a >= 128;
    };
})();

/* ----- Marquee selections (M) ----- */
(function () {
    function makeMarquee(id, name, ellipse, icon) {
        var drag = null;
        PS.registerTool(id, {
            name: name,
            key: "m",
            group: "marquee",
            cursor: "crosshair",
            icon: icon,
            options: function (host) {
                var o = PS.toolOpts.marquee;
                PS.selectionModeOptions(host);
                PS.ui.numeric(host, "Feather:", o.feather, 0, 250, 1, function (v) {
                    o.feather = v;
                    PS.savePrefsDebounced();
                }, "px");
                PS.ui.sep(host);
                PS.ui.select(host, "Style:", [{ v: "normal", l: "Normal" }, { v: "ratio", l: "Fixed Ratio" }, { v: "size", l: "Fixed Size" }],
                    o.style || "normal", function (v) { o.style = v; PS.savePrefsDebounced(); PS.renderOptionsBar(); });
                if (o.style === "ratio" || o.style === "size") {
                    var isSize = o.style === "size";
                    PS.ui.numeric(host, "Width:", isSize ? o.fixedW : o.ratioW, isSize ? 1 : 0.001, isSize ? 30000 : 1000, isSize ? 1 : 0.001, function (v) {
                        if (isSize) { o.fixedW = v; } else { o.ratioW = v; }
                        PS.savePrefsDebounced();
                    }, isSize ? "px" : "");
                    var swap = document.createElement("button");
                    swap.type = "button";
                    swap.className = "opt-icon-btn";
                    swap.title = "Swap height and width";
                    swap.innerHTML = '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M4 9h14l-4-4M20 15H6l4 4"/></svg>';
                    swap.addEventListener("click", function () {
                        var t;
                        if (isSize) { t = o.fixedW; o.fixedW = o.fixedH; o.fixedH = t; }
                        else { t = o.ratioW; o.ratioW = o.ratioH; o.ratioH = t; }
                        PS.savePrefsDebounced();
                        PS.renderOptionsBar();
                    });
                    host.appendChild(swap);
                    PS.ui.numeric(host, "Height:", isSize ? o.fixedH : o.ratioH, isSize ? 1 : 0.001, isSize ? 30000 : 1000, isSize ? 1 : 0.001, function (v) {
                        if (isSize) { o.fixedH = v; } else { o.ratioH = v; }
                        PS.savePrefsDebounced();
                    }, isSize ? "px" : "");
                }
                PS.ui.sep(host);
                PS.selectionDragOption(host);
            },
            onDown: function (pt, e) {
                drag = { start: pt, cur: pt, mode: PS.selModeFromEvent(e), constrain: false };
            },
            onMove: function (pt, e) {
                if (!drag) { return; }
                drag.cur = pt;
                drag.constrain = e.shiftKey && drag.mode === "replace";
            },
            onUp: function (pt) {
                if (!drag) { return; }
                var r = normRect(drag.start, drag.cur, drag.constrain);
                var mode = drag.mode;
                drag = null;
                if (r.w < 2 && r.h < 2) {
                    if (mode === "replace") { PS.deselect(); }
                    return;
                }
                var mask = PS.maskFromRect(r.x, r.y, r.w, r.h, ellipse);
                var feather = PS.toolOpts.marquee.feather;
                if (feather > 0) {
                    var soft = PS.makeMaskCanvas();
                    var sctx = soft.getContext("2d");
                    sctx.filter = "blur(" + feather + "px)";
                    sctx.drawImage(mask, 0, 0);
                    sctx.filter = "none";
                    mask = soft;
                }
                PS.setSelection(mask, mode, name);
            },
            overlay: function (ctx) {
                if (!drag) { return; }
                var r = normRect(drag.start, drag.cur, drag.constrain);
                PS.overlayDocSpace(ctx, function (px) {
                    ctx.lineWidth = px;
                    ctx.setLineDash([4 * px, 4 * px]);
                    ctx.strokeStyle = "#fff";
                    ctx.beginPath();
                    if (ellipse) {
                        ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
                    } else {
                        ctx.rect(r.x, r.y, r.w, r.h);
                    }
                    ctx.stroke();
                    ctx.strokeStyle = "#000";
                    ctx.lineDashOffset = 4 * px;
                    ctx.stroke();
                });
            }
        });
    }

    function normRect(a, b, constrain) {
        var w = b.x - a.x, h = b.y - a.y;
        var o = PS.toolOpts.marquee;
        if (o.style === "size") {
            // Fixed Size: the box hangs from the click point
            return { x: Math.round(b.x - o.fixedW / 2), y: Math.round(b.y - o.fixedH / 2), w: o.fixedW, h: o.fixedH };
        }
        if (o.style === "ratio" && o.ratioW > 0 && o.ratioH > 0) {
            var k = o.ratioH / o.ratioW;
            if (Math.abs(h) < Math.abs(w) * k) { h = (h < 0 ? -1 : 1) * Math.abs(w) * k; }
            else { w = (w < 0 ? -1 : 1) * Math.abs(h) / k; }
        } else if (constrain) {
            var m = Math.max(Math.abs(w), Math.abs(h));
            w = (w < 0 ? -m : m);
            h = (h < 0 ? -m : m);
        }
        return {
            x: Math.min(a.x, a.x + w),
            y: Math.min(a.y, a.y + h),
            w: Math.abs(w),
            h: Math.abs(h)
        };
    }

    makeMarquee("marquee-rect", "Rectangular Marquee", false,
        '<svg viewBox="0 0 24 24" stroke-width="1.6"><rect x="4" y="6" width="16" height="12" stroke-dasharray="3 2.5"/></svg>');
    makeMarquee("marquee-ellipse", "Elliptical Marquee", true,
        '<svg viewBox="0 0 24 24" stroke-width="1.6"><ellipse cx="12" cy="12" rx="8" ry="6" stroke-dasharray="3 2.5"/></svg>');
})();

/* ----- Lasso tools (L) ----- */
(function () {
    // freehand lasso
    var path = null;
    PS.registerTool("lasso", {
        name: "Lasso",
        key: "l",
        group: "lasso",
        cursor: "crosshair",
        icon: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M5 10c0-3.5 3.5-6 7.5-6S20 6.5 20 10s-3.5 6-7.5 6c-1.2 0-2.4-.2-3.4-.6M8 14.5c-1 2.5-2.5 4-4.5 4.5M8 14.5c.6 1.4.2 2.8-1 3.4"/></svg>',
        options: function (host) {
            PS.selectionModeOptions(host);
            PS.selectionDragOption(host);
        },
        onDown: function (pt, e) {
            path = { points: [pt], mode: PS.selModeFromEvent(e) };
        },
        onMove: function (pt) {
            if (!path) { return; }
            var last = path.points[path.points.length - 1];
            if (Math.hypot(pt.x - last.x, pt.y - last.y) >= 1.5) {
                path.points.push(pt);
            }
        },
        onUp: function () {
            if (!path) { return; }
            var pts = path.points, mode = path.mode;
            path = null;
            if (pts.length < 3) {
                if (mode === "replace") { PS.deselect(); }
                return;
            }
            PS.setSelection(PS.maskFromPolygon(pts), mode, "Lasso");
        },
        overlay: function (ctx) {
            if (!path || path.points.length < 2) { return; }
            drawPolyOverlay(ctx, path.points, false);
        }
    });

    // polygonal lasso
    var poly = null;
    PS.registerTool("lasso-poly", {
        name: "Polygonal Lasso",
        key: "l",
        group: "lasso",
        cursor: "crosshair",
        icon: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M4 16 9 5l7 2 4 7-6 5z" stroke-dasharray="3 2"/></svg>',
        hint: "Click to add points; double-click, Enter or the first point closes. Esc cancels.",
        options: function (host) {
            PS.selectionModeOptions(host);
            PS.selectionDragOption(host);
        },
        isBusy: function () { return !!poly; },
        onDown: function (pt, e) {
            if (!poly) {
                poly = { points: [pt], mode: PS.selModeFromEvent(e) };
                return;
            }
            // close if clicking near the starting point
            var first = poly.points[0];
            if (Math.hypot(pt.x - first.x, pt.y - first.y) * PS.zoom < 9 && poly.points.length >= 3) {
                PS.finishPolyLasso();
                return;
            }
            poly.points.push(pt);
        },
        onDblClick: function () { PS.finishPolyLasso(); },
        onKey: function (e) {
            if (e.key === "Enter") { PS.finishPolyLasso(); return true; }
            if (e.key === "Escape") { poly = null; return true; }
            return false;
        },
        deactivate: function () { poly = null; },
        overlay: function (ctx) {
            if (!poly) { return; }
            var pts = poly.points.slice();
            if (PS.cursorPos) { pts.push(PS.cursorPos); }
            drawPolyOverlay(ctx, pts, true);
        }
    });

    PS.finishPolyLasso = function () {
        if (!poly || poly.points.length < 3) { poly = null; return; }
        var pts = poly.points, mode = poly.mode;
        poly = null;
        PS.setSelection(PS.maskFromPolygon(pts), mode, "Polygonal Lasso");
    };

    function drawPolyOverlay(ctx, pts, markStart) {
        PS.overlayDocSpace(ctx, function (px) {
            ctx.lineWidth = px;
            ctx.strokeStyle = "#fff";
            ctx.setLineDash([4 * px, 4 * px]);
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (var i = 1; i < pts.length; i++) { ctx.lineTo(pts[i].x, pts[i].y); }
            ctx.stroke();
            ctx.strokeStyle = "#000";
            ctx.lineDashOffset = 4 * px;
            ctx.stroke();
            if (markStart) {
                ctx.setLineDash([]);
                ctx.fillStyle = "#fff";
                ctx.fillRect(pts[0].x - 3 * px, pts[0].y - 3 * px, 6 * px, 6 * px);
            }
        });
    }
})();

/* ----- Magic wand / smart select (W) ----- */
PS.registerTool("wand", {
    name: "Magic Wand",
    key: "w",
    cursor: "crosshair",
    icon: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M6 18 15 9M13 4l.7 2.2M19.8 10.3 22 11M14.5 13.5l2 2M18.5 4.5l-2 2"/></svg>',
    options: function (host) {
        var o = PS.toolOpts.wand;
        PS.selectionModeOptions(host);
        PS.ui.numeric(host, "Tolerance:", o.tolerance, 0, 255, 1, function (v) {
            o.tolerance = v; PS.savePrefsDebounced();
        });
        PS.ui.checkbox(host, "Contiguous", o.contiguous, function (v) {
            o.contiguous = v; PS.savePrefsDebounced();
        });
        PS.ui.sep(host);
        PS.ui.checkbox(host, "Smart edges (edge detection)", o.smart, function (v) {
            o.smart = v; PS.savePrefsDebounced();
        });
        PS.ui.numeric(host, "Edge sensitivity", o.edgeThreshold, 10, 200, 1, function (v) {
            o.edgeThreshold = v; PS.savePrefsDebounced();
        });
    },
    onDown: function (pt, e) {
        var o = PS.toolOpts.wand;
        var mask = PS.magicWandMask(pt.x, pt.y, {
            tolerance: o.tolerance,
            contiguous: o.contiguous,
            smart: o.smart,
            edgeThreshold: o.edgeThreshold
        });
        if (!mask) { return; }
        PS.setSelection(mask, PS.selModeFromEvent(e), o.smart ? "Smart Select" : "Magic Wand");
    }
});

/* Brush (B), Pencil, Eraser (E): brushes.js */

/* ----- Paint bucket / fill (G) ----- */
PS.registerTool("fill", {
    name: "Paint Bucket",
    key: "g",
    hint: "Alt-click samples a color",
    cursor: "crosshair",
    icon: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M10 3 5 8l7 7 7-5.5L10 3zM5 8l-1.5 1.5M19 15c.8 1.3 1.5 2.6 1.5 3.5a1.7 1.7 0 0 1-3.4 0c0-.9.9-2.2 1.9-3.5z"/></svg>',
    options: function (host) {
        var o = PS.toolOpts.fill;
        PS.ui.numeric(host, "Tolerance", o.tolerance, 0, 150, 1, function (v) {
            o.tolerance = v; PS.savePrefsDebounced();
        });
        PS.ui.checkbox(host, "Contiguous", o.contiguous, function (v) {
            o.contiguous = v; PS.savePrefsDebounced();
        });
    },
    onDown: function (pt, e) {
        if (e.altKey) {
            PS.sampleColorAt(pt, PS.compositeToCanvas(), false);
            return;
        }
        var layer = PS.requirePaintableLayer();
        if (!layer) { return; }
        var before = PS.snapshotLayer(layer);
        if (PS.floodFillLayer(layer, pt, PS.fg, PS.toolOpts.fill)) {
            PS.commitLayerCanvas("Paint Bucket", layer, before);
            PS.requestRender();
        }
    }
});

// flood fill on the layer's own pixels, honoring the selection mask
PS.floodFillLayer = function (layer, pt, hex, opts) {
    var d = PS.doc;
    var w = d.width, h = d.height;
    var x = Math.floor(pt.x), y = Math.floor(pt.y);
    if (x < 0 || y < 0 || x >= w || y >= h) { return false; }

    var ctx = layer.canvas.getContext("2d");
    var img = ctx.getImageData(0, 0, w, h);
    var px = img.data;

    var maskData = null;
    if (d.selection) {
        maskData = d.selection.mask.getContext("2d").getImageData(0, 0, w, h).data;
        if (maskData[(y * w + x) * 4 + 3] < 128) { return false; }
    }

    var rgb = PS.hexToRgb(hex);
    var i0 = (y * w + x) * 4;
    var sr = px[i0], sg = px[i0 + 1], sb = px[i0 + 2], sa = px[i0 + 3];
    var tol = opts.tolerance;

    if (sr === rgb.r && sg === rgb.g && sb === rgb.b && sa === 255 && tol < 255) {
        return false; // already that color
    }

    function matches(i) {
        if (maskData && maskData[i + 3] < 128) { return false; }
        return Math.abs(px[i] - sr) <= tol && Math.abs(px[i + 1] - sg) <= tol &&
            Math.abs(px[i + 2] - sb) <= tol && Math.abs(px[i + 3] - sa) <= tol;
    }

    var fillA = (rgb.a === undefined) ? 255 : rgb.a;
    function paint(i) {
        px[i] = rgb.r; px[i + 1] = rgb.g; px[i + 2] = rgb.b; px[i + 3] = fillA;
    }

    var visited = new Uint8Array(w * h);

    if (!opts.contiguous) {
        for (var p = 0; p < w * h; p++) {
            if (matches(p * 4)) { paint(p * 4); }
        }
    } else {
        var stack = [[x, y]];
        visited[y * w + x] = 1;
        while (stack.length) {
            var cur = stack.pop();
            var cx = cur[0], cy = cur[1];
            var left = cx;
            while (left > 0 && !visited[cy * w + left - 1] && matches((cy * w + left - 1) * 4)) {
                left--; visited[cy * w + left] = 1;
            }
            var right = cx;
            while (right < w - 1 && !visited[cy * w + right + 1] && matches((cy * w + right + 1) * 4)) {
                right++; visited[cy * w + right] = 1;
            }
            for (var sx = left; sx <= right; sx++) {
                paint((cy * w + sx) * 4);
                if (cy > 0 && !visited[(cy - 1) * w + sx] && matches(((cy - 1) * w + sx) * 4)) {
                    visited[(cy - 1) * w + sx] = 1;
                    stack.push([sx, cy - 1]);
                }
                if (cy < h - 1 && !visited[(cy + 1) * w + sx] && matches(((cy + 1) * w + sx) * 4)) {
                    visited[(cy + 1) * w + sx] = 1;
                    stack.push([sx, cy + 1]);
                }
            }
        }
    }

    ctx.putImageData(img, 0, 0);
    return true;
};

/* ----- Eyedropper (I) ----- */
(function () {
    var sampling = null;
    PS.registerTool("eyedropper", {
        name: "Eyedropper",
        key: "i",
        cursor: "crosshair",
        hint: "Click sets the foreground color, Alt-click the background color",
        icon: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="m13 8 3 3-7.5 7.5c-.6.6-1.4 1-2.2 1.1l-2.3.4.4-2.3c.1-.8.5-1.6 1.1-2.2zM13 8l2-2M16 11l2-2M14 3.5 20.5 10M17.5 3.5c1.5-1 3.5 1 2.5 2.5"/></svg>',
        options: function (host) {
            var o = PS.toolOpts.eyedropper;
            PS.ui.select(host, "Sample Size:", [
                { v: "1", l: "Point Sample" }, { v: "3", l: "3 by 3 Average" }, { v: "5", l: "5 by 5 Average" },
                { v: "11", l: "11 by 11 Average" }, { v: "31", l: "31 by 31 Average" }, { v: "51", l: "51 by 51 Average" },
                { v: "101", l: "101 by 101 Average" }
            ], String(o.sampleSize || 1), function (v) { o.sampleSize = parseInt(v, 10); PS.savePrefsDebounced(); });
            PS.ui.select(host, "Sample:", [{ v: "all", l: "All Layers" }, { v: "layer", l: "Current Layer" }], o.sample || "all",
                function (v) { o.sample = v; PS.savePrefsDebounced(); });
        },
        onDown: function (pt, e) {
            sampling = { comp: PS.compositeToCanvas(), toBg: e.altKey };
            PS.sampleColorAt(pt, sampling.comp, sampling.toBg);
        },
        onMove: function (pt) {
            if (sampling) { PS.sampleColorAt(pt, sampling.comp, sampling.toBg); }
        },
        onUp: function () { sampling = null; }
    });
})();

/* ----- Shape tool (U) ----- */
(function () {
    var drag = null;

    PS.shapeKinds = [
        { v: "rect", l: "Rectangle" },
        { v: "rounded", l: "Rounded Rectangle" },
        { v: "ellipse", l: "Ellipse" },
        { v: "line", l: "Line" },
        { v: "arrow", l: "Arrow" },
        { v: "triangle", l: "Triangle" },
        { v: "star", l: "Star" }
    ];

    PS.buildShapePath = function (ctx, kind, r, opts) {
        ctx.beginPath();
        if (kind === "rect") {
            ctx.rect(r.x, r.y, r.w, r.h);
        } else if (kind === "rounded") {
            var rad = Math.min(opts.radius, r.w / 2, r.h / 2);
            ctx.moveTo(r.x + rad, r.y);
            ctx.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + r.h, rad);
            ctx.arcTo(r.x + r.w, r.y + r.h, r.x, r.y + r.h, rad);
            ctx.arcTo(r.x, r.y + r.h, r.x, r.y, rad);
            ctx.arcTo(r.x, r.y, r.x + r.w, r.y, rad);
            ctx.closePath();
        } else if (kind === "ellipse") {
            ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
        } else if (kind === "line") {
            ctx.moveTo(r.x0, r.y0);
            ctx.lineTo(r.x1, r.y1);
        } else if (kind === "arrow") {
            var ang = Math.atan2(r.y1 - r.y0, r.x1 - r.x0);
            var len = Math.hypot(r.x1 - r.x0, r.y1 - r.y0);
            var head = Math.min(len * 0.35, Math.max(12, opts.strokeWidth * 3));
            ctx.moveTo(r.x0, r.y0);
            ctx.lineTo(r.x1, r.y1);
            ctx.moveTo(r.x1, r.y1);
            ctx.lineTo(r.x1 - head * Math.cos(ang - 0.45), r.y1 - head * Math.sin(ang - 0.45));
            ctx.moveTo(r.x1, r.y1);
            ctx.lineTo(r.x1 - head * Math.cos(ang + 0.45), r.y1 - head * Math.sin(ang + 0.45));
        } else if (kind === "triangle") {
            ctx.moveTo(r.x + r.w / 2, r.y);
            ctx.lineTo(r.x + r.w, r.y + r.h);
            ctx.lineTo(r.x, r.y + r.h);
            ctx.closePath();
        } else if (kind === "star") {
            var n = PS.clamp(opts.points || 5, 3, 12);
            var cx = r.x + r.w / 2, cy = r.y + r.h / 2;
            var R = Math.min(r.w, r.h) / 2;
            var rr = R * 0.45;
            for (var i = 0; i < n * 2; i++) {
                var rad2 = (i % 2 === 0) ? R : rr;
                var a = -Math.PI / 2 + i * Math.PI / n;
                var X = cx + rad2 * Math.cos(a), Y = cy + rad2 * Math.sin(a);
                if (i === 0) { ctx.moveTo(X, Y); } else { ctx.lineTo(X, Y); }
            }
            ctx.closePath();
        }
    };

    function geom(drag) {
        var a = drag.start, b = drag.cur;
        var w = b.x - a.x, h = b.y - a.y;
        if (drag.constrain) {
            var kind = PS.toolOpts.shape.kind;
            if (kind === "line" || kind === "arrow") {
                // snap to 45 degree increments
                var ang = Math.atan2(h, w);
                var len = Math.hypot(w, h);
                var snap = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
                w = len * Math.cos(snap);
                h = len * Math.sin(snap);
            } else {
                var m = Math.max(Math.abs(w), Math.abs(h));
                w = w < 0 ? -m : m;
                h = h < 0 ? -m : m;
            }
        }
        return {
            x: Math.min(a.x, a.x + w), y: Math.min(a.y, a.y + h),
            w: Math.abs(w), h: Math.abs(h),
            x0: a.x, y0: a.y, x1: a.x + w, y1: a.y + h
        };
    }

    function renderShape(ctx, r) {
        var o = PS.toolOpts.shape;
        PS.buildShapePath(ctx, o.kind, r, o);
        var lineOnly = (o.kind === "line" || o.kind === "arrow");
        if (!lineOnly && (o.mode === "fill" || o.mode === "both")) {
            ctx.fillStyle = PS.fg;
            ctx.fill();
        }
        if (lineOnly || o.mode === "stroke" || o.mode === "both") {
            ctx.strokeStyle = lineOnly ? PS.fg : (o.mode === "both" ? PS.bg : PS.fg);
            ctx.lineWidth = o.strokeWidth;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.stroke();
        }
    }

    PS.registerTool("shape", {
        name: "Shape",
        key: "u",
        hint: "Shift constrains proportions; right-click the tool to pick a shape",
        cursor: "crosshair",
        icon: '<svg viewBox="0 0 24 24" stroke-width="1.6"><rect x="3" y="3" width="12" height="12" rx="1"/><circle cx="16" cy="16" r="5.5"/></svg>',
        options: function (host) {
            var o = PS.toolOpts.shape;
            PS.ui.select(host, "", PS.shapeKinds, o.kind, function (v) {
                o.kind = v;
                PS.savePrefsDebounced();
                PS.renderToolbar();
                PS.renderOptionsBar();
            }).title = "Shape";
            PS.ui.select(host, "Create", [
                { v: "layer", l: "Shape layer" },
                { v: "pixels", l: "Pixels" }
            ], o.target || "layer", function (v) { o.target = v; PS.savePrefsDebounced(); });
            if (o.kind !== "line" && o.kind !== "arrow") {
                PS.ui.select(host, "Mode", [
                    { v: "fill", l: "Fill (FG)" },
                    { v: "stroke", l: "Stroke (FG)" },
                    { v: "both", l: "Fill FG + Stroke BG" }
                ], o.mode, function (v) { o.mode = v; PS.savePrefsDebounced(); });
            }
            PS.ui.numeric(host, "Stroke width", o.strokeWidth, 1, 60, 1, function (v) {
                o.strokeWidth = v; PS.savePrefsDebounced();
            }, "px");
            if (o.kind === "rounded") {
                PS.ui.numeric(host, "Corner radius", o.radius, 1, 100, 1, function (v) {
                    o.radius = v; PS.savePrefsDebounced();
                });
            }
            if (o.kind === "star") {
                PS.ui.numeric(host, "Points", o.points, 3, 12, 1, function (v) {
                    o.points = v; PS.savePrefsDebounced();
                });
            }
        },
        onDown: function (pt, e) {
            if (PS.toolOpts.shape.target === "pixels" && !PS.requirePaintableLayer()) { return; }
            drag = { start: pt, cur: pt, constrain: e.shiftKey };
        },
        onMove: function (pt, e) {
            if (!drag) { return; }
            drag.cur = pt;
            drag.constrain = e.shiftKey;
        },
        onUp: function () {
            if (!drag) { return; }
            var r = geom(drag);
            drag = null;
            if (r.w < 2 && r.h < 2) { return; }
            var o = PS.toolOpts.shape;
            if (o.target !== "pixels") {
                // a vector shape layer, editable afterwards
                var lineOnly = (o.kind === "line" || o.kind === "arrow");
                var paths = lineOnly
                    ? PS.shapePathsFromLine({ x: r.x0, y: r.y0 }, { x: r.x1, y: r.y1 }, o.strokeWidth, o.kind === "arrow")
                    : PS.shapePathsFromRect(o.kind, r, o);
                var name = ((PS.shapeKinds.filter(function (k) { return k.v === o.kind; })[0] || {}).l || "Shape") + " 1";
                if (lineOnly || o.mode === "fill") { PS.newShapeLayer(name, paths, PS.fg, null); }
                else if (o.mode === "stroke") { PS.newShapeLayer(name, paths, null, PS.fg, o.strokeWidth); }
                else { PS.newShapeLayer(name, paths, PS.fg, PS.bg, o.strokeWidth); }
                PS.requestRender();
                return;
            }
            var layer = PS.requirePaintableLayer();
            if (!layer) { return; }
            var before = PS.snapshotLayer(layer);
            PS.maskedDraw(layer, function (ctx) { renderShape(ctx, r); });
            PS.commitLayerCanvas("Shape: " + PS.toolOpts.shape.kind, layer, before);
            PS.requestRender();
        },
        overlay: function (ctx) {
            if (!drag) { return; }
            var r = geom(drag);
            PS.overlayDocSpace(ctx, function () {
                ctx.globalAlpha = 0.8;
                renderShape(ctx, r);
                ctx.globalAlpha = 1;
            });
        }
    });
})();

/* ----- Hand (H) and Zoom (Z) ----- */

// 100% / Fit Screen / Fill Screen, shared by the Hand and Zoom tools
PS.viewButtons = function (host) {
    PS.ui.button(host, "100%", function () { PS.zoomActual(); }).title = "Actual pixels (Ctrl+1)";
    PS.ui.button(host, "Fit Screen", function () { PS.zoomFit(); }).title = "Fit the image in the window (Ctrl+0)";
    PS.ui.button(host, "Fill Screen", function () {
        if (!PS.doc) { return; }
        var holder = PS.el("workspace-holder");
        PS.setZoom(Math.max((holder.clientWidth - 20) / PS.doc.width, (holder.clientHeight - 20) / PS.doc.height),
            { x: PS.doc.width / 2, y: PS.doc.height / 2 });
    }).title = "Fill the window with the image";
};
PS.registerTool("hand", {
    name: "Hand",
    key: "h",
    cursor: "grab",
    icon: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M7 11V5.5a1.5 1.5 0 0 1 3 0V10m0-5.5v-1a1.5 1.5 0 0 1 3 0V10m0-5a1.5 1.5 0 0 1 3 0V11m0-3.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.8a6 6 0 0 1-4.6-2.2L4 15.6c-1.4-1.7.6-3.8 2.2-2.4L7 14z"/></svg>',
    hint: "Drag to pan. Hold Space with any tool to pan.",
    options: function (host) { PS.viewButtons(host); }
    // panning handled by the pointer pipeline
});

(function () {
    var drag = null;
    PS.registerTool("zoom", {
        name: "Zoom",
        key: "z",
        cursor: function () { return PS.toolOpts.zoom.mode === "out" ? "zoom-out" : "zoom-in"; },
        icon: '<svg viewBox="0 0 24 24" stroke-width="1.6"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5M8 10.5h5M10.5 8v5"/></svg>',
        hint: "Click zooms in, Alt-click zooms out, drag a box to zoom to an area",
        options: function (host) {
            var o = PS.toolOpts.zoom;
            var g = PS.ui.group(host);
            [["in", "Zoom in", '<svg viewBox="0 0 24 24" stroke-width="1.6"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5M8 10.5h5M10.5 8v5"/></svg>'],
                ["out", "Zoom out (Alt flips)", '<svg viewBox="0 0 24 24" stroke-width="1.6"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5M8 10.5h5"/></svg>']].forEach(function (m) {
                var b = document.createElement("button");
                b.type = "button";
                b.className = "opt-icon-btn" + ((o.mode || "in") === m[0] ? " active" : "");
                b.title = m[1];
                b.innerHTML = m[2];
                b.addEventListener("click", function () {
                    o.mode = m[0];
                    PS.el("workspace").style.cursor = PS.toolCursor();
                    PS.savePrefsDebounced();
                    PS.renderOptionsBar();
                });
                g.appendChild(b);
            });
            PS.ui.sep(host);
            PS.viewButtons(host);
        },
        onDown: function (pt) { drag = { start: pt, cur: pt }; },
        onMove: function (pt) { if (drag) { drag.cur = pt; } },
        onUp: function (pt, e) {
            if (!drag) { return; }
            var r = {
                x: Math.min(drag.start.x, drag.cur.x),
                y: Math.min(drag.start.y, drag.cur.y),
                w: Math.abs(drag.cur.x - drag.start.x),
                h: Math.abs(drag.cur.y - drag.start.y)
            };
            drag = null;
            if (r.w * PS.zoom > 12 && r.h * PS.zoom > 12) {
                var holder = PS.el("workspace-holder");
                var z = Math.min((holder.clientWidth - 40) / r.w, (holder.clientHeight - 40) / r.h);
                PS.setZoom(z, { x: r.x + r.w / 2, y: r.y + r.h / 2 });
            } else {
                var out = (PS.toolOpts.zoom.mode === "out") !== !!e.altKey;
                PS.setZoom(PS.zoom * (out ? 1 / 1.5 : 1.5), pt);
            }
        },
        overlay: function (ctx) {
            if (!drag) { return; }
            PS.overlayDocSpace(ctx, function (px) {
                ctx.lineWidth = px;
                ctx.strokeStyle = "#4a90d9";
                ctx.setLineDash([4 * px, 3 * px]);
                ctx.strokeRect(
                    Math.min(drag.start.x, drag.cur.x), Math.min(drag.start.y, drag.cur.y),
                    Math.abs(drag.cur.x - drag.start.x), Math.abs(drag.cur.y - drag.start.y));
            });
        }
    });
})();
