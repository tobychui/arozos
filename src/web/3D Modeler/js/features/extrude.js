/*
    3D Modeler - Extrude

    The property panel of the Extrude feature and what goes with it in the
    model: sketch regions to pick as profiles (profiles.js, shared with
    Revolve), a live preview of the solid, and an arrow to pull the
    distance. Used both to make a new extrusion and to edit an existing one.

    Nothing is written to the document until OK: the panel works on a draft
    feature, asks the kernel for a preview of it, and on OK adds it (or
    replaces the edited one) as one undo step.

    Extents (PROPOSAL.md 14.7, 14.26): Distance; To a plane or flat face
    (picked in the model or the browser; one at an angle ends the solid
    slanted); To Next (the first face of the solid ahead); Through All.
    A taper leans the sides in (out when negative) for one-way extents.
    The card beside the panel animates the chosen extent and Boolean.

    createExtrude(options)
        stage       element the panel is added to
        viewport    setRegions(), setPreview(), setArrow()
        kernel      call('regions' | 'preview', ...)
        doc         the document
        onStatus(text)
        onClose(committed)      the panel closed
*/

import { toWorld, withResolvedPlane, planeFrame } from '../kernel/profile.js';
import { evaluate } from '../expr.js';
import { keptFormula } from '../parameters.js';
import { lastExtrudeDistance } from '../document/document.js';
import { wheelStep } from '../ui.js';
import { createProfiles } from './profiles.js';
import { createIllustration } from './illustrate.js';

const DIRECTIONS = [
    { id: 'positive', label: 'Default', title: 'Away from the sketch plane, along its normal' },
    { id: 'negative', label: 'Flipped', title: 'The other way' },
    { id: 'symmetric', label: 'Symmetric', title: 'Half the distance to each side' },
    { id: 'asymmetric', label: 'Asymmetric', title: 'Distance A forwards, distance B backwards' }
];
const EXTENTS = [
    { id: 'distance', label: 'Distance', title: 'As far as the distance you type (or drag the arrow)' },
    { id: 'to', label: 'To', title: 'As far as a plane or flat face you pick' },
    { id: 'next', label: 'To Next', title: 'As far as the first face of the solid ahead' },
    { id: 'all', label: 'Through All', title: 'Right through the whole solid' }
];
const PLANE_NAMES = { 'origin:xy': 'XY Plane', 'origin:xz': 'XZ Plane', 'origin:yz': 'YZ Plane', face: 'a face of the model' };
const OPERATIONS = [
    { id: 'join', label: 'Join', title: 'Add to the solid' },
    { id: 'cut', label: 'Cut', title: 'Remove from the solid' },
    { id: 'intersect', label: 'Intersect', title: 'Keep only what the solid and the extrusion share' },
    { id: 'new', label: 'New Solid', title: 'Make a separate solid body' }
];

function trim(value) {
    return String(+value.toFixed(3));
}

