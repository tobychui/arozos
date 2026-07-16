# ArozOS Office Suite — shared framework contract

This folder (`src/web/Office/common/`) is shared by the three Office webapps:

| App | Folder | Native ext | `appType` | Accent |
|---|---|---|---|---|
| Docs (word processor) | `Office/docs/` | `.doca` | `document` | blue |
| Sheets (spreadsheet) | `Office/sheets/` | `.xlsa` | `spreadsheet` | green |
| Slides (presentation) | `Office/slides/` | `.ppta` | `presentation` | orange |

Apps are registered in `Office/init.agi` (already done — do not edit it).

## Rules (mandatory)

1. **No literal Unicode emoji anywhere in source.** Use Semantic UI icons
   (`<i class="save icon"></i>`), inline SVG, or generate characters at runtime
   from code points (`String.fromCodePoint(0x1F600)`). Typographic chars
   (✓ → • − …) are fine.
2. **No dependency on other webapps** (`src/web/<OtherApp>/…`). Allowed:
   the system-wide shared folder `src/web/script/` (jquery, ao_module,
   semantic) and everything under `Office/common/`.
3. ES5-compatible style preferred (the rest of the codebase uses it); `const`/
   `let`/arrow functions are acceptable but no build step — code must run
   directly in the browser.
4. Every page must work both inside an ArozOS FloatWindow **and** standalone in
   a plain browser tab (ao_module handles this; never call `parent.*` directly).

## Standard page skeleton

```html
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Docs</title>
    <link rel="stylesheet" href="../../script/semantic/semantic.min.css">
    <link rel="stylesheet" href="../common/office.css">
    <link rel="stylesheet" href="app.css">
    <script src="../../script/jquery.min.js"></script>
    <script src="../../script/ao_module.js"></script>
    <script src="../common/hotkeys.js"></script>
    <script src="../common/office.js"></script>
    <script src="../common/colorpicker.js"></script>
    <script src="../common/clipboard.js"></script>
    <!-- optional: ../common/charts.js, ../common/textedit.js,
         ../common/lib/marked.min.js, ../common/lib/pdf-lib.min.js,
         ../common/lib/html2canvas.min.js -->
</head>
<body data-officeapp="docs">   <!-- docs | sheets | slides -->
    <!-- app builds its own toolbar + workspace; framework injects
         menubar (prepend) and statusbar (append) around them -->
    <div class="of-toolbar of-noprint" id="toolbar">…</div>
    <div class="of-workspace" id="workspace">…</div>
    <script src="app.js"></script>
</body>
</html>
```

Body becomes a column flexbox (`.of-app`): menubar / your content / statusbar.
Toolbar helpers: `.of-tbtn`, `.of-tsep`, `.of-tselect`, `.of-tinput`,
`.of-tcolor` (see office.css). Theme via CSS variables `--of-*`; dark mode =
`body.dark` (framework toggles it — style your app for both).

## OfficeApp.init(config)

Call once on `$(document).ready`. The framework then: injects chrome, binds
standard shortcuts, applies theme/zoom, loads the input file from the window
hash (open-with / embedded mode) or calls `create()`, offers crash-draft
recovery, starts autosave, guards unload.

```js
OfficeApp.init({
    appName: "Docs",             // window title suffix
    appType: "document",         // envelope "app" field — document|spreadsheet|presentation
    appIcon: "../img/docs.svg",
    extension: ".doca",
    fileTypeName: "Document",
    defaultFileName: "New Document",

    // --- document hooks (required) ---
    serialize:   function(){ return bodyObject; },   // editor -> JSON-able body
    deserialize: function(body){ … },                // body -> editor
    create:      function(){ … },                    // blank document

    // --- foreign-format import (optional) ---
    importers: {
        ".txt": function(text, filename){ … },       // load text into editor
        ".md":  function(text, filename){ … }
    },
    // binary formats the framework must NOT fetch as text (e.g. .pptx);
    // the handler gets the vpath and converts server-side (AGI "office" lib)
    binaryImporters: {
        ".pptx": function(filepath, filename){ … }
    },

    // --- undo/redo (recommended: use OfficeUndoStack) ---
    onUndo: function(){ undo.undo(); },
    onRedo: function(){ undo.redo(); },
    canUndo: function(){ return undo.canUndo(); },   // optional, for menu graying
    canRedo: function(){ return undo.canRedo(); },

    // --- clipboard (optional; default = execCommand / navigator.clipboard) ---
    onCut: fn, onCopy: fn, onPaste: fn, onPasteText: function(text){…},

    // --- menus ---
    menus: [ { title: "Insert", items: [ …items… ] }, … ],  // placed between Edit and View
    // a menu may carry when: fn -> bool (contextual, e.g. Docs' Table menu);
    // it starts hidden - call OfficeApp.updateMenus() (e.g. on selection
    // change) to re-evaluate visibility
    fileMenuExtras: [ …items… ],   // e.g. Export submenu — after Save As
    editMenuExtras: [ …items… ],   // after Cut/Copy/Paste
    viewMenuExtras: [ …items… ],   // after zoom/theme

    // --- view ---
    zoomTarget: "#page",           // selector; framework sets CSS zoom on it…
    onZoomChanged: function(pct){…},  // …or handle zoom yourself (omit zoomTarget)
    onThemeChanged: function(isDark){…},
    onBeforePrint: fn, onAfterPrint: fn,
    onBeforeSave: fn
});
```

