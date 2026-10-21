// Régénère les chargeurs BASIC des exemples : node tools/make-examples.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { basLoader } from './bas-loader.mjs';

export const SPLIT_OPTIONS = {
  title: 'Ecran partage : MODE 0 en haut, MODE 1 en bas (interruptions)',
  before: ['MODE 1:BORDER 1:INK 0,1:INK 1,24:INK 2,20:INK 3,6',
    'INK 4,2:INK 5,3:INK 6,8:INK 7,9:INK 8,11:INK 9,13:INK 10,15:INK 11,16:INK 12,18:INK 13,21:INK 14,25:INK 15,26'],
  after: ['LOCATE 1,14:PRINT "En haut : MODE 0, 16 couleurs."', 'PRINT "En bas : MODE 1, texte lisible."',
    'PRINT "Le Gate Array change de mode deux fois"', 'PRINT "par trame, sur ses interruptions."', 'PRINT:PRINT "CALL &8003 pour arreter."'],
  call: [0x8000],
};
const dir = new URL('../exemples/', import.meta.url);
const bas = basLoader(readFileSync(new URL('ecran-partage.asm', dir), 'utf8'), SPLIT_OPTIONS);
writeFileSync(new URL('ecran-partage.bas', dir), bas.text.replace(/\n/g, '\r\n'));
console.log(bas.text);

const bas2 = basLoader(readFileSync(new URL('mode0-mode2.asm', dir), 'utf8'), {
  title: 'Ecran partage MODE 0 / MODE 2 en pur assembleur (interruption en &0038)',
  after: ['PRINT "ESPACE pour revenir au BASIC"'],
  call: [0x8000],
});
writeFileSync(new URL('mode0-mode2.bas', dir), bas2.text.replace(/\n/g, '\r\n'));
console.log(bas2.text.split('\n').length, 'lignes pour mode0-mode2.bas');
