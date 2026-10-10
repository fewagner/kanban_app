// What the deploy relies on when it pins a release to its own URLs: it copies
// js/ and css/ to v/<commit>/ and rewrites src="js/…" and href="css/…" in
// index.html (pin_assets in .github/workflows/pages.yml, "Cache busting" in
// docs/RELEASING.md). That covers everything only if index.html spells the
// two references that way, the modules reach each other through relative
// imports alone, and the stylesheet pulls in nothing from outside css/.
import { readFileSync, readdirSync } from 'node:fs';
import { posix } from 'node:path';
import { describe, eq } from './lib.js';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const walk = dir => readdirSync(new URL(dir, root), { withFileTypes: true }).flatMap(d =>
  d.isDirectory() ? walk(`${dir}${d.name}/`) : d.name.endsWith('.js') ? [dir + d.name] : []);

describe('index.html loads the app the way the deploy rewrites it');
const html = read('index.html');
const count = s => html.split(s).length - 1;
eq([count('src="js/app.js"'), count('href="css/style.css"')], [1, 1],
  'src="js/app.js" and href="css/style.css", once each');
const intoAssets = [...html.matchAll(/\b(?:src|href)\s*=\s*(["']?)([^"'\s>]*)\1/g)]
  .filter(m => /^(\.\/)?(js|css)\//.test(m[2])).map(m => m[0]);
eq(intoAssets.filter(a => !/^(src|href)="(js|css)\//.test(a)), [],
  'every reference into js/ or css/ is spelled src="js/…" or href="css/…"');

describe('the modules form one graph inside js/');
const SPECIFIERS = [
  /^\s*(?:import|export)\b[^'"`;]*?\bfrom\s*(['"])(.+?)\1/gm,   // import … from '…', export … from '…'
  /^\s*import\s*(['"])(.+?)\1/gm,                                 // import '…'
  /\bimport\s*\(\s*(['"`])(.+?)\1\s*\)/g,                          // import('…')
];
const modules = walk('js/').sort();
const reached = new Set(['js/app.js']);
const bad = [];
for (const file of reached) {   // also visits what is added along the way
  const src = read(file);
  for (const spec of SPECIFIERS.flatMap(re => [...src.matchAll(re)].map(m => m[2]))) {
    const target = posix.join(posix.dirname(file), spec);
    if (/^\.\.?\//.test(spec) && modules.includes(target)) reached.add(target);
    else bad.push(`${file}: '${spec}'`);
  }
}
eq(bad, [], 'every import is a relative path to a file in js/');
eq([...reached].sort(), modules,
  'every file in js/ is reached from js/app.js — nothing is loaded by a path the deploy does not pin');

describe('the stylesheet stays inside css/');
const refs = [...read('css/style.css').matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)|@import\s+(['"])(.*?)\3/g)]
  .map(m => m[2] ?? m[4]);
eq(refs.filter(r => /^\.\.\//.test(r) || /^\/(?!\/)/.test(r)), [], 'no url() or @import reaches outside css/');
