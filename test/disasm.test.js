/* Z80 Studio — disassembler tests.
   Each case: bytes, expected text, T-states, and options (address, length
   if it differs from the number of bytes given, target, flow type). */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { disassemble, disassembleRange } from '../src/z80/disasm.js';

const parse = s => s.trim().split(/\s+/).map(h => parseInt(h, 16));

function memory(bytes, at = 0) {
  const mem = new Uint8Array(0x10000);
  bytes.forEach((b, i) => { mem[(at + i) & 0xFFFF] = b; });
  return a => mem[a];
}

function check([hexBytes, text, tstates, opts = {}]) {
  const bytes = parse(hexBytes);
  const at = opts.addr ?? 0x4000;
  const d = disassemble(memory(bytes, at), at);
  const length = opts.len ?? bytes.length;
  const label = `${hexBytes} -> ${text}`;
  assert.equal(d.text, text, label);
  assert.equal(d.length, length, label);
  assert.deepEqual(d.bytes, bytes.slice(0, length), label);
  assert.deepEqual(d.tstates, tstates, label);
  assert.equal(d.addr, at, label);
  if ('target' in opts) assert.equal(d.target, opts.target, label);
  if ('flow' in opts) assert.equal(d.flow, opts.flow, label);
  // mnemonic and operands consistent with the text
  const rebuilt = d.operands.length ? `${d.mnemonic} ${d.operands.join(',')}` : d.mnemonic;
  assert.equal(rebuilt, d.text, label);
}

function suite(name, cases) {
  describe(name, () => {
    for (const c of cases) test(`${c[0]} -> ${c[1]}`, () => check(c));
  });
}

