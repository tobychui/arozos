# PDF Editor

A desktop-class PDF editor for ArozOS: change the text already on the pages,
add text, pictures, shapes, markup, stamps and signatures, redact, organize and
crop pages, add headers, footers, page numbers, watermarks and backgrounds, and
convert documents for Docs, Sheets and Slides. It replaces the older
`PDF Tool`, which is to be removed; nothing here loads files from another web
app.

Registered by `init.agi` as **PDF Editor** (group `Office`, `.pdf`), float
window 1280x800.

## Layout

```
index.html           chrome markup (tabs, ribbon, rail, panes, viewer, status bar)
css/editor.css       all styles; colour tokens on :root, body.dark swaps them
js/util.js           PE namespace helpers: T() localisation, loaders, transfer,
                     menus, dialogs, toast, busy card
js/icons.js          drawn SVG icon sprite (PE.icon)
js/fonts.js          font keys, measuring, the text layout shared by screen and PDF
js/doc.js            the document model, undo/redo, page operations, Viewport
js/viewer.js         page layout, lazy pdf.js rendering, zoom/fit, text layer, find
js/objects.js        objects on pages: SVG drawing, selection, drag/resize/rotate,
                     creation tools, inline text editing, clipboard
js/textedit.js       Edit PDF: content-stream tokenizer, run/line/block analysis,
                     removal of the replaced text when saving
js/deco.js           header & footer, page numbers, watermark, background (+ dialogs)
js/save.js           building the output with pdf-lib; Save / Save as / Download / Print
js/dialogs.js        link, crop, snapshot, pictures, stamps, signatures, pages,
                     extract / split, attachments, help
js/convert.js        PDF to Docs / Sheets / Slides / Images / Text
js/panels.js         thumbnails, bookmarks, attachments, objects, Properties pane
js/ribbon.js         tabs and ribbon definition, adaptive compaction
js/app.js            commands, menus, boot, theme, keyboard, clipboard, drag and drop
backend/office.agi   writes .xlsx / .pptx through office.saveDocument
backend/signatures.agi  lists / deletes the user's kept signatures
locale/pdfeditor.json   zh-tw, zh-hk, zh-cn, en-us, ja-jp, ko-kr
lib/                 pdf.js 2.7.570 + cmaps (Apache-2.0), pdf-lib, fontkit (MIT)
```

## Principles

- **The opened file is never changed until Save.** `PE.doc` keeps the original
  bytes of every source PDF plus a model of the edits (`js/doc.js` documents
  it). `save.js` loads the original with pdf-lib and only touches what changed,
  so outlines, forms, links, attachments and metadata survive, and undo reaches
  back past a save.
- **View space.** All geometry is in points, origin at the top left of the page
  as shown (rotation applied, crop ignored). `PE.doc.Viewport` is the same
  transform pdf.js builds, so `toPdf()` maps any point to PDF user space.
  Rotating a page turns its objects with it (`rotatePageModel`).
- **Objects are drawn in their own box.** Each object is an SVG with
  `viewBox="0 0 w h"`; the zoom only moves boxes. On save each object is drawn
  inside a `cm` frame that maps its box (y up) to user space (`frame()` in
  save.js), so rotation and page rotation need no special cases.
- **Text stays text.** Standard fonts (Helvetica / Times / Courier) cover
  WinAnsi; other characters use a System Fonts library family that may be
  embedded (fontkit, subset), and only when none covers the text is that one
  text box drawn as a picture. Layout (`fonts.js`) uses pdf-lib's own metrics
  for the standard fonts, so line breaks on screen and in the PDF match.

## Edit PDF

`textedit.js` walks pdf.js's operator list of a page (text matrices, fonts,
glyph widths, colour) and tokenizes the page's own content stream. pdf.js
emits exactly one `showText` per `Tj` / `TJ` / `'` / `"` of the page (forms
are skipped), so the n-th of each list is the same operation; if the counts
differ the page is *imprecise*. Runs on a baseline make lines, lines of a
paragraph make blocks. Clicking a block stores
`{ops:[{n, rep}], boxes, bg, count, precise}` in `page.edits` and places an
editable text object with the block's text, size, colour and font style on
the original baseline.

Saving replaces each listed operation with a TJ that only advances the text
position by the same amount (`[-1101.074] TJ`), so the glyphs are gone (also
from copy and search) and everything after them on the line keeps its place.
Imprecise pages (unusual content, encrypted files) cover the old text with
the colour around it instead. The screen shows a removal by painting the
block's area of the rendered canvas (`patchCanvas`).

## Redaction

A page with redaction boxes is rendered to an image with the boxes burnt in;
its content, resources and annotations are replaced, and every object nothing
refers to any more is dropped from the file (`collectGarbage`), so the hidden
content is not left anywhere in the PDF. The same clean-up runs after page
removal or Edit PDF, which also keeps files small.

## Conversions

- **PDF to Docs** opens the PDF in Docs, which imports PDF itself. An edited
  document is first written to `tmp:/.appdata/PDF Editor/convert/<id>/`.
- **PDF to Sheets** places text into rows (by baseline) and columns (gaps that
  every multi-cell row leaves open) and writes a Sheets envelope.
- **PDF to Slides** uploads a picture of every page to a working folder, links
  them with `media?file=` and lets `office.saveDocument` embed them; the
  folder is removed afterwards. Page text goes into the speaker notes.

Both go through `backend/office.agi` (`office.saveDocument`); there are no new
HTTP endpoints. The apps are opened with `system/modules/getLaunchPara`, the
way the desktop opens a file with a module.

## Theme and language

The theme follows the ArozOS system theme (`ao_module_getSystemThemeColor` +
`ao_module_onThemeChanged`); View > Dark Mode and the button in the tab row
call `ao_module_toggleSystemTheme`. Without a backend the page keeps its own
choice in localStorage.

Strings go through `PE.T(key, English)`. After adding strings, extract the
keys (every `T('key', 'English')` in `js/`) and add the four translations
(zh-tw, zh-cn, ja-jp, ko-kr; zh-hk copies zh-tw) to `locale/pdfeditor.json`.

## Testing without ArozOS

Serve `src/web` statically and open
`/PDF%20Editor/index.html?open=<url of a PDF>`. The backend check fails, so the
app runs standalone: open from the device, Save downloads, signatures stay in
localStorage, conversions to Office are disabled. Useful checks from the
console: `await PE.textedit.blocks(0)` (precise should be true),
`await PE.save.build()` and loading the result with pdf.js.