**Menu item shape** (also used by `showContextMenu`):
`{ label, icon /*semantic icon name, e.g. "save"*/, key /*display, e.g. "Ctrl+B"*/,
   action: fn, enabled: fn->bool, checked: bool|fn /*renders ✓, replaces icon*/,
   sub: array|fn->array, sep: true }`
Menus re-render every time they open, so `checked`/`enabled`/`sub` are re-evaluated.
`key` is display-only — bind the real shortcut with `registerShortcut`.

## OfficeApp API

Lifecycle: `newDocument() open() openPath(fp,fn) save(cb) saveAs(cb)
markDirty() isDirty() getFilePath() getFileName() getMeta() wasImported()`
— **call `OfficeApp.markDirty()` after every user edit**; it drives the title
asterisk, autosave and crash drafts.

UI: `setStatus(msg, "info"|"error", timeoutMs /*0=sticky*/)`,
`addStatusItem(id, html)` / `updateStatusItem(id, html)` (word count etc.),
`dialog({title, body /*html or $el*/, wide, dismissable, buttons:[{label, primary,
danger, action(close, $body)}]})`, `confirm(title, msgHtml, yesLabel, noLabel,
cb(bool))`, `prompt(title, label, defVal, cb(value|null))`, `toast(msg, type)`,
`showContextMenu(x, y, items)`, `showBusy(msg)` / `hideBusy()`.

Features: `registerShortcut("Ctrl+B", fn)` (Cmd normalized to Ctrl),
`print()`, `setZoom(pct) getZoom() zoomIn() zoomOut()`, `toggleTheme() isDark()`.

Storage: `getSetting(key, def)` / `setSetting(key, val)` (per-app localStorage),
`getRecents()`.

VFS: `vfsLoad(path, cb(text), errcb)` (GET `media?file=`),
`vfsSave(path, content, cb, errcb(errmsg))` (AGI filesaver backend).
For other backend needs write an `.agi` script under your app folder and call
`ao_module_agirun("Office/<app>/backend/x.agi", {…}, cb)`.

Utils: `escapeHtml basename dirname extOf stripExt`.

Reserved shortcuts (framework): Ctrl+S/Shift+S/O/Alt+N/P/=/-/0, Ctrl+Z/Y via
your hooks, Ctrl+/ (shortcuts help). Register everything else yourself.

## OfficeHotkeys (common/hotkeys.js) — shared keyboard registry

**All keyboard shortcuts must go through OfficeHotkeys** — never add your
own window/document `keydown` listeners for shortcuts. One capture-phase
listener dispatches everything, `Ctrl+/` shows an auto-generated help
dialog, and Cmd normalizes to Ctrl. `OfficeApp.registerShortcut(combo, fn,
opts)` is a thin wrapper (adds menu-closing, defaults `allowInInput` +
`inDialogs` to true); use `OfficeHotkeys.register` directly for guarded or
editor-mode bindings:

```js
OfficeHotkeys.register("Ctrl+Shift+G", handler, {
    id: "slides.ungroup",        // stable id: re-register replaces, unregister(id)
    description: "Ungroup",      // shown in Ctrl+/ help; omit to hide
    group: "Objects",            // help dialog section
    when: function(e){...},      // gate; falsy = skip (next handler / native)
    allowInInput: false,         // default: skipped while typing in inputs /
                                 // textarea / contenteditable
    inDialogs: false             // default: skipped while a dialog is open
});
// handler returns false -> falls through (next handler, then browser default)
// registered later wins (LIFO): app bindings shadow framework ones
```

