/*
    app.js

    3D Viewer - scene, camera, UI wiring and ArozOS desktop integration.

    The viewer works in a Z-up world (matching how STL / STEP / 3MF data is
    authored and what the axis gizmo shows). Formats that three.js hands back
    Y-up are rotated a quarter turn about X when they are added to the scene.
*/

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadModel, extOf, FORMATS, isSupported } from './formats.js';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const DEFAULT_COLOR = 0xd9d332;

// Travel moves in a sliced toolpath: visible enough to read, quiet enough not
// to bury the printed material under a hairball of lines.
const TRAVEL_MOVE_COLOR = 0x9aa0a6;

// Fixed studio light the toolpath shading is baked against. Weighted towards
// one horizontal axis so that two walls meeting at a corner land far apart in
// brightness instead of both sitting near the middle of the range.
const TOOLPATH_LIGHT = new THREE.Vector3(-0.82, -0.26, 0.51).normalize();
const TOOLPATH_AMBIENT = 0.3;

const PALETTE = [
    0xd9d332, 0xe8a33d, 0xd9534f, 0xc45bb0, 0x7a5cd1, 0x3f7fd6,
    0x35a7b5, 0x4caf72, 0x8bc34a, 0xb5651d, 0xe6e6e6, 0x8e9299,
    0x5a5f66, 0x2b2f36, 0xd8c9a3, 0xbfa46a, 0xa77b52, 0xf2f2f2
];

const VIEW_DIRS = {
    top: new THREE.Vector3(0, 0, 1),
    front: new THREE.Vector3(0, -1, 0),
    right: new THREE.Vector3(1, 0, 0),
    iso: new THREE.Vector3(1, -1, 0.55).normalize()
};

const LIGHTING = {
    studio: { env: 0.75, key: 1.5, fill: 0.45, rim: 0.3, hemi: 0.22 },
    soft: { env: 1.05, key: 0.75, fill: 0.7, rim: 0.4, hemi: 0.6 },
    dramatic: { env: 0.22, key: 3.0, fill: 0.1, rim: 0.9, hemi: 0.08 },
    flat: { env: 0.7, key: 0.7, fill: 0.7, rim: 0.7, hemi: 1.0 }
};

/* ------------------------------------------------------------------ */
/* DOM                                                                 */
/* ------------------------------------------------------------------ */

const $id = function (id) { return document.getElementById(id); };

const dom = {
    stage: $id('stage'),
    canvas: $id('gl'),
    fileCard: $id('fileCard'),
    fileName: $id('fileName'),
    fileType: $id('fileType'),
    fileDim: $id('fileDim'),
    fileSize: $id('fileSize'),
    viewModes: $id('viewModes'),
    colorBtn: $id('colorBtn'),
    colorSwatch: $id('colorSwatch'),
    palette: $id('palette'),
    btnReset: $id('btnReset'),
    btnFit: $id('btnFit'),
    btnCenter: $id('btnCenter'),
    btnFullscreen: $id('btnFullscreen'),
    btnLeftDrawer: $id('btnLeftDrawer'),
    leftPanel: $id('leftPanel'),
    scrim: $id('scrim'),
    viewPresets: $id('viewPresets'),
    layerBar: $id('layerBar'),
    layerRange: $id('layerRange'),
    layerReadout: $id('layerReadout'),
    emptyState: $id('emptyState'),
    loadingState: $id('loadingState'),
    loadingText: $id('loadingText'),
    errorState: $id('errorState'),
    errorText: $id('errorText'),
    btnOpen: $id('btnOpen'),
    btnErrorOpen: $id('btnErrorOpen'),
    lightingPreset: $id('lightingPreset'),
    brightness: $id('brightness'),
    brightnessVal: $id('brightnessVal'),
    bgOptions: $id('bgOptions'),
    moreCard: $id('moreCard'),
    moreToggle: $id('moreToggle'),
    showShadows: $id('showShadows'),
    dropzone: $id('dropzone')
};

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

const state = {
    model: null,          // THREE.Object3D currently in the scene
    modelInfo: null,      // { format, ext, bytes }
    geometryOnly: false,  // model carries no materials of its own
    toolpath: false,      // model is a sliced G-code toolpath, not a surface
    toolpathZ: { min: 0, max: 1 },  // printed height range, drives the layer cut
    layerCut: Infinity,   // fade everything printed above this height
    viewMode: 'solid',
    modelColor: DEFAULT_COLOR,
    navMode: 'rotate',
    lighting: 'studio',
    brightness: 1,
    background: 'light',
    shadows: true,
    radius: 1,            // bounding sphere radius of the current model
    zen: false
};

let renderer, scene, camera, controls, pmrem;
let keyLight, fillLight, rimLight, hemiLight, shadowPlane;
let gizmoScene, gizmoCamera, gizmoLabels = [];
let needsRender = true;

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

