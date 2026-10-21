/* Contrôleur de disquettes NEC µPD765A, tel que câblé dans l'Amstrad CPC 6128.

   Ports : &FA7E (écriture, bit 0) moteur des deux lecteurs, &FB7E (lecture) registre
   d'état principal (MSR), &FB7F données (lecture/écriture).
   Pas de minutage : les octets sont disponibles immédiatement, RQM reste à 1 pendant
   les phases actives ; le mode non-DMA est le seul utilisé.
   Particularités du CPC :
   - la broche TC n'est pas câblée : READ/WRITE DATA vont jusqu'au secteur EOT et se
     terminent toujours en « fin anormale » avec ST1 EN (fin de cylindre) ;
   - seule US0 est câblée : les lecteurs 2 et 3 désignent 0 et 1 ;
   - un lecteur est prêt s'il contient un disque et que le moteur tourne ;
   - sur un disque à une face, la sélection de tête n'a pas d'effet (tête unique),
     mais le H demandé est toujours comparé à l'ID des secteurs. */

const CMD = {
  0x02: { name: 'READ TRACK', len: 9 },
  0x03: { name: 'SPECIFY', len: 3 },
  0x04: { name: 'SENSE DRIVE STATUS', len: 2 },
  0x05: { name: 'WRITE DATA', len: 9 },
  0x06: { name: 'READ DATA', len: 9 },
  0x07: { name: 'RECALIBRATE', len: 2 },
  0x08: { name: 'SENSE INTERRUPT STATUS', len: 1 },
  0x09: { name: 'WRITE DELETED DATA', len: 9 },
  0x0A: { name: 'READ ID', len: 2 },
  0x0C: { name: 'READ DELETED DATA', len: 9 },
  0x0D: { name: 'FORMAT TRACK', len: 6 },
  0x0F: { name: 'SEEK', len: 3 },
};

// Registre d'état principal
export const MSR_RQM = 0x80, MSR_DIO = 0x40, MSR_EXM = 0x20, MSR_CB = 0x10;
// Registres d'état ST0 à ST3
const ST0_AT = 0x40, ST0_IC = 0x80, ST0_SE = 0x20, ST0_EC = 0x10, ST0_NR = 0x08;
const ST1_EN = 0x80, ST1_DE = 0x20, ST1_ND = 0x04, ST1_NW = 0x02, ST1_MA = 0x01;
const ST2_CM = 0x40, ST2_DD = 0x20, ST2_WC = 0x10, ST2_BC = 0x02;
const ST3_WP = 0x40, ST3_RY = 0x20, ST3_T0 = 0x10, ST3_TS = 0x08;

const PHASES = { idle: 'repos', command: 'commande', exec: 'exécution', result: 'résultat' };

const sameId = (s, c, h, r, n) => s.C === c && s.H === h && s.R === r && s.N === n;

export class FDC765 {
  constructor() {
    this.drives = [{ disk: null, track: 0, index: 0 }, { disk: null, track: 0, index: 0 }];
    this.onChange = null;
    this.activity = {
      drive: 0, track: [0, 0], side: 0, sector: null, motor: false,
      phase: 'repos', command: null, reading: false, writing: false,
    };
    this.reset();
  }

  reset() {
    this.motor = false;
    this.phase = 'idle';
    this.cmd = [];
    this.cmdLen = 0;
    this.op = 0;
    this.result = [];
    this.resultPos = 0;
    this.exec = null;
    this.pending = [];          // interruptions de fin de recherche : { drive, st0, pcn }
    this.specify = { srt: 0, hut: 0, hlt: 0, nd: true };
    this.lastData = 0xFF;
    this.activity.command = null;
    this.activity.sector = null;
    this._activity();
  }

  /* ---------- Lecteurs ---------- */
  insert(drive, disk) {
    const dr = this.drives[drive & 1];
    dr.disk = disk;
    dr.index = 0;
    this._activity();
  }

  eject(drive) {
    const dr = this.drives[drive & 1];
    const disk = dr.disk;
    dr.disk = null;
    this._activity();
    return disk;
  }

  disk(drive) { return this.drives[drive & 1].disk; }

  setMotor(on) {
    this.motor = typeof on === 'number' ? (on & 1) === 1 : !!on;
    this._activity();
  }

  /* ---------- Ports ---------- */
  readStatus() {
    let msr = MSR_RQM;
    if (this.phase === 'command') msr |= MSR_CB;
    else if (this.phase === 'exec') msr |= MSR_CB | MSR_EXM | (this.exec.read ? MSR_DIO : 0);
    else if (this.phase === 'result') msr |= MSR_CB | MSR_DIO;
    for (const p of this.pending) msr |= 1 << p.drive;
    return msr;
  }

