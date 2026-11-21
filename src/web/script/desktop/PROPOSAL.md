# Desktop redesign proposal

Status: **proposed**, nothing below is built yet. Phase 0 (splitting
`desktop.html` into this folder, see [`README.md`](README.md)) is done.

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
- The user's theme colour (`setThemeColor`) becomes `--dt-accent` instead of
  painting the whole taskbar.

**The taskbar height is hardcoded today** (`36px` in `windows.js`,
`windowmove.js`, and the `taskbar`, `windows`, `listmenu`, `notifications`,
`quickaccess`, `backgroundtasks` style sheets). Step one of phase 1 replaces
all of them with `--dt-reserved-bottom` (CSS) and one `getReservedBottom()`
helper (JS) so maximize, docking, the dock indicators and every panel follow
the dock.

## 1. Dock

```
             ┌──────────────────────────────────────────────────┐
             │ [::] │ [A] [B]• [C]•• │ [FM]• [SET] │ [Trash]    │
             └──────────────────────────────────────────────────┘
               launcher   open apps     pinned        trash
```

- A floating capsule centred at the bottom, `--dt-radius-l`, 8 px above the
  screen edge, 48 px icons with 6 px gaps. It replaces `#navimenu`; the new
  element **keeps the id `navimenu`**, because System Settings' theme pages
  (`SystemAO/desktop/settings/theme.html`, `personalization.html`) preview the
  theme colour by styling `#navimenu` in the parent document (or those two
  pages are updated in the same change).
- **Launcher** button, leftmost: opens the launcher (section 3).
- **Open apps:** one icon per window group, using today's grouping from
  `newFloatWindow` (same module folder, File Manager windows grouped). A dot
  under the icon marks running windows (one dot, two dots for 2 or more).
  Click: one window toggles focus / minimize as today; several windows open
  the stacked window list as a small popover above the icon.
- **Pinned apps:** File Manager and System Setting by default, each shown only
  when the user may open that module. Right click > *Keep in Dock* / *Remove
  from Dock*; dragging a launcher entry onto the pinned area pins it. The list
  is a per user desktop preference (`setStorage("dock-pinned", JSON)`, stored
  through `/system/desktop/preference`); no preference saved = the defaults.
- **Trash**, rightmost: empty / full icon, click opens the trash bin
  (`SystemAO/file_system/trashbin.html`), dropping desktop icons on it moves
  them to the trash (reuse `recycleDroppedFiles` in `dragdrop.js`).
- **Overflow:** icons shrink down to 36 px as the dock fills; past that the
  open apps section collapses into a "more" popover. No magnification on
  hover by default, only a 2 px lift and a tooltip label above the icon.
- **Right click** on a dock icon: window list, *New window*, *Keep in Dock* /
  *Remove from Dock*, *Close* / *Close all*.
- **Clock, background tasks, quick access, notifications** need a new home
  (decision D1 below). Recommended: a second, smaller capsule at the bottom
  right (Windows 11 tray position) with the background task indicator, the
  user avatar (quick access) and the time / date (notifications and calendar).
  The hostname moves into the quick access panel header.
- Maximized and docked windows stop at `--dt-reserved-bottom` so the dock is
  never covered. (Auto hide is a later setting, not part of phase 1.)

Code impact: `taskbar.js` / `taskbar.css` are rewritten as `dock.js` /
`dock.css`. Today `newFloatWindow`, `closeFwProcess`,
`findFloatWindowButtonWithID` and `resizeAllFloatWindowButtons` build and edit
the taskbar markup directly; phase 1 puts a small API in between
(`dockAddWindow(uuid, group, icon, title)`, `dockRemoveWindow(uuid)`,
`dockFocusChanged(uuid)`) so `windows.js` no longer knows the markup. The
context menu branch for `.floatWindowButton` in `contextmenu.js` moves to the
dock. `mobile.html` is not touched.

## 2. Context menu

```
  ┌─────────────────────────────────┐
  │  [cut] [copy] [ren] [shr] [del] │   <- action bar, icons only
  ├─────────────────────────────────┤
  │  Open                           │
  │  Open With                   ›  │
  │  Download                       │
  │  ───────────────────────────    │
  │  Properties                     │
  └─────────────────────────────────┘
```

- Material: `--dt-surface` + blur, `--dt-radius-m`, hairline border, soft
  shadow, 5 px inner padding; rows 30 px high with `--dt-radius-s` rounded
  hover highlight in the accent colour (white text on the accent).
- **Icons only where they matter:** the frequent file actions (Cut, Copy,
  Paste, Rename, Share, Delete) move into an icon-only action bar at the top
  of icon menus, with tooltips; every other row is text only. Keyboard
  shortcuts appear right aligned in muted text (`Ctrl+C`, or `⌘C` on a Mac),
  sub menus get a chevron, *Delete* turns red on hover.
- Background menu: *New ›*, *Paste* (when the clipboard holds files),
  *Refresh*, divider, *Open File Manager*, *Personalization*, *Wallpaper ›*,
  *Icon size ›*, divider, *Full screen*, *Sign out*. No icons.
