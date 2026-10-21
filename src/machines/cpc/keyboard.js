/* Clavier du CPC : matrice de 10 lignes × 8 colonnes, lue par le PSG (port A)
   après sélection de la ligne par le PPI (port C, bits 0–3). Un bit à 0 = touche enfoncée. */

// [ligne, bit] de chaque touche (nom affiché sur le clavier du CPC 6128, disposition anglaise)
export const KEYS = {
  'CUR_UP': [0, 0], 'CUR_RIGHT': [0, 1], 'CUR_DOWN': [0, 2], 'F9': [0, 3], 'F6': [0, 4], 'F3': [0, 5], 'ENTER': [0, 6], 'F.': [0, 7],
  'CUR_LEFT': [1, 0], 'COPY': [1, 1], 'F7': [1, 2], 'F8': [1, 3], 'F5': [1, 4], 'F1': [1, 5], 'F2': [1, 6], 'F0': [1, 7],
  'CLR': [2, 0], '[': [2, 1], 'RETURN': [2, 2], ']': [2, 3], 'F4': [2, 4], 'SHIFT': [2, 5], '\\': [2, 6], 'CONTROL': [2, 7],
  '^': [3, 0], '-': [3, 1], '@': [3, 2], 'P': [3, 3], ';': [3, 4], ':': [3, 5], '/': [3, 6], '.': [3, 7],
  '0': [4, 0], '9': [4, 1], 'O': [4, 2], 'I': [4, 3], 'L': [4, 4], 'K': [4, 5], 'M': [4, 6], ',': [4, 7],
  '8': [5, 0], '7': [5, 1], 'U': [5, 2], 'Y': [5, 3], 'H': [5, 4], 'J': [5, 5], 'N': [5, 6], 'SPACE': [5, 7],
  '6': [6, 0], '5': [6, 1], 'R': [6, 2], 'T': [6, 3], 'G': [6, 4], 'F': [6, 5], 'B': [6, 6], 'V': [6, 7],
  '4': [7, 0], '3': [7, 1], 'E': [7, 2], 'W': [7, 3], 'S': [7, 4], 'D': [7, 5], 'C': [7, 6], 'X': [7, 7],
  '1': [8, 0], '2': [8, 1], 'ESC': [8, 2], 'Q': [8, 3], 'TAB': [8, 4], 'A': [8, 5], 'CAPS': [8, 6], 'Z': [8, 7],
  'JOY_UP': [9, 0], 'JOY_DOWN': [9, 1], 'JOY_LEFT': [9, 2], 'JOY_RIGHT': [9, 3], 'JOY_FIRE2': [9, 4], 'JOY_FIRE1': [9, 5], 'DEL': [9, 7],
};

// caractère → [touche, avec SHIFT] (clavier anglais du CPC 6128)
export const CHAR_KEYS = (() => {
  const m = {};
  for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') { m[c.toLowerCase()] = [c, false]; m[c] = [c, true]; }
  for (const c of '0123456789-^@[];:,./\\') m[c] = [c, false];
  const shifted = { '!': '1', '"': '2', '#': '3', '$': '4', '%': '5', '&': '6', "'": '7', '(': '8', ')': '9', '_': '0',
    '=': '-', '£': '^', '|': '@', '{': '[', '}': ']', '+': ';', '*': ':', '<': ',', '>': '.', '?': '/', '`': '\\' };
  for (const [c, k] of Object.entries(shifted)) m[c] = [k, true];
  m[' '] = ['SPACE', false];
  m['\n'] = ['RETURN', false]; m['\r'] = ['RETURN', false];
  return m;
})();

export class Keyboard {
  constructor() {
    this.matrix = new Uint8Array(10).fill(0xFF);
    this.charKeys = CHAR_KEYS; // remplacée par la table tirée de la ROM (voir keymap.js)
    this.queue = [];          // frappe automatique : [touche, avec SHIFT]
    this.autoState = null;
  }
  reset() { this.matrix.fill(0xFF); this.queue = []; this.autoState = null; }
  set(key, down) {
    const k = KEYS[key];
    if (!k) return;
    if (down) this.matrix[k[0]] &= ~(1 << k[1]);
    else this.matrix[k[0]] |= 1 << k[1];
  }
  readLine(line) { return line < 10 ? this.matrix[line] : 0xFF; }
  isDown(key) { const k = KEYS[key]; return !!k && !(this.matrix[k[0]] & (1 << k[1])); }

  // tape un texte (frappe automatique, collage) ; retourne le nombre de caractères ignorés
  type(text) {
    let skipped = 0;
    for (const ch of text.replace(/\r\n?/g, '\r').replace(/\n/g, '\r').replace(/\t/g, ' ')) {
      const k = this.charKeys[ch];
      if (k) this.queue.push(k); else skipped++;
    }
    return skipped;
  }
  // appelée à chaque trame (50 Hz)
  // touche maintenue 2 trames puis relâchée 1 trame ; si la suivante est la même touche, le relâchement
  // dure 3 trames : le firmware doit voir la touche relevée pour accepter une nouvelle frappe
  frame() {
    const s = this.autoState;
    if (s) {
      s.n--;
      if (s.n > 0) return;
      if (s.down) {
        this.set(s.key, false); if (s.shift) this.set('SHIFT', false);
        s.down = false; s.n = this.queue[0]?.[0] === s.key ? 3 : 1;
        return;
      }
      this.autoState = null;
    }
    const k = this.queue.shift();
    if (!k) return;
    if (k.pause) { this.autoState = { key: null, down: false, n: k.pause }; return; }
    this.autoState = { key: k[0], shift: k[1], down: true, n: 2 };
    if (k[1]) this.set('SHIFT', true);
    this.set(k[0], true);
  }
  // trames sans aucune touche avant la frappe suivante (laisse le firmware voir Ctrl/Shift relâchés)
  pause(frames) { this.queue.push({ pause: frames }); }
  get typing() { return !!this.autoState || this.queue.length > 0; }
}
