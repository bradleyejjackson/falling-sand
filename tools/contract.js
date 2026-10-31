// X9: the Godot port's data contract, read out of the Sim block itself.
//   node tools/contract.js           check: docs/port/contract.json and the generated parts of docs/PORT.md match the code
//   node tools/contract.js --write   rewrite them from the code (do this, deliberately, when a change to Sim is meant to change the contract)
// What it reads: every top-level constant of Sim (through a peek into the module's scope; the page itself is not changed), the
// element registry and its per-element tables, the field layout, the tree and segment records of a generated world, the save's
// sections, the biome presets, and each built-in scenario's definition and opening world (as a save string, so a port can load
// the layouts instead of re-coding the build functions).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { simSource } = require('./load');

const ROOT = path.join(__dirname, '..');
const JSON_OUT = path.join(ROOT, 'docs', 'port', 'contract.json');
const SCEN_OUT = path.join(ROOT, 'docs', 'port', 'scenarios.json');
const DOC = path.join(ROOT, 'docs', 'PORT.md');
const write = process.argv.includes('--write');

// ---- load Sim with a peek into its scope -------------------------------------
const src = simSource(process.env.SIMFILE);
const ret = src.lastIndexOf('return {BIOMES');
if (ret < 0) throw new Error('cannot find Sim\'s export list');
const Sim = new Function(src.slice(0, ret) + 'return {__peek:n=>eval(n), ' + src.slice(ret + 8) + '\nreturn Sim;')();
const peek = n => { try { return Sim.__peek(n); } catch (e) { return undefined; } };
const { EL, N } = Sim;
const nameOf = id => EL[id] ? EL[id].name : id;

// ---- top-level constant names: UPPER_CASE declarators of the module's own `const` statements (2-space indent) ----
const names = [];
{
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!/^  const /.test(lines[i])) continue;
    let text = lines[i];
    while (/,$/.test(lines[i].replace(/\/\/.*$/, '').trimEnd()) && i + 1 < lines.length && /^ {4,}/.test(lines[i + 1])) text += '\n' + lines[++i];   // (a declaration carried on over lines ending in a comma)
    const code = text.replace(/\/\/.*$/gm, '');
    for (const m of code.matchAll(/(?:^  const |,\s*)([A-Z][A-Z0-9_]*)\s*=(?![=>])/gm)) if (!names.includes(m[1])) names.push(m[1]);
  }
}

// ---- sort them by what they hold ----------------------------------------------
const plain = v => JSON.parse(JSON.stringify(v));
const isTable = v => (ArrayBuffer.isView(v) || Array.isArray(v)) && v.length === N;
const constants = {}, elementTables = {}, elementSets = {}, elementMaps = {}, other = {};
const SKIP = new Set(['EL', 'FIELDS', 'BIOMES', 'BIOME0', 'SCENARIOS', 'RX', 'RXA', 'KH', 'KHD', 'CAPD', 'HOLDD', 'HID', 'LOD', 'WORLD', 'STARTER', 'GROVES', 'VALUE', 'BOX']);
for (const n of names) {
  if (SKIP.has(n)) continue;
  const v = peek(n);
  if (v === undefined || typeof v === 'function') continue;
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') constants[n] = v;
  else if (isTable(v)) {
    const vals = Array.from(v, x => x === null ? null : typeof x === 'object' ? plain(x) : x === Infinity ? 'inf' : x === -Infinity ? '-inf' : x);   // (JSON has no infinity)
    if (vals.every(x => !x || x === 'inf' || x === '-inf') && new Set(vals).size < 2) continue;
    elementTables[n] = vals;
  }
  else if (v instanceof Set) elementSets[n] = [...v].sort((a, b) => a - b);
  else if (Array.isArray(v) && v.every(x => typeof x === 'number' || typeof x === 'string')) constants[n] = v;
  else if (v && typeof v === 'object' && !ArrayBuffer.isView(v) && Object.keys(v).length && Object.keys(v).every(k => /^\d+$/.test(k))) elementMaps[n] = v;
  else other[n] = plain(v);
}
for (const n of ['WORLD', 'BOX', 'VALUE']) other[n] = plain(peek(n));

// ---- fields ---------------------------------------------------------------------
const L = peek('layout')(Sim.WORLD.W, Sim.WORLD.H);
const fields = peek('FIELDS').map(([name, A, scope]) => ({ name, type: A.name.replace('Array', '').replace('Uint', 'u').replace('Int', 'i').replace('Float', 'f'), scope, length: L.at[name][1] }));

