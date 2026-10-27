# Sandfall

A falling-sand simulation prototyped as a single HTML file (`falling-sand.html`), headed for a Godot port once the design settles. Published as a Claude artifact.

The script has two blocks: `Sim` (pure rules, no DOM; this is what ports to Godot) and the render/input block.

## Tests

Headless checks run in Node (no dependencies):

```
node tools/validate.js        # all scenarios, or name some: sapling sand soak topple rot seasons snow
                              #   shadow updraft fog dew clouds erosion lava tension salt acid canopy save
                              #   tiles stream (stage 4) sky precip storm steam level
                              #   support cookoff conduct melt
SIMFILE=other.html node tools/validate.js   # run them against another copy of the page
node tools/ui.js [serial|threads]   # runs the whole page against a stub DOM and pokes the UI, on one thread and on workers
node tools/threads.js [n] [frames]  # n worker threads must give exactly the world one thread gives; times both
node tools/perf.js [seed]     # generates the page's 960x640 world (Sim.WORLD) and times step() and render
node tools/game.js [ids]      # stage 5: each scenario's scripted solution wins, doing nothing loses; budgets, scoring, unlocks, saves
```

## Engine (stage 4)

- Every field is a flat typed array carved out of one buffer (`FIELDS` in the Sim block): per cell, per coarse air cell,
  per wind cell, plus the job system's control block. With a `SharedArrayBuffer` worker threads attach to the same fields.
- The cell pass runs in 64×64 tiles. A tile's update reads and writes only within 32 cells of the tile (movement, spreading,
  the pressure search and the column scans are clamped to that window), so tiles two apart never touch the same cell. The four
  checkerboard phases each run all their awake tiles at once; each tile seeds its own random stream from the frame seed and its
  index, so the result does not depend on thread count or tile order (`tools/threads.js`, `validate.js tiles`).
  Work that touches shared entity state (planting a tree) is deferred to the main thread after the cell pass.
- Trees, soil, air and wind passes stay on the main thread.
- Browsers only give pages shared memory when they are cross-origin isolated (COOP/COEP headers). Elsewhere the page runs the
  same tiles on one thread and says so in the stats line.
- Streaming: the 960-wide grid is a window onto a world 7680 wide (`g.worldW`), moved 320 columns at a time (`g.shift`). The
  region leaving is run-length packed (type, life, whole-degree temperature, tree owner, vapour) with the trees rooted in it;
  the region arriving is unpacked, or generated from world-coordinate noise and column hashes, so streamed land matches land
  generated in place. `g.prefetch()` makes the next region ahead of time on a scratch grid, a slice per frame. Regions
  outside the window are frozen. Saves carry the stored regions as a seventh part.

## Game loop (stage 5)

- `Game` in the Sim block runs a scenario: a 320×200 pit (`BOX`) dug into stone at the bottom middle of the grid, one screen,
  open to the sky. Streaming is off and the camera is fixed on it.
- A scenario is data: `budget` (cells of each element the brush may place, `Erase` included), `goals` and `fails`, and `time`.
  A goal or fail measures one number and has a `min` and/or `max`: `{count:'Water', rect}` (cells in a box-coordinate rectangle),
  `{trees:true, rect, tall}` (living trees rooted there), `{made:'Steam'}` (cells reactions have made since the start).
  Win when every goal holds for 1.5 s; lose when a fail's range is reached or time runs out.
- `game.paint(i, t)` is the god-hand inside a scenario: it checks the box and the budget.
- Reaction scoring: `set()` counts every cell turned into each element (`made`, shared across worker threads with
  `Atomics.add`). Each tick the game takes the difference, skips what the brush placed, and scores products by `VALUE`; each
  different product made in the last 3 s adds ×0.5 to a chain multiplier (up to ×4). A win scores 1000, up to 500 for time
  left, up to 500 for material left, plus reaction points.
- Unlocks: the sandbox rack starts with `STARTER`; each scenario's `unlocks` open when it is won, and scenarios open in order.
  Progress lives in `localStorage['sandfall.progress']`; "Unlock all" overrides it.
- Scenario save/load: `game.save()` is JSON (`sandfall:'scenario'`) holding the definition, the world text and the game state.
  Save, Load, Export and Import take either kind of text. A hand-written definition loads like a built-in.
- Five scenarios: Irrigation, Lava crossing, Demolition (an ice dam: stone barely chips under gunpowder), Firebreak, Green the valley.
- Physics change: water pressed on from above now steps sideways into a cell where it stays joined to its body, so a reservoir
  drains through an opened gate at a sensible rate (surface tension had held it to ~20 cells/s). Lone drops still bead; a 100-cell puddle spreads a little wider (56 cells, was 47).

## Sky

- The page's grid is `Sim.WORLD`, 960×640. The land is laid out in the bottom 480 rows of any grid (`LAND_H`); the `g.top` rows
  above it are extra sky (160 here), so a 480-row grid generates the same land it always did, and the 640-row world is that land
  shifted down under more sky. Terrain noise, the climate's lapse rate (`skyY`) and the scenario box (`BOX`, at the bottom) all
  sit relative to the land.
- Weather was not retuned: thermals, cloud bases and rain are as before, and the extra sky gets higher cloud layers on cool nights
  that clear by day (`validate.js clouds` measures both).
