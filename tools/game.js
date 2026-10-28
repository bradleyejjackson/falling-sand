// Stage 5 checks: every scenario can be won by a scripted solution and is not won by doing nothing; budgets, scoring,
// unlocks and scenario save/load behave.
// usage: node tools/game.js [scenario id...]   (VERBOSE=1 prints goal values as it runs; SEED=n plays them on another random stream)
const { loadSim } = require('./load');
const Sim = loadSim(process.env.SIMFILE);
const { BOX, SCENARIOS, Game } = Sim;
const { E, STONE, GUNP, FIRE, EMBER, WATER, DIRT, SEED, WOOD, SAND, CLAY, LAVA } = Sim.ids;
let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); if (!ok) failed++; };
const byId = id => SCENARIOS.find(s => s.id === id);

// paint a filled rectangle (box coordinates) through the game, the way the brush does; returns cells placed
function paintRect(game, x0, y0, x1, y1, t) { let n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) n += game.paint(game.g.idx(BOX.x + x, BOX.y + y), t) ? 1 : 0; return n; }
// play a scenario: `moves` maps a tick to a function run before that tick's step; stops when it is decided
function play(id, moves = {}, max) {
  const sc = process.env.SEED ? { ...byId(id), seed: +process.env.SEED } : byId(id);   // SEED=n replays every scenario on another random stream (sweeps)
  const g = new Sim.Grid(Sim.WORLD.W, Sim.WORLD.H), game = Game.start(g, sc);
  const end = max || game.sc.time + 10;
  for (let f = 0; f < end && game.state === 'play'; f++) {
    if (moves[f]) moves[f](game);
    g.step(); game.tick();
    if (process.env.VERBOSE && f % 600 === 0) console.log(`    t=${(f / 60) | 0}s`, game.goals.map(c => c.label + '=' + c.value).join(', '), game.fails.map(c => c.label + '=' + c.value).join(', '));
  }
  return game;
}
const summary = game => `${game.state}${game.why ? ' (' + game.why + ')' : ''} at ${(game.t / 60).toFixed(1)} s; ` +
  game.goals.concat(game.fails).map(c => `${c.label} ${c.value}`).join(', ') + `; score ${game.score}, reaction points ${game.points | 0}`;

