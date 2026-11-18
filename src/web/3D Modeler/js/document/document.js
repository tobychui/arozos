/*
    3D Modeler - document

    The part is its feature history (PROPOSAL.md 6.2): an ordered list of
    features, saved as JSON. This module owns that list, every change to it,
    and undo / redo. It knows nothing about the kernel or the DOM, so it also
    runs under Node.

    All changes go through change(label, fn): fn edits the data in place, the
    state before it becomes one undo step, and listeners are told. Undo steps
    are whole snapshots of the JSON, which is small.
*/

import { normalizeAppearance } from '../appearance.js';
import { normalizeMaterial } from '../materials.js';
import { normalizeParameters } from '../parameters.js';

export const FORMAT = 'aopart';
export const VERSION = 1;
const UNDO_LIMIT = 100;

const TYPE_NAMES = { sketch: 'Sketch', extrude: 'Extrusion', revolve: 'Revolution', shell: 'Shell', pattern: 'Pattern', mirror: 'Mirror', hole: 'Hole', fillet: 'Fillet', chamfer: 'Chamfer', plane: 'Work Plane', axis: 'Work Axis', point: 'Work Point', import: 'Imported', repair: 'Repair', sweep: 'Sweep', loft: 'Loft', draft: 'Draft', mesh: 'Mesh' };

// Every sketch a feature is built from: its profile sketch, the path of a
// sweep, the sections of a loft
export function sketchesOf(feature) {
    const out = [];
    if (feature.sketch) {
        out.push(feature.sketch);
    }
    if (feature.path && feature.path.sketch) {
        out.push(feature.path.sketch);
    }
    (feature.sections || []).forEach(function (s) {
        if (s && s.sketch && out.indexOf(s.sketch) < 0) {
            out.push(s.sketch);
        }
    });
    return out;
}

// The features one refers to: its sketch, what a pattern repeats, and
// every work plane, axis or point in its references, however deep
export function usesOf(feature) {
    const out = sketchesOf(feature);
    (feature.features || []).forEach(function (id) {
        out.push(id);
    });
    const walk = function (v, depth) {
        if (!v || typeof v !== 'object' || depth > 6) {
            return;
        }
        if (Array.isArray(v)) {
            v.forEach(function (x) {
                walk(x, depth + 1);
            });
            return;
        }
        if ((v.ref === 'plane' || v.ref === 'axis' || v.ref === 'point') && typeof v.id === 'string') {
            out.push(v.id);
        }
        if (typeof v.work === 'string') {
            out.push(v.work); // a revolution about a work axis
        }
        Object.keys(v).forEach(function (k) {
            if (k !== 'features' && k !== 'geometry' && k !== 'constraints' && k !== 'data') {
                walk(v[k], depth + 1);
            }
        });
    };
    walk(feature, 0);
    return out;
}

// The distance of the newest extrusion in `features` that goes a distance
// (not To, To Next or Through All): { value, value2, expr, expr2 }, or null.
// A new extrusion starts from it instead of a fixed 10 mm.
export function lastExtrudeDistance(features) {
    for (let i = (features || []).length - 1; i >= 0; i--) {
        const f = features[i];
        const e = f && f.type === 'extrude' ? f.extent : null;
        if (e && (e.type || 'distance') === 'distance' && e.value > 0) {
            return {
                value: e.value,
                value2: e.value2 > 0 ? e.value2 : e.value,
                expr: typeof e.expr === 'string' ? e.expr : null,
                expr2: typeof e.expr2 === 'string' ? e.expr2 : null
            };
        }
    }
    return null;
}

export function emptyData() {
    return { format: FORMAT, version: VERSION, units: 'mm', features: [] };
}

