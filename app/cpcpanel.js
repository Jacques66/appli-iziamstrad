import { $, $$, hex, esc } from './util.js';
import { KEYS } from '../src/machines/cpc/keyboard.js';
import { parseDSK, writeDSK, blankDisk } from '../src/machines/cpc/dsk.js';
import { SCREEN_W, SCREEN_H } from '../src/machines/cpc/gatearray.js';
import { screenText } from '../src/machines/cpc/screentext.js';

/* Panneau « Machine » du CPC 6128 : écran, clavier (virtuel et clavier du PC),
   lecteurs de disquettes, imprimante, haut-parleur (Web Audio). */

let m = null, log = () => {};
let image = null;
const pressed = new Map();     // code de touche du PC → { key }
const sticky = new Set();      // SHIFT / CONTROL du clavier virtuel

// appelée à chaque passage sur un CPC (anglais ou français) : le clavier virtuel suit la ROM
export function initCpcPanel(machine, logger) {
  m = machine; log = logger;
  image = new ImageData(new Uint8ClampedArray(m.ga.pixels.buffer), SCREEN_W, SCREEN_H);
  m.ga.monochrome = $('#mon-type').value === 'green'; m.ga.buildPalette();
  buildKeyboard();
  renderDrives();
  m.printer.onChar = () => { st.paperDirty = true; };
  m.fdc.onChange = () => { st.drivesDirty = true; };
}
const st = { paperDirty: true, drivesDirty: true, lastLed: '' };

/* ---------- Écran ---------- */
export function drawScreen() {
  if (!m) return;
  $('#screen').getContext('2d').putImageData(image, 0, 0);
  const c = m.crtc;
  $('#mon-info').textContent = `Mode ${m.ga.mode} · ${[160, 320, 640][m.ga.mode]}×200 · trame ${m.frames} · faisceau ligne ${c.vcc * (c.regs[9] + 1) + c.vlc}`;
}
$('#mon-type').addEventListener('change', () => { if (!m) return; m.ga.monochrome = $('#mon-type').value === 'green'; m.ga.buildPalette(); });
$('#scanlines').addEventListener('change', () => $('#crt .scan').classList.toggle('off', !$('#scanlines').checked));
$('#btn-copytext').addEventListener('click', async () => {
  const text = screenText(m).join('\n');
  try { await navigator.clipboard.writeText(text); log('Texte de l\'écran copié dans le presse-papiers.'); }
  catch { log('Copie refusée par le navigateur. Texte de l\'écran :\n' + esc(text)); }
});

/* ---------- Plein écran ---------- */
// Sous Chrome/Edge, le verrouillage du clavier envoie aussi Échap au CPC (maintenir Échap pour quitter).
export function toggleFullscreen() {
  const crt = $('#crt');
  if (document.fullscreenElement) document.exitFullscreen();
  else crt.requestFullscreen?.().catch(err => log(`Plein écran refusé par le navigateur : ${esc(err.message)}`, 'w'));
}
function fsHint(text) {
  const h = $('#fs-hint');
  h.textContent = text;
  h.classList.add('show');
  clearTimeout(fsHint.t);
  fsHint.t = setTimeout(() => h.classList.remove('show'), 3500);
}
document.addEventListener('fullscreenchange', async () => {
  const on = document.fullscreenElement === $('#crt');
  $('#btn-fullscreen').textContent = on ? '⛶ Quitter le plein écran' : '⛶ Plein écran';
  if (on) {
    $('#crt').focus({ preventScroll: true });
    let locked = false;
    try { await navigator.keyboard?.lock?.(); locked = !!navigator.keyboard?.lock; } catch { /* verrouillage indisponible */ }
    fsHint(locked ? 'Clavier relié au CPC · maintenir Échap pour quitter' : 'Clavier relié au CPC · Échap pour quitter (double-clic aussi)');
  } else {
    navigator.keyboard?.unlock?.();
    releaseAllKeys();
  }
});
$('#btn-fullscreen').addEventListener('click', toggleFullscreen);
$('#crt').addEventListener('dblclick', toggleFullscreen);