export function createExtrude(options) {
    const viewport = options.viewport;
    const kernel = options.kernel;
    const doc = options.doc;

    /* ================= panel ================= */
    const panel = document.createElement('div');
    panel.className = 'props';
    panel.hidden = true;
    panel.innerHTML =
        '<div class="props-title"><span>Extrusion</span><span class="props-sub" data-el="sketch"></span></div>' +
        '<div class="props-section">Input Geometry</div>' +
        '<div class="props-row"><label>Profiles</label><button class="props-pick" data-el="profiles" title="Click to clear the selection"></button></div>' +
        '<div class="props-row"><label>From</label><span class="props-static">Sketch plane</span></div>' +
        '<div class="props-section">Behavior</div>' +
        '<div class="props-row"><label>Extents</label><div class="seg" data-el="extent"></div></div>' +
        '<div class="props-row" data-el="rowto"><label>To</label><button class="props-pick" data-el="to" title="Click, then pick a plane or flat face in the model or the browser"></button></div>' +
        '<div class="props-row" data-el="rowdir"><label>Direction</label><div class="seg" data-el="direction"></div></div>' +
        '<div class="props-row" data-el="rowa"><label>Distance A</label><input class="props-input" data-el="value" autocomplete="off" spellcheck="false"><span class="props-unit">mm</span></div>' +
        '<div class="props-row" data-el="rowb"><label>Distance B</label><input class="props-input" data-el="value2" autocomplete="off" spellcheck="false"><span class="props-unit">mm</span></div>' +
        '<div class="props-row" data-el="rowtaper"><label>Taper</label><input class="props-input" data-el="taper" autocomplete="off" spellcheck="false" title="Degrees the sides lean in as the solid goes out (negative: out). 0 for straight sides"><span class="props-unit">deg</span></div>' +
        '<div class="props-section">Output</div>' +
        '<div class="props-row"><label>Boolean</label><div class="seg" data-el="operation"></div></div>' +
        '<div class="props-note" data-el="note"></div>' +
        '<div class="props-buttons"><button class="dialog-btn primary" data-el="ok">OK</button><button class="dialog-btn" data-el="cancel">Cancel</button></div>';
    options.stage.appendChild(panel);
    const el = {};
    panel.querySelectorAll('[data-el]').forEach(function (node) {
        el[node.dataset.el] = node;
    });

    // The card beside the panel showing what the chosen Boolean does
    const illus = createIllustration(panel);

    function segmented(host, items, onPick) {
        items.forEach(function (item) {
            const button = document.createElement('button');
            button.className = 'seg-btn';
            button.textContent = item.label;
            button.title = item.title;
            button.dataset.id = item.id;
            button.addEventListener('click', function () {
                onPick(item.id);
            });
            host.appendChild(button);
        });
    }

    /* ================= state ================= */
    let open = false;
    let editId = null;
    const profiles = createProfiles({ viewport: viewport, kernel: kernel, doc: doc, onPick: function () {
        refresh();
    } });
    let draft = null;           // { operation, direction, value, value2, extent, taper, to }
    let picking = false;        // waiting for the "To" plane to be picked
    let directionTouched = false;
    let valid = false;
    let token = 0;              // drops preview answers that arrive late
    let timer = null;
    // The distance last committed in each part this session (key: its path,
    // or its name until it is saved). A new extrusion starts from it, else
    // from the newest distance extrusion in the part, else 10 mm.
    const lastUsed = new Map();

    function partKey() {
        return doc.path || 'unsaved:' + doc.name;
    }

    function startDistance() {
        return lastUsed.get(partKey()) || lastExtrudeDistance(doc.features()) || { value: 10, value2: 10, expr: null, expr2: null };
    }

    function feature() {
        return {
            type: 'extrude',
            sketch: profiles.chosenSketch(),
            regions: profiles.samples(),
            regionCurves: profiles.curveSets(),
            operation: draft.operation,
            extent: extentOf()
        };
    }

    function extentOf() {
        const oneWay = draft.direction === 'positive' || draft.direction === 'negative';
        let e;
        if (draft.extent === 'all') {
            e = { type: 'all', direction: draft.direction === 'asymmetric' ? 'symmetric' : draft.direction };
        } else if (draft.extent === 'next') {
            e = { type: 'next', direction: oneWay ? draft.direction : 'positive' };
        } else if (draft.extent === 'to') {
            e = { type: 'to', plane: draft.to ? draft.to.ref : null };
            // Where the plane is now, for the preview (the rebuild works it out again)
            const frame = draft.to ? planeFrame(draft.to.ref, doc.features()) : null;
            if (frame) {
                e.target = { o: frame.o, n: frame.n };
            }
        } else {
            e = draft.direction === 'asymmetric' ? { type: 'distance', value: draft.value, value2: draft.value2, direction: 'asymmetric' }
                : { type: 'distance', value: draft.value, direction: draft.direction };
            if (draft.valueExpr) {
                e.expr = draft.valueExpr;
            }
            if (draft.direction === 'asymmetric' && draft.value2Expr) {
                e.expr2 = draft.value2Expr;
            }
        }
        if (draft.taper && (draft.extent === 'to' || oneWay)) {
            e.taper = draft.taper;
        }
        return e;
    }

    function planeLabel(ref) {
        if (ref && ref.ref === 'plane') {
            const f = doc.feature(ref.id);
            return f ? f.name : 'a deleted work plane';
        }
        return ref ? PLANE_NAMES[ref.ref] || 'a plane' : '';
    }

    // Wait for the plane the extrusion goes to (the profiles cannot be
    // clicked meanwhile; picking one hands them back)
    function pickTo(on) {
        picking = on;
        if (!on) {
            viewport.stopRefPick();
            return;
        }
        viewport.startRefPick({ planes: true }, function (pick) {
            if (pick.kind !== 'plane') {
                return;
            }
            const ref = options.referenceOf(pick.target);
            draft.to = { ref: ref, label: planeLabel(ref) };
            pickTo(false);
            refresh();
        });
    }

    function note(text, bad) {
        el.note.textContent = text || '';
        el.note.classList.toggle('bad', !!bad);
    }

    function paint() {
        const sketch = profiles.chosenSketch();
        const count = profiles.count();
        el.sketch.textContent = sketch ? doc.feature(sketch).name : '';
        el.profiles.textContent = count ? count + (count === 1 ? ' profile' : ' profiles') : 'Pick a profile in the model';
        el.profiles.classList.toggle('empty', !count);
        el.extent.querySelectorAll('.seg-btn').forEach(function (b) {
            b.classList.toggle('on', b.dataset.id === draft.extent);
        });
        el.direction.querySelectorAll('.seg-btn').forEach(function (b) {
            b.classList.toggle('on', b.dataset.id === draft.direction);
            // To Next goes one way; Through All has no second distance
            b.disabled = (draft.extent === 'all' && b.dataset.id === 'asymmetric') ||
                (draft.extent === 'next' && (b.dataset.id === 'symmetric' || b.dataset.id === 'asymmetric'));
        });
        el.operation.querySelectorAll('.seg-btn').forEach(function (b) {
            b.classList.toggle('on', b.dataset.id === draft.operation);
        });
        // The card shows the extent while it is being chosen, else the Boolean
        illus.show(lastSeg === 'extent' ? 'extent' : 'operation', lastSeg === 'extent' ? draft.extent : draft.operation);
        el.rowto.hidden = draft.extent !== 'to';
        el.to.textContent = draft.to ? draft.to.label : picking ? 'Pick it in the model' : 'Click to pick';
        el.to.classList.toggle('empty', !draft.to);
        el.rowdir.hidden = draft.extent === 'to'; // the side of the plane decides
        el.rowa.hidden = draft.extent !== 'distance';
        el.rowb.hidden = draft.extent !== 'distance' || draft.direction !== 'asymmetric';
        const oneWay = draft.direction === 'positive' || draft.direction === 'negative' || draft.extent === 'to';
        el.taper.disabled = !oneWay;
        el.taper.title = oneWay ? 'Degrees the sides lean in as the solid goes out (negative: out). 0 for straight sides'
            : 'A taper needs a one-way extrusion: Default or Flipped';
        profiles.paint();
    }

    // The arrow stands on the middle of the picked profiles and points the way the solid grows
    function placeArrow() {
        if (!profiles.count() || draft.extent !== 'distance') {
            viewport.setArrow(null);
            return;
        }
        const frame = profiles.frame();
        const u = profiles.centre()[0];
        const v = profiles.centre()[1];
        const sign = draft.direction === 'negative' ? -1 : 1;
        viewport.setArrow({
            origin: toWorld(frame, u, v),
            dir: frame.n.map(function (c) {
                return c * sign;
            }),
            length: draft.direction === 'symmetric' ? draft.value / 2 : draft.value
        }, function (distance) {
            // Pulled through the plane: the extrusion turns round
            if (distance < 0 && (draft.direction === 'positive' || draft.direction === 'negative')) {
                draft.direction = draft.direction === 'positive' ? 'negative' : 'positive';
                directionTouched = true;
            }
            const size = Math.abs(distance) * (draft.direction === 'symmetric' ? 2 : 1);
            draft.value = Math.max(Math.round(size * 4) / 4, 0.25); // the arrow moves in quarter millimetres; type for anything finer
            el.value.value = trim(draft.value);
            refresh();
        });
    }

    function refresh() {
        paint();
        placeArrow();
        clearTimeout(timer);
        const mine = ++token;
        valid = false;
        el.ok.disabled = true;
        if (!profiles.count()) {
            viewport.setPreview(null);
            note('Click a closed area of the sketch to use it as the profile.');
            return;
        }
        if (draft.extent === 'distance' && (!(draft.value > 0) || (draft.direction === 'asymmetric' && !(draft.value2 > 0)))) {
            viewport.setPreview(null);
            note('Enter a distance larger than zero. A formula such as 35/2 works too.', true);
            return;
        }
        if (draft.extent === 'to' && !draft.to) {
            viewport.setPreview(null);
            note('Pick the plane or flat face to extrude to, in the model or the browser.');
            return;
        }
        // A short pause, so typing or dragging does not queue a preview per keystroke
        timer = setTimeout(function () {
            const f = feature();
            kernel.call('preview', { feature: f, sketch: withResolvedPlane(doc.feature(f.sketch), doc.features()), document: doc.data(), at: editId }).then(function (mesh) {
                if (mine !== token || !open) {
                    return;
                }
                viewport.setPreview(mesh, draft.operation);
                valid = true;
                el.ok.disabled = false;
                note('');
            }).catch(function (err) {
                if (mine !== token || !open) {
                    return;
                }
                viewport.setPreview(null);
                note(err.message, true);
            });
        }, 40);
    }

    function setOperation(id) {
        draft.operation = id;
        // A cut usually goes into the material, a join away from it; follow
        // that until the user chooses a direction
        if (!directionTouched && (draft.direction === 'positive' || draft.direction === 'negative')) {
            draft.direction = id === 'cut' || id === 'intersect' ? 'negative' : 'positive';
        }
        refresh();
    }

    function readValue(input, key) {
        const v = evaluate(input.value);
        draft[key] = v > 0 ? v : 0;
        // wall * 2 stays a formula that follows the parameter
        draft[key + 'Expr'] = v > 0 ? keptFormula(input.value) : null;
        input.classList.toggle('bad', !(v > 0));
        refresh();
    }

    let lastSeg = 'operation'; // the row the card shows
    segmented(el.extent, EXTENTS, function (id) {
        draft.extent = id;
        lastSeg = 'extent';
        if (id === 'next' && (draft.direction === 'symmetric' || draft.direction === 'asymmetric')) {
            draft.direction = 'positive';
        }
        if (id === 'all' && draft.direction === 'asymmetric') {
            draft.direction = 'symmetric';
        }
        pickTo(id === 'to' && !draft.to);
        refresh();
    });
    segmented(el.direction, DIRECTIONS, function (id) {
        draft.direction = id;
        directionTouched = true;
        refresh();
    });
    segmented(el.operation, OPERATIONS, function (id) {
        lastSeg = 'operation';
        setOperation(id);
    });
    illus.attachSeg(el.operation, 'operation');
    illus.attachSeg(el.extent, 'extent');
    el.to.addEventListener('click', function () {
        pickTo(true);
        refresh();
    });
    wheelStep(el.taper, { min: -60, max: 60, step: 1 });
    el.taper.addEventListener('input', function () {
        const v = evaluate(el.taper.value || '0');
        const ok = isFinite(v) && Math.abs(v) < 89;
        el.taper.classList.toggle('bad', !ok);
        if (ok) {
            draft.taper = v;
            refresh();
        }
    });
    wheelStep(el.value, { min: 0, above: true });
    wheelStep(el.value2, { min: 0, above: true });
    el.value.addEventListener('input', function () {
        readValue(el.value, 'value');
    });
    el.value2.addEventListener('input', function () {
        readValue(el.value2, 'value2');
    });
    // Leaving the box replaces a formula by its result
    [[el.value, 'value'], [el.value2, 'value2']].forEach(function (pair) {
        pair[0].addEventListener('blur', function () {
            if (draft && draft[pair[1]] > 0) {
                pair[0].value = trim(draft[pair[1]]);
            }
        });
    });
    el.profiles.addEventListener('click', function () {
        profiles.clear();
        refresh();
    });
    el.ok.addEventListener('click', commit);
    el.cancel.addEventListener('click', function () {
        close(false);
    });
    panel.addEventListener('keydown', function (event) {
        // Keys typed in the panel belong to it, not to the app shortcuts
        event.stopPropagation();
        if (event.key === 'Enter') {
            event.preventDefault();
            commit();
        } else if (event.key === 'Escape') {
            close(false);
        }
    });

    // The panel can be moved out of the way by its title
    const title = panel.querySelector('.props-title');
    let grip = null;
    title.addEventListener('pointerdown', function (event) {
        grip = [event.clientX - panel.offsetLeft, event.clientY - panel.offsetTop];
        title.setPointerCapture(event.pointerId);
    });
    title.addEventListener('pointermove', function (event) {
        if (!grip) {
            return;
        }
        const host = options.stage;
        panel.style.left = Math.max(0, Math.min(event.clientX - grip[0], host.clientWidth - panel.offsetWidth)) + 'px';
        panel.style.top = Math.max(0, Math.min(event.clientY - grip[1], host.clientHeight - 40)) + 'px';
    });
    title.addEventListener('pointerup', function () {
        grip = null;
    });

    /* ================= open / close ================= */
    function close(committed) {
        if (!open) {
            return;
        }
        open = false;
        token++;
        clearTimeout(timer);
        panel.hidden = true;
        illus.stop();
        pickTo(false);
        profiles.stop();
        viewport.setPreview(null);
        viewport.setArrow(null);
        options.onClose(committed);
    }

    function commit() {
        if (!open || !valid) {
            return;
        }
        const made = feature();
        delete made.extent.target; // worked out again by every rebuild
        const editing = editId;
        if (made.extent.type === 'distance') {
            lastUsed.set(partKey(), lastExtrudeDistance([made]));
        }
        // Close first: the document change below starts a rebuild, and the
        // app treats a change while the panel is open as "cancel it"
        close(true);
        if (editing) {
            const old = doc.feature(editing);
            doc.change('Edit ' + old.name, function () {
                old.sketch = made.sketch;
                old.regions = made.regions;
                old.regionCurves = made.regionCurves;
                old.operation = made.operation;
                old.extent = made.extent;
            });
        } else {
            made.id = doc.newId();
            made.name = doc.newName('extrude');
            const ordered = { id: made.id, type: 'extrude', name: made.name, sketch: made.sketch, regions: made.regions, regionCurves: made.regionCurves, operation: made.operation, extent: made.extent };
            doc.change(made.name, function (d) {
                d.features.push(ordered);
            });
        }
    }

    // Start a new extrusion (featureId null) or edit an existing one.
    // Resolves to false, with a status message, when there is nothing to extrude.
    function start(featureId) {
        close(false);
        const editing = featureId ? doc.feature(featureId) : null;
        // A new extrusion can use any sketch nothing is built from yet
        return profiles.load(editing, 'Extrude').then(function (loaded) {
            if (!loaded.ok) {
                options.onStatus(loaded.message);
                return false;
            }
            editId = editing ? editing.id : null;
            directionTouched = !!editing;
            if (editing) {
                const extent = editing.extent || {};
                draft = {
                    operation: editing.operation || 'join',
                    direction: extent.direction || 'positive',
                    value: extent.value > 0 ? extent.value : 10,
                    value2: extent.value2 > 0 ? extent.value2 : 10,
                    valueExpr: typeof extent.expr === 'string' ? extent.expr : null,
                    value2Expr: typeof extent.expr2 === 'string' ? extent.expr2 : null,
                    extent: ['to', 'next', 'all'].indexOf(extent.type) >= 0 ? extent.type : 'distance',
                    taper: Number(extent.taper) || 0,
                    to: extent.type === 'to' && extent.plane ? { ref: extent.plane, label: planeLabel(extent.plane) } : null
                };
            } else {
                const last = startDistance();
                draft = {
                    operation: 'join', direction: 'positive', value: last.value, value2: last.value2,
                    valueExpr: last.expr, value2Expr: last.expr2, extent: 'distance', taper: 0, to: null
                };
            }
            lastSeg = 'operation';
            el.taper.value = trim(draft.taper);
            el.taper.classList.remove('bad');
            el.value.value = draft.valueExpr || trim(draft.value);
            el.value2.value = draft.value2Expr || trim(draft.value2);
            el.value.classList.remove('bad');
            el.value2.classList.remove('bad');
            panel.querySelector('.props-title span').textContent = editing ? editing.name : 'Extrusion';
            open = true;
            panel.hidden = false;
            illus.resume();
            refresh();
            el.value.focus();
            el.value.select();
            return true;
        });
    }

    return {
        start: start,
        isOpen: function () {
            return open;
        },
        cancel: function () {
            close(false);
        },
        // Enter and Esc when the focus is outside the panel
        handleKey: function (event) {
            if (!open) {
                return false;
            }
            if (event.key === 'Enter') {
                commit();
                return true;
            }
            if (event.key === 'Escape') {
                close(false);
                return true;
            }
            return false;
        }
    };
}
