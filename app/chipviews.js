import { hex, esc } from './util.js';
import { HW_RGB, hwToFirmware } from '../src/machines/cpc/gatearray.js';
import { KEYS } from '../src/machines/cpc/keyboard.js';
import { VOLUME } from '../src/machines/cpc/psg.js';

/* Vues détaillées des circuits : schéma interne (blocs + flèches) et état réel de la machine,
   régénérées à chaque rafraîchissement (environ 8 fois par seconde, et à chaque pas à pas).
   Lectures pures uniquement : aucune méthode qui modifie l'état n'est appelée.
   ctx.step : T-state courant de la vue CPU en pas à pas, ou null. */

/* ---------------------------------------------------------------------
   Outils de mise en forme
   --------------------------------------------------------------------- */
const h2 = v => '&amp;' + hex(v);
const h4 = v => '&amp;' + hex(v, 4);
const h5 = v => '&amp;' + hex(v, 5);
const bin = (v, n = 8) => (v >>> 0).toString(2).padStart(n, '0');
const num = (v, d = 0) => Number(v).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const hz = f => f >= 1e6 ? num(f / 1e6, 3) + ' MHz' : f >= 1e3 ? num(f / 1e3, 2) + ' kHz' : num(f, f < 10 ? 2 : 1) + ' Hz';
const rgb = hw => `rgb(${HW_RGB[hw & 31].join(',')})`;
const POP = Uint8Array.from({ length: 256 }, (_, v) => { let n = 0; for (; v; v >>= 1) n += v & 1; return n; });

const sec = (title, body, cls = '') => `<section class="cv-sec${cls ? ' ' + cls : ''}"><h4>${title}</h4>${body}</section>`;
const cols = (...parts) => `<div class="cv-cols">${parts.join('')}</div>`;
const stack = (...parts) => `<div class="cv-stack">${parts.join('')}</div>`;
const note = t => `<p class="cv-note">${t}</p>`;
const live = t => `<div class="cv-live"><b>En cours</b> ${t}</div>`;
const kv = rows => `<table class="cv-kv">${rows.map(([k, v, hot]) => `<tr${hot ? ' class="cv-hot"' : ''}><td>${k}</td><td>${v}</td></tr>`).join('')}</table>`;
const pin = (name, on, title = '') => `<span class="cv-pin${on ? ' cv-on' : ''}"${title ? ` title="${esc(title)}"` : ''}>${name}</span>`;
const pins = list => `<div class="cv-pins">${list.map(([n, on, t]) => pin(n, on, t)).join('')}</div>`;
const bar = (v, max, label = '', cls = '') => `<div class="cv-bar${cls ? ' ' + cls : ''}"><i style="width:${Math.max(0, Math.min(100, 100 * v / (max || 1))).toFixed(1)}%"></i><span>${label}</span></div>`;

// bloc d'un schéma : { n: nom, d: rôle, v: valeur, hot: actif } ; une chaîne entre deux blocs = flèche (libellé)
const B = (n, d, v, hot) => ({ n, d, v, hot });
function flow(items) {
  return `<div class="cv-flow">${items.map(it => typeof it === 'string'
    ? `<div class="cv-arr"><span>${it}</span></div>`
    : `<div class="cv-blk${it.hot ? ' cv-hot' : ''}"><b>${it.n}</b>${it.d ? `<span>${it.d}</span>` : ''}${it.v != null && it.v !== '' ? `<code>${it.v}</code>` : ''}</div>`).join('')}</div>`;
}

// rangée de bits (poids fort à gauche) ; dir : 'in' | 'out' ou tableau par bit ; v null = haute impédance
function bits(v, labels, { n = 8, dir = null, hot = null, title = null } = {}) {
  let s = '<div class="cv-bits">';
  for (let i = n - 1; i >= 0; i--) {
    const on = v != null && (v >> i) & 1, d = Array.isArray(dir) ? dir[i] : dir;
    s += `<div class="cv-bit${on ? ' cv-1' : ''}${v == null ? ' cv-z' : ''}${hot && hot.includes(i) ? ' cv-hot' : ''}"${title?.[i] ? ` title="${esc(title[i])}"` : ''}>`
      + `<b>${v == null ? 'Z' : on ? 1 : 0}</b><span>${labels ? labels[i] ?? '' : 'b' + i}</span>${d ? `<i>${d === 'in' ? 'E' : 'S'}</i>` : ''}</div>`;
  }
  return s + '</div>';
}

// vidage hexadécimal de 16 octets par ligne autour de « focus »
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

// accès de bus du T-state courant : { mem, io, rd, wr, addr, data, pins }
function busOf(step) {
  if (!step || step.addr == null) return null;
  const p = step.pins || [], t = step.mtype;
  if (p.includes('RFSH')) return null;
  const mem = t === 'M1' || t === 'MR' || t === 'MW', io = t === 'IOR' || t === 'IOW';
  if (!mem && !io) return null;
  return { mem, io, rd: t === 'M1' || t === 'MR' || t === 'IOR', wr: t === 'MW' || t === 'IOW', addr: step.addr & 0xFFFF, data: step.data ?? null, pins: p, m1: t === 'M1' };
}
const dataTxt = b => b.data == null ? '--' : h2(b.data);
const accTxt = b => `${b.m1 ? 'lecture d\'opcode' : b.rd ? 'lecture' : 'écriture'} ${h4(b.addr)}${b.data != null ? (b.rd ? ' → ' : ' ← ') + h2(b.data) : ''}`;

/* ---------------------------------------------------------------------
   Amstrad CPC 6128
   --------------------------------------------------------------------- */
const RAM_CONFIG = [[0, 1, 2, 3], [0, 1, 2, 7], [4, 5, 6, 7], [0, 3, 2, 7], [0, 4, 2, 3], [0, 5, 2, 3], [0, 6, 2, 3], [0, 7, 2, 3]];
const RAM_USE = ['configuration normale (64 Ko de base)', 'banque 7 en &C000 (CP/M Plus)', '64 Ko étendus en entier (CP/M Plus)', 'CP/M Plus : banque 3 en &4000, 7 en &C000',
  'banque 4 en &4000', 'banque 5 en &4000', 'banque 6 en &4000', 'banque 7 en &4000'];
const MODES = ['160 × 200, 16 couleurs, 2 pixels par octet', '320 × 200, 4 couleurs, 4 pixels par octet', '640 × 200, 2 couleurs, 8 pixels par octet', 'mode 3 non documenté (160 × 200, 4 couleurs)'];
const gaPort = b => b && b.io && (b.addr & 0xC000) === 0x4000;
const isPPI = b => b && b.io && !(b.addr & 0x0800);
const isCRTC = b => b && b.io && !(b.addr & 0x4000);
const isFDC = b => b && b.io && !(b.addr & 0x0480);
const isPRN = b => b && b.io && b.wr && !(b.addr & 0x1000);
const isROMSEL = b => b && b.io && b.wr && !(b.addr & 0x2000);
const romChip = (m, a) => m.chipAt(a);

// fonction d'une écriture sur le Gate Array (port &7Fxx)
function gaFunction(m, v) {
  switch (v >> 6) {
    case 0: return v & 0x10 ? 'fonction 0 : sélection du stylo 16 (bordure)' : `fonction 0 : sélection du stylo ${v & 15}`;
    case 1: return `fonction 1 : couleur matérielle ${v & 31} (firmware ${hwToFirmware(v)}) pour le stylo ${m.ga.pen}`;
    case 2: return `fonction 2 : mode ${v & 3}, ROM basse ${v & 4 ? 'masquée' : 'visible'}, ROM haute ${v & 8 ? 'masquée' : 'visible'}${v & 16 ? ", remise à zéro du compteur d'interruptions" : ''}`;
    default: return `fonction 3 : configuration RAM C${v & 7} (traitée par le PAL)`;
  }
}

// pour chaque pixel de l'octet : numéros des bits, du poids faible au poids fort de l'encre
function pixelBits(mode) {
  if (mode === 2) return [...Array(8)].map((_, p) => [7 - p]);
  if (mode === 1) return [...Array(4)].map((_, q) => [7 - q, 3 - q]);
  return [[7, 3, 5, 1], [6, 2, 4, 0]];
}
const inkOf = (byte, list) => list.reduce((s, bit, k) => s | (((byte >> bit) & 1) << k), 0);

