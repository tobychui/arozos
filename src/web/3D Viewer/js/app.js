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

    const box = new THREE.Box3().setFromObject(root);
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
    });

    scene.add(root);
    state.model = root;
    state.radius = Math.max(new THREE.Box3().setFromObject(root).getBoundingSphere(new THREE.Sphere()).radius, 0.0001);

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
    shadowPlane.visible = state.shadows && state.model !== null && state.viewMode === 'solid';

    applyLighting();
}

/* ---- materials ---- */

function eachMaterial(callback) {
    if (!state.model) return;
    state.model.traverse(function (child) {
        if (!child.isMesh || !child.material) return;
        const list = Array.isArray(child.material) ? child.material : [child.material];
        for (let i = 0; i < list.length; i++) callback(list[i], child);
    });
}

function applyViewMode() {
    if (!state.model) return;

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
    shadowPlane.visible = state.shadows && mode === 'solid';

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
    Apply the model color. Geometry-only formats (STL, PLY) always take it;
    formats that ship their own materials only take it once the user has picked
    a color explicitly, so a textured GLB opens looking the way it was authored.
*/
function applyModelColor(userPicked) {
    if (!state.model) return;
    if (!state.geometryOnly && !userPicked) return;

    eachMaterial(function (material) {
        if (material.color) material.color.setHex(state.modelColor);
        if (state.geometryOnly) {
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
    shadowPlane.visible = state.shadows && state.model !== null && state.viewMode === 'solid';
    eachMaterial(function (material) { material.needsUpdate = true; });
    needsRender = true;
}

/* ------------------------------------------------------------------ */
/* Camera                                                              */
/* ------------------------------------------------------------------ */

function frameModel(direction) {
    if (!state.model) return;
    const box = new THREE.Box3().setFromObject(state.model);
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
    const box = new THREE.Box3().setFromObject(state.model);
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
        state.modelInfo = result;

        const size = placeModel(result.object, result.format).multiplyScalar(result.format.unitToMM || 1);
        dom.fileDim.textContent = formatDimension(size);
        dom.fileSize.textContent = formatBytes(result.bytes);
        if (source.filepath) fetchStoredFileSize(source.filepath);

        showOverlay('none');
    } catch (err) {
        console.error('[3D Viewer] load failed', err);
        clearModel();
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

    dom.viewPresets.addEventListener('click', function (e) {
        const button = e.target.closest('.tool');
        if (!button) return;
        setView(button.dataset.view);
    });

    dom.btnReset.addEventListener('click', function () {
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
        const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (!file) return;
        if (!isSupported(file.name)) {
            showOverlay('error', '"' + file.name + '" is not a supported 3D model format.');
            return;
        }
        dom.fileCard.dataset.filepath = '';
        openLocalFile(file);
    });
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
