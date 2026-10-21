import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FDC765 } from '../src/machines/cpc/fdc.js';
import { blankDisk } from '../src/machines/cpc/dsk.js';

const IDLE = 0x80, COMMAND = 0x90, EXEC_READ = 0xF0, EXEC_WRITE = 0xB0, RESULT = 0xD0;

// Envoi d'une commande comme l'AMSDOS : attendre RQM=1 et DIO=0 avant chaque octet
function send(fdc, bytes) {
  bytes.forEach((b, i) => {
    const msr = fdc.readStatus();
    assert.equal(msr & 0xC0, 0x80, `MSR ${msr.toString(16)} avant l'octet ${i}`);
    if (i > 0) assert.equal(msr & 0xF0, COMMAND);
    fdc.writeData(b);
  });
}

function readResult(fdc) {
  const out = [];
  while ((fdc.readStatus() & 0xF0) === RESULT) out.push(fdc.readData());
  assert.equal(fdc.readStatus() & 0xF0, IDLE);
  return out;
}

function readExec(fdc) {
  const out = [];
  while ((fdc.readStatus() & 0xF0) === EXEC_READ) out.push(fdc.readData());
  return Uint8Array.from(out);
}

function setup(disk = blankDisk()) {
  const fdc = new FDC765();
  fdc.insert(0, disk);
  fdc.setMotor(true);
  return { fdc, disk };
}

const sector = (disk, t, R) => disk.tracks[0][t].sectors.find(s => s.R === R);

function seek(fdc, track, drive = 0) {
  send(fdc, [0x0F, drive, track]);
  send(fdc, [0x08]);
  return readResult(fdc);
}

test('repos, SPECIFY : MSR &80, puis &90 pendant la commande, pas de phase résultat', () => {
  const { fdc } = setup();
  assert.equal(fdc.readStatus(), IDLE);
  fdc.writeData(0x03);
  assert.equal(fdc.readStatus(), COMMAND);
  assert.equal(fdc.activity.phase, 'commande');
  assert.equal(fdc.activity.command, 'SPECIFY');
  fdc.writeData(0xA1);
  assert.equal(fdc.readStatus(), COMMAND);
  fdc.writeData(0x03);
  assert.equal(fdc.readStatus(), IDLE);
  assert.equal(fdc.activity.phase, 'repos');
  assert.deepEqual(fdc.specify, { srt: 0x0A, hut: 0x01, hlt: 0x01, nd: true });
});

test('RECALIBRATE + SENSE INTERRUPT STATUS : ST0 &20, PCN 0 ; sans interruption : &80', () => {
  const { fdc } = setup();
  seek(fdc, 5);
  send(fdc, [0x07, 0x00]);
  assert.equal(fdc.readStatus(), IDLE | 0x01);  // lecteur 0 en recherche jusqu'au SENSE INT
  send(fdc, [0x08]);
  assert.equal(fdc.readStatus(), RESULT);
  assert.deepEqual(readResult(fdc), [0x20, 0x00]);
  assert.equal(fdc.readStatus(), IDLE);
  assert.equal(fdc.activity.track[0], 0);
  send(fdc, [0x08]);
  assert.deepEqual(readResult(fdc), [0x80]);
});

test('SEEK piste 2 + SENSE INT, puis READ ID', () => {
  const { fdc } = setup();
  assert.deepEqual(seek(fdc, 2), [0x20, 0x02]);
  assert.equal(fdc.activity.track[0], 2);
  send(fdc, [0x4A, 0x00]);
  assert.equal(fdc.readStatus(), RESULT);
  assert.deepEqual(readResult(fdc), [0x00, 0x00, 0x00, 0x02, 0x00, 0xC1, 0x02]);
  // Les ID défilent : le suivant dans l'ordre physique (entrelacement)
  send(fdc, [0x4A, 0x00]);
  assert.deepEqual(readResult(fdc), [0x00, 0x00, 0x00, 0x02, 0x00, 0xC6, 0x02]);
  // SEEK borné à la dernière piste + 1
  assert.deepEqual(seek(fdc, 80), [0x20, 40]);
});

