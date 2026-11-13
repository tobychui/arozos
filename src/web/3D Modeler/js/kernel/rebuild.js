/*
    3D Modeler - feature replay

    Turns a document (the ordered feature list) into solids. The shape after
    each feature is cached under a key made of that feature and everything
    before it, so editing feature N reuses the result of N-1.

    A feature that fails keeps the bodies it was given, reports its error, and
    the features after it are still attempted.

    No DOM here: createRebuilder runs in the worker and under Node.

    To add a feature type: write its kernel function in occt.js, call it from
    applyFeature below, and add a case to tests/kernel.test.mjs.
*/

import * as kernel from './occt.js';
import { withResolvedPlane, resolveFace } from './profile.js';

// The face plane reference of a sketch or a work plane feature, if any
function facePlaneOf(feature) {
    const plane = feature.type === 'sketch' ? feature.plane : feature.type === 'plane' ? feature.base : null;
    return plane && plane.ref === 'face' && plane.face ? plane : null;
}

// Small string hash (FNV-1a); collisions only matter within one document.
function hash(text, seed) {
    let h = seed >>> 0;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h;
}

// The parts of a feature that change its geometry. Renaming must not rebuild.
function geometryKey(feature) {
    const copy = Object.assign({}, feature);
    delete copy.name;
    return JSON.stringify(copy);
}

export function createRebuilder(oc) {
    let cache = new Map(); // key -> { bodies: [TopoDS_Shape], status }
    let latest = [];       // the solids of the last full rebuild

    function sketchOf(feature, byId, features) {
        const sketch = byId[feature.sketch];
        if (!sketch || sketch.type !== 'sketch') {
            throw new Error('The sketch of this feature no longer exists');
        }
        if (sketch.suppressed) {
            throw new Error('The sketch of this feature is suppressed');
        }
        // A sketch on a work plane takes that plane's position as it is now
        return withResolvedPlane(sketch, features);
    }

    // The features a pattern or mirror repeats, with their sketches
    function sourcesOf(feature, byId, features) {
        return (feature.features || []).map(function (id) {
            const source = byId[id];
            if (!source) {
                throw new Error('A feature this ' + (feature.type === 'mirror' ? 'mirror' : 'pattern') + ' repeats no longer exists, or comes after it');
            }
            if (source.suppressed) {
                throw new Error(source.name + ', which this repeats, is suppressed');
            }
            return { feature: source, sketch: source.sketch ? sketchOf(source, byId, features) : null };
        });
    }

    function applyFeature(feature, bodies, byId, features) {
        switch (feature.type) {
            case 'sketch':
            case 'plane':
                return bodies; // a sketch or a work plane adds no solid by itself
            case 'extrude':
                return kernel.extrude(oc, bodies, feature, sketchOf(feature, byId, features));
            case 'revolve':
                return kernel.revolve(oc, bodies, feature, sketchOf(feature, byId, features));
            case 'hole':
                return kernel.hole(oc, bodies, feature, sketchOf(feature, byId, features));
            case 'fillet':
                return kernel.fillet(oc, bodies, feature);
            case 'chamfer':
                return kernel.chamfer(oc, bodies, feature);
            case 'shell':
                return kernel.shell(oc, bodies, feature);
            case 'pattern':
            case 'mirror':
                return kernel.pattern(oc, bodies, feature, sourcesOf(feature, byId, features));
            case 'import':
                return bodies.concat(kernel.importSTEP(oc, feature.data || ''));
            default:
                throw new Error('This version cannot build a "' + feature.type + '" feature');
        }
    }

    // Replay the features in order, stopping before feature `upto` when given.
    // Returns { bodies: [shape], report, entries: Map, reused }.
    function replay(doc, upto) {
        const features = (doc && doc.features) || [];
        const byId = {};
        const entries = new Map();
        const report = {};
        const frames = {};  // sketch or work plane id -> where its face is now
        let bodies = [];
        let key = 2166136261;
        let reused = 0;
        for (let i = 0; i < features.length; i++) {
            const feature = features[i];
            if (upto && feature.id === upto) {
                break;
            }
            // A feature depends on what came before it, which the running hash covers
            key = hash(geometryKey(feature), key);
            byId[feature.id] = feature;
            let entry = cache.get(key);
            if (entry) {
                reused++;
            } else if (feature.suppressed) {
                entry = { bodies: bodies, status: { status: 'suppressed' } };
            } else {
                try {
                    entry = { bodies: applyFeature(feature, bodies, byId, features), status: { status: 'ok' } };
                } catch (err) {
                    // OpenCascade throws WebAssembly.Exception without a message
                    const message = err && err.message ? err.message : 'The geometry kernel could not build this feature';
                    entry = { bodies: bodies, status: { status: 'error', message: message } };
                }
            }
            // A sketch or work plane on a face follows that face (found on the
            // solids before it). Worked out with the entry, so a cached entry
            // still knows it; told to profile.js, so everything after sees it.
            const facePlane = facePlaneOf(feature);
            if (facePlane && !entry.followed) {
                entry.followed = true;
                try {
                    entry.frame = kernel.followFace(oc, bodies, facePlane);
                } catch (err) {
                    entry.frame = null;
                }
            }
            if (facePlane && entry.frame) {
                resolveFace(facePlane, entry.frame);
                frames[feature.id] = entry.frame;
            }
            entries.set(key, entry);
            report[feature.id] = entry.status;
            bodies = entry.bodies;
        }
        return { bodies: bodies, report: report, entries: entries, reused: reused, byId: byId, frames: frames };
    }

    function describeAll(bodies) {
        return bodies.map(function (shape) {
            return kernel.describe(oc, shape);
        });
    }

    // Full rebuild: { bodies: [description], features: { id: { status, message } }, reused }
    function rebuild(doc) {
        const run = replay(doc, null);
        // Drop what the current document no longer reaches, and free its shapes
        const alive = new Set();
        run.entries.forEach(function (entry) {
            entry.bodies.forEach(function (shape) {
                alive.add(shape);
            });
        });
        const freed = new Set();
        cache.forEach(function (entry) {
            entry.bodies.forEach(function (shape) {
                if (!alive.has(shape) && !freed.has(shape)) {
                    freed.add(shape);
                    shape.delete();
                }
            });
        });
        cache = run.entries;
        latest = run.bodies;
        return { bodies: describeAll(run.bodies), features: run.report, reused: run.reused, frames: run.frames };
    }

    // The solids as they are just before feature `upto` (or after the last
    // feature when upto is null). Used to show the model rolled back while a
    // feature is edited, and to try a draft feature. Nothing is dropped from
    // the cache, so the full model is still there afterwards.
    function before(doc, upto) {
        const run = replay(doc, upto);
        run.entries.forEach(function (entry, key) {
            cache.set(key, entry);
        });
        return run;
    }

    return {
        rebuild: rebuild,
        rollback: function (doc, upto) {
            const run = before(doc, upto);
            return { bodies: describeAll(run.bodies), features: run.report, reused: run.reused, frames: run.frames };
        },
        // { bodies: [shape], byId } before feature `upto`
        shapesBefore: function (doc, upto) {
            return before(doc, upto);
        },
        // The solids of the last full rebuild
        bodies: function () {
            return latest;
        }
    };
}

// The transferable buffers of a rebuild result, for postMessage.
export function transferList(result) {
    const list = [];
    result.bodies.forEach(function (body) {
        list.push(body.positions.buffer, body.indices.buffer, body.edgePositions.buffer);
    });
    return list;
}
