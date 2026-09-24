/*
    ArozOS Office Suite - documents requested from an ArozOS share link
    ===================================================================

    What lets the standalone web edition open a document that lives on some
    ArozOS server, by link:

        index.html?request=https://my.aroz.host/share/<uuid>/

    The link is the ordinary share link an ArozOS user copies from the share
    dialog. It points at an HTML download page, which is useless to a script
    on another origin, so it is rewritten to the share's preview endpoint,

        https://my.aroz.host/share/preview/<uuid>/

    which serves the raw file with Access-Control-Allow-Origin: * (see
    mod/share). Only a share that is open to everyone ("anyone with the
    link") answers a cross-origin request: a share limited to signed-in users
    or groups needs an ArozOS login this page does not have, and reports so.

    The preview endpoint sends no usable Content-Type for .doca / .xlsa /
    .ppta, and older servers no filename either, so which app a document
    belongs to is read from the document itself (the envelope's "app"), and
    the name comes from, in order: an explicit &name=, the server's
    Content-Disposition, a /share/download/<uuid>/<name> link, or a default.

    Nothing here is allowed to become a general "fetch any URL" primitive:
    parse() only accepts http(s) URLs whose path is an ArozOS share path with
    a well-formed id, and the request is always rewritten to the preview
    endpoint of that same origin, without credentials.

    Usage:
        var info = OfficeShare.parse(link);          // throws Error(message)
        OfficeShare.fetch(info.previewUrl, function (bytes, serverName) { },
                          function (message) { });
        OfficeShare.appOf(bytes)                     // "document" | ... | null
        OfficeShare.fileName(app, [candidates...])   // "Report.doca"

    Requires container.js (OfficeContainer) for appOf(). Has no DOM
    dependencies beyond XMLHttpRequest, so it also loads in Node for
    test_share.js.
*/
var OfficeShare = (function () {
    "use strict";

    var EXT = { document: ".doca", spreadsheet: ".xlsa", presentation: ".ppta" };
    var DEFAULT_NAME = {
        document: "Shared document",
        spreadsheet: "Shared spreadsheet",
        presentation: "Shared presentation"
    };
    // share ids are UUIDs; accept the general shape rather than one version
    var ID_RE = /^[A-Za-z0-9-]{8,64}$/;
    var PARSE_URL = (typeof URL === "function") ? URL : null;

    function fail(msg) { throw new Error(msg); }

    /* ---------------- link -> preview endpoint ---------------- */

    /*
        Accepted shapes, each optionally under a path prefix (an ArozOS
        behind a reverse proxy at /aroz/ keeps that prefix):

          /share/<id>[/]                    the link the share dialog copies
          /share/preview/<id>[/]            already the preview endpoint
          /share/download/<id>[/<name>]     the download link
          /share?id=<id>                    the legacy link form
    */
    function parse(input) {
        var raw = String(input == null ? "" : input).trim();
        if (!raw) fail("No share link was given.");
        if (!PARSE_URL) fail("This browser cannot read links.");

        var u;
        try { u = new PARSE_URL(raw); } catch (e) { fail("That is not a valid link: " + raw); }
        if (u.protocol !== "http:" && u.protocol !== "https:") {
            fail("Only http and https share links can be opened.");
        }
        if (u.username || u.password) fail("Share links with a user name in them are not accepted.");

        var segs = u.pathname.split("/").filter(function (s) { return s !== ""; });
        var decoded = segs.map(function (s) {
            try { return decodeURIComponent(s); } catch (e) { return s; }
        });

        // walk back from the end, so a prefix that happens to contain a
        // "share" folder does not get mistaken for the share path itself
        for (var i = decoded.length - 1; i >= 0; i--) {
            if (decoded[i] !== "share") continue;
            var rest = decoded.slice(i + 1);
            var id = null, nameHint = "";
            if (rest.length === 0) {
                id = u.searchParams.get("id");
            } else if (rest[0] === "preview" || rest[0] === "download") {
                id = rest[1] || null;
                if (rest[0] === "download" && rest.length > 2) nameHint = rest[rest.length - 1];
            } else if (rest.length <= 2) {
                // /share/<id>/ - a trailing file name segment is tolerated,
                // the download page redirects it the same way
                id = rest[0];
            }
            if (!id || !ID_RE.test(id)) continue;
            var prefix = segs.slice(0, i).join("/");
            return {
                id: id,
                origin: u.origin,
                previewUrl: u.origin + "/" + (prefix ? prefix + "/" : "") +
                    "share/preview/" + encodeURIComponent(id) + "/",
                nameHint: cleanName(nameHint)
            };
        }
        fail("That link is not an ArozOS share link (expected .../share/<id>/).");
    }

    /* ---------------- file names ---------------- */

    // a name is only ever used for the download a Save produces, but keep
    // it to a plain file name all the same
    function cleanName(name) {
        var s = String(name == null ? "" : name);
        s = s.replace(/[\u0000-\u001f\u007f]/g, "");
        s = s.substring(Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\")) + 1);
        s = s.trim();
        if (s === "." || s === "..") return "";
        return s.length > 200 ? s.substring(0, 200) : s;
    }

    function extOf(name) {
        var i = name.lastIndexOf(".");
        return i <= 0 ? "" : name.substring(i).toLowerCase();
    }

    /* The first usable candidate, forced to the app's own extension: a
       .doca is opened by Docs only when its name says .doca, and a name
       carrying another extension would be the wrong format on Save. */
    function fileName(app, candidates) {
        var ext = EXT[app] || "";
        var list = candidates || [];
        for (var i = 0; i < list.length; i++) {
            var n = cleanName(list[i]);
            if (!n) continue;
            if (!ext || extOf(n) === ext) return n;
            var base = extOf(n) ? n.substring(0, n.lastIndexOf(".")) : n;
            // ".doca" alone is an extension, not a name
            if (base && base.toLowerCase() !== ext) return base + ext;
        }
        return (DEFAULT_NAME[app] || "Shared document") + ext;
    }

    /* filename from a Content-Disposition header: RFC 6266 filename* wins
       over the plain filename, as browsers do. */
    function dispositionName(header) {
        var h = String(header || "");
        if (!h) return "";
        var star = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(h);
        if (star) {
            try { return cleanName(decodeURIComponent(star[2].trim().replace(/^"|"$/g, ""))); }
            catch (e) { /* fall through to the plain form */ }
        }
        var plain = /filename\s*=\s*("((?:[^"\\]|\\.)*)"|[^;]+)/i.exec(h);
        if (!plain) return "";
        var v = plain[2] !== undefined ? plain[2].replace(/\\(.)/g, "$1") : plain[1].trim();
        return cleanName(v);
    }

    /* ---------------- the document itself ---------------- */

    function looksLikeDocument(bytes) {
        if (!bytes || bytes.length < 2) return false;
        if (bytes[0] === 0x50 && bytes[1] === 0x4B) return true;   // zip container
        // a pre-container plain JSON document, possibly after a BOM/space
        for (var i = 0; i < Math.min(bytes.length, 8); i++) {
            var c = bytes[i];
            if (c === 0x7B) return true;                            // {
            if (c !== 0x20 && c !== 0x0A && c !== 0x0D && c !== 0x09 &&
                c !== 0xEF && c !== 0xBB && c !== 0xBF) return false;
        }
        return false;
    }

    // which app a native document belongs to, from its envelope
    function appOf(bytes) {
        var C = (typeof OfficeContainer !== "undefined") ? OfficeContainer : null;
        if (!C || !looksLikeDocument(bytes)) return null;
        try {
            var env = JSON.parse(C.unpack(bytes));
            return (env && EXT[env.app]) ? env.app : null;
        } catch (e) {
            return null;
        }
    }

    /* ---------------- fetching ---------------- */

    function describeFailure(status, url) {
        if (status === 401 || status === 403) {
            return "This share is not public. Ask its owner to set it to " +
                "\"anyone with the link\", or open it in ArozOS.";
        }
        if (status === 404 || status === 410) return "That share no longer exists.";
        if (status === 400) {
            return "The server could not serve that share as a file - it may be a folder share.";
        }
        if (status) return "The server answered HTTP " + status + ".";
        // status 0: blocked before any answer - say why when we can tell
        var page = (typeof location !== "undefined") ? location.protocol : "";
        if (page === "https:" && /^http:/i.test(url)) {
            return "This page is served over https, and the browser blocks it " +
                "from reading a share on a plain http server. Use an https " +
                "link to the ArozOS server.";
        }
        // (a missing or restricted share is answered without CORS headers,
        // so to this page it looks exactly like an unreachable server)
        return "Could not read that share. It may have been removed, it may be " +
            "limited to signed-in users, or the server may be offline.";
    }

    function fetchShare(previewUrl, cb, errcb) {
        if (typeof XMLHttpRequest === "undefined") { errcb("This browser cannot download files."); return; }
        var xhr = new XMLHttpRequest();
        xhr.open("GET", previewUrl, true);
        xhr.responseType = "arraybuffer";
        xhr.withCredentials = false;
        xhr.onload = function () {
            if (xhr.status < 200 || xhr.status >= 300) {
                errcb(describeFailure(xhr.status, previewUrl));
                return;
            }
            var bytes = new Uint8Array(xhr.response || new ArrayBuffer(0));
            if (!looksLikeDocument(bytes)) {
                errcb("That share is not an ArozOS Office document (.doca, .xlsa or .ppta).");
                return;
            }
            var name = "";
            // readable only when the server exposes it (older ArozOS does
            // not); asking for an unexposed header logs a console error, so
            // look in the list of exposed ones first
            try {
                if (/^content-disposition:/im.test(xhr.getAllResponseHeaders() || "")) {
                    name = dispositionName(xhr.getResponseHeader("Content-Disposition"));
                }
            } catch (e) { name = ""; }
            cb(bytes, name);
        };
        xhr.onerror = function () { errcb(describeFailure(0, previewUrl)); };
        xhr.send();
    }

    return {
        parse: parse,
        fetch: fetchShare,
        appOf: appOf,
        fileName: fileName,
        cleanName: cleanName,
        dispositionName: dispositionName,
        extension: function (app) { return EXT[app] || ""; }
    };
})();

if (typeof module !== "undefined" && module.exports) {
    module.exports = OfficeShare;
}
