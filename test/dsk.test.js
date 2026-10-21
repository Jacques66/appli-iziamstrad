import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDSK, writeDSK, blankDisk } from '../src/machines/cpc/dsk.js';

const text = b => String.fromCharCode(...b);

test('blankDisk : format données, 40 pistes, secteurs &C1–&C9 de 512 octets remplis de &E5', () => {
  const disk = blankDisk();
  assert.equal(disk.sides, 1);
  assert.equal(disk.dirty, false);
  assert.equal(disk.tracks[0].length, 40);
  const trk = disk.tracks[0][5];
  assert.equal(trk.track, 5);
  assert.equal(trk.filler, 0xE5);
  assert.deepEqual(trk.sectors.map(s => s.R).sort(), [0xC1, 0xC2, 0xC3, 0xC4, 0xC5, 0xC6, 0xC7, 0xC8, 0xC9]);
  for (const s of trk.sectors) {
    assert.equal(s.C, 5); assert.equal(s.H, 0); assert.equal(s.N, 2);
    assert.equal(s.data.length, 512);
    assert.ok(s.data.every(x => x === 0xE5));
  }
  assert.deepEqual(blankDisk('system').tracks[0][0].sectors.map(s => s.R).sort(), [0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49]);
  assert.throws(() => blankDisk('ibm'), /Format de disque inconnu/);
});

test('aller-retour blankDisk → writeDSK → parseDSK au format étendu', () => {
  const disk = blankDisk('system');
  disk.tracks[0][3].sectors[2].data.fill(0x42);
  disk.tracks[0][3].sectors[4].st2 = 0x40;
  const bytes = writeDSK(disk);
  assert.equal(text(bytes.subarray(0, 34)), 'EXTENDED CPC DSK File\r\nDisk-Info\r\n');
  assert.equal(bytes[0x30], 40);
  assert.equal(bytes[0x31], 1);
  assert.equal(bytes[0x34], (0x100 + 9 * 512) >> 8);
  assert.equal(bytes.length, 0x100 + 40 * (0x100 + 9 * 512));
  assert.equal(text(bytes.subarray(0x100, 0x10C)), 'Track-Info\r\n');

  const back = parseDSK(bytes);
  assert.equal(back.sides, 1);
  assert.equal(back.creator, 'Z80 Studio');
  assert.equal(back.dirty, false);
  assert.equal(back.tracks[0].length, 40);
  for (let t = 0; t < 40; t++) {
    const a = disk.tracks[0][t], b = back.tracks[0][t];
    assert.equal(b.track, t);
    assert.equal(b.side, 0);
    assert.equal(b.gap3, a.gap3);
    assert.equal(b.filler, a.filler);
    assert.equal(b.sectors.length, 9);
    a.sectors.forEach((s, k) => {
      const r = b.sectors[k];
      assert.deepEqual([r.C, r.H, r.R, r.N, r.st1, r.st2], [s.C, s.H, s.R, s.N, s.st1, s.st2]);
      assert.deepEqual(r.data, s.data);
    });
  }
  assert.deepEqual(writeDSK(back), bytes);
});

test('format étendu : pistes absentes, secteurs de tailles variables, deux faces', () => {
  const sec = (R, data) => ({ C: 0, H: 0, R, N: 2, st1: 0, st2: 0, data });
  const disk = {
    sides: 2, creator: 'Test', dirty: false,
    tracks: [
      [{ track: 0, side: 0, gap3: 0x4E, filler: 0xAA, sectors: [sec(1, new Uint8Array(100).fill(7)), sec(2, new Uint8Array(512).fill(8))] }, null],
      [null, { track: 1, side: 1, gap3: 0x52, filler: 0xE5, sectors: [] }],
    ],
  };
  const bytes = writeDSK(disk);
  assert.deepEqual([...bytes.subarray(0x34, 0x38)], [4, 0, 0, 1]);
  const back = parseDSK(bytes);
  assert.equal(back.sides, 2);
  assert.equal(back.creator, 'Test');
  assert.equal(back.tracks[1][0], null);
  assert.equal(back.tracks[0][1], null);
  assert.equal(back.tracks[1][1].sectors.length, 0);
  assert.equal(back.tracks[1][1].side, 1);
  assert.equal(back.tracks[0][0].sectors[0].data.length, 100);
  assert.ok(back.tracks[0][0].sectors[0].data.every(x => x === 7));
  assert.ok(back.tracks[0][0].sectors[1].data.every(x => x === 8));
  assert.equal(back.tracks[0][0].filler, 0xAA);
});

