# ArozOS Office Suite

A self-hosted office suite for the ArozOS web desktop: **Docs** (word
processor), **Sheets** (spreadsheet) and **Slides** (presentations). Three
webapps, one shared framework, one Go conversion library.

This README is the developer handoff document: it explains how everything
fits together, why the non-obvious decisions were made, and where to start
when you continue development.

| App | Folder | Native ext | Interop formats |
|---|---|---|---|
| Docs | [`docs/`](docs/) | `.doca` | .docx, .odt, .pdf (export), .html, .md, .txt |
| Sheets | [`sheets/`](sheets/) | `.xlsa` | .xlsx, .ods, .pdf (export), .csv, .tsv |
| Slides | [`slides/`](slides/) | `.ppta` | .pptx (+ media zip), .odp, .pdf (export), .png |

All three apps are registered by the single [`init.agi`](init.agi) in this
folder (module registration only — it runs with system scope, don't put
user/file logic in it).

Two more folders sit alongside them:

- [`home/`](home/) — the suite's home page: create a document, pick up a
  recent one, or start from a template. It is published to the root of the
  standalone web edition (see below) and also works in place at
  `Office/home/index.html`. Vanilla JS, no framework, no icon font.
- [`templates/`](templates/) — the getting-started templates. They are
  plain-JSON envelopes with native extensions (both unpackers pass a non-"PK"
  payload straight through), generated from readable literals by
  `node templates/build_templates.js` — **edit that file, not the
  `.doca`/`.xlsa`/`.ppta` output**, and keep `manifest.json` in step (the
  builder fails if the two disagree).

## Architecture at a glance

```
Browser (webapp JS)                      ArozOS server (Go)
┌─────────────────────────┐   agirun    ┌──────────────────────────────┐
│ docs/docs.js            │ ──────────► │ <app>/backend/*.agi          │
│ sheets/sheets.js + _io  │  JSON body  │  (Otto JS VM, user scope)    │
│ slides/slides.js        │             │        │ requirelib("office") │
│   + common/office.js    │             │        ▼                     │
│   + common/*.js widgets │             │ mod/agi/agi.office.go        │
└─────────────────────────┘             │  (permission + vpath glue)   │
                                        │        ▼                     │
                                        │ mod/office/*.go              │
                                        │  (pure converters, no I/O)   │
                                        └──────────────────────────────┘
```

Three layers, strictly separated:

1. **Front end** — each app keeps its whole document as one JSON "body"
   in memory (schemas below). All editing is client-side; the server is
   only touched for open/save/import/export.
2. **AGI backends** — thin `.agi` scripts in each app's `backend/` folder
   plus the shared [`common/backend/`](common/backend/). They only
   validate parameters and call the `office` AGI library. Keep them thin:
   the Otto VM is slow and single-purpose.
3. **Go library** — [`src/mod/office/`](../../mod/office/) does every
   format conversion as a pure `[]byte`/struct transformation (no file
   I/O, no globals). [`src/mod/agi/agi.office.go`](../../mod/agi/agi.office.go)
   wraps it with per-user permission checks and virtual-path handling.
   API docs: the *office* section of
   [`src/mod/agi/README.md`](../../mod/agi/README.md) — **keep it and
   [`src/web/Terminal/docs/api.json`](../../web/Terminal/docs/api.json)
   in sync whenever you change an `office.*` function.**

### Two hosts, one code base

