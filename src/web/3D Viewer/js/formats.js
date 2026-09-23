/*
    formats.js

    Format registry and loading front-end for the 3D Viewer.

    Mesh formats go through the matching three.js loader. CAD formats
    (STEP / IGES / BREP) are tessellated by the OpenCascade based
    occt-import-js WASM kernel, which runs inside a worker so that a large
    assembly does not freeze the UI. The kernel is only fetched the first time
    a CAD file is opened.
*/

import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { GCodeLoader } from 'three/addons/loaders/GCodeLoader.js';

/*
    Supported extensions.

    label           - shown in the file card ("STL File")
    up              - native up axis of the data as three.js hands it back to
                      us; the viewer works in a Z-up world, so "Y" sources get
                      rotated a quarter turn about X on load
    ownMaterials    - true when the format carries its own materials/colors, in
                      which case the model color picker acts as an override
    unitToMM        - millimetres per scene unit, so the file card can report a
                      real size. glTF is metres by specification, and the
                      Collada loader has already folded the file's own unit
                      declaration down to metres; the CAD and printing formats
                      are millimetres
*/
export const FORMATS = {
    stl: { label: 'STL', up: 'Z', ownMaterials: false, unitToMM: 1 },
    obj: { label: 'OBJ', up: 'Y', ownMaterials: true, unitToMM: 1 },
    glb: { label: 'GLB', up: 'Y', ownMaterials: true, unitToMM: 1000 },
    gltf: { label: 'glTF', up: 'Y', ownMaterials: true, unitToMM: 1000 },
    ply: { label: 'PLY', up: 'Z', ownMaterials: false, unitToMM: 1 },
    '3mf': { label: '3MF', up: 'Z', ownMaterials: true, unitToMM: 1 },
    fbx: { label: 'FBX', up: 'Y', ownMaterials: true, unitToMM: 1 },
    dae: { label: 'Collada', up: 'Y', ownMaterials: true, unitToMM: 1000 },
    step: { label: 'STEP', up: 'Z', ownMaterials: true, unitToMM: 1 },
    stp: { label: 'STEP', up: 'Z', ownMaterials: true, unitToMM: 1 },
    iges: { label: 'IGES', up: 'Z', ownMaterials: true, unitToMM: 1 },
    igs: { label: 'IGES', up: 'Z', ownMaterials: true, unitToMM: 1 },
    brep: { label: 'BREP', up: 'Z', ownMaterials: true, unitToMM: 1 },
    // Sliced toolpaths. GCodeLoader rotates its own root a quarter turn to hand
    // back a Y-up object, so declaring "Y" here makes the viewer's pivot cancel
    // that back out and the print stands up the way it was sliced.
    gcode: { label: 'G-code', up: 'Y', ownMaterials: false, unitToMM: 1, toolpath: true },
    gco: { label: 'G-code', up: 'Y', ownMaterials: false, unitToMM: 1, toolpath: true }
};

export function extOf(filename) {
    const m = /\.([a-z0-9]+)\s*$/i.exec(filename || '');
    return m ? m[1].toLowerCase() : '';
}

export function isSupported(filename) {
    return Object.prototype.hasOwnProperty.call(FORMATS, extOf(filename));
}

export function supportedExtList() {
    return Object.keys(FORMATS).map(function (e) { return '.' + e; });
}

/* ------------------------------------------------------------------ */
/* Source fetching                                                     */
/* ------------------------------------------------------------------ */

/*
    Read the whole model into memory first so that we can report real download
    progress and hand the same buffer to whichever parser is needed.
*/
function fetchBuffer(url, onProgress) {
    return new Promise(function (resolve, reject) {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.responseType = 'arraybuffer';
        xhr.onload = function () {
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve(xhr.response);
            } else {
                reject(new Error('Server returned HTTP ' + xhr.status));
            }
        };
        xhr.onerror = function () { reject(new Error('Network error while downloading the model')); };
        xhr.onprogress = function (e) {
            if (onProgress) onProgress(e.lengthComputable ? e.loaded / e.total : -1, e.loaded);
        };
        xhr.send();
    });
}

function readFileBuffer(file, onProgress) {
    return new Promise(function (resolve, reject) {
        const fr = new FileReader();
        fr.onload = function () { resolve(fr.result); };
        fr.onerror = function () { reject(new Error('Could not read the dropped file')); };
        fr.onprogress = function (e) {
            if (onProgress) onProgress(e.lengthComputable ? e.loaded / e.total : -1, e.loaded);
        };
        fr.readAsArrayBuffer(file);
    });
}

function decodeText(buffer) {
    return new TextDecoder('utf-8').decode(new Uint8Array(buffer));
}

