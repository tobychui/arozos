# Desktop redesign proposal

Status: phase 0 (splitting `desktop.html` into this folder, see
[`README.md`](README.md)), phase 1 (dock and tray), phase 2 (context menu),
phase 3 (launcher), phase 4 (notifications, calendar and background tasks)
and phase 5 (quick access panel) are done. The owner took every
recommendation in *Decisions* below.

## Goal

The desktop still wears pieces of three older systems: a full width black
taskbar, a two column start menu, square context menus with an icon on almost
every row, and a large notification / calendar sheet. The new look mixes a
centred dock and a launcher grid (the macOS family) with the bottom anchored,
corner sized panels and rounded, layered materials of Windows 11.

Requested items:

1. A centred bottom dock: launcher, divider, open apps, divider, pinned apps
   (File Manager and System Setting by default, unpinnable), divider, trash.
2. A refreshed context menu that uses icons only on the important actions.
3. A launcher with a search bar on top and an icon grid, popping up from the
   bottom and taking only its corner of the screen, not the whole screen.
4. Minimal notifications and calendar (the calendar opens the Calendar app
   when it is installed), and reopening the file operation dialog from the
   Background tasks panel after a page refresh while operations still run.

Items 1 to 3 come first, item 4 after.

Naming: in code and user visible strings, use neutral names (*Dock*, *Apps* /
*launcher*, *Trash*), not product names such as "Launchpad" or "Start".

## Shared design language (all phases)

Design tokens as CSS custom properties in `base.css`, redefined under
`body.darkTheme`, so every new component reads the same values:

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--dt-surface` | `rgba(246,246,248,0.72)` | `rgba(32,32,36,0.66)` | dock, menus, panels |
| `--dt-surface-solid` | `#f6f6f8` | `#202024` | fallback without `backdrop-filter` |
| `--dt-blur` | `saturate(180%) blur(24px)` | same | material |
| `--dt-border` | `rgba(0,0,0,0.08)` | `rgba(255,255,255,0.10)` | 1px hairline |
| `--dt-shadow` | `0 8px 32px rgba(0,0,0,0.18)` | `0 8px 32px rgba(0,0,0,0.45)` | floating layers |
| `--dt-radius-l / m / s` | 18 / 12 / 7 px | same | dock & panels / menus / rows |
| `--dt-accent` | user theme colour, else `#2f7cf6` | same | selection, focus, dots |
| `--dt-reserved-bottom` | dock height + 2 x gap | same | space kept free by maximized windows |

- Typography stays on the system font stack (the font library injects the
  language font, see `applocale.js`); 13 px menus, 12 px labels.
- Motion: 120 to 180 ms ease-out for open / close (fade + 4 px rise or 0.98
  scale), nothing longer. Respect `prefers-reduced-motion`.
- Icons: Semantic UI first, local SVGs for the dock specials (launcher grid,
  trash empty / full). No emoji.
- Browsers without `backdrop-filter` get `--dt-surface-solid`.
- The user's theme colour (`setThemeColor`) becomes `--dt-accent`. It still
  tints the dock and tray as it tinted the taskbar, because System Settings
  previews a colour by painting `#navimenu`; on a tint the dock and tray
  switch to light content (`body.themeTinted`).

The taskbar height used to be hardcoded (`36px` in `windows.js`,
`windowmove.js`, the icon grid and six style sheets). Phase 1 replaced all of
them with `--dt-reserved-bottom` (CSS) and `getReservedBottom()` (JS).

## 1. Dock

```
             ┌──────────────────────────────────────────────────┐
             │ [::] │ [A] [B]• [C]•• │ [FM]• [SET] │ [Trash]    │
             └──────────────────────────────────────────────────┘
               launcher   open apps     pinned        trash
```

As built in phase 1:

- A floating capsule centred at the bottom, `--dt-radius-l`, 6 px above the
  screen edge, 36 px icons by default (see section 6). It **keeps the id `navimenu`**, because System
  Settings' theme pages (`SystemAO/desktop/settings/theme.html`,
  `personalization.html`) preview the theme colour by painting `#navimenu`
  (and now `#dockTray`) in the parent document.
- **Launcher** button, leftmost: opens the launcher (today the start menu,
  placed above the button; section 3 replaces it).
