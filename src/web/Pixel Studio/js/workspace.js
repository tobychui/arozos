/*
    Pixel Studio - workspace (panel dock)

    Panels (Layers, Color, History, ...) live in tabbed panel groups:
        icon strip    collapsed groups shown as icons; clicking one opens
                      the group as a fly-out next to the strip
        main column   expanded groups stacked vertically, resizable with
                      the splitters between them
        floating      groups dragged out of the dock, freely moved and
                      resized
    Drag a tab onto another group's tab bar to combine them, between groups
    (or onto the icon strip) to dock it there, or anywhere else to float it.
    The dock width, group sizes, the toolbar (one / two columns, docked or
    floating) and every floating window are remembered per browser.
    Window > Workspace > Reset Essentials restores the default layout.

    Panel bodies are created once (#panel-<id>-body) and moved between
    groups, so a panel's render function keeps addressing the same element;
    a panel whose tab is not showing is detached and simply not rendered.
*/
"use strict";

PS.ws = (function () {
    var defs = {};
    var order = [];
    var bodies = {};
    var state = null;
    var STORE = "pixelstudio_workspace_v1";
    var seq = 1;
    var flyout = null;      // {group, el}
    var dockEl, iconsEl, mainEl;

    /* ---------- registry ---------- */

    function register(id, def) {
        def.id = id;
        defs[id] = def;
        order.push(id);
        var b = document.createElement("div");
        b.className = "panel-body";
        b.id = "panel-" + id + "-body";
        bodies[id] = b;
    }

    function group(panels, opts) {
        opts = opts || {};
        return {
            id: "g" + (seq++) + "-" + Math.floor(Math.random() * 1e6),
            panels: panels.slice(),
            active: panels[0],
            h: opts.h || null,
            grow: !!opts.grow,
            collapsed: false
        };
    }

    function defaultState() {
        var brushes = group(["brush", "brushpresets"]);
        brushes.w = 300;
        brushes.h = 520;
        return {
            dockWidth: 300,
            icons: [group(["history"]), group(["properties"]), brushes, group(["character", "paragraph"]),
                group(["navigator", "info", "histogram"])],
            main: [group(["color", "swatches"], { h: 196 }), group(["adjustments", "styles"], { h: 128 }),
                group(["layers", "channels"], { grow: true })],
            floats: [],
            toolbar: { cols: 1, floating: false, x: 60, y: 96 }
        };
    }

    function load() {
        var s = null;
        try { s = JSON.parse(localStorage.getItem(STORE) || "null"); } catch (e) { s = null; }
        if (!s || !s.main || !s.icons) { s = defaultState(); }
        // drop panels that no longer exist, keep groups non-empty
        function clean(list) {
            return (list || []).filter(function (g) {
                g.panels = (g.panels || []).filter(function (p) { return !!defs[p]; });
                if (g.panels.indexOf(g.active) < 0) { g.active = g.panels[0]; }
                return g.panels.length > 0;
            });
        }
        s.icons = clean(s.icons);
        s.main = clean(s.main);
        s.floats = clean(s.floats);
        if (!s.toolbar) { s.toolbar = { cols: 1, floating: false, x: 60, y: 96 }; }
        state = s;
    }

    function save() {
        try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* storage blocked */ }
    }

    function allGroups() { return state.icons.concat(state.main, state.floats); }

    function findGroup(gid) {
        var lists = [state.icons, state.main, state.floats];
        for (var i = 0; i < lists.length; i++) {
            for (var j = 0; j < lists[i].length; j++) {
                if (lists[i][j].id === gid) { return { list: lists[i], index: j, group: lists[i][j] }; }
            }
        }
        return null;
    }

    function groupOfPanel(pid) {
        var gs = allGroups();
        for (var i = 0; i < gs.length; i++) { if (gs[i].panels.indexOf(pid) >= 0) { return gs[i]; } }
        return null;
    }

    function isVisible(pid) {
        var g = groupOfPanel(pid);
        if (!g) { return false; }
        if (state.icons.indexOf(g) >= 0) { return !!(flyout && flyout.group === g && g.active === pid); }
        return g.active === pid && !g.collapsed;
    }

    /* ---------- rendering ---------- */

    function icon(def) {
        return def.icon || '<svg viewBox="0 0 24 24" stroke-width="1.6"><rect x="4" y="4" width="16" height="16"/></svg>';
    }

    function render() {
        // detach every body first so only showing panels sit in the document
        Object.keys(bodies).forEach(function (k) { if (bodies[k].parentNode) { bodies[k].parentNode.removeChild(bodies[k]); } });
        closeFlyoutEl();
        renderDock();
        renderFloats();
        renderToolbarFrame();
        if (flyout) { openFlyout(flyout.group, flyout.group.active, true); }
        refreshVisible();
    }

    function refreshVisible() {
        order.forEach(function (id) {
            if (bodies[id].isConnected && defs[id].render) {
                try { defs[id].render(); } catch (e) { console.error(e); }
            }
        });
    }

    function renderDock() {
        dockEl.style.width = (state.dockWidth + (state.icons.length ? 38 : 0)) + "px";
        iconsEl.innerHTML = "";
        iconsEl.style.display = state.icons.length ? "" : "none";
        state.icons.forEach(function (g) {
            var wrap = document.createElement("div");
            wrap.className = "dock-icon-group";
            wrap.dataset.gid = g.id;
            g.panels.forEach(function (pid) {
                var b = document.createElement("button");
                b.className = "dock-icon" + (flyout && flyout.group === g && g.active === pid ? " active" : "");
                b.innerHTML = icon(defs[pid]);
                b.title = defs[pid].title;
                b.dataset.pid = pid;
                b.addEventListener("click", function (e) {
                    e.stopPropagation();
                    if (flyout && flyout.group === g && g.active === pid) { closeFlyout(); return; }
                    g.active = pid;
                    openFlyout(g, pid);
                });
                bindTabDrag(b, pid, g);
                wrap.appendChild(b);
            });
            iconsEl.appendChild(wrap);
        });

        mainEl.innerHTML = "";
        var hasGrow = state.main.some(function (g) { return g.grow && !g.collapsed; });
        state.main.forEach(function (g, i) {
            if (i > 0) { mainEl.appendChild(splitter(i)); }
            var el = groupEl(g, "docked");
            var grow = g.grow || (!hasGrow && i === state.main.length - 1);
            if (g.collapsed) {
                el.style.flex = "0 0 auto";
            } else if (grow) {
                el.style.flex = "1 1 auto";
                el.style.minHeight = "80px";
            } else {
                el.style.flex = "0 0 auto";
                el.style.height = (g.h || 180) + "px";
            }
            mainEl.appendChild(el);
        });
    }

    function groupEl(g, mode) {
        var el = document.createElement("div");
        el.className = "pgroup " + mode + (g.collapsed ? " collapsed" : "");
        el.dataset.gid = g.id;
        var tabs = document.createElement("div");
        tabs.className = "pgroup-tabs";
        g.panels.forEach(function (pid) {
            var t = document.createElement("div");
            t.className = "ptab" + (g.active === pid ? " active" : "");
            t.textContent = defs[pid].title;
            t.dataset.pid = pid;
            t.addEventListener("click", function () {
                if (g.collapsed) { g.collapsed = false; }
                g.active = pid;
                save();
                render();
            });
            bindTabDrag(t, pid, g);
            tabs.appendChild(t);
        });
        var spacer = document.createElement("div");
        spacer.className = "ptabs-spacer";
        tabs.appendChild(spacer);
        tabs.addEventListener("dblclick", function (e) {
            if (e.target !== tabs && e.target !== spacer) { return; }
            g.collapsed = !g.collapsed;
            save();
            render();
        });
        var menuBtn = document.createElement("button");
        menuBtn.className = "pgroup-menu";
        menuBtn.innerHTML = '<svg viewBox="0 0 24 24" stroke-width="2"><path d="M5 7h14M5 12h14M5 17h14"/></svg>';
        menuBtn.title = "Panel options";
        menuBtn.addEventListener("click", function (e) {
            e.stopPropagation();
            var r = menuBtn.getBoundingClientRect();
            var items = [
                { label: "Close " + defs[g.active].title, action: function () { hidePanel(g.active); } },
                { label: "Close Tab Group", action: function () { removeGroup(g); } },
                { label: g.collapsed ? "Expand Panel" : "Minimize Panel", action: function () { g.collapsed = !g.collapsed; save(); render(); } }
            ];
            if (mode !== "floating") { items.push({ label: "Float Tab Group", action: function () { floatGroup(g, r.left - 260, r.top + 20); } }); }
            if (mode !== "docked") { items.push({ label: "Dock Tab Group", action: function () { dockGroup(g, state.main.length); } }); }
            if (defs[g.active].menu) {
                items.push({ sep: true });
                items = items.concat(defs[g.active].menu());
            }
            PS.contextMenu(r.right, r.bottom, items, { alignRight: true });
        });
        tabs.appendChild(menuBtn);
        if (mode === "floating") {
            var close = document.createElement("button");
            close.className = "pgroup-menu";
            close.innerHTML = "&times;";
            close.title = "Close";
            close.addEventListener("click", function (e) { e.stopPropagation(); removeGroup(g); });
            tabs.appendChild(close);
            bindFloatMove(tabs, g, el);
        }
        el.appendChild(tabs);
        var body = document.createElement("div");
        body.className = "pgroup-body";
        if (!g.collapsed && bodies[g.active]) { body.appendChild(bodies[g.active]); }
        el.appendChild(body);
        if (mode === "floating" || mode === "flyout") {
            var grip = document.createElement("div");
            grip.className = "pgroup-grip";
            bindResize(grip, g, el, mode);
            el.appendChild(grip);
        }
        return el;
    }

    function splitter(index) {
        var s = document.createElement("div");
        s.className = "pgroup-splitter";
        s.addEventListener("pointerdown", function (e) {
            e.preventDefault();
            s.setPointerCapture(e.pointerId);
            var above = state.main[index - 1], below = state.main[index];
            var els = mainEl.querySelectorAll(".pgroup");
            var aEl = els[index - 1], bEl = els[index];
            var a0 = aEl.getBoundingClientRect().height, b0 = bEl.getBoundingClientRect().height;
            var y0 = e.clientY;
            function move(ev) {
                var dy = ev.clientY - y0;
                var na = Math.max(60, a0 + dy), nb = Math.max(60, b0 - dy);
                if (!above.grow && !above.collapsed) { above.h = na; aEl.style.height = na + "px"; }
                if (!below.grow && !below.collapsed) { below.h = nb; bEl.style.height = nb + "px"; }
            }
            function up() {
                s.removeEventListener("pointermove", move);
                s.removeEventListener("pointerup", up);
                save();
                refreshVisible();
            }
            s.addEventListener("pointermove", move);
            s.addEventListener("pointerup", up);
        });
        return s;
    }

    function renderFloats() {
        document.querySelectorAll(".pgroup.floating").forEach(function (el) { el.remove(); });
        state.floats.forEach(function (g) {
            var el = groupEl(g, "floating");
            el.style.left = clampX(g.x) + "px";
            el.style.top = clampY(g.y) + "px";
            el.style.width = (g.w || 260) + "px";
            if (!g.collapsed) { el.style.height = (g.h || 300) + "px"; }
            el.addEventListener("pointerdown", function () { raise(el); });
            document.body.appendChild(el);
        });
    }

    // floating groups stack between 900 and 949, below fly-outs and windows
    var zTop = 900;
    function raise(el) {
        if (zTop >= 945) {
            var els = Array.prototype.slice.call(document.querySelectorAll(".pgroup.floating"));
            els.sort(function (a, b) { return (parseInt(a.style.zIndex, 10) || 0) - (parseInt(b.style.zIndex, 10) || 0); });
            zTop = 900;
            els.forEach(function (e) { if (e !== el) { e.style.zIndex = String(++zTop); } });
        }
        el.style.zIndex = String(++zTop);
    }

    function clampX(x) { return PS.clamp(x || 0, 0, Math.max(0, window.innerWidth - 80)); }
    function clampY(y) { return PS.clamp(y || 0, 0, Math.max(0, window.innerHeight - 40)); }

    /* ---------- fly-outs from the icon strip ---------- */

    function openFlyout(g, pid, keep) {
        closeFlyoutEl();
        flyout = { group: g, el: null };
        g.active = pid;
        var el = groupEl(g, "flyout");
        var btn = iconsEl.querySelector('.dock-icon-group[data-gid="' + g.id + '"]');
        var r = btn ? btn.getBoundingClientRect() : { top: 80 };
        var dr = iconsEl.getBoundingClientRect();
        el.style.width = (g.w || 260) + "px";
        el.style.height = (g.h || 320) + "px";
        document.body.appendChild(el);
        var top = Math.min(r.top, window.innerHeight - el.getBoundingClientRect().height - 8);
        el.style.top = Math.max(4, top) + "px";
        el.style.left = Math.max(4, dr.left - el.getBoundingClientRect().width - 2) + "px";
        flyout.el = el;
        iconsEl.querySelectorAll(".dock-icon").forEach(function (b) {
            b.classList.toggle("active", b.dataset.pid === pid && b.parentNode.dataset.gid === g.id);
        });
        if (!keep) {
            if (defs[pid].render) { try { defs[pid].render(); } catch (e) { console.error(e); } }
        } else if (defs[pid].render) {
            try { defs[pid].render(); } catch (e2) { console.error(e2); }
        }
    }

    function closeFlyoutEl() {
        if (flyout && flyout.el) {
            if (bodies[flyout.group.active] && bodies[flyout.group.active].parentNode) {
                bodies[flyout.group.active].parentNode.removeChild(bodies[flyout.group.active]);
            }
            flyout.el.remove();
            flyout.el = null;
        }
    }

    function closeFlyout() {
        closeFlyoutEl();
        flyout = null;
        if (iconsEl) { iconsEl.querySelectorAll(".dock-icon").forEach(function (b) { b.classList.remove("active"); }); }
    }

    // clicking anywhere else closes the fly-out (but not dialogs it opened)
    function outsideClick(e) {
        if (!flyout || !flyout.el) { return; }
        var t = e.target;
        if (flyout.el.contains(t) || iconsEl.contains(t)) { return; }
        if (t.closest && (t.closest(".float-panel") || t.closest(".dialog-overlay") || t.closest(".menu-dropdown") || t.closest(".tool-flyout"))) { return; }
        closeFlyout();
    }

    /* ---------- moving and resizing floating groups ---------- */

    function bindFloatMove(handle, g, el) {
        handle.addEventListener("pointerdown", function (e) {
            if (e.target.closest(".ptab") || e.target.closest("button")) { return; }
            e.preventDefault();
            raise(el);
            var r = el.getBoundingClientRect();
            var sx = e.clientX, sy = e.clientY;
            handle.setPointerCapture(e.pointerId);
            function move(ev) {
                g.x = clampX(r.left + ev.clientX - sx);
                g.y = clampY(r.top + ev.clientY - sy);
                el.style.left = g.x + "px";
                el.style.top = g.y + "px";
            }
            function up(ev) {
                handle.removeEventListener("pointermove", move);
                handle.removeEventListener("pointerup", up);
                // dropped onto the dock: dock the whole group
                var dr = dockEl.getBoundingClientRect();
                if (ev.clientX > dr.left && ev.clientX < dr.right && ev.clientY > dr.top && ev.clientY < dr.bottom) {
                    dockGroup(g, mainIndexAt(ev.clientY));
                    return;
                }
                save();
            }
            handle.addEventListener("pointermove", move);
            handle.addEventListener("pointerup", up);
        });
    }

    function bindResize(grip, g, el, mode) {
        grip.addEventListener("pointerdown", function (e) {
            e.preventDefault();
            e.stopPropagation();
            grip.setPointerCapture(e.pointerId);
            var r = el.getBoundingClientRect();
            var sx = e.clientX, sy = e.clientY;
            function move(ev) {
                var w, h;
                if (mode === "flyout") {
                    // fly-outs grow to the left (they hang off the icon strip)
                    w = Math.max(180, r.width - (ev.clientX - sx));
                    el.style.left = (r.right - w) + "px";
                } else {
                    w = Math.max(180, r.width + ev.clientX - sx);
                }
                h = Math.max(90, r.height + ev.clientY - sy);
                g.w = w; g.h = h;
                el.style.width = w + "px";
                el.style.height = h + "px";
            }
            function up() {
                grip.removeEventListener("pointermove", move);
                grip.removeEventListener("pointerup", up);
                save();
                refreshVisible();
            }
            grip.addEventListener("pointermove", move);
            grip.addEventListener("pointerup", up);
        });
    }

    /* ---------- dragging tabs between groups ---------- */

    function bindTabDrag(el, pid, g) {
        el.addEventListener("pointerdown", function (e) {
            if (e.button !== 0) { return; }
            var sx = e.clientX, sy = e.clientY;
            var dragging = false;
            var ghost = null, marker = null;
            el.setPointerCapture(e.pointerId);
            function move(ev) {
                if (!dragging) {
                    if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 6) { return; }
                    dragging = true;
                    ghost = document.createElement("div");
                    ghost.className = "ptab-ghost";
                    ghost.textContent = defs[pid].title;
                    document.body.appendChild(ghost);
                    marker = document.createElement("div");
                    marker.className = "dock-drop-marker";
                    document.body.appendChild(marker);
                }
                ghost.style.left = (ev.clientX + 8) + "px";
                ghost.style.top = (ev.clientY + 8) + "px";
                showMarker(marker, dropTarget(ev.clientX, ev.clientY, g));
            }
            function up(ev) {
                el.removeEventListener("pointermove", move);
                el.removeEventListener("pointerup", up);
                el.removeEventListener("pointercancel", up);
                if (!dragging) { return; }
                ghost.remove();
                marker.remove();
                var t = dropTarget(ev.clientX, ev.clientY, g);
                movePanel(pid, g, t, ev.clientX, ev.clientY);
            }
            el.addEventListener("pointermove", move);
            el.addEventListener("pointerup", up);
            el.addEventListener("pointercancel", up);
        });
    }

    // Where a dragged tab would land: {type: "merge", group} | {type: "main", index}
    // | {type: "icons", index} | {type: "float"}
    function dropTarget(x, y, srcGroup) {
        var el = document.elementFromPoint(x, y);
        if (el) {
            var tabs = el.closest(".pgroup-tabs");
            if (tabs) {
                var gid = tabs.parentNode.dataset.gid;
                var f = findGroup(gid);
                if (f && f.group !== srcGroup) { return { type: "merge", group: f.group, rect: tabs.getBoundingClientRect() }; }
                if (f && f.group === srcGroup) { return { type: "none" }; }
            }
            var ig = el.closest(".dock-icon-group");
            if (ig && findGroup(ig.dataset.gid) && findGroup(ig.dataset.gid).group !== srcGroup) {
                return { type: "merge", group: findGroup(ig.dataset.gid).group, rect: ig.getBoundingClientRect() };
            }
            if (el.closest("#dock-icons")) {
                return { type: "icons", index: iconIndexAt(y), rect: iconsEl.getBoundingClientRect() };
            }
            if (el.closest("#dock-main")) {
                var idx = mainIndexAt(y);
                var mr = mainEl.getBoundingClientRect();
                var lineY = mainLineY(idx);
                return { type: "main", index: idx, rect: { left: mr.left, right: mr.right, top: lineY - 2, bottom: lineY + 2 } };
            }
        }
        return { type: "float" };
    }

    function mainIndexAt(y) {
        var els = mainEl.querySelectorAll(".pgroup");
        for (var i = 0; i < els.length; i++) {
            var r = els[i].getBoundingClientRect();
            if (y < r.top + r.height / 2) { return i; }
        }
        return els.length;
    }

    function mainLineY(i) {
        var els = mainEl.querySelectorAll(".pgroup");
        if (!els.length) { return mainEl.getBoundingClientRect().top + 4; }
        if (i >= els.length) { return els[els.length - 1].getBoundingClientRect().bottom; }
        return els[i].getBoundingClientRect().top;
    }

    function iconIndexAt(y) {
        var els = iconsEl.querySelectorAll(".dock-icon-group");
        for (var i = 0; i < els.length; i++) {
            var r = els[i].getBoundingClientRect();
            if (y < r.top + r.height / 2) { return i; }
        }
        return els.length;
    }

    function showMarker(m, t) {
        m.style.display = "none";
        if (!t.rect) { return; }
        m.style.display = "block";
        m.className = "dock-drop-marker " + t.type;
        m.style.left = t.rect.left + "px";
        m.style.top = t.rect.top + "px";
        m.style.width = (t.rect.right - t.rect.left) + "px";
        m.style.height = Math.max(4, t.rect.bottom - t.rect.top) + "px";
    }

    function detachPanel(pid, g) {
        var i = g.panels.indexOf(pid);
        if (i >= 0) { g.panels.splice(i, 1); }
        if (g.active === pid) { g.active = g.panels[0]; }
        if (!g.panels.length) {
            var f = findGroup(g.id);
            if (f) { f.list.splice(f.index, 1); }
            if (flyout && flyout.group === g) { flyout = null; }
        }
    }

    function movePanel(pid, src, t, x, y) {
        if (t.type === "none") { return; }
        if (t.type === "merge") {
            if (t.group === src) { return; }
            detachPanel(pid, src);
            t.group.panels.push(pid);
            t.group.active = pid;
            t.group.collapsed = false;
        } else if (t.type === "main") {
            if (src.panels.length === 1 && state.main.indexOf(src) >= 0) {
                // moving a whole single-panel group within the column
                var from = state.main.indexOf(src);
                state.main.splice(from, 1);
                state.main.splice(t.index > from ? t.index - 1 : t.index, 0, src);
            } else {
                detachPanel(pid, src);
                state.main.splice(Math.min(t.index, state.main.length), 0, group([pid], { h: 220 }));
            }
        } else if (t.type === "icons") {
            detachPanel(pid, src);
            state.icons.splice(Math.min(t.index, state.icons.length), 0, group([pid]));
        } else {
            detachPanel(pid, src);
            var ng = group([pid]);
            ng.x = clampX(x - 40); ng.y = clampY(y - 10); ng.w = 270; ng.h = 320;
            state.floats.push(ng);
        }
        if (flyout && flyout.group === src && src.panels.length && t.type !== "merge") { flyout = null; }
        save();
        render();
    }

    function floatGroup(g, x, y) {
        var f = findGroup(g.id);
        if (!f) { return; }
        f.list.splice(f.index, 1);
        g.x = clampX(x); g.y = clampY(y);
        g.w = g.w || 270; g.h = g.h || 320;
        state.floats.push(g);
        if (flyout && flyout.group === g) { flyout = null; }
        save();
        render();
    }

    function dockGroup(g, index) {
        var f = findGroup(g.id);
        if (!f) { return; }
        f.list.splice(f.index, 1);
        g.h = g.h || 220;
        state.main.splice(Math.min(index, state.main.length), 0, g);
        if (flyout && flyout.group === g) { flyout = null; }
        save();
        render();
    }

    function removeGroup(g) {
        var f = findGroup(g.id);
        if (f) { f.list.splice(f.index, 1); }
        if (flyout && flyout.group === g) { flyout = null; }
        save();
        render();
    }

    /* ---------- show / hide panels (Window menu) ---------- */

    function hidePanel(pid) {
        var g = groupOfPanel(pid);
        if (!g) { return; }
        detachPanel(pid, g);
        save();
        render();
    }

    // Bring a panel into view: activate its tab / open its fly-out, or float
    // it when it is not part of the workspace
    function showPanel(pid) {
        var g = groupOfPanel(pid);
        if (!g) {
            var ng = group([pid]);
            ng.x = Math.round(window.innerWidth / 2 - 140);
            ng.y = 120;
            ng.w = 280; ng.h = 340;
            state.floats.push(ng);
            save();
            render();
            return;
        }
        g.active = pid;
        g.collapsed = false;
        if (state.icons.indexOf(g) >= 0) {
            save();
            renderDock();
            openFlyout(g, pid);
            return;
        }
        save();
        render();
    }

    function togglePanel(pid) {
        if (groupOfPanel(pid)) { hidePanel(pid); } else { showPanel(pid); }
    }

    function reset() {
        flyout = null;
        state = defaultState();
        save();
        render();
        applyToolbar();
    }

    /* ---------- toolbar (1 / 2 columns, docked or floating) ---------- */

    function renderToolbarFrame() { applyToolbar(); }

    function applyToolbar() {
        var tb = PS.el("toolbar");
        if (!tb) { return; }
        var t = state.toolbar;
        tb.classList.toggle("two-col", t.cols === 2);
        tb.classList.toggle("floating", !!t.floating);
        if (t.floating) {
            tb.style.left = clampX(t.x) + "px";
            tb.style.top = clampY(t.y) + "px";
        } else {
            tb.style.left = "";
            tb.style.top = "";
        }
    }

    function bindToolbar() {
        var tb = PS.el("toolbar");
        var head = document.createElement("div");
        head.id = "toolbar-head";
        head.title = "Drag to move the toolbar, click the arrows to switch between one and two columns";
        var arrows = document.createElement("button");
        arrows.id = "toolbar-cols";
        arrows.innerHTML = '<svg viewBox="0 0 24 24" stroke-width="2"><path d="M7 7l5 5-5 5M13 7l5 5-5 5"/></svg>';
        arrows.title = "One / two columns";
        arrows.addEventListener("click", function (e) {
            e.stopPropagation();
            state.toolbar.cols = state.toolbar.cols === 2 ? 1 : 2;
            save();
            applyToolbar();
        });
        head.appendChild(arrows);
        tb.insertBefore(head, tb.firstChild);
        head.addEventListener("pointerdown", function (e) {
            if (e.target.closest("button")) { return; }
            e.preventDefault();
            head.setPointerCapture(e.pointerId);
            var r = tb.getBoundingClientRect();
            var sx = e.clientX, sy = e.clientY;
            var moved = false;
            function move(ev) {
                if (!moved && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 6) { return; }
                moved = true;
                state.toolbar.floating = true;
                state.toolbar.x = r.left + ev.clientX - sx;
                state.toolbar.y = r.top + ev.clientY - sy;
                applyToolbar();
            }
            function up(ev) {
                head.removeEventListener("pointermove", move);
                head.removeEventListener("pointerup", up);
                // back to the left edge: dock it again
                if (moved && ev.clientX < 50) { state.toolbar.floating = false; applyToolbar(); }
                save();
            }
            head.addEventListener("pointermove", move);
            head.addEventListener("pointerup", up);
        });
    }

    /* ---------- dock width ---------- */

    function bindDockResize() {
        var h = PS.el("dock-resizer");
        h.addEventListener("pointerdown", function (e) {
            e.preventDefault();
            h.setPointerCapture(e.pointerId);
            var sx = e.clientX, w0 = state.dockWidth;
            function move(ev) {
                state.dockWidth = PS.clamp(w0 - (ev.clientX - sx), 220, 620);
                dockEl.style.width = (state.dockWidth + (state.icons.length ? 38 : 0)) + "px";
            }
            function up() {
                h.removeEventListener("pointermove", move);
                h.removeEventListener("pointerup", up);
                save();
                refreshVisible();
            }
            h.addEventListener("pointermove", move);
            h.addEventListener("pointerup", up);
        });
    }

    function init() {
        dockEl = PS.el("dock");
        iconsEl = PS.el("dock-icons");
        mainEl = PS.el("dock-main");
        load();
        bindToolbar();
        bindDockResize();
        render();
        document.addEventListener("pointerdown", outsideClick, true);
        window.addEventListener("resize", function () {
            state.floats.forEach(function (g) { g.x = clampX(g.x); g.y = clampY(g.y); });
            renderFloats();
            refreshVisible();
        });
    }

    // Window menu items: every panel with a check mark when it is open
    function windowMenuItems() {
        var items = order.map(function (id) {
            return {
                label: defs[id].title,
                shortcut: defs[id].shortcut || "",
                checked: function () { return !!groupOfPanel(id); },
                action: function () { togglePanel(id); }
            };
        });
        items.sort(function (a, b) { return a.label.localeCompare(b.label); });
        return items;
    }

    return {
        register: register,
        init: init,
        render: render,
        refresh: refreshVisible,
        showPanel: showPanel,
        hidePanel: hidePanel,
        togglePanel: togglePanel,
        isVisible: isVisible,
        reset: reset,
        windowMenuItems: windowMenuItems,
        closeFlyout: closeFlyout,
        toolbarState: function () { return state.toolbar; }
    };
})();
