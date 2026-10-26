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
function loadSim(file) {
  const src = scriptOf(file);
  const cut = src.search(/\/\/\s+RENDER/);
  const banner = src.lastIndexOf('// ====', cut);
  return new Function(src.slice(0, banner) + '\nreturn Sim;')();
}

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
    getContext() { return { createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }; },
  };
  return el;
}
function loadPage(file) {
  const src = scriptOf(file);
  const els = {}, created = [];
  const document = {
    getElementById: id => (els[id] = els[id] || stubElement(id)),
    createElement: tag => { const e = stubElement(tag); created.push(e); return e; },
  };
  const frames = [];
  const store = {};
  const window = { addEventListener() {}, claude: undefined };
  const localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  let now = 0;
  const performance = { now: () => now };
  const requestAnimationFrame = f => frames.push(f);
  new Function('window', 'document', 'localStorage', 'performance', 'requestAnimationFrame', 'btoa', 'atob', src)(
    window, document, localStorage, performance, requestAnimationFrame,
    s => Buffer.from(s, 'binary').toString('base64'), s => Buffer.from(s, 'base64').toString('binary'));
  // drive n frames of the page's own loop
  const run = n => { for (let k = 0; k < n; k++) { now += 16.7; const f = frames.shift(); if (!f) throw new Error('loop stopped'); f(now); } };
  return { sf: window.sandfall, els, created, run, store };
}

function census(g, EL) {
  const c = new Map();
  for (let i = 0; i < g.type.length; i++) c.set(g.type[i], (c.get(g.type[i]) || 0) + 1);
  const o = {}; for (const [t, n] of c) o[EL[t].name] = n; return o;
}
module.exports = { loadSim, loadPage, census, scriptOf };
