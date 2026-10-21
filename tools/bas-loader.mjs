// Fabrique un chargeur BASIC (lignes DATA + somme de contrôle) à partir d'un source assembleur.
// Usage : node tools/bas-loader.mjs exemples/ecran-partage.asm > exemples/ecran-partage.bas
import { readFileSync } from 'node:fs';
import { assemble } from '../src/asm/assembler.js';

export function basLoader(source, { title = 'programme', memory, call = [], first = 10, step = 10, before = [], after = [] } = {}) {
  const res = assemble(source);
  if (!res.ok) throw new Error(res.errors.map(e => `ligne ${e.line} : ${e.message}`).join('\n'));
  const seg = res.segments[0];
  // les octets nuls de fin (variables, blocs réservés par DS) n'ont pas besoin d'être tapés
  const all = [...seg.bytes];
  let len = all.length;
  while (len > 1 && all[len - 1] === 0) len--;
  const bytes = all.slice(0, len), start = seg.start, end = start + bytes.length - 1;
  const hex = (v, n = 2) => v.toString(16).toUpperCase().padStart(n, '0');
  const sum = bytes.reduce((s, v) => s + v, 0);
  let n = first;
  const L = t => { const l = `${n} ${t}`; n += step; return l; };
  const out = [
    L(`' ${title}`),
    L(`MEMORY &${hex(memory ?? start - 1, 4)}`),
    ...before.map(L),
    L(`s=0:FOR a=&${hex(start, 4)} TO &${hex(end, 4)}:READ o$:o=VAL("&"+o$):POKE a,o:s=s+o:NEXT`),
    L(`IF s<>${sum} THEN PRINT "Erreur dans les DATA":END`),
    ...after.map(L),
    ...call.map(c => L(`CALL &${hex(c, 4)}`)),
    L('END'),
  ];
  for (let i = 0; i < bytes.length; i += 16) out.push(L('DATA ' + bytes.slice(i, i + 16).map(v => hex(v)).join(',')));
  return { text: out.join('\n') + '\n', start, end, sum, symbols: res.symbols };
}

if (process.argv[1]?.endsWith("bas-loader.mjs")) {
  const file = process.argv[2];
  if (file) process.stdout.write(basLoader(readFileSync(file, 'utf8')).text);
}
