/*
    Pixel Studio - Ruler and Note tools (the Eyedropper tool group, I)

        Ruler (I)   drag to measure a distance and angle; drag an end point
                    to move it, the line to move the whole ruler, Alt-drag
                    from an end point to add a second arm (protractor).
                    Shift snaps to 45 degrees. The options bar shows X, Y,
                    W, H, the angle and the lengths; Straighten Layer
                    rotates the selected layers so the ruler becomes level
                    (or plumb), Clear removes it. The ruler belongs to the
                    document but is not saved with it.
        Note (I)    click to pin a note to the image, click a note to open
                    it in the Notes panel, drag to move it. Notes are saved
                    in PSD files (as annotations) and in OpenRaster files
                    (Pixel Studio's own data), and every change can be
                    undone.
*/
"use strict";

PS.toolOpts.ruler = {};
PS.toolOpts.note = { author: "", color: "#ffd84a" };

/* ============================================================
   RULER
   ============================================================ */

(function () {
    var drag = null;
    var END_PX = 7;     // grab distance of an end point, screen pixels

    function R() { return PS.doc && PS.doc.ruler; }

    function snap45(from, to) {
        var dx = to.x - from.x, dy = to.y - from.y;
        var a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
        var len = Math.hypot(dx, dy);
        return { x: from.x + Math.cos(a) * len, y: from.y + Math.sin(a) * len };
    }

    function distToSegment(p, a, b) {
        var dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
        var t = l2 ? PS.clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / l2, 0, 1) : 0;
        return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
    }

    function hit(pt) {
        var r = R();
        if (!r) { return null; }
        var tol = END_PX / PS.zoom;
        if (r.c && Math.hypot(pt.x - r.c.x, pt.y - r.c.y) <= tol) { return "c"; }
        if (Math.hypot(pt.x - r.b.x, pt.y - r.b.y) <= tol) { return "b"; }
        if (Math.hypot(pt.x - r.a.x, pt.y - r.a.y) <= tol) { return "a"; }
        if (distToSegment(pt, r.a, r.b) <= tol / 1.5 || (r.c && distToSegment(pt, r.a, r.c) <= tol / 1.5)) { return "line"; }
        return null;
    }

    // angle of a -> p in degrees, counter-clockwise from the x axis (as on paper)
    function angleOf(a, p) { return -Math.atan2(p.y - a.y, p.x - a.x) * 180 / Math.PI; }

    // the numbers the options bar shows
    PS.rulerMeasure = function () {
        var r = R();
        if (!r) { return null; }
        var m = { x: r.a.x, y: r.a.y, w: r.b.x - r.a.x, h: r.b.y - r.a.y, l1: Math.hypot(r.b.x - r.a.x, r.b.y - r.a.y), l2: null };
        if (r.c) {
            // protractor: the angle between the two arms
            var d = angleOf(r.a, r.b) - angleOf(r.a, r.c);
            d = ((d % 360) + 360) % 360;
            if (d > 180) { d = 360 - d; }
            m.angle = d;
            m.l2 = Math.hypot(r.c.x - r.a.x, r.c.y - r.a.y);
        } else {
            m.angle = angleOf(r.a, r.b);
        }
        return m;
    };

    function setRuler(r) { PS.doc.ruler = r; refresh(); }

    function refresh() {
        PS.renderOptionsBar();
        if (PS.renderInfoPanel) { PS.renderInfoPanel(); }
    }

    // Rotate the selected layers about the ruler's first point so the
    // ruler becomes horizontal (or vertical when it is closer to that)
    PS.straightenLayer = function () {
        var r = R();
        if (!r || r.c) { return; }
        var phi = Math.atan2(r.b.y - r.a.y, r.b.x - r.a.x);      // screen angle, clockwise
        var targets = [0, Math.PI / 2, Math.PI, -Math.PI / 2, -Math.PI];
        var best = 0, bd = Infinity;
        targets.forEach(function (t) { var dd = Math.abs(t - phi); if (dd < bd) { bd = dd; best = t; } });
        var rot = best - phi;
        if (Math.abs(rot) < 1e-6) { PS.toast("The ruler is already level"); return; }
        var c = Math.cos(rot), s = Math.sin(rot), ax = r.a.x, ay = r.a.y;
        // doc -> doc rotation about a, as a 3x3 matrix (row major)
        var H = [c, -s, ax - c * ax + s * ay, s, c, ay - s * ax - c * ay, 0, 0, 1];
        if (!PS.transform.begin({ kind: "layers", matrix: H })) { return; }
        PS.transform.commit();
        PS.doc.ruler = null;
        refresh();
        PS.requestRender();
    };

    PS.registerTool("ruler", {
        name: "Ruler",
        key: "i",
        hint: "Drag to measure; drag an end to adjust it, Alt-drag from an end to measure an angle, Shift snaps to 45 degrees",
        cursor: "crosshair",
        icon: '<svg viewBox="0 0 24 24" stroke-width="1.5"><path d="M3 16.5 16.5 3 21 7.5 7.5 21z"/><path d="M7 12.5l1.8 1.8M9.5 10l1.2 1.2M12 7.5l1.8 1.8M14.5 5l1.2 1.2"/></svg>',
        options: function (host) {
            var m = PS.rulerMeasure();
            function out(label, v, unit, title) {
                var g = PS.ui.group(host);
                PS.ui.label(g, label);
                var span = document.createElement("span");
                span.className = "opt-readout";
                span.textContent = v === null || v === undefined ? "" : (Math.round(v * 10) / 10) + (unit || "");
                if (title) { g.title = title; }
                g.appendChild(span);
            }
            out("X:", m && m.x, "", "Start point");
            out("Y:", m && m.y);
            out("W:", m && m.w, "", "Horizontal distance");
            out("H:", m && m.h, "", "Vertical distance");
            out("A:", m && m.angle, "°", m && R().c ? "Angle between the two arms" : "Angle from the horizontal");
            out("L1:", m && m.l1, "", "Length");
            out("L2:", m && m.l2, "", "Length of the second arm");
            PS.ui.sep(host);
            var st = PS.ui.button(host, "Straighten Layer", PS.straightenLayer);
            st.title = "Rotate the selected layers so the ruler is level";
            st.disabled = !m || !!R().c;
            var clr = PS.ui.button(host, "Clear", function () { setRuler(null); });
            clr.disabled = !m;
        },
        onDown: function (pt, e) {
            if (!PS.doc) { return; }
            var r = R();
            var h = hit(pt);
            if (r && h && e.altKey && (h === "a" || h === "b") && !r.c) {
                // protractor: the second arm starts at the grabbed end
                if (h === "b") { PS.doc.ruler = r = { a: r.b, b: r.a }; }
                r.c = { x: pt.x, y: pt.y };
                drag = { what: "c" };
            } else if (r && h === "line") {
                drag = { what: "line", start: pt, r0: PS.deepCopy(r) };
            } else if (r && h) {
                drag = { what: h };
            } else {
                PS.doc.ruler = { a: { x: pt.x, y: pt.y }, b: { x: pt.x, y: pt.y } };
                drag = { what: "b", fresh: true };
            }
        },
        onMove: function (pt, e) {
            var r = R();
            if (!drag) {
                var h = hit(pt);
                PS.el("workspace").style.cursor = h === "line" ? PS.cursors.move : (h ? "pointer" : "crosshair");
                return;
            }
            if (!r) { return; }
            if (drag.what === "line") {
                var dx = pt.x - drag.start.x, dy = pt.y - drag.start.y;
                ["a", "b", "c"].forEach(function (k) {
                    if (drag.r0[k]) { r[k] = { x: drag.r0[k].x + dx, y: drag.r0[k].y + dy }; }
                });
            } else {
                var anchor = drag.what === "a" ? r.b : r.a;
                r[drag.what] = e && e.shiftKey ? snap45(anchor, pt) : { x: pt.x, y: pt.y };
            }
            refresh();
        },
        onUp: function () {
            var r = R();
            if (drag && drag.fresh && r && Math.hypot(r.b.x - r.a.x, r.b.y - r.a.y) * PS.zoom < 2) {
                // a click without a drag clears the ruler
                PS.doc.ruler = null;
            }
            drag = null;
            refresh();
        },
        deactivate: function () { drag = null; },
        overlay: function (ctx) {
            var r = R();
            if (!r) { return; }
            var a = PS.docToOverlay(r.a.x, r.a.y), b = PS.docToOverlay(r.b.x, r.b.y);
            var c = r.c ? PS.docToOverlay(r.c.x, r.c.y) : null;
            ctx.save();
            function line(p, q) {
                ctx.beginPath();
                ctx.moveTo(p.x, p.y);
                ctx.lineTo(q.x, q.y);
                ctx.strokeStyle = "rgba(0,0,0,0.75)";
                ctx.lineWidth = 3;
                ctx.stroke();
                ctx.strokeStyle = "#ffffff";
                ctx.lineWidth = 1;
                ctx.stroke();
            }
            function end(p) {
                ctx.beginPath();
                ctx.moveTo(p.x - 6, p.y); ctx.lineTo(p.x + 6, p.y);
                ctx.moveTo(p.x, p.y - 6); ctx.lineTo(p.x, p.y + 6);
                ctx.strokeStyle = "rgba(0,0,0,0.75)";
                ctx.lineWidth = 3;
                ctx.stroke();
                ctx.strokeStyle = "#ffffff";
                ctx.lineWidth = 1;
                ctx.stroke();
            }
            line(a, b);
            if (c) {
                line(a, c);
                // the arc between the arms
                var a1 = Math.atan2(b.y - a.y, b.x - a.x), a2 = Math.atan2(c.y - a.y, c.x - a.x);
                var rad = Math.min(28, Math.hypot(b.x - a.x, b.y - a.y) / 2, Math.hypot(c.x - a.x, c.y - a.y) / 2);
                var d = a2 - a1;
                while (d > Math.PI) { d -= Math.PI * 2; }
                while (d < -Math.PI) { d += Math.PI * 2; }
                ctx.beginPath();
                ctx.arc(a.x, a.y, Math.max(6, rad), a1, a1 + d, d < 0);
                ctx.strokeStyle = "rgba(0,0,0,0.75)";
                ctx.lineWidth = 3;
                ctx.stroke();
                ctx.strokeStyle = "#ffffff";
                ctx.lineWidth = 1;
                ctx.stroke();
                end(c);
            }
            end(a);
            end(b);
            ctx.restore();
        }
    });
})();

