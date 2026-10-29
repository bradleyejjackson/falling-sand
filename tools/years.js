// Long-run balance: generate the page's world and run it for several years, logging each season how much of the land is meadow
// (open grass), how much is under forest, and how many trees stand. Meadows should not vanish.
// usage: node tools/years.js [seed] [years]   (SIMFILE=other.html runs another copy; LOAD=file starts from a save, SAVE=file saves the end)
const { loadSim } = require('./load');
const Sim = loadSim(process.env.SIMFILE);
const seed = +(process.argv[2] || 12345), years = +(process.argv[3] || 5);
const { E, PLANT, DIRT, WATER } = Sim.ids;
const g = new Sim.Grid(Sim.WORLD.W, Sim.WORLD.H);
if (process.env.LOAD) { Sim.reseed(seed); g.load(require('fs').readFileSync(process.env.LOAD, 'utf8')); }
else Sim.generate(g, seed, Sim.WORLD.WIDE, Math.floor((Sim.WORLD.WIDE - g.W) / 2 / Sim.REGION) * Sim.REGION);
const KIND = t => Sim.EL[t].kind;
function survey() {
  let meadow = 0, forest = 0, soil = 0, soils = 0; const tops = {};
  for (let x = 0; x < g.W; x++) {
    let tree = false, y = 0;
    for (; y < g.H; y++) { const i = g.idx(x, y), t = g.type[i]; if (g.owner[i]) { tree = true; continue; } if (t !== E && KIND(t) !== 'gas') break; }
    if (tree) forest++;
    else if (y < g.H) { const t = g.type[g.idx(x, y)]; if (t === PLANT) meadow++; tops[Sim.EL[t].name] = (tops[Sim.EL[t].name] || 0) + 1; }
    // the topsoil: the first 3 cells of dirt under the surface
    for (let k = 0, n = 0; y < g.H && n < 3 && k < 8; y++, k++) { const i = g.idx(x, y); if (g.type[i] === DIRT) { soil += g.life[i] & 255; soils++; n++; } }
  }
  let water = 0; for (let i = 0; i < g.type.length; i++) if (g.type[i] === WATER) water++;
  let vap = 0; for (let c = 0; c < g.hum.length; c++) vap += g.hum[c];
  return { meadow, forest, trees: g.trees.length, soil: soils ? soil / soils : 0, water, vap, tops };
}
const t0 = Date.now(), rows = [];
for (let s = 0; s <= years * 4; s++) {
  const r = survey(); rows.push(r);
  console.log(`year ${(s / 4).toFixed(2)} (${g.seasonName}): meadow ${r.meadow} cols, under trees ${r.forest} cols, ${r.trees} trees, ${g.droughtKills} died of thirst; topsoil moisture ${r.soil.toFixed(0)}, water ${r.water} cells, vapour ${r.vap.toFixed(0)}  [${((Date.now() - t0) / 60000).toFixed(1)} min]`);
  if (process.env.TOPS) console.log('   open ground by surface:', Object.entries(r.tops).sort((a, b) => b[1] - a[1]).map(([n, c]) => n + ' ' + c).join(', '));
  if (s < years * 4) for (let f = 0; f < Sim.YEAR / 4; f++) g.step();
}
if (process.env.SAVE) require('fs').writeFileSync(process.env.SAVE, g.save());