suite('unprefixed table', [
  ['00', 'NOP', 4, { target: null, flow: null }],
  ['01 34 12', 'LD BC,&1234', 10],
  ['02', 'LD (BC),A', 7],
  ['03', 'INC BC', 6],
  ['04', 'INC B', 4],
  ['05', 'DEC B', 4],
  ['06 05', 'LD B,&05', 7],
  ['07', 'RLCA', 4],
  ['08', "EX AF,AF'", 4],
  ['09', 'ADD HL,BC', 11],
  ['0A', 'LD A,(BC)', 7],
  ['0B', 'DEC BC', 6],
  ['0E FF', 'LD C,&FF', 7],
  ['0F', 'RRCA', 4],
  ['10 FE', 'DJNZ &4000', [13, 8], { target: 0x4000, flow: 'cond-jump' }],
  ['11 00 C0', 'LD DE,&C000', 10],
  ['12', 'LD (DE),A', 7],
  ['17', 'RLA', 4],
  ['18 00', 'JR &4002', 12, { target: 0x4002, flow: 'jump' }],
  ['18 80', 'JR &3F82', 12, { target: 0x3F82 }],
  ['18 7F', 'JR &4081', 12, { target: 0x4081 }],
  ['18 00', 'JR &0000', 12, { addr: 0xFFFE, target: 0x0000 }],
  ['19', 'ADD HL,DE', 11],
  ['1A', 'LD A,(DE)', 7],
  ['1F', 'RRA', 4],
  ['20 05', 'JR NZ,&0107', [12, 7], { addr: 0x0100, target: 0x0107, flow: 'cond-jump' }],
  ['21 19 40', 'LD HL,&4019', 10],
  ['22 00 C0', 'LD (&C000),HL', 16],
  ['23', 'INC HL', 6],
  ['24', 'INC H', 4],
  ['26 12', 'LD H,&12', 7],
  ['27', 'DAA', 4],
  ['28 06', 'JR Z,&4008', [12, 7], { target: 0x4008 }],
  ['29', 'ADD HL,HL', 11],
  ['2A 34 12', 'LD HL,(&1234)', 16],
  ['2D', 'DEC L', 4],
  ['2F', 'CPL', 4],
  ['30 FE', 'JR NC,&4000', [12, 7], { target: 0x4000 }],
  ['31 00 C0', 'LD SP,&C000', 10],
  ['32 00 80', 'LD (&8000),A', 13],
  ['33', 'INC SP', 6],
  ['34', 'INC (HL)', 11],
  ['35', 'DEC (HL)', 11],
  ['36 FF', 'LD (HL),&FF', 10],
  ['37', 'SCF', 4],
  ['38 FC', 'JR C,&3FFE', [12, 7], { target: 0x3FFE }],
  ['39', 'ADD HL,SP', 11],
  ['3A 00 80', 'LD A,(&8000)', 13],
  ['3B', 'DEC SP', 6],
  ['3C', 'INC A', 4],
  ['3E 07', 'LD A,&07', 7],
  ['3F', 'CCF', 4],
  ['40', 'LD B,B', 4],
  ['41', 'LD B,C', 4],
  ['46', 'LD B,(HL)', 7],
  ['48', 'LD C,B', 4],
  ['54', 'LD D,H', 4],
  ['5D', 'LD E,L', 4],
  ['66', 'LD H,(HL)', 7],
  ['6F', 'LD L,A', 4],
  ['70', 'LD (HL),B', 7],
  ['75', 'LD (HL),L', 7],
  ['76', 'HALT', 4, { target: null, flow: 'halt' }],
  ['77', 'LD (HL),A', 7],
  ['7E', 'LD A,(HL)', 7],
  ['7F', 'LD A,A', 4],
  ['80', 'ADD A,B', 4],
  ['85', 'ADD A,L', 4],
  ['86', 'ADD A,(HL)', 7],
  ['88', 'ADC A,B', 4],
  ['8F', 'ADC A,A', 4],
  ['90', 'SUB B', 4],
  ['96', 'SUB (HL)', 7],
  ['98', 'SBC A,B', 4],
  ['9E', 'SBC A,(HL)', 7],
  ['A0', 'AND B', 4],
  ['A6', 'AND (HL)', 7],
  ['AF', 'XOR A', 4],
  ['B0', 'OR B', 4],
  ['B7', 'OR A', 4],
  ['B8', 'CP B', 4],
  ['BE', 'CP (HL)', 7],
  ['C0', 'RET NZ', [11, 5], { target: null, flow: 'cond-ret' }],
  ['C1', 'POP BC', 10],
  ['C2 00 40', 'JP NZ,&4000', 10, { target: 0x4000, flow: 'cond-jump' }],
  ['C3 34 12', 'JP &1234', 10, { target: 0x1234, flow: 'jump' }],
  ['C4 5A BB', 'CALL NZ,&BB5A', [17, 10], { target: 0xBB5A, flow: 'cond-call' }],
  ['C5', 'PUSH BC', 11],
  ['C6 10', 'ADD A,&10', 7],
  ['C7', 'RST &00', 11, { target: 0x00, flow: 'rst' }],
  ['C8', 'RET Z', [11, 5]],
  ['C9', 'RET', 10, { target: null, flow: 'ret' }],
  ['CA 00 40', 'JP Z,&4000', 10],
  ['CC 00 40', 'CALL Z,&4000', [17, 10]],
  ['CD 5A BB', 'CALL &BB5A', 17, { target: 0xBB5A, flow: 'call' }],
  ['CE 01', 'ADC A,&01', 7],
  ['CF', 'RST &08', 11, { target: 0x08 }],
  ['D0', 'RET NC', [11, 5]],
  ['D1', 'POP DE', 10],
  ['D2 00 40', 'JP NC,&4000', 10],
  ['D3 FE', 'OUT (&FE),A', 11],
  ['D4 00 40', 'CALL NC,&4000', [17, 10]],
  ['D5', 'PUSH DE', 11],
  ['D6 01', 'SUB &01', 7],
  ['D7', 'RST &10', 11, { target: 0x10 }],
  ['D8', 'RET C', [11, 5]],
  ['D9', 'EXX', 4],
  ['DA 00 40', 'JP C,&4000', 10],
  ['DB FE', 'IN A,(&FE)', 11],
  ['DC 00 40', 'CALL C,&4000', [17, 10]],
  ['DE 01', 'SBC A,&01', 7],
  ['DF', 'RST &18', 11, { target: 0x18 }],
  ['E0', 'RET PO', [11, 5]],
  ['E1', 'POP HL', 10],
  ['E2 00 40', 'JP PO,&4000', 10],
  ['E3', 'EX (SP),HL', 19],
  ['E4 00 40', 'CALL PO,&4000', [17, 10]],
  ['E5', 'PUSH HL', 11],
  ['E6 0F', 'AND &0F', 7],
  ['E7', 'RST &20', 11, { target: 0x20 }],
  ['E8', 'RET PE', [11, 5]],
  ['E9', 'JP (HL)', 4, { target: null, flow: 'jump' }],
  ['EA 00 40', 'JP PE,&4000', 10],
  ['EB', 'EX DE,HL', 4],
  ['EC 00 40', 'CALL PE,&4000', [17, 10]],
  ['EE 80', 'XOR &80', 7],
  ['EF', 'RST &28', 11, { target: 0x28 }],
  ['F0', 'RET P', [11, 5]],
  ['F1', 'POP AF', 10],
  ['F2 00 40', 'JP P,&4000', 10],
  ['F3', 'DI', 4],
  ['F4 00 40', 'CALL P,&4000', [17, 10]],
  ['F5', 'PUSH AF', 11],
  ['F6 01', 'OR &01', 7],
  ['F7', 'RST &30', 11, { target: 0x30 }],
  ['F8', 'RET M', [11, 5]],
  ['F9', 'LD SP,HL', 6],
  ['FA 00 40', 'JP M,&4000', 10, { target: 0x4000, flow: 'cond-jump' }],
  ['FB', 'EI', 4],
  ['FC 00 40', 'CALL M,&4000', [17, 10]],
  ['FE 0D', 'CP &0D', 7],
  ['FF', 'RST &38', 11, { target: 0x38, flow: 'rst' }],
]);

