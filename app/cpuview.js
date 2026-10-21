import { $, hex, esc, S } from './util.js';
import { ROUTES } from './cpudetail.js';

/* Vue intérieure du Z80A : blocs fonctionnels, banc de registres, chemins de données
   et broches. update() reçoit un T-state commenté (voir microsteps.js). */

const PINS = ['CLK', 'RESET', 'INT', 'NMI', 'WAIT', 'BUSRQ', 'BUSAK', 'HALT', 'M1', 'MREQ', 'IORQ', 'RD', 'WR', 'RFSH'];
const pinLabel = p => (p === 'CLK' ? 'CLK' : '/' + p);
const V = { regEls: {}, blk: {}, paths: {}, pins: {} };

export function buildCPU() {
  const svg = $('#cpu-svg');
  S('rect', { x: 100, y: 20, width: 880, height: 585, rx: 14, class: 'chipframe' }, svg);
  S('text', { x: 540, y: 600, 'text-anchor': 'middle', class: 'chiplabel' }, svg, 'Z80A NMOS — architecture interne simplifiée');

  const P = (id, d, kind) => { V.paths[id] = S('path', { d, class: `wire-p ${kind}` }, svg); };
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
  V.busLbl = S('text', { x: 640, y: 386, class: 'bus-lbl', fill: '#ffa726' }, svg, 'bus de données interne (8 bits)');
  // itinéraires invisibles suivis par les valeurs animées
  for (const [k, d] of Object.entries(ROUTES)) S('path', { id: 'route-' + k, d, fill: 'none', stroke: 'none' }, svg);

  const B = (id, x, y, w, h, title) => {
    const g = S('g', { class: 'blk', 'data-id': id }, svg);
    S('rect', { x, y, width: w, height: h, rx: 6 }, g);
    S('text', { x: x + 10, y: y + 17, class: 't-h' }, g, title);
    V.blk[id] = g;
    return g;
  };
  let g = B('b-int', 120, 40, 200, 90, "Logique d'interruptions");
  V.iff = S('text', { x: 130, y: 82 }, g, '');
  V.imode = S('text', { x: 130, y: 104 }, g, '');
  g = B('b-ir', 120, 150, 200, 60, "Registre d'instruction");
  V.ir = S('text', { x: 130, y: 196, class: 't-v' }, g, '');
  g = B('b-dec', 120, 230, 200, 90, "Décodeur d'instructions");
  V.dec = S('text', { x: 130, y: 280, class: 't-v', 'font-size': 13 }, g, '');
  V.decBits = S('text', { x: 130, y: 304, fill: '#8a95a8', 'font-size': 11, 'font-family': 'JetBrains Mono' }, g, 'tables principale, CB, ED, DD/FD');
  g = B('b-seq', 120, 340, 200, 250, 'Séquenceur / temporisation');
  V.mt = S('text', { x: 130, y: 388, class: 't-v', 'font-size': 22 }, g, '');
  V.tl = S('g', {}, g);
  V.seqTxt = S('text', { x: 130, y: 470, fill: '#8a95a8', 'font-size': 11 }, g, '');
  S('text', { x: 130, y: 500, fill: '#8a95a8', 'font-size': 11 }, g, 'génère /M1 /MREQ /IORQ /RD /WR /RFSH');
  S('text', { x: 130, y: 518, fill: '#8a95a8', 'font-size': 11 }, g, 'échantillonne /WAIT /INT /NMI /BUSRQ');
  g = B('b-acc', 380, 40, 80, 40, 'ACC');
  V.acc = S('text', { x: 450, y: 72, class: 't-v', 'text-anchor': 'end', 'font-size': 13 }, g, '');
  g = B('b-tmp', 480, 40, 80, 40, 'TMP');
  V.tmp = S('text', { x: 550, y: 72, class: 't-v', 'text-anchor': 'end', 'font-size': 13 }, g, '');
  g = S('g', { class: 'blk', 'data-id': 'b-alu' }, svg);
  S('polygon', { points: '370,100 455,100 470,118 485,100 570,100 520,210 420,210' }, g);
  S('text', { x: 470, y: 150, 'text-anchor': 'middle', class: 't-h' }, g, 'UAL (ALU)');
  V.alu = S('text', { x: 470, y: 176, 'text-anchor': 'middle', class: 't-v' }, g, '');
  V.aluExpr = S('text', { x: 470, y: 196, 'text-anchor': 'middle', fill: '#ffd54f', 'font-size': 10.5, 'font-family': 'JetBrains Mono', 'font-weight': 600 }, g, '');
  V.blk['b-alu'] = g;
  g = B('b-f', 485, 235, 110, 50, 'Drapeaux F');
  V.f = S('text', { x: 495, y: 276, class: 't-v', 'font-size': 13, 'letter-spacing': 1 }, g, '');
  g = B('b-rf', 620, 40, 240, 260, 'Banc de registres');
  const RF = [['A', 630, 60], ['F', 685, 60], ["A'", 750, 60], ["F'", 805, 60],
    ['B', 630, 90], ['C', 685, 90], ["B'", 750, 90], ["C'", 805, 90],
    ['D', 630, 120], ['E', 685, 120], ["D'", 750, 120], ["E'", 805, 120],
    ['H', 630, 150], ['L', 685, 150], ["H'", 750, 150], ["L'", 805, 150],
    ['IX', 630, 190, 105], ['IY', 750, 190, 105], ['SP', 630, 222, 105], ['PC', 750, 222, 105], ['I', 630, 260, 50], ['R', 685, 260, 50], ['WZ', 750, 260, 105]];
  RF.forEach(([n, x, y, w = 50]) => {
    const rg = S('g', { class: 'reg' }, g);
    S('rect', { x, y, width: w, height: 26, rx: 3 }, rg);
    S('text', { x: x + 4, y: y + 10, class: 'rn' }, rg, n === 'WZ' ? 'WZ (MEMPTR)' : n);
    V.regEls[n] = { g: rg, v: S('text', { x: x + w - 5, y: y + 20, class: 'rv' }, rg, ''), w };
  });
  g = B('b-inc', 620, 400, 240, 55, 'Incrémenteur / décrémenteur 16 bits');
  V.inc = S('text', { x: 630, y: 442, class: 't-v', 'font-size': 13 }, g, '');
  g = B('b-ab', 885, 40, 80, 260, 'Tampon');
  S('text', { x: 895, y: 72, class: 't-h' }, g, "d'adresses");
  V.ab = S('text', { x: 925, y: 175, 'text-anchor': 'middle', class: 't-v', fill: '#42a5f5' }, g, '');
  g = B('b-db', 885, 400, 80, 170, 'Tampon');
  S('text', { x: 895, y: 432, class: 't-h' }, g, 'données');
  V.db = S('text', { x: 925, y: 492, 'text-anchor': 'middle', class: 't-v', fill: '#ffa726' }, g, '');

  PINS.forEach((p, i) => {
    const y = 45 + i * 38;
    const pg = S('g', { class: 'pin' + (p === 'CLK' ? ' clk' : '') }, svg);
    S('line', { x1: 70, y1: y, x2: 100, y2: y }, pg);
    S('circle', { cx: 62, cy: y, r: 4.5 }, pg);
    S('text', { x: 52, y: y + 4, 'text-anchor': 'end' }, pg, pinLabel(p));
    V.pins[p] = pg;
  });
  S('text', { x: 1015, y: 160, class: 'bus-lbl', fill: '#42a5f5' }, svg, 'A0–A15');
  V.abOut = S('text', { x: 1015, y: 190, class: 'bus-lbl', fill: '#42a5f5' }, svg, '');
  S('text', { x: 1015, y: 475, class: 'bus-lbl', fill: '#ffa726' }, svg, 'D0–D7');
  V.dbOut = S('text', { x: 1015, y: 505, class: 'bus-lbl', fill: '#ffa726' }, svg, '');

  V.tok = S('g', { class: 'tokens' }, svg);

  svg.addEventListener('click', e => {
    const b = e.target.closest('.blk');
    Object.values(V.blk).forEach(x => x.classList.remove('sel'));
    if (b) b.classList.add('sel');
  });
  $('#pinleds').innerHTML = PINS.map(p => `<span data-p="${p}"><i></i>${pinLabel(p)}</span>`).join('');
}

