import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Z80, FC, FN, FPV, FX, FH, FY, FZ, FS } from '../src/z80/cpu.js';

// Test machine: 64 KB of RAM, recorded ports
function machine(bytes = [], at = 0) {
  const mem = new Uint8Array(0x10000);
  mem.set(bytes, at);
  const io = { out: [], inValue: 0xFF };
  const bus = {
    read: a => mem[a & 0xFFFF],
    write: (a, v) => { mem[a & 0xFFFF] = v; },
    in: p => io.inValue,
    out: (p, v) => io.out.push([p, v]),
  };
  const cpu = new Z80(bus);
  cpu.pc = at;
  return { cpu, mem, io };
}
const run = (cpu, n) => { let t = 0; for (let i = 0; i < n; i++) t += cpu.step(); return t; };

test('ADD A,B: signed overflow', () => {
  const { cpu } = machine([0x80]);           // ADD A,B
  cpu.a = 0x7F; cpu.b = 0x01;
  assert.equal(cpu.step(), 4);
  assert.equal(cpu.a, 0x80);
  assert.equal(cpu.f, FS | FH | FPV);
});

test('SUB 1 depuis 0 : emprunt', () => {
  const { cpu } = machine([0xD6, 0x01]);     // SUB 1
  cpu.a = 0;
  assert.equal(cpu.step(), 7);
  assert.equal(cpu.a, 0xFF);
  assert.equal(cpu.f, FS | FY | FH | FX | FN | FC);
});

test('CP: A unchanged, X/Y taken from the operand', () => {
  const { cpu } = machine([0xFE, 0x28]);     // CP &28
  cpu.a = 0x10;
  cpu.step();
  assert.equal(cpu.a, 0x10);
  assert.equal(cpu.f, FS | FY | FH | FX | FN | FC);
});

test('DAA after BCD addition 15 + 27 = 42', () => {
  const { cpu } = machine([0xC6, 0x27, 0x27]); // ADD A,&27 ; DAA
  cpu.a = 0x15;
  run(cpu, 2);
  assert.equal(cpu.a, 0x42);
  assert.equal(cpu.f, FH | FPV);
});

test('DAA after BCD subtraction 42 - 15 = 27', () => {
  const { cpu } = machine([0xD6, 0x15, 0x27]); // SUB &15 ; DAA
  cpu.a = 0x42;
  run(cpu, 2);
  assert.equal(cpu.a, 0x27);
  assert.equal(cpu.f & FC, 0);
  assert.equal(cpu.f & FN, FN);
});

test('8-bit INC / DEC: V, H, carry preserved', () => {
  const { cpu } = machine([0x3C, 0x05]);     // INC A ; DEC B
  cpu.a = 0x7F; cpu.b = 0x80; cpu.f = FC;
  cpu.step();
  assert.equal(cpu.a, 0x80);
  assert.equal(cpu.f, FS | FH | FPV | FC);
  cpu.step();
  assert.equal(cpu.b, 0x7F);
  assert.equal(cpu.f, FY | FH | FX | FPV | FN | FC);
});

test('NEG of &80', () => {
  const { cpu } = machine([0xED, 0x44]);
  cpu.a = 0x80;
  assert.equal(cpu.step(), 8);
  assert.equal(cpu.a, 0x80);
  assert.equal(cpu.f, FS | FPV | FN | FC);
});

test('ADD HL,DE and SBC HL,DE', () => {
  const { cpu } = machine([0x19, 0xED, 0x52]); // ADD HL,DE ; SBC HL,DE
  cpu.hl = 0x8000; cpu.de = 0x8000; cpu.f = 0;
  assert.equal(cpu.step(), 11);
  assert.equal(cpu.hl, 0);
  assert.equal(cpu.f, FC);
  cpu.hl = 0; cpu.de = 1; cpu.f = 0;
  assert.equal(cpu.step(), 15);
  assert.equal(cpu.hl, 0xFFFF);
  assert.equal(cpu.f, FS | FY | FH | FX | FN | FC);
});

test('rotations of A and CB prefix', () => {
  const { cpu } = machine([0x07, 0xCB, 0x38, 0xCB, 0x30]); // RLCA ; SRL B ; SLL B
  cpu.a = 0x81; cpu.b = 0x03; cpu.f = 0;
  cpu.step();
  assert.equal(cpu.a, 0x03); assert.equal(cpu.f & FC, FC);
  assert.equal(cpu.step(), 8);
  assert.equal(cpu.b, 0x01); assert.equal(cpu.f & FC, FC);
  cpu.step();
  assert.equal(cpu.b, 0x03);
});

test('BIT 7,H and BIT 0,(HL)', () => {
  const { cpu, mem } = machine([0xCB, 0x7C, 0xCB, 0x46]);
  cpu.h = 0x80; cpu.l = 0x00; cpu.f = FC;
  cpu.step();
  assert.equal(cpu.f, FS | FH | FC);
  mem[0x8000] = 0xFE;
  assert.equal(cpu.step(), 12);
  assert.equal(cpu.f & (FZ | FPV), FZ | FPV);
});