- Behaviour: sub menus open on hover (with a short delay) as well as click,
  arrow keys / Enter / Esc navigate, the menu is clamped to the viewport
  instead of flipping at half the screen, closes on scroll, blur and Esc.
- API: `addContextMenuItem` keeps its signature so existing callers still
  work; new options `{icon, shortcut, danger, disabled}` and a new
  `addContextMenuActionBar(target, actions)`. The icon HTML that callers pass
  today as the `hotkey` argument is dropped for non-important rows.
  `script/contextmenu.css` is only used by the desktop and can be folded into
  `script/desktop/contextmenu.css`.

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

- A panel about 640 x 560 px (smaller on small screens), rising from the
  dock and aligned to the launcher button, clamped to the screen. It never
  covers the whole screen.
- **Search on top**, focused on open, filtering live as the user types
  (today it waits for Enter); Enter opens the first hit, arrow keys move
  through the grid. Search covers modules and container apps.
- **Categories** as a single row of pills under the search bar, using
  today's `listMenuCategories` (All, Media, Office, Network, Engineering,
  Development, System, Utilities, Container Apps, Other); empty categories are
  hidden.
- **Grid:** 64 px icons with a two line clamped label, 6 columns, vertical
  scroll inside the panel (decision D4).
- **Footer:** avatar + user name (opens quick access) on the left, power menu
  (sign out, restart / shut down for admins) on the right.
- Right click on a tile: *Open*, *Open in new tab*, *Keep in Dock*,
  *Add to Desktop*. Dragging a tile onto the desktop keeps working
  (`listMenuItemDragStart`), dragging it onto the dock pins it.
- Closes on Esc, outside click and after launching.
- Code: `listmenu.js` / `listmenu.css` are rewritten as `launcher.js` /
  `launcher.css`; `toggleListMenu` / `hideListMenu` stay as aliases while other
  code still calls them.

## 4. Notifications, calendar and background tasks (after 1 to 3)

- **Notification centre:** a narrow column of minimal cards (app icon, title,
  two line body, relative time), dismiss on hover, *Clear all*, a quiet empty
  state. Toasts use the same card.
- **Calendar:** a compact month card under the notifications with today's
  date as the header. Clicking a day, or *Open Calendar*, launches the
  Calendar module when the user has it (`moduleInstalled`). The Calendar app
  only reads `.ics` imports from its URL hash today; opening it on a given day
  needs a small addition there (for example `#{"date":"2026-11-21"}`).
- **Restoring the file operation dialog:** the Background tasks panel gets a
  *Show details* action (and each task row becomes clickable) that opens the
  dialog with `newFloatWindow({uid: fileOperationWindowUID, url:
  "SystemAO/file_system/file_operation.html", …})` **without** a launch hash.
  Without a hash the dialog already streams every operation of the user over
  its WebSocket (falling back to polling `/system/file_system/ongoing?all=true`),
  so operations started before the refresh show up with live progress and
  pause / cancel. To check while building it: that the dialog does not close
  itself at once when it has no operation of its own yet, and what happens to
  an operation that was waiting for an overwrite choice when the page was
  refreshed (that choice lives only in the old page).

## Phases

| Phase | Content | Main files |
|---|---|---|
| 0 | Split `desktop.html` (done) | this folder |
| 1 | Design tokens, reserved bottom area, dock with pinning and trash, tray capsule | `base.css`, `dock.js/.css` (from `taskbar.*`), `windows.js`, `windowmove.js`, `contextmenu.js` |
| 2 | Context menu restyle, action bar, keyboard navigation | `contextmenu.js/.css`, `fileactions.js` |
| 3 | Launcher | `launcher.js/.css` (from `listmenu.*`) |
| 4 | Notification centre, calendar, task dialog restore | `notifications.*`, `backgroundtasks.*`, Calendar app |

Each phase adds its new strings to `src/system/locale/desktop.json` in all six
languages it carries (zh-tw, zh-hk, zh-cn, en-us, ja-jp, ko-kr), keeps the
`parent.` API listed in `README.md`, and is checked in a scratch instance in
light and dark theme, with a custom theme colour, at 1280 x 720 and a narrow
window.

## Decisions needed

| # | Question | Recommendation |
|---|---|---|
| D1 | Where do clock, notifications, quick access and background tasks go? | A small tray capsule at the bottom right; alternative: a thin top bar |
| D2 | A pinned app that is running: dot on the pinned icon, or a second icon among open apps? | Dot on the pinned icon, no duplicates |
| D3 | Launcher position: above the launcher button, or in the bottom left corner of the screen? | Above the launcher button, clamped to the screen |
| D4 | Launcher grid: vertical scroll, or pages with dots? | Vertical scroll |
| D5 | Dock icon magnification on hover? | Off; maybe a setting later |
| D6 | Maximized windows: stop above the dock, or full height with an auto hiding dock? | Stop above the dock; auto hide as a later setting |
