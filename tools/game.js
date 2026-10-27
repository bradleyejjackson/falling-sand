// Stage 5 checks: every scenario can be won by a scripted solution and is not won by doing nothing; budgets, scoring,
// unlocks and scenario save/load behave.
// usage: node tools/game.js [scenario id...]   (VERBOSE=1 prints goal values as it runs)
const { loadSim } = require('./load');
const Sim = loadSim(process.env.SIMFILE);
const { BOX, SCENARIOS, Game } = Sim;
const { E, STONE, GUNP, FIRE, WATER, DIRT, SEED, WOOD } = Sim.ids;
let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); if (!ok) failed++; };
const byId = id => SCENARIOS.find(s => s.id === id);

// paint a filled rectangle (box coordinates) through the game, the way the brush does; returns cells placed
function paintRect(game, x0, y0, x1, y1, t) { let n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) n += game.paint(game.g.idx(BOX.x + x, BOX.y + y), t) ? 1 : 0; return n; }
// play a scenario: `moves` maps a tick to a function run before that tick's step; stops when it is decided
function play(id, moves = {}, max) {
  const g = new Sim.Grid(Sim.WORLD.W, Sim.WORLD.H), game = Game.start(g, byId(id));
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
};
const naive = {   // the obvious wrong move, where there is one
  grow: { 30: game => { for (const x of [80, 120, 160, 200, 240]) paintRect(game, x - 9, 80, x + 9, 96, WATER); }, 300: game => { for (const x of [80, 120, 160, 200, 240]) paintRect(game, x, 60, x + 1, 61, SEED); } },
  lava: { 60: game => { paintRect(game, 122, 150, 129, 156, E); paintRect(game, 60, 112, 66, 130, E); } },
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
