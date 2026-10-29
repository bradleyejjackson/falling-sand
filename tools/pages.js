// Build the GitHub Pages site: wrap falling-sand.html (which has no doctype/head of its own) into a complete _site/index.html.
// No <body> tag: the parser hoists the leading <title>/<meta>/<link>/<style> into <head> and opens <body> at <header>.
// Usage: node tools/pages.js [outDir]
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const out = path.resolve(process.argv[2] || path.join(root, '_site'));
const body = fs.readFileSync(path.join(root, 'falling-sand.html'), 'utf8');
if (/<!doctype/i.test(body.slice(0, 200))) throw new Error('falling-sand.html already has a doctype; drop the wrapper here');
const page = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n</head>\n'
  + body + '\n</html>\n';
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'index.html'), page);
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log('wrote ' + path.join(out, 'index.html') + ' (' + page.length + ' bytes)');
