/* Z80 Studio — Z80 assembler.
   Syntax close to Maxam / WinAPE / pasmo: labels in column 0 (colon
   optional), numbers &FF #FF $FF 0xFF 0FFh %1010 0b1010, directives ORG EQU
   DB DW DS ALIGN END INCLUDE. Full instruction set, including the
   undocumented forms (IXH/IXL/IYH/IYL, SLL, DDCB with copy register, IN F,(C),
   OUT (C),0).
   Multi-pass assembly: each pass reuses the symbols of the previous one for
   forward references; it stops when the symbol table no longer changes, and
   only the diagnostics of the last pass are returned. */

class AsmError extends Error {}

const MAX_PASSES = 10;
const MAX_INCLUDE_DEPTH = 16;

const hex = (v, n = 2) => '&' + (v >>> 0).toString(16).toUpperCase().padStart(n, '0');

/* =====================================================================
   Tables
   ===================================================================== */
const REG8 = { B: 0, C: 1, D: 2, E: 3, H: 4, L: 5, A: 7 };
const HALF = { IXH: [0xDD, 4], IXL: [0xDD, 5], IYH: [0xFD, 4], IYL: [0xFD, 5] };
const HALF_ALIAS = { HX: 'IXH', LX: 'IXL', HY: 'IYH', LY: 'IYL' };
const RP = { BC: 0, DE: 1, HL: 2, SP: 3 };
const RP_PUSH = { BC: 0, DE: 1, HL: 2, AF: 3 };
const IDX = { IX: 0xDD, IY: 0xFD };
const COND = { NZ: 0, Z: 1, NC: 2, C: 3, PO: 4, PE: 5, P: 6, M: 7 };
const ALU = { ADD: 0, ADC: 1, SUB: 2, SBC: 3, AND: 4, XOR: 5, OR: 6, CP: 7 };
const ROT = { RLC: 0, RRC: 1, RL: 2, RR: 3, SLA: 4, SRA: 5, SLL: 6, SL1: 6, SLI: 6, SRL: 7 };
const BITOP = { BIT: 0x40, RES: 0x80, SET: 0xC0 };

const SIMPLE = {
  NOP: [0x00], HALT: [0x76], DI: [0xF3], EI: [0xFB], DAA: [0x27], CPL: [0x2F],
  CCF: [0x3F], SCF: [0x37], RLCA: [0x07], RRCA: [0x0F], RLA: [0x17], RRA: [0x1F],
  EXX: [0xD9],
  NEG: [0xED, 0x44], RLD: [0xED, 0x6F], RRD: [0xED, 0x67], RETI: [0xED, 0x4D], RETN: [0xED, 0x45],
  LDI: [0xED, 0xA0], LDIR: [0xED, 0xB0], LDD: [0xED, 0xA8], LDDR: [0xED, 0xB8],
  CPI: [0xED, 0xA1], CPIR: [0xED, 0xB1], CPD: [0xED, 0xA9], CPDR: [0xED, 0xB9],
  INI: [0xED, 0xA2], INIR: [0xED, 0xB2], IND: [0xED, 0xAA], INDR: [0xED, 0xBA],
  OUTI: [0xED, 0xA3], OTIR: [0xED, 0xB3], OUTD: [0xED, 0xAB], OTDR: [0xED, 0xBB],
};

const REGISTERS = new Set([
  'A', 'B', 'C', 'D', 'E', 'H', 'L', 'I', 'R', 'F',
  'AF', "AF'", 'BC', 'DE', 'HL', 'SP', 'IX', 'IY',
  ...Object.keys(HALF), ...Object.keys(HALF_ALIAS),
]);
const RESERVED = new Set([...REGISTERS, ...Object.keys(COND)]);

const DIRECTIVES = new Set(['ORG', 'EQU', 'DB', 'DEFB', 'DM', 'DEFM', 'DW', 'DEFW', 'DS', 'DEFS', 'ALIGN', 'END', 'INCLUDE']);
const MNEMONICS = new Set([
  ...Object.keys(SIMPLE), ...Object.keys(ALU), ...Object.keys(ROT), ...Object.keys(BITOP),
  'LD', 'PUSH', 'POP', 'EX', 'INC', 'DEC', 'JP', 'JR', 'DJNZ', 'CALL', 'RET', 'RST', 'IM', 'IN', 'OUT',
]);

/* =====================================================================
   Lexical analysis
   ===================================================================== */
const isDigit = c => c >= '0' && c <= '9';
const isHexDigit = c => /^[0-9A-Fa-f]$/.test(c);
const isIdStart = c => /^[A-Za-z_.]$/.test(c);
const isIdChar = c => /^[A-Za-z0-9_.]$/.test(c);
const isWordChar = c => /^[A-Za-z0-9_]$/.test(c);