function initScene() {
    renderer = new THREE.WebGLRenderer({
        canvas: dom.canvas,
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance'
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearAlpha(0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Neutral keeps the model color close to what the swatch shows; ACES pulls
    // saturated colors noticeably towards white.
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.autoClear = false;

    scene = new THREE.Scene();

    pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    camera = new THREE.PerspectiveCamera(35, 1, 0.05, 5000);
    camera.up.set(0, 0, 1);
    camera.position.set(3, -3, 2);

    controls = new OrbitControls(camera, dom.canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.screenSpacePanning = true;
    controls.addEventListener('change', function () { needsRender = true; });

    hemiLight = new THREE.HemisphereLight(0xffffff, 0x9aa0a6, 0.35);
    scene.add(hemiLight);

    keyLight = new THREE.DirectionalLight(0xffffff, 2.1);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.bias = -0.0012;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);
    scene.add(keyLight.target);

    fillLight = new THREE.DirectionalLight(0xffffff, 0.7);
    scene.add(fillLight);

    rimLight = new THREE.DirectionalLight(0xffffff, 0.5);
    scene.add(rimLight);

    shadowPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.ShadowMaterial({ opacity: 0.22 })
    );
    shadowPlane.receiveShadow = true;
    shadowPlane.visible = false;
    scene.add(shadowPlane);

    initGizmo();

    new ResizeObserver(resize).observe(dom.stage);
    resize();
    renderer.setAnimationLoop(tick);
}

function resize() {
    const w = dom.stage.clientWidth;
    const h = dom.stage.clientHeight;
    if (w === 0 || h === 0) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    needsRender = true;
}

function tick() {
    const moving = controls.update();
    if (moving || needsRender) {
        needsRender = false;
        render();
    }
}

function render() {
    const w = dom.stage.clientWidth;
    const h = dom.stage.clientHeight;
    if (w === 0 || h === 0) return;

    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h);
    renderer.clear();
    renderer.render(scene, camera);

    // axis indicator, drawn into the top-right corner of the same canvas
    if (!state.model) return;
    const size = Math.max(96, Math.min(132, Math.round(Math.min(w, h) * 0.2)));
    const pad = 8;
    gizmoCamera.position.copy(camera.position).sub(controls.target).normalize().multiplyScalar(3.4);
    gizmoCamera.up.copy(camera.up);
    gizmoCamera.lookAt(0, 0, 0);
    for (let i = 0; i < gizmoLabels.length; i++) gizmoLabels[i].quaternion.copy(gizmoCamera.quaternion);

    renderer.clearDepth();
    renderer.setScissorTest(true);
    renderer.setScissor(w - size - pad, h - size - pad, size, size);
    renderer.setViewport(w - size - pad, h - size - pad, size, size);
    renderer.render(gizmoScene, gizmoCamera);
    renderer.setScissorTest(false);
}

/* ------------------------------------------------------------------ */
/* Axis gizmo                                                          */
/* ------------------------------------------------------------------ */

function makeLabelSprite(text, color) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 64, 64);
    ctx.fillStyle = color;
    ctx.font = 'bold 44px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 32, 34);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
    sprite.scale.setScalar(0.6);
    return sprite;
}

function initGizmo() {
    gizmoScene = new THREE.Scene();
    gizmoCamera = new THREE.OrthographicCamera(-1.62, 1.62, 1.62, -1.62, 0.1, 20);

    const axes = [
        { dir: new THREE.Vector3(1, 0, 0), color: 0xd93636, label: 'X' },
        { dir: new THREE.Vector3(0, 1, 0), color: 0x2fa84f, label: 'Y' },
        { dir: new THREE.Vector3(0, 0, 1), color: 0x2f6fd0, label: 'Z' }
    ];

    for (let i = 0; i < axes.length; i++) {
        const axis = axes[i];
        const arrow = new THREE.ArrowHelper(axis.dir, new THREE.Vector3(0, 0, 0), 1.05, axis.color, 0.3, 0.17);
        arrow.line.material.depthTest = false;
        arrow.line.material.linewidth = 2;
        arrow.cone.material.depthTest = false;
        gizmoScene.add(arrow);

        const label = makeLabelSprite(axis.label, '#1b1b1b');
        label.userData.text = axis.label;
        label.position.copy(axis.dir).multiplyScalar(1.48);
        gizmoScene.add(label);
        gizmoLabels.push(label);
    }
}

function refreshGizmoLabels() {
    const color = document.body.classList.contains('dark') ? '#e8e8e8' : '#1b1b1b';
    for (let i = 0; i < gizmoLabels.length; i++) {
        const label = gizmoLabels[i];
        const old = label.material.map;
        const fresh = makeLabelSprite(label.userData.text, color);
        label.material.map = fresh.material.map;
        label.material.needsUpdate = true;
        if (old) old.dispose();
    }
    needsRender = true;
}

/* ------------------------------------------------------------------ */
/* Model handling                                                      */
/* ------------------------------------------------------------------ */

function disposeObject(object) {
    object.traverse(function (child) {
        if (child.geometry) child.geometry.dispose();
        const material = child.material;
        if (!material) return;
        const list = Array.isArray(material) ? material : [material];
        for (let i = 0; i < list.length; i++) {
            for (const key in list[i]) {
                const value = list[i][key];
                if (value && value.isTexture) value.dispose();
            }
            list[i].dispose();
        }
    });
}

function clearModel() {
    if (!state.model) return;
    scene.remove(state.model);
    disposeObject(state.model);
    state.model = null;
    shadowPlane.visible = false;
    needsRender = true;
}

