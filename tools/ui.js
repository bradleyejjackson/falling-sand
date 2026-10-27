// Runs the whole page against a stub DOM and pokes the UI paths: rack, painting, views, save/load, export/import, and
// panning far enough that the world streams. Runs twice: with the cell pass on this thread, and on worker threads.
// usage: node tools/ui.js [serial|threads]
const { loadPage, census } = require('./load');
let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); if (!ok) failed++; };

function suite(threads) {
  console.log(`# ${threads ? 'worker threads' : 'one thread'}`);
  const p = loadPage(undefined, { threads });
  const { g, Sim, pool } = p.sf;
  if (threads) { const n = p.ready(); check('the page starts its worker threads', pool.n > 0 && n === pool.n, `${n} of ${pool.n} ready`); }
  else check('without workers the page says why it runs on one thread', pool.n === 0 && pool.why === 'no workers here', pool.why);

  p.run(40);
  check('stats show the season and time', /^(Spring|Summer|Autumn|Winter), day \d+, \d\d:\d\d, [+-]?\d+°$/.test(p.els.clock.textContent), p.els.clock.textContent);
  check('stats show the threads', threads ? /^\d worker threads/.test(p.els.threads.textContent) : /^1 thread/.test(p.els.threads.textContent), p.els.threads.textContent);
  const names = p.created.filter(e => e.className === 'el').map(e => e.innerHTML.replace('<i></i>', ''));
  check('Dirt and Litter are in the rack', names.includes('Dirt') && names.includes('Litter'), names.join(' '));

  // paint a dirt bed then a seed onto it through pointer events, in an empty area of sky
  const btn = n => p.created.find(e => e.className === 'el' && e.innerHTML.endsWith(n));
  const cv = p.els.c;
  const at = (vx, vy) => ({ clientX: vx, clientY: vy, button: 0, pointerId: 1 });
  p.run(1); g.clear();
  btn('Dirt').fire('click');
  for (let vx = 100; vx <= 220; vx += 4) { cv.fire('pointerdown', at(vx, 180)); cv.fire('pointerup', at(vx, 180)); }
  p.run(600);   // (the bed takes a while to settle; a seed sown while it is still falling gets buried)
  const c1 = census(g, Sim.EL);
  check('painting dirt places damp dirt', c1.Dirt > 300 && [...g.type].some((t, i) => t === Sim.ids.DIRT && (g.life[i] & 255) >= 60), `${c1.Dirt} cells`);
  btn('Seed').fire('click');
  p.els.brush.value = '1'; p.els.brush.fire('input');
  for (const vx of [130, 160, 190]) { cv.fire('pointerdown', at(vx, 100)); p.run(8); cv.fire('pointerup', at(vx, 100)); }   // (a click held for a few frames)
  p.run(1); check('a seed click sows one seed', census(g, Sim.EL).Seed === 3, `${census(g, Sim.EL).Seed} seeds`);
  p.run(1200);
  check('seeds dropped on painted dirt become trees', g.trees.length >= 1, `${g.trees.length} trees`);

  for (const id of ['moistview', 'heatview', 'windview', 'showchunks']) { p.els[id].fire('click'); p.run(3); p.els[id].fire('click'); }
  p.run(3);
  check('view toggles render without errors', true);

  p.run(1); p.els.save.fire('click'); p.run(1); const saved = p.store['sandfall.world'];
  check('save writes a 7-part world', saved && saved.split('|').length === 7, p.els.msg.textContent);
  const trees = g.trees.length; p.run(1); g.clear(); p.els.load.fire('click'); p.run(1);
  check('load restores trees', g.trees.length === trees, `${g.trees.length}/${trees}; ${p.els.msg.textContent}`);
  p.els.export.fire('click'); p.run(1); const text = p.els.iotext.value;
  p.run(1); g.clear(); p.els.import.fire('click'); p.run(1);
  check('export/import round-trips', p.els.msg.textContent === 'Imported' && g.trees.length === trees, p.els.msg.textContent);
  p.els.newworld.fire('click'); p.run(60);
  check('new world generates with dirt and trees', (census(g, Sim.EL).Dirt || 0) > 1000 && g.trees.length > 5, `${census(g, Sim.EL).Dirt} dirt, ${g.trees.length} trees`);
  check('the world is eight windows wide and starts in the middle', g.worldW === 7680 && g.ox > 0 && /7680/.test(p.els.dims.textContent), `${p.els.dims.textContent}, window at ${g.ox}`);

  // walk right with the keyboard: the window streams along; walk back and the land is as we left it
  const ox0 = g.ox, here = Array.from(g.type);
  p.window.fire('keydown', { key: 'd' }); p.run(480); p.window.fire('keyup', { key: 'd' });
  const ox1 = g.ox, stored = g.store.size;
  check('panning right streams the window along the world', ox1 >= ox0 + 3 * Sim.REGION && stored >= 3, `window ${ox0} -> ${ox1}, ${stored} regions stored; ${p.els.cam.textContent}`);
  check('trees keep growing in the new land', g.trees.length > 5, `${g.trees.length} trees`);
  p.window.fire('keydown', { key: 'a' }); for (let k = 0; k < 2000 && g.ox > ox0; k++) p.run(1); p.window.fire('keyup', { key: 'a' }); p.run(2);
  // (the exact round trip is checked in validate.js stream; here the land lives on for the frames it is in the window)
  let same = 0; for (let i = 0; i < here.length; i++) if (here[i] === g.type[i]) same++;
  check('panning back brings the first land back', g.ox === ox0 && same / here.length > 0.95, `${(100 * same / here.length).toFixed(1)}% of cells the same type`);
  p.run(1); p.els.save.fire('click'); p.run(1); const big = p.store['sandfall.world'];
  check('a streamed world saves', big && big.split('|').length === 7, `${(big.length / 1024) | 0} KB, ${p.els.msg.textContent}`);

  // scenarios: the Play row, a budgeted rack, winning through the brush, unlocks, and saving a scenario in progress
  const scn = n => p.created.find(e => e.className === 'el scn' && e.innerHTML.includes(n));
  check('the sandbox rack starts with the starter elements only', btn('Lava').disabled && !btn('Water').disabled && /Lava crossing/.test(btn('Lava').title), btn('Lava').title);
  check('only the first scenario is open', !scn('Irrigation').disabled && scn('Lava crossing').disabled);
  scn('Irrigation').fire('click'); p.run(2);
  const game = p.sf.game();
  check('a scenario opens with its mission and a budgeted rack', game && p.els.mission.classList.contains('on') && /Erase <b>120<\/b>/.test(btn('Erase <b>120</b>') ? btn('Erase <b>120</b>').innerHTML : '') && btn('Water').style.display === 'none',
    `${p.els.mname.textContent}; ${p.created.filter(e => e.className === 'el' && e.style.display !== 'none').map(e => e.innerHTML.replace('<i></i>', '')).join(', ')}`);
  btn('Erase <b>120</b>').fire('click'); p.els.brush.value = '3'; p.els.brush.fire('input');
  for (const vy of [114, 118, 122, 126, 129]) for (const vx of [62, 66]) { cv.fire('pointerdown', at(vx, vy)); cv.fire('pointerup', at(vx, vy)); p.run(1); }
  check('erasing through the brush spends the budget', game.left('Erase') < 120 && /Erase <b>\d+<\/b>/.test(p.created.find(e => e.className === 'el' && e.innerHTML.startsWith('<i></i>Erase')).innerHTML), `${game.left('Erase')} left`);
  for (let k = 0; k < 4000 && game.state === 'play'; k++) p.run(1);
  p.run(2);
  check('the scenario is won and the banner says so', game.state === 'won' && p.els.banner.classList.contains('on') && /Scenario won/.test(p.els.bannerh.textContent), `${game.state} ${game.why} at ${(game.t / 60).toFixed(0)} s; ${p.els.bannerp.textContent}`);
  check('winning records the best score and opens the next scenario', p.sf.progress().best.irrigate === game.score && !scn('Lava crossing').disabled && /best/.test(scn('Irrigation').innerHTML));
  check('the banner offers the next scenario', p.els.banneracts.children.some(b => /Next: Lava crossing/.test(b.textContent)));
  p.els.banneracts.children.find(b => /Next/.test(b.textContent)).fire('click'); p.run(2);
  const g2 = p.sf.game();
  check('Next starts the next scenario', g2 && g2.sc.id === 'lava' && !p.els.banner.classList.contains('on') && btn('Stone <b>250</b>'));
  p.run(30); p.els.save.fire('click'); p.run(1); const ss = p.store['sandfall.world'];
  check('saving in a scenario saves the scenario', ss && ss[0] === '{' && JSON.parse(ss).def.id === 'lava', p.els.msg.textContent);
  p.els.leave.fire('click'); p.run(2);
  check('Sandbox leaves the scenario, with its unlocks', !p.sf.game() && !p.els.mission.classList.contains('on') && !btn('Oil').disabled && btn('Lava').disabled && g.worldW === 7680);
  p.els.load.fire('click'); p.run(2);
  check('loading the save resumes the scenario', p.sf.game() && p.sf.game().sc.id === 'lava' && p.sf.game().t >= 30, p.els.msg.textContent);
  p.els.leave.fire('click'); p.run(2);

  // Green the valley played through the brush at its default size: a dirt bed (the budget covers two thirds of the valley),
  // water over it, five seed clicks on the soil.
  // (a seed click used to fill the whole brush circle, so the first one spent all ten seeds in one clump: one tree)
  const unlock = p.created.find(e => e.id === 'unlockall');
  unlock.fire('click'); scn('Green the valley').fire('click'); p.run(2);
  const gv = p.sf.game(), box = Sim.BOX, cy = by => (by + 40) / 1.2;   // box y to canvas y (the view shows 40 rows of sky over the box)
  p.els.brush.value = '4'; p.els.brush.fire('input');
  const sweep = (y0, x0, x1) => { cv.fire('pointerdown', at(x0, cy(y0))); for (let x = x0; x <= x1; x += 3) { cv.fire('pointermove', at(x, cy(y0))); p.run(1); } cv.fire('pointerup', at(x1, cy(y0))); };
  btn('Dirt <b>1200</b>').fire('click'); sweep(125, 60, 260); p.run(120);
  btn('Water <b>900</b>').fire('click'); sweep(110, 60, 260); p.run(300);
  btn('Seed <b>10</b>').fire('click');
  cv.fire('pointerdown', at(70, cy(100))); p.run(8); cv.fire('pointerup', at(70, cy(100))); p.run(1);
  check('one seed click sows one seed', gv.left('Seed') === 9, `${10 - gv.left('Seed')} sown`);
  for (const x of [95, 120, 145, 170]) { cv.fire('pointerdown', at(x, cy(100))); cv.fire('pointerup', at(x, cy(100))); p.run(1); }
  for (let k = 0; k < 7200 && gv.state === 'play'; k++) p.run(1);
  check('Green the valley is won through the brush', gv.state === 'won', `${gv.state} ${gv.why} at ${(gv.t / 60).toFixed(0)} s; ${gv.goals[0].value} tall trees; seeds left ${gv.left('Seed')}`);
  p.els.leave.fire('click'); unlock.fire('click'); p.run(2);
  p.close();
}
const mode = process.argv[2];
if (mode !== 'threads') suite(false);
if (mode !== 'serial') suite(true);
if (failed) { console.log(`${failed} UI check(s) failed`); process.exit(1); }