suite('CB table', [
  ['CB 00', 'RLC B', 8],
  ['CB 06', 'RLC (HL)', 15],
  ['CB 07', 'RLC A', 8],
  ['CB 09', 'RRC C', 8],
  ['CB 0E', 'RRC (HL)', 15],
  ['CB 12', 'RL D', 8],
  ['CB 16', 'RL (HL)', 15],
  ['CB 1B', 'RR E', 8],
  ['CB 1E', 'RR (HL)', 15],
  ['CB 24', 'SLA H', 8],
  ['CB 26', 'SLA (HL)', 15],
  ['CB 2D', 'SRA L', 8],
  ['CB 2E', 'SRA (HL)', 15],
  ['CB 30', 'SLL B', 8],
  ['CB 36', 'SLL (HL)', 15],
  ['CB 37', 'SLL A', 8],
  ['CB 38', 'SRL B', 8],
  ['CB 3E', 'SRL (HL)', 15],
  ['CB 3F', 'SRL A', 8],
  ['CB 40', 'BIT 0,B', 8],
  ['CB 46', 'BIT 0,(HL)', 12],
  ['CB 4F', 'BIT 1,A', 8],
  ['CB 7C', 'BIT 7,H', 8],
  ['CB 7E', 'BIT 7,(HL)', 12],
  ['CB 80', 'RES 0,B', 8],
  ['CB 86', 'RES 0,(HL)', 15],
  ['CB 8F', 'RES 1,A', 8],
  ['CB BE', 'RES 7,(HL)', 15],
  ['CB C0', 'SET 0,B', 8],
  ['CB C6', 'SET 0,(HL)', 15],
  ['CB D9', 'SET 3,C', 8],
  ['CB FE', 'SET 7,(HL)', 15],
  ['CB FF', 'SET 7,A', 8, { target: null, flow: null }],
]);

