# 3D Modeler - design proposal

A parametric solid modeller for the ArozOS desktop, following the Autodesk
Inventor part workflow: **2D sketch -> extrude -> pick a face -> 2D sketch ->
extrude**, then hole, fillet and chamfer, with STEP, STL and OBJ export for 3D
printing. Parts can be put together in **assemblies** (14.16): placed,
moved, turned and scaled by hand, and held by Mate, Flush, Angle, Tangent and
Insert constraints. Both can be put on **2D drawings** (14.17) for printing:
views from any side, dimensions and notes, exported as PDF, DXF, SVG and
PNG.

Status: **milestones M0 to M6 are built** and were tried on a live ArozOS
server, with the gaps listed under "Known limits today" in section 2.
**Assembly mode and drawing mode are built** (14.16, 14.17; tried in a
browser, not yet on a live server). M7 (touch, localisation, README) and everything after stage 1 is
planned in detail in section 14. **Section 15 is the handoff** for whoever
continues. Section 13 holds the owner's answers to the open questions.

## Owner's checklist: what to try by hand

Everything below was built and passes `node tests/run.mjs` and a headless
Chrome walkthrough, but needs a person with a real mouse, a live ArozOS
server or a second browser. Tick an item off (or note what went wrong next
to it) and the next session picks it up from here. Reload with the cache
cleared first (Ctrl+F5): ArozOS sends WebApp files without a cache header,
so a browser can keep old modules after an update (see the last item).

**Mouse and view (needs a real mouse)**

- [ ] Middle button drag pans; Shift + middle drag orbits; the wheel zooms
      towards the cursor.
- [ ] F4 held turns the left button into orbit, releasing F4 gives it back;
      the Orbit and Pan buttons under the view cube do the same until Esc
      or a second click.
- [ ] While Orbit or Pan is on, a sketch tool draws nothing.
- [ ] Hovering a model edge shows the arrow cursor (not the hand) and an
      orange 4 px line; a selected edge is a blue 3 px line; the part of a
      highlighted edge behind the model shows faint.
- [ ] In a sketch, the point under the pointer is drawn filled and larger,
      also inside Coincident and the other constraint tools.
- [ ] The mouse wheel over any size box (feature panels, Extrude distance,
      the sketch dimension editor) steps by 0.5, never reaches 0, and stops
      at a box's maximum (countersink angle 179.5).

**Part features**

- [ ] Fillet / Chamfer: clicking one edge of a rounded outline highlights
      the whole tangent chain, and that is exactly what the preview rounds;
      the new faces show green; a size that does not fit says so and keeps
      OK disabled.
- [ ] Revolve: about a sketch line, about an origin axis (X / Y / Z), a full
      turn and an angle in the four directions; a sketch with one
      construction line uses it as the axis by itself; a profile that
      crosses the axis is refused with a message.
- [ ] Shell: click the faces to leave open, walls inside and outside; a wall
      too thick for the part is refused.
- [ ] Rectangular / Circular Pattern and Mirror: pick the features in the
      model tree while the panel is open; directions from the origin axes or
      a clicked edge, hole or face; Mirror with nothing picked mirrors the
      whole solid; deleting a repeated feature asks and takes the pattern
      along.
- [ ] Edits upstream: make an extrusion that carries a chamfer or fillet
      taller or thinner, and the rounded edges follow; make a plate thicker,
      and sketches, holes and work planes on its top face move up with it.

**Sketcher**

- [ ] Three Point Arc and Tangent Arc (from the end of a line); sketch
      Fillet and Chamfer of a corner (type the size, later corners become
      Equal to the first).
- [ ] Window selection: left to right takes what lies inside, right to left
      (dashed) what it touches. F9 hides the constraint glyphs, F8 shows
      them.
- [ ] Polygon (number of sides, inscribed / circumscribed), Slot, Mirror
      about a line (the copy follows when the original is edited),
      Concentric.
- [ ] A dimension the sketch already fixes is added as a driven dimension in
      brackets, not refused; double clicking it explains it cannot be
      edited.
- [ ] The grid shows in a sketch; the first solid of a new part comes into
      view by itself; while picking a plane the status bar names the plane
      or face under the pointer; the Point tool takes a projected point (a
      hole on the centre of a rounded corner).

**Assembly mode (new in this session, see 14.16)**

- [ ] File > New offers Part, Assembly and Drawing.
- [ ] Place a saved part twice (the ArozOS file selector); the first is
      grounded at the origin, the second lands beside it and can be moved
      with the triad, turned with its rings and typed into the Move Rotate
      Scale panel. Free Move and Free Rotate drag it with the mouse.
- [ ] Mate two flat faces, Flush two faces, Insert a pin into a hole, an
      Angle between two faces, Tangent of a cylinder on a face: the parts
      jump into place and keep their constraints when one of them is moved
      again; a component that still has freedom can be dragged along it.
- [ ] Section View: Half, Quarter and Three Quarter, with the plane, its
      position and the side picked in the panel (also in a part).
- [ ] Measure (two picks: distance, angle, the gap in X, Y and Z),
      Interference between components, Mass Properties of the assembly.
- [ ] Save, close and reopen the assembly; Open Part on a component (a new
      tab, see 14.18), edit that part, then click the assembly's tab and
      see the change with its constraints still holding.
- [ ] Export the assembly as STEP and STL.

**Missing parts and relative links (newest, see 14.21; needs ArozOS)**

- [ ] Save an assembly next to its parts (or with them in a sub folder),
      move or copy the whole folder elsewhere on the same drive, open the
      assembly there: every part is found (the links are relative).
- [ ] Move only the parts to another folder and open the assembly: the
      Missing Parts dialog lists them; Select File on one finds it, and the
      others moved to the same folder are found by themselves. Done, then
      Save: the assembly links to the new place.
- [ ] Skip in that dialog: the parts show a warning in the browser, and
      their right click menu has Relink Part to bring the dialog back.
- [ ] A part on another drive (storage:/ against user:/) stays an absolute
      link; an assembly saved for the first time turns the links of the
      parts placed before into relative ones. The same for a drawing's
      models (Relink Model in the right click menu of a model).

**Sketch input (see 14.20)**

- [ ] Draw a long line a little off level or upright (up to 3 degrees): it
      snaps level / upright with the H or V mark and keeps a Horizontal or
      Vertical constraint. A slot's centre line does the same.
- [ ] While drawing a line, a box under it shows the length and a box at
      its start the angle (hidden while level or upright). Type a length,
      Tab, an angle, Enter: the line keeps both as dimensions (the angle is
      measured from the sketch X axis). Rectangles show width and height,
      circles the diameter.
- [ ] Slot: the centre line shows length and angle the same way; after its
      second click a box past the far end shows the diameter of the ends.
- [ ] With the Dimension tool on, clicking a dimension's value opens it for
      editing (as a double click does in Select). An angle to the X axis
      takes a minus sign.

**Appearance, previews in every visual style, hidden edges (see 14.19)**

- [ ] Set View > Visual Style > Wireframe, start Fillet or Chamfer and pick
      an edge: the preview stays wireframe. Change the style while the
      panel is open (Wireframe, Shaded, Shaded with Edges, Shaded with
      Hidden Edges): the preview follows every time.
