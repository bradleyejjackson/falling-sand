// Snow and ice survey (N5): generate the page's world and run it, logging every quarter season the snow lying (cells, and columns by
// depth and by the slope of the ground under it), the wind at the ground, the ice (and how much of it floats), avalanches and cornices.
// usage: node tools/snow.js [seed] [seasons] [start season 0-3]   (SIMFILE=other.html runs another copy)
const { loadSim } = require('./load');
const Sim = loadSim(process.env.SIMFILE);
const seed = +(process.argv[2] || 12345), seasons = +(process.argv[3] || 4), start = +(process.argv[4] || 0);
const { E, SNOW, ICE, WATER, BRINE } = Sim.ids;
const g = new Sim.Grid(Sim.WORLD.W, Sim.WORLD.H);
Sim.generate(g, seed, Sim.WORLD.WIDE, Math.floor((Sim.WORLD.WIDE - g.W) / 2 / Sim.REGION) * Sim.REGION);
for (let s = 0; s < start; s++) g.nextSeason();
const KIND = t => Sim.EL[t].kind;
function survey() {
  let cells = 0, ice = 0, afloat = 0, packed = 0, hang = 0; const deep = [0, 0, 0, 0], bySlope = {}, top = [], snowTop = [];
  for (let i = 0; i < g.type.length; i++) { const t = g.type[i]; if (t === SNOW) { cells++; if (g.life[i] & 1) packed++; if (i + g.W < g.type.length && g.type[i + g.W] === E) hang++; } else if (t === ICE) { ice++; const b = g.type[i + g.W]; if (b === WATER || b === BRINE || (g.life[i] & 2)) afloat++; } }
  for (let x = 0; x < g.W; x++) {
    let y = 0; for (; y < g.H; y++) { const i = g.idx(x, y), t = g.type[i]; if (g.owner[i] || t === E || KIND(t) === 'gas') continue; break; }
    let z = 0; const y0 = y; while (y < g.H && g.type[g.idx(x, y)] === SNOW) { z++; y++; }
    top.push(y); snowTop.push(y0); deep[z >= 8 ? 3 : z >= 5 ? 2 : z >= 3 ? 1 : 0] += z ? 1 : 0;
  }
  for (let x = 3; x < g.W - 3; x++) { const z = top[x] - snowTop[x]; if (z < 3) continue; const sl = Math.abs(top[x + 3] - top[x - 3]) / 6, b = sl >= 1.5 ? '1.5+' : sl >= 1 ? '1-1.5' : sl >= 0.6 ? '.6-1' : sl >= 0.3 ? '.3-.6' : '<.3'; bySlope[b] = (bySlope[b] || 0) + 1; }
  let wmax = 0; for (let x = 0; x < g.W; x += 4) { const w = Math.abs(g.windAt(x, snowTop[x] - 1)); if (w > wmax) wmax = w; }
  return `snow ${cells} (packed ${packed}, overhanging ${hang}), cols >=3: ${deep[1]} >=5: ${deep[2]} >=8: ${deep[3]}, deep snow by ground slope ${JSON.stringify(bySlope)}, wind max ${wmax.toFixed(2)}, ice ${ice} (afloat ${afloat}), avalanches ${g.avalanches || 0}`;
}
const t0 = Date.now(), Q = Sim.YEAR / 16;
for (let q = 0; q <= seasons * 4; q++) {
  console.log(`${g.seasonName} day ${(g.clock / Sim.DAY % 8).toFixed(1)}: ${survey()}  [${((Date.now() - t0) / 60000).toFixed(1)} min]`);
  if (q < seasons * 4) for (let f = 0; f < Q; f++) g.step();
}