Do NOT consume Ctrl+C/X/V in hotkey handlers — bind the native
`copy`/`cut`/`paste` events instead so the system clipboard stays in sync
(see slides.js: object copies ride the system clipboard as marker JSON
`{"app":"arozos-slides-objects",...}` and paste checks that marker first).
If you want them listed in the help dialog, register them with a
`return false` handler (documentation-only entry).
Slides is fully migrated; Sheets and Docs still have legacy app-level
keydown listeners (migrate them the same way).

## OfficeUndoStack

```js
var undo = new OfficeUndoStack({ limit: 100, apply: restoreFn });
undo.init(snapshot());                  // after create/deserialize
undo.push(snapshot());                  // after a discrete change
undo.pushDebounced(snapshot, 500);      // during typing (coalesces)
undo.flushDebounced(snapshot);          // force pending push
undo.undo(); undo.redo(); undo.canUndo(); undo.canRedo();
```
`apply(state)` must restore the editor **and NOT push**. Call
`OfficeApp.markDirty()` in apply too (undo changes the doc).

## File format (envelope — handled by framework)

```json
{
  "type": "arozos/office",
  "app": "document | spreadsheet | presentation",
  "version": 1,
  "meta": { "title": "…", "createdAt": 0, "modifiedAt": 0,
             "revision": 3, "generator": "ArozOS Office/1.0" },
  "body": { /* what your serialize() returned */ }
}
```

Your app owns only `body`. **Document your body schema in a comment at the top
of your app.js** so the other apps / future importers can read it.

## Packed native files (zip container)

All three apps set `packed: true` in `OfficeApp.init`. Native files
(`.doca` / `.xlsa` / `.ppta`) are then saved through
`common/backend/container.agi` -> `office.packToFile` as a **zip**:
`document.json` (the envelope, media replaced by `asset://<hash>.<ext>`)
plus deduplicated binary `assets/`. Loads go through
`office.unpackToWorkdir`, which extracts assets into
`user:/.appdata/Office/cache/<doc>/` and links them via `media?file=` so
the JSON stays small. **Never store large media as base64 in the model**:
use `OfficeApp.mediaUrl(vpath)` for storage picks and
`OfficeApp.blobToSrc(blob, name, cb, errcb)` for device/pasted blobs
(<=1 MB stays inline, bigger streams to `user:/.appdata/Office/uploads/`
via the system upload endpoint). The packer embeds both forms at save
time. The framework also writes rolling session snapshots to
`user:/.appdata/Office/session/<app>.osession` (autosave tick + after
save) and offers "Restore from previous session" on blank startup. That
dialog's **Discard** button deletes the snapshot (container.agi
`session-delete`) so it stops prompting; **Start fresh** keeps it for a
later launch. The framework also intercepts the floatWindow close button
(overriding `ao_module_close`) to confirm before discarding unsaved
changes (Cancel / Close without saving / Save & close).

## OfficeClipboard (common/clipboard.js) — cross-app copy/paste

Each app keeps a high-fidelity **text/plain** clipboard format (Slides
object JSON, Sheets TSV / chart-marker JSON). To move content *between*
apps, on copy also write a shared **text/html** snapshot, and on paste
consume it only after your own text/plain marker is absent.

```js
OfficeClipboard.imageHtml(src, w, h)     // "<img ...>"
OfficeClipboard.tableHtml(rows, {headerRow})   // rows: [[cellHtml,...]]
OfficeClipboard.svgImageSrc(svg)         // rasterizable SVG -> data: URL
OfficeClipboard.parse(html)  // -> {images:[{src,w,h}], tables:[[[cellEl]]],
                             //     text, html, hasContent}
OfficeClipboard.isMarker(text)   // true = another app's raw marker JSON;
                                 // never insert it as plain text
OfficeClipboard.writeAsync({html, text})  // menu-driven copies (no event)
```

