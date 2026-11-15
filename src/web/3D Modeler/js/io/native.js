/*
    3D Modeler - the bridge to a native desktop shell
    =================================================

    A native desktop shell (a Cocoa window around a WKWebView that serves
    this app from 127.0.0.1) runs the modeller as a Mac application,
    with no ArozOS behind it. It announces itself by defining
    window.MODELER_NATIVE before any page script runs:

        { platform: "macos", version: "1.0.0",
          token: "<per-launch secret>", home: "/Users/name" }

    and answers on the page's own origin under /__native/. Every request
    carries the token (X-Modeler-Token); the shell refuses anything else, so
    another page or program on the machine cannot drive it.

    Files on the Mac are named by a root, like ArozOS paths, followed by
    their absolute path: "local:/Users/name/Desktop/Bracket.aopart". That
    keeps paths.js working unchanged: an assembly saved on the Mac links
    its parts relative to itself ("parts/Bracket.aopart"), so a project
    folder moves between ArozOS and the Mac as a whole.

    What the page may touch is decided by the shell, not by this file:
      - the app's own documents (.aopart, .aoasm, .aodrw) can be read
        anywhere and overwritten where they already exist, because
        assemblies and drawings reach their parts through those links
      - any other file (a STEP file to import, a picture, an export) only
        once the person picked it in an Open or Save dialog, opened it from
        Finder or dropped it on the window
      - a new file is only created where the person said, in a Save dialog
    A write the shell refuses fails with code "nogrant"; files.js then asks
    where to save instead.

    Endpoints (JSON in and out unless noted; errors are {error, code} with a
    non-2xx status):

      POST pick-open   {exts:[".aopart"], purpose}       -> {files:[{path,name}]}
      POST pick-save   {name, ext, near, purpose}        -> {path,name} | {cancelled:true}
      GET  file?path=<p>   -> the file's bytes
      PUT  file?path=<p>   <- the file's bytes, written atomically
      POST opened      -> {files:[{path,name}]}  files the person opened from
                          Finder, the Dock, Open Recent or a drop, waiting
                          for the page (each is handed out once)
      POST window      {action, ...} where action is
                         info    {edited, path, kind}: the close button's
                                 dot, the title bar's file, the menus that
                                 apply to the kind of document on show
                         close   the window, now (the page has agreed)
                         close-cancelled  the person kept the window
                         reveal  {path}: show the file in Finder

    `purpose` ("open", "part", "import", "export") lets each kind of dialog
    remember its own folder.

    The shell calls into the page through window.ModelerNative:

      requestClose()   the window's close button or Quit. true = close now;
                       false = the page is asking the person and answers
                       with close or close-cancelled
      menu(command)    an item of the menu bar ("file.save", "export.stl")
      opened()         files are waiting at POST opened

    Without a shell (ArozOS, a plain browser) available() is false and
    nothing here does anything.
*/

// (no window under Node, where tests/ import the modules that use this one)
const cfg = typeof window !== 'undefined' && window.MODELER_NATIVE || null;
const PREFIX = 'local:';
const BASE = '/__native/';

export function available() {
    return !!(cfg && typeof cfg.token === 'string' && cfg.token.length > 0 && typeof window.fetch === 'function');
}

// "local:/Users/name/x.aopart": a file on this Mac
export function isLocal(path) {
    return String(path || '').indexOf(PREFIX + '/') === 0;
}

// For the person to read: "~/Desktop/Bracket.aopart"
export function displayPath(path) {
    if (!isLocal(path)) {
        return path;
    }
    const p = String(path).slice(PREFIX.length);
    const home = cfg && typeof cfg.home === 'string' ? cfg.home.replace(/\/+$/, '') : '';
    if (home && (p === home || p.indexOf(home + '/') === 0)) {
        return '~' + p.slice(home.length);
    }
    return p;
}

/* ================= transport ================= */
function headers(extra) {
    const h = { 'X-Modeler-Token': cfg.token };
    Object.keys(extra || {}).forEach(function (k) {
        h[k] = extra[k];
    });
    return h;
}

