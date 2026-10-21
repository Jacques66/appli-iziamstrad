/* Amstrad CPC 6128: Z80A at 4 MHz, Gate Array 40010, PAL 40030 (128 KB), CRTC 6845,
   PPI 8255, PSG AY-3-8912, FDC µPD765A, 74LS273 printer port.
   The ROMs (OS 6128, BASIC 1.1, AMSDOS) are passed to the constructor. */
import { Z80 } from '../z80/cpu.js';
import { CRTC6845 } from './cpc/crtc.js';
import { GateArray } from './cpc/gatearray.js';
import { Keyboard } from './cpc/keyboard.js';
import { AY38912 } from './cpc/psg.js';
import { FDC765 } from './cpc/fdc.js';
import { NATIONAL, buildKeymap } from './cpc/keymap.js';

// PAL RAM configurations: 16 KB bank placed in each quarter of the address space
const RAM_CONFIG = [[0, 1, 2, 3], [0, 1, 2, 7], [4, 5, 6, 7], [0, 3, 2, 7], [0, 4, 2, 3], [0, 5, 2, 3], [0, 6, 2, 3], [0, 7, 2, 3]];
export const FRAME_T = 312 * 64 * 4;   // T-states per frame (19,968 µs)

export class CPC6128 {
  constructor({ os, basic, amsdos, lang = 'uk' }) {
    this.name = lang === 'fr' ? 'Amstrad CPC 6128 (French)' : 'Amstrad CPC 6128';
    this.os = os; this.basic = basic; this.amsdos = amsdos;
    this.lang = lang;
    this.charset = NATIONAL[lang];
    this.keymap = buildKeymap(os, this.charset);
    this.ram = new Uint8Array(0x20000);
    this.crtc = new CRTC6845();
    this.ga = new GateArray(this.crtc);
    this.keyboard = new Keyboard();
    this.keyboard.charKeys = this.keymap.charKeys;
    this.psg = new AY38912();
    this.fdc = new FDC765();
    this.cpu = new Z80(this);
    this.ppi = { a: 0, b: 0, c: 0, control: 0x9B };
    this.psg.portAInput = () => this.keyboard.readLine(this.ppi.c & 0x0F);
    this.printer = { text: '', strobe: 0, onChar: null };
    this.io = [];
    this.frames = 0;
    this.onFrame = null;
    this.ga.onFrame = () => { this.frames++; this.keyboard.frame(); this.onFrame?.(); };
    this.reset();
  }

  reset() {
    this.cpu.reset();
    this.crtc.reset();
    this.ga.reset();
    this.psg.reset();
    this.fdc.reset();
    this.keyboard.reset();
    this.ram.fill(0);
    this.ppi = { a: 0, b: 0, c: 0, control: 0x9B };
    this.romSelect = 0;
    this.io.length = 0;
    this.updateMap();
  }

  updateMap() {
    this.bank = RAM_CONFIG[this.ga.ramConfig & 7].map(b => b * 0x4000);
  }
  get upperRomData() { return this.romSelect === 7 ? this.amsdos : this.basic; }

  /* ---------- Memory bus ---------- */
  read(a) {
    const blk = a >> 14;
    if (blk === 0 && this.ga.lowerRom) return this.os[a];
    if (blk === 3 && this.ga.upperRom) return this.upperRomData[a & 0x3FFF];
    return this.ram[this.bank[blk] | (a & 0x3FFF)];
  }
  write(a, v) {
    this.ram[this.bank[a >> 14] | (a & 0x3FFF)] = v;   // writes always go to RAM
  }
  // name of the chip read at this address (memory view, board)
  chipAt(a) {
    const blk = a >> 14;
    if (blk === 0 && this.ga.lowerRom) return 'ROM OS';
    if (blk === 3 && this.ga.upperRom) return this.romSelect === 7 ? 'ROM AMSDOS' : 'ROM BASIC';
    return 'RAM ' + (this.bank[blk] >> 14);
  }

