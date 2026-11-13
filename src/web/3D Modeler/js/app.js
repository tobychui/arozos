/*
    3D Modeler - application shell

    Wires the document, the kernel worker, the viewport, the model browser and
    the ribbon together (PROPOSAL.md milestone M1). The document is the single
    source of truth: every change to it triggers a rebuild in the worker, and
    the viewport and the browser are redrawn from the result.

    Three kinds of document share the window (state.env): a part, handled
    here, an assembly, handled by js/assembly/assembly.js, and a drawing
    (2D views on a sheet), handled by js/drawing/drawing.js. File > New
    asks which; opening a file picks by its format. Several documents can
    be open, one tab each under the view (see "document tabs" below). The ribbon shows the
    tabs of the open kind (ribbon.setMode), and the shared commands (files,
    view, Measure, Section View) ask activeDoc() which document they act on.

    jQuery and ao_module.js are classic scripts loaded by index.html; they are
    reached through window so this module also runs outside the ArozOS desktop.
*/

import { createRibbon } from './ribbon.js';
import { createViewport, ORIGIN_PLANES } from './viewport.js';
import { createBrowser } from './browser.js';
import { createKernel } from './kernel/client.js';
import { createDocument } from './document/document.js';
import { sampleDocument } from './document/sample.js';
import { sampleAssembly } from './document/sampleasm.js';
import { sampleDrawing } from './document/sampledrw.js';
import { createAssembly } from './assembly/assembly.js';
import { createDrawing } from './drawing/drawing.js';
import { createMeasure } from './inspect/measure.js';
import { createSectionPanel } from './inspect/section.js';
import { createAppearancePanel } from './features/appearance.js';
import * as files from './io/files.js';
import { toSTL, toOBJ, to3MF } from './io/exchange.js';
import * as solver from './sketch/solver.js';
import { createSketcher } from './sketch/sketcher.js';
import { addProjected } from './sketch/project.js';
import { createExtrude } from './features/extrude.js';
import { createRevolve } from './features/revolve.js';
import { createShell } from './features/shell.js';
import { createPattern } from './features/pattern.js';
import { createEdgeFeature } from './features/edges.js';
import { createHole } from './features/hole.js';
import { createWorkPlane } from './features/plane.js';
import * as sketchModel from './sketch/model.js';
import { sample } from './sketch/geom.js';
import { planeFrame, toWorld, workPlaneFrame, resolveFace } from './kernel/profile.js';
import { icon, openMenu, closeMenu, ask, tell, chooseNew } from './ui.js';
import { createTabBar, freeName } from './tabs.js';
import { validate as validatePart } from './document/document.js';
import { validateAssembly } from './assembly/document.js';
import { validateDrawing } from './drawing/document.js';

const $ = function (id) {
    return document.getElementById(id);
};

const state = {
    env: 'part',            // the kind of document open: 'part' | 'assembly' | 'drawing'
    mode: 'model',          // 'model' | 'pick-sketch-plane' | 'pick-lookat' | 'sketch' | 'feature'
    rebuildDeferred: false, // the document changed while a sketch was open
    leftDrag: 'select',     // what dragging the left button does: 'select' | 'orbit' | 'pan'
    originVisible: false,
    kernelReady: false,
    fitNext: false,         // zoom to the part after the next rebuild (new or opened part)
    keepView: false,        // a part tab shown again: keep the view it was left with
    pickText: null          // the prompt while a plane is being picked
};

const doc = createDocument();

/* ================= status bar ================= */
function setStatus(text) {
    $('status-msg').textContent = text;
}

function setPrompt(text) {
    $('prompt').hidden = !text;
    $('prompt').textContent = text || '';
}

function setEngine(id, cls, title) {
    const el = $(id);
    el.classList.remove('ok', 'bad');
    if (cls) {
        el.classList.add(cls);
    }
    el.title = title;
}

function mm(value, digits) {
    return value.toFixed(digits === undefined ? 2 : digits);
}

function describe(item) {
    if (item.kind === 'edge') {
        return 'Edge, length ' + mm(item.length) + ' mm';
    }
    if (item.kind !== 'face' || typeof item.area !== 'number') {
        return 'Body'; // a whole component; parts never pick these
    }
    const names = { plane: 'Planar face', cylinder: 'Cylindrical face', other: 'Face' };
    return (names[item.type] || 'Face') + ', area ' + mm(item.area) + ' mm2';
}

/* ================= theme ================= */
function applyTheme(theme) {
    const dark = theme === 'dark';
    document.body.classList.toggle('dark', dark);
    document.querySelector('meta[name=theme-color]').setAttribute('content', dark ? '#1b1d21' : '#f3f4f6');
    try {
        window.ao_module_setWindowTheme(dark ? 'dark' : 'white');
    } catch (e) {
        // Not inside an ArozOS float window
    }
}

function initTheme() {
    const inDesktop = !!window.ao_module_virtualDesktop;
    if (!inDesktop && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        applyTheme('dark');
    }
    files.hasBackend().then(function (ok) {
        if (!ok) {
            return; // the theme preference lives on the server
        }
        // The stored preference is "darkTheme" / "whiteTheme"
        window.ao_module_getSystemThemeColor(function (pref) {
            applyTheme(pref === 'darkTheme' || pref === 'dark' ? 'dark' : 'light');
        });
    });
    try {
        window.ao_module_onThemeChanged(applyTheme);
    } catch (e) {
        // Standalone page without ao_module
    }
}

/* ================= ribbon, viewport, browser ================= */
const ribbon = createRibbon({ tabs: $('tabs'), panels: $('panels'), openMenu: openMenu }, onCommand);

const viewport = createViewport({
    canvas: $('viewport'),
    viewCube: $('viewcube-cam'),
    triad: $('triad'),
    onHoverPlane: function (key) {
        browser.setHotPlane(key);
        if (state.pickText) {
            setStatus(key ? { xy: 'XY Plane', xz: 'XZ Plane', yz: 'YZ Plane' }[key] + ': click to use it' : state.pickText);
        }
    },
    onHover: function (item) {
        if (state.env === 'drawing') {
            drawing.onHover(item);
            return;
        }
        if (state.env === 'assembly') {
            if (!activeInspect) {
                assembly.onHover(item);
            }
            return;
        }
        if (state.mode === 'model') {
            setStatus(item ? describe(item) : selectionText());
        } else if (state.pickText) {
            // Waiting for a plane: say what the face under the pointer is
            setStatus(item ? describe(item) + ': click to use it' : state.pickText);
        }
    },
    onSelect: function (items) {
        if (state.env === 'drawing') {
            drawing.onSelect(items);
            return;
        }
        if (state.env === 'assembly') {
            assembly.onSelect(items);
            return;
        }
        if (state.mode === 'model') {
            setStatus(selectionText());
        }
    }
});

const browser = createBrowser($('tree'), doc, {
    onPlaneHover: function (key) {
        viewport.setHotPlane(key);
    },
    onPlaneClick: function (key) {
        if (picking()) {
            viewport.stopPlanePick();
            planePicked({ kind: 'origin', key: key });
        }
    },
    onFeatureSelect: function (id) {
        // While a pattern or mirror is set up, the browser picks what it repeats
        if (activeFeature && activeFeature.tool.pickFeature) {
            activeFeature.tool.pickFeature(id);
            return;
        }
        const feature = id && doc.feature(id);
        if (feature && state.mode === 'model') {
            const status = featureReport[id];
            setStatus(status && status.status === 'error' ? feature.name + ': ' + status.message : feature.name);
        }
    },
    onFeatureAction: function (action, id, value) {
        const feature = doc.feature(id);
        if (!feature) {
            return;
        }
        if (action === 'rename') {
            doc.rename(id, value);
        } else if (action === 'suppress' || action === 'unsuppress') {
            doc.setSuppressed(id, action === 'suppress');
        } else if (action === 'delete') {
            deleteFeature(id);
        } else if (action === 'edit' && feature.type === 'sketch') {
            openSketch(id);
        } else if (action === 'editsketch' && doc.feature(feature.sketch)) {
            openSketch(feature.sketch);
        } else if (action === 'edit' && FEATURE_HINTS[toolKind(feature)]) {
            startFeature(toolKind(feature), id);
        } else if (action === 'edit') {
            setStatus(feature.name + ' cannot be edited in this version');
        }
    }
});

