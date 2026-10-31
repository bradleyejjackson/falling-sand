// River survey (N6): generate the page's world and run it, logging each minute (a quarter of a season) for every river lying in the
// window: the stream on its bed (cells, and how many of its columns are wet), the water in its pond, the silt riding in them, the
// sand built up on the pond's floor since the start (the delta), and how deep the stream has cut into its bed.
// usage: node tools/rivers.js [seed] [minutes] [ox offset]   (SIMFILE=other.html runs another copy; WET=w pins the year's wetness)
const { loadSim } = require('./load');
const Sim = loadSim(process.env.SIMFILE);
const seed = +(process.argv[2] || 12345), mins = +(process.argv[3] || 8);
const { E, WATER, ICE, SAND } = Sim.ids;
const g = new Sim.Grid(Sim.WORLD.W, Sim.WORLD.H);
const ox = Math.floor((Sim.WORLD.WIDE - g.W) / 2 / Sim.REGION) * Sim.REGION + (+process.argv[4] || 0);
Sim.generate(g, seed, Sim.WORLD.WIDE, ox);
if (process.env.WET) g.wetHold = +process.env.WET;
const rivers = g.noise.rivers.filter(r => { const a = r.head - r.dir * 70, b = r.mouth + r.dir * r.pw; return Math.min(a, b) >= ox && Math.max(a, b) < ox + g.W; });
console.log(`seed ${seed}: ${g.noise.rivers.length} rivers in the world, ${rivers.length} in the window: ` + rivers.map(r => `spring at ${r.head - ox}, pond at ${r.mouth - ox} (${r.dir > 0 ? 'east' : 'west'}), ${r.len} long, falls ${r.mouthY - r.headY}`).join('; '));
const { DIRT, MUD, CLAY, STONE } = Sim.ids, EARTH = new Set([SAND, DIRT, MUD, CLAY, STONE]);
const ground = x => { let y = 0; while (y < g.H - 1 && !EARTH.has(g.type[g.idx(x, y)])) y++; return y; };   // the top of the ground (under water, snow, reeds and whatever walks on it)
const bed0 = rivers.map(r => { const a = []; for (let u = 0; u <= r.len + r.pw; u++) a.push(ground(r.head + u * r.dir - ox)); return a; });
function survey(r, k) {
  let bed = 0, wet = 0, pond = 0, silt = 0, delta = 0, cut = 0;
  for (let u = 0; u <= r.len + r.pw; u++) {
    const x = r.head + u * r.dir - ox, gy = ground(x); let any = 0;
    for (let y = r.headY - 60; y < gy; y++) { const i = g.idx(x, y); if (g.type[i] === WATER || g.type[i] === ICE) { if (u <= r.len) { bed++; any = 1; } else pond++; if (g.life[i] & 255) silt++; } }
    wet += any;
    if (u > r.len) delta += Math.max(0, bed0[k][u] - gy); else cut = Math.max(cut, gy - bed0[k][u]);
  }
  return `stream ${bed} (${wet}/${r.len + 1} cols wet), pond ${pond}, silt ${silt}, delta +${delta}, deepest cut ${cut}`;
}
const t0 = Date.now();
for (let m = 0; m <= mins; m++) {
  console.log(`${g.seasonName.padEnd(6)} ${(g.yearPhase * 4 % 1).toFixed(2)}${g.yearName() ? ' (' + g.yearName() + ')' : ''}: spring ${(g.riverFlow || 0).toFixed(2)}/tick | ` + rivers.map(survey).join(' | ') + `  [${((Date.now() - t0) / 60000).toFixed(1)} min]`);
  if (m < mins) for (let f = 0; f < 3600; f++) g.step();
}
