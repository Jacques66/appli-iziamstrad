// Vues détaillées des circuits : rendu de chaque circuit des deux cartes, valeurs réelles, et aucune modification de l'état.
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

// empreinte de tout l'état observable de la machine
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

test('hasChipView : tous les circuits sauf le Z80', () => {
  for (const id of cpcIds) assert.equal(hasChipView('cpc', id), id !== 'z80', id);
  for (const id of minIds) assert.equal(hasChipView('min', id), id !== 'z80', id);
  assert.equal(hasChipView('cpc', 'inconnu'), false);
  assert.equal(hasChipView('xyz', 'ga'), false);
  assert.equal(renderChipView('cpc', 'z80', bootCPC(), { step: null }), '');
});

test('CPC : chaque vue se rend sans erreur et sans modifier la machine', () => {
  const m = bootCPC();
  for (const step of STEPS) {
    for (const id of cpcIds.filter(i => hasChipView('cpc', i))) {
      const before = snapshotCPC(m);
      const html = renderChipView('cpc', id, m, { step });
      assert.equal(snapshotCPC(m), before, `état modifié par la vue ${id}`);
      assert.equal(typeof html, 'string');
      assert.ok(html.length > 200, `vue ${id} trop courte`);
      assert.ok(!html.includes('cv-err'), `vue ${id} : ${html.slice(0, 300)}`);
      assert.ok(!/undefined|NaN/.test(html), `vue ${id} contient undefined/NaN`);
      assert.ok(!html.includes('<script'), id);
    }
  }
});

test('CPC : valeurs réelles dans les vues', () => {
  const m = bootCPC(), v = id => renderChipView('cpc', id, m, { step: null });
  assert.equal(m.crtc.regs[0], 63);
  assert.match(v('crtc'), /<td>R0<\/td><td>Total horizontal<\/td><td class="cv-m">[^<]*<\/td><td class="cv-v">63 /);
  assert.ok(v('crtc').includes(`= <b>&amp;${m.crtc.videoAddress.toString(16).toUpperCase().padStart(4, '0')}</b>`));
  assert.ok(v('ga').includes(`${m.ga.intCounter} / 52 lignes`));
  assert.ok(v('ga').includes('Bord.'));
  const pal = v('pal');
  for (let i = 0; i < 8; i++) assert.ok(pal.includes(`<td>C${i}</td>`), 'C' + i);
  assert.match(pal, new RegExp(`<tr class="cv-sel"><td>C${m.ga.ramConfig & 7}</td>`));
  assert.ok(v('rom').includes('ROM BASIC'));
  assert.ok(v('amsdos').includes('ROM AMSDOS'));
  assert.ok(v('ppi').includes(`Mot de contrôle &amp;${m.ppi.control.toString(16).toUpperCase().padStart(2, '0')}`));
  assert.ok(v('psg').includes('Voix A') && v('psg').includes('R13'));
  assert.ok(v('fdc').includes("Registre d'état principal MSR = &amp;80"));
  assert.ok(v('fdc').includes('Piste 0 du lecteur A'));
  assert.ok(v('kdec').includes(`sortie ${m.ppi.c & 15}`));
  assert.ok(v('kbd').includes('ESPACE'));
  assert.ok(v('ram0').includes('banque 0') && v('ram1').includes('banque 7'));
  assert.ok(v('ram0').includes('cv-scrimg'));
  assert.ok(v('xtal').includes('16,000 MHz'));
});

test('CPC : vues pendant un accès (MR &C000, IOW &7F00)', () => {
  const m = bootCPC();
  const mr = { step: STEPS[1] }, iow = { step: STEPS[2] };
  const upper = m.chipAt(0xC000);
  const romHtml = renderChipView('cpc', upper === 'ROM AMSDOS' ? 'amsdos' : upper === 'ROM BASIC' ? 'rom' : 'ram0', m, mr);
  assert.ok(romHtml.includes('cv-live'), 'accès &C000 mis en évidence');
  assert.ok(romHtml.includes('&amp;C000'));
  const ga = renderChipView('cpc', 'ga', m, iow);
  assert.ok(ga.includes('cv-live') && ga.includes('OUT &amp;7F00, &amp;8D') && ga.includes('fonction 2 : mode 1'));
  assert.ok(renderChipView('cpc', 'pal', m, mr).includes('quart 3'));
  assert.ok(renderChipView('cpc', 'ram0', m, mr).includes('banque') );
  // écriture CRTC : sélection d'un registre
  const crtc = renderChipView('cpc', 'crtc', m, { step: { m: 'M3', mtype: 'IOW', t: 2, addr: 0xBC00, data: 12, pins: ['IORQ', 'WR'] } });
  assert.ok(crtc.includes('sélection du registre R12'));
  // lecture du MSR du FDC
  const fdc = renderChipView('cpc', 'fdc', m, { step: { m: 'M3', mtype: 'IOR', t: 2, addr: 0xFB7E, data: 0x80, pins: ['IORQ', 'RD'] } });
  assert.ok(fdc.includes("lecture du registre d'état principal"));
});

test('CPC : FDC en cours de commande et carte des secteurs', () => {
  const m = bootCPC();
  // la vue d'une machine séparée : on simule l'envoi d'une commande READ ID via les vrais ports
  const n = new CPC6128(ROMS);
  n.fdc.insert(0, blankDisk('data'));
  n.out(0xFA7E, 1);
  n.out(0xFB7F, 0x4A); n.out(0xFB7F, 0x00);   // READ ID, lecteur A
  const html = renderChipView('cpc', 'fdc', n, { step: null });
  assert.ok(html.includes('READ ID'));
  assert.ok(html.includes('ST0 = '));
  assert.ok(html.includes('cv-sectors'));
  assert.ok(/<div class="cv-hot[^"]*"><b>C1<\/b>/.test(html), 'secteur &C1 surligné');
  assert.ok(m);
});

test('Système minimal : chaque vue se rend sans modifier la machine', () => {
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
      assert.equal(snapshotMin(m), before, `état modifié par la vue ${id}`);
      assert.ok(html.length > 100 && !html.includes('cv-err') && !/undefined|NaN/.test(html), `vue ${id} : ${html.slice(0, 300)}`);
    }
  }
  assert.ok(renderChipView('min', 'mdec', m, { step: steps[1] }).includes('sortie Y0 à 0'));
  assert.ok(renderChipView('min', 'mdec', m, { step: steps[4] }).includes('sortie Y4 à 0'));
  assert.ok(renderChipView('min', 'mout', m, { step: steps[2] }).includes('front montant'));
  assert.ok(renderChipView('min', 'min', m, { step: steps[3] }).includes('&amp;A5'));
  assert.ok(renderChipView('min', 'mram', m, { step: steps[4] }).includes('octet écrit dans la SRAM'));
  assert.ok(renderChipView('min', 'mrom', m, { step: steps[1] }).includes('3E 55 <span class="cv-hx-on">D3</span>'));
  assert.ok(renderChipView('min', 'leds', m, null).includes('&amp;55'));
});
