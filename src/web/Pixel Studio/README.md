# Pixel Studio

A layered image editor for ArozOS. Its own document format is PSD / PSB
(OpenRaster `.ora` as the open alternative); flat images open as one layer.
Everything runs in the browser: a WebGL2 compositor draws the document, a Web
Worker reads and writes files, and the ArozOS backend is only used for
preferences and custom brushes (`backend/prefs.js`) and the font list
(`backend/listFonts.js`).

`raw/` is a separate sub-app (Raw Editor) that develops camera RAW files and
hands the result back; `init.agi` registers both.

**Naming rule:** the app, its code, comments, presets and UI text never name
another vendor's editor or its products. File formats are named by their
format names (PSD, PSB, ABR, ORA). The global namespace `PS` stands for
**P**ixel **S**tudio.

## Files

Scripts load in `index.html` order and share one global, `PS`.

| File | What it holds |
|---|---|
| `editor.js` | `PS` itself, document creation, viewport (zoom / scroll), overlay loop, dialogs (`PS.dialog`), non-modal windows (`PS.floatingPanel`), movable / resizable windows, option-bar widgets (`PS.ui`), colours, preferences |
| `cursors.js` | the canvas cursors (`PS.cursors`): the Move pointer, rotate and resize double arrows at any angle, black with a white outline |
| `workspace.js` | the dock: panel groups with tabs, icon strip with fly-outs, floating groups, splitters, the one / two column toolbar (`PS.ws`) |
| `model.js` | the layer tree (`PS.makeLayer`, groups, masks, paint targets, blend mode list, layer state snapshots, pixels beyond the canvas edge) |
| `compositor.js` | the WebGL2 renderer: every PSD blend mode, pass-through / isolated groups, clipping, masks, fill opacity (including the "special eight" modes), Blend If, a Canvas 2D fallback (`PS.gpu`, `PS.renderer`) |
| `transform.js` | Free Transform / Transform Selection: affine and perspective (GPU warp), reference point, Transform Again; `PS.transform.layersBox()` is the box the Move tool's transform controls show |
| `effects.js` | layer styles on the GPU (jump-flood distance fields) |
| `adjust.js` | adjustment layers on the GPU |
| `vector.js` | vector masks, shape and fill layers |
| `properties.js`, `layerstyle.js` | the Properties panel and the Layer Style window |
| `history.js` | undo / redo (closures) and the History panel |
| `layers.js` | layer operations, the Layers panel, align / distribute, linking |
| `selection.js` | selections as alpha masks, marching ants, magic wand, the selection's transform handles |
| `guides.js` | rulers, guides, snapping (guides and grid) |
| `tools.js` | tool framework, pointer pipeline, toolbar, the options bar and its overflow drop-down, the basic tools (move, marquees, lassos, wand, bucket, eyedropper, shapes, hand, zoom) |
| `brushes.js` | the brush engine of Brush / Pencil / Eraser, brush tips (round and sampled), dynamics, presets, the brush picker, the Brush and Brush Presets panels, Define Brush Preset, `.abr` loading |
| `measure.js` | the Ruler and Note tools (Eyedropper group) and the Notes panel |
| `gradient.js` | the gradient tool and editor |
| `text.js` | type engine: ag-psd text data, runs, paragraphs, layout (horizontal and vertical), rendering, inline editing |
| `typetools.js` | Warp Text (15 styles), Character and Paragraph panels, the type options bar, vertical type tool, paragraph box handles |
| `filters.js` | the Filter menu (categories, settings windows with live preview, Ctrl+F) |
| `retouch.js` | Crop, Spot Healing / Healing Brush, Clone Stamp, Magic Eraser, Blur / Sharpen / Smudge, Dodge / Burn / Sponge |
| `docio.js`, `docio.worker.js` | PSD / ORA import and export, `.abr` brush files (the worker runs ag-psd and fflate) |
| `savemanager.js` | background saving, autosave, recovery copies (IndexedDB), the save status window |
| `fileio.js` | New dialog, open, save, export, geometry operations (image / canvas size, rotate, crop), clipboard, drag and drop |
| `commands.js` | menu / keyboard commands: Reselect, arrange, layer via copy, opacity keys, grid, extras, screen modes, Quick Mask, Image > Adjustments on pixels, Auto Tone / Contrast / Color, Fill, Stroke, Select > Modify, Grow, Similar, Color Range, Trim, Reveal All |
| `panels.js` | Color, Swatches, Adjustments, Styles, Channels, Navigator, Info, Histogram panels |
| `menu.js` | the menu bar and context menus, help dialogs |
| `hotkeys.js` | keyboard shortcuts |
| `main.js` | start-up |

## Ideas worth knowing before changing things

- **Straight alpha everywhere** on the GPU; texture row 0 is the top row.
- **Text is the file's own data.** `layer.text.psd` is ag-psd's
  `LayerTextData`; the layout works in text space (points) and
  `PS.textMatrix` maps layout space to the document (the transform already
  carries the resolution). Untouched text shows the pixels stored in the file
  until it is edited.
