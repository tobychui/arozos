# Folder &amp; File Compare

A two pane comparison tool in the style of Beyond Compare, shipped as part of
the **Code Studio** tool set. It is not a separate WebApp and is deliberately
*not* registered in `Code Studio/init.agi` — it opens as a floatWindow from
Code Studio, exactly like the Color Picker and the Responsive Design Viewer.

## Opening it

From Code Studio:

| Entry point | What it does |
|---|---|
| **Tools > Folder & File Compare** | Opens the tool on its home screen |
| **Tools > Compare This Project Folder** | Pre-fills the left side with the open project folder |
| **Tools > Compare Current File** | Pre-fills the left side with the focused editor tab |
| Directory explorer right click > **Compare With...** | Pre-fills the left side with the clicked file or folder |

Programmatically, `showCompareTool(payload)` in
[`Code Studio/index.html`](../../index.html) appends the payload to the URL hash:

```javascript
showCompareTool({type: "folder", left: "user:/a", right: "user:/b"});
// type: folder | sync | text | hex | picture | pick
// "pick" fills the left side only and waits for the user to choose the right
```

The tool also accepts two files handed to it through `ao_module_loadInputFiles()`.

## Session types

- **Folder Compare** — aligned recursive tree of both folders
- **Folder Sync** — the same grid plus mirror/update commands
- **Text Compare** — line by line diff, editable on both sides
- **Hex Compare** — byte level view for binary files
- **Picture Compare** — side by side, difference mask and blend

Double clicking a file row in a folder compare opens the pair in whichever of
the three file viewers suits its extension.

## Open comparison tabs

A tab strip sits between the toolbar and the path bar. The folder session is
the first tab and cannot be closed; every file pair opened from its grid becomes
a tab beside it, so moving between the folder view and a file is one click.

- Opening a pair that is already open brings its tab forward instead of
  duplicating it.
- Switching tabs suspends the outgoing comparison and resumes the incoming one
  from memory, so nothing is re-read and **unsaved edits, scroll position and
  the current difference section all survive**. A tab holding unsaved work shows
  a red dot and asks before it is closed.
- **Ctrl+1** … **Ctrl+9** jump to a tab, **Ctrl+Tab** / **Ctrl+Shift+Tab** cycle,
  middle click or the × closes one.
- **Home** shows the session picker without discarding anything: the tabs stay
  on screen and clicking one returns to that live comparison. Starting a new
  session is what replaces them.

## How a folder comparison is decided

1. Both trees are scanned (`opr=scan`) and filtered by the session's name masks,
   size and age filters.
2. Entries are aligned by relative path. The key honours **Compare filename
   case**, **Align filenames with different extensions** and **Align filenames
   with different Unicode normalization forms**.
3. **Quick tests** compare size and timestamp (with a tolerance, and optional
   DST / timezone forgiveness).
4. **Content tests** digest both sides on the server (`opr=hash`, streaming
   MD5) when *Compare contents* is on. *Override quick test results* decides
   whether the digest alone is authoritative.
5. **Rules-based comparison** additionally re-reads text files under 1 MB and
   demotes whitespace, letter case, line ending and "unimportant text"
   differences to **minor** ones, which the **Minor** toolbar button hides.
6. Folder rows roll up the state of everything beneath them.

Row colours: black identical, red different, blue the newer side of a differing
pair, red circle marker an orphan, amber a minor difference. Orphan rows show a
hatched gap on the side where the entry does not exist.

### Known limits

- Hidden files are not visible, because the ArozOS AGI file layer filters them
  out of `readdir`/`glob` for every storage backend.
- Per file attributes (archive, system, read-only) are not exposed by the
  virtual file system, so those checkboxes are disabled in the settings sheet.
- A single scan returns at most 20000 entries per side; beyond that the results
  are reported as partial in the log.

## Editing and transferring

- Every line in a text comparison is editable in place. Enter splits a line,
  Backspace at column 0 joins with the previous one, and paste accepts multi
  line clipboard content.
- The two sides are separate scrollers with a draggable divider between them.
  Vertical scrolling stays in step, horizontal scrolling is per side so a long
  line never pushes the other pane off screen. Drag the divider to resize,
  double click it (or press **Centre**) to put it back in the middle; the split
  is kept as a ratio so it survives a window resize and a redraw.