/*
    Sibling assets (.mtl files, textures, .bin chunks) live next to the model in
    the user's storage, but they are reached through a query-string media
    endpoint rather than a directory URL. A LoadingManager URL modifier maps the
    bare filenames the parsers ask for onto that endpoint.
*/
function makeManager(resolveSibling) {
    const manager = new THREE.LoadingManager();
    if (!resolveSibling) return manager;
    manager.setURLModifier(function (url) {
        if (/^(https?:|blob:|data:|\/\/)/i.test(url)) return url;
        return resolveSibling(url);
    });
    return manager;
}

/* ------------------------------------------------------------------ */
/* OpenCascade (STEP / IGES / BREP)                                    */
/* ------------------------------------------------------------------ */

let occtWorker = null;
let occtSeq = 0;

function occtRequest(kind, bytes, onStatus) {
    if (!occtWorker) {
        occtWorker = new Worker(new URL('./occtWorker.js', import.meta.url));
    }
    const id = ++occtSeq;
    return new Promise(function (resolve, reject) {
        function onMessage(ev) {
            const msg = ev.data;
            if (!msg || msg.id !== id) return;
            if (msg.type === 'status') {
                if (onStatus) onStatus(msg.text);
                return;
            }
            occtWorker.removeEventListener('message', onMessage);
            if (msg.type === 'ok') resolve(msg.result);
            else reject(new Error(msg.error || 'The CAD kernel could not read this file'));
        }
        occtWorker.addEventListener('message', onMessage);
        occtWorker.addEventListener('error', function (e) {
            reject(new Error('CAD kernel failed to start: ' + (e.message || 'unknown error')));
        }, { once: true });
        occtWorker.postMessage({ id: id, kind: kind, buffer: bytes.buffer }, [bytes.buffer]);
    });
}

/*
    Turn one occt-import-js mesh description into a three.js Mesh. A STEP body
    is a single indexed buffer whose triangles are grouped per B-rep face, so
    per-face colors become material groups.
*/
/*
    A STEP file that declares no colour still comes back from the kernel with
    OpenCascade's default neutral grey (around 0.60 on every channel) rather
    than no colour at all, so "did the author choose a colour" has to be
    answered by looking for actual chroma. A part deliberately authored pure
    grey reads as uncoloured here and picks up the model colour instead, which
    is the more useful default - grey is still one click away in the palette.
*/
function isChromatic(rgb) {
    if (!rgb) return false;
    const max = Math.max(rgb[0], rgb[1], rgb[2]);
    const min = Math.min(rgb[0], rgb[1], rgb[2]);
    return (max - min) > 0.02;
}

function occtMeshHasColor(src) {
    if (isChromatic(src.color)) return true;
    const faces = src.brep_faces || [];
    for (let i = 0; i < faces.length; i++) {
        if (isChromatic(faces[i].color)) return true;
    }
    return false;
}

function buildOcctMesh(src) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(src.attributes.position.array, 3));
    if (src.attributes.normal) {
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(src.attributes.normal.array, 3));
    }
    const index = Uint32Array.from(src.index.array);
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    if (!src.attributes.normal) geometry.computeVertexNormals();
    geometry.name = src.name || '';

    function makeMaterial(rgb) {
        return new THREE.MeshStandardMaterial({
            color: rgb ? new THREE.Color(rgb[0], rgb[1], rgb[2]) : 0xc9ccd1,
            roughness: 0.5,
            metalness: 0.08
        });
    }

    const materials = [makeMaterial(src.color)];
    const faces = src.brep_faces || [];
    if (faces.length > 0) {
        for (let i = 0; i < faces.length; i++) materials.push(makeMaterial(faces[i].color || src.color));

        const triangleCount = index.length / 3;
        let triangle = 0;
        let faceGroup = 0;
        while (triangle < triangleCount) {
            const first = triangle;
            let last, materialIndex;
            if (faceGroup >= faces.length) {
                last = triangleCount;
                materialIndex = 0;
            } else if (triangle < faces[faceGroup].first) {
                last = faces[faceGroup].first;
                materialIndex = 0;
            } else {
                last = faces[faceGroup].last + 1;
                materialIndex = faceGroup + 1;
                faceGroup++;
            }
            geometry.addGroup(first * 3, (last - first) * 3, materialIndex);
            triangle = last;
        }
    }

    const mesh = new THREE.Mesh(geometry, materials.length > 1 ? materials : materials[0]);
    mesh.name = src.name || '';
    return mesh;
}

/*
    Returns the tessellated group plus whether the file actually carried any
    colour. Plenty of STEP exports have no colour at all, and those should be
    treated like a bare mesh so the model colour picker drives them instead of
    leaving them stuck on the kernel's neutral grey.
*/
function occtToGroup(result) {
    const group = new THREE.Group();
    const meshes = (result && result.meshes) || [];
    let coloured = false;
    for (let i = 0; i < meshes.length; i++) {
        if (occtMeshHasColor(meshes[i])) coloured = true;
        group.add(buildOcctMesh(meshes[i]));
    }
    if (group.children.length === 0) {
        throw new Error('The file contains no solid geometry that could be tessellated');
    }
    return { object: group, ownMaterials: coloured };
}

