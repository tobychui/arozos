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
[`apps/arozos_office/generate.go`](../../../apps/arozos_office/generate.go)
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
  the Sheets PDF renderer — Docs and Slides render their own PDF in the
  browser and need no backend for it)
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
  `{html, page{size, orientation, margins(mm), columns, colGap, headerDist,
  footerDist}, header, footer, headerHtml, footerHtml, footnotes[{id, html}],
  lineSpacing, hfMode, pageNumbers, comments, trackChanges}`. `html` is a
  sanitized contenteditable subset (see `sanitizeHtml` in `docs.js`) — the
  **rich model** below. `header`/`footer` are the plain-text pair the editor
  types into; `headerHtml`/`footerHtml` win when set (an imported header with
  its own typography, a picture, a PAGE field). `lineSpacing` is the
  document's default multiple (1.15 when absent). `hfMode` (`all` |
  `except-first` | `none`, Format > Header & footer) says which pages repeat
  the header/footer; empty means `all`, so documents written before the
  setting existed keep their behaviour.

  The rich model is plain HTML with inline CSS **in points** plus a few data
  attributes, so one representation is shared by the editor, the layout
  engine, the PDF exporter and the DOCX reader/writer:
  - blocks: `padding-top` = spacing before (a heading's is `margin-top`,
    which collapses like Google Docs does), `margin-bottom` = after,
    `margin-left/right` + `text-indent` = indents, `border-*` + `padding-*`
    = paragraph rules and their space; `data-ls` (multiple),
    `data-lsexact` / `data-lsmin` (pt), `data-keep-next`,
    `data-keep-lines`, `data-widow="0"`, `data-page-break-before`,
    `data-tabs="right:451.3:dot;…"`.
  - lists: `ol/ul.doc-list[data-num][data-fmt][data-lvltext]` with
    `padding-left` and `--doc-hang`; the marker text is computed into
    `li[data-marker]` by the layout engine (Word numbering continues across
    lists that share a `data-num`).
  - inline: `span.doc-tab` (a real tab), `sup.doc-fnref[data-fn]`,
    `span.doc-field[data-field=PAGE|NUMPAGES]`.
  - pictures: `width/height` in pt, `object-view-box: inset(…)` for a crop,
    `img.doc-anchor` for one anchored above/below the text.
  - tables: `table.of-table` with a pt `width`, `table-layout: fixed` and a
    pt `<colgroup>`; cells state borders/padding/background inline.
    `data-docx="1"` marks a table laid out the Word way (no spacing around
    it) — one made in the editor has none and keeps docs.css's 8pt.
