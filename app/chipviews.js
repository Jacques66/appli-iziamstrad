import { hex, esc } from './util.js';
import { HW_RGB, hwToFirmware } from '../src/machines/cpc/gatearray.js';
import { KEYS } from '../src/machines/cpc/keyboard.js';
import { VOLUME } from '../src/machines/cpc/psg.js';

/* Detailed chip views: internal diagram (blocks + arrows) and the real machine state,
   regenerated on every refresh (about 8 times per second, and at every single step).
   Pure reads only: no state-changing method is called.
   ctx.step: current T-state of the CPU view while single-stepping, or null. */

/* ---------------------------------------------------------------------
   Formatting helpers
   --------------------------------------------------------------------- */
const h2 = v => '&amp;' + hex(v);
const h4 = v => '&amp;' + hex(v, 4);
const h5 = v => '&amp;' + hex(v, 5);
const bin = (v, n = 8) => (v >>> 0).toString(2).padStart(n, '0');
const num = (v, d = 0) => Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const hz = f => f >= 1e6 ? num(f / 1e6, 3) + ' MHz' : f >= 1e3 ? num(f / 1e3, 2) + ' kHz' : num(f, f < 10 ? 2 : 1) + ' Hz';
const rgb = hw => `rgb(${HW_RGB[hw & 31].join(',')})`;
const POP = Uint8Array.from({ length: 256 }, (_, v) => { let n = 0; for (; v; v >>= 1) n += v & 1; return n; });

const sec = (title, body, cls = '') => `<section class="cv-sec${cls ? ' ' + cls : ''}"><h4>${title}</h4>${body}</section>`;
const cols = (...parts) => `<div class="cv-cols">${parts.join('')}</div>`;
const stack = (...parts) => `<div class="cv-stack">${parts.join('')}</div>`;
const note = t => `<p class="cv-note">${t}</p>`;
const live = t => `<div class="cv-live"><b>Active</b> ${t}</div>`;
const kv = rows => `<table class="cv-kv">${rows.map(([k, v, hot]) => `<tr${hot ? ' class="cv-hot"' : ''}><td>${k}</td><td>${v}</td></tr>`).join('')}</table>`;
const pin = (name, on, title = '') => `<span class="cv-pin${on ? ' cv-on' : ''}"${title ? ` title="${esc(title)}"` : ''}>${name}</span>`;
const pins = list => `<div class="cv-pins">${list.map(([n, on, t]) => pin(n, on, t)).join('')}</div>`;
const bar = (v, max, label = '', cls = '') => `<div class="cv-bar${cls ? ' ' + cls : ''}"><i style="width:${Math.max(0, Math.min(100, 100 * v / (max || 1))).toFixed(1)}%"></i><span>${label}</span></div>`;

// diagram block: { n: name, d: role, v: value, hot: active }; a string between two blocks = arrow (label)
const B = (n, d, v, hot) => ({ n, d, v, hot });
function flow(items) {
  return `<div class="cv-flow">${items.map(it => typeof it === 'string'
    ? `<div class="cv-arr"><span>${it}</span></div>`
    : `<div class="cv-blk${it.hot ? ' cv-hot' : ''}"><b>${it.n}</b>${it.d ? `<span>${it.d}</span>` : ''}${it.v != null && it.v !== '' ? `<code>${it.v}</code>` : ''}</div>`).join('')}</div>`;
}

// row of bits (MSB on the left); dir: 'in' | 'out' or a per-bit array; v null = high impedance
function bits(v, labels, { n = 8, dir = null, hot = null, title = null } = {}) {
  let s = '<div class="cv-bits">';
  for (let i = n - 1; i >= 0; i--) {
    const on = v != null && (v >> i) & 1, d = Array.isArray(dir) ? dir[i] : dir;
    s += `<div class="cv-bit${on ? ' cv-1' : ''}${v == null ? ' cv-z' : ''}${hot && hot.includes(i) ? ' cv-hot' : ''}"${title?.[i] ? ` title="${esc(title[i])}"` : ''}>`
      + `<b>${v == null ? 'Z' : on ? 1 : 0}</b><span>${labels ? labels[i] ?? '' : 'b' + i}</span>${d ? `<i>${d === 'in' ? 'I' : 'O'}</i>` : ''}</div>`;
  }
  return s + '</div>';
}

// hex dump, 16 bytes per line, around "focus"
function hexdump(read, focus, { lo = 0, hi = 0xFFFF, lines = 6, label = h4, mark = null } = {}) {
  const size = hi - lo + 1, span = lines * 16;
  let start = Math.max(lo, (focus & ~0xF) - 32);
  if (start + span > hi + 1) start = Math.max(lo, hi + 1 - span);
  let s = '<pre class="cv-hex">';
  for (let l = 0; l < lines && l * 16 < size; l++) {
    const a0 = start + l * 16;
    let hx = '', as = '';
    for (let i = 0; i < 16; i++) {
      const a = a0 + i;
      if (a > hi) { hx += '   '; continue; }
      const v = read(a), cls = a === focus ? (mark || 'cv-hx-on') : '';
      hx += (cls ? `<span class="${cls}">${hex(v)}</span>` : hex(v)) + ' ';
      as += v >= 0x20 && v < 0x7F ? esc(String.fromCharCode(v)) : '·';
    }
    s += `<span class="cv-hx-a">${label(a0)}</span>  ${hx} ${as}\n`;
  }
  return s + '</pre>';
}

// bus access of the current T-state: { mem, io, rd, wr, addr, data, pins }
function busOf(step) {
  if (!step || step.addr == null) return null;
  const p = step.pins || [], t = step.mtype;
  if (p.includes('RFSH')) return null;
  const mem = t === 'M1' || t === 'MR' || t === 'MW', io = t === 'IOR' || t === 'IOW';
  if (!mem && !io) return null;
  return { mem, io, rd: t === 'M1' || t === 'MR' || t === 'IOR', wr: t === 'MW' || t === 'IOW', addr: step.addr & 0xFFFF, data: step.data ?? null, pins: p, m1: t === 'M1' };
}
const dataTxt = b => b.data == null ? '--' : h2(b.data);
const accTxt = b => `${b.m1 ? 'opcode fetch' : b.rd ? 'read' : 'write'} ${h4(b.addr)}${b.data != null ? (b.rd ? ' → ' : ' ← ') + h2(b.data) : ''}`;

/* ---------------------------------------------------------------------
   Amstrad CPC 6128
   --------------------------------------------------------------------- */
const RAM_CONFIG = [[0, 1, 2, 3], [0, 1, 2, 7], [4, 5, 6, 7], [0, 3, 2, 7], [0, 4, 2, 3], [0, 5, 2, 3], [0, 6, 2, 3], [0, 7, 2, 3]];
const RAM_USE = ['normal configuration (base 64 KB)', 'bank 7 at &C000 (CP/M Plus)', 'whole 64 KB expansion (CP/M Plus)', 'CP/M Plus: bank 3 at &4000, 7 at &C000',
  'bank 4 at &4000', 'bank 5 at &4000', 'bank 6 at &4000', 'bank 7 at &4000'];
const MODES = ['160 × 200, 16 colors, 2 pixels per byte', '320 × 200, 4 colors, 4 pixels per byte', '640 × 200, 2 colors, 8 pixels per byte', 'undocumented mode 3 (160 × 200, 4 colors)'];
const gaPort = b => b && b.io && (b.addr & 0xC000) === 0x4000;
const isPPI = b => b && b.io && !(b.addr & 0x0800);
const isCRTC = b => b && b.io && !(b.addr & 0x4000);
const isFDC = b => b && b.io && !(b.addr & 0x0480);
const isPRN = b => b && b.io && b.wr && !(b.addr & 0x1000);
const isROMSEL = b => b && b.io && b.wr && !(b.addr & 0x2000);
const romChip = (m, a) => m.chipAt(a);

// meaning of a Gate Array write (port &7Fxx)
function gaFunction(m, v) {
  switch (v >> 6) {
    case 0: return v & 0x10 ? 'function 0: select pen 16 (border)' : `function 0: select pen ${v & 15}`;
    case 1: return `function 1: hardware color ${v & 31} (firmware ${hwToFirmware(v)}) for pen ${m.ga.pen}`;
    case 2: return `function 2: mode ${v & 3}, lower ROM ${v & 4 ? 'hidden' : 'visible'}, upper ROM ${v & 8 ? 'hidden' : 'visible'}${v & 16 ? ', interrupt counter reset' : ''}`;
    default: return `function 3: RAM configuration C${v & 7} (handled by the PAL)`;
  }
}

// for each pixel of the byte: bit numbers, from the ink's least to most significant bit
function pixelBits(mode) {
  if (mode === 2) return [...Array(8)].map((_, p) => [7 - p]);
  if (mode === 1) return [...Array(4)].map((_, q) => [7 - q, 3 - q]);
  return [[7, 3, 5, 1], [6, 2, 4, 0]];
}
const inkOf = (byte, list) => list.reduce((s, bit, k) => s | (((byte >> bit) & 1) << k), 0);

function clockWaves(hot) {
  const W = 330, x0 = 70;
  const sq = (y, per) => { let d = `M${x0},${y + 14}`; for (let x = 0; x < W - 1; x += per) d += ` V${y} H${x0 + x + per / 2} V${y + 14} H${x0 + x + per}`; return d; };
  const rows = [['16 MHz', 'crystal', W / 16], ['4 MHz', 'Z80', W / 4], ['1 MHz', 'CRTC, PSG', W]];
  return `<svg class="cv-svg" viewBox="0 0 410 96" width="410" height="96">${rows.map(([f, who, per], i) => {
    const y = 6 + i * 30;
    return `<text x="0" y="${y + 11}" class="cv-t">${f}</text><text x="0" y="${y + 22}" class="cv-t cv-tm">${who}</text><path d="${sq(y, per)}" class="cv-wave${hot && i === 1 ? ' cv-hotw' : ''}"/>`;
  }).join('')}<text x="${x0}" y="95" class="cv-t cv-tm">1 µs = 16 ticks = 4 T-states = 1 character</text></svg>`;
}