suite('ED table', [
  ['ED 40', 'IN B,(C)', 12],
  ['ED 48', 'IN C,(C)', 12],
  ['ED 70', 'IN F,(C)', 12],
  ['ED 78', 'IN A,(C)', 12],
  ['ED 41', 'OUT (C),B', 12],
  ['ED 69', 'OUT (C),L', 12],
  ['ED 71', 'OUT (C),0', 12],
  ['ED 79', 'OUT (C),A', 12],
  ['ED 42', 'SBC HL,BC', 15],
  ['ED 52', 'SBC HL,DE', 15],
  ['ED 62', 'SBC HL,HL', 15],
  ['ED 72', 'SBC HL,SP', 15],
  ['ED 4A', 'ADC HL,BC', 15],
  ['ED 7A', 'ADC HL,SP', 15],
  ['ED 43 34 12', 'LD (&1234),BC', 20],
  ['ED 4B 34 12', 'LD BC,(&1234)', 20],
  ['ED 53 00 C0', 'LD (&C000),DE', 20],
  ['ED 5B 00 C0', 'LD DE,(&C000)', 20],
  ['ED 63 34 12', 'LD (&1234),HL', 20],
  ['ED 6B 34 12', 'LD HL,(&1234)', 20],
  ['ED 73 34 12', 'LD (&1234),SP', 20],
  ['ED 7B 34 12', 'LD SP,(&1234)', 20],
  ['ED 44', 'NEG', 8],
  ['ED 4C', 'NEG', 8],
  ['ED 54', 'NEG', 8],
  ['ED 5C', 'NEG', 8],
  ['ED 64', 'NEG', 8],
  ['ED 6C', 'NEG', 8],
  ['ED 74', 'NEG', 8],
  ['ED 7C', 'NEG', 8],
  ['ED 45', 'RETN', 14, { target: null, flow: 'ret' }],
  ['ED 4D', 'RETI', 14, { target: null, flow: 'ret' }],
  ['ED 55', 'RETN', 14],
  ['ED 5D', 'RETN', 14],
  ['ED 65', 'RETN', 14],
  ['ED 6D', 'RETN', 14],
  ['ED 75', 'RETN', 14],
  ['ED 7D', 'RETN', 14, { flow: 'ret' }],
  ['ED 46', 'IM 0', 8],
  ['ED 4E', 'IM 0', 8],
  ['ED 56', 'IM 1', 8],
  ['ED 5E', 'IM 2', 8],
  ['ED 66', 'IM 0', 8],
  ['ED 6E', 'IM 0', 8],
  ['ED 76', 'IM 1', 8, { flow: null }],
  ['ED 7E', 'IM 2', 8],
  ['ED 47', 'LD I,A', 9],
  ['ED 4F', 'LD R,A', 9],
  ['ED 57', 'LD A,I', 9],
  ['ED 5F', 'LD A,R', 9],
  ['ED 67', 'RRD', 18],
  ['ED 6F', 'RLD', 18],
  ['ED A0', 'LDI', 16],
  ['ED A1', 'CPI', 16],
  ['ED A2', 'INI', 16],
  ['ED A3', 'OUTI', 16],
  ['ED A8', 'LDD', 16],
  ['ED A9', 'CPD', 16],
  ['ED AA', 'IND', 16],
  ['ED AB', 'OUTD', 16],
  ['ED B0', 'LDIR', [21, 16]],
  ['ED B1', 'CPIR', [21, 16]],
  ['ED B2', 'INIR', [21, 16]],
  ['ED B3', 'OTIR', [21, 16]],
  ['ED B8', 'LDDR', [21, 16]],
  ['ED B9', 'CPDR', [21, 16]],
  ['ED BA', 'INDR', [21, 16]],
  ['ED BB', 'OTDR', [21, 16], { flow: null }],
  // undefined opcodes: two data bytes
  ['ED 77 00', 'DB &ED,&77', 8, { len: 2 }],
  ['ED 7F 00', 'DB &ED,&7F', 8, { len: 2 }],
  ['ED 00 00', 'DB &ED,&00', 8, { len: 2 }],
  ['ED 3F 00', 'DB &ED,&3F', 8, { len: 2 }],
  ['ED 80 00', 'DB &ED,&80', 8, { len: 2 }],
  ['ED A4 00', 'DB &ED,&A4', 8, { len: 2 }],
  ['ED BF 00', 'DB &ED,&BF', 8, { len: 2 }],
  ['ED C0 00', 'DB &ED,&C0', 8, { len: 2 }],
  ['ED ED 00', 'DB &ED,&ED', 8, { len: 2 }],
  ['ED FF 00', 'DB &ED,&FF', 8, { len: 2, target: null, flow: null }],
]);

