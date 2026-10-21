/* Z80A core (NMOS, Zilog) — instruction-by-instruction execution, exact T-states.
   NMOS behaviours reproduced: undocumented X/Y flags, MEMPTR (WZ) register,
   OUT (C),0 sends 0, LD A,I / LD A,R bug (P/V forced to 0 if an interrupt
   is accepted right after), DDCB opcodes with copy into a register, SLL.

   Expected bus: { read(addr), write(addr, v), in(port), out(port, v), intAck?() }.
   If `cpu.trace` is an array, every machine cycle is appended to it
   ({ type, addr, data, t }): M1, MR, MW, IOR, IOW, INTA, X (internal states). */

export const FC = 0x01, FN = 0x02, FPV = 0x04, FX = 0x08, FH = 0x10, FY = 0x20, FZ = 0x40, FS = 0x80;

const SZ53 = new Uint8Array(256), PAR = new Uint8Array(256), SZ53P = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  let p = i; p ^= p >> 4; p ^= p >> 2; p ^= p >> 1;
  PAR[i] = p & 1 ? 0 : FPV;
  SZ53[i] = (i & (FS | FY | FX)) | (i === 0 ? FZ : 0);
  SZ53P[i] = SZ53[i] | PAR[i];
}
const sbyte = v => (v & 0x80 ? v - 256 : v);

// Unprefixed opcodes that use H, L, HL or (HL): only those are modified by DD/FD
const USES_HL = new Uint8Array(256);
for (let op = 0x40; op < 0xC0; op++) {
  const s = op & 7, d = (op >> 3) & 7;
  if (op !== 0x76 && (s >= 4 && s <= 6 || (op < 0x80 && d >= 4 && d <= 6))) USES_HL[op] = 1;
}
[0x09, 0x19, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x29, 0x2A, 0x2B, 0x2C, 0x2D, 0x2E, 0x34, 0x35, 0x36, 0x39,
  0xCB, 0xE1, 0xE3, 0xE5, 0xE9, 0xF9].forEach(op => { USES_HL[op] = 1; });

export class Z80 {
  constructor(bus) {
    this.bus = bus;
    this.model = 'Z80A';
    this.clock = 4000000;
    this.trace = null;
    this.reset();
  }

  reset() {
    this.a = 0xFF; this.f = 0xFF; this.b = 0; this.c = 0; this.d = 0; this.e = 0; this.h = 0; this.l = 0;
    this.a_ = 0xFF; this.f_ = 0xFF; this.b_ = 0; this.c_ = 0; this.d_ = 0; this.e_ = 0; this.h_ = 0; this.l_ = 0;
    this.ix = 0xFFFF; this.iy = 0xFFFF; this.sp = 0xFFFF; this.pc = 0; this.wz = 0;
    this.i = 0; this.r = 0; this.iff1 = 0; this.iff2 = 0; this.im = 0;
    this.halted = false;
    this.intLine = false;       // /INT level (true = active)
    this.intData = 0xFF;        // byte placed on the bus during acknowledge
    this.nmiPending = false;
    this.eiDelay = false;
    this.ldair = false;
    this.idx = 0;               // 0 = HL, 1 = IX, 2 = IY
    this.cycles = 0;
  }

  /* ---------- Register access ---------- */
  get bc() { return (this.b << 8) | this.c; }
  get de() { return (this.d << 8) | this.e; }
  get hl() { return (this.h << 8) | this.l; }
  get af() { return (this.a << 8) | this.f; }
  set bc(v) { this.b = (v >> 8) & 0xFF; this.c = v & 0xFF; }
  set de(v) { this.d = (v >> 8) & 0xFF; this.e = v & 0xFF; }
  set hl(v) { this.h = (v >> 8) & 0xFF; this.l = v & 0xFF; }
  set af(v) { this.a = (v >> 8) & 0xFF; this.f = v & 0xFF; }

