# Photo

The gallery (`index.html`) and the photo viewer / editor (`embedded.html`,
see `embedded/README.md`).

## Gallery front end

| File | What it holds |
|------|---------------|
| `photo.js` | `photoListObject()`, the Alpine component: folders, search, the top right menus, settings dialog, indexing; also the old full screen viewer and Arozcast |
| `layout.js` | Zoom steps, timeline sections (Day / Month / Year), waterfall column dealing, `PhotoPreviews` (loads waterfall previews for cards near the viewport) |
| `filters.js` | The Sort & filter panel: each control owns a *slot* and writes one search chip |
| `search.js` | Chip parsing and labels, suggestion icons, `aoPhotoBackend()` |
| `i18n.js`, `locale/photo.json` | `T()` and the six languages |

The top right of the gallery has three buttons: **Sort & filter** (sort order,
"Look in" this folder or all photos, rating, date range, camera, lens, file
type, orientation, and under *Camera settings & file details* ISO, aperture,
focal length, megapixels, shutter speed, time of day, file size), **View**
(timeline Off / Day / Month / Year, layout Grid / Waterfall, a 5 step zoom;
Ctrl / ⌘ + wheel zooms too) and **Settings**. View choices are kept in
`localStorage` (`ao-photo-view`).

- The search chips are the single description of a search. A panel control
  writes a chip with a `slot`; removing that chip clears the control. Typed
  chips have no slot. Everything goes to `backend/searchPhotos.js`, whose
  header lists the query syntax (including `-token` exclusions).
- The timeline orders by the date taken. EXIF times are the camera clock,
  stored by the index as if UTC, so they are read back in UTC; file times are
  real instants and read in local time (`photoImageDate`).
- Section keys must stay unique: a list that is not in date order would bring
  a month back, and duplicate `x-for` keys break Alpine. `setTimeline` sorts
  before grouping and `groupedImages` suffixes repeats.

## Waterfall previews

System thumbnails are 480 px square crops, so the waterfall cannot use them.
`backend/previews.js` (with `previewlib.js`) draws upright, uncropped previews
(720 x 2160 at most) with the AGI `imagelib.renderPreview`, which reads JPEG,
PNG, WebP, GIF, HEIC and RAW and applies the EXIF orientation. The core
thumbnail code is not involved.

Where they are kept is a per user setting (Settings dialog, stored in
`index_meta` of the index database, which survives an index rebuild):

- **realtime** (default): drawn on every request and sent as a data URL;
  nothing stored. The blurred square thumbnail stands in until it loads
- **appdata**: `user:/.appdata/photo/previews/<hh>/<hash>.jpg`
- **custom**: the same layout inside a folder the user picks; it must be
  writable and outside the Photo library roots, and only files named like
  previews are ever deleted from it

A preview is drawn again when the photo is newer than it. The front end asks
`previews.js` for cached ones first (`generate: false`, up to 200 at a time),
then has the missing ones drawn a few per request, two requests at a time,
showing the square thumbnail until each arrives. The card shape comes from
the index (`width` / `height`, which follow the EXIF orientation since index
schema 2) and is corrected when a preview reports its real size.

## Backend scripts (`backend/`)

| Script | Purpose |
|--------|---------|
| `imagedb.js` | Shared: index schema, metadata extraction, query parser + SQL builder, exclude list |
| `indexPhotos.js` / `indexStatus.js` | Incremental indexing (also drops excluded and deleted photos) |
| `listFolder.js` | Folder listing with dates and upright sizes from the index |
| `searchPhotos.js` / `searchSuggest.js` / `searchFacets.js` | Search, autocomplete, the choices of the filter panel |
| `previewlib.js` / `previews.js` | Waterfall previews |
| `photoSettings.js` | Settings dialog: preview storage, cache size / clear, excluded folders |
| `getRating.js` / `setRating.js` | Star ratings (kept in their own table) |

All backend scripts are ES5 (Otto VM).
