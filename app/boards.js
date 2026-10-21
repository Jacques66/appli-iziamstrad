import { hex } from './util.js';

/* Board definitions: chips, wires, role and state of each chip,
   and live activity for a given T-state. */

const r16 = (r, a, b) => hex((r[a] << 8) | r[b], 4);
const bin8 = v => v.toString(2).padStart(8, '0');

/* ---------------------------------------------------------------------
   Minimal system
   --------------------------------------------------------------------- */
export const MIN_BOARD = {
  title: 'Minimal Z80 system <span>(click a chip or a wire · double-click to look inside a chip)</span>',
  viewBox: '0 0 1200 690',
  buses: { A: 300, D: 318, C: 336 }, busX: [200, 1000],
  chips: [
    { id: 'osc', x: 40, y: 60, w: 120, h: 60, name: 'Oscillator', sub: '4 MHz', ref: 'X1' },
    { id: 'rst', x: 40, y: 160, w: 120, h: 60, name: 'Reset', sub: 'RC + button', ref: 'R1 C1' },
    { id: 'z80', x: 220, y: 40, w: 160, h: 200, name: 'Z80A', sub: 'CPU · 4 MHz', ref: 'U1', bus: { A: 250, D: 300, C: 350 } },
    { id: 'mrom', x: 460, y: 80, w: 140, h: 100, name: 'EPROM 2764', sub: '8 KB · &0000–&1FFF', ref: 'U2', bus: { A: 490, D: 530, C: 570 } },
    { id: 'mram', x: 640, y: 80, w: 140, h: 100, name: 'SRAM 6264', sub: '8 KB · &8000–&9FFF', ref: 'U3', bus: { A: 670, D: 710, C: 750 } },
    { id: 'mdec', x: 820, y: 80, w: 140, h: 100, name: '74LS138', sub: 'address decoder', ref: 'U4', bus: { A: 850, C: 930 } },
    { id: 'mout', x: 460, y: 400, w: 140, h: 90, name: '74LS374', sub: 'output port &00', ref: 'U5', bus: { D: 530, C: 570 } },
    { id: 'min', x: 640, y: 400, w: 140, h: 90, name: '74LS244', sub: 'input port &01', ref: 'U6', bus: { D: 710, C: 750 } },
    { id: 'leds', x: 460, y: 550, w: 140, h: 60, name: '8 LEDs', sub: 'display', ext: true },
    { id: 'sw', x: 640, y: 550, w: 140, h: 60, name: '8 switches', sub: 'input', ext: true },
  ],
  wires: [
    { id: 'abus', sig: ['A'], kind: 'addr', w: 5, label: 'Address bus A0–A15', d: 'M200,300 H1000' },
    { id: 'dbus', sig: ['D'], kind: 'data', w: 5, label: 'Data bus D0–D7', d: 'M200,318 H1000' },
    { id: 'cbus', sig: ['MREQ', 'IORQ', 'RD', 'WR'], kind: 'ctrl', w: 4, label: 'Control bus /MREQ /IORQ /RD /WR', d: 'M200,336 H1000' },
    { id: 'clk4', sig: ['CLK'], kind: 'clk', label: '4 MHz clock', d: 'M160,90 H220' },
    { id: 'reset', sig: ['RESET'], kind: 'ctrl', label: '/RESET', d: 'M160,190 H220' },
    { id: 'csrom', sig: ['CSROM'], kind: 'ctrl', label: '/CS EPROM (74LS138 output Y0)', d: 'M890,80 V50 H530 V80' },
    { id: 'csram', sig: ['CSRAM'], kind: 'ctrl', label: '/CS SRAM (74LS138 output Y4)', d: 'M870,80 V62 H710 V80' },
    { id: 'csout', sig: ['CSOUT'], kind: 'ctrl', label: 'Output latch clock (port &00)', d: 'M945,180 V385 H585 V400' },
    { id: 'csin', sig: ['CSIN'], kind: 'ctrl', label: 'Input buffer enable (port &01)', d: 'M915,180 V375 H765 V400' },
    { id: 'ledw', sig: ['LED'], kind: 'data', label: 'Outputs Q0–Q7 → LEDs', d: 'M530,490 V550' },
    { id: 'sww', sig: ['SW'], kind: 'data', label: 'Switches → inputs', d: 'M710,550 V490' },
  ],
  info: {
    z80: { role: 'NMOS 8-bit processor: runs the program from the EPROM, drives the address (16-bit), data (8-bit) and control buses.', sigs: ['CLK', 'M1', 'MREQ', 'IORQ', 'RD', 'WR', 'RFSH', 'INT', 'HALT', 'A', 'D'], cpu: true },
    osc: { role: '4 MHz crystal oscillator: direct clock of the Z80A (250 ns period).', sigs: ['CLK'] },
    rst: { role: 'RC circuit that holds /RESET low at power-on; manual reset button.', sigs: ['RESET'] },
    mrom: { role: '8 KB EPROM: holds the assembled program. The Z80 starts at &0000 after a reset. Writes are ignored.', sigs: ['A', 'D', 'CSROM', 'RD'],
      blocks: [['Row decoder', 'A0–A12 → 1 byte out of 8192', ''], ['EPROM array', '65,536 cells', ''], ['Output buffers', 'enabled when /CS and /OE are low', '']] },
    mram: { role: '8 KB static RAM: program variables and stack.', sigs: ['A', 'D', 'CSRAM', 'RD', 'WR'],
      blocks: [['Row decoder', 'A0–A12', ''], ['SRAM array', '6-transistor flip-flops', ''], ['Tri-state I/O', 'read /OE · write /WE', '']] },
    mdec: { role: '3-to-8 decoder: A13–A15 select the memory chip (Y0 = EPROM, Y4 = SRAM) during /MREQ; with /IORQ and A0 it enables the ports.', sigs: ['A', 'MREQ', 'IORQ', 'CSROM', 'CSRAM', 'CSOUT', 'CSIN'] },
    mout: { role: '8-bit latch: OUT (&00),A stores the value and lights the matching LEDs.', sigs: ['D', 'CSOUT', 'LED'] },
    min: { role: 'Tri-state buffer: IN A,(&01) puts the switch states on the data bus.', sigs: ['D', 'CSIN', 'SW'] },
    leds: { role: '8 LEDs wired to the latch outputs.', sigs: ['LED'], ext: true },
    sw: { role: '8 switches wired to the buffer inputs; toggle them in the Machine tab.', sigs: ['SW'], ext: true },
  },
  regs(id, m) {
    const r = m.cpu.getRegs();
    switch (id) {
      case 'z80': return [['PC', hex(r.PC, 4)], ['SP', hex(r.SP, 4)], ['AF', r16(r, 'A', 'F')], ['HL', r16(r, 'H', 'L')], ['T-states', m.cpu.cycles.toLocaleString('en-US')]];
      case 'osc': return [['Frequency', '4.000 MHz'], ['Period', '250 ns']];
      case 'mrom': return [['Range', '&0000–&1FFF'], ['Programmed bytes', m.rom.reduce((n, v) => n + (v !== 0xFF), 0)], ['First byte', '&' + hex(m.rom[0])]];
      case 'mram': return [['Range', '&8000–&9FFF'], ['&8000', '&' + hex(m.ram[0])], ['&8001', '&' + hex(m.ram[1])]];
      case 'mdec': return [['Inputs', 'A13 A14 A15'], ['Y0', 'EPROM'], ['Y4', 'SRAM']];
      case 'mout': case 'leds': return [['Value', '&' + hex(m.leds)], ['Binary', bin8(m.leds)]];
      case 'min': case 'sw': return [['Switches', '&' + hex(m.switches)], ['Binary', bin8(m.switches)]];
      default: return [];
    }
  },
  activity(step, m, chips, wires) {
    const mem = step.pins.includes('MREQ') && !step.pins.includes('RFSH');
    if (mem && step.addr != null) {
      if (step.addr < 0x2000) { chips.add('mrom'); wires.add('csrom'); chips.add('mdec'); }
      else if (step.addr >= 0x8000 && step.addr < 0xA000) { chips.add('mram'); wires.add('csram'); chips.add('mdec'); }
    }
    if (step.pins.includes('IORQ') && step.addr != null) {
      chips.add('mdec');
      if (step.pins.includes('WR') && !(step.addr & 1)) { chips.add('mout'); chips.add('leds'); wires.add('csout'); wires.add('ledw'); }
      if (step.pins.includes('RD') && (step.addr & 1)) { chips.add('min'); chips.add('sw'); wires.add('csin'); wires.add('sww'); }
    }
  },
};

