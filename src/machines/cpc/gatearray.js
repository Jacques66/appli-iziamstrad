/* Gate Array 40010 : palette, mode écran, sélection des ROM, compteur d'interruptions,
   et génération de l'image (2 octets de RAM vidéo par µs → 16 pixels). */

// numéro de couleur matérielle → couleur firmware (0–26)
const HW_TO_FW = [13, 13, 19, 25, 1, 7, 10, 16, 7, 25, 24, 26, 6, 8, 15, 17, 1, 19, 18, 20, 0, 2, 9, 11, 4, 22, 21, 23, 3, 5, 12, 14];
const LEVEL = [0x00, 0x6E, 0xFF];
// couleur firmware n = 9·vert + 3·rouge + bleu, chaque composante sur 3 niveaux
export const FW_RGB = [...Array(27)].map((_, n) => [LEVEL[Math.floor(n / 3) % 3], LEVEL[Math.floor(n / 9)], LEVEL[n % 3]]);
export const HW_RGB = HW_TO_FW.map(f => FW_RGB[f]);
export const hwToFirmware = hw => HW_TO_FW[hw & 31];
const GREEN = FW_RGB.map(([r, g, b]) => { const y = Math.round(0.3 * r + 0.59 * g + 0.11 * b); return [Math.round(y * 0.25), y, Math.round(y * 0.35)]; });

// décodage des octets vidéo : 8 « points » de largeur mode 2 par octet
const DECODE = [0, 1, 2].map(mode => {
  const t = new Uint8Array(256 * 8);
  for (let b = 0; b < 256; b++) {
    for (let p = 0; p < 8; p++) {
      let ink;
      if (mode === 2) ink = (b >> (7 - p)) & 1;
      else if (mode === 1) { const q = p >> 1; ink = ((b >> (7 - q)) & 1) | (((b >> (3 - q)) & 1) << 1); }
      else {
        const q = p >> 2;
        ink = q === 0 ? ((b >> 7) & 1) | (((b >> 3) & 1) << 1) | (((b >> 5) & 1) << 2) | (((b >> 1) & 1) << 3)
          : ((b >> 6) & 1) | (((b >> 2) & 1) << 1) | (((b >> 4) & 1) << 2) | ((b & 1) << 3);
      }
      t[b * 8 + p] = ink;
    }
  }
  return t;
});

// zone visible du moniteur, en caractères (µs) et en lignes, comptées depuis les synchros
export const SCREEN_W = 768, SCREEN_H = 272;
const VIS_X0 = 14, VIS_Y0 = 36;

export class GateArray {
  constructor(crtc) {
    this.crtc = crtc;
    this.pixels = new Uint32Array(SCREEN_W * SCREEN_H);   // ABGR (ImageData)
    this.monochrome = false;
    this.onInterrupt = null;
    this.onFrame = null;
    crtc.onHsyncStart = () => this.hsyncStart();
    crtc.onHsyncEnd = () => this.hsyncEnd();
    crtc.onVsyncStart = () => this.vsyncStart();
    this.reset();
  }

  reset() {
    this.pen = 0;
    this.inks = new Uint8Array(17).fill(0x14);   // noir
    this.mode = 1; this.pendingMode = 1;
    this.lowerRom = true; this.upperRom = true;
    this.ramConfig = 0;
    this.intCounter = 0;
    this.intRequest = false;
    this.vsyncDelay = 0;
    this.beamX = 0; this.beamY = 0;
    this.buildPalette();
  }

  buildPalette() {
    const pal = this.monochrome ? HW_TO_FW.map(f => GREEN[f]) : HW_RGB;
    this.rgba = pal.map(([r, g, b]) => (0xFF << 24) | (b << 16) | (g << 8) | r);
  }

  // écriture sur le port &7Fxx (le PAL 40030 traite la fonction 3 : configuration RAM)
  write(v) {
    switch (v >> 6) {
      case 0: this.pen = v & 0x10 ? 16 : v & 0x0F; break;
      case 1: this.inks[this.pen] = v & 0x1F; break;
      case 2:
        this.pendingMode = v & 3;
        this.lowerRom = !(v & 0x04);
        this.upperRom = !(v & 0x08);
        if (v & 0x10) { this.intCounter = 0; this.intRequest = false; }
        break;
      case 3: this.ramConfig = v & 0x3F; break;
    }
  }

  // acquittement de l'interruption par le Z80 : le bit 5 du compteur est effacé
  intAck() {
    this.intRequest = false;
    this.intCounter &= 0x1F;
  }

  hsyncStart() {
    this.beamX = 0;
    this.beamY++;
  }
  hsyncEnd() {
    this.mode = this.pendingMode;
    this.intCounter++;
    if (this.vsyncDelay > 0 && --this.vsyncDelay === 0) {
      if (this.intCounter >= 32) this.intRequest = true;
      this.intCounter = 0;
    }
    if (this.intCounter >= 52) { this.intCounter = 0; this.intRequest = true; }
  }
  vsyncStart() {
    this.vsyncDelay = 2;
    this.beamY = 0;
    this.onFrame?.();
  }

  // un caractère (1 µs) : 16 pixels de largeur mode 2 à la position du faisceau
  render(ram) {
    const c = this.crtc;
    const x = this.beamX - VIS_X0, y = this.beamY - VIS_Y0;
    this.beamX++;
    if (x < 0 || x >= SCREEN_W / 16 || y < 0 || y >= SCREEN_H) return;
    const px = this.pixels, o = y * SCREEN_W + x * 16;
    if (c.hsync || c.vsync) { px.fill(0xFF000000, o, o + 16); return; }
    if (!c.displayEnabled) { px.fill(this.rgba[this.inks[16]], o, o + 16); return; }
    const a = c.videoAddress, t = DECODE[this.mode], inks = this.inks, rgba = this.rgba;
    const b0 = ram[a] * 8, b1 = ram[(a + 1) & 0xFFFF] * 8;
    for (let p = 0; p < 8; p++) px[o + p] = rgba[inks[t[b0 + p]]];
    for (let p = 0; p < 8; p++) px[o + 8 + p] = rgba[inks[t[b1 + p]]];
  }
}
