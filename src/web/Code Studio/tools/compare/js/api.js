/*
    api.js - server side calls used by the Compare tool

    Everything goes through the user scoped AGI backend
    (Code Studio/backend/compare.agi) except for binary safe file copies and
    deletes, which use the ArozOS file system HTTP API so that large files are
    streamed server side instead of being pulled through the JavaScript VM.
*/

var CmpAPI = (function () {

    var AGI_SCRIPT = "Code Studio/backend/compare.agi";
    var ROOT = "../../../";

    function postForm(url, params) {
        var body = new URLSearchParams();
        for (var key in params) {
            if (Object.prototype.hasOwnProperty.call(params, key) && params[key] !== undefined) {
                body.append(key, params[key]);
            }
        }
        return fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
            body: body.toString()
        }).then(function (resp) {
            return resp.text();
        });
    }

    function agi(params) {
        return postForm(ROOT + "system/ajgi/interface?script=" + encodeURIComponent(AGI_SCRIPT), params)
            .then(function (text) {
                var parsed;
                try {
                    parsed = JSON.parse(text);
                } catch (e) {
                    throw new Error("Malformed backend reply: " + text.substring(0, 180));
                }
                if (parsed && parsed.error !== undefined) {
                    throw new Error(parsed.error);
                }
                return parsed;
            });
    }

    function csrfToken() {
        return fetch(ROOT + "system/csrf/new").then(function (r) {
            return r.text();
        });
    }

    /* ------------------------- AGI backed calls ------------------------- */

    function scan(vpath, recursive, maxDepth) {
        return agi({
            opr: "scan",
            path: vpath,
            recursive: recursive === false ? "false" : "true",
            maxdepth: maxDepth || 0
        });
    }

    function stat(vpath) {
        return agi({ opr: "stat", path: vpath });
    }

    //Hash a list of virtual paths. The list is chunked so that a big folder
    //compare does not build one enormous request.
    function hashAll(vpaths, chunkSize, onProgress) {
        var size = chunkSize || 60;
        var results = {};
        var chunks = [];
        for (var i = 0; i < vpaths.length; i += size) {
            chunks.push(vpaths.slice(i, i + size));
        }

        var done = 0;
        return chunks.reduce(function (chain, chunk) {
            return chain.then(function () {
                return agi({ opr: "hash", paths: JSON.stringify(chunk) }).then(function (reply) {
                    for (var key in reply.hashes) {
                        if (Object.prototype.hasOwnProperty.call(reply.hashes, key)) {
                            results[key] = reply.hashes[key];
                        }
                    }
                    done += chunk.length;
                    if (onProgress) {
                        onProgress(done, vpaths.length);
                    }
                });
            });
        }, Promise.resolve()).then(function () {
            return results;
        });
    }

    function readText(vpath) {
        return agi({ opr: "read", path: vpath });
    }

    function writeText(vpath, content) {
        return agi({ opr: "write", path: vpath, content: content });
    }

    function mkdirp(vpath) {
        return agi({ opr: "mkdirp", path: vpath });
    }

    function removePaths(vpaths) {
        return agi({ opr: "remove", paths: JSON.stringify(vpaths) });
    }

    /* --------------------- File system HTTP API calls -------------------- */

    //Copy srcVpath into the destination folder. The destination folder must
    //already exist; use mkdirp first for a fresh subtree.
    function copyInto(srcVpath, destFolderVpath, overwrite) {
        //The file system API expects the destination folder with a trailing
        //slash, the same way the file manager sends it
        var destFolder = CmpUtil.trimSlash(destFolderVpath);
        if (destFolder.charAt(destFolder.length - 1) !== "/") {
            destFolder += "/";
        }

        return csrfToken().then(function (token) {
            return postForm(ROOT + "system/file_system/fileOpr", {
                opr: "copy",
                src: JSON.stringify([srcVpath]),
                dest: destFolder,
                existsresp: overwrite ? "overwrite" : "skip",
                csrft: token
            });
        }).then(function (text) {
            var parsed = null;
            try {
                parsed = JSON.parse(text);
            } catch (e) {
                //A plain "OK" body is a success reply
                return true;
            }
            if (parsed && parsed.error !== undefined) {
                throw new Error(parsed.error);
            }
            return true;
        });
    }

    //Send files to the recycle bin instead of deleting them outright
    function recycle(vpaths) {
        return csrfToken().then(function (token) {
            return postForm(ROOT + "system/file_system/fileOpr", {
                opr: "recycle",
                src: JSON.stringify(vpaths),
                csrft: token
            });
        }).then(function (text) {
            var parsed = null;
            try {
                parsed = JSON.parse(text);
            } catch (e) {
                return true;
            }
            if (parsed && parsed.error !== undefined) {
                throw new Error(parsed.error);
            }
            return true;
        });
    }

    function rename(vpath, newName) {
        return csrfToken().then(function (token) {
            return postForm(ROOT + "system/file_system/fileOpr", {
                opr: "rename",
                src: JSON.stringify([vpath]),
                new: JSON.stringify([newName]),
                csrft: token
            });
        }).then(function (text) {
            var parsed = null;
            try {
                parsed = JSON.parse(text);
            } catch (e) {
                return true;
            }
            if (parsed && parsed.error !== undefined) {
                throw new Error(parsed.error);
            }
            return true;
        });
    }

    //Raw media endpoint, used by the hex and picture comparers
    function mediaURL(vpath) {
        return ROOT + "media/?file=" + encodeURIComponent(vpath);
    }

    function readBytes(vpath) {
        return fetch(mediaURL(vpath)).then(function (resp) {
            if (!resp.ok) {
                throw new Error("Unable to read " + vpath + " (HTTP " + resp.status + ")");
            }
            return resp.arrayBuffer();
        });
    }

    return {
        scan: scan,
        stat: stat,
        hashAll: hashAll,
        readText: readText,
        writeText: writeText,
        mkdirp: mkdirp,
        removePaths: removePaths,
        copyInto: copyInto,
        recycle: recycle,
        rename: rename,
        mediaURL: mediaURL,
        readBytes: readBytes
    };
})();