function parseNumber(w) {
  if (/^[0-9][0-9A-Fa-f]*[hH]$/.test(w)) return parseInt(w.slice(0, -1), 16);
  if (/^0[xX][0-9A-Fa-f]+$/.test(w)) return parseInt(w.slice(2), 16);
  if (/^0[bB][01]+$/.test(w)) return parseInt(w.slice(2), 2);
  if (/^[01]+[bB]$/.test(w)) return parseInt(w.slice(0, -1), 2);
  if (/^[0-9]+$/.test(w)) return parseInt(w, 10);
  throw new AsmError(`invalid number: ${w}`);
}

// Tokens: { t: 'id'|'num'|'str'|'pc'|'op', v, s, e, raw }
function tokenize(text) {
  const toks = [];
  const n = text.length;
  // True if an operand is expected (start, after an operator, an instruction or a directive):
  // used to read & and % as number prefixes rather than as operators.
  const expectValue = () => {
    const last = toks[toks.length - 1];
    if (!last) return true;
    if (last.t === 'op') return last.v !== ')';
    if (last.t === 'id') {
      const up = last.v.toUpperCase();
      return MNEMONICS.has(up) || DIRECTIVES.has(up);
    }
    return false;
  };
  const push = (t, v, s, e) => toks.push({ t, v, s, e, raw: text.slice(s, e) });
  const wordEnd = from => {
    let j = from;
    while (j < n && isWordChar(text[j])) j++;
    return j;
  };
  const prefixed = (s, radix, valid) => {
    const e = wordEnd(s + 1);
    const digits = text.slice(s + 1, e);
    if (!valid.test(digits)) throw new AsmError(`invalid number: ${text.slice(s, e)}`);
    push('num', parseInt(digits, radix), s, e);
    return e;
  };
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === ';') break;
    const s = i;
    if (c === '"' || c === "'") {
      const j = text.indexOf(c, i + 1);
      if (j < 0) throw new AsmError('unterminated string');
      push('str', text.slice(i + 1, j), s, j + 1);
      i = j + 1;
    } else if (isDigit(c)) {
      const e = wordEnd(i);
      push('num', parseNumber(text.slice(i, e)), s, e);
      i = e;
    } else if (c === '&' && expectValue() && isHexDigit(text[i + 1] ?? '')) {
      i = prefixed(i, 16, /^[0-9A-Fa-f]+$/);
    } else if (c === '%' && expectValue() && /[01]/.test(text[i + 1] ?? '')) {
      i = prefixed(i, 2, /^[01]+$/);
    } else if (c === '#') {
      i = prefixed(i, 16, /^[0-9A-Fa-f]+$/);
    } else if (c === '$') {
      if (isHexDigit(text[i + 1] ?? '')) i = prefixed(i, 16, /^[0-9A-Fa-f]+$/);
      else { push('pc', '$', s, i + 1); i++; }
    } else if (isIdStart(c)) {
      let j = i + 1;
      while (j < n && isIdChar(text[j])) j++;
      let v = text.slice(i, j);
      // AF': the apostrophe is part of the register name, not a string.
      if (v.toUpperCase() === 'AF' && text[j] === "'") { j++; v = "AF'"; }
      push('id', v, s, j);
      i = j;
    } else if ((c === '<' || c === '>') && text[i + 1] === c) {
      push('op', c + c, s, i + 2);
      i += 2;
    } else if ('+-*/%&|^~(),:='.includes(c)) {
      push('op', c, s, i + 1);
      i++;
    } else {
      throw new AsmError(`unexpected character: ${c}`);
    }
  }
  return toks;
}

const isOp = (t, v) => t && t.t === 'op' && t.v === v;

/* =====================================================================
   Expressions (C precedence)
   ===================================================================== */
const PREC = { '|': 1, '^': 2, '&': 3, '<<': 4, '>>': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };

function evaluate(toks, env) {
  if (!toks.length) throw new AsmError('missing expression');
  const p = { toks, i: 0, env };
  const v = parseBinary(p, 1);
  if (p.i < toks.length) throw new AsmError(`invalid expression: unexpected '${toks[p.i].raw}'`);
  return v;
}

function parseBinary(p, minPrec) {
  let left = parseUnary(p);
  for (;;) {
    const t = p.toks[p.i];
    if (!t || t.t !== 'op' || !(t.v in PREC) || PREC[t.v] < minPrec) return left;
    p.i++;
    const right = parseBinary(p, PREC[t.v] + 1);
    left = applyOp(t.v, left, right, p.env);
  }
}

function applyOp(op, a, b, env) {
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/':
      if (b === 0) { env.valueError('division by zero'); return 0; }
      return Math.trunc(a / b);
    case '%':
      if (b === 0) { env.valueError('modulo by zero'); return 0; }
      return a % b;
    case '&': return a & b;
    case '|': return a | b;
    case '^': return a ^ b;
    case '<<': return a << b;
    case '>>': return a >> b;
  }
  throw new AsmError(`unknown operator: ${op}`);
}