/* ================= sketcher ================= */
// Ribbon button of each sketch tool, to show which one is active
const TOOL_BUTTONS = {
    line: 'sk.line', rect: 'sk.rect', circle: 'sk.circle', arc: 'sk.arcs', arc3: 'sk.arcs', arctan: 'sk.arcs', point: 'sk.point',
    fillet: 'sk.fillet', chamfer: 'sk.chamfer', 'con:concentric': 'con.concentric',
    mirror: 'sk.mirror', polygon: 'sk.polygon', slot: 'sk.slot',
    trim: 'sk.trim', extend: 'sk.extend', dimension: 'sk.dimension', project: 'sk.project',
    'con:coincident': 'con.coincident', 'con:collinear': 'con.collinear', 'con:horizontal': 'con.horizontal', 'con:vertical': 'con.vertical',
    'con:parallel': 'con.parallel', 'con:perpendicular': 'con.perpendicular', 'con:tangent': 'con.tangent',
    'con:equal': 'con.equal', 'con:fix': 'con.fix', 'con:midpoint': 'con.midpoint', 'con:symmetric': 'con.symmetric'
};
let activeTool = 'select';

const sketcher = createSketcher({
    stage: $('stage'),
    canvas: $('viewport'),
    viewport: viewport,
    doc: doc,
    onPrompt: setPrompt,
    onStatus: setStatus,
    onState: function (s) {
        activeTool = s.tool;
        // Several tools share a button (the three arcs): light the one in use
        const on = TOOL_BUTTONS[s.tool];
        Object.values(TOOL_BUTTONS).forEach(function (button) {
            ribbon.setOn(button, button === on);
        });
        ribbon.setOn('sk.construction', s.construction);
    }
});

// Sketches nothing has been built from yet are drawn in the model, so they
// can be seen and picked; the one open in the sketcher draws itself.
function refreshSketches() {
    const used = new Set(doc.features().map(function (f) {
        return f.sketch;
    }));
    const list = [];
    doc.features().forEach(function (feature) {
        const frame = feature.type === 'sketch' ? planeFrame(feature.plane, doc.features()) : null;
        if (!frame || feature.suppressed || used.has(feature.id) || feature.id === sketcher.featureId()) {
            return;
        }
        const out = [];
        sketchModel.curves(sketchModel.clone(feature)).forEach(function (curve) {
            const pts = sample(curve).map(function (p) {
                return toWorld(frame, p[0], p[1]);
            });
            for (let i = 1; i < pts.length; i++) {
                out.push(pts[i - 1][0], pts[i - 1][1], pts[i - 1][2], pts[i][0], pts[i][1], pts[i][2]);
            }
        });
        list.push({ id: feature.id, segments: new Float32Array(out) });
    });
    viewport.setSketches(list);
}

// Work plane features are drawn in the model; `draft` is the frame of one
// that is being set up in its panel
let draftPlane = null;
function refreshWorkPlanes() {
    const list = [];
    doc.features().forEach(function (feature) {
        const frame = feature.type === 'plane' && !feature.suppressed ? workPlaneFrame(feature, doc.features()) : null;
        // The plane being edited is shown by its draft instead
        if (frame && !(draftPlane && draftPlane.id === feature.id)) {
            list.push({ id: feature.id, frame: frame });
        }
    });
    if (draftPlane) {
        list.push({ id: null, frame: draftPlane.frame, draft: true });
    }
    viewport.setWorkPlanes(list);
}

// The coordinate system of a sketch on a picked planar face: X runs level
// (or along world X on a horizontal face), the origin is the point of the
// plane nearest the part origin, so sketch and model coordinates line up.
// Sketches and work planes on faces, where the rebuild found the faces now
function takeFaceFrames(frames) {
    Object.keys(frames || {}).forEach(function (id) {
        const feature = doc.feature(id);
        if (feature) {
            resolveFace(feature.type === 'plane' ? feature.base : feature.plane, frames[id]);
        }
    });
}

function faceFrame(target) {
    const n = target.normal;
    const d = n[0] * target.origin[0] + n[1] * target.origin[1] + n[2] * target.origin[2];
    let x = [1, 0, 0];
    if (Math.abs(n[2]) < 0.99) {
        const len = Math.hypot(n[0], n[1]);
        x = [-n[1] / len, n[0] / len, 0];
    }
    const y = [n[1] * x[2] - n[2] * x[1], n[2] * x[0] - n[0] * x[2], n[0] * x[1] - n[1] * x[0]];
    return { o: [n[0] * d, n[1] * d, n[2] * d], x: x, y: y, n: n };
}

function openSketch(id) {
    if (picking()) {
        leaveMode();
    }
    sketcher.close();
    sketcher.open(id).then(function (ok) {
        if (!ok) {
            setStatus('This sketch cannot be opened: the plane it was drawn on is missing');
            return;
        }
        state.mode = 'sketch';
        viewport.clearSelection();
        viewport.setOriginVisible(false);
        viewport.lookAlong(sketcher.frame().n);
        ribbon.setTabVisible('sketch', true);
        ribbon.showTab('sketch');
        browser.setEditing(id);
        refreshSketches();
    });
}

// Leave the sketch environment. The model is rebuilt now, not on every
// stroke, because features built from the sketch may be slow to recompute.
function closeSketch() {
    if (!sketcher.isOpen()) {
        return;
    }
    sketcher.close();
    state.mode = 'model';
    viewport.setOriginVisible(state.originVisible);
    ribbon.setTabVisible('sketch', false);
    ribbon.showTab('model');
    browser.setEditing(null);
    setPrompt('');
    setStatus('Ready');
}

/* ================= feature panels ================= */
// What the status bar says while a new feature of each kind is set up
const FEATURE_HINTS = {
    extrude: 'Extrude: pick a profile, set the distance (type it or drag the arrow), then OK',
    revolve: 'Revolve: pick a profile and the axis line to turn it about, then OK',
    shell: 'Shell: click the faces to leave open, set the wall thickness, then OK',
    rectpattern: 'Rectangular Pattern: click the features to repeat in the browser, set the directions, then OK',
    circpattern: 'Circular Pattern: click the features to repeat in the browser, pick the axis, then OK',
    mirror: 'Mirror: click the features to mirror in the browser (none: the whole solid), pick the plane, then OK',
    fillet: 'Fillet: click the edges to round, set the radius, then OK',
    chamfer: 'Chamfer: click the edges to break, set the distance, then OK',
    hole: 'Hole: set the type and size of the holes at the sketch points, then OK',
    plane: 'Work Plane: set the distance from the picked plane (type it or drag the arrow), then OK'
};
let activeFeature = null;   // { kind, tool, rolledBack } while a feature panel is open

// The ribbon button of a feature kind
function featureButton(kind) {
    return { plane: 'work.plane', rectpattern: 'pat.rect', circpattern: 'pat.circ', mirror: 'pat.mirror' }[kind] || 'feat.' + kind;
}

// The panel kind that edits a feature (patterns come in two kinds)
function toolKind(feature) {
    return feature.type === 'pattern' ? (feature.kind === 'circ' ? 'circpattern' : 'rectpattern') : feature.type;
}

// Open a feature panel: for a new feature, or to edit one (featureId).
// While a feature is edited the model is shown as it was before it, so what
// the feature was built on can be seen and picked again.
function startFeature(kind, featureId) {
    if (picking()) {
        leaveMode();
    }
    if (sketcher.isOpen()) {
        finishSketch(); // as in Inventor, a feature command inside a sketch finishes it first
    }
    const tool = featureTools[kind];
    const preselected = viewport.selection();
    viewport.clearSelection();
    const shown = featureId ? kernel.call('rebuild', { document: doc.data(), upto: featureId }).then(function (result) {
        takeFaceFrames(result.frames);
        viewport.setBodies(result.bodies);
    }) : Promise.resolve();
    shown.then(function () {
        // Fillet and chamfer pick edges of the model; the others must not react to it
        viewport.setPicking(['fillet', 'chamfer', 'shell', 'rectpattern', 'circpattern', 'mirror'].indexOf(kind) >= 0);
        return tool.start(featureId || null, preselected, browser.selected());
    }).then(function (ok) {
        if (!ok) {
            viewport.setPicking(true);
            if (featureId) {
                requestRebuild(); // put the full model back
            }
            return;
        }
        activeFeature = { kind: kind, tool: tool, rolledBack: !!featureId };
        state.mode = 'feature';
        ribbon.showTab('model');
        ribbon.setOn(featureButton(kind), true);
        setStatus(featureId ? 'Editing ' + doc.feature(featureId).name + ': change the values, then OK' : FEATURE_HINTS[kind]);
    }).catch(function (err) {
        setStatus('The feature could not be opened: ' + err.message);
        requestRebuild();
    });
}

