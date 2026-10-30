// Tree sizes against light and soil: generate the page's world and run it, then each season list how tall and wide the trees stand,
// binned by how much sun their crowns get (t.sun, or measured here on an older build) and how rich the soil their roots drink (t.fert).
// usage: node tools/trees.js [seed] [seasons]   (SIMFILE=other.html runs another copy; OX= shifts the window east; SAVE=file saves the end, LOAD=file starts from one)
const { loadSim } = require('./load');
const Sim = loadSim(process.env.SIMFILE);
const seed = +(process.argv[2] || 12345), seasons = +(process.argv[3] || 4);
const { WOOD, PLANT } = Sim.ids;
const g = new Sim.Grid(Sim.WORLD.W, Sim.WORLD.H);
if (process.env.LOAD) { Sim.reseed(seed); g.load(require('fs').readFileSync(process.env.LOAD, 'utf8')); }
else Sim.generate(g, seed, Sim.WORLD.WIDE, Math.floor((Sim.WORLD.WIDE - g.W) / 2 / Sim.REGION) * Sim.REGION + (+process.env.OX || 0));
// the share of a tree's crown with nothing but its own leaves and open air over it (what t.sun follows, for builds without it)
function sunOf(t) {
  if (t.sun !== undefined) return t.sun;
  let open = 0, n = 0;
  for (const [i, code] of t.cells) {
    if (!(code & 1)) continue; n++;
    const x = i % g.W; let y = (i / g.W) | 0, lit = true;
    for (let k = 1; k <= 30 && y - k >= 0; k++) { const j = g.idx(x, y - k), tj = g.type[j]; if ((tj === PLANT && g.owner[j] && g.owner[j] !== t.id) || (tj !== WOOD && tj !== PLANT && Sim.EL[tj].opaque && Sim.EL[tj].kind === 'static')) { lit = false; break; } }
    if (lit) open++;
  }
  return n ? open / n : 1;
}
function size(t) {   // height above the base and crown width, from the cells it last drew
  let top = t.y, x0 = t.x, x1 = t.x, wood = 0;
  for (const [i, code] of t.cells) { const s = t.segs[code >> 1]; if (s.root) continue; const x = i % g.W, y = (i / g.W) | 0; top = Math.min(top, y); x0 = Math.min(x0, x); x1 = Math.max(x1, x); if (!(code & 1)) wood++; }
  return { h: t.y - top + 1, w: x1 - x0 + 1, wood };
}
const q = (a, p) => a.length ? a.slice().sort((u, v) => u - v)[Math.min(a.length - 1, Math.floor(p * a.length))] : 0;
function report() {
  const rows = g.trees.filter(t => !t.falling && t.age > 50).map(t => ({ ...size(t), sun: sunOf(t), fert: t.soil ?? t.fert ?? 1, age: t.age }));
  const hs = rows.map(r => r.h);
  console.log(`year ${(s / 4).toFixed(2)} (${g.seasonName}): ${g.trees.length} trees, ${rows.length} past seedling; height p10 ${q(hs, 0.1)} median ${q(hs, 0.5)} p90 ${q(hs, 0.9)} max ${q(hs, 1)}; thirst deaths ${g.droughtKills}  [${((Date.now() - t0) / 60000).toFixed(1)} min]`);
  const bins = [['shaded', r => r.sun < 0.5], ['sunny', r => r.sun >= 0.5]], soils = [['poor', r => r.fert < 0.8], ['middling', r => r.fert >= 0.8 && r.fert < 1.2], ['rich', r => r.fert >= 1.2]];
  for (const [bn, bf] of bins) for (const [sn, sf] of soils) {
    const sel = rows.filter(r => bf(r) && sf(r)); if (!sel.length) continue;
    const m = k => (sel.reduce((a, r) => a + r[k], 0) / sel.length).toFixed(k === 'sun' || k === 'fert' ? 2 : 0);
    console.log(`  ${bn} ${sn}: ${sel.length} trees, height ${m('h')} (max ${Math.max(...sel.map(r => r.h))}), crown ${m('w')} wide, ${m('wood')} wood cells, sun ${m('sun')}, soil ${m('fert')}, age ${m('age')}`);
  }
}
const t0 = Date.now();
let s = 0;
for (; s <= seasons; s++) { report(); if (s < seasons) for (let f = 0; f < Sim.YEAR / 4; f++) g.step(); }
if (process.env.SAVE) require('fs').writeFileSync(process.env.SAVE, g.save());
