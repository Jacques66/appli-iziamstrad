import { hex } from './util.js';

/* Turns the machine-cycle trace of an instruction into a sequence of annotated T-states
   for the CPU inside view: active blocks and paths, signals, buses. */

const ALU8 = new Set('ADD ADC SUB SBC AND OR XOR CP NEG DAA CPL SCF CCF RLCA RRCA RLA RRA RLC RRC RL RR SLA SRA SLL SRL BIT SET RES RLD RRD CPI CPD CPIR CPDR'.split(' '));
const PAIRS = new Set(['BC', 'DE', 'HL', 'SP', 'IX', 'IY']);
const PREFIX_NAME = { 0xCB: 'CB (rotates, bits)', 0xDD: 'DD (IX)', 0xED: 'ED (extended)', 0xFD: 'FD (IY)' };
const REG_ORDER = ['A', 'F', 'B', 'C', 'D', 'E', 'H', 'L', 'IX', 'IY', 'SP', 'PC', 'I', 'R', "A'", "F'", "B'", "C'", "D'", "E'", "H'", "L'"];

function category(d) {
  const m = d.mnemonic, op0 = d.operands[0];
  if ((m === 'INC' || m === 'DEC') && PAIRS.has(op0)) return 'inc16';
  if (m === 'INC' || m === 'DEC') return 'alu';
  if ((m === 'ADD' || m === 'ADC' || m === 'SBC') && PAIRS.has(op0)) return 'alu16';
  if (ALU8.has(m)) return 'alu';
  if (m === 'JR' || m === 'DJNZ') return 'rel';
  return 'move';
}

// Register that supplies the address of a memory access
function addrSource(addr, before, k) {
  const pair = (h, l) => (before[h] << 8) | before[l];
  if (addr >= before.PC && addr < before.PC + 4) return { name: 'PC', regs: ['PC'], operand: true };
  if (addr === pair('H', 'L')) return { name: 'HL', regs: ['H', 'L'] };
  if (addr === pair('B', 'C')) return { name: 'BC', regs: ['B', 'C'] };
  if (addr === pair('D', 'E')) return { name: 'DE', regs: ['D', 'E'] };
  if (Math.abs(addr - before.SP) <= 2 || Math.abs(addr - ((before.SP - 2) & 0xFFFF)) <= 2) return { name: 'SP', regs: ['SP'] };
  if (Math.abs(addr - before.IX) <= 128 && k > 0) return { name: 'IX+d', regs: ['IX'] };
  if (Math.abs(addr - before.IY) <= 128 && k > 0) return { name: 'IY+d', regs: ['IY'] };
  return { name: 'computed address (WZ)', regs: [] };
}

const EXEC = {
  alu: { blocks: ['b-acc', 'b-tmp', 'b-alu', 'b-f', 'b-rf'], paths: ['p-bus-acc', 'p-bus-tmp', 'p-acc-alu', 'p-tmp-alu', 'p-alu-f', 'p-alu-bus', 'p-db-bus', 'p-bus-rf', 'p-seq-alu'] },
  alu16: { blocks: ['b-alu', 'b-f', 'b-rf', 'b-acc', 'b-tmp'], paths: ['p-acc-alu', 'p-tmp-alu', 'p-alu-f', 'p-alu-bus', 'p-bus-rf', 'p-seq-alu'] },
  inc16: { blocks: ['b-inc', 'b-rf'], paths: ['p-rf-inc', 'p-inc-rf', 'p-seq-rf'] },
  rel: { blocks: ['b-alu', 'b-rf', 'b-inc'], paths: ['p-rf-inc', 'p-inc-rf', 'p-seq-alu'] },
  move: { blocks: ['b-rf', 'b-seq'], paths: ['p-seq-rf', 'p-bus-rf', 'p-db-bus'] },
};

export function changedRegs(before, after) {
  return REG_ORDER.filter(r => before[r] !== after[r]);
}

