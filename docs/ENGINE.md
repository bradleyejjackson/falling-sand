# The Sim engine, for the port

This is the contract the `Sim` block in `falling-sand.html` keeps, written down so a Godot port (C# or GDExtension) can
reproduce it. The render/input block is browser-only and gets replaced wholesale; everything here lives in `Sim`. The data a port
carries over (fields, elements, `life` layouts, records, the save, every constant) is in [PORT.md](PORT.md), checked against the code.

## Data

Every field is a flat typed array, carved out of one buffer (`FIELDS`, `layout()`), so a port can lay them out as plain
arrays (or one native allocation) and share them with worker threads unchanged. Scopes:

| scope  | size                         | what                                                                  |
|--------|------------------------------|-----------------------------------------------------------------------|
| cell   | W×H                          | `type` u8, `life` u16, `shade` u8, `done` u8, `temp` f32, `fuse` f32, `vx`/`vy` f32, `owner` u16 |
| chunk  | (W/SC)×(H/SC), SC = 4         | `dirty` (awake this tick), `next` (woken for the next)                 |
| air    | (W/AC)×(H/AC), AC = 4         | vapour `hum`, capacity `cap`, open fraction `airF`, `airT`, `chill`    |
| wind   | (W/CH)×(H/CH), CH = 16        | MAC grid: `u` on vertical faces, `v` (vface scope) on horizontal ones, `pres`, cell-centred `uc`/`vc` |
| aircol | W/AC                         | `sky` (first ground row), air masses: `massT` (how much warmer than usual), `massH` (the humidity it brings), lightning: `charge`, `struck` (frame of the last strike) |
| row/col| H / W                        | `ambRow` (ambient temperature by row), `mfade` (how much of an air mass's warmth each row has), `precip` (rain gauge); waves: `swu` (flow speed through each column's right face), `swq` (part of a cell carried so far), `swr` (surface row they belong to), `swp` (current from pressure moves) |
| types  | 64                           | `made`: cells turned into each element (game scoring, `Atomics.add`)   |

Per-element constants are flat tables indexed by type id (`KIND`, `CAPT`, `HOLDT`, `HIAT`, `LOAT`, `KH` N×N conductance,
`FUSE`, `SPAN`, `SUPPORTS`, `SOURCE`, `INERT`, `FUEL`, `WAKEQ`, and the reaction lists `RXA` by `a*N+b`). The cell pass reads
those and the double-width copies (`KHD`, `CAPD`, ...), never the `EL` objects, except on rare paths (phase changes).

## One tick (`Grid.step`)

1. `beginStep`: `dirty = next`, clear `next` and `done`; list the awake 64×64 tiles of each of the 4 checkerboard phases. The
   tiling shifts by a hashed 0-3 chunks each tick (`C_JX`/`C_JY`) so no spot is always a tile border.
2. The cell pass (`stepTile` for every listed tile, phase by phase). A tile only touches cells within `REACH` (32) of itself, so
   tiles in one phase can run on any number of threads. Each tile seeds the random stream from the frame seed and its index
   (`reseed(mix(seed, tile))`), so the result doesn't depend on thread count or tile order.
3. `endStep`, on one thread: deferred work (every `PRESS_EVERY` (4) ticks, the pressure search; the wave pass; spans of building material are judged (`beam`); saplings become trees), trees, the tide (`tide`, see The sea), the soil pass (every 8th row, `SLOW`), the air pass
   (every 4th coarse row, `AIRSLOW`; the air masses are worked out just before it, `updateMasses`), the wind solve (every 4th
   tick), storms and lightning (`stepStorms`), the clock and climate.

### The cell pass

Inside a tile, rows bottom to top; within a row, sleep blocks left to right on even frames and right to left on odd ones
(cells too). Blocks not marked `dirty` are skipped whole. For each cell of an awake block:

1. Heat: diffuse with the 4 neighbours (pairwise `KH`, divided by heat capacity; air also bleeds toward `ambRow`), hold floor
   (`HOLDT`: burning things stay hot). If the heat gained or lost (degrees × capacity) is over `WAKEQ` (0.3; metal 0.05, stone 1),
   wake onto the heat lane (`warm`; metal wakes fully). A block on the heat lane (dirty 2) steps only on ticks where
   `(frame + bx + by) % LANE == 0` (`LANE` 4) and then takes `LANE` ticks of heat in one implicit step:
   v' = (v + L/cap · Σ k·T) / (1 + L/cap · Σ k), the sums over the 4 neighbours (and the ambient for air, k 0.03). On its other
   ticks it is skipped and re-marks itself (2) in `next`. Any `wake` (1) takes it off the lane.
2. Phase change (`phaseHeat`) only for types that can (`SLOWHEAT`, or past `HIAT`/`LOAT`, or burning oil): latent-heat melting
   and freezing, boiling, ignition, explosions. A cell that changed is done for this tick.
3. `INERT` statics (stone, metal, brick, glass, wood, ...) stop here, after a support check if they have a `SPAN` (`stepSupport`: the
   ground's own rock settles or crumbles by its local rule; a building material with nothing bearing under it defers itself to `beam`).
4. Empty air: hot air under cooler air swaps up (convection); this wakes onto the heat lane.
5. Everything else: reactions (`RXA`, fire lighting fuel, salt dissolving, acid), then by kind: powders and liquids move
   (`stepMobile`), gases (`stepGas`, `stepCloud`, `stepSteam`), statics with a life counter (`stepLife`) or behaviour
   (`stepStatic`: embers, saplings, grass).

### Pressure

A liquid cell at rest that can't move asks, at 1% a tick, to be pushed (`defer(-1-cell)`), so the search can cross tiles. Every
`PRESS_EVERY` ticks `pressure()` takes the cells that asked, sorted, and for each searches its whole body (breadth-first, no cap,
one search per body shared by every cell of it that asked) for free surface cells that water would lie in (empty, not under the
liquid, over something solid or liquid). The highest one lower than the top of the asking cell's column (by at least
`PRESS_GAP` rows) gets the cell (a random one of that row's free cells). A cell that pushed asks again next time (up to `PUSHING`, 64), so an out-of-level body keeps levelling itself, asleep
or not, and stops when it is level. The search costs ~0.05 ms a tick in the generated world.

### Waves

Deep liquid (`SW_MIN`, 4, or more) and fast sheets move by the shallow-water equations, not by single cells sliding. In the cell
pass the top cell of such a column only registers (`defer(W*H+cell)`); cells under it wait. Specks, a dam face over open space,
and slow surface cells still use the cell rules. `waves()` then runs in `endStep`, once per tick, in `SW_SUB` (3) substeps:

1. Faces: the right and left face of each registered column (per column, the top with the most liquid under it).
2. Plan (Jacobi, all faces from the same state): speed `u` gains `SW_G` × slope, where the slope is the surface over `SW_WIDE`
   (4) columns each side plus the parts of cells still owed by the neighbouring faces; keeps `SW_KEEP`, loses bed drag
   `SW_BED/depth²`, and a little viscosity `SW_NU` toward its neighbours. `q += u × depth` is the part of a cell owed.
   Slow (`SW_SLOW`) flow on a level (`SW_LEVEL`) surface stops; thin water (under `SW_MIN`) slower than `SW_SHEET` is left to the
   cell rules, where surface tension holds puddles.
3. Move whole cells (faces in index order, then reversed on alternate substeps): from the top of the upstream column onto the
   top of the downstream one, at most `SW_CLIMB` (1) over where it came from and only when running faster than `SW_RUN`; over a
   drop of more than `SW_DROP` it leaves level, to fall. Floaters on the moved cell go with it.

A gap of up to `SW_GAP` (2) cells of air inside a column doesn't split the body (`surface`, `depth`), so churned water still
reads as one surface. Faces that moved or still slope wake their columns. Gauss-Seidel order or integer moves without the owed
parts are unstable; so is letting water climb more than a cell (it builds spikes and froth).

Pressure moves only outlets at least `PRESS_GAP` (4) rows below the asking column's top: smaller tilts are the waves' to level.
Each pressure move adds to `swp` along every column it passed, so floating things ride a river even where pressure carries
most of its water.

### Air masses, fronts and lightning

The air comes in bands `MASS_L` (2000) cells across, give or take `MASS_JIT`, warm and humid (odd bands) and cold and dry (even
ones) in turn, at 55-100% of `MASS_T` (4°). Their pattern hangs off world columns (`massEdge`, `massOf`, hashed from the world
seed), shifted by one number, `massX`, which grows by `STEER` (0.25) + `STEER_W` × the prevailing wind a tick: the weather drifts
east. `updateMasses` fills `massT`/`massH` per coarse column from it every tick, so streaming and saves need only `massX` (the
last field of a save; a world without it keeps the weather it had). At each band edge the western air is the one advancing: a
cold front if it is the colder, blended over `FRONT_COLD` (48) columns; a warm front over `FRONT_WARM` (360).

- Temperature: the air's usual temperature at (x,y) is `ambRow[y] + massT[x>>2] × mfade[y]` (`airAt`): all of a mass's warmth
  up to `MASS_LOW` rows over `skyY`, none above `MASS_TOP`. Air in the cell pass and sleeping air and ground in the soil pass
  relax toward it, and rain or snow is chosen by it. The wind feels it through `wheat` (buoyancy), so cold air undercuts warm.
- Humidity: the air within `MASS_MIXH` rows of the ground drifts toward the mass's humidity (`MASS_MIX` a visit), at the mass's
  own temperature (air heated by a fire takes up no more: that was a runaway that filled the sky).
- Pressure: `pressureAt(x)` = `P0` − `PRESS_K` × `massT` − `TROUGH` × the change across `FRONT_SPAN` columns (display only).
- Squall: where the change across `FRONT_SPAN` coarse columns is more than half a band's (only a cold front is that sharp), the
  ground cell's air pass calls `squall`: the air the front lifts rises to its cloud base (its dew point, from the band's
  humidity) and builds cloud cells upward from there, up to `STORM_UP` × warmth × season rows tall, and saturates the air of
  the tower it passes through. The water comes from the air mass, not the cell's own vapour.
- Lightning (`stepStorms`, every `LSCAN`-th coarse column a tick): a column with more than `STORM_N` cloud cells strikes with
  chance `STRIKE_P` × (cells over)², or once its `charge` reaches 1 with at least `STORM_MIN` cells: `squall` adds `CHARGE_K` ×
  the rows of updraft × the front's sharpness to `charge` each visit, and `stepStorms` keeps `CHARGE_KEEP` of it a scan (a
  front's cloud tower is only ~10 cells deep over hills, too shallow for the depth rule alone). `strike` picks the highest point within `STRIKE_R` columns (metal counts `STRIKE_METAL`
  higher), runs a jagged channel to it (hitting whatever it meets first), and heats the hit and its neighbours to `STRIKE_T`;
  fuel catches with chance `STRIKE_CATCH` + the rest × the season's dryness, or is left alone. `bolts` (cells of each channel,
  `BOLT_T` ticks) are for drawing only. A strike zeroes `charge` and sets `struck` (its frame) within `STRIKE_R` columns, which then can't strike for `STRIKE_GAP` ticks, and
  cloud whose base is under `STORM_CLEAR` rows off the ground (fog) doesn't count. Generated and flat worlds have fronts and
  lightning (`weatherOn`); a bare `Grid` has neither, and scenarios run with one air mass and no lightning (`Game.weather`).

