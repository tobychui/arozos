# Web Builder - ArozOS Site Builder

A visual, drag-and-drop website builder WebApp. Sites are edited as a JSON
document, saved as `.wbsite` project files anywhere in the user's file system,
and published as plain static HTML into the user's **Personal Site** web root.

This README is the developer handoff document: what the pieces are, why the
non-obvious decisions were made, and where to start when continuing the work.

> The module is still registered as **"Web Builder"** in
> [`init.agi`](init.agi). Module permissions and desktop shortcuts are keyed by
> module *name*, so renaming it would silently drop every existing permission
> group entry. The product name shown inside the app is "ArozOS Site Builder".

## What replaced what

The previous version was a thin wrapper around SunEditor (a 2.3 MB rich-text
editor) that saved one HTML file through a template. That editor, the framed
editor page and `template.html` are gone. Everything under `js/`, `css/` and
`backend/` is new; the `img/` icons are unchanged.

Old `.html` files still open: they are parsed into the element tree by the
importer in [`js/fileio.js`](js/fileio.js) (see *HTML import* below).

## Architecture

```
Browser (this WebApp)                         ArozOS server
┌───────────────────────────────┐            ┌────────────────────────────┐
│ model.js   project document   │  agirun    │ backend/load.agi           │
│ render.js  model -> HTML/CSS  │ ─────────► │ backend/save.agi           │
│ canvas.js  iframe + overlays  │            │ backend/publish.agi        │
│ inspector / layers / pages    │            │   (filelib, text I/O only) │
│ publish.js personal site glue │            ├────────────────────────────┤
└───────────────────────────────┘  fetch     │ /system/network/www/*      │
                                   ─────────►│ /system/file_system/fileOpr│
                                             └────────────────────────────┘
```

| File | Role |
|---|---|
| [`js/icons.js`](js/icons.js) | Every glyph in the app, drawn as inline SVG (house rule 6: no emoji, and this app does not load Semantic UI) |
| [`js/schema.js`](js/schema.js) | The element catalogue: palette entry, default tag/props/styles and inspector fields per element type, plus the starter page |
| [`js/model.js`](js/model.js) | The project document and every mutation on it; snapshot undo/redo |
| [`js/render.js`](js/render.js) | Model to HTML + CSS, in editor / preview / export modes |
| [`js/ui.js`](js/ui.js) | Menus, modals, toasts, and the form controls the panels are built from |
| [`js/canvas.js`](js/canvas.js) | The editing stage: iframe, selection, hover, drag/drop, resize, inline text editing |
| [`js/palette.js`](js/palette.js) | "Add" panel |
| [`js/pages.js`](js/pages.js) | "Pages" panel and page settings |
| [`js/layers.js`](js/layers.js) | "Layers" panel (left dock) and Layer Properties |
| [`js/inspector.js`](js/inspector.js) | Right dock: Content / Design / Advanced |
| [`js/design.js`](js/design.js) | Site-wide theme, fonts, palette swap |
| [`js/fileio.js`](js/fileio.js) | New / open / save / save-as, HTML import, file pickers |
| [`js/publish.js`](js/publish.js) | Preview, publish to the personal site, export to a folder |
| [`js/settings.js`](js/settings.js) | Site metadata + Personal Site configuration UI |
| [`js/app.js`](js/app.js) | Boots and wires everything; owns node-level commands and shortcuts |
| [`js/embedcompat.js`](js/embedcompat.js) | File-selector shim for when the app is iframed inside another ArozOS app |

Script order in [`index.html`](index.html) is load-bearing:
`icons → schema → model → render → ui → canvas → panels → fileio → publish →
settings → app`.

## The document model

One JSON object per site, which is exactly what a `.wbsite` file contains:

```jsonc
{
  "version": 1,
  "name": "My Website",
  "slug": "my-website",              // publish folder name under the web root
  "settings": { "lang", "description", "author", "favicon", "webFonts", "theme" },
  "pages": [ {
      "id", "name", "slug", "parentId", "visibility", "title", "description",
      "root": Node
  } ],
  "activePageId": "pg-xxxx"
}
```

A `Node`:

```jsonc
{
  "id": "el-xxxx",
  "type": "heading",                 // key into WBElements
  "name": "",                        // custom layer name; empty = use type name
  "tag": "h1",
  "props": { "html": "..." },        // content, per element type
  "styles": { "base": {}, "tablet": {}, "mobile": {} },
  "attrs": {}, "classes": "", "domId": "",
  "visible": { "base": true, "tablet": true, "mobile": true },
  "locked": false,
  "customCss": "",                   // "&" means this element
  "children": []
}
```