/* ============================================================
   NOTES
   ============================================================ */

PS.NOTE_ICON_PX = 18;       // note icon size on screen
PS.activeNoteId = null;

function noteList() { return (PS.doc && PS.doc.notes) || []; }

PS.noteById = function (id) {
    var l = noteList();
    for (var i = 0; i < l.length; i++) { if (l[i].id === id) { return l[i]; } }
    return null;
};

function newNoteId() { return "n" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }

function noteDate() {
    var d = new Date();
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}

// the author of new notes (Note tool options, remembered)
PS.defaultNoteAuthor = function () {
    return PS.toolOpts.note.author || "";
};

// Change the notes as one undo step
PS.notesChange = function (label, mutate) {
    var d = PS.doc;
    if (!d) { return; }
    var before = PS.deepCopy(d.notes || []);
    mutate();
    var after = PS.deepCopy(d.notes || []);
    PS.pushHistory(label,
        function () { d.notes = PS.deepCopy(before); PS.notesChanged(); },
        function () { d.notes = PS.deepCopy(after); PS.notesChanged(); });
    PS.notesChanged();
};

PS.notesChanged = function () {
    if (PS.activeNoteId && !PS.noteById(PS.activeNoteId)) { PS.activeNoteId = null; }
    if (PS.ws) { PS.ws.refresh(); }
    if (PS.tool === "note") { PS.renderOptionsBar(); }
};

