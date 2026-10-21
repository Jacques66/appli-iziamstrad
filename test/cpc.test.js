// CPC 6128 integration tests with the real ROMs: boot, BASIC, assembled code, printer, disc.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CPC6128, FRAME_T } from '../src/machines/cpc6128.js';
import { screenText } from '../src/machines/cpc/screentext.js';
import { CHAR_KEYS } from '../src/machines/cpc/keyboard.js';
import { blankDisk } from '../src/machines/cpc/dsk.js';
import { assemble } from '../src/asm/assembler.js';

const rom = name => new Uint8Array(readFileSync(new URL('../roms/' + name, import.meta.url)));
const sys = rom('cpc6128.rom');
const ROMS = { os: sys.subarray(0, 0x4000), basic: sys.subarray(0x4000), amsdos: rom('amsdos.rom') };
const ROMS_FR = { os: rom('cpc6128fr-os.rom'), basic: rom('cpc6128fr-basic.rom'), amsdos: rom('amsdos.rom'), lang: 'fr' };

function boot(roms = ROMS) {
  const m = new CPC6128(roms);
  for (let i = 0; i < 150; i++) m.runFrame();
  return m;
}
// types a BASIC command and waits until typing and execution are finished
function type(m, text, extraFrames = 50) {
  m.keyboard.type(text);
  let n = 0;
  while (m.keyboard.typing && n++ < 5000) m.runFrame();
  for (let i = 0; i < extraFrames; i++) m.runFrame();
}

test('cold boot up to the BASIC 1.1 "Ready"', () => {
  const m = boot();
  const s = screenText(m);
  assert.ok(s.some(l => l.includes('Amstrad 128K Microcomputer  (v3)')), s.join('\n'));
  assert.ok(s.some(l => l.includes('BASIC 1.1')), s.join('\n'));
  assert.ok(s.includes('Ready'), s.join('\n'));
});

test('312-line frame at 50 Hz, 6 interrupts per frame', () => {
  const m = boot();
  let acks = 0;
  const ack = m.intAck.bind(m);
  m.intAck = () => { acks++; ack(); };
  const t0 = m.cpu.cycles;
  for (let i = 0; i < 50; i++) m.runFrame();
  const perFrame = (m.cpu.cycles - t0) / 50;
  assert.ok(Math.abs(perFrame - FRAME_T) < 8, `T per frame: ${perFrame}`);
  assert.equal(acks, 300);
});

test('BASIC computes and prints PRINT 6*7', () => {
  const m = boot();
  type(m, 'PRINT 6*7\r');
  const s = screenText(m);
  assert.ok(s.includes(' 42'), s.join('\n'));
});

test('assembled program: hello.asm via CALL &4000 (text, red border)', () => {
  const src = `TXT_OUTPUT EQU &BB5A
SCR_SET_BORDER EQU &BC38
        ORG &4000
start:  LD HL,message
loop:   LD A,(HL)
        OR A
        JR Z,border
        CALL TXT_OUTPUT
        INC HL
        JR loop
border: LD B,6
        LD C,B
        CALL SCR_SET_BORDER
        RET
message: DB "Hello Z80!",13,10,0`;
  const res = assemble(src);
  assert.ok(res.ok, JSON.stringify(res.errors));
  const m = boot();
  m.load(res.segments);
  type(m, 'CALL &4000\r', 60);
  const s = screenText(m);
  assert.ok(s.includes('Hello Z80!'), s.join('\n'));
  assert.equal(m.ga.inks[16], 0x0C);   // hardware color 12 = bright red (firmware 6)
});

test('printer: PRINT #8 sends the text to the Centronics port', () => {
  const m = boot();
  type(m, 'PRINT #8,"HELLO"\r', 80);
  assert.ok(m.printer.text.includes('HELLO'), JSON.stringify(m.printer.text));
});

test('disc: SAVE then CAT on a blank DATA-format disc', () => {
  const m = boot();
  m.fdc.insert(0, blankDisk('data'));
  type(m, '10 PRINT "Z80"\r');
  type(m, 'SAVE "TEST"\r', 200);
  type(m, 'CAT\r', 200);
  const s = screenText(m).join('\n');
  assert.match(s, /TEST\s*\.BAS/, s);
  assert.equal(m.fdc.disk(0).dirty, true);
});

test('keyboard tables read from the English ROM = CPC QWERTY layout', () => {
  const m = new CPC6128(ROMS);
  for (const [ch, k] of Object.entries(CHAR_KEYS)) {
    if (ch === '£' || ch === '\n' || ch === '\r') continue;
    assert.deepEqual(m.keyboard.charKeys[ch], k, `character ${JSON.stringify(ch)}`);
  }
});

test('French CPC 6128: AZERTY keyboard taken from the ROM', () => {
  const m = new CPC6128(ROMS_FR);
  const k = m.keyboard.charKeys;
  assert.deepEqual(k.a, ['Q', false]);      // A is where Q is
  assert.deepEqual(k.z, ['W', false]);
  assert.deepEqual(k.m, [':', false]);      // M is to the right of L
  assert.deepEqual(k['1'], ['1', true]);    // digits with SHIFT
  assert.deepEqual(k['é'], ['2', false]);
  assert.deepEqual(k['&'], ['1', false]);
});

test('French CPC 6128: boot and typing accented characters', () => {
  const m = boot(ROMS_FR);
  const s0 = screenText(m);
  assert.ok(s0.includes('Ready') || s0.includes('Prêt'), s0.join('\n'));
  type(m, 'print "été à l\'école ça où"\r');
  const s = screenText(m);
  assert.ok(s.includes('été à l\'école ça où'), s.join('\n'));
});

