/*
    3D Modeler - drawing document

    A drawing (.aodrw) is one sheet of 2D views of parts and assemblies, with
    dimensions and notes, for printing (PROPOSAL.md 14.17). Like the part and
    the assembly document it is plain JSON, every change is one undo step
    made through change(label, fn), and it knows nothing of the kernel or the
    DOM.

    {
      format: "aodrw", version: 1,
      sheet: sheet.js defaultSheet(): size, resolution, scale, frame, title block
      style: format.js defaultStyle(): units, precision, prefix, suffix, text size
      sources: { s1: { name, kind: "part" | "assembly", path, data? } }
          the models the views show, by ArozOS path (saved relative to the
          drawing where it can be, io/paths.js); data keeps the model
          itself when it has no file (outside ArozOS, or not saved yet)
      views: [{ id, name, source, parent, rel, dir, xdir, scale, x, y,
                hidden, smooth, centers, label, faces }]
          A base view has its own direction (dir: from the model to the
          viewer, xdir: right on the paper). A projected view has a parent
          view and the side of it it sits on (rel, sheet.js PROJECTED); its
          direction follows the parent's. x, y: where the model origin falls
          on the sheet (mm). scale: null to follow the parent or the sheet.
          faces: null for the whole model, or the faces to draw alone
          ([{ comp, body, index }], comp null in a part)
      annotations: [{ id, type, view, ... }]
          Dimensions and notes; see layout.js for each type. Points of an
          annotation on a view are in that view's own coordinates (model mm
          on the paper plane), so they move and scale with the view.
    }
*/

import { defaultSheet, presetSize } from './sheet.js';
import { defaultStyle } from './format.js';
import { resolveFrom, relativeTo } from '../io/paths.js';

export const FORMAT = 'aodrw';
export const VERSION = 1;
const UNDO_LIMIT = 100;

export function emptyDrawing() {
    return { format: FORMAT, version: VERSION, sheet: defaultSheet(), style: defaultStyle(), sources: {}, views: [], annotations: [] };
}

function isVector(v) {
    return Array.isArray(v) && v.length === 3 && v.every(function (x) {
        return typeof x === 'number' && isFinite(x);
    }) && Math.hypot(v[0], v[1], v[2]) > 1e-9;
}

function finite(v, fallback) {
    return typeof v === 'number' && isFinite(v) ? v : fallback;
}

// Check a parsed file and return clean drawing data, or throw a message a
// user can read
export function validateDrawing(data) {
    if (!data || typeof data !== 'object' || data.format !== FORMAT) {
        throw new Error('This is not a 3D Modeler drawing file');
    }
    if (typeof data.version !== 'number' || data.version > VERSION) {
        throw new Error('This drawing was saved by a newer version of 3D Modeler');
    }
    const sheet = Object.assign(defaultSheet(), data.sheet && typeof data.sheet === 'object' ? data.sheet : {});
    sheet.fields = Object.assign(defaultSheet().fields, sheet.fields || {});
    const size = presetSize(sheet.preset, sheet.orientation);
    if (!(sheet.width > 0 && sheet.height > 0)) {
        sheet.width = size ? size[0] : 420;
        sheet.height = size ? size[1] : 297;
    }
    sheet.dpi = Math.max(10, Math.min(2400, finite(sheet.dpi, 300)));
    sheet.scale = sheet.scale > 0 ? sheet.scale : 1;
    const style = Object.assign(defaultStyle(), data.style && typeof data.style === 'object' ? data.style : {});
    const sources = data.sources && typeof data.sources === 'object' ? data.sources : {};
    const views = Array.isArray(data.views) ? data.views : [];
    const annotations = Array.isArray(data.annotations) ? data.annotations : [];
    const ids = new Set();
    views.forEach(function (v) {
        if (!v || typeof v.id !== 'string' || ids.has(v.id)) {
            throw new Error('The drawing file contains a view without an id, or two with the same id');
        }
        ids.add(v.id);
    });
    views.forEach(function (v) {
        if (v.parent) {
            if (!ids.has(v.parent)) {
                throw new Error('The view ' + (v.name || v.id) + ' is projected from a view the file does not have');
            }
        } else {
            if (!sources[v.source]) {
                throw new Error('The view ' + (v.name || v.id) + ' shows a model the file does not list');
            }
            if (!isVector(v.dir) || !isVector(v.xdir)) {
                throw new Error('The view ' + (v.name || v.id) + ' has no direction');
            }
        }
        v.x = finite(v.x, sheet.width / 2);
        v.y = finite(v.y, sheet.height / 2);
        if (!(v.scale > 0)) {
            v.scale = null;
        }
        if (typeof v.name !== 'string' || !v.name) {
            v.name = v.id;
        }
    });
    annotations.forEach(function (a) {
        if (!a || typeof a.id !== 'string' || ids.has(a.id)) {
            throw new Error('The drawing file contains an annotation without an id, or an id used twice');
        }
        ids.add(a.id);
    });
    return { format: FORMAT, version: VERSION, sheet: sheet, style: style, sources: sources, views: views, annotations: annotations };
}

