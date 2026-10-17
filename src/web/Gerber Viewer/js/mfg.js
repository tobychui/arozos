/*
    Gerber Viewer - Manufacturing Capabilities Preview

    A panel in the 3D view that mirrors a PCB manufacturer's order form
    (board material, layers, thickness, solder mask and
    silkscreen colour, via covering, surface finish, delivery format and
    panelisation) and re-renders the 3D board the way it would be made.

    The choices are kept in state.settings.mfg. build() turns them into the
    look used for the face textures plus the stack-up and panel layout that
    view3d.js draws.
*/
(function (GV) {
    'use strict';

    var app = GV.app, cmd = app.cmd, state = app.state;
    var UI = GV.ui, S = GV.store;
    var icon = UI.icon, esc = UI.esc, T = UI.t;

    //Board materials and what each one can be ordered with
    //defThick: thickness picked when switching to the material
    var MATERIALS = {
        fpc: { label: 'FPC (flexible)', layers: [1, 2, 4], thick: [0.07, 0.11, 0.12, 0.2], defThick: 0.12,
            core: '#c9831c', substrate: '#6b3f0d', coverlay: true },
        fr4: { label: 'FR-4', layers: [1, 2, 4, 6, 8, 10, 12, 14, 16, 20], thick: [0.4, 0.6, 0.8, 1.0, 1.2, 1.6, 2.0, 2.5, 3.2],
            defThick: 1.6, core: '#c8b27a', substrate: '#3c3923' }
    };
    var MATERIAL_ORDER = ['fpc', 'fr4'];
    //Outer copper is drawn as standard 1 oz
    var COPPER_OZ = 1;
    var MASK_ORDER = ['green', 'red', 'yellow', 'blue', 'white', 'matte', 'purple'];
    var FINISHES = {
        osp: { label: 'Lead-free OSP', color: '#c98048' },
        hasl: { label: 'Leaded HASL', color: '#c8ccd1' },
        haslLF: { label: 'Lead-free HASL', color: '#d3d7dc' },
        enig: { label: 'ENIG (immersion gold)', color: '#d9b45c' }
    };
    var VIAS = [
        ['tent', 'Tented'], ['open', 'Untented'], ['plug', 'Plugged with mask'],
        ['resin', 'Resin filled + capped'], ['paste', 'Copper paste + capped']
    ];
    var COVERLAY = { color: '#d08a1c', alpha: 0.72 };

    var DEFAULTS = {
        on: false,
        material: 'fr4',
        layers: 2,
        thickness: 1.6,
        mask: 'green',
        silk: 'white',
        via: 'tent',
        finish: 'haslLF',
        delivery: 'single',
        cols: 2,
        rows: 4,
        separation: 'vcut',
        rails: 'tb',
        railWidth: 5
    };

    function opts() {
        if (!state.settings.mfg) {
            state.settings.mfg = Object.assign({}, DEFAULTS);
        }
        var o = state.settings.mfg;
        Object.keys(DEFAULTS).forEach(function (k) {
            if (o[k] === undefined) {
                o[k] = DEFAULTS[k];
            }
        });
        return o;
    }

    //Snap values the chosen material cannot be ordered with
    function nearest(list, v) {
        return list.reduce(function (a, b) { return Math.abs(b - v) < Math.abs(a - v) ? b : a; }, list[0]);
    }

    function normalise(o) {
        if (!MATERIALS[o.material]) {
            o.material = 'fr4';
        }
        var m = MATERIALS[o.material];
        o.layers = m.layers.indexOf(o.layers) >= 0 ? o.layers : nearest(m.layers, o.layers);
        o.thickness = m.thick.indexOf(o.thickness) >= 0 ? o.thickness : m.defThick;
        if (o.delivery !== 'single' && o.delivery !== 'maker') {
            o.delivery = 'single';
        }
        o.cols = Math.max(1, Math.min(10, Math.round(o.cols) || 1));
        o.rows = Math.max(1, Math.min(10, Math.round(o.rows) || 1));
        if (o.via === 'paste') {
            o.via = 'resin';
        }
    }

    function active() {
        return !!(state.project && opts().on);
    }

    /* ------------------------------------------------------------------
        Render inputs
    ------------------------------------------------------------------ */
    function build() {
        var o = opts();
        normalise(o);
        var m = MATERIALS[o.material];
        var mask = app.MASKS[o.mask] || app.MASKS.green;
        var finish = (FINISHES[o.finish] || FINISHES.haslLF).color;
        var maskColor = m.coverlay ? COVERLAY.color : mask.color;
        var look = {
            substrate: m.substrate,
            copper: '#b8743a',
            mask: maskColor,
            maskAlpha: m.coverlay ? COVERLAY.alpha : mask.alpha,
            silk: o.silk === 'black' ? '#141414' : '#f2f2f2',
            finish: finish,
            edge: m.core,
            via: o.via
        };
        var panel = null;
        if (o.delivery === 'maker') {
            panel = {
                cols: o.cols,
                rows: o.rows,
                separation: o.separation,
                gap: 2,
                rails: o.rails,
                railWidth: o.railWidth,
                faceColor: blend(maskColor, m.substrate, m.coverlay ? COVERLAY.alpha : mask.alpha),
                finish: finish
            };
        }
        return {
            look: look,
            thickness: o.thickness,
            fillVias: o.via === 'plug' || o.via === 'resin' || o.via === 'tent',
            stack: {
                layers: o.layers,
                copperOz: COPPER_OZ,
                core: m.core,
                base: m.base || null,
                baseRatio: 0.85,
                metal: !!m.metal,
                mask: maskColor,
                copper: '#c98a4b'
            },
            panel: panel
        };
    }

    function blend(a, b, alpha) {
        function rgb(c) {
            var v = parseInt(c.slice(1), 16);
            return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
        }
        var x = rgb(a), y = rgb(b);
        var out = x.map(function (c, i) { return Math.round(c * alpha + y[i] * (1 - alpha)); });
        return '#' + out.map(function (c) { return (c < 16 ? '0' : '') + c.toString(16); }).join('');
    }

    /* ------------------------------------------------------------------
        Summary numbers
    ------------------------------------------------------------------ */
    function summary() {
        var o = opts();
        var b = state.project && state.project.board;
        var w = b ? b.width : 0, h = b ? b.height : 0;
        var out = { boardW: w, boardH: h, perPanel: 1, panelW: w, panelH: h, notes: [] };
        if (o.delivery === 'maker') {
            var gap = o.separation === 'vcut' ? 0 : 2;
            out.perPanel = o.cols * o.rows;
            out.panelW = o.cols * w + (o.cols - 1) * gap;
            out.panelH = o.rows * h + (o.rows - 1) * gap;
            if (o.rails === 'tb' || o.rails === 'all') {
                out.panelH += 2 * (o.railWidth + gap);
            }
            if (o.rails === 'lr' || o.rails === 'all') {
                out.panelW += 2 * (o.railWidth + gap);
            }
            if (o.separation === 'vcut' && b && !b.rect) {
                out.notes.push(T('mfg/noteVcut', 'V-cut needs straight board edges. This outline is not a plain rectangle, so stamp holes are the safer choice.'));
            }
            if (out.panelW > 500 || out.panelH > 500) {
                out.notes.push(T('mfg/noteLarge', 'The panel is larger than 500 mm on one side, beyond what most fabs accept.'));
            }
        }
        if (o.material === 'fpc') {
            out.notes.push(T('mfg/noteFpc', 'Flexible boards are covered with an amber polyimide coverlay instead of a coloured solder mask.'));
        }
        if (o.via === 'tent') {
            out.notes.push(T('mfg/noteTent', 'Tented vias keep their hole; the mask only covers the ring, so a small dimple stays visible.'));
        }
        return out;
    }

    /* ------------------------------------------------------------------
        Panel UI
    ------------------------------------------------------------------ */
    var panelOpen = false;
    var rebuildTimer = 0;
    var saveTimer = 0;

    function changed() {
        normalise(opts());
        render();
        clearTimeout(saveTimer);
        saveTimer = setTimeout(function () { S.saveSettings(state.settings); }, 600);
        clearTimeout(rebuildTimer);
        rebuildTimer = setTimeout(function () { app.schedule3D(); }, 120);
    }

    function chips(key, list, current, disabled) {
        return '<div class="chips mfg-chips" data-mk="' + key + '">' + list.map(function (it) {
            var v = String(it[0]);
            var off = disabled && disabled(it[0]);
            return '<button type="button" data-v="' + esc(v) + '" class="' + (v === String(current) ? 'active' : '') + '"' + (off ? ' disabled' : '') + '>' +
                (it[2] ? '<span class="dot" style="--c:' + esc(it[2]) + '"></span>' : '') + esc(it[1]) + '</button>';
        }).join('') + '</div>';
    }

    function row(labelKey, label, body) {
        return '<div class="mfg-row"><div class="mfg-label">' + esc(T(labelKey, label)) + '</div>' + body + '</div>';
    }

    function stepper(key, value, min, max) {
        return '<div class="mfg-stepper" data-ms="' + key + '"><button type="button" data-d="-1"' + (value <= min ? ' disabled' : '') + '>' + icon('minus') +
            '</button><span>' + value + '</span><button type="button" data-d="1"' + (value >= max ? ' disabled' : '') + '>' + icon('plus') + '</button></div>';
    }

    function fmtMM(v) {
        return (Math.round(v * 100) / 100).toFixed(2) + ' mm';
    }

    function render() {
        var box = document.getElementById('mfgPanel');
        if (!box) {
            return;
        }
        box.hidden = !panelOpen || state.dim !== '3d';
        document.querySelectorAll('[data-view3d-mfg]').forEach(function (b) { b.classList.toggle('active', panelOpen); });
        //Keep the board visible beside the panel
        var stage = document.getElementById('stage');
        if (stage.classList.contains('mfg-open') !== !box.hidden) {
            stage.classList.toggle('mfg-open', !box.hidden);
            var v = app.get3D();
            if (v) {
                v.resize();
            }
        }
        if (box.hidden) {
            return;
        }
        var oldBody = box.querySelector('.mfg-body');
        var scroll = oldBody ? oldBody.scrollTop : 0;
        var o = opts();
        normalise(o);
        var m = MATERIALS[o.material];
        var sum = summary();
        var html = '<div class="mfg-h">' + icon('factory') + '<span>' + esc(T('mfg/title', 'Manufacturing Preview')) + '</span>' +
            '<label class="mfg-switch" title="' + esc(T('mfg/enableTitle', 'Render the board with these options')) + '"><input type="checkbox" data-mon' + (o.on ? ' checked' : '') + '>' +
            esc(T('mfg/enable', 'Preview')) + '</label>' +
            '<button class="iconbtn" data-mclose title="' + esc(T('common/close', 'Close')) + '">' + icon('close') + '</button></div>' +
            '<div class="mfg-body' + (o.on ? '' : ' off') + '">' +
            row('mfg/material', 'Board material', chips('material', MATERIAL_ORDER.map(function (k) { return [k, T('mat/' + k, MATERIALS[k].label)]; }), o.material)) +
            row('mfg/layers', 'Layers', chips('layers', m.layers.map(function (n) { return [n, String(n)]; }), o.layers)) +
            row('mfg/size', 'Board size', '<div class="mfg-value">' + esc(fmtMM(sum.boardW) + ' × ' + fmtMM(sum.boardH)) + '</div>') +
            '<div class="mfg-sep"></div>' +
            row('mfg/delivery', 'Delivery format', chips('delivery', [['single', T('mfg/single', 'Single')],
                ['maker', T('mfg/maker', 'Panelization')]], o.delivery)) +
            (o.delivery === 'maker' ?
                row('mfg/panel', 'Panel', '<div class="mfg-grid">' + stepper('cols', o.cols, 1, 10) + '<span class="mfg-x">×</span>' + stepper('rows', o.rows, 1, 10) +
                    '<span class="muted small">' + esc(T('mfg/panelHint', 'columns × rows')) + '</span></div>') +
                row('mfg/separation', 'Separation', chips('separation', [['vcut', T('mfg/vcut', 'V-cut')], ['tab', T('mfg/tab', 'Stamp holes')]], o.separation)) +
                row('mfg/rails', 'Edge rails', chips('rails', [['none', T('mfg/railsNone', 'None')], ['tb', T('mfg/railsTB', 'Top and bottom')],
                    ['lr', T('mfg/railsLR', 'Left and right')], ['all', T('mfg/railsAll', 'All sides')]], o.rails)) +
                (o.rails !== 'none' ? row('mfg/railWidth', 'Rail width', chips('railWidth', [[3, '3 mm'], [5, '5 mm'], [7, '7 mm'], [10, '10 mm']], o.railWidth)) : '')
                : '') +
            '<div class="mfg-sep"></div>' +
            row('mfg/thickness', 'Board thickness', chips('thickness', m.thick.map(function (t) { return [t, String(t)]; }), o.thickness)) +
            row('mfg/mask', 'Solder mask colour', chips('mask', MASK_ORDER.map(function (k) {
                return [k, T('mask/' + k, app.MASKS[k].label), app.MASKS[k].color];
            }), o.mask, function () { return !!m.coverlay; })) +
            row('mfg/silk', 'Silkscreen colour', chips('silk', [['white', T('silk/white', 'White'), '#f2f2f2'], ['black', T('silk/black', 'Black'), '#141414']], o.silk)) +
            row('mfg/via', 'Via covering', chips('via', VIAS.map(function (v) { return [v[0], T('via/' + v[0], v[1])]; }), o.via,
                function (v) { return v === 'paste'; })) +
            row('mfg/finish', 'Surface finish', chips('finish', Object.keys(FINISHES).map(function (k) {
                return [k, T('mfin/' + k, FINISHES[k].label), FINISHES[k].color];
            }), o.finish)) +
            '<div class="mfg-sep"></div>' +
            '<div class="mfg-summary"><div class="mfg-summary-h">' + esc(T('mfg/summary', 'Order summary')) + '</div><dl class="kv">' +
            '<dt>' + esc(T('mfg/stack', 'Stack-up')) + '</dt><dd>' + esc(T('mfg/stackLayers', '{layers} layers, {t} mm',
                { layers: o.layers, t: o.thickness })) + '</dd>' +
            (o.delivery === 'maker' ?
                '<dt>' + esc(T('mfg/panelSize', 'Panel size')) + '</dt><dd>' + esc(fmtMM(sum.panelW) + ' × ' + fmtMM(sum.panelH)) + '</dd>' +
                '<dt>' + esc(T('mfg/perPanel', 'Boards per panel')) + '</dt><dd>' + sum.perPanel + '</dd>' : '') +
            '</dl>' + (sum.notes.length ? '<ul class="list-plain mfg-notes">' + sum.notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>' : '') +
            '</div>' +
            '<div class="mfg-actions"><button class="btn small" data-mreset>' + icon('refresh') + esc(T('mfg/reset', 'Reset options')) + '</button></div>' +
            '</div>';
        box.innerHTML = html;
        box.querySelector('.mfg-body').scrollTop = scroll;
        bind(box);
    }

    function bind(box) {
        var o = opts();
        box.querySelector('[data-mclose]').onclick = function () { setOpen(false); };
        box.querySelector('[data-mon]').onchange = function () {
            o.on = this.checked;
            changed();
        };
        box.querySelectorAll('[data-mk]').forEach(function (group) {
            group.addEventListener('click', function (e) {
                var b = e.target.closest('button[data-v]');
                if (!b || b.disabled) {
                    return;
                }
                var key = group.dataset.mk;
                var v = b.dataset.v;
                o[key] = /^(layers|thickness|railWidth)$/.test(key) ? parseFloat(v) : v;
                //A new material starts at its usual thickness (1.6 mm for FR-4)
                if (key === 'material') {
                    o.thickness = MATERIALS[v].defThick;
                }
                //A white mask gets black legend, any other colour white
                if (key === 'mask') {
                    o.silk = v === 'white' ? 'black' : 'white';
                }
                o.on = true;
                changed();
            });
        });
        box.querySelectorAll('[data-ms]').forEach(function (st) {
            st.addEventListener('click', function (e) {
                var b = e.target.closest('button[data-d]');
                if (!b || b.disabled) {
                    return;
                }
                o[st.dataset.ms] += parseInt(b.dataset.d, 10);
                o.on = true;
                changed();
            });
        });
        box.querySelector('[data-mreset]').onclick = function () {
            state.settings.mfg = Object.assign({}, DEFAULTS, { on: true });
            changed();
        };
    }

    function setOpen(on) {
        panelOpen = on;
        render();
    }

    //Tools > Manufacturing Capabilities Preview
    cmd.mfgPreview = function () {
        if (!state.project) {
            return;
        }
        var o = opts();
        var wasOn = o.on;
        o.on = true;
        panelOpen = true;
        if (state.dim !== '3d') {
            app.setDim('3d');
        } else {
            render();
            if (!wasOn) {
                app.schedule3D();
            }
        }
    };

    cmd.mfgToggle = function () {
        setOpen(!panelOpen);
    };

    GV.mfg = {
        active: active,
        build: build,
        summary: summary,
        dimChanged: function () { render(); },
        MATERIALS: MATERIALS,
        FINISHES: FINISHES
    };
})(window.GV = window.GV || {});