- Rain or snow (`Grid.fall`): precipitation leaves a cloud as a flake where the air there is below freezing and as a drop
  where it isn't, at the air's temperature. Flakes flutter down at most a cell a tick, so a flake falling through air above 2°
  melts into rain within about 60 rows; rain falling into air below 0° still freezes. (It used to be one temperature for the
  whole sky, set by the season, so spring and autumn clouds snowed onto ground at 6-8°.) `validate.js precip` measures it.
- Lapse rate (`ambAt`): 0.12° a row up to 100 rows over `skyY` (past the hilltops), 0.06° a row for 150 rows above that, then
  none. Typical ground (50 rows over `skyY`) is 11° plus the climate, as before; hilltops and the cloud layer are 1-3° warmer
  than with the old steady 0.18° a row, and the high sky up to 5° warmer. Under a tall cloud over ground at 6°
  (`validate.js precip`), the share of what reaches the ground as snow went from 65% to 7% in early spring and from 32% to 0
  in late autumn; winter still snows all the way down. The cloud-base check is now judged per snapshot (bases rise and fall with the air from day to day).
- The view is 320×240 (4:3); in a scenario it shows the box with 40 rows of sky above it.
- Saves from the 480-row world load into the taller one with the sky added on top (cells, trees, vapour and stored regions shifted
  down; `validate.js sky`).

## Rough edges fixed

- Diagonal support (`Grid.supported`): stone, glass, ice and charcoal count a solid diagonally below as support, as they do one
  straight below. A pitched roof of one-cell diagonal lines on two pillars and a lone diagonal brace now stand (before, both
  crumbled to rubble in a second); a diagonal line in mid-air still falls, a flat shelf still breaks past its span, and taking
  a pillar away still brings its side of the roof down (`validate.js support`).
- Lava cook-off (`columns`, world generation): a new world used to set off 47-80 gas and gunpowder explosions in its first 20
  seconds, and burn hundreds of cells of oil, because fuel was laid down beside lava in the same caves. Lava now lies in sealed
  chambers: within `GAP` (4) cells of it oil and gas become open air, and from there out to `COOK` (12) cells any cave becomes
  rock and gunpowder veins become stone, so fuel further off can't drift or flow in. The distance is a chamfer distance over
  lava found from the noise, COOK columns past each side of the region, so streamed regions still match land made in place.
  On four seeds, nothing explodes or burns in the first two minutes; the deep caves keep 93-98% of the gas, gunpowder and
  oil they had (`validate.js cookoff`).


## Heat

- Every element has a conductivity `k` (how fast heat crosses it; between two cells the harmonic mean, so the poorer conductor
  sets the rate) and a heat capacity `cap` (heat per degree, so how slowly its own temperature moves). Heat is exchanged
  pairwise, so it is conserved between cells. New: **Metal** (k 1.0, cap 1.2) carries heat end to end; stone (k 0.15, now
  cap 2) warms slowly and holds it; sand 1.2 and rubble 2 also hold more. Two contact factors on top of the table: a metal bar
  hands heat to still air at 3% of the plain rate (otherwise a rod in air loses it all in a few cells), a block of ice at
  30%, and a snowflake to air at 8× (all surface). In 10 s with one end held at 600°, a metal bar is 118° 15 cells along and
  a stone bar is still 20° 5 cells along; a 10×10 block heated from one face for 5 s averages 272° in metal, 77° in stone
  (`validate.js conduct`).
- Solids glow red, then orange, above ~480° (render only).
- Melting and freezing are latent heat, not thresholds (`Grid.fusion`, `fuse` field). Ice or snow warmed past 0° is held at
  0° and banks the heat; it melts once it has `FUSE` (240 heat units for ice, a cell of water's 80 water-degrees; 30 for
  snow, which is mostly air, so flakes falling into air above freezing still melt into rain on the way down: 8% of what
  reaches 6° ground under a tall spring cloud is snow, was 7%). Water chilled below 0° is held at 0° and gives the same amount off before it freezes (to snow
  if it's falling, ice if it's sitting). Heat flowing back first unbanks what was saved. Before, ice melted at 40° and water
  froze the instant it touched 0°.
- In the soil pass, exposed ice follows the air like bare ground does (so lake ice melts in a thaw and carries the frost down in
  winter), the old random 2% spring thaw of "weather ice" is gone, and a freezing pond's surface chills 4× faster, also under
  freezing fog. Measured: a 10×10 block of ice in 10° air melts in ~50 s and never reads above 0°; a pond in -9° air skins over
  in a minute with all of its bottom half still liquid, and is gone after a minute of spring; water poured on a -40° metal
  plate freezes on it (`validate.js melt`).
- World generation: ice veins in the deep (17-32°) rock would now melt, so they lie in a halo of rock at `PERMAFROST` (-25°),
  taken from the same noise (no change to the land itself). A new world keeps 99.6% of its ice over 30 s (it lost 16% in the first minute without the permafrost).
- Demolition: the ice dam (now -30°) stands on frozen bedrock and holds back a glacial lake at 1°; otherwise the 26-33° box
  air melted it through on its own by 28 s. Doing nothing still loses; the scripted blast still wins.
- Saves don't carry `fuse` (half-melted cells restart their melt). Perf on the 960×640 world: tick 6.0-6.4 ms, render 3.9-4.4 ms (unchanged within noise);
  a winter world 7.5 ms (was 7.8).
