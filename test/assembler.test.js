import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { assemble, toImage } from '../src/asm/assembler.js';

const hexBytes = arr => [...arr].map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
const allBytes = r => r.segments.flatMap(s => [...s.bytes]);

// Assembles without errors and returns the bytes in hexadecimal.
function asm(src, options) {
  const r = assemble(src, options);
  assert.deepEqual(r.errors, [], `unexpected errors for ${JSON.stringify(src)}`);
  return hexBytes(allBytes(r));
}

// Error messages of a source (with line numbers).
const errorsOf = (src, options) => assemble(src, options).errors;

/* =====================================================================
   Encoding, instruction by instruction (bytes checked by hand)
   ===================================================================== */
const CASES = [
  // 8-bit LD
  ['LD A,(HL)', '7E'],
  ['LD B,C', '41'],
  ['LD H,L', '65'],
  ['LD (HL),A', '77'],
  ['LD (HL),E', '73'],
  ['LD A,5', '3E 05'],
  ['LD (HL),&12', '36 12'],
  ['LD A,(BC)', '0A'],
  ['LD A,(DE)', '1A'],
  ['LD (BC),A', '02'],
  ['LD (DE),A', '12'],
  ['LD A,(&1234)', '3A 34 12'],
  ['LD (&1234),A', '32 34 12'],
  ['LD A,I', 'ED 57'],
  ['LD A,R', 'ED 5F'],
  ['LD I,A', 'ED 47'],
  ['LD R,A', 'ED 4F'],
  // indexed LD
  ['LD (IX+5),3', 'DD 36 05 03'],
  ['LD (IY-2),&FF', 'FD 36 FE FF'],
  ['LD A,(IX+5)', 'DD 7E 05'],
  ['LD A,(IX)', 'DD 7E 00'],
  ['LD (IY-1),B', 'FD 70 FF'],
  ['LD H,(IX+1)', 'DD 66 01'],
  ['LD (IX+2),L', 'DD 75 02'],
  ['LD IXH,5', 'DD 26 05'],
  ['LD IXL,A', 'DD 6F'],
  ['LD A,IYH', 'FD 7C'],
  ['LD IXH,IXL', 'DD 65'],
  ['LD HX,B', 'DD 60'],
  ['LD LY,&10', 'FD 2E 10'],
  // 16-bit LD
  ['LD BC,&1234', '01 34 12'],
  ['LD DE,&1234', '11 34 12'],
  ['LD HL,&1234', '21 34 12'],
  ['LD SP,&FFFF', '31 FF FF'],
  ['LD IX,&4000', 'DD 21 00 40'],
  ['LD IY,&4000', 'FD 21 00 40'],
  ['LD HL,(&1234)', '2A 34 12'],
  ['LD BC,(&1234)', 'ED 4B 34 12'],
  ['LD DE,(&1234)', 'ED 5B 34 12'],
  ['LD SP,(&1234)', 'ED 7B 34 12'],
  ['LD IX,(&1234)', 'DD 2A 34 12'],
  ['LD IY,(&1234)', 'FD 2A 34 12'],
  ['LD (&1234),HL', '22 34 12'],
  ['LD (&1234),BC', 'ED 43 34 12'],
  ['LD (&1234),DE', 'ED 53 34 12'],
  ['LD (&1234),SP', 'ED 73 34 12'],
  ['LD (&1234),IX', 'DD 22 34 12'],
  ['LD (&1234),IY', 'FD 22 34 12'],
  ['LD SP,HL', 'F9'],
  ['LD SP,IX', 'DD F9'],
  ['LD SP,IY', 'FD F9'],
  // exchanges, stack
  ["EX AF,AF'", '08'],
  ['EX DE,HL', 'EB'],
  ['EX (SP),HL', 'E3'],
  ['EX (SP),IX', 'DD E3'],
  ['EX (SP),IY', 'FD E3'],
  ['EXX', 'D9'],
  ['PUSH BC', 'C5'],
  ['PUSH AF', 'F5'],
  ['POP HL', 'E1'],
  ['POP DE', 'D1'],
  ['PUSH IX', 'DD E5'],
  ['POP IY', 'FD E1'],
  // 8-bit ALU
  ['ADD A,B', '80'],
  ['ADD A,(HL)', '86'],
  ['ADD A,5', 'C6 05'],
  ['ADC A,C', '89'],
  ['ADC A,&10', 'CE 10'],
  ['SUB B', '90'],
  ['SUB A,B', '90'],
  ['SUB 5', 'D6 05'],
  ['SBC A,D', '9A'],
  ['SBC A,1', 'DE 01'],
  ['AND E', 'A3'],
  ['AND A,E', 'A3'],
  ['AND &0F', 'E6 0F'],
  ['XOR A', 'AF'],
  ['XOR &FF', 'EE FF'],
  ['OR A', 'B7'],
  ['OR (HL)', 'B6'],
  ['OR 1', 'F6 01'],
  ['CP L', 'BD'],
  ['CP &20', 'FE 20'],
  ['CP (IX+2)', 'DD BE 02'],
  ['ADD A,IXH', 'DD 84'],
  ['ADD A,(IY+3)', 'FD 86 03'],
  ['XOR IYL', 'FD AD'],
  ['SUB (IX-&80)', 'DD 96 80'],
  // INC / DEC
  ['INC A', '3C'],
  ['INC B', '04'],
  ['DEC C', '0D'],
  ['INC (HL)', '34'],
  ['DEC (HL)', '35'],
  ['INC (IX+1)', 'DD 34 01'],
  ['DEC (IY-2)', 'FD 35 FE'],
  ['INC IXH', 'DD 24'],
  ['DEC IYL', 'FD 2D'],
  ['INC BC', '03'],
  ['INC SP', '33'],
  ['DEC DE', '1B'],
  ['DEC HL', '2B'],
  ['INC IX', 'DD 23'],
  ['DEC IY', 'FD 2B'],
  // 16-bit ALU
  ['ADD HL,BC', '09'],
  ['ADD HL,HL', '29'],
  ['ADD HL,SP', '39'],
  ['ADD IX,BC', 'DD 09'],
  ['ADD IX,IX', 'DD 29'],
  ['ADD IY,SP', 'FD 39'],
  ['ADD IY,IY', 'FD 29'],
  ['ADC HL,DE', 'ED 5A'],
  ['ADC HL,HL', 'ED 6A'],
  ['SBC HL,BC', 'ED 42'],
  ['SBC HL,SP', 'ED 72'],
  // CB rotations and shifts
  ['RLC B', 'CB 00'],
  ['RRC C', 'CB 09'],
  ['RL D', 'CB 12'],
  ['RR E', 'CB 1B'],
  ['SLA H', 'CB 24'],
  ['SRA L', 'CB 2D'],
  ['SLL B', 'CB 30'],
  ['SL1 A', 'CB 37'],
  ['SRL A', 'CB 3F'],
  ['RL (HL)', 'CB 16'],
  ['RLC (IX+2)', 'DD CB 02 06'],
  ['RLC (IX+2),B', 'DD CB 02 00'],
  ['SRL (IY-1),A', 'FD CB FF 3F'],
  ['SLL (IX+&02),B', 'DD CB 02 30'],
  // BIT / SET / RES
  ['BIT 0,A', 'CB 47'],
  ['BIT 7,(HL)', 'CB 7E'],
  ['BIT 7,(IY-1)', 'FD CB FF 7E'],
  ['SET 3,B', 'CB D8'],
  ['RES 0,(HL)', 'CB 86'],
  ['SET 1,(IX+0),A', 'DD CB 00 CF'],
  ['RES 7,(IX+4)', 'DD CB 04 BE'],
  ['RES 2,(IY+1),C', 'FD CB 01 91'],
  // absolute jumps, calls, returns
  ['JP &1234', 'C3 34 12'],
  ['JP NZ,&1234', 'C2 34 12'],
  ['JP Z,&1234', 'CA 34 12'],
  ['JP NC,&1234', 'D2 34 12'],
  ['JP C,&1234', 'DA 34 12'],
  ['JP PO,&1234', 'E2 34 12'],
  ['JP PE,&1234', 'EA 34 12'],
  ['JP P,&1234', 'F2 34 12'],
  ['JP M,&1234', 'FA 34 12'],
  ['JP (HL)', 'E9'],
  ['JP (IX)', 'DD E9'],
  ['JP (IY)', 'FD E9'],
  ['CALL &1234', 'CD 34 12'],
  ['CALL NZ,&1234', 'C4 34 12'],
  ['CALL Z,&1234', 'CC 34 12'],
  ['CALL M,&1234', 'FC 34 12'],
  ['RET', 'C9'],
  ['RET NZ', 'C0'],
  ['RET Z', 'C8'],
  ['RET C', 'D8'],
  ['RET M', 'F8'],
  ['RETI', 'ED 4D'],
  ['RETN', 'ED 45'],
  ['RST 0', 'C7'],
  ['RST &08', 'CF'],
  ['RST 1', 'CF'],
  ['RST &38', 'FF'],
  ['RST 38h', 'FF'],
  ['RST 7', 'FF'],
  // relative jumps (origin 0)
  ['JR $', '18 FE'],
  ['JR Z,$', '28 FE'],
  ['JR NC,$+2', '30 00'],
  ['JR C,$+129', '38 7F'],
  ['DJNZ $', '10 FE'],
  // interrupt modes, miscellaneous
  ['IM 0', 'ED 46'],
  ['IM 1', 'ED 56'],
  ['IM 2', 'ED 5E'],
  ['NOP', '00'],
  ['HALT', '76'],
  ['DI', 'F3'],
  ['EI', 'FB'],
  ['DAA', '27'],
  ['CPL', '2F'],
  ['NEG', 'ED 44'],
  ['CCF', '3F'],
  ['SCF', '37'],
  ['RLCA', '07'],
  ['RRCA', '0F'],
  ['RLA', '17'],
  ['RRA', '1F'],
  ['RLD', 'ED 6F'],
  ['RRD', 'ED 67'],
  // block instructions
  ['LDI', 'ED A0'],
  ['LDIR', 'ED B0'],
  ['LDD', 'ED A8'],
  ['LDDR', 'ED B8'],
  ['CPI', 'ED A1'],
  ['CPIR', 'ED B1'],
  ['CPD', 'ED A9'],
  ['CPDR', 'ED B9'],
  ['INI', 'ED A2'],
  ['INIR', 'ED B2'],
  ['IND', 'ED AA'],
  ['INDR', 'ED BA'],
  ['OUTI', 'ED A3'],
  ['OTIR', 'ED B3'],
  ['OUTD', 'ED AB'],
  ['OTDR', 'ED BB'],
  // input / output
  ['IN A,(&FE)', 'DB FE'],
  ['IN B,(C)', 'ED 40'],
  ['IN A,(C)', 'ED 78'],
  ['IN (C)', 'ED 70'],
  ['IN F,(C)', 'ED 70'],
  ['OUT (&FE),A', 'D3 FE'],
  ['OUT (C),A', 'ED 79'],
  ['OUT (C),E', 'ED 59'],
  ['OUT (C),0', 'ED 71'],
];

