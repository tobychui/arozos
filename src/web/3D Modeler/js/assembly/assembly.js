/*
    3D Modeler - assembly environment

    Everything that happens while an assembly (.aoasm) is open, wired to the
    same viewport, ribbon, kernel worker and file functions the part
    modeller uses (app.js switches between the two, PROPOSAL.md 14.16):

    - Parts are loaded from their files through the AGI backend (or from the
      assembly itself) and built in the kernel worker, each kept under its
      own key (worker.js partBuild). Their meshes are shown once per
      component, placed by its matrix and drawn in its colour.
    - Clicking in the view picks whole components (viewport component
      mode). Free Move and Free Rotate drag them; Move Rotate Scale shows a
      triad and takes typed values (transform.js); Constrain ties faces and
      edges of two components together (constrain.js). After every change
      the solver (solver.js) moves what is not grounded so every constraint
      holds, and that is one undo step.
    - A drag or a preview is "live": matrices that are shown but not yet in
      the document, until it is committed.

    options: viewport, kernel, files, ribbon, stage, canvas, tree (element),
        setStatus(text), setPrompt(text), ask, tell, onChange(reason)
*/

import { createAssemblyDocument, PALETTE } from './document.js';
import * as G from './geometry.js';
import { solve, freedom, unsatisfied } from './solver.js';
import { createAssemblyBrowser } from './browser.js';
import { createConstrain } from './constrain.js';
import { createTransform } from './transform.js';
import { validate as validatePart } from '../document/document.js';
import { showRelink } from '../io/relink.js';

const ENTITY_NAMES = { plane: 'flat face', cylinder: 'round face', circle: 'round edge', line: 'straight edge', point: 'point' };
const ORIGIN_NAMES = { xy: 'XY Plane', xz: 'XZ Plane', yz: 'YZ Plane', x: 'X Axis', y: 'Y Axis', z: 'Z Axis', o: 'Center Point' };

function mm(v, digits) {
    return (Math.abs(v) < 5e-7 ? 0 : v).toFixed(digits === undefined ? 2 : digits);
}

