/* General Instrument AY-3-8912 sound generator (PSG) as fitted in the Amstrad CPC 6128.
   1 MHz clock (Z80 at 4 MHz). The PSG is not on the CPU bus: its data bus
   is wired to port A of the PPI 8255, BDIR/BC1 to bits 7/6 of port C. I/O port A
   (register 14) reads the keyboard columns.

   Model: the chip advances in steps of 8 clock periods (125 kHz on the CPC).
   - tone: counter incremented on each step, toggles when it reaches TP → clock / (16 × TP);
   - noise: 17-bit LFSR (feedback from bits 0 and 3) shifted every 2 × NP steps → clock / (16 × NP);
   - envelope: one step every 2 × EP steps (16 × EP clocks), 16 levels → cycle of 256 × EP clocks.
   Timestamped writes (CPU T-states) are applied at their instant during render().
   Each audio sample is the exact average of the signal over its duration, then a
   first-order high-pass filter removes the DC component. */

// Register masks R0–R15
export const REG_MASK = new Uint8Array([
  0xFF, 0x0F, 0xFF, 0x0F, 0xFF, 0x0F, 0x1F, 0xFF, 0x1F, 0x1F, 0x1F, 0xFF, 0xFF, 0x0F, 0xFF, 0xFF,
]);

// AY logarithmic volume table (measured levels, ~3 dB per step, 0 = silence)
export const VOLUME = new Float64Array([
  0.0, 0.00999, 0.01445, 0.02106, 0.03070, 0.04555, 0.06450, 0.10736,
  0.12659, 0.20499, 0.29221, 0.37284, 0.49253, 0.63532, 0.80558, 1.0,
]);

const B_GAIN = 0.5;                       // channel B mixed at half level on each side
const NORM = 1 / (1 + B_GAIN);            // three channels at maximum → 1 on each side
const HPF_CUTOFF = 16;                    // Hz, DC-removal high-pass
const MAX_PENDING = 65536;

export class AY38912 {
  constructor({ clock = 1_000_000, cpuClock = 4_000_000 } = {}) {
    this.name = 'AY-3-8912';
    this.clock = clock;
    this.cpuClock = cpuClock;
    this.tickT = 8 * cpuClock / clock;    // duration of an internal step, in CPU T-states
    this.regs = new Uint8Array(16);
    this.portAInput = () => 0xFF;
    this.reset();
  }

  reset() {
    this.regs.fill(0);
    this.selected = 0;
    // Audio-side state (registers applied at their instant)
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
    this.time = 0;                        // current audio time (T-states)
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

  /* ---------- Bus (CPC wiring: PPI port A = data, port C bits 7/6 = BDIR/BC1) ---------- */
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

  // Current envelope level (0–15), audio side
  get envLevel() { return this.envStep ^ this.envAttack; }

  /* ---------- Audio side ---------- */
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
    if (!(shape & 0x08)) {                // CONT = 0: falls to 0 and stays there
      this.envAttack = 0; this.envStep = 0; this.envHold = true;
    } else if (shape & 0x01) {            // HOLD: stays on the last level (inverted if ALT)
      if (shape & 0x02) this.envAttack ^= 15;
      this.envStep = 0; this.envHold = true;
    } else {                              // repeat, alternating direction if ALT
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
      // discontinuity: restart from fromT keeping the internal phases
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
    while (done < n) emit();              // floating-point rounding on the last sample
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
