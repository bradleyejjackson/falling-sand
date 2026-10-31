// Many years: generate the page's world and run it year after year, logging each season what lives in the window (rabbits,
// grasshoppers and their eggs, foxes, birds, fish, grass cells, scrub cells, live trees of each kind), how the land stands (mean
// moisture and nutrients of the top 10 rows of dirt, water cells, bare columns), trees born and how the dead ones died (fire,
// thirst, old age, other: felled or uprooted), and lightning strikes; under each season, the range of rabbits and the biggest
// fire seen in it. Nothing should die out for good, and the soil shouldn't drain away.
// usage: node tools/decade.js [seed] [years] [prefix]   (SIMFILE=other.html runs another copy; NOLIGHT=1 turns lightning off.
// With a prefix it saves <prefix>-y<n>.sav at the end of each year and, run again, carries on from the latest of them, so a long
// run survives being stopped; the log lines go to stdout either way)
const { loadSim } = require('./load');
const fs = require('fs');
const Sim = loadSim(process.env.SIMFILE);
const seed = +(process.argv[2] || 12345), years = +(process.argv[3] || 10), out = process.argv[4];
const { E, PLANT, SHRUB, DIRT, WATER, RABBIT, HOPPER, FOX, BIRD, FIRE, EMBER, CHAR, ASH } = Sim.ids, FISH = Sim.ids.FISH ?? -1;
const g = new Sim.Grid(Sim.WORLD.W, Sim.WORLD.H);
let year = 0;
if (out) for (let y = years; y > 0; y--) if (fs.existsSync(`${out}-y${y}.sav`)) { Sim.reseed(seed + y); g.load(fs.readFileSync(`${out}-y${y}.sav`, 'utf8')); year = y; break; }
if (!year) Sim.generate(g, seed, Sim.WORLD.WIDE, Math.floor((Sim.WORLD.WIDE - g.W) / 2 / Sim.REGION) * Sim.REGION);
if (process.env.NOLIGHT) g.lightning = false;
// how trees die: fire (two or more of its cells burning or burnt), thirst (Grid.droughtKills went up), old age, or other
const cause = { fire: 0, thirst: 0, old: 0, other: 0 }; let lastDK = g.droughtKills;
const release = g.releaseTree.bind(g);
g.releaseTree = function (t) {
  let burnt = 0; for (const [i] of t.cells) { const c = g.type[i]; if (c === FIRE || c === EMBER || c === CHAR || c === ASH) burnt++; }
  if (g.droughtKills > lastDK) { cause.thirst++; lastDK = g.droughtKills; } else if (burnt >= 2) cause.fire++; else if (t.age > t.span) cause.old++; else cause.other++;
  return release(t);
};
let born = 0; const seen = new Set(g.trees.map(t => t.id));
function count() {
  const r = { rab: 0, hop: 0, eggs: 0, fox: 0, bird: 0, fish: 0, grass: 0, shrub: 0, fire: 0 }, T = g.type;
  for (let i = 0; i < T.length; i++) { const t = T[i]; if (t === RABBIT) r.rab++; else if (t === HOPPER) { if (g.life[i] & Sim.EGG) r.eggs++; else r.hop++; } else if (t === FOX) r.fox++; else if (t === BIRD) { if (!(g.life[i] & Sim.EGG)) r.bird++; } else if (t === FISH) { if (!(g.life[i] & Sim.EGG)) r.fish++; } else if (t === PLANT && !g.owner[i]) r.grass++; else if (t === SHRUB) r.shrub++; else if (t === FIRE || t === EMBER) r.fire++; }
  return r;
}
function land() {   // the top 10 rows of dirt under each column's surface: mean moisture and nutrients; water cells; columns of bare dirt
  const T = g.type; let m = 0, n = 0, rich = 0, bare = 0, water = 0;
  for (let i = 0; i < T.length; i++) if (T[i] === WATER) water++;
  for (let x = 0; x < g.W; x++) {
    let y = 0; for (; y < g.H; y++) { const i = g.idx(x, y), t = T[i]; if (g.owner[i]) continue; if (t !== E && Sim.EL[t].kind !== 'gas' && t !== RABBIT && t !== BIRD && t !== FOX && t !== HOPPER) break; }
    if (y < g.H && T[g.idx(x, y)] === DIRT) bare++;
    for (let k = 0; k < 10 && y + k < g.H; k++) { const i = g.idx(x, y + k); if (T[i] === DIRT) { m += g.life[i] & 255; rich += g.life[i] >> 8; n++; } }
  }
  return { soil: n ? m / n : 0, rich: n ? rich / n : 0, bare, water };
}
const t0 = Date.now();
for (let s = 0; ; s++) {
  const r = count(), l = land(), live = g.trees.filter(t => !t.dead && !t.cones && !t.sprout), con = live.filter(t => t.con).length;
  console.log(`y${(g.clock / Sim.YEAR).toFixed(2)} ${g.seasonName} wet ${(g.wet || 0).toFixed(2)}: rab ${r.rab} hop ${r.hop}/${r.eggs}e fox ${r.fox} bird ${r.bird} fish ${r.fish} | grass ${r.grass} shrub ${r.shrub} soil ${l.soil.toFixed(0)} nutr ${l.rich.toFixed(0)} bare ${l.bare} water ${l.water} | trees ${live.length - con}b ${con}c born ${born} died fire ${cause.fire} thirst ${cause.thirst} old ${cause.old} other ${cause.other} strikes ${g.strikes} [${((Date.now() - t0) / 60000).toFixed(1)}m]`);
  if (s && s % 4 === 0) { year++; if (out) fs.writeFileSync(`${out}-y${year}.sav`, g.save()); }
  if (year >= years) break;
  let lo = 1e9, hi = 0, fire = 0;
  for (let f = 0; f < Sim.YEAR / 4; f++) {
    g.step();
    if (f % 900 === 0) { for (const t of g.trees) if (!seen.has(t.id)) { seen.add(t.id); born++; } if (f % 1800 === 0) { const c = count(); lo = Math.min(lo, c.rab); hi = Math.max(hi, c.rab); fire = Math.max(fire, c.fire); } }
  }
  console.log(`   season: rabbits ${lo}-${hi}, biggest fire ${fire} cells`);
}
