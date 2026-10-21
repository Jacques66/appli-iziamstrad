/* Générateur de son General Instrument AY-3-8912 (PSG) tel que monté sur l'Amstrad CPC 6128.
   Horloge 1 MHz (Z80 à 4 MHz). Le PSG n'est pas sur le bus du CPU : son bus de données
   est relié au port A du PPI 8255, BDIR/BC1 aux bits 7/6 du port C. Le port d'E/S A
   (registre 14) lit les colonnes du clavier.

   Modélisation : le circuit avance par pas de 8 périodes d'horloge (125 kHz sur le CPC).
   - tonalité : compteur incrémenté à chaque pas, bascule quand il atteint TP → clock / (16 × TP) ;
   - bruit : LFSR 17 bits (rétroaction bits 0 et 3) décalé tous les 2 × NP pas → clock / (16 × NP) ;
   - enveloppe : un pas tous les 2 × EP pas (16 × EP horloges), 16 niveaux → cycle de 256 × EP horloges.
   Les écritures horodatées (T-states CPU) sont appliquées à leur instant pendant render().
   Chaque échantillon audio est la moyenne exacte du signal sur sa durée, puis un passe-haut
   du premier ordre retire la composante continue. */

// Masques des registres R0–R15
export const REG_MASK = new Uint8Array([
  0xFF, 0x0F, 0xFF, 0x0F, 0xFF, 0x0F, 0x1F, 0xFF, 0x1F, 0x1F, 0x1F, 0xFF, 0xFF, 0x0F, 0xFF, 0xFF,
]);

// Table de volume logarithmique de l'AY (niveaux mesurés, ~3 dB par pas, 0 = silence)
export const VOLUME = new Float64Array([
  0.0, 0.00999, 0.01445, 0.02106, 0.03070, 0.04555, 0.06450, 0.10736,
  0.12659, 0.20499, 0.29221, 0.37284, 0.49253, 0.63532, 0.80558, 1.0,
]);

const B_GAIN = 0.5;                       // voix B mélangée à moitié sur chaque côté
const NORM = 1 / (1 + B_GAIN);            // trois voix au maximum → 1 sur chaque côté
const HPF_CUTOFF = 16;                    // Hz, passe-haut de retrait du continu
const MAX_PENDING = 65536;

export class AY38912 {
  constructor({ clock = 1_000_000, cpuClock = 4_000_000 } = {}) {
    this.name = 'AY-3-8912';
    this.clock = clock;
    this.cpuClock = cpuClock;
    this.tickT = 8 * cpuClock / clock;    // durée d'un pas interne, en T-states CPU
    this.regs = new Uint8Array(16);
    this.portAInput = () => 0xFF;
    this.reset();
  }

  reset() {
    this.regs.fill(0);
    this.selected = 0;
    // État côté audio (registres appliqués à leur instant)
    this.ar = new Uint8Array(16);
    this.pending = [];
    this.toneCount = [0, 0, 0];
    this.toneOut = [0, 0, 0];
    this.noiseCount = 0;
    this.noiseHalf = 0;
    this.lfsr = 1;
    this.envCount = 0;
    this.envStep = 15;
    this.envAttack = 0;
    this.envHold = false;
    this.time = 0;                        // instant audio courant (T-states)
    this.nextTick = this.tickT;
    this.outL = 0;
    this.outR = 0;
    this.rate = 0;
    this.sampleBase = 0;
    this.sampleIndex = 0;
    this.accL = 0;
    this.accR = 0;
    this.lpL = 0;
    this.lpR = 0;
  }

  /* ---------- Bus (câblage CPC : PPI port A = données, port C bits 7/6 = BDIR/BC1) ---------- */
  bus(bdir, bc1, data, t) {
    if (bdir && bc1) { this.selected = data & 0x0F; return undefined; }
    if (bdir) { this.writeRegister(this.selected, data, t); return undefined; }
    if (bc1) return this.readRegister(this.selected);
    return undefined;
  }

  writeRegister(r, v, t) {
    r &= 0x0F;
    v &= REG_MASK[r];
    this.regs[r] = v;
    const last = this.pending.length ? this.pending[this.pending.length - 1].t : -Infinity;
    const when = t === undefined ? Math.max(last, this.time) : Math.max(last, t);
    this.pending.push({ t: when, r, v });
    if (this.pending.length > MAX_PENDING) this.applyWrite(this.pending.shift());
  }

  readRegister(r) {
    r &= 0x0F;
    if (r === 14 && !(this.regs[7] & 0x40)) return this.portAInput() & 0xFF;
    return this.regs[r];
  }

  // Niveau courant de l'enveloppe (0–15), côté audio
  get envLevel() { return this.envStep ^ this.envAttack; }

  /* ---------- Côté audio ---------- */
  applyWrite({ r, v }) {
    this.ar[r] = v;
    if (r === 13) {
      this.envCount = 0;
      this.envStep = 15;
      this.envAttack = v & 0x04 ? 15 : 0;
      this.envHold = false;
    }
  }

