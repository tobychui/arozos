/*
    3D Modeler - part appearance

    The look of a part: a colour and a finish (plastic, metal, wood, ...),
    stored in the part document as
        appearance: { color: "#rrggbb", texture: <finish id>, scale: <mm>,
                      rotation: <degrees>, image: <data URL>,
                      faces: [face look] }
    and shown wherever the part is: the part itself, the components of
    assemblies (with their component colour, the part's finish) and the 3D
    view of the drawing panel. Without one a part has the default grey.

    Finishes with a pattern draw it on a canvas here (no image files to
    ship): a light grey pattern the colour tints, one tile per `scale` mm,
    turned by `rotation`, laid on the model by box projection (viewport.js
    gives the meshes texture coordinates in mm). The Image finish lays a
    picture the user chose the same way; it is kept in the part, made
    smaller first (a JPEG or PNG data URL).

    Painted faces (Paint Faces) keep their own colour and finish:
        { body, centre: [x, y, z], area, sig, color, texture }
    A face is found again by where it is (centre and area), or, after an
    edit moved it, as the face of the same kind (sig, faceSignature) nearest
    to where it was (matchFaces).

    The scene (lighting, reflections, shadows, ground plane, textures on or
    off) is how this viewer likes to look at models, not part of a part:
    kept in the browser (normalizeScene).
*/

export const DEFAULT_COLOR = '#bfc3c9';
export const DEFAULT_SCALE = 20;
export const MAX_IMAGE_CHARS = 3000000;  // a data URL of about 2 MB
export const MAX_FACE_LOOKS = 2000;

// id, label, the material it gives, the colour it suggests, its pattern
export const FINISHES = [
    { id: 'plain', label: 'Plain', roughness: 0.62, metalness: 0.1 },
    { id: 'matte', label: 'Matte plastic', roughness: 0.9, metalness: 0 },
    { id: 'glossy', label: 'Glossy plastic', roughness: 0.22, metalness: 0 },
    { id: 'brushed', label: 'Brushed metal', roughness: 0.38, metalness: 0.55, pattern: 'brushed', color: '#c9cdd3' },
    { id: 'polished', label: 'Polished metal', roughness: 0.14, metalness: 0.65, color: '#d4d7dc' },
    { id: 'cast', label: 'Cast metal', roughness: 0.78, metalness: 0.35, pattern: 'speckle', color: '#9da3ab' },
    { id: 'wood', label: 'Wood', roughness: 0.72, metalness: 0, pattern: 'wood', color: '#c08a52' },
    { id: 'carbon', label: 'Carbon fibre', roughness: 0.32, metalness: 0.15, pattern: 'weave', color: '#3a3d43' },
    { id: 'rubber', label: 'Rubber', roughness: 0.95, metalness: 0, pattern: 'fine', color: '#34373c' },
    { id: 'glass', label: 'Glass', roughness: 0.05, metalness: 0, opacity: 0.35, color: '#bcd7e6' },
    // A picture the user chose; white shows it in its own colours
    { id: 'image', label: 'Image', roughness: 0.6, metalness: 0, image: true, color: '#ffffff' }
];

export function finishById(id) {
    return FINISHES.filter(function (f) {
        return f.id === id;
    })[0] || FINISHES[0];
}

function hexColor(c) {
    return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : null;
}

function finite(v) {
    return typeof v === 'number' && isFinite(v);
}

const IMAGE_URL = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/;

// A clean painted face record, or null
export function normalizeFaceLook(f) {
    if (!f || typeof f !== 'object' || !Array.isArray(f.centre) || f.centre.length !== 3 ||
        !f.centre.every(finite) || !finite(f.area) || f.area < 0) {
        return null;
    }
    const finish = finishById(f.texture);
    return {
        body: Number.isInteger(f.body) && f.body >= 0 ? f.body : 0,
        centre: f.centre.slice(),
        area: f.area,
        sig: typeof f.sig === 'string' ? f.sig.slice(0, 200) : '',
        color: hexColor(f.color) || DEFAULT_COLOR,
        texture: finish.image ? 'plain' : finish.id   // faces take no pictures
    };
}

