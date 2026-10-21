// Recopie les sources de exemples/*.asm dans app/examples.js (entrées de même nom) :
// node tools/sync-examples.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const file = new URL('app/examples.js', root);
let js = readFileSync(file, 'utf8');
const escape = s => s.replace(/\r\n/g, '\n').replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
for (const name of readdirSync(new URL('exemples/', root)).filter(f => f.endsWith('.asm'))) {
  const at = js.indexOf(`name: '${name}'`);
  if (at < 0) { console.log(`${name} : absent de app/examples.js (à ajouter à la main)`); continue; }
  const a = js.indexOf('source: `', at) + 'source: `'.length;
  let b = a;
  while (js[b] !== '`' || js[b - 1] === '\\') b++;
  js = js.slice(0, a) + escape(readFileSync(new URL('exemples/' + name, root), 'utf8')) + js.slice(b);
  console.log(`${name} : synchronisé`);
}
writeFileSync(file, js);
