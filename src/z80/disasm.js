/* Z80 Studio — désassembleur Z80.
   Décode les tables non préfixée, CB, ED, DD, FD, DDCB et FDCB, y compris les
   opcodes non documentés (IXH/IXL, SLL, doublons d'ED, DDCB avec copie dans un
   registre). Le texte produit est réassemblable par l'assembleur du projet.
   Les durées sont celles de Zilog ; [pris, non pris] pour les instructions
   conditionnelles et les répétitions de blocs. */

const R8 = ['B', 'C', 'D', 'E', 'H', 'L', '(HL)', 'A'];
const RP = ['BC', 'DE', 'HL', 'SP'];
const RP2 = ['BC', 'DE', 'HL', 'AF'];
const CC = ['NZ', 'Z', 'NC', 'C', 'PO', 'PE', 'P', 'M'];
const ALU = ['ADD', 'ADC', 'SUB', 'SBC', 'AND', 'XOR', 'OR', 'CP'];
const ROT = ['RLC', 'RRC', 'RL', 'RR', 'SLA', 'SRA', 'SLL', 'SRL'];
const ACC = ['RLCA', 'RRCA', 'RLA', 'RRA', 'DAA', 'CPL', 'SCF', 'CCF'];
const IM_MODE = ['0', '0', '1', '2', '0', '0', '1', '2'];
const BLOCK = [
  ['LDI', 'CPI', 'INI', 'OUTI'],
  ['LDD', 'CPD', 'IND', 'OUTD'],
  ['LDIR', 'CPIR', 'INIR', 'OTIR'],
  ['LDDR', 'CPDR', 'INDR', 'OTDR'],
];

const hex = (v, n) => v.toString(16).toUpperCase().padStart(n, '0');
const byte = v => '&' + hex(v & 0xFF, 2);
const word = v => '&' + hex(v & 0xFFFF, 4);
const signed = b => (b & 0x80 ? b - 256 : b);
const indexed = (idx, d) => `(${idx}${d < 0 ? '-' : '+'}${byte(Math.abs(d))})`;

function ins(mnemonic, operands, tstates, target = null, flow = null) {
  return { mnemonic, operands, tstates, target, flow };
}

// ADD, ADC et SBC portent l'accumulateur explicitement ; les autres non
function alu(y, operand, tstates) {
  const ops = y === 0 || y === 1 || y === 3 ? ['A', operand] : [operand];
  return ins(ALU[y], ops, tstates);
}

/* Contexte de décodage : lecture des octets, et substitution HL -> IX/IY
   quand un préfixe DD/FD est actif. `used` indique que le préfixe a servi,
   `indexedMem` que (HL) est devenu (IX+d). */
function makeContext(addr, bytes, fetch, idx) {
  let disp = null;
  const c = {
    used: false,
    indexedMem: false,
    fetch,
    next: () => (addr + bytes.length) & 0xFFFF,
    n: () => byte(fetch()),
    nn: () => {
      const lo = fetch();
      return lo | (fetch() << 8);
    },
    hl: () => {
      if (!idx) return 'HL';
      c.used = true;
      return idx;
    },
    rp: p => (p === 2 ? c.hl() : RP[p]),
    rp2: p => (p === 2 ? c.hl() : RP2[p]),
    r: i => {
      if (!idx || i < 4 || i > 6) return R8[i];
      c.used = true;
      if (i === 6) {
        c.indexedMem = true;
        if (disp === null) disp = signed(fetch());
        return indexed(idx, disp);
      }
      return idx + (i === 4 ? 'H' : 'L');
    },
  };
  return c;
}

