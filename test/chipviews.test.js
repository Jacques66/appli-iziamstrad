// Detailed chip views: rendering of every chip on both boards, real values, and no state change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CPC6128 } from '../src/machines/cpc6128.js';
import { MinimalMachine } from '../src/machines/minimal.js';
import { blankDisk } from '../src/machines/cpc/dsk.js';
import { CPC_BOARD, MIN_BOARD } from '../app/boards.js';
import { hasChipView, renderChipView } from '../app/chipviews.js';

const rom = name => new Uint8Array(readFileSync(new URL('../roms/' + name, import.meta.url)));
const sys = rom('cpc6128.rom');
const ROMS = { os: sys.subarray(0, 0x4000), basic: sys.subarray(0x4000), amsdos: rom('amsdos.rom') };

let cpc = null;
function bootCPC() {
  if (cpc) return cpc;
  const m = new CPC6128(ROMS);
  m.fdc.insert(0, blankDisk('data'));
  for (let i = 0; i < 150; i++) m.runFrame();
  cpc = m;
  return m;
}

function sum(a) { let s = 0; for (let i = 0; i < a.length; i++) s = (s * 31 + a[i]) >>> 0; return s; }

// fingerprint of the whole observable machine state
function snapshotCPC(m) {
  const f = m.fdc;
  return JSON.stringify({
    cycles: m.cpu.cycles, regs: m.cpu.getRegs(), ram: sum(m.ram), bank: m.bank, romSelect: m.romSelect, ppi: m.ppi, frames: m.frames, io: m.io.length,
    printer: m.printer.text, strobe: m.printer.strobe, keys: [...m.keyboard.matrix], queue: m.keyboard.queue.length,
    ga: { pen: m.ga.pen, inks: [...m.ga.inks], mode: m.ga.mode, pm: m.ga.pendingMode, lo: m.ga.lowerRom, up: m.ga.upperRom, rc: m.ga.ramConfig, ic: m.ga.intCounter, ir: m.ga.intRequest, vd: m.ga.vsyncDelay, bx: m.ga.beamX, by: m.ga.beamY },
    crtc: { regs: [...m.crtc.regs], sel: m.crtc.selected, hcc: m.crtc.hcc, vcc: m.crtc.vcc, vlc: m.crtc.vlc, rs: m.crtc.rowStart, hs: m.crtc.hsync, vs: m.crtc.vsync, adj: m.crtc.adjust, fr: m.crtc.frame },
    psg: { regs: [...m.psg.regs], sel: m.psg.selected, pend: m.psg.pending.length, env: [m.psg.envStep, m.psg.envAttack, m.psg.envHold], time: m.psg.time },
    fdc: { phase: f.phase, cmd: f.cmd, op: f.op, result: f.result, rp: f.resultPos, pending: f.pending, motor: f.motor, act: f.activity, drives: f.drives.map(d => [d.track, d.index, !!d.disk]), last: f.lastData, exec: f.exec && { pos: f.exec.pos } },
  });
}
function snapshotMin(m) {
  return JSON.stringify({ cycles: m.cpu.cycles, regs: m.cpu.getRegs(), rom: sum(m.rom), ram: sum(m.ram), leds: m.leds, sw: m.switches, io: m.io.length });
}

const STEPS = [
  null,
  { m: 'M2', mtype: 'MR', t: 2, addr: 0xC000, data: 0x80, pins: ['MREQ', 'RD'] },
  { m: 'M3', mtype: 'IOW', t: 2, addr: 0x7F00, data: 0x8D, pins: ['IORQ', 'WR'] },
];

const cpcIds = CPC_BOARD.chips.map(c => c.id), minIds = MIN_BOARD.chips.map(c => c.id);

test('hasChipView: every chip except the Z80', () => {
  for (const id of cpcIds) assert.equal(hasChipView('cpc', id), id !== 'z80', id);
  for (const id of minIds) assert.equal(hasChipView('min', id), id !== 'z80', id);
  assert.equal(hasChipView('cpc', 'unknown'), false);
  assert.equal(hasChipView('xyz', 'ga'), false);
  assert.equal(renderChipView('cpc', 'z80', bootCPC(), { step: null }), '');
});

test('CPC: every view renders without error and without changing the machine', () => {
  const m = bootCPC();
  for (const step of STEPS) {
    for (const id of cpcIds.filter(i => hasChipView('cpc', i))) {
      const before = snapshotCPC(m);
      const html = renderChipView('cpc', id, m, { step });
      assert.equal(snapshotCPC(m), before, `state changed by view ${id}`);
      assert.equal(typeof html, 'string');
      assert.ok(html.length > 200, `view ${id} too short`);
      assert.ok(!html.includes('cv-err'), `view ${id}: ${html.slice(0, 300)}`);
      assert.ok(!/undefined|NaN/.test(html), `view ${id} contains undefined/NaN`);
      assert.ok(!html.includes('<script'), id);
    }
  }
});