function viewGA(m, step, b) {
  const ga = m.ga, c = m.crtc, used = [16, 4, 2, 4][ga.mode & 3];
  const wr = gaPort(b) && b.wr, wait = !!step?.pins?.includes('WAIT');
  const a = c.videoAddress, b0 = m.ram[a], b1 = m.ram[(a + 1) & 0xFFFF], map = pixelBits(ga.mode & 3);
  const pxOfBit = {};
  map.forEach((list, p) => list.forEach((bit, k) => { pxOfBit[bit] = [p, k]; }));
  const decodeBits = `<div class="cv-bits">${[7, 6, 5, 4, 3, 2, 1, 0].map(i => {
    const [p, k] = pxOfBit[i], on = (b0 >> i) & 1;
    return `<div class="cv-bit cv-px${p}${on ? ' cv-1' : ''}"><b>${on}</b><span>b${i} → p${p}·${1 << k}</span></div>`;
  }).join('')}</div>`;
  const strip = [b0, b1].map(byte => map.map(list => { const ink = inkOf(byte, list); return `<div class="cv-pxc" style="flex:${8 / map.length};background:${rgb(ga.inks[ink])}"><span>${ink}</span></div>`; }).join('')).join('');
  const inks = [...Array(17)].map((_, i) => {
    const hw = ga.inks[i];
    return `<div class="cv-ink${i === ga.pen ? ' cv-sel' : ''}${i < 16 && i >= used ? ' cv-dim' : ''}"><i style="background:${rgb(hw)}"></i><b>${i === 16 ? 'Bdr' : i}</b><span>H ${hw}</span><span>F ${hwToFirmware(hw)}</span></div>`;
  }).join('');
  return `${wr ? live(`OUT ${h4(b.addr)}, ${dataTxt(b)} — ${b.data != null ? gaFunction(m, b.data) : 'write to the Gate Array'}`) : ''}
    ${wait ? live('/WAIT: the Gate Array holds the Z80 back so the video can use the RAM (instruction aligned on 4 T-states).') : ''}
    ${flow([B('Crystal', '16 MHz', '', false), '÷4 ÷16', B('Clock divider', 'Z80 4 MHz, CRTC and PSG 1 MHz', '4 / 1 MHz', false), '', B('RAM arbitration', 'video reads 2 bytes per µs, the Z80 waits (/WAIT)', wait ? '/WAIT active' : 'free', wait),
      'MA/RA', B('Serializer', `byte → ${map.length} pixels (mode ${ga.mode})`, h2(b0), c.displayEnabled), 'ink no.', B('Palette', '17 inks → 27 colors', `pen ${ga.pen}`, wr && b.data != null && b.data >> 6 < 2), 'RGB', B('Monitor', 'R, G, B on 3 levels', 'border ' + ga.inks[16], false)])}
    ${cols(sec('Clock divider', clockWaves(true) + note('The 16 MHz crystal is divided by 4 for the Z80 and by 16 for the CRTC (one character per µs) and the PSG.')),
      sec('Screen mode', kv([['Active mode', `${ga.mode} — ${MODES[ga.mode & 3]}`, true], ['Pending mode', ga.pendingMode !== ga.mode ? `${ga.pendingMode} (applied at the end of the next HSYNC)` : `${ga.pendingMode} (same)`],
        ['Beam position', `${ga.beamX} µs after HSYNC, line ${ga.beamY} after VSYNC`], ['Display', c.displayEnabled ? 'display area (DISPEN = 1)' : c.hsync || c.vsync ? 'sync (black)' : 'border']])))}
    ${sec(`Palette — 17 inks <span class="cv-m">(H: hardware color, F: INK firmware number; inks used in mode ${ga.mode}: ${used} + border)</span>`, `<div class="cv-inks">${inks}</div>`)}
    ${sec(`Current video byte decoding <span class="cv-m">(RAM ${h4(a)} and ${h4((a + 1) & 0xFFFF)}, address supplied by the CRTC)</span>`,
      `<div class="cv-dec"><div><div class="cv-lbl">Byte ${h2(b0)} = %${bin(b0)}: each bit goes to one pixel (p) with a weight</div>${decodeBits}</div>
       <div><div class="cv-lbl">Pixels output during this µs (bytes ${h2(b0)} ${h2(b1)}): ink number → color</div><div class="cv-strip">${strip}</div></div></div>`
      + note(c.displayEnabled ? 'The beam is in the display area: these pixels go to the monitor.' : 'Beam outside the display area: the byte is read but the output shows the border or the sync black.'))}
    ${cols(sec('Interrupt counter', bar(ga.intCounter, 52, `${ga.intCounter} / 52 lines`, ga.intRequest ? 'cv-warm' : '')
      + pins([['/INT', ga.intRequest, 'interrupt request to the Z80'], ['VSYNC', c.vsync], ['HSYNC', c.hsync]])
      + kv([['Pending request', ga.intRequest ? 'yes: /INT = 0 until acknowledged' : 'no (/INT = 1)', ga.intRequest], ['VSYNC resync', ga.vsyncDelay ? `in ${ga.vsyncDelay} line(s)` : '—']])
      + note('The counter advances at the end of each HSYNC (64 µs). At 52 it wraps to 0 and raises /INT: 6 interrupts per frame, 300 Hz. VSYNC realigns it 2 lines after its start.')),
      sec('ROM and RAM selection', kv([['Lower ROM (&0000–&3FFF)', ga.lowerRom ? 'visible for reads (OS)' : 'hidden (RAM)', ga.lowerRom], ['Upper ROM (&C000–&FFFF)', ga.upperRom ? `visible: ROM ${m.romSelect} (${m.romSelect === 7 ? 'AMSDOS' : 'BASIC'})` : 'hidden (RAM)', ga.upperRom],
        ['RAM configuration', `C${ga.ramConfig & 7} — banks ${m.bank.map(x => x >> 14).join(' ')}`], ['Selected pen', ga.pen === 16 ? '16 (border)' : ga.pen]])
        + note('Writes always go to RAM; only reads see the ROMs.')))}`;
}

const CRTC_REGS = [
  ['Horizontal total', 'characters per line − 1'], ['Horizontal displayed', 'visible characters per line'], ['H sync position', 'character where HSYNC starts'],
  ['Sync widths', 'bits 0–3 HSYNC, bits 4–7 VSYNC'], ['Vertical total', 'rows per frame − 1'], ['Vertical adjust', 'extra raster lines'],
  ['Vertical displayed', 'visible rows'], ['V sync position', 'row where VSYNC starts'], ['Interlace', 'interlace mode and skew'],
  ['Lines per row', 'raster lines per row − 1'], ['Cursor start', 'not wired on the CPC'], ['Cursor end', 'not wired on the CPC'],
  ['Start (high)', 'bits 4–5: 16 KB video page'], ['Start (low)', 'offset in 2-byte words'], ['Cursor (high)', 'cursor position'],
  ['Cursor (low)', 'cursor position'], ['Light pen (high)', 'read only'], ['Light pen (low)', 'read only'],
];

function frameDiagram(c) {
  const R = c.regs, ht = R[0] + 1, lpr = (R[9] & 31) + 1, vt = (R[4] & 127) + 1, total = vt * lpr + (R[5] & 31);
  const W = 470, H = 250, X = 40, Y = 18, sx = W / ht, sy = H / total;
  const hw = R[3] & 15, vw = (R[3] >> 4) || 16;
  const line = c.adjust ? vt * lpr + (c.adjustCount || 0) : c.vcc * lpr + c.vlc;
  const bx = X + Math.min(c.hcc, ht) * sx, by = Y + Math.min(line, total) * sy;
  return `<svg class="cv-svg" viewBox="0 0 ${X + W + 120} ${Y + H + 34}" width="${X + W + 120}" height="${Y + H + 34}">
    <rect x="${X}" y="${Y}" width="${W}" height="${H}" class="cv-fr-tot"/>
    <rect x="${X}" y="${Y}" width="${Math.min(R[1], ht) * sx}" height="${Math.min(R[6] * lpr, total) * sy}" class="cv-fr-disp"/>
    ${hw ? `<rect x="${X + R[2] * sx}" y="${Y}" width="${hw * sx}" height="${H}" class="cv-fr-sync"/>` : ''}
    <rect x="${X}" y="${Y + Math.min(R[7] * lpr, total) * sy}" width="${W}" height="${Math.min(vw, total) * sy}" class="cv-fr-sync"/>
    <text x="${X}" y="${Y - 5}" class="cv-t">R0+1 = ${ht} characters (${ht} µs per line)</text>
    <text x="${X + 4}" y="${Y + 14}" class="cv-t cv-tv">display area R1 × R6 = ${R[1]} × ${R[6]} characters</text>
    ${hw ? `<text x="${X + R[2] * sx + 2}" y="${Y + H - 4}" class="cv-t cv-tc">HSYNC R2=${R[2]}</text>` : ''}
    <text x="${X + W - 4}" y="${Y + Math.min(R[7] * lpr, total) * sy - 3}" class="cv-t cv-tc" text-anchor="end">VSYNC R7=${R[7]}</text>
    <text x="${X + W + 6}" y="${Y + 12}" class="cv-t">${vt} rows</text><text x="${X + W + 6}" y="${Y + 26}" class="cv-t">× ${lpr} lines</text>
    <text x="${X + W + 6}" y="${Y + 40}" class="cv-t">+ ${R[5] & 31} (R5)</text><text x="${X + W + 6}" y="${Y + 54}" class="cv-t">= ${total} lines</text>
    <text x="${X + W + 6}" y="${Y + 72}" class="cv-t cv-tm">${num(1e6 / (ht * total), 2)} Hz</text>
    <line x1="${bx}" y1="${Y}" x2="${bx}" y2="${Y + H}" class="cv-beam-l"/><line x1="${X}" y1="${by}" x2="${X + W}" y2="${by}" class="cv-beam-l"/>
    <circle cx="${bx}" cy="${by}" r="5" class="cv-beam"/>
    <text x="${X}" y="${Y + H + 16}" class="cv-t">Beam: character ${c.hcc}, row ${c.vcc}, line ${c.vlc}${c.adjust ? ' (R5 adjust)' : ''}</text>
  </svg>`;
}