  getRegs() {
    return {
      A: this.a, F: this.f, B: this.b, C: this.c, D: this.d, E: this.e, H: this.h, L: this.l,
      "A'": this.a_, "F'": this.f_, "B'": this.b_, "C'": this.c_, "D'": this.d_, "E'": this.e_, "H'": this.h_, "L'": this.l_,
      IX: this.ix, IY: this.iy, SP: this.sp, PC: this.pc, I: this.i, R: this.r, WZ: this.wz,
      IFF1: this.iff1, IFF2: this.iff2, IM: this.im, HALT: this.halted ? 1 : 0,
    };
  }
  setReg(name, v) {
    const k = { A: 'a', F: 'f', B: 'b', C: 'c', D: 'd', E: 'e', H: 'h', L: 'l', "A'": 'a_', "F'": 'f_', "B'": 'b_', "C'": 'c_', "D'": 'd_', "E'": 'e_', "H'": 'h_', "L'": 'l_', I: 'i', R: 'r' }[name];
    if (k) { this[k] = v & 0xFF; return; }
    const w = { AF: 'af', BC: 'bc', DE: 'de', HL: 'hl' }[name];
    if (w) { this[w] = v & 0xFFFF; return; }
    const x = { IX: 'ix', IY: 'iy', SP: 'sp', PC: 'pc', WZ: 'wz' }[name];
    if (x) { this[x] = v & 0xFFFF; return; }
    if (name === 'IM') this.im = v; else if (name === 'IFF1') this.iff1 = v ? 1 : 0; else if (name === 'IFF2') this.iff2 = v ? 1 : 0;
    else throw new Error('unknown register: ' + name);
  }

  /* ---------- Machine cycles ---------- */
  fetchOp() {
    const addr = this.pc, v = this.bus.read(addr);
    this.pc = (addr + 1) & 0xFFFF;
    this.r = (this.r & 0x80) | ((this.r + 1) & 0x7F);
    this.cycles += 4;
    if (this.trace) this.trace.push({ type: 'M1', addr, data: v, t: 4, refresh: (this.i << 8) | this.r });
    return v;
  }
  rd(addr) {
    const v = this.bus.read(addr);
    this.cycles += 3;
    if (this.trace) this.trace.push({ type: 'MR', addr, data: v, t: 3 });
    return v;
  }
  wr(addr, v) {
    this.bus.write(addr, v);
    this.cycles += 3;
    if (this.trace) this.trace.push({ type: 'MW', addr, data: v, t: 3 });
  }
  ioIn(port) {
    const v = this.bus.in(port) & 0xFF;
    this.cycles += 4;
    if (this.trace) this.trace.push({ type: 'IOR', addr: port, data: v, t: 4 });
    return v;
  }
  ioOut(port, v) {
    this.bus.out(port, v);
    this.cycles += 4;
    if (this.trace) this.trace.push({ type: 'IOW', addr: port, data: v, t: 4 });
  }
  x(n) {
    this.cycles += n;
    if (this.trace) this.trace.push({ type: 'X', t: n });
  }
  imm8() { const v = this.rd(this.pc); this.pc = (this.pc + 1) & 0xFFFF; return v; }
  imm16() { const lo = this.imm8(); return lo | (this.imm8() << 8); }
  push(v) {
    this.sp = (this.sp - 1) & 0xFFFF; this.wr(this.sp, (v >> 8) & 0xFF);
    this.sp = (this.sp - 1) & 0xFFFF; this.wr(this.sp, v & 0xFF);
  }
  pop() {
    const lo = this.rd(this.sp); this.sp = (this.sp + 1) & 0xFFFF;
    const hi = this.rd(this.sp); this.sp = (this.sp + 1) & 0xFFFF;
    return lo | (hi << 8);
  }

  /* ---------- Execution ---------- */
  irq(on, data = 0xFF) { this.intLine = !!on; this.intData = data & 0xFF; }
  nmi() { this.nmiPending = true; }