/*
    Place a freshly parsed object into the Z-up world: convert its up axis,
    drop its origin onto the world origin and remember its real world size.
*/
/*
    Give a sliced toolpath some form.

    G-code is unlit line geometry, so a dense print renders as one flat
    silhouette with no way to tell a face from an edge. There is nothing to cast
    a real shadow with - a line has no surface - so the shading is baked into a
    vertex color attribute instead, which LineBasicMaterial multiplies against
    the model color at no extra draw cost. Two cues are combined:

      facet shading   an extrusion runs along the surface it is printing, so the
                      wall it belongs to faces perpendicular to the path.
                      cross(tangent, up) recovers that facing, and lighting it
                      from a fixed direction makes the two walls that meet at a
                      corner land at clearly different brightness.
      height gradient a gentle top-brighter ramp, the "lit from above" cue that
                      separates the top of the print from its base.

    The light is fixed in model space rather than following the camera, so the
    print keeps a consistent solid appearance while it is orbited.
*/
function bakeToolpathShading(root) {
    const targets = [];
    let minZ = Infinity;
    let maxZ = -Infinity;

    root.traverse(function (child) {
        if (!child.isLineSegments || !child.material || child.material.name !== 'extruded') return;
        const position = child.geometry.getAttribute('position');
        if (!position) return;
        targets.push(child);
        for (let i = 0; i < position.count; i++) {
            const z = position.getZ(i);
            if (z < minZ) minZ = z;
            if (z > maxZ) maxZ = z;
        }
    });
    if (targets.length === 0) return;

    //the layer cut slider spans the same range as the printed material
    state.toolpathZ = { min: minZ, max: maxZ };

    const span = Math.max(maxZ - minZ, 1e-6);
    const tangent = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const up = new THREE.Vector3(0, 0, 1);

    for (let t = 0; t < targets.length; t++) {
        const geometry = targets[t].geometry;
        const position = geometry.getAttribute('position');
        const shade = new Float32Array(position.count * 3);

        for (let i = 0; i + 1 < position.count; i += 2) {
            tangent.set(
                position.getX(i + 1) - position.getX(i),
                position.getY(i + 1) - position.getY(i),
                position.getZ(i + 1) - position.getZ(i)
            );

            normal.crossVectors(tangent, up);
            if (normal.lengthSq() < 1e-10) {
                //a purely vertical move has no wall to face; treat it as facing
                //up so seams and z hops stay bright instead of flickering black
                normal.copy(up);
            } else {
                normal.normalize();
            }

            //two sided: a wall should read the same whichever way the head ran
            const facet = Math.abs(normal.dot(TOOLPATH_LIGHT));
            const height = ((position.getZ(i) + position.getZ(i + 1)) * 0.5 - minZ) / span;
            const value = Math.min(
                (TOOLPATH_AMBIENT + (1 - TOOLPATH_AMBIENT) * facet) * (0.8 + 0.3 * height),
                1
            );

            shade[i * 3] = shade[i * 3 + 1] = shade[i * 3 + 2] = value;
            shade[i * 3 + 3] = shade[i * 3 + 4] = shade[i * 3 + 5] = value;
        }

        geometry.setAttribute('color', new THREE.BufferAttribute(shade, 3));
        targets[t].material.vertexColors = true;
        targets[t].material.needsUpdate = true;
    }
}

/*
    Layer height cut.

    Everything at or below the cut height draws normally; everything above it
    draws as a translucent ghost, so the inside of a print can be inspected
    without losing the context of what sits on top of it.

    This needs two passes rather than one blended material: a single pass would
    have to write depth for the faded layers as well, and those are the layers
    nearest the camera when looking down into a print - they would hide exactly
    the interior the cut is meant to reveal. So the geometry is drawn twice,
    sharing one buffer, with each pass discarding the half it does not own. The
    solid pass keeps normal depth behaviour, and the ghost pass blends without
    writing depth.
*/
function installToolpathCutoff(material, isGhost) {
    material.userData.cutoff = { value: Infinity };
    material.onBeforeCompile = function (shader) {
        shader.uniforms.uCutoff = material.userData.cutoff;
        shader.vertexShader = 'varying float vLayerZ;\n' + shader.vertexShader.replace(
            '#include <begin_vertex>',
            '#include <begin_vertex>\n\tvLayerZ = position.z;'
        );
        shader.fragmentShader = 'uniform float uCutoff;\nvarying float vLayerZ;\n' + shader.fragmentShader.replace(
            '#include <color_fragment>',
            '#include <color_fragment>\n\tif (' + (isGhost ? 'vLayerZ <= uCutoff' : 'vLayerZ > uCutoff') + ') discard;'
        );
    };
    // the two variants compile to different programs from otherwise identical
    // material settings, so they need distinct cache keys
    material.customProgramCacheKey = function () {
        return isGhost ? 'toolpath-ghost' : 'toolpath-solid';
    };
    material.needsUpdate = true;
}

function buildToolpathCutPasses(root) {
    const ghosts = [];

    root.traverse(function (child) {
        if (!child.isLineSegments || !child.material || child.userData.toolpathGhost) return;

        installToolpathCutoff(child.material, false);

        const ghostMaterial = child.material.clone();
        ghostMaterial.name = child.material.name;
        ghostMaterial.transparent = true;
        ghostMaterial.depthWrite = false;
        installToolpathCutoff(ghostMaterial, true);

        const ghost = new THREE.LineSegments(child.geometry, ghostMaterial);
        ghost.userData.toolpathGhost = true;
        ghost.renderOrder = 1;
        ghost.visible = false;
        ghosts.push({ parent: child.parent, ghost: ghost });
    });

    for (let i = 0; i < ghosts.length; i++) ghosts[i].parent.add(ghosts[i].ghost);
}

function setLayerCut(height) {
    if (!state.model) return;
    state.layerCut = height;
    const cutting = height < state.toolpathZ.max;

    state.model.traverse(function (child) {
        if (!child.isLineSegments || !child.material) return;
        if (child.material.userData.cutoff) child.material.userData.cutoff.value = height;
        if (child.userData.toolpathGhost) {
            //nothing to ghost while the cut sits at the top of the print
            child.visible = cutting && child.material.name !== 'path';
        }
    });

    dom.layerReadout.textContent = height.toFixed(1) + ' mm';
    needsRender = true;
}

