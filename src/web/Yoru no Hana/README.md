# Yoru no Hana (夜の花)

An original vertical bullet hell ("danmaku") shooter for the ArozOS desktop.
On the night of Tsukimachi's lantern festival the night refuses to end, and
one of two heroines climbs Mount Hoshigase through six stages to find out
why. Every stage has waves of small enemies, a midboss and a boss who talks
before and after the fight and attacks with named *hanafuda cards*.

Everything except the character art is generated in code: bullets,
enemies, the pseudo-3D stage backgrounds, sound effects and a 14-track
soundtrack played by a small Web Audio sequencer. The app loads nothing
from outside its folder (plus `../script/ao_module.js` for the float window
title). Character art comes from an optional sprite sheet (below); without
it the game draws its own chibi sprites and hanafuda-card portraits. The
title screen can likewise use an optional painting and logo image.

## Playing

| Key | Action |
|---|---|
| Arrows / WASD | Move |
| Z / J / Space (hold) | Shoot |
| Shift / L (hold) | Focus: slow, shows the hitbox, concentrated shot |
| X / K | Bomb (also cancels a hit within a few frames: death-bomb) |
| Esc / P | Pause |
| Ctrl (hold) | Skip dialogue |

Gamepads use the standard mapping (A shoot, B bomb, X/RB focus, Start
pause). On touch screens the heroine follows the finger's motion and fires
while touching; Bomb / Focus / Pause buttons appear in the sidebar.

Modes: **Start** (story, stages 1-6, prologue and endings), **Practice
Start** (any stage reached in Start), **Card Practice** (any card seen, one
life, no bombs). Difficulties: Bud, Bloom, Full Bloom, Midnight. Each
heroine has a good ending (no continues) and a bad one (continued), then
credits and name entry for the top 10 of each heroine and difficulty.

Saves (settings, scores, stage progress, card history, endings, music room)
live in `localStorage` under `yorunohana.v1`.

## Files

| File | What it does |
|---|---|
| `init.agi` | Registers the module (group `Games`, float window). |
| `js/main.js` | Boot, app shell, scene switching with fades, ArozOS window hooks. |
| `js/core/` | `view` (640x480 logical frame, device-pixel scaling), `input` (keyboard, gamepad, mouse, touch as actions), `loop` (fixed 60 Hz), `task` (coroutines), `rng`, `save`, `util`. |
| `js/audio/` | `audio` (Web Audio graph, reverb), `sfx` (synthesised cues), `music` (sequencer + instruments), `songs` (the soundtrack as chords + melodies). |
| `js/gfx/art.js` | Bullet, shot and item sprites, cached at device resolution. |
| `js/gfx/enemyart.js` | Procedural small enemies (wisps, lanterns, cranes, moths, ...). |
| `js/gfx/charart.js` | Sprite sheet loader and slicer, drawn chibi / portrait fallbacks. |
| `js/gfx/titleart.js` | Optional title painting and logo image. |
| `js/gfx/backgrounds.js` | Mode 7 style stage backgrounds and the named-card backdrop. |
| `js/game/game.js` | One run: update / render order, scoring, deaths, card lifecycle, stage flow. |
| `js/game/bullets.js`, `lasers.js`, `items.js`, `fx.js` | Enemy bullets (pooled, graze, cancel), lasers, items, particles. |
| `js/game/player.js` | Heroines: movement, shot types, options, bombs, death-bomb window. |
| `js/game/enemies.js` | Small enemies and the boss. |
| `js/game/danmaku.js` | The scripting vocabulary used by stages (`ring`, `fan`, `flower`, `laser`, `spawn`, `moveTo`, `d()` ...). |
| `js/game/dialog.js` | In-stage dialogue with portraits. |
| `js/stages/s1.js` ... `s6.js` | Waves, midboss and boss cards of each stage; `common.js` has shared enemy behaviours. |
| `js/data/characters.js` | Cast (names, colours, looks, profiles), difficulties. |
| `js/data/story.js` | Prologue, every dialogue, endings, credits. |
| `js/ui/` | `title` (title screen + menu backdrop), `scenes` (every other screen), `hud` (frame, sidebar, playfield overlays), `widgets` (canvas menus). |
| `assets/sheet.json` | Layout of the optional sprite sheet. |
| `assets/fonts/` | Bundled fonts and their OFL licences (see Fonts). |
| `assets/unused/` | Font files and archives the game does not load; safe to delete. |

## Engine notes

- **Scripts are coroutines.** A stage, an enemy and a boss card are
  generator functions; `yield 30` waits 30 frames, `yield () => cond` waits
  for a condition, `yield* other()` runs another script inline. A card's
  script is killed (with every side task started through `run()` and every
  familiar enemy) when the card ends, and its bullets turn into petals.