function failure(res) {
    return res.text().then(function (text) {
        let msg = 'The app answered with error ' + res.status;
        let code = '';
        try {
            const o = JSON.parse(text);
            if (o && o.error) {
                msg = o.error;
                code = o.code || '';
            }
        } catch (e) {
            if (text) {
                msg = text;
            }
        }
        const err = new Error(msg);
        err.code = code;
        throw err;
    });
}

function noShell() {
    return Promise.reject(new Error('This window is not inside the desktop app'));
}

function call(endpoint, payload) {
    if (!available()) {
        return noShell();
    }
    return fetch(BASE + endpoint, {
        method: 'POST',
        headers: headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload || {}),
        cache: 'no-store'
    }).then(function (res) {
        return res.ok ? res.json() : failure(res);
    });
}

function fileUrl(path) {
    return BASE + 'file?path=' + encodeURIComponent(path);
}

// "aopart" and ".aopart" both appear in the app's filters
function normExts(list) {
    return (list || []).map(function (e) {
        e = String(e).toLowerCase();
        return e.charAt(0) === '.' ? e : '.' + e;
    });
}

/* ================= files ================= */
// -> Uint8Array
export function read(path) {
    if (!available()) {
        return noShell();
    }
    return fetch(fileUrl(path), { headers: headers(), cache: 'no-store' }).then(function (res) {
        return res.ok ? res.arrayBuffer() : failure(res);
    }).then(function (buffer) {
        return new Uint8Array(buffer);
    });
}

export function readText(path) {
    return read(path).then(function (bytes) {
        return new TextDecoder().decode(bytes);
    });
}

// data: a string (written as UTF-8) or a Uint8Array
export function write(path, data) {
    if (!available()) {
        return noShell();
    }
    return fetch(fileUrl(path), {
        method: 'PUT',
        headers: headers({ 'Content-Type': 'application/octet-stream' }),
        body: data,
        cache: 'no-store'
    }).then(function (res) {
        return res.ok ? res.json() : failure(res);
    });
}

// The system Open dialog -> [{ path, name }], empty when cancelled
export function pickOpen(options) {
    const o = options || {};
    return call('pick-open', { exts: normExts(o.exts), purpose: o.purpose || '' }).then(function (r) {
        return (r && r.files) || [];
    });
}

// The system Save dialog -> { path, name }, or null when cancelled. near:
// a local path whose folder the dialog starts in
export function pickSave(options) {
    const o = options || {};
    return call('pick-save', {
        name: o.name || '',
        ext: o.ext ? normExts([o.ext])[0] : '',
        near: isLocal(o.near) ? o.near : '',
        purpose: o.purpose || ''
    }).then(function (r) {
        return r && r.path ? r : null;
    });
}

// Files the person opened from Finder and the like -> [{ path, name }]
export function takeOpened() {
    return call('opened').then(function (r) {
        return (r && r.files) || [];
    });
}

/* ================= the window ================= */
function windowAction(action, extra) {
    const payload = extra || {};
    payload.action = action;
    return call('window', payload);
}

// Sent only when something changed: the page refreshes its chrome often
let lastInfo = '';
export function windowInfo(info) {
    if (!available()) {
        return;
    }
    const payload = {
        edited: !!info.edited,
        path: isLocal(info.path) ? info.path : '',
        kind: info.kind || ''
    };
    const key = JSON.stringify(payload);
    if (key === lastInfo) {
        return;
    }
    lastInfo = key;
    windowAction('info', payload).catch(function () {
        lastInfo = ''; // tried again with the next change
    });
}

export function closeWindow() {
    return windowAction('close');
}

export function closeCancelled() {
    return windowAction('close-cancelled');
}

export function reveal(path) {
    return windowAction('reveal', { path: path });
}

/* ================= the shell calling in ================= */
// app.js says what the window's commands do: { requestClose, menu, opened }
let handlers = {};

export function handle(h) {
    handlers = h || {};
}

if (available()) {
    window.ModelerNative = Object.freeze({
        requestClose: function () {
            return typeof handlers.requestClose === 'function' ? handlers.requestClose() : true;
        },
        menu: function (command) {
            if (typeof handlers.menu === 'function') {
                handlers.menu(String(command));
            }
        },
        opened: function () {
            // Before app.js is up nothing is lost: it takes them when it starts
            if (typeof handlers.opened === 'function') {
                handlers.opened();
            }
        }
    });
}
