// Soil fertility over the years: generate the page's world (OX shifts the window east, a multiple of Sim.REGION) and run it, logging
// each season the nutrients in the topsoil (the first 3 cells of dirt under the surface) and the subsoil (the next 8 rows of dirt),
// split by what covers the column: forest, meadow, scrub or bare ground. Also how much meadow and forest stand.
// usage: node tools/soil.js [seed] [seasons]   (SIMFILE=other.html runs another copy; SAVE=file saves the end, LOAD=file starts from one)
const { loadSim } = require('./load');
const Sim = loadSim(process.env.SIMFILE);
const seed = +(process.argv[2] || 12345), seasons = +(process.argv[3] || 4);
const { E, PLANT, DIRT, MUD, CLAY, SHRUB, WATER, REED } = Sim.ids;
const g = new Sim.Grid(Sim.WORLD.W, Sim.WORLD.H);
if (process.env.LOAD) { Sim.reseed(seed); g.load(require('fs').readFileSync(process.env.LOAD, 'utf8')); }
else Sim.generate(g, seed, Sim.WORLD.WIDE, Math.floor((Sim.WORLD.WIDE - g.W) / 2 / Sim.REGION) * Sim.REGION + (+process.env.OX || 0));
const SOILY = t => t === DIRT || t === MUD || t === CLAY;
function survey() {
  const by = {};
  const add = (k, top, sub) => { const b = by[k] || (by[k] = { cols: 0, top: 0, nt: 0, sub: 0, ns: 0 }); b.cols++; for (const v of top) { b.top += v; b.nt++; } for (const v of sub) { b.sub += v; b.ns++; } };
  for (let x = 0; x < g.W; x++) {
    let tree = false, y = 0;
    for (; y < g.H; y++) { const i = g.idx(x, y), t = g.type[i]; if (g.owner[i]) { tree = true; continue; } if (t === E || Sim.EL[t].kind === 'gas' || t === WATER || t === REED) continue; break; }
    if (y >= g.H) continue;
    const s = g.type[g.idx(x, y)], kind = tree ? 'forest' : s === PLANT ? 'meadow' : s === SHRUB ? 'scrub' : 'bare';
    const top = [], sub = [];
    for (let k = 0; y < g.H && k < 14; y++, k++) { const i = g.idx(x, y); if (!SOILY(g.type[i])) continue; (top.length < 3 ? top : sub).push(g.life[i] >> 8); if (sub.length >= 8) break; }
    if (top.length) add(kind, top, sub);
  }
  return by;
}
const t0 = Date.now();
for (let s = 0; s <= seasons; s++) {
  const r = survey();
  console.log(`year ${(s / 4).toFixed(2)} (${g.seasonName}): ` + Object.entries(r).map(([k, b]) => `${k} ${b.cols} cols top ${(b.top / Math.max(1, b.nt)).toFixed(0)} sub ${(b.sub / Math.max(1, b.ns)).toFixed(0)}`).join('; ') + `; trees ${g.trees.length}  [${((Date.now() - t0) / 60000).toFixed(1)} min]`);
  if (s < seasons) for (let f = 0; f < Sim.YEAR / 4; f++) g.step();
}
if (process.env.SAVE) require('fs').writeFileSync(process.env.SAVE, g.save());