function viewCRTC(m, step, b) {
  const c = m.crtc, R = c.regs, ma = c.ma;
  let msg = '', hotReg = -1;
  if (isCRTC(b)) {
    const f = (b.addr >> 8) & 3;
    if (f === 0 && b.wr) { hotReg = b.data != null ? b.data & 31 : -1; msg = `OUT ${h4(b.addr)}, ${dataTxt(b)} — select register R${hotReg >= 0 ? hotReg : '?'}`; }
    else if (f === 1 && b.wr) { hotReg = c.selected; msg = `OUT ${h4(b.addr)}, ${dataTxt(b)} — write to R${c.selected} (${CRTC_REGS[c.selected]?.[0] ?? 'nonexistent'})`; }
    else if (f === 3 && b.rd) { hotReg = c.selected; msg = `IN ${h4(b.addr)} — read R${c.selected} (type 0: only R14–R17 are readable)`; }
    else msg = `${b.rd ? 'IN' : 'OUT'} ${h4(b.addr)} — function ${f} has no effect on type 0`;
  }
  const page = (ma & 0x3000) << 2, ra = (c.vlc & 7) << 11, off = (ma & 0x3FF) << 1;
  const table = `<table class="cv-tab"><tr><th>Reg.</th><th>Name</th><th>Role</th><th>Value</th></tr>${CRTC_REGS.map(([n, d], i) =>
    `<tr class="${i === c.selected ? 'cv-sel' : ''}${i === hotReg ? ' cv-hot' : ''}"><td>R${i}</td><td>${n}</td><td class="cv-m">${d}</td><td class="cv-v">${R[i]} <span class="cv-m">${h2(R[i])}</span></td></tr>`).join('')}</table>`;
  return `${msg ? live(msg) : ''}
    ${flow([B('Horizontal counter', 'HCC counts characters, wraps to 0 after R0', c.hcc, c.displayEnabled), '', B('Raster lines', 'VLC (RA) counts the lines of the row up to R9', c.vlc), '', B('Row counter', 'VCC counts rows up to R4', c.vcc), '',
      B('MA generator', 'MA = row start + HCC', h4(ma)), 'MA/RA', B('Gate Array', '2-byte RAM address', h4(c.videoAddress), c.displayEnabled)])}
    ${sec('Frame and beam <span class="cv-m">(scale: 1 character wide, 1 raster line high)</span>', frameDiagram(c))}
    ${cols(sec('Registers R0–R17 <span class="cv-m">(selected: R' + c.selected + ')</span>', table),
      sec('Counters and video address', pins([['HSYNC', c.hsync, 'horizontal sync'], ['VSYNC', c.vsync, 'vertical sync'], ['DISPEN', c.displayEnabled, 'display area']])
        + kv([['HCC (character)', `${c.hcc} / ${R[0]}`], ['VLC (raster line RA)', `${c.vlc} / ${R[9]}`], ['VCC (row)', `${c.vcc} / ${R[4]}`], ['MA at row start', h4(c.rowStart)], ['Current MA', h4(ma)], ['Frames', num(c.frame)]])
        + `<div class="cv-formula">address = MA13–12 × &amp;4000 + RA × &amp;800 + MA9–0 × 2<br>= ${h4(page)} + ${c.vlc & 7} × &amp;800 (${h4(ra)}) + ${ma & 0x3FF} × 2 (${h4(off)}) = <b>${h4(c.videoAddress)}</b></div>`))}`;
}

const PB_LBL = ['VSYNC', 'Vendor 0', 'Vendor 1', 'Vendor 2', '50 Hz', '/EXP', 'BUSY', 'Tape in'];
const PC_LBL = ['Row 0', 'Row 1', 'Row 2', 'Row 3', 'Tape motor', 'Tape out', 'BC1', 'BDIR'];
const PSG_FN = ['inactive', 'read register', 'write register', 'select register'];

function viewPPI(m, step, b) {
  const p = m.ppi, ctl = p.control, aIn = !!(ctl & 0x10), cuIn = !!(ctl & 0x08), bIn = !!(ctl & 0x02), clIn = !!(ctl & 0x01);
  const fn = (p.c >> 6) & 3, bVal = 0x3E | (m.crtc.vsync ? 1 : 0);
  const aVal = aIn ? (fn === 1 ? m.psg.readRegister(m.psg.selected) : 0xFF) : p.a;
  const io = inp => inp ? 'input' : 'output';
  let msg = '', hot = -1;
  if (isPPI(b)) {
    const f = (b.addr >> 8) & 3;
    hot = f;
    const name = ['port A', 'port B', 'port C', 'control register'][f];
    if (f === 3 && b.wr && b.data != null && !(b.data & 0x80)) msg = `OUT ${h4(b.addr)}, ${h2(b.data)} — port C bit ${(b.data >> 1) & 7} set to ${b.data & 1}`;
    else msg = `${b.rd ? 'IN' : 'OUT'} ${h4(b.addr)}${b.data != null ? (b.rd ? ' → ' : ', ') + h2(b.data) : ''} — ${b.rd ? 'read' : 'write'} ${name}`;
  }
  const port = (i, title, v, labels, dir, extra) => `<div class="cv-port${hot === i ? ' cv-hot' : ''}"><div class="cv-lbl">${title} = ${h2(v)}</div>${bits(v, labels, { dir })}${extra || ''}</div>`;
  return `${msg ? live(msg) : ''}
    ${flow([B('Z80 bus', 'D0–D7, /IORQ, A11 = 0 selects the PPI', 'ports &F4xx–&F7xx', hot >= 0), 'A8 A9', B('Read/write logic', 'A8–A9 select A, B, C or control', ['A', 'B', 'C', 'control'][hot] ?? '—', hot >= 0), '',
      B('Port A', 'PSG data', io(aIn), hot === 0), B('Port B', 'VSYNC, links, BUSY', 'input', hot === 1), B('Port C', 'keyboard row, cassette, PSG control', 'output', hot === 2)])}
    ${sec(`Control word ${h2(ctl)} = %${bin(ctl)}`, kv([['Group A', `mode ${(ctl >> 5) & 3}, port A ${io(aIn)}, PC4–PC7 ${io(cuIn)}`], ['Group B', `mode ${(ctl >> 2) & 1}, port B ${io(bIn)}, PC0–PC3 ${io(clIn)}`]]) + note('I: input, O: output. A write to &F7xx with bit 7 = 0 sets or clears a single bit of port C.'))}
    ${port(0, 'Port A (&amp;F4xx) — PSG data bus', aVal, ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7'], aIn ? 'in' : 'out', note(aIn ? `Input: the PPI reads the PSG (${fn === 1 ? `register R${m.psg.selected}` : 'PSG inactive, &FF'}).` : 'Output: value sent to the PSG (register number or contents).'))}
    ${port(1, 'Port B (&amp;F5xx)', bVal, PB_LBL, bIn ? 'in' : 'out', kv([['VSYNC (bit 0)', m.crtc.vsync ? '1: vertical sync in progress' : '0'], ['Vendor (bits 1–3)', `${(bVal >> 1) & 7}: Amstrad`], ['Refresh rate (bit 4)', bVal & 0x10 ? '1: 50 Hz' : '0: 60 Hz'], ['/EXP (bit 5)', bVal & 0x20 ? '1: no expansion' : '0: expansion'], ['BUSY (bit 6)', bVal & 0x40 ? '1: printer busy' : '0: printer ready'], ['Cassette (bit 7)', 'tape read: ' + (bVal >> 7)]]))}
    ${port(2, 'Port C (&amp;F6xx)', p.c, PC_LBL, [0, 1, 2, 3].map(() => clIn ? 'in' : 'out').concat([0, 1, 2, 3].map(() => cuIn ? 'in' : 'out')),
      kv([['Keyboard row (bits 0–3)', `${p.c & 15}${(p.c & 15) > 9 ? ' (no row)' : ''} → 74LS145`], ['Cassette motor (bit 4)', p.c & 0x10 ? 'on' : 'off'], ['Cassette write (bit 5)', (p.c >> 5) & 1], ['PSG function (BDIR, BC1)', `${(p.c >> 7) & 1}${(p.c >> 6) & 1}: ${PSG_FN[fn]}`, fn !== 0]]))}`;
}

const NOTES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
function noteOf(f) {
  if (!(f >= 16 && f <= 20000)) return f > 20000 ? 'inaudible (ultrasound)' : 'too low';
  const n = 69 + 12 * Math.log2(f / 440), r = Math.round(n), ct = Math.round((n - r) * 100);
  return `${NOTES[((r % 12) + 12) % 12]}${Math.floor(r / 12) - 1}${ct ? ` (${ct > 0 ? '+' : ''}${ct} cents)` : ''}`;
}
const PSG_REGS = ['Period A (fine)', 'Period A (coarse)', 'Period B (fine)', 'Period B (coarse)', 'Period C (fine)', 'Period C (coarse)', 'Noise period', 'Mixer, port direction',
  'Volume A', 'Volume B', 'Volume C', 'Envelope period (fine)', 'Envelope period (coarse)', 'Envelope shape', 'Port A (keyboard)', 'Port B (absent on the 8912)'];
const ENV_NAME = s => !(s & 8) ? (s & 4 ? '/___ rise then silence' : '\\___ fall then silence')
  : ['\\\\\\\\ falling sawtooth', '\\___ fall then silence', '\\/\\/ triangle', '\\‾‾‾ fall then hold high', '//// rising sawtooth', '/‾‾‾ rise then hold', '/\\/\\ triangle', '/___ rise then silence'][s & 7];

// envelope curve: same state machine as the PSG (16 levels per period)
function envCurve(shape, n = 48) {
  let st = 15, att = shape & 4 ? 15 : 0, hold = false;
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(st ^ att);
    if (hold || --st >= 0) continue;
    if (!(shape & 8)) { att = 0; st = 0; hold = true; }
    else if (shape & 1) { if (shape & 2) att ^= 15; st = 0; hold = true; }
    else { if (shape & 2) att ^= 15; st = 15; }
  }
  return out;
}
function envSvg(shape, level) {
  const W = 330, H = 64, pts = envCurve(shape), dx = W / pts.length;
  let d = `M0,${H - pts[0] * 4}`;
  pts.forEach((v, i) => { d += ` H${(i * dx).toFixed(1)} V${H - v * 4} H${((i + 1) * dx).toFixed(1)}`; });
  return `<svg class="cv-svg" viewBox="-2 -4 ${W + 4} ${H + 22}" width="${W + 4}" height="${H + 22}">
    ${[1, 2].map(k => `<line x1="${k * 16 * dx}" y1="0" x2="${k * 16 * dx}" y2="${H}" class="cv-grid"/>`).join('')}
    <line x1="0" y1="${H - level * 4}" x2="${W}" y2="${H - level * 4}" class="cv-beam-l"/>
    <path d="${d}" class="cv-wave cv-hotw"/><text x="0" y="${H + 14}" class="cv-t cv-tm">3 periods of 16 steps; dashed line: current level ${level}</text></svg>`;
}