function clockWaves(hot) {
  const W = 330, x0 = 70;
  const sq = (y, per) => { let d = `M${x0},${y + 14}`; for (let x = 0; x < W - 1; x += per) d += ` V${y} H${x0 + x + per / 2} V${y + 14} H${x0 + x + per}`; return d; };
  const rows = [['16 MHz', 'quartz', W / 16], ['4 MHz', 'Z80', W / 4], ['1 MHz', 'CRTC, PSG', W]];
  return `<svg class="cv-svg" viewBox="0 0 410 96" width="410" height="96">${rows.map(([f, who, per], i) => {
    const y = 6 + i * 30;
    return `<text x="0" y="${y + 11}" class="cv-t">${f}</text><text x="0" y="${y + 22}" class="cv-t cv-tm">${who}</text><path d="${sq(y, per)}" class="cv-wave${hot && i === 1 ? ' cv-hotw' : ''}"/>`;
  }).join('')}<text x="${x0}" y="95" class="cv-t cv-tm">1 µs = 16 tops = 4 T-states = 1 caractère</text></svg>`;
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
    return `<div class="cv-ink${i === ga.pen ? ' cv-sel' : ''}${i < 16 && i >= used ? ' cv-dim' : ''}"><i style="background:${rgb(hw)}"></i><b>${i === 16 ? 'Bord.' : i}</b><span>M ${hw}</span><span>F ${hwToFirmware(hw)}</span></div>`;
  }).join('');
  return `${wr ? live(`OUT ${h4(b.addr)}, ${dataTxt(b)} — ${b.data != null ? gaFunction(m, b.data) : 'écriture sur le Gate Array'}`) : ''}
    ${wait ? live('/WAIT : le Gate Array retient le Z80 pour laisser la RAM à la vidéo (instruction alignée sur 4 T-states).') : ''}
    ${flow([B('Quartz', '16 MHz', '', false), '÷4 ÷16', B("Diviseur d'horloges", 'Z80 4 MHz, CRTC et PSG 1 MHz', '4 / 1 MHz', false), '', B('Arbitrage RAM', 'la vidéo lit 2 octets par µs, le Z80 attend (/WAIT)', wait ? '/WAIT actif' : 'libre', wait),
      'MA/RA', B('Sérialiseur', `octet → ${map.length} pixels (mode ${ga.mode})`, h2(b0), c.displayEnabled), 'n° encre', B('Palette', '17 encres → 27 couleurs', `stylo ${ga.pen}`, wr && b.data != null && b.data >> 6 < 2), 'RVB', B('Moniteur', 'R, V, B sur 3 niveaux', 'bordure ' + ga.inks[16], false)])}
    ${cols(sec("Diviseur d'horloges", clockWaves(true) + note('Le quartz 16 MHz est divisé par 4 pour le Z80 et par 16 pour le CRTC (un caractère par µs) et le PSG.')),
      sec('Mode écran', kv([['Mode actif', `${ga.mode} — ${MODES[ga.mode & 3]}`, true], ['Mode en attente', ga.pendingMode !== ga.mode ? `${ga.pendingMode} (pris en compte à la fin de la prochaine HSYNC)` : `${ga.pendingMode} (identique)`],
        ['Position du faisceau', `${ga.beamX} µs après HSYNC, ligne ${ga.beamY} après VSYNC`], ['Affichage', c.displayEnabled ? 'zone affichée (DISPEN = 1)' : c.hsync || c.vsync ? 'synchro (noir)' : 'bordure']])))}
    ${sec(`Palette — 17 encres <span class="cv-m">(M : couleur matérielle, F : numéro firmware de INK ; encres utilisées en mode ${ga.mode} : ${used} + bordure)</span>`, `<div class="cv-inks">${inks}</div>`)}
    ${sec(`Décodage de l'octet vidéo courant <span class="cv-m">(RAM ${h4(a)} et ${h4((a + 1) & 0xFFFF)}, adresse fournie par le CRTC)</span>`,
      `<div class="cv-dec"><div><div class="cv-lbl">Octet ${h2(b0)} = %${bin(b0)} : chaque bit va à un pixel (p) avec un poids</div>${decodeBits}</div>
       <div><div class="cv-lbl">Pixels produits pendant cette µs (octets ${h2(b0)} ${h2(b1)}) : numéro d'encre → couleur</div><div class="cv-strip">${strip}</div></div></div>`
      + note(c.displayEnabled ? 'Le faisceau est dans la zone affichée : ces pixels partent vers le moniteur.' : "Faisceau hors de la zone affichée : l'octet est lu mais la sortie montre la bordure ou le noir de synchro."))}
    ${cols(sec("Compteur d'interruptions", bar(ga.intCounter, 52, `${ga.intCounter} / 52 lignes`, ga.intRequest ? 'cv-warm' : '')
      + pins([['/INT', ga.intRequest, 'demande d\'interruption au Z80'], ['VSYNC', c.vsync], ['HSYNC', c.hsync]])
      + kv([['Demande en attente', ga.intRequest ? 'oui : /INT = 0 jusqu\'à l\'acquittement' : 'non (/INT = 1)', ga.intRequest], ['Resynchro VSYNC', ga.vsyncDelay ? `dans ${ga.vsyncDelay} ligne(s)` : '—']])
      + note('Le compteur avance à chaque fin de HSYNC (64 µs). À 52, il repart à 0 et lève /INT : 6 interruptions par trame, 300 Hz. La VSYNC le recale 2 lignes après son début.')),
      sec('Sélection des ROM et de la RAM', kv([['ROM basse (&0000–&3FFF)', ga.lowerRom ? 'visible en lecture (OS)' : 'masquée (RAM)', ga.lowerRom], ['ROM haute (&C000–&FFFF)', ga.upperRom ? `visible : ROM ${m.romSelect} (${m.romSelect === 7 ? 'AMSDOS' : 'BASIC'})` : 'masquée (RAM)', ga.upperRom],
        ['Configuration RAM', `C${ga.ramConfig & 7} — banques ${m.bank.map(x => x >> 14).join(' ')}`], ['Stylo sélectionné', ga.pen === 16 ? '16 (bordure)' : ga.pen]])
        + note('Les écritures vont toujours en RAM ; seules les lectures voient les ROM.')))}`;
}

const CRTC_REGS = [
  ['Total horizontal', 'caractères par ligne − 1'], ['Affichés horizontal', 'caractères visibles par ligne'], ['Position synchro H', 'caractère où débute HSYNC'],
  ['Largeurs des synchros', 'bits 0–3 HSYNC, bits 4–7 VSYNC'], ['Total vertical', 'rangées par trame − 1'], ['Ajustement vertical', 'lignes raster ajoutées'],
  ['Affichés vertical', 'rangées visibles'], ['Position synchro V', 'rangée où débute VSYNC'], ['Entrelacement', 'mode entrelacé et biais'],
  ['Lignes par rangée', 'lignes raster par rangée − 1'], ['Début du curseur', 'non câblé sur le CPC'], ['Fin du curseur', 'non câblé sur le CPC'],
  ['Début (poids fort)', 'bits 4–5 : page vidéo de 16 Ko'], ['Début (poids faible)', 'décalage en mots de 2 octets'], ['Curseur (fort)', 'position du curseur'],
  ['Curseur (faible)', 'position du curseur'], ['Crayon optique (fort)', 'lecture seule'], ['Crayon optique (faible)', 'lecture seule'],
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
    <text x="${X}" y="${Y - 5}" class="cv-t">R0+1 = ${ht} caractères (${ht} µs par ligne)</text>
    <text x="${X + 4}" y="${Y + 14}" class="cv-t cv-tv">zone affichée R1 × R6 = ${R[1]} × ${R[6]} caractères</text>
    ${hw ? `<text x="${X + R[2] * sx + 2}" y="${Y + H - 4}" class="cv-t cv-tc">HSYNC R2=${R[2]}</text>` : ''}
    <text x="${X + W - 4}" y="${Y + Math.min(R[7] * lpr, total) * sy - 3}" class="cv-t cv-tc" text-anchor="end">VSYNC R7=${R[7]}</text>
    <text x="${X + W + 6}" y="${Y + 12}" class="cv-t">${vt} rangées</text><text x="${X + W + 6}" y="${Y + 26}" class="cv-t">× ${lpr} lignes</text>
    <text x="${X + W + 6}" y="${Y + 40}" class="cv-t">+ ${R[5] & 31} (R5)</text><text x="${X + W + 6}" y="${Y + 54}" class="cv-t">= ${total} lignes</text>
    <text x="${X + W + 6}" y="${Y + 72}" class="cv-t cv-tm">${num(1e6 / (ht * total), 2)} Hz</text>
    <line x1="${bx}" y1="${Y}" x2="${bx}" y2="${Y + H}" class="cv-beam-l"/><line x1="${X}" y1="${by}" x2="${X + W}" y2="${by}" class="cv-beam-l"/>
    <circle cx="${bx}" cy="${by}" r="5" class="cv-beam"/>
    <text x="${X}" y="${Y + H + 16}" class="cv-t">Faisceau : caractère ${c.hcc}, rangée ${c.vcc}, ligne ${c.vlc}${c.adjust ? ' (ajustement R5)' : ''}</text>
  </svg>`;
}

function viewCRTC(m, step, b) {
  const c = m.crtc, R = c.regs, ma = c.ma;
  let msg = '', hotReg = -1;
  if (isCRTC(b)) {
    const f = (b.addr >> 8) & 3;
    if (f === 0 && b.wr) { hotReg = b.data != null ? b.data & 31 : -1; msg = `OUT ${h4(b.addr)}, ${dataTxt(b)} — sélection du registre R${hotReg >= 0 ? hotReg : '?'}`; }
    else if (f === 1 && b.wr) { hotReg = c.selected; msg = `OUT ${h4(b.addr)}, ${dataTxt(b)} — écriture dans R${c.selected} (${CRTC_REGS[c.selected]?.[0] ?? 'inexistant'})`; }
    else if (f === 3 && b.rd) { hotReg = c.selected; msg = `IN ${h4(b.addr)} — lecture de R${c.selected} (type 0 : seuls R14–R17 sont lisibles)`; }
    else msg = `${b.rd ? 'IN' : 'OUT'} ${h4(b.addr)} — fonction ${f} sans effet sur le type 0`;
  }
  const page = (ma & 0x3000) << 2, ra = (c.vlc & 7) << 11, off = (ma & 0x3FF) << 1;
  const table = `<table class="cv-tab"><tr><th>Reg.</th><th>Nom</th><th>Rôle</th><th>Valeur</th></tr>${CRTC_REGS.map(([n, d], i) =>
    `<tr class="${i === c.selected ? 'cv-sel' : ''}${i === hotReg ? ' cv-hot' : ''}"><td>R${i}</td><td>${n}</td><td class="cv-m">${d}</td><td class="cv-v">${R[i]} <span class="cv-m">${h2(R[i])}</span></td></tr>`).join('')}</table>`;
  return `${msg ? live(msg) : ''}
    ${flow([B('Compteur horizontal', 'HCC compte les caractères, revient à 0 après R0', c.hcc, c.displayEnabled), '', B('Lignes raster', 'VLC (RA) compte les lignes de la rangée jusqu\'à R9', c.vlc), '', B('Compteur de rangées', 'VCC compte les rangées jusqu\'à R4', c.vcc), '',
      B('Générateur MA', 'MA = début de rangée + HCC', h4(ma)), 'MA/RA', B('Gate Array', 'adresse RAM de 2 octets', h4(c.videoAddress), c.displayEnabled)])}
    ${sec('Trame et faisceau <span class="cv-m">(échelle : 1 caractère en largeur, 1 ligne raster en hauteur)</span>', frameDiagram(c))}
    ${cols(sec('Registres R0–R17 <span class="cv-m">(sélectionné : R' + c.selected + ')</span>', table),
      sec('Compteurs et adresse vidéo', pins([['HSYNC', c.hsync, 'synchro horizontale'], ['VSYNC', c.vsync, 'synchro verticale'], ['DISPEN', c.displayEnabled, 'zone affichée']])
        + kv([['HCC (caractère)', `${c.hcc} / ${R[0]}`], ['VLC (ligne raster RA)', `${c.vlc} / ${R[9]}`], ['VCC (rangée)', `${c.vcc} / ${R[4]}`], ['MA début de rangée', h4(c.rowStart)], ['MA courant', h4(ma)], ['Trames', num(c.frame)]])
        + `<div class="cv-formula">adresse = MA13–12 × &amp;4000 + RA × &amp;800 + MA9–0 × 2<br>= ${h4(page)} + ${c.vlc & 7} × &amp;800 (${h4(ra)}) + ${ma & 0x3FF} × 2 (${h4(off)}) = <b>${h4(c.videoAddress)}</b></div>`))}`;
}