function parseUnary(p) {
  const t = p.toks[p.i];
  if (isOp(t, '-')) { p.i++; return -parseUnary(p); }
  if (isOp(t, '+')) { p.i++; return parseUnary(p); }
  if (isOp(t, '~')) { p.i++; return ~parseUnary(p); }
  return parsePrimary(p);
}

function parsePrimary(p) {
  const t = p.toks[p.i++];
  if (!t) throw new AsmError('incomplete expression');
  switch (t.t) {
    case 'num': return t.v;
    case 'pc': return p.env.pc;
    case 'str':
      if (t.v.length !== 1) throw new AsmError(`a string in an expression must be one character: ${t.raw}`);
      return t.v.charCodeAt(0);
    case 'id': return p.env.symbol(t.v);
  }
  if (isOp(t, '(')) {
    const v = parseBinary(p, 1);
    if (!isOp(p.toks[p.i], ')')) throw new AsmError('missing closing parenthesis');
    p.i++;
    return v;
  }
  throw new AsmError(`invalid expression: unexpected '${t.raw}'`);
}

function byte(v, env) {
  if (v < -128 || v > 255) env.warn(`value out of range for a byte: ${v} (truncated to ${hex(v & 0xFF)})`);
  return v & 0xFF;
}

function word(v, env) {
  if (v < -32768 || v > 65535) env.warn(`value out of range for a word: ${v} (truncated to ${hex(v & 0xFFFF, 4)})`);
  return [v & 0xFF, (v >> 8) & 0xFF];
}

/* =====================================================================
   Operands
   ===================================================================== */
// Split at top-level commas.
function splitOperands(toks) {
  const ops = [];
  let cur = [], depth = 0;
  for (const t of toks) {
    if (isOp(t, '(')) depth++;
    else if (isOp(t, ')')) depth--;
    if (isOp(t, ',') && depth === 0) { ops.push(cur); cur = []; } else cur.push(t);
  }
  ops.push(cur);
  if (ops.some(o => !o.length)) throw new AsmError('missing operand');
  return ops;
}

// Index of the closing parenthesis matching toks[0].
function closingParen(toks) {
  let depth = 0;
  for (let k = 0; k < toks.length; k++) {
    if (isOp(toks[k], '(')) depth++;
    else if (isOp(toks[k], ')') && --depth === 0) return k;
  }
  return -1;
}

/* Kinds: reg (register), imm (value), mem ((expr)), ind ((HL) (BC) (DE) (SP) (C)),
   idx ((IX+d), (IY-d), (IX); dispToks is null for the form without displacement). */
function parseOperand(toks, text) {
  const op = { toks, text: text.slice(toks[0].s, toks[toks.length - 1].e).trim(), word: null };
  if (toks.length === 1 && toks[0].t === 'id') {
    const up = toks[0].v.toUpperCase();
    op.word = up;
    if (REGISTERS.has(up)) return { ...op, kind: 'reg', reg: HALF_ALIAS[up] ?? up };
  }
  // Memory access only if the outer parentheses enclose the whole operand.
  if (isOp(toks[0], '(') && closingParen(toks) === toks.length - 1) {
    const inner = toks.slice(1, -1);
    if (!inner.length) throw new AsmError(`invalid operand: ${op.text}`);
    const first = inner[0].t === 'id' ? inner[0].v.toUpperCase() : null;
    if (inner.length === 1 && ['HL', 'BC', 'DE', 'SP', 'C'].includes(first)) return { ...op, kind: 'ind', reg: first };
    if (first === 'IX' || first === 'IY') {
      if (inner.length === 1) return { ...op, kind: 'idx', reg: first, dispToks: null };
      if (isOp(inner[1], '+') || isOp(inner[1], '-')) return { ...op, kind: 'idx', reg: first, dispToks: inner.slice(1) };
      throw new AsmError(`invalid operand: ${op.text}`);
    }
    return { ...op, kind: 'mem', expr: inner };
  }
  return { ...op, kind: 'imm', expr: toks };
}

// 8-bit operand: plain register, index half, (HL) or (IX+d).
function r8(op) {
  if (op.kind === 'reg') {
    if (op.reg in REG8) return { code: REG8[op.reg], prefix: 0 };
    if (op.reg in HALF) return { code: HALF[op.reg][1], prefix: HALF[op.reg][0], half: true };
    return null;
  }
  if (op.kind === 'ind' && op.reg === 'HL') return { code: 6, prefix: 0 };
  if (op.kind === 'idx') return { code: 6, prefix: IDX[op.reg], idx: op };
  return null;
}

