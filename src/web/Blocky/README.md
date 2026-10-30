# Blocky

An original voxel sandbox game for the ArozOS desktop: generated worlds with
grassland, forest, desert and ocean biomes, survival (health, hunger,
crafting, smelting) and creative modes, day / night, rain and thunderstorms.
There are no creatures. All textures and sounds are generated in code and
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
| `js/blocks.js` | Block / item registry, mining rules, shaped recipes and the grid matcher, smelting. |
| `js/player.js`, `js/physics.js` | Movement, collisions, survival stats. |
| `js/ui.js`, `js/icons.js` | HUD, inventory / workbench / furnace / chest / creative screens, icon sheet. |
| `js/chat.js`, `js/commands.js` | Chat line and slash commands. |
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
- Trees can cross chunk borders because column height and biome come from 2D
  noise alone: every chunk re-derives its neighbours' trees and stamps the
  part inside itself.
- Random tick changes such as grass spreading or reeds growing do not mark a
  chunk as modified (`world.quiet`), so untouched chunks never enter the save.

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
`/spawnpoint`.

## Testing standalone

Serve `src/web` statically (the `webroot-static` launch config) and open
`/Blocky/index.html`; worlds then go to IndexedDB. The Browser pane cannot
hold a pointer lock, so scripted tests fake it with
`Object.defineProperty(blocky.input, "locked", { get: () => true })` and push
key codes into `blocky.input.keys` / `pressed` and buttons into
`blocky.input.buttons` / `clicked`. `window.blocky` is the app object.
