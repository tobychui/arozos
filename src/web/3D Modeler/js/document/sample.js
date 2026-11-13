/*
    3D Modeler - sample part

    A hand written document in the native format: a rounded plate with a
    through hole and a raised boss. It exists so the document, rebuild, display
    and save paths can be exercised before the sketcher and the feature panels
    are built (File > Sample Part), and it doubles as the format's reference.
*/

export function sampleDocument() {
    return {
        format: 'aopart',
        version: 1,
        units: 'mm',
        features: [
            {
                id: 'f1', type: 'sketch', name: 'Sketch1', plane: { ref: 'origin:xy' },
                geometry: [
                    // 80 x 50 plate outline with 8 mm corner arcs
                    { id: 'p1', type: 'point', x: 8, y: 0 },
                    { id: 'p2', type: 'point', x: 72, y: 0 },
                    { id: 'p3', type: 'point', x: 80, y: 8 },
                    { id: 'p4', type: 'point', x: 80, y: 42 },
                    { id: 'p5', type: 'point', x: 72, y: 50 },
                    { id: 'p6', type: 'point', x: 8, y: 50 },
                    { id: 'p7', type: 'point', x: 0, y: 42 },
                    { id: 'p8', type: 'point', x: 0, y: 8 },
                    { id: 'c1', type: 'point', x: 72, y: 8 },
                    { id: 'c2', type: 'point', x: 72, y: 42 },
                    { id: 'c3', type: 'point', x: 8, y: 42 },
                    { id: 'c4', type: 'point', x: 8, y: 8 },
                    { id: 'l1', type: 'line', p1: 'p1', p2: 'p2' },
                    { id: 'a1', type: 'arc', c: 'c1', start: 'p2', end: 'p3' },
                    { id: 'l2', type: 'line', p1: 'p3', p2: 'p4' },
                    { id: 'a2', type: 'arc', c: 'c2', start: 'p4', end: 'p5' },
                    { id: 'l3', type: 'line', p1: 'p5', p2: 'p6' },
                    { id: 'a3', type: 'arc', c: 'c3', start: 'p6', end: 'p7' },
                    { id: 'l4', type: 'line', p1: 'p7', p2: 'p8' },
                    { id: 'a4', type: 'arc', c: 'c4', start: 'p8', end: 'p1' },
                    // through hole: the extrusion picks the plate around it, not the disc
                    { id: 'h1', type: 'point', x: 20, y: 25 },
                    { id: 'k1', type: 'circle', c: 'h1', r: 6 }
                ],
                constraints: []
            },
            {
                id: 'f2', type: 'extrude', name: 'Extrusion1', sketch: 'f1', regions: [[40, 10]],
                operation: 'join', extent: { type: 'distance', value: 12, direction: 'positive' }
            },
            {
                id: 'f3', type: 'sketch', name: 'Sketch2', plane: { ref: 'origin:xy' },
                geometry: [
                    { id: 'p1', type: 'point', x: 56, y: 25 },
                    { id: 'k1', type: 'circle', c: 'p1', r: 14 },
                    { id: 'k2', type: 'circle', c: 'p1', r: 7 }
                ],
                constraints: []
            },
            {
                id: 'f4', type: 'extrude', name: 'Extrusion2', sketch: 'f3', regions: [[66, 25]],
                operation: 'join', extent: { type: 'distance', value: 28, direction: 'positive' }
            },
            {
                id: 'f5', type: 'sketch', name: 'Sketch3', plane: { ref: 'origin:xz' },
                geometry: [
                    { id: 'p1', type: 'point', x: 56, y: 20 },
                    { id: 'k1', type: 'circle', c: 'p1', r: 3 }
                ],
                constraints: []
            },
            {
                id: 'f6', type: 'extrude', name: 'Extrusion3', sketch: 'f5', regions: [[56, 20]],
                operation: 'cut', extent: { type: 'distance', value: 60, direction: 'negative' }
            }
        ]
    };
}
