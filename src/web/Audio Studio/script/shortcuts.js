/*
    Audio Studio - shortcuts.js

    Customizable keyboard shortcut manager. Bindings are stored in
    localStorage so each browser remembers the user's own key map.

    A binding is a string like "Space", "S", "Ctrl+C" or "Ctrl+Shift+E".
*/

var ASShortcuts = (function () {
    "use strict";

    var STORAGE_KEY = "AudioStudio.keybinds";

    var ACTIONS = [
        { id: "playPause", label: "Play / Pause", group: "Transport", def: "Space" },
        { id: "stop", label: "Stop and return to cursor", group: "Transport", def: "Escape" },
        { id: "record", label: "Start / stop recording", group: "Transport", def: "R" },
        { id: "goToStart", label: "Go to project start", group: "Transport", def: "Home" },
        { id: "goToEnd", label: "Go to project end", group: "Transport", def: "End" },

        { id: "splitAtCursor", label: "Split clip at cursor", group: "Edit", def: "S" },
        { id: "copySelection", label: "Copy selection", group: "Edit", def: "Ctrl+C" },
        { id: "cutSelection", label: "Cut selection (close gap)", group: "Edit", def: "Ctrl+X" },
        { id: "pasteAtCursor", label: "Paste at cursor", group: "Edit", def: "Ctrl+V" },
        { id: "deleteSelection", label: "Delete selection", group: "Edit", def: "Delete" },
        { id: "muteSelection", label: "Silence selection (audio content to no sound)", group: "Edit", def: "M" },
        { id: "undo", label: "Undo", group: "Edit", def: "Ctrl+Z" },
        { id: "redo", label: "Redo", group: "Edit", def: "Ctrl+Y" },

        { id: "zoomIn", label: "Zoom in", group: "View", def: "=" },
        { id: "zoomOut", label: "Zoom out", group: "View", def: "-" },
        { id: "zoomFit", label: "Zoom to fit project", group: "View", def: "F" },
        { id: "toggleSnap", label: "Toggle snapping", group: "View", def: "G" },

        { id: "addTrack", label: "Add new track", group: "Project", def: "T" },
        { id: "exportMix", label: "Export mix as WAV", group: "Project", def: "Ctrl+E" }
    ];

    var bindings = {}; //actionId -> binding string
    var persistHandler = null; //Set by the app to sync bindings to the server

    function loadBindings() {
        var stored = null;
        try {
            stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
        } catch (e) {
            stored = null;
        }
        bindings = {};
        ACTIONS.forEach(function (a) {
            if (stored !== null && typeof stored[a.id] === "string") {
                bindings[a.id] = stored[a.id];
            } else {
                bindings[a.id] = a.def;
            }
        });
    }

    function saveBindings() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
        } catch (e) {
            //Storage full / unavailable: shortcuts just won't persist locally
        }
        if (persistHandler !== null) {
            persistHandler(bindings);
        }
    }

    //Register a callback that receives the binding map on every change,
    //used to persist shortcuts to the user's server-side appdata
    function setPersistHandler(fn) {
        persistHandler = fn;
    }

    //Merge bindings loaded from the server (e.g. saved on another device)
    function applyStored(stored) {
        if (stored === null || typeof stored !== "object") {
            return;
        }
        ACTIONS.forEach(function (a) {
            if (typeof stored[a.id] === "string") {
                bindings[a.id] = stored[a.id];
            }
        });
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
        } catch (e) { /* cache only */ }
    }

    //Normalize a KeyboardEvent into a binding string, or null for pure
    //modifier presses (e.g. holding Shift alone)
    function bindingFromEvent(e) {
        var key = e.key;
        if (key === "Control" || key === "Shift" || key === "Alt" || key === "Meta") {
            return null;
        }
        if (key === " " || key === "Spacebar") {
            key = "Space";
        } else if (key.length === 1) {
            key = key.toUpperCase();
        }
        var parts = [];
        if (e.ctrlKey || e.metaKey) { parts.push("Ctrl"); }
        if (e.altKey) { parts.push("Alt"); }
        if (e.shiftKey && key.length > 1) { parts.push("Shift"); }
        //For single characters Shift is already baked into e.key case/symbol,
        //but uppercase normalization discards it: keep Shift for letters
        if (e.shiftKey && key.length === 1 && /[A-Z]/.test(key)) { parts.push("Shift"); }
        parts.push(key);
        return parts.join("+");
    }

    //Return the action id matching a KeyboardEvent, or null
    function matchEvent(e) {
        var b = bindingFromEvent(e);
        if (b === null) {
            return null;
        }
        var ids = Object.keys(bindings);
        for (var i = 0; i < ids.length; i++) {
            if (bindings[ids[i]] === b) {
                return ids[i];
            }
        }
        return null;
    }

    function getActions() {
        return ACTIONS;
    }

    function getBinding(actionId) {
        return bindings[actionId] || "";
    }

    //Assign a binding to an action. Clears the same binding from any other
    //action to keep the key map unambiguous.
    function setBinding(actionId, binding) {
        Object.keys(bindings).forEach(function (id) {
            if (id !== actionId && bindings[id] === binding) {
                bindings[id] = "";
            }
        });
        bindings[actionId] = binding;
        saveBindings();
    }

    function resetBinding(actionId) {
        var action = ACTIONS.find(function (a) { return a.id === actionId; });
        if (action !== undefined) {
            setBinding(actionId, action.def);
        }
    }

    function resetAll() {
        bindings = {};
        ACTIONS.forEach(function (a) { bindings[a.id] = a.def; });
        saveBindings();
    }

    loadBindings();

    return {
        getActions: getActions,
        getBinding: getBinding,
        setBinding: setBinding,
        resetBinding: resetBinding,
        resetAll: resetAll,
        matchEvent: matchEvent,
        bindingFromEvent: bindingFromEvent,
        setPersistHandler: setPersistHandler,
        applyStored: applyStored
    };
})();