describe('instruction encoding', () => {
  for (const [src, expected] of CASES) {
    test(src, () => assert.equal(asm('  ' + src), expected));
  }
});

test('mnemonics and registers are case-insensitive', () => {
  assert.equal(asm(' ld a,(hl)'), '7E');
  assert.equal(asm(" ex af,af'"), '08');
  assert.equal(asm(' Bit 7,(iy-1)'), 'FD CB FF 7E');
  assert.equal(asm(' ld ixh,5'), 'DD 26 05');
});

/* =====================================================================
   Rejected combinations
   ===================================================================== */
describe('invalid operands', () => {
  const invalid = [
    'LD (HL),(DE)', 'LD IXH,(IX+1)', 'LD IXH,H', 'LD H,IXL', 'LD IXH,IYL', 'LD IXL,(HL)',
    'LD (IX+1),IXH', 'LD (HL),(HL)', 'LD (IX+1),(HL)', 'LD A,(C)', 'LD BC,DE', 'LD I,B',
    'ADD IX,HL', 'ADD IX,IY', 'ADD HL,IX', 'ADC IX,BC', 'SUB HL,BC', 'ADD B,C',
    'RLC IXH', 'BIT 1,IXL', 'BIT 1,(IX+1),A', 'RLC (HL),B', 'RLC B,C', 'SET 1,(IX+1),(HL)',
    'JP (IX+1)', 'JP (&1234)', 'PUSH SP', 'POP IXH', 'EX BC,DE', 'INC I',
    'IN B,(&FE)', 'OUT (&FE),B', 'IN (HL),(C)', 'NOP A', 'RET 5', 'JR (HL)',
  ];
  for (const src of invalid) {
    test(src, () => {
      const r = assemble('  ' + src);
      assert.equal(r.ok, false);
      assert.equal(r.errors.length, 1);
      assert.match(r.errors[0].message, /^invalid operand for /);
    });
  }

  test('precise message', () => {
    assert.deepEqual(errorsOf(' LD (HL),(DE)'), [{ line: 1, message: 'invalid operand for LD: (HL),(DE)' }]);
    assert.deepEqual(errorsOf(' LD'), [{ line: 1, message: 'missing operand for LD' }]);
  });

  test('JR rejects the conditions PO PE P M', () => {
    assert.deepEqual(errorsOf(' JR PO,0'), [{ line: 1, message: 'condition not allowed with JR: PO' }]);
  });

  test('out-of-domain values', () => {
    assert.match(errorsOf(' RST 3+&10')[0].message, /invalid RST address: &13/);
    assert.match(errorsOf(' IM 3')[0].message, /invalid interrupt mode: 3/);
    assert.match(errorsOf(' BIT 8,A')[0].message, /invalid bit number: 8/);
    assert.match(errorsOf(' OUT (C),1')[0].message, /OUT \(C\),n/);
  });
});

