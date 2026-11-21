# ArozOS Desktop scripts and styles

This folder holds the code of the web desktop, [`desktop.html`](../../desktop.html).
The page used to carry everything inline (about 8,300 lines); it now holds only
the markup and loads the files below. The split was a pure move: functions,
global names and behaviour were unchanged. The redesign built on top of it is
described, phase by phase, in [`PROPOSAL.md`](PROPOSAL.md); phase 1 replaced the
taskbar with the dock and tray (`dock.js`, `dock.css`), phase 3 the start menu
with the launcher, phase 4 the notification, calendar and background task
panels, phase 5 the quick access panel.

## Files, in load order

Styles (all loaded in `<head>`, after Semantic UI, `script/ao.css` and the
calendar style; the desktop no longer loads the shared `script/contextmenu.css`):

| File | What it styles |
|---|---|
| `base.css` | design tokens (`--dt-*`, incl. `--dt-reserved-bottom`), page, fonts, wallpaper frames, `.themeColor`, connection lost card, global rules, z-index notes |
| `icons.css` | desktop launch icons, rubber band selection, rename box, share indicators, hover description |
| `dock.css` | the dock (`#navimenu`), the tray (`#dockTray`), the window list popover (`#stackedWindowList`) |
| `windows.css` | docking indicators, drag planes, iframe border, focus cover (the window frame is in `script/ao.css`) |
| `launcher.css` | the app launcher: search field, category pills, app grid, footer |
| `contextmenu.css` | the right click menu and its sub menu: rows, shortcuts, checks, dividers |
| `notifications.css` | notification centre and calendar card (`#notificationCenter`), toasts |
| `quickaccess.css` | quick access panel (tray server icon), a column of cards: status, controls, storage |
| `backgroundtasks.css` | background task panel: rows with progress, pause / resume, cancel |

Scripts (at the end of `<body>`, after the markup):

| File | What it does |
|---|---|
| `state.js` | every global variable of the desktop |
| `utils.js` | shared helpers: padding, truncation, touch mapping, double tap, `setStorage` / `getStorage`, colours, clipboard, `formatBytes`, CSRF tokens, IME binding |
| `session.js` | connection check, user / host info, startup sound, logout, restart / shutdown, the stored accounts listed in the launcher's account panel |
| `backgroundtasks.js` | background task panel (rows updated in place), `startFileOperation` and `openFileOperationDialog` (the single file operation dialog, also brought back after a reload) |
| `dock.js` | dock and tray: clock, window groups (`dockAddWindow` / `dockRemoveWindow` / `dockUpdateFocus`), pins, trash (empty / full, *Empty Trash Bin*), window list, dock menus, tray server status (`setTrayServerStatus`), tray panel rules (`trayClosePanels`: one open at a time, closed by a press elsewhere, a click into a window or Escape), start menu layout (`setStartMenuLayout`: dock alignment, dock and app icon sizes from the Start Menu settings page), `getReservedBottom` |
| `quickaccess.js` | quick access panel opened by the tray's server icon: server health (SMART, RAID; feeds the tray dot), network interfaces, dark mode / full screen / settings tiles, volume and brightness sliders, disk usage, all rendered from JSON endpoints |
| `notifications.js` | notification centre (`toggleNotification`, `sendNotification`, relative times), calendar card (opens the Calendar app on a day), server notification polling, toasts |
| `launcher.js` | the app launcher opened by the dock: live search, categories, grid, keyboard selection, tile and power menus, the account panel (switch / add / sign out accounts), drag to desktop / dock |
| `launch.js` | `openModule`, `openFileWithModule`, opening icons, folders and shortcuts |
| `windows.js` | float window manager: `newFloatWindow`, focus / z-order, min / max / close, setters |
| `windowmove.js` | window drag, resize, docking, title bar event hooks |
| `wallpaper.js` | wallpaper themes and slideshow |
| `theme.js` | light / dark theme, theme colour, assistive titles |
| `icons.js` | loading and drawing desktop icons, thumbnails, refresh, desktop change watch |
| `icongrid.js` | icon grid, placement, rubber band and click selection |
| `dragdrop.js` | dragging icons, dropping files / menu entries / uploads |
| `input.js` | document key bindings, modifier keys, pointer position |
| `upload.js` | uploading local files to the desktop |
| `contextmenu.js` | right click menus, sub menus, the menu building API, placement, hover and keyboard handling |
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
   | `dock.js` | `setStartMenuLayout` (System Settings > Desktop & Themes > Start Menu) |
   | `wallpaper.js` | `changeDesktopTheme`, `initBackgroundSwitchingAnimation` |
   | `backgroundtasks.js` | `startFileOperation`, `openFileOperationDialog` |
   | `launcher.js` / `icons.js` / `session.js` / `utils.js` / `boot.js` | `initModuleList` / `refresh` / `logout` / `bindObjectToIMEEvents` / `initDesktop` |

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

