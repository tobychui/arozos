/*
    3D Modeler - checking and repairing solids

    Three jobs, all about solids that look broken (holes in the mesh, cracks,
    slicers calling the export "non-manifold"):

    - safeBoolean: every join, cut and intersect goes through here. The
      operation never changes its inputs (they are cached results of earlier
      features), is checked afterwards, and is tried again with a small fuzzy
      tolerance when the first result is not a valid closed solid.
    - checkShape / edgeUse: what is wrong with a shape - invalid topology,
      open edges (a face missing), edges where the solid touches itself with
      no thickness (more than two faces on one edge).
    - heal: the Repair feature. Faces fixed one by one, sewn back together,
      closed into solids, oriented, merged; kept only when better than what
      went in.
    - fallbackTriangles: the mesh of a face the mesher gave up on, so the
      view never shows a hole where a face is.

    Like occt.js, every embind object made here is released with .delete().
*/

import { triangulate, signedArea } from './earclip.js';

function round(v) {
    return Math.round(v * 1e5);
}

// The explorer's current shape as a face, edge, shell... (the copy
// Current() hands back is released)
function current(oc, explorer, cast) {
    const shape = explorer.Current();
    const out = oc.TopoDS[cast](shape);
    shape.delete();
    return out;
}

function points(oc, curve, params) {
    return params.map(function (t) {
        const p = curve.Value(t);
        const out = [p.X(), p.Y(), p.Z()];
        p.delete();
        return out;
    });
}

// Where an edge is: a key from its ends (either order) and its middle, and
// the middle itself. The same edge always gives the same key.
function edgePlace(oc, edge) {
    const curve = new oc.BRepAdaptor_Curve(edge);
    const f = curve.FirstParameter();
    const l = curve.LastParameter();
    const p = points(oc, curve, [f, (f + l) / 2, l]);
    curve.delete();
    const k = function (q) {
        return q.map(round).join(',');
    };
    const a = k(p[0]);
    const b = k(p[2]);
    return { key: (a < b ? a + '|' + b : b + '|' + a) + '|' + k(p[1]), mid: p[1] };
}

// How many faces use each edge. A closed solid has every edge between two
// faces; an edge on one face only is open (a face is missing), on three or
// more the solid touches itself there with no thickness. Edges are told
// apart by identity, not only position: two edges in the same place that
// were never joined are both open.
// Returns { open: [mid], multiple: [mid], edges: n }
export function edgeUse(oc, shape) {
    const buckets = new Map();
    const all = [];
    const faces = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE);
    for (; faces.More(); faces.Next()) {
        const face = current(oc, faces, 'Face');
        const edges = new oc.TopExp_Explorer(face, oc.TopAbs_ShapeEnum.TopAbs_EDGE);
        for (; edges.More(); edges.Next()) {
            const edge = current(oc, edges, 'Edge');
            if (oc.BRep_Tool.Degenerated(edge)) {
                edge.delete();
                continue;
            }
            const place = edgePlace(oc, edge);
            let list = buckets.get(place.key);
            if (!list) {
                list = [];
                buckets.set(place.key, list);
            }
            const entry = list.find(function (e) {
                return e.edge.IsSame(edge);
            });
            if (entry) {
                entry.uses++;
                edge.delete();
            } else {
                const made = { edge: edge, uses: 1, mid: place.mid };
                list.push(made);
                all.push(made);
            }
        }
        edges.delete();
        face.delete();
    }
    faces.delete();
    const out = { open: [], multiple: [], edges: all.length };
    all.forEach(function (e) {
        if (e.uses === 1) {
            out.open.push(e.mid);
        } else if (e.uses > 2) {
            out.multiple.push(e.mid);
        }
        e.edge.delete();
    });
    return out;
}

export function isValid(oc, shape) {
    const analyzer = new oc.BRepCheck_Analyzer(shape, true, false, false);
    const valid = analyzer.IsValid();
    analyzer.delete();
    return valid;
}

function count(oc, shape, kind) {
    let n = 0;
    const explorer = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum[kind]);
    for (; explorer.More(); explorer.Next()) {
        n++;
    }
    explorer.delete();
    return n;
}

