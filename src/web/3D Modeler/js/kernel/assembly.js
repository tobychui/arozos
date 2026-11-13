/*
    3D Modeler - kernel operations for assemblies

    The worker keeps the solids of every part an assembly uses (one
    rebuilder per part, see worker.js). These functions place copies of
    them where the components are and measure, check or export the result.

    A placement is the 16 number column-major matrix of assembly/geometry.js
    (rotation, uniform scale, translation). A component handed in here is
    { id, shapes: [TopoDS_Shape], matrix }.

    Like occt.js: every embind object made here that is not returned is
    released with .delete().
*/

import { describe, itemShape, shapeDistance, toSTEP, massProperties } from './occt.js';

// The gp_Trsf of a placement matrix
export function trsfOf(oc, m) {
    const t = new oc.gp_Trsf();
    t.SetValues(m[0], m[4], m[8], m[12], m[1], m[5], m[9], m[13], m[2], m[6], m[10], m[14]);
    return t;
}

// A copy of `shape` moved (and scaled) by a placement matrix
export function placed(oc, shape, m) {
    const t = trsfOf(oc, m);
    const maker = new oc.BRepBuilderAPI_Transform(shape, t, true, false);
    const out = maker.Shape();
    maker.delete();
    t.delete();
    return out;
}

// The solids of a component, placed: one compound (or the solid itself)
function placedComponent(oc, comp) {
    const shapes = comp.shapes.map(function (shape) {
        return placed(oc, shape, comp.matrix);
    });
    if (shapes.length === 1) {
        return shapes[0];
    }
    const builder = new oc.TopoDS_Builder();
    const compound = new oc.TopoDS_Compound();
    builder.MakeCompound(compound);
    shapes.forEach(function (shape) {
        builder.Add(compound, shape);
    });
    builder.delete();
    return compound;
}

// Shortest distance between two picked items of components, with the
// closest points, in assembly coordinates: { distance, p1, p2 }.
// a, b: { shapes, matrix, item } with item as itemShape() in occt.js takes
// it (in the part's own coordinates), or { type: "component" } for the
// whole component.
export function distance(oc, a, b) {
    const shapeOf = function (ref) {
        if (ref.item.type === 'component') {
            return placedComponent(oc, ref);
        }
        return placed(oc, itemShape(oc, ref.shapes, ref.item), ref.matrix);
    };
    const s1 = shapeOf(a);
    const s2 = shapeOf(b);
    try {
        return shapeDistance(oc, s1, s2);
    } finally {
        s1.delete();
        s2.delete();
    }
}

function boxOf(oc, shape) {
    const box = new oc.Bnd_Box();
    oc.BRepBndLib.Add(shape, box, false);
    const out = box.IsVoid() ? null : [[box.GetXMin(), box.GetYMin(), box.GetZMin()], [box.GetXMax(), box.GetYMax(), box.GetZMax()]];
    box.delete();
    return out;
}

function overlap(a, b) {
    return !!a && !!b && [0, 1, 2].every(function (k) {
        return a[0][k] <= b[1][k] && b[0][k] <= a[1][k];
    });
}

function volumeOf(oc, shape) {
    const props = new oc.GProp_GProps();
    oc.BRepGProp.VolumeProperties(shape, props, false, false, false);
    const v = props.Mass();
    props.delete();
    return v;
}

// Where components overlap: [{ a, b, volume, mesh }] for every pair whose
// shared volume is more than `minVolume` (mm3). Faces that only touch, as
// a Mate leaves them, do not count. mesh is the shared volume, to show it.
export function interference(oc, comps, minVolume) {
    const least = minVolume === undefined ? 1e-3 : minVolume;
    const placedList = comps.map(function (comp) {
        const shape = placedComponent(oc, comp);
        return { id: comp.id, shape: shape, box: boxOf(oc, shape) };
    });
    const found = [];
    try {
        for (let i = 0; i < placedList.length; i++) {
            for (let j = i + 1; j < placedList.length; j++) {
                const a = placedList[i];
                const b = placedList[j];
                if (!overlap(a.box, b.box)) {
                    continue;
                }
                const progress = new oc.Message_ProgressRange();
                const common = new oc.BRepAlgoAPI_Common(a.shape, b.shape, progress);
                progress.delete();
                if (common.IsDone()) {
                    const shape = common.Shape();
                    const volume = volumeOf(oc, shape);
                    if (volume > least) {
                        const mesh = describe(oc, shape);
                        found.push({ a: a.id, b: b.id, volume: volume, mesh: mesh });
                    }
                    shape.delete();
                }
                common.delete();
            }
        }
    } finally {
        placedList.forEach(function (p) {
            p.shape.delete();
        });
    }
    return found;
}

// All components placed in one compound (the caller deletes it)
function together(oc, comps) {
    const builder = new oc.TopoDS_Builder();
    const compound = new oc.TopoDS_Compound();
    builder.MakeCompound(compound);
    comps.forEach(function (comp) {
        comp.shapes.forEach(function (shape) {
            builder.Add(compound, placed(oc, shape, comp.matrix));
        });
    });
    builder.delete();
    return compound;
}

// The assembly as one STEP or BREP text, every component where it is
export function exportText(oc, comps, format) {
    if (!comps.length) {
        throw new Error('There is no component to export yet');
    }
    const shape = together(oc, comps);
    try {
        if (format === 'step') {
            return toSTEP(oc, shape);
        }
        if (format === 'brep') {
            const path = '/assembly.brep';
            const progress = new oc.Message_ProgressRange();
            oc.BRepTools.Write(shape, path, progress);
            progress.delete();
            const text = oc.FS.readFile(path, { encoding: 'utf8' });
            oc.FS.unlink(path);
            return text;
        }
        throw new Error('Unknown export format');
    } finally {
        shape.delete();
    }
}

// Volume, area, size and centre of gravity of the whole assembly
export function mass(oc, comps) {
    const shapes = [];
    comps.forEach(function (comp) {
        comp.shapes.forEach(function (shape) {
            shapes.push(placed(oc, shape, comp.matrix));
        });
    });
    try {
        return massProperties(oc, shapes);
    } finally {
        shapes.forEach(function (shape) {
            shape.delete();
        });
    }
}

// Every component meshed where it is, at a chosen fineness, for STL, OBJ
// and 3MF: [{ positions, indices }]
export function mesh(oc, comps, deflection, angle) {
    const out = [];
    comps.forEach(function (comp) {
        comp.shapes.forEach(function (shape) {
            const moved = placed(oc, shape, comp.matrix);
            oc.BRepTools.Clean(moved, true);
            const m = describe(oc, moved, deflection || 0.05, angle || 0.2);
            out.push({ positions: m.positions, indices: m.indices });
            moved.delete();
        });
    });
    return out;
}