6. **Keep the bottom strip free.** `--dt-reserved-bottom` in `base.css` is
   the height kept for the dock. Maximized and docked windows, new windows,
   the icon grid and every bottom panel use it (`getReservedBottom()` in
   script); never hardcode a taskbar height again.

7. **The dock owns its markup.** `windows.js` only calls `dockAddWindow`,
   `dockRemoveWindow`, `dockUpdateFocus` and `dockWindowTitleChanged`. A
   window joins the dock item of the module its URL belongs to
   (`dockModuleForURL`), so the windows of a pinned app show as dots on the
   pinned icon. `#navimenu` keeps its id because System Settings' theme pages
   (`SystemAO/desktop/settings/theme.html`, `personalization.html`) preview a
   theme colour by painting `#navimenu, #dockTray` in the parent page.
   Pins are the desktop preference `dock-pinned`: a JSON list of module
   names (File Manager and System Setting when unset) and of objects for
   folders, web links and container apps (`dockPinKey`); the trash icon asks
   `/system/file_system/trashState`, which stops at the first trashed item,
   and falls back to `listTrash` on servers without it. The dock is at least
   half the screen wide; `#dockSpacer` keeps the launcher and open apps left
   and the pins and trash right.

8. **Menus are built, not written.** Use `addContextMenuItem(menu, label,
   undefined, "functionName", isSubMenu, options)` with `options.payload`,
   `icon` / `image` (only where an icon tells something: item types, apps),
   `shortcut`, `checked`, `danger`, `disabled`, plus
   `addContextMenuSeperator` and `addContextMenuTitle`; desktop icon menus
   get their Cut / Copy / Rename / Delete rows from `contextMenuEditRows`.
   No icon-only toolbars: they were tried and dropped, names read faster. A row
   calls `functionName(this, event)`; a sub menu row's function fills
   `#subcontextmenu` and calls `showSubContextMenu(row)`, also when it fills
   it later (a MutationObserver places the sub menu again). Handlers may
   read a row's label with `.text()`: keep the label the only text in a row.
   The menu takes the arrow keys, Enter and Escape in the capture phase, so
   `input.js` never sees them while a menu is open. A press anywhere outside
   it closes it; a button that opens a menu itself sets `contextMenuAnchor`
   so its own click can toggle the menu.

9. **Serving.** `/script/` is public (no login) and uses the static server's
   default caching. After editing a file here, hard-refresh the desktop or
   fetch the changed file with `{cache: "reload"}` before testing.

10. **Repository rules still apply:** no emoji (Semantic UI icons or local SVGs),
   checked by `scripts/check-conventions.sh`.

## Testing a change

There is no unit test harness for the desktop. Run a scratch ArozOS instance
(fresh `system/` copy, `web` linked to `src/web`), log in, and check the
console while exercising the start menu, a float window (drag, resize, dock,
minimize from the dock, close), the dock (several windows of one app, pin /
unpin, a launcher entry dragged onto it, a desktop icon dropped on the trash,
a narrow window so it overflows), the background / icon / title bar / dock
context menus, the quick access, notification and background task panels, and
file operations on a desktop icon. For pure refactors, comparing the computed
style of every element and the list of global functions against the previous
version (both pages in same-origin iframes) catches regressions that clicking
around misses.
