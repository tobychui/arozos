/*
    The picture saved inside a document (js/io/preview.js): written as the
    first field of the file so the ArozOS File Manager finds it at once,
    left out when there is none, and dropped again when a file is read.
    Run with: node tests/run.mjs preview
*/
import * as PV from '../js/io/preview.js';
import { createDocument } from '../js/document/document.js';
import { createAssemblyDocument, emptyAssembly } from '../js/assembly/document.js';
import { createDrawingDocument, emptyDrawing } from '../js/drawing/document.js';

let failed = 0;
const a = (c, m, x) => { if (!c) { failed++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } };

const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';

/* ---- the field goes first, and the text stays JSON ---- */
const part = createDocument();
const partText = PV.withPreview(part.serialize(), jpeg);
const partBack = JSON.parse(partText);
a(partBack[PV.PREVIEW_KEY] === jpeg, 'a part carries its picture', partBack[PV.PREVIEW_KEY]);
a(Object.keys(partBack)[0] === PV.PREVIEW_KEY, 'as its first field', Object.keys(partBack));
a(partText.indexOf('{\n "' + PV.PREVIEW_KEY + '": ') === 0, 'at the very start of the file', partText.slice(0, 40));
a(partBack.format === JSON.parse(part.serialize()).format, 'the rest of the part is unchanged');

const asm = createAssemblyDocument();
asm.reset(emptyAssembly(), 'Robot', 'user:/Projects/Robot.aoasm');
const asmBack = JSON.parse(PV.withPreview(asm.serializeFor('user:/Projects/Robot.aoasm'), jpeg));
a(asmBack[PV.PREVIEW_KEY] === jpeg && asmBack.format === 'aoasm', 'an assembly carries its picture', Object.keys(asmBack));

const drw = createDrawingDocument();
drw.reset(emptyDrawing(), 'Sheet', 'user:/Projects/Sheet.aodrw');
const drwBack = JSON.parse(PV.withPreview(drw.serializeFor('user:/Projects/Sheet.aodrw'), jpeg));
a(drwBack[PV.PREVIEW_KEY] === jpeg && drwBack.format === 'aodrw', 'a drawing carries its picture', Object.keys(drwBack));

/* ---- no picture, or something that is not a document ---- */
const plain = part.serialize();
a(PV.withPreview(plain, null) === plain, 'no picture leaves the text as it is');
a(PV.withPreview(plain, 'data:image/png;base64,iVBOR') === plain, 'only JPEG is written');
a(PV.withPreview('[1,2]', jpeg) === '[1,2]', 'a text that is not an object is left alone');
a(JSON.parse(PV.withPreview('{}', jpeg))[PV.PREVIEW_KEY] === jpeg, 'an empty object still gets valid JSON');
a(JSON.parse(PV.withPreview('  { }', jpeg))[PV.PREVIEW_KEY] === jpeg, 'with spaces too');

/* ---- reading drops it ---- */
const read = PV.stripPreview(JSON.parse(partText));
a(!(PV.PREVIEW_KEY in read) && read.format === partBack.format, 'a read document has no picture', Object.keys(read));
a(PV.stripPreview(null) === null && Array.isArray(PV.stripPreview([1])), 'other values pass through');

/* ---- encoding needs a canvas ---- */
const none = await PV.encode(null);
a(none === null, 'no canvas, no picture');

console.log(failed ? failed + ' failed' : 'preview: all passed');
process.exitCode = failed ? 1 : 0;