// Prefix shared by two 8-bit operands (0 if none), null if the combination is impossible.
function pairPrefix(a, b) {
  if (a.code === 6 && b.code === 6) return null;
  if (a.prefix && b.prefix && a.prefix !== b.prefix) return null;
  if (a.half || b.half) {
    // Under a DD/FD prefix, H and L already mean IXH/IXL: no mixing with H, L, (HL) or (IX+d).
    const other = a.half ? b : a;
    if (!other.half && other.code >= 4 && other.code <= 6) return null;
  }
  return a.prefix || b.prefix;
}

/* =====================================================================
   Instruction encoding
   ===================================================================== */
function encode(mn, ops, env) {
  const bad = () => {
    throw new AsmError(ops.length
      ? `invalid operand for ${mn}: ${ops.map(o => o.text).join(',')}`
      : `missing operand for ${mn}`);
  };
  const count = (...allowed) => { if (!allowed.includes(ops.length)) bad(); };
  const isReg = (op, name) => op.kind === 'reg' && op.reg === name;
  const val = op => evaluate(op.expr, env);
  const imm8 = op => byte(val(op), env);
  const imm16 = op => word(val(op), env);
  const disp = idx => {
    if (!idx.dispToks) return 0;
    const v = evaluate(idx.dispToks, env);
    if (v < -128 || v > 127) env.valueError(`displacement out of range (${v})`);
    return v & 0xFF;
  };
  // [prefix] opcode [displacement]
  const pre = (r, opcode) => {
    const b = r.prefix ? [r.prefix, opcode] : [opcode];
    if (r.idx) b.push(disp(r.idx));
    return b;
  };
  // CB op or DD CB d op
  const cb = (r, opcode) => r.idx ? [r.prefix, 0xCB, disp(r.idx), opcode] : [0xCB, opcode];
  const cond = op => {
    if (isReg(op, 'C')) return COND.C;
    if (op.kind === 'imm' && op.word in COND) return COND[op.word];
    return null;
  };
  const rel = op => {
    const off = val(op) - (env.pc + 2);
    if (off < -128 || off > 127) env.valueError(`relative jump out of range (${off})`);
    return off & 0xFF;
  };
  // Plain register usable by IN r,(C) / OUT (C),r and as the DDCB copy register.
  const plain = op => {
    const r = r8(op);
    return r && !r.prefix && r.code !== 6 ? r : null;
  };

  if (mn in SIMPLE) { count(0); return [...SIMPLE[mn]]; }

  if (mn in ALU) {
    const k = ALU[mn];
    if (ops.length === 2 && ops[0].kind === 'reg' && ['HL', 'IX', 'IY'].includes(ops[0].reg)) {
      const d = ops[0].reg, s = ops[1];
      if (s.kind !== 'reg') bad();
      if (mn === 'ADD') {
        if (d === 'HL') { if (s.reg in RP) return [0x09 | RP[s.reg] << 4]; bad(); }
        let code = null;
        if (s.reg === d) code = 2;
        else if (s.reg in RP && s.reg !== 'HL') code = RP[s.reg];
        if (code === null) bad();
        return [IDX[d], 0x09 | code << 4];
      }
      if ((mn === 'ADC' || mn === 'SBC') && d === 'HL' && s.reg in RP) {
        return [0xED, (mn === 'ADC' ? 0x4A : 0x42) | RP[s.reg] << 4];
      }
      return bad();
    }
    let src;
    if (ops.length === 2) { if (!isReg(ops[0], 'A')) bad(); src = ops[1]; } else if (ops.length === 1) src = ops[0]; else bad();
    const r = r8(src);
    if (r) return pre(r, 0x80 | k << 3 | r.code);
    if (src.kind === 'imm') return [0xC6 | k << 3, imm8(src)];
    return bad();
  }

  if (mn in ROT) {
    count(1, 2);
    const r = r8(ops[0]);
    if (!r || r.half) bad();
    let code = r.code;
    if (ops.length === 2) {
      const c = plain(ops[1]);
      if (!r.idx || !c) bad();
      code = c.code;
    }
    return cb(r, ROT[mn] << 3 | code);
  }

  if (mn in BITOP) {
    count(2, 3);
    if (mn === 'BIT' && ops.length === 3) bad();
    if (ops[0].kind !== 'imm') bad();
    const r = r8(ops[1]);
    if (!r || r.half) bad();
    let code = r.code;
    if (ops.length === 3) {
      const c = plain(ops[2]);
      if (!r.idx || !c) bad();
      code = c.code;
    }
    let b = val(ops[0]);
    if (b < 0 || b > 7) { env.valueError(`invalid bit number: ${b}`); b &= 7; }
    return cb(r, BITOP[mn] | b << 3 | code);
  }

  switch (mn) {
    case 'LD': {
      count(2);
      const [d, s] = ops;
      const rd = r8(d), rs = r8(s);
      if (rd && rs) {
        const prefix = pairPrefix(rd, rs);
        if (prefix === null) bad();
        return pre({ prefix, idx: rd.idx || rs.idx }, 0x40 | rd.code << 3 | rs.code);
      }
      if (rd && s.kind === 'imm') return [...pre(rd, 0x06 | rd.code << 3), imm8(s)];
      if (isReg(d, 'A')) {
        if (s.kind === 'ind' && s.reg === 'BC') return [0x0A];
        if (s.kind === 'ind' && s.reg === 'DE') return [0x1A];
        if (s.kind === 'mem') return [0x3A, ...imm16(s)];
        if (isReg(s, 'I')) return [0xED, 0x57];
        if (isReg(s, 'R')) return [0xED, 0x5F];
      }
      if (isReg(s, 'A')) {
        if (d.kind === 'ind' && d.reg === 'BC') return [0x02];
        if (d.kind === 'ind' && d.reg === 'DE') return [0x12];
        if (d.kind === 'mem') return [0x32, ...imm16(d)];
        if (isReg(d, 'I')) return [0xED, 0x47];
        if (isReg(d, 'R')) return [0xED, 0x4F];
      }
      if (d.kind === 'reg' && d.reg in RP) {
        if (s.kind === 'imm') return [0x01 | RP[d.reg] << 4, ...imm16(s)];
        if (s.kind === 'mem') return d.reg === 'HL' ? [0x2A, ...imm16(s)] : [0xED, 0x4B | RP[d.reg] << 4, ...imm16(s)];
        if (d.reg === 'SP' && isReg(s, 'HL')) return [0xF9];
        if (d.reg === 'SP' && s.kind === 'reg' && s.reg in IDX) return [IDX[s.reg], 0xF9];
      }
      if (d.kind === 'reg' && d.reg in IDX) {
        if (s.kind === 'imm') return [IDX[d.reg], 0x21, ...imm16(s)];
        if (s.kind === 'mem') return [IDX[d.reg], 0x2A, ...imm16(s)];
      }
      if (d.kind === 'mem' && s.kind === 'reg') {
        if (s.reg === 'HL') return [0x22, ...imm16(d)];
        if (s.reg in RP) return [0xED, 0x43 | RP[s.reg] << 4, ...imm16(d)];
        if (s.reg in IDX) return [IDX[s.reg], 0x22, ...imm16(d)];
      }
      return bad();
    }
    case 'INC':
    case 'DEC': {
      count(1);
      const o = ops[0], inc = mn === 'INC';
      if (o.kind === 'reg' && o.reg in RP) return [(inc ? 0x03 : 0x0B) | RP[o.reg] << 4];
      if (o.kind === 'reg' && o.reg in IDX) return [IDX[o.reg], inc ? 0x23 : 0x2B];
      const r = r8(o);
      if (r) return pre(r, (inc ? 0x04 : 0x05) | r.code << 3);
      return bad();
    }
    case 'PUSH':
    case 'POP': {
      count(1);
      const o = ops[0], push = mn === 'PUSH';
      if (o.kind === 'reg' && o.reg in RP_PUSH) return [(push ? 0xC5 : 0xC1) | RP_PUSH[o.reg] << 4];
      if (o.kind === 'reg' && o.reg in IDX) return [IDX[o.reg], push ? 0xE5 : 0xE1];
      return bad();
    }
    case 'EX': {
      count(2);
      const key = o => o.kind === 'reg' ? o.reg : o.kind === 'ind' ? `(${o.reg})` : '?';
      const pair = [key(ops[0]), key(ops[1])].sort().join(',');
      switch (pair) {
        case "AF,AF'": case 'AF,AF': return [0x08];
        case 'DE,HL': return [0xEB];
        case '(SP),HL': return [0xE3];
        case '(SP),IX': return [0xDD, 0xE3];
        case '(SP),IY': return [0xFD, 0xE3];
      }
      return bad();
    }
    case 'JP': {
      if (ops.length === 1) {
        const o = ops[0];
        if ((o.kind === 'ind' && o.reg === 'HL') || isReg(o, 'HL')) return [0xE9];
        if ((o.kind === 'idx' && !o.dispToks) || (o.kind === 'reg' && o.reg in IDX)) return [IDX[o.reg], 0xE9];
        if (o.kind === 'imm') return [0xC3, ...imm16(o)];
        return bad();
      }
      count(2);
      const cc = cond(ops[0]);
      if (cc === null || ops[1].kind !== 'imm') bad();
      return [0xC2 | cc << 3, ...imm16(ops[1])];
    }
    case 'CALL': {
      count(1, 2);
      if (ops.length === 1) {
        if (ops[0].kind !== 'imm') bad();
        return [0xCD, ...imm16(ops[0])];
      }
      const cc = cond(ops[0]);
      if (cc === null || ops[1].kind !== 'imm') bad();
      return [0xC4 | cc << 3, ...imm16(ops[1])];
    }
    case 'RET': {
      count(0, 1);
      if (!ops.length) return [0xC9];
      const cc = cond(ops[0]);
      if (cc === null) bad();
      return [0xC0 | cc << 3];
    }
    case 'JR': {
      count(1, 2);
      if (ops.length === 1) {
        if (ops[0].kind !== 'imm') bad();
        return [0x18, rel(ops[0])];
      }
      const cc = cond(ops[0]);
      if (cc === null || ops[1].kind !== 'imm') bad();
      if (cc > 3) throw new AsmError(`condition not allowed with JR: ${ops[0].text}`);
      return [0x20 | cc << 3, rel(ops[1])];
    }
    case 'DJNZ':
      count(1);
      if (ops[0].kind !== 'imm') bad();
      return [0x10, rel(ops[0])];
    case 'RST': {
      count(1);
      if (ops[0].kind !== 'imm') bad();
      const v = val(ops[0]);
      if (v >= 0 && v <= 0x38 && v % 8 === 0) return [0xC7 | v];
      if (v >= 0 && v <= 7) return [0xC7 | v << 3];
      env.valueError(`invalid RST address: ${hex(v)}`);
      return [0xC7];
    }
    case 'IM': {
      count(1);
      if (ops[0].kind !== 'imm') bad();
      const v = val(ops[0]);
      const code = { 0: 0x46, 1: 0x56, 2: 0x5E }[v];
      if (code === undefined) { env.valueError(`invalid interrupt mode: ${v}`); return [0xED, 0x46]; }
      return [0xED, code];
    }
    case 'IN': {
      count(1, 2);
      if (ops.length === 1) {
        if (ops[0].kind === 'ind' && ops[0].reg === 'C') return [0xED, 0x70];
        return bad();
      }
      const [d, s] = ops;
      if (isReg(d, 'A') && s.kind === 'mem') return [0xDB, imm8(s)];
      if (s.kind === 'ind' && s.reg === 'C') {
        if (isReg(d, 'F')) return [0xED, 0x70];
        const r = plain(d);
        if (r) return [0xED, 0x40 | r.code << 3];
      }
      return bad();
    }
    case 'OUT': {
      count(2);
      const [d, s] = ops;
      if (d.kind === 'mem' && isReg(s, 'A')) return [0xD3, imm8(d)];
      if (d.kind === 'ind' && d.reg === 'C') {
        const r = plain(s);
        if (r) return [0xED, 0x41 | r.code << 3];
        if (s.kind === 'imm') {
          const v = val(s);
          if (v !== 0) env.valueError(`only the value 0 is allowed in OUT (C),n: ${v}`);
          return [0xED, 0x71];
        }
      }
      return bad();
    }
  }
  throw new AsmError(`unknown instruction: ${mn}`);
}

