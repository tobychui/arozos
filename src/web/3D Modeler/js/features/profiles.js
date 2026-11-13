/*
    3D Modeler - sketch profiles

    Picking the closed areas of a sketch as the profile of a feature, shared
    by Extrude and Revolve: the areas of every sketch nothing is built from
    yet are shaded in the model (the kernel cuts the sketch plane along all
    sketch curves, so crossing curves and holes bound areas correctly);
    hover highlights, a click picks or drops one. One feature uses one
    sketch, so picking in another sketch starts over.

    A profile is remembered by a point inside it (`sample`), so it survives
    edits of the sketch as long as an area is still there.

    createProfiles(options)
        viewport    setRegions()
        kernel      call('regions')
        doc         the document
        onPick()    the picked set changed
*/

import { planeFrame, toWorld, withResolvedPlane } from '../kernel/profile.js';

// Is plane point p inside a region (any of its triangles; six numbers each)?
export function insideRegion(region, p) {
    const t = region.triangles;
    for (let i = 0; i < t.length; i += 6) {
        const d1 = (p[0] - t[i + 2]) * (t[i + 1] - t[i + 3]) - (t[i] - t[i + 2]) * (p[1] - t[i + 3]);
        const d2 = (p[0] - t[i + 4]) * (t[i + 3] - t[i + 5]) - (t[i + 2] - t[i + 4]) * (p[1] - t[i + 5]);
        const d3 = (p[0] - t[i]) * (t[i + 5] - t[i + 1]) - (t[i + 4] - t[i]) * (p[1] - t[i + 1]);
        const negative = d1 < -1e-9 || d2 < -1e-9 || d3 < -1e-9;
        const positive = d1 > 1e-9 || d2 > 1e-9 || d3 > 1e-9;
        if (!(negative && positive)) {
            return true;
        }
    }
    return false;
}

export function createProfiles(options) {
    const viewport = options.viewport;
    const doc = options.doc;
    let regions = [];           // [{ sketch, frame, triangles, sample, world }]
    let selected = new Set();   // indices into regions

    function chosenSketch() {
        const first = selected.values().next();
        return first.done ? null : regions[first.value].sketch;
    }

    function paint() {
        viewport.setRegions(regions.map(function (r, i) {
            return { positions: r.world, selected: selected.has(i) };
        }), pick);
    }

    function pick(index) {
        if (selected.has(index)) {
            selected.delete(index);
        } else {
            // One feature is built from one sketch
            if (chosenSketch() && chosenSketch() !== regions[index].sketch) {
                selected.clear();
            }
            selected.add(index);
        }
        options.onPick();
    }

    // Load the areas a feature may use: those of `editing`'s sketch, or of
    // every sketch nothing is built from yet. `what` names the feature for
    // the messages. Resolves to { ok } or { ok: false, message }. The areas
    // the edited feature used are picked again; a single area is picked
    // for a new feature, as there is nothing to choose between.
    function load(editing, what) {
        const used = new Set(doc.features().map(function (f) {
            return f.sketch;
        }));
        const sketches = editing ? [doc.feature(editing.sketch)].filter(Boolean) : doc.features().filter(function (f) {
            return f.type === 'sketch' && !f.suppressed && !used.has(f.id);
        });
        if (!sketches.length) {
            return Promise.resolve({ ok: false, message: editing ? 'The sketch of this feature no longer exists' : what + ' needs a sketch: draw one with Start 2D Sketch first' });
        }
        return Promise.all(sketches.map(function (sketch) {
            return options.kernel.call('regions', { sketch: withResolvedPlane(sketch, doc.features()) }).then(function (out) {
                const frame = planeFrame(sketch.plane, doc.features());
                return out.regions.map(function (region) {
                    const world = new Float32Array(region.triangles.length / 2 * 3);
                    for (let i = 0; i < region.triangles.length / 2; i++) {
                        const p = toWorld(frame, region.triangles[i * 2], region.triangles[i * 2 + 1]);
                        world[i * 3] = p[0];
                        world[i * 3 + 1] = p[1];
                        world[i * 3 + 2] = p[2];
                    }
                    return { sketch: sketch.id, frame: frame, triangles: region.triangles, sample: region.sample, world: world };
                });
            }).catch(function () {
                return []; // a sketch the kernel cannot read offers no profile
            });
        })).then(function (lists) {
            regions = [].concat.apply([], lists);
            selected = new Set();
            if (!regions.length) {
                return { ok: false, message: 'No closed profile to ' + what.toLowerCase() + ': the sketch needs an area that is closed all the way round' };
            }
            if (editing) {
                regions.forEach(function (region, i) {
                    if ((editing.regions || []).some(function (p) {
                        return insideRegion(region, p);
                    })) {
                        selected.add(i);
                    }
                });
            } else if (regions.length === 1) {
                selected.add(0);
            }
            return { ok: true };
        });
    }

    return {
        load: load,
        paint: paint,
        stop: function () {
            viewport.setRegions(null);
        },
        clear: function () {
            selected.clear();
        },
        count: function () {
            return selected.size;
        },
        chosenSketch: chosenSketch,
        // The points that remember the picked areas
        samples: function () {
            return Array.from(selected).map(function (i) {
                return regions[i].sample;
            });
        },
        // The plane of the picked areas, and the middle of their sample points
        frame: function () {
            return selected.size ? regions[selected.values().next().value].frame : null;
        },
        centre: function () {
            let u = 0;
            let v = 0;
            selected.forEach(function (i) {
                u += regions[i].sample[0] / selected.size;
                v += regions[i].sample[1] / selected.size;
            });
            return [u, v];
        }
    };
}
