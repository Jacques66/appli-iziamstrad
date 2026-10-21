/* Minimal Z80 system: 4 MHz oscillator, 2764 EPROM (8 KB, &0000–&1FFF),
   6264 SRAM (8 KB, &8000–&9FFF) decoded by a 74LS138 on A13–A15,
   output port &00 (74LS374 → 8 LEDs) and input port &01 (74LS244 ← 8 switches).
   The ports only decode A0 and /IORQ, as on the schematic. */
import { Z80 } from '../z80/cpu.js';

export const ROM_START = 0x0000, ROM_SIZE = 0x2000;
export const RAM_START = 0x8000, RAM_SIZE = 0x2000;

export class MinimalMachine {
  constructor() {
    this.name = 'Z80 minimal';
    this.rom = new Uint8Array(ROM_SIZE);
    this.ram = new Uint8Array(RAM_SIZE);
    this.leds = 0;
    this.switches = 0x00;
    this.io = [];            // latest I/O operations { dir, port, value, t }
    this.cpu = new Z80(this);
    this.reset();
  }

  // 74LS138 decoder: Y0 = EPROM, Y4 = SRAM, the rest is not wired
  chipAt(addr) {
    addr &= 0xFFFF;
    if (addr < ROM_START + ROM_SIZE) return 'rom';
    if (addr >= RAM_START && addr < RAM_START + RAM_SIZE) return 'ram';
    return null;
  }
  read(addr) {
    addr &= 0xFFFF;
    const c = this.chipAt(addr);
    if (c === 'rom') return this.rom[addr - ROM_START];
    if (c === 'ram') return this.ram[addr - RAM_START];
    return 0xFF;               // floating bus (pull-up resistors)
  }
  write(addr, v) {
    addr &= 0xFFFF;
    if (this.chipAt(addr) === 'ram') this.ram[addr - RAM_START] = v & 0xFF;
    // write to EPROM or outside memory: ignored
  }
  in(port) {
    const v = port & 1 ? this.switches : 0xFF;
    this.logIO('in', port, v);
    return v;
  }
  out(port, v) {
    if (!(port & 1)) this.leds = v & 0xFF;
    this.logIO('out', port, v);
  }
  logIO(dir, port, value) {
    this.io.push({ dir, port: port & 0xFFFF, value: value & 0xFF, t: this.cpu.cycles });
    if (this.io.length > 64) this.io.shift();
  }

  step() { return this.cpu.step(); }

  // 'Programs' the EPROM and/or the RAM with a memory image (assembler segments)
  load(segments) {
    this.rom.fill(0xFF);
    for (const s of segments) s.bytes.forEach((v, i) => {
      const a = (s.start + i) & 0xFFFF, c = this.chipAt(a);
      if (c === 'rom') this.rom[a - ROM_START] = v;
      else if (c === 'ram') this.ram[a - RAM_START] = v;
    });
  }
  reset() {
    this.cpu.reset();
    this.leds = 0;
    this.io.length = 0;
  }
  peek(addr) { return this.read(addr); }
  poke(addr, v) {
    addr &= 0xFFFF;
    const c = this.chipAt(addr);
    if (c === 'rom') this.rom[addr - ROM_START] = v & 0xFF;
    else if (c === 'ram') this.ram[addr - RAM_START] = v & 0xFF;
  }
}