/* =====================================================================
   Passes
   ===================================================================== */
const splitLines = text => text.split(/\r\n|\r|\n/);

function lookup(st, name) {
  const up = name.toUpperCase();
  if (REGISTERS.has(up)) throw new AsmError(`unexpected register in an expression: ${up}`);
  if (st.symbols.has(up)) return st.symbols.get(up);
  if (st.prev && st.prev.has(up)) return st.prev.get(up);
  return undefined;
}

// value === null: EQU whose value depends on a symbol not yet known.
function define(st, tok, value, env) {
  const name = tok.v.toUpperCase();
  if (RESERVED.has(name)) { env.error(`reserved name, cannot be used as a symbol: ${tok.v}`); return; }
  if (st.symbols.has(name) || st.pending.has(name)) { env.error(`symbol already defined: ${name}`); return; }
  if (value === null) st.pending.add(name);
  else st.symbols.set(name, value);
}

function emit(st, bytes, env, line) {
  const start = st.pc;
  let n = bytes.length;
  if (!n) return bytes;
  if (start + n > 0x10000) {
    if (!st.overflow) env.error(`code goes past address &FFFF`);
    st.overflow = true;
    n = Math.max(0, 0x10000 - start);
  }
  if (n) {
    if (st.firstByte === null) st.firstByte = start;
    let seg = st.segments[st.segments.length - 1];
    if (!seg || seg.start + seg.data.length !== start) {
      seg = { start, data: [] };
      st.segments.push(seg);
    }
    let overlap = 0;
    for (let k = 0; k < n; k++) {
      const a = start + k;
      if (st.owner[a] && !overlap) overlap = st.owner[a];
      st.owner[a] = line;
      seg.data.push(bytes[k]);
    }
    if (overlap) env.warn(`overlap: line ${overlap} already placed code at this address`);
  }
  st.pc = start + bytes.length;
  return n === bytes.length ? bytes : bytes.slice(0, n);
}

