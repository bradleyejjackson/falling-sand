// Build the static site (GitHub Pages and Cloudflare Pages): wrap falling-sand.html (which has no doctype/head of its own) into a complete _site/index.html.
// No <body> tag: the parser hoists the leading <title>/<meta>/<link>/<style> into <head> and opens <body> at <header>.
// Usage: node tools/pages.js [outDir]
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const out = path.resolve(process.argv[2] || path.join(root, '_site'));
const body = fs.readFileSync(path.join(root, 'falling-sand.html'), 'utf8');
if (/<!doctype/i.test(body.slice(0, 200))) throw new Error('falling-sand.html already has a doctype; drop the wrapper here');
// coi-serviceworker.js makes the site cross-origin isolated (Pages can't send the headers), so the game runs its worker pool there
const page = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n'
  + '<script src="coi-serviceworker.js"></script>\n</head>\n' + body + '\n</html>\n';
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'index.html'), page);
fs.copyFileSync(path.join(__dirname, 'coi-serviceworker.js'), path.join(out, 'coi-serviceworker.js'));
fs.writeFileSync(path.join(out, '.nojekyll'), '');
// Cloudflare Pages reads _headers for COOP/COEP; GitHub Pages ignores it (just serves it as a file).
fs.copyFileSync(path.join(__dirname, '_headers'), path.join(out, '_headers'));
console.log('wrote ' + path.join(out, 'index.html') + ' (' + page.length + ' bytes)');