function setupLayerBar() {
    if (!state.toolpath) {
        dom.layerBar.hidden = true;
        return;
    }
    const min = state.toolpathZ.min;
    const max = state.toolpathZ.max;
    dom.layerRange.min = min;
    dom.layerRange.max = max;
    dom.layerRange.step = Math.max((max - min) / 500, 0.001);
    dom.layerRange.value = max;
    dom.layerBar.hidden = false;
    setLayerCut(max);
}

/*
    Bounding box of what the model actually is. For a sliced toolpath the
    travel moves sweep the whole bed, so measuring and framing against them
    would report the printer's bed size instead of the part and leave the print
    tiny on screen; only the extruded material counts.
*/
function modelBounds(root) {
    if (!state.toolpath) return new THREE.Box3().setFromObject(root);

    const box = new THREE.Box3();
    root.traverse(function (child) {
        if (!child.isLineSegments || !child.material || child.material.name !== 'extruded') return;
        const position = child.geometry.getAttribute('position');
        if (!position) return;
        child.updateWorldMatrix(true, false);
        const segment = new THREE.Box3().setFromBufferAttribute(position);
        segment.applyMatrix4(child.matrixWorld);
        box.union(segment);
    });

    return box.isEmpty() ? new THREE.Box3().setFromObject(root) : box;
}

function placeModel(object, format) {
    clearModel();

    // The loaded object keeps whatever transform its loader gave it (Collada
    // and FBX rotate their own root when the file is Z-up), so the up-axis
    // conversion and the centring each get their own wrapper rather than
    // touching the object's transform.
    const pivot = new THREE.Group();
    if (format.up === 'Y') pivot.rotation.x = Math.PI / 2;
    pivot.add(object);

    const root = new THREE.Group();
    root.add(pivot);
    root.updateMatrixWorld(true);

    const box = modelBounds(root);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    // centre horizontally, sit the model on z = 0 so shadows read correctly
    pivot.position.sub(new THREE.Vector3(center.x, center.y, box.min.z));
    root.updateMatrixWorld(true);

    root.traverse(function (child) {
        if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
        }
        // Tone down the loader's stock bright red travel moves; they are
        // context, not the print itself.
        if (state.toolpath && child.material && child.material.name === 'path') {
            child.material.color.setHex(TRAVEL_MOVE_COLOR);
        }
    });

    if (state.toolpath) {
        bakeToolpathShading(root);
        buildToolpathCutPasses(root);
    }

    scene.add(root);
    state.model = root;
    state.radius = Math.max(modelBounds(root).getBoundingSphere(new THREE.Sphere()).radius, 0.0001);

    // clip planes and control limits scale with the model
    camera.near = state.radius / 400;
    camera.far = state.radius * 200;
    camera.updateProjectionMatrix();
    controls.minDistance = state.radius * 0.15;
    controls.maxDistance = state.radius * 60;

    layoutLights();
    applyViewMode();
    applyModelColor(false);
    setView('iso');

    return size;
}

/*
    The ground shadow only makes sense under an opaque surface model: a
    wireframe or see-through body casting a solid shadow reads as a bug, and a
    G-code toolpath has no surfaces to cast one at all.
*/
function shadowPlaneShouldShow() {
    return state.shadows && state.model !== null && state.viewMode === 'solid' && !state.toolpath;
}

function layoutLights() {
    const r = Math.max(state.radius, 0.0001);
    const height = r * 0.9;

    keyLight.position.set(-r * 1.6, -r * 2.0, r * 2.6);
    keyLight.target.position.set(0, 0, height * 0.4);
    keyLight.target.updateMatrixWorld();

    fillLight.position.set(r * 2.4, r * 1.4, r * 0.9);
    rimLight.position.set(0, r * 2.8, -r * 1.4);

    const extent = r * 2.2;
    const cam = keyLight.shadow.camera;
    cam.left = -extent;
    cam.right = extent;
    cam.top = extent;
    cam.bottom = -extent;
    cam.near = r * 0.05;
    cam.far = r * 12;
    cam.updateProjectionMatrix();

    shadowPlane.scale.set(r * 14, r * 14, 1);
    shadowPlane.position.set(0, 0, -r * 0.002);
    shadowPlane.visible = shadowPlaneShouldShow();

    applyLighting();
}

/* ---- materials ---- */

/*
    Walk every material the loaded model owns. Line geometry counts too - a
    G-code toolpath is nothing but lines - while the viewer's own x-ray edge
    overlay is skipped so it keeps its highlight color.
*/
function eachMaterial(callback) {
    if (!state.model) return;
    state.model.traverse(function (child) {
        if (!child.material || child.userData.xrayEdges) return;
        const list = Array.isArray(child.material) ? child.material : [child.material];
        for (let i = 0; i < list.length; i++) callback(list[i], child);
    });
}

