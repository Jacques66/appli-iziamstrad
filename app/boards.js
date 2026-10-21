import { hex } from './util.js';

/* Définition des cartes : circuits, lignes, rôle et état de chaque circuit,
   et activité en direct pour un T-state donné. */

const r16 = (r, a, b) => hex((r[a] << 8) | r[b], 4);
const bin8 = v => v.toString(2).padStart(8, '0');

/* ---------------------------------------------------------------------
   Système minimal
   --------------------------------------------------------------------- */
export const MIN_BOARD = {
  title: 'Système Z80 minimal <span>(cliquez un circuit ou une ligne · double-clic pour entrer dans un circuit)</span>',
  viewBox: '0 0 1200 690',
  buses: { A: 300, D: 318, C: 336 }, busX: [200, 1000],
  chips: [
    { id: 'osc', x: 40, y: 60, w: 120, h: 60, name: 'Oscillateur', sub: '4 MHz', ref: 'X1' },
    { id: 'rst', x: 40, y: 160, w: 120, h: 60, name: 'Reset', sub: 'RC + bouton', ref: 'R1 C1' },
    { id: 'z80', x: 220, y: 40, w: 160, h: 200, name: 'Z80A', sub: 'CPU · 4 MHz', ref: 'U1', bus: { A: 250, D: 300, C: 350 } },
    { id: 'mrom', x: 460, y: 80, w: 140, h: 100, name: 'EPROM 2764', sub: '8 Ko · &0000–&1FFF', ref: 'U2', bus: { A: 490, D: 530, C: 570 } },
    { id: 'mram', x: 640, y: 80, w: 140, h: 100, name: 'SRAM 6264', sub: '8 Ko · &8000–&9FFF', ref: 'U3', bus: { A: 670, D: 710, C: 750 } },
    { id: 'mdec', x: 820, y: 80, w: 140, h: 100, name: '74LS138', sub: "décodeur d'adresses", ref: 'U4', bus: { A: 850, C: 930 } },
    { id: 'mout', x: 460, y: 400, w: 140, h: 90, name: '74LS374', sub: 'port de sortie &00', ref: 'U5', bus: { D: 530, C: 570 } },
    { id: 'min', x: 640, y: 400, w: 140, h: 90, name: '74LS244', sub: "port d'entrée &01", ref: 'U6', bus: { D: 710, C: 750 } },
    { id: 'leds', x: 460, y: 550, w: 140, h: 60, name: '8 LED', sub: 'affichage', ext: true },
    { id: 'sw', x: 640, y: 550, w: 140, h: 60, name: '8 interrupteurs', sub: 'saisie', ext: true },
  ],
  wires: [
    { id: 'abus', sig: ['A'], kind: 'addr', w: 5, label: "Bus d'adresses A0–A15", d: 'M200,300 H1000' },
    { id: 'dbus', sig: ['D'], kind: 'data', w: 5, label: 'Bus de données D0–D7', d: 'M200,318 H1000' },
    { id: 'cbus', sig: ['MREQ', 'IORQ', 'RD', 'WR'], kind: 'ctrl', w: 4, label: 'Bus de contrôle /MREQ /IORQ /RD /WR', d: 'M200,336 H1000' },
    { id: 'clk4', sig: ['CLK'], kind: 'clk', label: 'Horloge 4 MHz', d: 'M160,90 H220' },
    { id: 'reset', sig: ['RESET'], kind: 'ctrl', label: '/RESET', d: 'M160,190 H220' },
    { id: 'csrom', sig: ['CSROM'], kind: 'ctrl', label: '/CS EPROM (sortie Y0 du 74LS138)', d: 'M890,80 V50 H530 V80' },
    { id: 'csram', sig: ['CSRAM'], kind: 'ctrl', label: '/CS SRAM (sortie Y4 du 74LS138)', d: 'M870,80 V62 H710 V80' },
    { id: 'csout', sig: ['CSOUT'], kind: 'ctrl', label: 'Horloge du verrou de sortie (port &00)', d: 'M945,180 V385 H585 V400' },
    { id: 'csin', sig: ['CSIN'], kind: 'ctrl', label: "Validation du tampon d'entrée (port &01)", d: 'M915,180 V375 H765 V400' },
    { id: 'ledw', sig: ['LED'], kind: 'data', label: 'Sorties Q0–Q7 → LED', d: 'M530,490 V550' },
    { id: 'sww', sig: ['SW'], kind: 'data', label: 'Interrupteurs → entrées', d: 'M710,550 V490' },
  ],
  info: {
    z80: { role: "Processeur 8 bits NMOS : exécute le programme de l'EPROM, pilote les bus d'adresses (16 bits), de données (8 bits) et de contrôle.", sigs: ['CLK', 'M1', 'MREQ', 'IORQ', 'RD', 'WR', 'RFSH', 'INT', 'HALT', 'A', 'D'], cpu: true },
    osc: { role: 'Oscillateur à quartz 4 MHz : horloge directe du Z80A (période 250 ns).', sigs: ['CLK'] },
    rst: { role: 'Circuit RC qui maintient /RESET à 0 à la mise sous tension ; bouton de reset manuel.', sigs: ['RESET'] },
    mrom: { role: 'EPROM 8 Ko : contient le programme assemblé. Le Z80 démarre en &0000 après un reset. Les écritures sont ignorées.', sigs: ['A', 'D', 'CSROM', 'RD'],
      blocks: [['Décodeur de lignes', 'A0–A12 → 1 octet parmi 8192', ''], ['Matrice EPROM', '65 536 cellules', ''], ['Tampons de sortie', 'actifs si /CS et /OE à 0', '']] },
    mram: { role: 'RAM statique 8 Ko : variables et pile du programme.', sigs: ['A', 'D', 'CSRAM', 'RD', 'WR'],
      blocks: [['Décodeur de lignes', 'A0–A12', ''], ['Matrice SRAM', 'bascules à 6 transistors', ''], ['E/S trois états', 'lecture /OE · écriture /WE', '']] },
    mdec: { role: 'Décodeur 3 vers 8 : A13–A15 choisissent le boîtier mémoire (Y0 = EPROM, Y4 = SRAM) pendant /MREQ ; avec /IORQ et A0 il valide les ports.', sigs: ['A', 'MREQ', 'IORQ', 'CSROM', 'CSRAM', 'CSOUT', 'CSIN'] },
    mout: { role: 'Verrou 8 bits : OUT (&00),A mémorise la valeur et allume les LED correspondantes.', sigs: ['D', 'CSOUT', 'LED'] },
    min: { role: "Tampon trois états : IN A,(&01) place l'état des interrupteurs sur le bus de données.", sigs: ['D', 'CSIN', 'SW'] },
    leds: { role: '8 LED reliées aux sorties du verrou.', sigs: ['LED'], ext: true },
    sw: { role: "8 interrupteurs reliés aux entrées du tampon ; basculez-les dans l'onglet Machine.", sigs: ['SW'], ext: true },
  },
  regs(id, m) {
    const r = m.cpu.getRegs();
    switch (id) {
      case 'z80': return [['PC', hex(r.PC, 4)], ['SP', hex(r.SP, 4)], ['AF', r16(r, 'A', 'F')], ['HL', r16(r, 'H', 'L')], ['T-states', m.cpu.cycles.toLocaleString('fr-FR')]];
      case 'osc': return [['Fréquence', '4,000 MHz'], ['Période', '250 ns']];
      case 'mrom': return [['Plage', '&0000–&1FFF'], ['Octets programmés', m.rom.reduce((n, v) => n + (v !== 0xFF), 0)], ['Premier octet', '&' + hex(m.rom[0])]];
      case 'mram': return [['Plage', '&8000–&9FFF'], ['&8000', '&' + hex(m.ram[0])], ['&8001', '&' + hex(m.ram[1])]];
      case 'mdec': return [['Entrées', 'A13 A14 A15'], ['Y0', 'EPROM'], ['Y4', 'SRAM']];
      case 'mout': case 'leds': return [['Valeur', '&' + hex(m.leds)], ['Binaire', bin8(m.leds)]];
      case 'min': case 'sw': return [['Interrupteurs', '&' + hex(m.switches)], ['Binaire', bin8(m.switches)]];
      default: return [];
    }
  },
  activity(step, m, chips, wires) {
    const mem = step.pins.includes('MREQ') && !step.pins.includes('RFSH');
    if (mem && step.addr != null) {
      if (step.addr < 0x2000) { chips.add('mrom'); wires.add('csrom'); chips.add('mdec'); }
      else if (step.addr >= 0x8000 && step.addr < 0xA000) { chips.add('mram'); wires.add('csram'); chips.add('mdec'); }
    }
    if (step.pins.includes('IORQ') && step.addr != null) {
      chips.add('mdec');
      if (step.pins.includes('WR') && !(step.addr & 1)) { chips.add('mout'); chips.add('leds'); wires.add('csout'); wires.add('ledw'); }
      if (step.pins.includes('RD') && (step.addr & 1)) { chips.add('min'); chips.add('sw'); wires.add('csin'); wires.add('sww'); }
    }
  },
};