// ---- elements -------------------------------------------------------------------
const elements = EL.map(e => Object.assign({}, plain(e), { decay: e.decay === null ? null : Array.isArray(e.decay) ? e.decay.map(nameOf) : typeof e.decay === 'number' ? nameOf(e.decay) : e.decay,
  hi: e.hi && { at: e.hi.at, to: typeof e.hi.to === 'number' ? nameOf(e.hi.to) : e.hi.to }, lo: e.lo && { at: e.lo.at, to: typeof e.lo.to === 'number' ? nameOf(e.lo.to) : e.lo.to } }));
const KH = peek('KH'), conduct = [];   // pairwise conductance, listed where it isn't the harmonic mean of the two k's × 0.24
for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) { const base = Math.fround(2 * EL[a].k * EL[b].k / (EL[a].k + EL[b].k) * 0.24); if (Math.abs(KH[a * N + b] - base) > 1e-6) conduct.push([nameOf(a), nameOf(b), +KH[a * N + b].toFixed(6)]); }
const reactions = [];
for (const [k, list] of peek('RX')) for (const r of list) reactions.push({ a: nameOf((k / N) | 0), b: nameOf(k % N), p: r.p, a2: r.na === null ? null : nameOf(r.na), b2: r.nb === null ? null : nameOf(r.nb) });

// ---- a generated world: tree and segment records, the save's sections ----------
const g = new Sim.Grid(Sim.WORLD.W, Sim.WORLD.H);
Sim.generate(g, 12345, Sim.WORLD.WIDE, Math.floor((Sim.WORLD.WIDE - g.W) / 2 / Sim.REGION) * Sim.REGION);
for (let f = 0; f < 200; f++) g.step();
const treeKeys = new Set(), segKeys = new Set();
for (const t of g.trees) { for (const k of Object.keys(g.treeRecord(t, 0))) treeKeys.add(k); for (const s of t.segs) for (const k of Object.keys(s)) segKeys.add(k); }
const save = g.save().split('|');
const store = JSON.parse(save[6]);
const record = {
  tree: [...treeKeys].sort(), segment: [...segKeys].sort(),
  saveSections: save.length, storeKeys: Object.keys(store).sort(),
  regionKeys: Object.keys(Object.values(store.regions)[0] || { type: 0, life: 0, temp: 0, owner: 0, hum: 0, trees: 0 }).sort(),
};

// ---- biomes and scenarios -------------------------------------------------------
const biomes = plain(Sim.BIOMES);
const scenarios = [];
{
  const sg = new Sim.Grid(Sim.WORLD.W, Sim.WORLD.H);
  for (const sc of Sim.SCENARIOS) { Sim.Game.stage(sg, sc); scenarios.push(Object.assign(plain(Sim.defOf(sc)), { seed: sc.seed, air: sc.air, world: sg.save() })); }
}

// ---- out ---------------------------------------------------------------------------
const contract = { fields, elements, elementTables, elementSets, elementMaps, conduct, reactions, record, constants, other, biomes,
  scenarioDefs: scenarios.map(({ world, ...d }) => d) };
const body = JSON.stringify(contract);
const hash = crypto.createHash('sha256').update(body).digest('hex').slice(0, 12);
const jsonText = JSON.stringify(Object.assign({ hash }, contract), null, 1) + '\n';
const scenText = JSON.stringify(scenarios.map(s => ({ id: s.id, world: s.world })), null, 1) + '\n';

// generated parts of PORT.md, between <!-- contract:NAME --> and <!-- /contract:NAME -->
const flags = id => ['SPAN', 'SUPPORTS', 'INERT', 'SOURCE', 'ANIMAL', 'DEVICE', 'WILD', 'NUTR', 'SOAKS', 'POROUS', 'ACIDABLE']
  .filter(n => elementTables[n] && elementTables[n][id]).concat(['KEEP_LIFE', 'FLUID_LIFE'].filter(n => elementSets[n] && elementSets[n].includes(id)))
  .concat(elementTables.FUEL && elementTables.FUEL[id] ? ['FUEL ' + elementTables.FUEL[id].p] : []).join(', ');
