/*
    Musicify - localization
    Shared by index.html and embedded.html. The strings live in
    locale/musicify.json; static markup is translated by ../script/applocale.js
    (locale="key" attributes, titles and placeholders), script strings by T().
*/

// The translation of a key, or the English fallback. {name} placeholders are
// filled from vars.
function T(key, fallback, vars) {
    var text = fallback;
    if (typeof applocale !== "undefined" && applocale && applocale.localData && applocale.localData.keys) {
        text = applocale.getString(key, fallback);
    }
    if (vars) {
        text = text.replace(/\{(\w+)\}/g, function (match, name) {
            return vars[name] !== undefined ? vars[name] : match;
        });
    }
    return text;
}

// Language to format dates and times with; undefined keeps the browser's own
function localeTag() {
    if (typeof applocale !== "undefined" && applocale && applocale.localData &&
            applocale.localData.keys && applocale.localData.keys[applocale.lang]) {
        return applocale.lang;
    }
    return undefined;
}

// Load the language file, translate the static markup, then run callback. The
// page starts in English when the file cannot be loaded.
function loadAppLocale(callback) {
    if (typeof applocale === "undefined" || !applocale) {
        callback();
        return;
    }
    applocale.init("locale/musicify.json", function () {
        applocale.translate();
        callback();
    }, callback);
}