// A clean appearance record, or null for the default look
export function normalizeAppearance(a) {
    if (!a || typeof a !== 'object') {
        return null;
    }
    const color = hexColor(a.color) || DEFAULT_COLOR;
    const image = typeof a.image === 'string' && a.image.length <= MAX_IMAGE_CHARS && IMAGE_URL.test(a.image) ? a.image : null;
    let texture = finishById(a.texture).id;
    if (texture === 'image' && !image) {
        texture = 'plain';
    }
    const scale = finite(a.scale) && a.scale >= 0.5 && a.scale <= 5000 ? a.scale : DEFAULT_SCALE;
    let rotation = finite(a.rotation) ? ((a.rotation % 360) + 360) % 360 : 0;
    if (Math.abs(rotation) < 1e-9 || Math.abs(rotation - 360) < 1e-9) {
        rotation = 0;
    }
    const faces = Array.isArray(a.faces) ? a.faces.slice(0, MAX_FACE_LOOKS).map(normalizeFaceLook).filter(Boolean) : [];
    if (color === DEFAULT_COLOR && texture === 'plain' && scale === DEFAULT_SCALE && !rotation && !faces.length) {
        return null;
    }
    const out = { color: color, texture: texture, scale: scale };
    if (rotation) {
        out.rotation = rotation;
    }
    if (texture === 'image') {
        out.image = image;
    }
    if (faces.length) {
        out.faces = faces;
    }
    return out;
}

/* ================= painted faces ================= */
function fmt(v) {
    const r = Math.round(v * 1000) / 1000;
    return String(r === 0 ? 0 : r); // no "-0"
}

// The kind of surface a face lies on, from the face description the
// kernel gives (kernel/occt.js faceInfo): a plane and which way it faces,
// a cylinder, its radius and axis (either way along it), or the type
export function faceSignature(info) {
    if (!info) {
        return '';
    }
    if (info.type === 'plane' && Array.isArray(info.normal)) {
        return 'plane:' + info.normal.map(fmt).join(',');
    }
    if (info.type === 'cylinder' && info.axis && Array.isArray(info.axis.d) && finite(info.radius)) {
        let d = info.axis.d.slice();
        const k = Math.abs(d[0]) > 1e-6 ? 0 : Math.abs(d[1]) > 1e-6 ? 1 : 2;
        if (d[k] < 0) {
            d = d.map(function (c) {
                return -c;
            });
        }
        return 'cylinder:' + fmt(info.radius) + ':' + d.map(fmt).join(',');
    }
    return info.type || 'other';
}

// What is kept of a face to find it again
export function faceRef(info, body) {
    return { body: body || 0, centre: info.centre.slice(), area: info.area, sig: faceSignature(info) };
}

