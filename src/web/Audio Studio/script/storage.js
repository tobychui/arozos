/*
    Audio Studio - storage.js

    Settings persistence. Preferences and keyboard shortcuts are stored in
    the user's appdata folder on the ArozOS server
    (user:/.appdata/Audio_Studio/<key>.json) through the settings.agi
    backend script, so they follow the user across devices and browsers.

    localStorage is kept as a fast local cache and as the fallback when the
    app runs standalone (outside an ArozOS instance).
*/

var ASStorage = (function () {
    "use strict";

    var BACKEND_SCRIPT = "Audio Studio/backend/settings.agi";
    var LS_PREFIX = "AudioStudio.";

    //True when the AGI gateway helpers are available (served by ArozOS)
    function serverAvailable() {
        try {
            return typeof ao_module_agirun === "function" && typeof $ !== "undefined";
        } catch (e) {
            return false;
        }
    }

    function lsGet(key) {
        try {
            return JSON.parse(localStorage.getItem(LS_PREFIX + key));
        } catch (e) {
            return null;
        }
    }

    function lsSet(key, obj) {
        try {
            localStorage.setItem(LS_PREFIX + key, JSON.stringify(obj));
        } catch (e) { /* cache only */ }
    }

    //Load a setting object. cb(objOrNull) fires once with the best source:
    //server value when reachable, otherwise the localStorage cache.
    function load(key, cb) {
        var cached = lsGet(key);
        if (!serverAvailable()) {
            cb(cached);
            return;
        }
        ao_module_agirun(BACKEND_SCRIPT, { action: "get", key: key }, function (resp) {
            var obj = null;
            try {
                var data = typeof resp === "string" ? JSON.parse(resp) : resp;
                if (data.ok === true && data.content !== null && data.content !== undefined) {
                    obj = JSON.parse(data.content);
                }
            } catch (e) {
                obj = null;
            }
            if (obj !== null) {
                lsSet(key, obj); //Refresh the local cache
                cb(obj);
            } else {
                cb(cached);
            }
        }, function () {
            cb(cached); //Gateway unreachable: fall back to the cache
        });
    }

    //Save a setting object to the cache and (when available) the server
    function save(key, obj) {
        lsSet(key, obj);
        if (!serverAvailable()) {
            return;
        }
        ao_module_agirun(BACKEND_SCRIPT, {
            action: "set",
            key: key,
            value: JSON.stringify(obj)
        }, function () { /* saved */ }, function () { /* offline: cache only */ });
    }

    /* ---------- Base64 helpers (embedded project fallback) ---------- */

    function arrayBufferToBase64(ab) {
        var bytes = new Uint8Array(ab);
        var chunks = [];
        var CHUNK = 0x8000;
        for (var i = 0; i < bytes.length; i += CHUNK) {
            chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK)));
        }
        return btoa(chunks.join(""));
    }

    function base64ToArrayBuffer(b64) {
        var bin = atob(b64);
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) {
            bytes[i] = bin.charCodeAt(i);
        }
        return bytes.buffer;
    }

    return {
        serverAvailable: serverAvailable,
        load: load,
        save: save,
        arrayBufferToBase64: arrayBufferToBase64,
        base64ToArrayBuffer: base64ToArrayBuffer
    };
})();