function featureClosed(kind) {
    const was = activeFeature;
    activeFeature = null;
    if (was && was.tool.pickFeature) {
        // The browser picked what a pattern repeats; that pick is done with
        browser.select(null);
    }
    state.mode = sketcher.isOpen() ? 'sketch' : 'model';
    ribbon.setOn(featureButton(kind), false);
    viewport.setPicking(true);
    setStatus('Ready');
    if (was && was.rolledBack) {
        requestRebuild(); // show the whole model again
    }
}

function finishSketch() {
    closeSketch();
    refreshSketches();
    viewport.home();
    if (state.rebuildDeferred) {
        requestRebuild();
    }
}

function selectionText() {
    const items = viewport.selection();
    if (!items.length) {
        return 'Ready';
    }
    if (items.length === 1) {
        return 'Selected: ' + describe(items[0]);
    }
    const faces = items.filter(function (i) {
        return i.kind === 'face';
    }).length;
    return 'Selected: ' + faces + ' face' + (faces === 1 ? '' : 's') + ', ' + (items.length - faces) + ' edge' + (items.length - faces === 1 ? '' : 's');
}

/* ================= quick access + navigation bar ================= */
function iconButton(parent, id, iconName, title) {
    const button = document.createElement('button');
    button.className = 'qa-btn';
    button.title = title;
    button.innerHTML = icon(iconName);
    button.addEventListener('click', function () {
        onCommand(id);
    });
    parent.appendChild(button);
    return button;
}

iconButton($('quickaccess'), 'file.new', 'new', 'New');
iconButton($('quickaccess'), 'file.open', 'open', 'Open (Ctrl+O)');
iconButton($('quickaccess'), 'file.save', 'save', 'Save (Ctrl+S)');
const undoButton = iconButton($('quickaccess'), 'edit.undo', 'undo', 'Undo (Ctrl+Z)');
const redoButton = iconButton($('quickaccess'), 'edit.redo', 'redo', 'Redo (Ctrl+Y)');
$('viewcube-home').addEventListener('click', function () {
    onCommand('nav.home');
});
iconButton($('navbar'), 'nav.zoomall', 'zoomall', 'Zoom All');
iconButton($('navbar'), 'nav.home', 'home', 'Home View');
iconButton($('navbar'), 'nav.lookat', 'lookat', 'Look At');
const orbitButton = iconButton($('navbar'), 'nav.orbit', 'orbit', 'Orbit: drag with the left button to turn the view (or hold F4, or Shift + middle button)');
const panButton = iconButton($('navbar'), 'nav.pan', 'pan', 'Pan: drag with the left button to move the view (or drag with the middle button)');

// Lend the left button to the view ('orbit' or 'pan'), or give it back ('select')
function setLeftDrag(mode) {
    state.leftDrag = mode;
    viewport.setLeftDrag(mode);
    ribbon.setOn('nav.pan', mode === 'pan');
    ribbon.setOn('nav.orbit', mode === 'orbit');
    orbitButton.classList.toggle('on', mode === 'orbit');
    panButton.classList.toggle('on', mode === 'pan');
    drawOrbitMark();
}

// The circle shown over the model while the left button orbits: four
// ticks outside it at the quarters and a small cross in the middle
function drawOrbitMark() {
    const mark = $('orbit-mark');
    // An SVG element has no `hidden` property: set the attribute itself
    const off = state.leftDrag !== 'orbit';
    mark.toggleAttribute('hidden', off);
    if (off) {
        return;
    }
    const w = $('stage').clientWidth;
    const h = $('stage').clientHeight;
    const cx = Math.round(w / 2) + 0.5;
    const cy = Math.round(h / 2) + 0.5;
    const r = Math.round(Math.min(w, h) * 0.37);
    const t = Math.round(r * 0.21);
    const c = 30;
    mark.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    mark.innerHTML = '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '"/>' +
        '<path d="M' + cx + ' ' + (cy - r - t) + 'V' + (cy - r) + 'M' + cx + ' ' + (cy + r) + 'V' + (cy + r + t) +
        'M' + (cx - r - t) + ' ' + cy + 'H' + (cx - r) + 'M' + (cx + r) + ' ' + cy + 'H' + (cx + r + t) +
        'M' + (cx - c) + ' ' + cy + 'H' + (cx + c) + 'M' + cx + ' ' + (cy - c) + 'V' + (cy + c) + '"/>';
}
if (window.ResizeObserver) {
    new ResizeObserver(drawOrbitMark).observe($('stage'));
}

/* ================= document -> rebuild -> display ================= */
let featureReport = {};
let rebuildRunning = false;
let rebuildWanted = false;
let lastFailed = false;

// The document the shared commands (files, undo, title) act on
function activeDoc() {
    return state.env === 'assembly' ? assembly.doc : state.env === 'drawing' ? drawing.doc : doc;
}

// What each kind of document is saved as
const EXT = { part: '.aopart', assembly: '.aoasm', drawing: '.aodrw' };
const KIND_NAMES = { part: 'part', assembly: 'assembly', drawing: 'drawing' };

/* ================= document tabs ================= */
// Every open document has a tab under the view (js/tabs.js). The shown one
// lives in its environment's document (doc, assembly.doc, drawing.doc); the
// others are kept as snapshots, undo history and view included, and come
// back when their tab is clicked. Each tab has its own key space in the
// kernel, so its solids, assembly parts and drawing views are found cached
// when it is shown again. Assemblies and drawings read the parts they use
// through files.readPath, which hands out a document open in a tab as it is
// there (unsaved edits too): showing their tab again brings the edits in.
const tabs = [];            // { id, kind, snap, view }
let activeTab = null;
let tabSeq = 0;
const tabBar = createTabBar($('doctabs'), {
    onSelect: function (id) {
        switchTo(tabById(id));
    },
    onClose: function (id) {
        const tab = tabById(id);
        if (tab) {
            closeTab(tab);
        }
    },
    onNew: function () {
        newDocument();
    }
});

function tabById(id) {
    return tabs.filter(function (t) {
        return t.id === id;
    })[0] || null;
}

function docOf(kind) {
    return kind === 'assembly' ? assembly.doc : kind === 'drawing' ? drawing.doc : doc;
}

function tabName(tab) {
    return tab === activeTab ? docOf(tab.kind).name : tab.snap ? tab.snap.name : '';
}

function tabPath(tab) {
    return tab === activeTab ? docOf(tab.kind).path : tab.snap ? tab.snap.path : '';
}

function tabDirty(tab) {
    return tab === activeTab ? docOf(tab.kind).isDirty() : !!tab.snap && tab.snap.data !== tab.snap.saved;
}

function tabData(tab) {
    return tab === activeTab ? docOf(tab.kind).data() : JSON.parse(tab.snap.data);
}

function renderTabs() {
    tabBar.render(tabs.map(function (t) {
        return { id: t.id, kind: t.kind, name: tabName(t), path: tabPath(t), dirty: tabDirty(t) };
    }), activeTab ? activeTab.id : null);
}

// An empty document nobody has touched: a file opened next takes its place
function isPristine(tab) {
    if (tab !== activeTab || tabDirty(tab) || tabPath(tab)) {
        return false;
    }
    if (tab.kind === 'assembly') {
        return !assembly.doc.components().length;
    }
    if (tab.kind === 'drawing') {
        return !drawing.doc.views().length && !drawing.doc.annotations().length;
    }
    return !doc.features().length;
}

