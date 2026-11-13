/*
    3D Modeler - drawing environment

    The controller of a drawing (.aodrw, PROPOSAL.md 14.17): 2D views of
    parts and assemblies on a printable sheet, with dimensions and notes.

    - Models: every part or assembly a drawing shows is read (through AGI,
      or kept inside the drawing) and built in the kernel worker, one
      rebuilder per part ("drw" keys), as the assembly environment does.
    - Views: the kernel projects each view with hidden line removal
      (kernel/drawing.js), one at a time; geometry2d.js cleans the result,
      layout.js lays the sheet out, editor.js shows it.
    - Base views are set up in the 3D view: the Drawing View panel shows
      the model, the user picks a standard direction or turns it any way,
      and may pick faces to draw alone (a flat pattern of a face). OK goes
      back to the sheet, where the view follows the pointer until clicked.
    - Tools (tools.js): projected views, dimensions, notes, text.
    - Sheet Setup and Dimension Style are panels with a live preview.
    - Export: PDF, DXF, SVG and PNG from the same layout.

    options: { viewport, kernel, files, ribbon, stage, sheetHost, tree,
               setStatus, setPrompt, ask, tell, onChange, onShow3D(bool) }
*/

import { createDrawingDocument } from './document.js';
import { createSheetEditor } from './editor.js';
import { createDrawingTools } from './tools.js';
import { createDrawingBrowser } from './browser.js';
import { createPanel } from '../features/panel.js';
import * as S from './sheet.js';
import * as G2 from './geometry2d.js';
import { build, frameOf, scaleOf } from './layout.js';
import { formatLength, prefixOf, suffixOf, typePrefix, defaultStyle } from './format.js';
import { toSVG, FONT_FAMILY } from '../io/drawsvg.js';
import { toPDF, rasterizeText } from '../io/pdf.js';
import { toDXF } from '../io/dxf.js';
import { toPNG, sizeProblem } from '../io/png.js';
import { validate as validatePart } from '../document/document.js';
import { validateAssembly, resolvePartPaths, PALETTE } from '../assembly/document.js';
import { showRelink } from '../io/relink.js';
import * as G from '../assembly/geometry.js';

const TOOL_BUTTONS = {
    dimension: 'ann.dimension', radius: 'ann.radius', diameter: 'ann.diameter', angle: 'ann.angle',
    hole: 'ann.hole', center: 'ann.center', note: 'ann.note', text: 'ann.text', projected: 'drw.projected'
};

function clone(o) {
    return JSON.parse(JSON.stringify(o));
}