  // Executes one instruction (or the acceptance of an interrupt). Returns the T-states.
  step() {
    const start = this.cycles;
    if (this.nmiPending) {
      this.nmiPending = false;
      this.acceptInt(5);
      this.iff1 = 0;
      this.push(this.pc); this.pc = 0x0066; this.wz = this.pc;
      return this.cycles - start;
    }
    if (this.intLine && this.iff1 && !this.eiDelay) {
      this.acceptInt(7);
      this.iff1 = this.iff2 = 0;
      this.bus.intAck?.();      // the device knows its interrupt is being serviced
      if (this.im === 2) {
        this.push(this.pc);
        const v = ((this.i << 8) | this.intData) & 0xFFFF;
        this.pc = this.rd(v) | (this.rd((v + 1) & 0xFFFF) << 8);
      } else {
        // IM 1, or IM 0 with an RST instruction on the bus (only case handled in IM 0)
        this.push(this.pc);
        this.pc = this.im === 1 || (this.intData & 0xC7) !== 0xC7 ? 0x0038 : this.intData & 0x38;
      }
      this.wz = this.pc;
      return this.cycles - start;
    }
    this.eiDelay = false;
    this.ldair = false;
    if (this.halted) {
      // HALT: the CPU executes NOPs without advancing PC
      const save = this.pc;
      this.fetchOp();
      this.pc = save;
      return this.cycles - start;
    }
    this.idx = 0;
    let op = this.fetchOp();
    if (op === 0xDD || op === 0xFD) {
      this.idx = op === 0xDD ? 1 : 2;
      // prefix without effect (next opcode without HL, or another prefix): 4 T NOP, as shown by the disassembler
      if (!USES_HL[this.bus.read(this.pc)]) return this.cycles - start;
      op = this.fetchOp();
    }
    this.exec(op);
    return this.cycles - start;
  }

  acceptInt(t) {
    if (this.halted) { this.halted = false; }
    if (this.ldair) { this.f &= ~FPV; this.ldair = false; }   // NMOS bug
    this.r = (this.r & 0x80) | ((this.r + 1) & 0x7F);
    this.cycles += t;
    if (this.trace) this.trace.push({ type: 'INTA', addr: this.pc, data: this.intData, t, refresh: (this.i << 8) | this.r });
  }

  // Runs up to `tstates` T-states (at least one instruction). Returns the T-states used.
  run(tstates) {
    const start = this.cycles;
    while (this.cycles - start < tstates) this.step();
    return this.cycles - start;
  }

  /* ---------- 8/16-bit registers, with IX/IY substitution ---------- */
  xy() { return this.idx === 1 ? this.ix : this.idx === 2 ? this.iy : this.hl; }
  setXY(v) {
    v &= 0xFFFF;
    if (this.idx === 1) this.ix = v; else if (this.idx === 2) this.iy = v; else this.hl = v;
  }
  // code 0..7 = B C D E H L (HL) A; plain = true to ignore IXH/IXL
  getR8(code, plain = false) {
    switch (code) {
      case 0: return this.b; case 1: return this.c; case 2: return this.d; case 3: return this.e;
      case 4: return plain || !this.idx ? this.h : (this.xy() >> 8);
      case 5: return plain || !this.idx ? this.l : (this.xy() & 0xFF);
      case 7: return this.a;
    }
    throw new Error('getR8 ' + code);
  }
  setR8(code, v, plain = false) {
    v &= 0xFF;
    switch (code) {
      case 0: this.b = v; return; case 1: this.c = v; return; case 2: this.d = v; return; case 3: this.e = v; return;
      case 4: if (plain || !this.idx) this.h = v; else this.setXY((this.xy() & 0x00FF) | (v << 8)); return;
      case 5: if (plain || !this.idx) this.l = v; else this.setXY((this.xy() & 0xFF00) | v); return;
      case 7: this.a = v; return;
    }
    throw new Error('setR8 ' + code);
  }
  // 0 BC, 1 DE, 2 HL/IX/IY, 3 SP
  getRP(p) { return p === 0 ? this.bc : p === 1 ? this.de : p === 2 ? this.xy() : this.sp; }
  setRP(p, v) {
    v &= 0xFFFF;
    if (p === 0) this.bc = v; else if (p === 1) this.de = v; else if (p === 2) this.setXY(v); else this.sp = v;
  }
  // address of the (HL) or (IX+d) operand; d is read here
  memAddr() {
    if (!this.idx) return this.hl;
    const d = sbyte(this.imm8());
    this.x(5);
    const a = (this.xy() + d) & 0xFFFF;
    this.wz = a;
    return a;
  }
  cond(c) {
    const f = this.f;
    switch (c) {
      case 0: return !(f & FZ); case 1: return !!(f & FZ); case 2: return !(f & FC); case 3: return !!(f & FC);
      case 4: return !(f & FPV); case 5: return !!(f & FPV); case 6: return !(f & FS); default: return !!(f & FS);
    }
  }

