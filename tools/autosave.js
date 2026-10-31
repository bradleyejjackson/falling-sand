// The autosave: a page keeps its world in IndexedDB as it runs and when it is hidden or closed, and a second page on the same
// database (a refresh) picks up the same world, clock, camera and settings; a scenario keeps its progress; a link to something
// else wins over the save; Autosave: off forgets it. Also reports how big a save of a fully explored world gets.
// usage: node tools/autosave.js [serial|threads]
const { loadPage, census, fakeIDB } = require('./load');
let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); if (!ok) failed++; };
const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; };   // (a load re-seats a tree or two: a cell may differ)
const rec = idb => idb.data.get('saves') && idb.data.get('saves').get('last');
let EL;

async function page(idb, opts = {}) { const p = loadPage(process.env.SIMFILE, Object.assign({ idb }, opts)); await p.started; if (opts.threads) p.ready(); return p; }

async function suite(threads) {
  console.log(`# ${threads ? 'worker threads' : 'one thread'}`);
  const idb = fakeIDB();
  let a = await page(idb, { threads }); EL = a.sf.Sim.EL;
  check('a first visit starts a new world', a.sf.g.worldSeed && !rec(idb), a.els.msg.textContent);
  a.run(30);
  a.wait(31000); a.run(2); await null; await null;
  check('it saves itself after half a minute', rec(idb) && rec(idb).kind === 'world', rec(idb) ? (rec(idb).text.length / 1e6).toFixed(2) + ' MB of text' : 'nothing saved');

  // set the page up: water chosen, speed ×2, the brush at 9, then hide the page
  const { g, Sim } = a.sf;
  a.created.find(e => e.className === 'el' && e.innerHTML.endsWith('Water')).fire('click');
  a.els.speed.fire('click'); a.els.brush.value = '9'; a.els.brush.fire('input');
  a.els.pause.fire('click'); a.run(3);
  const cam = a.sf.cam(), clock = g.clock, seed = g.worldSeed, ox = g.ox;
  a.document.visibilityState = 'hidden'; a.document.fire('visibilitychange'); await null; await null;
  const before = g.type.slice(); a.close();

  let b = await page(idb, { threads }); b.run(2);
  const h = b.sf.g;
  check('a refresh brings the world back cell for cell', diff(h.type, before) <= 16, `${diff(h.type, before)} cells differ; seed ${h.worldSeed}/${seed}, window at ${h.ox}/${ox}`);
  check('and the clock', h.clock === Math.round(clock), `${h.clock}/${clock}`);
  check('and the camera', b.sf.cam().x === cam.x && b.sf.cam().y === cam.y, JSON.stringify(b.sf.cam()) + ' / ' + JSON.stringify(cam));
  check('and the element, brush, speed and pause', b.sf.ui.current() === Sim.ids.WATER && b.els.brush.value == 9 && b.els.speed.textContent === 'Speed ×2' && b.els.pause.textContent === 'Resume', [b.sf.ui.current(), b.els.brush.value, b.els.speed.textContent, b.els.pause.textContent].join(', '));
  check('it says so', /^Picked up where you left off/.test(b.els.msg.textContent), b.els.msg.textContent);
  check('and the seed box shows the world\'s seed', b.els.seedin.value == seed, b.els.seedin.value);

  // explore the whole world, so every region is stored, and save on the way out (pagehide)
  b.els.pause.fire('click'); b.run(1);
  while (h.shift(1)); while (h.shift(-1));
  b.window.fire('pagehide'); await null; await null;
  const big = rec(idb).text.length;
  check('a fully explored world saves on pagehide', h.store.size >= h.worldW / Sim.REGION - 3, `${h.store.size} regions stored, ${(big / 1e6).toFixed(2)} MB of text`);
  const explored = h.type.slice(), keys = [...h.store.keys()].sort().join(); b.close();
  let c = await page(idb, { threads });
  check('and comes back with every region', [...c.sf.g.store.keys()].sort().join() === keys && diff(c.sf.g.type, explored) <= 16, `${c.sf.g.store.size} regions, ${diff(c.sf.g.type, explored)} cells differ`);

  // a scenario keeps its progress
  c.scn = n => c.created.find(e => e.className === 'el scn' && e.innerHTML.includes(n));
  c.scn('Irrigation').fire('click'); c.run(120);
  const game = c.sf.game(), gt = game.t, gs = game.sc.id;
  c.document.visibilityState = 'hidden'; c.document.fire('visibilitychange'); await null; await null; c.close();
  let s2 = await page(idb, { threads }); s2.run(1);
  const g2 = s2.sf.game();
  check('a scenario comes back with its clock and mission', g2 && g2.sc.id === gs && Math.abs(g2.t - gt) <= 2 && s2.els.mission.classList.contains('on'), g2 ? `${g2.sc.id} at ${g2.t}/${gt}` : 'no scenario');
  s2.els.leave.fire('click'); s2.run(1); s2.close();

  // a link to something else wins; Autosave: off forgets
  let d = await page(idb, { threads, hash: '#world=424242' }); d.run(1);
  check('a link to another world opens that world, not the save', d.sf.g.worldSeed === 424242, `${d.sf.g.worldSeed}`);
  d.window.fire('pagehide'); await null; await null; d.close();
  let e = await page(idb, { threads, hash: '#world=424242' }); e.run(1);
  check('refreshing that link brings back the saved world', /^Picked up/.test(e.els.msg.textContent), e.els.msg.textContent);
  e.els.autosave.fire('click'); await null; await null;
  check('Autosave: off forgets the saved world', !rec(idb) && e.els.autosave.textContent === 'Autosave: off' && e.store['sandfall.autosave'] === 'off', e.els.autosave.textContent);
  const store = Object.assign({}, e.store); e.close();
  let f = await page(idb, { threads, store }); f.run(1);
  check('and the next visit starts a new world, with autosave still off', !/^Picked up/.test(f.els.msg.textContent) && f.els.autosave.textContent === 'Autosave: off', f.els.msg.textContent);
  f.wait(31000); f.run(2); await null;
  check('and saves nothing', !rec(idb));
  f.els.autosave.fire('click'); f.run(1); await null; await null;
  check('Autosave: on saves at once', rec(idb) && f.els.autosave.textContent === 'Autosave: on');
  f.close();
}
(async () => {
  const which = process.argv[2];
  if (which !== 'threads') await suite(false);
  if (which !== 'serial') await suite(true);
  console.log(failed ? `${failed} FAILED` : 'all passed');
  process.exit(failed ? 1 : 0);
})();