test('LD and IX indexed access: values and T-states', () => {
  const { cpu, mem } = machine([
    0xDD, 0x21, 0x00, 0x40,       // LD IX,&4000      14
    0xDD, 0x36, 0x02, 0x55,       // LD (IX+2),&55    19
    0xDD, 0x7E, 0x02,             // LD A,(IX+2)      19
    0xDD, 0x34, 0xFF,             // INC (IX-1)       23
    0xDD, 0x26, 0x12,             // LD IXH,&12       11
    0xDD, 0x7D,                   // LD A,IXL          8
  ]);
  assert.deepEqual([cpu.step(), cpu.step(), cpu.step(), cpu.step(), cpu.step(), cpu.step()], [14, 19, 19, 23, 11, 8]);
  assert.equal(mem[0x4002], 0x55);
  assert.equal(mem[0x3FFF], 0x01);
  assert.equal(cpu.ix, 0x1200);
  assert.equal(cpu.a, 0x00);
});

test('DDCB: SET 0,(IX+1),B copies the result into B (undocumented)', () => {
  const { cpu, mem } = machine([0xDD, 0xCB, 0x01, 0xC0]);
  cpu.ix = 0x5000; mem[0x5001] = 0x10;
  assert.equal(cpu.step(), 23);
  assert.equal(mem[0x5001], 0x11);
  assert.equal(cpu.b, 0x11);
});

test('PUSH / POP / CALL / RET', () => {
  const { cpu } = machine([
    0x31, 0x00, 0x90,             // LD SP,&9000
    0xC5,                         // PUSH BC
    0xCD, 0x10, 0x00,             // CALL &0010
    0xF1,                         // POP AF
  ]);
  cpu.bc = 0x1234;
  cpu.step(); assert.equal(cpu.step(), 11);
  assert.equal(cpu.step(), 17);
  assert.equal(cpu.pc, 0x0010); assert.equal(cpu.sp, 0x8FFC);
  cpu.pc = 0x0010; cpu.bus.write(0x0010, 0xC9);   // RET
  assert.equal(cpu.step(), 10);
  assert.equal(cpu.pc, 0x0007);
  assert.equal(cpu.step(), 10);
  assert.equal(cpu.af, 0x1234);
});

test('relative jumps and DJNZ: T-states taken / not taken', () => {
  const { cpu } = machine([0x06, 0x02, 0x10, 0xFE, 0x28, 0x00, 0x20, 0xFE]);
  cpu.step();                         // LD B,2
  assert.equal(cpu.step(), 13);       // DJNZ $ (B=1, jump)
  assert.equal(cpu.step(), 8);        // DJNZ $ (B=0, falls through)
  cpu.f = 0;
  assert.equal(cpu.step(), 7);        // JR Z (not taken)
  assert.equal(cpu.step(), 12);       // JR NZ,$ (taken)
  assert.equal(cpu.pc, 0x0006);
});

test('LDIR copies 3 bytes in 58 T', () => {
  const { cpu, mem } = machine([0xED, 0xB0]);
  mem.set([1, 2, 3], 0x8000);
  cpu.hl = 0x8000; cpu.de = 0x9000; cpu.bc = 3;
  let t = 0;
  while (cpu.pc !== 2) t += cpu.step();
  assert.equal(t, 21 + 21 + 16);
  assert.deepEqual([...mem.slice(0x9000, 0x9003)], [1, 2, 3]);
  assert.equal(cpu.bc, 0);
  assert.equal(cpu.f & FPV, 0);
});

test('CPIR stops on the byte found', () => {
  const { cpu, mem } = machine([0xED, 0xB1]);
  mem.set([7, 8, 9, 10], 0x8000);
  cpu.hl = 0x8000; cpu.bc = 4; cpu.a = 9;
  while (cpu.pc !== 2) cpu.step();
  assert.equal(cpu.hl, 0x8003);
  assert.equal(cpu.bc, 1);
  assert.equal(cpu.f & FZ, FZ);
  assert.equal(cpu.f & FPV, FPV);
});

test('RLD', () => {
  const { cpu, mem } = machine([0xED, 0x6F]);
  cpu.hl = 0x8000; mem[0x8000] = 0x31; cpu.a = 0x7A;
  assert.equal(cpu.step(), 18);
  assert.equal(cpu.a, 0x73);
  assert.equal(mem[0x8000], 0x1A);
});

test('I/O: OUT (n),A, OUT (C),0 (NMOS), IN r,(C)', () => {
  const { cpu, io } = machine([0xD3, 0xFE, 0xED, 0x71, 0xED, 0x78]);
  cpu.a = 0x12; cpu.bc = 0x7F10; io.inValue = 0x00;
  assert.equal(cpu.step(), 11);
  assert.equal(cpu.step(), 12);
  assert.equal(cpu.step(), 12);
  assert.deepEqual(io.out, [[0x12FE, 0x12], [0x7F10, 0x00]]);
  assert.equal(cpu.a, 0x00);
  assert.equal(cpu.f & (FZ | FPV), FZ | FPV);
});