The same front end also ships as a **standalone web edition** ("ArozOS Office
Web"): the suite served by a plain static file server with no ArozOS behind
it, so a document can be shared with someone who has no account. Documents
are opened from and saved back to the visitor's own device, native containers
are packed and unpacked in the browser, and every server-side conversion is
switched off.

That is not a fork. Everything reaching outside the browser tab goes through
[`common/platform.js`](common/platform.js) (`OfficePlatform`), which carries
both host implementations and picks one from the flags in
[`common/mode.js`](common/mode.js);
[`common/container.js`](common/container.js) is the browser-side twin of
[`packed.go`](../../mod/office/packed.go). The generator
[`apps/ArozOS Office Web/generate.go`](../../../apps/ArozOS%20Office%20Web/generate.go)
copies the tree, drops the `.agi` backends, and flips those flags — that is
the whole build.

The **Office interchange formats work there too**: `mod/office` is pure
`[]byte`/struct code with no I/O, so it compiles to WebAssembly
([`src/wasm/office`](../../wasm/office)) and the standalone build runs the
identical converters in the page — a `.docx` it writes is what ArozOS would
have written. `generate.go -wasm` builds and ships that module, and
`common/wasm.js` fetches it the first time an import or export is used.

Two capability questions, and they are **not** the same:

- `OfficePlatform.hasBackend()` — is there a server? (storage, AGI scripts,
  the real-text PDF renderer)
- `OfficePlatform.canConvert()` — can this build convert Office formats?

**Gate anything new on the right one** (details in `CONTRACT.md`), or it will
be a dead menu entry out there.

**Read [`common/CONTRACT.md`](common/CONTRACT.md) before touching any
front-end code** — it defines the shared `OfficeApp` framework (toolbar,
menus, file open/save, busy/toast/status, print), the widget libraries
(`textedit.js` floating format bar, `colorpicker.js`, `charts.js`,
`clipboard.js`, `hotkeys.js`), the page skeleton, and the house rules
(no emoji in source, no cross-webapp imports, ES5-ish style, must work
both in a FloatWindow and a plain tab).

## Document body schemas (the JSON each app edits)

Go structs are the source of truth — they mirror the JS exactly:

- **Docs** (`document`): [`docx.go`](../../mod/office/docx.go) —
  `{html, page{size, orientation, margins(mm), columns, colGap}, header,
  footer, hfMode, pageNumbers, comments, trackChanges}`. `html` is a
  sanitized contenteditable subset (see `sanitizeHtml` in `docs.js`).
  `hfMode` (`all` | `except-first` | `none`, Format > Header & footer)
  says which pages repeat the header/footer text; empty means `all`, so
  documents written before the setting existed keep their behaviour.
- **Sheets** (`spreadsheet`): [`xlsx.go`](../../mod/office/xlsx.go) —
  `{sheets[{name, cells{"A1":{v,s,n}}, colW, rowH, merges, freeze,
  charts, filter, cf}], active}`. Cell `v` is the raw input (`=`-prefix =
  formula, evaluated client-side in [`sheets/formula.js`](sheets/formula.js)).
  `cf` is the sheet's conditional-format rules (below) — client-side only,
  so the Go structs do not model it.
- **Slides** (`presentation`): [`office.go`](../../mod/office/office.go) —
  `{size:[960,540], theme, slides[{id, bg, notes, objects[{type, x, y, w,
  h, rot, z, props}]}]}`. Object types: `text`, `image`, `shape`, `line`,
  `table`, `chart`, `video`, `audio`.

## Native file format (.doca / .xlsa / .ppta)

Handled by [`packed.go`](../../mod/office/packed.go) +
[`common/backend/container.agi`](common/backend/container.agi):

- A **zip container**: `body.json` (the schema above with big assets
  stripped) + an `assets/` folder holding images/video/audio binaries.
- Legacy plain-JSON files (pre-container) still load transparently.
- On **open**, `office.unpackToWorkdir` extracts assets into a per-document
  cache dir under the user's appdata and rewrites references to
  `media?file=<vpath>` links, so multi-MB media never rides the JSON body.
  On **save**, `office.packToFile` re-resolves those links (server-side,
  via a permission-checked vpath reader) and embeds them back.

## Import / export — how each path works and why

Every import/export is **server-side** through `mod/office`, *except*
things only a browser can compute, which the client pre-bakes into the
body before posting:

- **Charts** → client rasterizes to PNG (`props.png` in Slides,
  chart PNGs in Docs export) because native OOXML charts are out of scope.
- **Images** → client inlines to data URLs (`inlineImagesForExport`).
- **Video poster frames** → client captures a real frame per video
  (`captureVideoFrame` in `slides.js`) into `props.png`.
- **Sheets PDF print model** → client sends formatted display strings +
  styles (`Core.buildPrintModel()` in `sheets.js`) because formula
  evaluation and number formatting live in the client.
- **Emoji in Docs PDF** → client rasterizes each emoji to a small PNG
  (`rasterizeEmojiForPdf` in `docs.js`) because PDF core fonts are
  Latin-1 and have no emoji glyphs.

### Slides: cropping a picture

Cropping never touches the pixels. The object frame says which part of the
picture is visible and `props.crop` says which part of the source that is —
the same definition PowerPoint's `srcRect` uses, so a crop made in the
editor and one made in PowerPoint are interchangeable. `fullImageRect()`
in `slides.js` inverts the pair to find where the whole picture sits, and
that is the whole of the crop tool's geometry.

Three commands, on the picture's context menu and on the toolbar (which
shows them only while a picture is selected):

