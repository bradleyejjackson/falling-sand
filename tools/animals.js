// Animals over the years: generate the page's world (OX shifts the window east by that many columns, a multiple of Sim.REGION)
// and run it, logging each season how many rabbits, grasshoppers and eggs there are, how many columns are meadow and scrub, and how
// many cells of grass stand. Neither animal should die out or take over, and the meadow should hold up under them.
// Foxes and birds are counted too.
// usage: node tools/animals.js [seed] [seasons]   (SIMFILE=other.html runs another copy; NOANIMALS=1 clears them at the start, for a
// baseline; SAVE=file saves the end, LOAD=file starts from one)
const { loadSim } = require('./load');
const Sim = loadSim(process.env.SIMFILE);
const seed = +(process.argv[2] || 12345), seasons = +(process.argv[3] || 8);
const { E, PLANT, SHRUB, WATER, RABBIT, HOPPER, FOX, BIRD } = Sim.ids;
const g = new Sim.Grid(Sim.WORLD.W, Sim.WORLD.H);
if (process.env.LOAD) { Sim.reseed(seed); g.load(require('fs').readFileSync(process.env.LOAD, 'utf8')); }
else Sim.generate(g, seed, Sim.WORLD.WIDE, Math.floor((Sim.WORLD.WIDE - g.W) / 2 / Sim.REGION) * Sim.REGION + (+process.env.OX || 0));
if (process.env.NOANIMALS) for (let i = 0; i < g.type.length; i++) if (g.type[i] === RABBIT || g.type[i] === HOPPER || g.type[i] === FOX || g.type[i] === BIRD) g.set(i, E);
// NOFOX=1 / NOBIRD=1 clear just the foxes or the birds (to see what each changes)
for (const [k, t] of [['NOFOX', FOX], ['NOBIRD', BIRD]]) if (process.env[k]) for (let i = 0; i < g.type.length; i++) if (g.type[i] === t) g.set(i, E);
function survey() {
  const r = { rabbits: 0, hoppers: 0, eggs: 0, foxes: 0, birds: 0, nests: 0, grass: 0, meadow: 0, scrub: 0 };
  for (let i = 0; i < g.type.length; i++) { const t = g.type[i]; if (t === RABBIT) r.rabbits++; else if (t === HOPPER) { if (g.life[i] & Sim.EGG) r.eggs++; else r.hoppers++; } else if (t === FOX) r.foxes++; else if (t === BIRD) { if (g.life[i] & Sim.EGG) r.nests++; else r.birds++; } else if (t === PLANT && !g.owner[i]) r.grass++; }
  for (let x = 0; x < g.W; x++) {
    let y = 0, tree = false;
    for (; y < g.H; y++) { const i = g.idx(x, y), t = g.type[i]; if (g.owner[i]) { tree = true; continue; } if (t === E || Sim.EL[t].kind === 'gas' || t === RABBIT || t === HOPPER || t === FOX || t === BIRD) continue; break; }
    if (tree || y >= g.H) continue;
    const t = g.type[g.idx(x, y)]; if (t === PLANT) r.meadow++; else if (t === SHRUB) r.scrub++;
  }
  return r;
}
const t0 = Date.now();
for (let s = 0; s <= seasons; s++) {
  const r = survey();
  console.log(`year ${(s / 4).toFixed(2)} (${g.seasonName}): rabbits ${r.rabbits}, grasshoppers ${r.hoppers}, eggs ${r.eggs}, foxes ${r.foxes}, birds ${r.birds} (${r.nests} eggs); meadow ${r.meadow} cols, scrub ${r.scrub} cols, grass ${r.grass} cells, trees ${g.trees.length}  [${((Date.now() - t0) / 60000).toFixed(1)} min]`);
  if (s < seasons) for (let f = 0; f < Sim.YEAR / 4; f++) g.step();
}
if (process.env.SAVE) require('fs').writeFileSync(process.env.SAVE, g.save());
