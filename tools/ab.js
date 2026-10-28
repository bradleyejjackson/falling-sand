// A/B timing of two builds in one process: they step alternately on the same generated world, so a noisy machine slows both alike.
// usage: node tools/ab.js old.html new.html [seed] [ticks to skip first] [ticks timed]   (NOLIGHT=1: no lightning in either)
const { loadSim } = require('./load');
const [fa, fb] = process.argv.slice(2, 4), seed = +(process.argv[4] || 12345), skip = +(process.argv[5] || 0), N = +(process.argv[6] || 600);
const mk = f => { const S = loadSim(f), g = new S.Grid(S.WORLD.W, S.WORLD.H); S.generate(g, seed, S.WORLD.WIDE, Math.floor((S.WORLD.WIDE - g.W) / 2 / S.REGION) * S.REGION); if (process.env.NOLIGHT) g.lightning = false; for (let f = 0; f < skip; f++) g.step(); return g; };
const A = mk(fa), B = mk(fb), ta = [], tb = [];
for (let f = 0; f < N; f++) { let t = performance.now(); A.step(); ta.push(performance.now() - t); t = performance.now(); B.step(); tb.push(performance.now() - t); }
const st = a => { a.sort((x, y) => x - y); return `avg ${(a.reduce((x, y) => x + y) / a.length).toFixed(2)} p50 ${a[a.length >> 1].toFixed(2)}`; };
console.log(`seed ${seed} ticks ${skip}-${skip + N}: A ${st(ta)} | B ${st(tb)}`);
