/*
    3D Modeler - assembly browser

    The tree at the left while an assembly is open: the assembly, its
    origin (planes to constrain to), then every component in the order it
    was placed, each with the constraints that hold it. A grounded component
    shows a pin; with Degrees of Freedom on, the number of ways it can still
    move. A constraint that does not hold, or a part that could not be
    loaded, is marked.

    render(state) redraws from:
        { name, components, constraints, partStatus: { partId: { status, message } },
          dof: { id: n }, errors: { constraintId: size }, selected: [componentIds],
          showDof }

    handlers:
        onSelect(componentIds)                  click (Ctrl / Shift adds)
        onConstraintSelect(id)
        onComponentAction(action, id, value)    "transform", "ground",
            "unground", "hide", "show", "isolate", "openpart", "rename"
            (value: the new name), "delete"
        onConstraintAction(action, id, value)   "edit", "suppress",
            "unsuppress", "rename", "delete"
        onOriginHover(key | null), onOriginClick(key)
        onHover(componentIds | null)            rows under the pointer, to
                                                light them up in the view
*/

import { icon, openMenu } from '../ui.js';

const CONSTRAINT_ICONS = { mate: 'mate', angle: 'angle', tangent: 'tangent', insert: 'insert' };
const ORIGIN = [
    { key: 'yz', label: 'YZ Plane', icon: 'plane' },
    { key: 'xz', label: 'XZ Plane', icon: 'plane' },
    { key: 'xy', label: 'XY Plane', icon: 'plane' },
    { key: 'x', label: 'X Axis', icon: 'axis' },
    { key: 'y', label: 'Y Axis', icon: 'axis' },
    { key: 'z', label: 'Z Axis', icon: 'axis' },
    { key: 'o', label: 'Center Point', icon: 'point' }
];

function valueText(c) {
    if (c.type === 'angle') {
        return (+c.angle || 0).toFixed(1) + ' deg';
    }
    return c.offset ? (+c.offset).toFixed(2) + ' mm' : '';
}

