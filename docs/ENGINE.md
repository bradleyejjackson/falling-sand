# The Sim engine, for the port

This is the contract the `Sim` block in `falling-sand.html` keeps, written down so a Godot port (C# or GDExtension) can
reproduce it. The render/input block is browser-only and gets replaced wholesale; everything here lives in `Sim`.

## Data

Every field is a flat typed array, carved out of one buffer (`FIELDS`, `layout()`), so a port can lay them out as plain
arrays (or one native allocation) and share them with worker threads unchanged. Scopes:

| scope  | size                         | what                                                                  |
|--------|------------------------------|-----------------------------------------------------------------------|
| cell   | W×H                          | `type` u8, `life` u16, `shade` u8, `done` u8, `temp` f32, `fuse` f32, `vx`/`vy` f32, `owner` u16 |
| chunk  | (W/SC)×(H/SC), SC = 4         | `dirty` (awake this tick), `next` (woken for the next)                 |
| air    | (W/AC)×(H/AC), AC = 4         | vapour `hum`, capacity `cap`, open fraction `airF`, `airT`, `chill`    |
| wind   | (W/CH)×(H/CH), CH = 16        | MAC grid: `u` on vertical faces, `v` (vface scope) on horizontal ones, `pres`, cell-centred `uc`/`vc` |
| row/col| H / W                        | `ambRow` (ambient temperature by row), `precip` (rain gauge); waves: `swu` (flow speed through each column's right face), `swq` (part of a cell carried so far), `swr` (surface row they belong to), `swp` (current from pressure moves) |
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
3. `endStep`, on one thread: deferred work (every `PRESS_EVERY` (4) ticks, the pressure search; the wave pass; saplings become trees), trees, the soil pass (every 8th row, `SLOW`), the air pass
   (every 4th coarse row, `AIRSLOW`), the wind solve (every 4th tick), the clock and climate.

### The cell pass

Inside a tile, rows bottom to top; within a row, sleep blocks left to right on even frames and right to left on odd ones
(cells too). Blocks not marked `dirty` are skipped whole. For each cell of an awake block:

1. Heat: diffuse with the 4 neighbours (pairwise `KH`, divided by heat capacity; air also bleeds toward `ambRow`), hold floor
   (`HOLDT`: burning things stay hot). If the heat gained or lost (degrees × capacity) is over `WAKEQ` (0.3; metal 0.05), wake.
2. Phase change (`phaseHeat`) only for types that can (`SLOWHEAT`, or past `HIAT`/`LOAT`, or burning oil): latent-heat melting
   and freezing, boiling, ignition, explosions. A cell that changed is done for this tick.
3. `INERT` statics (stone, metal, brick, glass, wood, ...) stop here, after a support check if they have a `SPAN`.
4. Empty air: hot air under cooler air swaps up (convection).
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

### Sleeping

A cell is only stepped if its 4×4 block was woken during the last tick. `wake(x,y)` marks every block within 2 cells of (x,y).
What keeps a cell awake is that something calls `wake` near it: moving (`swap`, `set`), heat still flowing (step 1), a life
counter running down, a reaction that could happen next tick (`stepReactions`, salt next to water it can dissolve into, acid
next to what it eats), clouds, lazy liquids that could still slump. A process that waits on chance must wake itself, or it
stops when its block sleeps. The soil pass and the air pass run on sleeping ground too.

## Determinism and checks

- All randomness is `R()`, a seeded mulberry32 stream (`reseed`). Never `Math.random` in Sim.
- `tools/threads.js`: N worker threads must give exactly the world one thread gives.
- `tools/same.js`: two builds of the page must give exactly the same world, field by field, frame by frame. Use it for any
  change meant to be a pure speed-up (`BASE=old.html node tools/same.js`). A port can't match JS bit for bit (float rounding,
  Math.exp), so it is checked the way changes that alter behaviour are: `tools/validate.js` (measured physics) and
  `tools/game.js` (every scenario's scripted solution wins, doing nothing loses).

## Streaming

The grid is a window of `WORLD.W`×`WORLD.H` (1280×640) onto a world `WORLD.WIDE` (12800) cells across. It moves `REGION` (320)
columns at a time (`shiftWindow`): the region leaving is run-length packed into `store`, the region arriving is unpacked or
generated from world-coordinate noise, so land is the same however you got there. A save from a narrower window loads into
the left of the window and the rest is filled from the store or generated (`Grid.widen`).

## Speed (E8)

Busy middle-of-the-world tick, 4 seeds: 9.5 ms in the 960-wide window before; 6.3 ms after; 8.4 ms in the 1280-wide window.
Where it came from: the heat step inlined into the cell pass with flat double tables (1.28x together with Sets and objects
turned into tables, a fixed object shape for `Grid`, and a cheaper `wake`, all leaving the world bit-for-bit the same), and
4×4 sleep blocks instead of 16×16 chunks (a moving grain kept up to 1024 cells awake, now 64).
