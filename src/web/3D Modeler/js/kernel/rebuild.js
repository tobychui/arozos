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
import { withResolvedPlane, resolveFace, resolveWork, axisLine, planeFrame } from './profile.js';
import { projectCurve } from '../sketch/project.js';
import { nameBodies, extrudeRoles, edgeNames } from './naming.js';
import { curve as sketchCurve } from '../sketch/model.js';

// What a work feature follows on the model: a straight edge or a round face
function followOf(feature) {
    const def = feature.def;
    if (!def) {
        return null;
    }
    if (feature.type === 'axis' && def.kind === 'edge' && def.edge) {
        return { edge: def.edge };
    }
    if (((feature.type === 'axis' && def.kind === 'cylinder') || (feature.type === 'plane' && def.kind === 'tangent')) && def.face) {
        return { face: def.face };
    }
    return null;
}

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

// The parts of a feature that change its geometry. Renaming, hiding and
// sharing a sketch must not rebuild.
function geometryKey(feature) {
    if (feature.type === 'mesh') {
        // A reference mesh adds no solid; its (large) data is not hashed
        return 'mesh:' + feature.id + (feature.suppressed ? ':s' : '');
    }
    const copy = Object.assign({}, feature);
    if (feature.type === 'sketch' && Array.isArray(feature.geometry)) {
        // Where projected geometry came from does not change the sketch's
        // shape; keeping it out of the key lets that record be updated
        // without rebuilding what comes after
        copy.geometry = feature.geometry.map(function (g) {
            if (!g.source) {
                return g;
            }
            const clean = Object.assign({}, g);
            delete clean.source;
            return clean;
        });
    }
    delete copy.name;
    delete copy.hidden;
    delete copy.shared;
    return JSON.stringify(copy);
}

