/*
    dockermanager.js

    Shared helpers for the Docker Manager web app: API base, fetch wrappers,
    websocket URL resolution (proxy-path safe), HTML escaping, theme, toast and
    localization (strings live in ../locale/*.json next to the app).
    All paths are relative so the app keeps working when ArozOS is reverse
    proxied under a sub-path.
*/
var DM = (function () {
    var API = "../system/docker/";

    // Resolve a relative URL against the current document into an absolute URL.
    function absURL(rel) {
        var a = document.createElement("a");
        a.href = rel;
        return a.href;
    }

    return {
        api: API,

        get: function (endpoint, onDone, onFail) {
            return $.get(API + endpoint, onDone).fail(onFail || function () {});
        },

        post: function (endpoint, data, onDone, onFail) {
            return $.post(API + endpoint, data, onDone).fail(onFail || function () {});
        },

        // Build a ws:// or wss:// URL for a streaming endpoint, preserving any
        // reverse-proxy sub-path.
        wsURL: function (endpoint) {
            return absURL(API + endpoint).replace(/^http/, "ws");
        },

        esc: function (s) {
            return String(s == null ? "" : s)
                .replace(/&/g, "&amp;").replace(/</g, "&lt;")
                .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
        },

        applyTheme: function () {
            try {
                if (typeof ao_module_getSystemThemeColor === "function") {
                    ao_module_getSystemThemeColor(function (c) {
                        document.body.classList.toggle("dark", c !== "whiteTheme");
                    });
                }
            } catch (e) {}
        },

        // Localized string from the page's locale file (English fallback),
        // with {name} placeholders filled in from vars.
        t: function (key, fallback, vars) {
            var s = (typeof applocale !== "undefined" && applocale) ? applocale.getString(key, fallback) : fallback;
            if (vars) {
                Object.keys(vars).forEach(function (k) { s = s.split("{" + k + "}").join(vars[k]); });
            }
            return s;
        },

        // Load the locale file, translate the static markup, then start the page.
        // The page still starts (in English) when the locale file is unavailable.
        initLocale: function (file, start) {
            if (typeof applocale === "undefined" || !applocale) { start(); return; }
            applocale.init(file, function () { applocale.translate(); start(); }, start);
        },

        toast: function (msg, ok) {
            var t = document.getElementById("dm-toast");
            if (!t) return;
            t.textContent = msg;
            t.style.background = ok === false ? "#c42b1c" : (ok === true ? "#107c10" : "#2b6cb0");
            t.style.display = "block";
            clearTimeout(t._timer);
            t._timer = setTimeout(function () { t.style.display = "none"; }, 3200);
        }
    };
})();
