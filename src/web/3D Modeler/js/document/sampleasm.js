/*
    3D Modeler - sample assembly

    File > Sample Assembly: a plate with two holes, two headed pins inserted
    in them and a block mated on top and flush with two sides. The parts are
    kept inside the assembly file (parts[].data), so it opens anywhere,
    without files on the server. It is also the format's reference.

    Each constraint entity lists its geometry in the part's own coordinates;
    pick.index -1 means "find it by its geometry" (geometry.js matchEntity),
    which the app does whenever it loads the parts.
*/

import { identity, compose } from '../assembly/geometry.js';
import { PALETTE } from '../assembly/document.js';

function rect(x0, y0, x1, y1) {
    return [
        { id: 'p1', type: 'point', x: x0, y: y0 },
        { id: 'p2', type: 'point', x: x1, y: y0 },
        { id: 'p3', type: 'point', x: x1, y: y1 },
        { id: 'p4', type: 'point', x: x0, y: y1 },
        { id: 'l1', type: 'line', p1: 'p1', p2: 'p2' },
        { id: 'l2', type: 'line', p1: 'p2', p2: 'p3' },
        { id: 'l3', type: 'line', p1: 'p3', p2: 'p4' },
        { id: 'l4', type: 'line', p1: 'p4', p2: 'p1' }
    ];
}

function part(features) {
    return { format: 'aopart', version: 1, units: 'mm', features: features };
}

function sketch(id, geometry) {
    return { id: id, type: 'sketch', name: 'Sketch' + id.slice(1), plane: { ref: 'origin:xy' }, geometry: geometry, constraints: [] };
}

function extrude(id, sketchId, at, value) {
    return { id: id, type: 'extrude', name: 'Extrusion' + id.slice(1), sketch: sketchId, regions: [at], operation: 'join', extent: { type: 'distance', value: value, direction: 'positive' } };
}

// 80 x 50 x 8 plate with two 8 mm holes on its middle line
export function samplePlate() {
    return part([
        sketch('f1', rect(0, 0, 80, 50).concat([
            { id: 'h1', type: 'point', x: 20, y: 32 },
            { id: 'k1', type: 'circle', c: 'h1', r: 4 },
            { id: 'h2', type: 'point', x: 60, y: 32 },
            { id: 'k2', type: 'circle', c: 'h2', r: 4 }
        ])),
        extrude('f2', 'f1', [40, 10], 8)
    ]);
}

// A pin: 14 mm head, 4 mm thick, and an 8 mm shaft 30 mm long overall
export function samplePin() {
    return part([
        sketch('f1', [{ id: 'c', type: 'point', x: 0, y: 0 }, { id: 'k', type: 'circle', c: 'c', r: 7 }]),
        extrude('f2', 'f1', [0, 0], 4),
        sketch('f3', [{ id: 'c', type: 'point', x: 0, y: 0 }, { id: 'k', type: 'circle', c: 'c', r: 4 }]),
        extrude('f4', 'f3', [0, 0], 30)
    ]);
}

// A 30 x 20 x 12 block
export function sampleBlock() {
    return part([
        sketch('f1', rect(0, 0, 30, 20)),
        extrude('f2', 'f1', [15, 10], 12)
    ]);
}

function ent(comp, kind, geometry, type) {
    return Object.assign({ comp: comp, kind: kind, pick: { type: type || (kind === 'circle' || kind === 'line' ? 'edge' : 'face'), body: 0, index: -1 } }, geometry);
}

export function sampleAssembly() {
    const holeTop = function (x) {
        return ent('c1', 'circle', { o: [x, 32, 8], d: [0, 0, 1], r: 4 });
    };
    // The rim where the shaft leaves the head, pointing out of the head
    const pinRim = function (comp) {
        return ent(comp, 'circle', { o: [0, 0, 4], d: [0, 0, 1], r: 4 });
    };
    // A pin turned over, head down on the plate, shaft in the hole
    const pinAt = function (x) {
        return compose([x, 32, 12], [180, 0, 0], 1);
    };
    return {
        format: 'aoasm',
        version: 1,
        units: 'mm',
        parts: {
            p1: { name: 'Plate', data: samplePlate() },
            p2: { name: 'Pin', data: samplePin() },
            p3: { name: 'Block', data: sampleBlock() }
        },
        components: [
            { id: 'c1', name: 'Plate:1', part: 'p1', matrix: identity(), grounded: true, color: PALETTE[0] },
            { id: 'c2', name: 'Pin:1', part: 'p2', matrix: pinAt(20), color: PALETTE[1] },
            { id: 'c3', name: 'Pin:2', part: 'p2', matrix: pinAt(60), color: PALETTE[1] },
            { id: 'c4', name: 'Block:1', part: 'p3', matrix: compose([50, 0, 8], [0, 0, 0], 1), color: PALETTE[2] }
        ],
        constraints: [
            { id: 'k1', name: 'Insert:1', type: 'insert', solution: 'opposed', offset: 0, a: holeTop(20), b: pinRim('c2') },
            { id: 'k2', name: 'Insert:2', type: 'insert', solution: 'opposed', offset: 0, a: holeTop(60), b: pinRim('c3') },
            { id: 'k3', name: 'Mate:1', type: 'mate', offset: 0,
                a: ent('c1', 'plane', { o: [40, 25, 8], n: [0, 0, 1] }), b: ent('c4', 'plane', { o: [15, 10, 0], n: [0, 0, -1] }) },
            { id: 'k4', name: 'Flush:1', type: 'mate', solution: 'flush', offset: 0,
                a: ent('c1', 'plane', { o: [80, 25, 4], n: [1, 0, 0] }), b: ent('c4', 'plane', { o: [30, 10, 6], n: [1, 0, 0] }) },
            { id: 'k5', name: 'Flush:2', type: 'mate', solution: 'flush', offset: 0,
                a: ent('c1', 'plane', { o: [40, 0, 4], n: [0, -1, 0] }), b: ent('c4', 'plane', { o: [15, 0, 6], n: [0, -1, 0] }) }
        ]
    };
}