### Structural strength (R5)

Building materials (`SPAN`: laid stone, brick, glass, wood, metal) are beams. The cell pass only settles what bears straight down
(`bears`: through a heap of powder to what it lies on, onto a liquid denser than it, never through powder onto another span); a
cell with nothing bearing under it defers its index, and `endStep` runs `beam(x, y)` on it, which reads up to `BEAM_MAX` (96)
columns either way (further than a tile's `REACH`, hence on the main thread):

1. Columns (`bcolumn`): the vertical run of building material through the cell (down up to `BEAM_DOWN`, up to `BEAM_UP`), its
   weight plus the load lying on it (`WT`, up to `BEAM_LOAD` cells), and whether it bears on something. A run of `BEAM_DEEP` (8)
   or more is solid. A run containing the ground's own rock is held.
2. Walk left and right through overlapping runs to the first held column (or an abutment: solid beside the run that is itself
   borne up, or the window edge) or a free end. Held at neither end: every column drops a row (it falls in one piece).
3. Moments by statics (simply supported, or a cantilever from its held end); an arch's thrust (`H` from the crown, if it rises a
   tenth of its span or more) takes moment back and adds `H × depth / 2` to what the ring takes. Capacity `STR × depth²`, less
   for hot metal and glass.
4. Brittle (`BRK` 1): the worst column's bottom cell cracks to `FALLS_AS` (chance `BEAM_BREAK`). Tough: the span sags a row
   deeper along a parabola (chance `SAG_K` × overload), relieved by `CAT`; wood snaps past `BRK` or `SAGMAX` of its length, metal
   tears where it is worst once it has sagged a quarter of its span.

