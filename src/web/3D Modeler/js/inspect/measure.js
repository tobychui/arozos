/*
    3D Modeler - Measure panel

    Inspect > Measure, for a part and for an assembly, as Inventor's Measure
    command: click a face or an edge and the panel says what it is (area,
    length, radius); click a second one and it gives the shortest distance
    between them (exact, from the kernel), its X, Y and Z parts and the
    angle between them when both have a direction. A line between the two
    closest points is drawn in the view with the distance beside it. A third
    click starts over from that item. In an assembly, "Whole components"
    measures the gap between two components instead.

    options: stage, viewport, onStatus(text), onClose()
        measure(a, b) -> Promise of { distance, p1, p2 } for two picked
                         items (viewport selection records)
        components    true in an assembly: offer "Whole components"
        name(item)    what to call an item's component (assemblies), or null
*/

import { createPanel } from '../features/panel.js';

function mm(v, digits) {
    return (Math.abs(v) < 5e-7 ? 0 : v).toFixed(digits === undefined ? 3 : digits);
}

function directionOf(item) {
    if (item.kind !== 'face' && item.kind !== 'edge') {
        return null;
    }
    if (item.kind === 'face') {
        return item.type === 'plane' ? { v: item.normal, plane: true } : item.axis ? { v: item.axis.d } : null;
    }
    const c = item.curve;
    if (c && c.type === 'line') {
        const d = [c.b[0] - c.a[0], c.b[1] - c.a[1], c.b[2] - c.a[2]];
        const l = Math.hypot(d[0], d[1], d[2]);
        return l > 1e-12 ? { v: [d[0] / l, d[1] / l, d[2] / l] } : null;
    }
    return c && c.type === 'circle' ? { v: c.n } : null;
}

