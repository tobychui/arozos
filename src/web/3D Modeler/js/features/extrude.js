/*
    3D Modeler - Extrude

    The property panel of the Extrude feature and what goes with it in the
    model: sketch regions to pick as profiles (profiles.js, shared with
    Revolve), a live preview of the solid, and an arrow to pull the
    distance. Used both to make a new extrusion and to edit an existing one.

    Nothing is written to the document until OK: the panel works on a draft
    feature, asks the kernel for a preview of it, and on OK adds it (or
    replaces the edited one) as one undo step.

    createExtrude(options)
        stage       element the panel is added to
        viewport    setRegions(), setPreview(), setArrow()
        kernel      call('regions' | 'preview', ...)
        doc         the document
        onStatus(text)
        onClose(committed)      the panel closed
*/

import { toWorld, withResolvedPlane } from '../kernel/profile.js';
import { evaluate } from '../expr.js';
import { wheelStep } from '../ui.js';
import { createProfiles } from './profiles.js';
import { createIllustration } from './illustrate.js';

const DIRECTIONS = [
    { id: 'positive', label: 'Default', title: 'Away from the sketch plane, along its normal' },
    { id: 'negative', label: 'Flipped', title: 'The other way' },
    { id: 'symmetric', label: 'Symmetric', title: 'Half the distance to each side' },
    { id: 'asymmetric', label: 'Asymmetric', title: 'Distance A forwards, distance B backwards' }
];
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
        '<div class="props-row"><label>Direction</label><div class="seg" data-el="direction"></div></div>' +
        '<div class="props-row"><label>Distance A</label><input class="props-input" data-el="value" autocomplete="off" spellcheck="false"><span class="props-unit">mm</span></div>' +
        '<div class="props-row" data-el="rowb"><label>Distance B</label><input class="props-input" data-el="value2" autocomplete="off" spellcheck="false"><span class="props-unit">mm</span></div>' +
        '<div class="props-row"><label></label><label class="props-check"><input type="checkbox" data-el="all"> Through All</label></div>' +
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
    let draft = null;           // { operation, direction, value, value2, all }
    let directionTouched = false;
    let valid = false;
    let token = 0;              // drops preview answers that arrive late
    let timer = null;

    function feature() {
        return {
            type: 'extrude',
            sketch: profiles.chosenSketch(),
            regions: profiles.samples(),
            operation: draft.operation,
            extent: draft.all ? { type: 'all', direction: draft.direction === 'asymmetric' ? 'symmetric' : draft.direction }
                : draft.direction === 'asymmetric' ? { type: 'distance', value: draft.value, value2: draft.value2, direction: 'asymmetric' }
                    : { type: 'distance', value: draft.value, direction: draft.direction }
        };
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
        el.direction.querySelectorAll('.seg-btn').forEach(function (b) {
            b.classList.toggle('on', b.dataset.id === draft.direction);
            b.disabled = draft.all && b.dataset.id === 'asymmetric';
        });
        el.operation.querySelectorAll('.seg-btn').forEach(function (b) {
            b.classList.toggle('on', b.dataset.id === draft.operation);
        });
        illus.show('operation', draft.operation);
        el.rowb.hidden = draft.direction !== 'asymmetric' || draft.all;
        el.value.disabled = draft.all;
        el.all.checked = draft.all;
        profiles.paint();
    }

    // The arrow stands on the middle of the picked profiles and points the way the solid grows
    function placeArrow() {
        if (!profiles.count() || draft.all) {
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
        if (!draft.all && (!(draft.value > 0) || (draft.direction === 'asymmetric' && !(draft.value2 > 0)))) {
            viewport.setPreview(null);
            note('Enter a distance larger than zero. A formula such as 35/2 works too.', true);
            return;
        }
        // A short pause, so typing or dragging does not queue a preview per keystroke
        timer = setTimeout(function () {
            const f = feature();
            kernel.call('preview', { feature: f, sketch: withResolvedPlane(doc.feature(f.sketch), doc.features()) }).then(function (mesh) {
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
        input.classList.toggle('bad', !(v > 0));
        refresh();
    }

    segmented(el.direction, DIRECTIONS, function (id) {
        draft.direction = id;
        directionTouched = true;
        refresh();
    });
    segmented(el.operation, OPERATIONS, setOperation);
    illus.attachSeg(el.operation, 'operation');
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
    el.all.addEventListener('change', function () {
        draft.all = el.all.checked;
        if (draft.all && draft.direction === 'asymmetric') {
            draft.direction = 'symmetric';
        }
        refresh();
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
        const editing = editId;
        // Close first: the document change below starts a rebuild, and the
        // app treats a change while the panel is open as "cancel it"
        close(true);
        if (editing) {
            const old = doc.feature(editing);
            doc.change('Edit ' + old.name, function () {
                old.sketch = made.sketch;
                old.regions = made.regions;
                old.operation = made.operation;
                old.extent = made.extent;
            });
        } else {
            made.id = doc.newId();
            made.name = doc.newName('extrude');
            const ordered = { id: made.id, type: 'extrude', name: made.name, sketch: made.sketch, regions: made.regions, operation: made.operation, extent: made.extent };
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
                    all: extent.type === 'all'
                };
            } else {
                draft = { operation: 'join', direction: 'positive', value: 10, value2: 10, all: false };
            }
            el.value.value = trim(draft.value);
            el.value2.value = trim(draft.value2);
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