/* ---------- Clavier ---------- */
const LAYOUT = {
  main: [
    [['ESC', 'ESC'], ['1'], ['2'], ['3'], ['4'], ['5'], ['6'], ['7'], ['8'], ['9'], ['0'], ['-'], ['^'], ['CLR', 'CLR', 40], ['DEL', 'DEL', 40]],
    [['TAB', 'TAB', 44], ['Q'], ['W'], ['E'], ['R'], ['T'], ['Y'], ['U'], ['I'], ['O'], ['P'], ['@'], ['['], ['RETURN', 'RETURN', 64, 'blue']],
    [['CAPS LOCK', 'CAPS', 56], ['A'], ['S'], ['D'], ['F'], ['G'], ['H'], ['J'], ['K'], ['L'], [':'], [';'], [']'], ['', 'RETURN', 52, 'blue']],
    [['SHIFT', 'SHIFT', 70], ['Z'], ['X'], ['C'], ['V'], ['B'], ['N'], ['M'], [','], ['.'], ['/'], ['\\'], ['SHIFT', 'SHIFT', 70]],
    [['CONTROL', 'CONTROL', 70], ['COPY', 'COPY', 48], [' ', 'SPACE', 300], ['ENTER', 'ENTER', 70, 'blue']],
  ],
  pad: [
    [['f7', 'F7', 0, 'green'], ['f8', 'F8', 0, 'green'], ['f9', 'F9', 0, 'green']],
    [['f4', 'F4', 0, 'green'], ['f5', 'F5', 0, 'green'], ['f6', 'F6', 0, 'green']],
    [['f1', 'F1', 0, 'green'], ['f2', 'F2', 0, 'green'], ['f3', 'F3', 0, 'green']],
    [['f0', 'F0', 0, 'green'], ['↑', 'CUR_UP'], ['.', 'F.', 0, 'green']],
    [['←', 'CUR_LEFT'], ['↓', 'CUR_DOWN'], ['→', 'CUR_RIGHT']],
  ],
};
// inscriptions des touches tirées des tables de la ROM : AZERTY sur le CPC français ;
// le symbole obtenu avec SHIFT est gravé en haut de la touche comme sur le vrai clavier
function buildKeyboard() {
  const labels = m.keymap.labels;
  const mk = rows => rows.map(r => `<div class="kb-row">${r.map(([label0, key = label0, w, c]) => {
    const lb = labels[key] && !['RETURN', 'ENTER', 'SPACE', 'TAB', 'DEL', 'CLR', 'ESC'].includes(key) && !/^F/.test(key) && !/^CUR/.test(key) ? labels[key] : null;
    const label = lb ? lb.main : label0, sh = lb?.shift;
    return `<span class="key ${c || (label0 === 'ESC' || label0 === 'DEL' ? 'red' : '')}${sh ? ' two' : ''}" data-k="${esc(key)}" style="${w ? `width:${w}px` : ''}" title="${sh ? `SHIFT + ${esc(label)} = ${esc(sh)}` : esc(label)}">${sh ? `<small>${esc(sh)}</small>` : ''}${esc(label)}</span>`;
  }).join('')}</div>`).join('');
  $('#keyboard').innerHTML = `<div class="kb-main">${mk(LAYOUT.main)}</div><div class="kb-pad">${mk(LAYOUT.pad)}</div>`;
}
function showKey(key) {
  const k = KEYS[key];
  if (k) $('#key-info').textContent = `${key} → ligne ${k[0]}, bit ${k[1]} de la matrice (lue par le PSG, port A)`;
}
export function refreshKeys() {
  if (!m) return;
  $$('#keyboard .key').forEach(el => el.classList.toggle('down', m.keyboard.isDown(el.dataset.k)));
}
$('#keyboard').addEventListener('mousedown', e => {
  const el = e.target.closest('.key'); if (!el || !m) return;
  e.preventDefault();
  const key = el.dataset.k;
  showKey(key);
  if (key === 'SHIFT' || key === 'CONTROL') {
    sticky.has(key) ? sticky.delete(key) : sticky.add(key);
    m.keyboard.set(key, sticky.has(key));
  } else {
    m.keyboard.set(key, true);
    const up = () => { m.keyboard.set(key, false); sticky.forEach(s => m.keyboard.set(s, false)); sticky.clear(); document.removeEventListener('mouseup', up); refreshKeys(); };
    document.addEventListener('mouseup', up);
  }
  refreshKeys();
});