- **Warp Text** is a forward map of the text envelope (`warpTextPoint`);
  `drawWarpedText` rasterises a fine triangle mesh with one owner per pixel,
  so there are no seams. The arc family was fitted against reference
  renderings of ag-psd's `text-complex` sample (bottom corners fixed, 50 %
  bend ~80 degrees).
- **Brushes** lay dabs along the pointer path at the tip spacing into a
  stroke buffer (flow builds up inside it) that is composited with the tool's
  opacity and blend mode (`PS.compositeStroke`, also used by the live
  preview), so a stroke never darkens where it crosses itself. Size and
  hardness live at the top of the tool's options (the `[` `]` keys change
  them), everything else of the tip in `o.tip` (`PS.TIP_DEFAULTS`). Built-in
  sampled tips are drawn procedurally from seeded noise, so they never
  change; custom tips (Define Brush Preset, `.abr` files) are stored as PNG
  data URLs through `backend/prefs.js` (`getbrushes` / `setbrushes`), or in
  `localStorage` outside ArozOS. Presets live in `PS.prefs.brushPresets`
  (absent: the built-in set).
- **Retouching tools** paint a soft mask (`PS.MaskStroke`) and turn it into
  pixels; during the stroke `PS.strokePreview.bake` hands the compositor the
  result. Healing solves Laplace's equation for the tone difference
  (`PS.healRegion`). Their size / hardness use the brush picker in round-only
  mode.
- **Transform controls**: a handle scales, the band just outside a handle
  rotates (Move tool with Show Transform Controls, selection handles, Free
  Transform anywhere outside the box). Both open Free Transform with the drag
  already under way. Cursors come from `PS.cursors` and follow the angle.
- **The options bar never scrolls.** `PS.renderOptionsBar` ends with
  `PS.fitOptionsBar`: what does not fit moves into a drop-down behind a ">>"
  button (still a child of the bar, `position: fixed`, so the bar's styles
  apply); elements with the class `opt-pin` (Commit / Cancel) always stay.
  Usage hints belong in the tool's `hint` (shown in the toolbar tooltip), not
  in the bar, and the bar has no drag bars: `PS.ui.slider` is a number box
  (spinner and mouse wheel) like `PS.ui.numeric`.
- **Undo keys**: Ctrl+Z toggles the last step (undo, then redo), Ctrl+Alt+Z
  keeps stepping back, Ctrl+Shift+Z steps forward (`PS.toggleUndo`,
  `PS.stepBackward`, `PS.stepForward`; `PS.history.lastStep` remembers which).
- **Closing**: `window.ao_module_close` is overridden by `PS.requestClose`
  (the desktop calls it from the window's close button). An unsaved document
  gets Save / Don't Save / Cancel; Save closes the window once that save has
  finished (`PS.closeAfterSave`, checked in `savemanager.js`).
- **Notes** (`doc.notes`) are saved as PSD annotations (sound annotations of
  an opened file are kept in `doc.psdOtherNotes`) and in the ORA document
  data; every change goes through `PS.notesChange` (one undo step). The
  ruler (`doc.ruler`) is not saved.
- **Layering of the UI** (low to high): canvas overlays 50-60, floating
  toolbar 880, floating panel groups 900-949, panel fly-outs 950, non-modal
  windows 1000-1099, menu bar 1100, tool fly-outs, the brush picker and the
  options overflow 1150, modal dialogs 1200, busy indicator 1500, context and
  panel menus 5000, drag feedback 6000+, toasts 7000. Submenus are positioned
  in viewport coordinates so a scrolling menu never clips them.
- **The dark grey theme** is used by every menu, dialog and window; colours
  come from the `:root` variables in `css/style.css`.
- **No emoji** (repository rule): icons are inline SVG or typographic
  characters.
- **Undo** is closure based: an operation pushes `(undo, redo)` with the
  canvases it needs (`PS.commitLayerCanvas`, `PS.layerStructure`,
  `PS.docGeometryOp`).

## Testing

The editor can run outside ArozOS (static server over `src/web`, then open
`Pixel Studio/index.html`); preferences fall back to `localStorage` and the
AGI calls simply fail. Useful checks after changes:

- open PSDs that use groups, masks, clipping, styles, adjustments, smart
  objects and text and compare `PS.renderer.compositeCanvas()` with the
  composite stored in the file (`PS.docio.readComposite`);
- save as PSD, read it back with `PS.docio.read`, and compare the layer data
  (and `meta.annotations` for notes);
- paint one stroke with every built-in brush preset (`PS.BRUSH_PRESETS_BUILTIN`)
  and look at the result;
- switch through every tool at a narrow window (about 640 px) and check the
  options bar fits (`scrollWidth <= clientWidth`);
- open every menu, submenu, dialog and window at a small window size
  (about 520 x 420) and check nothing leaves the viewport.

The Go side of PSD / ORA support (thumbnails in the File Manager) lives in
`src/mod/filesystem/metadata/` (`psd.go`, `ora.go`) with its tests.
