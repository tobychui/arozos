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
5. **Never call `ao_module_*` or `ao_root` directly — go through
   `OfficePlatform`** (see below). The suite ships in two hosts and that layer
   is the only thing that knows which one it is running in.

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
    <!-- host layer: mode.js picks the host, container.js is the browser-side
         .doca/.xlsa/.ppta packer, recents.js is the browser-side recent
         document store, wasm.js lazily loads the Office format converters,
         platform.js is the abstraction itself.
         All five must load before office.js. -->
    <script src="../common/mode.js"></script>
    <script src="../common/container.js"></script>
    <script src="../common/recents.js"></script>
    <script src="../common/wasm.js"></script>
    <script src="../common/platform.js"></script>
    <script src="../common/fonts.js"></script>
    <script src="../common/hotkeys.js"></script>
    <script src="../common/office.js"></script>
    <script src="../common/colorpicker.js"></script>
    <script src="../common/clipboard.js"></script>
    <!-- optional: ../common/charts.js, ../common/textedit.js,
         ../common/lib/marked.min.js, ../common/lib/pdf-lib.min.js,
         ../common/lib/html2canvas.min.js -->
    <!-- with fonts.js: ../common/fonts/fonts.css declares the shipped
         document faces; an app that lets the user pick a font needs it -->
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

    // --- foreign-format saving (optional) — see "Save formats" below ---
    saveFormats: [ { ext, label, icon, oneWay, unsupported, save }, … ],

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
`showContextMenu(x, y, items)`, `showBusy(msg)` / `hideBusy()`,
`showProgress({title, anchor})` -> `{set(done, total, msg), message(msg),
close()}`.

`showBusy` blocks the whole page; `showProgress` puts a small panel in the
top-right of `anchor` and leaves the document usable. Use the second one for
work the user has no reason to wait on - but then the work must run from a
snapshot, or editing on will change what it produces.

Features: `registerShortcut("Ctrl+B", fn)` (Cmd normalized to Ctrl),
`print()`, `setZoom(pct) getZoom() zoomIn() zoomOut()`, `toggleTheme() isDark()`.

Storage: `getSetting(key, def)` / `setSetting(key, val)` (per-app localStorage),
`getRecents()`.

VFS: `vfsLoad(path, cb(text), errcb)` (GET `media?file=`),
`vfsSave(path, content, cb, errcb(errmsg))` (AGI filesaver backend).
For other backend needs write an `.agi` script under your app folder and call
`ao_module_agirun("Office/<app>/backend/x.agi", {…}, cb)`.