- **Open apps:** one icon per window group. A window belongs to the module
  whose start page or folder holds its URL (`dockModuleForURL`); windows of
  no module keep the old taskbar grouping. One dot for a window, two dots for
  several, an accent pill under the group of the focused window. Click: one
  window toggles focus / minimize; several windows open the window list
  popover above the icon.
- **Width and order:** at least half the screen wide (narrower only when the
  tray needs the room); a spacer keeps the launcher and open apps at the left
  end, the pinned items and the trash at the right end.
- **Pinned apps:** File Manager and System Setting by default, each shown only
  when the user may open that module. A pinned app's windows show as dots on
  the pinned icon (D2). Right click > *Keep in Dock* / *Remove from Dock*;
  dragging a launcher entry onto the dock pins it. Folders and shortcuts
  (module, folder, web link, container app) dropped from the desktop, and
  folders dragged from a File Manager window, are pinned as well; a pinned
  folder opens in the File Manager, a pinned link or container app gathers
  its own windows. The trash shortcuts are not pinned, the dock has its own
  trash. The list is the desktop preference `dock-pinned` (module names and,
  for the rest, objects); none saved means the defaults, `[]` means nothing
  pinned.
- **Trash**, rightmost: empty / full icon from `/system/file_system/trashState`
  (checked on start, after desktop deletes and every minute), click opens the
  trash in the File Manager, dropping desktop icons on it recycles them.
  Hidden for users without File Manager access.
- **Overflow:** while the dock fits in the middle without touching the tray it
  stays centred; otherwise it moves into the space left of the tray, then its
  icons shrink down to 30 px, then the last open apps move into a "more"
  item whose window list holds their windows. No magnification (D5): a 3 px
  lift and a name tooltip.
- **Right click** on a dock icon: its windows, *New Window* (or *Open*),
  *Keep in Dock* / *Remove from Dock*, *Close* / *Close All*; the menu opens
  above the dock. The trash has *Open* and *Empty Trash Bin* (confirmed inside
  the trash menu itself, greyed out while the trash is empty).
- **Tray** (D1), a smaller capsule at the bottom right: background tasks, a
  server icon and the clock (notifications and calendar). The server icon
  opens the quick access panel (section 5): server status, quick settings
  and disks; it carries an amber or red dot when the disk health check or a
  RAID array reports a problem (`setTrayServerStatus`, fed by
  `qaRenderHealth` in `quickaccess.js`).
  Accounts moved to the launcher (below). A dot on the clock marks
  notifications.
- Maximized, docked and new windows, the icon grid and the bottom panels stop
  at `--dt-reserved-bottom` (D6).

Code: `dock.js` / `dock.css` replaced `taskbar.js` / `taskbar.css`.
`windows.js` reaches the dock only through `dockAddWindow`,
`dockRemoveWindow`, `dockUpdateFocus` and `dockWindowTitleChanged`.
`mobile.html` is not touched.

## 2. Context menu

```
  ┌───────────────────────────┐
  │  Open                     │
  │  Open with…            ›  │
  │  ───────────────────────  │
  │  Cut               Ctrl+X │
  │  Copy              Ctrl+C │
  │  Rename                   │
  │  Delete               Del │   <- red on hover
  │  ───────────────────────  │
  │  Share                 ›  │
  │  Download                 │
  │  ───────────────────────  │
  │  Properties               │
  └───────────────────────────┘
```

As built in phase 2:

- Material: `--dt-menu-surface` (more opaque than the dock, for legibility)
  + blur, `--dt-radius-m`, hairline border, soft shadow, 5 px inner padding;
  28 px rows with a 6 px rounded highlight in the accent colour (white text
  on the accent), a short fade-in.
- **Text rows, icons only where they are the information** (item types in
  *New*, applications in *Open with*). Desktop icon menus group Cut, Copy
  (with their shortcuts, `⌘C` on a Mac), Rename and Delete (shortcut, red
  on hover); several selected icons get Cut, Copy, Delete; shortcuts get
  Rename, Delete. A first version put these in an icon-only toolbar at the
  top of the menu (the Windows 11 style); the owner dropped it because such
  toolbars are a known complaint of Windows 11 users, so they are rows
  again.
- Background menu: *New ›*, *Paste Here* (when the clipboard holds files,
  with its shortcut), *Refresh*, divider, *Open File Manager*,
  *Personalization*, *Desktop background ›*, *Icon size ›*, divider,
  *Toggle Full Screen*, *Logout*.