/* =====================================================================
   Numbers and expressions
   ===================================================================== */
describe('numbers', () => {
  const forms = ['255', '&FF', '#FF', '$FF', '0xFF', '0FFh', '0ffH', '%11111111', '0b11111111', '11111111b'];
  for (const f of forms) {
    test(f, () => assert.equal(asm(` DB ${f}`), 'FF'));
  }
  test('characters', () => {
    assert.equal(asm(" DB 'A',\"B\",'A'+1"), '41 42 42');
    assert.equal(asm(" LD A,';'"), '3E 3B');
  });
  test('invalid number', () => {
    assert.deepEqual(errorsOf(' DB 12G'), [{ line: 1, message: 'invalid number: 12G' }]);
  });
});

describe('expressions', () => {
  const value = expr => {
    const r = assemble(`X EQU ${expr}`);
    assert.deepEqual(r.errors, []);
    return r.symbols.X;
  };
  test('usual precedence', () => {
    assert.equal(value('2+3*4'), 14);
    assert.equal(value('(2+3)*4'), 20);
    assert.equal(value('10-4-3'), 3);
    assert.equal(value('100/10/5'), 2);
    assert.equal(value('1<<4|1'), 17);
    assert.equal(value('1+1<<2'), 8);
    assert.equal(value('&F0>>4'), 15);
    assert.equal(value('6^3'), 5);
    assert.equal(value('6&3|8'), 10);
    assert.equal(value('1|2^3&4'), 3);
    assert.equal(value('7%3'), 1);
    assert.equal(value('10/3'), 3);
    assert.equal(value('-2*3'), -6);
    assert.equal(value('-(2+3)'), -5);
    assert.equal(value('~0 & &FF'), 255);
    assert.equal(value('-1&&FF'), 255);
    assert.equal(value('5 % 3'), 2);
    assert.equal(value('%101 % 3'), 2);
  });
  test('division by zero', () => {
    assert.match(errorsOf('X EQU 1/0')[0].message, /division by zero/);
  });
  test('parentheses: indirection only if they enclose the whole operand', () => {
    assert.equal(asm(' LD A,(1+2)*3'), '3E 09');
    assert.equal(asm(' LD A,(1+2)'), '3A 03 00');
    assert.equal(asm(' LD HL,(2)+(3)'), '21 05 00');
    assert.equal(asm(' LD HL,((2)+(3))'), '2A 05 00');
    assert.equal(asm('v EQU &10\n LD A,(v+1)'), '3A 11 00');
    assert.equal(asm(' LD (IX+2*3-1),A'), 'DD 77 05');
  });
  test('$ = address of the current instruction', () => {
    assert.equal(asm(' ORG &4000\n DW $,$+2\n JP $'), '00 40 02 40 C3 04 40');
  });
});

