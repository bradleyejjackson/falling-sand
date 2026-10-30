# Sandfall

A falling-sand simulation prototyped as a single HTML file (`falling-sand.html`), headed for a Godot port once the design settles. Play it at https://sand.bradleyejjackson.com (Cloudflare Pages); also published as a Claude artifact.

Hosting: Cloudflare Pages builds every push to main with `node tools/pages.js _site`, which wraps `falling-sand.html` in a doctype and `<head>` as `_site/index.html`; `tools/_headers` is copied into the output and makes Cloudflare send COOP/COEP, so the worker pool runs there. Setup steps: `docs/cloudflare-pages.md`.

The script has two blocks: `Sim` (pure rules, no DOM; this is what ports to Godot) and the render/input block.

## Tests

Headless checks run in Node (no dependencies):

```
node tools/validate.js        # all scenarios, or name some: sapling sand soak topple rot seasons snow
                              #   shadow updraft fog dew clouds erosion lava tension salt acid canopy save
                              #   tiles stream (stage 4) sky precip storm steam level
                              #   support cookoff conduct melt groundwater dunes windfire channel
                              #   grass compete seasonfire ... widen (E8) ... landslide frost beams (R5)
                              #   scrub cactus reeds biomes (R6)
                              #   nutrients (R7) vigour narrow (N0)
SIMFILE=other.html node tools/validate.js   # run them against another copy of the page
node tools/ui.js [serial|threads]   # runs the whole page against a stub DOM and pokes the UI, on one thread and on workers
node tools/threads.js [n] [frames]  # n worker threads must give exactly the world one thread gives; times both
node tools/perf.js [seed]     # generates the page's world (Sim.WORLD, mid-world) and times step() and render
node tools/steady.js [seed] [frames] [warm]   # the step once a new world has settled (perf.js includes its first, all-awake ticks)
node tools/prof.js [seed] [frames]   # the step split by pass (cell pass, soil, air, waves, wind, trees, ...)
node tools/game.js [ids]      # stage 5: each scenario's scripted solution wins, doing nothing loses; budgets, scoring, unlocks, saves
BASE=old.html node tools/same.js [frames] [seeds]   # two builds must give exactly the same world (for pure speed-ups)
OX=640 node tools/biomes.js [seed] [seasons]   # R6: columns of forest, meadow, scrub, desert and reed bed, and wild plants, each season
OX=0 node tools/soil.js [seed] [seasons]   # R7: topsoil and subsoil nutrients by cover (forest, meadow, scrub, bare), each season
node tools/trees.js [seed] [seasons]   # tree heights and crowns each season, binned by sun and soil
node tools/forest.js [seed] [seasons]   # N4: broadleaf trees and conifers each season, by site warmth (valley, slope, upland, high)
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

- The page's grid is `Sim.WORLD`, 960×960 (N0; it was 960×640, then 1280×640). The land is laid out in the bottom 640 rows of
  any grid (`LAND_H`); the `g.top` rows above it are extra sky (320 here). The hills stand as in a 480-row land (`SURF_H`) and the
  ground goes on down under them, so a 480-row grid generates the same land it always did, and the 960-row world is the same
  hills shifted down under more sky, over deeper ground (the underground layers, caves, oil, ice veins and lava, stretch to fill it). Terrain noise, the climate's lapse rate (`skyY`) and the scenario box (`BOX`, at the bottom) all
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
- Saves from shorter worlds load into the taller one with the sky added on top and the ground they didn't have filled in under
  them as rock (cells, trees, vapour and stored regions shifted down; `validate.js sky`). Saves now end with the rows of land they
  hold; older ones held 480.

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

## New materials (E6)

New elements are appended after Metal, so saved worlds keep their ids: Mud, Clay, Brick, Rust, Molten glass. Oil, smoke and
glass already existed; they behave more like the real thing now.

- Mud: dirt soaked past `MUD_AT` with clean water standing on it, at most 3 deep (a puddle or a flooded field, not a lake bed),
  takes that water in and becomes mud (`MUD_P` per soil visit). Mud is a thick liquid (density 1.8, `MUD_FLOW`): it creeps off
  slopes steeper than 1 in 2, so a heap slumps low and wide, and at rest it lets its chunk sleep (`Grid.canSlump`). Its life is
  dirt's (richness and moisture); it barely drains (`PERM` 0.1) and dries in the sun back to dirt below `MUD_DRY`. On waterlogged
  ground the dirt under it wicks it wet again, so it stays. Measured (`validate.js mud`): a 3-deep puddle on soaked dirt makes 20
  mud in a minute and none under a 20-deep lake; drained, it is all dirt again after 6 min of summer sun.
- Clay: a powder whose life is moisture. Damp clay (≥ `CLAY_WET`) is sticky and holds whatever shape it is piled in, under water
  too; dry clay slumps. Water barely gets through it (`PERM` 0.02): once its lining has wetted, a clay pond loses about as much as
  a stone one (41 vs 30 cells over 2 min), and a dirt-lined pit drains dry. Past 600° it fires to Brick.
- Brick: static, k 0.12, carries load with a 4-cell span (falls as rubble), and doesn't melt in lava. Acid doesn't eat it.
- Molten glass: sand past 900° melts into it (it used to turn straight to glass). It runs like cooling lava and sets into glass
  below 700°, settled where it lies; water quenches it at once. Glass past 1000° melts back to it (it used to melt to lava).
- Rust (`Grid.corrode`, in the soil pass so sleeping metal rusts): metal next to water or mud flakes to rust at `RUST_W` a visit,
  brine `RUST_B`, damp soil half of `RUST_W`, and fog or dew-point air `RUST_AIR`; metal at 100° or more stays dry, and metal below 0° doesn't rust (the frozen-plate check in `melt` caught that). Rust is a
  powder, so the flakes fall away and bare fresh metal. Measured (`validate.js rust`): a 4-thick wall loses 18 cells in a minute
  in fresh water, 71 in brine, none in dry air.
- Oil (`Grid.burnOil`): oil past its flash point burns only where it meets the air. Oil's life is 1 while it is alight; a burning
  surface cell sends flames up (`OIL_FLAME`) and is used up at `OIL_EAT` a tick, and smothered oil goes out. Before, a pool
  flashed to flame all at once (450 cells in ~30 ticks); a 6-deep pan now burns for ~8 s. Half its flames send up a puff of
  smoke (`Grid.soot`). Water that reaches burning oil flashes to steam (`SPATTER`) and throws the oil round it up into the air,
  still burning; water boiling under hot oil throws the top of the oil column (`Grid.boilover`).
- Smoke rises while it is hotter than the air round it (up to 0.6 a tick, down to 0.1 once it has cooled), so it climbs off a fire,
  then drifts and gathers under a ceiling. Flames push through smoke: with cool smoke lingering, they couldn't, and Firebreak's
  grass fire went out on its own (game.js caught it).
- Rack: Clay and Mud are in the starter sandbox; Rust unlocks with Irrigation, Brick and Molten glass with Lava crossing.
- No save changes beyond Mud and Clay joining the saved soil life. `validate.js glass mud clay rust oil smoke`.

## Engine speed and a bigger world (E8)

See [docs/ENGINE.md](docs/ENGINE.md) for the engine's data layout, tick order and sleeping rules, written for the Godot port.

- Pure speed-ups, checked bit for bit against the E7 build with `tools/same.js` (and the frame pixel for pixel): the heat step
  runs inline in the cell pass with flat double-precision tables; Sets and keyed objects on hot paths are flat tables;
  statics that only conduct heat (`INERT`) skip the rest of the pass; `Grid` sets every property in its constructor so V8
  keeps one shape; `wake` uses shifts. Render looks its per-element values up in flat tables. Tick 1.28x, render 1.3x.
- Sleeping is per 4×4 block (`SC`) instead of per 16×16 chunk (the wind grid keeps 16×16). A moving grain used to keep up to
  1024 cells awake; now 64. What this changed, and the fixes:
  - Heat wakes by heat flow (degrees × capacity over `WAKEQ`, 0.3; metal 0.05) rather than by degrees, so a lava flow crusting
    over slowly (capacity 25) stays awake until it sets, and a metal bar's warm front keeps moving. Without it the Volcano
    solution lost (a lava cell stayed open to the air) and a bar was 90° 15 cells along (118° before; now 169°).
  - A reaction that could happen next tick keeps its cell awake (`stepReactions`; salt beside water it can dissolve into; acid
    beside what it eats or clean water; brine beside a sharp salt edge). Diluted acid used to be left over in a pool (29 of 50).
  - Damp sand and clay still gathering speed in mid-air keep falling (`Grid.sticky`): they used to lose their speed on any
    tick without a whole step, and sticky clay hung in the air. Desert bloom's beds now land as laid; its solution wins 7 of
    8 scenario seeds, as on E7.
- The window is 1280×640 (was 960×640: a third more of the world stays alive around the camera) on a world 12800 wide (was
  7680). A busy mid-world tick, 4 seeds: E7 9.5 ms at 960 wide; now 6.3 ms at 960, 8.4 ms at 1280. Saves from the 960-wide
  window load into the left of the new one; the rest is taken from the save's stored regions or generated from its seed, and a
  flat world or a scenario carries its last column across (`validate.js widen`). Scenarios are unchanged: the box sits where it
  did, with more stone to its right.
- Scenarios: the box sits where it did, with more stone to its right. `Game.start` now sets the frame count to 0, so a
  scenario's natural wind (which follows the frame count) is the same every time; before, it depended on how long the sandbox
  had been running. A scenario may pin the wind (`wind`, saved in its definition). Firebreak does: a steady 0.5 east wind
  drives the fire at the west wood. With the natural wind, doing nothing already won on 7 of 8 scenario seeds on E7 (the fire
  burnt out in green grass) and won on its own seed in the wider window; now, over 8 seeds, doing nothing loses 8/8, the
  firebreak wins 8/8 and water alone 6/8.
- Two checks were judged on too few runs to survive any change: `mud` (E7 itself made 9-24 mud across plot seeds against a
  threshold of 20) now sums four plots, and `compete` uses six seeds instead of three (a tree whose leaves all grow above the
  30 rows shade reaches shades nothing; the new build drew two of those in the first three seeds). Under the tree, grass thins to
  0.47 of the open meadow over six seeds (E7: 0.30).
- Structural strength (R5, `Grid.beam`, docs/ENGINE.md): building materials are beams. Laid stone, brick, glass, wood and metal
  with nothing under them bend under their own weight and whatever lies on them, by statics over the span between the columns
  that hold them, against `STR × depth²`. Stone, brick and glass crack where it is worst and the crack runs on; wood bows a
  little then snaps; metal sags along a smooth curve and hangs on like a cable, but softens past 300° and tears once a hot span
  has sagged a quarter of its width. Arches carry their load by thrust: a 30-wide stone arch two thick stands where a flat slab
  three thick cracks and falls. Anything held at neither end falls in one piece; wood floats. Wood and metal used to float in
  the air, and a stone span broke past 10 cells however thick it was. The hills' own rock (generated, or lava set hard), ice
  and charcoal keep their old rule, so a new world sheds as much rubble in its first 30 s as before (82-154 cells over 3 seeds,
  R4 75-165); stone the brush lays is marked (`LAID`, life bit 15; stone's frost cracking is now 7 bits). Powders and liquids
  no longer slip diagonally between two cells of wood or metal (a sagging plank's steps meet corner to corner). Flood defence's
  houses now have footings: two of them stood a row or two clear of the valley floor. `validate.js beams`.
- Plant variety (R6, `Grid.wild`, `aridAt`): Shrub, Cactus and Reed, each living on its own ground. A plant is a stem standing on
  soil; its base cell drinks from the dampest cell of its root zone, grows the stem, a shrub's crown or a cactus's arms, and sows.
  Shrubs drink soil down to 12 (grass needs 40, and up to 140 in the dry season), so they stay green through the summer on dry
  dirt and seed across it; in a damp sward 90% of their seedlings are smothered and under trees they die of shade
  (`validate.js scrub`: 3 shrubs become 37 on dry dirt by late summer while grass beside them cures to sap 0; 8 in a damp
  meadow). Cacti lose sap at 4% of grass's rate, drink wet sand fast, rot in ground damp past 60 and sow only on dry ground,
  six cells clear of another cactus. Reeds root in soaked beds (200+) under at most 5 of water, stand 3 out of it, spread by
  runners and drown in deep water; growing up through water they lift it (`Grid.displace`), so a reed bed doesn't empty a pond.
- Climate: `aridAt(seed, gx)` is slow noise over the world columns plus one desert always 1000 columns east of the page's world
  middle. Arid columns dry soil and water up to 4× as fast. Generation lays deep sand (damp under its surface, so it holds over
  caves) past 0.6, a skin of dirt over sand from 0.3 (scrub), no lakes and thinning grass and trees. Lakes now fill a dip up to
  the lower of its rims within 24 columns (at most 6 deep): before, a lake was the one-row puddle in a dip, and it had soaked
  away within seconds. Two years from seed 12345 (tools/biomes.js): at the start, 70-78 shrubs, meadow and forest hold, a reed
  pond keeps 4-8 reeds; east of it the desert keeps 26-33 cacti over ~410 columns and scrub fire takes shrubs 159 to 79 in the
  second summer, regrowing after. Flat worlds and scenarios have no climate. `validate.js clouds` now measures at column 640,
  clear of seed 12345's own desert at 0-600 (a dry stretch widens the cloud-base spread across the whole window); its line is 90
  (R5 measures 82 there, R6 78-85). Perf A/B vs R5 equal.
- Soil nutrients (R7): dirt, mud and clay carry fertility in the high byte of life (it was "richness", which only trees read and
  nothing ever took away). Sources: rotting litter makes dirt at `LITTER_N` (was 200), rotting roots at `ROOT_N`, river silt
  settles at 140, and ash now dissolves into the soil under it (through grass or litter) for `ASH_N`, at `ASH_WET` a visit once
  rain or damp soil wets it, instead of turning into a cell of dirt at 255. Sinks: water draining down past what a cell holds
  carries `LEACH` of the nutrients in its share of the water (`leached`), into the cell below, or lost into sand; groundwater
  carries them downhill and a spring off; grass, roots and wild plants take them up as they drink and grow. Response,
  `fert(n)`: 1 at `NREF` (60, painted dirt and scenario soil, so scenarios play as before), 0.3 on spent soil, up to 2 on rich.
  It scales grass thickening and runners and whether its seed takes, how often a tree's growth step happens (half-weight) and
  how far it grows (rich soil only), its seed drop, and reed and shrub growth (shrubs half-weight; cacti not at all). A tree's
  `fert` is a running mean of the soil its roots drink from (saved). Generated topsoil starts at `HUMUS` (110) at the surface,
  15 poorer a row down to 40, poorer again in the dry country. Soil view shows it; rich dirt renders darker.
  Measured (`validate.js nutrients`): bare topsoil at 150 rained on hard for 3 min falls to ~48 while the subsoil gains; grass
  on spent soil covers 67 columns in 36 s, on rich soil 200; saplings over 3 seeds grow trunks 40 vs 44 and 346 vs 410 wood in
  1 min; a burnt meadow's ash leaves its topsoil 30 -> ~55. Over two years on 4 seeds (`tools/soil.js`), topsoil settles at
  110-130 where the old build filled to 190-220 with litter, and meadow and tree counts stay within seed noise of R6 (year 2
  trees 8/24/4 vs 3/30/8; the big second-summer wildfires that clear most of the forest on some seeds happen on R6 too).
  Scenarios swept on 6 seeds match R6. Perf A/B vs R6 equal (tick ~9.5 ms p50, render ~5 ms). Test plots now lay dirt at
  `NREF`. Checks that hung on one random stream now take more runs: `dew` averages four plots, `mud` sums eight (four plots
  made 42-67 mud on R6 and 23-95 on R7 by the random stream alone). `compete`'s line is 0.65 of the open: the tree's litter
  makes rich dirt under it (topsoil ~82 there against ~59 in the open), so the grass under it grows back faster (0.60; R6 0.54).
- Animals (R8, `Grid.rabbit`, `Grid.hopper`, docs/ENGINE.md): Rabbit and Grasshopper, one cell each, all state in the cell
  (energy, age, a rabbit's gut seed, a grasshopper's egg bit) so saves and streaming carry them. Rabbits walk the ground keeping
  a heading, hop up 2 (3 over plants), turn back at drops and water, graze grass, shrubs and reeds from the top (a grass base only
  1 time in 10, half the time once hungry), breed in the growing season while fed and not crowded (under 5 within 24 columns),
  lie up over winter (burning energy at 0.3 of the summer rate), run from fire at 2 cells a tick and won't step onto hot ground,
  swim for the shore, and die as litter. Grazing seeding plants fills the gut; droppings feed the soil (`DUNG_N`) and plant the
  seed behind the rabbit (grass, or shrub through `sow`). Grasshoppers hop (the wind carries them in the air), chew sap, breed
  through spring and summer up to 3x as fast in the dry season, lay eggs from late summer, die in the frost; eggs wait in the
  soil pass and hatch in spring. Generated worlds lay a rabbit per ~40 columns of meadow or scrub and an egg per ~12 of grass.
  The season reaches the worker threads through `gf` (the first build read the clock on the worker's own stale grid, and
  `threads.js` caught it). Measured (`validate.js animals`): 8 rabbits on a 160-wide meadow over 4 min of spring grow to ~20
  and leave 140+ columns grassed, 8 on bare dirt all starve; across 60 columns of bare rock no grass arrives in 3 min of
  summer without rabbits and 46-72 cells with 10; 6 of 10 rabbits outrun a cured-meadow fire to bare ground; 5 of 5 swim out
  of a pond; 20 grasshoppers in midsummer leave ~55 eggs, none survive the winter as adults, and the eggs hatch the next spring.
  Three years (`tools/animals.js`, seeds 12345/99/777): rabbits boom each summer and thin out over winter (12345: 35 -> 98-132
  -> 35-111), grasshoppers cycle through eggs (30-80 a summer). Meadow holds up: 12345 ends at 437 columns against 338
  without animals. Big summer wildfires (which hit 99 and 777 without animals too) wipe out the local population on those
  seeds: 777 keeps ~5 rabbits, 99 loses them by year 3. Tuning lessons: a mate within 6 columns was an Allee trap (the
  population drifted to zero); grasshoppers that aged out before late summer never laid eggs.
- Tree size by sun and soil (`Grid.vigour`): each tree keeps `t.sun`, a running share of sampled crown tips (two a growth step)
  with open sky over them by `Grid.shadedFor` (`shaded` without the tree's own leaves), and `t.soil`, a slow mean of `t.fert`
  (seedlings learn both at once). Vigour = (`SUN_LO` + (1-`SUN_LO`)·sun) × min(`VIG_HI`, soil/`SOIL_REF`), clamped to
  `VIG_LO`..`VIG_HI` (0.3..1.6). A segment's `max` is now its length at vigour 1: limbs grow to max·vigour (roots only shrink
  with it), wood thickens to MAXT·vigour, leaf clumps spread up to 3.2·vigour (0.7..1.4), and past 1.3 the trunk and first
  branches put out one more branch each. The growth gate also takes (0.5+0.5·sun). Limbs now stop at rock, walls and other
  trees' wood (`limbRoom`), and a limb doesn't lengthen if that would push a branch it carries into one (`limbsClear`): trees
  used to tunnel up through overhangs. Seeds leave from past a big tree's wider leaves. Shrubs set their height on rooting
  from soil fertility (2-6 cells, was 3-4) and grass on spent soil (fert under `GRASS_POOR`) only bushes to two cells.
  Saves carry `sun` and `soil` (older saves load at full sun on their `fert`). Measured (`validate.js vigour`, four seeds): on
  watered plots over two days a sapling on rich soil grows 100-107 tall (trunk 71) and 84-100 wide, one on poor soil 28-34, and
  one on rich soil under a rock overhang 21 (trunk 12-17). Generated year (`tools/trees.js`): trees spread out by place where they
  used to come out alike. Seed 12345 after a year: heights p10 34, median 55, p90 90, max 99 (main: 49, 60, 71, 71); seed 99:
  17, 43, 74, 78. Understory trees under a canopy average 28-36 tall, open-ground ones 50-70, and young trees on rich soil
  in the open reach 60 by age ~60. The trees a new world grows at the start drink its fresh humus, so they come out about
  as big as before. Perf A/B on the same year-old save: tick p50 10.8 vs 10.1 ms. `nutrients`' burnt-meadow check now sums
  four plots: one plot passed with under a quarter of the ash left by luck (main leaves 88 of 334 over the four; this build 89).

## Taller, narrower map and a faster tick (N0 + N1)

- The window is 960×960 (was 1280×640) on a world 6400 wide (was 12800): 320 more rows in all, 160 of them sky over the hills
  and 160 of deeper ground. The page starts in the middle (window at 2560) with the near desert just east of it.
- Old saves: a save from the 1280-wide window loads into one of its own width, which keeps its left 960 columns and puts the
  last 320 into the store as a region (`Grid.narrow`; a flat world or a scenario just loses them), so walking right brings
  them back. Generated worlds line their land up with the land here; flat worlds and scenarios line up their bottoms, so the
  scenario box lands where `BOX` now is (`validate.js narrow`, `sky`, `widen`).
- Sleeping, tightened (measured with `tools/prof.js` and a census of what kept each awake block awake):
  - Heat lane: a block woken only by heat flowing (`Grid.warm`, dirty 2) steps one tick in `LANE` (4), staggered across blocks,
    taking four ticks of heat at once, implicitly in its own temperature so the big step can't overshoot. Anything else that
    wakes it puts it back on every tick. Metal still wakes fully (a bar's warm front would crawl). Hot cave air rising
    (convection) wakes onto the lane too.
  - Rock needs a heat flow of 1 (`WAKEQ[STONE]`, was 0.3) to stay awake: the rock round a lava chamber has no sink and warmed
    for ever, keeping a ring of rock a hundred cells across awake.
  - Lazy cells (lava, molten glass, mud, snow, litter) only keep their block awake while they could still move or are moving
    (`canSlump`, `VX0`); lava and snow never slept before.
  - Cave gas under a roof (nothing open over it or diagonally over it) stops wandering sideways and sleeps (`gasRoom`).
  - Oil (no surface tension) lying still on still oil only moves along the surface toward somewhere lower, and the wave pass
    calls an oil surface a cell rough level (`SW_ROUGH`): a part-filled top row wandered for ever.
  - Generation: the permafrost round ice veins thaws out over a few cells at its edge instead of stopping dead, and salt and
    gunpowder in it are as cold as the rock; air masses no longer reach down into caves (`mfade` fades out `MASS_DEEP` rows
    under `skyY`). Both were heat flowing from the first tick for thousands of ticks.


## Devices (X1)

- A Devices row in the sandbox rack: Spout, Drain, Heater, Cooler and Fan. They are elements (appended after Grasshopper, so
  old saves keep their ids) stepped by `Grid.device` in the cell pass, so they stream with the window, save with the world and
  run on the worker threads like everything else. They stand where they are put (no support check), bear what lies on them,
  and fire, lava, acid and explosions leave them be; only Erase removes them. Scenarios never offer them.
- Spout: its life is the element it pours (the page sets it to the powder, liquid or gas chosen last; the button reads
  "Spout · Water"). Each tick it puts one cell, with chance `SPOUT_P`, into an empty cell beside it: below first (above for a
  gas), then a side. Boxed in, it lets its block sleep until something beside it moves.
- Drain: swallows any powder, liquid or gas in its four neighbours every tick (the hole wakes whatever lies over it).
- Heater and Cooler: hold their own temperature at 400° and -40° every tick, with metal's conductivity; the heat flowing out
  of them keeps their blocks awake while there is anything to warm or chill.
- Fan: its life is the way it blows (0 east, 1 up, 2 west, 3 down; pressing Fan again turns it). Only a face with no fan in
  front of it blows: it pushes what lies ahead, up to `FAN_REACH` (24) cells or a wall, one cell a tick from the far end back,
  a gas with chance `FAN_GAS`, a powder or liquid with `FAN_POWDER` or `FAN_LIQUID` over its density, fading with distance.
  A powder or liquid blown sideways leaves at `FAN_THROW` cells a tick so it carries on past the reach.
- Tests: `validate.js devices` (spout pours for ever, a drain empties a basin, sand/lava/oil/smoke spouts, a heater boils a pot
  dry, a cooler freezes a pond, a fan blows ash and smoke, devices survive an explosion and a save, a boxed-in spout sleeps);
  `ui.js` paints an oil spout and turns a fan through the page. `same.js` against main: worlds without devices are identical.
- The in-game help now says the world is 6400 cells (twenty screens) wide with a 960×960 window.
- Perf (this container, `steady.js`, alternating runs): main 9.97 / 9.04 ms, this build 11.01 / 8.85 ms (seeds 12345 / 7),
  the same world either way and within run-to-run noise. A view with two spouts, a drain, a heater, a cooler and a fan
  running in it: 11.41 / 10.24 ms against 10.26 / 11.51 without, again noise.


## Conifers, the treeline and succession (N4)

- A tree entity now has a kind: `t.con` marks a conifer (saved in the tree record; old saves load as broadleaf). A seed's kind is
  `Sim.CONE` (bit 8) in its life, so a conifer's seeds grow conifers; birds and rabbits carry broadleaf seed. The sapling
  marker (Tip) carries the bit too. The brush rack has a Cone button beside Seed (it comes with Seed's unlock, sandbox only).
- Shape (`Grid.growConifer`): one straight trunk; whorls of two drooping branches added 2.5 cells apart just under the leader,
  each reaching out 1 + 0.33 × its distance below the top, so the crown is a spire; past `CON_TIERS` whorls, or low on a tall
  trunk, the lowest whorls die off and fall as litter. Needles (leaf cells with life 2, drawn dark blue-green) run along every
  branch and close round the trunk through the live crown. Conifers are evergreen (they only shed under drought).
- Site warmth (`Grid.warmth(y)`): the yearly mean air temperature at row y, the lapse rate without the season. `Grid.hardy(con,y)`
  is 1 down to `BROAD_FULL` (11.5°) or `CON_FULL` (9.5°) and 0 at `BROAD_LINE` (9.5°) or `CON_LINE` (8°). It multiplies the
  growth gate, stunts vigour (0.4 + 0.6 × hardy), and a seed only sprouts where it is over 0.25. On generated worlds that puts
  broadleaf trees below about 62 rows over the reference level, conifers up to about 75, and nothing over that.
- Conifers grow from earlier in spring to later in autumn (`growthCold`), mind shade (`CON_SUN_LO` 0.5) and poor soil less, get
  little from rich soil (`CON_SOIL_HI`), shoot up while young (`CON_YOUNG`), sprout on soil damp to `CON_DAMP` (30, against 45),
  stand twice the drought, and fare badly in warm valleys (past `CON_HOT` 13° vigour falls and they live 0.6 as long).
- Fire: needles catch at `CON_FUEL` (0.1, leaves 0.06) and a conifer that loses half its needles to fire dies. Its cones then
  open: once the ground has cooled (`CON_OPEN` growth steps, then retried while it still burns) `CON_CONES` seeds fall within
  10 columns. Conifer seed looks through 4 cells of ash, charcoal or litter to the soil and lies dormant 4 times as long.
- Generation picks each tree's kind by its site: a conifer for sure where it is too cold for a broadleaf, likelier toward the
  dry country, `CON_PIONEER` (12%) in the warm valleys; stands are denser up the hills and absent over the conifer line.
- Census: `conifers` and `broadleaf` counts, and a fourth chart panel, Trees. The inspector says broadleaf or conifer, leaf or needles.
- Tests: `validate.js conifers` (10 checks: sprouting by altitude, spire shape, evergreen, who outgrows whom in a rich valley and
  on an upland, crown fire and cone seeding, a new world's treeline); `seasons` now counts broadleaf leaves only; `ui.js` sows a cone.
- Long runs (`tools/forest.js`, 4 years): big lightning and dry-season wildfires kill most trees on main as well. Seed 7 ends
  with 7 trees here against 6 on main, seed 99 with 5 against 5, seed 12345 with 6 against 18. The conifers hold the uplands,
  but four years is too short to see broadleaf trees take valleys back from pioneer conifers.
