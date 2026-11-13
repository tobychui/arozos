/*
    3D Modeler - kernel operations

    Everything that touches the OpenCascade bindings lives here, as plain
    functions taking the initialised module `oc`. rebuild.js and worker.js are
    the only callers in the browser; the same file runs under Node for tests.

    Embind objects are not garbage collected. Every object made here that does
    not leave the function is released with .delete() - keep it that way, a
    long modelling session otherwise leaks the WASM heap. Shapes handed back to
    the caller are the caller's to release.
*/

import { planeFrame, toWorld } from './profile.js';
import { curves as sketchCurves, holePoints } from '../sketch/model.js';
import { sample } from '../sketch/geom.js';

// The triangles of one meshed face in world coordinates:
// { points: [x, y, z, ...], tris: [a, b, c, ...] } with outward winding.
function faceTriangles(oc, face) {
    const points = [];
    const tris = [];
    const location = new oc.TopLoc_Location();
    const tri = oc.BRep_Tool.Triangulation(face, location, 0);
    if (tri && !(tri.IsNull && tri.IsNull())) {
        const identity = location.IsIdentity();
        const trsf = identity ? null : location.Transformation();
        const nodeCount = tri.NbNodes();
        for (let i = 1; i <= nodeCount; i++) {
            const local = tri.Node(i);
            if (identity) {
                points.push(local.X(), local.Y(), local.Z());
            } else {
                const world = local.Transformed(trsf);
                points.push(world.X(), world.Y(), world.Z());
                world.delete();
            }
            local.delete();
        }
        const flip = face.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED;
        const triCount = tri.NbTriangles();
        for (let i = 1; i <= triCount; i++) {
            const t = tri.Triangle(i);
            const a = t.Value(1) - 1;
            const b = t.Value(2) - 1;
            const c = t.Value(3) - 1;
            if (flip) {
                tris.push(a, c, b);
            } else {
                tris.push(a, b, c);
            }
            t.delete();
        }
        if (trsf) {
            trsf.delete();
        }
    }
    location.delete();
    return { points: points, tris: tris };
}

// Describe a body for the viewport: the mesh, the exact edges and what each
// face and edge is. Returns
//   positions  Float32Array   mesh vertices
//   indices    Uint32Array    triangles; faces[i] owns indices [start, start + count)
//   faces      [{ start, count, type, area, origin?, normal?, edges }]
//                type is "plane", "cylinder" or "other"; a plane carries a
//                point on it and its outward normal; edges lists the
//                indices of the edges around the face
//   edgePositions Float32Array line segments (two vertices each); edges[i]
//                owns vertices [start, start + count)
//   edges      [{ start, count, length, curve, mid }]
//                mid is the point halfway along the edge; with the length it
//                is how a feature remembers an edge (see findEdges)
//                curve is the exact shape when it is a straight line
//                ({ type: "line", a, b }) or part of a circle ({ type:
//                "circle", c, r, n, a, b, closed }: centre, radius, axis,
//                and the ends, running counter clockwise about n), else null
//   volume     mm^3
// The index of a face or an edge is its position in TopExp order, which is
// what later milestones resolve references against. Seams and degenerate
// edges are not edges a user can pick and are left out.
export function describe(oc, shape, linearDeflection = 0.1, angularDeflection = 0.3) {
    const mesher = new oc.BRepMesh_IncrementalMesh(shape, linearDeflection, false, angularDeflection, false);
    mesher.delete();

    const positions = [];
    const indices = [];
    const faces = [];
    const edgePositions = [];
    const edges = [];
    const reversed = oc.TopAbs_Orientation.TopAbs_REVERSED;
    const seen = new Map(); // geometric key of an edge -> its index

    const explorer = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE);
    for (; explorer.More(); explorer.Next()) {
        const face = oc.TopoDS.Face(explorer.Current());
        const start = indices.length;
        const base = positions.length / 3;
        const mesh = faceTriangles(oc, face);
        for (let i = 0; i < mesh.points.length; i++) {
            positions.push(mesh.points[i]);
        }
        for (let i = 0; i < mesh.tris.length; i++) {
            indices.push(mesh.tris[i] + base);
        }
        const info = faceInfo(oc, face, face.Orientation() === reversed);
        info.start = start;
        info.count = indices.length - start;
        info.edges = [];
        faces.push(info);

        const edgeExplorer = new oc.TopExp_Explorer(face, oc.TopAbs_ShapeEnum.TopAbs_EDGE);
        for (; edgeExplorer.More(); edgeExplorer.Next()) {
            const edge = oc.TopoDS.Edge(edgeExplorer.Current());
            if (oc.BRep_Tool.Degenerated(edge) || oc.BRep_Tool.IsClosed(edge, face)) {
                continue;
            }
            // An edge is met once per face it borders. This kernel build has no
            // usable shape map, so the second visit is recognised by geometry.
            const segments = [];
            const measured = discretize(oc, edge, segments);
            if (!segments.length) {
                continue;
            }
            const id = edgeKey(segments, measured.length);
            let index = seen.get(id);
            if (index === undefined) {
                index = edges.length;
                seen.set(id, index);
                const edgeStart = edgePositions.length / 3;
                for (let i = 0; i < segments.length; i++) {
                    edgePositions.push(segments[i]);
                }
                edges.push({ start: edgeStart, count: segments.length / 3, length: measured.length, curve: measured.curve, mid: measured.mid });
            }
            if (info.edges.indexOf(index) < 0) {
                info.edges.push(index);
            }
        }
        edgeExplorer.delete();
    }
    explorer.delete();

    return {
        positions: new Float32Array(positions),
        indices: new Uint32Array(indices),
        faces: faces,
        edgePositions: new Float32Array(edgePositions),
        edges: edges,
        volume: volume(oc, shape)
    };
}

function faceInfo(oc, face, flip) {
    const info = { type: 'other', area: 0 };
    const props = new oc.GProp_GProps();
    oc.BRepGProp.SurfaceProperties(face, props, false, false);
    info.area = props.Mass();
    const centre = props.CentreOfMass();
    info.centre = [centre.X(), centre.Y(), centre.Z()];
    centre.delete();
    props.delete();
    const surface = new oc.BRepAdaptor_Surface(face, true);
    const type = surface.GetType();
    if (type === oc.GeomAbs_SurfaceType.GeomAbs_Plane) {
        const plane = surface.Plane();
        const origin = plane.Location();
        const axis = plane.Axis();
        const dir = axis.Direction();
        // The surface normal is X x Y of the plane's frame: the axis for a
        // right handed frame, the reverse for a left handed one (the bevel of
        // a chamfer gets one). Then the face's own orientation.
        const sign = (flip ? -1 : 1) * (plane.Direct() ? 1 : -1);
        info.type = 'plane';
        info.origin = [origin.X(), origin.Y(), origin.Z()];
        info.normal = [dir.X() * sign, dir.Y() * sign, dir.Z() * sign];
        [dir, axis, origin, plane].forEach(function (o) {
            o.delete();
        });
    } else if (type === oc.GeomAbs_SurfaceType.GeomAbs_Cylinder) {
        info.type = 'cylinder';
        const cylinder = surface.Cylinder();
        const axis = cylinder.Axis();
        const loc = axis.Location();
        const dir = axis.Direction();
        info.axis = { o: [loc.X(), loc.Y(), loc.Z()], d: [dir.X(), dir.Y(), dir.Z()] };
        info.radius = cylinder.Radius();
        [dir, loc, axis, cylinder].forEach(function (o) {
            o.delete();
        });
    }
    surface.delete();
    return info;
}

// Two visits of one edge give the same end points (in either order), the same
// middle and the same length.
function edgeKey(segments, length) {
    const r = function (v) {
        return Math.round(v * 1e4);
    };
    const n = segments.length;
    const a = [r(segments[0]), r(segments[1]), r(segments[2])].join(',');
    const b = [r(segments[n - 3]), r(segments[n - 2]), r(segments[n - 1])].join(',');
    const m = Math.floor(n / 12) * 6;
    const mid = [r(segments[m] + segments[n - 6 - m + 3]), r(segments[m + 1] + segments[n - 6 - m + 4]), r(segments[m + 2] + segments[n - 6 - m + 5])].join(',');
    return (a < b ? a + '|' + b : b + '|' + a) + '|' + mid + '|' + r(length);
}

// Append an edge to `out` as line segments. Returns its length and, for a
// straight or circular edge, its exact shape (see describe).
function discretize(oc, edge, out) {
    const props = new oc.GProp_GProps();
    oc.BRepGProp.LinearProperties(edge, props, false, false);
    const length = props.Mass();
    props.delete();
    const curve = new oc.BRepAdaptor_Curve(edge);
    const points = new oc.GCPnts_TangentialDeflection(curve, 0.15, 0.05);
    const count = points.NbPoints();
    let first = null;
    let previous = null;
    for (let i = 1; i <= count; i++) {
        const p = points.Value(i);
        const here = [p.X(), p.Y(), p.Z()];
        p.delete();
        if (previous) {
            out.push(previous[0], previous[1], previous[2], here[0], here[1], here[2]);
        } else {
            first = here;
        }
        previous = here;
    }
    let exact = null;
    if (first && previous !== first) {
        const type = curve.GetType();
        if (type === oc.GeomAbs_CurveType.GeomAbs_Line) {
            exact = { type: 'line', a: first, b: previous };
        } else if (type === oc.GeomAbs_CurveType.GeomAbs_Circle) {
            const circle = curve.Circle();
            const centre = circle.Location();
            const axis = circle.Axis();
            const dir = axis.Direction();
            exact = {
                type: 'circle', c: [centre.X(), centre.Y(), centre.Z()], r: circle.Radius(),
                n: [dir.X(), dir.Y(), dir.Z()], a: first, b: previous,
                closed: Math.hypot(first[0] - previous[0], first[1] - previous[1], first[2] - previous[2]) < 1e-7
            };
            [dir, axis, centre, circle].forEach(function (o) {
                o.delete();
            });
        }
    }
    const half = curve.Value((curve.FirstParameter() + curve.LastParameter()) / 2);
    const mid = [half.X(), half.Y(), half.Z()];
    half.delete();
    points.delete();
    curve.delete();
    return { length: length, curve: exact, mid: mid };
}