test('French CPC 6128: | (ù key, code &7C) runs an AMSDOS RSX command', () => {
  const m = boot(ROMS_FR);
  assert.deepEqual(m.keyboard.charKeys['|'], m.keyboard.charKeys['ù']);
  m.fdc.insert(0, blankDisk('data'));
  type(m, '|dir\r', 200);       // shown as "ùdir", run as |DIR by AMSDOS
  const s = screenText(m).join('\n');
  assert.match(s, /ùdir/, s);
  assert.doesNotMatch(s, /Syntax error|Unknown command/, s);
  assert.match(s, /Drive A: user\s+0/, s);
});

test('empty drive: AMSDOS shows "Drive A: disc missing"', () => {
  const m = boot();
  type(m, '|DIR\r', 200);
  const s = screenText(m).join('\n');
  assert.match(s, /Drive A: disc missing/, s);
  assert.match(s, /Retry, Ignore or Cancel\?/, s);
});

// Gate Array mode line by line over a whole frame
function modesPerLine(m) {
  const modes = new Array(312).fill(null), he = m.ga.hsyncEnd.bind(m.ga);
  m.ga.hsyncEnd = () => { he(); const c = m.crtc; modes[(c.vcc * (c.regs[9] + 1) + c.vlc) % 312] = m.ga.mode; };
  m.runFrame(); m.runFrame();
  m.ga.hsyncEnd = he;
  return modes;
}

test('split screen by interrupts: pasted BASIC loader, MODE 0 at the top, MODE 1 at the bottom', () => {
  const m = boot(ROMS_FR);
  const bas = readFileSync(new URL('../examples/split-screen.bas', import.meta.url), 'utf8');
  type(m, bas, 20);
  type(m, 'RUN\r', 500);
  const s = screenText(m).join('\n');
  assert.doesNotMatch(s, /Error in DATA|Syntax error/, s);
  const modes = modesPerLine(m);
  for (let l = 0; l < 80; l++) assert.equal(modes[l], 0, `line ${l} (bars) in mode 0`);
  for (let l = 104; l < 200; l++) assert.equal(modes[l], 1, `line ${l} (text) in mode 1`);
  type(m, 'CALL &8003\r', 20);
  assert.ok(modesPerLine(m).every(v => v === 1), 'CALL &8003 returns to mode 1 everywhere');
});

test('MODE 0 / MODE 2 in pure assembly: interrupt at &0038, VSYNC read on the PPI, exit with SPACE', () => {
  const m = boot(ROMS_FR);
  const res = assemble(readFileSync(new URL('../examples/mode0-mode2.asm', import.meta.url), 'utf8'));
  assert.ok(res.ok, JSON.stringify(res.errors));
  m.load(res.segments);
  const vect = [...m.ram.slice(0x38, 0x3B)];
  type(m, 'CALL &8000\r', 60);
  assert.deepEqual([...m.ram.slice(0x38, 0x3B)], [0xC3, res.symbols.ISR & 0xFF, res.symbols.ISR >> 8]);
  const modes = modesPerLine(m);
  for (let l = 0; l < 80; l++) assert.equal(modes[l], 0, `line ${l} (bars) in mode 0`);
  for (let l = 96; l < 200; l++) assert.equal(modes[l], 2, `line ${l} (text) in mode 2`);
  const keep = m.ga.mode; m.ga.mode = 2;
  assert.ok(screenText(m).some(l => l.startsWith('MODE 2: 640 x 200')), 'MODE 2 text drawn with the ROM font');
  m.ga.mode = keep;
  // music: PSG programmed directly (tones A and B, noise on C), changing notes
  assert.equal(m.psg.regs[7], 0x1C);
  assert.ok(m.psg.regs[8] > 0 && m.psg.regs[9] > 0, 'channels A and B audible');
  const per = () => m.psg.regs[0] | (m.psg.regs[1] << 8), seen = new Set([per()]);
  for (let i = 0; i < 100; i++) { m.runFrame(); seen.add(per()); }
  assert.ok([...seen].every(p => [119, 106, 95, 159, 142, 127].includes(p)) && seen.size >= 3, `notes played: ${[...seen]}`);
  m.keyboard.set('SPACE', true); for (let i = 0; i < 3; i++) m.runFrame(); m.keyboard.set('SPACE', false);
  assert.deepEqual([...m.psg.regs.slice(8, 11)], [0, 0, 0], 'silence on exit');
  type(m, 'MODE 1\rPRINT 3*14\r', 40);
  assert.deepEqual([...m.ram.slice(0x38, 0x3B)], vect, '&0038 given back to the firmware');
  assert.ok(screenText(m).includes(' 42'), 'back to BASIC');
});

test('paste right after a CTRL (Ctrl+V): the 1st character is not typed with CONTROL', () => {
  const m = boot(ROMS_FR);
  m.keyboard.set('CONTROL', true);
  for (let i = 0; i < 5; i++) m.runFrame();      // the firmware sees CONTROL pressed
  m.keyboard.matrix.fill(0xFF);                  // released when the paste starts
  m.keyboard.pause(6);
  type(m, '10 PRINT 1\r20 PRINT 2\r', 20);
  const lines = [];
  for (let a = 0x170; ;) { const len = m.ram[a] | (m.ram[a + 1] << 8); if (!len) break; lines.push(m.ram[a + 2] | (m.ram[a + 3] << 8)); a += len; }
  assert.deepEqual(lines, [10, 20]);
});
