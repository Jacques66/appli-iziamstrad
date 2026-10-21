import { $, hex, S, cssVar } from './util.js';

/* Analyseur logique : reconstruit les signaux du bus à partir des cycles machine réels.
   1 unité = 1/8 de T-state (31,25 ns à 4 MHz) ; un demi-T = 4 unités. */

export const SIGS = {
  CLK: { name: 'CLK', kind: 'bit', c: '--clk' },
  M1: { name: '/M1', kind: 'bit', c: '--ctrl' }, MREQ: { name: '/MREQ', kind: 'bit', c: '--ctrl' }, IORQ: { name: '/IORQ', kind: 'bit', c: '--ctrl' },
  RD: { name: '/RD', kind: 'bit', c: '--ctrl' }, WR: { name: '/WR', kind: 'bit', c: '--ctrl' }, RFSH: { name: '/RFSH', kind: 'bit', c: '--ctrl' },
  INT: { name: '/INT', kind: 'bit', c: '--ctrl' }, RESET: { name: '/RESET', kind: 'bit', c: '--ctrl' }, WAIT: { name: '/WAIT', kind: 'bit', c: '--ctrl' },
  HALT: { name: '/HALT', kind: 'bit', c: '--ctrl' },
  A: { name: 'A[15:0]', kind: 'bus', c: '--addr', n: 4 }, D: { name: 'D[7:0]', kind: 'bus', c: '--data', n: 2 },
  CSROM: { name: '/CS EPROM', kind: 'bit', c: '--ctrl' }, CSRAM: { name: '/CS SRAM', kind: 'bit', c: '--ctrl' },
  CSOUT: { name: 'CLK port 00', kind: 'bit', c: '--ctrl' }, CSIN: { name: '/OE port 01', kind: 'bit', c: '--ctrl' },
  LED: { name: 'LED[7:0]', kind: 'bus', c: '--data', n: 2 }, SW: { name: 'SW[7:0]', kind: 'bus', c: '--data', n: 2 },
  HSYNC: { name: 'HSYNC', kind: 'bit', c: '--video' }, VSYNC: { name: 'VSYNC', kind: 'bit', c: '--video' },
};

// Signaux élémentaires d'un cycle, demi-T par demi-T
function cycleHalves(c) {
  const out = [];
  const nT = c.t;
  for (let h = 0; h < nT * 2; h++) {
    const s = { M1: 1, MREQ: 1, IORQ: 1, RD: 1, WR: 1, RFSH: 1, A: c.addr ?? null, D: null };
    switch (c.type) {
      case 'M1':
        if (h >= 1 && h <= 4) s.M1 = 0;
        if (h >= 1 && h <= 3) { s.MREQ = 0; s.RD = 0; }
        if (h >= 5 && h <= 6) s.MREQ = 0;
        if (h >= 4) { s.RFSH = 0; s.A = c.refresh; }
        if (h === 2 || h === 3) s.D = c.data;
        break;
      case 'MR':
        if (h >= 1 && h <= 4) { s.MREQ = 0; s.RD = 0; }
        if (h === 3 || h === 4) s.D = c.data;
        break;
      case 'MW':
        if (h >= 1 && h <= 4) s.MREQ = 0;
        if (h === 3 || h === 4) s.WR = 0;
        if (h >= 1 && h <= 5) s.D = c.data;
        break;
      case 'IOR':
        if (h >= 2 && h <= 6) { s.IORQ = 0; s.RD = 0; }
        if (h >= 5 && h <= 6) s.D = c.data;
        break;
      case 'IOW':
        if (h >= 2 && h <= 6) { s.IORQ = 0; s.WR = 0; }
        if (h >= 1 && h <= 7) s.D = c.data;
        break;
      case 'INTA':
        if (h >= 1 && h < nT * 2 - 4) s.M1 = 0;
        if (h >= 5 && h < nT * 2 - 4) { s.IORQ = 0; s.D = c.data; }
        if (h >= nT * 2 - 4) { s.RFSH = 0; s.A = c.refresh; if (h >= nT * 2 - 3 && h <= nT * 2 - 2) s.MREQ = 0; }
        break;
      case 'X':
        s.A = c.addr ?? null;
        break;
    }
    out.push(s);
  }
  return out;
}

/* cycles : liste de { type, addr, data, t, refresh, label?, leds } (X compris, avec addr hérité)
   ctx : { leds0, switches, intLine, halted } */