suite('DD table', [
  ['DD 09', 'ADD IX,BC', 15],
  ['DD 19', 'ADD IX,DE', 15],
  ['DD 29', 'ADD IX,IX', 15],
  ['DD 39', 'ADD IX,SP', 15],
  ['DD 21 34 12', 'LD IX,&1234', 14],
  ['DD 22 34 12', 'LD (&1234),IX', 20],
  ['DD 2A 34 12', 'LD IX,(&1234)', 20],
  ['DD 23', 'INC IX', 10],
  ['DD 2B', 'DEC IX', 10],
  ['DD 24', 'INC IXH', 8],
  ['DD 25', 'DEC IXH', 8],
  ['DD 2C', 'INC IXL', 8],
  ['DD 2D', 'DEC IXL', 8],
  ['DD 26 05', 'LD IXH,&05', 11],
  ['DD 2E 05', 'LD IXL,&05', 11],
  ['DD 34 05', 'INC (IX+&05)', 23],
  ['DD 35 FF', 'DEC (IX-&01)', 23],
  ['DD 36 02 AA', 'LD (IX+&02),&AA', 19],
  ['DD 36 80 00', 'LD (IX-&80),&00', 19],
  ['DD 44', 'LD B,IXH', 8],
  ['DD 45', 'LD B,IXL', 8],
  ['DD 46 00', 'LD B,(IX+&00)', 19],
  ['DD 4E 03', 'LD C,(IX+&03)', 19],
  ['DD 60', 'LD IXH,B', 8],
  ['DD 64', 'LD IXH,IXH', 8],
  ['DD 65', 'LD IXH,IXL', 8],
  ['DD 66 01', 'LD H,(IX+&01)', 19],
  ['DD 67', 'LD IXH,A', 8],
  ['DD 6C', 'LD IXL,IXH', 8],
  ['DD 6E 80', 'LD L,(IX-&80)', 19],
  ['DD 6F', 'LD IXL,A', 8],
  ['DD 70 05', 'LD (IX+&05),B', 19],
  ['DD 74 7F', 'LD (IX+&7F),H', 19],
  ['DD 75 00', 'LD (IX+&00),L', 19],
  ['DD 77 FE', 'LD (IX-&02),A', 19],
  ['DD 7C', 'LD A,IXH', 8],
  ['DD 7D', 'LD A,IXL', 8],
  ['DD 7E 05', 'LD A,(IX+&05)', 19],
  ['DD 84', 'ADD A,IXH', 8],
  ['DD 86 03', 'ADD A,(IX+&03)', 19],
  ['DD 8D', 'ADC A,IXL', 8],
  ['DD 8E FD', 'ADC A,(IX-&03)', 19],
  ['DD 94', 'SUB IXH', 8],
  ['DD 96 03', 'SUB (IX+&03)', 19],
  ['DD 9E 03', 'SBC A,(IX+&03)', 19],
  ['DD A6 03', 'AND (IX+&03)', 19],
  ['DD AD', 'XOR IXL', 8],
  ['DD AE 03', 'XOR (IX+&03)', 19],
  ['DD B4', 'OR IXH', 8],
  ['DD B6 03', 'OR (IX+&03)', 19],
  ['DD BD', 'CP IXL', 8],
  ['DD BE 00', 'CP (IX+&00)', 19],
  ['DD E1', 'POP IX', 14],
  ['DD E3', 'EX (SP),IX', 23],
  ['DD E5', 'PUSH IX', 15],
  ['DD E9', 'JP (IX)', 8, { target: null, flow: 'jump' }],
  ['DD F9', 'LD SP,IX', 10],
  // prefix without effect: one data byte, then decoding resumes
  ['DD 00', 'DB &DD', 4, { len: 1 }],
  ['DD 01 34 12', 'DB &DD', 4, { len: 1 }],
  ['DD 3E 05', 'DB &DD', 4, { len: 1 }],
  ['DD 47', 'DB &DD', 4, { len: 1 }],
  ['DD 76', 'DB &DD', 4, { len: 1, flow: null }],
  ['DD 80', 'DB &DD', 4, { len: 1 }],
  ['DD C3 00 40', 'DB &DD', 4, { len: 1, target: null, flow: null }],
  ['DD C9', 'DB &DD', 4, { len: 1 }],
  ['DD EB', 'DB &DD', 4, { len: 1 }],
  ['DD D9', 'DB &DD', 4, { len: 1 }],
  ['DD 18 00', 'DB &DD', 4, { len: 1 }],
  ['DD DD 21 00 00', 'DB &DD', 4, { len: 1 }],
  ['DD FD 21 00 00', 'DB &DD', 4, { len: 1 }],
  ['DD ED B0', 'DB &DD', 4, { len: 1 }],
]);