function viewPSG(m, step, b) {
  const p = m.psg, r = p.regs, lv = p.levels(), line = m.ppi.c & 15, portA = p.readRegister(14), fn = (m.ppi.c >> 6) & 3;
  const keyNames = [...Array(8)].map((_, bit) => keyLabel(m, NAME_OF[line * 8 + bit]) || '—');
  const voices = lv.voices.map((v, c) => {
    const tp = (r[2 * c] | (r[2 * c + 1] << 8)) || 1, on = v.tone || v.noise;
    return `<div class="cv-voice${on && v.volume ? ' cv-hot' : ''}"><b>Voice ${'ABC'[c]}</b>
      ${kv([['TP period', `${tp} (R${2 * c + 1}:R${2 * c} = ${h2(r[2 * c + 1])} ${h2(r[2 * c])})`], ['Frequency', `1 MHz ÷ (16 × ${tp}) = ${hz(v.freq)}`], ['Nearest note', noteOf(v.freq)], ['Mixer', `${v.tone ? 'tone' : ''}${v.tone && v.noise ? ' + ' : ''}${v.noise ? 'noise' : ''}${on ? '' : 'muted'}`]])}
      ${bar(v.volume, 15, v.env ? `envelope (level ${v.volume})` : `volume ${v.volume} / 15`, v.env ? 'cv-warm' : '')}</div>`;
  }).join('');
  const hot = isPPI(b) || fn !== 0;
  const table = `<table class="cv-tab"><tr><th>Reg.</th><th>Role</th><th>Value</th></tr>${PSG_REGS.map((n, i) => `<tr class="${i === p.selected ? 'cv-sel' : ''}"><td>R${i}</td><td>${n}</td><td class="cv-v">${h2(r[i])}</td></tr>`).join('')}</table>`;
  return `${isPPI(b) || fn ? live(`PPI port C: BDIR = ${(m.ppi.c >> 7) & 1}, BC1 = ${(m.ppi.c >> 6) & 1} → ${PSG_FN[fn]} (register R${p.selected}), data on port A ${h2(m.ppi.a)}`) : ''}
    ${flow([B('PSG bus', 'wired to PPI port A, controlled by BDIR/BC1', PSG_FN[fn], hot), '', B('Registers', '16 registers, select then write', 'R' + p.selected, hot), '', B('Tones A B C', '12-bit counters ÷ TP', lv.voices.map(v => Math.round(v.freq)).join(' / ') + ' Hz'),
      B('Noise', '17-bit LFSR ÷ NP', hz(lv.noiseFreq)), '', B('Mixer R7', 'selects tone and/or noise per voice', h2(r[7])), '', B('Volumes', '16 logarithmic levels or envelope', lv.voices.map(v => v.volume).join(' ')), '', B('DAC × 3', 'analog outputs A, B, C', '→ amp')])}
    <div class="cv-voices">${voices}</div>
    ${cols(sec('Registers R0–R15 <span class="cv-m">(selected: R' + p.selected + ')</span>', table),
      stack(sec('Mixer R7', bits(r[7], ['Tone A', 'Tone B', 'Tone C', 'Noise A', 'Noise B', 'Noise C', 'Port A', 'Port B']) + note('Bit = 0: source enabled. Bit 6 = 0: port A is an input (keyboard read).'))
      + sec(`Envelope R13 = ${r[13]}: ${esc(ENV_NAME(r[13]))}`, bits(r[13], ['HOLD', 'ALT', 'ATT', 'CONT'], { n: 4 }) + envSvg(r[13], p.envLevel)
        + kv([['EP period (R12:R11)', `${lv.envPeriod} → one step every ${num(16 * (lv.envPeriod || 1))} µs`], ['Ramp duration', `${num(256 * (lv.envPeriod || 1) / 1000, 2)} ms (${hz(lv.envFreq)})`], ['Current level', p.envLevel]]))
      + sec('Noise and port A', kv([['Noise period NP (R6)', `${r[6] & 31} → ${hz(lv.noiseFreq)}`], ['Keyboard row (PPI PC0–PC3)', line], ['Columns read (R14)', `${h2(portA)} = %${bin(portA)}`]])
        + bits(portA, keyNames) + note('Bit = 0: key pressed on the row selected by the PPI.'))))}`;
}

const MSR_LBL = ['D0B', 'D1B', 'D2B', 'D3B', 'CB', 'EXM', 'DIO', 'RQM'];
const MSR_TXT = ['drive A seeking', 'drive B seeking', 'drive 2 seeking', 'drive 3 seeking', 'controller busy (command in progress)', 'execution phase (non-DMA)', 'direction: 1 = from FDC to Z80', 'ready for a byte transfer'];
const ST_BITS = {
  ST0: ['US0', 'US1', 'HD', 'NR', 'EC', 'SE', 'IC0', 'IC1'], ST1: ['MA', 'NW', 'ND', '—', 'OR', 'DE', '—', 'EN'],
  ST2: ['MD', 'BC', 'SN', 'SH', 'WC', 'DD', 'CM', '—'], ST3: ['US0', 'US1', 'HD', 'TS', 'T0', 'RY', 'WP', 'FT'],
};
const ST_TXT = { NR: 'drive not ready', EC: 'track 0 not found', SE: 'seek end', MA: 'missing address mark', NW: 'disk write-protected', ND: 'sector not found', OR: 'overrun', DE: 'CRC error',
  EN: 'end of cylinder', MD: 'missing data mark', BC: 'bad cylinder', SN: 'scan not satisfied', SH: 'scan equal', WC: 'wrong cylinder', DD: 'data CRC error', CM: 'deleted data mark',
  WP: 'write-protected', RY: 'ready', T0: 'head on track 0', TS: 'two-sided', FT: 'fault' };
const IC_TXT = ['normal termination', 'abnormal termination', 'invalid command', 'aborted (drive)'];

function cmdParams(op, len) {
  if (len === 9) return ['command', 'HD·US', 'C', 'H', 'R', 'N', 'EOT', 'GPL', 'DTL'];
  if (op === 0x0D) return ['command', 'HD·US', 'N', 'SC', 'GPL', 'D'];
  if (op === 0x0F) return ['command', 'HD·US', 'NCN'];
  if (op === 0x03) return ['command', 'SRT·HUT', 'HLT·ND'];
  return ['command', 'HD·US'];
}
function resultLabels(op, len, sameCmd) {
  if (len === 7) return ['ST0', 'ST1', 'ST2', 'C', 'H', 'R', 'N'];
  if (len === 2) return ['ST0', 'PCN'];
  return [sameCmd && op === 0x04 ? 'ST3' : 'ST0'];
}
function stDecode(name, v) {
  const set = ST_BITS[name].filter((n, i) => (v >> i) & 1 && ST_TXT[n]).map(n => ST_TXT[n]);
  if (name === 'ST0') set.unshift(IC_TXT[v >> 6], `drive ${v & 3}, head ${(v >> 2) & 1}`);
  return `<div class="cv-st"><div class="cv-lbl">${name} = ${h2(v)}</div>${bits(v, ST_BITS[name])}<div class="cv-m">${set.join(' · ') || 'no flags'}</div></div>`;
}

function viewFDC(m, step, b) {
  const f = m.fdc, a = f.activity, ex = f.exec;
  // main status register recomputed here (same rule as readStatus, without going through the port)
  let msr = 0x80;
  if (f.phase === 'command') msr |= 0x10;
  else if (f.phase === 'exec') msr |= 0x30 | (ex && ex.read ? 0x40 : 0);
  else if (f.phase === 'result') msr |= 0x50;
  for (const p of f.pending) msr |= 1 << p.drive;
  let msg = '';
  if (isFDC(b)) {
    if (!(b.addr & 0x0100)) msg = `OUT ${h4(b.addr)}, ${dataTxt(b)} — drive motor ${b.data != null ? (b.data & 1 ? 'on' : 'off') : ''}`;
    else if (b.addr & 1) msg = `${b.rd ? 'IN' : 'OUT'} ${h4(b.addr)}${b.data != null ? (b.rd ? ' → ' : ', ') + h2(b.data) : ''} — data register (phase ${a.phase})`;
    else msg = `IN ${h4(b.addr)} — read main status register (MSR = ${h2(msr)})`;
  }
  const phases = ['idle', 'command', 'exec', 'result'].map(ph => `<span class="cv-ph${f.phase === ph ? ' cv-on' : ''}">${{ idle: 'idle', command: 'command', exec: 'execution', result: 'result' }[ph]}</span>`).join('<i>→</i>');
  const cmdLbl = cmdParams(f.op, f.cmdLen || f.cmd.length);
  const cmdBytes = f.cmd.length ? `<div class="cv-bytes">${f.cmd.map((v, i) => `<div><b>${hex(v)}</b><span>${cmdLbl[i] ?? '?'}</span></div>`).join('')}${f.phase === 'command' ? [...Array(Math.max(0, f.cmdLen - f.cmd.length))].map((_, i) => `<div class="cv-dim"><b>··</b><span>${cmdLbl[f.cmd.length + i] ?? '?'}</span></div>`).join('') : ''}</div>` : note('No command received since reset.');
  const sameCmd = f.phase === 'result' || f.phase === 'idle';
  const res = f.result || [], rl = resultLabels(f.op, res.length, sameCmd);
  const resBytes = res.length ? `<div class="cv-bytes">${res.map((v, i) => `<div class="${f.phase === 'result' && i < f.resultPos ? 'cv-dim' : f.phase === 'result' && i === f.resultPos ? 'cv-hot' : ''}"><b>${hex(v)}</b><span>${rl[i] ?? '?'}</span></div>`).join('')}</div>`
    + rl.map((n, i) => ST_BITS[n] ? stDecode(n, res[i]) : '').join('') : note('No result.');
  let progress = '';
  if (f.phase === 'exec' && ex) {
    if (ex.read && ex.data) progress = bar(ex.pos, ex.data.length, `read: ${num(ex.pos)} / ${num(ex.data.length)} bytes`, 'cv-warm');
    else if (ex.format) progress = bar(ex.ids.length, 4 * ex.SC, `format: ${ex.ids.length / 4 | 0} / ${ex.SC} sector IDs`, 'cv-warm');
    else if (ex.buf) progress = bar(ex.pos, ex.buf.length, `write: ${num(ex.pos)} / ${num(ex.buf.length)} bytes of sector ${h2(ex.r)}`, 'cv-warm');
  }
  const d = a.drive & 1, dr = f.drives[d], disk = dr.disk, side = disk && disk.sides > 1 ? a.side & 1 : 0;
  const trk = disk ? disk.tracks[side]?.[dr.track] : null, secs = trk?.sectors || [];
  const nextIdx = secs.length ? dr.index % secs.length : -1;
  const sectorMap = !disk ? note(`Drive ${'AB'[d]} empty.`) : !secs.length ? note(`Track ${dr.track} not formatted.`)
    : `<div class="cv-sectors">${secs.map((s, i) => `<div class="${s.R === a.sector ? 'cv-hot' : ''}${i === nextIdx ? ' cv-next' : ''}"><b>${hex(s.R)}</b><span>C${s.C} H${s.H} N${s.N}</span><span>${num(0x80 << Math.min(s.N, 8))} B</span></div>`).join('')}</div>`
      + note(`Yellow box: current sector (${a.sector != null ? h2(a.sector) : 'none'}); dotted: next ID under the head (READ ID). Filler ${h2(trk.filler ?? 0xE5)}, GAP3 ${trk.gap3 ?? '—'}.`);
  const driveRow = i => { const x = f.drives[i]; return [`Drive ${'AB'[i]}`, `${x.disk ? `${esc(x.disk.name || 'disk')} · ${x.disk.sides} side(s)${x.disk.writeProtected ? ' · protected' : ''}` : 'empty'} · track ${x.track}`, i === d]; };
  return `${msg ? live(msg) : ''}
    ${flow([B('Z80 bus', '&FB7E: MSR, &FB7F: data, &FA7E: motor', h2(msr), isFDC(b)), '', B('Registers', 'MSR, data, ST0–ST3', f.phase === 'result' ? 'result' : '—', f.phase === 'result'), '', B('Sequencer', 'decodes and runs the command', a.command || '—', f.phase !== 'idle'), '',
      B('Data separator', 'MFM, search for C H R N IDs', a.sector != null ? 'sector ' + h2(a.sector) : '—', a.reading || a.writing), 'STEP DIR', B(`Drive ${'AB'[d]}`, 'head, motor, index', `track ${dr.track}`, f.motor)])}
    <div class="cv-phases">${phases}</div>${progress}
    ${cols(sec(`Main status register MSR = ${h2(msr)}`, bits(msr, MSR_LBL, { title: MSR_TXT }) + `<ul class="cv-list">${MSR_LBL.map((n, i) => (msr >> i) & 1 ? `<li><b>${n}</b> ${MSR_TXT[i]}</li>` : '').join('')}</ul>`),
      sec('Drives', kv([['Motor', f.motor ? 'on' : 'off', f.motor], driveRow(0), driveRow(1), ['Pending interrupts', f.pending.length ? f.pending.map(p => `drive ${'AB'[p.drive & 1]} (ST0 ${h2(p.st0)}, track ${p.pcn})`).join(', ') : 'none']])))}
    ${cols(sec(`Last command: ${a.command || '—'}`, cmdBytes), sec('Result', resBytes))}
    ${sec(`Track ${dr.track} of drive ${'AB'[d]}, side ${side}: ${secs.length} sector(s)`, sectorMap)}`;
}