export function microSteps(trace, d, before, after) {
  // merges internal states (X) into the preceding machine cycle
  const cycles = [];
  for (const c of trace) {
    if (c.wait) { cycles.push({ ...c, type: 'WAIT', extra: c.t, base: 0 }); continue; }
    if (c.type === 'X' && cycles.length) { cycles[cycles.length - 1].extra += c.t; continue; }
    cycles.push({ ...c, extra: c.type === 'X' ? c.t : 0, base: c.type === 'X' ? 0 : c.t });
  }
  const cat = category(d), ex = EXEC[cat];
  const chg = changedRegs(before, after);
  const execTxt = chg.length ? ' Result: ' + chg.filter(r => r !== 'R' && r !== 'PC').map(r => `${r} ← &${hex(after[r], r.length > 1 && !r.endsWith("'") ? 4 : 2)}`).join(', ') : '';
  const steps = [];
  let mIndex = 0;
  cycles.forEach((c, ci) => {
    mIndex++;
    const m = 'M' + mIndex, total = c.base + c.extra;
    const lastCycle = ci === cycles.length - 1;
    for (let t = 1; t <= total; t++) {
      const s = { m, mtype: c.type, t, total, addr: null, data: null, blocks: [], paths: [], regs: [], pins: [], title: '', desc: '' };
      const internal = t > c.base;
      if (c.type === 'WAIT') {
        s.m = 'Tw'; s.title = 'Wait state (/WAIT)';
        s.desc = `The Gate Array holds /WAIT low (${c.extra} T): it reserves the RAM for video and aligns every Z80 instruction on a multiple of 4 T-states.`;
        s.blocks = ['b-seq']; s.paths = []; s.pins = ['WAIT'];
      } else if (internal) {
        s.title = 'Internal state';
        s.desc = `Internal T-state (${c.extra} in total in this cycle): ` + (cat === 'inc16' ? 'the 16-bit incrementer computes the new value of the pair.' :
          cat === 'alu16' ? 'the ALU processes the 16-bit operation in two 8-bit passes.' :
          cat === 'rel' ? 'the jump address PC + displacement is computed.' :
          cat === 'alu' ? 'the ALU computes the result.' : 'transfer between internal registers.');
        s.blocks = ex.blocks.slice(); s.paths = ex.paths.slice();
        s.addr = c.type === 'M1' ? c.refresh : c.addr;
      } else if (c.type === 'M1') {
        const pf = PREFIX_NAME[c.data] && !lastCycle ? PREFIX_NAME[c.data] : null;
        if (t === 1) {
          s.title = 'Opcode fetch: address';
          s.desc = `PC (&${hex(c.addr, 4)}) is placed on the address bus; /M1 goes low.`;
          s.blocks = ['b-rf', 'b-ab']; s.paths = ['p-rf-ab', 'p-ab-out']; s.regs = ['PC']; s.pins = ['M1']; s.addr = c.addr;
        } else if (t === 2) {
          s.title = 'Opcode read';
          s.desc = `/MREQ and /RD low: memory returns &${hex(c.data)}. The incrementer prepares PC + 1 = &${hex((c.addr + 1) & 0xFFFF, 4)}.`;
          s.blocks = ['b-ab', 'b-db', 'b-inc', 'b-rf']; s.paths = ['p-ab-out', 'p-db-in', 'p-rf-inc', 'p-inc-rf']; s.regs = ['PC']; s.pins = ['M1', 'MREQ', 'RD']; s.addr = c.addr; s.data = c.data;
        } else if (t === 3) {
          s.title = 'Latch into IR + refresh';
          s.desc = `Rising edge of T3: &${hex(c.data)} enters the instruction register. DRAM refresh: I·R = &${hex(c.refresh, 4)} on the address bus, /RFSH low.`;
          s.blocks = ['b-db', 'b-ir', 'b-rf', 'b-ab']; s.paths = ['p-db-in', 'p-db-bus', 'p-bus-ir', 'p-rf-ab', 'p-ab-out']; s.regs = ['I', 'R']; s.pins = ['MREQ', 'RFSH']; s.addr = c.refresh; s.ir = c.data;
        } else {
          s.title = pf ? 'Prefix' : 'Decode';
          s.desc = pf ? `&${hex(c.data)} is a prefix: the decoder switches to the ${pf} table.` : `The decoder recognizes ${d.text}.`;
          s.blocks = ['b-ir', 'b-dec', 'b-seq']; s.paths = ['p-ir-dec', 'p-dec-seq']; s.pins = ['RFSH']; s.addr = c.refresh; s.dec = pf ? 'prefix ' + hex(c.data) : d.text;
          if (lastCycle && !c.extra) { s.blocks.push(...ex.blocks); s.paths.push(...ex.paths); }
        }
      } else if (c.type === 'MR' || c.type === 'MW') {
        const src = addrSource(c.addr, before, ci);
        const rd = c.type === 'MR';
        s.addr = c.addr;
        if (t === 1) {
          s.title = rd ? 'Memory read: address' : 'Memory write: address';
          s.desc = `${src.operand ? 'Operand read: PC' : src.name} supplies the address &${hex(c.addr, 4)}, placed on the address bus.`;
          s.blocks = ['b-rf', 'b-ab']; s.paths = ['p-rf-ab', 'p-ab-out']; s.regs = src.regs;
        } else if (t === 2) {
          s.title = rd ? 'Memory responds' : 'Data on the bus';
          s.desc = rd ? `/MREQ and /RD low: memory returns &${hex(c.data)}.` : `/MREQ low: the CPU drives &${hex(c.data)} onto D0–D7.`;
          s.blocks = rd ? ['b-ab', 'b-db'] : ['b-rf', 'b-db', 'b-ab']; s.paths = rd ? ['p-ab-out', 'p-db-in'] : ['p-bus-rf', 'p-db-bus', 'p-db-in', 'p-ab-out'];
          s.pins = rd ? ['MREQ', 'RD'] : ['MREQ']; s.data = c.data;
          if (src.operand) { s.blocks.push('b-inc'); s.paths.push('p-rf-inc', 'p-inc-rf'); }
        } else {
          s.title = rd ? 'Data latch' : 'Write';
          s.desc = rd ? `Byte &${hex(c.data)} is latched by the data buffer and travels over the internal bus${src.operand ? ' (instruction operand)' : ''}.` : `/WR low: memory stores &${hex(c.data)} at address &${hex(c.addr, 4)}.`;
          s.blocks = ['b-db']; s.paths = rd ? ['p-db-in', 'p-db-bus'] : ['p-db-in'];
          s.pins = rd ? ['MREQ', 'RD'] : ['MREQ', 'WR']; s.data = c.data;
          if (rd && lastCycle) { s.blocks.push(...ex.blocks); s.paths.push(...ex.paths); }
        }
      } else if (c.type === 'IOR' || c.type === 'IOW') {
        const rd = c.type === 'IOR';
        s.addr = c.addr;
        const titles = [rd ? 'Input cycle: port address' : 'Output cycle: port address', rd ? '/IORQ and /RD low' : '/IORQ and /WR low', 'Automatic wait state (TW)', rd ? 'Data latch' : 'End of output cycle'];
        const descs = [
          `Port &${hex(c.addr & 0xFF)} is placed on A0–A7 (A8–A15 = &${hex(c.addr >> 8)}).`,
          rd ? '/IORQ and /RD go low: the selected device must respond.' : `/IORQ and /WR go low: the CPU presents &${hex(c.data)} to the device.`,
          'The Z80 always inserts a wait state into I/O cycles to give slow devices time to respond; /WAIT is sampled.',
          rd ? `The device returns &${hex(c.data)}, latched by the data buffer.` : `The device has latched &${hex(c.data)}.`,
        ];
        s.title = titles[t - 1]; s.desc = descs[t - 1];
        s.blocks = t === 1 ? ['b-rf', 'b-ab'] : ['b-ab', 'b-db']; s.paths = t === 1 ? ['p-rf-ab', 'p-ab-out'] : ['p-ab-out', 'p-db-in'];
        if (!rd && t > 1) s.paths.push('p-db-bus', 'p-bus-rf');
        if (rd && t === 4) s.paths.push('p-db-bus', 'p-bus-rf');
        s.pins = t === 1 ? [] : ['IORQ', rd ? 'RD' : 'WR'];
        if (t > 1) s.data = c.data;
      } else if (c.type === 'INTA') {
        s.title = 'Interrupt acknowledge';
        s.desc = t <= 2 ? '/M1 goes low without /MREQ: the CPU signals that it accepts the interrupt.' : t <= c.base - 2 ? `/M1 and /IORQ low: the device places &${hex(c.data)} on the data bus.` : 'DRAM refresh, then PC is saved on the stack.';
        s.blocks = ['b-int', 'b-seq']; s.paths = ['p-dec-seq']; s.pins = t <= c.base - 2 ? ['M1', ...(t > 2 ? ['IORQ'] : [])] : ['RFSH', 'MREQ'];
        s.addr = t <= c.base - 2 ? c.addr : c.refresh; s.data = t > 2 ? c.data : null;
      }
      steps.push(s);
    }
  });
  if (steps.length) {
    const last = steps[steps.length - 1];
    last.final = true;
    last.regs = [...new Set([...last.regs, ...chg])];
    last.desc += execTxt ? ' End of instruction.' + execTxt + '.' : ' End of instruction.';
  }
  return steps;
}
