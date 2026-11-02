// Many worlds, many years: run tools/decade.js for several seeds on one or more builds of the page at once, then compare them.
// usage: node tools/batch.js [--seeds 1-8] [--years 10] [--jobs N] [--out batch] a.html [b.html ...]
//   Each build runs every seed (as many at a time as --jobs, default one fewer than the machine's cores). Logs and yearly saves go
//   to <out>/<build>-<seed>.log / .sav, so a stopped batch picks up where it left off when run again with the same arguments.
//   At the end (or with --report only) it prints, per build: each species' spring count averaged over the seeds for each year, how
//   many seeds lost it by year 10, and how many seed-years it was missing from the window.
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const args = process.argv.slice(2), opt = { seeds: '1-8', years: '10', jobs: String(Math.max(1, os.cpus().length - 1)), out: 'batch' };
const files = []; let reportOnly = false;
for (let k = 0; k < args.length; k++) { const a = args[k]; if (a === '--report') reportOnly = true; else if (a.startsWith('--')) opt[a.slice(2)] = args[++k]; else files.push(a); }
if (!files.length) { console.log('usage: node tools/batch.js [--seeds 1-8] [--years 10] [--jobs N] [--out batch] [--report] a.html [b.html ...]'); process.exit(1); }
const seeds = []; for (const part of opt.seeds.split(',')) { const [a, b] = part.split('-').map(Number); for (let s = a; s <= (b || a); s++) seeds.push(s); }
const years = +opt.years, out = path.resolve(opt.out); fs.mkdirSync(out, { recursive: true });
const name = f => path.basename(f, '.html'), log = (f, s) => path.join(out, `${name(f)}-${s}.log`);
const done = (f, s) => fs.existsSync(log(f, s)) && new RegExp(`^y${years}\\.`, 'm').test(fs.readFileSync(log(f, s), 'utf8'));
const decade = path.join(__dirname, 'decade.js');

function report() {
  const KEYS = ['rab', 'hop', 'fox', 'bird', 'fish', 'grass', 'shrub', 'soil', 'trees'];
  for (const f of files) {
    const rows = [];   // rows[seed][year] = {key: n}
    for (const s of seeds) {
      if (!fs.existsSync(log(f, s))) continue;
      const by = [];
      for (const line of fs.readFileSync(log(f, s), 'utf8').split('\n')) {
        const m = line.match(/^y(\d+)\.1\d Spring/); if (!m || by[+m[1]]) continue;
        const n = k => +(line.match(new RegExp(`\\b${k} (\\d+)`)) || [0, 0])[1];
        const t = line.match(/trees (\d+)b (\d+)c/) || [0, 0, 0];
        by[+m[1]] = { rab: n('rab'), hop: n('hop'), fox: n('fox'), bird: n('bird'), fish: n('fish'), grass: n('grass'), shrub: n('shrub'), soil: n('soil'), trees: +t[1] + +t[2] };
      }
      rows.push(by);
    }
    console.log(`\n== ${name(f)}: ${rows.length} seeds (spring census, mean over seeds)`);
    console.log('year  ' + KEYS.map(k => k.padStart(7)).join(''));
    for (let y = 0; y <= years; y++) {
      const have = rows.filter(r => r[y]); if (!have.length) continue;
      console.log(String(y).padStart(4) + '  ' + KEYS.map(k => (have.reduce((a, r) => a + r[y][k], 0) / have.length).toFixed(k === 'soil' ? 0 : 1).padStart(7)).join(''));
    }
    const fin = rows.filter(r => r[years]);
    console.log(`gone at year ${years} (of ${fin.length} seeds): ` + KEYS.filter(k => k !== 'soil').map(k => `${k} ${fin.filter(r => r[years][k] === 0).length}`).join(', '));
    console.log('seed-years missing (years 1-' + years + '): ' + KEYS.filter(k => k !== 'soil').map(k => `${k} ${rows.reduce((a, r) => a + r.slice(1).filter(c => c && c[k] === 0).length, 0)}`).join(', '));
  }
}
if (reportOnly) { report(); process.exit(0); }
const queue = []; for (const s of seeds) for (const f of files) if (!done(f, s)) queue.push([f, s]);
console.log(`${queue.length} runs to do, ${opt.jobs} at a time; logs in ${out}`);
let running = 0; const t0 = Date.now();
function next() {
  if (!queue.length) { if (!running) { console.log(`all done in ${((Date.now() - t0) / 60000).toFixed(0)} min`); report(); } return; }
  const [f, s] = queue.shift(); running++;
  const p = spawn(process.execPath, [decade, String(s), String(years), path.join(out, `${name(f)}-${s}`)], { env: { ...process.env, SIMFILE: path.resolve(f) } });
  const o = fs.createWriteStream(log(f, s), { flags: 'a' }); p.stdout.pipe(o); p.stderr.pipe(o);
  p.on('close', code => { running--; console.log(`${name(f)} seed ${s}: ${code === 0 ? 'done' : 'exit ' + code} [${((Date.now() - t0) / 60000).toFixed(0)} min]`); next(); });
}
for (let k = 0; k < +opt.jobs; k++) next();