// diagram: the 4 quarters of the Z80 address space and the 8 16 KB RAM banks
function bankSvg(m, own, acc) {
  const ga = m.ga, screen = (m.crtc.regs[12] >> 4) & 3, banks = m.bank.map(x => x >> 14);
  const qy = i => 8 + i * 56, by = j => 8 + j * 27.5;
  let s = `<svg class="cv-svg" viewBox="0 0 560 232" width="560" height="232">`;
  banks.forEach((bk, i) => {
    const on = acc && acc.q === i;
    s += `<path d="M190,${qy(i) + 23} C270,${qy(i) + 23} 290,${by(bk) + 11} 370,${by(bk) + 11}" class="cv-link${on ? ' cv-on' : ''}${own.includes(bk) ? '' : ' cv-dim'}"/>`;
  });
  [0, 1, 2, 3].forEach(i => {
    const rom = (i === 0 && ga.lowerRom) || (i === 3 && ga.upperRom), on = acc && acc.q === i;
    s += `<rect x="10" y="${qy(i)}" width="180" height="46" rx="4" class="cv-box${on ? ' cv-on' : ''}"/>
      <text x="18" y="${qy(i) + 17}" class="cv-t">${h4(i * 0x4000)}–${h4(i * 0x4000 + 0x3FFF)}</text>
      <text x="18" y="${qy(i) + 34}" class="cv-t cv-tm">bank ${banks[i]}${rom ? (i === 0 ? ' · read: OS ROM' : ` · read: ROM ${m.romSelect}`) : ''}</text>`;
  });
  for (let j = 0; j < 8; j++) {
    const on = acc && acc.bank === j, mine = own.includes(j);
    s += `<rect x="370" y="${by(j)}" width="180" height="23" rx="3" class="cv-box${mine ? '' : ' cv-dim'}${on ? ' cv-on' : ''}${j === screen ? ' cv-scr' : ''}"/>
      <text x="378" y="${by(j) + 16}" class="cv-t">bank ${j} · ${h5(j * 0x4000)}${j === screen ? ' · screen' : ''}</text>`;
  }
  return s + `<text x="10" y="230" class="cv-t cv-tm">Z80 address space (64 KB)</text><text x="370" y="230" class="cv-t cv-tm">physical RAM (128 KB)</text></svg>`;
}

// screen memory thumbnail: one cell per character, intensity = pixels set
function screenSvg(m) {
  const R = m.crtc.regs, cw = Math.max(1, Math.min(R[1], 64)), rows = Math.max(1, Math.min(R[6], 40)), lpr = Math.min((R[9] & 7) + 1, 8);
  const base = ((R[12] << 8) | R[13]) & 0x3FFF, W = 320, sx = W / cw, sy = Math.min(8, 200 / rows), ram = m.ram;
  let rects = '';
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cw; col++) {
      const ma = (base + row * R[1] + col) & 0x3FFF;
      let n = 0;
      for (let ra = 0; ra < lpr; ra++) {
        const ad = ((ma & 0x3000) << 2) | (ra << 11) | ((ma & 0x3FF) << 1);
        n += POP[ram[ad]] + POP[ram[(ad + 1) & 0xFFFF]];
      }
      if (n) rects += `<rect x="${(col * sx).toFixed(1)}" y="${(row * sy).toFixed(1)}" width="${sx.toFixed(1)}" height="${sy}" fill-opacity="${Math.min(1, 0.15 + n / (16 * lpr) * 1.7).toFixed(2)}"/>`;
    }
  }
  return `<svg class="cv-svg cv-scrimg" viewBox="0 0 ${W} ${rows * sy}" width="${W}" height="${rows * sy}"><rect width="${W}" height="${rows * sy}" class="cv-scrbg"/><g class="cv-scrpx">${rects}</g></svg>`;
}

// bank usage: 16 cells of 1 KB per bank, share of non-zero bytes
function densityGrid(m, own) {
  return `<div class="cv-dens">${own.map(bk => {
    let cells = '';
    for (let k = 0; k < 16; k++) {
      let n = 0;
      const o = bk * 0x4000 + k * 1024;
      for (let i = 0; i < 1024; i++) if (m.ram[o + i]) n++;
      cells += `<i style="opacity:${(0.12 + 0.88 * n / 1024).toFixed(2)}" title="${hex(o, 5)}: ${n} non-zero bytes"></i>`;
    }
    return `<div><span>bank ${bk}</span>${cells}</div>`;
  }).join('')}</div>`;
}

function viewRAM(m, step, b, own) {
  const banks = m.bank.map(x => x >> 14), screen = (m.crtc.regs[12] >> 4) & 3;
  let acc = null, msg = '';
  const pc = m.cpu.getRegs().PC;
  if (b && b.mem) {
    const q = b.addr >> 14, chip = m.chipAt(b.addr), rom = b.rd && chip.startsWith('ROM');
    acc = { q, bank: banks[q], phys: m.bank[q] | (b.addr & 0x3FFF), rom };
    msg = own.includes(banks[q]) ? `${accTxt(b)}: quarter ${q} → bank ${banks[q]}, physical address ${h5(acc.phys)}${rom ? ` (read served by the ${chip}, RAM is ignored)` : ''}` : '';
    if (!own.includes(banks[q])) acc = { q, bank: banks[q], phys: acc.phys, other: true };
  }
  const focusZ80 = acc ? b.addr : pc, q = focusZ80 >> 14;
  let phys = m.bank[q] | (focusZ80 & 0x3FFF);
  if (!own.includes(phys >> 14)) { const vis = banks.find(x => own.includes(x)); phys = (vis ?? own[0]) * 0x4000; }
  const screenBase = screen * 0x4000;
  return `${msg ? live(msg) : ''}
    ${flow([B('Z80 bus', 'A0–A15, /MREQ, /RD, /WR', acc ? h4(b.addr) : '—', !!acc && !acc.other), 'A14 A15', B('PAL 40030', 'selects the 16 KB bank of the quarter', 'C' + (m.ga.ramConfig & 7), !!acc), '/CAS', B('Address multiplexer', 'row (/RAS) then column (/CAS)', acc ? h5(acc.phys) : '—', !!acc && !acc.other),
      '', B(`DRAM ${own[0]}–${own[3]}`, '8 × 4164 chips: 1 bit each × 64 Ki', acc && !acc.other && b.data != null ? h2(b.data) : '—', !!acc && !acc.other), '', B('Gate Array', 'reads 2 screen bytes per µs (banks 0–3)', h4(m.crtc.videoAddress), own.includes(screen))])}
    ${cols(sec('Banks seen by the Z80', bankSvg(m, own, acc) + note(`Configuration C${m.ga.ramConfig & 7}: ${RAM_USE[m.ga.ramConfig & 7]}. Screen area: bank ${screen} (R12 = ${h2(m.crtc.regs[12])}), always read from the base 64 KB.`), 'cv-wide'),
      own.includes(screen) ? sec(`Screen memory image <span class="cv-m">(${h5(screenBase)}–${h5(screenBase + 0x3FFF)}, one cell per character)</span>`, screenSvg(m)) : '')}
    ${cols(sec(`Memory around ${h5(phys)} <span class="cv-m">(physical addresses${acc ? ', access in progress' : ', PC = ' + h4(pc)})</span>`, hexdump(a => m.ram[a], acc && !acc.other ? acc.phys : phys, { lo: own[0] * 0x4000, hi: own[3] * 0x4000 + 0x3FFF, label: h5, lines: 8, mark: b && b.wr ? 'cv-hx-wr' : null }), 'cv-wide'),
      sec('Usage (non-zero bytes per KB)', densityGrid(m, own)))}`;
}

// expansion ROM header: type, mark, version, modification, name table
function romHeader(rom) {
  const type = rom[0], ptr = rom[4] | (rom[5] << 8), names = [];
  if (ptr >= 0xC000 && ptr < 0x10000) {
    let o = ptr - 0xC000;
    while (names.length < 10 && o < rom.length && rom[o]) {
      let s = '';
      while (o < rom.length && s.length < 16) { const ch = rom[o++]; s += String.fromCharCode(ch & 0x7F); if (ch & 0x80) break; }
      names.push(s);
    }
  }
  const tName = { 0: 'foreground (program)', 1: 'background (extension)', 2: 'extension', 0x80: 'built-in (on-board BASIC)' }[type] ?? 'unknown';
  return kv([['&C000 type', `${h2(type)} — ${tName}`], ['&C001–&C003 mark · version · mod.', `${rom[1]} · ${rom[2]} · ${rom[3]}`], ['&C004 name table', h4(ptr)], ['Names (commands)', names.length ? names.map(n => esc(n)).join(', ') : '—']]);
}

