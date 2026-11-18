/*
    3D Modeler - Sweep

    3D Model > Sweep, as in desktop CAD: a profile (closed areas of one sketch,
    picked as in Extrude) moved along a path (curves of another sketch).
    Clicking a path curve takes every curve joined to it end to end; a
    click on a picked curve drops it, a click on another curve of the same
    sketch adds it. The sweep starts at the end of the path nearer to the
    profile. Join, Cut, Intersect or a New Solid, with a live preview.

    Document: { type: "sweep", sketch, regions, path: { sketch, curves },
    operation } (kernel/occt.js sweepTool).

    options: stage, viewport, kernel, doc, onStatus(text), onClose(committed)
*/

import { createPanel } from './panel.js';
import { createProfiles } from './profiles.js';
import { planeFrame, toWorld } from '../kernel/profile.js';
import { curves as sketchCurves } from '../sketch/model.js';
import { sample } from '../sketch/geom.js';
import { sketchesOf } from '../document/document.js';
import { connectedCurves } from '../sketch/chain.js';

const OPERATIONS = [
    { id: 'join', label: 'Join', title: 'Add to the solid' },
    { id: 'cut', label: 'Cut', title: 'Remove from the solid' },
    { id: 'intersect', label: 'Intersect', title: 'Keep only what the solid and the sweep share' },
    { id: 'new', label: 'New Solid', title: 'Make a separate solid body' }
];