- **Crop image** (also a double-click) opens the tool: the object itself is
  hidden and the overlay draws the whole picture ghosted with the kept part
  at full strength over it. A grip moves the frame; dragging the picture
  moves the source behind it. Enter or a click outside applies, Esc restores.
- **Mask image** clips it to any of the editor's shape kinds (`props.mask`),
  drawn as a `clip-path` built from the same `shapePoints()` the shape
  objects use, and written to `.pptx` as a `prstGeom` on the picture.
- **Reset image** clears the crop, the mask and the corner radius, puts the
  frame back to `props.orig` — stamped the first time a picture is trimmed,
  and holding the frame the *whole* picture filled — and corrects the height
  to the source's own aspect ratio, so a picture stretched by dragging a
  corner comes back undistorted too.

### Sheets formula engine

[`sheets/formula.js`](sheets/formula.js) is a DOM-free tokenizer, parser and
evaluator that also runs under Node, so it is unit-tested directly:

```bash
node web/Office/sheets/test_formula.js    # exits 1 on failure
```

Functions: `IF IFS IFERROR IFNA AND OR NOT` · `VLOOKUP HLOOKUP` ·
`SUM AVERAGE MIN MAX COUNT COUNTA` · `ROUND ABS INT` ·
`CONCAT LEN UPPER LOWER TRIM` · `TODAY NOW`.

Two deliberate departures from Excel, both matching Sheets:

- **`IF`'s `value_if_false` is optional and blank when omitted.** Excel
  answers `FALSE`, which put a stray "FALSE" in the cell for the very common
  `=IF(A2="foo","A2 is foo")` shape.
- **Text comparison is case-insensitive** everywhere, so `="Google"="google"`
  is true and `VLOOKUP("oRaNgE", ...)` finds `Orange`.

`VLOOKUP`/`HLOOKUP` default to the approximate ("is_sorted") mode. Excel and
Sheets binary-search there, which returns arbitrary answers on unsorted data;
this scans and keeps the best match at or below the key instead — identical
on sorted data, merely imperfect rather than arbitrary on unsorted. `FALSE`
means exact match, and a miss is `#N/A` so `IFERROR`/`IFNA` can catch it.

Not implemented: `COUNTIF`/`SUMIF`/`AVERAGEIF`, `INDEX`/`MATCH`, and
cross-sheet references. Add new functions to the `call()` switch in
`formula.js` and pin them with a case in `test_formula.js`.

### Sheets conditional formatting

[`sheets/sheets_cf.js`](sheets/sheets_cf.js) (`SheetsCF`) re-evaluates rules
every time the grid paints. Rule kinds: empty/not-empty, the text tests
(contains, starts/ends with, is exactly), numeric comparisons incl. between,
date before/after/on, and a **custom formula**.

**Rules belong to cells, not to the sheet.** `cell.cf` lists the rule ids a
cell carries and `sheet.cfDefs` holds the bodies. That is what makes a rule
behave like the rest of a cell's formatting: the panel shows only the rules
on the current selection, and a rule travels on move, copy and fill because
those already move whole cell objects (`deep(cell)`). Applying to a range
stamps the id onto every cell in it, so range-wide rules are still one
action — including onto empty cells, so a value typed there later is still
formatted. `MAX_STAMP` caps how many cells one apply may touch.

The id is shared, so editing is **copy-on-write**: the edit mints a new def
and swaps it onto just the selected cells, leaving other cells that shared
the old rule alone. `sweepDefs()` drops bodies nothing references.

Ids are used rather than inlining rule objects per cell because `snap()`
JSON-stringifies the whole body into the undo stack on every commit, 80 deep
— a 1000-cell column rule costs ~27 KB this way instead of well over 100 KB.

Two things make range rules work without a separate rule kind:

- A **custom formula** is parsed once and evaluated per cell, with relative
  references shifted from the range's top-left anchor and `$`-anchored ones
  left alone — so `=SUM($B1:$D1)>$E1` tests each row against its own total,
  and `=SUM($B$1:$D$4)>200` tests one aggregate for the whole block.
