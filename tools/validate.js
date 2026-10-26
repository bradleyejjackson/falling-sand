// Stage 2 checks. Each scenario builds a small world, runs it, and measures what it should.
// usage: node tools/validate.js [scenario...]   (default: all)
const { loadSim, census } = require('./load');
const Sim = loadSim();
const { E, DIRT, STONE, WATER, TIP, SEED, WOOD, ROOT, LITTER, ASH, SNOW, PLANT } = Sim.ids;
const MIN = 3600;   // ticks in a minute at 60 fps
let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); if (!ok) failed++; };

// a flat plot: stone floor, `depth` rows of dirt at moisture m, air above
function plot(W, H, depth, m, seed = 7) {
  Sim.reseed(seed);
  const g = new Sim.Grid(W, H);
  for (let y = H - depth; y < H; y++) for (let x = 0; x < W; x++) { const i = g.idx(x, y); if (y >= H - 3) g.set(i, STONE); else { g.set(i, DIRT); g.life[i] = (40 << 8) | m; } }
  return g;
}
const moisture = (g, y0, y1) => { let s = 0, n = 0; for (let i = y0 * g.W; i < y1 * g.W; i++) if (g.type[i] === DIRT) { s += g.life[i] & 255; n++; } return n ? s / n : 0; };
const run = (g, n, every, fn) => { for (let f = 1; f <= n; f++) { g.step(); if (every && f % every === 0) fn(f); } };

