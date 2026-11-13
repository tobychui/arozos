/*
    3D Modeler - kernel side of drawings: hidden line projection

    A drawing view is the exact outline of a part (or of the placed
    components of an assembly) seen along one direction, with the edges the
    model hides from that side drawn apart. OpenCascade's hidden line
    remover does the work (HLRBRep_Algo, HLRAlgo_Projector,
    HLRBRep_HLRToShape); this file turns its result into plain 2D data the
    main thread draws, dimensions and exports.

    Coordinates of the result are the projector's: X along `xdir`, Y along
    dir x xdir (so with dir pointing at the viewer, X runs right and Y up on
    the paper), in model millimetres. The view's scale and place on the
    sheet are the drawing's business, not the kernel's.

    Memory: HLRBRep_HLRToShape keeps a handle on the algorithm, so the
    algorithm is freed with it (deleting both would free it twice).
*/

import { placed } from './assembly.js';

// The result compounds of HLRBRep_HLRToShape: visible or hidden, and which
// kind of edge. "sharp" edges are real model edges, "smooth" the tangent
// edges between faces that meet smoothly (fillets), "outline" the
// silhouettes of curved faces (the sides of a cylinder seen from the side).
const SETS = [
    ['VCompound', true, 'sharp'],
    ['Rg1LineVCompound', true, 'smooth'],
    ['OutLineVCompound', true, 'outline'],
    ['HCompound', false, 'sharp'],
    ['Rg1LineHCompound', false, 'smooth'],
    ['OutLineHCompound', false, 'outline']
];

function round(v) {
    return Math.round(v * 1e5) / 1e5;
}

// One projected edge as 2D data:
//   { visible, kind, type: "line" | "circle" | "curve", pts: [x, y, x, y, ...] }
// plus for a circle or an arc: c (centre), r, closed. Lines carry their two
// exact end points as pts; curves and arcs are polylines fine enough that
// no point strays more than `deflection` from the true curve.
function edge2d(oc, edge, visible, kind, deflection) {
    const curve = new oc.BRepAdaptor_Curve(edge);
    const type = curve.GetType();
    const out = { visible: visible, kind: kind, type: 'curve', pts: [] };
    const first = curve.FirstParameter();
    const last = curve.LastParameter();
    const push = function (p) {
        out.pts.push(round(p.X()), round(p.Y()));
        p.delete();
    };
    if (type === oc.GeomAbs_CurveType.GeomAbs_Line) {
        out.type = 'line';
        push(curve.Value(first));
        push(curve.Value(last));
    } else {
        const points = new oc.GCPnts_TangentialDeflection(curve, 0.08, deflection);
        const count = points.NbPoints();
        for (let i = 1; i <= count; i++) {
            push(points.Value(i));
        }
        points.delete();
        if (type === oc.GeomAbs_CurveType.GeomAbs_Circle) {
            const circle = curve.Circle();
            const centre = circle.Location();
            out.type = 'circle';
            out.c = [round(centre.X()), round(centre.Y())];
            out.r = round(circle.Radius());
            const n = out.pts.length;
            out.closed = n >= 4 && Math.hypot(out.pts[0] - out.pts[n - 2], out.pts[1] - out.pts[n - 1]) < 1e-6;
            centre.delete();
            circle.delete();
        }
    }
    curve.delete();
    // A degenerate piece (a point) is of no use on paper
    if (out.pts.length < 4) {
        return null;
    }
    return out;
}

function boundsOf(edges) {
    let box = null;
    edges.forEach(function (e) {
        for (let i = 0; i < e.pts.length; i += 2) {
            const x = e.pts[i];
            const y = e.pts[i + 1];
            if (!box) {
                box = [x, y, x, y];
            } else {
                box[0] = Math.min(box[0], x);
                box[1] = Math.min(box[1], y);
                box[2] = Math.max(box[2], x);
                box[3] = Math.max(box[3], y);
            }
        }
    });
    return box;
}

/*
    Project shapes for a drawing view.

    items: [{ shapes: [TopoDS_Shape], matrix }] where matrix (or null) places
        the shapes, as for assembly components
    opts:
        dir         [x, y, z] the direction from the model towards the viewer
        xdir        [x, y, z] the direction that runs right on the paper,
                    square to dir
        hidden      true to return the hidden edges too
        smooth      true to return the tangent edges between smooth faces
        deflection  largest gap (model mm) between a curve and its polyline

    Returns { edges, box: [xmin, ymin, xmax, ymax] | null }.
*/
export function project(oc, items, opts) {
    const owned = [];
    const builder = new oc.TopoDS_Builder();
    const compound = new oc.TopoDS_Compound();
    builder.MakeCompound(compound);
    let count = 0;
    items.forEach(function (item) {
        item.shapes.forEach(function (shape) {
            const s = item.matrix ? placed(oc, shape, item.matrix) : shape;
            if (s !== shape) {
                owned.push(s);
            }
            builder.Add(compound, s);
            count++;
        });
    });
    builder.delete();
    if (!count) {
        compound.delete();
        return { edges: [], box: null };
    }
    const d = opts.dir;
    const x = opts.xdir;
    const deflection = Math.max(1e-4, opts.deflection || 0.02);
    const algo = new oc.HLRBRep_Algo();
    const origin = new oc.gp_Pnt(0, 0, 0);
    const n = new oc.gp_Dir(d[0], d[1], d[2]);
    const xd = new oc.gp_Dir(x[0], x[1], x[2]);
    const ax = new oc.gp_Ax2(origin, n, xd);
    const projector = new oc.HLRAlgo_Projector(ax);
    const edges = [];
    let hlr = null;
    try {
        algo.Add(compound, 0);
        algo.Projector(projector);
        algo.Update();
        algo.Hide();
        hlr = new oc.HLRBRep_HLRToShape(algo);
        SETS.forEach(function (set) {
            const visible = set[1];
            const kind = set[2];
            if ((!visible && !opts.hidden) || (kind === 'smooth' && !opts.smooth)) {
                return;
            }
            const shape = hlr[set[0]]();
            if (!shape.IsNull()) {
                const explorer = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE);
                for (; explorer.More(); explorer.Next()) {
                    const edge = oc.TopoDS.Edge(explorer.Current());
                    try {
                        const e = edge2d(oc, edge, visible, kind, deflection);
                        if (e) {
                            edges.push(e);
                        }
                    } catch (err) {
                        // A piece the adaptor cannot read is left out
                    }
                    edge.delete();
                }
                explorer.delete();
            }
            shape.delete();
        });
    } finally {
        if (hlr) {
            hlr.delete(); // frees the algorithm too (see the header)
        } else {
            algo.delete();
        }
        [projector, ax, xd, n, origin, compound].forEach(function (o) {
            o.delete();
        });
        owned.forEach(function (s) {
            s.delete();
        });
    }
    return { edges: edges, box: boundsOf(edges) };
}
