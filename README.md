# Z80 Studio

Simulateur Z80A (NMOS, 4 MHz) pédagogique en HTML / JS / CSS, sans dépendance :
assembleur, exécution pas à pas (instruction ou T-state), vue animée de
l'intérieur du CPU (UAL, registres, séquenceur, bus internes), carte cliquable
avec chronogrammes des signaux, machine avec ses périphériques.

## Contenu

| Dossier | Rôle |
| --- | --- |
| `src/z80/cpu.js` | cœur Z80A : toutes les instructions (CB, ED, DD, FD, DDCB, non documentées), drapeaux X/Y, MEMPTR, T-states exacts, interruptions IM 0/1/2 et NMI, trace des cycles machine |
| `src/z80/disasm.js` | désassembleur (texte réassemblable, T-states, cibles de saut) |
| `src/asm/assembler.js` | assembleur syntaxe Maxam / WinAPE (expressions, EQU, ORG, DB/DW/DS, ALIGN, INCLUDE, END) |
| `src/machines/cpc6128.js`, `src/machines/cpc/` | Amstrad CPC 6128 : Gate Array (palette, modes, interruptions 300 Hz, /WAIT), PAL 128 Ko, CRTC 6845, PPI 8255, PSG AY-3-8912 (son Web Audio), FDC µPD765A, images .DSK standard et étendues, clavier, imprimante |
| `src/machines/minimal.js` | système minimal : EPROM 8 Ko, SRAM 8 Ko, 74LS138, 8 LED (port &00), 8 interrupteurs (port &01) |
| `roms/` | ROM du CPC 6128 (OS, BASIC 1.1, AMSDOS), voir `roms/LISEZMOI.txt` |
| `app/` | l'interface : éditeur, vue CPU, carte, chronogrammes, mémoire, désassemblage, E/S |
| `maquette/` | maquette d'origine de l'interface (données fictives) |
| `exemples/` | programmes à coller dans le BASIC (Ctrl+V sur l'écran du CPC), avec leur source assembleur ; `node tools/make-examples.mjs` régénère les chargeurs, `node tools/sync-examples.mjs` recopie les sources dans l'application |
| `tools/` | `bas-loader.mjs` : source assembleur → chargeur BASIC (DATA + somme de contrôle) |
| `test/` | tests : `npm test` |

## Lancer

Servir la racine du projet avec un serveur statique (les modules ES ne se
chargent pas en `file://`), puis ouvrir `/app/` :

```
python -m http.server 8080
```

http://localhost:8080/app/ — F7 assemble, F5 exécute, F10 instruction, F11 T-state.

## Tests

Le CPU et le désassembleur, écrits indépendamment, sont confrontés sur les
T-states et la longueur des 1 786 opcodes ; le désassembleur et l'assembleur
sur un aller-retour texte → octets → texte ; les exemples sont exécutés sur la
machine minimale.

## CPC 6128

Le CPC démarre sur le BASIC 1.1. Ctrl+V sur l'écran tape le texte du
presse-papiers dans le CPC (émulation accélérée pendant la frappe). F7 assemble le source, l'injecte en RAM et
tape `CALL &entrée`. L'écran reçoit le clavier du PC après un clic ; les
disquettes .DSK se déposent sur les lecteurs (ou « Vierge » pour en formater
une) ; `PRINT #8` et le firmware impriment sur le papier virtuel.

Les tests d'intégration (`test/cpc.test.js`) démarrent les vraies ROM, lisent
le texte de l'écran avec la police de la ROM, exécutent du BASIC et du code
assemblé, impriment, et font SAVE/CAT sur une disquette vierge.
