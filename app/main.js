import { $, $$, hex, esc, parseNum } from './util.js';
import { assemble } from '../src/asm/assembler.js';
import { disassemble, disassembleRange } from '../src/z80/disasm.js';
import { MinimalMachine } from '../src/machines/minimal.js';
import { CPC6128 } from '../src/machines/cpc6128.js';
import { EXAMPLES } from './examples.js';
import { highlight } from './highlight.js';
import { microSteps, changedRegs } from './microsteps.js';
import { buildCPU, updateCPU } from './cpuview.js';
import { aluInfo, decodeInfo, addTransfers } from './cpudetail.js';
import { buildTrace, renderLA, addSignal, LA } from './analyzer.js';
import { buildBoard, initBoardEvents, updateBoard, chipBlocks } from './board.js';
import { MIN_BOARD, CPC_BOARD } from './boards.js';
import { hasChipView, renderChipView } from './chipviews.js';
import { initCpcPanel, renderCpcPanel, pumpAudio, hostKey, releaseAllKeys } from './cpcpanel.js';

/* =====================================================================
   State
   ===================================================================== */
const store = {
  get(k, d) { try { const v = localStorage.getItem('z80studio.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('z80studio.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
const MACHINES = {
  cpc: { label: 'Amstrad CPC 6128', speed: '4000000', board: CPC_BOARD, tab: 'Machine · screen, keyboard, discs' },
  cpcfr: { label: 'Amstrad CPC 6128 French', speed: '4000000', board: CPC_BOARD, tab: 'Machine · screen, AZERTY keyboard, discs' },
  min: { label: 'Minimal Z80', speed: '4000', board: MIN_BOARD, tab: 'Machine · LEDs & switches' },
};
let m = null, cpu = null;
const cpcs = {};      // one instance per ROM version (uk, fr), kept across machine changes
const read = a => m.read(a & 0xFFFF);
const st = {
  kind: store.get('machine', 'cpc'),
  source: '', fileName: '',
  asm: null, loaded: null,
  lineOfAddr: new Map(),
  bps: new Set(),
  running: false,
  stopReason: 'Ready',
  cur: null,
  history: [],
  instrCount: 0,
  prevRegs: null,
  measured: 0,
  playTimer: null,
};
const HISTORY_MAX = 400;

const log = (html, cls = '') => {
  const c = $('#console');
  c.insertAdjacentHTML('beforeend', `<div class="${cls}">${html}</div>`);
  c.scrollTop = c.scrollHeight;
};
const isCpc = () => st.kind.startsWith('cpc');
const family = () => (isCpc() ? 'cpc' : 'min');   // programs, examples and breakpoints shared by both CPCs

/* =====================================================================
   Tabs, dock
   ===================================================================== */
const lowScreen = matchMedia('(max-height: 700px)');
const dockCollapsed = () => lowScreen.matches ? !$('.layout').classList.contains('dock-open') : $('.layout').classList.contains('dock-min');
const dockLabel = () => { $('#dock-toggle').textContent = dockCollapsed() ? '▴ Expand' : '▾ Collapse'; };
$('#dock-toggle').onclick = () => { $('.layout').classList.toggle(lowScreen.matches ? 'dock-open' : 'dock-min'); dockLabel(); };
lowScreen.addEventListener('change', dockLabel);
dockLabel();

function activate(group, name) {
  $$(`.tabs[data-tabs="${group}"] .tab`).forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $$(`.pane[data-group="${group}"]`).forEach(p => p.classList.toggle('active', p.dataset.name === name));
  if (group === 'dock' && dockCollapsed()) $('#dock-toggle').click();
  if (group === 'ws' && name === 'machine') focusScreen();
  refresh(true);
}
document.addEventListener('click', e => {
  const b = e.target.closest('.tabs .tab');
  if (b) activate(b.parentElement.dataset.tabs, b.dataset.tab);
});
const visible = name => $(`.pane[data-name="${name}"]`).classList.contains('active');

/* =====================================================================
   Machines
   ===================================================================== */
async function loadRoms(lang) {
  const get = async f => {
    const r = await fetch('../roms/' + f);
    if (!r.ok) throw new Error(`${f} not found (${r.status})`);
    return new Uint8Array(await r.arrayBuffer());
  };
  const amsdos = await get('amsdos.rom');
  if (lang === 'fr') return { os: await get('cpc6128fr-os.rom'), basic: await get('cpc6128fr-basic.rom'), amsdos, lang };
  const sys = await get('cpc6128.rom');
  return { os: sys.subarray(0, 0x4000), basic: sys.subarray(0x4000), amsdos, lang };
}

// Earlier versions shipped the examples in French; a copy saved in the browser is replaced by the
// English example of the same program (the saved text is kept under 'backup.<family>' just in case).
const OLD_EXAMPLE_NAMES = {
  'bonjour.asm': 'hello.asm', 'bandes.asm': 'raster-bars.asm', 'gamme.asm': 'scale.asm', 'imprimante.asm': 'printer.asm',
  'ecran-partage.asm': 'split-screen.asm', 'chenillard.asm': 'led-chaser.asm', 'compteur.asm': 'bcd-counter.asm', 'interruption.asm': 'interrupt.asm',
};
function migrateFrenchExample(fam) {
  const name = OLD_EXAMPLE_NAMES[st.fileName] || st.fileName;
  const ex = EXAMPLES.find(e => e.name === name);
  const french = /[éèêàùç]/.test(st.source) && /;/.test(st.source);
  if (!ex || (!OLD_EXAMPLE_NAMES[st.fileName] && !french) || st.source === ex.source) return;
  store.set('backup.' + fam, { fileName: st.fileName, source: st.source });
  st.source = ex.source; st.fileName = ex.name;
  store.set('source.' + fam, st.source); store.set('fileName.' + fam, st.fileName);
}

async function switchMachine(kind, { keepSource = false } = {}) {
  if (!MACHINES[kind]) kind = 'cpc';
  stop('Machine change');
  st.kind = kind;
  store.set('machine', kind);
  $('#machine').value = kind;
  if (isCpc()) {
    const lang = kind === 'cpcfr' ? 'fr' : 'uk';
    if (!cpcs[lang]) {
      try { cpcs[lang] = new CPC6128(await loadRoms(lang)); }
      catch (err) { log(`CPC ROMs unavailable: ${esc(err.message)}. Falling back to the minimal system.`, 'err'); return switchMachine('min'); }
    }
    m = cpcs[lang];
    initCpcPanel(m, log);
  } else m = new MinimalMachine();
  cpu = m.cpu;
  const def = MACHINES[kind], fam = family();
  $('#speed').value = def.speed;
  $('#tab-machine').textContent = def.tab;
  $('#mach-cpc').hidden = !isCpc();
  $('#mach-min').hidden = isCpc();
  $('[data-mem="ram"]').textContent = isCpc() ? 'Screen &C000' : 'SRAM &8000';
  $('[data-mem="ram"]').dataset.addr = isCpc() ? '49152' : '32768';
  renderConfig();
  buildBoard({ board: def.board, machine: m, onSignal, onOpen });
  if (!keepSource) {
    st.source = store.get('source.' + fam, EXAMPLES.find(e => e.machine === fam).source);
    st.fileName = store.get('fileName.' + fam, EXAMPLES.find(e => e.machine === fam).name);
    migrateFrenchExample(fam);
  }
  ta.value = st.source;
  $('#file-name').textContent = st.fileName;
  st.bps = new Set(store.get('bps.' + fam, []));
  st.loaded = null; st.lineOfAddr = new Map();
  hardReset();
  assembleNow();
  if (kind === 'min') loadProgram();
  else { log('CPC 6128: starting the firmware and BASIC 1.1…'); run(); }
}
$('#machine').addEventListener('change', () => switchMachine($('#machine').value));

/* =====================================================================
   Editor
   ===================================================================== */
const ta = $('#ed-ta');
let asmTimer = null;
const size = res => res.segments.reduce((n, s) => n + s.bytes.length, 0);

function renderHighlight() {
  const syms = new Set(Object.keys(st.asm?.symbols || {}));
  const lines = st.source.split('\n'), curLine = currentLine();
  $('#ed-hl').innerHTML = lines.map((l, i) => {
    const h = highlight(l, syms) || ' ';
    return i + 1 === curLine ? `<span class="cur">${h}</span>` : h;
  }).join('\n') + '\n';
  ta.style.height = (lines.length * 21) + 'px';
}
function renderGutter() {
  const lines = st.source.split('\n'), res = st.asm;
  const byLine = new Map();
  res?.listing.forEach(l => { if (!byLine.has(l.line) || l.bytes.length) byLine.set(l.line, l); });
  const errs = new Map((res?.errors || []).map(e => [e.line, e.message]));
  const curLine = currentLine();
  $('#ed-gutter').innerHTML = lines.map((_, i) => {
    const l = byLine.get(i + 1), a = l && l.addr != null && l.bytes.length ? l.addr : null;
    const bytes = l?.bytes.length ? l.bytes.slice(0, 4).map(v => hex(v)).join(' ') + (l.bytes.length > 4 ? ' …' : '') : '';
    const cls = (i + 1 === curLine ? ' cur' : '') + (errs.has(i + 1) ? ' err' : '');
    return `<div class="g${cls}" data-line="${i + 1}" ${errs.has(i + 1) ? `title="${esc(errs.get(i + 1))}"` : ''}><span class="bp${a != null && st.bps.has(a) ? ' on' : ''}" data-a="${a ?? ''}"></span><span class="no">${i + 1}</span><span class="ad">${a != null ? hex(a, 4) : ''}</span><span class="by">${bytes}</span></div>`;
  }).join('');
  $('#ed-gutter').classList.toggle('stale', !!st.asm && st.asm.source !== st.source);
}
function currentLine() {
  if (!st.loaded || st.running || !cpu) return null;
  return st.lineOfAddr.get(cpu.pc) ?? null;
}
function assembleNow() {
  const res = assemble(st.source);
  res.source = st.source;
  st.asm = res;
  renderSymbols(); renderHighlight(); renderGutter();
  return res;
}
ta.addEventListener('input', () => {
  st.source = ta.value;
  store.set('source.' + family(), st.source);
  renderHighlight();
  $('#ed-gutter').classList.add('stale');
  clearTimeout(asmTimer);
  asmTimer = setTimeout(() => {
    const res = assembleNow();
    $('#hint').innerHTML = res.ok ? `Assembly OK · ${size(res)} bytes · F7 to load into the machine`
      : `<span class="err">${res.errors.length} error${res.errors.length > 1 ? 's' : ''} — line ${res.errors[0].line}: ${esc(res.errors[0].message)}</span>`;
  }, 350);
});
ta.addEventListener('keydown', e => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const s = ta.selectionStart, line = ta.value.lastIndexOf('\n', s - 1) + 1, n = 8 - ((s - line) % 8);
    ta.setRangeText(' '.repeat(n), s, ta.selectionEnd, 'end');
    ta.dispatchEvent(new Event('input'));
  }
});
const updateCaret = () => {
  const s = ta.selectionStart, before = ta.value.slice(0, s);
  st.caret = { line: before.split('\n').length, col: s - before.lastIndexOf('\n') };
  renderStatus();
};
ta.addEventListener('keyup', updateCaret);
ta.addEventListener('click', updateCaret);
$('#ed-gutter').addEventListener('click', e => {
  const bp = e.target.closest('.bp');
  if (bp && bp.dataset.a) toggleBp(+bp.dataset.a);
});
$('#ed').addEventListener('mousemove', e => {
  const r = $('#ed-hl').getBoundingClientRect(), line = Math.floor((e.clientY - r.top) / 21) + 1;
  if (line === st.hoverLine) return;
  st.hoverLine = line;
  const l = st.asm?.listing.find(x => x.line === line && x.bytes.length);
  if (!l) return;
  const d = disassemble(a => l.bytes[(a - l.addr) & 0xFFFF] ?? 0, l.addr);
  const isData = /^\s*(\S+:)?\s*(DB|DEFB|DM|DEFM|DW|DEFW|DS|DEFS)\b/i.test(l.source) || (/^\S+\s+(DB|DW|DS)\b/i.test(l.source));
  const t = Array.isArray(d.tstates) ? `${d.tstates[0]} if taken, ${d.tstates[1]} otherwise` : d.tstates;
  const t0 = typeof d.tstates === 'number' ? d.tstates : d.tstates[0];
  $('#hint').innerHTML = !isData && d.mnemonic !== 'DB'
    ? `<b>${esc(d.text)}</b> · opcode <b>${d.bytes.map(v => hex(v)).join(' ')}</b> · <b>${t} T-states</b> (${t0 / 4} µs at 4 MHz${isCpc() ? `, ${Math.ceil(t0 / 4)} NOPs on CPC` : ''}) · address <b>&amp;${hex(l.addr, 4)}</b>`
    : `Data: <b>${l.bytes.length} byte${l.bytes.length > 1 ? 's' : ''}</b> at <b>&amp;${hex(l.addr, 4)}</b>`;
});
function toggleBp(a) {
  st.bps.has(a) ? st.bps.delete(a) : st.bps.add(a);
  store.set('bps.' + family(), [...st.bps]);
  renderGutter(); renderBps(); renderDis();
}
function setSource(src, name) {
  st.source = src; st.fileName = name;
  ta.value = src;
  store.set('source.' + family(), src); store.set('fileName.' + family(), name);
  $('#file-name').textContent = name;
  st.bps.clear(); store.set('bps.' + family(), []);
  if (st.kind === 'min') loadProgram();
  else assembleNow();
}

/* =====================================================================
   Loading, execution
   ===================================================================== */
function loadProgram() {
  const res = assembleNow();
  $('#console').innerHTML = '';
  log(`<span class="cmd">&gt; assembling ${esc(st.fileName)}</span>`);
  if (!res.ok) {
    res.errors.forEach(e => log(`line ${e.line}: ${esc(e.message)}`, 'err" data-line="' + e.line));
    log(`${res.errors.length} error(s): the machine is unchanged.`, 'w');
    activate('dock', 'con');
    return false;
  }
  res.warnings.forEach(w => log(`line ${w.line}: warning — ${esc(w.message)}`, 'w'));
  st.loaded = res;
  st.lineOfAddr = new Map();
  res.listing.forEach(l => { if (l.bytes.length && !st.lineOfAddr.has(l.addr)) st.lineOfAddr.set(l.addr, l.line); });
  if (st.kind === 'min') {
    stop('Program loaded');
    if (res.segments.some(s => s.bytes.some((_, i) => !m.chipAt(s.start + i)))) log('Warning: some bytes fall outside the EPROM (&0000–&1FFF) and the SRAM (&8000–&9FFF); they are ignored.', 'w');
    m.load(res.segments);
    log(`<span class="ok">✓ ${size(res)} bytes assembled, EPROM programmed, processor reset.</span>`);
    hardReset();
  } else {
    m.load(res.segments);
    const lo = Math.min(...res.segments.map(s => s.start)), entry = res.entry ?? lo;
    log(`<span class="ok">✓ ${size(res)} bytes injected into RAM from &amp;${hex(lo, 4)}.</span>`);
    if (lo < 0x4000 || res.segments.some(s => s.start + s.bytes.length > 0xA67F)) log('Warning: the program overlaps an area used by the firmware or BASIC (recommended: &4000–&A67F).', 'w');
    if ($('#auto-call').checked) {
      m.keyboard.type(`CALL &${hex(entry, 4)}\r`);
      log(`Auto-typed: CALL &amp;${hex(entry, 4)}`);
      if (!st.running) run();
      activate('ws', 'machine');
    } else log(`Type CALL &amp;${hex(entry, 4)} in BASIC to start the program.`);
  }
  refresh(true);
  return true;
}
$('#console').addEventListener('click', e => {
  const l = e.target.closest('[data-line]');
  if (!l) return;
  activate('ws', 'editor');
  const lines = ta.value.split('\n'), n = +l.dataset.line;
  const start = lines.slice(0, n - 1).reduce((s, x) => s + x.length + 1, 0);
  ta.focus(); ta.setSelectionRange(start, start + lines[n - 1].length);
  $('#ed').scrollTop = (n - 5) * 21;
});

function hardReset() {
  m.reset();
  st.cur = null; st.history = []; st.instrCount = 0;
  st.prevRegs = cpu.getRegs();
  LA.cursor = null;
  refresh(true);
}
const nextIsInterrupt = () => cpu.nmiPending || (cpu.intLine && cpu.iff1 && !cpu.eiDelay) || (isCpc() && m.ga.intRequest && cpu.iff1 && !cpu.eiDelay);

function execInstr(withTrace) {
  const before = cpu.getRegs();
  let d;
  if (nextIsInterrupt()) d = { addr: cpu.pc, bytes: [], text: cpu.nmiPending ? 'NMI → &0066' : `Interrupt (IM ${cpu.im})`, mnemonic: 'INT', operands: [], tstates: 0 };
  else if (cpu.halted) d = { addr: cpu.pc, bytes: [], text: 'HALT (waiting for an interrupt)', mnemonic: 'HALT', operands: [], tstates: 4 };
  else d = disassemble(read, cpu.pc);
  const hs = isCpc() && m.crtc.hsync, vs = isCpc() && m.crtc.vsync;
  cpu.trace = withTrace ? [] : null;
  m.step();
  st.instrCount++;
  const after = cpu.getRegs(), trace = cpu.trace;
  cpu.trace = null;
  let histStart = null;
  if (trace) {
    histStart = st.history.length;
    let lastAddr = null;
    trace.forEach((c, i) => {
      const e = { ...c, int: cpu.intLine, halted: before.HALT === 1, hs, vs };
      if (c.type === 'X') e.addr = lastAddr;
      else lastAddr = c.type === 'M1' || c.type === 'INTA' ? c.refresh : c.addr;
      if (i === 0) e.label = d.text;
      st.history.push(e);
    });
    if (st.history.length > HISTORY_MAX) {
      const cut = st.history.length - HISTORY_MAX;
      st.history.splice(0, cut);
      histStart -= cut;
    }
  }
  return { d, before, after, trace, histStart };
}
function operandValue(op, before, trace) {
  if (!op) return null;
  if (op in before && op.length === 1) return before[op];
  if (/^&[0-9A-F]{2}$/.test(op)) return parseInt(op.slice(1), 16);
  if (/^\(/.test(op)) { const r = [...trace].reverse().find(c => c.type === 'MR'); return r ? r.data : null; }
  return null;
}
function beginInstr() {
  const res = execInstr(true);
  const steps = microSteps(res.trace, res.d, res.before, res.after);
  const ops = res.d.operands, src = ops.length === 2 ? ops[1] : ops[0];
  const alu = steps.some(s => s.blocks.includes('b-alu'));
  res.inside = {
    ir: st.cur?.inside.ir ?? null, dec: st.cur?.inside.dec ?? '',
    acc: alu ? res.before.A : null, tmp: alu ? operandValue(src, res.before, res.trace) : null, alu: alu ? res.d.mnemonic : '—',
  };
  res.alu = res.d.mnemonic === 'INT' || res.d.mnemonic === 'HALT' ? null : aluInfo(res.d, res.before, res.after, res.trace);
  res.decode = res.d.bytes.length ? decodeInfo(res.d) : null;
  if (res.alu) { res.inside.acc = res.alu.acc; res.inside.tmp = res.alu.tmp; res.inside.alu = res.alu.op; }
  addTransfers(steps, res.d, res.before, res.after, res.trace, res.alu);
  res.steps = steps; res.k = 0;
  res.id = (st.instrSeq = (st.instrSeq || 0) + 1);
  st.cur = res;
  st.prevRegs = res.before;
}
function stepT() {
  if (st.running) stop('Single step');
  if (!st.cur || st.cur.k >= st.cur.steps.length - 1) beginInstr(); else st.cur.k++;
  afterStep();
}
function stepBackT() { if (st.cur && st.cur.k > 0) { st.cur.k--; refresh(true); } }
function stepInstr() {
  if (st.running) stop('Single step');
  if (st.cur && st.cur.k < st.cur.steps.length - 1) st.cur.k = st.cur.steps.length - 1;
  else { beginInstr(); st.cur.k = st.cur.steps.length - 1; }
  afterStep();
}
function afterStep() {
  const c = st.cur;
  for (let j = 0; j <= c.k; j++) { if (c.steps[j].ir != null) c.inside.ir = c.steps[j].ir; if (c.steps[j].dec) c.inside.dec = c.steps[j].dec; }
  st.stopReason = cpu.halted && c.k === c.steps.length - 1 ? 'HALT: waiting for an interrupt' : 'Single step';
  refresh(true);
}

/* ---------- Continuous execution ---------- */
function run() {
  if (st.running) { stop('Pause'); return; }
  if (st.kind === 'min' && !st.loaded && !loadProgram()) return;
  st.cur = null;
  st.running = true;
  st.first = true;
  st.lastFrame = performance.now();
  st.measureT = cpu.cycles; st.measureAt = st.lastFrame;
  st.budget = 0;
  $('#btn-run').innerHTML = '❚❚ Pause';
  renderHighlight(); renderGutter();
  requestAnimationFrame(frame);
}
function stop(reason) {
  if (!cpu) return;
  st.running = false;
  st.stopReason = reason;
  $('#btn-run').innerHTML = '▶ Run';
  st.cur = null;
  if (isCpc()) pumpAudio(false);
  refresh(true);
}
function frame(now) {
  if (!st.running) return;
  const dt = Math.min(now - st.lastFrame, 50);
  st.lastFrame = now;
  const speed = +$('#speed').value;
  // while pasting, the emulation runs 8 times faster to type the text quickly
  const pasting = isCpc() && st.pasting && m.keyboard.typing;
  if (st.pasting && !pasting) { st.pasting = false; log('Paste finished.'); }
  st.budget += speed * (pasting ? 8 : 1) * dt / 1000;
  const traceAll = speed <= 4000, start = cpu.cycles;
  let hit = false;
  while (cpu.cycles - start < st.budget) {
    if (!st.first && st.bps.has(cpu.pc) && !cpu.halted && !nextIsInterrupt()) { hit = true; break; }
    if (st.kind === 'min' && cpu.halted && !cpu.iff1 && !cpu.nmiPending) break;
    st.first = false;
    execInstr(traceAll || st.budget - (cpu.cycles - start) < 200);
  }
  st.budget = Math.max(0, st.budget - (cpu.cycles - start));
  if (now - st.measureAt > 500) {
    st.measured = (cpu.cycles - st.measureT) / ((now - st.measureAt) / 1000);
    st.measureT = cpu.cycles; st.measureAt = now;
  }
  if (isCpc()) pumpAudio(speed === 4000000 && !pasting);
  if (hit) { stop(`Breakpoint hit at &${hex(cpu.pc, 4)}`); activate('ws', 'editor'); return; }
  if (st.kind === 'min' && cpu.halted && !cpu.iff1 && !cpu.nmiPending) {
    stop('HALT with interrupts disabled: processor stuck');
    log('HALT executed after DI: only /NMI or /RESET can restart the processor.', 'w');
    return;
  }
  refresh(false, now);
  requestAnimationFrame(frame);
}

/* =====================================================================
   Rendering
   ===================================================================== */
let slowTick = 0;
function refresh(full, now = performance.now()) {
  if (!cpu) return;
  const heavy = full || now - slowTick > 120;
  if (heavy) slowTick = now;
  const regs = st.cur && st.cur.k < st.cur.steps.length - 1 ? st.cur.before : cpu.getRegs();
  if (isCpc() && visible('machine')) renderCpcPanel(now);
  if (!heavy) return;
  renderRegs(regs);
  renderStatus();
  if (st.kind === 'min') renderMinPanel();
  if (visible('editor') && !st.running) { renderHighlight(); renderGutter(); }
  if (visible('cpu')) renderCPU(regs);
  if (visible('board')) updateBoard(st.cur?.steps[st.cur.k]);
  if (openChipId && !$('#modal').hidden) renderOpenChip();
  if (visible('la')) renderAnalyzer();
  if (visible('mem')) renderMem(regs);
  if (visible('dis')) renderDis();
  if (visible('io')) renderIO();
  renderBps();
}
function renderCPU(regs) {
  const c = st.cur;
  updateCPU({
    steps: c ? c.steps : [], k: c ? c.k : 0, regs, instr: c ? c.d : null,
    inside: c ? c.inside : { ir: null, dec: '', acc: null, tmp: null, alu: '—' },
    lines: { int: cpu.intLine, halt: cpu.halted },
    key: c ? `${c.id}:${c.k}` : '', aluInfo: c ? c.alu : null, decode: c ? c.decode : null,
  });
}
function renderAnalyzer() {
  const h = st.history;
  let w0 = h.length, tot = 0;
  const minStart = st.cur && st.cur.histStart != null ? Math.max(0, st.cur.histStart) : h.length;
  while (w0 > 0 && (tot < 96 || w0 > minStart)) { w0--; tot += h[w0].t; }
  const tr = buildTrace(h.slice(w0), { leds0: m.leds ?? 0, switches: m.switches ?? 0 });
  if (st.cur && !st.running && st.cur.histStart != null) {
    LA.cursor = (h.slice(w0, st.cur.histStart).reduce((s, c) => s + c.t, 0) + st.cur.k) * 8 + 4;
  } else LA.cursor = null;
  st.laTrace = tr;
  renderLA(tr);
  if (LA.cursor != null) {
    const wv = $('#la-wave'), x = LA.cursor * LA.zoom;
    if (x < wv.scrollLeft || x > wv.scrollLeft + wv.clientWidth - 40) wv.scrollLeft = x - wv.clientWidth / 2;
  }
}
$('#la-names').addEventListener('click', e => {
  const x = e.target.closest('[data-x]');
  if (x) { LA.sigs = LA.sigs.filter(s => s !== x.dataset.x); renderAnalyzer(); }
});
$('#la-zp').onclick = () => { LA.zoom = Math.min(12, LA.zoom + 1); renderAnalyzer(); };
$('#la-zm').onclick = () => { LA.zoom = Math.max(1, LA.zoom - 1); renderAnalyzer(); };
function onSignal(s) { addSignal(s, st.laTrace || buildTrace([], { leds0: 0, switches: 0 })); activate('dock', 'la'); }
function onOpen(what, id) { if (what === 'chip') openChip(id); else activate('ws', what); }

function renderRegs(r) {
  const final = !st.cur || st.cur.k === st.cur.steps.length - 1;
  const changed = final && !st.running && st.prevRegs ? new Set(changedRegs(st.prevRegs, r)) : new Set();
  const pair = (a, b) => (r[a] << 8) | r[b];
  const chg = (...ks) => ks.some(k => changed.has(k)) ? ' chg' : '';
  const rows = [
    ['AF', pair('A', 'F'), chg('A', 'F')], ["AF'", pair("A'", "F'"), chg("A'", "F'"), 1],
    ['BC', pair('B', 'C'), chg('B', 'C')], ["BC'", pair("B'", "C'"), chg("B'", "C'"), 1],
    ['DE', pair('D', 'E'), chg('D', 'E')], ["DE'", pair("D'", "E'"), chg("D'", "E'"), 1],
    ['HL', pair('H', 'L'), chg('H', 'L')], ["HL'", pair("H'", "L'"), chg("H'", "L'"), 1],
    ['IX', r.IX, chg('IX')], ['IY', r.IY, chg('IY')], ['SP', r.SP, chg('SP')], ['PC', r.PC, chg('PC')],
    ['I', r.I, chg('I'), 0, 2], ['R', r.R, chg('R'), 0, 2],
  ];
  $('#regs').innerHTML = rows.map(([n, v, c, alt, w]) => `<div class="r${c}${alt ? ' alt' : ''}" data-r="${n}" title="${n} = ${v} (decimal) · click to edit"><span>${n}</span><b>${hex(v, w || 4)}</b></div>`).join('');
  $('#reg-note').textContent = st.cur ? `${st.cur.steps[st.cur.k]?.m || ''} T${st.cur.steps[st.cur.k]?.t || ''}` : '';
  const fl = [['S', 'sign'], ['Z', 'zero'], ['Y', 'bit 5 (undoc.)'], ['H', 'half carry'], ['X', 'bit 3 (undoc.)'], ['P/V', 'parity / overflow'], ['N', 'subtract'], ['C', 'carry']];
  $('#flags').innerHTML = fl.map(([n, d], i) => `<div class="flag${(r.F >> (7 - i)) & 1 ? ' on' : ''}" title="${d}">${n}<small>${(r.F >> (7 - i)) & 1}</small></div>`).join('');
  $('#abits').innerHTML = [...Array(8)].map((_, i) => `<span class="${(r.A >> (7 - i)) & 1 ? 'on' : ''}" title="bit ${7 - i}">${(r.A >> (7 - i)) & 1}</span>`).join('');
  $('#intr').innerHTML = `<span>IM <b>${r.IM}</b></span><span>IFF1 <b>${r.IFF1}</b></span><span>IFF2 <b>${r.IFF2}</b></span><span>HALT <b>${r.HALT}</b></span>`;
  $('#stack').innerHTML = [0, 2, 4, 6].map(o => {
    const a = (r.SP + o) & 0xFFFF;
    return `<div class="${o === 0 ? 'top' : ''}"><span>&amp;${hex(a, 4)}</span>${hex(read(a + 1) << 8 | read(a), 4)}${o === 0 ? ' ← SP' : ''}</div>`;
  }).join('');
}
$('#regs').addEventListener('click', e => {
  const cell = e.target.closest('.r');
  if (!cell || st.running || cell.querySelector('input')) return;
  const name = cell.dataset.r, b = cell.querySelector('b');
  const inp = document.createElement('input');
  inp.value = b.textContent;
  b.replaceWith(inp);
  inp.focus(); inp.select();
  let done = false;
  const finish = ok => {
    if (done) return;
    done = true;
    if (ok) {
      const v = parseNum(inp.value.startsWith('&') ? inp.value : '&' + inp.value);
      if (!isNaN(v)) {
        if (name.endsWith("'")) { cpu.setReg(name[0] + "'", v >> 8); cpu.setReg(name[1] + "'", v & 0xFF); }
        else cpu.setReg(name, v);
        st.cur = null;
        log(`${name} ← &${hex(v, name.length === 1 ? 2 : 4)} (edited by hand)`);
      }
    }
    refresh(true);
  };
  inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') finish(true); if (ev.key === 'Escape') finish(false); });
  inp.addEventListener('blur', () => finish(true));
});
function renderBps() {
  $('#bplist').innerHTML = [...st.bps].sort((a, b) => a - b).map(a => `<div data-a="${a}"><i></i>&amp;${hex(a, 4)} <em>line ${st.lineOfAddr.get(a) ?? '?'}</em></div>`).join('') || '<div class="muted">none · click in the margin</div>';
}
$('#bplist').addEventListener('click', e => { const d = e.target.closest('[data-a]'); if (d) toggleBp(+d.dataset.a); });
function renderSymbols() {
  const syms = Object.entries(st.asm?.symbols || {}).sort((a, b) => a[1] - b[1]);
  $('#symbols').innerHTML = syms.map(([n, a]) => `<tr data-n="${esc(n)}"><td>${esc(n)}</td><td>&amp;${hex(a, 4)}</td></tr>`).join('') || '<tr><td class="muted">—</td></tr>';
}
$('#symbols').addEventListener('click', e => {
  const tr = e.target.closest('tr[data-n]');
  if (!tr) return;
  $('#mem-addr').value = '&' + hex(st.asm.symbols[tr.dataset.n], 4);
  activate('dock', 'mem');
});
function renderMem(r) {
  let start = parseNum($('#mem-addr').value);
  if (isNaN(start)) start = 0;
  start &= 0xFFF0;
  const hl = (r.H << 8) | r.L;
  let html = '';
  for (let row = 0; row < 16; row++) {
    const a = (start + row * 16) & 0xFFFF;
    let hx = '', as = '';
    for (let i = 0; i < 16; i++) {
      const ad = (a + i) & 0xFFFF, v = read(ad);
      const c = ad === r.PC ? 'pc' : ad === hl ? 'hl' : ad === r.SP ? 'sp' : m.chipAt(ad) ? '' : 'z';
      hx += `<span class="${c}">${hex(v)}</span> `;
      as += v >= 32 && v < 127 ? esc(String.fromCharCode(v)) : '·';
    }
    const chip = m.chipAt(a);
    html += `<div class="row"><span class="a">&amp;${hex(a, 4)}</span><span class="hx">${hx}</span><span class="as">${as}</span><span class="muted">${chip === 'rom' ? 'EPROM' : chip === 'ram' ? 'SRAM' : chip || 'not wired'}</span></div>`;
  }
  $('#mem').innerHTML = html + '<div class="gap">Legend: <span style="background:#ffd54f;color:#111;padding:0 3px">PC</span> · <span style="outline:1px solid #ffa726;color:#ffa726;padding:0 3px">(HL)</span> · <span style="outline:1px dashed #8a95a8;padding:0 3px">SP</span></div>';
}
$('#mem-addr').addEventListener('change', () => refresh(true));
$('.mem-tools').addEventListener('click', e => {
  const b = e.target.closest('[data-mem]'); if (!b) return;
  const r = cpu.getRegs();
  const a = { pc: r.PC, sp: r.SP, hl: (r.H << 8) | r.L, ram: +(b.dataset.addr || 32768) }[b.dataset.mem];
  $('#mem-addr').value = '&' + hex(a, 4);
  refresh(true);
});
function renderDis() {
  if (!visible('dis')) return;
  const pc = cpu.pc;
  const addrs = [...st.lineOfAddr.keys()].filter(a => a < pc && pc - a < 64).sort((a, b) => a - b).slice(-4);
  const list = disassembleRange(read, addrs.length ? addrs[0] : pc, 24);
  const sym = new Map(Object.entries(st.loaded?.symbols || {}).map(([n, a]) => [a, n]));
  $('#dis').innerHTML = '<table>' + list.map(d => {
    const t = Array.isArray(d.tstates) ? d.tstates.join('/') : d.tstates;
    return `<tr class="${d.addr === pc ? 'cur' : ''}" data-a="${d.addr}"><td class="bp">${st.bps.has(d.addr) ? '<i></i>' : ''}</td><td class="a">${d.addr === pc ? '▶ ' : '  '}&amp;${hex(d.addr, 4)}</td><td class="b">${d.bytes.map(v => hex(v)).join(' ').padEnd(11)}</td><td class="tk-l">${sym.has(d.addr) ? esc(sym.get(d.addr)) : ''}</td><td>${highlight('  ' + d.text)}</td><td class="t">${t} T</td><td class="muted">${esc(m.chipAt(d.addr) || '')}</td></tr>`;
  }).join('') + '</table>';
}
$('#dis').addEventListener('click', e => { const tr = e.target.closest('tr[data-a]'); if (tr) toggleBp(+tr.dataset.a); });

function portName(x) {
  if (!isCpc()) return x.dir === 'out' ? (x.port & 1 ? 'none (A0 = 1)' : '74LS374 → LEDs') : (x.port & 1 ? '74LS244 ← switches' : 'none: floating bus');
  const p = x.port, n = [];
  if ((p & 0xC000) === 0x4000) n.push(x.value >> 6 === 3 ? 'PAL (RAM)' : 'Gate Array');
  if (!(p & 0x4000)) n.push(['CRTC select', 'CRTC write', 'CRTC status', 'CRTC read'][(p >> 8) & 3]);
  if (!(p & 0x2000)) n.push('upper ROM select');
  if (!(p & 0x1000)) n.push('printer');
  if (!(p & 0x0800)) n.push(['PPI A (PSG)', 'PPI B', 'PPI C', 'PPI control'][(p >> 8) & 3]);
  if (!(p & 0x0480)) n.push(p & 0x0100 ? (p & 1 ? 'FDC data' : 'FDC status') : 'disc motor');
  return n.join(' + ') || 'none';
}
function renderIO() {
  const rows = m.io.slice().reverse().slice(0, 24);
  $('#io').innerHTML = '<table><tr><th>T-state</th><th>Dir</th><th>Port</th><th>Value</th><th>Chip</th></tr>' +
    (rows.map(x => `<tr><td class="muted">${x.t.toLocaleString('en-US')}</td><td>${x.dir === 'out' ? 'OUT →' : '← IN'}</td><td class="tk-n">&amp;${hex(x.port, 4)}</td><td class="tk-r">&amp;${hex(x.value)} <span class="muted">${x.value.toString(2).padStart(8, '0')}</span></td><td class="muted">${portName(x)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">no I/O operation yet</td></tr>') + '</table>';
}

/* ---------- Minimal machine panel ---------- */
function renderMinPanel() {
  const leds = m.leds;
  $('#leds').innerHTML = [...Array(8)].map((_, i) => `<span class="led8${(leds >> (7 - i)) & 1 ? ' on' : ''}"><i></i>Q${7 - i}</span>`).join('');
  $('#leds-val').textContent = `&${hex(leds)} · ${leds.toString(2).padStart(8, '0')}`;
  $('#switches').innerHTML = [...Array(8)].map((_, i) => `<span class="sw8${(m.switches >> (7 - i)) & 1 ? ' on' : ''}" data-b="${7 - i}"><i></i>${7 - i}</span>`).join('');
  $('#sw-val').textContent = `&${hex(m.switches)} · ${m.switches.toString(2).padStart(8, '0')}`;
  $('#m-state').textContent = cpu.halted ? 'The processor is in HALT: it executes NOPs while waiting for /INT or /NMI.' : st.running ? 'The processor is running the program.' : 'The processor is stopped.';
}
$('#switches').addEventListener('click', e => {
  const s = e.target.closest('[data-b]'); if (!s) return;
  m.switches ^= 1 << +s.dataset.b;
  refresh(true);
});
$('#m-reset').onclick = () => { log('/RESET'); hardReset(); };
$('#m-nmi').onclick = () => { cpu.nmi(); log('/NMI: pulse'); refresh(true); };
const intOn = on => { cpu.irq(on); $('#m-int').classList.toggle('on', on); refresh(true); };
$('#m-int').addEventListener('mousedown', () => intOn(true));
$('#m-int').addEventListener('mouseup', () => intOn(false));
$('#m-int').addEventListener('mouseleave', () => { if (cpu.intLine && st.kind === 'min') intOn(false); });

function renderStatus() {
  const state = st.running ? '<span class="st-run">▶ Running</span>' : `<span class="st-pause">❚❚ ${esc(st.stopReason)}</span>`;
  const speed = st.running && st.measured ? ` · ${(st.measured / 1e6).toLocaleString('en-US', { maximumFractionDigits: 3 })} MHz effective` : '';
  const asmTxt = st.asm ? (st.asm.ok ? `Assembly OK · ${size(st.asm)} bytes` : `${st.asm.errors.length} error(s)`) : '';
  $('#status').innerHTML = `${state}<span>${MACHINES[st.kind].label} · Z80A ${speed ? speed.slice(3) : '4 MHz'}</span><span>T-states: ${cpu.cycles.toLocaleString('en-US')}</span><span>Instructions: ${st.instrCount.toLocaleString('en-US')}</span><span>PC &amp;${hex(cpu.pc, 4)}</span><span>${asmTxt}</span><span class="right">${st.caret ? `Ln ${st.caret.line}, Col ${st.caret.col} · ` : ''}${esc(st.fileName)}</span>`;
}
function renderConfig() {
  const cfg = isCpc()
    ? [['Processor', 'Z80A NMOS · 4 MHz'], ['Memory', '128 KB RAM · 48 KB ROM'], ['ROM', `OS 6128${st.kind === 'cpcfr' ? ' French' : ''} · BASIC 1.1 · AMSDOS`], ['Keyboard', st.kind === 'cpcfr' ? 'AZERTY, accents é è à ç ù' : 'QWERTY'], ['Video', 'Gate Array 40010 · CRTC 6845'], ['Sound', 'AY-3-8912'], ['Discs', 'µPD765A · 2 .DSK drives']]
    : [['Processor', 'Z80A NMOS · 4 MHz'], ['EPROM', '2764 · 8 KB · &0000–&1FFF'], ['SRAM', '6264 · 8 KB · &8000–&9FFF'], ['Output', 'port &00 → 8 LEDs'], ['Input', 'port &01 ← 8 switches']];
  $('#config').innerHTML = cfg.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  $('#examples').innerHTML = EXAMPLES.map((x, i) => x.machine === family() ? `<li data-i="${i}" title="${esc(x.title)}"><span class="fi asm">ASM</span>${esc(x.name)}</li>` : '').join('');
}
$('#examples').addEventListener('click', e => {
  const li = e.target.closest('li'); if (!li) return;
  const ex = EXAMPLES[+li.dataset.i];
  setSource(ex.source, ex.name);
  activate('ws', 'editor');
});

// inside view of a chip, refreshed live while the window is open
let openChipId = null;
function openChip(id) {
  const c = chipBlocks(id);
  openChipId = id;
  $('#modal-title').textContent = `Inside: ${c.name} — ${c.sub}`;
  $('#modal').classList.add('wide');
  renderOpenChip();
  $('#modal').hidden = false;
}
function renderOpenChip() {
  if (!openChipId) return;
  const kind = isCpc() ? 'cpc' : 'min', step = st.cur?.steps[st.cur.k] || null;
  if (hasChipView(kind, openChipId)) { $('#modal-body').innerHTML = renderChipView(kind, openChipId, m, { step }); return; }
  const c = chipBlocks(openChipId);
  $('#modal-body').innerHTML = `<div class="ib-grid">${c.blocks.map(([n, d, v]) => `<div class="ib"><b>${n}</b><span>${d}</span>${v ? `<code>${v}</code>` : ''}</div>`).join('')}</div>
    ${c.regs.length ? `<div class="sect" style="margin-top:14px">Current state</div><div class="ib-grid">${c.regs.map(([k, v]) => `<div class="ib"><span>${k}</span><code>${v}</code></div>`).join('')}</div>` : ''}`;
}
const closeChip = () => { $('#modal').hidden = true; openChipId = null; };
$('#modal-close').onclick = closeChip;
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeChip(); });

/* =====================================================================
   Commands
   ===================================================================== */
$('#btn-asm').onclick = () => loadProgram();
$('#btn-run').onclick = () => run();
$('#btn-instr').onclick = $('#cpu-instr').onclick = () => stepInstr();
$('#btn-tstate').onclick = $('#cpu-next').onclick = () => stepT();
$('#cpu-prev').onclick = () => stepBackT();
$('#btn-reset').onclick = () => {
  const wasRunning = st.running || isCpc();
  stop('Reset'); hardReset(); log('Hardware reset.');
  if (isCpc()) releaseAllKeys();
  if (wasRunning && isCpc()) run();
};
$('#cpu-play').onclick = e => {
  if (st.playTimer) { clearInterval(st.playTimer); st.playTimer = null; e.target.classList.remove('on'); e.target.textContent = '▶ Animate'; return; }
  e.target.classList.add('on'); e.target.textContent = '❚❚ Pause';
  st.playTimer = setInterval(stepT, 900);
};
function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$('#btn-save').onclick = () => download(st.fileName, new Blob([st.source], { type: 'text/plain' }));
$('#btn-bin').onclick = () => {
  const res = st.asm?.ok ? st.asm : assembleNow();
  if (!res.ok) { log('The source has errors: nothing to export.', 'w'); activate('dock', 'con'); return; }
  const lo = Math.min(...res.segments.map(s => s.start)), hi = Math.max(...res.segments.map(s => s.start + s.bytes.length));
  const out = new Uint8Array(hi - lo);
  res.segments.forEach(s => out.set(s.bytes, s.start - lo));
  download(st.fileName.replace(/\.\w+$/, '') + '.bin', new Blob([out], { type: 'application/octet-stream' }));
  log(`Exported: ${out.length} bytes from &${hex(lo, 4)}.`);
};
$('#btn-open').onclick = () => $('#file-in').click();
$('#file-in').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  setSource(await f.text(), f.name);
  e.target.value = '';
});

// a menu, checkbox or button that keeps the focus must not capture typing
const isTextField = el => !!el && el.offsetParent !== null &&
  (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && /^(text|number|search)$/.test(el.type)));
// AltGr (| # @ [ ] { } \ ` ^ on AZERTY) arrives as Ctrl+Alt on Windows: it is not a shortcut
const altGr = e => e.getModifierState?.('AltGraph') || (e.ctrlKey && e.altKey);
// the keyboard always goes to the CPC (full screen included), except on the Editor tab and in a visible text field
const toCpc = e => isCpc() && (!!document.fullscreenElement || (!visible('editor') && !isTextField(e.target))) &&
  (!e.ctrlKey || e.key === 'Control' || altGr(e)) && !/^F\d+$/.test(e.key);
const focusScreen = () => { if (isCpc() && visible('machine')) $('#crt').focus({ preventScroll: true }); };
document.addEventListener('keydown', e => {
  if (toCpc(e) && hostKey(e, true)) {
    e.preventDefault();
    if (document.activeElement !== $('#crt')) focusScreen();
    return;
  }
  const k = e.key;
  if (k === 'F5') { e.preventDefault(); run(); }
  else if (k === 'F7') { e.preventDefault(); loadProgram(); }
  else if (k === 'F10') { e.preventDefault(); stepInstr(); }
  else if (k === 'F11') { e.preventDefault(); stepT(); }
  else if (e.ctrlKey && k.toLowerCase() === 's') { e.preventDefault(); $('#btn-save').click(); }
  else if (e.ctrlKey && k.toLowerCase() === 'o') { e.preventDefault(); $('#btn-open').click(); }
  else if (e.ctrlKey && k.toLowerCase() === 'r') { e.preventDefault(); $('#btn-reset').click(); }
});
document.addEventListener('keyup', e => { if (isCpc() && hostKey(e, false)) e.preventDefault(); });
// Ctrl+V: the clipboard text is typed into the CPC (BASIC program, commands…)
document.addEventListener('paste', e => {
  const fake = { target: e.target, ctrlKey: false, key: 'v' };
  if (!toCpc(fake)) return;
  e.preventDefault();
  const text = e.clipboardData?.getData('text/plain') || '';
  if (!text) return;
  // the firmware may have seen the Ctrl of Ctrl+V: release everything and wait 6 frames,
  // otherwise the first character would be typed as CTRL+character
  releaseAllKeys();
  m.keyboard.pause(6);
  const skipped = m.keyboard.type(text);
  st.pasting = true;
  if (!st.running) run();
  const n = text.length - skipped;
  log(`Pasting into the CPC: ${n} characters${skipped ? `, ${skipped} skipped (not on the CPC keyboard)` : ''} — fast typing in progress.`, skipped ? 'w' : '');
});
window.addEventListener('blur', () => { if (isCpc()) releaseAllKeys(); });
$('#crt').addEventListener('click', () => $('#crt').focus());
// after a monitor setting change, the focus goes back to the screen
$$('#mach-cpc .mon-tools select, #mach-cpc .mon-tools input, #mach-cpc .mon-tools button').forEach(el => el.addEventListener('change', focusScreen));
$('#btn-copytext').addEventListener('click', focusScreen);

/* =====================================================================
   Startup
   ===================================================================== */
buildCPU();
initBoardEvents();
switchMachine(st.kind);
// access from the browser console (debugging, tests)
window.z80studio = { get machine() { return m; }, get state() { return st; } };