  /* ---------- ALU ---------- */
  add8(v, carry) {
    const a = this.a, r = a + v + carry;
    this.a = r & 0xFF;
    this.f = SZ53[this.a] | ((a ^ v ^ r) & FH) | (((a ^ ~v) & (a ^ r) & 0x80) ? FPV : 0) | (r > 0xFF ? FC : 0);
  }
  sub8(v, carry, store = true) {
    const a = this.a, r = a - v - carry, r8 = r & 0xFF;
    const f = (SZ53[r8] & (FS | FZ)) | ((a ^ v ^ r) & FH) | (((a ^ v) & (a ^ r) & 0x80) ? FPV : 0) | (r < 0 ? FC : 0) | FN;
    if (store) { this.a = r8; this.f = f | (r8 & (FY | FX)); }
    else this.f = f | (v & (FY | FX));   // CP: X/Y come from the operand
  }
  alu(k, v) {
    switch (k) {
      case 0: this.add8(v, 0); break;
      case 1: this.add8(v, this.f & FC); break;
      case 2: this.sub8(v, 0); break;
      case 3: this.sub8(v, this.f & FC); break;
      case 4: this.a &= v; this.f = SZ53P[this.a] | FH; break;
      case 5: this.a ^= v; this.f = SZ53P[this.a]; break;
      case 6: this.a |= v; this.f = SZ53P[this.a]; break;
      case 7: this.sub8(v, 0, false); break;
    }
  }
  inc8(v) {
    const r = (v + 1) & 0xFF;
    this.f = (this.f & FC) | SZ53[r] | (r === 0x80 ? FPV : 0) | ((r & 0x0F) === 0 ? FH : 0);
    return r;
  }
  dec8(v) {
    const r = (v - 1) & 0xFF;
    this.f = (this.f & FC) | FN | SZ53[r] | (v === 0x80 ? FPV : 0) | ((v & 0x0F) === 0 ? FH : 0);
    return r;
  }
  add16(a, v) {
    const r = a + v;
    this.wz = (a + 1) & 0xFFFF;
    this.f = (this.f & (FS | FZ | FPV)) | ((r >> 8) & (FY | FX)) | (((a ^ v ^ r) >> 8) & FH) | (r > 0xFFFF ? FC : 0);
    return r & 0xFFFF;
  }
  adc16(v) {
    const a = this.hl, r = a + v + (this.f & FC), r16 = r & 0xFFFF;
    this.wz = (a + 1) & 0xFFFF;
    this.f = ((r16 >> 8) & (FS | FY | FX)) | (r16 === 0 ? FZ : 0) | (((a ^ v ^ r) >> 8) & FH) |
      (((a ^ ~v) & (a ^ r) & 0x8000) ? FPV : 0) | (r > 0xFFFF ? FC : 0);
    this.hl = r16;
  }
  sbc16(v) {
    const a = this.hl, r = a - v - (this.f & FC), r16 = r & 0xFFFF;
    this.wz = (a + 1) & 0xFFFF;
    this.f = ((r16 >> 8) & (FS | FY | FX)) | (r16 === 0 ? FZ : 0) | (((a ^ v ^ r) >> 8) & FH) |
      (((a ^ v) & (a ^ r) & 0x8000) ? FPV : 0) | (r < 0 ? FC : 0) | FN;
    this.hl = r16;
  }
  rot(k, v) {
    let r, c;
    switch (k) {
      case 0: c = v >> 7; r = (v << 1) | c; break;                 // RLC
      case 1: c = v & 1; r = (v >> 1) | (c << 7); break;           // RRC
      case 2: c = v >> 7; r = (v << 1) | (this.f & FC); break;     // RL
      case 3: c = v & 1; r = (v >> 1) | ((this.f & FC) << 7); break; // RR
      case 4: c = v >> 7; r = v << 1; break;                       // SLA
      case 5: c = v & 1; r = (v >> 1) | (v & 0x80); break;         // SRA
      case 6: c = v >> 7; r = (v << 1) | 1; break;                 // SLL (undocumented)
      default: c = v & 1; r = v >> 1; break;                       // SRL
    }
    r &= 0xFF;
    this.f = SZ53P[r] | c;
    return r;
  }
  bit(n, v, xyFrom) {
    let f = (this.f & FC) | FH | (xyFrom & (FY | FX));
    if (!(v & (1 << n))) f |= FZ | FPV;
    if (n === 7 && (v & 0x80)) f |= FS;
    this.f = f;
  }
  daa() {
    const a = this.a;
    let t = 0, c = this.f & FC;
    if ((this.f & FH) || (a & 0x0F) > 9) t = 0x06;
    if (c || a > 0x99) { t |= 0x60; c = FC; }
    let h;
    if (this.f & FN) { h = (this.f & FH) && (a & 0x0F) < 6; this.a = (a - t) & 0xFF; }
    else { h = (a & 0x0F) > 9; this.a = (a + t) & 0xFF; }
    this.f = SZ53P[this.a] | (h ? FH : 0) | (this.f & FN) | c;
  }