const scenarios = {
  sapling() {
    // a watered sapling on dirt grows into a tree that seeds a second generation within a few minutes; a dry one doesn't
    for (const [label, m] of [['damp', 200], ['dry', 0]]) {
      const W = 220, H = 160, g = plot(W, H, 40, m);
      const sx = 110, sy = H - 41; g.set(g.idx(sx, sy), TIP);
      let gen2 = -1, h = 0, seeds = 0;
      run(g, 6 * MIN, 600, f => {
        const first = g.trees.find(t => t.x === sx);
        if (first) h = Math.max(h, Math.round(first.segs[0].len));
        if (gen2 < 0 && g.trees.some(t => t.x !== sx)) gen2 = f;
      });
      for (let i = 0; i < g.type.length; i++) if (g.type[i] === SEED) seeds++;
      const t0 = g.trees.find(t => t.x === sx);
      const roots = t0 ? t0.segs.filter(s => s.root && s.alive).length : 0;
      console.log(`  ${label}: trunk ${h} cells, ${roots} root segments, ${g.trees.length} trees, first 2nd-gen at ${gen2 < 0 ? 'never' : (gen2 / MIN).toFixed(1) + ' min'}, ${seeds} seeds lying`);
      if (label === 'damp') check('damp sapling seeds a 2nd generation within 4 min', gen2 > 0 && gen2 <= 4 * MIN, gen2 > 0 ? (gen2 / MIN).toFixed(1) + ' min' : 'never');
      else check('dry sapling does not grow', h <= 1 && g.trees.length === 1, `trunk ${h}`);
    }
  },
  sand() {
    // a sapling on bare sand has nothing to drink
    Sim.reseed(3); const W = 120, H = 100, g = new Sim.Grid(W, H);
    for (let y = H - 30; y < H; y++) for (let x = 0; x < W; x++) g.set(g.idx(x, y), y >= H - 3 ? STONE : Sim.ids.SAND);
    g.set(g.idx(60, H - 31), TIP); run(g, 2 * MIN);
    check('sapling on bare sand does not grow', g.trees.length === 1 && g.trees[0].segs[0].len <= 1, `trunk ${g.trees[0] && g.trees[0].segs[0].len.toFixed(1)}`);
  },
  soak() {
    // water poured on dry dirt soaks in and seeps down; the surface then dries in the sun while the depths stay damp
    const W = 100, H = 120, g = plot(W, H, 60, 0);
    for (let y = H - 70; y < H - 60; y++) for (let x = 20; x < 80; x++) g.set(g.idx(x, y), WATER);
    let water0 = 600, gone = -1;
    run(g, 2 * MIN, 60, f => { let w = 0; for (let i = 0; i < g.type.length; i++) if (g.type[i] === WATER) w++; if (gone < 0 && w === 0) gone = f; });
    const prof = () => [0, 2, 4, 6, 8, 10, 14, 20].map(d => moisture(g, H - 60 + d, H - 58 + d).toFixed(0)).join(' ');
    const deep = moisture(g, H - 52, H - 48);
    console.log(`  10 rows of water (600 cells) soaked in after ${gone < 0 ? 'never' : (gone / 60).toFixed(0) + ' s'}; moisture at depth 0,2,4,6,8,10,14,20: ${prof()}`);
    check('surface water soaks into dry dirt within 2 min', gone > 0);
    check('moisture seeps 8+ cells down', deep > 20, deep.toFixed(0));
    run(g, 3 * MIN);
    const top2 = moisture(g, H - 60, H - 58), deep2 = moisture(g, H - 56, H - 52);
    console.log(`  3 min later: ${prof()}`);
    check('exposed surface dries faster than the depths', top2 < deep2, `${top2.toFixed(0)} < ${deep2.toFixed(0)}`);
  },
  topple() {
    // dig the soil out from under a grown tree and it falls as a unit, then lies dead
    const W = 160, H = 140, g = plot(W, H, 50, 220);
    g.set(g.idx(80, H - 51), TIP); g.dropSeed = () => {};   // a lone tree, so no neighbours' canopies catch it
    run(g, 2 * MIN);
    const t = g.trees.find(t => t.x === 80); const y0 = t.y;
    for (let y = H - 50; y < H - 3; y++) for (let x = 60; x < 100; x++) { const i = g.idx(x, y); if (g.type[i] !== WOOD || !g.owner[i]) if (g.type[i] !== STONE) g.set(i, E); }
    let fell = 0; run(g, 600, 1, () => { if (t.falling) fell = 1; });
    check('undermined tree falls as a unit and dies on landing', fell && t.dead && t.y > y0 + 10, `fell ${t.y - y0} cells, dead=${!!t.dead}`);
  },
  rot() {
    // litter and dead wood rot into dirt; ash on dirt enriches it
    const W = 80, H = 60, g = plot(W, H, 20, 150);
    for (let x = 10; x < 30; x++) g.set(g.idx(x, H - 21), LITTER);
    for (let x = 50; x < 70; x++) g.set(g.idx(x, H - 21), ASH);
    for (let y = H - 30; y < H - 20; y++) { const i = g.idx(40, y); g.set(i, WOOD); g.life[i] = 600; }   // a dead snag (life >= 2)
    const pw = g.idx(20, H - 30); g.set(pw, WOOD);                                                    // painted wood (life 0) on a ledge
    let litterGone = -1, ashGone = -1;
    run(g, 6 * MIN, 120, f => {
      const c = census(g, Sim.EL);
      let lit = 0; for (let y = H - 24; y < H - 19; y++) for (let x = 5; x < 32; x++) if (g.type[g.idx(x, y)] === LITTER) lit++;
      if (litterGone < 0 && lit <= 4) litterGone = f;   // 80% rotted
      if (ashGone < 0 && !c.Ash) ashGone = f;
    });
    let rich = 0, n = 0; for (let x = 50; x < 70; x++) { const i = g.idx(x, H - 21); if (g.type[i] === DIRT) { rich += g.life[i] >> 8; n++; } }
    const c = census(g, Sim.EL);
    console.log(`  80% of litter gone ${litterGone < 0 ? 'never' : (litterGone / MIN).toFixed(1) + ' min'}, ash gone ${ashGone < 0 ? 'never' : (ashGone / MIN).toFixed(1) + ' min'}, richness where ash was ${n ? (rich / n).toFixed(0) : '-'}, snag wood left ${c.Wood - 1}`);
    check('most litter rots into dirt within 6 min', litterGone > 0);
    check('ash turns into rich dirt', ashGone > 0 && n > 10 && rich / n > 200);
    check('the snag has rotted', (c.Wood || 0) - 1 < 10, `${c.Wood - 1} cells left`);
    check('painted wood does not rot', g.type[pw] === WOOD);
  },
  seasons() {
    // one year on a generated world: the temperature swing and leaf drop
    const g = new Sim.Grid(480, 240); Sim.generate(g, 99);
    const Y = Sim.YEAR, rows = [], leafAt = {}, clim = {};
    run(g, Y, Y / 32, f => {
      const c = census(g, Sim.EL);
      leafAt[g.seasonName] = Math.max(leafAt[g.seasonName] || 0, c.Plant || 0);
      clim[g.seasonName] = (clim[g.seasonName] || []).concat(g.climate);
      rows.push(`${g.seasonName.padEnd(6)} ${(g.yearPhase).toFixed(2)} climate ${g.climate.toFixed(1).padStart(5)} snow ${String(c.Snow || 0).padStart(5)} leaves ${String(c.Plant || 0).padStart(5)} litter ${String(c.Litter || 0).padStart(4)} trees ${g.trees.length} cloud ${c.Cloud || 0} water ${c.Water || 0}`);
    });
    if (process.env.VERBOSE) console.log(rows.join('\n'));
    const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
    console.log('  mean climate offset: ' + Object.entries(clim).map(([k, v]) => `${k} ${avg(v).toFixed(1)}`).join(', '));
    check('summer is warmer than winter by 10+ degrees', avg(clim.Summer) - avg(clim.Winter) > 10);
    check('trees have fewer leaves in winter than in summer', (leafAt.Winter || 0) < 0.5 * (leafAt.Summer || 1), `${leafAt.Winter} vs ${leafAt.Summer}`);
  },
  snow() {
    // clouds snow in winter and rain in summer; snow on a cold hilltop lasts the winter and melts in spring
    for (const [label, p] of [['winter', 0.88], ['summer', 0.42]]) {
      const g = new Sim.Grid(200, 160); g.clock = Sim.YEAR * p; g.updateClimate();
      for (let y = 20; y < 26; y++) for (let x = 60; x < 140; x++) g.set(g.idx(x, y), Sim.ids.CLOUD);
      let sn = 0, rn = 0; const set = g.set.bind(g);
      g.set = (i, t, tmp) => { if (t === SNOW && g.type[i] === WATER) sn++; if (t === WATER && g.type[i] === E) rn++; return set(i, t, tmp); };
      run(g, 1200);
      console.log(`  ${label}: ${rn} drops fell, ${sn} froze into snow on the way down`);
      if (label === 'winter') check('winter clouds snow', rn > 5 && sn >= rn * 0.8);
      else check('summer clouds rain', rn > 5 && sn === 0);
    }
    // a hilltop well above the valley floor (the air cools with height), so winter air there is below freezing
    const W = 120, H = 300, g = new Sim.Grid(W, H); g.clock = Sim.YEAR * 0.8; g.updateClimate();
    const top = 30;
    for (let y = top; y < H; y++) for (let x = 0; x < W; x++) { const i = g.idx(x, y); g.set(i, y >= H - 3 ? STONE : DIRT, Math.min(10, g.ambAt(y))); }   // ground already chilled by the winter
    for (let y = top - 4; y < top; y++) for (let x = 0; x < W; x++) g.set(g.idx(x, y), SNOW);
    const snow = () => census(g, Sim.EL).Snow || 0, s0 = snow();
    run(g, 2 * MIN); const s1 = snow();
    g.clock = Sim.YEAR * 0.3; g.updateClimate(); run(g, 2 * MIN); const s2 = snow();
    console.log(`  hilltop air ${g.ambAt(top - 1).toFixed(1)}° in summer; snow ${s0} -> ${s1} after 2 min of winter -> ${s2} after 2 min of summer`);
    check('snow lasts through winter on the hilltop', s1 > 0.8 * s0);
    check('and melts when it warms up', s2 < 0.2 * s0);
  },
  save() {
    // save/load keeps soil moisture, rot timers and the calendar; older saves still load
    const g = new Sim.Grid(480, 240); Sim.generate(g, 5); run(g, 300);
    const s = g.save(), h = new Sim.Grid(480, 240); h.load(s);
    let same = 0, n = 0; for (let i = 0; i < g.type.length; i++) if (g.type[i] === DIRT) { n++; if (g.life[i] === h.life[i]) same++; }
    check('dirt moisture survives save/load', n > 0 && same === n, `${same}/${n}`);
    check('calendar survives save/load', Math.abs(h.clock - g.clock) < 1 && h.trees.length === g.trees.length);
    const old = s.split('|').slice(0, 2).join('|'), k = new Sim.Grid(480, 240); k.load(old);
    check('stage 1 save format still loads', k.trees.length === g.trees.length);
  },
};
const seasonAt = clock => ['Spring', 'Summer', 'Autumn', 'Winter'][(((clock % Sim.YEAR) / Sim.YEAR) * 4) | 0];

const pick = process.argv.slice(2);
for (const [name, fn] of Object.entries(scenarios)) { if (pick.length && !pick.includes(name)) continue; console.log(`# ${name}`); const t = Date.now(); fn(); console.log(`  (${((Date.now() - t) / 1000).toFixed(1)} s)`); }
if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