PS.openNote = function (id) {
    PS.activeNoteId = id;
    if (PS.ws && !PS.ws.isVisible("notes")) { PS.ws.showPanel("notes"); } else if (PS.ws) { PS.ws.refresh(); }
    var ta = document.querySelector("#panel-notes-body textarea");
    if (ta) { ta.focus(); }
};

PS.deleteNote = function (id) {
    PS.notesChange("Delete Note", function () {
        PS.doc.notes = noteList().filter(function (n) { return n.id !== id; });
    });
};

PS.deleteAllNotes = function () {
    if (!noteList().length) { return; }
    PS.notesChange("Delete All Notes", function () { PS.doc.notes = []; });
};

// the note whose icon is under doc point pt (topmost first)
function noteAt(pt) {
    var l = noteList();
    var s = PS.NOTE_ICON_PX / PS.zoom;
    for (var i = l.length - 1; i >= 0; i--) {
        var n = l[i];
        if (pt.x >= n.x && pt.x <= n.x + s && pt.y >= n.y && pt.y <= n.y + s) { return n; }
    }
    return null;
}
PS.noteAt = noteAt;

// note icons over the canvas (whenever Extras are visible)
PS.drawNotes = function (ctx) {
    var l = noteList();
    if (!l.length || PS.extrasVisible === false) { return; }
    var S = PS.NOTE_ICON_PX;
    l.forEach(function (n) {
        var p = PS.docToOverlay(n.x, n.y);
        var x = Math.round(p.x) + 0.5, y = Math.round(p.y) + 0.5;
        ctx.save();
        ctx.fillStyle = n.color || "#ffd84a";
        ctx.strokeStyle = "#1a1a1a";
        ctx.lineWidth = 1;
        // a sticky note with a folded corner
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + S, y);
        ctx.lineTo(x + S, y + S - 5);
        ctx.lineTo(x + S - 5, y + S);
        ctx.lineTo(x, y + S);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x + S, y + S - 5);
        ctx.lineTo(x + S - 5, y + S - 5);
        ctx.lineTo(x + S - 5, y + S);
        ctx.stroke();
        ctx.strokeStyle = "rgba(0,0,0,0.55)";
        ctx.beginPath();
        for (var k = 0; k < 3; k++) { ctx.moveTo(x + 4, y + 5 + k * 3.5); ctx.lineTo(x + S - 4 - (k === 2 ? 5 : 0), y + 5 + k * 3.5); }
        ctx.stroke();
        if (n.id === PS.activeNoteId) {
            ctx.strokeStyle = "#3d8ee6";
            ctx.lineWidth = 2;
            ctx.strokeRect(x - 2.5, y - 2.5, S + 5, S + 5);
        }
        ctx.restore();
    });
};

