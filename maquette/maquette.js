'use strict';
/* Z80 Studio — UI mockup.
   All data is fake but consistent: the hello.asm program,
   the register state, the CPU micro-steps and the timing diagrams describe
   the same execution (LD A,(HL) then OR A from &4003). */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const hex = (v, n = 2) => v == null ? '-'.repeat(n) : (v >>> 0).toString(16).toUpperCase().padStart(n, '0');
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const NS = 'http://www.w3.org/2000/svg';
function S(tag, attrs = {}, parent, text) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

/* =====================================================================
   Source program (already assembled)
   ===================================================================== */
const SRC = [
  { t: '; ==============================================' },
  { t: '; hello.asm — Z80 demo for the Amstrad CPC 6128' },
  { t: ';  Prints a message, sets a red border, then beeps' },
  { t: '; ==============================================' },
  { t: 'TXT_OUTPUT      EQU  &BB5A          ; firmware: prints the character in A' },
  { t: 'SCR_SET_BORDER  EQU  &BC38          ; firmware: border color B,C' },
  { t: '' },
  { t: '                ORG  &4000' },
  { a: 0x4000, b: [0x21, 0x19, 0x40], T: '10', f: '—', t: 'start:          LD   HL,message' },
  { a: 0x4003, b: [0x7E], T: '7 (4+3)', f: '—', t: 'loop:           LD   A,(HL)         ; next character' },
  { a: 0x4004, b: [0xB7], T: '4', f: 'S Z H=0 P/V N=0 C=0', t: '                OR   A              ; end of string?' },
  { a: 0x4005, b: [0x28, 0x06], T: '7 / 12 if taken', f: '—', t: '                JR   Z,border' },
  { a: 0x4007, b: [0xCD, 0x5A, 0xBB], T: '17', f: '—', t: '                CALL TXT_OUTPUT' },
  { a: 0x400A, b: [0x23], T: '6', f: '—', t: '                INC  HL' },
  { a: 0x400B, b: [0x18, 0xF6], T: '12', f: '—', t: '                JR   loop' },
  { a: 0x400D, b: [0x06, 0x06], T: '7', f: '—', t: 'border:         LD   B,6            ; bright red' },
  { a: 0x400F, b: [0x48], T: '4', f: '—', t: '                LD   C,B' },
  { a: 0x4010, b: [0xCD, 0x38, 0xBC], T: '17', f: '—', t: '                CALL SCR_SET_BORDER' },
  { a: 0x4013, b: [0x3E, 0x07], T: '7', f: '—', t: '                LD   A,7            ; BEL: speaker beep' },
  { a: 0x4015, b: [0xCD, 0x5A, 0xBB], T: '17', f: '—', t: '                CALL TXT_OUTPUT' },
  { a: 0x4018, b: [0xC9], T: '10', f: '—', t: '                RET' },
  { t: '' },
  { a: 0x4019, b: [0x48, 0x65, 0x6C, 0x6C, 0x6F, 0x2C, 0x20, 0x77, 0x6F, 0x72, 0x6C, 0x64, 0x21, 0x0D, 0x0A, 0x00], t: 'message:        DB   "Hello, world!",13,10,0' },
  { t: '' },
  { t: '                END  start' },
];
const SYMBOLS = [['TXT_OUTPUT', 0xBB5A], ['SCR_SET_BORDER', 0xBC38], ['start', 0x4000], ['loop', 0x4003], ['border', 0x400D], ['message', 0x4019]];
const SYMSET = new Set(SYMBOLS.map(s => s[0].toUpperCase()));
const MEM = new Map();
SRC.forEach(l => l.b && l.b.forEach((v, i) => MEM.set(l.a + i, v)));
[[0xBFF8, 0x2B], [0xBFF9, 0x00], [0xBFFA, 0x9E], [0xBFFB, 0xBD], [0xBFFC, 0x81], [0xBFFD, 0xB9]].forEach(([a, v]) => MEM.set(a, v));

/* =====================================================================
   Syntax highlighting
   ===================================================================== */
const MNEM = new Set('LD LDI LDIR LDD LDDR PUSH POP EX EXX ADD ADC SUB SBC AND OR XOR CP INC DEC DAA CPL NEG CCF SCF NOP HALT DI EI IM RLCA RLA RRCA RRA RLC RL RRC RR SLA SRA SRL BIT SET RES JP JR DJNZ CALL RET RETI RETN RST IN OUT OTIR INIR'.split(' '));
const DIRS = new Set('ORG EQU DB DW DS DEFB DEFW DEFS END INCLUDE MACRO ENDM'.split(' '));
const REGS = new Set("A B C D E H L AF BC DE HL IX IY SP I R AF' Z NZ NC PO PE P M".split(' '));