const PB_LBL = ['VSYNC', 'Distr. 0', 'Distr. 1', 'Distr. 2', '50 Hz', '/EXP', 'BUSY', 'K7 lect.'];
const PC_LBL = ['Ligne 0', 'Ligne 1', 'Ligne 2', 'Ligne 3', 'Moteur K7', 'Écrit. K7', 'BC1', 'BDIR'];
const PSG_FN = ['inactif', 'lecture du registre', 'écriture dans le registre', 'sélection du registre'];

function viewPPI(m, step, b) {
  const p = m.ppi, ctl = p.control, aIn = !!(ctl & 0x10), cuIn = !!(ctl & 0x08), bIn = !!(ctl & 0x02), clIn = !!(ctl & 0x01);
  const fn = (p.c >> 6) & 3, bVal = 0x3E | (m.crtc.vsync ? 1 : 0);
  const aVal = aIn ? (fn === 1 ? m.psg.readRegister(m.psg.selected) : 0xFF) : p.a;
  let msg = '', hot = -1;
  if (isPPI(b)) {
    const f = (b.addr >> 8) & 3;
    hot = f;
    const name = ['port A', 'port B', 'port C', 'registre de contrôle'][f];
    if (f === 3 && b.wr && b.data != null && !(b.data & 0x80)) msg = `OUT ${h4(b.addr)}, ${h2(b.data)} — bit ${(b.data >> 1) & 7} du port C mis à ${b.data & 1}`;
    else msg = `${b.rd ? 'IN' : 'OUT'} ${h4(b.addr)}${b.data != null ? (b.rd ? ' → ' : ', ') + h2(b.data) : ''} — ${b.rd ? 'lecture' : 'écriture'} du ${name}`;
  }
  const port = (i, title, v, labels, dir, extra) => `<div class="cv-port${hot === i ? ' cv-hot' : ''}"><div class="cv-lbl">${title} = ${h2(v)}</div>${bits(v, labels, { dir })}${extra || ''}</div>`;
  return `${msg ? live(msg) : ''}
    ${flow([B('Bus Z80', 'D0–D7, /IORQ, A11 = 0 choisit le PPI', 'ports &F4xx–&F7xx', hot >= 0), 'A8 A9', B('Logique de lecture/écriture', 'A8–A9 choisissent A, B, C ou le contrôle', ['A', 'B', 'C', 'contrôle'][hot] ?? '—', hot >= 0), '',
      B('Port A', 'données du PSG', aIn ? 'entrée' : 'sortie', hot === 0), B('Port B', 'VSYNC, cavaliers, BUSY', 'entrée', hot === 1), B('Port C', 'ligne clavier, cassette, commande PSG', 'sortie', hot === 2)])}
    ${sec(`Mot de contrôle ${h2(ctl)} = %${bin(ctl)}`, kv([['Groupe A', `mode ${(ctl >> 5) & 3}, port A en ${aIn ? 'entrée' : 'sortie'}, PC4–PC7 en ${cuIn ? 'entrée' : 'sortie'}`], ['Groupe B', `mode ${(ctl >> 2) & 1}, port B en ${bIn ? 'entrée' : 'sortie'}, PC0–PC3 en ${clIn ? 'entrée' : 'sortie'}`]]) + note('E : entrée, S : sortie. Une écriture sur &F7xx avec le bit 7 à 0 met un seul bit du port C à 0 ou à 1.'))}
    ${port(0, 'Port A (&amp;F4xx) — bus de données du PSG', aVal, ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7'], aIn ? 'in' : 'out', note(aIn ? `En entrée : le PPI lit le PSG (${fn === 1 ? `registre R${m.psg.selected}` : 'PSG inactif, &FF'}).` : 'En sortie : valeur envoyée au PSG (numéro ou contenu de registre).'))}
    ${port(1, 'Port B (&amp;F5xx)', bVal, PB_LBL, bIn ? 'in' : 'out', kv([['VSYNC (bit 0)', m.crtc.vsync ? '1 : synchro verticale en cours' : '0'], ['Distributeur (bits 1–3)', `${(bVal >> 1) & 7} : Amstrad`], ['Fréquence (bit 4)', bVal & 0x10 ? '1 : 50 Hz' : '0 : 60 Hz'], ['/EXP (bit 5)', bVal & 0x20 ? "1 : pas d'extension" : '0 : extension'], ['BUSY (bit 6)', bVal & 0x40 ? '1 : imprimante occupée' : '0 : imprimante prête'], ['Cassette (bit 7)', 'lecture K7 : ' + (bVal >> 7)]]))}
    ${port(2, 'Port C (&amp;F6xx)', p.c, PC_LBL, [0, 1, 2, 3].map(() => clIn ? 'in' : 'out').concat([0, 1, 2, 3].map(() => cuIn ? 'in' : 'out')),
      kv([['Ligne clavier (bits 0–3)', `${p.c & 15}${(p.c & 15) > 9 ? ' (aucune ligne)' : ''} → 74LS145`], ['Moteur cassette (bit 4)', p.c & 0x10 ? 'en marche' : 'arrêté'], ['Écriture cassette (bit 5)', (p.c >> 5) & 1], ['Fonction PSG (BDIR, BC1)', `${(p.c >> 7) & 1}${(p.c >> 6) & 1} : ${PSG_FN[fn]}`, fn !== 0]]))}`;
}

const NOTES = ['do', 'do♯', 'ré', 'ré♯', 'mi', 'fa', 'fa♯', 'sol', 'sol♯', 'la', 'la♯', 'si'];
function noteOf(f) {
  if (!(f >= 16 && f <= 20000)) return f > 20000 ? 'inaudible (ultrason)' : 'trop grave';
  const n = 69 + 12 * Math.log2(f / 440), r = Math.round(n), ct = Math.round((n - r) * 100);
  return `${NOTES[((r % 12) + 12) % 12]}${Math.floor(r / 12) - 2}${ct ? ` (${ct > 0 ? '+' : ''}${ct} cents)` : ''}`;
}
const PSG_REGS = ['Période A (fine)', 'Période A (grossière)', 'Période B (fine)', 'Période B (grossière)', 'Période C (fine)', 'Période C (grossière)', 'Période du bruit', 'Mélangeur, sens des ports',
  'Volume A', 'Volume B', 'Volume C', 'Période enveloppe (fine)', 'Période enveloppe (grossière)', "Forme d'enveloppe", 'Port A (clavier)', 'Port B (absent du 8912)'];
const ENV_NAME = s => !(s & 8) ? (s & 4 ? '/___ montée puis silence' : '\\___ descente puis silence')
  : ['\\\\\\\\ dents de scie descendantes', '\\___ descente puis silence', '\\/\\/ triangle', '\\‾‾‾ descente puis maintien haut', '//// dents de scie montantes', '/‾‾‾ montée puis maintien', '/\\/\\ triangle', '/___ montée puis silence'][s & 7];

