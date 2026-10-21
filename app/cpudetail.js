import { hex } from './util.js';

/* Detailed CPU view: for each T-state, the values travelling on the internal buses
   ("transfers" animated along routes), the ALU computation and the opcode decoding. */

const PAIRS = { BC: ['B', 'C'], DE: ['D', 'E'], HL: ['H', 'L'], AF: ['A', 'F'] };
const pair = (r, n) => PAIRS[n] ? (r[PAIRS[n][0]] << 8) | r[PAIRS[n][1]] : r[n];
const REG8 = new Set(['A', 'B', 'C', 'D', 'E', 'H', 'L']);
const W16 = new Set(['BC', 'DE', 'HL', 'SP', 'IX', 'IY']);

// value routes (coordinates of the CPU view, see cpuview.js)
export const ROUTES = {
  'in-db': 'M1010,485 H935',
  'db-out': 'M935,485 H1010',
  'db-ir': 'M925,400 V370 H330 V180 H320',
  'db-rf': 'M925,400 V370 H740 V300',
  'rf-db': 'M740,300 V370 H925 V400',
  'db-tmp': 'M925,400 V370 H605 V60 H560',
  'rf-ab': 'M860,240 H925',
  'ab-out': 'M965,170 H1010',
  'rf-inc': 'M650,300 V420',
  'inc-rf': 'M830,420 V300',
  'ir-dec': 'M220,200 V265',
  'dec-seq': 'M220,300 V375',
  'rf-acc': 'M740,300 V370 H360 V60 H385',
  'rf-tmp': 'M740,300 V370 H605 V60 H560',
  'acc-alu': 'M420,70 V125',
  'tmp-alu': 'M520,70 V125',
  'alu-rf': 'M470,200 V370 H740 V300',
  'alu-db': 'M470,200 V370 H925 V400',
  'alu-f': 'M510,205 V262',
};

const ALU_SYM = { ADD: '+', ADC: '+', SUB: '−', SBC: '−', AND: 'AND', OR: 'OR', XOR: 'XOR', CP: '−' };
const lastOf = (trace, type) => [...trace].reverse().find(c => c.type === type);

// value of an operand at the start of the instruction
function operand(op, before, trace) {
  if (!op) return null;
  if (REG8.has(op)) return before[op];
  if (/^&[0-9A-F]{2}$/.test(op)) return parseInt(op.slice(1), 16);
  if (op.startsWith('(')) return lastOf(trace, 'MR')?.data ?? null;
  return null;
}
const flagStr = f => ['S', 'Z', 'Y', 'H', 'X', 'P', 'N', 'C'].map((n, i) => `${n}${(f >> (7 - i)) & 1}`).join(' ');

