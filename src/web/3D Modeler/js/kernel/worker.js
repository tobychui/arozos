/*
    3D Modeler - kernel worker

    Module worker that owns the OpenCascade instance. The main thread never
    touches the kernel directly; it sends { id, op, args } and gets back
    { id, ok, result } or { id, ok: false, error }. One unsolicited message,
    { event: "ready" | "failed" }, reports the end of the WASM start-up.

    The single-threaded build is used on purpose: the multi-threaded one needs
    SharedArrayBuffer, which needs cross-origin isolation headers that ArozOS
    does not send.
*/

import initOpenCascade from '../../lib/occt/replicad_single.js';
import * as kernel from './occt.js';
import * as assembly from './assembly.js';
import * as drawing from './drawing.js';
import { createRebuilder, transferList } from './rebuild.js';
import { withResolvedPlane } from './profile.js';

let oc = null;
let rebuilder = null;       // the one the part operations use: the shown part tab's
// One rebuilder per part tab (key "part:<tab id>"), so switching back to a
// tab finds its solids cached
const rebuilders = new Map();
// The parts an assembly uses, each with a rebuilder of its own, so their
// solids stay at hand for measuring and exporting: key -> rebuilder
const parts = new Map();

// Components of an assembly ([{ id, part, matrix }]) with their part's solids
function components(list) {
    return (list || []).map(function (comp) {
        const part = parts.get(comp.part);
        if (!part) {
            throw new Error('A part of the assembly is not loaded');
        }
        return { id: comp.id, shapes: part.bodies(), matrix: comp.matrix };
    });
}

function meshTransfer(list) {
    return [].concat.apply([], list.map(function (m) {
        return [m.positions.buffer, m.indices.buffer].concat(m.edgePositions ? [m.edgePositions.buffer] : []);
    }));
}
const started = performance.now();

const ready = initOpenCascade().then(function (module) {
    oc = module;
    rebuilder = createRebuilder(oc);
    rebuilders.set('default', rebuilder);
    self.postMessage({ event: 'ready', ms: Math.round(performance.now() - started) });
}).catch(function (err) {
    self.postMessage({ event: 'failed', error: String(err && err.message ? err.message : err) });
    throw err;
});

