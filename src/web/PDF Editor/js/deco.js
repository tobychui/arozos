/*
    PDF Editor - page decorations

    Header & footer, page numbers, watermark and background are settings
    of the document (PE.doc.deco), not objects: they follow the pages when
    pages move, are added or removed. For each page they turn into plain
    objects (objectsFor), which the viewer draws like any other object and
    save.js writes like any other object - "under" ones behind the page's
    own content, "over" ones on top of it.

        hf  {hl, hc, hr, fl, fc, fr, font, size, color, margin, side, range, custom, skipFirst}
        pn  {pos (tl tc tr bl bc br), fmt, start, font, size, color, margin, range, custom, skipFirst}
        wm  {kind (text | image), text, font, size, bold, color, opacity, angle, asset, scale, tile, layer (over | under), range, custom}
        bg  {color, opacity, range, custom}
*/
window.PE = window.PE || {};

(function (PE) {
    'use strict';

    var D = PE.doc;
    var V = PE.view;
    var F = PE.fonts;
    var DE = PE.deco = {};

    DE.appliesTo = function (cfg, k) {
        if (!cfg) {
            return false;
        }
        if (cfg.skipFirst && k === 0) {
            return false;
        }
        switch (cfg.range) {
            case 'odd': return k % 2 === 0;
            case 'even': return k % 2 === 1;
            case 'custom': {
                var list = PE.parseRange(cfg.custom, D.pages.length);
                return !!list && list.indexOf(k) >= 0;
            }
            default: return true;
        }
    };

    DE.fill = function (tpl, k, start) {
        var n = D.pages.length;
        var first = start === undefined ? 1 : start;
        return String(tpl || '')
            .split('{page}').join(String(k + first))
            .split('{pages}').join(String(n + first - 1))
            .split('{date}').join(PE.fmtDay(new Date()))
            .split('{filename}').join(PE.stem(D.name || ''))
            .split('{title}').join(D.meta.title || PE.stem(D.name || ''));
    };

    function textObj(text, cfg, extra) {
        var o = {
            type: 'text', text: text, font: cfg.font || 'helv', size: cfg.size || 10, color: cfg.color || '#000000',
            bold: !!cfg.bold, italic: !!cfg.italic, align: 'left', lh: 1.2, wrap: false, x: 0, y: 0, w: 10, h: 10, angle: 0, pad: 0, deco: true
        };
        if (extra) {
            Object.keys(extra).forEach(function (key) {
                o[key] = extra[key];
            });
        }
        F.fit(o);
        return o;
    }

    /* Put a laid-out text object at a corner / edge of the visible page */
    function anchor(o, d, h, v, side, margin) {
        //h: l c r, v: t b
        if (h === 'l') {
            o.x = d.ox + side;
        } else if (h === 'r') {
            o.x = d.ox + d.w - side - o.w;
        } else {
            o.x = d.ox + (d.w - o.w) / 2;
        }
        o.y = v === 't' ? d.oy + margin : d.oy + d.h - margin - o.h;
        return o;
    }

    DE.objectsFor = function (k) {
        var under = [], over = [];
        var dc = D.deco || {};
        var d = D.dims(k);
        if (dc.bg && DE.appliesTo(dc.bg, k)) {
            under.push({ type: 'rect', x: d.ox, y: d.oy, w: d.w, h: d.h, fill: dc.bg.color || '#ffffff', stroke: null, sw: 0, angle: 0, opacity: dc.bg.opacity === undefined ? 1 : dc.bg.opacity, deco: true });
        }
        if (dc.wm && DE.appliesTo(dc.wm, k)) {
            var wm = dc.wm;
            var list = wm.layer === 'under' ? under : over;
            var make = function (cx, cy) {
                var o;
                if (wm.kind === 'image') {
                    var a = D.assets[wm.asset];
                    if (!a) {
                        return null;
                    }
                    var iw = d.w * (wm.scale || 50) / 100;
                    var ih = a.w ? iw * a.h / a.w : iw;
                    o = { type: 'image', asset: wm.asset, x: 0, y: 0, w: iw, h: ih, angle: 0, deco: true };
                } else {
                    o = textObj(wm.text || 'CONFIDENTIAL', wm, { bold: wm.bold !== false });
                }
                o.opacity = wm.opacity === undefined ? 0.3 : wm.opacity;
                o.angle = ((wm.angle === undefined ? -45 : wm.angle) % 360 + 360) % 360;
                o.x = cx - o.w / 2;
                o.y = cy - o.h / 2;
                return o;
            };
            if (wm.tile) {
                var probe = make(0, 0);
                if (probe) {
                    var stepX = Math.max(probe.w, probe.h) * 1.35 + 30, stepY = Math.max(probe.h * 3.2, probe.w * 0.75) + 20;
                    for (var yy = d.oy + stepY / 2; yy < d.oy + d.h + stepY / 2; yy += stepY) {
                        for (var xx = d.ox + stepX / 2; xx < d.ox + d.w + stepX / 2; xx += stepX) {
                            var t = make(xx, yy);
                            if (t) {
                                list.push(t);
                            }
                        }
                    }
                }
            } else {
                var c = make(d.ox + d.w / 2, d.oy + d.h / 2);
                if (c) {
                    list.push(c);
                }
            }
        }
        if (dc.hf && DE.appliesTo(dc.hf, k)) {
            var hf = dc.hf;
            var mg = hf.margin === undefined ? 24 : hf.margin, sd = hf.side === undefined ? 36 : hf.side;
            [['hl', 'l', 't'], ['hc', 'c', 't'], ['hr', 'r', 't'], ['fl', 'l', 'b'], ['fc', 'c', 'b'], ['fr', 'r', 'b']].forEach(function (slot) {
                var txt = DE.fill(hf[slot[0]], k, 1);
                if (txt) {
                    over.push(anchor(textObj(txt, hf, { align: slot[1] === 'l' ? 'left' : slot[1] === 'r' ? 'right' : 'center' }), d, slot[1], slot[2], sd, mg));
                }
            });
        }
        if (dc.pn && DE.appliesTo(dc.pn, k)) {
            var pn = dc.pn;
            var pos = pn.pos || 'bc';
            var txt2 = DE.fill(pn.fmt || '{page}', k, pn.start === undefined ? 1 : pn.start);
            over.push(anchor(textObj(txt2, pn), d, pos.charAt(1), pos.charAt(0), pn.side === undefined ? 36 : pn.side, pn.margin === undefined ? 24 : pn.margin));
        }
        return { under: under, over: over };
    };

    DE.render = function (underEl, overEl, k, s) {
        underEl.innerHTML = '';
        overEl.innerHTML = '';
        var r = DE.objectsFor(k);
        r.under.forEach(function (o) {
            underEl.appendChild(PE.objs.makeEl(o, s, false));
        });
        r.over.forEach(function (o) {
            overEl.appendChild(PE.objs.makeEl(o, s, false));
        });
    };

    DE.any = function () {
        var dc = D.deco || {};
        return !!(dc.hf || dc.pn || dc.wm || dc.bg);
    };

    /* ------------------------------------------------------------ dialogs */
    function fontSelect(cur) {
        return '<select class="pe-select" data-k="font">' + F.list().map(function (f) {
            return '<option value="' + PE.esc(f.key) + '"' + (f.key === cur ? ' selected' : '') + '>' + PE.esc(f.label) + '</option>';
        }).join('') + '</select>';
    }

    function rangeRow(cfg, withSkip) {
        return '<div class="pe-row"><label>' + PE.esc(PE.T('deco/pages', 'Pages')) + '</label>' +
            '<select class="pe-select" data-k="range">' +
            '<option value="all">' + PE.esc(PE.T('deco/all', 'All pages')) + '</option>' +
            '<option value="odd">' + PE.esc(PE.T('deco/odd', 'Odd pages')) + '</option>' +
            '<option value="even">' + PE.esc(PE.T('deco/even', 'Even pages')) + '</option>' +
            '<option value="custom">' + PE.esc(PE.T('deco/custom', 'Custom')) + '</option></select>' +
            '<input class="pe-input grow" data-k="custom" placeholder="1-3, 5" value="' + PE.esc(cfg.custom || '') + '">' + '</div>' +
            (withSkip ? '<div class="pe-row"><label></label><label class="pe-check"><input type="checkbox" data-k="skipFirst"' + (cfg.skipFirst ? ' checked' : '') + '>' +
                PE.esc(PE.T('deco/skipFirst', 'Not on the first page')) + '</label></div>' : '');
    }

    function styleRow(cfg) {
        return '<div class="pe-row"><label>' + PE.esc(PE.T('deco/font', 'Font')) + '</label>' + fontSelect(cfg.font || 'helv') +
            '<input class="pe-input num" type="number" min="4" max="200" step="0.5" data-k="size" value="' + (cfg.size || 10) + '" title="' + PE.esc(PE.T('fmt/size', 'Size')) + '">' +
            '<input type="color" class="pe-color" data-k="color" value="' + (cfg.color || '#000000') + '" title="' + PE.esc(PE.T('fmt/color', 'Colour')) + '"></div>';
    }

    /* Read every [data-k] control of a form into cfg */
    function readForm(root, cfg) {
        Array.prototype.forEach.call(root.querySelectorAll('[data-k]'), function (inp) {
            var k = inp.dataset.k;
            if (inp.type === 'checkbox') {
                cfg[k] = inp.checked;
            } else if (inp.type === 'number' || inp.type === 'range') {
                var v = parseFloat(inp.value);
                if (!isNaN(v)) {
                    cfg[k] = v;
                }
            } else {
                cfg[k] = inp.value;
            }
        });
        return cfg;
    }

    function setSelects(root, cfg) {
        Array.prototype.forEach.call(root.querySelectorAll('select[data-k]'), function (sel) {
            if (cfg[sel.dataset.k] !== undefined) {
                sel.value = String(cfg[sel.dataset.k]);
            }
        });
        var custom = root.querySelector('[data-k="custom"]');
        var range = root.querySelector('[data-k="range"]');
        if (custom && range) {
            custom.hidden = range.value !== 'custom';
        }
    }

    /*
        Shared flow: edit D.deco[key] with live preview; OK keeps it with
        undo, Cancel puts the old value back, Remove drops it.
    */
    function decoDialog(key, title, defaults, bodyHtml, opts) {
        if (!D.loaded) {
            return;
        }
        opts = opts || {};
        var before = D.snapshot();
        var old = D.deco[key] ? PE.clone(D.deco[key]) : null;
        var cfg = Object.assign({}, defaults, old || {});
        var body = PE.el('div', 'pe-form', bodyHtml(cfg));
        var done = false;
        function preview() {
            readForm(body, cfg);
            setSelects(body, cfg);
            if (opts.onRead) {
                opts.onRead(cfg, body);
            }
            D.deco[key] = PE.clone(cfg);
            V.refreshAll();
        }
        var buttons = [];
        if (old) {
            buttons.push({
                label: PE.T('deco/remove', 'Remove'), left: true, danger: true, onClick: function () {
                    done = true;
                    D.deco[key] = null;
                    D.pushUndo(before);
                    V.refreshAll();
                    D.emit('change', { all: true });
                }
            });
        }
        buttons.push({ label: PE.T('common/cancel', 'Cancel') });
        buttons.push({
            label: old ? PE.T('deco/update', 'Update') : PE.T('deco/apply', 'Apply'), primary: true, onClick: function () {
                preview();
                done = true;
                D.pushUndo(before);
                D.emit('change', { all: true });
            }
        });
        PE.dialog({
            title: title,
            body: body,
            wide: !!opts.wide,
            buttons: buttons,
            onOpen: function () {
                setSelects(body, cfg);
                if (opts.onOpen) {
                    opts.onOpen(cfg, body, preview);
                }
                body.addEventListener('input', preview);
                body.addEventListener('change', preview);
                preview();
            },
            onClose: function () {
                if (!done) {
                    D.deco[key] = old;
                    V.refreshAll();
                }
            }
        });
    }

    function tokens() {
        return '<div class="pe-tokens">' + [['{page}', 'deco/tPage', 'Page'], ['{pages}', 'deco/tPages', 'Pages'], ['{date}', 'deco/tDate', 'Date'],
            ['{filename}', 'deco/tFile', 'File name'], ['{title}', 'deco/tTitle', 'Title']].map(function (t) {
            return '<button type="button" data-tok="' + t[0] + '">' + PE.esc(PE.T(t[1], t[2])) + '</button>';
        }).join('') + '</div>';
    }

    function bindTokens(body, preview) {
        var last = null;
        body.addEventListener('focusin', function (e) {
            if (e.target.tagName === 'INPUT' && e.target.type === 'text' && e.target.dataset.k !== 'custom') {
                last = e.target;
            }
        });
        Array.prototype.forEach.call(body.querySelectorAll('[data-tok]'), function (b) {
            b.addEventListener('mousedown', function (e) {
                e.preventDefault();
            });
            b.addEventListener('click', function () {
                var inp = last || body.querySelector('input[type=text]');
                if (!inp) {
                    return;
                }
                var st = inp.selectionStart || inp.value.length, en = inp.selectionEnd || st;
                inp.value = inp.value.substring(0, st) + b.dataset.tok + inp.value.substring(en);
                inp.focus();
                inp.setSelectionRange(st + b.dataset.tok.length, st + b.dataset.tok.length);
                preview();
            });
        });
    }

    DE.headerFooter = function () {
        decoDialog('hf', PE.T('deco/hfTitle', 'Header & Footer'), { hl: '', hc: '', hr: '', fl: '', fc: '', fr: '{page}', font: 'helv', size: 9, color: '#404040', margin: 24, side: 36, range: 'all' }, function (c) {
            function inp(k, ph) {
                return '<input class="pe-input" type="text" data-k="' + k + '" value="' + PE.esc(c[k] || '') + '" placeholder="' + PE.esc(ph) + '">';
            }
            var L = PE.T('deco/left', 'Left'), C = PE.T('deco/center', 'Centre'), R = PE.T('deco/right', 'Right');
            return '<div class="pe-sub-h">' + PE.esc(PE.T('deco/header', 'Header')) + '</div><div class="pe-grid3">' + inp('hl', L) + inp('hc', C) + inp('hr', R) + '</div>' +
                '<div class="pe-sub-h">' + PE.esc(PE.T('deco/footer', 'Footer')) + '</div><div class="pe-grid3">' + inp('fl', L) + inp('fc', C) + inp('fr', R) + '</div>' +
                '<div class="pe-row"><label>' + PE.esc(PE.T('deco/insert', 'Insert')) + '</label>' + tokens() + '</div>' +
                styleRow(c) +
                '<div class="pe-row"><label>' + PE.esc(PE.T('deco/margins', 'Margins (pt)')) + '</label>' +
                '<input class="pe-input num" type="number" min="0" max="300" data-k="margin" value="' + c.margin + '" title="' + PE.esc(PE.T('deco/marginTB', 'From the top / bottom edge')) + '">' +
                '<input class="pe-input num" type="number" min="0" max="300" data-k="side" value="' + c.side + '" title="' + PE.esc(PE.T('deco/marginLR', 'From the left / right edge')) + '"></div>' +
                rangeRow(c, true);
        }, {
            wide: true, onOpen: function (cfg, body, preview) {
                bindTokens(body, preview);
            }
        });
    };

    DE.pageNumbers = function () {
        decoDialog('pn', PE.T('deco/pnTitle', 'Page Numbers'), { pos: 'bc', fmt: '{page}', start: 1, font: 'helv', size: 10, color: '#404040', margin: 24, side: 36, range: 'all' }, function (c) {
            var fmts = ['{page}', PE.T('deco/fmtPage', 'Page {page}'), PE.T('deco/fmtPageOf', 'Page {page} of {pages}'), '{page} / {pages}', '- {page} -'];
            var pos = '<div class="pe-pos">' + ['tl', 'tc', 'tr', 'bl', 'bc', 'br'].map(function (p) {
                return '<button type="button" data-pos="' + p + '"' + (c.pos === p ? ' class="on"' : '') + ' title="' + p + '"></button>';
            }).join('') + '</div>';
            return '<div class="pe-row"><label>' + PE.esc(PE.T('deco/position', 'Position')) + '</label>' + pos + '<input type="hidden" data-k="pos" value="' + c.pos + '"></div>' +
                '<div class="pe-row"><label>' + PE.esc(PE.T('deco/format', 'Format')) + '</label><select class="pe-select grow" data-fmtpick>' +
                fmts.map(function (f) { return '<option value="' + PE.esc(f) + '"' + (f === c.fmt ? ' selected' : '') + '>' + PE.esc(f.split('{page}').join('1').split('{pages}').join('12')) + '</option>'; }).join('') +
                '</select></div>' +
                '<div class="pe-row"><label></label><input class="pe-input grow" type="text" data-k="fmt" value="' + PE.esc(c.fmt) + '"></div>' +
                '<div class="pe-row"><label>' + PE.esc(PE.T('deco/startAt', 'Start at')) + '</label><input class="pe-input num" type="number" min="0" max="99999" data-k="start" value="' + c.start + '"></div>' +
                styleRow(c) +
                '<div class="pe-row"><label>' + PE.esc(PE.T('deco/margins', 'Margins (pt)')) + '</label>' +
                '<input class="pe-input num" type="number" min="0" max="300" data-k="margin" value="' + c.margin + '">' +
                '<input class="pe-input num" type="number" min="0" max="300" data-k="side" value="' + c.side + '"></div>' +
                rangeRow(c, true);
        }, {
            onOpen: function (cfg, body, preview) {
                Array.prototype.forEach.call(body.querySelectorAll('[data-pos]'), function (b) {
                    b.addEventListener('click', function () {
                        body.querySelector('[data-k="pos"]').value = b.dataset.pos;
                        Array.prototype.forEach.call(body.querySelectorAll('[data-pos]'), function (x) {
                            x.classList.toggle('on', x === b);
                        });
                        preview();
                    });
                });
                body.querySelector('[data-fmtpick]').addEventListener('change', function () {
                    body.querySelector('[data-k="fmt"]').value = this.value;
                });
            }
        });
    };

    DE.watermark = function () {
        decoDialog('wm', PE.T('deco/wmTitle', 'Watermark'), {
            kind: 'text', text: PE.T('deco/wmDefault', 'CONFIDENTIAL'), font: 'helv', size: 72, bold: true, color: '#c00000',
            opacity: 0.25, angle: -45, scale: 50, tile: false, layer: 'over', range: 'all'
        }, function (c) {
            return '<div class="pe-tabsel"><button type="button" data-kind="text"' + (c.kind !== 'image' ? ' class="on"' : '') + '>' + PE.esc(PE.T('deco/wmText', 'Text')) + '</button>' +
                '<button type="button" data-kind="image"' + (c.kind === 'image' ? ' class="on"' : '') + '>' + PE.esc(PE.T('deco/wmImage', 'Image')) + '</button></div>' +
                '<input type="hidden" data-k="kind" value="' + (c.kind || 'text') + '">' +
                '<div data-for="text"><div class="pe-row"><label>' + PE.esc(PE.T('deco/wmText', 'Text')) + '</label><input class="pe-input grow" type="text" data-k="text" value="' + PE.esc(c.text || '') + '"></div>' +
                styleRow(c) +
                '<div class="pe-row" style="margin-top:10px"><label></label><label class="pe-check"><input type="checkbox" data-k="bold"' + (c.bold !== false ? ' checked' : '') + '>' + PE.esc(PE.T('fmt/bold', 'Bold')) + '</label></div></div>' +
                '<div data-for="image"><div class="pe-row"><label>' + PE.esc(PE.T('deco/wmImage', 'Image')) + '</label><button type="button" class="pe-btn sm" data-pickimg>' +
                PE.esc(PE.T('deco/chooseImage', 'Choose image...')) + '</button><span class="pe-note" data-imgname></span></div>' +
                '<div class="pe-row"><label>' + PE.esc(PE.T('deco/wmScale', 'Size (% of page)')) + '</label><input class="pe-range grow" type="range" min="5" max="100" data-k="scale" value="' + c.scale + '"></div></div>' +
                '<div class="pe-row"><label>' + PE.esc(PE.T('deco/opacity', 'Opacity')) + '</label><input class="pe-range grow" type="range" min="0.05" max="1" step="0.05" data-k="opacity" value="' + c.opacity + '"></div>' +
                '<div class="pe-row"><label>' + PE.esc(PE.T('deco/rotation', 'Rotation')) + '</label><select class="pe-select" data-k="angle">' +
                [0, -45, 45, -90, 90].map(function (a) { return '<option value="' + a + '">' + a + '\u00b0</option>'; }).join('') + '</select>' +
                '<label class="pe-check"><input type="checkbox" data-k="tile"' + (c.tile ? ' checked' : '') + '>' + PE.esc(PE.T('deco/tile', 'Repeat across the page')) + '</label></div>' +
                '<div class="pe-row"><label>' + PE.esc(PE.T('deco/layer', 'Layer')) + '</label><select class="pe-select" data-k="layer"><option value="over">' +
                PE.esc(PE.T('deco/over', 'In front of the page content')) + '</option><option value="under">' + PE.esc(PE.T('deco/under', 'Behind the page content')) + '</option></select></div>' +
                rangeRow(c, false);
        }, {
            onRead: function (cfg, body) {
                cfg.angle = parseFloat(cfg.angle) || 0;
                Array.prototype.forEach.call(body.querySelectorAll('[data-for]'), function (sec) {
                    sec.hidden = sec.dataset.for !== cfg.kind;
                });
                var nm = body.querySelector('[data-imgname]');
                nm.textContent = cfg.asset && D.assets[cfg.asset] ? PE.T('deco/imageReady', 'Image selected') : '';
            },
            onOpen: function (cfg, body, preview) {
                Array.prototype.forEach.call(body.querySelectorAll('[data-kind]'), function (b) {
                    b.addEventListener('click', function () {
                        body.querySelector('[data-k="kind"]').value = b.dataset.kind;
                        Array.prototype.forEach.call(body.querySelectorAll('[data-kind]'), function (x) {
                            x.classList.toggle('on', x === b);
                        });
                        preview();
                    });
                });
                body.querySelector('[data-pickimg]').addEventListener('click', function () {
                    PE.dialogs.chooseImage().then(function (asset) {
                        if (asset) {
                            cfg.asset = asset;
                            preview();
                        }
                    });
                });
            }
        });
    };

    DE.background = function () {
        decoDialog('bg', PE.T('deco/bgTitle', 'Background'), { color: '#fff8e1', opacity: 1, range: 'all' }, function (c) {
            var sw = ['#ffffff', '#fff8e1', '#fdecea', '#e8f5e9', '#e3f2fd', '#ede7f6', '#f5f5f5', '#fffde7'];
            return '<p>' + PE.esc(PE.T('deco/bgNote', 'The colour fills the page behind its content. Pages that paint their own white background (scans) keep it.')) + '</p>' +
                '<div class="pe-row"><label>' + PE.esc(PE.T('fmt/color', 'Colour')) + '</label><input type="color" class="pe-color" data-k="color" value="' + c.color + '">' +
                sw.map(function (x) {
                    return '<button type="button" data-sw="' + x + '" style="width:24px;height:24px;border-radius:5px;border:1px solid rgba(128,128,128,.4);background:' + x + '"></button>';
                }).join('') + '</div>' +
                '<div class="pe-row"><label>' + PE.esc(PE.T('deco/opacity', 'Opacity')) + '</label><input class="pe-range grow" type="range" min="0.05" max="1" step="0.05" data-k="opacity" value="' + c.opacity + '"></div>' +
                rangeRow(c, false);
        }, {
            onOpen: function (cfg, body, preview) {
                Array.prototype.forEach.call(body.querySelectorAll('[data-sw]'), function (b) {
                    b.addEventListener('click', function () {
                        body.querySelector('[data-k="color"]').value = b.dataset.sw;
                        preview();
                    });
                });
            }
        });
    };

    DE.remove = function (key) {
        if (!D.deco[key]) {
            return;
        }
        var snap = D.snapshot();
        D.deco[key] = null;
        D.pushUndo(snap);
        V.refreshAll();
        D.emit('change', { all: true });
    };
})(window.PE);
