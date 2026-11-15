/*
    3D Modeler - Fillet and Chamfer

    Both features are "pick edges, give one size", so they share this file:
    createEdgeFeature({ kind: "fillet" | "chamfer", ... }).

    Edges are picked in the model (click toggles). The kernel carries a
    fillet or chamfer on along edges that continue the picked one smoothly,
    so the pick highlights that whole tangent chain (kernel edgeChains) and
    a click anywhere on a picked chain drops it. An edge is remembered by
    the point halfway along it and its length (see findEdges in
    kernel/occt.js). While a feature is edited the app shows the model as it
    was before that feature, so the original edges can be seen and re-picked.

    Every change is built by the kernel on a copy: the result is shown as a
    live preview, the new rounded or bevelled faces in green (the real body
    fades to a ghost that can still be picked), or the panel says why it
    cannot be built.

    PROPOSAL.md 14.7, 14.26: a Chamfer is Equal Distance, Two Distances or
    Distance and Angle (Flip swaps the faces the sizes are measured on; the
    card beside the panel shows each). A Fillet holds one or more sets of
    edges, each with its own radius, listed one under the other: a set's
    edge button makes it the set that clicked edges go to (on that set it
    clears them), its box is the radius, the cross removes it; Add Set puts
    a new one at the bottom.

    options: stage, viewport, kernel, doc, onStatus(text), onClose(committed)
*/

import { createPanel } from './panel.js';
import { evaluate } from '../expr.js';
import { icon, wheelStep } from '../ui.js';

const KINDS = {
    fillet: { title: 'Fillet', size: 'radius', label: 'Radius', start: 3, name: 'fillet' },
    chamfer: { title: 'Chamfer', size: 'distance', label: 'Distance', start: 3, name: 'chamfer' }
};

// The size of the last fillet and chamfer made or edited, for the next new
// one while the app stays open (and the chamfer's mode, second size, angle)
const lastSize = {};
let lastChamfer = null;

