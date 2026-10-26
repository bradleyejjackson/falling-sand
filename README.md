# Sandfall

A falling-sand simulation prototyped as a single HTML file (`falling-sand.html`), headed for a Godot port once the design settles. Published as a Claude artifact.

The script has two blocks: `Sim` (pure rules, no DOM; this is what ports to Godot) and the render/input block.

## Tests

Headless checks run in Node (no dependencies):

```
node tools/validate.js        # all scenarios, or name some: sapling sand soak topple rot seasons snow
                              #   shadow updraft fog dew clouds erosion lava tension salt acid canopy save
                              #   tiles stream (stage 4)
SIMFILE=other.html node tools/validate.js   # run them against another copy of the page
node tools/ui.js [serial|threads]   # runs the whole page against a stub DOM and pokes the UI, on one thread and on workers
node tools/threads.js [n] [frames]  # n worker threads must give exactly the world one thread gives; times both
node tools/perf.js [seed]     # generates the 960x480 world and times step() and render
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