// valeurs animées le long des itinéraires : chaque étape (stage) démarre 0,75 s après la précédente
const STAGE = 0.75;
function drawTokens(list) {
  V.tok.innerHTML = '';
  const t0 = $('#cpu-svg').getCurrentTime();
  list.forEach(tr => {
    const g = S('g', { class: `tok ${tr.kind}`, visibility: 'hidden' }, V.tok);
    const txt = tr.label ? `${tr.value} ${tr.label}` : tr.value;
    const w = Math.max(30, txt.length * 6.7 + 12);
    S('rect', { x: -w / 2, y: -9, width: w, height: 18, rx: 4 }, g);
    S('text', { x: 0, y: 4, 'text-anchor': 'middle' }, g, txt);
    const begin = (t0 + tr.stage * STAGE + 0.05).toFixed(3) + 's';
    S('set', { attributeName: 'visibility', to: 'visible', begin, fill: 'freeze' }, g);
    const am = S('animateMotion', { dur: '0.7s', begin, fill: 'freeze', calcMode: 'spline', keyTimes: '0;1', keySplines: '0.4 0 0.2 1' }, g);
    S('mpath', { href: '#route-' + tr.route }, am);
  });
}

/* view = { steps, k, regs, instr, inside: { ir, dec, acc, tmp, alu }, lines: { int, nmi, halt }, key, aluInfo, decode } */
export function updateCPU(view) {
  const st = view.steps[view.k] || { blocks: [], paths: [], regs: [], pins: [], m: '—', t: 0, title: 'En attente', desc: 'Appuyez sur « T ▶ » ou F11 pour exécuter le prochain T-state.', addr: null, data: null };
  const r = view.regs;
  Object.entries(V.blk).forEach(([id, g]) => g.classList.toggle('on', st.blocks.includes(id)));
  Object.entries(V.paths).forEach(([id, p]) => p.classList.toggle('on', st.paths.includes(id)));
  Object.entries(V.regEls).forEach(([n, o]) => {
    o.v.textContent = hex(r[n], o.w > 50 ? 4 : 2);
    o.g.classList.toggle('on', st.regs.includes(n));
  });
  const asserted = new Set(st.pins);
  if (view.lines.int) asserted.add('INT');
  if (view.lines.halt) asserted.add('HALT');
  PINS.forEach(p => {
    if (p !== 'CLK') V.pins[p].classList.toggle('on', asserted.has(p));
    $(`#pinleds [data-p="${p}"]`).classList.toggle('on', p === 'CLK' || asserted.has(p));
  });
  const ins = view.inside;
  V.iff.textContent = `IFF1 = ${r.IFF1}   IFF2 = ${r.IFF2}`;
  V.imode.textContent = `Mode IM ${r.IM}${r.IM === 1 ? '  (RST &38)' : r.IM === 2 ? '  (vecteur I·n)' : ''}`;
  V.ir.textContent = ins.ir == null ? '--' : '&' + hex(ins.ir);
  V.dec.textContent = ins.dec || '';
  V.mt.textContent = st.t ? `${st.m} · T${st.t}` : '—';
  V.acc.textContent = ins.acc == null ? '--' : hex(ins.acc);
  V.tmp.textContent = ins.tmp == null ? '--' : hex(ins.tmp);
  V.alu.textContent = ins.alu || '—';
  V.f.textContent = [...Array(8)].map((_, i) => (r.F >> (7 - i)) & 1).join('');
  V.inc.textContent = st.paths.includes('p-rf-inc') ? 'calcul en cours' : 'au repos';
  V.ab.textContent = st.addr == null ? '----' : hex(st.addr, 4);
  V.db.textContent = st.data == null ? 'Z' : hex(st.data);
  V.abOut.textContent = st.addr == null ? '' : '&' + hex(st.addr, 4);
  V.dbOut.textContent = st.data == null ? 'haute imp.' : '&' + hex(st.data);

  // frise des T-states de l'instruction
  V.tl.innerHTML = '';
  const n = view.steps.length, w = Math.min(23, Math.floor(180 / Math.max(n, 1)) - 3);
  view.steps.forEach((s, j) => {
    const tb = S('g', { class: 'tbox' + (j === view.k ? ' on' : j < view.k ? ' done' : '') }, V.tl);
    S('rect', { x: 130 + j * (w + 3), y: 410, width: w, height: 30, rx: 3 }, tb);
    if (w >= 16) {
      S('text', { x: 130 + j * (w + 3) + w / 2, y: 422 }, tb, s.m);
      S('text', { x: 130 + j * (w + 3) + w / 2, y: 434 }, tb, 'T' + s.t);
    }
  });
  V.seqTxt.textContent = view.instr ? `${n} T-states · ${new Set(view.steps.map(s => s.m)).size} cycles machine` : '';
  $('#cpu-instr-txt').innerHTML = view.instr ? `Instruction : <b>${view.instr.text}</b> à &amp;${hex(view.instr.addr, 4)} · opcode ${view.instr.bytes.map(b => hex(b)).join(' ')}` : 'Aucune instruction en cours';
  $('#step-h').innerHTML = st.t ? `<span class="mt">${st.m} T${st.t}</span>${st.title}` : st.title;
  $('#step-desc').textContent = st.desc;
  $('#step-addr').textContent = st.addr == null ? '—' : '&' + hex(st.addr, 4);
  $('#step-data').textContent = st.data == null ? 'haute impédance' : '&' + hex(st.data);

  // détail : valeurs en mouvement, calcul de l'UAL, décodage
  if (view.key !== V.lastKey) { V.lastKey = view.key; drawTokens(st.transfers || []); }
  const a = view.aluInfo, dc = view.decode, aluNow = st.blocks.includes('b-alu');
  V.aluExpr.textContent = a && aluNow ? a.expr.split('  ')[0].slice(0, 18) : '';
  V.decBits.textContent = dc ? `${hex(dc.op)} = ${dc.bits} → x${dc.x} y${dc.y} z${dc.z}` : 'tables principale, CB, ED, DD/FD';
  V.busLbl.textContent = st.data != null && st.paths.some(p => p === 'p-db-bus' || p === 'p-bus-rf' || p === 'p-bus-ir') ? `bus de données interne : &${hex(st.data)}` : 'bus de données interne (8 bits)';
  $('#alu-card').innerHTML = a ? `<div class="card-h">Opération de l'UAL</div><div class="mono big${aluNow ? ' now' : ''}">${esc(a.expr)}</div><div class="kv"><span>ACC</span><b>${a.acc == null ? '—' : hex(a.acc, a.w16 ? 4 : 2)}</b></div><div class="kv"><span>TMP</span><b>${a.tmp == null ? '—' : hex(a.tmp, a.w16 ? 4 : 2)}</b></div><div class="kv"><span>résultat</span><b>${a.result == null ? '—' : hex(a.result, a.w16 ? 4 : 2)}${a.dest && a.dest !== 'mem' ? ' → ' + a.dest : a.dest === 'mem' ? ' → mémoire' : ''}</b></div><p class="mono small">${esc(a.flags)}</p>`
    : `<div class="card-h">Opération de l'UAL</div><p class="muted small">Cette instruction n'utilise pas l'UAL : elle déplace des données.</p>`;
  $('#dec-card').innerHTML = dc ? `<div class="card-h">Décodage de l'opcode</div><div class="mono big">${dc.prefix}${hex(dc.op)} = ${dc.bits}</div><div class="kv"><span>table</span><b>${esc(dc.table)}</b></div><div class="kv"><span>x · y · z</span><b>${dc.x} · ${dc.y} · ${dc.z}</b></div><div class="kv"><span>p · q</span><b>${dc.p} · ${dc.q}</b></div><p class="small">${esc(dc.role)}</p>` : '';
  $('#dec-card').hidden = !dc;
}