// Put away whatever is open in the shown document before another is shown
function leaveDocument() {
    closeInspect(true);
    if (activeFeature) {
        activeFeature.tool.cancel();
    }
    appearanceTool.cancel();
    if (picking()) {
        leaveMode();
    }
    if (sketcher.isOpen()) {
        closeSketch();
    }
    if (state.env === 'assembly') {
        assembly.stopTools();
    } else if (state.env === 'drawing') {
        drawing.stopTools();
    }
    setLeftDrag('select');
    viewport.setSection('none');
    ribbon.setLabel('view.section', 'Section View');
    viewport.setPreview(null);
    viewport.clearSelection();
    setPrompt('');
}

// Keep the shown document (and where it was looked at) in its tab
function stash() {
    if (activeTab) {
        activeTab.snap = docOf(activeTab.kind).snapshot();
        activeTab.view = activeTab.kind === 'drawing' ? drawing.viewState() : viewport.viewState();
    }
}

// "Sample Part", then "Sample Part 2" while the first is still open
function sampleName(base) {
    const names = tabs.map(tabName);
    let name = base;
    for (let n = 2; names.indexOf(name) >= 0; n++) {
        name = base + ' ' + n;
    }
    return name;
}

// Show a tab's document: a new one (fresh: { data, name, path }) or the
// snapshot it was kept as
function enter(tab, fresh) {
    activeTab = tab;
    if (tab.kind === 'part') {
        kernel.call('useRebuilder', { key: 'part:' + tab.id }).catch(function () {
            // The kernel failed to start; the status bar says so
        });
        state.fitNext = !!fresh;
        state.keepView = !fresh;
        if (fresh) {
            doc.reset(fresh.data, fresh.name, fresh.path);
        } else {
            doc.restore(tab.snap);
        }
    } else if (tab.kind === 'assembly') {
        assembly.setKeySpace(tab.id);
        if (fresh) {
            assembly.doc.reset(fresh.data, fresh.name, fresh.path);
        } else {
            assembly.doc.restore(tab.snap);
        }
    } else {
        drawing.setKeySpace(tab.id);
        if (fresh) {
            drawing.doc.reset(fresh.data, fresh.name, fresh.path);
        } else {
            drawing.doc.restore(tab.snap);
        }
    }
    tab.snap = null;
    setEnv(tab.kind);
    // Parts and drawings pick faces and edges, never whole components
    if (tab.kind !== 'assembly') {
        viewport.setComponentMode(false);
    }
    if (!fresh && tab.view) {
        if (tab.kind === 'drawing') {
            drawing.setViewState(tab.view);
        } else {
            viewport.setViewState(tab.view);
        }
    }
    refreshChrome();
}

function switchTo(tab) {
    if (!tab || tab === activeTab) {
        return;
    }
    leaveDocument();
    stash();
    enter(tab, null);
    setStatus(tabName(tab) + (tabPath(tab) ? ' (' + tabPath(tab) + ')' : ''));
}

// Open a document in a tab of its own: a file already open shows its tab,
// and an untouched empty document gives its place
function openTab(kind, data, name, path) {
    if (path) {
        const open = tabs.filter(function (t) {
            return tabPath(t) === path;
        })[0];
        if (open) {
            switchTo(open);
            return open;
        }
    }
    leaveDocument();
    let tab = activeTab && isPristine(activeTab) ? activeTab : null;
    if (tab) {
        tab.kind = kind;
        tab.view = null;
    } else {
        stash();
        tab = { id: 't' + (++tabSeq), kind: kind, snap: null, view: null };
        tabs.push(tab);
    }
    enter(tab, { data: data, name: name, path: path });
    return tab;
}

function removeTab(tab) {
    const i = tabs.indexOf(tab);
    if (i < 0) {
        return;
    }
    const wasShown = tab === activeTab;
    if (wasShown) {
        leaveDocument();
    }
    tabs.splice(i, 1);
    // Free what the kernel kept for it
    kernel.call('dropRebuilder', { key: 'part:' + tab.id }).catch(function () {
        // The kernel is gone
    });
    assembly.forget(tab.id);
    drawing.forget(tab.id);
    if (wasShown) {
        activeTab = null;
        const next = tabs[Math.min(i, tabs.length - 1)];
        if (next) {
            enter(next, null);
        } else {
            const fresh = { id: 't' + (++tabSeq), kind: 'part', snap: null, view: null };
            tabs.push(fresh);
            enter(fresh, { data: null, name: 'Part1', path: '' });
        }
    }
    renderTabs();
}

function closeTab(tab) {
    if (tab !== activeTab && !tabDirty(tab)) {
        removeTab(tab);
        return;
    }
    // Show it, so the question is about what is on the screen
    switchTo(tab);
    confirmDiscard().then(function (ok) {
        if (ok) {
            removeTab(tab);
        }
    });
}

// Assemblies and drawings read the documents open in tabs as they are
files.setOpenDocuments(function (path) {
    const tab = tabs.filter(function (t) {
        return tabPath(t) === path;
    })[0];
    return tab ? { data: tabData(tab), name: tabName(tab) } : null;
});


function refreshChrome() {
    const d = activeDoc();
    const title = d.name + (d.isDirty() ? ' *' : '');
    $('doctitle').textContent = title;
    undoButton.disabled = !d.canUndo();
    redoButton.disabled = !d.canRedo();
    try {
        window.ao_module_setWindowTitle('3D Modeler - ' + title);
    } catch (e) {
        // Not inside an ArozOS float window
    }
    renderTabs();
}

// Only one rebuild runs at a time. Changes made meanwhile collapse into one
// further rebuild of the then current document.
function requestRebuild() {
    if (rebuildRunning) {
        rebuildWanted = true;
        return;
    }
    rebuildRunning = true;
    rebuildWanted = false;
    state.rebuildDeferred = false;
    kernel.call('rebuild', { document: doc.data() }).then(function (result) {
        if (state.env !== 'part') {
            return; // an assembly is on show; the (empty) part waits
        }
        featureReport = result.features;
        takeFaceFrames(result.frames);
        // A feature being edited keeps its rolled back view; closing it asks again
        if (!(activeFeature && activeFeature.rolledBack)) {
            const first = !viewport.bodyCount() && result.bodies.length > 0;
            viewport.setBodies(result.bodies);
            refreshWorkPlanes(); // their size follows the part
            if (first && !state.fitNext && !state.keepView) {
                viewport.zoomAll(); // the first solid of the part: bring it into view
            }
            if (result.bodies.length) {
                state.keepView = false;
            }
        }
        browser.render(featureReport, result.bodies.length);
        if (state.fitNext) {
            state.fitNext = false;
            viewport.home();
        }
        const failed = doc.features().filter(function (f) {
            return featureReport[f.id] && featureReport[f.id].status === 'error';
        });
        const hadFailures = lastFailed;
        lastFailed = failed.length > 0;
        if (failed.length) {
            setStatus(failed.length === 1 ? failed[0].name + ' could not be built: ' + featureReport[failed[0].id].message
                : failed.length + ' features could not be built, see the model browser');
        } else if (hadFailures && state.mode === 'model') {
            setStatus('Ready'); // clear the error text once the part builds again
        }
    }).catch(function (err) {
        setStatus('Rebuild failed: ' + err.message);
    }).then(function () {
        rebuildRunning = false;
        if (rebuildWanted) {
            requestRebuild();
        }
    });
}

doc.onChange(function (reason) {
    refreshChrome();
    if (appearanceTool.isOpen() && reason !== 'saved') {
        appearanceTool.cancel(); // undo or another part pulled the look from under the panel
    }
    if (state.env === 'part') {
        viewport.setAppearance(doc.data().appearance || null);
    }
    if (activeFeature) {
        activeFeature.tool.cancel(); // undo, redo or a new part pulled the model from under the panel
    }
    if (sketcher.isOpen()) {
        // Another part was loaded, the open sketch was deleted or undone away,
        // or undo / redo changed it under the sketcher
        const gone = reason === 'reset' || reason === 'restore' || !doc.feature(sketcher.featureId());
        if (gone || ((reason === 'undo' || reason === 'redo') && !sketcher.reload())) {
            closeSketch();
        }
    }
    browser.render();
    refreshSketches();
    refreshWorkPlanes();
    if (reason === 'saved') {
        return;
    }
    if (sketcher.isOpen()) {
        state.rebuildDeferred = true;
    } else {
        requestRebuild();
    }
});

