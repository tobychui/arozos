/*
    Gerber Viewer - persistence

    Settings and recent projects live in the ArozOS database through
    backend/prefs.agi. When the page runs outside ArozOS (no AGI gateway) the
    same data falls back to localStorage. Projects opened from the local
    device are cached in IndexedDB so they can be reopened from Recents in
    the same browser.
*/
(function (GV) {
    'use strict';

    var BACKEND = 'Gerber Viewer/backend/';
    var LS_SETTINGS = 'gerberviewer.settings';
    var LS_RECENT = 'gerberviewer.recent';
    var MAX_LOCAL_RECENT = 16;

    var store = {
        online: false,          //AGI gateway reachable
        recent: []
    };

    function agiURL(script) {
        var root = typeof ao_root === 'string' ? ao_root : '../';
        return root + 'system/ajgi/interface?script=' + encodeURIComponent(BACKEND + script);
    }

    function T(key, fallback, vars) {
        return GV.ui.t(key, fallback, vars);
    }

    //Backend errors carry a code; error/<code> in the locale file translates them
    function parse(data) {
        if (typeof data === 'string') {
            try {
                data = JSON.parse(data);
            } catch (e) {
                throw new Error(T('error/reply', 'Unexpected reply from the server'));
            }
        }
        if (data && data.error) {
            var err = new Error(data.code ? T('error/' + data.code, data.error) : data.error);
            err.code = data.code || '';
            throw err;
        }
        return data;
    }

    //url-encoded POST through the standard gateway
    store.agi = function (script, data, timeout) {
        return new Promise(function (resolve, reject) {
            $.ajax({
                url: agiURL(script),
                method: 'POST',
                data: data || {},
                timeout: timeout || 0,
                success: function (d) {
                    try {
                        resolve(parse(d));
                    } catch (e) {
                        reject(e);
                    }
                },
                error: function (xhr) {
                    reject(new Error(xhr && xhr.status ? T('error/server', 'Server error {status}', { status: xhr.status }) : T('error/offline', 'Unable to reach ArozOS')));
                }
            });
        });
    };

    //JSON body POST, used for large payloads (exported images)
    store.agiJSON = function (script, data) {
        return fetch(agiURL(script), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
            credentials: 'same-origin'
        }).then(function (r) {
            if (!r.ok) {
                throw new Error(T('error/server', 'Server error {status}', { status: r.status }));
            }
            return r.text();
        }).then(parse);
    };

    function lsGet(k, def) {
        try {
            var v = localStorage.getItem(k);
            return v ? JSON.parse(v) : def;
        } catch (e) {
            return def;
        }
    }

    function lsSet(k, v) {
        try {
            localStorage.setItem(k, JSON.stringify(v));
        } catch (e) {
            //Storage full or blocked: settings simply do not persist
        }
    }

    store.boot = function () {
        return store.agi('prefs.agi', { opr: 'boot' }, 8000).then(function (d) {
            store.online = true;
            store.recent = Array.isArray(d.recent) ? d.recent : [];
            return { settings: d.settings || {}, recent: store.recent };
        }, function () {
            store.online = false;
            store.recent = lsGet(LS_RECENT, []);
            return { settings: lsGet(LS_SETTINGS, {}), recent: store.recent };
        });
    };

    store.saveSettings = function (s) {
        if (store.online) {
            return store.agi('prefs.agi', { opr: 'saveSettings', settings: JSON.stringify(s) }).catch(function () {
                lsSet(LS_SETTINGS, s);
            });
        }
        lsSet(LS_SETTINGS, s);
        return Promise.resolve();
    };

    function localRecentWrite(list) {
        store.recent = list.slice(0, MAX_LOCAL_RECENT);
        lsSet(LS_RECENT, store.recent);
        return store.recent;
    }

    store.recentAdd = function (entry) {
        if (store.online) {
            return store.agi('prefs.agi', { opr: 'recentAdd', entry: JSON.stringify(entry) }).then(function (d) {
                store.recent = d.recent || store.recent;
                return store.recent;
            });
        }
        var old = store.recent.filter(function (e) { return e.key === entry.key; })[0];
        if (old) {
            entry.state = entry.state || old.state;
            entry.thumb = entry.thumb || old.thumb;
        }
        var list = store.recent.filter(function (e) { return e.key !== entry.key; });
        list.unshift(entry);
        return Promise.resolve(localRecentWrite(list));
    };

    store.recentUpdate = function (key, patch) {
        store.recent.forEach(function (e) {
            if (e.key === key) {
                Object.assign(e, patch);
            }
        });
        if (store.online) {
            return store.agi('prefs.agi', { opr: 'recentUpdate', key: key, patch: JSON.stringify(patch) }).catch(function () { });
        }
        localRecentWrite(store.recent);
        return Promise.resolve();
    };

    store.recentRemove = function (key) {
        var entry = store.recent.filter(function (e) { return e.key === key; })[0];
        if (entry && entry.cacheId) {
            store.cacheDelete(entry.cacheId);
        }
        if (store.online) {
            return store.agi('prefs.agi', { opr: 'recentRemove', key: key }).then(function (d) {
                store.recent = d.recent || [];
                return store.recent;
            });
        }
        return Promise.resolve(localRecentWrite(store.recent.filter(function (e) { return e.key !== key; })));
    };

    store.recentClear = function () {
        store.recent.forEach(function (e) {
            if (e.cacheId) {
                store.cacheDelete(e.cacheId);
            }
        });
        if (store.online) {
            return store.agi('prefs.agi', { opr: 'recentClear' }).then(function () {
                store.recent = [];
                return [];
            });
        }
        return Promise.resolve(localRecentWrite([]));
    };

    /* ---------------- IndexedDB cache for local projects ---------------- */
    var dbp = null;
    function db() {
        if (!dbp) {
            dbp = new Promise(function (resolve, reject) {
                if (!window.indexedDB) {
                    reject(new Error('IndexedDB unavailable'));
                    return;
                }
                var req = indexedDB.open('gerberviewer', 1);
                req.onupgradeneeded = function () {
                    req.result.createObjectStore('projects');
                };
                req.onsuccess = function () { resolve(req.result); };
                req.onerror = function () { reject(req.error); };
            });
        }
        return dbp;
    }

    function tx(mode, fn) {
        return db().then(function (d) {
            return new Promise(function (resolve, reject) {
                var t = d.transaction('projects', mode);
                var r = fn(t.objectStore('projects'));
                t.oncomplete = function () { resolve(r && r.result); };
                t.onerror = function () { reject(t.error); };
                t.onabort = function () { reject(t.error); };
            });
        });
    }

    store.cachePut = function (id, data) {
        return tx('readwrite', function (s) { return s.put(data, id); }).catch(function () { });
    };

    store.cacheGet = function (id) {
        return tx('readonly', function (s) { return s.get(id); }).catch(function () { return null; });
    };

    store.cacheDelete = function (id) {
        return tx('readwrite', function (s) { return s.delete(id); }).catch(function () { });
    };

    //Drop cached projects no recent entry points at any more
    store.cachePrune = function () {
        var keep = new Set(store.recent.map(function (e) { return e.cacheId; }).filter(Boolean));
        return tx('readonly', function (s) { return s.getAllKeys(); }).then(function (keys) {
            (keys || []).forEach(function (k) {
                if (!keep.has(k)) {
                    store.cacheDelete(k);
                }
            });
        }).catch(function () { });
    };

    GV.store = store;
})(window.GV = window.GV || {});