- Share sub menu: plain section title, the current permission checked,
  *Remove File Share* turns red; *Copy Link* answers with *Copied* and a check.
- Behaviour: sub menus open on hover after 160 ms (and on click); hovering
  another row closes them after 300 ms unless the pointer reaches the sub
  menu. Arrow keys (wrapping around), Enter, Space and Escape navigate,
  Right / Left open and close sub menus. The menu opens at the
  pointer and flips left / up only when it would leave the screen; it closes
  on Escape, a click elsewhere, window blur (a click into a window), resize
  and the mouse wheel.
- API: `addContextMenuItem` keeps its signature; options `icon`, `image`,
  `shortcut`, `checked`, `danger`, `disabled`; `contextMenuEditRows` adds
  the editing rows. The icon HTML old callers pass as `hotkey` is dropped,
  except a check mark, which still means *checked*.
  The desktop stopped loading the shared `script/contextmenu.css` (the file
  stays for anything outside the desktop that links it).
- Fixed on the way: the Enter that confirms a rename no longer also opens
  the renamed file (its key-up reached the "Enter opens selected icons"
  binding).

## 3. Launcher

```
                    ┌──────────────────────────────────────┐
                    │  [ search apps…                    ] │
                    │  All  Media  Office  Network  …      │
                    │  ┌──┐  ┌──┐  ┌──┐  ┌──┐  ┌──┐  ┌──┐  │
                    │  └──┘  └──┘  └──┘  └──┘  └──┘  └──┘  │
                    │  name  name  name  name  name  name  │
                    │  …                                   │
                    │  (avatar) user name          [power] │
                    └──────────────────────────────────────┘
                    [::] │ open apps │ pinned │ trash        <- dock
```

As built in phase 3:

- A panel of at most 660 x 580 px (smaller on small screens) rising from the
  dock, its left edge near the launcher button, clamped to the screen; it
  never covers the whole screen. The launcher button looks pressed while it
  is open.
- **Search on top**, focused on open, filtering as the user types: names
  containing the text first, then apps whose start page folder is exactly
  the text (as the old search did). It covers modules and container apps;
  the first hit is selected, so Enter opens it.
- **Keyboard** without leaving the search field: arrows move the selection
  through the grid (Up from the first row returns to the text), Enter opens,
  Tab / Shift+Tab walk the categories, Escape clears the search, then
  closes. Keys typed there no longer reach the desktop's own bindings (the
  old search box let Ctrl+V paste copied files onto the desktop and Enter
  open the selected icons).
- **Categories** as one row of pills (scrolls sideways, also with the mouse
  wheel) from `listMenuCategories`; empty ones are hidden, *All* includes
  container apps.
- **Grid:** 60 px icons, two line labels, as many columns as fit (6 at full
  size), vertical scroll (D4).
- **Footer:** avatar and user name, power button with *Logout* and, where
  power management is allowed, *Restart Server* / *Shutdown Server*, opening
  above the button.
- **Account panel**, opened by the avatar and name: the signed in user and
  groups, the other accounts stored in this browser (a click switches to
  one, an expired one asks to sign in again), *Add another account*,
  *Sign-out all accounts* and *Logout*. It closes with a second click,
  Escape, a press elsewhere in the launcher, or the launcher.
- Right click on a tile: *Open*, *Open in new tab*, *Keep in Dock* /
  *Remove from Dock* (modules), *Add to Desktop*. Dragging a tile onto the
  desktop makes a shortcut, onto the dock pins it.
- Closes on Escape, a press outside it, a click into a window, and after
  launching.
- Code: `launcher.js` / `launcher.css` replaced `listmenu.*`; the ids
  `#listMenu`, `#listMenuItem`, `#searchBar` and the functions other code
  calls (`toggleListMenu`, `hideListMenu`, `initModuleList`, ...) stay.

## 4. Notifications, calendar and background tasks

As built in phase 4:

- **Tray panels.** The task icon, the server icon and the clock each open a
  panel above the tray's right end. One is open at a time; a press anywhere
  else, a click into a window and Escape close it (`trayClosePanels` and
  `trayToggleAllowed` in `dock.js`, the latter so a tap that fires both
  touchstart and click counts once).
