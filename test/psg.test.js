import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AY38912 } from '../src/machines/cpc/psg.js';

const CPU = 4_000_000, RATE = 48_000;

// Passages par zéro (montants) d'un signal
function risingCrossings(x) {
  let n = 0;
  for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) n++;
  return n;
}
const maxAbs = (x, from = 0) => {
  let m = 0;
  for (let i = from; i < x.length; i++) m = Math.max(m, Math.abs(x[i]));
  return m;
};

test('masques des registres', () => {
  const psg = new AY38912();
  for (let r = 0; r < 16; r++) psg.writeRegister(r, 0xFF, 0);
  assert.deepEqual([...psg.regs], [
    0xFF, 0x0F, 0xFF, 0x0F, 0xFF, 0x0F, 0x1F, 0xFF, 0x1F, 0x1F, 0x1F, 0xFF, 0xFF, 0x0F, 0xFF, 0xFF,
  ]);
  psg.reset();
  assert.ok(psg.regs.every(v => v === 0));
  assert.equal(psg.selected, 0);
});

test('R14 lit portAInput quand R7 bit 6 = 0, sinon le registre', () => {
  const psg = new AY38912();
  assert.equal(psg.readRegister(14), 0xFF);       // défaut : aucune touche
  psg.portAInput = () => 0xDF;
  psg.writeRegister(14, 0x12, 0);
  psg.writeRegister(7, 0x3F, 0);
  assert.equal(psg.readRegister(14), 0xDF);
  psg.writeRegister(7, 0x7F, 0);
  assert.equal(psg.readRegister(14), 0x12);
});

test('bus() : séquences sélection / écriture / lecture du PPI du CPC', () => {
  const psg = new AY38912();
  psg.portAInput = () => 0xFB;
  let t = 0;
  // OUT &F4xx,reg ; OUT &F6xx,&C0 ; OUT &F6xx,0 puis OUT &F4xx,val ; OUT &F6xx,&80 ; OUT &F6xx,0
  const ppiWrite = (reg, val) => {
    psg.bus(0, 0, reg, t += 12);
    assert.equal(psg.bus(1, 1, reg, t += 12), undefined);
    psg.bus(0, 0, reg, t += 12);
    psg.bus(0, 0, val, t += 12);
    assert.equal(psg.bus(1, 0, val, t += 12), undefined);
    psg.bus(0, 0, val, t += 12);
  };
  ppiWrite(0, 0xDE);
  ppiWrite(1, 0xF1);
  ppiWrite(8, 0x0F);
  ppiWrite(7, 0x38);
  assert.equal(psg.regs[0], 0xDE);
  assert.equal(psg.regs[1], 0x01);
  assert.equal(psg.regs[8], 0x0F);
  assert.equal(psg.selected, 7);
  // lecture clavier : sélection R14, port A du PPI en entrée, port C = &40, IN A,(&F4xx)
  psg.bus(1, 1, 0x0E, t += 12);
  psg.bus(0, 0, 0x0E, t += 12);
  assert.equal(psg.bus(0, 1, 0xFF, t += 12), 0xFB);
  assert.equal(psg.bus(0, 0, 0xFF, t += 12), undefined);
  // relecture d'un registre ordinaire
  psg.bus(1, 1, 0x01, t += 12);
  assert.equal(psg.bus(0, 1, 0xFF, t += 12), 0x01);
});

test('fréquence d\'une note : TP = &1DE → 1e6 / (16 × 478) Hz à ±1 %', () => {
  const psg = new AY38912();
  psg.writeRegister(0, 0xDE, 0);
  psg.writeRegister(1, 0x01, 0);
  psg.writeRegister(7, 0x3E, 0);                  // tonalité A seule
  psg.writeRegister(8, 15, 0);
  const { left } = psg.render(0, CPU, RATE);
  assert.equal(left.length, RATE);
  const expected = 1e6 / (16 * 478);
  assert.ok(Math.abs(expected - 130.75) < 0.01);
  const measured = risingCrossings(left);
  assert.ok(Math.abs(measured - expected) / expected < 0.01, `mesuré ${measured} Hz`);
  assert.ok(Math.abs(psg.levels().voices[0].freq - expected) < 1e-9);
});

test('TP = 0 se comporte comme TP = 1', () => {
  const a = new AY38912(), b = new AY38912();
  for (const [psg, tp] of [[a, 0], [b, 1]]) {
    psg.writeRegister(0, tp, 0);
    psg.writeRegister(7, 0x3E, 0);
    psg.writeRegister(8, 15, 0);
  }
  assert.deepEqual(a.render(0, 40000, RATE).left, b.render(0, 40000, RATE).left);
});