(function () {
    var drag = null;

    PS.registerTool("note", {
        name: "Note",
        key: "i",
        hint: "Click to add a note, click a note to read it, drag a note to move it",
        cursor: "crosshair",
        icon: '<svg viewBox="0 0 24 24" stroke-width="1.5"><path d="M4 4h16v11l-5 5H4z"/><path d="M15 20v-5h5M7.5 8.5h9M7.5 11.5h9M7.5 14.5h5"/></svg>',
        options: function (host) {
            var o = PS.toolOpts.note;
            var g = PS.ui.group(host);
            PS.ui.label(g, "Author:");
            var au = document.createElement("input");
            au.type = "text";
            au.className = "opt-text";
            au.value = PS.defaultNoteAuthor();
            au.placeholder = "Your name";
            au.addEventListener("change", function () { o.author = au.value.trim(); PS.savePrefsDebounced(); });
            g.appendChild(au);
            var g2 = PS.ui.group(host);
            PS.ui.label(g2, "Color:");
            var col = document.createElement("input");
            col.type = "color";
            col.className = "opt-color";
            col.value = o.color || "#ffd84a";
            col.title = "Color of new notes (and of the open note)";
            col.addEventListener("change", function () {
                o.color = col.value;
                PS.savePrefsDebounced();
                var n = PS.activeNoteId && PS.noteById(PS.activeNoteId);
                if (n && n.color !== col.value) {
                    PS.notesChange("Note Color", function () { PS.noteById(n.id).color = col.value; });
                }
            });
            g2.appendChild(col);
            PS.ui.sep(host);
            var clr = PS.ui.button(host, "Clear All", PS.deleteAllNotes);
            clr.title = "Delete every note of the document";
            clr.disabled = !noteList().length;
            var tg = document.createElement("button");
            tg.type = "button";
            tg.className = "opt-icon-btn" + (PS.ws.isVisible("notes") ? " active" : "");
            tg.title = "Show or hide the Notes panel";
            tg.innerHTML = '<svg viewBox="0 0 24 24" stroke-width="1.5"><path d="M3 6h7l2 2h9v11H3z"/><path d="M8 12h8M8 15h5"/></svg>';
            tg.addEventListener("click", function () {
                if (PS.ws.isVisible("notes")) { PS.ws.hidePanel("notes"); } else { PS.ws.showPanel("notes"); }
                PS.renderOptionsBar();
            });
            host.appendChild(tg);
        },
        onDown: function (pt) {
            if (!PS.doc) { return; }
            var n = noteAt(pt);
            if (n) {
                drag = { id: n.id, start: pt, x0: n.x, y0: n.y, moved: false };
                PS.activeNoteId = n.id;
                PS.notesChanged();
                return;
            }
            if (pt.x < 0 || pt.y < 0 || pt.x > PS.doc.width || pt.y > PS.doc.height) { return; }
            var o = PS.toolOpts.note;
            var note = {
                id: newNoteId(), x: Math.round(pt.x), y: Math.round(pt.y), author: PS.defaultNoteAuthor(),
                color: o.color || "#ffd84a", text: "", date: noteDate()
            };
            PS.notesChange("New Note", function () {
                PS.doc.notes = noteList().concat([note]);
            });
            PS.openNote(note.id);
        },
        onMove: function (pt) {
            if (!drag) {
                PS.el("workspace").style.cursor = noteAt(pt) ? "pointer" : "crosshair";
                return;
            }
            var n = PS.noteById(drag.id);
            if (!n) { return; }
            var dx = pt.x - drag.start.x, dy = pt.y - drag.start.y;
            if (!drag.moved && Math.hypot(dx, dy) * PS.zoom < 3) { return; }
            drag.moved = true;
            n.x = Math.round(PS.clamp(drag.x0 + dx, 0, PS.doc.width - 1));
            n.y = Math.round(PS.clamp(drag.y0 + dy, 0, PS.doc.height - 1));
        },
        onUp: function () {
            if (!drag) { return; }
            var d = drag;
            drag = null;
            var n = PS.noteById(d.id);
            if (!n) { return; }
            if (!d.moved) { PS.openNote(d.id); return; }
            var to = { x: n.x, y: n.y };
            n.x = d.x0; n.y = d.y0;
            PS.notesChange("Move Note", function () { var m = PS.noteById(d.id); m.x = to.x; m.y = to.y; });
        },
        onKey: function (e) {
            if ((e.key === "Delete" || e.key === "Backspace") && PS.activeNoteId && PS.noteById(PS.activeNoteId)) {
                PS.deleteNote(PS.activeNoteId);
                return true;
            }
            return false;
        },
        deactivate: function () { drag = null; }
    });
})();

