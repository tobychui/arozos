/*
    3D Modeler - names of faces (PROPOSAL.md 14.5, phase A)

    Every face of every solid gets a name each time a feature is replayed,
    built from what made it, never from an index:
      - a face that is the same face as before the feature keeps its name;
      - a face that lies on the surface of a named face of before and holds
        a point of it (a face trimmed, split or merged by the feature) takes
        that name - a face cut in two gives both pieces the name;
      - a new face is named by its role in the feature: an extrusion's caps
        "<id>/start", "<id>/end+", "<id>/end-", its sides "<id>/side:<curve
        id>" for the sketch curve swept; other features "<id>/new"; an
        imported solid "<id>/face:<n>" in the file's order.
    An edge is named by the pair of names of the faces it lies between.

    References (fillet edges, shell faces, a sketch on a face) keep the
    names next to their position records, and are found by name first when
    the position no longer matches (occt.js findEdges, findFaces, followFace):
    that makes them follow a face that moved far or turned.

    Names are worked out once per cache entry of rebuild.js. Embind objects
    made here are released.
*/

import { faceInfoOf, surfaceKeyOf, distanceTo, faceTriangles, onSketchCurve } from './occt.js';
import { planeFrame } from './profile.js';
import { curves as sketchCurves } from '../sketch/model.js';

function facesOf(oc, shape) {
    const out = [];
    const explorer = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE);
    for (; explorer.More(); explorer.Next()) {
        const current = explorer.Current();
        out.push(oc.TopoDS.Face(current));
        current.delete();
    }
    explorer.delete();
    return out;
}

function reversed(oc, face) {
    return face.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED;
}

// A cheap place key for a face (its centre of mass, rounded): faces that
// are the same face always share it, so IsSame is only asked within a key
function placeKey(info) {
    return info.centre.map(function (v) {
        return Math.round(v * 1e3);
    }).join(',') + ':' + Math.round(info.area * 1e3);
}

// A point inside a face, on its surface: the centre of its largest mesh
// triangle pulled onto the face. Null when the face does not mesh.
function pointIn(oc, face) {
    const mesher = new oc.BRepMesh_IncrementalMesh(face, 0.5, false, 0.5, false);
    mesher.delete();
    const mesh = faceTriangles(oc, face);
    if (!mesh.tris.length) {
        return null;
    }
    let best = -1;
    let at = null;
    for (let i = 0; i < mesh.tris.length; i += 3) {
        const p = [mesh.tris[i], mesh.tris[i + 1], mesh.tris[i + 2]].map(function (k) {
            return [mesh.points[k * 3], mesh.points[k * 3 + 1], mesh.points[k * 3 + 2]];
        });
        const u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
        const v = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
        const size = Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]);
        if (size > best) {
            best = size;
            at = [(p[0][0] + p[1][0] + p[2][0]) / 3, (p[0][1] + p[1][1] + p[2][1]) / 3, (p[0][2] + p[1][2] + p[2][2]) / 3];
        }
    }
    // onto the face itself (a triangle of a curved face lies a little off it)
    const point = new oc.gp_Pnt(at[0], at[1], at[2]);
    const maker = new oc.BRepBuilderAPI_MakeVertex(point);
    const vertex = maker.Vertex();
    const measure = new oc.BRepExtrema_DistShapeShape(vertex, face);
    let out = at;
    if (measure.IsDone() && measure.NbSolution() > 0) {
        const q = measure.PointOnShape2(1);
        out = [q.X(), q.Y(), q.Z()];
        q.delete();
    }
    [measure, vertex, maker, point].forEach(function (x) {
        x.delete();
    });
    return out;
}