/* =====================================================================
   Labels, symbols, directives
   ===================================================================== */
describe('labels and symbols', () => {
  test('label in column 0 without colon, indented label with colon', () => {
    const r = assemble('start LD A,1\n   here: NOP\ndone:');
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.symbols, { START: 0, HERE: 2, DONE: 3 });
  });
  test('mnemonic in column 0 without label', () => {
    assert.equal(asm('LD A,5\nNOP\nDB 1'), '3E 05 00 01');
  });
  test('EQU, = and upper-case symbols', () => {
    const r = assemble('Screen EQU &C000\n  size = 16*1024\ndone: equ Screen+size-1');
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.symbols, { SCREEN: 0xC000, SIZE: 16384, DONE: 0xFFFF });
  });
  test('forward references', () => {
    assert.equal(asm(' JP done\n JR done\n LD HL,data\ndone: RET\ndata: DB 1'), 'C3 08 00 18 03 21 09 00 C9 01');
  });
  test('EQU depending on a symbol defined later', () => {
    const r = assemble('A1 EQU B1+1\n LD A,A1\nB1 EQU 5');
    assert.deepEqual(r.errors, []);
    assert.equal(hexBytes(allBytes(r)), '3E 06');
  });
  test('ORG depending on a forward reference', () => {
    const r = assemble(' ORG base\n NOP\nbase EQU &8000');
    assert.deepEqual(r.errors, []);
    assert.equal(r.segments[0].start, 0x8000);
  });
  test('labels starting with a dot or an underscore', () => {
    const r = assemble('.loop: DJNZ .loop\n_x: JR _x');
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.symbols, { '.LOOP': 0, _X: 2 });
  });
  test('reserved name', () => {
    assert.match(errorsOf('HL: NOP')[0].message, /reserved name/);
  });
});

