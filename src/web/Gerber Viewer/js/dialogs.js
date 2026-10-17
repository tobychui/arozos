/*
    Gerber Viewer - dialogs

    Preferences, export / print / save, go to coordinate, drill and aperture
    tables, board report, layer source, keyboard shortcuts and about. Every
    entry point is registered on GV.app.cmd. Text goes through T() and
    locale/gerberviewer.json.
*/
(function (GV) {
    'use strict';

    var app = GV.app, cmd = app.cmd, state = app.state;
    var UI = GV.ui, L = GV.layers, R = GV.render, S = GV.store, X = GV.exporter;
    var icon = UI.icon, esc = UI.esc, T = UI.t;

    function project() {
        return state.project;
    }

    function safeName(s) {
        return String(s || 'board').replace(/[\\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_');
    }

    /* ==================================================================
        Board summary (also used by the Properties panel)
    ================================================================== */
    app.boardSummary = function () {
        var p = project();
        var out = { copper: 0, holes: 0, pth: 0, npth: 0, slots: 0, minHole: 0, minTrace: 0 };
        if (!p) {
            return out;
        }
        out.copper = p.layers.filter(function (l) { return /copper/.test(l.type); }).length;
        var b = p.board;
        if (b) {
            out.holes = b.holes.length;
            b.holes.forEach(function (h) {
                if (h.plated) {
                    out.pth++;
                } else {
                    out.npth++;
                }
                if (h.r > 0 && (!out.minHole || h.r * 2 < out.minHole)) {
                    out.minHole = h.r * 2;
                }
            });
            out.slots = b.slots.length;
        }
        p.layers.forEach(function (l) {
            if (!/copper/.test(l.type) || !l.image) {
                return;
            }
            l.image.groups.forEach(function (g) {
                if (!g.dark) {
                    return;
                }
                g.items.forEach(function (it) {
                    if ((it.t === 'l' || it.t === 'a') && it.w > 0.01 && it.o && (it.o.k === 'trace' || it.o.k === 'arc')) {
                        if (!out.minTrace || it.w < out.minTrace) {
                            out.minTrace = it.w;
                        }
                    }
                });
            });
        });
        return out;
    };

    /* ==================================================================
        Saving helpers
    ================================================================== */
    //Ask where to save, then hand the data over. getData() -> Promise<Blob|string>
    function saveOutput(filename, mime, getData, preset) {
        function toDevice() {
            return Promise.resolve(getData()).then(function (d) {
                X.download(d, filename, mime);
            });
        }
        function toAroz() {
            return new Promise(function (resolve, reject) {
                ao_module_openFileSelector(function (files) {
                    if (!files || !files.length) {
                        resolve(false);
                        return;
                    }
                    var path = files[0].filepath;
                    UI.toast(T('save/saving', 'Saving {name}...', { name: files[0].filename }), { icon: 'upload' });
                    Promise.resolve(getData()).then(function (d) {
                        return X.saveToAroz(path, d);
                    }).then(function () {
                        UI.toast(T('save/saved', 'Saved to {path}', { path: path }), { icon: 'check' });
                        resolve(true);
                    }, function (e) {
                        UI.toast(T('save/failed', 'Unable to save: {error}', { error: app.errText(e) }), { type: 'error' });
                        reject(e);
                    });
                }, 'user:/', 'new', false, { defaultName: filename, path_memory_key: 'export' });
            });
        }
        if (preset === 'device' || !S.online) {
            return toDevice();
        }
        if (preset === 'aroz') {
            return toAroz();
        }
        UI.dialog({
            title: T('save/title', 'Save {name}', { name: filename }),
            icon: 'download',
            width: 420,
            body: '<p style="margin:0">' + esc(T('save/where', 'Where do you want to save this file?')) + '</p>',
            buttons: [
                { label: T('save/device', 'This Device'), icon: 'laptop', action: function () { toDevice(); } },
                { label: T('save/aroz', 'ArozOS...'), icon: 'drive', primary: true, action: function () { toAroz(); } }
            ]
        });
        return Promise.resolve();
    }

    function choice(name, options, current) {
        return '<div class="chips" data-choice="' + name + '">' + options.map(function (o) {
            return '<button type="button" data-v="' + esc(o[0]) + '" class="' + (String(o[0]) === String(current) ? 'active' : '') + '">' +
                (o[2] ? '<span class="dot" style="--c:' + esc(o[2]) + '"></span>' : '') + esc(o[1]) + '</button>';
        }).join('') + '</div>';
    }

    function bindChoices(root, onChange) {
        root.querySelectorAll('[data-choice]').forEach(function (group) {
            group.addEventListener('click', function (e) {
                var b = e.target.closest('button[data-v]');
                if (!b || b.disabled) {
                    return;
                }
                group.querySelectorAll('button').forEach(function (x) { x.classList.toggle('active', x === b); });
                if (onChange) {
                    onChange(group.dataset.choice, b.dataset.v);
                }
            });
        });
    }

    function chosen(root, name) {
        var b = root.querySelector('[data-choice="' + name + '"] button.active');
        return b ? b.dataset.v : null;
    }

    function setChoiceEnabled(root, name, value, on) {
        var b = root.querySelector('[data-choice="' + name + '"] button[data-v="' + value + '"]');
        if (b) {
            b.disabled = !on;
            b.style.opacity = on ? '' : '0.4';
        }
    }

    function label(key, fallback) {
        return '<label>' + esc(T(key, fallback)) + '</label>';
    }

    /* ==================================================================
        Rendering for export / print
    ================================================================== */
    function sceneFor(render, colorsOverride, background) {
        var base = app.scene(false);
        var flip = render === 'bottom';
        var layers = app.drawOrder();
        if (render !== 'current') {
            //drawOrder follows the live view; rebuild it for the requested side
            layers = state.project.layers.slice().reverse();
            if (flip) {
                var idx = [], sided = [];
                layers.forEach(function (l, i) {
                    if (L.info(l.type).side !== 'all') {
                        idx.push(i);
                        sided.push(l);
                    }
                });
                sided.reverse();
                idx.forEach(function (p, k) { layers[p] = sided[k]; });
            }
        }
        if (colorsOverride) {
            layers = layers.map(function (l) {
                var c = Object.create(l);
                c.color = colorsOverride;
                c.opacity = 1;
                return c;
            });
        }
        var mode = render === 'current' ? state.mode : (render === 'layers' ? 'layers' : 'realistic');
        return {
            scene: Object.assign({}, base, {
                mode: mode,
                side: render === 'current' ? base.side : (flip ? 'bottom' : 'top'),
                layers: layers,
                background: background,
                grid: null,
                shadow: false
            }),
            flip: render === 'current' ? app.viewer.view.flip : flip
        };
    }

    function boardImage(render, dpi, background, colorsOverride, maxPx) {
        var b = app.projectBounds(false);
        var bw = b[2] - b[0], bh = b[3] - b[1];
        var pxmm = dpi / 25.4;
        maxPx = maxPx || 12000;
        if (Math.max(bw, bh) * pxmm > maxPx) {
            pxmm = maxPx / Math.max(bw, bh);
        }
        var s = sceneFor(render, colorsOverride, background);
        var rot = render === 'current' ? app.viewer.view.rot : 0;
        var turned = (rot / 90) % 2 !== 0;
        var W = (turned ? bh : bw) * pxmm, H = (turned ? bw : bh) * pxmm;
        var cv = R.renderToCanvas(s.scene, { cx: (b[0] + b[2]) / 2, cy: (b[1] + b[3]) / 2, scale: pxmm, rot: rot, flip: s.flip }, W, H);
        return { canvas: cv, widthMM: turned ? bh : bw, heightMM: turned ? bw : bh, dpi: pxmm * 25.4 };
    }

    function renderChoices() {
        return [['layers', T('export/layers', 'Layer view')], ['top', T('export/top', 'Realistic top')], ['bottom', T('export/bottom', 'Realistic bottom')]];
    }

    /* ==================================================================
        Export image
    ================================================================== */
    cmd.exportDialog = function () {
        var p = project();
        if (!p) {
            return;
        }
        var is3d = state.dim === '3d';
        var body = UI.h('div');
        body.innerHTML = '<div class="form-grid">' +
            label('export/area', 'Area') + choice('area', (is3d ? [['3d', T('export/3d', '3D snapshot')]] : []).concat([
                ['view', T('export/view', 'Current view')], ['board', T('export/board', 'Whole board')]]), is3d ? '3d' : 'board') +
            label('export/content', 'Content') + choice('render', renderChoices(), state.mode === 'realistic' ? (app.viewer.view.flip ? 'bottom' : 'top') : 'layers') +
            label('export/format', 'Format') + choice('format', [['png', 'PNG'], ['jpg', 'JPEG'], ['svg', T('export/svg', 'SVG (vector)')]], 'png') +
            label('export/resolution', 'Resolution') + choice('dpi', [['300', '300 dpi'], ['600', '600 dpi'], ['1200', '1200 dpi']], '600') +
            label('export/background', 'Background') + choice('bg', [['canvas', T('export/bgCanvas', 'Canvas colour')],
                ['transparent', T('export/bgNone', 'Transparent')], ['white', T('export/bgWhite', 'White')]], 'canvas') +
            '</div><p class="muted small" id="exNote" style="margin:14px 0 0"></p>';
        function refresh() {
            var area = chosen(body, 'area'), fmt = chosen(body, 'format'), render = chosen(body, 'render');
            var vector = area === 'board' && render === 'layers';
            setChoiceEnabled(body, 'format', 'svg', vector);
            if (fmt === 'svg' && !vector) {
                body.querySelector('[data-choice=format] [data-v=png]').click();
                return;
            }
            ['layers', 'top', 'bottom'].forEach(function (v) { setChoiceEnabled(body, 'render', v, area !== '3d'); });
            ['300', '600', '1200'].forEach(function (v) { setChoiceEnabled(body, 'dpi', v, area === 'board' && fmt !== 'svg'); });
            setChoiceEnabled(body, 'bg', 'transparent', fmt !== 'jpg' && area !== '3d');
            if (chosen(body, 'bg') === 'transparent' && (fmt === 'jpg' || area === '3d')) {
                body.querySelector('[data-choice=bg] [data-v=canvas]').click();
                return;
            }
            var note = '';
            if (area === 'board' && fmt !== 'svg') {
                var b = app.projectBounds(false);
                var pxmm = (+chosen(body, 'dpi')) / 25.4;
                var w = Math.round((b[2] - b[0]) * pxmm), h = Math.round((b[3] - b[1]) * pxmm);
                note = Math.max(w, h) > 12000 ? T('export/noteSizeCapped', 'Image size about {w} × {h} px (limited to 12000 px on the long side).', { w: w, h: h }) :
                    T('export/noteSize', 'Image size about {w} × {h} px.', { w: w, h: h });
            } else if (area === 'view') {
                note = T('export/noteView', 'Exports exactly what is visible, at twice the screen resolution.');
            } else if (fmt === 'svg') {
                note = T('export/noteSvg', 'Visible layers as vector paths, sized in millimetres.');
            }
            body.querySelector('#exNote').textContent = note;
        }
        bindChoices(body, refresh);
        refresh();

        function produce() {
            var area = chosen(body, 'area'), fmt = chosen(body, 'format'), render = chosen(body, 'render');
            var bgSel = chosen(body, 'bg');
            var bg = bgSel === 'transparent' ? null : (bgSel === 'white' ? '#ffffff' : state.settings.canvasBg);
            var name = safeName(p.name) + '_' + (area === '3d' ? '3d' : render) + '.' + fmt;
            var mime = fmt === 'svg' ? 'image/svg+xml' : (fmt === 'jpg' ? 'image/jpeg' : 'image/png');
            var get = function () {
                if (area === '3d') {
                    return fetch(app.get3D().snapshot()).then(function (r) { return r.blob(); }).then(function (blob) {
                        if (fmt === 'png') {
                            return blob;
                        }
                        return createImageBitmap(blob).then(function (bmp) {
                            var c = document.createElement('canvas');
                            c.width = bmp.width;
                            c.height = bmp.height;
                            var cx = c.getContext('2d');
                            cx.fillStyle = bg || '#000';
                            cx.fillRect(0, 0, c.width, c.height);
                            cx.drawImage(bmp, 0, 0);
                            return X.canvasBlob(c, mime, 0.92);
                        });
                    });
                }
                if (fmt === 'svg') {
                    var sc = sceneFor('layers', null, bg);
                    return X.svg(sc.scene.layers, app.projectBounds(false), { background: bg, flip: false, title: p.name });
                }
                var cv;
                if (area === 'view') {
                    var k = 2;
                    var v = Object.assign({}, app.viewer.view, { scale: app.viewer.view.scale * k });
                    var s = sceneFor(render === 'layers' && state.mode === 'layers' ? 'current' : render, null, bg);
                    v.flip = render === 'layers' ? app.viewer.view.flip : s.flip;
                    cv = R.renderToCanvas(s.scene, v, app.viewer.cssW * k, app.viewer.cssH * k);
                } else {
                    var bgFill = fmt === 'jpg' && !bg ? '#ffffff' : bg;
                    cv = boardImage(render, +chosen(body, 'dpi'), bgFill).canvas;
                }
                return X.canvasBlob(cv, mime, 0.92);
            };
            return { name: name, mime: mime, get: get };
        }

        var buttons = [{ label: T('common/cancel', 'Cancel') }];
        if (S.online) {
            buttons.push({
                label: T('export/toAroz', 'Save to ArozOS...'), icon: 'drive', action: function () {
                    var o = produce();
                    saveOutput(o.name, o.mime, o.get, 'aroz');
                }
            });
        }
        buttons.push({
            label: T('export/download', 'Download'), icon: 'download', primary: true, action: function () {
                var o = produce();
                UI.toast(T('export/rendering', 'Rendering {name}...', { name: o.name }), { icon: 'image' });
                setTimeout(function () {
                    saveOutput(o.name, o.mime, o.get, 'device').catch(function (e) {
                        UI.toast(T('export/failed', 'Export failed: {error}', { error: app.errText(e) }), { type: 'error' });
                    });
                }, 30);
            }
        });
        UI.dialog({ title: T('export/title', 'Export Image'), icon: 'image', width: 560, body: body, buttons: buttons });
    };

    /* ==================================================================
        Save project as zip, drill CSV
    ================================================================== */
    cmd.saveZip = function () {
        var p = project();
        if (!p) {
            return;
        }
        var used = new Set();
        var files = p.layers.map(function (l) {
            var n = l.name.replace(/^\/+/, '');
            while (used.has(n)) {
                n = '_' + n;
            }
            used.add(n);
            return { name: n, text: l.text };
        });
        saveOutput(safeName(p.name) + '_gerber.zip', 'application/zip', function () {
            return GV.zip.create(files).then(function (bytes) { return new Blob([bytes], { type: 'application/zip' }); });
        });
    };

    //Column titles stay in English: the CSV is meant for other tools
    cmd.exportDrillCSV = function () {
        var p = project();
        if (!p) {
            return;
        }
        saveOutput(safeName(p.name) + '_drills.csv', 'text/csv', function () { return X.drillCSV(p.layers); });
    };

    /* ==================================================================
        Print
    ================================================================== */
    cmd.printDialog = function () {
        var p = project();
        if (!p) {
            return;
        }
        var body = UI.h('div');
        body.innerHTML = '<div class="form-grid">' +
            label('export/content', 'Content') + choice('render', renderChoices(), state.mode === 'realistic' ? (app.viewer.view.flip ? 'bottom' : 'top') : 'layers') +
            label('print/scale', 'Scale') + choice('scale', [['actual', T('print/actual', 'Actual size (1:1)')], ['fit', T('print/fit', 'Fit to page')]], 'actual') +
            label('print/colours', 'Colours') + choice('ink', [['color', T('print/colour', 'Layer colours')], ['mono', T('print/mono', 'Black on white')]], 'mono') +
            '</div><p class="muted small" style="margin:14px 0 0">' + esc(T('print/note',
                'Actual size prints the board 1:1, handy for checking footprints against real parts. Turn off "fit to page" or scaling in the browser print dialog.')) + '</p>';
        bindChoices(body, function (name, v) {
            if (name === 'render') {
                setChoiceEnabled(body, 'ink', 'mono', v === 'layers');
                if (v !== 'layers') {
                    body.querySelector('[data-choice=ink] [data-v=color]').click();
                }
            }
        });
        UI.dialog({
            title: T('print/title', 'Print'), icon: 'print', width: 520, body: body,
            buttons: [
                { label: T('common/cancel', 'Cancel') },
                {
                    label: T('print/print', 'Print'), icon: 'print', primary: true, action: function () {
                        var render = chosen(body, 'render');
                        var mono = chosen(body, 'ink') === 'mono' && render === 'layers';
                        var img = boardImage(render, 600, '#ffffff', mono ? '#000000' : null, 9000);
                        X.print(img.canvas.toDataURL('image/png'), img.widthMM, img.heightMM, p.name, chosen(body, 'scale') === 'fit');
                    }
                }
            ]
        });
    };

    /* ==================================================================
        Preferences
    ================================================================== */
    cmd.settingsDialog = function () {
        var s = JSON.parse(JSON.stringify(state.settings));
        var body = UI.h('div');
        var tabs = [['general', T('pref/general', 'General')], ['display', T('pref/display', 'Display')],
            ['board', T('pref/board', 'Board')], ['colors', T('pref/layerColours', 'Layer Colours')]];
        var thick = [0.4, 0.6, 0.8, 1.0, 1.2, 1.6, 2.0, 2.4, 3.2];
        function check(key, textKey, text) {
            return '<label class="field-row"><input type="checkbox" data-k="' + key + '">' + esc(T(textKey, text)) + '</label>';
        }
        body.innerHTML = '<div class="settings-tabs">' + tabs.map(function (t, i) {
            return '<button data-st="' + t[0] + '" class="' + (i === 0 ? 'active' : '') + '">' + esc(t[1]) + '</button>';
        }).join('') + '</div>' +
            //General
            '<div data-sp="general" class="form-grid">' +
            label('pref/units', 'Units') + '<select data-k="units"><option value="mm">' + esc(T('pref/unitMm', 'Millimetres (mm)')) + '</option>' +
            '<option value="in">' + esc(T('pref/unitIn', 'Inches (in)')) + '</option><option value="mil">' + esc(T('pref/unitMil', 'Mils (thou)')) + '</option></select>' +
            label('pref/decimals', 'Decimal places') + '<select data-k="decimals"><option value="2">2</option><option value="3">3</option><option value="4">4</option></select>' +
            label('pref/theme', 'Theme') + '<select data-k="theme"><option value="system">' + esc(T('theme/system', 'Follow ArozOS')) + '</option>' +
            '<option value="light">' + esc(T('theme/light', 'Light')) + '</option><option value="dark">' + esc(T('theme/dark', 'Dark')) + '</option></select>' +
            label('pref/startup', 'On startup') + check('restoreLast', 'pref/restoreLast', 'Reopen the last project') +
            label('pref/sidePanel', 'Side panel') + check('tips', 'pref/showTips', 'Show tips') +
            '</div>' +
            //Display
            '<div data-sp="display" class="form-grid" hidden>' +
            label('pref/canvasBg', 'Canvas background') + '<div class="field-row" style="flex-wrap:wrap">' +
            choice('canvasBg', app.BACKGROUNDS.map(function (b) { return [b.color, T('bg/' + b.label.toLowerCase(), b.label), b.color]; }), s.canvasBg) +
            '<input type="color" data-k="canvasBg" value="' + esc(s.canvasBg) + '" title="' + esc(T('pref/customColour', 'Custom colour')) + '"></div>' +
            label('pref/opacity', 'New layer opacity') + '<div class="field-row"><input type="range" min="30" max="100" data-k="defaultOpacity" value="' +
            Math.round(s.defaultOpacity * 100) + '"><span data-out="defaultOpacity">' + Math.round(s.defaultOpacity * 100) + '%</span></div>' +
            label('pref/grid', 'Grid') + check('grid', 'pref/showGrid', 'Show grid') +
            label('pref/minimap', 'Minimap') + check('minimap', 'pref/showMinimap', 'Show minimap') +
            label('pref/cursor', 'Cursor') + check('crosshair', 'pref/crosshair', 'Full-screen crosshair') +
            label('pref/measuring', 'Measuring') + check('snap', 'pref/snap', 'Snap to pads, holes and line ends') +
            '</div>' +
            //Board look
            '<div data-sp="board" class="form-grid" hidden>' +
            label('pref/mask', 'Solder mask') + choice('mask', Object.keys(app.MASKS).map(function (k) {
                return [k, T('mask/' + k, app.MASKS[k].label), app.MASKS[k].color];
            }), s.mask) +
            label('pref/silk', 'Silkscreen') + choice('silk', [['auto', T('silk/auto', 'Automatic')], ['white', T('silk/white', 'White'), '#f2f2f2'],
                ['black', T('silk/black', 'Black'), '#141414'], ['yellow', T('silk/yellow', 'Yellow'), '#f2d21b']], s.silk) +
            label('pref/finish', 'Surface finish') + choice('finish', Object.keys(app.FINISHES).map(function (k) {
                return [k, T('finish/' + k, app.FINISHES[k].label), app.FINISHES[k].color];
            }), s.finish) +
            label('pref/thickness', 'Board thickness') + '<select data-k="thickness">' + thick.map(function (t) {
                return '<option value="' + t + '">' + t.toFixed(1) + ' mm</option>';
            }).join('') + '</select>' +
            '</div>' +
            //Layer colours
            '<div data-sp="colors" hidden><div class="form-grid">' + L.TYPE_LIST.map(function (t) {
                var c = (s.layerColors && s.layerColors[t]) || L.info(t).color;
                return '<label>' + esc(app.layerLabel({ type: t })) + '</label><div class="field-row"><input type="color" data-lc="' + t + '" value="' + esc(c) + '">' +
                    '<button class="btn small" data-lcr="' + t + '">' + esc(T('pref/default', 'Default')) + '</button></div>';
            }).join('') + '</div>' +
            '<label class="field-row" style="margin-top:14px"><input type="checkbox" id="applyOpen" checked>' + esc(T('pref/recolour', 'Also recolour layers of the open project')) + '</label></div>';

        var sel = function (k) { return body.querySelector('[data-k="' + k + '"]'); };
        ['units', 'decimals', 'theme', 'thickness'].forEach(function (k) { sel(k).value = String(s[k]); });
        ['restoreLast', 'tips', 'grid', 'minimap', 'crosshair', 'snap'].forEach(function (k) { sel(k).checked = !!s[k]; });
        body.querySelectorAll('[data-st]').forEach(function (b) {
            b.addEventListener('click', function () {
                body.querySelectorAll('[data-st]').forEach(function (x) { x.classList.toggle('active', x === b); });
                body.querySelectorAll('[data-sp]').forEach(function (p) { p.hidden = p.dataset.sp !== b.dataset.st; });
            });
        });
        sel('defaultOpacity').addEventListener('input', function () {
            body.querySelector('[data-out=defaultOpacity]').textContent = this.value + '%';
        });
        bindChoices(body, function (name, v) {
            if (name === 'canvasBg') {
                sel('canvasBg').value = v;
            }
        });
        sel('canvasBg').addEventListener('input', function () {
            body.querySelectorAll('[data-choice=canvasBg] button').forEach(function (b) {
                b.classList.toggle('active', b.dataset.v.toLowerCase() === sel('canvasBg').value.toLowerCase());
            });
        });
        body.querySelectorAll('[data-lcr]').forEach(function (b) {
            b.addEventListener('click', function () {
                body.querySelector('[data-lc="' + b.dataset.lcr + '"]').value = L.info(b.dataset.lcr).color;
            });
        });

        function collect() {
            var n = Object.assign({}, s);
            n.units = sel('units').value;
            n.decimals = parseInt(sel('decimals').value, 10);
            n.theme = sel('theme').value;
            n.thickness = parseFloat(sel('thickness').value);
            ['restoreLast', 'tips', 'grid', 'minimap', 'crosshair', 'snap'].forEach(function (k) { n[k] = sel(k).checked; });
            n.canvasBg = sel('canvasBg').value;
            n.defaultOpacity = parseInt(sel('defaultOpacity').value, 10) / 100;
            n.mask = chosen(body, 'mask') || n.mask;
            n.silk = chosen(body, 'silk') || n.silk;
            n.finish = chosen(body, 'finish') || n.finish;
            n.layerColors = {};
            body.querySelectorAll('[data-lc]').forEach(function (i) {
                if (i.value.toLowerCase() !== L.info(i.dataset.lc).color.toLowerCase()) {
                    n.layerColors[i.dataset.lc] = i.value;
                }
            });
            return n;
        }

        function apply(n, recolour) {
            var oldColors = {};
            L.TYPE_LIST.forEach(function (t) { oldColors[t] = app.defaultColor(t); });
            var lookChanged = n.mask !== state.settings.mask || n.silk !== state.settings.silk || n.finish !== state.settings.finish ||
                n.thickness !== state.settings.thickness || n.canvasBg !== state.settings.canvasBg;
            app.applySettings(n);
            S.saveSettings(state.settings);
            if (recolour && state.project) {
                state.project.layers.forEach(function (l) {
                    if (l.color.toLowerCase() === String(oldColors[l.type]).toLowerCase()) {
                        l.color = app.defaultColor(l.type);
                    }
                });
            }
            app.setUnits(n.units);
            if (state.project) {
                app.layersChanged();
                if (lookChanged && state.dim === '3d') {
                    app.schedule3D();
                }
            }
            app.renderMinimap();
            app.updateToolbar();
        }

        var dlg = UI.dialog({
            title: T('pref/title', 'Preferences'), icon: 'gear', width: 640, body: body,
            footerLeft: UI.h('button', { class: 'btn', onclick: function () {
                UI.confirm(T('pref/resetTitle', 'Reset preferences'), T('pref/resetText', 'Restore every preference to its default value?'), T('common/reset', 'Reset')).then(function (ok) {
                    if (ok) {
                        dlg.close();
                        apply(JSON.parse(JSON.stringify(app.DEFAULTS)), true);
                        UI.toast(T('pref/resetDone', 'Preferences restored to their defaults'), { icon: 'check' });
                    }
                });
            } }, icon('refresh') + esc(T('pref/reset', 'Reset to Defaults'))),
            buttons: [
                { label: T('common/cancel', 'Cancel') },
                { label: T('common/save', 'Save'), primary: true, action: function () {
                    var cb = body.querySelector('#applyOpen');
                    apply(collect(), !cb || cb.checked);
                } }
            ]
        });
    };

    /* ==================================================================
        Go to coordinate
    ================================================================== */
    cmd.gotoDialog = function () {
        if (!project()) {
            return;
        }
        var u = app.unitInfo();
        var c = state.cursor || [app.viewer.view.cx, app.viewer.view.cy];
        var body = UI.h('div');
        body.innerHTML = '<div class="form-grid">' +
            '<label>X (' + u.label + ')</label><input type="number" step="any" id="gx" autofocus value="' + ((c[0] - state.origin[0]) * u.f).toFixed(u.dec) + '">' +
            '<label>Y (' + u.label + ')</label><input type="number" step="any" id="gy" value="' + ((c[1] - state.origin[1]) * u.f).toFixed(u.dec) + '">' +
            '</div><p class="muted small" style="margin:12px 0 0">' + esc(T('goto/note', 'Coordinates are relative to the current origin.')) + '</p>';
        UI.dialog({
            title: T('goto/title', 'Go to Coordinate'), icon: 'crosshair', width: 380, body: body,
            buttons: [
                { label: T('common/cancel', 'Cancel') },
                { label: T('goto/go', 'Go'), primary: true, action: function () {
                    var x = parseFloat(body.querySelector('#gx').value), y = parseFloat(body.querySelector('#gy').value);
                    if (!isFinite(x) || !isFinite(y)) {
                        UI.toast(T('goto/missing', 'Enter both coordinates'), { type: 'error' });
                        return false;
                    }
                    var bx = x / u.f + state.origin[0], by = y / u.f + state.origin[1];
                    if (app.viewer.view.scale < 12) {
                        app.viewer.view.scale = 12;
                    }
                    app.viewer.centerOn(bx, by);
                    app.setMarker([bx, by]);
                } }
            ]
        });
    };

    /* ==================================================================
        Tables and reports
    ================================================================== */
    function platedText(v) {
        return v === null || v === undefined ? T('common/unknown', 'Unknown') : (v ? T('common/yes', 'Yes') : T('common/no', 'No'));
    }

    cmd.drillTable = function () {
        var p = project();
        if (!p) {
            return;
        }
        var drills = p.layers.filter(function (l) { return l.type === 'drill' && l.image.tools; });
        if (!drills.length) {
            UI.toast(T('drill/none', 'This project has no drill files.'), { type: 'error' });
            return;
        }
        var html = '';
        var total = 0;
        drills.forEach(function (l) {
            var holes = 0, slots = 0;
            html += '<div class="form-section">' + esc(l.label) + ' <span class="muted small">' + esc(L.base(l.name)) + '</span></div>' +
                '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>' + esc(T('drill/tool', 'Tool')) + '</th><th class="num">' + esc(T('drill/diameter', 'Diameter')) +
                '</th><th class="num">' + esc(T('drill/diameterIn', 'Diameter (in)')) + '</th><th>' + esc(T('drill/plated', 'Plated')) +
                '</th><th class="num">' + esc(T('drill/holes', 'Holes')) + '</th><th class="num">' + esc(T('drill/slots', 'Slots')) + '</th></tr></thead><tbody>' +
                l.image.tools.map(function (t) {
                    holes += t.hits;
                    slots += t.slots;
                    return '<tr><td>' + esc(t.name) + '</td><td class="num">' + t.dia.toFixed(3) + ' mm</td><td class="num">' + (t.dia / 25.4).toFixed(4) + '</td><td>' +
                        esc(platedText(t.plated)) + '</td><td class="num">' + t.hits + '</td><td class="num">' + t.slots + '</td></tr>';
                }).join('') +
                '</tbody><tfoot><tr><td colspan="4">' + esc(T('drill/total', 'Total')) + '</td><td class="num">' + holes + '</td><td class="num">' + slots + '</td></tr></tfoot></table></div>';
            total += holes;
        });
        var sum = app.boardSummary();
        var intro = T('drill/summary', '{n} unique holes ({p} plated, {np} non-plated) and {s} slots.', { n: sum.holes, p: sum.pth, np: sum.npth, s: sum.slots });
        if (sum.minHole) {
            intro += ' ' + T('drill/smallest', 'Smallest hole {d}.', { d: app.fmtLen(sum.minHole) });
        }
        html = '<p style="margin:0 0 6px">' + esc(intro) +
            (total !== sum.holes ? ' <span class="muted">' + esc(T('drill/duplicates', 'The files list {n} hits; duplicates across files are counted once.', { n: total })) + '</span>' : '') + '</p>' + html;
        UI.dialog({
            title: T('drill/title', 'Drill Table'), icon: 'drill', width: 680, body: html,
            buttons: [
                { label: T('drill/csv', 'Export CSV...'), icon: 'download', action: function () { cmd.exportDrillCSV(); } },
                { label: T('common/close', 'Close'), primary: true }
            ]
        });
    };

    function layerSelect(id, layers, current) {
        return '<select id="' + id + '" style="width:100%">' + layers.map(function (l) {
            return '<option value="' + l.id + '"' + (current && current.id === l.id ? ' selected' : '') + '>' + esc(l.label + ' – ' + L.base(l.name)) + '</option>';
        }).join('') + '</select>';
    }

    cmd.apertureTable = function (layer) {
        var p = project();
        if (!p) {
            return;
        }
        var gl = p.layers.filter(function (l) { return l.image.kind === 'gerber'; });
        if (!gl.length) {
            return;
        }
        layer = layer && layer.image.kind === 'gerber' ? layer : (app.layerById(state.selectedLayer) || gl[0]);
        if (layer.image.kind !== 'gerber') {
            layer = gl[0];
        }
        var body = UI.h('div');
        body.innerHTML = layerSelect('apLayer', gl, layer) + '<div id="apTable" style="margin-top:12px"></div>';
        function fill() {
            var l = app.layerById(+body.querySelector('#apLayer').value);
            var aps = l.image.apertures.slice().sort(function (a, b) { return a.num - b.num; });
            var unit = l.image.units === 'in' ? T('unit/inch', 'Inch') : T('unit/mm', 'Millimetre');
            body.querySelector('#apTable').innerHTML = aps.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>' + esc(T('ap/dcode', 'D-code')) +
                '</th><th>' + esc(T('ap/shape', 'Shape')) + '</th><th class="num">' + esc(T('ap/uses', 'Uses')) + '</th><th>' + esc(T('ap/function', 'Function')) + '</th></tr></thead><tbody>' +
                aps.map(function (a) {
                    var desc = app.apertureDesc(a) + (!a.macro && a.type !== 'block' ? ' mm' : '');
                    return '<tr><td>D' + a.num + '</td><td>' + esc(desc) + '</td><td class="num">' + a.uses + '</td><td>' + esc(a.attrs && a.attrs.AperFunction ? a.attrs.AperFunction.replace(/,/g, ', ') : '') + '</td></tr>';
                }).join('') + '</tbody></table></div><p class="muted small">' +
                esc(T('ap/note', 'Standard aperture sizes are shown in millimetres; macro parameters use the unit of the file ({unit}).', { unit: unit })) + '</p>' :
                '<p class="muted">' + esc(T('ap/none', 'No apertures are defined in this layer.')) + '</p>';
        }
        body.querySelector('#apLayer').addEventListener('change', fill);
        fill();
        UI.dialog({ title: T('ap/title', 'Aperture Table'), icon: 'table', width: 640, body: body, buttons: [{ label: T('common/close', 'Close'), primary: true }] });
    };

    cmd.viewSource = function (layer) {
        var p = project();
        if (!p) {
            return;
        }
        layer = layer || app.layerById(state.selectedLayer) || p.layers[0];
        var body = UI.h('div');
        body.innerHTML = layerSelect('srcLayer', p.layers, layer) + '<div class="muted small" id="srcInfo" style="margin:8px 0"></div><pre class="source-view" id="srcText"></pre>';
        var LIMIT = 400 * 1024;
        function fill() {
            var l = app.layerById(+body.querySelector('#srcLayer').value);
            var t = l.text || '';
            body.querySelector('#srcText').textContent = t.length > LIMIT ? t.slice(0, LIMIT) + '\n\n' + T('source/more', '... ({size} more)', { size: app.fmtBytes(t.length - LIMIT) }) : t;
            body.querySelector('#srcInfo').textContent = l.name + ' · ' + app.fmtBytes(t.length) + ' · ' + T('source/lines', '{n} lines', { n: t.split(/\n/).length });
        }
        body.querySelector('#srcLayer').addEventListener('change', fill);
        fill();
        UI.dialog({
            title: T('source/title', 'Layer Source'), icon: 'code', width: 820, body: body,
            buttons: [
                { label: T('export/download', 'Download'), icon: 'download', action: function () {
                    var l = app.layerById(+body.querySelector('#srcLayer').value);
                    X.download(l.text, L.base(l.name), 'text/plain');
                    return false;
                } },
                { label: T('common/close', 'Close'), primary: true }
            ]
        });
    };

    cmd.boardReport = function () {
        var p = project();
        if (!p) {
            return;
        }
        var b = p.board;
        var s = app.boardSummary();
        var outline = '';
        if (b) {
            outline = b.source === 'outline' ? T('report/outlines', '{n} closed outline(s), {c} cut-out(s)', { n: b.outer.length, c: b.cutouts.length }) :
                T('report/noOutline', 'No closed outline found');
        }
        var rows = [
            [T('report/project', 'Project'), p.name],
            [T('report/size', 'Board size'), b && b.width ? app.fmtSize(b.width, b.height) : T('common/unknown', 'Unknown')],
            [T('report/area', 'Board area'), b && b.area ? (b.area / 100).toFixed(2) + ' cm²' : ''],
            [T('report/outline', 'Outline'), outline],
            [T('props/copperLayers', 'Copper layers'), s.copper],
            [T('props/holesLabel', 'Holes'), T('props/holesValue', '{n} ({p} plated, {np} non-plated)', { n: s.holes, p: s.pth, np: s.npth })],
            [T('props/slotsLabel', 'Slots'), s.slots],
            [T('props/minHole', 'Smallest hole'), s.minHole ? app.fmtLen(s.minHole) : '-'],
            [T('props/minTrace', 'Thinnest trace'), s.minTrace ? app.fmtLen(s.minTrace) : '-'],
            [T('info/generator', 'Generator'), p.generator || '-'],
            [T('info/created', 'Created'), app.fmtDate(p.created) || '-']
        ];
        var html = '<dl class="kv" style="padding:0 0 6px">' + rows.map(function (r) {
            return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>';
        }).join('') + '</dl>' +
            '<div class="form-section">' + esc(T('report/layers', 'Layers')) + '</div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>' +
            esc(T('report/layer', 'Layer')) + '</th><th>' + esc(T('report/file', 'File')) + '</th><th class="num">' + esc(T('report/objects', 'Objects')) +
            '</th><th>' + esc(T('report/units', 'Units')) + '</th><th>' + esc(T('report/notes', 'Notes')) + '</th></tr></thead><tbody>' +
            p.layers.map(function (l) {
                var st = l.image.stats;
                var count = l.image.kind === 'drill' ? st.holes + st.slots : st.flashes + st.lines + st.arcs + st.regions;
                return '<tr><td>' + esc(l.label) + '</td><td>' + esc(L.base(l.name)) + '</td><td class="num">' + count + '</td><td>' + (l.image.units === 'in' ? 'inch' : 'mm') +
                    '</td><td>' + (l.image.warnings.length ? esc(T('report/warnings', '{n} warning(s)', { n: l.image.warnings.length })) : '') + '</td></tr>';
            }).join('') + '</tbody></table></div>';
        var warns = [];
        p.layers.forEach(function (l) {
            app.warningTexts(l.image).forEach(function (w) { warns.push('<li><b>' + esc(l.label) + ':</b> ' + esc(w) + '</li>'); });
        });
        if (warns.length) {
            html += '<div class="form-section">' + esc(T('props/warnings', 'Warnings')) + '</div><ul class="list-plain warn-list">' + warns.join('') + '</ul>';
        }
        if (p.skipped.length) {
            html += '<div class="form-section">' + esc(T('report/ignored', 'Ignored files')) + '</div><ul class="list-plain warn-list">' + p.skipped.map(function (s2) {
                return '<li><b>' + esc(s2.name) + '</b> <span class="muted">' + esc(app.reasonText(s2)) + '</span></li>';
            }).join('') + '</ul>';
        }
        UI.dialog({ title: T('report/title', 'Board Report'), icon: 'board', width: 720, body: html, buttons: [{ label: T('common/close', 'Close'), primary: true }] });
    };

    /* ==================================================================
        Help
    ================================================================== */
    cmd.shortcuts = function () {
        var k = function (s) {
            return s.split('+').map(function (x) { return '<kbd>' + esc(x) + '</kbd>'; }).join(' + ');
        };
        var groups = [
            [T('keys/files', 'Files'), [
                [T('keys/openAroz', 'Open from ArozOS'), 'Ctrl+O'], [T('keys/openLocal', 'Open from this device'), 'Ctrl+Shift+O'],
                [T('keys/export', 'Export image'), 'Ctrl+E'], [T('keys/saveZip', 'Save project as ZIP'), 'Ctrl+S'], [T('keys/print', 'Print'), 'Ctrl+P'],
                [T('keys/reload', 'Reload project'), 'Ctrl+Shift+R'], [T('keys/preferences', 'Preferences'), 'Ctrl+,']]],
            [T('keys/tools', 'Tools'), [
                [T('keys/select', 'Select'), 'V'], [T('keys/pan', 'Pan'), 'H'], [T('keys/zoomArea', 'Zoom to area'), 'Z'], [T('keys/measure', 'Measure'), 'M'],
                [T('keys/panAny', 'Pan with any tool'), 'Space'], [T('keys/cancel', 'Cancel / clear'), 'Esc'], [T('keys/goto', 'Go to coordinate'), 'Ctrl+G'],
                [T('keys/copyCursor', 'Copy cursor coordinates'), 'Ctrl+Shift+C']]],
            [T('keys/view', 'View'), [
                [T('keys/fit', 'Zoom to fit'), 'F'], [T('keys/zoom', 'Zoom in / out'), '+ / -'], [T('keys/actual', 'Actual size'), '1'], [T('keys/rotate', 'Rotate 90°'), 'R'],
                [T('keys/bottom', 'Bottom side'), 'B'], [T('keys/realistic', 'Realistic preview'), 'P'], [T('keys/dim', '2D / 3D'), '2 / 3'], [T('keys/grid', 'Grid'), 'G'],
                [T('keys/crosshair', 'Crosshair'), 'C'], [T('keys/panel', 'Side panel'), 'Ctrl+B'], [T('keys/focus', 'Focus mode'), 'Shift+F'],
                [T('keys/cycle', 'Previous / next layer'), 'PgUp / PgDn'], [T('keys/panKeys', 'Pan'), T('keys/arrows', 'Arrow keys')]]],
            [T('keys/mouse', 'Mouse'), [
                [T('keys/wheelZoom', 'Zoom'), T('keys/wheel', 'Wheel')], [T('keys/dragPan', 'Pan'), T('keys/drag', 'Drag')],
                [T('keys/panAnyMouse', 'Pan (any tool)'), T('keys/rightDrag', 'Right / middle drag')],
                [T('keys/dblclick', 'Zoom to object / fit'), T('keys/doubleClick', 'Double-click')], [T('keys/context', 'Context menu'), T('keys/rightClick', 'Right-click')],
                [T('keys/addDrop', 'Add dropped files to the project'), 'Shift+' + T('keys/drop', 'Drop')]]]
        ];
        var html = groups.map(function (g) {
            return '<div class="form-section">' + esc(g[0]) + '</div><div class="keys">' + g[1].map(function (r) {
                return '<span>' + esc(r[0]) + '</span><span>' + (r[1].indexOf(' / ') > 0 ? r[1].split(' / ').map(k).join(' / ') : k(r[1])) + '</span>';
            }).join('') + '</div>';
        }).join('');
        UI.dialog({ title: T('keys/title', 'Keyboard Shortcuts'), icon: 'keyboard', width: 560, body: html, buttons: [{ label: T('common/close', 'Close'), primary: true }] });
    };

    cmd.formats = function () {
        var html = '<div class="form-section">Gerber</div>' +
            '<p style="margin:0 0 6px">' + esc(T('formats/gerber',
                'RS-274X and Gerber X2 (attributes, nets and components), including aperture macros, regions, arcs, clear polarity, step and repeat and block apertures. Common extensions: .gbr .ger .gtl .gbl .gto .gbo .gts .gbs .gtp .gbp .gko .gm1 .g1 .. .g30 .art .pho and Eagle / KiCad names.')) + '</p>' +
            '<div class="form-section">' + esc(T('formats/drillTitle', 'Drill')) + '</div><p style="margin:0 0 6px">' + esc(T('formats/drill',
                'Excellon (.drl .xln .exc .txt .drd) in metric or inch with leading or trailing zero suppression, slots (G85) and routed outlines.')) + '</p>' +
            '<div class="form-section">' + esc(T('formats/packagesTitle', 'Packages')) + '</div><p style="margin:0">' + esc(T('formats/packages',
                'Zip archives from the local device. From ArozOS: zip, 7z, tar and tar.gz archives (unpacked on the server), folders, or any set of files.')) + '</p>' +
            '<p class="muted small" style="margin:12px 0 0">' + esc(T('formats/detect',
                'Layer types are detected from X2 attributes and from the file naming of EasyEDA, KiCad, Altium, Eagle / Fusion, DipTrace and Proteus. You can change any type from the layer menu.')) + '</p>';
        UI.dialog({ title: T('formats/title', 'Supported Formats'), icon: 'file', width: 560, body: html, buttons: [{ label: T('common/close', 'Close'), primary: true }] });
    };

    cmd.about = function () {
        var html = '<div style="display:flex;gap:16px;align-items:center;margin-bottom:12px"><img src="img/module_icon.svg" style="width:56px;height:56px">' +
            '<div><div style="font-size:18px;font-weight:700">' + esc(T('app/title', 'Gerber Viewer')) + '</div><div class="muted">' +
            esc(T('about/version', 'Version {v} for ArozOS', { v: '1.0' })) + '</div></div></div>' +
            '<p style="margin:0 0 8px">' + esc(T('about/text', 'View PCB fabrication data in layers, as a realistic board preview or in 3D. Measure features, inspect apertures and drills, and export images.')) + '</p>' +
            '<p class="muted small" style="margin:0">' + esc(T('about/credits', 'Archives on ArozOS are unpacked by the AGI backend of this app. The 3D view uses three.js (MIT License).')) + ' ' +
            esc(S.online ? T('about/storedAroz', 'Settings and recent projects are kept per user in ArozOS.') : T('about/storedLocal', 'Settings and recent projects are kept in this browser.')) + '</p>';
        UI.dialog({ title: T('about/title', 'About'), icon: 'info', width: 460, body: html, buttons: [{ label: T('common/close', 'Close'), primary: true }] });
    };
})(window.GV = window.GV || {});
