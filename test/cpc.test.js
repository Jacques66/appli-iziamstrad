// Tests d'intégration du CPC 6128 avec les vraies ROM : démarrage, BASIC, code assemblé, imprimante, disquette.
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
// tape une commande BASIC et attend que la frappe et son exécution soient terminées
function type(m, text, extraFrames = 50) {
  m.keyboard.type(text);
  let n = 0;
  while (m.keyboard.typing && n++ < 5000) m.runFrame();
  for (let i = 0; i < extraFrames; i++) m.runFrame();
}

test('démarrage à froid jusqu\'au « Ready » du BASIC 1.1', () => {
  const m = boot();
  const s = screenText(m);
  assert.ok(s.some(l => l.includes('Amstrad 128K Microcomputer  (v3)')), s.join('\n'));
  assert.ok(s.some(l => l.includes('BASIC 1.1')), s.join('\n'));
  assert.ok(s.includes('Ready'), s.join('\n'));
});

test('trame de 312 lignes à 50 Hz, 6 interruptions par trame', () => {
  const m = boot();
  let acks = 0;
  const ack = m.intAck.bind(m);
  m.intAck = () => { acks++; ack(); };
  const t0 = m.cpu.cycles;
  for (let i = 0; i < 50; i++) m.runFrame();
  const perFrame = (m.cpu.cycles - t0) / 50;
  assert.ok(Math.abs(perFrame - FRAME_T) < 8, `T par trame : ${perFrame}`);
  assert.equal(acks, 300);
});

test('le BASIC calcule et affiche PRINT 6*7', () => {
  const m = boot();
  type(m, 'PRINT 6*7\r');
  const s = screenText(m);
  assert.ok(s.includes(' 42'), s.join('\n'));
});

test('programme assemblé : bonjour.asm via CALL &4000 (texte, bordure rouge)', () => {
  const src = `TXT_OUTPUT EQU &BB5A
SCR_SET_BORDER EQU &BC38
        ORG &4000
start:  LD HL,message
boucle: LD A,(HL)
        OR A
        JR Z,bordure
        CALL TXT_OUTPUT
        INC HL
        JR boucle
bordure: LD B,6
        LD C,B
        CALL SCR_SET_BORDER
        RET
message: DB "Bonjour Z80 !",13,10,0`;
  const res = assemble(src);
  assert.ok(res.ok, JSON.stringify(res.errors));
  const m = boot();
  m.load(res.segments);
  type(m, 'CALL &4000\r', 60);
  const s = screenText(m);
  assert.ok(s.includes('Bonjour Z80 !'), s.join('\n'));
  assert.equal(m.ga.inks[16], 0x0C);   // couleur matérielle 12 = rouge vif (firmware 6)
});

test('imprimante : PRINT #8 envoie le texte sur le port Centronics', () => {
  const m = boot();
  type(m, 'PRINT #8,"HELLO"\r', 80);
  assert.ok(m.printer.text.includes('HELLO'), JSON.stringify(m.printer.text));
});

test('disquette : SAVE puis CAT sur une disquette vierge au format DATA', () => {
  const m = boot();
  m.fdc.insert(0, blankDisk('data'));
  type(m, '10 PRINT "Z80"\r');
  type(m, 'SAVE "ESSAI"\r', 200);
  type(m, 'CAT\r', 200);
  const s = screenText(m).join('\n');
  assert.match(s, /ESSAI\s*\.BAS/, s);
  assert.equal(m.fdc.disk(0).dirty, true);
});

test('tables du clavier lues dans la ROM anglaise = disposition QWERTY du CPC', () => {
  const m = new CPC6128(ROMS);
  for (const [ch, k] of Object.entries(CHAR_KEYS)) {
    if (ch === '£' || ch === '\n' || ch === '\r') continue;
    assert.deepEqual(m.keyboard.charKeys[ch], k, `caractère ${JSON.stringify(ch)}`);
  }
});

test('CPC 6128 français : clavier AZERTY tiré de la ROM', () => {
  const m = new CPC6128(ROMS_FR);
  const k = m.keyboard.charKeys;
  assert.deepEqual(k.a, ['Q', false]);      // le A est à la place du Q
  assert.deepEqual(k.z, ['W', false]);
  assert.deepEqual(k.m, [':', false]);      // le M est à droite du L
  assert.deepEqual(k['1'], ['1', true]);    // chiffres avec SHIFT
  assert.deepEqual(k['é'], ['2', false]);
  assert.deepEqual(k['&'], ['1', false]);
});

test('CPC 6128 français : démarrage et saisie de caractères accentués', () => {
  const m = boot(ROMS_FR);
  const s0 = screenText(m);
  assert.ok(s0.includes('Ready') || s0.includes('Prêt'), s0.join('\n'));
  type(m, 'print "été à l\'école ça où"\r');
  const s = screenText(m);
  assert.ok(s.includes('été à l\'école ça où'), s.join('\n'));
});

test('CPC 6128 français : | (touche ù, code &7C) lance une commande RSX de l\'AMSDOS', () => {
  const m = boot(ROMS_FR);
  assert.deepEqual(m.keyboard.charKeys['|'], m.keyboard.charKeys['ù']);
  m.fdc.insert(0, blankDisk('data'));
  type(m, '|dir\r', 200);       // affiché « ùdir », exécuté comme |DIR par l'AMSDOS
  const s = screenText(m).join('\n');
  assert.match(s, /ùdir/, s);
  assert.doesNotMatch(s, /Syntax error|Unknown command/, s);
  assert.match(s, /Drive A: user\s+0/, s);
});

