/* CRTC HD6845S (type 0) : compteurs de balayage, adresse vidéo MA/RA, synchros.
   tick() avance d'un caractère (1 µs sur le CPC, soit 4 T-states du Z80). */

const MASK = [0xFF, 0xFF, 0xFF, 0xFF, 0x7F, 0x1F, 0x7F, 0x7F, 0x03, 0x1F, 0x7F, 0x1F, 0x3F, 0xFF, 0x3F, 0xFF, 0x3F, 0xFF];

export class CRTC6845 {
  constructor() {
    this.onHsyncStart = null;   // callbacks branchés par le Gate Array
    this.onHsyncEnd = null;
    this.onVsyncStart = null;
    this.onVsyncEnd = null;
    this.reset();
  }

  reset() {
    this.regs = new Uint8Array(18);
    // valeurs programmées par le firmware du CPC (50 Hz)
    [63, 40, 46, 0x8E, 38, 0, 25, 30, 0, 7, 0, 0, 0x30, 0x00, 0, 0, 0, 0].forEach((v, i) => { this.regs[i] = v; });
    this.selected = 0;
    this.hcc = 0;       // compteur horizontal (caractères)
    this.vcc = 0;       // compteur de rangées de caractères
    this.vlc = 0;       // ligne dans la rangée (RA)
    this.rowStart = 0;  // MA du début de la rangée
    this.hsync = false; this.hsyncCount = 0;
    this.vsync = false; this.vsyncCount = 0;
    this.adjust = false; this.adjustCount = 0;
    this.frame = 0;
    this.newFrame();
  }

  select(v) { this.selected = v & 0x1F; }
  write(v) {
    const r = this.selected;
    if (r < 16) this.regs[r] = v & MASK[r];
  }
  read() {
    const r = this.selected;
    return r >= 14 && r <= 17 ? this.regs[r] : 0;   // type 0 : seuls R14–R17 sont lisibles
  }

  get ma() { return (this.rowStart + this.hcc) & 0x3FFF; }
  get displayEnabled() { return this.hcc < this.regs[1] && this.vcc < this.regs[6] && !this.adjust; }
  // adresse physique (64 Ko de base) des deux octets affichés pendant ce caractère
  get videoAddress() {
    const ma = this.ma;
    return ((ma & 0x3000) << 2) | ((this.vlc & 7) << 11) | ((ma & 0x3FF) << 1);
  }

  newFrame() {
    this.vcc = 0; this.vlc = 0; this.adjust = false;
    this.rowStart = ((this.regs[12] << 8) | this.regs[13]) & 0x3FFF;
    this.frame++;
  }

  tick() {
    const R = this.regs;
    if (this.hsync) {
      this.hsyncCount++;
      const w = R[3] & 0x0F;
      if (this.hsyncCount >= (w || 16)) { this.hsync = false; this.onHsyncEnd?.(); }
    }
    this.hcc = (this.hcc + 1) & 0xFF;
    if (this.hcc > R[0]) { this.hcc = 0; this.newLine(); }
    if (this.hcc === R[2] && !this.hsync && (R[3] & 0x0F)) {
      this.hsync = true; this.hsyncCount = 0; this.onHsyncStart?.();
    }
  }

  newLine() {
    const R = this.regs;
    if (this.vsync) {
      this.vsyncCount++;
      if (this.vsyncCount >= ((R[3] >> 4) || 16)) { this.vsync = false; this.onVsyncEnd?.(); }
    }
    if (this.adjust) {
      this.adjustCount++;
      if (this.adjustCount >= R[5]) this.newFrame();
    } else {
      this.vlc = (this.vlc + 1) & 0x1F;
      if (this.vlc > R[9]) {
        this.vlc = 0;
        this.rowStart = (this.rowStart + R[1]) & 0x3FFF;
        this.vcc = (this.vcc + 1) & 0x7F;
        if (this.vcc > R[4]) {
          if (R[5]) { this.adjust = true; this.adjustCount = 0; this.vcc = R[4] + 1; }
          else this.newFrame();
        }
      }
    }
    if (!this.vsync && !this.adjust && this.vcc === R[7] && this.vlc === 0) {
      this.vsync = true; this.vsyncCount = 0; this.onVsyncStart?.();
    }
  }
}
