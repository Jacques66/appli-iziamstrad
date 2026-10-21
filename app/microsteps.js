import { hex } from './util.js';

/* Transforme la trace des cycles machine d'une instruction en une suite de T-states
   commentés pour la vue intérieure du CPU : blocs et chemins actifs, signaux, bus. */

const ALU8 = new Set('ADD ADC SUB SBC AND OR XOR CP NEG DAA CPL SCF CCF RLCA RRCA RLA RRA RLC RRC RL RR SLA SRA SLL SRL BIT SET RES RLD RRD CPI CPD CPIR CPDR'.split(' '));
const PAIRS = new Set(['BC', 'DE', 'HL', 'SP', 'IX', 'IY']);
const PREFIX_NAME = { 0xCB: 'CB (rotations, bits)', 0xDD: 'DD (IX)', 0xED: 'ED (étendue)', 0xFD: 'FD (IY)' };
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

// Registre qui fournit l'adresse d'un accès mémoire
function addrSource(addr, before, k) {
  const pair = (h, l) => (before[h] << 8) | before[l];
  if (addr >= before.PC && addr < before.PC + 4) return { name: 'PC', regs: ['PC'], operand: true };
  if (addr === pair('H', 'L')) return { name: 'HL', regs: ['H', 'L'] };
  if (addr === pair('B', 'C')) return { name: 'BC', regs: ['B', 'C'] };
  if (addr === pair('D', 'E')) return { name: 'DE', regs: ['D', 'E'] };
  if (Math.abs(addr - before.SP) <= 2 || Math.abs(addr - ((before.SP - 2) & 0xFFFF)) <= 2) return { name: 'SP', regs: ['SP'] };
  if (Math.abs(addr - before.IX) <= 128 && k > 0) return { name: 'IX+d', regs: ['IX'] };
  if (Math.abs(addr - before.IY) <= 128 && k > 0) return { name: 'IY+d', regs: ['IY'] };
  return { name: 'adresse calculée (WZ)', regs: [] };
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
  // regroupe les états internes (X) avec le cycle machine qui les précède
  const cycles = [];
  for (const c of trace) {
    if (c.wait) { cycles.push({ ...c, type: 'WAIT', extra: c.t, base: 0 }); continue; }
    if (c.type === 'X' && cycles.length) { cycles[cycles.length - 1].extra += c.t; continue; }
    cycles.push({ ...c, extra: c.type === 'X' ? c.t : 0, base: c.type === 'X' ? 0 : c.t });
  }
  const cat = category(d), ex = EXEC[cat];
  const chg = changedRegs(before, after);
  const execTxt = chg.length ? ' Résultat : ' + chg.filter(r => r !== 'R' && r !== 'PC').map(r => `${r} ← &${hex(after[r], r.length > 1 && !r.endsWith("'") ? 4 : 2)}`).join(', ') : '';
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
        s.m = 'Tw'; s.title = "État d'attente (/WAIT)";
        s.desc = `Le Gate Array maintient /WAIT à 0 (${c.extra} T) : il réserve la RAM à la vidéo et aligne chaque instruction du Z80 sur un multiple de 4 T-states.`;
        s.blocks = ['b-seq']; s.paths = []; s.pins = ['WAIT'];
      } else if (internal) {
        s.title = 'État interne';
        s.desc = `T-state interne (${c.extra} au total dans ce cycle) : ` + (cat === 'inc16' ? "l'incrémenteur 16 bits calcule la nouvelle valeur de la paire." :
          cat === 'alu16' ? "l'UAL traite l'opération 16 bits en deux passes de 8 bits." :
          cat === 'rel' ? "calcul de l'adresse de saut PC + déplacement." :
          cat === 'alu' ? "l'UAL calcule le résultat." : 'transfert entre registres internes.');
        s.blocks = ex.blocks.slice(); s.paths = ex.paths.slice();
        s.addr = c.type === 'M1' ? c.refresh : c.addr;
      } else if (c.type === 'M1') {
        const pf = PREFIX_NAME[c.data] && !lastCycle ? PREFIX_NAME[c.data] : null;
        if (t === 1) {
          s.title = "Recherche d'opcode : adresse";
          s.desc = `Le PC (&${hex(c.addr, 4)}) est placé sur le bus d'adresses ; /M1 passe à 0.`;
          s.blocks = ['b-rf', 'b-ab']; s.paths = ['p-rf-ab', 'p-ab-out']; s.regs = ['PC']; s.pins = ['M1']; s.addr = c.addr;
        } else if (t === 2) {
          s.title = "Lecture de l'opcode";
          s.desc = `/MREQ et /RD à 0 : la mémoire renvoie &${hex(c.data)}. L'incrémenteur prépare PC + 1 = &${hex((c.addr + 1) & 0xFFFF, 4)}.`;
          s.blocks = ['b-ab', 'b-db', 'b-inc', 'b-rf']; s.paths = ['p-ab-out', 'p-db-in', 'p-rf-inc', 'p-inc-rf']; s.regs = ['PC']; s.pins = ['M1', 'MREQ', 'RD']; s.addr = c.addr; s.data = c.data;
        } else if (t === 3) {
          s.title = 'Capture dans IR + rafraîchissement';
          s.desc = `Front montant de T3 : &${hex(c.data)} entre dans le registre d'instruction. Rafraîchissement DRAM : I·R = &${hex(c.refresh, 4)} sur le bus d'adresses, /RFSH à 0.`;
          s.blocks = ['b-db', 'b-ir', 'b-rf', 'b-ab']; s.paths = ['p-db-in', 'p-db-bus', 'p-bus-ir', 'p-rf-ab', 'p-ab-out']; s.regs = ['I', 'R']; s.pins = ['MREQ', 'RFSH']; s.addr = c.refresh; s.ir = c.data;
        } else {
          s.title = pf ? 'Préfixe' : 'Décodage';
          s.desc = pf ? `&${hex(c.data)} est un préfixe : le décodeur bascule sur la table ${pf}.` : `Le décodeur reconnaît ${d.text}.`;
          s.blocks = ['b-ir', 'b-dec', 'b-seq']; s.paths = ['p-ir-dec', 'p-dec-seq']; s.pins = ['RFSH']; s.addr = c.refresh; s.dec = pf ? 'préfixe ' + hex(c.data) : d.text;
          if (lastCycle && !c.extra) { s.blocks.push(...ex.blocks); s.paths.push(...ex.paths); }
        }
      } else if (c.type === 'MR' || c.type === 'MW') {
        const src = addrSource(c.addr, before, ci);
        const rd = c.type === 'MR';
        s.addr = c.addr;
        if (t === 1) {
          s.title = rd ? 'Lecture mémoire : adresse' : 'Écriture mémoire : adresse';
          s.desc = `${src.operand ? "Lecture d'un opérande : le PC" : src.name} fournit l'adresse &${hex(c.addr, 4)}, placée sur le bus d'adresses.`;
          s.blocks = ['b-rf', 'b-ab']; s.paths = ['p-rf-ab', 'p-ab-out']; s.regs = src.regs;
        } else if (t === 2) {
          s.title = rd ? 'La mémoire répond' : 'Donnée sur le bus';
          s.desc = rd ? `/MREQ et /RD à 0 : la mémoire renvoie &${hex(c.data)}.` : `/MREQ à 0 : le CPU place &${hex(c.data)} sur D0–D7.`;
          s.blocks = rd ? ['b-ab', 'b-db'] : ['b-rf', 'b-db', 'b-ab']; s.paths = rd ? ['p-ab-out', 'p-db-in'] : ['p-bus-rf', 'p-db-bus', 'p-db-in', 'p-ab-out'];
          s.pins = rd ? ['MREQ', 'RD'] : ['MREQ']; s.data = c.data;
          if (src.operand) { s.blocks.push('b-inc'); s.paths.push('p-rf-inc', 'p-inc-rf'); }
        } else {
          s.title = rd ? 'Capture de la donnée' : 'Écriture';
          s.desc = rd ? `L'octet &${hex(c.data)} est capturé par le tampon de données et transite sur le bus interne${src.operand ? " (opérande de l'instruction)" : ''}.` : `/WR à 0 : la mémoire enregistre &${hex(c.data)} à l'adresse &${hex(c.addr, 4)}.`;
          s.blocks = ['b-db']; s.paths = rd ? ['p-db-in', 'p-db-bus'] : ['p-db-in'];
          s.pins = rd ? ['MREQ', 'RD'] : ['MREQ', 'WR']; s.data = c.data;
          if (rd && lastCycle) { s.blocks.push(...ex.blocks); s.paths.push(...ex.paths); }
        }
      } else if (c.type === 'IOR' || c.type === 'IOW') {
        const rd = c.type === 'IOR';
        s.addr = c.addr;
        const titles = [rd ? "Cycle d'entrée : adresse du port" : "Cycle de sortie : adresse du port", rd ? '/IORQ et /RD à 0' : '/IORQ et /WR à 0', "État d'attente automatique (TW)", rd ? 'Capture de la donnée' : 'Fin du cycle de sortie'];
        const descs = [
          `Le port &${hex(c.addr & 0xFF)} est placé sur A0–A7 (A8–A15 = &${hex(c.addr >> 8)}).`,
          rd ? '/IORQ et /RD passent à 0 : le périphérique sélectionné doit répondre.' : `/IORQ et /WR passent à 0 : le CPU présente &${hex(c.data)} au périphérique.`,
          "Le Z80 insère toujours un état d'attente dans les cycles d'E/S pour laisser le temps aux périphériques lents ; /WAIT est échantillonné.",
          rd ? `Le périphérique renvoie &${hex(c.data)}, capturé par le tampon de données.` : `Le périphérique a mémorisé &${hex(c.data)}.`,
        ];
        s.title = titles[t - 1]; s.desc = descs[t - 1];
        s.blocks = t === 1 ? ['b-rf', 'b-ab'] : ['b-ab', 'b-db']; s.paths = t === 1 ? ['p-rf-ab', 'p-ab-out'] : ['p-ab-out', 'p-db-in'];
        if (!rd && t > 1) s.paths.push('p-db-bus', 'p-bus-rf');
        if (rd && t === 4) s.paths.push('p-db-bus', 'p-bus-rf');
        s.pins = t === 1 ? [] : ['IORQ', rd ? 'RD' : 'WR'];
        if (t > 1) s.data = c.data;
      } else if (c.type === 'INTA') {
        s.title = "Acquittement d'interruption";
        s.desc = t <= 2 ? "/M1 passe à 0 sans /MREQ : le CPU signale qu'il accepte l'interruption." : t <= c.base - 2 ? `/M1 et /IORQ à 0 : le périphérique place &${hex(c.data)} sur le bus de données.` : 'Rafraîchissement DRAM, puis sauvegarde du PC sur la pile.';
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
    last.desc += execTxt ? ' Fin de l\'instruction.' + execTxt + '.' : ' Fin de l\'instruction.';
  }
  return steps;
}