// DSK standard : 2 pistes, 1 face, 2 secteurs de 256 octets (N=1) par piste
function buildStandard() {
  const trackSize = 0x100 + 2 * 256;
  const b = new Uint8Array(0x100 + 2 * trackSize);
  const put = (off, s) => { for (let i = 0; i < s.length; i++) b[off + i] = s.charCodeAt(i); };
  put(0, 'MV - CPCEMU Disk-File\r\nDisk-Info\r\n');
  put(0x22, 'CPCEMU');
  b[0x30] = 2; b[0x31] = 1;
  b[0x32] = trackSize & 0xFF; b[0x33] = trackSize >> 8;
  for (let t = 0; t < 2; t++) {
    const off = 0x100 + t * trackSize;
    put(off, 'Track-Info\r\n');
    b[off + 0x10] = t; b[off + 0x11] = 0;
    b[off + 0x14] = 1; b[off + 0x15] = 2; b[off + 0x16] = 0x4E; b[off + 0x17] = 0xE5;
    for (let k = 0; k < 2; k++) {
      const i = off + 0x18 + 8 * k;
      b[i] = t; b[i + 1] = 0; b[i + 2] = k + 1; b[i + 3] = 1;
      b[i + 5] = k === 1 ? 0x40 : 0;
      b.fill(t * 16 + k, off + 0x100 + k * 256, off + 0x100 + (k + 1) * 256);
    }
  }
  return b;
}

test('parseDSK : format standard construit à la main', () => {
  const disk = parseDSK(buildStandard());
  assert.equal(disk.sides, 1);
  assert.equal(disk.creator, 'CPCEMU');
  assert.equal(disk.tracks[0].length, 2);
  const t1 = disk.tracks[0][1];
  assert.equal(t1.track, 1);
  assert.equal(t1.gap3, 0x4E);
  assert.deepEqual(t1.sectors.map(s => [s.C, s.H, s.R, s.N, s.st2]), [[1, 0, 1, 1, 0], [1, 0, 2, 1, 0x40]]);
  assert.equal(t1.sectors[1].data.length, 256);
  assert.ok(t1.sectors[1].data.every(x => x === 0x11));
  // Réécrit au format étendu, contenu identique
  const ext = parseDSK(writeDSK(disk));
  assert.deepEqual(ext.tracks[0][1].sectors[1].data, t1.sectors[1].data);
});

test('parseDSK : erreurs sur fichier invalide', () => {
  assert.throws(() => parseDSK(new Uint8Array(10)), /trop court|256/);
  assert.throws(() => parseDSK(new Uint8Array(512)), /signature/);
  const truncated = buildStandard().subarray(0, 0x100 + 0x200);
  assert.throws(() => parseDSK(truncated), /tronqué/);
  const badTrack = buildStandard();
  badTrack[0x100] = 0x58;
  assert.throws(() => parseDSK(badTrack), /Track-Info/);
  const badSides = buildStandard();
  badSides[0x31] = 3;
  assert.throws(() => parseDSK(badSides), /faces/);
  const bigSector = writeDSK(blankDisk());
  bigSector[0x100 + 0x18 + 6] = 0xFF; bigSector[0x100 + 0x18 + 7] = 0xFF;
  assert.throws(() => parseDSK(bigSector), /hors de la piste/);
});
