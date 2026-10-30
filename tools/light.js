// Measure how lit the view is: the brightness the render gives the ground's exposed faces (cells of ground next to open air),
// split by what lies over them: open sky, cloud, or an overhang of rock; and the floor of a cave. Noon and midnight, in a flat
// world with a cloud bank, a stone shelf and a cave dug into the ground. Brightness here is the render's light factor (1 = full
// daylight) before glow. usage: node tools/light.js [other.html ...] (each file must expose window.sandfall.light)
const { loadPage } = require('./load');
const files = process.argv.slice(2); if (!files.length) files.push(undefined);
const VW = 320, VH = 240;
function scene(file, hour) {
  const p = loadPage(file), { g, Sim } = p.sf, { E, STONE, CLOUD } = Sim.ids, W = g.W;
  p.run(2); p.els.flatworld.fire('click'); p.els.pause.fire('click'); p.run(1);
  const { x: camX, y: camY } = p.sf.cam(), top = (() => { for (let y = 0; y < g.H; y++) if (g.type[y * W + camX] !== E) return y; })();
  const set = (x0, y0, x1, y1, t) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) g.type[(camY + y) * W + camX + x] = t; };
  const gy = top - camY;                                  // the ground's row in the view
  set(10, gy - 120, 110, gy - 90, CLOUD);                 // a cloud bank 30 deep over the left
  set(140, gy - 28, 220, gy - 24, STONE);                 // a stone shelf 4 thick, 24 over the ground
  set(250, gy + 10, 310, gy + 26, E); set(244, gy, 254, gy + 26, E);   // a cave, its mouth a shaft at its west end
  g.clock = Math.floor(g.clock / Sim.DAY) * Sim.DAY + Sim.DAY * ((hour - 6 + 24) % 24) / 24; g.updateClimate(); g.hold = true;
  p.run(1);
  const L = p.sf.light, dark = 0.2, oldDark = 0.12, cats = { open: [], cloud: [], shelf: [], cave: [] };
  const d = file && /old/.test(file) ? oldDark : dark;   // (a copy named *old* is taken to be from before the shade floor went up from 0.12)
  for (let vy = 1; vy < VH - 1; vy++) for (let vx = 1; vx < VW - 1; vx++) {
    const i = (camY + vy) * W + camX + vx, t = g.type[i]; if (t === E || t === CLOUD) continue;
    if (g.type[i - 1] !== E && g.type[i + 1] !== E && g.type[i - W] !== E && g.type[i + W] !== E) continue;
    let over = 'open'; for (let y = camY + vy - 1; y >= 0; y--) { const u = g.type[y * W + camX + vx]; if (u === CLOUD) over = 'cloud'; else if (u !== E) { over = 'shelf'; break; } }
    if (vx >= 250 && vy >= gy + 10 && vy <= gy + 27 && vx <= 311) over = 'cave'; else if (over === 'shelf' && vy < gy - 20) continue;   // (the shelf's own underside counts as shelf)
    cats[over].push(d + (1 - d) * Math.max(0, L[vy * VW + vx]));
  }
  const q = (a, f) => { a.sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, a.length * f | 0)].toFixed(2) : '-'; };
  return Object.entries(cats).map(([k, a]) => `${k} ${q(a, 0.5)} (p10 ${q(a, 0.1)}, n${a.length})`).join(' · ');
}
for (const f of files) for (const h of [12, 0]) console.log(`${f || 'falling-sand.html'} ${String(h).padStart(2, '0')}:00  ${scene(f, h)}`);