- **Bullets** move in polar form (`a`, `s`, `acc`, `w`, clamped to
  `sMin`/`sMax`) or cartesian with gravity (`vx`, `vy`, `gx`, `gy`); `fn(b)`
  runs every frame for scripted behaviour. Readability rules: every bullet
  is a white core inside a saturated rim with a thin dark edge; bigger
  bullets draw under smaller ones; player shots are translucent and
  additive; background particles are soft blobs with no core.
- **Cards**: `{ hp, time, run }` is a nonspell; adding `name` makes it a
  named card with cut-in, bonus and capture history (`id` keeps history
  stable). `survival: true` makes the boss invulnerable until the timer
  ends. Boss hp in the stage files is multiplied by `BOSS_HP_SCALE` in
  `game.js`.
- **Balance** (measured with a bot that tracks the boss): shot DPS on one
  target is about 85 at power 1 and 155-175 at full power; boss attacks last
  roughly 11-30 s; a stage runs about three minutes.
- **Testing in the Browser pane**: when the pane is hidden,
  `requestAnimationFrame` stops. Drive the game synchronously instead:
  `yoruApp.open('game', {mode:'card', diff:1, char:'akari', stage:4,
  card:{midboss:false, index:1}})`, then `yoruApp.update()` in a loop
  (`window.yoru` is the running game, `yoru.godMode = true` makes the
  heroine invulnerable).

## Fonts

Two SIL Open Font License families ship in `assets/fonts/`, loaded with
the FontFace API before the title screen appears (at most 5 s; fonts that
arrive later redraw the cached sprites):

| Family in code | File | Used for |
|---|---|---|
| `YnH Cinzel` | `Cinzel-VariableFont_wght.ttf` (all weights in one file) | Latin headings, menus, names, numbers (`FONT_DISPLAY`) |
| `YnH Mincho` | `ShipporiMincho-Regular-subset.woff2`, `-Bold-subset.woff2` | Japanese text, and English prose (`FONT_SERIF`) |

Cinzel's lowercase letters are small capitals, which is lovely for titles
but tiring for paragraphs, so dialogue, story pages and descriptions use
Shippori Mincho's Latin. In `FONT_DISPLAY` Cinzel comes first and Mincho
second, so a string like `Bloom 花` draws each script in its own font.

Shippori Mincho is 8.6 MB per weight, so the game ships subsets (about 80
KB each): Basic Latin, Latin-1, punctuation, CJK symbols, kana, full-width
forms and every kanji that appears in `js/` and `index.html`. **After adding
new kanji to the game, rebuild the subsets** (needs `pip install fonttools
brotli` and the full fonts, currently in `assets/unused/ShipporiMincho/`):

```python
# run from src/web/Yoru no Hana
import glob, io
from fontTools import subset
text = ''.join(io.open(p, encoding='utf-8').read() for p in glob.glob('js/**/*.js', recursive=True) + ['index.html'])
ranges = [(0x20, 0x7E), (0xA0, 0xFF), (0x2010, 0x2027), (0x2030, 0x205E), (0x2190, 0x2193), (0x2423, 0x2423),
          (0x2669, 0x266C), (0x3000, 0x303F), (0x3040, 0x30FF), (0xFF01, 0xFF5E)]
cps = {c for a, b in ranges for c in range(a, b + 1)} | {ord(c) for c in text if ord(c) >= 0x80}
for w in ['Regular', 'Bold']:
    o = subset.Options(); o.flavor = 'woff2'; o.layout_features = ['*']; o.name_IDs = ['*']; o.notdef_outline = True
    f = subset.load_font(f'assets/unused/ShipporiMincho/ShipporiMincho-{w}.ttf', o)
    s = subset.Subsetter(o); s.populate(unicodes=cps); s.subset(f)
    subset.save_font(f, f'assets/fonts/ShipporiMincho-{w}-subset.woff2', o)
```

Everything in `assets/unused/` (the downloaded zips, Cinzel's static
weights, Shippori Mincho's Medium / SemiBold / ExtraBold and the full
Regular / Bold) is not loaded by the game. Keep the full Regular and Bold
only if you want to rebuild the subsets without downloading them again.

## Title screen art

Two optional images replace the drawn title scene; each works alone.

- `assets/title.png` - an opaque 1536 x 1024 painting. It covers the 4:3
  frame (about 7% of the width is cropped from each side, plus a slow
  drift), sits behind every menu (dimmed there), and the game keeps drawing
  its rising lanterns and falling petals over it. The logo and menu are
  drawn over the right 40%, so that part should stay calm and dark.
- `assets/logo.png` - the logo, ideally on transparency (a flat pure
  green backdrop is keyed out, like the sprite sheet). It is trimmed to its
  artwork and fitted into a 300 x 128 box at the top right of the title
  screen and into the sidebar during play. The game draws the English
  subtitle "The Night That Would Not End" under it itself.