const cellish = v => v === null || v === undefined ? '' : typeof v === 'object' ? (Array.isArray(v) ? v.join('/') : v.at + '°→' + v.to) : String(v);
const parts = {
  hash: '`' + hash + '`',
  fields: '| field | type | scope | length in the 960×960 window |\n|---|---|---|---|\n' + fields.map(f => `| \`${f.name}\` | ${f.type} | ${f.scope} | ${f.length} |`).join('\n'),
  elements: '| id | name | kind | density | k | cap | t0 | life | soil | decay | hi | lo | flags |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|\n' +
    elements.map(e => `| ${e.id} | ${e.name} | ${e.kind} | ${e.density || ''} | ${e.k} | ${e.cap} | ${e.t0} | ${cellish(e.life || null)} | ${e.soil || ''} | ${cellish(e.decay)} | ${cellish(e.hi)} | ${cellish(e.lo)} | ${flags(e.id)} |`).join('\n'),
  reactions: '| A | touching B | chance a tick | A becomes | B becomes |\n|---|---|---|---|---|\n' + reactions.map(r => `| ${r.a} | ${r.b} | ${r.p} | ${r.a2 ?? '(stays)'} | ${r.b2 ?? '(stays)'} |`).join('\n'),
  records: `- Tree record keys: ${record.tree.map(k => '`' + k + '`').join(', ')}\n- Segment keys: ${record.segment.map(k => '`' + k + '`').join(', ')}\n- Save: ${record.saveSections} sections split by \`|\`; the store JSON (section 7) has ${record.storeKeys.map(k => '`' + k + '`').join(', ')}, and each region ${record.regionKeys.map(k => '`' + k + '`').join(', ')}`,
  counts: `${elements.length} elements, ${fields.length} fields, ${Object.keys(constants).length} constants, ${Object.keys(elementTables).length} per-element tables, ${Object.keys(elementSets).length} element sets, ${reactions.length} contact reactions, ${conduct.length} conductance overrides, ${biomes.length} biome presets, ${scenarios.length} scenarios`,
};
let doc = fs.readFileSync(DOC, 'utf8');
for (const [k, v] of Object.entries(parts)) {
  const re = new RegExp(`(<!-- contract:${k} -->)[\\s\\S]*?(<!-- /contract:${k} -->)`, 'g');
  if (!re.test(doc)) throw new Error(`PORT.md has no contract:${k} block`);
  doc = doc.replace(re, (m, a, b) => `${a}${k === 'hash' ? '' : '\n'}${v}${k === 'hash' ? '' : '\n'}${b}`);
}

const old = p => fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
const stale = [[JSON_OUT, jsonText], [SCEN_OUT, scenText], [DOC, doc]].filter(([p, t]) => old(p) !== t);
if (write) {
  fs.mkdirSync(path.dirname(JSON_OUT), { recursive: true });
  for (const [p, t] of stale) fs.writeFileSync(p, t);
  console.log(`contract ${hash}: ${parts.counts}; ${stale.length ? 'wrote ' + stale.map(([p]) => path.relative(ROOT, p)).join(', ') : 'unchanged'}`);
} else if (stale.length) {
  const was = (old(JSON_OUT).match(/"hash": "(\w+)"/) || [])[1];
  console.log(`FAIL contract ${was || '(none)'} -> ${hash}: the code no longer matches ${stale.map(([p]) => path.relative(ROOT, p)).join(', ')}`);
  if (was) {   // say what moved
    const prev = JSON.parse(old(JSON_OUT));
    for (const k of Object.keys(contract)) {
      const a = prev[k], b = plain(contract[k]);
      if (JSON.stringify(a) === JSON.stringify(b)) continue;
      if (a && b && typeof a === 'object' && !Array.isArray(a)) {
        const ks = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(n => JSON.stringify(a[n]) !== JSON.stringify(b[n]));
        console.log(`  ${k}: ${ks.slice(0, 20).map(n => `${n} ${JSON.stringify(a[n]) ?? '-'} -> ${JSON.stringify(b[n]) ?? '-'}`.slice(0, 160)).join('\n    ')}${ks.length > 20 ? ` (+${ks.length - 20} more)` : ''}`);
      } else console.log(`  ${k} changed`);
    }
  }
  console.log('If the change is meant to change the port, run node tools/contract.js --write and say so in the PR.');
  process.exit(1);
} else console.log(`ok contract ${hash}: ${parts.counts}`);