suite('FD table', [
  ['FD 09', 'ADD IY,BC', 15],
  ['FD 29', 'ADD IY,IY', 15],
  ['FD 21 00 40', 'LD IY,&4000', 14],
  ['FD 22 00 40', 'LD (&4000),IY', 20],
  ['FD 2A 00 40', 'LD IY,(&4000)', 20],
  ['FD 23', 'INC IY', 10],
  ['FD 2B', 'DEC IY', 10],
  ['FD 24', 'INC IYH', 8],
  ['FD 2D', 'DEC IYL', 8],
  ['FD 26 01', 'LD IYH,&01', 11],
  ['FD 2E 01', 'LD IYL,&01', 11],
  ['FD 34 10', 'INC (IY+&10)', 23],
  ['FD 35 F0', 'DEC (IY-&10)', 23],
  ['FD 36 FF 00', 'LD (IY-&01),&00', 19],
  ['FD 4C', 'LD C,IYH', 8],
  ['FD 56 01', 'LD D,(IY+&01)', 19],
  ['FD 5D', 'LD E,IYL', 8],
  ['FD 6E 00', 'LD L,(IY+&00)', 19],
  ['FD 75 03', 'LD (IY+&03),L', 19],
  ['FD 7D', 'LD A,IYL', 8],
  ['FD 7E 00', 'LD A,(IY+&00)', 19],
  ['FD 85', 'ADD A,IYL', 8],
  ['FD 96 05', 'SUB (IY+&05)', 19],
  ['FD BC', 'CP IYH', 8],
  ['FD E1', 'POP IY', 14],
  ['FD E3', 'EX (SP),IY', 23],
  ['FD E5', 'PUSH IY', 15],
  ['FD E9', 'JP (IY)', 8, { target: null, flow: 'jump' }],
  ['FD F9', 'LD SP,IY', 10],
  ['FD 00', 'DB &FD', 4, { len: 1 }],
  ['FD 3C', 'DB &FD', 4, { len: 1 }],
  ['FD EB', 'DB &FD', 4, { len: 1 }],
  ['FD FD 00', 'DB &FD', 4, { len: 1 }],
  ['FD DD 00', 'DB &FD', 4, { len: 1 }],
  ['FD ED 44', 'DB &FD', 4, { len: 1 }],
]);