Hard-reload after adding either file.

### Prompt for the title painting

> Create ONE illustration, landscape, exactly 1536 x 1024 pixels, as a
> finished full-bleed background painting for the title screen of a
> Japanese bullet-hell game. No text, no letters, no logo, no signature, no
> border, no frame, no user interface.
>
> Style: high quality anime background art, like the key visual of a
> Japanese doujin game: painterly, soft glowing light, cinematic depth,
> fine detail. Palette: deep indigo and violet night, cool silver
> moonlight, warm orange lantern light as accents, the pure white glow of a
> flower. Keep the whole image fairly dark so white text stays readable
> on top of it.
>
> Scene: a midsummer festival night on a sacred mountain in Japan.
> - A huge full moon low in the sky, left of centre.
> - On a moonlit summit garden, a giant luminous night-blooming flower,
>   the queen of the night (Epiphyllum oxypetalum), in full bloom: long
>   slender pure white petals, pale pink sepals, a soft white halo of
>   light, smaller white blossoms around it.
> - An old stone stairway climbing toward the summit between tall dark
>   cedar trees, with fine silk threads glinting between the trunks.
> - Far below, in the bottom left, a small lakeside Japanese festival town
>   with rows of warm orange paper lanterns; its mirror-still lake reflects
>   the moon. A few floating paper lanterns drift up from the town and the
>   lake into the sky.
> - On the stairway, two small girls seen from behind, looking up at the
>   flower: one with a short crimson-red bob and a side ponytail holding a
>   glowing red paper lantern on a stick, one with long straight
>   silver-blue hair in an indigo yukata holding a round bronze hand
>   mirror. They are small in the frame; no faces visible.
> - A few white petals drift in the air.
>
> Composition (important): the game crops about 110 px from the left and
> right edges, so keep everything important inside the central area. Put
> the moon, the flower, the stairway and the girls in the left 60% of the
> image. Keep the right 40% calm and dark: open night sky with faint stars
> and thin mist over a distant mountain ridge, with no bright objects, no
> lanterns and no figures there, because the logo and the menu are drawn
> over that area.

### Prompt for the title logo