describe('directives', () => {
  test('DB with strings and expressions', () => {
    assert.equal(asm(' DB "AB",0,\'c\',"x;y",1+2'), '41 42 00 63 78 3B 79 03');
    assert.equal(asm(' DEFM "Hi"\n DM "!"\n DEFB 1'), '48 69 21 01');
  });
  test('DB: negative value and overflow warning', () => {
    const r = assemble(' DB -1,300');
    assert.equal(r.ok, true);
    assert.equal(hexBytes(allBytes(r)), 'FF 2C');
    assert.equal(r.warnings.length, 1);
    assert.equal(r.warnings[0].line, 1);
    assert.match(r.warnings[0].message, /byte: 300/);
  });
  test('DW / DEFW', () => {
    assert.equal(asm(' DW &1234,5\n DEFW -1'), '34 12 05 00 FF FF');
  });
  test('DS / DEFS', () => {
    assert.equal(asm(' DS 3\n DEFS 2,&AA\n NOP'), '00 00 00 AA AA 00');
    const r = assemble(' ORG &100\n DS 4\nhere:');
    assert.equal(r.symbols.HERE, 0x104);
  });
  test('ALIGN', () => {
    const r = assemble(' ORG &4001\n DB 1\n ALIGN 4\nhere: NOP\n ALIGN 4,&FF\n ALIGN 4\n NOP');
    assert.deepEqual(r.errors, []);
    assert.equal(r.symbols.HERE, 0x4004);
    assert.equal(hexBytes(allBytes(r)), '01 00 00 00 FF FF FF 00');
  });
  test('multiple ORGs: separate segments in emission order', () => {
    const r = assemble(' ORG &8000\n NOP\n NOP\n ORG &4000\n RET\n ORG &8002\n HALT');
    assert.deepEqual(r.segments.map(s => [s.start, hexBytes(s.bytes)]), [[0x8000, '00 00'], [0x4000, 'C9'], [0x8002, '76']]);
  });
  test('options.origin', () => {
    const r = assemble('here: JR here', { origin: 0x9000 });
    assert.equal(r.symbols.HERE, 0x9000);
    assert.equal(r.segments[0].start, 0x9000);
  });
  test('END with an address: entry', () => {
    const r = assemble(' ORG &4000\n NOP\ngo: RET\n END go\n this is ignored');
    assert.deepEqual(r.errors, []);
    assert.equal(r.entry, 0x4001);
    assert.equal(r.listing[4].addr, null);
    assert.deepEqual(r.listing[4].bytes, []);
  });
  test('default entry: first byte emitted, otherwise null', () => {
    assert.equal(assemble(' ORG &5000\n NOP').entry, 0x5000);
    assert.equal(assemble('X EQU 1').entry, null);
    assert.equal(assemble('').entry, null);
  });
  test('INCLUDE via options.include', () => {
    const files = { 'consts.asm': 'BORDER EQU &BC38\n', 'code.asm': ' CALL BORDER\n RET' };
    const r = assemble(' INCLUDE "consts.asm"\n ORG &4000\n LD B,1\n INCLUDE "code.asm"\n NOP', { include: n => files[n] });
    assert.deepEqual(r.errors, []);
    assert.equal(hexBytes(allBytes(r)), '06 01 CD 38 BC C9 00');
    assert.equal(r.listing.length, 5);
    assert.equal(r.listing[3].addr, 0x4002);
    assert.deepEqual(r.listing[3].bytes, [0xCD, 0x38, 0xBC, 0xC9]);
  });
  test('INCLUDE: error in the included file reported on the INCLUDE line', () => {
    const r = assemble(' NOP\n INCLUDE "a.asm"', { include: () => ' NOP\n LD A,FOO' });
    assert.deepEqual(r.errors, [{ line: 2, message: 'a.asm, line 2: unknown symbol: FOO' }]);
  });
  test('INCLUDE without options.include', () => {
    const r = assemble(' INCLUDE "x.asm"');
    assert.equal(r.ok, false);
    assert.match(r.errors[0].message, /INCLUDE failed/);
  });
});