// hooks.progress(info), optional: told before each feature that is really
// built (not found in the cache) { step: "feature", index, total, name },
// and before solids are meshed { step: "mesh" }, so a long rebuild can say
// how far it is (worker.js passes it on to the page)
export function createRebuilder(oc, hooks) {
    const progress = hooks && typeof hooks.progress === 'function' ? hooks.progress : function () {};
    let cache = new Map(); // key -> { bodies: [TopoDS_Shape], status }
    let latest = [];       // the solids of the last full rebuild
    // shape -> its description, so a body no feature changed is not meshed
    // again on every rebuild (each call hands out copies: the buffers go to
    // the page as transferables and are gone from here afterwards)
    const described = new Map();

    function sketchOf(feature, byId, features) {
        return sketchById(feature.sketch, byId, features, 'The sketch of this feature no longer exists');
    }

    // A sketch by id, as it is now; `missing` is the message when it is gone
    function sketchById(id, byId, features, missing) {
        const sketch = byId[id];
        if (!sketch || sketch.type !== 'sketch') {
            throw new Error(missing);
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

    function applyFeature(feature, bodies, byId, features, notes) {
        switch (feature.type) {
            case 'sketch':
            case 'plane':
            case 'axis':
            case 'point':
            case 'mesh':
                return bodies; // sketches, work features and reference meshes add no solid
            case 'extrude':
                return kernel.extrude(oc, bodies, withTarget(feature, features), sketchOf(feature, byId, features));
            case 'revolve':
                return kernel.revolve(oc, bodies, withWorkAxis(feature, features), sketchOf(feature, byId, features));
            case 'hole':
                return kernel.hole(oc, bodies, feature, sketchOf(feature, byId, features));
            case 'fillet':
                return kernel.fillet(oc, bodies, feature);
            case 'chamfer':
                return kernel.chamfer(oc, bodies, feature);
            case 'shell':
                return kernel.shell(oc, bodies, feature);
            case 'sweep':
                return kernel.sweep(oc, bodies, feature, sketchOf(feature, byId, features),
                    sketchById(feature.path && feature.path.sketch, byId, features, 'The path sketch of this sweep no longer exists'));
            case 'loft':
                return kernel.loft(oc, bodies, feature, (feature.sections || []).map(function (section) {
                    return sketchById(section.sketch, byId, features, 'A section sketch of this loft no longer exists');
                }));
            case 'draft':
                return kernel.draft(oc, bodies, withFrame(feature, features));
            case 'repair':
                return kernel.repair(oc, bodies, feature, notes);
            case 'pattern':
            case 'mirror':
                return kernel.pattern(oc, bodies, withWorkAxis(feature, features), sourcesOf(feature, byId, features));
            case 'import':
                return bodies.concat(kernel.importSTEP(oc, feature.data || ''));
            default:
                throw new Error('This version cannot build a "' + feature.type + '" feature');
        }
    }

    // A draft gets its neutral plane as it is now: { o, n } or null
    function withFrame(feature, features) {
        const frame = feature.plane ? planeFrame(feature.plane, features) : null;
        return Object.assign({}, feature, { frame: frame ? { o: frame.o, n: frame.n } : null });
    }

    // An extrusion "to" a plane or face gets where that plane is now
    function withTarget(feature, features) {
        const extent = feature.extent;
        if (!extent || extent.type !== 'to') {
            return feature;
        }
        const frame = extent.plane ? planeFrame(extent.plane, features) : null;
        return Object.assign({}, feature, { extent: Object.assign({}, extent, { target: frame ? { o: frame.o, n: frame.n } : null }) });
    }

    // A feature that turns about a work axis, or mirrors in a work plane,
    // gets them as they are now: revolve { axis: { work } } -> { line },
    // pattern { axisRef } -> axis, mirror { planeRef } -> plane
    function withWorkAxis(feature, features) {
        if (feature.type === 'revolve' && feature.axis && feature.axis.work) {
            const line = axisLine({ ref: 'axis', id: feature.axis.work }, features);
            return Object.assign({}, feature, { axis: line ? { work: feature.axis.work, line: line } : { work: feature.axis.work } });
        }
        if (feature.type === 'pattern' && feature.axisRef) {
            const line = axisLine(feature.axisRef, features);
            if (!line) {
                throw new Error('The work axis of this pattern no longer exists');
            }
            const d = feature.axis && feature.axis.d && (feature.axis.d[0] * line.d[0] + feature.axis.d[1] * line.d[1] + feature.axis.d[2] * line.d[2]) < 0 ? -1 : 1;
            return Object.assign({}, feature, { axis: { o: line.o, d: line.d.map(function (c) {
                return c * d;
            }) } });
        }
        if (feature.type === 'mirror' && feature.planeRef) {
            const frame = planeFrame(feature.planeRef, features);
            if (!frame) {
                throw new Error('The work plane of this mirror no longer exists');
            }
            return Object.assign({}, feature, { plane: { o: frame.o, n: frame.n } });
        }
        return feature;
    }

    // Replay the features in order, stopping before feature `upto` when given.
    // Returns { bodies: [shape], report, entries: Map, reused }.
    function replay(doc, upto) {
        const features = (doc && doc.features) || [];
        const byId = {};
        const entries = new Map();
        const report = {};
        const frames = {};  // sketch or work plane id -> where its face is now
        const lines = {};   // work feature id -> the edge or round face it follows, now
        const projections = {}; // sketch id -> projected curves that moved (followProjection)
        let names = [];         // face names of `bodies` (naming.js), one list per body
        let bodies = [];
        let key = 2166136261;
        let reused = 0;
        // The End of Part marker: features after it are not built
        const last = doc && typeof doc.end === 'string' ? (doc.end === '' ? -1 : features.findIndex(function (f) {
            return f.id === doc.end;
        })) : features.length - 1;
        for (let i = 0; i < features.length; i++) {
            const feature = features[i];
            if (upto && feature.id === upto) {
                break;
            }
            if (i > (last < -1 ? features.length : last)) {
                report[feature.id] = { status: 'rolled' };
                continue;
            }
            // A feature depends on what came before it, which the running hash covers
            key = hash(geometryKey(feature), key);
            byId[feature.id] = feature;
            let entry = cache.get(key);
            // References are found by face names first (occt.js findEdges)
            kernel.useNames(names);
            // A face an extrusion goes "to" is found on the solids before it
            const toFace = !entry && feature.extent && feature.extent.type === 'to' && feature.extent.plane &&
                feature.extent.plane.ref === 'face' && feature.extent.plane.face ? feature.extent.plane : null;
            if (toFace) {
                try {
                    resolveFace(toFace, kernel.followFace(oc, bodies, toFace));
                } catch (err) {
                    // where it was picked
                }
            }
            if (entry) {
                reused++;
            } else if (feature.suppressed) {
                entry = { bodies: bodies, status: { status: 'suppressed' } };
            } else {
                progress({ step: 'feature', index: i, total: last < -1 ? features.length : Math.min(features.length, last + 1), name: feature.name || feature.type });
                try {
                    const notes = [];
                    entry = { bodies: applyFeature(feature, bodies, byId, features, notes), status: { status: 'ok' } };
                    if (notes.length) {
                        entry.status.note = notes.join('; ');
                    }
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
            // A work axis on an edge or a round face (or a plane touching
            // one) follows it, found on the solids before it
            const follow = followOf(feature);
            if (follow && !entry.tracked) {
                entry.tracked = true;
                try {
                    entry.line = follow.edge ? kernel.edgeLine(oc, bodies, follow.edge) : kernel.cylinderLine(oc, bodies, follow.face);
                } catch (err) {
                    entry.line = null; // kept where it was made
                }
            }
            if (follow && entry.line) {
                resolveWork(feature, entry.line);
                lines[feature.id] = entry.line;
            }
            // Projected geometry of a sketch: where its model edges are now,
            // on the solids before the sketch (worked out again when the
            // records of where it came from change)
            const sources = feature.type === 'sketch' ? projectedSources(feature) : null;
            if (sources && entry.projectionKey !== sources.key) {
                entry.projectionKey = sources.key;
                entry.projection = followProjection(feature, sources.list, bodies, features);
            }
            if (sources && entry.projection && entry.projection.length) {
                projections[feature.id] = entry.projection;
            }
            // The names of the faces after the feature, once per cache entry
            if (!entry.names) {
                entry.names = entry.bodies === bodies ? names : nameFeature(feature, bodies, names, entry.bodies, byId, features);
            }
            entries.set(key, entry);
            report[feature.id] = entry.status;
            bodies = entry.bodies;
            names = entry.names;
        }
        kernel.useNames(names); // what the next kernel call on these bodies finds references by
        return { bodies: bodies, names: names, report: report, entries: entries, reused: reused, byId: byId, frames: frames, lines: lines, projections: projections };
    }

    // Face names after a feature (naming.js); never fails the rebuild
    function nameFeature(feature, before, beforeNames, after, byId, features) {
        try {
            let roleOf = null;
            if (feature.type === 'extrude' && byId[feature.sketch]) {
                roleOf = extrudeRoles(oc, withResolvedPlane(byId[feature.sketch], features));
            }
            return nameBodies(oc, feature.id, before, beforeNames, after, roleOf, feature.type === 'import');
        } catch (err) {
            return after.map(function () {
                return [];
            });
        }
    }

    // The projected curves of a sketch that know which model edge they came
    // from: { list: [geometry], key } or null
    function projectedSources(sketch) {
        const list = (sketch.geometry || []).filter(function (g) {
            return g.ref && g.source && g.type !== 'point';
        });
        return list.length ? { list: list, key: JSON.stringify(list.map(function (g) {
            return g.source;
        })) } : null;
    }

    // Each projected curve whose edge moved, or whose record of the edge
    // changed: [{ id, source, curve }] (curve: the projection now, in
    // sketch coordinates), or [{ id, lost: true }] when the edge is gone or
    // can no longer be projected onto the sketch plane
    function followProjection(sketch, list, bodies, features) {
        const frame = planeFrame(withResolvedPlane(sketch, features).plane);
        if (!frame) {
            return [];
        }
        const out = [];
        const where = kernel.followEdges(oc, bodies, list.map(function (g) {
            return g.source;
        }));
        list.forEach(function (g, i) {
            const now = where[i];
            let flat = now.found && now.curve ? projectCurve(frame, now.curve) : null;
            if (!flat || flat.type !== g.type) {
                out.push({ id: g.id, lost: true });
                return;
            }
            const was = sketchCurve(sketch, g);
            if (flat.type === 'line' && was && Math.hypot(flat.a[0] - was.b[0], flat.a[1] - was.b[1]) < Math.hypot(flat.a[0] - was.a[0], flat.a[1] - was.a[1])) {
                flat = { type: 'line', a: flat.b, b: flat.a }; // keep the line's own direction
            }
            const source = { body: now.body, mid: now.mid, length: now.length, sig: now.sig };
            const movedSource = !g.source.sig || Math.hypot(g.source.mid[0] - now.mid[0], g.source.mid[1] - now.mid[1], g.source.mid[2] - now.mid[2]) > 1e-9 ||
                Math.abs(g.source.length - now.length) > 1e-9 || g.source.body !== now.body;
            if (!sameCurve(was, flat) || movedSource) {
                out.push({ id: g.id, source: source, curve: sameCurve(was, flat) ? null : flat });
            }
        });
        return out;
    }

    function describeAll(bodies, names) {
        if (bodies.some(function (shape) {
            return !described.has(shape);
        })) {
            progress({ step: 'mesh', total: bodies.length });
        }
        return bodies.map(function (shape, index) {
            let d = described.get(shape);
            if (!d) {
                d = kernel.describe(oc, shape);
                // Each face its name, each edge the names of its two faces
                const faceNames = names && names[index] ? names[index] : [];
                d.faces.forEach(function (face, i) {
                    if (faceNames[i]) {
                        face.name = faceNames[i];
                    }
                });
                edgeNames(d, faceNames).forEach(function (pair, i) {
                    if (pair.length) {
                        d.edges[i].names = pair;
                    }
                });
                described.set(shape, d);
            }
            return Object.assign({}, d, {
                positions: d.positions.slice(),
                indices: d.indices.slice(),
                edgePositions: d.edgePositions.slice()
            });
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
                    described.delete(shape);
                    shape.delete();
                }
            });
        });
        cache = run.entries;
        latest = run.bodies;
        return { bodies: describeAll(run.bodies, run.names), features: run.report, reused: run.reused, frames: run.frames, lines: run.lines, projections: run.projections };
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
            return { bodies: describeAll(run.bodies, run.names), features: run.report, reused: run.reused, frames: run.frames, lines: run.lines, projections: run.projections };
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

// Do a sketch curve (sketch/model.js curve) and a projection match?
const SAME = 1e-7;
function near2(p, q) {
    return Math.abs(p[0] - q[0]) < SAME && Math.abs(p[1] - q[1]) < SAME;
}
function sameCurve(was, flat) {
    if (!was || !flat || was.type !== flat.type) {
        return false;
    }
    if (flat.type === 'line') {
        return near2(was.a, flat.a) && near2(was.b, flat.b);
    }
    if (flat.type === 'circle') {
        return near2(was.c, flat.c) && Math.abs(was.r - flat.r) < SAME;
    }
    return near2(was.c, flat.c) && near2(was.a, flat.a) && near2(was.b, flat.b);
}

// The transferable buffers of a rebuild result, for postMessage.
export function transferList(result) {
    const list = [];
    result.bodies.forEach(function (body) {
        list.push(body.positions.buffer, body.indices.buffer, body.edgePositions.buffer);
    });
    return list;
}
