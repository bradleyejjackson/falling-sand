// Headless loaders for falling-sand.html.
//   loadSim(file)  -> the Sim module only (script body up to the RENDER banner)
//   loadPage(file) -> runs the whole page against a stub DOM; returns window.sandfall plus hooks
const fs = require('fs');
const path = require('path');

const DEFAULT = path.join(__dirname, '..', 'falling-sand.html');
function scriptOf(file) {
  const html = fs.readFileSync(file || DEFAULT, 'utf8');
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('no <script> block');
  return m[1];
}
function simSource(file) {   // the script body up to the RENDER banner
  const src = scriptOf(file);
  const cut = src.search(/\/\/\s+RENDER/);
  return src.slice(0, src.lastIndexOf('// ====', cut));
}
function loadSim(file) { return new Function(simSource(file) + '\nreturn Sim;')(); }

function stubElement(id) {
  const el = {
    id, textContent: '', value: '', innerHTML: '', className: '', type: '', children: [], listeners: {}, attrs: {},
    style: { setProperty() {} },
    classList: { _s: new Set(), toggle(c) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); }, contains(c) { return this._s.has(c); }, add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); } },
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
    fire(t, e = {}) { for (const f of this.listeners[t] || []) f(Object.assign({ target: el, preventDefault() {} }, e)); },
    setPointerCapture() {}, getBoundingClientRect() { return { left: 0, top: 0, width: 320, height: 200 }; },
    getContext() {   // (drawing calls other than the frame's own image are no-ops)
      const ctx = { createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {}, calls: 0 };
      return new Proxy(ctx, { get: (o, k) => k in o ? o[k] : () => { o.calls++; }, set: (o, k, v) => { o[k] = v; return true; } });
    },
  };
  return el;
}
// opts.threads: give the page Worker and Blob (backed by worker_threads), so it runs its cell pass on workers
function loadPage(file, opts = {}) {
  const src = scriptOf(file);
  const els = {}, created = [];
  const document = {
    getElementById: id => (els[id] = els[id] || stubElement(id)),
    createElement: tag => { const e = stubElement(tag); created.push(e); return e; },
    currentScript: { textContent: src },
  };
  const blobs = new Map(), live = [];
  const Blob = opts.threads ? class { constructor(parts) { this.text = parts.join(''); } } : undefined;
  const URL = { createObjectURL: b => { const u = 'blob:' + blobs.size; blobs.set(u, b.text); return u; } };
  const Worker = opts.threads ? class {
    constructor(url) {
      const boot = `const { parentPort } = require('worker_threads'); globalThis.postMessage = m => parentPort.postMessage(m);
        parentPort.on('message', m => globalThis.onmessage({ data: m }));\n`;
      this.w = new (require('worker_threads').Worker)(boot + blobs.get(url), { eval: true }); live.push(this.w);
      this.w.on('error', e => { console.error('worker error', e); this.onerror && this.onerror(e); });
    }
    postMessage(m) { this.w.postMessage(m); }
    terminate() { this.w.terminate(); }
  } : undefined;
  const navigator = { hardwareConcurrency: 4 };
  const frames = [];
  const store = {};
  const listeners = {};
  const window = { addEventListener(t, f) { (listeners[t] = listeners[t] || []).push(f); }, claude: undefined, fire: (t, e) => (listeners[t] || []).forEach(f => f(Object.assign({ target: {}, preventDefault() {} }, e))) };
  const localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  let now = 0;
  const performance = { now: () => now };
  const requestAnimationFrame = f => frames.push(f);
  new Function('window', 'document', 'localStorage', 'performance', 'requestAnimationFrame', 'btoa', 'atob', 'Worker', 'Blob', 'URL', 'navigator', src)(
    window, document, localStorage, performance, requestAnimationFrame,
    s => Buffer.from(s, 'binary').toString('base64'), s => Buffer.from(s, 'base64').toString('binary'), Worker, Blob, URL, navigator);
  // drive n frames of the page's own loop (with workers, each frame first waits for the tick they are running, so every frame ticks)
  const g = window.sandfall.g;
  const settle = () => { if (!opts.threads) return; const c = g.ctl; while (Atomics.load(c, 1) !== Atomics.load(c, 0)) Atomics.wait(c, 1, Atomics.load(c, 1), 50); };
  const run = n => { for (let k = 0; k < n; k++) { settle(); now += 16.7; const f = frames.shift(); if (!f) throw new Error('loop stopped'); f(now); } };
  const ready = () => { const t = Date.now(); while (g.workersReady() < window.sandfall.pool.n && Date.now() - t < 10000) Atomics.wait(g.ctl, 0, Atomics.load(g.ctl, 0), 20); return g.workersReady(); };
  const close = () => { g.stopWorkers(); for (const w of live) w.terminate(); };
  return { sf: window.sandfall, els, created, run, store, ready, close, window };
}

function census(g, EL) {
  const c = new Map();
  for (let i = 0; i < g.type.length; i++) c.set(g.type[i], (c.get(g.type[i]) || 0) + 1);
  const o = {}; for (const [t, n] of c) o[EL[t].name] = n; return o;
}
module.exports = { loadSim, simSource, loadPage, census, scriptOf };