export function createSweep(options) {
    const viewport = options.viewport;
    const doc = options.doc;
    let open = false;
    let editId = null;
    let path = null;        // { sketch, curves: [id] }
    let segments = [];      // [{ sketch, curve, a, b }] drawn for picking
    let valid = false;
    let token = 0;
    let timer = null;

    const profiles = createProfiles({ viewport: viewport, kernel: options.kernel, doc: doc, onPick: refresh });

    const panel = createPanel(options.stage, {
        title: 'Sweep',
        rows: [
            { type: 'section', label: 'Input Geometry' },
            { type: 'pick', key: 'profiles', label: 'Profiles', title: 'Click to clear the selection' },
            { type: 'pick', key: 'path', label: 'Path', title: 'Click to clear the path' },
            { type: 'section', label: 'Output' },
            { type: 'seg', key: 'operation', label: 'Boolean', items: OPERATIONS, illustrate: 'operation' }
        ],
        onChange: refresh,
        onAction: function (key) {
            if (key === 'profiles') {
                profiles.clear();
            } else {
                path = null;
            }
            refresh();
        },
        onOk: commit,
        onCancel: function () {
            close(false);
        }
    });

    // The sketches a path can come from: drawn, built, not the profile's
    // and not used by another feature (shared ones are)
    function pathSketches() {
        const end = doc.endIndex ? doc.endIndex() : Infinity;
        const used = new Set();
        doc.features().forEach(function (f) {
            if (f.id !== editId) {
                sketchesOf(f).forEach(function (id) {
                    used.add(id);
                });
            }
        });
        const profile = profiles.chosenSketch();
        return doc.features().filter(function (f, i) {
            return f.type === 'sketch' && !f.suppressed && !f.hidden && i <= end && f.id !== profile && (!used.has(f.id) || f.shared);
        });
    }

    function makeSegments() {
        segments = [];
        pathSketches().forEach(function (sketch) {
            const frame = planeFrame(sketch.plane, doc.features());
            if (!frame) {
                return;
            }
            sketchCurves({ geometry: sketch.geometry || [], constraints: [] }).forEach(function (c) {
                const pts = sample(c).map(function (p) {
                    return toWorld(frame, p[0], p[1]);
                });
                for (let i = 1; i < pts.length; i++) {
                    segments.push({ sketch: sketch.id, curve: c.id, a: pts[i - 1], b: pts[i] });
                }
            });
        });
    }

    function curvesOf(sketchId) {
        const sketch = doc.feature(sketchId);
        return sketch ? sketchCurves({ geometry: sketch.geometry || [], constraints: [] }) : [];
    }

    function pickCurve(index) {
        const seg = segments[index];
        if (!seg) {
            return;
        }
        if (!path || path.sketch !== seg.sketch) {
            path = { sketch: seg.sketch, curves: connectedCurves(curvesOf(seg.sketch), seg.curve) };
        } else if (path.curves.indexOf(seg.curve) >= 0) {
            path.curves = path.curves.filter(function (id) {
                return id !== seg.curve;
            });
            if (!path.curves.length) {
                path = null;
            }
        } else {
            path.curves.push(seg.curve);
        }
        refresh();
    }

    function draft() {
        return {
            type: 'sweep',
            sketch: profiles.chosenSketch(),
            regions: profiles.samples(),
            regionCurves: profiles.curveSets(),
            path: path ? { sketch: path.sketch, curves: path.curves.slice() } : null,
            operation: panel.get('operation')
        };
    }

    function refresh() {
        if (!open) {
            return;
        }
        if (path && path.sketch === profiles.chosenSketch()) {
            path = null; // the profile's own sketch cannot be its path
        }
        makeSegments();
        profiles.paint();
        viewport.setAxes(segments.map(function (s) {
            return { a: s.a, b: s.b, selected: !!path && path.sketch === s.sketch && path.curves.indexOf(s.curve) >= 0 };
        }), pickCurve);
        const count = profiles.count();
        const sketch = profiles.chosenSketch();
        panel.title(editId ? doc.feature(editId).name : 'Sweep', sketch ? doc.feature(sketch).name : '');
        panel.text('profiles', count ? count + (count === 1 ? ' profile' : ' profiles') : 'Pick a profile in the model', !count);
        panel.text('path', path ? path.curves.length + (path.curves.length === 1 ? ' curve of ' : ' curves of ') + doc.feature(path.sketch).name : 'Pick the path in the model', !path);

        clearTimeout(timer);
        const mine = ++token;
        valid = false;
        panel.ok(false);
        if (!count) {
            viewport.setPreview(null);
            panel.note('Click a closed area of a sketch to sweep. The path is drawn in another sketch, usually on a plane across the profile.');
            return;
        }
        if (!path) {
            viewport.setPreview(null);
            panel.note(segments.length ? 'Click a curve of the path (drawn in blue): the curves joined to it come along. Click one again to drop it.'
                : 'No sketch is left for the path: draw the path in a new sketch (on a plane across the profile), then Sweep.', !segments.length);
            return;
        }
        timer = setTimeout(function () {
            const f = draft();
            options.kernel.call('tryFeature', { document: doc.data(), feature: f, at: editId }).then(function (out) {
                if (mine === token && open) {
                    viewport.setPreview(out.mesh, f.operation);
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
        clearTimeout(timer);
        panel.hide();
        profiles.stop();
        viewport.setAxes(null);
        viewport.setPreview(null);
        options.onClose(committed);
    }

    function commit() {
        if (!open || !valid) {
            return;
        }
        const made = draft();
        const editing = editId;
        close(true);
        if (editing) {
            const old = doc.feature(editing);
            doc.change('Edit ' + old.name, function () {
                old.sketch = made.sketch;
                old.regions = made.regions;
                old.regionCurves = made.regionCurves;
                old.path = made.path;
                old.operation = made.operation;
            });
        } else {
            const id = doc.newId();
            const name = doc.newName('sweep');
            doc.change(name, function (d) {
                d.features.push({ id: id, type: 'sweep', name: name, sketch: made.sketch, regions: made.regions, regionCurves: made.regionCurves, path: made.path, operation: made.operation });
            });
        }
    }

    function start(featureId) {
        close(false);
        const editing = featureId ? doc.feature(featureId) : null;
        return profiles.load(editing, 'Sweep').then(function (loaded) {
            if (!loaded.ok) {
                options.onStatus(loaded.message);
                return false;
            }
            editId = editing ? editing.id : null;
            path = editing && editing.path ? { sketch: editing.path.sketch, curves: (editing.path.curves || []).slice() } : null;
            if (path && !path.curves.length) {
                path.curves = curvesOf(path.sketch).filter(function (c) {
                    return !c.construction;
                }).map(function (c) {
                    return c.id;
                });
            }
            panel.set('operation', editing ? editing.operation || 'join' : 'join');
            open = true;
            panel.show();
            refresh();
            return true;
        });
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
