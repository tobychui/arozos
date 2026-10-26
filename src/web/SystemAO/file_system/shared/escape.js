/*
    escape.js

    Single HTML-escaping helper shared by the file system web apps. Keeping it
    here avoids a different implementation drifting in each page that renders
    file names.

    Escapes the five characters that can change HTML/attribute parsing. The
    result is safe in text nodes and in double-quoted attributes.
*/

(function (global) {
    "use strict";

    function escapeHTML(value) {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    global.escapeHTML = escapeHTML;
})(window);