/* ================= features ================= */

function vec(oc, a) {
    return new oc.gp_Vec(a[0], a[1], a[2]);
}

function pnt(oc, a) {
    return new oc.gp_Pnt(a[0], a[1], a[2]);
}

// The kernel edge of one sketch curve (a resolved curve of sketch/geom.js)
function curveEdge(oc, frame, curve) {
    let maker;
    if (curve.type === 'line') {
        const a = pnt(oc, toWorld(frame, curve.a[0], curve.a[1]));
        const b = pnt(oc, toWorld(frame, curve.b[0], curve.b[1]));
        maker = new oc.BRepBuilderAPI_MakeEdge(a, b);
        a.delete();
        b.delete();
        const lineEdge = maker.Edge();
        maker.delete();
        return lineEdge;
    }
    const centre = pnt(oc, toWorld(frame, curve.c[0], curve.c[1]));
    const normalVec = vec(oc, frame.n);
    const xVec = vec(oc, frame.x);
    const normal = new oc.gp_Dir(normalVec);
    const xDir = new oc.gp_Dir(xVec);
    const axes = new oc.gp_Ax2(centre, normal, xDir);
    const circle = new oc.gp_Circ(axes, curve.r);
    if (curve.type === 'circle') {
        maker = new oc.BRepBuilderAPI_MakeEdge(circle);
    } else {
        const a = pnt(oc, toWorld(frame, curve.a[0], curve.a[1]));
        const b = pnt(oc, toWorld(frame, curve.b[0], curve.b[1]));
        maker = new oc.BRepBuilderAPI_MakeEdge(circle, a, b);
        a.delete();
        b.delete();
    }
    const edge = maker.Edge();
    [maker, circle, axes, xDir, normal, xVec, normalVec, centre].forEach(function (o) {
        o.delete();
    });
    return edge;
}

// The closed regions of a sketch: every area its curves enclose, with holes
// and crossings handled by the kernel. The sketch plane is cut along all the
// curves and each bounded piece is one region.
// Returns [{ face, triangles, sample, area }]: the kernel face, its mesh as
// plane coordinates (six numbers per triangle), a point safely inside it and
// its area. A region is remembered by such an inside point, not by an index:
// that survives edits of the sketch as long as the area still exists there.
export function sketchRegions(oc, sketch) {
    const frame = planeFrame(sketch.plane);
    if (!frame) {
        throw new Error('The sketch plane could not be found');
    }
    const curves = sketchCurves({ geometry: sketch.geometry || [], constraints: [] }).filter(function (c) {
        return !c.construction && (c.type === 'circle' ? c.r > 1e-7 : Math.hypot(c.a[0] - c.b[0], c.a[1] - c.b[1]) > 1e-7 || c.type === 'arc');
    });
    if (!curves.length) {
        return [];
    }
    const min = [Infinity, Infinity];
    const max = [-Infinity, -Infinity];
    curves.forEach(function (c) {
        sample(c, Math.PI / 8).forEach(function (p) {
            min[0] = Math.min(min[0], p[0]);
            min[1] = Math.min(min[1], p[1]);
            max[0] = Math.max(max[0], p[0]);
            max[1] = Math.max(max[1], p[1]);
        });
    });
    const margin = Math.max(max[0] - min[0], max[1] - min[1]) * 0.25 + 10;
    const bounds = [min[0] - margin, max[0] + margin, min[1] - margin, max[1] + margin];

    // A rectangle of the sketch plane that reaches well past the sketch
    const origin = pnt(oc, frame.o);
    const normalVec = vec(oc, frame.n);
    const xVec = vec(oc, frame.x);
    const normal = new oc.gp_Dir(normalVec);
    const xDir = new oc.gp_Dir(xVec);
    const ax2 = new oc.gp_Ax2(origin, normal, xDir);
    const ax3 = new oc.gp_Ax3(ax2);
    const plane = new oc.gp_Pln(ax3);
    const sheetMaker = new oc.BRepBuilderAPI_MakeFace(plane, bounds[0], bounds[1], bounds[2], bounds[3]);
    const sheet = sheetMaker.Face();

    const argumentList = new oc.NCollection_List_TopoDS_Shape([sheet]);
    const toolList = new oc.NCollection_List_TopoDS_Shape(curves.map(function (c) {
        return curveEdge(oc, frame, c);
    }));
    const splitter = new oc.BRepAlgoAPI_Splitter();
    const progress = new oc.Message_ProgressRange();
    splitter.SetArguments(argumentList);
    splitter.SetTools(toolList);
    splitter.SetFuzzyValue(1e-6); // welds ends the solver left a hair apart
    splitter.Build(progress);
    const failed = !splitter.IsDone() || splitter.HasErrors();
    const pieces = failed ? null : splitter.Shape();
    [progress, splitter, toolList, argumentList, sheetMaker, plane, ax3, ax2, xDir, normal, xVec, normalVec, origin].forEach(function (o) {
        o.delete();
    });
    if (failed) {
        throw new Error('The sketch profiles could not be worked out');
    }

    const mesher = new oc.BRepMesh_IncrementalMesh(pieces, 0.05, false, 0.2, false);
    mesher.delete();
    const edge = 1e-6 * (1 + margin);
    const regions = [];
    const explorer = new oc.TopExp_Explorer(pieces, oc.TopAbs_ShapeEnum.TopAbs_FACE);
    for (; explorer.More(); explorer.Next()) {
        const face = oc.TopoDS.Face(explorer.Current());
        const mesh = faceTriangles(oc, face);
        const uv = [];
        let outer = false;
        for (let i = 0; i < mesh.points.length; i += 3) {
            const dx = mesh.points[i] - frame.o[0];
            const dy = mesh.points[i + 1] - frame.o[1];
            const dz = mesh.points[i + 2] - frame.o[2];
            const u = dx * frame.x[0] + dy * frame.x[1] + dz * frame.x[2];
            const v = dx * frame.y[0] + dy * frame.y[1] + dz * frame.y[2];
            uv.push([u, v]);
            // The piece that touches the rim of the sheet is the outside
            outer = outer || u < bounds[0] + edge || u > bounds[1] - edge || v < bounds[2] + edge || v > bounds[3] - edge;
        }
        if (outer || !mesh.tris.length) {
            continue;
        }
        const triangles = [];
        let area = 0;
        let largest = 0;
        let samplePoint = uv[0];
        for (let i = 0; i < mesh.tris.length; i += 3) {
            const a = uv[mesh.tris[i]];
            const b = uv[mesh.tris[i + 1]];
            const c = uv[mesh.tris[i + 2]];
            triangles.push(a[0], a[1], b[0], b[1], c[0], c[1]);
            const size = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
            area += size;
            if (size > largest) {
                largest = size;
                samplePoint = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3];
            }
        }
        regions.push({ face: face, triangles: new Float32Array(triangles), sample: samplePoint, area: area });
    }
    explorer.delete();
    return regions;
}

// Is plane point p inside a region (any of its triangles)?
export function inRegion(region, p) {
    const t = region.triangles;
    for (let i = 0; i < t.length; i += 6) {
        const d1 = (p[0] - t[i + 2]) * (t[i + 1] - t[i + 3]) - (t[i] - t[i + 2]) * (p[1] - t[i + 3]);
        const d2 = (p[0] - t[i + 4]) * (t[i + 3] - t[i + 5]) - (t[i + 2] - t[i + 4]) * (p[1] - t[i + 5]);
        const d3 = (p[0] - t[i]) * (t[i + 5] - t[i + 1]) - (t[i + 4] - t[i]) * (p[1] - t[i + 1]);
        const negative = d1 < -1e-9 || d2 < -1e-9 || d3 < -1e-9;
        const positive = d1 > 1e-9 || d2 > 1e-9 || d3 > 1e-9;
        if (!(negative && positive)) {
            return true;
        }
    }
    return false;
}

function boolean(oc, kind, a, b) {
    const progress = new oc.Message_ProgressRange();
    const Op = kind === 'cut' ? oc.BRepAlgoAPI_Cut : kind === 'intersect' ? oc.BRepAlgoAPI_Common : oc.BRepAlgoAPI_Fuse;
    const op = new Op(a, b, progress);
    const failed = !op.IsDone() || op.HasErrors();
    const raw = failed ? null : op.Shape();
    op.delete();
    progress.delete();
    if (failed) {
        throw new Error('The boolean operation failed');
    }
    // Merge faces that ended up on the same surface, so no seam lines stay behind
    const unify = new oc.ShapeUpgrade_UnifySameDomain(raw, true, true, false);
    unify.Build();
    const result = unify.Shape();
    unify.delete();
    return result;
}

