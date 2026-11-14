/*
    3D Modeler - viewport

    The three.js scene: cameras, navigation, origin planes, the view cube, the
    axis triad and the display of tessellated bodies coming from the kernel.

    World is Z-up and in millimetres, like STEP and STL. Rendering is on
    demand: call invalidate() after changing anything, nothing redraws on its
    own while the view is still.

    Callbacks in options: onHover(item | null), onSelect([item]) for faces and
    edges of bodies (an item is the kernel's face or edge record plus kind,
    body and index), onHoverPlane(key | null) for the origin planes.

    Assemblies (js/assembly/) hand in bodies with a placement `matrix`, a
    `color` and a `group` (the component they belong to). Their face and
    edge records are then given in assembly coordinates, with the record in
    the part's own coordinates as `local`. In component mode
    (setComponentMode) the pointer picks whole groups instead of faces.
*/

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { finishById, drawPattern, matchFaces, lightingById, normalizeScene, DEFAULT_COLOR, DEFAULT_SCALE, DEFAULT_SCENE } from './appearance.js';
import { transformInfo } from './assembly/geometry.js';
import { silhouetteSource, silhouetteSegments } from './silhouette.js';
import { dragOffset, snapOffset } from './planedrag.js';

const HOME_DIRECTION = new THREE.Vector3(1, -1, 1).normalize();
const WORLD_UP = new THREE.Vector3(0, 0, 1);
const PLANE_SIZE = 120;

// Origin planes: normal, the direction that is "up" on screen when looking at
// the plane, and the label shown in the model browser.
export const ORIGIN_PLANES = {
    yz: { label: 'YZ Plane', normal: [1, 0, 0], up: [0, 0, 1] },
    xz: { label: 'XZ Plane', normal: [0, -1, 0], up: [0, 0, 1] },
    xy: { label: 'XY Plane', normal: [0, 0, 1], up: [0, 1, 0] }
};

// View cube faces in the same convention: looking at FRONT means standing on -Y.
const CUBE_FACES = [
    { name: 'FRONT', normal: [0, -1, 0], up: [0, 0, 1] },
    { name: 'BACK', normal: [0, 1, 0], up: [0, 0, 1] },
    { name: 'RIGHT', normal: [1, 0, 0], up: [0, 0, 1] },
    { name: 'LEFT', normal: [-1, 0, 0], up: [0, 0, 1] },
    { name: 'TOP', normal: [0, 0, 1], up: [0, 1, 0] },
    { name: 'BOTTOM', normal: [0, 0, -1], up: [0, -1, 0] }
];

