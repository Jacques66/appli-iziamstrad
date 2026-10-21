// Regenerates the BASIC loaders of the examples: node tools/make-examples.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { basLoader } from './bas-loader.mjs';

export const SPLIT_OPTIONS = {
  title: 'Split screen: MODE 0 at the top, MODE 1 at the bottom (interrupts)',
  before: ['MODE 1:BORDER 1:INK 0,1:INK 1,24:INK 2,20:INK 3,6',
    'INK 4,2:INK 5,3:INK 6,8:INK 7,9:INK 8,11:INK 9,13:INK 10,15:INK 11,16:INK 12,18:INK 13,21:INK 14,25:INK 15,26'],
  after: ['LOCATE 1,14:PRINT "Top: MODE 0, 16 colors."', 'PRINT "Bottom: MODE 1, readable text."',
    'PRINT "The Gate Array switches mode twice"', 'PRINT "per frame, on its interrupts."', 'PRINT:PRINT "CALL &8003 to stop."'],
  call: [0x8000],
};
const dir = new URL('../examples/', import.meta.url);
const bas = basLoader(readFileSync(new URL('split-screen.asm', dir), 'utf8'), SPLIT_OPTIONS);
writeFileSync(new URL('split-screen.bas', dir), bas.text.replace(/\n/g, '\r\n'));
console.log(bas.text);

const bas2 = basLoader(readFileSync(new URL('mode0-mode2.asm', dir), 'utf8'), {
  title: 'MODE 0 / MODE 2 split screen in pure assembly (interrupt at &0038)',
  after: ['PRINT "SPACE to return to BASIC"'],
  call: [0x8000],
});
writeFileSync(new URL('mode0-mode2.bas', dir), bas2.text.replace(/\n/g, '\r\n'));
console.log(bas2.text.split('\n').length, 'lines in mode0-mode2.bas');