// Table principale (sans préfixe, ou derrière DD/FD via le contexte)
function decodeMain(op, c) {
  const x = op >> 6, y = (op >> 3) & 7, z = op & 7, p = y >> 1, q = y & 1;

  if (x === 0) {
    switch (z) {
      case 0: {
        if (y === 0) return ins('NOP', [], 4);
        if (y === 1) return ins('EX', ['AF', "AF'"], 4);
        const e = signed(c.fetch());
        const target = (c.next() + e) & 0xFFFF;
        if (y === 2) return ins('DJNZ', [word(target)], [13, 8], target, 'cond-jump');
        if (y === 3) return ins('JR', [word(target)], 12, target, 'jump');
        return ins('JR', [CC[y - 4], word(target)], [12, 7], target, 'cond-jump');
      }
      case 1:
        if (q === 0) return ins('LD', [c.rp(p), word(c.nn())], 10);
        return ins('ADD', [c.hl(), c.rp(p)], 11);
      case 2:
        switch (y) {
          case 0: return ins('LD', ['(BC)', 'A'], 7);
          case 1: return ins('LD', ['A', '(BC)'], 7);
          case 2: return ins('LD', ['(DE)', 'A'], 7);
          case 3: return ins('LD', ['A', '(DE)'], 7);
          case 4: return ins('LD', [`(${word(c.nn())})`, c.hl()], 16);
          case 5: return ins('LD', [c.hl(), `(${word(c.nn())})`], 16);
          case 6: return ins('LD', [`(${word(c.nn())})`, 'A'], 13);
          default: return ins('LD', ['A', `(${word(c.nn())})`], 13);
        }
      case 3:
        return ins(q ? 'DEC' : 'INC', [c.rp(p)], 6);
      case 4:
        return ins('INC', [c.r(y)], y === 6 ? 11 : 4);
      case 5:
        return ins('DEC', [c.r(y)], y === 6 ? 11 : 4);
      case 6: {
        // le déplacement (IX+d) précède l'octet immédiat
        const dst = c.r(y);
        return ins('LD', [dst, c.n()], y === 6 ? 10 : 7);
      }
      default:
        return ins(ACC[y], [], 4);
    }
  }

  if (x === 1) {
    if (op === 0x76) return ins('HALT', [], 4, null, 'halt');
    // avec (IX+d), H et L gardent leur sens ordinaire
    if (y === 6) return ins('LD', [c.r(6), R8[z]], 7);
    if (z === 6) return ins('LD', [R8[y], c.r(6)], 7);
    return ins('LD', [c.r(y), c.r(z)], 4);
  }

  if (x === 2) return alu(y, c.r(z), z === 6 ? 7 : 4);

  switch (z) {
    case 0:
      return ins('RET', [CC[y]], [11, 5], null, 'cond-ret');
    case 1:
      if (q === 0) return ins('POP', [c.rp2(p)], 10);
      if (p === 0) return ins('RET', [], 10, null, 'ret');
      if (p === 1) return ins('EXX', [], 4);
      if (p === 2) return ins('JP', [`(${c.hl()})`], 4, null, 'jump');
      return ins('LD', ['SP', c.hl()], 6);
    case 2: {
      const target = c.nn();
      return ins('JP', [CC[y], word(target)], 10, target, 'cond-jump');
    }
    case 3:
      switch (y) {
        case 0: {
          const target = c.nn();
          return ins('JP', [word(target)], 10, target, 'jump');
        }
        case 2: return ins('OUT', [`(${c.n()})`, 'A'], 11);
        case 3: return ins('IN', ['A', `(${c.n()})`], 11);
        case 4: return ins('EX', ['(SP)', c.hl()], 19);
        case 5: return ins('EX', ['DE', 'HL'], 4);
        case 6: return ins('DI', [], 4);
        case 7: return ins('EI', [], 4);
        default: return null; // CB : traité en amont
      }
    case 4: {
      const target = c.nn();
      return ins('CALL', [CC[y], word(target)], [17, 10], target, 'cond-call');
    }
    case 5:
      if (q === 0) return ins('PUSH', [c.rp2(p)], 11);
      if (p === 0) {
        const target = c.nn();
        return ins('CALL', [word(target)], 17, target, 'call');
      }
      return null; // DD, ED, FD : traités en amont
    case 6:
      return alu(y, c.n(), 7);
    default:
      return ins('RST', [byte(y * 8)], 11, y * 8, 'rst');
  }
}

/* Table CB. `mem` est l'opérande mémoire indexé ((IX+d)) pour DDCB/FDCB,
   ou null pour la forme simple. */