function loadInclude(st, name) {
  const include = st.options.include;
  if (typeof include !== 'function') throw new AsmError(`INCLUDE failed: no file access for '${name}'`);
  if (!st.includeCache.has(name)) {
    try {
      const text = include(name);
      st.includeCache.set(name, text == null ? { error: 'file not found' } : { text: String(text) });
    } catch (e) {
      st.includeCache.set(name, { error: e && e.message ? e.message : String(e) });
    }
  }
  const entry = st.includeCache.get(name);
  if (entry.error) throw new AsmError(`INCLUDE failed: ${name} (${entry.error})`);
  return entry.text;
}

function processLine(st, text, env, where) {
  const toks = tokenize(text);
  const none = { addr: null, bytes: [] };
  if (!toks.length) return none;

  // Label: identifier followed by ':', name before EQU / =, or identifier in column 0
  // that is neither an instruction nor a directive.
  let i = 0, label = null;
  const first = toks[0], next = toks[1];
  if (first.t === 'id') {
    const nextUp = next && next.t === 'id' ? next.v.toUpperCase() : null;
    const up = first.v.toUpperCase();
    if (isOp(next, ':')) { label = first; i = 2; }
    else if (nextUp === 'EQU' || isOp(next, '=')) { label = first; i = 1; }
    else if (first.s === 0 && !MNEMONICS.has(up) && !DIRECTIVES.has(up)) { label = first; i = 1; }
  }

  const head = toks[i];
  if (!head) {
    if (label) define(st, label, st.pc, env);
    return { addr: label ? st.pc : null, bytes: [] };
  }
  let mn;
  if (isOp(head, '=')) mn = 'EQU';
  else if (head.t === 'id') mn = head.v.toUpperCase();
  else throw new AsmError(`instruction expected: ${head.raw}`);
  const rest = toks.slice(i + 1);
  const operands = () => rest.length ? splitOperands(rest) : [];

  if (mn === 'EQU') {
    if (!label) throw new AsmError('EQU without a symbol name');
    if (!rest.length) throw new AsmError('missing value for EQU');
    const v = evaluate(rest, env);
    define(st, label, env.undef.size ? null : v, env);
    return none;
  }

  if (mn === 'ORG') {
    const ops = operands();
    if (ops.length !== 1) throw new AsmError('ORG expects an address');
    const v = evaluate(ops[0], env);
    if (v < 0 || v > 0xFFFF) env.valueError(`ORG address out of range: ${v}`);
    st.pc = v & 0xFFFF;
    st.overflow = false;
    if (label) define(st, label, st.pc, env);
    return { addr: label ? st.pc : null, bytes: [] };
  }

  if (label) define(st, label, st.pc, env);
  const labelAddr = label ? st.pc : null;
  const result = bytes => {
    const out = emit(st, bytes, env, where.line);
    return { addr: out.length ? env.pc : labelAddr, bytes: out };
  };

  switch (mn) {
    case 'DB': case 'DEFB': case 'DM': case 'DEFM': {
      const ops = operands();
      if (!ops.length) throw new AsmError(`missing value for ${mn}`);
      const bytes = [];
      for (const op of ops) {
        if (op.length === 1 && op[0].t === 'str') {
          for (const ch of op[0].v) bytes.push(byte(ch.charCodeAt(0), env));
        } else {
          bytes.push(byte(evaluate(op, env), env));
        }
      }
      return result(bytes);
    }
    case 'DW': case 'DEFW': {
      const ops = operands();
      if (!ops.length) throw new AsmError(`missing value for ${mn}`);
      const bytes = [];
      for (const op of ops) bytes.push(...word(evaluate(op, env), env));
      return result(bytes);
    }
    case 'DS': case 'DEFS': {
      const ops = operands();
      if (ops.length < 1 || ops.length > 2) throw new AsmError(`${mn} expects a size and optionally a fill byte`);
      let n = evaluate(ops[0], env);
      const fill = ops.length === 2 ? byte(evaluate(ops[1], env), env) : 0;
      if (n < 0 || n > 0x10000) { env.valueError(`invalid size for ${mn}: ${n}`); n = 0; }
      return result(new Array(n).fill(fill));
    }
    case 'ALIGN': {
      const ops = operands();
      if (ops.length < 1 || ops.length > 2) throw new AsmError('ALIGN expects an alignment and optionally a fill byte');
      const n = evaluate(ops[0], env);
      const fill = ops.length === 2 ? byte(evaluate(ops[1], env), env) : 0;
      if (n < 1 || n > 0x10000) { env.valueError(`invalid alignment: ${n}`); return result([]); }
      return result(new Array((n - st.pc % n) % n).fill(fill));
    }
    case 'END': {
      if (rest.length) {
        const v = evaluate(rest, env);
        if (!env.undef.size) st.endEntry = v & 0xFFFF;
      }
      st.ended = true;
      return { addr: labelAddr, bytes: [] };
    }
    case 'INCLUDE': {
      if (rest.length !== 1 || rest[0].t !== 'str') throw new AsmError('INCLUDE expects a quoted file name');
      const name = rest[0].v;
      if (where.depth >= MAX_INCLUDE_DEPTH) throw new AsmError(`INCLUDE nested too deeply: ${name}`);
      const content = loadInclude(st, name);
      // Included code is attributed to the INCLUDE line in the listing.
      const agg = { addr: null, bytes: [] };
      splitLines(content).forEach((t, k) => {
        if (st.ended) return;
        const r = assembleLine(st, t, { line: where.line, file: name, fileLine: k + 1, depth: where.depth + 1 });
        if (r.bytes.length && agg.addr === null) agg.addr = r.addr;
        for (const b of r.bytes) agg.bytes.push(b);
      });
      if (agg.addr === null) agg.addr = labelAddr;
      return agg;
    }
  }

  if (!MNEMONICS.has(mn)) throw new AsmError(`unknown instruction: ${head.v}`);
  const ops = operands().map(t => parseOperand(t, text));
  return result(encode(mn, ops, env));
}