/* Computation performed by the ALU, reconstructed from the registers before / after */
export function aluInfo(d, before, after, trace) {
  const m = d.mnemonic, ops = d.operands;
  const info = { op: m, acc: null, tmp: null, result: null, expr: '', flags: before.F !== after.F ? `${flagStr(before.F)} → ${flagStr(after.F)}` : 'flags unchanged', dest: null };
  if (ALU_SYM[m]) {
    const src = ops.length === 2 ? ops[1] : ops[0];
    if (W16.has(ops[0]) && ops.length === 2) {              // ADD/ADC/SBC HL,rr
      const a = pair(before, ops[0]), b = pair(before, ops[1]), r = pair(after, ops[0]);
      const c = m !== 'ADD' ? ` ${ALU_SYM[m]} C(${before.F & 1})` : '';
      Object.assign(info, { acc: a, tmp: b, result: r, w16: true, dest: ops[0], expr: `${hex(a, 4)} ${ALU_SYM[m]} ${hex(b, 4)}${c} = ${hex(r, 4)}` });
      return info;
    }
    const a = before.A, b = operand(src, before, trace);
    const r = m === 'CP' ? (a - b) & 0xFF : after.A;
    const c = m === 'ADC' || m === 'SBC' ? ` ${ALU_SYM[m]} C(${before.F & 1})` : '';
    Object.assign(info, { acc: a, tmp: b, result: r, dest: m === 'CP' ? null : 'A',
      expr: b == null ? `${m} ${ops.join(',')}` : `${hex(a)} ${ALU_SYM[m]} ${hex(b)}${c} = ${hex(r)}${m === 'CP' ? '  (compare: A is not modified)' : ''}` });
    return info;
  }
  if (m === 'INC' || m === 'DEC') {
    const t = ops[0], s = m === 'INC' ? '+ 1' : '− 1';
    if (W16.has(t)) { const a = pair(before, t), r = pair(after, t); return Object.assign(info, { acc: a, tmp: 1, result: r, w16: true, dest: t, expr: `${hex(a, 4)} ${s} = ${hex(r, 4)}  (16-bit incrementer, no flags)` }); }
    if (REG8.has(t)) return Object.assign(info, { acc: before[t], tmp: 1, result: after[t], dest: t, expr: `${hex(before[t])} ${s} = ${hex(after[t])}` });
    const v = lastOf(trace, 'MR')?.data, r = lastOf(trace, 'MW')?.data;
    return Object.assign(info, { acc: v, tmp: 1, result: r, dest: 'mem', expr: `(${t.slice(1, -1)}): ${hex(v)} ${s} = ${hex(r)}` });
  }
  if (['RLCA', 'RRCA', 'RLA', 'RRA', 'CPL', 'NEG', 'DAA', 'SCF', 'CCF'].includes(m)) {
    return Object.assign(info, { acc: before.A, result: after.A, dest: 'A', expr: `${m}: ${hex(before.A)} → ${hex(after.A)}` });
  }
  if (['RLC', 'RRC', 'RL', 'RR', 'SLA', 'SRA', 'SLL', 'SRL', 'SET', 'RES'].includes(m)) {
    const t = ['SET', 'RES'].includes(m) ? ops[1] : ops[0];
    if (REG8.has(t)) return Object.assign(info, { acc: before[t], result: after[t], dest: t, expr: `${m}: ${hex(before[t])} (${before[t].toString(2).padStart(8, '0')}) → ${hex(after[t])} (${after[t].toString(2).padStart(8, '0')})` });
    const v = lastOf(trace, 'MR')?.data, r = lastOf(trace, 'MW')?.data;
    return Object.assign(info, { acc: v, result: r, dest: 'mem', expr: `${m}: ${hex(v)} → ${hex(r)}` });
  }
  if (m === 'BIT') {
    const n = +ops[0], v = REG8.has(ops[1]) ? before[ops[1]] : lastOf(trace, 'MR')?.data;
    return Object.assign(info, { acc: v, tmp: 1 << n, result: v & (1 << n), expr: `bit ${n} of ${hex(v)} (${v?.toString(2).padStart(8, '0')}) = ${(v >> n) & 1} → Z = ${(after.F >> 6) & 1}` });
  }
  return null;
}