- An **operand** may itself be a formula, evaluated once per rule rather
  than per cell, so "is greater than `=AVERAGE($F$2:$F$99)`" costs no more
  than a plain number.

Formulas are compiled once per distinct source and their reference nodes are
rewritten in place before each evaluation (`compile` / `evalAt`); re-parsing
per cell was far too slow for a repainting grid.

Rules are first-match-wins **per property**, like Google Sheets: the topmost
rule that sets a background owns the background, and a later rule can still
contribute a text colour the first left alone. `styleAt()` stays the cell's
own style (what the toolbar edits and what is saved) while `effStyleAt()`
layers the matching rule on top — paint and the PDF print model read the
second, everything that edits formatting reads the first, so a rule is never
mistaken for something the user applied by hand.

Rules ride in the document body, so they persist in `.xlsa` and reach PDF
export through the print model. **They are dropped on `.xlsx` / `.ods`
export** — those writers would need real DXF / style-map records, and the Go
structs model neither `cell.cf` nor `sheet.cfDefs`. If that matters, the
alternative is baking the resolved colours into the exported cells' own
styles at export time.

### Saving back into a foreign format

All three apps declare `saveFormats` (see
[`common/CONTRACT.md`](common/CONTRACT.md)), so a document opened from a
foreign format **stays that file**: `Ctrl+S` rewrites it in its own format
instead of forcing a Save As to the native container, and File > Save as
offers the whole list (plus PDF, which is one-way).

| App | saved back into | declared in |
|---|---|---|
| Docs | .docx, .odt, .html/.htm, .md, .txt (+ .pdf one-way) | `SAVE_FORMATS` in [`docs/docs.js`](docs/docs.js) |
| Sheets | .xlsx, .ods, .csv, .tsv (+ .pdf one-way) | `SAVE_FORMATS` in [`sheets/sheets_io.js`](sheets/sheets_io.js) |
| Slides | .pptx, .odp (+ .pdf one-way) | `SAVE_FORMATS` in [`slides/slides.js`](slides/slides.js) |

Each format vetoes what it cannot hold — `.csv`/`.tsv` reject formulas,
charts, notes, merges and second sheets; `.ods` rejects charts
(`ods_writer.go` cannot represent them); `.odp` rejects video and audio
objects (`odp_writer.go` emits no case for them); every Docs writer but the
native one rejects comments and pending suggestions, because they are fed
`resolvedHtml()` and would come back with insertions accepted and deletions
applied; `.txt` additionally rejects images and tables; `.xlsx` and `.pptx`
take everything. The veto lists what would be lost and offers the native
extension instead, so no save quietly drops content. Purely visual formatting
is deliberately *not* a veto reason: it would fire on nearly every CSV edit.
When a format's Go writer gains or loses a capability, update the matching
`unsupported()`.

**The banner.** Living in a foreign file is the right default — somebody who
opened a `.docx` wants a `.docx` back — but it also means every feature that
format cannot hold is dropped on each save. So the framework shows a warning
strip under the toolbar for as long as the open file is not native
(`updateForeignBanner` in [`common/office.js`](common/office.js), styled
`.of-fmtbanner` in [`common/office.css`](common/office.css)), with the one
click out: **Convert to `<native ext>`** asks where to put a native copy,
writes it, and opens it in a window of its own through
`OfficePlatform.openDocument` — leaving this editor on the original file,
because which of the two to go on working in is the person's call. Native
documents never see any of it, and the strip can be dismissed per file.

All that pre-baking makes the export payload big, and the AGI gateway reads
its POST parameters with Go's `r.ParseForm`, which **drops every parameter
once a urlencoded body passes 10 MB** (the connection is then reset
mid-upload and the app can only report "cannot reach the ArozOS backend").
Export calls therefore go through `OfficeApp.agirunLarge` instead of
`ao_module_agirun`: under 4 MB it posts normally, above that it uploads the
payload to `user:/.appdata/Office/tmp/` through the system upload endpoint
(streamed to disk - the host never has to buffer it in RAM, which matters on
low-memory boards) and passes `dataFile` to the backend script, which reads
and deletes it. Raising the server-side form limit is *not* an option here.

### Header / footer

