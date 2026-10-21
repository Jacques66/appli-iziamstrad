// Contrôle croisé de deux implémentations indépendantes : le CPU et le désassembleur
// doivent s'accorder sur les T-states et la longueur de chaque opcode de chaque table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Z80 } from '../src/z80/cpu.js';
import { disassemble } from '../src/z80/disasm.js';

const BASE = 0x8000;

function check(bytes, errors) {
  try { checkOne(bytes); } catch (e) { errors.push(e.message); }
}
function checkOne(bytes) {
  const mem = new Uint8Array(0x10000);
  mem.set(bytes, BASE);
  const bus = { read: a => mem[a & 0xFFFF], write: (a, v) => { mem[a & 0xFFFF] = v; }, in: () => 0xFF, out: () => {} };
  const cpu = new Z80(bus);
  cpu.pc = BASE; cpu.sp = 0xC000; cpu.bc = 0x0202; cpu.hl = 0x6000; cpu.de = 0x6100;
  cpu.ix = 0x6200; cpu.iy = 0x6300; cpu.a = 1; cpu.f = 0;
  const d = disassemble(bus.read, BASE);
  const t = cpu.step();
  const expected = Array.isArray(d.tstates) ? d.tstates : [d.tstates];
  const hex = bytes.slice(0, d.length).map(v => v.toString(16).padStart(2, '0')).join(' ');
  assert.ok(expected.includes(t), `${hex} « ${d.text} » : CPU ${t} T, désassembleur ${d.tstates}`);
  // longueur : le PC doit avancer de la longueur décodée quand il n'y a ni saut ni répétition
  if (!d.flow && !Array.isArray(d.tstates) && !/^(LD|CP|IN|OT|OU)[ID]R$/.test(d.mnemonic)) {
    assert.equal(cpu.pc, (BASE + d.length) & 0xFFFF, `${hex} « ${d.text} » : longueur ${d.length}, PC +${cpu.pc - BASE}`);
  }
}

const tables = {
  'non préfixée': op => [op, 0x05, 0x06, 0x07],
  CB: op => [0xCB, op, 0, 0],
  ED: op => [0xED, op, 0x05, 0x06],
  DD: op => [0xDD, op, 0x05, 0x06],
  FD: op => [0xFD, op, 0x05, 0x06],
  DDCB: op => [0xDD, 0xCB, 0x05, op],
  FDCB: op => [0xFD, 0xCB, 0xFB, op],
};
for (const [name, make] of Object.entries(tables)) {
  test(`T-states et longueurs identiques — table ${name}`, () => {
    const errors = [];
    for (let op = 0; op < 256; op++) {
      if (name === 'non préfixée' && [0xCB, 0xDD, 0xED, 0xFD].includes(op)) continue;
      if ((name === 'DD' || name === 'FD') && op === 0xCB) continue;
      check(make(op), errors);
    }
    assert.deepEqual(errors, []);
  });
}