/*
    A sliced toolpath is line geometry, so the three view modes are mapped onto
    what is meaningful for it rather than onto surface shading:

        Solid     - printed material only, which is what the part will look like
        Wireframe - also draws the travel moves the head makes between them
        X-Ray     - the same, drawn translucent so inner perimeters show through
*/
/*
    A sliced toolpath is line geometry, so the three view modes are mapped onto
    what is meaningful for it rather than onto surface shading:

        Solid     - printed material only, which is what the part will look like
        Wireframe - also draws the travel moves the head makes between them
        X-Ray     - the same, drawn translucent so inner perimeters show through
*/
function applyToolpathViewMode(mode) {
    state.model.traverse(function (child) {
        if (!child.isLineSegments || !child.material) return;
        const isTravel = (child.material.name === 'path');
        child.visible = isTravel ? (mode !== 'solid') : true;

        if (child.userData.toolpathGhost) {
            //the ghost pass owns its own blending; only its strength follows
            //the view mode, and setLayerCut decides whether it draws at all
            child.material.opacity = (mode === 'xray') ? 0.05 : 0.13;
            child.material.needsUpdate = true;
            return;
        }
        child.material.transparent = (mode === 'xray');
        //thousands of overlapping extrusions accumulate back to opaque, so the
        //x-ray opacity has to go a lot lower here than it does for a surface
        child.material.opacity = (mode === 'xray') ? (isTravel ? 0.12 : 0.1) : 1;
        child.material.depthWrite = (mode !== 'xray');
        child.material.needsUpdate = true;
    });
    shadowPlane.visible = false;
    needsRender = true;
}

function applyViewMode() {
    if (!state.model) return;

    if (state.toolpath) {
        applyToolpathViewMode(state.viewMode);
        return;
    }

    // remove any x-ray edge overlay from a previous mode
    const stale = [];
    state.model.traverse(function (child) { if (child.userData.xrayEdges) stale.push(child); });
    for (let i = 0; i < stale.length; i++) {
        stale[i].parent.remove(stale[i]);
        stale[i].geometry.dispose();
        stale[i].material.dispose();
    }

    const mode = state.viewMode;

    // A ground shadow cast by a see-through or wireframe body reads as a bug,
    // so only the solid mode casts one.
    state.model.traverse(function (child) {
        if (child.isMesh) child.castShadow = (mode === 'solid');
    });
    shadowPlane.visible = shadowPlaneShouldShow();

    eachMaterial(function (material) {
        material.wireframe = (mode === 'wireframe');
        material.transparent = (mode === 'xray');
        material.opacity = (mode === 'xray') ? 0.28 : 1;
        material.depthWrite = (mode !== 'xray');
        material.side = (mode === 'xray') ? THREE.DoubleSide : THREE.FrontSide;
        material.needsUpdate = true;
    });

    if (mode === 'xray') {
        const meshes = [];
        state.model.traverse(function (child) { if (child.isMesh && !child.userData.xrayEdges) meshes.push(child); });
        for (let i = 0; i < meshes.length; i++) {
            const edges = new THREE.LineSegments(
                new THREE.EdgesGeometry(meshes[i].geometry, 28),
                new THREE.LineBasicMaterial({ color: 0x2f6fd0, transparent: true, opacity: 0.55, depthTest: false })
            );
            edges.userData.xrayEdges = true;
            edges.renderOrder = 2;
            meshes[i].add(edges);
        }
    }

    needsRender = true;
}

/*
    Apply the model color. Geometry-only formats (STL, PLY, G-code) always take
    it; formats that ship their own materials only take it once the user has
    picked a color explicitly, so a textured GLB opens looking the way it was
    authored.
*/
function applyModelColor(userPicked) {
    if (!state.model) return;
    if (!state.geometryOnly && !userPicked) return;

    eachMaterial(function (material) {
        // travel moves are not printed material, so they keep their own color
        if (state.toolpath && material.name === 'path') return;
        if (material.color) material.color.setHex(state.modelColor);
        if (state.geometryOnly && material.roughness !== undefined) {
            material.roughness = 0.42;
            material.metalness = 0.05;
        }
        material.needsUpdate = true;
    });
    needsRender = true;
}

/* ---- lighting / background ---- */

function applyLighting() {
    const preset = LIGHTING[state.lighting] || LIGHTING.studio;
    const b = state.brightness;
    scene.environmentIntensity = preset.env * b;
    keyLight.intensity = preset.key * b;
    fillLight.intensity = preset.fill * b;
    rimLight.intensity = preset.rim * b;
    hemiLight.intensity = preset.hemi * b;
    needsRender = true;
}

function applyBackground() {
    dom.stage.classList.remove('bg-light', 'bg-dark', 'bg-gradient');
    dom.stage.classList.add('bg-' + state.background);
    shadowPlane.material.opacity = (state.background === 'dark') ? 0.36 : 0.22;
    needsRender = true;
}

function applyShadows() {
    renderer.shadowMap.enabled = state.shadows;
    keyLight.castShadow = state.shadows;
    shadowPlane.visible = shadowPlaneShouldShow();
    eachMaterial(function (material) { material.needsUpdate = true; });
    needsRender = true;
}

/* ------------------------------------------------------------------ */
/* Camera                                                              */
/* ------------------------------------------------------------------ */

function frameModel(direction) {
    if (!state.model) return;
    const box = modelBounds(state.model);
    const sphere = box.getBoundingSphere(new THREE.Sphere());

    // Fit against whichever field of view is tighter, so a wide model still
    // fits inside a tall phone-shaped viewport.
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    const distance = Math.max(
        sphere.radius / Math.sin(vFov / 2),
        sphere.radius / Math.sin(hFov / 2)
    ) * 1.15;

    const dir = direction
        ? direction.clone().normalize()
        : camera.position.clone().sub(controls.target).normalize();

    controls.target.copy(sphere.center);
    camera.position.copy(sphere.center).addScaledVector(dir, distance);
    camera.lookAt(sphere.center);
    controls.update();
    needsRender = true;
}