/* Opcode decoding into fields x (2 bits), y (3), z (3), p = y>>1, q = y&1 — Zilog scheme */
const R = ['B', 'C', 'D', 'E', 'H', 'L', '(HL)', 'A'];
const RP = ['BC', 'DE', 'HL', 'SP'];
const ALU = ['ADD A,', 'ADC A,', 'SUB', 'SBC A,', 'AND', 'XOR', 'OR', 'CP'];
const MAIN = {
  0: ['relative jumps, EX AF,AF\', NOP (depending on y)', 'LD rp[p],nn (q=0) / ADD HL,rp[p] (q=1)', 'indirect loads (BC), (DE), (nn)', 'INC rp[p] (q=0) / DEC rp[p] (q=1)', 'INC r[y]', 'DEC r[y]', 'LD r[y],n', 'rotates of A and flag operations'],
  3: ['RET cc[y]', 'POP rp2[p] / RET, EXX, JP (HL), LD SP,HL', 'JP cc[y],nn', 'JP nn, CB prefix, OUT, IN, EX, DI, EI (depending on y)', 'CALL cc[y],nn', 'PUSH rp2[p] / CALL nn, DD, ED, FD prefixes', 'ALU operation alu[y] with an immediate byte', 'RST y×8'],
};
export function decodeInfo(d) {
  const b = d.bytes;
  if (!b || !b.length) return null;
  let table = 'main', op = b[0], prefix = '';
  if (b[0] === 0xCB) { table = 'CB'; op = b[1]; prefix = 'CB '; }
  else if (b[0] === 0xED) { table = 'ED'; op = b[1]; prefix = 'ED '; }
  else if ((b[0] === 0xDD || b[0] === 0xFD) && b.length > 1) {
    const ix = b[0] === 0xDD ? 'IX' : 'IY';
    if (b[1] === 0xCB) { table = `CB (indexed, ${ix})`; op = b[3]; prefix = `${hex(b[0])} CB d `; }
    else { table = `main, HL → ${ix}`; op = b[1]; prefix = `${hex(b[0])} `; }
  }
  if (op == null) return null;
  const x = op >> 6, y = (op >> 3) & 7, z = op & 7, p = y >> 1, q = y & 1;
  let role;
  if (table.startsWith('CB')) role = [`rotate/shift no. ${y} of r[z] = ${R[z]}`, `BIT ${y},r[z] = ${R[z]}`, `RES ${y},r[z] = ${R[z]}`, `SET ${y},r[z] = ${R[z]}`][x];
  else if (table === 'ED') role = x === 1 ? ['IN r[y],(C)', 'OUT (C),r[y]', 'SBC/ADC HL,rp[p]', 'LD (nn),rp / LD rp,(nn)', 'NEG', 'RETN / RETI', 'IM', 'LD I/R, RRD, RLD'][z] : x === 2 && z <= 3 && y >= 4 ? 'block instruction (LDI, CPI, INI, OUTI… and repeats)' : 'undefined ED opcode (8 T NOP)';
  else if (x === 1) role = y === 6 && z === 6 ? 'HALT' : `LD r[y],r[z] = LD ${R[y]},${R[z]}`;
  else if (x === 2) role = `alu[y] r[z] = ${ALU[y]} ${R[z]}`;
  else role = MAIN[x][z].replace('r[y]', `r[y] = ${R[y]}`).replace('rp[p]', `rp[p] = ${RP[p]}`).replace('alu[y]', `alu[y] = ${ALU[y].trim()}`);
  const bits = op.toString(2).padStart(8, '0');
  return { table, prefix, op, x, y, z, p, q, bits: `${bits.slice(0, 2)}·${bits.slice(2, 5)}·${bits.slice(5)}`, role };
}