const SPECIAL = {
  Enter: 'RETURN', NumpadEnter: 'ENTER', Backspace: 'DEL', Delete: 'CLR', Escape: 'ESC', Tab: 'TAB', CapsLock: 'CAPS',
  ControlLeft: 'CONTROL', ControlRight: 'CONTROL', AltLeft: 'COPY', ArrowUp: 'CUR_UP', ArrowDown: 'CUR_DOWN', ArrowLeft: 'CUR_LEFT', ArrowRight: 'CUR_RIGHT',
  Numpad0: 'F0', Numpad1: 'F1', Numpad2: 'F2', Numpad3: 'F3', Numpad4: 'F4', Numpad5: 'F5', Numpad6: 'F6', Numpad7: 'F7', Numpad8: 'F8', Numpad9: 'F9', NumpadDecimal: 'F.',
};
// Caractères, Entrée et Effacement passent par la file de frappe du clavier (cadencée sur les trames :
// aucun appui bref n'est perdu, quelle que soit la disposition du clavier du PC). Les autres touches
// (flèches, Shift, Control, Copy, pavé numérique…) sont maintenues tant que la touche du PC l'est.
const QUEUED = { Enter: ['RETURN', false], Backspace: ['DEL', false] };
// touches mortes du clavier français : le caractère est tapé tout de suite, sans attendre la lettre suivante
const DEAD = { BracketLeft: '^', Digit7: '`' };
// true si la touche est destinée au CPC
export function hostKey(e, down) {
  if (!m) return false;
  // AltGr = Ctrl gauche fictif + Alt droit : on relâche le CONTROL du CPC posé par ce Ctrl fictif
  if (e.key === 'AltGraph' || e.code === 'AltRight') {
    const c = pressed.get('ControlLeft');
    if (down && c) { pressed.delete('ControlLeft'); m.keyboard.set('CONTROL', false); }
    return true;
  }
  const ch = e.key === 'Dead' ? DEAD[e.code] : e.key;
  const q = QUEUED[e.code] || (ch && ch.length === 1 && m.keyboard.charKeys[ch]);
  if (q) {
    if (down) { m.keyboard.queue.push(q); showKey(q[0]); }
    return true;
  }
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { m.keyboard.set('SHIFT', down); return true; }
  if (!down) {
    const p = pressed.get(e.code);
    if (!p) return false;
    pressed.delete(e.code);
    m.keyboard.set(p.key, false);
    return true;
  }
  if (e.repeat) return pressed.has(e.code);
  const key = SPECIAL[e.code];
  if (!key) return false;
  pressed.set(e.code, { key });
  m.keyboard.set(key, true);
  showKey(key);
  return true;
}
export function releaseAllKeys() {
  if (!m) return;
  pressed.clear();
  m.keyboard.matrix.fill(0xFF);
}

