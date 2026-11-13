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

    options: stage, viewport, kernel, doc, onStatus(text), onClose(committed)
*/

import { createPanel } from './panel.js';

const KINDS = {
    fillet: { title: 'Fillet', size: 'radius', label: 'Radius', start: 2, name: 'fillet' },
    chamfer: { title: 'Chamfer', size: 'distance', label: 'Distance', start: 1, name: 'chamfer' }
};

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

    const panel = createPanel(options.stage, {
        title: kind.title,
        rows: [
            { type: 'section', label: 'Input Geometry' },
            { type: 'pick', key: 'edges', label: 'Edges', title: 'Click to clear the selection' },
            { type: 'section', label: 'Behavior' },
            { type: 'number', key: 'size', label: kind.label }
        ],
        onChange: refresh,
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

    function draft() {
        const feature = { type: options.kind, edges: refs() };
        feature[kind.size] = panel.get('size');
        return feature;
    }

    function refresh() {
        const edges = refs();
        const covered = viewport.coveredEdges();
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
        close(true);
        // Each edge also gets a description, so it is found again when an
        // earlier feature moves it (findEdges in kernel/occt.js)
        options.kernel.call('edgeRefs', { document: doc.data(), at: editing, edges: made.edges }).then(function (out) {
            made.edges = out.refs;
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
                old.edges = made.edges;
                old[kind.size] = made[kind.size];
            });
        } else {
            made.id = doc.newId();
            made.name = doc.newName(options.kind);
            const ordered = { id: made.id, type: options.kind, name: made.name, edges: made.edges };
            ordered[kind.size] = made[kind.size];
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
        panel.set('size', editing ? Number(editing[kind.size]) || kind.start : kind.start);
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
            options.kernel.call('edgeRefs', { document: doc.data(), at: editId, edges: editing.edges || [], resolve: true }).then(function (out) {
                if (!open || asked !== session) {
                    return;
                }
                const now = out.refs.filter(Boolean);
                const missing = (editing.edges || []).length - viewport.selectEdges(now);
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
        panel.focus('size');
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