function romView(m, step, b, parts, title) {
  const ga = m.ga, pc = m.cpu.getRegs().PC;
  let focus = null, msg = '';
  if (b && b.mem && b.rd) {
    const chip = romChip(m, b.addr), part = parts.find(p => p.chip === chip);
    if (part) { focus = { part, addr: b.addr }; msg = `${accTxt(b)}: ${chip}, byte ${h4(b.addr & 0x3FFF)} of the chip`; }
  } else if (b && b.mem && b.wr && parts.some(p => p.chip === romChip(m, b.addr))) msg = `write ${h4(b.addr)}: the ROM ignores it, the byte goes to RAM (bank ${m.bank[b.addr >> 14] >> 14})`;
  if (isROMSEL(b) && b.data != null) msg = `OUT ${h4(b.addr)}, ${h2(b.data)} — select upper ROM ${b.data} (${b.data === 7 ? 'AMSDOS' : 'BASIC'})`;
  if (!focus) { const part = parts.find(p => p.chip === romChip(m, pc)); if (part) focus = { part, addr: pc }; }
  const shown = focus?.part ?? parts[parts.length - 1], fAddr = focus ? focus.addr : shown.base;
  const onBus = !!(focus && b && b.mem && focus.addr === b.addr);
  return `${msg ? live(msg) : ''}
    ${flow([B('Z80 bus', 'A0–A15, /RD', onBus ? h4(b.addr) : '—', onBus), 'A14 A15', B('Gate Array', '/ROMEN when a ROM is visible in this quarter', `lower ${ga.lowerRom ? 'yes' : 'no'} · upper ${ga.upperRom ? 'yes' : 'no'}`, onBus), '',
      B('&DFxx latch', 'upper ROM number', m.romSelect, isROMSEL(b)), '/CE', ...parts.map(p => B(p.name, p.role, p.visible ? 'visible' : 'hidden', onBus && focus.part === p)), 'D0–D7', B('Data bus', 'byte read', onBus && b.data != null ? h2(b.data) : '—', onBus)])}
    ${cols(sec(title, kv(parts.map(p => [p.name, `${p.visible ? 'visible' : 'hidden'} at ${h4(p.base)}–${h4(p.base + 0x3FFF)}${p.why ? ' · ' + p.why : ''}`, p.visible]).concat([['Selected upper ROM', `${m.romSelect} (${m.romSelect === 7 ? 'AMSDOS' : 'BASIC'}; any number other than 7 gives BASIC)`]]))
      + note('Reads in a quarter covered by a visible ROM go to the ROM; writes always go to RAM.')),
      ...parts.filter(p => p.header).map(p => sec(`${p.name} header`, romHeader(p.data))))}
    ${sec(`${shown.name} around ${h4(fAddr)} <span class="cv-m">(${onBus ? 'access in progress' : focus ? 'PC' : 'start'})</span>`, hexdump(a => shown.data[a - shown.base], fAddr, { lo: shown.base, hi: shown.base + 0x3FFF, lines: 8 }))}`;
}

function viewROM(m, step, b) {
  const ga = m.ga;
  return romView(m, step, b, [
    { chip: 'ROM OS', name: 'ROM OS', role: 'firmware, &BBxx vectors', data: m.os, base: 0x0000, visible: ga.lowerRom },
    { chip: 'ROM BASIC', name: 'ROM BASIC', role: 'Locomotive BASIC 1.1 (ROM 0)', data: m.basic, base: 0xC000, visible: ga.upperRom && m.romSelect !== 7, why: m.romSelect === 7 ? 'ROM 7 selected in its place' : '', header: true },
  ], 'Internal 32 KB ROM: two 16 KB halves');
}
function viewAMSDOS(m, step, b) {
  return romView(m, step, b, [
    { chip: 'ROM AMSDOS', name: 'ROM AMSDOS', role: 'upper ROM 7: DOS and FDC driver', data: m.amsdos, base: 0xC000, visible: m.ga.upperRom && m.romSelect === 7, why: m.romSelect === 7 ? '' : `ROM ${m.romSelect} selected`, header: true },
  ], 'AMSDOS expansion ROM');
}

function viewPAL(m, step, b) {
  const cur = m.ga.ramConfig & 7;
  let next = -1, msg = '', q = -1;
  if (gaPort(b) && b.wr && b.data != null && b.data >> 6 === 3) { next = b.data & 7; msg = `OUT ${h4(b.addr)}, ${h2(b.data)} — the PAL switches to configuration C${next}`; }
  else if (b && b.mem) { q = b.addr >> 14; msg = `${accTxt(b)}: A15 A14 = ${q >> 1}${q & 1} → quarter ${q} → bank ${m.bank[q] >> 14}`; }
  const rows = RAM_CONFIG.map((cfg, i) => `<tr class="${i === cur ? 'cv-sel' : ''}${i === next ? ' cv-hot' : ''}"><td>C${i}</td>${cfg.map((bk, j) => `<td class="${i === cur && j === q ? 'cv-hotc' : ''}${bk > 3 ? ' cv-ext' : ''}">${bk}</td>`).join('')}<td class="cv-m">${RAM_USE[i]}</td></tr>`).join('');
  return `${msg ? live(msg) : ''}
    ${flow([B('Z80 bus', 'OUT &7Fxx with %11xxxccc', `${h2(0xC0 | cur)}`, next >= 0), '', B('Configuration latch', '3 bits ccc (bits 3–5: 512 KB expansions, ignored)', `C${cur} · ${h2(m.ga.ramConfig)}`, next >= 0), '', B('Bank table', 'A14–A15 → bank number', m.bank.map(x => x >> 14).join(' '), q >= 0), '', B('DRAM /CAS', 'enables row 0–3 or 4–7', q >= 0 ? `bank ${m.bank[q] >> 14}` : '—', q >= 0)])}
    ${sec('The 8 RAM configurations <span class="cv-m">(highlighted row: active configuration; banks 4–7 in purple = 64 KB expansion)</span>',
      `<table class="cv-tab cv-pal"><tr><th>Conf.</th><th>&amp;0000</th><th>&amp;4000</th><th>&amp;8000</th><th>&amp;C000</th><th>Use</th></tr>${rows}</table>`)}
    ${note('Video always reads the base RAM (banks 0–3), whatever the configuration.')}`;
}

const NAME_OF = Object.fromEntries(Object.entries(KEYS).map(([n, [l, bit]]) => [l * 8 + bit, n]));
const SPECIAL = { CUR_UP: '↑', CUR_DOWN: '↓', CUR_LEFT: '←', CUR_RIGHT: '→', SPACE: 'SPACE', CONTROL: 'CTRL', CAPS: 'CAPS', JOY_UP: 'Joy ↑', JOY_DOWN: 'Joy ↓', JOY_LEFT: 'Joy ←', JOY_RIGHT: 'Joy →', JOY_FIRE1: 'Fire 1', JOY_FIRE2: 'Fire 2', RETURN: 'RETURN', ENTER: 'ENTER' };
function keyLabel(m, name) {
  if (!name) return '';
  if (SPECIAL[name]) return SPECIAL[name];
  if (/^F[0-9.]$/.test(name)) return 'f' + name.slice(1);
  return m.keymap?.labels?.[name]?.main ?? name;
}

function viewKDEC(m) {
  const line = m.ppi.c & 15;
  const outs = [...Array(10)].map((_, i) => {
    const on = i === line, keys = [...Array(8)].map((_, bit) => keyLabel(m, NAME_OF[i * 8 + bit])).filter(Boolean).slice(0, 8).map(esc).join(' ');
    return `<div class="cv-out${on ? ' cv-hot' : ''}"><b>${on ? 0 : 1}</b><span>output ${i}</span><span class="cv-m">${keys}</span></div>`;
  }).join('');
  return `${flow([B('PPI port C', 'bits PC0–PC3', `${line} = %${bin(line, 4)}`, true), 'D C B A', B('74LS145', 'BCD decoder → 10 open-collector outputs', line < 10 ? `output ${line} low` : 'no output', line < 10), '0–9', B('Keyboard matrix', 'the low row is read by the PSG', line < 10 ? `row ${line}` : '—', line < 10)])}
    ${cols(sec('BCD input', bits(line, ['A (PC0)', 'B (PC1)', 'C (PC2)', 'D (PC3)'], { n: 4, dir: 'in' }) + note(line < 10 ? `Value ${line}: only output ${line} goes low and drives keyboard row ${line}.` : `Value ${line} > 9: all outputs stay high, no row is read.`)),
      sec('Outputs (only one low)', `<div class="cv-outs">${outs}</div>`))}`;
}

function viewKBD(m) {
  const mx = m.keyboard.matrix, line = m.ppi.c & 15;
  const down = [];
  let rows = '';
  for (let l = 0; l < 10; l++) {
    rows += `<tr class="${l === line ? 'cv-sel' : ''}"><td>${l}</td>`;
    for (let bit = 0; bit < 8; bit++) {
      const name = NAME_OF[l * 8 + bit], pressed = !((mx[l] >> bit) & 1);
      if (pressed && name) down.push(keyLabel(m, name));
      rows += `<td class="cv-key${pressed ? ' cv-hot' : ''}${name ? '' : ' cv-dim'}">${name ? esc(keyLabel(m, name)) : '—'}</td>`;
    }
    rows += `<td class="cv-v">${h2(mx[l])}</td></tr>`;
  }
  return `${flow([B('74LS145', 'pulls one row low', line < 10 ? `row ${line}` : 'none', line < 10), 'row', B('10 × 8 matrix', 'a pressed key connects its row to its column', down.length ? `${down.length} key(s)` : 'none'), 'columns', B('PSG port A', 'reads the 8 columns (0 = pressed)', h2(line < 10 ? mx[line] : 0xFF), line < 10)])}
    ${sec('Live matrix <span class="cv-m">(highlighted row: row being read now; yellow cell: key pressed)</span>',
      `<table class="cv-tab cv-kbd"><tr><th>Row</th>${[...Array(8)].map((_, i) => `<th>bit ${i}</th>`).join('')}<th>Value</th></tr>${rows}</table>`)}
    ${kv([['Keys pressed', down.length ? down.map(esc).join(', ') : 'none'], ['Auto-typing', m.keyboard.typing ? `in progress (${m.keyboard.queue.length} character(s) queued)` : 'no']])}`;
}

