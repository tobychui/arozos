/*
    Gerber Viewer - application controller

    Owns the project / settings state, loading (ArozOS through AGI, the local
    device, drag and drop), the 2D viewer interaction, the side panel and the
    menu bar. Dialogs live in dialogs.js and register their commands on
    GV.app.cmd.
*/
(function (GV) {
    'use strict';

    var G = GV.geom, UI = GV.ui, R = GV.render, L = GV.layers, S = GV.store;
    var icon = UI.icon, esc = UI.esc, T = UI.t;
    function $(id) { return document.getElementById(id); }

    /* ==================================================================
        Settings and look presets
    ================================================================== */
    var DEFAULTS = {
        units: 'mm',            //mm | in | mil
        decimals: 3,
        theme: 'system',        //system | light | dark
        canvasBg: '#1d1e22',
        grid: false,
        minimap: true,
        crosshair: false,
        snap: true,
        restoreLast: false,
        tips: true,
        defaultOpacity: 0.9,
        mask: 'green',
        silk: 'auto',
        finish: 'enig',
        thickness: 1.6,
        layerColors: {},
        serverArchives: true
    };

    var MASKS = {
        green: { label: 'Green', color: '#0e6b34', alpha: 0.86, silk: '#f2f2f2' },
        red: { label: 'Red', color: '#a3121c', alpha: 0.88, silk: '#f2f2f2' },
        blue: { label: 'Blue', color: '#143c94', alpha: 0.88, silk: '#f2f2f2' },
        black: { label: 'Black', color: '#141414', alpha: 0.94, silk: '#f2f2f2' },
        matte: { label: 'Matte black', color: '#232323', alpha: 0.97, silk: '#e6e6e6' },
        white: { label: 'White', color: '#ececec', alpha: 0.95, silk: '#141414' },
        purple: { label: 'Purple', color: '#4d1f78', alpha: 0.9, silk: '#f2f2f2' },
        yellow: { label: 'Yellow', color: '#c9a300', alpha: 0.9, silk: '#141414' },
        none: { label: 'None (bare board)', color: null, alpha: 0, silk: '#f2f2f2' }
    };
    var SILKS = { auto: 'Automatic', white: '#f2f2f2', black: '#141414', yellow: '#f2d21b' };
    var FINISHES = {
        enig: { label: 'ENIG (gold)', color: '#d9b45c' },
        hasl: { label: 'HASL (silver)', color: '#c8ccd1' },
        osp: { label: 'OSP / bare copper', color: '#c98048' }
    };
    var BACKGROUNDS = [
        { label: 'Graphite', color: '#1d1e22' },
        { label: 'Black', color: '#000000' },
        { label: 'Midnight', color: '#0f1726' },
        { label: 'Slate', color: '#2a2d33' },
        { label: 'Paper', color: '#f3f3f1' }
    ];
    var PALETTE = ['#e5484d', '#f97316', '#f2b84b', '#eab308', '#84cc16', '#3fae6a', '#14b8a6', '#22d3ee',
        '#3b74e8', '#6366f1', '#9b5de5', '#ec4899', '#f4f4f5', '#a1a1aa', '#c98048', '#d9b45c'];

    var TIPS = [
        'Drag layers in the list to change the drawing order. The top of the list is drawn on top.',
        'Click a colour swatch to change a layer\'s colour and opacity.',
        'Press M to measure. Measurements snap to pads, vias and line end points.',
        'Press P for the realistic board preview and B to look at the bottom side.',
        'Right-click a layer for more options, such as showing only that layer.',
        'Tools > Drill Table lists every drill size with its hole count and plating.',
        'Hold Space and drag to pan with any tool. Double-click empty space to zoom to fit.',
        'Press 3 to see the board in 3D. Board thickness and colours are in Preferences.',
        'Recent projects remember their layer colours, order and visibility.',
        'Click a pad or trace to see its aperture, size and position under Properties.'
    ];

    /* ==================================================================
        State
    ================================================================== */
    var state = {
        settings: Object.assign({}, DEFAULTS),
        project: null,
        selectedLayer: null,    //layer id shown in Properties
        selection: null,        //{layer, item}
        tab: 'layers',
        tool: 'select',
        dim: '2d',
        mode: 'layers',         //layers | realistic
        origin: [0, 0],
        measure: null,          //{a, b, cur}
        cursor: null,           //board coordinates under the mouse
        snapPt: null,
        zoomRect: null,
        marker: null,
        tipIndex: Math.floor(Math.random() * TIPS.length),
        recentKey: null
    };

    var viewer = null;
    var view3d = null;
    var view3dLoading = null;
    var nextLayerId = 1;
    var cmd = {};

    /* ==================================================================
        Formatting helpers
    ================================================================== */
    function unitInfo() {
        var u = state.settings.units;
        if (u === 'in') {
            return { f: 1 / 25.4, label: 'in', dec: Math.max(3, state.settings.decimals + 1) };
        }
        if (u === 'mil') {
            return { f: 1 / 0.0254, label: 'mil', dec: Math.max(0, state.settings.decimals - 2) };
        }
        return { f: 1, label: 'mm', dec: state.settings.decimals };
    }

    function fmtLen(mm, noUnit) {
        var u = unitInfo();
        var v = (mm * u.f).toFixed(u.dec);
        return noUnit ? v : v + ' ' + u.label;
    }

    function fmtXY(x, y) {
        return fmtLen(x - state.origin[0], true) + ', ' + fmtLen(y - state.origin[1]);
    }

    function fmtSize(w, h) {
        var u = unitInfo();
        return (w * u.f).toFixed(Math.min(u.dec, 2)) + ' × ' + (h * u.f).toFixed(Math.min(u.dec, 2)) + ' ' + u.label;
    }

    function fmtBytes(b) {
        if (b < 1024) {
            return b + ' B';
        }
        if (b < 1024 * 1024) {
            return (b / 1024).toFixed(1) + ' KB';
        }
        return (b / 1024 / 1024).toFixed(2) + ' MB';
    }

    function fmtDate(s) {
        if (!s) {
            return '';
        }
        if (typeof s === 'number') {
            var d = new Date(s < 1e12 ? s * 1000 : s);
            if (isNaN(d)) {
                return '';
            }
            var p = function (v) { return (v < 10 ? '0' : '') + v; };
            return d.getFullYear() + '/' + p(d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
        }
        var m = /(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:\D+(\d{1,2}):(\d{2}))?/.exec(String(s));
        if (!m) {
            return String(s);
        }
        var pad = function (v) { return (String(v).length < 2 ? '0' : '') + v; };
        return m[1] + '/' + pad(m[2]) + '/' + pad(m[3]) + (m[4] ? ' ' + pad(m[4]) + ':' + m[5] : '');
    }

    function relTime(t) {
        var d = (Date.now() - t) / 1000;
        if (d < 60) {
            return T('time/now', 'just now');
        }
        if (d < 3600) {
            return T('time/min', '{n} min ago', { n: Math.floor(d / 60) });
        }
        if (d < 86400) {
            return T('time/hour', '{n} h ago', { n: Math.floor(d / 3600) });
        }
        if (d < 86400 * 30) {
            return T('time/day', '{n} d ago', { n: Math.floor(d / 86400) });
        }
        return fmtDate(t).slice(0, 10);
    }

    function nextTick() {
        return new Promise(function (r) { setTimeout(r, 0); });
    }

    function hashStr(s) {
        var h1 = 0x811c9dc5;
        for (var i = 0; i < s.length; i++) {
            h1 ^= s.charCodeAt(i);
            h1 = Math.imul(h1, 0x01000193);
        }
        return (h1 >>> 0).toString(36);
    }

    /* ==================================================================
        Look (realistic colours) and theme
    ================================================================== */
    function look() {
        var s = state.settings;
        var mask = MASKS[s.mask] || MASKS.green;
        var silk = s.silk === 'auto' || !SILKS[s.silk] ? mask.silk : SILKS[s.silk];
        return {
            substrate: '#3c3923',
            copper: '#b8743a',
            mask: mask.color,
            maskAlpha: mask.alpha,
            silk: silk,
            finish: (FINISHES[s.finish] || FINISHES.enig).color,
            edge: '#cbb989'
        };
    }

    function isDarkColor(c) {
        var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(c || '');
        if (!m) {
            return true;
        }
        var l = 0.299 * parseInt(m[1], 16) + 0.587 * parseInt(m[2], 16) + 0.114 * parseInt(m[3], 16);
        return l < 140;
    }

    var systemTheme = 'light';
    function applyTheme() {
        var t = state.settings.theme === 'system' ? systemTheme : state.settings.theme;
        document.body.classList.toggle('dark', t === 'dark');
        document.querySelector('meta[name=theme-color]').setAttribute('content', t === 'dark' ? '#17181b' : '#f4f5f7');
        try {
            ao_module_setWindowTheme(t === 'dark' ? 'dark' : 'white');
        } catch (e) {
            //Not running inside the ArozOS desktop
        }
        document.documentElement.style.setProperty('--stage', state.settings.canvasBg);
    }

    function initTheme() {
        try {
            ao_module_getSystemThemeColor(function (pref) {
                //The preference is stored as "darkTheme" / "whiteTheme"
                systemTheme = (pref === 'darkTheme' || pref === 'dark') ? 'dark' : 'light';
                applyTheme();
            });
            ao_module_onThemeChanged(function (theme) {
                systemTheme = theme === 'dark' ? 'dark' : 'light';
                applyTheme();
            });
        } catch (e) {
            //Standalone page
        }
        if (window.matchMedia && !(typeof ao_module_virtualDesktop !== 'undefined' && ao_module_virtualDesktop)) {
            var mq = window.matchMedia('(prefers-color-scheme: dark)');
            if (mq.matches) {
                systemTheme = 'dark';
            }
        }
        applyTheme();
    }

    /* ==================================================================
        Layers
    ================================================================== */
    function defaultColor(type) {
        var c = state.settings.layerColors && state.settings.layerColors[type];
        return c || L.info(type).color;
    }

    function defaultVisible(type) {
        return /copper|top-silk|outline|drill/.test(type);
    }

    function defaultOpacity(type) {
        var o = state.settings.defaultOpacity;
        if (/mask/.test(type)) {
            return Math.min(o, 0.55);
        }
        if (/paste/.test(type)) {
            return Math.min(o, 0.7);
        }
        if (/silk|outline|drill/.test(type)) {
            return 1;
        }
        return o;
    }

    function sideOf(layer) {
        return L.info(layer.type).side;
    }

    function stackOrder(layer) {
        var o = L.info(layer.type).order;
        if (layer.type === 'inner-copper') {
            o -= (layer.index || 0) * 0.01;
        }
        return o;
    }

    function sortDefault(layers) {
        return layers.slice().sort(function (a, b) {
            return stackOrder(b) - stackOrder(a) || a.name.localeCompare(b.name);
        });
    }

    function makeLayer(f, image, info) {
        var layer = {
            id: nextLayerId++,
            name: f.name,
            path: f.path || '',
            text: f.text,
            size: f.size || f.text.length,
            mtime: f.mtime || 0,
            image: image,
            type: info.type,
            index: info.index,
            plated: info.plated,
            via: info.via,
            label: '',
            color: '',
            opacity: 1,
            visible: true
        };
        applyType(layer, info.type, true);
        return layer;
    }

    //Localised layer name; the English names live in js/layers.js
    function layerLabel(info) {
        if (info.type === 'inner-copper' && info.index) {
            return T('type/inner-n', 'Inner Copper {n}', { n: info.index });
        }
        if (info.type === 'drill') {
            if (info.via) {
                return T('type/drill-via', 'Drill (Vias)');
            }
            if (info.plated === true) {
                return T('type/drill-pth', 'Drill (PTH)');
            }
            if (info.plated === false) {
                return T('type/drill-npth', 'Drill (NPTH)');
            }
        }
        return T('type/' + info.type, L.info(info.type).label);
    }

    //Parser warnings and skip reasons carry codes so they can be translated
    function warningTexts(image) {
        var notes = image.notes || [];
        return image.warnings.map(function (w, i) {
            var n = notes[i];
            return n ? T('warn/' + n.code, w, n.vars) : w;
        });
    }

    function reasonText(s) {
        //"error" reasons are already a message (an exception text)
        return s.code && s.code !== 'error' ? T('skip/' + s.code, s.reason, s.vars) : s.reason;
    }

    function errText(e) {
        if (!e) {
            return '';
        }
        return e.code && e.vars ? T('error/' + e.code, e.message, e.vars) : (e.message || String(e));
    }

    function applyType(layer, type, initial) {
        layer.type = type;
        layer.label = layerLabel({ type: type, index: layer.index, plated: layer.plated, via: layer.via });
        layer.color = defaultColor(type);
        if (initial) {
            layer.visible = defaultVisible(type);
            layer.opacity = defaultOpacity(type);
        }
    }

    function layerById(id) {
        if (!state.project) {
            return null;
        }
        for (var i = 0; i < state.project.layers.length; i++) {
            if (state.project.layers[i].id === id) {
                return state.project.layers[i];
            }
        }
        return null;
    }

    //Draw order, bottom first. Viewing the bottom side reverses the stack of
    //side specific layers while outline / drill / document keep their place.
    function drawOrder() {
        if (!state.project) {
            return [];
        }
        var list = state.project.layers.slice().reverse();
        if (!viewer.view.flip) {
            return list;
        }
        var idx = [], sided = [];
        list.forEach(function (l, i) {
            if (sideOf(l) !== 'all') {
                idx.push(i);
                sided.push(l);
            }
        });
        sided.reverse();
        idx.forEach(function (p, k) { list[p] = sided[k]; });
        return list;
    }

    function projectBounds(visibleOnly) {
        var p = state.project;
        if (!p) {
            return null;
        }
        if (p.board && p.board.source === 'outline') {
            var bb = p.board.bounds.slice();
            var pad = Math.max(bb[2] - bb[0], bb[3] - bb[1]) * 0.02;
            return [bb[0] - pad, bb[1] - pad, bb[2] + pad, bb[3] + pad];
        }
        var b = G.emptyBounds();
        p.layers.forEach(function (l) {
            if ((!visibleOnly || l.visible) && l.image && G.boundsValid(l.image.bounds)) {
                G.unionBounds(b, l.image.bounds);
            }
        });
        return G.boundsValid(b) ? b : (p.board && G.boundsValid(p.board.bounds) ? p.board.bounds : null);
    }

    function layersChanged(opts) {
        opts = opts || {};
        if (opts.rebuildBoard && state.project) {
            state.project.board = GV.board.build(state.project.layers);
            delete state.project.board._paths;
        }
        state.miniCache = null;
        viewer.requestRender();
        scheduleMinimap();
        renderLayerList();
        renderFileInfo();
        if (state.tab === 'props') {
            renderProps();
        }
        if (state.dim === '3d') {
            schedule3D();
        }
        saveStateSoon();
    }

    /* ==================================================================
        Loading
    ================================================================== */
    function showLoading(text) {
        $('loading').hidden = false;
        $('loadingText').textContent = text || T('loading/default', 'Loading...');
    }

    function hideLoading() {
        $('loading').hidden = true;
    }

    function platedHint(name) {
        var n = name.toLowerCase();
        if (/npth|non[_ -]?plated|unplated/.test(n)) {
            return false;
        }
        if (/pth|plated|via/.test(n)) {
            return true;
        }
        return null;
    }

    //"Gerber_<project>_PCB_<board>_<date>.zip" (EasyEDA) -> "<board>"
    function cleanName(name) {
        var n = String(name || '').replace(/\.(zip|7z|tar\.gz|tgz|tar|gz)$/i, '');
        n = n.replace(/^gerbers?[_ -]+/i, '').replace(/[_ -]+\d{4}-\d{2}-\d{2}([_ -]\d{2}-?\d{2}(-?\d{2})?)?$/, '');
        n = n.replace(/[_ -]+(gerbers?|fab(rication)?|cam|output)$/i, '');
        var pcb = /^.+?_PCB_(.+)$/i.exec(n);
        if (pcb) {
            n = pcb[1];
        }
        return n || String(name || T('project/untitled', 'Untitled project'));
    }

    //Parse files into layers. files: [{name, text, path, size, mtime}]
    async function parseFiles(files, skipped) {
        var layers = [];
        for (var i = 0; i < files.length; i++) {
            var f = files[i];
            showLoading(T('loading/reading', 'Reading {name} ({i} of {n})', { name: L.base(f.name), i: i + 1, n: files.length }));
            await nextTick();
            var kind = L.sniff(f.text);
            if (!kind) {
                skipped.push({ name: f.name, code: 'notcam', reason: 'Not a Gerber or drill file' });
                continue;
            }
            var image;
            try {
                image = kind === 'drill' ? GV.excellon.parse(f.text, { plated: platedHint(f.name) }) : GV.gerber.parse(f.text);
            } catch (e) {
                console.error(e);
                skipped.push({ name: f.name, code: 'parse', reason: 'Could not be parsed: ' + e.message, vars: { error: e.message } });
                continue;
            }
            var info = L.identify(f.name, f.text, image);
            layers.push(makeLayer(f, image, info));
        }
        return layers;
    }

    /*
        meta: {name, source: 'aroz'|'local', kind, paths, key, cacheId, skipped, add}
    */
    async function openFiles(files, meta) {
        var skipped = (meta.skipped || []).slice();
        var layers;
        try {
            layers = await parseFiles(files, skipped);
        } finally {
            hideLoading();
        }
        if (!layers.length) {
            reportSkipped(skipped, T('skip/none', 'No Gerber or drill files were found.'));
            return false;
        }
        if (meta.add && state.project) {
            var p = state.project;
            var existing = new Set(p.layers.map(function (l) { return l.name; }));
            layers.forEach(function (l) {
                if (existing.has(l.name)) {
                    l.name = l.name + ' (' + l.id + ')';
                }
            });
            p.layers = sortDefault(p.layers.concat(layers));
            p.fileCount += files.length;
            p.skipped = p.skipped.concat(skipped);
            if (meta.paths) {
                p.paths = (p.paths || []).concat(meta.paths);
            }
            p.added = true;
            layersChanged({ rebuildBoard: true });
            UI.toast(layers.length === 1 ? T('toast/addedOne', 'Added 1 layer') : T('toast/added', 'Added {n} layers', { n: layers.length }), { icon: 'check' });
            if (skipped.length) {
                reportSkipped(skipped);
            }
            updateRecentAfterAdd();
            return true;
        }

        var project = {
            name: meta.name || T('project/untitled', 'Untitled project'),
            source: meta.source,
            kind: meta.kind || 'files',
            paths: meta.paths || [],
            key: meta.key,
            cacheId: meta.cacheId || '',
            layers: sortDefault(layers),
            skipped: skipped,
            fileCount: files.length + (meta.skipped || []).length,
            loadedAt: Date.now()
        };
        var created = layers.map(function (l) { return l.image.created; }).filter(Boolean);
        project.created = created.length ? created[0] : (files[0] && files[0].mtime ? files[0].mtime : '');
        var gens = layers.map(function (l) { return l.image.generator; }).filter(Boolean);
        project.generator = gens.length ? gens[0] : '';
        project.board = GV.board.build(project.layers);

        var saved = S.recent.filter(function (e) { return e.key === project.key; })[0];
        setProject(project, saved && saved.state);
        if (skipped.length && skipped.some(function (s) { return s.code ? s.code !== 'notcam' : !/Not a Gerber/.test(s.reason); })) {
            reportSkipped(skipped);
        }
        addRecent(project);
        return true;
    }

    function reportSkipped(skipped, title) {
        if (!skipped.length) {
            if (title) {
                UI.toast(title, { type: 'error' });
            }
            return;
        }
        UI.dialog({
            title: title || T('skip/title', 'Some files were skipped'),
            icon: 'warning',
            width: 520,
            body: '<ul class="list-plain warn-list">' + skipped.map(function (s) {
                return '<li><b>' + esc(s.name) + '</b> <span class="muted">' + esc(reasonText(s)) + '</span></li>';
            }).join('') + '</ul>',
            buttons: [{ label: T('common/ok', 'OK'), primary: true }]
        });
    }

    /* ---------------- From ArozOS (AGI) ---------------- */
    function arozAvailable() {
        return S.online;
    }

    async function openFromAroz(paths, opts) {
        opts = opts || {};
        if (!paths || !paths.length) {
            return;
        }
        showLoading(T('loading/aroz', 'Reading from ArozOS...'));
        var res;
        try {
            res = await S.agi('project.agi', { opr: 'open', paths: JSON.stringify(paths) });
        } catch (e) {
            hideLoading();
            //Fall back to fetching the raw files and unpacking them here
            try {
                res = await fetchViaMedia(paths);
            } catch (e2) {
                UI.toast(T('toast/openFailed', 'Unable to open: {error}', { error: errText(e) }), { type: 'error' });
                return;
            }
        }
        var files = (res.files || []).map(function (f) {
            return { name: f.name, text: f.content, path: f.path, size: f.size, mtime: f.mtime };
        });
        if (!files.length) {
            hideLoading();
            reportSkipped(res.skipped || [], T('skip/none', 'No Gerber or drill files were found.'));
            return;
        }
        var kind = paths.length === 1 ? (/\.(zip|7z|tar|tgz|gz)$/i.test(paths[0]) ? 'archive' : (files.length > 1 ? 'folder' : 'file')) : 'files';
        var ok = await openFiles(files, {
            name: kind === 'file' ? L.base(paths[0]) : cleanName(res.name || L.base(paths[0])),
            source: 'aroz',
            kind: kind,
            paths: paths,
            key: 'aroz:' + paths.slice().sort().join('|'),
            skipped: res.skipped || [],
            add: opts.add
        });
        if (ok && !opts.add && paths.length === 1 && kind === 'file') {
            offerSiblings(paths[0]);
        }
    }

    //Without the AGI backend, read the files through the media endpoint
    async function fetchViaMedia(paths) {
        var out = { name: L.base(paths[0]), files: [], skipped: [] };
        for (var i = 0; i < paths.length; i++) {
            var p = paths[i];
            var r = await fetch(ao_root + 'media?file=' + encodeURIComponent(p));
            if (!r.ok) {
                throw new Error(T('error/read', 'Cannot read {name}', { name: L.base(p) }));
            }
            var buf = new Uint8Array(await r.arrayBuffer());
            if (GV.zip.isZip(buf)) {
                var got = await unzipToFiles(buf, out.skipped);
                got.forEach(function (f) { f.path = p + '#' + f.name; });
                out.files = out.files.concat(got.map(function (f) { return { name: f.name, content: f.text, path: f.path, size: f.size }; }));
            } else {
                out.files.push({ name: L.base(p), content: new TextDecoder().decode(buf), path: p, size: buf.length });
            }
        }
        return out;
    }

    async function offerSiblings(path) {
        try {
            var list = await S.agi('project.agi', { opr: 'siblings', path: path });
            if (list && list.length) {
                UI.toast(list.length === 1 ? T('toast/sibling', '1 more Gerber / drill file is in this folder.') :
                    T('toast/siblings', '{n} more Gerber / drill files are in this folder.', { n: list.length }), {
                    icon: 'layers',
                    action: {
                        label: T('toast/loadAll', 'Load all'),
                        fn: function () {
                            //Open the folder itself so the project is named after it
                            openFromAroz([path.slice(0, path.lastIndexOf('/'))]);
                        }
                    }
                });
            }
        } catch (e) {
            //Not important
        }
    }

    cmd.openAroz = function () {
        if (!arozAvailable()) {
            UI.toast(T('toast/offline', 'ArozOS is not reachable. Use Open from This Device instead.'), { type: 'error' });
            return;
        }
        ao_module_openFileSelector(function (files) {
            if (files && files.length) {
                openFromAroz(files.map(function (f) { return f.filepath; }));
            }
        }, 'user:/', 'file', true, { path_memory_key: 'open' });
    };

    cmd.openArozFolder = function () {
        if (!arozAvailable()) {
            return;
        }
        ao_module_openFileSelector(function (files) {
            if (files && files.length) {
                openFromAroz([files[0].filepath]);
            }
        }, 'user:/', 'folder', false, { path_memory_key: 'open' });
    };

    cmd.addAroz = function () {
        if (!arozAvailable() || !state.project) {
            return;
        }
        ao_module_openFileSelector(function (files) {
            if (files && files.length) {
                openFromAroz(files.map(function (f) { return f.filepath; }), { add: true });
            }
        }, 'user:/', 'file', true, { path_memory_key: 'add' });
    };

    /* ---------------- From the local device ---------------- */
    async function unzipToFiles(buf, skipped) {
        var zip = GV.zip.list(buf);
        var out = [];
        for (var i = 0; i < zip.entries.length; i++) {
            var e = zip.entries[i];
            if (e.dir) {
                continue;
            }
            if (!L.isCandidate(e.name)) {
                if (!/(^|\/)(\.|__MACOSX)/.test(e.name)) {
                    skipped.push({ name: e.name, code: 'notcam', reason: 'Not a Gerber or drill file' });
                }
                continue;
            }
            if (e.size > 32 * 1024 * 1024) {
                skipped.push({ name: e.name, code: 'toolarge', reason: 'File is larger than 32 MB' });
                continue;
            }
            showLoading(T('loading/unpack', 'Unpacking {name}', { name: L.base(e.name) }));
            try {
                var data = await GV.zip.extract(zip, e);
                out.push({ name: e.name, text: new TextDecoder().decode(data), size: data.length });
            } catch (err) {
                skipped.push({ name: e.name, code: 'error', reason: errText(err), vars: { error: errText(err) } });
            }
        }
        return out;
    }

    //files: [{file: File, rel: 'folder/name'}]
    async function openLocal(entries, opts) {
        opts = opts || {};
        if (!entries.length) {
            return;
        }
        showLoading(T('loading/files', 'Reading files...'));
        var files = [], skipped = [];
        var zips = 0;
        try {
            for (var i = 0; i < entries.length; i++) {
                var f = entries[i].file;
                var rel = entries[i].rel || f.name;
                var lower = f.name.toLowerCase();
                if (/\.(7z|rar|tar|tgz|gz)$/.test(lower)) {
                    skipped.push({ name: rel, code: 'ziponly', reason: 'Only zip archives can be opened from this device' });
                    continue;
                }
                if (/\.zip$/.test(lower)) {
                    zips++;
                    var got = await unzipToFiles(await f.arrayBuffer(), skipped);
                    got.forEach(function (g) {
                        g.mtime = f.lastModified;
                        files.push(g);
                    });
                    continue;
                }
                if (!L.isCandidate(f.name)) {
                    skipped.push({ name: rel, code: 'notcam', reason: 'Not a Gerber or drill file' });
                    continue;
                }
                if (f.size > 32 * 1024 * 1024) {
                    skipped.push({ name: rel, code: 'toolarge', reason: 'File is larger than 32 MB' });
                    continue;
                }
                files.push({ name: rel, text: await f.text(), size: f.size, mtime: f.lastModified });
            }
        } catch (e) {
            hideLoading();
            UI.toast(T('toast/readFailed', 'Unable to read the files: {error}', { error: errText(e) }), { type: 'error' });
            return;
        }
        var first = entries[0];
        var name;
        if (entries.length === 1 && zips === 1) {
            name = first.file.name;
        } else if (first.rel && first.rel.indexOf('/') > 0) {
            name = first.rel.split('/')[0];
        } else {
            name = commonPrefix(entries.map(function (e) { return e.file.name; })) || first.file.name;
        }
        name = cleanName(name);
        var key = 'local:' + hashStr(entries.map(function (e) { return (e.rel || e.file.name) + ':' + e.file.size; }).sort().join('|'));
        var total = files.reduce(function (s, f) { return s + f.text.length; }, 0);
        var cacheId = '';
        if (!opts.add && files.length && total <= 40 * 1024 * 1024) {
            cacheId = 'p_' + key.slice(6);
            S.cachePut(cacheId, { name: name, files: files, skipped: skipped, time: Date.now() });
        }
        await openFiles(files, {
            name: name,
            source: 'local',
            kind: zips === 1 && entries.length === 1 ? 'archive' : (first.rel && first.rel.indexOf('/') > 0 ? 'folder' : 'files'),
            key: key,
            cacheId: cacheId,
            skipped: skipped,
            add: opts.add
        });
    }

    function commonPrefix(names) {
        if (!names.length) {
            return '';
        }
        var p = names[0];
        names.forEach(function (n) {
            while (n.indexOf(p) !== 0) {
                p = p.slice(0, -1);
            }
        });
        p = p.replace(/[-_. ]+$/, '');
        return p.length >= 3 ? p : '';
    }

    var localAddMode = false;
    cmd.openLocal = function () {
        localAddMode = false;
        $('fileInput').value = '';
        $('fileInput').click();
    };
    cmd.openLocalFolder = function () {
        localAddMode = false;
        $('folderInput').value = '';
        $('folderInput').click();
    };
    cmd.addLocal = function () {
        if (!state.project) {
            return;
        }
        localAddMode = true;
        $('fileInput').value = '';
        $('fileInput').click();
    };

    function bindFileInputs() {
        $('fileInput').addEventListener('change', function () {
            var list = Array.prototype.map.call(this.files, function (f) { return { file: f, rel: f.name }; });
            openLocal(list, { add: localAddMode });
        });
        $('folderInput').addEventListener('change', function () {
            var list = Array.prototype.map.call(this.files, function (f) { return { file: f, rel: f.webkitRelativePath || f.name }; });
            openLocal(list, { add: false });
        });
    }

    /* ---------------- Drag and drop ---------------- */
    function readEntry(entry, prefix, out) {
        return new Promise(function (resolve) {
            if (entry.isFile) {
                entry.file(function (f) {
                    out.push({ file: f, rel: prefix + f.name });
                    resolve();
                }, function () { resolve(); });
            } else if (entry.isDirectory) {
                var reader = entry.createReader();
                var all = [];
                (function more() {
                    reader.readEntries(function (batch) {
                        if (!batch.length) {
                            Promise.all(all.map(function (e) {
                                return readEntry(e, prefix + entry.name + '/', out);
                            })).then(resolve);
                            return;
                        }
                        all = all.concat(Array.prototype.slice.call(batch));
                        more();
                    }, function () { resolve(); });
                })();
            } else {
                resolve();
            }
        });
    }

    function bindDrop() {
        var depth = 0;
        function hasPayload(e) {
            var t = e.dataTransfer && e.dataTransfer.types;
            return t && (Array.prototype.indexOf.call(t, 'Files') >= 0 || Array.prototype.indexOf.call(t, 'filedata') >= 0);
        }
        document.addEventListener('dragenter', function (e) {
            if (!hasPayload(e)) {
                return;
            }
            depth++;
            $('dropHint').hidden = false;
        });
        document.addEventListener('dragleave', function () {
            depth = Math.max(0, depth - 1);
            if (!depth) {
                $('dropHint').hidden = true;
            }
        });
        document.addEventListener('dragover', function (e) {
            if (hasPayload(e)) {
                e.preventDefault();
            }
        });
        document.addEventListener('drop', function (e) {
            if (!hasPayload(e)) {
                return;
            }
            e.preventDefault();
            depth = 0;
            $('dropHint').hidden = true;
            var add = !!state.project && e.shiftKey;
            //From the ArozOS file manager: only paths are carried
            var aroz = null;
            try {
                aroz = ao_module_utils.getDropFileInfo(e);
            } catch (err) {
                aroz = null;
            }
            if (aroz && aroz.length) {
                openFromAroz(aroz.map(function (f) { return f.filepath; }), { add: add });
                return;
            }
            var items = e.dataTransfer.items;
            var entries = [];
            if (items && items.length && items[0].webkitGetAsEntry) {
                var roots = [];
                for (var i = 0; i < items.length; i++) {
                    var en = items[i].webkitGetAsEntry && items[i].webkitGetAsEntry();
                    if (en) {
                        roots.push(en);
                    }
                }
                if (roots.length) {
                    Promise.all(roots.map(function (r) { return readEntry(r, '', entries); })).then(function () {
                        openLocal(entries, { add: add });
                    });
                    return;
                }
            }
            Array.prototype.forEach.call(e.dataTransfer.files, function (f) { entries.push({ file: f, rel: f.name }); });
            openLocal(entries, { add: add });
        });
    }

    /* ==================================================================
        Project lifecycle
    ================================================================== */
    function setProject(p, saved) {
        state.project = p;
        state.selection = null;
        state.measure = null;
        state.marker = null;
        state.origin = [0, 0];
        state.selectedLayer = null;
        state.miniCache = null;
        viewer.view.rot = 0;
        viewer.view.flip = false;
        state.mode = 'layers';
        if (saved) {
            applySavedState(saved);
        }
        $('emptyState').hidden = true;
        updateTitle();
        renderLayerList();
        renderFileInfo();
        renderProps();
        updateToolbar();
        nextTip();
        viewer.resize();
        cmd.fit();
        renderMinimap();
        if (state.dim === '3d') {
            schedule3D();
        }
    }

    cmd.close = function () {
        if (!state.project) {
            return;
        }
        state.project = null;
        state.selection = null;
        state.measure = null;
        state.miniCache = null;
        if (state.dim === '3d') {
            setDim('2d');
        }
        $('emptyState').hidden = false;
        renderRecentGrid();
        updateTitle();
        renderLayerList();
        renderFileInfo();
        renderProps();
        updateToolbar();
        viewer.requestRender();
        renderMinimap();
    };

    cmd.reload = async function () {
        var p = state.project;
        if (!p) {
            return;
        }
        if (p.source === 'aroz' && p.paths.length) {
            await openFromAroz(p.paths);
        } else if (p.cacheId) {
            await openRecent({ key: p.key, source: 'local', cacheId: p.cacheId, name: p.name });
        } else {
            UI.toast(T('toast/noReload', 'This project cannot be reloaded. Open the files again.'), { type: 'error' });
        }
    };

    function updateTitle() {
        var p = state.project;
        var appName = T('app/title', 'Gerber Viewer');
        $('projectName').textContent = p ? p.name : appName;
        $('projectBadge').textContent = p ? T('badge/project', 'Gerber Project') : T('badge/none', 'No Project');
        $('projectName').title = p ? p.name : '';
        try {
            ao_module_setWindowTitle(p ? appName + ' - ' + p.name : appName);
        } catch (e) {
            document.title = p ? p.name + ' - ' + appName : appName;
        }
        var st = '';
        if (p) {
            st = T('status/layers', '{n} layers', { n: p.layers.length });
            if (p.board && p.board.width) {
                st += ' · ' + fmtSize(p.board.width, p.board.height);
            }
        }
        $('mbStatus').textContent = st;
    }

    /* ---------------- Saved layer state ---------------- */
    function collectState() {
        var p = state.project;
        var layers = {};
        p.layers.forEach(function (l) {
            layers[l.name] = { c: l.color, o: Math.round(l.opacity * 100) / 100, v: l.visible ? 1 : 0, t: l.type };
        });
        return {
            order: p.layers.map(function (l) { return l.name; }),
            layers: layers,
            mode: state.mode,
            flip: viewer.view.flip ? 1 : 0,
            rot: viewer.view.rot
        };
    }

    function applySavedState(st) {
        var p = state.project;
        if (!st || !st.layers) {
            return;
        }
        p.layers.forEach(function (l) {
            var s = st.layers[l.name];
            if (!s) {
                return;
            }
            if (s.t && s.t !== l.type && L.TYPES[s.t]) {
                applyType(l, s.t, false);
            }
            if (s.c) {
                l.color = s.c;
            }
            if (typeof s.o === 'number') {
                l.opacity = Math.max(0.05, Math.min(1, s.o));
            }
            if (s.v !== undefined) {
                l.visible = !!s.v;
            }
        });
        if (Array.isArray(st.order)) {
            var pos = {};
            st.order.forEach(function (n, i) { pos[n] = i; });
            p.layers.sort(function (a, b) {
                var pa = pos[a.name] !== undefined ? pos[a.name] : 1000 - stackOrder(a);
                var pb = pos[b.name] !== undefined ? pos[b.name] : 1000 - stackOrder(b);
                return pa - pb;
            });
        }
        p.board = GV.board.build(p.layers);
        state.mode = st.mode === 'realistic' ? 'realistic' : 'layers';
        viewer.view.flip = !!st.flip;
        viewer.view.rot = [0, 90, 180, 270].indexOf(st.rot) >= 0 ? st.rot : 0;
    }

    var saveTimer = 0;
    function saveStateSoon() {
        if (!state.project || !state.project.key) {
            return;
        }
        clearTimeout(saveTimer);
        var key = state.project.key;
        saveTimer = setTimeout(function () {
            if (state.project && state.project.key === key) {
                S.recentUpdate(key, { state: collectState() });
            }
        }, 1200);
    }

    /* ---------------- Recents ---------------- */
    function thumbnail(p) {
        try {
            var b = projectBounds(false);
            if (!b) {
                return '';
            }
            var W = 240, H = 140;
            var scale = Math.min((W - 12) / (b[2] - b[0]), (H - 12) / (b[3] - b[1]));
            var realistic = p.board && p.board.source !== 'none' && p.layers.some(function (l) { return /copper/.test(l.type); });
            var cv = R.renderToCanvas({
                mode: realistic ? 'realistic' : 'layers',
                side: 'top',
                layers: p.layers.slice().reverse(),
                all: p.layers,
                board: p.board,
                background: '#141518',
                look: look()
            }, { cx: (b[0] + b[2]) / 2, cy: (b[1] + b[3]) / 2, scale: scale, rot: 0, flip: false }, W, H);
            return cv.toDataURL('image/jpeg', 0.82);
        } catch (e) {
            return '';
        }
    }

    function recentEntry(p) {
        return {
            key: p.key,
            name: p.name,
            source: p.source,
            kind: p.kind,
            paths: p.paths || [],
            cacheId: p.cacheId || '',
            time: Date.now(),
            layers: p.layers.length,
            size: p.board && p.board.width ? fmtSize(p.board.width, p.board.height) : '',
            thumb: thumbnail(p),
            state: collectState()
        };
    }

    function addRecent(p) {
        if (!p.key) {
            return;
        }
        if (p.source === 'local' && !p.cacheId) {
            return;
        }
        S.recentAdd(recentEntry(p)).then(function () {
            S.cachePrune();
            renderRecentGrid();
        }).catch(function () { });
    }

    function updateRecentAfterAdd() {
        var p = state.project;
        if (p && p.key && p.source === 'aroz') {
            //The project now spans more paths; store it under the new path set
            var oldKey = p.key;
            p.key = 'aroz:' + p.paths.slice().sort().join('|');
            if (oldKey !== p.key) {
                addRecent(p);
            }
        }
    }

    async function openRecent(entry) {
        if (entry.source === 'aroz') {
            if (!arozAvailable()) {
                UI.toast(T('toast/offlineShort', 'ArozOS is not reachable.'), { type: 'error' });
                return;
            }
            await openFromAroz(entry.paths);
            return;
        }
        showLoading(T('loading/opening', 'Opening {name}...', { name: entry.name }));
        var cached = entry.cacheId ? await S.cacheGet(entry.cacheId) : null;
        if (!cached) {
            hideLoading();
            UI.toast(T('toast/notCached', '"{name}" was opened from a device and is not cached in this browser. Open it again.', { name: entry.name }), { type: 'error', timeout: 6000 });
            return;
        }
        await openFiles(cached.files, {
            name: entry.name,
            source: 'local',
            kind: entry.kind,
            key: entry.key,
            cacheId: entry.cacheId,
            skipped: cached.skipped || []
        });
    }

    function recentMenu() {
        var items = S.recent.slice(0, 12).map(function (e) {
            return {
                label: e.name,
                icon: e.source === 'aroz' ? 'drive' : 'laptop',
                title: e.source === 'aroz' ? e.paths.join('\n') : T('recent/device', 'Opened from this device'),
                action: function () { openRecent(e); }
            };
        });
        if (!items.length) {
            items.push({ empty: T('recent/none', 'No recent projects') });
        }
        items.push({ sep: true });
        items.push({ label: T('menu/clearRecent', 'Clear Recent Projects'), icon: 'trash', enabled: S.recent.length > 0, action: cmd.clearRecent });
        return items;
    }

    cmd.clearRecent = function () {
        UI.confirm(T('confirm/clearRecent', 'Clear recent projects'), T('confirm/clearRecentText', 'Remove every project from the recent list?'), T('common/clear', 'Clear')).then(function (ok) {
            if (ok) {
                S.recentClear().then(renderRecentGrid);
            }
        });
    };

    function renderRecentGrid() {
        var grid = $('esRecentGrid');
        var list = S.recent.slice(0, 12);
        $('esRecent').hidden = list.length === 0;
        grid.innerHTML = '';
        list.forEach(function (e) {
            var card = UI.h('div', { class: 'rcard', title: e.source === 'aroz' ? e.paths.join('\n') : T('recent/device', 'Opened from this device') });
            card.innerHTML =
                '<div class="rthumb"' + (e.thumb ? ' style="background-image:url(' + e.thumb + ')"' : '') + '>' + (e.thumb ? '' : icon('board')) + '</div>' +
                '<div class="rbody"><div class="rname">' + esc(e.name) + '</div>' +
                '<div class="rmeta">' + icon(e.source === 'aroz' ? 'drive' : 'laptop') + '<span>' +
                esc((e.layers ? T('status/layers', '{n} layers', { n: e.layers }) + ' · ' : '') + relTime(e.time)) + '</span></div></div>' +
                '<button class="rdel" title="' + esc(T('recent/remove', 'Remove from list')) + '">' + icon('close') + '</button>';
            card.addEventListener('click', function (ev) {
                if (ev.target.closest('.rdel')) {
                    ev.stopPropagation();
                    S.recentRemove(e.key).then(renderRecentGrid);
                    return;
                }
                openRecent(e);
            });
            grid.appendChild(card);
        });
    }

    /* ==================================================================
        Side panel: layer list
    ================================================================== */
    var dragId = null;

    function renderLayerList() {
        var ul = $('layerList');
        ul.innerHTML = '';
        var p = state.project;
        $('layerEmpty').hidden = !!(p && p.layers.length);
        if (!p) {
            return;
        }
        p.layers.forEach(function (l) {
            var li = UI.h('li', {
                class: 'layer' + (l.visible ? '' : ' hiddenlayer') + (state.selectedLayer === l.id ? ' selected' : ''),
                draggable: 'true',
                title: l.name
            });
            li.dataset.id = l.id;
            var warn = l.image.warnings.length ? '<span class="warnmark" title="' + esc(warningTexts(l.image).join('\n')) + '">' + icon('warning') + '</span>' : '';
            li.innerHTML = '<span class="grip">' + icon('grip') + '</span>' +
                '<button class="swatch" style="--c:' + esc(l.color) + ';opacity:' + Math.max(0.35, l.opacity) + '" title="' + esc(T('layer/colourTitle', 'Colour and opacity')) + '"></button>' +
                '<span class="lname"><span>' + esc(l.label) + '</span><small>' + esc(L.base(l.name)) + '</small></span>' + warn +
                '<button class="iconbtn eye" title="' + esc(l.visible ? T('layer/hide', 'Hide layer') : T('layer/show', 'Show layer')) + '">' + icon(l.visible ? 'eye' : 'eye-off') + '</button>';
            li.querySelector('.eye').addEventListener('click', function (e) {
                e.stopPropagation();
                l.visible = !l.visible;
                layersChanged();
            });
            li.querySelector('.swatch').addEventListener('click', function (e) {
                e.stopPropagation();
                colorPopover(this, l);
            });
            li.addEventListener('click', function () {
                selectLayer(l.id, true);
            });
            li.addEventListener('dblclick', function () {
                selectLayer(l.id, true);
                setTab('props');
            });
            li.addEventListener('contextmenu', function (e) {
                e.preventDefault();
                selectLayer(l.id, false);
                UI.contextMenu(layerContextItems(l), e.clientX, e.clientY);
            });
            li.addEventListener('dragstart', function (e) {
                dragId = l.id;
                li.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', 'layer');
            });
            li.addEventListener('dragend', function () {
                dragId = null;
                li.classList.remove('dragging');
                clearDropMarks();
            });
            li.addEventListener('dragover', function (e) {
                if (dragId === null) {
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                var r = li.getBoundingClientRect();
                var before = e.clientY < r.top + r.height / 2;
                clearDropMarks();
                li.classList.add(before ? 'drop-before' : 'drop-after');
            });
            li.addEventListener('drop', function (e) {
                if (dragId === null) {
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                var before = li.classList.contains('drop-before');
                clearDropMarks();
                moveLayer(dragId, l.id, before);
            });
            ul.appendChild(li);
        });
    }

    function clearDropMarks() {
        Array.prototype.forEach.call(document.querySelectorAll('.drop-before,.drop-after'), function (n) {
            n.classList.remove('drop-before', 'drop-after');
        });
    }

    function moveLayer(id, targetId, before) {
        var list = state.project.layers;
        var from = list.findIndex(function (l) { return l.id === id; });
        if (from < 0 || id === targetId) {
            return;
        }
        var moving = list.splice(from, 1)[0];
        var to = list.findIndex(function (l) { return l.id === targetId; });
        list.splice(before ? to : to + 1, 0, moving);
        layersChanged();
    }

    function moveBy(layer, d) {
        var list = state.project.layers;
        var i = list.indexOf(layer);
        var j = i + d;
        if (j < 0 || j >= list.length) {
            return;
        }
        list.splice(i, 1);
        list.splice(j, 0, layer);
        layersChanged();
    }

    function selectLayer(id, toggle) {
        state.selectedLayer = toggle && state.selectedLayer === id ? null : id;
        if (state.selectedLayer !== null) {
            state.selection = null;
            viewer.renderOverlay();
        }
        renderLayerList();
        renderProps();
    }

    function layerContextItems(l) {
        return [
            { header: l.label },
            { label: T('menu/showOnly', 'Show Only This Layer'), icon: 'eye', action: function () { solo(l); } },
            { label: l.visible ? T('menu/hideLayer', 'Hide Layer') : T('menu/showLayer', 'Show Layer'), icon: l.visible ? 'eye-off' : 'eye', action: function () { l.visible = !l.visible; layersChanged(); } },
            { label: T('menu/colour', 'Colour and Opacity...'), icon: 'palette', action: function () { colorPopover(document.querySelector('.layer[data-id="' + l.id + '"] .swatch') || $('layerList'), l); } },
            { label: T('menu/layerType', 'Layer Type'), icon: 'layers', submenu: function () { return typeMenu(l); } },
            { sep: true },
            { label: T('menu/moveUp', 'Move Up'), enabled: state.project.layers.indexOf(l) > 0, action: function () { moveBy(l, -1); } },
            { label: T('menu/moveDown', 'Move Down'), enabled: state.project.layers.indexOf(l) < state.project.layers.length - 1, action: function () { moveBy(l, 1); } },
            { label: T('menu/zoomLayer', 'Zoom to Layer'), icon: 'fit', action: function () { zoomToBounds(l.image.bounds); } },
            { sep: true },
            { label: T('menu/properties', 'Properties'), icon: 'info', action: function () { selectLayer(l.id, false); setTab('props'); } },
            { label: T('menu/viewSource', 'View Source...'), icon: 'code', action: function () { cmd.viewSource(l); } },
            { label: T('menu/apertureTable', 'Aperture Table...'), icon: 'table', enabled: l.image.kind === 'gerber', action: function () { cmd.apertureTable(l); } },
            { label: T('menu/reloadLayer', 'Reload Layer'), icon: 'refresh', enabled: !!l.path && state.project.source === 'aroz' && l.path.indexOf('#') < 0, action: function () { reloadLayer(l); } },
            { label: T('menu/removeLayer', 'Remove Layer'), icon: 'trash', action: function () { removeLayer(l); } }
        ];
    }

    function typeMenu(l) {
        return L.TYPE_LIST.map(function (t) {
            return {
                label: layerLabel({ type: t, index: l.index, plated: l.plated, via: l.via }),
                swatch: defaultColor(t),
                checked: l.type === t,
                action: function () { setLayerType(l, t); }
            };
        });
    }

    function setLayerType(l, t) {
        if (l.type === t) {
            return;
        }
        if (t === 'drill' && l.image.kind !== 'drill') {
            //A Gerber drill map can still be shown as the drill layer
        }
        applyType(l, t, false);
        layersChanged({ rebuildBoard: true });
    }

    function solo(l) {
        state.project.layers.forEach(function (x) { x.visible = x === l; });
        layersChanged();
    }

    function removeLayer(l) {
        var p = state.project;
        p.layers.splice(p.layers.indexOf(l), 1);
        if (state.selectedLayer === l.id) {
            state.selectedLayer = null;
        }
        if (state.selection && state.selection.layer === l) {
            state.selection = null;
        }
        if (!p.layers.length) {
            cmd.close();
            return;
        }
        layersChanged({ rebuildBoard: true });
        updateTitle();
    }

    async function reloadLayer(l) {
        try {
            showLoading(T('loading/reloading', 'Reloading {name}', { name: L.base(l.name) }));
            var f = await S.agi('project.agi', { opr: 'read', path: l.path });
            var kind = L.sniff(f.content);
            l.image = kind === 'drill' ? GV.excellon.parse(f.content, { plated: platedHint(l.name) }) : GV.gerber.parse(f.content);
            l.text = f.content;
            l.size = f.size;
            l.mtime = f.mtime;
            delete l._paths;
            delete l._snap;
            hideLoading();
            layersChanged({ rebuildBoard: true });
            UI.toast(T('toast/reloaded', 'Reloaded {name}', { name: l.label }), { icon: 'check' });
        } catch (e) {
            hideLoading();
            UI.toast(T('toast/reloadFailed', 'Unable to reload: {error}', { error: errText(e) }), { type: 'error' });
        }
    }

    function colorPopover(anchor, l) {
        var box = UI.h('div');
        box.innerHTML = '<div class="pop-title">' + esc(l.label) + '</div>' +
            '<div class="swatches">' + PALETTE.map(function (c) {
                return '<button style="--c:' + c + '" data-c="' + c + '" class="' + (c.toLowerCase() === l.color.toLowerCase() ? 'active' : '') + '"></button>';
            }).join('') + '</div>' +
            '<div class="pop-row"><span>' + esc(T('colour/custom', 'Custom')) + '</span><input type="color" value="' + esc(toHex6(l.color)) + '">' +
            '<button class="btn small" data-reset>' + esc(T('common/reset', 'Reset')) + '</button></div>' +
            '<div class="pop-row"><span>' + esc(T('colour/opacity', 'Opacity')) + '</span><input type="range" min="5" max="100" value="' + Math.round(l.opacity * 100) + '"><b class="op">' + Math.round(l.opacity * 100) + '%</b></div>';
        box.querySelectorAll('.swatches button').forEach(function (b) {
            b.addEventListener('click', function () {
                l.color = b.dataset.c;
                box.querySelectorAll('.swatches button').forEach(function (x) { x.classList.toggle('active', x === b); });
                box.querySelector('input[type=color]').value = l.color;
                layersChanged();
            });
        });
        box.querySelector('input[type=color]').addEventListener('input', function () {
            l.color = this.value;
            layersChanged();
        });
        box.querySelector('[data-reset]').addEventListener('click', function () {
            l.color = defaultColor(l.type);
            l.opacity = defaultOpacity(l.type);
            box.querySelector('input[type=color]').value = toHex6(l.color);
            box.querySelector('input[type=range]').value = Math.round(l.opacity * 100);
            box.querySelector('.op').textContent = Math.round(l.opacity * 100) + '%';
            layersChanged();
        });
        box.querySelector('input[type=range]').addEventListener('input', function () {
            l.opacity = this.value / 100;
            box.querySelector('.op').textContent = this.value + '%';
            layersChanged();
        });
        UI.popover(anchor, box);
    }

    function toHex6(c) {
        if (/^#[0-9a-f]{6}$/i.test(c)) {
            return c;
        }
        var cv = document.createElement('canvas').getContext('2d');
        cv.fillStyle = c;
        return cv.fillStyle;
    }

    /* ==================================================================
        Side panel: file information, properties, tips
    ================================================================== */
    function kv(rows) {
        return rows.filter(function (r) { return r && r[1] !== undefined && r[1] !== null && r[1] !== ''; }).map(function (r) {
            return '<dt>' + esc(r[0]) + '</dt><dd' + (r[2] ? ' class="mono"' : '') + '>' + (r[3] ? r[1] : esc(r[1])) + '</dd>';
        }).join('');
    }

    function formatLabel(p) {
        var x2 = p.layers.some(function (l) { return l.image.kind === 'gerber' && l.image.x2; });
        var drill = p.layers.some(function (l) { return l.image.kind === 'drill'; });
        var gerber = p.layers.some(function (l) { return l.image.kind === 'gerber'; });
        var parts = [];
        if (gerber) {
            parts.push(x2 ? 'Gerber X2' : 'Gerber RS-274X');
        }
        if (drill) {
            parts.push('Excellon');
        }
        return parts.join(' + ');
    }

    function renderFileInfo() {
        var p = state.project;
        var dl = $('fileInfo');
        if (!p) {
            dl.innerHTML = '<dt>' + esc(T('info/project', 'Project')) + '</dt><dd class="muted">' + esc(T('info/none', 'None')) + '</dd>';
            return;
        }
        var src = p.source === 'aroz' ? (p.paths.length === 1 ? p.paths[0] : T('info/itemsOnAroz', '{n} items on ArozOS', { n: p.paths.length })) : T('info/device', 'This device');
        var copper = p.layers.filter(function (l) { return /copper/.test(l.type); }).length;
        var size = p.board && p.board.width ? fmtSize(p.board.width, p.board.height) : '';
        var files = p.fileCount === 1 ? T('info/file1', '1 file') : T('info/files', '{n} files', { n: p.fileCount });
        dl.innerHTML = kv([
            [T('info/name', 'Project Name'), p.name],
            [T('info/format', 'Format'), formatLabel(p)],
            [T('info/layers', 'Layers'), copper ? T('info/layersCopper', '{n} ({c} copper)', { n: p.layers.length, c: copper }) : String(p.layers.length)],
            [T('info/size', 'Size'), size && p.board.source === 'extent' ? T('info/noOutline', '{size} (no outline)', { size: size }) : size],
            [T('info/created', 'Created'), fmtDate(p.created)],
            [T('info/generator', 'Generator'), p.generator],
            [T('info/filesLabel', 'Files'), p.skipped.length ? T('info/filesIgnored', '{files} ({n} ignored)', { files: files, n: p.skipped.length }) : files],
            [T('info/source', 'Source'), src]
        ]);
    }

    function setTab(t) {
        state.tab = t;
        document.querySelectorAll('.tabs button').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === t); });
        $('tabLayers').hidden = t !== 'layers';
        $('tabProps').hidden = t !== 'props';
        if (t === 'props') {
            renderProps();
        }
    }

    function nextTip() {
        state.tipIndex = (state.tipIndex + 1) % TIPS.length;
        $('tipText').textContent = T('tip/' + state.tipIndex, TIPS[state.tipIndex]);
        $('tipCard').hidden = !state.settings.tips;
    }

    function apertureOf(layer, num) {
        var list = layer.image.apertures || [];
        for (var i = 0; i < list.length; i++) {
            if (list[i].num === num) {
                return list[i];
            }
        }
        return null;
    }

    var KIND_LABEL = {
        flash: 'Pad (flash)', trace: 'Trace', arc: 'Arc', region: 'Region / pour',
        hole: 'Drill hole', slot: 'Slot', image: 'Image fill'
    };

    function kindLabel(k) {
        return KIND_LABEL[k] ? T('kind/' + k, KIND_LABEL[k]) : T('kind/object', 'Object');
    }

    function yesNo(v) {
        return v === null || v === undefined ? T('common/unknown', 'Unknown') : (v ? T('common/yes', 'Yes') : T('common/no', 'No'));
    }

    function describeItem(layer, it) {
        var o = it.o || {};
        var rows = [[T('prop/layer', 'Layer'), layer.label], [T('prop/object', 'Object'), kindLabel(o.k)]];
        if (o.d !== undefined) {
            var ap = apertureOf(layer, o.d);
            rows.push([T('prop/aperture', 'Aperture'), 'D' + o.d + (ap ? ' – ' + apertureDesc(ap) : '')]);
            if (ap && ap.attrs && ap.attrs.AperFunction) {
                rows.push([T('prop/function', 'Function'), ap.attrs.AperFunction.replace(/,/g, ', ')]);
            }
        }
        if (o.at) {
            if (o.at.N !== undefined) {
                rows.push([T('prop/net', 'Net'), o.at.N || T('prop/noNet', '(no net)')]);
            }
            if (o.at.C) {
                rows.push([T('prop/component', 'Component'), o.at.C]);
            }
            if (o.at.P) {
                var pin = o.at.P.split(',');
                rows.push([T('prop/pin', 'Pin'), T('prop/pinValue', '{ref} pin {pin}', { ref: pin[0], pin: pin.slice(1).join(' ') })]);
            }
        }
        if (o.k === 'hole' || o.k === 'slot') {
            rows.push([T('prop/tool', 'Tool'), o.tool]);
            rows.push([T('prop/diameter', 'Diameter'), fmtLen(o.dia)]);
            rows.push([T('prop/plated', 'Plated'), yesNo(o.plated)]);
        }
        if (it.t === 'c') {
            rows.push([T('prop/center', 'Center'), fmtXY(it.x, it.y)]);
            if (o.k !== 'hole') {
                rows.push([T('prop/diameter', 'Diameter'), fmtLen(it.r * 2)]);
            }
        } else if (it.t === 'l') {
            rows.push([T('prop/start', 'Start'), fmtXY(it.x1, it.y1)]);
            rows.push([T('prop/end', 'End'), fmtXY(it.x2, it.y2)]);
            if (o.k !== 'slot') {
                rows.push([T('prop/width', 'Width'), fmtLen(it.w)]);
            }
            rows.push([T('prop/length', 'Length'), fmtLen(Math.hypot(it.x2 - it.x1, it.y2 - it.y1))]);
            rows.push([T('prop/angle', 'Angle'), (Math.atan2(it.y2 - it.y1, it.x2 - it.x1) * 180 / Math.PI).toFixed(2) + '°']);
        } else if (it.t === 'a') {
            var s = G.arcStart(it), e = G.arcEnd(it);
            rows.push([T('prop/center', 'Center'), fmtXY(it.cx, it.cy)]);
            rows.push([T('prop/radius', 'Radius'), fmtLen(it.r)]);
            rows.push([T('prop/start', 'Start'), fmtXY(s[0], s[1])]);
            rows.push([T('prop/end', 'End'), fmtXY(e[0], e[1])]);
            rows.push([T('prop/sweep', 'Sweep'), (it.sw * 180 / Math.PI).toFixed(2) + '° ' + (it.sw > 0 ? T('prop/ccw', 'CCW') : T('prop/cw', 'CW'))]);
            rows.push([T('prop/width', 'Width'), fmtLen(it.w)]);
            rows.push([T('prop/length', 'Length'), fmtLen(Math.abs(it.sw) * it.r)]);
        } else if (it.t === 'p') {
            if (o.k === 'flash' && o.x !== undefined) {
                rows.push([T('prop/position', 'Position'), fmtXY(o.x, o.y)]);
            }
            var u = unitInfo();
            rows.push([T('prop/area', 'Area'), (G.polygonArea(it) * u.f * u.f).toFixed(Math.max(2, u.dec - 1)) + ' ' + u.label + '²']);
            rows.push([T('prop/vertices', 'Vertices'), it.c.reduce(function (n, c) { return n + c.length / 2; }, 0)]);
        }
        rows.push([T('prop/extent', 'Extent'), fmtSize(it.b[2] - it.b[0], it.b[3] - it.b[1])]);
        return rows;
    }

    //Aperture description built from its shape, so it can be translated
    function apertureDesc(a) {
        var p = a.params || [];
        function f(v) {
            return (Math.round(v * 10000) / 10000).toString();
        }
        switch (a.type) {
            case 'C':
                return p[1] ? T('ap/circleHole', 'Circle Ø{d}, hole {h}', { d: f(p[0]), h: f(p[1]) }) : T('ap/circle', 'Circle Ø{d}', { d: f(p[0]) });
            case 'R':
                return T('ap/rect', 'Rectangle {w} × {h}', { w: f(p[0]), h: f(p[1]) });
            case 'O':
                return T('ap/obround', 'Obround {w} × {h}', { w: f(p[0]), h: f(p[1]) });
            case 'P':
                return T('ap/polygon', 'Polygon Ø{d}, {n} sides', { d: f(p[0]), n: Math.round(p[1]) });
            case 'block':
                return T('ap/block', 'Block aperture');
        }
        var raw = a.rawParams && a.rawParams.length ? ' (' + a.rawParams.map(f).join(', ') + ')' : '';
        return T('ap/macro', 'Macro {name}', { name: a.type }) + raw;
    }

    //Coordinate format of a layer in words
    function formatText(im) {
        var fi = im.formatInfo;
        if (!fi) {
            return im.format;
        }
        var mode = fi.abs ? T('fmt/absolute', 'absolute') : T('fmt/incremental', 'incremental');
        if (im.kind === 'drill') {
            var zero = fi.zeros === 'TZ' ? T('fmt/tz', 'Trailing zeros') : (fi.zeros === 'LZ' ? T('fmt/lz', 'Leading zeros') : T('fmt/decimal', 'Decimal / default'));
            return zero + ', ' + fi.int + ':' + fi.dec + ', ' + mode;
        }
        var z = fi.zero === 'T' ? T('fmt/trailing', 'Trailing zero omission') : T('fmt/leading', 'Leading zero omission');
        return z + ', ' + mode + ', X ' + fi.xi + '.' + fi.xd + ' / Y ' + fi.yi + '.' + fi.yd;
    }

    function renderProps() {
        var pane = $('tabProps');
        var p = state.project;
        if (!p) {
            pane.innerHTML = '<div class="card"><div class="pad muted">' + esc(T('props/noProject', 'Open a project to see its properties.')) + '</div></div>';
            return;
        }
        var sel = state.selection;
        if (sel) {
            var o = sel.item.o || {};
            pane.innerHTML = '<div class="card"><div class="props-h"><span class="swatch-lg" style="--c:' + esc(sel.layer.color) + '"></span>' +
                '<div><div class="ph-title">' + esc(kindLabel(o.k)) + '</div><div class="ph-sub">' + esc(sel.layer.label) + '</div></div></div>' +
                '<dl class="kv">' + kv(describeItem(sel.layer, sel.item)) + '</dl>' +
                '<div class="props-actions">' +
                '<button class="btn small" data-a="zoom">' + icon('fit') + esc(T('props/zoomTo', 'Zoom to')) + '</button>' +
                '<button class="btn small" data-a="measure">' + icon('ruler') + esc(T('props/measureFrom', 'Measure from')) + '</button>' +
                '<button class="btn small" data-a="clear">' + icon('close') + esc(T('common/clear', 'Clear')) + '</button></div></div>';
            pane.querySelector('[data-a=zoom]').onclick = function () { zoomToBounds(sel.item.b, 4); };
            pane.querySelector('[data-a=measure]').onclick = function () {
                var c = itemCenter(sel.item);
                setTool('measure');
                state.measure = { a: c, b: null, cur: c };
                renderMeasureBox();
                viewer.renderOverlay();
            };
            pane.querySelector('[data-a=clear]').onclick = function () { setSelection(null); };
            return;
        }
        var l = layerById(state.selectedLayer);
        if (l) {
            var im = l.image;
            var st = im.stats;
            var objects = im.kind === 'drill' ? T('props/holesN', '{n} holes', { n: st.holes }) + (st.slots ? ', ' + T('props/slotsN', '{n} slots', { n: st.slots }) : '') :
                [T('props/flashesN', '{n} flashes', { n: st.flashes }), T('props/linesN', '{n} lines', { n: st.lines }),
                    T('props/arcsN', '{n} arcs', { n: st.arcs }), T('props/regionsN', '{n} regions', { n: st.regions })].join(', ');
            var b = im.bounds;
            pane.innerHTML = '<div class="card"><div class="props-h"><span class="swatch-lg" style="--c:' + esc(l.color) + '"></span>' +
                '<div><div class="ph-title">' + esc(l.label) + '</div><div class="ph-sub">' + esc(L.base(l.name)) + '</div></div></div>' +
                '<div class="field"><label>' + esc(T('props/layerType', 'Layer type')) + '</label><select data-f="type">' + L.TYPE_LIST.map(function (t) {
                    return '<option value="' + t + '"' + (t === l.type ? ' selected' : '') + '>' + esc(layerLabel({ type: t, index: l.index, plated: l.plated, via: l.via })) + '</option>';
                }).join('') + '</select></div>' +
                '<div class="field"><label>' + esc(T('props/colour', 'Colour and opacity')) + '</label><div class="field-row"><input type="color" data-f="color" value="' + esc(toHex6(l.color)) + '">' +
                '<input type="range" data-f="opacity" min="5" max="100" value="' + Math.round(l.opacity * 100) + '"><span class="op">' + Math.round(l.opacity * 100) + '%</span>' +
                '<label class="field-row" style="margin-left:6px"><input type="checkbox" data-f="visible"' + (l.visible ? ' checked' : '') + '>' + esc(T('props/visible', 'Visible')) + '</label></div></div>' +
                '<dl class="kv">' + kv([
                    [T('props/file', 'File'), l.name],
                    [T('props/size', 'Size'), fmtBytes(l.size)],
                    [T('props/format', 'Format'), im.kind === 'drill' ? T('props/excellon', 'Excellon drill') : (im.x2 ? 'Gerber X2' : 'Gerber RS-274X')],
                    [T('props/units', 'Units'), im.units === 'in' ? T('unit/inch', 'Inch') : T('unit/mm', 'Millimetre')],
                    [T('props/coordinates', 'Coordinates'), formatText(im)],
                    [T('props/generator', 'Generator'), im.generator],
                    [T('props/created', 'Created'), fmtDate(im.created)],
                    [T('props/function', 'Function'), im.attrs.FileFunction ? im.attrs.FileFunction.replace(/,/g, ', ') : ''],
                    [T('props/objects', 'Objects'), objects],
                    [T('props/apertures', 'Apertures'), im.kind === 'gerber' ? String(im.apertures.length) : ''],
                    [T('props/tools', 'Tools'), im.tools ? String(im.tools.length) : ''],
                    [T('props/polarity', 'Polarity'), im.hasClear ? T('props/polarityBoth', 'Dark and clear') : T('props/polarityDark', 'Dark')],
                    [T('props/extent', 'Extent'), G.boundsValid(b) ? fmtSize(b[2] - b[0], b[3] - b[1]) : T('props/empty', 'Empty')],
                    [T('props/originOffset', 'Origin offset'), G.boundsValid(b) ? fmtXY(b[0], b[1]) : '']
                ]) + '</dl>' +
                (im.warnings.length ? '<div class="pad small" style="padding-top:0"><b>' + esc(T('props/warnings', 'Warnings')) + '</b><ul class="list-plain warn-list">' +
                    warningTexts(im).map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul></div>' : '') +
                '<div class="props-actions">' +
                '<button class="btn small" data-a="source">' + icon('code') + esc(T('props/source', 'Source')) + '</button>' +
                (im.kind === 'gerber' ? '<button class="btn small" data-a="apertures">' + icon('table') + esc(T('props/aperturesBtn', 'Apertures')) + '</button>' :
                    '<button class="btn small" data-a="drills">' + icon('table') + esc(T('props/drillTable', 'Drill table')) + '</button>') +
                '<button class="btn small" data-a="zoom">' + icon('fit') + esc(T('props/zoomTo', 'Zoom to')) + '</button>' +
                '<button class="btn small" data-a="remove">' + icon('trash') + esc(T('props/remove', 'Remove')) + '</button></div></div>';
            pane.querySelector('[data-f=type]').onchange = function () { setLayerType(l, this.value); renderProps(); };
            pane.querySelector('[data-f=color]').oninput = function () { l.color = this.value; layersChanged(); };
            pane.querySelector('[data-f=opacity]').oninput = function () {
                l.opacity = this.value / 100;
                pane.querySelector('.op').textContent = this.value + '%';
                state.miniCache = null;
                viewer.requestRender();
                scheduleMinimap();
                renderLayerList();
                saveStateSoon();
            };
            pane.querySelector('[data-f=visible]').onchange = function () { l.visible = this.checked; layersChanged(); };
            pane.querySelector('[data-a=source]').onclick = function () { cmd.viewSource(l); };
            var ab = pane.querySelector('[data-a=apertures]');
            if (ab) {
                ab.onclick = function () { cmd.apertureTable(l); };
            }
            var db = pane.querySelector('[data-a=drills]');
            if (db) {
                db.onclick = function () { cmd.drillTable(); };
            }
            pane.querySelector('[data-a=zoom]').onclick = function () { zoomToBounds(l.image.bounds); };
            pane.querySelector('[data-a=remove]').onclick = function () { removeLayer(l); };
            return;
        }
        //Board summary
        var bd = p.board;
        var sum = GV.app.boardSummary();
        pane.innerHTML = '<div class="card"><div class="card-h">' + icon('board') + '<span>' + esc(T('props/board', 'Board')) + '</span></div><dl class="kv">' + kv([
            [T('props/size', 'Size'), bd && bd.width ? fmtSize(bd.width, bd.height) : ''],
            [T('props/area', 'Area'), bd && bd.area ? (bd.area / 100).toFixed(2) + ' cm²' : ''],
            [T('props/outline', 'Outline'), outlineText(bd)],
            [T('props/copperLayers', 'Copper layers'), String(sum.copper)],
            [T('props/holesLabel', 'Holes'), sum.holes ? T('props/holesValue', '{n} ({p} plated, {np} non-plated)', { n: sum.holes, p: sum.pth, np: sum.npth }) : '0'],
            [T('props/slotsLabel', 'Slots'), String(sum.slots)],
            [T('props/minHole', 'Smallest hole'), sum.minHole ? fmtLen(sum.minHole) : ''],
            [T('props/minTrace', 'Thinnest trace'), sum.minTrace ? fmtLen(sum.minTrace) : '']
        ]) + '</dl><div class="pad muted small" style="padding-top:0">' + esc(T('props/hint', 'Select a layer or click an object on the board to see its details.')) + '</div></div>';
    }

    function outlineText(bd) {
        if (!bd) {
            return '';
        }
        if (bd.source !== 'outline') {
            return T('props/noOutline', 'Not found, using the layer extent');
        }
        return bd.cutouts.length ? T('props/outlineCut', '{n} closed, {c} cut-outs', { n: bd.outer.length, c: bd.cutouts.length }) :
            T('props/outlineClosed', '{n} closed', { n: bd.outer.length });
    }

    function itemCenter(it) {
        if (it.o && it.o.x !== undefined) {
            return [it.o.x, it.o.y];
        }
        if (it.t === 'c') {
            return [it.x, it.y];
        }
        if (it.t === 'a') {
            return [it.cx, it.cy];
        }
        return [(it.b[0] + it.b[2]) / 2, (it.b[1] + it.b[3]) / 2];
    }

    function setSelection(sel) {
        state.selection = sel;
        if (sel) {
            state.selectedLayer = null;
            renderLayerList();
            if (state.tab !== 'props') {
                setTab('props');
            }
        }
        renderProps();
        viewer.renderOverlay();
    }

    /* ==================================================================
        Viewer: interaction
    ================================================================== */
    function hitTest(bx, by) {
        var tol = 3 / viewer.view.scale;
        var order = drawOrder().slice().reverse();
        if (state.mode === 'realistic') {
            var side = viewer.view.flip ? 'bottom' : 'top';
            order = order.filter(function (l) {
                return l.type === 'drill' || l.type === side + '-copper' || l.type === side + '-silk';
            });
        }
        for (var li = 0; li < order.length; li++) {
            var layer = order[li];
            if (!layer.visible || !layer.image) {
                continue;
            }
            var best = null, bestArea = Infinity;
            var groups = layer.image.groups;
            //A later clear group that covers the point erased what lies below it
            var clearedFrom = groups.length;
            for (var ci = groups.length - 1; ci >= 0; ci--) {
                if (!groups[ci].dark && groups[ci].items.some(function (c) { return G.hitItem(c, bx, by, 0); })) {
                    clearedFrom = ci;
                    break;
                }
            }
            for (var gi = groups.length - 1; gi >= 0; gi--) {
                if (!groups[gi].dark || gi < clearedFrom && clearedFrom < groups.length) {
                    continue;
                }
                var items = groups[gi].items;
                for (var ii = items.length - 1; ii >= 0; ii--) {
                    var it = items[ii];
                    if (G.hitItem(it, bx, by, tol)) {
                        var a = (it.b[2] - it.b[0]) * (it.b[3] - it.b[1]);
                        if (a < bestArea) {
                            best = it;
                            bestArea = a;
                        }
                    }
                }
            }
            if (best) {
                return { layer: layer, item: best };
            }
        }
        return null;
    }

    //Snap points: pad / hole centres, line and arc end points, arc centres
    function snapIndex(layer) {
        if (layer._snap) {
            return layer._snap;
        }
        var cell = 2;
        var map = new Map();
        function add(x, y) {
            var k = Math.floor(x / cell) + ',' + Math.floor(y / cell);
            var a = map.get(k);
            if (!a) {
                a = [];
                map.set(k, a);
            }
            a.push(x, y);
        }
        var seenFlash = new Set();
        layer.image.groups.forEach(function (g) {
            if (!g.dark) {
                return;
            }
            g.items.forEach(function (it) {
                var o = it.o || {};
                if (o.x !== undefined) {
                    if (!seenFlash.has(o)) {
                        seenFlash.add(o);
                        add(o.x, o.y);
                    }
                    return;
                }
                if (it.t === 'c') {
                    add(it.x, it.y);
                } else if (it.t === 'l') {
                    add(it.x1, it.y1);
                    add(it.x2, it.y2);
                } else if (it.t === 'a') {
                    var s = G.arcStart(it), e = G.arcEnd(it);
                    add(s[0], s[1]);
                    add(e[0], e[1]);
                    add(it.cx, it.cy);
                }
            });
        });
        layer._snap = { cell: cell, map: map };
        return layer._snap;
    }

    function snap(bx, by) {
        if (!state.settings.snap || !state.project) {
            return null;
        }
        var tol = 9 / viewer.view.scale;
        var best = null, bestD = tol;
        state.project.layers.forEach(function (l) {
            if (!l.visible || !l.image) {
                return;
            }
            var idx = snapIndex(l);
            var c = idx.cell;
            var r = Math.ceil(tol / c);
            var cx = Math.floor(bx / c), cy = Math.floor(by / c);
            for (var dx = -r; dx <= r; dx++) {
                for (var dy = -r; dy <= r; dy++) {
                    var a = idx.map.get((cx + dx) + ',' + (cy + dy));
                    if (!a) {
                        continue;
                    }
                    for (var i = 0; i < a.length; i += 2) {
                        var d = Math.hypot(a[i] - bx, a[i + 1] - by);
                        if (d < bestD) {
                            bestD = d;
                            best = [a[i], a[i + 1]];
                        }
                    }
                }
            }
        });
        return best;
    }

    var ptr = {
        down: null,         //{x, y, button, moved, tool}
        pointers: new Map(),
        pinch: null,
        space: false
    };

    function localXY(e) {
        var r = $('cvOverlay').getBoundingClientRect();
        return [e.clientX - r.left, e.clientY - r.top];
    }

    function effectiveTool() {
        return ptr.space ? 'pan' : state.tool;
    }

    function bindViewer() {
        var cv = $('cvOverlay');
        cv.addEventListener('pointerdown', function (e) {
            if (!state.project) {
                return;
            }
            cv.setPointerCapture(e.pointerId);
            var p = localXY(e);
            ptr.pointers.set(e.pointerId, p);
            if (ptr.pointers.size === 2) {
                var pts = Array.from(ptr.pointers.values());
                ptr.pinch = { d: Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]), c: [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2] };
                ptr.down = null;
                return;
            }
            ptr.down = { x: p[0], y: p[1], lx: p[0], ly: p[1], button: e.button, moved: false, tool: effectiveTool() };
            if (ptr.down.tool === 'zoom' && e.button === 0) {
                state.zoomRect = null;
            }
        });
        cv.addEventListener('pointermove', function (e) {
            var p = localXY(e);
            if (ptr.pointers.has(e.pointerId)) {
                ptr.pointers.set(e.pointerId, p);
            }
            if (ptr.pinch && ptr.pointers.size === 2) {
                var pts = Array.from(ptr.pointers.values());
                var d = Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]);
                var c = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
                viewer.panBy(c[0] - ptr.pinch.c[0], c[1] - ptr.pinch.c[1]);
                if (ptr.pinch.d > 0) {
                    viewer.zoomAt(d / ptr.pinch.d, c[0], c[1]);
                }
                ptr.pinch = { d: d, c: c };
                return;
            }
            if (!state.project) {
                return;
            }
            var b = viewer.toBoard(p[0], p[1]);
            state.cursor = b;
            var tool = effectiveTool();
            state.snapPt = tool === 'measure' || tool === 'origin' ? snap(b[0], b[1]) : null;
            updateCoords();
            var dn = ptr.down;
            if (dn) {
                if (!dn.moved && Math.hypot(p[0] - dn.x, p[1] - dn.y) > 4) {
                    dn.moved = true;
                }
                var panning = dn.button === 1 || dn.button === 2 || dn.tool === 'pan' || (dn.tool === 'select' && dn.button === 0);
                if (dn.moved && dn.tool === 'zoom' && dn.button === 0) {
                    state.zoomRect = [dn.x, dn.y, p[0], p[1]];
                } else if (dn.moved && panning) {
                    cv.classList.add('panning');
                    viewer.panBy(p[0] - dn.lx, p[1] - dn.ly);
                }
                dn.lx = p[0];
                dn.ly = p[1];
            }
            if (state.measure && state.measure.a && !state.measure.b) {
                state.measure.cur = state.snapPt || b;
                renderMeasureBox();
            }
            viewer.requestOverlay();
        });
        function finish(e) {
            var dn = ptr.down;
            ptr.pointers.delete(e.pointerId);
            if (ptr.pointers.size < 2) {
                ptr.pinch = null;
            }
            if (!dn) {
                return;
            }
            ptr.down = null;
            cv.classList.remove('panning');
            if (e.type === 'pointercancel') {
                state.zoomRect = null;
                viewer.renderOverlay();
                return;
            }
            var p = localXY(e);
            if (dn.button === 2 && !dn.moved) {
                canvasContextMenu(e, p);
                return;
            }
            if (dn.button !== 0) {
                return;
            }
            if (dn.tool === 'zoom') {
                if (dn.moved && state.zoomRect) {
                    var r = state.zoomRect;
                    state.zoomRect = null;
                    var a = viewer.toBoard(Math.min(r[0], r[2]), Math.min(r[1], r[3]));
                    var c = viewer.toBoard(Math.max(r[0], r[2]), Math.max(r[1], r[3]));
                    zoomToBounds([Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.max(a[0], c[0]), Math.max(a[1], c[1])], 0);
                } else {
                    viewer.zoomAt(e.altKey ? 0.5 : 2, p[0], p[1]);
                }
                viewer.renderOverlay();
                return;
            }
            if (dn.moved) {
                return;
            }
            var b = viewer.toBoard(p[0], p[1]);
            if (dn.tool === 'measure') {
                var pt = snap(b[0], b[1]) || b;
                if (!state.measure || state.measure.b) {
                    state.measure = { a: pt, b: null, cur: pt };
                } else {
                    state.measure.b = pt;
                    state.measure.cur = pt;
                }
                renderMeasureBox();
                viewer.renderOverlay();
            } else if (dn.tool === 'origin') {
                state.origin = snap(b[0], b[1]) || b;
                setTool('select');
                UI.toast(T('toast/originSet', 'Origin set to the picked point'), { icon: 'target' });
                updateCoords();
                renderProps();
                viewer.renderOverlay();
            } else if (dn.tool === 'select') {
                var hit = hitTest(b[0], b[1]);
                setSelection(hit);
            }
        }
        cv.addEventListener('pointerup', finish);
        cv.addEventListener('pointercancel', finish);
        cv.addEventListener('pointerleave', function () {
            state.cursor = null;
            state.snapPt = null;
            updateCoords();
            viewer.requestOverlay();
        });
        cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });
        cv.addEventListener('dblclick', function (e) {
            if (!state.project || state.tool !== 'select') {
                return;
            }
            var p = localXY(e);
            var b = viewer.toBoard(p[0], p[1]);
            var hit = hitTest(b[0], b[1]);
            if (hit) {
                zoomToBounds(hit.item.b, 6);
            } else {
                cmd.fit();
            }
        });
        cv.addEventListener('wheel', function (e) {
            if (!state.project) {
                return;
            }
            e.preventDefault();
            var p = localXY(e);
            if (e.shiftKey && !e.ctrlKey) {
                viewer.panBy(-e.deltaY, 0);
                return;
            }
            var dy = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY;
            var f = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0018));
            viewer.zoomAt(Math.max(0.5, Math.min(2, f)), p[0], p[1]);
        }, { passive: false });
    }

    function canvasContextMenu(e, p) {
        var b = viewer.toBoard(p[0], p[1]);
        var hit = hitTest(b[0], b[1]);
        UI.contextMenu([
            hit ? { header: T('ctx/objectOn', '{object} on {layer}', { object: kindLabel(hit.item.o && hit.item.o.k), layer: hit.layer.label }) } : null,
            hit ? { label: T('ctx/select', 'Select'), icon: 'pointer', action: function () { setSelection(hit); } } : null,
            hit ? { label: T('ctx/zoomObject', 'Zoom to Object'), icon: 'fit', action: function () { zoomToBounds(hit.item.b, 6); } } : null,
            hit ? { label: T('ctx/showOnly', 'Show Only {layer}', { layer: hit.layer.label }), icon: 'eye', action: function () { solo(hit.layer); } } : null,
            hit ? { sep: true } : null,
            { label: T('menu/zoomFit', 'Zoom to Fit'), icon: 'fit', key: 'F', action: cmd.fit },
            { label: T('ctx/center', 'Center Here'), icon: 'crosshair', action: function () { viewer.centerOn(b[0], b[1]); } },
            { label: T('ctx/measureFrom', 'Measure From Here'), icon: 'ruler', action: function () {
                setTool('measure');
                var pt = snap(b[0], b[1]) || b;
                state.measure = { a: pt, b: null, cur: pt };
                renderMeasureBox();
            } },
            { label: T('ctx/setOrigin', 'Set Origin Here'), icon: 'target', action: function () { state.origin = snap(b[0], b[1]) || b; updateCoords(); viewer.renderOverlay(); } },
            { label: T('ctx/copyCoords', 'Copy Coordinates'), icon: 'file', action: function () { copyText(fmtXY(b[0], b[1])); } },
            { sep: true },
            { label: state.mode === 'realistic' ? T('menu/layerView', 'Layer View') : T('menu/realistic', 'Realistic Preview'), icon: 'layers', key: 'P', action: cmd.toggleRealistic },
            { label: viewer.view.flip ? T('ctx/viewTop', 'View Top Side') : T('menu/viewBottom', 'View Bottom Side'), icon: 'flip', key: 'B', action: cmd.flip }
        ], e.clientX, e.clientY);
    }

    function copyText(t) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(t).then(function () {
                UI.toast(T('toast/copied', 'Copied {text}', { text: t }), { icon: 'check' });
            }, function () {
                UI.toast(t);
            });
        } else {
            UI.toast(t);
        }
    }

    function zoomToBounds(b, padMM) {
        if (!G.boundsValid(b)) {
            return;
        }
        var pad = padMM === undefined ? 0 : padMM;
        var w = b[2] - b[0], h = b[3] - b[1];
        var minSize = 2;
        var cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
        w = Math.max(w + pad * 2, minSize);
        h = Math.max(h + pad * 2, minSize);
        viewer.fit([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], 30);
    }

    function updateCoords() {
        var c = state.snapPt || state.cursor;
        $('coordX').textContent = c ? fmtLen(c[0] - state.origin[0]) : '-';
        $('coordY').textContent = c ? fmtLen(c[1] - state.origin[1]) : '-';
    }

    function updateZoomLabel() {
        var r = viewer.view.scale / R.CSS_PX_PER_MM;
        var t;
        if (r >= 1) {
            t = (r >= 10 ? Math.round(r) : Math.round(r * 10) / 10) + ':1';
        } else {
            var inv = 1 / r;
            t = '1:' + (inv >= 10 ? Math.round(inv) : Math.round(inv * 10) / 10);
        }
        $('btnZoom').firstChild.nodeValue = t + ' ';
    }

    /* ---------------- Overlay drawing ---------------- */
    function itemOutline(it) {
        var p = new Path2D();
        if (it.t === 'c') {
            G.emitCircle(p, it.x, it.y, it.r, true);
        } else if (it.t === 'p') {
            G.emitFill(p, it);
        } else if (it.w > 0) {
            G.emitContour(p, GV.board.slotContour(it));
        } else {
            G.emitStroke(p, it);
        }
        return p;
    }

    function netItems(net) {
        var out = [];
        state.project.layers.forEach(function (l) {
            if (!l.visible || !l.image || !/copper/.test(l.type)) {
                return;
            }
            l.image.groups.forEach(function (g) {
                if (!g.dark) {
                    return;
                }
                g.items.forEach(function (it) {
                    if (out.length < 6000 && it.o && it.o.at && it.o.at.N === net) {
                        out.push(it);
                    }
                });
            });
        });
        return out;
    }

    function drawOverlay(ctx, v) {
        if (!state.project || state.dim === '3d') {
            return;
        }
        var W = v.cssW, H = v.cssH;
        var m = v.matrix(1);
        var accent = getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#e5383b';
        var lightBg = !isDarkColor(state.settings.canvasBg);
        var ink = lightBg ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.85)';

        //Selection highlight (and the rest of its net when X2 nets exist)
        if (state.selection) {
            var it = state.selection.item;
            ctx.save();
            ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
            var net = it.o && it.o.at && it.o.at.N;
            if (net) {
                var others = new Path2D();
                netItems(net).forEach(function (x) { others.addPath(itemOutline(x)); });
                ctx.fillStyle = 'rgba(255,214,10,0.35)';
                ctx.fill(others);
            }
            var path = itemOutline(it);
            ctx.fillStyle = 'rgba(255,255,255,0.28)';
            ctx.fill(path);
            ctx.lineWidth = 2 / v.view.scale;
            ctx.strokeStyle = '#ffd60a';
            ctx.stroke(path);
            ctx.restore();
        }

        //Origin marker
        if (state.origin[0] !== 0 || state.origin[1] !== 0 || state.tool === 'origin') {
            var o = v.toScreen(state.origin[0], state.origin[1]);
            ctx.strokeStyle = accent;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(o[0], o[1], 7, 0, Math.PI * 2);
            ctx.moveTo(o[0] - 12, o[1]);
            ctx.lineTo(o[0] + 12, o[1]);
            ctx.moveTo(o[0], o[1] - 12);
            ctx.lineTo(o[0], o[1] + 12);
            ctx.stroke();
        }

        //Go-to marker
        if (state.marker) {
            var mk = v.toScreen(state.marker[0], state.marker[1]);
            ctx.strokeStyle = '#ffd60a';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(mk[0] - 10, mk[1] - 10);
            ctx.lineTo(mk[0] + 10, mk[1] + 10);
            ctx.moveTo(mk[0] + 10, mk[1] - 10);
            ctx.lineTo(mk[0] - 10, mk[1] + 10);
            ctx.stroke();
        }

        //Crosshair cursor
        if (state.settings.crosshair && state.cursor) {
            var cp = v.toScreen((state.snapPt || state.cursor)[0], (state.snapPt || state.cursor)[1]);
            ctx.strokeStyle = lightBg ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.35)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, Math.round(cp[1]) + 0.5);
            ctx.lineTo(W, Math.round(cp[1]) + 0.5);
            ctx.moveTo(Math.round(cp[0]) + 0.5, 0);
            ctx.lineTo(Math.round(cp[0]) + 0.5, H);
            ctx.stroke();
        }

        //Measurement
        var ms = state.measure;
        if (ms && ms.a) {
            var end = ms.b || ms.cur || ms.a;
            var A = v.toScreen(ms.a[0], ms.a[1]), B = v.toScreen(end[0], end[1]);
            var corner = v.toScreen(end[0], ms.a[1]);
            ctx.save();
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = lightBg ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.45)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(A[0], A[1]);
            ctx.lineTo(corner[0], corner[1]);
            ctx.lineTo(B[0], B[1]);
            ctx.stroke();
            ctx.restore();
            ctx.strokeStyle = '#ffd60a';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(A[0], A[1]);
            ctx.lineTo(B[0], B[1]);
            ctx.stroke();
            [A, B].forEach(function (q) {
                ctx.fillStyle = '#ffd60a';
                ctx.beginPath();
                ctx.arc(q[0], q[1], 3.5, 0, Math.PI * 2);
                ctx.fill();
            });
            var d = Math.hypot(end[0] - ms.a[0], end[1] - ms.a[1]);
            if (d > 0) {
                var label = fmtLen(d);
                ctx.font = '600 12px ' + getComputedStyle(document.body).fontFamily;
                var tw = ctx.measureText(label).width + 12;
                var lx = (A[0] + B[0]) / 2 + 10, ly = (A[1] + B[1]) / 2 - 12;
                ctx.fillStyle = 'rgba(20,21,24,0.88)';
                roundRect(ctx, lx, ly - 11, tw, 22, 6);
                ctx.fill();
                ctx.fillStyle = '#ffd60a';
                ctx.fillText(label, lx + 6, ly + 4);
            }
        }

        //Snap indicator
        if (state.snapPt) {
            var sp = v.toScreen(state.snapPt[0], state.snapPt[1]);
            ctx.strokeStyle = '#ffd60a';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(sp[0] - 5, sp[1] - 5, 10, 10);
        }

        //Zoom rectangle
        if (state.zoomRect) {
            var zr = state.zoomRect;
            ctx.save();
            ctx.setLineDash([5, 4]);
            ctx.strokeStyle = ink;
            ctx.fillStyle = 'rgba(229,56,59,0.12)';
            ctx.lineWidth = 1;
            var rx = Math.min(zr[0], zr[2]), ry = Math.min(zr[1], zr[3]);
            ctx.fillRect(rx, ry, Math.abs(zr[2] - zr[0]), Math.abs(zr[3] - zr[1]));
            ctx.strokeRect(rx + 0.5, ry + 0.5, Math.abs(zr[2] - zr[0]), Math.abs(zr[3] - zr[1]));
            ctx.restore();
        }
        renderMinimapViewport();
    }

    function roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    function renderMeasureBox() {
        var box = $('measureBox');
        var ms = state.measure;
        if (!ms || !ms.a || state.tool !== 'measure' && !ms.b) {
            box.hidden = true;
            return;
        }
        var end = ms.b || ms.cur || ms.a;
        var dx = end[0] - ms.a[0], dy = end[1] - ms.a[1];
        var d = Math.hypot(dx, dy);
        box.hidden = false;
        box.innerHTML = '<div class="fb-h">' + icon('ruler') + '<span>' + esc(ms.b ? T('measure/title', 'Measurement') : T('measure/live', 'Measuring...')) + '</span>' +
            '<button title="' + esc(T('measure/clear', 'Clear measurement')) + '">' + icon('close') + '</button></div>' +
            '<div class="fb-big">' + fmtLen(d) + '</div>' +
            '<div class="fb-row"><span>ΔX</span><span>' + fmtLen(Math.abs(dx)) + '</span></div>' +
            '<div class="fb-row"><span>ΔY</span><span>' + fmtLen(Math.abs(dy)) + '</span></div>' +
            '<div class="fb-row"><span>' + esc(T('measure/angle', 'Angle')) + '</span><span>' + (Math.atan2(dy, dx) * 180 / Math.PI).toFixed(2) + '°</span></div>' +
            '<div class="fb-row"><span>' + esc(T('measure/from', 'From')) + '</span><span>' + fmtXY(ms.a[0], ms.a[1]) + '</span></div>' +
            '<div class="fb-row"><span>' + esc(T('measure/to', 'To')) + '</span><span>' + fmtXY(end[0], end[1]) + '</span></div>';
        box.querySelector('button').onclick = function () { cmd.clearMeasure(); };
    }

    cmd.clearMeasure = function () {
        state.measure = null;
        renderMeasureBox();
        viewer.renderOverlay();
    };

    /* ---------------- Minimap ---------------- */
    var mini = { view: null, timer: 0 };

    //Layer edits (opacity sliders, colour pickers) come in bursts
    function scheduleMinimap() {
        clearTimeout(mini.timer);
        mini.timer = setTimeout(renderMinimap, 150);
    }

    function renderMinimap() {
        var box = $('minimap');
        var show = !!state.project && state.settings.minimap && state.dim === '2d';
        box.hidden = !show;
        if (!show) {
            return;
        }
        var cv = $('cvMini');
        var r = box.getBoundingClientRect();
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        var w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
        var b = projectBounds(false);
        if (!b) {
            return;
        }
        var rot = (viewer.view.rot / 90) % 2 !== 0;
        var bw = rot ? b[3] - b[1] : b[2] - b[0], bh = rot ? b[2] - b[0] : b[3] - b[1];
        var scale = Math.min((r.width - 12) / bw, (r.height - 12) / bh);
        mini.view = { cx: (b[0] + b[2]) / 2, cy: (b[1] + b[3]) / 2, scale: scale, rot: viewer.view.rot, flip: viewer.view.flip };
        if (!state.miniCache || state.miniCache.width !== w || state.miniCache.height !== h) {
            state.miniCache = R.renderToCanvas(scene(true), Object.assign({}, mini.view, { scale: scale * dpr }), w, h, mini.scratch || (mini.scratch = new R.Scratch()));
        }
        cv.width = w;
        cv.height = h;
        renderMinimapViewport();
    }

    function renderMinimapViewport() {
        if (!state.miniCache || $('minimap').hidden || !mini.view) {
            return;
        }
        var cv = $('cvMini');
        var ctx = cv.getContext('2d');
        var dpr = cv.width / Math.max(1, $('minimap').getBoundingClientRect().width);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, cv.width, cv.height);
        ctx.drawImage(state.miniCache, 0, 0);
        var mm = R.viewMatrix(mini.view, cv.width / dpr, cv.height / dpr, 1);
        var corners = [[0, 0], [viewer.cssW, 0], [viewer.cssW, viewer.cssH], [0, viewer.cssH]].map(function (c) {
            var b = viewer.toBoard(c[0], c[1]);
            return R.apply(mm, b[0], b[1]);
        });
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.strokeStyle = '#ff5a5f';
        ctx.lineWidth = 1.5;
        ctx.fillStyle = 'rgba(255,90,95,0.12)';
        ctx.beginPath();
        corners.forEach(function (c, i) {
            if (i) {
                ctx.lineTo(c[0], c[1]);
            } else {
                ctx.moveTo(c[0], c[1]);
            }
        });
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    }

    function bindMinimap() {
        var box = $('minimap');
        var dragging = false;
        function go(e) {
            if (!mini.view) {
                return;
            }
            var r = box.getBoundingClientRect();
            var mm = R.viewMatrix(mini.view, r.width, r.height, 1);
            var b = R.apply(R.invert(mm), e.clientX - r.left, e.clientY - r.top);
            viewer.centerOn(b[0], b[1]);
        }
        box.addEventListener('pointerdown', function (e) {
            dragging = true;
            box.setPointerCapture(e.pointerId);
            go(e);
        });
        box.addEventListener('pointermove', function (e) {
            if (dragging) {
                go(e);
            }
        });
        box.addEventListener('pointerup', function () { dragging = false; });
    }

    /* ---------------- Scene ---------------- */
    function gridOpts() {
        if (!state.settings.grid) {
            return null;
        }
        var light = !isDarkColor(state.settings.canvasBg);
        return {
            step: R.niceStep(viewer.view.scale, 16, state.settings.units !== 'mm'),
            major: 5,
            color: light ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.045)',
            majorColor: light ? 'rgba(0,0,0,0.13)' : 'rgba(255,255,255,0.1)'
        };
    }

    function scene(forMini) {
        if (!state.project) {
            return null;
        }
        return {
            mode: state.mode,
            side: viewer.view.flip ? 'bottom' : 'top',
            layers: drawOrder(),
            all: state.project.layers,
            board: state.project.board,
            background: forMini ? null : state.settings.canvasBg,
            look: look(),
            grid: forMini ? null : gridOpts(),
            shadow: !forMini && state.mode === 'realistic'
        };
    }

    /* ==================================================================
        Tools, modes and view commands
    ================================================================== */
    function setTool(t) {
        if (state.dim === '3d') {
            return;
        }
        state.tool = t;
        var cv = $('cvOverlay');
        cv.className = 'tool-' + t + (state.settings.crosshair ? ' crosshair' : '');
        document.querySelectorAll('[data-tool]').forEach(function (b) { b.classList.toggle('active', b.dataset.tool === t); });
        if (t !== 'measure' && state.measure && !state.measure.b) {
            state.measure = null;
        }
        state.snapPt = null;
        renderMeasureBox();
        viewer.renderOverlay();
    }

    function updateToolbar() {
        var has = !!state.project;
        var is3d = state.dim === '3d';
        document.querySelectorAll('#toolbar [data-tool], #toolbar [data-cmd="fit"], #toolbar [data-cmd="rotate"]').forEach(function (b) {
            b.disabled = !has;
        });
        document.querySelectorAll('#toolbar [data-tool]').forEach(function (b) {
            b.disabled = !has || is3d;
        });
        $('btnFlip').disabled = !has;
        $('btnRender').disabled = !has || is3d;
        $('btnFlip').classList.toggle('active', has && viewer.view.flip);
        $('btnRender').classList.toggle('active', has && state.mode === 'realistic');
        $('btnCrosshair').classList.toggle('active', state.settings.crosshair);
        document.querySelectorAll('#segDim button').forEach(function (b) {
            b.classList.toggle('active', b.dataset.dim === state.dim);
            b.disabled = !has && b.dataset.dim === '3d';
        });
        $('btnPanel').classList.toggle('active', !document.body.classList.contains('panel-hidden') && (window.innerWidth > 820 || document.body.classList.contains('panel-open')));
        $('btnFullscreen').classList.toggle('active', document.body.classList.contains('zen'));
        var chip = $('modeChip');
        if (has && (state.mode === 'realistic' || viewer.view.flip) && !is3d) {
            chip.hidden = false;
            chip.textContent = (state.mode === 'realistic' ? T('chip/realistic', 'Realistic') : T('chip/layers', 'Layers')) + ' · ' +
                (viewer.view.flip ? T('chip/bottom', 'Bottom side (mirrored)') : T('chip/top', 'Top side'));
        } else {
            chip.hidden = true;
        }
        $('coordBar').hidden = !has || is3d;
        $('view3dBar').hidden = !is3d;
        $('cvOverlay').className = 'tool-' + state.tool + (state.settings.crosshair ? ' crosshair' : '');
    }

    cmd.fit = function () {
        if (!state.project) {
            return;
        }
        if (state.dim === '3d' && view3d) {
            view3d.setView('iso');
            return;
        }
        var b = projectBounds(true);
        if (b) {
            viewer.fit(b, 36);
        }
    };

    cmd.zoomIn = function () {
        viewer.zoomAt(1.5, viewer.cssW / 2, viewer.cssH / 2);
    };

    cmd.zoomOut = function () {
        viewer.zoomAt(1 / 1.5, viewer.cssW / 2, viewer.cssH / 2);
    };

    cmd.zoomTo = function (ratio) {
        viewer.view.scale = R.CSS_PX_PER_MM * ratio;
        viewer.changed();
    };

    cmd.rotate = function () {
        if (!state.project) {
            return;
        }
        viewer.view.rot = (viewer.view.rot + 90) % 360;
        state.miniCache = null;
        viewer.changed();
        renderMinimap();
        saveStateSoon();
    };

    cmd.flip = function () {
        if (!state.project) {
            return;
        }
        viewer.view.flip = !viewer.view.flip;
        state.miniCache = null;
        if (state.dim === '3d' && view3d) {
            view3d.setView(viewer.view.flip ? 'bottom' : 'top');
        }
        viewer.changed();
        renderMinimap();
        updateToolbar();
        saveStateSoon();
    };

    cmd.setMode = function (m) {
        state.mode = m;
        state.miniCache = null;
        viewer.requestRender();
        renderMinimap();
        updateToolbar();
        saveStateSoon();
    };

    cmd.toggleRealistic = function () {
        if (!state.project) {
            return;
        }
        cmd.setMode(state.mode === 'realistic' ? 'layers' : 'realistic');
    };

    cmd.viewSide = function (bottom) {
        if (viewer.view.flip !== bottom) {
            cmd.flip();
        }
    };

    function renderModeItems() {
        return [
            { label: T('menu/layerView', 'Layer View'), icon: 'layers', checked: function () { return state.mode === 'layers'; }, action: function () { cmd.setMode('layers'); } },
            { label: T('menu/realistic', 'Realistic Preview'), icon: 'board', key: 'P', checked: function () { return state.mode === 'realistic'; }, action: function () { cmd.setMode('realistic'); } },
            { sep: true },
            { label: T('menu/topSide', 'Top Side'), checked: function () { return !viewer.view.flip; }, action: function () { cmd.viewSide(false); } },
            { label: T('menu/bottomSide', 'Bottom Side (Mirrored)'), key: 'B', checked: function () { return viewer.view.flip; }, action: function () { cmd.viewSide(true); } }
        ];
    }

    cmd.renderMenu = function () {
        var r = $('btnRender').getBoundingClientRect();
        UI.contextMenu(renderModeItems(), r.left, r.bottom + 4);
    };

    cmd.togglePanel = function () {
        if (window.innerWidth <= 820) {
            document.body.classList.toggle('panel-open');
        } else {
            document.body.classList.toggle('panel-hidden');
        }
        setTimeout(onResize, 30);
        updateToolbar();
    };

    cmd.fullscreen = function () {
        document.body.classList.toggle('zen');
        var standalone = !(typeof ao_module_virtualDesktop !== 'undefined' && ao_module_virtualDesktop);
        if (standalone && document.fullscreenEnabled) {
            if (document.body.classList.contains('zen') && !document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(function () { });
            } else if (document.fullscreenElement) {
                document.exitFullscreen().catch(function () { });
            }
        }
        setTimeout(onResize, 60);
        updateToolbar();
    };

    cmd.toggleSetting = function (key) {
        state.settings[key] = !state.settings[key];
        S.saveSettings(state.settings);
        if (key === 'minimap') {
            renderMinimap();
        }
        if (key === 'tips') {
            $('tipCard').hidden = !state.settings.tips;
        }
        updateToolbar();
        viewer.requestRender();
    };

    cmd.showAll = function () {
        if (!state.project) {
            return;
        }
        state.project.layers.forEach(function (l) { l.visible = true; });
        layersChanged();
    };

    cmd.hideAll = function () {
        if (!state.project) {
            return;
        }
        state.project.layers.forEach(function (l) { l.visible = false; });
        layersChanged();
    };

    cmd.showSide = function (side) {
        if (!state.project) {
            return;
        }
        state.project.layers.forEach(function (l) {
            var s = sideOf(l);
            l.visible = s === side || l.type === 'outline' || l.type === 'drill';
            if (/mask|paste|assembly/.test(l.type)) {
                l.visible = false;
            }
        });
        layersChanged();
    };

    cmd.copperOnly = function () {
        if (!state.project) {
            return;
        }
        state.project.layers.forEach(function (l) { l.visible = /copper|outline|drill/.test(l.type); });
        layersChanged();
    };

    cmd.resetColors = function () {
        if (!state.project) {
            return;
        }
        state.project.layers.forEach(function (l) {
            l.color = defaultColor(l.type);
            l.opacity = defaultOpacity(l.type);
        });
        layersChanged();
    };

    cmd.resetOrder = function () {
        if (!state.project) {
            return;
        }
        state.project.layers = sortDefault(state.project.layers);
        layersChanged();
    };

    cmd.resetLayers = function () {
        if (!state.project) {
            return;
        }
        state.project.layers.forEach(function (l) {
            applyType(l, L.identify(l.name, l.text, l.image).type, true);
        });
        state.project.layers = sortDefault(state.project.layers);
        layersChanged({ rebuildBoard: true });
    };

    cmd.layerMenu = function () {
        var b = document.querySelector('[data-cmd=layerMenu]').getBoundingClientRect();
        UI.contextMenu(layersMenuItems(), b.left - 180, b.bottom + 4);
    };

    cmd.cycleLayer = function (d) {
        var p = state.project;
        if (!p || !p.layers.length) {
            return;
        }
        var i = p.layers.findIndex(function (l) { return l.id === state.selectedLayer; });
        i = i < 0 ? 0 : (i + d + p.layers.length) % p.layers.length;
        selectLayer(p.layers[i].id, false);
    };

    cmd.copyCursor = function () {
        if (state.cursor) {
            copyText(fmtXY(state.cursor[0], state.cursor[1]));
        }
    };

    cmd.copyImage = function () {
        if (!state.project) {
            return;
        }
        var src = state.dim === '3d' && view3d ? null : $('cvBase');
        var p = src ? GV.exporter.canvasBlob(src) : fetch(view3d.snapshot()).then(function (r) { return r.blob(); });
        p.then(function (blob) {
            if (!navigator.clipboard || !window.ClipboardItem) {
                throw new Error(T('toast/noClipboard', 'Clipboard images are not supported here'));
            }
            return navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        }).then(function () {
            UI.toast(T('toast/imageCopied', 'View copied to the clipboard'), { icon: 'check' });
        }, function (e) {
            UI.toast(T('toast/copyFailed', 'Unable to copy: {error}', { error: errText(e) }), { type: 'error' });
        });
    };

    cmd.setOriginTool = function () {
        setTool('origin');
        UI.toast(T('toast/pickOrigin', 'Click a point to use as the origin. Esc cancels.'), { icon: 'target' });
    };

    cmd.resetOrigin = function () {
        state.origin = [0, 0];
        updateCoords();
        renderProps();
        viewer.renderOverlay();
    };

    cmd.originToBoard = function () {
        var b = state.project && state.project.board;
        if (b && G.boundsValid(b.bounds)) {
            state.origin = [b.bounds[0], b.bounds[1]];
            updateCoords();
            renderProps();
            viewer.renderOverlay();
            UI.toast(T('toast/originCorner', 'Origin moved to the lower-left corner of the board'), { icon: 'target' });
        }
    };

    /* ==================================================================
        3D
    ================================================================== */
    var build3DTimer = 0;
    var built3DFor = null;      //project last shown in 3D
    function schedule3D() {
        clearTimeout(build3DTimer);
        build3DTimer = setTimeout(build3D, 250);
    }

    function boardTexture(side, lk) {
        var p = state.project;
        var b = p.board.bounds;
        var w = b[2] - b[0], h = b[3] - b[1];
        var maxTex = Math.min(view3d.maxTexture(), 4096);
        var pxmm = Math.min(30, maxTex / Math.max(w, h));
        return R.renderToCanvas({
            mode: 'realistic',
            side: side,
            layers: [],
            all: p.layers,
            board: p.board,
            background: null,
            look: lk || look()
        }, { cx: (b[0] + b[2]) / 2, cy: (b[1] + b[3]) / 2, scale: pxmm, rot: 0, flip: false }, w * pxmm, h * pxmm);
    }

    async function build3D() {
        if (state.dim !== '3d' || !state.project) {
            return;
        }
        var p = state.project;
        if (!p.board || !p.board.outer.length) {
            UI.toast(T('toast/no3d', 'The 3D view needs a board outline or copper layers.'), { type: 'error' });
            return;
        }
        try {
            if (!view3d) {
                if (!view3dLoading) {
                    showLoading(T('loading/3dStart', 'Starting 3D view...'));
                    view3dLoading = import('./view3d.js').then(function (mod) {
                        view3d = mod.createView($('view3d'));
                        return view3d;
                    });
                }
                await view3dLoading;
                hideLoading();
            }
            showLoading(T('loading/3dBuild', 'Building 3D board...'));
            await nextTick();
            //The camera framing needs the real aspect ratio
            view3d.resize();
            //The manufacturing preview (mfg.js) swaps in the fab's options
            var mf = GV.mfg && GV.mfg.active() ? GV.mfg.build() : null;
            var lk = mf ? mf.look : look();
            //Rebuilding the same project (option changes) keeps the camera
            var keepView = built3DFor === p;
            built3DFor = p;
            view3d.setBoard({
                board: p.board,
                thickness: mf ? mf.thickness : state.settings.thickness,
                top: boardTexture('top', lk),
                bottom: boardTexture('bottom', lk),
                edge: lk.edge,
                barrel: lk.finish,
                background: state.settings.canvasBg,
                slotContour: GV.board.slotContour,
                fillVias: !!(mf && mf.fillVias),
                stack: mf ? mf.stack : null,
                panel: mf ? mf.panel : null,
                keepView: keepView
            });
            hideLoading();
            view3d.resize();
            view3d.start();
        } catch (e) {
            hideLoading();
            console.error(e);
            UI.toast(T('toast/3dFailed', 'Unable to start the 3D view: {error}', { error: errText(e) }), { type: 'error' });
            setDim('2d');
        }
    }

    function setDim(d) {
        if (d === '3d' && !state.project) {
            return;
        }
        state.dim = d;
        $('view3d').hidden = d !== '3d';
        $('cvBase').hidden = d === '3d';
        $('cvOverlay').hidden = d === '3d';
        $('measureBox').hidden = d === '3d' || !state.measure;
        if (d === '3d') {
            build3D();
        } else if (view3d) {
            view3d.stop();
            viewer.requestRender();
        }
        renderMinimap();
        updateToolbar();
        if (GV.mfg) {
            GV.mfg.dimChanged(d);
        }
    }

    cmd.dim2d = function () { setDim('2d'); };
    cmd.dim3d = function () { setDim('3d'); };
    cmd.toggle3D = function () { setDim(state.dim === '3d' ? '2d' : '3d'); };

    /* ==================================================================
        Menus
    ================================================================== */
    function layersMenuItems() {
        var has = function () { return !!state.project; };
        return [
            { label: T('menu/showAll', 'Show All Layers'), icon: 'eye', enabled: has, action: cmd.showAll },
            { label: T('menu/hideAll', 'Hide All Layers'), icon: 'eye-off', enabled: has, action: cmd.hideAll },
            { label: T('menu/topOnly', 'Top Side Only'), enabled: has, action: function () { cmd.showSide('top'); } },
            { label: T('menu/bottomOnly', 'Bottom Side Only'), enabled: has, action: function () { cmd.showSide('bottom'); } },
            { label: T('menu/copperOnly', 'Copper Only'), enabled: has, action: cmd.copperOnly },
            { sep: true },
            { label: T('menu/prevLayer', 'Previous Layer'), key: 'PgUp', enabled: has, action: function () { cmd.cycleLayer(-1); } },
            { label: T('menu/nextLayer', 'Next Layer'), key: 'PgDn', enabled: has, action: function () { cmd.cycleLayer(1); } },
            { sep: true },
            { label: T('menu/resetColours', 'Reset Layer Colours'), icon: 'palette', enabled: has, action: cmd.resetColors },
            { label: T('menu/resetOrder', 'Reset Layer Order'), enabled: has, action: cmd.resetOrder },
            { label: T('menu/redetect', 'Re-detect Layer Types'), icon: 'refresh', enabled: has, action: cmd.resetLayers }
        ];
    }

    function buildMenus() {
        var has = function () { return !!state.project; };
        var online = function () { return S.online; };
        var is2d = function () { return !!state.project && state.dim === '2d'; };
        return [
            {
                id: 'file', label: T('menu/file', 'File'), items: [
                    { label: T('menu/openAroz', 'Open from ArozOS...'), icon: 'drive', key: 'Ctrl+O', enabled: online, action: cmd.openAroz },
                    { label: T('menu/openArozFolder', 'Open Folder from ArozOS...'), icon: 'folder', enabled: online, action: cmd.openArozFolder },
                    { label: T('menu/openLocal', 'Open from This Device...'), icon: 'laptop', key: 'Ctrl+Shift+O', action: cmd.openLocal },
                    { label: T('menu/openLocalFolder', 'Open Folder from This Device...'), icon: 'folder', action: cmd.openLocalFolder },
                    { label: T('menu/openRecent', 'Open Recent'), icon: 'clock', submenu: recentMenu },
                    { sep: true },
                    { label: T('menu/addAroz', 'Add Layers from ArozOS...'), icon: 'file-plus', enabled: function () { return has() && online(); }, action: cmd.addAroz },
                    { label: T('menu/addLocal', 'Add Layers from This Device...'), icon: 'file-plus', enabled: has, action: cmd.addLocal },
                    { sep: true },
                    { label: T('menu/reload', 'Reload Project'), icon: 'refresh', key: 'Ctrl+Shift+R', enabled: has, action: cmd.reload },
                    { label: T('menu/close', 'Close Project'), icon: 'close', enabled: has, action: cmd.close },
                    { sep: true },
                    { label: T('menu/export', 'Export Image...'), icon: 'image', key: 'Ctrl+E', enabled: has, action: function () { cmd.exportDialog(); } },
                    { label: T('menu/saveZip', 'Save Project as ZIP...'), icon: 'zip', key: 'Ctrl+S', enabled: has, action: function () { cmd.saveZip(); } },
                    { label: T('menu/exportCsv', 'Export Drill Table (CSV)...'), icon: 'table', enabled: function () { return has() && state.project.layers.some(function (l) { return l.type === 'drill'; }); }, action: function () { cmd.exportDrillCSV(); } },
                    { label: T('menu/print', 'Print...'), icon: 'print', key: 'Ctrl+P', enabled: has, action: function () { cmd.printDialog(); } },
                    { sep: true },
                    { label: T('menu/exit', 'Exit'), icon: 'close', action: function () { try { ao_module_close(); } catch (e) { window.close(); } } }
                ]
            },
            {
                id: 'edit', label: T('menu/edit', 'Edit'), items: [
                    { label: T('menu/copyCursor', 'Copy Cursor Coordinates'), icon: 'crosshair', key: 'Ctrl+Shift+C', enabled: function () { return !!state.cursor; }, action: cmd.copyCursor },
                    { label: T('menu/copyImage', 'Copy View as Image'), icon: 'image', key: 'Ctrl+Shift+I', enabled: has, action: cmd.copyImage },
                    { sep: true },
                    { label: T('menu/clearSelection', 'Clear Selection'), icon: 'pointer', key: 'Esc', enabled: function () { return !!state.selection; }, action: function () { setSelection(null); } },
                    { label: T('menu/clearMeasure', 'Clear Measurement'), icon: 'ruler', enabled: function () { return !!state.measure; }, action: cmd.clearMeasure },
                    { sep: true },
                    { label: T('menu/preferences', 'Preferences...'), icon: 'gear', key: 'Ctrl+,', action: function () { cmd.settingsDialog(); } }
                ]
            },
            {
                id: 'view', label: T('menu/view', 'View'), items: [
                    { label: T('menu/2d', '2D View'), key: '2', checked: function () { return state.dim === '2d'; }, enabled: has, action: cmd.dim2d },
                    { label: T('menu/3d', '3D View'), icon: 'cube', key: '3', checked: function () { return state.dim === '3d'; }, enabled: has, action: cmd.dim3d },
                    { sep: true },
                    { label: T('menu/layerView', 'Layer View'), icon: 'layers', checked: function () { return state.mode === 'layers'; }, enabled: is2d, action: function () { cmd.setMode('layers'); } },
                    { label: T('menu/realistic', 'Realistic Preview'), icon: 'board', key: 'P', checked: function () { return state.mode === 'realistic'; }, enabled: is2d, action: function () { cmd.setMode('realistic'); } },
                    { label: T('menu/viewBottom', 'View Bottom Side'), icon: 'flip', key: 'B', checked: function () { return viewer.view.flip; }, enabled: has, action: cmd.flip },
                    { label: T('menu/rotate', 'Rotate 90°'), icon: 'rotate', key: 'R', enabled: is2d, action: cmd.rotate },
                    { sep: true },
                    { label: T('menu/zoomIn', 'Zoom In'), icon: 'zoom', key: '+', enabled: is2d, action: cmd.zoomIn },
                    { label: T('menu/zoomOut', 'Zoom Out'), icon: 'zoom-out', key: '-', enabled: is2d, action: cmd.zoomOut },
                    { label: T('menu/zoomFit', 'Zoom to Fit'), icon: 'fit', key: 'F', enabled: has, action: cmd.fit },
                    { label: T('menu/actualSize', 'Actual Size (1:1)'), key: '1', enabled: is2d, action: function () { cmd.zoomTo(1); } },
                    { label: T('menu/zoomSelection', 'Zoom to Selection'), enabled: function () { return !!state.selection; }, action: function () { zoomToBounds(state.selection.item.b, 6); } },
                    { sep: true },
                    { label: T('menu/grid', 'Grid'), key: 'G', checked: function () { return state.settings.grid; }, action: function () { cmd.toggleSetting('grid'); } },
                    { label: T('menu/crosshair', 'Crosshair Cursor'), key: 'C', checked: function () { return state.settings.crosshair; }, action: function () { cmd.toggleSetting('crosshair'); } },
                    { label: T('menu/minimap', 'Minimap'), checked: function () { return state.settings.minimap; }, action: function () { cmd.toggleSetting('minimap'); } },
                    { label: T('menu/tips', 'Tips'), checked: function () { return state.settings.tips; }, action: function () { cmd.toggleSetting('tips'); } },
                    { sep: true },
                    { label: T('menu/sidePanel', 'Side Panel'), icon: 'panel', key: 'Ctrl+B', checked: function () { return !document.body.classList.contains('panel-hidden'); }, action: cmd.togglePanel },
                    { label: T('menu/focus', 'Focus Mode'), icon: 'expand', key: 'Shift+F', checked: function () { return document.body.classList.contains('zen'); }, action: cmd.fullscreen },
                    { label: T('menu/theme', 'Theme'), icon: 'sun', submenu: function () {
                        return ['system', 'light', 'dark'].map(function (t) {
                            return {
                                label: t === 'system' ? T('theme/system', 'Follow ArozOS') : (t === 'light' ? T('theme/light', 'Light') : T('theme/dark', 'Dark')),
                                checked: state.settings.theme === t,
                                action: function () { state.settings.theme = t; applyTheme(); S.saveSettings(state.settings); }
                            };
                        });
                    } },
                    { label: T('menu/units', 'Units'), submenu: function () {
                        return [['mm', T('unit/mmLong', 'Millimetres')], ['in', T('unit/inLong', 'Inches')], ['mil', T('unit/milLong', 'Mils')]].map(function (u) {
                            return { label: u[1], checked: state.settings.units === u[0], action: function () { setUnits(u[0]); } };
                        });
                    } }
                ]
            },
            { id: 'layers', label: T('menu/layers', 'Layers'), items: layersMenuItems },
            {
                id: 'tools', label: T('menu/tools', 'Tools'), items: [
                    { label: T('menu/select', 'Select'), icon: 'pointer', key: 'V', checked: function () { return state.tool === 'select'; }, enabled: is2d, action: function () { setTool('select'); } },
                    { label: T('menu/pan', 'Pan'), icon: 'hand', key: 'H', checked: function () { return state.tool === 'pan'; }, enabled: is2d, action: function () { setTool('pan'); } },
                    { label: T('menu/zoomArea', 'Zoom to Area'), icon: 'zoom', key: 'Z', checked: function () { return state.tool === 'zoom'; }, enabled: is2d, action: function () { setTool('zoom'); } },
                    { label: T('menu/measure', 'Measure'), icon: 'ruler', key: 'M', checked: function () { return state.tool === 'measure'; }, enabled: is2d, action: function () { setTool('measure'); } },
                    { label: T('menu/snap', 'Snap to Features'), checked: function () { return state.settings.snap; }, action: function () { cmd.toggleSetting('snap'); } },
                    { sep: true },
                    { label: T('menu/setOrigin', 'Set Origin...'), icon: 'target', enabled: is2d, action: cmd.setOriginTool },
                    { label: T('menu/originCorner', 'Origin at Board Corner'), enabled: has, action: cmd.originToBoard },
                    { label: T('menu/resetOrigin', 'Reset Origin'), enabled: function () { return state.origin[0] !== 0 || state.origin[1] !== 0; }, action: cmd.resetOrigin },
                    { label: T('menu/goto', 'Go to Coordinate...'), icon: 'crosshair', key: 'Ctrl+G', enabled: is2d, action: function () { cmd.gotoDialog(); } },
                    { sep: true },
                    { label: T('menu/drillTable', 'Drill Table...'), icon: 'drill', enabled: function () { return has() && state.project.layers.some(function (l) { return l.type === 'drill'; }); }, action: function () { cmd.drillTable(); } },
                    { label: T('menu/apertureTable', 'Aperture Table...'), icon: 'table', enabled: has, action: function () { cmd.apertureTable(); } },
                    { label: T('menu/boardReport', 'Board Report...'), icon: 'board', enabled: has, action: function () { cmd.boardReport(); } },
                    { label: T('menu/viewLayerSource', 'View Layer Source...'), icon: 'code', enabled: has, action: function () { cmd.viewSource(); } },
                    { sep: true },
                    { label: T('menu/mfg', 'Manufacturing Capabilities Preview...'), icon: 'factory', enabled: has, action: function () { cmd.mfgPreview(); } }
                ]
            },
            {
                id: 'help', label: T('menu/help', 'Help'), items: [
                    { label: T('menu/shortcuts', 'Keyboard Shortcuts'), icon: 'keyboard', key: '?', action: function () { cmd.shortcuts(); } },
                    { label: T('menu/formats', 'Supported Formats'), icon: 'file', action: function () { cmd.formats(); } },
                    { sep: true },
                    { label: T('menu/about', 'About Gerber Viewer'), icon: 'info', action: function () { cmd.about(); } }
                ]
            }
        ];
    }

    function setUnits(u) {
        state.settings.units = u;
        S.saveSettings(state.settings);
        updateCoords();
        renderFileInfo();
        renderProps();
        renderMeasureBox();
        updateTitle();
        viewer.requestRender();
    }

    /* ==================================================================
        Keyboard
    ================================================================== */
    function bindKeys() {
        document.addEventListener('keydown', function (e) {
            if (UI.isMenuOpen() && UI.menuKey(e)) {
                e.preventDefault();
                return;
            }
            if (UI.hasDialog()) {
                if (UI.dialogKey(e) && (e.key === 'Escape' || e.key === 'Enter')) {
                    e.preventDefault();
                }
                return;
            }
            if (UI.hasPopover() && e.key === 'Escape') {
                UI.closePopover();
                return;
            }
            var t = e.target;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) {
                return;
            }
            var k = e.key;
            var ctrl = e.ctrlKey || e.metaKey;
            var handled = true;
            if (ctrl) {
                var lk = k.toLowerCase();
                if (lk === 'o' && e.shiftKey) {
                    cmd.openLocal();
                } else if (lk === 'o') {
                    if (S.online) {
                        cmd.openAroz();
                    } else {
                        cmd.openLocal();
                    }
                } else if (lk === 'e' && state.project) {
                    cmd.exportDialog();
                } else if (lk === 's' && state.project) {
                    cmd.saveZip();
                } else if (lk === 'p' && state.project) {
                    cmd.printDialog();
                } else if (lk === ',') {
                    cmd.settingsDialog();
                } else if (lk === 'g' && state.project) {
                    cmd.gotoDialog();
                } else if (lk === 'b') {
                    cmd.togglePanel();
                } else if (lk === 'c' && e.shiftKey) {
                    cmd.copyCursor();
                } else if (lk === 'i' && e.shiftKey) {
                    cmd.copyImage();
                } else if (lk === 'r' && e.shiftKey) {
                    cmd.reload();
                } else {
                    handled = false;
                }
            } else if (k === 'Escape') {
                if (state.zoomRect) {
                    state.zoomRect = null;
                } else if (state.measure) {
                    cmd.clearMeasure();
                } else if (state.selection) {
                    setSelection(null);
                } else if (state.tool !== 'select') {
                    setTool('select');
                } else if (document.body.classList.contains('zen')) {
                    cmd.fullscreen();
                }
                viewer.renderOverlay();
            } else if (k === ' ') {
                if (!ptr.space) {
                    ptr.space = true;
                    $('cvOverlay').classList.add('tool-pan');
                }
            } else if (k === '?' || k === 'F1') {
                cmd.shortcuts();
            } else if (!state.project) {
                handled = false;
            } else if (k === 'F' && e.shiftKey) {
                cmd.fullscreen();
            } else if (e.altKey) {
                handled = false;
            } else {
                switch (k.toLowerCase()) {
                    case 'v': setTool('select'); break;
                    case 'h': setTool('pan'); break;
                    case 'z': setTool('zoom'); break;
                    case 'm': setTool('measure'); break;
                    case 'f': cmd.fit(); break;
                    case 'r': cmd.rotate(); break;
                    case 'b': cmd.flip(); break;
                    case 'p': cmd.toggleRealistic(); break;
                    case 'g': cmd.toggleSetting('grid'); break;
                    case 'c': cmd.toggleSetting('crosshair'); break;
                    case '2': setDim('2d'); break;
                    case '3': setDim('3d'); break;
                    case '1': cmd.zoomTo(1); break;
                    case '+': case '=': cmd.zoomIn(); break;
                    case '-': case '_': cmd.zoomOut(); break;
                    case 'pageup': cmd.cycleLayer(-1); break;
                    case 'pagedown': cmd.cycleLayer(1); break;
                    case 'arrowleft': viewer.panBy(80, 0); break;
                    case 'arrowright': viewer.panBy(-80, 0); break;
                    case 'arrowup': viewer.panBy(0, 80); break;
                    case 'arrowdown': viewer.panBy(0, -80); break;
                    default: handled = false;
                }
            }
            if (handled) {
                e.preventDefault();
            }
        });
        document.addEventListener('keyup', function (e) {
            if (e.key === ' ') {
                ptr.space = false;
                $('cvOverlay').classList.remove('tool-pan');
                setTool(state.tool);
            }
        });
    }

    /* ==================================================================
        Boot
    ================================================================== */
    function onResize() {
        viewer.resize();
        state.miniCache = null;
        renderMinimap();
        if (view3d && state.dim === '3d') {
            view3d.resize();
        }
        updateToolbar();
    }

    function bindChrome() {
        document.addEventListener('click', function (e) {
            var b = e.target.closest('[data-cmd]');
            if (b && !b.disabled && cmd[b.dataset.cmd]) {
                cmd[b.dataset.cmd]();
            }
            var t = e.target.closest('[data-tool]');
            if (t && !t.disabled) {
                setTool(t.dataset.tool);
            }
            var d = e.target.closest('[data-dim]');
            if (d && !d.disabled) {
                setDim(d.dataset.dim);
            }
            var v3 = e.target.closest('[data-view3d]');
            if (v3 && view3d) {
                view3d.setView(v3.dataset.view3d);
            }
            var tab = e.target.closest('.tabs [data-tab]');
            if (tab) {
                setTab(tab.dataset.tab);
            }
        });
        $('tipNext').addEventListener('click', nextTip);
        $('btnCrosshair').addEventListener('click', function () { cmd.toggleSetting('crosshair'); });
        $('btnZoom').addEventListener('click', function () {
            var r = this.getBoundingClientRect();
            var items = [
                { label: T('menu/zoomFit', 'Zoom to Fit'), icon: 'fit', key: 'F', action: cmd.fit }, { sep: true }
            ].concat([10, 5, 4, 2, 1, 0.5, 0.25].map(function (z) {
                return {
                    label: z === 1 ? T('zoom/actual', '1:1 (actual size)') : (z > 1 ? z + ':1' : '1:' + (1 / z)),
                    action: function () { cmd.zoomTo(z); }
                };
            }));
            var menu = UI.showMenu(items, r.left, r.top, { level: 0 });
            menu.style.top = Math.max(4, r.top - menu.getBoundingClientRect().height - 6) + 'px';
        });
        window.addEventListener('resize', onResize);
        if (window.ResizeObserver) {
            new ResizeObserver(function () { onResize(); }).observe($('stage'));
        }
    }

    function applySettings(s) {
        state.settings = Object.assign({}, DEFAULTS, s || {});
        state.settings.layerColors = Object.assign({}, (s && s.layerColors) || {});
        applyTheme();
        $('tipCard').hidden = !state.settings.tips;
    }

    //Load locale/gerberviewer.json, translate the static markup, then resolve.
    //A missing or broken locale file just leaves the English text.
    function loadLocale() {
        return new Promise(function (resolve) {
            if (typeof applocale === 'undefined' || !applocale) {
                resolve();
                return;
            }
            applocale.init('locale/gerberviewer.json', function () {
                try {
                    applocale.translate();
                } catch (e) {
                    //Keep the English markup
                }
                resolve();
            }, resolve);
        });
    }

    async function boot() {
        await loadLocale();
        viewer = new GV.Viewer($('cvBase'), $('cvOverlay'));
        viewer.getScene = function () { return scene(false); };
        viewer.drawOverlay = drawOverlay;
        viewer.onViewChange = function () {
            updateZoomLabel();
            renderMinimapViewport();
            if (state.settings.grid) {
                viewer.requestRender();
            }
        };
        GV.app.viewer = viewer;
        initTheme();
        UI.menubar($('menubarItems'), buildMenus());
        bindChrome();
        bindViewer();
        bindMinimap();
        bindKeys();
        bindDrop();
        bindFileInputs();
        updateTitle();
        renderLayerList();
        renderFileInfo();
        renderProps();
        nextTip();
        setTool('select');
        viewer.resize();
        updateZoomLabel();

        var boot = await S.boot();
        applySettings(boot.settings);
        renderRecentGrid();
        updateToolbar();
        if (!S.online) {
            document.querySelectorAll('[data-cmd=openAroz]').forEach(function (b) {
                b.disabled = true;
                b.title = T('title/offline', 'ArozOS is not reachable from this page');
            });
        }

        var input = null;
        try {
            input = ao_module_loadInputFiles();
        } catch (e) {
            input = null;
        }
        if (input && input.length && S.online) {
            openFromAroz(input.map(function (f) { return f.filepath; }));
        } else if (state.settings.restoreLast && S.recent.length) {
            openRecent(S.recent[0]);
        }
    }

    GV.app = {
        state: state,
        cmd: cmd,
        viewer: null,
        DEFAULTS: DEFAULTS,
        MASKS: MASKS,
        SILKS: SILKS,
        FINISHES: FINISHES,
        BACKGROUNDS: BACKGROUNDS,
        PALETTE: PALETTE,
        look: look,
        scene: scene,
        drawOrder: drawOrder,
        projectBounds: projectBounds,
        fmtLen: fmtLen,
        fmtXY: fmtXY,
        fmtSize: fmtSize,
        fmtBytes: fmtBytes,
        fmtDate: fmtDate,
        unitInfo: unitInfo,
        layerById: layerById,
        layersChanged: layersChanged,
        applySettings: applySettings,
        applyTheme: applyTheme,
        defaultColor: defaultColor,
        layerLabel: layerLabel,
        warningTexts: warningTexts,
        reasonText: reasonText,
        errText: errText,
        apertureDesc: apertureDesc,
        kindLabel: kindLabel,
        T: T,
        setUnits: setUnits,
        zoomToBounds: zoomToBounds,
        renderLayerList: renderLayerList,
        renderMinimap: renderMinimap,
        updateToolbar: updateToolbar,
        schedule3D: schedule3D,
        get3D: function () { return view3d; },
        setDim: setDim,
        nextTip: nextTip,
        boardSummary: null,
        setMarker: function (pt) {
            state.marker = pt;
            viewer.renderOverlay();
        }
    };

    window.addEventListener('DOMContentLoaded', boot);
})(window.GV = window.GV || {});
