// Steady-state step time: generate the page's world, let it settle for `warm` ticks, then time `frames` more (perf.js times from
// the first tick, when every block is awake). Prints the average, p50 and p95 per pass. SIMFILE=other.html times another copy.
// usage: node tools/steady.js [seed] [frames] [warm]
const { loadSim } = require('./load');
const seed = +(process.argv[2] || 12345), frames = +(process.argv[3] || 600), warm = +(process.argv[4] || 600);
const Sim = loadSim(process.env.SIMFILE);
const g = new Sim.Grid(Sim.WORLD.W, Sim.WORLD.H);
Sim.generate(g, seed, Sim.WORLD.WIDE, Math.floor((Sim.WORLD.WIDE - g.W) / 2 / Sim.REGION) * Sim.REGION);
for (let f = 0; f < warm; f++) g.step();
const times = []; let awake = 0;
for (let f = 0; f < frames; f++) { const t = performance.now(); g.step(); times.push(performance.now() - t); awake += g.awakeTiles; }
times.sort((a, b) => a - b);
const pct = p => times[Math.min(times.length - 1, (times.length * p) | 0)].toFixed(2);
console.log(`seed ${seed} ${g.W}x${g.H} after ${warm} ticks: step avg ${(times.reduce((a, b) => a + b, 0) / frames).toFixed(2)} ms, p50 ${pct(0.5)}, p95 ${pct(0.95)}; awake tiles ${(awake / frames).toFixed(0)} of ${g.TW * g.TH}`);
