/* Système Z80 minimal : oscillateur 4 MHz, EPROM 2764 (8 Ko, &0000–&1FFF),
   SRAM 6264 (8 Ko, &8000–&9FFF) décodées par un 74LS138 sur A13–A15,
   port de sortie &00 (74LS374 → 8 LED) et port d'entrée &01 (74LS244 ← 8 interrupteurs).
   Les ports ne décodent que A0 et /IORQ, comme sur le schéma. */
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
    this.io = [];            // dernières opérations d'E/S { dir, port, value, t }
    this.cpu = new Z80(this);
    this.reset();
  }

  // Décodeur 74LS138 : Y0 = EPROM, Y4 = SRAM, le reste n'est pas câblé
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
    return 0xFF;               // bus flottant (résistances de tirage)
  }
  write(addr, v) {
    addr &= 0xFFFF;
    if (this.chipAt(addr) === 'ram') this.ram[addr - RAM_START] = v & 0xFF;
    // écriture en EPROM ou hors mémoire : ignorée
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

  // « Programme » l'EPROM et/ou la RAM avec une image mémoire (segments de l'assembleur)
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