- **Notification centre** (`#notificationCenter`, opened by the clock): a
  card with the notifications, newest first: app icon, title, three line
  body, a relative time in the user's language (`Intl.RelativeTimeFormat`,
  refreshed every 30 s while open), a dismiss button on hover, *Clear all*
  only when there is something to clear, and a quiet empty state. Toasts of
  server notifications use the same card. `sendNotification(title, content,
  icon, windowOpenOption)` keeps its signature.
- **Calendar card** under it: today's weekday and date, a six week month grid
  (names from the browser, weeks start on Sunday), previous / next month, the
  month name returns to this month. When the user has the Calendar module, a
  day opens it on that day and *Open Calendar* opens it as is; the Calendar
  app now reads `#{"date":"YYYY-MM-DD","view":"day"}` from its URL hash. The
  old jsCalendar files are no longer loaded by the desktop.
- **Background tasks** (`#backgroundTaskPanel`): one row per running file
  operation (operation icon, *Copying file.bin*, source and target folder,
  progress bar, percentage or *Paused* / *Stopping*, pause / resume and
  cancel). Rows update in place every second while something runs, so the
  buttons do not flicker; file names are set as text. The tray icon spins
  while something moves and shows a pause sign when everything waits.
- **Restoring the file operation dialog:** a row or *Show details* calls
  `openFileOperationDialog()`: the open dialog comes to the front, otherwise
  a new one starts without a launch hash and picks every operation of the
  user up from the server, so it also works after the desktop was reloaded
  (checked with a paused 2 GB copy across a reload). The dialog joins the
  pinned File Manager icon on the dock, like before.
- **Not covered:** an operation that was waiting for an overwrite choice when
  the page was reloaded; that question lived only in the old page.

## 5. Quick access panel (control centre)

Before phase 5 the panel the tray's server icon opens kept the old two column
Semantic UI layout, with two HTML fragments loaded into the page for the
status and the disks (`SystemAO/desktop/utils/sysoverview.html` and
`diskoverview.html`, now removed: nothing else loaded them).

As built in phase 5 (decisions D7 to D9):

- **One column of cards, 360 px** (D8), above the tray like the other tray
  panels and following their rules (one at a time, press outside, a click
  into a window, Escape).
- **Status card:** a coloured status (*Good*, *Warning*, failing) with a
  round icon, *Details* (opens System Settings), host name, the main network
  address and device UUID, and the firmware line. The status is the worse of
  the disk SMART check and the RAID arrays, and it also sets the dot on the
  tray icon (`qaRenderHealth`, `setTrayServerStatus`).
- **Network** (D9): the interface most likely to be the way in (scored on
  state, type, IPv4, and names that give away virtual adapters and overlay
  networks such as VirtualBox or ZeroTier); its name opens a menu of the
  others, and the choice is remembered per browser (`desktop-qa-iface`).
- **Controls:** *Dark Mode*, *Full Screen* and *System Settings* tiles (the
  first two lit while on), then volume and brightness sliders
  (`input type=range`, keyboard friendly) with their value; they keep the
  `localStorage` keys `global_volume` and `brightness` (0 to 1) WebApps read.
  The drag is the desktop's own, not the browser's: Firefox cancels a
  native range drag when the slider loses the mouse and restores the old
  value without a `change`. The whole row captures the pointer, the value
  follows it (the screen follows brightness live) and is saved on release;
  the range input itself takes no pointer events and serves the keyboard.
  Restart and shut down are only in the launcher's power menu (D7). Theme
  colours stay in System Settings.
- **Storage card** (administrators, as the disk endpoints are): one row per
  disk with its name, a thin usage bar (accent, amber from 80 %, red from
  90 %) and the free space, details in the tooltip; unmounted disks say so;
  RAID arrays show *Healthy* / *Degraded*. More than four rows collapse behind
  *Show all*, and the list scrolls rather than the panel, so the cards keep
  their shadows. Windows and Linux are read; macOS (another answer format)
  shows no storage card, as before.
- **Code:** `quickaccess.js` renders all of it from the JSON endpoints
  (`/system/network/getNICinfo`, `/system/disk/smart/getSMART`,
  `/system/disk/diskmg/view`, `/system/disk/raid/overview`) at boot, when the
  panel opens with data over a minute old, and every 15 minutes. The Linux
  branch now reads `df`'s 1K blocks as numbers; the old fragment added them
  up as text. The interface menu closes with `contextMenuHideOnly`, since
  `hideAllContextMenus` also closes the quick access and task panels.

