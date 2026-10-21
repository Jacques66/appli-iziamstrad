// Contrôles croisés : désassembleur → assembleur → désassembleur, et exemples exécutés sur la machine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assemble } from '../src/asm/assembler.js';
import { disassemble } from '../src/z80/disasm.js';
import { MinimalMachine } from '../src/machines/minimal.js';
import { EXAMPLES } from '../app/examples.js';

const BASE = 0x4000;
const tables = {
  'non préfixée': op => [op, 0x34, 0x12],
  CB: op => [0xCB, op],
  ED: op => [0xED, op, 0x34, 0x12],
  DD: op => [0xDD, op, 0x05, 0x06],
  FD: op => [0xFD, op, 0xFB, 0x06],
  DDCB: op => [0xDD, 0xCB, 0x05, op],
  FDCB: op => [0xFD, 0xCB, 0xFB, op],
};

for (const [name, make] of Object.entries(tables)) {
  test(`aller-retour texte → octets → texte — table ${name}`, () => {
    const errors = [];
    for (let op = 0; op < 256; op++) {
      const bytes = make(op);
      const d1 = disassemble(a => bytes[a - BASE] ?? 0, BASE);
      const res = assemble(`  ORG &${BASE.toString(16)}\n  ${d1.text}\n`);
      if (!res.ok) { errors.push(`${d1.text} : ${res.errors[0].message}`); continue; }
      const out = res.segments[0].bytes;
      const d2 = disassemble(a => out[a - BASE] ?? 0, BASE);
      if (d2.text !== d1.text) errors.push(`${d1.text} → ${[...out].map(v => v.toString(16)).join(' ')} → ${d2.text}`);
    }
    assert.deepEqual(errors, []);
  });
}

function runExample(name, until, maxT = 2_000_000) {
  const ex = EXAMPLES.find(e => e.name === name);
  const res = assemble(ex.source);
  assert.ok(res.ok, JSON.stringify(res.errors));
  const m = new MinimalMachine();
  m.load(res.segments);
  m.reset();
  while (!until(m) && m.cpu.cycles < maxT) m.cpu.step();
  return m;
}

test('exemple multiplication : 13 × 11 = 143 en SRAM et sur les LED', () => {
  const m = runExample('multiplication.asm', m => m.cpu.halted);
  assert.equal(m.ram[0] | (m.ram[1] << 8), 143);
  assert.equal(m.leds, 143);
});

test('exemple compteur : DAA compte en décimal (09 → 10)', () => {
  const seen = [];
  runExample('compteur.asm', m => {
    if (m.io.length && seen[seen.length - 1] !== m.leds) seen.push(m.leds);
    return seen.length >= 12;
  });
  assert.deepEqual(seen, [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x10, 0x11, 0x12]);
});

test('exemple chenillard : la LED tourne à gauche, puis à droite avec l\'interrupteur 0', () => {
  const seen = [];
  const m = runExample('chenillard.asm', m => {
    if (m.io.length && m.io[m.io.length - 1].dir === 'out' && seen[seen.length - 1] !== m.leds) seen.push(m.leds);
    return seen.length >= 4;
  });
  assert.deepEqual(seen, [0x01, 0x02, 0x04, 0x08]);
  m.switches = 0x01;
  const back = [];
  while (back.length < 3) { m.cpu.step(); if (back[back.length - 1] !== m.leds && m.leds !== 0x08) back.push(m.leds); }
  assert.deepEqual(back, [0x04, 0x02, 0x01]);
});

test('exemple interruption : chaque /INT incrémente les LED', () => {
  const m = runExample('interruption.asm', m => m.cpu.halted);
  for (let n = 1; n <= 3; n++) {
    m.cpu.irq(true);
    m.cpu.step();               // acceptation
    m.cpu.irq(false);
    while (!m.cpu.halted) m.cpu.step();
    assert.equal(m.leds, n);
  }
});
