# Gerber Viewer

A desktop-style viewer for PCB fabrication data: Gerber RS-274X / X2 layers and
Excellon drill files, shown as coloured CAM layers, as a realistic board
preview (solder mask, surface finish, silkscreen, drilled holes) or as a 3D
board. Everything is drawn in the browser; the only server-side code is the
AGI scripts in `backend/` (no Go endpoints were added).

## Opening data

| Source | How | Who unpacks |
|---|---|---|
| ArozOS | File > Open from ArozOS (zip / 7z / tar / tar.gz or any set of files), Open Folder, drag from File Manager, file association (`SupportedExt` in `init.agi`) | `backend/project.agi` (ziplib) |
| This device | File > Open from This Device / Open Folder, drag and drop (files, folders, zips) | `js/zip.js` in the browser (zip only) |

Opening a single layer through a file association offers "Load all" when the
same folder holds more CAM files (`project.agi` `siblings`). `.zip` is
deliberately not in `SupportedExt`, so the Zip File Manager stays the default
for zips.

## File map

| File | Purpose |
|---|---|
| `init.agi` | Registers the module |
| `backend/project.agi` | `open` (archives, folders, files), `read` (reload one layer), `siblings` |
| `backend/prefs.agi` | Settings and recent projects in the `Gerber Viewer` DB table (per user) |
| `backend/export.agi` | Saves exports (`writeText`, `writeBinary` as hex) to a vpath; JSON body |
| `js/geom.js` | Item format, arcs, orientation, hit testing, Path2D / SVG path sinks |
| `js/gerber.js` | RS-274X / X2 parser |
| `js/excellon.js` | Excellon parser (tools, LZ / TZ, slots, routing) |
| `js/layers.js` | Layer type detection (X2 FileFunction, EasyEDA, KiCad, Altium, Eagle, ...) |
| `js/board.js` | Outline loops (board edge + cut-outs), de-duplicated holes and slots |
| `js/render.js` | Canvas renderer (layer and realistic modes) and the pan / zoom viewer |
| `js/view3d.js` | 3D board (ES module, loaded on demand), three.js in `lib/three` |
| `js/zip.js` | Zip reader / writer using the browser's (De)CompressionStream |
| `js/ui.js` | Menu bar, dropdowns, context menus, dialogs, toasts, popovers |
| `js/store.js` | AGI calls, settings / recents (localStorage fallback), IndexedDB cache |
| `js/exporter.js` | SVG export, download / save to ArozOS, printing, drill CSV |
| `js/app.js` | Application state, loading, viewer interaction, panels, menus, keys |
| `js/dialogs.js` | Preferences, export, print, go to, drill / aperture tables, reports, help |
| `js/mfg.js` | Manufacturing Capabilities Preview panel (3D view) |
| `locale/gerberviewer.json` | UI text in en-us, zh-tw, zh-hk, zh-cn, ja-jp, ko-kr |

## How it works

**Parsing.** Every layer becomes a list of polarity groups. Each group holds
items in board millimetres (Y up): discs, round-capped strokes, arc strokes and
filled contours (`geom.js` documents the shapes). Region arcs and non-circular
apertures are flattened to contours with outer loops counter clockwise and
holes clockwise, so a single nonzero fill is correct. Aperture macros are
evaluated per flash (variables and arithmetic included); exposure-off
primitives become a clipped compound item so they only cut the aperture
itself. Step and repeat and block apertures are expanded at parse time.

**Rendering.** Each layer's groups are turned once into cached `Path2D`s (one
fill path, one stroke path per line width). A layer is drawn on its own scratch
canvas (clear polarity uses `destination-out` there, so it never erases other
layers) and composited with its opacity. The realistic mode composites
substrate, copper, the solder mask with the mask layer's openings cut out,
surface finish on exposed copper, silkscreen clipped from the openings, then
trims to the board outline and punches the holes. The same scene function
draws the view, the minimap, exports, prints, thumbnails and the 3D textures.