/* ---------- Disquettes ---------- */
let pendingDrive = 0;
function renderDrives() {
  const a = m.fdc.activity || {};
  $('#drives').innerHTML = [0, 1].map(i => {
    const d = m.fdc.disk(i), on = a.motor && a.drive === i && (a.phase === 'exécution' || a.reading || a.writing);
    return `<div class="drive" data-d="${i}">
      <div class="slot${d ? '' : ' empty'}">${d ? `<span class="disk">${esc(d.name || 'disque')}</span>` : '<span>déposer un .dsk</span>'}</div><i class="led${on ? ' on' : ''}"></i>
      <div class="drv-info"><b>${i ? 'B' : 'A'}:</b> ${d ? `${esc(d.name || 'sans nom')}${d.dirty ? ' · <span class="w">modifié</span>' : ''}` : 'vide'}<br>
        <span class="muted">piste ${(a.track || [0, 0])[i]} · ${a.motor ? 'moteur en marche' : 'moteur arrêté'}</span><br>
        <span class="drv-btns"><button class="tb" data-act="insert">Insérer…</button><button class="tb" data-act="blank">Vierge</button>${d ? '<button class="tb" data-act="save">Enregistrer</button><button class="tb" data-act="eject">Éjecter</button>' : ''}</span></div></div>`;
  }).join('');
  renderCatalog();
  st.drivesDirty = false;
}
$('#drives').addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const i = +b.closest('[data-d]').dataset.d;
  switch (b.dataset.act) {
    case 'insert': pendingDrive = i; $('#dsk-in').click(); break;
    case 'blank': { const d = blankDisk('data'); d.name = 'vierge.dsk'; m.fdc.insert(i, d); log(`Disquette vierge (format DATA) insérée en ${i ? 'B' : 'A'}:`); break; }
    case 'eject': m.fdc.eject(i); break;
    case 'save': {
      const d = m.fdc.disk(i), a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([writeDSK(d)], { type: 'application/octet-stream' }));
      a.download = (d.name || 'disque.dsk').replace(/(\.dsk)?$/i, '.dsk');
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      d.dirty = false;
      break;
    }
  }
  renderDrives();
});
async function insertFile(file, i) {
  try {
    const d = parseDSK(new Uint8Array(await file.arrayBuffer()));
    d.name = file.name;
    m.fdc.insert(i, d);
    log(`${esc(file.name)} inséré en ${i ? 'B' : 'A'}: — tapez CAT puis RUN"nom`);
  } catch (err) { log(`${esc(file.name)} : ${esc(err.message)}`, 'err'); }
  renderDrives();
}
$('#dsk-in').addEventListener('change', e => { const f = e.target.files[0]; if (f) insertFile(f, pendingDrive); e.target.value = ''; });
$('#drives').addEventListener('dragover', e => e.preventDefault());
$('#drives').addEventListener('drop', e => {
  e.preventDefault();
  const dr = e.target.closest('[data-d]'), f = e.dataTransfer.files[0];
  if (f) insertFile(f, dr ? +dr.dataset.d : 0);
});

// catalogue AMSDOS du lecteur A: (format DATA : piste 0, secteurs &C1–&C4 ; SYSTEM : piste 2, &41–&44)
function renderCatalog() {
  const d = m.fdc.disk(0);
  if (!d) { $('#cat').innerHTML = ''; return; }
  const t0 = d.tracks[0]?.[0];
  const data = t0?.sectors.some(s => s.R === 0xC1);
  const tr = data ? t0 : d.tracks[0]?.[2], first = data ? 0xC1 : 0x41;
  const files = new Map();
  for (let k = 0; k < 4 && tr; k++) {
    const sec = tr.sectors.find(s => s.R === first + k);
    if (!sec) continue;
    for (let o = 0; o + 32 <= sec.data.length; o += 32) {
      const e = sec.data.subarray(o, o + 32);
      if (e[0] === 0xE5 || e[0] > 15) continue;
      const name = String.fromCharCode(...[...e.subarray(1, 9)].map(c => c & 0x7F)).trimEnd() + '.' + String.fromCharCode(...[...e.subarray(9, 12)].map(c => c & 0x7F)).trimEnd();
      files.set(name, (files.get(name) || 0) + e[15] * 128);
    }
  }
  $('#cat').innerHTML = `<tr><th>Catalogue A:</th><th>Taille</th></tr>` + ([...files].map(([n, s]) => `<tr><td>${esc(n)}</td><td>${Math.ceil(s / 1024)}K</td></tr>`).join('') || '<tr><td class="muted">aucun fichier</td><td></td></tr>');
}

/* ---------- Imprimante ---------- */
function renderPaper() {
  const pre = $('#paper');
  pre.textContent = m.printer.text.replace(/\r\n?/g, '\n') || '';
  $('#paper-wrap').scrollTop = $('#paper-wrap').scrollHeight;
  st.paperDirty = false;
}
$('#prn-clear').addEventListener('click', () => { m.printer.text = ''; renderPaper(); });
$('#prn-save').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([m.printer.text.replace(/\r\n?/g, '\n')], { type: 'text/plain' }));
  a.download = 'imprimante.txt'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

