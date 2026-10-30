// Cross-origin isolation for a static host (GitHub Pages can't set response headers). Loaded as a page script, it installs itself
// as the site's service worker and reloads once; as the service worker, it adds the COOP/COEP headers to every response from the
// site, so the page comes back cross-origin isolated and can share memory with its worker threads (the cell pass runs on several
// cores). If isolation still doesn't take (an old browser, private mode without service workers), the page runs on one thread.
// Cross-origin requests go out in CORS mode, so the fonts still load under require-corp.
if (typeof window === 'undefined') {
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
  self.addEventListener('fetch', e => {
    const r = e.request;
    if (r.cache === 'only-if-cached' && r.mode !== 'same-origin') return;
    const cross = new URL(r.url).origin !== self.location.origin;
    const req = cross && r.mode === 'no-cors' ? new Request(r, { mode: 'cors', credentials: 'omit' }) : r;
    e.respondWith(fetch(req).then(res => {
      if (res.status === 0 || cross) return res;   // (opaque, or someone else's: passed through as it is)
      const h = new Headers(res.headers);
      h.set('Cross-Origin-Opener-Policy', 'same-origin');
      h.set('Cross-Origin-Embedder-Policy', 'require-corp');
      h.set('Cross-Origin-Resource-Policy', 'same-origin');
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
    }).catch(err => { console.error(err); throw err; }));
  });
} else (() => {
  const KEY = 'sandfall.coi-reload', mark = v => { try { if (v) sessionStorage.setItem(KEY, '1'); else sessionStorage.removeItem(KEY); return true; } catch (e) { return false; } };
  if (window.crossOriginIsolated) { mark(false); return; }
  const src = document.currentScript && document.currentScript.src;
  if (!window.isSecureContext || !navigator.serviceWorker || !src) return;
  navigator.serviceWorker.register(src).then(() => {
    // reload once the worker controls the page; never twice in a row (a browser that won't isolate would reload for ever)
    const go = () => { let again = false; try { again = !!sessionStorage.getItem(KEY); } catch (e) { return; }
      if (again) { mark(false); return; } if (mark(true)) location.reload(); };
    if (navigator.serviceWorker.controller) go();
    else navigator.serviceWorker.addEventListener('controllerchange', go, { once: true });
  }, err => console.warn('coi-serviceworker: could not register', err));
})();