function assembleLine(st, text, where) {
  const diag = { errors: [], warnings: [], undef: new Set() };
  const env = {
    pc: st.pc,
    undef: diag.undef,
    symbol: name => {
      const v = lookup(st, name);
      if (v === undefined) { diag.undef.add(name.toUpperCase()); return 0; }
      return v;
    },
    error: message => diag.errors.push({ message, value: false }),
    valueError: message => diag.errors.push({ message, value: true }),
    warn: message => diag.warnings.push(message),
  };
  let res = { addr: null, bytes: [] };
  try {
    res = processLine(st, text, env, where);
  } catch (e) {
    if (!(e instanceof AsmError)) throw e;
    diag.errors.push({ message: e.message, value: false });
  }
  // An unknown symbol makes the value checks meaningless: keep only that error.
  let errors = diag.errors, warnings = diag.warnings;
  if (diag.undef.size) {
    errors = [...[...diag.undef].map(n => ({ message: `unknown symbol: ${n}` })), ...errors.filter(e => !e.value)];
    warnings = [];
  }
  const prefix = where.file ? `${where.file}, line ${where.fileLine}: ` : '';
  for (const e of errors) st.errors.push({ line: where.line, message: prefix + e.message });
  for (const w of warnings) st.warnings.push({ line: where.line, message: prefix + w });
  return res;
}