  stepEnvelope() {
    if (this.envHold) return;
    if (--this.envStep >= 0) return;
    const shape = this.ar[13];
    if (!(shape & 0x08)) {                // CONT = 0 : retombe à 0 et y reste
      this.envAttack = 0; this.envStep = 0; this.envHold = true;
    } else if (shape & 0x01) {            // HOLD : reste sur le dernier niveau (inversé si ALT)
      if (shape & 0x02) this.envAttack ^= 15;
      this.envStep = 0; this.envHold = true;
    } else {                              // répétition, en alternant le sens si ALT
      if (shape & 0x02) this.envAttack ^= 15;
      this.envStep = 15;
    }
  }

  tick() {
    const ar = this.ar;
    for (let c = 0; c < 3; c++) {
      const tp = (ar[2 * c] | (ar[2 * c + 1] << 8)) || 1;
      if (++this.toneCount[c] >= tp) { this.toneCount[c] = 0; this.toneOut[c] ^= 1; }
    }
    this.noiseHalf ^= 1;
    if (this.noiseHalf && ++this.noiseCount >= (ar[6] || 1)) {
      this.noiseCount = 0;
      const fb = (this.lfsr ^ (this.lfsr >> 3)) & 1;
      this.lfsr = (this.lfsr >> 1) | (fb << 16);
    }
    const ep = (ar[11] | (ar[12] << 8)) || 1;
    if (++this.envCount >= 2 * ep) { this.envCount = 0; this.stepEnvelope(); }
  }

  updateOutput() {
    const ar = this.ar, mix = ar[7], noise = this.lfsr & 1, env = this.envLevel;
    const amp = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      const tone = this.toneOut[c] | ((mix >> c) & 1);
      const nz = noise | ((mix >> (c + 3)) & 1);
      if (tone & nz) amp[c] = VOLUME[ar[8 + c] & 0x10 ? env : ar[8 + c] & 0x0F];
    }
    this.outL = (amp[0] + B_GAIN * amp[1]) * NORM;
    this.outR = (amp[2] + B_GAIN * amp[1]) * NORM;
  }

  render(fromT, toT, sampleRate) {
    const spS = this.cpuClock / sampleRate;
    if (sampleRate !== this.rate || fromT !== this.time) {
      // discontinuité : on repart de fromT en gardant les phases internes
      this.nextTick += fromT - this.time;
      this.time = fromT;
      this.rate = sampleRate;
      this.sampleBase = fromT;
      this.sampleIndex = 0;
      this.accL = 0; this.accR = 0;
    }
    const n = Math.max(0, Math.floor((toT - this.sampleBase) / spS) - this.sampleIndex);
    const left = new Float32Array(n), right = new Float32Array(n);
    if (toT <= fromT) return { left, right };
    const k = 1 - Math.exp(-2 * Math.PI * HPF_CUTOFF / sampleRate);
    const emit = () => {
      const xl = this.accL / spS, xr = this.accR / spS;
      this.lpL += k * (xl - this.lpL); this.lpR += k * (xr - this.lpR);
      left[done] = xl - this.lpL; right[done] = xr - this.lpR;
      this.accL = 0; this.accR = 0;
      this.sampleIndex++; done++;
    };
    let done = 0, t = this.time;
    this.updateOutput();
    for (;;) {
      const evT = this.pending.length ? Math.max(this.pending[0].t, t) : Infinity;
      const sEnd = done < n ? this.sampleBase + (this.sampleIndex + 1) * spS : Infinity;
      const next = Math.min(this.nextTick, sEnd, evT, toT);
      if (next > t) {
        const d = next - t;
        this.accL += this.outL * d; this.accR += this.outR * d;
        t = next;
      }
      if (evT <= t && evT < toT) {
        while (this.pending.length && this.pending[0].t <= t) this.applyWrite(this.pending.shift());
        this.updateOutput();
      } else if (sEnd <= t) {
        emit();
      } else if (this.nextTick <= t && this.nextTick < toT) {
        this.tick();
        this.nextTick += this.tickT;
        this.updateOutput();
      } else break;
    }
    while (done < n) emit();              // arrondi flottant sur le dernier échantillon
    this.time = toT;
    return { left, right };
  }

  /* ---------- Interface ---------- */
  levels() {
    const r = this.regs;
    const voices = [0, 1, 2].map(c => {
      const env = !!(r[8 + c] & 0x10);
      return {
        freq: this.clock / (16 * ((r[2 * c] | (r[2 * c + 1] << 8)) || 1)),
        volume: env ? this.envLevel : r[8 + c] & 0x0F,
        tone: !(r[7] & (1 << c)),
        noise: !(r[7] & (8 << c)),
        env,
      };
    });
    const ep = r[11] | (r[12] << 8);
    return {
      voices,
      noiseFreq: this.clock / (16 * (r[6] || 1)),
      envShape: r[13],
      envPeriod: ep,
      envFreq: this.clock / (256 * (ep || 1)),
    };
  }
}
