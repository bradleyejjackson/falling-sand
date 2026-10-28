// Wild plants and the land they make: generate the page's world (OX shifts the window east by that many columns, a multiple of
// Sim.REGION; 640 puts the near desert in it) and run it, logging each season how many columns are forest, meadow, scrub, desert
// and reed bed, and how many shrubs, cacti and reeds stand (counted by their base cells).
// usage: node tools/biomes.js [seed] [seasons]   (SIMFILE=other.html runs another copy; SAVE=file saves the end, LOAD=file starts from one)
const { loadSim } = require('./load');
const Sim = loadSim(process.env.SIMFILE);
const seed = +(process.argv[2] || 12345), seasons = +(process.argv[3] || 4);
const { E, PLANT, SAND, SHRUB, CACTUS, REED, WATER } = Sim.ids;
const g = new Sim.Grid(Sim.WORLD.W, Sim.WORLD.H);
if (process.env.LOAD) { Sim.reseed(seed); g.load(require('fs').readFileSync(process.env.LOAD, 'utf8')); }
else Sim.generate(g, seed, Sim.WORLD.WIDE, Math.floor((Sim.WORLD.WIDE - g.W) / 2 / Sim.REGION) * Sim.REGION + (+process.env.OX || 0));
const SOIL = new Set(['Dirt', 'Sand', 'Mud', 'Clay']);
function survey() {
  const cols = { forest: 0, meadow: 0, scrub: 0, desert: 0, reeds: 0, other: 0 }, base = { Shrub: 0, Cactus: 0, Reed: 0 };
  let sap = { Shrub: 0, Cactus: 0, Reed: 0 };
  for (let x = 0; x < g.W; x++) {
    let tree = false, reed = false, y = 0;
    for (; y < g.H; y++) { const i = g.idx(x, y), t = g.type[i]; if (g.owner[i]) { tree = true; continue; } if (t === REED) reed = true; if (t === E || Sim.EL[t].kind === 'gas' || t === WATER || t === REED) continue; break; }
    const t = y < g.H ? g.type[g.idx(x, y)] : E;
    cols[tree ? 'forest' : reed ? 'reeds' : t === PLANT ? 'meadow' : t === SHRUB ? 'scrub' : t === CACTUS || t === SAND ? 'desert' : 'other']++;
  }
  for (let i = g.W; i < g.type.length - g.W; i++) { const t = g.type[i]; if ((t === SHRUB || t === CACTUS || t === REED) && SOIL.has(Sim.EL[g.type[i + g.W]].name)) { const n = Sim.EL[t].name; base[n]++; sap[n] += g.life[i] >> 8; } }
  for (const k in sap) sap[k] = base[k] ? Math.round(sap[k] / base[k]) : 0;
  return { cols, base, sap };
}
const t0 = Date.now();
for (let s = 0; s <= seasons; s++) {
  const r = survey();
  console.log(`year ${(s / 4).toFixed(2)} (${g.seasonName}): columns ${Object.entries(r.cols).map(([k, v]) => k + ' ' + v).join(', ')}; plants ${Object.entries(r.base).map(([k, v]) => `${k} ${v} (sap ${r.sap[k]})`).join(', ')}; trees ${g.trees.length}  [${((Date.now() - t0) / 60000).toFixed(1)} min]`);
  if (s < seasons) for (let f = 0; f < Sim.YEAR / 4; f++) g.step();
}
if (process.env.SAVE) require('fs').writeFileSync(process.env.SAVE, g.save());
