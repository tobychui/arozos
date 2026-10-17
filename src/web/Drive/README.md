# Drive

A cloud drive style **interface module** for ArozOS. A permission group whose
default interface module is `Drive` signs in straight into it (from `/`), the
same way groups can boot into the Desktop or the Dashboard. It can also be
opened as a float window from the desktop.

Everything lives in this folder. Drive adds **no backend code**: it uses the
existing REST endpoints and its own AGI scripts in `backend/`.

## Files

| Path | What it does |
|---|---|
| `init.agi` | Registers the module (`Group: "Interface Module"`). |
| `index.html` | Shell: top bar, sidebar, card, app host, overlay layers. |
| `css/drive.css` | Tokens for light / dark, layout, breakpoints, container queries. |
| `css/viewer.css` | The file viewers (always dark), print rules. |
| `js/icons.js` | Every glyph as inline SVG: interface icons and the file type tiles. |
| `js/i18n.js` | `T(key, english, vars)` over `locale/drive.json`. |
| `js/api.js` | All requests. REST when allowed, `backend/fs.agi` otherwise. |
| `js/ui.js` | Toasts, menus with submenus, popovers, modals, folder picker. |
| `js/app.js` | Boot, state, routing, views, top bar, sidebar, toolbar, keys. |
| `js/listing.js` | List / grid, sorting, paging, selection, drag and drop, thumbnails. |
| `js/actions.js` | Open / open with, download, move, copy, rename, trash, star, zip ... |
| `js/transfers.js` | Uploads and server side operations, one progress panel. |
| `js/share.js` | Share dialog (links, audience, password, expiry, QR). |
| `js/details.js` | Details panel: General, Permissions, Activity, Versions. |
| `js/viewer.js` | Viewer shell: top bar, history, prev / next, shared helpers. |
| `js/viewer.image.js` | Photos: zoom / pan / rotate, filmstrip, slideshow, EXIF panel. |
| `js/viewer.video.js` | Video player: custom controls, server transcoding, subtitles, resume. |
| `js/viewer.audio.js` | Music player: tags and cover art, visualiser, queue, shuffle / repeat. |
| `js/viewer.pdf.js` | PDF reader on pdf.js: thumbnails, outline, text layer, find, print. |
| `js/viewer.doc.js` | Markdown reader and text viewer (encodings, CSV table, JSON). |
| `js/apphost.js` | Runs web apps and System Settings inside the page. |
| `js/settings.js` | Drive's own settings page (`#/settings`). |
| `js/storage.js` | Storage page (`#/storage`): usage by type, clean up, largest files, disks. |
| `backend/prefs.agi` | Settings, starred items, open history (table `Drive`). |
| `backend/scan.agi` | Recent files and the Documents / Photos / ... categories. |
| `backend/fs.agi` | File operations for users without the File Manager permission. |
| `backend/media.agi` | EXIF for the photo viewer (`imagelib`). |
| `backend/storage.agi` | Storage analysis, duplicate photos, removal of old versions. |
| `vendor/` | pdf.js 2.7.570 (Apache-2.0) and marked 12 (MIT), see below. |
| `locale/drive.json` | en-us, zh-tw, zh-hk, zh-cn, ja-jp, ko-kr. |

## Permissions and the two transports

The file system and share endpoints (`/system/file_system/*`) sit behind the
**File Manager** module permission. It is a "System Tools" module, so today
everyone has it, but an administrator setup must not be assumed:

- At boot `app.js` reads `/system/modules/list` and sets
  `DriveAPI.caps.fm` (File Manager) and `DriveAPI.caps.settings`
  (System Setting). A REST call that still answers `Permission Denied`
  switches to the reduced mode as well.
- `backend/*.agi` is always reachable: an interface module grants access to
  its own folder.
- Reduced mode (`fs.agi`) uses `filelib` / `ziplib` / `share` with the user's
  own file permissions. There is no trash (delete is permanent), folders
  cannot be renamed, uploads stop at 24 MB, and renaming or duplicating a file
  over 32 MB is refused (content is copied through memory). Copies and moves
  that keep the name go through a temporary zip and have no size limit. A
  banner tells the user.
- Endpoints that need no module permission are used directly: media
  (`/media`), quota, user info, notifications, module list, share links.
- System Settings only appears in the user menu when the user may open it.

## Document base

`index.html` sets `<base href="../">` (the web root), like the desktop page.
Hosted apps read and write their iframe `src` as web root relative paths
(`ao_module_makeSingleInstance`, the `embedded.html` launchers of Code Studio,
NotepadA, Movie ...), so they have to resolve the same way here. As a result:

- Drive's own files are referenced as `Drive/...` and `DriveAPI.ROOT` is empty.
- In-page links must go through `Drive.href(route)`; a bare `#/...` href would
  point at the web root page.
- Bump the `?v=` query on the includes when shipping changed assets.

## App host