/* ------------------------------------------------------------------ */
/* Parsers                                                             */
/* ------------------------------------------------------------------ */

function geometryToObject(geometry) {
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    // A brand new material here is only a placeholder; the viewer immediately
    // re-materialises geometry-only models with the current model color.
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
    mesh.userData.geometryOnly = true;
    return mesh;
}

/*
    loadModel(source, options)

    source  - { url, resolveSibling } for a file in the user's storage, or
              { file } for a File dropped onto the window
    options - { filename, onProgress(fraction, label) }

    Resolves with { object, format, ext }.
*/
export async function loadModel(source, options) {
    const opts = options || {};
    const filename = opts.filename || source.filename || '';
    const ext = extOf(filename);
    const format = FORMATS[ext];
    if (!format) throw new Error('"' + (ext ? '.' + ext : filename) + '" is not a supported 3D model format');

    const report = function (fraction, label) {
        if (opts.onProgress) opts.onProgress(fraction, label);
    };

    report(0, 'Downloading model...');
    const buffer = source.file
        ? await readFileBuffer(source.file, function (f) { report(f * 0.6, 'Reading file...'); })
        : await fetchBuffer(source.url, function (f) { report(f * 0.6, 'Downloading model...'); });

    // The CAD path hands its buffer to the worker as a transferable, which
    // detaches it here, so the size is recorded up front.
    const byteLength = buffer.byteLength;

    report(0.6, ext === 'step' || ext === 'stp' || ext === 'iges' || ext === 'igs' || ext === 'brep'
        ? 'Tessellating CAD geometry...'
        : 'Parsing model...');

    // Parsing runs on the main thread and a big model (or a long toolpath) can
    // hold it for a while, so yield once and let the progress overlay paint
    // before the browser goes quiet.
    await new Promise(function (resolve) { setTimeout(resolve, 0); });

    const manager = makeManager(source.resolveSibling);
    let object;
    // Most formats always carry their own materials; the CAD path decides per
    // file, because colour is optional in STEP/IGES/BREP.
    let ownMaterials = format.ownMaterials;

    switch (ext) {
        case 'stl':
            object = geometryToObject(new STLLoader(manager).parse(buffer));
            break;

        case 'ply':
            object = geometryToObject(new PLYLoader(manager).parse(buffer));
            break;

        case 'obj': {
            const loader = new OBJLoader(manager);
            const materials = await loadObjMaterials(source, filename, manager);
            if (materials) loader.setMaterials(materials);
            object = loader.parse(decodeText(buffer));
            break;
        }

        case 'glb':
        case 'gltf': {
            const loader = new GLTFLoader(manager);
            const gltf = await new Promise(function (resolve, reject) {
                loader.parse(buffer, '', resolve, reject);
            });
            object = gltf.scene || gltf.scenes[0];
            break;
        }

        case '3mf':
            object = new ThreeMFLoader(manager).parse(buffer);
            break;

        case 'fbx':
            object = new FBXLoader(manager).parse(buffer, '');
            break;

        case 'dae':
            object = new ColladaLoader(manager).parse(decodeText(buffer), '').scene;
            break;

        case 'gcode':
        case 'gco':
            object = new GCodeLoader(manager).parse(decodeText(buffer));
            break;

        case 'step':
        case 'stp':
        case 'iges':
        case 'igs':
        case 'brep': {
            const kind = (ext === 'step' || ext === 'stp') ? 'step' : (ext === 'brep' ? 'brep' : 'iges');
            const cad = occtToGroup(await occtRequest(kind, new Uint8Array(buffer), function (t) { report(-1, t); }));
            object = cad.object;
            ownMaterials = cad.ownMaterials;
            break;
        }
    }

    report(1, 'Preparing scene...');
    return { object: object, format: format, ext: ext, bytes: byteLength, ownMaterials: ownMaterials };
}

/*
    OBJ files keep their materials in a sibling .mtl. It is optional, so a
    missing or unreadable one is not an error - the model just renders in the
    current model color.
*/
async function loadObjMaterials(source, filename, manager) {
    if (!source.resolveSibling) return null;
    const mtlName = filename.replace(/\.obj$/i, '.mtl');
    try {
        const resp = await fetch(source.resolveSibling(mtlName.split('/').pop()));
        if (!resp.ok) return null;
        const text = await resp.text();
        // The storage backend answers with a JSON error object for missing files.
        if (!text || text.trim().charAt(0) === '{') return null;
        const materials = new MTLLoader(manager).parse(text, '');
        materials.preload();
        return materials;
    } catch (e) {
        return null;
    }
}