/* =====================================================================
   Errors
   ===================================================================== */
describe('errors', () => {
  test('unknown symbol with line number', () => {
    assert.deepEqual(errorsOf(' NOP\n\n LD A,FOO'), [{ line: 3, message: 'unknown symbol: FOO' }]);
  });
  test('JR out of range', () => {
    assert.deepEqual(errorsOf('back: DS 128\n JR back'), [{ line: 2, message: 'relative jump out of range (-130)' }]);
    assert.deepEqual(errorsOf(' JR done\n DS 128\ndone:'), [{ line: 1, message: 'relative jump out of range (128)' }]);
    assert.equal(asm(' JR done\n DS 127\ndone:').slice(0, 5), '18 7F');
  });
  test('JR to an unknown symbol: a single error', () => {
    assert.deepEqual(errorsOf(' JR nowhere'), [{ line: 1, message: 'unknown symbol: NOWHERE' }]);
  });
  test('duplicate label', () => {
    assert.deepEqual(errorsOf('x: NOP\ny: NOP\nX: NOP'), [{ line: 3, message: 'symbol already defined: X' }]);
  });
  test('index displacement out of range', () => {
    assert.deepEqual(errorsOf(' LD A,(IX+128)'), [{ line: 1, message: 'displacement out of range (128)' }]);
    assert.deepEqual(errorsOf(' LD A,(IY-129)'), [{ line: 1, message: 'displacement out of range (-129)' }]);
    assert.equal(asm(' LD A,(IX-128)\n LD A,(IX+127)'), 'DD 7E 80 DD 7E 7F');
  });
  test('unknown instruction', () => {
    assert.deepEqual(errorsOf(' FOO A'), [{ line: 1, message: 'unknown instruction: FOO' }]);
  });
  test('several errors reported, each on its own line', () => {
    const r = assemble(' LD A,FOO\n NOP\n LD (HL),(DE)\nx: NOP\nx: NOP\n BLA\n JR $+200\n DB "abc');
    assert.deepEqual(r.errors.map(e => e.line), [1, 3, 5, 6, 7, 8]);
    assert.equal(r.ok, false);
    // the correct lines are still assembled
    assert.deepEqual(r.listing[1].bytes, [0x00]);
  });
  test('byte warning, not an error', () => {
    const r = assemble(' LD A,256');
    assert.equal(r.ok, true);
    assert.equal(r.warnings.length, 1);
    assert.equal(hexBytes(allBytes(r)), '3E 00');
  });
  test('register in an expression', () => {
    assert.match(errorsOf(' LD A,(HL+1)')[0].message, /unexpected register/);
  });
  test('going past &FFFF', () => {
    const r = assemble(' ORG &FFFF\n LD HL,0');
    assert.equal(r.ok, false);
    assert.match(r.errors[0].message, /goes past/);
  });
});