function isEmpty(oc, shape) {
    const explorer = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_SOLID);
    const empty = !explorer.More();
    explorer.delete();
    return empty;
}

// How far "through all" has to go from the sketch plane to clear every body
function reach(oc, bodies, frame) {
    let far = 0;
    bodies.forEach(function (body) {
        const box = new oc.Bnd_Box();
        oc.BRepBndLib.Add(body, box, false);
        if (!box.IsVoid()) {
            [box.GetXMin(), box.GetXMax()].forEach(function (x) {
                [box.GetYMin(), box.GetYMax()].forEach(function (y) {
                    [box.GetZMin(), box.GetZMax()].forEach(function (z) {
                        far = Math.max(far, Math.hypot(x - frame.o[0], y - frame.o[1], z - frame.o[2]));
                    });
                });
            });
        }
        box.delete();
    });
    return far + 10;
}

// The solid an extrude feature sweeps out, before it is joined to or cut
// from anything.
//   feature.regions    [[u, v], ...] a point inside each chosen sketch region
//   feature.extent     { type: "distance", value, value2, direction }
//                      { type: "all", direction }
//       direction      "positive" (along the plane normal) | "negative" |
//                      "symmetric" (value split over both sides) |
//                      "asymmetric" (value forwards, value2 backwards)
// `bodies` are the solids before the feature; "all" measures against them.
export function extrudeTool(oc, bodies, feature, sketch) {
    const frame = planeFrame(sketch.plane);
    if (!frame) {
        throw new Error('The sketch plane could not be found');
    }
    const extent = feature.extent || {};
    const direction = extent.direction || 'positive';
    let forwards;
    let backwards;
    if (extent.type === 'all') {
        if (!bodies.length) {
            throw new Error('Through All needs a solid to go through');
        }
        const far = reach(oc, bodies, frame);
        forwards = direction === 'negative' ? 0 : far;
        backwards = direction === 'positive' ? 0 : far;
    } else {
        const value = Number(extent.value);
        const value2 = Number(extent.value2);
        if (!(value > 0) || (direction === 'asymmetric' && !(value2 > 0))) {
            throw new Error('The extrude distance must be larger than zero');
        }
        forwards = direction === 'negative' ? 0 : direction === 'symmetric' ? value / 2 : value;
        backwards = direction === 'negative' ? value : direction === 'symmetric' ? value / 2 : direction === 'asymmetric' ? value2 : 0;
    }
    const regions = pickedRegions(oc, sketch, feature, 'extrusion');
    const sweep = vec(oc, frame.n.map(function (c) {
        return c * (forwards + backwards);
    }));
    let tool = null;
    regions.forEach(function (region) {
        let face = region.face;
        if (backwards > 0) {
            const back = vec(oc, frame.n.map(function (c) {
                return -c * backwards;
            }));
            const trsf = new oc.gp_Trsf();
            trsf.SetTranslation(back);
            const mover = new oc.BRepBuilderAPI_Transform(face, trsf, true, false);
            face = mover.Shape();
            [mover, trsf, back].forEach(function (o) {
                o.delete();
            });
        }
        const prism = new oc.BRepPrimAPI_MakePrism(face, sweep, false, true);
        const solid = prism.Shape();
        prism.delete();
        tool = tool ? boolean(oc, 'join', tool, solid) : solid;
    });
    sweep.delete();
    return tool;
}

// The regions of a sketch a feature picked (feature.regions: a point inside
// each); `what` names the feature in the message when none is left
function pickedRegions(oc, sketch, feature, what) {
    const picks = Array.isArray(feature.regions) ? feature.regions : [];
    const regions = sketchRegions(oc, sketch).filter(function (region) {
        return picks.some(function (p) {
            return inRegion(region, p);
        });
    });
    if (!regions.length) {
        throw new Error(picks.length ? 'The sketch profile of this ' + what + ' no longer exists' : 'No sketch profile is selected');
    }
    return regions;
}

// Apply an extrude feature. `bodies` is the list of solids before the
// feature; a new list is returned and the input is left untouched.
//   feature.operation  "join" | "cut" | "intersect" | "new"
export function extrude(oc, bodies, feature, sketch) {
    return applyTool(oc, bodies, extrudeTool(oc, bodies, feature, sketch), feature.operation || 'join');
}

// The world axis a revolve turns about: { o, d } (a point and a unit
// direction), from feature.axis
//   { curve: id }      a straight line of the sketch (usually construction)
//   { origin: "x" | "y" | "z" }   an axis of the part's origin
export function revolveAxis(sketch, axis) {
    const frame = planeFrame(sketch.plane);
    if (!axis) {
        throw new Error('No axis is selected');
    }
    if (axis.origin) {
        const d = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[axis.origin];
        if (!d) {
            throw new Error('Unknown origin axis');
        }
        return { o: [0, 0, 0], d: d };
    }
    const line = sketchCurves({ geometry: sketch.geometry || [], constraints: [] }).filter(function (c) {
        return c.id === axis.curve;
    })[0];
    if (!line || line.type !== 'line') {
        throw new Error('The axis line of this revolution no longer exists');
    }
    const a = toWorld(frame, line.a[0], line.a[1]);
    const b = toWorld(frame, line.b[0], line.b[1]);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (len < 1e-9) {
        throw new Error('The axis line has no length');
    }
    return { o: a, d: [(b[0] - a[0]) / len, (b[1] - a[1]) / len, (b[2] - a[2]) / len] };
}

// The solid a revolve feature sweeps out, before it is joined or cut.
//   feature.regions    [[u, v], ...] as for extrude
//   feature.axis       see revolveAxis
//   feature.extent     { type: "full" }
//                      { type: "angle", value, value2, direction } degrees;
//                      direction as for extrude: "positive" turns right
//                      handed about the axis, "negative" the other way,
//                      "symmetric" half each way, "asymmetric" value one
//                      way and value2 the other
export function revolveTool(oc, bodies, feature, sketch) {
    const frame = planeFrame(sketch.plane);
    if (!frame) {
        throw new Error('The sketch plane could not be found');
    }
    const axis = revolveAxis(sketch, feature.axis);
    const extent = feature.extent || { type: 'full' };
    const full = extent.type !== 'angle';
    const direction = extent.direction || 'positive';
    let start = 0;  // degrees the profile is turned back before the sweep
    let sweep = 360;
    if (!full) {
        const value = Number(extent.value);
        const value2 = Number(extent.value2);
        if (!(value > 0) || (direction === 'asymmetric' && !(value2 > 0))) {
            throw new Error('The revolve angle must be larger than zero');
        }
        sweep = direction === 'asymmetric' ? value + value2 : value;
        start = direction === 'symmetric' ? value / 2 : direction === 'asymmetric' ? value2 : 0;
        if (sweep > 360 + 1e-9) {
            throw new Error('The revolve angles add up to more than a full turn');
        }
    }
    const regions = pickedRegions(oc, sketch, feature, 'revolution');
    // The profile must stay on one side of the axis: a profile that crosses
    // it would sweep through itself
    regions.forEach(function (region) {
        let below = false;
        let above = false;
        const t = region.triangles;
        for (let i = 0; i < t.length; i += 2) {
            const p = toWorld(frame, t[i], t[i + 1]);
            const w = [p[0] - axis.o[0], p[1] - axis.o[1], p[2] - axis.o[2]];
            // Side of the axis within the sketch plane: (d x w) . n
            const side = (axis.d[1] * w[2] - axis.d[2] * w[1]) * frame.n[0] + (axis.d[2] * w[0] - axis.d[0] * w[2]) * frame.n[1] + (axis.d[0] * w[1] - axis.d[1] * w[0]) * frame.n[2];
            below = below || side < -1e-6;
            above = above || side > 1e-6;
        }
        if (below && above) {
            throw new Error('The profile crosses the axis: a revolved profile must lie on one side of it');
        }
    });
    const flip = !full && direction === 'negative' ? -1 : 1;
    const point = new oc.gp_Pnt(axis.o[0], axis.o[1], axis.o[2]);
    const dir = new oc.gp_Dir(axis.d[0] * flip, axis.d[1] * flip, axis.d[2] * flip);
    const ax = new oc.gp_Ax1(point, dir);
    let tool = null;
    try {
        regions.forEach(function (region) {
            let face = region.face;
            let moved = null;
            if (start > 0) {
                const trsf = new oc.gp_Trsf();
                trsf.SetRotation(ax, -start * Math.PI / 180);
                const mover = new oc.BRepBuilderAPI_Transform(face, trsf, true, false);
                moved = mover.Shape();
                face = moved;
                mover.delete();
                trsf.delete();
            }
            const maker = full ? new oc.BRepPrimAPI_MakeRevol(face, ax, false)
                : new oc.BRepPrimAPI_MakeRevol(face, ax, sweep * Math.PI / 180, false);
            const solid = maker.Shape();
            maker.delete();
            if (moved) {
                moved.delete();
            }
            tool = tool ? boolean(oc, 'join', tool, solid) : solid;
        });
    } finally {
        [ax, dir, point].forEach(function (o) {
            o.delete();
        });
    }
    if (!isSound(oc, tool)) {
        tool.delete();
        throw new Error('The revolution could not be built from this profile');
    }
    return tool;
}

// Apply a revolve feature, as extrude() does
export function revolve(oc, bodies, feature, sketch) {
    return applyTool(oc, bodies, revolveTool(oc, bodies, feature, sketch), feature.operation || 'join');
}