export function createAssemblyBrowser(el, handlers) {
    const expanded = { root: true, origin: false };
    let state = null;
    let renaming = null;    // { kind: "component" | "constraint", id }
    let selectedConstraint = null;

    function row(parent, depth, iconName, label, opts) {
        opts = opts || {};
        const node = document.createElement('div');
        node.className = 'node' + (opts.cls ? ' ' + opts.cls : '');
        node.style.paddingLeft = 6 + depth * 14 + 'px';
        node.innerHTML = icon('caret', 'twist' + (opts.group ? '' : ' leaf')) + (opts.swatch ? '<span class="swatch"></span>' : '') + icon(iconName);
        if (opts.swatch) {
            node.querySelector('.swatch').style.background = opts.swatch;
        }
        const text = document.createElement('span');
        text.className = 'node-label';
        text.textContent = label;
        node.appendChild(text);
        parent.appendChild(node);
        if (!opts.group) {
            return { node: node, children: null };
        }
        const twist = node.querySelector('.twist');
        twist.classList.toggle('open', !!expanded[opts.group]);
        twist.addEventListener('click', function (event) {
            event.stopPropagation();
            expanded[opts.group] = !expanded[opts.group];
            render(state);
        });
        const children = document.createElement('div');
        children.className = 'children' + (expanded[opts.group] ? ' open' : '');
        parent.appendChild(children);
        return { node: node, children: children };
    }

    function tail(node, html, title) {
        const t = document.createElement('span');
        t.className = 'node-tail';
        t.innerHTML = html;
        if (title) {
            t.title = title;
        }
        node.appendChild(t);
        return t;
    }

    function renameField(node, current, done) {
        const label = node.querySelector('.node-label');
        const input = document.createElement('input');
        input.className = 'node-rename';
        input.value = current;
        input.maxLength = 80;
        label.replaceWith(input);
        let finished = false;
        const finish = function (commit) {
            if (finished) {
                return;
            }
            finished = true;
            renaming = null;
            const value = input.value.trim();
            if (commit && value && value !== current) {
                done(value);
            } else {
                render(state);
            }
        };
        input.addEventListener('keydown', function (event) {
            event.stopPropagation();
            if (event.key === 'Enter') {
                finish(true);
            } else if (event.key === 'Escape') {
                finish(false);
            }
        });
        input.addEventListener('blur', function () {
            finish(true);
        });
        setTimeout(function () {
            input.focus();
            input.select();
        }, 0);
    }

    function componentMenu(comp) {
        const status = (state.partStatus || {})[comp.part] || {};
        const entries = [];
        if (status.status === 'error' && status.link) {
            entries.push({ id: 'relink', label: 'Relink Part...' });
        }
        entries.push(
            { id: 'transform', label: 'Move Rotate Scale' },
            comp.grounded ? { id: 'unground', label: 'Unground' } : { id: 'ground', label: 'Ground' },
            comp.hidden ? { id: 'show', label: 'Show' } : { id: 'hide', label: 'Hide' },
            { id: 'isolate', label: 'Isolate' },
            { id: 'openpart', label: 'Open Part' },
            { id: 'rename', label: 'Rename', hint: 'F2' },
            { id: 'delete', label: 'Delete', hint: 'Del' }
        );
        return entries;
    }

    function constraintMenu(c) {
        return [
            { id: 'edit', label: 'Edit' },
            c.suppressed ? { id: 'unsuppress', label: 'Unsuppress' } : { id: 'suppress', label: 'Suppress' },
            { id: 'rename', label: 'Rename', hint: 'F2' },
            { id: 'delete', label: 'Delete', hint: 'Del' }
        ];
    }

    function constraintRow(parent, depth, c) {
        const failed = state.errors && state.errors[c.id] !== undefined;
        const cls = (c.id === selectedConstraint ? 'selected ' : '') + (c.suppressed ? 'suppressed ' : '') + (failed ? 'failed' : '');
        const value = valueText(c);
        const made = row(parent, depth, CONSTRAINT_ICONS[c.type] || 'constrain', c.name + (value ? ' (' + value + ')' : ''), { cls: cls });
        const node = made.node;
        if (failed) {
            const mark = tail(node, icon('warn'), 'This constraint does not hold: it conflicts with others, or what it was put on has changed');
            mark.style.color = 'var(--bad)';
            node.title = mark.title;
        }
        node.addEventListener('click', function (event) {
            event.stopPropagation();
            selectedConstraint = c.id;
            handlers.onConstraintSelect(c.id);
            render(state);
        });
        node.addEventListener('dblclick', function () {
            handlers.onConstraintAction('edit', c.id);
        });
        node.addEventListener('mouseenter', function () {
            handlers.onHover([c.a && c.a.comp, c.b && c.b.comp].filter(Boolean));
        });
        node.addEventListener('mouseleave', function () {
            handlers.onHover(null);
        });
        node.addEventListener('contextmenu', function (event) {
            event.preventDefault();
            openMenu({ x: event.clientX, y: event.clientY }, constraintMenu(c), function (action) {
                if (action === 'rename') {
                    renaming = { kind: 'constraint', id: c.id };
                    render(state);
                } else {
                    handlers.onConstraintAction(action, c.id);
                }
            });
        });
        if (renaming && renaming.kind === 'constraint' && renaming.id === c.id) {
            renameField(node, c.name, function (value) {
                handlers.onConstraintAction('rename', c.id, value);
            });
        }
    }

    function componentRow(parent, comp) {
        const status = (state.partStatus || {})[comp.part] || {};
        const mine = state.constraints.filter(function (c) {
            return (c.a && c.a.comp === comp.id) || (c.b && c.b.comp === comp.id);
        });
        const selected = state.selected.indexOf(comp.id) >= 0;
        const cls = (selected ? 'selected ' : '') + (comp.hidden ? 'hidden-comp ' : '') + (status.status === 'error' ? 'missing' : '');
        const made = row(parent, 1, 'component', comp.name, { cls: cls, group: mine.length ? 'c:' + comp.id : null, swatch: comp.color || '#a9b4c2' });
        const node = made.node;
        node.dataset.component = comp.id;
        let html = '';
        let title = '';
        if (comp.grounded) {
            html += icon('ground', 'ic-ground');
            title = 'Grounded: it stays where it is';
        }
        if (state.showDof && !comp.grounded && state.dof && state.dof[comp.id] !== undefined) {
            html += '<span>' + state.dof[comp.id] + ' DOF</span>';
            title = state.dof[comp.id] === 0 ? 'Fully constrained' : state.dof[comp.id] + ' degrees of freedom left';
        }
        if (status.status === 'error') {
            html += icon('warn');
            title = status.message || 'The part could not be loaded';
        } else if (status.status === 'loading') {
            html += '<span>loading</span>';
        }
        if (html) {
            tail(node, html, title);
            node.title = title;
        }
        node.addEventListener('click', function (event) {
            selectedConstraint = null;
            const additive = event.ctrlKey || event.shiftKey || event.metaKey;
            let list;
            if (additive) {
                list = selected ? state.selected.filter(function (id) {
                    return id !== comp.id;
                }) : state.selected.concat([comp.id]);
            } else {
                list = [comp.id];
            }
            handlers.onSelect(list);
        });
        node.addEventListener('dblclick', function () {
            handlers.onComponentAction('transform', comp.id);
        });
        node.addEventListener('mouseenter', function () {
            handlers.onHover([comp.id]);
        });
        node.addEventListener('mouseleave', function () {
            handlers.onHover(null);
        });
        node.addEventListener('contextmenu', function (event) {
            event.preventDefault();
            if (!selected) {
                handlers.onSelect([comp.id]);
            }
            openMenu({ x: event.clientX, y: event.clientY }, componentMenu(comp), function (action) {
                if (action === 'rename') {
                    renaming = { kind: 'component', id: comp.id };
                    render(state);
                } else {
                    handlers.onComponentAction(action, comp.id);
                }
            });
        });
        if (renaming && renaming.kind === 'component' && renaming.id === comp.id) {
            renameField(node, comp.name, function (value) {
                handlers.onComponentAction('rename', comp.id, value);
            });
        }
        if (made.children) {
            mine.forEach(function (c) {
                constraintRow(made.children, 2, c);
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
        const root = row(el, 0, 'assembly', state.name, { group: 'root' });
        const origin = row(root.children, 1, 'folder', 'Origin', { group: 'origin' });
        ORIGIN.forEach(function (item) {
            const made = row(origin.children, 2, item.icon, item.label, { cls: '' });
            made.node.addEventListener('mouseenter', function () {
                handlers.onOriginHover(item.key);
            });
            made.node.addEventListener('mouseleave', function () {
                handlers.onOriginHover(null);
            });
            made.node.addEventListener('click', function () {
                handlers.onOriginClick(item.key);
            });
        });
        if (!state.components.length) {
            const hint = row(root.children, 1, 'place', 'Place a part to start', { cls: 'hint' });
            hint.node.addEventListener('click', function () {
                handlers.onComponentAction('place', null);
            });
        }
        state.components.forEach(function (comp) {
            componentRow(root.children, comp);
        });
        el.scrollTop = scroll;
    }

    return {
        render: render,
        startRename: function (kind, id) {
            renaming = { kind: kind, id: id };
            render(state);
        },
        selectedConstraint: function () {
            return selectedConstraint;
        },
        clearConstraint: function () {
            selectedConstraint = null;
        }
    };
}
