/*
    api.js

    Every request Drive makes goes through here. Two transports:

      rest  the existing system endpoints (/system/file_system/*, share,
            media, modules, users, notification ...). The file system and
            share endpoints are gated by the "File Manager" module
            permission, so they are only used when the user has it.
      agi   Drive/backend/*.agi, reachable by every user who can open
            Drive (an interface module always grants access to its own
            folder). fs.agi mirrors the file operations in a reduced form
            for users without File Manager.

    Every call returns a Promise. Server side {error: "..."} replies and
    HTTP failures reject with an Error whose message is shown to the user.
*/

(function (global) {
    "use strict";

    //Empty: the document base (index.html) is the web root
    var ROOT = "";
    var caps = {
        fm: true,          //File Manager REST endpoints usable
        settings: false    //System Setting module accessible
    };

    function sessionLost() {
        window.location.href = ROOT + "login.html?redirect=" + encodeURIComponent(window.location.pathname);
    }

    function errorOf(xhr, fallback) {
        if (xhr && xhr.status == 401) {
            return new Error("Session expired");
        }
        if (xhr && xhr.responseText) {
            try {
                var parsed = JSON.parse(xhr.responseText);
                if (parsed && parsed.error) {
                    return new Error(parsed.error);
                }
            } catch (e) { }
            if (xhr.responseText.length < 200 && xhr.responseText.indexOf("<") < 0) {
                return new Error(xhr.responseText.trim());
            }
        }
        if (xhr && xhr.status == 0) {
            return new Error(T("err/network", "Cannot reach the server"));
        }
        return new Error(fallback || ("HTTP " + (xhr ? xhr.status : "?")));
    }

    /*
        request({url, method, data, json, timeout}) -> Promise
        json=false returns the raw text.
    */
    function request(opts) {
        return new Promise(function (resolve, reject) {
            $.ajax({
                url: opts.absolute ? opts.url : ROOT + opts.url,
                method: opts.method || "GET",
                data: opts.data || {},
                dataType: opts.json === false ? "text" : "json",
                timeout: opts.timeout || 0,
                cache: false,
                success: function (resp, status, xhr) {
                    if (opts.json !== false && resp && typeof resp === "object" && !Array.isArray(resp) && resp.error !== undefined) {
                        reject(new Error(String(resp.error)));
                        return;
                    }
                    resolve(resp);
                },
                error: function (xhr, status) {
                    var text = xhr.responseText || "";
                    if (status == "parsererror" && /<html|<!doctype/i.test(text) && /login/i.test(text)) {
                        //The session ended: the server answered with the login page
                        sessionLost();
                    }
                    if (xhr.status == 401 && opts.url.indexOf("csrf") < 0) {
                        reject(errorOf(xhr));
                        return;
                    }
                    reject(errorOf(xhr));
                }
            });
        });
    }

    function get(url, data) {
        return request({ url: url, data: data });
    }

    function post(url, data) {
        return request({ url: url, method: "POST", data: data });
    }

    function agi(script, data) {
        return request({
            url: "system/ajgi/interface?script=" + encodeURIComponent("Drive/backend/" + script),
            method: "POST",
            data: data || {}
        });
    }

    function csrf() {
        return request({ url: "system/csrf/new" });
    }

    function withToken(url, data) {
        return csrf().then(function (token) {
            data = data || {};
            data.csrft = token;
            return post(url, data);
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Item normalisation                                                 */
    /* ------------------------------------------------------------------ */
    function fromFileData(f) {
        return {
            name: f.Filename,
            path: f.Filepath,
            isDir: !!f.IsDir,
            size: f.IsDir ? -1 : (f.Filesize || 0),
            mtime: f.ModTime || f.Modtime || 0,
            shared: !!f.IsShared,
            shortcut: f.Shortcut || null
        };
    }

    function joinPath(dir, name) {
        if (dir.substring(dir.length - 1) != "/") {
            dir += "/";
        }
        return dir + name;
    }

    function parentOf(path) {
        var clean = String(path).replace(/\/+$/, "");
        var at = clean.lastIndexOf("/");
        if (at < 0) {
            return clean + "/";
        }
        return clean.substring(0, at + 1);
    }

    function baseName(path) {
        var clean = String(path).replace(/\/+$/, "");
        var at = clean.lastIndexOf("/");
        return at < 0 ? clean : clean.substring(at + 1);
    }

    /* ------------------------------------------------------------------ */
    /*  Session, user and system                                           */
    /* ------------------------------------------------------------------ */
    var API = {
        caps: caps,
        ROOT: ROOT,
        joinPath: joinPath,
        parentOf: parentOf,
        baseName: baseName,
        request: request,
        agi: agi,

        boot: function () {
            return agi("prefs.agi", { opr: "boot" });
        },
        userInfo: function () {
            return get("system/users/userinfo");
        },
        modules: function () {
            return get("system/modules/list");
        },
        interfaces: function () {
            return get("system/users/interfaceinfo");
        },
        hostInfo: function () {
            return get("system/info/getArOZInfo");
        },
        quota: function () {
            return get("system/disk/quota/quotaInfo");
        },
        notifications: function () {
            return get("system/notification/desktop/list");
        },
        logout: function () {
            return request({ url: "system/auth/logout", json: false });
        },
        profilePicURL: function (username) {
            return ROOT + "system/users/profilepic?user=" + encodeURIComponent(username);
        },

        /* -------------------------------------------------------------- */
        /*  Preferences (always AGI)                                       */
        /* -------------------------------------------------------------- */
        saveSettings: function (settings) {
            return agi("prefs.agi", { opr: "save", settings: JSON.stringify(settings) });
        },
        star: function (paths, on) {
            return agi("prefs.agi", { opr: "star", paths: JSON.stringify(paths), on: on ? "true" : "false" });
        },
        starred: function () {
            return agi("prefs.agi", { opr: "starred" });
        },
        recentAdd: function (path) {
            if (global.Drive && Drive.state.recentOpened) {
                Drive.state.recentOpened[path] = Math.floor(Date.now() / 1000);
            }
            return agi("prefs.agi", { opr: "recentAdd", path: path }).catch(function () { });
        },
        recentOpened: function () {
            return agi("prefs.agi", { opr: "recent" });
        },
        recentClear: function () {
            return agi("prefs.agi", { opr: "recentClear" });
        },
        scan: function (opts) {
            return agi("scan.agi", opts);
        },

        /* -------------------------------------------------------------- */
        /*  Listing                                                        */
        /* -------------------------------------------------------------- */
        list: function (dir, showHidden) {
            if (!caps.fm) {
                return agi("fs.agi", { opr: "list", dir: dir });
            }
            return post("system/file_system/listDir", {
                dir: dir, sort: "default", showHidden: showHidden ? "true" : "false"
            }).then(function (data) {
                return (data || []).map(fromFileData);
            });
        },

        search: function (root, keyword) {
            if (!caps.fm) {
                return agi("fs.agi", { opr: "search", path: root, keyword: keyword });
            }
            return post("system/file_system/search", { path: root, keyword: keyword, casesensitive: "false" })
                .then(function (data) {
                    return (data || []).map(fromFileData);
                });
        },

        props: function (path) {
            if (!caps.fm) {
                return agi("fs.agi", { opr: "props", path: path }).then(function (p) {
                    return {
                        VirtualPath: p.path, Basename: p.name, VirtualDirname: parentOf(p.path),
                        Filesize: p.size, LastModUnix: p.mtime, CreationUnix: 0, IsDirectory: p.isDir,
                        Owner: "", MimeType: "", Permission: "", FileCount: p.fileCount
                    };
                });
            }
            return post("system/file_system/getProperties", { path: path });
        },

        templates: function () {
            if (!caps.fm) {
                return Promise.resolve([{ Desc: "Text Document", Ext: "txt" }]);
            }
            return withToken("system/file_system/newItem", {}).then(function (list) {
                return list || [];
            });
        },

        /* -------------------------------------------------------------- */
        /*  Creating, renaming and deleting                                */
        /* -------------------------------------------------------------- */
        mkdir: function (dir, name) {
            if (!caps.fm) {
                return agi("fs.agi", { opr: "mkdir", dir: dir, name: name });
            }
            return withToken("system/file_system/newItem", { type: "folder", src: dir, filename: name });
        },

        newFile: function (dir, name) {
            if (!caps.fm) {
                return agi("fs.agi", { opr: "newfile", dir: dir, name: name });
            }
            return withToken("system/file_system/newItem", { type: "file", src: dir, filename: name });
        },

        rename: function (path, newName) {
            if (!caps.fm) {
                return agi("fs.agi", { opr: "rename", path: path, name: newName });
            }
            return withToken("system/file_system/fileOpr", {
                opr: "rename", src: JSON.stringify([path]), new: JSON.stringify([newName])
            });
        },

        //Move to the trash bin. Permanent in the reduced mode (no trash there)
        recycle: function (paths) {
            if (!caps.fm) {
                return agi("fs.agi", { opr: "delete", paths: JSON.stringify(paths) });
            }
            return withToken("system/file_system/fileOpr", { opr: "recycle", src: JSON.stringify(paths) });
        },

        remove: function (paths) {
            if (!caps.fm) {
                return agi("fs.agi", { opr: "delete", paths: JSON.stringify(paths) });
            }
            return withToken("system/file_system/fileOpr", { opr: "delete", src: JSON.stringify(paths) });
        },

        /* -------------------------------------------------------------- */
        /*  Background operations (move / copy / zip / unzip)              */
        /* -------------------------------------------------------------- */
        duplicates: function (paths, dest) {
            if (!caps.fm) {
                return Promise.resolve([]);
            }
            return post("system/file_system/validateFileOpr", { src: JSON.stringify(paths), dest: dest });
        },

        /*
            Resolves {oprid} for a background task, or {sync: true} when the
            reduced mode finished it in the request itself.
        */
        startOperation: function (opr, paths, dest, existsresp) {
            if (!caps.fm) {
                if (opr != "copy" && opr != "move") {
                    return Promise.reject(new Error(T("err/needFM", "This action needs the File Manager permission")));
                }
                return agi("fs.agi", {
                    opr: opr, paths: JSON.stringify(paths), dest: dest, existsresp: existsresp || "keep"
                }).then(function () {
                    return { sync: true };
                });
            }
            return withToken("system/file_system/fileOprAsync", {
                opr: opr, src: JSON.stringify(paths), dest: dest, existsresp: existsresp || "keep"
            });
        },

        ongoing: function () {
            return get("system/file_system/ongoing", { all: "true" });
        },

        controlOperation: function (oprid, flag) {
            return get("system/file_system/ongoing", { flag: flag, oprid: oprid });
        },

        zipForDownload: function (paths) {
            return post("system/file_system/zipHandler", { opr: "tmpzipAsync", src: JSON.stringify(paths), dest: "" });
        },

        /* -------------------------------------------------------------- */
        /*  Trash                                                          */
        /* -------------------------------------------------------------- */
        trashList: function () {
            return get("system/file_system/listTrash").then(function (list) {
                return (list || []).map(function (t) {
                    return {
                        name: t.OriginalFilename,
                        path: t.Filepath,
                        isDir: t.IsDir,
                        size: t.IsDir ? -1 : t.Filesize,
                        mtime: t.RemoveTimestamp,
                        origin: t.OriginalPath,
                        trashed: true
                    };
                });
            });
        },
        trashRestore: function (path) {
            return post("system/file_system/restoreTrash", { src: path });
        },
        trashClear: function () {
            return post("system/file_system/clearTrash", {});
        },

        /* -------------------------------------------------------------- */
        /*  Versions                                                       */
        /* -------------------------------------------------------------- */
        versions: function (path) {
            return post("system/file_system/versionHistory", { path: path });
        },
        versionOp: function (path, opr, histid) {
            var data = { path: path, opr: opr };
            if (histid) {
                data.histid = histid;
            }
            return post("system/file_system/versionHistory", data);
        },

        /* -------------------------------------------------------------- */
        /*  Share                                                          */
        /* -------------------------------------------------------------- */
        shareInfo: function (path) {
            if (!caps.fm) {
                return agi("fs.agi", { opr: "shareinfo", path: path }).then(function (r) {
                    return {
                        Path: path, IsShared: r.shared, CanManage: true, reduced: true,
                        Shares: r.shared ? [{
                            UUID: r.uuid, Permission: "anyone", Accessibles: [], AccessLevel: "view",
                            AllowDownload: true, ShowFileList: true, HasPassword: false, ExpireAt: 0, IsExpired: false
                        }] : []
                    };
                });
            }
            return get("system/file_system/share/info", { path: path });
        },
        shareCreate: function (path, settings) {
            if (!caps.fm) {
                return agi("fs.agi", { opr: "share", path: path });
            }
            var data = $.extend({ path: path }, settings || {});
            return post("system/file_system/share/create", data);
        },
        shareUpdate: function (uuid, settings) {
            var data = $.extend({ uuid: uuid }, settings || {});
            return post("system/file_system/share/update", data);
        },
        shareDelete: function (uuid, path) {
            if (!caps.fm) {
                return agi("fs.agi", { opr: "unshare", path: path });
            }
            return post("system/file_system/share/delete", { uuid: uuid });
        },
        shareRecipients: function () {
            return get("system/file_system/share/recipients");
        },
        shareList: function () {
            return get("system/file_system/share/list");
        },
        shareURL: function (uuid) {
            return window.location.origin + "/share/" + uuid;
        },

        /* -------------------------------------------------------------- */
        /*  Files as URLs                                                  */
        /* -------------------------------------------------------------- */
        mediaURL: function (path) {
            return ROOT + "media/?file=" + encodeURIComponent(path);
        },
        downloadURL: function (path) {
            return ROOT + "media/download/?file=" + encodeURIComponent(path);
        },
        thumbURL: function (path) {
            return ROOT + "system/file_system/loadThumbnail?bytes=true&vpath=" + encodeURIComponent(path);
        },
        thumbFallback: function (path) {
            return agi("fs.agi", { opr: "thumb", path: path }).then(function (r) {
                return r && r.data ? r.data : "";
            });
        },
        readText: function (path) {
            return request({ url: "media/?file=" + encodeURIComponent(path), json: false });
        },

        /* -------------------------------------------------------------- */
        /*  Openers                                                        */
        /* -------------------------------------------------------------- */
        defaultOpener: function (ext) {
            return get("system/modules/getDefault", { opr: "launch", ext: ext }).catch(function () {
                return null;
            });
        },
        setDefaultOpener: function (ext, moduleName) {
            return get("system/modules/getDefault", { opr: "set", ext: ext, module: moduleName });
        },
        launchInfo: function (moduleName) {
            return get("system/modules/getLaunchPara", { module: moduleName });
        }
    };

    global.DriveAPI = API;
})(window);