export function createDrawingDocument() {
    let data = emptyDrawing();
    let undoStack = [];
    let redoStack = [];
    let savedState = JSON.stringify(data);
    const listeners = [];
    const doc = {
        kind: 'drawing',
        name: 'Drawing1',
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
    doc.views = function () {
        return data.views;
    };
    doc.annotations = function () {
        return data.annotations;
    };
    doc.view = function (id) {
        return data.views.filter(function (v) {
            return v.id === id;
        })[0] || null;
    };
    doc.annotation = function (id) {
        return data.annotations.filter(function (a) {
            return a.id === id;
        })[0] || null;
    };
    doc.source = function (id) {
        return data.sources[id] || null;
    };
    doc.serialize = function () {
        return JSON.stringify(data, null, 1);
    };
    // The file text for the place it is written to: model links relative to
    // it where they can be, absolute otherwise
    doc.serializeFor = function (target) {
        const copy = JSON.parse(JSON.stringify(data));
        Object.keys(copy.sources).forEach(function (sid) {
            if (copy.sources[sid].path && target) {
                copy.sources[sid].path = relativeTo(target, copy.sources[sid].path);
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
        data = newData ? validateDrawing(newData) : emptyDrawing();
        // Links are absolute while the drawing is open
        Object.keys(data.sources).forEach(function (sid) {
            if (data.sources[sid].path) {
                data.sources[sid].path = resolveFrom(path, data.sources[sid].path);
            }
        });
        undoStack = [];
        redoStack = [];
        savedState = JSON.stringify(data);
        doc.name = name || 'Drawing1';
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

    // An id nothing in the drawing uses yet: "v3", "d12", "s1"
    doc.newId = function (prefix) {
        const used = new Set(Object.keys(data.sources).concat(data.views.map(function (v) {
            return v.id;
        }), data.annotations.map(function (a) {
            return a.id;
        })));
        let n = 1;
        while (used.has(prefix + n)) {
            n++;
        }
        return prefix + n;
    };

    // "VIEW1", "VIEW2", ... as Inventor names them
    doc.newViewName = function () {
        const names = new Set(data.views.map(function (v) {
            return v.name;
        }));
        let n = 1;
        while (names.has('VIEW' + n)) {
            n++;
        }
        return 'VIEW' + n;
    };

    // The source entry for a file already in the drawing, or null
    doc.sourceByPath = function (path) {
        if (!path) {
            return null;
        }
        return Object.keys(data.sources).filter(function (key) {
            return data.sources[key].path === path;
        })[0] || null;
    };

    // The views projected from a view, and theirs, all the way down
    doc.descendants = function (id) {
        const out = [];
        const walk = function (parent) {
            data.views.forEach(function (v) {
                if (v.parent === parent) {
                    out.push(v);
                    walk(v.id);
                }
            });
        };
        walk(id);
        return out;
    };

    // The base view a view is projected from (itself for a base view)
    doc.baseOf = function (view) {
        let v = view;
        while (v && v.parent) {
            v = doc.view(v.parent);
        }
        return v;
    };

    // Remove views (with the views projected from them and every annotation
    // on them) inside a change; sources no view shows any more go too
    doc.removeViews = function (d, ids) {
        const gone = new Set();
        const walk = function (id) {
            gone.add(id);
            d.views.forEach(function (v) {
                if (v.parent === id && !gone.has(v.id)) {
                    walk(v.id);
                }
            });
        };
        ids.forEach(walk);
        d.views = d.views.filter(function (v) {
            return !gone.has(v.id);
        });
        d.annotations = d.annotations.filter(function (a) {
            return !a.view || !gone.has(a.view);
        });
        const used = new Set(d.views.map(function (v) {
            return v.source;
        }));
        Object.keys(d.sources).forEach(function (key) {
            if (!used.has(key)) {
                delete d.sources[key];
            }
        });
    };

    return doc;
}
