/*
    3D Modeler - Move Rotate Scale panel (assemblies)

    Places one component by hand: drag the triad in the view (arrows and
    squares move, rings turn, the centre cube scales evenly) or type where
    it goes: position, turns about X, Y and Z (in that order) and size.
    Snap moves in 1 mm, 15 degree and 0.1x steps. Constraints still hold:
    a component that is constrained only goes where its constraints let it,
    and what is constrained to it follows. OK keeps the new place, Cancel
    puts everything back. Clicking another component in the view keeps
    this one and goes on with that one.

    Scaling is uniform only: a stretched part would turn its holes into
    ellipses, and Insert or Tangent could no longer hold.

    options: stage, viewport, onStatus(text), onClose(),
        component(id) -> the component record
        pivot(id, matrix) -> its centre in the assembly with that placement
        move(id, matrix) -> try a placement; returns where the component
                            really is once the constraints are solved
        commit(label) -> store the moves as one undo step
        revert()      -> drop the moves
*/

import { createPanel } from '../features/panel.js';
import * as G from './geometry.js';

const MODES = { move: 'translate', rotate: 'rotate', scale: 'scale' };

export function createTransform(options) {
    const viewport = options.viewport;
    let open = false;
    let compId = null;
    let current = null;     // the component's placement as shown
    let dragStart = null;   // its placement when the triad was put on it
    let changed = false;

    const panel = createPanel(options.stage, {
        title: 'Move Rotate Scale',
        rows: [
            { type: 'static', key: 'comp', label: 'Component' },
            { type: 'seg', key: 'mode', label: 'Triad', columns: 3, items: [
                { id: 'move', label: 'Move', title: 'Arrows move along an axis, squares in a plane (W)' },
                { id: 'rotate', label: 'Rotate', title: 'Rings turn about an axis (E)' },
                { id: 'scale', label: 'Scale', title: 'Drag a handle to resize evenly (R)' }
            ] },
            { type: 'seg', key: 'space', label: 'Axes', items: [
                { id: 'world', label: 'Assembly', title: 'The triad follows the assembly axes' },
                { id: 'local', label: 'Part', title: 'The triad follows the part\'s own axes' }
            ] },
            { type: 'check', key: 'snap', label: 'Snap: 1 mm, 15 deg, 0.1x' },
            { type: 'section', label: 'Position (origin of the part)' },
            { type: 'number', key: 'x', label: 'X', signed: true },
            { type: 'number', key: 'y', label: 'Y', signed: true },
            { type: 'number', key: 'z', label: 'Z', signed: true },
            { type: 'section', label: 'Rotation (about X, then Y, then Z)' },
            { type: 'number', key: 'rx', label: 'About X', signed: true, unit: 'deg', step: 5 },
            { type: 'number', key: 'ry', label: 'About Y', signed: true, unit: 'deg', step: 5 },
            { type: 'number', key: 'rz', label: 'About Z', signed: true, unit: 'deg', step: 5 },
            { type: 'section', label: 'Size' },
            { type: 'number', key: 'scale', label: 'Scale', unit: 'x', step: 0.1 }
        ],
        onChange: function (key) {
            if (key === 'mode' || key === 'space' || key === 'snap') {
                attach();
                return;
            }
            typed();
        },
        onAction: function () {},
        onOk: function () {
            close(true);
        },
        onCancel: function () {
            close(false);
        }
    });

    // A typed value the constraints did not allow goes back to the real
    // one when the box is left
    panel.element().addEventListener('focusout', function (event) {
        if (open && event.target.classList.contains('props-input')) {
            setTimeout(function () {
                if (open) {
                    fill();
                }
            }, 0);
        }
    });

    function fill() {
        const d = G.decompose(current);
        panel.set('x', d.position[0]);
        panel.set('y', d.position[1]);
        panel.set('z', d.position[2]);
        panel.set('rx', +d.degrees[0].toFixed(3));
        panel.set('ry', +d.degrees[1].toFixed(3));
        panel.set('rz', +d.degrees[2].toFixed(3));
        panel.set('scale', +d.scale.toFixed(4));
    }

    function attach() {
        if (!open) {
            return;
        }
        dragStart = current.slice();
        const snap = panel.get('snap') ? { move: 1, turn: 15, scale: 0.1 } : null;
        viewport.attachGizmo({
            position: options.pivot(compId, current),
            rotation: G.rotationOf(current),
            mode: MODES[panel.get('mode')],
            space: panel.get('space'),
            snap: snap
        }, dragged);
    }

    function report(target) {
        // Where the constraints let it go, against where it was asked to go
        const gap = G.length(G.sub(G.translationOf(target), G.translationOf(current)));
        panel.note(gap > 0.01 ? 'Constraints hold this component: it only moves where they let it.' : 'Drag the triad, or type a position, a rotation or a size.');
    }

    function dragged(delta, done) {
        const target = G.multiply(delta, dragStart);
        current = options.move(compId, target);
        changed = true;
        fill();
        report(target);
        if (done) {
            attach(); // the triad goes to where the component ended up
        }
    }

    function typed() {
        const values = ['x', 'y', 'z', 'rx', 'ry', 'rz'].map(function (k) {
            return +panel.get(k);
        });
        const s = +panel.get('scale');
        if (!values.every(isFinite) || !(s > 0)) {
            return;
        }
        const target = G.compose(values.slice(0, 3), values.slice(3), s);
        current = options.move(compId, target);
        changed = true;
        report(target);
        attach();
    }

    function start(id) {
        const comp = options.component(id);
        if (!comp) {
            return false;
        }
        open = true;
        compId = id;
        current = comp.matrix.slice();
        changed = false;
        panel.text('comp', comp.name + (comp.grounded ? ' (grounded)' : ''));
        if (!panel.get('mode')) {
            panel.set('mode', 'move');
            panel.set('space', 'world');
        }
        fill();
        panel.note('Drag the triad, or type a position, a rotation or a size.');
        panel.ok(true);
        panel.show();
        attach();
        return true;
    }

    // Go on with another component, keeping what was done to this one
    function retarget(id) {
        if (!open || id === compId) {
            return;
        }
        if (changed) {
            options.commit('Move ' + options.component(compId).name);
        }
        start(id);
    }

    function close(keep) {
        if (!open) {
            return;
        }
        open = false;
        viewport.detachGizmo();
        panel.hide();
        if (keep && changed) {
            options.commit('Move ' + options.component(compId).name);
        } else {
            options.revert();
        }
        compId = null;
        options.onClose();
    }

    return {
        start: start,
        retarget: retarget,
        isOpen: function () {
            return open;
        },
        target: function () {
            return compId;
        },
        cancel: function () {
            close(false);
        },
        handleKey: function (event) {
            const key = event.key.toLowerCase();
            if (key === 'escape') {
                close(false);
                return true;
            }
            if (key === 'enter') {
                close(true);
                return true;
            }
            // Shortcuts of most 3D programs for the triad's three modes
            const mode = { w: 'move', e: 'rotate', r: 'scale' }[key];
            if (mode && !event.ctrlKey && !event.metaKey) {
                panel.set('mode', mode);
                attach();
                return true;
            }
            return false;
        }
    };
}