/* ---------------------------------------------------------------------
   Amstrad CPC 6128
   --------------------------------------------------------------------- */
export const CPC_BOARD = {
  title: 'Amstrad CPC 6128 — motherboard <span>(block diagram · click a chip or a wire · double-click to look inside)</span>',
  viewBox: '0 0 1200 690',
  buses: { A: 262, D: 280, C: 298 }, busX: [20, 1170],
  chips: [
    { id: 'xtal', x: 30, y: 40, w: 80, h: 44, name: 'Crystal', sub: '16 MHz', ref: 'X1' },
    { id: 'pal', x: 20, y: 150, w: 115, h: 70, name: 'PAL 40030', sub: '128 KB banking', ref: 'IC118', bus: { A: 100, D: 118 } },
    { id: 'ga', x: 150, y: 30, w: 190, h: 110, name: 'Gate Array', sub: '40010 · video, clocks', ref: 'IC103', bus: { D: 165, C: 185 } },
    { id: 'z80', x: 400, y: 30, w: 150, h: 190, name: 'Z80A', sub: 'CPU · 4 MHz', ref: 'IC101', bus: { A: 430, D: 475, C: 520 } },
    { id: 'rom', x: 600, y: 110, w: 120, h: 110, name: 'ROM 32 KB', sub: 'OS + BASIC 1.1', ref: 'IC102', bus: { A: 625, D: 660, C: 695 } },
    { id: 'amsdos', x: 735, y: 110, w: 110, h: 110, name: 'ROM 16 KB', sub: 'AMSDOS', ref: 'IC117', bus: { A: 755, D: 790, C: 825 } },
    { id: 'ram0', x: 860, y: 110, w: 140, h: 110, name: 'DRAM 64 KB', sub: 'banks 0–3 · 8×4164', ref: 'IC104–111', bus: { A: 890, D: 930, C: 970 } },
    { id: 'ram1', x: 1015, y: 110, w: 140, h: 110, name: 'DRAM 64 KB', sub: 'banks 4–7 · 8×4164', ref: 'IC119–126', bus: { A: 1045, D: 1085, C: 1125 } },
    { id: 'mon', x: 860, y: 20, w: 295, h: 60, name: 'Color monitor', sub: 'RGB + sync · CTM644', ext: true },
    { id: 'crtc', x: 150, y: 340, w: 190, h: 90, name: 'CRTC', sub: 'HD6845S · video timing', ref: 'IC105', bus: { A: 265, D: 295, C: 325 } },
    { id: 'ppi', x: 400, y: 340, w: 150, h: 90, name: 'PPI', sub: '8255 · parallel I/O', ref: 'IC114', bus: { A: 430, D: 475, C: 520 } },
    { id: 'psg', x: 600, y: 340, w: 150, h: 90, name: 'PSG', sub: 'AY-3-8912 · sound', ref: 'IC115' },
    { id: 'fdc', x: 790, y: 340, w: 150, h: 90, name: 'FDC', sub: 'µPD765A · floppy disks', ref: 'IC201', bus: { A: 815, D: 845, C: 905 } },
    { id: 'prn', x: 980, y: 340, w: 150, h: 90, name: 'Printer port', sub: '74LS273 · Centronics', ref: 'IC116', bus: { A: 1005, D: 1035, C: 1100 } },
    { id: 'kbd', x: 150, y: 500, w: 190, h: 60, name: 'Keyboard', sub: '10 × 8 matrix', ext: true },
    { id: 'kdec', x: 400, y: 500, w: 150, h: 60, name: 'Keyboard decoder', sub: '74LS145', ref: 'IC113' },
    { id: 'amp', x: 600, y: 500, w: 150, h: 60, name: 'Audio amp', sub: 'A+B+C mixer', ref: 'IC120' },
    { id: 'drive', x: 790, y: 500, w: 150, h: 60, name: '3" drive', sub: 'A: and B:', ext: true },
    { id: 'printer', x: 980, y: 500, w: 150, h: 60, name: 'Printer', sub: 'virtual', ext: true },
    { id: 'spk', x: 600, y: 610, w: 150, h: 50, name: 'Speaker', sub: 'internal', ext: true },
  ],
  wires: [
    { id: 'abus', sig: ['A'], kind: 'addr', w: 5, label: 'Address bus A0–A15', d: 'M20,262 H1170' },
    { id: 'dbus', sig: ['D'], kind: 'data', w: 5, label: 'Data bus D0–D7', d: 'M20,280 H1170' },
    { id: 'cbus', sig: ['M1', 'MREQ', 'IORQ', 'RD', 'WR'], kind: 'ctrl', w: 4, label: 'Control bus /M1 /MREQ /IORQ /RD /WR', d: 'M20,298 H1170' },
    { id: 'clk16', sig: ['CLK'], kind: 'clk', label: '16 MHz master clock', d: 'M110,62 H150' },
    { id: 'clk4', sig: ['CLK'], kind: 'clk', label: '4 MHz CPU clock (16 MHz ÷ 4)', d: 'M340,55 H400' },
    { id: 'int', sig: ['INT'], kind: 'ctrl', label: '/INT — 300 Hz (every 52 lines)', d: 'M340,85 H400' },
    { id: 'wait', sig: ['WAIT'], kind: 'ctrl', label: '/WAIT — RAM shared with video', d: 'M340,115 H400' },
    { id: 'ras', sig: ['MREQ'], kind: 'ctrl', label: '/RAS /CAS — DRAM control', d: 'M300,30 V6 H1185 V165 H1155' },
    { id: 'rgb', sig: ['HSYNC', 'VSYNC'], kind: 'video', label: 'RGB output + composite sync', d: 'M220,30 V14 H1007 V20' },
    { id: 'ma', sig: ['A'], kind: 'addr', label: 'MA0–MA13 / RA0–RA4 — video address', d: 'M205,340 V140' },
    { id: 'sync', sig: ['HSYNC', 'VSYNC'], kind: 'video', label: 'HSYNC / VSYNC / DISPEN', d: 'M235,340 V140' },
    { id: 'ppipsg', sig: ['D'], kind: 'data', label: 'PPI port A ↔ PSG data bus', d: 'M550,365 H600' },
    { id: 'bdir', sig: ['IORQ'], kind: 'ctrl', label: 'BDIR / BC1 — PSG control (PPI port C)', d: 'M550,400 H600' },
    { id: 'krow', sig: ['IORQ'], kind: 'ctrl', label: 'Keyboard row number (PPI PC0–PC3)', d: 'M475,430 V500' },
    { id: 'krows', sig: ['IORQ'], kind: 'ctrl', label: 'Keyboard rows 0–9 (only one low)', d: 'M400,530 H340' },
    { id: 'kcol', sig: ['D'], kind: 'data', label: 'Keyboard columns → PSG port A', d: 'M245,560 V590 H580 V445 H640 V430' },
    { id: 'audio', sig: [], kind: 'analog', label: 'Audio channels A / B / C', d: 'M690,430 V500' },
    { id: 'spkw', sig: [], kind: 'analog', label: 'Speaker output', d: 'M675,560 V610' },
    { id: 'fdd', sig: [], kind: 'ctrl', label: 'Drive: STEP DIR RDATA WDATA INDEX', d: 'M865,430 V500' },
    { id: 'cent', sig: [], kind: 'data', label: 'Centronics D0–D6 · /STROBE · BUSY', d: 'M1055,430 V500' },
  ],
  info: {
    z80: { role: 'NMOS 8-bit processor: runs the firmware, BASIC and your programs; drives the address, data and control buses.', sigs: ['CLK', 'M1', 'MREQ', 'IORQ', 'RD', 'WR', 'RFSH', 'WAIT', 'INT', 'A', 'D'], cpu: true },
    xtal: { role: 'Crystal oscillator: master clock of the whole machine.', sigs: ['CLK'] },
    ga: { role: 'Amstrad custom chip: divides the 16 MHz (4 MHz CPU, 1 MHz CRTC and PSG), reads video RAM, turns pixels into colors through the palette, generates /INT (300 Hz) and wait states.', sigs: ['CLK', 'INT', 'WAIT', 'HSYNC', 'VSYNC'],
      blocks: [['Clock divider', '16 MHz → 4 MHz, 1 MHz', ''], ['RAM arbitration', 'CPU ↔ video, /WAIT', ''], ['Pixel serializer', 'byte → 2, 4 or 8 pixels', ''], ['Palette', '17 inks out of 27 colors', ''], ['Interrupt counter', '52 lines → /INT', ''], ['ROM selection', 'lower &0000 · upper &C000', '']] },
    pal: { role: 'Programmable logic that maps the 16 KB banks of the expansion RAM (the extra 64 KB of the 6128) into the Z80 address space.', sigs: ['A', 'D'] },
    rom: { role: 'Internal ROM: operating system (firmware, &BBxx vectors) in the lower ROM, and Locomotive BASIC 1.1 in upper ROM 0.', sigs: ['A', 'D', 'RD'] },
    amsdos: { role: 'AMSDOS expansion ROM (upper ROM 7): disk commands CAT, LOAD, SAVE, |A, |B and the FDC driver.', sigs: ['A', 'D', 'RD'] },
    ram0: { role: 'Banks 0 to 3 (64 KB): the base memory. Video always reads its 16 KB screen from here (&C000 by default).', sigs: ['A', 'D', 'MREQ', 'RD', 'WR'] },
    ram1: { role: 'Banks 4 to 7 (64 KB expansion), reachable through 16 KB windows depending on the PAL configuration.', sigs: ['A', 'D', 'MREQ'] },
    crtc: { role: 'Cathode-ray tube controller: generates the video address counters and the horizontal (64 µs) and vertical (20 ms) syncs.', sigs: ['HSYNC', 'VSYNC'],
      blocks: [['Horizontal counter', 'R0: characters per line', ''], ['Raster line counter', 'R9: lines per character', ''], ['Row counter', 'R4: rows per frame', ''], ['MA generator', '14-bit video address', ''], ['Sync generator', 'R2/R3 horizontal, R7 vertical', ''], ['Registers R0–R17', 'ports &BCxx / &BDxx', '']] },
    ppi: { role: '8255 parallel interface: port A ↔ PSG, port B ← VSYNC, printer BUSY, links; port C → keyboard row, cassette motor, PSG control.', sigs: ['IORQ', 'RD', 'WR', 'VSYNC'] },
    psg: { role: 'AY-3-8912 sound generator: 3 square-wave voices, noise, envelope. Its port A also reads the keyboard columns.', sigs: [],
      blocks: [['Tones A, B, C', 'R0–R5: 12-bit periods', ''], ['Noise', 'R6: 17-bit LFSR', ''], ['Mixer', 'R7', ''], ['Volumes', 'R8–R10', ''], ['Envelope', 'R11–R13: 16 shapes', ''], ['Port A', 'R14: keyboard columns', '']] },
    fdc: { role: 'NEC µPD765A floppy disk controller: track seek, sector read and write. .DSK images are mounted in the virtual drives.', sigs: ['IORQ', 'RD', 'WR'] },
    prn: { role: '74LS273 latch on port &EFxx: 7 data bits + /STROBE to the Centronics connector.', sigs: ['IORQ', 'WR', 'D'] },
    kdec: { role: 'BCD → 10-output decoder: enables a single keyboard matrix row at a time.', sigs: [] },
    amp: { role: 'Mixes the three PSG voices to the internal speaker and the stereo headphone socket.', sigs: [] },
    mon: { role: 'Monitor: receives R, G, B (3 levels each) and sync. Shown in the Machine tab.', sigs: ['HSYNC', 'VSYNC'], ext: true },
    kbd: { role: '80-key matrix (10 rows × 8 columns). The virtual keyboard is in the Machine tab.', sigs: [], ext: true },
    drive: { role: 'Virtual 3-inch drives: .DSK disk images.', sigs: [], ext: true },
    printer: { role: 'Virtual printer: output is shown on listing paper in the Machine tab.', sigs: [], ext: true },
    spk: { role: 'Speaker: sound is played through the PC sound card.', sigs: [], ext: true },
  },
  regs(id, m) {
    const r = m.cpu.getRegs(), ga = m.ga, c = m.crtc;
    switch (id) {
      case 'z80': return [['PC', hex(r.PC, 4)], ['SP', hex(r.SP, 4)], ['AF', r16(r, 'A', 'F')], ['HL', r16(r, 'H', 'L')], ['IM / IFF1', `${r.IM} / ${r.IFF1}`]];
      case 'xtal': return [['Frequency', '16.000 MHz']];
      case 'ga': return [['Screen mode', `${ga.mode} (${[160, 320, 640][ga.mode]}×200)`], ['Border (hardware)', ga.inks[16]], ['Inks 0–3', [...ga.inks.slice(0, 4)].join(' ')], ['Lower / upper ROM', `${ga.lowerRom ? 'on' : 'off'} / ${ga.upperRom ? 'on' : 'off'}`], ['Line counter', `${ga.intCounter} / 52`]];
      case 'pal': return [['Configuration', 'C' + (ga.ramConfig & 7)], ['Banks', m.bank.map(b => b >> 14).join(' ')]];
      case 'rom': return [['Selected upper ROM', m.romSelect], ['Lower ROM', ga.lowerRom ? 'visible' : 'hidden'], ['Upper ROM', ga.upperRom ? 'visible' : 'hidden']];
      case 'amsdos': return [['Selected', m.romSelect === 7 ? 'yes' : 'no']];
      case 'ram0': return [['Screen', '&' + hex(((c.regs[12] & 0x30) << 10), 4)], ['Configuration', 'C' + (ga.ramConfig & 7)]];
      case 'ram1': return [['Windows', m.bank.map(b => b >> 14).filter(b => b > 3).join(' ') || 'none']];
      case 'crtc': return [['R0 H total', c.regs[0]], ['R1 H displayed', c.regs[1]], ['R2 H sync', c.regs[2]], ['R4 V total', c.regs[4]], ['R6 V displayed', c.regs[6]], ['R7 V sync', c.regs[7]], ['R9 lines/char', c.regs[9]], ['R12–13 start', '&' + r16(c.regs, 12, 13)], ['Scan', `char ${c.hcc}, row ${c.vcc}, line ${c.vlc}`]];
      case 'ppi': return [['Port A', '&' + hex(m.ppi.a)], ['Port C', '&' + hex(m.ppi.c)], ['Control', '&' + hex(m.ppi.control)], ['Keyboard row', m.ppi.c & 0x0F]];
      case 'psg': return [...m.psg.regs.slice(0, 14)].map((v, i) => ['R' + i, '&' + hex(v)]);
      case 'fdc': { const a = m.fdc.activity || {}; return [['Motor', a.motor ? 'on' : 'off'], ['Phase', a.phase || '—'], ['Command', a.command || '—'], ['Tracks A / B', (a.track || [0, 0]).join(' / ')]]; }
      case 'prn': return [['Characters received', m.printer.text.length]];
      default: return [];
    }
  },
  activity(step, m, chips, wires) {
    const mem = step.pins.includes('MREQ') && !step.pins.includes('RFSH');
    if (mem && step.addr != null) {
      const chip = m.chipAt(step.addr);
      if (chip === 'ROM OS' || chip === 'ROM BASIC') chips.add('rom');
      else if (chip === 'ROM AMSDOS') chips.add('amsdos');
      else { chips.add(+chip.slice(4) > 3 ? 'ram1' : 'ram0'); chips.add('pal'); wires.add('ras'); }
    }
    if (step.pins.includes('WAIT')) { chips.add('ga'); wires.add('wait'); }
    if (step.pins.includes('IORQ') && step.addr != null) {
      const p = step.addr;
      if ((p & 0xC000) === 0x4000) chips.add('ga');
      if (!(p & 0x4000)) chips.add('crtc');
      if (!(p & 0x0800)) { chips.add('ppi'); chips.add('psg'); wires.add('ppipsg'); wires.add('bdir'); }
      if (!(p & 0x0480)) { chips.add('fdc'); wires.add('fdd'); }
      if (!(p & 0x1000) && step.pins.includes('WR')) { chips.add('prn'); wires.add('cent'); }
      if (!(p & 0x2000) && step.pins.includes('WR')) chips.add('rom');
    }
  },
};
