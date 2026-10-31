# Blocky

An original voxel sandbox game for the ArozOS desktop: generated worlds with
grassland, forest, desert and ocean biomes, survival (health, hunger,
crafting, smelting) and creative modes, day / night, rain and thunderstorms,
animals, spark circuits with pistons and rails, and an optional
realistic renderer. All textures and sounds are generated in code and
three.js is vendored in `lib/three/`, so the app loads nothing from outside
its folder.

## Files

| File | What it does |
|---|---|
| `init.agi` | Registers the module (group `Games`, float window). |
| `backend/worlds.agi` | World storage in `user:/.appdata/Blocky/worlds/<id>/`. |
| `js/main.js` | Boot, start screen with the live world preview, world list, settings, pause / death screens. |
| `js/game.js` | One running world: ticks, input to actions, weather, day cycle, saving. |
| `js/world.js` | Chunks, light propagation, block updates (water, falling sand, plants, leaf decay, furnaces), raycast, save encoding. |
| `js/worldgen.js` | Deterministic terrain, biomes, caves, ores, trees, plants. |
| `js/mesher.js` | Section meshing (smooth light + ambient occlusion) and item models. |
| `js/render.js` | three.js scene, terrain shader, sky, clouds, rain, lightning, selection, particles, held item. |
| `js/realistic.js` | Realistic graphics pipeline: shadow map, sea reflection, terrain lighting chunk, HDR post passes. |
| `js/power.js` | Spark circuits: power sources, wire levels, torches, lamps, pistons, rail shapes. |
| `js/carts.js` | Minecarts (plain, chest, furnace) following rails. |
| `js/dynlight.js` | Light from a glowing item held in hand. |
| `js/signs.js` | The text on signs: canvas planes in front of the boards. |
| `js/blocks.js` | Block / item registry, mining rules, shaped recipes and the grid matcher, smelting. |
| `js/player.js`, `js/physics.js` | Movement, collisions, survival stats. |
| `js/ui.js`, `js/icons.js` | HUD, inventory / workbench / furnace / chest / creative screens, icon sheet. |
| `js/chat.js`, `js/commands.js` | Chat line and slash commands. |
| `js/mobs.js` | Animals (models, spawning, AI, combat, drops) and bow arrows. |
| `js/textures.js` | Procedural pixel art for every tile, crack overlays and isometric icons. |
| `js/audio.js` | Web Audio synthesised sounds. |
| `js/storage.js` | AGI backend client with an IndexedDB fallback when run standalone. |

## Engine notes

- Chunks are 16 x 128 x 16, indexed `(x << 11) | (z << 7) | y`, and meshed as
  eight 16-high sections. A chunk is lit once its 8 neighbours are generated
  and meshed once its 8 neighbours are lit, so streaming generates
  `renderDistance + 2` chunks out.
- Light is sky + block light (4 bits each). Changes use the removal / refill
  flood; sky light at level 15 travels straight down without loss.
- All tiles live in one `DataArrayTexture` so mipmaps never bleed between
  tiles; the terrain shader is GLSL3 (`render.js`).
- Caves are worm tunnels (`caveSystems` / `caveWorm` / `carveCaves` in
  `worldgen.js`): 30 % of chunks start a system of 2-4 winding tunnels
  (radius 1.4-2.9, 70-130 blocks, forking, sometimes a cavern room). A chunk
  replays the cached systems of every chunk within 8 and carves the spheres
  that touch it, so tunnels are seamless across chunks. Columns at or near
  sea level are never carved near their top, keeping seas sealed.
- Trees can cross chunk borders because column height and biome come from 2D
  noise alone: every chunk re-derives its neighbours' trees and stamps the
  part inside itself.
- Random tick changes such as grass spreading or reeds growing do not mark a
  chunk as modified (`world.quiet`), so untouched chunks never enter the save.
- A grass block, when random ticked in light 9+, turns one of the dirt
  blocks around it (3 x 5 x 3, open and lit top) into grass 70 % of the time,
  so a bare dirt roof greens over in about ten game minutes.
- World rules (`world.rules`, saved with the world): `tickSpeed` (random
  ticks per section per game tick, default 3) and `fireSpread`.
- Wheat does not use random ticks: `cropTick` runs once a second over
  `chunk.crops` and adds to a per crop progress (`world.cropProgress`, saved)
  so a full grow is about 30 minutes on watered farmland (+-15 % per stage,
  half speed when dry), scaled by `tickSpeed / 3`. Crops need light 9 from
  the sky or a lamp / torch, but grow at night too.