// Volcano: every half second, a water blob dropped just above the first lava cell open to the air, the way a player chases it
function quench(game) {
  const g = game.g;
  for (let y = 1; y < BOX.h; y++) for (let x = 0; x < BOX.w; x++) {
    const i = g.idx(BOX.x + x, BOX.y + y); if (g.type[i] !== LAVA) continue;
    const a = g.type[i - g.W]; if (a !== E && Sim.EL[a].kind !== 'gas') continue;
    paintRect(game, x - 4, y - 12, x + 4, y - 8, WATER); return;
  }
}
const BEDS = [30, 80, 130, 180, 230, 280];
const solutions = {
  irrigate: { 30: game => paintRect(game, 60, 112, 70, 130, E) },
  lava: {
    30: game => { paintRect(game, 64, 145, 78, 150, STONE); },   // a lid over the lava well
    60: game => { paintRect(game, 122, 150, 129, 156, E); paintRect(game, 60, 112, 66, 130, E); },
  },
  blast: {
    30: game => paintRect(game, 148, 136, 158, 150, GUNP),
    120: game => paintRect(game, 158, 145, 168, 150, FIRE),   // at the foot of the pile, which slumps differently each time
  },
  fire: {
    30: game => { paintRect(game, 150, 120, 200, 150, E); },   // clear a firebreak: grass and the trees in it
  },
  grow: {
    30: game => { for (const x of [80, 120, 160, 200, 240]) paintRect(game, x - 10, 108, x + 10, 116, DIRT); },
    300: game => { for (const x of [80, 120, 160, 200, 240]) paintRect(game, x - 9, 80, x + 9, 96, WATER); },
    1500: game => { for (const x of [80, 120, 160, 200, 240]) paintRect(game, x, 60, x + 1, 61, SEED); },
  },
  flood: { 60: game => { paintRect(game, 102, 90, 110, 125, CLAY); paintRect(game, 110, 90, 124, 130, SAND); } },   // a dam with a clay core across the hillside: the river backs up into the quarry
  volcano: Object.fromEntries(Array.from({ length: 190 }, (_, k) => [300 + 30 * k, quench])),
  desert: {
    30: game => { for (const x of BEDS) paintRect(game, x - 10, 100, x + 10, 103, CLAY); },   // clay pans, dropped onto the dunes
    120: game => { for (const x of BEDS) paintRect(game, x - 10, 90, x + 10, 97, DIRT); },
    300: game => { for (const x of BEDS) paintRect(game, x - 8, 70, x + 8, 77, WATER); },
    1500: game => { for (const x of BEDS) { paintRect(game, x - 4, 60, x - 3, 61, SEED); paintRect(game, x + 4, 60, x + 5, 61, SEED); } },
  },
};
// Firebreak with water only: every 20 ticks, a water blob dropped just above the westmost column that is really burning
// (three burning cells in three columns, so stray flames in the air don't draw it), the way a player chases the fire front
function douse(game) {
  const g = game.g, col = new Int32Array(BOX.w), top = new Int32Array(BOX.w).fill(BOX.h);
  for (let y = 100; y < 150; y++) for (let x = 0; x < BOX.w; x++) { const t = g.type[g.idx(BOX.x + x, BOX.y + y)]; if (t === FIRE || t === EMBER) { col[x]++; top[x] = Math.min(top[x], y); } }
  for (let x = 1; x < BOX.w - 1; x++) if (col[x - 1] + col[x] + col[x + 1] >= 3) { paintRect(game, x - 1, top[x] - 8, x + 6, top[x] - 2, WATER); return; }
}
// (measured over 22 play styles and timings, water alone won 21; it is chaotic, so this is one of the winning timings. Since the
// wind leans fires, 14 of 18 styles win, against 16 of 18 before, and this timing wins on both)
const water = { fire: Object.fromEntries(Array.from({ length: 200 }, (_, k) => [20 + 15 * k, douse])) };   // (the first 50 s)
const naive = {   // the obvious wrong move, where there is one
  grow: { 30: game => { for (const x of [80, 120, 160, 200, 240]) paintRect(game, x - 9, 80, x + 9, 96, WATER); }, 300: game => { for (const x of [80, 120, 160, 200, 240]) paintRect(game, x, 60, x + 1, 61, SEED); } },
  lava: { 60: game => { paintRect(game, 122, 150, 129, 156, E); paintRect(game, 60, 112, 66, 130, E); } },
  flood: { 60: game => { paintRect(game, 196, 132, 204, 160, CLAY); paintRect(game, 186, 132, 196, 160, SAND); paintRect(game, 204, 132, 214, 160, SAND); } },   // a levee round the town alone: overtopped
  volcano: { 300: game => paintRect(game, 90, 0, 130, 50, WATER) },   // all the water at once: it crusts the top, and the lava breaks out again
  desert: {   // beds with no clay under them: the water drains into the sand
    120: game => { for (const x of BEDS) paintRect(game, x - 10, 90, x + 10, 97, DIRT); },
    300: game => { for (const x of BEDS) paintRect(game, x - 8, 70, x + 8, 77, WATER); },
    1500: game => { for (const x of BEDS) { paintRect(game, x - 4, 60, x - 3, 61, SEED); paintRect(game, x + 4, 60, x + 5, 61, SEED); } },
  },
};

