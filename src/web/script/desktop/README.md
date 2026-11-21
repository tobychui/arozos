# ArozOS Desktop scripts and styles

This folder holds the code of the web desktop, [`desktop.html`](../../desktop.html).
The page used to carry everything inline (about 8,300 lines); it now holds only
the markup and loads the files below. The split was a pure move: functions,
global names and behaviour are unchanged. The redesign planned on top of this
is described in [`PROPOSAL.md`](PROPOSAL.md).

## Files, in load order

Styles (all loaded in `<head>`, after Semantic UI, `script/ao.css`,
`script/contextmenu.css` and the calendar style):

| File | What it styles |
|---|---|
| `base.css` | page, fonts, wallpaper frames, `.themeColor`, connection lost card, global rules, z-index notes |
| `icons.css` | desktop launch icons, rubber band selection, rename box, share indicators, hover description |
| `taskbar.css` | bottom taskbar (`#navimenu`), window buttons, clock, stacked window list, legacy status bar |
| `windows.css` | docking indicators, drag planes, iframe border, focus cover (the window frame is in `script/ao.css`) |
| `listmenu.css` | start menu |
| `contextmenu.css` | desktop overrides of `script/contextmenu.css` |
| `notifications.css` | notification and calendar panel, toasts, blur fallback |
| `quickaccess.css` | quick access panel |
| `backgroundtasks.css` | background task panel |

Scripts (at the end of `<body>`, after the markup):

| File | What it does |
|---|---|
| `state.js` | every global variable of the desktop |
| `utils.js` | shared helpers: padding, truncation, touch mapping, double tap, `setStorage` / `getStorage`, colours, clipboard, `formatBytes`, CSRF tokens, IME binding |
| `session.js` | connection check, user / host info, startup sound, logout, restart / shutdown, stored accounts |
| `backgroundtasks.js` | background task panel, `startFileOperation` (the single file operation dialog) |
| `taskbar.js` | clock, taskbar window buttons, stacked window list |
| `quickaccess.js` | quick access panel, volume, brightness, full screen |
| `notifications.js` | notification panel, `sendNotification`, server notification polling, toasts |
| `listmenu.js` | start menu: categories, container apps, search, drag to desktop |
| `launch.js` | `openModule`, `openFileWithModule`, opening icons, folders and shortcuts |
| `windows.js` | float window manager: `newFloatWindow`, focus / z-order, min / max / close, setters |
| `windowmove.js` | window drag, resize, docking, title bar and taskbar button event hooks |
| `wallpaper.js` | wallpaper themes and slideshow |
| `theme.js` | light / dark theme, theme colour, assistive titles |
| `icons.js` | loading and drawing desktop icons, thumbnails, refresh, desktop change watch |
| `icongrid.js` | icon grid, placement, rubber band and click selection |
| `dragdrop.js` | dragging icons, dropping files / menu entries / uploads |
| `input.js` | document key bindings, modifier keys, pointer position |
| `upload.js` | uploading local files to the desktop |
| `contextmenu.js` | right click menus and their sub menus, menu item helpers |
| `fileactions.js` | the actions behind the menus: open with, download, zip, rename, delete, copy / cut / paste, new items |
| `share.js` | share links of desktop files |
| `boot.js` | **last**: loads the locale, runs `initDesktop`, requests the first background task list |

## Rules

1. **Classic scripts, one global scope.** No modules, no IIFE wrappers.
   `desktop.html` and the markup the scripts generate use inline handlers
   (`onclick="toggleListMenu();"`, `onclick="${functionName}(this,event);"`),
   and other pages call the desktop through `parent.`. The ones in use today:

   | File | Called from other pages |
   |---|---|
   | `windows.js` | `newFloatWindow`, `getFloatWindowByID`, `MoveFloatWindowToTop`, `closeFwProcess`, `setFloatWindowTitle`, `setFloatWindowSize`, `setFloatWindowMinSize`, `setFloatWindowResizePolicy`, `setFloatWindowTheme`, `PinFloatWindowToTopMostMode`, `UnpinFloatWindowFromTopMostMode` |
   | `launch.js` | `openModule`, `openFileWithModule`, `openContainerAppShortcut` |
   | `theme.js` | `initTheme`, `setThemeColor`, `toggleDesktopTheme`, `setAssistiveTitles` |
   | `wallpaper.js` | `changeDesktopTheme`, `initBackgroundSwitchingAnimation` |
   | `backgroundtasks.js` | `startFileOperation` |
   | `listmenu.js` / `icons.js` / `session.js` / `utils.js` / `boot.js` | `initModuleList` / `refresh` / `logout` / `bindObjectToIMEEvents` / `initDesktop` |

   Renaming or removing any of these breaks WebApps (most go through
   `script/ao_module.js`); `mobile.html` keeps the same float window API.

2. **Nothing starts before `boot.js`.** The browser may run AJAX callbacks and
   timers *between* two `<script src>` files, so a file may only run code at
   load time that uses its own declarations or those of earlier files (event
   bindings are fine, they only fire later). Anything that starts the desktop
   or needs translated strings belongs in `boot.js` / `initDesktop`.

3. **Request order at startup:** `boot.js` asks for the locale first and the
   background task list second. Reversing them shows the empty task panel in
   English, because it is drawn before the strings arrive.

4. **Style order matters.** The `<link>` order decides ties between rules of
   equal specificity. `base.css` holds rules that reach every panel:
   `body.darkTheme i`, `body.whiteTheme .item:not(.clickable):hover`
   (`!important`, used by the start menu, context menu and quick access), and
   `.disabled`.

5. **Paths.** Scripts resolve URLs against the page (`system/...`, `img/...`).
   Style sheets resolve `url()` against themselves, so they need `../../img/...`.

6. **Serving.** `/script/` is public (no login) and uses the static server's
   default caching. After editing a file here, hard-refresh the desktop or
   fetch the changed file with `{cache: "reload"}` before testing.

7. **Repository rules still apply:** no emoji (Semantic UI icons or local SVGs),
   checked by `scripts/check-conventions.sh`.

## Testing a change

There is no unit test harness for the desktop. Run a scratch ArozOS instance
(fresh `system/` copy, `web` linked to `src/web`), log in, and check the
console while exercising the start menu, a float window (drag, resize, dock,
minimize from the taskbar, close), the background / icon / title bar / taskbar
context menus, the quick access, notification and background task panels, and
file operations on a desktop icon. For pure refactors, comparing the computed
style of every element and the list of global functions against the previous
version (both pages in same-origin iframes) catches regressions that clicking
around misses.