- **Sheets** (`spreadsheet`): [`xlsx.go`](../../mod/office/xlsx.go) —
  `{sheets[{name, cells{"A1":{v,s,n}}, colW, rowH, merges, freeze,
  hiddenRows, charts, filter, cf}], active, names[{name, formula, sheet?}]}`. `names` are the workbook defined names (`sheet` = the index of the sheet a
  sheet-local name belongs to). `hiddenRows` is the sorted list
  of 0-based rows the user hid (row-number context menu, Ctrl+Alt+9 /
  Ctrl+Shift+9, click the marker to show); it round-trips as
  `<row hidden="1">` in xlsx. Rows a filter hides are computed, not stored. Cell `v` is the raw input (`=`-prefix =
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
- A link is embedded wherever it sits: as a whole value (a Slides / Sheets
  image `src`) or inside an HTML string (a Docs body's `<img src="…">` /
  `<video poster="…">`, where the attribute value becomes
  `asset://<name>`). Only `src` and `poster` are embedded - an `href` to a
  file stays a link. Every unpacker (`UnpackEnvelope`,
  `UnpackEnvelopeToLinks`, and `common/container.js` in the browser)
  resolves `asset://` refs in both positions. This is what makes a `.doca`
  with pictures from the user's storage open with its pictures anywhere
  else - the standalone web edition included. Documents saved before this
  still hold links, and become portable on their next save.

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

### Docs: one layout, drawn three ways

A Docs page looks the same in the editor, in its PDF and (as far as Word's
model allows) in its `.docx`, because there is only one layout:

- [`docs/docs_layout.js`](docs/docs_layout.js) (`DocsLayout`) lays the live
  editor DOM out the way a word processor does and paginates it: line
  heights from real font metrics (`fontRatios`, measured on a 2048px canvas
  — CSS `line-height: normal` differs per font and per platform), list
  numbering, tab stops with leaders, table rules compensated for pixel
  snapping, keep-with-next / keep-lines / widow and orphan control,
  footnote space at the foot of each page. **A page boundary is real in the
  DOM**: whatever crosses it is split into two elements — a paragraph at a
  line, the list or quote around it, a table row cell by cell (a copy of
  the row takes the rest of every cell) — and a `.doc-autobreak` spacer
  between the halves carries the second one to the next sheet. Each half is
  a box of its own, so borders, shading and cell rules end at the bottom of
  their page. The halves are paired by a token (`data-split` on the head,
  `data-split-of` on the tail, `data-pair` on the spacer; CSS
  `.doc-split-head/-tail` drops the spacing and rule at the cut and the
  marker of a continued list item). Undoing a split moves the tail's content
  back and rejoins the divided text node, following the caret through it.
  Editing around a cut goes through the same undo: `unsplitAtCaret` runs
  before Backspace/Delete at the edge of a cut and before any key typed over
  a selection that spans one, `unsplitWithin` before a table gains or loses
  a row or column, and `repairSplits` drops what editing left behind (a tail
  whose spacer was deleted, a marker copied by Enter). A relayout after
  typing starts from the page that was edited. Nothing it adds is saved:
  `stripLayoutArtifacts()` in `docs.js` undoes every split and removes every
  spacer and computed attribute before a body is serialized (the paste
  sanitizer strips them too).
- The paper is **one `.doc-sheet` per page** in `#pageSheets`, behind the
  transparent `#page`. The gap between two sheets is empty space, not a
  band painted over one long sheet, and since nothing in the flow sits
  there, nothing can show through. The status bar's "Page N of M"
  follows the caret, or the middle of the view after a scroll.
- [`docs/docs_pdf.js`](docs/docs_pdf.js) (`DocsPdf`) reads each sheet of that
  DOM: text runs at the browser's baselines, fills and borders (a collapsed
  table rule at the width the document states), pictures with their crop,
  list markers (a disc/ring/square bullet becomes the shape at the glyph's
  measured ink box — the only face shipped with the glyph is a CJK one,
  twice the size), tab leaders and the footnote rule. **The export does not
  hold the editor.** The page is only held while it is measured (a few
  hundred ms for 90 pages, in its export state); what to draw is written
  down as a plain-data display list, and
  [`common/pdfworker.js`](common/pdfworker.js) assembles the file with
  [`common/pdfdraw.js`](common/pdfdraw.js) in a Web Worker — embedding and
  deflating pictures, subsetting fonts and serializing is where the time
  goes (on the 92-page reference it held the page for ~14s before). The
  same `pdfdraw.js` runs in the page when a worker cannot be started.
  Progress shows in `OfficeApp.showProgress`, as in Slides, and the
  document can be edited meanwhile without changing the file that comes
  out. Font resolution against the shipped Noto faces, text runs and the
  raster fallback live in [`common/pdfcore.js`](common/pdfcore.js), also
  used by Slides. `docs/backend/docx.agi`'s `export-pdf` and
  `mod/office/pdf_doc.go` remain for AGI callers (`office.documentToPdf`),
  but the editor no longer uses them.
- **Columns** (`page.columns` > 1) paginate the same way. Before each
  layout, every run of text between two full-width blocks (`.col-span-all`,
  a page break) is wrapped in a layout-only `div.doc-colsec` that carries
  the CSS columns (`--doc-cols`, `--doc-colgap` on `#editor`). A section
  that fits its page balances; one that runs past the page bottom is given
  the height that is left and filled column by column
  (`.doc-colsec-fill`), and `splitColumns` finds the first content that
  spilled into a column past the last one (`columnOverflow`: a paragraph at
  that character, a table at that row) and cuts there - so the copy of the
  section carries the rest to the next page like any other split.
  Sections are unwrapped with the spacers on everything saved. A columned
  document is always laid out whole (no incremental relayout), which is
  fine for the short papers the layout is for.
- The DOCX reader/writer (next section) map that same model to
  WordprocessingML and back.

Check changes against real documents: the round trip docx → editor → PDF
was tuned against Google Docs' own PDF exports; comparing text line
positions page by page (PyMuPDF on the PDF, `getClientRects()` on the DOM)
finds a regression in minutes where eyeballing takes hours.

### Slides: PDF export is rendered in the browser

**Sheets exports PDF on the server; Docs and Slides do not.** Slides'
exporter is [`slides/slides_pdf.js`](slides/slides_pdf.js) (`SlidesPdf`),
built on the vendored `pdf-lib`, and it runs against the very DOM the
editor is showing.

It draws each slide onto a **recording**, not a PDF:
`OfficePdfDraw.recorder()` ([`common/pdfdraw.js`](common/pdfdraw.js))
hands it stand-ins for pdf-lib's page, whose calls (`drawText`,
`drawImage`, `pushOperators`, ...) are written down as data - operator
arguments as the text they put in the content stream, fonts by the file
they come from (the fonts are still parsed in the page, for their glyph
widths), pictures by source. `OfficePdfDraw.run()` replays the recording
in the same Web Worker Docs uses, where the pictures are embedded and
deflated, the fonts subset and the file written. On a 30-slide deck of
large pictures that is the difference between an 11s freeze and a longest
stall of about a tenth of a second; the drawing code itself did not change.

The reason is that a slide's appearance is decided by the browser: which
font it resolved out of a stack, where each line wrapped, how tall each
line box came out. A server-side renderer has to re-derive all of that and
the derivations drift — the symptom was a CJK deck exporting as rows of
dots, because `fpdf`'s core fonts are cp1252 and the layout had been
guessed in Helvetica anyway.

