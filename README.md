# Sandfall

A falling-sand simulation prototyped as a single HTML file (`falling-sand.html`), headed for a Godot port once the design settles. Published as a Claude artifact.

The script has two blocks: `Sim` (pure rules, no DOM; this is what ports to Godot) and the render/input block.

## Tests

Headless checks run in Node (no dependencies):

```
node tools/validate.js        # stage 2 ecology scenarios (or name some: sapling soak topple rot seasons snow save)
node tools/ui.js              # runs the whole page against a stub DOM and pokes the UI
node tools/perf.js [seed]     # generates the 960x480 world and times step() and render
```