/* ================= patterns and mirror ================= */
// A pattern or mirror repeats features, not faces: the tool of each source
// feature (what its extrusion, revolution or holes sweep) is made again,
// copied by each placement, the copies fused, and the feature's own
// operation applied once. Fillets and chamfers cannot be repeated this way.
//   { type: "pattern", kind: "rect", features: [id], dir1: [x, y, z],
//     count1, spacing1, dir2?, count2, spacing2 }
//   { type: "pattern", kind: "circ", features: [id], axis: { o, d },
//     count, angle }     angle in degrees: 360 spreads the copies round the
//                        full turn, less places them `angle / (count - 1)` apart
//   { type: "mirror", features: [id] (none: the whole solid), plane: { o, n } }
// sources: [{ feature, sketch }] of the repeated features, in order.
const MAX_COPIES = 200;

function unit(v) {
    const len = Math.hypot(v[0], v[1], v[2]);
    if (!(len > 1e-12)) {
        throw new Error('A direction of this pattern has no length');
    }
    return [v[0] / len, v[1] / len, v[2] / len];
}

// The placements of the copies, the original left out:
// [{ move: [x, y, z] } | { turn: { o, d, angle } } | { mirror: { o, n } }]
export function placements(feature) {
    if (feature.type === 'mirror') {
        const plane = feature.plane || {};
        if (!plane.o || !plane.n) {
            throw new Error('No mirror plane is selected');
        }
        return [{ mirror: { o: plane.o, n: unit(plane.n) } }];
    }
    const out = [];
    if (feature.kind === 'circ') {
        const count = Math.round(Number(feature.count));
        const angle = Number(feature.angle);
        if (!(count >= 2) || !(angle > 0)) {
            throw new Error('A circular pattern needs at least two placements and an angle');
        }
        if (!feature.axis || !feature.axis.o || !feature.axis.d) {
            throw new Error('No axis is selected');
        }
        const step = angle >= 360 - 1e-9 ? 360 / count : angle / (count - 1);
        for (let k = 1; k < count; k++) {
            out.push({ turn: { o: feature.axis.o, d: unit(feature.axis.d), angle: step * k } });
        }
    } else {
        const count1 = Math.round(Number(feature.count1));
        const count2 = feature.dir2 ? Math.round(Number(feature.count2)) : 1;
        if (!(count1 >= 1) || !(count2 >= 1) || count1 * count2 < 2) {
            throw new Error('A rectangular pattern needs at least two placements');
        }
        const d1 = unit(feature.dir1 || [1, 0, 0]);
        const d2 = feature.dir2 ? unit(feature.dir2) : [0, 0, 0];
        const s1 = Number(feature.spacing1) || 0;
        const s2 = Number(feature.spacing2) || 0;
        for (let i = 0; i < count1; i++) {
            for (let j = 0; j < count2; j++) {
                if (i || j) {
                    out.push({ move: [0, 1, 2].map(function (c) {
                        return d1[c] * s1 * i + d2[c] * s2 * j;
                    }) });
                }
            }
        }
    }
    if (out.length + 1 > MAX_COPIES) {
        throw new Error('A pattern of more than ' + MAX_COPIES + ' placements is not built');
    }
    return out;
}

function transformed(oc, shape, place) {
    const trsf = new oc.gp_Trsf();
    const made = [];
    if (place.move) {
        const v = new oc.gp_Vec(place.move[0], place.move[1], place.move[2]);
        trsf.SetTranslation(v);
        made.push(v);
    } else if (place.turn) {
        const p = new oc.gp_Pnt(place.turn.o[0], place.turn.o[1], place.turn.o[2]);
        const d = new oc.gp_Dir(place.turn.d[0], place.turn.d[1], place.turn.d[2]);
        const ax = new oc.gp_Ax1(p, d);
        trsf.SetRotation(ax, place.turn.angle * Math.PI / 180);
        made.push(ax, d, p);
    } else {
        const p = new oc.gp_Pnt(place.mirror.o[0], place.mirror.o[1], place.mirror.o[2]);
        const d = new oc.gp_Dir(place.mirror.n[0], place.mirror.n[1], place.mirror.n[2]);
        const ax = new oc.gp_Ax2(p, d);
        trsf.SetMirror(ax);
        made.push(ax, d, p);
    }
    const maker = new oc.BRepBuilderAPI_Transform(shape, trsf, true, false);
    const out = maker.Shape();
    maker.delete();
    trsf.delete();
    made.forEach(function (o) {
        o.delete();
    });
    return out;
}

// The tool a source feature sweeps, and what it does with it
function sourceTool(oc, bodies, source) {
    const f = source.feature;
    if (f.type === 'extrude') {
        return { shape: extrudeTool(oc, bodies, f, source.sketch), operation: f.operation === 'new' ? 'join' : f.operation || 'join' };
    }
    if (f.type === 'revolve') {
        return { shape: revolveTool(oc, bodies, f, source.sketch), operation: f.operation === 'new' ? 'join' : f.operation || 'join' };
    }
    if (f.type === 'hole') {
        return { shape: holeTool(oc, bodies, f, source.sketch), operation: 'cut' };
    }
    throw new Error(f.name + ' cannot be repeated: only extrusions, revolutions and holes can');
}

// The copies of each source feature's tool, fused: [{ shape, operation }].
// With no sources (a mirror of the whole solid): the mirrored bodies, to join.
export function patternTools(oc, bodies, feature, sources) {
    const places = placements(feature);
    if (!sources.length) {
        if (feature.type !== 'mirror') {
            throw new Error('Pick the features to repeat in the model browser');
        }
        if (!bodies.length) {
            throw new Error('There is no solid to mirror yet');
        }
        return bodies.map(function (body) {
            return { shape: transformed(oc, body, places[0]), operation: 'join' };
        });
    }
    return sources.map(function (source) {
        const tool = sourceTool(oc, bodies, source);
        let fused = null;
        places.forEach(function (place) {
            const copy = transformed(oc, tool.shape, place);
            fused = fused ? boolean(oc, 'join', fused, copy) : copy;
        });
        tool.shape.delete();
        return { shape: fused, operation: tool.operation };
    });
}

// Apply a pattern or mirror feature: a new body list
export function pattern(oc, bodies, feature, sources) {
    let out = bodies;
    patternTools(oc, bodies, feature, sources).forEach(function (tool) {
        out = applyTool(oc, out, tool.shape, tool.operation);
    });
    return out;
}

// Join, cut or intersect a feature's tool with the bodies; a new list
function applyTool(oc, bodies, tool, operation) {
    if (operation === 'new' || (operation === 'join' && !bodies.length)) {
        return bodies.concat([tool]);
    }
    if (!bodies.length) {
        throw new Error('There is no solid body to ' + operation + ' yet');
    }
    if (operation === 'join') {
        return [boolean(oc, 'join', bodies[0], tool)].concat(bodies.slice(1));
    }
    return bodies.map(function (body) {
        return boolean(oc, operation, body, tool);
    }).filter(function (body) {
        return !isEmpty(oc, body);
    });
}

// Volume of a solid in mm^3.
export function volume(oc, shape) {
    const props = new oc.GProp_GProps();
    oc.BRepGProp.VolumeProperties(shape, props, false, false, false);
    const v = props.Mass();
    props.delete();
    return v;
}

// Write a shape as a STEP file and return its text.
export function toSTEP(oc, shape) {
    const path = '/export.step';
    const writer = new oc.STEPControl_Writer();
    const progress = new oc.Message_ProgressRange();
    writer.Transfer(shape, oc.STEPControl_StepModelType.STEPControl_AsIs, true, progress);
    writer.Write(path);
    const text = oc.FS.readFile(path, { encoding: 'utf8' });
    oc.FS.unlink(path);
    progress.delete();
    writer.delete();
    return text;
}

// Build a small part through the same calls the real features will use:
// sketch profile -> extrude -> hole (boolean cut) -> fillet -> chamfer.
// Used by File > Kernel Self-test to prove the kernel works in this browser.
export function selfTestShape(oc) {
    const corners = [[0, 0], [60, 0], [60, 40], [0, 40]].map(function (p) {
        return new oc.gp_Pnt(p[0], p[1], 0);
    });
    const wireMaker = new oc.BRepBuilderAPI_MakeWire();
    for (let i = 0; i < 4; i++) {
        const edgeMaker = new oc.BRepBuilderAPI_MakeEdge(corners[i], corners[(i + 1) % 4]);
        wireMaker.Add(edgeMaker.Edge());
        edgeMaker.delete();
    }
    const faceMaker = new oc.BRepBuilderAPI_MakeFace(wireMaker.Wire(), true);

    const direction = new oc.gp_Vec(0, 0, 20);
    const prism = new oc.BRepPrimAPI_MakePrism(faceMaker.Face(), direction, false, true);
    let body = prism.Shape();

    const origin = new oc.gp_Pnt(30, 20, -1);
    const up = new oc.gp_Vec(0, 0, 1);
    const axisDir = new oc.gp_Dir(up);
    const axis = new oc.gp_Ax2(origin, axisDir);
    const cylinder = new oc.BRepPrimAPI_MakeCylinder(axis, 6, 22);
    const progress = new oc.Message_ProgressRange();
    const cut = new oc.BRepAlgoAPI_Cut(body, cylinder.Shape(), progress);
    body = cut.Shape();

    // Round the four vertical corner edges, then break the first edge that accepts a chamfer.
    const fillet = new oc.BRepFilletAPI_MakeFillet(body);
    let explorer = new oc.TopExp_Explorer(body, oc.TopAbs_ShapeEnum.TopAbs_EDGE);
    let picked = 0;
    for (; explorer.More(); explorer.Next()) {
        const edge = oc.TopoDS.Edge(explorer.Current());
        if (isVerticalCornerEdge(oc, edge, 60, 40)) {
            fillet.Add(5, edge);
            picked++;
        }
    }
    explorer.delete();
    if (picked > 0) {
        try {
            fillet.Build();
            if (fillet.IsDone()) {
                body = fillet.Shape();
            }
        } catch (e) {
            // Leave the body unfilleted; the caller reports the face count
        }
    }

    let chamfered = false;
    explorer = new oc.TopExp_Explorer(body, oc.TopAbs_ShapeEnum.TopAbs_EDGE);
    for (; explorer.More() && !chamfered; explorer.Next()) {
        const chamfer = new oc.BRepFilletAPI_MakeChamfer(body);
        try {
            chamfer.Add(1.5, oc.TopoDS.Edge(explorer.Current()));
            chamfer.Build();
            if (chamfer.IsDone()) {
                body = chamfer.Shape();
                chamfered = true;
            }
        } catch (e) {
            // This edge cannot take a chamfer (seam or degenerate edge), try the next
        }
        chamfer.delete();
    }
    explorer.delete();

    [wireMaker, faceMaker, direction, prism, origin, up, axisDir, axis, cylinder, progress, cut, fillet]
        .concat(corners).forEach(function (o) {
            o.delete();
        });
    return body;
}