export function createMeasure(options) {
    const viewport = options.viewport;
    let open = false;
    let picks = [];
    let token = 0;
    const rows = [
        { type: 'static', key: 'p1', label: 'First' },
        { type: 'static', key: 'p2', label: 'Second' }
    ];
    if (options.components) {
        rows.push({ type: 'check', key: 'components', label: 'Whole components' });
    }
    rows.push(
        { type: 'section', label: 'Result' },
        { type: 'static', key: 'distance', label: 'Distance' },
        { type: 'static', key: 'dx', label: 'Delta X' },
        { type: 'static', key: 'dy', label: 'Delta Y' },
        { type: 'static', key: 'dz', label: 'Delta Z' },
        { type: 'static', key: 'angle', label: 'Angle' }
    );
    const panel = createPanel(options.stage, {
        title: 'Measure',
        okLabel: 'Close',
        cancelLabel: 'Restart',
        rows: rows,
        onChange: function (key) {
            if (key === 'components') {
                viewport.setComponentMode(!!wholeComponents());
                restart();
            }
        },
        onAction: function () {},
        onOk: close,
        onCancel: restart
    });

    // Only an assembly's panel has the "Whole components" box
    function wholeComponents() {
        return !!options.components && !!panel.get('components');
    }

    function label(item) {
        let text;
        if (item.kind === 'component') {
            text = 'Component';
        } else if (item.kind === 'edge') {
            const c = item.curve;
            text = c && c.type === 'circle' ? (c.closed ? 'Circle' : 'Arc') + ', R ' + mm(c.r) + ', D ' + mm(c.r * 2) + ' mm'
                : 'Edge, length ' + mm(item.length) + ' mm';
        } else if (item.type === 'cylinder') {
            text = 'Cylinder, R ' + mm(item.radius) + ', D ' + mm(item.radius * 2) + ' mm';
        } else {
            text = (item.type === 'plane' ? 'Plane' : 'Face') + ', area ' + mm(item.area) + ' mm2';
        }
        const owner = options.name ? options.name(item) : null;
        return owner ? owner + ': ' + text : text;
    }

    function clearResult() {
        ['distance', 'dx', 'dy', 'dz', 'angle'].forEach(function (key) {
            panel.text(key, '-');
        });
        viewport.setMeasure(null);
    }

    function show() {
        panel.text('p1', picks[0] ? label(picks[0]) : 'Click a face or an edge', !picks[0]);
        panel.text('p2', picks[1] ? label(picks[1]) : picks[0] ? 'Click a second one' : '-', !!picks[0] && !picks[1]);
        // Keep both picks lit
        viewport.selectItems(picks.map(function (p) {
            return { type: p.kind === 'component' ? 'body' : p.kind, body: p.body, index: p.index };
        }), true);
        clearResult();
        if (picks.length < 2) {
            if (picks[0] && picks[0].kind === 'edge' && picks[0].curve && picks[0].curve.type === 'line') {
                const c = picks[0].curve;
                viewport.setMeasure([{ a: c.a, b: c.b, label: mm(picks[0].length, 2) + ' mm' }]);
            }
            panel.note(picks[0] ? 'Click a second item to measure the distance between them.' : (wholeComponents() ? 'Click two components.' : 'Click faces or edges of the model.'));
            return;
        }
        const da = directionOf(picks[0]);
        const db = directionOf(picks[1]);
        if (da && db) {
            let dot = da.v[0] * db.v[0] + da.v[1] * db.v[1] + da.v[2] * db.v[2];
            // Two faces: the angle between them; lines: the smaller angle
            if (!(da.plane && db.plane)) {
                dot = Math.abs(dot);
            }
            const angle = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;
            panel.text('angle', mm(angle, 2) + ' deg' + (angle < 0.005 || angle > 179.995 ? ' (parallel)' : ''));
        }
        panel.note('Measuring...');
        const mine = ++token;
        options.measure(picks[0], picks[1]).then(function (out) {
            if (mine !== token || !open) {
                return;
            }
            panel.text('distance', mm(out.distance) + ' mm');
            if (out.p1 && out.p2) {
                panel.text('dx', mm(out.p2[0] - out.p1[0]) + ' mm');
                panel.text('dy', mm(out.p2[1] - out.p1[1]) + ' mm');
                panel.text('dz', mm(out.p2[2] - out.p1[2]) + ' mm');
                if (out.distance > 1e-6) {
                    viewport.setMeasure([{ a: out.p1, b: out.p2, label: mm(out.distance, 2) + ' mm' }]);
                }
            }
            panel.note(out.distance < 1e-6 ? 'They touch.' : 'The line in the view joins the two closest points. Click again to start over.');
            options.onStatus('Distance ' + mm(out.distance) + ' mm');
        }).catch(function (err) {
            if (mine === token && open) {
                panel.note(err.message, true);
            }
        });
    }

    function onPick(items) {
        if (!items.length) {
            show(); // a click on nothing keeps the picks
            return;
        }
        const item = items[items.length - 1];
        const same = picks.length === 1 && picks[0].kind === item.kind && picks[0].body === item.body &&
            (item.kind === 'component' ? picks[0].group === item.group : picks[0].index === item.index);
        if (same) {
            show();
            panel.note('That is the first pick again. Click a different face or edge.', true);
            return;
        }
        picks = picks.length >= 2 ? [item] : picks.concat([item]);
        show();
    }

    function restart() {
        picks = [];
        if (open) {
            show();
        }
    }

    function start() {
        open = true;
        picks = [];
        viewport.onSelection = onPick;
        viewport.setPickFilter({ faces: true, edges: true, components: true });
        if (options.components) {
            panel.set('components', false);
            viewport.setComponentMode(false);
        }
        viewport.clearSelection();
        panel.ok(true);
        panel.show();
        show();
        return true;
    }

    function close() {
        if (!open) {
            return;
        }
        open = false;
        token++;
        panel.hide();
        viewport.onSelection = null;
        viewport.setPickFilter(null);
        viewport.setMeasure(null);
        viewport.selectItems([], true);
        options.onClose();
    }

    return {
        start: start,
        isOpen: function () {
            return open;
        },
        cancel: close,
        handleKey: function (event) {
            if (event.key === 'Escape') {
                close();
                return true;
            }
            return false;
        }
    };
}