function centerModel() {
    if (!state.model) return;
    const box = modelBounds(state.model);
    const center = box.getCenter(new THREE.Vector3());
    const offset = camera.position.clone().sub(controls.target);
    controls.target.copy(center);
    camera.position.copy(center).add(offset);
    controls.update();
    needsRender = true;
}

function setView(name) {
    frameModel(VIEW_DIRS[name] || VIEW_DIRS.iso);
    const buttons = dom.viewPresets.querySelectorAll('.tool');
    for (let i = 0; i < buttons.length; i++) {
        buttons[i].classList.toggle('active', buttons[i].dataset.view === name);
    }
}

/*
    Navigation modes. Rotate and pan map straight onto OrbitControls; a
    single-pointer zoom drag is not something OrbitControls offers, so it is
    driven by hand against the same camera/target pair.
*/
function setNavMode(mode) {
    state.navMode = mode;
    controls.enableRotate = (mode === 'rotate');
    controls.enablePan = (mode === 'pan');
    controls.mouseButtons = {
        LEFT: mode === 'pan' ? THREE.MOUSE.PAN : (mode === 'rotate' ? THREE.MOUSE.ROTATE : null),
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN
    };
    controls.touches = {
        ONE: mode === 'pan' ? THREE.TOUCH.PAN : (mode === 'rotate' ? THREE.TOUCH.ROTATE : null),
        TWO: THREE.TOUCH.DOLLY_PAN
    };

    const buttons = document.querySelectorAll('.tool.mode');
    for (let i = 0; i < buttons.length; i++) {
        buttons[i].classList.toggle('active', buttons[i].dataset.nav === mode);
    }
    dom.canvas.style.cursor = mode === 'pan' ? 'grab' : (mode === 'zoom' ? 'ns-resize' : 'default');
}

function initZoomDrag() {
    let dragging = false;
    let lastY = 0;
    let pointerId = null;

    dom.canvas.addEventListener('pointerdown', function (e) {
        if (state.navMode !== 'zoom' || !state.model || e.button !== 0) return;
        dragging = true;
        lastY = e.clientY;
        pointerId = e.pointerId;
        dom.canvas.setPointerCapture(pointerId);
    });

    dom.canvas.addEventListener('pointermove', function (e) {
        if (!dragging || e.pointerId !== pointerId) return;
        const delta = e.clientY - lastY;
        lastY = e.clientY;
        const offset = camera.position.clone().sub(controls.target);
        const scale = Math.exp(delta * 0.006);
        const distance = THREE.MathUtils.clamp(offset.length() * scale, controls.minDistance, controls.maxDistance);
        camera.position.copy(controls.target).addScaledVector(offset.normalize(), distance);
        controls.update();
        needsRender = true;
    });

    function end(e) {
        if (!dragging || (e && e.pointerId !== pointerId)) return;
        dragging = false;
        if (pointerId !== null && dom.canvas.hasPointerCapture(pointerId)) {
            dom.canvas.releasePointerCapture(pointerId);
        }
        pointerId = null;
    }
    dom.canvas.addEventListener('pointerup', end);
    dom.canvas.addEventListener('pointercancel', end);
}

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */

function showOverlay(which, message) {
    dom.emptyState.hidden = (which !== 'empty');
    dom.loadingState.hidden = (which !== 'loading');
    dom.errorState.hidden = (which !== 'error');
    if (which === 'loading' && message) dom.loadingText.textContent = message;
    if (which === 'error' && message) dom.errorText.textContent = message;
}

function formatBytes(bytes) {
    if (typeof bytes !== 'number' || bytes < 0) return '—';
    if (bytes < 1024) return bytes + ' B';
    const units = ['KB', 'MB', 'GB', 'TB'];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
    return (value >= 100 ? Math.round(value) : value.toFixed(value >= 10 ? 1 : 2)) + ' ' + units[unit];
}

function round2(value) {
    return Math.round(value * 100) / 100;
}

/*
    Report the bounding box in whichever unit keeps the numbers readable.
    Sizes arrive in millimetres; anything a metre or larger reads better in
    metres, which is also the natural unit for scene-scale glTF content.
*/
function formatDimension(size) {
    const largest = Math.max(size.x, size.y, size.z);
    const scale = largest >= 1000 ? 0.001 : 1;
    const unit = largest >= 1000 ? 'm' : 'mm';
    return round2(size.x * scale) + ' × ' + round2(size.y * scale) + ' × ' + round2(size.z * scale) + ' ' + unit;
}

async function openSource(source) {
    showOverlay('loading', 'Loading model...');
    dom.fileName.textContent = source.filename;
    dom.fileType.textContent = (FORMATS[extOf(source.filename)] || { label: 'Model' }).label + ' File';
    dom.fileDim.textContent = '—';
    dom.fileSize.textContent = '—';
    ao_module_setWindowTitle('3D Viewer - ' + source.filename);

    try {
        const result = await loadModel(source, {
            filename: source.filename,
            onProgress: function (fraction, label) {
                const percent = (fraction >= 0 && fraction < 1) ? ' ' + Math.round(fraction * 100) + '%' : '';
                showOverlay('loading', label + percent);
            }
        });

        state.geometryOnly = !result.ownMaterials;
        state.toolpath = result.format.toolpath === true;
        state.modelInfo = result;

        const size = placeModel(result.object, result.format).multiplyScalar(result.format.unitToMM || 1);
        setupLayerBar();
        dom.fileDim.textContent = formatDimension(size);
        dom.fileSize.textContent = formatBytes(result.bytes);
        if (source.filepath) fetchStoredFileSize(source.filepath);

        showOverlay('none');
    } catch (err) {
        console.error('[3D Viewer] load failed', err);
        clearModel();
        dom.layerBar.hidden = true;
        showOverlay('error', (err && err.message) || 'Could not load this model.');
    }
}