// True when a straight edge runs along Z at a corner of the w x h sketch
// rectangle. The corner test keeps the seam of the hole's cylinder out. An
// edge is listed once per face it borders, so the caller sees each twice;
// adding an edge twice to a fillet is harmless.
function isVerticalCornerEdge(oc, edge, w, h) {
    const explorer = new oc.TopExp_Explorer(edge, oc.TopAbs_ShapeEnum.TopAbs_VERTEX);
    const pts = [];
    for (; explorer.More(); explorer.Next()) {
        const p = oc.BRep_Tool.Pnt(oc.TopoDS.Vertex(explorer.Current()));
        pts.push([p.X(), p.Y(), p.Z()]);
        p.delete();
    }
    explorer.delete();
    if (pts.length < 2) {
        return false;
    }
    const a = pts[0];
    const b = pts[pts.length - 1];
    const near = function (v, target) {
        return Math.abs(v - target) < 1e-6;
    };
    const vertical = near(a[0], b[0]) && near(a[1], b[1]) && !near(a[2], b[2]);
    const onCorner = (near(a[0], 0) || near(a[0], w)) && (near(a[1], 0) || near(a[1], h));
    return vertical && onCorner;
}

/* ================= edge references ================= */
// A feature remembers an edge by where it is: the point halfway along it and
// its length ({ body, mid, length }, taken from describe()). That finds the
// same edge again as long as nothing before the feature moved it. If it did
// move, the reference fails loudly and the user picks again; it never lands
// on a different edge. History based names that follow an edge through
// changes are the planned next step (PROPOSAL.md 6.3).
const EDGE_TOLERANCE = 1e-3;

function edgeMiddle(oc, edge) {
    const curve = new oc.BRepAdaptor_Curve(edge);
    const p = curve.Value((curve.FirstParameter() + curve.LastParameter()) / 2);
    const mid = [p.X(), p.Y(), p.Z()];
    p.delete();
    curve.delete();
    return mid;
}

function edgeLength(oc, edge) {
    const props = new oc.GProp_GProps();
    oc.BRepGProp.LinearProperties(edge, props, false, false);
    const length = props.Mass();
    props.delete();
    return length;
}

/* ---- what an edge is, to find it again after an edit upstream ---- */
// A reference remembers an edge by where it is (mid, length). When an
// earlier feature changes, the edge moves (a taller boss lifts its top
// edge) and that no longer matches. So a reference also carries `sig`, a
// description that survives such moves: the kind of curve (a line and its
// direction, a circle and its radius and axis), the surfaces of the two
// faces it lies between (a plane and its normal, a cylinder and its radius
// and axis), and whether it is an outside (convex) or inside corner. When
// the position fails, the edge with the same description nearest to the
// old position is taken; with none, the feature fails loudly as before.
// This is a cheap first step of the history based names of PROPOSAL.md
// 14.5, which would also cover sketches on faces.

const KEY_DIGITS = 3;

function num(v) {
    return (Math.abs(v) < Math.pow(10, -KEY_DIGITS) ? 0 : v).toFixed(KEY_DIGITS);
}

// A direction up to its sign: the first clear component made positive
function axisKey(d) {
    const len = Math.hypot(d[0], d[1], d[2]) || 1;
    let u = [d[0] / len, d[1] / len, d[2] / len];
    const lead = u.filter(function (c) {
        return Math.abs(c) > 1e-6;
    })[0];
    if (lead < 0) {
        u = u.map(function (c) {
            return -c;
        });
    }
    return u.map(num).join(',');
}