export function createEdgeFeature(options) {
    const kind = KINDS[options.kind];
    const viewport = options.viewport;
    const doc = options.doc;
    let open = false;
    let editId = null;
    let valid = false;
    let token = 0;
    let timer = null;
    let session = 0;    // one per opening of the panel

    const chamfer = options.kind === 'chamfer';
    // Fillet: [{ edges, radius, text }]. The edges of the active set are the
    // viewport's selection (kept in `edges` when another set is chosen).
    let sets = [];
    let activeSet = 0;
    const rows = [{ type: 'section', label: 'Input Geometry' }];
    if (chamfer) {
        rows.push({ type: 'seg', key: 'mode', label: 'Type', illustrate: 'chamfer', columns: 1, items: [
            { id: 'equal', label: 'Equal Distance', title: 'The same distance on both faces' },
            { id: 'two', label: 'Two Distances', title: 'A distance on each face' },
            { id: 'angle', label: 'Distance and Angle', title: 'A distance on one face and the angle of the bevel to it' }
        ] });
        rows.push({ type: 'pick', key: 'edges', label: 'Edges', title: 'Click to clear the edges' });
        rows.push({ type: 'section', label: 'Behavior' });
        rows.push({ type: 'number', key: 'size', label: kind.label });
        rows.push({ type: 'number', key: 'size2', label: 'Distance 2' });
        rows.push({ type: 'number', key: 'angle', label: 'Angle', unit: 'deg', max: 89.9, step: 5 });
        rows.push({ type: 'check', key: 'flip', label: 'Flip faces' });
    } else {
        rows.push({ type: 'custom', key: 'sets' });
    }

    const panel = createPanel(options.stage, {
        title: kind.title,
        rows: rows,
        onChange: function () {
            refresh();
        },
        onAction: function () {
            viewport.clearSelection();
        },
        onOk: commit,
        onCancel: function () {
            close(false);
        }
    });

    function refs() {
        return viewport.selection().filter(function (item) {
            return item.kind === 'edge';
        }).map(function (item) {
            return { body: item.body, mid: item.mid, length: item.length };
        });
    }

    // Every fillet set with its edges as they are now (the active one from the
    // viewport); sets without edges are left out
    function filledSets() {
        return sets.map(function (set, i) {
            return { edges: i === activeSet ? refs() : set.edges, radius: set.radius };
        }).filter(function (set) {
            return set.edges.length;
        });
    }

    function draft() {
        if (!chamfer) {
            const all = filledSets();
            // One set is stored the old way (edges + radius)
            return all.length > 1 ? { type: 'fillet', sets: all }
                : { type: 'fillet', edges: all.length ? all[0].edges : [], radius: all.length ? all[0].radius : sets[activeSet].radius };
        }
        const feature = { type: options.kind, edges: refs() };
        feature[kind.size] = panel.get('size');
        if (chamfer) {
            const mode = panel.get('mode');
            if (mode !== 'equal') {
                feature.mode = mode;
                feature.flip = !!panel.get('flip');
                if (mode === 'two') {
                    feature.distance2 = panel.get('size2');
                } else {
                    feature.angle = panel.get('angle');
                }
            }
        }
        return feature;
    }

    /* ---- fillet: the list of sets ---- */
    // What a set's edge button says: the active set counts the tangent
    // chains the viewport highlights
    function activeText() {
        const n = refs().length;
        const covered = viewport.coveredEdges();
        if (!n) {
            return 'Pick edges';
        }
        return covered > n ? covered + ' edges, ' + n + (n === 1 ? ' chain' : ' chains') : n + (n === 1 ? ' edge' : ' edges');
    }

    function renderSets() {
        const box = panel.container('sets');
        box.innerHTML = '';
        const head = document.createElement('div');
        head.className = 'fillet-sets-head';
        head.innerHTML = '<span>Edges</span><span>Radius</span>';
        box.appendChild(head);
        sets.forEach(function (set, i) {
            const line = document.createElement('div');
            line.className = 'fillet-set';
            const pick = document.createElement('button');
            pick.type = 'button';
            pick.className = 'props-pick';
            pick.addEventListener('click', function () {
                if (i === activeSet) {
                    viewport.clearSelection();
                } else {
                    switchSet(i);
                }
            });
            const input = document.createElement('input');
            input.className = 'props-input fillet-radius';
            input.autocomplete = 'off';
            input.spellcheck = false;
            input.title = 'Radius of this set (a formula such as 5/2 works too)';
            input.value = String(+Number(set.radius).toFixed(3));
            wheelStep(input, { min: 0, above: true });
            input.addEventListener('focus', function () {
                switchSet(i); // its edges are the ones shown
            });
            input.addEventListener('input', function () {
                const v = evaluate(input.value);
                set.radius = v > 0 ? v : 0;
                input.classList.toggle('bad', !(v > 0));
                refresh();
            });
            input.addEventListener('blur', function () {
                if (set.radius > 0) {
                    input.value = String(+set.radius.toFixed(3));
                }
            });
            const unit = document.createElement('span');
            unit.className = 'props-unit fillet-unit';
            unit.textContent = 'mm';
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'fillet-remove';
            remove.title = 'Remove this set';
            remove.innerHTML = icon('close');
            remove.style.visibility = sets.length > 1 ? '' : 'hidden';
            remove.addEventListener('click', function () {
                removeSet(i);
            });
            line.appendChild(pick);
            line.appendChild(input);
            line.appendChild(unit);
            line.appendChild(remove);
            box.appendChild(line);
        });
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'props-pick fillet-add';
        add.textContent = '+ Add Set';
        add.title = 'Another set of edges with a radius of its own';
        add.addEventListener('click', addSet);
        box.appendChild(add);
        paintSets();
    }

    // Which set is active, and what each edge button says
    function paintSets() {
        const box = panel.container('sets');
        box.querySelectorAll('.fillet-set').forEach(function (line, i) {
            const set = sets[i];
            if (!set) {
                return; // a line about to be redrawn
            }
            const active = i === activeSet;
            const pick = line.querySelector('.props-pick');
            const text = active ? activeText() : set.text || (set.edges.length ? set.edges.length + (set.edges.length === 1 ? ' edge' : ' edges') : 'No edges');
            line.classList.toggle('active', active);
            pick.textContent = text;
            pick.classList.toggle('empty', active && !refs().length);
            pick.classList.toggle('none', !active && !set.edges.length);
            pick.title = active ? (refs().length ? text + ': click to clear them' : 'Click the edges of this set in the model')
                : text + ': click to show and pick the edges of this set';
        });
    }

    // The set clicked edges go to
    function switchSet(i) {
        if (i === activeSet || !sets[i]) {
            return;
        }
        sets[activeSet].edges = refs();
        sets[activeSet].text = sets[activeSet].edges.length ? activeText() : '';
        activeSet = i;
        viewport.selectEdges(sets[activeSet].edges);
        paintSets();
        refresh();
    }

    // A new, empty set at the bottom, taking the radius of the set before it
    function addSet() {
        sets[activeSet].edges = refs();
        sets[activeSet].text = sets[activeSet].edges.length ? activeText() : '';
        sets.push({ edges: [], radius: sets[sets.length - 1].radius, text: '' });
        activeSet = sets.length - 1;
        // Draw the list first: changing the selection repaints it
        renderSets();
        viewport.clearSelection();
        refresh();
    }

    function removeSet(i) {
        if (sets.length < 2) {
            return;
        }
        sets[activeSet].edges = refs();
        sets.splice(i, 1);
        if (i < activeSet || activeSet >= sets.length) {
            activeSet = Math.max(0, activeSet - 1);
        }
        renderSets();
        viewport.selectEdges(sets[activeSet].edges);
        refresh();
    }

    function focusRadius() {
        const input = panel.container('sets').querySelectorAll('.fillet-radius')[activeSet];
        if (input) {
            input.focus();
            input.select();
        }
    }

    function refresh() {
        if (!chamfer) {
            refreshFillet();
            return;
        }
        const edges = refs();
        const covered = viewport.coveredEdges();
        if (chamfer) {
            const mode = panel.get('mode');
            panel.visible('size2', mode === 'two');
            panel.visible('angle', mode === 'angle');
            panel.visible('flip', mode !== 'equal');
            panel.label('size', mode === 'two' ? 'Distance 1' : 'Distance');
        }
        panel.text('edges', !edges.length ? 'Pick edges in the model'
            : covered > edges.length ? covered + ' edges in ' + edges.length + (edges.length === 1 ? ' tangent chain' : ' tangent chains')
                : edges.length + (edges.length === 1 ? ' edge' : ' edges'), !edges.length);
        clearTimeout(timer);
        const mine = ++token;
        valid = false;
        panel.ok(false);
        if (!edges.length) {
            viewport.setPreview(null);
            panel.note('Click the edges to ' + kind.name + '. Click one again to drop it.');
            return;
        }
        if (!(panel.get('size') > 0)) {
            viewport.setPreview(null);
            panel.note('Enter a ' + kind.label.toLowerCase() + ' larger than zero. A formula such as 5/2 works too.', true);
            return;
        }
        if (chamfer && panel.get('mode') === 'two' && !(panel.get('size2') > 0)) {
            viewport.setPreview(null);
            panel.note('Enter a second distance larger than zero.', true);
            return;
        }
        if (chamfer && panel.get('mode') === 'angle' && !(panel.get('angle') > 0 && panel.get('angle') < 90)) {
            viewport.setPreview(null);
            panel.note('Enter an angle between 0 and 90 degrees.', true);
            return;
        }
        timer = setTimeout(function () {
            options.kernel.call('tryFeature', { document: doc.data(), feature: draft(), at: editId }).then(function (out) {
                if (mine === token && open) {
                    viewport.setPreview(out.meshes, 'result');
                    valid = true;
                    panel.ok(true);
                    panel.note('');
                }
            }).catch(function (err) {
                if (mine === token && open) {
                    viewport.setPreview(null);
                    panel.note(err.message, true);
                }
            });
        }, 60);
    }

    function refreshFillet() {
        paintSets();
        const all = filledSets();
        clearTimeout(timer);
        const mine = ++token;
        valid = false;
        panel.ok(false);
        if (!all.length) {
            viewport.setPreview(null);
            panel.note('Click the edges to fillet. Click one again to drop it.');
            return;
        }
        if (all.some(function (set) {
            return !(set.radius > 0);
        })) {
            viewport.setPreview(null);
            panel.note('Enter a radius larger than zero for every set. A formula such as 5/2 works too.', true);
            return;
        }
        timer = setTimeout(function () {
            options.kernel.call('tryFeature', { document: doc.data(), feature: draft(), at: editId }).then(function (out) {
                if (mine === token && open) {
                    viewport.setPreview(out.meshes, 'result');
                    valid = true;
                    panel.ok(true);
                    panel.note(sets.length > 1 ? 'Edges you click go to the highlighted set. Click another set to switch to it.' : '');
                }
            }).catch(function (err) {
                if (mine === token && open) {
                    viewport.setPreview(null);
                    panel.note(err.message, true);
                }
            });
        }, 60);
    }

    function close(committed) {
        if (!open) {
            return;
        }
        open = false;
        token++;
        session++;
        clearTimeout(timer);
        panel.hide();
        viewport.setPreview(null);
        viewport.onSelection = null;
        viewport.setPickFilter(null);
        viewport.clearSelection();
        options.onClose(committed);
    }

    function commit() {
        if (!open || !valid) {
            return;
        }
        const made = draft();
        const editing = editId;
        lastSize[options.kind] = chamfer ? panel.get('size') : sets[activeSet].radius || sets[0].radius;
        if (chamfer) {
            lastChamfer = { mode: panel.get('mode'), size2: panel.get('size2'), angle: panel.get('angle'), flip: !!panel.get('flip') };
        }
        close(true);
        // Each edge also gets a description, so it is found again when an
        // earlier feature moves it (findEdges in kernel/occt.js)
        const groups = made.sets ? made.sets.map(function (s) {
            return s.edges;
        }) : [made.edges];
        options.kernel.call('edgeRefs', { document: doc.data(), at: editing, edges: [].concat.apply([], groups) }).then(function (out) {
            let at = 0;
            groups.forEach(function (g, i) {
                const described = out.refs.slice(at, at + g.length);
                at += g.length;
                if (made.sets) {
                    made.sets[i].edges = described;
                } else {
                    made.edges = described;
                }
            });
        }).catch(function () {
            // Stored by position only
        }).then(function () {
            store(made, editing);
        });
    }

    function store(made, editing) {
        if (editing) {
            const old = doc.feature(editing);
            doc.change('Edit ' + old.name, function () {
                ['edges', 'sets', kind.size, 'mode', 'distance2', 'angle', 'flip'].forEach(function (key) {
                    delete old[key];
                });
                Object.keys(made).forEach(function (key) {
                    if (key !== 'type') {
                        old[key] = made[key];
                    }
                });
            });
        } else {
            made.id = doc.newId();
            made.name = doc.newName(options.kind);
            const ordered = Object.assign({ id: made.id, type: options.kind, name: made.name }, made);
            ordered.type = options.kind;
            doc.change(made.name, function (d) {
                d.features.push(ordered);
            });
        }
    }

    // Start a new feature (featureId null; `preselected` are the model items
    // selected when the button was clicked) or edit an existing one.
    function start(featureId, preselected) {
        close(false);
        const editing = featureId ? doc.feature(featureId) : null;
        if (!viewport.bodyCount()) {
            options.onStatus(kind.title + ' needs a solid: extrude a sketch first');
            return Promise.resolve(false);
        }
        editId = editing ? editing.id : null;
        open = true;
        panel.title(editing ? editing.name : kind.title);
        if (chamfer) {
            panel.set('size', editing ? Number(editing[kind.size]) || kind.start : lastSize[options.kind] || kind.start);
            const was = editing || lastChamfer || {};
            panel.set('mode', editing ? editing.mode || 'equal' : was.mode || 'equal');
            panel.set('size2', Number(editing ? editing.distance2 : was.size2) || kind.start);
            panel.set('angle', Number(was.angle) || 45);
            panel.set('flip', !!was.flip);
        } else {
            sets = editing && editing.sets && editing.sets.length ? editing.sets.map(function (s) {
                return { edges: s.edges || [], radius: Number(s.radius) || kind.start, text: '' };
            }) : [{ edges: editing ? editing.edges || [] : [], radius: editing ? Number(editing.radius) || kind.start : lastSize[options.kind] || kind.start, text: '' }];
            activeSet = 0;
            renderSets();
        }
        viewport.setPickFilter({ edges: true, toggle: true });
        viewport.onSelection = refresh;
        // Which edges run on from which, as the kernel will follow them
        const asked = ++session;
        options.kernel.call('edgeChains', { document: doc.data(), at: editId }).then(function (out) {
            if (open && asked === session) {
                viewport.setEdgeChains(out.chains);
                refresh();
            }
        }).catch(function () {
            // Without chains every edge is highlighted on its own
        });
        if (editing) {
            // Where the edges are now: an edit upstream may have moved them
            const wanted = chamfer ? editing.edges || [] : sets[0].edges;
            // The other sets are found where they are now as well
            if (!chamfer && sets.length > 1) {
                sets.slice(1).forEach(function (set) {
                    options.kernel.call('edgeRefs', { document: doc.data(), at: editId, edges: set.edges, resolve: true }).then(function (out) {
                        set.edges = out.refs.filter(Boolean);
                    }).catch(function () {
                        // kept as stored
                    });
                });
            }
            options.kernel.call('edgeRefs', { document: doc.data(), at: editId, edges: wanted, resolve: true }).then(function (out) {
                if (!open || asked !== session) {
                    return;
                }
                const now = out.refs.filter(Boolean);
                const missing = wanted.length - viewport.selectEdges(now);
                refresh();
                if (missing > 0) {
                    panel.note(missing + (missing === 1 ? ' edge' : ' edges') + ' of this feature no longer exist' + (missing === 1 ? 's' : '') + '. Pick again, then OK.', true);
                }
            }).catch(function () {
                viewport.selectEdges(editing.edges || []);
                refresh();
            });
        } else {
            viewport.selectEdges((preselected || []).filter(function (item) {
                return item.kind === 'edge';
            }));
        }
        panel.show();
        refresh();
        if (chamfer) {
            panel.focus('size');
        } else {
            focusRadius();
        }
        return Promise.resolve(true);
    }

    return {
        start: start,
        isOpen: function () {
            return open;
        },
        cancel: function () {
            close(false);
        },
        handleKey: function (event) {
            if (!open) {
                return false;
            }
            if (event.key === 'Enter') {
                commit();
                return true;
            }
            if (event.key === 'Escape') {
                close(false);
                return true;
            }
            return false;
        }
    };
}
