/*
    dockermanager.js

    Shared helpers for the Docker Manager web app: API base, fetch wrappers,
    websocket URL resolution (proxy-path safe), HTML escaping, theme and toast.
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