// right-click on a note (any tool): open / delete
PS.noteContextMenu = function (e, pt) {
    var n = noteAt(pt);
    if (!n) { return false; }
    PS.contextMenu(e.clientX, e.clientY, [
        { label: "Open Note", action: function () { PS.openNote(n.id); } },
        { label: "Delete Note", action: function () { PS.deleteNote(n.id); } },
        { label: "Delete All Notes", action: PS.deleteAllNotes }
    ]);
    return true;
};

/* ---------- Notes panel ---------- */

PS.renderNotesPanel = function () {
    var body = PS.el("panel-notes-body");
    if (!body) { return; }
    body.innerHTML = "";
    body.classList.add("notes-panel");
    var list = noteList();
    var n = PS.activeNoteId && PS.noteById(PS.activeNoteId);
    if (!n && list.length) { n = list[0]; PS.activeNoteId = n.id; }
    if (!n) {
        var empty = document.createElement("div");
        empty.className = "notes-empty";
        empty.textContent = PS.doc ? "No notes. Click the image with the Note tool (I) to add one." : "No document open.";
        body.appendChild(empty);
        return;
    }
    var head = document.createElement("div");
    head.className = "notes-head";
    var who = document.createElement("div");
    who.className = "notes-who";
    who.innerHTML = "";
    var sw = document.createElement("span");
    sw.className = "notes-swatch";
    sw.style.background = n.color || "#ffd84a";
    who.appendChild(sw);
    var nm = document.createElement("span");
    nm.textContent = (n.author || "Unknown author") + (n.date ? "  ·  " + n.date : "");
    who.appendChild(nm);
    head.appendChild(who);
    body.appendChild(head);

    var ta = document.createElement("textarea");
    ta.className = "notes-text";
    ta.value = n.text || "";
    ta.placeholder = "Write a note...";
    var original = n.text || "";
    ta.addEventListener("input", function () {
        // live (the undo step is recorded when the text box is left)
        n.text = ta.value;
        PS.markDirty();
        PS.historyChanged();
    });
    ta.addEventListener("change", function () {
        var now = ta.value;
        if (now === original) { return; }
        n.text = original;
        PS.notesChange("Edit Note", function () { PS.noteById(n.id).text = now; });
        original = now;
    });
    body.appendChild(ta);

    var foot = document.createElement("div");
    foot.className = "panel-footer notes-foot";
    var idx = list.indexOf(n);
    function btn(icon, title, fn, disabled) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "opt-icon-btn";
        b.title = title;
        b.innerHTML = icon;
        b.disabled = !!disabled;
        b.addEventListener("click", fn);
        foot.appendChild(b);
        return b;
    }
    btn('<svg viewBox="0 0 24 24" stroke-width="1.8"><path d="M15 6l-6 6 6 6"/></svg>', "Previous note", function () {
        ta.blur(); PS.activeNoteId = list[(idx - 1 + list.length) % list.length].id; PS.ws.refresh();
    }, list.length < 2);
    var pos = document.createElement("span");
    pos.className = "notes-pos";
    pos.textContent = (idx + 1) + " of " + list.length;
    foot.appendChild(pos);
    btn('<svg viewBox="0 0 24 24" stroke-width="1.8"><path d="M9 6l6 6-6 6"/></svg>', "Next note", function () {
        ta.blur(); PS.activeNoteId = list[(idx + 1) % list.length].id; PS.ws.refresh();
    }, list.length < 2);
    var sp = document.createElement("span");
    sp.style.flex = "1";
    foot.appendChild(sp);
    btn('<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg>', "Delete note", function () {
        PS.deleteNote(n.id);
    });
    body.appendChild(foot);
};