export function createViewport(options) {
    const canvas = options.canvas;
    const stage = canvas.parentElement;
    const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const scene = new THREE.Scene();
    const target = new THREE.Vector3();
    // onRender: called after every frame. onSelection: while set, gets the
    // selection instead of options.onSelect (a feature panel that is picking).
    const api = { onRender: null, onSelection: null };

    const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -5000, 5000);
    const persp = new THREE.PerspectiveCamera(35, 1, 1, 20000);
    let camera = ortho;
    let viewHeight = 260; // world millimetres visible top to bottom (orthographic)
    [ortho, persp].forEach(function (cam) {
        cam.up.copy(WORLD_UP);
        cam.position.copy(HOME_DIRECTION).multiplyScalar(600);
        cam.lookAt(target);
    });

    // A light that travels with the camera keeps every face readable while orbiting
    const headlight = new THREE.DirectionalLight(0xffffff, 2.1);
    const hemi = new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.5);
    scene.add(hemi);
    scene.add(headlight);
    scene.add(headlight.target);
    // How this viewer likes to see models (appearance.js normalizeScene):
    // lighting preset, reflections, ground shadow, ground plane, textures
    let sceneOpts = Object.assign({}, DEFAULT_SCENE);

    function applyLighting() {
        const l = lightingById(sceneOpts.lighting);
        hemi.color.setHex(l.sky);
        hemi.groundColor.setHex(l.ground);
        hemi.intensity = l.hemi;
        headlight.color.setHex(l.head);
        headlight.intensity = l.headIntensity;
    }

    /* ---- ground: a shadow and a grid under the model ---- */
    // The shadow comes from a light straight above that lights nothing
    // (intensity 0): it only casts the shadow on a plane that shows nothing
    // but shadows, so the look of the model does not change
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    const sun = new THREE.DirectionalLight(0xffffff, 0);
    sun.castShadow = false;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.radius = 4;      // soft edges (PCF)
    scene.add(sun);
    scene.add(sun.target);
    const groundGroup = new THREE.Group();
    groundGroup.visible = false;
    scene.add(groundGroup);
    const shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.45, depthWrite: false }));
    shadowPlane.receiveShadow = true;
    groundGroup.add(shadowPlane);
    let grid = null;
    let gridKey = '';
    let groundDirty = true;     // placed again before the next frame

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = false;
    controls.zoomToCursor = true;
    controls.screenSpacePanning = true;
    // Inventor's mouse: the left button only selects and draws, the middle
    // button pans, Shift + middle orbits (OrbitControls swaps pan and rotate
    // on Shift by itself), the wheel zooms. Orbit and Pan on the navigation
    // bar, or holding F4, lend the left button to the view (setLeftDrag).
    controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: null };
    controls.addEventListener('change', invalidate);
    // The wheel zooms the Inventor way round: rolling it away from you
    // zooms out, towards you zooms in (the owner found three.js's own way
    // flipped). Only the wheel: pinching keeps its direction.
    const wheelZoom = controls._handleMouseWheel;
    controls._handleMouseWheel = function (event) {
        wheelZoom.call(controls, { clientX: event.clientX, clientY: event.clientY, deltaX: event.deltaX, deltaY: -event.deltaY, deltaMode: event.deltaMode });
    };
    let leftDrag = 'select';    // 'select' | 'orbit' | 'pan'
    let sketching = false;

    function leftButton() {
        return leftDrag === 'pan' ? THREE.MOUSE.PAN : leftDrag === 'orbit' ? THREE.MOUSE.ROTATE : null;
    }

    /* ---------------- origin geometry ---------------- */
    const originGroup = new THREE.Group();
    originGroup.visible = false;
    scene.add(originGroup);
    const planeMeshes = {};
    Object.keys(ORIGIN_PLANES).forEach(function (key) {
        const def = ORIGIN_PLANES[key];
        const material = new THREE.MeshBasicMaterial({
            color: 0xd8b24a, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false
        });
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE), material);
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3().fromArray(def.normal));
        mesh.userData.plane = key;
        const outline = new THREE.LineSegments(
            new THREE.EdgesGeometry(mesh.geometry),
            new THREE.LineBasicMaterial({ color: 0x9c7a1c })
        );
        mesh.add(outline);
        originGroup.add(mesh);
        planeMeshes[key] = mesh;
    });

    /* ---------------- work planes ---------------- */
    // Work plane features, drawn as blue sheets: [{ id, frame, draft }]
    const workGroup = new THREE.Group();
    scene.add(workGroup);
    let hotWork = null;

    function setWorkPlanes(list) {
        while (workGroup.children.length) {
            const child = workGroup.children.pop();
            child.geometry.dispose();
            child.material.dispose();
            child.children[0].geometry.dispose();
        }
        // Big enough to be seen around the part, centred on the part
        const box = new THREE.Box3();
        if (bodies.length) {
            box.setFromObject(bodyGroup);
        }
        const centre = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
        const size = box.isEmpty() ? PLANE_SIZE : Math.max(box.getSize(new THREE.Vector3()).length() * 0.9, 40);
        (list || []).forEach(function (plane) {
            const f = plane.frame;
            const n = new THREE.Vector3().fromArray(f.n);
            const o = new THREE.Vector3().fromArray(f.o);
            const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({
                color: plane.draft ? HOVER : 0x4a90d9, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false
            }));
            mesh.matrixAutoUpdate = false;
            // The part's centre dropped onto the plane is the middle of the sheet
            const middle = centre.clone().sub(n.clone().multiplyScalar(centre.clone().sub(o).dot(n)));
            mesh.matrix.makeBasis(new THREE.Vector3().fromArray(f.x), new THREE.Vector3().fromArray(f.y), n).setPosition(middle);
            mesh.userData.work = plane.id;
            mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: plane.draft ? HOVER : 0x2f6fb5 })));
            workGroup.add(mesh);
        });
        hotWork = null;
        invalidate();
    }

    function setHotWork(id) {
        if (id === hotWork) {
            return;
        }
        hotWork = id;
        workGroup.children.forEach(function (mesh) {
            mesh.material.opacity = mesh.userData.work === id ? 0.45 : 0.2;
        });
        invalidate();
    }

    /* ---------------- bodies ---------------- */
    // One entry per solid: { data, mesh, lines }. `data` is the description
    // from the kernel (kernel/occt.js describe): the mesh with an index range
    // per face and the edge segments with a vertex range per edge.
    const bodyGroup = new THREE.Group();
    const overlayGroup = new THREE.Group();
    scene.add(bodyGroup);
    scene.add(overlayGroup);
    let bodies = [];
    const bodyMaterial = new THREE.MeshStandardMaterial({
        color: 0xbfc3c9, metalness: 0.1, roughness: 0.62,
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
    });
    const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x20242b });
    // Edges a surface covers, dashed: drawn only where something nearer was
    // drawn first (GreaterDepth), after every body (transparent, renderOrder
    // 1). The dash length follows the zoom (updateDashes), so it stays the
    // same on screen.
    const hiddenEdgeMaterial = hiddenLineMaterial();
    // Wireframe: the bodies are drawn into the depth buffer only, so the
    // edges behind them can tell they are covered
    const depthMaterial = new THREE.MeshBasicMaterial({
        colorWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
    });
    const capMaterial = new THREE.MeshBasicMaterial({ color: 0xc9713d, side: THREE.BackSide });
    // Materials of coloured bodies (assembly components), one per body so
    // each can be tinted on its own; cleared with the bodies
    let ownMaterials = [];
    // Materials of painted faces (appearance faces), made again with the
    // bodies or the look
    let faceMaterials = [];
    let partAppearance = null;      // the look of the part on show (setAppearance)
    const looks = new WeakMap();    // material -> { app, color, opacity } it was dressed with

    /* ---- appearance (appearance.js): colour, finish, pattern ---- */
    const patternTextures = {};     // pattern -> CanvasTexture, drawn once
    let baseOpacity = 1;            // of the part on show: below 1 for glass
    let ghostOn = false;            // a fillet / chamfer result preview is on

    function patternBase(pattern) {
        let base = patternTextures[pattern];
        if (!base) {
            const canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 256;
            drawPattern(canvas.getContext('2d'), 256, pattern);
            base = new THREE.CanvasTexture(canvas);
            base.wrapS = THREE.RepeatWrapping;
            base.wrapT = THREE.RepeatWrapping;
            base.colorSpace = THREE.SRGBColorSpace;
            base.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
            patternTextures[pattern] = base;
        }
        return base;
    }

    // The picture of an Image finish (a data URL): null until it is loaded,
    // then the looks are dressed again
    const imageTextures = new Map();    // data URL -> Texture | 'loading' | 'failed'
    function imageBase(url) {
        const known = imageTextures.get(url);
        if (known) {
            return typeof known === 'string' ? null : known;
        }
        imageTextures.set(url, 'loading');
        const img = new Image();
        img.onload = function () {
            const t = new THREE.Texture(img);
            t.wrapS = THREE.RepeatWrapping;
            t.wrapT = THREE.RepeatWrapping;
            t.colorSpace = THREE.SRGBColorSpace;
            t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
            t.needsUpdate = true;
            imageTextures.set(url, t);
            refreshLooks();
        };
        img.onerror = function () {
            imageTextures.set(url, 'failed');
        };
        img.src = url;
        return null;
    }

    // The pattern or picture of a finish, one tile per `scale` mm (the
    // texture coordinates are in mm), turned by `rotation` degrees; none
    // while textures are off
    function finishTexture(finish, app) {
        if (!sceneOpts.textures) {
            return null;
        }
        const base = finish.image ? (app && app.image ? imageBase(app.image) : null) : finish.pattern ? patternBase(finish.pattern) : null;
        if (!base) {
            return null;
        }
        const scale = (app && app.scale) || DEFAULT_SCALE;
        const img = base.image;
        // A picture keeps its proportions: `scale` is its width
        const aspect = finish.image && img && img.width && img.height ? img.width / img.height : 1;
        const texture = base.clone();   // the same picture, its own repeat
        texture.repeat.set(1 / scale, aspect / scale);
        texture.rotation = THREE.MathUtils.degToRad((app && app.rotation) || 0);
        texture.needsUpdate = true;
        return texture;
    }

    // Metal needs something to reflect, or it looks dull grey: a small
    // studio (a grey room with bright panels) made once, prefiltered by
    // three.js's PMREM generator, used by the metal finishes only, so the
    // default look of a part does not change
    let studio = null;
    function studioEnvironment() {
        if (studio) {
            return studio;
        }
        const room = new THREE.Scene();
        const box = new THREE.BoxGeometry(10, 10, 10);
        room.add(new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: 0x7d838c, side: THREE.BackSide })));
        const panel = function (w, h, position, rotation, intensity) {
            const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({
                color: new THREE.Color(1, 1, 1).multiplyScalar(intensity), side: THREE.DoubleSide
            }));
            mesh.position.fromArray(position);
            mesh.rotation.fromArray(rotation);
            room.add(mesh);
        };
        panel(7, 2.2, [0, 4.8, 0], [Math.PI / 2, 0, 0], 3.2);
        panel(2.4, 5, [-4.8, 0.5, 0.8], [0, Math.PI / 2, 0], 2.2);
        panel(2, 4, [4.8, 0, -1.5], [0, -Math.PI / 2, 0], 1.6);
        panel(5, 1.2, [0, -1, -4.8], [0, 0, 0], 1.2);
        const pmrem = new THREE.PMREMGenerator(renderer);
        studio = pmrem.fromScene(room, 0.04).texture;
        pmrem.dispose();
        room.traverse(function (o) {
            if (o.geometry) {
                o.geometry.dispose();
            }
            if (o.material) {
                o.material.dispose();
            }
        });
        return studio;
    }

    // Give a material the look of an appearance. `color` (a component's
    // colour) wins over the appearance's own. Returns its opacity.
    function dressMaterial(material, app, color) {
        const finish = finishById(app && app.texture);
        if (material.map) {
            material.map.dispose();
        }
        material.color.set(color !== undefined ? color : (app && app.color) || DEFAULT_COLOR);
        material.roughness = finish.roughness;
        material.metalness = finish.metalness;
        // Reflections: metals mirror the studio, glossy finishes a little
        const metal = finish.metalness >= 0.3;
        material.envMap = sceneOpts.reflections && (metal || finish.roughness < 0.4) ? studioEnvironment() : null;
        material.envMapIntensity = metal ? 1 : 0.35;
        material.map = finishTexture(finish, app);
        const opacity = finish.opacity || 1;
        material.transparent = opacity < 1;
        material.opacity = opacity;
        material.depthWrite = opacity >= 1;
        material.needsUpdate = true;
        looks.set(material, { app: app, color: color, opacity: opacity });
        return opacity;
    }

    // The faces painted in the look of each body (appearance faces) get
    // materials of their own, through geometry groups: one group per run of
    // faces with the same look, material 0 the body's own
    function applyFaceLooks() {
        faceMaterials.forEach(function (m) {
            if (m.map) {
                m.map.dispose();
            }
            m.dispose();
        });
        faceMaterials = [];
        bodies.forEach(function (body, b) {
            const geometry = body.mesh.geometry;
            geometry.clearGroups();
            body.mesh.material = body.baseMaterial;
            const own = body.data.color !== undefined || !!body.data.appearance;
            const app = own ? body.data.appearance : partAppearance;
            const refs = app && app.faces;
            if (!refs || !refs.length || !body.data.faces) {
                return;
            }
            const hit = matchFaces(body.data.faces, refs, body.data.partBody !== undefined ? body.data.partBody : b);
            if (!hit.some(function (r) {
                return r >= 0;
            })) {
                return;
            }
            const list = [body.baseMaterial];
            const slot = {};
            let run = null;
            body.data.faces.forEach(function (face, i) {
                let m = 0;
                if (hit[i] >= 0) {
                    const ref = refs[hit[i]];
                    const key = ref.color + '/' + ref.texture;
                    if (slot[key] === undefined) {
                        const material = new THREE.MeshStandardMaterial({
                            polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
                        });
                        dressMaterial(material, { color: ref.color, texture: ref.texture, scale: app.scale, rotation: app.rotation });
                        material.clippingPlanes = sectionPlanes;
                        material.clipIntersection = section.mode === 'threequarter';
                        faceMaterials.push(material);
                        slot[key] = list.length;
                        list.push(material);
                    }
                    m = slot[key];
                }
                if (run && run.m === m && run.end === face.start) {
                    run.end = face.start + face.count;
                } else {
                    run = { start: face.start, end: face.start + face.count, m: m };
                    geometry.addGroup(run.start, 0, m);
                }
                geometry.groups[geometry.groups.length - 1].count = run.end - run.start;
            });
            body.mesh.material = list;
        });
    }

    // Every look dressed again: after the scene changed (textures,
    // reflections) or a picture finished loading
    function refreshLooks() {
        baseOpacity = dressMaterial(bodyMaterial, partAppearance);
        ownMaterials.forEach(function (m) {
            const look = looks.get(m);
            if (look) {
                dressMaterial(m, look.app, look.color);
            }
        });
        applyFaceLooks();
        applyGhost();
        applyVisualStyle();
        invalidate();
    }

    // While a result preview is on, the real body is a faint ghost
    function applyGhost() {
        faceMaterials.forEach(function (m) {
            const o = looks.get(m).opacity;
            m.transparent = ghostOn || o < 1;
            m.opacity = ghostOn ? 0.06 : o;
            m.depthWrite = !ghostOn && o >= 1;
            m.needsUpdate = true;
        });
        bodyMaterial.transparent = ghostOn || baseOpacity < 1;
        bodyMaterial.opacity = ghostOn ? 0.06 : baseOpacity;
        bodyMaterial.depthWrite = !ghostOn && baseOpacity >= 1;
        edgeMaterial.transparent = ghostOn;
        edgeMaterial.opacity = ghostOn ? 0.3 : 1;
        bodyMaterial.needsUpdate = true;
        edgeMaterial.needsUpdate = true;
    }

    // Texture coordinates in mm by box projection: each vertex takes the two
    // axes across its normal's main direction, so a pattern lies flat on
    // every side of a part
    function addUVs(geometry) {
        const pos = geometry.getAttribute('position');
        const nor = geometry.getAttribute('normal');
        const uv = new Float32Array(pos.count * 2);
        for (let i = 0; i < pos.count; i++) {
            const ax = Math.abs(nor.getX(i));
            const ay = Math.abs(nor.getY(i));
            const az = Math.abs(nor.getZ(i));
            if (az >= ax && az >= ay) {
                uv[2 * i] = pos.getX(i);
                uv[2 * i + 1] = pos.getY(i);
            } else if (ax >= ay) {
                uv[2 * i] = pos.getY(i);
                uv[2 * i + 1] = pos.getZ(i);
            } else {
                uv[2 * i] = pos.getX(i);
                uv[2 * i + 1] = pos.getZ(i);
            }
        }
        geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    }
    // The section view: mode "none" | "half" | "quarter" | "threequarter";
    // plane / plane2 "xz" | "yz" | "xy"; offset / offset2 the position along
    // the plane's normal axis (null: through the middle of the model);
    // flip / flip2 keep the other side
    let section = { mode: 'none', plane: 'xz', offset: null, flip: false, plane2: 'yz', offset2: null, flip2: false };
    let sectionPlanes = [];
    let componentMode = false;   // the pointer picks whole components (groups)
    renderer.localClippingEnabled = true;
    const HOVER = 0xf0943a;
    const SELECTED = 0x2f7fe0;
    const overlayMaterials = {
        hoverface: new THREE.MeshBasicMaterial({ color: HOVER, transparent: true, opacity: 0.55, depthWrite: false }),
        selectedface: new THREE.MeshBasicMaterial({ color: SELECTED, transparent: true, opacity: 0.6, depthWrite: false }),
        // WebGL draws plain lines one pixel wide, too thin to see what the
        // pointer is on: highlighted edges use the screen space "fat" lines
        // (width in CSS pixels, kept in step with the canvas in resize())
        // The part of an edge behind the model is drawn again, faint, so a
        // picked loop can be followed all round without hiding the faces
        hoveredge: new LineMaterial({ color: HOVER, linewidth: 4, depthWrite: false }),
        hoveredgehidden: new LineMaterial({ color: HOVER, linewidth: 2, depthTest: false, depthWrite: false, transparent: true, opacity: 0.35 }),
        selectededge: new LineMaterial({ color: SELECTED, linewidth: 3, depthWrite: false }),
        selectededgehidden: new LineMaterial({ color: SELECTED, linewidth: 2, depthTest: false, depthWrite: false, transparent: true, opacity: 0.35 })
    };
    let visualStyle = 'shaded-edges';
    let interactive = true; // false while the sketcher owns the pointer
    let pickFilter = null;  // { edges, faces, toggle } while a feature panel picks, else null
    let hovered = null;     // { type: "face" | "edge", body, index }
    let selection = [];     // same shape as hovered

    function disposeGroup(group) {
        while (group.children.length) {
            const child = group.children.pop();
            if (child.geometry) {
                child.geometry.dispose();
            }
        }
    }

    // Every material the bodies are drawn with, for clipping and styles
    function bodyMaterials() {
        return [bodyMaterial, capMaterial, edgeMaterial, hiddenEdgeMaterial, depthMaterial].concat(ownMaterials, faceMaterials);
    }

    function hiddenLineMaterial() {
        return new THREE.LineDashedMaterial({
            color: 0x20242b, transparent: true, opacity: 0.6, depthFunc: THREE.GreaterDepth, depthWrite: false,
            dashSize: 1, gapSize: 1
        });
    }

    // Dashes of about 6 pixels with gaps of 4 at any zoom
    function updateDashes() {
        const w = worldPerPixel();
        const dashed = [hiddenEdgeMaterial];
        previewGroup.children.forEach(function (child) {
            if (child.userData.role === 'result-hidden') {
                dashed.push(child.material);
            }
        });
        dashed.forEach(function (material) {
            material.dashSize = 6 * w;
            material.gapSize = 4 * w;
        });
    }

    // Put a body's objects where its placement matrix says (assemblies)
    function placeBody(body, matrix) {
        const m = new THREE.Matrix4().fromArray(matrix);
        [body.mesh, body.depth, body.cap, body.hidden, body.lines].concat(body.sil ? [body.sil.front, body.sil.behind] : []).forEach(function (object) {
            m.decompose(object.position, object.quaternion, object.scale);
            object.updateMatrixWorld(true);
        });
        body.matrix = matrix.slice();
        groundDirty = true;
        silhouetteKey = '';
    }

    /* ---- silhouettes of round faces (silhouette.js) ---- */
    let silhouetteKey = '';     // the view the silhouettes were worked out for

    function makeSilhouette(data) {
        const src = silhouetteSource(data.positions, data.indices, data.faces);
        if (!src) {
            return null;
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(src.edges * 6), 3));
        geometry.setAttribute('lineDistance', new THREE.BufferAttribute(new Float32Array(src.edges * 2), 1));
        geometry.setDrawRange(0, 0);
        const front = new THREE.LineSegments(geometry, edgeMaterial);
        const behind = new THREE.LineSegments(geometry, hiddenEdgeMaterial);
        behind.renderOrder = 1;
        // Their points change with the view: no stale bounds
        front.frustumCulled = false;
        behind.frustumCulled = false;
        bodyGroup.add(front);
        bodyGroup.add(behind);
        silhouetteKey = '';
        return { src: src, geometry: geometry, front: front, behind: behind };
    }

    const silInverse = new THREE.Matrix4();
    const silView = new THREE.Vector3();
    function updateSilhouettes() {
        if (visualStyle === 'shaded' || !bodies.length) {
            return;
        }
        const perspective = camera === persp;
        if (perspective) {
            silView.copy(camera.position);
        } else {
            camera.getWorldDirection(silView);
        }
        const key = (perspective ? 'p' : 'o') + silView.toArray().map(function (v) {
            return v.toFixed(5);
        }).join(',') + '/' + bodies.length;
        if (key === silhouetteKey) {
            return;
        }
        silhouetteKey = key;
        bodies.forEach(function (body) {
            if (!body.sil) {
                return;
            }
            // The view in the body's own coordinates (assembly placements)
            body.mesh.updateMatrixWorld();
            silInverse.copy(body.mesh.matrixWorld).invert();
            const v = silView.clone();
            if (perspective) {
                v.applyMatrix4(silInverse);
            } else {
                v.transformDirection(silInverse);
            }
            const geometry = body.sil.geometry;
            const count = silhouetteSegments(body.sil.src, v.toArray(), perspective,
                geometry.getAttribute('position').array, geometry.getAttribute('lineDistance').array);
            geometry.setDrawRange(0, count * 2);
            geometry.getAttribute('position').needsUpdate = true;
            geometry.getAttribute('lineDistance').needsUpdate = true;
        });
    }

    // The ground shadow and grid under the bodies (not while sketching)
    function placeGround() {
        groundDirty = false;
        const show = !sketching && bodies.length > 0 && (sceneOpts.shadows || sceneOpts.ground);
        groundGroup.visible = show;
        sun.castShadow = show && sceneOpts.shadows;
        if (!show) {
            return;
        }
        bodyGroup.updateMatrixWorld(true);
        const box = new THREE.Box3();
        bodies.forEach(function (b) {
            box.expandByObject(b.mesh);
        });
        if (box.isEmpty()) {
            groundGroup.visible = false;
            sun.castShadow = false;
            return;
        }
        const size = box.getSize(new THREE.Vector3());
        const centre = box.getCenter(new THREE.Vector3());
        const span = Math.max(size.x, size.y, size.z, 1);
        const z = box.min.z - span * 0.002;
        shadowPlane.visible = sceneOpts.shadows;
        shadowPlane.position.set(centre.x, centre.y, z);
        shadowPlane.scale.set(span * 4, span * 4, 1);
        // A grid of 1, 2 or 5 times a power of ten, about four cells across the part
        const step = Math.pow(10, Math.floor(Math.log10(span / 4)));
        const ratio = span / 4 / step;
        const cell = ratio >= 5 ? step * 5 : ratio >= 2 ? step * 2 : step;
        const cells = 2 * Math.ceil(span * 1.5 / cell);
        const key = cell + ':' + cells;
        if (key !== gridKey) {
            if (grid) {
                groundGroup.remove(grid);
                grid.geometry.dispose();
                grid.material.dispose();
            }
            grid = new THREE.GridHelper(cell * cells, cells, 0x8a919c, 0x8a919c);
            grid.rotation.x = Math.PI / 2;   // the XY plane: Z is up
            grid.material.transparent = true;
            grid.material.opacity = 0.4;
            grid.material.depthWrite = false;
            groundGroup.add(grid);
            gridKey = key;
        }
        grid.visible = sceneOpts.ground;
        grid.position.set(Math.round(centre.x / cell) * cell, Math.round(centre.y / cell) * cell, z);
        // The light a little off straight above, so the shadow shows the shape
        sun.position.set(centre.x + span * 0.6, centre.y + span * 0.9, box.max.z + span * 2);
        sun.target.position.set(centre.x, centre.y, z);
        sun.target.updateMatrixWorld();
        const cam = sun.shadow.camera;
        cam.left = -span * 1.6;
        cam.right = span * 1.6;
        cam.top = span * 1.6;
        cam.bottom = -span * 1.6;
        cam.near = 0.1;
        cam.far = span * 4 + size.z;
        cam.updateProjectionMatrix();
    }

    function setBodies(list) {
        disposeGroup(bodyGroup);
        ownMaterials.forEach(function (material) {
            material.dispose();
        });
        ownMaterials = [];
        bodies = list.map(function (data, i) {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
            geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
            geometry.computeVertexNormals();
            addUVs(geometry);
            let material = bodyMaterial;
            let cap = capMaterial;
            if (data.color !== undefined || data.appearance) {
                // A component colour (or a part's own look in an assembly or
                // a drawing): a material of its own, so it can be tinted
                material = new THREE.MeshStandardMaterial({
                    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
                });
                dressMaterial(material, data.appearance, data.color);
                // The cut face of a component in a darker shade of its colour
                cap = new THREE.MeshBasicMaterial({ color: material.color.clone().multiplyScalar(0.62), side: THREE.BackSide });
                ownMaterials.push(material, cap);
            }
            const mesh = new THREE.Mesh(geometry, material);
            mesh.userData.body = i;
            mesh.castShadow = true;
            const lineGeometry = new THREE.BufferGeometry();
            lineGeometry.setAttribute('position', new THREE.BufferAttribute(data.edgePositions || new Float32Array(0), 3));
            const lines = new THREE.LineSegments(lineGeometry, edgeMaterial);
            lines.userData.body = i;
            // The same edges dashed where a surface covers them, for the
            // wireframe and hidden edge styles
            const hidden = new THREE.LineSegments(lineGeometry, hiddenEdgeMaterial);
            hidden.computeLineDistances();
            hidden.renderOrder = 1;
            // The body in the depth buffer only, for the wireframe style:
            // drawn first, so the edges it covers are known to be covered
            const depth = new THREE.Mesh(geometry, depthMaterial);
            depth.renderOrder = -1;
            // The inside of the body in a flat colour: where a section view
            // cuts the solid open, this is what shows, so the cut looks filled
            const capMesh = new THREE.Mesh(geometry, cap);
            bodyGroup.add(depth);
            bodyGroup.add(mesh);
            bodyGroup.add(capMesh);
            bodyGroup.add(hidden);
            bodyGroup.add(lines);
            // The outline of round faces as seen from where the camera is
            // (a hole's walls, a fillet): worked out again when the view
            // turns (updateSilhouettes), solid in front and dashed behind
            const sil = makeSilhouette(data);
            const body = { data: data, mesh: mesh, baseMaterial: material, depth: depth, lines: lines, hidden: hidden, cap: capMesh, sil: sil, matrix: null, group: data.group };
            if (data.matrix) {
                placeBody(body, data.matrix);
            }
            return body;
        });
        applyFaceLooks();
        applyGhost();
        groundDirty = true;
        applySection();
        // Face and edge numbers belong to the shape that was just replaced
        const hadSelection = selection.length > 0;
        hovered = null;
        selection = [];
        applyVisualStyle();
        drawOverlays();
        // Only speak up when something was actually deselected; a rebuild
        // must not wipe the message of the command that caused it
        if (hadSelection) {
            announceSelection();
        }
    }

    // A feature panel that is picking gets the selection instead of the app
    function announceSelection() {
        const items = selection.map(describeItem);
        if (api.onSelection) {
            api.onSelection(items);
        } else if (options.onSelect) {
            options.onSelect(items);
        }
    }

    // shaded: surfaces only; shaded with edges: and the edges in front;
    // hidden-edges: and the covered edges dashed; wireframe: no surfaces,
    // the edges in front solid and the covered ones dashed
    function applyVisualStyle() {
        const wire = visualStyle === 'wireframe';
        const dashed = wire || visualStyle === 'hidden-edges';
        // Without surfaces the lines stand on the background: light ones on
        // the dark theme's stage
        const light = wire && document.body.classList.contains('dark');
        const lineColor = light ? 0xd0d5dd : 0x20242b;
        edgeMaterial.color.setHex(lineColor);
        hiddenEdgeMaterial.color.setHex(lineColor);
        hiddenEdgeMaterial.opacity = light ? 0.45 : 0.6;
        bodyMaterial.visible = !wire;
        bodies.forEach(function (body) {
            [].concat(body.mesh.material).forEach(function (m) {
                m.visible = !wire;
            });
            // While a fillet or chamfer result is previewed, the result
            // stands for the body (its own depth, its own dashed edges)
            body.depth.visible = wire && !ghostOn;
            body.lines.visible = visualStyle !== 'shaded';
            body.hidden.visible = dashed && !ghostOn;
            body.cap.visible = section.mode !== 'none' && !wire;
            if (body.sil) {
                body.sil.front.visible = visualStyle !== 'shaded';
                body.sil.behind.visible = dashed && !ghostOn;
            }
        });
        // A fillet or chamfer preview is drawn in the same style as the body
        previewGroup.children.forEach(function (child) {
            const role = child.userData.role;
            if (role === 'result-solid') {
                child.visible = !wire;
            } else if (role === 'result-depth') {
                child.visible = wire;
            } else if (role === 'result-lines') {
                child.visible = visualStyle !== 'shaded';
                child.material.color.setHex(lineColor);
            } else if (role === 'result-hidden') {
                child.visible = dashed;
                child.material.color.setHex(lineColor);
                child.material.opacity = hiddenEdgeMaterial.opacity;
            }
        });
    }

    /* ---------------- section view ---------------- */
    // The model is cut by planes parallel to the origin planes, on the
    // graphics card: the kernel is not involved, so it costs nothing and the
    // model stays whole.
    //   half            what lies in front of the plane is removed
    //   quarter         one quarter is left standing
    //   threequarter    one quarter is removed
    // "In front" is the side the home view looks from (-Y, +X, +Z); flip
    // keeps that side instead.
    const SECTION_AXES = { xz: 1, yz: 0, xy: 2 };
    const SECTION_KEEP = { xz: [0, 1, 0], yz: [-1, 0, 0], xy: [0, 0, -1] };

    // The bounding box of what is shown, as [min, max] arrays, or null
    function modelBounds() {
        if (!bodies.length) {
            return null;
        }
        const box = new THREE.Box3().setFromObject(bodyGroup);
        return box.isEmpty() ? null : [box.min.toArray(), box.max.toArray()];
    }

    function sectionPlane(key, offset, flip) {
        const bounds = modelBounds();
        const axis = SECTION_AXES[key];
        const at = offset === null || offset === undefined ? (bounds ? (bounds[0][axis] + bounds[1][axis]) / 2 : 0) : offset;
        const normal = new THREE.Vector3().fromArray(SECTION_KEEP[key]);
        if (flip) {
            normal.negate();
        }
        // n . p + c = 0 on the plane, with the point (at on the axis)
        const point = new THREE.Vector3();
        point.setComponent(axis, at);
        return new THREE.Plane(normal, -normal.dot(point));
    }

    function applySection() {
        const planes = [];
        if (section.mode !== 'none' && bodies.length) {
            planes.push(sectionPlane(section.plane, section.offset, section.flip));
            if (section.mode !== 'half') {
                planes.push(sectionPlane(section.plane2, section.offset2, section.flip2));
            }
        }
        sectionPlanes = planes;
        bodyMaterials().forEach(function (material) {
            material.clippingPlanes = planes;
            // With "intersection" only what fails every plane is removed: one quarter
            material.clipIntersection = section.mode === 'threequarter';
            material.needsUpdate = true;
        });
        applyVisualStyle();
        invalidate();
    }

    // mode: "none" | "half" | "quarter" | "threequarter", or a whole spec
    // (see `section` above); missing fields keep their value
    function setSection(spec) {
        section = Object.assign({}, section, typeof spec === 'string' ? { mode: spec } : spec);
        if (section.plane2 === section.plane) {
            section.plane2 = section.plane === 'yz' ? 'xz' : 'yz';
        }
        setHovered(null);
        applySection();
    }

    // Is a point in the part of the model a section view has cut away?
    function cutAway(point) {
        if (!sectionPlanes.length) {
            return false;
        }
        const outside = sectionPlanes.filter(function (plane) {
            return plane.distanceToPoint(point) < 0;
        }).length;
        return section.mode === 'threequarter' ? outside === sectionPlanes.length : outside > 0;
    }

    function setVisualStyle(style) {
        visualStyle = style;
        silhouetteKey = '';
        applyVisualStyle();
        invalidate();
    }

    // What a hovered or selected item is, for the status bar and for commands
    function describeItem(item) {
        const body = bodies[item.body];
        const data = body && body.data;
        if (!data) {
            return null;
        }
        if (item.type === 'body') {
            return { kind: 'component', body: item.body, group: body.group };
        }
        const info = item.type === 'face' ? data.faces[item.index] : data.edges[item.index];
        if (!info) {
            return null;
        }
        const base = { kind: item.type, body: item.body, index: item.index, group: body.group };
        // A placed body (assembly) reports where the item is in the assembly
        return body.matrix ? Object.assign(base, transformInfo(info, body.matrix), { local: info }) : Object.assign(base, info);
    }

    // A small geometry of its own for one face or edge, so highlights can be
    // thrown away without touching the buffers of the body. Returns a list
    // of objects to draw (an edge: in front of the model, and faint behind).
    function overlayFor(item, state) {
        const body = bodies[item.body];
        const info = body && (item.type === 'face' ? body.data.faces[item.index] : item.type === 'edge' ? body.data.edges[item.index] : null);
        if (!info) {
            return null;
        }
        const made = overlayShapes(body, info, item, state);
        if (body.matrix) {
            made.forEach(function (object) {
                object.position.copy(body.mesh.position);
                object.quaternion.copy(body.mesh.quaternion);
                object.scale.copy(body.mesh.scale);
            });
        }
        return made;
    }

    function overlayShapes(body, info, item, state) {
        if (item.type === 'face') {
            const geometry = new THREE.BufferGeometry();
            const out = new Float32Array(info.count * 3);
            for (let i = 0; i < info.count; i++) {
                const v = body.data.indices[info.start + i] * 3;
                out[i * 3] = body.data.positions[v];
                out[i * 3 + 1] = body.data.positions[v + 1];
                out[i * 3 + 2] = body.data.positions[v + 2];
            }
            geometry.setAttribute('position', new THREE.BufferAttribute(out, 3));
            return [new THREE.Mesh(geometry, overlayMaterials[state + 'face'])];
        }
        const geometry = new LineSegmentsGeometry();
        geometry.setPositions(body.data.edgePositions.slice(info.start * 3, (info.start + info.count) * 3));
        const hidden = new LineSegments2(geometry, overlayMaterials[state + 'edgehidden']);
        const line = new LineSegments2(geometry, overlayMaterials[state + 'edge']);
        hidden.renderOrder = 5; // after a fillet or chamfer preview, so it is tested against it
        line.renderOrder = 6;
        return [hidden, line];
    }

    function same(a, b) {
        if (!a || !b || a.type !== b.type) {
            return false;
        }
        // Whole components are the same when they are one group
        if (a.type === 'body') {
            return groupOf(a.body) === groupOf(b.body);
        }
        return a.body === b.body && a.index === b.index;
    }

    function groupOf(index) {
        const body = bodies[index];
        return body ? (body.group === undefined ? index : body.group) : null;
    }

    // Tint every body of the hovered and selected components (component
    // mode) and the groups asked for with setGroupTint
    let groupTints = {};    // group -> "hover" | "selected"
    function applyTints() {
        const tint = {};
        Object.keys(groupTints).forEach(function (g) {
            tint[g] = groupTints[g];
        });
        selection.forEach(function (item) {
            if (item.type === 'body') {
                tint[groupOf(item.body)] = 'selected';
            }
        });
        if (hovered && hovered.type === 'body' && tint[groupOf(hovered.body)] !== 'selected') {
            tint[groupOf(hovered.body)] = 'hover';
        }
        bodies.forEach(function (body, i) {
            const state = tint[groupOf(i)];
            [].concat(body.mesh.material).forEach(function (material) {
                if (!material.emissive || material === bodyMaterial) {
                    return;
                }
                material.emissive.setHex(state === 'selected' ? SELECTED : state === 'hover' ? HOVER : 0x000000);
                material.emissiveIntensity = state === 'selected' ? 0.45 : state === 'hover' ? 0.35 : 0;
            });
        });
    }

    // What picking an item takes along. While Fillet or Chamfer picks, an
    // edge stands for its whole tangent chain (pickFilter.chains, one chain
    // number per edge and body, from the kernel), because that is what the
    // feature rounds; otherwise just the item.
    function chainOf(item) {
        const chains = item && item.type === 'edge' && pickFilter && pickFilter.chains;
        const list = chains && chains[item.body];
        if (!list || !(list[item.index] >= 0)) {
            return item ? [item] : [];
        }
        const out = [];
        list.forEach(function (id, index) {
            if (id === list[item.index]) {
                out.push({ type: 'edge', body: item.body, index: index });
            }
        });
        return out;
    }

    function sameChain(a, b) {
        return chainOf(a).some(function (member) {
            return same(member, b);
        });
    }

    // How many edges the selection covers, tangent chains included
    function coveredEdges() {
        const seen = {};
        selection.forEach(function (item) {
            chainOf(item).forEach(function (member) {
                if (member.type === 'edge') {
                    seen[member.body + ':' + member.index] = true;
                }
            });
        });
        return Object.keys(seen).length;
    }

    function drawOverlays() {
        disposeGroup(overlayGroup);
        const add = function (item, state) {
            chainOf(item).forEach(function (member) {
                (overlayFor(member, state) || []).forEach(function (o) {
                    overlayGroup.add(o);
                });
            });
        };
        selection.forEach(function (item) {
            add(item, 'selected');
        });
        if (hovered && !selection.some(function (item) {
            return sameChain(item, hovered);
        })) {
            add(hovered, 'hover');
        }
        applyTints();
        invalidate();
    }

    // The cursor when the pointer is over nothing in particular: what a left
    // drag would do
    function restCursor() {
        return leftDrag === 'pan' ? 'move' : leftDrag === 'orbit' ? 'grab' : '';
    }

    function setHovered(item) {
        if (same(item, hovered) || (!item && !hovered)) {
            return;
        }
        hovered = item;
        if (!planeHandler && !sketching) {
            // Something that can be picked shows the selection arrow, even
            // while Orbit or Pan has the left button
            canvas.style.cursor = item ? 'default' : restCursor();
        }
        drawOverlays();
        if (options.onHover) {
            options.onHover(item ? describeItem(item) : null);
        }
    }

    function setSelection(list) {
        selection = list;
        drawOverlays();
        announceSelection();
    }

    // The item if the active pick filter lets it through, else null
    function allowed(item) {
        if (!item || !pickFilter) {
            return item;
        }
        return (item.type === 'edge' && pickFilter.edges) || (item.type === 'face' && pickFilter.faces) ||
            (item.type === 'body' && pickFilter.components) ? item : null;
    }

    // Select the edges a feature remembers ([{ body, mid, length }]).
    // Returns how many of them were found in the model as shown.
    function selectEdges(refs) {
        const found = [];
        (refs || []).forEach(function (ref) {
            bodies.forEach(function (body, b) {
                if (ref.body !== undefined && ref.body !== b) {
                    return;
                }
                body.data.edges.forEach(function (edge, i) {
                    const hit = edge.mid && Math.hypot(edge.mid[0] - ref.mid[0], edge.mid[1] - ref.mid[1], edge.mid[2] - ref.mid[2]) < 1e-3 &&
                        Math.abs(edge.length - ref.length) < 1e-3;
                    if (hit && !found.some(function (f) {
                        return f.body === b && f.index === i;
                    })) {
                        found.push({ type: 'edge', body: b, index: i });
                    }
                });
            });
        });
        setSelection(found);
        return found.length;
    }

    // Select the faces a feature remembers ([{ body, centre, area }]).
    // Returns how many of them were found in the model as shown.
    function selectFaces(refs) {
        const found = [];
        (refs || []).forEach(function (ref) {
            bodies.forEach(function (body, b) {
                if (ref.body !== undefined && ref.body !== b) {
                    return;
                }
                body.data.faces.forEach(function (face, i) {
                    const hit = face.centre && Math.hypot(face.centre[0] - ref.centre[0], face.centre[1] - ref.centre[1], face.centre[2] - ref.centre[2]) < 1e-3 &&
                        Math.abs(face.area - ref.area) < Math.max(1e-3, ref.area * 1e-6);
                    if (hit && !found.some(function (f) {
                        return f.body === b && f.index === i;
                    })) {
                        found.push({ type: 'face', body: b, index: i });
                    }
                });
            });
        });
        setSelection(found);
        return found.length;
    }

    /* ---------------- camera helpers ---------------- */
    function resize() {
        const w = Math.max(stage.clientWidth, 1);
        const h = Math.max(stage.clientHeight, 1);
        renderer.setSize(w, h, false);
        ['hoveredge', 'hoveredgehidden', 'selectededge', 'selectededgehidden'].forEach(function (key) {
            overlayMaterials[key].resolution.set(w, h);
        });
        Object.keys(axisMaterials).forEach(function (key) {
            axisMaterials[key].resolution.set(w, h);
        });
        const aspect = w / h;
        ortho.left = -viewHeight * aspect / 2;
        ortho.right = viewHeight * aspect / 2;
        ortho.top = viewHeight / 2;
        ortho.bottom = -viewHeight / 2;
        ortho.updateProjectionMatrix();
        persp.aspect = aspect;
        persp.updateProjectionMatrix();
        invalidate();
    }

    function setProjection(mode) {
        const next = mode === 'perspective' ? persp : ortho;
        if (next === camera) {
            return;
        }
        // Keep the same view direction and roughly the same apparent size
        const offset = camera.position.clone().sub(controls.target);
        const visible = camera === ortho ? viewHeight / ortho.zoom
            : 2 * offset.length() * Math.tan(THREE.MathUtils.degToRad(persp.fov / 2));
        const direction = offset.normalize();
        if (next === persp) {
            const distance = visible / (2 * Math.tan(THREE.MathUtils.degToRad(persp.fov / 2)));
            persp.position.copy(controls.target).addScaledVector(direction, distance);
        } else {
            ortho.zoom = viewHeight / visible;
            ortho.position.copy(controls.target).addScaledVector(direction, 600);
            ortho.updateProjectionMatrix();
        }
        next.up.copy(camera.up);
        next.lookAt(controls.target);
        camera = next;
        controls.object = camera;
        gizmo.camera = camera;
        controls.update();
        invalidate();
    }

    function contentBox() {
        const box = new THREE.Box3();
        if (bodyGroup.children.length) {
            box.setFromObject(bodyGroup);
        }
        if (box.isEmpty()) {
            const half = PLANE_SIZE / 2;
            box.set(new THREE.Vector3(-half, -half, -half), new THREE.Vector3(half, half, half));
        }
        return box;
    }

    let animation = null;

    // Fly the camera so it looks along -normal with `up` at the top of the screen.
    // fit = true also centres and zooms on the content.
    function flyTo(normal, up, fit) {
        const box = contentBox();
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        const endTarget = fit ? sphere.center.clone() : controls.target.clone();
        const n = new THREE.Vector3().fromArray(normal).normalize();
        const u = new THREE.Vector3().fromArray(up).normalize();
        const m = new THREE.Matrix4().lookAt(n, new THREE.Vector3(), u);
        const endQuat = new THREE.Quaternion().setFromRotationMatrix(m);
        const distance = camera.position.distanceTo(controls.target);
        let endZoom = ortho.zoom;
        let endDistance = distance;
        if (fit) {
            const size = Math.max(sphere.radius * 2.3, 1);
            endZoom = viewHeight / size;
            endDistance = camera === persp
                ? size / (2 * Math.tan(THREE.MathUtils.degToRad(persp.fov / 2)))
                : 600;
        }
        animation = {
            started: performance.now(),
            duration: 380,
            startQuat: camera.quaternion.clone(),
            endQuat: endQuat,
            startTarget: controls.target.clone(),
            endTarget: endTarget,
            startZoom: ortho.zoom,
            endZoom: endZoom,
            startDistance: distance,
            endDistance: endDistance
        };
        controls.enabled = false;
        invalidate();
    }

    function stepAnimation(now) {
        const a = animation;
        let t = Math.min((now - a.started) / a.duration, 1);
        t = t * t * (3 - 2 * t);
        const q = a.startQuat.clone().slerp(a.endQuat, t);
        const tgt = a.startTarget.clone().lerp(a.endTarget, t);
        const distance = THREE.MathUtils.lerp(a.startDistance, a.endDistance, t);
        camera.position.copy(tgt).add(new THREE.Vector3(0, 0, 1).applyQuaternion(q).multiplyScalar(distance));
        camera.up.copy(new THREE.Vector3(0, 1, 0).applyQuaternion(q));
        camera.lookAt(tgt);
        controls.target.copy(tgt);
        if (camera === ortho) {
            ortho.zoom = THREE.MathUtils.lerp(a.startZoom, a.endZoom, t);
            ortho.updateProjectionMatrix();
        }
        if (t >= 1) {
            animation = null;
            controls.enabled = true;
        }
    }

    // OrbitControls always turns around world Z. A top or bottom view needs a
    // different screen-up (Y), so that is kept only until the next orbit starts.
    controls.addEventListener('start', function () {
        camera.up.copy(WORLD_UP);
    });

    function home() {
        // "up" for an isometric view is world Z projected on the view plane; lookAt sorts that out
        flyTo(HOME_DIRECTION.toArray(), WORLD_UP.toArray(), true);
    }

    function zoomAll() {
        const direction = camera.position.clone().sub(controls.target).normalize();
        flyTo(direction.toArray(), camera.up.toArray(), true);
    }

    function lookAtPlane(key) {
        const def = ORIGIN_PLANES[key];
        flyTo(def.normal, def.up, true);
    }

    /* ---------------- picking ---------------- */
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const EDGE_PIXELS = 6;
    let lastFaceDistance = Infinity; // how far the last face under the pointer was
    let lastFacePoint = null;       // and where on it the pointer was
    let planeHandler = null;    // set while a command waits for a plane or a planar face
    let planeDragHandler = null; // and, optionally, what dragging away from one does
    let planeDrag = null;       // { pick, frame, x, y, screen, active, offset } while pressed on a plane
    let hotPlane = null;
    let originPinned = false;
    let downAt = null;

    function setHotPlane(key) {
        if (key === hotPlane) {
            return;
        }
        hotPlane = key;
        Object.keys(planeMeshes).forEach(function (k) {
            planeMeshes[k].material.opacity = k === key ? 0.5 : 0.22;
        });
        if (options.onHoverPlane) {
            options.onHoverPlane(key);
        }
        invalidate();
    }

    // World millimetres covered by one screen pixel at the orbit centre
    function worldPerPixel() {
        const height = Math.max(stage.clientHeight, 1);
        if (camera === ortho) {
            return viewHeight / ortho.zoom / height;
        }
        const distance = camera.position.distanceTo(controls.target);
        return 2 * distance * Math.tan(THREE.MathUtils.degToRad(persp.fov / 2)) / height;
    }

    function aim(event) {
        const rect = canvas.getBoundingClientRect();
        pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
        raycaster.setFromCamera(pointer, camera);
    }

    // The range that owns `position` in a list of { start, count } sorted by start
    function ownerOf(ranges, position) {
        let low = 0;
        let high = ranges.length - 1;
        while (low <= high) {
            const mid = (low + high) >> 1;
            if (position < ranges[mid].start) {
                high = mid - 1;
            } else if (position >= ranges[mid].start + ranges[mid].count) {
                low = mid + 1;
            } else {
                return mid;
            }
        }
        return -1;
    }

    // The face or edge under the pointer. An edge wins over the face behind it
    // when the pointer is within a few pixels of it.
    function itemUnderPointer(event, wantEdges) {
        aim(event);
        const tolerance = EDGE_PIXELS * worldPerPixel();
        const faceHit = raycaster.intersectObjects(bodies.map(function (b) {
            return b.mesh;
        }), false).filter(function (hit) {
            return !cutAway(hit.point);
        })[0];
        let result = null;
        lastFaceDistance = faceHit ? faceHit.distance : Infinity;
        lastFacePoint = faceHit ? faceHit.point.toArray() : null;
        if (faceHit) {
            const body = faceHit.object.userData.body;
            const index = ownerOf(bodies[body].data.faces, faceHit.faceIndex * 3);
            if (index >= 0) {
                result = { type: 'face', body: body, index: index };
            }
        }
        if (componentMode) {
            // Whole components: the body under the pointer stands for its group
            return result ? { type: 'body', body: result.body } : null;
        }
        if (wantEdges && visualStyle !== 'shaded') {
            const lines = bodies.map(function (b) {
                return b.lines;
            });
            const edgeNear = function (threshold, limit) {
                raycaster.params.Line.threshold = threshold;
                return raycaster.intersectObjects(lines, false).filter(function (hit) {
                    return hit.distance <= limit && !cutAway(hit.point);
                })[0];
            };
            // A visible edge first (in front of the face under the pointer)
            let edgeHit = edgeNear(tolerance, faceHit ? faceHit.distance + tolerance * 2 : Infinity);
            // Wireframe and "hidden edges" draw the edges behind the faces
            // too: such an edge can be picked where it is drawn, when the
            // pointer is right on it (half the tolerance), so the faces in
            // front stay easy to pick everywhere else
            if (!edgeHit && (visualStyle === 'wireframe' || visualStyle === 'hidden-edges')) {
                edgeHit = edgeNear(tolerance * 0.5, Infinity);
            }
            if (edgeHit) {
                const body = edgeHit.object.userData.body;
                const index = ownerOf(bodies[body].data.edges, edgeHit.index);
                if (index >= 0) {
                    result = { type: 'edge', body: body, index: index };
                }
            }
        }
        return result;
    }

    function planeUnderPointer(event) {
        if (!originGroup.visible) {
            return null;
        }
        aim(event);
        const hits = raycaster.intersectObjects(Object.values(planeMeshes), false);
        return hits.length ? hits[0].object.userData.plane : null;
    }

    // What a plane pick would return here: a planar face of a body first,
    // then an origin plane when those are shown
    function planeTargetUnderPointer(event) {
        const item = itemUnderPointer(event, false);
        // A work plane in front of the model wins over the face behind it
        const sheet = raycaster.intersectObjects(workGroup.children, false).filter(function (hit) {
            return hit.object.userData.work;
        })[0];
        if (sheet && (!item || sheet.distance < lastFaceDistance)) {
            return { kind: 'work', id: sheet.object.userData.work };
        }
        if (item) {
            const info = describeItem(item);
            return info.type === 'plane' ? { kind: 'face', item: item, info: info } : null;
        }
        const key = planeUnderPointer(event);
        return key ? { kind: 'origin', key: key } : null;
    }

    // What a plane pick hands over for a target under the pointer
    function pickOf(target) {
        return target.kind === 'origin' ? { kind: 'origin', key: target.key }
            : target.kind === 'work' ? { kind: 'work', id: target.id }
                : { kind: 'face', body: target.item.body, face: target.item.index, origin: target.info.origin, normal: target.info.normal, point: lastFacePoint };
    }

    // Pressed on a plane while a plane is wanted: a drag pulls out an
    // offset plane (planedrag.js); a click still picks the plane
    function startPlaneDrag(event) {
        const target = planeTargetUnderPointer(event);
        const pick = target ? pickOf(target) : null;
        const frame = pick ? planeDragHandler.frameOf(pick) : null;
        if (!frame) {
            return;
        }
        // Where the press meets the plane, and how the normal shows on screen
        aim(event);
        const n = new THREE.Vector3().fromArray(frame.n);
        const hit = raycaster.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(n, new THREE.Vector3().fromArray(frame.o)), new THREE.Vector3());
        const at = hit ? hit.toArray() : frame.o;
        const a = project(at);
        const b = project([at[0] + frame.n[0], at[1] + frame.n[1], at[2] + frame.n[2]]);
        const rect = canvas.getBoundingClientRect();
        planeDrag = {
            pick: pick, frame: frame, x: event.clientX - rect.left, y: event.clientY - rect.top,
            screen: [b[0] - a[0], b[1] - a[1]], active: false, offset: 0
        };
        try {
            canvas.setPointerCapture(event.pointerId);
        } catch (e) {
            // A synthetic event has no pointer to capture
        }
    }

    canvas.addEventListener('pointermove', function (event) {
        if (planeDrag && (event.buttons & 1)) {
            const rect = canvas.getBoundingClientRect();
            const now = [event.clientX - rect.left, event.clientY - rect.top];
            if (!planeDrag.active && Math.hypot(now[0] - planeDrag.x, now[1] - planeDrag.y) > 5) {
                planeDrag.active = true;
                setHovered(null);
            }
            if (planeDrag.active) {
                const wpp = worldPerPixel();
                planeDrag.offset = snapOffset(dragOffset([planeDrag.x, planeDrag.y], now, planeDrag.screen, wpp), wpp);
                planeDragHandler.move(planeDrag.pick, planeDrag.offset, now);
            }
            return;
        }
        if (event.buttons || animation || (!interactive && !planeHandler)) {
            return;
        }
        if (gizmoActive && gizmo.axis !== null) {
            setHovered(null); // the pointer is on the triad
            return;
        }
        if (planeHandler) {
            const target = planeTargetUnderPointer(event);
            setHovered(target && target.kind === 'face' ? target.item : null);
            setHotPlane(target && target.kind === 'origin' ? target.key : null);
            setHotWork(target && target.kind === 'work' ? target.id : null);
            return;
        }
        setHovered(allowed(itemUnderPointer(event, true)));
    });
    canvas.addEventListener('pointerleave', function () {
        setHovered(null);
        setHotPlane(null);
    });
    canvas.addEventListener('pointerdown', function (event) {
        downAt = [event.clientX, event.clientY];
        planeDrag = null;
        if (planeHandler && planeDragHandler && event.button === 0 && leftDrag === 'select') {
            startPlaneDrag(event);
        }
        // A press on the triad drags it; it must not also pick what is behind
        gizmoGrab = gizmoActive && gizmo.axis !== null;
    });
    canvas.addEventListener('pointerup', function (event) {
        // A click, not the end of an orbit drag
        const moved = downAt ? Math.hypot(event.clientX - downAt[0], event.clientY - downAt[1]) : 99;
        downAt = null;
        const drag = planeDrag;
        planeDrag = null;
        if (drag && drag.active) {
            // Dragged off a plane: the offset plane, not a pick
            const handler = planeDragHandler;
            const rect = canvas.getBoundingClientRect();
            stopPlanePick();
            handler.end(drag.pick, drag.offset, [event.clientX - rect.left, event.clientY - rect.top]);
            return;
        }
        if (gizmoGrab) {
            gizmoGrab = false;
            return;
        }
        if (event.button !== 0 || moved > 4 || (!interactive && !planeHandler)) {
            return;
        }
        if (planeHandler) {
            const target = planeTargetUnderPointer(event);
            if (target) {
                const handler = planeHandler;
                stopPlanePick();
                handler(pickOf(target));
            }
            return;
        }
        const item = allowed(itemUnderPointer(event, true));
        // While a panel picks, every click adds or drops; nothing is cleared by a miss
        const additive = event.ctrlKey || event.shiftKey || event.metaKey || !!(pickFilter && pickFilter.toggle);
        if (!item) {
            if (!additive && selection.length) {
                setSelection([]);
            }
            return;
        }
        // A click anywhere on a picked tangent chain drops the chain
        const already = selection.some(function (s) {
            return sameChain(s, item);
        });
        if (additive) {
            setSelection(already ? selection.filter(function (s) {
                return !sameChain(s, item);
            }) : selection.concat([item]));
        } else {
            setSelection([item]);
        }
    });

    // Wait for the user to pick a plane. With a solid in the scene the planar
    // faces of the model are offered and the origin planes stay hidden (they
    // would cover the part); in an empty part the origin planes are shown.
    // Origin planes the user switched on stay pickable either way.
    // dragHandler (optional): { frameOf(pick) -> { o, x, y, n } or null,
    // move(pick, offset, [x, y]), end(pick, offset, [x, y]) } for dragging
    // an offset plane off the one under the pointer
    function startPlanePick(handler, withOrigin, dragHandler) {
        planeHandler = handler;
        planeDragHandler = dragHandler || null;
        planeDrag = null;
        setHovered(null);
        originGroup.visible = originPinned || !bodies.length || !!withOrigin;
        canvas.style.cursor = 'crosshair';
        invalidate();
    }

    function stopPlanePick() {
        planeHandler = null;
        planeDragHandler = null;
        planeDrag = null;
        setHotWork(null);
        setHotPlane(null);
        setHovered(null);
        originGroup.visible = originPinned;
        canvas.style.cursor = restCursor();
        invalidate();
    }

    function setOriginVisible(visible) {
        originPinned = visible;
        originGroup.visible = visible || (!!planeHandler && !bodies.length);
        invalidate();
    }

    // Turn the camera square onto a plane given by its normal
    function lookAlong(normal) {
        const n = new THREE.Vector3().fromArray(normal).normalize();
        const up = Math.abs(n.z) > 0.99 ? [0, n.z > 0 ? 1 : -1, 0] : [0, 0, 1];
        flyTo(n.toArray(), up, true);
    }

    /* ---------------- feature tools: regions, preview solid, drag arrow ---------------- */
    // What a feature panel (features/extrude.js) shows in the model while it
    // is open: the sketch regions that can be picked, the solid the feature
    // would make, and an arrow to pull its distance.
    const regionGroup = new THREE.Group();
    const previewGroup = new THREE.Group();
    const arrowHead = new THREE.Group();
    scene.add(regionGroup);
    scene.add(previewGroup);
    scene.add(arrowHead);
    const regionMaterial = function (color, opacity) {
        return new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: opacity, side: THREE.DoubleSide, depthTest: false });
    };
    const regionMaterials = {
        idle: regionMaterial(0x3b78e0, 0.16),
        hot: regionMaterial(0x3b78e0, 0.42),
        selected: regionMaterial(HOVER, 0.5),
        selectedHot: regionMaterial(HOVER, 0.68)
    };
    let regionItems = [];
    let regionHandler = null;
    let hotRegion = -1;

    function paintRegions() {
        regionGroup.children.forEach(function (mesh, i) {
            const hot = i === hotRegion;
            mesh.material = regionMaterials[regionItems[i].selected ? (hot ? 'selectedHot' : 'selected') : (hot ? 'hot' : 'idle')];
        });
        invalidate();
    }

    // list: [{ positions: Float32Array (triangles, world), selected }] or null
    // to stop. handler(index) is called when a region is clicked.
    function setRegions(list, handler) {
        disposeGroup(regionGroup);
        regionItems = list || [];
        regionHandler = list ? handler : null;
        hotRegion = -1;
        regionItems.forEach(function (item) {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(item.positions, 3));
            const mesh = new THREE.Mesh(geometry, regionMaterials.idle);
            mesh.renderOrder = 3;
            regionGroup.add(mesh);
        });
        if (!list) {
            canvas.style.cursor = restCursor();
        }
        paintRegions();
    }

    /* ---- lines to pick as an axis (Revolve) ---- */
    // Drawn over everything, picked by their distance on screen, so a line
    // seen end-on or behind the model can still be had
    const axisGroup = new THREE.Group();
    scene.add(axisGroup);
    const axisMaterials = {
        idle: new LineMaterial({ color: 0x3b78e0, linewidth: 2, depthTest: false, depthWrite: false, transparent: true, opacity: 0.85 }),
        hot: new LineMaterial({ color: HOVER, linewidth: 4, depthTest: false, depthWrite: false }),
        selected: new LineMaterial({ color: SELECTED, linewidth: 4, depthTest: false, depthWrite: false })
    };
    let axisItems = [];
    let axisHandler = null;
    let hotAxis = -1;

    function paintAxes() {
        axisGroup.children.forEach(function (line, i) {
            line.material = axisMaterials[i === hotAxis ? 'hot' : axisItems[i].selected ? 'selected' : 'idle'];
        });
        invalidate();
    }

    // list: [{ a: [x, y, z], b: [x, y, z], selected }] or null to stop;
    // handler(index) is called when one is clicked
    function setAxes(list, handler) {
        disposeGroup(axisGroup);
        axisItems = list || [];
        axisHandler = list ? handler : null;
        hotAxis = -1;
        axisItems.forEach(function (item) {
            const geometry = new LineSegmentsGeometry();
            geometry.setPositions(item.a.concat(item.b));
            const line = new LineSegments2(geometry, axisMaterials.idle);
            line.renderOrder = 7;
            axisGroup.add(line);
        });
        paintAxes();
    }

    function axisUnderPointer(event) {
        const rect = canvas.getBoundingClientRect();
        const px = [event.clientX - rect.left, event.clientY - rect.top];
        let best = -1;
        let bestD = 8;
        axisItems.forEach(function (item, i) {
            const a = project(item.a);
            const b = project(item.b);
            const dx = b[0] - a[0];
            const dy = b[1] - a[1];
            const len2 = dx * dx + dy * dy;
            const t = len2 ? Math.max(0, Math.min(1, ((px[0] - a[0]) * dx + (px[1] - a[1]) * dy) / len2)) : 0;
            const d = Math.hypot(px[0] - a[0] - dx * t, px[1] - a[1] - dy * t);
            if (d < bestD) {
                bestD = d;
                best = i;
            }
        });
        return best;
    }

    function regionUnderPointer(event) {
        aim(event);
        const hit = raycaster.intersectObjects(regionGroup.children, false)[0];
        return hit ? regionGroup.children.indexOf(hit.object) : -1;
    }

    const previewColors = { join: 0x4caf6d, new: 0x4caf6d, cut: 0xd64545, intersect: 0x3b78e0 };

    // The body as a fillet or chamfer would leave it: the model's own colour,
    // with the faces the feature makes (mesh.fresh: [start, count] index
    // ranges) in the preview green, as Inventor shows them
    function resultMesh(geometry, mesh) {
        // The part's own look (colour, finish, pattern), not the ghost's
        const plain = bodyMaterial.clone();
        plain.transparent = baseOpacity < 1;
        plain.opacity = baseOpacity;
        plain.depthWrite = baseOpacity >= 1;
        plain.visible = true;
        const fresh = new THREE.MeshStandardMaterial({
            color: previewColors.join, metalness: 0.05, roughness: 0.55,
            polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
        });
        const ranges = (mesh.fresh || []).slice().sort(function (a, b) {
            return a[0] - b[0];
        });
        let at = 0;
        ranges.forEach(function (range) {
            if (range[0] > at) {
                geometry.addGroup(at, range[0] - at, 0);
            }
            geometry.addGroup(range[0], range[1], 1);
            at = range[0] + range[1];
        });
        if (at < mesh.indices.length) {
            geometry.addGroup(at, mesh.indices.length - at, 0);
        }
        return new THREE.Mesh(geometry, [plain, fresh]);
    }

    // mesh: { positions, indices, edgePositions } from the kernel (or a list
    // of them), or null. What is removed (cut, intersect) is drawn through
    // the body so it can be seen. kind "result" is the whole body as it would
    // become (fillet, chamfer; see resultMesh), with the real body turned to
    // a ghost that can still be picked.
    function setPreview(meshes, kind) {
        while (previewGroup.children.length) {
            const child = previewGroup.children.pop();
            child.geometry.dispose();
            [].concat(child.material).forEach(function (material) {
                material.dispose();
            });
        }
        ghostOn = !!meshes && kind === 'result';
        applyGhost();
        (Array.isArray(meshes) ? meshes : meshes ? [meshes] : []).forEach(function (mesh) {
            const adds = kind === 'join' || kind === 'new' || kind === 'result';
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
            geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
            geometry.computeVertexNormals();
            addUVs(geometry);
            const solid = kind === 'result' ? resultMesh(geometry, mesh) : new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
                color: previewColors[kind] || previewColors.join, transparent: true, opacity: 0.45,
                depthWrite: false, depthTest: adds, roughness: 0.7,
                polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
            }));
            solid.renderOrder = 2;
            const lineGeometry = new THREE.BufferGeometry();
            lineGeometry.setAttribute('position', new THREE.BufferAttribute(mesh.edgePositions, 3));
            const lines = new THREE.LineSegments(lineGeometry, new THREE.LineBasicMaterial({
                color: 0x20242b, transparent: kind !== 'result', opacity: kind === 'result' ? 1 : 0.7, depthTest: adds
            }));
            lines.renderOrder = 2;
            previewGroup.add(solid);
            previewGroup.add(lines);
            if (kind === 'result') {
                // The body as it would become, in the visual style of the
                // body: covered edges dashed in "hidden edges" and wireframe,
                // no surfaces in wireframe (applyVisualStyle)
                solid.userData.role = 'result-solid';
                lines.userData.role = 'result-lines';
                const depth = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
                    colorWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
                }));
                depth.userData.role = 'result-depth';
                depth.renderOrder = -1;
                previewGroup.add(depth);
                const hidden = new THREE.LineSegments(lineGeometry, hiddenLineMaterial());
                hidden.computeLineDistances();
                hidden.userData.role = 'result-hidden';
                hidden.renderOrder = 3;
                previewGroup.add(hidden);
            }
        });
        applyVisualStyle();
        invalidate();
    }

    // The arrow: built for a size of one pixel per unit and scaled every
    // frame, so it stays the same size on screen at any zoom.
    const arrowMaterial = new THREE.MeshBasicMaterial({ color: 0xe07b1f, depthTest: false });
    const arrowPart = function (geometry, y) {
        const mesh = new THREE.Mesh(geometry, arrowMaterial);
        mesh.position.y = y;
        mesh.renderOrder = 4;
        arrowHead.add(mesh);
        return mesh;
    };
    arrowPart(new THREE.SphereGeometry(4.5, 16, 12), 0);
    arrowPart(new THREE.CylinderGeometry(1.6, 1.6, 26, 12), 13);
    arrowPart(new THREE.ConeGeometry(5.5, 14, 16), 33);
    const arrowGrab = arrowPart(new THREE.SphereGeometry(16, 8, 6), 16);
    arrowGrab.material = new THREE.MeshBasicMaterial({ visible: false });
    arrowHead.visible = false;
    let arrow = null;       // { origin, dir, length, onDrag }
    let arrowDrag = false;
    let featureDown = null;

    function placeArrow() {
        if (!arrow) {
            return;
        }
        arrowHead.position.copy(arrow.origin).addScaledVector(arrow.dir, arrow.length);
        arrowHead.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), arrow.dir);
        arrowHead.scale.setScalar(worldPerPixel());
    }

    // spec: { origin: [x, y, z], dir: [x, y, z], length } or null.
    // onDrag(distance, done) gets the distance along dir under the pointer.
    function setArrow(spec, onDrag) {
        arrow = spec ? {
            origin: new THREE.Vector3().fromArray(spec.origin),
            dir: new THREE.Vector3().fromArray(spec.dir).normalize(),
            length: spec.length,
            onDrag: onDrag
        } : null;
        arrowHead.visible = !!arrow;
        placeArrow();
        invalidate();
    }

    // Where along the arrow's axis the pointer is: the point of the axis
    // closest to the ray through the pointer
    function alongAxis(event) {
        aim(event);
        const d1 = raycaster.ray.direction;
        const w = raycaster.ray.origin.clone().sub(arrow.origin);
        const b = d1.dot(arrow.dir);
        const denominator = 1 - b * b;
        if (denominator < 1e-6) {
            return null; // looking straight down the axis
        }
        return (arrow.dir.dot(w) - b * d1.dot(w)) / denominator;
    }

    // Registered for the capture phase so a grab of the arrow never starts an orbit
    canvas.addEventListener('pointerdown', function (event) {
        featureDown = [event.clientX, event.clientY];
        if (!arrow || event.button !== 0) {
            return;
        }
        aim(event);
        if (raycaster.intersectObject(arrowGrab, false).length) {
            arrowDrag = true;
            controls.enabled = false;
            event.stopImmediatePropagation();
            try {
                canvas.setPointerCapture(event.pointerId);
            } catch (e) {
                // The pointer is already gone; the drag still works inside the canvas
            }
        }
    }, true);
    canvas.addEventListener('pointermove', function (event) {
        if (arrowDrag) {
            const t = alongAxis(event);
            if (t !== null) {
                arrow.onDrag(t, false);
            }
            return;
        }
        let overAxis = false;
        if (axisHandler && !event.buttons && !animation) {
            const axis = axisUnderPointer(event);
            overAxis = axis >= 0;
            if (axis !== hotAxis) {
                hotAxis = axis;
                canvas.style.cursor = overAxis ? 'default' : restCursor();
                paintAxes();
            }
        }
        if (regionHandler && !event.buttons && !animation) {
            const index = overAxis ? -1 : regionUnderPointer(event);
            if (index !== hotRegion) {
                hotRegion = index;
                canvas.style.cursor = index >= 0 || overAxis ? 'default' : restCursor();
                paintRegions();
            }
        }
    });
    canvas.addEventListener('pointerup', function (event) {
        const moved = featureDown ? Math.hypot(event.clientX - featureDown[0], event.clientY - featureDown[1]) : 99;
        featureDown = null;
        if (arrowDrag) {
            arrowDrag = false;
            controls.enabled = true;
            const t = alongAxis(event);
            if (arrow && t !== null) {
                arrow.onDrag(t, true);
            }
            return;
        }
        if (axisHandler && event.button === 0 && moved <= 4) {
            const axis = axisUnderPointer(event);
            if (axis >= 0) {
                axisHandler(axis);
                return; // an axis in front of a region wins
            }
        }
        if (regionHandler && event.button === 0 && moved <= 4) {
            const index = regionUnderPointer(event);
            if (index >= 0) {
                regionHandler(index);
            }
        }
    });

    /* ---------------- move / rotate / scale triad (assemblies) ---------------- */
    // three.js TransformControls on a stand-in object at the component's
    // centre. The handler gets the change as a matrix (stand-in now times
    // stand-in at the start, inverted): the component's placement times it.
    const gizmo = new TransformControls(camera, canvas);
    const gizmoHelper = gizmo.getHelper();
    scene.add(gizmoHelper);
    const gizmoProxy = new THREE.Object3D();
    scene.add(gizmoProxy);
    const gizmoStart = new THREE.Matrix4();
    let gizmoActive = false;
    let gizmoGrab = false;      // the last press landed on the triad
    let gizmoHandler = null;
    gizmo.addEventListener('change', invalidate);
    gizmo.addEventListener('dragging-changed', function (event) {
        controls.enabled = !event.value;
        if (!event.value && gizmoHandler) {
            gizmoHandler(gizmoDelta(), true);
        }
    });
    gizmo.addEventListener('objectChange', function () {
        if (gizmo.mode === 'scale') {
            // One size in all three directions: the one being pulled
            const s = gizmoProxy.scale;
            let pulled = 1;
            [s.x, s.y, s.z].forEach(function (v) {
                if (Math.abs(v - 1) > Math.abs(pulled - 1)) {
                    pulled = v;
                }
            });
            s.setScalar(Math.max(pulled, 0.01));
        }
        if (gizmoHandler) {
            gizmoHandler(gizmoDelta(), false);
        }
    });

    function gizmoDelta() {
        gizmoProxy.updateMatrixWorld(true);
        return gizmoProxy.matrixWorld.clone().multiply(gizmoStart.clone().invert()).toArray();
    }

    // spec: { position: [x, y, z], rotation: 3 x 3 row-major (how the
    // component is turned, for the Local space), mode: "translate" |
    // "rotate" | "scale", space: "world" | "local", snap: { move, turn
    // (degrees), scale } or null }. handler(delta matrix, done)
    function attachGizmo(spec, handler) {
        gizmoProxy.position.fromArray(spec.position);
        if (spec.rotation) {
            const r = spec.rotation;
            gizmoProxy.quaternion.setFromRotationMatrix(new THREE.Matrix4().set(r[0], r[1], r[2], 0, r[3], r[4], r[5], 0, r[6], r[7], r[8], 0, 0, 0, 0, 1));
        } else {
            gizmoProxy.quaternion.identity();
        }
        gizmoProxy.scale.set(1, 1, 1);
        gizmoProxy.updateMatrixWorld(true);
        gizmoStart.copy(gizmoProxy.matrixWorld);
        gizmo.camera = camera;
        gizmo.setMode(spec.mode || 'translate');
        gizmo.setSpace(spec.space || 'world');
        gizmo.setTranslationSnap(spec.snap ? spec.snap.move : null);
        gizmo.setRotationSnap(spec.snap ? THREE.MathUtils.degToRad(spec.snap.turn) : null);
        gizmo.setScaleSnap(spec.snap ? spec.snap.scale : null);
        if (!gizmoActive) {
            gizmo.attach(gizmoProxy);
        }
        gizmoActive = true;
        gizmoHandler = handler;
        invalidate();
    }

    function detachGizmo() {
        if (gizmoActive) {
            gizmo.detach();
        }
        gizmoActive = false;
        gizmoHandler = null;
        gizmoGrab = false;
        controls.enabled = true;
        invalidate();
    }

    /* ---------------- measure lines ---------------- */
    // [{ a: [x, y, z], b: [x, y, z], label }] drawn over the model: a line
    // between the two closest points and its value beside the middle
    const measureGroup = new THREE.Group();
    scene.add(measureGroup);
    const measureMaterial = new LineMaterial({ color: 0xe07b1f, linewidth: 2.5, depthTest: false, depthWrite: false, transparent: true });
    const measureDot = new THREE.MeshBasicMaterial({ color: 0xe07b1f, depthTest: false });
    let measureLabels = [];

    function setMeasure(list) {
        while (measureGroup.children.length) {
            const child = measureGroup.children.pop();
            child.geometry.dispose();
        }
        measureLabels.forEach(function (label) {
            label.el.remove();
        });
        measureLabels = [];
        (list || []).forEach(function (m) {
            const geometry = new LineSegmentsGeometry();
            geometry.setPositions(m.a.concat(m.b));
            const line = new LineSegments2(geometry, measureMaterial);
            line.renderOrder = 9;
            measureGroup.add(line);
            [m.a, m.b].forEach(function (p) {
                const dot = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), measureDot);
                dot.position.fromArray(p);
                dot.userData.dot = true;
                dot.renderOrder = 9;
                measureGroup.add(dot);
            });
            if (m.label) {
                const el = document.createElement('div');
                el.className = 'measure-label';
                el.textContent = m.label;
                stage.appendChild(el);
                measureLabels.push({ el: el, point: [(m.a[0] + m.b[0]) / 2, (m.a[1] + m.b[1]) / 2, (m.a[2] + m.b[2]) / 2] });
            }
        });
        invalidate();
    }

    function placeMeasureLabels() {
        const size = worldPerPixel() * 4;
        measureGroup.children.forEach(function (child) {
            if (child.userData.dot) {
                child.scale.setScalar(size);
            }
        });
        measureLabels.forEach(function (label) {
            const at = project(label.point);
            label.el.style.left = Math.round(at[0] + 8) + 'px';
            label.el.style.top = Math.round(at[1] - 10) + 'px';
        });
    }

    /* ---------------- view cube ---------------- */
    // A CSS 3D cube that follows the camera. Every face is a 3 x 3 grid: the
    // middle looks straight at the face, a border cell at the edge it touches
    // and a corner cell at the corner, like the cube of a desktop CAD system.
    // The two (or three) cells that meet at an edge (or corner) share a key,
    // so they light up together.
    const cubeCam = options.viewCube;
    const CUBE_HALF = 25;
    const cubeCells = {};

    function lightCells(key, on) {
        (cubeCells[key] || []).forEach(function (cell) {
            cell.classList.toggle('hot', on);
        });
    }

    CUBE_FACES.forEach(function (face) {
        const n = new THREE.Vector3().fromArray(face.normal);
        const u = new THREE.Vector3().fromArray(face.up);
        const x = new THREE.Vector3().crossVectors(u, n);
        const m = new THREE.Matrix4().makeBasis(x, u, n).setPosition(n.clone().multiplyScalar(CUBE_HALF));
        const e = m.elements;
        // Same element order three.js uses for CSS 3D objects (Y axis flipped)
        const css = [e[0], e[1], e[2], e[3], -e[4], -e[5], -e[6], -e[7], e[8], e[9], e[10], e[11], e[12], e[13], e[14], e[15]];
        const el = document.createElement('div');
        el.className = 'vc-face';
        el.style.transform = 'translate(-50%,-50%) matrix3d(' + css.map(fix).join(',') + ')';
        // Rows run top to bottom on the face, columns left to right
        for (let row = 1; row >= -1; row--) {
            for (let col = -1; col <= 1; col++) {
                const direction = n.clone().addScaledVector(x, col).addScaledVector(u, row);
                const key = [direction.x, direction.y, direction.z].map(Math.round).join(',');
                const cell = document.createElement('div');
                cell.className = 'vc-cell';
                (cubeCells[key] = cubeCells[key] || []).push(cell);
                cell.addEventListener('mouseenter', function () {
                    lightCells(key, true);
                });
                cell.addEventListener('mouseleave', function () {
                    lightCells(key, false);
                });
                cell.addEventListener('click', function () {
                    // Straight onto a face keeps that face's own "up"; any
                    // tilted view stands upright on world Z
                    const straight = row === 0 && col === 0;
                    flyTo(direction.toArray(), straight ? face.up : WORLD_UP.toArray(), true);
                });
                el.appendChild(cell);
            }
        }
        const label = document.createElement('span');
        label.className = 'vc-label';
        label.textContent = face.name;
        el.appendChild(label);
        cubeCam.appendChild(el);
    });

    function fix(v) {
        return Math.abs(v) < 1e-10 ? 0 : v;
    }

    const rotationOnly = new THREE.Matrix4();

    function updateOverlays() {
        rotationOnly.extractRotation(camera.matrixWorldInverse);
        const e = rotationOnly.elements;
        cubeCam.style.transform = 'matrix3d(' + [
            e[0], -e[1], e[2], 0, e[4], -e[5], e[6], 0, e[8], -e[9], e[10], 0, 0, 0, 0, 1
        ].map(fix).join(',') + ')';
        drawTriad();
    }

    /* ---------------- axis triad ---------------- */
    const triad = options.triad;
    const AXES = [
        { name: 'X', dir: new THREE.Vector3(1, 0, 0), color: '#d64545' },
        { name: 'Y', dir: new THREE.Vector3(0, 1, 0), color: '#2e9e5b' },
        { name: 'Z', dir: new THREE.Vector3(0, 0, 1), color: '#3b78e0' }
    ];

    function drawTriad() {
        const parts = AXES.map(function (axis) {
            const v = axis.dir.clone().applyMatrix4(rotationOnly);
            return { axis: axis, x: v.x * 26, y: -v.y * 26, depth: v.z };
        }).sort(function (a, b) {
            return a.depth - b.depth;
        });
        triad.innerHTML = parts.map(function (p) {
            return '<line x1="0" y1="0" x2="' + p.x.toFixed(1) + '" y2="' + p.y.toFixed(1) + '" stroke="' + p.axis.color +
                '" stroke-width="2.4" stroke-linecap="round"/><text x="' + (p.x * 1.32).toFixed(1) + '" y="' +
                (p.y * 1.32).toFixed(1) + '" fill="' + p.axis.color + '">' + p.axis.name + '</text>';
        }).join('');
    }

    /* ---------------- sketches ---------------- */
    // Finished sketches drawn in the model: [{ id, segments: Float32Array }]
    // in world coordinates, two vertices per segment.
    const sketchGroup = new THREE.Group();
    const sketchMaterial = new THREE.LineBasicMaterial({ color: 0x3b78e0 });
    scene.add(sketchGroup);

    function setSketches(list) {
        disposeGroup(sketchGroup);
        list.forEach(function (sketch) {
            if (!sketch.segments.length) {
                return;
            }
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(sketch.segments, 3));
            sketchGroup.add(new THREE.LineSegments(geometry, sketchMaterial));
        });
        invalidate();
    }

    /* ---------------- screen <-> sketch plane ---------------- */
    const scratch = new THREE.Vector3();

    // World point -> canvas pixel [x, y] (CSS pixels from the canvas corner)
    function project(point) {
        scratch.set(point[0], point[1], point[2]).project(camera);
        return [(scratch.x + 1) / 2 * stage.clientWidth, (1 - scratch.y) / 2 * stage.clientHeight];
    }

    // Pointer position -> coordinates [u, v] on a plane { o, x, y, n },
    // or null when the view is edge-on to the plane
    function pointOnPlane(clientX, clientY, frame) {
        aim({ clientX: clientX, clientY: clientY });
        const n = new THREE.Vector3().fromArray(frame.n);
        const o = new THREE.Vector3().fromArray(frame.o);
        const denominator = raycaster.ray.direction.dot(n);
        if (Math.abs(denominator) < 1e-6) {
            return null;
        }
        const t = o.clone().sub(raycaster.ray.origin).dot(n) / denominator;
        const hit = raycaster.ray.origin.clone().addScaledVector(raycaster.ray.direction, t).sub(o);
        return [hit.dot(scratch.fromArray(frame.x)), hit.dot(scratch.fromArray(frame.y))];
    }

    /* ---------------- render loop ---------------- */
    let scheduled = false;

    function invalidate() {
        if (!scheduled) {
            scheduled = true;
            requestAnimationFrame(render);
        }
    }

    function render(now) {
        scheduled = false;
        if (animation) {
            stepAnimation(now);
        }
        camera.updateMatrixWorld();
        if (groundDirty) {
            placeGround();
        }
        updateSilhouettes();
        updateDashes();
        placeArrow();
        headlight.position.copy(camera.position);
        headlight.target.position.copy(controls.target);
        renderer.render(scene, camera);
        updateOverlays();
        placeMeasureLabels();
        if (api.onRender) {
            api.onRender();
        }
        if (animation) {
            invalidate();
        }
    }

    new ResizeObserver(resize).observe(stage);
    // The theme (body.dark) decides the wireframe line colour
    new MutationObserver(function () {
        applyVisualStyle();
        invalidate();
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    resize();
    ortho.zoom = 1;
    home();

    Object.assign(api, {
        invalidate: invalidate,
        setBodies: setBodies,
        setSketches: setSketches,
        setWorkPlanes: setWorkPlanes,
        selectEdges: selectEdges,
        selectFaces: selectFaces,
        // Limit what can be picked: { edges, faces, toggle } or null for everything
        setPickFilter: function (filter) {
            pickFilter = filter;
            setHovered(null);
        },
        // Tangent chains for the active pick filter (see chainOf), or null
        setEdgeChains: function (chains) {
            if (pickFilter) {
                pickFilter.chains = chains;
                drawOverlays();
            }
        },
        coveredEdges: coveredEdges,
        setRegions: setRegions,
        setAxes: setAxes,
        setPreview: setPreview,
        setArrow: setArrow,
        // Faces and edges of the model react to the pointer (true) or not
        setPicking: function (on) {
            interactive = on;
            if (!on) {
                setHovered(null);
            }
        },
        // The face or edge of the model at a screen position, whatever mode is on
        modelItemAt: function (clientX, clientY) {
            return itemUnderPointer({ clientX: clientX, clientY: clientY }, true);
        },
        hoverModel: function (item) {
            setHovered(item || null);
        },
        // The exact edge shapes of a model item: one for an edge, all of
        // them for a face. Edges that are neither straight nor circular are left out.
        curvesOf: function (item) {
            const data = item && bodies[item.body] && bodies[item.body].data;
            if (!data) {
                return [];
            }
            const list = item.type === 'face' ? (data.faces[item.index].edges || []) : [item.index];
            return list.map(function (i) {
                return data.edges[i] && data.edges[i].curve;
            }).filter(Boolean);
        },
        project: project,
        pointOnPlane: pointOnPlane,
        worldPerPixel: worldPerPixel,
        isPicking: function () {
            return !!planeHandler;
        },
        // While sketching the left button draws; middle and right still pan,
        // the wheel zooms, and faces and edges of the model are not picked
        setSketching: function (on) {
            interactive = !on;
            sketching = on;
            groundDirty = true;
            controls.mouseButtons.LEFT = leftButton();
            if (on) {
                setHovered(null);
                if (selection.length) {
                    setSelection([]);
                }
            }
        },
        bodyCount: function () {
            return bodies.length;
        },
        selection: function () {
            return selection.map(describeItem);
        },
        clearSelection: function () {
            if (selection.length) {
                setSelection([]);
            }
        },
        lookAlong: lookAlong,
        // The look of the part on show (appearance.js), or null for the default
        setAppearance: function (app) {
            partAppearance = app || null;
            refreshLooks();
        },
        // How models are shown (appearance.js normalizeScene)
        setScene: function (s) {
            sceneOpts = normalizeScene(s);
            applyLighting();
            groundDirty = true;
            refreshLooks();
        },
        // The kernel's description of a picked face (type, centre, area,
        // normal or axis), for appearance.js faceRef
        faceInfo: function (item) {
            const body = item && bodies[item.body];
            return body && body.data.faces ? body.data.faces[item.index] || null : null;
        },
        // Where the camera is, to keep with a document tab, and back
        viewState: function () {
            return {
                projection: camera === persp ? 'perspective' : 'orthographic',
                position: camera.position.toArray(), up: camera.up.toArray(),
                target: controls.target.toArray(), zoom: ortho.zoom
            };
        },
        setViewState: function (s) {
            if (!s) {
                return;
            }
            animation = null;
            setProjection(s.projection);
            camera.position.fromArray(s.position);
            camera.up.fromArray(s.up);
            controls.target.fromArray(s.target);
            if (camera === ortho) {
                ortho.zoom = s.zoom;
                ortho.updateProjectionMatrix();
            }
            camera.lookAt(controls.target);
            controls.update();
            invalidate();
        },
        // Look from `normal` (the side the camera goes to) with `up` up,
        // the model fitted in the view (drawing views pick a direction so)
        viewFrom: function (normal, up) {
            flyTo(normal, up, true);
        },
        setVisualStyle: setVisualStyle,
        setSection: setSection,
        // What dragging the left button does: "select" (nothing; it picks and
        // draws), "orbit" or "pan"
        setLeftDrag: function (action) {
            leftDrag = action;
            controls.mouseButtons.LEFT = leftButton();
            canvas.style.cursor = hovered ? 'default' : restCursor();
        },
        // Is the left button lent to the view (so tools must leave it alone)?
        isNavigating: function () {
            return leftDrag !== 'select';
        },
        setProjection: setProjection,
        projection: function () {
            return camera === persp ? 'perspective' : 'orthographic';
        },
        home: home,
        zoomAll: zoomAll,
        lookAtPlane: lookAtPlane,
        startPlanePick: startPlanePick,
        stopPlanePick: stopPlanePick,
        setHotPlane: setHotPlane,
        setOriginVisible: setOriginVisible,

        /* ---- assemblies ---- */
        // Pick whole components (body groups) instead of faces and edges
        setComponentMode: function (on) {
            componentMode = !!on;
            setHovered(null);
            if (selection.some(function (item) {
                return (item.type === 'body') !== componentMode;
            })) {
                setSelection([]);
            }
        },
        // Move one body to a new placement without rebuilding anything
        setBodyMatrix: function (index, matrix) {
            if (bodies[index]) {
                placeBody(bodies[index], matrix);
                drawOverlays();
                if (section.mode !== 'none') {
                    applySection();
                }
            }
        },
        // Many bodies at once: { index: matrix }
        setBodyMatrices: function (map) {
            Object.keys(map).forEach(function (index) {
                if (bodies[index]) {
                    placeBody(bodies[index], map[index]);
                }
            });
            drawOverlays();
            if (section.mode !== 'none') {
                applySection();
            }
        },
        // Select raw items ({ type: "face" | "edge" | "body", body, index });
        // quiet leaves the selection handlers uninformed
        selectItems: function (items, quiet) {
            selection = (items || []).slice();
            drawOverlays();
            if (!quiet) {
                announceSelection();
            }
        },
        // Light up components: { group: "hover" | "selected" }
        setGroupTint: function (map) {
            groupTints = map || {};
            applyTints();
            invalidate();
        },
        // The body under a screen point, and where on it: { body, group, point } or null
        bodyAt: function (clientX, clientY) {
            aim({ clientX: clientX, clientY: clientY });
            const hit = raycaster.intersectObjects(bodies.map(function (b) {
                return b.mesh;
            }), false).filter(function (h) {
                return !cutAway(h.point);
            })[0];
            if (!hit) {
                return null;
            }
            const index = hit.object.userData.body;
            return { body: index, group: groupOf(index), point: hit.point.toArray() };
        },
        // The origin plane under a screen point (only while they are shown)
        originPlaneAt: function (clientX, clientY) {
            return planeUnderPointer({ clientX: clientX, clientY: clientY });
        },
        // Where the pointer is on the plane through `point` square to the view
        pointOnViewPlane: function (clientX, clientY, point) {
            aim({ clientX: clientX, clientY: clientY });
            const normal = new THREE.Vector3();
            camera.getWorldDirection(normal);
            const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, new THREE.Vector3().fromArray(point));
            const hit = new THREE.Vector3();
            return raycaster.ray.intersectPlane(plane, hit) ? hit.toArray() : null;
        },
        // The screen directions in the world: right, up and into the screen
        cameraBasis: function () {
            camera.updateMatrixWorld();
            const e = camera.matrixWorld.elements;
            return { right: [e[0], e[1], e[2]], up: [e[4], e[5], e[6]], forward: [-e[8], -e[9], -e[10]] };
        },
        modelBounds: modelBounds,
        sectionSpec: function () {
            return Object.assign({}, section);
        },
        attachGizmo: attachGizmo,
        detachGizmo: detachGizmo,
        isGizmoDragging: function () {
            return gizmoActive && gizmo.dragging;
        },
        setMeasure: setMeasure
    });
    return api;
}