  /* ---------- Main table ---------- */
  exec(op) {
    if (op >= 0x40 && op < 0x80) {
      if (op === 0x76) { this.halted = true; return; }
      const dst = (op >> 3) & 7, src = op & 7;
      if (src === 6) this.setR8(dst, this.rd(this.memAddr()), true);
      else if (dst === 6) { const a = this.memAddr(); this.wr(a, this.getR8(src, true)); }
      else this.setR8(dst, this.getR8(src));
      return;
    }
    if (op >= 0x80 && op < 0xC0) {
      const src = op & 7;
      this.alu((op >> 3) & 7, src === 6 ? this.rd(this.memAddr()) : this.getR8(src));
      return;
    }
    if (op < 0x40) {
      const y = (op >> 3) & 7, p = y >> 1;
      switch (op & 7) {
        case 4: case 5: {   // INC / DEC r
          const inc = (op & 7) === 4;
          if (y === 6) { const a = this.memAddr(); const v = this.rd(a); this.x(1); this.wr(a, inc ? this.inc8(v) : this.dec8(v)); }
          else this.setR8(y, inc ? this.inc8(this.getR8(y)) : this.dec8(this.getR8(y)));
          return;
        }
        case 6:             // LD r,n
          if (y === 6) {
            if (this.idx) {
              const d = sbyte(this.imm8()), n = this.imm8(); this.x(2);
              const a = (this.xy() + d) & 0xFFFF; this.wz = a; this.wr(a, n);
            } else this.wr(this.hl, this.imm8());
          } else this.setR8(y, this.imm8());
          return;
        case 3:             // INC / DEC rr
          this.x(2);
          this.setRP(p, this.getRP(p) + (y & 1 ? -1 : 1));
          return;
        case 1:
          if (y & 1) { this.x(7); this.setRP(2, this.add16(this.xy(), this.getRP(p))); }
          else this.setRP(p, this.imm16());
          return;
      }
    }
    switch (op) {
      case 0x00: return;
      case 0x02: this.wr(this.bc, this.a); this.wz = ((this.bc + 1) & 0xFF) | (this.a << 8); return;
      case 0x12: this.wr(this.de, this.a); this.wz = ((this.de + 1) & 0xFF) | (this.a << 8); return;
      case 0x0A: this.a = this.rd(this.bc); this.wz = (this.bc + 1) & 0xFFFF; return;
      case 0x1A: this.a = this.rd(this.de); this.wz = (this.de + 1) & 0xFFFF; return;
      case 0x22: { const n = this.imm16(), v = this.xy(); this.wr(n, v & 0xFF); this.wr((n + 1) & 0xFFFF, v >> 8); this.wz = (n + 1) & 0xFFFF; return; }
      case 0x2A: { const n = this.imm16(); this.setXY(this.rd(n) | (this.rd((n + 1) & 0xFFFF) << 8)); this.wz = (n + 1) & 0xFFFF; return; }
      case 0x32: { const n = this.imm16(); this.wr(n, this.a); this.wz = ((n + 1) & 0xFF) | (this.a << 8); return; }
      case 0x3A: { const n = this.imm16(); this.a = this.rd(n); this.wz = (n + 1) & 0xFFFF; return; }
      case 0x07: { const a = this.a; this.a = ((a << 1) | (a >> 7)) & 0xFF; this.f = (this.f & (FS | FZ | FPV)) | (this.a & (FY | FX)) | (a >> 7); return; }
      case 0x0F: { const a = this.a; this.a = ((a >> 1) | (a << 7)) & 0xFF; this.f = (this.f & (FS | FZ | FPV)) | (this.a & (FY | FX)) | (a & 1); return; }
      case 0x17: { const a = this.a; this.a = ((a << 1) | (this.f & FC)) & 0xFF; this.f = (this.f & (FS | FZ | FPV)) | (this.a & (FY | FX)) | (a >> 7); return; }
      case 0x1F: { const a = this.a; this.a = ((a >> 1) | ((this.f & FC) << 7)) & 0xFF; this.f = (this.f & (FS | FZ | FPV)) | (this.a & (FY | FX)) | (a & 1); return; }
      case 0x08: { let t = this.a; this.a = this.a_; this.a_ = t; t = this.f; this.f = this.f_; this.f_ = t; return; }
      case 0x10: {
        this.x(1);
        this.b = (this.b - 1) & 0xFF;
        const e = sbyte(this.imm8());
        if (this.b) { this.x(5); this.pc = (this.pc + e) & 0xFFFF; this.wz = this.pc; }
        return;
      }
      case 0x18: { const e = sbyte(this.imm8()); this.x(5); this.pc = (this.pc + e) & 0xFFFF; this.wz = this.pc; return; }
      case 0x20: case 0x28: case 0x30: case 0x38: {
        const e = sbyte(this.imm8());
        if (this.cond((op >> 3) & 3)) { this.x(5); this.pc = (this.pc + e) & 0xFFFF; this.wz = this.pc; }
        return;
      }
      case 0x27: this.daa(); return;
      case 0x2F: this.a ^= 0xFF; this.f = (this.f & (FS | FZ | FPV | FC)) | FH | FN | (this.a & (FY | FX)); return;
      case 0x37: this.f = (this.f & (FS | FZ | FPV)) | FC | (this.a & (FY | FX)); return;
      case 0x3F: this.f = (this.f & (FS | FZ | FPV)) | (this.f & FC ? FH : FC) | (this.a & (FY | FX)); return;

      case 0xC3: this.pc = this.wz = this.imm16(); return;
      case 0xC9: this.pc = this.wz = this.pop(); return;
      case 0xCD: { const n = this.imm16(); this.wz = n; this.x(1); this.push(this.pc); this.pc = n; return; }
      case 0xCB: this.execCB(); return;
      case 0xED: this.idx = 0; this.execED(this.fetchOp()); return;
      case 0xD3: { const n = this.imm8(); this.ioOut((this.a << 8) | n, this.a); this.wz = ((n + 1) & 0xFF) | (this.a << 8); return; }
      case 0xDB: { const n = this.imm8(), port = (this.a << 8) | n; this.a = this.ioIn(port); this.wz = (port + 1) & 0xFFFF; return; }
      case 0xD9: {
        let t;
        t = this.b; this.b = this.b_; this.b_ = t; t = this.c; this.c = this.c_; this.c_ = t;
        t = this.d; this.d = this.d_; this.d_ = t; t = this.e; this.e = this.e_; this.e_ = t;
        t = this.h; this.h = this.h_; this.h_ = t; t = this.l; this.l = this.l_; this.l_ = t;
        return;
      }
      case 0xE3: {
        const lo = this.rd(this.sp), hi = this.rd((this.sp + 1) & 0xFFFF), v = this.xy();
        this.x(1);
        this.wr((this.sp + 1) & 0xFFFF, v >> 8); this.wr(this.sp, v & 0xFF);
        this.x(2);
        this.setXY(lo | (hi << 8)); this.wz = this.xy();
        return;
      }
      case 0xE9: this.pc = this.xy(); return;
      case 0xEB: { const t = this.de; this.de = this.hl; this.hl = t; return; }
      case 0xF3: this.iff1 = this.iff2 = 0; return;
      case 0xFB: this.iff1 = this.iff2 = 1; this.eiDelay = true; return;
      case 0xF9: this.x(2); this.sp = this.xy(); return;
    }
    const y = (op >> 3) & 7;
    switch (op & 0xC7) {
      case 0xC0: this.x(1); if (this.cond(y)) this.pc = this.wz = this.pop(); return;           // RET cc
      case 0xC2: { const n = this.imm16(); this.wz = n; if (this.cond(y)) this.pc = n; return; } // JP cc
      case 0xC4: { const n = this.imm16(); this.wz = n; if (this.cond(y)) { this.x(1); this.push(this.pc); this.pc = n; } return; }
      case 0xC6: this.alu(y, this.imm8()); return;
      case 0xC7: this.x(1); this.push(this.pc); this.pc = this.wz = op & 0x38; return;          // RST
    }
    switch (op & 0xCF) {
      case 0xC1: { const v = this.pop(); if (y >> 1 === 3) this.af = v; else this.setRP(y >> 1, v); return; }
      case 0xC5: { this.x(1); this.push(y >> 1 === 3 ? this.af : this.getRP(y >> 1)); return; }
    }
    throw new Error('unhandled opcode: ' + op.toString(16));
  }