PS.registerNotesPanel = function () {
    PS.ws.register("notes", {
        title: "Notes",
        icon: '<svg viewBox="0 0 24 24" stroke-width="1.5"><path d="M4 4h16v11l-5 5H4z"/><path d="M15 20v-5h5M7.5 8.5h9M7.5 11.5h9"/></svg>',
        render: PS.renderNotesPanel,
        menu: function () {
            return [{ label: "Delete All Notes", action: PS.deleteAllNotes, enabled: function () { return noteList().length > 0; } }];
        }
    });
};

/* ---------- notes in files ---------- */

function hexToRgb255(hex) {
    var c = PS.hexToRgb(hex || "#ffd84a") || { r: 255, g: 216, b: 74 };
    return { r: c.r, g: c.g, b: c.b };
}

// PSD annotations -> notes (sound notes are kept aside, untouched)
PS.notesFromPsd = function (annotations) {
    var notes = [], keep = [];
    (annotations || []).forEach(function (a) {
        if (a.type !== "text") { keep.push(a); return; }
        var loc = a.iconLocation || { left: 0, top: 0 };
        var rgb = a.color ? PS.psdColorToRgb(a.color) : [255, 216, 74];
        notes.push({
            id: newNoteId(), x: Math.round(loc.left || 0), y: Math.round(loc.top || 0),
            author: a.author || "", color: PS.rgbToHex(rgb[0], rgb[1], rgb[2]), text: a.data || "",
            date: a.date || "", name: a.name || "", open: !!a.open
        });
    });
    return { notes: notes, other: keep };
};

// notes -> PSD annotations
PS.notesToPsd = function (notes, other) {
    var out = (notes || []).map(function (n) {
        return {
            type: "text", open: false,
            iconLocation: { left: n.x, top: n.y, right: n.x + 24, bottom: n.y + 24 },
            popupLocation: { left: n.x + 30, top: n.y, right: n.x + 270, bottom: n.y + 180 },
            color: hexToRgb255(n.color), author: n.author || "", name: n.name || "", date: n.date || "", data: n.text || ""
        };
    });
    return out.concat(other || []);
};