Every element goes in as the PDF object it should be:

| element | becomes |
|---|---|
| text | real `Tj` text, one show-text per line fragment, at the baseline the browser laid it out on |
| image | the original JPEG/PNG bytes, embedded once and re-used |
| crop / shaped crop / rounded corners | a real PDF **clip path** (`shapePathOps`, from the same `SlidesShapes` geometry the canvas draws) |
| flip | a negative scale in the transformation matrix |
| transparency | an `ExtGState` with `/ca` |
| re-colour, brightness, contrast | the picture re-encoded through a canvas — a pixel operation in any renderer |
| shape | a real vector path from the catalogue, filled and stroked (even-odd where the shape has holes; stroked only, where it is a brace or a bracket) |
| line | a real vector polyline, arrow heads as filled triangles |
| table | real vector cell fills and rules, plus text |
| chart | the chart's own SVG, translated element by element into PDF vectors |
| rotation | one matrix about the object's centre, with the element measured unrotated |

**The font rule, and the one fallback.** A PDF can only show text in a font
it carries, and a browser will not hand over the bytes of a system font.
Three answers, tried in that order, per character (`resolveChar`):

1. one of the 14 standard PDF fonts, when the family the browser *actually
   resolved* is metrically identical to it (Arial / Liberation Sans →
   Helvetica, and so on) and the character is WinAnsi-encodable. Costs
   nothing and every reader already has them. Which family was resolved has
   to be measured, not asked: `document.fonts.check()` answers "is it
   loaded" and says yes to any name, so `haveFamily` probes widths against
   two generics instead.
2. one of the faces the suite ships with itself (`common/fonts`, see
   [the note there](common/fonts/README.md)) — fetched, parsed for glyph
   coverage, and embedded subset to the glyphs the deck actually used. This
   is what carries CJK.
3. nothing covers it — emoji, a script we do not ship — and only then does
   **that one text box** come in as a picture of itself.

A system font that is none of the above is stepped over rather than used,
and the character lands on the shipped face the document's own font stack
names next. That is the same thing the browser does when a font has no
glyph, which is why `OfficeFonts.stack()` is on the end of every
font-family the editor writes. Because a substituted face is not the one
the line was measured in, each fragment is then squeezed to the width the
browser gave it (`Tz`), so it cannot push the rest of the line out of
shape; when the face *is* the one the browser used, the ratio is 1 and
nothing happens.

Two things about placing the text that are easy to get wrong, and were:

- **The baseline is measured, not computed.** A canvas `measureText`
  reports the ascent and descent the browser resolved for a font stack —
  the very numbers it laid the text out with. Font files state metrics that
  browsers do not always use, and a system font states nothing we can read.
- **`Range.getClientRects()` returns the content box, not the line box**:
  ascent plus descent tall, not `line-height` tall. The baseline is an
  ascent below the top of that rect. Treating it as the line box puts every
  line a couple of pixels high at 30px type.