function decodeCB(op, mem) {
  const x = op >> 6, y = (op >> 3) & 7, z = op & 7;
  if (mem === null) {
    const r = R8[z];
    if (x === 0) return ins(ROT[y], [r], z === 6 ? 15 : 8);
    if (x === 1) return ins('BIT', [String(y), r], z === 6 ? 12 : 8);
    return ins(x === 2 ? 'RES' : 'SET', [String(y), r], z === 6 ? 15 : 8);
  }
  if (x === 1) return ins('BIT', [String(y), mem], 20);
  // non documenté : le résultat est aussi copié dans un registre
  const copy = z === 6 ? [] : [R8[z]];
  if (x === 0) return ins(ROT[y], [mem, ...copy], 23);
  return ins(x === 2 ? 'RES' : 'SET', [String(y), mem, ...copy], 23);
}

// Table ED ; null pour un opcode non défini
function decodeED(op, c) {
  const x = op >> 6, y = (op >> 3) & 7, z = op & 7, p = y >> 1, q = y & 1;
  if (x === 1) {
    switch (z) {
      case 0: return ins('IN', [y === 6 ? 'F' : R8[y], '(C)'], 12);
      case 1: return ins('OUT', ['(C)', y === 6 ? '0' : R8[y]], 12);
      case 2: return ins(q ? 'ADC' : 'SBC', ['HL', RP[p]], 15);
      case 3: {
        const a = `(${word(c.nn())})`;
        return ins('LD', q ? [RP[p], a] : [a, RP[p]], 20);
      }
      case 4: return ins('NEG', [], 8);
      case 5: return ins(y === 1 ? 'RETI' : 'RETN', [], 14, null, 'ret');
      case 6: return ins('IM', [IM_MODE[y]], 8);
      default:
        switch (y) {
          case 0: return ins('LD', ['I', 'A'], 9);
          case 1: return ins('LD', ['R', 'A'], 9);
          case 2: return ins('LD', ['A', 'I'], 9);
          case 3: return ins('LD', ['A', 'R'], 9);
          case 4: return ins('RRD', [], 18);
          case 5: return ins('RLD', [], 18);
          default: return null;
        }
    }
  }
  if (x === 2 && z <= 3 && y >= 4) {
    return ins(BLOCK[y - 4][z], [], y >= 6 ? [21, 16] : 16);
  }
  return null;
}

function dataBytes(values, tstates) {
  return ins('DB', values.map(byte), tstates);
}

export function disassemble(read, addr) {
  addr &= 0xFFFF;
  const bytes = [];
  const peek = k => read((addr + k) & 0xFFFF) & 0xFF;
  const fetch = () => {
    const b = peek(bytes.length);
    bytes.push(b);
    return b;
  };

  const op = fetch();
  let r;
  if (op === 0xCB) {
    r = decodeCB(fetch(), null);
  } else if (op === 0xED) {
    const op2 = fetch();
    r = decodeED(op2, makeContext(addr, bytes, fetch, null));
    if (!r) {
      bytes.length = 2;
      r = dataBytes(bytes, 8);
    }
  } else if (op === 0xDD || op === 0xFD) {
    const idx = op === 0xDD ? 'IX' : 'IY';
    const next = peek(1);
    if (next === 0xCB) {
      fetch();
      const d = signed(fetch());
      r = decodeCB(fetch(), indexed(idx, d));
    } else if (next !== 0xDD && next !== 0xFD && next !== 0xED) {
      const c = makeContext(addr, bytes, fetch, idx);
      const op2 = fetch();
      r = decodeMain(op2, c);
      if (c.used) r.tstates += c.indexedMem ? (op2 === 0x36 ? 9 : 12) : 4;
      else r = null;
    }
    if (!r) {
      // préfixe sans effet : il se lit seul, le décodage reprend après lui
      bytes.length = 1;
      r = dataBytes(bytes, 4);
    }
  } else {
    r = decodeMain(op, makeContext(addr, bytes, fetch, null));
  }

  const { mnemonic, operands } = r;
  return {
    addr,
    length: bytes.length,
    bytes,
    text: operands.length ? `${mnemonic} ${operands.join(',')}` : mnemonic,
    mnemonic,
    operands,
    tstates: r.tstates,
    target: r.target,
    flow: r.flow,
  };
}

export function disassembleRange(read, start, count) {
  const out = [];
  let addr = start & 0xFFFF;
  for (let i = 0; i < count; i++) {
    const d = disassemble(read, addr);
    out.push(d);
    addr = (addr + d.length) & 0xFFFF;
  }
  return out;
}