function highlight(line) {
  let code = line, comment = '';
  let inStr = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') inStr = !inStr;
    if (line[i] === ';' && !inStr) { code = line.slice(0, i); comment = line.slice(i); break; }
  }
  let out = '', first = true;
  const re = /("[^"]*"|&[0-9A-Fa-f]+|#[0-9A-Fa-f]+|\$[0-9A-Fa-f]+|\b\d+\b|[A-Za-z_][A-Za-z0-9_']*:?|\s+|.)/g;
  let m;
  while ((m = re.exec(code))) {
    const tok = m[0], up = tok.toUpperCase();
    let cls = '';
    if (/^\s+$/.test(tok)) { out += tok; continue; }
    if (tok[0] === '"') cls = 's';
    else if (/^[&#$]|^\d/.test(tok)) cls = 'n';
    else if (tok.endsWith(':') || (first && m.index === 0 && /^[A-Za-z_]/.test(tok))) cls = 'l';
    else if (MNEM.has(up)) cls = 'm';
    else if (DIRS.has(up)) cls = 'd';
    else if (REGS.has(up)) cls = 'r';
    else if (SYMSET.has(up)) cls = 'y';
    first = false;
    out += cls ? `<span class="tk-${cls}">${esc(tok)}</span>` : esc(tok);
  }
  if (comment) out += `<span class="tk-c">${esc(comment)}</span>`;
  return out;
}

/* =====================================================================
   CPU micro-steps (one step = one T-state)
   ===================================================================== */
const INSTRS = [
  { name: 'LD A,(HL)', op: '7E', cyc: 'M1 (4T) + M2 memory read (3T) = 7 T' },
  { name: 'OR A', op: 'B7', cyc: 'M1 (4T) = 4 T' },
];
const STEPS = [
  { i: 0, m: 'M1', t: 1, title: 'Opcode fetch: address',
    desc: "PC (&4003) is copied into the address buffer and appears on A0–A15. /M1 goes low: an opcode fetch cycle begins.",
    blocks: ['b-rf', 'b-ab'], paths: ['p-rf-ab', 'p-ab-out'], regs: ['PC'], pins: ['M1'], addr: 0x4003, data: null },
  { i: 0, m: 'M1', t: 2, title: 'Opcode read',
    desc: "/MREQ and /RD go low: the RAM places byte &7E on D0–D7. In parallel, the 16-bit incrementer computes PC + 1 = &4004.",
    blocks: ['b-ab', 'b-db', 'b-inc', 'b-rf'], paths: ['p-ab-out', 'p-db-in', 'p-rf-inc', 'p-inc-rf'], regs: ['PC'], pins: ['M1', 'MREQ', 'RD'], addr: 0x4003, data: 0x7E, set: { PC: 0x4004 } },
  { i: 0, m: 'M1', t: 3, title: 'Latch into IR + refresh',
    desc: "Rising edge of T3: opcode &7E is copied into the instruction register. The address bus carries I·R (&002F) to refresh the DRAM: /RFSH and /MREQ low.",
    blocks: ['b-db', 'b-ir', 'b-rf', 'b-ab'], paths: ['p-db-in', 'p-db-bus', 'p-bus-ir', 'p-rf-ab', 'p-ab-out'], regs: ['I', 'R'], pins: ['MREQ', 'RFSH'], addr: 0x002F, data: null, ir: 0x7E },
  { i: 0, m: 'M1', t: 4, title: 'Decode',
    desc: "The decoder recognizes &7E = LD A,(HL): an extra memory read cycle (M2) is needed at the address held in HL. R is incremented (&30).",
    blocks: ['b-ir', 'b-dec', 'b-seq', 'b-rf'], paths: ['p-ir-dec', 'p-dec-seq'], regs: ['R'], pins: ['MREQ', 'RFSH'], addr: 0x002F, data: null, set: { R: 0x30 }, dec: 'LD A,(HL)' },
  { i: 0, m: 'M2', t: 1, title: 'Memory read: address HL',
    desc: "The sequencer selects the HL pair (&4019) as the address source: it is copied into the address buffer.",
    blocks: ['b-seq', 'b-rf', 'b-ab'], paths: ['p-seq-rf', 'p-rf-ab', 'p-ab-out'], regs: ['H', 'L'], pins: [], addr: 0x4019, data: null },
  { i: 0, m: 'M2', t: 2, title: 'Memory responds',
    desc: "/MREQ and /RD low: the RAM returns byte &48 ('H', first character of the message). On the CPC, the Gate Array may insert wait states (/WAIT) here.",
    blocks: ['b-ab', 'b-db'], paths: ['p-ab-out', 'p-db-in'], regs: [], pins: ['MREQ', 'RD', 'WAIT'], addr: 0x4019, data: 0x48 },
  { i: 0, m: 'M2', t: 3, title: 'Write to A',
    desc: "Byte &48 crosses the internal data bus and is written into accumulator A. No flag is affected. End of LD A,(HL): 7 T-states.",
    blocks: ['b-db', 'b-rf'], paths: ['p-db-in', 'p-db-bus', 'p-bus-rf'], regs: ['A'], pins: ['MREQ', 'RD'], addr: 0x4019, data: 0x48, set: { A: 0x48 } },
  { i: 1, m: 'M1', t: 1, title: 'Opcode fetch: address',
    desc: "Next instruction: PC = &4004 is placed on the address bus, /M1 low.",
    blocks: ['b-rf', 'b-ab'], paths: ['p-rf-ab', 'p-ab-out'], regs: ['PC'], pins: ['M1'], addr: 0x4004, data: null },
  { i: 1, m: 'M1', t: 2, title: 'Opcode read',
    desc: "The RAM returns &B7. PC becomes &4005.",
    blocks: ['b-ab', 'b-db', 'b-inc', 'b-rf'], paths: ['p-ab-out', 'p-db-in', 'p-rf-inc', 'p-inc-rf'], regs: ['PC'], pins: ['M1', 'MREQ', 'RD'], addr: 0x4004, data: 0xB7, set: { PC: 0x4005 } },
  { i: 1, m: 'M1', t: 3, title: 'Latch into IR + refresh',
    desc: "&B7 enters the instruction register; DRAM refresh at address I·R = &0030.",
    blocks: ['b-db', 'b-ir', 'b-rf', 'b-ab'], paths: ['p-db-in', 'p-db-bus', 'p-bus-ir', 'p-rf-ab', 'p-ab-out'], regs: ['I', 'R'], pins: ['MREQ', 'RFSH'], addr: 0x0030, data: null, ir: 0xB7 },
  { i: 1, m: 'M1', t: 4, title: 'Decode and ALU computation',
    desc: "&B7 = OR A. A is copied into the ACC and TMP latches; the ALU computes &48 OR &48 = &48. Flags: S=0, Z=0, H=0, P/V=1 (even parity), N=0, C=0. The result is written back to A.",
    blocks: ['b-ir', 'b-dec', 'b-seq', 'b-acc', 'b-tmp', 'b-alu', 'b-f', 'b-rf'],
    paths: ['p-ir-dec', 'p-dec-seq', 'p-seq-alu', 'p-bus-acc', 'p-bus-tmp', 'p-acc-alu', 'p-tmp-alu', 'p-alu-f', 'p-alu-bus', 'p-bus-rf', 'p-db-bus'],
    regs: ['A', 'F', 'R'], pins: ['MREQ', 'RFSH'], addr: 0x0030, data: null, set: { F: 0x04, R: 0x31 }, dec: 'OR A', alu: 'OR', acc: 0x48, tmp: 0x48 },
];
const INIT = { A: 0x00, F: 0x44, B: 0x00, C: 0x00, D: 0x00, E: 0x00, H: 0x40, L: 0x19,
  "A'": 0x00, "F'": 0x00, "B'": 0x7F, "C'": 0x8D, "D'": 0x00, "E'": 0x00, "H'": 0xB7, "L'": 0x7E,
  IX: 0xBFFE, IY: 0x0000, SP: 0xBFF8, PC: 0x4003, I: 0x00, R: 0x2F };

function stateAt(k) {
  const r = { ...INIT };
  const x = { ir: 0x21, dec: 'LD HL,nn', acc: null, tmp: null, alu: '—' };
  for (let s = 0; s <= k; s++) {
    const st = STEPS[s];
    Object.assign(r, st.set || {});
    if (st.ir != null) x.ir = st.ir;
    if (st.dec) x.dec = st.dec;
    if (st.acc != null) { x.acc = st.acc; x.tmp = st.tmp; }
    if (st.alu) x.alu = st.alu;
  }
  return { r, x };
}
const ui = { step: 0, bps: new Set([0x4007]), playing: null, selBlock: null };

/* =====================================================================
   Tabs
   ===================================================================== */
function activate(group, name) {
  $$(`.tabs[data-tabs="${group}"] .tab`).forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $$(`.pane[data-group="${group}"]`).forEach(p => p.classList.toggle('active', p.dataset.name === name));
  if (group === 'ws' && name === 'machine') drawScreen();
  if (group === 'dock' && dockCollapsed()) $('#dock-toggle').click();
}
document.addEventListener('click', e => {
  const b = e.target.closest('.tabs .tab');
  if (b) activate(b.parentElement.dataset.tabs, b.dataset.tab);
});

/* =====================================================================
   Left column
   ===================================================================== */
function renderSidebar() {
  $('#symbols').innerHTML = SYMBOLS.map(([n, a]) => `<tr data-a="${a}"><td>${n}</td><td>&amp;${hex(a, 4)}</td></tr>`).join('');
  $('#symbols').addEventListener('click', e => {
    const tr = e.target.closest('tr'); if (!tr) return;
    const a = +tr.dataset.a;
    const i = SRC.findIndex(l => l.a === a || (l.t.startsWith(tr.cells[0].textContent) && !l.a));
    activate('ws', 'editor');
    const ln = $(`.ln[data-i="${i}"]`);
    if (ln) { ln.scrollIntoView({ block: 'center' }); ln.classList.remove('flash'); void ln.offsetWidth; ln.classList.add('flash'); }
  });
  const cfg = {
    cpc: [['Processor', 'Z80A · 4 MHz'], ['Memory', '128 KB RAM · 48 KB ROM'], ['ROM', 'OS 6128 · BASIC 1.1 · AMSDOS'], ['Monitor', 'Color CTM644'], ['Drive A:', 'demo.dsk'], ['Printer', 'Virtual DMP2000']],
    min: [['Processor', 'Z80 · 4 MHz'], ['Memory', '8 KB EPROM · 8 KB SRAM'], ['I/O', 'port &00 → 8 LEDs, port &01 ← 8 switches'], ['Clock', '4 MHz oscillator']],
  }[$('#machine').value];
  $('#config').innerHTML = cfg.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}

/* =====================================================================
   Editor
   ===================================================================== */
function renderEditor() {
  const curA = STEPS[ui.step].i === 0 ? 0x4003 : 0x4004;
  $('#code').innerHTML = SRC.map((l, i) => {
    const bytes = l.b ? l.b.slice(0, 4).map(v => hex(v)).join(' ') + (l.b.length > 4 ? ' …' : '') : '';
    return `<div class="ln${l.a === curA ? ' cur' : ''}" data-i="${i}"><span class="bp${ui.bps.has(l.a) ? ' on' : ''}" data-a="${l.a ?? ''}"></span><span class="no">${i + 1}</span><span class="ad">${l.a != null ? hex(l.a, 4) : ''}</span><span class="by">${bytes}</span><span class="src">${highlight(l.t) || ' '}</span></div>`;
  }).join('');
}
$('#code').addEventListener('click', e => {
  const bp = e.target.closest('.bp');
  if (bp && bp.dataset.a) {
    const a = +bp.dataset.a;
    ui.bps.has(a) ? ui.bps.delete(a) : ui.bps.add(a);
    renderEditor(); renderRight();
  }
});
$('#code').addEventListener('mouseover', e => {
  const ln = e.target.closest('.ln'); if (!ln) return;
  const l = SRC[+ln.dataset.i];
  if (l.T) $('#hint').innerHTML = `<b>${esc(l.t.replace(/^\S+:/, '').replace(/;.*/, '').trim())}</b> · opcode <b>${l.b.map(v => hex(v)).join(' ')}</b> · duration <b>${l.T} T-states</b> · flags: <b>${l.f}</b> · address <b>&amp;${hex(l.a, 4)}</b>`;
  else if (l.b) $('#hint').innerHTML = `Data: <b>${l.b.length} bytes</b> at <b>&amp;${hex(l.a, 4)}</b>`;
});

/* =====================================================================
   Right column: registers
   ===================================================================== */
function renderRight() {
  const { r } = stateAt(ui.step);
  const prev = ui.step > 0 ? stateAt(ui.step - 1).r : r;
  const pair = (a, b) => (r[a] << 8) | r[b];
  const chg = (...ks) => ks.some(k => prev[k] !== r[k]) ? ' chg' : '';
  const rows = [
    ['AF', pair('A', 'F'), chg('A', 'F')], ["AF'", pair("A'", "F'"), '', 1],
    ['BC', pair('B', 'C'), chg('B', 'C')], ["BC'", pair("B'", "C'"), '', 1],
    ['DE', pair('D', 'E'), chg('D', 'E')], ["DE'", pair("D'", "E'"), '', 1],
    ['HL', pair('H', 'L'), chg('H', 'L')], ["HL'", pair("H'", "L'"), '', 1],
    ['IX', r.IX, chg('IX')], ['IY', r.IY, chg('IY')],
    ['SP', r.SP, chg('SP')], ['PC', r.PC, chg('PC')],
    ['I', r.I, chg('I'), 0, 2], ['R', r.R, chg('R'), 0, 2],
  ];
  $('#regs').innerHTML = rows.map(([n, v, c, alt, w]) => `<div class="r${c}${alt ? ' alt' : ''}" title="${n} = ${v} (dec.)"><span>${n}</span><b>${hex(v, w || 4)}</b></div>`).join('');
  $('#reg-note').textContent = `T-state ${ui.step + 1}/${STEPS.length}`;
  const fl = [['S', 'sign'], ['Z', 'zero'], ['Y', 'bit 5'], ['H', 'half-carry'], ['X', 'bit 3'], ['P/V', 'parity/overflow'], ['N', 'subtract'], ['C', 'carry']];
  $('#flags').innerHTML = fl.map(([n, d], i) => `<div class="flag${(r.F >> (7 - i)) & 1 ? ' on' : ''}" title="${d}">${n}<small>${(r.F >> (7 - i)) & 1}</small></div>`).join('');
  $('#abits').innerHTML = [...Array(8)].map((_, i) => `<span class="${(r.A >> (7 - i)) & 1 ? 'on' : ''}" title="bit ${7 - i}">${(r.A >> (7 - i)) & 1}</span>`).join('');
  $('#stack').innerHTML = [0, 2, 4].map(o => {
    const a = r.SP + o;
    return `<div class="${o === 0 ? 'top' : ''}"><span>&amp;${hex(a, 4)}</span>${hex((MEM.get(a + 1) || 0) << 8 | (MEM.get(a) || 0), 4)}${o === 0 ? ' ← SP' : ''}</div>`;
  }).join('');
  $('#bplist').innerHTML = [...ui.bps].sort().map(a => {
    const l = SRC.find(s => s.a === a);
    return `<div><i></i>&amp;${hex(a, 4)} <em>line ${SRC.indexOf(l) + 1}</em></div>`;
  }).join('') || '<div class="muted">none</div>';
  const hl = pair('H', 'L'), m = MEM.get(hl) || 0;
  $('#watch').innerHTML = `<div><span>(HL)</span>&amp;${hex(m)} '${String.fromCharCode(m)}'</div><div><span>[message]</span>"Hello, world!"</div><div><span>A = (HL) ?</span>${r.A === m ? 'true' : 'false'}</div>`;
  renderStatus(r);
}
function renderStatus(r) {
  const T0 = 1234560;
  $('#status').innerHTML = `<span class="st-pause">❚❚ Paused (single-step)</span><span>${$('#machine').value === 'cpc' ? 'Z80A · 4.000 MHz' : 'Z80 · 4.000 MHz'}</span><span>T-states: ${(T0 + ui.step).toLocaleString('en-US')}</span><span>Frame 50 Hz · line 137</span><span>PC &amp;${hex(r.PC, 4)}</span><span>Assembly OK · 41 bytes · 0 errors</span><span class="right">Ln 10, Col 17 · UTF-8 · Maxam</span>`;
}

/* =====================================================================
   CPU inside view (SVG)
   ===================================================================== */
const CPU = { regEls: {}, blk: {}, paths: {}, pins: {} };
const PINS = ['CLK', 'RESET', 'INT', 'NMI', 'WAIT', 'BUSRQ', 'BUSAK', 'HALT', 'M1', 'MREQ', 'IORQ', 'RD', 'WR', 'RFSH'];
const pinLabel = p => p === 'CLK' ? 'CLK' : '/' + p;

function buildCPU() {
  const svg = $('#cpu-svg');
  S('rect', { x: 100, y: 20, width: 880, height: 585, rx: 14, class: 'chipframe' }, svg);
  S('text', { x: 540, y: 600, 'text-anchor': 'middle', class: 'chiplabel' }, svg, 'Z80 — simplified internal architecture');

  // Paths (drawn first, under the blocks)
  const P = (id, d, kind) => { CPU.paths[id] = S('path', { d, class: `wire-p ${kind}` }, svg); };
  P('p-db-bus', 'M330,370 H925 V400', 'data');
  P('p-bus-ir', 'M330,370 V180 H320', 'data');
  P('p-bus-rf', 'M740,370 V300', 'data');
  P('p-bus-acc', 'M360,370 V60 H380', 'data');
  P('p-bus-tmp', 'M605,370 V60 H560', 'data');
  P('p-acc-alu', 'M420,80 V100', 'data');
  P('p-tmp-alu', 'M520,80 V100', 'data');
  P('p-alu-bus', 'M470,210 V370', 'data');
  P('p-alu-f', 'M510,212 V235', 'data');
  P('p-rf-ab', 'M860,240 H885', 'addr');
  P('p-ab-out', 'M965,170 H1010', 'addr');
  P('p-db-in', 'M1010,485 H965', 'data');
  P('p-rf-inc', 'M650,300 V400', 'addr');
  P('p-inc-rf', 'M830,400 V300', 'addr');
  P('p-ir-dec', 'M220,210 V230', 'ctrl');
  P('p-dec-seq', 'M220,320 V340', 'ctrl');
  P('p-seq-alu', 'M320,420 H345 V155 H392', 'ctrl');
  P('p-seq-rf', 'M320,560 H612 V280 H620', 'ctrl');
  S('text', { x: 700, y: 386, class: 'bus-lbl', fill: '#ffa726' }, svg, 'internal data bus (8-bit)');

  const B = (id, x, y, w, h, title) => {
    const g = S('g', { class: 'blk', 'data-id': id }, svg);
    S('rect', { x, y, width: w, height: h, rx: 6 }, g);
    S('text', { x: x + 10, y: y + 17, class: 't-h' }, g, title);
    CPU.blk[id] = g;
    return g;
  };
  let g;
  g = B('b-int', 120, 40, 200, 90, 'Interrupt logic');
  S('text', { x: 130, y: 82 }, g, 'IFF1 = 1   IFF2 = 1');
  S('text', { x: 130, y: 104 }, g, 'Mode: IM 1  (RST &38)');
  g = B('b-ir', 120, 150, 200, 60, 'Instruction register');
  CPU.ir = S('text', { x: 130, y: 196, class: 't-v' }, g, '');
  g = B('b-dec', 120, 230, 200, 90, 'Instruction decoder');
  CPU.dec = S('text', { x: 130, y: 280, class: 't-v' }, g, '');
  S('text', { x: 130, y: 304, fill: '#8a95a8', 'font-size': 11 }, g, 'decode table + CB/DD/ED/FD prefixes');
  g = B('b-seq', 120, 340, 200, 250, 'Sequencer / timing');
  CPU.mt = S('text', { x: 130, y: 388, class: 't-v', 'font-size': 22 }, g, '');
  CPU.tl = S('g', {}, g);
  CPU.seqTxt = S('text', { x: 130, y: 470, fill: '#8a95a8', 'font-size': 11 }, g, '');
  S('text', { x: 130, y: 500, fill: '#8a95a8', 'font-size': 11 }, g, 'drives /M1 /MREQ /IORQ /RD /WR /RFSH');
  S('text', { x: 130, y: 518, fill: '#8a95a8', 'font-size': 11 }, g, 'samples /WAIT /INT /NMI /BUSRQ');
  g = B('b-acc', 380, 40, 80, 40, 'ACC');
  CPU.acc = S('text', { x: 450, y: 72, class: 't-v', 'text-anchor': 'end', 'font-size': 13 }, g, '');
  g = B('b-tmp', 480, 40, 80, 40, 'TMP');
  CPU.tmp = S('text', { x: 550, y: 72, class: 't-v', 'text-anchor': 'end', 'font-size': 13 }, g, '');
  g = S('g', { class: 'blk', 'data-id': 'b-alu' }, svg);
  S('polygon', { points: '370,100 455,100 470,118 485,100 570,100 520,210 420,210' }, g);
  S('text', { x: 470, y: 150, 'text-anchor': 'middle', class: 't-h' }, g, 'ALU');
  CPU.alu = S('text', { x: 470, y: 182, 'text-anchor': 'middle', class: 't-v' }, g, '');
  CPU.blk['b-alu'] = g;
  g = B('b-f', 485, 235, 110, 50, 'Flags F');
  CPU.f = S('text', { x: 495, y: 276, class: 't-v', 'font-size': 13, 'letter-spacing': 1 }, g, '');
  g = B('b-rf', 620, 40, 240, 260, 'Register file');
  const RF = [['A', 630, 60], ['F', 685, 60], ["A'", 750, 60], ["F'", 805, 60],
    ['B', 630, 90], ['C', 685, 90], ["B'", 750, 90], ["C'", 805, 90],
    ['D', 630, 120], ['E', 685, 120], ["D'", 750, 120], ["E'", 805, 120],
    ['H', 630, 150], ['L', 685, 150], ["H'", 750, 150], ["L'", 805, 150],
    ['IX', 630, 190, 105], ['IY', 750, 190, 105], ['SP', 630, 222, 105], ['PC', 750, 222, 105], ['I', 630, 260, 50], ['R', 685, 260, 50]];
  RF.forEach(([n, x, y, w = 50]) => {
    const rg = S('g', { class: 'reg' }, g);
    S('rect', { x, y, width: w, height: 26, rx: 3 }, rg);
    S('text', { x: x + 4, y: y + 10, class: 'rn' }, rg, n);
    CPU.regEls[n] = { g: rg, v: S('text', { x: x + w - 5, y: y + 20, class: 'rv' }, rg, ''), w };
  });
  g = B('b-inc', 620, 400, 240, 55, '16-bit incrementer / decrementer');
  CPU.inc = S('text', { x: 630, y: 442, class: 't-v', 'font-size': 13 }, g, '');
  g = B('b-ab', 885, 40, 80, 260, 'Address');
  S('text', { x: 895, y: 72, class: 't-h' }, g, 'buffer');
  CPU.ab = S('text', { x: 925, y: 175, 'text-anchor': 'middle', class: 't-v', fill: '#42a5f5' }, g, '');
  g = B('b-db', 885, 400, 80, 170, 'Data');
  S('text', { x: 895, y: 432, class: 't-h' }, g, 'buffer');
  CPU.db = S('text', { x: 925, y: 492, 'text-anchor': 'middle', class: 't-v', fill: '#ffa726' }, g, '');

  // External pins on the left
  PINS.forEach((p, i) => {
    const y = 45 + i * 38;
    const pg = S('g', { class: 'pin' + (p === 'CLK' ? ' clk' : '') }, svg);
    S('line', { x1: 70, y1: y, x2: 100, y2: y }, pg);
    S('circle', { cx: 62, cy: y, r: 4.5 }, pg);
    S('text', { x: 52, y: y + 4, 'text-anchor': 'end' }, pg, pinLabel(p));
    CPU.pins[p] = pg;
  });
  // External buses on the right
  S('text', { x: 1015, y: 160, class: 'bus-lbl', fill: '#42a5f5' }, svg, 'A0–A15');
  CPU.abOut = S('text', { x: 1015, y: 190, class: 'bus-lbl', fill: '#42a5f5' }, svg, '');
  S('text', { x: 1015, y: 475, class: 'bus-lbl', fill: '#ffa726' }, svg, 'D0–D7');
  CPU.dbOut = S('text', { x: 1015, y: 505, class: 'bus-lbl', fill: '#ffa726' }, svg, '');

  svg.addEventListener('click', e => {
    const b = e.target.closest('.blk');
    Object.values(CPU.blk).forEach(x => x.classList.remove('sel'));
    if (b) b.classList.add('sel');
  });

  $('#pinleds').innerHTML = PINS.map(p => `<span data-p="${p}"><i></i>${pinLabel(p)}</span>`).join('');
}

function updateCPU() {
  const st = STEPS[ui.step], { r, x } = stateAt(ui.step);
  Object.entries(CPU.blk).forEach(([id, g]) => g.classList.toggle('on', st.blocks.includes(id)));
  Object.entries(CPU.paths).forEach(([id, p]) => p.classList.toggle('on', st.paths.includes(id)));
  Object.entries(CPU.regEls).forEach(([n, o]) => {
    o.v.textContent = hex(r[n], o.w > 50 ? 4 : 2);
    o.g.classList.toggle('on', st.regs.includes(n));
  });
  PINS.forEach(p => {
    if (p !== 'CLK') CPU.pins[p].classList.toggle('on', st.pins.includes(p));
    $(`#pinleds [data-p="${p}"]`).classList.toggle('on', p === 'CLK' || st.pins.includes(p));
  });
  CPU.ir.textContent = '&' + hex(x.ir);
  CPU.dec.textContent = x.dec;
  CPU.mt.textContent = `${st.m} · T${st.t}`;
  CPU.acc.textContent = x.acc == null ? '--' : hex(x.acc);
  CPU.tmp.textContent = x.tmp == null ? '--' : hex(x.tmp);
  CPU.alu.textContent = x.alu;
  CPU.f.textContent = [...Array(8)].map((_, i) => (r.F >> (7 - i)) & 1).join('');
  CPU.inc.textContent = st.paths.includes('p-rf-inc') ? `PC + 1 → ${hex(r.PC, 4)}` : 'idle';
  CPU.ab.textContent = hex(st.addr, 4);
  CPU.db.textContent = st.data == null ? 'Z' : hex(st.data);
  CPU.abOut.textContent = '&' + hex(st.addr, 4);
  CPU.dbOut.textContent = st.data == null ? 'high-Z' : '&' + hex(st.data);
  // timeline of the current instruction's T-states
  CPU.tl.innerHTML = '';
  const mine = STEPS.map((s, k) => ({ s, k })).filter(o => o.s.i === st.i);
  mine.forEach(({ s, k }, j) => {
    const tb = S('g', { class: 'tbox' + (k === ui.step ? ' on' : k < ui.step ? ' done' : '') }, CPU.tl);
    S('rect', { x: 130 + j * 26, y: 410, width: 23, height: 30, rx: 3 }, tb);
    S('text', { x: 141.5 + j * 26, y: 422 }, tb, s.m);
    S('text', { x: 141.5 + j * 26, y: 434 }, tb, 'T' + s.t);
  });
  CPU.seqTxt.textContent = INSTRS[st.i].cyc;
  $('#cpu-instr').innerHTML = `Instruction: <b>${INSTRS[st.i].name}</b> (opcode &amp;${INSTRS[st.i].op}) · ${INSTRS[st.i].cyc}`;
  $('#step-h').innerHTML = `<span class="mt">${st.m} T${st.t}</span>${st.title}`;
  $('#step-desc').textContent = st.desc;
  $('#step-addr').textContent = '&' + hex(st.addr, 4);
  $('#step-data').textContent = st.data == null ? 'high impedance' : '&' + hex(st.data);
}

function goStep(k) {
  ui.step = Math.max(0, Math.min(STEPS.length - 1, k));
  updateCPU(); renderRight(); renderEditor(); renderMem(); renderDis();
  LA.cursor = ui.step * 8 + 4; renderLA();
}
$('#cpu-first').onclick = () => goStep(0);
$('#cpu-prev').onclick = () => goStep(ui.step - 1);
$('#cpu-next').onclick = () => goStep(ui.step + 1);
$('#tb-tstate').onclick = () => goStep(ui.step + 1);
$('#tb-instr').onclick = () => goStep(STEPS[ui.step].i === 0 ? 7 : STEPS.length - 1);
$('#cpu-play').onclick = e => {
  if (ui.playing) { clearInterval(ui.playing); ui.playing = null; e.target.classList.remove('on'); e.target.textContent = '▶ Animate'; return; }
  e.target.classList.add('on'); e.target.textContent = '❚❚ Pause';
  ui.playing = setInterval(() => goStep(ui.step >= STEPS.length - 1 ? 0 : ui.step + 1), 1400);
};

/* =====================================================================
   Motherboard
   ===================================================================== */
const BOARDS = {
  cpc: {
    title: 'Amstrad CPC 6128 — motherboard <span>(block diagram · click a chip or a line)</span>',
    buses: { A: 262, D: 280, C: 298 }, busX: [20, 1170],
    chips: [
      { id: 'xtal', x: 30, y: 40, w: 80, h: 44, name: 'Crystal', sub: '16 MHz', ref: 'X1' },
      { id: 'pal', x: 20, y: 150, w: 115, h: 70, name: 'PAL 40030', sub: '128 KB banking', ref: 'IC118', bus: { A: 100, D: 118 } },
      { id: 'ga', x: 150, y: 30, w: 190, h: 110, name: 'Gate Array', sub: '40010 · video, clocks', ref: 'IC103', bus: { D: 165, C: 185 } },
      { id: 'z80', x: 400, y: 30, w: 150, h: 190, name: 'Z80A', sub: 'CPU · 4 MHz', ref: 'IC101', bus: { A: 430, D: 475, C: 520 } },
      { id: 'rom', x: 600, y: 110, w: 120, h: 110, name: 'ROM 32 KB', sub: 'OS + BASIC 1.1', ref: 'IC102', bus: { A: 625, D: 660, C: 695 } },
      { id: 'amsdos', x: 735, y: 110, w: 110, h: 110, name: 'ROM 16 KB', sub: 'AMSDOS', ref: 'IC117', bus: { A: 755, D: 790, C: 825 } },
      { id: 'ram0', x: 860, y: 110, w: 140, h: 110, name: 'DRAM 64 KB', sub: 'bank 0 · 8×4164', ref: 'IC104–111', bus: { A: 890, D: 930, C: 970 } },
      { id: 'ram1', x: 1015, y: 110, w: 140, h: 110, name: 'DRAM 64 KB', sub: 'bank 1 · 8×4164', ref: 'IC119–126', bus: { A: 1045, D: 1085, C: 1125 } },
      { id: 'mon', x: 860, y: 20, w: 295, h: 60, name: 'Color monitor', sub: 'RGB + sync · CTM644', ext: true },
      { id: 'crtc', x: 150, y: 340, w: 190, h: 90, name: 'CRTC', sub: 'HD6845S · video scan', ref: 'IC105', bus: { A: 265, D: 295, C: 325 } },
      { id: 'ppi', x: 400, y: 340, w: 150, h: 90, name: 'PPI', sub: '8255 · parallel I/O', ref: 'IC114', bus: { A: 430, D: 475, C: 520 } },
      { id: 'psg', x: 600, y: 340, w: 150, h: 90, name: 'PSG', sub: 'AY-3-8912 · sound', ref: 'IC115' },
      { id: 'fdc', x: 790, y: 340, w: 150, h: 90, name: 'FDC', sub: 'µPD765A · floppy disks', ref: 'IC201', bus: { A: 815, D: 845, C: 905 } },
      { id: 'prn', x: 980, y: 340, w: 150, h: 90, name: 'Printer port', sub: '74LS273 · Centronics', ref: 'IC116', bus: { A: 1005, D: 1035, C: 1100 } },
      { id: 'kbd', x: 150, y: 500, w: 190, h: 60, name: 'Keyboard', sub: '10 × 8 matrix', ext: true },
      { id: 'kdec', x: 400, y: 500, w: 150, h: 60, name: 'Keyboard decoder', sub: '74LS145', ref: 'IC113' },
      { id: 'amp', x: 600, y: 500, w: 150, h: 60, name: 'Audio amp', sub: 'A+B+C mixer', ref: 'IC120' },
      { id: 'drive', x: 790, y: 500, w: 150, h: 60, name: '3" drive', sub: 'A: demo.dsk', ext: true },
      { id: 'printer', x: 980, y: 500, w: 150, h: 60, name: 'Printer', sub: 'virtual · DMP2000', ext: true },
      { id: 'spk', x: 600, y: 610, w: 150, h: 50, name: 'Speaker', sub: 'internal', ext: true },
    ],
    wires: [
      { id: 'abus', sig: ['A'], kind: 'addr', w: 5, label: 'Address bus A0–A15', d: 'M20,262 H1170' },
      { id: 'dbus', sig: ['D'], kind: 'data', w: 5, label: 'Data bus D0–D7', d: 'M20,280 H1170' },
      { id: 'cbus', sig: ['M1', 'MREQ', 'IORQ', 'RD', 'WR'], kind: 'ctrl', w: 4, label: 'Control bus /M1 /MREQ /IORQ /RD /WR', d: 'M20,298 H1170' },
      { id: 'clk16', sig: ['CLK16'], kind: 'clk', label: '16 MHz master clock', d: 'M110,62 H150' },
      { id: 'clk4', sig: ['CLK'], kind: 'clk', label: 'CPU clock 4 MHz (16 MHz ÷ 4)', d: 'M340,55 H400' },
      { id: 'int', sig: ['INT'], kind: 'ctrl', label: '/INT — 300 Hz (every 52 lines)', d: 'M340,85 H400' },
      { id: 'wait', sig: ['WAIT'], kind: 'ctrl', label: '/WAIT — RAM shared with video', d: 'M340,115 H400' },
      { id: 'ras', sig: ['RAS', 'CAS'], kind: 'ctrl', label: '/RAS /CAS — DRAM control', d: 'M300,30 V6 H1185 V165 H1155' },
      { id: 'rgb', sig: ['RGB', 'HSYNC'], kind: 'video', label: 'RGB output + composite sync', d: 'M220,30 V14 H1007 V20' },
      { id: 'ma', sig: ['MA'], kind: 'addr', label: 'MA0–MA13 / RA0–RA4 — video address', d: 'M205,340 V140' },
      { id: 'sync', sig: ['HSYNC', 'VSYNC'], kind: 'video', label: 'HSYNC / VSYNC / DISPEN', d: 'M235,340 V140' },
      { id: 'ppipsg', sig: ['PSGD'], kind: 'data', label: 'PPI port A ↔ PSG data bus', d: 'M550,365 H600' },
      { id: 'bdir', sig: ['BDIR', 'BC1'], kind: 'ctrl', label: 'BDIR / BC1 — PSG control (PPI port C)', d: 'M550,400 H600' },
      { id: 'krow', sig: ['KROW'], kind: 'ctrl', label: 'Keyboard row number (PPI PC0–PC3)', d: 'M475,430 V500' },
      { id: 'krows', sig: ['KSEL'], kind: 'ctrl', label: 'Keyboard rows 0–9 (only one low)', d: 'M400,530 H340' },
      { id: 'kcol', sig: ['KCOL'], kind: 'data', label: 'Keyboard columns → PSG port A', d: 'M245,560 V590 H580 V445 H640 V430' },
      { id: 'audio', sig: ['AUDIO'], kind: 'analog', label: 'Audio channels A / B / C', d: 'M690,430 V500' },
      { id: 'spkw', sig: ['AUDIO'], kind: 'analog', label: 'Speaker output', d: 'M675,560 V610' },
      { id: 'fdd', sig: ['RDATA', 'INDEX'], kind: 'ctrl', label: 'Drive: STEP DIR RDATA WDATA INDEX', d: 'M865,430 V500' },
      { id: 'cent', sig: ['PRND', 'STROBE', 'BUSY'], kind: 'data', label: 'Centronics D0–D6 · /STROBE · BUSY', d: 'M1055,430 V500' },
    ],
  },
  min: {
    title: 'Minimal Z80 system <span>(block diagram · click a chip or a line)</span>',
    buses: { A: 300, D: 318, C: 336 }, busX: [200, 1000],
    chips: [
      { id: 'osc', x: 40, y: 60, w: 120, h: 60, name: 'Oscillator', sub: '4 MHz', ref: 'X1' },
      { id: 'rst', x: 40, y: 160, w: 120, h: 60, name: 'Reset', sub: 'RC + button', ref: 'R1 C1' },
      { id: 'z80', x: 220, y: 40, w: 160, h: 200, name: 'Z80', sub: 'CPU · 4 MHz', ref: 'U1', bus: { A: 250, D: 300, C: 350 } },
      { id: 'mrom', x: 460, y: 80, w: 140, h: 100, name: 'EPROM 2764', sub: '8 KB · &0000–&1FFF', ref: 'U2', bus: { A: 490, D: 530, C: 570 } },
      { id: 'mram', x: 640, y: 80, w: 140, h: 100, name: 'SRAM 6264', sub: '8 KB · &8000–&9FFF', ref: 'U3', bus: { A: 670, D: 710, C: 750 } },
      { id: 'mdec', x: 820, y: 80, w: 140, h: 100, name: '74LS138', sub: 'address decoder', ref: 'U4', bus: { A: 850, C: 930 } },
      { id: 'mout', x: 460, y: 400, w: 140, h: 90, name: '74LS374', sub: 'output port &00', ref: 'U5', bus: { D: 530, C: 570 } },
      { id: 'min', x: 640, y: 400, w: 140, h: 90, name: '74LS244', sub: 'input port &01', ref: 'U6', bus: { D: 710, C: 750 } },
      { id: 'leds', x: 460, y: 550, w: 140, h: 60, name: '8 LEDs', sub: 'display', ext: true },
      { id: 'sw', x: 640, y: 550, w: 140, h: 60, name: '8 switches', sub: 'input', ext: true },
    ],
    wires: [
      { id: 'abus', sig: ['A'], kind: 'addr', w: 5, label: 'Address bus A0–A15', d: 'M200,300 H1000' },
      { id: 'dbus', sig: ['D'], kind: 'data', w: 5, label: 'Data bus D0–D7', d: 'M200,318 H1000' },
      { id: 'cbus', sig: ['MREQ', 'IORQ', 'RD', 'WR'], kind: 'ctrl', w: 4, label: 'Control bus /MREQ /IORQ /RD /WR', d: 'M200,336 H1000' },
      { id: 'clk4', sig: ['CLK'], kind: 'clk', label: '4 MHz clock', d: 'M160,90 H220' },
      { id: 'reset', sig: ['RESET'], kind: 'ctrl', label: '/RESET', d: 'M160,190 H220' },
      { id: 'csrom', sig: ['CSROM'], kind: 'ctrl', label: '/CS EPROM (Y0)', d: 'M890,80 V50 H530 V80' },
      { id: 'csram', sig: ['CSRAM'], kind: 'ctrl', label: '/CS SRAM (Y4)', d: 'M870,80 V62 H710 V80' },
      { id: 'csout', sig: ['CSOUT'], kind: 'ctrl', label: 'Port &00 enable', d: 'M945,180 V385 H585 V400' },
      { id: 'csin', sig: ['CSIN'], kind: 'ctrl', label: 'Port &01 enable', d: 'M915,180 V375 H765 V400' },
      { id: 'ledw', sig: ['LED'], kind: 'data', label: 'Outputs Q0–Q7 → LEDs', d: 'M530,490 V550' },
      { id: 'sww', sig: ['SW'], kind: 'data', label: 'Switches → inputs', d: 'M710,550 V490' },
    ],
  },
};

const CHIPINFO = {
  z80: { role: '8-bit processor: runs the program and drives the address (16-bit), data (8-bit) and control buses.',
    sigs: ['CLK', 'M1', 'MREQ', 'IORQ', 'RD', 'WR', 'RFSH', 'WAIT', 'INT', 'A', 'D'], regs: () => { const r = stateAt(ui.step).r; return [['PC', hex(r.PC, 4)], ['SP', hex(r.SP, 4)], ['AF', hex(r.A << 8 | r.F, 4)], ['HL', hex(r.H << 8 | r.L, 4)]]; }, cpu: true },
  ga: { role: "Amstrad's custom chip: divides the 16 MHz clock (4 MHz CPU, 1 MHz CRTC), reads video RAM, converts pixels to RGB through the palette, generates /INT and the wait states.",
    sigs: ['CLK16', 'CLK', 'INT', 'WAIT', 'RAS', 'CAS', 'RGB'], regs: () => [['Screen mode', '1 (320×200)'], ['Ink 0 / 1', '1 / 24'], ['Border', '1 (blue)'], ['Lower / upper ROM', 'off / off'], ['Line counter', '37']],
    blocks: [['Clock divider', '16 MHz → 4 MHz, 1 MHz', 'CLK4 ↑'], ['RAM arbitration', 'CPU ↔ video, /WAIT', '/WAIT=0'], ['Pixel serializer', 'byte → 4 mode-1 pixels', '&F0'], ['Palette', '17 inks out of 27 colors', 'ink1 = 24'], ['Interrupt counter', '52 lines → /INT', '37/52'], ['ROM select', 'lower &0000 · upper &C000', 'off/off']] },
  pal: { role: 'Programmable logic that switches the 16 KB banks of the expansion RAM (the extra 64 KB of the 6128).',
    sigs: ['A', 'D'], regs: () => [['Configuration', '&C0 (0,1,2,3)'], ['Ext. bank', '—']], blocks: [['Port &7Fxx decoding', 'bits 7–6 = 11', ''], ['Bank table', '8 configurations', 'C0'], ['Bank /CAS outputs', 'bank 0 / 1', '0']] },
  rom: { role: 'Internal ROM: operating system (firmware, &BBxx vectors) and Locomotive BASIC 1.1 interpreter.', sigs: ['A', 'D', 'RD'], regs: () => [['Size', '32 KB'], ['OS', '&0000–&3FFF'], ['BASIC', '&C000–&FFFF']] },
  amsdos: { role: 'AMSDOS expansion ROM: disk commands (CAT, LOAD, SAVE, |A, |B), FDC driver.', sigs: ['A', 'D', 'RD'], regs: () => [['Size', '16 KB'], ['ROM number', '7'], ['Area', '&C000–&FFFF']] },
  ram0: { role: 'Main 64 KB bank (8 × 4164 64-Kbit chips). The 16 KB at &C000 are used as screen memory.', sigs: ['RAS', 'CAS', 'A', 'D'], regs: () => [['Program', '&4000–&4028'], ['Screen', '&C000–&FFFF'], ['Stack', '&BFF8']] },
  ram1: { role: '64 KB expansion bank, accessed through 16 KB windows via the PAL.', sigs: ['RAS', 'CAS', 'A', 'D'], regs: () => [['Banks', '4 × 16 KB'], ['Active window', 'none']] },
  crtc: { role: 'Cathode ray tube controller: generates the video address counters and the horizontal (64 µs) and vertical (20 ms) syncs.',
    sigs: ['MA', 'HSYNC', 'VSYNC'], regs: () => [['R0 total H', '63'], ['R1 H displayed', '40'], ['R2 H sync', '46'], ['R4 total V', '38'], ['R6 V displayed', '25'], ['R7 V sync', '30'], ['R9 lines/char', '7'], ['R12–13 start', '&3000']],
    blocks: [['Horizontal counter', 'R0 = 63', '17'], ['Raster line counter', 'R9 = 7', '3'], ['Row counter', 'R4 = 38', '12'], ['MA generator', '14-bit video address', '&31E4'], ['Sync generator', 'HSYNC, VSYNC', '0 / 0'], ['Registres R0–R17', 'port &BCxx / &BDxx', 'R12']] },
  ppi: { role: 'Parallel interface: port A ↔ PSG, port B ← VSYNC / printer BUSY / links, port C → keyboard row, tape motor, PSG control.',
    sigs: ['PSGD', 'BDIR', 'BC1', 'KROW'], regs: () => [['Port A (&F4)', '&0E'], ['Port B (&F5)', '&5E'], ['Port C (&F6)', '&49'], ['Control (&F7)', '&82']] },
  psg: { role: 'Programmable sound generator: 3 square-wave voices, noise, envelope. Its port A also reads the keyboard columns.',
    sigs: ['PSGD', 'BDIR', 'BC1', 'KCOL', 'AUDIO'], regs: () => [['R0–R1 period A', '&01DE'], ['R7 mixer', '&3E'], ['R8 volume A', '15'], ['R14 port A', '&FF']],
    blocks: [['Tone generator A', 'period &1DE', '≈ 262 Hz'], ['Tone B', 'off', ''], ['Tone C', 'off', ''], ['Noise generator', 'R6', 'off'], ['Envelope', 'R11–R13', '—'], ['Port A (I/O)', 'keyboard columns', '&FF']] },
  fdc: { role: 'NEC floppy disk controller: track seek, MFM read/write. .DSK images (standard and extended) are mounted in the virtual drives.',
    sigs: ['RDATA', 'INDEX'], regs: () => [['Main status', '&80 (RQM)'], ['Track A:', '0'], ['Sector', '&C1'], ['Command', 'READ DATA']] },
  prn: { role: '74LS273 latch on port &EFxx: 7 data bits + /STROBE to the Centronics connector. BUSY is read through the PPI.', sigs: ['PRND', 'STROBE', 'BUSY'], regs: () => [['Last byte', "&41 'A'"], ['BUSY', '0']] },
  kdec: { role: 'BCD → 10-output decoder: activates one keyboard matrix row at a time.', sigs: ['KROW', 'KSEL'], regs: () => [['Active row', '9']] },
  amp: { role: 'Mixes the three PSG voices and drives the internal speaker (and the stereo headphone jack).', sigs: ['AUDIO'], regs: () => [['Volume', '70 %']] },
  xtal: { role: 'Crystal oscillator: master clock of the whole machine.', sigs: ['CLK16'], regs: () => [['Frequency', '16.000 MHz']] },
  mon: { role: 'External monitor: receives R, G, B (3 levels each) and composite sync. Shown in the Machine tab.', sigs: ['RGB', 'HSYNC'], regs: () => [], ext: true },
  kbd: { role: '80-key matrix (10 rows × 8 columns). The virtual keyboard is in the Machine tab.', sigs: ['KSEL', 'KCOL'], regs: () => [], ext: true },
  drive: { role: 'Virtual 3-inch drive: mounted .DSK disk image.', sigs: ['RDATA', 'INDEX'], regs: () => [['Image', 'demo.dsk'], ['Format', 'DATA 178 KB']], ext: true },
  printer: { role: 'Virtual dot-matrix printer: output is shown on continuous paper in the Machine tab.', sigs: ['PRND', 'STROBE', 'BUSY'], regs: () => [], ext: true },
  spk: { role: 'Speaker: sound is played through the PC sound card.', sigs: ['AUDIO'], regs: () => [], ext: true },
  osc: { role: '4 MHz oscillator: drives the Z80 clock directly.', sigs: ['CLK'], regs: () => [['Frequency', '4.000 MHz']] },
  rst: { role: 'RC circuit that holds /RESET low at power-up; manual reset button.', sigs: ['RESET'], regs: () => [] },
  mrom: { role: '8 KB EPROM holding the program, selected for &0000–&1FFF.', sigs: ['A', 'D', 'CSROM', 'RD'], regs: () => [['Range', '&0000–&1FFF']] },
  mram: { role: '8 KB static RAM, selected for &8000–&9FFF.', sigs: ['A', 'D', 'CSRAM', 'RD', 'WR'], regs: () => [['Range', '&8000–&9FFF']] },
  mdec: { role: '3-to-8 decoder: A13–A15 select the memory chips, A0 and /IORQ the ports.', sigs: ['A', 'CSROM', 'CSRAM', 'CSOUT', 'CSIN'], regs: () => [['Inputs', 'A13 A14 A15']] },
  mout: { role: '8-bit latch: OUT (&00),A lights the LEDs.', sigs: ['D', 'CSOUT', 'LED'], regs: () => [['Value', '&55']] },
  min: { role: 'Tri-state buffer: IN A,(&01) reads the switches.', sigs: ['D', 'CSIN', 'SW'], regs: () => [['Value', '&0F']] },
  leds: { role: '8 LEDs wired to the output port.', sigs: ['LED'], regs: () => [], ext: true },
  sw: { role: '8 switches wired to the input port.', sigs: ['SW'], regs: () => [], ext: true },
};

const board = { sel: null };
function buildBoard() {
  const B = BOARDS[$('#machine').value];
  const svg = $('#board-svg');
  svg.innerHTML = '';
  $('#board-title').innerHTML = B.title;
  const wiresG = S('g', {}, svg), chipsG = S('g', {}, svg);
  const addWire = (w, d, kindW) => {
    const g = S('g', { class: 'wg', 'data-w': w.id }, wiresG);
    S('path', { d, class: `wire ${w.kind}`, 'stroke-width': kindW || w.w || 2.5 }, g);
    S('path', { d, class: 'hit' }, g);
    return g;
  };
  // Buses and lines
  B.wires.forEach(w => addWire(w, w.d));
  // Chip taps on the buses
  B.chips.forEach(c => {
    if (!c.bus) return;
    Object.entries(c.bus).forEach(([k, x]) => {
      const w = B.wires.find(v => v.id === { A: 'abus', D: 'dbus', C: 'cbus' }[k]);
      const y = B.buses[k], from = c.y + c.h < y ? c.y + c.h : c.y;
      addWire(w, `M${x},${from} V${y}`, 2.5);
      S('circle', { cx: x, cy: y, r: 3, class: 'junction' }, wiresG);
    });
  });
  // Bus labels
  [['A', 'A0–A15'], ['D', 'D0–D7'], ['C', 'CTRL']].forEach(([k, t]) => S('text', { x: B.busX[1] - 4, y: B.buses[k] - 4, class: 'bl', 'text-anchor': 'end' }, wiresG, t));
  // Chips
  B.chips.forEach(c => {
    const g = S('g', { class: 'chip' + (c.ext ? ' ext' : ''), 'data-c': c.id }, chipsG);
    if (!c.ext) {
      const n = Math.floor((c.w - 16) / 11);
      for (let i = 0; i < n; i++) {
        S('rect', { x: c.x + 10 + i * 11, y: c.y - 4, width: 5, height: 4, class: 'pinrow' }, g);
        S('rect', { x: c.x + 10 + i * 11, y: c.y + c.h, width: 5, height: 4, class: 'pinrow' }, g);
      }
    }
    S('rect', { x: c.x, y: c.y, width: c.w, height: c.h, rx: c.ext ? 8 : 3, class: 'body' }, g);
    if (!c.ext) S('path', { d: `M${c.x},${c.y + c.h / 2 - 6} a6,6 0 0 1 0,12`, class: 'notch' }, g);
    S('text', { x: c.x + c.w / 2, y: c.y + c.h / 2 + (c.h > 50 ? -2 : 0), class: 'cn' }, g, c.name);
    S('text', { x: c.x + c.w / 2, y: c.y + c.h / 2 + 14, class: 'cs' }, g, c.sub);
    if (c.ref) S('text', { x: c.x + c.w - 5, y: c.y + c.h - 5, class: 'cr' }, g, c.ref);
  });
  selectChip(B.chips.find(c => c.id === 'z80').id);
}

$('#board-svg').addEventListener('click', e => {
  const wg = e.target.closest('.wg'), ch = e.target.closest('.chip');
  if (wg) {
    const w = BOARDS[$('#machine').value].wires.find(v => v.id === wg.dataset.w);
    $$('.wg').forEach(x => x.classList.toggle('sel', x.dataset.w === w.id));
    w.sig.slice().reverse().forEach(s => addSignal(s));
    activate('dock', 'la');
  } else if (ch) selectChip(ch.dataset.c);
});
$('#board-svg').addEventListener('dblclick', e => {
  const ch = e.target.closest('.chip');
  if (ch) openInside(ch.dataset.c);
});
$('#board-svg').addEventListener('mousemove', e => {
  const wg = e.target.closest('.wg'), tip = $('#wire-tip');
  if (!wg) { tip.hidden = true; return; }
  const w = BOARDS[$('#machine').value].wires.find(v => v.id === wg.dataset.w);
  const box = $('.board-svg-wrap').getBoundingClientRect();
  tip.hidden = false;
  tip.innerHTML = `${esc(w.label)} <span class="muted">· click: add to the timing diagram</span>`;
  tip.style.left = (e.clientX - box.left + 14) + 'px';
  tip.style.top = (e.clientY - box.top + 12) + 'px';
});
$('#board-svg').addEventListener('mouseleave', () => { $('#wire-tip').hidden = true; });

function selectChip(id) {
  board.sel = id;
  $$('.chip').forEach(g => g.classList.toggle('sel', g.dataset.c === id));
  const c = BOARDS[$('#machine').value].chips.find(x => x.id === id), info = CHIPINFO[id];
  const regs = info.regs();
  $('#inspector').innerHTML = `
    <h3>${c.name}</h3><div class="sub">${c.sub}${c.ref ? ' · ' + c.ref : ''}</div>
    <p>${info.role}</p>
    ${regs.length ? `<div class="sect">${info.ext ? 'State' : 'Registers / state'}</div><table>${regs.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>` : ''}
    <div class="sect">Signals (click: timing diagram)</div>
    <div class="sigchips">${info.sigs.map(s => `<span data-s="${s}">${SIGS[s].name}</span>`).join('')}</div>
    ${info.ext ? '<button class="tb primary" data-go="machine">Show in the Machine tab →</button>' :
      `<button class="tb primary" data-in="${id}">${info.cpu ? 'Open the CPU inside view →' : 'Show the inside of the chip →'}</button>`}
    <p class="muted" style="margin-top:10px">Tip: double-click a chip to open it.</p>`;
}
$('#inspector').addEventListener('click', e => {
  const s = e.target.closest('[data-s]'), i = e.target.closest('[data-in]'), g = e.target.closest('[data-go]');
  if (s) { addSignal(s.dataset.s); activate('dock', 'la'); }
  if (i) openInside(i.dataset.in);
  if (g) activate('ws', g.dataset.go);
});

function openInside(id) {
  const info = CHIPINFO[id];
  if (info.cpu) { activate('ws', 'cpu'); return; }
  if (info.ext) { activate('ws', 'machine'); return; }
  const c = BOARDS[$('#machine').value].chips.find(x => x.id === id);
  const blocks = info.blocks || [['Internal logic', 'detailed view coming soon', '']];
  $('#modal-title').textContent = `Inside: ${c.name} — ${c.sub}`;
  $('#modal-body').innerHTML = `<div class="ib-grid">${blocks.map(([n, d, v], k) => `<div class="ib${k === 1 ? ' hot' : ''}"><b>${n}</b><span>${d}</span>${v ? `<code>${v}</code>` : ''}</div>`).join('')}</div>
    <div class="modal-note">Mockup: in the simulator, this view will be animated like the Z80 one (active blocks, data paths, clickable internal signals).</div>`;
  $('#modal').hidden = false;
}
$('#modal-close').onclick = () => { $('#modal').hidden = true; };
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') $('#modal').hidden = true; });

$('#machine').addEventListener('change', () => { buildBoard(); renderSidebar(); renderStatus(stateAt(ui.step).r); });

/* =====================================================================
   Logic analyzer / timing diagrams
   Time base: 1 unit = 1/8 T-state = 31.25 ns
   ===================================================================== */
const SIGS = {
  CLK: { name: 'CLK', kind: 'bit', c: '--clk' }, CLK16: { name: '16 MHz', kind: 'bit', c: '--clk' },
  M1: { name: '/M1', kind: 'bit', c: '--ctrl' }, MREQ: { name: '/MREQ', kind: 'bit', c: '--ctrl' }, IORQ: { name: '/IORQ', kind: 'bit', c: '--ctrl' },
  RD: { name: '/RD', kind: 'bit', c: '--ctrl' }, WR: { name: '/WR', kind: 'bit', c: '--ctrl' }, RFSH: { name: '/RFSH', kind: 'bit', c: '--ctrl' },
  WAIT: { name: '/WAIT', kind: 'bit', c: '--ctrl' }, INT: { name: '/INT', kind: 'bit', c: '--ctrl' }, RESET: { name: '/RESET', kind: 'bit', c: '--ctrl' },
  A: { name: 'A[15:0]', kind: 'bus', c: '--addr', n: 4 }, D: { name: 'D[7:0]', kind: 'bus', c: '--data', n: 2 },
  RAS: { name: '/RAS', kind: 'bit', c: '--ctrl' }, CAS: { name: '/CAS', kind: 'bit', c: '--ctrl' },
  MA: { name: 'MA[13:0]', kind: 'bus', c: '--addr', n: 4 }, HSYNC: { name: 'HSYNC', kind: 'bit', c: '--video' }, VSYNC: { name: 'VSYNC', kind: 'bit', c: '--video' },
  RGB: { name: 'RGB (ink)', kind: 'bus', c: '--video', n: 2 },
  PSGD: { name: 'PSG DA[7:0]', kind: 'bus', c: '--data', n: 2 }, BDIR: { name: 'BDIR', kind: 'bit', c: '--ctrl' }, BC1: { name: 'BC1', kind: 'bit', c: '--ctrl' },
  KROW: { name: 'PC[3:0]', kind: 'bus', c: '--ctrl', n: 1 }, KSEL: { name: 'Keyboard row', kind: 'bus', c: '--ctrl', n: 1 }, KCOL: { name: 'Columns', kind: 'bus', c: '--data', n: 2 },
  AUDIO: { name: 'Audio A', kind: 'analog', c: '--analog' },
  RDATA: { name: 'RDATA', kind: 'bit', c: '--ctrl' }, INDEX: { name: '/INDEX', kind: 'bit', c: '--ctrl' },
  PRND: { name: 'PRN D[6:0]', kind: 'bus', c: '--data', n: 2 }, STROBE: { name: '/STROBE', kind: 'bit', c: '--ctrl' }, BUSY: { name: 'BUSY', kind: 'bit', c: '--ctrl' },
  CSROM: { name: '/CS ROM', kind: 'bit', c: '--ctrl' }, CSRAM: { name: '/CS RAM', kind: 'bit', c: '--ctrl' },
  CSOUT: { name: '/OE port 00', kind: 'bit', c: '--ctrl' }, CSIN: { name: '/OE port 01', kind: 'bit', c: '--ctrl' },
  LED: { name: 'LED[7:0]', kind: 'bus', c: '--data', n: 2 }, SW: { name: 'SW[7:0]', kind: 'bus', c: '--data', n: 2 },
};

const CYCLES = [
  { k: 'M1', a: 0x4003, d: 0x7E, r: 0x002F, lbl: 'LD A,(HL)' },
  { k: 'MR', a: 0x4019, d: 0x48 },
  { k: 'M1', a: 0x4004, d: 0xB7, r: 0x0030, lbl: 'OR A' },
  { k: 'M1', a: 0x4005, d: 0x28, r: 0x0031, lbl: 'JR Z,border' },
  { k: 'MR', a: 0x4006, d: 0x06 },
  { k: 'M1', a: 0x4007, d: 0xCD, r: 0x0032, lbl: 'CALL TXT_OUTPUT' },
  { k: 'MR', a: 0x4008, d: 0x5A },
  { k: 'MR', a: 0x4009, d: 0xBB, extra: 1 },
  { k: 'MW', a: 0xBFF7, d: 0x40 },
  { k: 'MW', a: 0xBFF6, d: 0x0A },
];

function genTrace() {
  const T = {}; Object.keys(SIGS).forEach(k => T[k] = []);
  const marks = [];
  let t = 0;
  for (const c of CYCLES) {
    const nT = c.k === 'M1' ? 4 : 3 + (c.extra || 0);
    marks.push({ t, lbl: c.lbl, k: c.k });
    for (let h = 0; h < nT * 2; h++) {
      let m1 = 1, mreq = 1, rd = 1, wr = 1, rfsh = 1, wait = 1, A = c.a, D = null;
      if (c.k === 'M1') {
        if (h >= 1 && h <= 4) m1 = 0;
        if (h >= 1 && h <= 3) { mreq = 0; rd = 0; }
        if (h >= 5 && h <= 6) mreq = 0;
        if (h >= 4) { rfsh = 0; A = c.r; }
        if (h === 2 || h === 3) D = c.d;
      } else if (c.k === 'MR') {
        if (h >= 1 && h <= 4) { mreq = 0; rd = 0; }
        if (h === 3 || h === 4) D = c.d;
        if (h === 2 || h === 3) wait = 0;
      } else if (c.k === 'MW') {
        if (h >= 1 && h <= 4) mreq = 0;
        if (h === 3 || h === 4) wr = 0;
        if (h >= 1 && h <= 5) D = c.d;
        if (h === 2 || h === 3) wait = 0;
      }
      for (let q = 0; q < 4; q++) {
        T.M1.push(m1); T.MREQ.push(mreq); T.RD.push(rd); T.WR.push(wr); T.RFSH.push(rfsh); T.WAIT.push(wait);
        T.A.push(A); T.D.push(D);
        T.CSROM.push(mreq === 0 && A < 0x2000 ? 0 : 1);
        T.CSRAM.push(mreq === 0 && A >= 0x8000 && A < 0xA000 ? 0 : 1);
      }
    }
    t += nT;
  }
  const N = T.M1.length;
  for (let u = 0; u < N; u++) {
    T.CLK.push(u % 8 < 4 ? 1 : 0);
    T.CLK16.push(u % 2 === 0 ? 1 : 0);
    T.IORQ.push(1); T.INT.push(1); T.RESET.push(1);
    T.RAS.push(u % 16 >= 2 && u % 16 < 7 ? 0 : 1);
    T.CAS.push(u % 16 >= 4 && u % 16 < 7 ? 0 : 1);
    T.MA.push(0x31E4 + Math.floor(u / 32));
    T.HSYNC.push(u >= 150 && u < 180 ? 1 : 0); T.VSYNC.push(0);
    T.RGB.push(Math.floor(u / 8) % 4 === 1 ? 0x18 : 0x01);
    T.PSGD.push(u < 60 ? 0x0E : u < 120 ? null : 0xFF);
    T.BDIR.push(u >= 20 && u < 40 ? 1 : 0); T.BC1.push(u >= 20 && u < 40 ? 1 : 0);
    T.KROW.push(9); T.KSEL.push(9); T.KCOL.push(u > 100 && u < 140 ? 0xF7 : 0xFF);
    T.AUDIO.push(0.5 + 0.42 * Math.sign(Math.sin(u / 22)) * (1 - (u % 44) / 200));
    T.RDATA.push(u % 64 === 10 || u % 64 === 42 ? 0 : 1); T.INDEX.push(1);
    T.PRND.push(u >= 40 && u < 200 ? 0x41 : null); T.STROBE.push(u >= 90 && u < 110 ? 0 : 1); T.BUSY.push(u >= 100 && u < 190 ? 1 : 0);
    T.CSOUT.push(1); T.CSIN.push(1); T.LED.push(0x55); T.SW.push(0x0F);
  }
  return { T, N, marks };
}
const TRACE = genTrace();
const LA = { sigs: ['CLK', 'M1', 'MREQ', 'RD', 'WR', 'RFSH', 'WAIT', 'A', 'D'], zoom: 4, cursor: 4, fresh: null };

function addSignal(s) {
  if (!SIGS[s]) return;
  LA.sigs = [s, ...LA.sigs.filter(x => x !== s)];
  LA.fresh = s;
  renderLA();
}
const cssVar = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

function renderLA() {
  const { T, N, marks } = TRACE, px = LA.zoom, RH = 24, TOP = 22;
  const W = N * px + 30, H = TOP + RH * LA.sigs.length;
  const svg = $('#la-svg');
  svg.setAttribute('width', W); svg.setAttribute('height', H);
  svg.innerHTML = '';
  // one tick per T-state
  for (let t = 0; t * 8 <= N; t++) {
    const x = t * 8 * px;
    S('line', { x1: x, y1: TOP - 4, x2: x, y2: H, stroke: '#ffffff10' }, svg);
    S('text', { x: x + 3, y: 10, fill: '#56616f', 'font-size': 9.5, 'font-family': 'JetBrains Mono' }, svg, 'T' + (t + 1));
  }
  marks.forEach(m => {
    const x = m.t * 8 * px;
    S('line', { x1: x, y1: 0, x2: x, y2: H, stroke: '#ffd54f40', 'stroke-dasharray': '2 3' }, svg);
    S('text', { x: x + 3, y: 20, fill: m.lbl ? '#ffd54f' : '#8a95a8', 'font-size': 10, 'font-family': 'JetBrains Mono', 'font-weight': 600 }, svg, m.lbl ? m.lbl : m.k === 'MR' ? 'read' : 'write');
  });
  LA.sigs.forEach((s, row) => {
    const def = SIGS[s], arr = T[s], col = cssVar(def.c), y0 = TOP + row * RH, hi = y0 + 5, lo = y0 + RH - 5, mid = (hi + lo) / 2;
    if (def.kind === 'bit') {
      let d = `M0,${arr[0] ? hi : lo}`;
      for (let u = 1; u < N; u++) if (arr[u] !== arr[u - 1]) d += ` H${u * px} V${arr[u] ? hi : lo}`;
      d += ` H${N * px}`;
      S('path', { d, fill: 'none', stroke: col, 'stroke-width': 1.6 }, svg);
    } else if (def.kind === 'bus') {
      let s0 = 0;
      for (let u = 1; u <= N; u++) {
        if (u === N || arr[u] !== arr[s0]) {
          const xa = s0 * px, xb = u * px, v = arr[s0];
          if (v == null) S('line', { x1: xa, y1: mid, x2: xb, y2: mid, stroke: col, 'stroke-opacity': .35, 'stroke-dasharray': '3 2' }, svg);
          else {
            const e = Math.min(3, (xb - xa) / 2);
            S('polygon', { points: `${xa},${mid} ${xa + e},${hi} ${xb - e},${hi} ${xb},${mid} ${xb - e},${lo} ${xa + e},${lo}`, fill: col + '22', stroke: col, 'stroke-width': 1.2 }, svg);
            if (xb - xa > def.n * 8 + 6) S('text', { x: (xa + xb) / 2, y: mid + 4, fill: col, 'font-size': 10.5, 'text-anchor': 'middle', 'font-family': 'JetBrains Mono', 'font-weight': 600 }, svg, hex(v, def.n));
          }
          s0 = u;
        }
      }
    } else {
      const pts = arr.map((v, u) => `${u * px},${lo - v * (lo - hi)}`).join(' ');
      S('polyline', { points: pts, fill: 'none', stroke: col, 'stroke-width': 1.4 }, svg);
    }
  });
  // cursor
  if (LA.cursor != null) {
    const x = LA.cursor * px;
    S('line', { x1: x, y1: 0, x2: x, y2: H, stroke: '#ffffff', 'stroke-width': 1, 'stroke-opacity': .8 }, svg);
    const tt = Math.floor(LA.cursor / 8);
    $('#la-cur').innerHTML = `Cursor: <b>T${tt + 1}</b> · <b>${(LA.cursor * 31.25).toLocaleString('en-US')} ns</b>`;
  }
  $('#la-names').innerHTML = `<div class="ruler">signal<span class="v">value</span></div>` + LA.sigs.map(s => {
    const def = SIGS[s], v = TRACE.T[s][LA.cursor ?? 0];
    const vs = def.kind === 'bit' ? v : def.kind === 'bus' ? (v == null ? 'Z' : hex(v, def.n)) : v.toFixed(2);
    return `<div class="${LA.fresh === s ? 'new' : ''}"><i style="background:var(${def.c})"></i>${def.name}<span class="v">${vs}</span><span class="x" data-x="${s}" title="Remove">×</span></div>`;
  }).join('');
  LA.fresh = null;
}
$('#la-names').addEventListener('click', e => {
  const x = e.target.closest('[data-x]');
  if (x) { LA.sigs = LA.sigs.filter(s => s !== x.dataset.x); renderLA(); }
});
$('#la-wave').addEventListener('click', e => {
  const r = $('#la-svg').getBoundingClientRect();
  const u = Math.max(0, Math.min(TRACE.N - 1, Math.floor((e.clientX - r.left) / LA.zoom)));
  const t = Math.floor(u / 8);
  if (t < STEPS.length) { ui.step = t; updateCPU(); renderRight(); renderEditor(); renderMem(); renderDis(); }
  LA.cursor = u; renderLA();
});
// In a short window the dock is collapsed by default (see style.css): toggle "dock-open" instead.
const lowScreen = matchMedia('(max-height: 700px)');
const dockCollapsed = () => lowScreen.matches ? !$('.layout').classList.contains('dock-open') : $('.layout').classList.contains('dock-min');
const dockLabel = () => { $('#dock-toggle').textContent = dockCollapsed() ? '▴ Expand' : '▾ Collapse'; };
$('#dock-toggle').onclick = () => {
  $('.layout').classList.toggle(lowScreen.matches ? 'dock-open' : 'dock-min');
  dockLabel();
};
lowScreen.addEventListener('change', dockLabel);
dockLabel();
$('#la-zp').onclick =() => { LA.zoom = Math.min(12, LA.zoom + 1); renderLA(); };
$('#la-zm').onclick = () => { LA.zoom = Math.max(1, LA.zoom - 1); renderLA(); };

/* =====================================================================
   Dock: memory, disassembly, ports, console
   ===================================================================== */
function renderMem() {
  const { r } = stateAt(ui.step), hl = r.H << 8 | r.L, pc = r.PC;
  const row = a => {
    let hx = '', as = '';
    for (let i = 0; i < 16; i++) {
      const v = MEM.get(a + i) ?? 0, c = a + i === pc ? 'pc' : a + i === hl ? 'hl' : MEM.has(a + i) ? '' : 'z';
      hx += `<span class="${c}">${hex(v)}</span> `;
      as += v >= 32 && v < 127 ? esc(String.fromCharCode(v)) : '·';
    }
    return `<div class="row"><span class="a">&amp;${hex(a, 4)}</span><span class="hx">${hx}</span><span class="as">${as}</span></div>`;
  };
  $('#mem').innerHTML = [0x4000, 0x4010, 0x4020, 0x4030].map(row).join('') +
    '<div class="gap">… · stack</div>' + [0xBFF0].map(row).join('') +
    `<div class="gap">Legend: <span style="background:#ffd54f;color:#111;padding:0 3px">PC</span> · <span style="outline:1px solid #ffa726;color:#ffa726;padding:0 3px">(HL)</span> · Go to: <b>&amp;4000</b> · Bank: <b>0 (C0)</b></div>`;
}
function renderDis() {
  const pc = STEPS[ui.step].i === 0 ? 0x4003 : 0x4004;
  $('#dis').innerHTML = '<table>' + SRC.filter(l => l.T).map(l => {
    const src = l.t.replace(/^\S+:/, '').replace(/;.*/, '').trim().replace(/\s+/, ' ');
    const lab = (l.t.match(/^(\S+):/) || [])[1] || '';
    return `<tr class="${l.a === pc ? 'cur' : ''}"><td class="a">${l.a === pc ? '▶ ' : '  '}&amp;${hex(l.a, 4)}</td><td class="b">${l.b.map(v => hex(v)).join(' ').padEnd(9)}</td><td class="tk-l">${lab}</td><td>${highlight('  ' + src)}</td><td class="t">${l.T} T</td></tr>`;
  }).join('') + '</table>';
}
function renderIO() {
  const rows = [['&7Fxx', 'Gate Array', 'write', '&8D', 'mode 1, lower and upper ROM disabled'], ['&BCxx', 'CRTC — select', 'write', '&0C', 'register R12'],
    ['&BDxx', 'CRTC — data', 'write', '&30', 'screen start &C000'], ['&F4xx', 'PPI port A', 'I/O', '&0E', 'to PSG'], ['&F5xx', 'PPI port B', 'read', '&5E', 'VSYNC=0, BUSY=0'],
    ['&F6xx', 'PPI port C', 'write', '&49', 'keyboard row 9, PSG read'], ['&F7xx', 'PPI control', 'write', '&82', ''], ['&FA7E', 'Disk motor', 'write', '&01', 'on'],
    ['&FB7E', 'FDC status', 'read', '&80', 'ready'], ['&FB7F', 'FDC data', 'I/O', '&C1', 'sector number'], ['&EFxx', 'Printer', 'write', '&41', "'A'"], ['&DFxx', 'Upper ROM select', 'write', '&07', 'AMSDOS']];
  $('#io').innerHTML = '<table><tr><th>Port</th><th>Chip</th><th>Direction</th><th>Last value</th><th>Meaning</th></tr>' +
    rows.map(r => `<tr><td class="tk-n">${r[0]}</td><td>${r[1]}</td><td class="muted">${r[2]}</td><td class="tk-r">${r[3]}</td><td class="muted">${r[4]}</td></tr>`).join('') + '</table>';
}
function renderConsole() {
  $('#console').innerHTML = [
    '<span class="cmd">&gt; z80asm hello.asm -o hello.bin --listing --cpc</span>',
    'Pass 1: 6 symbols defined',
    'Pass 2: 41 bytes generated (&amp;4000–&amp;4028)',
    '<span class="ok">✓ Assembly finished: 0 errors, 0 warnings (11 ms)</span>',
    '<span class="cmd">&gt; Loaded into CPC RAM at &amp;4000 · entry point start</span>',
    '<span class="cmd">&gt; CALL &amp;4000</span>',
    '<span class="w">⏸ Single-step enabled · PC = &amp;4003 (loop)</span>',
  ].join('\n');
}

/* =====================================================================
   Machine: screen, keyboard, printer, sound
   ===================================================================== */
function drawScreen() {
  const cv = $('#screen'), g = cv.getContext('2d');
  const green = $('#mon-type').value === 'green', end = $('#screen-state').value === 'end';
  const col = c => green ? ({ '#000080': '#062b0c', '#ffff00': '#7dff8a', '#ff0000': '#1a5a22' }[c] || c) : c;
  g.fillStyle = col(end ? '#ff0000' : '#000080'); g.fillRect(0, 0, 768, 544);
  g.fillStyle = col('#000080'); g.fillRect(64, 72, 640, 400);
  const lines = [' Amstrad 128K Microcomputer  (v3)', '', ' ©1985 Amstrad Consumer Electronics plc', '           and Locomotive Software Ltd.', '', ' BASIC 1.1', '', 'Ready', 'memory &3FFF', 'Ready', 'load"hello.bin",&4000', 'Ready', 'call &4000'];
  if (end) lines.push('Hello, world!', 'Ready');
  // font stretched horizontally: in mode 1 an 8×8 character takes 16×16 pixels
  g.font = 'bold 15px "Courier New", monospace'; g.textBaseline = 'top';
  g.fillStyle = col('#ffff00');
  const sx = 16 / g.measureText('M').width;
  g.save(); g.scale(sx, 1);
  lines.forEach((l, i) => [...l].forEach((ch, j) => g.fillText(ch, (64 + j * 16) / sx, 72 + i * 16 + 1)));
  g.restore();
  if (end) g.fillRect(64, 72 + lines.length * 16, 16, 16);
  $('.scan').classList.toggle('off', !$('#scanlines').checked);
}
['#mon-type', '#screen-state', '#scanlines'].forEach(s => $(s).addEventListener('change', drawScreen));

const KB = {
  main: [
    [['ESC'], ['1'], ['2'], ['3'], ['4'], ['5'], ['6'], ['7'], ['8'], ['9'], ['0'], ['-'], ['^'], ['CLR', 40], ['DEL', 40]],
    [['TAB', 44], ['Q'], ['W'], ['E'], ['R'], ['T'], ['Y'], ['U'], ['I'], ['O'], ['P'], ['@'], ['['], ['RETURN', 64, 'blue']],
    [['CAPS LOCK', 56], ['A'], ['S'], ['D'], ['F'], ['G'], ['H'], ['J'], ['K'], ['L'], [':'], [';'], [']'], ['', 52, 'blue']],
    [['SHIFT', 70], ['Z'], ['X'], ['C'], ['V'], ['B'], ['N'], ['M'], [','], ['.'], ['/'], ['\\'], ['SHIFT', 70]],
    [['CONTROL', 70], ['COPY', 48], [' ', 300], ['ENTER', 70, 'blue']],
  ],
  pad: [
    [['f7', 0, 'green'], ['f8', 0, 'green'], ['f9', 0, 'green']],
    [['f4', 0, 'green'], ['f5', 0, 'green'], ['f6', 0, 'green']],
    [['f1', 0, 'green'], ['f2', 0, 'green'], ['f3', 0, 'green']],
    [['f0', 0, 'green'], ['↑'], ['.', 0, 'green']],
    [['←'], ['↓'], ['→']],
  ],
};
function buildKeyboard() {
  const mk = rows => rows.map(r => `<div class="kb-row">${r.map(([k, w, c]) => `<span class="key ${c || (k === 'ESC' || k === 'DEL' ? 'red' : '')}" data-k="${esc(k)}" style="${w ? `width:${w}px` : ''}">${esc(k)}</span>`).join('')}</div>`).join('');
  $('#keyboard').innerHTML = `<div class="kb-main">${mk(KB.main)}</div><div class="kb-pad">${mk(KB.pad)}</div>`;
}
function pressKey(el) {
  el.classList.add('down');
  $('#key-info').textContent = `key "${el.dataset.k || 'RETURN'}" → matrix row pressed, read by the PSG (port A)`;
  setTimeout(() => el.classList.remove('down'), 180);
}
$('#keyboard').addEventListener('mousedown', e => { const k = e.target.closest('.key'); if (k) pressKey(k); });
document.addEventListener('keydown', e => {
  if (!$('.pane[data-name="machine"]').classList.contains('active')) return;
  const map = { Escape: 'ESC', Enter: 'RETURN', Backspace: 'DEL', Tab: 'TAB', Shift: 'SHIFT', Control: 'CONTROL', ' ': ' ', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
  const k = map[e.key] || e.key.toUpperCase();
  const el = $$('.key').find(x => x.dataset.k === k);
  if (el) { pressKey(el); e.preventDefault(); }
});

function renderPrinter() {
  $('#paper').textContent = [
    'Z80 STUDIO - LISTING OF hello.asm          2026-10-21',
    '',
    '4000 21 19 40   start:   LD   HL,message',
    '4003 7E         loop:    LD   A,(HL)',
    '4004 B7                  OR   A',
    '4005 28 06               JR   Z,border',
    '4007 CD 5A BB            CALL TXT_OUTPUT',
    '400A 23                  INC  HL',
    '400B 18 F6               JR   loop',
    '400D 06 06      border:  LD   B,6',
    '400F 48                  LD   C,B',
    '4010 CD 38 BC            CALL SCR_SET_BORDER',
    '4013 3E 07               LD   A,7',
    '4015 CD 5A BB            CALL TXT_OUTPUT',
    '4018 C9                  RET',
    '',
    '41 bytes - 0 errors',
  ].join('\n');
}
function renderAY() {
  const v = [0xDE, 0x01, 0, 0, 0, 0, 0, 0x3E, 15, 0, 0, 0, 0, 0];
  $('#ay').innerHTML = v.map((x, i) => `<span>R${i}<b>${hex(x)}</b></span>`).join('');
}
function scopeLoop(ts) {
  const cv = $('#scope');
  if ($('.pane[data-name="machine"]').classList.contains('active') && cv.offsetParent) {
    const g = cv.getContext('2d'), W = cv.width, H = cv.height;
    g.fillStyle = '#071009'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#13301a'; g.lineWidth = 1;
    for (let x = 0; x < W; x += 26) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (let y = 0; y < H; y += 22) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    const chans = [['#7dff8a', 38, 1], ['#4fc3f7', 0, 0], ['#f06292', 0, 0]];
    chans.forEach(([c, per, vol], k) => {
      g.strokeStyle = c; g.lineWidth = 1.6; g.beginPath();
      const yb = 20 + k * 35;
      for (let x = 0; x < W; x++) {
        const y = vol ? yb + (Math.floor((x + ts / 8) / per) % 2 ? 12 : -12) : yb;
        x ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
      g.fillStyle = c; g.font = '10px JetBrains Mono'; g.fillText(['A  262 Hz  vol 15', 'B  off', 'C  off'][k], W - 120, yb - 4);
    });
  }
  requestAnimationFrame(scopeLoop);
}

/* =====================================================================
   Startup
   ===================================================================== */
renderSidebar();
renderEditor();
buildCPU();
buildBoard();
buildKeyboard();
renderPrinter();
renderAY();
renderIO();
renderConsole();
goStep(0);
requestAnimationFrame(scopeLoop);
