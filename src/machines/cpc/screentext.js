/* Reads the text shown on the CPC screen by comparing each 8×8 cell with the font
   of the system ROM (&3800). Works in all three modes, for single-ink text. */

export function screenText(m) {
  const crtc = m.crtc, R = crtc.regs, mode = m.ga.mode;
  const font = m.os.subarray(0x3800, 0x4000);
  const glyphs = new Map();
  for (let c = 32; c < 256; c++) {
    const key = [...font.subarray(c * 8, c * 8 + 8)].join(',');
    if (!glyphs.has(key)) glyphs.set(key, c);
  }
  const charBytes = mode === 2 ? 1 : mode === 1 ? 2 : 4;      // bytes per 8-pixel character
  const cols = (R[1] * 2) / charBytes, rows = R[6];
  const base = ((R[12] << 8) | R[13]) & 0x3FFF;
  const pixel = (b, p) => {
    if (mode === 2) return (b >> (7 - p)) & 1;
    if (mode === 1) return ((b >> (7 - p)) | (b >> (3 - p))) & 1;
    return p ? (b & 0x55) : (b & 0xAA);
  };
  const ppb = mode === 2 ? 8 : mode === 1 ? 4 : 2;
  const lines = [];
  for (let r = 0; r < rows; r++) {
    let s = '';
    for (let c = 0; c < cols; c++) {
      const rowBits = [];
      for (let l = 0; l < 8; l++) {
        let bits = 0;
        for (let x = 0; x < 8; x++) {
          const byteIdx = c * charBytes + Math.floor(x / ppb);
          const ma = base + r * R[1] + (byteIdx >> 1);
          const addr = ((ma & 0x3000) << 2) | (l << 11) | ((ma & 0x3FF) << 1) | (byteIdx & 1);
          if (pixel(m.ram[addr & 0xFFFF], x % ppb)) bits |= 0x80 >> x;
        }
        rowBits.push(bits);
      }
      const ch = glyphs.get(rowBits.join(','));
      s += ch == null ? '?' : m.charset?.[ch] ?? String.fromCharCode(ch);
    }
    lines.push(s.replace(/\s+$/, ''));
  }
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines;
}
