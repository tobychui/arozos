/*
    PDF Tool — company chop / stamp library

    Chop PNGs live in the user's hidden app-data folder; only small metadata
    (id / name / path) goes into preference storage, which is capped at 1 MB and
    travels over a query string.
*/

(function (T) {
    'use strict';

    var DIR = 'user:/.appdata/PDF Tool/Chops/';
    var MOD = 'PDF Tool', KEY = 'chops';
    var LEGACY_MOD = 'Productivity'; // pre-rename storage key, migrated on first load

    /*
        The in-memory cache is the source of truth once loaded.
        ao_module_storage.setStorage() fires an async write and returns immediately
        without confirming completion, so reading the value straight back after a
        save() can race the write and return stale data.
    */
    var cache = null;
    var pending = [];
    var fetching = false;

    function parse(raw) {
        if (!raw) { return []; }
        try { return JSON.parse(raw) || []; } catch (e) { return []; }
    }

    function flush() {
        var queued = pending;
        pending = [];
        queued.forEach(function (fn) { fn(cache.slice()); });
    }

    function load(cb) {
        if (cache !== null) { cb(cache.slice()); return; }
        pending.push(cb);
        if (fetching) { return; }
        fetching = true;

        ao_module_storage.loadStorage(MOD, KEY, function (raw) {
            var arr = parse(raw);
            if (arr.length) {
                cache = arr;
                fetching = false;
                flush();
                return;
            }
            // Nothing under the new key — carry any chops saved before the rename forward.
            ao_module_storage.loadStorage(LEGACY_MOD, KEY, function (legacyRaw) {
                var legacy = parse(legacyRaw);
                cache = legacy;
                fetching = false;
                if (legacy.length) {
                    ao_module_storage.setStorage(MOD, KEY, JSON.stringify(legacy));
                }
                flush();
            });
        });
    }

    function save(arr, cb) {
        cache = arr.slice();
        ao_module_storage.setStorage(MOD, KEY, JSON.stringify(cache));
        if (cb) { cb(cache.slice()); }
    }

    function add(srcPath, name, onDone, onErr) {
        fetch(T.mediaUrl(srcPath)).then(function (r) {
            if (!r.ok) { throw new Error('Cannot read source image'); }
            return r.blob();
        }).then(function (blob) {
            var fname = 'chop_' + Date.now() + '.png';
            ao_module_uploadFile(new File([blob], fname, { type: 'image/png' }), DIR, function () {
                load(function (arr) {
                    arr.push({ id: 'c' + Date.now(), name: name || 'Chop', path: DIR + fname });
                    save(arr, function () { if (onDone) { onDone(arr); } });
                });
            }, undefined, function (status) {
                if (onErr) { onErr('Upload failed (' + status + ')'); }
            });
        }).catch(function (e) {
            if (onErr) { onErr(e.message || String(e)); }
        });
    }

    function remove(id, onDone) {
        load(function (arr) {
            save(arr.filter(function (c) { return c.id !== id; }), onDone);
        });
    }

    function rename(id, name, onDone) {
        load(function (arr) {
            arr.forEach(function (c) { if (c.id === id) { c.name = name; } });
            save(arr, onDone);
        });
    }

    T.Chops = { DIR: DIR, load: load, save: save, add: add, remove: remove, rename: rename };

    /* ── Manager dialog ─────────────────────────────────────────────── */

    T.openChopManager = function (onChanged) {
        var dlg = T.modal({
            title: 'Chop Library',
            bodyHtml:
                '<p class="pt-hint">Load your company stamp as a transparent <strong>PNG</strong>. ' +
                'Saved chops can be placed on any page from the <strong>Stamp</strong> button.</p>' +
                '<button class="pt-btn primary" id="chopAdd">Add Chop (PNG)</button>' +
                '<div id="chopMsg"></div>' +
                '<div id="chopList" style="margin-top:14px"></div>',
            actions: [{ label: 'Done', primary: false, onClick: function (c) { c.close(); } }]
        });

        var listEl = dlg.body.querySelector('#chopList');
        var msgEl = dlg.body.querySelector('#chopMsg');

        function render() {
            T.Chops.load(function (chops) {
                if (!chops.length) {
                    listEl.innerHTML = '<div class="pt-empty-box">No chops yet. Add a transparent PNG of your company stamp to get started.</div>';
                    return;
                }
                var html = '<div class="chop-grid">';
                chops.forEach(function (c) {
                    html += '<div class="chop-card">' +
                        '<div class="chop-thumb"><img src="' + T.mediaUrl(c.path) + '" alt=""></div>' +
                        '<div class="chop-name">' + T.escHtml(c.name) + '</div>' +
                        '<div class="chop-card-btns">' +
                            '<button class="pt-btn tiny" data-rename="' + c.id + '">Rename</button>' +
                            '<button class="pt-iconbtn danger" data-remove="' + c.id + '" title="Remove">' + T.svg.x + '</button>' +
                        '</div>' +
                    '</div>';
                });
                listEl.innerHTML = html + '</div>';

                Array.prototype.forEach.call(listEl.querySelectorAll('[data-remove]'), function (btn) {
                    btn.addEventListener('click', function () {
                        T.Chops.remove(this.getAttribute('data-remove'), function () {
                            render();
                            if (onChanged) { onChanged(); }
                        });
                    });
                });
                Array.prototype.forEach.call(listEl.querySelectorAll('[data-rename]'), function (btn) {
                    btn.addEventListener('click', function () {
                        var id = this.getAttribute('data-rename');
                        var card = this.closest('.chop-card');
                        var current = card ? card.querySelector('.chop-name').textContent : '';
                        var name = prompt('Chop name', current);
                        if (name != null && name.trim() !== '') {
                            T.Chops.rename(id, name.trim(), function () {
                                render();
                                if (onChanged) { onChanged(); }
                            });
                        }
                    });
                });
            });
        }

        dlg.body.querySelector('#chopAdd').addEventListener('click', function () {
            ao_module_openFileSelector('_ptChopAddCb', 'user:/', 'file', false, { filter: ['png'] });
        });

        window._ptChopAddCb = function (files) {
            if (!files || !files.length) { return; }
            var f = files[0];
            if (!/\.png$/i.test(f.filename)) {
                msgEl.innerHTML = '<div class="result-box result-err">Please choose a <strong>PNG</strong> image (transparent background recommended).</div>';
                return;
            }
            msgEl.innerHTML = '<div class="pt-hint" style="margin-top:8px">Importing chop…</div>';
            T.Chops.add(f.filepath, f.filename.replace(/\.png$/i, ''), function () {
                msgEl.innerHTML = '';
                render();
                if (onChanged) { onChanged(); }
            }, function (err) {
                msgEl.innerHTML = '<div class="result-box result-err"><strong>Error:</strong> ' + T.escHtml(String(err)) + '</div>';
            });
        };

        render();
    };

})(window.PDFTool);
