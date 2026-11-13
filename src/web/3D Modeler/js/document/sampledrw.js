/*
    3D Modeler - sample drawing

    File > Sample Drawing: an A3 sheet of the sample part (sample.js) in
    front, top and side views with an isometric view, and the sample
    assembly (sampleasm.js) in an isometric view, with dimensions, a hole
    note, a leader note and the title block filled in. Both models are kept
    inside the drawing, so it works without any files on the server; it is
    also the reference of the .aodrw format.

    The views use first angle projection (ISO): the top view goes below the
    front view, the view from the left on its right.
*/

import { sampleDocument } from './sample.js';
import { sampleAssembly } from './sampleasm.js';
import { defaultSheet } from '../drawing/sheet.js';
import { defaultStyle } from '../drawing/format.js';

export function sampleDrawing() {
    const sheet = defaultSheet();
    sheet.fields = {
        title: 'Sample Part', number: 'SAMPLE-001', author: '3D Modeler', checked: '', revision: 'A',
        date: new Date().toISOString().slice(0, 10), company: 'ArozOS', material: 'Aluminium 6061'
    };
    return {
        format: 'aodrw',
        version: 1,
        sheet: sheet,
        style: defaultStyle(),
        sources: {
            s1: { name: 'Sample Part', kind: 'part', path: '', data: sampleDocument() },
            s2: { name: 'Sample Assembly', kind: 'assembly', path: '', data: sampleAssembly() }
        },
        views: [
            // Front: x right, z up. The plate is 80 long and 12 thick, the boss 28 tall.
            { id: 'v1', name: 'VIEW1', source: 's1', parent: null, dir: [0, -1, 0], xdir: [1, 0, 0], x: 50, y: 195, scale: null, hidden: true, smooth: true, centers: true, label: false, faces: null },
            // Top (first angle: below the front view): x right, y up
            { id: 'v2', name: 'VIEW2', source: 's1', parent: 'v1', rel: 'bottom', x: 50, y: 95, scale: null, hidden: true, smooth: true, centers: true, label: false, faces: null },
            // The view from the left (first angle: on the right of the front view)
            { id: 'v3', name: 'VIEW3', source: 's1', parent: 'v1', rel: 'right', x: 230, y: 195, scale: null, hidden: true, smooth: true, centers: true, label: false, faces: null },
            // Isometric from the top right (first angle: the corner rule is mirrored too)
            { id: 'v4', name: 'VIEW4', source: 's1', parent: 'v1', rel: 'bl', x: 250, y: 120, scale: null, hidden: false, smooth: true, centers: false, label: false, faces: null },
            { id: 'v5', name: 'ASSEMBLY', source: 's2', parent: null, dir: [0.57735, -0.57735, 0.57735], xdir: [0.707107, 0.707107, 0], x: 330, y: 215, scale: 0.75, hidden: false, smooth: true, centers: false, label: true, faces: null }
        ],
        annotations: [
            { id: 'd1', type: 'linear', view: 'v1', p1: [0, 0], p2: [80, 0], orient: 'h', at: [40, -9] },
            { id: 'd2', type: 'linear', view: 'v1', p1: [80, 0], p2: [70, 28], orient: 'v', at: [92, 14] },
            { id: 'd3', type: 'linear', view: 'v1', p1: [0, 0], p2: [0, 12], orient: 'v', at: [-9, 6] },
            { id: 'd4', type: 'linear', view: 'v2', p1: [8, 0], p2: [8, 50], orient: 'v', at: [-12, 25] },
            { id: 'd5', type: 'hole', view: 'v2', c: [20, 25], r: 6, count: 1, at: [-6, 62], fmt: { suffix: ' THRU' } },
            { id: 'd6', type: 'diameter', view: 'v2', c: [56, 25], r: 14, at: [90, 58] },
            { id: 'd7', type: 'radius', view: 'v2', c: [72, 8], r: 8, at: [92, -10] },
            { id: 'd8', type: 'note', view: 'v1', p: [56, 23], at: [104, 40], text: '\u00d86 cross hole', end: 'arrow' },
            { id: 'd9', type: 'text', view: null, at: [20, 40], text: 'Unless stated otherwise:\nbreak sharp edges 0.5 x 45\u00b0' }
        ]
    };
}