  readData() {
    if (this.phase === 'exec' && this.exec.read) {
      const e = this.exec;
      while (e.mark < e.marks.length && e.marks[e.mark].offset <= e.pos) this.activity.sector = e.marks[e.mark++].R;
      this.lastData = e.data[e.pos++];
      if (e.pos >= e.data.length) this._result(e.res);
    } else if (this.phase === 'result') {
      this.lastData = this.result[this.resultPos++];
      if (this.resultPos >= this.result.length) this._idle();
    }
    return this.lastData;
  }

  writeData(v) {
    v &= 0xFF;
    if (this.phase === 'idle') {
      const op = v & 0x1F;
      const def = CMD[op];
      this.op = op;
      this.cmd = [v];
      if (!def) {
        this.activity.command = 'INVALIDE';
        this._result([ST0_IC]);
        return;
      }
      this.cmdLen = def.len;
      this.activity.command = def.name;
      if (def.len === 1) this._run();
      else this._phase('command');
    } else if (this.phase === 'command') {
      this.cmd.push(v);
      if (this.cmd.length === this.cmdLen) this._run();
    } else if (this.phase === 'exec' && !this.exec.read) {
      if (this.exec.format) this._formatByte(v);
      else this._writeByte(v);
    }
  }

  /* ---------- Phases ---------- */
  _phase(p) {
    this.phase = p;
    this._activity();
  }

  _idle() {
    this.exec = null;
    this._phase('idle');
  }

  _result(bytes) {
    this.exec = null;
    this.result = bytes;
    this.resultPos = 0;
    this._phase('result');
  }

  _activity() {
    const a = this.activity;
    a.track[0] = this.drives[0].track;
    a.track[1] = this.drives[1].track;
    a.motor = this.motor;
    a.phase = PHASES[this.phase];
    a.reading = this.phase === 'exec' && this.exec.read;
    a.writing = this.phase === 'exec' && !this.exec.read;
  }

  _ready(d) { return this.motor && this.drives[d].disk !== null; }

  _side(d, hd) {
    const disk = this.drives[d].disk;
    return disk && disk.sides > 1 ? hd : 0;
  }

  _track(d, hd) {
    const dr = this.drives[d];
    if (!dr.disk) return null;
    const side = dr.disk.tracks[this._side(d, hd)];
    return (side && side[dr.track]) || null;
  }

  _trackCount(d) {
    const disk = this.drives[d].disk;
    if (!disk) return 0;
    return Math.max(0, ...disk.tracks.map(s => (s ? s.length : 0)));
  }

  _interrupt(d, st0, pcn) {
    this.pending = this.pending.filter(p => p.drive !== d);
    this.pending.push({ drive: d, st0, pcn });
  }

  _changed(d) {
    this.drives[d].disk.dirty = true;
    if (this.onChange) this.onChange(d);
  }

  /* ---------- Exécution des commandes ---------- */
  _run() {
    const c = this.cmd;
    const us = c.length > 1 ? c[1] & 3 : 0;
    const hd = c.length > 1 ? (c[1] >> 2) & 1 : 0;
    const d = us & 1;
    if (this.op !== 0x03 && this.op !== 0x08) {
      this.activity.drive = d;
      this.activity.side = hd;
    }
    switch (this.op) {
      case 0x03: // SPECIFY
        this.specify = { srt: c[1] >> 4, hut: c[1] & 0x0F, hlt: c[2] >> 1, nd: (c[2] & 1) === 1 };
        this._idle();
        break;
      case 0x04: this._result([this._st3(d, us, hd)]); break;
      case 0x07: this._recalibrate(d, us); break;
      case 0x08: this._senseInterrupt(); break;
      case 0x0A: this._readId(d, us, hd); break;
      case 0x0F: this._seek(d, us, hd, c[2]); break;
      case 0x0D: this._format(d, us, hd); break;
      case 0x05: case 0x09: this._write(d, us, hd); break;
      default: this._read(d, us, hd); break; // 02, 06, 0C
    }
  }

  _st3(d, us, hd) {
    const dr = this.drives[d];
    let st3 = us | (hd << 2);
    if (this._ready(d)) st3 |= ST3_RY;
    if (dr.track === 0) st3 |= ST3_T0;
    if (dr.disk && dr.disk.sides > 1) st3 |= ST3_TS;
    if (dr.disk && dr.disk.writeProtected) st3 |= ST3_WP;
    return st3;
  }