function viewPRN(m, step, b) {
  let latch = null, src = '';
  if (isPRN(b) && b.data != null) { latch = b.data; src = 'access in progress'; }
  else { const e = [...m.io].reverse().find(x => x.dir === 'out' && !(x.port & 0x1000)); if (e) { latch = e.value; src = `last write (port ${h4(e.port)})`; } }
  const v = latch ?? 0, text = m.printer.text, tail = text.slice(-160);
  const shown = [...tail].map(ch => ch === '\r' ? '<span class="cv-ctl">CR</span>' : ch === '\n' ? '<span class="cv-ctl">LF</span>\n' : ch.charCodeAt(0) < 32 ? `<span class="cv-ctl">${hex(ch.charCodeAt(0))}</span>` : esc(ch)).join('');
  return `${isPRN(b) ? live(`OUT ${h4(b.addr)}, ${dataTxt(b)} — the latch stores D0–D6 and /STROBE (bit 7)`) : ''}
    ${flow([B('Z80 bus', 'OUT &EFxx (A12 = 0)', latch != null ? h2(latch) : '—', isPRN(b)), 'D0–D7', B('74LS273 latch', '8 flip-flops loaded on each OUT', latch != null ? h2(latch) : '—', isPRN(b)), 'D0–D6 · /STROBE', B('Centronics connector', 'data + strobe pulse', m.printer.strobe ? 'STROBE 1' : 'STROBE 0'), 'BUSY → PPI B6', B('Printer', 'takes the byte on the /STROBE edge', `${num(text.length)} chars`)])}
    ${cols(sec(`Latch ${latch != null ? `= ${h2(v)}` : '(no write)'} <span class="cv-m">${src}</span>`, bits(latch, ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'STROBE'], { hot: isPRN(b) ? [7] : null })
      + kv([['Character D0–D6', latch != null ? `${h2(v & 0x7F)} ${(v & 0x7F) >= 32 ? '“' + esc(m.charset[v & 0x7F] ?? String.fromCharCode(v & 0x7F)) + '”' : '(control)'}` : '—'], ['Latched /STROBE', m.printer.strobe ? '1' : '0'], ['BUSY (PPI port B bit 6)', '0: printer always ready']])
      + note('The CPC has only 7 data bits: bit 7 of the port is used as the /STROBE signal.')),
      sec('Last characters sent', `<pre class="cv-paper">${shown || '<span class="cv-m">(nothing)</span>'}</pre>`))}`;
}

function voiceAmps(m) {
  const lv = m.psg.levels();
  return lv.voices.map(v => (v.tone || v.noise) ? VOLUME[v.volume & 15] : 0);
}
function viewAMP(m) {
  const lv = m.psg.levels(), a = voiceAmps(m), L = (a[0] + 0.5 * a[1]) / 1.5, R = (a[2] + 0.5 * a[1]) / 1.5;
  return `${flow([B('PSG voice A', 'analog output', lv.voices[0].volume), B('PSG voice B', 'analog output', lv.voices[1].volume), B('PSG voice C', 'analog output', lv.voices[2].volume), '', B('Mixer', 'L = A + B/2, R = C + B/2', ''), '', B('Amp', 'speaker (mono) and headphone socket (stereo)', '')])}
    ${cols(sec('Voice levels', lv.voices.map((v, c) => bar(a[c], 1, `voice ${'ABC'[c]}: ${v.tone || v.noise ? `volume ${v.volume}${v.env ? ' (envelope)' : ''}` : 'muted (mixer)'}`)).join('') + note('AY logarithmic scale: about 3 dB per volume step.')),
      sec('Outputs', bar(L, 1, `left ${num(L * 100)} %`) + bar(R, 1, `right ${num(R * 100)} %`) + bar((L + R) / 2, 1, `internal speaker ${num((L + R) * 50)} %`)))}`;
}
function viewSPK(m) {
  const a = voiceAmps(m), mono = (a[0] + a[1] + a[2]) / 3;
  return `${flow([B('Audio amp', 'mixes A + B + C', ''), '', B('Speaker', 'cone driven by the current', `${num(mono * 100)} %`, mono > 0), '', B('PC sound card', 'plays the samples', '')])}
    ${sec('Instantaneous amplitude', bar(mono, 1, `${num(mono * 100)} % of maximum`) + note('Voices muted by the mixer (R7) do not contribute to the sound.'))}`;
}

function viewMON(m) {
  const ga = m.ga, c = m.crtc, R = c.regs, res = [[160, 200], [320, 200], [640, 200], [160, 200]][ga.mode & 3];
  const frameHz = 1e6 / ((R[0] + 1) * ((R[4] + 1) * ((R[9] & 31) + 1) + (R[5] & 31)));
  return `${flow([B('Gate Array', 'R, G, B on 3 levels', '27 colors'), 'RGB + sync', B('Monitor', ga.monochrome ? 'GT65 green (monochrome)' : 'CTM644 color', `${num(frameHz, 2)} Hz`)])}
    ${cols(sec('Picture', `<svg class="cv-svg" viewBox="0 0 220 160" width="220" height="160"><rect x="0" y="0" width="220" height="160" rx="10" fill="${rgb(ga.inks[16])}" class="cv-mon"/><rect x="30" y="25" width="160" height="110" fill="${rgb(ga.inks[0])}"/><text x="110" y="85" text-anchor="middle" class="cv-t" fill="${rgb(ga.inks[1])}">${res[0]} × ${res[1]}</text></svg>`),
      sec('State', kv([['Mode', `${ga.mode} — ${MODES[ga.mode & 3]}`], ['Border', `hardware color ${ga.inks[16]} (firmware ${hwToFirmware(ga.inks[16])})`], ['Background (ink 0)', `hardware color ${ga.inks[0]} (firmware ${hwToFirmware(ga.inks[0])})`], ['Frames displayed', num(m.frames)], ['Beam line', `${ga.beamY} since VSYNC`]])
        + pins([['HSYNC', c.hsync], ['VSYNC', c.vsync], ['DISPEN', c.displayEnabled]])))}`;
}

function viewDRIVE(m) {
  const f = m.fdc, a = f.activity;
  const disc = i => {
    const x = f.drives[i], tracks = x.disk ? Math.max(0, ...x.disk.tracks.map(s => s ? s.length : 0)) : 0, r = 46 - Math.min(x.track, 42) / 42 * 30, act = a.drive === i;
    return `<div class="cv-drive${act ? ' cv-hot' : ''}"><svg class="cv-svg" viewBox="0 0 120 110" width="120" height="110"><circle cx="55" cy="55" r="50" class="cv-disc${x.disk ? '' : ' cv-dim'}"/><circle cx="55" cy="55" r="12" class="cv-hub"/>
      <circle cx="55" cy="55" r="${r}" class="cv-trackc"/><rect x="${55 + r - 4}" y="50" width="62" height="10" class="cv-head${act && (a.reading || a.writing) ? ' cv-on' : ''}"/></svg>
      ${kv([['Drive', 'AB'[i] + ':'], ['Disk', x.disk ? `${esc(x.disk.name || 'inserted')}${x.disk.dirty ? ' (modified)' : ''}` : 'none'], ['Sides · tracks', x.disk ? `${x.disk.sides} · ${tracks}` : '—'], ['Head track', x.track, act], ['Activity', act ? (a.reading ? 'reading' : a.writing ? 'writing' : 'selected') : '—']])}</div>`;
  };
  return `${flow([B('FDC µPD765A', 'STEP, DIR, write', a.command || '—', f.phase !== 'idle'), '', B('Motor', 'shared by both drives (&FA7E)', f.motor ? 'on' : 'off', f.motor), '', B('Head', 'reads the magnetic flux', `track ${f.drives[a.drive & 1].track}`, a.reading || a.writing)])}
    <div class="cv-drives">${disc(0)}${disc(1)}</div>${note('The light circle shows the track under the head (track 0 on the outside).')}`;
}

function viewPRINTER(m) {
  const lines = m.printer.text.split(/\r\n|\r|\n/), last = lines.slice(-12);
  return `${flow([B('Printer port', 'D0–D6 + /STROBE', ''), 'Centronics', B('Virtual printer', 'listing paper in the Machine tab', `${num(m.printer.text.length)} chars`)])}
    ${sec(`Last lines <span class="cv-m">(${lines.length} line(s) in total)</span>`, `<pre class="cv-paper">${last.map(esc).join('\n') || '<span class="cv-m">(blank paper)</span>'}</pre>`)}`;
}

function viewXTAL(m) {
  const R = m.crtc.regs, ht = R[0] + 1, lines = (R[4] + 1) * ((R[9] & 31) + 1) + (R[5] & 31), line = 1e6 / ht, frame = line / lines;
  const t = m.cpu.cycles / 4e6;
  return `${flow([B('Crystal', '16 MHz oscillator', '16 MHz', true), '', B('Gate Array', 'divides and distributes', ''), '', B('Z80', '÷4', '4 MHz'), B('CRTC', '÷16', '1 MHz'), B('PSG', '÷16', '1 MHz')])}
    ${cols(sec('Derived frequencies', kv([['Crystal', '16.000 MHz (62.5 ns)'], ['Z80 clock', '4.000 MHz (250 ns per T-state)'], ['CRTC clock (characters)', '1.000 MHz (1 µs)'], ['PSG clock', '1.000 MHz'],
      ['Line (R0+1 = ' + ht + ')', `${hz(line)} (${ht} µs)`], ['Frame (' + lines + ' lines)', `${hz(frame)}`], ['Interrupts (52 lines)', hz(line / 52)]])),
      sec('Elapsed time', kv([['Z80 T-states', num(m.cpu.cycles)], ['Simulated time', `${num(t, 3)} s`], ['Frames', num(m.frames)]])))}`;
}

/* ---------------------------------------------------------------------
   Minimal system
   --------------------------------------------------------------------- */
function memChip(m, step, b, kind) {
  const isRom = kind === 'rom', lo = isRom ? 0x0000 : 0x8000, hi = lo + 0x1FFF, data = isRom ? m.rom : m.ram;
  const pc = m.cpu.getRegs().PC, sel = b && b.mem && b.addr >= lo && b.addr <= hi;
  const focus = sel ? b.addr : pc >= lo && pc <= hi ? pc : lo;
  const cs = !!sel && step.pins.includes('MREQ'), oe = cs && step.pins.includes('RD'), we = cs && step.pins.includes('WR');
  const msg = sel ? `${accTxt(b)} — ${isRom ? (b.wr ? 'write ignored by the EPROM' : 'byte read from the EPROM') : b.wr ? 'byte written to the SRAM' : 'byte read from the SRAM'} (cell ${h4(b.addr - lo)})` : '';
  return `${msg ? live(msg) : ''}
    ${flow([B('Address bus', 'A0–A12: 1 byte out of 8,192', sel ? h4(b.addr & 0x1FFF) : '—', sel), '', B('Row decoder', 'selects the row of cells', sel ? `row ${(b.addr & 0x1FFF) >> 3}` : '—', sel), '', B(isRom ? 'EPROM array' : 'SRAM array', isRom ? '65,536 floating-gate cells' : '6-transistor flip-flops', '8 KB', sel), '',
      B(isRom ? 'Output buffers' : 'Tri-state I/O', isRom ? 'enabled when /CE and /OE are low' : 'read /OE · write /WE', sel && b.data != null ? h2(b.data) : 'Z', oe || we), 'D0–D7', B('Data bus', '', sel && b.data != null ? h2(b.data) : '—', sel)])}
    ${cols(sec('Pins', pins([[isRom ? '/CE' : '/CS', cs, `74LS138 output Y${isRom ? 0 : 4}`], ['/OE', oe, 'output enable = /RD'], [isRom ? '/PGM' : '/WE', !isRom && we, isRom ? 'programming: pulled high' : 'write = /WR']])
      + kv([['Decoded range', `${h4(lo)}–${h4(hi)} (A15 A14 A13 = ${isRom ? '000' : '100'})`], ['Select', `74LS138 output Y${isRom ? 0 : 4}`], isRom ? ['Programmed bytes', num(m.rom.reduce((n, v) => n + (v !== 0xFF), 0))] : ['Non-zero bytes', num(m.ram.reduce((n, v) => n + (v !== 0), 0))]])
      + note(isRom ? 'The Z80 starts at &0000: the first instruction comes from this EPROM. Writes are ignored.' : 'The stack and variables live here; SP usually points to the top of the SRAM.')),
      sec(`Contents around ${h4(focus)} <span class="cv-m">(${sel ? 'access in progress' : focus === pc ? 'PC' : 'start'})</span>`, hexdump(a => data[a - lo], focus, { lo, hi, lines: 8, mark: sel && b.wr ? 'cv-hx-wr' : null }), 'cv-wide'))}`;
}

