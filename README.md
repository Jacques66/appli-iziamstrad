# Z80 Studio

Educational Z80A simulator (NMOS, 4 MHz) in HTML / JS / CSS, with no dependencies:
assembler, step-by-step execution (per instruction or per T-state), animated view
of the inside of the CPU (ALU, registers, sequencer, internal buses), clickable
board with signal timing diagrams, and a machine with its peripherals.

Online: https://jacques66.github.io/appli-iziamstrad/

## Contents

| Folder | Role |
| --- | --- |
| `src/z80/cpu.js` | Z80A core: all instructions (CB, ED, DD, FD, DDCB, undocumented), X/Y flags, MEMPTR, exact T-states, IM 0/1/2 interrupts and NMI, machine cycle trace |
| `src/z80/disasm.js` | disassembler (reassemblable text, T-states, jump targets) |
| `src/asm/assembler.js` | Maxam / WinAPE syntax assembler (expressions, EQU, ORG, DB/DW/DS, ALIGN, INCLUDE, END) |
| `src/machines/cpc6128.js`, `src/machines/cpc/` | Amstrad CPC 6128: Gate Array (palette, modes, 300 Hz interrupts, /WAIT), 128 KB PAL, CRTC 6845, PPI 8255, PSG AY-3-8912 (Web Audio sound), FDC µPD765A, standard and extended .DSK images, keyboard, printer |
| `src/machines/minimal.js` | minimal system: 8 KB EPROM, 8 KB SRAM, 74LS138, 8 LEDs (port &00), 8 switches (port &01) |
| `roms/` | CPC 6128 ROMs (OS, BASIC 1.1, AMSDOS), see `roms/README.txt` |
| `app/` | the user interface: editor, CPU view, board, timing diagrams, memory, disassembly, I/O |
| `maquette/` | original mock-up of the interface (dummy data) |
| `examples/` | programs to paste into BASIC (Ctrl+V on the CPC screen), with their assembly source; `node tools/make-examples.mjs` regenerates the loaders, `node tools/sync-examples.mjs` copies the sources into the application |
| `tools/` | `bas-loader.mjs`: assembly source → BASIC loader (DATA + checksum) |
| `test/` | tests: `npm test` |

## Running

Serve the project root with a static server (ES modules do not load
from `file://`), then open `/app/`:

```
python -m http.server 8080
```

http://localhost:8080/app/ — F7 assembles, F5 runs, F10 steps one instruction, F11 one T-state.

## Tests

The CPU and the disassembler, written independently, are checked against each
other on the T-states and length of all 1,786 opcodes; the disassembler and the
assembler on a text → bytes → text round trip; the examples are run on the
minimal machine.

## CPC 6128

The CPC boots into BASIC 1.1. Ctrl+V on the screen types the clipboard text
into the CPC (emulation runs faster while typing). F7 assembles the source,
injects it into RAM and types `CALL &entry`. The screen receives the PC keyboard
after a click; .DSK disc images are dropped onto the drives (or "Blank" formats
a new one); `PRINT #8` and the firmware print on the virtual paper.

The machine selector offers the English CPC 6128 (QWERTY, default) and the
French CPC 6128 (AZERTY, with é è à ç ù).

The integration tests (`test/cpc.test.js`) boot the real ROMs, read the screen
text using the ROM font, run BASIC and assembled code, print, and do SAVE/CAT
on a blank disc.