/* Adds to each T-state the value transfers between blocks */
export function addTransfers(steps, d, before, after, trace, alu) {
  const chg = Object.keys(after).filter(k => before[k] !== after[k] && !['R', 'PC', 'WZ', 'F'].includes(k));
  const destReg = chg.find(k => k.length <= 2 && !k.includes("'")) || null;
  steps.forEach((s, i) => {
    const T = (route, value, kind, stage = 0, label = '') => (s.transfers ||= []).push({ route, value, kind, stage, label });
    const lastCycle = s.m === steps[steps.length - 1].m;
    if (s.mtype === 'M1' && s.title !== 'Internal state') {
      if (s.t === 1) { T('rf-ab', hex(s.addr, 4), 'addr', 0, 'PC'); T('ab-out', hex(s.addr, 4), 'addr', 1); }
      if (s.t === 2) { T('in-db', hex(s.data), 'data', 0); T('rf-inc', hex(s.addr, 4), 'addr', 0, 'PC'); T('inc-rf', hex((s.addr + 1) & 0xFFFF, 4), 'addr', 1, 'PC+1'); }
      if (s.t === 3) { T('db-ir', hex(s.ir), 'data', 0, '→ IR'); T('rf-ab', hex(s.addr, 4), 'addr', 0, 'I·R'); }
      if (s.t === 4) T('ir-dec', hex(steps.slice(0, i + 1).reverse().find(x => x.ir != null)?.ir ?? 0), 'ctrl', 0, 'decode');
    } else if (s.mtype === 'MR' && s.t <= 3) {
      if (s.t === 1) { T('rf-ab', hex(s.addr, 4), 'addr', 0); T('ab-out', hex(s.addr, 4), 'addr', 1); }
      if (s.t === 2) T('in-db', hex(s.data), 'data', 0);
      if (s.t === 3) {
        const isAluOperand = alu && lastCycle && !alu.w16 && (alu.dest === 'A' || alu.dest === null || alu.dest === 'mem');
        if (isAluOperand) T('db-tmp', hex(s.data), 'data', 0, '→ TMP');
        else if (lastCycle && destReg && !W16.has(destReg)) T('db-rf', hex(s.data), 'data', 0, `→ ${destReg}`);
        else T('db-rf', hex(s.data), 'data', 0, before.PC <= s.addr && s.addr < before.PC + 4 ? '→ W/Z' : '→ register');
      }
    } else if (s.mtype === 'MW' && s.t <= 3) {
      if (s.t === 1) { T('rf-ab', hex(s.addr, 4), 'addr', 0); T('ab-out', hex(s.addr, 4), 'addr', 1); }
      if (s.t === 2) { T(alu?.dest === 'mem' ? 'alu-db' : 'rf-db', hex(s.data), 'data', 0); T('db-out', hex(s.data), 'data', 1); }
    } else if ((s.mtype === 'IOR' || s.mtype === 'IOW') && s.t <= 4) {
      if (s.t === 1) { T('rf-ab', hex(s.addr, 4), 'addr', 0, 'port'); T('ab-out', hex(s.addr, 4), 'addr', 1); }
      if (s.mtype === 'IOW' && s.t === 2) { T('rf-db', hex(s.data), 'data', 0); T('db-out', hex(s.data), 'data', 1); }
      if (s.mtype === 'IOR' && s.t === 4) { T('in-db', hex(s.data), 'data', 0); T('db-rf', hex(s.data), 'data', 1, destReg ? `→ ${destReg}` : ''); }
    }
    // execution in the ALU (step where the ALU blocks light up)
    if (alu && s.blocks.includes('b-alu') && !(s.transfers || []).some(t => t.route === 'acc-alu')) {
      const w = alu.w16 ? 4 : 2;
      if (alu.acc != null) T('rf-acc', hex(alu.acc, w), 'data', 0, '→ ACC');
      if (alu.tmp != null && !(s.transfers || []).some(t => t.route === 'db-tmp')) T('rf-tmp', hex(alu.tmp, w), 'data', 0, '→ TMP');
      T('acc-alu', alu.acc != null ? hex(alu.acc, w) : '', 'data', 1);
      if (alu.tmp != null) T('tmp-alu', hex(alu.tmp, w), 'data', 1);
      if (alu.result != null) T(alu.dest === 'mem' ? 'alu-db' : 'alu-rf', hex(alu.result, w), 'data', 2, alu.dest && alu.dest !== 'mem' ? `→ ${alu.dest}` : '');
      if (before.F !== after.F) T('alu-f', hex(after.F), 'ctrl', 2, '→ F');
    } else if (s.blocks.includes('b-inc') && s.title === 'Internal state' && !(s.transfers || []).length && destReg && W16.has(destReg)) {
      T('rf-inc', hex(pair(before, destReg), 4), 'addr', 0, destReg);
      T('inc-rf', hex(pair(after, destReg), 4), 'addr', 1, destReg);
    }
  });
}
