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

export const FORMAT = 'aopart';
export const VERSION = 1;
const UNDO_LIMIT = 100;

const TYPE_NAMES = { sketch: 'Sketch', extrude: 'Extrusion', revolve: 'Revolution', shell: 'Shell', pattern: 'Pattern', mirror: 'Mirror', hole: 'Hole', fillet: 'Fillet', chamfer: 'Chamfer', plane: 'Work Plane', import: 'Imported' };

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
    // The part's colour and finish (appearance.js), kept only when set
    const look = normalizeAppearance(data.appearance);
    if (look) {
        out.appearance = look;
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

    doc.change = function (label, fn) {
        const before = JSON.stringify(data);
        fn(data);
        if (JSON.stringify(data) === before) {
            return false;
        }
        undoStack.push({ label: label, state: before });
        if (undoStack.length > UNDO_LIMIT) {
            undoStack.shift();
        }
        redoStack = [];
        emit('change');
        return true;
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
                // its sketch, its work plane, and what a pattern or mirror repeats
                const uses = [f.sketch, f.plane && f.plane.ref === 'plane' ? f.plane.id : null, f.base && f.base.ref === 'plane' ? f.base.id : null].concat(f.features || []);
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