Notes that matter:

- **Styles are camelCase CSS**, split into three breakpoint layers. `base` is
  desktop; `tablet` and `mobile` are emitted inside `@media (max-width: 1024px)`
  and `@media (max-width: 640px)`, so editing at a narrower breakpoint never
  touches the desktop design. The inspector shows the *effective* value
  (inherited down the chain) and writes to the breakpoint selected in the top bar.
- **Each node renders with a `.wb-<id>` class** and its rules go in the
  stylesheet. Nothing is written as an inline `style` attribute, so published
  markup stays readable and a user's own `id`/`classes` remain theirs.
- **Undo/redo is snapshot based** (`JSON.stringify` of the whole project, 80
  deep). Projects are tens of KB; a snapshot can never desync from the tree the
  way a command log can. Rapid edits coalesce through the `key` argument of
  `WBModel.commit(label, key)` so typing does not produce one undo step per
  character.

## The canvas

The page is rendered into a same-origin `<iframe>` (`document.write`, not
`srcdoc`, so it is synchronous) for genuine CSS isolation - the builder chrome
cannot leak into the page and vice versa, and what you see is what gets
published.

Every interactive overlay lives in the *parent* document:

```
#wb-stage-inner
  #wb-frame-holder      width = deviceWidth * zoom     (this is what centres)
    #wb-frame-wrap      width = deviceWidth, transform: scale(zoom)
      #wb-frame-shell > iframe
    #wb-overlay         absolute, unscaled - handles, badges, drop line
```

Rectangles are measured inside the frame and multiplied by zoom. Keeping the
overlay outside the scaled wrapper is why handles and badges stay crisp and
constant-sized at any zoom level.

Three refresh paths, cheapest first - use the right one:

| Call | Cost | Use for |
|---|---|---|
| `WBCanvas.refreshStyles()` | swaps one `<style>` tag | any style change |
| `WBCanvas.refreshNode(id)` | re-renders one subtree | content/prop change |
| `WBCanvas.render()` | rebuilds the document | structural change, page switch |

Gotchas already handled, do not undo them:

- Iframes and videos get `pointer-events: none` inside the editor, otherwise
  they swallow the clicks used for selection. Map and Embed therefore render as
  a wrapper `div` that carries the id and styles, with the `<iframe>` inside it.
- Scripts inside `HTML` elements are stripped in editor mode (they would run in
  the builder) and kept verbatim on export.
- Links are neutralised on the canvas; `href` is preserved in `props`.
- `dataTransfer` payloads are not readable during `dragover`, which is exactly
  when the drop indicator must be computed, so the dragged element type is
  stashed on `WBCanvas.beginPaletteDrag(type)` instead.

## Publishing

Publish writes a complete static site into **a folder of its own** inside the
user's Personal Site web root:

```
<web root>/<slug>/index.html
<web root>/<slug>/<page>.html
<web root>/<slug>/assets/site.css
<web root>/<slug>/assets/<referenced media>
```

served by the server at `/www/<username>/<slug>/`. Publishing into a subfolder
rather than the web root itself means it can never clobber a home page the user
put there by other means.

Endpoints used (registered in [`src/network.go`](../../network.go), and **only
present when the server runs with `-allow_homepage`** - the UI degrades to
"export to a folder" when they 404):

| Endpoint | Use |
|---|---|
| `GET ../system/network/www/toggle` | is the personal site enabled |
| `GET ../system/network/www/toggle?set=true\|false` | enable / disable it |
| `GET ../system/network/www/webRoot` | read the web root virtual path |
| `GET ../system/network/www/webRoot?set=<vpath>` | set it |
| `GET ../system/desktop/user` | username, for the public URL preview |

**Media files are not written by the AGI script.** `filelib` does text I/O only,
so copying a JPEG through it would corrupt it. Only HTML and CSS go through
[`backend/publish.agi`](backend/publish.agi); each referenced media file is read
back through the media server (`../media?file=<vpath>`) and re-uploaded into the
assets folder with `/system/file_system/upload`, one file at a time, so a single
unreadable image reports itself instead of failing the whole publish. Keep it
that way.

`WBRender.buildAssetPlan()` decides *once* what every referenced file will be
called inside `assets/` - sanitising the name and de-duplicating collisions
between same-named files from different folders - and both the markup rewriting
and the upload read from that one plan. If you ever compute an asset name in two
places again, images will 404 on the published site.

