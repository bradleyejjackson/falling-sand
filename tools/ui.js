// Runs the whole page against a stub DOM and pokes the UI paths: rack, painting, views, save/load, export/import, and
// panning far enough that the world streams. Runs twice: with the cell pass on this thread, and on worker threads.
// usage: node tools/ui.js [serial|threads]
const { loadPage, census } = require('./load');
let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); if (!ok) failed++; };

async function suite(threads) {
  console.log(`# ${threads ? 'worker threads' : 'one thread'}`);
  const p = loadPage(process.env.SIMFILE, { threads });
  const { g, Sim, pool } = p.sf;
  if (threads) { const n = p.ready(); check('the page starts its worker threads', pool.n > 0 && n === pool.n, `${n} of ${pool.n} ready`); }
  else check('without workers the page says why it runs on one thread', pool.n === 0 && pool.why === 'no workers here', pool.why);

  p.run(40);
  check('stats show the year, season and time', /^Year \d+, (Spring|Summer|Autumn|Winter)( \(dry season\))?( in an? [a-z ]+)?, day \d+, \d\d:\d\d, [+-]?\d+°$/.test(p.els.clock.textContent), p.els.clock.textContent);
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

  for (const id of ['moistview', 'heatview', 'windview', 'soilview', 'showchunks']) { p.els[id].fire('click'); p.run(3); p.els[id].fire('click'); }
  p.run(3);
  check('view toggles render without errors', true);
  {   // Light: constant draws the frame at full brightness at midnight, and the choice is remembered
    const c0 = g.clock; g.clock = Math.floor(g.clock / Sim.DAY) * Sim.DAY + Sim.DAY * 0.75; g.updateClimate(); p.run(1);
    const lum = () => { let s = 0; for (const v of p.sf.px) s += (v & 255) + (v >> 8 & 255) + (v >> 16 & 255); return s; };
    const night = lum(); p.els.lightmode.fire('click'); p.run(1); const flat = lum();
    check('Light: constant lights the night', p.els.lightmode.textContent === 'Light: constant' && p.store['sandfall.light'] === 'constant' && flat > 2 * night, `${(flat / night).toFixed(2)}x brighter, ${p.els.lightmode.textContent}`);
    p.els.lightmode.fire('click'); p.run(1); check('Light: day/night comes back', p.els.lightmode.textContent === 'Light: day/night' && Math.abs(lum() - night) < night * 0.05);
    g.clock = c0; g.updateClimate();
  }

  p.run(1); p.els.save.fire('click'); p.run(1); const saved = p.store['sandfall.world'];
  check('save writes a 12-part world', saved && saved.split('|').length === 12, p.els.msg.textContent);
  const trees = g.trees.length; p.run(1); g.clear(); p.els.load.fire('click'); p.run(1);
  check('load restores trees', g.trees.length === trees, `${g.trees.length}/${trees}; ${p.els.msg.textContent}`);
  p.els.export.fire('click'); p.run(1); const text = p.els.iotext.value;
  p.run(1); g.clear(); p.els.import.fire('click'); p.run(1);
  check('export/import round-trips', p.els.msg.textContent === 'Imported' && g.trees.length === trees, p.els.msg.textContent);
  { const mr = Math.random; Math.random = () => 0.25; p.els.newworld.fire('click'); p.run(60); Math.random = mr; }   // (a seed that opens in green country: about one in four opens in scrub or desert)
  check('new world generates with dirt and trees', (census(g, Sim.EL).Dirt || 0) > 1000 && g.trees.length > 5, `${census(g, Sim.EL).Dirt} dirt, ${g.trees.length} trees`);
  check('the world is several windows wide and starts in the middle', g.worldW === Sim.WORLD.WIDE && g.worldW >= 6 * g.W && Math.abs(g.ox + g.W / 2 - g.worldW / 2) <= Sim.REGION && new RegExp(Sim.WORLD.WIDE).test(p.els.dims.textContent), `${p.els.dims.textContent}, window at ${g.ox}`);

  // walk right with the keyboard: the window streams along; walk back and the land is as we left it
  const ox0 = g.ox, here = Array.from(g.type);
  p.window.fire('keydown', { key: 'd' }); p.run(480); p.window.fire('keyup', { key: 'd' });
  const ox1 = g.ox, stored = g.store.size;
  check('panning right streams the window along the world', ox1 >= ox0 + 3 * Sim.REGION && stored >= 3, `window ${ox0} -> ${ox1}, ${stored} regions stored; ${p.els.cam.textContent}`);
  // (east of the start lies the dry country: scrub and desert, where few trees stand)
  const wild = census(g, Sim.EL); check('plants keep growing in the new land', g.trees.length > 5 || (wild.Shrub || 0) + (wild.Cactus || 0) > 200, `${g.trees.length} trees, ${wild.Shrub || 0} shrub and ${wild.Cactus || 0} cactus cells`);
  p.window.fire('keydown', { key: 'a' }); for (let k = 0; k < 2000 && g.ox > ox0; k++) p.run(1); p.window.fire('keyup', { key: 'a' }); p.run(2);
  // (the exact round trip is checked in validate.js stream; here the land lives on for the frames it is in the window)
  let same = 0; for (let i = 0; i < here.length; i++) if (here[i] === g.type[i]) same++;
  check('panning back brings the first land back', g.ox === ox0 && same / here.length > 0.95, `${(100 * same / here.length).toFixed(1)}% of cells the same type`);
  p.run(1); p.els.save.fire('click'); p.run(1); const big = p.store['sandfall.world'];
  check('a streamed world saves', big && big.split('|').length === 12, `${(big.length / 1024) | 0} KB, ${p.els.msg.textContent}`);

  // the biome box: choosing a kind of country makes a new world of it, remembers the choice, and a save keeps it
  { const isle = Sim.BIOMES.findIndex(b => b.id === 'island');
    p.els.biome.value = 'island'; p.els.biome.fire('change'); p.run(5);
    const v = g.noise.volc;
    check('choosing Volcanic island makes a world with a volcano, opening on the coast', g.biome === isle && v && g.ox === 0 && p.sf.cam().x < v.x && p.sf.cam().x + 320 > g.noise.sea.shore && /Volcanic island/.test(p.els.msg.textContent) && p.store['sandfall.biome'] === 'island', `biome ${g.biome}, camera at ${p.sf.cam().x}, ${p.els.msg.textContent}`);
    p.els.save.fire('click'); p.run(1); g.biome = 0; g.noise = null; p.els.load.fire('click'); p.run(1);
    check('a save keeps the biome', g.biome === isle && g.noise.volc, `biome ${g.biome}`);
    p.els.biome.value = 'temperate'; p.els.biome.fire('change'); p.run(5);
    check('choosing Temperate goes back to the usual world', g.biome === 0 && !g.noise.volc && g.ox > 0, `biome ${g.biome}, window at ${g.ox}`); }
  // the world generator: its knobs set a custom biome, Make world builds it from them and the seed, a save keeps the knobs, and Share
  // link carries them (opening the link makes the same world)
  { const gen = p.sf.ui.gen, k = gen.knobs;
    p.els.genbtn.fire('click'); p.run(1);
    check('World generator opens its panel with a knob for each setting', p.els.gen.classList.contains('on') && Object.keys(k).length === Sim.KNOBS.length && k.warm.out.textContent === '0°', `${Object.keys(k).length} knobs, warmth ${k.warm.out.textContent}`);
    p.els['gen-from'].value = String(Sim.BIOMES.findIndex(b => b.id === 'alpine')); p.els['gen-from'].fire('change');
    check('Start from fills the knobs with a preset\'s', gen.bio().base === Sim.BIOMES[1].base && k.snow.out.textContent === '10', k.snow.out.textContent);
    k.warm.inp.value = '250'; k.warm.inp.fire('input'); k.coast.inp.value = 'none'; k.coast.inp.fire('change'); k.wide.inp.value = '3840'; k.wide.inp.fire('change');
    k.animals.inp.value = '0'; k.animals.inp.fire('input');
    check('moving a knob sets it (in its range) and keeps it in this browser', gen.bio().warm === -6 && k.warm.out.textContent === '-6°' && JSON.parse(p.store['sandfall.gen']).spec.coast === 'none', `${gen.bio().warm}, ${p.store['sandfall.gen']}`);
    p.els['gen-seed'].value = '5150'; p.els['gen-make'].fire('click'); p.run(5);
    const b = g.biome, ok = b && b.id === 'custom' && b.warm === -6 && b.snow === 10 && g.worldSeed === 5150 && g.worldW === 3840 && !g.noise.sea && Math.abs(g.ox + g.W / 2 - 1920) <= Sim.REGION;
    check('Make world builds a custom world from the knobs and the seed', ok && p.els.biome.value === 'custom' && /Custom/.test(p.els.msg.textContent) && !g.type.some(t => t === Sim.ids.RABBIT || t === Sim.ids.BIRD), `${p.els.msg.textContent}, ${g.worldW} wide at ${g.ox}`);
    p.els.save.fire('click'); p.run(1); g.biome = 0; g.noise = null; p.els.load.fire('click'); p.run(1);
    check('a save keeps the custom knobs', g.biome && g.biome.warm === -6 && g.worldW === 3840 && g.warmK === -6, JSON.stringify(g.biome).slice(0, 60));
    p.els.sharelink.fire('click'); p.run(1); const link = p.els.iotext.value;
    check('Share link carries the knobs', /#world=5150&gen=wide:3840,.*warm:-6/.test(link) && /coast:none/.test(link), link);
    const spec = gen.unpack(link.split('gen=')[1]), again = Sim.customBiome(spec);
    check('the link\'s knobs make the same biome', JSON.stringify(again) === JSON.stringify(g.biome), JSON.stringify(spec));
    p.els.genbtn.fire('click'); p.els.biome.value = 'temperate'; p.els.biome.fire('change'); p.run(5);
    check('a preset after a custom world is the preset again', g.biome === 0 && g.worldW === Sim.WORLD.WIDE && g.warmK === 0); }

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
  check('Sandbox leaves the scenario, with its unlocks', !p.sf.game() && !p.els.mission.classList.contains('on') && !btn('Oil').disabled && btn('Lava').disabled && g.worldW === Sim.WORLD.WIDE);
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
  p.els.leave.fire('click'); p.run(2);

  // Flood defence through the brush: a clay wall dragged down the hillside below the river, sand banked against its far side
  scn('Flood defence').fire('click'); p.run(2);
  const fd = p.sf.game();
  const vsweep = (x, y0, y1) => { cv.fire('pointerdown', at(x, cy(y0))); for (let y = y0; y <= y1; y += 2) { cv.fire('pointermove', at(x, cy(y))); p.run(1); } cv.fire('pointerup', at(x, cy(y1))); };
  btn('Clay <b>250</b>').fire('click'); for (const x of [104, 108]) vsweep(x, 92, 124);
  btn('Sand <b>700</b>').fire('click'); for (const x of [113, 118, 122]) vsweep(x, 92, 130);
  for (let k = 0; k < 4800 && fd.state === 'play'; k++) p.run(1);
  check('Flood defence is won through the brush', fd.state === 'won', `${fd.state} ${fd.why} at ${(fd.t / 60).toFixed(0)} s; water in town ${fd.goals[0].value}; clay left ${fd.left('Clay')}, sand left ${fd.left('Sand')}`);

  // the sandbox row: hidden in a scenario, and Speed runs the scenario's clock faster
  check('the sandbox row hides in a scenario', p.els.sbox.classList.contains('off'));
  scn('Volcano').fire('click'); p.run(2);
  const vt = p.sf.game().t; p.els.speed.fire('click'); p.run(10);
  check('Speed ×2 runs two ticks a frame', p.sf.game().t - vt === 20 && p.els.speed.textContent === 'Speed ×2', `${p.sf.game().t - vt} ticks in 10 frames`);
  p.els.speed.fire('click'); p.els.speed.fire('click'); p.run(1);   // (×4, then back to ×1)
  p.els.leave.fire('click'); unlock.fire('click'); p.run(2);
  check('leaving a scenario shows the sandbox row', !p.els.sbox.classList.contains('off'));
  p.els.flatworld.fire('click'); p.run(2);
  const cf = census(g, Sim.EL);
  check('Flat world lays level ground with grass, one window wide', g.worldW === g.W && cf.Plant > 900 && cf.Dirt > 900 * 20 && g.trees.length === 0, `${cf.Plant} grass, ${cf.Dirt} dirt, world ${g.worldW}`);
  const s0 = g.seasonName; p.els.season.fire('click'); p.run(1);
  check('Next season moves the calendar on a season', g.seasonName !== s0 && /^(Spring|Summer|Autumn|Winter)$/.test(p.els.msg.textContent), `${s0} -> ${g.seasonName}`);
  p.els.hold.fire('click'); const c0 = g.clock; p.run(30);
  check('Hold time stops the clock', g.clock === c0 && g.hold, `${g.clock - c0} ticks passed`);
  p.els.hold.fire('click'); p.run(5); check('and releasing it starts it again', g.clock > c0);
  p.els.windset.fire('click'); p.run(5);
  check('the wind button holds the wind', g.wind === 0 && /calm/.test(p.els.windset.textContent), `${g.wind} ${p.els.windset.textContent}`);
  p.els.front.fire('click'); p.run(30);
  const frontAt = (() => { for (let ax = 1; ax < g.AW; ax++) if (g.massT[ax - 1] < 0 && g.massT[ax] > 0) return ax * 4; return -1; })();
  check('Send a cold front brings one in at the west of the screen', g.fronts && frontAt >= 0 && /cold front/.test(p.els.msg.textContent) && /hPa/.test(p.els.wind.textContent), `front at x ${frontAt}, ${p.els.wind.textContent}`);
  const s1 = g.strikes; g.strike(g.W >> 1, 40); p.run(3);
  check('a lightning strike draws and is counted', g.strikes === s1 + 1);
  // the Cone brush sows a conifer's seed (a seed with Sim.CONE in its life), Seed a broadleaf's (a frame later: a stroke made mid-step waits for the step)
  { const { SEED } = Sim.ids, cone = btn('Cone'), seed = btn('Seed'), sown = () => [...g.type].map((t, i) => t === SEED ? g.life[i] : -1).filter(l => l >= 0);
    check('there is a Cone button by Seed', !!cone && !!seed);
    const s0 = sown().length; cone.fire('click'); cv.fire('pointerdown', at(100, 20)); cv.fire('pointerup', at(100, 20));
    p.run(1); const after = sown(); check('the Cone brush sows a conifer seed', after.length === s0 + 1 && after.filter(l => l & Sim.CONE).length >= 1, `${after.length - s0} sown`);
    for (let i = 0; i < g.type.length; i++) if (g.type[i] === SEED) g.set(i, Sim.ids.E); }
  // devices: a spout pours the element chosen before it, pressing Fan again turns it
  { const { SPOUT, FAN, OIL } = Sim.ids;
    btn('Oil').fire('click'); const sp = btn('Spout · Oil');
    check('the Spout button names the element chosen last', !!sp);
    p.els.brush.value = '2'; p.els.brush.fire('input'); sp.fire('click');
    cv.fire('pointerdown', at(60, 40)); cv.fire('pointerup', at(60, 40)); p.run(60);
    const spouts = [...g.type].filter(t => t === SPOUT).length, oil = census(g, Sim.EL).Oil || 0;
    check('a painted spout pours that element', spouts > 5 && oil > 40 && [...g.type].every((t, i) => t !== SPOUT || g.life[i] === OIL), `${spouts} spout cells, ${oil} oil`);
    btn('Fan →').fire('click'); btn('Fan →').fire('click');
    const up = btn('Fan ↑');
    cv.fire('pointerdown', at(250, 60)); cv.fire('pointerup', at(250, 60)); p.run(2);
    check('pressing Fan again turns it, and paints it that way', !!up && [...g.type].some((t, i) => t === FAN && g.life[i] === 1) && [...g.type].every((t, i) => t !== FAN || g.life[i] === 1));
    btn('Sand').fire('click'); btn('Stone').fire('click'); check('choosing a solid leaves the spout on the last powder, liquid or gas', !!btn('Spout · Sand'));
  // the inspector reads the cell under the pointer; the Inspect tool pins one without painting
    cv.fire('pointermove', at(60, 40));
    check('pointing at a cell reads it out', /Spout/.test(p.els.probe.innerHTML) && /pours Oil/.test(p.els.probe.innerHTML) && /°/.test(p.els.probe.innerHTML), p.els.probe.innerHTML.replace(/<[^>]+>/g, ''));
    const before = [...g.type].filter(t => t === SPOUT).length;
    btn('Inspect').fire('click'); cv.fire('pointerdown', at(60, 40)); cv.fire('pointerup', at(60, 40)); cv.fire('pointerleave'); p.run(10);
    check('the Inspect tool pins a cell and paints nothing', /Pinned/.test(p.els.probe.innerHTML) && /Spout/.test(p.els.probe.innerHTML) && [...g.type].filter(t => t === SPOUT).length === before, p.els.probe.innerHTML.replace(/<[^>]+>/g, ''));
    cv.fire('pointerdown', at(60, 40)); cv.fire('pointerup', at(60, 40));
    check('clicking it again lets it go', !/Pinned/.test(p.els.probe.innerHTML));
    btn('Sand').fire('click'); }
  // the census chart samples the window eight times a day and names each series with its value
  { p.run(Sim.DAY / 8 + 5);
    const legend = p.els.legend.innerHTML.replace(/<[^>]+>/g, ' ');
    check('the census chart is shown and samples the window', p.els.census.classList.contains('on') && /Rabbits\s+\d+/.test(legend) && /Forest\s+\d+/.test(legend) && /day \d+ of year \d+/.test(legend), legend.replace(/\s+/g, ' '));
    const c = g.census(); check('the census sorts every column into one cover', c.forest + c.meadow + c.scrub + c.desert + c.reeds + c.water + c.bare === g.W, JSON.stringify(c));
    p.els.censusbtn.fire('click'); check('the Census button hides it', !p.els.census.classList.contains('on') && p.els.censusbtn.getAttribute('aria-pressed') === 'false');
    p.els.censusbtn.fire('click'); }
  p.els.heatview.fire('click'); p.run(2); p.els.heatview.fire('click');
  scn('Irrigation').fire('click'); p.run(2);
  check('a scenario puts the wind and clock back to natural', g.windHold === null && !g.hold && /natural/.test(p.els.windset.textContent));
  check('a scenario hides the devices', p.created.find(e => e.className === 'el' && e.innerHTML.includes('Spout')).style.display === 'none');
  check('and has one air mass and no lightning', !g.fronts && !g.lightning && g.massT.every(v => v === 0));
  check('a scenario hides the census but keeps the Inspect tool', !p.els.census.classList.contains('on') && btn('Inspect').style.display !== 'none');
  p.els.leave.fire('click'); p.run(2);
  // X5: brush shapes, undo, zoom, the seed box and the minimap; X7 time-lapse; X8 keys
  { const ui = p.sf.ui, stone = () => census(g, Sim.EL).Stone || 0;
    p.run(1); g.clear(); p.run(1); btn('Stone').fire('click');
    const n0 = census(g, Sim.EL).Stone || 0;
    p.els.shape.value = 'box'; p.els.shape.fire('change');
    cv.fire('pointerdown', at(40, 40)); cv.fire('pointermove', at(70, 60)); cv.fire('pointerup', at(70, 60)); p.run(1);
    const box = (census(g, Sim.EL).Stone || 0) - n0;
    check('the box shape fills the rectangle dragged', box >= 500 && box <= 1200, `${box} cells`);
    p.els.shape.value = 'line'; p.els.shape.fire('change'); p.els.brush.value = '1'; p.els.brush.fire('input');
    cv.fire('pointerdown', at(100, 30)); cv.fire('pointerup', at(200, 30)); p.run(1);
    const line = stone() - n0 - box;
    check('the line shape draws from press to release', line >= 90 && line < 600, `${line} cells`);
    const u = ui.undos(); p.els.undo.fire('click'); p.run(1);
    check('Undo takes back the last stroke and only that', stone() === n0 + box && ui.undos() === u - 1, `${stone() - n0} stone, ${ui.undos()} left`);
    p.els.undo.fire('click'); p.run(1);
    check('a second Undo takes back the box', (census(g, Sim.EL).Stone || 0) === n0);
    p.els.shape.value = 'free'; p.els.shape.fire('change');
    p.els.zoom.fire('click'); p.run(2);
    check('Zoom shows a quarter of the view, bigger', ui.zoom()[0] === 160 && p.sf.px.length === 160 * 120 && /×2/.test(p.els.zoom.textContent), p.els.zoom.textContent);
    p.els.zoom.fire('click'); p.run(2); check('and then four times as much', ui.zoom()[0] === 640 && p.sf.px.length === 640 * 480);
    p.els.zoom.fire('click'); p.run(2);
    p.window.fire('keydown', { key: 't' }); p.run(3);
    check('T turns the time-lapse on, ×16 a frame', ui.timelapse()[0] && ui.timelapse()[1] === 16);
    const c0 = g.clock; p.run(8); check('time-lapse runs 16 ticks a frame', g.clock - c0 >= 8 * 16, `${g.clock - c0} ticks in 8 frames`);
    p.window.fire('keydown', { key: 't' }); check('T again turns it off', !ui.timelapse()[0] && ui.timelapse()[1] === 1);
    btn('Sand').fire('click'); p.window.fire('keydown', { key: 'e' }); check('E picks the next element in the rack', ui.current() !== Sim.ids.SAND);
    p.window.fire('keydown', { key: 'q' }); check('Q goes back', ui.current() === Sim.ids.SAND);
    p.window.fire('keydown', { key: ']' }); check('] makes the brush bigger', String(p.els.brush.value) === '2', p.els.brush.value);
    p.window.fire('keydown', { key: 'x' }); check('X picks the eraser', btn('Erase').getAttribute('aria-pressed') === true || btn('Erase').getAttribute('aria-pressed') === 'true');
    btn('Sand').fire('click');
    p.els.seedin.value = '424242'; p.els.goseed.fire('click'); p.run(20);
    check('Open seed makes the world from that seed', g.worldSeed === 424242, String(g.worldSeed));
    p.run(16); check('the minimap shows a generated world', p.els.minimap.style.display !== 'none');
    const ox = g.ox; ui.jumpTo(ox + 2400); p.run(3);
    check('jumping on the minimap moves the window there', g.ox > ox && Math.abs(g.ox + p.sf.cam().x + 160 - (ox + 2400)) < 400, `ox ${ox} -> ${g.ox}`);
    p.els.sharelink.fire('click'); p.run(1);
    check('Share link gives a link to the seed', /#world=424242&biome=temperate/.test(p.els.iotext.value), p.els.iotext.value);
  }
  // X4: a custom scenario packs into a link and plays from it
  { const ui = p.sf.ui; ui.design(-1); p.run(2);
    check('laying out a box stops time and locks the view on it', p.els.pause.textContent === 'Resume' && ui.zoom()[0] === 320);
    const text = JSON.stringify({ sandfall: 'scenario', v: 1, def: { id: 'custom-1', custom: true, name: 'Test pool', brief: 'b', time: 60 * 60, budget: { Water: 400 }, goals: [{ label: 'Water', count: 'Water', rect: [0, 0, 320, 200], min: 100 }], fails: [], sources: [] }, world: g.save() });
    const link = await ui.packScenario(text), back = await ui.unpackScenario(link);
    check('a scenario packs into a link and back', back === text, `${text.length} chars in ${link.length}`);
    ui.playCustom(text); p.run(3);
    check('a custom scenario plays', p.sf.game() && p.sf.game().sc.name === 'Test pool' && p.sf.game().state === 'play');
    p.els.leave.fire('click'); p.run(2);
  }
  p.close();
}
const mode = process.argv[2];
(async () => {
  if (mode !== 'threads') await suite(false);
  if (mode !== 'serial') await suite(true);
  if (failed) { console.log(`${failed} UI check(s) failed`); process.exit(1); }
})();
