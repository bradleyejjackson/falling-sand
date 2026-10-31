// Stage 2 and 3 checks, and later ones. Each scenario builds a small world, runs it, and measures what it should.
// usage: node tools/validate.js [scenario...]   (default: all)
const { loadSim, census } = require('./load');
const Sim = loadSim(process.env.SIMFILE);
const { E, DIRT, STONE, WATER, TIP, SEED, WOOD, ROOT, LITTER, ASH, SNOW, PLANT, SAND, CLOUD, FIRE, LAVA, OIL, SALT, BRINE, ACID, SMOKE } = Sim.ids;
const MIN = 3600;   // ticks in a minute at 60 fps
let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); if (!ok) failed++; };

// a flat plot: stone floor, `depth` rows of dirt at moisture m, air above
function plot(W, H, depth, m, seed = 7) {
  Sim.reseed(seed);
  const g = new Sim.Grid(W, H);
  for (let y = H - depth; y < H; y++) for (let x = 0; x < W; x++) { const i = g.idx(x, y); if (y >= H - 3) g.set(i, STONE); else { g.set(i, DIRT); g.life[i] = (Sim.NREF << 8) | m; } }
  g.initAir(); if (!m) for (let c = 0; c < g.hum.length; c++) g.hum[c] *= 0.3;   // dry ground under dry air
  return g;
}
const moisture = (g, y0, y1) => { let s = 0, n = 0; for (let i = y0 * g.W; i < y1 * g.W; i++) if (g.type[i] === DIRT) { s += g.life[i] & 255; n++; } return n ? s / n : 0; };
const run = (g, n, every, fn) => { for (let f = 1; f <= n; f++) { g.step(); if (every && f % every === 0) fn(f); } };

