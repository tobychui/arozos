/*
    util.js - small shared helpers for the Compare tool
*/

var CmpUtil = (function () {

    function escapeHtml(text) {
        if (text === undefined || text === null) {
            return "";
        }
        return String(text)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    //Strip trailing slashes but keep a bare "root:/" intact
    function trimSlash(vpath) {
        if (!vpath) {
            return "";
        }
        var p = vpath.replace(/\\/g, "/");
        while (p.length > 1 && p.charAt(p.length - 1) === "/" && !/:\/$/.test(p)) {
            p = p.substring(0, p.length - 1);
        }
        return p;
    }

    function joinPath(base, rel) {
        if (!rel) {
            return trimSlash(base);
        }
        var b = trimSlash(base);
        if (/:\/$/.test(b)) {
            return b + rel;
        }
        return b + "/" + rel;
    }

    function baseName(vpath) {
        var p = trimSlash(vpath);
        var idx = p.lastIndexOf("/");
        return idx < 0 ? p : p.substring(idx + 1);
    }

    function dirName(vpath) {
        var p = trimSlash(vpath);
        var idx = p.lastIndexOf("/");
        if (idx < 0) {
            return p;
        }
        var head = p.substring(0, idx);
        return /:$/.test(head) ? head + "/" : head;
    }

    function extName(filename) {
        var name = baseName(filename);
        var idx = name.lastIndexOf(".");
        return idx <= 0 ? "" : name.substring(idx).toLowerCase();
    }

    function formatSize(bytes) {
        if (bytes === undefined || bytes === null || bytes < 0) {
            return "";
        }
        return Number(bytes).toLocaleString();
    }

    function formatSizeShort(bytes) {
        var units = ["B", "KB", "MB", "GB", "TB"];
        var value = Number(bytes) || 0;
        var unit = 0;
        while (value >= 1024 && unit < units.length - 1) {
            value = value / 1024;
            unit++;
        }
        return (unit === 0 ? value : value.toFixed(value < 10 ? 2 : 1)) + " " + units[unit];
    }

    function pad2(n) {
        return n < 10 ? "0" + n : "" + n;
    }

    //Beyond Compare style timestamp: 10/18/2013 3:48:30 PM
    function formatTime(unixSeconds) {
        if (!unixSeconds) {
            return "";
        }
        var d = new Date(Number(unixSeconds) * 1000);
        if (isNaN(d.getTime())) {
            return "";
        }
        var hours = d.getHours();
        var suffix = hours >= 12 ? "PM" : "AM";
        hours = hours % 12;
        if (hours === 0) {
            hours = 12;
        }
        return (d.getMonth() + 1) + "/" + d.getDate() + "/" + d.getFullYear() + " " +
            hours + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds()) + " " + suffix;
    }

    function formatClock(date) {
        var d = date || new Date();
        var hours = d.getHours();
        var suffix = hours >= 12 ? "PM" : "AM";
        hours = hours % 12;
        if (hours === 0) {
            hours = 12;
        }
        return (d.getMonth() + 1) + "/" + d.getDate() + "/" + d.getFullYear() + " " +
            hours + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds()) + " " + suffix;
    }

    //Turn a "*.txt;test?.*" style mask list into a single RegExp.
    //An empty mask list returns null, meaning "no filtering".
    function maskListToRegExp(maskList, caseSensitive) {
        if (!maskList) {
            return null;
        }
        var masks = String(maskList).split(/[;,\n]/);
        var parts = [];
        for (var i = 0; i < masks.length; i++) {
            var mask = masks[i].trim();
            if (mask === "") {
                continue;
            }
            var escaped = mask.replace(/[.+^${}()|[\]\\]/g, "\\$&")
                .replace(/\*/g, "[\\s\\S]*")
                .replace(/\?/g, "[\\s\\S]");
            parts.push("^" + escaped + "$");
        }
        if (parts.length === 0) {
            return null;
        }
        return new RegExp(parts.join("|"), caseSensitive ? "" : "i");
    }

    function unixNow() {
        return Math.floor(Date.now() / 1000);
    }

    function debounce(fn, delay) {
        var timer = null;
        return function () {
            var self = this;
            var args = arguments;
            if (timer) {
                clearTimeout(timer);
            }
            timer = setTimeout(function () {
                timer = null;
                fn.apply(self, args);
            }, delay);
        };
    }

    //Split a text blob into lines, remembering whether it ended with a newline
    function splitLines(text) {
        if (text === undefined || text === null) {
            return [];
        }
        var normalized = String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        return normalized.split("\n");
    }

    function joinLines(lines, lineEnding) {
        return lines.join(lineEnding || "\n");
    }

    //Guess the dominant line ending of a text blob so writing it back does
    //not silently convert the whole file
    function detectLineEnding(text) {
        if (!text) {
            return "\n";
        }
        var crlf = (text.match(/\r\n/g) || []).length;
        var lf = (text.match(/\n/g) || []).length - crlf;
        return crlf > lf ? "\r\n" : "\n";
    }

    var TEXT_EXT = [
        ".txt", ".md", ".markdown", ".log", ".ini", ".cfg", ".conf", ".json", ".xml",
        ".yaml", ".yml", ".toml", ".csv", ".tsv", ".html", ".htm", ".css", ".scss",
        ".less", ".js", ".mjs", ".ts", ".jsx", ".tsx", ".go", ".c", ".h", ".cpp",
        ".hpp", ".cc", ".cs", ".java", ".kt", ".py", ".rb", ".php", ".pl", ".lua",
        ".sh", ".bat", ".ps1", ".sql", ".agi", ".env", ".gitignore", ".rs", ".swift",
        ".vue", ".svelte", ".r", ".m", ".asm", ".patch", ".diff", ".properties"
    ];

    var IMAGE_EXT = [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".ico", ".svg"];

    function isTextFile(filename) {
        var ext = extName(filename);
        if (ext === "") {
            return true;
        }
        return TEXT_EXT.indexOf(ext) >= 0;
    }

    function isImageFile(filename) {
        return IMAGE_EXT.indexOf(extName(filename)) >= 0;
    }

    return {
        escapeHtml: escapeHtml,
        trimSlash: trimSlash,
        joinPath: joinPath,
        baseName: baseName,
        dirName: dirName,
        extName: extName,
        formatSize: formatSize,
        formatSizeShort: formatSizeShort,
        formatTime: formatTime,
        formatClock: formatClock,
        maskListToRegExp: maskListToRegExp,
        unixNow: unixNow,
        debounce: debounce,
        splitLines: splitLines,
        joinLines: joinLines,
        detectLineEnding: detectLineEnding,
        isTextFile: isTextFile,
        isImageFile: isImageFile
    };
})();
