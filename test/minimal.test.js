import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MinimalMachine } from '../src/machines/minimal.js';

test('memory decoding: read-only EPROM, SRAM at &8000, floating bus elsewhere', () => {
  const m = new MinimalMachine();
  m.load([{ start: 0, bytes: new Uint8Array([0x3E, 0x55]) }]);
  m.write(0x0000, 0x00);
  assert.equal(m.read(0x0000), 0x3E);
  m.write(0x8001, 0x12);
  assert.equal(m.read(0x8001), 0x12);
  assert.equal(m.read(0x4000), 0xFF);
  m.write(0x4000, 0x00);
  assert.equal(m.read(0x4000), 0xFF);
});

test('program: OUT (&00) lights the LEDs, IN (&01) reads the switches', () => {
  const m = new MinimalMachine();
  m.switches = 0xA5;
  // IN A,(&01) ; CPL ; OUT (&00),A ; HALT
  m.load([{ start: 0, bytes: new Uint8Array([0xDB, 0x01, 0x2F, 0xD3, 0x00, 0x76]) }]);
  m.reset();
  while (!m.cpu.halted) m.cpu.step();
  assert.equal(m.leds, 0x5A);
  assert.deepEqual(m.io.map(x => [x.dir, x.port & 0xFF, x.value]), [['in', 0x01, 0xA5], ['out', 0x00, 0x5A]]);
});
