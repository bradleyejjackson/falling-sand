// Conifers, the treeline and succession: generate the page's world and run it, and each season count broadleaf trees and conifers
// in bands of site warmth (Grid.warmth: valley, slope, upland, high), with the warmest and coldest site a tree of each kind stands on.
// usage: node tools/forest.js [seed] [seasons]   (SIMFILE=other.html runs another copy; OX= shifts the window east; SAVE=file saves the end, LOAD=file starts from one)
const { loadSim } = require('./load');
const Sim = loadSim(process.env.SIMFILE);
const seed = +(process.argv[2] || 12345), seasons = +(process.argv[3] || 4);
const g = new Sim.Grid(Sim.WORLD.W, Sim.WORLD.H);
if (process.env.LOAD) { Sim.reseed(seed); g.load(require('fs').readFileSync(process.env.LOAD, 'utf8')); }
else Sim.generate(g, seed, Sim.WORLD.WIDE, Math.floor((Sim.WORLD.WIDE - g.W) / 2 / Sim.REGION) * Sim.REGION + (+process.env.OX || 0));
const warm = y => g.warmth ? g.warmth(y) : g.ambAt(y) - g.climate;
const BANDS = [['valley', w => w >= 12], ['slope', w => w >= 10 && w < 12], ['upland', w => w >= 8.5 && w < 10], ['high', w => w < 8.5]];
// open ground per band (columns whose surface is soil or grass), so the counts can be read as density
const ground = BANDS.map(() => 0);
for (let x = 0; x < g.W; x++) { let y = 0; while (y < g.H - 1 && (Sim.EL[g.type[g.idx(x, y)]].kind === 'gas' || g.type[g.idx(x, y)] === Sim.ids.E || g.owner[g.idx(x, y)])) y++; const w = warm(y); ground[BANDS.findIndex(([, f]) => f(w))]++; }
const t0 = Date.now();
function report(s) {
  const rows = BANDS.map(() => ({ b: 0, c: 0, bh: 0, ch: 0 }));
  let lo = { b: Infinity, c: Infinity };
  for (const t of g.trees) { if (t.dead || t.cones) continue; const w = warm(t.y), r = rows[BANDS.findIndex(([, f]) => f(w))], big = t.age > 100;
    if (t.con) { r.c++; if (big) r.ch++; lo.c = Math.min(lo.c, w); } else { r.b++; if (big) r.bh++; lo.b = Math.min(lo.b, w); } }
  const cones = g.trees.filter(t => t.cones).length;
  console.log(`year ${(s / 4).toFixed(2)} (${g.seasonName}): ${g.trees.length} trees, coldest site broadleaf ${lo.b.toFixed(1)}° conifer ${lo.c.toFixed(1)}°${cones ? ', ' + cones + ' burnt conifers with cones to open' : ''}  [${((Date.now() - t0) / 60000).toFixed(1)} min]`);
  console.log('  ' + BANDS.map(([n], k) => `${n} (${ground[k]} cols): ${rows[k].b} broadleaf (${rows[k].bh} grown), ${rows[k].c} conifer (${rows[k].ch} grown)`).join('; '));
}
let s = 0;
for (; s <= seasons; s++) { report(s); if (s < seasons) for (let f = 0; f < Sim.YEAR / 4; f++) g.step(); }
if (process.env.SAVE) require('fs').writeFileSync(process.env.SAVE, g.save());