The header and footer are one editable pair per **simulated** page: the
editor keeps a copy in every sheet's margin band (`layoutHeaderFooters`
in `docs.js`), all of them editable and mirroring each other, so the text
can be changed from any page. They are absolutely positioned on purpose —
an in-flow header ate page-one content and made the preview disagree with
the export about where the first page ends.

Pagination is measured from the live DOM, so it can only be right once the
DOM has its final size: a document opened from disk paginates while its
pictures are still decoding (a fresh `<img>` measures **zero** tall until
its `load` fires), which used to leave the bands and the automatic page
breaks positioned for a much shorter document. `watchContentSize()` in
`docs.js` re-runs `updatePageGuides()` whenever the flow changes height on
its own — image `load` (captured on `#editor`, since `load` does not
bubble), `document.fonts.ready`, and a `ResizeObserver`. Keep that hook
alive when touching the boot path.

`hfMode` maps onto each format's own mechanism:

| mode | preview | PDF | DOCX | ODT |
|---|---|---|---|---|
| `all` | band on every sheet | header/footer func on every page | `header1.xml` / `footer1.xml` | `style:header` / `style:footer` |
| `except-first` | page one's band hidden | `hfOnPage()` skips page 1 | `<w:titlePg/>` and no first-page part | empty `style:header-first` / `style:footer-first` |
| `none` | no bands | no header/footer text | no parts written | no header/footer elements |

The page counter (`pageNumbers`) stays its own page-setup option, except
that a suppressed first page suppresses its number too — the same thing
Word's `titlePg` does. Browser **printing** repeats one `position: fixed`
pair on every sheet (print engines cannot skip page one); PDF export is
the path that honours every mode exactly.

### Format notes (hard-won lessons — don't re-learn these)

- **PPTX/ODP import is inheritance, not element reading.** A deck's
  appearance is almost never stated on the shape you are looking at. The
  readers ([`pptx_reader.go`](../../mod/office/pptx_reader.go) +
  `pptx_text.go` / `pptx_xml.go`, [`odp_reader.go`](../../mod/office/odp_reader.go))
  resolve, lowest priority first: the presentation's default text style,
  the master's `txStyles` for the placeholder kind, the master's and then
  the layout's matching placeholder `lstStyle`, the shape's own `lstStyle`,
  the paragraph's `pPr`, the run's `rPr` — per outline level. Colours go
  through the theme's `clrScheme` *and* the master's `clrMap` (that is what
  makes `tx1` mean `dk1` on one deck and `lt1` on another), with the
  `lumMod`/`lumOff`/`shade`/`tint` transforms applied. A slide is drawn on
  top of its layout's decoration and the master's, minus their
  placeholders, which are prototypes rather than content. Skipping any of
  this does not merely lose polish — text lands at the wrong size, in the
  wrong place, sometimes white on white. `pptx_fidelity_test.go` pins each
  rule with the smallest package that exercises it; the ODF equivalents are
  in `odf_test.go`.
- **Line spacing is `1.2 × the stated percentage`.** PowerPoint's "single"
  spacing is the font's line height, so `<a:lnSpc><a:spcPct val="115000"/>`
  is CSS `line-height: 1.15 × 1.2`. The constant is `pptxLineHeightFactor`,
  checked against Google Slides' own PDF export of a real deck. Two related
  traps: a paragraph's block `font-size` must be its **smallest** run (it
  is a floor under every line box, so a big run would inflate a short line
  under it), and an `<a:br/>` needs a sized zero-width span after it or the
  empty line it opens gets no height at all.
- **Embedded fonts are usually undecodable.** `<p:embeddedFontLst>` points
  at `.fntdata` parts, which are EOT wrappers.
  [`pptx_fonts.go`](../../mod/office/pptx_fonts.go) unwraps a bare sfnt or
  an *uncompressed* EOT (what PowerPoint writes) into an `@font-face` data
  URL, under a per-face and per-deck size cap so a multi-megabyte CJK face
  cannot make a document painful to edit. Google Slides writes
  MicroType-Express-compressed EOT, which needs a decompressor far larger
  than the rest of this package — those faces are declined and the text
  falls back to the CSS stack. That is the one remaining reason an imported
  deck can differ visibly from its source: the glyphs are a substitute, so
  a line may wrap a word earlier.