- Liquids share one `liquidTick` (`LIQUID` table: water renews and flows 7,
  lava flows 3 and slower). Lava touching water becomes obsidian (source) or
  cobblestone. Fire is a scheduled tick that burns `FLAME_BURN` blocks and
  jumps to air beside `FLAME_CATCH` blocks unless `fireSpread` is off. Lava
  lights burnable things up to three blocks above or beside it
  (`lavaHeat`); while anything burnable is within reach it reschedules
  itself every 2-5 s, otherwise random ticks wake it again. Fire standing on
  a solid or burnable block is drawn as crossed, leaning sheets; fire held
  up only by burnable neighbours clings to their faces (and hangs under a
  burning block above) - `firePlanes` in `mesher.js`.
- Held light (`js/dynlight.js`): a torch, spark torch, lamp, lava bucket or
  other glowing item in hand floods its light from the player's head (one
  level per block, stopped by opaque blocks) into a 32 x 32 x 32 grid that
  the terrain shader samples at the cell each face looks into, in both
  render modes. It is refreshed when the player moves to another block and
  four times a second; animals, carts, items and the hand read it too. The
  world's own light is never changed.
- Doors and beds are two blocks; `world.removePartner` removes the other half
  whenever one changes, so only the broken half drops the item. A door hangs
  on the edge nearest the player who placed it; its window pixels are
  transparent (alpha tested). A door placed beside one facing the same way
  makes a double door: the pair is hinged on the outer sides (meta bit 16
  mirrors a door's hinge; a lone neighbour hinged toward the new door is
  turned round). Each face of a door picks the plain or mirrored tile from
  where its handle must be (away from the hinge) and the way that face's
  texture runs, so the handle is right from both sides; the panel's thin
  sides use a tile without a handle; and `world.setDoorOpen` opens and shuts both
  together (`world.doorPartner` finds the other door). Each bed half has a raised mattress and two legs
  at its outer end.
- Short plants (tall grass, flowers, mushrooms, saplings, dead bushes) are
  `replaceable`: placing a block, torch or liquid on them replaces them and
  drops the plant, and a hoe tills through them.
- Saved chunks are resumed (`resumeChunk`): crops re-registered, fire and
  moving liquids rescheduled.

## Crafting

The inventory has a 2 x 2 grid, a workbench a 3 x 3 grid. Recipes are shaped
(mirroring allowed) or shapeless; `matchRecipe` in `blocks.js` normalises the
grid to the bounding box of its items. A recipe whose pattern fits in 2 x 2
(`small`) also works in the inventory. The recipe book beside the grid lays a
recipe out from the inventory (shift click for as many as possible).

## Saves

A save is `JSON.stringify({encoding, data})` where `data` is the deflated
world state: player, inventory, time, spawn, dropped items, tile entities and
run-length encoded block / meta arrays of modified chunks. The backend splits
it into 3 MB parts (`data.<generation>.<index>`) and writes `meta.json` last,
so an interrupted save keeps the previous generation readable. Weather is not
restored: every session starts with clear skies.

## Commands

T opens the chat line, / opens it with a slash. Commands other than `/help`
and `/seed` need the world's cheats option (also switchable in the pause
menu): `/give`, `/tp` (`~` relative, y optional), `/time`, `/weather`,
`/gamemode`, `/difficulty`, `/setblock`, `/clear`, `/heal`, `/kill`,
`/spawnpoint`, `/tickspeed`, `/firespread` and `/gamerule randomTickSpeed |
doFireTick`.

## Wool and dyes

Sixteen coloured wools (`WOOL_COLORS` in `blocks.js`: red, orange, yellow,
chartreuse, green, spring green, cyan, capri, ultramarine, violet, purple,
magenta, rose, light gray, dark gray, black) plus white wool. A dye and a
white wool make a coloured wool. Base dyes come from red, yellow and blue
flowers, leaves (green) and coal (black); bone meal lightens a dye (capri,
rose, the grays) and the others are mixed from two dyes on the grid.

## Glass panes and iron bars

Six glass make 16 panes; six iron ingots make 16 iron bars, which share the
pane shape with a see-through bar texture. Panes and bars join each other. A pane is a thin post that grows arms toward
neighbouring panes and solid blocks (`paneLinks` in `shapes.js`); its
collision and selection boxes follow the arms. Iron bars link the same way but are
modelled as solid metal (`ironBars` in `mesher.js`, tile `iron_bar_metal`):
a 2 x 2 post on its own, and toward each linked side a half panel 2 px deep
with rails at the top and bottom, a bar in its middle and a half bar on the
edge that meets the neighbour's into a whole one. The flat `iron_bars` tile
is only the item icon.