// Check a parsed file and return clean document data, or throw a message a
// user can read. Unknown feature types are kept: the rebuild reports them.
export function validate(data) {
    if (!data || typeof data !== 'object' || data.format !== FORMAT) {
        throw new Error('This is not a 3D Modeler part file');
    }
    if (typeof data.version !== 'number' || data.version > VERSION) {
        throw new Error('This part was saved by a newer version of 3D Modeler');
    }
    if (!Array.isArray(data.features)) {
        throw new Error('The part file has no feature list');
    }
    const ids = new Set();
    data.features.forEach(function (feature) {
        if (!feature || typeof feature.id !== 'string' || typeof feature.type !== 'string') {
            throw new Error('The part file contains a feature without an id or a type');
        }
        if (ids.has(feature.id)) {
            throw new Error('The part file contains two features with the id ' + feature.id);
        }
        ids.add(feature.id);
        if (typeof feature.name !== 'string' || feature.name === '') {
            feature.name = feature.id;
        }
    });
    const out = { format: FORMAT, version: VERSION, units: data.units === 'mm' ? 'mm' : 'mm', features: data.features };
    // The End of Part marker: the id of the last feature that is built
    // ("" before every feature); kept only when it names one
    if (typeof data.end === 'string' && (data.end === '' || ids.has(data.end))) {
        out.end = data.end;
    }
    // Solid bodies hidden in the view, by their number
    if (Array.isArray(data.hiddenBodies)) {
        const hidden = data.hiddenBodies.filter(function (n) {
            return Number.isInteger(n) && n >= 0;
        });
        if (hidden.length) {
            out.hiddenBodies = hidden;
        }
    }
    // The part's colour and finish (appearance.js), kept only when set
    const look = normalizeAppearance(data.appearance);
    if (look) {
        out.appearance = look;
    }
    // What the part is made of, for its mass (features/material.js)
    const material = normalizeMaterial(data.material);
    if (material) {
        out.material = material;
    }
    // Named values formulas can use (parameters.js)
    const parameters = normalizeParameters(data.parameters);
    if (parameters.length) {
        out.parameters = parameters;
    }
    return out;
}