Assets are found in element props **and in style values**: a `background-image`
holds a `../media?file=...` URL on the canvas, which is collected and rewritten
to the relative asset path on export. Anything that embeds a media reference in
CSS has to keep going through `rewriteMediaInValue()` in
[`js/render.js`](js/render.js), or the published page will point a visitor's
browser at the owner's private media endpoint.

The same build+write path serves *Export To Folder*, which is the fallback on
servers with personal home pages disabled.

## The colour picker

Every colour field opens [`js/colorpicker.js`](js/colorpicker.js), an embedded
picker laid out like the Photoshop Color Picker dialog and themed with the
builder's tokens. The native `<input type="color">` is deliberately *not* used
anywhere: it renders as the operating system's own dialog, which cannot be
themed and looks different on every machine.

The field and the strip are canvases painted per pixel, so all nine component
radios (H S B / R G B / L a b) genuinely drive them rather than being
decoration - each mode declares which component the strip carries and which two
the field's axes carry, and one generic paint loop serves them all.

- Conversions (HSB, CIE Lab at D65, CMYK) round-trip losslessly across the whole
  8-bit cube, and Lab matches published sRGB reference values. There is a Node
  harness for this in the scratchpad pattern used during development - if you
  touch the maths, re-check `#ff0000 -> L 53.24, a 80.09, b 67.20`.
- **Alpha is preserved but not editable.** The reference dialog has no alpha
  channel, yet builder values can be `rgba(...)`; the picker carries the
  original alpha through so opening a translucent colour and pressing OK does
  not silently make it opaque.
- *Add to Swatches* persists to `localStorage`; *Color Libraries* opens an
  in-dialog overlay listing saved swatches, the current site's theme colours and
  a basic palette. Neither button is a decoration.
- `WBUI.colorRow()` keeps its old API (`setValue`, a `.wb-color-swatch i` chip
  and a text input), so every existing call site was left untouched.

## Forms that collect submissions

A Form element has two submit modes, set on the Content tab:

- **Save to a file** (the default) - the user picks a `.csv` path and the
  builder writes a small collector script into the published site that appends
  every submission to it. No endpoint, no service, no code.
- **Send to a URL** - the classic behaviour: post straight to an address the
  owner supplies.

A **Thank you page** group (collapsed, under the submit settings) customises the
page a visitor lands on after submitting: heading, small text, return-button
label, and accent / background / text colours. Colours left blank follow the
site theme, and the field shows the inherited value so an empty swatch does not
read as "no colour". Because that page only exists on the published site, the
group carries a live miniature of it - otherwise those settings would be
adjusted blind. All four strings are HTML-escaped by the generated script.

The collector is generated by [`js/formgen.js`](js/formgen.js) at publish time
as `forms/<form-slug>.agi` inside the site folder. It works because **the
personal-site router executes `.agi` files instead of serving them**
([`mod/www/www.go`](../../mod/www/www.go)), running them as the site *owner* -
which is precisely the permission needed to write to the owner's files, and
which means the script's source is never exposed to visitors. Inside it,
`REQ_METHOD` / `postPara()` come from the serverless injection in
[`mod/agi/serverlessReqHandler.go`](../../mod/agi/serverlessReqHandler.go).

Things that are the way they are for a reason:

- **The script sets `HTTP_HEADER = "text/html; charset=utf-8"`.** The AGI runtime
  starts every VM with `HTTP_HEADER` at `"text/plain"`
  ([`mod/agi/agi.system.go`](../../mod/agi/agi.system.go)) and
  `ExecuteAGIScriptAsUser` applies it to the response, so any AGI script that
  replies with markup must override it or the visitor sees raw HTML source.
- **Field names come from `WBRender.formFieldName()`**, which both the exported
  markup and the generated script call. Compute a field's name anywhere else and
  the CSV silently fills with blanks.
- **The CSV is written with a UTF-8 BOM.** ArozOS Sheets strips it
  (`parseDelimited` in `web/Office/sheets/sheets_io.js`) and Excel needs it to
  read non-ASCII correctly.
- **Values are RFC 4180 quoted** and newlines are flattened to spaces, so one
  submission is always exactly one row.
- **A hidden `_hp` honeypot field** is added to file-backed forms. A submission
  with it filled in gets the normal thank-you page but is not recorded, so bots
  cannot tell they were dropped.
