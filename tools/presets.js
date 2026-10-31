// Biome presets (X6): generate the page's world as each preset (or the ones named), at the window a new world opens on, and run it,
// logging each minute what the window's columns are covered by (forest, meadow, scrub, desert, reeds, water, bare rock, lava), its
// trees (broadleaf / conifer), snow, the land's height, its rivers, the coast's kind, an eruption under way, and the step's cost.
// SNAP=dir writes a PNG of the window (each cell its element's colour) at the start and the end.
// usage: node tools/presets.js [minutes] [seed] [preset ids...]   (SIMFILE=other.html runs another copy)
const { loadSim } = require('./load');
const fs = require('fs'), zlib = require('zlib');
const Sim = loadSim(process.env.SIMFILE);
const mins = +(process.argv[2] || 2), seed = +(process.argv[3] || 12345), only = process.argv.slice(4);
const { E, PLANT, SAND, SHRUB, CACTUS, REED, WATER, BRINE, LAVA, SNOW, STONE, RUBBLE, ICE } = Sim.ids;

function png(g, file) {   // the window as a PNG, a pixel a cell
  const W = g.W, H = g.H, raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; for (let x = 0; x < W; x++) { const c = Sim.EL[g.type[g.idx(x, y)]].rgb, o = y * (W * 3 + 1) + 1 + x * 3; raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]; } }
  const crc = b => { let c = ~0; for (const v of b) { c ^= v; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; } return ~c >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]), c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(H, 4); ih[8] = 8; ih[9] = 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
function survey(g) {
  const cols = { forest: 0, meadow: 0, scrub: 0, desert: 0, reeds: 0, water: 0, rock: 0, lava: 0, other: 0 };
  let snow = 0, lava = 0, surf = 0;
  for (let x = 0; x < g.W; x++) {
    let tree = false, reed = false, y = 0;
    for (; y < g.H; y++) { const i = g.idx(x, y), t = g.type[i]; if (g.owner[i]) { tree = true; continue; } if (t === REED) reed = true; if (t === E || Sim.EL[t].kind === 'gas' || t === REED) continue; break; }
    const t = y < g.H ? g.type[g.idx(x, y)] : E; surf += y;
    cols[tree ? 'forest' : reed ? 'reeds' : t === PLANT ? 'meadow' : t === SHRUB ? 'scrub' : t === CACTUS || t === SAND ? 'desert' : t === WATER || t === BRINE || t === ICE ? 'water' : t === STONE || t === RUBBLE || t === SNOW ? 'rock' : t === LAVA ? 'lava' : 'other']++;
  }
  for (let i = 0; i < g.type.length; i++) { const t = g.type[i]; if (t === SNOW) snow++; else if (t === LAVA) lava++; }
  const con = g.trees.filter(t => t.con).length;
  return { cols, snow, lava, surf: Math.round(surf / g.W), broad: g.trees.length - con, con };
}
const W = Sim.WORLD;
for (let k = 0; k < Sim.BIOMES.length; k++) {
  const b = Sim.BIOMES[k]; if (only.length && !only.includes(b.id)) continue;
  const g = new Sim.Grid(W.W, W.H), ox = Sim.homeOf(W.WIDE, k);
  Sim.generate(g, seed, W.WIDE, ox, k);
  const T = g.noise, rivers = T.rivers.filter(r => r.x0 < ox + g.W && r.x1 > ox).length;
  console.log(`== ${b.name} (seed ${seed}, window at ${ox}): ${T.sea ? T.sea.kind + ' coast, shore at ' + T.sea.shore : 'no sea'}, ${T.rivers.length} rivers (${rivers} in the window)` + (T.volc ? `, volcano at ${T.volc.x}, peak row ${T.volc.peakY}` : '') + `, aridity at the middle ${Sim.aridAt(seed, ox + g.W / 2, k).toFixed(2)}`);
  if (process.env.SNAP) png(g, `${process.env.SNAP}/${b.id}-0.png`);
  let ms = 0, n = 0, worst = 0;
  for (let m = 0; m <= mins; m++) {
    const r = survey(g);
    console.log(`  ${m} min ${g.seasonName.padEnd(6)}: ${Object.entries(r.cols).filter(([, v]) => v).map(([c, v]) => c + ' ' + v).join(', ')} | trees ${r.broad}+${r.con} con | snow ${r.snow} | lava ${r.lava}${g.eruption ? ' ERUPTING' : ''} | mean ground row ${r.surf} | ${(ms / Math.max(1, n)).toFixed(2)} ms/tick (worst ${worst.toFixed(0)})`);
    ms = 0; n = 0; worst = 0;
    if (m < mins) for (let f = 0; f < 3600; f++) { const a = process.hrtime.bigint(); g.step(); const d = Number(process.hrtime.bigint() - a) / 1e6; ms += d; n++; if (d > worst) worst = d; }
  }
  if (process.env.SNAP) png(g, `${process.env.SNAP}/${b.id}-${mins}.png`);
}