// courbe d'enveloppe : même automate que le PSG (16 niveaux par période)
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
    <path d="${d}" class="cv-wave cv-hotw"/><text x="0" y="${H + 14}" class="cv-t cv-tm">3 périodes de 16 pas ; trait pointillé : niveau courant ${level}</text></svg>`;
}

function viewPSG(m, step, b) {
  const p = m.psg, r = p.regs, lv = p.levels(), line = m.ppi.c & 15, portA = p.readRegister(14), fn = (m.ppi.c >> 6) & 3;
  const keyNames = [...Array(8)].map((_, bit) => keyLabel(m, NAME_OF[line * 8 + bit]) || '—');
  const voices = lv.voices.map((v, c) => {
    const tp = (r[2 * c] | (r[2 * c + 1] << 8)) || 1, on = v.tone || v.noise;
    return `<div class="cv-voice${on && v.volume ? ' cv-hot' : ''}"><b>Voix ${'ABC'[c]}</b>
      ${kv([['Période TP', `${tp} (R${2 * c + 1}:R${2 * c} = ${h2(r[2 * c + 1])} ${h2(r[2 * c])})`], ['Fréquence', `1 MHz ÷ (16 × ${tp}) = ${hz(v.freq)}`], ['Note approchée', noteOf(v.freq)], ['Mélangeur', `${v.tone ? 'tonalité' : ''}${v.tone && v.noise ? ' + ' : ''}${v.noise ? 'bruit' : ''}${on ? '' : 'muette'}`]])}
      ${bar(v.volume, 15, v.env ? `enveloppe (niveau ${v.volume})` : `volume ${v.volume} / 15`, v.env ? 'cv-warm' : '')}</div>`;
  }).join('');
  const hot = isPPI(b) || fn !== 0;
  const table = `<table class="cv-tab"><tr><th>Reg.</th><th>Rôle</th><th>Valeur</th></tr>${PSG_REGS.map((n, i) => `<tr class="${i === p.selected ? 'cv-sel' : ''}"><td>R${i}</td><td>${n}</td><td class="cv-v">${h2(r[i])}</td></tr>`).join('')}</table>`;
  return `${isPPI(b) || fn ? live(`PPI port C : BDIR = ${(m.ppi.c >> 7) & 1}, BC1 = ${(m.ppi.c >> 6) & 1} → ${PSG_FN[fn]} (registre R${p.selected}), données sur le port A ${h2(m.ppi.a)}`) : ''}
    ${flow([B('Bus du PSG', 'relié au port A du PPI, commandé par BDIR/BC1', PSG_FN[fn], hot), '', B('Registres', '16 registres, sélection puis écriture', 'R' + p.selected, hot), '', B('Tonalités A B C', 'compteurs 12 bits ÷ TP', lv.voices.map(v => Math.round(v.freq)).join(' / ') + ' Hz'),
      B('Bruit', 'LFSR 17 bits ÷ NP', hz(lv.noiseFreq)), '', B('Mélangeur R7', 'choisit tonalité et/ou bruit par voix', h2(r[7])), '', B('Volumes', '16 niveaux logarithmiques ou enveloppe', lv.voices.map(v => v.volume).join(' ')), '', B('CNA × 3', 'sorties analogiques A, B, C', '→ ampli')])}
    <div class="cv-voices">${voices}</div>
    ${cols(sec('Registres R0–R15 <span class="cv-m">(sélectionné : R' + p.selected + ')</span>', table),
      stack(sec('Mélangeur R7', bits(r[7], ['Ton A', 'Ton B', 'Ton C', 'Bruit A', 'Bruit B', 'Bruit C', 'Port A', 'Port B']) + note('Bit à 0 = source active. Bit 6 à 0 : port A en entrée (lecture du clavier).'))
      + sec(`Enveloppe R13 = ${r[13]} : ${esc(ENV_NAME(r[13]))}`, bits(r[13], ['HOLD', 'ALT', 'ATT', 'CONT'], { n: 4 }) + envSvg(r[13], p.envLevel)
        + kv([['Période EP (R12:R11)', `${lv.envPeriod} → un pas tous les ${num(16 * (lv.envPeriod || 1))} µs`], ['Durée d\'une rampe', `${num(256 * (lv.envPeriod || 1) / 1000, 2)} ms (${hz(lv.envFreq)})`], ['Niveau courant', p.envLevel]]))
      + sec('Bruit et port A', kv([['Période du bruit NP (R6)', `${r[6] & 31} → ${hz(lv.noiseFreq)}`], ['Ligne clavier (PPI PC0–PC3)', line], ['Colonnes lues (R14)', `${h2(portA)} = %${bin(portA)}`]])
        + bits(portA, keyNames) + note('Bit à 0 = touche enfoncée sur la ligne choisie par le PPI.'))))}`;
}

const MSR_LBL = ['D0B', 'D1B', 'D2B', 'D3B', 'CB', 'EXM', 'DIO', 'RQM'];
const MSR_TXT = ['lecteur A en recherche', 'lecteur B en recherche', 'lecteur 2 en recherche', 'lecteur 3 en recherche', 'contrôleur occupé (commande en cours)', 'phase d\'exécution (hors DMA)', 'sens : 1 = du FDC vers le Z80', 'prêt pour un échange d\'octet'];
const ST_BITS = {
  ST0: ['US0', 'US1', 'HD', 'NR', 'EC', 'SE', 'IC0', 'IC1'], ST1: ['MA', 'NW', 'ND', '—', 'OR', 'DE', '—', 'EN'],
  ST2: ['MD', 'BC', 'SN', 'SH', 'WC', 'DD', 'CM', '—'], ST3: ['US0', 'US1', 'HD', 'TS', 'T0', 'RY', 'WP', 'FT'],
};
const ST_TXT = { NR: 'lecteur non prêt', EC: 'piste 0 introuvable', SE: 'fin de recherche', MA: "marque d'adresse absente", NW: 'disque protégé', ND: 'secteur introuvable', OR: 'débordement', DE: 'erreur de CRC',
  EN: 'fin de cylindre', MD: 'marque de données absente', BC: 'mauvais cylindre', SN: 'scan non satisfait', SH: 'scan égal', WC: 'cylindre erroné', DD: 'CRC des données', CM: 'marque effacée',
  WP: 'protégé en écriture', RY: 'prêt', T0: 'tête en piste 0', TS: 'double face', FT: 'défaut' };
const IC_TXT = ['fin normale', 'fin anormale', 'commande invalide', 'abandon (lecteur)'];

function cmdParams(op, len) {
  if (len === 9) return ['commande', 'HD·US', 'C', 'H', 'R', 'N', 'EOT', 'GPL', 'DTL'];
  if (op === 0x0D) return ['commande', 'HD·US', 'N', 'SC', 'GPL', 'D'];
  if (op === 0x0F) return ['commande', 'HD·US', 'NCN'];
  if (op === 0x03) return ['commande', 'SRT·HUT', 'HLT·ND'];
  return ['commande', 'HD·US'];
}
function resultLabels(op, len, sameCmd) {
  if (len === 7) return ['ST0', 'ST1', 'ST2', 'C', 'H', 'R', 'N'];
  if (len === 2) return ['ST0', 'PCN'];
  return [sameCmd && op === 0x04 ? 'ST3' : 'ST0'];
}
function stDecode(name, v) {
  const set = ST_BITS[name].filter((n, i) => (v >> i) & 1 && ST_TXT[n]).map(n => ST_TXT[n]);
  if (name === 'ST0') set.unshift(IC_TXT[v >> 6], `lecteur ${v & 3}, tête ${(v >> 2) & 1}`);
  return `<div class="cv-st"><div class="cv-lbl">${name} = ${h2(v)}</div>${bits(v, ST_BITS[name])}<div class="cv-m">${set.join(' · ') || 'aucun indicateur'}</div></div>`;
}

function viewFDC(m, step, b) {
  const f = m.fdc, a = f.activity, ex = f.exec;
  // registre d'état principal recalculé ici (même règle que readStatus, sans passer par le port)
  let msr = 0x80;
  if (f.phase === 'command') msr |= 0x10;
  else if (f.phase === 'exec') msr |= 0x30 | (ex && ex.read ? 0x40 : 0);
  else if (f.phase === 'result') msr |= 0x50;
  for (const p of f.pending) msr |= 1 << p.drive;
  let msg = '';
  if (isFDC(b)) {
    if (!(b.addr & 0x0100)) msg = `OUT ${h4(b.addr)}, ${dataTxt(b)} — moteur des lecteurs ${b.data != null ? (b.data & 1 ? 'en marche' : 'arrêté') : ''}`;
    else if (b.addr & 1) msg = `${b.rd ? 'IN' : 'OUT'} ${h4(b.addr)}${b.data != null ? (b.rd ? ' → ' : ', ') + h2(b.data) : ''} — registre de données (phase ${a.phase})`;
    else msg = `IN ${h4(b.addr)} — lecture du registre d'état principal (MSR = ${h2(msr)})`;
  }
  const phases = ['idle', 'command', 'exec', 'result'].map(ph => `<span class="cv-ph${f.phase === ph ? ' cv-on' : ''}">${{ idle: 'repos', command: 'commande', exec: 'exécution', result: 'résultat' }[ph]}</span>`).join('<i>→</i>');
  const cmdLbl = cmdParams(f.op, f.cmdLen || f.cmd.length);
  const cmdBytes = f.cmd.length ? `<div class="cv-bytes">${f.cmd.map((v, i) => `<div><b>${hex(v)}</b><span>${cmdLbl[i] ?? '?'}</span></div>`).join('')}${f.phase === 'command' ? [...Array(Math.max(0, f.cmdLen - f.cmd.length))].map((_, i) => `<div class="cv-dim"><b>··</b><span>${cmdLbl[f.cmd.length + i] ?? '?'}</span></div>`).join('') : ''}</div>` : note('Aucune commande reçue depuis la remise à zéro.');
  const sameCmd = f.phase === 'result' || f.phase === 'idle';
  const res = f.result || [], rl = resultLabels(f.op, res.length, sameCmd);
  const resBytes = res.length ? `<div class="cv-bytes">${res.map((v, i) => `<div class="${f.phase === 'result' && i < f.resultPos ? 'cv-dim' : f.phase === 'result' && i === f.resultPos ? 'cv-hot' : ''}"><b>${hex(v)}</b><span>${rl[i] ?? '?'}</span></div>`).join('')}</div>`
    + rl.map((n, i) => ST_BITS[n] ? stDecode(n, res[i]) : '').join('') : note('Aucun résultat.');
  let progress = '';
  if (f.phase === 'exec' && ex) {
    if (ex.read && ex.data) progress = bar(ex.pos, ex.data.length, `lecture : ${num(ex.pos)} / ${num(ex.data.length)} octets`, 'cv-warm');
    else if (ex.format) progress = bar(ex.ids.length, 4 * ex.SC, `formatage : ${ex.ids.length / 4 | 0} / ${ex.SC} ID de secteur`, 'cv-warm');
    else if (ex.buf) progress = bar(ex.pos, ex.buf.length, `écriture : ${num(ex.pos)} / ${num(ex.buf.length)} octets du secteur ${h2(ex.r)}`, 'cv-warm');
  }
  const d = a.drive & 1, dr = f.drives[d], disk = dr.disk, side = disk && disk.sides > 1 ? a.side & 1 : 0;
  const trk = disk ? disk.tracks[side]?.[dr.track] : null, secs = trk?.sectors || [];
  const nextIdx = secs.length ? dr.index % secs.length : -1;
  const sectorMap = !disk ? note(`Lecteur ${'AB'[d]} vide.`) : !secs.length ? note(`Piste ${dr.track} non formatée.`)
    : `<div class="cv-sectors">${secs.map((s, i) => `<div class="${s.R === a.sector ? 'cv-hot' : ''}${i === nextIdx ? ' cv-next' : ''}"><b>${hex(s.R)}</b><span>C${s.C} H${s.H} N${s.N}</span><span>${num(0x80 << Math.min(s.N, 8))} o</span></div>`).join('')}</div>`
      + note(`Encadré jaune : secteur en cours (${a.sector != null ? h2(a.sector) : 'aucun'}) ; pointillé : prochain ID sous la tête (READ ID). Remplissage ${h2(trk.filler ?? 0xE5)}, GAP3 ${trk.gap3 ?? '—'}.`);
  const driveRow = i => { const x = f.drives[i]; return [`Lecteur ${'AB'[i]}`, `${x.disk ? `${esc(x.disk.name || 'disque')} · ${x.disk.sides} face(s)${x.disk.writeProtected ? ' · protégé' : ''}` : 'vide'} · piste ${x.track}`, i === d]; };
  return `${msg ? live(msg) : ''}
    ${flow([B('Bus Z80', '&FB7E : MSR, &FB7F : données, &FA7E : moteur', h2(msr), isFDC(b)), '', B('Registres', 'MSR, données, ST0–ST3', f.phase === 'result' ? 'résultat' : '—', f.phase === 'result'), '', B('Séquenceur', 'décode la commande et la déroule', a.command || '—', f.phase !== 'idle'), '',
      B('Séparateur de données', 'MFM, recherche des ID C H R N', a.sector != null ? 'secteur ' + h2(a.sector) : '—', a.reading || a.writing), 'STEP DIR', B(`Lecteur ${'AB'[d]}`, 'tête, moteur, index', `piste ${dr.track}`, f.motor)])}
    <div class="cv-phases">${phases}</div>${progress}
    ${cols(sec(`Registre d'état principal MSR = ${h2(msr)}`, bits(msr, MSR_LBL, { title: MSR_TXT }) + `<ul class="cv-list">${MSR_LBL.map((n, i) => (msr >> i) & 1 ? `<li><b>${n}</b> ${MSR_TXT[i]}</li>` : '').join('')}</ul>`),
      sec('Lecteurs', kv([['Moteur', f.motor ? 'en marche' : 'arrêté', f.motor], driveRow(0), driveRow(1), ['Interruptions en attente', f.pending.length ? f.pending.map(p => `lecteur ${'AB'[p.drive & 1]} (ST0 ${h2(p.st0)}, piste ${p.pcn})`).join(', ') : 'aucune']])))}
    ${cols(sec(`Dernière commande : ${a.command || '—'}`, cmdBytes), sec('Résultat', resBytes))}
    ${sec(`Piste ${dr.track} du lecteur ${'AB'[d]}, face ${side} : ${secs.length} secteur(s)`, sectorMap)}`;
}

// schéma : les 4 quarts de l'espace Z80 et les 8 banques de 16 Ko de la RAM
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
      <text x="18" y="${qy(i) + 34}" class="cv-t cv-tm">banque ${banks[i]}${rom ? (i === 0 ? ' · lecture : ROM OS' : ` · lecture : ROM ${m.romSelect}`) : ''}</text>`;
  });
  for (let j = 0; j < 8; j++) {
    const on = acc && acc.bank === j, mine = own.includes(j);
    s += `<rect x="370" y="${by(j)}" width="180" height="23" rx="3" class="cv-box${mine ? '' : ' cv-dim'}${on ? ' cv-on' : ''}${j === screen ? ' cv-scr' : ''}"/>
      <text x="378" y="${by(j) + 16}" class="cv-t">banque ${j} · ${h5(j * 0x4000)}${j === screen ? ' · écran' : ''}</text>`;
  }
  return s + `<text x="10" y="230" class="cv-t cv-tm">espace du Z80 (64 Ko)</text><text x="370" y="230" class="cv-t cv-tm">RAM physique (128 Ko)</text></svg>`;
}