const scenarios = {
  fish() {
    // fish in a pond live on through two years, spawning in spring; a pond that dries out, or one kept frozen solid, kills them; birds
    // take the ones at the surface
    const { FISH, REED } = Sim.ids;
    const pond = (fate) => {
      Sim.reseed(13); const W = 200, H = 80, g = new Sim.Grid(W, H); g.windHold = 0;
      for (let y = 40; y < H; y++) for (let x = 0; x < W; x++) { const i = g.idx(x, y), bowl = y < 60 && x >= 30 && x < 170; if (y >= 76) { g.set(i, STONE); g.life[i] = 1; } else if (!bowl) { g.set(i, DIRT); g.life[i] = (Sim.NREF << 8) | 240; } else if (y >= 44) g.set(i, WATER); }
      for (let x = 34; x < 166; x += 6) for (let y = 52; y < 60; y++) g.set(g.idx(x, y), REED);
      for (let k = 0; k < 12; k++) { const i = g.idx(40 + k * 10, 50); g.set(i, FISH); g.life[i] = 160 | (1 << 8); g.vx[i] = 1; }
      g.initAir(); let lo = 99, hi = 0, spawned = 0;
      for (let f = 0; f < (fate === 'live' ? 2 : 0.5) * Sim.YEAR; f++) {
        if (fate === 'dry' && f % 30 === 0) for (let x = 30; x < 170; x++) for (let y = 40; y < 60; y++) { const i = g.idx(x, y); if (g.type[i] === WATER) { g.set(i, E); break; } }
        if (fate === 'live' && f % 600 === 0) for (let x = 30; x < 170; x++) { const i = g.idx(x, 43); if (g.type[i] === E) g.set(i, WATER); }   // (topped up: no rain in a box)
        if (fate === 'ice' && f % 30 === 0) for (let i = 0; i < g.type.length; i++) if (g.type[i] === WATER || g.type[i] === FISH) g.temp[i] = Math.min(g.temp[i], -20);
        g.step();
        if (f % 3600 === 0) { const c = g.census(); lo = Math.min(lo, c.fish); hi = Math.max(hi, c.fish); }
        if (f % 600 === 0) for (let i = 0; i < g.type.length; i++) if (g.type[i] === FISH && (g.life[i] & Sim.EGG)) spawned++;
      }
      return { fish: g.census().fish, lo, hi, spawned };
    };
    const live = pond('live'), dry = pond('dry'), ice = pond('ice');
    console.log(`  a pond, two years: ${live.fish} fish (between ${live.lo} and ${live.hi} at the daily counts, eggs seen ${live.spawned}); dried out: ${dry.fish}; frozen solid: ${ice.fish}`);
    check('fish live on in a pond for two years, spawning', live.fish >= 6 && live.lo >= 3 && live.spawned > 0);
    check('a pond that dries out or freezes solid kills its fish', dry.fish === 0 && ice.fish === 0);
  },
  moss() {
    // bare rock in damp air greens over with moss within a couple of years and weathers a thin soil out of it (scree fastest); in dry
    // air it stays bare
    const { MOSS, RUBBLE } = Sim.ids;
    const crag = wet => {
      Sim.reseed(9); const W = 200, H = 80, g = new Sim.Grid(W, H); g.windHold = 0;
      for (let y = 50; y < H; y++) for (let x = 0; x < W; x++) { const i = g.idx(x, y); if (y < 53 && x >= 100) g.set(i, RUBBLE, g.ambAt(y)); else { g.set(i, STONE, g.ambAt(y)); g.life[i] = 1; } }
      g.initAir(); const damp = () => { for (let c = 0; c < g.hum.length; c++) g.hum[c] = g.cap[c] * (wet ? 0.85 : 0.2); };
      for (let f = 0; f < 2 * Sim.YEAR; f++) { if (f % 500 === 0) damp(); g.step(); }
      let moss = 0, rock = 0, scree = 0; for (let x = 0; x < W; x++) for (let y = 40; y < 56; y++) { const t = g.type[g.idx(x, y)]; if (t === MOSS) moss++; else if (t === DIRT) { if (x < 100) rock++; else scree++; } }
      return { moss, rock, scree };
    };
    const wet = crag(true), dry = crag(false);
    console.log(`  damp air, two years: ${wet.moss} moss, ${wet.rock} cells of soil on the rock and ${wet.scree} on the scree; dry air: ${dry.moss} moss, ${dry.rock + dry.scree} soil`);
    check('moss takes bare rock in damp air and weathers soil out of it, faster on scree', wet.moss + wet.rock + wet.scree >= 100 && wet.rock + wet.scree >= 20 && wet.scree > wet.rock);
    check('in dry air bare rock stays bare', dry.moss + dry.rock + dry.scree === 0);
  },
  choke() {
    // a fire needs air: the same grass fire burns less of the grass in a sealed cave than in a pit open to the sky, and the cave
    // ends up full of smoke with its fire out (what got hot with no air left charred)
    const room = open => {
      Sim.reseed(3); const W = 120, H = 80, g = new Sim.Grid(W, H); g.clock = Sim.YEAR * 0.3; g.updateClimate(); g.hold = true; g.windHold = 0;
      for (let y = 30; y < H; y++) for (let x = 20; x < 100; x++) { const i = g.idx(x, y), inside = y >= 50 && y < 67 && x >= 33 && x < 87; if (!inside && !(open && y < 50 && x >= 33 && x < 87)) { g.set(i, STONE, g.ambAt(y)); g.life[i] = 1; } }   // (a cave in the rock, or a pit open to the sky)   // (settled)
      for (let y = 57; y < 67; y++) for (let x = 33; x < 87; x++) { const i = g.idx(x, y); if (y >= 60) { g.set(i, DIRT, g.ambAt(y)); g.life[i] = (40 << 8) | 20; } else g.set(i, PLANT, g.ambAt(y)); }
      g.initAir(); g.hum.fill(0); g.wakeAll(); for (let x = 40; x < 44; x++) g.set(g.idx(x, 56), FIRE);
      run(g, 2 * MIN);
      const c = census(g, Sim.EL); return { ash: c.Ash || 0, char: c.Charcoal || 0, fire: (c.Fire || 0) + (c.Ember || 0), smoke: c.Smoke || 0 };
    };
    const shut = room(false), open = room(true);
    console.log(`  sealed: ${shut.ash} ash, ${shut.char} charcoal, ${shut.fire} flames and embers, ${shut.smoke} smoke; open: ${open.ash} ash, ${open.char} charcoal, ${open.fire} flames and embers, ${open.smoke} smoke`);
    check('a sealed cave\'s fire chokes: less burns to ash than in the open pit, more chars, it goes out, and the cave stays full of smoke', shut.ash < open.ash && shut.char > open.char && shut.fire <= 10 && shut.smoke >= 80 && open.smoke < 50);
  },
  smokehurt() {
    // smoke pooled under a roof kills the grass and the rabbits under it; out in the open it rises away and they live
    const { RABBIT } = Sim.ids;
    const yard = roof => {
      const g = plot(160, 90, 20, 120); g.clock = Sim.YEAR * 0.3; g.updateClimate(); g.hold = true; g.windHold = 0;
      for (let x = 20; x < 140; x++){ const i = g.idx(x, 69); g.set(i, PLANT); g.life[i] = (200 << 8) | 1; }
      if (roof) { for (let x = 10; x < 150; x++) for (let y = 50; y < 52; y++){ const i = g.idx(x, y); g.set(i, STONE); g.life[i] = 1; } for (let y = 50; y < 70; y++) for (const x of [10, 11, 148, 149]) { const i = g.idx(x, y); g.set(i, STONE); g.life[i] = 1; } }
      for (let x = 30; x < 130; x += 20) { const i = g.idx(x, 68); g.set(i, RABBIT); g.life[i] = 200; }
      for (let f = 0; f < MIN; f++) { g.step(); if (f % 10 === 0) for (let x = 40; x < 120; x += 8) { const i = g.idx(x, 55); if (g.type[i] === E) g.set(i, SMOKE, 30); } }
      const c = census(g, Sim.EL); return { grass: c.Plant || 0, rabbits: c.Rabbit || 0 };
    };
    const under = yard(true), out = yard(false);
    console.log(`  under a roof: ${under.grass} grass, ${under.rabbits} rabbits left; in the open: ${out.grass} grass, ${out.rabbits} rabbits`);
    check('smoke trapped under a roof kills grass and rabbits that live in the open', under.grass < 0.5 * out.grass && under.rabbits < out.rabbits && out.rabbits >= 4);
  },
  acidrain() {
    // a volcano's fumes sour the clouds they reach, and sour rain burns leaves and grass and leaches the soil it falls on; plain rain doesn't
    const { FUMES, CLOUD } = Sim.ids;
    const shower = sour => {
      const g = plot(160, 120, 20, 120); g.clock = Sim.YEAR * 0.3; g.updateClimate(); g.hold = true; g.windHold = 0;
      for (let x = 0; x < 160; x++){ const i = g.idx(x, 99); g.set(i, PLANT); g.life[i] = (200 << 8) | 1; }
      const rich = () => { let s = 0; for (let x = 0; x < 160; x++) for (let y = 100; y < 104; y++) s += g.life[g.idx(x, y)] >> 8; return s; }, r0 = rich();
      let fumed = 0;
      for (let f = 0; f < MIN; f++) { g.step();
        if (f % 4 === 0) for (let x = 20; x < 140; x += 3) { const i = g.idx(x, 20); if (g.type[i] === E) { g.set(i, CLOUD, 5); g.hum[g.ac(x, 20)] = g.cap[g.ac(x, 20)] * 1.5; } }
        if (sour && f % 4 === 2) for (let x = 20; x < 140; x += 6) { const i = g.idx(x, 22); if (g.type[i] === E) g.set(i, FUMES); } }
      for (let i = 0; i < g.type.length; i++) if (g.type[i] === CLOUD && (g.life[i] & 2)) fumed++;
      return { made: g.made[Sim.ids.ACID], leach: r0 - rich(), fumed, rain: g.precip.reduce((a, b) => a + b, 0) };
    };
    const sour = shower(true), plain = shower(false);
    // and a drop of it on a blade of grass burns its sap; on stone it is soon just water
    const h = plot(40, 40, 10, 120); h.hold = true; const b = h.idx(20, 29); h.set(b, PLANT); h.life[b] = (200 << 8) | 1;
    for (let k = 0; k < 4; k++) { const a = h.idx(20, 28); h.set(a, ACID); h.life[a] = 20; for (let f = 0; f < 40 && h.type[a] === ACID; f++) h.step(); }
    const sap = h.type[b] === PLANT ? h.life[b] >> 8 : 0;
    console.log(`  sour: ${sour.rain} drops, ${sour.made} of them acid, ${sour.leach} nutrients lost, ${sour.fumed} sour cloud cells; plain: ${plain.rain} drops, ${plain.made} acid, ${plain.leach} lost; four drops on a blade of grass leave its sap at ${sap} of 200`);
    check('fumes sour the clouds, and their rain falls as weak acid that leaches the soil more than plain rain', sour.made >= 50 && plain.made === 0 && sour.leach > plain.leach + 100);
    check('acid rain burns the sap out of the grass it lands on', sap <= 120);
  },
  peat() {
    // litter lying in waterlogged ground packs down into peat instead of rotting; the same litter on damp (not soaked) ground rots to dirt
    const { PEAT, LITTER } = Sim.ids;
    const g = plot(200, 80, 20, 0); g.clock = Sim.YEAR * 0.3; g.updateClimate(); g.hold = true;
    for (let y = 60; y < 77; y++) for (let x = 0; x < 200; x++) { const i = g.idx(x, y); if (g.type[i] === DIRT) g.life[i] = (Sim.NREF << 8) | (x < 100 ? 240 : 120); }
    for (let x = 10; x < 90; x += 2) { g.set(g.idx(x, 59), LITTER); g.set(g.idx(x + 100, 59), LITTER); }
    for (let x = 0; x < 100; x++) for (let y = 55; y < 59; y++) g.set(g.idx(x, y), WATER);   // the bog: soaked ground with a pond over it
    for (let f = 0; f < 2 * Sim.DAY; f++) { g.step(); if (f % 64 === 0) for (let x = 0; x < 100; x++) for (let y = 60; y < 64; y++) { const i = g.idx(x, y); if (g.type[i] === DIRT) g.life[i] = (g.life[i] & 0xff00) | 240; } }
    let peat = 0, left = 0, right = 0; for (let y = 0; y < 80; y++) for (let x = 0; x < 200; x++) { const t = g.type[g.idx(x, y)]; if (t === PEAT) { peat++; if (x < 100) left++; else right++; } }
    const litter = census(g, Sim.EL).Litter || 0;
    console.log(`  peat ${peat} (bog ${left}, damp ground ${right}), litter left ${litter}`);
    check('litter in the bog turns to peat; on damp ground it rots (no peat there)', left >= 25 && right === 0);
  },
  peatfire() {
    // dry peat buried under dirt, lit at one end, smoulders on for days and creeps through the bed underground; a soaked bed beside it
    // doesn't take it; burnt-out peat is ash
    const { PEAT } = Sim.ids;
    const g = plot(240, 80, 30, 40); g.clock = Sim.YEAR * 0.3; g.updateClimate(); g.hold = true;
    for (let y = 60; y < 70; y++) for (let x = 20; x < 220; x++) { const i = g.idx(x, y); g.set(i, PEAT); g.life[i] = x < 120 ? 20 : 220; }
    for (let y = 60; y < 70; y++) for (let x = 118; x < 122; x++) g.set(g.idx(x, y), STONE);   // (a wall between the dry bed and the wet one, so water doesn't cross)
    for (let y = 60; y < 70; y++) { const i = g.idx(20, y); g.temp[i] = 400; }
    const burning = () => { let n = 0, far = 0; for (let y = 60; y < 70; y++) for (let x = 20; x < 220; x++) { const i = g.idx(x, y); if (g.type[i] === PEAT && (g.life[i] >> 8)) { n++; far = Math.max(far, x); } } return { n, far }; };
    run(g, Sim.DAY);
    const d1 = burning(); run(g, 2 * Sim.DAY); const d3 = burning();
    let ash = 0, wet = 0; for (let y = 60; y < 70; y++) for (let x = 20; x < 220; x++) { const t = g.type[g.idx(x, y)]; if (t === ASH && x < 120) ash++; if (x >= 122 && t === PEAT && !(g.life[g.idx(x, y)] >> 8)) wet++; }
    console.log(`  after a day: ${d1.n} cells smouldering, out to column ${d1.far}; after three: ${d3.n}, out to ${d3.far}; ${ash} ash; ${wet}/980 of the wet bed unburnt`);
    check('the fire is still smouldering after three days and has crept on through the dry bed', d1.n >= 10 && d3.n >= 10 && d3.far > d1.far + 3 && d3.far < 120);
    check('burnt peat is ash, and the soaked bed beside it never caught', ash >= 10 && wet === 980);
  },
  dust() {
    // a steady wind over dry bare dirt lifts it as dust, which comes down downwind; damp dirt, or dirt under grass, stays put
    const { DUST } = Sim.ids;
    const field = (m, grass) => {
      const g = plot(360, 120, 20, m); g.clock = Sim.YEAR * 0.4; g.updateClimate(); g.hold = true; g.windHold = 0.6;
      if (grass) for (let x = 0; x < 360; x++) { const i = g.idx(x, 99); g.set(i, PLANT); g.life[i] = (200 << 8) | 1; }
      const dirt0 = census(g, Sim.EL).Dirt; let peak = 0;
      for (let f = 0; f < 3 * MIN; f++) { g.step(); if (f % 300 === 0) peak = Math.max(peak, census(g, Sim.EL).Dust || 0); }
      return { lost: dirt0 - census(g, Sim.EL).Dirt, peak };
    };
    const dry = field(0, false), damp = field(120, false), sward = field(0, true);
    console.log(`  dry bare dirt: ${dry.lost} cells blown off, up to ${dry.peak} dust in the air; damp: ${damp.lost}, ${damp.peak}; under grass: ${sward.lost}, ${sward.peak}`);
    check('a strong wind blows dust off dry bare dirt', dry.peak >= 20 && dry.lost >= 50);
    check('damp dirt and dirt under grass stay put', damp.peak === 0 && sward.peak === 0);
  },
  coal() {
    // a generated world has seams of coal deep in its rock; coal burns, slowly, to ember
    const { COAL } = Sim.ids;
    const g = new Sim.Grid(Sim.WORLD.W, Sim.WORLD.H); Sim.generate(g, 12345, Sim.WORLD.WIDE, 2560);
    let coal = 0, shallow = 0; for (let x = 0; x < g.W; x++) { let s = 0; while (s < g.H && (g.type[g.idx(x, s)] === E || Sim.EL[g.type[g.idx(x, s)]].kind === 'gas')) s++; for (let y = s; y < g.H; y++) if (g.type[g.idx(x, y)] === COAL) { coal++; if (y - s < 30) shallow++; } }
    const h = new Sim.Grid(40, 40); for (let y = 20; y < 40; y++) for (let x = 0; x < 40; x++) h.set(h.idx(x, y), COAL); h.initAir();
    for (let x = 10; x < 30; x++) h.set(h.idx(x, 19), FIRE); for (let f = 0; f < 600; f++) { h.step(); if (f % 30 === 0) for (let x = 10; x < 30; x++) if (h.type[h.idx(x, 19)] === E) h.set(h.idx(x, 19), FIRE); }
    const burnt = 800 - (census(h, Sim.EL).Coal || 0);
    console.log(`  ${coal} cells of coal in the window (${shallow} within 30 of the surface); ${burnt} of 800 caught in 10 s of fire`);
    check('coal seams lie deep in a generated world', coal >= 1000 && shallow === 0);
    check('coal catches from a fire, slowly', burnt >= 3 && burnt <= 200);
  },
  vigour() {
    // a tree grows to a size set by its sun and soil together: on rich open ground a giant, on poor soil a small tree, and under
    // an overhang (shade) a stunted one however rich the soil. The soil is kept watered so only light and nutrients differ.
    Sim.reseed(7);
    const W = 360, H = 200, D = 40, g = new Sim.Grid(W, H), plots = [['poor', 15, false], ['rich', 180, false], ['shaded rich', 180, true]], PW = W / plots.length;
    for (let y = H - D; y < H; y++) for (let x = 0; x < W; x++) { const i = g.idx(x, y); if (y >= H - 3) g.set(i, STONE); else { g.set(i, DIRT); g.life[i] = (plots[(x / PW) | 0][1] << 8) | 160; } }
    g.initAir();
    const xs = plots.map((p, k) => Math.round(PW * (k + 0.5)));
    plots.forEach(([, , roof], k) => { g.set(g.idx(xs[k], H - D - 1), TIP); if (roof) for (let x = xs[k] - 45; x <= xs[k] + 45; x++) for (let y = H - D - 24; y <= H - D - 22; y++) { const i = g.idx(x, y); g.set(i, STONE); g.life[i] |= 1; } });   // an overhang of the hills' rock (settled, so it holds)
    run(g, 2 * Sim.YEAR / 8, 1, f => { if (f % 64) return; for (let y = H - D; y < H - 3; y += 7) for (let x = f % 3; x < W; x += 3) { const i = g.idx(x, y); if (g.type[i] === DIRT && (g.life[i] & 255) < 120) g.life[i] = (g.life[i] & 0xff00) | 160; } });
    const size = x => { const t = g.trees.find(t => t.x === x); if (!t) return { h: 0, w: 0, trunk: 0, sun: 0, vig: 0 }; let top = t.y, x0 = x, x1 = x; for (const [i, c] of t.cells) { if (t.segs[c >> 1].root) continue; top = Math.min(top, (i / W) | 0); x0 = Math.min(x0, i % W); x1 = Math.max(x1, i % W); } return { h: t.y - top + 1, w: x1 - x0 + 1, trunk: t.segs[0].len, sun: t.sun, vig: g.vigour(t) }; };
    const [poor, rich, shade] = xs.map(size);
    console.log('  ' + plots.map(([n], k) => { const s = [poor, rich, shade][k]; return `${n}: ${s.h} tall (trunk ${s.trunk.toFixed(0)}), ${s.w} wide, sun ${s.sun.toFixed(2)}, vigour ${s.vig.toFixed(2)}`; }).join('; '));
    check('a tree on rich open ground grows half as tall again as one on poor soil', rich.h >= 1.5 * poor.h, `${rich.h} vs ${poor.h}`);
    // (its limbs stop at the rock: one that would push a branch it carries into it stops too)
    check('a tree on rich soil in the shade stays stunted (trunk under 0.6 of the open one)', shade.trunk > 0 && shade.trunk < 0.6 * rich.trunk && shade.h < 0.6 * rich.h && shade.sun < 0.5, `trunk ${shade.trunk.toFixed(0)} vs ${rich.trunk.toFixed(0)}, ${shade.h} vs ${rich.h} tall, sun ${shade.sun.toFixed(2)}`);
  },
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
    // the nutrients in the ash columns' soil against bare columns beside them (the ash soaks into the top cells, and drainage carries some down)
    const colN = x => { let s = 0; for (let y = H - 20; y < H - 3; y++) { const i = g.idx(x, y); if (g.type[i] === DIRT) s += g.life[i] >> 8; } return s; };
    let rich = 0, n = 0, ctl = 0; for (let x = 50; x < 70; x++) { rich += colN(x); n++; } for (let x = 73; x < 79; x++) ctl += colN(x) / 6;
    const c = census(g, Sim.EL);
    const gain = n ? rich / n - ctl : 0;
    console.log(`  80% of litter gone ${litterGone < 0 ? 'never' : (litterGone / MIN).toFixed(1) + ' min'}, ash gone ${ashGone < 0 ? 'never' : (ashGone / MIN).toFixed(1) + ' min'}, nutrients a column where ash was ${gain.toFixed(0)} over bare ground, snag wood left ${c.Wood - 1}`);
    check('most litter rots into dirt within 6 min', litterGone > 0);
    check('ash dissolves into the dirt under it and enriches it', ashGone > 0 && gain > 60, `${gain.toFixed(0)} a column`);
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
      c.Plant = 0; for (let i = 0; i < g.type.length; i++) if (g.type[i] === PLANT && g.owner[i] && g.life[i] !== 2) c.Plant++;   // broadleaf leaves only, not grass or a conifer's needles
      leafAt[g.seasonName] = Math.max(leafAt[g.seasonName] || 0, c.Plant || 0);
      clim[g.seasonName] = (clim[g.seasonName] || []).concat(g.climate);
      rows.push(`${g.seasonName.padEnd(6)} ${(g.yearPhase).toFixed(2)} climate ${g.climate.toFixed(1).padStart(5)} snow ${String(c.Snow || 0).padStart(5)} leaves ${String(c.Plant || 0).padStart(5)} litter ${String(c.Litter || 0).padStart(4)} trees ${g.trees.length} cloud ${c.Cloud || 0} water ${c.Water || 0}`);
    });
    if (process.env.VERBOSE) console.log(rows.join('\n'));
    const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
    console.log('  mean climate offset: ' + Object.entries(clim).map(([k, v]) => `${k} ${avg(v).toFixed(1)}`).join(', '));
    check('summer is warmer than winter by 10+ degrees', avg(clim.Summer) - avg(clim.Winter) > 10);
    check('broadleaf trees have fewer leaves in winter than in summer', (leafAt.Winter || 0) < 0.5 * (leafAt.Summer || 1), `${leafAt.Winter} vs ${leafAt.Summer}`);
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
    // a lake in a valley: fog gathers over it in the small hours and burns off by midday; the hilltops stay clear (two seeds summed:
    // the most fog on the high slopes is 12-18 cells against 60-77 in the valley, seed to seed)
    let nights = 0, noons = 0, tops = 0;
    for (const seed of [9, 10]) {
    Sim.reseed(seed); const W = 320, H = 240, g = new Sim.Grid(W, H); g.clock = Sim.YEAR * 0.45; g.updateClimate(); g.windHold = 0;
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
    console.log(`  seed ${seed}: valley fog: ${night} cells before dawn, ${noon} at midday; most fog on the high slopes at any time ${hilltops}`);
    check(`seed ${seed}: fog forms in the valley at night`, night >= 15);
    check(`seed ${seed}: and burns off by midday`, noon <= night / 4);
    nights += night; noons += noon; tops += hilltops;
    }
    check('the high slopes stay clear', tops <= nights / 4, `${tops} vs ${nights} in the valley`);
  },
  dew() {
    // dry topsoil under saturated night air gathers dew; under dry air it doesn't
    // (dew is a few cells' worth, so it is averaged over four plots: one plot ranges 0.4-6 on the same build)
    const got = { humid: 0, dry: 0 };
    for (const seed of [7, 8, 9, 10]) for (const [label, rh] of [['humid', 1.05], ['dry', 0.3]]) {
      const g = plot(120, 100, 30, 0, seed); g.clock = Sim.DAY * 2.6; g.updateClimate(); g.windHold = 0;
      for (let x = 0; x < 120; x++) { const i = g.idx(x, 70); g.life[i] = (40 << 8) | 10; }
      g.initAir(); for (let c = 0; c < g.hum.length; c++) g.hum[c] = g.cap[c] * rh;
      const total = () => moisture(g, 70, 97) * 27 * 120 / 100;   // in water cells
      const m0 = total(); run(g, 900); const m = total();
      console.log(`  plot ${seed}, ${label} night air: the soil holds ${m0.toFixed(1)} -> ${m.toFixed(1)} water cells' worth`);
      got[label] += (m - m0) / 4;
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
    k.shift(-1); g.shift(-1); check('and keeps streaming after loading', k.ox === g.ox && k.trees.length === g.trees.length && k.store.size === g.store.size);
  },
  sky() {
    // the page's world is the 480-row land with more sky over it and more ground under it: the same hills, shifted down, in the
    // same climate; a 480-row save (streamed regions, trees and vapour included) loads into it shifted down, with rock under it
    const { W, H } = Sim.WORLD, a = new Sim.Grid(W, 480), b = new Sim.Grid(W, H), dy = b.top, deep = H - dy - 480;
    const sa = Sim.generate(a, 4242, 7680, 3200), sb = Sim.generate(b, 4242, 7680, 3200);
    let same = 0, n = 0; for (let x = 0; x < W; x++) for (let y = 0; y <= sa[x] + 8; y++) { const i = a.idx(x, y); if (a.owner[i] || b.owner[b.idx(x, y + dy)]) continue; n++; if (a.type[i] === b.type[b.idx(x, y + dy)]) same++; }
    let skyEmpty = true; for (let i = 0; i < dy * W; i++) if (b.type[i] !== E && !b.owner[i]) skyEmpty = false;
    let rock = 0; for (let i = (H - 3) * W; i < H * W; i++) if (b.type[i] === STONE) rock++;
    console.log(`  ${dy} rows of extra sky and ${deep} of extra ground; the hills and topsoil match the 480-row world on ${same}/${n} non-tree cells`);
    check('the taller world is the same hills, with more sky above and deeper ground below', dy > 160 && deep > 0 && skyEmpty && same === n && sb.every((v, x) => v === sa[x] + dy) && rock === 3 * W);
    check('and keeps the same climate at the same height above the land', Math.abs(a.ambAt(200) - b.ambAt(200 + dy)) < 1e-9);
    run(a, 200); a.shift(1); a.shift(1); run(a, 60);
    // (compared with the same save loaded at its own size: loading redraws trees, which may differ by a cell or two from the live world)
    const s = a.save(), k = new Sim.Grid(W, H), k0 = new Sim.Grid(W, 480); k.load(s); k0.load(s);
    const under = g => { for (let i = (dy + 480) * W; i < H * W; i++) if (g.type[i] !== STONE) return false; return true; };
    let ok = 0; for (let i = 0; i < k0.type.length; i++) if (k0.type[i] === k.type[i + dy * W]) ok++;
    const hum = Math.abs(k0.hum[10 * a.AW + 7] - k.hum[(10 + dy / Sim.AC) * k.AW + 7]) < 0.01;
    check('a save from the 480-row world loads into the taller one, shifted down, with rock under it', ok === k0.type.length && under(k) && hum && k.trees.length === k0.trees.length && k.trees.every((t, j) => t.y === k0.trees[j].y + dy), `${ok}/${k0.type.length} cells`);
    const k1 = new Sim.Grid(W, H); k1.load(s.split('|').slice(0, -1).join('|'));   // (from before saves said how deep their land is)
    let ok1 = 0; for (let i = 0; i < k.type.length; i++) if (k.type[i] === k1.type[i]) ok1++;
    check('so does one saved before saves said how deep the land is', ok1 === k.type.length);
    k.shift(-1); k0.shift(-1); ok = 0; for (let i = 0; i < k0.type.length; i++) if (k0.type[i] === k.type[i + dy * W]) ok++;
    check('and its stored regions come back shifted down too', k.ox === a.ox - Sim.REGION && ok === k0.type.length && under(k) && k.trees.length === k0.trees.length, `${ok}/${k0.type.length} cells`);
  },
  widen() {
    // E8: the window grew. A save from a narrower window loads into its left part, and the rest of the window comes from the world
    // it was in: regions the save had stored come back out of the store, the others are generated
    const { W, H } = Sim.WORLD, R = Sim.REGION, W0 = W - R;
    const a = new Sim.Grid(W0, H); Sim.generate(a, 4242, 7680, 3200); run(a, 120);
    const fresh = new Sim.Grid(W, H); Sim.generate(fresh, 4242, 7680, a.ox);
    const s = a.save(), k = new Sim.Grid(W, H), k0 = new Sim.Grid(W0, H); k.load(s); k0.load(s);   // (against the save loaded at its own size: loading redraws trees)
    let left = 0, n = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W0; x++) { const i = y * W0 + x, j = y * W + x; if (k0.owner[i] || k.owner[j]) continue; n++; if (k0.type[i] === k.type[j]) left++; }   // (trees just over the old edge reach back across it)
    let right = 0, m = 0; for (let y = 0; y < H; y++) for (let x = W0; x < W; x++) { const j = y * W + x; if (fresh.owner[j] || k.owner[j]) continue; m++; if (fresh.type[j] === k.type[j]) right++; }
    const hum = Math.abs(k0.hum[30 * k0.AW + 50] - k.hum[30 * k.AW + 50]) < 0.01;
    console.log(`  a ${W0}-wide save in the ${W}-wide window: its own cells match on ${left}/${n}; the land made to widen it matches land made in place on ${(100 * right / m).toFixed(2)}%`);
    check('a narrower save loads into the left of the window', left === n && hum && k.ox === a.ox);
    check('and the window is filled out with the same world', right / m > 0.995 && k.worldW === 7680);
    // shifting left stores the region just right of the window (as it was, after a minute of play): the widened window takes it back
    a.shift(-1); run(a, 30);
    const key = (a.ox + W0) / R, rec = a.store.get(key), k2 = new Sim.Grid(W, H); k2.load(a.save());
    const unrle = r => { let len = 0; for (let p = 1; p < r.length; p += 2) len += r[p]; const o = new Uint16Array(len); for (let p = 0, q = 0; p < r.length; p += 2) { o.fill(r[p], q, q + r[p + 1]); q += r[p + 1]; } return o; };
    const ty = unrle(Uint16Array.from(rec.type)); let same = 0, c = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < R; x++) { const j = y * W + W0 + x; if (k2.owner[j]) continue; c++; if (ty[y * R + x] === k2.type[j]) same++; }
    console.log(`  with that region stored: ${a.store.size} stored -> ${k2.store.size}; it comes back matching on ${same}/${c} cells`);
    check('a region the save had stored comes back out of the store', !k2.store.has(key) && k2.store.size === a.store.size - 1 && same === c);
    // a flat world (not generated) carries its last column across
    const f = new Sim.Grid(W0, H), top = Sim.flat(f), fk = new Sim.Grid(W, H); fk.load(f.save());
    check('a narrower flat world loads widened, ground and all', fk.type[fk.idx(W - 1, top + 30)] === STONE && fk.type[fk.idx(W - 1, top - 20)] === E && fk.worldW === W);
    k.step(); k2.step(); fk.step();
  },
  narrow() {
    // N0: the window narrowed (1280 -> 960) as the world got taller. A save from a wider window loads its left part into the window,
    // and the columns past the window's edge go into the store as regions of the world, to come back when the window walks over them
    const { W, H } = Sim.WORLD, R = Sim.REGION, WB = W + R;
    const a = new Sim.Grid(WB, H); Sim.generate(a, 4242, 7680, 3200); run(a, 120);
    const s = a.save(), k = new Sim.Grid(W, H), k0 = new Sim.Grid(WB, H); k.load(s); k0.load(s);   // (against the save loaded at its own size)
    let left = 0, n = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * WB + x, j = y * W + x; if (k0.owner[i] || k.owner[j]) continue; n++; if (k0.type[i] === k.type[j]) left++; }
    const stored = k.store.has((a.ox + W) / R), trees = k.trees.length + [...k.storedTrees.keys()].length;
    console.log(`  a ${WB}-wide save in the ${W}-wide window: its left part matches on ${left}/${n} cells; ${k.store.size} regions stored; trees ${k.trees.length} here + ${k.storedTrees.size} stored of ${k0.trees.length + k0.storedTrees.size}`);
    check('a wider save loads its left part into the window', left === n && k.ox === a.ox && k.worldW === 7680 && Math.abs(k.clock - a.clock) < 1);
    check('and stores the rest as a region, trees and all', stored && trees === k0.trees.length + k0.storedTrees.size);
    k.shift(1); let back = 0, m = 0;
    for (let y = 0; y < H; y++) for (let x = W - R; x < W; x++) { const i = y * WB + x + R, j = y * W + x; if (k0.owner[i] || k.owner[j]) continue; m++; if (k0.type[i] === k.type[j]) back++; }
    check('which comes back as it was when the window walks over it', back === m, `${back}/${m} cells`);
    // an old window, 1280 wide and 480 tall (no extra sky): narrowed and shifted down in one go
    const o = new Sim.Grid(WB, 480); Sim.generate(o, 4242, 7680, 3200); const so = o.save(), ko = new Sim.Grid(W, H); ko.load(so);
    let ok = 0, c = 0; for (let y = 0; y < 480; y++) for (let x = 0; x < W; x++) { const i = y * WB + x, j = (y + ko.top) * W + x; if (o.owner[i] || ko.owner[j]) continue; c++; if (o.type[i] === ko.type[j]) ok++; }
    check('an old 480-row save from a wider window loads narrowed and shifted down', ok === c && ko.store.has((o.ox + W) / R), `${ok}/${c} cells`);
    // a flat world (not generated) just loses the columns past the window
    const f = new Sim.Grid(WB, H), top = Sim.flat(f), fk = new Sim.Grid(W, H); fk.load(f.save());
    check('a wider flat world loads cut to the window', fk.type[fk.idx(W - 1, top + 30)] === STONE && fk.type[fk.idx(W - 1, top - 20)] === E && fk.worldW === W && fk.store.size === 0);
    k.step(); ko.step(); fk.step();
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
    // (R7: the tree's litter rots into rich dirt under it, so the grass there grows back faster: 0.60 of the open, R6 0.54)
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
    check('grass thins under a tree but holds in the open', du < 0.65 * dop && dop >= 1, `${(du / dop).toFixed(2)} of the open`);
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
    const pond = (depth, m = 255, seed = 6) => {
      Sim.reseed(seed); const W = 200, H = 70, g = new Sim.Grid(W, H), bed = H - 20;
      for (let y = bed; y < H; y++) for (let x = 0; x < W; x++) { const i = g.idx(x, y); if (y >= H - 3) g.set(i, STONE); else { g.set(i, DIRT); g.life[i] = (Sim.NREF << 8) | m; } }
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
    let left = 0; for (const sd of [6, 7, 8, 9]) { const dr = pond(0, 60, sd); run(dr.g, 2 * MIN); left += count(dr.g, dr.bed).bases; }   // (4 seeds: a last stem or two can take longer)
    console.log(`  on drained ground (moisture 60): ${left} reeds left after 2 min, 2 planted on each of 4 seeds`);
    check('reeds die where the ground is not soaked', left <= 1, `${left} left`);
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
    // (the wet country at the start and two windows west of it: the start's own is mostly river valley now, bare sand and a pond)
    const e = tally(640), w = tally(0), w2 = tally(-1920), f = o => JSON.stringify(o);
    for (const [k, n] of Object.entries(w2.wet)) w.wet[k] = (w.wet[k] || 0) + n;
    console.log(`  cells by climate, east of the start: desert ${f(e.desert)}, scrub ${f(e.scrub)}; at the start and west of it, wet country ${f(w.wet)}`);
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
      check('molten glass sets into glass within 40 s', set > 0 && (c.Glass || 0) + (c.Rubble || 0) >= 195 && (c.Glass || 0) >= 175);   // (a few spans of the new glass break off as rubble: seed luck)
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
      // (summed over eight plots: on one plot it is a few dozen chances, and E7's own build made 9-24 across seeds; over four plots
      //  R6 made 42-67 and R7 23-95 depending only on the random stream)
      let peak = 0, lying = 0, left = 0;
      for (const seed of [7, 1, 2, 3, 4, 5, 6, 8]) {
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
      console.log(`  3-deep puddles on soaked dirt, eight plots: up to ${peak} mud in a minute; ${lying} lying when drained, ${left} left after 6 min of sun`);
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
    const { OIL } = Sim.ids;
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
  years() {
    // N8: each year has a wetness that runs on from the last (droughts and wet spells come in runs), a dry year has the longer, drier
    // dry season, more heat waves and drier air masses; scenarios and plain grids have none of it
    const g = new Sim.Grid(64, 64); g.fronts = true;
    const ws = [], hw = { dry: [0, 0], wet: [0, 0] };
    for (const seed of [1, 2, 3]) { g.worldSeed = seed; for (let k = 0; k < 150; k++) {
      let heat = 0; for (let f = 0; f < 1; f += 0.02) { g.clock = Sim.YEAR * (k + 0.86 + f); g.updateClimate(); if (g.heat > 0.5) heat = 1; }
      g.clock = Sim.YEAR * (k + 1.5); g.updateClimate(); ws.push(g.wet); const b = g.wet < -0.25 ? hw.dry : g.wet > 0.25 ? hw.wet : null; if (b) { b[0] += heat; b[1]++; } } }
    const m = ws.reduce((a, b) => a + b) / ws.length, sd = Math.sqrt(ws.reduce((a, b) => a + (b - m) ** 2, 0) / ws.length);
    let ac = 0; for (let i = 1; i < ws.length; i++) ac += (ws[i] - m) * (ws[i - 1] - m); ac /= ws.length * sd * sd;
    let run = 1, best = 1; for (let i = 1; i < ws.length; i++) { run = Math.sign(ws[i]) === Math.sign(ws[i - 1]) ? run + 1 : 1; best = Math.max(best, run); }
    console.log(`  450 years: wetness mean ${m.toFixed(2)}, sd ${sd.toFixed(2)}, year-to-year correlation ${ac.toFixed(2)}, longest run of one sign ${best} years; heat waves in ${hw.dry[0]}/${hw.dry[1]} dry years, ${hw.wet[0]}/${hw.wet[1]} wet ones`);
    check('wet and dry years come in runs', Math.abs(m) < 0.15 && sd > 0.4 && sd < 0.75 && ac > 0.3 && best >= 5, `sd ${sd.toFixed(2)}, r ${ac.toFixed(2)}, run ${best}`);
    check('heat waves come mostly in dry years', hw.dry[0] / hw.dry[1] > 2 * hw.wet[0] / Math.max(1, hw.wet[1]), `${hw.dry[0]}/${hw.dry[1]} vs ${hw.wet[0]}/${hw.wet[1]}`);
    const season = w => { g.wetHold = w; let dry = 0, t = 0; for (let f = 0; f < 1; f += 0.01) { g.clock = Sim.YEAR * (10 + f); g.updateClimate(); if (g.dryness > 0.5) dry++; t += g.climate; } g.updateMasses(false); return { dry, t: t / 100, rh: g.massH[0] }; };
    const d = season(-1), w = season(1); g.wetHold = null;
    console.log(`  a drought year: dry season ${d.dry}% of the year, mean ${d.t.toFixed(1)}°, air masses at ${d.rh.toFixed(2)} humidity; a wet year: ${w.dry}%, ${w.t.toFixed(1)}°, ${w.rh.toFixed(2)}`);
    check('a drought year is longer dry, hotter and its air drier', d.dry > w.dry + 10 && d.t > w.t + 2 && d.rh < w.rh - 0.15);
    const p = new Sim.Grid(64, 64); let flat = true; for (let k = 0; k < 40; k++) { p.clock = Sim.YEAR * k * 0.37; p.updateClimate(); flat = flat && p.wet === 0 && p.heat === 0; }
    check('a grid without air masses keeps every year the same', flat);
  },
  hail() {
    // N8: the deepest storm clouds hail in summer; the stones fall fast, kill grasshoppers, bruise grass and then melt
    const { HOPPER, HAIL } = Sim.ids;
    Sim.reseed(4); const W = 200, H = 200, g = new Sim.Grid(W, H); g.windHold = 0; g.lightning = true; g.clock = Sim.YEAR * 0.4; g.updateClimate();
    for (let y = H - 30; y < H; y++) for (let x = 0; x < W; x++) { const i = g.idx(x, y); if (y >= H - 4) g.set(i, STONE); else { g.set(i, DIRT); g.life[i] = (40 << 8) | 120; } }
    for (let x = 0; x < W; x++) for (let y = H - 33; y < H - 30; y++) { const i = g.idx(x, y); g.set(i, PLANT); g.life[i] = (200 << 8) | 1; }
    for (let x = 62; x < 138; x += 2) g.set(g.idx(x, H - 34), HOPPER);
    g.initAir(); for (let y = 40; y < 90; y++) for (let x = 60; x < 140; x++) g.set(g.idx(x, y), CLOUD); g.wakeAll();
    const lying = () => { let k = 0; for (let i = 0; i < g.type.length; i++) if (g.type[i] === HAIL && i + W < g.type.length && g.type[i + W] !== E && g.type[i + W] !== HAIL && Sim.EL[g.type[i + W]].kind !== 'gas') k++; return k; };   // (on something)
    let fast = 0, peak = 0, landed = 0; run(g, 600, 1, f => { let k = 0; for (let i = 0; i < g.type.length; i++) if (g.type[i] === HAIL) { k++; if (g.vy[i] >= 2) fast++; } peak = Math.max(peak, k); if (f % 30 === 0) landed = Math.max(landed, lying()); });
    let sap = 0, n = 0; for (let x = 60; x < 140; x++) for (let y = H - 33; y < H - 30; y++) { const i = g.idx(x, y); if (g.type[i] === PLANT) { sap += g.life[i] >> 8; n++; } }
    console.log(`  a 50-deep cloud in summer: ${g.hailstones} hailstones in 10 s (${fast} stone-ticks falling at 2+ a tick), ${g.hailKills}/38 grasshoppers killed, grass under it at sap ${n ? (sap / n).toFixed(0) : '-'} (from 200)`);
    check('the deepest storm clouds hail', g.hailstones >= 20 && fast > 0, `${g.hailstones} stones`);
    check('hail kills grasshoppers and bruises grass', g.hailKills >= 3 && n && sap / n < 190, `${g.hailKills} killed, sap ${(sap / n).toFixed(0)}`);
    for (let y = 0; y < H - 40; y++) for (let x = 0; x < W; x++) { const i = g.idx(x, y); if (g.type[i] === CLOUD) g.set(i, E); }
    run(g, 2 * MIN); const left = census(g, Sim.EL).Hail || 0;
    console.log(`  hail: at most ${peak} stones at once, up to ${landed} lying on the ground; two minutes after the storm ${left} left`);
    check('hail reaches the ground and melts in summer', landed >= 10 && left === 0, `${landed} lying, ${left} left`);
    // and a cloud as deep in winter, or in a world with no storms, drops none
    Sim.reseed(4); const c = new Sim.Grid(W, H); c.lightning = false; c.clock = Sim.YEAR * 0.4; c.updateClimate(); c.initAir();
    for (let y = 40; y < 90; y++) for (let x = 60; x < 140; x++) c.set(c.idx(x, y), CLOUD); run(c, 300);
    check('no hail where there are no storms', c.hailstones === 0);
  },
  aspect() {
    // N8: the sun rises in the east (+x): snow on a ridge's west face (the afternoon sun's) goes before the snow on its east face
    const ridge = clock => {
      Sim.reseed(5); const W = 256, H = 160, g = new Sim.Grid(W, H); g.windHold = 0; g.fronts = true; g.lightning = false; g.wetHold = 0; g.skyY = 230; g.clock = clock; g.updateClimate(); g.resetTemp();
      const top = x => Math.min(H - 10, 70 + Math.abs(x - 128));
      for (let x = 0; x < W; x++) for (let y = top(x); y < H; y++) { const i = g.idx(x, y); if (y >= H - 3 || y > top(x) + 4) g.set(i, STONE); else { g.set(i, DIRT); g.life[i] = (Sim.NREF << 8) | 60; } }
      for (let x = 0; x < W; x++) g.set(g.idx(x, top(x) - 1), SNOW, -1);
      g.initAir(); g.updateMasses(false); return g;
    };
    const snowOn = (g, x0, x1) => { let n = 0; for (let x = x0; x < x1; x++) { let y = 0; while (y < g.H && (g.type[g.idx(x, y)] === E || Sim.EL[g.type[g.idx(x, y)]].kind === 'gas')) y++; if (g.type[g.idx(x, y)] === SNOW) n++; } return n / (x1 - x0); };
    const g = ridge(Sim.YEAR * 0.97); run(g, 900);
    const west = snowOn(g, 70, 120), east = snowOn(g, 136, 186);
    console.log(`  late winter, after a quarter day: snow left on the west face ${(west * 100).toFixed(0)}%, on the east face ${(east * 100).toFixed(0)}%`);
    check('snow goes first from the slope facing the afternoon sun', west < east - 0.2, `${west.toFixed(2)} vs ${east.toFixed(2)}`);
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
    const hill = (wet, roots, seed = 7) => {
      Sim.reseed(seed); const W = 320, H = 180, g = new Sim.Grid(W, H), floor = H - 10;
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
    // (the soaked slopes over four seeds: how much rock one slide bares is seed luck, 9-34 columns on R4's build)
    const damp = hill(false), soakeds = [7, 8, 9, 10].map(sd => hill(true, false, sd)), rooteds = [7, 8, 9, 10].map(sd => hill(true, true, sd));
    const fmt = r => `${r.slides} slides, ${r.bare}/67 columns of bare rock, toe ${r.reach} cells past the foot, ${r.peak} cells moving at once at most`;
    const sum = (rs, k) => rs.reduce((a, r) => a + r[k], 0), soaked = soakeds[0], rooted = rooteds[0];
    console.log(`  damp: ${fmt(damp)}\n  soaked toward the rock: ${soakeds.map(fmt).join('; ')}\n  soaked, with roots through it: ${rooteds.map(fmt).join('; ')}`);
    check('a damp hillside stands', damp.slides === 0 && damp.bare === 0, fmt(damp));
    check('a soaked one slides off as a slab: 20+ columns of rock bared (on average over 4 seeds), 100+ cells moving together, the toe 12+ cells out', sum(soakeds, 'bare') >= 80 && soakeds.every(r => r.peak >= 100 && r.reach >= 12), `${sum(soakeds, 'bare')} columns over 4`);
    check('roots hold it: a third of the bare rock or less', sum(rooteds, 'bare') <= sum(soakeds, 'bare') / 3, `${sum(rooteds, 'bare')} vs ${sum(soakeds, 'bare')}`);
  },
  floe() {
    // N5: ice floats. A block of ice dropped into a pond comes down whole and floats with about a tenth of it out of the water; a
    // thawing floe drifts off downwind; a floe frozen to the shore in a frost stays where it is (the wind is the same on both)
    const { ICE } = Sim.ids;
    const pond = (clock, sky, wind, water) => {
      Sim.reseed(7); const W = 200, H = 120, g = new Sim.Grid(W, H); if (sky) g.skyY = sky; g.clock = clock; g.updateClimate(); g.resetTemp(); g.windHold = wind;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = g.idx(x, y); if (y >= 100 || x < 20 || x >= 180) { if (y >= 50) { g.set(i, STONE, 4); g.life[i] |= 1; } } else if (y >= 60) g.set(i, WATER, water); }
      g.initAir(); return g;
    };
    const ice = g => { let n = 0, top = g.H, bot = 0, x0 = g.W, x1 = 0; for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) if (g.type[g.idx(x, y)] === ICE) { n++; top = Math.min(top, y); bot = Math.max(bot, y); x0 = Math.min(x0, x); x1 = Math.max(x1, x); } return { n, top, bot, x0, x1 }; };
    const level = g => { for (let y = 0; y < g.H; y++) if (g.type[g.idx(40, y)] === WATER) return y; return -1; };
    {
      const g = pond(Sim.YEAR * 0.62, 0, 0, 1);
      for (let y = 30; y < 40; y++) for (let x = 95; x < 103; x++) g.lay(g.idx(x, y), ICE, -10);
      let snow = 0, above = [];
      run(g, 600, 30, f => { snow = Math.max(snow, census(g, Sim.EL).Snow || 0); if (f >= 300) { const b = ice(g); above.push(level(g) - b.top); } });
      const b = ice(g), mean = above.reduce((a, v) => a + v, 0) / above.length;
      console.log(`  block of 80 ice cells dropped into a pond: ${b.n} left, rows ${b.top}-${b.bot} (${b.bot - b.top + 1} deep), ${mean.toFixed(1)} rows out of the water on average, ${snow} snow made`);
      check('a block of ice dropped into a pond comes down whole (no snow) and floats', snow === 0 && b.n >= 70 && b.bot - b.top <= 10 && b.bot > level(g));
      check('with about a tenth of it out of the water (0.5 to 2 of its 10 rows)', mean >= 0.5 && mean <= 2, mean.toFixed(2));
    }
    {
      const thaw = pond(Sim.YEAR * 0.62, 0, 0.6, 0.5), frost = pond(Sim.YEAR * 0.92, 400, 0.6, 0.5);
      for (const g of [thaw, frost]) { const x0 = g === thaw ? 60 : 20; for (let y = 60; y < 63; y++) for (let x = x0; x < x0 + 12; x++) { const i = g.idx(x, y); g.set(i, ICE, g === thaw ? 0 : -8); g.life[i] = 1; } g.life[g.idx(x0 + 10, 62)] = 0; }   // floes from a pond's ice, one out on the water and one against the west shore (the water under them has moved)
      run(thaw, 900); run(frost, 900);
      const a = ice(thaw), b = ice(frost); let held = 0; for (let y = 60; y < 63; y++) for (let x = 20; x < 32; x++) if (frost.type[frost.idx(x, y)] === ICE) held++;
      console.log(`  in a 0.6 wind, 15 s on: a thawing floe from x 60-71 is at x ${a.x0}-${a.x1} (${a.n} cells); one frozen against the west shore still fills ${held}/36 of its place (the pond freezing round it: ${b.n} ice cells)`);
      check('a thawing floe drifts off downwind', a.n > 0 && a.x0 >= 66, `x0 ${a.x0}`);
      check('a floe frozen to the shore stays put', held === 36, `${held}`);
    }
  },
  cornice() {
    // N5: a steady wind over a ridge blows the cold snow off its windward slope, piles it in the lee and builds a cornice out over the
    // drop at the crest
    Sim.reseed(7);
    const W = 240, H = 160, g = new Sim.Grid(W, H); g.skyY = 400; g.clock = Sim.YEAR * 0.92; g.updateClimate(); g.resetTemp(); g.windHold = 0.8;
    const ground = x => x < 40 ? 140 : x <= 120 ? Math.round(140 - (x - 40) * 0.6) : 140;   // a long slope up from the west to a crest, then a cliff
    for (let x = 0; x < W; x++) { for (let y = ground(x); y < H; y++) { const i = g.idx(x, y); g.set(i, STONE, -8); g.life[i] |= 1; } for (let k = 1; k <= (x < 116 ? 6 : 0); k++) g.set(g.idx(x, ground(x) - k), SNOW, -8); }   // (snow six deep up to the crest, none on it or past it)
    g.initAir();
    const w0 = 56 * 6; run(g, 3600);
    let windward = 0, lee = 0, hang = 0, packed = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = g.idx(x, y); if (g.type[i] !== SNOW) continue; if (g.life[i] & 1) packed++; if (x >= 60 && x < 116) windward++; else if (x > 120) lee++; if (x > 120 && y < 100 && g.type[i + W] === E) hang++; }
    console.log(`  a minute of a 0.8 wind: snow on the upper windward slope ${windward} cells (${w0} to begin with), in the lee ${lee}, ${hang} hanging over the cliff at the crest, ${packed} wind-packed`);
    check('the wind strips the upper windward slope (under a third left) and piles some in the lee (40+ cells)', windward < w0 / 3 && lee >= 40, `${windward} / ${lee}`);
    check('and builds a cornice out over the drop (3+ cells)', hang >= 3, `${hang}`);
  },
  avalanche() {
    // N5: snow six deep on a slope of rock falling 4 in 5. Cold settled snow holds it; wind-packed snow on top of it (a wind slab)
    // or snow in a thaw slides off as a slab and runs far out past the foot; trees through it hold it
    const { ROOT } = Sim.ids;
    const hill = (kind, seed) => {
      Sim.reseed(seed);
      const W = 320, H = 200, g = new Sim.Grid(W, H), wet = kind === 'wet'; g.skyY = wet ? 230 : 400; g.clock = Sim.YEAR * (wet ? 0.03 : 0.92); g.updateClimate(); g.resetTemp(); g.windHold = 0;
      const floor = H - 10, rock = x => x < 60 ? floor - 100 : x < 185 ? Math.round(floor - 100 + (x - 60) * 0.8) : floor;
      for (let x = 0; x < W; x++) { for (let y = rock(x); y < H; y++) { const i = g.idx(x, y); g.set(i, STONE, -8); g.life[i] |= 1; }
        for (let k = 1; k <= 6; k++) { const i = g.idx(x, rock(x) - k); g.set(i, kind === 'trees' && x >= 60 && x < 185 && x % 5 === 0 && k > 1 ? ROOT : SNOW, wet ? -0.5 : -8); if ((kind === 'slab' || kind === 'trees') && k >= 5 && g.type[i] === SNOW) g.life[i] = 1; } }
      g.initAir();
      let peak = 0; run(g, 1800, 4, () => { let n = 0; for (let i = 0; i < g.type.length; i++) if (g.type[i] === SNOW && g.vy[i] >= Sim.SLIP_TAG) n++; peak = Math.max(peak, n); });
      let bare = 0, reach = 0; for (let x = 60; x < 185; x++) for (let y = 0; y < H; y++) { const t = g.type[g.idx(x, y)]; if (t === E || Sim.EL[t].kind === 'gas') continue; if (t === STONE) bare++; break; }
      for (let x = 185; x < W; x++) if (g.type[g.idx(x, floor - 8)] === SNOW) reach = x - 185;   // (the floor's own snow lies 6 deep)
      return { n: g.avalanches, bare, reach, peak };
    };
    const fmt = r => `${r.n} avalanches, ${r.bare}/125 columns bared, toe ${r.reach} past the foot, ${r.peak} cells moving at most`;
    const out = {}; for (const k of ['cold', 'slab', 'wet', 'trees']) out[k] = [7, 8].map(sd => hill(k, sd));
    for (const k in out) console.log(`  ${k}: ${out[k].map(fmt).join('; ')}`);
    const sum = (k, f) => out[k].reduce((a, r) => a + r[f], 0);
    check('cold settled snow on a 4 in 5 slope stands', sum('cold', 'n') === 0);
    check('a wind slab on it avalanches: 40+ columns bared, 200+ cells moving together, the toe 30+ cells out', out.slab.every(r => r.bare >= 40 && r.peak >= 200 && r.reach >= 30), out.slab.map(fmt).join('; '));
    check('so does snow in a thaw (40+ columns bared)', out.wet.every(r => r.bare >= 40));
    check('trees through it hold it: a quarter of the bare rock or less', sum('trees', 'bare') <= sum('slab', 'bare') / 4, `${sum('trees', 'bare')} vs ${sum('slab', 'bare')}`);
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
  nutrients() {
    // soil fertility: rain washes nutrients down out of the topsoil; grass and trees grow faster on rich soil than on spent soil;
    // a burnt meadow's ash feeds the ground it burnt on
    const topN = (g, y0, rows, x0 = 0, x1 = g.W) => { let s = 0, n = 0; for (let y = y0; y < y0 + rows; y++) for (let x = x0; x < x1; x++) { const i = g.idx(x, y); if (g.type[i] === DIRT) { s += g.life[i] >> 8; n++; } } return n ? s / n : 0; };
    const enrich = (g, y0, rows, n) => { for (let y = y0; y < y0 + rows; y++) for (let x = 0; x < g.W; x++) { const i = g.idx(x, y); if (g.type[i] === DIRT) g.life[i] = (n << 8) | (g.life[i] & 255); } };
    // leaching: bare rich topsoil, one plot rained on hard every 10 s for 3 min, the other left dry
    const lr = {};
    for (const rain of [false, true]) {
      const W = 60, H = 60, g = plot(W, H, 30, 60), sy = H - 30; enrich(g, sy, 6, 150);
      run(g, 3 * MIN, 600, () => { if (rain) for (let x = 0; x < W; x++) for (let k = 1; k <= 2; k++) { const i = g.idx(x, sy - 10 - k); if (g.type[i] === E) g.set(i, WATER); } });
      lr[rain] = { top: topN(g, sy, 3), deep: topN(g, sy + 3, 20) };
    }
    console.log(`  bare topsoil at 150: after 3 min dry ${lr.false.top.toFixed(0)} (subsoil ${lr.false.deep.toFixed(0)}), rained on ${lr.true.top.toFixed(0)} (subsoil ${lr.true.deep.toFixed(0)})`);
    check('rain washes nutrients down out of the topsoil', lr.true.top < lr.false.top * 0.75 && lr.true.deep > lr.false.deep + 5);
    // grass: a few blades on rich and on spent damp dirt
    const gr = {};
    for (const n of [10, 150]) {
      const W = 200, H = 60, g = plot(W, H, 30, 90), sy = H - 31; enrich(g, sy + 1, 30, n);
      for (let x = 98; x < 102; x++) { const i = g.idx(x, sy); g.set(i, PLANT); g.life[i] = (200 << 8) | 1; }
      run(g, 0.6 * MIN);
      let cols = 0; for (let x = 0; x < W; x++) for (let y = sy - 3; y <= sy; y++) if (g.type[g.idx(x, y)] === PLANT) { cols++; break; }
      gr[n] = cols;
    }
    console.log(`  grass after 36 s: on spent soil (10) ${gr[10]} columns, on rich soil (150) ${gr[150]}`);
    check('grass spreads faster on rich soil', gr[150] >= 1.5 * gr[10] && gr[150] >= 20);
    // a sapling on rich and on spent damp dirt
    const tr = { 0: { wood: 0, h: 0 }, 150: { wood: 0, h: 0 } };
    for (const seed of [7, 8, 9]) for (const n of [0, 150]) {
      const W = 160, H = 120, g = plot(W, H, 40, 200, seed), sx = 80, sy = H - 41; enrich(g, sy + 1, 40, n); g.set(g.idx(sx, sy), TIP);
      run(g, MIN);
      for (let i = 0; i < g.type.length; i++) if (g.type[i] === WOOD && g.owner[i]) tr[n].wood += 1 / 3;
      const t = g.trees.find(t => t.x === sx); tr[n].h += (t ? t.segs[0].len : 0) / 3;
    }
    for (const n in tr) { tr[n].wood = Math.round(tr[n].wood); tr[n].h = Math.round(tr[n].h); }
    console.log(`  saplings after 1 min (3 seeds): on spent soil (0) trunk ${tr[0].h}, ${tr[0].wood} wood; on rich soil trunk ${tr[150].h}, ${tr[150].wood} wood`);
    check('a tree grows faster on rich soil', tr[150].wood >= 1.15 * tr[0].wood && tr[150].h >= tr[0].h + 4);
    // slash and burn: a meadow on poor soil is burnt, rain falls on the ash, and the topsoil comes out richer (four plots summed:
    // how much ash one fire leaves, and how much of it is left, swing with the random stream: one plot passed under a quarter left
    // by luck, and main leaves 88 of 334 over these four)
    let ashN = 0, leftN = 0, gain = 0;
    for (const seed of [7, 8, 9, 10]) {
      const W = 120, H = 60, g = plot(W, H, 30, 60, seed), sy = H - 31; enrich(g, sy + 1, 30, 30); g.windHold = 0;
      for (let x = 0; x < W; x++) for (let k = 0; k < 2; k++) { const i = g.idx(x, sy - k); g.set(i, PLANT); g.life[i] = (40 << 8) | 1; }   // dry, ready to burn
      const before = topN(g, sy + 1, 3);
      for (let x = 58; x < 62; x++) g.set(g.idx(x, sy - 2), FIRE);
      run(g, 0.5 * MIN);
      let ash = 0; for (let i = 0; i < g.type.length; i++) if (g.type[i] === ASH) ash++;
      run(g, 1.5 * MIN, 300, () => { for (let x = 0; x < W; x += 3) { const i = g.idx(x, sy - 12); if (g.type[i] === E) g.set(i, WATER); } });
      let left = 0; for (let i = 0; i < g.type.length; i++) if (g.type[i] === ASH) left++;
      const after = topN(g, sy + 1, 3);
      console.log(`  burnt meadow (seed ${seed}): ${ash} ash after the fire, ${left} left after rain; topsoil ${before.toFixed(0)} before, ${after.toFixed(0)} after`);
      ashN += ash; leftN += left; gain += (after - before) / 4;
    }
    check('a burnt meadow\'s ash feeds the soil', ashN > 80 && leftN < ashN / 3 && gain > 15, `${ashN} ash, ${leftN} left, topsoil +${gain.toFixed(0)}`);
  },
  animals() {
    // rabbits graze a meadow without stripping it and starve on bare ground; they carry grass seed across bare rock the wind's seed
    // can't cross; they run from a grass fire and swim out of a pond; grasshoppers lay eggs in autumn that hatch the next spring
    const { RABBIT, HOPPER } = Sim.ids;
    const meadow = (g, x0, x1, sy, sap = 220) => { for (let x = x0; x < x1; x++) for (let k = 0; k < 2; k++) { const i = g.idx(x, sy - k); if (g.type[i] === E) { g.set(i, PLANT); g.life[i] = (sap << 8) | 1; } } };
    const loose = (g, t, xs, sy) => { for (const x of xs) { let y = sy; while (g.type[g.idx(x, y)] !== E) y--; g.set(g.idx(x, y), t); } };
    const count = (g, t, x0 = 0, x1 = g.W) => { let n = 0; for (let y = 0; y < g.H; y++) for (let x = x0; x < x1; x++) { const i = g.idx(x, y); if (g.type[i] === t && !(t === HOPPER && g.life[i] & Sim.EGG) && !(t === PLANT && g.owner[i])) n++; } return n; };
    const at = (g, p) => { g.clock = Sim.YEAR * p; g.updateClimate(); };
    // grazing: 8 rabbits on a damp meadow and 8 on bare damp dirt, 4 min of late spring
    const gz = {};
    for (const grass of [true, false]) {
      const W = 160, H = 60, g = plot(W, H, 30, 120), sy = H - 31; at(g, 0.2); g.windHold = 0;
      if (grass) meadow(g, 0, W, sy);
      const g0 = count(g, PLANT); loose(g, RABBIT, [10, 14, 50, 54, 90, 94, 130, 134], sy);
      let low = 8; run(g, 4 * MIN, 600, () => { low = Math.min(low, count(g, RABBIT)); });
      let bases = 0; for (let x = 0; x < W; x++) if (g.type[g.idx(x, sy)] === PLANT) bases++;
      gz[grass] = { r: count(g, RABBIT), low, g0, g1: count(g, PLANT), bases, litter: count(g, LITTER) };
    }
    console.log(`  meadow: rabbits 8 -> ${gz.true.r} (fewest ${gz.true.low}), grass ${gz.true.g0} -> ${gz.true.g1} cells, ${gz.true.bases}/160 columns still grassed; bare dirt: rabbits 8 -> ${gz.false.r}, ${gz.false.litter} litter`);
    check('rabbits live on a meadow and graze it without stripping it bare', gz.true.low >= 6 && gz.true.g1 < gz.true.g0 * 1.3 && gz.true.bases >= 120);
    check('rabbits on bare ground starve (to litter)', gz.false.r === 0 && gz.false.litter >= 3);
    // seed: a meadow on the west, 60 columns of bare rock, then bare damp dirt. The wind's seed reaches 48 columns, so only seed that
    // rabbits carry gets across. A summer, with 10 rabbits and without
    const sd = {};
    for (const n of [0, 10]) {
      let far = 0;
      for (const seed of [7, 8]) {
        const W = 300, H = 60, g = plot(W, H, 30, 120, seed), sy = H - 31; at(g, 0.35); g.windHold = 0;
        for (let x = 70; x < 130; x++) for (let y = sy - 1; y < H - 3; y++) g.set(g.idx(x, y), STONE);   // a shelf of rock a cell over the ground
        meadow(g, 0, 70, sy);
        loose(g, RABBIT, Array.from({ length: n }, (_, k) => 5 + k * 6), sy);
        run(g, 3 * MIN);
        far += count(g, PLANT, 130, W);
      }
      sd[n] = far;
    }
    console.log(`  grass past 60 columns of bare rock after 3 min of summer (2 seeds): without rabbits ${sd[0]} cells, with 10 rabbits ${sd[10]}`);
    check('rabbits carry grass seed across ground the wind\'s seed can\'t cross', sd[0] === 0 && sd[10] >= 3);
    // fire: rabbits on a cured meadow run from a fire lit at its west end toward the bare ground in the east
    {
      const W = 260, H = 60, g = plot(W, H, 30, 30), sy = H - 31; at(g, 0.45); g.windHold = 0;
      meadow(g, 0, 200, sy, 40);
      const xs = []; for (let x = 40; x < 190; x += 15) xs.push(x); loose(g, RABBIT, xs, sy);
      for (let x = 2; x < 6; x++) g.set(g.idx(x, sy - 2), FIRE);
      run(g, 1.5 * MIN);
      const burnt = 200 - count(g, PLANT, 0, 200) / 2, safe = count(g, RABBIT), east = count(g, RABBIT, 190, W);
      console.log(`  grass fire: ~${burnt.toFixed(0)}/200 columns burnt; rabbits ${xs.length} -> ${safe}, ${east} of them out on the bare ground`);
      check('rabbits run from a grass fire', burnt > 150 && safe >= xs.length / 2 && east >= xs.length / 3);
    }
    // swimming: rabbits dropped in a pond 6 deep come out on the shore
    {
      Sim.reseed(4); const W = 120, H = 60, g = plot(W, H, 20, 200), sy = H - 21; g.windHold = 0;
      for (let x = 40; x < 80; x++) for (let y = sy - 4; y < sy + 2; y++) g.set(g.idx(x, y), WATER);
      for (let x = 0; x < W; x++) if (x < 40 || x >= 80) for (let y = sy - 4; y < sy; y++) g.set(g.idx(x, y), DIRT);   // banks level with the water
      loose(g, RABBIT, [45, 52, 60, 68, 75], sy - 4);
      run(g, 0.5 * MIN);
      const out = count(g, RABBIT, 0, 40) + count(g, RABBIT, 80, W);
      console.log(`  pond: ${out} of 5 rabbits out on the banks after 30 s, ${count(g, RABBIT)} alive`);
      check('rabbits swim out of a pond', out >= 4);
    }
    // grasshoppers through a year: 20 on a meadow in midsummer; eggs by autumn, no adults over winter, hatched by next spring
    {
      const W = 200, H = 60, g = plot(W, H, 30, 150), sy = H - 31; at(g, 0.4); g.windHold = 0;
      meadow(g, 0, W, sy); loose(g, HOPPER, Array.from({ length: 20 }, (_, k) => 5 + k * 10), sy);
      const eggs = () => { let n = 0; for (let i = 0; i < g.type.length; i++) if (g.type[i] === HOPPER && g.life[i] & Sim.EGG) n++; return n; };
      const log = [];
      for (const p of [0.7, 0.95, 1.3]) { while (g.clock < Sim.YEAR * p) { g.step(); for (let x = 0; x < W; x += 20) { const i = g.idx(x, sy - 30); if (g.frame % 900 === 0 && g.type[i] === E) g.set(i, WATER); } } log.push([count(g, HOPPER), eggs()]); }
      console.log(`  grasshoppers from 20 in midsummer: autumn ${log[0][0]} (${log[0][1]} eggs), late winter ${log[1][0]} (${log[1][1]} eggs), next spring ${log[2][0]} (${log[2][1]} eggs)`);
      check('grasshoppers lay eggs in autumn, die in the frost, and hatch in spring', log[0][1] >= 10 && log[1][0] === 0 && log[1][1] >= 5 && log[2][0] >= 5);
    }
  },
  // ---------------- N3: foxes and birds ----------------
  predators() {
    // a fox hunts the rabbits on a meadow and starves on an empty one; a fed fox digs a den in spring and has cubs in it; birds
    // thin out grasshoppers, carry tree seed over water, and nest in a tall tree
    const { RABBIT, HOPPER, FOX, BIRD, SEED, TIP } = Sim.ids;
    const meadow = (g, x0, x1, sy, sap = 220) => { for (let x = x0; x < x1; x++) for (let k = 0; k < 2; k++) { const i = g.idx(x, sy - k); if (g.type[i] === E) { g.set(i, PLANT); g.life[i] = (sap << 8) | 1; } } };
    const loose = (g, t, xs, sy, life) => { for (const x of xs) { let y = sy; while (g.type[g.idx(x, y)] !== E) y--; const i = g.idx(x, y); g.set(i, t); if (life !== undefined) g.life[i] = life; } };
    const count = (g, t, x0 = 0, x1 = g.W) => { let n = 0; for (let y = 0; y < g.H; y++) for (let x = x0; x < x1; x++) { const i = g.idx(x, y); if (g.type[i] === t && !((t === HOPPER || t === BIRD) && g.life[i] & Sim.EGG) && !(t === PLANT && g.owner[i])) n++; } return n; };
    const at = (g, p) => { g.clock = Sim.YEAR * p; g.updateClimate(); };
    // hunting: 12 rabbits on a meadow, with a hungry fox and without, 4 min of summer (2 seeds)
    {
      const left = { 0: 0, 1: 0 }; let fed = 0;
      for (const n of [0, 1]) for (const seed of [3, 4]) {
        const W = 320, H = 60, g = plot(W, H, 30, 150, seed), sy = H - 31; at(g, 0.3); g.windHold = 0;
        meadow(g, 0, W, sy);
        loose(g, RABBIT, Array.from({ length: 12 }, (_, k) => 10 + k * 25), sy, 200 | (3 << 8));
        if (n) loose(g, FOX, [160], sy, 100 | (3 << 8));
        run(g, 4 * MIN);
        left[n] += count(g, RABBIT);
        if (n) for (let i = 0; i < g.type.length; i++) if (g.type[i] === FOX) fed = Math.max(fed, g.life[i] & 255);
      }
      console.log(`  12 rabbits on a meadow for 4 min (2 seeds): ${left[0]} left without a fox, ${left[1]} with one; the fox's energy 100 -> ${fed}`);
      check('a fox hunts rabbits down', left[1] <= left[0] - 4 && fed > 100, `${left[1]} vs ${left[0]}`);
    }
    // starving: a fox on a meadow with no rabbits
    {
      const W = 200, H = 60, g = plot(W, H, 30, 150), sy = H - 31; at(g, 0.3); g.windHold = 0;
      meadow(g, 0, W, sy); loose(g, FOX, [100], sy, 60 | (3 << 8));
      run(g, 0.5 * MIN); const early = count(g, FOX);
      run(g, 2 * MIN);
      console.log(`  a fox with no rabbits: ${early} alive after 30 s, ${count(g, FOX)} after 150 s`);
      check('a fox with nothing to hunt starves', early === 1 && count(g, FOX) === 0);
    }
    // a den: a fed grown fox on a meadow in spring digs into the dirt and has cubs there (3 seeds)
    {
      let dens = 0, cubs = 0;
      for (const seed of [5, 6, 7]) {
        const W = 160, H = 60, g = plot(W, H, 30, 150, seed), sy = H - 31; at(g, 0.15); g.windHold = 0;
        meadow(g, 0, W, sy); loose(g, FOX, [80], sy, 250 | (4 << 8));
        let dug = false, most = 1;
        run(g, 1.5 * MIN, 60, () => { for (let x = 0; x < W; x++) { const t = g.type[g.idx(x, sy + 1)]; if (t === E || t === FOX) dug = true; } most = Math.max(most, count(g, FOX)); });
        if (dug) dens++; cubs += most - 1;
      }
      console.log(`  a fed fox in spring (3 seeds): ${dens} dug a den, ${cubs} cubs between them`);
      check('a fed fox digs a den in spring and has cubs in it', dens >= 2 && cubs >= 2);
    }
    // grasshoppers: 30 on a dry summer meadow, with 8 birds and without, 90 s (2 seeds)
    {
      const left = { 0: 0, 8: 0 };
      for (const n of [0, 8]) for (const seed of [3, 4]) {
        const W = 240, H = 80, g = plot(W, H, 30, 150, seed), sy = H - 31; at(g, 0.3); g.windHold = 0;
        meadow(g, 0, W, sy, 120); loose(g, HOPPER, Array.from({ length: 30 }, (_, k) => 4 + k * 8), sy);
        for (let k = 0; k < n; k++) { const i = g.idx(15 + k * 30, sy - 15); g.set(i, BIRD); g.life[i] = 120 | (2 << 8); }
        run(g, 1.5 * MIN);
        for (let i = 0; i < g.type.length; i++) if (g.type[i] === HOPPER) left[n]++;   // (eggs too)
      }
      console.log(`  30 grasshoppers on a dry meadow for 90 s (2 seeds): ${left[0]} without birds, ${left[8]} with 8 birds`);
      check('birds keep a grasshopper plague down (by a fifth or more)', left[8] <= 0.8 * left[0], `${left[8]} vs ${left[0]}`);
    }
    // seed over water: tree seed on bare dirt in the west, a lake 100 wide, bare damp dirt in the east; birds in the west, 4 min of summer
    {
      const far = { 0: 0, 6: 0 };
      for (const n of [0, 6]) for (const seed of [3, 4]) {
        const W = 320, H = 80, g = plot(W, H, 30, 150, seed), sy = H - 31; at(g, 0.3); g.windHold = 0;
        for (let x = 80; x < 180; x++) for (let y = sy - 1; y < sy + 4; y++) g.set(g.idx(x, y), WATER);
        for (let k = 0; k < 40; k++) { const i = g.idx(5 + k * 2, sy - 1); g.set(i, SEED); g.life[i] = 255; }   // (seeds that won't sprout in the 4 min)
        for (let k = 0; k < n; k++) { const i = g.idx(10 + k * 10, sy - 12); g.set(i, BIRD); g.life[i] = 160 | (2 << 8); }
        run(g, 4 * MIN);
        far[n] += count(g, SEED, 185, W) + count(g, TIP, 185, W) + g.trees.filter(t => t.x >= 185).length;
      }
      console.log(`  tree seed east of a lake 100 wide after 4 min (2 seeds): ${far[0]} without birds, ${far[6]} with 6 birds`);
      check('birds carry tree seed across water', far[0] === 0 && far[6] >= 2);
    }
    // a nest: fed birds in a tall tree in spring lay eggs, and the eggs hatch
    {
      const W = 160, H = 120, g = plot(W, H, 40, 160, 5), sy = H - 41; at(g, 0.1); g.windHold = 0;
      g.plantTree(80, sy - 1); const t = g.trees[0]; Sim.reseed(9); t.water = 200;
      for (let n = 0; n < 160; n++) { g.sketch = true; const ok = g.growTree(t, true); g.sketch = false; if (!ok) break; }
      g.rasterTree(t);
      let top = sy; for (const [i] of t.cells) top = Math.min(top, (i / W) | 0);
      for (let k = 0; k < 4; k++) { const i = g.idx(70 + k * 6, top - 2); g.set(i, BIRD); g.life[i] = 250 | (2 << 8); }
      let eggs = 0, most = 0;
      run(g, 4 * MIN, 300, () => { let e = 0; for (let i = 0; i < g.type.length; i++) if (g.type[i] === BIRD && g.life[i] & Sim.EGG) e++; eggs = Math.max(eggs, e); most = Math.max(most, count(g, BIRD)); });
      console.log(`  4 fed birds over a tree ${sy - top} tall in spring: up to ${eggs} eggs at once, up to ${most} birds`);
      check('birds nest in a tall tree and the eggs hatch', sy - top >= 14 && eggs >= 1 && most >= 5);
    }
  },
  // ---------------- X1: devices (spout, drain, heater, cooler, fan) ----------------
  // ---------------- N4: conifers, the treeline and succession ----------------
  conifers() {
    // ground `d` rows over the reference level (so as cold as a hill that high): soil 20 deep at nutrients n, rock under it
    const hill = (W, d, n, seed = 7) => {
      Sim.reseed(seed); const H = 300, g = new Sim.Grid(W, H), gy = typeof d === 'function' ? null : g.skyY - d; g.windHold = 0;
      for (let x = 0; x < W; x++) { const top = gy ?? g.skyY - d(x); for (let y = top + 1; y < H; y++) { const i = g.idx(x, y); if (y > top + 20) g.set(i, STONE, g.ambAt(y)); else { g.set(i, DIRT, g.ambAt(y)); g.life[i] = (n << 8) | 160; } } }
      g.initAir(); return g;
    };
    const water = (g, f) => { if (f % 64) return; for (let i = f % 3; i < g.type.length; i += 3) if (g.type[i] === DIRT && (g.life[i] & 255) < 120) g.life[i] = (g.life[i] & 0xff00) | 160; };
    const grow = (g, x, con, n = 260) => { const sy = (() => { let y = 0; while (g.type[g.idx(x, y + 1)] === E) y++; return y; })(); g.plantTree(x, sy, con); const t = g.trees[g.trees.length - 1]; t.water = 20;
      for (let k = 0; k < n; k++) { t.water = Math.max(t.water, 5); if (!g.growTree(t, true)) break; } return t; };
    const shape = (g, t) => { let top = t.y, x0 = t.x, x1 = t.x, leaves = 0; for (const [i, c] of t.cells) { if (t.segs[c >> 1].root || g.type[i] === Sim.ids.ROOT) continue; top = Math.min(top, (i / g.W) | 0); x0 = Math.min(x0, i % g.W); x1 = Math.max(x1, i % g.W); if ((c & 1) && g.type[i] === PLANT) leaves++; } return { h: t.y - top + 1, w: x1 - x0 + 1, leaves }; };
    // the treeline: seeds of both kinds sown on a valley floor (30 rows up), an upland (62) and a summit (80)
    {
      const P = 80, ds = [30, 62, 80], g = hill(3 * P, x => ds[(x / P) | 0], 80);
      g.clock = Sim.YEAR * 0.2; g.updateClimate();
      for (let k = 0; k < 3; k++) for (let n = 0; n < 8; n++) { const x = k * P + 6 + n * 9, i = g.idx(x, g.skyY - ds[k] - 1); g.set(i, SEED); g.life[i] = 1 | (n % 2 ? Sim.CONE : 0); }
      run(g, Sim.YEAR / 4, 1, f => water(g, f));
      const got = ds.map((d, k) => ({ b: g.trees.filter(t => !t.con && ((t.x / P) | 0) === k).length, c: g.trees.filter(t => t.con && ((t.x / P) | 0) === k).length, w: g.warmth(g.skyY - d - 1) }));
      console.log('  ' + got.map((r, k) => `${['valley', 'upland', 'summit'][k]} (${r.w.toFixed(1)}°): ${r.b} broadleaf, ${r.c} conifers`).join('; '));
      check('in the valley both kinds sprout', got[0].b >= 2 && got[0].c >= 2, `${got[0].b} and ${got[0].c}`);
      check('on the upland only conifers sprout', got[1].b === 0 && got[1].c >= 2, `${got[1].b} broadleaf, ${got[1].c} conifers`);
      check('over the treeline nothing sprouts', got[2].b + got[2].c === 0);
    }
    // a conifer is a narrow spire that keeps its needles over winter; a broadleaf spreads and drops its leaves
    {
      const g = hill(200, 30, 80); g.clock = Sim.YEAR * 0.45; g.updateClimate();
      const b = grow(g, 50, false), c = grow(g, 150, true), sb = shape(g, b), sc = shape(g, c);
      g.clock = Sim.YEAR * 0.85; g.updateClimate(); run(g, 1200);
      const wb = shape(g, b), wc = shape(g, c);
      console.log(`  summer: broadleaf ${sb.h} tall ${sb.w} wide ${sb.leaves} leaves, conifer ${sc.h} tall ${sc.w} wide ${sc.leaves} needles; winter: ${wb.leaves} leaves, ${wc.leaves} needles`);
      check('a conifer is a spire (at most 0.6 as wide as it is tall, and 0.6 of a broadleaf\'s spread for its height)', sc.w / sc.h <= 0.6 && sc.w / sc.h <= 0.6 * sb.w / sb.h && sc.h >= 20, `${(sc.w / sc.h).toFixed(2)} vs ${(sb.w / sb.h).toFixed(2)}`);
      check('a conifer keeps its needles over winter and a broadleaf drops its leaves', wc.leaves >= 0.8 * sc.leaves && wb.leaves <= 0.3 * sb.leaves, `${wc.leaves}/${sc.leaves} vs ${wb.leaves}/${sb.leaves}`);
    }
    // who wins where: on rich soil in a warm valley the broadleaf outgrows a conifer; on a cold upland the conifer the broadleaf
    {
      const sz = (d, n) => { const g = hill(200, d, n); g.clock = Sim.YEAR * 0.45; g.updateClimate(); const b = grow(g, 50, false, 400), c = grow(g, 150, true, 400); for (const t of [b, c]) { t.soil = t.fert; } return [shape(g, b).h, shape(g, c).h]; };
      const [vb, vc] = sz(30, 200), [ub, uc] = sz(62, 80);
      console.log(`  rich valley: broadleaf ${vb} tall, conifer ${vc}; upland: broadleaf ${ub}, conifer ${uc}`);
      check('on rich valley soil the broadleaf grows a quarter taller than the conifer', vb >= 1.25 * vc, `${vb} vs ${vc}`);
      check('on the cold upland the conifer grows half as tall again as the broadleaf', uc >= 1.5 * ub, `${uc} vs ${ub}`);
    }
    // fire: a crown fire runs along a stand of conifers and kills them, and their cones seed the burn; broadleaf crowns burn slower
    {
      const stand = con => { const g = hill(160, 30, 80, 3); g.clock = Sim.YEAR * 0.5; g.updateClimate(); const ts = []; for (let k = 0; k < 6; k++) ts.push(grow(g, 30 + k * 10, con, 200));
        const t0 = ts[0]; let n = 0; for (const [i, c] of t0.cells) if ((c & 1) && n++ < 12) g.set(i, FIRE); g.wakeAll();
        run(g, 1800); const dead = ts.filter(t => t.dead || t.cones || !g.trees.includes(t)).length;
        run(g, 2400); let seeds = 0; for (let i = 0; i < g.type.length; i++) if ((g.type[i] === SEED || g.type[i] === TIP) && (g.life[i] & Sim.CONE)) seeds++;
        return { dead, seeds: seeds + g.trees.filter(t => t.con && !ts.includes(t)).length }; };
      const c = stand(true), b = stand(false);
      console.log(`  conifer stand: ${c.dead} of 6 killed, ${c.seeds} cone seeds and seedlings after; broadleaf stand: ${b.dead} of 6 killed`);
      check('a crown fire kills most of a conifer stand, and more of it than of a broadleaf one', c.dead >= 4 && c.dead > b.dead, `${c.dead} vs ${b.dead}`);
      check('burnt conifers seed the ground after the fire', c.seeds >= 6, `${c.seeds}`);
    }
    // a new world: no tree over its kind's line, and the cold sites go to conifers
    {
      let bad = 0, n = 0; const cold = [], warm = [];
      for (const ox of [0, 1920, 3840, 5440]) { const g = new Sim.Grid(Sim.WORLD.W, Sim.WORLD.H); Sim.generate(g, 12345, Sim.WORLD.WIDE, ox); n += g.trees.length;
        for (const t of g.trees) { if (g.hardy(t.con, t.y) < 0.25) bad++; if (g.hardy(false, t.y) < 0.5) cold.push(t); else if (g.hardy(false, t.y) >= 1) warm.push(t); } }
      const share = a => a.length ? a.filter(t => t.con).length / a.length : 0;
      console.log(`  ${n} trees in four windows: ${cold.length} on cold ground (${(share(cold) * 100).toFixed(0)}% conifers), ${warm.length} in the warm (${(share(warm) * 100).toFixed(0)}%)`);
      check('a new world has no tree over its treeline, conifers on the cold ground and broadleaf in the warm', bad === 0 && share(cold) >= 0.75 && share(warm) <= 0.35, `${bad} over the line, ${share(cold).toFixed(2)} vs ${share(warm).toFixed(2)}`);
    }
  },
  devices() {
    const { SPOUT, DRAIN, HEATER, COOLER, FAN, METAL, ICE, STEAM, SMOKE, GUNP } = Sim.ids;
    const box = (W, H) => { const g = new Sim.Grid(W, H); for (let y = H - 4; y < H; y++) for (let x = 0; x < W; x++) g.set(g.idx(x, y), STONE, g.ambAt(y)); return g; };
    const count = (g, t, x0 = 0, x1 = g.W) => { let n = 0; for (let y = 0; y < g.H; y++) for (let x = x0; x < x1; x++) if (g.type[g.idx(x, y)] === t) n++; return n; };
    // a water spout over a stone basin with a drain in its floor at the far end: the spout keeps pouring, the drain keeps swallowing
    {
      Sim.reseed(11); const g = box(120, 100);
      for (let y = 20; y < 96; y++) { g.set(g.idx(10, y), STONE); g.set(g.idx(110, y), STONE); }   // the basin's walls
      for (let x = 55; x < 65; x++) g.lay(g.idx(x, 10), SPOUT, undefined, WATER);
      run(g, 10 * 60); const filled = count(g, WATER);
      run(g, 10 * 60); const more = count(g, WATER);
      for (let x = 95; x < 105; x++) g.lay(g.idx(x, 95), DRAIN);   // a drain set on the floor
      for (let x = 55; x < 65; x++) g.set(g.idx(x, 10), E);       // and the spout turned off
      run(g, 30 * 60); const left = count(g, WATER, 11, 110);
      console.log(`  water spout: ${filled} cells after 10 s, ${more} after 20 s; drain then left ${left}`);
      check('a spout pours for ever', filled > 1000 && more > filled + 1000);
      check('a drain empties the basin', left < 0.05 * more);
      check('the spout and drain are still there', count(g, DRAIN) === 10);
    }
    // a sand spout heaps sand; a lava spout pours hot lava; an oil spout's oil is oil; a gas spout pours upward
    {
      const n = [], gs = [];
      for (const e of [SAND, LAVA, OIL, SMOKE]) { Sim.reseed(12); const g = box(100, 80); for (let k = 0; k < 4; k++) g.lay(g.idx(48 + k, 40), SPOUT, undefined, e); run(g, 5 * 60); n.push(count(g, e)); gs.push(g); }
      let up = 0, down = 0; for (let y = 0; y < 80; y++) for (let x = 0; x < 100; x++) if (gs[3].type[gs[3].idx(x, y)] === SMOKE) { if (y < 40) up++; else down++; }
      let hot = 0; for (let i = 0; i < gs[1].type.length; i++) if (gs[1].type[i] === LAVA) hot = Math.max(hot, gs[1].temp[i]);
      console.log(`  spouts after 5 s: sand ${n[0]}, lava ${n[1]} (hottest ${hot.toFixed(0)}°), oil ${n[2]}, smoke ${n[3]} (${up} above the spout, ${down} below)`);
      check('spouts pour sand, lava and oil', n[0] > 300 && n[1] > 100 && n[2] > 300 && hot > 1000);
      check('a smoke spout puffs upward', n[3] > 50 && up > 4 * down);
    }
    // a heater under a metal pot boils the water in it away; a cooler laid in a pond freezes it round itself
    {
      Sim.reseed(13); const g = box(100, 80);
      for (let x = 40; x < 60; x++) for (let y = 70; y < 72; y++) g.lay(g.idx(x, y), HEATER);
      for (let x = 38; x < 62; x++) g.lay(g.idx(x, 69), METAL);
      for (let y = 60; y < 69; y++) { g.lay(g.idx(38, y), METAL); g.lay(g.idx(61, y), METAL); }
      for (let y = 63; y < 69; y++) for (let x = 39; x < 61; x++) g.set(g.idx(x, y), WATER, g.ambAt(y));
      const pot = () => { let n = 0; for (let y = 55; y < 69; y++) for (let x = 39; x < 61; x++) n += g.type[g.idx(x, y)] === WATER; return n; };   // (the steam rains out of the sky beside it)
      const w0 = pot();
      run(g, 30 * 60); const w30 = pot(); run(g, 30 * 60); const w1 = pot(), heat = g.temp[g.idx(50, 70)];
      console.log(`  pot on a heater: ${w0} water -> ${w30} after 30 s, ${w1} after a minute; heater at ${heat.toFixed(0)}°`);
      check('a heater boils a pot dry', w1 < 0.2 * w0);
      check('a heater holds its temperature', Math.abs(heat - 400) < 1);
      const h = box(100, 80);
      for (let y = 56; y < 76; y++) for (let x = 0; x < 100; x++) h.set(h.idx(x, y), WATER, 15);
      for (let x = 45; x < 55; x++) for (let y = 70; y < 72; y++) h.lay(h.idx(x, y), COOLER);
      run(h, 30 * 60); const ice = count(h, ICE);
      console.log(`  cooler in a 15° pond: ${ice} ice cells after 30 s; cooler at ${h.temp[h.idx(50, 70)].toFixed(0)}°`);
      check('a cooler freezes the water round it', ice > 40);
    }
    // a fan blowing east carries smoke east, and blows a heap of ash downwind; turned up, it holds ash up in the air
    {
      Sim.reseed(14); const g = box(160, 80); g.windHold = 0;
      for (let y = 60; y < 76; y++) g.lay(g.idx(20, y), FAN, undefined, 0);
      for (let y = 60; y < 76; y++) for (let x = 22; x < 30; x++) g.set(g.idx(x, y), ASH);
      run(g, 5 * 60);
      let sx = 0, n = 0; for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) if (g.type[g.idx(x, y)] === ASH) { sx += x; n++; }
      console.log(`  fan → over a heap of ash at x 22-29: mean x ${(sx / n).toFixed(1)} after 5 s (${n} cells)`);
      check('a fan blows a heap of light powder downwind', sx / n > 34);
      const s = box(160, 80); s.windHold = 0;
      for (let y = 60; y < 76; y++) s.lay(s.idx(150, y), FAN, undefined, 2);   // blowing west
      for (let k = 0; k < 120; k++) s.set(s.idx(135 + k % 12, 62 + (k / 12 | 0)), SMOKE, 20);
      run(s, 2 * 60);
      let mx = 0, m = 0; for (let y = 0; y < s.H; y++) for (let x = 0; x < s.W; x++) if (s.type[s.idx(x, y)] === SMOKE) { mx += x; m++; }
      console.log(`  fan ← into smoke at x 135-146: mean x ${(mx / m).toFixed(1)} after 2 s`);
      check('a fan blows smoke along', mx / m < 132);
    }
    // devices stand through an explosion, keep what they pour and which way they blow through a save, and a boxed-in spout sleeps
    {
      Sim.reseed(15); const g = box(80, 60);
      for (let x = 30; x < 50; x++) { g.lay(g.idx(x, 40), SPOUT, undefined, SAND); g.lay(g.idx(x, 30), FAN, undefined, 3); }
      g.set(g.idx(40, 35), GUNP); g.temp[g.idx(40, 35)] = 300;
      g.step(); g.step();
      const stood = count(g, SPOUT) === 20 && count(g, FAN) === 20;
      const h = new Sim.Grid(80, 60); h.load(g.save());
      let keep = true; for (let x = 30; x < 50; x++) keep = keep && h.type[h.idx(x, 40)] === SPOUT && h.life[h.idx(x, 40)] === SAND && h.life[h.idx(x, 30)] === 3;
      check('devices stand through an explosion', stood);
      check('a save keeps what a spout pours and which way a fan blows', keep);
      const b = box(128, 64);
      for (let y = 20; y < 30; y++) for (let x = 20; x < 30; x++) b.set(b.idx(x, y), STONE);
      b.lay(b.idx(25, 25), SPOUT, undefined, WATER);   // shut inside a block of rock
      run(b, 120); let awake = 0; for (let k = 0; k < 20; k++) { b.step(); awake += b.awakeTiles; }
      console.log(`  a spout shut in rock: ${awake / 20} tiles awake`);
      check('a boxed-in spout lets its block sleep', awake === 0);
    }
  },
  sea() {
    // N7: a streamed world has a salt sea at its west end, with a beach, a salt marsh or cliffs for a coast by its seed (a world one
    // window wide has none). Run with the window on it: the tide comes in and goes out, a swell runs over it, the high tide floods a
    // marsh and the low tide leaves its creeks full, the surf wears a cliff back, and a sunny day draws a breeze in off the sea.
    const { RUBBLE, REED, CLAY } = Sim.ids;
    const world = (seed, wind) => { Sim.reseed(5); const g = new Sim.Grid(Sim.WORLD.W, Sim.WORLD.H); Sim.generate(g, seed, Sim.WORLD.WIDE, 0); if (wind !== undefined) g.windHold = wind; return g; };
    const kinds = {}; for (const seed of [12345, 7, 99, 5, 31, 4242, 17, 2024]) { const g = new Sim.Grid(Sim.WORLD.W, 480); g.worldSeed = seed; g.worldW = Sim.WORLD.WIDE; const c = Sim.terrainOf(g).sea; (kinds[c.kind] = kinds[c.kind] || []).push(seed); }
    console.log(`  coasts by seed: ${Object.entries(kinds).map(([k, v]) => k + ' ' + v.join(',')).join('; ')}`);
    check('each kind of coast comes up', kinds.beach && kinds.marsh && kinds.cliff);
    const narrow = new Sim.Grid(480, 240); Sim.generate(narrow, 99);
    check('a world one window wide has no sea', !narrow.noise.sea && !narrow.type.some(t => t === BRINE));
    const g = world(12345), c = g.noise.sea;
    const top = (g, x) => { let y = c.y - 20; while (y < g.H - 1 && g.type[g.idx(x, y)] !== BRINE && g.type[g.idx(x, y)] !== WATER && (g.type[g.idx(x, y)] === E || Sim.EL[g.type[g.idx(x, y)]].kind === 'gas')) y++; return y; };
    let deep = 0; for (let y = 0; y < g.H; y++) if (g.type[g.idx(5, y)] === BRINE) deep++;
    const EARTH = new Set([SAND, DIRT, CLAY, STONE, RUBBLE]), ground = (g, x) => { let y = 0; while (y < g.H - 1 && !EARTH.has(g.type[g.idx(x, y)])) y++; return y; };
    let trees = g.trees.filter(t => t.x < c.shore + c.wide).length, beach = 0; for (let x = c.shore; x < c.shore + 40; x++) if (g.type[g.idx(x, ground(g, x))] === SAND) beach++;
    console.log(`  seed 12345: ${c.kind}, shore at ${c.shore}, sea ${deep} deep at the edge, ${beach}/40 of the beach sand, ${trees} trees on the coast`);
    check('the sea lies deep at the edge, and its beach is sand with no trees', deep >= 35 && beach >= 38 && trees === 0);
    // the tide over half a day, and the swell on it
    const lv = [], rough = []; run(g, 2000, 25, () => { let s = 0, lo = 1e9, hi = -1e9; for (let x = 60; x < 300; x += 4) { const y = top(g, x); s += y; lo = Math.min(lo, y); hi = Math.max(hi, y); } lv.push(s / 60); rough.push(hi - lo); });
    const range = Math.max(...lv) - Math.min(...lv), sw = rough.reduce((a, b) => a + b) / rough.length;
    console.log(`  the open sea's mean level ranges ${range.toFixed(1)} rows over the tide; the surface spans ${sw.toFixed(1)} rows from trough to crest`);
    check('the tide rises and falls (3.5+ rows)', range >= 3.5);
    check('a swell runs on the sea (crests 3+ rows over the troughs)', sw >= 3);
    // a marsh at high water and at low (seed 99)
    {
      const m = world(99), mc = m.noise.sea; let flood = 0, dry = 0, creek = 0, reeds = 0, n = 0;
      const look = () => { let f = 0, d = 0, k = 0; for (let x = mc.shore + 4; x < mc.shore + mc.wide - 4; x++) { let y = mc.y - 12, reed = false; while (m.type[m.idx(x, y)] === E || Sim.EL[m.type[m.idx(x, y)]].kind === 'gas' || m.type[m.idx(x, y)] === REED) { reed = reed || m.type[m.idx(x, y)] === REED; y++; } if (reed) continue; const t = m.type[m.idx(x, y)]; if (t === BRINE || t === WATER) { if (y < mc.y - 1) f++; else k++; } else d++; } return [f, d, k]; };   // (the open flat between the reeds)
      for (let x = mc.shore; x < mc.shore + mc.wide; x++) for (let y = mc.y - 12; y < mc.y; y++) if (m.type[m.idx(x, y)] === REED) { reeds++; break; }
      const P = Math.round(Sim.DAY * 12.42 / 24), clk = m.clock;
      // high water: the tide peaks a quarter of its period on from a clock at a whole number of periods
      const at = ph => { const k = Math.ceil((m.clock + 1) / P) * P + ph * P - m.clock; run(m, Math.max(1, Math.round(k))); return look(); };
      const hi = at(0.25), lo = at(0.75);
      console.log(`  marsh (${mc.wide} wide, reeds in ${reeds} columns): high water floods ${hi[0]} open columns of the flat (${hi[1]} dry, ${hi[2]} at the creeks' brim); low water leaves ${lo[1]} dry, ${lo[0]} flooded and ${lo[2]} creek columns holding brine`);
      check('a salt marsh stands in reeds', reeds >= 0.25 * mc.wide);
      const open = hi[0] + hi[1] + hi[2];
      check('the high tide floods the marsh and the low tide drains it, leaving its creeks', hi[0] >= 0.6 * open && lo[1] >= 0.6 * open && lo[0] <= 0.1 * open && lo[2] >= 4);
    }
    // the surf wears a cliff back (seed 31, a steady wind)
    {
      const k = world(31, 1), kc = k.noise.sea, face = () => { const f = []; for (let y = kc.y - 5; y <= kc.y + 2; y++) { let x = kc.shore - 8; while (k.type[k.idx(x, y)] !== STONE && x < kc.shore + 40) x++; f.push(x); } return f; };
      const f0 = face(); run(k, 3 * MIN); const back = face().map((x, r) => x - f0[r]);
      console.log(`  cliff (${kc.cliff} high): ${k.seaBroke} cells of rock broken off in three minutes of rough sea; its face worn back ${back.join(' ')} columns by row, from 5 over the mean level to 2 under`);
      check('the surf wears a notch in a cliff at the waterline', k.seaBroke >= 5 && back.filter(b => b >= 1).length >= 2 && back[0] === 0);
    }
    // the sea breeze: in a calm, the low wind near the shore blows onshore at noon and back out at night
    {
      const b = world(12345, 0), bc = b.noise.sea, near = () => { let s = 0, n = 0; for (let cx = ((bc.shore - 200) >> 4); cx <= ((bc.shore + 200) >> 4); cx++) { let cy = 0; while (cy < b.CHh && !b.wsolid[cy * b.CW + cx]) cy++; for (let q = 1; q <= 3; q++) { s += b.uc[(cy - q) * b.CW + cx]; n++; } } return s / n; };
      const to = ph => { const k = ((ph - b.clock % Sim.DAY / Sim.DAY) + 1) % 1 * Sim.DAY; run(b, Math.round(k) || Sim.DAY); return near(); };
      const noon = to(0.25), night = to(0.75);
      console.log(`  wind along the ground near the shore in a calm: ${noon.toFixed(3)} at noon, ${night.toFixed(3)} at night`);
      check('a sea breeze blows in by day and a land breeze out at night', noon > 0.03 && night < noon - 0.03);
    }
  },
  river() {
    // N6: a generated world opens on a river: a spring at the foot of a hill, a sand bed falling steadily to a pond, no trees in the
    // stream. Run, the stream runs the length of its bed into the pond and drops its silt there; it runs high in the spring melt and
    // low late in a dry summer; and a river cut off by the window's edge (or any river in a flat world) doesn't run.
    const { CLAY, MUD, ICE } = Sim.ids, EARTH = new Set([SAND, DIRT, MUD, CLAY, STONE]);
    const ox = Math.floor((Sim.WORLD.WIDE - Sim.WORLD.W) / 2 / Sim.REGION) * Sim.REGION;
    const world = (clock, shift = 0) => { Sim.reseed(3); const g = new Sim.Grid(Sim.WORLD.W, Sim.WORLD.H); Sim.generate(g, 12345, Sim.WORLD.WIDE, ox + shift); g.wetHold = 0; if (clock !== undefined) { g.clock = clock; g.updateClimate(); } return g; };
    const ground = (g, x) => { let y = 0; while (y < g.H - 1 && !EARTH.has(g.type[g.idx(x, y)])) y++; return y; };
    const g = world(), r = g.noise.rivers.find(r => r.head >= ox && r.head < ox + g.W), xs = u => r.head + u * r.dir - g.ox;
    g.riverCols();
    check('a new world opens on a river running in the window', !!r && g.riverOn.length === 1);
    const floor = [], pondU = []; let rises = 0, trees = 0, sand = 0;
    for (let u = 0; u <= r.len + r.pw; u++) { const x = xs(u); floor.push(ground(g, x)); if (u > r.len) pondU.push(u); }
    for (let u = 1; u <= r.len; u++) { if (floor[u] < floor[u - 1]) rises++; if (g.type[g.idx(xs(u), floor[u])] === SAND) sand++; }
    for (const t of g.trees) if ((t.x - (r.head - g.ox)) * r.dir >= 0 && (t.x - (r.head - g.ox)) * r.dir <= r.len) trees++;
    const water = (g, u0, u1) => { let n = 0; for (let u = u0; u <= u1; u++) { const x = xs(u); for (let y = r.headY - 60; y < r.mouthY + 30; y++) { const t = g.type[g.idx(x, y)]; if (t === WATER || t === ICE) n++; } } return n; };
    const pond0 = water(g, r.len + 1, r.len + r.pw);
    console.log(`  river: spring at ${r.head - g.ox}, pond at ${r.mouth - g.ox}, ${r.len} long, falls ${r.mouthY - r.headY}; bed rises ${rises} times, ${sand}/${r.len} sand, ${trees} trees on it, pond ${pond0}`);
    check('its bed falls all the way to the pond, sand, with no tree on it', rises === 0 && sand >= 0.95 * r.len && trees === 0);
    check('its pond starts full', pond0 >= 300);
    run(g, MIN);
    let wet = 0; for (let u = 0; u <= r.len; u++) { const x = xs(u); for (let y = r.headY - 60; y < ground(g, x); y++) if (g.type[g.idx(x, y)] === WATER) { wet++; break; } }
    const pond = water(g, r.len + 1, r.len + r.pw); let silt = 0; for (const u of pondU) silt += Math.max(0, floor[u] - ground(g, xs(u)));
    console.log(`  after a minute: stream on ${wet}/${r.len + 1} columns, pond ${pond}, the pond's floor built up ${silt} cells, springs ${g.springs}`);
    check('the stream runs the length of its bed', wet >= 0.75 * (r.len + 1));
    check('the pond holds its water', pond >= 0.8 * pond0);
    check('the stream drops its silt in the pond (a delta)', silt >= 5);
    // the same river from the spring melt and from late in the dry season (wetness pinned at an ordinary year's)
    const flow = clock => { const h = world(clock); run(h, MIN); return water(h, 0, r.len + r.pw); };
    const melt = flow(Sim.YEAR * 0.15), low = flow(Sim.YEAR * 0.45);
    console.log(`  water in the river and pond a minute on: ${melt} from the spring melt, ${low} from late summer`);
    check('a river runs high in the spring melt and low late in a dry summer', melt > 1.3 * low);
    const cut = world(undefined, Sim.REGION * 2); cut.riverCols();   // (the window moved two regions east: the pond is off its edge)
    const f = new Sim.Grid(400, 300); Sim.flat(f); f.riverCols();
    check('a river cut off by the window\'s edge, or a flat world, has no running spring', cut.riverOn.length === 0 && f.riverOn.length === 0, `${cut.riverOn.length}, ${f.riverOn.length}`);
  },
  presets() {
    // biome presets (X6): New world laid out as each kind of country, at the window it opens on, measured against what it should be
    const { SHRUB, REED, RUBBLE } = Sim.ids, Wd = Sim.WORLD, B = Sim.BIOMES, k = id => B.findIndex(b => b.id === id);
    const make = (id, seed = 12345) => { const g = new Sim.Grid(Wd.W, Wd.H); Sim.generate(g, seed, Wd.WIDE, Sim.homeOf(Wd.WIDE, k(id)), k(id)); return g; };
    const look = g => {
      const o = { surf: 0, water: 0, snow: 0, reed: 0, shrub: 0, lava: 0, trees: g.trees.length, con: g.trees.filter(t => t.con).length, high: 0, arid: [1, 0], wet: 0, dirt: 0 };
      for (let x = 0; x < g.W; x++) {
        let y = 0; for (; y < g.H; y++) { const i = g.idx(x, y), t = g.type[i]; if (g.owner[i] || t === E || t === REED || t === SNOW || Sim.EL[t].kind === 'gas') continue; break; }
        o.surf += y / g.W; if (g.type[g.idx(x, y)] === WATER || g.type[g.idx(x, y)] === BRINE) o.water++;
        for (let d = 1; d <= 6; d++) { const i = g.idx(x, y + d); if (g.type[i] === DIRT) { o.wet += g.life[i] & 255; o.dirt++; } }
        const a = Sim.aridAt(g.worldSeed, g.ox + x, g.biome); o.arid[0] = Math.min(o.arid[0], a); o.arid[1] = Math.max(o.arid[1], a);
      }
      for (let i = 0; i < g.type.length; i++) { const t = g.type[i]; if (t === SNOW) o.snow++; else if (t === REED) o.reed++; else if (t === SHRUB) o.shrub++; else if (t === LAVA) o.lava++; }
      for (const t of g.trees) if (g.hardy(t.con, t.y) < 0.25) o.high++;
      o.wet = Math.round(o.wet / Math.max(1, o.dirt)); o.surf = Math.round(o.surf); return o;
    };
    const say = (id, o) => console.log(`  ${id}: mean ground row ${o.surf}, ${o.water} columns of open water, soil moisture ${o.wet}, aridity ${o.arid.map(a => a.toFixed(2)).join('-')}, trees ${o.trees} (${o.con} conifers, ${o.high} over the treeline), snow ${o.snow}, reeds ${o.reed}, shrubs ${o.shrub}`);
    const tem = look(make('temperate')); say('temperate', tem);
    const alp = look(make('alpine')); say('alpine', alp);
    check('alpine: mountains higher than temperate hills, snow on them, trees in the valleys (conifers among them) and none over the treeline', alp.surf <= tem.surf - 40 && alp.snow >= 300 && alp.trees >= 5 && alp.con >= 1 && alp.high === 0);
    const wet = look(make('wetland')); say('wetland', wet);
    check('wetland: lower and flatter, soaked, with ponds and reed beds, no dry country', wet.surf >= tem.surf + 30 && wet.water >= 200 && wet.reed >= 100 && wet.wet >= tem.wet + 40 && wet.arid[1] === 0);
    const scr = look(make('scrub')); say('scrub', scr);
    check('scrubland: dry all through, shrubs and no trees', scr.arid[0] >= Sim.ARID_SCRUB && scr.shrub >= 500 && scr.trees === 0);
    const cg = make('coast'), co = look(cg); say('coast', co);
    check('coast: opens on the sea\'s shore', cg.noise.sea && cg.noise.sea.shore > cg.ox + 100 && cg.noise.sea.shore < cg.ox + cg.W - 100 && co.water >= 200 && cg.ventCols() < 0);
    // the volcanic island: the volcano in the window, its vent full of lava, quiet as a world opens, erupting at the next period
    const ig = make('island'), is = look(ig), v = ig.noise.volc, vx = ig.ventCols(); say('island', is);
    // (lava and new rock lying over the cone's ground as the world opened, and how far out from the vent it lies)
    const ground0 = []; for (let x = vx - 200; x <= vx + 200; x++) { let y = 0; while (y < ig.H - 1 && !(ig.type[ig.idx(x, y)] === STONE || ig.type[ig.idx(x, y)] === LAVA || ig.type[ig.idx(x, y)] === DIRT || ig.type[ig.idx(x, y)] === SAND)) y++; ground0.push(y); }
    let reach = 0; const above = () => { let n = 0; reach = 0; for (let x = vx - 200; x <= vx + 200; x++) for (let y = 0; y < ground0[x - vx + 200]; y++) { const t = ig.type[ig.idx(x, y)]; if (t === LAVA || t === STONE || t === RUBBLE) { n++; reach = Math.max(reach, Math.abs(x - vx)); } } return n; };
    const lava0 = above(); let quiet = true;
    for (let f = 0; f < Sim.DAY * 0.5; f++) { ig.step(); if (ig.eruption) quiet = false; }
    check('island: the sea on one side, a volcano with a lava-filled vent in the window, quiet at first', v && vx > 0 && is.water >= 200 && is.lava >= 300 && ig.type[ig.idx(vx, v.peakY + v.cd + 20)] === LAVA && quiet && above() - lava0 < 20, `vent at ${vx}, ${is.lava} lava`);
    ig.clock = Sim.DAY * 2 - 60; ig.updateClimate(); let erupted = 0;
    for (let f = 0; f < Sim.DAY / 6 + 600; f++) { ig.step(); if (ig.eruption) erupted++; }
    const grew = above() - lava0, ash = census(ig, Sim.EL).Ash || 0;
    console.log(`  an eruption: ${erupted} ticks, ${grew} cells of lava and new rock over the cone, out to ${reach} columns from the vent, ${ash} ash`);
    check('island: the volcano erupts, and its lava runs out down the cone (not piling up in a spire)', erupted >= 500 && grew >= 600 && reach >= 60);
  },
};
const seasonAt = clock => ['Spring', 'Summer', 'Autumn', 'Winter'][(((clock % Sim.YEAR) / Sim.YEAR) * 4) | 0];

const pick = process.argv.slice(2);
for (const [name, fn] of Object.entries(scenarios)) { if (pick.length && !pick.includes(name)) continue; console.log(`# ${name}`); const t = Date.now(); fn(); console.log(`  (${((Date.now() - t) / 1000).toFixed(1)} s)`); }
if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