suite('DDCB table', [
  ['DD CB 05 06', 'RLC (IX+&05)', 23],
  ['DD CB 02 00', 'RLC (IX+&02),B', 23],
  ['DD CB 02 07', 'RLC (IX+&02),A', 23],
  ['DD CB FF 0E', 'RRC (IX-&01)', 23],
  ['DD CB FF 09', 'RRC (IX-&01),C', 23],
  ['DD CB 00 16', 'RL (IX+&00)', 23],
  ['DD CB 00 12', 'RL (IX+&00),D', 23],
  ['DD CB 00 1E', 'RR (IX+&00)', 23],
  ['DD CB 00 1B', 'RR (IX+&00),E', 23],
  ['DD CB 00 26', 'SLA (IX+&00)', 23],
  ['DD CB 00 24', 'SLA (IX+&00),H', 23],
  ['DD CB 00 2E', 'SRA (IX+&00)', 23],
  ['DD CB 00 2D', 'SRA (IX+&00),L', 23],
  ['DD CB 00 36', 'SLL (IX+&00)', 23],
  ['DD CB 00 37', 'SLL (IX+&00),A', 23],
  ['DD CB 00 3E', 'SRL (IX+&00)', 23],
  ['DD CB 00 38', 'SRL (IX+&00),B', 23],
  ['DD CB 05 46', 'BIT 0,(IX+&05)', 20],
  ['DD CB 05 40', 'BIT 0,(IX+&05)', 20],
  ['DD CB 05 47', 'BIT 0,(IX+&05)', 20],
  ['DD CB 05 7E', 'BIT 7,(IX+&05)', 20],
  ['DD CB 05 7C', 'BIT 7,(IX+&05)', 20],
  ['DD CB 05 86', 'RES 0,(IX+&05)', 23],
  ['DD CB 05 8F', 'RES 1,(IX+&05),A', 23],
  ['DD CB 05 BE', 'RES 7,(IX+&05)', 23],
  ['DD CB 00 C6', 'SET 0,(IX+&00)', 23],
  ['DD CB 00 CF', 'SET 1,(IX+&00),A', 23],
  ['DD CB 10 FE', 'SET 7,(IX+&10)', 23],
  ['DD CB 80 F8', 'SET 7,(IX-&80),B', 23, { target: null, flow: null }],
]);

suite('FDCB table', [
  ['FD CB 02 06', 'RLC (IY+&02)', 23],
  ['FD CB 02 01', 'RLC (IY+&02),C', 23],
  ['FD CB FE 2E', 'SRA (IY-&02)', 23],
  ['FD CB 00 36', 'SLL (IY+&00)', 23],
  ['FD CB 00 35', 'SLL (IY+&00),L', 23],
  ['FD CB 03 4E', 'BIT 1,(IY+&03)', 20],
  ['FD CB 03 4A', 'BIT 1,(IY+&03)', 20],
  ['FD CB 03 96', 'RES 2,(IY+&03)', 23],
  ['FD CB 03 93', 'RES 2,(IY+&03),E', 23],
  ['FD CB 7F DE', 'SET 3,(IY+&7F)', 23],
  ['FD CB 7F DA', 'SET 3,(IY+&7F),D', 23],
]);