test('silence : volume 0, ou voix coupée dans le mixeur (après retrait du continu)', () => {
  const psg = new AY38912();
  psg.writeRegister(0, 0x40, 0);
  psg.writeRegister(7, 0x38, 0);                  // tonalités actives
  for (let c = 0; c < 3; c++) psg.writeRegister(8 + c, 0, 0);
  let { left, right } = psg.render(0, CPU / 4, RATE);
  assert.equal(maxAbs(left), 0);
  assert.equal(maxAbs(right), 0);

  const cut = new AY38912();
  cut.writeRegister(0, 0x40, 0);
  cut.writeRegister(6, 0x10, 0);
  cut.writeRegister(7, 0x3F, 0);                  // tonalité et bruit coupés partout
  cut.writeRegister(8, 15, 0);
  ({ left } = cut.render(0, CPU, RATE));
  assert.ok(maxAbs(left, RATE / 2) < 1e-4);       // reste un niveau continu, retiré par le passe-haut
});

test('bruit : LFSR actif, signal non périodique et non nul', () => {
  const psg = new AY38912();
  psg.writeRegister(6, 8, 0);
  psg.writeRegister(7, 0x37, 0);                  // bruit sur A seulement
  psg.writeRegister(8, 15, 0);
  const { left } = psg.render(0, CPU / 2, RATE);
  assert.ok(maxAbs(left) > 0.1);
  assert.ok(risingCrossings(left) > 100);
  assert.equal(psg.levels().noiseFreq, 1e6 / (16 * 8));
});