test('READ DATA &C1 avec EOT=&C1 : 512 octets puis résultat &40 &80 &00', () => {
  const { fdc, disk } = setup();
  const data = sector(disk, 2, 0xC1).data;
  for (let i = 0; i < 512; i++) data[i] = (i * 7) & 0xFF;
  seek(fdc, 2);
  send(fdc, [0x46, 0x00, 0x02, 0x00, 0xC1, 0x02, 0xC1, 0x2A, 0xFF]);
  assert.equal(fdc.readStatus(), EXEC_READ);
  assert.equal(fdc.activity.phase, 'exécution');
  assert.equal(fdc.activity.reading, true);
  assert.equal(fdc.activity.command, 'READ DATA');
  const got = readExec(fdc);
  assert.equal(got.length, 512);
  assert.deepEqual(got, data);
  assert.equal(fdc.readStatus(), RESULT);
  assert.equal(fdc.activity.sector, 0xC1);
  assert.deepEqual(readResult(fdc), [0x40, 0x80, 0x00, 0x02, 0x00, 0xC1, 0x02]);
  assert.equal(fdc.activity.reading, false);
});

test('READ DATA multi-secteurs &C1–&C3 : 1536 octets, R = EOT ; lecteur 2 = lecteur 0', () => {
  const { fdc, disk } = setup();
  sector(disk, 0, 0xC2).data.fill(0x22);
  sector(disk, 0, 0xC3).data.fill(0x33);
  send(fdc, [0x46, 0x02, 0x00, 0x00, 0xC1, 0x02, 0xC3, 0x2A, 0xFF]);
  const got = readExec(fdc);
  assert.equal(got.length, 1536);
  assert.equal(got[0], 0xE5);
  assert.equal(got[512], 0x22);
  assert.equal(got[1535], 0x33);
  assert.deepEqual(readResult(fdc), [0x42, 0x80, 0x00, 0x00, 0x00, 0xC3, 0x02]);
});

test('WRITE DATA puis relecture ; disk.dirty et onChange', () => {
  const { fdc, disk } = setup();
  const changes = [];
  fdc.onChange = d => changes.push(d);
  seek(fdc, 2);
  send(fdc, [0x45, 0x00, 0x02, 0x00, 0xC2, 0x02, 0xC2, 0x2A, 0xFF]);
  assert.equal(fdc.readStatus(), EXEC_WRITE);
  assert.equal(fdc.activity.writing, true);
  for (let i = 0; i < 512; i++) {
    assert.equal(fdc.readStatus(), EXEC_WRITE);
    fdc.writeData(i & 0xFF);
  }
  assert.equal(fdc.readStatus(), RESULT);
  assert.deepEqual(readResult(fdc), [0x40, 0x80, 0x00, 0x02, 0x00, 0xC2, 0x02]);
  assert.equal(disk.dirty, true);
  assert.deepEqual(changes, [0]);
  assert.equal(sector(disk, 2, 0xC2).data[255], 0xFF);

  send(fdc, [0x46, 0x00, 0x02, 0x00, 0xC2, 0x02, 0xC2, 0x2A, 0xFF]);
  const got = readExec(fdc);
  assert.deepEqual([...got], Array.from({ length: 512 }, (_, i) => i & 0xFF));
  assert.deepEqual(readResult(fdc), [0x40, 0x80, 0x00, 0x02, 0x00, 0xC2, 0x02]);
});

test('WRITE DELETED DATA, READ DATA (CM), SK et READ DELETED DATA', () => {
  const { fdc, disk } = setup();
  send(fdc, [0x49, 0x00, 0x00, 0x00, 0xC2, 0x02, 0xC2, 0x2A, 0xFF]);
  for (let i = 0; i < 512; i++) fdc.writeData(0x77);
  assert.deepEqual(readResult(fdc), [0x40, 0x80, 0x00, 0x00, 0x00, 0xC2, 0x02]);
  assert.equal(sector(disk, 0, 0xC2).st2 & 0x40, 0x40);

  // READ DATA C1–C3 sans SK : s'arrête après le secteur effacé, ST2 CM
  send(fdc, [0x46, 0x00, 0x00, 0x00, 0xC1, 0x02, 0xC3, 0x2A, 0xFF]);
  assert.equal(readExec(fdc).length, 1024);
  assert.deepEqual(readResult(fdc), [0x40, 0x00, 0x40, 0x00, 0x00, 0xC2, 0x02]);
  // Avec SK : le secteur effacé est sauté
  send(fdc, [0x66, 0x00, 0x00, 0x00, 0xC1, 0x02, 0xC3, 0x2A, 0xFF]);
  assert.equal(readExec(fdc).length, 1024);
  assert.deepEqual(readResult(fdc), [0x40, 0x80, 0x00, 0x00, 0x00, 0xC3, 0x02]);
  // READ DELETED DATA sur le secteur effacé : normal ; sur un secteur normal : CM
  send(fdc, [0x4C, 0x00, 0x00, 0x00, 0xC2, 0x02, 0xC2, 0x2A, 0xFF]);
  assert.ok(readExec(fdc).every(x => x === 0x77));
  assert.deepEqual(readResult(fdc), [0x40, 0x80, 0x00, 0x00, 0x00, 0xC2, 0x02]);
  send(fdc, [0x4C, 0x00, 0x00, 0x00, 0xC1, 0x02, 0xC1, 0x2A, 0xFF]);
  assert.equal(readExec(fdc).length, 512);
  assert.deepEqual(readResult(fdc), [0x40, 0x00, 0x40, 0x00, 0x00, 0xC1, 0x02]);
});

