// Copies the sources of examples/*.asm into app/examples.js (entries with the same name):
// node tools/sync-examples.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const file = new URL('app/examples.js', root);
let js = readFileSync(file, 'utf8');
const escape = s => s.replace(/\r\n/g, '\n').replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
for (const name of readdirSync(new URL('examples/', root)).filter(f => f.endsWith('.asm'))) {
  const at = js.indexOf(`name: '${name}'`);
  if (at < 0) { console.log(`${name}: missing from app/examples.js (add it by hand)`); continue; }
  const a = js.indexOf('source: `', at) + 'source: `'.length;
  let b = a;
  while (js[b] !== '`' || js[b - 1] === '\\') b++;
  js = js.slice(0, a) + escape(readFileSync(new URL('examples/' + name, root), 'utf8')) + js.slice(b);
  console.log(`${name}: synchronized`);
}
writeFileSync(file, js);