- Differences are shown three ways at once: the whole line is tinted, the exact
  characters that changed carry a stronger inline highlight, and a coloured bar
  runs down the edge of the line. Lines with no counterpart on a side are filled
  with diagonal hatching, and the strip on the far left maps every difference in
  the file.
- **Sect >** / **Sect &lt;** replace the current difference section on one side
  with the other side's version; **All >** / **All &lt;** replace the whole file.
- **Save** (Ctrl+S) writes both sides back through `opr=write`.
- In a folder comparison, **Copy >** / **Copy &lt;** transfer the selection and
  **Del L** / **Del R** remove it. Copies and deletes go through the ArozOS
  file system HTTP API (`/system/file_system/fileOpr`) so they are binary safe,
  quota aware and can use the recycle bin.

## Row context menu

Right clicking a row in a folder comparison opens a menu scoped to that entry.
When the clicked row is part of a multiple selection the commands act on the
whole selection instead, the way a file manager behaves.

| Command | Notes |
|---|---|
| **Compare Contents** | Same as double clicking: opens the pair in the viewer that suits its extension |
| **Compare as Text / Hex / Picture** | Forces a particular viewer, e.g. to read a `.dat` file as text |
| **Expand / Collapse Everything Below** | Folder rows only |
| **Select Differing Files Below** | Selects every non-matching file in the branch, ready for one bulk copy |
| **Copy … to the Right / Left** | Transfers the entry or the selection |
| **Copy the Newer Side Over the Older** | Reconciles a mixed set in one pass, routing each file by its timestamp |
| **Sync This Folder to the Right / Left / Both Ways** | Folder rows only; runs the sync plan restricted to that branch |
| **Delete … from the Left / Right** | Honours the recycle bin setting |
| **Rescan This Folder** | Rescans just that branch and splices the result back in |
| **Exclude "name" from This Session** | Appends the name to the session's exclude list and rescans |
| **Reveal in File Manager**, **Copy Path** | Per side |

Commands that cannot apply are greyed out rather than hidden — the right side
entries of an orphan, for example, or anything that would write to a side marked
read only in the **Specs** tab.

A copy, delete or sync started from the context menu on a single row rescans
only the affected branch instead of the whole session, which keeps large tree
sync work responsive.

## Backend

All reads and metadata go through [`Code Studio/backend/compare.agi`](../../backend/compare.agi),
which runs with the invoking user's permissions.

| `opr` | Parameters | Returns |
|---|---|---|
| `scan` | `path`, `recursive`, `maxdepth` | `{root, truncated, items:[{p,d,s,m}]}` |
| `stat` | `path` | `{exists, isDir, size, mtime}` |
| `hash` | `paths` (JSON array) | `{hashes: {vpath: md5}}` |
| `read` | `path` | `{content, binary, size, mtime}` or `{oversized, size}` |
| `write` | `path`, `content` | `{success, size, mtime}` |
| `mkdirp` | `path` | `{success}` |
| `remove` | `paths` (JSON array) | `{success, failed:[]}` |

`p` is a relative path, `d` is `IsDir`, `s` is the size in bytes and `m` is the
modification time as a Unix timestamp.

Binary content for the hex and picture comparers is fetched straight from the
`/media/?file=` endpoint rather than through the AGI VM.

## Files

```
tools/compare/
├── index.html          shell markup, views and the settings sheet
├── css/compare.css     the whole look, themed through CSS variables
└── js/
    ├── util.js         paths, formatting, filename masks
    ├── api.js          AGI + file system HTTP calls
    ├── settings.js     session settings model and dialog
    ├── diff.js         Myers line and word diff
    ├── folder.js       folder compare engine and grid
    ├── text.js         text compare, editing and section copy
    ├── hex.js          byte compare
    ├── picture.js      image compare
    └── app.js          toolbar, routing, log and status bar
```

The tool follows the dark/light theme of the desktop via
`ao_module_onThemeChanged`; every colour is a CSS variable defined on `:root`
and overridden under `body.dark`.