function runPass(source, origin, options, includeCache, prev) {
  const st = {
    pc: origin & 0xFFFF, symbols: new Map(), pending: new Set(), prev, options, includeCache,
    errors: [], warnings: [], segments: [], listing: [],
    firstByte: null, endEntry: null, ended: false, overflow: false,
    owner: new Int32Array(0x10000),
  };
  splitLines(source).forEach((text, k) => {
    const line = k + 1;
    if (st.ended) { st.listing.push({ line, addr: null, bytes: [], source: text }); return; }
    const r = assembleLine(st, text, { line, file: null, fileLine: line, depth: 0 });
    st.listing.push({ line, addr: r.addr, bytes: r.bytes, source: text });
  });
  return st;
}

function sameSymbols(a, b) {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

/* =====================================================================
   API
   ===================================================================== */
export function assemble(source, options = {}) {
  const origin = options.origin ?? 0;
  const includeCache = new Map();
  const text = String(source ?? '');
  let prev = null, st = null, stable = false;
  for (let pass = 1; pass <= MAX_PASSES; pass++) {
    st = runPass(text, origin, options, includeCache, prev);
    if (prev && sameSymbols(prev, st.symbols)) { stable = true; break; }
    prev = st.symbols;
  }
  const errors = st.errors;
  if (!stable) errors.push({ line: 1, message: 'symbol values do not settle (circular definitions?)' });
  return {
    ok: errors.length === 0,
    errors,
    warnings: st.warnings,
    segments: st.segments.map(s => ({ start: s.start, bytes: Uint8Array.from(s.data) })),
    symbols: Object.fromEntries(st.symbols),
    listing: st.listing,
    entry: st.endEntry ?? st.firstByte,
  };
}

export function toImage(result, size = 0x10000) {
  const image = new Uint8Array(size);
  for (const seg of result.segments) {
    for (let k = 0; k < seg.bytes.length; k++) {
      const a = seg.start + k;
      if (a < size) image[a] = seg.bytes[k];
    }
  }
  return image;
}
