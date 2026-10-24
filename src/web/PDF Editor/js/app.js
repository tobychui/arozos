/*
    PDF Editor - application

    Commands (what every ribbon button and menu item runs), menus, start-up
    (locale, backend check, theme, opening the file the window was started
    with), keyboard shortcuts, clipboard, drag and drop, recent files and
    the unsaved-changes guard.

    The theme follows the ArozOS system theme (ao_module_onThemeChanged);
    View > Dark Mode and the button in the tab row toggle the system theme.
*/
window.PE = window.PE || {};

(function (PE) {
    'use strict';

    var D = PE.doc, V = PE.view, O = PE.objs, P = PE.panels, R = PE.ribbon;
    var S = PE.save, DL = PE.dialogs, C = PE.convert, DE = PE.deco;
    var T = PE.T;
    var A = PE.app = { menus: {} };

    function loaded() {
        return D.loaded && D.pages.length > 0;
    }

    function hasSel() {
        return O.selected().length > 0;
    }

    function targets() {
        return P.targetPages();
    }

    /* ------------------------------------------------------------ commands */
    var C2 = PE.commands = {
        newBlank: { run: function () { DL.newBlank(); } },
        imagesToPdf: { run: function () { DL.imagesAsPages(true); } },
        open: { run: function () { A.openDialog(); }, kbd: 'Ctrl+O' },
        openDevice: { run: function () { A.openFromDevice(); } },
        save: { run: function () { S.save(); }, enabled: loaded, kbd: 'Ctrl+S' },
        saveAs: { run: function () { S.saveAs(); }, enabled: loaded, kbd: 'Ctrl+Shift+S' },
        download: { run: function () { S.download(); }, enabled: loaded },
        print: { run: function () { S.print(); }, enabled: loaded, kbd: 'Ctrl+P' },
        closeDoc: { run: function () { A.closeDoc(); }, enabled: function () { return D.loaded; } },
        properties: { run: function () { P.toggleRight(true); }, enabled: loaded },

        addImage: { run: function () { DL.addImage(); }, enabled: loaded },
        dateStamp: { run: function () { DL.dateStamp(); }, enabled: loaded },
        stamp: { run: function () {}, enabled: loaded },
        sign: { run: function () {}, enabled: loaded },
        more: { run: function () {}, enabled: loaded },
        attachFile: { run: function () { DL.attachFile(); }, enabled: loaded },
        headerFooter: { run: function () { DE.headerFooter(); }, enabled: loaded, active: function () { return !!D.deco.hf; } },
        pageNumbers: { run: function () { DE.pageNumbers(); }, enabled: loaded, active: function () { return !!D.deco.pn; } },
        watermark: { run: function () { DE.watermark(); }, enabled: loaded, active: function () { return !!D.deco.wm; } },
        background: { run: function () { DE.background(); }, enabled: loaded, active: function () { return !!D.deco.bg; } },

        rotateRight: { run: function () { D.rotatePages(targets(), 90); }, enabled: loaded },
        rotateLeft: { run: function () { D.rotatePages(targets(), 270); }, enabled: loaded },
        deletePages: { run: function () { A.deletePages(); }, enabled: function () { return loaded() && D.pages.length > 1; } },
        duplicatePages: {
            run: function () {
                var at = D.duplicatePages(targets());
                V.goto(at);
            }, enabled: loaded
        },
        moveUp: {
            run: function () {
                var ts = targets();
                if (ts[0] > 0) {
                    var first = D.movePages(ts, ts[0] - 1);
                    P.picked = ts.length > 1 ? ts.map(function (x, i) { return first + i; }) : [];
                    V.goto(first);
                }
            }, enabled: function () { return loaded() && targets()[0] > 0; }
        },
        moveDown: {
            run: function () {
                var ts = targets();
                var last = ts[ts.length - 1];
                if (last < D.pages.length - 1) {
                    var first = D.movePages(ts, last + 2);
                    P.picked = ts.length > 1 ? ts.map(function (x, i) { return first + i; }) : [];
                    V.goto(first);
                }
            }, enabled: function () { var ts = targets(); return loaded() && ts[ts.length - 1] < D.pages.length - 1; }
        },
        reverse: { run: function () { D.reversePages(); }, enabled: function () { return loaded() && D.pages.length > 1; } },
        blankPage: { run: function () { DL.insertBlank(); }, enabled: loaded },
        insertPdf: { run: function () { DL.insertPdf(); }, enabled: loaded },
        insertImages: { run: function () { DL.imagesAsPages(false); }, enabled: loaded },
        extract: { run: function () { DL.extract(); }, enabled: loaded },
        split: { run: function () { DL.split(); }, enabled: function () { return loaded() && D.pages.length > 1; } },

        toDocs: { run: function () { C.toDocs(); }, enabled: loaded },
        toSheets: { run: function () { C.toSheets(); }, enabled: loaded },
        toSlides: { run: function () { C.toSlides(); }, enabled: loaded },
        toImages: { run: function () { C.toImages(); }, enabled: loaded },
        toText: { run: function () { C.toText(); }, enabled: loaded },

        undo: { run: function () { O.commitEdit(); D.undo(); }, enabled: function () { return D.canUndo(); }, kbd: 'Ctrl+Z' },
        redo: { run: function () { O.commitEdit(); D.redo(); }, enabled: function () { return D.canRedo(); }, kbd: 'Ctrl+Y' },
        cut: { run: function () { O.copy(true); }, enabled: hasSel, kbd: 'Ctrl+X' },
        copy: { run: function () { O.copy(false); }, enabled: hasSel, kbd: 'Ctrl+C' },
        paste: { run: function () { O.paste(); }, enabled: function () { return loaded() && O.hasClip(); }, kbd: 'Ctrl+V' },
        duplicate: { run: function () { O.duplicate(); }, enabled: hasSel, kbd: 'Ctrl+D' },
        'delete': { run: function () { O.deleteSel(); }, enabled: hasSel, kbd: 'Delete' },
        front: { run: function () { O.order(1); }, enabled: hasSel },
        back: { run: function () { O.order(-1); }, enabled: hasSel },
        find: { run: function () { A.showFind(); }, enabled: loaded, kbd: 'Ctrl+F' },

        zoomIn: { run: function () { V.zoomStep(1); }, enabled: loaded, kbd: 'Ctrl+=' },
        zoomOut: { run: function () { V.zoomStep(-1); }, enabled: loaded, kbd: 'Ctrl+-' },
        actual: { run: function () { V.setZoom(1); }, enabled: loaded },
        fitWidth: { run: function () { V.setFit('width'); }, enabled: loaded, active: function () { return V.fit === 'width'; }, kbd: 'Ctrl+0' },
        fitPage: { run: function () { V.setFit('page'); }, enabled: loaded, active: function () { return V.fit === 'page'; } },
        'mode:single': { run: function () { V.setMode('single'); }, enabled: loaded, active: function () { return V.mode === 'single'; } },
        'mode:continuous': { run: function () { V.setMode('continuous'); }, enabled: loaded, active: function () { return V.mode === 'continuous'; } },
        'mode:two': { run: function () { V.setMode('two'); }, enabled: loaded, active: function () { return V.mode === 'two'; } },
        'panel:thumbs': { run: function () { P.showLeft('thumbs', true); }, active: function () { return P.leftOpen && P.left === 'thumbs'; } },
        'panel:outline': { run: function () { P.showLeft('outline', true); }, active: function () { return P.leftOpen && P.left === 'outline'; } },
        'panel:props': { run: function () { P.toggleRight(); }, active: function () { return P.rightOpen; } },
        theme: { run: function () { A.toggleTheme(); } },

        shortcuts: { run: function () { DL.shortcuts(); } },
        about: { run: function () { DL.about(); } }
    };

    ['hand', 'select', 'textsel', 'snapshot', 'text', 'editpdf', 'redact', 'whiteout', 'link', 'draw', 'highlight', 'underline', 'strike',
        'rect', 'ellipse', 'line', 'arrow', 'crop'].forEach(function (t) {
        C2['tool:' + t] = {
            run: function () {
                V.setTool(V.tool === t && t !== 'select' ? 'select' : t);
            },
            enabled: loaded,
            active: function () { return V.tool === t; }
        };
    });

    PE.run = function (name) {
        var c = C2[name];
        if (!c) {
            return;
        }
        if (c.enabled && !c.enabled()) {
            return;
        }
        PE.closeMenus();
        if (name !== 'undo' && name !== 'redo' && name.indexOf('tool:') !== 0) {
            O.commitEdit();
        }
        c.run();
        PE.emitUi();
    };

    /* ------------------------------------------------------------ menus */
    A.menus.fileMenu = function () {
        var recent = A.recents();
        var items = [
            { header: T('file/create', 'Create') },
            { label: T('file/new', 'New blank PDF...'), icon: 'newdoc', onClick: function () { PE.run('newBlank'); } },
            { label: T('file/imagesToPdf', 'Images to PDF...'), icon: 'images', onClick: function () { PE.run('imagesToPdf'); } },
            { sep: true }
        ];
        if (PE.hasBackend) {
            items.push({ label: T('file/open', 'Open...'), icon: 'open', kbd: 'Ctrl+O', onClick: function () { PE.run('open'); } });
        }
        items.push({ label: T('file/openDevice', 'Open from this device...'), icon: 'device', kbd: PE.hasBackend ? '' : 'Ctrl+O', onClick: function () { PE.run('openDevice'); } });
        if (PE.hasBackend) {
            items.push({
                label: T('file/recent', 'Recent'), icon: 'clock', disabled: !recent.length, submenu: function () {
                    return recent.map(function (r) {
                        return { label: r.name, sub: PE.dirOf(r.path), icon: 'pdf', onClick: function () { A.openPath(r.path, r.name); } };
                    }).concat([{ sep: true }, { label: T('file/clearRecent', 'Clear the list'), onClick: function () { A.clearRecents(); } }]);
                }
            });
        }
        items.push({ sep: true });
        if (PE.hasBackend) {
            items.push({ label: T('file/save', 'Save'), icon: 'save', kbd: 'Ctrl+S', disabled: !loaded(), onClick: function () { PE.run('save'); } });
            items.push({ label: T('file/saveAs', 'Save as...'), icon: 'saveas', kbd: 'Ctrl+Shift+S', disabled: !loaded(), onClick: function () { PE.run('saveAs'); } });
        }
        items.push({ label: T('file/download', 'Download a copy'), icon: 'download', kbd: PE.hasBackend ? '' : 'Ctrl+S', disabled: !loaded(), onClick: function () { PE.run('download'); } });
        items.push({ label: T('file/print', 'Print...'), icon: 'print', kbd: 'Ctrl+P', disabled: !loaded(), onClick: function () { PE.run('print'); } });
        items.push({
            label: T('file/export', 'Export'), icon: 'exportf', disabled: !loaded(), submenu: [
                { label: T('rb/toimages', 'PDF to Images'), icon: 'toimages', onClick: function () { PE.run('toImages'); } },
                { label: T('rb/totext', 'PDF to Text'), icon: 'totext', onClick: function () { PE.run('toText'); } },
                { sep: true },
                { label: T('rb/todocs', 'PDF to Docs'), icon: 'todocs', disabled: !PE.hasBackend, onClick: function () { PE.run('toDocs'); } },
                { label: T('rb/tosheets', 'PDF to Sheets'), icon: 'tosheets', disabled: !PE.hasBackend, onClick: function () { PE.run('toSheets'); } },
                { label: T('rb/toslides', 'PDF to Slides'), icon: 'toslides', disabled: !PE.hasBackend, onClick: function () { PE.run('toSlides'); } }
            ]
        });
        items.push({ sep: true });
        items.push({ label: T('file/properties', 'Document properties'), icon: 'info', disabled: !loaded(), onClick: function () { PE.run('properties'); } });
        items.push({ label: T('file/close', 'Close document'), icon: 'close', disabled: !D.loaded, onClick: function () { PE.run('closeDoc'); } });
        return items;
    };

    A.menus.headerFooterMenu = function () {
        return [
            { label: D.deco.hf ? T('hf/edit', 'Edit header & footer...') : T('hf/add', 'Add header & footer...'), icon: 'headerfooter', onClick: function () { DE.headerFooter(); } },
            { label: T('hf/remove', 'Remove header & footer'), icon: 'trash', disabled: !D.deco.hf, onClick: function () { DE.remove('hf'); } },
            { sep: true },
            { label: D.deco.pn ? T('pn/edit', 'Edit page numbers...') : T('pn/add', 'Add page numbers...'), icon: 'pagenumber', onClick: function () { DE.pageNumbers(); } },
            { label: T('pn/remove', 'Remove page numbers'), icon: 'trash', disabled: !D.deco.pn, onClick: function () { DE.remove('pn'); } }
        ];
    };

    A.menus.stampMenu = function () {
        var items = DL.STAMPS.map(function (s) {
            return {
                label: T('stamp/' + s[0].toLowerCase().replace(/\s+/g, ''), s[0]),
                iconHtml: '<span style="display:inline-block;width:12px;height:12px;border-radius:3px;border:2px solid ' + s[1] + '"></span>',
                onClick: function () { DL.placeStamp(T('stamp/' + s[0].toLowerCase().replace(/\s+/g, ''), s[0]), s[1], false); }
            };
        });
        items.push({ sep: true });
        items.push({ label: T('stamp/approvedDate', 'Approved, with date'), icon: 'date', onClick: function () { DL.placeStamp(T('stamp/approved', 'APPROVED'), '#107c10', true); } });
        items.push({ label: T('stamp/customMenu', 'Custom stamp...'), icon: 'stamp', onClick: function () { DL.customStamp(); } });
        return items;
    };

    A.menus.signMenu = function () {
        var holder = PE.el('div');
        holder.innerHTML = '<div class="pe-mh">' + PE.esc(T('sig/saved', 'Your signatures')) + '</div><div class="pe-list-empty" style="padding:6px 10px">' + PE.esc(T('panel/loading', 'Loading...')) + '</div>';
        DL.listSignatures().then(function (list) {
            var box = holder.querySelector('.pe-list-empty');
            if (!list.length) {
                box.textContent = T('sig/none', 'No signatures are kept yet.');
                return;
            }
            box.parentNode.removeChild(box);
            list.slice(0, 6).forEach(function (sig) {
                var b = PE.el('button', 'pe-mi');
                b.type = 'button';
                b.innerHTML = '<span class="ico">' + PE.icon('sign', 'sm') + '</span><span class="lbl"><img class="pe-sigimg" alt=""></span>';
                b.querySelector('img').src = sig.url;
                b.addEventListener('click', function () {
                    PE.closeMenus();
                    DL.useSignature(sig);
                });
                holder.appendChild(b);
            });
        });
        return [
            { el: holder },
            { sep: true },
            { label: T('sig/createMenu', 'Create a signature...'), icon: 'plus', onClick: function () { DL.createSignature(); } },
            { label: T('sig/manageMenu', 'Manage signatures...'), icon: 'sign', onClick: function () { DL.manageSignatures(); } },
            { sep: true },
            { label: T('rb/date', 'Date'), icon: 'date', onClick: function () { DL.dateStamp(); } }
        ];
    };

    A.menus.moreMenu = function () {
        return [
            { label: T('rb/whiteout', 'White-out'), icon: 'whiteout', onClick: function () { PE.run('tool:whiteout'); } },
            { label: T('rb/stamp', 'Stamp'), icon: 'stamp', submenu: A.menus.stampMenu },
            { label: T('rb/date', 'Date'), icon: 'date', onClick: function () { PE.run('dateStamp'); } },
            { label: T('rb/attach', 'Attach File'), icon: 'attach', onClick: function () { PE.run('attachFile'); } },
            { sep: true },
            { label: T('more/rmWatermark', 'Remove watermark'), icon: 'trash', disabled: !D.deco.wm, onClick: function () { DE.remove('wm'); } },
            { label: T('more/rmBackground', 'Remove background'), icon: 'trash', disabled: !D.deco.bg, onClick: function () { DE.remove('bg'); } },
            { label: T('hf/remove', 'Remove header & footer'), icon: 'trash', disabled: !D.deco.hf, onClick: function () { DE.remove('hf'); } },
            { label: T('pn/remove', 'Remove page numbers'), icon: 'trash', disabled: !D.deco.pn, onClick: function () { DE.remove('pn'); } }
        ];
    };

    A.menus.pageMenu = function () {
        var ts = targets();
        var many = ts.length > 1;
        return [
            { header: many ? T('org/nPages', '{n} pages', { n: ts.length }) : T('panel/pageN', 'Page {n}', { n: ts[0] + 1 }) },
            { label: T('rb/rotright', 'Rotate Right'), icon: 'rotate', onClick: function () { PE.run('rotateRight'); } },
            { label: T('rb/rotleft', 'Rotate Left'), icon: 'rotateleft', onClick: function () { PE.run('rotateLeft'); } },
            { label: T('rb/duppages', 'Duplicate'), icon: 'duplicate', onClick: function () { PE.run('duplicatePages'); } },
            { label: T('rb/delpages', 'Delete'), icon: 'trash', danger: true, disabled: ts.length >= D.pages.length, onClick: function () { PE.run('deletePages'); } },
            { sep: true },
            { label: T('org/blankAfter', 'Insert blank page after'), icon: 'blankpage', onClick: function () {
                var d = D.dims(ts[ts.length - 1]);
                var at = ts[ts.length - 1] + 1;
                D.insertPages([D.blankPage(d.w, d.h)], at);
                V.goto(at);
            } },
            { label: T('org/fromPdf', 'Insert pages from a PDF...'), icon: 'insertpdf', onClick: function () { PE.run('insertPdf'); } },
            { sep: true },
            { label: T('rb/moveup', 'Move Up'), icon: 'moveup', disabled: ts[0] === 0, onClick: function () { PE.run('moveUp'); } },
            { label: T('rb/movedown', 'Move Down'), icon: 'movedown', disabled: ts[ts.length - 1] >= D.pages.length - 1, onClick: function () { PE.run('moveDown'); } },
            { sep: true },
            { label: T('org/extract', 'Extract...'), icon: 'extract', onClick: function () { PE.run('extract'); } }
        ];
    };

    A.deletePages = function () {
        var ts = targets();
        var any = ts.some(function (k) { return D.pages[k].objs.length; });
        var go = function () {
            if (D.deletePages(ts)) {
                P.picked = [];
                V.goto(Math.min(ts[0], D.pages.length - 1));
            }
        };
        if (ts.length > 1 || any) {
            PE.confirm(T('org/delTitle', 'Delete pages'), T('org/delText', 'Delete {n} page(s)? You can undo this.', { n: ts.length }), T('common/delete', 'Delete'), { danger: true }).then(function (ok) {
                if (ok) {
                    go();
                }
            });
        } else {
            go();
        }
    };

    /* ------------------------------------------------------------ opening */
    A.confirmDiscard = function () {
        if (!D.dirty || !D.loaded) {
            return Promise.resolve(true);
        }
        O.commitEdit();
        return PE.ask3(T('dirty/title', 'Save changes?'), T('dirty/text', 'Do you want to save the changes to "{name}"?', { name: D.name }),
            PE.hasBackend ? T('dirty/save', 'Save') : T('dirty/download', 'Download'), T('dirty/discard', "Don't save")).then(function (a) {
            if (a === 'yes') {
                return S.save();
            }
            return a === 'no';
        });
    };

    function openBytes(bytes, name, path) {
        var b = PE.busy(T('open/opening', 'Opening {name}...', { name: name }));
        return D.open(bytes, name, path).then(function () {
            b.close();
            if (path) {
                A.addRecent(path, name);
            }
            if (D.sources[0] && D.sources[0].encrypted) {
                PE.toast(T('open/encrypted', 'This PDF is protected. When you save, its pages are stored as pictures.'), { ms: 8000 });
            }
        }).catch(function (err) {
            b.close();
            if (err && /PasswordException/.test(err.name || '')) {
                return;
            }
            console.error('[PDF Editor] open failed', err);
            PE.alert(T('open/failTitle', 'Could not open the file'), T('open/failText', '"{name}" could not be opened as a PDF.', { name: name }) + ' ' + ((err && err.message) || ''));
        });
    }

    A.openPath = function (path, name) {
        name = name || PE.baseName(path);
        return A.confirmDiscard().then(function (ok) {
            if (!ok) {
                return;
            }
            var b = PE.busy(T('open/loading', 'Loading {name}...', { name: name }));
            return PE.fetchBytes(PE.mediaUrl(path)).then(function (bytes) {
                b.close();
                return openBytes(bytes, name, path);
            }, function (err) {
                b.close();
                PE.alert(T('open/failTitle', 'Could not open the file'), name + ': ' + err.message);
            });
        });
    };

    A.openDialog = function () {
        if (!PE.hasBackend) {
            A.openFromDevice();
            return;
        }
        PE.pickServer({ filter: ['pdf'], root: D.path ? PE.dirOf(D.path) : 'user:/', key: 'open' }).then(function (files) {
            if (files.length) {
                A.openPath(files[0].filepath, files[0].filename);
            }
        });
    };

    A.openFromDevice = function () {
        PE.pickLocal('application/pdf,.pdf').then(function (files) {
            if (!files.length) {
                return;
            }
            A.openFile(files[0]);
        });
    };

    A.openFile = function (file) {
        return A.confirmDiscard().then(function (ok) {
            if (!ok) {
                return;
            }
            return PE.readFile(file).then(function (bytes) {
                return openBytes(bytes, file.name, null);
            });
        });
    };

    A.closeDoc = function () {
        A.confirmDiscard().then(function (ok) {
            if (!ok) {
                return;
            }
            O.commitEdit();
            O.clearSel();
            V.setTool('select');
            D.reset();
            V.clear();
            P.resetThumbs();
            A.refreshAll();
        });
    };

    /* ------------------------------------------------------------ recents */
    var LS_RECENT = 'pdfeditor.recent';
    A.recents = function () {
        try {
            return JSON.parse(localStorage.getItem(LS_RECENT) || '[]');
        } catch (e) {
            return [];
        }
    };
    A.addRecent = function (path, name) {
        var list = A.recents().filter(function (r) { return r.path !== path; });
        list.unshift({ path: path, name: name, t: Date.now() });
        try {
            localStorage.setItem(LS_RECENT, JSON.stringify(list.slice(0, 10)));
        } catch (e) {
            //private mode
        }
    };
    A.clearRecents = function () {
        try {
            localStorage.removeItem(LS_RECENT);
        } catch (e) {
            //private mode
        }
        renderEmpty();
    };

    /* ------------------------------------------------------------ chrome */
    function updateTitle() {
        var nm = PE.$('peDocName');
        if (!D.loaded) {
            nm.textContent = '';
            try {
                ao_module_setWindowTitle(T('app/title', 'PDF Editor'));
            } catch (e) {
                //standalone
            }
            document.title = T('app/title', 'PDF Editor');
            return;
        }
        nm.innerHTML = PE.esc(D.name) + (D.dirty ? '<span class="dirty" title="' + PE.esc(T('props/unsaved', 'unsaved changes')) + '">*</span>' : '');
        nm.title = D.path || D.name;
        var t = (D.dirty ? '* ' : '') + D.name + ' - ' + T('app/title', 'PDF Editor');
        document.title = t;
        try {
            ao_module_setWindowTitle(t);
        } catch (e) {
            //standalone
        }
    }

    function renderEmpty() {
        var el = PE.$('peEmpty');
        el.hidden = D.loaded;
        PE.$('peViewer').style.visibility = D.loaded ? '' : 'hidden';
        if (D.loaded) {
            return;
        }
        var recent = PE.hasBackend ? A.recents() : [];
        var h = '<div class="pe-empty-card"><svg class="ic big" viewBox="0 0 24 24"><use href="#pe-i-editpdf"/></svg>' +
            '<h2>' + PE.esc(T('empty/title', 'Open a PDF to edit')) + '</h2>' +
            '<p>' + PE.esc(T('empty/text', 'Change its text, add text, pictures and signatures, organize pages or convert it for Docs, Sheets and Slides. You can also drop a PDF here.')) + '</p>' +
            '<div class="row">' +
            (PE.hasBackend ? '<button class="pe-btn primary" data-act="open">' + PE.icon('folder', 'sm') + PE.esc(T('empty/open', 'Open from My Files')) + '</button>' : '') +
            '<button class="pe-btn' + (PE.hasBackend ? '' : ' primary') + '" data-act="device">' + PE.icon('device', 'sm') + PE.esc(T('empty/device', 'Open from this device')) + '</button>' +
            '<button class="pe-btn" data-act="new">' + PE.icon('newdoc', 'sm') + PE.esc(T('empty/new', 'New blank PDF')) + '</button></div>';
        if (recent.length) {
            h += '<div class="pe-empty-recent"><div class="pe-list-h">' + PE.esc(T('empty/recent', 'Recent')) + '</div>';
            recent.slice(0, 6).forEach(function (r, i) {
                h += '<div class="pe-li" data-recent="' + i + '">' + PE.icon('pdf', 'sm') + '<span class="grow">' + PE.esc(r.name) +
                    ' <span class="sub">' + PE.esc(PE.dirOf(r.path)) + '</span></span></div>';
            });
            h += '</div>';
        }
        h += '</div>';
        el.innerHTML = h;
        var act = function (sel, fn) {
            var b = el.querySelector(sel);
            if (b) {
                b.addEventListener('click', fn);
            }
        };
        act('[data-act=open]', function () { PE.run('open'); });
        act('[data-act=device]', function () { PE.run('openDevice'); });
        act('[data-act=new]', function () { PE.run('newBlank'); });
        Array.prototype.forEach.call(el.querySelectorAll('[data-recent]'), function (row) {
            row.addEventListener('click', function () {
                var r = recent[+row.dataset.recent];
                A.openPath(r.path, r.name);
            });
        });
    }

    A.refreshAll = function () {
        renderEmpty();
        updateTitle();
        P.renderLeft();
        P.renderProps();
        R.refresh();
        V.updateStatus();
    };

    var uiTimer = null;
    PE.emitUi = function () {
        clearTimeout(uiTimer);
        uiTimer = setTimeout(function () {
            R.refresh();
            updateTitle();
            var tb = PE.$('peThemeBtn');
            if (tb) {
                var dark = document.body.classList.contains('dark');
                tb.innerHTML = PE.icon(dark ? 'sun' : 'moon', 'sm');
                tb.title = dark ? T('rb/lightmode', 'Light Mode') : T('rb/darkmode', 'Dark Mode');
            }
        }, 10);
    };

    PE.emitSel = function () {
        P.renderProps();
        if (P.left === 'objects' && P.leftOpen) {
            P.renderLeft();
        }
        PE.emitUi();
    };

    PE.emitPage = function () {
        P.markCurrent();
        P.renderProps();
        PE.emitUi();
    };

    /* ------------------------------------------------------------ find */
    A.showFind = function () {
        var bar = PE.$('peFind');
        bar.hidden = false;
        var inp = PE.$('peFindInput');
        inp.focus();
        inp.select();
    };

    function bindFind() {
        var bar = PE.$('peFind');
        var inp = PE.$('peFindInput');
        var cnt = PE.$('peFindCount');
        var timer = null;
        function show() {
            var st = V.findState();
            cnt.textContent = inp.value ? (st.count ? (st.idx + 1) + ' / ' + st.count : T('find/none', 'No results')) : '';
        }
        inp.addEventListener('input', function () {
            clearTimeout(timer);
            timer = setTimeout(function () {
                V.findRun(inp.value.trim()).then(show);
            }, 220);
        });
        inp.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                V.findStep(e.shiftKey ? -1 : 1);
                show();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                close();
            }
        });
        function close() {
            bar.hidden = true;
            V.findClear();
            inp.value = '';
            cnt.textContent = '';
        }
        PE.$('peFindPrev').addEventListener('click', function () { V.findStep(-1); show(); });
        PE.$('peFindNext').addEventListener('click', function () { V.findStep(1); show(); });
        PE.$('peFindClose').addEventListener('click', close);
    }

    /* ------------------------------------------------------------ status bar */
    function bindStatus() {
        PE.$('peFirst').addEventListener('click', function () { V.goto(0); });
        PE.$('pePrev').addEventListener('click', function () { V.goto(V.cur - 1); });
        PE.$('peNext').addEventListener('click', function () { V.goto(V.cur + 1); });
        PE.$('peLast').addEventListener('click', function () { V.goto(D.pages.length - 1); });
        var inp = PE.$('pePageInput');
        inp.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                var n = parseInt(inp.value, 10);
                if (n >= 1) {
                    V.goto(n - 1);
                }
                inp.blur();
            } else if (e.key === 'Escape') {
                inp.blur();
            }
        });
        inp.addEventListener('blur', function () { V.updateStatus(); });
        inp.addEventListener('focus', function () { inp.select(); });
        PE.$('peFitBtn').addEventListener('click', function () { V.setFit(V.fit === 'width' ? 'page' : 'width'); });
        PE.$('peZoomOut').addEventListener('click', function () { V.zoomStep(-1); });
        PE.$('peZoomIn').addEventListener('click', function () { V.zoomStep(1); });
        var sl = PE.$('peZoomSlider');
        sl.addEventListener('input', function () { V.setZoom(V.sliderToZoom(+sl.value)); });
        PE.$('peZoomLbl').addEventListener('click', function () {
            var b = this;
            PE.menu(b, [50, 75, 100, 125, 150, 200, 300, 400].map(function (z) {
                return { label: z + '%', checked: Math.round(V.zoom * 100) === z, onClick: function () { V.setZoom(z / 100); } };
            }).concat([{ sep: true },
                { label: T('rb/fitwidth', 'Fit Width'), icon: 'fitwidth', checked: V.fit === 'width', onClick: function () { V.setFit('width'); } },
                { label: T('rb/fitpage', 'Fit Page'), icon: 'fitpage', checked: V.fit === 'page', onClick: function () { V.setFit('page'); } }]));
        });
        PE.$('peModeBtn').addEventListener('click', function () {
            PE.menu(this, [
                { label: T('rb/single', 'Single Page'), icon: 'single', checked: V.mode === 'single', onClick: function () { V.setMode('single'); } },
                { label: T('rb/continuous', 'Continuous'), icon: 'continuous', checked: V.mode === 'continuous', onClick: function () { V.setMode('continuous'); } },
                { label: T('rb/twopage', 'Two Pages'), icon: 'twopage', checked: V.mode === 'two', onClick: function () { V.setMode('two'); } }
            ]);
        });
    }

    /* ------------------------------------------------------------ theme */
    var systemDark = false;
    function applyTheme(dark) {
        systemDark = dark;
        document.body.classList.toggle('dark', dark);
        try {
            ao_module_setWindowTheme(dark ? 'dark' : 'white');
        } catch (e) {
            //not in a float window
        }
        PE.emitUi();
    }

    function initTheme() {
        var standalone = !PE.hasBackend;
        if (standalone) {
            var saved = null;
            try {
                saved = localStorage.getItem('pdfeditor.theme');
            } catch (e) {
                saved = null;
            }
            applyTheme(saved ? saved === 'dark' : !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches));
        } else {
            applyTheme(false);
            try {
                ao_module_getSystemThemeColor(function (pref) {
                    applyTheme(pref === 'darkTheme' || pref === 'dark');
                });
            } catch (e) {
                //no preference service
            }
        }
        try {
            ao_module_onThemeChanged(function (theme) {
                applyTheme(theme === 'dark' || theme === 'darkTheme');
            });
        } catch (e) {
            //older ao_module
        }
    }

    A.toggleTheme = function () {
        if (PE.hasBackend && typeof ao_module_toggleSystemTheme === 'function') {
            ao_module_toggleSystemTheme();
            return;
        }
        var dark = !systemDark;
        try {
            localStorage.setItem('pdfeditor.theme', dark ? 'dark' : 'light');
        } catch (e) {
            //private mode
        }
        applyTheme(dark);
    };

    /* ------------------------------------------------------------ keyboard */
    function onKey(e) {
        if (PE.dialogOpen()) {
            return;
        }
        var typing = V.isTyping(e.target);
        var mod = e.ctrlKey || e.metaKey;
        var k = e.key;
        if (mod && !e.altKey) {
            var lk = k.toLowerCase();
            if (lk === 's') {
                e.preventDefault();
                PE.run(e.shiftKey ? 'saveAs' : 'save');
                return;
            }
            if (lk === 'o') {
                e.preventDefault();
                PE.run('open');
                return;
            }
            if (lk === 'p') {
                e.preventDefault();
                PE.run('print');
                return;
            }
            if (lk === 'f') {
                e.preventDefault();
                PE.run('find');
                return;
            }
            if (typing) {
                return;
            }
            if (lk === 'z') {
                e.preventDefault();
                PE.run(e.shiftKey ? 'redo' : 'undo');
                return;
            }
            if (lk === 'y') {
                e.preventDefault();
                PE.run('redo');
                return;
            }
            if (lk === 'd') {
                e.preventDefault();
                PE.run('duplicate');
                return;
            }
            if (lk === 'a' && V.tool !== 'textsel') {
                if (O.selectAll()) {
                    e.preventDefault();
                }
                return;
            }
            if (k === '=' || k === '+') {
                e.preventDefault();
                PE.run('zoomIn');
                return;
            }
            if (k === '-') {
                e.preventDefault();
                PE.run('zoomOut');
                return;
            }
            if (k === '0') {
                e.preventDefault();
                PE.run('fitWidth');
                return;
            }
            return;
        }
        if (typing) {
            return;
        }
        if (k === 'Escape') {
            PE.closeMenus();
            if (O.editing()) {
                O.commitEdit();
            } else if (V.tool !== 'select') {
                V.setTool('select');
            } else {
                O.clearSel();
            }
            return;
        }
        if (!D.loaded) {
            return;
        }
        if ((k === 'Delete' || k === 'Backspace') && hasSel()) {
            e.preventDefault();
            O.deleteSel();
            return;
        }
        if (hasSel() && /^Arrow/.test(k)) {
            e.preventDefault();
            var step = e.shiftKey ? 10 : 1;
            O.nudge(k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0, k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0);
            return;
        }
        if (k === 'PageDown' && (V.mode === 'single' || e.target === document.body)) {
            e.preventDefault();
            V.goto(V.cur + 1);
            return;
        }
        if (k === 'PageUp' && (V.mode === 'single' || e.target === document.body)) {
            e.preventDefault();
            V.goto(V.cur - 1);
            return;
        }
        if (k === 'Home' && !e.shiftKey) {
            e.preventDefault();
            V.goto(0);
            return;
        }
        if (k === 'End' && !e.shiftKey) {
            e.preventDefault();
            V.goto(D.pages.length - 1);
            return;
        }
        if (e.altKey || e.shiftKey) {
            return;
        }
        var keyTools = { h: 'hand', v: 'select', e: 'editpdf', t: 'text' };
        if (keyTools[k.toLowerCase()]) {
            V.setTool(keyTools[k.toLowerCase()]);
        }
    }

    function onPaste(e) {
        if (PE.dialogOpen() || V.isTyping(e.target) || !D.loaded) {
            return;
        }
        var cd = e.clipboardData;
        if (!cd) {
            return;
        }
        var files = Array.prototype.slice.call(cd.files || []).filter(function (f) { return /^image\//.test(f.type); });
        if (files.length) {
            e.preventDefault();
            PE.readFile(files[0]).then(D.assetFromBytes).then(function (id) {
                var a = D.assets[id];
                var k = V.cur, d = D.dims(k);
                var w = a.w * 0.75, h = a.h * 0.75;
                var f = Math.min(1, d.w * 0.6 / w, d.h * 0.6 / h);
                w *= f;
                h *= f;
                O.add(k, { type: 'image', asset: id, x: d.ox + (d.w - w) / 2, y: d.oy + (d.h - h) / 2, w: w, h: h, angle: 0 });
            });
            return;
        }
        var text = cd.getData('text/plain');
        if (O.hasClip() && (!text || O.pasteMatches(text))) {
            e.preventDefault();
            O.paste();
            return;
        }
        if (text && text.trim()) {
            e.preventDefault();
            var st = O.style.text;
            var k2 = V.cur, d2 = D.dims(k2);
            var o = { type: 'text', text: text.replace(/\r\n?/g, '\n').substring(0, 20000), font: st.font, size: st.size, color: st.color, bold: st.bold, italic: st.italic, align: 'left', lh: 1.2, wrap: false, x: 0, y: 0, w: 10, h: 10, angle: 0 };
            PE.fonts.layout(o);
            PE.fonts.fit(o);
            if (o.w > d2.w * 0.8) {
                o.wrap = true;
                o.w = d2.w * 0.8;
                PE.fonts.fit(o);
            }
            o.x = d2.ox + (d2.w - o.w) / 2;
            o.y = d2.oy + Math.max(20, (d2.h - o.h) / 3);
            O.add(k2, o);
        }
    }

    function onCopy(e) {
        if (PE.dialogOpen() || V.isTyping(e.target) || !hasSel()) {
            return;
        }
        var s = window.getSelection();
        if (s && String(s).length) {
            return;
        }
        O.copy(e.type === 'cut');
        if (e.clipboardData) {
            e.clipboardData.setData('text/plain', '');
            e.preventDefault();
        }
    }

    /* ------------------------------------------------------------ drag and drop */
    function bindDrop() {
        var center = PE.$('peCenter');
        var drop = PE.$('peDrop');
        var depth = 0;
        function isFiles(e) {
            return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0;
        }
        center.addEventListener('dragenter', function (e) {
            if (!isFiles(e)) {
                return;
            }
            depth++;
            drop.hidden = false;
            drop.textContent = D.loaded ? T('drop/both', 'Drop a PDF to open it, or a picture to put it on the page') : T('drop/pdf', 'Drop a PDF to open it');
        });
        center.addEventListener('dragleave', function (e) {
            if (!isFiles(e)) {
                return;
            }
            depth = Math.max(0, depth - 1);
            if (!depth) {
                drop.hidden = true;
            }
        });
        center.addEventListener('dragover', function (e) {
            if (isFiles(e)) {
                e.preventDefault();
            }
        });
        center.addEventListener('drop', function (e) {
            if (!isFiles(e)) {
                return;
            }
            e.preventDefault();
            depth = 0;
            drop.hidden = true;
            var files = Array.prototype.slice.call(e.dataTransfer.files || []);
            var pdf = files.filter(function (f) { return /\.pdf$/i.test(f.name) || f.type === 'application/pdf'; })[0];
            if (pdf) {
                A.openFile(pdf);
                return;
            }
            var img = files.filter(function (f) { return /^image\//.test(f.type); })[0];
            if (img && D.loaded) {
                var k = V.pageAtClient(e.clientX, e.clientY);
                if (k < 0) {
                    k = V.cur;
                }
                var pt = V.pagePoint(k, e.clientX, e.clientY);
                PE.readFile(img).then(D.assetFromBytes).then(function (id) {
                    var a = D.assets[id];
                    var d = D.dims(k);
                    var w = a.w * 0.75, h = a.h * 0.75;
                    var f = Math.min(1, d.w * 0.5 / w, d.h * 0.5 / h);
                    w *= f;
                    h *= f;
                    O.add(k, { type: 'image', asset: id, x: pt.x - w / 2, y: pt.y - h / 2, w: w, h: h, angle: 0 });
                });
            }
        });
    }

    /* ------------------------------------------------------------ close guard */
    function installCloseGuard() {
        if (typeof window.ao_module_close === 'function' && typeof ao_module_virtualDesktop !== 'undefined' && ao_module_virtualDesktop) {
            var reallyClose = function () {
                D.dirty = false;
                if (typeof window.ao_module_closeHandler === 'function') {
                    ao_module_closeHandler();
                }
            };
            window.ao_module_close = function () {
                if (!D.dirty || !D.loaded) {
                    reallyClose();
                    return;
                }
                A.confirmDiscard().then(function (ok) {
                    if (ok) {
                        reallyClose();
                    }
                });
            };
        }
        window.addEventListener('beforeunload', function (e) {
            if (D.dirty && D.loaded) {
                e.preventDefault();
                e.returnValue = '';
            }
        });
    }

    /* ------------------------------------------------------------ boot */
    function loadLocale() {
        return new Promise(function (resolve) {
            if (typeof applocale === 'undefined' || !applocale) {
                resolve();
                return;
            }
            applocale.init('locale/pdfeditor.json', function () {
                try {
                    applocale.translate();
                } catch (e) {
                    //keep the English markup
                }
                resolve();
            }, resolve);
        });
    }

    function detectBackend() {
        return new Promise(function (resolve) {
            var done = false;
            var timer = setTimeout(function () {
                if (!done) {
                    done = true;
                    resolve(false);
                }
            }, 5000);
            PE.agi('office.agi', { opr: 'ping' }).then(function (r) {
                if (!done) {
                    done = true;
                    clearTimeout(timer);
                    resolve(!!(r && r.ok));
                }
            }, function () {
                if (!done) {
                    done = true;
                    clearTimeout(timer);
                    resolve(false);
                }
            });
        });
    }

    function wireModel() {
        D.on('load', function () {
            O.clearSel();
            V.setTool('select');
            V.clear();
            P.resetThumbs();
            P.picked = [];
            V.cur = 0;
            renderEmpty();
            V.rebuild();
            V.setFit('width');
            V.goto(0, true);
            A.refreshAll();
        });
        D.on('change', function (what) {
            what = what || {};
            if (what.structure || what.restore) {
                O.commitEdit();
                if (what.restore) {
                    O.clearSel();
                }
                V.rebuild();
            } else if (what.pages) {
                what.pages.forEach(function (k) {
                    V.refreshPage(k);
                });
            } else {
                V.refreshAll();
            }
            P.renderLeft();
            P.renderProps();
            PE.emitUi();
        });
        D.on('objects', function (what) {
            if (what && what.k >= 0) {
                P.refreshThumb(what.k);
            } else {
                D.pages.forEach(function (p, k) {
                    P.refreshThumb(k);
                });
            }
            if (P.left === 'objects') {
                P.renderLeft();
            }
            P.renderProps();
            PE.emitUi();
        });
        D.on('dirty', function () {
            updateTitle();
            PE.emitUi();
        });
        D.on('saved', function () {
            P.renderProps();
            updateTitle();
        });
    }

    function boot() {
        PE.injectIcons();
        loadLocale().then(function () {
            return detectBackend();
        }).then(function (backend) {
            PE.hasBackend = backend;
            document.body.classList.toggle('standalone', !backend);
            return PE.libs.pdflib().catch(function () {});
        }).then(function () {
            PE.libs.pdfjs().catch(function () {});
            PE.fonts.loadLibrary().then(function () {
                P.renderProps();
            });
            initTheme();
            R.init();
            V.init();
            O.init();
            P.init();
            bindStatus();
            bindFind();
            bindDrop();
            wireModel();
            installCloseGuard();
            PE.$('peThemeBtn').addEventListener('click', A.toggleTheme);
            document.addEventListener('keydown', onKey);
            document.addEventListener('paste', onPaste);
            document.addEventListener('copy', onCopy);
            document.addEventListener('cut', onCopy);
            A.refreshAll();
            PE.emitUi();
            var input = null;
            try {
                input = ao_module_loadInputFiles();
            } catch (e) {
                input = null;
            }
            var params = new URLSearchParams(location.search);
            if (input && input.length && input[0].filepath) {
                A.openPath(input[0].filepath, input[0].filename);
            } else if (params.get('open')) {
                //a plain URL (tests, the static preview)
                var url = params.get('open');
                PE.fetchBytes(url).then(function (bytes) {
                    return openBytes(bytes, PE.baseName(url.split('?')[0]), null);
                }).catch(function (err) {
                    PE.toast(err.message, { error: true });
                });
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})(window.PE);
