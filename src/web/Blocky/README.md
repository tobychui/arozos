# Blocky

An original voxel sandbox game for the ArozOS desktop: generated worlds with
grassland, forest, desert and ocean biomes, survival (health, hunger,
crafting, smelting) and creative modes, day / night, rain and thunderstorms,
animals, spark circuits with pistons and rails, and an optional experimental
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
| `js/realistic.js` | Experimental realistic pipeline: shadow map, sea reflection, terrain lighting chunk, HDR post passes. |
| `js/power.js` | Spark circuits: power sources, wire levels, torches, lamps, pistons, rail shapes. |
| `js/carts.js` | Minecarts (plain, chest, furnace) following rails. |
| `js/dynlight.js` | Light from a glowing item held in hand. |
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
  transparent (alpha tested). Each bed half has a raised mattress and two legs
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

## Glass panes

Six glass make 16 panes. A pane is a thin post that grows arms toward
neighbouring panes and solid blocks (`paneLinks` in `shapes.js`); its
collision and selection boxes follow the arms.

## Spark circuits

`js/power.js`, Blocky's own take on wiring. Spark ore (deep underground)
drops spark dust, which is laid as wire. Everything that carries a signal
is red (ore, dust, wire, torches, the block, the powered rail stripe) so it
never looks like an ordinary torch. Sources: levers (toggle), buttons (20
ticks), pressure plates, spark torches and spark blocks. A wire carries level 15 from a
source and loses 1 per block (`updateWires`, a relaxation over the wire
network). A powered block powers what touches it: lamps light up, a spark
torch on a powered block turns off (an inverter), pistons push up to 12
blocks (sticky pistons pull one back), powered rails boost carts. Parts react
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
not saved, so after loading a door just follows the next change).

## Rails and carts

Rails shape themselves (`railPlaced` / `shapeRail`): straight, rising toward
a neighbour one block up, or curved between two neighbours. Powered rails
(on a powered block or next to a source; power runs along up to 8 connected
powered rails) speed carts up, unpowered ones brake them. `js/carts.js`:
place a cart on a rail; right click to ride (Shift gets out), a chest cart
to open its 27 slots, a furnace cart with fuel to drive it away from you
(coal lasts 3 minutes) - it pushes the carts in front of it. Carts keep their
speed through curves and onto slopes, roll downhill, bump into each other,
stop at the end of the line and are saved with the world. Two hits break a
cart (one in creative).

## Realistic graphics (experimental)

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

Weapons: swords (damage 4-7 by material; other tools 1.5-6, fist 1), and a
bow - hold right click to draw (up to 1 s), release to fire; damage 2-9 by
draw. Arrows stick in blocks for 60 s and can be picked up. Falling hits
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