test('CPC: real values in the views', () => {
  const m = bootCPC(), v = id => renderChipView('cpc', id, m, { step: null });
  assert.equal(m.crtc.regs[0], 63);
  assert.match(v('crtc'), /<td>R0<\/td><td>Horizontal total<\/td><td class="cv-m">[^<]*<\/td><td class="cv-v">63 /);
  assert.ok(v('crtc').includes(`= <b>&amp;${m.crtc.videoAddress.toString(16).toUpperCase().padStart(4, '0')}</b>`));
  assert.ok(v('ga').includes(`${m.ga.intCounter} / 52 lines`));
  assert.ok(v('ga').includes('Bdr'));
  const pal = v('pal');
  for (let i = 0; i < 8; i++) assert.ok(pal.includes(`<td>C${i}</td>`), 'C' + i);
  assert.match(pal, new RegExp(`<tr class="cv-sel"><td>C${m.ga.ramConfig & 7}</td>`));
  assert.ok(v('rom').includes('ROM BASIC'));
  assert.ok(v('amsdos').includes('ROM AMSDOS'));
  assert.ok(v('ppi').includes(`Control word &amp;${m.ppi.control.toString(16).toUpperCase().padStart(2, '0')}`));
  assert.ok(v('psg').includes('Voice A') && v('psg').includes('R13'));
  assert.ok(v('fdc').includes('Main status register MSR = &amp;80'));
  assert.ok(v('fdc').includes('Track 0 of drive A'));
  assert.ok(v('kdec').includes(`output ${m.ppi.c & 15}`));
  assert.ok(v('kbd').includes('SPACE'));
  assert.ok(v('ram0').includes('bank 0') && v('ram1').includes('bank 7'));
  assert.ok(v('ram0').includes('cv-scrimg'));
  assert.ok(v('xtal').includes('16.000 MHz'));
});

test('CPC: views during an access (MR &C000, IOW &7F00)', () => {
  const m = bootCPC();
  const mr = { step: STEPS[1] }, iow = { step: STEPS[2] };
  const upper = m.chipAt(0xC000);
  const romHtml = renderChipView('cpc', upper === 'ROM AMSDOS' ? 'amsdos' : upper === 'ROM BASIC' ? 'rom' : 'ram0', m, mr);
  assert.ok(romHtml.includes('cv-live'), '&C000 access highlighted');
  assert.ok(romHtml.includes('&amp;C000'));
  const ga = renderChipView('cpc', 'ga', m, iow);
  assert.ok(ga.includes('cv-live') && ga.includes('OUT &amp;7F00, &amp;8D') && ga.includes('function 2: mode 1'));
  assert.ok(renderChipView('cpc', 'pal', m, mr).includes('quarter 3'));
  assert.ok(renderChipView('cpc', 'ram0', m, mr).includes('bank'));
  // CRTC write: register select
  const crtc = renderChipView('cpc', 'crtc', m, { step: { m: 'M3', mtype: 'IOW', t: 2, addr: 0xBC00, data: 12, pins: ['IORQ', 'WR'] } });
  assert.ok(crtc.includes('select register R12'));
  // FDC MSR read
  const fdc = renderChipView('cpc', 'fdc', m, { step: { m: 'M3', mtype: 'IOR', t: 2, addr: 0xFB7E, data: 0x80, pins: ['IORQ', 'RD'] } });
  assert.ok(fdc.includes('read main status register'));
});

test('CPC: FDC during a command, and the sector map', () => {
  const m = bootCPC();
  // view of a separate machine: a READ ID command is sent through the real ports
  const n = new CPC6128(ROMS);
  n.fdc.insert(0, blankDisk('data'));
  n.out(0xFA7E, 1);
  n.out(0xFB7F, 0x4A); n.out(0xFB7F, 0x00);   // READ ID, drive A
  const html = renderChipView('cpc', 'fdc', n, { step: null });
  assert.ok(html.includes('READ ID'));
  assert.ok(html.includes('ST0 = '));
  assert.ok(html.includes('cv-sectors'));
  assert.ok(/<div class="cv-hot[^"]*"><b>C1<\/b>/.test(html), 'sector &C1 highlighted');
  assert.ok(m);
});

test('Minimal system: every view renders without changing the machine', () => {
  const m = new MinimalMachine();
  m.load([{ start: 0, bytes: [0x3E, 0x55, 0xD3, 0x00, 0xDB, 0x01, 0x32, 0x00, 0x80, 0x18, 0xF5] }]);
  m.switches = 0xA5;
  for (let i = 0; i < 40; i++) m.step();
  const steps = [null,
    { m: 'M1', mtype: 'M1', t: 2, addr: 0x0002, data: 0xD3, pins: ['M1', 'MREQ', 'RD'] },
    { m: 'M3', mtype: 'IOW', t: 2, addr: 0x5500, data: 0x55, pins: ['IORQ', 'WR'] },
    { m: 'M3', mtype: 'IOR', t: 2, addr: 0x0101, data: 0xA5, pins: ['IORQ', 'RD'] },
    { m: 'M4', mtype: 'MW', t: 2, addr: 0x8000, data: 0xA5, pins: ['MREQ', 'WR'] },
  ];
  for (const step of steps) {
    for (const id of minIds.filter(i => hasChipView('min', i))) {
      const before = snapshotMin(m);
      const html = renderChipView('min', id, m, { step });
      assert.equal(snapshotMin(m), before, `state changed by view ${id}`);
      assert.ok(html.length > 100 && !html.includes('cv-err') && !/undefined|NaN/.test(html), `view ${id}: ${html.slice(0, 300)}`);
    }
  }
  assert.ok(renderChipView('min', 'mdec', m, { step: steps[1] }).includes('output Y0 low'));
  assert.ok(renderChipView('min', 'mdec', m, { step: steps[4] }).includes('output Y4 low'));
  assert.ok(renderChipView('min', 'mout', m, { step: steps[2] }).includes('rising edge'));
  assert.ok(renderChipView('min', 'min', m, { step: steps[3] }).includes('&amp;A5'));
  assert.ok(renderChipView('min', 'mram', m, { step: steps[4] }).includes('byte written to the SRAM'));
  assert.ok(renderChipView('min', 'mrom', m, { step: steps[1] }).includes('3E 55 <span class="cv-hx-on">D3</span>'));
  assert.ok(renderChipView('min', 'leds', m, null).includes('&amp;55'));
});
