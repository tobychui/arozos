/*
    Gerber Viewer - UI toolkit

    Desktop style menu bar with dropdowns, submenus, context menus and
    keyboard navigation, plus dialogs, toasts and popovers.

    Menu item:
        { label, icon, key, action(), enabled: bool|fn, checked: bool|fn,
          submenu: items|fn, sep: true, header: 'text' }
*/
(function (GV) {
    'use strict';

    function icon(id, cls) {
        return '<svg' + (cls ? ' class="' + cls + '"' : '') + '><use href="#ic-' + id + '"/></svg>';
    }

    function esc(s) {
        return String(s === undefined || s === null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function h(tag, attrs, html) {
        var e = document.createElement(tag);
        if (attrs) {
            for (var k in attrs) {
                if (k === 'class') {
                    e.className = attrs[k];
                } else if (k === 'style') {
                    e.setAttribute('style', attrs[k]);
                } else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') {
                    e.addEventListener(k.slice(2), attrs[k]);
                } else if (attrs[k] !== undefined && attrs[k] !== null && attrs[k] !== false) {
                    e.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
                }
            }
        }
        if (html !== undefined) {
            e.innerHTML = html;
        }
        return e;
    }

    function val(v) {
        return typeof v === 'function' ? v() : v;
    }

    /*
        Localised string from locale/gerberviewer.json (loaded by app.js through
        script/applocale.js), falling back to the English text. {name}
        placeholders are filled from vars.
    */
    function t(key, fallback, vars) {
        var s = fallback;
        if (typeof applocale !== 'undefined' && applocale && applocale.localData && applocale.localData.keys) {
            s = applocale.getString(key, fallback);
        }
        s = String(s === undefined || s === null ? '' : s);
        if (vars) {
            Object.keys(vars).forEach(function (k) {
                s = s.split('{' + k + '}').join(vars[k]);
            });
        }
        return s;
    }

    /* ------------------------------------------------------------------
        Menus
    ------------------------------------------------------------------ */
    var stack = [];         //open menu levels: {el, items, rows, focus}
    var bar = null;         //menubar state
    var onCloseAll = null;

    function closeFrom(level) {
        while (stack.length > level) {
            var m = stack.pop();
            m.el.remove();
        }
        if (level === 0) {
            if (bar) {
                bar.items.forEach(function (b) { b.classList.remove('open'); });
                bar.open = -1;
            }
            if (onCloseAll) {
                var f = onCloseAll;
                onCloseAll = null;
                f();
            }
        }
    }

    function closeMenus() {
        closeFrom(0);
    }

    function isOpen() {
        return stack.length > 0;
    }

    function enabled(it) {
        return it.enabled === undefined ? true : !!val(it.enabled);
    }

    function showMenu(items, x, y, opts) {
        opts = opts || {};
        var level = opts.level || 0;
        if (stack.length > level) {
            closeFrom(level);
        }
        items = val(items) || [];
        var menu = h('div', { class: 'menu', role: 'menu' });
        var rows = [];
        items.forEach(function (it) {
            if (!it) {
                return;
            }
            if (it.sep) {
                menu.appendChild(h('div', { class: 'menu-sep' }));
                return;
            }
            if (it.header) {
                menu.appendChild(h('div', { class: 'menu-header' }, esc(it.header)));
                return;
            }
            if (it.empty) {
                menu.appendChild(h('div', { class: 'menu-empty' }, esc(it.empty)));
                return;
            }
            var on = enabled(it);
            var checked = it.checked !== undefined ? !!val(it.checked) : false;
            var ic = checked ? icon('check') : (it.icon ? icon(it.icon) : '');
            if (it.swatch) {
                ic = '<span style="width:12px;height:12px;border-radius:3px;background:' + esc(it.swatch) + ';box-shadow:inset 0 0 0 1px rgba(0,0,0,.2)"></span>';
            }
            var row = h('button', { class: 'menu-item' + (on ? '' : ' disabled'), role: 'menuitem', tabindex: '-1' },
                '<span class="mi-icon">' + ic + '</span>' +
                '<span class="mi-label">' + esc(val(it.label)) + '</span>' +
                (it.key ? '<span class="mi-key">' + esc(it.key) + '</span>' : '') +
                (it.submenu ? '<span class="mi-sub">' + icon('chevron-right') + '</span>' : ''));
            if (it.title) {
                row.title = it.title;
            }
            row._item = it;
            row.addEventListener('mouseenter', function () {
                focusRow(level, rows.indexOf(row));
                if (it.submenu && on) {
                    openSub(level, row);
                } else {
                    closeFrom(level + 1);
                }
            });
            row.addEventListener('click', function (e) {
                e.stopPropagation();
                activate(level, row);
            });
            rows.push(row);
            menu.appendChild(row);
        });
        if (!rows.length && !menu.children.length) {
            menu.appendChild(h('div', { class: 'menu-empty' }, esc(t('menu/empty', 'Nothing here'))));
        }
        document.body.appendChild(menu);
        var r = menu.getBoundingClientRect();
        var vw = window.innerWidth, vh = window.innerHeight;
        if (x + r.width > vw - 4) {
            x = opts.flipX !== undefined ? opts.flipX - r.width : vw - r.width - 4;
        }
        if (y + r.height > vh - 4) {
            y = Math.max(4, vh - r.height - 4);
        }
        menu.style.left = Math.max(4, x) + 'px';
        menu.style.top = Math.max(4, y) + 'px';
        var entry = { el: menu, rows: rows, focus: -1 };
        stack.push(entry);
        if (opts.focusFirst) {
            focusRow(level, nextEnabled(rows, -1, 1));
        }
        return menu;
    }

    function nextEnabled(rows, from, dir) {
        for (var i = 1; i <= rows.length; i++) {
            var idx = (from + dir * i + rows.length * 2) % rows.length;
            if (enabled(rows[idx]._item)) {
                return idx;
            }
        }
        return -1;
    }

    function focusRow(level, idx) {
        var m = stack[level];
        if (!m) {
            return;
        }
        m.rows.forEach(function (r, i) { r.classList.toggle('focus', i === idx); });
        m.focus = idx;
        if (idx >= 0 && m.rows[idx]) {
            m.rows[idx].scrollIntoView({ block: 'nearest' });
        }
    }

    function openSub(level, row) {
        var r = row.getBoundingClientRect();
        showMenu(row._item.submenu, r.right - 2, r.top - 5, { level: level + 1, flipX: r.left + 2 });
    }

    function activate(level, row) {
        var it = row._item;
        if (!enabled(it)) {
            return;
        }
        if (it.submenu) {
            openSub(level, row);
            focusRow(level + 1, nextEnabled(stack[level + 1].rows, -1, 1));
            return;
        }
        closeMenus();
        if (it.action) {
            setTimeout(function () { it.action(); }, 0);
        }
    }

    function contextMenu(items, x, y, onClose) {
        closeMenus();
        onCloseAll = onClose || null;
        showMenu(items, x, y, { level: 0 });
    }

    //Keyboard handling while a menu is open. Returns true when consumed.
    function menuKey(e) {
        if (!stack.length) {
            return false;
        }
        var level = stack.length - 1;
        var m = stack[level];
        switch (e.key) {
            case 'Escape':
                if (level > 0) {
                    closeFrom(level);
                } else {
                    closeMenus();
                }
                return true;
            case 'ArrowDown':
                focusRow(level, nextEnabled(m.rows, m.focus, 1));
                return true;
            case 'ArrowUp':
                focusRow(level, nextEnabled(m.rows, m.focus < 0 ? 0 : m.focus, -1));
                return true;
            case 'ArrowRight':
                if (m.focus >= 0 && m.rows[m.focus]._item.submenu) {
                    activate(level, m.rows[m.focus]);
                } else if (bar && bar.open >= 0) {
                    openBar((bar.open + 1) % bar.items.length, true);
                }
                return true;
            case 'ArrowLeft':
                if (level > 0) {
                    closeFrom(level);
                } else if (bar && bar.open >= 0) {
                    openBar((bar.open - 1 + bar.items.length) % bar.items.length, true);
                }
                return true;
            case 'Enter':
            case ' ':
                if (m.focus >= 0) {
                    activate(level, m.rows[m.focus]);
                }
                return true;
            case 'Tab':
                closeMenus();
                return true;
        }
        return false;
    }

    function openBar(i, focusFirst) {
        var btn = bar.items[i];
        closeMenus();
        var r = btn.getBoundingClientRect();
        //showMenu clears level 0 (and with it bar.open), so mark the bar afterwards
        showMenu(bar.menus[i].items, r.left, r.bottom + 3, { level: 0, focusFirst: focusFirst });
        bar.items.forEach(function (b, j) { b.classList.toggle('open', j === i); });
        bar.open = i;
    }

    function menubar(root, menus) {
        root.innerHTML = '';
        bar = { menus: menus, items: [], open: -1 };
        menus.forEach(function (m, i) {
            var b = h('button', { class: 'mb-item', role: 'menuitem' }, esc(m.label));
            b.addEventListener('mousedown', function (e) {
                e.preventDefault();
                e.stopPropagation();
                if (bar.open === i) {
                    closeMenus();
                } else {
                    openBar(i, false);
                }
            });
            b.addEventListener('mouseenter', function () {
                if (bar.open >= 0 && bar.open !== i) {
                    openBar(i, false);
                }
            });
            bar.items.push(b);
            root.appendChild(b);
        });
        return {
            open: function (id) {
                for (var i = 0; i < menus.length; i++) {
                    if (menus[i].id === id) {
                        openBar(i, true);
                    }
                }
            }
        };
    }

    document.addEventListener('mousedown', function (e) {
        if (!stack.length) {
            return;
        }
        for (var i = 0; i < stack.length; i++) {
            if (stack[i].el.contains(e.target)) {
                return;
            }
        }
        if (bar && bar.items.some(function (b) { return b.contains(e.target); })) {
            return;
        }
        closeMenus();
    }, true);

    window.addEventListener('blur', function () {
        closeMenus();
    });
    window.addEventListener('resize', function () {
        closeMenus();
    });

    /* ------------------------------------------------------------------
        Dialogs
    ------------------------------------------------------------------ */
    var dialogs = [];

    function dialog(o) {
        var back = h('div', { class: 'modal-back' });
        var box = h('div', { class: 'modal', role: 'dialog', style: '--w:' + (o.width || 520) + 'px' });
        var head = h('div', { class: 'modal-h' }, (o.icon ? icon(o.icon) : '') + '<span>' + esc(o.title || '') + '</span>');
        var x = h('button', { class: 'iconbtn', title: t('common/close', 'Close') }, icon('close'));
        head.appendChild(x);
        var body = h('div', { class: 'modal-b' });
        if (typeof o.body === 'string') {
            body.innerHTML = o.body;
        } else if (o.body) {
            body.appendChild(o.body);
        }
        box.appendChild(head);
        box.appendChild(body);
        var foot = null;
        var api = { el: box, body: body, close: close, buttons: [] };
        if (o.buttons && o.buttons.length || o.footerLeft) {
            foot = h('div', { class: 'modal-f' });
            if (o.footerLeft) {
                var left = typeof o.footerLeft === 'string' ? h('div', { class: 'left' }, o.footerLeft) : o.footerLeft;
                left.classList.add('left');
                foot.appendChild(left);
            }
            (o.buttons || []).forEach(function (b) {
                var btn = h('button', { class: 'btn' + (b.primary ? ' primary' : '') + (b.cls ? ' ' + b.cls : '') },
                    (b.icon ? icon(b.icon) : '') + esc(b.label));
                btn.addEventListener('click', function () {
                    if (b.action) {
                        var r = b.action(api);
                        if (r === false) {
                            return;
                        }
                        if (r && typeof r.then === 'function') {
                            btn.disabled = true;
                            r.then(function (keep) {
                                btn.disabled = false;
                                if (keep !== false) {
                                    close();
                                }
                            }, function () {
                                btn.disabled = false;
                            });
                            return;
                        }
                    }
                    close();
                });
                if (b.primary) {
                    api.primary = btn;
                }
                api.buttons.push(btn);
                foot.appendChild(btn);
            });
            box.appendChild(foot);
        }
        back.appendChild(box);
        document.body.appendChild(back);
        closeMenus();
        var closed = false;
        function close() {
            if (closed) {
                return;
            }
            closed = true;
            back.remove();
            dialogs.splice(dialogs.indexOf(api), 1);
            if (o.onClose) {
                o.onClose();
            }
        }
        x.addEventListener('click', close);
        back.addEventListener('mousedown', function (e) {
            if (e.target === back && o.dismissable !== false) {
                close();
            }
        });
        dialogs.push(api);
        setTimeout(function () {
            var f = box.querySelector('[autofocus]') || box.querySelector('input,select') || api.primary;
            if (f) {
                f.focus();
            }
        }, 30);
        return api;
    }

    function dialogKey(e) {
        if (!dialogs.length) {
            return false;
        }
        var top = dialogs[dialogs.length - 1];
        if (e.key === 'Escape') {
            top.close();
            return true;
        }
        if (e.key === 'Enter' && top.primary && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') {
            top.primary.click();
            return true;
        }
        return true; //dialogs swallow other shortcuts
    }

    function hasDialog() {
        return dialogs.length > 0;
    }

    function confirm(title, text, ok) {
        return new Promise(function (resolve) {
            var done = false;
            dialog({
                title: title,
                icon: 'warning',
                width: 420,
                body: '<p style="margin:0">' + esc(text) + '</p>',
                buttons: [
                    { label: t('common/cancel', 'Cancel'), action: function () { done = true; resolve(false); } },
                    { label: ok || t('common/ok', 'OK'), primary: true, action: function () { done = true; resolve(true); } }
                ],
                onClose: function () {
                    if (!done) {
                        resolve(false);
                    }
                }
            });
        });
    }

    /* ------------------------------------------------------------------
        Toasts & popovers
    ------------------------------------------------------------------ */
    function toast(msg, o) {
        o = o || {};
        var root = document.getElementById('toasts');
        var t = h('div', { class: 'toast' + (o.type === 'error' ? ' error' : '') },
            (o.icon ? icon(o.icon) : (o.type === 'error' ? icon('warning') : '')) + '<span>' + esc(msg) + '</span>');
        var timer = null;
        function remove() {
            clearTimeout(timer);
            t.remove();
        }
        if (o.action) {
            var b = h('button', null, esc(o.action.label));
            b.addEventListener('click', function () {
                remove();
                o.action.fn();
            });
            t.appendChild(b);
        }
        root.appendChild(t);
        timer = setTimeout(remove, o.timeout || (o.action ? 9000 : 3200));
        return remove;
    }

    var pop = null;
    function popover(anchor, content, o) {
        closePopover();
        o = o || {};
        var p = h('div', { class: 'popover' });
        if (typeof content === 'string') {
            p.innerHTML = content;
        } else {
            p.appendChild(content);
        }
        document.body.appendChild(p);
        var r = anchor.getBoundingClientRect();
        var pr = p.getBoundingClientRect();
        var x = r.left, y = r.bottom + 6;
        if (x + pr.width > window.innerWidth - 8) {
            x = window.innerWidth - pr.width - 8;
        }
        if (y + pr.height > window.innerHeight - 8) {
            y = Math.max(8, r.top - pr.height - 6);
        }
        p.style.left = Math.max(8, x) + 'px';
        p.style.top = y + 'px';
        pop = { el: p, onClose: o.onClose, anchor: anchor };
        return p;
    }

    function closePopover() {
        if (pop) {
            var f = pop.onClose;
            pop.el.remove();
            pop = null;
            if (f) {
                f();
            }
        }
    }

    document.addEventListener('mousedown', function (e) {
        if (pop && !pop.el.contains(e.target) && !pop.anchor.contains(e.target)) {
            closePopover();
        }
    }, true);

    GV.ui = {
        t: t,
        icon: icon,
        esc: esc,
        h: h,
        menubar: menubar,
        showMenu: showMenu,
        contextMenu: contextMenu,
        closeMenus: closeMenus,
        isMenuOpen: isOpen,
        menuKey: menuKey,
        dialog: dialog,
        dialogKey: dialogKey,
        hasDialog: hasDialog,
        confirm: confirm,
        toast: toast,
        popover: popover,
        closePopover: closePopover,
        hasPopover: function () { return !!pop; }
    };
})(window.GV = window.GV || {});
