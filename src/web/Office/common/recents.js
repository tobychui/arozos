/*
    OfficeRecents - recently opened documents, kept in this browser
    ==============================================================

    The standalone web edition has nowhere to put a "recent files" list: a
    file the visitor picked is a File object that dies with the page, and its
    path (`local:/report.doca`) means nothing after a reload. So a recent
    document here is not a pointer to a file - it is a *copy of the document*
    held in the browser.

    Two stores, on purpose:

      - the **index** lives in localStorage. It is small (a few hundred bytes
        per entry) and, crucially, synchronous: the File > Open recent menu
        and the home page's first paint both need the list immediately, and
        IndexedDB cannot answer synchronously.
      - the **payloads** live in IndexedDB, one record per document. They are
        whole .doca/.xlsa/.ppta containers, far past what localStorage's ~5 MB
        per origin could hold.

    They are kept in step by remember()/forget()/clear(); a payload whose
    index entry is gone is swept on the next open. If IndexedDB is
    unavailable (private mode, an old browser, storage denied) everything
    degrades to "no recent documents" rather than failing.

        OfficeRecents.supported()                 // is there anywhere to store?
        OfficeRecents.index()                     // [{id,name,app,ext,size,at}] newest first (sync)
        OfficeRecents.remember({name, app, ext, bytes}, cb(id), errcb)
        OfficeRecents.load(id, cb(Uint8Array), errcb)
        OfficeRecents.forget(id, cb)
        OfficeRecents.clear(cb)
        OfficeRecents.estimateBytes()             // total size of the index

    Nothing here talks to a server, and nothing leaves the device.
*/
var OfficeRecents = (function () {
    "use strict";

    var DB_NAME = "arozosOffice";
    var DB_VERSION = 1;
    var STORE = "recents";
    var INDEX_KEY = "officeRecentIndex";

    // Caps, so a few big decks cannot fill the origin's quota. Both are
    // enforced on every write, oldest first.
    var MAX_ENTRIES = 24;
    var MAX_TOTAL_BYTES = 48 * 1024 * 1024;
    // a single document past this is opened but not remembered - keeping it
    // would evict everything else for one file
    var MAX_ENTRY_BYTES = 24 * 1024 * 1024;

    function hasIDB() {
        try { return !!window.indexedDB; } catch (e) { return false; }
    }
    function supported() { return hasIDB(); }

    /* ---------- the index (localStorage, synchronous) ---------- */
    function readIndex() {
        var raw = null;
        try { raw = localStorage.getItem(INDEX_KEY); } catch (e) { return []; }
        if (!raw) return [];
        var list;
        try { list = JSON.parse(raw); } catch (e) { return []; }
        if (Object.prototype.toString.call(list) !== "[object Array]") return [];
        return list.filter(function (e) { return e && e.id && e.name; });
    }
    function writeIndex(list) {
        try { localStorage.setItem(INDEX_KEY, JSON.stringify(list)); } catch (e) { }
    }
    function index() {
        return readIndex().sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
    }
    function estimateBytes() {
        return readIndex().reduce(function (n, e) { return n + (e.size || 0); }, 0);
    }

    /* ---------- payloads (IndexedDB) ---------- */
    function openDB(cb, errcb) {
        if (!hasIDB()) { errcb("this browser cannot store documents locally"); return; }
        var req;
        try { req = indexedDB.open(DB_NAME, DB_VERSION); }
        catch (e) { errcb("could not open local storage"); return; }
        req.onupgradeneeded = function () {
            var db = req.result;
            if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
        };
        req.onsuccess = function () { cb(req.result); };
        req.onerror = function () { errcb("could not open local storage"); };
        // Firefox in private mode resolves neither: do not hang the caller
        req.onblocked = function () { errcb("local storage is busy in another tab"); };
    }
    function withStore(mode, fn, errcb) {
        openDB(function (db) {
            var tx;
            try { tx = db.transaction(STORE, mode); }
            catch (e) { errcb("could not open local storage"); return; }
            tx.onerror = function () { errcb("local storage write failed"); };
            fn(tx.objectStore(STORE), db);
        }, errcb);
    }

    function genId() {
        return Date.now().toString(36) + "-" + Math.random().toString(36).substring(2, 8);
    }

    /*
        Store (or replace) a document. Documents are keyed by name + app, so
        saving the same file repeatedly updates one entry instead of piling
        up near-identical copies - which is what a person means by "recent".
    */
    function remember(opts, cb, errcb) {
        cb = cb || function () { };
        errcb = errcb || function () { };
        var bytes = opts.bytes;
        if (!bytes || !bytes.length) { errcb("nothing to remember"); return; }
        if (bytes.length > MAX_ENTRY_BYTES) {
            errcb("document is too large to keep in recent files");
            return;
        }

        var list = readIndex();
        var existing = null;
        for (var i = 0; i < list.length; i++) {
            if (list[i].name === opts.name && list[i].app === opts.app) { existing = list[i]; break; }
        }
        var id = existing ? existing.id : genId();
        var entry = {
            id: id,
            name: opts.name,
            app: opts.app,
            ext: opts.ext || "",
            size: bytes.length,
            at: new Date().getTime()
        };
        list = list.filter(function (e) { return e.id !== id; });
        list.unshift(entry);

        // enforce the caps, oldest first
        var evicted = [];
        var total = 0, kept = [];
        for (var j = 0; j < list.length; j++) {
            total += list[j].size || 0;
            if (kept.length >= MAX_ENTRIES || total > MAX_TOTAL_BYTES) evicted.push(list[j]);
            else kept.push(list[j]);
        }

        withStore("readwrite", function (store) {
            // copy: the caller may reuse its buffer, and a subarray view
            // would keep the whole parent buffer alive in the database
            var copy = new Uint8Array(bytes.length);
            copy.set(bytes);
            var put = store.put({ id: id, bytes: copy.buffer });
            put.onerror = function () { errcb("could not store the document"); };
            put.onsuccess = function () {
                evicted.forEach(function (e) { store.delete(e.id); });
                writeIndex(kept);
                cb(id);
            };
        }, errcb);
    }

    function load(id, cb, errcb) {
        errcb = errcb || function () { };
        withStore("readonly", function (store) {
            var get = store.get(id);
            get.onerror = function () { errcb("could not read the document"); };
            get.onsuccess = function () {
                var rec = get.result;
                if (!rec || !rec.bytes) { errcb("that document is no longer stored here"); return; }
                cb(new Uint8Array(rec.bytes));
            };
        }, errcb);
    }

    function forget(id, cb) {
        cb = cb || function () { };
        writeIndex(readIndex().filter(function (e) { return e.id !== id; }));
        withStore("readwrite", function (store) {
            store.delete(id);
            cb();
        }, function () { cb(); });   // the index is what the UI reads: never block on the payload
    }

    function clear(cb) {
        cb = cb || function () { };
        writeIndex([]);
        withStore("readwrite", function (store) {
            store.clear();
            cb();
        }, function () { cb(); });
    }

    /* Touch an entry's timestamp without rewriting its payload - used when a
       document is merely reopened, so "recently opened" means what it says. */
    function touch(id) {
        var list = readIndex();
        for (var i = 0; i < list.length; i++) {
            if (list[i].id === id) {
                list[i].at = new Date().getTime();
                writeIndex(list);
                return;
            }
        }
    }

    return {
        supported: supported,
        index: index,
        estimateBytes: estimateBytes,
        remember: remember,
        load: load,
        forget: forget,
        touch: touch,
        clear: clear,
        limits: function () {
            return { maxEntries: MAX_ENTRIES, maxTotalBytes: MAX_TOTAL_BYTES, maxEntryBytes: MAX_ENTRY_BYTES };
        }
    };
})();