  /* ---------- CB prefix (and DDCB / FDCB) ---------- */
  execCB() {
    if (this.idx) {
      const d = sbyte(this.imm8());
      const op = this.imm8();   // read as data: no M1 cycle, R does not advance
      this.x(2);
      const a = (this.xy() + d) & 0xFFFF;
      this.wz = a;
      const v = this.rd(a);
      this.x(1);
      const k = op >> 6, n = (op >> 3) & 7, r = op & 7;
      if (k === 1) { this.bit(n, v, a >> 8); return; }
      const res = k === 0 ? this.rot(n, v) : k === 2 ? v & ~(1 << n) : v | (1 << n);
      this.wr(a, res & 0xFF);
      if (r !== 6) this.setR8(r, res, true);   // undocumented copy into the register
      return;
    }
    const op = this.fetchOp();
    const k = op >> 6, n = (op >> 3) & 7, r = op & 7;
    if (r === 6) {
      const a = this.hl, v = this.rd(a);
      this.x(1);
      if (k === 1) { this.bit(n, v, this.wz >> 8); return; }
      this.wr(a, (k === 0 ? this.rot(n, v) : k === 2 ? v & ~(1 << n) : v | (1 << n)) & 0xFF);
      return;
    }
    const v = this.getR8(r, true);
    if (k === 1) { this.bit(n, v, v); return; }
    this.setR8(r, k === 0 ? this.rot(n, v) : k === 2 ? v & ~(1 << n) : v | (1 << n), true);
  }

