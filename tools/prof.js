// Time each pass of step() on the page's world: the cell pass (runTiles) and every pass endStep runs. SIMFILE=other.html profiles another copy.
// usage: node tools/prof.js [seed] [frames]
const { loadSim } = require('./load');
const seed = +(process.argv[2] || 12345), frames = +(process.argv[3] || 600);
const Sim = loadSim(process.env.SIMFILE);
const P = Sim.Grid.prototype, acc = {}, names = ['beginStep', 'runTiles', 'pressure', 'waves', 'beam', 'stepTrees', 'stepSoil', 'updateMasses', 'stepAir', 'stepWind', 'stepStorms', 'updateClimate'];
let depth = 0;
for (const n of names) {
  const f = P[n]; if (!f) continue; acc[n] = 0;
  P[n] = function (...a) { if (depth) return f.apply(this, a); depth++; const t = performance.now(); try { return f.apply(this, a); } finally { acc[n] += performance.now() - t; depth--; } };
}
const g = new Sim.Grid(Sim.WORLD.W, Sim.WORLD.H);
Sim.generate(g, seed, Sim.WORLD.WIDE, Math.floor((Sim.WORLD.WIDE - g.W) / 2 / Sim.REGION) * Sim.REGION);
for (const n in acc) acc[n] = 0;
let total = 0, awake = 0;
for (let f = 0; f < frames; f++) { const t = performance.now(); g.step(); total += performance.now() - t; awake += g.awakeTiles; }
console.log(`seed ${seed} ${g.W}x${g.H}: step ${(total / frames).toFixed(2)} ms, awake tiles ${(awake / frames).toFixed(0)} of ${g.TW * g.TH}`);
for (const n of Object.keys(acc).sort((a, b) => acc[b] - acc[a])) console.log(`  ${n.padEnd(14)} ${(acc[n] / frames).toFixed(3)} ms`);
console.log(`  (rest)         ${((total - Object.values(acc).reduce((a, b) => a + b, 0)) / frames).toFixed(3)} ms`);
