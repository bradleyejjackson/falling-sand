// The cell pass on worker threads over shared memory. Checks that N threads give exactly the same world as one
// (the checkerboard keeps tiles that run together from touching the same cells), and times both.
// usage: node tools/threads.js [threads] [frames] [seed]
const { Worker } = require('worker_threads');
const { loadSim, simSource } = require('./load');
const threads = +(process.argv[2] || 4), frames = +(process.argv[3] || 300), seed = +(process.argv[4] || 12345);
// two copies of the module, so the two worlds each have their own random stream
const SimA = loadSim(process.env.SIMFILE), SimB = loadSim(process.env.SIMFILE);
let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); if (!ok) failed++; };

function world(Sim, shared) { Sim.reseed(1); const g = new Sim.Grid(960, 480, { shared }); Sim.generate(g, seed); return g; }
function spawn(g, n) {
  const src = simSource(process.env.SIMFILE);
  const code = `const { workerData } = require('worker_threads'); const Sim = new Function(workerData.src + '\\nreturn Sim;')();
    new Sim.Grid(workerData.W, workerData.H, { buffer: workerData.buffer }).work();`;
  return Array.from({ length: n }, () => new Worker(code, { eval: true, workerData: { src, W: g.W, H: g.H, buffer: g.buffer } }));
}
function stepThreaded(g, n) {
  g.beginStep();
  if (g.awakeTiles) { const gen = (g.ctl[0] + 1) & 0x3fffffff; g.startTiles(n); while (Atomics.load(g.ctl, 1) !== gen) Atomics.wait(g.ctl, 1, Atomics.load(g.ctl, 1), 1000); }
  g.endStep();
}
const fields = ['type', 'life', 'temp', 'vx', 'vy', 'owner', 'hum'];
const diff = (a, b) => { for (const f of fields) { const x = a[f], y = b[f]; for (let i = 0; i < x.length; i++) if (x[i] !== y[i] && !(x[i] !== x[i] && y[i] !== y[i])) return `${f}[${i}] ${x[i]} vs ${y[i]}`; } return null; };

const one = world(SimA, false), many = world(SimB, true);
check('the world is in shared memory', many.shared);
const workers = spawn(many, threads);
let t1 = 0, tn = 0, first = null;
for (let f = 0; f < frames; f++) {
  let t = performance.now(); one.step(); t1 += performance.now() - t;
  t = performance.now(); stepThreaded(many, threads); tn += performance.now() - t;
  if (!first) { const d = diff(one, many); if (d) first = `frame ${f}: ${d}`; }
}
check(`${threads} threads give the same world as one thread over ${frames} frames`, !first && !diff(one, many), first || 'identical');
check('and the same trees', JSON.stringify(one.treesSave()) === JSON.stringify(many.treesSave()));
console.log(`  step: 1 thread ${(t1 / frames).toFixed(2)} ms, ${threads} threads ${(tn / frames).toFixed(2)} ms (${(t1 / tn).toFixed(2)}x)`);
many.stopWorkers(); for (const w of workers) w.terminate();
if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
