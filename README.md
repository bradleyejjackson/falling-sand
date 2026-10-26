# Sandfall

A falling-sand simulation prototyped as a single HTML file (`falling-sand.html`), headed for a Godot port once the design settles. Published as a Claude artifact.

The script has two blocks: `Sim` (pure rules, no DOM; this is what ports to Godot) and the render/input block.

## Tests

Headless checks run in Node (no dependencies):

```
node tools/validate.js        # all scenarios, or name some: sapling sand soak topple rot seasons snow
                              #   shadow updraft fog dew clouds erosion lava tension salt acid canopy save
SIMFILE=other.html node tools/validate.js   # run them against another copy of the page
node tools/ui.js              # runs the whole page against a stub DOM and pokes the UI
node tools/perf.js [seed]     # generates the 960x480 world and times step() and render
```