  _recalibrate(d, us) {
    const dr = this.drives[d];
    let st0 = ST0_SE | us;
    if (this._ready(d)) {
      dr.track = 0;
      dr.index = 0;
    } else st0 |= ST0_AT | ST0_NR;   // lecteur vide : « non prêt » (le capteur de piste 0 marche sans disque, donc pas EC)
    this._interrupt(d, st0, dr.track);
    this._idle();
  }

  _seek(d, us, hd, ncn) {
    const dr = this.drives[d];
    let st0 = ST0_SE | us | (hd << 2);
    if (this._ready(d)) {
      dr.track = Math.min(ncn, this._trackCount(d));
      dr.index = 0;
    } else st0 |= ST0_AT | ST0_NR;
    this._interrupt(d, st0, dr.track);
    this._idle();
  }

  _senseInterrupt() {
    const p = this.pending.shift();
    this._result(p ? [p.st0, p.pcn] : [ST0_IC]);
  }

  _readId(d, us, hd) {
    const base = us | (hd << 2);
    if (!this._ready(d)) return this._result([base | ST0_AT | ST0_NR, 0, 0, 0, 0, 0, 0]);
    const dr = this.drives[d];
    const trk = this._track(d, hd);
    if (!trk || !trk.sectors.length) return this._result([base | ST0_AT, ST1_MA, 0, 0, 0, 0, 0]);
    // Les ID défilent sous la tête : chaque READ ID rend le secteur suivant
    const s = trk.sectors[dr.index % trk.sectors.length];
    dr.index = (dr.index + 1) % trk.sectors.length;
    this.activity.sector = s.R;
    this._result([base, 0, 0, s.C, s.H, s.R, s.N]);
  }

  // Données d'un secteur à la taille demandée, complétées par l'octet de remplissage
  _sectorData(sec, n, dtl, filler) {
    const len = n === 0 ? Math.min(dtl, 0x80) : 0x80 << Math.min(n, 8);
    const out = new Uint8Array(len).fill(filler ?? 0xE5);
    out.set(sec.data.subarray(0, len));
    return out;
  }

  _read(d, us, hd) {
    const [cmd, , C, H, R0, N, EOT, , DTL] = this.cmd;
    const base = us | (hd << 2);
    if (!this._ready(d)) return this._result([base | ST0_AT | ST0_NR, 0, 0, C, H, R0, N]);
    const skip = (cmd & 0x20) !== 0;
    const wantDeleted = this.op === 0x0C;
    const trk = this._track(d, hd);
    const chunks = [], marks = [];
    let st1 = 0, st2 = 0, r = R0, total = 0;

    const take = sec => {
      const isDeleted = (sec.st2 & ST2_CM) !== 0;
      if (isDeleted !== wantDeleted && skip) return false;
      const bytes = this._sectorData(sec, N, DTL, trk.filler);
      marks.push({ offset: total, R: sec.R });
      chunks.push(bytes);
      total += bytes.length;
      st1 |= sec.st1 & ST1_DE;
      st2 |= sec.st2 & ST2_DD;
      if (isDeleted !== wantDeleted) st2 |= ST2_CM;
      // Marque inattendue ou erreur de CRC : arrêt après ce secteur
      return isDeleted !== wantDeleted || (sec.st1 & ST1_DE) !== 0 || (sec.st2 & ST2_DD) !== 0;
    };

    if (!trk || !trk.sectors.length) st1 = ST1_ND | ST1_MA;
    else if (this.op === 0x02) {
      // READ TRACK : secteurs dans l'ordre physique depuis le trou d'index
      let count = 0;
      for (const sec of trk.sectors) {
        if (!sameId(sec, C, H, r, N)) st1 |= ST1_ND;
        const isDeleted = (sec.st2 & ST2_CM) !== 0;
        if (!(isDeleted && skip)) {
          const bytes = this._sectorData(sec, N, DTL, trk.filler);
          marks.push({ offset: total, R: sec.R });
          chunks.push(bytes);
          total += bytes.length;
        }
        if (++count === EOT) break;
        r = (r + 1) & 0xFF;
      }
      st1 |= count === EOT ? ST1_EN : ST1_ND;
    } else {
      for (;;) {
        const sec = trk.sectors.find(s => sameId(s, C, H, r, N));
        if (!sec) {
          st1 |= ST1_ND;
          const other = trk.sectors.find(s => s.R === r && s.C !== C);
          if (other) st2 |= ST2_WC | (other.C === 0xFF ? ST2_BC : 0);
          break;
        }
        if (take(sec)) break;
        if (r === EOT) { st1 |= ST1_EN; break; }
        r = (r + 1) & 0xFF;
      }
    }

    // Sans TC, la commande se termine toujours en fin anormale
    const res = [base | ST0_AT, st1, st2, C, H, r, N];
    if (total === 0) return this._result(res);
    const data = new Uint8Array(total);
    let off = 0;
    for (const ch of chunks) { data.set(ch, off); off += ch.length; }
    this.exec = { read: true, data, pos: 0, marks, mark: 0, res };
    this._phase('exec');
  }