## Spark circuits

`js/power.js`, Blocky's own take on wiring. Spark ore (deep underground)
drops spark dust, which is laid as wire. Everything that carries a signal
is red (ore, dust, wire, torches, the block, the powered rail stripe) so it
never looks like an ordinary torch. Sources: levers (toggle), buttons (20
ticks), pressure plates, spark torches and spark blocks. A wire carries level 15 from a
source and loses 1 per block (`updateWires`, a relaxation over the wire
network). A powered block powers what touches it: lamps light up, a spark
torch on a powered block turns off (an inverter), pistons push up to 12
blocks (sticky pistons pull one back), powered rails boost carts. An
extending piston shoves the player, animals and dropped items out of the
head and the blocks it moved (`Game.pistonPush`, called through
`world.onPistonPush`): their box is tested against each moved box swept
back over the cell it came from and placed just past its far face, or, with
no room there (a wall), moved as far as collisions allow; the player also
gets a 5 blocks/s shove. Parts react
through scheduled ticks two game ticks later. `POWER` flags each block: 1
wire, 2 source, 4 reacts, 8 rail. Lever and button meta is the face they are
attached to plus bit 8 for on / pressed; a pressed button's release time is
kept in `world.buttonDue`, so other updates cannot let it go early.

Pressure plates (two planks or two stone in a row) lie on a solid block;
meta 1 while pressed. `Game.pressPlates` runs every game tick: the player
and animals press both kinds, dropped items only wooden ones. Each press
sets the plate's release time 20 ticks ahead in `world.buttonDue`, so a
plate lets go a second after the last thing leaves it. A pressed plate
powers the wire beside it, the block under it and whatever touches it.

Doors react to power too: when power arrives at either half the door
opens, when it goes the door shuts, and in between it can still be opened
by hand (`world.doorPowered` remembers which doors are held by power; it is
not saved, so after loading a door just follows the next change). A double
door shares its power: either door powered opens both.

Retimers (two spark torches and a spark dust over three stone) repeat a
signal one way, in the direction the player faced when placing them, after
1-4 steps of 2 ticks; right click cycles the delay. `B.RETIMER` and
`B.RETIMER_ON` (lit) share meta: bits 0-1 facing (`HDIR`), bits 2-3 steps -
1. The input is the block behind (wire, source, a powered block or another
retimer pointing in); a lit retimer powers the block in front strongly and
nothing at its sides. Wire is drawn joining a retimer only at its back and
front; a wire beside it neither branches into its side nor runs on into it
(`wire` in `mesher.js`). Changes on their way wait in `world.retimerDue`, so a
pulse shorter than the delay is stretched to it.

## Rails and carts

Rails shape themselves (`railPlaced` / `shapeRail`): straight, rising toward
a neighbour one block up, or curved between two neighbours. A new rail joins
neighbours that already lead into it first, then ones with a free end; a
rail joined at both ends is never bent, so a track passing beside another
is left alone. Two lines laid side by side close into one loop, in any
order: the ends join into a U-turn of two curves, and a new rail just past
one of them (`openUTurn`) straightens both, so the loop grows with the
lines. A cart entering another rail block carries on away from the end it
came in by, which takes it through the right angle where the two curves
of a U-turn meet.

Switches (`railSwitch`): a plain rail with rails on three sides is a
junction. The two opposite sides are the through line, the third is the
stem. Power (a lever or button beside it, wire, a powered block) sends the
stem the other way along the through line; taking the power away sends it
back. A junction laid as a straight through line bends onto the stem's
first branch when powered and straightens again after. Meta bit 16 marks a
switched rail, bit 32 one that was straight before; the shape stays in
bits 0-3, which everything else reads with `& 15`. Powered rails
(on a powered block or next to a source; power runs along up to 8 connected
powered rails) speed carts up. Unpowered ones are brakes. How far a cart
rolls depends on its load (`Carts.loadOf`, `LOAD_*` in `carts.js`): reaching
full speed (8) it cruises for a while, then slows at a steady rate; brakes
are a much stronger steady deceleration that also holds it on a slope or
against a furnace cart's push. Both come after anything pushing, so the
stopping distance grows with the speed. From full speed on level track:

| Load | Stops on plain rails | Full speed for | Stops on brakes |
| --- | --- | --- | --- |
| Ridden | 309 blocks | 176 | 1.5 |
| Empty (also furnace carts) | 165 | 65 | 1 |
| Chest cart, 5 stacks | 101 | 45 | 1.5 |
| Chest cart, full | 40 | 0 | 1 |

A chest cart in between is interpolated by how many stacks fill its slots.
`js/carts.js`:
place a cart on a rail; right click to ride (Shift gets out), a chest cart
to open its 27 slots, a furnace cart with fuel to drive it away from you
(coal lasts 3 minutes) - it pushes the carts in front of it. Carts keep their
speed through curves and onto slopes, roll downhill, bump into each other,
are saved with the world. At the end of a track a cart stops against a
block (a buffer) but rolls on into open space: off the rails it keeps its
speed through the air and falls (`c.air`), a block in its way stops it
sideways but not its fall, on the ground it slides to a stop, and it lands
back on any rail it comes down onto. A player walking into a cart on an
unpowered powered rail pushes it at a slow pace (`BRAKE_PUSH`, 1.5
blocks/s, also up a slope); the cart holds them back to that pace, so they
lean on it instead of walking through. The model tilts
with the slope it is on (`pose`, from the rail direction kept by `step`).
Two hits break a cart (one in creative); a cart takes the click over the
rail under it, whose box can stick out in front of a cart sitting in a dip.

## Realistic graphics

Settings > Realistic Graphics. `js/realistic.js` with `render.js`:

- **Shadows**: a 2048 (4096 on big GPUs) depth map from the sun, or the
  moon at night, covering 72 blocks around the camera and snapped to whole
  texels. Chunk meshes, animals, carts and items are on layer 1 and drawn
  into it with `scene.overrideMaterial` (alpha tested, so leaves cast dappled
  shadows); 4 x 4 PCF in the terrain shader. The sun's path is tilted
  (`SUN_TILT`) so shadows are not all axis aligned.
- **Terrain shader**: the materials get the `REALISTIC` define. Lighting is
  done in linear space: the baked face shade is divided back out (face
  normal from `dFdx` / `dFdy`), then sun x shadow, sky ambient, ground
  bounce and warm block light. Leaves and plants wave (`WAVE_GLSL`, also in
  the shadow pass) and glow when backlit. Water uses wave normals, Fresnel,
  a planar reflection of the sea (`SEA_Y`, a mirrored camera rendered at half
  size with terrain below the surface clipped) and sun glints; other water
  reflects the sky.
- **Post**: the scene is drawn into a half float target in display space.
  Light shafts march toward the sun over open sky (depth = 1; clouds write
  depth in this mode so they block them), bloom is a bright pass blurred at
  1/4 and 1/8 size, then exposure, extended Reinhard tone mapping (half per
  channel, half on luminance so skies keep their colour), grading, vignette
  and dither.
- Animals, carts, items and the held item use the standard shader;
  `Renderer.objectLight` gives them a brightness that matches this lighting.
- Turning the mode off disposes every target. It needs float render targets
  (`EXT_color_buffer_float`); without them the setting stays off.

## Stairs

Wooden, cobblestone, stone, stone brick, brick and sandstone stairs (six
blocks in a staircase pattern make four). Meta bits 0-1 are the side the
steps climb toward (away from the player who placed them), bit 2 hangs them
upside down (placed under a block or on the upper half of a side). A stair
joins the stairs beside it (`stairShape` in `shapes.js`): one behind it
turned across makes an outer corner, one in front turned across an inner
corner, unless a stair on the far side continues a straight run.
`stairBoxes` gives the half slab and the raised step; collision, meshing
(`stairs` in `mesher.js`, faces lit from the open cell they look into) and
the corner logic all use it, while the selection box is the whole block.
Stairs have light opacity 3, so a stair roof gives shade without leaving
the stair itself dark. Torches stand on upside down stairs.

Walking: the 0.6 auto-step climbs the 0.5 steps from the front (from behind
the full height blocks you), and a player who walks off a step lands on one
up to 0.6 lower at once instead of falling, so stairs go down without
leaving the ground. Both move the camera smoothly (`Player.eyeSmooth`).

## Swimming out

Jumping against a bank in water or lava gives a stronger push once the spot
0.6 higher and a little ahead is free of blocks and above the liquid
(`Player.canClimbOut`), so a bank level with the water surface can be
climbed without building a step. A bank a full block above the surface
still cannot.