// Everything checkShape and the Repair feature look at:
// { valid, solids, shells, faces, open: [mid], multiple: [mid] }
export function checkShape(oc, shape) {
    const use = edgeUse(oc, shape);
    return {
        valid: isValid(oc, shape),
        solids: count(oc, shape, 'TopAbs_SOLID'),
        shells: count(oc, shape, 'TopAbs_SHELL'),
        faces: count(oc, shape, 'TopAbs_FACE'),
        open: use.open,
        multiple: use.multiple
    };
}

// A check as counts, small enough to send to the page:
// { valid, solids, open, multiple, unmeshed }
export function summary(report) {
    return {
        valid: report.valid,
        solids: report.solids,
        open: report.open.length,
        multiple: report.multiple.length,
        unmeshed: report.unmeshed || 0
    };
}

/* ---------------- booleans ---------------- */

function runBoolean(oc, kind, a, b, fuzzy) {
    const Op = kind === 'cut' ? oc.BRepAlgoAPI_Cut : kind === 'intersect' ? oc.BRepAlgoAPI_Common : oc.BRepAlgoAPI_Fuse;
    const op = new Op();
    const args = new oc.NCollection_List_TopoDS_Shape([a]);
    const tools = new oc.NCollection_List_TopoDS_Shape([b]);
    const progress = new oc.Message_ProgressRange();
    let shape = null;
    try {
        op.SetArguments(args);
        op.SetTools(tools);
        // The inputs are the cached results of earlier features (and the
        // same shapes again on the next preview): the operation must not
        // touch their tolerances, or the next run differs from this one
        op.SetNonDestructive(true);
        if (fuzzy) {
            op.SetFuzzyValue(fuzzy);
        }
        op.Build(progress);
        if (op.IsDone() && !op.HasErrors()) {
            shape = op.Shape();
        }
    } catch (err) {
        shape = null; // the kernel throws without a message on bad input
    }
    [progress, tools, args, op].forEach(function (o) {
        o.delete();
    });
    return shape;
}

// Merge faces that ended up on the same surface, so no seam lines stay behind
function unify(oc, shape) {
    try {
        const maker = new oc.ShapeUpgrade_UnifySameDomain(shape, true, true, false);
        maker.Build();
        const out = maker.Shape();
        maker.delete();
        return out;
    } catch (err) {
        return shape;
    }
}

// A result fit to keep: valid topology and no face missing
function sound(oc, shape) {
    if (!isValid(oc, shape)) {
        return false;
    }
    return edgeUse(oc, shape).open.length === 0;
}

// Join ("join"), cut or intersect two shapes. Tried as given first; when the
// result is not a sound solid, again with a small fuzzy tolerance (it lets
// faces a hair apart count as touching, which is what broke), and the face
// merging is skipped if it is what spoilt the result. When nothing comes out
// sound the first result is kept, as before.
export function safeBoolean(oc, kind, a, b) {
    let fallback = null;
    const fuzzies = [0, 1e-5, 1e-4];
    for (let i = 0; i < fuzzies.length; i++) {
        const raw = runBoolean(oc, kind, a, b, fuzzies[i]);
        if (!raw) {
            continue;
        }
        const merged = unify(oc, raw);
        if (sound(oc, merged)) {
            return merged;
        }
        if (merged !== raw && sound(oc, raw)) {
            return raw;
        }
        if (!fallback) {
            fallback = merged;
        }
    }
    if (!fallback) {
        throw new Error('The boolean operation failed');
    }
    return fallback;
}

// The edges where a solid touches itself with no thickness, as a sentence the
// user can act on, or null. A join of a profile that only touches the solid
// along a line (a box against a cylinder), or a cut that leaves a wall of
// zero thickness, makes such an edge: OpenCascade builds it, but 3D printing
// and other programs reject the mesh as non-manifold.
export function zeroThickness(oc, shape) {
    const use = edgeUse(oc, shape);
    if (!use.multiple.length) {
        return null;
    }
    const at = use.multiple[0].map(function (v) {
        return +v.toFixed(2);
    }).join(', ');
    return { count: use.multiple.length, at: use.multiple[0], message: 'The result would touch itself with zero thickness along ' +
        (use.multiple.length === 1 ? 'an edge' : use.multiple.length + ' edges') + ' (near ' + at + '), which makes a non-manifold solid. ' +
        'Make the shapes overlap, or leave a gap between them' };
}

/* ---------------- repair ---------------- */

function volumeOf(oc, shape) {
    const props = new oc.GProp_GProps();
    oc.BRepGProp.VolumeProperties(shape, props, false, false, false);
    const v = props.Mass();
    props.delete();
    return v;
}