// Niveau de l'enveloppe au milieu de chacun des `steps` premiers pas
function envelopeSequence(shape, steps = 48, ep = 10) {
  const psg = new AY38912();
  psg.writeRegister(11, ep, 0);
  psg.writeRegister(12, 0, 0);
  psg.writeRegister(13, shape, 0);
  const stepT = 16 * ep * 4;
  const seq = [];
  let t = 0;
  for (let i = 0; i < steps; i++) {
    const to = i * stepT + stepT / 2;
    psg.render(t, to, RATE);
    t = to;
    seq.push(psg.envLevel);
  }
  return seq;
}
const down = [15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
const up = [...down].reverse();
const fill = (v, n) => new Array(n).fill(v);

test('enveloppe &00 : descente puis silence', () => {
  assert.deepEqual(envelopeSequence(0x00), [...down, ...fill(0, 32)]);
});

test('enveloppe &04 : montée puis silence', () => {
  assert.deepEqual(envelopeSequence(0x04), [...up, ...fill(0, 32)]);
});

test('enveloppe &08 : dents de scie descendantes', () => {
  assert.deepEqual(envelopeSequence(0x08), [...down, ...down, ...down]);
});

test('enveloppe &0A : triangle commençant par la descente', () => {
  assert.deepEqual(envelopeSequence(0x0A), [...down, ...up, ...down]);
});

test('enveloppe &0B : descente puis maintien au maximum', () => {
  assert.deepEqual(envelopeSequence(0x0B), [...down, ...fill(15, 32)]);
});

test('enveloppe &0C : dents de scie montantes', () => {
  assert.deepEqual(envelopeSequence(0x0C), [...up, ...up, ...up]);
});

test('enveloppe &0D : montée puis maintien au maximum', () => {
  assert.deepEqual(envelopeSequence(0x0D), [...up, ...fill(15, 32)]);
});

test('enveloppe &0E : triangle commençant par la montée', () => {
  assert.deepEqual(envelopeSequence(0x0E), [...up, ...down, ...up]);
});

test('enveloppe &0F : montée puis silence maintenu', () => {
  assert.deepEqual(envelopeSequence(0x0F), [...up, ...fill(0, 32)]);
});

test('écrire R13 relance l\'enveloppe', () => {
  const psg = new AY38912();
  psg.writeRegister(11, 1, 0);
  psg.writeRegister(13, 0x00, 0);
  psg.render(0, 64 * 5 + 32, RATE);
  assert.equal(psg.envLevel, 10);
  psg.writeRegister(13, 0x00, 64 * 5 + 32);
  psg.render(64 * 5 + 32, 64 * 5 + 40, RATE);
  assert.equal(psg.envLevel, 15);
});

test('volume piloté par l\'enveloppe : la note s\'éteint avec la forme &00', () => {
  const psg = new AY38912();
  psg.writeRegister(0, 0x40, 0);
  psg.writeRegister(7, 0x3E, 0);
  psg.writeRegister(8, 0x10, 0);
  psg.writeRegister(11, 0x00, 0);
  psg.writeRegister(12, 0x08, 0);                 // EP = &800 → 0,52 s pour 16 pas
  psg.writeRegister(13, 0x00, 0);
  const { left } = psg.render(0, CPU, RATE);
  assert.ok(maxAbs(left.subarray(0, RATE / 10)) > 0.3);
  assert.equal(maxAbs(left, Math.ceil(RATE * 0.6)) < 1e-3, true);
});

test('render() successifs contigus = un seul render() (phases conservées)', () => {
  const setup = psg => {
    psg.writeRegister(0, 0x77, 0);
    psg.writeRegister(2, 0x3A, 0);
    psg.writeRegister(3, 0x01, 0);
    psg.writeRegister(6, 0x05, 0);
    psg.writeRegister(7, 0x2C, 0);
    psg.writeRegister(8, 12, 0);
    psg.writeRegister(9, 0x10, 0);
    psg.writeRegister(10, 9, 0);
    psg.writeRegister(11, 0x20, 0);
    psg.writeRegister(13, 0x0E, 0);
    psg.writeRegister(8, 7, 123457);              // écritures horodatées en cours de route
    psg.writeRegister(4, 0x99, 250001);
  };
  const one = new AY38912(), many = new AY38912();
  setup(one); setup(many);
  const end = 400_000;
  const ref = one.render(0, end, RATE);
  const left = [], right = [];
  const cuts = [0, 1, 97, 5000, 5001, 83_334, 123_457, 200_000, 333_333, end];
  for (let i = 1; i < cuts.length; i++) {
    const r = many.render(cuts[i - 1], cuts[i], RATE);
    left.push(...r.left); right.push(...r.right);
  }
  assert.equal(left.length, ref.left.length);
  for (let i = 0; i < left.length; i++) {
    assert.ok(Math.abs(left[i] - ref.left[i]) < 1e-6, `gauche ${i}`);
    assert.ok(Math.abs(right[i] - ref.right[i]) < 1e-6, `droite ${i}`);
  }
});

test('render() est déterministe', () => {
  const make = () => {
    const psg = new AY38912();
    psg.writeRegister(6, 3, 0);
    psg.writeRegister(7, 0x30, 0);
    psg.writeRegister(8, 15, 0);
    psg.writeRegister(9, 10, 0);
    return psg.render(0, 200_000, RATE);
  };
  assert.deepEqual(make(), make());
});

test('stéréo du CPC : A à gauche, B au centre, C à droite', () => {
  const voice = c => {
    const psg = new AY38912();
    psg.writeRegister(2 * c, 0x80, 0);
    psg.writeRegister(7, 0x3F & ~(1 << c), 0);
    psg.writeRegister(8 + c, 15, 0);
    return psg.render(0, CPU / 4, RATE);
  };
  const a = voice(0), b = voice(1), c = voice(2);
  assert.ok(maxAbs(a.left) > 0.3);
  assert.ok(maxAbs(a.right) < 1e-6);
  assert.ok(maxAbs(c.right) > 0.3);
  assert.ok(maxAbs(c.left) < 1e-6);
  assert.ok(maxAbs(b.left) > 0.1);
  assert.deepEqual(b.left, b.right);
});

test('trois voix au maximum restent dans [-1, 1]', () => {
  const psg = new AY38912();
  psg.writeRegister(0, 0x40, 0);
  psg.writeRegister(2, 0x40, 0);
  psg.writeRegister(4, 0x40, 0);
  psg.writeRegister(7, 0x38, 0);
  for (let c = 0; c < 3; c++) psg.writeRegister(8 + c, 15, 0);
  const { left, right } = psg.render(0, CPU / 2, RATE);
  assert.ok(maxAbs(left) <= 1 && maxAbs(right) <= 1);
  assert.ok(maxAbs(left) > 0.4);
});

test('levels() résume l\'état pour l\'interface', () => {
  const psg = new AY38912();
  psg.writeRegister(2, 0xDE, 0);
  psg.writeRegister(3, 0x01, 0);
  psg.writeRegister(6, 0x1F, 0);
  psg.writeRegister(7, 0x2D, 0);                  // tonalité B, bruit B
  psg.writeRegister(9, 0x0C, 0);
  psg.writeRegister(10, 0x10, 0);
  psg.writeRegister(11, 0x34, 0);
  psg.writeRegister(12, 0x12, 0);
  psg.writeRegister(13, 0x0A, 0);
  const lv = psg.levels();
  assert.equal(lv.voices.length, 3);
  assert.deepEqual(lv.voices[1], { freq: 1e6 / (16 * 478), volume: 12, tone: true, noise: true, env: false });
  assert.equal(lv.voices[0].tone, false);
  assert.equal(lv.voices[2].env, true);
  assert.equal(lv.noiseFreq, 1e6 / (16 * 31));
  assert.equal(lv.envShape, 0x0A);
  assert.equal(lv.envPeriod, 0x1234);
});
