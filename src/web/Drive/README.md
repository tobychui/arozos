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
| `js/preview.js` | Built-in previewer: images, video, audio, PDF, text. |
| `js/apphost.js` | Runs web apps and System Settings inside the page. |
| `js/settings.js` | Drive's own settings page (`#/settings`). |
| `backend/prefs.agi` | Settings, starred items, open history (table `Drive`). |
| `backend/scan.agi` | Recent files and the Documents / Photos / ... categories. |
| `backend/fs.agi` | File operations for users without the File Manager permission. |
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

`apphost.js` sets `window.isDesktopMode = true` (after Drive's own
`ao_module.js` has loaded) and implements the float window API apps call on
`parent`: `newFloatWindow`, `closeFwProcess`, `getFloatWindowByID`,
`MoveFloatWindowToTop`, `setFloatWindowTitle`, `openFileWithModule`,
`openModule`, `startFileOperation`, `toggleDesktopTheme`, and no-op stubs for
sizing and pinning. Windows are tabs over the file area with the markup
`.floatWindowWrapper > .floatWindow[windowId,parent,callback] > .fwtab > iframe`,
which is what `ao_module.js` walks for window ids and parent callbacks. Theme
changes are pushed to every hosted iframe through `desktopThemeChanged`.

## Routes

`#/drive/<vpath>`, `#/shared[?tab=byme]`, `#/recent`, `#/starred`, `#/trash`,
`#/category/<documents|photos|videos|music|others>`,
`#/search/<query>?in=<vpath>`, `#/settings`.

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
