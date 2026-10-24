/*
    PDF Editor - shared helpers

    DOM and string helpers, localisation, library loaders, file transfer
    (ArozOS storage through ao_module, or the browser when the page runs
    without a backend), and the menu / dialog / toast primitives every
    other module uses.
*/
window.PE = window.PE || {};

(function (PE) {
    'use strict';

    PE.APP = 'PDF Editor';
    PE.VERSION = '1.0';
    PE.hasBackend = false;      //set by app.js once the AGI backend answered

    /* ------------------------------------------------------------ basics */
    PE.$ = function (id) {
        return document.getElementById(id);
    };

    PE.el = function (tag, cls, html) {
        var e = document.createElement(tag);
        if (cls) {
            e.className = cls;
        }
        if (html !== undefined && html !== null) {
            e.innerHTML = html;
        }
        return e;
    };

    PE.esc = function (s) {
        return String(s === undefined || s === null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    };

    PE.clamp = function (v, lo, hi) {
        return Math.max(lo, Math.min(hi, v));
    };

    var uidN = 0;
    PE.uid = function (p) {
        uidN++;
        return (p || 'o') + Date.now().toString(36) + uidN.toString(36) + Math.floor(Math.random() * 1296).toString(36);
    };

    PE.clone = function (o) {
        return JSON.parse(JSON.stringify(o));
    };

    /*
        Localised string from locale/pdfeditor.json, falling back to the
        English text. {name} placeholders are filled from vars.
    */
    PE.T = function (key, fallback, vars) {
        var s = fallback;
        try {
            if (typeof applocale !== 'undefined' && applocale && applocale.localData && applocale.localData.keys) {
                s = applocale.getString(key, fallback);
            }
        } catch (e) {
            s = fallback;
        }
        s = String(s === undefined || s === null ? '' : s);
        if (vars) {
            Object.keys(vars).forEach(function (k) {
                s = s.split('{' + k + '}').join(vars[k]);
            });
        }
        return s;
    };

    /* --------------------------------------------------------- formatting */
    PE.fmtBytes = function (n) {
        if (!(n >= 0)) {
            return '';
        }
        if (n < 1024) {
            return n + ' B';
        }
        if (n < 1024 * 1024) {
            return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
        }
        if (n < 1024 * 1024 * 1024) {
            return (n / 1048576).toFixed(1) + ' MB';
        }
        return (n / 1073741824).toFixed(2) + ' GB';
    };

    function pad2(n) {
        return (n < 10 ? '0' : '') + n;
    }

    PE.fmtDate = function (d) {
        if (!(d instanceof Date) || isNaN(d.getTime())) {
            return '';
        }
        var h = d.getHours();
        var ap = h >= 12 ? 'PM' : 'AM';
        var h12 = h % 12 === 0 ? 12 : h % 12;
        return d.getFullYear() + '/' + pad2(d.getMonth() + 1) + '/' + pad2(d.getDate()) + ' ' +
            pad2(h12) + ':' + pad2(d.getMinutes()) + ' ' + ap;
    };

    PE.fmtDay = function (d) {
        d = d || new Date();
        return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    };

    //PDF date string "D:YYYYMMDDHHmmSSOHH'mm'" (most parts optional) to a Date
    PE.parsePdfDate = function (s) {
        if (!s) {
            return null;
        }
        if (s instanceof Date) {
            return s;
        }
        var m = /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+\-])?(\d{2})?'?(\d{2})?/.exec(String(s));
        if (!m) {
            return null;
        }
        var y = +m[1], mo = m[2] ? +m[2] - 1 : 0, d = m[3] ? +m[3] : 1;
        var hh = m[4] ? +m[4] : 0, mi = m[5] ? +m[5] : 0, ss = m[6] ? +m[6] : 0;
        if (m[7] && m[7] !== 'Z' && m[7] !== 'z') {
            var off = (m[8] ? +m[8] : 0) * 60 + (m[9] ? +m[9] : 0);
            var t = Date.UTC(y, mo, d, hh, mi, ss) - (m[7] === '+' ? 1 : -1) * off * 60000;
            return new Date(t);
        }
        if (m[7]) {
            return new Date(Date.UTC(y, mo, d, hh, mi, ss));
        }
        return new Date(y, mo, d, hh, mi, ss);
    };

    /* --------------------------------------------------------------- paths */
    PE.dirOf = function (p) {
        p = String(p || '');
        var i = p.lastIndexOf('/');
        return i < 0 ? '' : p.substring(0, i);
    };
    PE.baseName = function (p) {
        return String(p || '').split('/').pop();
    };
    PE.stem = function (name) {
        var n = PE.baseName(name);
        var i = n.lastIndexOf('.');
        return i > 0 ? n.substring(0, i) : n;
    };
    PE.extOf = function (name) {
        var n = PE.baseName(name).toLowerCase();
        var i = n.lastIndexOf('.');
        return i < 0 ? '' : n.substring(i + 1);
    };
    PE.joinPath = function (dir, name) {
        dir = String(dir || '');
        if (dir && dir.charAt(dir.length - 1) !== '/') {
            dir += '/';
        }
        return dir + name;
    };
    PE.root = function () {
        return (typeof ao_root !== 'undefined' && ao_root) ? ao_root : '../';
    };
    PE.mediaUrl = function (vpath) {
        return PE.root() + 'media?file=' + encodeURIComponent(vpath);
    };

    /* ------------------------------------------------------------- loaders */
    var scripts = {};
    PE.loadScript = function (src) {
        if (!scripts[src]) {
            scripts[src] = new Promise(function (resolve, reject) {
                var s = document.createElement('script');
                s.src = src;
                s.onload = function () { resolve(); };
                s.onerror = function () {
                    delete scripts[src];
                    reject(new Error('Failed to load ' + src));
                };
                document.head.appendChild(s);
            });
        }
        return scripts[src];
    };

    PE.libs = {
        pdfjs: function () {
            return PE.loadScript('lib/pdfjs/pdf.js').then(function () {
                pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdfjs/pdf.worker.js';
                return pdfjsLib;
            });
        },
        pdflib: function () {
            return PE.loadScript('lib/pdf-lib.min.js').then(function () {
                return PDFLib;
            });
        },
        fontkit: function () {
            return PE.loadScript('lib/fontkit.umd.min.js').then(function () {
                return window.fontkit;
            });
        }
    };

    /* ------------------------------------------------------------ transfer */
    PE.fetchBytes = function (url) {
        return fetch(url, { credentials: 'same-origin' }).then(function (r) {
            if (!r.ok) {
                throw new Error('HTTP ' + r.status);
            }
            return r.arrayBuffer();
        }).then(function (b) {
            return new Uint8Array(b);
        });
    };

    PE.readFile = function (file) {
        return new Promise(function (resolve, reject) {
            var fr = new FileReader();
            fr.onload = function () { resolve(new Uint8Array(fr.result)); };
            fr.onerror = function () { reject(fr.error || new Error('Read failed')); };
            fr.readAsArrayBuffer(file);
        });
    };

    PE.readDataUrl = function (blob) {
        return new Promise(function (resolve, reject) {
            var fr = new FileReader();
            fr.onload = function () { resolve(fr.result); };
            fr.onerror = function () { reject(fr.error || new Error('Read failed')); };
            fr.readAsDataURL(blob);
        });
    };

    /*
        Run one of this app's AGI scripts (backend/<name>.agi). Resolves
        with the parsed JSON reply; a reply carrying {error} rejects.
    */
    PE.agi = function (script, data) {
        return new Promise(function (resolve, reject) {
            if (typeof ao_module_agirun !== 'function') {
                reject(new Error('No backend'));
                return;
            }
            ao_module_agirun(PE.APP + '/backend/' + script, data || {}, function (reply) {
                var r = reply;
                if (typeof r === 'string') {
                    try {
                        r = JSON.parse(r);
                    } catch (e) {
                        //plain text reply
                    }
                }
                if (r && typeof r === 'object' && r.error) {
                    reject(new Error(r.error));
                    return;
                }
                resolve(r);
            }, function (xhr) {
                var msg = 'Request failed';
                try {
                    var j = JSON.parse(xhr.responseText);
                    msg = j.error || j.message || msg;
                } catch (e) {
                    if (xhr && xhr.responseText) {
                        msg = String(xhr.responseText).substring(0, 200);
                    }
                }
                reject(new Error(msg));
            });
        });
    };

    PE.upload = function (blob, name, dir, onProgress) {
        return new Promise(function (resolve, reject) {
            var file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
            ao_module_uploadFile(file, dir, function (res) {
                if (typeof res === 'string' && res.indexOf('"error"') >= 0) {
                    try {
                        reject(new Error(JSON.parse(res).error));
                        return;
                    } catch (e) {
                        //fall through
                    }
                }
                resolve(res);
            }, function (pct) {
                if (onProgress) {
                    onProgress(pct);
                }
            }, function (err) {
                reject(new Error('Upload failed' + (err ? ' (HTTP ' + err + ')' : '')));
            });
        });
    };

    PE.downloadBytes = function (bytes, name, mime) {
        var blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type: mime || 'application/octet-stream' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
    };

    PE.pickLocal = function (accept, multiple) {
        return new Promise(function (resolve) {
            var inp = document.createElement('input');
            inp.type = 'file';
            inp.accept = accept || '';
            inp.multiple = !!multiple;
            inp.style.display = 'none';
            inp.addEventListener('change', function () {
                var files = Array.prototype.slice.call(inp.files || []);
                document.body.removeChild(inp);
                resolve(files);
            });
            document.body.appendChild(inp);
            inp.click();
        });
    };

    /*
        ArozOS file selector. type: file | folder | new. Resolves with
        [{filepath, filename}], never rejects (an empty list on cancel).
    */
    PE.pickServer = function (opts) {
        opts = opts || {};
        return new Promise(function (resolve) {
            var o = {};
            if (opts.filter) {
                o.filter = opts.filter;
            }
            if (opts.defaultName) {
                o.defaultName = opts.defaultName;
            }
            if (opts.key) {
                o.path_memory_key = opts.key;
            }
            try {
                ao_module_openFileSelector(function (files) {
                    resolve(files || []);
                }, opts.root || 'user:/', opts.type || 'file', !!opts.multiple, o);
            } catch (e) {
                resolve([]);
            }
        });
    };

    /* -------------------------------------------------------------- colour */
    PE.hexToRgb = function (hex) {
        var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex || '#000000');
        if (!m) {
            return { r: 0, g: 0, b: 0 };
        }
        return { r: parseInt(m[1], 16) / 255, g: parseInt(m[2], 16) / 255, b: parseInt(m[3], 16) / 255 };
    };

    PE.rgbToHex = function (r, g, b) {
        function h(v) {
            v = Math.max(0, Math.min(255, Math.round(v)));
            return (v < 16 ? '0' : '') + v.toString(16);
        }
        return '#' + h(r) + h(g) + h(b);
    };

    /* "1-3, 5, 8-" style page list (1-based) to sorted 0-based indices */
    PE.parseRange = function (str, count) {
        var out = {};
        var parts = String(str || '').split(/[,;\s]+/);
        var any = false;
        for (var i = 0; i < parts.length; i++) {
            var p = parts[i].trim();
            if (!p) {
                continue;
            }
            var m = /^(\d*)\s*-\s*(\d*)$/.exec(p);
            var a, b;
            if (m) {
                a = m[1] ? parseInt(m[1], 10) : 1;
                b = m[2] ? parseInt(m[2], 10) : count;
            } else if (/^\d+$/.test(p)) {
                a = b = parseInt(p, 10);
            } else {
                return null;
            }
            if (a > b) {
                var t = a;
                a = b;
                b = t;
            }
            for (var k = Math.max(1, a); k <= Math.min(count, b); k++) {
                out[k - 1] = true;
                any = true;
            }
        }
        if (!any) {
            return null;
        }
        return Object.keys(out).map(Number).sort(function (x, y) { return x - y; });
    };

    /* --------------------------------------------------------------- toast */
    var toastEl = null;
    var toastTimer = null;
    PE.toast = function (msg, opts) {
        opts = opts || {};
        if (!toastEl) {
            toastEl = PE.el('div', 'pe-toast');
            document.body.appendChild(toastEl);
        }
        toastEl.className = 'pe-toast' + (opts.error ? ' err' : '');
        toastEl.innerHTML = '<span>' + PE.esc(msg) + '</span>';
        if (opts.action) {
            var b = PE.el('button', '', PE.esc(opts.action.label));
            b.addEventListener('click', function () {
                toastEl.classList.remove('show');
                opts.action.fn();
            });
            toastEl.appendChild(b);
        }
        void toastEl.offsetWidth;
        toastEl.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () {
            toastEl.classList.remove('show');
        }, opts.ms || (opts.error ? 6500 : 3500));
    };

    /* ---------------------------------------------------------------- menu */
    var openMenus = [];

    function closeMenusFrom(level) {
        while (openMenus.length > level) {
            var m = openMenus.pop();
            if (m.el.parentNode) {
                m.el.parentNode.removeChild(m.el);
            }
            if (m.onClose) {
                m.onClose();
            }
        }
        if (!openMenus.length) {
            document.removeEventListener('pointerdown', onDocDown, true);
            document.removeEventListener('keydown', onMenuKey, true);
            window.removeEventListener('blur', closeAllMenus);
        }
    }

    function closeAllMenus() {
        closeMenusFrom(0);
    }
    PE.closeMenus = closeAllMenus;

    function onDocDown(e) {
        for (var i = openMenus.length - 1; i >= 0; i--) {
            if (openMenus[i].el.contains(e.target) || (openMenus[i].anchor && openMenus[i].anchor.contains && openMenus[i].anchor.contains(e.target))) {
                return;
            }
        }
        closeAllMenus();
    }

    function onMenuKey(e) {
        if (!openMenus.length) {
            return;
        }
        var top = openMenus[openMenus.length - 1];
        var items = Array.prototype.slice.call(top.el.querySelectorAll('.pe-mi:not(:disabled)'));
        var cur = items.indexOf(top.el.querySelector('.pe-mi.hot'));
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            closeMenusFrom(openMenus.length - 1);
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopPropagation();
            if (!items.length) {
                return;
            }
            var n = e.key === 'ArrowDown' ? (cur + 1) % items.length : (cur <= 0 ? items.length - 1 : cur - 1);
            items.forEach(function (it) { it.classList.remove('hot'); });
            items[n].classList.add('hot');
            items[n].focus();
        } else if (e.key === 'Enter' && cur >= 0) {
            e.preventDefault();
            e.stopPropagation();
            items[cur].click();
        } else if (e.key === 'ArrowLeft' && openMenus.length > 1) {
            e.preventDefault();
            closeMenusFrom(openMenus.length - 1);
        }
    }

    /*
        PE.menu(anchor, items, opts)
        anchor: an element (menu opens below it) or {x, y}.
        items:  {label, sub, icon, kbd, checked, disabled, danger, onClick,
                 submenu: items | fn -> items} | {sep:true} | {header:''} |
                {el: Element}
        opts:   {level, side: 'right', onClose, minWidth, className}
    */
    PE.menu = function (anchor, items, opts) {
        opts = opts || {};
        var level = opts.level || 0;
        closeMenusFrom(level);
        var m = PE.el('div', 'pe-menu' + (opts.className ? ' ' + opts.className : ''));
        if (opts.minWidth) {
            m.style.minWidth = opts.minWidth + 'px';
        }
        m.setAttribute('role', 'menu');
        (typeof items === 'function' ? items() : items).forEach(function (it) {
            if (!it) {
                return;
            }
            if (it.sep) {
                m.appendChild(PE.el('div', 'pe-msep'));
                return;
            }
            if (it.header !== undefined) {
                m.appendChild(PE.el('div', 'pe-mh', PE.esc(it.header)));
                return;
            }
            if (it.el) {
                m.appendChild(it.el);
                return;
            }
            var b = PE.el('button', 'pe-mi' + (it.checked ? ' checked' : '') + (it.danger ? ' danger' : ''));
            b.type = 'button';
            b.setAttribute('role', 'menuitem');
            b.disabled = !!it.disabled;
            var ico = it.checked ? PE.icon('check', 'sm') : (it.iconHtml || (it.icon ? PE.icon(it.icon, 'sm') : ''));
            b.innerHTML = '<span class="ico">' + ico + '</span><span class="lbl">' + PE.esc(it.label) +
                (it.sub ? '<small>' + PE.esc(it.sub) + '</small>' : '') + '</span>' +
                (it.kbd ? '<span class="kbd">' + PE.esc(it.kbd) + '</span>' : '') +
                (it.submenu ? '<span class="sub">' + PE.icon('chevright', 'sm') + '</span>' : '');
            if (it.title) {
                b.title = it.title;
            }
            if (it.submenu) {
                var openSub = function () {
                    Array.prototype.forEach.call(m.querySelectorAll('.pe-mi.hot'), function (x) { x.classList.remove('hot'); });
                    b.classList.add('hot');
                    PE.menu(b, it.submenu, { level: level + 1, side: 'right' });
                };
                b.addEventListener('mouseenter', function () {
                    clearTimeout(b._t);
                    b._t = setTimeout(openSub, 140);
                });
                b.addEventListener('mouseleave', function () { clearTimeout(b._t); });
                b.addEventListener('click', function (e) {
                    e.stopPropagation();
                    openSub();
                });
            } else {
                b.addEventListener('mouseenter', function () {
                    if (openMenus.length > level + 1) {
                        closeMenusFrom(level + 1);
                    }
                    Array.prototype.forEach.call(m.querySelectorAll('.pe-mi.hot'), function (x) { x.classList.remove('hot'); });
                });
                b.addEventListener('click', function () {
                    closeAllMenus();
                    if (it.onClick) {
                        it.onClick();
                    }
                });
            }
            m.appendChild(b);
        });
        document.body.appendChild(m);
        var vw = window.innerWidth, vh = window.innerHeight;
        var mw = m.offsetWidth, mh = m.offsetHeight;
        var x, y;
        if (anchor && anchor.getBoundingClientRect) {
            var r = anchor.getBoundingClientRect();
            if (opts.side === 'right') {
                x = r.right + 2;
                y = r.top - 4;
                if (x + mw > vw - 4) {
                    x = r.left - mw - 2;
                }
            } else {
                x = r.left;
                y = r.bottom + 4;
                if (y + mh > vh - 4 && r.top - mh - 4 > 4) {
                    y = r.top - mh - 4;
                }
            }
        } else {
            x = anchor ? anchor.x : 0;
            y = anchor ? anchor.y : 0;
        }
        x = Math.max(4, Math.min(x, vw - mw - 4));
        y = Math.max(4, Math.min(y, vh - mh - 4));
        m.style.left = x + 'px';
        m.style.top = y + 'px';
        if (!openMenus.length) {
            setTimeout(function () {
                document.addEventListener('pointerdown', onDocDown, true);
                document.addEventListener('keydown', onMenuKey, true);
                window.addEventListener('blur', closeAllMenus);
            }, 0);
        }
        openMenus.push({ el: m, anchor: anchor && anchor.getBoundingClientRect ? anchor : null, onClose: opts.onClose });
        return { el: m, close: function () { closeMenusFrom(level); } };
    };

    /* -------------------------------------------------------------- dialog */
    var dialogStack = [];

    /*
        PE.dialog({title, body (html | Element), wide, className,
                   buttons: [{id, label, primary, danger, left, onClick(ctx)}],
                   onOpen(ctx), onClose(), dismissible (default true)})
        onClick returning false keeps the dialog open. The ctx has
        {el, body, close(), button(id)}.
    */
    PE.dialog = function (o) {
        PE.closeMenus();
        var back = PE.el('div', 'pe-backdrop');
        var dlg = PE.el('div', 'pe-dialog' + (o.wide ? ' wide' : '') + (o.className ? ' ' + o.className : ''));
        dlg.setAttribute('role', 'dialog');
        dlg.setAttribute('aria-modal', 'true');
        var head = PE.el('div', 'pe-dialog-h', '<span class="t">' + PE.esc(o.title || '') + '</span>');
        var x = PE.el('button', '', PE.icon('close', 'sm'));
        x.type = 'button';
        x.title = PE.T('common/close', 'Close');
        head.appendChild(x);
        var body = PE.el('div', 'pe-dialog-b');
        if (o.body instanceof Element) {
            body.appendChild(o.body);
        } else if (o.body) {
            body.innerHTML = o.body;
        }
        var foot = PE.el('div', 'pe-dialog-f');
        dlg.appendChild(head);
        dlg.appendChild(body);
        if (o.buttons && o.buttons.length) {
            dlg.appendChild(foot);
        }
        back.appendChild(dlg);
        document.body.appendChild(back);

        var closed = false;
        var ctx = {
            el: dlg,
            body: body,
            close: function () {
                if (closed) {
                    return;
                }
                closed = true;
                if (back.parentNode) {
                    back.parentNode.removeChild(back);
                }
                var i = dialogStack.indexOf(ctx);
                if (i >= 0) {
                    dialogStack.splice(i, 1);
                }
                if (o.onClose) {
                    o.onClose();
                }
            },
            button: function (id) {
                return foot.querySelector('[data-id="' + id + '"]');
            }
        };
        var primary = null;
        (o.buttons || []).forEach(function (bd) {
            var b = PE.el('button', 'pe-btn' + (bd.primary ? ' primary' : '') + (bd.danger ? ' danger' : '') + (bd.left ? ' left' : ''), PE.esc(bd.label));
            b.type = 'button';
            if (bd.id) {
                b.setAttribute('data-id', bd.id);
            }
            b.addEventListener('click', function () {
                var keep = bd.onClick ? bd.onClick(ctx) : undefined;
                if (keep !== false) {
                    ctx.close();
                }
            });
            if (bd.primary) {
                primary = b;
            }
            foot.appendChild(b);
        });
        x.addEventListener('click', function () { ctx.close(); });
        if (o.dismissible !== false) {
            back.addEventListener('pointerdown', function (e) {
                if (e.target === back) {
                    ctx.close();
                }
            });
        }
        ctx.onKey = function (e) {
            if (e.key === 'Escape' && o.dismissible !== false) {
                e.preventDefault();
                ctx.close();
            } else if (e.key === 'Enter' && primary && !primary.disabled && e.target.tagName !== 'TEXTAREA' &&
                !(e.target.tagName === 'BUTTON' && e.target !== primary)) {
                e.preventDefault();
                primary.click();
            }
        };
        dialogStack.push(ctx);
        if (o.onOpen) {
            o.onOpen(ctx);
        }
        setTimeout(function () {
            var f = dlg.querySelector('[autofocus]') || dlg.querySelector('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea') || primary;
            if (f) {
                f.focus();
                if (f.select && f.tagName === 'INPUT' && f.type === 'text') {
                    f.select();
                }
            }
        }, 30);
        return ctx;
    };

    PE.dialogOpen = function () {
        return dialogStack.length > 0;
    };

    document.addEventListener('keydown', function (e) {
        if (dialogStack.length) {
            dialogStack[dialogStack.length - 1].onKey(e);
            e.stopPropagation();
        }
    }, true);

    PE.confirm = function (title, message, okLabel, opts) {
        opts = opts || {};
        return new Promise(function (resolve) {
            var answered = false;
            PE.dialog({
                title: title,
                body: '<p>' + PE.esc(message) + '</p>',
                buttons: [
                    { label: opts.cancelLabel || PE.T('common/cancel', 'Cancel'), onClick: function () { answered = true; resolve(false); } },
                    { label: okLabel || PE.T('common/ok', 'OK'), primary: true, danger: !!opts.danger, onClick: function () { answered = true; resolve(true); } }
                ],
                onClose: function () {
                    if (!answered) {
                        resolve(false);
                    }
                }
            });
        });
    };

    /* Three-way question: resolves 'yes' | 'no' | null (cancelled) */
    PE.ask3 = function (title, message, yesLabel, noLabel) {
        return new Promise(function (resolve) {
            var answer = null;
            PE.dialog({
                title: title,
                body: '<p>' + PE.esc(message) + '</p>',
                buttons: [
                    { label: noLabel, left: true, onClick: function () { answer = 'no'; } },
                    { label: PE.T('common/cancel', 'Cancel') },
                    { label: yesLabel, primary: true, onClick: function () { answer = 'yes'; } }
                ],
                onClose: function () { resolve(answer); }
            });
        });
    };

    PE.alert = function (title, message) {
        return new Promise(function (resolve) {
            PE.dialog({
                title: title,
                body: '<p>' + PE.esc(message) + '</p>',
                buttons: [{ label: PE.T('common/ok', 'OK'), primary: true }],
                onClose: resolve
            });
        });
    };

    /* Modal progress card: PE.busy(msg) -> {set(msg, fraction), close()} */
    PE.busy = function (msg) {
        var back = PE.el('div', 'pe-busy');
        back.innerHTML = '<div class="pe-busy-card"><div class="msg"><span class="pe-spin"></span><span class="t"></span></div>' +
            '<div class="pe-progress" hidden><i></i></div></div>';
        back.querySelector('.t').textContent = msg || '';
        document.body.appendChild(back);
        return {
            set: function (m, frac) {
                if (m) {
                    back.querySelector('.t').textContent = m;
                }
                var bar = back.querySelector('.pe-progress');
                if (frac >= 0) {
                    bar.hidden = false;
                    bar.firstChild.style.width = Math.round(PE.clamp(frac, 0, 1) * 100) + '%';
                }
            },
            close: function () {
                if (back.parentNode) {
                    back.parentNode.removeChild(back);
                }
            }
        };
    };

    /* Give the browser a moment to paint (works in background tabs too) */
    PE.tick = function () {
        return new Promise(function (resolve) {
            setTimeout(resolve, 0);
        });
    };

    PE.canvasToBlob = function (canvas, type, quality) {
        return new Promise(function (resolve, reject) {
            if (canvas.toBlob) {
                canvas.toBlob(function (b) {
                    if (b) {
                        resolve(b);
                    } else {
                        reject(new Error('Canvas export failed'));
                    }
                }, type || 'image/png', quality);
            } else {
                fetch(canvas.toDataURL(type, quality)).then(function (r) { return r.blob(); }).then(resolve, reject);
            }
        });
    };

    PE.loadImage = function (src) {
        return new Promise(function (resolve, reject) {
            var img = new Image();
            img.onload = function () { resolve(img); };
            img.onerror = function () { reject(new Error('Could not load the image')); };
            img.src = src;
        });
    };

    /* Colour palette menu: cb(hex | null for "none") */
    var PALETTE = ['#000000', '#404040', '#7f7f7f', '#bfbfbf', '#ffffff', '#c00000', '#e81123', '#ff8c00', '#ffd400', '#107c10',
        '#00b294', '#0078d4', '#0f6cbd', '#5c2d91', '#e3008c', '#8e562e', '#fde68a', '#bbf7d0', '#bfdbfe', '#fbcfe8'];
    PE.colorMenu = function (anchor, current, allowNone, cb) {
        var grid = PE.el('div');
        grid.style.cssText = 'display:grid;grid-template-columns:repeat(5,26px);gap:5px;padding:8px 8px 4px';
        PALETTE.forEach(function (c) {
            var b = PE.el('button');
            b.type = 'button';
            b.title = c;
            b.style.cssText = 'width:26px;height:26px;border-radius:5px;border:1px solid rgba(128,128,128,.45);background:' + c +
                (String(current).toLowerCase() === c ? ';box-shadow:0 0 0 2px var(--accent)' : '');
            b.addEventListener('click', function () {
                PE.closeMenus();
                cb(c);
            });
            grid.appendChild(b);
        });
        var items = [{ el: grid }, { sep: true }];
        if (allowNone) {
            items.push({ label: PE.T('color/none', 'No colour'), icon: 'close', checked: !current, onClick: function () { cb(null); } });
        }
        items.push({
            label: PE.T('color/more', 'More colours...'), icon: 'plus', onClick: function () {
                var inp = document.createElement('input');
                inp.type = 'color';
                inp.value = current || '#000000';
                inp.style.cssText = 'position:fixed;left:-100px;top:0;opacity:0';
                document.body.appendChild(inp);
                inp.addEventListener('input', function () { cb(inp.value, true); });
                inp.addEventListener('change', function () {
                    cb(inp.value);
                    document.body.removeChild(inp);
                });
                inp.click();
            }
        });
        PE.menu(anchor, items, { minWidth: 170 });
    };

    PE.swatch = function (color) {
        return '<span class="pe-swatch"><i style="background:' + (color || 'transparent') + '"></i></span>';
    };
})(window.PE);
