/*
    3D Modeler - silhouettes of round faces

    A cylinder, a cone or a fillet has edges only where it meets other
    faces, so a hole seen from the side shows two circles and nothing
    between them. Its outline, where the surface turns away from the eye,
    depends on the view: these are the edges of the face's triangles
    between one that faces the camera and one that faces away.

    silhouetteSource(positions, indices, faces)
        -> { edges, a, b, t1, t2, normals, centres } or null
        The inner edges of every face that is not flat, each with the two
        triangles beside it; worked out once per body. Vertices are matched
        by position, so the seam of a closed cylinder (where its
        triangulation repeats points) counts too.
    silhouetteSegments(src, view, perspective, out, distances) -> count
        The edges on the outline for a view: `view` is the direction the
        camera looks along (orthographic) or the camera position
        (perspective), in the body's own coordinates. Writes count segments
        into `out` (6 numbers each) and their running lengths into
        `distances` (for dashed lines).
*/

export function silhouetteSource(positions, indices, faces) {
    if (!positions || !indices || !faces) {
        return null;
    }
    const a = [];
    const b = [];
    const t1 = [];
    const t2 = [];
    const triangles = indices.length / 3;
    const normals = new Float32Array(triangles * 3);
    const centres = new Float32Array(triangles * 3);
    faces.forEach(function (face) {
        if (face.type === 'plane' || !(face.count > 0)) {
            return;
        }
        // One id per position, within this face
        const ids = new Map();
        const idOf = function (v) {
            const key = Math.round(positions[v * 3] * 1e5) + ',' + Math.round(positions[v * 3 + 1] * 1e5) + ',' + Math.round(positions[v * 3 + 2] * 1e5);
            let id = ids.get(key);
            if (id === undefined) {
                id = v;
                ids.set(key, id);
            }
            return id;
        };
        const open = new Map();     // edge key -> [triangle, vertex a, vertex b]
        for (let i = face.start; i < face.start + face.count; i += 3) {
            const t = i / 3;
            const v = [indices[i], indices[i + 1], indices[i + 2]];
            const p = v.map(function (k) {
                return [positions[k * 3], positions[k * 3 + 1], positions[k * 3 + 2]];
            });
            const u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
            const w = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
            const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
            const len = Math.hypot(n[0], n[1], n[2]);
            if (!(len > 0)) {
                continue; // a degenerate sliver says nothing about the outline
            }
            for (let k = 0; k < 3; k++) {
                normals[t * 3 + k] = n[k] / len;
                centres[t * 3 + k] = (p[0][k] + p[1][k] + p[2][k]) / 3;
            }
            const id = v.map(idOf);
            for (let e = 0; e < 3; e++) {
                const x = id[e];
                const y = id[(e + 1) % 3];
                if (x === y) {
                    continue;
                }
                const key = x < y ? x + ':' + y : y + ':' + x;
                const other = open.get(key);
                if (other === undefined) {
                    open.set(key, [t, v[e], v[(e + 1) % 3]]);
                } else {
                    open.delete(key);
                    a.push(other[1]);
                    b.push(other[2]);
                    t1.push(other[0]);
                    t2.push(t);
                }
            }
        }
    });
    if (!a.length) {
        return null;
    }
    return {
        edges: a.length,
        a: Uint32Array.from(a), b: Uint32Array.from(b), t1: Uint32Array.from(t1), t2: Uint32Array.from(t2),
        normals: normals, centres: centres, positions: positions
    };
}

export function silhouetteSegments(src, view, perspective, out, distances) {
    const n = src.normals;
    const c = src.centres;
    const p = src.positions;
    let count = 0;
    let run = 0;
    const facing = function (t) {
        if (perspective) {
            return n[t * 3] * (c[t * 3] - view[0]) + n[t * 3 + 1] * (c[t * 3 + 1] - view[1]) + n[t * 3 + 2] * (c[t * 3 + 2] - view[2]);
        }
        return n[t * 3] * view[0] + n[t * 3 + 1] * view[1] + n[t * 3 + 2] * view[2];
    };
    for (let e = 0; e < src.edges; e++) {
        const s1 = facing(src.t1[e]);
        const s2 = facing(src.t2[e]);
        if (!(s1 * s2 < 0)) {
            continue;
        }
        const ia = src.a[e] * 3;
        const ib = src.b[e] * 3;
        const o = count * 6;
        out[o] = p[ia];
        out[o + 1] = p[ia + 1];
        out[o + 2] = p[ia + 2];
        out[o + 3] = p[ib];
        out[o + 4] = p[ib + 1];
        out[o + 5] = p[ib + 2];
        distances[count * 2] = run;
        run += Math.hypot(p[ib] - p[ia], p[ib + 1] - p[ia + 1], p[ib + 2] - p[ia + 2]);
        distances[count * 2 + 1] = run;
        count++;
    }
    return count;
}