test('FORMAT TRACK : la piste est remplacée par les secteurs décrits', () => {
  const { fdc, disk } = setup();
  let changed = 0;
  fdc.onChange = () => changed++;
  seek(fdc, 3);
  send(fdc, [0x4D, 0x00, 0x02, 0x09, 0x52, 0xE5]);
  assert.equal(fdc.readStatus(), EXEC_WRITE);
  assert.equal(fdc.activity.command, 'FORMAT TRACK');
  for (let k = 0; k < 9; k++) {
    for (const b of [3, 0, 0x41 + k, 2]) {
      assert.equal(fdc.readStatus(), EXEC_WRITE);
      fdc.writeData(b);
    }
  }
  assert.equal(fdc.readStatus(), RESULT);
  assert.deepEqual(readResult(fdc), [0x00, 0x00, 0x00, 0x03, 0x00, 0x49, 0x02]);
  assert.equal(disk.dirty, true);
  assert.equal(changed, 1);
  const trk = disk.tracks[0][3];
  assert.equal(trk.gap3, 0x52);
  assert.deepEqual(trk.sectors.map(s => s.R), [0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49]);
  send(fdc, [0x4A, 0x00]);
  assert.deepEqual(readResult(fdc), [0x00, 0x00, 0x00, 0x03, 0x00, 0x41, 0x02]);
  send(fdc, [0x46, 0x00, 0x03, 0x00, 0x45, 0x02, 0x45, 0x2A, 0xFF]);
  const got = readExec(fdc);
  assert.equal(got.length, 512);
  assert.ok(got.every(x => x === 0xE5));
  readResult(fdc);
  // L'ancien secteur &C1 n'existe plus sur cette piste
  send(fdc, [0x46, 0x00, 0x03, 0x00, 0xC1, 0x02, 0xC1, 0x2A, 0xFF]);
  assert.deepEqual(readResult(fdc), [0x40, 0x04, 0x00, 0x03, 0x00, 0xC1, 0x02]);
  // Formatage de la piste 40 (dernière + 1) : la piste est ajoutée
  seek(fdc, 40);
  send(fdc, [0x4D, 0x00, 0x02, 0x01, 0x52, 0xE5]);
  [40, 0, 0xC1, 2].forEach(b => fdc.writeData(b));
  readResult(fdc);
  assert.equal(disk.tracks[0].length, 41);
});

test('secteur introuvable, piste vide, mauvais cylindre', () => {
  const { fdc, disk } = setup();
  send(fdc, [0x46, 0x00, 0x00, 0x00, 0x99, 0x02, 0x99, 0x2A, 0xFF]);
  assert.equal(fdc.readStatus(), RESULT);
  assert.deepEqual(readResult(fdc), [0x40, 0x04, 0x00, 0x00, 0x00, 0x99, 0x02]);
  // Cylindre demandé différent de celui des ID : ND + ST2 WC
  send(fdc, [0x46, 0x00, 0x05, 0x00, 0xC1, 0x02, 0xC1, 0x2A, 0xFF]);
  assert.deepEqual(readResult(fdc), [0x40, 0x04, 0x10, 0x05, 0x00, 0xC1, 0x02]);
  // Piste sans aucun secteur : ND + MA
  disk.tracks[0][0].sectors = [];
  send(fdc, [0x46, 0x00, 0x00, 0x00, 0xC1, 0x02, 0xC1, 0x2A, 0xFF]);
  assert.deepEqual(readResult(fdc), [0x40, 0x05, 0x00, 0x00, 0x00, 0xC1, 0x02]);
  send(fdc, [0x4A, 0x00]);
  assert.deepEqual(readResult(fdc).slice(0, 3), [0x40, 0x01, 0x00]);
});