// The surface of a face and its outward normal at point p: { key, normal }
// (normal null where it is not worked out)
function surfaceAt(oc, face, p) {
    const reversed = face.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED;
    const surface = new oc.BRepAdaptor_Surface(face, true);
    const type = surface.GetType();
    let out = { key: 'surface:' + type, normal: null };
    if (type === oc.GeomAbs_SurfaceType.GeomAbs_Plane) {
        const info = faceInfo(oc, face, reversed);
        out = { key: 'plane:' + info.normal.map(num).join(','), normal: info.normal };
    } else if (type === oc.GeomAbs_SurfaceType.GeomAbs_Cylinder) {
        const cylinder = surface.Cylinder();
        const axis = cylinder.Axis();
        const loc = axis.Location();
        const dir = axis.Direction();
        const o = [loc.X(), loc.Y(), loc.Z()];
        const d = [dir.X(), dir.Y(), dir.Z()];
        const r = cylinder.Radius();
        // The surface normal points away from the axis for a right handed
        // frame, towards it for a left handed one; the face may turn it round
        const outward = cylinder.Direct() !== reversed;
        [dir, loc, axis, cylinder].forEach(function (x) {
            x.delete();
        });
        // Outward normal: from the axis to the point (towards it for a hole)
        const w = [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
        const along = w[0] * d[0] + w[1] * d[1] + w[2] * d[2];
        const radial = [w[0] - d[0] * along, w[1] - d[1] * along, w[2] - d[2] * along];
        const len = Math.hypot(radial[0], radial[1], radial[2]) || 1;
        const sign = outward ? 1 : -1;
        out = { key: 'cylinder:' + num(r) + ':' + axisKey(d) + (outward ? ':out' : ':in'), normal: radial.map(function (c) {
            return c / len * sign;
        }) };
    }
    surface.delete();
    return out;
}

// The curve of an edge as a key: "line:<direction>" or "circle:<r>:<axis>"
function curveKey(oc, edge) {
    const curve = new oc.BRepAdaptor_Curve(edge);
    const type = curve.GetType();
    let key = 'curve:' + type;
    if (type === oc.GeomAbs_CurveType.GeomAbs_Line) {
        const a = curve.Value(curve.FirstParameter());
        const b = curve.Value(curve.LastParameter());
        key = 'line:' + axisKey([b.X() - a.X(), b.Y() - a.Y(), b.Z() - a.Z()]);
        a.delete();
        b.delete();
    } else if (type === oc.GeomAbs_CurveType.GeomAbs_Circle) {
        const circle = curve.Circle();
        const axis = circle.Axis();
        const dir = axis.Direction();
        key = 'circle:' + num(circle.Radius()) + ':' + axisKey([dir.X(), dir.Y(), dir.Z()]);
        [dir, axis, circle].forEach(function (x) {
            x.delete();
        });
    }
    curve.delete();
    return key;
}

// Is point p inside the material? The distance tool says so for a point
// within a solid (InnerSolution), but only when given the solid itself, and
// a body after a boolean is a compound: ask each of its solids.
function isInside(oc, body, p) {
    const point = new oc.gp_Pnt(p[0], p[1], p[2]);
    const maker = new oc.BRepBuilderAPI_MakeVertex(point);
    const vertex = maker.Vertex();
    let inside = false;
    const solids = new oc.TopExp_Explorer(body, oc.TopAbs_ShapeEnum.TopAbs_SOLID);
    for (; solids.More() && !inside; solids.Next()) {
        const solid = solids.Current();
        const measure = new oc.BRepExtrema_DistShapeShape(vertex, solid);
        inside = measure.InnerSolution();
        measure.delete();
        solid.delete();
    }
    [solids, vertex, maker, point].forEach(function (x) {
        x.delete();
    });
    return inside;
}

// The description of an edge of `body` (see above):
// { curve, faces: [key, key] sorted, convex: true | false | null }
export function edgeSignature(oc, body, edge) {
    const mid = edgeMiddle(oc, edge);
    const faces = [];
    const explorer = new oc.TopExp_Explorer(body, oc.TopAbs_ShapeEnum.TopAbs_FACE);
    for (; explorer.More() && faces.length < 2; explorer.Next()) {
        const face = oc.TopoDS.Face(explorer.Current());
        const edges = new oc.TopExp_Explorer(face, oc.TopAbs_ShapeEnum.TopAbs_EDGE);
        let found = false;
        for (; edges.More() && !found; edges.Next()) {
            found = edges.Current().IsSame(edge);
        }
        edges.delete();
        if (found) {
            faces.push(surfaceAt(oc, face, mid));
        }
    }
    explorer.delete();
    let convex = null;
    if (faces.length === 2 && faces[0].normal && faces[1].normal) {
        // A step off the edge across face one and under face two: outside
        // the material at an outside corner, inside it at an inside corner
        const d = [0, 1, 2].map(function (i) {
            return faces[0].normal[i] - faces[1].normal[i];
        });
        const len = Math.hypot(d[0], d[1], d[2]);
        if (len > 1e-3) {
            const step = 0.01;
            convex = !isInside(oc, body, [0, 1, 2].map(function (i) {
                return mid[i] + d[i] / len * step;
            }));
        }
    }
    return {
        curve: curveKey(oc, edge),
        faces: faces.map(function (f) {
            return f.key;
        }).sort(),
        convex: convex
    };
}

function sameSignature(a, b) {
    return a.curve === b.curve && a.convex === b.convex && a.faces.join('|') === b.faces.join('|');
}

// Where a planar face a sketch (or a work plane) was put on is now.
// plane: { ref: "face", frame, face: { normal, point } }. The face is the
// planar face with the same outward normal on which the point clicked,
// moved along the normal, still lands; of several, the one that moved
// least. Returns the frame moved along its normal onto that face, or null
// when no such face is left (the sketch then stays where it was).
export function followFace(oc, bodies, plane) {
    const n = plane.face && plane.face.normal;
    const p = plane.face && plane.face.point;
    if (!n || !p || !plane.frame) {
        return null;
    }
    let best = null;
    bodies.forEach(function (body) {
        const explorer = new oc.TopExp_Explorer(body, oc.TopAbs_ShapeEnum.TopAbs_FACE);
        for (; explorer.More(); explorer.Next()) {
            const face = oc.TopoDS.Face(explorer.Current());
            const info = faceInfo(oc, face, face.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED);
            if (info.type !== 'plane' || info.normal[0] * n[0] + info.normal[1] * n[1] + info.normal[2] * n[2] < 1 - 1e-6) {
                continue;
            }
            const shift = (info.origin[0] - p[0]) * n[0] + (info.origin[1] - p[1]) * n[1] + (info.origin[2] - p[2]) * n[2];
            const point = new oc.gp_Pnt(p[0] + n[0] * shift, p[1] + n[1] * shift, p[2] + n[2] * shift);
            const maker = new oc.BRepBuilderAPI_MakeVertex(point);
            const vertex = maker.Vertex();
            const measure = new oc.BRepExtrema_DistShapeShape(vertex, face);
            const off = measure.IsDone() ? measure.Value() : Infinity;
            [measure, vertex, maker, point].forEach(function (x) {
                x.delete();
            });
            // On the face beats near it; then the smaller move
            const rank = [off > 1e-6 ? 1 : 0, off, Math.abs(shift)];
            if (!best || rank[0] < best.rank[0] || (rank[0] === best.rank[0] && (rank[1] < best.rank[1] - 1e-9 || (Math.abs(rank[1] - best.rank[1]) <= 1e-9 && rank[2] < best.rank[2])))) {
                best = { rank: rank, shift: shift };
            }
        }
        explorer.delete();
    });
    if (!best || best.rank[0] === 1) {
        return null;
    }
    const f = plane.frame;
    const along = best.shift * (f.n[0] * n[0] + f.n[1] * n[1] + f.n[2] * n[2]);
    return { o: [f.o[0] + f.n[0] * along, f.o[1] + f.n[1] * along, f.o[2] + f.n[2] * along], x: f.x, y: f.y, n: f.n };
}

// The kernel edges of the given references: [{ body, edge }]
export function findEdges(oc, bodies, refs) {
    const listed = {};
    const edgesOf = function (index) {
        if (!listed[index]) {
            listed[index] = [];
            const explorer = new oc.TopExp_Explorer(bodies[index], oc.TopAbs_ShapeEnum.TopAbs_EDGE);
            for (; explorer.More(); explorer.Next()) {
                const edge = oc.TopoDS.Edge(explorer.Current());
                if (!oc.BRep_Tool.Degenerated(edge)) {
                    listed[index].push({ edge: edge, mid: edgeMiddle(oc, edge), length: edgeLength(oc, edge) });
                }
            }
            explorer.delete();
        }
        return listed[index];
    };
    return (refs || []).map(function (ref) {
        const candidates = ref.body >= 0 && ref.body < bodies.length ? [ref.body] : bodies.map(function (b, i) {
            return i;
        });
        let found = null;
        candidates.forEach(function (index) {
            edgesOf(index).forEach(function (e) {
                const off = Math.hypot(e.mid[0] - ref.mid[0], e.mid[1] - ref.mid[1], e.mid[2] - ref.mid[2]);
                if (!found && off < EDGE_TOLERANCE && Math.abs(e.length - ref.length) < EDGE_TOLERANCE) {
                    found = { body: index, edge: e.edge };
                }
            });
        });
        if (!found && ref.sig) {
            // Moved by an edit upstream: the edge that is the same kind of
            // edge, nearest to where it was
            let best = Infinity;
            candidates.forEach(function (index) {
                edgesOf(index).forEach(function (e) {
                    if (curveKey(oc, e.edge) !== ref.sig.curve) {
                        return;
                    }
                    const off = Math.hypot(e.mid[0] - ref.mid[0], e.mid[1] - ref.mid[1], e.mid[2] - ref.mid[2]);
                    if (off < best && sameSignature(edgeSignature(oc, bodies[index], e.edge), ref.sig)) {
                        best = off;
                        found = { body: index, edge: e.edge };
                    }
                });
            });
        }
        if (!found) {
            throw new Error('An edge this feature was put on is no longer there. Edit the feature and pick the edge again');
        }
        return found;
    });
}

/* ---- faces picked in the model (Shell) ---- */
// A face reference is { body, centre, area, sig? }: the centre of mass and
// area of the face as picked, and the key of its surface (see surfaceAt).
// Found by position first, then, after an edit upstream moved it, as the
// face on the same kind of surface nearest to where it was.
export function findFaces(oc, bodies, refs) {
    const listed = {};
    const facesOf = function (index) {
        if (!listed[index]) {
            listed[index] = [];
            const explorer = new oc.TopExp_Explorer(bodies[index], oc.TopAbs_ShapeEnum.TopAbs_FACE);
            for (; explorer.More(); explorer.Next()) {
                const face = oc.TopoDS.Face(explorer.Current());
                const info = faceInfo(oc, face, face.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED);
                listed[index].push({ face: face, centre: info.centre, area: info.area });
            }
            explorer.delete();
        }
        return listed[index];
    };
    return (refs || []).map(function (ref) {
        const candidates = ref.body >= 0 && ref.body < bodies.length ? [ref.body] : bodies.map(function (b, i) {
            return i;
        });
        let found = null;
        candidates.forEach(function (index) {
            facesOf(index).forEach(function (f) {
                const off = Math.hypot(f.centre[0] - ref.centre[0], f.centre[1] - ref.centre[1], f.centre[2] - ref.centre[2]);
                if (!found && off < EDGE_TOLERANCE && Math.abs(f.area - ref.area) < Math.max(EDGE_TOLERANCE, ref.area * 1e-6)) {
                    found = { body: index, face: f.face };
                }
            });
        });
        if (!found && ref.sig) {
            let best = Infinity;
            candidates.forEach(function (index) {
                facesOf(index).forEach(function (f) {
                    const off = Math.hypot(f.centre[0] - ref.centre[0], f.centre[1] - ref.centre[1], f.centre[2] - ref.centre[2]);
                    if (off < best && surfaceAt(oc, f.face, f.centre).key === ref.sig) {
                        best = off;
                        found = { body: index, face: f.face };
                    }
                });
            });
        }
        if (!found) {
            throw new Error('A face this feature was put on is no longer there. Edit the feature and pick the face again');
        }
        return found;
    });
}

// Face references with their surface key added (on OK), or resolved to
// where the faces are now (for editing): see describeEdgeRefs
export function describeFaceRefs(oc, bodies, refs, resolve) {
    return refs.map(function (ref) {
        try {
            const found = findFaces(oc, bodies, [ref])[0];
            const reversed = found.face.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED;
            const info = faceInfo(oc, found.face, reversed);
            const sig = surfaceAt(oc, found.face, info.centre).key;
            return resolve ? { body: found.body, centre: info.centre, area: info.area, sig: sig } : Object.assign({}, ref, { sig: sig });
        } catch (err) {
            return resolve ? null : ref;
        }
    });
}

// feature: { faces: [ref], thickness, direction: "inside" | "outside" }:
// hollow the solid, leaving walls `thickness` thick, open at the picked
// faces. report: see onEdges (optional).
export function shell(oc, bodies, feature, report) {
    const thickness = Number(feature.thickness);
    if (!(thickness > 0)) {
        throw new Error('The wall thickness must be larger than zero');
    }
    const picked = findFaces(oc, bodies, feature.faces);
    if (!picked.length) {
        throw new Error('Pick the faces to remove: the shell is open there');
    }
    return bodies.map(function (body, index) {
        const faces = picked.filter(function (p) {
            return p.body === index;
        }).map(function (p) {
            return p.face;
        });
        if (!faces.length) {
            return body;
        }
        const list = new oc.NCollection_List_TopoDS_Shape(faces);
        const maker = new oc.BRepOffsetAPI_MakeThickSolid();
        const progress = new oc.Message_ProgressRange();
        try {
            maker.MakeThickSolidByJoin(body, list, feature.direction === 'outside' ? thickness : -thickness, 1e-3,
                oc.BRepOffset_Mode.BRepOffset_Skin, false, false, oc.GeomAbs_JoinType.GeomAbs_Intersection, false, progress);
            if (!maker.IsDone()) {
                throw new Error('fail');
            }
            const made = maker.Shape();
            // Walls that do not fit can come back as the solid unchanged
            const before = volume(oc, body);
            const after = volume(oc, made);
            const changed = after > 0 && Math.abs(after - before) > before * 1e-6;
            if (!changed || !isSound(oc, made)) {
                made.delete();
                throw new Error('fail');
            }
            if (report) {
                report.fresh[index] = freshFaces(oc, maker, body, made);
            }
            return made;
        } catch (err) {
            throw new Error('The shell could not be built: the walls may be thicker than a rounded corner or a thin part of the solid allows. Try a thinner wall');
        } finally {
            [progress, maker, list].forEach(function (x) {
                x.delete();
            });
        }
    });
}

// Where the referenced edges are now ([{ body, mid, length } or null]),
// for re-selecting them when a feature is edited after an upstream change
export function resolveEdges(oc, bodies, refs) {
    return refs.map(function (ref) {
        try {
            const found = findEdges(oc, bodies, [ref])[0];
            return { body: found.body, mid: edgeMiddle(oc, found.edge), length: edgeLength(oc, found.edge), sig: ref.sig };
        } catch (err) {
            return null;
        }
    });
}

// Add the description (sig) to edge references picked in the model
export function describeEdgeRefs(oc, bodies, refs) {
    return refs.map(function (ref) {
        try {
            const found = findEdges(oc, bodies, [ref])[0];
            return Object.assign({}, ref, { sig: edgeSignature(oc, bodies[found.body], found.edge) });
        } catch (err) {
            return ref;
        }
    });
}

// OpenCascade sometimes reports a fillet or chamfer as done and hands back a
// solid with faces that are missing or turned inside out (a chamfer wider
// than the fillet it runs into does this). Such a result must never reach
// the model: check the topology, and that every face can be meshed.
function isSound(oc, shape) {
    const analyzer = new oc.BRepCheck_Analyzer(shape, true, false, false);
    const valid = analyzer.IsValid();
    analyzer.delete();
    if (!valid) {
        return false;
    }
    const mesher = new oc.BRepMesh_IncrementalMesh(shape, 0.1, false, 0.3, false);
    mesher.delete();
    let sound = true;
    const explorer = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE);
    for (; explorer.More() && sound; explorer.Next()) {
        sound = faceTriangles(oc, oc.TopoDS.Face(explorer.Current())).tris.length > 0;
    }
    explorer.delete();
    return sound;
}

