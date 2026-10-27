// The engine must not change what happens: step a world on this page and on a reference copy (BASE=file) side by side and
// compare every field after each frame. Run it after any speed-up that is meant to leave the simulation exactly as it was.
// usage: BASE=old.html node tools/same.js [frames] [seeds...]
const { loadSim } = require('./load');
if (!process.env.BASE) { console.log('set BASE to the page to compare against (e.g. git show main:falling-sand.html > /tmp/base.html)'); process.exit(2); }
const frames = +(process.argv[2] || 600), seeds = process.argv.slice(3).map(Number);
const A = loadSim(process.env.BASE), B = loadSim(process.env.SIMFILE);
const fields = ['type', 'life', 'temp', 'fuse', 'vx', 'vy', 'owner', 'hum', 'u', 'v', 'made'];
const diff = (a, b) => { for (const f of fields) { const x = a[f], y = b[f]; for (let i = 0; i < x.length; i++) if (x[i] !== y[i] && !(x[i] !== x[i] && y[i] !== y[i])) return `${f}[${i}] ${x[i]} vs ${y[i]}`; } return null; };
let failed = 0;
const world = (Sim, seed) => { Sim.reseed(1); const g = new Sim.Grid(Sim.WORLD.W, Sim.WORLD.H); Sim.generate(g, seed); return g; };
for (const seed of seeds.length ? seeds : [12345, 777]) {
  const a = world(A, seed), b = world(B, seed);
  let bad = diff(a, b) && 'after generate: ' + diff(a, b), ta = 0, tb = 0;
  for (let f = 0; f < frames && !bad; f++) {
    let t = performance.now(); a.step(); ta += performance.now() - t;
    t = performance.now(); b.step(); tb += performance.now() - t;
    const d = (f % 10 === 9 || f === frames - 1) && diff(a, b); if (d) bad = `frame ${f}: ${d}`;
  }
  if (!bad && a.treesSave() !== b.treesSave()) bad = 'trees differ';
  console.log(`${bad ? 'FAIL' : 'PASS'}  seed ${seed}: ${frames} frames ${bad || 'identical'}; step ${(ta / frames).toFixed(2)} -> ${(tb / frames).toFixed(2)} ms`);
  if (bad) failed++;
}
if (failed) process.exit(1);
