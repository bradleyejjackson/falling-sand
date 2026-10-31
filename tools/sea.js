// Coast survey (N7): generate the page's world with the window on the sea at its west end and run it, logging each minute (a quarter
// of a season): the sea's level at the edge, the brine in the window, where the shore stands (the first column whose ground stands over
// the sea's mean level), the sand on the beach and dunes, the reeds and salt on a marsh, how far a cliff's waterline has been worn back,
// the cloud over the coast, and the step's cost.
// usage: node tools/sea.js [seed] [minutes]   (SIMFILE=other.html runs another copy; WIND=w pins the wind)
const { loadSim } = require('./load');
const Sim = loadSim(process.env.SIMFILE);
const seed = +(process.argv[2] || 12345), mins = +(process.argv[3] || 8);
const { E, BRINE, WATER, SAND, STONE, RUBBLE, REED, SALT, CLOUD, DIRT, CLAY, MUD } = Sim.ids;
const g = new Sim.Grid(Sim.WORLD.W, Sim.WORLD.H);
Sim.generate(g, seed, Sim.WORLD.WIDE, 0);
if (process.env.WIND) g.windHold = +process.env.WIND;
const c = g.noise.sea;
console.log(`seed ${seed}: ${c.kind} coast, shore at ${c.shore}, mean level row ${c.y}` + (c.kind === 'cliff' ? `, cliff ${c.cliff} high` : c.kind === 'marsh' ? `, marsh ${c.wide} wide` : `, dunes ${c.dunes.map(d => d.h.toFixed(0)).join('/')}`));
const EARTH = new Set([SAND, DIRT, CLAY, MUD, STONE, RUBBLE, SALT]);
const ground = x => { let y = 0; while (y < g.H - 1 && !EARTH.has(g.type[g.idx(x, y)])) y++; return y; };
const shore = () => { let x = 0; while (x < g.W - 1 && ground(x) > c.y) x++; return x; };
const face = () => { let s = 0; for (let y = c.y - 4; y <= c.y + 2; y++) { let x = c.shore - 30; while (x < c.shore + 60 && g.type[g.idx(x, y)] !== STONE) x++; s += x; } return s / 7; };
const g0 = []; for (let x = 0; x < c.end; x++) g0.push(ground(x));
let ms = 0, n = 0; const f0 = face();
for (let m = 0; m <= mins; m++) {
  let brine = 0, sand = 0, reeds = 0, salt = 0, cloud = 0, high = 0;
  for (let y = 0; y < g.H; y++) for (let x = 0; x < c.end; x++) { const t = g.type[g.idx(x, y)]; if (t === BRINE) brine++; else if (t === SAND && x >= c.shore && y < c.y + 12) sand++; else if (t === REED) reeds++; else if (t === SALT && y < c.y + 6) salt++; else if (t === CLOUD) cloud++; }
  for (let x = c.shore; x < c.shore + c.wide; x++) high = Math.max(high, c.y - ground(x));
  let moved = 0; for (let x = 0; x < c.end; x += 2) moved += Math.abs(ground(x) - g0[x]);
  const coast = c.kind === 'cliff' ? `face worn ${(face() - f0).toFixed(1)} cols, ${g.seaBroke} broken` : c.kind === 'marsh' ? `reeds ${reeds}, salt ${salt}` : `beach+dune sand ${sand}, highest dune ${high}`;
  console.log(`${g.seasonName.padEnd(6)} ${(g.yearPhase * 4 % 1).toFixed(2)}${g.yearName() ? ' (' + g.yearName() + ')' : ''}: level ${g.seaLevel === undefined ? '-' : c.y - g.seaLevel} | brine ${brine}, shore at ${shore()}, ground moved ${moved} | ${coast} | cloud ${cloud} | ${(ms / Math.max(1, n)).toFixed(2)} ms/tick`);
  ms = 0; n = 0;
  if (m < mins) for (let f = 0; f < 3600; f++) { const a = process.hrtime.bigint(); g.step(); ms += Number(process.hrtime.bigint() - a) / 1e6; n++; }
}