- **DOCX pagination** ([`docx_writer.go`](../../mod/office/docx_writer.go)):
  Word substitutes its own Normal-style defaults (Calibri etc.) unless the
  style sheet pins the editor's typography into `docDefaults` +
  `pPrDefault` *and* every named style. That's why `docxStyles` spells out
  Arial 11pt / 1.5 line-height / explicit spacing everywhere. Change the
  editor's typography → change it there too, or exported page breaks
  drift from the editor's.
- **PPTX video/audio are NOT embedded**
  ([`pptx_writer.go`](../../mod/office/pptx_writer.go)): embedded media
  (`a:videoFile` + `p14:media` + timing tree, python-pptx-identical
  structure) was implemented and still would not play reliably in
  PowerPoint/Google Slides, so the design is: slide shows the captured
  poster frame as a plain picture, and `BuildPptxMedia` returns a second
  `[]byte` — a **sidecar zip** of the media files that the AGI layer
  writes next to the pptx as `<name>.zip`. `presentationToPptx` returns
  the zip's vpath (string) instead of `true` when one was written; the
  client toasts it.
- **PDF export** ([`pdf.go`](../../mod/office/pdf.go) /
  [`pdf_doc.go`](../../mod/office/pdf_doc.go) /
  [`pdf_sheet.go`](../../mod/office/pdf_sheet.go) /
  [`pdf_slides.go`](../../mod/office/pdf_slides.go)): built on
  `github.com/go-pdf/fpdf` (MIT). Real selectable text, not screenshots.
  Gotchas encoded in `pdf.go` / `pdf_doc.go`:
  - **`CellFormat` does not clip, and the client's column widths do not
    survive the font change.** The client measures columns in the browser's
    UI font and sends CSS pixels; `pdf_sheet.go` draws the same text in
    Helvetica at 9pt, so a value that sat comfortably in its column on
    screen can come out slightly wider here — and fpdf happily paints it
    straight over the next column (`2026-08-24 21:01:2Yami Odymel`).
    Two layers deal with this, in order:
    1. `sheetFitColumns()` widens each column to its widest cell before
       laying out, so the data is shown in full rather than truncated. The
       growth is capped (`sheetColGrowMax`, `sheetColPageFrac`) so one very
       long cell cannot squeeze the rest into slivers. Widening is safe
       because widths and the font are then scaled by the same factor.
    2. `pdfFitText()` (`pdf.go`) is the backstop for what still cannot fit
       — mainly once the font hits its 5pt floor and stops shrinking with
       the columns. It trims to the width and marks the cut with an
       ellipsis, measuring the *translated* text but cutting on runes of
       the original so multi-byte characters never split.

    `TestSheetPdfCellsNeverOverlap` pins the invariant by reading back the
    text-drawing operators and asserting no two runs on a baseline collide;
    `TestSheetPdfKeepsValuesWhole` pins that the fix does not truncate data
    that could have been shown. Any new cell drawing must keep both true.
  - Core fonts are **cp1252** — all text goes through `pdfTr()`, which
    also normalizes `&nbsp;`/thin spaces to plain spaces (fpdf only wraps
    lines at real spaces; contenteditable HTML is full of nbsp and the
    lines wrapped comically early before this).
  - **Docs does its own line breaking and pagination** — `pdf_doc.go` is
    a small CSS-shaped layout engine (`boxes` → `pdfBox` → `pdfItem`),
    not a stream of `fpdf.Write` calls. It exists so the export
    paginates *exactly* like the editor's page preview:
    - HTML whitespace is collapsed like a browser collapses it
      (`collapseWS`). Pasted markup is hard-wrapped with real newlines;
      fpdf's `Write` treats those as forced breaks, which used to leave
      a wide blank gutter down the right of every page and inflate the
      page count.
    - `SetCellMargin(0)` + `SetAutoPageBreak(false)`: the browser wraps
      at the content edge, and a block that would cross the bottom
      margin moves to the next page **whole** (`place`), the same rule
      `updatePageGuides()` uses in `docs.js`.
    - Block margins collapse (`flow`), empty blocks follow the browser's
      rules (`<p></p>` = 0 tall, `<p><br></p>` = one line, a trailing
      `<br>` adds nothing), and `#editor img { height: auto }` means the
      aspect ratio wins over a `height` attribute.
    - Any metric change in `docs.css` (font size, line-height, block
      margins, cell padding, list indent) must be mirrored by the
      constants at the top of `pdf_doc.go`, or the two page counts drift
      apart.
    - Multi-column page layout (`page.columns`) is **not** implemented in
      the PDF exporter — those documents export as a single column.
  - Embedding a Unicode font was deliberately rejected (megabytes on the
    binary); CJK text transliterates/degrades. That's the top candidate
    if someone asks for CJK PDF export.