**Big payloads must go through `OfficeApp.agirunLarge(script, params, field,
cb(data), errcb(msg), timeout)`.** The AGI gateway parses POST parameters with
Go's `r.ParseForm`, which caps a urlencoded body at **10 MB**; past that the
parse fails, *every* parameter disappears and the still-uploading connection is
reset (the browser just reports a network error). `agirunLarge` posts inline
while `params[field]` stays under 4 MB, and otherwise uploads that field to
`user:/.appdata/Office/tmp/` through the system upload endpoint (streamed to
disk, so the payload never has to fit in the host's RAM) and passes the vpath as
`<field>File` instead. Backend scripts must accept both — read `dataFile` with
`filelib.readFile()` and `filelib.deleteFile()` it right after (see
`slides/backend/pptx.agi`). It also unifies error handling: `errcb` fires for
transport failures *and* for `{error: …}` replies. The framework already routes
every document save, session snapshot and export of all three apps through it.

Utils: `escapeHtml basename dirname extOf stripExt`.

Reserved shortcuts (framework): Ctrl+S/Shift+S/O/Alt+N/P/=/-/0, Ctrl+Z/Y via
your hooks, Ctrl+/ (shortcuts help). Register everything else yourself.

## OfficePlatform (common/platform.js) — the host abstraction

The suite runs in two hosts from one code base, and this is the seam:

| host | where | file dialogs | documents | Office-format conversions |
|---|---|---|---|---|
| `arozos` | the ArozOS desktop | `ao_module_openFileSelector` | ArozOS virtual file system | the AGI backends → `mod/office` |
| `standalone` | any static web server ("ArozOS Office Web") | `<input type=file>` / drag and drop / `?open=<relative path>` | the visitor's device; `Save` downloads the file back | the same `mod/office` code compiled to WebAssembly — **when the build shipped it** |

The mode is one line in `common/mode.js` (`window.OFFICE_STANDALONE`, plus
`window.OFFICE_WASM`), which `apps/ArozOS Office Web/generate.go` rewrites in
its output tree. Never test those flags — ask `OfficePlatform`.

### Two capability questions, deliberately separate

```js
OfficePlatform.hasBackend()   // is there an ArozOS server?
                              // gate storage, AGI scripts, accounts,
                              // and the real-text PDF renderer on this
OfficePlatform.canConvert()   // can this build convert .docx/.xlsx/.pptx/ODF?
                              // true in ArozOS; true in a standalone build
                              // made with -wasm. Gate import/export on this.
```

They are not the same question and must not be conflated: a standalone build
with the converters can write a .docx but still cannot render a server PDF.

```js
OfficePlatform.mode()               // "arozos" | "standalone"
OfficePlatform.isStandalone()       // !hasBackend()
OfficePlatform.requireBackend(what) // guards: toast + return false when the
OfficePlatform.requireConvert(what) // capability is missing
OfficePlatform.tracksRecents()      // false in standalone (paths do not outlive the page)
OfficePlatform.autosavesToFile()    // false in standalone (autosave would download)

// dialogs - cb gets [{filepath, filename}] / {filepath, filename}
OfficePlatform.pickOpen({filter:["doca","txt"], multiple, memoryKey}, cb)
OfficePlatform.pickSave({defaultName, ext, memoryKey, forceOverwrite}, cb)

// Office interchange formats. One descriptor names both mechanisms; the
// host picks. wasm:null marks a conversion that is still server-only.
OfficePlatform.convertIn({agi, action, wasm}, srcPath, cb(bodyJson), errcb)
OfficePlatform.convertOut({agi, action, wasm}, destPath, bodyJson,
                          cb({mediaZip}), errcb)

// io - OfficeApp.vfsLoad / vfsSave / blobToSrc / mediaUrl / agirunLarge all
// forward to these, so app code normally keeps using OfficeApp
readText writeText writeBytes containerLoad containerSave
sessionSave sessionLoad sessionDelete
agirun agirunLarge prepareWorkdir mediaUrl blobToSrc
loadInputFiles adoptDroppedFile setWindowTitle setWindowTheme
openDocument     // open a document in a second window of this app;
                 // false = nowhere to open it from (standalone downloads)
```

`writeBytes(path, Uint8Array, cb, errcb)` is for a file the client
rendered itself. In ArozOS it base64s the payload down the same
oversized-payload path as every export and lands in
`common/backend/binsaver.agi` -> `office.writeBinaryFile`; in the
standalone edition it is a download. The Slides PDF export is the reason
it exists (see the Office README).

**Adding a format conversion:** add the converter to
[`src/wasm/office/convert.go`](../../../wasm/office/convert.go) (and its
pairing test), then call `OfficePlatform.convertIn/convertOut` with a
descriptor naming the AGI action *and* the wasm converter. Gate the menu
entry on `canConvert()` and guard the handler with `requireConvert()`.
A `saveFormats` writer gets `needsConvert: true`.

**Adding something that needs the server outright:** guard with
`requireBackend()`, build the menu entry behind `hasBackend()`, and mark a
writer `needsBackend: true`. The framework filters both flags out of Save As,
save-back and autosave for you, and `cfg.binaryImporters` are dropped
wholesale when `canConvert()` is false — nothing else is needed for an
importer.

`OfficeContainer` (`common/container.js`) is the browser-side twin of
`mod/office/packed.go`: `pack(envelopeJson) -> Uint8Array` and
`unpack(bytes) -> envelopeJson` for the native zip containers, with assets
inlined as data URLs on the way in and re-extracted on the way out. It is
what makes the standalone build able to open a file ArozOS wrote, and write
one ArozOS can open. Only `platform.js` calls it.
Tests: `node common/test_container.js`.

`OfficeRecents` (`common/recents.js`) is the suite's *browser-side* recent
document list, and the thing that makes the home page work. A file the visitor
picked is a `File` that dies with the page, so a recent document here is a
**copy of the document**, not a pointer to one: the index (name, app, size,
time) lives in `localStorage` so it can be read synchronously, and the bytes
live in IndexedDB. `OfficePlatform` writes to it on every open and save in the
standalone host, and resolves `recent:/<id>` back out of it.

```js
OfficeRecents.supported()                          // is there anywhere to store?
OfficeRecents.index()                              // newest first, synchronous
OfficeRecents.remember({name, app, ext, bytes}, cb(id), errcb)
OfficeRecents.load(id, cb(Uint8Array), errcb)
OfficeRecents.touch(id) / forget(id, cb) / clear(cb)
```

Entries are keyed by name + app, so re-saving updates one entry rather than
piling up copies, and both a count and a total-bytes cap evict the oldest.

**Entry points.** Any page can point an app at something to load, in either
host — this is how the home page opens templates and recent documents:

| link | effect |
|---|---|
| `?open=<relative path>` | open a document published next to the app |
| `?template=<relative path>` | load it as a **new unsaved document**, so Save asks for a name instead of writing back over the template |
| `?recent=<id>` | reopen one of this browser's recent documents |

Paths must be relative; `fetchRelative` refuses anything with a scheme, so
`?open=` cannot be turned into a fetch of another site. A path that is not a
vpath (`user:/`, `local:/`, `recent:/`, …) is read over HTTP and unpacked
client-side **in both hosts**, which is what lets `templates/` work in ArozOS
as well as in the web edition.

`OfficeWasm` (`common/wasm.js`) loads the WebAssembly converters
(`Office/common/wasm/office.wasm`, built from
[`src/wasm/office`](../../../wasm/office)) the first time a conversion is
actually asked for — never on page load, since the module is several MB and
most visitors only ever read a `.doca`. Only `platform.js` calls it; the
suite goes through `convertIn`/`convertOut`.

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

## Save formats (`saveFormats`) — living in a foreign file

By default a document can only be *saved* into the app's own container; a
`.csv` or `.xlsx` you opened was an import, and Save became Save As. Declaring
`saveFormats` lets an app write other formats too:

```js
saveFormats: [{
    ext: ".csv",
    label: "CSV (.csv)",              // shown in the Save as submenu
    icon: "file alternate outline",   // semantic icon name
    oneWay: true,                     // optional; a rendering such as PDF
    hidden: true,                     // optional; save-back only, kept out of
                                      // the Save as list (a second extension
                                      // for a format already listed, .htm)
    noAutosave: true,                 // optional; too expensive to run on a
                                      // timer - autosave skips it and keeps
                                      // the session snapshot instead
    unsupported: function(){ return ["2 charts"]; },   // null/[] = fine
    save: function(fp, fn, done, fail){ … }            // fail(msg) on error
}]
```

What the framework then does:

- **File > Save as** turns into a format picker — the native container first
  (still `Ctrl+Shift+S`), then one entry per format. With no `saveFormats` it
  stays the plain "Save as..." command it has always been.
- **Opening one of these formats keeps the document attached to that file**:
  `filepath`/`filename` stay the original (`sales.csv`, not `sales.xlsa`), so
  `Ctrl+S` writes straight back in the same format. An imported format with
  **no** matching entry is read-only as before — `filepath` is null and Save
  falls through to Save As.
- **`unsupported()` is a veto, not a warning.** A foreign format holds less
  than the container does, so return a list of plain-string reasons ("2
  charts", "3 sheets — a delimited text file holds only one") when the
  document would lose content. The framework refuses the write and offers
  "Save as `<native ext>`..." instead. Reasons are escaped, never treated as
  markup. Return `null`/`[]` when the format fits. Keep purely cosmetic
  losses (fonts, colors, column widths) *out* of the list — vetoing on those
  nags on every save.
- **`oneWay: true`** marks a rendering (PDF): it is written, but the document
  keeps its own path and stays dirty, because you cannot reopen it.
- **Autosave** writes a foreign format only while `unsupported()` passes, and
  never writes one marked `noAutosave`; in either case it silently skips the
  file and falls back to the session snapshot rather than popping a dialog.
  `noAutosave` is for writers whose *preparation* is the expensive part —
  Slides rasterizes every chart and seeks each video for a poster frame, Docs
  refetches and re-rasterizes every image — which is fine once on Ctrl+S and
  wrong every 25 seconds.
- **A warning strip appears under the toolbar** for as long as the open file
  is not the app's own container, because living in a foreign file means
  everything that format cannot hold is dropped on every save. Its **Convert
  to `<native ext>`** button asks where to put a native copy, writes it, and
  opens it in a window of its own (`OfficePlatform.openDocument`) — this
  editor stays on the original file. The framework owns all of it
  (`updateForeignBanner` / `convertToNative`, `.of-fmtbanner` in
  `office.css`); apps need do nothing, and a native document never sees it.

All three apps declare `saveFormats`; Sheets is the reference implementation
(`sheets/sheets_io.js`, `SAVE_FORMATS`).

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

## Imported-deck fidelity props (slides.js)

A deck opened from a `.pptx` / `.odp` carries the typography and geometry of
the file it came from, which the editor's own objects do not have. Every one
of these is **optional** — a document made in the editor omits them and falls
back to the stylesheet, so nothing here changes how a new deck looks.

| prop | on | meaning |
|---|---|---|
| `fontFamily` | text, shape | CSS font stack (latin + east-asian face, then a generic) |
| `valign` | text, shape | `top` / `middle` / `bottom` — the text box's vertical anchor |
| `pad` | text, shape | text insets `[top, right, bottom, left]` in px |
| `lineHeight` | text, shape | unitless line-height multiplier |
| `crop` | image | `[left, top, right, bottom]` fractions clipped off the source |
| `mask` | image | a shaped crop: a `SHAPE_KINDS` kind the picture is clipped to |
| `orig` | image | `{x,y,w,h}` the frame before the first crop — Reset image |
| `flipH` / `flipV` | image | mirrored horizontally / vertically |
| `recolor` | image | a re-colour preset key (`RECOLORS` in `slides_image.js`) |
| `bright` / `contrast` | image | adjustment offsets; 0 = leave alone, range ≈ -0.9..1 |
| `radius` | image, shape | corner radius in px |
| `opacity` | image | 0..1; 0 means fully opaque |
| `points` | line | the polyline a bent connector follows, relative to `x`/`y` |
| `arrowStart` | line | arrow head at the first point |
| `cellFill` | table | per-cell background colours, `rows`-shaped |
| `cellPad` | table | cell insets `[t, r, b, l]` in px |
| `html` | shape | rich paragraph HTML, used in place of the plain `text` |

`props.html` is the same restricted HTML text objects use: one `<div>` per
paragraph carrying `text-align` / `line-height` / margins / `padding-left`,
one `<span>` per run carrying font, size, weight and colour, and — for a
bulleted paragraph — an absolutely positioned marker span that reproduces
PowerPoint's hanging indent. `renderObjectEl` renders it as-is, so anything
written into it must already be escaped.

**Cropping is a view, never a change to the pixels.** The object frame says
which part of the picture is visible; `props.crop` says which part of the
source that is. The two are tied together by one identity, which the crop
tool, the renderer and both format writers all rely on:

```
fullWidth = frame.w / (1 - crop.left - crop.right)      // and the same for h
fullLeft  = frame.x - crop.left * fullWidth             // where the whole picture sits
```

While the crop tool is open (`startCrop`, double-click a picture or the
toolbar's crop button) the object itself is hidden — `.sl-obj.sl-cropping` —
and `#slCrop` draws the whole picture ghosted with the kept part at full
strength on top. Dragging a grip moves the *frame*; dragging the picture
moves the *source underneath it*. Enter or a click outside applies, Esc
restores. **Reset image** clears `crop`, `mask` and `radius`, puts the frame
back to `props.orig` (stamped the first time a picture is trimmed) and
corrects the height to the source's own aspect ratio.

`mask` maps onto a `prstGeom` on the `p:pic` in .pptx, so a shaped crop made
here and one made in PowerPoint are the same thing; the renderer draws it as
a `clip-path` built from `SlidesShapes.points()` - stated in percentages, so
the clip follows the frame as it is dragged. That is why the crop shapes are
the catalogue's polygons and not all of it: a curved outline would have to be
restated in pixels at every size.

## Picture tools (slides/slides_image.js)

`SlidesImageTools` owns everything that acts on a selected picture, so
`slides.js` stays about the document and the canvas. It never touches the
model directly — `init()` takes a host object of callbacks (`getImage`,
`commit`, `startCrop`, `setMask`, `resetImage`, …) and slides.js drives it
with `sync()` / `reposition()` from `setSel`, `commit` and `renderOverlay`.
**`init()` must run before `OfficeApp.init()`**: loading a document selects
objects, and that syncs the tools.

Three pieces:

- the **floating picture bar** — the text-edit bar's chrome (`.of-textedit-bar`,
  `.of-te-btn`) anchored under a selected image: crop, reset, format options.
  Crop and the crop shapes are one split control, the caret opening the grid.
- the **shape grid** — the crop shapes as icons rather than names, drawn by
  `shapeIcon()` from the same `SlidesShapes` geometry the canvas uses, so an icon
  cannot drift from the mask it applies.
- the **format panel** — `#slFormatPanel`, docked to the right of `#slMain`
  (it is a flex sibling, so the canvas re-fits itself via `relayout`): size,
  rotation and flips, position and align-to-slide, re-colour and the
  brightness / contrast / transparency adjustments.

`imageFilter(props)` is the single place that turns `recolor` + `bright` +
`contrast` into a CSS filter, so the canvas, the thumbnails, present mode and
the panel's own swatches cannot disagree — the swatches are the picture
itself seen through each filter, so the preview *is* the result.

The presentation body may also carry `fonts`: `[{family, weight, style, src}]`
where `src` is a font-file data URL taken from the source deck's embedded
fonts. `normalizeBody` installs them as `@font-face` rules in a single
page-level `<style id="slEmbeddedFonts">`, shared by the editor, the
thumbnails, present mode and print.

## OfficeCharts (common/charts.js) — for Sheets and Slides

```js
var svg = OfficeCharts.renderToString(spec, width, height); // svg string
OfficeCharts.render(containerEl, spec);                     // fit container
// spec: { type:"bar"|"line"|"pie", title, labels:[…],
//         series:[{name, values:[…], color?}],
//         options:{ legend, gridlines, stacked } }
```
Text inherits `currentColor` → theme-aware automatically.

## Document fonts (common/fonts/, OFL)

`OfficeFonts` (`common/fonts.js`) owns the families the suite ships with
itself and the rules for falling back between them. Read
[`fonts/README.md`](fonts/README.md) before touching the files.

```js
OfficeFonts.MENU                    // family names for a font picker
OfficeFonts.stack("Arial")          // -> "Arial, Noto Sans, Noto Sans TC, …"
OfficeFonts.isShipped("Noto Sans TC")
OfficeFonts.faceFor(family, bold, italic)   // -> { url, synthBold, … } | null
OfficeFonts.preload(["Noto Sans TC"])       // -> Promise
```

**Every font-family a document carries must go through `stack()`.** A bare
family name sends any character it has no glyph for to whatever the machine
happens to have — and a system font's bytes cannot be embedded, so that text
can only reach a PDF as a picture. The tail `stack()` appends is what keeps
it exportable. This applies on the Go side too: `fontStackFor`
(`mod/office/pptx_text.go`) appends the same list to every stack an import
writes, and the two lists have to stay in step.

## Slides shape geometry (slides/slides_shapes.js)

`SlidesShapes` owns every shape the Slides editor draws, named after the
PresentationML preset it is. Paths use only `M`, `L`, `C` and `Z`, which is
what lets the canvas, `clip-path: path()` and the PDF exporter share one
geometry.

```js
SlidesShapes.path(kind, w, h)      // "M0 0L100 0..." ("" if unknown)
SlidesShapes.detail(kind, w, h)    // markings to stroke, or ""
SlidesShapes.points(kind, w, h)    // polygon corners, or null for a curved one
SlidesShapes.icon(kind, size)      // the same outline as a small SVG
SlidesShapes.canonical(kind)       // preset spelling -> catalogue name
SlidesShapes.isOpen / evenOdd / label / defaultSize / CATEGORIES
```

Adding a shape means adding it here and nowhere else - the picker, the
crop-shape grid, the canvas and the export all read from this one table.
Keep the names in step with `prstToShapeKind` (`mod/office/pptx_reader.go`).

`ALIASES` holds the three names the editor used before this file existed
(`round`, `arrow`, `star`). They are not shapes any more - `normalizeBody()`
rewrites them through `canonical()` as a document loads, so nothing
downstream has to know about them.

## Vendored libs (common/lib/, all MIT)

- `marked.min.js` — Markdown → HTML (Docs import)
- `pdf-lib.min.js` — PDF generation (global `PDFLib`). Used by the Slides
  PDF export, which builds the file in the browser out of real PDF objects
  (`slides/slides_pdf.js`).
- `fontkit.umd.min.js` — `@pdf-lib/fontkit`, which is what lets `pdf-lib`
  embed a font of our own. **Loaded on demand, not from the page**: it is
  the largest script here and only an export needs it (`loadFontkit` in
  `slides_pdf.js` injects the tag). Its subsetter has sharp edges that the
  shipped fonts are built to avoid — see `fonts/README.md`.
- `html2canvas.min.js` — DOM → canvas (Slides PNG export). **Not** the
  first choice for the PDF export's raster fallback: it re-implements
  layout over a clone and re-wraps mixed-script text. That path uses an
  SVG `<foreignObject>` so the browser lays out its own content, and only
  falls back here if that fails outright.

## Testing without a full ArozOS server

`python -m http.server 8123 --directory src/web` then open
`http://localhost:8123/Office/docs/index.html`. ao_module tolerates running
outside the desktop; `vfsLoad/vfsSave` and file selectors will fail politely
(no ArozOS backend) — all pure-front-end features must still work. Run
`node --check app.js` for syntax. Do not add build steps.
