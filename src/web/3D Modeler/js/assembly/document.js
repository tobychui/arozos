/*
    3D Modeler - assembly document

    An assembly (.aoasm) places parts (.aopart files) as components and holds
    them together with constraints (PROPOSAL.md 14.16). Like the part
    document it is plain JSON, every change goes through change(label, fn)
    as one undo step, and it knows nothing of the kernel or the DOM.

    {
      format: "aoasm", version: 1, units: "mm",
      parts: { p1: { name, path, data? } }
          path: the part file in the ArozOS file system, saved relative to
          the assembly file when both are under the same root (io/paths.js;
          absolute while the assembly is open); data: the part document
          itself, kept only when the part has no file (placed from the
          browser's file picker outside ArozOS, or a STEP file)
      components: [{ id, name, part, matrix, grounded, hidden, color }]
          matrix: placement, 16 numbers column-major (geometry.js)
      constraints: [{ id, name, type, solution, offset, angle, a, b, suppressed }]
          a, b: entities (solver.js), each with comp (a component id, or
          null for the assembly origin) and pick, how the face or edge was
          picked, so it can be found again when the part changes
    }
*/

import { identity, isMatrix } from './geometry.js';
import { resolveFrom, relativeTo } from '../io/paths.js';

export const FORMAT = 'aoasm';
export const VERSION = 1;
const UNDO_LIMIT = 100;

// Colours given to components in turn, so neighbours can be told apart
export const PALETTE = ['#a9b4c2', '#d9a05b', '#86b47f', '#c98383', '#8ea3d6', '#c9b56a', '#a993cb', '#72b5ba'];

const CONSTRAINT_NAMES = { mate: 'Mate', flush: 'Flush', angle: 'Angle', tangent: 'Tangent', insert: 'Insert' };

export function emptyAssembly() {
    return { format: FORMAT, version: VERSION, units: 'mm', parts: {}, components: [], constraints: [] };
}

// Check a parsed file and return clean assembly data, or throw a message a
// user can read
export function validateAssembly(data) {
    if (!data || typeof data !== 'object' || data.format !== FORMAT) {
        throw new Error('This is not a 3D Modeler assembly file');
    }
    if (typeof data.version !== 'number' || data.version > VERSION) {
        throw new Error('This assembly was saved by a newer version of 3D Modeler');
    }
    const parts = data.parts && typeof data.parts === 'object' ? data.parts : {};
    const components = Array.isArray(data.components) ? data.components : [];
    const constraints = Array.isArray(data.constraints) ? data.constraints : [];
    const ids = new Set();
    components.forEach(function (comp) {
        if (!comp || typeof comp.id !== 'string' || ids.has(comp.id)) {
            throw new Error('The assembly file contains a component without an id, or two with the same id');
        }
        ids.add(comp.id);
        if (!parts[comp.part]) {
            throw new Error('The component ' + (comp.name || comp.id) + ' refers to a part the file does not list');
        }
        if (!isMatrix(comp.matrix)) {
            comp.matrix = identity();
        }
        if (typeof comp.name !== 'string' || !comp.name) {
            comp.name = comp.id;
        }
    });
    constraints.forEach(function (c) {
        if (!c || typeof c.id !== 'string' || ids.has(c.id)) {
            throw new Error('The assembly file contains a constraint without an id, or an id used twice');
        }
        ids.add(c.id);
        if (typeof c.name !== 'string' || !c.name) {
            c.name = c.id;
        }
    });
    return { format: FORMAT, version: VERSION, units: 'mm', parts: parts, components: components, constraints: constraints };
}

// The part links of assembly data read from the file `from`, made absolute
// (in place); also used for an assembly a drawing shows
export function resolvePartPaths(data, from) {
    Object.keys(data.parts || {}).forEach(function (pid) {
        const entry = data.parts[pid];
        if (entry && entry.path) {
            entry.path = resolveFrom(from, entry.path);
        }
    });
    return data;
}

