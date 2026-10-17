/*
    i18n.js

    Thin wrapper over the shared script/applocale.js.

        T("toolbar/new", "New")                       -> localised or fallback
        T("msg/moved", "Moved {n} items", {n: 3})     -> placeholders
        DriveI18n.translate(rootElement)              -> fill [data-i18n] /
                                                         [data-i18n-title] /
                                                         [data-i18n-placeholder]

    English lives in the code as the fallback, so the page works even when
    locale/drive.json cannot be loaded.
*/

(function (global) {
    "use strict";

    var data = null;
    var lang = "en-us";

    function resolveLang() {
        var stored = null;
        try {
            stored = localStorage.getItem("global_language");
        } catch (e) {
            stored = null;
        }
        var l = (stored == null || stored == "default") ? navigator.language : stored;
        return String(l || "en-us").toLowerCase();
    }

    function table() {
        if (!data || !data.keys) {
            return null;
        }
        if (data.keys[lang]) {
            return data.keys[lang];
        }
        //zh-hant-tw style or bare language codes
        var base = lang.split("-")[0];
        if (base == "zh") {
            return data.keys[lang.indexOf("hans") >= 0 || lang.indexOf("cn") >= 0 || lang.indexOf("sg") >= 0 ? "zh-cn" : "zh-tw"] || null;
        }
        for (var k in data.keys) {
            if (k.split("-")[0] == base) {
                return data.keys[k];
            }
        }
        return null;
    }

    function T(key, fallback, vars) {
        var t = table();
        var text = (t && t.strings && t.strings[key] !== undefined) ? t.strings[key] : (fallback !== undefined ? fallback : key);
        if (vars) {
            Object.keys(vars).forEach(function (k) {
                text = text.split("{" + k + "}").join(vars[k]);
            });
        }
        return text;
    }

    function translate(root) {
        root = root || document;
        root.querySelectorAll("[data-i18n]").forEach(function (el) {
            if (!el.hasAttribute("data-i18n-fallback")) {
                el.setAttribute("data-i18n-fallback", el.textContent);
            }
            el.textContent = T(el.getAttribute("data-i18n"), el.getAttribute("data-i18n-fallback"));
        });
        root.querySelectorAll("[data-i18n-title]").forEach(function (el) {
            var key = el.getAttribute("data-i18n-title");
            var fb = el.getAttribute("data-i18n-title-fallback") || el.getAttribute("title") || "";
            el.setAttribute("data-i18n-title-fallback", fb);
            el.setAttribute("title", T(key, fb));
            el.setAttribute("aria-label", T(key, fb));
        });
        root.querySelectorAll("[data-i18n-placeholder]").forEach(function (el) {
            var key = el.getAttribute("data-i18n-placeholder");
            var fb = el.getAttribute("data-i18n-placeholder-fallback") || el.getAttribute("placeholder") || "";
            el.setAttribute("data-i18n-placeholder-fallback", fb);
            el.setAttribute("placeholder", T(key, fb));
        });
    }

    function load(callback) {
        lang = resolveLang();
        document.documentElement.setAttribute("lang", lang);
        var done = false;
        var finish = function () {
            if (!done) {
                done = true;
                callback();
            }
        };
        $.ajax({
            url: "Drive/locale/drive.json?v=1.0",
            dataType: "json",
            cache: true,
            success: function (json) {
                data = json;
                finish();
            },
            error: finish
        });
        //Never hold the page hostage to a slow locale file
        setTimeout(finish, 4000);
    }

    function setLanguage(code, callback) {
        try {
            localStorage.setItem("global_language", code);
        } catch (e) { }
        lang = resolveLang();
        document.documentElement.setAttribute("lang", lang);
        if (callback) {
            callback();
        }
    }

    function languages() {
        var list = [];
        if (data && data.keys) {
            Object.keys(data.keys).forEach(function (k) {
                list.push({ code: k, name: data.keys[k].name || k });
            });
        }
        return list;
    }

    //Dates and numbers follow the interface language
    function locale() {
        return lang;
    }

    global.T = T;
    global.DriveI18n = {
        load: load,
        translate: translate,
        setLanguage: setLanguage,
        languages: languages,
        locale: locale,
        current: function () {
            var stored = null;
            try { stored = localStorage.getItem("global_language"); } catch (e) { }
            return stored || "default";
        }
    };
})(window);
