// Runs the whole page against a stub DOM and pokes the UI paths: rack, painting, views, save/load, export/import.
const { loadPage, census } = require('./load');
const p = loadPage();
const { g, Sim } = p.sf;
let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); if (!ok) failed++; };

p.run(40);
check('stats show the season and time', /^(Spring|Summer|Autumn|Winter), day \d+, \d\d:\d\d, [+-]?\d+°$/.test(p.els.clock.textContent), p.els.clock.textContent);
const names = p.created.filter(e => e.className === 'el').map(e => e.innerHTML.replace('<i></i>', ''));
check('Dirt and Litter are in the rack', names.includes('Dirt') && names.includes('Litter'), names.join(' '));

// paint a dirt bed then a seed onto it through pointer events, in an empty area of sky
const btn = n => p.created.find(e => e.className === 'el' && e.innerHTML.endsWith(n));
const cv = p.els.c;
const at = (vx, vy) => ({ clientX: vx, clientY: vy, button: 0, pointerId: 1 });
g.clear();
btn('Dirt').fire('click');
for (let vx = 100; vx <= 220; vx += 4) { cv.fire('pointerdown', at(vx, 180)); cv.fire('pointerup', at(vx, 180)); }
p.run(120);
const c1 = census(g, Sim.EL);
check('painting dirt places damp dirt', c1.Dirt > 300 && [...g.type].some((t, i) => t === Sim.ids.DIRT && (g.life[i] & 255) >= 60), `${c1.Dirt} cells`);
btn('Seed').fire('click');
p.els.brush.value = '1'; p.els.brush.fire('input');
cv.fire('pointerdown', at(160, 100)); cv.fire('pointerup', at(160, 100));
p.run(1200);
check('a seed dropped on painted dirt becomes a tree', g.trees.length >= 1, `${g.trees.length} trees`);

for (const id of ['moistview', 'heatview', 'showchunks']) { p.els[id].fire('click'); p.run(3); p.els[id].fire('click'); }
p.run(3);
check('view toggles render without errors', true);

p.els.save.fire('click'); const saved = p.store['sandfall.world'];
check('save writes a 4-part world', saved && saved.split('|').length === 4, p.els.msg.textContent);
const trees = g.trees.length; g.clear(); p.els.load.fire('click');
check('load restores trees', g.trees.length === trees, `${g.trees.length}/${trees}; ${p.els.msg.textContent}`);
p.els.export.fire('click'); const text = p.els.iotext.value;
g.clear(); p.els.import.fire('click');
check('export/import round-trips', p.els.msg.textContent === 'Imported' && g.trees.length === trees, p.els.msg.textContent);
p.els.newworld.fire('click'); p.run(60);
check('new world generates with dirt and trees', (census(g, Sim.EL).Dirt || 0) > 1000 && g.trees.length > 5, `${census(g, Sim.EL).Dirt} dirt, ${g.trees.length} trees`);
if (failed) { console.log(`${failed} UI check(s) failed`); process.exit(1); }