// mini-image de la mémoire écran : une case par caractère, intensité = pixels allumés
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

// occupation des banques : 16 cases de 1 Ko par banque, part d'octets non nuls
function densityGrid(m, own) {
  return `<div class="cv-dens">${own.map(bk => {
    let cells = '';
    for (let k = 0; k < 16; k++) {
      let n = 0;
      const o = bk * 0x4000 + k * 1024;
      for (let i = 0; i < 1024; i++) if (m.ram[o + i]) n++;
      cells += `<i style="opacity:${(0.12 + 0.88 * n / 1024).toFixed(2)}" title="${hex(o, 5)} : ${n} octets non nuls"></i>`;
    }
    return `<div><span>banque ${bk}</span>${cells}</div>`;
  }).join('')}</div>`;
}

function viewRAM(m, step, b, own) {
  const banks = m.bank.map(x => x >> 14), screen = (m.crtc.regs[12] >> 4) & 3;
  let acc = null, msg = '';
  const pc = m.cpu.getRegs().PC;
  if (b && b.mem) {
    const q = b.addr >> 14, chip = m.chipAt(b.addr), rom = b.rd && chip.startsWith('ROM');
    acc = { q, bank: banks[q], phys: m.bank[q] | (b.addr & 0x3FFF), rom };
    msg = own.includes(banks[q]) ? `${accTxt(b)} : quart ${q} → banque ${banks[q]}, adresse physique ${h5(acc.phys)}${rom ? ` (lecture servie par la ${chip}, la RAM est ignorée)` : ''}` : '';
    if (!own.includes(banks[q])) acc = { q, bank: banks[q], phys: acc.phys, other: true };
  }
  const focusZ80 = acc ? b.addr : pc, q = focusZ80 >> 14;
  let phys = m.bank[q] | (focusZ80 & 0x3FFF);
  if (!own.includes(phys >> 14)) { const vis = banks.find(x => own.includes(x)); phys = (vis ?? own[0]) * 0x4000; }
  const screenBase = screen * 0x4000;
  return `${msg ? live(msg) : ''}
    ${flow([B('Bus Z80', 'A0–A15, /MREQ, /RD, /WR', acc ? h4(b.addr) : '—', !!acc && !acc.other), 'A14 A15', B('PAL 40030', 'choisit la banque de 16 Ko du quart', 'C' + (m.ga.ramConfig & 7), !!acc), '/CAS', B('Multiplexeur d\'adresses', 'ligne (/RAS) puis colonne (/CAS)', acc ? h5(acc.phys) : '—', !!acc && !acc.other),
      '', B(`DRAM ${own[0]}–${own[3]}`, '8 boîtiers 4164 : 1 bit chacun × 64 Ki', acc && !acc.other && b.data != null ? h2(b.data) : '—', !!acc && !acc.other), '', B('Gate Array', 'lit 2 octets d\'écran par µs (banques 0–3)', h4(m.crtc.videoAddress), own.includes(screen))])}
    ${cols(sec('Banques visibles par le Z80', bankSvg(m, own, acc) + note(`Configuration C${m.ga.ramConfig & 7} : ${RAM_USE[m.ga.ramConfig & 7]}. Zone écran : banque ${screen} (R12 = ${h2(m.crtc.regs[12])}), toujours lue dans les 64 Ko de base.`), 'cv-wide'),
      own.includes(screen) ? sec(`Image de la mémoire écran <span class="cv-m">(${h5(screenBase)}–${h5(screenBase + 0x3FFF)}, une case par caractère)</span>`, screenSvg(m)) : '')}
    ${cols(sec(`Mémoire autour de ${h5(phys)} <span class="cv-m">(adresses physiques${acc ? ', accès en cours' : ', PC = ' + h4(pc)})</span>`, hexdump(a => m.ram[a], acc && !acc.other ? acc.phys : phys, { lo: own[0] * 0x4000, hi: own[3] * 0x4000 + 0x3FFF, label: h5, lines: 8, mark: b && b.wr ? 'cv-hx-wr' : null }), 'cv-wide'),
      sec('Occupation (octets non nuls par Ko)', densityGrid(m, own)))}`;
}

// en-tête d'une ROM d'extension : type, marque, version, modification, table des noms
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
  const tName = { 0: 'premier plan (programme)', 1: 'arrière-plan (extension)', 2: 'extension', 0x80: 'intégrée (BASIC de la carte)' }[type] ?? 'inconnu';
  return kv([['&C000 type', `${h2(type)} — ${tName}`], ['&C001–&C003 marque · version · modif.', `${rom[1]} · ${rom[2]} · ${rom[3]}`], ['&C004 table des noms', h4(ptr)], ['Noms (commandes)', names.length ? names.map(n => esc(n)).join(', ') : '—']]);
}

function romView(m, step, b, parts, title) {
  const ga = m.ga, pc = m.cpu.getRegs().PC;
  let focus = null, msg = '';
  if (b && b.mem && b.rd) {
    const chip = romChip(m, b.addr), part = parts.find(p => p.chip === chip);
    if (part) { focus = { part, addr: b.addr }; msg = `${accTxt(b)} : ${chip}, octet ${h4(b.addr & 0x3FFF)} du boîtier`; }
  } else if (b && b.mem && b.wr && parts.some(p => p.chip === romChip(m, b.addr))) msg = `écriture ${h4(b.addr)} : la ROM l'ignore, l'octet part en RAM (banque ${m.bank[b.addr >> 14] >> 14})`;
  if (isROMSEL(b) && b.data != null) msg = `OUT ${h4(b.addr)}, ${h2(b.data)} — sélection de la ROM haute ${b.data} (${b.data === 7 ? 'AMSDOS' : 'BASIC'})`;
  if (!focus) { const part = parts.find(p => p.chip === romChip(m, pc)); if (part) focus = { part, addr: pc }; }
  const shown = focus?.part ?? parts[parts.length - 1], fAddr = focus ? focus.addr : shown.base;
  const onBus = !!(focus && b && b.mem && focus.addr === b.addr);
  return `${msg ? live(msg) : ''}
    ${flow([B('Bus Z80', 'A0–A15, /RD', onBus ? h4(b.addr) : '—', onBus), 'A14 A15', B('Gate Array', '/ROMEN si ROM visible dans ce quart', `basse ${ga.lowerRom ? 'oui' : 'non'} · haute ${ga.upperRom ? 'oui' : 'non'}`, onBus), '',
      B('Verrou &DFxx', 'numéro de ROM haute', m.romSelect, isROMSEL(b)), '/CE', ...parts.map(p => B(p.name, p.role, p.visible ? 'visible' : 'masquée', onBus && focus.part === p)), 'D0–D7', B('Bus de données', 'octet lu', onBus && b.data != null ? h2(b.data) : '—', onBus)])}
    ${cols(sec(title, kv(parts.map(p => [p.name, `${p.visible ? 'visible' : 'masquée'} en ${h4(p.base)}–${h4(p.base + 0x3FFF)}${p.why ? ' · ' + p.why : ''}`, p.visible]).concat([['ROM haute sélectionnée', `${m.romSelect} (${m.romSelect === 7 ? 'AMSDOS' : 'BASIC'} ; tout autre numéro que 7 donne le BASIC)`]]))
      + note('Les lectures dans un quart couvert par une ROM visible vont à la ROM ; les écritures vont toujours en RAM.')),
      ...parts.filter(p => p.header).map(p => sec(`En-tête de ${p.name}`, romHeader(p.data))))}
    ${sec(`${shown.name} autour de ${h4(fAddr)} <span class="cv-m">(${onBus ? 'accès en cours' : focus ? 'PC' : 'début'})</span>`, hexdump(a => shown.data[a - shown.base], fAddr, { lo: shown.base, hi: shown.base + 0x3FFF, lines: 8 }))}`;
}

