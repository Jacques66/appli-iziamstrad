/* Clavier selon la ROM : le firmware traduit chaque touche de la matrice (ligne × 8 + bit)
   avec trois tables de 80 codes (normal, SHIFT, CONTROL) placées en &1EEF dans l'OS 6128.
   La version française y place l'AZERTY et remplace quelques glyphes de la police par des accents. */
import { KEYS } from './keyboard.js';

export const KEY_TABLE = 0x1EEF;
// caractères nationaux : code CPC → caractère Unicode
export const NATIONAL = {
  uk: { 0x5E: '^', 0xA3: '£', 0xA4: '©' },
  fr: { 0x40: 'à', 0x5C: 'ç', 0x5E: '^', 0x7B: 'é', 0x7C: 'ù', 0x7D: 'è', 0xA2: '°', 0xA3: '£', 0xA4: '©' },
};
const NAME_OF = Object.fromEntries(Object.entries(KEYS).map(([n, [l, b]]) => [l * 8 + b, n]));

export function buildKeymap(os, charset) {
  const normal = os.subarray(KEY_TABLE, KEY_TABLE + 80), shift = os.subarray(KEY_TABLE + 80, KEY_TABLE + 160);
  const toChar = c => charset[c] ?? (c >= 0x20 && c < 0x7F ? String.fromCharCode(c) : null);
  const charKeys = {}, labels = {};
  for (const [table, sh] of [[normal, false], [shift, true]]) {
    for (let i = 0; i < 72; i++) {   // la ligne 9 (joystick) produit aussi des codes : on l'écarte
      const name = NAME_OF[i], ch = toChar(table[i]);
      if (!name || !ch || ch === ' ') continue;
      if (!(ch in charKeys)) charKeys[ch] = [name, sh];
    }
  }
  // sur une ROM nationale, le caractère ASCII remplacé reste tapable : | donne le code &7C
  // (affiché ù sur le CPC français), ce qui permet d'écrire les commandes RSX comme |CPM
  for (const code of Object.keys(charset)) {
    const ascii = String.fromCharCode(code), national = charset[code];
    if (!(ascii in charKeys) && charKeys[national]) charKeys[ascii] = charKeys[national];
  }
  charKeys[' '] = ['SPACE', false];
  charKeys['\n'] = ['RETURN', false]; charKeys['\r'] = ['RETURN', false];
  for (let i = 0; i < 80; i++) {
    const name = NAME_OF[i], n = toChar(normal[i]), s = toChar(shift[i]);
    if (!name || !n || n === ' ') continue;
    labels[name] = /^[a-z]$/.test(n) ? { main: n.toUpperCase() } : { main: n, shift: s && s !== n ? s : null };
  }
  return { charKeys, labels, toChar };
}
