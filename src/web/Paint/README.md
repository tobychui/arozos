# Paint

A simple drawing app for the ArozOS desktop, at about the level of MS Paint:
pencil, brushes, eraser, fill, text, shapes, selections, clipboard paste,
resize / rotate / flip / crop. No layers.

Everything runs in the browser. There is no backend script: pictures are read
through `/media` and written with the file system upload endpoint
(`ao_module_uploadFile`). Opened outside ArozOS (no login), Open reads a local
file and Save downloads the picture.

## Files

| File | What it does |
|---|---|
| `init.agi` | Registers the module (Utilities, opens PNG / JPEG / BMP / GIF / WebP) |
| `index.html`, `css/paint.css` | Page skeleton and styles; colours are tokens, `body.dark` is the dark theme |
| `js/main.js` | Start up: locale, server check, tools, interface, blank picture or launch file |
| `js/app.js` | Shared state, event bus, tool switching, saved preferences |
| `js/history.js` | Undo / redo; keeps only the changed rectangle of each edit |
| `js/view.js` | Zoom, scroll, pan, pinch, pointer routing, SVG overlay, canvas resize grips |
| `js/tools.js` | Pencil, brush (round, calligraphy, highlighter, airbrush), eraser, fill, colour picker |
| `js/shapetool.js` | Shapes tool: a shape stays editable (move, resize, bend a line) until placed |
| `js/selection.js` | Rectangle and free-form selection, floating pixels, clipboard |
| `js/texttool.js` | Text box on the canvas, drawn into the picture with the same line breaks |
| `js/imageops.js` | New, open, resize, canvas size, crop, rotate, flip, invert, black and white |
| `js/fileio.js` | Open / save / download, unsaved changes prompt, drag and drop |
| `js/dialogs.js` | Dialogs: New picture, Resize, Canvas size, confirmations |
| `js/ui.js` | Menus, ribbon, tool options, colours, status bar, keyboard shortcuts |
| `js/shapes.js`, `js/raster.js`, `js/textwrap.js` | DOM-free geometry and pixel code (tested in Node) |
| `js/icons.js` | Line icons, drawn on a 24 x 24 grid |
| `locale/paint.json` | Translations (en-us, zh-tw, zh-hk, zh-cn, ja-jp), keys `paint/<key>` |

## How editing works

The picture is one canvas (`#doc-canvas`) at its real size. Edits that are
still being made live on the preview canvas above it: a shape that can still be
moved, a floating selection or pasted image, a highlighter stroke. Every tool
that holds such an edit has `commit()`, and `App.finalize()` commits them all;
it runs before switching tools, undo, saving and whole-picture operations, so
undo always removes the last thing the user saw happen.

Undo entries are taken with `history.begin()` before an edit and
`history.commit(label, rect)` after it, where `rect` is the area the edit could
have changed. Operations that change the picture size store both whole images
(`pushResize`).

The left mouse button paints with the primary colour, the right one with the
secondary colour. The eraser and the hole left by a moved selection use the
secondary colour, or transparency when "Transparent background" is on (it is
switched on for new transparent pictures and for opened images with
transparency).

## Adding a string

Use `T('key', 'English')` (or `TF` with `{placeholders}`) in the code, then add
the key to every language block of `locale/paint.json`.

## Tests

```bash
cd "src/web/Paint"
node tests/run.mjs
```
