# Sandfall

A falling-sand simulation prototyped as a single HTML file (`falling-sand.html`), headed for a Godot port once the design settles. Published as a Claude artifact.

The script has two blocks: `Sim` (pure rules, no DOM; this is what ports to Godot) and the render/input block.

## Tests

Headless checks run in Node (no dependencies):

```
node tools/validate.js        # all scenarios, or name some: sapling sand soak topple rot seasons snow
                              #   shadow updraft fog dew clouds erosion lava tension salt acid canopy save
                              #   tiles stream (stage 4) sky
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
- The view is 320×240 (4:3); in a scenario it shows the box with 40 rows of sky above it.
- Saves from the 480-row world load into the taller one with the sky added on top (cells, trees, vapour and stored regions shifted
  down; `validate.js sky`).
