// Stage 2 and 3 checks. Each scenario builds a small world, runs it, and measures what it should.
// usage: node tools/validate.js [scenario...]   (default: all)
const { loadSim, census } = require('./load');
const Sim = loadSim(process.env.SIMFILE);
const { E, DIRT, STONE, WATER, TIP, SEED, WOOD, ROOT, LITTER, ASH, SNOW, PLANT, SAND, CLOUD, FIRE, LAVA, OIL, SALT, BRINE, ACID } = Sim.ids;
const MIN = 3600;   // ticks in a minute at 60 fps
let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); if (!ok) failed++; };

// a flat plot: stone floor, `depth` rows of dirt at moisture m, air above
function plot(W, H, depth, m, seed = 7) {
  Sim.reseed(seed);
  const g = new Sim.Grid(W, H);
  for (let y = H - depth; y < H; y++) for (let x = 0; x < W; x++) { const i = g.idx(x, y); if (y >= H - 3) g.set(i, STONE); else { g.set(i, DIRT); g.life[i] = (40 << 8) | m; } }
  g.initAir(); if (!m) for (let c = 0; c < g.hum.length; c++) g.hum[c] *= 0.3;   // dry ground under dry air
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
    // the surface dries by day and takes dew back at night, so judge it at its driest over those minutes
    let top2 = 1e9; run(g, 3 * MIN, 600, () => { top2 = Math.min(top2, moisture(g, H - 60, H - 58)); });
    const deep2 = moisture(g, H - 56, H - 52);
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
  // ---------------- stage 3: atmosphere and erosion ----------------
  shadow() {
    // a lake upwind of a ridge under a steady wind: the air is lifted over the ridge and rains out on the windward side
    Sim.reseed(11); const W = 480, H = 240, g = new Sim.Grid(W, H); g.clock = Sim.YEAR * 0.4; g.updateClimate(); g.windHold = 0.6;
    const ground = x => Math.round(175 - Math.max(0, 1 - Math.abs(x - 300) / 110) * 125);   // peak at x=300
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
      const i = g.idx(x, y), gy = ground(x), lake = x >= 30 && x < 190;
      if (lake && y >= gy && y < gy + 20) g.set(i, WATER);
      else if (y >= gy) g.set(i, y >= H - 4 || (x < 200 && y < gy + 24) ? STONE : DIRT, g.ambAt(y));
    }
    g.initAir(); g.wakeAll();
    const rainX = g.precip;
    run(g, 4 * MIN);   // late summer into winter
    let wind = 0, lee = 0; for (let x = 190; x < 300; x++) wind += rainX[x]; for (let x = 300; x < 410; x++) lee += rainX[x];
    const w = g.wc(240, 80), l = g.wc(360, 80);
    console.log(`  rain on the windward slope ${wind}, on the lee slope ${lee}; air over the windward slope rises at ${(-g.vc[w]).toFixed(2)} cells/tick, sinks behind at ${g.vc[l].toFixed(2)}`);
    check('wind is lifted over the ridge and sinks behind it', g.vc[w] < -0.02 && g.vc[l] > 0.02);
    check('rain shadow: the windward slope gets twice the rain of the lee', wind > 50 && wind > 2 * lee, `${wind} vs ${lee}`);
  },
  updraft() {
    // a bonfire with no prevailing wind: hot air rises over it and draws air in along the ground from both sides
    Sim.reseed(5); const W = 320, H = 200, g = new Sim.Grid(W, H); g.windHold = 0;
    for (let x = 0; x < W; x++) for (let y = H - 20; y < H; y++) g.set(g.idx(x, y), STONE, g.ambAt(y));
    for (let x = 150; x < 170; x++) for (let y = H - 50; y < H - 20; y++) g.set(g.idx(x, y), WOOD);
    g.initAir(); g.wakeAll(); run(g, 120);
    for (let x = 150; x < 170; x++) g.set(g.idx(x, H - 51), FIRE);
    run(g, 400);
    const up = g.vc[g.wc(160, H - 80)], left = g.uc[g.wc(120, H - 28)], right = g.uc[g.wc(200, H - 28)], calm = Math.abs(g.uc[g.wc(20, H - 28)]);
    console.log(`  over the fire ${(-up).toFixed(2)} cells/tick up; at the ground ${left.toFixed(2)} from the left, ${(-right).toFixed(2)} from the right; far away ${calm.toFixed(2)}`);
    check('fire makes an updraft', up < -0.2);
    check('and pulls air in along the ground from both sides', left > 0.1 && right < -0.1 && calm < 0.05);
  },
  fog() {
    // a lake in a valley: fog gathers over it in the small hours and burns off by midday; the hilltops stay clear
    Sim.reseed(9); const W = 320, H = 240, g = new Sim.Grid(W, H); g.clock = Sim.YEAR * 0.45; g.updateClimate(); g.windHold = 0;
    const hill = x => { const d = Math.abs(x - 160); return d < 40 ? 200 : Math.max(150, 200 - (d - 40) * 0.6); };
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
      const i = g.idx(x, y), h = hill(x);
      if (Math.abs(x - 160) < 34 && y >= h - 6 && y < h) g.set(i, WATER);
      else if (y >= h) { g.set(i, y >= H - 4 || (Math.abs(x - 160) < 40 && y < h + 4) ? STONE : DIRT, g.ambAt(y)); if (g.type[i] === DIRT) g.life[i] = (40 << 8) | 150; }
    }
    g.initAir(); g.wakeAll();
    // fog: cloud within 8 cells of the ground, in the valley (the lake and its shore) or on the high slopes
    const fog = () => { let v = 0, top = 0; for (let x = 0; x < W; x++) { const h = hill(x); for (let y = Math.max(0, Math.round(h) - 14); y < h; y++) if (g.type[g.idx(x, y)] === CLOUD) { if (Math.abs(x - 160) < 50) v++; else if (h < 160) top++; } } return [v, top]; };
    const at = {}; let hilltops = 0;
    run(g, 2 * Sim.DAY, 150, () => { const h = ((g.dayPhase * 24 + 6) % 24) | 0, [v, t] = fog(); at[h] = Math.max(at[h] || 0, v); hilltops = Math.max(hilltops, t); });
    const night = Math.max(at[2] || 0, at[3] || 0, at[4] || 0, at[5] || 0), noon = Math.max(at[12] || 0, at[13] || 0, at[14] || 0);
    console.log(`  valley fog: ${night} cells before dawn, ${noon} at midday; most fog on the high slopes at any time ${hilltops}`);
    check('fog forms in the valley at night', night >= 15);
    check('and burns off by midday', noon <= night / 4);
    check('the high slopes stay clear', hilltops <= night / 4);
  },
  dew() {
    // dry topsoil under saturated night air gathers dew; under dry air it doesn't
    const got = {};
    for (const [label, rh] of [['humid', 1.05], ['dry', 0.3]]) {
      const g = plot(120, 100, 30, 0); g.clock = Sim.DAY * 2.6; g.updateClimate(); g.windHold = 0;
      for (let x = 0; x < 120; x++) { const i = g.idx(x, 70); g.life[i] = (40 << 8) | 10; }
      g.initAir(); for (let c = 0; c < g.hum.length; c++) g.hum[c] = g.cap[c] * rh;
      const total = () => moisture(g, 70, 97) * 27 * 120 / 100;   // in water cells
      const m0 = total(); run(g, 900); const m = total();
      console.log(`  ${label} night air: the soil holds ${m0.toFixed(1)} -> ${m.toFixed(1)} water cells' worth`);
      got[label] = m - m0;
    }
    check('dew wets dry soil overnight, and dry air does not', got.humid > 2 && got.dry <= 0, `${got.humid.toFixed(1)} vs ${got.dry.toFixed(1)}`);
  },
  clouds() {
    // the generated world through an autumn: clouds form aloft with a level base, and it snows on the hills in winter
    const g = new Sim.Grid(960, 480); Sim.generate(g, 12345); g.clock = Sim.YEAR * 0.55; g.updateClimate();
    const bases = [], W = 960; let snow = 0, cloud = 0;
    run(g, 3 * Sim.DAY, Sim.DAY / 4, () => {
      for (let x = 0; x < W; x++) {
        let y = 0; while (y < g.H && (g.type[y * W + x] === E || Sim.EL[g.type[y * W + x]].kind === 'gas')) y++;
        for (let yy = y - 8; yy >= 0; yy--) if (g.type[yy * W + x] === CLOUD) { if (g.type[(yy + 1) * W + x] !== CLOUD) bases.push(yy); break; }
      }
      const c = census(g, Sim.EL); snow = Math.max(snow, c.Snow || 0); cloud = Math.max(cloud, c.Cloud || 0);
    });
    bases.sort((a, b) => a - b); const q = p => bases[Math.min(bases.length - 1, (bases.length * p) | 0)];
    console.log(`  ${bases.length} cloud-base samples over 3 days; base p10 ${q(0.1)}, p50 ${q(0.5)}, p90 ${q(0.9)} rows; most cloud ${cloud}, most snow lying ${snow}`);
    check('clouds form aloft', bases.length > 300);
    check('with a consistent base (middle 80% within 70 rows)', q(0.9) - q(0.1) <= 70);
    check('snow settles once winter comes (stage 2 had none on this world)', snow > 50);
  },
  erosion() {
    // a stream running down a sand slope cuts into it and carries the sand down into the basin, where it settles
    Sim.reseed(3); const W = 240, H = 160, g = new Sim.Grid(W, H); g.windHold = 0;
    const top = x => x < 150 ? Math.round(60 + x * 0.55) : 150;
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
      const i = g.idx(x, y);
      if (y >= H - 6 || (x >= 150 && y >= 150) || (x >= W - 3 && y >= 100)) g.set(i, STONE, g.ambAt(y));
      else if (x < 150 && y >= top(x)) g.set(i, y >= top(x) + 12 ? STONE : SAND, g.ambAt(y));
    }
    g.initAir(); g.wakeAll();
    const sandIn = (x0, x1) => { let n = 0; for (let y = 0; y < H; y++) for (let x = x0; x < x1; x++) if (g.type[g.idx(x, y)] === SAND) n++; return n; };
    const up0 = sandIn(0, 50), all0 = census(g, Sim.EL).Sand;
    run(g, 3 * MIN, 1, () => { for (let x = 4; x < 10; x++) { const i = g.idx(x, 40); if (g.type[i] === E) { g.set(i, WATER); g.vy[i] = 1; } } });
    const up = sandIn(0, 50), basin = sandIn(150, W), all = census(g, Sim.EL).Sand;
    console.log(`  upper slope ${up0} -> ${up} sand cells; basin 0 -> ${basin}; all sand ${all0} -> ${all}`);
    check('the stream cuts into the upper slope', up0 - up > 25);
    check('and drops the sand in the basin (a delta)', basin > 60);
    check('sand is conserved', Math.abs(all - all0) < 20);
  },
  lava() {
    // lava poured on cold stone heaps into a mound as it stiffens, instead of levelling like water
    Sim.reseed(4); const g = new Sim.Grid(120, 80); g.windHold = 0;
    for (let x = 0; x < 120; x++) for (let y = 76; y < 80; y++) g.set(g.idx(x, y), STONE, g.ambAt(y));
    g.initAir(); g.wakeAll();
    run(g, 4000, 1, f => { if (f < 1500 && f % 3 === 0) { const i = g.idx(60, 60); if (g.type[i] === E) g.set(i, LAVA); } });
    let h = 0, x0 = 1e9, x1 = -1; for (let y = 0; y < 76; y++) for (let x = 0; x < 120; x++) { const t = g.type[g.idx(x, y)]; if (t === STONE || t === LAVA || t === Sim.ids.RUBBLE) { h = Math.max(h, 76 - y); x0 = Math.min(x0, x); x1 = Math.max(x1, x); } }
    console.log(`  mound ${x1 - x0 + 1} wide, ${h} high`);
    check('lava sets as a mound (height at least a third of its width)', h * 3 >= x1 - x0 + 1);
  },
  tension() {
    const box = (W, H) => { Sim.reseed(4); const g = new Sim.Grid(W, H); g.windHold = 0; for (let x = 0; x < W; x++) for (let y = H - 4; y < H; y++) g.set(g.idx(x, y), STONE, g.ambAt(y)); g.initAir(); g.wakeAll(); return g; };
    { // a block of water set on a flat floor holds together as a puddle
      const g = box(300, 80); for (let y = 66; y < 76; y++) for (let x = 145; x < 155; x++) g.set(g.idx(x, y), WATER); run(g, 1500);
      let x0 = 1e9, x1 = -1; for (let i = 0; i < g.type.length; i++) if (g.type[i] === WATER) { x0 = Math.min(x0, i % 300); x1 = Math.max(x1, i % 300); }
      console.log(`  100 cells of water spread to a puddle ${x1 - x0 + 1} wide`);
      check('water holds a puddle rather than thinning to a film', x1 - x0 + 1 < 80);
    }
    { // lone drops bead where they land
      const g = box(120, 60); for (const x of [30, 60, 90]) g.set(g.idx(x, 55), WATER);
      run(g, 900, 1, () => { for (let c = 0; c < g.hum.length; c++) g.hum[c] = 0.98 * g.cap[c]; });   // in near-saturated air, so they don't dry up
      const xs = []; for (let i = 0; i < g.type.length; i++) if (g.type[i] === WATER) xs.push(i % 120);
      check('lone drops stay put', xs.join() === '30,60,90', xs.join());
    }
    { // oil on water spreads into a thin film
      const g = box(200, 80); for (let x = 0; x < 200; x++) for (let y = 50; y < 76; y++) g.set(g.idx(x, y), WATER);
      for (let y = 40; y < 46; y++) for (let x = 95; x < 105; x++) g.set(g.idx(x, y), OIL);
      run(g, 1800); let cols = 0, thick = 0; for (let x = 0; x < 200; x++) { let t = 0; for (let y = 0; y < 80; y++) if (g.type[g.idx(x, y)] === OIL) t++; if (t) cols++; thick = Math.max(thick, t); }
      console.log(`  60 cells of oil on water cover ${cols} columns, at most ${thick} thick`);
      check('oil spreads into a film on water', cols >= 45 && thick <= 2);
    }
  },
  level() {
    // water poured from a spout onto an open floor runs out wide while it pours, and lies flat once it stops (it must not heap like sand)
    Sim.reseed(4); const W = 300, H = 100, g = new Sim.Grid(W, H); g.windHold = 0;
    for (let x = 0; x < W; x++) for (let y = H - 4; y < H; y++) g.set(g.idx(x, y), STONE, g.ambAt(y));
    g.initAir(); g.wakeAll();
    const prof = () => { const hs = []; for (let x = 0; x < W; x++) { let h = 0; for (let y = 0; y < H; y++) if (g.type[g.idx(x, y)] === WATER) h++; hs.push(h); } return hs; };
    let cols10 = 0;
    run(g, 1500, 1, f => {
      if (f <= 1200) for (let dx = -1; dx <= 1; dx++) { const i = g.idx(150 + dx, 10); if (g.type[i] === E) { g.set(i, WATER); g.vy[i] = 1; } }
      if (f === 600) cols10 = prof().filter(h => h > 0).length;
    });
    const hs = prof(), lo = Math.min(...hs), hi = Math.max(...hs);
    console.log(`  after 10 s of pouring the water covers ${cols10} of ${W} columns; 5 s after the spout stops its depth is ${lo}..${hi}`);
    check('poured water runs out wide while pouring', cols10 >= 200, `${cols10} columns`);
    check('water settles level once the pour stops', hi - lo <= 3, `depth ${lo}..${hi}`);
  },
  salt() {
    const box = (W, H, floor = 4) => { Sim.reseed(4); const g = new Sim.Grid(W, H); g.windHold = 0; for (let x = 0; x < W; x++) for (let y = H - floor; y < H; y++) g.set(g.idx(x, y), STONE, g.ambAt(y)); for (let y = 0; y < H; y++) { g.set(g.idx(0, y), STONE); g.set(g.idx(W - 1, y), STONE); } g.initAir(); g.wakeAll(); return g; };
    { // salt dropped into a tank dissolves; the brine is heavier and settles in a layer under the fresh water
      const W = 40, H = 80, g = box(W, H); for (let y = 36; y < 76; y++) for (let x = 1; x < W - 1; x++) g.set(g.idx(x, y), WATER);
      for (let y = 20; y < 23; y++) for (let x = 10; x < 30; x++) g.set(g.idx(x, y), SALT);
      run(g, 3000);
      const sal = (y0, y1) => { let s = 0, n = 0; for (let y = y0; y < y1; y++) for (let x = 1; x < W - 1; x++) { const i = g.idx(x, y); if (g.type[i] === BRINE) s += g.life[i]; if (g.type[i] === BRINE || g.type[i] === WATER) n++; } return s / n; };
      const top = sal(36, 46), bottom = sal(66, 76), c = census(g, Sim.EL);
      console.log(`  60 salt in 1500 water: ${c.Salt || 0} undissolved; salt content top ${top.toFixed(1)}, bottom ${bottom.toFixed(1)}`);
      check('salt dissolves into brine', !c.Salt && c.Brine > 50);
      check('the brine layers under fresh water', bottom > 5 * Math.max(1, top));
    }
    { // a shallow pan of brine dries in the summer sun and leaves a salt crust
      const g = box(60, 60); g.clock = Sim.YEAR * 0.42; g.updateClimate();
      for (let y = 53; y < 56; y++) for (let x = 5; x < 55; x++) { const i = g.idx(x, y); g.set(i, BRINE); g.life[i] = 60; }
      run(g, 10 * MIN, 1, () => { for (let c = 0; c < g.hum.length; c++) g.hum[c] = Math.min(g.hum[c], 0.3 * g.cap[c]); });   // a dry wind carries the vapour off
      const c = census(g, Sim.EL);
      console.log(`  150 cells of weak brine after 10 min in a dry wind: ${c.Brine || 0} brine left, ${c.Salt || 0} salt crust`);
      check('a drying salt pan leaves a crust', (c.Salt || 0) >= 10 && (c.Brine || 0) < 50);
    }
    { // brine boiled off over lava leaves its salt behind
      const W = 40, H = 40, g = box(W, H, 8);
      for (let x = 1; x < W - 1; x++) for (let y = 30; y < 32; y++) g.set(g.idx(x, y), LAVA);
      for (let x = 1; x < W - 1; x++) for (let y = 24; y < 30; y++) { const i = g.idx(x, y); g.set(i, BRINE); g.life[i] = 100; }
      run(g, 2400); const c = census(g, Sim.EL);
      console.log(`  228 cells of brine (178 grains of salt) boiled dry: ${c.Salt || 0} salt left`);
      check('boiling brine leaves its salt', !c.Brine && c.Salt > 120 && c.Salt < 240);
    }
  },
  acid() {
    const box = (W, H, floor) => { Sim.reseed(4); const g = new Sim.Grid(W, H); g.windHold = 0; for (let x = 0; x < W; x++) for (let y = H - floor; y < H; y++) g.set(g.idx(x, y), STONE, g.ambAt(y)); for (let y = 0; y < H; y++) { g.set(g.idx(0, y), Sim.ids.GLASS); g.set(g.idx(W - 1, y), Sim.ids.GLASS); } g.initAir(); g.wakeAll(); return g; };
    { // acid poured into a pool is diluted and spent
      const g = box(60, 60, 4); for (let y = 30; y < 56; y++) for (let x = 1; x < 59; x++) g.set(g.idx(x, y), WATER);
      for (let y = 20; y < 25; y++) for (let x = 25; x < 35; x++) g.set(g.idx(x, y), ACID);
      let peak = 0, mean = 0; run(g, 120, 1, () => { let n = 0, s = 0; for (let i = 0; i < g.type.length; i++) if (g.type[i] === ACID) { n++; s += g.life[i]; } if (n > peak) { peak = n; mean = s / n; } });
      run(g, 1800); const left = census(g, Sim.EL).Acid || 0;
      console.log(`  50 cells of acid in a pool: up to ${peak} cells of acid at mean strength ${mean.toFixed(0)} as it mixes; ${left} left after 30 s`);
      check('water dilutes acid', peak > 50 && mean < 200);
      check('diluted acid is spent', left <= 5, `${left} of 50 left`);   // a stray cell or two can survive by chance (0-4 across seeds)
    }
    const ate = s => { const g = box(60, 60, 20); for (let y = 30; y < 40; y++) for (let x = 20; x < 40; x++) { const i = g.idx(x, y); g.set(i, ACID); g.life[i] = s; } const st = census(g, Sim.EL).Stone; run(g, 600); return st - census(g, Sim.EL).Stone; };
    const strong = ate(255), weak = ate(60);
    console.log(`  200 cells of acid eat ${strong} stone in 10 s at full strength, ${weak} when dilute`);
    check('dilute acid eats more slowly', weak * 2 < strong);
  },
  canopy() {
    // undermine a tree that stands in its neighbour's canopy: it crashes down through it rather than hanging there
    const W = 160, H = 140, g = plot(W, H, 50, 220);
    g.set(g.idx(80, H - 51), TIP); g.set(g.idx(92, H - 51), TIP); g.dropSeed = () => {};
    run(g, 2 * MIN);
    const t = g.trees.find(t => t.x === 80), y0 = t.y;
    for (let y = H - 50; y < H - 3; y++) for (let x = 62; x < 90; x++) { const i = g.idx(x, y); if (!(g.owner[i] === t.id && g.type[i] === WOOD) && g.type[i] !== STONE) { g.owner[i] = 0; g.set(i, E); } }
    for (const [i] of t.cells) if (g.type[i] === ROOT) { g.owner[i] = 0; g.set(i, E); }   // and cut any root that reached past the dig
    run(g, 900);
    console.log(`  ${g.trees.length} trees standing; the undermined one dropped ${t.y - y0} cells`);
    check('a toppling tree falls through its neighbour\'s canopy', t.dead && t.y - y0 > 20);
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
    const s2 = s.split('|').slice(0, 4).join('|'), k2 = new Sim.Grid(480, 240); k2.load(s2);
    check('stage 2 save format still loads', k2.trees.length === g.trees.length && Math.abs(k2.clock - g.clock) < 1);
    // liquids keep what they carry, and the sky keeps its vapour
    const m = new Sim.Grid(120, 80); for (let x = 0; x < 120; x++) for (let y = 70; y < 80; y++) m.set(m.idx(x, y), STONE);
    const put = (x, t, v) => { const i = m.idx(x, 69); m.set(i, t); m.life[i] = v; };
    put(10, WATER, 255 | 256); put(20, BRINE, 77); put(30, ACID, 99); m.hum[100] = 3.21;
    const r = new Sim.Grid(120, 80); r.load(m.save());
    check("sediment, salt and acid strength survive save/load", r.life[r.idx(10, 69)] === (255 | 256) && r.life[r.idx(20, 69)] === 77 && r.life[r.idx(30, 69)] === 99);
    check('the vapour field survives save/load', Math.abs(r.hum[100] - 3.21) < 0.01);
  },
  // ---------------- stage 4: engine ----------------
  tiles() {
    // the cell pass in checkerboard tiles: a tile only touches cells within REACH of itself, so tiles run in any order give the same world
    const make = () => { const S = loadSim(process.env.SIMFILE); S.reseed(1); const g = new S.Grid(640, 320); S.generate(g, 31); return g; };
    const a = make(), b = make();
    const scramble = list => { for (let k = list.length - 1; k > 0; k--) { const j = (k * 7919 + 13) % (k + 1); [list[k], list[j]] = [list[j], list[k]]; } return list.reverse(); };
    for (let f = 0; f < 200; f++) { a.step(); b.beginStep(); b.runTiles(scramble); b.endStep(); }
    let d = 0; for (let i = 0; i < a.type.length; i++) if (a.type[i] !== b.type[i] || a.life[i] !== b.life[i] || a.temp[i] !== b.temp[i]) d++;
    console.log(`  200 ticks with each phase's tiles in a scrambled order: ${d} cells differ`);
    check('tile order within a phase does not change the world', d === 0);
  },
  stream() {
    // a window streaming along a world eight times as wide: regions round-trip exactly, streamed land matches land generated in place,
    // trees go and come back with their regions, and a stored region is a small fraction of its size in memory
    const g = new Sim.Grid(960, 480); Sim.generate(g, 4242, 7680, 3200); run(g, 120);
    const snap = f => { const o = []; for (let y = 0; y < g.H; y++) for (let x = 0; x < Sim.REGION; x++) o.push(g[f][y * g.W + x]); return o; };
    const t0 = snap('type'), l0 = snap('life'), o0 = snap('owner'), m0 = snap('temp'), ids = g.trees.filter(t => t.x < Sim.REGION).map(t => t.id).sort();
    let ms = performance.now(); g.shift(1); const tOut = performance.now() - ms;
    check('trees rooted in the region leave with it', ids.every(id => !g.trees.some(t => t.id === id) && g.storedTrees.has(id)), `${ids.length} trees`);
    ms = performance.now(); g.shift(-1); const tIn = performance.now() - ms;
    const t1 = snap('type'), l1 = snap('life'), o1 = snap('owner'), m1 = snap('temp');
    let dt = 0, dl = 0, dm = 0, dow = 0; for (let k = 0; k < t0.length; k++) { if (t0[k] !== t1[k]) dt++; if (l0[k] !== l1[k]) dl++; if (Math.abs(m0[k] - m1[k]) > 0.5) dm++; if (o0[k] !== o1[k]) dow++; }
    console.log(`  out and back: ${dt} types, ${dl} life values, ${dow} owners and ${dm} temperatures (beyond rounding) differ; shift out ${tOut.toFixed(0)} ms, back ${tIn.toFixed(0)} ms`);
    check('a region comes back as it left', dt <= 30 && dl <= 30 && dm === 0, `${dt} types, ${dl} life values differ`);
    check('and so do its trees', ids.every(id => g.trees.some(t => t.id === id)));
    // walk five regions right, making each ahead of time the way the page does; then compare with the same land generated in place
    let slices = 0, worst = 0; for (let k = 0; k < 5; k++) { for (;;) { const a = performance.now(); const more = g.prefetch(); worst = Math.max(worst, performance.now() - a); if (!more) break; slices++; } g.shift(1); }
    const h = new Sim.Grid(960, 480); Sim.generate(h, 4242, 7680, g.ox);
    let same = 0, tot = 0; for (let i = 0; i < g.type.length; i++) { if (i % g.W < 2 * Sim.REGION || g.owner[i] || h.owner[i]) continue; tot++; if (g.type[i] === h.type[i]) same++; }
    console.log(`  new regions made ahead in ${slices} slices, the longest ${worst.toFixed(1)} ms; the newest region matches in-place generation on ${same}/${tot} non-tree cells`);
    check('streamed land is the same land', same === tot);
    let bytes = 0; for (const r of g.store.values()) bytes += r.type.byteLength + r.life.byteLength + r.temp.byteLength + r.owner.byteLength + r.hum.byteLength;
    const per = bytes / g.store.size, raw = Sim.REGION * g.H * g.buffer.byteLength / (g.W * g.H);
    console.log(`  ${g.store.size} regions stored, ${(per / 1024).toFixed(0)} KB each against ${(raw / 1024).toFixed(0)} KB live (${(raw / per).toFixed(0)}x)`);
    check('a stored region takes a small fraction of its live memory', per * 10 < raw);
    // save and load the streamed world
    const s = g.save(), k = new Sim.Grid(960, 480); k.load(s);
    check('a streamed world saves and loads', k.ox === g.ox && k.worldW === 7680 && k.store.size === g.store.size && k.trees.length === g.trees.length, `${(s.length / 1024) | 0} KB`);
    k.shift(-1); check('and keeps streaming after loading', k.ox === g.ox - Sim.REGION && k.trees.length > 0);
  },
};
const seasonAt = clock => ['Spring', 'Summer', 'Autumn', 'Winter'][(((clock % Sim.YEAR) / Sim.YEAR) * 4) | 0];

const pick = process.argv.slice(2);
for (const [name, fn] of Object.entries(scenarios)) { if (pick.length && !pick.includes(name)) continue; console.log(`# ${name}`); const t = Date.now(); fn(); console.log(`  (${((Date.now() - t) / 1000).toFixed(1)} s)`); }
if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