// Which faces of a fillet or chamfer result are new: the rounds and bevels,
// corner blends included. A face is old when it is a face of the body
// before, or what the maker turned one into (a trimmed neighbour). One flag
// per face of `after`, in TopExp order, which is the order describe() lists
// the faces in.
function freshFaces(oc, maker, before, after) {
    const old = [];
    const explorer = new oc.TopExp_Explorer(before, oc.TopAbs_ShapeEnum.TopAbs_FACE);
    for (; explorer.More(); explorer.Next()) {
        const face = explorer.Current();
        old.push(face);
        const modified = maker.Modified(face);
        while (!modified.IsEmpty()) {
            old.push(modified.First());
            modified.RemoveFirst();
        }
        modified.delete();
    }
    explorer.delete();
    const fresh = [];
    const faces = new oc.TopExp_Explorer(after, oc.TopAbs_ShapeEnum.TopAbs_FACE);
    for (; faces.More(); faces.Next()) {
        const face = faces.Current();
        fresh.push(!old.some(function (o) {
            return o.IsSame(face);
        }));
        face.delete();
    }
    faces.delete();
    old.forEach(function (o) {
        o.delete();
    });
    return fresh;
}

// Shared by fillet and chamfer: `make(body, edges)` returns a built maker;
// run it on every body that has picked edges and return the new body list.
// With `report` ({ fresh: [] }) it also notes which faces of each new body
// are new (freshFaces), for the live preview.
function onEdges(oc, bodies, feature, what, make, report) {
    const picked = findEdges(oc, bodies, feature.edges);
    if (!picked.length) {
        throw new Error('No edge is selected');
    }
    return bodies.map(function (body, index) {
        const edges = picked.filter(function (p) {
            return p.body === index;
        }).map(function (p) {
            return p.edge;
        });
        if (!edges.length) {
            return body;
        }
        let maker = null;
        try {
            maker = make(body, edges);
            const made = maker.Shape();
            if (!isSound(oc, made)) {
                made.delete();
                throw new Error('The ' + what + ' does not fit on these edges: it is too large for the faces next to them. Try a smaller size');
            }
            if (report) {
                report.fresh[index] = freshFaces(oc, maker, body, made);
            }
            return made;
        } catch (err) {
            // OpenCascade gives no reason; the usual one is a size that does not fit
            throw new Error(err && err.message && !/WebAssembly/.test(String(err)) ? err.message
                : 'The ' + what + ' could not be built on these edges. Try a smaller size');
        } finally {
            if (maker) {
                maker.delete();
            }
        }
    });
}

// The tangent chains of a body's edges. A fillet or chamfer put on one edge
// runs on along every edge that continues it smoothly (round a rounded
// corner, say), so a click on one edge of a rounded outline does the whole
// outline. OpenCascade's own fillet builder is asked which edges it would
// take, so what the app highlights is what gets built.
// edges: the body's edges as describe() lists them ({ mid, length }).
// Returns one chain number per edge; edges of one chain share the number.
export function edgeChains(oc, body, edges) {
    const chain = edges.map(function () {
        return -1;
    });
    let shapes;
    try {
        shapes = findEdges(oc, [body], edges.map(function (e) {
            return { body: 0, mid: e.mid, length: e.length };
        })).map(function (f) {
            return f.edge;
        });
    } catch (err) {
        return edges.map(function (e, i) {
            return i; // every edge on its own
        });
    }
    const maker = new oc.BRepFilletAPI_MakeFillet(body);
    let next = 0;
    for (let i = 0; i < shapes.length; i++) {
        if (chain[i] >= 0) {
            continue;
        }
        const id = next++;
        chain[i] = id;
        const before = maker.NbContours();
        try {
            maker.Add(1, shapes[i]);
        } catch (err) {
            continue; // an edge between two smooth faces: nothing to round
        }
        const contour = maker.NbContours();
        if (contour === before) {
            continue;
        }
        const count = maker.NbEdges(contour);
        for (let j = 1; j <= count; j++) {
            const edge = maker.Edge(contour, j);
            for (let k = 0; k < shapes.length; k++) {
                if (chain[k] < 0 && shapes[k].IsSame(edge)) {
                    chain[k] = id;
                    break;
                }
            }
            edge.delete();
        }
    }
    maker.delete();
    return chain;
}

// feature: { edges: [ref], radius }; report: see onEdges (optional)
export function fillet(oc, bodies, feature, report) {
    const radius = Number(feature.radius);
    if (!(radius > 0)) {
        throw new Error('The fillet radius must be larger than zero');
    }
    return onEdges(oc, bodies, feature, 'fillet', function (body, edges) {
        const maker = new oc.BRepFilletAPI_MakeFillet(body);
        edges.forEach(function (edge) {
            maker.Add(radius, edge);
        });
        maker.Build();
        if (!maker.IsDone()) {
            maker.delete();
            throw new Error('The fillet could not be built on these edges. Try a smaller radius');
        }
        return maker;
    }, report);
}

// feature: { edges: [ref], distance }; report: see onEdges (optional)
export function chamfer(oc, bodies, feature, report) {
    const distance = Number(feature.distance);
    if (!(distance > 0)) {
        throw new Error('The chamfer distance must be larger than zero');
    }
    return onEdges(oc, bodies, feature, 'chamfer', function (body, edges) {
        const maker = new oc.BRepFilletAPI_MakeChamfer(body);
        edges.forEach(function (edge) {
            maker.Add(distance, edge);
        });
        maker.Build();
        if (!maker.IsDone()) {
            maker.delete();
            throw new Error('The chamfer could not be built on these edges. Try a smaller distance');
        }
        return maker;
    }, report);
}

/* ================= hole ================= */
// The outline of half a hole as [radius, depth] pairs, depth measured into
// the material from the face. It starts a little above the face so the cut
// leaves no skin, and is spun round the axis to make the tool.
function holeProfile(feature, deep) {
    const r = Number(feature.diameter) / 2;
    if (!(r > 0)) {
        throw new Error('The hole diameter must be larger than zero');
    }
    const depth = feature.through ? deep : Number(feature.depth);
    if (!(depth > 0)) {
        throw new Error('The hole depth must be larger than zero');
    }
    const above = -1;
    const profile = [[0, above]];
    if (feature.kind === 'counterbore') {
        const rc = Number(feature.cbDiameter) / 2;
        const dc = Number(feature.cbDepth);
        if (!(rc > r) || !(dc > 0) || !(dc < depth)) {
            throw new Error('The counterbore must be wider than the hole and shallower than it');
        }
        profile.push([rc, above], [rc, dc], [r, dc]);
    } else if (feature.kind === 'countersink') {
        const rs = Number(feature.csDiameter) / 2;
        const half = (Number(feature.csAngle) || 90) / 2 * Math.PI / 180;
        const hs = (rs - r) / Math.tan(half);
        if (!(rs > r) || !(half > 0.05 && half < 1.5) || !(hs < depth)) {
            throw new Error('The countersink must be wider than the hole and fit inside its depth');
        }
        profile.push([rs, above], [rs, 0], [r, hs]);
    } else {
        profile.push([r, above]);
    }
    profile.push([r, depth]);
    if (feature.drillPoint && !feature.through) {
        // The cone a twist drill leaves: 118 degrees between its lips
        profile.push([0, depth + r / Math.tan(59 * Math.PI / 180)]);
    } else {
        profile.push([0, depth]);
    }
    return profile;
}