  /* ---------- I/O bus: partial decoding of the address lines ---------- */
  out(port, v) {
    this.logIO('out', port, v);
    if ((port & 0xC000) === 0x4000) { this.ga.write(v); if (v >> 6 === 3) this.updateMap(); }
    if (!(port & 0x4000)) {
      const f = (port >> 8) & 3;
      if (f === 0) this.crtc.select(v); else if (f === 1) this.crtc.write(v);
    }
    if (!(port & 0x2000)) this.romSelect = v;
    if (!(port & 0x1000)) this.printerWrite(v);
    if (!(port & 0x0800)) this.ppiWrite((port >> 8) & 3, v);
    if (!(port & 0x0480)) {
      if (!(port & 0x0100)) this.fdc.setMotor(v & 1);
      else if (port & 1) this.fdc.writeData(v);
    }
  }
  in(port) {
    let v = 0xFF;
    if (!(port & 0x4000) && ((port >> 8) & 3) === 3) v &= this.crtc.read();
    if (!(port & 0x0800)) v &= this.ppiRead((port >> 8) & 3);
    if (!(port & 0x0480) && (port & 0x0100)) v &= port & 1 ? this.fdc.readData() : this.fdc.readStatus();
    this.logIO('in', port, v);
    return v;
  }
  intAck() { this.ga.intAck(); }
  logIO(dir, port, value) {
    this.io.push({ dir, port: port & 0xFFFF, value: value & 0xFF, t: this.cpu.cycles });
    if (this.io.length > 64) this.io.shift();
  }

  /* ---------- PPI 8255 ---------- */
  ppiWrite(f, v) {
    const p = this.ppi;
    if (f === 0) p.a = v;
    else if (f === 2) p.c = v;
    else if (f === 3) {
      if (v & 0x80) { p.control = v; p.a = 0; p.b = 0; p.c = 0; }
      else { const bit = (v >> 1) & 7; p.c = v & 1 ? p.c | (1 << bit) : p.c & ~(1 << bit); }
    }
    if (f !== 1) this.psg.bus((p.c >> 7) & 1, (p.c >> 6) & 1, p.a, this.cpu.cycles);
  }
  ppiRead(f) {
    const p = this.ppi;
    switch (f) {
      case 0:
        if (p.control & 0x10) return this.psg.bus((p.c >> 7) & 1, (p.c >> 6) & 1, 0xFF, this.cpu.cycles) ?? 0xFF;
        return p.a;
      // port B: bit 0 VSYNC, bits 1–3 = 7 (Amstrad), bit 4 = 50 Hz, bit 5 /EXP, bit 6 printer BUSY, bit 7 tape
      case 1: return 0x3E | (this.crtc.vsync ? 1 : 0);
      case 2: return p.c;
      default: return 0xFF;
    }
  }

  /* ---------- Printer port (D0–D6 + /STROBE on bit 7) ---------- */
  printerWrite(v) {
    const s = v & 0x80;
    if (s && !this.printer.strobe) {
      const ch = v & 0x7F;
      this.printer.text += this.charset[ch] ?? String.fromCharCode(ch);
      this.printer.onChar?.(ch);
    }
    this.printer.strobe = s;
  }

  /* ---------- Execution ---------- */
  // one instruction; the Gate Array aligns each instruction on a multiple of 4 T-states (RAM shared with the video)
  step() {
    this.cpu.irq(this.ga.intRequest);
    const cpu = this.cpu, t = cpu.step(), tt = (t + 3) & ~3;
    if (tt !== t) {
      cpu.cycles += tt - t;
      if (cpu.trace) cpu.trace.push({ type: 'X', t: tt - t, wait: true });
    }
    const ram = this.ram, ga = this.ga, crtc = this.crtc;
    for (let n = tt >> 2; n > 0; n--) { ga.render(ram); crtc.tick(); }
    return tt;
  }
  runFrame() {
    const f = this.frames, start = this.cpu.cycles;
    while (this.frames === f && this.cpu.cycles - start < FRAME_T * 2) this.step();
  }

  // injects assembled code straight into RAM (base 64 KB)
  load(segments) {
    for (const s of segments) s.bytes.forEach((v, i) => { this.ram[(s.start + i) & 0xFFFF] = v; });
  }
  peek(a) { return this.read(a & 0xFFFF); }
  poke(a, v) { this.write(a & 0xFFFF, v & 0xFF); }
}
