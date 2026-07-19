/*
    ArozOS Office - shared keyboard hotkey registry (OfficeHotkeys)
    ================================================================
    One window-level capture listener dispatches every keyboard shortcut
    in an Office app. Both the framework (office.js registerShortcut) and
    the apps register through it, so bindings never fight each other and
    a single help dialog (Ctrl+/) can list them all.

    OfficeHotkeys.register("Ctrl+Shift+G", handler, {
        id: "slides.ungroup",        // optional stable id (for unregister)
        description: "Ungroup",      // shown in the help dialog; omit to hide
        group: "Objects",            // help dialog section (default "General")
        when: function(e){...},      // extra gate; falsy = skip this handler
        allowInInput: false,         // fire even while typing in an input/
                                     // textarea/contenteditable (default no)
        inDialogs: false             // fire while an OfficeApp dialog is open
    }) -> id

    Handler contract: return false to fall through (the next matching
    handler - or the browser default - gets the key); anything else
    consumes the event (preventDefault + stopPropagation).

    Handlers registered later win over earlier ones (LIFO), so app
    bindings naturally override framework defaults for the same combo.

    Combo syntax: "Ctrl+X", "Ctrl+Shift+ArrowLeft", "F5", "Delete",
    "Escape", "Ctrl++" (plus key), "Space". "Cmd"/"Meta" normalize to
    Ctrl so macOS users get the expected bindings.
*/

var OfficeHotkeys = (function () {
    var entries = [];      // registration order preserved; dispatch is LIFO
    var seq = 0;
    var bound = false;
    var enabled = true;

    /* ---------- combo parsing ---------- */
    var KEY_ALIASES = {
        "esc": "escape", "del": "delete", "ins": "insert",
        "return": "enter", "spacebar": "space", " ": "space",
        "+": "plus", "left": "arrowleft", "right": "arrowright",
        "up": "arrowup", "down": "arrowdown", "pgup": "pageup",
        "pgdn": "pagedown"
    };
    function canonKey(k) {
        k = String(k).toLowerCase();
        return KEY_ALIASES[k] || k;
    }
    // "Ctrl++" would confuse a plain split; protect the trailing plus key
    function normalize(combo) {
        var s = String(combo).replace(/\+\+$/, "+plus");
        var parts = s.split("+");
        var mods = { ctrl: false, alt: false, shift: false };
        var key = "";
        parts.forEach(function (p) {
            var l = p.trim().toLowerCase();
            if (l === "ctrl" || l === "cmd" || l === "meta") mods.ctrl = true;
            else if (l === "alt") mods.alt = true;
            else if (l === "shift") mods.shift = true;
            else if (l !== "") key = canonKey(l);
        });
        return (mods.ctrl ? "ctrl+" : "") + (mods.alt ? "alt+" : "") +
            (mods.shift ? "shift+" : "") + key;
    }
    function comboFromEvent(e) {
        if (!e.key) return "";
        return ((e.ctrlKey || e.metaKey) ? "ctrl+" : "") + (e.altKey ? "alt+" : "") +
            (e.shiftKey ? "shift+" : "") + canonKey(e.key);
    }

    /* ---------- environment guards ---------- */
    function isTypingTarget(t) {
        if (!t) return false;
        var tag = (t.tagName || "").toUpperCase();
        return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" ||
            !!t.isContentEditable;
    }
    function dialogOpen() {
        return document.querySelector(".of-dialog-overlay") !== null;
    }

    /* ---------- dispatch ---------- */
    function handle(e) {
        if (!enabled) return;
        var combo = comboFromEvent(e);
        if (!combo) return;
        // LIFO: later registrations (apps) shadow earlier ones (framework)
        for (var i = entries.length - 1; i >= 0; i--) {
            var en = entries[i];
            if (en.combo !== combo) continue;
            if (!en.inDialogs && dialogOpen()) continue;
            if (!en.allowInInput && isTypingTarget(e.target)) continue;
            if (en.when && !en.when(e)) continue;
            var r;
            try { r = en.handler(e); } catch (err) { r = undefined; }
            if (r === false) continue;   // explicit fall-through
            e.preventDefault();
            e.stopPropagation();
            return;
        }
    }
    function bind() {
        if (bound) return;
        bound = true;
        window.addEventListener("keydown", handle, true);
    }

    /* ---------- public ---------- */
    function register(combo, handler, opts) {
        opts = opts || {};
        bind();
        var id = opts.id || ("hk-" + (++seq));
        // same id re-registers (replaces) instead of stacking duplicates
        unregister(id);
        entries.push({
            id: id,
            combo: normalize(combo),
            display: String(combo),
            handler: handler,
            description: opts.description || "",
            group: opts.group || "General",
            when: opts.when || null,
            allowInInput: !!opts.allowInInput,
            inDialogs: !!opts.inDialogs
        });
        return id;
    }
    function unregister(id) {
        for (var i = entries.length - 1; i >= 0; i--) {
            if (entries[i].id === id) entries.splice(i, 1);
        }
    }
    function list() {
        // only described entries are meant for humans; combos registered
        // purely for behavior (e.g. menu-close on Escape) stay hidden
        var out = [];
        var seen = {};
        for (var i = entries.length - 1; i >= 0; i--) {
            var en = entries[i];
            if (!en.description || seen[en.combo]) continue;
            seen[en.combo] = true;
            out.push({ combo: en.display, description: en.description, group: en.group });
        }
        return out;
    }

    /* pretty label: "ctrl+shift+arrowleft" was registered as
       "Ctrl+Shift+ArrowLeft"; shorten arrows for the dialog */
    function displayCombo(c) {
        return String(c)
            .replace(/Arrow(Left|Right|Up|Down)/gi, "$1")
            .replace(/\bplus\b/gi, "+");
    }
    function showHelp() {
        if (!window.OfficeApp || !OfficeApp.dialog) return;
        var items = list();
        var groups = {};
        var order = [];
        items.forEach(function (it) {
            if (!groups[it.group]) { groups[it.group] = []; order.push(it.group); }
            groups[it.group].push(it);
        });
        var esc = OfficeApp.escapeHtml;
        var html = '<div class="of-hk-help">';
        order.forEach(function (g) {
            html += '<div class="of-hk-group">' + esc(g) + "</div><table class='of-hk-table'>";
            groups[g].forEach(function (it) {
                html += "<tr><td class='of-hk-combo'><kbd>" +
                    esc(displayCombo(it.combo)).split("+").join("</kbd>+<kbd>") +
                    "</kbd></td><td>" + esc(it.description) + "</td></tr>";
            });
            html += "</table>";
        });
        html += "</div>";
        OfficeApp.dialog({
            title: "Keyboard shortcuts",
            body: html,
            wide: true,
            buttons: [{ label: "Close", primary: true }]
        });
    }

    return {
        register: register,
        unregister: unregister,
        list: list,
        normalize: normalize,
        comboFromEvent: comboFromEvent,
        isTypingTarget: isTypingTarget,
        setEnabled: function (v) { enabled = !!v; },
        showHelp: showHelp
    };
})();