  /* ---------- ED prefix ---------- */
  execED(op) {
    if (op >= 0x40 && op < 0x80) {
      const y = (op >> 3) & 7, p = y >> 1;
      switch (op & 7) {
        case 0: {   // IN r,(C); y = 6: IN F,(C)
          const v = this.ioIn(this.bc);
          this.wz = (this.bc + 1) & 0xFFFF;
          this.f = (this.f & FC) | SZ53P[v];
          if (y !== 6) this.setR8(y, v, true);
          return;
        }
        case 1:     // OUT (C),r; y = 6: OUT (C),0 (NMOS)
          this.ioOut(this.bc, y === 6 ? 0 : this.getR8(y, true));
          this.wz = (this.bc + 1) & 0xFFFF;
          return;
        case 2:
          this.x(7);
          if (y & 1) this.adc16(p === 2 ? this.hl : this.getRP(p)); else this.sbc16(p === 2 ? this.hl : this.getRP(p));
          return;
        case 3: {
          const n = this.imm16();
          if (y & 1) this.setRP(p, this.rd(n) | (this.rd((n + 1) & 0xFFFF) << 8));
          else { const v = this.getRP(p); this.wr(n, v & 0xFF); this.wr((n + 1) & 0xFFFF, v >> 8); }
          this.wz = (n + 1) & 0xFFFF;
          return;
        }
        case 4: { const v = this.a; this.a = 0; this.sub8(v, 0); return; }               // NEG
        case 5: this.iff1 = this.iff2; this.pc = this.wz = this.pop(); return;           // RETN / RETI
        case 6: this.im = [0, 0, 1, 2][y & 3]; return;                                   // IM
        case 7:
          switch (y) {
            case 0: this.x(1); this.i = this.a; return;
            case 1: this.x(1); this.r = this.a; return;
            case 2: this.x(1); this.a = this.i; this.f = (this.f & FC) | SZ53[this.a] | (this.iff2 ? FPV : 0); this.ldair = true; return;
            case 3: this.x(1); this.a = this.r; this.f = (this.f & FC) | SZ53[this.a] | (this.iff2 ? FPV : 0); this.ldair = true; return;
            case 4: {   // RRD
              const v = this.rd(this.hl); this.x(4);
              this.wr(this.hl, ((this.a << 4) | (v >> 4)) & 0xFF);
              this.a = (this.a & 0xF0) | (v & 0x0F);
              this.f = (this.f & FC) | SZ53P[this.a]; this.wz = (this.hl + 1) & 0xFFFF;
              return;
            }
            case 5: {   // RLD
              const v = this.rd(this.hl); this.x(4);
              this.wr(this.hl, ((v << 4) | (this.a & 0x0F)) & 0xFF);
              this.a = (this.a & 0xF0) | (v >> 4);
              this.f = (this.f & FC) | SZ53P[this.a]; this.wz = (this.hl + 1) & 0xFFFF;
              return;
            }
            default: return;   // ED 77 / ED 7F: NOP
          }
      }
    }
    if (op >= 0xA0 && op <= 0xBB && (op & 7) < 4) {
      const dec = op & 8, rep = op & 0x10, step = dec ? -1 : 1;
      switch (op & 3) {
        case 0: {   // LDI / LDD / LDIR / LDDR
          const v = this.rd(this.hl);
          this.wr(this.de, v); this.x(2);
          this.hl = this.hl + step; this.de = this.de + step; this.bc = this.bc - 1;
          const n = (v + this.a) & 0xFF;
          this.f = (this.f & (FS | FZ | FC)) | (this.bc ? FPV : 0) | (n & FX) | ((n & 0x02) ? FY : 0);
          if (rep && this.bc) { this.x(5); this.pc = (this.pc - 2) & 0xFFFF; this.wz = (this.pc + 1) & 0xFFFF; }
          return;
        }
        case 1: {   // CPI / CPD / CPIR / CPDR
          const v = this.rd(this.hl); this.x(5);
          const r = (this.a - v) & 0xFF, h = (this.a ^ v ^ r) & FH;
          this.hl = this.hl + step; this.bc = this.bc - 1;
          this.wz = (this.wz + step) & 0xFFFF;
          const n = (r - (h ? 1 : 0)) & 0xFF;
          this.f = (this.f & FC) | FN | (SZ53[r] & (FS | FZ)) | h | (this.bc ? FPV : 0) | (n & FX) | ((n & 0x02) ? FY : 0);
          if (rep && this.bc && r) { this.x(5); this.pc = (this.pc - 2) & 0xFFFF; this.wz = (this.pc + 1) & 0xFFFF; }
          return;
        }
        case 2: {   // INI / IND / INIR / INDR
          this.x(1);
          const v = this.ioIn(this.bc);
          this.wz = (this.bc + step) & 0xFFFF;
          this.wr(this.hl, v);
          this.b = (this.b - 1) & 0xFF; this.hl = this.hl + step;
          const k = v + ((this.c + step) & 0xFF);
          this.f = SZ53[this.b] | (v & 0x80 ? FN : 0) | (k > 0xFF ? FH | FC : 0) | PAR[(k & 7) ^ this.b];
          if (rep && this.b) { this.x(5); this.pc = (this.pc - 2) & 0xFFFF; }
          return;
        }
        case 3: {   // OUTI / OUTD / OTIR / OTDR
          this.x(1);
          const v = this.rd(this.hl);
          this.b = (this.b - 1) & 0xFF;
          this.ioOut(this.bc, v);
          this.hl = this.hl + step;
          this.wz = (this.bc + step) & 0xFFFF;
          const k = v + this.l;
          this.f = SZ53[this.b] | (v & 0x80 ? FN : 0) | (k > 0xFF ? FH | FC : 0) | PAR[(k & 7) ^ this.b];
          if (rep && this.b) { this.x(5); this.pc = (this.pc - 2) & 0xFFFF; }
          return;
        }
      }
    }
    // other ED opcodes: 8 T NOP
  }
}