// The transferred byte count already gives an accurate size, but the storage
// backend is authoritative for what the user sees in the File Manager.
function fetchStoredFileSize(filepath) {
    $.ajax({
        url: ao_root + 'system/file_system/getProperties',
        data: { path: filepath },
        success: function (data) {
            if (data && typeof data.Filesize === 'number') {
                dom.fileSize.textContent = formatBytes(data.Filesize);
            }
        }
    });
}

function mediaURL(filepath) {
    return ao_root + 'media?file=' + encodeURIComponent(filepath);
}

function openStoredFile(filepath, filename) {
    const dir = filepath.substring(0, filepath.lastIndexOf('/') + 1);
    dom.fileCard.dataset.filepath = filepath;
    openSource({
        url: mediaURL(filepath),
        filepath: filepath,
        filename: filename || filepath.split('/').pop(),
        resolveSibling: function (name) { return mediaURL(dir + name); }
    });
}

function openLocalFile(file) {
    openSource({ file: file, filename: file.name });
}

/* ------------------------------------------------------------------ */
/* UI wiring                                                           */
/* ------------------------------------------------------------------ */

function buildPalette() {
    for (let i = 0; i < PALETTE.length; i++) {
        const hex = PALETTE[i];
        const button = document.createElement('button');
        button.style.background = '#' + hex.toString(16).padStart(6, '0');
        button.dataset.hex = String(hex);
        button.title = '#' + hex.toString(16).padStart(6, '0').toUpperCase();
        if (hex === state.modelColor) button.classList.add('sel');
        button.addEventListener('click', function () {
            state.modelColor = hex;
            dom.colorSwatch.style.background = button.style.background;
            const all = dom.palette.querySelectorAll('button');
            for (let j = 0; j < all.length; j++) all[j].classList.toggle('sel', all[j] === button);
            applyModelColor(true);
            dom.palette.hidden = true;
        });
        dom.palette.appendChild(button);
    }
    dom.colorSwatch.style.background = '#' + state.modelColor.toString(16).padStart(6, '0');
}

function setDrawer(open) {
    dom.leftPanel.classList.toggle('open', open);
    dom.scrim.classList.toggle('on', open);
}

function closeDrawers() {
    setDrawer(false);
}

function toggleFullscreen() {
    const target = document.documentElement;
    if (document.fullscreenElement) {
        document.exitFullscreen();
        return;
    }
    // Inside the desktop the app runs in an iframe that may not be allowed to
    // go fullscreen; fall back to hiding the side panels instead.
    const request = target.requestFullscreen && target.requestFullscreen();
    if (request && request.catch) {
        request.catch(function () { setZen(!state.zen); });
    } else if (!request) {
        setZen(!state.zen);
    }
}

function setZen(on) {
    state.zen = on;
    document.body.classList.toggle('zen', on);
    dom.btnFullscreen.classList.toggle('active', on);
    setTimeout(resize, 60);
}

function pickFile() {
    ao_module_openFileSelector(function (files) {
        if (!files || files.length === 0) return;
        const file = files[0];
        if (!isSupported(file.filename)) {
            showOverlay('error', '"' + file.filename + '" is not a supported 3D model format.');
            return;
        }
        openStoredFile(file.filepath, file.filename);
    }, 'user:/', 'file', false);
}

function initUI() {
    buildPalette();

    dom.viewModes.addEventListener('click', function (e) {
        const button = e.target.closest('.seg');
        if (!button) return;
        state.viewMode = button.dataset.mode;
        const all = dom.viewModes.querySelectorAll('.seg');
        for (let i = 0; i < all.length; i++) all[i].classList.toggle('active', all[i] === button);
        applyViewMode();
    });

    dom.colorBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        dom.palette.hidden = !dom.palette.hidden;
    });
    document.addEventListener('click', function (e) {
        if (!dom.palette.hidden && !dom.palette.contains(e.target)) dom.palette.hidden = true;
    });

    dom.btnFit.addEventListener('click', function () { frameModel(null); });
    dom.btnCenter.addEventListener('click', centerModel);
    dom.btnFullscreen.addEventListener('click', toggleFullscreen);
    document.addEventListener('fullscreenchange', function () {
        dom.btnFullscreen.classList.toggle('active', !!document.fullscreenElement);
        setTimeout(resize, 60);
    });

    const modeButtons = document.querySelectorAll('.tool.mode');
    for (let i = 0; i < modeButtons.length; i++) {
        modeButtons[i].addEventListener('click', function () { setNavMode(this.dataset.nav); });
    }

    dom.layerRange.addEventListener('input', function () {
        setLayerCut(Number(this.value));
    });

    dom.viewPresets.addEventListener('click', function (e) {
        const button = e.target.closest('.tool');
        if (!button) return;
        setView(button.dataset.view);
    });

    dom.btnReset.addEventListener('click', function () {
        if (state.toolpath) {
            dom.layerRange.value = state.toolpathZ.max;
            setLayerCut(state.toolpathZ.max);
        }
        setNavMode('rotate');
        setView('iso');
        closeDrawers();
    });

    dom.fileCard.addEventListener('click', function () {
        const filepath = dom.fileCard.dataset.filepath;
        if (!filepath) { pickFile(); return; }
        const parts = filepath.split('/');
        const name = parts.pop();
        ao_module_openPath(parts.join('/'), name);
    });

    dom.btnOpen.addEventListener('click', pickFile);
    dom.btnErrorOpen.addEventListener('click', pickFile);

    dom.lightingPreset.addEventListener('change', function () {
        state.lighting = this.value;
        applyLighting();
    });

    function syncSliderFill() {
        const input = dom.brightness;
        const pct = ((input.value - input.min) / (input.max - input.min)) * 100;
        input.style.setProperty('--fill', pct + '%');
    }
    dom.brightness.addEventListener('input', function () {
        state.brightness = Number(this.value) / 100;
        dom.brightnessVal.textContent = this.value + '%';
        syncSliderFill();
        applyLighting();
    });
    syncSliderFill();

    dom.bgOptions.addEventListener('change', function (e) {
        state.background = e.target.value;
        const labels = dom.bgOptions.querySelectorAll('.radio');
        for (let i = 0; i < labels.length; i++) {
            labels[i].classList.toggle('checked', labels[i].contains(e.target));
        }
        applyBackground();
    });

    dom.moreToggle.addEventListener('click', function () {
        dom.moreCard.classList.toggle('collapsed');
    });

    dom.showShadows.addEventListener('change', function () {
        state.shadows = this.checked;
        applyShadows();
    });

    dom.btnLeftDrawer.addEventListener('click', function () {
        setDrawer(!dom.leftPanel.classList.contains('open'));
    });
    dom.scrim.addEventListener('click', closeDrawers);

    initDropTarget();
    initKeyboard();
    setNavMode('rotate');
    applyBackground();
}