// The role of a new face of an extrusion from `sketch`: a cap (by which
// side of the sketch plane it lies) or the side swept from a sketch curve
export function extrudeRoles(oc, sketch) {
    const frame = planeFrame(sketch.plane);
    if (!frame) {
        return null;
    }
    const curves = sketchCurves({ geometry: sketch.geometry || [], constraints: [] }).filter(function (c) {
        return !c.construction;
    });
    return function (face) {
        const info = faceInfoOf(oc, face, reversed(oc, face));
        if (info.type === 'plane' && Math.abs(Math.abs(info.normal[0] * frame.n[0] + info.normal[1] * frame.n[1] + info.normal[2] * frame.n[2]) - 1) < 1e-6) {
            const off = (info.origin[0] - frame.o[0]) * frame.n[0] + (info.origin[1] - frame.o[1]) * frame.n[1] + (info.origin[2] - frame.o[2]) * frame.n[2];
            return Math.abs(off) < 1e-6 ? 'start' : off > 0 ? 'end+' : 'end-';
        }
        // A side: its edges, seen along the sketch normal, lie on the curve
        // it was swept from
        const votes = {};
        const edges = new oc.TopExp_Explorer(face, oc.TopAbs_ShapeEnum.TopAbs_EDGE);
        for (; edges.More(); edges.Next()) {
            const current = edges.Current();
            const edge = oc.TopoDS.Edge(current);
            current.delete();
            if (!oc.BRep_Tool.Degenerated(edge)) {
                const adaptor = new oc.BRepAdaptor_Curve(edge);
                const m = adaptor.Value((adaptor.FirstParameter() + adaptor.LastParameter()) / 2);
                const d = [m.X() - frame.o[0], m.Y() - frame.o[1], m.Z() - frame.o[2]];
                m.delete();
                adaptor.delete();
                const p = [d[0] * frame.x[0] + d[1] * frame.x[1] + d[2] * frame.x[2], d[0] * frame.y[0] + d[1] * frame.y[1] + d[2] * frame.y[2]];
                const tol = 1e-5 * (1 + Math.hypot(p[0], p[1]));
                curves.forEach(function (c) {
                    if (onSketchCurve(c, p, tol)) {
                        votes[c.id] = (votes[c.id] || 0) + 1;
                    }
                });
            }
            edge.delete();
        }
        edges.delete();
        let best = null;
        Object.keys(votes).forEach(function (id) {
            if (!best || votes[id] > votes[best]) {
                best = id;
            }
        });
        return best ? 'side:' + best : null;
    };
}

// The names of the faces of `after` (one list per body, TopExp order),
// given the bodies before the feature and their names. roleOf(face) names
// a new face's role, or null for "new"; `numbered` numbers new faces in
// order (an import).
export function nameBodies(oc, featureId, before, beforeNames, after, roleOf, numbered) {
    const old = [];
    before.forEach(function (body, i) {
        if (after.indexOf(body) >= 0) {
            return; // kept as it was: its names are copied below
        }
        facesOf(oc, body).forEach(function (face, j) {
            old.push({ face: face, name: beforeNames && beforeNames[i] ? beforeNames[i][j] || null : null, info: null, key: null, surface: null });
        });
    });
    const byPlace = new Map();
    const infoOf = function (o) {
        if (!o.info) {
            o.info = faceInfoOf(oc, o.face, reversed(oc, o.face));
            o.key = placeKey(o.info);
        }
        return o.info;
    };
    old.forEach(function (o) {
        infoOf(o);
        const list = byPlace.get(o.key) || [];
        list.push(o);
        byPlace.set(o.key, list);
    });
    let count = 0;
    const names = after.map(function (body) {
        const kept = before.indexOf(body);
        if (kept >= 0) {
            return beforeNames && beforeNames[kept] ? beforeNames[kept].slice() : [];
        }
        return facesOf(oc, body).map(function (face) {
            let name = null;
            const info = faceInfoOf(oc, face, reversed(oc, face));
            const same = (byPlace.get(placeKey(info)) || []).find(function (o) {
                return o.face.IsSame(face);
            });
            if (same && same.name) {
                name = same.name;
            }
            if (!name && old.length) {
                // A trimmed, split or merged face: the named face of before
                // on the same surface that holds a point of it
                const key = surfaceKeyOf(oc, face, info.centre);
                const hosts = old.filter(function (o) {
                    if (!o.name) {
                        return false;
                    }
                    if (o.surface === null) {
                        o.surface = surfaceKeyOf(oc, o.face, o.info.centre);
                    }
                    return o.surface === key;
                });
                if (hosts.length) {
                    const p = pointIn(oc, face);
                    const host = p ? hosts.find(function (o) {
                        return distanceTo(oc, o.face, p) < 1e-5;
                    }) : null;
                    if (host) {
                        name = host.name;
                    }
                }
            }
            if (!name) {
                count++;
                const role = numbered ? 'face:' + count : roleOf ? roleOf(face) : null;
                name = featureId + '/' + (role || 'new');
            }
            face.delete();
            return name;
        });
    });
    old.forEach(function (o) {
        o.face.delete();
    });
    return names;
}

// The names of the two faces an edge of a description lies between, for
// every edge: from describe()'s faces (each lists its edges) and the face
// names. [[name, name], ...] sorted, one entry per edge.
export function edgeNames(description, faceNames) {
    const out = description.edges.map(function () {
        return [];
    });
    description.faces.forEach(function (face, i) {
        const name = faceNames[i];
        (face.edges || []).forEach(function (e) {
            if (name && out[e].indexOf(name) < 0) {
                out[e].push(name);
            }
        });
    });
    return out.map(function (pair) {
        return pair.sort();
    });
}
