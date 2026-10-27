# Sandfall

A falling-sand simulation prototyped as a single HTML file (`falling-sand.html`), headed for a Godot port once the design settles. Published as a Claude artifact.

The script has two blocks: `Sim` (pure rules, no DOM; this is what ports to Godot) and the render/input block.

## Tests

Headless checks run in Node (no dependencies):

```
node tools/validate.js        # all scenarios, or name some: sapling sand soak topple rot seasons snow
                              #   shadow updraft fog dew clouds erosion lava tension salt acid canopy save
                              #   tiles stream (stage 4) sky precip storm steam level
                              #   support cookoff conduct melt groundwater dunes windfire channel
                              #   grass compete seasonfire
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

## Groundwater (E3)

- Sand now holds moisture in its life value, like dirt's low byte (100 is one water cell). It soaks water up faster than dirt,
  passes it on twice as fast (`PERM`) and holds less against gravity (`HOLDM`). Moisture flows between sand and dirt.
- Soil lying on rock passes its excess diagonally down to the soil beside it, so groundwater runs downhill along bedrock.
  At the top of a soaked zone (moisture ≥ `SATM`), water moves toward a neighbouring column whose water table is lower and
  comes up there, so the table levels out under a hill and drains toward its foot.
- Springs: soaked soil (≥ `SPRING`) with an open face beside it, under it, or over it where the table next door stands higher,
  lets a water cell out there with chance `SPRING_P × (1 + head)`, head being how many soaked rows stand just behind the face.
  The spring's own pool rises as high as the head reaches. `g.springs` counts the cells let out.
- Damp sand (≥ `CLUMP`) doesn't slump: it stands in walls and trenches until it dries. Under water it slides again.
- Saves carry sand moisture as an eighth part; older saves load with dry sand.

## Wind and water shaping the land (E4)

- Blown sand (`Grid.saltate`, in the soil pass so it reaches sleeping ground): a dry surface grain (moisture under `BLOW_DRY`)
  hops downwind when the wind just above it (`Grid.windAt`) is faster than `BLOW_U`, with chance `BLOW_K` × the excess per visit.
  It is launched a cell up with `HOP` cells/tick of sideways momentum and lands a few cells on. A grain with anything above a
  1-in-4 line rising upwind within `SHELTER` cells is in the lee and stays put, so the wind strips windward slopes and drops sand
  past the crest, which slides into a slip face. Damp sand (rain, dew, a water table) doesn't blow. Measured
  (`validate.js dunes`): a 25-high mound in a steady 0.6 wind moves 45 cells in 5 min with a 0.3 back and a 1.0 slip face.
- Fire and wind (`Grid.ignite`): the prevailing wind (not the local flow, which near a fire is mostly its own inflow) multiplies
  the chance of lighting fuel downwind by up to 3 and upwind by as little as 0.1 (`FIRE_LEAN`). Embers throw sparks downwind
  (`Grid.spark`, `SPARK_*`) that drop onto whatever lies 2 to ~17 cells on. Measured (`validate.js windfire`): grass burns 130
  cells each way in ~7 s in still air; in a 0.6 wind 2.5 s downwind and 22 s upwind, and a 14-cell bare gap is crossed 4/4
  times in wind, 0/4 in still air. Firebreak: water alone wins 14 of 18 scripted play styles (16 of 18 before); game.js uses a
  timing that wins on both builds.
- Streams (`Grid.drag`, `Grid.scour`): water's pull on its bed is its depth (up to `DEEP`) times the slope of its free surface
  measured `REACH_S` cells each way (`Grid.level`, less one row so ripples and bubbles don't count; a wall or a dry bank gives no
  reading). Over `TAU_C` it lifts a bed grain of sand or dirt (`ERODE`) into the water above as sediment; a grain-carrying cell
  with the current over `TAU_C` moves downstream through the water and doesn't settle. Where the surface flattens, it settles as
  before. A still pond never stirs. Measured (`validate.js channel`): a 2-cells/tick stream on a 1-in-30 sand plain cuts its bed
  10 cells deep near its head in 3 min and builds it up 3 cells where it slows, with sand conserved.
- No save changes. Perf on the 960×640 world: tick 9.4 ms (10.6 before, noise), render ~6-7 ms.

## Plants competing, and fire by season (E5)

- Grass is Plant with no tree owner. Its life holds sap in the high byte and its growth budget in the low byte (tree leaves keep 1).
  `Grid.grass` runs in the soil pass: the grass loses sap to the air at `TRANSP` × the air's drying power (the coarse air cell over
  the top of the stand), and drinks it back from the dirt under it (`SIP` moisture for `SAP_GAIN` sap) while that holds at least
  `GRASS_DRINK`. Rain landing on grass runs down into the soil. Green grass on soil holding `SPREAD_M` sends runners up to 3 cells
  sideways onto bare damp dirt that isn't shaded. Leaves or rock overhead (a cone widening upward, `Grid.shaded`) kill it slowly,
  a growing-season drought kills straw, and frost kills tall growth back to the dormant base. Measured (`validate.js grass`):
  four cells on moisture-90 dirt cover 98 columns in 1.5 min; on moisture-30 dirt they dry out and don't spread.
- Competition (`validate.js compete`): grass under a tree's leaves thins to 0.23 of the open meadow's density in 2.5 min. Seeds
  falling on grass take root a quarter of the time (`SEED_IN_GRASS`) and clear the grass where they do (7 of 30 against 30 of 30
  on bare dirt). A tree that can't drink through `THIRST` growth steps of the growing season (about two days) wilts at half that,
  dropping its leaves, then dies, so seedlings on dry ground and losers among crowded roots go. Trees no longer take grass for
  their own leaves.
- The dry season (`g.dryness`, from early summer to mid autumn, worst at summer's end) raises the soil moisture grass needs to keep
  drinking by up to `DRY_NEED`, so it cures to straw on the hills and stays green where the ground is soaked. Straw (sap under
  `CURED`) catches at `CURED_P` (5× green grass), and green grass catches more slowly the more sap it holds (`GREEN_K`). Measured
  (`validate.js seasonfire`): the same meadow's fire ran 32 cells in 5 s in spring and 295 in late summer. The stats line shows
  "(dry season)". Grass is rendered from green to straw by its sap.
- World gen lays grass on 75% of damp open dirt, away from tree sites, before the trees grow. Over a generated year the meadow
  covers ~310 columns in spring, cures from late summer, and the spreading forest shades out about a third of it by the next
  spring; 5-8 trees die of thirst.
- Save has a 9th part: plant life (grass sap). Older saves load with green grass. Firebreak's grass is set to sap 200 so the
  scenario plays as before (game.js passes). Perf on the 960×640 world: tick 9.6 ms (9.5 before), render ~6 ms.