test('lecteur vide : l\'AMSDOS affiche « Drive A: disc missing »', () => {
  const m = boot();
  type(m, '|DIR\r', 200);
  const s = screenText(m).join('\n');
  assert.match(s, /Drive A: disc missing/, s);
  assert.match(s, /Retry, Ignore or Cancel\?/, s);
});

// mode du Gate Array ligne par ligne sur une trame complète
function modesPerLine(m) {
  const modes = new Array(312).fill(null), he = m.ga.hsyncEnd.bind(m.ga);
  m.ga.hsyncEnd = () => { he(); const c = m.crtc; modes[(c.vcc * (c.regs[9] + 1) + c.vlc) % 312] = m.ga.mode; };
  m.runFrame(); m.runFrame();
  m.ga.hsyncEnd = he;
  return modes;
}

test('écran partagé par interruptions : chargeur BASIC collé, MODE 0 en haut, MODE 1 en bas', () => {
  const m = boot(ROMS_FR);
  const bas = readFileSync(new URL('../exemples/ecran-partage.bas', import.meta.url), 'utf8');
  type(m, bas, 20);
  type(m, 'RUN\r', 500);
  const s = screenText(m).join('\n');
  assert.doesNotMatch(s, /Erreur dans les DATA|Syntax error/, s);
  const modes = modesPerLine(m);
  for (let l = 0; l < 80; l++) assert.equal(modes[l], 0, `ligne ${l} (barres) en mode 0`);
  for (let l = 104; l < 200; l++) assert.equal(modes[l], 1, `ligne ${l} (texte) en mode 1`);
  type(m, 'CALL &8003\r', 20);
  assert.ok(modesPerLine(m).every(v => v === 1), 'CALL &8003 revient en mode 1 partout');
});

test('MODE 0 / MODE 2 en pur assembleur : interruption en &0038, VSYNC lue sur le PPI, sortie par ESPACE', () => {
  const m = boot(ROMS_FR);
  const res = assemble(readFileSync(new URL('../exemples/mode0-mode2.asm', import.meta.url), 'utf8'));
  assert.ok(res.ok, JSON.stringify(res.errors));
  m.load(res.segments);
  const vect = [...m.ram.slice(0x38, 0x3B)];
  type(m, 'CALL &8000\r', 60);
  assert.deepEqual([...m.ram.slice(0x38, 0x3B)], [0xC3, res.symbols.INTER & 0xFF, res.symbols.INTER >> 8]);
  const modes = modesPerLine(m);
  for (let l = 0; l < 80; l++) assert.equal(modes[l], 0, `ligne ${l} (barres) en mode 0`);
  for (let l = 96; l < 200; l++) assert.equal(modes[l], 2, `ligne ${l} (texte) en mode 2`);
  const keep = m.ga.mode; m.ga.mode = 2;
  assert.ok(screenText(m).some(l => l.startsWith('MODE 2 : 640 x 200')), 'texte de MODE 2 dessiné avec la police de la ROM');
  m.ga.mode = keep;
  // musique : PSG programmé en direct (tonalités A et B, bruit sur C), notes qui changent
  assert.equal(m.psg.regs[7], 0x1C);
  assert.ok(m.psg.regs[8] > 0 && m.psg.regs[9] > 0, 'voix A et B audibles');
  const per = () => m.psg.regs[0] | (m.psg.regs[1] << 8), seen = new Set([per()]);
  for (let i = 0; i < 100; i++) { m.runFrame(); seen.add(per()); }
  assert.ok([...seen].every(p => [119, 106, 95, 159, 142, 127].includes(p)) && seen.size >= 3, `notes jouées : ${[...seen]}`);
  m.keyboard.set('SPACE', true); for (let i = 0; i < 3; i++) m.runFrame(); m.keyboard.set('SPACE', false);
  assert.deepEqual([...m.psg.regs.slice(8, 11)], [0, 0, 0], 'silence à la sortie');
  type(m, 'MODE 1\rPRINT 3*14\r', 40);
  assert.deepEqual([...m.ram.slice(0x38, 0x3B)], vect, '&0038 rendu au firmware');
  assert.ok(screenText(m).includes(' 42'), 'retour au BASIC');
});

test('collage juste après un CTRL (Ctrl+V) : le 1er caractère n\'est pas tapé avec CONTROL', () => {
  const m = boot(ROMS_FR);
  m.keyboard.set('CONTROL', true);
  for (let i = 0; i < 5; i++) m.runFrame();      // le firmware voit CONTROL enfoncé
  m.keyboard.matrix.fill(0xFF);                  // relâché au moment du collage
  m.keyboard.pause(6);
  type(m, '10 PRINT 1\r20 PRINT 2\r', 20);
  const lines = [];
  for (let a = 0x170; ;) { const len = m.ram[a] | (m.ram[a + 1] << 8); if (!len) break; lines.push(m.ram[a + 2] | (m.ram[a + 3] << 8)); a += len; }
  assert.deepEqual(lines, [10, 20]);
});