## Signs

Six planks and a stick make three signs. Placed on top of a block a sign
stands on a post, turned in 16 steps to face the player (`B.SIGN`, meta =
step); placed on a side it hangs on the wall (`B.WALL_SIGN`, meta = face).
`mesher.js` draws the board and post as boxes turned about the block's
vertical axis (`yawBox`, parts in `shapes.js`: `SIGN_BOARD`, `SIGN_POST`,
`SIGN_WALL_BOARD`, `signAngle`). The board uses its own light wood tile
(`sign_board`, soft seams) and its broad faces are lit evenly whichever way
the sign turns, so the writing stays readable. The text is a tile entity
`{ type: "sign", lines: [4], ver }`; `js/signs.js` gives every sign within
40 blocks a plane in front of its board with the lines drawn on a 512 x 256
canvas in bold dark type
(redrawn when `ver` changes, lit like other objects). Placing a sign opens
the Edit Sign screen (4 lines of up to 15 characters; Enter moves down, Esc
or Done closes) and right clicking one opens it again. Breaking a sign or
its support removes the text.

## Screenshots

F2 saves the next frame as a PNG (`Game.shotPending`; the canvas is read in
the same task as the draw, so the WebGL buffer is still there). Inside
ArozOS it is uploaded with `ao_module_uploadFile` to the folder set in
Settings (`screenshotDir`, default `user:/Photo/Blocky`, picked with the
ArozOS folder selector; the upload creates missing folders). Run
standalone, the browser downloads it. Files are named
`Blocky YYYY-MM-DD HH-MM-SS.png`. The picture is the 3D view and held item;
the HTML interface (hotbar, chat) is not part of it.

## Creative palette

Clicking a held stack onto the item grid, or dragging a stack from a slot
and letting go over it, deletes the stack like the bin does.

## Pick block

Middle click a block to take it in hand (`game.pickBlock`): if it is already
on the hotbar that slot is selected; otherwise creative fills the selected
slot with a full stack, and survival swaps a stack in from the main
inventory (nothing happens when the player has none).

## Animals

`js/mobs.js`. Cows, sheep and chickens spawn on daylight grass in grassland,
forest and beaches (cap 14); wolves (packs of 2-3) and bears spawn only where
the light is below 7 - at night on the surface of grassland and forests, or
in caves (cap 6, none on Peaceful). Predators attack on Normal and Hard at
night or in the dark, on Easy only after being hit (the whole pack joins in);
passive animals flee when hit. Models are box parts with procedural 16 px
textures, lit per animal from the block and sky light. Animals are not
saved. Sounds are synthesised in `audio.js` (`animal()`) on their own volume
bus, set by the Animal Sounds slider.

Animals hop up to about 1.25 blocks when they walk into something (a one
block step never traps them, a fence still does) and give up on a target
they have been blocked from for 1.5 s.

Weapons: swords (damage 4-7 by material; other tools 1.5-6, fist 1), and a
bow - hold right click to draw (up to 1 s), release to fire; damage 2-9 by
draw. While drawn the held bow shows one of three pulled tiles
(`bow_pull_0..2`) with an arrow on the string, turned so the arrow points
at the crosshair (`Renderer.bowAimQ`). Arrows stick in blocks for 60 s and can be picked up. Falling hits
deal 1.5x. Drops: raw meat (cow, bear), wool and mutton (sheep), chicken and
feathers (chicken), bones (wolf, bear). Meats cook in the furnace; wool
makes string (4) and beds; bones make bone meal, which ripens wheat, grows
saplings and sprouts grass and flowers. Sleeping is refused while an angry
animal is within 10 blocks.

## Beds

Right click a bed at night (or in a thunderstorm) to sleep: the screen fades
for three seconds, then time jumps to the next morning, the weather clears
and the respawn point moves to the bed. Shift or a movement key gets you up.

## Testing standalone

Serve `src/web` statically (the `webroot-static` launch config) and open
`/Blocky/index.html`; worlds then go to IndexedDB. A world starts without a
"click to play" screen; the pointer lock is requested right away and again
on the first click into the view if the browser refused. The Browser pane cannot
hold a pointer lock, so scripted tests fake it with
`Object.defineProperty(blocky.input, "locked", { get: () => true })` and push
key codes into `blocky.input.keys` / `pressed` and buttons into
`blocky.input.buttons` / `clicked`. `window.blocky` is the app object.