function initDropTarget() {
    let depth = 0;
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('dragenter', function (e) {
        e.preventDefault();
        depth++;
        dom.dropzone.classList.add('on');
    });
    window.addEventListener('dragleave', function () {
        depth = Math.max(0, depth - 1);
        if (depth === 0) dom.dropzone.classList.remove('on');
    });
    window.addEventListener('drop', function (e) {
        e.preventDefault();
        depth = 0;
        dom.dropzone.classList.remove('on');

        //A drop from the OS carries real files
        const local = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (local) {
            if (!isSupported(local.name)) {
                showOverlay('error', '"' + local.name + '" is not a supported 3D model format.');
                return;
            }
            dom.fileCard.dataset.filepath = '';
            openLocalFile(local);
            return;
        }

        //A drop from the ArozOS File Manager carries no file at all, just a
        //record of where the file lives in the user's storage
        const dropped = readDroppedStorageFiles(e);
        if (dropped.length === 0) return;

        let target = null;
        for (let i = 0; i < dropped.length; i++) {
            if (isSupported(dropped[i].filename)) { target = dropped[i]; break; }
        }
        if (!target) {
            showOverlay('error', '"' + dropped[0].filename + '" is not a supported 3D model format.');
            return;
        }
        openStoredFile(target.filepath, target.filename);
    });
}

/*
    Pull the file records out of a File Manager drag. ao_module_utils does the
    reading, but it assumes a well formed payload, so anything unparsable is
    treated as "nothing was dropped" rather than being allowed to throw out of
    the event handler.
*/
function readDroppedStorageFiles(dropEvent) {
    try {
        const filelist = ao_module_utils.getDropFileInfo(dropEvent);
        if (!Array.isArray(filelist)) return [];
        return filelist.filter(function (file) {
            return file && file.filepath && file.filename;
        });
    } catch (err) {
        console.log('[3D Viewer] could not read the dropped file list', err);
        return [];
    }
}

function initKeyboard() {
    window.addEventListener('keydown', function (e) {
        if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
        switch (e.key.toLowerCase()) {
            case 'f': frameModel(null); break;
            case 'c': centerModel(); break;
            case 'r': setNavMode('rotate'); break;
            case 'p': setNavMode('pan'); break;
            case 'z': setNavMode('zoom'); break;
            case '1': setView('front'); break;
            case '2': setView('right'); break;
            case '3': setView('top'); break;
            case '4': setView('iso'); break;
            case 'escape': if (state.zen) setZen(false); else closeDrawers(); break;
            default: return;
        }
        e.preventDefault();
    });
}

/* ------------------------------------------------------------------ */
/* ArozOS integration                                                  */
/* ------------------------------------------------------------------ */

function applyTheme(theme) {
    document.body.classList.toggle('dark', theme === 'dark');
    document.querySelector('meta[name=theme-color]').setAttribute('content', theme === 'dark' ? '#1f1f1f' : '#f3f3f3');
    refreshGizmoLabels();
}

function initTheme() {
    ao_module_setWindowTheme('white');
    ao_module_getSystemThemeColor(function (theme) {
        applyTheme(theme);
        ao_module_setWindowTheme(theme === 'dark' ? 'dark' : 'white');
    });
    ao_module_onThemeChanged(function (theme) {
        applyTheme(theme);
        ao_module_setWindowTheme(theme === 'dark' ? 'dark' : 'white');
    });
}

function boot() {
    initScene();
    initUI();
    initZoomDrag();
    initTheme();

    const files = ao_module_loadInputFiles();
    if (files && files.length > 0) {
        dom.fileCard.dataset.filepath = files[0].filepath;
        openStoredFile(files[0].filepath, files[0].filename);
    } else {
        ao_module_setWindowTitle('3D Viewer');
        showOverlay('empty');
    }
}

boot();