export function createDrawing(options) {
    const viewport = options.viewport;
    const kernel = options.kernel;
    const files = options.files;
    const ribbon = options.ribbon;
    const setStatus = options.setStatus;
    const setPrompt = options.setPrompt;
    const doc = createDrawingDocument();

    let active = false;
    let session = 0;
    let space = 't1';       // the document tab shown: kernel keys and projections
    let sources = {};       // sourceId -> { status, message, kind, items, bodies, map, box, rev }
    // viewId -> { sig, status, message, edges, box, snaps }, kept per tab, so
    // a drawing shown again only projects the views whose model changed
    const projectionCache = {};
    let projections = projectionCache[space] = {};
    let queue = [];
    let busy = false;
    let orphans = new Set();
    let preview = null;     // drawing data shown instead of the document (panels preview)
    let tool = null;
    let live = null;        // a drag in progress: originals to restore
    let panelKind = null;   // "view" | "sheet" | "style" | "ann"
    let showing3D = false;
    let askMissing = false; // just opened: offer to find models that are missing

    function data() {
        return preview || doc.data();
    }

    /* ================= models ================= */
    function srcKey(sid, pid) {
        return 'drw:' + space + '/' + sid + '/' + pid;
    }

    // A short fingerprint of a model's contents (FNV-1a): the same model
    // gives the same one, so its views need not be projected again
    function fingerprint(text) {
        let h = 2166136261;
        for (let i = 0; i < text.length; i++) {
            h ^= text.charCodeAt(i);
            h = Math.imul(h, 16777619) >>> 0;
        }
        return text.length + ':' + h.toString(16);
    }

    function readModel(entry) {
        if (entry.data) {
            return Promise.resolve(clone(entry.data));
        }
        if (!entry.path) {
            return Promise.reject(new Error('The model has no file'));
        }
        return files.readPath(entry.path).catch(function (err) {
            err.link = true; // the file is not where the drawing says
            throw err;
        }).then(function (file) {
            return file.data;
        });
    }

    function partOf(entry) {
        if (entry.data) {
            return Promise.resolve(validatePart(clone(entry.data)));
        }
        if (!entry.path) {
            return Promise.reject(new Error('A part of the assembly has no file'));
        }
        return files.readPath(entry.path).then(function (file) {
            return validatePart(file.data);
        });
    }

    function colorOf(comp, i) {
        return parseInt(String(comp.color || PALETTE[i % PALETTE.length]).replace('#', ''), 16);
    }

    // Build a part or an assembly in the kernel: resolves to its runtime record
    function buildModel(sid, model, from) {
        if (model && model.format === 'aoasm') {
            // Its part links are relative to the assembly file itself
            const asm = resolvePartPaths(validateAssembly(model), from);
            const pids = Object.keys(asm.parts);
            const texts = {};
            const looks = {};
            return Promise.all(pids.map(function (pid) {
                return partOf(asm.parts[pid]).then(function (part) {
                    texts[pid] = JSON.stringify(part);
                    looks[pid] = part.appearance;
                    return kernel.call('partBuild', { key: srcKey(sid, pid), document: part });
                }).then(function (res) {
                    return { pid: pid, res: res };
                }, function () {
                    return { pid: pid, res: null };
                });
            })).then(function (built) {
                const byPid = {};
                built.forEach(function (b) {
                    byPid[b.pid] = b.res;
                });
                const rt = { kind: 'assembly', items: [], bodies: [], map: [], box: null };
                rt.rev = fingerprint(JSON.stringify(asm) + pids.map(function (pid) {
                    return texts[pid] || '';
                }).join('|'));
                asm.components.forEach(function (comp, ci) {
                    const res = byPid[comp.part];
                    if (comp.hidden || !res || !res.bodies.length) {
                        return;
                    }
                    rt.items.push({ key: srcKey(sid, comp.part), matrix: comp.matrix, comp: comp.id });
                    res.bodies.forEach(function (body, bi) {
                        rt.bodies.push(Object.assign({}, body, { matrix: comp.matrix, color: colorOf(comp, ci), group: comp.id, appearance: looks[comp.part] }));
                        rt.map.push({ comp: comp.id, body: bi });
                    });
                    const b = G.transformBox(G.boundsOf(res.bodies), comp.matrix);
                    rt.box = rt.box ? [[0, 1, 2].map(function (k) {
                        return Math.min(rt.box[0][k], b[0][k]);
                    }), [0, 1, 2].map(function (k) {
                        return Math.max(rt.box[1][k], b[1][k]);
                    })] : b;
                });
                if (!rt.items.length) {
                    throw new Error('None of the parts of the assembly could be loaded');
                }
                return rt;
            });
        }
        const part = validatePart(model);
        return kernel.call('partBuild', { key: srcKey(sid, 'part'), document: part }).then(function (res) {
            if (!res.bodies.length) {
                throw new Error('The part has no solid yet');
            }
            return {
                kind: 'part', items: [{ key: srcKey(sid, 'part'), matrix: null, comp: null }],
                bodies: part.appearance ? res.bodies.map(function (b) {
                    return Object.assign({}, b, { appearance: part.appearance });
                }) : res.bodies,
                map: res.bodies.map(function (b, i) {
                    return { comp: null, body: i };
                }), box: G.boundsOf(res.bodies), rev: fingerprint(JSON.stringify(part))
            };
        });
    }

    function loadSource(sid, entry) {
        const mine = session;
        sources[sid] = { status: 'loading' };
        refreshBrowser();
        return readModel(entry).then(function (model) {
            return buildModel(sid, model, entry.path);
        }).then(function (rt) {
            if (mine !== session) {
                return null;
            }
            rt.status = 'ok';
            sources[sid] = rt;
            requestProjections();
            render();
            return rt;
        }).catch(function (err) {
            if (mine === session) {
                sources[sid] = { status: 'error', message: err.message, link: !!err.link };
                requestProjections();
                render();
            }
            throw err;
        });
    }

    // Load every model of the drawing not loaded yet (all of them with force)
    function loadSources(force) {
        const list = doc.data().sources;
        const wanted = Object.keys(list).filter(function (sid) {
            return force || !sources[sid];
        });
        if (!wanted.length) {
            return Promise.resolve();
        }
        setStatus('Loading ' + wanted.length + (wanted.length === 1 ? ' model...' : ' models...'));
        return Promise.all(wanted.map(function (sid) {
            return loadSource(sid, list[sid]).catch(function (err) {
                return err;
            });
        })).then(function (results) {
            const failed = results.filter(function (r) {
                return r instanceof Error;
            });
            if (failed.length) {
                setStatus(failed.length + (failed.length === 1 ? ' model' : ' models') + ' could not be loaded: ' + failed[0].message);
            } else if (wanted.length) {
                setStatus(force ? 'Models reloaded; the views are drawn again' : 'Ready');
            }
            if (askMissing) {
                askMissing = false;
                if (active && missingSources().length) {
                    relinkSources();
                }
            }
        });
    }

    function missingSources() {
        return Object.keys(doc.data().sources).filter(function (sid) {
            return sources[sid] && sources[sid].status === 'error' && sources[sid].link;
        });
    }

    // The Missing Files dialog for the models the drawing cannot find
    function relinkSources() {
        const sids = missingSources();
        if (!sids.length) {
            setStatus('Every model of the drawing was found');
            return;
        }
        const list = doc.data().sources;
        showRelink(sids.map(function (sid) {
            return { id: sid, name: list[sid].name, path: list[sid].path, message: sources[sid].message };
        }), {
            title: 'Missing Models',
            text: doc.name + ' shows ' + (sids.length === 1 ? 'a model that is' : sids.length + ' models that are') +
                ' not where it was saved. Select where each one is now; models moved to the same folder are then found on their own.',
            pick: files.openModel,
            read: files.readPath,
            accepts: function (file) {
                return !!file.data && (file.data.format === 'aopart' || file.data.format === 'aoasm');
            },
            apply: function (sid, file) {
                const name = list[sid] ? list[sid].name : sid;
                delete sources[sid];
                doc.change('Relink ' + name, function (d) {
                    const entry = d.sources[sid];
                    entry.kind = file.data.format === 'aoasm' ? 'assembly' : 'part';
                    if (file.path) {
                        entry.path = file.path;
                        delete entry.data;
                    } else {
                        entry.path = '';
                        entry.data = file.data;
                    }
                });
            }
        });
    }

    /* ================= projections ================= */
    function deflectionOf(s) {
        const d = Math.max(1e-4, 0.01 / s);
        return +d.toPrecision(2);
    }

    function viewSig(v) {
        const src = sources[v.source];
        if (!src || src.status !== 'ok') {
            return null;
        }
        const d = doc.data();
        const frame = frameOf(d, v);
        return JSON.stringify([v.source, src.rev, frame.dir, frame.xdir, !!v.hidden, v.smooth !== false, v.faces || null, deflectionOf(scaleOf(d, v))]);
    }

    function itemsFor(v, src) {
        if (!v.faces || !v.faces.length) {
            return src.items.map(function (it) {
                return { key: it.key, matrix: it.matrix };
            });
        }
        return src.items.filter(function (it) {
            return v.faces.some(function (f) {
                return (f.comp || null) === it.comp;
            });
        }).map(function (it) {
            return {
                key: it.key, matrix: it.matrix, faces: v.faces.filter(function (f) {
                    return (f.comp || null) === it.comp;
                }).map(function (f) {
                    return { body: f.body, index: f.index };
                })
            };
        });
    }

    function requestProjections() {
        const d = doc.data();
        const ids = new Set();
        d.views.forEach(function (v) {
            ids.add(v.id);
            const src = sources[v.source];
            if (src && src.status === 'error') {
                projections[v.id] = { sig: null, status: 'error', message: src.message };
                return;
            }
            const sig = viewSig(v);
            if (!sig) {
                // The model is still being read: a view drawn before (the tab
                // shown again) stays until it is known whether it changed
                if (!projections[v.id]) {
                    projections[v.id] = { sig: null, status: 'loading' };
                }
                return;
            }
            const p = projections[v.id];
            if (p && p.sig === sig) {
                return;
            }
            projections[v.id] = { sig: sig, status: 'loading' };
            if (queue.indexOf(v.id) < 0) {
                queue.push(v.id);
            }
        });
        Object.keys(projections).forEach(function (id) {
            if (!ids.has(id)) {
                delete projections[id];
            }
        });
        pump();
    }

    function pump() {
        if (busy) {
            return;
        }
        const id = queue.shift();
        if (!id) {
            return;
        }
        const v = doc.view(id);
        const p = projections[id];
        const src = v && sources[v.source];
        if (!v || !p || p.status !== 'loading' || !p.sig || !src || src.status !== 'ok') {
            pump();
            return;
        }
        busy = true;
        const mine = session;
        const sig = p.sig;
        const d = doc.data();
        const frame = frameOf(d, v);
        const started = performance.now();
        setStatus('Drawing ' + v.name + '...');
        kernel.call('drwProject', {
            items: itemsFor(v, src), dir: frame.dir, xdir: frame.xdir, hidden: !!v.hidden, smooth: v.smooth !== false,
            deflection: deflectionOf(scaleOf(d, v))
        }).then(function (res) {
            const cur = projections[id];
            if (mine !== session || !cur || cur.sig !== sig) {
                return;
            }
            const edges = G2.cleanEdges(res.edges);
            projections[id] = { sig: sig, status: edges.length ? 'ok' : 'error', message: edges.length ? '' : 'Nothing to draw from this side', edges: edges, box: G2.boundsOf(edges), snaps: G2.snapPoints(edges) };
            checkOrphans();
            render();
            if (!queue.length) {
                setStatus(v.name + ' drawn in ' + ((performance.now() - started) / 1000).toFixed(1) + ' s');
            }
        }).catch(function (err) {
            const cur = projections[id];
            if (mine === session && cur && cur.sig === sig) {
                projections[id] = { sig: sig, status: 'error', message: err.message };
                render();
                setStatus(v.name + ' could not be drawn: ' + err.message);
            }
        }).then(function () {
            busy = false;
            pump();
        });
    }

    // The local box of a view before its edges are there: its model's box
    // seen along its direction
    function estimate(v) {
        const src = sources[v.source];
        if (!src || src.status !== 'ok' || !src.box) {
            return null;
        }
        const frame = v.dir && !v.parent ? { dir: v.dir, xdir: v.xdir } : frameOf(data(), v);
        return S.boxOnPaper(frame, src.box);
    }

    // Annotations whose geometry is no longer in their view (the model changed)
    function onLine(edges, p, tol) {
        return edges.some(function (e) {
            if (e.type !== 'line') {
                return false;
            }
            const d = [e.b[0] - e.a[0], e.b[1] - e.a[1]];
            const l = Math.hypot(d[0], d[1]);
            return l > 0 && Math.abs((p[0] - e.a[0]) * d[1] - (p[1] - e.a[1]) * d[0]) / l <= tol;
        });
    }

    function checkOrphans() {
        orphans = new Set();
        doc.annotations().forEach(function (a) {
            const p = a.view && projections[a.view];
            if (!p || p.status !== 'ok') {
                return;
            }
            const tol = 0.01;
            const on = function (q) {
                return G2.onGeometry(p.edges, q, tol) || onLine(p.edges, q, tol);
            };
            let ok = true;
            if (a.type === 'linear') {
                ok = on(a.p1) && on(a.p2);
            } else if (a.type === 'radius' || a.type === 'diameter' || a.type === 'hole' || a.type === 'center') {
                ok = G2.hasCircle(p.edges, a.c, a.r, tol);
            } else if (a.type === 'angle') {
                ok = [a.l1[0], a.l1[1], a.l2[0], a.l2[1]].every(on);
            }
            if (!ok) {
                orphans.add(a.id);
            }
        });
    }

    /* ================= display ================= */
    const editor = createSheetEditor({
        host: options.sheetHost,
        data: data,
        projections: function () {
            return projections;
        },
        estimate: estimate,
        viewState: function (id) {
            return projections[id] || { status: 'loading' };
        },
        orphans: function () {
            return orphans;
        },
        onSelect: function (sel) {
            refreshBrowser();
            describeSelection(sel);
        },
        onDrag: onDrag,
        onEdit: function (target) {
            if (target.kind === 'view') {
                editView(target.id);
            } else {
                editAnnotation(target.id);
            }
        },
        onContext: contextMenu,
        onHover: function (target) {
            if (tool) {
                return;
            }
            if (!target) {
                describeSelection(editor.selection());
            } else if (target.kind === 'view') {
                const v = doc.view(target.id);
                setStatus(v ? v.name + ' (' + S.scaleText(scaleOf(data(), v)) + '): drag to move, double click to edit' : '');
            } else {
                const a = doc.annotation(target.id);
                setStatus(a ? describeAnnotation(a) + ': drag to move, double click to edit' + (orphans.has(a.id) ? '. Its model changed: it no longer sits on an edge' : '') : '');
            }
        }
    });

    function render() {
        if (!active) {
            return;
        }
        editor.render();
        refreshBrowser();
    }

    const browser = createDrawingBrowser(options.tree, {
        onSheet: function () {
            openSheetPanel();
        },
        onSelect: function (ids) {
            editor.select({ kind: 'view', ids: ids });
        },
        onViewAction: function (action, id) {
            if (action === 'edit') {
                editView(id);
            } else if (action === 'projected') {
                startTool('projected', id);
            } else if (action === 'delete') {
                editor.select({ kind: 'view', ids: [id] }, true);
                deleteSelection();
            } else if (action === 'base') {
                openViewPanel(null, {});
            }
        },
        onSourceAction: function (action, sid) {
            if (action === 'relink') {
                relinkSources();
            } else if (action === 'refresh') {
                const entry = doc.source(sid);
                if (entry) {
                    loadSource(sid, entry).catch(function (err) {
                        setStatus(entry.name + ' could not be loaded: ' + err.message);
                    });
                }
            }
        },
        onHover: function () {}
    });

    function refreshBrowser() {
        if (!active) {
            return;
        }
        const d = doc.data();
        const sel = editor.selection();
        const preset = S.presetById(d.sheet.preset);
        browser.render({
            name: doc.name,
            sheetText: 'Sheet: ' + (preset && preset.w ? preset.label.split(' ')[0] : (+d.sheet.width.toFixed(1)) + ' x ' + (+d.sheet.height.toFixed(1)) + ' mm') +
                ', ' + S.scaleText(d.sheet.scale),
            sources: Object.keys(d.sources).map(function (sid) {
                const rt = sources[sid] || {};
                return { id: sid, name: d.sources[sid].name, kind: d.sources[sid].kind, path: d.sources[sid].path, status: rt.status, message: rt.message };
            }),
            views: d.views.map(function (v) {
                const p = projections[v.id] || {};
                const key = S.orientationKey(frameOf(d, v));
                return {
                    id: v.id, name: v.name, parent: v.parent || null,
                    text: (v.faces && v.faces.length ? 'faces, ' : key ? S.ORIENTATIONS[key].label + ', ' : '') + S.scaleText(scaleOf(d, v)),
                    status: p.status, message: p.message
                };
            }),
            annotations: d.annotations.length,
            selected: sel.kind === 'view' ? sel.ids : []
        });
    }

    function describeAnnotation(a) {
        const names = { linear: 'Dimension', radius: 'Radius', diameter: 'Diameter', angle: 'Angle', hole: 'Hole note', note: 'Leader note', text: 'Text', center: 'Center mark' };
        return names[a.type] || 'Annotation';
    }

    function describeSelection(sel) {
        if (!sel || !sel.ids.length) {
            setStatus('Ready');
        } else if (sel.ids.length > 1) {
            setStatus(sel.ids.length + (sel.kind === 'view' ? ' views' : ' annotations') + ' selected');
        } else if (sel.kind === 'view') {
            const v = doc.view(sel.ids[0]);
            setStatus(v ? 'Selected ' + v.name + ': drag to move, Del to delete, double click to edit' : 'Ready');
        } else {
            const a = doc.annotation(sel.ids[0]);
            setStatus(a ? 'Selected ' + describeAnnotation(a).toLowerCase() + ': drag to move, Del to delete, double click to edit' : 'Ready');
        }
    }

    /* ================= moving things ================= */
    function onDrag(info) {
        const d = doc.data();
        if (info.phase === 'move' && !live) {
            if (info.kind === 'view') {
                const v = doc.view(info.id);
                if (!v) {
                    return;
                }
                const moved = [v].concat(doc.descendants(v.id));
                live = { kind: 'view', orig: moved.map(function (m) {
                    return { id: m.id, x: m.x, y: m.y };
                }) };
            } else {
                const a = doc.annotation(info.id);
                if (!a) {
                    return;
                }
                live = { kind: 'ann', id: a.id, at: a.at.slice() };
            }
        }
        if (!live) {
            return;
        }
        const restore = function () {
            if (live.kind === 'view') {
                live.orig.forEach(function (o) {
                    const v = doc.view(o.id);
                    if (v) {
                        v.x = o.x;
                        v.y = o.y;
                    }
                });
            } else {
                const a = doc.annotation(live.id);
                if (a) {
                    a.at = live.at.slice();
                }
            }
        };
        let dx = info.to[0] - info.from[0];
        let dy = info.to[1] - info.from[1];
        if (live.kind === 'view') {
            const v = doc.view(info.id);
            // A projected view stays lined up with its parent: it only slides
            // along the side it was put on
            if (v.parent && !(v.scale > 0)) {
                if (v.rel === 'right' || v.rel === 'left') {
                    dy = 0;
                } else if (v.rel === 'top' || v.rel === 'bottom') {
                    dx = 0;
                }
            }
        }
        const was = live;
        const apply = function (target) {
            if (was.kind === 'view') {
                was.orig.forEach(function (o) {
                    const v = target.views.filter(function (x) {
                        return x.id === o.id;
                    })[0];
                    if (v) {
                        v.x = o.x + dx;
                        v.y = o.y + dy;
                    }
                });
            } else {
                const a = target.annotations.filter(function (x) {
                    return x.id === was.id;
                })[0];
                if (!a) {
                    return;
                }
                const v = a.view ? target.views.filter(function (x) {
                    return x.id === a.view;
                })[0] : null;
                const s = v ? scaleOf(target, v) : 1;
                a.at = [was.at[0] + dx / s, was.at[1] + dy / s];
            }
        };
        if (info.phase === 'move') {
            apply(d);
            editor.render();
            return;
        }
        restore();
        live = null;
        if (info.phase === 'end' && (dx || dy)) {
            doc.change(was.kind === 'view' ? 'Move view' : 'Move annotation', apply);
        } else {
            render();
        }
    }

    function deleteSelection() {
        const sel = editor.selection();
        if (!sel.ids.length) {
            setStatus('Select a view or an annotation to delete');
            return;
        }
        if (sel.kind === 'ann') {
            doc.change(sel.ids.length === 1 ? 'Delete annotation' : 'Delete annotations', function (d) {
                d.annotations = d.annotations.filter(function (a) {
                    return sel.ids.indexOf(a.id) < 0;
                });
            });
            editor.select(null);
            return;
        }
        const extra = [];
        sel.ids.forEach(function (id) {
            doc.descendants(id).forEach(function (v) {
                if (sel.ids.indexOf(v.id) < 0 && extra.indexOf(v.name) < 0) {
                    extra.push(v.name);
                }
            });
        });
        const go = extra.length ? options.ask('Delete views', extra.join(', ') + (extra.length === 1 ? ' is' : ' are') + ' projected from it and will be deleted too, with their dimensions.',
            [{ label: 'Cancel', value: false }, { label: 'Delete', value: true, primary: true }], false) : Promise.resolve(true);
        go.then(function (ok) {
            if (ok) {
                doc.change(sel.ids.length === 1 ? 'Delete view' : 'Delete views', function (d) {
                    doc.removeViews(d, sel.ids);
                });
                editor.select(null);
            }
        });
    }

    function contextMenu(target, x, y) {
        const entries = [];
        if (target && target.kind === 'view') {
            entries.push({ id: 'drw.edit', label: 'Edit View' }, { id: 'drw.projected', label: 'Projected View' }, { id: 'drw.delete', label: 'Delete', hint: 'Del' });
        } else if (target) {
            entries.push({ id: 'drw.edit', label: 'Edit' }, { id: 'drw.delete', label: 'Delete', hint: 'Del' });
        } else {
            entries.push({ id: 'drw.base', label: 'Base View' }, { id: 'ann.dimension', label: 'Dimension' }, { id: 'drw.sheet', label: 'Sheet Setup' }, { id: 'nav.zoomall', label: 'Zoom All' });
        }
        options.openMenu({ x: x, y: y }, entries, function (id) {
            options.onCommand(id);
        });
    }

    /* ================= tools ================= */
    const tools = createDrawingTools({
        editor: editor,
        data: data,
        projections: function () {
            return projections;
        },
        newId: function (prefix) {
            return doc.newId(prefix);
        },
        newViewName: function () {
            return doc.newViewName();
        },
        commit: function (label, fn) {
            doc.change(label, fn);
        },
        setStatus: setStatus,
        setPrompt: setPrompt,
        estimate: estimate,
        editText: function (draft) {
            openAnnotationPanel(null, draft);
        },
        done: function () {
            stopTool();
        }
    });

    function setToolButtons(name) {
        Object.keys(TOOL_BUTTONS).forEach(function (k) {
            ribbon.setOn(TOOL_BUTTONS[k], k === name);
        });
    }

    function startTool(name, arg) {
        closePanel(false);
        stopTool();
        if (!doc.views().length && name !== 'text' && name !== 'note') {
            setStatus('Place a Base View first: Place Views > Base View');
            return;
        }
        if (name === 'projected') {
            const sel = editor.selection();
            tool = tools.projected(arg || (sel.kind === 'view' && sel.ids.length === 1 ? sel.ids[0] : null));
        } else if (name === 'note') {
            tool = tools.note();
        } else if (name === 'text') {
            tool = tools.text();
        } else {
            tool = tools.dimension(name === 'dimension' ? 'auto' : name);
        }
        tool.kind = name;
        editor.setTool(tool);
        setToolButtons(name);
        tool.start();
    }

    function stopTool() {
        if (!tool) {
            return;
        }
        tool = null;
        editor.setTool(null);
        setToolButtons(null);
        setPrompt('');
    }

    /* ================= the Drawing View panel ================= */
    let vstate = null;      // the view being set up
    const viewPanel = createPanel(options.stage, {
        title: 'Drawing View',
        rows: [
            { type: 'section', key: 'modelHead', label: 'Model' },
            { type: 'select', key: 'source', label: 'Model', items: [] },
            { type: 'section', key: 'orientHead', label: 'Orientation' },
            { type: 'seg', key: 'orient', label: 'Standard', columns: 3, items: [
                { id: 'front', label: 'Front' }, { id: 'top', label: 'Top' }, { id: 'right', label: 'Right' },
                { id: 'back', label: 'Back' }, { id: 'bottom', label: 'Bottom' }, { id: 'left', label: 'Left' }
            ] },
            { type: 'seg', key: 'iso', label: 'Isometric', columns: 2, items: [
                { id: 'isoTR', label: 'Top Right' }, { id: 'isoTL', label: 'Top Left' },
                { id: 'isoBR', label: 'Bottom Right' }, { id: 'isoBL', label: 'Bottom Left' }
            ] },
            { type: 'static', key: 'orientNote', label: '' },
            { type: 'section', key: 'contentHead', label: 'Content' },
            { type: 'seg', key: 'content', label: 'Draw', items: [
                { id: 'whole', label: 'Whole model' }, { id: 'faces', label: 'Picked faces', title: 'Only the faces you click in the model, for a 2D drawing of a face' }
            ] },
            { type: 'static', key: 'facesNote', label: 'Faces' },
            { type: 'pick', key: 'lookface', label: '', title: 'Turn the view to look straight at the first picked face' },
            { type: 'section', label: 'Style' },
            { type: 'check', key: 'hidden', label: 'Hidden lines (dashed)' },
            { type: 'check', key: 'smooth', label: 'Tangent edges' },
            { type: 'check', key: 'centers', label: 'Center marks on circles' },
            { type: 'text', key: 'scale', label: 'Scale', placeholder: 'as the sheet' },
            { type: 'text', key: 'name', label: 'Name' },
            { type: 'check', key: 'label', label: 'Show the name and scale below' }
        ],
        onChange: function (key, value) {
            if (!vstate) {
                return;
            }
            if (key === 'source') {
                if (value === '__file') {
                    chooseModel();
                } else {
                    showSource(value);
                }
            } else if (key === 'orient' || key === 'iso') {
                setOrientation(value);
            } else if (key === 'content') {
                vstate.content = value;
                facePicking(value === 'faces');
                if (value !== 'faces') {
                    viewport.clearSelection();
                    vstate.faces = [];
                }
                refreshViewPanel();
            } else if (key === 'scale') {
                const s = String(value).trim() ? S.parseScale(value) : null;
                vstate.scaleBad = String(value).trim() !== '' && !s;
                vstate.scale = s;
                refreshViewPanel();
            } else {
                vstate[key] = value;
            }
        },
        onAction: function (key) {
            if (key === 'lookface' && vstate && vstate.faces.length) {
                lookAtFace(vstate.faceNormal);
            }
        },
        onOk: function () {
            finishViewPanel();
        },
        onCancel: function () {
            closePanel(false);
            setStatus('Ready');
        }
    });

    function sourceItems() {
        const d = doc.data();
        const list = Object.keys(d.sources).map(function (sid) {
            return { id: sid, label: d.sources[sid].name + (d.sources[sid].kind === 'assembly' ? ' (assembly)' : '') };
        });
        if (vstate && vstate.pending) {
            list.push({ id: vstate.pending.id, label: vstate.pending.entry.name + (vstate.pending.entry.kind === 'assembly' ? ' (assembly)' : '') });
        }
        list.push({ id: '__file', label: 'Choose a file...' });
        return list;
    }

    function setOrientation(key) {
        const frame = S.orientation(key);
        if (!frame) {
            return;
        }
        vstate.frame = frame;
        vstate.orientKey = key;
        vstate.touched = false;
        vstate.hidden = !ORTHO_KEYS[key] ? false : vstate.hiddenChosen ? vstate.hidden : true;
        viewPanel.set('hidden', vstate.hidden);
        viewport.viewFrom(frame.dir, S.upOf(frame));
        refreshViewPanel();
    }
    const ORTHO_KEYS = { front: 1, back: 1, top: 1, bottom: 1, left: 1, right: 1 };

    function lookAtFace(normal) {
        if (!normal) {
            return;
        }
        const frame = S.frameFrom(normal, Math.abs(normal[2]) > 0.99 ? [0, 1, 0] : [0, 0, 1]);
        vstate.frame = frame;
        vstate.orientKey = S.orientationKey(frame);
        vstate.touched = false;
        viewport.viewFrom(frame.dir, S.upOf(frame));
        refreshViewPanel();
    }

    function refreshViewPanel() {
        if (!vstate) {
            return;
        }
        const projected = vstate.projected;
        ['modelHead', 'source', 'orientHead', 'orient', 'iso', 'orientNote', 'contentHead', 'content', 'facesNote', 'lookface'].forEach(function (key) {
            viewPanel.visible(key, !projected);
        });
        if (projected) {
            viewPanel.note('A projected view follows the direction of ' + ((doc.view(doc.view(vstate.id).parent) || {}).name || 'its parent') + '.');
        }
        const key = vstate.touched ? null : vstate.orientKey;
        viewPanel.set('orient', key && ORTHO_KEYS[key] ? key : '');
        viewPanel.set('iso', key && !ORTHO_KEYS[key] ? key : '');
        viewPanel.text('orientNote', vstate.touched ? 'As the model is turned now' : key ? S.ORIENTATIONS[key].label + '. Turn the model or use the view cube for any other direction.' : 'Looking at the picked face');
        viewPanel.set('content', vstate.content);
        viewPanel.visible('facesNote', !projected && vstate.content === 'faces');
        viewPanel.visible('lookface', !projected && vstate.content === 'faces');
        viewPanel.text('facesNote', vstate.faces.length ? vstate.faces.length + (vstate.faces.length === 1 ? ' face picked' : ' faces picked') : 'Click the faces in the model', !vstate.faces.length);
        viewPanel.text('lookface', 'Look straight at the first face');
        viewPanel.enable('lookface', vstate.faces.length > 0);
        const problem = vstate.scaleBad ? 'Write the scale as 1:2, 2:1 or a number' : !projected && !vstate.source ? 'Choose the model to draw' :
            !projected && vstate.content === 'faces' && !vstate.faces.length ? 'Click at least one face of the model' : '';
        if (!projected || problem) {
            viewPanel.note(problem, !!problem);
        }
        viewPanel.ok(!problem);
    }

    function addPending(file) {
        const kind = file.data && file.data.format === 'aoasm' ? 'assembly' : 'part';
        const existing = doc.sourceByPath(file.path);
        if (existing) {
            return existing;
        }
        const id = doc.newId('s');
        const entry = { name: file.name, kind: kind, path: file.path || '' };
        if (!file.path) {
            entry.data = file.data;
        }
        vstate.pending = { id: id, entry: entry };
        return id;
    }

    function chooseModel() {
        files.openModel().then(function (file) {
            if (!file) {
                viewPanel.set('source', vstate.source || '');
                return;
            }
            const sid = addPending(file);
            viewPanel.items('source', sourceItems());
            showSource(sid);
        }).catch(function (err) {
            viewPanel.set('source', vstate.source || '');
            options.tell('The model could not be opened', err.message);
        });
    }

    function sourceEntry(sid) {
        if (vstate && vstate.pending && vstate.pending.id === sid) {
            return vstate.pending.entry;
        }
        return doc.source(sid);
    }

    // Show a model in the 3D view so a direction (and faces) can be picked
    function showSource(sid) {
        vstate.source = sid;
        vstate.faces = [];
        viewPanel.set('source', sid);
        const entry = sourceEntry(sid);
        const shown = sources[sid] && sources[sid].status === 'ok' ? Promise.resolve(sources[sid]) : loadSource(sid, entry);
        setStatus('Loading ' + entry.name + '...');
        viewport.setBodies([]);
        shown.then(function (rt) {
            if (!vstate || vstate.source !== sid || !rt) {
                return;
            }
            viewport.setBodies(rt.bodies);
            viewport.viewFrom(vstate.frame.dir, S.upOf(vstate.frame));
            vstate.touched = false;
            setStatus('Pick a direction (or turn the model), then OK and click on the sheet to place the view');
            refreshViewPanel();
        }).catch(function (err) {
            setStatus(entry.name + ' could not be loaded: ' + err.message);
            refreshViewPanel();
        });
        refreshViewPanel();
    }

    // Turning the model by hand makes a direction of its own
    function touchCamera() {
        if (vstate && panelKind === 'view' && !vstate.projected) {
            vstate.touched = true;
            refreshViewPanel();
        }
    }
    options.canvas.addEventListener('pointerdown', function (event) {
        // The left button picks faces; the middle button (and the left one
        // lent to Orbit or Pan) turns the view
        if (event.button !== 0 || viewport.isNavigating()) {
            touchCamera();
        }
    });
    document.getElementById('viewcube').addEventListener('click', touchCamera);

    function cameraFrame() {
        const basis = viewport.cameraBasis();
        const frame = S.frameFrom([-basis.forward[0], -basis.forward[1], -basis.forward[2]], basis.up);
        const key = S.orientationKey(frame);
        return key ? S.orientation(key) : frame;
    }

    function openViewPanel(editId, opts) {
        closePanel(false);
        stopTool();
        const o = opts || {};
        const d = doc.data();
        const v = editId ? doc.view(editId) : null;
        const firstSource = Object.keys(d.sources)[0] || null;
        vstate = {
            id: editId, projected: !!(v && v.parent), pending: null,
            source: v ? v.source : firstSource, frame: v && !v.parent ? { dir: v.dir.slice(), xdir: v.xdir.slice() } : S.orientation('front'),
            orientKey: v && !v.parent ? S.orientationKey({ dir: v.dir, xdir: v.xdir }) : 'front',
            touched: false, content: v && v.faces && v.faces.length ? 'faces' : o.faces ? 'faces' : 'whole',
            faces: v && v.faces ? clone(v.faces) : [], faceNormal: null,
            hidden: v ? !!v.hidden : true, hiddenChosen: !!v, smooth: v ? v.smooth !== false : true, centers: v ? v.centers !== false : true,
            scale: v && v.scale > 0 ? v.scale : null, scaleBad: false, label: v ? !!v.label : false,
            name: v ? v.name : doc.newViewName()
        };
        if (o.suggest) {
            vstate.source = addPending(o.suggest);
        }
        panelKind = 'view';
        viewPanel.title(editId ? 'Edit View' : o.faces ? 'Face View' : 'Base View', vstate.name);
        viewPanel.items('source', sourceItems());
        viewPanel.set('hidden', vstate.hidden);
        viewPanel.set('smooth', vstate.smooth);
        viewPanel.set('centers', vstate.centers);
        viewPanel.set('scale', vstate.scale ? S.scaleText(vstate.scale) : '');
        viewPanel.set('name', vstate.name);
        viewPanel.set('label', vstate.label);
        viewPanel.note('');
        viewPanel.show();
        if (!vstate.projected) {
            show3D(true);
            facePicking(vstate.content === 'faces');
            viewport.clearSelection();
            if (vstate.source) {
                showSource(vstate.source);
                if (vstate.faces.length) {
                    // The faces of a view being edited are shown picked again
                    setTimeout(function () {
                        selectFaces(vstate.faces);
                    }, 0);
                }
            } else {
                viewPanel.set('source', '');
                chooseModel();
            }
        }
        refreshViewPanel();
        setStatus(editId ? 'Edit ' + vstate.name : o.faces ? 'Face View: pick the model and click the faces to draw, then OK' : 'Base View: pick the model and its direction, then OK');
    }

    function selectFaces(faces) {
        const rt = sources[vstate.source];
        if (!rt || rt.status !== 'ok') {
            return;
        }
        const items = [];
        faces.forEach(function (f) {
            const index = rt.map.findIndex(function (m) {
                return (m.comp || null) === (f.comp || null) && m.body === f.body;
            });
            if (index >= 0) {
                items.push({ type: 'face', body: index, index: f.index });
            }
        });
        viewport.selectItems(items, true);
    }

    // The viewport's selection while the panel picks faces
    function facesPicked(items) {
        if (!vstate || panelKind !== 'view' || vstate.content !== 'faces') {
            return;
        }
        const rt = sources[vstate.source];
        if (!rt || rt.status !== 'ok') {
            return;
        }
        const faces = items.filter(function (item) {
            return item.kind === 'face' || item.type === 'face';
        });
        const first = !vstate.faces.length && faces.length;
        vstate.faces = faces.map(function (item) {
            const m = rt.map[item.body] || { comp: null, body: item.body };
            return { comp: m.comp, body: m.body, index: item.index };
        });
        vstate.faceNormal = faces.length && faces[0].normal ? faces[0].normal : null;
        // The first face picked (with the direction untouched) turns the view to it
        if (first && vstate.faceNormal && !vstate.touched && !vstate.id) {
            lookAtFace(vstate.faceNormal);
        }
        refreshViewPanel();
    }

    function finishViewPanel() {
        const st = vstate;
        const d = doc.data();
        if (st.projected) {
            closePanel(false);
            doc.change('Edit ' + st.name, function (dd) {
                const v = dd.views.filter(function (x) {
                    return x.id === st.id;
                })[0];
                Object.assign(v, { hidden: !!st.hidden, smooth: !!st.smooth, centers: !!st.centers, scale: st.scale, label: !!st.label, name: st.name.trim() || v.name });
            });
            return;
        }
        const frame = st.touched ? cameraFrame() : st.frame;
        const record = {
            name: st.name.trim() || doc.newViewName(), source: st.source, dir: frame.dir, xdir: frame.xdir,
            scale: st.scale, hidden: !!st.hidden, smooth: !!st.smooth, centers: !!st.centers, label: !!st.label,
            faces: st.content === 'faces' && st.faces.length ? st.faces : null
        };
        const pending = st.pending && st.pending.id === st.source ? st.pending : null;
        closePanel(false);
        if (st.id) {
            doc.change('Edit ' + record.name, function (dd) {
                const v = dd.views.filter(function (x) {
                    return x.id === st.id;
                })[0];
                if (pending) {
                    dd.sources[pending.id] = pending.entry;
                }
                Object.assign(v, record);
                doc.removeViews(dd, []); // drops a model no view shows any more
            });
            return;
        }
        // A new view: it follows the pointer until it is clicked onto the sheet
        const local = estimate(Object.assign({ id: 'new' }, record)) || [-20, -20, 20, 20];
        const id = doc.newId('v');
        tool = tools.place(Object.assign({ id: id }, record), local, function (x, y) {
            stopTool();
            doc.change('Add ' + record.name, function (dd) {
                if (pending) {
                    dd.sources[pending.id] = pending.entry;
                }
                dd.views.push(Object.assign({ id: id, parent: null }, record, { x: x, y: y }));
            });
            editor.select({ kind: 'view', ids: [id] }, true);
            setStatus(record.name + ' placed. Projected View adds the views beside it.');
        }, function () {
            setStatus('The view was not placed');
        });
        tool.kind = 'place';
        editor.setTool(tool);
        tool.start();
        if (d.sheet) {
            setStatus('Click on the sheet to place ' + record.name);
        }
    }

    /* ================= Sheet Setup ================= */
    let sheetDraft = null;
    const sheetPanel = createPanel(options.stage, {
        title: 'Sheet Setup',
        rows: [
            { type: 'section', label: 'Paper' },
            { type: 'select', key: 'preset', label: 'Size', items: S.SHEET_PRESETS.map(function (p) {
                return { id: p.id, label: p.label + (p.w ? ' (' + p.w + ' x ' + p.h + ')' : '') };
            }) },
            { type: 'seg', key: 'orientation', label: 'Orientation', items: [{ id: 'landscape', label: 'Landscape' }, { id: 'portrait', label: 'Portrait' }] },
            { type: 'seg', key: 'sizeUnit', label: 'Units', columns: 4, items: S.SIZE_UNITS.map(function (u) {
                return { id: u, label: u };
            }) },
            { type: 'number', key: 'width', label: 'Width' },
            { type: 'number', key: 'height', label: 'Height' },
            { type: 'seg', key: 'dpiPreset', label: 'Resolution', columns: 5, items: S.DPI_PRESETS.map(function (d) {
                return { id: String(d), label: String(d) };
            }) },
            { type: 'number', key: 'dpi', label: '', unit: 'dpi', step: 50, max: 2400 },
            { type: 'static', key: 'pixels', label: '' },
            { type: 'section', label: 'Drawing' },
            { type: 'text', key: 'scale', label: 'Scale', placeholder: '1:1' },
            { type: 'seg', key: 'projection', label: 'Projection', items: [{ id: 'first', label: 'First angle', title: 'ISO, Europe and Asia: the view from the left goes on the right' }, { id: 'third', label: 'Third angle', title: 'ANSI, North America: the view from the right goes on the right' }] },
            { type: 'check', key: 'border', label: 'Border' },
            { type: 'number', key: 'margin', label: 'Margin', max: 100 },
            { type: 'check', key: 'titleBlock', label: 'Title block' },
            { type: 'section', label: 'Title block' },
            { type: 'text', key: 'f_title', label: 'Title' },
            { type: 'text', key: 'f_number', label: 'Drawing No.' },
            { type: 'text', key: 'f_revision', label: 'Revision' },
            { type: 'text', key: 'f_company', label: 'Company' },
            { type: 'text', key: 'f_author', label: 'Drawn by' },
            { type: 'text', key: 'f_checked', label: 'Checked by' },
            { type: 'text', key: 'f_date', label: 'Date' },
            { type: 'text', key: 'f_material', label: 'Material' }
        ],
        onChange: function (key, value) {
            const sh = sheetDraft;
            if (!sh) {
                return;
            }
            if (key === 'preset') {
                sh.preset = value;
                const size = S.presetSize(value, sh.orientation);
                if (size) {
                    sh.width = size[0];
                    sh.height = size[1];
                }
            } else if (key === 'orientation') {
                if (value !== sh.orientation) {
                    const w = sh.width;
                    sh.width = sh.height;
                    sh.height = w;
                }
                sh.orientation = value;
            } else if (key === 'sizeUnit') {
                sh.sizeUnit = value;
            } else if (key === 'width' || key === 'height') {
                if (value > 0) {
                    sh[key] = S.toMm(value, sh.sizeUnit, sh.dpi);
                    sh.preset = 'custom';
                }
            } else if (key === 'dpiPreset') {
                sh.dpi = +value;
            } else if (key === 'dpi') {
                if (value >= 10) {
                    sh.dpi = Math.round(value);
                }
            } else if (key === 'scale') {
                const s = S.parseScale(value);
                sh.scaleBad = String(value).trim() !== '' && !s;
                sh.scale = s || 1;
            } else if (key === 'margin') {
                sh.margin = value;
            } else if (key.indexOf('f_') === 0) {
                sh.fields[key.slice(2)] = value;
            } else {
                sh[key] = value;
            }
            fillSheetPanel(key);
            previewSheet();
        },
        onAction: function () {},
        onOk: function () {
            const sh = sheetDraft;
            delete sh.scaleBad;
            closePanel(false);
            doc.change('Sheet Setup', function (d) {
                if (sh.projection !== d.sheet.projection) {
                    keepDirections(d);
                }
                d.sheet = sh;
            });
            editor.refit();
        },
        onCancel: function () {
            closePanel(false);
        }
    });

    // A change of projection angle must not turn the views already on the
    // sheet round (their dimensions would no longer fit): a view beside its
    // parent swaps the side it is said to be on, which under the other rule
    // gives the same direction. Only views placed from now on follow it.
    function keepDirections(d) {
        const opposite = { right: 'left', left: 'right', top: 'bottom', bottom: 'top', tr: 'bl', bl: 'tr', tl: 'br', br: 'tl' };
        d.views.forEach(function (v) {
            if (v.parent && opposite[v.rel]) {
                v.rel = opposite[v.rel];
            }
        });
    }

    function fillSheetPanel(changed) {
        const sh = sheetDraft;
        const show = function (mm) {
            return +S.fromMm(mm, sh.sizeUnit, sh.dpi).toFixed(sh.sizeUnit === 'px' ? 0 : sh.sizeUnit === 'in' ? 3 : 1);
        };
        sheetPanel.set('preset', sh.preset);
        sheetPanel.set('orientation', sh.orientation);
        sheetPanel.set('sizeUnit', sh.sizeUnit);
        if (changed !== 'width') {
            sheetPanel.set('width', show(sh.width));
        }
        if (changed !== 'height') {
            sheetPanel.set('height', show(sh.height));
        }
        sheetPanel.unit('width', sh.sizeUnit);
        sheetPanel.unit('height', sh.sizeUnit);
        sheetPanel.set('dpiPreset', S.DPI_PRESETS.indexOf(sh.dpi) >= 0 ? String(sh.dpi) : '');
        if (changed !== 'dpi') {
            sheetPanel.set('dpi', sh.dpi);
        }
        const px = S.pixelSize(sh);
        const problem = sizeProblem(sh);
        sheetPanel.text('pixels', px[0] + ' x ' + px[1] + ' pixels for PNG' + (problem ? ' (too large to export)' : ''), !!problem);
        if (changed !== 'scale') {
            sheetPanel.set('scale', S.scaleText(sh.scale));
        }
        sheetPanel.set('projection', sh.projection);
        sheetPanel.set('border', sh.border);
        sheetPanel.set('margin', sh.margin);
        sheetPanel.set('titleBlock', sh.titleBlock);
        if (!changed) {
            Object.keys(sh.fields).forEach(function (k) {
                try {
                    sheetPanel.set('f_' + k, sh.fields[k]);
                } catch (e) {
                    // a field the panel does not show
                }
            });
        }
        const bad = sh.scaleBad ? 'Write the scale as 1:2, 2:1 or a number' : !(sh.width >= 10 && sh.height >= 10) ? 'The sheet must be at least 10 x 10 mm' : '';
        sheetPanel.note(bad || (sh.projection !== doc.data().sheet.projection ? 'Views already placed keep their direction; projected views placed from now on follow the new rule.'
            : 'Views that follow the sheet scale change with it; PNG export uses the resolution.'), !!bad);
        sheetPanel.ok(!bad);
    }

    function previewSheet() {
        preview = clone(doc.data());
        preview.sheet = Object.assign({}, sheetDraft);
        editor.render();
    }

    function openSheetPanel() {
        closePanel(false);
        stopTool();
        sheetDraft = clone(doc.data().sheet);
        panelKind = 'sheet';
        fillSheetPanel(null);
        sheetPanel.show();
        setStatus('Sheet Setup: paper size, resolution, scale and title block');
    }

    /* ================= Dimension Style ================= */
    let styleDraft = null;
    const stylePanel = createPanel(options.stage, {
        title: 'Dimension Style',
        rows: [
            { type: 'section', label: 'Values' },
            { type: 'seg', key: 'units', label: 'Units', columns: 5, items: ['mm', 'cm', 'm', 'in', 'ft'].map(function (u) {
                return { id: u, label: u };
            }) },
            { type: 'seg', key: 'precision', label: 'Decimals', columns: 5, items: ['0', '1', '2', '3', '4'].map(function (n) {
                return { id: n, label: n };
            }) },
            { type: 'seg', key: 'anglePrecision', label: 'Angles', columns: 4, items: ['0', '1', '2', '3'].map(function (n) {
                return { id: n, label: n + ' dec.' };
            }) },
            { type: 'check', key: 'trailingZeros', label: 'Keep trailing zeros (12.50)' },
            { type: 'check', key: 'showUnits', label: 'Write the unit after each value' },
            { type: 'text', key: 'prefix', label: 'Prefix', placeholder: 'before every length' },
            { type: 'text', key: 'suffix', label: 'Suffix', placeholder: 'after every value' },
            { type: 'section', label: 'Look' },
            { type: 'number', key: 'textHeight', label: 'Text height', max: 50 },
            { type: 'number', key: 'arrowSize', label: 'Arrow size', max: 50 }
        ],
        onChange: function (key, value) {
            if (!styleDraft) {
                return;
            }
            if (key === 'precision' || key === 'anglePrecision') {
                styleDraft[key] = +value;
            } else if ((key === 'textHeight' || key === 'arrowSize') && !(value > 0)) {
                return;
            } else {
                styleDraft[key] = value;
            }
            stylePanel.note('Example: ' + formatLength(25.4, 'linear', null, styleDraft) + ', ' + formatLength(6, 'diameter', null, styleDraft));
            preview = clone(doc.data());
            preview.style = Object.assign({}, styleDraft);
            editor.render();
        },
        onAction: function () {},
        onOk: function () {
            const st = styleDraft;
            closePanel(false);
            doc.change('Dimension Style', function (d) {
                d.style = st;
            });
        },
        onCancel: function () {
            closePanel(false);
        }
    });

    function openStylePanel() {
        closePanel(false);
        stopTool();
        styleDraft = Object.assign(defaultStyle(), clone(doc.data().style));
        panelKind = 'style';
        ['units', 'trailingZeros', 'showUnits', 'prefix', 'suffix', 'textHeight', 'arrowSize'].forEach(function (k) {
            stylePanel.set(k, styleDraft[k]);
        });
        stylePanel.set('precision', String(styleDraft.precision));
        stylePanel.set('anglePrecision', String(styleDraft.anglePrecision));
        stylePanel.note('Example: ' + formatLength(25.4, 'linear', null, styleDraft) + ', ' + formatLength(6, 'diameter', null, styleDraft));
        stylePanel.ok(true);
        stylePanel.show();
        setStatus('Dimension Style: how every dimension is written, unless one is set otherwise');
    }

    /* ================= one annotation ================= */
    let annDraft = null;    // { record, isNew }
    const annPanel = createPanel(options.stage, {
        title: 'Annotation',
        rows: [
            { type: 'static', key: 'measured', label: 'Measured' },
            { type: 'text', key: 'text', label: 'Text', multiline: true },
            { type: 'text', key: 'prefix', label: 'Prefix' },
            { type: 'text', key: 'suffix', label: 'Suffix' },
            { type: 'seg', key: 'units', label: 'Units', columns: 3, items: [{ id: '', label: 'Style' }].concat(['mm', 'cm', 'm', 'in', 'ft'].map(function (u) {
                return { id: u, label: u };
            })) },
            { type: 'seg', key: 'precision', label: 'Decimals', columns: 3, items: [{ id: '', label: 'Style' }].concat(['0', '1', '2', '3', '4'].map(function (n) {
                return { id: n, label: n };
            })) },
            { type: 'seg', key: 'tol', label: 'Tolerance', columns: 3, items: [{ id: 'none', label: 'None' }, { id: 'sym', label: '\u00b1', title: 'Symmetric: the same both ways' }, { id: 'dev', label: '+ / -', title: 'Deviation: an upper and a lower limit' }] },
            { type: 'number', key: 'upper', label: 'Upper', signed: true, min: 0, step: 0.01 },
            { type: 'number', key: 'lower', label: 'Lower', signed: true, min: 0, step: 0.01 },
            { type: 'number', key: 'count', label: 'Holes', unit: '', step: 1, max: 999 },
            { type: 'seg', key: 'orient', label: 'Direction', columns: 3, items: [{ id: 'h', label: 'Horizontal' }, { id: 'v', label: 'Vertical' }, { id: 'a', label: 'Aligned' }] },
            { type: 'seg', key: 'end', label: 'End', columns: 3, items: [{ id: 'arrow', label: 'Arrow' }, { id: 'dot', label: 'Dot' }, { id: 'none', label: 'None' }] },
            { type: 'number', key: 'height', label: 'Text height', max: 50 }
        ],
        onChange: function (key, value) {
            if (!annDraft) {
                return;
            }
            const a = annDraft.record;
            a.fmt = a.fmt || {};
            if (key === 'text') {
                a.text = value;
            } else if (key === 'prefix' || key === 'suffix') {
                a.fmt[key] = value;
            } else if (key === 'units') {
                a.fmt.units = value || undefined;
            } else if (key === 'precision') {
                a.fmt.precision = value === '' ? undefined : +value;
            } else if (key === 'tol') {
                a.fmt.tol = Object.assign({ upper: 0.1, lower: 0.1 }, a.fmt.tol || {}, { type: value });
                annPanel.set('upper', a.fmt.tol.upper);
                annPanel.set('lower', a.fmt.tol.lower);
            } else if (key === 'upper' || key === 'lower') {
                a.fmt.tol = Object.assign({ type: 'sym', upper: 0, lower: 0 }, a.fmt.tol || {});
                a.fmt.tol[key] = value;
            } else if (key === 'count') {
                a.count = Math.max(1, Math.round(value));
            } else if (key === 'orient') {
                a.orient = value;
            } else if (key === 'end') {
                a.end = value;
            } else if (key === 'height') {
                a.fmt.height = value > 0 ? value : undefined;
            }
            fillAnnPanel(key);
            previewAnnotation();
        },
        onAction: function () {},
        onOk: function () {
            const st = annDraft;
            closePanel(false);
            if ((st.record.type === 'note' || st.record.type === 'text') && !String(st.record.text || '').trim()) {
                setStatus('An empty text is not added');
                return;
            }
            doc.change((st.isNew ? 'Add ' : 'Edit ') + describeAnnotation(st.record).toLowerCase(), function (d) {
                if (st.isNew) {
                    d.annotations.push(st.record);
                } else {
                    d.annotations = d.annotations.map(function (x) {
                        return x.id === st.record.id ? st.record : x;
                    });
                }
            });
        },
        onCancel: function () {
            closePanel(false);
        }
    });

    function measuredOf(a) {
        const fmt = { prefix: '', suffix: '', units: 'mm', precision: 3 };
        const st = defaultStyle();
        if (a.type === 'linear') {
            const v = a.orient === 'h' ? Math.abs(a.p2[0] - a.p1[0]) : a.orient === 'v' ? Math.abs(a.p2[1] - a.p1[1]) : Math.hypot(a.p2[0] - a.p1[0], a.p2[1] - a.p1[1]);
            return formatLength(v, 'linear', fmt, st) + ' mm';
        }
        if (a.type === 'radius') {
            return formatLength(a.r, 'linear', fmt, st) + ' mm radius';
        }
        if (a.type === 'diameter' || a.type === 'hole') {
            return formatLength(2 * a.r, 'linear', fmt, st) + ' mm diameter';
        }
        return '';
    }

    function fillAnnPanel(changed) {
        const a = annDraft.record;
        const st = doc.data().style;
        const fmt = a.fmt || {};
        const isDim = a.type === 'linear' || a.type === 'radius' || a.type === 'diameter' || a.type === 'hole' || a.type === 'angle';
        const isText = a.type === 'note' || a.type === 'text';
        annPanel.visible('measured', isDim && a.type !== 'angle');
        annPanel.text('measured', measuredOf(a));
        annPanel.visible('text', isText);
        ['prefix', 'suffix', 'precision', 'tol'].forEach(function (k) {
            annPanel.visible(k, isDim);
        });
        annPanel.visible('units', isDim && a.type !== 'angle');
        const tol = fmt.tol && fmt.tol.type ? fmt.tol.type : 'none';
        annPanel.visible('upper', isDim && tol !== 'none');
        annPanel.visible('lower', isDim && tol === 'dev');
        annPanel.visible('count', a.type === 'hole');
        annPanel.visible('orient', a.type === 'linear');
        annPanel.visible('end', a.type === 'note');
        annPanel.visible('height', a.type !== 'center');
        if (changed !== 'text') {
            annPanel.set('text', a.text || '');
        }
        if (changed !== 'prefix') {
            annPanel.set('prefix', a.type === 'angle' ? (typeof fmt.prefix === 'string' ? fmt.prefix : '') : prefixOf(a.type, fmt, st));
        }
        if (changed !== 'suffix') {
            annPanel.set('suffix', suffixOf(fmt, st));
        }
        annPanel.set('units', fmt.units || '');
        annPanel.set('precision', fmt.precision === undefined || fmt.precision === null ? '' : String(fmt.precision));
        annPanel.set('tol', tol);
        if (changed !== 'upper') {
            annPanel.set('upper', fmt.tol ? +fmt.tol.upper || 0 : 0.1);
        }
        if (changed !== 'lower') {
            annPanel.set('lower', fmt.tol ? +fmt.tol.lower || 0 : 0.1);
        }
        if (changed !== 'count') {
            annPanel.set('count', a.count || 1);
        }
        annPanel.set('orient', a.orient || 'a');
        annPanel.set('end', a.end || 'arrow');
        if (changed !== 'height') {
            annPanel.set('height', fmt.height || st.textHeight);
        }
        annPanel.note(a.type === 'radius' || a.type === 'diameter' || a.type === 'hole' ? 'The symbol (' + typePrefix(a.type) + ') is part of the prefix: change or clear it there.' : isText ? 'Ctrl + Enter is OK; Enter starts a new line.' : '');
        annPanel.ok(true);
    }

    function previewAnnotation() {
        const st = annDraft;
        preview = clone(doc.data());
        if (st.isNew) {
            preview.annotations.push(st.record);
        } else {
            preview.annotations = preview.annotations.map(function (x) {
                return x.id === st.record.id ? st.record : x;
            });
        }
        editor.render();
    }

    function openAnnotationPanel(id, draft) {
        const keepTool = !!draft;
        if (!keepTool) {
            stopTool();
        }
        closePanel(false);
        const record = draft ? Object.assign({ id: doc.newId('d') }, draft) : clone(doc.annotation(id));
        if (!record) {
            return;
        }
        annDraft = { record: record, isNew: !!draft };
        panelKind = 'ann';
        // The tool's prompt would sit over the panel; it comes back on close
        setPrompt('');
        annPanel.title(draft ? 'New ' + describeAnnotation(record).toLowerCase() : describeAnnotation(record));
        fillAnnPanel(null);
        annPanel.show();
        previewAnnotation();
        if (record.type === 'note' || record.type === 'text') {
            annPanel.focus('text');
        }
    }

    function editAnnotation(id) {
        openAnnotationPanel(id, null);
    }

    function editView(id) {
        const v = doc.view(id);
        if (v) {
            openViewPanel(id, {});
        }
    }

    /* ================= panels and the 3D view ================= */
    // Only faces can be picked (each click adds or removes one) while a
    // view of picked faces is set up
    function facePicking(on) {
        viewport.setPicking(on);
        viewport.setPickFilter(on ? { faces: true, toggle: true } : null);
    }

    function show3D(on) {
        showing3D = !!on;
        options.sheetHost.hidden = showing3D;
        options.onShow3D(showing3D);
        if (!showing3D) {
            viewport.setPickFilter(null);
            viewport.setBodies([]);
            viewport.setPicking(true);
        }
    }

    function closePanel(keepPreview) {
        const was = panelKind;
        panelKind = null;
        [viewPanel, sheetPanel, stylePanel, annPanel].forEach(function (p) {
            p.hide();
        });
        vstate = null;
        sheetDraft = null;
        styleDraft = null;
        annDraft = null;
        if (!keepPreview && preview) {
            preview = null;
            render();
        }
        if (was === 'view' && showing3D) {
            show3D(false);
        }
        if (was === 'ann' && tool && tool.start) {
            tool.start(); // a note or text tool carries on: its prompt again
        }
    }

    /* ================= export ================= */
    function exportContent(format) {
        const d = doc.data();
        if (!d.views.length && !d.annotations.length) {
            return Promise.reject(new Error('The sheet is empty: place a view first'));
        }
        const waiting = d.views.filter(function (v) {
            return !projections[v.id] || projections[v.id].status === 'loading';
        });
        if (waiting.length) {
            return Promise.reject(new Error(waiting[0].name + ' is still being drawn; export when every view is on the sheet'));
        }
        const groups = build(d, projections, {});
        const title = d.sheet.fields.title || doc.name;
        if (format === 'svg') {
            return Promise.resolve({ text: toSVG(groups, d.sheet, { title: title }) });
        }
        if (format === 'dxf') {
            return Promise.resolve({ text: toDXF(groups, d.sheet) });
        }
        if (format === 'pdf') {
            return Promise.resolve({ bytes: toPDF(groups, d.sheet, { title: title, rasterize: function (t, h) {
                return rasterizeText(t, h, FONT_FAMILY);
            } }) });
        }
        if (format === 'png') {
            return toPNG(groups, d.sheet).then(function (bytes) {
                return { bytes: bytes };
            });
        }
        return Promise.reject(new Error('Unknown export format'));
    }

    function exportDrawing(format) {
        stopTool();
        closePanel(false);
        setStatus('Writing ' + format.toUpperCase() + '...');
        exportContent(format).then(function (content) {
            return files.saveAs(doc.name + '.' + format, content);
        }).then(function (saved) {
            setStatus(saved ? (saved.path ? 'Exported to ' + saved.path : 'Downloaded ' + saved.name) : 'Ready');
        }).catch(function (err) {
            setStatus('The drawing could not be exported: ' + err.message);
            options.tell('The drawing could not be exported', err.message);
        });
    }

    /* ================= commands ================= */
    function command(id) {
        if (!active) {
            return false;
        }
        const ann = { 'ann.dimension': 'dimension', 'ann.radius': 'radius', 'ann.diameter': 'diameter', 'ann.angle': 'angle', 'ann.hole': 'hole', 'ann.center': 'center', 'ann.note': 'note', 'ann.text': 'text' }[id];
        if (ann) {
            if (tool && tool.kind === ann) {
                stopTool();
            } else {
                startTool(ann);
            }
            return true;
        }
        if (id.indexOf('dexport.') === 0) {
            exportDrawing(id.slice(8));
            return true;
        }
        switch (id) {
        case 'drw.base':
            openViewPanel(null, {});
            return true;
        case 'drw.face':
            openViewPanel(null, { faces: true });
            return true;
        case 'drw.projected':
            if (tool && tool.kind === 'projected') {
                stopTool();
            } else {
                startTool('projected');
            }
            return true;
        case 'drw.edit': {
            const sel = editor.selection();
            if (sel.ids.length !== 1) {
                setStatus('Select one view or annotation to edit');
            } else if (sel.kind === 'view') {
                editView(sel.ids[0]);
            } else {
                editAnnotation(sel.ids[0]);
            }
            return true;
        }
        case 'drw.delete':
            deleteSelection();
            return true;
        case 'drw.refresh':
            stopTool();
            loadSources(true);
            return true;
        case 'drw.sheet':
            openSheetPanel();
            return true;
        case 'drw.style':
        case 'drw.style2':
            openStylePanel();
            return true;
        case 'nav.zoomall':
        case 'nav.home':
            if (showing3D) {
                return false;
            }
            editor.fit();
            return true;
        case 'drw.zoomin':
            editor.zoom(1.25);
            return true;
        case 'drw.zoomout':
            editor.zoom(0.8);
            return true;
        default:
            return false;
        }
    }

    function handleKey(event) {
        if (panelKind) {
            if (event.key === 'Escape') {
                closePanel(false);
                return true;
            }
            return false;
        }
        if (tool) {
            if (tool.key && tool.key(event)) {
                editor.redrawOverlay();
                return true;
            }
            if (event.key === 'Escape') {
                if (tool.kind === 'place') {
                    tool.cancel();
                } else {
                    stopTool();
                }
                setStatus('Ready');
                return true;
            }
            return false;
        }
        const key = event.key.toLowerCase();
        if (key === 'escape') {
            editor.select(null);
            return true;
        }
        if (key === 'delete' || key === 'backspace') {
            deleteSelection();
            return true;
        }
        if (key === 'd' && !event.ctrlKey && !event.metaKey && !event.altKey) {
            startTool('dimension');
            return true;
        }
        return false;
    }

    /* ================= document ================= */
    doc.onChange(function (reason) {
        // A new drawing, or one shown again in its tab: its models are read
        // again (a part open in another tab comes as it is there now); views
        // whose model did not change keep their projection
        if (reason === 'reset' || reason === 'restore') {
            session++;
            sources = {};
            askMissing = reason === 'reset';
            if (reason === 'reset') {
                projectionCache[space] = {};
            }
            projections = projectionCache[space] = projectionCache[space] || {};
            queue = [];
            orphans = new Set();
            stopTool();
            closePanel(false);
            editor.select(null, true);
            if (reason === 'reset') {
                editor.refit();
            }
        }
        if (reason === 'undo' || reason === 'redo') {
            stopTool();
            closePanel(false);
        }
        if (options.onChange) {
            options.onChange(reason);
        }
        if (reason === 'saved') {
            refreshBrowser();
            return;
        }
        if (active) {
            loadSources(false);
            requestProjections();
            checkOrphans();
            render();
        }
    });

    return {
        doc: doc,
        command: command,
        handleKey: handleKey,
        exportContent: exportContent,
        isActive: function () {
            return active;
        },
        isPicking3D: function () {
            return showing3D;
        },
        // The viewport's selection, while the view panel picks faces
        onSelect: function (items) {
            facesPicked(items);
        },
        onHover: function (item) {
            if (showing3D && item && vstate && vstate.content === 'faces') {
                setStatus((item.kind === 'face' ? 'Face' : 'Edge') + ': click to draw it' + (item.kind === 'face' ? '' : ' (only faces are drawn)'));
            }
        },
        activate: function () {
            active = true;
            options.sheetHost.hidden = false;
            showing3D = false;
            options.onShow3D(false);
            viewport.setBodies([]);
            loadSources(false);
            requestProjections();
            checkOrphans();
            render();
        },
        // The document tab whose kernel keys and projections are used
        setKeySpace: function (id) {
            space = id;
            projections = projectionCache[space] = projectionCache[space] || {};
        },
        // A tab was closed: free its models in the kernel and its projections
        forget: function (id) {
            delete projectionCache[id];
            kernel.call('partDrop', { keep: [], prefix: 'drw:' + id + '/' }).catch(function () {
                // The kernel is gone or still loading
            });
        },
        // Where the sheet is looked at, kept with the tab
        viewState: function () {
            return editor.cameraState();
        },
        setViewState: function (s) {
            editor.setCameraState(s);
        },
        deactivate: function () {
            stopTool();
            closePanel(false);
            active = false;
            options.sheetHost.hidden = true;
            showing3D = false;
        },
        // A new drawing: the Base View panel opens on the model the user
        // was working on (suggest: { data, name, path })
        startNew: function (suggest) {
            if (suggest) {
                openViewPanel(null, { suggest: suggest });
            } else {
                openViewPanel(null, {});
            }
        },
        stopTools: function () {
            stopTool();
            closePanel(false);
        }
    };
}