export function buildTrace(cycles, ctx) {
  const T = {}; Object.keys(SIGS).forEach(k => { T[k] = []; });
  const marks = [];
  let u = 0, leds = ctx.leds0, lastAddr = null;
  for (const c of cycles) {
    if (c.label) marks.push({ u, lbl: c.label, kind: c.type });
    const cc = c.type === 'X' ? { ...c, addr: lastAddr } : c;
    const halves = cycleHalves(cc);
    halves.forEach((s, h) => {
      if (c.type === 'IOW' && !(c.addr & 1) && h === 6) leds = c.data;
      for (let q = 0; q < 4; q++, u++) {
        T.CLK.push(u % 8 < 4 ? 1 : 0);
        T.M1.push(s.M1); T.MREQ.push(s.MREQ); T.IORQ.push(s.IORQ); T.RD.push(s.RD); T.WR.push(s.WR); T.RFSH.push(s.RFSH);
        T.A.push(s.A); T.D.push(s.D);
        T.INT.push(c.int ? 0 : 1); T.RESET.push(1); T.WAIT.push(c.wait ? 0 : 1); T.HALT.push(c.halted ? 0 : 1);
        T.HSYNC.push(c.hs ? 1 : 0); T.VSYNC.push(c.vs ? 1 : 0);
        const memSel = s.MREQ === 0 && s.RFSH === 1;
        T.CSROM.push(memSel && s.A != null && s.A < 0x2000 ? 0 : 1);
        T.CSRAM.push(memSel && s.A != null && s.A >= 0x8000 && s.A < 0xA000 ? 0 : 1);
        T.CSOUT.push(s.IORQ === 0 && s.WR === 0 && !(s.A & 1) ? 1 : 0);
        T.CSIN.push(s.IORQ === 0 && s.RD === 0 && (s.A & 1) ? 0 : 1);
        T.LED.push(leds); T.SW.push(ctx.switches);
      }
    });
    if (c.type !== 'X') lastAddr = c.type === 'M1' || c.type === 'INTA' ? c.refresh : c.addr;
  }
  return { T, N: u, marks };
}

export const LA = { sigs: ['CLK', 'M1', 'MREQ', 'RD', 'WR', 'IORQ', 'RFSH', 'A', 'D'], zoom: 3, cursor: null, fresh: null, follow: true };

export function addSignal(s, trace) {
  if (!SIGS[s]) return;
  LA.sigs = [s, ...LA.sigs.filter(x => x !== s)];
  LA.fresh = s;
  renderLA(trace);
}

export function renderLA(trace) {
  const { T, N, marks } = trace, px = LA.zoom, RH = 24, TOP = 22;
  const W = Math.max(N * px + 40, 200), H = TOP + RH * LA.sigs.length;
  const svg = $('#la-svg');
  svg.setAttribute('width', W); svg.setAttribute('height', H);
  svg.innerHTML = '';
  for (let t = 0; t * 8 <= N; t++) {
    const x = t * 8 * px;
    S('line', { x1: x, y1: TOP - 4, x2: x, y2: H, stroke: '#ffffff10' }, svg);
    if (px >= 2 || t % 2 === 0) S('text', { x: x + 2, y: 10, fill: '#56616f', 'font-size': 9, 'font-family': 'JetBrains Mono' }, svg, String(t + 1));
  }
  marks.forEach(m => {
    const x = m.u * px;
    S('line', { x1: x, y1: 0, x2: x, y2: H, stroke: '#ffd54f40', 'stroke-dasharray': '2 3' }, svg);
    S('text', { x: x + 3, y: 20, fill: '#ffd54f', 'font-size': 10, 'font-family': 'JetBrains Mono', 'font-weight': 600 }, svg, m.lbl);
  });
  LA.sigs.forEach((s, row) => {
    const def = SIGS[s], arr = T[s], col = cssVar(def.c), y0 = TOP + row * RH, hi = y0 + 5, lo = y0 + RH - 5, mid = (hi + lo) / 2;
    if (!N) return;
    if (def.kind === 'bit') {
      let d = `M0,${arr[0] ? hi : lo}`;
      for (let u = 1; u < N; u++) if (arr[u] !== arr[u - 1]) d += ` H${u * px} V${arr[u] ? hi : lo}`;
      d += ` H${N * px}`;
      S('path', { d, fill: 'none', stroke: col, 'stroke-width': 1.6 }, svg);
    } else {
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
    }
  });
  const cur = LA.cursor == null ? N - 1 : Math.min(LA.cursor, N - 1);
  if (N) {
    S('line', { x1: cur * px, y1: 0, x2: cur * px, y2: H, stroke: '#fff', 'stroke-opacity': .8 }, svg);
    $('#la-cur').innerHTML = `Curseur : <b>T${Math.floor(cur / 8) + 1}</b> · <b>${(cur * 31.25).toLocaleString('fr-FR')} ns</b>`;
  }
  $('#la-names').innerHTML = `<div class="ruler">signal<span class="v">valeur</span></div>` + LA.sigs.map(s => {
    const def = SIGS[s], v = N ? T[s][cur] : null;
    const vs = v == null ? 'Z' : def.kind === 'bit' ? v : hex(v, def.n);
    return `<div class="${LA.fresh === s ? 'new' : ''}"><i style="background:var(${def.c})"></i>${def.name}<span class="v">${vs}</span><span class="x" data-x="${s}" title="Retirer">×</span></div>`;
  }).join('');
  LA.fresh = null;
  if (LA.follow && LA.cursor == null) { const w = $('#la-wave'); w.scrollLeft = w.scrollWidth; }
}