/* ================= files ================= */
function fail(title, err) {
    setStatus(title + ': ' + err.message);
    return tell(title, err.message);
}

// Resolves to true when it is fine to throw the current document away
function confirmDiscard() {
    const d = activeDoc();
    if (!d.isDirty()) {
        return Promise.resolve(true);
    }
    return ask('Unsaved changes', 'Save the changes to ' + d.name + ' first?', [
        { label: 'Cancel', value: 'cancel' },
        { label: 'Do Not Save', value: 'discard' },
        { label: 'Save', value: 'save', primary: true }
    ], 'cancel').then(function (answer) {
        if (answer === 'discard') {
            return true;
        }
        return answer === 'save' ? saveDocument(false) : false;
    });
}

// Switch the window between the part, assembly and drawing environments.
// What was open in the other one is put away; its document stays (the tab
// it belongs to was stashed before, see enter()).
function setEnv(env) {
    if (state.env === env) {
        return;
    }
    const was = state.env;
    closeInspect(true);
    if (activeFeature) {
        activeFeature.tool.cancel();
    }
    if (picking()) {
        leaveMode();
    }
    if (sketcher.isOpen()) {
        closeSketch();
    }
    setLeftDrag('select');
    viewport.setSection('none');
    ribbon.setLabel('view.section', 'Section View');
    viewport.setPreview(null);
    viewport.clearSelection();
    // Put away what was open
    if (was === 'assembly') {
        assembly.deactivate();
    } else if (was === 'drawing') {
        drawing.deactivate();
        showSheetChrome(false);
    }
    viewport.setBodies([]);
    state.env = env;
    ribbon.setMode(env);
    ribbon.setTabVisible('sketch', false);
    $('tree').hidden = env !== 'part';
    $('asm-tree').hidden = env !== 'assembly';
    $('drw-tree').hidden = env !== 'drawing';
    $('browser-head').textContent = { part: 'Model', assembly: 'Assembly', drawing: 'Drawing' }[env];
    // Only a part shows through the shared body material; assemblies and
    // drawings give each body its own
    viewport.setAppearance(env === 'part' ? doc.data().appearance || null : null);
    if (env === 'assembly') {
        assembly.activate();
        ribbon.showTab('assemble');
    } else if (env === 'drawing') {
        drawing.activate();
        ribbon.showTab('drawviews');
    } else {
        ribbon.showTab('model');
        requestRebuild();
    }
    refreshChrome();
}

// While a drawing shows its sheet the 3D view's own controls are put away;
// the Drawing View panel brings the 3D view back to pick a direction
function showSheetChrome(sheet) {
    $('stage').classList.toggle('sheet-mode', !!sheet);
}

// A part, an assembly or a drawing, by its format, in a tab of its own
function loadDocument(data, name, path) {
    const kind = data && data.format === 'aodrw' ? 'drawing' : data && data.format === 'aoasm' ? 'assembly' : 'part';
    let clean = null;
    try {
        if (data) {
            const copy = JSON.parse(JSON.stringify(data));
            clean = kind === 'drawing' ? validateDrawing(copy) : kind === 'assembly' ? validateAssembly(copy) : validatePart(copy);
        }
    } catch (err) {
        fail('The ' + KIND_NAMES[kind] + ' could not be opened', err);
        return false;
    }
    openTab(kind, clean, name, path);
    return true;
}

// The model a new drawing starts from: the part or assembly that was open
// (by its file when it is saved, else kept inside the drawing), or null
function drawingSuggestion() {
    const copy = function (d) {
        return JSON.parse(JSON.stringify(d));
    };
    if (state.env === 'part' && doc.features().some(function (f) {
        return f.type !== 'sketch' && f.type !== 'plane';
    })) {
        return { data: copy(doc.data()), name: doc.name, path: doc.isDirty() ? '' : doc.path };
    }
    if (state.env === 'assembly' && assembly.doc.components().length) {
        return { data: copy(assembly.doc.data()), name: assembly.doc.name, path: assembly.doc.isDirty() ? '' : assembly.doc.path };
    }
    return null;
}

// A new document in a tab of its own (the open ones stay open)
function newDocument() {
    chooseNew().then(function (kind) {
        if (!kind) {
            return;
        }
        const names = tabs.map(tabName);
        if (kind === 'drawing') {
            // The part or assembly on show is what the drawing starts from
            const suggest = drawingSuggestion();
            openTab('drawing', null, freeName('Drawing', names), '');
            drawing.startNew(suggest);
        } else if (kind === 'assembly') {
            openTab('assembly', null, freeName('Assembly', names), '');
            setStatus('New assembly: Assemble > Place puts in the first part, which is grounded at the origin');
        } else {
            openTab('part', null, freeName('Part', names), '');
            setStatus('New part: Start 2D Sketch on an origin plane');
        }
    });
}

function openDocument() {
    files.open().then(function (file) {
        if (file && loadDocument(file.data, file.name, file.path)) {
            setStatus('Opened ' + (file.path || file.name));
        }
    }).catch(function (err) {
        fail('The part could not be opened', err);
    });
}

// Resolves to true when the part (or assembly) was written
function saveDocument(askWhere) {
    const d = activeDoc();
    const ext = EXT[state.env];
    // Assemblies and drawings write their links relative to where they land
    const text = d.serializeFor ? function (target) {
        return d.serializeFor(target);
    } : d.serialize();
    return files.save(text, d.name, d.path, askWhere, ext).then(function (saved) {
        if (!saved) {
            return false;
        }
        d.name = saved.name;
        d.path = saved.path;
        d.markSaved();
        setStatus(saved.path ? 'Saved to ' + saved.path : 'Downloaded ' + saved.name + ext);
        return true;
    }).catch(function (err) {
        fail('The ' + KIND_NAMES[state.env] + ' could not be saved', err);
        return false;
    });
}

/* ================= inspect ================= */
function showMassProperties() {
    if (!viewport.bodyCount()) {
        setStatus('There is no solid to measure yet');
        return;
    }
    kernel.call('massProperties').then(function (m) {
        const line = function (label, values, unit) {
            return label + ': ' + values.map(function (v) {
                return mm(v, 3);
            }).join(' x ') + ' ' + unit;
        };
        tell('Mass Properties of ' + doc.name, [
            'Solid bodies: ' + m.bodies,
            line('Volume', [m.volume], 'mm3') + ' (' + mm(m.volume / 1000, 3) + ' cm3)',
            line('Surface area', [m.area], 'mm2'),
            line('Overall size (X x Y x Z)', m.size, 'mm'),
            'Centre of gravity: X ' + mm(m.centre[0], 3) + ', Y ' + mm(m.centre[1], 3) + ', Z ' + mm(m.centre[2], 3) + ' mm',
            '',
            'Mass = volume x density of your material, for example PLA 1.24 g/cm3: ' + mm(m.volume / 1000 * 1.24, 2) + ' g.'
        ].join('\n'));
    }).catch(function (err) {
        fail('The part could not be measured', err);
    });
}

// Measure and Section View: panels shared by parts and assemblies
let activeInspect = null;   // { kind: "measure" | "section", tool }

function partDistance(a, b) {
    const ref = function (item) {
        return item.kind === 'edge' ? { type: 'edge', body: item.body, mid: item.mid, length: item.length }
            : { type: 'face', body: item.body, index: item.index };
    };
    return kernel.call('distance', { a: ref(a), b: ref(b) });
}

function startInspect(kind, arg) {
    closeInspect(true);
    if (sketcher.isOpen()) {
        finishSketch();
    }
    if (activeFeature) {
        activeFeature.tool.cancel();
    }
    if (state.env === 'assembly') {
        assembly.stopTools();
    }
    const tool = kind === 'section' ? sectionPanel : state.env === 'assembly' ? measureAssembly : measurePart;
    if (!viewport.bodyCount()) {
        setStatus(kind === 'section' ? 'There is nothing to cut yet' : 'There is nothing to measure yet');
        return;
    }
    if (tool.start(arg)) {
        activeInspect = { kind: kind, tool: tool };
        ribbon.setOn('ins.measure', kind === 'measure');
        setStatus(kind === 'measure' ? 'Measure: click a face or an edge, then a second one' : 'Section View: pick the plane and drag its position');
    }
}