**3D.** The outline is extruded to the board thickness with cut-outs, holes
and slots removed; top and bottom faces are textured with the realistic
render, plated holes get instanced copper barrels.

**Persistence.** Settings and the recent list (with a thumbnail and the
project's layer colours, order, visibility and view) are stored through
`prefs.agi`. Outside ArozOS they fall back to localStorage. Projects opened
from the device are cached in IndexedDB (up to 40 MB each) so they reopen from
Recents in the same browser.

## Manufacturing Capabilities Preview

Tools > Manufacturing Capabilities Preview (or the Manufacturing button in
the 3D view) opens a panel modelled on a PCB fab's order form. The choices
are saved in `settings.mfg` and, while Preview is ticked, the 3D board is
rebuilt from them:

- **Board material** (FPC or FR-4) sets the laminate colour of the edge and
  which layer counts and thicknesses can be picked (`MATERIALS` in
  `mfg.js`). Switching material resets the thickness to the material's
  usual value (1.6 mm for FR-4). FPC uses an amber coverlay instead of a
  coloured mask.
- **Layers and thickness** drive the extrusion depth and the stack-up
  stripes drawn on the board edge (`stackTexture` in `view3d.js`; outer
  copper is drawn as 1 oz).
- **Solder mask, silkscreen, surface finish** recolour the face textures.
- **Via covering** (tented, untented, plugged, resin filled + capped) changes
  how vias are drawn (`look.via` in `render.js`) and whether they are
  drilled through the 3D board. Vias come from the via drill file, or are
  plated holes of 0.45 mm and below when there is none (`board.js`).
- **Delivery format** "Panelization" lays the board out in columns and rows
  with V-cut grooves or stamp-hole tabs and optional edge rails with
  tooling holes and fiducials (`buildPanel` in `view3d.js`). The summary
  gives the panel size and boards per panel.

Changing an option keeps the scroll position of the panel and the 3D camera
(`keepView` in `setBoard`); the camera only resets for a new project.

## Localisation

All UI text goes through `T(key, englishFallback, vars)` (`GV.ui.t`), which
reads `locale/gerberviewer.json` through `script/applocale.js`; static markup
uses `locale="key"`, and tooltips are translated through the file's `titles`
map (keyed by the English title). Parser warnings, skipped-file reasons and
zip / AGI errors carry codes (`warn/*`, `skip/*`, `error/*`), so they are
translated as well. Keys whose name is built at run time: `type/*`,
`kind/*`, `tip/<n>`, `mask/*`, `finish/*`, `mfin/*`, `mat/*`, `via/*`,
`bg/*`, plus labels passed to the `row()`, `label()` and `check()` helpers. When adding a string, add the same key to every language in the
JSON file; the drill table CSV keeps English column titles on purpose.

## Limits and known gaps

- Server-side reads: 32 MB per file, 96 MB per request, 300 files; archives
  may expand to 512 MB of CAM data, tar archives up to 64 MB.
- Block apertures ignore `LM` / `LR` / `LS`; deprecated `SF`, `MI`, `IR` are
  ignored with a warning (`OF`, `IP`, `G70/71`, `G90/91` are honoured).
- An exposure-off macro primitive that only partly overlaps earlier exposure-on
  primitives is approximated.
- Zips opened from the device must not be ZIP64 or encrypted.
- Layer view hides solder mask, paste and documentation layers by default; the
  realistic preview always applies the file's solder mask (pick "None" under
  Preferences > Board for a bare board).

## Testing

The parsers have no DOM dependency: `geom.js`, `gerber.js`, `excellon.js`,
`layers.js` and `board.js` attach to `global.GV` under Node, so a small script
can `require` them and parse real fabrication files (Node 20 needs a
`DecompressionStream('deflate-raw')` shim for `zip.js`; browsers have it). The
AGI scripts need a running ArozOS: call them with
`POST /system/ajgi/interface?script=Gerber%20Viewer/backend/<script>.agi`.