`apphost.js` makes `window.isDesktopMode` read true (after Drive's own
`ao_module.js` has loaded) and implements the float window API apps call on
`parent`: `newFloatWindow`, `closeFwProcess`, `getFloatWindowByID`,
`MoveFloatWindowToTop`, `setFloatWindowTitle`, `openFileWithModule`,
`openModule`, `startFileOperation`, `toggleDesktopTheme`, and no-op stubs for
sizing and pinning. Windows are tabs over the file area with the markup
`.floatWindowWrapper > .floatWindow[windowId,parent,callback] > .fwtab > iframe`,
which is what `ao_module.js` walks for window ids and parent callbacks. Theme
changes are pushed to every hosted iframe through `desktopThemeChanged`, and
`initTheme` takes the theme button of File Manager.

Hosted apps read their theme from the account wide preference
`system/file_system/preference?key=file_explorer/theme` with an async `$.get`,
whose reply used to land after Drive's push and flip the app back (System
Settings even turns dark when the preference was never set). So inside Drive
that preference reads as Drive's theme: `isDesktopMode` is a getter, and the
moment an app's `ao_module.js` reads it (jQuery loaded, no app code run yet)
the app's jQuery gets an ajax transport that answers those reads locally. A
setter on `window.jQuery` / `window.$` covers pages that load another copy
later, as every System Settings page does. Writes of the preference go out.

## Routes

`#/drive/<vpath>`, `#/shared[?tab=byme]`, `#/recent`, `#/starred`, `#/trash`,
`#/category/<documents|photos|videos|music|others>`,
`#/search/<query>?in=<vpath>`, `#/settings`, `#/storage`.

## Viewers

With the "Use Drive's viewers" setting on (default), opening a photo, video,
music, PDF, Markdown or text file (text up to 5 MB) shows it in a full window
viewer inside Drive; other files go to their default web app. Nothing is
loaded from other modules, since a Drive user may not have them: the media
endpoints (`/media/*`, which only check login and file permission) and the
libraries in `vendor/` are all the viewers use.

- `viewer.js` owns the shell and registers each viewer with
  `register(kinds, { mount(ctx) })`. `ctx` carries the item, its siblings of
  the same family, the body / tool slots, a per-kind `memory`, the absolute
  file URL and `osd`, `setPrintable`, `go(±1)`, `close`. A viewer may return
  `destroy`, `key(e)`, `print`, `onResize` and `shortcuts`.
- Opening pushes a history entry, so Back closes the viewer. `close(false, fn)`
  runs `fn` only after that entry is popped; navigating earlier gets undone.
- Video: direct play when the browser can, otherwise `/media/transcode/`
  with `&start=` for seeking. Storyboard frames, embedded subtitle tracks and
  durations come from `/media/storyboard`, `/media/subtitles`,
  `/media/duration`; without ffmpeg those fall through to the plain file, so
  `fetchJSON` gives up on any non-JSON reply.
- pdf.js resolves URLs against the page, not `<base>`: the worker, cMaps and
  the file are passed as absolute URLs.
- Markdown goes through marked, then an allow-list sanitizer (scripts, event
  attributes and `javascript:` links are dropped).
- The PDF Viewer app runs a copy of `viewer.pdf.js` (`PDF Viewer/js/reader.pdf.js`,
  the Drive globals renamed, see its header). Carry PDF fixes across both.

## Storage page

`backend/storage.agi` walks the user's drive (plus each folder's `.metadata`
for trash and version history) and returns usage by type, trash and version
totals, the largest files, the quota and the storage pool; disks come from
`sysinfo` and, when the endpoint answers, from SMART
(`/system/disk/smart/getSMART`). "Old file versions" removes snapshots older
than 30 days; "Duplicate photos" hashes same-sized photos (3 GB budget) and
moves the checked copies to the trash, always keeping one per group.

## Vendored libraries

| Library | Version | License | Notes |
|---|---|---|---|
| pdf.js | 2.7.570 | Apache-2.0 (`vendor/pdfjs/LICENSE`) | `pdf.js`, `pdf.worker.js` (source map lines removed), `cmaps/` |
| marked | 12.0.0 | MIT (header in the file) | `vendor/marked/marked.min.js` |

## Localisation

Every string is `T("key", "English")`; English stays in the code as the
fallback. When adding strings, add the key to all six languages in
`locale/drive.json` (zh-hk mirrors zh-tw, like the File Manager). Server error
messages are looked up as `srv/<message>`. The language follows
`localStorage.global_language`, the same setting System Settings writes.

## AGI gotchas met while writing the backend

- POST fields become globals. Read them before declaring a variable of the
  same name (`var paths = []` is hoisted and wipes the field), and keep the
  `param()` helper's argument names unusual (`eval("name")` once returned the
  argument itself).
- `sendOK()` replies plain text; the JSON client expects `sendJSONResp`.
- `filelib` does not expose `readBinaryFile` / `writeBinaryFile`; the injected
  `_filelib_*` globals are used instead.
- `ziplib.createZipFile([..])` rejects JS arrays (Otto exports `[]string`, the
  library only accepts `[]interface{}`); pass a single string.