function faceArea(oc, face) {
    const props = new oc.GProp_GProps();
    oc.BRepGProp.SurfaceProperties(face, props, false, false);
    const a = props.Mass();
    props.delete();
    return a;
}

function faceLength(oc, face) {
    const props = new oc.GProp_GProps();
    oc.BRepGProp.LinearProperties(face, props, false, false);
    const l = props.Mass();
    props.delete();
    return l;
}

// How bad a shape is, lower is better
function badness(report, unmeshed) {
    return (report.valid ? 0 : 1000) + report.open.length * 10 + report.multiple.length + (report.solids ? 0 : 500) + (unmeshed || 0) * 100;
}

// Faces the mesher cannot triangulate (counted after a fresh mesh)
export function unmeshedFaces(oc, shape, deflection) {
    oc.BRepTools.Clean(shape, true);
    const mesher = new oc.BRepMesh_IncrementalMesh(shape, deflection || 0.1, false, 0.3, false);
    mesher.delete();
    let n = 0;
    const explorer = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE);
    for (; explorer.More(); explorer.Next()) {
        const face = current(oc, explorer, 'Face');
        const location = new oc.TopLoc_Location();
        const tri = oc.BRep_Tool.Triangulation(face, location, 0);
        const ok = tri && !(tri.IsNull && tri.IsNull()) && tri.NbTriangles() > 0;
        if (!ok && faceArea(oc, face) > 1e-9) {
            n++;
        }
        location.delete();
        face.delete();
    }
    explorer.delete();
    return n;
}

// Rebuild a shape from its faces: fix each face, drop slivers thinner than
// the tolerance, sew, close the shells into solids and orient them.
function rebuildFromFaces(oc, shape, tolerance, notes) {
    const sewing = new oc.BRepBuilderAPI_Sewing(tolerance, true, true, true, false);
    let fixedFaces = 0;
    let slivers = 0;
    const explorer = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE);
    for (; explorer.More(); explorer.Next()) {
        const face = current(oc, explorer, 'Face');
        const area = faceArea(oc, face);
        const length = faceLength(oc, face);
        // A face whose width (area over half its boundary) is under the
        // tolerance is a sliver left by faces that almost met
        if (length > 0 && area * 2 / length < tolerance) {
            slivers++;
            face.delete();
            continue;
        }
        let out = face;
        try {
            const fixer = new oc.ShapeFix_Face(face);
            fixer.SetPrecision(tolerance / 10);
            fixer.SetMaxTolerance(tolerance);
            const progress = new oc.Message_ProgressRange();
            if (fixer.Perform(progress)) {
                out = fixer.Face();
                fixedFaces++;
            }
            progress.delete();
            fixer.delete();
        } catch (err) {
            out = face;
        }
        sewing.Add(out);
        face.delete();
    }
    explorer.delete();
    const progress = new oc.Message_ProgressRange();
    sewing.Perform(progress);
    progress.delete();
    const sewn = sewing.SewedShape();
    sewing.delete();
    if (fixedFaces) {
        notes.push(fixedFaces + (fixedFaces === 1 ? ' face' : ' faces') + ' fixed');
    }
    if (slivers) {
        notes.push(slivers + ' sliver' + (slivers === 1 ? '' : 's') + ' removed');
    }

    const builder = new oc.TopoDS_Builder();
    const compound = new oc.TopoDS_Compound();
    builder.MakeCompound(compound);
    let solids = 0;
    const shells = new oc.TopExp_Explorer(sewn, oc.TopAbs_ShapeEnum.TopAbs_SHELL);
    for (; shells.More(); shells.Next()) {
        const shell = current(oc, shells, 'Shell');
        let solid = null;
        try {
            const maker = new oc.BRepBuilderAPI_MakeSolid(shell);
            solid = maker.Solid();
            maker.delete();
            const fixer = new oc.ShapeFix_Solid(solid);
            fixer.SetPrecision(tolerance / 10);
            fixer.SetMaxTolerance(tolerance);
            const fixProgress = new oc.Message_ProgressRange();
            fixer.Perform(fixProgress);
            fixProgress.delete();
            const fixed = fixer.Solid();
            fixer.delete();
            solid.delete();
            solid = oc.TopoDS.Solid(fixed);
            oc.BRepLib.OrientClosedSolid(solid);
        } catch (err) {
            solid = null;
        }
        if (solid) {
            builder.Add(compound, solid);
            solids++;
        }
        shell.delete();
    }
    shells.delete();
    builder.delete();
    return solids ? compound : null;
}