export function createDocument() {
    let data = emptyData();
    let undoStack = [];
    let redoStack = [];
    let savedState = JSON.stringify(data);
    const listeners = [];
    const doc = {
        name: 'Part1',      // shown in the title; the file name without extension once saved
        path: ''            // ArozOS virtual path, empty until saved or opened
    };

    function emit(reason) {
        listeners.forEach(function (fn) {
            fn(reason);
        });
    }

    doc.onChange = function (fn) {
        listeners.push(fn);
    };

    doc.data = function () {
        return data;
    };

    doc.features = function () {
        return data.features;
    };

    doc.feature = function (id) {
        return data.features.filter(function (f) {
            return f.id === id;
        })[0] || null;
    };

    doc.serialize = function () {
        return JSON.stringify(data, null, 1);
    };

    doc.isDirty = function () {
        return JSON.stringify(data) !== savedState;
    };

    doc.markSaved = function () {
        savedState = JSON.stringify(data);
        emit('saved');
    };

    // Replace everything with a new part or a loaded one. Clears undo.
    doc.reset = function (newData, name, path) {
        data = newData ? validate(newData) : emptyData();
        undoStack = [];
        redoStack = [];
        savedState = JSON.stringify(data);
        doc.name = name || 'Part1';
        doc.path = path || '';
        emit('reset');
    };

    // Everything the document holds (undo history too), to keep it while
    // another document tab is shown
    doc.snapshot = function () {
        return { data: JSON.stringify(data), undo: undoStack.slice(), redo: redoStack.slice(), saved: savedState, name: doc.name, path: doc.path };
    };

    // Bring a snapshot back. Listeners hear "restore": the same document
    // as before, not a new one (the view, caches and selection may stay)
    doc.restore = function (snap) {
        data = JSON.parse(snap.data);
        undoStack = snap.undo.slice();
        redoStack = snap.redo.slice();
        savedState = snap.saved;
        doc.name = snap.name;
        doc.path = snap.path;
        emit('restore');
    };

    // options.visual: only how the part is shown changed (hidden, shared):
    // listeners hear "visual" instead of "change", so nothing is rebuilt
    doc.change = function (label, fn, options) {
        const before = JSON.stringify(data);
        const had = new Set(data.features.map(function (f) {
            return f.id;
        }));
        fn(data);
        placeAtEnd(had);
        if (JSON.stringify(data) === before) {
            return false;
        }
        undoStack.push({ label: label, state: before });
        if (undoStack.length > UNDO_LIMIT) {
            undoStack.shift();
        }
        redoStack = [];
        emit(options && options.visual ? 'visual' : 'change');
        return true;
    };

    // A change that is not an undo step of its own: what the app does by
    // itself after a change (projected sketch geometry following the model).
    // The user's step before it undoes both. Listeners hear "amend".
    doc.amend = function (fn) {
        const before = JSON.stringify(data);
        fn(data);
        if (JSON.stringify(data) === before) {
            return false;
        }
        emit('amend');
        return true;
    };

    // With the End of Part marker up the tree, features added at the end of
    // the list go where the marker is, and the marker moves past them
    function placeAtEnd(had) {
        if (data.end === undefined) {
            return;
        }
        const fresh = data.features.filter(function (f) {
            return !had.has(f.id);
        });
        if (data.end !== '' && !doc.feature(data.end)) {
            delete data.end; // its feature is gone
            return;
        }
        if (!fresh.length) {
            return;
        }
        const rest = data.features.filter(function (f) {
            return had.has(f.id);
        });
        const at = data.end === '' ? 0 : rest.findIndex(function (f) {
            return f.id === data.end;
        }) + 1;
        data.features = rest.slice(0, at).concat(fresh, rest.slice(at));
        data.end = fresh[fresh.length - 1].id;
        if (data.end === data.features[data.features.length - 1].id) {
            delete data.end; // at the bottom again: no marker needed
        }
    }

    // Where the End of Part marker is: the index of the last feature that
    // is built (-1 before them all; the last index when there is no marker)
    doc.endIndex = function () {
        if (data.end === undefined) {
            return data.features.length - 1;
        }
        return data.end === '' ? -1 : data.features.findIndex(function (f) {
            return f.id === data.end;
        });
    };

    // Move the End of Part marker after feature `id` ("" before them all,
    // null to the bottom). Features after it are not built.
    doc.setEnd = function (id) {
        return doc.change('Move End of Part', function (d) {
            if (id === null || id === undefined || (id && d.features.length && d.features[d.features.length - 1].id === id)) {
                delete d.end;
            } else {
                d.end = id;
            }
        });
    };

    // A feature and what moves with it: the sketch only it is built from
    function moveGroup(id) {
        const feature = doc.feature(id);
        if (!feature) {
            return [];
        }
        const group = [id];
        const sketch = feature.sketch ? doc.feature(feature.sketch) : null;
        if (sketch && !sketch.shared && data.features.indexOf(sketch) < data.features.indexOf(feature) &&
            !data.features.some(function (f) {
                return f !== feature && usesOf(f).indexOf(sketch.id) >= 0;
            })) {
            group.unshift(sketch.id);
        }
        return group;
    }

    // The feature list with `id` (and its own sketch) moved before
    // `beforeId` (null: to the bottom), or a reason it cannot be: every
    // feature must still come after everything it uses
    function reordered(id, beforeId) {
        const group = moveGroup(id);
        if (!group.length) {
            return { reason: 'There is no such feature' };
        }
        if (group.indexOf(beforeId) >= 0) {
            return { list: data.features.slice() };
        }
        const moving = group.map(doc.feature);
        const rest = data.features.filter(function (f) {
            return group.indexOf(f.id) < 0;
        });
        const at = beforeId ? rest.findIndex(function (f) {
            return f.id === beforeId;
        }) : rest.length;
        if (at < 0) {
            return { reason: 'There is no such place in the tree' };
        }
        const list = rest.slice(0, at).concat(moving, rest.slice(at));
        const place = {};
        list.forEach(function (f, i) {
            place[f.id] = i;
        });
        for (let i = 0; i < list.length; i++) {
            const uses = usesOf(list[i]);
            for (let k = 0; k < uses.length; k++) {
                if (place[uses[k]] !== undefined && place[uses[k]] > i) {
                    const used = list[place[uses[k]]];
                    return { reason: list[i].name + ' is built from ' + used.name + ', which would come after it' };
                }
            }
        }
        return { list: list };
    }

    // null when the move is allowed, else why not
    doc.canMove = function (id, beforeId) {
        return reordered(id, beforeId).reason || null;
    };

    // built: the feature lands just above End of Part, so the marker moves
    // past it (dropped in the gap above the marker in the tree)
    doc.move = function (id, beforeId, built) {
        const out = reordered(id, beforeId);
        if (out.reason) {
            return false;
        }
        const feature = doc.feature(id);
        const group = moveGroup(id);
        return doc.change('Move ' + feature.name, function (d) {
            // The End of Part marker stays where it was when the feature it
            // is after moves away: it goes to the one before
            if (typeof d.end === 'string' && group.indexOf(d.end) >= 0) {
                let i = d.features.findIndex(function (f) {
                    return f.id === d.end;
                }) - 1;
                while (i >= 0 && group.indexOf(d.features[i].id) >= 0) {
                    i--;
                }
                d.end = i >= 0 ? d.features[i].id : '';
            }
            d.features = out.list;
            if (built && typeof d.end === 'string') {
                d.end = id;
            }
            if (d.end && d.end === d.features[d.features.length - 1].id) {
                delete d.end;
            }
        });
    };

    // A sketch shared between features: drawn in the model and offered as a
    // profile again although something is built from it
    doc.setShared = function (id, shared) {
        const feature = doc.feature(id);
        if (!feature || feature.type !== 'sketch') {
            return false;
        }
        return doc.change((shared ? 'Share ' : 'Stop Sharing ') + feature.name, function () {
            if (shared) {
                feature.shared = true;
            } else {
                delete feature.shared;
            }
        }, { visual: true });
    };

    // Hide a solid body in the view (by its number) or show it again
    doc.setBodyHidden = function (index, hidden) {
        return doc.change((hidden ? 'Hide' : 'Show') + ' Solid' + (index + 1), function (d) {
            const list = (d.hiddenBodies || []).filter(function (n) {
                return n !== index;
            });
            if (hidden) {
                list.push(index);
            }
            if (list.length) {
                d.hiddenBodies = list.sort(function (a, b) {
                    return a - b;
                });
            } else {
                delete d.hiddenBodies;
            }
        }, { visual: true });
    };

    // A document brought back from an autosave: it is not saved anywhere
    doc.markUnsaved = function () {
        savedState = '';
        emit('saved');
    };

    doc.canUndo = function () {
        return undoStack.length > 0;
    };

    doc.canRedo = function () {
        return redoStack.length > 0;
    };

    // Both return the label of the step, or null when there is nothing to do
    doc.undo = function () {
        const step = undoStack.pop();
        if (!step) {
            return null;
        }
        redoStack.push({ label: step.label, state: JSON.stringify(data) });
        data = JSON.parse(step.state);
        emit('undo');
        return step.label;
    };

    doc.redo = function () {
        const step = redoStack.pop();
        if (!step) {
            return null;
        }
        undoStack.push({ label: step.label, state: JSON.stringify(data) });
        data = JSON.parse(step.state);
        emit('redo');
        return step.label;
    };

    // An id no feature uses yet, and the next free default name for a type
    doc.newId = function () {
        let n = data.features.length + 1;
        while (doc.feature('f' + n)) {
            n++;
        }
        return 'f' + n;
    };

    doc.newName = function (type) {
        const base = TYPE_NAMES[type] || 'Feature';
        const names = new Set(data.features.map(function (f) {
            return f.name;
        }));
        let n = 1;
        while (names.has(base + n)) {
            n++;
        }
        return base + n;
    };

    // Features that stop working when `id` is removed: what was built from a
    // sketch, sketches and planes on a work plane, and whatever depends on
    // those in turn
    doc.dependents = function (id) {
        const gone = new Set([id]);
        let grew = true;
        while (grew) {
            grew = false;
            data.features.forEach(function (f) {
                if (gone.has(f.id)) {
                    return;
                }
                // its sketch, its work planes, axes and points, and what a
                // pattern or mirror repeats
                const uses = usesOf(f);
                if (uses.some(function (u) {
                    return u && gone.has(u);
                })) {
                    gone.add(f.id);
                    grew = true;
                }
            });
        }
        return data.features.filter(function (f) {
            return f.id !== id && gone.has(f.id);
        });
    };

    doc.remove = function (id) {
        const feature = doc.feature(id);
        if (!feature) {
            return false;
        }
        const gone = [id].concat(doc.dependents(id).map(function (f) {
            return f.id;
        }));
        return doc.change('Delete ' + feature.name, function (d) {
            d.features = d.features.filter(function (f) {
                return gone.indexOf(f.id) < 0;
            });
        });
    };

    doc.setSuppressed = function (id, suppressed) {
        const feature = doc.feature(id);
        if (!feature) {
            return false;
        }
        return doc.change((suppressed ? 'Suppress ' : 'Unsuppress ') + feature.name, function () {
            if (suppressed) {
                feature.suppressed = true;
            } else {
                delete feature.suppressed;
            }
        });
    };

    // Hide a work plane (or show it again): it stays in the part, is not
    // drawn and cannot be picked, so it does not get in the way
    doc.setHidden = function (id, hidden) {
        const feature = doc.feature(id);
        if (!feature) {
            return false;
        }
        return doc.change((hidden ? 'Hide ' : 'Show ') + feature.name, function () {
            if (hidden) {
                feature.hidden = true;
            } else {
                delete feature.hidden;
            }
        }, { visual: true });
    };

    doc.rename = function (id, name) {
        const feature = doc.feature(id);
        name = String(name || '').trim().slice(0, 80);
        if (!feature || !name) {
            return false;
        }
        return doc.change('Rename ' + feature.name, function () {
            feature.name = name;
        });
    };

    return doc;
}