// Put an open Measure or Section panel away (a section is kept)
function closeInspect(keep) {
    if (activeInspect) {
        if (activeInspect.kind === 'section' && keep) {
            activeInspect.tool.accept();
        } else {
            activeInspect.tool.cancel();
        }
    }
}

function inspectClosed(kind) {
    if (!activeInspect || activeInspect.kind !== kind) {
        return;
    }
    activeInspect = null;
    ribbon.setOn('ins.measure', false);
    if (state.env === 'assembly') {
        viewport.setComponentMode(true);
    }
    if (kind === 'section') {
        const mode = viewport.sectionSpec().mode;
        ribbon.setLabel('view.section', mode === 'none' ? 'Section View' : 'Section: ' + { half: 'Half', quarter: 'Quarter', threequarter: '3/4' }[mode]);
    }
    setStatus('Ready');
}

/* ================= import and export ================= */
// How fine the triangles of a mesh export are: the largest gap allowed
// between a curved face and its triangles (mm) and between neighbours (rad)
const MESH_QUALITY = {
    coarse: { deflection: 0.2, angle: 0.5 },
    normal: { deflection: 0.05, angle: 0.25 },
    fine: { deflection: 0.01, angle: 0.1 }
};

function exportPart(format) {
    if (!viewport.bodyCount()) {
        setStatus('There is nothing to export yet');
        return;
    }
    const name = activeDoc().name;
    const base = name + '.' + format;
    let made;
    if (state.env === 'assembly' && (format === 'step' || format === 'brep')) {
        setStatus('Writing ' + format.toUpperCase() + '...');
        made = assembly.exportContent(format);
    } else if (format === 'step' || format === 'brep') {
        setStatus('Writing ' + format.toUpperCase() + '...');
        made = kernel.call('exportText', { format: format }).then(function (out) {
            return { text: out.text };
        });
    } else {
        made = ask('Export ' + format.toUpperCase(), 'How fine should curved faces be? Finer makes a larger file.', [
            { label: 'Cancel', value: null },
            { label: 'Coarse', value: 'coarse' },
            { label: 'Fine', value: 'fine' },
            { label: 'Normal', value: 'normal', primary: true }
        ], null).then(function (quality) {
            if (!quality) {
                return null;
            }
            setStatus(state.env === 'assembly' ? 'Meshing the assembly...' : 'Meshing the part...');
            const meshed = state.env === 'assembly' ? assembly.exportContent(format, MESH_QUALITY[quality])
                : kernel.call('mesh', MESH_QUALITY[quality]);
            return meshed.then(function (out) {
                if (format === 'obj') {
                    return { text: toOBJ(out.bodies, name) };
                }
                return { bytes: format === 'stl' ? toSTL(out.bodies) : to3MF(out.bodies) };
            });
        });
    }
    made.then(function (content) {
        return content ? files.saveAs(base, content) : null;
    }).then(function (saved) {
        setStatus(saved ? (saved.path ? 'Exported to ' + saved.path : 'Downloaded ' + saved.name) : 'Ready');
    }).catch(function (err) {
        fail('The part could not be exported', err);
    });
}

// A STEP file becomes a feature of its own that later features build on.
// file: { name, text }
function addImport(file) {
    setStatus('Reading ' + file.name + '...');
    return kernel.call('importInfo', { text: file.text }).then(function (info) {
        const id = doc.newId();
        const name = doc.newName('import');
        doc.change('Import ' + file.name, function (d) {
            d.features.push({ id: id, type: 'import', name: name, format: 'step', source: file.name, data: file.text });
        });
        state.fitNext = true;
        setStatus('Imported ' + info.solids + (info.solids === 1 ? ' solid' : ' solids') + ' from ' + file.name);
    });
}

function importStep() {
    files.openOther(['step', 'stp'], false).then(function (file) {
        return file ? addImport(file) : null;
    }).catch(function (err) {
        fail('The file could not be imported', err);
    });
}

function deleteFeature(id) {
    const feature = doc.feature(id);
    const dependents = doc.dependents(id);
    const go = !dependents.length ? Promise.resolve(true) : ask('Delete ' + feature.name,
        dependents.map(function (f) {
            return f.name;
        }).join(', ') + (dependents.length === 1 ? ' is' : ' are') + ' built from it and will be deleted too.',
        [{ label: 'Cancel', value: false }, { label: 'Delete', value: true, primary: true }], false);
    go.then(function (ok) {
        if (ok) {
            doc.remove(id);
        }
    });
}

// The desktop calls ao_module_close() when the window's close button is
// pressed: unsaved work is asked about first.
const closeWindow = window.ao_module_closeHandler;
window.ao_module_close = function () {
    closeInspect(true);
    const dirty = tabs.filter(tabDirty);
    let go;
    if (!dirty.length) {
        go = Promise.resolve(true);
    } else if (dirty.length === 1 && dirty[0] === activeTab) {
        go = confirmDiscard();
    } else {
        go = ask('Unsaved changes', dirty.map(tabName).join(', ') + (dirty.length === 1 ? ' has' : ' have') +
            ' changes that are not saved. Close 3D Modeler anyway?', [
            { label: 'Close Without Saving', value: true },
            { label: 'Cancel', value: false, primary: true }
        ], false);
    }
    go.then(function (ok) {
        if (ok && typeof closeWindow === 'function') {
            closeWindow();
        }
    });
};
window.addEventListener('beforeunload', function (event) {
    // Covers a browser tab; inside the desktop the handler above runs first
    if (tabs.some(tabDirty) && !window.ao_module_virtualDesktop) {
        event.preventDefault();
    }
});

/* ================= commands ================= */
function picking() {
    return state.mode === 'pick-sketch-plane' || state.mode === 'pick-lookat' || state.mode === 'pick-workplane';
}

function leaveMode() {
    viewport.stopPlanePick();
    state.pickText = null;
    ribbon.setOn('sketch.start', false);
    ribbon.setOn('nav.lookat', false);
    ribbon.setOn('work.plane', false);
    setPrompt('');
    state.mode = sketcher.isOpen() ? 'sketch' : 'model';
}

// target: { kind: "origin", key } or { kind: "face", body, face, origin, normal }
// target: { kind: "origin", key }, { kind: "face", body, face, origin, normal }
// or { kind: "work", id } for a work plane feature
function planePicked(target) {
    state.pickText = null;
    const work = target.kind === 'work' ? doc.feature(target.id) : null;
    const label = target.kind === 'origin' ? ORIGIN_PLANES[target.key].label : work ? work.name : 'the selected face';
    // A face also remembers its normal and the point clicked, so the sketch
    // (or work plane) can follow the face when an earlier feature moves it
    const reference = target.kind === 'origin' ? { ref: 'origin:' + target.key }
        : work ? { ref: 'plane', id: target.id }
            : target.point ? { ref: 'face', frame: faceFrame(target), face: { normal: target.normal, point: target.point } }
                : { ref: 'face', frame: faceFrame(target) };
    const turn = function () {
        if (target.kind === 'origin') {
            viewport.lookAtPlane(target.key);
        } else {
            viewport.lookAlong(work ? workPlaneFrame(work, doc.features()).n : target.normal);
        }
    };
    if (state.mode === 'pick-workplane') {
        // The base of a new work plane: hand it to the panel
        leaveMode();
        featureTools.plane.prepare(reference);
        startFeature('plane', null);
        return;
    }
    if (state.mode === 'pick-lookat') {
        leaveMode();
        turn();
        setStatus('Looking at ' + label);
        return;
    }
    // A new sketch on the picked plane, opened in the sketcher
    leaveMode();
    const id = doc.newId();
    const plane = reference;
    // A sketch on a face starts with the edges of that face as reference
    // geometry, so new geometry can be snapped, constrained and dimensioned
    // to the model (and the face outline can bound a profile)
    const start = { geometry: [], constraints: [] };
    if (target.kind === 'face') {
        viewport.curvesOf({ type: 'face', body: target.body, index: target.face }).forEach(function (curve) {
            addProjected(start, plane.frame, curve);
        });
    }
    doc.change('Create sketch', function (d) {
        d.features.push({ id: id, type: 'sketch', name: doc.newName('sketch'), plane: plane, geometry: start.geometry, constraints: [] });
    });
    openSketch(id);
}