const tests = {};
for (const sc of SCENARIOS) tests[sc.id] = () => {
  const t0 = Date.now();
  const won = play(sc.id, solutions[sc.id]);
  console.log(`  solution: ${summary(won)}  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  check(`${sc.name}: the scripted solution wins`, won.state === 'won', won.why);
  const idle = play(sc.id, {});
  console.log(`  doing nothing: ${summary(idle)}`);
  check(`${sc.name}: doing nothing does not win`, idle.state === 'lost');
  if (water[sc.id]) { const w = play(sc.id, water[sc.id]); console.log(`  water only: ${summary(w)}`); check(`${sc.name}: water alone can win`, w.state === 'won', w.why); }
  if (naive[sc.id]) { const n = play(sc.id, naive[sc.id]); console.log(`  naive: ${summary(n)}`); check(`${sc.name}: the naive move loses`, n.state === 'lost', n.why); }
};
tests.budget = () => {
  const g = new Sim.Grid(Sim.WORLD.W, Sim.WORLD.H), game = Game.start(g, byId('irrigate'));
  const n = paintRect(game, 0, 0, 320, 200, E);
  check('erasing stops at the budget', n === 120 && game.left('Erase') === 0, `${n} erased`);
  check('elements outside the budget cannot be placed', paintRect(game, 100, 10, 110, 20, WATER) === 0);
  check('painting outside the box does nothing', !game.paint(g.idx(10, 10), E));
};
tests.score = () => {
  // fire on wood makes ember, charcoal, ash, smoke: the chain multiplier climbs, and painting the wood scores nothing itself
  const g = new Sim.Grid(Sim.WORLD.W, Sim.WORLD.H), sc = Object.assign({}, byId('irrigate'), { budget: { Wood: 2000, Fire: 50 }, goals: [], time: 3600 });
  const game = Game.start(g, sc); game.goals = [{ label: 'never', count: 'Glass', rect: [0, 0, 320, 200], min: 1, ids: [Sim.ids.GLASS], value: 0 }];
  paintRect(game, 100, 117, 160, 150, WOOD); g.step(); game.tick();
  check('painting is not scored as a reaction', game.points === 0, `${game.points}`);
  paintRect(game, 94, 141, 100, 150, FIRE);
  let top = 1; for (let f = 0; f < 1800; f++) { g.step(); game.tick(); top = Math.max(top, game.mult); }
  check('burning wood builds a reaction chain', top >= 2 && game.points > 100, `best multiplier ×${top}, ${game.points | 0} points, chain ${game.chainNames.join(' ')}`);
};
tests.sources = () => {
  // a source pours into the empty cells of its rectangle, only while it runs, and stops when the rectangle is filled in
  const g = new Sim.Grid(Sim.WORLD.W, Sim.WORLD.H), base = Object.assign({}, byId('irrigate'), { goals: [], fails: [], time: 3600, budget: { Stone: 400 } });
  const sc = Object.assign({}, base, { sources: [{ el: 'Water', rect: [200, 20, 220, 30], from: 10, to: 70, rate: 3 }] });
  const game = Game.start(g, sc), water = () => game.measure({ count: 'Water', rect: [150, 0, 320, 200], ids: [WATER] });   // (the reservoir is on the left)
  for (let f = 0; f < 10; f++) { g.step(); game.tick(); }
  const before = water();
  for (let f = 0; f < 60; f++) { g.step(); game.tick(); }
  const during = water();
  for (let f = 0; f < 60; f++) { g.step(); game.tick(); }
  check('a source pours only while it runs', during - before >= 150 && water() <= during && game.points === 0, `${before} -> ${during} -> ${water()} water; ${game.points} points`);
  const g2 = new Sim.Grid(Sim.WORLD.W, Sim.WORLD.H), game2 = Game.start(g2, sc);
  paintRect(game2, 200, 20, 220, 30, STONE);
  for (let f = 0; f < 80; f++) { g2.step(); game2.tick(); }
  const left = game2.measure({ count: 'Water', rect: [150, 0, 320, 200], ids: [WATER] });
  check('a filled-in source stops', left <= before, `${left} water (${before} with the source not yet running)`);
  // open-to-the-air counting: lava under a stone lid is not open
  const g3 = new Sim.Grid(Sim.WORLD.W, Sim.WORLD.H), game3 = Game.start(g3, base);
  paintRect(game3, 100, 140, 110, 150, STONE);
  for (let y = 145; y < 150; y++) for (let x = 100; x < 110; x++) g3.set(g3.idx(BOX.x + x, BOX.y + y), LAVA);
  for (let x = 120; x < 125; x++) g3.set(g3.idx(BOX.x + x, BOX.y + 149), LAVA);
  check('lava open to the air is counted, lidded lava is not', game3.measure(game3.prep({ open: 'Lava', rect: [0, 0, 320, 200] })) === 5);
};
tests.survive = () => {
  // a survive scenario is not won early by holding its goals, only at the end of its clock
  const g = new Sim.Grid(Sim.WORLD.W, Sim.WORLD.H), sc = Object.assign({}, byId('irrigate'), { survive: true, time: 600, fails: [], goals: [{ label: 'Dry', count: 'Water', rect: [150, 150, 230, 185], max: 10 }] });
  const game = Game.start(g, sc);
  for (let f = 0; f < 590; f++) { g.step(); game.tick(); }
  const mid = game.state;
  for (let f = 0; f < 20; f++) { g.step(); game.tick(); }
  check('a survive scenario is won when its clock runs out, not before', mid === 'play' && game.state === 'won' && game.score >= 1250, `${mid} -> ${game.state}, score ${game.score}`);
  const back = Game.load(new Sim.Grid(Sim.WORLD.W, Sim.WORLD.H), Game.start(new Sim.Grid(Sim.WORLD.W, Sim.WORLD.H), byId('volcano')).save());
  check('a save keeps survive, sources and hold', back.sc.hold === 300 && back.sources.length === 1 && back.sources[0].temp === 1500 &&
    Game.load(new Sim.Grid(Sim.WORLD.W, Sim.WORLD.H), Game.start(new Sim.Grid(Sim.WORLD.W, Sim.WORLD.H), byId('flood')).save()).sc.survive === true);
};
tests.unlocks = () => {
  const none = Sim.unlocked({}), one = Sim.unlocked({ best: { irrigate: 1500 } });
  check('the sandbox starts with the starter rack', none.size === Sim.STARTER.length && !none.has('Lava'));
  check('winning a scenario unlocks its elements', one.has('Oil') && one.has('Ice') && !one.has('Lava'));
  check('scenarios open in order', Sim.scenarioOpen({}, 0) && !Sim.scenarioOpen({}, 1) && Sim.scenarioOpen({ best: { irrigate: 1 } }, 1));
  const all = new Set(Sim.STARTER); for (const s of SCENARIOS) for (const n of s.unlocks) all.add(n);
  const rack = Sim.EL.filter(e => !['Empty', 'Root', 'Ember'].includes(e.name)).map(e => e.name);
  check('every rack element is unlocked by the last scenario', rack.every(n => all.has(n)), rack.filter(n => !all.has(n)).join(' '));
};
tests.saveload = () => {
  const g = new Sim.Grid(Sim.WORLD.W, Sim.WORLD.H), game = Game.start(g, byId('lava'));
  paintRect(game, 64, 145, 78, 150, STONE);
  for (let f = 0; f < 200; f++) { g.step(); game.tick(); }
  const text = game.save();
  const g2 = new Sim.Grid(Sim.WORLD.W, Sim.WORLD.H), back = Game.load(g2, text);
  check('a scenario save restores the time, budget and goals', back.t === game.t && back.left('Stone') === game.left('Stone') && back.sc.goals[0].min === 250 && back.fails.length === 1,
    `t ${back.t}, stone left ${back.left('Stone')}, ${(text.length / 1024) | 0} KB`);
  let same = 0; for (let i = 0; i < g.type.length; i++) if (g.type[i] === g2.type[i]) same++;
  check('and the world', same === g.type.length, `${same}/${g.type.length}`);
  check('scenario text is told apart from world text', Sim.isScenario(text) && !Sim.isScenario(g.save()));
  // a hand-made scenario: any world plus goals written as JSON
  const custom = JSON.parse(text); custom.def = { id: 'mine', name: 'Mine', brief: 'Fill it', time: 600, budget: { Water: 50 }, goals: [{ label: 'Water', count: 'Water', rect: [0, 0, 320, 200], min: 1 }], fails: [] };
  const m = Game.load(new Sim.Grid(Sim.WORLD.W, Sim.WORLD.H), JSON.stringify(custom));
  check('a hand-written scenario loads', m.sc.name === 'Mine' && m.left('Water') === 50 && m.goals[0].value > 0);
};

const pick = process.argv.slice(2);
for (const [name, fn] of Object.entries(tests)) { if (pick.length && !pick.includes(name)) continue; console.log(`# ${name}`); fn(); }
if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