- **ODF** ([`odf.go`](../../mod/office/odf.go) + `od{t,s,p}_{reader,writer}.go`):
  the zip **must** store the `mimetype` entry first and uncompressed
  (`buildOdfZip` does this). XML round-trips through the order-preserving
  `onode` tree. Formula translation `=SUM(A1:B2)` ⇄
  `of:=SUM([.A1:.B2])` lives in `ods_{writer,reader}.go`.
- **XLSX** also round-trips charts as native DrawingML parts
  ([`xlsx_charts.go`](../../mod/office/xlsx_charts.go)) and cell notes as
  comments ([`xlsx_notes.go`](../../mod/office/xlsx_notes.go)).

## Testing & verification

```bash
cd src
go test ./mod/office/          # converter unit tests (every format)
go test ./wasm/office/         # the WebAssembly bridge's conversion table
go vet ./mod/office/ ./wasm/office/
gofmt -l mod/office/ wasm/office/      # must print nothing
node --check web/Office/docs/docs.js   # etc. for each edited JS file
node web/Office/sheets/test_formula.js    # formula engine
node web/Office/common/test_container.js  # native container (vs. packed.go)
sh ../scripts/check-conventions.sh --diff origin/master
```

- Tests are table-driven, pure in-memory (build → unzip → assert on XML,
  or parse → assert on structs). `pdf_test.go` has `pdfStreamsText()`
  which zlib-inflates PDF content streams so you can assert real text
  operators — use it for any new PDF feature.
- **Interop spot-checks** (optional but strongly recommended for format
  work): `python-docx`, `python-pptx`, `odfpy` and `pymupdf` open the
  generated files and expose their structure. When PPTX/DOCX behaves
  weirdly in a real Office app, generate a reference file with
  python-docx/python-pptx and **diff the XML part-by-part** — that's how
  both the pagination and media problems were cracked.
- **Front-end smoke test without a full server**: the repo's
  `.claude/launch.json` has a `webroot-static` config that serves
  `src/web/` on `:8123`; the apps load standalone (AGI calls fail
  gracefully). Menus/toolbars/editing are all testable this way.

## Ideas / known gaps (future work)

- CJK/Unicode text in PDF export (needs an embedded font — see above).
- **MicroType Express decompression** so Google-Slides-embedded fonts can
  be used (see the format notes) — the last visible gap between an
  imported deck and its source.
- **Native OOXML chart *writing***. Charts are now *read* into live chart
  objects ([`pptx_chart.go`](../../mod/office/pptx_chart.go), from the
  `c:numCache` / `c:strCache` values, so no embedded workbook is needed),
  but they are still *written* as the client-rendered PNG in `props.png`.
  A round trip therefore turns a chart into a picture.
- Embedded fonts are read but not written back, so a `.pptx` exported from
  a deck that carried its fonts no longer carries them.
- A **shaped crop** (`props.mask`) round-trips through `.pptx` as the
  picture's `prstGeom`, but neither the `.odp` writer nor the PDF exporter
  draws one — ODF would need a custom shape with a bitmap fill, and
  `pdf_slides.go` places pictures as plain rectangles. The rectangular
  crop itself is exported to all three.
- Slides: SmartArt (`dgm:`), 3-D effects, shadows and animations are
  skipped rather than approximated.
- Real-time collaboration (the `sharedspace` AGI lib was built for this).
- Docs: footnotes, section breaks, multi-column export to docx/pdf
  (`page.columns` renders in-editor and exports to docx, but the PDF
  renderer ignores it).
- Sheets PDF: merged-cell rendering in the print model.
- Slides: shape text with per-run styling in pptx (currently
  object-level bold/italic/color only).

Happy hacking. The code tries hard to explain itself — when something
looks odd (mimetype-first zips, nbsp scrubbing, sidecar zips), there is a
comment at the site explaining why, and usually a test pinning it down.