function startPlanePick(mode, button, what) {
    state.mode = mode;
    ribbon.setOn(button, true);
    // With a solid in the part the user picks one of its planar faces; the
    // origin planes are only offered in an empty part (or from the browser)
    const text = viewport.bodyCount() ? 'Select a planar face ' + what : 'Select plane ' + what;
    state.pickText = text;
    setPrompt(text);
    setStatus(text);
    viewport.startPlanePick(planePicked, mode === 'pick-workplane');
}

function runSelfTest() {
    if (!state.kernelReady) {
        setStatus('The modelling kernel is still loading');
        return;
    }
    setStatus('Running kernel self-test...');
    kernel.call('selftest').then(function (out) {
        const s = out.stats;
        setStatus('Kernel self-test passed: extrude, hole, fillet and chamfer in ' + s.buildMs + ' ms, ' + s.faces + ' faces, ' +
            s.triangles + ' triangles, volume ' + s.volume.toFixed(1) + ' mm3, STEP export ' + (s.stepBytes / 1024).toFixed(1) + ' KB');
    }).catch(function (err) {
        setStatus('Kernel self-test failed: ' + err.message);
    });
}

function onCommand(id) {
    closeMenu();
    const wasPicking = picking() ? state.mode : null;
    if (wasPicking) {
        leaveMode();
    }
    // Any command other than looking around puts an open feature panel away
    const wasFeature = activeFeature ? activeFeature.kind : null;
    if (activeFeature && !/^(nav|view|style|proj)\./.test(id)) {
        activeFeature.tool.cancel();
    }
    // ... and an open Measure or Section panel (a section stays on)
    const wasInspect = activeInspect ? activeInspect.kind : null;
    if (activeInspect && !/^(nav|view|style|proj)\./.test(id)) {
        closeInspect(true);
    }
    // ... and the Appearance panel (its own button toggles it)
    const wasAppearance = appearanceTool.isOpen();
    if (wasAppearance && !/^(nav|view|style|proj)\./.test(id)) {
        appearanceTool.cancel();
    }
    if (state.env === 'assembly' && assembly.command(id)) {
        return;
    }
    if (state.env === 'drawing' && drawing.command(id)) {
        return;
    }
    if (id === 'app.appearance') {
        if (!wasAppearance && state.env === 'part') {
            if (sketcher.isOpen()) {
                finishSketch();
            }
            appearanceTool.start();
            ribbon.setOn('app.appearance', true);
        }
        return;
    }

    if (id === 'sketch.start') {
        if (wasPicking === 'pick-sketch-plane' || state.mode === 'sketch') {
            return; // second click cancels the pick; already sketching does nothing
        }
        startPlanePick('pick-sketch-plane', 'sketch.start', 'to create sketch');
    } else if (id === 'nav.lookat') {
        if (wasPicking !== 'pick-lookat') {
            startPlanePick('pick-lookat', 'nav.lookat', 'to look at');
        }
    } else if (id === 'sketch.finish') {
        finishSketch();
    } else if (id === 'work.plane') {
        // First the plane or face to offset from, then the panel
        if (wasPicking !== 'pick-workplane' && wasFeature !== 'plane') {
            if (sketcher.isOpen()) {
                finishSketch();
            }
            startPlanePick('pick-workplane', 'work.plane', 'to offset a work plane from');
        }
    } else if (id.indexOf('pat.') === 0) {
        const kind = { rect: 'rectpattern', circ: 'circpattern', mirror: 'mirror' }[id.slice(4)];
        if (kind && wasFeature !== kind) {
            startFeature(kind, null);
        }
    } else if (id.indexOf('feat.') === 0 && featureTools[id.slice(5)]) {
        if (wasFeature !== id.slice(5)) {
            startFeature(id.slice(5), null); // a second click on the button only closed the panel
        }
    } else if (state.mode === 'sketch' && id === 'sk.construction') {
        sketcher.toggleConstruction();
    } else if (state.mode === 'sketch' && id.indexOf('con.') === 0) {
        // A second click on the active constraint tool puts it away
        if (activeTool === 'con:' + id.slice(4)) {
            sketcher.setTool('select');
        } else {
            sketcher.constrain(id.slice(4));
        }
    } else if (state.mode === 'sketch' && id.indexOf('sk.') === 0 && TOOL_BUTTONS[id.slice(3)]) {
        const tool = id.slice(3);
        sketcher.setTool(activeTool === tool ? 'select' : tool);
    } else if (id === 'nav.zoomall') {
        viewport.zoomAll();
    } else if (id === 'nav.home') {
        viewport.home();
    } else if (id === 'view.origin') {
        state.originVisible = !state.originVisible;
        ribbon.setOn('view.origin', state.originVisible);
        viewport.setOriginVisible(state.originVisible);
    } else if (id === 'section.end') {
        // "End Section View" puts the model back whole
        viewport.setSection('none');
        ribbon.setLabel('view.section', 'Section View');
        setStatus('Section view ended');
    } else if (id.indexOf('section.') === 0) {
        startInspect('section', id.slice(8));
    } else if (id === 'nav.pan' || id === 'nav.orbit') {
        // Clicking the active one gives the left button back to selecting
        const mode = id.slice(4);
        setLeftDrag(state.leftDrag === mode ? 'select' : mode);
        setStatus(state.leftDrag === 'select' ? 'Ready' : (mode === 'orbit' ? 'Orbit' : 'Pan') + ': drag with the left button. Esc or the button again to stop.');
    } else if (id === 'ins.mass') {
        showMassProperties();
    } else if (id === 'ins.measure') {
        if (wasInspect !== 'measure') {
            startInspect('measure');
        }
    } else if (id.indexOf('style.') === 0) {
        viewport.setVisualStyle(id.slice(6));
    } else if (id.indexOf('proj.') === 0) {
        viewport.setProjection(id.slice(5));
        ribbon.setLabel('view.projection', id === 'proj.perspective' ? 'Perspective' : 'Orthographic');
    } else if (id === 'diag.selftest') {
        runSelfTest();
    } else if (id === 'file.new') {
        newDocument();
    } else if (id === 'file.open') {
        openDocument();
    } else if (id === 'file.save') {
        saveDocument(false);
    } else if (id === 'file.saveas') {
        saveDocument(true);
    } else if (id.indexOf('export.') === 0) {
        exportPart(id.slice(7));
    } else if (id === 'import.step') {
        importStep();
    } else if (id === 'file.sample') {
        loadDocument(sampleDocument(), sampleName('Sample Part'), '');
    } else if (id === 'file.sampledrw') {
        if (loadDocument(sampleDrawing(), sampleName('Sample Drawing'), '')) {
            setStatus('Sample Drawing: views of the sample part and assembly with dimensions. Double click anything to edit it; Annotate > Dimension adds more.');
        }
    } else if (id === 'file.sampleasm') {
        if (loadDocument(sampleAssembly(), sampleName('Sample Assembly'), '')) {
            setStatus('Sample Assembly: a plate, two inserted pins and a block mated and flush. Try Free Move on a pin, or Inspect > Degrees of Freedom.');
        }
    } else if (id === 'edit.undo' || id === 'edit.redo') {
        const label = id === 'edit.undo' ? activeDoc().undo() : activeDoc().redo();
        if (label) {
            setStatus((id === 'edit.undo' ? 'Undo: ' : 'Redo: ') + label);
        }
    } else {
        const command = ribbon.find(id);
        if (command && command.planned) {
            setStatus(command.label + ' is not built yet. Planned for ' + command.planned + ', see PROPOSAL.md.');
        } else {
            setStatus('This command is not built yet, see PROPOSAL.md.');
        }
    }
}

