/*
    PDF Editor - converting to ArozOS Office and exporting

    Every conversion starts from the document as edited (an unchanged
    document uses the opened file directly):
      - PDF to Docs: Docs imports PDF itself (it reflows text, headings,
        lists, tables and pictures), so the PDF is opened in Docs, which
        shows it as a new document to save as .docx.
      - PDF to Sheets: the text of each page is cut into rows and columns
        by its positions and written as an .xlsx (backend/office.agi).
      - PDF to Slides: every page becomes a slide holding a picture of the
        page, with the page's text in the speaker notes, written as .pptx.
      - PDF to Images / Text: files in a chosen folder, or downloads.
*/
window.PE = window.PE || {};

(function (PE) {
    'use strict';

    var D = PE.doc;
    var V = PE.view;
    var T = PE.T;
    var C = PE.convert = {};
    var WORKROOT = 'tmp:/.appdata/PDF Editor/';

    /* ------------------------------------------------------------ the edited document */
    function pristine() {
        if (D.sources.length !== 1 || D.pages.length !== D.sources[0].info.length || PE.deco.any() || (D.attach || []).length) {
            return false;
        }
        return D.pages.every(function (p, k) {
            return p.s === 0 && p.i === k && !p.rot && !p.crop && !p.objs.length && !(p.edits || []).length;
        });
    }
    C.pristine = pristine;

    var cache = { key: null, doc: null, bytes: null };

    /* pdf.js document of the edited PDF (built when there are edits) */
    C.editedPdf = function (prog) {
        if (pristine()) {
            return Promise.resolve({ doc: D.sources[0].pdf, bytes: D.sources[0].bytes, pristine: true });
        }
        var key = D.snapshot() + '|' + D.sources.length;
        if (cache.key === key && cache.doc) {
            return Promise.resolve({ doc: cache.doc, bytes: cache.bytes });
        }
        return PE.save.build(prog).then(function (bytes) {
            return PE.libs.pdfjs().then(function (pdfjsLib) {
                return pdfjsLib.getDocument({ data: bytes.slice(0), cMapUrl: 'lib/pdfjs/cmaps/', cMapPacked: true, isEvalSupported: false }).promise;
            }).then(function (doc) {
                if (cache.doc) {
                    try {
                        cache.doc.destroy();
                    } catch (e) {
                        //gone
                    }
                }
                cache = { key: key, doc: doc, bytes: bytes };
                return { doc: doc, bytes: bytes };
            });
        });
    };

    /* Page k of the edited document on a canvas (scale 1 = 72 dpi), as the
       page shows in the viewer (full page, crop ignored) */
    C.renderPage = function (k, scale) {
        var p = D.pages[k];
        var simple = p && p.s >= 0 && !p.objs.length && !(p.edits || []).length && !PE.deco.any() && !p.crop;
        var src = simple ? D.pdfPage(k).then(function (pg) {
            return { page: pg, rotation: D.totalRot(p) };
        }) : C.editedPdf().then(function (r) {
            return r.doc.getPage(k + 1).then(function (pg) {
                return { page: pg, rotation: pg.rotate };
            });
        });
        return src.then(function (r) {
            var vp = r.page.getViewport({ scale: scale, rotation: r.rotation });
            var c = document.createElement('canvas');
            c.width = Math.max(1, Math.ceil(vp.width));
            c.height = Math.max(1, Math.ceil(vp.height));
            return r.page.render({ canvasContext: c.getContext('2d'), viewport: vp, intent: 'print' }).promise.then(function () {
                if (!simple && p.crop) {
                    //the built page is cropped; put it where the full page would be
                    var d = D.dims(k);
                    var full = document.createElement('canvas');
                    full.width = Math.ceil(d.W * scale);
                    full.height = Math.ceil(d.H * scale);
                    var fx = full.getContext('2d');
                    fx.fillStyle = '#fff';
                    fx.fillRect(0, 0, full.width, full.height);
                    fx.drawImage(c, d.ox * scale, d.oy * scale);
                    return full;
                }
                return c;
            });
        });
    };

    /* ------------------------------------------------------------ opening other apps */
    var FALLBACK = {
        Docs: { url: 'Office/docs/index.html', icon: 'Office/docs/docs.png', size: [480, 320] },
        Sheets: { url: 'Office/sheets/index.html', icon: 'Office/sheets/sheets.png', size: [480, 320] },
        Slides: { url: 'Office/slides/index.html', icon: 'Office/slides/slides.png', size: [480, 320] }
    };

    C.openWith = function (module, filepath) {
        var files = [{ filename: PE.baseName(filepath), filepath: filepath }];
        var launch = function (info) {
            var url = info.url + '#' + encodeURIComponent(JSON.stringify(files));
            if (typeof ao_module_virtualDesktop !== 'undefined' && ao_module_virtualDesktop) {
                ao_module_newfw({ url: url, width: info.size[0], height: info.size[1], appicon: info.icon, title: module });
            } else {
                window.open(PE.root() + url, '_blank');
            }
        };
        fetch(PE.root() + 'system/modules/getLaunchPara?module=' + encodeURIComponent(module), { credentials: 'same-origin' }).then(function (r) {
            return r.ok ? r.json() : null;
        }).then(function (m) {
            if (!m || m.error) {
                throw new Error('module');
            }
            var url = m.StartDir, size = [undefined, undefined];
            if (m.SupportFW && m.LaunchFWDir) {
                url = m.LaunchFWDir;
                size = m.InitFWSize || size;
            }
            if (m.SupportEmb && m.LaunchEmb) {
                url = m.LaunchEmb;
                size = m.InitEmbSize || size;
            }
            launch({ url: url, icon: m.IconPath || FALLBACK[module].icon, size: size });
        }).catch(function () {
            launch(FALLBACK[module]);
        });
    };

    function needBackend() {
        if (!PE.hasBackend) {
            PE.alert(T('conv/needServer', 'Needs ArozOS'), T('conv/needServerText', 'Converting for ArozOS Office works when the editor runs inside ArozOS.'));
            return false;
        }
        return true;
    }

    function workdir() {
        return WORKROOT + 'convert/' + PE.uid('w');
    }

    function rangeRow(id) {
        var n = D.pages.length;
        var picked = PE.panels.targetPages();
        return '<div class="pe-row"><label>' + PE.esc(T('page/which', 'Pages')) + '</label><select class="pe-select" data-rangesel="' + id + '">' +
            '<option value="all">' + PE.esc(T('conv/allPages', 'All {n} pages', { n: n })) + '</option>' +
            '<option value="cur">' + PE.esc(picked.length > 1 ? T('conv/picked', 'Selected pages') : T('conv/current', 'Current page')) + '</option>' +
            '<option value="custom">' + PE.esc(T('deco/custom', 'Custom')) + '</option></select>' +
            '<input class="pe-input grow" type="text" data-range="' + id + '" placeholder="1-3, 5" hidden></div>';
    }

    function bindRange(body, id) {
        var sel = body.querySelector('[data-rangesel="' + id + '"]');
        var inp = body.querySelector('[data-range="' + id + '"]');
        sel.addEventListener('change', function () {
            inp.hidden = sel.value !== 'custom';
            if (!inp.hidden) {
                inp.focus();
            }
        });
        return function () {
            if (sel.value === 'all') {
                return D.pages.map(function (p, k) { return k; });
            }
            if (sel.value === 'cur') {
                return PE.panels.targetPages();
            }
            return PE.parseRange(inp.value, D.pages.length);
        };
    }

    function pickOutput(ext, key) {
        var def = PE.stem(D.name || 'document') + '.' + ext;
        return PE.pickServer({ type: 'new', root: D.path ? PE.dirOf(D.path) : 'user:/Desktop', defaultName: def, filter: [ext], key: key || 'convert' }).then(function (files) {
            if (!files.length) {
                return null;
            }
            var fp = files[0].filepath;
            if (!new RegExp('\\.' + ext + '$', 'i').test(fp)) {
                fp += '.' + ext;
            }
            return fp;
        });
    }

    function envelope(app, title, body) {
        var now = Date.now();
        return {
            type: 'arozos/office', app: app, version: 1,
            meta: { title: title, createdAt: now, modifiedAt: now, revision: 0, generator: 'ArozOS PDF Editor ' + PE.VERSION },
            body: body
        };
    }

    /* ------------------------------------------------------------ Docs */
    C.toDocs = function () {
        if (!D.loaded || !needBackend()) {
            return;
        }
        PE.dialog({
            title: T('conv/docsTitle', 'PDF to Docs'),
            body: '<p>' + PE.esc(T('conv/docsText', 'Docs opens an editable copy of this PDF: text, headings, lists, tables and pictures flow into a new document that you save from Docs as .docx.')) + '</p>' +
                (pristine() ? '' : '<p class="pe-note">' + PE.esc(T('conv/docsEdited', 'Your changes are included, also those not saved yet.')) + '</p>'),
            buttons: [
                { label: T('common/cancel', 'Cancel') },
                {
                    label: T('conv/openDocs', 'Open in Docs'), primary: true, onClick: function () {
                        if (pristine() && D.path) {
                            C.openWith('Docs', D.path);
                            return;
                        }
                        var dir = workdir();
                        var name = PE.stem(D.name || 'document') + '.pdf';
                        PE.save.withBusy(T('conv/preparing', 'Preparing...'), function (prog) {
                            return PE.save.build(prog).then(function (bytes) {
                                return PE.upload(new Blob([bytes], { type: 'application/pdf' }), name, dir);
                            });
                        }).then(function () {
                            C.openWith('Docs', dir + '/' + name);
                        }).catch(function (err) {
                            PE.alert(T('conv/fail', 'Conversion failed'), err.message || String(err));
                        });
                    }
                }
            ]
        });
    };

    /* ------------------------------------------------------------ text and tables */
    function pageLines(page) {
        //text items of a pdf.js page as rows of cells, top to bottom
        return page.getTextContent({ normalizeWhitespace: true }).then(function (tc) {
            var vp = page.getViewport({ scale: 1, rotation: page.rotate });
            var items = [];
            tc.items.forEach(function (it) {
                var s = it.str;
                if (!s || !s.trim()) {
                    return;
                }
                var t = it.transform;
                var fs = Math.hypot(t[2], t[3]) || 10;
                var a = vp.convertToViewportPoint(t[4], t[5]);
                var len = Math.hypot(t[0], t[1]) || 1;
                var b = vp.convertToViewportPoint(t[4] + t[0] / len * it.width, t[5] + t[1] / len * it.width);
                if (Math.abs(b[1] - a[1]) > Math.abs(b[0] - a[0])) {
                    return;         //vertical text does not fit rows
                }
                items.push({ s: s, x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), y: a[1], fs: fs });
            });
            items.sort(function (p, q) { return p.y - q.y || p.x0 - q.x0; });
            var rows = [];
            items.forEach(function (it) {
                var r = rows.length ? rows[rows.length - 1] : null;
                if (r && Math.abs(it.y - r.y) < Math.max(2, Math.min(it.fs, r.fs) * 0.45)) {
                    r.items.push(it);
                    r.fs = Math.max(r.fs, it.fs);
                } else {
                    rows.push({ y: it.y, fs: it.fs, items: [it] });
                }
            });
            rows.forEach(function (r) {
                r.items.sort(function (p, q) { return p.x0 - q.x0; });
                var cells = [];
                r.items.forEach(function (it) {
                    var c = cells.length ? cells[cells.length - 1] : null;
                    var gap = c ? it.x0 - c.x1 : Infinity;
                    if (c && gap < Math.max(it.fs, c.fs) * 0.9) {
                        c.s += (gap > it.fs * 0.15 && !/\s$/.test(c.s) && !/^\s/.test(it.s) ? ' ' : '') + it.s;
                        c.x1 = Math.max(c.x1, it.x1);
                    } else {
                        cells.push({ s: it.s, x0: it.x0, x1: it.x1, fs: it.fs });
                    }
                });
                cells.forEach(function (c) {
                    c.s = c.s.replace(/\s+/g, ' ').trim();
                });
                r.cells = cells;
            });
            return rows;
        });
    }

    /* Column boundaries: gaps that every multi-cell row leaves open */
    function columns(rows) {
        var spans = [];
        rows.forEach(function (r) {
            if (r.cells.length > 1) {
                r.cells.forEach(function (c) {
                    spans.push([c.x0, c.x1]);
                });
            }
        });
        if (!spans.length) {
            return [];
        }
        spans.sort(function (a, b) { return a[0] - b[0]; });
        var merged = [spans[0].slice()];
        spans.forEach(function (s) {
            var m = merged[merged.length - 1];
            if (s[0] <= m[1] + 2) {
                m[1] = Math.max(m[1], s[1]);
            } else {
                merged.push(s.slice());
            }
        });
        return merged;
    }

    function colIndex(cols, c) {
        if (!cols.length) {
            return 0;
        }
        var mid = (c.x0 + c.x1) / 2;
        for (var i = 0; i < cols.length; i++) {
            if (mid >= cols[i][0] - 1 && mid <= cols[i][1] + 1) {
                return i;
            }
        }
        //between columns: the nearest one to the left
        var best = 0;
        for (var j = 0; j < cols.length; j++) {
            if (cols[j][0] <= c.x0 + 1) {
                best = j;
            }
        }
        return best;
    }

    function colName(i) {
        var s = '';
        i++;
        while (i > 0) {
            var m = (i - 1) % 26;
            s = String.fromCharCode(65 + m) + s;
            i = Math.floor((i - 1) / 26);
        }
        return s;
    }

    function cellValue(s) {
        var t = s.trim();
        var m = /^\(?([\-+]?)[$\u20ac\u00a3\u00a5]?\s?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?\)?$/.exec(t);
        if (m && !/^0\d/.test(m[2])) {
            var neg = t.charAt(0) === '(' && t.charAt(t.length - 1) === ')';
            var v = (m[1] === '-' || neg ? '-' : '') + m[2].replace(/,/g, '') + (m[4] || '');
            return v;
        }
        if (/^[\-+]?\d+(\.\d+)?%$/.test(t)) {
            return t;
        }
        if (/^[=+\-@]/.test(t)) {
            //would be read as a formula
            return '\'' + t;
        }
        return t;
    }

    function sheetFromRows(name, rowsList) {
        var cells = {};
        var widths = {};
        var r0 = 0;
        rowsList.forEach(function (rows, pi) {
            var cols = columns(rows);
            rows.forEach(function (r) {
                r.cells.forEach(function (c) {
                    var ci = colIndex(cols, c);
                    var ref = colName(ci) + (r0 + 1);
                    if (cells[ref]) {
                        cells[ref].v += ' ' + c.s;
                    } else {
                        cells[ref] = { v: cellValue(c.s) };
                    }
                    widths[ci] = Math.max(widths[ci] || 0, Math.min(60, c.s.length));
                });
                r0++;
            });
            if (pi < rowsList.length - 1) {
                r0++;
            }
        });
        var colW = {};
        Object.keys(widths).forEach(function (ci) {
            colW[ci] = Math.round(Math.max(64, Math.min(420, widths[ci] * 7 + 16)));
        });
        return { name: name, cells: cells, colW: colW };
    }

    C.toSheets = function () {
        if (!D.loaded || !needBackend()) {
            return;
        }
        var body = PE.el('div', 'pe-form', rangeRow('s') +
            '<div class="pe-row"><label>' + PE.esc(T('conv/layout', 'Layout')) + '</label><select class="pe-select" data-layout>' +
            '<option value="each">' + PE.esc(T('conv/sheetEach', 'One sheet per page')) + '</option>' +
            '<option value="one">' + PE.esc(T('conv/sheetOne', 'All pages on one sheet')) + '</option></select></div>' +
            '<div class="pe-note">' + PE.esc(T('conv/sheetsNote', 'Text is placed in rows and columns by where it sits on the page. Tables come out best; scanned pages have no text to convert.')) + '</div>');
        var pages = null;
        PE.dialog({
            title: T('conv/sheetsTitle', 'PDF to Sheets'),
            body: body,
            onOpen: function () {
                pages = bindRange(body, 's');
            },
            buttons: [
                { label: T('common/cancel', 'Cancel') },
                {
                    label: T('conv/convert', 'Convert'), primary: true, onClick: function () {
                        var list = pages();
                        if (!list || !list.length) {
                            PE.toast(T('page/badRange', 'Enter pages like 1-3, 5'), { error: true });
                            return false;
                        }
                        var one = body.querySelector('[data-layout]').value === 'one';
                        pickOutput('xlsx').then(function (fp) {
                            if (!fp) {
                                return;
                            }
                            PE.save.withBusy(T('conv/reading', 'Reading the pages...'), function (prog) {
                                return C.editedPdf(function (f) { prog(f * 0.4); }).then(function (r) {
                                    var all = [];
                                    var chain = Promise.resolve();
                                    list.forEach(function (k, i) {
                                        chain = chain.then(function () {
                                            prog(0.4 + i / list.length * 0.4, T('conv/pageN', 'Page {n}...', { n: k + 1 }));
                                            return r.doc.getPage(k + 1).then(pageLines).then(function (rows) {
                                                all.push({ k: k, rows: rows });
                                            });
                                        });
                                    });
                                    return chain.then(function () {
                                        var sheets;
                                        if (one) {
                                            sheets = [sheetFromRows(T('conv/sheetName', 'Sheet1'), all.map(function (a) { return a.rows; }))];
                                        } else {
                                            sheets = all.map(function (a) {
                                                return sheetFromRows(T('conv/pageSheet', 'Page {n}', { n: a.k + 1 }), [a.rows]);
                                            });
                                        }
                                        var empty = sheets.every(function (s) { return !Object.keys(s.cells).length; });
                                        if (empty) {
                                            throw new Error(T('conv/noText', 'These pages have no text to convert (scanned pages are pictures).'));
                                        }
                                        prog(0.85, T('conv/writing', 'Writing {name}...', { name: PE.baseName(fp) }));
                                        var env = envelope('spreadsheet', PE.stem(fp), { sheets: sheets, active: 0 });
                                        return PE.agi('office.agi', { opr: 'save', filepath: fp, content: JSON.stringify(env) });
                                    });
                                });
                            }).then(function () {
                                PE.toast(T('save/saved', 'Saved to {path}', { path: fp }));
                                C.openWith('Sheets', fp);
                            }).catch(function (err) {
                                PE.alert(T('conv/fail', 'Conversion failed'), err.message || String(err));
                            });
                        });
                    }
                }
            ]
        });
    };

    /* ------------------------------------------------------------ Slides */
    C.toSlides = function () {
        if (!D.loaded || !needBackend()) {
            return;
        }
        var body = PE.el('div', 'pe-form', rangeRow('p') +
            '<div class="pe-row"><label>' + PE.esc(T('conv/quality', 'Quality')) + '</label><select class="pe-select" data-q>' +
            '<option value="150">' + PE.esc(T('conv/qStd', 'Standard (150 dpi)')) + '</option>' +
            '<option value="220" selected>' + PE.esc(T('conv/qHigh', 'High (220 dpi)')) + '</option>' +
            '<option value="300">' + PE.esc(T('conv/qMax', 'Print (300 dpi)')) + '</option></select></div>' +
            '<div class="pe-row"><label></label><label class="pe-check"><input type="checkbox" data-notes checked>' + PE.esc(T('conv/notes', 'Put the page text in the speaker notes')) + '</label></div>' +
            '<div class="pe-note">' + PE.esc(T('conv/slidesNote', 'Each page becomes a slide with a picture of the page, sized to the page.')) + '</div>');
        var pages = null;
        PE.dialog({
            title: T('conv/slidesTitle', 'PDF to Slides'),
            body: body,
            onOpen: function () {
                pages = bindRange(body, 'p');
            },
            buttons: [
                { label: T('common/cancel', 'Cancel') },
                {
                    label: T('conv/convert', 'Convert'), primary: true, onClick: function () {
                        var list = pages();
                        if (!list || !list.length) {
                            PE.toast(T('page/badRange', 'Enter pages like 1-3, 5'), { error: true });
                            return false;
                        }
                        var dpi = parseInt(body.querySelector('[data-q]').value, 10) || 220;
                        var notes = body.querySelector('[data-notes]').checked;
                        pickOutput('pptx').then(function (fp) {
                            if (!fp) {
                                return;
                            }
                            var dir = workdir();
                            PE.save.withBusy(T('conv/rendering', 'Rendering the pages...'), function (prog) {
                                return C.editedPdf(function (f) { prog(f * 0.2); }).then(function (r) {
                                    var slides = [];
                                    var size = null;
                                    var chain = Promise.resolve();
                                    list.forEach(function (k, i) {
                                        chain = chain.then(function () {
                                            prog(0.2 + i / list.length * 0.65, T('conv/slideN', 'Slide {n} of {total}...', { n: i + 1, total: list.length }));
                                            return r.doc.getPage(k + 1).then(function (page) {
                                                var vp = page.getViewport({ scale: dpi / 72, rotation: page.rotate });
                                                var c = document.createElement('canvas');
                                                c.width = Math.ceil(vp.width);
                                                c.height = Math.ceil(vp.height);
                                                var cx = c.getContext('2d');
                                                cx.fillStyle = '#fff';
                                                cx.fillRect(0, 0, c.width, c.height);
                                                return page.render({ canvasContext: cx, viewport: vp, intent: 'print' }).promise.then(function () {
                                                    return PE.canvasToBlob(c, 'image/jpeg', 0.9);
                                                }).then(function (blob) {
                                                    var name = 'p' + (i + 1) + '.jpg';
                                                    return PE.upload(blob, name, dir).then(function () {
                                                        return notes ? pageLines(page).then(function (rows) {
                                                            return rows.map(function (rw) {
                                                                return rw.cells.map(function (cc) { return cc.s; }).join('  ');
                                                            }).join('\n').substring(0, 4000);
                                                        }) : '';
                                                    }).then(function (txt) {
                                                        var pw = vp.width, ph = vp.height;
                                                        if (!size) {
                                                            var sh = Math.round(960 * ph / pw);
                                                            size = [960, sh >= 100 && sh <= 4000 ? sh : 540];
                                                        }
                                                        var f = Math.min(size[0] / pw, size[1] / ph);
                                                        var w = pw * f, h = ph * f;
                                                        slides.push({
                                                            id: PE.uid('s'), bg: '#ffffff', notes: txt,
                                                            objects: [{
                                                                id: PE.uid('o'), type: 'image', x: (size[0] - w) / 2, y: (size[1] - h) / 2, w: w, h: h, rot: 0, z: 0,
                                                                props: { src: '../../media?file=' + encodeURIComponent(dir + '/' + name) }
                                                            }]
                                                        });
                                                    });
                                                });
                                            });
                                        });
                                    });
                                    return chain.then(function () {
                                        prog(0.9, T('conv/writing', 'Writing {name}...', { name: PE.baseName(fp) }));
                                        var env = envelope('presentation', PE.stem(fp), { size: size, slides: slides });
                                        return PE.agi('office.agi', { opr: 'save', filepath: fp, content: JSON.stringify(env), cleanup: dir });
                                    });
                                });
                            }).then(function () {
                                PE.toast(T('save/saved', 'Saved to {path}', { path: fp }));
                                C.openWith('Slides', fp);
                            }).catch(function (err) {
                                PE.agi('office.agi', { opr: 'cleanup', cleanup: dir }).catch(function () {});
                                PE.alert(T('conv/fail', 'Conversion failed'), err.message || String(err));
                            });
                        });
                    }
                }
            ]
        });
    };

    /* ------------------------------------------------------------ images */
    C.toImages = function () {
        if (!D.loaded) {
            return;
        }
        var body = PE.el('div', 'pe-form', rangeRow('i') +
            '<div class="pe-row"><label>' + PE.esc(T('conv/format', 'Format')) + '</label><select class="pe-select" data-fmt><option value="png">PNG</option><option value="jpg">JPEG</option></select></div>' +
            '<div class="pe-row"><label>' + PE.esc(T('conv/resolution', 'Resolution')) + '</label><select class="pe-select" data-dpi>' +
            '<option value="72">72 dpi</option><option value="150" selected>150 dpi</option><option value="300">300 dpi</option></select></div>' +
            (PE.hasBackend ? '' : '<div class="pe-note">' + PE.esc(T('conv/downloadsNote', 'Each page is downloaded as its own file.')) + '</div>'));
        var pages = null;
        PE.dialog({
            title: T('conv/imagesTitle', 'PDF to Images'),
            body: body,
            onOpen: function () {
                pages = bindRange(body, 'i');
            },
            buttons: [
                { label: T('common/cancel', 'Cancel') },
                {
                    label: T('conv/export', 'Export'), primary: true, onClick: function () {
                        var list = pages();
                        if (!list || !list.length) {
                            PE.toast(T('page/badRange', 'Enter pages like 1-3, 5'), { error: true });
                            return false;
                        }
                        var fmt = body.querySelector('[data-fmt]').value;
                        var dpi = parseInt(body.querySelector('[data-dpi]').value, 10) || 150;
                        var dest = PE.hasBackend ? PE.pickServer({ type: 'folder', root: D.path ? PE.dirOf(D.path) : 'user:/Desktop', key: 'export' }).then(function (f) {
                            return f.length ? f[0].filepath.replace(/\/$/, '') : null;
                        }) : Promise.resolve('');
                        dest.then(function (dir) {
                            if (dir === null) {
                                return;
                            }
                            var base = PE.stem(D.name || 'page');
                            PE.save.withBusy(T('conv/rendering', 'Rendering the pages...'), function (prog) {
                                return C.editedPdf(function (f) { prog(f * 0.2); }).then(function (r) {
                                    var chain = Promise.resolve();
                                    list.forEach(function (k, i) {
                                        chain = chain.then(function () {
                                            prog(0.2 + i / list.length * 0.8, T('conv/pageN', 'Page {n}...', { n: k + 1 }));
                                            return r.doc.getPage(k + 1).then(function (page) {
                                                var vp = page.getViewport({ scale: dpi / 72, rotation: page.rotate });
                                                var c = document.createElement('canvas');
                                                c.width = Math.ceil(vp.width);
                                                c.height = Math.ceil(vp.height);
                                                var cx = c.getContext('2d');
                                                cx.fillStyle = '#fff';
                                                cx.fillRect(0, 0, c.width, c.height);
                                                return page.render({ canvasContext: cx, viewport: vp, intent: 'print' }).promise.then(function () {
                                                    return PE.canvasToBlob(c, fmt === 'jpg' ? 'image/jpeg' : 'image/png', 0.92);
                                                }).then(function (blob) {
                                                    var name = base + '_' + (k + 1) + '.' + fmt;
                                                    if (!PE.hasBackend) {
                                                        PE.downloadBytes(blob, name);
                                                        return PE.tick();
                                                    }
                                                    return PE.upload(blob, name, dir);
                                                });
                                            });
                                        });
                                    });
                                    return chain;
                                });
                            }).then(function () {
                                PE.toast(T('conv/imagesDone', '{n} image(s) exported.', { n: list.length }) + (dir ? ' (' + dir + ')' : ''));
                            }).catch(function (err) {
                                PE.alert(T('conv/fail', 'Conversion failed'), err.message || String(err));
                            });
                        });
                    }
                }
            ]
        });
    };

    /* ------------------------------------------------------------ text */
    C.toText = function () {
        if (!D.loaded) {
            return;
        }
        PE.save.withBusy(T('conv/reading', 'Reading the pages...'), function (prog) {
            return C.editedPdf(function (f) { prog(f * 0.3); }).then(function (r) {
                var out = [];
                var chain = Promise.resolve();
                D.pages.forEach(function (p, k) {
                    chain = chain.then(function () {
                        prog(0.3 + k / D.pages.length * 0.7);
                        return r.doc.getPage(k + 1).then(pageLines).then(function (rows) {
                            out.push(rows.map(function (rw) {
                                return rw.cells.map(function (c) { return c.s; }).join('    ');
                            }).join('\n'));
                        });
                    });
                });
                return chain.then(function () {
                    return out.join('\n\n\f');
                });
            });
        }).then(function (text) {
            var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
            var name = PE.stem(D.name || 'document') + '.txt';
            if (!PE.hasBackend) {
                PE.downloadBytes(blob, name);
                return;
            }
            return pickOutput('txt', 'export').then(function (fp) {
                if (!fp) {
                    return;
                }
                return PE.upload(blob, PE.baseName(fp), PE.dirOf(fp)).then(function () {
                    PE.toast(T('save/saved', 'Saved to {path}', { path: fp }));
                });
            });
        }).catch(function (err) {
            PE.alert(T('conv/fail', 'Conversion failed'), err.message || String(err));
        });
    };
})(window.PE);