test('EX AF,AF\' and EXX', () => {
  const { cpu } = machine([0x08, 0xD9]);
  cpu.af = 0x1122; cpu.a_ = 0x33; cpu.f_ = 0x44;
  cpu.bc = 0xAAAA; cpu.b_ = 0x55; cpu.c_ = 0x66;
  cpu.step(); cpu.step();
  assert.equal(cpu.af, 0x3344);
  assert.equal(cpu.bc, 0x5566);
  assert.equal(cpu.b_, 0xAA);
});

test('IM 1 interrupt: delayed by one instruction after EI, 13 T', () => {
  const { cpu } = machine([0xED, 0x56, 0xFB, 0x00, 0x00]);  // IM 1 ; EI ; NOP ; NOP
  cpu.sp = 0x9000;
  cpu.step(); cpu.step();
  cpu.irq(true);
  assert.equal(cpu.step(), 4);       // the NOP after EI executes
  assert.equal(cpu.pc, 4);
  assert.equal(cpu.step(), 13);      // acceptance
  assert.equal(cpu.pc, 0x0038);
  assert.equal(cpu.iff1, 0);
  assert.equal(cpu.bus.read(0x8FFE), 0x04);
});

test('IM 2 interrupt: vector I·data, 19 T', () => {
  const { cpu, mem } = machine([0xED, 0x5E, 0xFB, 0x00]);
  cpu.sp = 0x9000; cpu.i = 0x80;
  mem[0x80FE] = 0x34; mem[0x80FF] = 0x12;
  cpu.step(); cpu.step(); cpu.step();
  cpu.irq(true, 0xFE);
  assert.equal(cpu.step(), 19);
  assert.equal(cpu.pc, 0x1234);
});

test('HALT then interrupt: resumes after the HALT', () => {
  const { cpu } = machine([0xFB, 0x76, 0x00]);
  cpu.sp = 0x9000; cpu.im = 1;
  cpu.step(); cpu.step();
  assert.equal(cpu.halted, true);
  assert.equal(cpu.step(), 4);
  assert.equal(cpu.pc, 2);
  cpu.irq(true);
  cpu.step();
  assert.equal(cpu.halted, false);
  assert.equal(cpu.pc, 0x38);
  assert.equal(cpu.bus.read(0x8FFE), 0x02);
});

test('NMI: jump to &0066, IFF2 preserved, 11 T', () => {
  const { cpu } = machine([0x00]);
  cpu.sp = 0x9000; cpu.iff1 = cpu.iff2 = 1;
  cpu.nmi();
  assert.equal(cpu.step(), 11);
  assert.equal(cpu.pc, 0x66);
  assert.equal(cpu.iff1, 0);
  assert.equal(cpu.iff2, 1);
});

test('NMOS bug of LD A,I: P/V at 0 if an interrupt is accepted right after', () => {
  const { cpu } = machine([0xED, 0x57]);
  cpu.sp = 0x9000; cpu.im = 1; cpu.iff1 = cpu.iff2 = 1;
  cpu.step();
  assert.equal(cpu.f & FPV, FPV);
  cpu.irq(true);
  cpu.step();
  assert.equal(cpu.f & FPV, 0);
});

test('R register: 7 bits incremented on each M1, prefixes included', () => {
  const { cpu } = machine([0x00, 0xDD, 0x23, 0xCB, 0x00]);
  cpu.r = 0xFE;
  run(cpu, 3);
  assert.equal(cpu.r, 0x80 | ((0x7E + 5) & 0x7F));
});

test('machine cycle trace of LD A,(HL)', () => {
  const { cpu, mem } = machine([0x7E]);
  cpu.hl = 0x4019; mem[0x4019] = 0x42; cpu.i = 0; cpu.r = 0x2E;
  cpu.trace = [];
  cpu.step();
  assert.deepEqual(cpu.trace.map(c => [c.type, c.addr, c.data, c.t]), [['M1', 0, 0x7E, 4], ['MR', 0x4019, 0x42, 3]]);
  assert.equal(cpu.trace[0].refresh, 0x002F);
});

test('the trace always adds up to the instruction T-states', () => {
  const prog = [0xDD, 0xCB, 0x01, 0x46, 0xED, 0xB0, 0xE3, 0xCD, 0x00, 0x80];
  const { cpu } = machine(prog);
  cpu.ix = 0x6000; cpu.bc = 2; cpu.hl = 0x7000; cpu.de = 0x7100; cpu.sp = 0x9000;
  cpu.trace = [];
  for (let i = 0; i < 5; i++) {
    cpu.trace.length = 0;
    const t = cpu.step();
    assert.equal(cpu.trace.reduce((s, c) => s + c.t, 0), t);
  }
});