  _write(d, us, hd) {
    const [, , C, H, R0, N, EOT, , DTL] = this.cmd;
    const base = us | (hd << 2);
    if (!this._ready(d)) return this._result([base | ST0_AT | ST0_NR, 0, 0, C, H, R0, N]);
    const disk = this.drives[d].disk;
    if (disk.writeProtected) return this._result([base | ST0_AT, ST1_NW, 0, C, H, R0, N]);
    const trk = this._track(d, hd);
    if (!trk || !trk.sectors.length) return this._result([base | ST0_AT, ST1_ND | ST1_MA, 0, C, H, R0, N]);
    this.exec = { read: false, d, base, trk, C, H, N, EOT, DTL, r: R0, deleted: this.op === 0x09, sec: null, buf: null, pos: 0 };
    this._nextWriteSector();
  }

  _nextWriteSector() {
    const e = this.exec;
    const sec = e.trk.sectors.find(s => sameId(s, e.C, e.H, e.r, e.N));
    if (!sec) {
      const other = e.trk.sectors.find(s => s.R === e.r && s.C !== e.C);
      const st2 = other ? ST2_WC | (other.C === 0xFF ? ST2_BC : 0) : 0;
      return this._result([e.base | ST0_AT, ST1_ND, st2, e.C, e.H, e.r, e.N]);
    }
    e.sec = sec;
    e.buf = new Uint8Array(e.N === 0 ? Math.min(e.DTL, 0x80) : 0x80 << Math.min(e.N, 8));
    e.pos = 0;
    this.activity.sector = sec.R;
    if (this.phase !== 'exec') this._phase('exec');
  }

  _writeByte(v) {
    const e = this.exec;
    e.buf[e.pos++] = v;
    if (e.pos < e.buf.length) return;
    const sec = e.sec;
    if (e.buf.length >= sec.data.length) sec.data = e.buf;
    else {
      const data = sec.data.slice();
      data.set(e.buf);
      sec.data = data;
    }
    sec.st1 &= ~ST1_DE;
    sec.st2 = e.deleted ? (sec.st2 & ~ST2_DD) | ST2_CM : sec.st2 & ~(ST2_DD | ST2_CM);
    this._changed(e.d);
    if (e.r === e.EOT) return this._result([e.base | ST0_AT, ST1_EN, 0, e.C, e.H, e.r, e.N]);
    e.r = (e.r + 1) & 0xFF;
    this._nextWriteSector();
  }

  _format(d, us, hd) {
    const [, , N, SC, GPL, D] = this.cmd;
    const base = us | (hd << 2);
    if (!this._ready(d)) return this._result([base | ST0_AT | ST0_NR, 0, 0, 0, 0, 0, N]);
    if (this.drives[d].disk.writeProtected) return this._result([base | ST0_AT, ST1_NW, 0, 0, 0, 0, N]);
    this.exec = { read: false, format: true, d, hd, base, N, SC, GPL, D, ids: [] };
    if (SC === 0) this._formatDone();
    else this._phase('exec');
  }

  _formatByte(v) {
    const e = this.exec;
    e.ids.push(v);
    if (e.ids.length % 4 === 0) this.activity.sector = e.ids[e.ids.length - 2];
    if (e.ids.length === 4 * e.SC) this._formatDone();
  }

  _formatDone() {
    const e = this.exec;
    const dr = this.drives[e.d];
    const side = this._side(e.d, e.hd);
    const size = 0x80 << Math.min(e.N, 8);
    const sectors = [];
    for (let i = 0; i < e.ids.length; i += 4) {
      sectors.push({ C: e.ids[i], H: e.ids[i + 1], R: e.ids[i + 2], N: e.ids[i + 3], st1: 0, st2: 0, data: new Uint8Array(size).fill(e.D) });
    }
    const disk = dr.disk;
    while (disk.tracks.length <= side) disk.tracks.push([]);
    const tracks = disk.tracks[side];
    while (tracks.length < dr.track) tracks.push(null);
    tracks[dr.track] = { track: dr.track, side, gap3: e.GPL, filler: e.D, sectors };
    dr.index = 0;
    this._changed(e.d);
    const last = sectors.length ? sectors[sectors.length - 1] : { C: 0, H: 0, R: 0, N: e.N };
    this._result([e.base, 0, 0, last.C, last.H, last.R, last.N]);
  }
}