- **Rows are appended read-modify-write**, because `filelib` has no append and
  no locking. Two submissions in the same instant can lose one. That is an
  acceptable trade for a personal site; a busy form wants a database.
- The inspector **warns if the chosen CSV sits inside the web root**, since
  anything under it is publicly downloadable. The default
  (`user:/Form Submissions/<form>.csv`) is deliberately outside.

## HTML import

Opening a `.html`/`.htm` file (or *Import HTML As Page*) parses it with
`DOMParser` and maps tags onto element types (`TAG_MAP` in
[`js/fileio.js`](js/fileio.js)). Anything without a first-class element -
tables, lists, `<svg>`, custom markup - is preserved verbatim as an `html`
element, so an import never silently loses content. `<style>` blocks in the
document are attached to the page body's `customCss`.

## Starter templates

New Site opens a gallery ([`js/gallery.js`](js/gallery.js)) of twelve
multi-page templates rather than dropping straight into a default page. Each
card's thumbnail is the template's *real* home page, built and rendered into a
scaled-down iframe, so the preview cannot drift from what you get. Previews are
built lazily as cards scroll into view - building twelve sites up front stalls
the modal on slower hardware.

```
templates/
  kit.js        WBTemplateKit - the seed-building helpers (sections, heroes,
                feature grids, artwork, navigation, footers, contact forms)
  preset.js     WBTemplatePreset.build() - the shared four-page skeleton
  registry.js   WBTemplates - registration, buildProject(), previewDocument()
  t-*.js        one file per template: a theme, its copy, a few layout switches
```

A template registers `{ id, name, category, tagline, theme, pages }`, where each
page has a `build(ctx)` returning seed objects. **`ctx.link(pageName)` resolves
to the published file name of another page in the same template** - that is what
makes a new site arrive with its navigation already wired instead of a page full
of `#` links. `WBTemplates.buildProject()` returns a complete project object
without installing it, which is what both New Site and the thumbnails use.

Two things to preserve when adding a template:

- **Ship no image files.** Photography is faked with `K.art()` gradient panels.
  They look composed on the first render, publish as plain CSS, and keep the app
  free of binary assets. The one thing a template must never do is reference a
  file that does not exist.
- **Clear inherited element styling explicitly.** The Button element defaults to
  a filled pill, so a nav link has to set `padding: 0` and
  `backgroundColor: transparent` rather than merely leaving them unset -
  `createNode` merges overrides *on top of* the schema defaults. `K.link()`
  already does this; reach for it instead of `K.button()` for text links.

Layout variety comes from switches on the preset (`hero.layout` of
`split`/`center`/`stack`, `features.card`, `second.layout` of
`cards`/`art`/`list`) plus the theme, so eleven of the twelve are configuration
rather than bespoke markup. `t-ember.js` is the exception - it is written
directly against the kit and is the one to copy when a template needs a shape
the preset does not have.

## Adding a new element type

1. Add an entry to `WBElements` in [`js/schema.js`](js/schema.js): `type`,
   `name`, `icon` (a key in `WBIconPaths`), `group`, `tag`, `container`/`text`
   flags, default `props` and `styles`, and the `fields` the Content tab shows.
2. Add a `case` to `nodeHtml()` in [`js/render.js`](js/render.js) if the markup
   is anything more than `<tag>children</tag>`. Remember both output modes:
   `opts.mode === "editor"` must stay selectable and inert.
3. If it needs a new inspector control, add a `type` to `buildField()` in
   [`js/inspector.js`](js/inspector.js).
4. Draw an icon in [`js/icons.js`](js/icons.js) if none of the existing ones fit.

No registration lists to update - the palette, layers icons and inspector are
all driven off `WBElements`.

## House rules this app has to keep

- **No emoji anywhere** (repo rule 6). Every glyph comes from `WBIcon(name,size)`.
- **No new remote dependencies.** The app ships no third-party JS at all;
  jQuery is loaded only because `ao_module.js` requires it. Google Fonts are
  referenced by *published* pages only when the user opted in (Design panel) and
  actually used a web font.
- Run the checker before pushing:
  `sh scripts/check-conventions.sh --diff origin/master`

## Testing without a server

`src/web` can be served statically (see `.claude/launch.json`,
`webroot-static` on port 8123) and the whole builder works offline: editing,
layers, breakpoints, preview and the export *generation* all run client-side.
What needs a real ArozOS instance is anything that touches the server: opening
and saving project files, the file pickers, media, and the publish write itself.
