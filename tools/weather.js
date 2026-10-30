// Weather variability (N8): generate the page's world and run it, logging each season the year's wetness and any heat wave, the rain
// and snow that fell, the topsoil's moisture, meadow, trees, grasshoppers, lightning, hail and fire; and, on slopes, the topsoil on faces
// that look east (morning sun) against faces that look west (afternoon sun).
// usage: node tools/weather.js [seed] [seasons]   (WET=-1..1 holds every year at that wetness; NOLIGHT=1 no lightning; SIMFILE=other.html runs another copy)
const { loadSim } = require('./load');
const Sim = loadSim(process.env.SIMFILE);
const seed = +(process.argv[2] || 12345), seasons = +(process.argv[3] || 8);
const { E, PLANT, DIRT, HOPPER, FIRE } = Sim.ids;
const g = new Sim.Grid(Sim.WORLD.W, Sim.WORLD.H);
Sim.generate(g, seed, Sim.WORLD.WIDE, Math.floor((Sim.WORLD.WIDE - g.W) / 2 / Sim.REGION) * Sim.REGION);
if (process.env.WET !== undefined) g.wetHold = +process.env.WET;
if (process.env.NOLIGHT) g.lightning = false;
const KIND = t => Sim.EL[t].kind;
function survey() {
  let meadow = 0, soil = 0, soils = 0, hop = 0, fire = 0; const face = { east: [0, 0], west: [0, 0], flat: [0, 0] }, top = [];
  for (let x = 0; x < g.W; x++) {
    let y = 0; for (; y < g.H; y++) { const i = g.idx(x, y), t = g.type[i]; if (g.owner[i] || t === E || KIND(t) === 'gas') continue; break; }
    top.push(y);
    if (y < g.H && g.type[g.idx(x, y)] === PLANT) meadow++;
    let m = 0, n = 0; for (let k = 0; y < g.H && n < 3 && k < 8; y++, k++) { const i = g.idx(x, y); if (g.type[i] === DIRT) { m += g.life[i] & 255; n++; } }
    if (n) { soil += m / n; soils++; top[x] = [top[x], m / n]; } else top[x] = [top[x], -1];
  }
  for (let x = 8; x < g.W - 8; x++) { if (top[x][1] < 0) continue; const sl = (top[x + 8][0] - top[x - 8][0]) / 16, f = sl > 0.4 ? face.east : sl < -0.4 ? face.west : Math.abs(sl) < 0.1 ? face.flat : null; if (f) { f[0] += top[x][1]; f[1]++; } }
  for (let i = 0; i < g.type.length; i++) { if (g.type[i] === HOPPER && !(g.life[i] & Sim.EGG)) hop++; else if (g.type[i] === FIRE) fire++; }
  const fm = f => f[1] ? (f[0] / f[1]).toFixed(0) + ' (' + f[1] + ')' : '-';
  return { meadow, soil: soils ? soil / soils : 0, hop, fire, faces: `east ${fm(face.east)} west ${fm(face.west)} flat ${fm(face.flat)}` };
}
const t0 = Date.now();
let rain = 0, hot = 0, fires = 0, maxHop = 0;
for (let s = 0; s <= seasons; s++) {
  const r = survey();
  console.log(`year ${(s / 4).toFixed(2)} (${g.seasonName}) wet ${g.wet.toFixed(2)}${hot ? ', heat wave ' + hot + ' ticks' : ''}: rain ${rain}, topsoil ${r.soil.toFixed(0)} [${r.faces}], meadow ${r.meadow}, ${g.trees.length} trees (${g.droughtKills} thirst), hoppers ${r.hop} (peak ${maxHop}), strikes ${g.strikes}, hail ${g.hailstones} (${g.hailKills} hoppers), fire-ticks ${fires}  [${((Date.now() - t0) / 60000).toFixed(1)} min]`);
  rain = 0; hot = 0; fires = 0; maxHop = 0;
  const p0 = g.precip.reduce((a, b) => a + b, 0);
  if (s < seasons) for (let f = 0; f < Sim.YEAR / 4; f++) {
    g.step();
    if (g.heat > 0) hot++;
    if (f % 400 === 0) { const q = survey(); fires += q.fire; maxHop = Math.max(maxHop, q.hop); }
  }
  rain = g.precip.reduce((a, b) => a + b, 0) - p0;
}
