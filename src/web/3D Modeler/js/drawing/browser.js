/*
    3D Modeler - drawing browser

    The tree at the left while a drawing is open: the drawing, its sheet
    (size and scale; double click for Sheet Setup), the models it shows,
    and its views, each projected view under the view it comes from.

    render(state) redraws from:
        { name, sheetText, sources: [{ id, name, status, message }],
          views: [{ id, name, parent, text, status, message }],
          annotations: n, selected: [viewIds] }

    handlers:
        onSheet()                       double click on the sheet row
        onSelect(viewIds)
        onViewAction(action, id)        "edit", "projected", "delete"
        onSourceAction(action, id)      "refresh"
        onHover(viewId | null)
*/

import { icon, openMenu } from '../ui.js';

export function createDrawingBrowser(el, handlers) {
    const expanded = { root: true, sources: true, views: true };
    let state = null;

    function row(parent, depth, iconName, label, opts) {
        const o = opts || {};
        const node = document.createElement('div');
        node.className = 'node' + (o.cls ? ' ' + o.cls : '');
        node.style.paddingLeft = 6 + depth * 14 + 'px';
        node.innerHTML = icon('caret', 'twist' + (o.group ? '' : ' leaf')) + icon(iconName);
        const text = document.createElement('span');
        text.className = 'node-label';
        text.textContent = label;
        node.appendChild(text);
        if (o.tail) {
            const t = document.createElement('span');
            t.className = 'node-tail';
            t.innerHTML = o.tail;
            node.appendChild(t);
        }
        if (o.title) {
            node.title = o.title;
        }
        parent.appendChild(node);
        if (!o.group) {
            return { node: node, children: null };
        }
        const twist = node.querySelector('.twist');
        twist.classList.toggle('open', !!expanded[o.group]);
        twist.addEventListener('click', function (event) {
            event.stopPropagation();
            expanded[o.group] = !expanded[o.group];
            render(state);
        });
        const children = document.createElement('div');
        children.className = 'children' + (expanded[o.group] ? ' open' : '');
        parent.appendChild(children);
        return { node: node, children: children };
    }

    function statusTail(item) {
        if (item.status === 'error') {
            return { tail: '<span class="tail-bad">' + icon('warn') + '</span>', title: item.message || 'It cannot be drawn' };
        }
        if (item.status === 'loading') {
            return { tail: '<span>loading</span>', title: 'Loading' };
        }
        return { tail: '', title: '' };
    }

    function viewRow(parent, depth, view) {
        const kids = state.views.filter(function (v) {
            return v.parent === view.id;
        });
        const st = statusTail(view);
        const selected = state.selected.indexOf(view.id) >= 0;
        const made = row(parent, depth, view.parent ? 'projectedview' : 'baseview', view.name + (view.text ? '  ' + view.text : ''), {
            cls: selected ? 'selected' : '', group: kids.length ? 'v:' + view.id : null, tail: st.tail, title: st.title
        });
        if (kids.length && expanded['v:' + view.id] === undefined) {
            expanded['v:' + view.id] = true;
            made.node.querySelector('.twist').classList.add('open');
            made.children.classList.add('open');
        }
        made.node.addEventListener('click', function (event) {
            const additive = event.ctrlKey || event.shiftKey || event.metaKey;
            handlers.onSelect(additive ? (selected ? state.selected.filter(function (id) {
                return id !== view.id;
            }) : state.selected.concat([view.id])) : [view.id]);
        });
        made.node.addEventListener('dblclick', function () {
            handlers.onViewAction('edit', view.id);
        });
        made.node.addEventListener('mouseenter', function () {
            handlers.onHover(view.id);
        });
        made.node.addEventListener('mouseleave', function () {
            handlers.onHover(null);
        });
        made.node.addEventListener('contextmenu', function (event) {
            event.preventDefault();
            if (!selected) {
                handlers.onSelect([view.id]);
            }
            openMenu({ x: event.clientX, y: event.clientY }, [
                { id: 'edit', label: 'Edit View' },
                { id: 'projected', label: 'Projected View' },
                { id: 'delete', label: 'Delete', hint: 'Del' }
            ], function (action) {
                handlers.onViewAction(action, view.id);
            });
        });
        if (made.children) {
            kids.forEach(function (k) {
                viewRow(made.children, depth + 1, k);
            });
        }
    }

    function render(next) {
        if (next) {
            state = next;
        }
        if (!state) {
            return;
        }
        const scroll = el.scrollTop;
        el.innerHTML = '';
        const root = row(el, 0, 'drawing', state.name, { group: 'root' });
        const sheet = row(root.children, 1, 'sheet', state.sheetText, { title: 'Double click for Sheet Setup' });
        sheet.node.addEventListener('dblclick', function () {
            handlers.onSheet();
        });
        if (state.sources.length) {
            const models = row(root.children, 1, 'folder', 'Models', { group: 'sources' });
            state.sources.forEach(function (src) {
                const st = statusTail(src);
                const made = row(models.children, 2, src.kind === 'assembly' ? 'assembly' : 'part', src.name, { tail: st.tail, title: st.title || src.path || 'Kept inside the drawing' });
                made.node.addEventListener('contextmenu', function (event) {
                    event.preventDefault();
                    openMenu({ x: event.clientX, y: event.clientY }, (src.status === 'error' ? [{ id: 'relink', label: 'Relink Model...' }] : []).concat([{ id: 'refresh', label: 'Refresh' }]), function (action) {
                        handlers.onSourceAction(action, src.id);
                    });
                });
            });
        }
        state.views.filter(function (v) {
            return !v.parent;
        }).forEach(function (v) {
            viewRow(root.children, 1, v);
        });
        if (!state.views.length) {
            const hint = row(root.children, 1, 'baseview', 'Place a Base View to start', { cls: 'hint' });
            hint.node.addEventListener('click', function () {
                handlers.onViewAction('base', null);
            });
        }
        if (state.annotations) {
            row(root.children, 1, 'dimension', state.annotations + (state.annotations === 1 ? ' annotation' : ' annotations'), { cls: 'muted-row' });
        }
        el.scrollTop = scroll;
    }

    return { render: render };
}
