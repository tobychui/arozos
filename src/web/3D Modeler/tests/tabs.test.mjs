/*
    Document tabs: every document kind keeps its state (undo history
    included) in a snapshot and gets it back; tab names; reads of a path
    open in a tab get what the tab holds (the live link of assemblies and
    drawings to the parts they use).
    Run with: node tests/run.mjs tabs
*/
import { createDocument } from '../js/document/document.js';
import { createAssemblyDocument } from '../js/assembly/document.js';
import { createDrawingDocument } from '../js/drawing/document.js';
import { freeName } from '../js/tabs.js';
import * as files from '../js/io/files.js';
import { sampleDocument } from '../js/document/sample.js';

let failed = 0;
const a = (c, m, x) => { if (!c) { failed++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } };

// The same round trip for each kind of document
const kinds = [
    ['part', createDocument(), d => d.features.push({ id: 'f9', type: 'sketch', name: 'Sketch9', plane: { ref: 'origin:xy' }, geometry: [], constraints: [] }), d => d.features.length],
    ['assembly', createAssemblyDocument(), d => { d.parts.p1 = { name: 'P', path: 'user:/P.aopart' }; d.components.push({ id: 'c1', name: 'P:1', part: 'p1', matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }); }, d => d.components.length],
    ['drawing', createDrawingDocument(), d => d.annotations.push({ id: 'd1', type: 'text', view: null, at: [10, 10], text: 'A' }), d => d.annotations.length]
];
kinds.forEach(([kind, doc, edit, count]) => {
    const heard = [];
    doc.onChange(r => heard.push(r));
    doc.reset(null, 'First', 'user:/First');
    doc.markSaved();
    doc.change('Edit 1', edit);
    doc.change('Edit 2', edit);
    doc.undo();
    const snap = doc.snapshot();
    a(snap.name === 'First' && snap.path === 'user:/First' && snap.data !== snap.saved && snap.undo.length === 1 && snap.redo.length === 1, kind + ': the snapshot holds the name, path, changes and history', snap);
    // Another document is shown in the same environment, then the first comes back
    doc.reset(null, 'Second', '');
    a(count(doc.data()) === 0 && !doc.canUndo(), kind + ': the other document is empty');
    doc.restore(snap);
    a(heard[heard.length - 1] === 'restore', kind + ': listeners hear "restore", not "reset"');
    a(doc.name === 'First' && doc.path === 'user:/First' && count(doc.data()) === 1 && doc.isDirty(), kind + ': the document is back, changed since saved', [doc.name, count(doc.data())]);
    a(doc.canUndo() && doc.canRedo() && doc.redo() === 'Edit 2' && count(doc.data()) === 2 && doc.undo() === 'Edit 2', kind + ': with its undo and redo history');
    doc.undo();
    a(!doc.isDirty(), kind + ': undone to the saved state it is clean again');
    // A snapshot is a copy: changing the document does not change it
    const before = doc.snapshot();
    doc.change('Edit 3', edit);
    a(before.data !== doc.snapshot().data && before.undo.length === doc.snapshot().undo.length - 1, kind + ': a snapshot does not follow later changes');
});

a(freeName('Part', []) === 'Part1' && freeName('Part', ['Part1', 'Part2']) === 'Part3' && freeName('Drawing', ['Part1']) === 'Drawing1', 'free tab names');

// A path open in a tab is read from the tab (unsaved edits included), as a copy
const part = sampleDocument();
files.setOpenDocuments(path => path === 'user:/Desktop/Bracket.aopart' ? { data: part, name: 'Bracket' } : null);
const got = await files.readPath('user:/Desktop/Bracket.aopart');
a(got.open && got.name === 'Bracket' && got.path === 'user:/Desktop/Bracket.aopart' && got.data.features.length === part.features.length, 'a part open in a tab is read from the tab', got.name);
got.data.features.pop();
a(part.features.length === sampleDocument().features.length, 'what is read is a copy: the tab is not changed by its reader');
let threw = false;
try {
    globalThis.window = {};
    globalThis.fetch = () => Promise.reject(new Error('no server'));
    await files.readPath('user:/Desktop/Other.aopart');
} catch (e) {
    threw = true;
}
a(threw, 'a path not open in a tab goes to the server');
files.setOpenDocuments(null);

console.log(failed ? failed + ' failed' : 'tabs: all passed');
process.exitCode = failed ? 1 : 0;