> Create ONE image, landscape, exactly 1536 x 1024 pixels, as a PNG with a
> fully transparent background. If transparency is impossible, use a single
> flat pure chroma-key green (#00FF00) background with no gradient, shadow
> or glow on it, and no pure green in the logo.
>
> A title logo for a Japanese bullet-hell game called 夜の花 ("Flower of
> the Night"). The main text is exactly these three characters, in this
> order, written horizontally from left to right: 夜 の 花. Draw them large,
> in elegant, confident Japanese brush calligraphy with refined Mincho
> structure, filled pure white with a thin pale-gold edge and a soft
> pale-violet glow that stays close to the strokes. Weave a white
> night-blooming flower (queen of the night, long slender petals) behind
> and around the character 花, and add a thin golden crescent moon near the
> character 夜. Below the Japanese, centred and much smaller, the words
> YORU NO HANA in elegant Roman inscription capitals with wide letter
> spacing, pale gold.
>
> No other text, no frame, no badge, no background scenery. The whole logo
> is centred and about twice as wide as it is tall, filling about 75% of
> the image width with generous empty space around it. Crisp clean edges
> suitable for cutting out, designed to read clearly on a dark night sky.
> The kanji must be correct; 夜 means night and 花 means flower.

## Character sprite sheet

Drop a generated image at `assets/characters.png` and reload (Ctrl+Shift+R:
ArozOS serves files without cache headers). The Characters screen says
which sprites were found. Expected layout (`assets/sheet.json`), a
1536 x 1024 image:

```
 row 1 (y   0-384): portraits  akari   shizuku  tomoe   minamo     4 cells 384x384
 row 2 (y 384-768): portraits  kohaku  itoha    seira   yoruka     4 cells 384x384
 row 3 (y 768-1024): chibis    akari shizuku tomoe minamo kohaku itoha seira yoruka  8 cells 192x256
```

The slicer does not need exact placement: it splits the rows, then the
sprites inside each row, at the emptiest line near each nominal cell edge
(generated art often runs a few pixels past the grid), crops each sprite to
its own bounds, and keys out the background when the PNG has no
transparency (flood fill from the border, a tight key for white / grey
backdrops, a loose key plus despill for a green screen). A transparent PNG
is best; a flat pure green (#00FF00) background is the next best; a white
background can eat into the white-haired final boss. If a portrait faces
the wrong way, list its id in `flipPortrait` (or `flipChibi`) in
`assets/sheet.json`. The current sheet drew everyone facing right, so the
six bosses are listed there; the Characters screen shows mirrored portraits
the original way round.

`yoruApp.charArt.report` (in the browser console) lists where the rows and
sprites were cut and whether any cut had to go through artwork
(`touching`).

### Prompt for the sheet (ChatGPT image generation)

> Create ONE sprite sheet image, landscape, exactly 1536 x 1024 pixels, as a
> PNG with a fully transparent background. If transparency is impossible,
> use a single flat pure chroma-key green (#00FF00) background everywhere,
> with no gradient, texture, floor, shadow or glow on it, and no pure green
> on any character.
>
> Style: high quality 2D anime game art, like the character portraits of a
> Japanese doujin bullet-hell game: clean dark line art around every shape,
> cel shading with soft highlights, vivid saturated colours, large
> expressive eyes. All eight characters share the same style, line weight
> and lighting (cool moonlight from the upper left, warm lantern rim light).
> These are original characters; do not imitate any existing franchise.
>
> Layout: an invisible grid of three rows, with no grid lines, borders,
> frames, text, labels, numbers, signatures or scenery.
> - Row 1 (top 384 px): four cells of 384 x 384 px.
> - Row 2 (middle 384 px): four cells of 384 x 384 px.
> - Row 3 (bottom 256 px): eight cells of 192 x 256 px.
> Each sprite is centred in its own cell and fully inside it, with at least
> 16 px of empty space on every side; nothing touches or overlaps a
> neighbouring cell.
>
> Rows 1 and 2: waist-up dialogue portraits (head and upper body, cut off
> cleanly at the waist), three-quarter view, expression matching the
> personality. Characters 1 and 2 face toward the RIGHT; characters 3 to 8
> face toward the LEFT.
> Row 3: tiny full-body chibi sprites of the same eight characters in the
> same order (about 2.5 heads tall, big head, small body), facing the
> viewer, standing, readable at small size.
>
> Characters, in order (row 1 left to right, then row 2 left to right; row
> 3 repeats all eight left to right):
> 1. Akari Hinomiya, energetic teenage girl, apprentice lantern maker.
>    Short crimson-red bob with a side ponytail on her right tied with a
>    red-and-white cord; amber eyes; red short yukata dress with a small
>    orange lantern pattern, white collar, orange obi; holds a small glowing
>    red paper lantern on a bamboo stick.
> 2. Shizuku Mikagami, calm and polite ferry keeper of a mirror-like lake.
>    Long straight silver-blue hair with a blunt hime cut, pale blue eyes,
>    a small water-drop hairpin; indigo yukata with a white wave (seigaiha)
>    pattern at the hem, light blue obi; holds a round bronze hand mirror
>    shining with moonlight.
> 3. Tomoe Hozuki, playful spirit of the hozuki (Chinese lantern plant).
>    Bright orange hair in two buns, each decorated with a glowing orange
>    papery hozuki husk; golden eyes; orange dress with horizontal ribs like
>    a paper lantern and a black obi; a few tiny glowing husk lanterns float
>    beside her.
> 4. Minamo Suiren, dreamy and sleepy water-lily spirit. Long wavy pastel
>    pink hair, a large white-and-pink water lily on her head, a small red
>    koi-fin ribbon; drowsy half-closed teal eyes; teal and white layered
>    dress with lily-pad scallops at the hem and a few red koi-scale accents.
> 5. Kohaku Matsuyoi, shy hawk-moth girl. Fluffy amber-blonde hair, two
>    feathery moth antennae, golden eyes; cream dress with a fluffy white
>    fur collar and small yellow evening-primrose flowers; large brown and
>    amber moth wings on her back with cream eyespots.
> 6. Itoha Karasuuri, elegant and aloof spider weaver (jorogumo). Long black
>    hair with a violet sheen in an elegant updo held by kanzashi pins shaped
>    like white lace flowers; violet eyes; dark purple kimono with white lace
>    fringe on the sleeves and hem, an orange-red snake-gourd charm; fine
>    silver threads trailing from her fingertips.
> 7. Seira Yorugao, clever human astronomer who looks tired. Navy blue hair
>    in a single low braid over one shoulder, round gold-rimmed glasses,
>    deep blue eyes, a small gold star hair clip; dark navy scholar's haori
>    embroidered with gold constellations over a white blouse with a white
>    moonflower brooch; holds a small brass armillary sphere.
> 8. Yoruka Gekka, ethereal and melancholic queen of the night flower
>    (Epiphyllum oxypetalum), the final boss. Very long flowing white hair
>    with pale gold tips, pale golden eyes, a small glowing crescent-moon
>    tiara; a layered white gown whose long slender white petals fan out
>    behind her like a blooming night flower, pale pink sepals, a pale mint
>    underlayer; a soft glow that stays on her and does not spill onto the
>    background. Give her white areas clear dark outlines.
>
> Every character must be recognisable by silhouette and main colour: red,
> silver-blue, orange, pink and teal, amber, black and violet, navy and gold,
> white.
