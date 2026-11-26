# Photo viewer and editor (`embedded.html`)

The embedded launch mode of the Photo module: what opens when a photo is
opened from the File Manager. It copies the phone photo app: a black viewer
with a thumbnail strip, and an editor with Adjust / Filters / Crop tabs.

| File | What it does |
|---|---|
| `../embedded.html` | Markup only |
| `viewer.css` | Three layouts, picked by `updateLayout` in `viewer.js`: *desktop* (a mouse and a window at least 560 px wide: Cancel / undo top left, text tabs in the middle, crop tools and Done top right, tools under the picture with the name and value below the dial, info docked on the right, centred dialogs), *landscape* (wide touch screens: tool column plus a rail on the right) and *portrait* (tools under the picture, Cancel / tabs / Done at the bottom, action sheets) |
| `js/viewer.js` | Photo list, swipe / arrows / strip navigation, zoom and pan, info sheet, Edit, saving |
| `js/editor.js` | Editor state, tabs, dials, crop box gestures, undo / redo, full size export |
| `js/renderer.js` | One WebGL shader for every adjustment, the filters and the geometry |
| `js/geometry.js` | Crop / straighten / keystone / flip / quarter turn math (no DOM) |
| `js/ruler.js` | The dial ruler (across or upright) |
| `js/icons.js` | Inline SVG icons (no emoji, no icon font) |
| `../i18n.js`, `../locale/photo.json` | Localization, shared with the gallery: `locale="key"` on markup in `embedded.html`, `T(key, english, vars)` in scripts. The start of `viewer.js` waits for the language file |
| `listNearbyImage.js` | AGI: the photos of the folder; `detail=true` adds size and date |
| `tests/geometry.test.js` | `node web/Photo/embedded/tests/geometry.test.js` |

## Rules

- **Non-destructive until saved.** The editor keeps `{geo, adj, filter}`;
  `exportImage()` renders it once at full size. Save as Copy writes
  `<name> (Edited).<ext>` beside the original; Replace Original is offered
  only when the browser can write the original format (JPEG, PNG, WebP).
  HEIC, RAW and GIF are saved as JPEG copies.
- **Geometry lives in `geometry.js`.** The crop is a rectangle in the
  straightened space and must stay inside the warped picture
  (`feasible`). Straighten and keystone dials shrink the crop from the crop
  the dial started with (`dialBase`), so turning back grows it again.
- **HEIC and RAW are decoded on the server.** `/media` sends them as JPEG
  (`metadata.RenderHEICImage`, `metadata.RenderRAWImage`), so the viewer
  and editor only ever see browser formats.
- **Layouts share one DOM.** `placeControls` moves Cancel, the tabs, Done,
  the pill and the viewer buttons between the phone bars and the `.slot`
  spans of the desktop top bar; style changes go in `viewer.css` per
  `#app.desktop` / `.landscape` / `.portrait`.
- **Size the viewer from the loader.** The `<img>` decodes after `src` is
  set, so its `naturalWidth` can still be 0: `V.nat` comes from the
  preloading `Image()`, and Edit waits for `img.decode()`.
- Large exports are capped at 16.7 MP (mobile Safari canvas limit) and the
  GPU texture size.