Every column of the judged span is marked for the tick (`beamSeen`), so one span is judged once. Held spans set the settled bit
(life bit 0); the soil pass re-opens settled spans now and then (`audit`, `BEAM_AUDIT`), so a load piled on later is felt. Stone
the brush lays carries `LAID` (life bit 15; stone's cracking is bits 8-14) and is a building material; generated rock is not.

### The sea (N7)

A world `SEA_WORLD` (2880) columns wide or more has a sea at its west end: brine (`SEA_SALT`) from its mean level (`sea.y`) down to a
floor shaped by `seaSurf`, with a beach, a salt marsh or a cliff for a coast (`seaOf`, from the seed). It is all terrain: nothing
of it is saved but the cells. `Grid.seaCols` works out per window what of it lies there (`seaOn`, `seaEdge`, and per air and
wind column `seaM`, `seaB`). `tide()` runs in `endStep`: where the window's west side is out at sea (`seaEdge`), its `SEA_EDGE`
columns are held at the tide's level of the moment plus a swell (adding or removing at most `SEA_STEP` brine cells a column), and
the flow of the deep water (`swu`) is pushed by a travelling sine (`SWELL_F`), so waves run in to the shore through the wave pass. A
marsh's flat is flooded and drained to the tide directly, a cell a column a tick (its reeds would dam the flow). In the soil pass
the surf (brine within `SURF_D` of its surface) wears rock beside it (`wear`: stone's cracking bits, to rubble at 127), grinds rubble
to sand and rolls grains to and fro (`surfGrain`). `updateMasses` makes the air over the coast more humid and milder (`seaM`), and
`stepWind` adds a sea breeze to the lowest wind cells near the shore by day and a land breeze by night (`seaB`).

### Animals (R8)

Rabbits and grasshoppers are single cells: statics (`ANIMAL`) that `stepStatic` hands to `rabbit` and `hopper` every tick. All
their state is in the cell, so streaming and saves carry them like any other cell (`KEEP_LIFE`): `life` holds energy (low byte),
age (bits 8-12), a rabbit's gut seed (bits 13-14) and a grasshopper's egg bit (15); the sign of `vx` is the way a rabbit is
heading (|vx| 2: running from fire). Every move is a `swap` of at most 3 cells, and the widest look (`near`, crowding, 24 columns;
`fireNear`, 16) stays inside a tile's `REACH`, so animals run on any thread. A living animal keeps only its own sleep block awake
each tick (like a storm cloud); its moves wake the rest. An egg doesn't wake anything: it waits in the soil pass (`egg`), which
hatches it in spring. Grazing and chewing only write the plant cells they eat (`graze`, `chew`); a rabbit's droppings feed the
soil (`feed`) and plant the seed in its gut behind it (grass directly, scrub through `sow`).

### Sleeping

A cell is only stepped if its 4×4 block was woken during the last tick. `wake(x,y)` marks every block within 2 cells of (x,y).
What keeps a cell awake is that something calls `wake` near it: moving (`swap`, `set`), heat still flowing (step 1), a life
counter running down, a reaction that could happen next tick (`stepReactions`, salt next to water it can dissolve into, acid
next to what it eats), clouds, lazy cells (lava, molten glass, mud, snow, litter) that could still slump or are still moving
(`canSlump`, `VX0`). A process that waits on chance must wake itself, or it stops when its block sleeps. Things that rest:
cave gas with nothing open over it (`gasRoom`); a cell of a liquid without surface tension lying still on still liquid of its
kind, unless a drop lies within its spreading reach; a wave-pass surface less than `SW_LEVEL` (water, brine, acid) or
`SW_ROUGH` (oil, 0.07: a cell rough) off level and slower than `SW_STILL`. Blocks woken only by heat flow are on the heat lane
(see the cell pass). The soil pass and the air pass run on sleeping ground too. A front's storm cloud cells (cloud with life 1) keep only
their own block awake, not the blocks round it (they wake those as they move): a ragged storm cloud kept half the sky awake.

## Determinism and checks

- All randomness is `R()`, a seeded mulberry32 stream (`reseed`). Never `Math.random` in Sim.
- `tools/threads.js`: N worker threads must give exactly the world one thread gives.
- `tools/same.js`: two builds of the page must give exactly the same world, field by field, frame by frame. Use it for any
  change meant to be a pure speed-up (`BASE=old.html node tools/same.js`). A port can't match JS bit for bit (float rounding,
  Math.exp), so it is checked the way changes that alter behaviour are: `tools/validate.js` (measured physics) and
  `tools/game.js` (every scenario's scripted solution wins, doing nothing loses).

## Streaming

The grid is a window of `WORLD.W`×`WORLD.H` (960×960) onto a world `WORLD.WIDE` (6400) cells across. It moves `REGION` (320)
columns at a time (`shiftWindow`): the region leaving is run-length packed into `store`, the region arriving is unpacked or
generated from world-coordinate noise, so land is the same however you got there. A save from a narrower window loads into
the left of the window and the rest is filled from the store or generated (`Grid.widen`); one from a wider window loads at its
own width and hands over its left part, the rest going into the store (`Grid.narrow`). A save from a shorter grid is shifted
down: a generated world so its land lines up (`g.top`; ground it lacks is filled in as rock), a flat world or scenario so its
bottom does. The land is laid out in the bottom `LAND_H` (640) rows, with the hills placed as in a `SURF_H` (480) row land.

## Speed (E8)

Busy middle-of-the-world tick, 4 seeds: 9.5 ms in the 960-wide window before; 6.3 ms after; 8.4 ms in the 1280-wide window.
Where it came from: the heat step inlined into the cell pass with flat double tables (1.28x together with Sets and objects
turned into tables, a fixed object shape for `Grid`, and a cheaper `wake`, all leaving the world bit-for-bit the same), and
4×4 sleep blocks instead of 16×16 chunks (a moving grain kept up to 1024 cells awake, now 64).