export function createAssemblyDocument() {
    let data = emptyAssembly();
    let undoStack = [];
    let redoStack = [];
    let savedState = JSON.stringify(data);
    const listeners = [];
    const doc = {
        kind: 'assembly',
        name: 'Assembly1',
        path: ''
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

    doc.components = function () {
        return data.components;
    };

    doc.constraints = function () {
        return data.constraints;
    };

    doc.component = function (id) {
        return data.components.filter(function (c) {
            return c.id === id;
        })[0] || null;
    };

    doc.constraint = function (id) {
        return data.constraints.filter(function (c) {
            return c.id === id;
        })[0] || null;
    };

    doc.part = function (id) {
        return data.parts[id] || null;
    };

    doc.serialize = function () {
        return JSON.stringify(data, null, 1);
    };

    // The file text for the place it is written to: part links relative to
    // it where they can be (io/paths.js), absolute otherwise
    doc.serializeFor = function (target) {
        const copy = JSON.parse(JSON.stringify(data));
        Object.keys(copy.parts).forEach(function (pid) {
            if (copy.parts[pid].path && target) {
                copy.parts[pid].path = relativeTo(target, copy.parts[pid].path);
            }
        });
        return JSON.stringify(copy, null, 1);
    };

    doc.isDirty = function () {
        return JSON.stringify(data) !== savedState;
    };

    doc.markSaved = function () {
        savedState = JSON.stringify(data);
        emit('saved');
    };

    doc.reset = function (newData, name, path) {
        data = newData ? resolvePartPaths(validateAssembly(newData), path) : emptyAssembly();
        undoStack = [];
        redoStack = [];
        savedState = JSON.stringify(data);
        doc.name = name || 'Assembly1';
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

    // An id nothing in the assembly uses yet: "c3", "k2", "p1"
    doc.newId = function (prefix) {
        const used = new Set(Object.keys(data.parts).concat(data.components.map(function (c) {
            return c.id;
        }), data.constraints.map(function (c) {
            return c.id;
        })));
        let n = 1;
        while (used.has(prefix + n)) {
            n++;
        }
        return prefix + n;
    };

    // "Bracket:2" for the second occurrence of Bracket
    doc.newComponentName = function (partName) {
        const names = new Set(data.components.map(function (c) {
            return c.name;
        }));
        let n = 1;
        while (names.has(partName + ':' + n)) {
            n++;
        }
        return partName + ':' + n;
    };

    // "Mate:3", "Flush:1"
    doc.newConstraintName = function (type, solution) {
        const base = type === 'mate' && solution === 'flush' ? 'Flush' : CONSTRAINT_NAMES[type] || 'Constraint';
        const names = new Set(data.constraints.map(function (c) {
            return c.name;
        }));
        let n = 1;
        while (names.has(base + ':' + n)) {
            n++;
        }
        return base + ':' + n;
    };

    // The constraints that refer to a component
    doc.constraintsOf = function (compId) {
        return data.constraints.filter(function (c) {
            return (c.a && c.a.comp === compId) || (c.b && c.b.comp === compId);
        });
    };

    // The part entry for a file already in the assembly, or null
    doc.partByPath = function (path) {
        if (!path) {
            return null;
        }
        const id = Object.keys(data.parts).filter(function (key) {
            return data.parts[key].path === path;
        })[0];
        return id || null;
    };

    // Remove components (and what refers to them) inside a change
    doc.removeComponents = function (d, ids) {
        d.components = d.components.filter(function (c) {
            return ids.indexOf(c.id) < 0;
        });
        d.constraints = d.constraints.filter(function (c) {
            return ids.indexOf(c.a && c.a.comp) < 0 && ids.indexOf(c.b && c.b.comp) < 0;
        });
        // Parts no component uses any more are dropped from the file
        const used = new Set(d.components.map(function (c) {
            return c.part;
        }));
        Object.keys(d.parts).forEach(function (key) {
            if (!used.has(key)) {
                delete d.parts[key];
            }
        });
    };

    return doc;
}