- [ ] In Wireframe or Shaded with Hidden Edges, an edge behind the model
      lights up when the pointer is right on it and can be picked (Fillet,
      Chamfer, Measure, a sketch's Project Geometry). The faces in front
      stay easy to pick everywhere else.
- [ ] View > Appearance: a colour and a finish (plain, matte or glossy
      plastic, brushed, polished or cast metal, wood, carbon fibre, rubber,
      glass) and the pattern size; the part shows them while the panel is
      open; OK is one undo step and is saved with the part. Placed in an
      assembly, the part keeps its finish in its component colour; a
      drawing's Base View panel shows it too.

**Tabs, orbit mark and ribbon (see 14.18)**

- [ ] The Orbit button under the view cube (or F4 held) shows the orbit
      circle over the model: a circle, four ticks and a centre cross. Esc,
      the button again or letting go of F4 hides it.
- [ ] In the ArozOS window, every ribbon tab (File, 3D Model, Sketch,
      Assemble, Inspect, View, Place Views, Annotate) has its labels inside
      their buttons, at most two lines, none running into the group name.
- [ ] Open a few parts, an assembly and a drawing: each gets a tab under
      the view. Clicking a tab shows that document as it was left (its
      undo history, its view, a drawing's zoom); the cross or the middle
      button closes a tab (a changed one asks first); the plus starts a
      new document. Opening a file that is already open shows its tab.
- [ ] Live link: in an assembly, Open Part on a component opens the part
      in a tab. Change the part there (no need to save), then click the
      assembly's tab: the components show the change and the constraints
      are solved again. The same for a drawing of the part or of the
      assembly: its views are drawn again, the others stay as they were.
- [ ] Closing the window with changed tabs lists them and asks.
- [ ] After New (a second part tab) and a first extrude, hover lights faces
      and edges, Fillet takes edges and Start 2D Sketch takes a face; no
      error in the browser console while orbiting (fixed after you found it:
      the assembly turned component picking on in parts).
- [ ] A part changed in another 3D Modeler window (or by someone else)
      only shows after it is saved there and Refresh Parts / Refresh Models
      is used here: the live link covers the tabs of one window.

**Drawing mode (see 14.17)**

- [ ] With a part (or an assembly) open, File > New > Drawing: the Base
      View panel starts on that model in 3D. Pick Front, Top, ... or an
      isometric, or turn the model with the view cube or Shift + middle
      button for any other direction; OK, then the view follows the pointer
      until you click it onto the sheet.
- [ ] Projected View: move round a placed view and click. The views on the
      right, left, above and below line up with it and only slide along
      that line when dragged; the corner ones are isometric views from
      above (first angle: the bottom right corner; third angle: the top
      right one). Dragging the base view takes its projected views along.
- [ ] Face View: click faces of the model (each click adds or drops one);
      the view turns to look straight at the first face, and only the
      picked faces are drawn (a flat outline for cutting, for example).
- [ ] Dimension (Annotate tab, or the D key): click an edge for its length;
      two parallel edges for the distance between them; two edges at an
      angle for the angle; two points (ends, middles, centres); a circle
      for its diameter (R / D switch radius and diameter). Space cycles
      horizontal, vertical and aligned. Radius, Diameter, Angle, Hole Note
      ("2x" counts equal holes) and Center Mark work the same way.
- [ ] Double click a dimension: prefix, suffix, units (mm, cm, m, in, ft),
      decimals, a tolerance; Annotate > Dimension Style sets them for all.
- [ ] Leader Note (a dot where it points at a face, an arrow on an edge)
      and Text; Enter starts a new line, Ctrl + Enter is OK.
- [ ] Sheet Setup: A0 to A5, ANSI, Legal or a custom size typed in mm, cm,
      inches or pixels; the resolution (dpi) and the pixel size it gives;
      the scale (1:1 by default; views can have their own); first or third
      angle; border, margin and title block fields.
- [ ] Export PDF and print it at 100 %: the 80 mm dimension of the sample
      must measure 80 mm on the paper.
- [ ] Open the exported DXF in LibreCAD, FreeCAD or QCAD: layers VISIBLE,
      HIDDEN (dashed), CENTER, DIMENSION, TEXT; the diameter sign shows.
      (Only checked by my own tests so far, not by a CAD program.)
- [ ] The SVG in Inkscape or a browser; the PNG at 300 dpi says 300 dpi in
      an image editor.
- [ ] Edit a part a drawing uses, then Refresh Models in the drawing: the
      views are drawn again, and a dimension whose edge moved turns purple.

**Live server**

These three assembly steps were never run by me, because they need ArozOS
itself (the static preview has no file selector and no second window):

- [ ] Assemble > Place opens the ArozOS file selector (filtered to
      `.aopart`, `.step`, `.stp`); the chosen part is placed, and placing
      the same file again adds a second component of the same part
      (`Name:2`) instead of a second copy of the file.
- [ ] Open Part (Assemble tab, or the right click menu of a component)
      reads that component's `.aopart` from ArozOS and opens it in a tab
      of the same window (it opened a new window before 14.18).
- [ ] Refresh Parts: after editing and saving a part in another window,
      Refresh Parts in the assembly shows the change, keeps the constraints
      on the faces they were put on and solves them again (a hole made
      larger stays inserted; a deleted face shows its constraint with a
      warning).

- [ ] Drawings on ArozOS: Base View > Model > "Choose a file..." opens the
      ArozOS file selector (parts and assemblies); Save / Open of `.aodrw`;
      "Open with 3D Modeler" on an `.aodrw`; the four exports written to
      the folder you pick.
- [ ] A title block or note in Chinese (or any non-Latin text) in the PDF:
      the PDF font only has Latin letters, so such text is drawn by the
      browser into a small black and white image at about 600 dpi. Check it
      prints sharp enough.

- [ ] "Open with 3D Modeler" on a `.step` file starts a new part with one
      Imported feature; decide whether 3D Viewer should stay the default
      opener for STEP (the File Manager setting decides, not the app).
- [ ] An `.aoasm` assembly opens from the File Manager.
- [ ] Decide on the cache header: should ArozOS send `Cache-Control:
      no-cache` (with an ETag) for WebApp files, so updated apps are never
      stale? It is a server-wide Go change, so it waits for your answer.
- [ ] Firefox and Safari have not been tried at all.

## 1. Decisions already taken

| Topic | Decision | Consequence |
|---|---|---|
| Geometry kernel | OpenCascade compiled to WASM, the `replicad-opencascadejs` build, unmodified | Real B-rep solids: exact STEP in and out, true fillets, chamfers and booleans |
| App name | 3D Modeler, group `Engineering`, folder `src/web/3D Modeler/` | Sits next to 3D Viewer in the start menu |
| Sketching | Full geometric constraint solver in stage 1 | Sketches behave like Inventor's: constraints plus driving dimensions, solved live |
| Interface | Ribbon, light and dark, following the ArozOS theme | One style sheet with colour tokens on `body` / `body.dark` |
| Self contained | Every library is vendored inside the app folder | Nothing is loaded from 3D Viewer or any other WebApp, and nothing from a CDN |

## 2. What exists today (M0 to M6)

Open the app and you get:

- The ribbon with the tabs File, 3D Model, Sketch (contextual), Inspect and
  View. It is built from one data table (`js/ribbon.js`), so adding a command
  is one line. Commands that are not built are greyed and name their milestone
  in the status bar when clicked.
- A three.js viewport: orbit, pan, zoom to cursor, orthographic and perspective
  projection, Zoom All, Home View, Look At, an axis triad and a clickable view
  cube. Shaded, shaded with edges and wireframe styles.
- The geometry kernel in a Web Worker and the constraint solver on the main
  thread. Two dots in the status bar show their state.
- **The document** (M1): the part is a feature list (6.2). Every change goes
  through `js/document/document.js`, becomes one undo step, and triggers a
  rebuild in the worker. The rebuild keeps the shape after each feature, so
  only the changed feature and the ones after it are recomputed. A feature
  that fails is marked in the browser and the rest is still built.
- **File > Sample Part** loads a hand written six feature part (three sketches,
  three extrusions: join with a hole, join with a bore, cut). The kernel side
  of sketch profiles and of Extrude (join, cut, intersect, new body; positive,
  negative, symmetric distance) was real from the start; M3 added the
  interface to it.
- **Exact faces and edges**: the kernel sends one mesh per body with a range
  per face, and the true edges as polylines. Faces and edges highlight under
  the cursor, a click selects, Ctrl or Shift click adds, Esc clears. The status
  bar shows what is under the cursor (planar or cylindrical face and its area,
  edge and its length).
- **Model browser** driven by the document: Solid Bodies, Origin, the features
  in build order, End of Part. Right click a feature for Rename (F2), Suppress
  and Delete (Del); deleting a sketch asks before taking its extrusions along.
- **Undo / redo** (Ctrl+Z, Ctrl+Y) for every document change.
- **New, Open, Save, Save As** (Ctrl+O, Ctrl+S). Inside ArozOS these use the
  system file selector and the AGI script `backend/file.agi`; a part handed
  over by the File Manager is opened at start. Unsaved changes are asked about
  before New, Open and closing the window.
- **Start 2D Sketch** asks for a plane. In an empty part the three origin
  planes are shown to pick from. Once the part has a solid, the origin planes
  stay hidden and the planar faces of the model highlight instead; picking one
  turns the camera square onto it and opens the Sketch tab. Origin planes can
  still be picked from the Origin folder of the browser, or in the viewport
  after switching them on with View > Origin Planes. **Look At** follows the
  same rule.
- **File > Kernel Self-test** runs profile, extrude, boolean cut, fillets, a
  chamfer, meshing and a STEP export in memory and reports the result in the
  status bar.

- **View cube**: every face, edge and corner is clickable (26 views), the
  cells that meet at an edge or corner light up together, and a home button
  sits beside it.
- **Model browser nesting**: a sketch sits under the feature built from it
  (collapsed, as in Inventor); a sketch nothing uses yet stands on its own
  and is drawn in the 3D view. Right click offers **Edit Sketch** on a sketch
  and on the feature that uses it; double click a sketch to edit it.
- **The sketcher** (M2). Start 2D Sketch creates a sketch feature on the
  picked plane or planar face and opens it; Edit Sketch reopens an old one.
  While a sketch is open the left button draws, the middle or right button
  pans, the wheel zooms and the view cube turns the view.
  - *Draw*: Line (chained; double click or Esc ends, landing on an existing
    point ends too), Rectangle, Circle, Arc (a drop-down: Three Point Arc,
    Tangent Arc, Center Point Arc), Point, and Fillet / Chamfer of a corner
    where two lines meet (type the size, click the corner or the two lines;
    later corners of the same size are made Equal to the first).
    Construction turns the selection, or everything drawn next, into
    construction geometry.
  - *Select*: click, Ctrl or Shift click, or a window: dragged left to
    right it takes what lies inside, right to left (dashed) what it touches.
    F9 hides the constraint glyphs, F8 shows them.
  - *Snaps while drawing*: existing points, line midpoints, anywhere on a
    curve, and level with / straight above the previous point. A snap leaves
    the matching constraint behind (shared point, midpoint, point on curve,
    horizontal, vertical), so what looked connected stays connected.
  - *Typed sizes*: start typing while drawing to fix the length of a line,
    the width and height of a rectangle (Tab switches) or the diameter of a
    circle; Enter places it. The typed value becomes a dimension.
  - *Constraints*: coincident (point to point, or a point that slides along
    a curve), collinear, horizontal, vertical, parallel, perpendicular,
    tangent, equal, fix, midpoint, symmetric. Select first and click the
    button, or click the button and pick. They show as small glyphs that can
    be selected and deleted.
  - *Dimension*: pick a line, a circle, an arc, two points, a point and a
    line, or two lines (distance if parallel, angle if not), then click where
    the value goes. For a line or two points, placing the text above or below
    gives the horizontal size, beside gives the vertical size, elsewhere the
    straight distance. The value can be typed at once; double click a
    dimension later to change it.
  - *Solving*: planegcs runs after every change and on every pointer move of
    a drag, so dragging a point or a curve moves the sketch as far as its
    constraints allow. A constraint or dimension that conflicts with the
    sketch, or that the sketch already satisfies, is refused with a message.
  - *Feedback*: the status bar shows the degrees of freedom left; geometry
    that can no longer move changes colour, curve by curve.
  - *Trim and Extend*, which keep the new end on the curve it stopped at.
  - Every action is one undo step. The solid is rebuilt when the sketch is
    finished, not on every stroke.

- **Model edges in a sketch** (M3). A sketch started on a face gets the
  edges of that face as reference geometry (drawn in amber, held still by the
  solver). New geometry snaps to it and can be constrained and dimensioned to
  it, so a line can be made tangent to a hole of the model. **Project
  Geometry** adds any other edge, or all edges of a clicked face. Straight
  edges and circular edges seen face-on can be projected. The constraint
  tools and Dimension also take a model edge directly, as Inventor does:
  click an edge that is not in the sketch and it is projected on the spot
  (near its end, the end point is picked) and used for the constraint.
- **Formulas in every size box**: 35/2, (40 - 2*3)/4, 2^3, sqrt(2)*10, pi*12.
  The typed-size boxes while drawing show the result as you type, the
  dimension editor and the Extrude distances accept them too. The result is
  stored, not the formula.
- **Extrude** (M3). The Extrude button opens a property panel laid out like
  Inventor's: Profiles, From, Direction (Default, Flipped, Symmetric,
  Asymmetric), Distance A (and B), Through All, Boolean (Join, Cut, Intersect,
  New Solid), OK and Cancel.
  - *Profiles*: the closed areas of every sketch not yet used are shaded in
    the model; hover highlights, click picks, click again drops. A single
    area is picked for you. Areas come from the kernel cutting the sketch
    plane along all sketch curves, so crossing curves, T-junctions, holes and
    the projected face outline all bound areas correctly.
  - *Preview*: the solid the feature would make, computed by the kernel on
    every change: green for what is added, red for what a cut removes.
  - *Arrow*: drag it to set the distance (quarter millimetre steps); pulling
    it through the sketch plane flips the direction. Cut and Intersect start
    going into the material, Join away from it, until a direction is chosen.
  - Clicking Extrude inside an open sketch finishes the sketch first.
  - **Edit Feature** (right click or double click an extrusion) reopens the
    same panel with its values; OK replaces the feature and rebuilds.
  - A profile is remembered by a point inside it, so it survives edits of the
    sketch as long as an area is still there. If it is gone the feature is
    marked failed with "the sketch profile no longer exists".

- **Hole, Fillet, Chamfer** (M4), each with a property panel like Extrude's.
  - *Fillet* and *Chamfer*: click the edges in the model (click again to drop
    one; edges selected before clicking the button are taken over), give the
    radius or distance. The kernel carries a fillet along edges that run on
    tangentially, so one click rounds a whole outline. Every change is tried
    in the kernel and the panel says at once if it cannot be built.
  - *Hole* drills at every point of a sketch placed with the Point tool
    (sketch on the face, place and dimension the points, finish, click Hole):
    simple, counterbore or countersink; to a depth or through all; optional
    118 degree drill point; Flip. A red preview shows what is removed.
  - **Edit Feature rolls the model back**: while a feature is edited, the
    model is shown as it was before that feature, so the original edges can
    be seen and picked again. It returns to the full model on OK or Cancel.
- **View and inspect** (M5).
  - *Section View*: Half, Quarter and Three Quarter, in a panel: which
    origin plane cuts, where (slider or typed), which side stays, and a
    second plane for the quarter modes; the cut faces are filled. Done on
    the graphics card, so the model itself is untouched and can be orbited
    and picked while cut. End Section View restores it.
  - *Shaded with Hidden Edges* joins Shaded, Shaded with Edges and Wireframe.
  - *Mouse as in Inventor* (answer 13.3): the left button selects and
    draws, middle drag pans, Shift + middle drag orbits, the wheel zooms.
    The Orbit and Pan buttons under the view cube (and F4 held) lend the left
    button to the view; Esc gives it back.
  - *Mass Properties*: volume, surface area, overall size and centre of
    gravity, exact from the kernel.
  - *Measure*, a panel: one pick says what it is (area, length, radius,
    diameter); two give the shortest distance (exact), its X, Y and Z parts
    and the angle, with a dimension line and its value drawn in the view.
- **Import and export** (M6), File > Import / Export.
  - Export **STEP** and **BREP** (exact geometry, written by the kernel),
    **STL** (binary), **OBJ** and **3MF** (triangles, at a fineness you
    choose: coarse, normal, fine). The triangle meshes are checked watertight
    by the tests, and OBJ / 3MF share vertices so slicers accept them.
  - Import **STEP**: the file becomes an "Imported" feature in the history
    that later features build on. Its text is kept inside the part file.
    The app is also registered as an opener for `.step` / `.stp`: opening one
    from the File Manager starts a new part with it imported.
  - All of it goes through the AGI script `backend/file.agi` (binary files as
    hex), so files land in the user's ArozOS drives.
- **Work Plane** (the last piece of M3): 3D Model > Plane, pick an origin
  plane, a planar face or another work plane, then give the distance (type it
  or drag the arrow; Flip for the other side). The plane is a feature in the
  history, drawn as a blue sheet, and Start 2D Sketch can pick it. Unlike a
  sketch on a face, a sketch on a work plane *follows* it: change the offset
  and everything built on the plane moves. Deleting a plane asks first and
  takes what was built on it along.
- **Checked on a live ArozOS server**, in a scratch instance built from this
  repository:
  - As its own page: Save, Save again without the selector, Open, the five
    exports (files read back and checked), STEP import, a wrong file type.
  - Inside the desktop as a float window, with the real file selector: Save
    As, Export STEP and Open; the window title follows the document; closing
    the window with unsaved changes asks first (Cancel keeps it open, Do Not
    Save closes it); a part handed over the way the File Manager does opens.
  - That found and fixed one bug: saving into a folder that does not exist
    crashed the AGI script (`filelib.isDir` raises on a missing path).

Known limits today:

- Extrude has no taper and no "To" / "To Next" extents. Work planes are
  offset planes only (no angled or three point planes), and there are no
  work axes or work points.
- **References follow the model for the common edits, not all of them.**
  Edges of a fillet or chamfer are remembered by position plus a
  description (curve, the two faces, inside or outside corner) and are found
  again when an earlier feature moves them; a sketch or work plane on a face
  follows the face along its normal (14.5). Still by position: projected
  edges in a sketch, and a face that turns or slides sideways. When nothing
  matches, a feature fails with "an edge ... is no longer there" rather than
  guess.
- Chamfer has one distance (no two-distance or distance-and-angle form).
  Holes have no thread. (Fillet and Chamfer now preview the result live,
  the new faces in green, and a size that does not fit is refused instead
  of building a broken solid.)
- Section planes are parallel to the origin planes and are placed with a
  slider or a typed value, not dragged in the view or put on a face.
- Import of BREP is not possible with this kernel build (`BRep_Builder` is
  missing); import of STL / OBJ meshes and IGES is not built.
- One extrusion uses one sketch, and a sketch that has been used is hidden
  (no shared sketches yet).
- The sketcher has no typed angle, no driven dimensions, no offset, mirror
  or pattern, and fillets only corners between two lines. Ellipses and
  splines of the model cannot be projected.
- Model vertices cannot be picked. (Hovered and selected edges are now
  drawn 4 and 3 pixels wide with the three.js fat line add-ons.)
- Mouse only; touch and pen input are M7. The new mouse mapping, F4 and
  the STEP opener still need a check with a real mouse and a live server
  (14.2).
- Only tried in a Chromium browser; Firefox and Safari are untested.

## 3. Feasibility, measured

Both engines were run under Node 20 and in the browser preview before this
proposal was written.

| Check | Result |
|---|---|
| Kernel start (WASM compile and init) | 0.1 to 0.2 s once the file is cached |
| 60 x 40 x 20 block, through hole, 4 fillets, 1 chamfer | 120 to 215 ms in total |
| Meshing that part | 22 to 36 ms, 496 triangles |
| STEP export, then re-import of the same file | 78 ms and 99 ms, face count preserved |
| Volume against a hand calculation | 45097.0 mm3, matches |
| Solver: 4 points, 4 lines, 7 constraints | 10 ms, 0 degrees of freedom left, no conflicts |
| Kernel as a module worker with no bundler | works (`new Worker(url, { type: "module" })`) |

Not yet measured: the first download over a real network (the kernel is
22.9 MB, about 7 MB once gzipped, and ArozOS gzips static files by default),
behaviour on a Raspberry Pi class client, and Safari.

## 4. Scope of stage 1

In scope:

1. New part, origin planes, model browser with a feature history.
2. 2D sketch on an origin plane, a work plane or a planar face: line,
   rectangle, circle, arc, point, construction geometry, trim, extend, snaps,
   geometric constraints and driving dimensions.
   
   > When creating a new 2D sketch with objects already exists in the scene, do not show the origin XY XZ yellow plane. The user should pick from an existing plane already on the mesh to start editing
3. Extrude: join, cut, intersect, new body; one direction, flipped, symmetric,
   two distances; to a typed distance or through all.
4. Hole, fillet and chamfer.
5. View tools: orbit, pan, zoom, Look At, Home, view cube, orthographic and
   perspective, visual styles, half / quarter / three quarter section views.
6. Import STEP, BREP, STL, OBJ. Export STEP, STL, OBJ, 3MF, BREP.
7. Open and save a native document in the user's ArozOS drives, undo and redo.

Out of scope for stage 1 (see section 11): revolve, sweep, loft, shell,
patterns, mirror, assemblies, 2D drawings, a parameter table, threads.

## 5. Workflow

The target is that an Inventor user needs no manual for the basic loop.

1. **Start 2D Sketch**, pick a plane or a planar face. The camera turns to the
   plane, the Sketch tab opens, the edges of a picked face are projected as
   reference geometry.
2. Draw. While drawing, size boxes follow the cursor (as in Inventor's
   heads-up input); Tab moves between them, Enter confirms. Snaps and inferred
   constraints (horizontal, vertical, coincident, tangent) are applied as the
   geometry is placed.
3. Add constraints and dimensions. Geometry changes colour when it is fully
   constrained; the status bar shows the degrees of freedom left.
4. **Finish Sketch**. The sketch appears in the browser.
5. **Extrude**: closed regions of the sketch highlight under the cursor, click
   to select one or several, drag the arrow or type the distance, choose
   join / cut / intersect / new body in the property panel, OK.
6. Pick a face of the result and start again from step 1.
7. **Hole / Fillet / Chamfer**: pick faces or edges with a live preview.
8. Double click any feature or sketch in the browser to edit it; everything
   after it is rebuilt.

## 6. Architecture

```
 main thread                                    kernel worker (module worker)
 +---------------------------------------+      +------------------------------+
 | app.js      shell, commands, modes    |      | worker.js   message protocol |
 | ribbon.js   ribbon from data          |      | occt.js     all OpenCascade  |
 | viewport.js three.js, picking, views  | <--> |             calls            |
 | document/   feature history, undo     | RPC  | rebuild.js  feature replay,  |
 | sketch/     sketcher + planegcs       |      |             shape cache      |
 | features/   one panel per feature     |      | naming.js   stable face and  |
 | io/         open, save, import, export|      |             edge references  |
 +---------------------------------------+      +------------------------------+
        | ao_module.js (file selector, upload, window title, theme)
        v
     ArozOS
```

### 6.1 Why the kernel is in a worker

A boolean or a fillet on a real part can take seconds. In a worker the
viewport keeps orbiting, and a rebuild that became pointless (the user typed a
new value) can be dropped. The single threaded kernel build is used: the multi
threaded one needs `SharedArrayBuffer`, which needs cross-origin isolation
headers that ArozOS does not send.

All OpenCascade calls stay in `js/kernel/occt.js`. The bindings do not garbage
collect: every temporary object must be released with `.delete()`. Keeping the
calls in one file keeps that rule checkable.

### 6.2 The document is a feature history

The saved document is not a shape. It is the ordered list of what the user
did, and the shape is recomputed from it. That is what makes "edit Extrusion1
and everything after follows" possible.

```json
{
  "format": "aopart", "version": 1, "units": "mm",
  "features": [
    { "id": "f1", "type": "sketch", "name": "Sketch1",
      "plane": { "ref": "origin:xy" },
      "geometry": [
        { "id": "p1", "type": "point", "x": 0, "y": 0 },
        { "id": "p2", "type": "point", "x": 60, "y": 0 },
        { "id": "l1", "type": "line", "p1": "p1", "p2": "p2" }
      ],
      "constraints": [
        { "id": "c1", "type": "horizontal", "line": "l1" },
        { "id": "d1", "type": "distance", "p1": "p1", "p2": "p2", "value": 60 }
      ] },
    { "id": "f2", "type": "extrude", "name": "Extrusion1",
      "sketch": "f1", "regions": [[30, 10]], "operation": "join",
      "extent": { "type": "distance", "value": 20, "direction": "positive" } },
    { "id": "f3", "type": "fillet", "name": "Fillet1",
      "edges": [ { "ref": "edge", "from": "f2", "sig": "..." } ], "radius": 5 }
  ]
}
```

Rebuild: the worker replays the features in order and keeps the resulting
shape after each one, keyed by a hash of that feature and everything before
it. Editing feature N reuses the cached shape of N-1 and only recomputes from
N on. A feature that fails keeps the last good shape, is marked with a warning
in the browser, and the features after it are attempted anyway.

Undo and redo are snapshots of this JSON. It is small, so a snapshot per
action is cheap, and the rebuild cache makes going back fast.

### 6.3 Referring to faces and edges (the hard part)

"Fillet this edge" must still mean the same edge after an earlier sketch
changed. The index of an edge in the shape is not stable. This is the known
*topological naming problem*, and it is the largest technical risk of the
project.

Plan for stage 1:

1. **History first.** OpenCascade reports, for every operation, which new
   faces were *generated* from which input and which old faces were *modified*
   into which new ones (`Generated`, `Modified`, `IsDeleted`; confirmed present
   in this build). A face gets a name from its origin: "side face of f2
   generated by sketch line l1", "end cap of f2", "f2/l1 modified by f5". An
   edge is named by the two faces it lies between.
2. **Geometry as a fallback.** Each reference also stores a signature (surface
   type, a point on it, normal or axis, area). If the name no longer resolves,
   the closest match by signature is used when it is unambiguous.
3. **Fail loudly.** If neither resolves, the feature is marked as needing
   repair and the user re-picks, as Inventor does with a sick feature. It never
   silently applies to a different edge.

### 6.4 Sketcher

- Sketch geometry lives in plane coordinates (u, v). A sketch plane is an
  origin, an X direction and a normal, taken from an origin plane, a work
  plane or a planar face reference.
- Solver: **planegcs**, the solver of the FreeCAD sketcher, as a 484 KB WASM.
  It runs on the main thread because a solve takes milliseconds and has to
  follow the cursor during a drag. The sketch is translated to its primitive
  list on every change; a drag is a temporary constraint on the dragged point.
- Stage 1 constraints: coincident, point on line, horizontal, vertical,
  parallel, perpendicular, tangent, equal, fix, midpoint, symmetric. Stage 1
  dimensions: distance, horizontal and vertical distance, radius, diameter,
  angle. planegcs supports all of these today.
- The solver also reports the remaining degrees of freedom and which
  constraints conflict or are redundant. That drives the colouring (under
  constrained, fully constrained, over constrained) and the message when a new
  constraint cannot be applied.
- Drawing is done on an SVG overlay above the WebGL canvas, positioned by the
  camera's projection. Lines stay one pixel sharp at every zoom, text and
  dimension arrows are ordinary SVG, and hit testing is exact. Finished
  sketches are also drawn in the 3D scene as thin lines.
- **Closed regions for Extrude** are found by the kernel, not by hand written
  planar geometry: the sketch curves are used to split a large planar face
  (`BRepAlgoAPI_Splitter`, present in this build) and each resulting face is a
  selectable region. Islands, arcs and overlapping loops come for free.

### 6.5 Features

| Feature | Inputs | Kernel calls |
|---|---|---|
| Extrude | sketch regions, operation, extent, direction | `BRepPrimAPI_MakePrism`, then `BRepAlgoAPI_Fuse` / `Cut` / `Common` |
| Hole | points of a sketch or a face plus two edge distances; simple, counterbore, countersink; depth or through all; flat or 118 deg drill point | profile revolved with `BRepPrimAPI_MakeRevol`, then `BRepAlgoAPI_Cut` |
| Fillet | edges (with tangent chain), radius | `BRepFilletAPI_MakeFillet` |
| Chamfer | edges; distance, two distances, distance and angle | `BRepFilletAPI_MakeChamfer` |
| Work plane | offset from a plane or planar face | none, it is a coordinate system |

Every feature has the same shape in code: a property panel docked at the left
of the viewport (Inventor's layout), a live preview drawn while values change,
OK / Cancel, and a kernel function that takes the previous shape and the
feature's JSON. After each boolean `ShapeUpgrade_UnifySameDomain` merges
coplanar faces so the model does not collect seam lines.

### 6.6 Viewport

- The kernel sends one mesh per body with an index range per face, and one
  polyline per edge with its id. Hovering highlights the face, edge or vertex
  under the cursor; a selection filter (faces, edges, bodies) follows the
  active command. The scaffold currently guesses edges from the mesh; that is
  replaced by exact edges in M1.
- Visual styles: shaded, shaded with edges, shaded with hidden edges,
  wireframe, monochrome, realistic (environment lighting).
- Section views are done on the GPU with clipping planes, so they cost nothing
  in the kernel and can be dragged live: half (one plane), quarter (two planes,
  keep the intersection), three quarter (two planes, keep the union), with the
  cut faces capped using the stencil buffer. The cutting planes are the origin
  planes, a work plane or a picked face, with a drag handle for the offset.
- Navigation: left drag orbits, middle or right drag pans, wheel zooms to the
  cursor, Home key, view cube. Look At takes a face or a plane. Whether to
  switch to Inventor's exact mouse mapping (F4 + drag to orbit, middle drag to
  pan, Shift + middle to orbit) is question 13.3.
- World is **Z-up, millimetres** (question 13.1).

### 6.7 Import and export

| Format | Import | Export | How |
|---|---|---|---|
| STEP `.step .stp` | solid, as a base feature | yes | kernel (`STEPControl_Reader` / `Writer`) |
| BREP `.brep` | solid | yes | kernel (`BRepTools`) |
| STL `.stl` | reference mesh | yes, binary or ASCII, chosen tolerance | own writer from the kernel mesh; three.js loader for import |
| OBJ `.obj` | reference mesh | yes | own writer; three.js loader for import |
| 3MF `.3mf` | no | yes | own writer (zip + XML), units and colour kept |
| IGES `.iges .igs` | later | no | not in this kernel build, see section 11 |

An imported STEP or BREP becomes a base feature that later features build on.
An imported STL or OBJ is a triangle mesh, not a solid: in stage 1 it is shown
as a reference to model around and cannot be filleted or cut. Export meshes
the solid at a tolerance the user picks (coarse, normal, fine, or a typed
deviation).

### 6.8 Native file format

Extension **`.aopart`**: one JSON text file holding the feature history of
6.2 (`js/document/sample.js` is a complete example). It is text on purpose:
the AGI file functions read and write text directly, the file can be diffed
and version controlled, and a part is small because it stores what was done,
not the resulting shape.

Considered and postponed: caching the last built shape in the file (the BREP
format is text too, so it would fit as a string) and a preview image for a
File Manager thumbnailer. Both only matter once parts get slow to rebuild.

### 6.9 ArozOS integration

- **Every backend operation goes through AGI.** No Go code, no new endpoint.
  `backend/file.agi` reads and writes parts with `filelib` and runs with the
  calling user's permissions. Requests are a JSON body, since url-encoded
  forms are capped in size.
- Import and export (M6) will use the same route: text formats (STEP, BREP,
  OBJ, ASCII STL) through `filelib.readFile` / `writeFile`, binary ones
  (binary STL, 3MF) hex encoded through `readBinaryFile` / `writeBinaryFile`.
  That doubles the transfer size of binary files; if it proves too slow for
  large meshes it will be raised as a question before anything else is used.
- Choosing a file uses `ao_module_openFileSelector`, which is the desktop's
  own dialog and not a backend call.
- `ao_module_setWindowTitle` shows the document name and a `*` when it has
  unsaved changes, `ao_module_loadInputFiles` opens a file passed by the File
  Manager, `ao_module_onThemeChanged` follows the desktop theme. The window's
  close button calls the app's `ao_module_close`, which asks about unsaved
  changes first.
- Per user preferences, when needed, get a second AGI script
  (`backend/prefs.agi`).
- Outside ArozOS (the static preview) the app still runs, falling back to a
  browser file picker and download.
- Localisation with `applocale.js` and a `locale/` folder is the last
  milestone, once the strings have stopped moving.

## 7. Libraries and licences

| Library | Version | Licence | Size | Where |
|---|---|---|---|---|
| three.js | r185 | MIT | 0.78 MB | `lib/three/` (core, OrbitControls, the fat line add-ons) |
| replicad-opencascadejs (OpenCascade, single thread build) | 1.2.1 | LGPL-2.1-only | 22.9 MB (about 7 MB gzipped) | `lib/occt/` |
| planegcs (`@salusoft89/planegcs`, from FreeCAD) | 1.3.0 | LGPL-2.0-or-later | 0.6 MB | `lib/planegcs/` |

Both LGPL libraries are shipped as unmodified upstream files next to their
LICENSE, and are loaded as separate files, never bundled into app code. That
is the same arrangement as the `occt-import-js` kernel already shipped with 3D
Viewer. The repository's dependency rule (CLAUDE.md rule 3) is written for
`go.mod`; neither library touches the Go module. Please confirm you are
comfortable with two more LGPL front-end libraries (question 13.5).

The kernel is fetched only when 3D Modeler is opened and is cached by the
browser afterwards.

## 8. Folder layout

Now:

```
3D Modeler/
├── init.agi                 registration (Engineering, opens .aopart)
├── index.html               shell, icon sprite, import map
├── PROPOSAL.md              this file
├── backend/file.agi         read / write .aopart (AGI, filelib)
├── css/style.css            layout and theme tokens
├── img/module_icon.svg
├── js/
│   ├── app.js               wiring: document -> rebuild -> display, commands
│   ├── ribbon.js            ribbon definition and builder
│   ├── viewport.js          three.js scene, navigation, picking, selection
│   ├── browser.js           model browser tree
│   ├── ui.js                menu and in-page dialog
│   ├── expr.js              formulas in size boxes
│   ├── features/extrude.js  Extrude panel, profile picking, preview
│   ├── document/
│   │   ├── document.js      feature list, changes, undo / redo, validation
│   │   └── sample.js        sample part, the format's reference
│   ├── io/files.js          open / save through AGI, browser fallback
│   ├── kernel/
│   │   ├── client.js        promise wrapper around the worker
│   │   ├── worker.js        message protocol
│   │   ├── rebuild.js       feature replay with a shape cache
│   │   ├── profile.js       sketch plane frames
│   │   └── occt.js          OpenCascade calls
│   └── sketch/
│       ├── sketcher.js      pointer, snapping, solve and store, selection
│       ├── tools.js         line, rectangle, circle, arc, point, dimension
│       ├── trim.js          trim and extend
│       ├── project.js       model edges as reference geometry
│       ├── render.js        SVG overlay drawing
│       ├── model.js         sketch data, constraints, solver translation
│       ├── geom.js          2D curve maths
│       └── solver.js        planegcs wrapper
└── lib/                     three, occt, planegcs (each with its LICENSE)
```

Added by the next milestones: more of `js/features/` (one file per feature), `js/io/` import and export,
`js/kernel/naming.js`, `locale/`, `README.md` (replaces this file as the
handoff document), `img/desktop_icon.png`.

## 9. Milestones

Each milestone ends in something you can try.

| | Deliverable | Done when |
|---|---|---|
| **M0** | Scaffold: shell, viewport, both engines running. **Done.** | Kernel self-test passes in the browser |
| **M1** | Document and display core: feature history, rebuild with cache, exact faces and edges from the kernel, hover and selection, model browser driven by the document, undo / redo, open / save `.aopart` in ArozOS, face pick for Start 2D Sketch. **Done**, except that open / save still has to be tried on a live server. | A hand written two feature document opens, shows, saves and reopens identically; faces and edges highlight under the cursor |
| **M2** | Sketcher on origin planes: line, rectangle, circle, arc, point, construction, snaps and inferred constraints, all stage 1 constraints and dimensions, drag solving, trim and extend, degrees of freedom display. **Done**, on origin planes and on planar faces. | The profile of your `center_plate` side wall can be drawn and fully constrained; changing one dimension updates the sketch |
| **M3** | Extrude and sketch on face: region picking, join / cut / intersect / new body, extents, projected face edges, offset work plane, edit feature and edit sketch from the browser | The loop sketch, extrude, pick face, sketch, extrude works three levels deep, and editing the first sketch rebuilds the rest |
| **M4** | Hole, fillet, chamfer, with stable references (6.3). **Done except the stable references**: edges are found by position and fail loudly when moved. | Fillets survive an edit of an earlier sketch dimension; a broken reference is reported, not misapplied |
| **M5** | View and inspect: section views with caps, all visual styles, Look At face, measure (distance, angle, radius), mass properties and centre of gravity. **Done** in a first form: fixed section planes, measure as a dialog. | The three section modes of your screenshots work on a real part |
| **M6** | Import and export: STEP, BREP, STL, OBJ, 3MF. **Done** for export of all five and import of STEP. | An exported STEP opens in Inventor with the same faces; an exported STL slices correctly |
| **M7** | Finish: touch and pen input, localisation, README, desktop icon, File Manager opening `.aopart` | Review pass on a tablet and in both themes |

Suggested order is as listed. M5 and M6 do not depend on M4 and can move
earlier if export matters sooner than fillets.

## 10. Testing

- `js/kernel/occt.js` and the document code are plain ES modules with no DOM,
  so they run under Node. Every feature gets a test that builds a known part
  and checks volume, face count and a STEP round trip. This is how the M0
  kernel code was checked.
- Reference stability (6.3) gets its own tests: build, edit an early feature,
  assert that each later reference still resolves to the intended face.
- The interface is checked in the static preview and on a real ArozOS
  instance, in both themes.
- Exported STEP files should be opened in Inventor by you, since no machine
  here has it. STL and 3MF can be checked in a slicer.

## 11. After stage 1

Revolve, sweep, loft, shell, draft, rectangular and circular pattern, mirror,
work axis and work point, sketch offset / mirror / pattern / text, a parameter
table with expressions (Inventor's fx), cosmetic and modelled threads,
multi body tools (combine, split), appearance and material per body, IGES
import (needs a different kernel build or the import-only kernel of 3D
Viewer), DXF sketch import and export, 2D drawings from the hidden line
remover that is already in this kernel, assemblies with constraints.
Section 14 plans each of these in detail.

## 12. Risks

| Risk | Effect | Mitigation |
|---|---|---|
| Topological naming (6.3) | Features jump to the wrong edge after an edit | History based names, geometric fallback, fail loudly; own test suite from M4 |
| Kernel download size | Slow first start on a slow link | Fetched once and cached, gzip on by default, progress shown; the rest of the UI is usable while it loads |
| Kernel memory | WASM heap grows over a long session | One file for all kernel calls, strict `.delete()`, bounded rebuild cache, worker can be restarted and the document replayed |
| Kernel failures | OpenCascade throws without a message on bad input | Every operation is caught per feature; the feature is marked failed, the previous shape is kept |
| Binding API changes | `replicad-opencascadejs` 1.2.1 changed its binding style from older releases | Version is pinned and vendored; all calls are behind `occt.js` |
| Constraint solver on the main thread | A very large sketch could stutter while dragging | Typical sketches solve in milliseconds; move to a worker only if measured |
| Scope | Stage 1 with a full solver is a large build | Milestones are independently usable; M2 is the biggest and can be split (geometry first, then dimensions) |
| Repository size | 23 MB of binaries added to git | One file, changed only on a kernel upgrade |

## 13. Open questions (answered)

1. **Up axis.** The scaffold is Z-up, like STEP, STL and slicers, so a part
   lands on the print bed the way it was modelled. Inventor defaults to Y-up
   (your screenshots show Y up). Keep Z-up, switch to Y-up, or make it a
   setting?
   
   > Use Z up
2. **Native extension.** Is `.aopart` acceptable, or do you prefer another
   name?
   
   > That is fine
3. **Mouse mapping.** Keep left drag = orbit when nothing is selected, or copy
   Inventor exactly (middle drag pans, Shift + middle or F4 orbits, left only
   selects)? The second is safer once selection exists, because a left drag
   can then be a window selection.
   
   > copy exactly, and add orbital view controller on the right menu under the cube
4. **Multiple bodies.** Inventor parts can hold several solid bodies ("New
   Body" in Extrude). Should stage 1 support that, or one body per part?
   
   > support single parts, but parts can have isolated sections within them
5. **Licences.** Confirm that two unmodified LGPL front-end libraries
   (OpenCascade build, planegcs) are acceptable, as with 3D Viewer.
   
   > Yes
6. **File associations.** Should 3D Modeler also register as an opener for
   `.step` / `.stp` (importing them), next to 3D Viewer?
   
   > Yes
7. **Imported meshes.** Is showing an STL / OBJ as a reference enough for
   stage 1, or do you need to cut and fillet imported meshes? That needs a
   mesh to solid conversion and is a separate piece of work.
   
   > No need to edit mesh like STL or OBJ

## 14. Plan for the remaining work

Everything below is **planned, not built**. It is written so that someone who
has not seen the earlier work can implement it: each item says what the user
should get, what the document stores, which kernel calls do the work (all
checked against this kernel build unless marked "probe first"), which files
change, and how to test it. Section 15 says how to work on the code base and
in which order to take the items.

Sizes are rough: **S** = an hour or two, one or two files; **M** = a day,
several files and a test file; **L** = several days, touches the core.

### 14.1 Overview and order

| # | Item | Size | Why it matters |
|---|---|---|---|
| A1 | Finish checking the last changes (14.2) | S | Three small things were written but not fully tried |
| A2 | Quick wins in the sketcher (14.3) | S each | Daily friction: three point arc, sketch fillet, window selection |
| A3 | Revolve (14.4) | M | The most used feature still missing |
| A4 | Stable references (14.5) | L | Without it, edits upstream break fillets and leave face sketches behind |
| A5 | Shell, Mirror, Patterns (14.6) | M each | The rest of the greyed ribbon buttons |
| A6 | Extrude and Chamfer options (14.7) | S to M | Taper, To, To Next, two-distance chamfer |
| A7 | History tools (14.8) | M | End of Part rollback, reorder, shared sketches, visibility |
| A8 | Parameters, "fx" (14.9) | M to L | Formulas that stay formulas |
| A9 | View and inspect (14.10) | S to M | Movable section planes, measure in the view, thick edges |
| A10 | Exchange (14.11) | S to M | STL / OBJ as reference, export options |
| A11 | M7: touch, localisation, README (14.12) | M | Release polish |
| A12 | Work axes, points, more planes (14.13) | S to M | Needed by Revolve and Circular Pattern for off-sketch axes |
| A13 | Sweep, Loft, Draft (14.14) | M each | Stage 2 shapes |
| A14 | Later stages (14.15) | L | Threads, text, sheet metal |
| A15 | Assembly mode (14.16) | L | **Built**: placing parts, constraints, move rotate scale, section, measure, interference |
| A16 | Drawing mode (14.17) | L | **Built**: base, projected and face views, dimensions and notes, sheet setup, PDF / DXF / SVG / PNG |

Suggested order: A1, A2, A3, A12 (axis part), A5, A6, A7, then A4 (the
large one, once the feature set is wide enough to test it against), A9, A10,
A8, A11, A13. A4 can be moved earlier if models with many edits are the
main use; nothing else depends on it.

### 14.2 A1 - Checks left over from the last session

These were implemented and pass the Node tests; the first two were only
partly tried in a browser.

1. **Mouse mapping** (`js/viewport.js`, `js/app.js`). Written: left button
   only selects and draws; middle drag pans; Shift + middle orbits (three.js
   OrbitControls swaps pan and rotate on Shift); wheel zooms to the cursor;
   Orbit and Pan buttons under the view cube lend the left button to the
   view; F4 held does the same for orbit; Esc gives it back. **Tried:** the
   two buttons toggle and show their state. **Not tried, needs a real
   mouse:** middle drag, Shift + middle, F4 held and released, and that a
   sketch tool does nothing while Orbit is on (`sketcher` asks
   `viewport.isNavigating()`). Also still missing from Inventor's set:
   F2 + drag pan, F3 + drag zoom, F5 previous view, F6 home view, double
   click on the middle button = Zoom All, and a right click menu in the view
   (Repeat last command, Done, Zoom All, Home View).
2. **STEP files open with 3D Modeler** (`init.agi` now lists `.step` and
   `.stp`; `js/app.js` start-up imports the file into a new part). Needs a
   live server: open a `.step` from the File Manager with "Open with", expect
   a new part named after the file with one "Imported1" feature. Check that
   3D Viewer is still the default opener if that is what the owner wants
   (the File Manager's default-opener setting decides, not this app).
3. **Chamfer or fillet that does not fit** (`isSound()` in
   `js/kernel/occt.js`). Covered by `tests/chamfer-after-fillet.test.mjs`.
   In the app, the panel should show "does not fit on these edges" and keep
   OK disabled; a part that already contains such a feature should show it
   failed in the browser instead of a broken solid. Worth one manual look.

### 14.3 A2 - Sketcher gaps

All of these live in `js/sketch/`. A tool is one function in `tools.js`
(copy `circleTool`); geometry helpers go in `geom.js`; anything that edits
the sketch data goes through the helpers of `model.js`. Add cases to
`tests/sketch.test.mjs` for the pure parts.

Done in the last session (owner: "continue next phase"): three point arc
and tangent arc (the Arc button is now a drop-down), sketch fillet and
chamfer of line corners, window selection in the sketch, F8 / F9,
Concentric, and the softer failure of automatic constraints. Tests:
`tests/sketch-tools.test.mjs`. Found on the way: a Tangent between two
curves that share an end point was a double root for the solver (it called
the tangency redundant and left the join free to slide); such a tangent now
maps to planegcs `angle_via_point` at the shared point (0 or pi, as drawn),
which is how FreeCAD does it. Then, in a later session: Polygon (a
construction circle through the corners, all sides equal), Slot (two half
circles and two lines tangent at the joins, equal radii) and sketch Mirror
(each copied point tied to its original by a symmetric constraint about
the mirror line, so the copy follows; a circle also gets an equal radius;
curves selected before the tool are taken; Enter goes from picking curves
to picking the line). Driven dimensions are done too: a
dimension that would over-constrain the sketch is kept as a driven one
(`driven: true`, left out of the solver, its value refreshed by
`applySolution`, drawn in brackets, not editable). Still open from this
list: typed angle (needs the sketch X axis as a fixed reference for the
solver), offset, sketch pattern, window selection in the model view,
ellipse and spline, text.

**Three point arc** (done). Clicks: start, end, a point on the arc. Centre =
circumcentre of the three points (reject if collinear within 1e-9). The
stored arc is always counter clockwise from `start` to `end`, so swap the
two when the third point lies on the clockwise side (sign of the cross
product of start->end and start->third). Make it the default of the Arc
button with the present centre point arc in a small drop-down (the ribbon
supports `menu`), as in Inventor.

**Tangent arc** (done). Start on the end point of an existing line or arc; the
centre lies on the normal to that curve through the point; the end is the
cursor. Add a `tangent` constraint between the two curves on commit.

**Sketch fillet and chamfer** (done for two lines). This kernel build has no 2D fillet
(`BRepFilletAPI_MakeFillet2d` and `ChFi2d_FilletAPI` are absent), so do it
in JavaScript. For two lines meeting at a shared point P with directions
d1, d2 and angle t between them: tangent points are P + d1 * r / tan(t / 2)
and P + d2 * r / tan(t / 2); the centre is on the bisector at
r / sin(t / 2). Edit: give each line its own new end point at its tangent
point (the old shared point is dropped if nothing else uses it, or kept as
a construction corner when dimensions hang on it), add the arc, add two
`tangent` constraints and a `radius` dimension. A second fillet with the
same radius gets an `equal` to the first instead of its own dimension, as
Inventor does. Chamfer: same with a line instead of the arc and two
`distance` dimensions. Line-arc and arc-arc corners can come later.

**Window selection** (done in the sketch; the model view is open). In the Select tool, a left drag that starts on
nothing draws a rectangle: dragged left to right it selects what is fully
inside, right to left what it touches. The sketcher already keeps the
screen position of everything it drew (`cache` in `sketcher.js`: points,
curve polylines, dimension and glyph boxes), so this is a rectangle test.
Draw the rectangle in the overlay through `preview`. Do the same in the
model view for faces and edges (`js/viewport.js`: project each edge's
segment ends with `project()`).

**Typed angle** (S). While drawing a line, a second size box "Angle" (Tab
switches, as the rectangle already does) fixes the direction; commit adds an
`angle` dimension against the X axis. The X axis needs to exist as geometry
for that: add two fixed construction reference lines through the origin to
`toPrimitives()` (ids `$x` and `$y`), which also lets users constrain to
the sketch axes.

**Driven dimensions** (S). When a dimension would over-constrain the sketch,
ask "Create a driven dimension instead?" with `ask()`. Stored as
`driven: true`, sent to the solver with `driving: false`, drawn in brackets,
and its `value` refreshed from `measure()` after every solve.

**Softer failure of automatic constraints** (done). In `commit()` of
`sketcher.js`: when the solve fails and the edit was not `strict`, remove
the constraints added since the last store (the same set the redundancy
code already computes) and solve again before refusing the whole stroke.

**Constraint display** (done, keys only). F8 shows and F9 hides the glyphs; a status bar
toggle "Show constraints". The renderer already draws them from one list.

**Concentric** (done). Two circles or arcs share a centre: a `coincident`
between their centre points; the button is sugar over `build()`.

**Polygon and slot** (S each). Compositions of existing geometry with
constraints: a slot is two lines, two arcs, four `tangent`, one `equal`
between the arcs, one `parallel`.

**Offset** (M). Use the kernel rather than writing 2D offsetting: a worker
operation that builds the wire of the picked chain (`curveEdge` per curve,
`BRepBuilderAPI_MakeWire`), runs
`new oc.BRepOffsetAPI_MakeOffset(wire, oc.GeomAbs_JoinType.GeomAbs_Arc)`
then `Perform(distance)`, and returns the resulting edges as line / circle
records exactly like `discretize()` already does for model edges. The
sketcher adds them as normal geometry plus one `pldistance` dimension
between the first source line and its copy. Not associative beyond that
dimension; say so in the prompt.

**Mirror and pattern in the sketch** (M). Mirror: copy the picked geometry
across a line and tie every point pair with a `symmetric` constraint (the
solver supports it), which keeps the copy associative. Rectangular and
circular pattern: plain copies in a first version.

**Ellipse and spline** (L, later). The solver supports both. Needs: new
geometry types in `model.js` (and in `toPrimitives`), sampling, nearest
point and intersection in `geom.js`, an edge builder in `occt.js`
(`gp_Elips` is present; splines through `GeomAPI_Interpolate`, which needs
an `NCollection_HArray1_gp_Pnt`; probe that it can be filled), and
projection of elliptical model edges.

**Text** (later). There is no font support in this kernel build; it would
need a font outline library vendored in `lib/` and its glyph outlines
turned into sketch curves.

### 14.4 A3 - Revolve

**Done.** `revolveTool` / `revolve` in `occt.js` (full turn or angle in
the four directions, a profile across the axis is refused), the panel in
`js/features/revolve.js` on `panel.js`, the profile picking shared with
Extrude in `js/features/profiles.js`, axis picking with
`viewport.setAxes` (lines of the profile's sketch and the origin axes in
its plane; a single construction line is taken by itself). Tests:
`tests/revolve.test.mjs` (Pappus volumes, directions, origin axis, a cut).
Not done: rebuilding the Extrude panel itself on `panel.js` (it keeps its
own markup, only the profile part moved), and an angle arrow to drag.

**What the user gets.** 3D Model > Revolve: pick profiles exactly as in
Extrude, pick the axis (a line of the same sketch, usually a construction or
centre line; later a work axis), choose Full or Angle with the same four
directions as Extrude, and Join / Cut / Intersect / New Solid. Live preview.

**Document.**

```json
{ "id": "f7", "type": "revolve", "name": "Revolution1",
  "sketch": "f6", "regions": [[12, 4]],
  "axis": { "curve": "l3" },
  "operation": "join",
  "extent": { "type": "full" } }
```

`extent` may also be `{ "type": "angle", "value": 90, "direction":
"positive" | "negative" | "symmetric" | "asymmetric", "value2": 30 }`
(degrees). Add `revolve: 'Revolution'` to `TYPE_NAMES` in `document.js`.

**Kernel** (`occt.js`): `revolveTool(oc, bodies, feature, sketch)` and
`revolve(...)`, modelled on `extrudeTool` / `extrude`.

- Region faces: `sketchRegions()` filtered with `inRegion()`, as Extrude.
- Axis: the two ends of the sketch line through `toWorld(frame, u, v)`,
  `new oc.gp_Ax1(point, new oc.gp_Dir(vector))`.
- Sweep: `new oc.BRepPrimAPI_MakeRevol(face, axis, false)` for a full turn,
  `new oc.BRepPrimAPI_MakeRevol(face, axis, radians, false)` for an angle
  (both overloads exist). For "negative" reverse the axis direction; for
  "symmetric" first turn the face back by half the angle
  (`gp_Trsf.SetRotation(axis, -a / 2)` + `BRepBuilderAPI_Transform`), for
  "asymmetric" back by `value2` and sweep `value + value2`.
- Run the result through `isSound()`: a profile that crosses the axis gives
  a self-intersecting solid that the kernel reports as done.
- Fuse several regions into one tool, then the same boolean as Extrude.
- `rebuild.js`: add `case 'revolve'`. `worker.js`: make the `preview`
  operation dispatch on `feature.type`.

**Interface.** Do not copy `extrude.js`. First move its profile handling
(loading regions of the free sketches, painting them with
`viewport.setRegions`, pick and drop, "one feature uses one sketch") into
`js/features/profiles.js`, and rebuild the Extrude panel on `panel.js`
(it predates that helper). Then `js/features/revolve.js` is small.
Axis picking needs sketch curves that can be picked in the 3D view, which
does not exist yet: extend `viewport.setSketches` so each curve is its own
object carrying `{ sketch, id }`, and add `startCurvePick(filter, handler)`
beside `startPlanePick` (hover highlight, click returns the id). Only
straight curves qualify. When the sketch has exactly one construction
line, pick it automatically, as Inventor does with a centre line.

**Tests** (`tests/kernel.test.mjs` or a new file): a rectangle revolved a
full turn about a line at distance R gives volume 2 * pi * Rc * A (Pappus);
90 degrees gives a quarter of that; symmetric spans both sides (check the
bounding box); a profile crossing the axis is reported, not built.

### 14.5 A4 - Stable references (the large one)

**A first step is done**, found necessary while building a part through
the interface (making a boss taller broke the chamfer on its top edge;
making the plate thicker left the mounting holes sketched on its top
short of the new top, silently):

- *Edges*: a reference keeps `{ body, mid, length }` and gains `sig`
  (`edgeSignature` in `occt.js`): the curve (line direction, or circle
  radius and axis), the surfaces of its two faces (plane normal, cylinder
  radius, axis and in / out) and whether it is an outside corner, found
  with a point stepped off the edge and the distance tool's inside test
  (`isInside`: `BRepExtrema_DistShapeShape.InnerSolution()`, per solid,
  since it says nothing for a compound). `findEdges` tries the position
  first, then the edge with the same description nearest to the old
  position. Fillet and Chamfer store descriptions on OK (worker operation
  `edgeRefs`), and Edit Feature re-selects the edges where they are now.
  Tests: `tests/references.test.mjs`.
- *Faces under sketches and work planes*: the face reference gains
  `face: { normal, point }` (the point clicked). `followFace` in `occt.js`
  finds the planar face with that normal on which the point, moved along
  the normal, lands; `rebuild.js` does this in feature order and tells
  `profile.js` (`resolveFace`), and the rebuild result carries `frames` so
  the app does the same (`takeFaceFrames`). Tests:
  `tests/followface.test.mjs`.

What this does not cover, and what the naming design below would: faces
that turn or move sideways, projected sketch geometry (phase C), and a
face split in two (the point decides). Old documents keep working by
position.

**The problem today.** Three things are remembered by where they were, not
by what they are:

- the edges of a fillet or chamfer: `{ body, mid, length }`, matched by
  `findEdges()` in `occt.js`;
- the plane of a sketch on a face: `plane: { ref: "face", frame }`;
- projected sketch geometry: plain coordinates with `ref: true`.

So after an upstream edit a fillet fails ("an edge ... is no longer there"),
a sketch on a face stays where the face used to be, and projected edges go
stale. Failing loudly is correct, but Inventor users expect all three to
follow.

**What the kernel offers.** Checked in this build: `IsSame()` on shapes;
`Generated()`, `Modified()`, `IsDeleted()` on every builder (prism, boolean,
fillet); `FirstShape()` / `LastShape()` on prism and revolve;
`NbContours()`, `NbEdges(i)`, `Edge(i, j)`, `NewFaces(i)` on the fillet
maker. **Not available:** `BRepTools_History` (so the history of
`ShapeUpgrade_UnifySameDomain`, which `boolean()` runs after every
operation, cannot be read), any shape map or hash (`TopExp`,
`TopTools_*`, `HashCode` are absent), `TopoDS_Iterator`, solid and face
classifiers. The lists returned by `Generated()` / `Modified()` only expose
`First()`, `Last()` and `RemoveFirst()` in the type definitions; whether
`Extent()` or `IsEmpty()` of the base class can be called must be **probed
first** in Node. Do not build the design on reading those lists.

**Design: name faces by role, find them by the surface they lie on.** This
needs only `IsSame`, `BRepAdaptor_Surface` and `BRepExtrema_DistShapeShape`,
all of which are in use already.

1. *Every face gets a name each time the model is rebuilt.* A name is a
   string built from the feature that made the face and the face's role in
   that feature, never from an index:
   - Extrude `f2`: `f2/start`, `f2/end` (the caps; with several regions
     `f2/end:0`, `f2/end:1` in the order of `feature.regions`), and
     `f2/side:<curve id>` for the face swept by sketch curve `<curve id>`.
   - Revolve: the same with `side:<curve id>`; `start` / `end` only when
     the angle is not full.
   - Hole `f6`: `f6/wall:<point id>`, `f6/bottom:<point id>`,
     `f6/cbore:<point id>`, `f6/cboreface:<point id>`, `f6/csink:<point id>`.
   - Fillet / chamfer `f5`: `f5/round:<k>` for the faces made along the
     k-th picked edge (the fillet maker's contour functions say which new
     faces belong to which picked edge; for a chamfer, assign each new face
     to the nearest picked edge).
   - Import `f1`: `f1/face:<n>` in the file's own face order.
2. *How a face gets its name.* The feature function builds its tool and
   names the tool's faces by role (it knows which sketch curve each side
   came from: build the prism per curve, or match the side face by testing
   that the curve's midpoint lies on it). After the boolean and the
   clean-up, every face of the result is named by this rule, in order:
   - it `IsSame` as a face of the body before the feature: keep that name;
   - else find the named faces (of the old body and of the tool) that lie
     on the same surface, and take the one that contains an inside point of
     the new face (distance from that point to the candidate is zero by
     `BRepExtrema_DistShapeShape` with a vertex from
     `BRepBuilderAPI_MakeVertex`). "Same surface" is decided from
     `BRepAdaptor_Surface`: for a plane the normal and the offset, for a
     cylinder axis and radius (`Cylinder()` on the adaptor: probe first, it
     is inherited the way `Plane()` is), else the surface type plus a few
     sample points. Group the candidates by a rounded key of those numbers
     first, so each new face is only compared with a handful.
   - else it is new and unnamed: give it `f<id>/new:<n>` ordered by the
     coordinates of its centre, so at least it is repeatable.
   When one old face is cut into several, they all inherit its name. That
   is fine: see 4.
3. *Where names live.* In the cache entry of `rebuild.js`, next to
   `bodies`: `names: [[...one name per face, in face order]]` per body.
   `describe()` takes that list and adds `name` to each face record, and to
   each edge the pair of names of the two faces it lies between (found by
   which faces list the edge; `describe()` already walks faces then edges).
4. *References.* A reference becomes `{ name, hint }` where `hint` is
   today's position record (`mid` and `length` for an edge, centre and area
   for a face). Resolution: collect what carries the name; one match is the
   answer (this is what makes it follow the model); several matches are
   settled by the hint; no match falls back to the hint alone, exactly as
   `findEdges()` works today; if that fails too, fail loudly as now. Old
   documents without `name` keep working through the fallback.
5. *Sketch on a face.* `plane: { ref: "face", name, frame }`. The worker
   resolves it while replaying (the face named `name` in the body before
   the sketch feature, its plane turned into a frame by the same rule as
   `faceFrame()` in `app.js`) and returns the resolved frames with the
   rebuild result (`sketchFrames: { <sketch id>: frame }`). The main thread
   keeps that table and `planeFrame()` uses it, the way a work plane is
   already looked up; the stored `frame` is the fallback, with a warning
   mark on the sketch in the browser when it had to be used.
6. *Projected geometry.* Each `ref: true` curve stores
   `source: { edge: [nameA, nameB], hint }`. After a rebuild, the main
   thread compares the stored coordinates with the edge as it is now; when
   they differ it re-projects, solves the sketch without opening it
   (`js/sketch/solver.js` has no DOM in it and can be called directly),
   stores the result without an undo step, and rebuilds once more. Guard
   against a loop with a pass counter.

**Phases**, each shippable: (A) names in the rebuild and in `describe()`,
fillet, chamfer and hole references use them; (B) sketches on faces follow;
(C) projected geometry follows.

**Tests** (a new `tests/references.test.mjs`): fillet the top outline of a
plate, change the extrusion distance, the fillet still builds and the
volume matches; add a boss on the top face, change the plate thickness,
the boss sketch frame moved with the face; delete the sketch curve whose
side face was filleted, the fillet reports the missing edge; a document
saved before names existed still rebuilds identically.

**Cost to watch.** Naming adds surface comparisons to every feature. Keep
it out of the way of the cache: names are computed once per cache entry,
not per rebuild.

### 14.6 A5 - Shell, Mirror, Patterns

**Done.** Shell (`shell` in `occt.js`, `MakeThickSolidByJoin` with the
Intersection join so outer corners stay sharp as in Inventor; a result
whose volume did not change is refused, which is how walls too thick come
back; panel `js/features/shell.js`; faces picked in the model and kept as
`{ body, centre, area, sig }` with `findFaces`, so an edit upstream does
not lose them; tests `tests/shell.test.mjs`). Rectangular and circular
patterns and Mirror (`placements`, `patternTools`, `pattern` in
`occt.js`; one panel `js/features/pattern.js` for the three; features are
picked in the browser while the panel is open, a sketch standing for the
feature built from it; directions, axes and planes from the origin or
picked in the model, stored as numbers; a mirror with no feature mirrors
the whole solid; deleting a repeated feature takes the pattern along;
tests `tests/pattern.test.mjs`). Not done: direction references that
follow edits, a preview that says when copies miss the solid, and
patterns of fillets.

These need **face references**, which do not exist yet. Until 14.5 is done,
make one by position, like an edge: `describe()` adds `centre` to every face
(the centre of mass from the `GProp_GProps` it already computes for the
area), and `findFaces()` matches centre and area with the tolerance used by
`findEdges()`. The viewport already picks faces; `setPickFilter({ faces:
true, toggle: true })` limits picking to them.

**Shell** (M). Pick the faces to remove, give the wall thickness, Inside /
Outside. Document: `{ type: "shell", faces: [faceRef], thickness: 2,
direction: "inside" }`. Kernel: `const m = new
oc.BRepOffsetAPI_MakeThickSolid(); m.MakeThickSolidByJoin(body, new
oc.NCollection_List_TopoDS_Shape(faces), -thickness, 1e-3, ...)` (negative
goes inwards; the later arguments have defaults: probe which can be left
out), `m.Build()`, `m.Shape()`, then `isSound()`. Live preview with
`viewport.setPreview(meshes, 'result')` as fillet does. Typical failure: a
thickness larger than the smallest fillet radius; report it.

**Mirror** (M). Mirror the whole solid, or chosen features, across a plane
(origin plane, work plane or planar face). Document: `{ type: "mirror",
source: { kind: "body" } | { kind: "features", ids: [...] }, plane:
<plane reference>, operation: "join" | "new" }`. Kernel: `gp_Trsf.SetMirror(
new oc.gp_Ax2(point, normal))` and `new oc.BRepBuilderAPI_Transform(shape,
trsf, true, false)`.

**Rectangular and Circular Pattern** (M). Document: `{ type: "pattern",
kind: "rect", source, dir1: <direction reference>, count1: 4, spacing1: 12,
dir2, count2, spacing2 }` and `{ kind: "circ", source, axis: <axis
reference>, count: 6, angle: 360 }`. Kernel: `gp_Trsf.SetTranslation` /
`SetRotation(axis, k * angle / count)` and `BRepBuilderAPI_Transform`. A
direction reference is a straight model edge (its `curve` record gives the
two ends) or an origin axis, with a Flip box; an axis reference is a work
axis (14.13), an origin axis, or a cylindrical face (add `axis` and
`radius` to the face record for cylinders).

**Patterning features, not just bodies.** For `source.kind: "features"`,
do not copy faces. Recompute the *tool* of each listed feature
(`extrudeTool`, `holeTool`, `revolveTool` already return it), transform the
tool, fuse all copies into one tool, and apply the feature's own boolean
once. That is fast and robust, and it is why the feature functions are
split into "tool" and "apply". Fillets and chamfers cannot be patterned
this way; say so in the panel. Cap the count (200) to keep a typo from
freezing the worker.

**Tests:** shell of a box of known size gives outer volume minus inner
volume; mirror of an off-centre boss doubles its volume contribution;
a 3 x 2 pattern of a through hole removes six cylinders.

### 14.7 A6 - Extrude and Chamfer options

**Taper** (M). `extent.taper` in degrees. This build has no draft prism
(`LocOpe_DPrism`, `BRepFeat` are absent). Build the prism as now, then
draft its side faces: `const d = new oc.BRepOffsetAPI_DraftAngle(prism)`,
`d.Add(sideFace, new oc.gp_Dir(normal), radians, sketchPlane)` for every
side face (the faces that are neither the start nor the end cap), `Build`,
`Shape`, `isSound()`. Negative angles widen.

**To** (M). `extent: { type: "to", face: <face reference> }`. When the
target is a plane parallel to the sketch, it is simply a distance. In
general: sweep as far as `reach()` gives, then cut the tool with the half
space beyond the target: `new oc.BRepPrimAPI_MakeHalfSpace(targetFace,
pointOnTheFarSide)`.

**To Next** (M). Sweep as far as `reach()`, cut that prism by the body with
`BRepAlgoAPI_Splitter` (arguments: the prism; tools: the body), and keep the
piece that touches the profile: the one at zero distance from a vertex put
a hair in front of the profile's inside point (`BRepExtrema_DistShapeShape`;
there is no solid classifier in this build).

**Chamfer with two distances, or distance and angle** (S). The maker has
`Add(d1, d2, edge, face)` and `AddDA(distance, angle, edge, face)`; `face`
is the one `d1` is measured on. Find the two faces of an edge by walking
the body's faces and their edges with `IsSame` (there is no ancestor map).
Store `mode: "equal" | "two" | "angle"`, `distance2`, `angle` and `flip`
(which of the two faces, ordered by their centres, is the reference).

**Variable or multi-radius fillet** (later). One feature with several edge
sets, each with its own radius: `{ sets: [{ edges, radius }] }`.

**Hole placed without a sketch** (M). Inventor's "Linear" placement: click a
face, then two edges and their distances. Implement as sugar: create the
sketch on the face, a point, and two `pldistance` dimensions to the
projected edges, then open the Hole panel on it.

**Threads** (S for the note). Cosmetic only: `thread: { designation:
"M6x1", depth }` on a hole, shown in the browser and in Mass Properties as
text. A modelled helix is a later stage.

### 14.8 A7 - History tools

**End of Part marker** (M). The row exists but does nothing. Make it
draggable in the browser; `doc.data().end` holds the id of the last active
feature. `rebuild.js` treats everything after it as not there (reuse the
`upto` path); new features are inserted at the marker, not appended.

**Roll back while editing a sketch** (S). `openSketch()` in `app.js` should
show the model as it was before the sketch, the way feature panels already
do with `kernel.call('rebuild', { document, upto })`.

**Reorder** (M). Drag a feature row. Allowed only when everything it needs
still comes before it (its sketch, the work plane of that sketch) and
everything that needs it still comes after. Add `doc.move(id, beforeId)`
with that check and a test.

**Shared sketches** (S). Right click a used sketch > Share Sketch sets
`shared: true`; it is then drawn in the model again and offered as a
profile source. The browser shows it under every feature that uses it.

**Visibility** (S). An eye toggle on sketches, work planes and bodies:
`hidden: true`. It must not cause a rebuild: remove `hidden` in
`geometryKey()` of `rebuild.js` the way `name` already is.

**Feature errors on open** (S). When a part is opened and features fail,
list them in a dialog instead of only marking them in the tree.

**Unsaved-work safety** (S). Keep an autosave of the document text in
`localStorage` (or through an AGI script in the user's `tmp:/`) every few
changes, and offer to restore it on start after a crash.

### 14.9 A8 - Parameters ("fx")

Today a formula is evaluated when typed and only the number is stored
(`js/expr.js`).

- **Document:** `parameters: [{ name: "wall", expr: "2.4", value: 2.4 }]`,
  and every size gains an optional `expr` next to its `value` (sketch
  dimensions, extrude distances, radii, hole sizes, pattern counts).
- **Evaluation:** `evaluate(text, scope)` with names looked up in `scope`;
  parameters are evaluated in dependency order; a cycle is an error on the
  parameter, not a crash.
- **When a parameter changes:** recompute every `expr`, then every sketch
  whose dimensions changed has to be solved again **without being open**.
  That is the same "solve a sketch headless" step 14.5 phase C needs:
  write it once (`js/sketch/headless.js`: load the feature into the solver,
  solve, write the geometry back).
- **Interface:** Manage > Parameters, a table (name, equation, value,
  comment). Dimensions show `d3 = wall * 2` when a status bar toggle asks
  for it. Each dimension also gets an automatic name (`d0`, `d1`, ...) so
  it can be used in another formula, as in Inventor.

### 14.10 A9 - View and inspect

**Movable section planes** (M). Section state `{ mode, planes: [{ normal,
offset }] }` kept in the view, not in the document. Add "pick the cutting
plane" (origin plane, work plane or face, through `startPlanePick`) and a
drag handle (reuse `viewport.setArrow`) for the offset. A second small
panel shows the offset as a size box.

**Measure in the view** (S). `BRepExtrema_DistShapeShape` also returns the
two closest points (`PointOnShape1(1)`, `PointOnShape2(1)`): return them
from the `distance` operation and draw a dimension line with a label,
projected like sketch dimensions. Add angle between two edges, radius of a
circular edge or cylindrical face, and running totals for several picks.

**Vertices** (S). `describe()` returns the unique vertices; the viewport
draws nothing for them but lets the pointer snap to them. Needed for
measuring between points, work points, and projecting a point into a
sketch.

**Thick highlighted edges** (done). `LineSegments2`,
`LineSegmentsGeometry` and `LineMaterial` of three.js 0.185.0 (the same
release as `lib/three/`, copied unmodified from the npm package) are in
`lib/three/addons/lines/` and draw the hover and selection overlays only.
Their `resolution` follows the canvas in `resize()`.

**More visual styles** (S). Realistic (an environment map: `3D Viewer`
ships `RoomEnvironment.js` of the same three.js release; copy it, do not
link to it), Monochrome, Wireframe with Hidden Edges.

**Appearance and material** (S). A colour per part in the document, and a
material with a density so Mass Properties can state the mass.

**Look At a face, previous view** (S). Look At should accept a face (it
asks for a plane today and a face in a part with solids); keep a short
stack of camera states for F5.

### 14.11 A10 - Exchange

**STL and OBJ as a reference** (M). The owner does not need to edit meshes
(13.7), only to see them. A feature `{ type: "mesh", name, format, source,
data }` that the kernel ignores (`applyFeature` returns the bodies
unchanged) and the viewport draws as a pale, non-pickable mesh
(`viewport.setMeshes`). Small parsers for binary and ASCII STL and for OBJ
belong in `js/io/exchange.js` with tests; read binary files through the
`readBinary` operation of `backend/file.agi`. Store `data` compactly
(base64 of a Float32 buffer), and warn above a few megabytes because it
lives inside the part file. Excluded from export and Mass Properties.

**Export options** (S). ASCII STL; export one chosen solid; a unit choice
(mm or inch) applied as a scale; remember the last quality per format.

**Size limit** (to watch). Binary data goes through AGI as hex, which
doubles it; `backend/file.agi` allows 48 MB. If real parts hit that, stop
and ask the owner before using anything other than AGI (rule 1 in 15.2).

**File Manager thumbnail** (not planned). It would need Go code in
`mod/filesystem/metadata`; only on request.

### 14.12 A11 - Milestone M7

**Touch and pen** (M). Pointer events are used throughout, but only a mouse
was tried. Plan: one finger selects and draws (as the left button); two
fingers pan and pinch-zoom (`controls.touches = { ONE: null, TWO:
THREE.TOUCH.DOLLY_PAN }`); orbit through the Orbit button; a long press is
the right click. Raise the pick tolerances when `event.pointerType` is
`touch` (`POINT_PIXELS`, `CURVE_PIXELS` in `sketcher.js`, `EDGE_PIXELS` in
`viewport.js`), make typed sizes reachable without a keyboard (tapping a
size box opens the existing value editor), and give the panels a bottom
sheet layout under 480 px. The preview's mobile preset only changes size
and user agent; a real tablet check is the owner's.

**Localisation** (M). Follow the pattern of the other WebApps:
`locale/3dmodeler.json` in the app folder with the File Manager's
languages (zh-tw, zh-hk, zh-cn, en-us, ja-jp, ko-kr); load
`../script/applocale.js`; `applocale.init(file, onLoaded, onError)` before
the first render (the app starts in `js/app.js`, a module: wait for it
there); `locale="key"` on static markup, a `T(key, english, vars)` helper
for strings built in code; no `fontFamily` in the file. Where the strings
are: the ribbon table (`ribbon.js`, key by command id), `FEATURE_HINTS`
and status messages in `app.js`, row labels in the feature panels, tool
prompts in `sketch/tools.js`, dialogs. Kernel errors are thrown as English
sentences inside the worker: give each a short code (`new KernelError(
'fillet/toolarge', '...')`) and translate by code on the main thread.
Decide with the owner whether default feature names ("Extrusion1") are
translated; they are stored in the file.

**README** (S). Replace this proposal as the handoff document: what the app
is, the folder layout, how to run and test, the file format, the recipe
for adding a feature (15.4), the kernel notes (15.5). Keep the design
history out of it.

**Desktop icon** (S). `img/desktop_icon.png`, 128 x 128, drawn from
`img/module_icon.svg` (render it on a canvas in the preview and save the
PNG); the desktop prefers it for shortcuts.

**Other browsers** (S). Only Chromium was used. The kernel runs in a module
worker (Firefox 114 or newer, a current Safari). Check also pointer
capture, the `inset` CSS shorthand and WebGL line rendering.

**Performance** (S to M). The slow part is `describe()`: several calls into
the kernel per mesh vertex. Cheap win: keep the description in the cache
entry of `rebuild.js` beside the shape, so bodies a feature did not change
are not described again. Then measure with a real part of a few hundred
features before doing more.

### 14.13 A12 - Work axes, work points, more work planes

**Work axis** (S to M). `{ type: "axis", name, def }` with `def` one of:
along a straight edge (`{ kind: "edge", ref }`), the axis of a cylindrical
face (`{ kind: "cylinder", ref }`), through two points, or the intersection
of two planes. Resolves to `{ o, d }` in `js/kernel/profile.js` next to
`planeFrame()`. Drawn as a long dash-dot line; pickable. Used by Revolve
(an axis outside the sketch), Circular Pattern and angled work planes.
Expose the three origin axes the same way (they are only labels in the
browser today).

**Work point** (S). At a vertex, at typed coordinates, or where an axis
meets a plane. Needs vertex picking (14.10).

**More work planes** (M). Midplane between two parallel planes or faces
(very common in Inventor): offset from the first by half the distance.
Through an edge at an angle to a plane: `{ base, axis, angle }`, the frame
rotated about the axis. Through three points. Tangent to a cylinder and
parallel to a plane. All are new `def` kinds resolved by `workPlaneFrame()`;
the panel is `js/features/plane.js`.

### 14.14 A13 - Sweep, Loft, Draft

**Sweep** (M). Profile from one sketch, path from another. `{ type:
"sweep", sketch, regions, path: { sketch, curves: [...] }, operation }`.
Kernel: the path as a wire (`curveEdge` + `BRepBuilderAPI_MakeWire`), then
`new oc.BRepOffsetAPI_MakePipe(pathWire, profileFace)`. The path should
start on the profile plane and leave it at a right angle; check and say so.
`BRepOffsetAPI_MakePipeShell` is there for the cases the simple pipe twists.

**Loft** (M). Sections from two or more sketches. `{ type: "loft",
sections: [{ sketch, region }], ruled: false }`. Kernel: `new
oc.BRepOffsetAPI_ThruSections(true, ruled, 1e-6)`, `AddWire(outerWire)` per
section in order, `Build`, `Shape`. The outer wire of a region face: probe
`oc.BRepTools.OuterWire(face)`; otherwise explore the face's wires with
`TopExp_Explorer(face, TopAbs_WIRE)` and take the longest.

**Draft** (M). Faces tilted about a neutral plane: `BRepOffsetAPI_DraftAngle`
as in 14.7, with picked faces.

**Rib, Emboss, Decal** (not planned). `BRepFeat` is not in this build.

### 14.15 A14 - Later stages

- **2D drawings.** Built: see 14.17.
- **DXF** import into a sketch and export of a sketch: lines, arcs and
  circles map one to one onto sketch geometry.
- **Assemblies.** Built: see 14.16.
- **Modelled threads, text, sheet metal, surfaces.**
- **Multi-body tools** (Combine, Split): `boolean()` and the splitter are
  there; they need body picking and a panel.
- **IGES.** Not in this kernel build. `3D Viewer` carries a different
  build that can read IGES for display only; a modelling import needs a
  custom kernel build.

### 14.16 Assembly mode (built)

Asked for by the owner: "when creating a new file, the user should be able
to pick between a part, an assembly or a mechanical drawing (the last one
later, for 2D printable blueprints). In assembly mode the user brings parts
together, aligns them in different ways (translate, scale, rotate), views
them in half and three quarter section, with alignment and measurement tools
so parts can be easily manipulated in 3D space."

**What the user gets**

- **File > New** (and the New button) asks Part, Assembly or Drawing
  (`chooseNew()` in `js/ui.js`); Drawing is 14.17.
  Opening a file picks the environment by its `format` field; the File
  Manager also opens `.aoasm` with the app (`init.agi`).
- **The Assemble tab** (the part tabs 3D Model and Sketch are hidden; the
  ribbon has `mode: "part" | "assembly"` on tabs, groups and buttons and
  `ribbon.setMode()`):
  - *Component*: **Place** a saved part (`.aopart`) or a STEP file (kept
    inside the assembly as a part of one Imported feature). The first
    component is grounded at the origin; later ones land beside what is
    there and the view zooms to show them. The same file placed twice is one
    part entry with two components (Inventor style names `Pin:1`, `Pin:2`).
    **Refresh Parts** reloads every part file (after editing one), **Open
    Part** opens a component's file in a tab (14.18), **Delete**.
  - *Position*: **Free Move** (drag a component in the view plane) and
    **Free Rotate** (drag to turn it about its middle); constraints hold
    while dragging, so a constrained component only moves along the freedom
    it has left and what is constrained to it follows. **Move Rotate Scale**
    opens a panel with three.js's TransformControls triad (arrows and planes
    move, rings turn, the handles scale evenly; W / E / R switch), assembly
    or part axes, snap (1 mm, 15 deg, 0.1x), and typed position, rotation
    (about X, then Y, then Z) and size; OK keeps, Cancel restores.
    **Grounded** toggles, **Place at Origin** puts the part's origin on the
    assembly origin, **Drop to Floor** puts its lowest point on Z = 0.
  - *Relationships*: **Constrain** and the five quick buttons open the Place
    Constraint panel: Mate, Flush, Angle, Tangent, Insert, two picks,
    solution, offset or angle. As soon as both picks are made the components
    jump into place (a live solve); OK keeps it, Apply keeps it and starts
    the next one; a constraint that cannot hold is refused with the reason.
    Origin planes and axes can be picked from the browser's Origin folder or
    in the view while View > Origin Planes is on.
  - *Visibility*: Hide, Isolate, Show All (stored in the file, undoable).
- **Inspect**: **Measure** is now a panel for parts and assemblies
  (`js/inspect/measure.js`): one pick says what it is (area, length, radius,
  diameter), two give the exact shortest distance, its X / Y / Z parts and
  the angle, with a dimension line and its value drawn in the view; in an
  assembly "Whole components" measures the gap between two components.
  **Analyze Interference** (assembly) finds every pair of components that
  share volume (faces that only touch do not count), lists the volumes and
  shows the overlaps in red until Esc. **Degrees of Freedom** shows in the
  browser how many ways each component can still move. **Mass Properties**
  covers the whole assembly.
- **View > Section View** is now a panel for parts and assemblies
  (`js/inspect/section.js`): Half, Quarter or Three Quarter; which origin
  plane cuts (XY, XZ, YZ); where (a slider over the model's extent, or a
  typed value); which side stays; a second plane for the quarter modes.
  Each component's cut face is filled in a darker shade of its colour.
- **The assembly browser** (`js/assembly/browser.js`): the assembly, its
  Origin, every component (colour swatch, grounded pin, degrees of freedom,
  a warning when its part could not be loaded) with its constraints under
  it (value, a warning when it does not hold). Hovering a row lights the
  component (or both components of a constraint) in the view; right click
  for Move Rotate Scale, Ground, Hide / Show, Isolate, Open Part, Rename,
  Delete, and Edit / Suppress / Rename / Delete on a constraint; F2 and Del
  work too.
- **Export** of the assembly: STEP and BREP (one compound, every component
  where it is), STL, OBJ and 3MF. **File > Sample Assembly** opens a plate
  with two inserted pins and a block mated and flush, with its parts kept
  inside the file, so it works without any files on the server.

**How it is built**

- *Document* (`js/assembly/document.js`): `.aoasm` JSON:
  `{ format: "aoasm", version: 1, units: "mm", parts: { p1: { name, path |
  data } }, components: [{ id, name, part, matrix, grounded, hidden, color
  }], constraints: [{ id, name, type, solution, offset, angle, a, b,
  suppressed }] }`. A part is referenced by its ArozOS path; `data` (the part
  document itself) is kept only when there is no file (STEP placed, or the
  browser fallback without ArozOS). `matrix` is 16 numbers, column-major as
  three.js uses them: rotation times a uniform scale plus a translation.
  Undo works as in the part document (whole JSON snapshots).
- *Entities* (`js/assembly/geometry.js`): a picked face or edge becomes a
  plane (`o`, `n`), a cylinder (axis `o`, `d`, radius `r`), a circle (centre,
  axis, radius; the axis points out of the flat face the edge closes, which
  is what makes Insert's "opposed" mean "faces together") or a line, in the
  part's own coordinates, plus `pick: { type, body, index }`. When a part
  changes (Refresh, or on open) `matchEntity()` finds each one again: same
  kind, same direction, nearest position and radius, preferring the same
  index.
- *Solver* (`js/assembly/solver.js`): each constraint is a list of
  residuals (mm; directions times a length scale about a quarter of the
  assembly's size). Levenberg-Marquardt over six unknowns per free
  component (a rotation vector about its middle and a shift), Jacobian by
  finite differences, starting from where the components are, so they move
  as little as needed. Two faces that must face each other but start facing
  the same way sit on a saddle the solver cannot leave, so when it stalls it
  retries with each free component turned over about each of its axes (the
  upright pin that must go into a hole from above). Dragging adds a weak
  pull towards the pointer's placement (the constraints weigh a thousand
  times more), then a pass with the constraints alone. `freedom()` counts
  each component's degrees of freedom as six minus the rank of its
  constraints' Jacobian; `unsatisfied()` lists constraints that do not hold.
- *Kernel* (`js/kernel/assembly.js`, worker ops `partBuild`, `partDrop`,
  `asmDistance`, `asmInterference`, `asmExport`, `asmMass`, `asmMesh`): the
  worker keeps one rebuilder per part (key = session + part id) so the exact
  solids stay at hand; placed copies come from `BRepBuilderAPI_Transform`
  with a `gp_Trsf` set by `SetValues` (handles the uniform scale), the
  interference from `BRepAlgoAPI_Common` on pairs whose boxes overlap, the
  distance and closest points from `BRepExtrema_DistShapeShape`
  (`shapeDistance()` in `occt.js`, which part Measure uses too).
- *Viewport*: bodies may carry `matrix`, `color` and `group` (the component
  id). Their face and edge records are then reported in assembly
  coordinates with the part's own as `local`. Component mode
  (`setComponentMode`) picks whole groups and tints them;
  `setBodyMatrices` moves them without rebuilding (live drags and
  previews); `attachGizmo` / `detachGizmo` wrap TransformControls (vendored
  unmodified from three.js 0.185.0); `setMeasure` draws dimension lines;
  `setSection` takes a full spec.
- *Controller* (`js/assembly/assembly.js`) with its panels
  `constrain.js` and `transform.js`; `app.js` switches environments
  (`setEnv`), routes the shared commands through `activeDoc()` and hands the
  Assemble tab's commands to `assembly.command()`.
- *Backend*: still only AGI. `backend/file.agi` accepts `.aoasm`; nothing
  else on the server changed.
- *Tests*: `tests/assembly.test.mjs` (matrices, entities, every constraint
  type, drag, conflicts, degrees of freedom, the document) and
  `tests/assembly-kernel.test.mjs` (placed solids, distance with closest
  points, interference, scaled mass, STEP export read back, the sample
  assembly built, re-found, solved, and a pin turned over into its hole).

**Not built yet (in rough order of use)**

- Constraints between more than one part in a chain are solved together, but
  there are no joints (Rigid, Rotational, Slider, Cylindrical, Ball) and no
  Symmetry or Transitional constraint; Angle is undirected (0 to 180).
- No driving a constraint through a range (animation), no contact solver.
- Components cannot be patterned or mirrored, and no sub-assemblies: an
  `.aoasm` cannot be placed into another.
- No editing a part in place: Open Part opens it in a tab, and the
  assembly shows the change when its tab is shown again (14.18).
- A Place shows no ghost following the pointer (Inventor's way); the part
  lands beside the assembly instead.
- No exploded views, bill of materials or per-component material and
  density (Mass Properties uses one density for all).
- Measure has no "minimum distance with the arrow dragged along", and
  Section View planes cannot be dragged in the view (only the slider).
- The STEP export is a flat compound, not a STEP assembly structure with
  names (XCAF is not used).
- **Drawing** documents: built, see 14.17.

### 14.17 Drawing mode (built)

Asked for by the owner: "it should be able to place an assembly or parts,
create projections from different angles and create 2D drawings of the
selected faces. It should also allow the user to pick and label edges,
faces, holes, radius etc. with customizable units and prefix or suffix. The
drawing can be customized like Photoshop, like resolution or dpi, or using
preset sizes like A4, A3, and it should be able to export to open source
CAD formats and PDF. The drawing ratio should be 1:1 unless the user
configures the drawing or parts to other ratios."

**What the user gets**

- **File > New > Drawing** makes an A3 sheet at 1:1, first angle (ISO),
  with a border and a title block, and opens the Base View panel on the
  part or assembly that was open (by its file when saved, else kept inside
  the drawing). **File > Sample Drawing** shows everything at once.
- **Place Views tab.**
  - *Base View*: the panel puts the model in the 3D view. Standard
    directions (Front, Top, Right, Back, Bottom, Left) and four isometric
    ones, or any direction: turn the model or click the view cube, and OK
    takes the view as it is on screen. Hidden lines, tangent edges and
    centre marks on or off, the view's own scale (empty: the sheet's), its
    name and whether the name and scale are written under it. OK goes back
    to the sheet with the view following the pointer; a click places it.
  - *Projected View*: move round a view; the ghost says what it will be
    ("Left view", "Isometric view") and a click places it. Straight views
    line up with their parent and only slide along that line; corner views
    are isometric. Several in a row; Esc or right click ends.
  - *Face View*: the same panel with "Picked faces": clicking faces of the
    model adds or drops them, the first one turns the view to look
    straight at it, and only those faces are drawn (the 2D drawing of a
    face the owner asked for, also a cutting outline).
  - *Edit* (or double click), *Delete* (also Del; a base view takes its
    projected views and their dimensions along, after asking), *Refresh
    Models* (read the part and assembly files again, redraw every view).
  - *Sheet Setup*: preset sizes (A0 to A5, ANSI A to E, US Legal) or a
    custom one, landscape or portrait, typed in mm, cm, inches or pixels;
    the resolution (72 to 600 dpi or typed) with the pixel size it gives,
    which is the size of a PNG export; the drawing scale; first or third
    angle projection; border and margin; the title block and its fields
    (title, number, revision, company, drawn and checked by, date,
    material). Changes show on the sheet while the panel is open.
  - *Zoom All*, *Zoom In*, *Zoom Out*. On the sheet the wheel zooms at the
    pointer; the middle button (or the left one on empty paper) pans.
- **Annotate tab.**
  - *Dimension* (also the D key) works like Inventor's: a straight edge
    gives its length, or click a second edge for the angle between them
    (or the distance, when parallel), or a point for the distance to it;
    two points (ends, middles, centres) give the distance between them; a
    circle gives its diameter, an arc its radius (R / D switch). The last
    click places the text; horizontal, vertical or aligned follows the
    pointer, Space picks one. *Radius*, *Diameter*, *Angle*, *Hole Note*
    ("2x Ø12", counting the equal holes in the view, with a suffix such
    as " THRU") and *Center Mark* start the same tool limited to what they
    measure.
  - *Leader Note*: click what it points at (a point or an edge: an arrow;
    inside a view on no edge, a face: a dot, as ISO marks surfaces), then
    where the text goes, then type it. *Text*: free text on the sheet.
  - *Dimension Style*: units (mm, cm, m, in, ft), decimals, angle decimals,
    trailing zeros, the unit written after values, a prefix and a suffix
    for all dimensions, text height (3.5 mm, ISO 3098) and arrow size.
  - Double clicking a dimension edits its own prefix and suffix (radius
    and diameter start with R and the diameter sign as a prefix, which can
    be changed or cleared), units, decimals, a symmetric or +/- tolerance,
    direction and text height; a hole note its count; a note its text and
    end. Dimensions and notes are dragged by their text; the line of a
    linear dimension follows.
- **Values are always true model sizes**: a dimension measures the model,
  not the paper, so a 1:2 view still says 80 for 80 mm.
- **Export** (File > Export in a drawing): PDF (vector, the sheet's true
  size, prints 1:1), DXF (release 12, read by LibreCAD, QCAD, FreeCAD and
  every commercial CAD, in sheet millimetres), SVG, and PNG at the sheet's
  resolution with that resolution stored in the file.

**How it is built**

- *Document* (`js/drawing/document.js`, `.aodrw` JSON): `sheet`, `style`,
  `sources` (models by path, or kept inside), `views` (a base view has
  `dir` and `xdir`; a projected view has `parent` and `rel`, its direction
  is worked out from the parent each time, so editing the base view turns
  the others with it), `annotations`. Points of an annotation are in its
  view's own coordinates (model mm on the paper plane), so it moves and
  scales with the view.
- *Kernel* (`js/kernel/drawing.js`, worker op `drwProject`): the parts are
  built per drawing with the same per-part rebuilders the assembly uses
  (`partBuild`, keys `drw...`; `partDrop` now takes a key prefix so the
  assembly and the drawing never drop each other's). `HLRBRep_Algo` with
  an `HLRAlgo_Projector` on a `gp_Ax2(origin, dir, xdir)`; the result
  compounds give visible / hidden sharp, tangent ("Rg1") and outline
  edges. This build has no `Handle_HLRBRep_Algo`: `HLRBRep_HLRToShape`
  takes the algorithm itself and frees it with itself (delete only the
  HLRToShape). Faces alone: `itemShape()` faces in a compound.
- *Clean-up* (`js/drawing/geometry2d.js`): the remover cuts curves into many
  pieces where visibility changes or curves overlap (the sample's cross
  hole: 539 raw pieces, 39 clean edges). Pieces are joined where they run
  on smoothly, straight polylines become lines, circles are found by a
  fit (a hole through a curved wall projects to a circle the kernel only
  knows as a 3D curve), pieces lying on a circle already there are dropped.
  It also answers hit tests and snap points (ends, middles, centres).
- *Layout* (`js/drawing/layout.js`): the sheet as plain primitives (line,
  poly, circle, arc, fill, text) on layers with ISO 128 weights and dash
  patterns. The screen and every export draw these same primitives:
  `js/io/drawsvg.js`, `pdf.js` (own writer, Helvetica so no font is
  embedded; text outside Latin-1 is drawn by the browser into a 1-bit
  image), `dxf.js`, `png.js` (canvas plus a pHYs chunk). Text widths come
  from Helvetica's metrics (`font.js`) so centring matches everywhere.
- *Sheet* (`js/drawing/sheet.js`): presets, units, scales ("3:4" for 0.75),
  orientations and the projection rule. First angle mirrors third angle
  for side and corner views alike; changing the rule in Sheet Setup
  swaps the side of placed views so they keep their direction.
- *Interface*: `editor.js` (the SVG sheet: camera, picking, dragging,
  overlays), `tools.js` (Dimension, notes, text, projected views,
  placement), `browser.js` (sheet, models, views), `drawing.js` (the
  controller and its four panels). `panel.js` gained text, multi-line and
  select rows, hideable sections and `unit()` / `items()`. The ribbon's
  `mode` may be a list (Export, Inspect and View are part and assembly
  only).
- *Backend*: still only AGI; `file.agi` accepts `aodrw`, `pdf`, `dxf`,
  `svg`, `png`; `init.agi` registers `.aodrw`.
- *Tests*: `tests/drawing.test.mjs` (sheets, scales, view directions,
  the projection rule, dimension text, edge clean-up, the document, the
  layout of every annotation type, the SVG, PDF and DXF writers and the
  PNG resolution chunk) and `tests/drawing-kernel.test.mjs` (real
  projections: a block's views, hidden hole walls, a placed component,
  a face alone, the whole sample drawing with every dimension on its
  geometry, written to PDF and DXF).

**Not built yet (in rough order of use)**

- Section views and detail views on the sheet (a cut plane drawn as a
  line, hatching), break views, crop.
- Dimensions are not associative: they keep their points when the model
  changes, and turn purple when those points are no longer on an edge
  (re-pick them). Ordinate and baseline dimensions, chamfer notes,
  surface finish and weld symbols, datum and geometric tolerance frames.
- Balloons and a parts list for assembly drawings; several sheets in one
  drawing; title block templates; borders with zone letters.
- DXF of a scaled view at model size (today the DXF is the sheet as drawn,
  which is the model size at 1:1); DWG; DXF dimensions as DIMENSION
  entities (they are lines, arrows and texts).
- The PDF is uncompressed (a sheet is tens of kilobytes; very detailed
  models make larger files).
- Views are drawn one after the other in the worker; a large assembly
  takes seconds per view, with "projecting..." shown meanwhile.

### 14.18 Document tabs, orbit mark, ribbon fit (built)

Asked for by the owner after trying assembly and drawing mode: (1) a mark
over the model while the Orbit tool is on, like Inventor's orbit circle;
(2) ribbon labels that overflowed their buttons in the assembly and
drawing tabs; (3) "tabs so I can quickly switch between different parts,
assemblies or drawing sheets, and the drawing or assembly updated
automatically if a part is updated while the linking assembly or drawing
is open".

- **Orbit mark**: `drawOrbitMark()` in `app.js` draws `#orbit-mark` (an
  SVG over the stage, no pointer events) while `state.leftDrag` is
  `orbit`: a circle of 37 % of the shorter side, ticks at the quarters, a
  centre cross; redrawn when the stage resizes. It is SVG, so it is shown
  and hidden with the `hidden` attribute (an SVG element has no `hidden`
  property).
- **Ribbon**: every two-line big button overflowed by 3 px. Big buttons
  now fit a 26 px icon and two 13 px lines in their 63 px, the label is
  clamped to two lines (`-webkit-line-clamp`), and "Kernel Self-test"
  keeps its hyphen (a non-breaking one). Checked by measuring every button
  of every tab, assembly and drawing ones included, at 1280 x 800.
- **Tabs** (`js/tabs.js` draws the strip under the view; `app.js` holds
  `tabs`, `activeTab`, `openTab`, `switchTo`, `closeTab`, `removeTab`):
  - Each environment still shows one document. The others are kept in
    their tab as a snapshot: `doc.snapshot()` / `doc.restore(snap)` on all
    three document kinds keep the data, the undo and redo history, the
    saved state, the name and the path; `restore` is a reason of its own
    for the change listeners ("the same document again", unlike `reset`).
    The view goes with it (`viewport.viewState()` / `setViewState()`, the
    sheet's `drawing.viewState()`).
  - Each tab has its own key space in the kernel, so a tab shown again
    finds its work cached: part tabs a rebuilder each (worker ops
    `useRebuilder` / `dropRebuilder`, keys `part:<tab>`), assemblies and
    drawings their parts under `asm:<tab>/` and `drw:<tab>/` (dropped with
    the tab through `partDrop`'s prefix), drawings their projections per
    tab. A drawing view is only projected again when its model's contents
    changed (the model's fingerprint is part of the view's signature).
  - New, Open, the samples and Open Part open a tab; a file already open
    shows its tab; an empty untouched document gives its place. Closing a
    changed tab asks to save; closing the last one leaves an empty part;
    closing the window lists the changed tabs.
  - **Live link**: `files.readPath` asks `setOpenDocuments`' lookup first,
    so a document open in a tab is read as it is there, unsaved edits
    included. Assemblies and drawings read their parts again whenever
    their tab is shown (cheap: the kernel's caches answer), so an edit made
    in a part's tab is in the assembly or drawing as soon as its tab is
    clicked. A part changed in another window still needs saving there
    and Refresh here.
  - Opening an assembly no longer marks it changed by itself: finding the
    constraint faces again only writes values that really moved, and an
    assembly that was clean stays clean unless a component moved.
  - **Rule learnt from a bug the owner hit**: a controller that is not
    shown must not touch the shared viewport. Every tab switch put the
    assembly's tools away, which turned component picking on in a part:
    faces and edges stopped reacting (Fillet, Start 2D Sketch) and hovering
    threw in `describe()`. Now `assembly.stopTools()` and `setTool()` act
    only while the assembly is shown, `leaveDocument()` only stops the
    tools of the environment on show, and `enter()` turns component
    picking off for parts and drawings.
- *Tests*: `tests/tabs.test.mjs` (snapshot and restore of every document
  kind with their history, tab names, reads of open documents).
- *Not built*: dragging tabs to reorder them or out into windows; a split
  view of two documents; a live link between windows.

### 14.19 Appearance, previews in every visual style, hidden edge picking (built)

Asked for by the owner: Wireframe could not be set while Fillet was open,
and a Chamfer preview turned a wireframe model solid ("maintain the mesh
visual style during the preview"); picking hidden edges in the Wireframe
and "hidden edges" styles; "a basic texture tool: pick a colour and a
texture of the part".

- **Previews follow the visual style**: a Fillet / Chamfer / Shell result
  preview is a separate mesh (the real body turns into a faint ghost), and
  `applyVisualStyle()` only knew the bodies. The preview objects now carry
  a role (`result-solid`, `result-lines`, `result-hidden`, the last a faint
  copy of the edges drawn through the model) and the style shows or hides
  them like the body's own, also when the style changes with the panel
  open. The result keeps the part's appearance (`bodyMaterial.clone()`).
- **Hidden edges**: in Wireframe and Shaded with Hidden Edges an edge
  behind the model can be picked where it is drawn. A visible edge still
  comes first; a hidden one wins over the face in front only within half
  the usual pick distance, so faces stay easy to pick (`itemUnderPointer`
  in `viewport.js`).
- **Appearance** (`js/appearance.js`, the panel `js/features/appearance.js`,
  View > Appearance in a part): a colour and one of ten finishes, saved in
  the part as `appearance: { color, texture, scale }` (left out for the
  default grey, so old parts are unchanged). Finishes set roughness and
  metalness; glass is see through; five have a pattern drawn on a canvas
  in code (brushed streaks, cast speckle, wood rings, carbon twill, rubber
  grain; no image files), laid on by box projection (`addUVs()` gives the
  meshes texture coordinates in mm, one tile per pattern size). Metals
  reflect a small studio environment made once with the PMREM generator
  (a grey room with bright panels), given only to the metal finishes so
  the default look is as before. The part on show uses the shared body
  material (`viewport.setAppearance`); assembly components and the
  drawing panel's 3D view give each body its own (`appearance` on the
  body record: the part's finish, the component's colour).
- *Tests*: `tests/appearance.test.mjs` (finishes, clean records, the part
  document keeping them, patterns drawn the same every time).
- *Not built*: per-face colours; image textures of your own; appearance
  in the exports (3MF colours, coloured OBJ) and in drawings (they print
  black on white by design); an appearance per component in an assembly
  other than its colour.

### 14.20 Sketch input: axis snapping, value boxes, editing in Dimension mode (built)

Asked for by the owner with Inventor screenshots: lines close to level or
upright snap to it; clicking a dimension while the Dimension tool is on
edits it; size boxes while a shape is drawn (a slot's centre line with its
length and, when not level or upright, its angle; then the diameter of its
ends).

- **Axis snapping** (`snapAt` in `sketcher.js`): from a tool's anchor point
  a stroke within 3 degrees of level or upright (`ANGLE_SNAP`), or within
  the old few pixels, snaps to it; the Line tool then adds Horizontal or
  Vertical. The Slot tool now has an anchor too and adds Horizontal or
  Vertical between its centres.
- **Value boxes**: `ctx.fields()` takes `{ label, unit }` and the new
  `ctx.live([{ value, at, hide }])` says what each box shows until a size is
  typed and where on the sketch plane it sits (`showFields` places it,
  falls back beside the pointer). The active box (Tab moves on) has an
  accent border; typed text replaces the live value. Line: length beside
  it, away from the angle, and the angle at its start; rectangle: width
  and height outside two sides; circle: diameter just outside it; slot:
  length and angle of the centre line (drawn dashed), then the diameter
  past the far end. `ctx.typedValue()` reads a box of any sign (an angle of
  0 or below).
- **Angle to the X axis**: a new dimension `axisangle` (points `a`, `b`;
  planegcs `p2p_angle`, the direction from a to b measured from the
  sketch X axis), drawn as an arc from a dashed reference along X. A typed
  angle that is level or upright becomes Horizontal / Vertical instead.
  The value editor takes it with its sign.
- **Dimension mode**: a click on a dimension's value opens its editor (the
  Dimension tool hands `hit.kind === "dim"` to `ctx.editDimension`).
- *Tests*: `tests/sketch-input.test.mjs` (typed length and angle of a line
  and kept by the solver, a typed 90 degrees, the slot's three sizes, a
  level slot, a click on a dimension in Dimension mode).
- *Not built*: value boxes for the arcs, polygon and fillet tools beyond
  what they had (a radius or a count in the strip beside the pointer).

### 14.21 Missing parts, relative links (built)

Asked for by the owner: when an assembly is opened and some parts are not
where it says, a dialog lists them with Select File to relink them;
links are saved relative to the assembly unless the part is under another
root (user:/ against storage:/) or the assembly is not saved yet; the
first save turns existing absolute links relative.

- **Paths** (`js/io/paths.js`): `relativeTo(file, target)` (relative under
  the same root, else the absolute path) and `resolveFrom(file, link)`.
  While an assembly or a drawing is open its links are absolute: they are
  resolved in `doc.reset` from the file's own path, and written relative
  again by `doc.serializeFor(target)` for the place the file is written to
  (`files.save` takes the text as a function of that place), so Save As to
  another folder keeps them right and a first save makes them relative.
  A download (no ArozOS) keeps them absolute. An assembly a drawing shows
  resolves its part links from its own file (`resolvePartPaths`).
- **Missing Files dialog** (`js/io/relink.js`, shared): one row per file
  that cannot be read, Select File (parts: `files.openPartFile`; a
  drawing's models: `files.openModel`), and after each pick the other
  missing files are tried under their old names in the picked folder.
  Skip leaves them with a warning; Relink Part / Relink Model in the
  browser's right click menu brings it back. Shown once when the document
  is opened, not when its tab is shown again. A relink is an undo step; a
  part picked outside ArozOS is kept inside the assembly.
- Read failures are marked as broken links (`err.link`), so a part that
  reads but does not build is not offered for relinking.
- **A part whose link changes is loaded again** (undo or redo of a
  relink): each loaded part remembers where its entry pointed
  (`linkKey`), and `render()` drops the parts whose entry points
  elsewhere now. Found while testing: undo showed the relinked part still.
- *Tests*: `tests/paths.test.mjs` (relative and back, other roots, the
  drive root, an assembly absolute while open and relative where saved,
  Save As elsewhere, a first save, a drawing's models).

## 15. Handoff

This section is for the model or person who continues the work (the earlier
sessions were done by Claude Fable; the next ones are expected to be Claude
Opus or Sonnet). Read sections 1, 2, 6 and 13 for the design and the
owner's decisions, section 14 for what to build, and this section for how.

### 15.1 Where the work stands

| Milestone | State | Notes |
|---|---|---|
| M0 scaffold | done | |
| M1 document, rebuild, picking, files | done | AGI file script and the desktop integration verified on a live server |
| M2 sketcher | done | Gaps listed in 14.3 |
| M3 extrude, sketch on face, projection, work plane | done | Offset work planes only |
| M4 hole, fillet, chamfer | done, without history based references | Edges are remembered by midpoint and length and fail loudly when moved (14.5) |
| M5 section views, measure, mass properties | done in a first form | Section planes fixed through the middle; Measure answers in a dialog (14.10) |
| M6 import and export | done | Export STEP, BREP, STL, OBJ, 3MF; import STEP |
| M7 touch, localisation, README | not started | 14.12 |

Done in the last session, after the table above was first written:

- **Live preview of Fillet and Chamfer.** `tryFeature` in `worker.js`
  returns the meshes of the bodies as they would become, with the index
  ranges of the faces the feature makes (`freshFaces()` in `occt.js`, from
  the maker's `Modified()` history); `edges.js` shows them with
  `viewport.setPreview(meshes, 'result')`: the body in its own colour, the
  new rounds or bevels in green, the real body as a pickable ghost. Test:
  `tests/preview-faces.test.mjs`.
- **Fillet / Chamfer pick the whole tangent chain**, as the kernel builds
  it: `edgeChains()` in `occt.js` asks OpenCascade's own fillet builder
  which edges it carries the feature along (rounded outlines), the panel
  sends them to `viewport.setEdgeChains()`, and hover, selection and the
  edge count ("8 edges in 1 tangent chain") use them; a click anywhere on a
  picked chain drops it. Hidden parts of a highlighted edge are drawn faint.
  Test: `tests/chains.test.mjs`.
- **Sketcher, phase A2 part one**: see the note at the top of 14.3.
- **Revolve** (14.4) and **references that follow edits** (14.5, first step).
- **Shell, Rectangular and Circular Pattern, Mirror** (14.6).
- **Sketch Polygon, Slot, Mirror and driven dimensions** (14.3).
- **Walkthrough**: a part (plate with a hole, a boss on the face, rounded
  corners, holes on the corner centres, a chamfer, then the boss and the
  plate edited) was built through the interface in headless Chrome to
  find what gets in the way. Fixed from it: a grid in the sketch, the
  first solid brought into view, the name of an origin plane or face shown
  while picking a plane, the Point tool on a projected point (a hole on
  the centre of a rounded corner), and the two reference failures above.
  Noted, not changed: the feature panel covers the left of the view (as in
  Inventor); ArozOS serves WebApp files without a Cache-Control header, so
  a browser can keep old modules after an update (a server change, to be
  decided by the owner).
- **Selection feedback** (owner's request after trying the previews):
  hovered model edges are a 4 px orange line, selected ones a 3 px blue
  line; sketch points under the pointer (also inside Coincident and the
  other constraint tools) are filled and drawn larger, selected points
  too (a CSS specificity slip had hidden both). Over anything that can be
  picked the cursor is the arrow, even while Orbit or Pan has the left
  button (`restCursor()` in `viewport.js`).
- **Mouse wheel on size boxes**: `wheelStep()` in `js/ui.js`, used by every
  number row of `panel.js`, the Extrude distances and the sketch dimension
  editor. One notch is 0.5 (landing on whole steps), a size never reaches
  zero, a row can set `max` (countersink angle 179.5) and `step`. Test:
  `tests/wheel.test.mjs`. In the dimension editor the wheel changes the box
  and Enter applies it.
- **Plane normals of chamfer faces** were reported pointing into the
  material (the bevel's plane has a left handed frame); `faceInfo()` now
  asks `gp_Pln.Direct()`. This matters for sketches and work planes placed
  on a chamfer face.
- **Chamfer after fillet** no longer produces a broken solid: `isSound()` in
  `occt.js` (BRepCheck_Analyzer plus "every face meshes") rejects results
  that OpenCascade reports as done but are invalid. Test:
  `tests/chamfer-after-fillet.test.mjs`.
- **Mouse mapping as in Inventor** (answer 13.3), with Orbit and Pan buttons
  on the navigation bar under the view cube, F4 held to orbit, Esc to give
  the left button back. Needs a real mouse check (14.2).
- **STEP association** (answer 13.6): `init.agi` lists `.step` and `.stp`;
  a STEP file opened with the app becomes a new part with one Imported
  feature. Needs a live server check (14.2).
- **Owner's checklist** at the top of this file: what was built but needs a
  person (real mouse, live server, other browsers) to try.
- **Assembly mode** (owner's request, 14.16): File > New offers Part,
  Assembly and a greyed Drawing; the Assemble tab places parts, drags and
  turns them (Free Move, Free Rotate), has a Move Rotate Scale panel with a
  triad, and Mate / Flush / Angle / Tangent / Insert constraints solved live;
  Analyze Interference, Degrees of Freedom, assembly Mass Properties and
  export. Measure and Section View became panels shared by both modes
  (Measure draws its dimension line in the view; Section View has a plane,
  a position slider and a side). Tried in the browser pane on the static
  preview: the sample assembly, Free Move along the one freedom left, the
  triad and typed values (refused values go back to the real ones), a new
  Flush with an offset, Place (a file fed to the browser picker), Insert of
  an upright shaft that the solver turns over into a hole, Measure, Half and
  Three Quarter sections, Isolate / Show All, undo, Save and STEP export
  (4 solids). Not tried: the ArozOS file selector for Place, Open Part in a
  new window, Refresh Parts after editing a part file (needs a live server).
  Fixed along the way: big ribbon buttons with a menu drew their arrow
  28 px tall, over the group name (an older slip, also in part mode).
- **Drawing mode** (owner's request, 14.17): base, projected and face
  views, dimensions, notes, Sheet Setup, Dimension Style, PDF / DXF / SVG /
  PNG export, File > Sample Drawing. Tried in the browser pane on the
  static preview: the sample drawing, a length dimension on an edge, the
  distance between two parallel edges, editing a dimension (prefix,
  suffix, inches, decimals, tolerance), dragging a base view (its
  projected views follow) and a projected view (it stays lined up), a
  Base View of the assembly at 1:2, a Face View of the plate's top face,
  New > Drawing from an open part with three projected views, Sheet Setup
  in pixels at 150 dpi, a leader note on a face, all four exports (the PDF
  opened in Chrome's viewer, the PNG checked at 300 dpi), Save and reopen.
  Fixed along the way: moving views and notes was thrown away at the end
  of the drag; snap points took clicks meant for the edge beside them;
  edges were pickable while faces were being picked. Not tried: the ArozOS
  file selector and the exports on a live server; the DXF in a real CAD
  program (installing a DXF checker was not allowed in this session).
- **Document tabs, orbit mark, ribbon fit** (owner's requests, 14.18).
  Tried in the browser pane: three samples in three tabs, a part tab kept
  in its top view across a switch, an assembly whose pin is a file (a fake
  file script stood in for ArozOS in the page) with Open Part opening the
  pin in a tab, the pin's shaft suppressed there without saving and the
  assembly and a new drawing of it showing the change at once, the undo
  in the pin's tab brought back into the drawing, an unchanged drawing
  shown again without projecting anything, and closing tabs (a changed
  one asks, the last one leaves an empty part). The orbit mark and the
  ribbon were checked at 1280 x 800. Not tried: a live server (the real
  file selector, Open Part reading a real file).
- **Fix found by the owner**: after tabs came in, faces and edges of a part
  stopped reacting and hovering threw (14.18, the rule about controllers
  that are not shown).
- **Appearance, previews in every visual style, hidden edge picking**
  (owner's requests, 14.19). Tried in the browser pane: Chamfer picked in
  Wireframe stays wireframe and follows the style switched with the panel
  open; a hidden cross-hole edge picked in Wireframe; hover over the
  sample in "hidden edges" picks hidden edges only near them; plain,
  wood, brushed metal and carbon fibre on the sample part, OK, undo, redo
  and the look saved in the file. Not tried: the finish on assembly
  components and in the drawing panel (the code passes it; no sample
  part has one).
- **Sketch input** (owner's requests, 14.20): axis snapping by angle,
  Inventor-style value boxes while drawing, a typed angle to the X axis
  kept as a dimension, editing a dimension by clicking it in Dimension
  mode. Tried in the browser pane: a line 2 degrees off level snapped
  level; one 10 degrees off showed its length and angle boxes; 50, Tab,
  30, Enter made a line of 50 at 30 degrees with both dimensions; a slot
  of 40 at 15 degrees with ends 10 across, then its 40 clicked in
  Dimension mode and changed to 60, and its angle to -20.
- **Missing parts and relative links** (owner's request, 14.21). Tried in
  the browser pane with a stand-in file script answering "does not exist"
  for the old folder: the dialog alone (a pick in a new folder, the
  second part found beside it, Done); an assembly whose Pin moved, the
  dialog opening by itself, the Pin picked and both pins loaded; undo
  bringing the warning back and Relink Part in the right click menu.
  Not tried: the real ArozOS file selector and relative links read back
  from a real folder (needs a live server).

`node tests/run.mjs` passes, 27 files. **Nothing is committed**: the whole
`src/web/3D Modeler/` folder is untracked on the branch the owner works on.
Do not commit or push unless the owner asks.

### 15.2 Rules the owner set (do not break them)

1. **Backend only through AGI.** Every server side operation goes through an
   AGI script in `backend/` (today only `backend/file.agi`). If something
   truly cannot be done with AGI, stop and ask the owner before using
   anything else (Go code, a subservice, another endpoint).
2. **Self contained.** Nothing is loaded from another WebApp (not even
   3D Viewer, which ships three.js and a kernel too) or from a CDN.
   Libraries are copied into `lib/`, unmodified, with their LICENSE. Only
   the system script folder (`../script/`, e.g. `ao_module.js`,
   `applocale.js`) may be referenced.
3. **ao_module.js** for window events (title, close handler, file selector).
4. **No browser `alert` / `confirm` / `prompt`.** Use `ask()` and `tell()`
   from `js/ui.js`.
5. **No emoji** anywhere (repository rule 6). Icons are inline SVG symbols
   in `index.html` (`<symbol id="ic-...">`); add new ones there.
6. **Origin planes:** with a solid in the part, Start 2D Sketch and Look At
   offer the model's planar faces and do not show the yellow origin planes.
7. **Z-up** world (answer 13.1). Keep it in every new view or export.
8. **Single part, isolated sections allowed** (answer 13.4). A part is one
   body that may consist of several disjoint lumps; there is no list of
   separate bodies to manage. Today Extrude offers "New Solid", which keeps
   a separate body in `state.bodies`. Bring it in line when touching
   Extrude (14.4 asks to rebuild its panel anyway): drop "New Solid" from
   the Boolean row, and let a Join that does not touch the existing
   material simply add a separate lump to the same body (fuse it; OCC keeps
   both lumps in one compound / solid set). Keep reading old documents
   that contain `operation: "new"` by treating it as `join`. Mirror and
   Pattern (14.6) then only need "join". Confirm with the owner before
   removing it if in doubt.
9. **Localisation last** (`applocale.js`), when the strings are stable
   (14.12).
10. **Ask questions when useful**, with the AskUserQuestion tool, and write
    the answers into section 13.

### 15.3 How to run and test

- **Tests:** from the app folder, `node tests/run.mjs` (plain Node 20,
  nothing to install; the app's `package.json` only marks `.js` files as ES
  modules). The kernel tests load the real WASM from `lib/occt/`. Write the
  test of a new kernel or model function first, then wire the interface.
- **In a browser without ArozOS:** the repository's `.claude/launch.json`
  has a static server of `src/web` on port 8123 (`webroot-static`); open
  `/3D%20Modeler/index.html`. Open / Save fall back to the browser's file
  picker and a download; everything else works. The browser caches ES
  modules hard: after an edit run `fetch('<changed file>', { cache:
  'reload' })` for each changed file in the page, then reload.
  There is no global debug handle; inspect through the DOM, or import a
  module in the console (`await import('./js/...')`).
- **Conventions:** `sh scripts/check-conventions.sh <files>` from the
  repository root (a hook also runs it after every edit).
- **On a live ArozOS server** (needed for files, the desktop window, the
  file selector, the STEP association): build with
  `go build -o <scratch>/arozos.exe .` from `src/` (never build into
  `src/`, the owner runs `src/arozos.exe`), copy `src/system` without
  `ao.db*`, `logs`, `cache`, `cluster*`, `mail`, `storage.json` next to the
  binary, link or copy `src/web` in as `web`, start it on a spare port,
  register the first user through `/system/auth/register` from the browser
  pane. If `.claude/launch.json` is changed for this, restore it byte for
  byte afterwards.
- **Patching files:** the files are LF. If a script writes them, write to a
  `.tmp` and rename, with `newline=''` in Python, or Windows turns LF into
  CRLF.

### 15.4 How the pieces fit

```
index.html          ribbon host, browser, viewport, panels, SVG icon symbols
css/style.css       one style sheet, colour tokens on body / body.dark
js/app.js           wiring: ribbon commands, modes, feature panels, files, keys
js/ribbon.js        the ribbon as one data table (tabs > groups > buttons)
js/browser.js       model browser (tree) built from the document
js/ui.js            ask(), tell(), menus, small DOM helpers
js/tabs.js          the document tab strip under the view (14.18)
js/expr.js          formula evaluation of size boxes
js/viewport.js      three.js view: bodies, picking, overlays, preview,
                    sections, view cube, work planes, sketches in 3D
js/document/        document.js (feature list, undo, names, dependents),
                    sample.js (File > Sample Part), sampleasm.js (File >
                    Sample Assembly, parts kept inside the file),
                    sampledrw.js (File > Sample Drawing)
js/kernel/          client.js (main thread side of the worker),
                    worker.js (operations), rebuild.js (replay + cache),
                    occt.js (every OpenCascade call), profile.js (plane frames),
                    assembly.js (placed copies, interference, export),
                    drawing.js (hidden line projection of drawing views)
js/sketch/          model.js (data + solver translation), sketcher.js
                    (controller), tools.js (one state machine per tool),
                    render.js, geom.js, trim.js, project.js, solver.js
js/features/        panel.js (property panel builder), extrude.js, edges.js
                    (fillet + chamfer), hole.js, plane.js (work plane),
                    appearance.js (the Appearance panel, 14.19)
js/appearance.js    finishes, appearance records, canvas patterns (14.19)
js/assembly/        assembly mode (14.16): assembly.js (controller),
                    document.js (.aoasm), geometry.js (matrices, entities),
                    solver.js (constraints), browser.js, constrain.js and
                    transform.js (panels)
js/inspect/         measure.js and section.js, panels both modes share
js/drawing/         drawing mode (14.17): drawing.js (controller, panels),
                    document.js (.aodrw), sheet.js (sizes, scales,
                    directions), geometry2d.js (edge clean-up, picking),
                    layout.js (sheet -> primitives), format.js (dimension
                    text), font.js (Helvetica widths), editor.js (the SVG
                    sheet), tools.js (dimension, note, text, projected,
                    place), browser.js
js/io/              files.js (AGI open / save / export, browser fallback),
                    exchange.js (STL, OBJ, 3MF writers), drawsvg.js,
                    pdf.js, dxf.js, png.js (drawing writers)
backend/file.agi    the only server script: ping, read, readBinary, write,
                    writeBinary; extension whitelist; 48 MB limit
lib/                occt (OpenCascade WASM), planegcs, three (r185)
tests/              run.mjs + one file per area
```

The data flow: every change goes through `doc.change(label, fn)` (one undo
step) -> `app.js` calls `kernel.call('rebuild', { document })` -> the worker
replays features through `applyFeature` in `rebuild.js`, reusing cached
shapes up to the first changed feature -> `describe()` turns each body into
a mesh with an index range per face plus exact edges -> `viewport.setBodies`.
Faces and edges are identified by their index in that description; feature
references store positions (`mid` + `length`) until 14.5 lands.

### 15.5 Recipe: adding a feature type

Take Fillet / Chamfer (`edges.js`) or Hole (`hole.js`) as the model, not
Extrude (older, own panel code).

1. **Kernel** (`js/kernel/occt.js`): a `xxxTool()` that builds the tool
   shape and a `xxx(oc, bodies, feature, ...)` that applies it and returns
   the new bodies. Run the result through `isSound()`. Throw an `Error` with
   a sentence the user can act on. `.delete()` every embind object you
   create that is not returned.
2. **Test** it in `tests/` (volume, bounding box, failure message).
3. **Rebuild** (`js/kernel/rebuild.js`): a `case 'xxx'` in `applyFeature`.
   If the feature depends on a sketch or plane, make sure
   `doc.dependents()` in `document.js` follows it, so delete and edit
   behave.
4. **Worker** (`js/kernel/worker.js`): `tryFeature` already dispatches on
   `feature.type` through `kernel[feature.type]`; add a `preview` branch if
   the preview is a tool (as for Hole) rather than the result.
5. **Document** (`js/document/document.js`): add the type to `TYPE_NAMES`;
   icon in `FEATURE_ICONS` (`js/browser.js`) and a `<symbol>` in
   `index.html`.
6. **Panel** (`js/features/xxx.js`): built with `createPanel()` from
   `panel.js`; exports `start(featureId, preselected)`, `isOpen()`,
   `cancel()`, `handleKey(event)` and calls `options.onClose(committed)`.
   Commit through `doc.change`, new names from `doc.newName(type)`.
7. **App** (`js/app.js`): add it to `featureTools` and `FEATURE_HINTS`;
   `featureButton()` maps the kind to its ribbon id; in `startFeature()`
   decide whether model picking is on for it.
8. **Ribbon** (`js/ribbon.js`): remove `planned` from the button and add
   `toggle: true`.
9. Section 2 of this proposal: move the item from the known limits to what
   works; tick it off in 14.

### 15.6 Kernel notes (save yourself the probing)

The kernel is `replicad-opencascadejs@1.2.1`, single thread build, vendored
in `lib/occt/`. Its type definitions are in the npm package
(`dist/replicad_single.d.ts`), not vendored: install it in a scratch folder
to read them before planning on a class.

- **Overloads are real:** `new oc.gp_Pnt(x, y, z)`,
  `new oc.BRepPrimAPI_MakeRevol(face, axis, angle, false)`.
- **Absent in this build:** `TopExp` (use `TopExp_Explorer` and `IsSame`),
  shape maps and hashing (`TopTools_*Map*`, `HashCode`), `TopoDS_Iterator`,
  `BRep_Builder` (so no BREP import), IGES, `BRepFeat`, `LocOpe_DPrism`,
  `BRepTools_History`, `BRepFilletAPI_MakeFillet2d`, `ChFi2d_*`, solid /
  face classifiers.
- **Present and useful:** `BRepPrimAPI_MakeRevol`,
  `BRepOffsetAPI_MakeThickSolid`, `MakePipe`, `MakePipeShell`,
  `ThruSections`, `DraftAngle`, `MakeOffset`, `BRepBuilderAPI_Transform`,
  `BRepBuilderAPI_Sewing`, `BRepPrimAPI_MakeHalfSpace`, `HLRBRep_*`,
  `GeomAPI_Interpolate`, `StlAPI_Reader` / `Writer`,
  `BRepAlgoAPI_Splitter`, `BRepCheck_Analyzer`,
  `BRepExtrema_DistShapeShape` (`PointOnShape1/2`), `gp_Trsf` with
  `SetMirror`, `SetRotation`, `SetScale`, `SetTranslation`, the fillet
  maker's `NbContours`, `NbEdges`, `Edge`, `NewFaces`, and `Generated`,
  `Modified`, `IsDeleted` on builders.
- **Lists:** `NCollection_List_TopoDS_Shape` must be built from a JS array;
  from a returned list only `First()`, `Last()` and `RemoveFirst()` are
  typed. Probe before relying on more.
- **Memory:** every `new oc.X` and most returned objects must be
  `.delete()`d. Leaks show up as a WASM heap that grows across rebuilds.
- **"Done" is not "valid":** fillets, chamfers, revolves crossing the
  axis, shells and drafts can report success and still produce a broken
  solid. Always pass results through `isSound()`.
- After every boolean `occt.js` runs `ShapeUpgrade_UnifySameDomain`, so
  faces from different features merge when coplanar. That is why naming by
  history alone is not possible (14.5).

### 15.7 Working with the owner

- The owner writes short messages, sometimes with Inventor screenshots as
  the reference for how a tool should look and behave. Follow Inventor's
  layout and behaviour unless told otherwise.
- Report what was tried and what was not, plainly. Items that need a real
  mouse, a tablet or a live server and could not be tried go in the
  progress note.
- When a session is about to run out, update 15.1 and the progress marks in
  section 14 so the next one can pick up.
- When M7 starts, the `README.md` replaces this proposal as the handoff
  document (14.12); keep this file as the design record.