test('secteur stocké plus court que 128 << N : complété par l\'octet de remplissage', () => {
  const { fdc, disk } = setup();
  const trk = disk.tracks[0][0];
  trk.filler = 0x4E;
  sector(disk, 0, 0xC1).data = new Uint8Array(100).fill(0x11);
  send(fdc, [0x46, 0x00, 0x00, 0x00, 0xC1, 0x02, 0xC1, 0x2A, 0xFF]);
  const got = readExec(fdc);
  assert.equal(got.length, 512);
  assert.equal(got[99], 0x11);
  assert.equal(got[100], 0x4E);
  assert.equal(got[511], 0x4E);
  readResult(fdc);
});

test('lecteur B vide : non prêt (ST3 sans Ready, ST0 &49), lecteur 3 = lecteur 1', () => {
  const { fdc } = setup();
  send(fdc, [0x04, 0x01]);
  assert.equal(fdc.readStatus(), RESULT);
  const [st3] = readResult(fdc);
  assert.equal(st3 & 0x20, 0);
  assert.equal(st3 & 0x03, 0x01);
  send(fdc, [0x46, 0x01, 0x00, 0x00, 0xC1, 0x02, 0xC1, 0x2A, 0xFF]);
  assert.deepEqual(readResult(fdc), [0x49, 0x00, 0x00, 0x00, 0x00, 0xC1, 0x02]);
  send(fdc, [0x46, 0x03, 0x00, 0x00, 0xC1, 0x02, 0xC1, 0x2A, 0xFF]);
  assert.equal(readResult(fdc)[0], 0x4B);
  // Recalibrage sur lecteur non prêt : ST0 &68 | lecteur (NR, pas EC : c'est ce qui fait dire « disc missing » à l'AMSDOS)
  send(fdc, [0x07, 0x01]);
  send(fdc, [0x08]);
  assert.deepEqual(readResult(fdc), [0x69, 0x00]);
  // Lecteur A prêt : Ready et Track 0
  send(fdc, [0x04, 0x00]);
  assert.equal(readResult(fdc)[0], 0x30);
  assert.equal(fdc.disk(1), null);
  assert.ok(fdc.disk(0));
});

test('moteur arrêté : lecteur non prêt', () => {
  const { fdc, disk } = setup();
  fdc.setMotor(0);
  assert.equal(fdc.activity.motor, false);
  send(fdc, [0x04, 0x00]);
  assert.equal(readResult(fdc)[0] & 0x20, 0);
  send(fdc, [0x46, 0x00, 0x00, 0x00, 0xC1, 0x02, 0xC1, 0x2A, 0xFF]);
  assert.deepEqual(readResult(fdc), [0x48, 0x00, 0x00, 0x00, 0x00, 0xC1, 0x02]);
  send(fdc, [0x45, 0x00, 0x00, 0x00, 0xC1, 0x02, 0xC1, 0x2A, 0xFF]);
  assert.equal(readResult(fdc)[0], 0x48);
  assert.equal(disk.dirty, false);
  send(fdc, [0x4A, 0x00]);
  assert.equal(readResult(fdc)[0], 0x48);
  fdc.setMotor(1);
  send(fdc, [0x04, 0x00]);
  assert.equal(readResult(fdc)[0] & 0x20, 0x20);
  // Éjection : de nouveau non prêt
  assert.equal(fdc.eject(0), disk);
  send(fdc, [0x04, 0x00]);
  assert.equal(readResult(fdc)[0] & 0x20, 0);
});

test('commande invalide : un seul octet de résultat ST0 &80', () => {
  const { fdc } = setup();
  for (const op of [0x00, 0x01, 0x1F, 0x0E]) {
    fdc.writeData(op);
    assert.equal(fdc.readStatus(), RESULT);
    assert.equal(fdc.activity.phase, 'résultat');
    assert.deepEqual(readResult(fdc), [0x80]);
  }
});

test('reset : retour au repos, interruptions oubliées', () => {
  const { fdc } = setup();
  send(fdc, [0x0F, 0x00, 0x04]);
  send(fdc, [0x46, 0x00]);
  fdc.reset();
  assert.equal(fdc.readStatus(), IDLE);
  assert.equal(fdc.activity.phase, 'repos');
  send(fdc, [0x08]);
  assert.deepEqual(readResult(fdc), [0x80]);
});