/* ---------- Son ---------- */
const audio = { ctx: null, gain: null, next: 0, lastT: 0 };
// le son est activé par défaut ; le navigateur n'autorise l'audio qu'après un geste de l'utilisateur
function soundPref(on) { try { if (on == null) return localStorage.getItem('z80studio.sound') !== '0'; localStorage.setItem('z80studio.sound', on ? '1' : '0'); } catch { return true; } }
$('#sound').checked = soundPref();
function applySound() {
  if ($('#sound').checked && !audio.ctx) {
    audio.ctx = new AudioContext();
    audio.gain = audio.ctx.createGain();
    audio.gain.connect(audio.ctx.destination);
  }
  if (audio.ctx) audio.ctx[$('#sound').checked ? 'resume' : 'suspend']();
  if (m) audio.lastT = m.cpu.cycles;
  audio.next = 0;
}
$('#sound').addEventListener('change', () => { soundPref($('#sound').checked); applySound(); });
const firstGesture = () => { if ($('#sound').checked && (!audio.ctx || audio.ctx.state !== 'running')) applySound(); };
document.addEventListener('pointerdown', firstGesture);
document.addEventListener('keydown', firstGesture);
// appelé après chaque tranche d'exécution ; realtime = vitesse 4 MHz
export function pumpAudio(realtime) {
  const now = m.cpu.cycles;
  if (!audio.ctx || !$('#sound').checked || !realtime) { audio.lastT = now; audio.next = 0; return; }
  if (now - audio.lastT < 4000) return;
  const sr = audio.ctx.sampleRate;
  const { left, right } = m.psg.render(audio.lastT, now, sr);
  audio.lastT = now;
  if (!left.length) return;
  const buf = audio.ctx.createBuffer(2, left.length, sr);
  buf.copyToChannel(left, 0); buf.copyToChannel(right, 1);
  const src = audio.ctx.createBufferSource();
  src.buffer = buf;
  src.connect(audio.gain);
  audio.gain.gain.value = $('#volume').value / 100;
  const t = audio.ctx.currentTime;
  if (audio.next < t || audio.next > t + 0.25) audio.next = t + 0.05;
  src.start(audio.next);
  audio.next += buf.duration;
}

function drawScope(ts) {
  const cv = $('#scope'), g = cv.getContext('2d'), W = cv.width, H = cv.height;
  g.fillStyle = '#071009'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#13301a'; g.lineWidth = 1;
  for (let x = 0; x < W; x += 26) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  const lv = m.psg.levels(), cols = ['#7dff8a', '#4fc3f7', '#f06292'];
  lv.voices.forEach((v, k) => {
    const yb = 20 + k * 35, amp = v.volume / 15 * 13, on = (v.tone || v.noise) && v.volume > 0;
    g.strokeStyle = cols[k]; g.lineWidth = 1.6; g.beginPath();
    const per = on && v.tone && v.freq ? Math.max(2, 2400 / v.freq) : 0;
    for (let x = 0; x < W; x++) {
      let y = yb;
      if (on && v.tone && per) y = yb + (Math.floor((x + ts / 20) / per) % 2 ? amp : -amp);
      else if (on && v.noise) y = yb + (Math.random() - 0.5) * 2 * amp;
      x ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
    g.fillStyle = cols[k]; g.font = '10px JetBrains Mono';
    g.fillText(`${'ABC'[k]}  ${on ? (v.tone ? Math.round(v.freq) + ' Hz' : 'bruit') + '  vol ' + v.volume + (v.env ? ' (env.)' : '') : 'muette'}`, W - 150, yb - 4);
  });
  $('#ay').innerHTML = [...m.psg.regs.slice(0, 14)].map((x, i) => `<span>R${i}<b>${hex(x)}</b></span>`).join('');
}

/* ---------- Rafraîchissement ---------- */
export function renderCpcPanel(ts) {
  if (!m) return;
  drawScreen();
  drawScope(ts);
  refreshKeys();
  const a = m.fdc.activity || {};
  const led = `${a.motor}|${a.drive}|${a.phase}|${(a.track || []).join(',')}`;
  if (st.drivesDirty || led !== st.lastLed) { st.lastLed = led; renderDrives(); }
  if (st.paperDirty) renderPaper();
}