// The Repair feature on one shape: { shape, changed, notes, before, after }.
// `before` and `after` are checkShape reports plus `unmeshed` (faces the
// mesher could not triangulate). The repaired shape is only taken when it
// is better than the one given and holds about the same volume.
export function heal(oc, shape, tolerance) {
    const tol = tolerance > 0 ? tolerance : 1e-3;
    const before = checkShape(oc, shape);
    before.unmeshed = unmeshedFaces(oc, shape);
    const volume = Math.abs(volumeOf(oc, shape));
    let best = { shape: shape, report: before, score: badness(before, before.unmeshed), notes: [] };

    const consider = function (candidate, notes) {
        if (!candidate) {
            return;
        }
        const report = checkShape(oc, candidate);
        report.unmeshed = unmeshedFaces(oc, candidate);
        const v = Math.abs(volumeOf(oc, candidate));
        const keepsVolume = volume < 1e-9 || Math.abs(v - volume) <= Math.max(1e-6, volume * 2e-3);
        const score = badness(report, report.unmeshed);
        if (keepsVolume && score < best.score) {
            best = { shape: candidate, report: report, score: score, notes: notes };
        }
    };

    if (best.score > 0) {
        const notes = [];
        const rebuilt = rebuildFromFaces(oc, shape, tol, notes);
        consider(rebuilt, notes);
        if (rebuilt) {
            consider(unify(oc, rebuilt), notes.concat(['faces on one surface merged']));
        }
    }
    if (best.score > 0) {
        // Faces a hair apart: sew with ten times the tolerance as a last try
        const notes = [];
        consider(rebuildFromFaces(oc, shape, tol * 10, notes), notes.concat(['sewn with ' + +(tol * 10).toPrecision(3) + ' mm']));
    }
    const notes = best.notes.slice();
    if (best.report.multiple.length) {
        notes.push(best.report.multiple.length + (best.report.multiple.length === 1 ? ' edge' : ' edges') + ' with zero thickness left: these need a change in the model');
    }
    return { shape: best.shape, changed: best.shape !== shape, notes: notes, before: before, after: best.report };
}

/* ---------------- a mesh for a face the mesher gave up on ---------------- */

// The parameters along `edge` at which a neighbouring face's mesh has its
// nodes, so the patched face meets it without cracks; null if no neighbour
// was meshed
function neighbourParams(oc, shape, face, edge) {
    let found = null;
    const faces = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE);
    for (; faces.More() && !found; faces.Next()) {
        const other = current(oc, faces, 'Face');
        if (other.IsSame(face)) {
            other.delete();
            continue;
        }
        const location = new oc.TopLoc_Location();
        const tri = oc.BRep_Tool.Triangulation(other, location, 0);
        if (tri && !(tri.IsNull && tri.IsNull()) && tri.NbTriangles() > 0) {
            const edges = new oc.TopExp_Explorer(other, oc.TopAbs_ShapeEnum.TopAbs_EDGE);
            for (; edges.More() && !found; edges.Next()) {
                const e = current(oc, edges, 'Edge');
                if (e.IsSame(edge)) {
                    try {
                        const polygon = oc.BRep_Tool.PolygonOnTriangulation(e, tri, location);
                        if (polygon && !(polygon.IsNull && polygon.IsNull()) && polygon.HasParameters()) {
                            found = [];
                            for (let i = 1; i <= polygon.NbNodes(); i++) {
                                found.push(polygon.Parameter(i));
                            }
                        }
                    } catch (err) {
                        found = null;
                    }
                }
                e.delete();
            }
            edges.delete();
        }
        location.delete();
        other.delete();
    }
    faces.delete();
    return found && found.length > 1 ? found : null;
}

// Parameters along an edge at the given fineness
function sampleParams(oc, edge, deflection) {
    if (oc.BRep_Tool.Degenerated(edge)) {
        return null;
    }
    const curve = new oc.BRepAdaptor_Curve(edge);
    const sampler = new oc.GCPnts_TangentialDeflection(curve, 0.3, deflection);
    const out = [];
    for (let i = 1; i <= sampler.NbPoints(); i++) {
        out.push(sampler.Parameter(i));
    }
    sampler.delete();
    curve.delete();
    return out.length > 1 ? out : null;
}