function viewROM(m, step, b) {
  const ga = m.ga;
  return romView(m, step, b, [
    { chip: 'ROM OS', name: 'ROM OS', role: 'firmware, vecteurs &BBxx', data: m.os, base: 0x0000, visible: ga.lowerRom },
    { chip: 'ROM BASIC', name: 'ROM BASIC', role: 'Locomotive BASIC 1.1 (ROM 0)', data: m.basic, base: 0xC000, visible: ga.upperRom && m.romSelect !== 7, why: m.romSelect === 7 ? 'ROM 7 sélectionnée à sa place' : '', header: true },
  ], 'ROM interne 32 Ko : deux moitiés de 16 Ko');
}
function viewAMSDOS(m, step, b) {
  return romView(m, step, b, [
    { chip: 'ROM AMSDOS', name: 'ROM AMSDOS', role: 'ROM haute 7 : DOS et pilote du FDC', data: m.amsdos, base: 0xC000, visible: m.ga.upperRom && m.romSelect === 7, why: m.romSelect === 7 ? '' : `ROM ${m.romSelect} sélectionnée`, header: true },
  ], 'ROM d\'extension AMSDOS');
}

function viewPAL(m, step, b) {
  const cur = m.ga.ramConfig & 7;
  let next = -1, msg = '', q = -1;
  if (gaPort(b) && b.wr && b.data != null && b.data >> 6 === 3) { next = b.data & 7; msg = `OUT ${h4(b.addr)}, ${h2(b.data)} — le PAL passe en configuration C${next}`; }
  else if (b && b.mem) { q = b.addr >> 14; msg = `${accTxt(b)} : A15 A14 = ${q >> 1}${q & 1} → quart ${q} → banque ${m.bank[q] >> 14}`; }
  const rows = RAM_CONFIG.map((cfg, i) => `<tr class="${i === cur ? 'cv-sel' : ''}${i === next ? ' cv-hot' : ''}"><td>C${i}</td>${cfg.map((bk, j) => `<td class="${i === cur && j === q ? 'cv-hotc' : ''}${bk > 3 ? ' cv-ext' : ''}">${bk}</td>`).join('')}<td class="cv-m">${RAM_USE[i]}</td></tr>`).join('');
  return `${msg ? live(msg) : ''}
    ${flow([B('Bus Z80', 'OUT &7Fxx avec %11xxxccc', `${h2(0xC0 | cur)}`, next >= 0), '', B('Verrou de configuration', '3 bits ccc (bits 3–5 : extensions 512 Ko, ignorés)', `C${cur} · ${h2(m.ga.ramConfig)}`, next >= 0), '', B('Table des banques', 'A14–A15 → numéro de banque', m.bank.map(x => x >> 14).join(' '), q >= 0), '', B('/CAS des DRAM', 'valide la rangée 0–3 ou 4–7', q >= 0 ? `banque ${m.bank[q] >> 14}` : '—', q >= 0)])}
    ${sec('Les 8 configurations RAM <span class="cv-m">(ligne surlignée : configuration active ; banques 4–7 en violet = 64 Ko étendus)</span>',
      `<table class="cv-tab cv-pal"><tr><th>Conf.</th><th>&amp;0000</th><th>&amp;4000</th><th>&amp;8000</th><th>&amp;C000</th><th>Usage</th></tr>${rows}</table>`)}
    ${note('La vidéo lit toujours la RAM de base (banques 0–3), quelle que soit la configuration.')}`;
}

