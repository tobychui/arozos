/*
    Links between files (js/io/paths.js): relative where the files share a
    root, absolute otherwise; absolute while a document is open, relative
    again where it is saved; an assembly a drawing shows resolves its own
    part links from its own file.
    Run with: node tests/run.mjs paths
*/
import * as P from '../js/io/paths.js';
import { createAssemblyDocument, resolvePartPaths, emptyAssembly } from '../js/assembly/document.js';
import { createDrawingDocument, emptyDrawing } from '../js/drawing/document.js';

let failed = 0;
const a = (c, m, x) => { if (!c) { failed++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } };

/* ---- the helpers ---- */
a(P.isAbsolute('user:/Desktop/a.aopart') && P.isAbsolute('storage:/x') && !P.isAbsolute('parts/a.aopart') && !P.isAbsolute('../a.aopart'), 'absolute paths have a root');
a(P.rootOf('user:/Desktop/a.aopart') === 'user' && P.folderOf('user:/Desktop/a.aopart') === 'user:/Desktop/' && P.folderOf('user:/a.aopart') === 'user:/', 'roots and folders');
a(P.fileNameOf('user:/Desktop/Parts/Pin.aopart') === 'Pin.aopart', 'file names');
const asm = 'user:/Projects/Robot/Robot.aoasm';
const cases = [
    ['user:/Projects/Robot/Pin.aopart', 'Pin.aopart'],
    ['user:/Projects/Robot/parts/Pin.aopart', 'parts/Pin.aopart'],
    ['user:/Projects/Pin.aopart', '../Pin.aopart'],
    ['user:/Library/Bolts/M4.aopart', '../../Library/Bolts/M4.aopart'],
    ['user:/Pin.aopart', '../../Pin.aopart'],
    ['storage:/Projects/Robot/Pin.aopart', 'storage:/Projects/Robot/Pin.aopart']
];
cases.forEach(([target, expected]) => {
    const rel = P.relativeTo(asm, target);
    a(rel === expected, 'relative link to ' + target, rel);
    a(P.resolveFrom(asm, rel) === target, 'and back to ' + target, P.resolveFrom(asm, rel));
});
a(P.relativeTo('user:/a.aoasm', 'user:/b/c.aopart') === 'b/c.aopart' && P.resolveFrom('user:/a.aoasm', 'b/c.aopart') === 'user:/b/c.aopart', 'files at the root of a drive');
a(P.relativeTo('', 'user:/b.aopart') === 'user:/b.aopart' && P.resolveFrom('', 'parts/b.aopart') === 'parts/b.aopart', 'without a file of its own a link stays as it is');
a(P.resolveFrom(asm, './parts/./Pin.aopart') === 'user:/Projects/Robot/parts/Pin.aopart', 'dot segments are ignored');

/* ---- an assembly: absolute while open, relative where it is saved ---- */
const saved = emptyAssembly();
saved.parts = {
    p1: { name: 'Pin', path: 'parts/Pin.aopart' },
    p2: { name: 'Bolt', path: 'storage:/Library/Bolt.aopart' },
    p3: { name: 'Inside', data: { format: 'aopart', version: 1, features: [] } }
};
saved.components = [{ id: 'c1', name: 'Pin:1', part: 'p1' }, { id: 'c2', name: 'Bolt:1', part: 'p2' }, { id: 'c3', name: 'Inside:1', part: 'p3' }];
const doc = createAssemblyDocument();
doc.reset(JSON.parse(JSON.stringify(saved)), 'Robot', asm);
a(doc.part('p1').path === 'user:/Projects/Robot/parts/Pin.aopart' && doc.part('p2').path === 'storage:/Library/Bolt.aopart', 'opened, the links are absolute', [doc.part('p1').path, doc.part('p2').path]);
a(!doc.isDirty(), 'resolving the links does not change the assembly');
let out = JSON.parse(doc.serializeFor(asm));
a(out.parts.p1.path === 'parts/Pin.aopart' && out.parts.p2.path === 'storage:/Library/Bolt.aopart' && !out.parts.p3.path, 'saved where it was, relative again (another root stays absolute)', out.parts);
out = JSON.parse(doc.serializeFor('user:/Archive/Robot.aoasm'));
a(out.parts.p1.path === '../Projects/Robot/parts/Pin.aopart', 'Save As elsewhere: the link still reaches the part', out.parts.p1.path);
a(P.resolveFrom('user:/Archive/Robot.aoasm', out.parts.p1.path) === 'user:/Projects/Robot/parts/Pin.aopart', 'and resolves to the same file');
out = JSON.parse(doc.serializeFor(''));
a(out.parts.p1.path === 'user:/Projects/Robot/parts/Pin.aopart', 'a download keeps absolute links');
// A new assembly: absolute links until its first save, relative after
const fresh = createAssemblyDocument();
fresh.reset(null, 'New', '');
fresh.change('Place', d => {
    d.parts.p1 = { name: 'Pin', path: 'user:/Projects/Robot/parts/Pin.aopart' };
    d.components.push({ id: 'c1', name: 'Pin:1', part: 'p1', matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] });
});
a(fresh.part('p1').path === 'user:/Projects/Robot/parts/Pin.aopart', 'unsaved, the link is absolute');
a(JSON.parse(fresh.serializeFor(asm)).parts.p1.path === 'parts/Pin.aopart', 'its first save writes it relative');
// An assembly opened without a file of its own cannot resolve relative links
const lost = createAssemblyDocument();
lost.reset(JSON.parse(JSON.stringify(saved)), 'Robot', '');
a(lost.part('p1').path === 'parts/Pin.aopart', 'opened without its path, a relative link stays relative (and shows as missing)');
// What a drawing shows: an assembly read by itself
const shown = resolvePartPaths(JSON.parse(JSON.stringify(saved)), asm);
a(shown.parts.p1.path === 'user:/Projects/Robot/parts/Pin.aopart', 'an assembly read for a drawing resolves its links from its own file');

/* ---- a drawing's models ---- */
const dd = emptyDrawing();
dd.sources.s1 = { name: 'Robot', kind: 'assembly', path: '../Robot/Robot.aoasm' };
dd.views.push({ id: 'v1', name: 'VIEW1', source: 's1', dir: [0, -1, 0], xdir: [1, 0, 0], x: 100, y: 100 });
const drw = createDrawingDocument();
drw.reset(dd, 'Robot', 'user:/Projects/Drawings/Robot.aodrw');
a(drw.source('s1').path === 'user:/Projects/Robot/Robot.aoasm' && !drw.isDirty(), 'a drawing opens with absolute model links', drw.source('s1').path);
a(JSON.parse(drw.serializeFor('user:/Projects/Drawings/Robot.aodrw')).sources.s1.path === '../Robot/Robot.aoasm', 'and saves them relative');

console.log(failed ? failed + ' failed' : 'paths: all passed');
process.exitCode = failed ? 1 : 0;
