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
  footer, pageNumbers, comments, trackChanges}`. `html` is a sanitized
  contenteditable subset (see `sanitizeHtml` in `docs.js`).
- **Sheets** (`spreadsheet`): [`xlsx.go`](../../mod/office/xlsx.go) —
  `{sheets[{name, cells{"A1":{v,s,n}}, colW, rowH, merges, freeze,
  charts, filter}], active}`. Cell `v` is the raw input (`=`-prefix =
  formula, evaluated client-side in [`sheets/formula.js`](sheets/formula.js)).
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

### Format notes (hard-won lessons — don't re-learn these)

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
  Gotchas encoded in `pdf.go`:
  - Core fonts are **cp1252** — all text goes through `pdfTr()`, which
    also normalizes `&nbsp;`/thin spaces to plain spaces (fpdf only wraps
    lines at real spaces; contenteditable HTML is full of nbsp and the
    lines wrapped comically early before this).
  - **Never call `fpdf.SplitText` on translated text directly** — it
    indexes a 256-glyph table by rune and panics on multi-byte UTF-8.
    Use `pdfSplitTr()`.
  - Text highlight is drawn word-by-word as filled cells
    (`writeHighlighted`) because fpdf has no text background.
  - Small images (≤ 8mm tall, i.e. rasterized emoji) flow inline with
    text; larger ones are block images (`inlineImage`).
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
go vet ./mod/office/
gofmt -l mod/office/           # must print nothing
node --check web/Office/docs/docs.js   # etc. for each edited JS file
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
- Native OOXML charts instead of PNG rasters.
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