Copy pattern (in a `copy`/`cut` event handler): set BOTH
`e.clipboardData.setData("text/plain", myMarker)` and
`setData("text/html", OfficeClipboard.imageHtml/tableHtml(...))`, then
`preventDefault()`. Paste pattern: honour your own marker first; else
`OfficeClipboard.parse(getData("text/html"))` and place images/tables/
text; guard the plain-text fallback with `!OfficeClipboard.isMarker(t)`
so a foreign marker never lands as literal JSON. Media picks stay as
`media?file=` links — Docs and Slides sit at the same `Office/<app>/`
depth, so the relative URL resolves in both.

## OfficeColorPicker (common/colorpicker.js) — shared color picker

The suite-wide replacement for `<input type="color">` (never use the native
input). A Google-Docs-style square-swatch palette + custom HSV picker +
eyedropper; recent custom colors persist in localStorage across all apps.

```js
OfficeColorPicker.open({ anchor: el, value: "#ff0000",
    allowNone: true, noneLabel: "No fill",
    onPick: function(hex){ /* "#rrggbb", or "" when none picked */ } });
OfficeColorPicker.close(); OfficeColorPicker.isOpen();
OfficeColorPicker.contains(node);   // focus-inside checks

// toolbar drop-in: a <button> that keeps input[type=color] semantics —
// .val() get/set plus "input"/"change" events on pick. After a
// programmatic .val(x), trigger "of-cp-refresh" to repaint the chip.
var $c = OfficeColorPicker.swatchInput({ id, title, value, allowNone, noneLabel });
```

## OfficeTextEditBar (common/textedit.js) — shared floating format bar

A PowerPoint-style mini toolbar (two rows) that floats above a
contenteditable element while it is being edited: row 1 = font family,
size, B/I/U, alignment; row 2 = text color, highlight (both via
OfficeColorPicker), insert/remove link. Operates on the live selection via
`document.execCommand`; the host just serializes the resulting innerHTML
afterwards. Used by Slides and Docs. `contains(node)` also treats focus
inside the color picker popup as "still editing" — hosts must use it in
their focusout checks.

```js
OfficeTextEditBar.show({
    anchor: el,                    // DOM element to float above
    fontSize: 24,                  // initial value in the size box
    onFontSize: function(px){…}    // fallback when no text is selected:
});                                // apply size to the whole object
OfficeTextEditBar.reposition();    // anchor moved/resized/zoomed
OfficeTextEditBar.hide();
OfficeTextEditBar.contains(node);  // host focusout check: focus inside the
                                   // bar still counts as "editing"
OfficeTextEditBar.isVisible();
```

Menu note: submenus (`sub:` items) render as body-level floating panels, so
they are never clipped by a scrolling menu — `closeAllMenus()` (and any menu
item click) removes them all. Context menus clamp to the viewport and scroll
when taller than it.

## Slides Stage 2 additions (slides.js)

Slide objects may carry: `group` (shared id; grouped objects select/move as
one), `props.anim` ("fade"|"slide"|"zoom" entrance, revealed click-by-click
in present mode), `props.link` ("#N" -> slide N, or an http(s) URL, followed
on click while presenting). New object types `video` / `audio` embed media as
data URLs (dropped on .pptx export, kept in the packed .ppta). Each slide has
`transition` ("none"|"fade"|"slide"|"zoom"). Text boxes support `<ul>`/`<ol>`
lists via execCommand; htmlToLines (mod/office) flattens them to bullet/number
prefixes for .pptx. present.js adds transitions, click-to-reveal animations,
laser pointer (L), interactive links, and a presenter-view popup.

## OfficeCharts (common/charts.js) — for Sheets and Slides

```js
var svg = OfficeCharts.renderToString(spec, width, height); // svg string
OfficeCharts.render(containerEl, spec);                     // fit container
// spec: { type:"bar"|"line"|"pie", title, labels:[…],
//         series:[{name, values:[…], color?}],
//         options:{ legend, gridlines, stacked } }
```
Text inherits `currentColor` → theme-aware automatically.

## Vendored libs (common/lib/, all MIT)

- `marked.min.js` — Markdown → HTML (Docs import)
- `pdf-lib.min.js` — PDF generation (global `PDFLib`)
- `html2canvas.min.js` — DOM → canvas (Slides PNG export)

## Testing without a full ArozOS server

`python -m http.server 8123 --directory src/web` then open
`http://localhost:8123/Office/docs/index.html`. ao_module tolerates running
outside the desktop; `vfsLoad/vfsSave` and file selectors will fail politely
(no ArozOS backend) — all pure-front-end features must still work. Run
`node --check app.js` for syntax. Do not add build steps.