describe('sweep of the 256 opcodes of every table', () => {
  const prefixes = {
    unprefixed: [],
    CB: [0xCB],
    ED: [0xED],
    DD: [0xDD],
    FD: [0xFD],
    DDCB: [0xDD, 0xCB, 0x05],
    FDCB: [0xFD, 0xCB, 0xFB],
  };
  const expectedLength = {
    unprefixed: [1, 3],
    CB: [2, 2],
    ED: [2, 4],
    DD: [1, 4],
    FD: [1, 4],
    DDCB: [4, 4],
    FDCB: [4, 4],
  };
  for (const [name, prefix] of Object.entries(prefixes)) {
    test(name, () => {
      const [min, max] = expectedLength[name];
      for (let op = 0; op < 256; op++) {
        const bytes = [...prefix, op, 0x12, 0x34, 0x56];
        const d = disassemble(memory(bytes, 0x8000), 0x8000);
        const label = `${name} ${op.toString(16)}`;
        assert.ok(d.length >= min && d.length <= max, label);
        assert.deepEqual(d.bytes, bytes.slice(0, d.length), label);
        assert.equal(typeof d.text, 'string', label);
        assert.match(d.text, /^[A-Z]/, label);
        assert.ok(
          typeof d.tstates === 'number' ||
            (Array.isArray(d.tstates) && d.tstates.length === 2 && d.tstates[0] > d.tstates[1]),
          label,
        );
        assert.ok(d.target === null || (d.target >= 0 && d.target <= 0xFFFF), label);
      }
    });
  }

  test('ED: 178 undefined opcodes', () => {
    let undefinedCount = 0;
    for (let op = 0; op < 256; op++) {
      const d = disassemble(memory([0xED, op, 0, 0]), 0);
      if (d.mnemonic === 'DB') {
        undefinedCount++;
        assert.equal(d.length, 2);
        assert.equal(d.tstates, 8);
      }
    }
    assert.equal(undefinedCount, 178);
  });

  test('DD/FD: prefix without effect if the unprefixed opcode ignores HL, H, L and (HL)', () => {
    const usesHL = /\b(HL|H|L)\b|\(HL\)/;
    for (const prefix of [0xDD, 0xFD]) {
      for (let op = 0; op < 256; op++) {
        if (op === 0xCB) continue;
        const plain = disassemble(memory([op, 0, 0, 0]), 0);
        const d = disassemble(memory([prefix, op, 0, 0, 0]), 0);
        const inert = [0xDD, 0xED, 0xFD, 0xEB].includes(op) || !usesHL.test(plain.text);
        assert.equal(d.mnemonic === 'DB', inert, `${prefix.toString(16)} ${op.toString(16)}`);
        if (inert) assert.equal(d.length, 1);
        // (HL) takes a displacement byte, except in JP (HL)
        const withDisp = plain.text.includes('(HL)') && op !== 0xE9;
        if (!inert) assert.equal(d.length, plain.length + 1 + (withDisp ? 1 : 0));
      }
    }
  });
});

describe('programs and ranges', () => {
  const program = parse(
    '21 19 40 7E B7 28 06 CD 5A BB 23 18 F6 06 06 48 CD 38 BC 3E 07 CD 5A BB C9',
  );

  test('demo program from &4000', () => {
    const list = disassembleRange(memory(program, 0x4000), 0x4000, 13);
    assert.deepEqual(list.map(d => d.text), [
      'LD HL,&4019',
      'LD A,(HL)',
      'OR A',
      'JR Z,&400D',
      'CALL &BB5A',
      'INC HL',
      'JR &4003',
      'LD B,&06',
      'LD C,B',
      'CALL &BC38',
      'LD A,&07',
      'CALL &BB5A',
      'RET',
    ]);
    assert.deepEqual(list.map(d => d.addr), [
      0x4000, 0x4003, 0x4004, 0x4005, 0x4007, 0x400A, 0x400B,
      0x400D, 0x400F, 0x4010, 0x4013, 0x4015, 0x4018,
    ]);
    assert.deepEqual(list.map(d => d.tstates), [
      10, 7, 4, [12, 7], 17, 6, 12, 7, 4, 17, 7, 17, 10,
    ]);
    assert.equal(list[3].target, 0x400D);
    assert.equal(list[6].target, 0x4003);
    assert.equal(list[12].flow, 'ret');
  });

  test('decoding resumes after a prefix without effect', () => {
    const list = disassembleRange(memory(parse('DD 3E 05 FD DD 21 00 C0'), 0), 0, 3);
    assert.deepEqual(list.map(d => d.text), ['DB &DD', 'LD A,&05', 'DB &FD']);
    const next = disassemble(memory(parse('DD 3E 05 FD DD 21 00 C0'), 0), 4);
    assert.equal(next.text, 'LD IX,&C000');
  });

  test('wrap-around read at the end of memory', () => {
    const read = memory(parse('C3 00 01'), 0xFFFF);
    const d = disassemble(read, 0xFFFF);
    assert.equal(d.text, 'JP &0100');
    assert.deepEqual(d.bytes, [0xC3, 0x00, 0x01]);
    const list = disassembleRange(read, 0xFFFF, 2);
    assert.equal(list[1].addr, 0x0002);
  });

  test('address masked to 16 bits', () => {
    const d = disassemble(memory([0x00], 0), 0x10000);
    assert.equal(d.addr, 0);
    assert.equal(d.text, 'NOP');
  });
});
