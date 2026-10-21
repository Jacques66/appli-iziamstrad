import { $, $$, esc, S } from './util.js';
import { SIGS } from './analyzer.js';

/* Rendu d'une carte (voir boards.js) : circuits cliquables (inspecteur), lignes cliquables
   (ajout au chronogramme), circuits et lignes actifs au T-state courant. */

let ctx = null;   // { board, machine, onSignal, onOpen }
let selected = 'z80';

export function buildBoard(context) {
  ctx = context;
  const B = ctx.board, svg = $('#board-svg');
  svg.innerHTML = '';
  svg.setAttribute('viewBox', B.viewBox);
  $('#board-title').innerHTML = B.title;
  const wiresG = S('g', {}, svg), chipsG = S('g', {}, svg);
  const addWire = (w, d, width) => {
    const g = S('g', { class: 'wg', 'data-w': w.id }, wiresG);
    S('path', { d, class: `wire ${w.kind}`, 'stroke-width': width || w.w || 2.5 }, g);
    S('path', { d, class: 'hit' }, g);
  };
  B.wires.forEach(w => addWire(w, w.d));
  B.chips.forEach(c => {
    if (!c.bus) return;
    Object.entries(c.bus).forEach(([k, x]) => {
      const w = B.wires.find(v => v.id === { A: 'abus', D: 'dbus', C: 'cbus' }[k]);
      const y = B.buses[k], from = c.y + c.h < y ? c.y + c.h : c.y;
      addWire(w, `M${x},${from} V${y}`, 2.5);
      S('circle', { cx: x, cy: y, r: 3, class: 'junction' }, wiresG);
    });
  });
  [['A', 'A0–A15'], ['D', 'D0–D7'], ['C', 'CTRL']].forEach(([k, t]) => S('text', { x: B.busX[1] - 4, y: B.buses[k] - 4, class: 'bl', 'text-anchor': 'end' }, wiresG, t));
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
  if (!B.chips.some(c => c.id === selected)) selected = 'z80';
  selectChip(selected);
}

// écouteurs posés une seule fois (le contenu du SVG est reconstruit à chaque changement de machine)
export function initBoardEvents() {
  const svg = $('#board-svg');
  svg.addEventListener('click', e => {
    const wg = e.target.closest('.wg'), ch = e.target.closest('.chip');
    if (wg) {
      const w = ctx.board.wires.find(v => v.id === wg.dataset.w);
      $$('.wg').forEach(x => x.classList.toggle('sel', x.dataset.w === w.id));
      w.sig.slice().reverse().forEach(s => ctx.onSignal(s));
    } else if (ch) selectChip(ch.dataset.c);
  });
  svg.addEventListener('dblclick', e => { const ch = e.target.closest('.chip'); if (ch) openInside(ch.dataset.c); });
  svg.addEventListener('mousemove', e => {
    const wg = e.target.closest('.wg'), tip = $('#wire-tip');
    if (!wg) { tip.hidden = true; return; }
    const w = ctx.board.wires.find(v => v.id === wg.dataset.w), box = $('.board-svg-wrap').getBoundingClientRect();
    tip.hidden = false;
    tip.innerHTML = `${esc(w.label)}${w.sig.length ? ' <span class="muted">· clic : ajouter au chronogramme</span>' : ''}`;
    tip.style.left = (e.clientX - box.left + 14) + 'px';
    tip.style.top = (e.clientY - box.top + 12) + 'px';
  });
  svg.addEventListener('mouseleave', () => { $('#wire-tip').hidden = true; });
  $('#inspector').addEventListener('click', e => {
    const s = e.target.closest('[data-s]'), i = e.target.closest('[data-in]');
    if (s) ctx.onSignal(s.dataset.s);
    if (i) openInside(i.dataset.in);
  });
}

function openInside(id) {
  const info = ctx.board.info[id];
  if (info.cpu) ctx.onOpen('cpu');
  else if (info.ext) ctx.onOpen('machine');
  else ctx.onOpen('chip', id);
}

export function chipBlocks(id) {
  const c = ctx.board.chips.find(x => x.id === id), info = ctx.board.info[id];
  return { name: c.name, sub: c.sub, blocks: info.blocks || [['Logique interne', info.role, '']], regs: ctx.board.regs(id, ctx.machine) };
}

export function selectChip(id) {
  selected = id;
  $$('#board-svg .chip').forEach(g => g.classList.toggle('sel', g.dataset.c === id));
  const B = ctx.board, c = B.chips.find(x => x.id === id), info = B.info[id], regs = B.regs(id, ctx.machine);
  $('#inspector').innerHTML = `
    <h3>${c.name}</h3><div class="sub">${c.sub}${c.ref ? ' · ' + c.ref : ''}</div>
    <p>${info.role}</p>
    ${regs.length ? `<div class="sect">État</div><table>${regs.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>` : ''}
    ${info.sigs.length ? `<div class="sect">Signaux (clic : chronogramme)</div><div class="sigchips">${info.sigs.filter(s => SIGS[s]).map(s => `<span data-s="${s}">${SIGS[s].name}</span>`).join('')}</div>` : ''}
    <button class="tb primary" data-in="${id}">${info.cpu ? 'Ouvrir la vue intérieure du CPU →' : info.ext ? "Voir dans l'onglet Machine →" : "Voir l'intérieur du circuit →"}</button>`;
}

export function updateBoard(step) {
  const chips = new Set(), wires = new Set();
  if (step && step.t) {
    chips.add('z80');
    if (step.addr != null) wires.add('abus');
    if (step.data != null) wires.add('dbus');
    if (step.pins.some(p => ['MREQ', 'IORQ', 'RD', 'WR'].includes(p))) wires.add('cbus');
    ctx.board.activity(step, ctx.machine, chips, wires);
  }
  $$('#board-svg .chip').forEach(g => g.classList.toggle('live', chips.has(g.dataset.c)));
  $$('#board-svg .wg').forEach(g => g.classList.toggle('live', wires.has(g.dataset.w)));
  if ($('#inspector').offsetParent) selectChip(selected);
}
