// Stage 2 and 3 checks, and later ones. Each scenario builds a small world, runs it, and measures what it should.
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
      else check('dry sapling does not grow (it dies of thirst)', h <= 1 && gen2 < 0 && g.trees.length <= 1, `trunk ${h}, ${g.droughtKills} died of thirst`);
    }
  },
  sand() {
    // a sapling on bare sand has nothing to drink
    Sim.reseed(3); const W = 120, H = 100, g = new Sim.Grid(W, H);
    for (let y = H - 30; y < H; y++) for (let x = 0; x < W; x++) g.set(g.idx(x, y), y >= H - 3 ? STONE : Sim.ids.SAND);
    g.set(g.idx(60, H - 31), TIP); run(g, 2 * MIN);
    check('sapling on bare sand does not grow', g.trees.every(t => t.segs[0].len <= 1) && g.trees.length + g.droughtKills === 1, `trunk ${g.trees[0] ? g.trees[0].segs[0].len.toFixed(1) : '-'}, died of thirst ${g.droughtKills}`);
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
    const pw = g.idx(20, H - 30); g.set(pw, WOOD);                                                    // painted wood (life 0), in mid-air: it drops onto the litter
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
    let painted = 0; for (let i = 0; i < g.type.length; i++) if (g.type[i] === WOOD && g.life[i] < 2) painted++;
    check('painted wood does not rot', painted === 1, `${painted} painted wood cells`);
  },
  seasons() {
    // one year on a generated world: the temperature swing and leaf drop
    const g = new Sim.Grid(480, 240); Sim.generate(g, 99);
    const Y = Sim.YEAR, rows = [], leafAt = {}, clim = {};
    run(g, Y, Y / 32, f => {
      const c = census(g, Sim.EL);
      c.Plant = 0; for (let i = 0; i < g.type.length; i++) if (g.type[i] === PLANT && g.owner[i]) c.Plant++;   // leaves only, not grass
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
    // (precipitation leaves the cloud as a flake or a drop: a flake counts as snow, and so does a drop that freezes on the way down)
    for (const [label, p] of [['winter', 0.88], ['summer', 0.42]]) {
      const g = new Sim.Grid(200, 240); g.clock = Sim.YEAR * p; g.updateClimate();   // clouds 70 rows over the reference level, higher than most hills
      for (let y = 20; y < 26; y++) for (let x = 60; x < 140; x++) g.set(g.idx(x, y), Sim.ids.CLOUD);
      let sn = 0, rn = 0; const set = g.set.bind(g);
      // (counted where they leave the deck: wisps that drift down into the warm air near the floor drizzle rain, as they should)
      g.set = (i, t, tmp) => { if (i < 40 * g.W && g.type[i] === E && (t === WATER || t === SNOW)) { rn++; if (t === SNOW) sn++; } else if (t === SNOW && g.type[i] === WATER) sn++; return set(i, t, tmp); };
      run(g, 1200);
      console.log(`  ${label}: ${rn} drops or flakes fell, ${sn} of them as snow`);
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
  douse() {
    // water poured on a long-burning bed of embers puts it out and it stays out. Embers used to boil the water off and relight
    // the flames above them, so a fire could only be starved, never doused
    const { EMBER } = Sim.ids, burning = g => { let n = 0; for (const t of g.type) if (t === EMBER) n++; return n; };
    const seen = {};
    for (const wet of [false, true]) {
      Sim.reseed(5); const W = 160, H = 120, g = new Sim.Grid(W, H); g.windHold = 0;
      for (let x = 0; x < W; x++) for (let y = H - 20; y < H; y++) g.set(g.idx(x, y), STONE, g.ambAt(y));
      for (let x = 40; x < 120; x++) { g.set(g.idx(x, H - 21), EMBER); g.life[g.idx(x, H - 21)] = 3000; }   // embers that won't burn out on their own
      g.initAir(); g.wakeAll(); run(g, 120);
      let poured = 0; seen[wet] = [burning(g)];
      run(g, 360, 1, f => { if (wet && f <= 60 && f % 2 === 0) for (let x = 40; x < 120; x += 2) { const i = g.idx(x, H - 40); if (g.type[i] === E) { g.set(i, WATER); poured++; } } if (f % 60 === 0) seen[wet].push(burning(g)); });
      console.log(`  ${wet ? `doused with ${poured} water` : 'left alone'}: embers each second ${seen[wet].join(' ')}`);
    }
    check('water puts a bed of embers out and it stays out', seen[true].slice(3).every(n => n === 0) && seen[false].slice(3).every(n => n >= 76), `${seen[true].slice(-1)} burning after 6 s, ${seen[false].slice(-1)} left alone`);
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
    // the generated world through an autumn: clouds form aloft with a level base, and it snows on the hills in winter.
    // (At 640 columns in: the world's first 600 columns are desert, and dry country makes its own weather.)
    // The base is measured on the cloud in the land's own sky; the extra sky over it (rows above g.top) gets higher, night-time layers
    const g = new Sim.Grid(Sim.WORLD.W, Sim.WORLD.H); Sim.generate(g, 12345, Sim.WORLD.WIDE, 640); g.clock = Sim.YEAR * 0.55; g.updateClimate();
    g.fronts = false; g.lightning = false; g.massT.fill(0); g.massH.fill(0);   // (one air mass and no lightning: a front's squall line has its own base, and a warm sector rains in winter)
    // A level base is a level base at one time: the base rises and falls with the air mass from one day to the next, so the
    // spread is taken on each snapshot with enough cloud to measure, and the typical (median) snapshot has to be level
    const bases = [], spreads = [], W = g.W; let snow = 0, cloud = 0, high = 0;
    const q = (a, p) => a[Math.min(a.length - 1, (a.length * p) | 0)];
    run(g, 3 * Sim.DAY, Sim.DAY / 8, () => {
      const now = [];
      for (let x = 0; x < W; x++) {
        let y = 0; while (y < g.H && (g.type[y * W + x] === E || Sim.EL[g.type[y * W + x]].kind === 'gas')) y++;
        for (let yy = y - 8; yy >= 0; yy--) if (g.type[yy * W + x] === CLOUD) { if (g.type[(yy + 1) * W + x] !== CLOUD) { if (yy >= g.top) now.push(yy); else high++; } break; }
      }
      now.sort((a, b) => a - b); bases.push(...now); if (now.length >= 30) spreads.push(q(now, 0.9) - q(now, 0.1));
      const c = census(g, Sim.EL); snow = Math.max(snow, c.Snow || 0); cloud = Math.max(cloud, c.Cloud || 0);
    });
    bases.sort((a, b) => a - b); spreads.sort((a, b) => a - b);
    const spread = spreads.length ? q(spreads, 0.5) : Infinity;
    console.log(`  ${bases.length} cloud-base samples over 3 days; base p10 ${q(bases, 0.1)}, p50 ${q(bases, 0.5)}, p90 ${q(bases, 0.9)} rows; middle 80% of a snapshot spans ${spreads.join(' ')} rows; ${high} higher in the extra sky; most cloud ${cloud}, most snow lying ${snow}`);
    check('clouds form aloft', bases.length > 300);
    // (this median swings 58-78 rows on the same build with one extra random draw anywhere, and from world to world: on this stretch
    // R5's build measures 82 and R6's 78-85, so the line sits above that noise)
    check('with a consistent base (middle 80% of a typical snapshot within 90 rows)', spread <= 90, `${spread} rows`);
    check('and the weather uses the extra sky above the land', high > 50, `${high} samples`);
    check('snow settles once winter comes (stage 2 had none on this world)', snow > 50);
  },
  precip() {
    // rain or snow is decided by how cold the air is where the cloud lets it go, and what it falls through: a tall cloud over
    // ground at 6° snows from its top, but the flakes melt on the way down and it rains; in winter the snow reaches the ground.
    // (It used to be one temperature for the whole sky by season, so spring and autumn clouds snowed onto warm ground.)
    const res = {};
    for (const [label, p] of [['early spring', 0.02], ['summer', 0.3], ['late autumn', 0.63], ['winter', 0.85]]) {
      Sim.reseed(4); const W = 160, H = Sim.WORLD.H, g = new Sim.Grid(W, H); g.clock = Sim.YEAR * p; g.updateClimate(); g.resetTemp(); g.windHold = 0;
      const ground = g.skyY - 50; for (let y = ground; y < H; y++) for (let x = 0; x < W; x++) g.set(g.idx(x, y), STONE, g.ambAt(y));
      g.initAir(); for (let c = 0; c < g.hum.length; c++) g.hum[c] = g.cap[c];   // saturated air, so the cloud doesn't just evaporate
      const base = ground - 35, top = ground - 130;   // a towering rain cloud
      for (let y = top; y < base; y++) for (let x = 50; x < 110; x++) g.set(g.idx(x, y), CLOUD, g.ambAt(y));
      let aloft = 0, flakes = 0, drops = 0; const fall = g.fall.bind(g);
      g.fall = (j, y) => { if (g.ambRow[y] < 0) aloft++; return fall(j, y); };
      g.wakeAll();
      run(g, 1500, 10, () => {   // what is falling through the 30 rows over the ground
        for (let y = ground - 30; y < ground - 1; y++) for (let x = 0; x < W; x++) { const i = g.idx(x, y); if (g.type[i + W] !== E) continue; if (g.type[i] === SNOW) flakes++; else if (g.type[i] === WATER) drops++; }
      });
      console.log(`  ${label}: ground ${g.ambRow[ground - 1].toFixed(1)}°, cloud base ${g.ambRow[base].toFixed(1)}°, top ${g.ambRow[top].toFixed(1)}°; ${aloft} flakes formed aloft; near the ground ${drops} drops and ${flakes} flakes falling`);
      res[label] = { aloft, flakes, drops, snow: flakes / Math.max(1, flakes + drops) };
    }
    const sp = res['early spring'], au = res['late autumn'], su = res.summer, wi = res.winter;
    check('spring and autumn clouds over ground at 6° snow at the top but it melts into rain on the way down', sp.aloft > 50 && au.aloft > 50 && sp.snow < 0.15 && au.snow < 0.15, `${(sp.snow * 100).toFixed(0)}% and ${(au.snow * 100).toFixed(0)}% of what reaches the ground is snow`);
    check('summer clouds rain', su.drops > 100 && su.flakes === 0);
    check('winter clouds snow all the way down', wi.flakes > 100 && wi.flakes > 20 * wi.drops, `${wi.flakes} flakes, ${wi.drops} drops`);
  },
  storm() {
    // a lake poured into a lava pit on the generated world boils into a storm cloud, which rains itself out in a minute or two
    // instead of filling the screen (before the fix: 6.7 cloud cells per water cell at the peak, still 1.2 three minutes on)
    const { STEAM } = Sim.ids;
    Sim.reseed(6); const g = new Sim.Grid(Sim.WORLD.W, Sim.WORLD.H), surf = Sim.generate(g, 12345, 7680, 3200), W = g.W;
    g.fronts = false; g.lightning = false; g.massT.fill(0); g.massH.fill(0);   // (one air mass, and no lightning setting the woods alight: this is the boiled lake's storm)
    const cx = 480; let top = g.H; for (let x = cx - 30; x < cx + 30; x++) top = Math.min(top, surf[x]);
    for (let y = top - 10; y < top + 40; y++) for (let x = cx - 30; x < cx + 30; x++) g.set(g.idx(x, y), x < cx - 27 || x >= cx + 27 || y >= top + 37 ? STONE : y >= top + 25 ? LAVA : E);
    g.wakeAll();
    const clouds = () => { let c = 0; for (const t of g.type) if (t === CLOUD) c++; return c; };
    run(g, 300); const c0 = clouds(); let poured = 0, peak = 0;
    const watch = () => { peak = Math.max(peak, clouds()); };
    run(g, MIN, 1, f => { for (let x = cx - 20; x < cx + 20; x += 2) { const i = g.idx(x, top - 5); if (g.type[i] === E && poured < 6000) { g.set(i, WATER); poured++; } } if (f % 300 === 0) watch(); });
    let after1 = -1;
    run(g, 3 * MIN, 300, f => { watch(); if (f === MIN) after1 = clouds(); });
    const left = clouds();
    console.log(`  ${poured} water cells poured on lava; cloud ${c0} before, peaks at ${peak} cells, ${after1} a minute after pouring stops, ${left} after three`);
    check('the storm cloud stays small: under 4.5 cloud cells per water cell boiled', peak < 4.5 * poured, `${(peak / poured).toFixed(1)}`);
    check('and rains itself out: three minutes on, under 0.6 extra cloud cells per water cell', left - c0 < 0.6 * poured, `${((left - c0) / poured).toFixed(2)}`);
  },
  steam() {
    // water is conserved through the sky: lava boils a lake into steam, cloud and rain in a stone basin (no soil or trees to drink it).
    // Hot cloud used to turn back into a whole cell of steam (ten times the water it held), and rain made water as it fell
    Sim.reseed(6); const W = 480, H = 240, g = new Sim.Grid(W, H), { STEAM } = Sim.ids;
    for (let x = 0; x < W; x++) for (let y = H - 30; y < H; y++) g.set(g.idx(x, y), STONE, g.ambAt(y));
    for (let x = 210; x < 270; x++) for (let y = H - 30; y < H - 6; y++) g.set(g.idx(x, y), y < H - 18 ? E : LAVA);
    g.initAir(); g.wakeAll();
    const tally = () => { let w = 0, c = 0; for (const t of g.type) { if (t === WATER || t === STEAM) w++; else if (t === CLOUD) c++; } let h = 0; for (const q of g.hum) h += q; return w + h + c * 0.1; };
    const eq0 = tally(); let poured = 0, gain = 0;
    run(g, 3 * MIN, 1, f => { if (f <= MIN) for (let x = 220; x < 260; x += 2) { const i = g.idx(x, H - 60); if (g.type[i] === E && poured < 3000) { g.set(i, WATER); poured++; } } if (f % 300 === 0) gain = Math.max(gain, tally() - eq0 - poured); });
    console.log(`  ${poured} water cells poured on lava; most water gained ${gain.toFixed(0)} cells`);
    check('boiling, raining and condensing do not make water', gain < poured * 0.05, `${gain.toFixed(0)} of ${poured}`);
  },
  gas() {
    // steam behaves like a gas: a puff keeps thinning out and spreading as it rises (instead of rising as a clump and stalling under
    // the cloud it makes), and under a ceiling it spreads along it. Before: 2 s on, 9.6 wide (sd) with 1.8 steam neighbours each;
    // highest steam 100 rows up; 77 cells wide under the ceiling after 4 s
    const { STEAM } = Sim.ids;
    const box = ceil => { Sim.reseed(5); const g = new Sim.Grid(320, 240); g.windHold = 0;
      for (let x = 0; x < 320; x++) for (let y = 236; y < 240; y++) g.set(g.idx(x, y), STONE, g.ambAt(y));
      if (ceil) for (let x = 40; x < 280; x++) for (let y = ceil; y < ceil + 3; y++) g.set(g.idx(x, y), STONE, g.ambAt(y));
      g.initAir(); g.wakeAll(); return g; };
    const steam = g => { const c = []; for (let i = 0; i < g.type.length; i++) if (g.type[i] === STEAM) c.push(i); return c; };
    { const g = box(0); for (let y = 200; y < 216; y++) for (let x = 152; x < 168; x++) g.set(g.idx(x, y), STEAM);
      let top = 240, sd = 0, crowd = 0;
      run(g, 240, 1, f => { const c = steam(g); for (const i of c) top = Math.min(top, (i / 320) | 0);
        if (f === 120) { let m = 0, q = 0, nb = 0; for (const i of c) { const x = i % 320; m += x; q += x * x; for (const d of [-321, -320, -319, -1, 1, 319, 320, 321]) if (g.type[i + d] === STEAM) nb++; }
          m /= c.length; sd = Math.sqrt(q / c.length - m * m); crowd = nb / c.length; } });
      console.log(`  puff of 256 cells: 2 s on, spread (sd) ${sd.toFixed(1)} cells with ${crowd.toFixed(2)} steam neighbours each; highest steam ${200 - top} rows up`);
      check('a steam puff spreads out as it rises', sd > 12 && crowd < 1.2, `sd ${sd.toFixed(1)}, ${crowd.toFixed(2)} neighbours`);
      check('and keeps rising through the cloud it makes', 200 - top > 125, `${200 - top} rows`); }
    { const g = box(120); for (let y = 180; y < 196; y++) for (let x = 152; x < 168; x++) g.set(g.idx(x, y), STEAM);
      run(g, 240); let x0 = 1e9, x1 = -1; for (const i of steam(g)) { x0 = Math.min(x0, i % 320); x1 = Math.max(x1, i % 320); }
      console.log(`  under a ceiling the puff spreads ${x1 - x0 + 1} cells wide in 4 s`);
      check('steam spreads along a ceiling', x1 - x0 + 1 > 100); }
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
    const carried = () => { let n = 0; for (let i = 0; i < g.type.length; i++) if (g.type[i] === WATER && (g.life[i] & 255) && !(g.life[i] & 256)) n++; return n; };   // sand grains riding in the stream
    const up0 = sandIn(0, 50), all0 = census(g, Sim.EL).Sand + carried();
    run(g, 3 * MIN, 1, () => { for (let x = 4; x < 10; x++) { const i = g.idx(x, 40); if (g.type[i] === E) { g.set(i, WATER); g.vy[i] = 1; } } });
    const up = sandIn(0, 50), basin = sandIn(150, W), all = census(g, Sim.EL).Sand + carried();
    console.log(`  upper slope ${up0} -> ${up} sand cells; basin 0 -> ${basin}; all sand (lying or carried) ${all0} -> ${all}`);
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
  quench() {
    // water poured on a lava pool quenches its surface to a crust of rock, so a pool can be capped with a few hundred cells of water.
    // Over 8 seeds: a crust now and then cracks open a cell in the last seconds, on any build, so one seed in four may show one
    const res = [];
    for (let seed = 1; seed <= 8; seed++) {
      Sim.reseed(seed); const g = new Sim.Grid(80, 60); g.windHold = 0;
      for (let x = 0; x < 80; x++) for (let y = 50; y < 60; y++) g.set(g.idx(x, y), STONE, g.ambAt(y));
      for (let y = 30; y < 50; y++) { g.set(g.idx(19, y), STONE, g.ambAt(y)); g.set(g.idx(60, y), STONE, g.ambAt(y)); }
      for (let x = 20; x < 60; x++) for (let y = 40; y < 50; y++) g.set(g.idx(x, y), LAVA);
      g.initAir(); g.wakeAll();
      run(g, 600, 1, f => { if (f < 300 && f % 4 === 0) for (let x = 20; x < 60; x += 2) { const i = g.idx(x, 20); if (g.type[i] === E) g.set(i, WATER, g.ambAt(20)); } });
      // (as the game counts it: a bubble of steam sealed in the crust is not open to the air)
      const sealed = i => Sim.Game.prototype.sealed.call({ g }, i);
      let open = 0; for (let x = 20; x < 60; x++) for (let y = 1; y < 50; y++) { const i = g.idx(x, y); if (g.type[i] === LAVA && (g.type[i - g.W] === E || Sim.EL[g.type[i - g.W]].kind === 'gas') && !sealed(i - g.W)) open++; }
      res.push({ open, lava: census(g, Sim.EL).Lava || 0 });
    }
    console.log(`  water poured on 400 lava, 8 seeds: lava left ${res.map(r => r.lava).join(' ')}; open to the air ${res.map(r => r.open).join(' ')}`);
    check('water crusts a lava pool over', res.filter(r => r.open).length <= 2 && res.every(r => r.open <= 1 && r.lava > 100), res.map(r => r.open).join(' '));
  },
  support() {
    // stone needs support, and a solid diagonally below counts: a pitched roof on two pillars and a lone diagonal brace stand,
    // while the same diagonal line floating in the air falls, and a flat shelf still breaks past its span
    Sim.reseed(4); const g = new Sim.Grid(120, 80); g.windHold = 0; const RUB = Sim.ids.RUBBLE;
    const put = (x, y) => g.set(g.idx(x, y), STONE, g.ambAt(y));
    for (let x = 0; x < 120; x++) for (let y = 76; y < 80; y++) put(x, y);
    for (let y = 60; y < 76; y++) { put(20, y); put(40, y); put(110, y); }        // pillars
    const roof = [], brace = [], loose = [], shelf = [];
    for (let k = 1; k <= 10; k++) { roof.push([20 + k, 60 - k]); if (k < 10) roof.push([40 - k, 60 - k]); }   // an A-frame meeting at (30,50)
    for (let k = 0; k < 16; k++) brace.push([60 + k, 75 - k]);                     // a lone brace leaning on nothing but the floor
    for (let k = 0; k < 10; k++) loose.push([85 + k, 20 + k]);                    // the same line in mid-air
    for (let x = 100; x < 110; x++) shelf.push([x, 60]);                          // a 10-cell shelf off the right pillar (stone spans 5)
    for (const [x, y] of [...roof, ...brace, ...loose, ...shelf]) put(x, y);
    g.initAir(); g.wakeAll(); run(g, 600);
    const kept = cells => cells.filter(([x, y]) => g.type[g.idx(x, y)] === STONE).length;
    let rubble = 0; for (let i = 0; i < g.type.length; i++) if (g.type[i] === RUB) rubble++;
    console.log(`  after 10 s: roof ${kept(roof)}/${roof.length}, brace ${kept(brace)}/${brace.length}, loose line ${kept(loose)}/${loose.length}, shelf ${kept(shelf)}/${shelf.length} (far half ${kept(shelf.slice(0, 5))}/5), ${rubble} rubble`);
    check('a pitched roof of diagonal stone on two pillars stands', kept(roof) === roof.length);
    check('a lone diagonal brace standing on the floor stands', kept(brace) === brace.length);
    check('a diagonal line in mid-air falls', kept(loose) === 0);
    check('a shelf still breaks past its span', kept(shelf.slice(0, 4)) === 0 && kept(shelf.slice(6)) === 4);
    // knock out the left pillar: the left slope of the roof loses its footing and comes down (the apex rests on the right slope)
    for (let y = 60; y < 76; y++) g.set(g.idx(20, y), E);
    run(g, 600);
    const left = roof.filter(([x]) => x < 30), right = roof.filter(([x]) => x > 30);
    console.log(`  left pillar gone: left slope ${kept(left)}/${left.length}, right slope ${kept(right)}/${right.length}`);
    check('take a pillar away and its side of the roof falls', kept(left) === 0 && kept(right) === right.length);
  },
  cookoff() {
    // a new world makes nothing that burns within reach of lava: no gas or gunpowder goes off and no oil burns in its first half minute (before, 47-80 went off in 20 s),
    // and the deep caves still hold plenty of each
    const { GUNP, GAS } = Sim.ids;
    for (const seed of [12345, 7]) {
      Sim.reseed(1); const g = new Sim.Grid(Sim.WORLD.W, Sim.WORLD.H); Sim.generate(g, seed, 7680, 3200);
      const count = t => { let n = 0; for (let i = 0; i < g.type.length; i++) if (g.type[i] === t) n++; return n; };
      const c0 = [GUNP, GAS, OIL, LAVA].map(count);
      let booms = 0; const ex = g.explode.bind(g); g.explode = (x, y, r) => { booms++; ex(x, y, r); };
      run(g, MIN / 2);
      const c1 = [GUNP, GAS, OIL].map(count);
      console.log(`  seed ${seed}: gunpowder ${c0[0]} -> ${c1[0]}, gas ${c0[1]} -> ${c1[1]}, oil ${c0[2]} -> ${c1[2]}, lava ${c0[3]}; ${booms} explosions`);
      check(`seed ${seed}: nothing explodes or burns in the first 30 s`, booms === 0 && c1[0] === c0[0] && c1[1] === c0[1] && c1[2] >= c0[2] - 10);
      check(`seed ${seed}: the world still has lava, gunpowder, gas and oil`, c0.every(n => n > 1000));
    }
  },
  tension() {
    const box = (W, H) => { Sim.reseed(4); const g = new Sim.Grid(W, H); g.windHold = 0; for (let x = 0; x < W; x++) for (let y = H - 4; y < H; y++) g.set(g.idx(x, y), STONE, g.ambAt(y)); g.initAir(); g.wakeAll(); return g; };
    { // a block of water set on a flat floor holds together as a puddle
      const g = box(300, 80); for (let y = 66; y < 76; y++) for (let x = 145; x < 155; x++) g.set(g.idx(x, y), WATER); run(g, 1500);
      // (the puddle: the widest run of wet columns with gaps of no more than 2; a drop or two splashed off as it slumped isn't the puddle)
      const wet = new Array(300).fill(false); for (let i = 0; i < g.type.length; i++) if (g.type[i] === WATER) wet[i % 300] = true;
      let best = 0, x0 = -1, gap = 0; for (let x = 0; x < 300; x++) { if (wet[x]) { if (x0 < 0) x0 = x; gap = 0; best = Math.max(best, x - x0 + 1); } else if (x0 >= 0 && ++gap > 2) { x0 = -1; gap = 0; } }
      const stray = wet.filter(Boolean).length;
      console.log(`  100 cells of water spread to a puddle ${best} wide (${stray} wet columns in all)`);
      check('water holds a puddle rather than thinning to a film', best < 80);
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
  pressure() {
    // a big lake feeds a pipe that runs out under its far wall to a standpipe: the water in the standpipe rises toward the lake's
    // level (a body is searched whole, however big, for the surface it pushes up through)
    Sim.reseed(4); const W = 400, H = 160, g = new Sim.Grid(W, H); g.windHold = 0; g.hold = true;
    const rect = (x0, y0, x1, y1, t) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) g.set(g.idx(x, y), t, g.ambAt(y)); };
    rect(0, H - 3, W, H, STONE); rect(0, 30, 10, H - 3, STONE); rect(300, 30, 370, H - 5, WOOD); rect(374, 0, W, H - 3, STONE);   // (wood over the pipe: stone that long would fall in, metal would rust)
    rect(10, 60, 300, H - 3, WATER);
    g.initAir(); for (let c = 0; c < g.hum.length; c++) g.hum[c] = g.cap[c];   // (saturated air: nothing evaporates)
    g.wakeAll();
    const lake = () => { for (let y = 0; y < H; y++) if (g.type[g.idx(150, y)] === WATER) return y; return H; };
    const pipe = () => { for (let y = 0; y < H; y++) if (g.type[g.idx(371, y)] === WATER) return y; return H; };
    let at = []; run(g, 3 * MIN, MIN / 2, f => at.push(`${f / 60}s lake ${lake()} pipe ${pipe()}`));
    console.log('  surface row (lower is higher):', at.join(', '));
    check('a big lake lifts the water in a far standpipe to within 15 rows of its own level', pipe() - lake() <= 15, `lake row ${lake()}, standpipe row ${pipe()}`);
  },
  firm() {
    // a steep mound (2 in 1) of damp dirt holds its shape; the same mound dry slumps to about 1 in 1, like sand
    const pile = m => {
      Sim.reseed(5); const W = 200, H = 100, g = new Sim.Grid(W, H); g.windHold = 0; g.hold = true;
      for (let x = 0; x < W; x++) for (let y = H - 3; y < H; y++) g.set(g.idx(x, y), STONE, g.ambAt(y));
      for (let x = 80; x < 120; x++) { const h = (40 - 2 * Math.abs(x - 99.5)) | 0; for (let y = H - 3 - h; y < H - 3; y++) { const i = g.idx(x, y); g.set(i, DIRT, g.ambAt(y)); g.life[i] = (40 << 8) | m; } }
      g.initAir(); for (let c = 0; c < g.hum.length; c++) g.hum[c] = 0.9 * g.cap[c];
      g.wakeAll(); run(g, 1200);
      const hs = []; for (let x = 0; x < W; x++) { let n = 0; for (let y = 0; y < H; y++) if (g.type[g.idx(x, y)] === DIRT) n++; hs.push(n); }
      return { h: Math.max(...hs), w: hs.filter(n => n >= 3).length };   // (the width of the mound proper, not the odd grain thrown clear)
    };
    const dry = pile(5), damp = pile(60);
    console.log(`  a mound 39 high, 36 wide: dry it slumps to ${dry.h} high, ${dry.w} wide; damp it stands ${damp.h} high, ${damp.w} wide`);
    check('dry dirt slumps to about 1 in 1', dry.h <= 30, `${dry.h} high, ${dry.w} wide`);
    check('damp dirt holds a 2 in 1 slope', damp.h >= 37 && damp.w <= 38, `${damp.h} high, ${damp.w} wide`);
  },
  surfacedry() {
    // bare damp ground dries in the sun whatever row its surface lies in (the air is kept on a 4x4 grid: ground filling the lower
    // part of an air cell must still dry into the air over it)
    const tops = [];
    for (let off = 0; off < 4; off++) {
      const W = 64, H = 64, depth = 21 + off, g = plot(W, H, depth, 60); g.windHold = 0;
      for (let c = 0; c < g.hum.length; c++) g.hum[c] *= 0.3;   // dry air
      run(g, 2 * MIN);
      tops.push(Math.round(moisture(g, H - depth, H - depth + 1)));
    }
    console.log(`  surface moisture after 2 min of dry air, by the row the surface lies in (mod 4): ${tops.join(' ')} (from 60)`);
    check('bare ground dries whatever row its surface is in', Math.max(...tops) < 45 && Math.max(...tops) - Math.min(...tops) <= 12, tops.join(' '));
    // and a pond evaporates whatever row its surface is in
    const gone = [];
    for (let off = 0; off < 4; off++) {
      Sim.reseed(3); const W = 64, H = 64, g = new Sim.Grid(W, H); g.windHold = 0;
      for (let y = H - 3; y < H; y++) for (let x = 0; x < W; x++) g.set(g.idx(x, y), STONE);
      for (let y = H - 20 - off; y < H - 3; y++) for (let x = 0; x < W; x++) g.set(g.idx(x, y), WATER);
      g.initAir(); for (let c = 0; c < g.hum.length; c++) g.hum[c] *= 0.3; g.wakeAll();
      const n0 = census(g, Sim.EL).Water; run(g, 2 * MIN); gone.push(n0 - census(g, Sim.EL).Water);
    }
    console.log(`  water a pond loses in 2 min of dry air, by the row its surface lies in: ${gone.join(' ')}`);
    check('a pond evaporates whatever row its surface is in', Math.min(...gone) >= 30, gone.join(' '));
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
    const g = new Sim.Grid(Sim.WORLD.W, Sim.WORLD.H); Sim.generate(g, 4242, 7680, 3200); run(g, 120);
    const snap = f => { const o = []; for (let y = 0; y < g.H; y++) for (let x = 0; x < Sim.REGION; x++) o.push(g[f][y * g.W + x]); return o; };
    const t0 = snap('type'), l0 = snap('life'), o0 = snap('owner'), m0 = snap('temp'), ids = g.trees.filter(t => t.x < Sim.REGION).map(t => t.id).sort();
    let ms = performance.now(); g.shift(1); const tOut = performance.now() - ms;
    check('trees rooted in the region leave with it', ids.every(id => !g.trees.some(t => t.id === id) && g.storedTrees.has(id)), `${ids.length} trees`);
    ms = performance.now(); g.shift(-1); const tIn = performance.now() - ms;
    const t1 = snap('type'), l1 = snap('life'), o1 = snap('owner'), m1 = snap('temp');
    let dt = 0, dl = 0, dm = 0, dow = 0; for (let k = 0; k < t0.length; k++) { if (t0[k] !== t1[k]) dt++; if (l0[k] !== l1[k]) dl++; if (t0[k] === t1[k] && Math.abs(m0[k] - m1[k]) > 0.5) dm++; if (o0[k] !== o1[k]) dow++; }
    console.log(`  out and back: ${dt} types, ${dl} life values, ${dow} owners and ${dm} temperatures (beyond rounding) differ; shift out ${tOut.toFixed(0)} ms, back ${tIn.toFixed(0)} ms`);
    // (a tree redrawn on return can fill a cell or two it was blocked from when it last grew; those cells take the air's temperature)
    check('a region comes back as it left', dt <= 30 && dl <= 30 && dm === 0, `${dt} types, ${dl} life values differ`);
    check('and so do its trees', ids.every(id => g.trees.some(t => t.id === id)));
    // walk five regions right, making each ahead of time the way the page does; then compare with the same land generated in place
    let slices = 0, worst = 0; for (let k = 0; k < 5; k++) { for (;;) { const a = performance.now(); const more = g.prefetch(); worst = Math.max(worst, performance.now() - a); if (!more) break; slices++; } g.shift(1); }
    const h = new Sim.Grid(Sim.WORLD.W, Sim.WORLD.H); Sim.generate(h, 4242, 7680, g.ox);
    let same = 0, tot = 0; for (let i = 0; i < g.type.length; i++) { if (i % g.W < 2 * Sim.REGION || g.owner[i] || h.owner[i]) continue; tot++; if (g.type[i] === h.type[i]) same++; }
    console.log(`  new regions made ahead in ${slices} slices, the longest ${worst.toFixed(1)} ms; the newest region matches in-place generation on ${same}/${tot} non-tree cells`);
    check('streamed land is the same land', same === tot);
    let bytes = 0; for (const r of g.store.values()) bytes += r.type.byteLength + r.life.byteLength + r.temp.byteLength + r.owner.byteLength + r.hum.byteLength;
    const per = bytes / g.store.size, raw = Sim.REGION * g.H * g.buffer.byteLength / (g.W * g.H);
    console.log(`  ${g.store.size} regions stored, ${(per / 1024).toFixed(0)} KB each against ${(raw / 1024).toFixed(0)} KB live (${(raw / per).toFixed(0)}x)`);
    check('a stored region takes a small fraction of its live memory', per * 10 < raw);
    // save and load the streamed world
    const s = g.save(), k = new Sim.Grid(Sim.WORLD.W, Sim.WORLD.H); k.load(s);
    check('a streamed world saves and loads', k.ox === g.ox && k.worldW === 7680 && k.store.size === g.store.size && k.trees.length === g.trees.length, `${(s.length / 1024) | 0} KB`);
    k.shift(-1); check('and keeps streaming after loading', k.ox === g.ox - Sim.REGION && k.trees.length > 0);
  },
  sky() {
    // the page's world is the 480-row land with extra sky over it: same land, shifted down; a 480-row save (streamed regions,
    // trees and vapour included) loads into it with the sky added on top
    const { W, H } = Sim.WORLD, a = new Sim.Grid(W, 480), b = new Sim.Grid(W, H), dy = b.top;
    Sim.generate(a, 4242, 7680, 3200); Sim.generate(b, 4242, 7680, 3200);
    let same = 0, n = 0; for (let y = 0; y < 480; y++) for (let x = 0; x < W; x++) { const i = a.idx(x, y); if (a.owner[i] || b.owner[b.idx(x, y + dy)]) continue; n++; if (a.type[i] === b.type[b.idx(x, y + dy)]) same++; }
    let skyEmpty = true; for (let i = 0; i < dy * W; i++) if (b.type[i] !== E && !b.owner[i]) skyEmpty = false;
    console.log(`  ${dy} rows of extra sky; the land matches the 480-row world on ${same}/${n} non-tree cells`);
    check('the taller world is the same land with sky above it', dy === H - 480 && skyEmpty && same === n);
    check('and keeps the same climate at the same height above the land', Math.abs(a.ambAt(200) - b.ambAt(200 + dy)) < 1e-9);
    run(a, 200); a.shift(1); a.shift(1); run(a, 60);
    // (compared with the same save loaded at its own size: loading redraws trees, which may differ by a cell or two from the live world)
    const s = a.save(), k = new Sim.Grid(W, H), k0 = new Sim.Grid(W, 480); k.load(s); k0.load(s);
    let ok = 0; for (let i = 0; i < k0.type.length; i++) if (k0.type[i] === k.type[i + dy * W]) ok++;
    const hum = Math.abs(k0.hum[10 * a.AW + 7] - k.hum[(10 + dy / Sim.AC) * k.AW + 7]) < 0.01;
    check('a save from the 480-row world loads into the taller one, shifted down', ok === k0.type.length && hum && k.trees.length === k0.trees.length && k.trees.every((t, j) => t.y === k0.trees[j].y + dy), `${ok}/${k0.type.length} cells`);
    k.shift(-1); k0.shift(-1); ok = 0; for (let i = 0; i < k0.type.length; i++) if (k0.type[i] === k.type[i + dy * W]) ok++;
    check('and its stored regions come back shifted down too', k.ox === a.ox - Sim.REGION && ok === k0.type.length && k.trees.length === k0.trees.length, `${ok}/${k0.type.length} cells`);
  },
  widen() {
    // E8: the window grew from 960 to Sim.WORLD.W. A save from the 960-wide window loads into its left part, and the rest of the
    // window comes from the world it was in: regions the save had stored come back out of the store, the others are generated
    const { W, H } = Sim.WORLD, R = Sim.REGION;
    const a = new Sim.Grid(960, H); Sim.generate(a, 4242, 7680, 3200); run(a, 120);
    const fresh = new Sim.Grid(W, H); Sim.generate(fresh, 4242, 7680, a.ox);
    const s = a.save(), k = new Sim.Grid(W, H), k0 = new Sim.Grid(960, H); k.load(s); k0.load(s);   // (against the save loaded at its own size: loading redraws trees)
    let left = 0, n = 0; for (let y = 0; y < H; y++) for (let x = 0; x < 960; x++) { const i = y * 960 + x, j = y * W + x; if (k0.owner[i] || k.owner[j]) continue; n++; if (k0.type[i] === k.type[j]) left++; }   // (trees just over the old edge reach back across it)
    let right = 0, m = 0; for (let y = 0; y < H; y++) for (let x = 960; x < W; x++) { const j = y * W + x; if (fresh.owner[j] || k.owner[j]) continue; m++; if (fresh.type[j] === k.type[j]) right++; }
    const hum = Math.abs(k0.hum[30 * k0.AW + 50] - k.hum[30 * k.AW + 50]) < 0.01;
    console.log(`  a 960-wide save in the ${W}-wide window: its own cells match on ${left}/${n}; the land made to widen it matches land made in place on ${(100 * right / m).toFixed(2)}%`);
    check('a narrower save loads into the left of the window', left === n && hum && k.ox === a.ox);
    check('and the window is filled out with the same world', right / m > 0.995 && k.worldW === 7680);
    // shifting left stores the region just right of the window (as it was, after a minute of play): the widened window takes it back
    a.shift(-1); run(a, 30);
    const key = (a.ox + 960) / R, rec = a.store.get(key), k2 = new Sim.Grid(W, H); k2.load(a.save());
    const unrle = r => { let len = 0; for (let p = 1; p < r.length; p += 2) len += r[p]; const o = new Uint16Array(len); for (let p = 0, q = 0; p < r.length; p += 2) { o.fill(r[p], q, q + r[p + 1]); q += r[p + 1]; } return o; };
    const ty = unrle(Uint16Array.from(rec.type)); let same = 0, c = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < R; x++) { const j = y * W + 960 + x; if (k2.owner[j]) continue; c++; if (ty[y * R + x] === k2.type[j]) same++; }
    console.log(`  with that region stored: ${a.store.size} stored -> ${k2.store.size}; it comes back matching on ${same}/${c} cells`);
    check('a region the save had stored comes back out of the store', !k2.store.has(key) && k2.store.size === a.store.size - 1 && same === c);
    // a flat world (not generated) carries its last column across
    const f = new Sim.Grid(960, H), top = Sim.flat(f), fk = new Sim.Grid(W, H); fk.load(f.save());
    check('a narrower flat world loads widened, ground and all', fk.type[fk.idx(W - 1, top + 30)] === STONE && fk.type[fk.idx(W - 1, top - 20)] === E && fk.worldW === W);
    k.step(); k2.step(); fk.step();
  },
  // ---------------- E2: heat conduction, melting and freezing ----------------
  conduct() {
    // a metal bar and a stone bar in air, one end of each held at 600°: heat runs along the metal and barely into the stone
    Sim.reseed(3);
    const { METAL, ICE } = Sim.ids, g = new Sim.Grid(160, 60);
    for (let y = 50; y < 60; y++) for (let x = 0; x < 160; x++) g.set(g.idx(x, y), STONE, 20);
    for (const [row, t] of [[20, METAL], [35, STONE]]) for (let x = 20; x < 80; x++) g.set(g.idx(x, row), t, 20);
    for (const x of [30, 50, 70]) for (let y = 21; y < 50; y++) g.set(g.idx(x, y), STONE, 20);   // (posts under the metal bar: on its own in the air it falls now)
    const at = (x, row) => g.temp[g.idx(x, row)];
    for (let f = 1; f <= 600; f++) { g.temp[g.idx(20, 20)] = 600; g.temp[g.idx(20, 35)] = 600; g.step(); }
    console.log(`  after 10 s: metal ${at(25, 20).toFixed(0)}° 5 cells along, ${at(35, 20).toFixed(0)}° at 15, ${at(50, 20).toFixed(0)}° at 30; stone ${at(25, 35).toFixed(0)}° at 5, ${at(35, 35).toFixed(0)}° at 15`);
    check('heat runs along a metal bar', at(35, 20) > 100);
    check('and hardly into a stone one', at(25, 35) < 40 && at(35, 35) < 25);
    // capacity: the same heat warms a block of metal through far faster than a block of stone
    const h = new Sim.Grid(60, 30);
    for (const [x0, t] of [[5, METAL], [35, STONE]]) for (let y = 10; y < 20; y++) for (let x = x0; x < x0 + 10; x++) h.set(h.idx(x, y), t, 20);
    const mean = x0 => { let s = 0; for (let y = 10; y < 20; y++) for (let x = x0 + 1; x < x0 + 10; x++) s += h.temp[h.idx(x, y)]; return s / 90; };   // (not counting the heated face)
    for (let f = 1; f <= 300; f++) { for (let y = 10; y < 20; y++) { h.temp[h.idx(5, y)] = 300; h.temp[h.idx(35, y)] = 300; } h.step(); }
    console.log(`  a 10x10 block heated from one face for 5 s: metal ${mean(5).toFixed(0)}°, stone ${mean(35).toFixed(0)}°`);
    check('metal heats through, stone warms slowly', mean(5) > 150 && mean(35) - 20 < 0.25 * (mean(5) - 20));
  },
  melt() {
    const { METAL, ICE } = Sim.ids;
    // a block of ice in summer air melts from its faces over most of a minute, sitting at 0° (not above) while it does
    {
      const g = new Sim.Grid(100, 80); g.clock = Sim.YEAR * 0.42; g.updateClimate(); g.resetTemp();
      for (let y = 70; y < 80; y++) for (let x = 0; x < 100; x++) g.set(g.idx(x, y), STONE, g.ambAt(y));
      for (let y = 60; y < 70; y++) for (let x = 45; x < 55; x++) g.set(g.idx(x, y), ICE, -5);
      let hot = -99; const left = []; const ice = () => { let n = 0; for (let i = 0; i < g.type.length; i++) if (g.type[i] === ICE) { n++; hot = Math.max(hot, g.temp[i]); } return n; };
      run(g, 3 * MIN, 600, f => left.push(ice()));
      console.log(`  ice block in ${g.ambAt(65).toFixed(0)}° air: ${left.slice(0, 10).join(' ')} cells left at 10 s steps; warmest ice ${hot.toFixed(2)}°`);
      check('a block of ice melts over a minute or more, not at once', left[1] > 50 && left[left.length - 1] === 0);
      check('melting ice stays at 0°', hot <= 0.01);
    }
    // a pond in freezing weather skins over with ice from the top and keeps liquid water under it; it thaws in the spring
    {
      const W = 100, g = new Sim.Grid(W, 300); g.clock = Sim.YEAR * 0.85; g.updateClimate(); g.resetTemp();
      for (let y = 50; y < 300; y++) for (let x = 0; x < W; x++) g.set(g.idx(x, y), STONE, 4);
      for (let y = 30; y < 50; y++) for (let x = 0; x < W; x++) g.set(g.idx(x, y), WATER, 4);
      const count = (y0, y1, t) => { let n = 0; for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) if (g.type[g.idx(x, y)] === t) n++; return n; };
      run(g, MIN); const top = count(25, 35, ICE), deep = count(40, 50, WATER);
      g.clock = Sim.YEAR * 0.3; g.updateClimate(); run(g, MIN); const after = count(0, 300, ICE);
      console.log(`  pond in ${g.ambAt(29).toFixed(0)}° spring air after a minute at ${(-8.8).toFixed(0)}°: ${top} ice cells on top, ${deep}/1000 of the bottom still water; ${after} ice left after a minute of spring`);
      check('a pond freezes over in a cold spell', top >= 0.8 * W);
      check('with liquid water under the ice', deep >= 950);
      check('and thaws when it warms up', after < 0.1 * W);
    }
    // water poured onto a frozen metal plate freezes on it (the plate is cold enough to take its latent heat). In dry air: a thin
    // plate in damp air warmed toward the room's temperature and gathered dew faster than it froze, and passed on 2 seeds of 8
    {
      Sim.reseed(6); const g = new Sim.Grid(60, 40);
      for (let y = 14; y < 38; y++) for (let x = 10; x < 50; x++) g.set(g.idx(x, y), METAL, -40);
      for (let x = 25; x < 35; x++) g.set(g.idx(x, 13), WATER, 5);
      g.initAir(); g.hum.fill(0);
      run(g, 1800);
      let ice = 0, water = 0; for (let i = 0; i < g.type.length; i++) { if (g.type[i] === ICE) ice++; if (g.type[i] === WATER) water++; }
      console.log(`  water on a -40° metal plate after 30 s: ${ice} ice, ${water} water`);
      check('water refreezes on cold metal', ice >= 8 && water === 0);
    }
    // a new world's ice veins stay frozen (they lie in permafrost; before, warm deep rock melted them in the first minute)
    {
      const g = new Sim.Grid(Sim.WORLD.W, Sim.WORLD.H); Sim.generate(g, 12345);
      const ice = () => census(g, Sim.EL).Ice || 0, i0 = ice(); run(g, 1800); const i1 = ice();
      console.log(`  generated world: ${i0} ice cells, ${i1} after 30 s`);
      check('ice veins in a new world stay frozen', i1 > 0.99 * i0);
    }
  },
  groundwater() {
    const { METAL } = Sim.ids;
    const wall = (m, flood) => {   // a 10x30 wall of sand at moisture m on a stone floor, optionally standing in a stone tank of water
      Sim.reseed(5); const W = 80, H = 80, g = new Sim.Grid(W, H);
      for (let y = H - 3; y < H; y++) for (let x = 0; x < W; x++) g.set(g.idx(x, y), STONE);
      if (flood) for (let y = H - 40; y < H - 3; y++) for (let x = 0; x < W; x++) { const e = x < 15 || x >= 65; g.set(g.idx(x, y), e ? STONE : WATER); }
      for (let y = H - 33; y < H - 3; y++) for (let x = 35; x < 45; x++) { const i = g.idx(x, y); g.set(i, SAND); g.life[i] = m; }
      g.initAir(); run(g, 1200);
      let top = H; for (let i = 0; i < g.type.length; i++) if (g.type[i] === SAND) top = Math.min(top, (i / W) | 0);
      return H - 3 - top;
    };
    const dry = wall(0), damp = wall(120), drowned = wall(120, true);
    console.log(`  a 30-high wall of sand after 20 s: dry ${dry} high, damp ${damp}, damp but standing in water ${drowned}`);
    check('dry sand slumps', dry < 20);
    check('damp sand stands in a wall', damp >= 29);
    check('sand soaked under water slumps again', drowned < 22);

    // rain on the high end of a soil-covered rock ramp runs down the bedrock under the soil and comes out where the soil ends at a cliff
    const ramp = (rain) => {
      Sim.reseed(8); const W = 160, H = 100, g = new Sim.Grid(W, H);
      for (let x = 0; x < W; x++) { const r = x < 100 ? 40 + Math.floor(x / 3) : H - 4; for (let y = r; y < H; y++) g.set(g.idx(x, y), STONE);
        if (x < 100) for (let y = r - 8; y < r; y++) { const i = g.idx(x, y); g.set(i, DIRT); g.life[i] = (40 << 8) | 60; } }
      for (let y = 0; y < H; y++) { g.set(g.idx(0, y), STONE); g.set(g.idx(W - 1, y), STONE); }
      g.initAir();
      const total = () => { let w = 0; for (let i = 0; i < g.type.length; i++) { const t = g.type[i]; if (t === WATER) w++; else if (t === CLOUD) w += 0.1; else if (t === DIRT) w += (g.life[i] & 255) / 100; } for (const h of g.hum) w += h; return w; };
      let after = 0;
      run(g, 4 * MIN, 4, f => { if (rain && f <= MIN) { const x = 2 + ((Sim.R() * 40) | 0); if (g.type[g.idx(x, 2)] === E) g.set(g.idx(x, 2), WATER); } if (f === MIN + 600) after = total(); });
      let pit = 0; for (let y = 0; y < H; y++) for (let x = 100; x < W - 1; x++) if (g.type[g.idx(x, y)] === WATER) pit++;
      return { springs: g.springs, pit, after, end: total() };
    };
    const wet = ramp(true), still = ramp(false);
    console.log(`  rain on the top of a soil ramp: ${wet.springs} cells of spring water out at the cliff in 4 min, ${wet.pit} lying in the pit below; with no rain ${still.springs}`);
    console.log(`  water in the box (cells + soil moisture + vapour + cloud) after the rain stops: ${wet.after.toFixed(0)}, three minutes on ${wet.end.toFixed(0)}`);
    check('groundwater from rain upslope comes out as a spring', wet.springs >= 40 && wet.pit >= 20);
    check('soil at field moisture lets no water out', still.springs === 0);
    check('groundwater is conserved', Math.abs(wet.end - wet.after) < 0.03 * wet.after);

    // dig a trench into a sand bank: below the water table its walls seep water into it; a bank with no water table stays dry
    const bank = (table) => {
      Sim.reseed(6); const W = 120, H = 60, g = new Sim.Grid(W, H);
      for (let y = H - 3; y < H; y++) for (let x = 0; x < W; x++) g.set(g.idx(x, y), STONE);
      for (let y = 0; y < H; y++) { g.set(g.idx(0, y), STONE); g.set(g.idx(W - 1, y), STONE); }
      for (let y = H - 40; y < H - 3; y++) for (let x = 1; x < W - 1; x++) { const i = g.idx(x, y); g.set(i, SAND); g.life[i] = table && y >= H - 23 ? 255 : 40; }
      g.initAir(); run(g, 60);
      for (let y = 0; y < H - 3; y++) for (let x = 55; x < 65; x++) g.set(g.idx(x, y), E);
      run(g, MIN);
      let w = 0, sand = 0; for (let y = 0; y < H; y++) for (let x = 55; x < 65; x++) { const t = g.type[g.idx(x, y)]; if (t === WATER) w++; else if (t === SAND) sand++; }
      return { w, sand };
    };
    const cut = bank(true), dryCut = bank(false);
    console.log(`  a trench dug into a sand bank: ${cut.w} water cells seeped into it in a minute (${cut.sand} sand fell in); ${dryCut.w} with no water table (${dryCut.sand} sand)`);
    check('a trench below the water table fills with spring water', cut.w >= 100);
    check('a trench above it stays dry, and its damp walls stand', dryCut.w === 0 && dryCut.sand < 60);

    // wet sand's moisture survives a save
    {
      Sim.reseed(2); const g = new Sim.Grid(64, 64);
      for (let x = 0; x < 64; x++) { g.set(g.idx(x, 63), STONE); const i = g.idx(x, 62); g.set(i, SAND); g.life[i] = 77; }
      const h = new Sim.Grid(64, 64); h.load(g.save());
      check('sand moisture survives save and load', h.life[h.idx(10, 62)] === 77 && h.type[h.idx(10, 62)] === SAND);
    }
  },
  dunes() {
    // a mound of dry sand in a steady wind creeps downwind as a dune: the wind strips the windward slope and drops the sand past the
    // crest, where it slides down a steep slip face. No wind, or damp sand, and it stays put
    const mound = (hold, wet) => {
      Sim.reseed(4); const W = 360, H = 120, g = new Sim.Grid(W, H); g.windHold = hold;
      const top = x => H - 20 - Math.round(25 * Math.exp(-(((x - 100) / 40) ** 2)));
      for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) { const i = g.idx(x, y); if (y >= H - 12) g.set(i, STONE, g.ambAt(y)); else if (y >= top(x)) { g.set(i, SAND, g.ambAt(y)); g.life[i] = wet; } }
      g.initAir(); if (!wet) for (let c = 0; c < g.hum.length; c++) g.hum[c] *= 0.3; g.wakeAll();
      const sand0 = census(g, Sim.EL).Sand;
      const shape = () => { const h = []; for (let x = 0; x < W; x++) { let y = 0; while (y < H && g.type[g.idx(x, y)] !== SAND && g.type[g.idx(x, y)] !== STONE) y++; h.push(H - 12 - y); }
        let m = 0, mx = 0, pk = 0; for (let x = 0; x < W; x++) { const v = Math.max(0, h[x] - 8); m += v; mx += v * x; if (h[x] > h[pk]) pk = x; } return { cx: mx / m, h, pk }; };
      const c0 = shape().cx; run(g, 5 * MIN);
      const s = shape(), p = s.pk, windward = (s.h[p] - s.h[Math.max(0, p - 30)]) / 30;
      let lee = 0; for (let x = p; x < Math.min(W - 4, p + 20); x++) lee = Math.max(lee, (s.h[x] - s.h[x + 4]) / 4);   // the steepest stretch of the lee side
      return { moved: s.cx - c0, windward, lee, lost: sand0 - census(g, Sim.EL).Sand };
    };
    const blown = mound(0.6, 0), calm = mound(0, 0), damp = mound(0.6, 120);
    console.log(`  in a steady wind the mound's middle moved ${blown.moved.toFixed(1)} cells downwind in 5 min, windward slope ${blown.windward.toFixed(2)}, lee ${blown.lee.toFixed(2)}; no wind ${calm.moved.toFixed(1)}; damp sand ${damp.moved.toFixed(1)}`);
    check('wind drives a dune downwind', blown.moved > 30, blown.moved.toFixed(1));
    check('with a gentle windward back and a steep slip face', blown.lee >= 0.75 && blown.lee > 2 * blown.windward);
    check('still air or damp sand leaves it be', Math.abs(calm.moved) < 2 && Math.abs(damp.moved) < 2);
    check('no sand is lost', blown.lost === 0 && calm.lost === 0, `${blown.lost}`);
  },
  windfire() {
    // dry grass burns both ways from a spark in still air; in a wind it races downwind, creeps back upwind, and embers carry it
    // over a bare gap that a still-air fire can't cross
    const { PLANT } = Sim.ids;
    const field = (hold, gap, seed) => {
      Sim.reseed(seed); const W = 320, H = 100, g = new Sim.Grid(W, H); g.windHold = hold;
      for (let x = 0; x < W; x++) for (let y = H - 20; y < H; y++) { const i = g.idx(x, y); if (y >= H - 10) g.set(i, STONE, g.ambAt(y)); else { g.set(i, DIRT, g.ambAt(y)); g.life[i] = (40 << 8) | 20; } }
      for (let x = 10; x < W - 10; x++) if (!(gap && x >= 150 && x < 164)) for (let y = H - 23; y < H - 20; y++) g.set(g.idx(x, y), PLANT, g.ambAt(y));
      g.initAir(); for (let c = 0; c < g.hum.length; c++) g.hum[c] *= 0.3; g.wakeAll(); run(g, 120);
      return g;
    };
    const gone = (g, x) => { for (let y = g.H - 23; y < g.H - 20; y++) if (g.type[g.idx(x, y)] === PLANT) return false; return true; };
    const spread = hold => { const g = field(hold, false, 1); for (let x = 158; x < 163; x++) g.set(g.idx(x, g.H - 24), FIRE);
      let l = 0, r = 0; run(g, 1800, 15, f => { if (!l && gone(g, 30)) l = f; if (!r && gone(g, 290)) r = f; }); return [(l || 1800) / 60, (r || 1800) / 60]; };
    const jumps = hold => { let n = 0; for (const seed of [1, 2, 3, 4]) { const g = field(hold, true, seed); for (let x = 98; x < 103; x++) g.set(g.idx(x, g.H - 24), FIRE); let j = 0; run(g, 1200, 30, () => { if (gone(g, 170)) j = 1; }); n += j; } return n; };
    const still = spread(0), windy = spread(0.6), jumpStill = jumps(0), jumpWindy = jumps(0.6);
    console.log(`  130 cells of grass each way burn in ${still[0].toFixed(1)} s / ${still[1].toFixed(1)} s in still air, ${windy[0].toFixed(1)} s upwind / ${windy[1].toFixed(1)} s downwind in a wind; a 14-cell gap is crossed in ${jumpStill}/4 still runs, ${jumpWindy}/4 windy`);
    check('in still air fire spreads alike both ways', Math.max(...still) < 1.5 * Math.min(...still));
    check('in a wind it races downwind and creeps upwind', windy[1] < 0.6 * still[1] && windy[0] > 2 * still[0]);
    check('sparks carry a wind-driven fire over a gap', jumpWindy >= 3 && jumpStill <= 1);
  },
  channel() {
    // a stream fed onto a sand plain scours its bed where it runs fast and drops the sand where it slows: it cuts a channel into the
    // plain. A still pond on the same sand stays clear and keeps its floor
    Sim.reseed(3); const W = 480, H = 160, g = new Sim.Grid(W, H); g.windHold = 0;
    const bed = x => Math.round(70 + x / 30);
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) { const i = g.idx(x, y);
      if (y >= bed(x) + 25 || (x < 3 && y >= 40)) g.set(i, STONE, g.ambAt(y)); else if (y >= bed(x) && x < W - 20) { g.set(i, SAND, g.ambAt(y)); g.life[i] = 250; } }
    g.initAir(); g.wakeAll();
    const surf = () => { const h = []; for (let x = 0; x < W; x++) { let y = 0; while (y < H && g.type[g.idx(x, y)] !== SAND && g.type[g.idx(x, y)] !== STONE) y++; h.push(y); } return h; };
    const carried = () => { let n = 0; for (let i = 0; i < g.type.length; i++) if (g.type[i] === WATER && (g.life[i] & 255)) n++; return n; };
    const h0 = surf(), sand0 = census(g, Sim.EL).Sand;
    let off = 0;   // (grains carried out over the far end with the water)
    run(g, 3 * MIN, 1, () => { for (let x = 4; x < 6; x++) { const i = g.idx(x, 50); if (g.type[i] === E) g.set(i, WATER); } for (let y = 0; y < H; y++) for (let x = W - 4; x < W; x++) { const i = g.idx(x, y); if (g.type[i] === WATER) { if (g.life[i] & 255) off++; g.set(i, E); } } });
    const h = surf(); let cut = 0, fill = 0; for (let x = 10; x < 400; x++) { cut = Math.max(cut, h[x] - h0[x]); fill = Math.max(fill, h0[x] - h[x]); }
    const sand = census(g, Sim.EL).Sand + carried() + off;
    // the pond: sand floor, stone walls, still water
    Sim.reseed(4); const p = new Sim.Grid(160, 80); p.windHold = 0;
    for (let x = 0; x < 160; x++) for (let y = 0; y < 80; y++) { const i = p.idx(x, y); if (y >= 70 || x < 5 || x >= 155) { if (y >= 40) p.set(i, STONE, p.ambAt(y)); } else if (y >= 60) { p.set(i, SAND, p.ambAt(y)); p.life[i] = 250; } else if (y >= 45) p.set(i, WATER, p.ambAt(y)); }
    p.initAir(); p.wakeAll(); run(p, 2 * MIN);
    let lifted = 0; for (let i = 0; i < p.type.length; i++) if ((p.type[i] === WATER && (p.life[i] & 255)) || (p.type[i] === SAND && ((i / 160) | 0) < 60)) lifted++;
    console.log(`  the stream cut its bed down ${cut} cells at most and built it up ${fill} where it slowed; sand lying or carried ${sand0} -> ${sand} (${off} carried off the end); the still pond stirred ${lifted} grains`);
    check('a stream cuts a channel into a sand plain', cut >= 6);
    check('and lays the sand down again downstream', fill >= 2);   // (2-3 since waves, 3 before)
    check('sand is conserved', Math.abs(sand - sand0) <= 2);
    check('a still pond does not scour its floor', lifted <= 3);
  },
  grass() {
    // grass spreads over damp dirt by runners and stays green; on dry dirt it doesn't spread, dries to straw and dies back
    const res = {};
    for (const [label, m] of [['damp', 90], ['dry', 30]]) {
      const W = 200, H = 80, g = plot(W, H, 30, m), sy = H - 31;
      for (let x = 98; x < 102; x++) { const i = g.idx(x, sy); g.set(i, PLANT); g.life[i] = (200 << 8) | 1; }
      run(g, 1.5 * MIN);   // spring into early summer
      let cols = 0, cells = 0, sap = 0;
      for (let x = 0; x < W; x++) { let any = false; for (let y = sy - 3; y <= sy; y++) { const i = g.idx(x, y); if (g.type[i] === PLANT) { any = true; cells++; sap += g.life[i] >> 8; } } if (any) cols++; }
      res[label] = { cols, sap: cells ? sap / cells : 0 };
      console.log(`  ${label} (moisture ${m}): grass covers ${cols} columns after 1.5 min, mean sap ${res[label].sap.toFixed(0)}`);
    }
    check('grass spreads over damp dirt', res.damp.cols >= 30 && res.damp.sap >= Sim.CURED, `${res.damp.cols} columns`);
    check('grass on dry dirt does not spread and dries out', res.dry.cols <= 4 && res.dry.sap < Sim.CURED, `${res.dry.cols} columns, sap ${res.dry.sap.toFixed(0)}`);
  },
  sow() {
    // grass seed blows onto damp bare ground its runners can't reach: here a field 10 rows below the meadow's terrace
    const W = 200, H = 80, g = plot(W, H, 30, 90), sy = H - 31;
    for (let y = sy - 9; y <= sy; y++) for (let x = 0; x < 40; x++) { const i = g.idx(x, y); g.set(i, DIRT); g.life[i] = (40 << 8) | 90; }
    for (let x = 5; x < 35; x++) { const i = g.idx(x, sy - 10); g.set(i, PLANT); g.life[i] = (200 << 8) | 1; }
    g.initAir(); run(g, 1.5 * MIN);
    let cols = 0; for (let x = 50; x < W; x++) if (g.type[g.idx(x, sy)] === PLANT) cols++;
    console.log(`  a meadow on a terrace 10 rows up: after 1.5 min grass has come up in ${cols} columns of the field below`);
    check('grass seeds bare ground out of its runners\' reach', cols >= 10, `${cols} columns`);
  },
  compete() {
    // a tree in a meadow: its shade and its roots thin the grass under it while the open meadow holds; seeds falling on grass
    // take root less often than on bare dirt; a seedling that can't drink dies of thirst
    // (judged over the columns the tree's leaves end up over, against open columns well away from it, over six seeds: a tree
    // whose leaves all grow high, past the 30 rows shade reaches down, shades nothing, and on three seeds that can be two of them)
    let under = 0, nu = 0, open = 0, no = 0;
    for (const seed of [7, 8, 9, 10, 11, 12]) {
      const W = 200, H = 120, g = plot(W, H, 30, 90, seed), sy = H - 31;
      for (let x = 0; x < W; x++) { const i = g.idx(x, sy); g.set(i, PLANT); g.life[i] = (220 << 8) | 1; }
      g.set(g.idx(100, sy), TIP);
      run(g, 2.5 * MIN);
      for (let x = 0; x < W; x++) {
        let leafy = false, n = 0;
        for (let y = 0; y < sy - 3; y++) { const i = g.idx(x, y); if (g.type[i] === PLANT && g.owner[i]) leafy = true; }
        for (let y = sy - 3; y <= sy; y++) { const i = g.idx(x, y); if (g.type[i] === PLANT && !g.owner[i]) n++; }
        if (leafy) { under += n; nu++; } else if (Math.abs(x - 100) > 40 && x > 5 && x < W - 5) { open += n; no++; }
      }
    }
    const du = under / Math.max(1, nu), dop = open / Math.max(1, no);
    console.log(`  grass per column: ${du.toFixed(2)} under the trees' leaves (${nu} columns), ${dop.toFixed(2)} in the open`);
    check('grass thins under a tree but holds in the open', du < 0.6 * dop && dop >= 1, `${(du / dop).toFixed(2)} of the open`);
    // seeds: a row on bare damp dirt and a row on grass over the same dirt
    const sprouted = onGrass => {
      const s = plot(240, 100, 30, 150, 11), y = 100 - 31;
      if (onGrass) for (let x = 0; x < 240; x++) { const i = s.idx(x, y); s.set(i, PLANT); s.life[i] = (220 << 8) | 1; }
      for (let x = 6; x < 240; x += 8) { const i = s.idx(x, onGrass ? y - 1 : y); s.set(i, SEED); s.life[i] = 1; }
      run(s, 40 * 60);
      return s.trees.length;
    };
    const bare = sprouted(false), grassy = sprouted(true);
    console.log(`  of 30 seeds, ${bare} took root on bare dirt and ${grassy} on grass`);
    check('grass holds back seedlings', grassy < 0.6 * bare && grassy >= 1, `${grassy} vs ${bare}`);
  },
  seasonfire() {
    // the same meadow burns slowly in spring, when the grass is green, and races in late summer, when it has cured to straw
    const field = (pre, seed = 3) => {
      Sim.reseed(seed); const W = 320, H = 100, g = new Sim.Grid(W, H); g.windHold = 0;
      for (let y = H - 20; y < H; y++) for (let x = 0; x < W; x++) { const i = g.idx(x, y); if (y >= H - 10) g.set(i, STONE, g.ambAt(y)); else { g.set(i, DIRT, g.ambAt(y)); g.life[i] = (40 << 8) | 90; } }
      for (let x = 10; x < W - 10; x++) for (let y = H - 22; y < H - 20; y++) { const i = g.idx(x, y); g.set(i, PLANT, g.ambAt(y)); g.life[i] = (220 << 8) | 1; }
      g.initAir(); g.wakeAll(); run(g, pre); return g;
    };
    const burn = pre => {
      const g = field(pre), H = g.H; let sap = 0, n = 0;
      for (let x = 10; x < g.W - 10; x++) { const i = g.idx(x, H - 21); if (g.type[i] === PLANT) { sap += g.life[i] >> 8; n++; } }
      for (let y = H - 25; y < H - 22; y++) for (let x = 10; x < 14; x++) g.set(g.idx(x, y), FIRE);
      let reach = 0;
      run(g, 300, 10, () => { for (let x = g.W - 11; x > reach; x--) { let gone = 0; for (let y = H - 22; y < H - 20; y++) if (g.type[g.idx(x, y)] !== PLANT) gone++; if (gone === 2 && x - reach < 40) { reach = x; break; } } });
      return { reach: reach - 14, sap: sap / Math.max(1, n), season: g.seasonName, dry: g.dryness };
    };
    const spring = burn(MIN / 4), late = burn(2.6 * MIN);
    console.log(`  spring (sap ${spring.sap.toFixed(0)}): fire ran ${spring.reach} cells in 5 s; ${late.season} at dryness ${late.dry.toFixed(2)} (sap ${late.sap.toFixed(0)}): ${late.reach} cells`);
    check('late-summer grass has cured to straw', late.sap < Sim.CURED);
    check('a dry-season grass fire runs 2.5x+ faster than a spring one', late.reach >= 2.5 * spring.reach && spring.reach > 0, `${late.reach} vs ${spring.reach}`);
  },
  // ---------------- R6: wild plants ----------------
  scrub() {
    // shrubs hold dry ground: on dirt too dry for a meadow they stay green through the dry season and sow themselves, while grass
    // beside them cures to straw; on damp ground under a full sward their seedlings are smothered
    const { SHRUB } = Sim.ids, res = {};
    for (const [label, m, sward] of [['dry', 25, false], ['damp', 90, true]]) {
      const W = 240, H = 80, g = plot(W, H, 30, m, 5), sy = H - 31;
      if (sward) for (let x = 0; x < W; x++) { const i = g.idx(x, sy); g.set(i, PLANT); g.life[i] = (220 << 8) | 1; }
      else for (let x = 10; x < 40; x++) { const i = g.idx(x, sy); g.set(i, PLANT); g.life[i] = (220 << 8) | 1; }
      for (const x of [90, 120, 150]) { const i = g.idx(x, sy); g.set(i, SHRUB); }
      run(g, 2.6 * MIN);   // spring to the dry season's height
      let bases = 0, sap = 0, tall = 0, grass = 0, gsap = 0;
      for (let x = 0; x < W; x++) {
        const i = g.idx(x, sy); if (g.type[i] === SHRUB) { bases++; sap += g.life[i] >> 8; let h = 1; while (g.type[i - h * W] === SHRUB) h++; tall = Math.max(tall, h); }
        if (x >= 10 && x < 40 && g.type[i] === PLANT) { grass++; gsap += g.life[i] >> 8; }
      }
      res[label] = { bases, sap: bases ? sap / bases : 0, tall, grass, gsap: grass ? gsap / grass : 0 };
      console.log(`  ${label} dirt (moisture ${m}${sward ? ', under a sward' : ''}): ${bases} shrubs after 2.6 min (${g.seasonName}, dryness ${g.dryness.toFixed(2)}), sap ${res[label].sap.toFixed(0)}, tallest ${tall}` + (sward ? '' : `; the strip of grass beside them: ${grass} columns, sap ${res[label].gsap.toFixed(0)}`));
    }
    check('shrubs on dry dirt stay green through the dry season', res.dry.bases >= 3 && res.dry.sap >= Sim.CURED && res.dry.tall >= 3, `${res.dry.bases} shrubs, sap ${res.dry.sap.toFixed(0)}, tallest ${res.dry.tall}`);
    check('and sow themselves on the dry ground', res.dry.bases >= 6, `${res.dry.bases} from 3`);
    check('while grass on the same ground cures or dies', res.dry.grass === 0 || res.dry.gsap < Sim.CURED, `${res.dry.grass} columns, sap ${res.dry.gsap.toFixed(0)}`);
    check('in a meadow on damp ground few shrub seedlings take', res.damp.bases <= 0.5 * res.dry.bases, `${res.damp.bases} vs ${res.dry.bases} on dry ground`);
  },
  cactus() {
    // a cactus lives on dry sand through a long dry spell, drinks fast when rain wets the sand, and rots in damp dirt;
    // a shrub on the same sand parches
    const { CACTUS, SHRUB } = Sim.ids;
    const field = (ground, m) => {
      Sim.reseed(4); const W = 160, H = 70, g = new Sim.Grid(W, H);
      for (let y = H - 25; y < H; y++) for (let x = 0; x < W; x++) { const i = g.idx(x, y); if (y >= H - 3) g.set(i, STONE); else { g.set(i, ground); g.life[i] = ground === DIRT ? (40 << 8) | m : m; } }
      g.initAir(); for (let c = 0; c < g.hum.length; c++) g.hum[c] *= 0.3; return g;
    };
    const stem = (g, x) => { let h = 0; for (let y = g.H - 26; y > 0 && g.type[g.idx(x, y)] === CACTUS; y--) h++; return h; };
    const dry = field(SAND, 8), sy = dry.H - 26;
    dry.set(dry.idx(50, sy), CACTUS); dry.set(dry.idx(110, sy), SHRUB);
    run(dry, 2 * MIN);
    const cs = dry.life[dry.idx(50, sy)] >> 8, h = stem(dry, 50), shrub = dry.type[dry.idx(110, sy)] === SHRUB ? dry.life[dry.idx(110, sy)] >> 8 : -1;
    console.log(`  on dry sand for 2 min: the cactus stands ${h} tall with sap ${cs}; the shrub ${shrub < 0 ? 'died' : 'has sap ' + shrub}`);
    check('a cactus lasts a long dry spell on dry sand', dry.type[dry.idx(50, sy)] === CACTUS && cs >= 120 && h >= 3, `sap ${cs}, ${h} tall`);
    check('a shrub there parches', shrub < Sim.CURED, shrub < 0 ? 'died' : `sap ${shrub}`);
    // rain: a thirsty cactus drinks the wetted sand
    const wet = field(SAND, 8); wet.set(wet.idx(80, sy), CACTUS); wet.life[wet.idx(80, sy)] = 60 << 8;
    for (let x = 70; x < 91; x++) if (x !== 80) wet.set(wet.idx(x, sy), WATER);
    run(wet, 30 * 60);
    const after = wet.life[wet.idx(80, sy)] >> 8;
    console.log(`  a thirsty cactus (sap 60) after a shower on the sand round it: sap ${after} 30 s later`);
    check('a cactus drinks fast when rain wets the sand', after >= 160, `sap ${after}`);
    // damp dirt rots it
    const damp = field(DIRT, 130); damp.set(damp.idx(80, sy), CACTUS);
    let gone = -1; run(damp, 2 * MIN, 60, f => { if (gone < 0 && damp.type[damp.idx(80, sy)] !== CACTUS) gone = f; });
    console.log(`  on damp dirt: the cactus ${gone < 0 ? 'still stands after 2 min' : 'rotted after ' + (gone / 60).toFixed(0) + ' s'}`);
    check('a cactus rots in damp dirt', gone > 0, gone < 0 ? 'still there' : (gone / 60).toFixed(0) + ' s');
  },
  reeds() {
    // reeds root in the soaked bed of a shallow pond, grow up out of the water and spread along the bed; in deep water they drown,
    // and where the ground has dried they die back
    const { REED } = Sim.ids;
    const pond = (depth, m = 255) => {
      Sim.reseed(6); const W = 200, H = 70, g = new Sim.Grid(W, H), bed = H - 20;
      for (let y = bed; y < H; y++) for (let x = 0; x < W; x++) { const i = g.idx(x, y); if (y >= H - 3) g.set(i, STONE); else { g.set(i, DIRT); g.life[i] = (40 << 8) | m; } }
      for (let x = 0; x < W; x++) if (x < 30 || x >= W - 30) for (let y = bed - depth - 2; y < bed; y++) { const i = g.idx(x, y); g.set(i, DIRT); g.life[i] = (40 << 8) | m; }
      if (depth) for (let y = bed - depth; y < bed; y++) for (let x = 30; x < W - 30; x++) g.set(g.idx(x, y), WATER);
      for (const x of [80, 120]) g.set(g.idx(x, bed - 1), REED);
      g.initAir(); return { g, bed };
    };
    const count = (g, bed) => { let bases = 0, top = g.H; for (let x = 30; x < g.W - 30; x++) for (let y = bed - 12; y < bed + 2; y++) { const i = g.idx(x, y); if (g.type[i] !== REED) continue; top = Math.min(top, y); if (g.type[i + g.W] !== REED) bases++; } return { bases, top }; };
    const sh = pond(3); run(sh.g, 1.5 * MIN);
    const a = count(sh.g, sh.bed), surface = sh.bed - 3, above = surface - a.top;
    console.log(`  a pond 3 deep: ${a.bases} reeds after 1.5 min (from 2), standing ${above} above the water`);
    check('reeds grow up out of shallow water', above >= 2 && above <= 4, `${above} above`);
    check('and spread along the bed', a.bases >= 8, `${a.bases} reeds`);
    const dp = pond(10); run(dp.g, 2 * MIN);
    const b = count(dp.g, dp.bed);
    console.log(`  a pond 10 deep: ${b.bases} reeds left in it after 2 min`);
    check('reeds drown in deep water', b.bases === 0, `${b.bases} left`);
    const dr = pond(0, 60); run(dr.g, 2 * MIN);
    const c = count(dr.g, dr.bed);
    console.log(`  on drained ground (moisture 60): ${c.bases} reeds left after 2 min`);
    check('reeds die where the ground is not soaked', c.bases === 0, `${c.bases} left`);
  },
  biomes() {
    // a new world lays its land out by climate: east of the start the dry country (scrub on thin dirt, then a sand desert with
    // cacti and no grass or trees), and in the wet country meadows, forest and reeds in the valley ponds
    const { SHRUB, CACTUS, REED } = Sim.ids, A = Sim.aridAt;
    const tally = ox => {
      const g = new Sim.Grid(Sim.WORLD.W, Sim.WORLD.H); Sim.generate(g, 12345, Sim.WORLD.WIDE, Math.floor((Sim.WORLD.WIDE - g.W) / 2 / Sim.REGION) * Sim.REGION + ox);
      const z = { desert: {}, scrub: {}, wet: {} };
      for (let x = 0; x < g.W; x++) {
        const a = A(12345, g.ox + x), k = a >= Sim.ARID_DESERT ? 'desert' : a >= Sim.ARID_SCRUB ? 'scrub' : a < 0.05 ? 'wet' : null; if (!k) continue;
        z[k].cols = (z[k].cols || 0) + 1;
        for (let y = 0; y < g.H; y++) { const i = g.idx(x, y), t = g.type[i], n = g.owner[i] ? 'Tree' : Sim.EL[t].name; if ([SHRUB, CACTUS, REED, PLANT].includes(t) || g.owner[i]) z[k][n] = (z[k][n] || 0) + 1; }
      }
      return z;
    };
    const e = tally(640), w = tally(0), f = o => JSON.stringify(o);
    console.log(`  cells by climate, east of the start: desert ${f(e.desert)}, scrub ${f(e.scrub)}; at the start, wet country ${f(w.wet)}`);
    check('the desert has cacti and no grass or trees', (e.desert.Cactus || 0) >= 50 && !e.desert.Plant && !e.desert.Tree);
    check('the scrub is shrubs', (e.scrub.Shrub || 0) >= 100 && (e.scrub.Shrub || 0) > 3 * ((e.scrub.Plant || 0) + (e.scrub.Tree || 0)));
    check('the wet country has meadow, forest and reeds', (w.wet.Plant || 0) >= 100 && (w.wet.Tree || 0) >= 500 && (w.wet.Reed || 0) >= 10);
  },
  // ---------------- E6: new materials ----------------
  glass() {
    const { MGLASS, GLASS } = Sim.ids;
    const box = (W, H) => { Sim.reseed(4); const g = new Sim.Grid(W, H); g.windHold = 0; for (let x = 0; x < W; x++) for (let y = H - 6; y < H; y++) g.set(g.idx(x, y), STONE, g.ambAt(y)); g.initAir(); g.wakeAll(); return g; };
    { // sand poured onto lava melts into molten glass (which floats on the lava), never lava or stone
      const g = box(120, 80); for (let x = 40; x < 80; x++) for (let y = 66; y < 74; y++) g.set(g.idx(x, y), LAVA);
      for (let x = 55; x < 65; x++) for (let y = 50; y < 60; y++) g.set(g.idx(x, y), SAND);
      run(g, 1200); const c = census(g, Sim.EL);
      console.log(`  100 sand on a lava pool after 20 s: ${c.Sand || 0} sand, ${c['Molten glass'] || 0} molten glass, ${c.Glass || 0} glass`);
      check('sand on lava melts into molten glass', (c['Molten glass'] || 0) + (c.Glass || 0) >= 20);
    }
    { // a pour of molten glass runs out over a cold floor and sets into glass; a glass pane dropped in lava melts back to molten glass
      const g = box(120, 80); for (let x = 50; x < 70; x++) for (let y = 54; y < 64; y++) g.set(g.idx(x, y), MGLASS);
      let set = -1; run(g, 2400, 60, f => { if (set < 0 && !census(g, Sim.EL)['Molten glass']) set = f; });
      let x0 = 999, x1 = -1; for (let i = 0; i < g.type.length; i++) if (g.type[i] === GLASS) { x0 = Math.min(x0, i % g.W); x1 = Math.max(x1, i % g.W); }
      const c = census(g, Sim.EL);
      console.log(`  200 cells of molten glass on cold stone: all set by ${set < 0 ? 'never' : (set / 60).toFixed(0) + ' s'}, ${c.Glass || 0} glass spread over ${x1 - x0 + 1} columns`);
      check('molten glass sets into glass within 40 s', set > 0 && (c.Glass || 0) >= 190);
      check('molten glass runs before it sets (wider than the pour)', x1 - x0 + 1 >= 24, `${x1 - x0 + 1} cols`);
      const h = box(80, 60); for (let x = 10; x < 70; x++) h.set(h.idx(x, 53), GLASS);
      for (let x = 10; x < 70; x++) for (let y = 43; y < 53; y++) h.set(h.idx(x, y), LAVA);
      run(h, 600); const d = census(h, Sim.EL);
      console.log(`  a glass floor under a lava pool after 10 s: ${d.Glass || 0} glass, ${d['Molten glass'] || 0} molten glass, lava ${d.Lava}`);
      check('glass melts in lava to molten glass, not lava', (d['Molten glass'] || 0) >= 10 && d.Lava <= 600);
    }
  },
  mud() {
    const { MUD } = Sim.ids;
    { // a puddle on soaked dirt churns it to mud (on damp ground it just soaks in); the puddle gone and the ground drained, the sun dries the mud back into dirt
      // (summed over four plots: on one plot it is a few dozen chances, and E7's own build made 9-24 across seeds)
      let peak = 0, lying = 0, left = 0;
      for (const seed of [7, 1, 2, 3]) {
        const W = 120, H = 80, g = plot(W, H, 20, 240, seed); g.windHold = 0; g.clock = Sim.YEAR * 0.4; g.updateClimate();
        for (let y = H - 23; y < H - 20; y++) for (let x = 30; x < 90; x++) g.set(g.idx(x, y), WATER);
        let p = 0; run(g, MIN, 60, () => { p = Math.max(p, census(g, Sim.EL).Mud || 0); }); peak += p;
        for (let i = 0; i < g.type.length; i++) if (g.type[i] === WATER) g.set(i, E);
        for (let y = 0; y < H - 22; y++) for (let x = 0; x < W; x++) { const i = g.idx(x, y); if (g.type[i] === MUD) g.set(i, E); }   // (leave only the mud lying on the field)
        for (let i = 0; i < g.type.length; i++) if (g.type[i] === DIRT) g.life[i] = (40 << 8) | 100;   // and the field drained under it
        lying += census(g, Sim.EL).Mud || 0;
        run(g, 6 * MIN, 1, () => { for (let c = 0; c < g.hum.length; c++) g.hum[c] = Math.min(g.hum[c], 0.3 * g.cap[c]); });
        left += census(g, Sim.EL).Mud || 0;
      }
      console.log(`  3-deep puddles on soaked dirt, four plots: up to ${peak} mud in a minute; ${lying} lying when drained, ${left} left after 6 min of sun`);
      check('a puddle on soaked dirt makes mud', peak >= 48);
      check('mud dries back into dirt', lying >= 48 && left <= lying / 4, `${left}/${lying}`);
    }
    { // under a deep lake the bed stays dirt
      const W = 80, H = 80, g = plot(W, H, 20, 255); g.windHold = 0;
      for (let y = H - 40; y < H - 20; y++) for (let x = 0; x < W; x++) g.set(g.idx(x, y), WATER);
      run(g, MIN); const m = census(g, Sim.EL).Mud || 0;
      console.log(`  a 20-deep lake on soaked dirt: ${m} mud after a minute`);
      check('a deep lake bed does not turn to mud', m === 0);
    }
    { // a heap of mud slumps out flatter than the same heap of sand, then lies still (its chunk sleeps)
      const heap = t => { Sim.reseed(4); const W = 120, H = 70, g = new Sim.Grid(W, H); g.windHold = 0; for (let x = 0; x < W; x++) for (let y = H - 4; y < H; y++) g.set(g.idx(x, y), STONE); g.initAir();
        for (let y = H - 24; y < H - 4; y++) for (let x = 55; x < 65; x++) { const i = g.idx(x, y); g.set(i, t); if (t === SAND) g.life[i] = 0; }
        run(g, 1800); let top = H, x0 = W, x1 = 0; for (let i = 0; i < g.type.length; i++) if (g.type[i] === t) { const x = i % W, y = (i / W) | 0; top = Math.min(top, y); x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
        let awake = 0; for (let k = 0; k < 60; k++) { g.step(); awake += g.dirty.reduce((a, b) => a + b, 0); }
        return { h: H - 4 - top, w: x1 - x0 + 1, awake: awake / 60 }; };
      const m = heap(MUD), s = heap(SAND);
      console.log(`  200 cells after 30 s: mud ${m.h} high x ${m.w} wide (${m.awake.toFixed(1)} chunks awake), sand ${s.h} high x ${s.w} wide`);
      check('mud slumps flatter than sand', m.h < s.h && m.w > s.w);
      check('settled mud goes to sleep', m.awake <= 1);
    }
  },
  clay() {
    const { CLAY, BRICK } = Sim.ids;
    const box = (W, H) => { Sim.reseed(4); const g = new Sim.Grid(W, H); g.windHold = 0; for (let x = 0; x < W; x++) for (let y = H - 4; y < H; y++) g.set(g.idx(x, y), STONE, g.ambAt(y)); g.initAir(); g.wakeAll(); return g; };
    { // damp clay stands where it is piled; dry clay slumps
      const tower = m => { const g = box(80, 60); for (let y = 36; y < 56; y++) for (let x = 38; x < 42; x++) { const i = g.idx(x, y); g.set(i, CLAY); g.life[i] = m; } run(g, 600); let top = 99; for (let i = 0; i < g.type.length; i++) if (g.type[i] === CLAY) top = Math.min(top, (i / 80) | 0); return 56 - top; };
      const wet = tower(120), dry = tower(10);
      console.log(`  a 20-high, 4-wide column after 10 s: damp clay ${wet} high, dry clay ${dry} high`);
      check('damp clay holds its shape, dry clay slumps', wet === 20 && dry <= 12);
    }
    { // water in a clay-lined pit holds; in a dirt-lined one it soaks away
      const pond = t => { const g = box(80, 70); g.clock = Sim.YEAR * 0.1; g.updateClimate();
        for (let y = 36; y < 66; y++) for (let x = 0; x < 80; x++) { const i = g.idx(x, y); g.set(i, DIRT); g.life[i] = (40 << 8) | 20; }
        for (let y = 36; y < 50; y++) for (let x = 20; x < 60; x++) g.set(g.idx(x, y), E);
        for (let y = 50; y < 53; y++) for (let x = 17; x < 63; x++) { const i = g.idx(x, y); g.set(i, t); if (t === DIRT) g.life[i] = (40 << 8) | 20; }
        for (let y = 36; y < 50; y++) for (const x of [17, 18, 19, 60, 61, 62]) { const i = g.idx(x, y); g.set(i, t); if (t === DIRT) g.life[i] = (40 << 8) | 20; }
        for (let y = 40; y < 50; y++) for (let x = 20; x < 60; x++) g.set(g.idx(x, y), WATER);
        run(g, MIN); const w1 = census(g, Sim.EL).Water || 0; run(g, 2 * MIN);
        return [w1, census(g, Sim.EL).Water || 0]; };
      const [c1, c] = pond(CLAY), [d1, d] = pond(DIRT), [s1, st] = pond(STONE);
      console.log(`  400 cells of water after 1 min / 3 min: clay-lined pit ${c1}/${c}, dirt-lined ${d1}/${d}, stone-lined ${s1}/${st} (what evaporation takes)`);
      check('a clay-lined pond holds its water once the clay has wetted', c1 - c <= (s1 - st) + 15 && d < c / 2, `lost ${c1 - c} in the last 2 min vs stone ${s1 - st}; dirt kept ${d}`);
    }
    { // clay laid against lava fires into brick; a brick lintel bears a span
      const g = box(80, 60); for (let x = 10; x < 70; x++) for (let y = 50; y < 56; y++) g.set(g.idx(x, y), LAVA);
      for (let x = 30; x < 50; x++) for (let y = 47; y < 50; y++) g.set(g.idx(x, y), CLAY);
      run(g, 1800); const c = census(g, Sim.EL);
      console.log(`  60 clay on lava after 30 s: ${c.Brick || 0} brick, ${c.Clay || 0} clay`);
      check('clay fires into brick', (c.Brick || 0) >= 20);
      const h = box(80, 60); for (let y = 30; y < 56; y++) { h.set(h.idx(30, y), BRICK); h.set(h.idx(38, y), BRICK); }
      for (let x = 30; x <= 38; x++) h.set(h.idx(x, 29), BRICK);
      run(h, 300); let span = 0; for (let x = 31; x < 38; x++) if (h.type[h.idx(x, 29)] === BRICK) span++;
      check('a brick lintel spans a 7-cell gap', span === 7, `${span}/7 standing`);
    }
  },
  rust() {
    const { METAL, RUST } = Sim.ids;
    const tank = (liquid, cover) => { Sim.reseed(4); const W = 60, H = 60, g = new Sim.Grid(W, H); g.windHold = 0;
      for (let x = 0; x < W; x++) for (let y = H - 4; y < H; y++) g.set(g.idx(x, y), STONE);
      for (let y = 20; y < H - 4; y++) { g.set(g.idx(0, y), STONE); g.set(g.idx(W - 1, y), STONE); }
      for (let y = 26; y < H - 4; y++) for (let x = 28; x < 32; x++) g.set(g.idx(x, y), METAL);   // a metal wall, 4 thick
      if (liquid !== null) for (let y = 30; y < H - 4; y++) for (let x = 1; x < W - 1; x++) if (g.type[g.idx(x, y)] === E) { const i = g.idx(x, y); g.set(i, liquid); if (liquid === BRINE) g.life[i] = 200; }
      g.initAir(); if (cover) for (let c = 0; c < g.hum.length; c++) g.hum[c] *= 0.3;
      run(g, MIN); return 4 * (H - 4 - 26) - (census(g, Sim.EL).Metal || 0); };
    const fresh = tank(WATER), salt = tank(BRINE), dry = tank(null, true);
    console.log(`  a 4-thick metal wall standing a minute: ${fresh} cells rusted in fresh water, ${salt} in brine, ${dry} in dry air`);
    check('metal under water rusts', fresh >= 8);
    check('brine rusts it 3x+ faster', salt >= 3 * fresh);
    check('dry metal does not rust', dry === 0);
  },
  oil() {
    const { OIL, SMOKE } = Sim.ids;
    // an oil fire in a pan burns down from its surface; water poured on it flashes to steam and throws the burning oil out of the pan
    const pan = water => { Sim.reseed(4); const W = 120, H = 90, g = new Sim.Grid(W, H); g.windHold = 0;
      for (let x = 0; x < W; x++) for (let y = H - 4; y < H; y++) g.set(g.idx(x, y), STONE);
      for (let y = 60; y < H - 4; y++) { g.set(g.idx(44, y), STONE); g.set(g.idx(75, y), STONE); }
      for (let y = 72; y < H - 4; y++) for (let x = 45; x < 75; x++) g.set(g.idx(x, y), OIL);
      g.initAir(); for (let x = 45; x < 75; x++) g.set(g.idx(x, 71), FIRE);
      let out = 0, smoke = 0, burn = -1;
      if (water) { run(g, 60); for (let y = 40; y < 44; y++) for (let x = 50; x < 70; x++) g.set(g.idx(x, y), WATER); }
      run(g, 1800, 1, f => { if (f > 300 && f % 10) return; let oil = 0; for (let i = 0; i < g.type.length; i++) { const t = g.type[i]; if (t === OIL) { oil++; if (f <= 300 && ((i / W) | 0) < 68) out++; } if (t === SMOKE && f % 10 === 0) smoke++; } if (burn < 0 && oil === 0) burn = f; });
      return { out, smoke: smoke / 180, burn }; };
    const dryPan = pan(false), wet = pan(true);
    console.log(`  a 6-deep oil fire in a pan: burnt out after ${dryPan.burn < 0 ? 'over 30' : (dryPan.burn / 60).toFixed(1)} s, mean smoke ${dryPan.smoke.toFixed(0)} cells; oil thrown 4+ rows over its surface in the first 5 s (summed every tick) ${dryPan.out} left alone, ${wet.out} with water poured on`);
    check('a pool of oil burns down from its surface (3 s+), not in a flash', dryPan.burn < 0 || dryPan.burn >= 180);
    check('an oil fire is smoky', dryPan.smoke >= 30);
    check('water on burning oil throws it up into the air', wet.out >= 50 && dryPan.out === 0, `${wet.out} vs ${dryPan.out}`);
  },
  dambreak() {
    // a dam gives way at one end of a long tank: the surge runs the length of it, piles up against the far wall well over the level
    // the water ends at, and sloshes back before it settles (water keeps its momentum); in the end it still lies flat
    const W = 360, H = 120;
    const one = seed => {
      Sim.reseed(seed); const g = new Sim.Grid(W, H); g.windHold = 0;
      for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (y >= H - 4 || x < 4 || x >= W - 4) g.set(g.idx(x, y), STONE, g.ambAt(y));
      for (let y = H - 4 - 70; y < H - 4; y++) for (let x = 4; x < 64; x++) g.set(g.idx(x, y), WATER, g.ambAt(y));
      g.initAir(); for (let c = 0; c < g.hum.length; c++) g.hum[c] = g.cap[c]; g.wakeAll();
      // depth as the water in a band of columns, so spray doesn't count
      const depth = (a, b) => { let n = 0; for (let x = a; x < b; x++) for (let y = 0; y < H - 4; y++) if (g.type[g.idx(x, y)] === WATER) n++; return n / (b - a); };
      const com = () => { let s = 0, n = 0; for (let i = 0; i < g.type.length; i++) if (g.type[i] === WATER) { s += i % W; n++; } return s / n - W / 2; };
      let reach = -1, far = 0, over = 0, back = 0;
      run(g, 30 * 60, 1, f => {
        if (f > 20 * 60 || f % 6) return;
        const d = depth(W - 14, W - 4); if (reach < 0 && d >= 3) reach = f; far = Math.max(far, d);
        // sloshing: the water's middle overshoots the middle of the tank toward the far end, then swings back past it
        const c = com(); if (c > over) over = c; if (over >= 5 && -c > back) back = -c;
      });
      const hs = []; for (let x = 4; x < W - 4; x++) hs.push(depth(x, x + 1));
      const rest = depth(4, W - 4);
      return { reach, runup: far - rest, swing: over, back, flat: Math.max(...hs) - Math.min(...hs) };
    };
    const rs = [1, 2, 3, 4].map(one);
    console.log(`  surge reaches the far wall at ${rs.map(r => (r.reach / 60).toFixed(1) + 's').join(' ')}; piles up there ${rs.map(r => r.runup.toFixed(0)).join(' ')} rows over the final level; middle of the water swings ${rs.map(r => r.swing.toFixed(0) + '/' + r.back.toFixed(0)).join(' ')} cols past the tank's middle and back; final depth spread ${rs.map(r => r.flat).join(' ')}`);
    // (the build before waves: 8.1-8.5 s, no pile-up, no swing. The surge is about as fast as it was: what's new is the momentum)
    check('a dam-break surge crosses a 350-wide tank within 9 s', rs.every(r => r.reach > 0 && r.reach <= 540));
    check('it piles up against the far wall 2+ rows over the final level', rs.every(r => r.runup >= 2));
    check('and sloshes: the water\'s middle swings 5+ cols past the tank\'s middle and on average 2+ back', rs.every(r => r.swing >= 5) && rs.reduce((a, r) => a + r.back, 0) / rs.length >= 2);
    check('the water still settles flat', rs.every(r => r.flat <= 3));
  },
  wave() {
    // a mound of water at one end of a 20-deep tank runs down the tank as a wave, at about the speed a wave goes (sqrt(g*depth), some
    // 2 cells a tick here): the far end doesn't rise before the wave could get there, and the crest travels the length of the tank
    const W = 200, H = 80, D = 20;
    const one = seed => {
      Sim.reseed(seed); const g = new Sim.Grid(W, H); g.windHold = 0;
      for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (y >= H - 4 || x < 4 || x >= W - 4) g.set(g.idx(x, y), STONE, g.ambAt(y)); else if (y >= H - 4 - D || (x < 24 && y >= H - 14 - D)) g.set(g.idx(x, y), WATER, g.ambAt(y));
      g.initAir(); for (let c = 0; c < g.hum.length; c++) g.hum[c] = g.cap[c]; g.wakeAll();
      const col = x => { let n = 0; for (let y = 0; y < H - 4; y++) if (g.type[g.idx(x, y)] === WATER) n++; return n; };
      let far = -1; const crest = [];
      run(g, 150, 1, f => {
        const h = []; for (let x = 4; x < W - 4; x++) h.push(col(x));
        if (far < 0) { let s = 0; for (let k = h.length - 20; k < h.length; k++) s += h[k]; if (s / 20 >= D + 1) far = f; }
        if (f % 30 === 0) { let best = -1, bx = 0; for (let x = 30; x + 8 <= h.length; x++) { let s = 0; for (let k = 0; k < 8; k++) s += h[x + k]; if (s > best) { best = s; bx = x + 4; } } crest.push(bx); }
      });
      return { far, crest };
    };
    const rs = [1, 2, 3, 4].map(one);
    console.log(`  the far end of the tank rises at tick ${rs.map(r => r.far).join(' ')} (a wave takes ~70 to get there); crest every 0.5 s at ${rs.map(r => r.crest.join(',')).join(' / ')}`);
    // (the build before waves: the far end rose at tick 37-50, the water let down the tank by pressure faster than any wave)
    check('the far end waits for the wave (60+ ticks) and it gets there (within 150)', rs.every(r => r.far >= 60 && r.far <= 150));
    check('the crest gets 140+ cols down the tank within 2.5 s (it comes back after the far wall)', rs.every(r => Math.max(...r.crest) >= 140));
  },
  splash() {
    // a block of water dropped into a deep pool splashes: drops are thrown up well clear of the surface; a block of sand too
    const one = (t, seed) => {
      Sim.reseed(seed); const W = 200, H = 160, g = new Sim.Grid(W, H); g.windHold = 0;
      for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (y >= H - 4 || x < 4 || x >= W - 4) g.set(g.idx(x, y), STONE, g.ambAt(y)); else if (y >= 110) g.set(g.idx(x, y), WATER, g.ambAt(y));
      for (let y = 30; y < 40; y++) for (let x = 95; x < 105; x++) g.set(g.idx(x, y), t, g.ambAt(y));
      g.initAir(); for (let c = 0; c < g.hum.length; c++) g.hum[c] = g.cap[c]; g.wakeAll();
      let hi = 0, wide = 0;
      run(g, 240, 1, f => { for (let y = 0; y < 106; y++) for (let x = 4; x < W - 4; x++) { const i = g.idx(x, y); if (g.type[i] === WATER && g.vy[i] < 0) { hi = Math.max(hi, 110 - y); if (Math.abs(x - 100) > 15) wide++; } } });   // (drops on their way up)
      return { hi, wide };
    };
    const w = [1, 2, 3, 4].map(s => one(WATER, s)), s = [1, 2, 3, 4].map(s => one(SAND, s));
    console.log(`  water dropped 70 rows into a pool throws drops up to ${w.map(r => r.hi).join(' ')} rows over it (drops rising 15+ cols out, summed ${w.map(r => r.wide).join(' ')}); sand: ${s.map(r => r.hi).join(' ')} rows (${s.map(r => r.wide).join(' ')})`);
    // (a splash is chaotic: judged over the four drops, not each one)
    check('water falling into a pool splashes drops 10+ rows up (3 drops of 4 at least)', w.filter(r => r.hi >= 10).length >= 3);
    check('the splash throws drops out sideways (rising 15+ columns out, 10+ summed over the four)', w.reduce((a, r) => a + r.wide, 0) >= 10);
    check('sand falling into a pool splashes too', s.every(r => r.hi >= 8));
  },
  carry() {
    // floating ash and seeds dropped on a running stream ride off downstream; on a still pond they stay about where they fell
    const one = (flow, seed) => {
      Sim.reseed(seed); const W = 400, H = 100, g = new Sim.Grid(W, H); g.windHold = 0; g.hold = true;
      const bed = x => 60 + Math.round(x / 40);
      for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (y >= (flow ? bed(x) : 70) || x < 3 || (!flow && x >= W - 3)) g.set(g.idx(x, y), STONE, g.ambAt(y)); else if (y >= (flow ? bed(x) - 6 : 62)) g.set(g.idx(x, y), WATER, g.ambAt(y));
      g.initAir(); for (let c = 0; c < g.hum.length; c++) g.hum[c] = g.cap[c]; g.wakeAll();
      let gone = 0; const feed = () => { if (!flow) return; for (let y = 48; y < 54; y++) for (let x = 4; x < 7; x++) { const i = g.idx(x, y); if (g.type[i] === E) g.set(i, WATER); } for (let y = 0; y < H; y++) for (let x = W - 4; x < W; x++) { const i = g.idx(x, y), t = g.type[i]; if (t === ASH || t === SEED) gone++; if (t !== STONE) g.set(i, E); } };
      run(g, 600, 1, feed);   // the stream gets going
      const put = []; for (let k = 0; k < 12; k++) { const x = 60 + k * 4; let y = 0; while (g.type[g.idx(x, y + 1)] === E) y++; g.set(g.idx(x, y), k % 2 ? ASH : SEED); put.push(x); }
      const x0 = put.reduce((a, b) => a + b, 0) / put.length;
      run(g, 300, 1, feed);
      let s = 0, n = 0; for (let i = 0; i < g.type.length; i++) if (g.type[i] === ASH || g.type[i] === SEED) { s += i % W; n++; }
      return (s + gone * W) / (n + gone) - x0;   // (those carried off the end count as reaching it)
    };
    const run_ = [1, 2, 3, 4].map(s => one(true, s)), still = [1, 2, 3, 4].map(s => one(false, s));
    console.log(`  12 floaters, mean drift in 5 s: on a stream ${run_.map(d => d.toFixed(0)).join(' ')} cols, on a still pond ${still.map(d => d.toFixed(0)).join(' ')}`);
    check('a stream carries floating things 40+ cols downstream in 5 s', run_.every(d => d >= 40));   // (the build before waves: about 1)
    check('on a still pond they stay within 15 cols', still.every(d => Math.abs(d) <= 15));
  },
  waterfall() {
    // a fast stream running off a ledge shoots out clear of the cliff before it falls, rather than pouring straight down its face
    const one = seed => {
      Sim.reseed(seed); const W = 300, H = 140, g = new Sim.Grid(W, H); g.windHold = 0;
      for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (y >= H - 4 || x < 3 || (x < 150 && y >= 40 + Math.round(x / 6))) g.set(g.idx(x, y), STONE, g.ambAt(y));
      g.initAir(); for (let c = 0; c < g.hum.length; c++) g.hum[c] = g.cap[c]; g.wakeAll();
      let far = 0, n = 0; const hist = [];
      run(g, 900, 1, f => {
        for (let y = 20; y < 30; y++) for (let x = 4; x < 8; x++) { const i = g.idx(x, y); if (g.type[i] === E) g.set(i, WATER); }
        for (let y = 0; y < H; y++) for (let x = 3; x < W; x++) { const i = g.idx(x, y); if (y >= 110 && g.type[i] === WATER) g.set(i, E); }   // drain the plunge pool
        if (f > 300) for (let x = 150; x < W; x++) if (g.type[g.idx(x, 100)] === WATER) { far = Math.max(far, x - 150); hist.push(x - 150); }
      });
      hist.sort((a, b) => a - b); return { far, med: hist.length ? hist[hist.length >> 1] : 0 };
    };
    const rs = [1, 2, 3, 4].map(one);
    console.log(`  water leaving the ledge crosses row 100 (75 rows down) at a median ${rs.map(r => r.med).join(' ')} cols out from the cliff (farthest ${rs.map(r => r.far).join(' ')})`);
    check('a waterfall throws clear of its cliff (median 6+ cols out)', rs.every(r => r.med >= 6));
  },
  smoke() {
    const { SMOKE } = Sim.ids;
    // hot smoke climbs; smoke already at air temperature hangs about where it was let go
    const puff = T => { Sim.reseed(4); const W = 80, H = 160, g = new Sim.Grid(W, H); g.windHold = 0; for (let x = 0; x < W; x++) for (let y = H - 4; y < H; y++) g.set(g.idx(x, y), STONE); g.initAir();
      for (let y = 140; y < 146; y++) for (let x = 36; x < 44; x++) g.set(g.idx(x, y), SMOKE, T === null ? g.ambAt(y) : T);
      run(g, 90); let s = 0, n = 0; for (let i = 0; i < g.type.length; i++) if (g.type[i] === SMOKE) { s += (i / W) | 0; n++; } return 143 - s / Math.max(1, n); };
    const hot = puff(250), cold = puff(null);
    console.log(`  a puff of smoke after 1.5 s: hot smoke rose ${hot.toFixed(0)} rows, cool smoke ${cold.toFixed(0)}`);
    check('hot smoke rises faster than cool smoke', hot > 2 * Math.max(1, cold));
    // a fire in a closed room fills it with smoke from the ceiling down
    Sim.reseed(4); const W = 80, H = 60, g = new Sim.Grid(W, H); g.windHold = 0;
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (x < 2 || x >= W - 2 || y < 2 || y >= H - 4) g.set(g.idx(x, y), STONE);
    for (let y = 46; y < 56; y++) for (let x = 36; x < 44; x++) g.set(g.idx(x, y), WOOD);
    g.initAir(); g.set(g.idx(40, 45), FIRE);
    let up = 0, low = 0; run(g, 900, 30, () => { for (let i = 0; i < g.type.length; i++) if (g.type[i] === SMOKE) { const y = (i / W) | 0; if (y < 15) up++; else if (y >= 30) low++; } });
    console.log(`  a woodpile burning in a closed room, 15 s: smoke in the top quarter ${up}, in the bottom half ${low} (summed)`);
    check('smoke gathers under the ceiling', up > 2 * low);
  },
  fronts() {
    // R3: a cold front sent across a flat world. The air behind it is colder and the barometer higher, with a trough along the
    // front; the front moves east and builds a line of tall shower cloud that rains on the ground under it, far more cloud and
    // rain than the same world gets under one air mass
    const { W, H } = Sim.WORLD, X0 = 160, T = 40 * 60;
    const go = on => {
      Sim.reseed(3); const g = new Sim.Grid(W, H), top = Sim.flat(g); g.lightning = false; g.windHold = 0.2;
      g.clock = Sim.YEAR * 0.3 + Sim.DAY * 0.2; g.updateClimate();   // early summer, mid-morning
      if (on) g.sendFront(X0); else { g.fronts = false; g.massT.fill(0); g.massH.fill(0); }
      const r = { deep: 0, near: 0, far: 0, rain: 0, rainFar: 0, xs: [], dT: 0, dP: 0, trough: 0, n: 0 };
      const frontX = () => { for (let ax = 1; ax < g.AW; ax++) if (g.massT[ax - 1] < 0 && g.massT[ax] > 0) return ax * 4; return -1; };
      for (let f = 1; f <= T; f++) {
        const xf = on ? frontX() : X0 + 0.3 * f | 0;   // (off: the same strip the front would have crossed)
        const p0 = Array.from(g.precip);
        g.step();
        for (let x = 0; x < W; x++) { const d = g.precip[x] - p0[x]; if (Math.abs(x - xf) < 120) r.rain += d; else r.rainFar += d; }
        if (f % 120 || xf < 300 || xf > W - 300) continue;
        r.xs.push(xf); r.n++;
        for (let x = 0; x < W; x += 2) { let c = 0; for (let y = 0; y < top; y++) if (g.type[y * W + x] === CLOUD) c++; if (Math.abs(x - xf) < 120) { r.near += c; r.deep = Math.max(r.deep, c); } else r.far += c; }
        const air = x0 => { let s = 0, n = 0; for (let x = x0; x < x0 + 60; x++) for (let y = top - 30; y < top - 5; y++) { const i = y * W + x; if (g.type[i] === E) { s += g.temp[i]; n++; } } return s / n; };
        r.dT += air(xf + 150) - air(xf - 210); r.dP += g.pressureAt(xf - 180) - g.pressureAt(xf + 180);
        r.trough += Math.min(g.pressureAt(xf - 180), g.pressureAt(xf + 180)) - g.pressureAt(xf);
      }
      r.nearC = r.near / r.n / 120; r.farC = r.far / r.n / (W / 2 - 120);   // cloud cells per column sampled
      return r;
    };
    const on = go(true), off = go(false);
    const speed = (on.xs[on.xs.length - 1] - on.xs[0]) / ((on.xs.length - 1) * 120);
    console.log(`  front moved east at ${speed.toFixed(2)} cells/tick; warm side ${(on.dT / on.n).toFixed(1)}° warmer near the ground, cold side ${(on.dP / on.n).toFixed(1)} hPa higher, ${(on.trough / on.n).toFixed(1)} hPa trough at the front`);
    console.log(`  cloud per column: at the front ${on.nearC.toFixed(1)} (deepest ${on.deep}), elsewhere ${on.farC.toFixed(1)}; one air mass: ${off.nearC.toFixed(1)} (deepest ${off.deep}); rain under the front ${on.rain} drops (one air mass ${off.rain}), elsewhere ${on.rainFar} (${off.rainFar})`);
    check('the front drifts east', speed > 0.15 && speed < 0.45, speed.toFixed(2));
    check('the air behind a cold front is colder', on.dT / on.n > 3, (on.dT / on.n).toFixed(1) + '°');
    check('the barometer stands higher in the cold air, with a trough along the front', on.dP / on.n > 8 && on.trough / on.n > 1, `${(on.dP / on.n).toFixed(1)} hPa, trough ${(on.trough / on.n).toFixed(1)}`);
    check('the front builds tall cloud: 3+ times the cloud of elsewhere, deep enough to throw lightning (over 20 cells)', on.nearC > 3 * on.farC && on.nearC > 3 * off.nearC && on.deep > 20, `${on.nearC.toFixed(1)} vs ${on.farC.toFixed(1)} and ${off.nearC.toFixed(1)}, deepest ${on.deep}`);
    check('and rains under it: 3+ times as much as one air mass does', on.rain > 3 * Math.max(10, off.rain), `${on.rain} vs ${off.rain}`);
    // the bands hang off world columns, so a window anywhere sees the same air; a save keeps where they had drifted to
    const a = new Sim.Grid(W, 320), b = new Sim.Grid(W, 320); a.worldSeed = b.worldSeed = 77; a.fronts = b.fronts = true; a.massX = b.massX = 1234; a.ox = 3200; b.ox = 3200 + Sim.REGION;
    a.updateMasses(false); b.updateMasses(false);
    let same = true; for (let ax = Sim.REGION / 4; ax < a.AW; ax++) if (a.massT[ax] !== b.massT[ax - Sim.REGION / 4]) same = false;
    const c = new Sim.Grid(W, 320); a.massX = 2468.5; c.load(a.save());
    check('the air masses are the same wherever the window is, and a save keeps them', same && c.fronts && c.massX === 2468.5);
  },
  lightning() {
    // R3: a deep storm cloud strikes; the bolt goes for the highest thing within reach and for metal most of all; it lights dry
    // grass in the dry season far more often than in the wet, and it fuses sand
    const { METAL, GLASS, MGLASS, EMBER } = Sim.ids;
    const field = (ground, clock) => {
      Sim.reseed(9); const W = 200, H = 200, g = new Sim.Grid(W, H); g.windHold = 0; g.lightning = true; g.clock = clock; g.updateClimate();
      for (let y = H - 30; y < H; y++) for (let x = 0; x < W; x++) { const i = g.idx(x, y); if (y >= H - 4) g.set(i, STONE); else { g.set(i, ground === SAND ? SAND : DIRT); g.life[i] = (40 << 8) | 40; } }
      if (ground === PLANT) for (let x = 0; x < W; x++) for (let y = H - 33; y < H - 30; y++) { const i = g.idx(x, y); g.set(i, PLANT); g.life[i] = (40 << 8) | 1; }   // dry grass (low sap)
      g.initAir(); return g;
    };
    // a 40-deep cloud over the field strikes within a few seconds
    { const g = field(DIRT, Sim.YEAR * 0.5); for (let y = 40; y < 80; y++) for (let x = 60; x < 140; x++) g.set(g.idx(x, y), CLOUD); g.wakeAll();
      let at = -1; run(g, 600, 1, f => { if (at < 0 && g.strikes) at = f; });
      check('a deep storm cloud throws lightning', at > 0, at > 0 ? (at / 60).toFixed(1) + ' s' : 'never'); }
    { const g = field(DIRT, Sim.YEAR * 0.5); let flat = 0;   // with nothing standing up, it hits ground under the cloud
      for (let k = 0; k < 20; k++) { g.strike(100, 60); const p = g.bolts[g.bolts.length - 1].pts; if (Math.abs(p[p.length - 2] - 100) <= 24) flat++; }
      for (let y = 140; y < 170; y++) g.set(g.idx(118, y), METAL);   // a mast 30 tall, 18 columns off
      let rod = 0; for (let k = 0; k < 20; k++) { g.strike(100, 60); const p = g.bolts[g.bolts.length - 1].pts; if (g.type[g.idx(p[p.length - 2], p[p.length - 1])] === METAL) rod++; }
      console.log(`  strikes under the cloud: ${flat}/20 on open ground within reach; with a metal mast 18 columns off, ${rod}/20 hit the mast`);
      check('a lightning rod takes the strikes', flat === 20 && rod >= 18, `${rod}/20`); }
    const fires = clock => { let lit = 0;   // a fresh field for each strike: lit if the grass round where it hit has burned
      for (let k = 0; k < 20; k++) { const g = field(PLANT, clock), grass = () => { let n = 0; for (let y = 160; y < 172; y++) for (let x = 80; x < 120; x++) if (g.type[g.idx(x, y)] === PLANT) n++; return n; };
        Sim.reseed(100 + k); const n0 = grass(); g.strike(100, 60); run(g, 60); if (grass() < n0 - 6) lit++; }
      return lit; };
    const dry = fires(Sim.YEAR * 0.5), wet = fires(Sim.YEAR * 0.1);
    console.log(`  strikes on grass that set it alight: ${dry}/20 at the height of the dry season, ${wet}/20 in spring`);
    check('lightning starts fires in the dry season, seldom in the wet', dry >= 16 && wet <= 8, `${dry} vs ${wet}`);
    { const g = field(SAND, Sim.YEAR * 0.5); for (let k = 0; k < 5; k++) g.strike(40 + k * 30, 60); run(g, 120);
      const glass = census(g, Sim.EL).Glass || 0, molten = census(g, Sim.EL)['Molten glass'] || 0;
      check('it fuses sand to glass', glass + molten > 0, `${glass} glass, ${molten} molten`); }
  },
  landslide() {
    // R4: a hillside of soil on a slope of rock rising 3 in 2. Damp, it stands; soaked toward the rock, it slides off as a slab, baring the rock
    // and running out past the foot; tree roots through it hold it
    const hill = (wet, roots) => {
      Sim.reseed(7); const W = 320, H = 180, g = new Sim.Grid(W, H), floor = H - 10;
      for (let x = 0; x < W; x++) {
        const rock = x < 60 ? floor - 100 : x < 127 ? Math.round(floor - 100 + (x - 60) * 1.5) : floor;
        for (let y = rock; y < H; y++) g.set(g.idx(x, y), STONE);
        for (let k = 1; k <= 8; k++) { const i = g.idx(x, rock - k); g.set(i, roots && x >= 60 && x < 127 && x % 6 === 0 ? ROOT : DIRT); g.life[i] = (40 << 8) | (wet ? (k <= 7 ? 240 : 150) : 60); }
      }
      g.initAir();
      let peak = 0;
      run(g, 1800, 4, () => { let n = 0; for (let i = 0; i < g.type.length; i++) if (g.type[i] === DIRT && g.vy[i] >= Sim.SLIP_TAG) n++; peak = Math.max(peak, n); });
      let bare = 0, reach = 0;
      for (let x = 60; x < 127; x++) for (let y = 0; y < H; y++) { const t = g.type[g.idx(x, y)]; if (t === E || t === WATER) continue; if (t === STONE) bare++; break; }
      for (let x = 127; x < W; x++) if (g.type[g.idx(x, floor - 9)] === DIRT) reach = x - 127;
      return { slides: g.slides, bare, reach, peak };
    };
    const damp = hill(false), soaked = hill(true), rooted = hill(true, true);
    const fmt = r => `${r.slides} slides, ${r.bare}/67 columns of bare rock, toe ${r.reach} cells past the foot, ${r.peak} cells moving at once at most`;
    console.log(`  damp: ${fmt(damp)}\n  soaked toward the rock: ${fmt(soaked)}\n  soaked, with roots through it: ${fmt(rooted)}`);
    check('a damp hillside stands', damp.slides === 0 && damp.bare === 0, fmt(damp));
    check('a soaked one slides off as a slab: 20+ columns of rock bared, 100+ cells moving together, the toe 12+ cells out', soaked.bare >= 20 && soaked.peak >= 100 && soaked.reach >= 12, fmt(soaked));
    check('roots hold it: a third of the bare rock or less', rooted.bare <= soaked.bare / 3, `${rooted.bare} vs ${soaked.bare}`);
  },
  frost() {
    // R4: a cliff high on a hill (90 rows over the hills' base). Through an autumn and winter its face cracks in the freezes and sheds
    // rubble to its foot; the same rock under soil doesn't crack, and in summer nothing does
    const { RUBBLE } = Sim.ids;
    const cliff = (p0, days) => {
      Sim.reseed(5); const W = 200, H = 640, g = new Sim.Grid(W, H), top = g.skyY - 90;
      g.clock = Sim.YEAR * p0; g.updateClimate(); g.resetTemp();
      for (let y = top; y < H; y++) for (let x = 0; x < W; x++) if (!(x >= 140 && y < top + 60)) g.set(g.idx(x, y), STONE, g.ambAt(y));
      for (let x = 80; x <= 120; x++) for (let y = top - 6; y < top; y++) { const i = g.idx(x, y); g.set(i, DIRT, g.ambAt(y)); g.life[i] = (40 << 8) | 150; }
      g.initAir(); run(g, Math.round(days * Sim.DAY));
      const crack = (x0, x1, y0, y1) => { let s = 0, n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = g.idx(x, y); if (g.type[i] === STONE) { s += ((g.life[i] >> 8) & 127) * 2; n++; } } return n ? s / n : 0; };
      let scree = 0; for (let y = top + 40; y < top + 60; y++) for (let x = 140; x < 160; x++) if (g.type[g.idx(x, y)] === RUBBLE) scree++;
      return { face: crack(139, 140, top, top + 60), soil: crack(81, 120, top, top + 1), broke: g.frostBroke, scree };
    };
    const winter = cliff(0.62, 4), summer = cliff(0.2, 2);
    console.log(`  autumn to spring: face cracked ${winter.face.toFixed(0)}/255 on average, ${winter.broke} cells broke off, ${winter.scree} lie at the foot; rock under soil ${winter.soil.toFixed(0)}; summer: face ${summer.face.toFixed(0)}, ${summer.broke} broke`);
    check('a cold-country cliff face cracks and sheds rubble to its foot over a winter', winter.face > 40 && winter.broke >= 5 && winter.scree >= 3, `${winter.face.toFixed(0)}, ${winter.broke} broke, ${winter.scree} at the foot`);
    check('rock under soil stays sound, and nothing cracks in summer', winter.soil < 5 && summer.face === 0 && summer.broke === 0, `${winter.soil.toFixed(1)}, ${summer.face.toFixed(1)}`);
  },
  beams() {
    // structural strength: a span between two stone piers, `d` rows thick, with `load` rows of sand on it. Measured after 15 s:
    // how much of it is still up at its own height or within `sagged` rows of it, and how far it sags
    const { BRICK, METAL, RUBBLE } = Sim.ids;
    const span = (m, L, d, { load = 0, rise = 0, temp, ticks = 900, after } = {}) => {
      Sim.reseed(5); const W = L + 60, H = 120, g = new Sim.Grid(W, H); g.windHold = 0;
      const put = (x, y, t) => g.set(g.idx(x, y), t, g.ambAt(y));
      for (let x = 0; x < W; x++) for (let y = H - 4; y < H; y++) put(x, y, STONE);
      const a = 20, b = 21 + L, top = 60;   // (the span is laid as the brush lays it: laid stone is a building material, the piers are the ground's own rock)
      for (let y = top - rise - d; y < H - 4; y++) for (let k = 0; k < 6; k++) { put(a - k, y, STONE); put(b + k, y, STONE); }
      const cells = [];
      for (let x = a + 1; x < b; x++) {
        const u = (x - a) / (b - a) * 2 - 1, yb = Math.round(top + d - 1 - rise * Math.sqrt(Math.max(0, 1 - u * u)));   // the underside: flat, or a semicircle rising `rise`
        for (let y = yb - d + 1; y <= yb; y++) { g.lay(g.idx(x, y), m, g.ambAt(y)); cells.push([x, y]); }
        for (let k = 1; k <= load; k++) put(x, yb - d + 1 - k, SAND);
      }
      g.initAir(); g.wakeAll();
      const heat = () => { if (temp !== undefined) for (let i = 0; i < g.type.length; i++) if (g.type[i] === m) g.temp[i] = temp; };
      for (let f = 0; f < ticks; f++) { heat(); g.step(); }
      if (after) { after(g, a, b, top); for (let f = 0; f < ticks; f++) { heat(); g.step(); } }
      let up = 0, sag = 0, n = 0;
      for (const [x, y] of cells) { let k = 0; while (k <= 12 && g.type[g.idx(x, y + k)] !== m) k++; if (k <= 12) { up++; sag = Math.max(sag, k); } n++; }
      let rubble = 0; for (let i = 0; i < g.type.length; i++) if (g.type[i] === RUBBLE) rubble++;
      return { up, n, sag, whole: up === n, rubble };
    };
    const f = r => `${r.up}/${r.n} up, sags ${r.sag}`;
    const w1 = span(WOOD, 24, 1), w1s = span(WOOD, 24, 1, { load: 3 }), w2s = span(WOOD, 24, 2, { load: 3 }), wl = span(WOOD, 80, 1);
    console.log(`  wood plank, 24 wide: bare ${f(w1)}; under 3 rows of sand ${f(w1s)}; two thick under the same sand ${f(w2s)}; 80 wide ${f(wl)}`);
    check('a 24-cell wooden plank carries itself without sagging', w1.whole && w1.sag === 0);
    check('the same plank breaks under 3 rows of sand, and a plank twice as thick carries it', !w1s.whole && w2s.whole && w2s.sag <= 2);
    check('a wooden plank 80 cells long gives way', !wl.whole);
    const sf = span(STONE, 30, 3), sa = span(STONE, 30, 2, { rise: 15 }), bf = span(BRICK, 30, 3, { load: 4 }), ba = span(BRICK, 30, 3, { rise: 8, load: 4 });
    console.log(`  30 wide: flat stone slab 3 thick ${f(sf)} (${sf.rubble} rubble); stone arch 2 thick ${f(sa)}; flat brick under 4 rows of sand ${f(bf)}; a brick arch rising 8 under the same sand ${f(ba)}`);
    check('a flat stone slab 30 wide cracks and falls; a stone arch the same width stands', !sf.whole && sf.rubble > 0 && sa.whole);
    check('brick: a flat span 30 wide fails under sand, an arch carries it', !bf.whole && ba.whole);
    const m1 = span(METAL, 40, 1), mh = span(METAL, 40, 2, { temp: 600 }), mc = span(METAL, 40, 2), mx = span(METAL, 40, 2, { temp: 850 });
    console.log(`  metal, 40 wide: one thick ${f(m1)}; two thick ${f(mc)}, at 600° ${f(mh)}, at 850° ${f(mx)} (the rest more than 12 rows down)`);
    check('a thin metal span sags into a curve but holds', m1.whole && m1.sag >= 2 && m1.sag <= 8);
    check('two thick it stays straight; heated it sags, and red hot it droops right down', mc.sag === 0 && mh.sag >= 3 && mh.whole && mx.up < mx.n / 2);
    // load added later: pour sand onto a wooden bridge that carried itself and it bows, then gives way
    let before = null;
    const pour = span(WOOD, 32, 2, { ticks: 600, after: (g, a, b, top) => { before = 0; for (let x = a + 1; x < b; x++) if (g.type[g.idx(x, top + 1)] === WOOD) before++; for (let x = a + 1; x < b; x++) for (let k = 1; k <= 12; k++) g.set(g.idx(x, top - k), SAND); } });
    console.log(`  32-wide wooden bridge two thick: ${before}/32 columns level before, then 12 rows of sand poured on: ${f(pour)}`);
    check('sand poured on a bridge that stood brings it down', before === 32 && !pour.whole);
    // a wooden raft floats on a lake: water under it bears it
    Sim.reseed(6); const g = new Sim.Grid(140, 60); g.windHold = 0;
    for (let x = 0; x < 140; x++) for (let y = 34; y < 60; y++) g.set(g.idx(x, y), y >= 56 || x < 5 || x >= 135 ? STONE : WATER);
    for (let x = 20; x < 120; x++) g.lay(g.idx(x, 33), WOOD);
    g.initAir(); g.wakeAll(); for (let f = 0; f < 600; f++) g.step();
    let raft = 0; for (let x = 0; x < 140; x++) if (g.type[g.idx(x, 33)] === WOOD) raft++;
    console.log(`  a raft of wood 100 long on a lake: ${raft} cells still floating level`);
    check('a wooden raft floats on water, not a span', raft === 100);
  },
};
const seasonAt = clock => ['Spring', 'Summer', 'Autumn', 'Winter'][(((clock % Sim.YEAR) / Sim.YEAR) * 4) | 0];

const pick = process.argv.slice(2);
for (const [name, fn] of Object.entries(scenarios)) { if (pick.length && !pick.includes(name)) continue; console.log(`# ${name}`); const t = Date.now(); fn(); console.log(`  (${((Date.now() - t) / 1000).toFixed(1)} s)`); }
if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