function distance(a, b) {
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// How far the pieces `list` (face indices), taken together, are from
// where the painted face was: their centre weighted by area. For a plane
// only across the plane, since an edit upstream may have moved the whole
// face along its normal.
function pieceGap(faces, list, ref) {
    let area = 0;
    const c = [0, 0, 0];
    list.forEach(function (i) {
        const f = faces[i];
        const a = f.area || 0;
        area += a;
        for (let k = 0; k < 3; k++) {
            c[k] += f.centre[k] * a;
        }
    });
    const centre = area > 0 ? c.map(function (v) {
        return v / area;
    }) : faces[list[0]].centre;
    const d = [centre[0] - ref.centre[0], centre[1] - ref.centre[1], centre[2] - ref.centre[2]];
    const n = faces[list[0]].type === 'plane' ? faces[list[0]].normal : null;
    if (n) {
        const along = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
        for (let k = 0; k < 3; k++) {
            d[k] -= n[k] * along;
        }
    }
    return { gap: Math.hypot(d[0], d[1], d[2]), area: area };
}

// The painted look of every face of a body: one entry per face, the index
// in `refs` of the look it takes, or -1. Where it was first; failing that,
// the face of the same kind nearest to where it was, not further than
// about twice its size (a face that went away is not painted elsewhere),
// with the other pieces of it when a later feature split it in two:
// faces of the same kind that bring the pieces' centre closer to where it
// was while their areas together stay within the face's own.
// Of two looks on one face, the later one (painted last) wins.
export function matchFaces(faces, refs, body) {
    const out = (faces || []).map(function () {
        return -1;
    });
    (refs || []).forEach(function (ref, r) {
        if ((ref.body || 0) !== (body || 0)) {
            return;
        }
        let found = -1;
        faces.forEach(function (f, i) {
            if (found < 0 && f.centre && distance(f.centre, ref.centre) < 1e-3 &&
                Math.abs(f.area - ref.area) < Math.max(1e-3, ref.area * 1e-6)) {
                found = i;
            }
        });
        if (found >= 0) {
            out[found] = r;
            return;
        }
        if (!ref.sig) {
            return;
        }
        const limit = Math.max(10, 2 * Math.sqrt(ref.area));
        const kin = [];
        let best = limit;
        faces.forEach(function (f, i) {
            if (!f.centre || faceSignature(f) !== ref.sig) {
                return;
            }
            const d = distance(f.centre, ref.centre);
            if (d < limit) {
                kin.push(i);
            }
            if (d < best) {
                best = d;
                found = i;
            }
        });
        if (found < 0) {
            return;
        }
        const pieces = [found];
        let now = pieceGap(faces, pieces, ref);
        for (;;) {
            let pick = -1;
            let gain = now;
            kin.forEach(function (i) {
                if (pieces.indexOf(i) >= 0 || now.area + (faces[i].area || 0) > ref.area * 1.1) {
                    return;
                }
                const next = pieceGap(faces, pieces.concat([i]), ref);
                if (next.gap < gain.gap - 1e-6) {
                    gain = next;
                    pick = i;
                }
            });
            if (pick < 0) {
                break;
            }
            pieces.push(pick);
            now = gain;
        }
        pieces.forEach(function (i) {
            out[i] = r;
        });
    });
    return out;
}

// Paint faces (refs from faceRef) with a colour and finish: the faces
// already painted are painted over, the others added
export function paintFaces(app, refs, color, texture) {
    const look = normalizeAppearance(app) || { color: DEFAULT_COLOR, texture: 'plain', scale: DEFAULT_SCALE };
    const faces = (look.faces || []).filter(function (f) {
        return !refs.some(function (r) {
            return sameFace(f, r);
        });
    });
    refs.forEach(function (r) {
        faces.push(Object.assign({}, r, { color: color, texture: texture }));
    });
    look.faces = faces;
    return normalizeAppearance(look);
}

// Take the paint off faces (all of them when refs is null)
export function clearFaces(app, refs) {
    const look = normalizeAppearance(app);
    if (!look) {
        return null;
    }
    look.faces = refs ? (look.faces || []).filter(function (f) {
        return !refs.some(function (r) {
            return sameFace(f, r);
        });
    }) : [];
    return normalizeAppearance(look);
}

function sameFace(a, b) {
    return (a.body || 0) === (b.body || 0) && distance(a.centre, b.centre) < 1e-3 &&
        Math.abs(a.area - b.area) < Math.max(1e-3, b.area * 1e-6);
}

/* ================= the scene ================= */
// Lighting presets: the sky and ground colours of the hemisphere light and
// the light that travels with the camera
export const LIGHTING = [
    { id: 'studio', label: 'Studio', sky: 0xffffff, ground: 0x8a8f99, hemi: 1.5, head: 0xffffff, headIntensity: 2.1 },
    { id: 'soft', label: 'Soft', sky: 0xffffff, ground: 0xb4b9c2, hemi: 2.3, head: 0xffffff, headIntensity: 1.2 },
    { id: 'warm', label: 'Warm', sky: 0xfff0dc, ground: 0x8d7f70, hemi: 1.5, head: 0xffe4c4, headIntensity: 2.1 },
    { id: 'cool', label: 'Cool', sky: 0xe4eeff, ground: 0x7b8696, hemi: 1.5, head: 0xdce8ff, headIntensity: 2.1 },
    { id: 'contrast', label: 'High Contrast', sky: 0xffffff, ground: 0x3c4048, hemi: 0.8, head: 0xffffff, headIntensity: 3 }
];

export function lightingById(id) {
    return LIGHTING.filter(function (l) {
        return l.id === id;
    })[0] || LIGHTING[0];
}

export const DEFAULT_SCENE = { lighting: 'studio', reflections: true, shadows: false, ground: false, textures: true };

export function normalizeScene(s) {
    const o = s && typeof s === 'object' ? s : {};
    const flag = function (key) {
        return typeof o[key] === 'boolean' ? o[key] : DEFAULT_SCENE[key];
    };
    return {
        lighting: lightingById(o.lighting).id,
        reflections: flag('reflections'),
        shadows: flag('shadows'),
        ground: flag('ground'),
        textures: flag('textures')
    };
}

/* ================= patterns ================= */
// A small repeatable random generator, so a pattern is the same every time
function random(seed) {
    let s = seed >>> 0;
    return function () {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

function gray(v) {
    const c = Math.max(0, Math.min(255, Math.round(v)));
    return 'rgb(' + c + ',' + c + ',' + c + ')';
}

// Draw a pattern on a square canvas of `size` pixels. Every pattern wraps
// round at its edges, so tiles join without a seam.
export function drawPattern(ctx, size, pattern) {
    const rnd = random(1234567);
    ctx.fillStyle = gray(225);
    ctx.fillRect(0, 0, size, size);
    if (pattern === 'brushed') {
        // Fine streaks along one direction
        for (let i = 0; i < size * 3; i++) {
            const y = rnd() * size;
            const x = rnd() * size;
            const len = size * (0.2 + rnd() * 0.6);
            ctx.strokeStyle = gray(190 + rnd() * 65);
            ctx.globalAlpha = 0.35;
            ctx.lineWidth = 0.6 + rnd();
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + len, y);
            ctx.stroke();
            if (x + len > size) {
                ctx.beginPath();
                ctx.moveTo(x - size, y);
                ctx.lineTo(x + len - size, y);
                ctx.stroke();
            }
        }
    } else if (pattern === 'speckle' || pattern === 'fine') {
        const count = pattern === 'fine' ? size * size / 6 : size * size / 14;
        const r = pattern === 'fine' ? 0.7 : 1.3;
        for (let i = 0; i < count; i++) {
            ctx.fillStyle = gray(160 + rnd() * 95);
            ctx.globalAlpha = 0.55;
            ctx.fillRect(rnd() * size, rnd() * size, r + rnd() * r, r + rnd() * r);
        }
    } else if (pattern === 'wood') {
        // Growth rings: bands along the tile, bent by a slow wave
        const img = ctx.getImageData(0, 0, size, size);
        const phase = [rnd() * 6.28, rnd() * 6.28];
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const t = (x / size) * 2 * Math.PI;
                const bend = Math.sin((y / size) * 2 * Math.PI + phase[0]) * 2.2 + Math.sin((y / size) * 4 * Math.PI + phase[1]) * 0.8;
                const ring = 0.5 + 0.5 * Math.sin(t * 3 + bend);
                const v = 175 + 80 * Math.pow(ring, 0.8);
                const k = (y * size + x) * 4;
                img.data[k] = img.data[k + 1] = img.data[k + 2] = v;
                img.data[k + 3] = 255;
            }
        }
        ctx.putImageData(img, 0, 0);
    } else if (pattern === 'weave') {
        // A 2 x 2 twill of tows, each lit across its width
        const n = 8;
        const cell = size / n;
        for (let j = 0; j < n; j++) {
            for (let i = 0; i < n; i++) {
                const across = ((i + j) >> 1) % 2 === 0;
                const grad = across ? ctx.createLinearGradient(0, j * cell, 0, (j + 1) * cell) : ctx.createLinearGradient(i * cell, 0, (i + 1) * cell, 0);
                grad.addColorStop(0, gray(120));
                grad.addColorStop(0.5, gray(240));
                grad.addColorStop(1, gray(120));
                ctx.fillStyle = grad;
                ctx.globalAlpha = 1;
                ctx.fillRect(i * cell, j * cell, cell, cell);
            }
        }
    }
    ctx.globalAlpha = 1;
}