const operations = {
    // Make the rebuilder of a part tab the current one (made on first use)
    useRebuilder: function (args) {
        if (!rebuilders.has(args.key)) {
            rebuilders.set(args.key, createRebuilder(oc));
        }
        rebuilder = rebuilders.get(args.key);
        return { result: { rebuilders: rebuilders.size } };
    },

    // A part tab was closed: free its solids
    dropRebuilder: function (args) {
        const r = rebuilders.get(args.key);
        if (r && args.key !== 'default') {
            r.rebuild({ features: [] });
            rebuilders.delete(args.key);
            if (rebuilder === r) {
                rebuilder = rebuilders.get('default');
            }
        }
        return { result: { rebuilders: rebuilders.size } };
    },

    // Replay a document and return its bodies and the state of every feature
    // With args.upto the model is replayed only up to (not including) that
    // feature: what the user sees while editing it.
    rebuild: function (args) {
        const t0 = performance.now();
        const result = args.upto ? rebuilder.rollback(args.document, args.upto) : rebuilder.rebuild(args.document);
        result.ms = Math.round(performance.now() - t0);
        return { result: result, transfer: transferList(result) };
    },

    // The closed regions of one sketch, for picking profiles:
    // [{ triangles: Float32Array (plane coordinates), sample: [u, v], area }]
    regions: function (args) {
        const list = kernel.sketchRegions(oc, args.sketch).map(function (region) {
            return { triangles: region.triangles, sample: region.sample, area: region.area };
        });
        return { result: { regions: list }, transfer: list.map(function (region) {
            return region.triangles.buffer;
        }) };
    },

    // The solid a draft extrude or revolve feature would sweep, for the live preview
    preview: function (args) {
        const make = args.feature.type === 'revolve' ? kernel.revolveTool : kernel.extrudeTool;
        const tool = make(oc, rebuilder.bodies(), args.feature, args.sketch);
        const mesh = kernel.describe(oc, tool);
        tool.delete();
        return {
            result: { positions: mesh.positions, indices: mesh.indices, edgePositions: mesh.edgePositions },
            transfer: [mesh.positions.buffer, mesh.indices.buffer, mesh.edgePositions.buffer]
        };
    },

    // Try a draft feature on the model as it is before feature args.at (or
    // at the end when at is null). Rejects with the reason when it cannot be
    // built. A hole returns the mesh of what would be removed, a fillet or
    // chamfer the meshes of the bodies as they would become, each with
    // `fresh`: the index ranges ([start, count]) of the faces the feature
    // makes, so the preview can pick them out.
    tryFeature: function (args) {
        const state = rebuilder.shapesBefore(args.document, args.at || null);
        const feature = args.feature;
        if (feature.type === 'fillet' || feature.type === 'chamfer' || feature.type === 'shell') {
            // The bodies as they would be with the feature, for the live preview
            const report = { fresh: [] };
            const made = kernel[feature.type](oc, state.bodies, feature, report);
            const meshes = made.map(function (shape, index) {
                const mesh = kernel.describe(oc, shape);
                const flags = report.fresh[index] || [];
                const fresh = [];
                mesh.faces.forEach(function (face, i) {
                    if (flags[i] && face.count) {
                        fresh.push([face.start, face.count]);
                    }
                });
                return { positions: mesh.positions, indices: mesh.indices, edgePositions: mesh.edgePositions, fresh: fresh };
            });
            made.forEach(function (shape) {
                if (state.bodies.indexOf(shape) < 0) {
                    shape.delete();
                }
            });
            return { result: { ok: true, meshes: meshes }, transfer: [].concat.apply([], meshes.map(function (m) {
                return [m.positions.buffer, m.indices.buffer, m.edgePositions.buffer];
            })) };
        }
        if (feature.type === 'pattern' || feature.type === 'mirror') {
            // The copies, drawn as what they add or remove
            const sources = (feature.features || []).map(function (id) {
                const source = state.byId[id];
                if (!source) {
                    throw new Error('A feature to repeat comes after this one or no longer exists');
                }
                return { feature: source, sketch: source.sketch ? withResolvedPlane(state.byId[source.sketch], args.document.features) : null };
            });
            const tools = kernel.patternTools(oc, state.bodies, feature, sources);
            const meshes = tools.map(function (tool) {
                const mesh = kernel.describe(oc, tool.shape);
                tool.shape.delete();
                return { positions: mesh.positions, indices: mesh.indices, edgePositions: mesh.edgePositions, operation: tool.operation };
            });
            return { result: { ok: true, meshes: meshes }, transfer: [].concat.apply([], meshes.map(function (m) {
                return [m.positions.buffer, m.indices.buffer, m.edgePositions.buffer];
            })) };
        }
        if (feature.type === 'hole') {
            const tool = kernel.holeTool(oc, state.bodies, feature, args.sketch);
            const mesh = kernel.describe(oc, tool);
            tool.delete();
            return {
                result: { ok: true, mesh: { positions: mesh.positions, indices: mesh.indices, edgePositions: mesh.edgePositions } },
                transfer: [mesh.positions.buffer, mesh.indices.buffer, mesh.edgePositions.buffer]
            };
        }
        throw new Error('This feature cannot be previewed');
    },

    // Face references (Shell) with their surface keys added, or resolved to
    // where the faces are now, as edgeRefs does for edges
    faceRefs: function (args) {
        const state = rebuilder.shapesBefore(args.document, args.at || null);
        return { result: { refs: kernel.describeFaceRefs(oc, state.bodies, args.faces, !!args.resolve) } };
    },

    // Edge references with their descriptions added (for a feature about to
    // be stored), or resolved to where the edges are now (for editing one),
    // on the model as it is before feature args.at
    edgeRefs: function (args) {
        const state = rebuilder.shapesBefore(args.document, args.at || null);
        return { result: { refs: args.resolve ? kernel.resolveEdges(oc, state.bodies, args.edges) : kernel.describeEdgeRefs(oc, state.bodies, args.edges) } };
    },

    // The tangent chains of the edges of the model as it is before feature
    // args.at (or at the end), per body: see edgeChains in occt.js
    edgeChains: function (args) {
        const state = rebuilder.shapesBefore(args.document, args.at || null);
        return {
            result: {
                chains: state.bodies.map(function (body) {
                    return kernel.edgeChains(oc, body, kernel.describe(oc, body).edges);
                })
            }
        };
    },

    // The whole part as the text of a STEP or BREP file
    exportText: function (args) {
        return { result: { text: kernel.exportText(oc, rebuilder.bodies(), args.format) } };
    },

    // The part as triangles at a chosen fineness, for STL / OBJ / 3MF
    mesh: function (args) {
        const list = rebuilder.bodies().map(function (shape) {
            oc.BRepTools.Clean(shape, true);
            const mesh = kernel.describe(oc, shape, args.deflection || 0.05, args.angle || 0.2);
            return { positions: mesh.positions, indices: mesh.indices };
        });
        return { result: { bodies: list }, transfer: [].concat.apply([], list.map(function (m) {
            return [m.positions.buffer, m.indices.buffer];
        })) };
    },

    // How many solids a STEP file holds (rejects when it cannot be read)
    importInfo: function (args) {
        const solids = kernel.importSTEP(oc, args.text);
        const count = solids.length;
        return { result: { solids: count } };
    },

    massProperties: function () {
        return { result: kernel.massProperties(oc, rebuilder.bodies()) };
    },

    // Shortest distance between two picked faces or edges, with the two
    // closest points: { distance, p1, p2 }
    distance: function (args) {
        return { result: kernel.closestBetween(oc, rebuilder.bodies(), args.a, args.b) };
    },

    /* ---- assemblies ---- */
    // Build (or rebuild) a part an assembly uses, kept under args.key.
    // Same result as rebuild: { bodies, features }
    partBuild: function (args) {
        let part = parts.get(args.key);
        if (!part) {
            part = createRebuilder(oc);
            parts.set(args.key, part);
        }
        const result = part.rebuild(args.document);
        return { result: result, transfer: transferList(result) };
    },

    // Forget parts no longer used (args.keep: the keys still in use) among
    // those whose key starts with args.prefix ("asm" for the assembly,
    // "drw" for the drawing), so one environment never drops the other's
    partDrop: function (args) {
        const keep = new Set(args.keep || []);
        const prefix = args.prefix || '';
        parts.forEach(function (part, key) {
            if (!keep.has(key) && key.indexOf(prefix) === 0) {
                part.rebuild({ features: [] }); // frees its shapes
                parts.delete(key);
            }
        });
        return { result: { parts: parts.size } };
    },

    // Shortest distance between two items of components: { distance, p1, p2 }
    // a, b: { part, matrix, item }
    asmDistance: function (args) {
        const ref = function (r) {
            const comp = components([{ id: 'x', part: r.part, matrix: r.matrix }])[0];
            return { shapes: comp.shapes, matrix: r.matrix, item: r.item };
        };
        return { result: assembly.distance(oc, ref(args.a), ref(args.b)) };
    },

    // Overlapping components: [{ a, b, volume, mesh }]
    asmInterference: function (args) {
        const found = assembly.interference(oc, components(args.components));
        const list = found.map(function (f) {
            return { a: f.a, b: f.b, volume: f.volume, mesh: { positions: f.mesh.positions, indices: f.mesh.indices, edgePositions: f.mesh.edgePositions } };
        });
        return { result: { found: list }, transfer: meshTransfer(list.map(function (f) {
            return f.mesh;
        })) };
    },

    asmExport: function (args) {
        return { result: { text: assembly.exportText(oc, components(args.components), args.format) } };
    },

    asmMass: function (args) {
        return { result: assembly.mass(oc, components(args.components)) };
    },

    asmMesh: function (args) {
        const list = assembly.mesh(oc, components(args.components), args.deflection, args.angle);
        return { result: { bodies: list }, transfer: meshTransfer(list) };
    },

    /* ---- drawings ---- */
    // The hidden line projection of a drawing view (see drawing.js).
    // args.items: [{ key, matrix, faces }] parts built with partBuild,
    // placed by matrix (null: as they are); faces, when given, are the only
    // faces drawn ([{ body, index }]). args.dir, xdir, hidden, smooth,
    // deflection as drawing.project takes them.
    drwProject: function (args) {
        const temporary = [];
        try {
            const items = (args.items || []).map(function (it) {
                const part = parts.get(it.key);
                if (!part) {
                    throw new Error('A model of the drawing is not loaded');
                }
                const bodies = part.bodies();
                let shapes = bodies;
                if (it.faces) {
                    shapes = it.faces.map(function (f) {
                        const face = kernel.itemShape(oc, bodies, { type: 'face', body: f.body, index: f.index });
                        temporary.push(face);
                        return face;
                    });
                }
                return { shapes: shapes, matrix: it.matrix || null };
            });
            return { result: drawing.project(oc, items, args) };
        } finally {
            temporary.forEach(function (shape) {
                shape.delete();
            });
        }
    },

    // Build the reference part and return its mesh plus a few numbers that
    // show every stage (boolean, fillet, meshing, STEP writer) ran.
    selftest: function () {
        const t0 = performance.now();
        const body = kernel.selfTestShape(oc);
        const buildMs = performance.now() - t0;
        const mesh = kernel.describe(oc, body);
        const stats = {
            buildMs: Math.round(buildMs),
            faces: mesh.faces.length,
            triangles: mesh.indices.length / 3,
            volume: mesh.volume,
            stepBytes: kernel.toSTEP(oc, body).length
        };
        body.delete();
        return {
            result: { bodies: [mesh], stats: stats },
            transfer: [mesh.positions.buffer, mesh.indices.buffer, mesh.edgePositions.buffer]
        };
    }
};

self.onmessage = function (event) {
    const msg = event.data || {};
    ready.then(function () {
        const op = operations[msg.op];
        if (!op) {
            throw new Error('Unknown kernel operation: ' + msg.op);
        }
        const out = op(msg.args || {});
        self.postMessage({ id: msg.id, ok: true, result: out.result }, out.transfer || []);
    }).catch(function (err) {
        // OpenCascade failures surface as WebAssembly.Exception without a message
        const text = err && err.message ? err.message : 'The geometry kernel could not complete the operation';
        self.postMessage({ id: msg.id, ok: false, error: text });
    });
};