export function createAssembly(options) {
    const viewport = options.viewport;
    const kernel = options.kernel;
    const files = options.files;
    const ribbon = options.ribbon;
    const setStatus = options.setStatus;
    const doc = createAssemblyDocument();

    let active = false;
    let session = 0;        // bumps on every reset or restore: late results are dropped
    let space = 't1';       // the document tab shown: its parts' kernel keys
    let runtime = {};       // partId -> { status, message, bodies, box, pivot }
    let bodyMap = [];       // viewport body index -> { comp, partBody }
    let live = null;        // { compId: matrix } shown but not yet stored
    let selected = [];      // component ids
    let tool = null;        // "freemove" | "freerotate" | "transform" | "constrain"
    let drag = null;
    let showDof = false;
    let fitNext = false;
    let keepView = false;   // shown again in its tab: keep the view it was left with
    let askMissing = false; // just opened: offer to find part files that are missing
    let interferenceShown = false;

    /* ================= parts ================= */
    // Kernel keys stay the same for a tab, so a part rebuilt when the tab is
    // shown again comes from the kernel's cache
    function partKey(pid) {
        return 'asm:' + space + '/' + pid;
    }

    function pivotOf(comp) {
        const rt = runtime[comp.part];
        return rt && rt.pivot ? rt.pivot : [0, 0, 0];
    }

    function matrixOf(comp) {
        return (live && live[comp.id]) || comp.matrix;
    }

    // Build a part document in the kernel. Resolves to its runtime record.
    function buildPart(pid, data) {
        runtime[pid] = { status: 'loading' };
        const mine = session;
        return kernel.call('partBuild', { key: partKey(pid), document: data }).then(function (result) {
            if (mine !== session) {
                return null;
            }
            if (!result.bodies.length) {
                const failed = Object.keys(result.features).filter(function (id) {
                    return result.features[id].status === 'error';
                }).map(function (id) {
                    return result.features[id].message;
                })[0];
                throw new Error(failed ? 'The part has no solid: ' + failed : 'The part has no solid yet');
            }
            const box = G.boundsOf(result.bodies);
            const rt = { status: 'ok', bodies: result.bodies, box: box, pivot: G.scale(G.add(box[0], box[1]), 0.5), data: data };
            runtime[pid] = rt;
            return rt;
        }).catch(function (err) {
            if (mine === session) {
                runtime[pid] = { status: 'error', message: err.message };
            }
            throw err;
        });
    }

    // The part document of a part entry: kept in the assembly, or read from its file
    function partData(entry) {
        if (entry.data) {
            return Promise.resolve(validatePart(JSON.parse(JSON.stringify(entry.data))));
        }
        if (!entry.path) {
            return Promise.reject(new Error('The part has no file'));
        }
        return files.readPath(entry.path).catch(function (err) {
            err.link = true; // the file is not where the assembly says
            throw err;
        }).then(function (file) {
            return validatePart(file.data);
        });
    }

    // Load (or with `force`, reload) every part the assembly uses, then
    // find the constraint faces again and let the solver settle
    function loadParts(force) {
        const parts = doc.data().parts;
        const wanted = Object.keys(parts).filter(function (pid) {
            return force || !runtime[pid];
        });
        if (!wanted.length) {
            return Promise.resolve();
        }
        const mine = session;
        setStatus('Loading ' + wanted.length + (wanted.length === 1 ? ' part...' : ' parts...'));
        const jobs = wanted.map(function (pid) {
            const key = linkKey(parts[pid]);
            runtime[pid] = { status: 'loading', key: key };
            return partData(parts[pid]).then(function (data) {
                return buildPart(pid, data);
            }).then(function (rt) {
                if (rt) {
                    rt.key = key;
                }
                render();
            }).catch(function (err) {
                if (mine === session) {
                    runtime[pid] = { status: 'error', message: err.message, link: !!err.link, key: key };
                }
                return err;
            });
        });
        refreshBrowser();
        return Promise.all(jobs).then(function (results) {
            if (mine !== session) {
                return;
            }
            const failed = results.filter(function (r) {
                return r instanceof Error;
            });
            // Finding the constraint faces again is bookkeeping: an assembly
            // that was clean stays clean unless a component really moved
            const wasClean = !doc.isDirty();
            const placements = JSON.stringify(doc.components().map(function (c) {
                return c.matrix;
            }));
            refindEntities();
            settle();
            if (wasClean && doc.isDirty() && JSON.stringify(doc.components().map(function (c) {
                return c.matrix;
            })) === placements) {
                doc.markSaved();
            }
            render();
            if (fitNext) {
                fitNext = false;
                viewport.home();
            }
            setStatus(failed.length ? failed.length + (failed.length === 1 ? ' part' : ' parts') + ' could not be loaded: ' + failed[0].message
                : force ? 'Parts reloaded' : 'Ready');
            // Just opened with part files missing: offer to find them
            if (askMissing) {
                askMissing = false;
                if (missingParts().length && active) {
                    relinkParts();
                }
            }
        });
    }

    // Where a part entry points: its file, or the copy kept in the assembly.
    // A loaded part whose entry points elsewhere now (a relink undone or
    // redone) is loaded again.
    function linkKey(entry) {
        return entry && entry.path ? 'path:' + entry.path : 'data';
    }

    // Parts whose file could not be read
    function missingParts() {
        const parts = doc.data().parts;
        return Object.keys(parts).filter(function (pid) {
            return runtime[pid] && runtime[pid].status === 'error' && runtime[pid].link;
        });
    }

    // The Missing Files dialog (io/relink.js) for the parts that are missing
    function relinkParts() {
        const pids = missingParts();
        if (!pids.length) {
            setStatus('Every part of the assembly was found');
            return;
        }
        const parts = doc.data().parts;
        showRelink(pids.map(function (pid) {
            return { id: pid, name: parts[pid].name, path: parts[pid].path, message: runtime[pid].message };
        }), {
            title: 'Missing Parts',
            text: doc.name + ' uses ' + (pids.length === 1 ? 'a part that is' : pids.length + ' parts that are') +
                ' not where it was saved. Select where each one is now; parts moved to the same folder are then found on their own.',
            pick: files.openPartFile,
            read: files.readPath,
            accepts: function (file) {
                return !!file.data && file.data.format === 'aopart';
            },
            apply: function (pid, file) {
                const name = parts[pid] ? parts[pid].name : pid;
                delete runtime[pid]; // read again from the new place
                commit('Relink ' + name, function (d) {
                    const entry = d.parts[pid];
                    if (file.path) {
                        entry.path = file.path;
                        delete entry.data;
                    } else {
                        // Picked outside ArozOS: the part is kept inside the assembly
                        entry.path = '';
                        entry.data = file.data;
                    }
                }, { solve: false });
            }
        });
    }

    // Constraint faces and edges found again on parts that may have changed
    function refindEntities() {
        doc.constraints().forEach(function (c) {
            [c.a, c.b].forEach(function (e) {
                if (!e || !e.comp || !e.pick) {
                    return;
                }
                const comp = doc.component(e.comp);
                const rt = comp && runtime[comp.part];
                const desc = rt && rt.status === 'ok' ? rt.bodies[e.pick.body] : null;
                const found = desc ? G.matchEntity(e, desc) : null;
                if (found) {
                    // Only real moves are written: rounding noise would mark
                    // an assembly as changed just by opening it
                    ['o', 'n', 'd', 'r'].forEach(function (k) {
                        const v = found.entity[k];
                        if (v === undefined) {
                            return;
                        }
                        const differs = Array.isArray(v) ? !Array.isArray(e[k]) || v.some(function (x, i) {
                            return Math.abs(x - e[k][i]) > 1e-7;
                        }) : typeof e[k] !== 'number' || Math.abs(v - e[k]) > 1e-7;
                        if (differs) {
                            e[k] = v;
                        }
                    });
                    if (e.pick.index !== found.index) {
                        e.pick.index = found.index;
                    }
                }
            });
        });
    }

    /* ================= solving ================= */
    function lengthScale() {
        const b = worldBounds();
        return b ? Math.max(10, Math.min(500, G.length(G.sub(b[1], b[0])) / 4)) : 50;
    }

    function worldBounds(skip) {
        let out = null;
        doc.components().forEach(function (comp) {
            const rt = runtime[comp.part];
            if (!rt || rt.status !== 'ok' || comp.hidden || comp.id === skip) {
                return;
            }
            const b = G.transformBox(rt.box, matrixOf(comp));
            out = out ? [[0, 1, 2].map(function (k) {
                return Math.min(out[0][k], b[0][k]);
            }), [0, 1, 2].map(function (k) {
                return Math.max(out[1][k], b[1][k]);
            })] : b;
        });
        return out;
    }

    function solverComponents(list, useLive) {
        return list.map(function (comp) {
            return { id: comp.id, matrix: useLive ? matrixOf(comp) : comp.matrix, grounded: !!comp.grounded, pivot: pivotOf(comp) };
        });
    }

    function clean(m) {
        return m.map(function (v) {
            const r = Math.round(v * 1e10) / 1e10;
            return r === 0 ? 0 : r;
        });
    }

    // Solve the document data in place (inside a change, or after loading)
    function solveInto(d) {
        const out = solve(solverComponents(d.components, false), d.constraints, { lengthScale: lengthScale() });
        d.components.forEach(function (comp) {
            const m = out.matrices[comp.id];
            if (m && m.some(function (v, i) {
                return Math.abs(v - comp.matrix[i]) > 1e-9;
            })) {
                comp.matrix = clean(m);
            }
        });
        return out;
    }

    // After loading: let constraints that no longer hold (a part changed)
    // move their components, without an undo step
    function settle() {
        const comps = solverComponents(doc.components(), false);
        if (Object.keys(unsatisfied(comps, doc.constraints(), { lengthScale: lengthScale() })).length) {
            solveInto(doc.data());
        }
    }

    // One undo step: mutate the data, then solve (unless solve: false)
    function commit(label, mutate, opts) {
        const o = opts || {};
        live = null;
        const changed = doc.change(label, function (d) {
            mutate(d);
            if (o.solve !== false) {
                solveInto(d);
            }
        });
        if (!changed) {
            render();
        }
        return changed;
    }

    // Show matrices without storing them
    function showLive() {
        const list = {};
        bodyMap.forEach(function (entry, i) {
            const comp = doc.component(entry.comp);
            if (comp) {
                list[i] = matrixOf(comp);
            }
        });
        viewport.setBodyMatrices(list);
    }

    // Solve with extra constraints or a drag, and show the result live.
    // fromLive: start from what is shown (a drag going on) rather than
    // from the stored placements (a preview).
    function liveSolve(extra, dragSpec, fromLive) {
        const comps = solverComponents(doc.components(), fromLive);
        const out = solve(comps, doc.constraints().concat(extra || []), { lengthScale: lengthScale(), drag: dragSpec });
        live = out.matrices;
        showLive();
        return out;
    }

    function dropLive() {
        if (live) {
            live = null;
            showLive();
        }
    }

    /* ================= display ================= */
    function colorOf(comp) {
        return parseInt(String(comp.color || PALETTE[0]).replace('#', ''), 16);
    }

    function render() {
        if (!active) {
            return;
        }
        const keep = selected.slice();
        const list = [];
        bodyMap = [];
        let missing = false;
        const parts = doc.data().parts;
        Object.keys(runtime).forEach(function (pid) {
            const rt = runtime[pid];
            if (parts[pid] && rt.key !== undefined && rt.key !== linkKey(parts[pid])) {
                delete runtime[pid];
            }
        });
        doc.components().forEach(function (comp) {
            const rt = runtime[comp.part];
            if (!rt) {
                missing = true;
            }
            if (comp.hidden || !rt || rt.status !== 'ok') {
                return;
            }
            rt.bodies.forEach(function (body, i) {
                list.push(Object.assign({}, body, { matrix: matrixOf(comp), color: colorOf(comp), group: comp.id, appearance: rt.data && rt.data.appearance, partBody: i }));
                bodyMap.push({ comp: comp.id, partBody: i });
            });
        });
        const first = !viewport.bodyCount() && list.length > 0;
        viewport.setBodies(list);
        selected = keep.filter(function (id) {
            return !!doc.component(id);
        });
        if (!tool || tool === 'transform' || tool === 'freemove' || tool === 'freerotate') {
            viewport.selectItems(itemsOf(selected), true);
        }
        if (first && !fitNext && !keepView) {
            viewport.zoomAll();
        }
        if (list.length) {
            keepView = false;
        }
        refreshBrowser();
        if (missing) {
            loadParts(false); // a part brought back by undo, or not loaded yet
        }
    }

    function itemsOf(ids) {
        const out = [];
        ids.forEach(function (id) {
            const index = bodyMap.findIndex(function (m) {
                return m.comp === id;
            });
            if (index >= 0) {
                out.push({ type: 'body', body: index });
            }
        });
        return out;
    }

    const browser = createAssemblyBrowser(options.tree, {
        onSelect: function (ids) {
            select(ids);
        },
        onConstraintSelect: function (id) {
            const c = doc.constraint(id);
            if (c) {
                select([c.a && c.a.comp, c.b && c.b.comp].filter(Boolean));
                setStatus(c.name + describeConstraint(c));
            }
        },
        onComponentAction: componentAction,
        onConstraintAction: constraintAction,
        onOriginHover: function (key) {
            viewport.setHotPlane(key && key.length === 2 ? key : null);
        },
        onOriginClick: function (key) {
            if (tool === 'constrain' && constrain.pickOrigin(key)) {
                return;
            }
            setStatus(ORIGIN_NAMES[key] + ' of the assembly. Open Constrain and click it to constrain a component to it.');
        },
        onHover: function (ids) {
            const map = {};
            (ids || []).forEach(function (id) {
                map[id] = 'hover';
            });
            viewport.setGroupTint(map);
        }
    });

    function refreshBrowser() {
        if (!active) {
            return;
        }
        const comps = solverComponents(doc.components(), true);
        const errors = unsatisfied(comps, doc.constraints(), { lengthScale: lengthScale() });
        const dof = showDof ? freedom(comps, doc.constraints(), { lengthScale: lengthScale() }) : {};
        const partStatus = {};
        Object.keys(runtime).forEach(function (pid) {
            partStatus[pid] = { status: runtime[pid].status, message: runtime[pid].message, link: !!runtime[pid].link };
        });
        browser.render({
            name: doc.name,
            components: doc.components(),
            constraints: doc.constraints(),
            partStatus: partStatus,
            dof: dof,
            errors: errors,
            selected: selected,
            showDof: showDof
        });
    }

    function describeConstraint(c) {
        const parts = [c.a, c.b].map(function (e) {
            const comp = e && e.comp ? doc.component(e.comp) : null;
            return (comp ? comp.name : 'origin') + ' ' + (ENTITY_NAMES[e && e.kind] || 'item');
        });
        const value = c.type === 'angle' ? ', ' + mm(c.angle || 0, 1) + ' deg' : c.offset ? ', offset ' + mm(c.offset) + ' mm' : '';
        return ': ' + parts.join(' and ') + value;
    }

    /* ================= selection ================= */
    function select(ids) {
        selected = ids.filter(function (id) {
            return !!doc.component(id);
        });
        if (tool === 'transform' && selected.length === 1) {
            transform.retarget(selected[0]);
        }
        if (!tool || tool === 'transform' || tool === 'freemove' || tool === 'freerotate') {
            viewport.selectItems(itemsOf(selected), true);
        }
        ribbon.setOn('asm.ground', selected.length > 0 && selected.every(function (id) {
            return doc.component(id).grounded;
        }));
        refreshBrowser();
        statusOfSelection();
    }

    function statusOfSelection() {
        if (!selected.length) {
            setStatus('Ready');
            return;
        }
        if (selected.length === 1) {
            const comp = doc.component(selected[0]);
            const n = doc.constraintsOf(comp.id).length;
            setStatus(comp.name + (comp.grounded ? ', grounded' : '') + ', ' + n + (n === 1 ? ' constraint' : ' constraints'));
            return;
        }
        setStatus(selected.length + ' components selected');
    }

    // Selected components, or a message when a command needs some
    function needSelection(what) {
        if (!selected.length) {
            setStatus(what + ': select a component first (click it in the view or the browser)');
            return null;
        }
        return selected.map(function (id) {
            return doc.component(id);
        });
    }

    /* ================= tools ================= */
    const constrain = createConstrain({
        stage: options.stage,
        viewport: viewport,
        onStatus: setStatus,
        onClose: function () {
            toolClosed('constrain');
        },
        pickOf: pickOf,
        originPick: originPick,
        restorePick: restorePick,
        constraint: function (id) {
            return doc.constraint(id);
        },
        preview: function (record) {
            if (!record) {
                dropLive();
                return null;
            }
            // An edited constraint is replaced by its draft
            const others = doc.constraints().filter(function (c) {
                return c.id !== record.id;
            });
            const comps = solverComponents(doc.components(), false);
            const out = solve(comps, others.concat([record]), { lengthScale: lengthScale() });
            live = out.matrices;
            showLive();
            return out;
        },
        commit: function (record, editId) {
            const name = editId ? doc.constraint(editId).name : doc.newConstraintName(record.type, record.solution);
            const id = editId || doc.newId('k');
            const stored = Object.assign({ id: id, name: name }, record);
            commit((editId ? 'Edit ' : 'Add ') + name, function (d) {
                if (editId) {
                    d.constraints = d.constraints.map(function (c) {
                        return c.id === editId ? Object.assign(stored, { suppressed: c.suppressed }) : c;
                    });
                } else {
                    d.constraints.push(stored);
                }
            });
            setStatus((editId ? 'Changed ' : 'Added ') + name + describeConstraint(stored));
            return true;
        }
    });

    const transform = createTransform({
        stage: options.stage,
        viewport: viewport,
        onStatus: setStatus,
        onClose: function () {
            toolClosed('transform');
        },
        component: function (id) {
            return doc.component(id);
        },
        pivot: function (id, matrix) {
            return G.applyPoint(matrix, pivotOf(doc.component(id)));
        },
        move: function (id, matrix) {
            const comp = doc.component(id);
            if (comp.grounded) {
                // A grounded component goes exactly there; the rest follows it
                const comps = solverComponents(doc.components(), true).map(function (c) {
                    return c.id === id ? Object.assign(c, { matrix: matrix }) : c;
                });
                const out = solve(comps, doc.constraints(), { lengthScale: lengthScale() });
                live = out.matrices;
                live[id] = matrix;
            } else {
                liveSolve(null, { comp: id, matrix: matrix }, true);
            }
            showLive();
            return live[id];
        },
        commit: function (label) {
            const moved = live;
            commit(label, function (d) {
                d.components.forEach(function (comp) {
                    if (moved && moved[comp.id]) {
                        comp.matrix = clean(moved[comp.id]);
                    }
                });
            });
        },
        revert: dropLive
    });

    function setTool(next) {
        const was = tool;
        if (was === 'constrain' && next !== 'constrain') {
            constrain.cancel();
        }
        if (was === 'transform' && next !== 'transform') {
            transform.cancel();
        }
        tool = next;
        ['freemove', 'freerotate', 'transform', 'constrain'].forEach(function (t) {
            ribbon.setOn('asm.' + t, tool === t);
        });
        // The view and the prompt belong to the assembly only while it is shown
        if (active) {
            viewport.setComponentMode(tool !== 'constrain');
            options.setPrompt(tool === 'freemove' ? 'Free Move: drag a component. Esc ends.'
                : tool === 'freerotate' ? 'Free Rotate: drag a component to turn it. Esc ends.' : '');
        }
    }

    function toolClosed(which) {
        if (tool === which) {
            tool = null;
            ribbon.setOn('asm.' + which, false);
            viewport.setComponentMode(true);
            options.setPrompt('');
            render();
            statusOfSelection();
        }
    }

    function startConstrain(type, editId) {
        if (!doc.components().length) {
            setStatus('Place at least one part first');
            return;
        }
        setTool('constrain');
        constrain.start(type, editId);
        if (!editId) {
            setStatus('Constrain: click a face or an edge of one component, then of another. Turn on View > Origin Planes to constrain to the origin.');
        }
    }

    function startTransform(id) {
        const target = id || (selected.length === 1 ? selected[0] : null);
        if (!target) {
            setStatus('Move Rotate Scale: select one component first');
            ribbon.setOn('asm.transform', false);
            return;
        }
        setTool('transform');
        select([target]);
        transform.start(target);
    }

    /* ---- picks for constraints ---- */
    function pickOf(item) {
        if (!item || (item.kind !== 'face' && item.kind !== 'edge')) {
            return null;
        }
        const map = bodyMap[item.body];
        const comp = map && doc.component(map.comp);
        const rt = comp && runtime[comp.part];
        if (!rt || rt.status !== 'ok') {
            return null;
        }
        const desc = rt.bodies[map.partBody];
        const local = Object.assign({ kind: item.kind, index: item.index }, item.local);
        const ent = G.entityOf(local, desc);
        if (!ent) {
            return null;
        }
        const pick = { type: item.kind, body: map.partBody, index: item.index };
        return {
            comp: comp.id,
            entity: Object.assign({ comp: comp.id, pick: pick }, ent),
            label: comp.name + ': ' + entityLabel(ent, G.scaleOf(matrixOf(comp))),
            item: { kind: item.kind, body: item.body, index: item.index }
        };
    }

    function entityLabel(ent, s) {
        const name = ENTITY_NAMES[ent.kind] || 'item';
        return ent.r !== undefined ? name + ' D ' + mm(ent.r * 2 * (s || 1)) : name;
    }

    function originPick(key) {
        const ent = G.originEntity(key);
        if (!ent) {
            return null;
        }
        return { comp: null, entity: Object.assign({ comp: null, origin: key }, ent), label: ORIGIN_NAMES[key] + ' (origin)', item: null };
    }

    // The pick of a stored entity, for editing a constraint
    function restorePick(e) {
        if (!e) {
            return null;
        }
        if (!e.comp) {
            const pick = originPick(e.origin || (e.kind === 'plane' ? 'xy' : 'z'));
            pick.entity = e;
            return pick;
        }
        const comp = doc.component(e.comp);
        const index = bodyMap.findIndex(function (m) {
            return m.comp === e.comp && e.pick && m.partBody === e.pick.body;
        });
        return {
            comp: e.comp,
            entity: e,
            label: (comp ? comp.name : '?') + ': ' + entityLabel(e, comp ? G.scaleOf(comp.matrix) : 1),
            item: index >= 0 && e.pick && e.pick.index >= 0 ? { kind: e.pick.type, body: index, index: e.pick.index } : null
        };
    }

    /* ---- Free Move and Free Rotate: drag in the view ---- */
    let frame = null;
    options.canvas.addEventListener('pointerdown', function (event) {
        if (!active || (tool !== 'freemove' && tool !== 'freerotate') || event.button !== 0 || viewport.isNavigating()) {
            return;
        }
        const hit = viewport.bodyAt(event.clientX, event.clientY);
        if (!hit) {
            return;
        }
        const comp = doc.component(bodyMap[hit.body].comp);
        if (comp.grounded) {
            setStatus(comp.name + ' is grounded. Unground it (Assemble > Grounded) to drag it.');
            return;
        }
        drag = { comp: comp.id, start: matrixOf(comp).slice(), point: hit.point, x: event.clientX, y: event.clientY, moved: false };
        select([comp.id]);
    });
    options.canvas.addEventListener('pointermove', function (event) {
        if (!drag) {
            return;
        }
        const x = event.clientX;
        const y = event.clientY;
        if (!drag.moved && Math.hypot(x - drag.x, y - drag.y) < 4) {
            return;
        }
        drag.moved = true;
        if (frame) {
            return;
        }
        frame = requestAnimationFrame(function () {
            frame = null;
            if (!drag) {
                return;
            }
            const comp = doc.component(drag.comp);
            let target;
            if (tool === 'freemove') {
                const p = viewport.pointOnViewPlane(x, y, drag.point);
                if (!p) {
                    return;
                }
                target = G.multiply(G.translation(G.sub(p, drag.point)), drag.start);
            } else {
                const basis = viewport.cameraBasis();
                const k = 0.012;
                const w = G.add(G.scale(basis.up, (x - drag.x) * k), G.scale(basis.right, (y - drag.y) * k));
                target = G.multiply(G.rotationVector(w, G.applyPoint(drag.start, pivotOf(comp))), drag.start);
            }
            liveSolve(null, { comp: drag.comp, matrix: target }, true);
        });
    });
    window.addEventListener('pointerup', function () {
        if (!drag) {
            return;
        }
        const was = drag;
        drag = null;
        if (frame) {
            cancelAnimationFrame(frame);
            frame = null;
        }
        if (was.moved && live) {
            const moved = live;
            const comp = doc.component(was.comp);
            commit((tool === 'freerotate' ? 'Rotate ' : 'Move ') + comp.name, function (d) {
                d.components.forEach(function (c) {
                    if (moved[c.id]) {
                        c.matrix = clean(moved[c.id]);
                    }
                });
            });
        }
    });

    // An origin plane clicked in the view while constraining
    options.canvas.addEventListener('pointerup', function (event) {
        if (!active || tool !== 'constrain' || event.button !== 0) {
            return;
        }
        if (viewport.modelItemAt(event.clientX, event.clientY)) {
            return;
        }
        const key = viewport.originPlaneAt(event.clientX, event.clientY);
        if (key) {
            constrain.pickOrigin(key);
        }
    });

    /* ================= commands ================= */
    function place() {
        files.openForPlace().then(function (file) {
            if (!file) {
                return null;
            }
            let data;
            let path = file.path || '';
            if (file.step) {
                // A STEP file becomes a part of one Imported feature, kept in the assembly
                data = { format: 'aopart', version: 1, units: 'mm', features: [{ id: 'f1', type: 'import', name: 'Imported1', format: 'step', source: file.name + '.step', data: file.step }] };
                path = '';
            } else if (file.data && file.data.format === 'aoasm') {
                throw new Error('An assembly cannot be placed in an assembly in this version; place its parts instead');
            } else {
                data = validatePart(file.data);
            }
            let pid = path ? doc.partByPath(path) : null;
            const isNew = !pid;
            if (!pid) {
                pid = doc.newId('p');
            }
            setStatus('Building ' + file.name + '...');
            const ready = isNew || !runtime[pid] || runtime[pid].status !== 'ok' ? buildPart(pid, data) : Promise.resolve(runtime[pid]);
            return ready.then(function (rt) {
                if (!rt) {
                    return;
                }
                const first = !doc.components().length;
                const cid = doc.newId('c');
                let matrix = G.identity();
                if (!first) {
                    // Beside what is there, on the same floor, so it is easy to find
                    const b = worldBounds();
                    if (b) {
                        const size = G.length(G.sub(b[1], b[0]));
                        const gap = Math.max(10, size * 0.15);
                        matrix = G.translation([b[1][0] + gap - rt.box[0][0], (b[0][1] + b[1][1]) / 2 - (rt.box[0][1] + rt.box[1][1]) / 2, b[0][2] - rt.box[0][2]]);
                    }
                }
                const name = doc.newComponentName(file.name);
                commit('Place ' + name, function (d) {
                    if (isNew) {
                        d.parts[pid] = path ? { name: file.name, path: path } : { name: file.name, data: data };
                    }
                    d.components.push({ id: cid, name: name, part: pid, matrix: matrix, grounded: first, color: PALETTE[d.components.length % PALETTE.length] });
                }, { solve: false });
                select([cid]);
                setStatus('Placed ' + name + (first ? ', grounded at the origin. Place the next part, then constrain them.'
                    : '. Constrain it to the others, or drag it with Free Move.'));
                if (first) {
                    viewport.home();
                } else {
                    viewport.zoomAll(); // it lands beside the rest, maybe out of view
                }
            });
        }).catch(function (err) {
            options.tell('The part could not be placed', err.message);
            setStatus('The part could not be placed: ' + err.message);
        });
    }

    function deleteComponents(ids) {
        const comps = ids.map(function (id) {
            return doc.component(id);
        }).filter(Boolean);
        if (!comps.length) {
            return;
        }
        const n = doc.constraints().filter(function (c) {
            return ids.indexOf(c.a && c.a.comp) >= 0 || ids.indexOf(c.b && c.b.comp) >= 0;
        }).length;
        const go = n ? options.ask('Delete ' + (comps.length === 1 ? comps[0].name : comps.length + ' components'),
            n + (n === 1 ? ' constraint holds' : ' constraints hold') + ' it to others and will be deleted too.',
            [{ label: 'Cancel', value: false }, { label: 'Delete', value: true, primary: true }], false) : Promise.resolve(true);
        go.then(function (ok) {
            if (ok) {
                commit('Delete ' + (comps.length === 1 ? comps[0].name : comps.length + ' components'), function (d) {
                    doc.removeComponents(d, ids);
                });
                selected = [];
                refreshBrowser();
            }
        });
    }

    function deleteConstraint(id) {
        const c = doc.constraint(id);
        if (c) {
            commit('Delete ' + c.name, function (d) {
                d.constraints = d.constraints.filter(function (k) {
                    return k.id !== id;
                });
            }, { solve: false });
            browser.clearConstraint();
        }
    }

    function openPart(comp) {
        const entry = comp && doc.part(comp.part);
        if (!entry) {
            return;
        }
        if (!entry.path) {
            setStatus(comp.name + ' is kept inside this assembly (no part file), so it cannot be opened on its own');
            return;
        }
        // In a tab of this window: edits show here when this tab is shown again
        options.openPath(entry.path);
    }

    function componentAction(action, id, value) {
        const comp = id ? doc.component(id) : null;
        if (action === 'place') {
            place();
        } else if (action === 'relink') {
            relinkParts();
        } else if (!comp) {
            return;
        } else if (action === 'transform') {
            startTransform(id);
        } else if (action === 'ground' || action === 'unground') {
            commit((action === 'ground' ? 'Ground ' : 'Unground ') + comp.name, function (d) {
                d.components.forEach(function (c) {
                    if (c.id === id) {
                        c.grounded = action === 'ground';
                    }
                });
            }, { solve: action === 'unground' ? false : true });
            select([id]);
        } else if (action === 'hide' || action === 'show') {
            commit((action === 'hide' ? 'Hide ' : 'Show ') + comp.name, function (d) {
                d.components.forEach(function (c) {
                    if (c.id === id) {
                        if (action === 'hide') {
                            c.hidden = true;
                        } else {
                            delete c.hidden;
                        }
                    }
                });
            }, { solve: false });
        } else if (action === 'isolate') {
            isolate([id]);
        } else if (action === 'openpart') {
            openPart(comp);
        } else if (action === 'rename') {
            commit('Rename ' + comp.name, function (d) {
                d.components.forEach(function (c) {
                    if (c.id === id) {
                        c.name = String(value).slice(0, 80);
                    }
                });
            }, { solve: false });
        } else if (action === 'delete') {
            deleteComponents(selected.indexOf(id) >= 0 ? selected : [id]);
        }
    }

    function constraintAction(action, id, value) {
        const c = doc.constraint(id);
        if (!c) {
            return;
        }
        if (action === 'edit') {
            const shown = c.type === 'mate' && c.solution === 'flush' ? 'flush' : c.type;
            startConstrain(shown, id);
        } else if (action === 'suppress' || action === 'unsuppress') {
            commit((action === 'suppress' ? 'Suppress ' : 'Unsuppress ') + c.name, function (d) {
                d.constraints.forEach(function (k) {
                    if (k.id === id) {
                        if (action === 'suppress') {
                            k.suppressed = true;
                        } else {
                            delete k.suppressed;
                        }
                    }
                });
            }, { solve: action === 'unsuppress' });
        } else if (action === 'rename') {
            commit('Rename ' + c.name, function (d) {
                d.constraints.forEach(function (k) {
                    if (k.id === id) {
                        k.name = String(value).slice(0, 80);
                    }
                });
            }, { solve: false });
        } else if (action === 'delete') {
            deleteConstraint(id);
        }
    }

    function isolate(ids) {
        commit('Isolate', function (d) {
            d.components.forEach(function (c) {
                if (ids.indexOf(c.id) >= 0) {
                    delete c.hidden;
                } else {
                    c.hidden = true;
                }
            });
        }, { solve: false });
        viewport.zoomAll();
    }

    function moveSelected(label, how) {
        const comps = needSelection(label);
        if (!comps) {
            return;
        }
        commit(label + (comps.length === 1 ? ' ' + comps[0].name : ''), function (d) {
            d.components.forEach(function (c) {
                if (selected.indexOf(c.id) >= 0) {
                    c.matrix = clean(how(c));
                }
            });
        });
        const held = comps.filter(function (c) {
            return doc.constraintsOf(c.id).length;
        });
        if (held.length) {
            setStatus(label + ': constraints keep ' + held.map(function (c) {
                return c.name;
            }).join(', ') + ' where they hold it');
        }
    }

    function clearInterference() {
        if (interferenceShown) {
            interferenceShown = false;
            viewport.setPreview(null);
        }
    }

    function shownComponents() {
        return doc.components().filter(function (comp) {
            const rt = runtime[comp.part];
            return !comp.hidden && rt && rt.status === 'ok';
        }).map(function (comp) {
            return { id: comp.id, part: partKey(comp.part), matrix: matrixOf(comp) };
        });
    }

    function interference() {
        const comps = shownComponents();
        if (comps.length < 2) {
            setStatus('Interference needs at least two visible components');
            return;
        }
        setStatus('Looking for overlapping components...');
        kernel.call('asmInterference', { components: comps }).then(function (out) {
            clearInterference();
            if (!out.found.length) {
                setStatus('No interference');
                options.tell('Analyze Interference', 'No interference: no two of the ' + comps.length + ' visible components share any volume. (Faces that only touch, as a Mate leaves them, do not count.)');
                return;
            }
            interferenceShown = true;
            viewport.setPreview(out.found.map(function (f) {
                return f.mesh;
            }), 'cut');
            const name = function (id) {
                return doc.component(id).name;
            };
            const total = out.found.reduce(function (s, f) {
                return s + f.volume;
            }, 0);
            setStatus(out.found.length + (out.found.length === 1 ? ' interference' : ' interferences') + ' shown in red. Esc clears them.');
            options.tell('Analyze Interference', out.found.map(function (f) {
                return name(f.a) + ' and ' + name(f.b) + ': ' + mm(f.volume, 3) + ' mm3';
            }).join('\n') + '\n\nTotal overlap ' + mm(total, 3) + ' mm3, shown in red in the view.');
        }).catch(function (err) {
            options.tell('Analyze Interference', 'The check could not be completed: ' + err.message);
        });
    }

    function massProperties() {
        const comps = shownComponents();
        if (!comps.length) {
            setStatus('There is no component to measure yet');
            return;
        }
        kernel.call('asmMass', { components: comps }).then(function (m) {
            const line = function (label, values, unit) {
                return label + ': ' + values.map(function (v) {
                    return mm(v, 3);
                }).join(' x ') + ' ' + unit;
            };
            options.tell('Mass Properties of ' + doc.name, [
                'Visible components: ' + comps.length + ' (' + m.bodies + ' solids)',
                line('Volume', [m.volume], 'mm3') + ' (' + mm(m.volume / 1000, 3) + ' cm3)',
                line('Surface area', [m.area], 'mm2'),
                line('Overall size (X x Y x Z)', m.size, 'mm'),
                'Centre of gravity: X ' + mm(m.centre[0], 3) + ', Y ' + mm(m.centre[1], 3) + ', Z ' + mm(m.centre[2], 3) + ' mm',
                '',
                'Every component counts with the same density. For PLA (1.24 g/cm3): ' + mm(m.volume / 1000 * 1.24, 2) + ' g.'
            ].join('\n'));
        }).catch(function (err) {
            options.tell('Mass Properties', 'The assembly could not be measured: ' + err.message);
        });
    }

    // Commands of the Assemble tab (and the assembly side of shared ones).
    // Returns true when the command was handled here.
    function command(id) {
        if (!active) {
            return false;
        }
        clearInterference();
        if (id === 'asm.place') {
            setTool(null);
            place();
        } else if (id === 'asm.refresh') {
            loadParts(true);
        } else if (id === 'asm.openpart') {
            const comps = needSelection('Open Part');
            if (comps) {
                openPart(comps[0]);
            }
        } else if (id === 'asm.delete') {
            if (browser.selectedConstraint() && !selected.length) {
                deleteConstraint(browser.selectedConstraint());
            } else if (needSelection('Delete')) {
                deleteComponents(selected);
            }
        } else if (id === 'asm.freemove' || id === 'asm.freerotate') {
            const t = id.slice(4);
            setTool(tool === t ? null : t);
            if (tool) {
                setStatus(t === 'freemove' ? 'Free Move: drag a component. Constrained ones only move where their constraints let them.'
                    : 'Free Rotate: drag a component to turn it about its middle.');
            }
        } else if (id === 'asm.transform') {
            if (tool === 'transform') {
                transform.cancel();
            } else {
                startTransform(null);
            }
        } else if (id === 'asm.ground') {
            const comps = needSelection('Grounded');
            if (comps) {
                const ground = !comps.every(function (c) {
                    return c.grounded;
                });
                commit((ground ? 'Ground' : 'Unground') + (comps.length === 1 ? ' ' + comps[0].name : ''), function (d) {
                    d.components.forEach(function (c) {
                        if (selected.indexOf(c.id) >= 0) {
                            c.grounded = ground;
                        }
                    });
                }, { solve: ground });
                select(selected);
            }
        } else if (id === 'asm.origin') {
            // The part's own origin on the assembly origin, axes lined up
            moveSelected('Place at Origin', function (c) {
                return G.scaling(G.scaleOf(c.matrix));
            });
        } else if (id === 'asm.drop') {
            // Lowest point onto the XY plane of the assembly
            moveSelected('Drop to Floor', function (c) {
                const rt = runtime[c.part];
                if (!rt || rt.status !== 'ok') {
                    return c.matrix;
                }
                const b = G.transformBox(rt.box, c.matrix);
                return G.multiply(G.translation([0, 0, -b[0][2]]), c.matrix);
            });
        } else if (id === 'asm.constrain') {
            if (tool === 'constrain') {
                constrain.cancel();
            } else {
                startConstrain('mate', null);
            }
        } else if (id.indexOf('asmc.') === 0) {
            if (tool === 'constrain') {
                constrain.setType(id.slice(5));
            } else {
                startConstrain(id.slice(5), null);
            }
        } else if (id === 'asm.hide') {
            const comps = needSelection('Hide');
            if (comps) {
                commit('Hide', function (d) {
                    d.components.forEach(function (c) {
                        if (selected.indexOf(c.id) >= 0) {
                            c.hidden = true;
                        }
                    });
                }, { solve: false });
                selected = [];
                refreshBrowser();
            }
        } else if (id === 'asm.isolate') {
            if (needSelection('Isolate')) {
                isolate(selected);
            }
        } else if (id === 'asm.showall') {
            commit('Show All', function (d) {
                d.components.forEach(function (c) {
                    delete c.hidden;
                });
            }, { solve: false });
        } else if (id === 'asm.interference') {
            interference();
        } else if (id === 'asm.dof') {
            showDof = !showDof;
            ribbon.setOn('asm.dof', showDof);
            refreshBrowser();
            setStatus(showDof ? 'The browser shows how many ways each component can still move (0: fully constrained)' : 'Ready');
        } else if (id === 'ins.mass') {
            massProperties();
        } else {
            return false;
        }
        return true;
    }

    /* ================= measure (Inspect > Measure) ================= */
    function refOf(item) {
        const map = bodyMap[item.body];
        const comp = map && doc.component(map.comp);
        if (!comp) {
            throw new Error('The selection no longer exists');
        }
        let it;
        if (item.kind === 'component') {
            it = { type: 'component' };
        } else if (item.kind === 'edge') {
            it = { type: 'edge', body: map.partBody, mid: item.local.mid, length: item.local.length };
        } else {
            it = { type: 'face', body: map.partBody, index: item.index };
        }
        return { part: partKey(comp.part), matrix: matrixOf(comp), item: it };
    }

    function measure(a, b) {
        return kernel.call('asmDistance', { a: refOf(a), b: refOf(b) });
    }

    function nameOf(item) {
        const map = item && bodyMap[item.body];
        const comp = map && doc.component(map.comp);
        return comp ? comp.name : null;
    }

    /* ================= export ================= */
    function exportContent(format, quality) {
        const comps = shownComponents();
        if (!comps.length) {
            return Promise.reject(new Error('There is no component to export yet'));
        }
        if (format === 'step' || format === 'brep') {
            return kernel.call('asmExport', { components: comps, format: format }).then(function (out) {
                return { text: out.text };
            });
        }
        return kernel.call('asmMesh', { components: comps, deflection: quality.deflection, angle: quality.angle }).then(function (out) {
            return { bodies: out.bodies };
        });
    }

    /* ================= keys ================= */
    function handleKey(event) {
        if (tool === 'constrain' && constrain.handleKey(event)) {
            return true;
        }
        if (tool === 'transform' && transform.handleKey(event)) {
            return true;
        }
        const key = event.key.toLowerCase();
        if (key === 'escape') {
            if (interferenceShown) {
                clearInterference();
                setStatus('Ready');
                return true;
            }
            if (tool) {
                setTool(null);
                setStatus('Ready');
                return true;
            }
            if (selected.length) {
                select([]);
                return true;
            }
            return false;
        }
        if (key === 'delete' && !tool) {
            if (selected.length) {
                deleteComponents(selected);
                return true;
            }
            if (browser.selectedConstraint()) {
                deleteConstraint(browser.selectedConstraint());
                return true;
            }
        }
        if (key === 'f2' && !tool && selected.length === 1) {
            browser.startRename('component', selected[0]);
            return true;
        }
        return false;
    }

    /* ================= document ================= */
    doc.onChange(function (reason) {
        // A new assembly, or one shown again in its tab: every part is read
        // again (a part open in another tab comes as it is there now)
        if (reason === 'reset' || reason === 'restore') {
            session++;
            runtime = {};
            live = null;
            selected = [];
            fitNext = reason === 'reset';
            keepView = reason === 'restore';
            askMissing = reason === 'reset';
        }
        if (reason === 'undo' || reason === 'redo' || reason === 'reset' || reason === 'restore') {
            live = null;
            if (tool) {
                setTool(null);
            }
        }
        clearInterference();
        if (options.onChange) {
            options.onChange(reason);
        }
        if (reason === 'saved') {
            refreshBrowser();
            return;
        }
        render(); // also loads the parts of a new assembly
    });

    return {
        doc: doc,
        command: command,
        handleKey: handleKey,
        measure: measure,
        nameOf: nameOf,
        exportContent: exportContent,
        isActive: function () {
            return active;
        },
        // The document tab whose parts the kernel keys belong to
        setKeySpace: function (id) {
            space = id;
        },
        // A tab was closed: free its parts in the kernel
        forget: function (id) {
            kernel.call('partDrop', { keep: [], prefix: 'asm:' + id + '/' }).catch(function () {
                // The kernel is gone or still loading
            });
        },
        // Make the assembly environment the one the user sees (or not)
        activate: function () {
            active = true;
            viewport.setComponentMode(true);
            viewport.setPickFilter(null);
            render();
            if (Object.keys(doc.data().parts).some(function (pid) {
                return !runtime[pid];
            })) {
                loadParts(false);
            }
        },
        deactivate: function () {
            setTool(null);
            clearInterference();
            active = false;
            drag = null;
            live = null;
            viewport.setComponentMode(false);
            viewport.setGroupTint(null);
            viewport.detachGizmo();
        },
        // Something else wants the view (Measure, Section): put tools away.
        // Not shown, it has none out (and must not touch the view: turning
        // component picking on in a part left its faces and edges unpickable)
        stopTools: function () {
            if (!active) {
                return;
            }
            setTool(null);
            clearInterference();
        },
        // The viewport's hover and selection, while the assembly is shown
        onHover: function (item) {
            if (tool === 'constrain') {
                if (item) {
                    const pick = pickOf(item);
                    setStatus(pick ? pick.label + ': click to pick it' : 'This face or edge cannot be constrained (pick a flat or round face, a straight or round edge)');
                }
                return;
            }
            if (!item) {
                if (!item && !tool) {
                    statusOfSelection();
                }
                return;
            }
            const name = nameOf(item);
            if (item.kind === 'component') {
                const comp = doc.component(item.group);
                setStatus(name + (comp && comp.grounded ? ' (grounded)' : '') + (tool === 'freemove' || tool === 'freerotate' ? ': drag it' : ''));
            }
        },
        onSelect: function (items) {
            const ids = [];
            items.forEach(function (item) {
                if (item && item.kind === 'component' && ids.indexOf(item.group) < 0) {
                    ids.push(item.group);
                }
            });
            select(ids);
        },
        sampleLoaded: function () {
            fitNext = true;
        }
    };
}