function viewMDEC(m, step, b) {
  const mreq = !!step?.pins?.includes('MREQ'), iorq = !!step?.pins?.includes('IORQ'), a = step?.addr ?? m.cpu.getRegs().PC;
  const selIdx = (a >> 13) & 7, use = ['EPROM (/CS)', '—', '—', '—', 'SRAM (/CS)', '—', '—', '—'];
  const rows = [...Array(8)].map((_, i) => {
    const on = mreq && i === selIdx;
    return `<tr class="${on ? 'cv-hot' : !mreq && i === selIdx ? 'cv-sel' : ''}"><td>${(i >> 2) & 1}</td><td>${(i >> 1) & 1}</td><td>${i & 1}</td>${[...Array(8)].map((_, y) => `<td class="${on && y === i ? 'cv-hotc' : ''}">${on && y === i ? 0 : 1}</td>`).join('')}<td>${h4(i * 0x2000)}–${h4(i * 0x2000 + 0x1FFF)}</td><td class="cv-m">${use[i]}</td></tr>`;
  }).join('');
  const out = iorq && step.pins.includes('WR') && !(a & 1), inp = iorq && step.pins.includes('RD') && (a & 1);
  return `${mreq ? live(`/MREQ active, address ${h4(a)}: A15 A14 A13 = ${bin(selIdx, 3)} → output Y${selIdx} low (${use[selIdx]})`) : iorq ? live(`/IORQ active, port ${h4(a)}, A0 = ${a & 1} → ${out ? 'output latch clock' : inp ? 'input buffer enable' : 'no port'}`) : ''}
    ${flow([B('Inputs C B A', 'A15 A14 A13', bin(selIdx, 3), mreq), '', B('Enables', 'G1 = +5 V, /G2A = /MREQ, /G2B = ground', mreq ? 'active' : 'blocked', mreq), '', B('3 → 8 decoder', 'only one Y output low', mreq ? 'Y' + selIdx : 'none', mreq), '', B('Chips', 'Y0 → EPROM, Y4 → SRAM', mreq ? use[selIdx] : '—', mreq)])}
    ${cols(sec('Inputs', pins([['A13', (a >> 13) & 1], ['A14', (a >> 14) & 1], ['A15', (a >> 15) & 1], ['/MREQ', mreq], ['/IORQ', iorq], ['A0', a & 1]]) + note(step ? `Address on the bus: ${h4(a)}.` : `No access in progress: boxed row = PC area (${h4(a)}).`)),
      sec('I/O ports (/IORQ and A0)', kv([['OUT (&00): /IORQ, /WR, A0 = 0', out ? '74LS374 clock' : '—', out], ['IN (&01): /IORQ, /RD, A0 = 1', inp ? '74LS244 enable' : '—', inp]])))}
    ${sec('Truth table (active-low outputs)', `<table class="cv-tab"><tr><th>A15</th><th>A14</th><th>A13</th>${[...Array(8)].map((_, y) => `<th>Y${y}</th>`).join('')}<th>Range</th><th>Chip</th></tr>${rows}</table>`)}`;
}

function viewMOUT(m, step, b) {
  const clk = b && b.io && b.wr && !(b.addr & 1), d = clk ? b.data : null;
  const ffs = [7, 6, 5, 4, 3, 2, 1, 0].map(i => `<div class="cv-ff${clk ? ' cv-hot' : ''}"><span>D${i} ${d == null ? '·' : (d >> i) & 1}</span><b>flip-flop</b><span class="${(m.leds >> i) & 1 ? 'cv-q1' : ''}">Q${i} ${(m.leds >> i) & 1}</span></div>`).join('');
  return `${clk ? live(`OUT (${h2(b.addr & 0xFF)}), ${dataTxt(b)}: clock rising edge → the 8 flip-flops copy D0–D7`) : ''}
    ${flow([B('Data bus', 'D0–D7', d != null ? h2(d) : '—', clk), '', B('8 D flip-flops', 'latch on the clock edge', h2(m.leds), clk), 'Q0–Q7', B('8 LEDs', 'lit by the outputs at 1', bin(m.leds))])}
    ${sec('D → Q flip-flops', `<div class="cv-ffs">${ffs}</div>` + pins([['CLK', clk, 'clock = /IORQ + /WR + A0 = 0'], ['/OE', true, 'outputs always enabled (tied to ground)']]) + note('Between two OUTs, the outputs keep the last value written.'))}`;
}

function viewMIN(m, step, b) {
  const en = b && b.io && b.rd && (b.addr & 1);
  const bufs = [7, 6, 5, 4, 3, 2, 1, 0].map(i => `<div class="cv-ff${en ? ' cv-hot' : ''}"><span>A${i} ${(m.switches >> i) & 1}</span><b>▷</b><span>Y${i} ${en ? (m.switches >> i) & 1 : 'Z'}</span></div>`).join('');
  return `${en ? live(`IN A, (${h2(b.addr & 0xFF)}): /G low → the switches drive the bus (${h2(m.switches)})`) : ''}
    ${flow([B('8 switches', 'inputs A0–A7', bin(m.switches)), '', B('8 tri-state buffers', 'drive only when /G = 0', en ? 'active' : 'high impedance', en), 'Y0–Y7', B('Data bus', 'read by the Z80', en ? h2(m.switches) : 'Z', en)])}
    ${sec('Buffers', `<div class="cv-ffs">${bufs}</div>` + pins([['/1G /2G', en, 'enable = /IORQ + /RD + A0 = 1']]) + note('Except while port &01 is read, the outputs are high impedance (Z): the buffer does not disturb the bus.'))}`;
}

function viewLEDS(m) {
  return `${sec(`LEDs = ${h2(m.leds)} = %${bin(m.leds)}`, `<div class="cv-leds">${[7, 6, 5, 4, 3, 2, 1, 0].map(i => `<div><i class="${(m.leds >> i) & 1 ? 'cv-on' : ''}"></i><span>Q${i}</span></div>`).join('')}</div>` + note('Each LED follows one 74LS374 output (1 = lit).'))}`;
}
function viewSW(m) {
  return `${sec(`Switches = ${h2(m.switches)} = %${bin(m.switches)}`, `<div class="cv-sws">${[7, 6, 5, 4, 3, 2, 1, 0].map(i => `<div class="${(m.switches >> i) & 1 ? 'cv-on' : ''}"><i></i><span>A${i}</span></div>`).join('')}</div>` + note('Toggle them in the Machine tab; the Z80 reads them with IN A,(&01).'))}`;
}
function viewOSC(m, step) {
  const W = 400, per = W / 8, t = step?.t;
  let d = 'M0,30';
  for (let i = 0; i < 8; i++) d += ` V6 H${i * per + per / 2} V30 H${(i + 1) * per}`;
  return `${flow([B('4 MHz crystal', 'resonator', ''), '', B('Inverters', 'sustain the oscillation', ''), 'CLK', B('Z80A', 'one T-state per period', t ? `T${t}` : num(m.cpu.cycles))])}
    ${sec('Clock', `<svg class="cv-svg" viewBox="0 0 ${W} 50" width="${W}" height="50">${t ? `<rect x="${((t - 1) % 8) * per}" y="0" width="${per}" height="36" class="cv-tbox"/>` : ''}<path d="${d}" class="cv-wave cv-hotw"/><text x="0" y="48" class="cv-t cv-tm">8 periods of 250 ns = 2 µs</text></svg>`
      + kv([['Frequency', '4.000 MHz'], ['Period', '250 ns'], ['Elapsed T-states', num(m.cpu.cycles)], ['Simulated time', `${num(m.cpu.cycles / 4e6, 4)} s`], ['Current T-state', step ? `${step.m} T${step.t}` : '—']]))}`;
}
function viewRST(m) {
  const r = m.cpu.getRegs();
  return `${flow([B('Button', 'pulls /RESET to ground', 'released'), '', B('RC network', 'holds /RESET low at power-on', 'charged'), '/RESET', B('Z80A', 'PC = 0, IFF = 0, IM 0 on reset', h4(r.PC))])}
    ${sec('State', pins([['/RESET', false, 'active low']]) + kv([['/RESET', '1 (inactive): the Z80 is running'], ['PC', h4(r.PC)], ['Interrupts', `IM ${r.IM}, IFF1 = ${r.IFF1}`]]) + note('On reset the Z80 restarts at &0000, with interrupts disabled, in mode 0.'))}`;
}

/* ---------------------------------------------------------------------
   API
   --------------------------------------------------------------------- */
const VIEWS = {
  cpc: {
    xtal: viewXTAL, pal: viewPAL, ga: viewGA, rom: viewROM, amsdos: viewAMSDOS,
    ram0: (m, s, b) => viewRAM(m, s, b, [0, 1, 2, 3]), ram1: (m, s, b) => viewRAM(m, s, b, [4, 5, 6, 7]),
    mon: viewMON, crtc: viewCRTC, ppi: viewPPI, psg: viewPSG, fdc: viewFDC, prn: viewPRN,
    kbd: viewKBD, kdec: viewKDEC, amp: viewAMP, drive: viewDRIVE, printer: viewPRINTER, spk: viewSPK,
  },
  min: {
    osc: viewOSC, rst: viewRST, mrom: (m, s, b) => memChip(m, s, b, 'rom'), mram: (m, s, b) => memChip(m, s, b, 'ram'),
    mdec: viewMDEC, mout: viewMOUT, min: viewMIN, leds: viewLEDS, sw: viewSW,
  },
};

export function hasChipView(boardKind, id) {
  const v = VIEWS[boardKind];
  return !!v && Object.hasOwn(v, id);
}

export function renderChipView(boardKind, id, m, ctx = null) {
  if (!hasChipView(boardKind, id)) return '';
  const step = ctx?.step || null;
  try {
    return `<div class="cv cv-${boardKind}-${id}">${VIEWS[boardKind][id](m, step, busOf(step))}</div>`;
  } catch (e) {
    return `<div class="cv cv-err">View unavailable: ${esc(e.message)}</div>`;
  }
}
