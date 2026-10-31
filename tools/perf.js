// Generate the page's world (Sim.WORLD) and time step() and the page's render path. SIMFILE=other.html times another copy.
// usage: node tools/perf.js [seed] [frames]   (BIOME=id generates that biome preset, at the window it opens on)
const { loadSim, loadPage, census } = require('./load');
const seed = +(process.argv[2] || 12345), frames = +(process.argv[3] || 600);

const Sim = loadSim(process.env.SIMFILE);
const g = new Sim.Grid(Sim.WORLD.W, Sim.WORLD.H);
let t0 = performance.now();
const bio = process.env.BIOME ? Sim.BIOMES.findIndex(b => b.id === process.env.BIOME) : 0;
if (bio < 0) throw new Error('no biome ' + process.env.BIOME);
if (bio) Sim.generate(g, seed, Sim.WORLD.WIDE, Sim.homeOf(Sim.WORLD.WIDE, bio), bio);
else Sim.generate(g, seed, Sim.WORLD.WIDE, Math.floor((Sim.WORLD.WIDE - g.W) / 2 / Sim.REGION) * Sim.REGION);   // the middle of the world, as the page starts
const gen = performance.now() - t0;
const times = [];
for (let f = 0; f < frames; f++) { t0 = performance.now(); g.step(); times.push(performance.now() - t0); }
times.sort((a, b) => a - b);
const avg = times.reduce((a, b) => a + b, 0) / times.length;
const pct = p => times[Math.min(times.length - 1, (times.length * p) | 0)].toFixed(2);
console.log(`seed ${seed}: generate ${gen.toFixed(0)} ms; step avg ${avg.toFixed(2)} ms, p50 ${pct(0.5)}, p95 ${pct(0.95)}, max ${pct(0.999)} over ${frames} frames; trees ${g.trees.length}`);

// render: run the page loop with sim paused-equivalent cost measured as (loop - step)
const page = loadPage(process.env.SIMFILE);
const pg = page.sf.g;
page.run(5);
let rt = 0, st = 0; const N = 120;
for (let k = 0; k < N; k++) {
  let a = performance.now(); pg.step(); st += performance.now() - a;
  a = performance.now(); page.run(1); rt += performance.now() - a;
}
console.log(`page: step ${(st / N).toFixed(2)} ms, loop (step+render) ${(rt / N).toFixed(2)} ms -> render ~${((rt - st) / N).toFixed(2)} ms`);
if (process.env.CENSUS) console.log(census(g, Sim.EL));