## 6. Start Menu settings (after 5)

A page in System Settings > Desktop & Themes, *Start Menu*
(`SystemAO/desktop/settings/startmenu.html`, registered in `src/desktop.go`),
with live previews and changes saved as they are made:

- **Alignment:** the dock at the left or the center (default) of the screen;
  the launcher opens above its button, so it follows (`body.dockAlignLeft`,
  and a left branch in `resizeAllFloatWindowButtons`).
- **Icon size** of the dock: tiny (30 px), small (36, default), medium (44)
  or large (52). The dock and tray height and `--dt-reserved-bottom` follow
  (`body.dockIcons*` in `base.css`), so maximized windows and the panels move
  with them and the icon grid is redrawn.
- **App icon size** of the launcher: small (44 px, default), medium (60) or
  large (76), with wider grid columns for the larger sizes (`body.appIcons*`).
- Small is the base `base.css` and `launcher.css` start from, so the desktop
  does not show another size before the preferences arrive.

They are the desktop preferences `startmenu-align`, `startmenu-iconsize` and
`startmenu-appiconsize`, removed when set back to the default. The desktop
reads them on start (`initStartMenuLayout`); the page calls
`setStartMenuLayout` in the desktop it runs in and writes
`desktop/startMenuChanged` to `localStorage` for desktops in other tabs.

## Phases

| Phase | Content | Main files |
|---|---|---|
| 0 | Split `desktop.html` (done) | this folder |
| 1 | Design tokens, reserved bottom area, dock with pinning and trash, tray capsule (done) | `base.css`, `dock.js/.css` (replaced `taskbar.*`), `windows.js`, `windowmove.js`, `contextmenu.js`, `/system/file_system/trashState` |
| 2 | Context menu restyle, text rows with shortcuts, keyboard navigation (done) | `contextmenu.js/.css`, `share.js`, `fileactions.js`, `input.js` |
| 3 | Launcher (done) | `launcher.js/.css` (replaced `listmenu.*`), `contextmenu.js`, `desktop.json` |
| 4 | Notification centre, calendar, background tasks, task dialog restore, tray panel rules (done) | `notifications.*`, `backgroundtasks.*`, `dock.js`, `quickaccess.js`, Calendar app |
| 5 | Quick access panel as a control centre (done) | `quickaccess.*`, `session.js`, `theme.js`, `desktop.html`, `desktop.json` |
| 6 | Start Menu settings: dock alignment, dock and app icon sizes (done) | `SystemAO/desktop/settings/startmenu.html`, `dock.js`, `base.css`, `dock.css`, `launcher.css`, `src/desktop.go`, `system_settings*.json` |

Each phase adds its new strings to `src/system/locale/desktop.json` in all six
languages it carries (zh-tw, zh-hk, zh-cn, en-us, ja-jp, ko-kr), keeps the
`parent.` API listed in `README.md`, and is checked in a scratch instance in
light and dark theme, with a custom theme colour, at 1280 x 720 and a narrow
window.

## Decisions

Taken on 2026-11-21: every recommendation below (D7 to D9 for phase 5).

| # | Question | Decision |
|---|---|---|
| D1 | Where do clock, notifications, quick access and background tasks go? | A small tray capsule at the bottom right; alternative: a thin top bar |
| D2 | A pinned app that is running: dot on the pinned icon, or a second icon among open apps? | Dot on the pinned icon, no duplicates |
| D3 | Launcher position: above the launcher button, or in the bottom left corner of the screen? | Above the launcher button, clamped to the screen |
| D4 | Launcher grid: vertical scroll, or pages with dots? | Vertical scroll |
| D5 | Dock icon magnification on hover? | Off; maybe a setting later |
| D6 | Maximized windows: stop above the dock, or full height with an auto hiding dock? | Stop above the dock; auto hide as a later setting |
| D7 | Restart and shut down in the quick access panel too, or only in the launcher's power menu? | Only in the launcher, so the panel holds no destructive buttons |
| D8 | One column control centre, or keep two columns (settings and status) side by side? | One column of cards, 360 px like the other tray panels |
| D9 | Network: the main address with a menu for the others, or every interface listed? | Main address and a menu |