/* =====================================================================
   Listing, memory image
   ===================================================================== */
describe('listing', () => {
  test('one entry per source line', () => {
    const src = '; comment\n ORG &4000\nstart: LD A,1 ; load\n\ndone:\n DB 1,2';
    const r = assemble(src);
    assert.equal(r.listing.length, 6);
    assert.deepEqual(r.listing.map(l => l.line), [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(r.listing[0], { line: 1, addr: null, bytes: [], source: '; comment' });
    assert.deepEqual(r.listing[2], { line: 3, addr: 0x4000, bytes: [0x3E, 0x01], source: 'start: LD A,1 ; load' });
    assert.equal(r.listing[3].addr, null);
    assert.equal(r.listing[4].addr, 0x4002);
    assert.deepEqual(r.listing[5].bytes, [1, 2]);
  });
  test('CRLF line endings', () => {
    const r = assemble(' NOP\r\n HALT\r\n');
    assert.deepEqual(r.errors, []);
    assert.equal(r.listing[1].source, ' HALT');
  });
});

test('toImage', () => {
  const r = assemble(' ORG &10\n DB 1,2\n ORG &FFFF\n DB 3');
  const img = toImage(r);
  assert.equal(img.length, 0x10000);
  assert.equal(img[0x10], 1);
  assert.equal(img[0x11], 2);
  assert.equal(img[0xFFFF], 3);
  assert.equal(img[0], 0);
  assert.equal(toImage(r, 0x100).length, 0x100);
});

/* =====================================================================
   Disassembler format
   ===================================================================== */
test('accepts the format produced by the disassembler', () => {
  const src = [
    'LD (IX+&05),&03',
    'LD A,(IX-&01)',
    'BIT 7,(IY-&01)',
    'JR &4003',
    'DJNZ &4000',
    "EX AF,AF'",
    'IN F,(C)',
    'OUT (C),0',
    'SLL (IX+&02),B',
    'LD IXH,&05',
    'LD (&1234),HL',
    'DB &ED,&77',
    'RST &38',
  ].join('\n');
  assert.equal(asm(src, { origin: 0x4000 }),
    'DD 36 05 03 DD 7E FF FD CB FF 7E 18 F6 10 F1 08 ED 70 ED 71 DD CB 02 30 DD 26 05 22 34 12 ED 77 FF');
});

/* =====================================================================
   Demo program
   ===================================================================== */
test('demo program hello.asm: 41 bytes', () => {
  const src = `TXT_OUTPUT      EQU  &BB5A
SCR_SET_BORDER  EQU  &BC38
                ORG  &4000
start:          LD   HL,message
loop:           LD   A,(HL)
                OR   A
                JR   Z,border
                CALL TXT_OUTPUT
                INC  HL
                JR   loop
border:         LD   B,6
                LD   C,B
                CALL SCR_SET_BORDER
                LD   A,7
                CALL TXT_OUTPUT
                RET
message:        DB   "Hello, world!",13,10,0
                END  start`;
  const r = assemble(src);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.segments.length, 1);
  assert.equal(r.segments[0].start, 0x4000);
  const ascii = [...'Hello, world!'].map(c => c.charCodeAt(0));
  const expected = [
    0x21, 0x19, 0x40, 0x7E, 0xB7, 0x28, 0x06, 0xCD, 0x5A, 0xBB, 0x23, 0x18, 0xF6,
    0x06, 0x06, 0x48, 0xCD, 0x38, 0xBC, 0x3E, 0x07, 0xCD, 0x5A, 0xBB, 0xC9,
    ...ascii, 0x0D, 0x0A, 0x00,
  ];
  assert.equal(expected.length, 41);
  assert.deepEqual([...r.segments[0].bytes], expected);
  assert.equal(r.entry, 0x4000);
  assert.deepEqual(r.symbols, {
    TXT_OUTPUT: 0xBB5A, SCR_SET_BORDER: 0xBC38, START: 0x4000,
    LOOP: 0x4003, BORDER: 0x400D, MESSAGE: 0x4019,
  });
  assert.equal(r.listing.length, 18);
  assert.deepEqual(r.listing[6], { line: 7, addr: 0x4005, bytes: [0x28, 0x06], source: '                JR   Z,border' });
});