/* ---------------------------------------------------------------------
   Amstrad CPC 6128
   --------------------------------------------------------------------- */
export const CPC_BOARD = {
  title: 'Amstrad CPC 6128 — carte mère <span>(schéma fonctionnel · cliquez un circuit ou une ligne · double-clic pour entrer)</span>',
  viewBox: '0 0 1200 690',
  buses: { A: 262, D: 280, C: 298 }, busX: [20, 1170],
  chips: [
    { id: 'xtal', x: 30, y: 40, w: 80, h: 44, name: 'Quartz', sub: '16 MHz', ref: 'X1' },
    { id: 'pal', x: 20, y: 150, w: 115, h: 70, name: 'PAL 40030', sub: 'banques 128 Ko', ref: 'IC118', bus: { A: 100, D: 118 } },
    { id: 'ga', x: 150, y: 30, w: 190, h: 110, name: 'Gate Array', sub: '40010 · vidéo, horloges', ref: 'IC103', bus: { D: 165, C: 185 } },
    { id: 'z80', x: 400, y: 30, w: 150, h: 190, name: 'Z80A', sub: 'CPU · 4 MHz', ref: 'IC101', bus: { A: 430, D: 475, C: 520 } },
    { id: 'rom', x: 600, y: 110, w: 120, h: 110, name: 'ROM 32 Ko', sub: 'OS + BASIC 1.1', ref: 'IC102', bus: { A: 625, D: 660, C: 695 } },
    { id: 'amsdos', x: 735, y: 110, w: 110, h: 110, name: 'ROM 16 Ko', sub: 'AMSDOS', ref: 'IC117', bus: { A: 755, D: 790, C: 825 } },
    { id: 'ram0', x: 860, y: 110, w: 140, h: 110, name: 'DRAM 64 Ko', sub: 'banques 0–3 · 8×4164', ref: 'IC104–111', bus: { A: 890, D: 930, C: 970 } },
    { id: 'ram1', x: 1015, y: 110, w: 140, h: 110, name: 'DRAM 64 Ko', sub: 'banques 4–7 · 8×4164', ref: 'IC119–126', bus: { A: 1045, D: 1085, C: 1125 } },
    { id: 'mon', x: 860, y: 20, w: 295, h: 60, name: 'Moniteur couleur', sub: 'RGB + synchro · CTM644', ext: true },
    { id: 'crtc', x: 150, y: 340, w: 190, h: 90, name: 'CRTC', sub: 'HD6845S · balayage vidéo', ref: 'IC105', bus: { A: 265, D: 295, C: 325 } },
    { id: 'ppi', x: 400, y: 340, w: 150, h: 90, name: 'PPI', sub: '8255 · E/S parallèles', ref: 'IC114', bus: { A: 430, D: 475, C: 520 } },
    { id: 'psg', x: 600, y: 340, w: 150, h: 90, name: 'PSG', sub: 'AY-3-8912 · son', ref: 'IC115' },
    { id: 'fdc', x: 790, y: 340, w: 150, h: 90, name: 'FDC', sub: 'µPD765A · disquettes', ref: 'IC201', bus: { A: 815, D: 845, C: 905 } },
    { id: 'prn', x: 980, y: 340, w: 150, h: 90, name: 'Port imprimante', sub: '74LS273 · Centronics', ref: 'IC116', bus: { A: 1005, D: 1035, C: 1100 } },
    { id: 'kbd', x: 150, y: 500, w: 190, h: 60, name: 'Clavier', sub: 'matrice 10 × 8', ext: true },
    { id: 'kdec', x: 400, y: 500, w: 150, h: 60, name: 'Décodeur clavier', sub: '74LS145', ref: 'IC113' },
    { id: 'amp', x: 600, y: 500, w: 150, h: 60, name: 'Ampli audio', sub: 'mélangeur A+B+C', ref: 'IC120' },
    { id: 'drive', x: 790, y: 500, w: 150, h: 60, name: 'Lecteur 3"', sub: 'A: et B:', ext: true },
    { id: 'printer', x: 980, y: 500, w: 150, h: 60, name: 'Imprimante', sub: 'virtuelle', ext: true },
    { id: 'spk', x: 600, y: 610, w: 150, h: 50, name: 'Haut-parleur', sub: 'interne', ext: true },
  ],
  wires: [
    { id: 'abus', sig: ['A'], kind: 'addr', w: 5, label: "Bus d'adresses A0–A15", d: 'M20,262 H1170' },
    { id: 'dbus', sig: ['D'], kind: 'data', w: 5, label: 'Bus de données D0–D7', d: 'M20,280 H1170' },
    { id: 'cbus', sig: ['M1', 'MREQ', 'IORQ', 'RD', 'WR'], kind: 'ctrl', w: 4, label: 'Bus de contrôle /M1 /MREQ /IORQ /RD /WR', d: 'M20,298 H1170' },
    { id: 'clk16', sig: ['CLK'], kind: 'clk', label: 'Horloge maître 16 MHz', d: 'M110,62 H150' },
    { id: 'clk4', sig: ['CLK'], kind: 'clk', label: 'Horloge CPU 4 MHz (16 MHz ÷ 4)', d: 'M340,55 H400' },
    { id: 'int', sig: ['INT'], kind: 'ctrl', label: '/INT — 300 Hz (toutes les 52 lignes)', d: 'M340,85 H400' },
    { id: 'wait', sig: ['WAIT'], kind: 'ctrl', label: '/WAIT — partage de la RAM avec la vidéo', d: 'M340,115 H400' },
    { id: 'ras', sig: ['MREQ'], kind: 'ctrl', label: '/RAS /CAS — commande des DRAM', d: 'M300,30 V6 H1185 V165 H1155' },
    { id: 'rgb', sig: ['HSYNC', 'VSYNC'], kind: 'video', label: 'Sortie RGB + synchro composite', d: 'M220,30 V14 H1007 V20' },
    { id: 'ma', sig: ['A'], kind: 'addr', label: 'MA0–MA13 / RA0–RA4 — adresse vidéo', d: 'M205,340 V140' },
    { id: 'sync', sig: ['HSYNC', 'VSYNC'], kind: 'video', label: 'HSYNC / VSYNC / DISPEN', d: 'M235,340 V140' },
    { id: 'ppipsg', sig: ['D'], kind: 'data', label: 'PPI port A ↔ bus de données du PSG', d: 'M550,365 H600' },
    { id: 'bdir', sig: ['IORQ'], kind: 'ctrl', label: 'BDIR / BC1 — commande du PSG (PPI port C)', d: 'M550,400 H600' },
    { id: 'krow', sig: ['IORQ'], kind: 'ctrl', label: 'Numéro de ligne clavier (PPI PC0–PC3)', d: 'M475,430 V500' },
    { id: 'krows', sig: ['IORQ'], kind: 'ctrl', label: 'Lignes clavier 0–9 (une seule à 0)', d: 'M400,530 H340' },
    { id: 'kcol', sig: ['D'], kind: 'data', label: 'Colonnes clavier → PSG port A', d: 'M245,560 V590 H580 V445 H640 V430' },
    { id: 'audio', sig: [], kind: 'analog', label: 'Audio canaux A / B / C', d: 'M690,430 V500' },
    { id: 'spkw', sig: [], kind: 'analog', label: 'Sortie haut-parleur', d: 'M675,560 V610' },
    { id: 'fdd', sig: [], kind: 'ctrl', label: 'Lecteur : STEP DIR RDATA WDATA INDEX', d: 'M865,430 V500' },
    { id: 'cent', sig: [], kind: 'data', label: 'Centronics D0–D6 · /STROBE · BUSY', d: 'M1055,430 V500' },
  ],
  info: {
    z80: { role: 'Processeur 8 bits NMOS : exécute le firmware, le BASIC et vos programmes ; pilote les bus d\'adresses, de données et de contrôle.', sigs: ['CLK', 'M1', 'MREQ', 'IORQ', 'RD', 'WR', 'RFSH', 'WAIT', 'INT', 'A', 'D'], cpu: true },
    xtal: { role: 'Oscillateur à quartz : horloge maître de toute la machine.', sigs: ['CLK'] },
    ga: { role: "Circuit maison d'Amstrad : divise le 16 MHz (4 MHz CPU, 1 MHz CRTC et PSG), lit la RAM vidéo, convertit les pixels en couleurs via la palette, génère /INT (300 Hz) et les états d'attente.", sigs: ['CLK', 'INT', 'WAIT', 'HSYNC', 'VSYNC'],
      blocks: [["Diviseur d'horloges", '16 MHz → 4 MHz, 1 MHz', ''], ['Arbitrage RAM', 'CPU ↔ vidéo, /WAIT', ''], ['Sérialiseur de pixels', 'octet → 2, 4 ou 8 pixels', ''], ['Palette', '17 encres parmi 27 couleurs', ''], ["Compteur d'interruptions", '52 lignes → /INT', ''], ['Sélection des ROM', 'basse &0000 · haute &C000', '']] },
    pal: { role: 'Logique programmable qui place les banques de 16 Ko de la RAM étendue (64 Ko supplémentaires du 6128) dans l\'espace du Z80.', sigs: ['A', 'D'] },
    rom: { role: "ROM interne : système d'exploitation (firmware, vecteurs &BBxx) en ROM basse, et Locomotive BASIC 1.1 en ROM haute 0.", sigs: ['A', 'D', 'RD'] },
    amsdos: { role: "ROM d'extension AMSDOS (ROM haute 7) : commandes disque CAT, LOAD, SAVE, |A, |B et pilote du FDC.", sigs: ['A', 'D', 'RD'] },
    ram0: { role: 'Banques 0 à 3 (64 Ko) : la mémoire de base. La vidéo y lit toujours ses 16 Ko d\'écran (&C000 par défaut).', sigs: ['A', 'D', 'MREQ', 'RD', 'WR'] },
    ram1: { role: 'Banques 4 à 7 (64 Ko étendus), accessibles par fenêtres de 16 Ko selon la configuration du PAL.', sigs: ['A', 'D', 'MREQ'] },
    crtc: { role: 'Contrôleur de tube cathodique : génère les compteurs d\'adresse vidéo et les synchros horizontale (64 µs) et verticale (20 ms).', sigs: ['HSYNC', 'VSYNC'],
      blocks: [['Compteur horizontal', 'R0 : caractères par ligne', ''], ['Compteur de lignes raster', 'R9 : lignes par caractère', ''], ['Compteur de rangées', 'R4 : rangées par trame', ''], ['Générateur MA', 'adresse vidéo 14 bits', ''], ['Générateur de synchros', 'R2/R3 horizontale, R7 verticale', ''], ['Registres R0–R17', 'ports &BCxx / &BDxx', '']] },
    ppi: { role: 'Interface parallèle 8255 : port A ↔ PSG, port B ← VSYNC, imprimante BUSY, cavaliers ; port C → ligne clavier, moteur cassette, commande du PSG.', sigs: ['IORQ', 'RD', 'WR', 'VSYNC'] },
    psg: { role: 'Générateur de son AY-3-8912 : 3 voix carrées, bruit, enveloppe. Son port A lit aussi les colonnes du clavier.', sigs: [],
      blocks: [['Tonalités A, B, C', 'R0–R5 : périodes 12 bits', ''], ['Bruit', 'R6 : LFSR 17 bits', ''], ['Mélangeur', 'R7', ''], ['Volumes', 'R8–R10', ''], ['Enveloppe', 'R11–R13 : 16 formes', ''], ['Port A', 'R14 : colonnes du clavier', '']] },
    fdc: { role: 'Contrôleur de disquettes NEC µPD765A : recherche de piste, lecture et écriture des secteurs. Les images .DSK sont montées dans les lecteurs virtuels.', sigs: ['IORQ', 'RD', 'WR'] },
    prn: { role: 'Verrou 74LS273 sur le port &EFxx : 7 bits de données + /STROBE vers le connecteur Centronics.', sigs: ['IORQ', 'WR', 'D'] },
    kdec: { role: 'Décodeur BCD → 10 sorties : active une seule ligne de la matrice clavier à la fois.', sigs: [] },
    amp: { role: 'Mélange les trois voix du PSG vers le haut-parleur interne et la prise casque stéréo.', sigs: [] },
    mon: { role: 'Moniteur : reçoit R, V, B (3 niveaux chacun) et la synchro. Affiché dans l\'onglet Machine.', sigs: ['HSYNC', 'VSYNC'], ext: true },
    kbd: { role: 'Matrice de 80 touches (10 lignes × 8 colonnes). Le clavier virtuel est dans l\'onglet Machine.', sigs: [], ext: true },
    drive: { role: 'Lecteurs 3 pouces virtuels : images disque .DSK.', sigs: [], ext: true },
    printer: { role: "Imprimante virtuelle : la sortie s'affiche sur papier listing dans l'onglet Machine.", sigs: [], ext: true },
    spk: { role: 'Haut-parleur : le son est restitué par la carte son du PC.', sigs: [], ext: true },
  },
  regs(id, m) {
    const r = m.cpu.getRegs(), ga = m.ga, c = m.crtc;
    switch (id) {
      case 'z80': return [['PC', hex(r.PC, 4)], ['SP', hex(r.SP, 4)], ['AF', r16(r, 'A', 'F')], ['HL', r16(r, 'H', 'L')], ['IM / IFF1', `${r.IM} / ${r.IFF1}`]];
      case 'xtal': return [['Fréquence', '16,000 MHz']];
      case 'ga': return [['Mode écran', `${ga.mode} (${[160, 320, 640][ga.mode]}×200)`], ['Bordure (matérielle)', ga.inks[16]], ['Encres 0–3', [...ga.inks.slice(0, 4)].join(' ')], ['ROM basse / haute', `${ga.lowerRom ? 'on' : 'off'} / ${ga.upperRom ? 'on' : 'off'}`], ['Compteur de lignes', `${ga.intCounter} / 52`]];
      case 'pal': return [['Configuration', 'C' + (ga.ramConfig & 7)], ['Banques', m.bank.map(b => b >> 14).join(' ')]];
      case 'rom': return [['ROM haute choisie', m.romSelect], ['ROM basse', ga.lowerRom ? 'visible' : 'masquée'], ['ROM haute', ga.upperRom ? 'visible' : 'masquée']];
      case 'amsdos': return [['Sélectionnée', m.romSelect === 7 ? 'oui' : 'non']];
      case 'ram0': return [['Écran', '&' + hex(((c.regs[12] & 0x30) << 10), 4)], ['Configuration', 'C' + (ga.ramConfig & 7)]];
      case 'ram1': return [['Fenêtres', m.bank.map(b => b >> 14).filter(b => b > 3).join(' ') || 'aucune']];
      case 'crtc': return [['R0 total H', c.regs[0]], ['R1 affiché H', c.regs[1]], ['R2 synchro H', c.regs[2]], ['R4 total V', c.regs[4]], ['R6 affiché V', c.regs[6]], ['R7 synchro V', c.regs[7]], ['R9 lignes/car.', c.regs[9]], ['R12–13 début', '&' + r16(c.regs, 12, 13)], ['Balayage', `car. ${c.hcc}, rangée ${c.vcc}, ligne ${c.vlc}`]];
      case 'ppi': return [['Port A', '&' + hex(m.ppi.a)], ['Port C', '&' + hex(m.ppi.c)], ['Contrôle', '&' + hex(m.ppi.control)], ['Ligne clavier', m.ppi.c & 0x0F]];
      case 'psg': return [...m.psg.regs.slice(0, 14)].map((v, i) => ['R' + i, '&' + hex(v)]);
      case 'fdc': { const a = m.fdc.activity || {}; return [['Moteur', a.motor ? 'en marche' : 'arrêté'], ['Phase', a.phase || '—'], ['Commande', a.command || '—'], ['Pistes A / B', (a.track || [0, 0]).join(' / ')]]; }
      case 'prn': return [['Caractères reçus', m.printer.text.length]];
      default: return [];
    }
  },
  activity(step, m, chips, wires) {
    const mem = step.pins.includes('MREQ') && !step.pins.includes('RFSH');
    if (mem && step.addr != null) {
      const chip = m.chipAt(step.addr);
      if (chip === 'ROM OS' || chip === 'ROM BASIC') chips.add('rom');
      else if (chip === 'ROM AMSDOS') chips.add('amsdos');
      else { chips.add(+chip.slice(4) > 3 ? 'ram1' : 'ram0'); chips.add('pal'); wires.add('ras'); }
    }
    if (step.pins.includes('WAIT')) { chips.add('ga'); wires.add('wait'); }
    if (step.pins.includes('IORQ') && step.addr != null) {
      const p = step.addr;
      if ((p & 0xC000) === 0x4000) chips.add('ga');
      if (!(p & 0x4000)) chips.add('crtc');
      if (!(p & 0x0800)) { chips.add('ppi'); chips.add('psg'); wires.add('ppipsg'); wires.add('bdir'); }
      if (!(p & 0x0480)) { chips.add('fdc'); wires.add('fdd'); }
      if (!(p & 0x1000) && step.pins.includes('WR')) { chips.add('prn'); wires.add('cent'); }
      if (!(p & 0x2000) && step.pins.includes('WR')) chips.add('rom');
    }
  },
};