const NAME_OF = Object.fromEntries(Object.entries(KEYS).map(([n, [l, bit]]) => [l * 8 + bit, n]));
const SPECIAL = { CUR_UP: '↑', CUR_DOWN: '↓', CUR_LEFT: '←', CUR_RIGHT: '→', SPACE: 'ESPACE', CONTROL: 'CTRL', CAPS: 'CAPS', JOY_UP: 'Joy ↑', JOY_DOWN: 'Joy ↓', JOY_LEFT: 'Joy ←', JOY_RIGHT: 'Joy →', JOY_FIRE1: 'Feu 1', JOY_FIRE2: 'Feu 2', RETURN: 'RETURN', ENTER: 'ENTER' };
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
    return `<div class="cv-out${on ? ' cv-hot' : ''}"><b>${on ? 0 : 1}</b><span>sortie ${i}</span><span class="cv-m">${keys}</span></div>`;
  }).join('');
  return `${flow([B('PPI port C', 'bits PC0–PC3', `${line} = %${bin(line, 4)}`, true), 'D C B A', B('74LS145', 'décodeur BCD → 10 sorties à collecteur ouvert', line < 10 ? `sortie ${line} à 0` : 'aucune sortie', line < 10), '0–9', B('Matrice clavier', 'la ligne à 0 est lue par le PSG', line < 10 ? `ligne ${line}` : '—', line < 10)])}
    ${cols(sec('Entrée BCD', bits(line, ['A (PC0)', 'B (PC1)', 'C (PC2)', 'D (PC3)'], { n: 4, dir: 'in' }) + note(line < 10 ? `Valeur ${line} : seule la sortie ${line} passe à 0 et alimente la ligne ${line} du clavier.` : `Valeur ${line} > 9 : toutes les sorties restent à 1, aucune ligne n'est lue.`)),
      sec('Sorties (une seule à 0)', `<div class="cv-outs">${outs}</div>`))}`;
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
  return `${flow([B('74LS145', 'met une ligne à 0', line < 10 ? `ligne ${line}` : 'aucune', line < 10), 'ligne', B('Matrice 10 × 8', 'une touche enfoncée relie sa ligne à sa colonne', down.length ? `${down.length} touche(s)` : 'aucune'), 'colonnes', B('PSG port A', 'lit les 8 colonnes (0 = enfoncée)', h2(line < 10 ? mx[line] : 0xFF), line < 10)])}
    ${sec('Matrice en direct <span class="cv-m">(ligne surlignée : ligne lue en ce moment ; case jaune : touche enfoncée)</span>',
      `<table class="cv-tab cv-kbd"><tr><th>Ligne</th>${[...Array(8)].map((_, i) => `<th>bit ${i}</th>`).join('')}<th>Valeur</th></tr>${rows}</table>`)}
    ${kv([['Touches enfoncées', down.length ? down.map(esc).join(', ') : 'aucune'], ['Frappe automatique', m.keyboard.typing ? `en cours (${m.keyboard.queue.length} caractère(s) en attente)` : 'non']])}`;
}

function viewPRN(m, step, b) {
  let latch = null, src = '';
  if (isPRN(b) && b.data != null) { latch = b.data; src = 'accès en cours'; }
  else { const e = [...m.io].reverse().find(x => x.dir === 'out' && !(x.port & 0x1000)); if (e) { latch = e.value; src = `dernière écriture (port ${h4(e.port)})`; } }
  const v = latch ?? 0, text = m.printer.text, tail = text.slice(-160);
  const shown = [...tail].map(ch => ch === '\r' ? '<span class="cv-ctl">CR</span>' : ch === '\n' ? '<span class="cv-ctl">LF</span>\n' : ch.charCodeAt(0) < 32 ? `<span class="cv-ctl">${hex(ch.charCodeAt(0))}</span>` : esc(ch)).join('');
  return `${isPRN(b) ? live(`OUT ${h4(b.addr)}, ${dataTxt(b)} — le verrou mémorise D0–D6 et /STROBE (bit 7)`) : ''}
    ${flow([B('Bus Z80', 'OUT &EFxx (A12 = 0)', latch != null ? h2(latch) : '—', isPRN(b)), 'D0–D7', B('Verrou 74LS273', '8 bascules chargées à chaque OUT', latch != null ? h2(latch) : '—', isPRN(b)), 'D0–D6 · /STROBE', B('Connecteur Centronics', 'données + impulsion de validation', m.printer.strobe ? 'STROBE 1' : 'STROBE 0'), 'BUSY → PPI B6', B('Imprimante', 'prend l\'octet sur le front de /STROBE', `${num(text.length)} car.`)])}
    ${cols(sec(`Verrou ${latch != null ? `= ${h2(v)}` : '(aucune écriture)'} <span class="cv-m">${src}</span>`, bits(latch, ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'STROBE'], { hot: isPRN(b) ? [7] : null })
      + kv([['Caractère D0–D6', latch != null ? `${h2(v & 0x7F)} ${(v & 0x7F) >= 32 ? '« ' + esc(m.charset[v & 0x7F] ?? String.fromCharCode(v & 0x7F)) + ' »' : '(contrôle)'}` : '—'], ['/STROBE mémorisé', m.printer.strobe ? '1' : '0'], ['BUSY (PPI port B bit 6)', '0 : imprimante toujours prête']])
      + note('Le CPC n\'a que 7 bits de données : le bit 7 du port sert de signal /STROBE.')),
      sec('Derniers caractères envoyés', `<pre class="cv-paper">${shown || '<span class="cv-m">(rien)</span>'}</pre>`))}`;
}

function voiceAmps(m) {
  const lv = m.psg.levels();
  return lv.voices.map(v => (v.tone || v.noise) ? VOLUME[v.volume & 15] : 0);
}
function viewAMP(m) {
  const lv = m.psg.levels(), a = voiceAmps(m), L = (a[0] + 0.5 * a[1]) / 1.5, R = (a[2] + 0.5 * a[1]) / 1.5;
  return `${flow([B('PSG voix A', 'sortie analogique', lv.voices[0].volume), B('PSG voix B', 'sortie analogique', lv.voices[1].volume), B('PSG voix C', 'sortie analogique', lv.voices[2].volume), '', B('Mélangeur', 'G = A + B/2, D = C + B/2', ''), '', B('Ampli', 'haut-parleur (mono) et prise casque (stéréo)', '')])}
    ${cols(sec('Niveaux des voix', lv.voices.map((v, c) => bar(a[c], 1, `voix ${'ABC'[c]} : ${v.tone || v.noise ? `volume ${v.volume}${v.env ? ' (enveloppe)' : ''}` : 'muette (mélangeur)'}`)).join('') + note('Échelle logarithmique de l\'AY : environ 3 dB par pas de volume.')),
      sec('Sorties', bar(L, 1, `gauche ${num(L * 100)} %`) + bar(R, 1, `droite ${num(R * 100)} %`) + bar((L + R) / 2, 1, `haut-parleur interne ${num((L + R) * 50)} %`)))}`;
}
function viewSPK(m) {
  const a = voiceAmps(m), mono = (a[0] + a[1] + a[2]) / 3;
  return `${flow([B('Ampli audio', 'mélange A + B + C', ''), '', B('Haut-parleur', 'membrane mue par le courant', `${num(mono * 100)} %`, mono > 0), '', B('Carte son du PC', 'restitue les échantillons', '')])}
    ${sec('Amplitude instantanée', bar(mono, 1, `${num(mono * 100)} % du maximum`) + note('Les voix muettes par le mélangeur (R7) ne contribuent pas au son.'))}`;
}

function viewMON(m) {
  const ga = m.ga, c = m.crtc, R = c.regs, res = [[160, 200], [320, 200], [640, 200], [160, 200]][ga.mode & 3];
  const frameHz = 1e6 / ((R[0] + 1) * ((R[4] + 1) * ((R[9] & 31) + 1) + (R[5] & 31)));
  return `${flow([B('Gate Array', 'R, V, B sur 3 niveaux', '27 couleurs'), 'RVB + synchro', B('Moniteur', ga.monochrome ? 'GT65 vert (monochrome)' : 'CTM644 couleur', `${num(frameHz, 2)} Hz`)])}
    ${cols(sec('Image', `<svg class="cv-svg" viewBox="0 0 220 160" width="220" height="160"><rect x="0" y="0" width="220" height="160" rx="10" fill="${rgb(ga.inks[16])}" class="cv-mon"/><rect x="30" y="25" width="160" height="110" fill="${rgb(ga.inks[0])}"/><text x="110" y="85" text-anchor="middle" class="cv-t" fill="${rgb(ga.inks[1])}">${res[0]} × ${res[1]}</text></svg>`),
      sec('État', kv([['Mode', `${ga.mode} — ${MODES[ga.mode & 3]}`], ['Bordure', `couleur matérielle ${ga.inks[16]} (firmware ${hwToFirmware(ga.inks[16])})`], ['Fond (encre 0)', `couleur matérielle ${ga.inks[0]} (firmware ${hwToFirmware(ga.inks[0])})`], ['Trames affichées', num(m.frames)], ['Ligne du faisceau', `${ga.beamY} depuis VSYNC`]])
        + pins([['HSYNC', c.hsync], ['VSYNC', c.vsync], ['DISPEN', c.displayEnabled]])))}`;
}

function viewDRIVE(m) {
  const f = m.fdc, a = f.activity;
  const disc = i => {
    const x = f.drives[i], tracks = x.disk ? Math.max(0, ...x.disk.tracks.map(s => s ? s.length : 0)) : 0, r = 46 - Math.min(x.track, 42) / 42 * 30, act = a.drive === i;
    return `<div class="cv-drive${act ? ' cv-hot' : ''}"><svg class="cv-svg" viewBox="0 0 120 110" width="120" height="110"><circle cx="55" cy="55" r="50" class="cv-disc${x.disk ? '' : ' cv-dim'}"/><circle cx="55" cy="55" r="12" class="cv-hub"/>
      <circle cx="55" cy="55" r="${r}" class="cv-trackc"/><rect x="${55 + r - 4}" y="50" width="62" height="10" class="cv-head${act && (a.reading || a.writing) ? ' cv-on' : ''}"/></svg>
      ${kv([['Lecteur', 'AB'[i] + ':'], ['Disque', x.disk ? `${esc(x.disk.name || 'inséré')}${x.disk.dirty ? ' (modifié)' : ''}` : 'aucun'], ['Faces · pistes', x.disk ? `${x.disk.sides} · ${tracks}` : '—'], ['Piste de la tête', x.track, act], ['Activité', act ? (a.reading ? 'lecture' : a.writing ? 'écriture' : 'sélectionné') : '—']])}</div>`;
  };
  return `${flow([B('FDC µPD765A', 'STEP, DIR, écriture', a.command || '—', f.phase !== 'idle'), '', B('Moteur', 'commun aux deux lecteurs (&FA7E)', f.motor ? 'en marche' : 'arrêté', f.motor), '', B('Tête', 'lit les flux magnétiques', `piste ${f.drives[a.drive & 1].track}`, a.reading || a.writing)])}
    <div class="cv-drives">${disc(0)}${disc(1)}</div>${note('Le cercle clair indique la piste où se trouve la tête (piste 0 à l\'extérieur).')}`;
}

function viewPRINTER(m) {
  const lines = m.printer.text.split(/\r\n|\r|\n/), last = lines.slice(-12);
  return `${flow([B('Port imprimante', 'D0–D6 + /STROBE', ''), 'Centronics', B('Imprimante virtuelle', 'papier listing de l\'onglet Machine', `${num(m.printer.text.length)} car.`)])}
    ${sec(`Dernières lignes <span class="cv-m">(${lines.length} ligne(s) au total)</span>`, `<pre class="cv-paper">${last.map(esc).join('\n') || '<span class="cv-m">(papier vierge)</span>'}</pre>`)}`;
}

function viewXTAL(m) {
  const R = m.crtc.regs, ht = R[0] + 1, lines = (R[4] + 1) * ((R[9] & 31) + 1) + (R[5] & 31), line = 1e6 / ht, frame = line / lines;
  const t = m.cpu.cycles / 4e6;
  return `${flow([B('Quartz', 'oscillateur 16 MHz', '16 MHz', true), '', B('Gate Array', 'divise et distribue', ''), '', B('Z80', '÷4', '4 MHz'), B('CRTC', '÷16', '1 MHz'), B('PSG', '÷16', '1 MHz')])}
    ${cols(sec('Fréquences dérivées', kv([['Quartz', '16,000 MHz (62,5 ns)'], ['Horloge Z80', '4,000 MHz (250 ns par T-state)'], ['Horloge CRTC (caractères)', '1,000 MHz (1 µs)'], ['Horloge PSG', '1,000 MHz'],
      ['Ligne (R0+1 = ' + ht + ')', `${hz(line)} (${ht} µs)`], ['Trame (' + lines + ' lignes)', `${hz(frame)}`], ['Interruptions (52 lignes)', hz(line / 52)]])),
      sec('Temps écoulé', kv([['T-states du Z80', num(m.cpu.cycles)], ['Temps simulé', `${num(t, 3)} s`], ['Trames', num(m.frames)]])))}`;
}

/* ---------------------------------------------------------------------
   Système minimal
   --------------------------------------------------------------------- */
function memChip(m, step, b, kind) {
  const isRom = kind === 'rom', lo = isRom ? 0x0000 : 0x8000, hi = lo + 0x1FFF, data = isRom ? m.rom : m.ram;
  const pc = m.cpu.getRegs().PC, sel = b && b.mem && b.addr >= lo && b.addr <= hi;
  const focus = sel ? b.addr : pc >= lo && pc <= hi ? pc : lo;
  const cs = !!sel && step.pins.includes('MREQ'), oe = cs && step.pins.includes('RD'), we = cs && step.pins.includes('WR');
  const msg = sel ? `${accTxt(b)} — ${isRom ? (b.wr ? "écriture ignorée par l'EPROM" : 'octet lu dans l\'EPROM') : b.wr ? 'octet écrit dans la SRAM' : 'octet lu dans la SRAM'} (cellule ${h4(b.addr - lo)})` : '';
  return `${msg ? live(msg) : ''}
    ${flow([B('Bus d\'adresses', 'A0–A12 : 1 octet parmi 8 192', sel ? h4(b.addr & 0x1FFF) : '—', sel), '', B('Décodeur de lignes', 'choisit la ligne de cellules', sel ? `ligne ${(b.addr & 0x1FFF) >> 3}` : '—', sel), '', B(isRom ? 'Matrice EPROM' : 'Matrice SRAM', isRom ? '65 536 cellules à grille flottante' : 'bascules à 6 transistors', '8 Ko', sel), '',
      B(isRom ? 'Tampons de sortie' : 'E/S trois états', isRom ? 'actifs si /CE et /OE à 0' : 'lecture /OE · écriture /WE', sel && b.data != null ? h2(b.data) : 'Z', oe || we), 'D0–D7', B('Bus de données', '', sel && b.data != null ? h2(b.data) : '—', sel)])}
    ${cols(sec('Broches', pins([[isRom ? '/CE' : '/CS', cs, `sortie Y${isRom ? 0 : 4} du 74LS138`], ['/OE', oe, 'validation de sortie = /RD'], [isRom ? '/PGM' : '/WE', !isRom && we, isRom ? 'programmation : tirée à 1' : 'écriture = /WR']])
      + kv([['Plage décodée', `${h4(lo)}–${h4(hi)} (A15 A14 A13 = ${isRom ? '000' : '100'})`], ['Sélection', `sortie Y${isRom ? 0 : 4} du 74LS138`], isRom ? ['Octets programmés', num(m.rom.reduce((n, v) => n + (v !== 0xFF), 0))] : ['Octets non nuls', num(m.ram.reduce((n, v) => n + (v !== 0), 0))]])
      + note(isRom ? 'Le Z80 démarre en &0000 : la première instruction vient de cette EPROM. Les écritures sont ignorées.' : 'La pile et les variables vivent ici ; SP pointe en général vers le haut de la SRAM.')),
      sec(`Contenu autour de ${h4(focus)} <span class="cv-m">(${sel ? 'accès en cours' : focus === pc ? 'PC' : 'début'})</span>`, hexdump(a => data[a - lo], focus, { lo, hi, lines: 8, mark: sel && b.wr ? 'cv-hx-wr' : null }), 'cv-wide'))}`;
}

function viewMDEC(m, step, b) {
  const mreq = !!step?.pins?.includes('MREQ'), iorq = !!step?.pins?.includes('IORQ'), a = step?.addr ?? m.cpu.getRegs().PC;
  const selIdx = (a >> 13) & 7, use = ['EPROM (/CS)', '—', '—', '—', 'SRAM (/CS)', '—', '—', '—'];
  const rows = [...Array(8)].map((_, i) => {
    const on = mreq && i === selIdx;
    return `<tr class="${on ? 'cv-hot' : !mreq && i === selIdx ? 'cv-sel' : ''}"><td>${(i >> 2) & 1}</td><td>${(i >> 1) & 1}</td><td>${i & 1}</td>${[...Array(8)].map((_, y) => `<td class="${on && y === i ? 'cv-hotc' : ''}">${on && y === i ? 0 : 1}</td>`).join('')}<td>${h4(i * 0x2000)}–${h4(i * 0x2000 + 0x1FFF)}</td><td class="cv-m">${use[i]}</td></tr>`;
  }).join('');
  const out = iorq && step.pins.includes('WR') && !(a & 1), inp = iorq && step.pins.includes('RD') && (a & 1);
  return `${mreq ? live(`/MREQ actif, adresse ${h4(a)} : A15 A14 A13 = ${bin(selIdx, 3)} → sortie Y${selIdx} à 0 (${use[selIdx]})`) : iorq ? live(`/IORQ actif, port ${h4(a)}, A0 = ${a & 1} → ${out ? 'horloge du verrou de sortie' : inp ? "validation du tampon d'entrée" : 'aucun port'}`) : ''}
    ${flow([B('Entrées C B A', 'A15 A14 A13', bin(selIdx, 3), mreq), '', B('Validations', 'G1 = +5 V, /G2A = /MREQ, /G2B = masse', mreq ? 'actif' : 'bloqué', mreq), '', B('Décodeur 3 → 8', 'une seule sortie Y à 0', mreq ? 'Y' + selIdx : 'aucune', mreq), '', B('Boîtiers', 'Y0 → EPROM, Y4 → SRAM', mreq ? use[selIdx] : '—', mreq)])}
    ${cols(sec('Entrées', pins([['A13', (a >> 13) & 1], ['A14', (a >> 14) & 1], ['A15', (a >> 15) & 1], ['/MREQ', mreq], ['/IORQ', iorq], ['A0', a & 1]]) + note(step ? `Adresse sur le bus : ${h4(a)}.` : `Pas d'accès en cours : ligne encadrée = zone de PC (${h4(a)}).`)),
      sec('Ports d\'E/S (/IORQ et A0)', kv([['OUT (&00) : /IORQ, /WR, A0 = 0', out ? 'horloge du 74LS374' : '—', out], ['IN (&01) : /IORQ, /RD, A0 = 1', inp ? 'validation du 74LS244' : '—', inp]])))}
    ${sec('Table de vérité (sorties actives à 0)', `<table class="cv-tab"><tr><th>A15</th><th>A14</th><th>A13</th>${[...Array(8)].map((_, y) => `<th>Y${y}</th>`).join('')}<th>Plage</th><th>Boîtier</th></tr>${rows}</table>`)}`;
}

function viewMOUT(m, step, b) {
  const clk = b && b.io && b.wr && !(b.addr & 1), d = clk ? b.data : null;
  const ffs = [7, 6, 5, 4, 3, 2, 1, 0].map(i => `<div class="cv-ff${clk ? ' cv-hot' : ''}"><span>D${i} ${d == null ? '·' : (d >> i) & 1}</span><b>bascule</b><span class="${(m.leds >> i) & 1 ? 'cv-q1' : ''}">Q${i} ${(m.leds >> i) & 1}</span></div>`).join('');
  return `${clk ? live(`OUT (${h2(b.addr & 0xFF)}), ${dataTxt(b)} : front montant de l'horloge → les 8 bascules recopient D0–D7`) : ''}
    ${flow([B('Bus de données', 'D0–D7', d != null ? h2(d) : '—', clk), '', B('8 bascules D', 'mémorisent sur le front de l\'horloge', h2(m.leds), clk), 'Q0–Q7', B('8 LED', 'allumées par les sorties à 1', bin(m.leds))])}
    ${sec('Bascules D → Q', `<div class="cv-ffs">${ffs}</div>` + pins([['CLK', clk, 'horloge = /IORQ + /WR + A0 = 0'], ['/OE', true, 'sorties toujours validées (à la masse)']]) + note('Entre deux OUT, les sorties gardent la dernière valeur écrite.'))}`;
}

function viewMIN(m, step, b) {
  const en = b && b.io && b.rd && (b.addr & 1);
  const bufs = [7, 6, 5, 4, 3, 2, 1, 0].map(i => `<div class="cv-ff${en ? ' cv-hot' : ''}"><span>A${i} ${(m.switches >> i) & 1}</span><b>▷</b><span>Y${i} ${en ? (m.switches >> i) & 1 : 'Z'}</span></div>`).join('');
  return `${en ? live(`IN A, (${h2(b.addr & 0xFF)}) : /G à 0 → les interrupteurs passent sur le bus (${h2(m.switches)})`) : ''}
    ${flow([B('8 interrupteurs', 'entrées A0–A7', bin(m.switches)), '', B('8 tampons trois états', 'conduisent seulement si /G = 0', en ? 'actifs' : 'haute impédance', en), 'Y0–Y7', B('Bus de données', 'lu par le Z80', en ? h2(m.switches) : 'Z', en)])}
    ${sec('Tampons', `<div class="cv-ffs">${bufs}</div>` + pins([['/1G /2G', en, 'validation = /IORQ + /RD + A0 = 1']]) + note('Hors lecture du port &01, les sorties sont en haute impédance (Z) : le tampon ne perturbe pas le bus.'))}`;
}

function viewLEDS(m) {
  return `${sec(`LED = ${h2(m.leds)} = %${bin(m.leds)}`, `<div class="cv-leds">${[7, 6, 5, 4, 3, 2, 1, 0].map(i => `<div><i class="${(m.leds >> i) & 1 ? 'cv-on' : ''}"></i><span>Q${i}</span></div>`).join('')}</div>` + note('Chaque LED suit une sortie du 74LS374 (1 = allumée).'))}`;
}
function viewSW(m) {
  return `${sec(`Interrupteurs = ${h2(m.switches)} = %${bin(m.switches)}`, `<div class="cv-sws">${[7, 6, 5, 4, 3, 2, 1, 0].map(i => `<div class="${(m.switches >> i) & 1 ? 'cv-on' : ''}"><i></i><span>A${i}</span></div>`).join('')}</div>` + note("Basculez-les dans l'onglet Machine ; le Z80 les lit avec IN A,(&01)."))}`;
}
function viewOSC(m, step) {
  const W = 400, per = W / 8, t = step?.t;
  let d = 'M0,30';
  for (let i = 0; i < 8; i++) d += ` V6 H${i * per + per / 2} V30 H${(i + 1) * per}`;
  return `${flow([B('Quartz 4 MHz', 'résonateur', ''), '', B('Inverseurs', 'entretiennent l\'oscillation', ''), 'CLK', B('Z80A', 'un T-state par période', t ? `T${t}` : num(m.cpu.cycles))])}
    ${sec('Horloge', `<svg class="cv-svg" viewBox="0 0 ${W} 50" width="${W}" height="50">${t ? `<rect x="${((t - 1) % 8) * per}" y="0" width="${per}" height="36" class="cv-tbox"/>` : ''}<path d="${d}" class="cv-wave cv-hotw"/><text x="0" y="48" class="cv-t cv-tm">8 périodes de 250 ns = 2 µs</text></svg>`
      + kv([['Fréquence', '4,000 MHz'], ['Période', '250 ns'], ['T-states écoulés', num(m.cpu.cycles)], ['Temps simulé', `${num(m.cpu.cycles / 4e6, 4)} s`], ['T-state courant', step ? `${step.m} T${step.t}` : '—']]))}`;
}
function viewRST(m) {
  const r = m.cpu.getRegs();
  return `${flow([B('Bouton', 'met /RESET à la masse', 'relâché'), '', B('Réseau RC', 'maintient /RESET à 0 à la mise sous tension', 'chargé'), '/RESET', B('Z80A', 'PC = 0, IFF = 0, IM 0 au reset', h4(r.PC))])}
    ${sec('État', pins([['/RESET', false, 'actif à 0']]) + kv([['/RESET', '1 (inactif) : le Z80 exécute'], ['PC', h4(r.PC)], ['Interruptions', `IM ${r.IM}, IFF1 = ${r.IFF1}`]]) + note('Au reset, le Z80 repart en &0000, interruptions masquées, en mode 0.'))}`;
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
    return `<div class="cv cv-err">Vue indisponible : ${esc(e.message)}</div>`;
  }
}