// Join the pieces of one wire (lists of [u, v], each in its own direction)
// into a loop: next is always the piece whose start is nearest the end
function chain(pieces) {
    const left = pieces.slice();
    const loop = left.shift().slice();
    while (left.length) {
        const end = loop[loop.length - 1];
        let best = 0;
        let flip = false;
        let d = Infinity;
        left.forEach(function (piece, i) {
            const ds = Math.hypot(piece[0][0] - end[0], piece[0][1] - end[1]);
            const de = Math.hypot(piece[piece.length - 1][0] - end[0], piece[piece.length - 1][1] - end[1]);
            if (ds < d) {
                d = ds;
                best = i;
                flip = false;
            }
            if (de < d) {
                d = de;
                best = i;
                flip = true;
            }
        });
        const next = left.splice(best, 1)[0];
        const ordered = flip ? next.slice().reverse() : next;
        ordered.forEach(function (p, i) {
            if (i > 0 || Math.hypot(p[0] - end[0], p[1] - end[1]) > 1e-12) {
                loop.push(p);
            }
        });
    }
    return loop;
}

// The triangles of a face OpenCascade could not mesh, in the format of
// faceTriangles in occt.js ({ points: [x, y, z, ...], tris }), or null.
// The boundary is followed in the surface's (u, v) space, using the node
// positions of the neighbouring faces' meshes where there are any, cut into
// triangles by ear clipping and lifted onto the surface. Flat inside, so a
// curved face comes out coarse, but the hole is closed.
export function fallbackTriangles(oc, shape, face, deflection) {
    const loops = [];
    const wires = new oc.TopExp_Explorer(face, oc.TopAbs_ShapeEnum.TopAbs_WIRE);
    for (; wires.More(); wires.Next()) {
        const wire = wires.Current();
        const pieces = [];
        const edges = new oc.TopExp_Explorer(wire, oc.TopAbs_ShapeEnum.TopAbs_EDGE);
        for (; edges.More(); edges.Next()) {
            const edge = current(oc, edges, 'Edge');
            try {
                const curve2d = new oc.BRepAdaptor_Curve2d(edge, face);
                let params = neighbourParams(oc, shape, face, edge) || sampleParams(oc, edge, deflection);
                if (!params) {
                    const f = curve2d.FirstParameter();
                    const l = curve2d.LastParameter();
                    params = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(function (k) {
                        return f + (l - f) * k / 8;
                    });
                }
                const uv = params.map(function (t) {
                    const p = curve2d.Value(t);
                    const out = [p.X(), p.Y()];
                    p.delete();
                    return out;
                });
                curve2d.delete();
                if (edge.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED) {
                    uv.reverse();
                }
                pieces.push(uv);
            } catch (err) {
                // an edge with no curve on this face: leave it out
            }
            edge.delete();
        }
        edges.delete();
        wire.delete();
        if (pieces.length) {
            loops.push(chain(pieces));
        }
    }
    wires.delete();
    if (!loops.length) {
        return null;
    }
    // The outline is the loop that encloses the most
    let outer = 0;
    loops.forEach(function (loop, i) {
        if (Math.abs(signedArea(loop)) > Math.abs(signedArea(loops[outer]))) {
            outer = i;
        }
    });
    const flat = triangulate(loops[outer], loops.filter(function (l, i) {
        return i !== outer;
    }));
    if (!flat.tris.length) {
        return null;
    }
    const surface = new oc.BRepAdaptor_Surface(face, true);
    const pointsOut = [];
    flat.points.forEach(function (p) {
        const q = surface.Value(p[0], p[1]);
        pointsOut.push(q.X(), q.Y(), q.Z());
        q.delete();
    });
    surface.delete();
    // Counter clockwise in (u, v) faces along the surface normal, as the
    // mesher's own triangles do; a reversed face turns them round
    const flip = face.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED;
    const tris = [];
    for (let i = 0; i < flat.tris.length; i += 3) {
        if (flip) {
            tris.push(flat.tris[i], flat.tris[i + 2], flat.tris[i + 1]);
        } else {
            tris.push(flat.tris[i], flat.tris[i + 1], flat.tris[i + 2]);
        }
    }
    return { points: pointsOut, tris: tris };
}