When a box does have to be rasterized, the picture is taken through an SVG
`<foreignObject>`, so the *browser* lays it out and paints it. html2canvas
was tried first and is wrong for this: it re-implements layout over a
clone, and on mixed CJK/Latin text with `pre-wrap` it breaks lines
somewhere the browser did not — exactly the drift this rework removes. It
survives only as a last resort for the case where even the foreignObject
route fails, because a wrong element beats a missing one. Two things that
route needs and that are easy to get wrong: the computed styles have to be
inlined onto the clone (an SVG image cannot reach the page's stylesheets),
and the markup must be serialized with `XMLSerializer` — `innerHTML`
writes `<br>` unclosed, which is not well-formed XML and makes the whole
element vanish.

**Why the slide surface has its own font.** `.sl-slidebase` sets
`Arial, "Liberation Sans", Helvetica, "Noto Sans", "Noto Sans TC",
"Noto Sans SC", "Noto Sans JP", "Noto Sans KR", sans-serif` instead of
inheriting the app's UI font. A deck must not change shape depending on
which OS the editor runs on; the first three are metrically identical to
each other and to PDF's Helvetica, and the shipped faces behind them carry
everything those three have no glyph for. Keep that list in step with
`OfficeFonts.FALLBACK`. Text that states its own font (anything imported)
overrides it and goes through `OfficeFonts.stack()`, which puts the same
tail back on — including on the Go side, where `fontStackFor`
(`mod/office/pptx_text.go`) appends `shippedFontFallbacks` to every stack
an import writes.

**Only faces that are drawn with may be embedded.** The embedder subsets a
font down to the glyphs asked of it, and a subset of no glyphs is not a
font any more — a CFF one fails outright on save. So `prepareFonts` loads
faces for coverage first, then walks the slide object by object making the
real raster-or-text decision, and embeds only what will actually be drawn.

The bytes are written through `OfficePlatform.writeBytes`, which base64s
them down the same oversized-payload path every export uses and lands in
`common/backend/binsaver.agi` → `office.writeBinaryFile`. In the standalone
web edition it is a download, which means **PDF export now works there
too** — it no longer needs a backend. Rendering does not block the editor:
File > Export puts a small progress panel in the corner of the canvas
(`OfficeApp.showProgress`) and works from a snapshot of the deck, so
carrying on editing cannot change the file that comes out.

### Slides: starting a slide

New slide is a split control on the toolbar: the button adds one, the caret
beside it opens `showLayoutPicker()` — every layout in `LAYOUTS` as a
preview of itself. The previews are built by the same `newSlide()` and
`renderSlideContent()` the document uses, at the scale the rail uses, so a
preview cannot come to disagree with the slide choosing it makes. The
layouts are skeletons of real text objects, not a placeholder system; there
is nothing to "fill in" afterwards, which is why the preview can be the
real thing. The previews outline every box (`.sl-layoutpick-mini .sl-obj`),
stated at slide scale so the transform brings it down to a hairline -
without it a layout is a few grey smudges and one looks like the next.

**Delete belongs to whatever has the keyboard.** A thumbnail takes focus
when it is clicked, and focusing one selects it, so the slide the keyboard
is on and the slide being edited are never two different slides. Delete
then removes the slide; with the canvas focused the same key removes the
selected objects. Both are registered with `HK` and guarded by
`railFocused()`, so neither has to know about the other.

### Slides: the shape catalogue

Every shape the editor draws lives in
[`slides/slides_shapes.js`](slides/slides_shapes.js) (`SlidesShapes`) as
geometry — about 130 of them, in the four groups the Insert > Shape picker
offers: shapes, arrows, call outs and equation.

**They are named after the PresentationML presets they are** (`rightBrace`,
`flowChartDecision`, `wedgeRoundRectCallout`). That is the point of the
file: an imported deck keeps its own vocabulary, and
`prstToShapeKind` / `shapeKindPrst` (`mod/office/pptx_{reader,writer}.go`)
are a lookup rather than a translation. The editor had three names of its
own before the catalogue — `round`, `arrow`, `star` — and they are gone:
`SlidesShapes.ALIASES` knows what they used to mean and `normalizeBody()`
runs every kind through `canonical()` as a document loads, so a deck
written back then is rewritten the first time it is opened. The Go writer
keeps the same three for a `.ppta` that has not been through the editor
yet. A preset the catalogue does not draw is sent to the nearest outline
that it does, and only a completely unknown one becomes a rectangle. The symptom
that prompted all this was a `rightBrace` importing as a thin outlined
rectangle, rotated — two long diagonal lines where a brace should be.

Every shape produces an SVG path using **only M, L, C and Z**. Arcs are
converted to cubics once, by `Path.arc()`, so nothing downstream has to
understand an arc flag — and three things get to share one geometry:

- the canvas (`shapeSvg` in `slides.js`),
- `clip-path: path(...)`, which is how a picture is cropped to a shape, and
- the PDF exporter, whose translator (`svgPathOps`) is about fifteen lines
  because that is all it has to parse.

Three flags on a catalogue entry change how it is drawn, and all three
paths honour them: `open` (a brace, a bracket, an arc — a line and not an
area, so it is stroked and never filled, and gets a stroke of its own if the
document did not give it one), `evenOdd` (the path has holes in it), and
`detail` (markings such as the divider bars of a predefined process, drawn
over the outline rather than filled).

The picker itself is `showShapePicker()`: the categories down the left, the
shapes of the one in hand as icons on the right. The icons come from
`SlidesShapes.icon()` — the same geometry again — so a picker entry cannot
come to disagree with what choosing it inserts.

`MASK_KINDS` is deliberately *not* the whole catalogue: a shaped crop reads
as a silhouette, so the crop-shape grid offers the couple of dozen outlines
that still say something at thumbnail size.

### Slides: cropping a picture

Cropping never touches the pixels. The object frame says which part of the
picture is visible and `props.crop` says which part of the source that is —
the same definition PowerPoint's `srcRect` uses, so a crop made in the
editor and one made in PowerPoint are interchangeable. `fullImageRect()`
in `slides.js` inverts the pair to find where the whole picture sits, and
that is the whole of the crop tool's geometry.

The tools live in [`slides/slides_image.js`](slides/slides_image.js)
(`SlidesImageTools`) and reach the document only through a host object of
callbacks, so `slides.js` stays about the document and the canvas. They are
reachable three ways: a **floating picture bar** under the selected image
(the text-edit bar's chrome, so the two feel like one family), the toolbar,
and the picture's context menu.

- **Crop image** (also a double-click) opens the tool: the object itself is
  hidden and the overlay draws the whole picture ghosted with the kept part
  at full strength over it. A grip moves the frame; dragging the picture
  moves the source behind it. Enter or a click outside applies, Esc restores.
  Crop and the crop shapes are one split control — the caret beside it opens
  a **grid of shape icons**, drawn by `SlidesShapes.icon()` from the same
  geometry the canvas uses so an icon cannot drift from the mask it
  applies. Picking one sets `props.mask`, drawn as a `clip-path` and written
  to `.pptx` as a `prstGeom` on the picture.
- **Format options** opens `#slFormatPanel`, docked right of the canvas:
  size, rotation and flips, position and align-to-slide, re-colour, and the
  brightness / contrast / transparency adjustments. `imageFilter()` is the
  single place that turns `recolor` + `bright` + `contrast` into a CSS
  filter, so the canvas, the thumbnails, present mode and the panel's own
  swatches cannot disagree — the swatches show the picture itself through
  each filter, so the preview *is* the result.
- **Reset image** takes off everything the tools can put on: the crop, the
  shaped crop, the flips and the colour treatment. It puts the frame back to
  `props.orig` — stamped the first time a picture is trimmed, and holding the
  frame the *whole* picture filled — and corrects the height to the source's
  own aspect ratio, so a picture stretched by dragging a corner comes back
  undistorted too.

The colour work round-trips through `.pptx` as the DrawingML effects on the
picture's `<a:blip>`: `a:alphaModFix` for transparency, `a:grayscl` /
`a:biLevel` / `a:duotone` for the re-colour preset, and `a:lum` for
brightness and contrast. The one preset with no DrawingML equivalent is
*Negative*, which is written as no effect rather than as something else.

### Sheets formula engine

[`sheets/formula.js`](sheets/formula.js) is a DOM-free tokenizer, parser,
evaluator and calculator that also runs under Node. The functions themselves
(377 of them) live in modules that register into it and load after it, in
this order, from `sheets/index.html`:

| File | Functions |
|---|---|
| [`formula_fn_logic.js`](sheets/formula_fn_logic.js) | logical, `IS*`/info, operator functions (`ADD`, `EQ`, …) |
| [`formula_fn_math.js`](sheets/formula_fn_math.js) | rounding, powers/logs, trig, integers, number bases, bits, `CONVERT` |
| [`formula_fn_stats.js`](sheets/formula_fn_stats.js) | aggregates, `*IF`/`*IFS`, `SUBTOTAL`, `D*`, descriptive stats, regression |
| [`formula_fn_text.js`](sheets/formula_fn_text.js) | text, `TEXT` (via [`numfmt.js`](sheets/numfmt.js)), regex, `ROMAN`, double-byte (`LENB` …) |
| [`formula_fn_date.js`](sheets/formula_fn_date.js) | dates, times, working days, `YEARFRAC`, `DAYS360` |
| [`formula_fn_lookup.js`](sheets/formula_fn_lookup.js) | `VLOOKUP` `MATCH` `XMATCH` `XLOOKUP` `INDEX` `LOOKUP` `ROW` … |
| [`formula_fn_ref.js`](sheets/formula_fn_ref.js) | `OFFSET` `INDIRECT` `ADDRESS` `CELL` `SHEET(S)` `HYPERLINK` `TO_*` |
| [`formula_fn_array.js`](sheets/formula_fn_array.js) | `FILTER` `SORT` `UNIQUE` `SEQUENCE` `SPLIT` stacking, `MMULT`, `LINEST` … |
| [`formula_fn_finance.js`](sheets/formula_fn_finance.js) | loans, NPV/IRR/XIRR, depreciation |

[`formula_node.js`](sheets/formula_node.js) loads the same set under Node.
[`FUNCTION_PLAN.md`](sheets/FUNCTION_PLAN.md) tracks what is done and what is
next.

```bash
node web/Office/sheets/test_formula.js      # engine: parser, refs, arrays, rewriting
node web/Office/sheets/test_formula_fns.js  # every function, against Excel's documented examples
```

`test_formula_fns.js` fails when a registered function has no test, so a new
function always comes with one.

**Copy and paste between sheets.** A copy of Sheets cells remembers its
source sheet and the computed value of every cell. Ctrl+V onto another sheet
defaults to *Keep source links*: formulas get their plain references pinned
to the source sheet (`F.qualifyRefs`: `=E13*B2` becomes
`=SheetA!E13*SheetA!B2`), so they still show the source results. On the same
sheet, formulas shift relative to where they land, as before. A cut moves the
cells, so their formulas keep pointing where they did. The other modes
(values, values with formatting, formatting only, paste link, transpose) are
listed in the paste-options button at the corner of the pasted block, in Edit
and in the right-click menu (> Paste special), and values only is also on
Ctrl+Shift+V (`PASTE_MODES` / `pasteInternal(mode)` in `sheets.js`).

**Function suggestions.** Typing a function name in a formula (`=AVE`) opens
a popup ([`sheets_suggest.js`](sheets/sheets_suggest.js), `SheetFnSuggest`)
on the cell editor and the formula bar; the highlighted entry shows a
description, the usage line (`spec.syntax`) and an example. Descriptions and
examples live in [`formula_help.js`](sheets/formula_help.js)
(`SheetFormulaHelp`), and `test_formula.js` fails when a function has no
entry there or its example does not parse.

**Adding a function.** Register it in the matching module:

```js
def("NAME", minArgs, maxArgs, function (args, E, arrayCtx) { ... },
    { elem: true, syntax: "NAME(value)" });
```

`args` are AST nodes, evaluated through the helper object `E`: `E.num`,
`E.int`, `E.str`, `E.bool`, `E.val` (scalars with defaults for omitted
arguments), `E.arr`/`E.flat` (ranges and arrays), `E.numbers(args, mode)`
(the spreadsheet rules for "all the numbers in these arguments": `"sum"`
skips text in cells but rejects typed text, `"a"` counts text as 0),
`E.criteria(value)` (the `COUNTIF` matcher: `">5"`, `"a*"`, `"<>"`, dates),
`E.self` (the cell being evaluated), `E.raw` / `E.rowState` / `E.format`
(source text, hidden/filtered rows, number format). Return a value, an
`F.Arr`, or an `FErr`. `elem: true` marks a scalar function, which the engine
then applies element by element inside `SUMPRODUCT`, `SUM(...)` and other
array contexts (`SUMPRODUCT(LEN(A1:A9))`). Excel's `_xlfn.` / `_xlws.` name
prefixes are ignored when calling, stripped by the xlsx reader and written
back for functions listed in `xlFutureFunctions`
([`mod/office/xlsx_formula.go`](../../mod/office/xlsx_formula.go)) — add new
post-2007 Excel functions there too.

Date text (`"2024-05-01"`, `"5/1/2024"`, `"1 May 2024"`, `"13:30"`) is read as
a date serial wherever a number is expected, as in Excel.

**References as values.** `OFFSET`, `INDIRECT` and `INDEX` answer with a
reference (`F.Ref`), not just a value, so they can be used wherever a range
can: `SUM(OFFSET(A1,0,0,10,1))`, and `:` joins them
(`A1:INDEX(B1:B9,3)`, `SUM(A1:INDIRECT("B5"))`). Take one with `E.ref(node)`
and build one with `E.makeRef(...)`; a reference covering one cell reads as
that cell's value.

**Whole columns and rows.** `A:B`, `2:5` and the Sheets-style `A2:A` fill the
missing coordinate from the sheet's used range (`opts.bounds`, cached per
recalculation in `sheets.js`), so they cost what the data costs, not what the
grid could hold.

**Array literals.** `{1,2;3,4}` is two rows of two, usable anywhere an array
is: `SUM({1,2,3})`, `VLOOKUP(2,{1,"a";2,"b"},2,FALSE)`.

**Defined names.** `body.names` is `[{name, formula, sheet?}]` (`sheet` = the
index a sheet-local name belongs to). The calculator resolves a name once per
recalculation, in the scope of the sheet that defines it, and usually to a
reference - so `SUM(Sales)` works like `SUM(Data!B2:B99)`. Data > Named
ranges manages them, renaming a sheet rewrites them, and they round-trip
through xlsx `<definedNames>` (Excel's own `_xlnm.*` entries are skipped:
print areas and filter ranges belong to features modelled elsewhere).

**Spilling (dynamic arrays).** A formula whose result is several cells
(`=FILTER(...)`, `=SORT(A2:C9)`, `=B2:B9*2`, `=SEQUENCE(10)`) fills the cells
to its right and below. Those cells stay empty in the model: the calculator
answers their values from the anchor. Rules and machinery:

- *Which formulas can spill* is decided before evaluating (`maySpill`):
  ranges, array literals and names produce arrays; operators and `elem`
  functions pass them through; a function is `array: true` (or a function of
  its argument nodes, as `INDEX`/`XLOOKUP`/`ROW` do), or `passthrough: true`
  when it returns one of its arguments (`IF`, `CHOOSE`, `IFERROR` ...).
  Only those formulas are evaluated in array context, so everything else
  keeps its exact old behaviour (the Helpdesk golden file is unchanged).
  A cheap text pre-filter (a `:` `{` `@`, an array function name or a
  defined name) keeps the check off plain formulas.
- *Empty cells look for a covering spill*: the first empty cell read on a
  sheet evaluates every spill anchor there (`opts.formulaCells`) and records
  what each covers, so later reads are a map lookup.
- *A blocked spill* (a non-empty cell, or another spill, in the way) makes
  the anchor `#SPILL!` with a message naming the cell; typing into a spilled
  cell does exactly that. Spilled cells wear the anchor hint (dates stay
  dates).
- `calc.spillAt(col,row,sheet)` gives the spill a cell belongs to (the grid
  draws a dashed outline and shows the anchor formula greyed in the formula
  bar); `calc.spillList(sheet)` lists them (the grid grows to fit).
- `@A1:A9` / `SINGLE(...)` is implicit intersection; `ARRAYFORMULA(x)`
  evaluates `x` as an array.
- xlsx: `Core.exportBody()` tags each anchor with `a` = the range it fills,
  and the writer emits `<f t="array" ref="...">` with `cm="1"` plus the
  `xl/metadata.xml` dynamic-array part, so Excel sees real dynamic arrays
  (`ARRAYFORMULA(x)` is written as a dynamic-array `x`). On import, the
  cached results inside an array formula's range are dropped so they do not
  block the spill. `FILTER`/`SORT` get Excel's `_xlfn._xlws.` prefix.
- Not done: Excel's spill-range operator (`A1#`), and whole-column refs do
  not see spilled rows past the last typed cell.

**Result hints.** A function may ask for the number format its cell should
wear (`spec.hint`, or `E.hint("date")`) or mark the result as a link
(`E.link(url)`, `HYPERLINK`). The grid applies a hint only when the cell has
no format of its own, so `=TODAY()` reads as a date while an explicit format
always wins; `calc.hintAt(col,row,sheet)` reads it back. **Evaluate the cell
before asking for its hint** - it is recorded while the formula runs.

**Golden tests against real files.** Save a workbook from Excel or Google
Sheets (it stores each formula's computed value), then:

```bash
OFFICE_GOLDEN_DIR=/path/to/xlsx go test ./mod/office/ -run TestGoldenDump
node web/Office/sheets/test_golden.js /path/to/xlsx
```

Every formula is recalculated and compared with the stored value (volatile
`TODAY`/`NOW`/`RAND` are skipped). The Helpdesk reference workbook checks
52,111 formulas with no differences.

**Cross-sheet references** (`Data!A1`, `'Closed Tickets'!$C$3:$C$5000`) are
resolved by one workbook-wide calculator: `createCalculator(getRaw, opts)`
memoizes per sheet + cell, so switching tabs does not recompute anything, and
every formula reads its unqualified refs from its own sheet. Renaming a sheet
rewrites the formulas that name it (`renameSheetRefs`); inserting/deleting
rows or moving a range adjusts refs to that sheet from every sheet.

**Arrays.** Inside `SUMPRODUCT` (and array expressions handed to `SUM` & co.)
a range evaluates to an array and operators work element by element with
Excel's broadcasting, which is what report-style workbooks built on
`SUMPRODUCT((Data!A2:A5000="x")*(Data!B2:B5000))` need. Ranges are cached as
arrays for the life of a recalc, and so is "cached range compared with a
constant", because such reports repeat the same criteria in every cell. The
reference workbook (1,150 SUMPRODUCT-heavy cells over a 5,000-row sheet of
51k formulas) recalculates in ~1 s cold and matches Excel's cached values in
every cell. A bare range outside an array context is still `#VALUE!` (no
spilling).

`AND`/`OR` follow Excel for text: text inside a referenced cell or range is
skipped, text typed straight into the call is `#VALUE!`. A blank cell equals
`""`.

**Shared formulas.** Excel writes a filled-down formula once
(`<f t="shared" ref="K3:K66" si="0">B3-C3</f>`) and leaves the other cells
as `<f t="shared" si="0"/>`. The Go reader expands every follower by moving
the master's relative refs (`mod/office/xlsx_formula.go`), so they stay live
formulas instead of frozen cached values.

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

`REGEX*` use JavaScript regular expressions (Google uses RE2; JavaScript
accepts a superset, e.g. lookbehind). `(?i)` at the start is honoured.

Not implemented yet (see the plan): `LET`/`LAMBDA` and the `MAP`/`REDUCE`
family, probability distributions, bond maths, complex numbers, and
dependency tracking (any edit resets the memo, so a very heavy workbook
recomputes what is on screen after every change).

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

### Start-up splash

Opening a large document takes a moment (fetching and unpacking it, a server
or WebAssembly conversion for `.docx` / `.xlsx` / `.pptx`, laying out every
page), so Docs, Sheets and Slides start behind a splash that says what is
happening — [`common/splash.js`](common/splash.js),
contract in `CONTRACT.md`. It is a softly tinted card in the app's colour
with the app icon, "ArozOS Docs/Sheets/Slides", a tagline, loading dots and
the status in the bottom-left corner (any other app gets the suite card: the
ArozOS mark and a progress bar). Its artwork is SVG in
[`img/splash/`](img/splash/) - the icons, the mark, and two corner shapes used
as CSS masks so one file serves every app colour. In a desktop float window
the window opens small (`InitFWSize` 480x320) and grows to 1080x700, both
centred on the desktop, once the document is on screen; in a browser tab the
same card fills the page and scales with it. Sheets grows to
1180x720 and Slides to 1220x740. Each `index.html` loads its stylesheets and
scripts in `<body>`, after the splash, so the splash paints while they arrive.

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
- **DOCX import is inheritance too**
  ([`docx_reader.go`](../../mod/office/docx_reader.go),
  [`docx_props.go`](../../mod/office/docx_props.go),
  [`docx_numbering.go`](../../mod/office/docx_numbering.go)): a
  paragraph's look is docDefaults → the paragraph style's `basedOn` chain
  → direct `pPr` → character style → run `rPr`. Toggles are tri-state
  (`<w:b w:val="0"/>` switches bold *off* against a bold style — reading it
  as "present = on" is the classic bug). Numbering resolves `num` →
  `abstractNum` → `lvlOverride`, with counters per list id.
- **Google Docs exports get Google Docs' layout rules** (detected by the
  all-zero rsids): the empty paragraph above a table loses its spacing
  after, spacing-before after a page break is dropped, a heading's
  spacing-before collapses with the spacing-after above it, a picture has
  1.5pt either side, rows round up to whole pixels, and "Arial Unicode MS"
  is Arial. Each rule was measured against its own PDF; they are `cv.gdocs`
  branches so a Word document is not bent by them.
- **A turned or mirrored picture is baked into the bitmap on import**
  ([`docx_picture.go`](../../mod/office/docx_picture.go)): a CSS transform
  would not move the text around it, so the frame is swapped and the crop
  turned with it, and the picture lays out, prints and saves as it looks.
- **DOCX export writes what the editor draws**
  ([`docx_writer.go`](../../mod/office/docx_writer.go)): `docDefaults`,
  heading styles and `editorBlockCSS` mirror `docs.css` (a `blockquote`'s
  3px rule and padding, a `pre`'s frame and shading, a `th` centred), so
  the export starts from the editor's defaults and lays the element's own
  inline style over them. Paragraph borders use Word's geometry: the text
  keeps its indent and the rule is drawn `w:space` outside it — the reader
  maps that back to `margin + border + padding`. A block inside an indent
  container (the browser's indent command wraps paragraphs in a
  `blockquote style="margin: 0 0 0 40px"`) takes the container's indent.
  Three custom styles mark what Word cannot express, so an import restores
  it exactly: `ArozPageNumber` (the page number the editor draws by itself —
  it comes back as `pageNumbers`, not footer text), `ArozHorizontalRule`
  (an `<hr>`) and `ArozEditorTable` (an editor-made table, which keeps its
  CSS spacing). The editor's plain 9pt grey header/footer also comes back
  plain. A table or picture in a multi-column page is sized to one column.
- **The editor model must round-trip.** `TestDocxRichRoundTrip` pins
  model → docx → model for each construct; when adding one, add a row. A
  mismatch shows up as layout drift the next time the file is opened, not
  as an error.
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
node web/Office/sheets/test_formula_fns.js  # formula functions (vs. Excel examples)
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
- **Thumbnails scale themselves.** A preview is the whole 960x540 slide
  shrunk by a transform, and the box it has to fit is whatever the rail can
  spare once the scrollbar has taken its cut — which varies by platform. So
  `fitThumbs()` measures the box and sets `--sl-thumb-scale`; a hard-coded
  scale is how the right-hand edge of every preview came to be missing.
- **Front-end smoke test without a full server**: the repo's
  `.claude/launch.json` has a `webroot-static` config that serves
  `src/web/` on `:8123`; the apps load standalone (AGI calls fail
  gracefully). Menus/toolbars/editing are all testable this way.
- **Checking a Slides PDF export properly** means rendering it and looking
  at it beside the editor's own render of the same slide — the exporter's
  whole claim is that the two are the same picture. `PDF Viewer/js/pdf.js`
  is already in the tree and will rasterize the bytes into a canvas from a
  scratch page served by the same static server. Reading `getTextContent()`
  off each page is the quick regression check: every string that is on the
  slide should come back, because anything that fell back to a raster
  would not.

## Ideas / known gaps (future work)

- **CJK text as text in the Sheets PDF export.** Slides and Docs solved
  this by shipping the fonts and embedding them in the browser
  (`common/fonts`, `common/pdfcore.js`); the Go renderer behind Sheets
  still transliterates, because `fpdf`'s core fonts are cp1252.
- **Docs line breaking differs from Google Docs in one respect**: Google
  Docs breaks only at spaces (a word longer than the line is cut at the
  character), while Chrome also breaks after a hyphen or between quote
  marks. A long code line can therefore wrap one word differently, which
  moves the rest of that page by a line. CSS has no switch to take break
  opportunities away; fixing it means marking them in the text.
- A DOCX table with no rows (Google Docs writes these) takes no space in
  the editor; Google Docs gives the heading after it a little less
  spacing-before.
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
  picture's `prstGeom` and is a real clip path in the browser-rendered
  PDF, but the `.odp` writer does not draw one — ODF would need a custom
  shape with a bitmap fill.
- Slides: SmartArt (`dgm:`), 3-D effects, shadows and animations are
  skipped rather than approximated.
- Real-time collaboration (the `sharedspace` AGI lib was built for this).
- Docs: section breaks (one page setup per document; a document cannot mix
  column counts), and keep-with-next / widow control inside columns (a
  column cut goes exactly where the text reaches the last column).
- Sheets PDF: merged-cell rendering in the print model.
- Slides: shape text with per-run styling in pptx (currently
  object-level bold/italic/color only).

Happy hacking. The code tries hard to explain itself — when something
looks odd (mimetype-first zips, nbsp scrubbing, sidecar zips), there is a
comment at the site explaining why, and usually a test pinning it down.