// The solid all holes of a feature remove.
//   feature: { kind: "simple" | "counterbore" | "countersink", diameter,
//              depth, through, drillPoint, flip, cbDiameter, cbDepth,
//              csDiameter, csAngle }
// The holes go into the material: against the sketch plane normal, or along
// it with flip.
export function holeTool(oc, bodies, feature, sketch) {
    const frame = planeFrame(sketch.plane);
    if (!frame) {
        throw new Error('The sketch plane could not be found');
    }
    const points = holePoints(sketch);
    if (!points.length) {
        throw new Error('The sketch has no points to drill at. Place them with the Point tool');
    }
    if (feature.through && !bodies.length) {
        throw new Error('Through All needs a solid to go through');
    }
    const profile = holeProfile(feature, feature.through ? reach(oc, bodies, frame) : 0);
    const sign = feature.flip ? 1 : -1;
    const dir = frame.n.map(function (c) {
        return c * sign;
    });
    let tool = null;
    points.forEach(function (point) {
        const base = toWorld(frame, point.x, point.y);
        const corners = profile.map(function (p) {
            return pnt(oc, [
                base[0] + frame.x[0] * p[0] + dir[0] * p[1],
                base[1] + frame.x[1] * p[0] + dir[1] * p[1],
                base[2] + frame.x[2] * p[0] + dir[2] * p[1]
            ]);
        });
        const wireMaker = new oc.BRepBuilderAPI_MakeWire();
        corners.forEach(function (corner, i) {
            const edgeMaker = new oc.BRepBuilderAPI_MakeEdge(corner, corners[(i + 1) % corners.length]);
            wireMaker.Add(edgeMaker.Edge());
            edgeMaker.delete();
        });
        const faceMaker = new oc.BRepBuilderAPI_MakeFace(wireMaker.Wire(), true);
        const origin = pnt(oc, base);
        const dirVec = vec(oc, dir);
        const axisDir = new oc.gp_Dir(dirVec);
        const axis = new oc.gp_Ax1(origin, axisDir);
        const revolve = new oc.BRepPrimAPI_MakeRevol(faceMaker.Face(), axis, Math.PI * 2, false);
        const solid = revolve.Shape();
        [revolve, axis, axisDir, dirVec, origin, faceMaker, wireMaker].concat(corners).forEach(function (o) {
            o.delete();
        });
        tool = tool ? boolean(oc, 'join', tool, solid) : solid;
    });
    return tool;
}

export function hole(oc, bodies, feature, sketch) {
    if (!bodies.length) {
        throw new Error('There is no solid body to drill yet');
    }
    const tool = holeTool(oc, bodies, feature, sketch);
    return bodies.map(function (body) {
        return boolean(oc, 'cut', body, tool);
    }).filter(function (body) {
        return !isEmpty(oc, body);
    });
}

/* ================= exchange and inspection ================= */
// Several bodies as one shape, for writing them to one file
function together(oc, bodies) {
    if (bodies.length === 1) {
        return bodies[0];
    }
    const builder = new oc.TopoDS_Builder();
    const compound = new oc.TopoDS_Compound();
    builder.MakeCompound(compound);
    bodies.forEach(function (body) {
        builder.Add(compound, body);
    });
    builder.delete();
    return compound;
}

// The part as the text of a STEP or BREP file
export function exportText(oc, bodies, format) {
    if (!bodies.length) {
        throw new Error('There is no solid to export yet');
    }
    const shape = together(oc, bodies);
    if (format === 'step') {
        return toSTEP(oc, shape);
    }
    if (format === 'brep') {
        const path = '/export.brep';
        const progress = new oc.Message_ProgressRange();
        oc.BRepTools.Write(shape, path, progress);
        progress.delete();
        const text = oc.FS.readFile(path, { encoding: 'utf8' });
        oc.FS.unlink(path);
        return text;
    }
    throw new Error('Unknown export format');
}

// The solids in the text of a STEP file
export function importSTEP(oc, text) {
    const path = '/import.step';
    oc.FS.writeFile(path, text);
    const reader = new oc.STEPControl_Reader();
    const progress = new oc.Message_ProgressRange();
    let shape = null;
    try {
        reader.ReadFile(path);
        if (reader.NbRootsForTransfer() > 0) {
            reader.TransferRoots(progress);
            shape = reader.OneShape();
        }
    } finally {
        oc.FS.unlink(path);
        progress.delete();
        reader.delete();
    }
    if (!shape || shape.IsNull()) {
        throw new Error('No geometry could be read from this STEP file');
    }
    const solids = [];
    const explorer = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_SOLID);
    for (; explorer.More(); explorer.Next()) {
        solids.push(oc.TopoDS.Solid(explorer.Current()));
    }
    explorer.delete();
    if (!solids.length) {
        throw new Error('This STEP file holds surfaces or curves but no solid');
    }
    return solids;
}

// Volume, surface area, centre of mass and overall size of the part
export function massProperties(oc, bodies) {
    let vol = 0;
    let area = 0;
    const centre = [0, 0, 0];
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    bodies.forEach(function (body) {
        const props = new oc.GProp_GProps();
        oc.BRepGProp.VolumeProperties(body, props, false, false, false);
        const v = props.Mass();
        const c = props.CentreOfMass();
        centre[0] += c.X() * v;
        centre[1] += c.Y() * v;
        centre[2] += c.Z() * v;
        vol += v;
        c.delete();
        props.delete();
        const surface = new oc.GProp_GProps();
        oc.BRepGProp.SurfaceProperties(body, surface, false, false);
        area += surface.Mass();
        surface.delete();
        const box = new oc.Bnd_Box();
        oc.BRepBndLib.AddOptimal(body, box, false, false);
        if (!box.IsVoid()) {
            [box.GetXMin(), box.GetYMin(), box.GetZMin()].forEach(function (v2, i) {
                min[i] = Math.min(min[i], v2);
            });
            [box.GetXMax(), box.GetYMax(), box.GetZMax()].forEach(function (v2, i) {
                max[i] = Math.max(max[i], v2);
            });
        }
        box.delete();
    });
    return {
        bodies: bodies.length,
        volume: vol,
        area: area,
        centre: vol > 0 ? centre.map(function (c) {
            return c / vol;
        }) : [0, 0, 0],
        size: bodies.length ? [max[0] - min[0], max[1] - min[1], max[2] - min[2]] : [0, 0, 0]
    };
}

// The face of a body by its index in describe()
function faceAt(oc, body, index) {
    const explorer = new oc.TopExp_Explorer(body, oc.TopAbs_ShapeEnum.TopAbs_FACE);
    let i = 0;
    let face = null;
    for (; explorer.More() && !face; explorer.Next(), i++) {
        if (i === index) {
            face = oc.TopoDS.Face(explorer.Current());
        }
    }
    explorer.delete();
    return face;
}

// The shape a picked item stands for: { type: "face", body, index },
// { type: "edge", body, mid, length } or { type: "body", body } (a whole solid)
export function itemShape(oc, bodies, item) {
    if (!bodies[item.body]) {
        throw new Error('The selection no longer exists');
    }
    if (item.type === 'body') {
        return bodies[item.body];
    }
    if (item.type === 'edge') {
        return findEdges(oc, bodies, [item])[0].edge;
    }
    const face = faceAt(oc, bodies[item.body], item.index);
    if (!face) {
        throw new Error('The selection no longer exists');
    }
    return face;
}

// Shortest distance between two shapes and the two points where it is
// found: { distance, p1, p2 }
export function shapeDistance(oc, s1, s2) {
    const measure = new oc.BRepExtrema_DistShapeShape(s1, s2);
    const ok = measure.IsDone() && measure.NbSolution() > 0;
    const out = { distance: ok ? measure.Value() : NaN, p1: null, p2: null };
    if (ok) {
        const p1 = measure.PointOnShape1(1);
        const p2 = measure.PointOnShape2(1);
        out.p1 = [p1.X(), p1.Y(), p1.Z()];
        out.p2 = [p2.X(), p2.Y(), p2.Z()];
        p1.delete();
        p2.delete();
    }
    measure.delete();
    if (!ok) {
        throw new Error('The distance could not be measured');
    }
    return out;
}

// Shortest distance between two picked items (see itemShape), with the
// closest points: { distance, p1, p2 }
export function closestBetween(oc, bodies, a, b) {
    return shapeDistance(oc, itemShape(oc, bodies, a), itemShape(oc, bodies, b));
}

// Shortest distance between two picked items, in mm
export function distanceBetween(oc, bodies, a, b) {
    return closestBetween(oc, bodies, a, b).distance;
}