document.addEventListener('keydown', function (event) {
    const typing = event.target instanceof Element && event.target.closest('input, textarea');
    if (typing || document.querySelector('.veil')) {
        return; // typing in a field, or a dialog is open
    }
    if (appearanceTool.isOpen() && event.key === 'Escape') {
        appearanceTool.cancel();
        event.preventDefault();
        return;
    }
    if (activeInspect && activeInspect.tool.handleKey(event)) {
        event.preventDefault();
        return;
    }
    if (state.env === 'assembly' && !(event.ctrlKey || event.metaKey) && assembly.handleKey(event)) {
        event.preventDefault();
        return;
    }
    if (state.env === 'drawing' && !(event.ctrlKey || event.metaKey) && drawing.handleKey(event)) {
        event.preventDefault();
        return;
    }
    if (state.mode === 'feature' && activeFeature && activeFeature.tool.handleKey(event)) {
        event.preventDefault();
        return;
    }
    // An open sketch gets the first go: typed sizes, Esc, Delete
    if (state.mode === 'sketch' && sketcher.handleKey(event)) {
        event.preventDefault();
        return;
    }
    const ctrl = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    let command = null;
    if (ctrl && key === 'z') {
        command = event.shiftKey ? 'edit.redo' : 'edit.undo';
    } else if (ctrl && key === 'y') {
        command = 'edit.redo';
    } else if (ctrl && key === 's') {
        command = event.shiftKey ? 'file.saveas' : 'file.save';
    } else if (ctrl && key === 'o') {
        command = 'file.open';
    } else if (key === 'home') {
        command = 'nav.home';
    }
    if (command) {
        event.preventDefault();
        onCommand(command);
        return;
    }
    if (key === 'f4' && !event.repeat && state.leftDrag !== 'orbit') {
        // Held down, F4 turns the left button into orbit, as in Inventor
        event.preventDefault();
        heldOrbit = state.leftDrag;
        setLeftDrag('orbit');
        return;
    }
    if (key === 'escape' && state.leftDrag !== 'select') {
        setLeftDrag('select');
        setStatus('Ready');
        return;
    }
    if (key === 'escape') {
        closeMenu();
        if (picking()) {
            leaveMode();
            setStatus('Ready');
        } else if (state.mode === 'model') {
            viewport.clearSelection();
        }
    } else if (state.env === 'part' && state.mode === 'model' && browser.selected()) {
        if (key === 'delete') {
            deleteFeature(browser.selected());
        } else if (key === 'f2') {
            event.preventDefault();
            browser.startRename(browser.selected());
        }
    }
});

let heldOrbit = null;   // what the left button did before F4 was pressed
document.addEventListener('keyup', function (event) {
    if (event.key === 'F4' && heldOrbit !== null) {
        setLeftDrag(heldOrbit);
        heldOrbit = null;
    }
});

/* ================= engines ================= */
const kernel = createKernel({
    onReady: function (ms) {
        state.kernelReady = true;
        setEngine('status-kernel', 'ok', 'OpenCascade geometry kernel ready (started in ' + (ms / 1000).toFixed(1) + ' s)');
        $('splash').hidden = true;
    },
    onFailed: function (error) {
        setEngine('status-kernel', 'bad', 'The geometry kernel failed to start: ' + error);
        $('splash-text').textContent = 'The modelling kernel could not be loaded';
        document.querySelector('#splash .spinner').style.display = 'none';
        setStatus('The modelling kernel could not be loaded: ' + error);
    }
});

function featureOptions(kind) {
    return {
        kind: kind,
        stage: $('stage'),
        viewport: viewport,
        kernel: kernel,
        doc: doc,
        onStatus: setStatus,
        onClose: function () {
            featureClosed(kind);
        }
    };
}
const featureTools = {
    extrude: createExtrude(featureOptions('extrude')),
    revolve: createRevolve(featureOptions('revolve')),
    shell: createShell(featureOptions('shell')),
    rectpattern: createPattern(Object.assign(featureOptions('rectpattern'), { kind: 'rect' })),
    circpattern: createPattern(Object.assign(featureOptions('circpattern'), { kind: 'circ' })),
    mirror: createPattern(Object.assign(featureOptions('mirror'), { kind: 'mirror' })),
    fillet: createEdgeFeature(featureOptions('fillet')),
    chamfer: createEdgeFeature(featureOptions('chamfer')),
    hole: createHole(featureOptions('hole')),
    plane: createWorkPlane(Object.assign(featureOptions('plane'), {
        onDraft: function (frame, editing) {
            draftPlane = frame ? { frame: frame, id: editing || null } : null;
            refreshWorkPlanes();
        }
    }))
};

// The assembly environment (js/assembly/), and the Measure and Section
// View panels both environments share
const assembly = createAssembly({
    viewport: viewport,
    kernel: kernel,
    files: files,
    ribbon: ribbon,
    stage: $('stage'),
    canvas: $('viewport'),
    tree: $('asm-tree'),
    setStatus: setStatus,
    setPrompt: setPrompt,
    ask: ask,
    tell: tell,
    onChange: refreshChrome,
    // Open Part: the part's file in a tab of this window
    openPath: function (path) {
        files.readPath(path).then(function (file) {
            if (loadDocument(file.data, file.name, file.path)) {
                setStatus('Opened ' + path + ' in a tab. Changes show in the assembly when its tab is shown again.');
            }
        }).catch(function (err) {
            fail('The part could not be opened', err);
        });
    }
});
const drawing = createDrawing({
    viewport: viewport,
    kernel: kernel,
    files: files,
    ribbon: ribbon,
    stage: $('stage'),
    canvas: $('viewport'),
    sheetHost: $('sheet-stage'),
    tree: $('drw-tree'),
    setStatus: setStatus,
    setPrompt: setPrompt,
    ask: ask,
    tell: tell,
    openMenu: openMenu,
    onCommand: function (id) {
        onCommand(id);
    },
    onChange: refreshChrome,
    onShow3D: function (on) {
        showSheetChrome(!on);
    }
});
const measurePart = createMeasure({
    stage: $('stage'),
    viewport: viewport,
    onStatus: setStatus,
    measure: partDistance,
    onClose: function () {
        inspectClosed('measure');
    }
});
const measureAssembly = createMeasure({
    stage: $('stage'),
    viewport: viewport,
    onStatus: setStatus,
    components: true,
    measure: function (a, b) {
        return assembly.measure(a, b);
    },
    name: function (item) {
        return assembly.nameOf(item);
    },
    onClose: function () {
        inspectClosed('measure');
    }
});
const appearanceTool = createAppearancePanel({
    stage: $('stage'),
    viewport: viewport,
    doc: doc,
    onStatus: setStatus,
    onClose: function () {
        ribbon.setOn('app.appearance', false);
    }
});
const sectionPanel = createSectionPanel({
    stage: $('stage'),
    viewport: viewport,
    onStatus: setStatus,
    onClose: function () {
        inspectClosed('section');
    }
});

solver.selfTest().then(function (result) {
    if (result.ok) {
        setEngine('status-solver', 'ok', 'planegcs sketch solver ready (test sketch solved in ' + result.ms.toFixed(1) + ' ms)');
    } else {
        setEngine('status-solver', 'bad', 'The sketch solver returned a wrong answer on its test sketch');
    }
}).catch(function (err) {
    setEngine('status-solver', 'bad', 'The sketch solver failed to start: ' + (err && err.message ? err.message : err));
});

/* ================= start ================= */
// The first tab: an empty part, until a file is opened into its place
const firstTab = { id: 't' + (++tabSeq), kind: 'part', snap: null, view: null };
tabs.push(firstTab);
activeTab = firstTab;
kernel.call('useRebuilder', { key: 'part:' + firstTab.id }).catch(function () {
    // The kernel failed to start; the status bar says so
});
initTheme();
browser.render();
refreshSketches();
refreshWorkPlanes();
ribbon.setMode('part');
refreshChrome();
ribbon.showTab('model');

// A part handed over by the File Manager ("Open with 3D Modeler")
const launch = files.launchPath();
if (launch && /\.(step|stp)$/i.test(launch)) {
    // A STEP file opened with 3D Modeler starts a new part with it imported
    files.readText(launch).then(function (file) {
        loadDocument(null, file.name.replace(/\.[^.]+$/, ''), '');
        return addImport(file);
    }).catch(function (err) {
        fail('The file could not be imported', err);
    });
} else if (launch) {
    // A part or an assembly: loadDocument goes by the file's format
    files.readPath(launch).then(function (file) {
        if (loadDocument(file.data, file.name, file.path)) {
            setStatus('Opened ' + file.path);
        }
    }).catch(function (err) {
        fail('The file could not be opened', err);
    });
}
