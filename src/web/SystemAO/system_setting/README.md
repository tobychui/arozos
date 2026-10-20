# System Settings shell

`index.html` + `main.js` + `main.css` + `tokens.css` are the System Settings
app. Every settings page (registered with `registerSetting` in Go, listed by
`/system/setting/list?tree=true`) is an HTML fragment that the shell fetches
and inserts into `#detail-inner`, so its `<style>` and `<script>` run inside
the shell document.

## Layout

- **Sidebar**: search (`/` focuses it), account card (opens My Account), and
  every group with its pages. Drag the right edge to resize; narrower than
  140 px snaps to the icon rail, double click toggles it. The width and rail
  state are kept in `localStorage` (`ao_systemsetting_sidebar`). On start
  every group is folded except the one holding the opened page. Windows under
  640 px always use the rail; the search button then opens the full tree over
  the content.
- **Group tiles**: `GROUP_STYLE` in `main.js` maps a group id to a tone
  (`--tone-<name>-bg/fg` in `tokens.css`) and a 24 px stroke icon. A new
  group falls back to the gray tone and a generic icon.
- **Page header**: breadcrumb (group) and title (page name) come from the
  shell. Pages must not repeat the title; keep a one line description at most.

## Writing a page

- **Colours**: use the `--ss-*` tokens from `tokens.css` (they switch with
  `body.dark`). Do not add a per-page dark palette. Declare page aliases on
  the page root element, never on `:root` (aliases there resolve to the light
  values).
- **Spacing**: the shell pads the page (22 px). The page root needs no
  padding, background, max-width or `min-height: 100vh`. Two-panel pages that
  draw edge to edge go in `FLUSH_PAGES` and use `height: 100%`.
- **Scope**: prefix every selector with the page root id. No global `*`,
  `body` or `html` rules. The shell removes `<script>` tags for jQuery,
  Semantic UI, `ao_module.js` and `applocale.js` (and the Semantic UI
  stylesheet) from a page before inserting it, because running jQuery again
  would drop the Semantic UI plugins for every later page.
- **One function group, one white area**: a page with a single group puts
  it in one card (or one table), not a card inside a card; several groups
  get one card each. Start the page with `ss-page-desc` when it needs a one
  line explanation.
- **Components** (`main.css`): `ss-page-desc`, `ss-section` / `ss-section-title`, `ss-card`,
  `ss-row` (`ss-row-text`, `ss-row-label`, `ss-row-desc`, `ss-control`),
  `ss-input`, `ss-unit-input`, `ss-select`, `ss-switch`, `ss-btn`
  (`primary`, `danger`, `danger-outline`, `plain`), `ss-segmented`,
  `ss-badge` (`success`, `accent`, `danger`, `warning`, `flag`), `ss-stats` /
  `ss-stat`, `ss-note`, `ss-savebar` + `ss-status`, `ss-empty`. The Runtime
  (`boot/bootflags.html`) and Power (`boot/poweroff.html`) pages use them.
- **Hooks**:
  - an element with `data-ss-page-actions` is moved into the page header
    (e.g. the Live / 1 h / 24 h switch of Performance);
  - `window.ssOnPageLeave = fn` runs when the user leaves the page (stop
    timers, destroy charts);
  - `window.detailPageThemeCallback = fn(isDark)` runs on a theme change;
    a page may also assign `window.desktopThemeChanged`, the shell keeps its
    own handler and calls the page's after it;
  - `msgbox(text, ok, ms)` shows a toast; `openSubcat(moduleInfo)` opens
    another settings page.
- **Locale**: the locale files are served from `src/system/locale` at
  `../locale/` (see "System locale files and fonts" in the root CLAUDE.md).
  The shell sets `window.applocaleSkipFontFamily`, so applocale does not
  write fonts inline; the page font comes through `--ss-font`. When the
  language uses a font from the font library (System Fonts page), the locale
  block names it in `systemFont` and it leads `--ss-font`; otherwise CJK
  languages put the UI font first and their locale's `fontFamily` after it.
  A page that sets its own font stack writes it as
  `var(--ss-font, <fallback>)` so that it follows the shell. A page that
  changes the font calls `window.ssRefreshFont()` to apply it at once.
  It also sets `window.applocaleKeepWindowTitle` once its own title is in
  place, so a page's locale file (with an `fwtitle`) cannot rename the
  window.
