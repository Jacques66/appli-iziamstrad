// Example programs. machine: 'cpc' (code injected into RAM, started with CALL) or 'min' (EPROM at &0000, SRAM at &8000)
export const EXAMPLES = [
  {
    machine: 'cpc',
    name: 'hello.asm',
    title: 'Text, border and beep with the firmware',
    source: `; =================================================
;  hello.asm — Amstrad CPC 6128
;  Prints a message, red border, then a beep.
;  F7 assembles, injects at &4000 and types CALL &4000
; =================================================
TXT_OUTPUT      EQU  &BB5A      ; firmware: prints character A
SCR_SET_BORDER  EQU  &BC38      ; firmware: border color B,C

                ORG  &4000
start:          LD   HL,message
loop:           LD   A,(HL)     ; next character
                OR   A          ; end of string?
                JR   Z,border
                CALL TXT_OUTPUT
                INC  HL
                JR   loop
border:         LD   B,6        ; bright red
                LD   C,B
                CALL SCR_SET_BORDER
                LD   A,7        ; BEL: speaker beep
                CALL TXT_OUTPUT
                RET
message:        DB   "Hello Z80!",13,10,0
                END  start
`,
  },
  {
    machine: 'cpc',
    name: 'raster-bars.asm',
    title: 'Color bars synchronized on VSYNC',
    source: `; =================================================
;  raster-bars.asm — changes the border color
;  directly in the Gate Array, 16 times per frame.
;  Interrupts are disabled: Reset to quit.
; =================================================
GA      EQU  &7F00              ; Gate Array port
PPI_B   EQU  &F500              ; PPI port B (bit 0 = VSYNC)

        ORG  &4000
start:  DI                      ; controlled timing
frame:  LD   B,PPI_B >> 8
waitvbl:
        IN   A,(C)
        RRA                     ; VSYNC into carry
        JR   NC,waitvbl
        LD   HL,colors
        LD   E,16               ; 16 bands
band:   LD   BC,GA + &10        ; pen 16 = border
        OUT  (C),C
        LD   A,(HL)
        OR   &40                ; "color" command
        OUT  (C),A
        INC  HL
        LD   B,0                ; 256 × 4 µs ≈ 16 lines
delay:  DJNZ delay
        DEC  E
        JR   NZ,band
        JR   frame
colors:
        DB   20,4,21,28,24,29,12,5,13,22,6,23,30,0,31,11
`,
  },
  {
    machine: 'cpc',
    name: 'scale.asm',
    title: 'A musical scale played by programming the AY-3-8912',
    source: `; =================================================
;  scale.asm — plays C D E F G A B C
;  by writing the PSG registers directly.
;  Turn the sound on in the Machine tab.
; =================================================
MC_SOUND_REGISTER EQU &BD34     ; A = register, C = value
MC_WAIT_FLYBACK   EQU &BD19     ; waits for VSYNC (1/50 s)

        ORG  &4000
start:  LD   A,7
        LD   C,%00111110        ; mixer: tone A only
        CALL MC_SOUND_REGISTER
        LD   A,1
        LD   C,0                ; period, high byte
        CALL MC_SOUND_REGISTER
        LD   A,8
        LD   C,15               ; maximum volume
        CALL MC_SOUND_REGISTER
        LD   HL,scale
note:   LD   A,(HL)
        OR   A
        JR   Z,done
        LD   C,A
        XOR  A                  ; register 0: period, low byte
        CALL MC_SOUND_REGISTER
        INC  HL
        LD   B,12               ; 12 frames = 0.24 s
hold:   PUSH BC
        PUSH HL
        CALL MC_WAIT_FLYBACK
        POP  HL
        POP  BC
        DJNZ hold
        JR   note
done:   LD   A,8
        LD   C,0                ; silence
        CALL MC_SOUND_REGISTER
        RET
; period = 62 500 / frequency (1 MHz clock / 16)
scale:  DB   239,213,190,179,159,142,127,119,0
`,
  },
  {
    machine: 'cpc',
    name: 'printer.asm',
    title: 'Sending text to the printer',
    source: `; =================================================
;  printer.asm — sends a line to the Centronics
;  port (see the paper in the Machine tab)
; =================================================
MC_PRINT_CHAR   EQU  &BD2B      ; A = character; carry = sent

        ORG  &4000
start:  LD   HL,text
next:   LD   A,(HL)
        OR   A
        RET  Z
send:   LD   A,(HL)
        CALL MC_PRINT_CHAR
        JR   NC,send            ; printer busy: try again
        INC  HL
        JR   next
text:   DB   "Hello from the Z80A of the CPC 6128!",13,10,0
`,
  },
  {
    machine: 'cpc',
    name: 'split-screen.asm',
    title: 'MODE 0 / MODE 1 split screen with Gate Array interrupts',
    source: `; =================================================
;  split-screen.asm — Amstrad CPC 6128
;  Screen split by interrupts: mode 0 at the top
;  (16 colors), mode 1 at the bottom (readable text).
;
;  The Gate Array raises 6 interrupts per frame
;  (every 52 lines). We subscribe to two firmware
;  events:
;   - frame flyback (VSYNC): resets the counter to 0;
;   - fast ticker (300 Hz, every interrupt):
;     1st tick after VSYNC → mode 0 (top border),
;     4th tick → mode 1 (around line 90).
;  The Gate Array applies the new mode at the next
;  horizontal sync.
;
;  CALL &8000: draws the bars and installs
;  CALL &8003: uninstalls and returns to mode 1
; =================================================
KL_NEW_FRAME_FLY    EQU &BCD7   ; HL = block, B = class, C = ROM, DE = routine
KL_DEL_FRAME_FLY    EQU &BCDD   ; HL = block
KL_NEW_FAST_TICKER  EQU &BCE0   ; HL = block, B = class, C = ROM, DE = routine
KL_DEL_FAST_TICKER  EQU &BCE6   ; HL = block
MC_SET_MODE         EQU &BD1C   ; A = mode, without clearing the screen
CLASS               EQU &81     ; asynchronous, "near" address in RAM

        ORG  &8000
        JP   install
        JP   stop

install:
        CALL bars
        LD   HL,block_vbl
        LD   B,CLASS
        LD   C,0
        LD   DE,on_vbl
        CALL KL_NEW_FRAME_FLY
        LD   HL,block_300
        LD   B,CLASS
        LD   C,0
        LD   DE,on_300
        JP   KL_NEW_FAST_TICKER

stop:   LD   HL,block_vbl
        CALL KL_DEL_FRAME_FLY
        LD   HL,block_300
        CALL KL_DEL_FAST_TICKER
        LD   A,1
        JP   MC_SET_MODE

; --- "frame flyback" event: once per frame, on VSYNC
on_vbl:
        XOR  A
        LD   (count),A
        RET

; --- "fast ticker" event: on each of the 6 interrupts
on_300:
        LD   A,(count)
        INC  A
        LD   (count),A
        CP   1
        JR   Z,top
        CP   4
        RET  NZ
        LD   A,1               ; around line 90: mode 1
        JP   MC_SET_MODE
top:    XOR  A                 ; top of the screen: mode 0
        JP   MC_SET_MODE

; --- 16 vertical bars (inks 0 to 15) on the first 10 character rows
bars:   LD   B,10
        LD   HL,&C000
row:    PUSH BC
        PUSH HL
        LD   B,8               ; 8 raster lines per character row
line:   PUSH BC
        PUSH HL
        LD   DE,patterns
        LD   B,16
bar:    LD   A,(DE)
        LD   C,5               ; 5 bytes = 10 mode 0 pixels
five:   LD   (HL),A
        INC  HL
        DEC  C
        JR   NZ,five
        INC  DE
        DJNZ bar
        POP  HL
        LD   BC,&0800          ; next raster line
        ADD  HL,BC
        POP  BC
        DJNZ line
        POP  HL
        LD   BC,80             ; next character row
        ADD  HL,BC
        POP  BC
        DJNZ row
        RET

; mode 0 byte whose 2 pixels have ink n (bits 7-6 = b0, 3-2 = b1, 5-4 = b2, 1-0 = b3)
patterns: DB &00,&C0,&0C,&CC,&30,&F0,&3C,&FC,&03,&C3,&0F,&CF,&33,&F3,&3F,&FF

count:     DB 0
block_vbl: DS 16               ; firmware event blocks
block_300: DS 16
`,
  },
  {
    machine: 'cpc',
    name: 'mode0-mode2.asm',
    title: 'MODE 0 / MODE 2 split screen in pure assembly (interrupt at &0038)',
    source: `; =================================================
;  mode0-mode2.asm — Amstrad CPC 6128, pure assembly
;  Split screen: MODE 0 at the top (16 cycling
;  colors), MODE 2 at the bottom (80 columns of text).
;
;  No firmware call once running:
;   - the lower ROM is disabled, so at &0038 (RAM)
;     the Z80 finds our own interrupt routine (IM 1);
;   - the Gate Array interrupts every 52 lines;
;     the one that falls during VSYNC (PPI port B,
;     bit 0) resets the counter to 0 → MODE 0;
;     the 3rd one after it (around line 90) → MODE 2;
;   - the mode is written directly to the Gate Array
;     (port &7Fxx, command %100xxxmm) and takes effect
;     at the next horizontal sync;
;   - the text is drawn byte by byte with the font
;     copied from the ROM (&3800);
;   - the keyboard is read through the PPI and the PSG
;     (register 14);
;   - the music is played on the VSYNC interrupt
;     (50 Hz) by writing the AY-3-8912 PSG registers
;     directly: channel A melody (the French folk song
;     "Au clair de la lune") with a software volume
;     envelope, channel B bass, channel C noise
;     (hi-hat) on every beat.
;
;  CALL &8000 · SPACE to return to BASIC (then MODE 1)
; =================================================
GA_MODE0  EQU  &8C              ; %10001100: mode 0, lower and upper ROMs disabled
GA_MODE2  EQU  &8E              ; mode 2, ROMs disabled
GA_BASIC  EQU  &85              ; mode 1, lower ROM disabled, upper ROM (BASIC) visible
SCREEN    EQU  &C000
FONT      EQU  &9000            ; copy of the ROM font (2 KB)

        ORG  &8000
start:  DI
        ; --- copy the font: lower ROM visible during the LDIR
        LD   BC,&7F89           ; mode 1, lower ROM visible, upper ROM disabled
        OUT  (C),C
        LD   HL,&3800
        LD   DE,FONT
        LD   BC,&0800
        LDIR
        LD   BC,&7F00 + GA_MODE0
        OUT  (C),C              ; ROMs disabled: &0038 and &C000 are RAM
        ; --- screen at &C000 with no offset (BASIC may have scrolled the screen)
        LD   BC,&BC0C
        OUT  (C),C
        LD   BC,&BD30
        OUT  (C),C
        LD   BC,&BC0D
        OUT  (C),C
        LD   BC,&BD00
        OUT  (C),C
        ; --- clear the screen
        LD   HL,SCREEN
        LD   DE,SCREEN + 1
        LD   BC,&3FFF
        LD   (HL),0
        LDIR
        ; --- palette: ink 0 blue, 1 white, 2 to 15 rainbow, black border
        LD   HL,colors
        LD   E,0
pal:    LD   B,&7F
        OUT  (C),E              ; %000nnnnn: selects ink n
        LD   A,(HL)
        OR   &40                ; %010ccccc: hardware color
        OUT  (C),A
        INC  HL
        INC  E
        LD   A,E
        CP   16
        JR   NZ,pal
        LD   BC,&7F10           ; pen 16 = border
        OUT  (C),C
        LD   A,&54              ; black
        OUT  (C),A
        ; --- drawing: bars at the top, text at the bottom
        CALL bars
        LD   HL,texts
write:  LD   E,(HL)
        INC  HL
        LD   D,(HL)
        INC  HL
        LD   A,D
        OR   E
        JR   Z,install
        CALL text
        JR   write
        ; --- our interrupt routine at &0038
install:
        LD   HL,&0038
        LD   DE,saved
        LD   BC,3
        LDIR                    ; keep the 3 firmware bytes
        LD   A,&C3              ; JP isr
        LD   (&0038),A
        LD   HL,isr
        LD   (&0039),HL
        CALL sound_init
        IM   1
        EI

; --- main loop: cycling colors, SPACE to quit
loop:   LD   HL,frames
        LD   A,(HL)
wait:   CP   (HL)               ; wait for the next frame
        JR   Z,wait
        AND  3
        CALL Z,rotate
        LD   D,5                ; keyboard matrix line 5: SPACE = bit 7
        DI                      ; the interrupt plays music through the same PPI
        CALL keyboard
        EI
        BIT  7,A
        JR   NZ,loop
exit:   DI
        CALL silence
        LD   HL,saved
        LD   DE,&0038
        LD   BC,3
        LDIR                    ; give &0038 back to the firmware
        LD   BC,&7F00 + GA_BASIC
        OUT  (C),C
        EI
        RET

; --- Gate Array interrupt (6 per frame)
isr:    PUSH AF
        PUSH BC
        LD   B,&F5              ; PPI port B
        IN   A,(C)
        RRA                     ; bit 0 = VSYNC → carry
        LD   A,(count)
        JR   NC,not_vbl
        XOR  A                  ; VSYNC interrupt
        LD   (count),A
        LD   BC,&7F00 + GA_MODE0
        OUT  (C),C              ; top of the screen in MODE 0
        LD   A,(frames)
        INC  A
        LD   (frames),A
        PUSH DE
        PUSH HL
        CALL music              ; one frame of music (50 Hz)
        POP  HL
        POP  DE
        JR   done
not_vbl:
        INC  A
        LD   (count),A
        CP   3
        JR   NZ,done
        LD   BC,&7F00 + GA_MODE2
        OUT  (C),C              ; around line 90: MODE 2
done:   POP  BC
        POP  AF
        EI
        RET

; --- writes E to PSG register A (PSG bus wired to PPI port A, BDIR/BC1 to port C)
psg:    LD   B,&F4
        OUT  (C),A              ; PPI A ← register number
        LD   BC,&F6C0           ; BDIR=1 BC1=1: select register
        OUT  (C),C
        LD   BC,&F600           ; inactive
        OUT  (C),C
        LD   B,&F4
        OUT  (C),E              ; PPI A ← value
        LD   BC,&F680           ; BDIR=1 BC1=0: write
        OUT  (C),C
        LD   BC,&F600
        OUT  (C),C
        RET

sound_init:
        LD   A,7
        LD   E,%00011100        ; tones A and B, noise on C; port A as input (keyboard)
        CALL psg
        LD   A,6
        LD   E,3                ; noise period
        CALL psg
        LD   HL,score
        LD   (note),HL
        LD   A,1
        LD   (duration),A
        RET

silence:
        LD   A,8
        LD   E,0
        CALL psg
        LD   A,9
        CALL psg
        LD   A,10
        JP   psg

; --- one frame of music: next note once the duration has elapsed, then envelopes
music:
        LD   HL,duration
        DEC  (HL)
        JR   NZ,envelope
        LD   HL,(note)
        LD   A,(HL)             ; duration in frames, 0 = restart from the beginning
        OR   A
        JR   NZ,play
        LD   HL,score
        LD   A,(HL)
play:   LD   (duration),A
        INC  HL
        LD   A,(HL)             ; melody: note number
        INC  HL
        PUSH HL
        LD   HL,per_melody
        CALL period
        LD   A,0                ; R0/R1: channel A period
        CALL psg
        LD   E,D
        LD   A,1
        CALL psg
        POP  HL
        LD   A,(HL)             ; bass: note number
        INC  HL
        LD   (note),HL
        LD   HL,per_bass
        CALL period
        LD   A,2                ; R2/R3: channel B period
        CALL psg
        LD   E,D
        LD   A,3
        CALL psg
        LD   A,15
        LD   (vol_a),A          ; note attack
        LD   A,13
        LD   (vol_c),A          ; hi-hat hit
envelope:
        LD   A,(vol_a)          ; melody decays down to 8
        CP   9
        JR   C,va
        DEC  A
        LD   (vol_a),A
va:     LD   E,A
        LD   A,8
        CALL psg
        LD   A,9
        LD   E,10               ; bass: fixed volume
        CALL psg
        LD   A,(vol_c)          ; hi-hat: very short
        SUB  4
        JR   NC,vc
        XOR  A
vc:     LD   (vol_c),A
        LD   E,A
        LD   A,10
        JP   psg

; --- DE = period number A from table HL
period:
        ADD  A,A
        LD   C,A
        LD   B,0
        ADD  HL,BC
        LD   E,(HL)
        INC  HL
        LD   D,(HL)
        RET

; --- cycles the colors of inks 2 to 15
rotate: LD   HL,colors + 2
        LD   A,(HL)             ; shift the table by one step
        LD   DE,colors + 2
        INC  HL
        LD   BC,13
        LDIR
        LD   (DE),A
        LD   HL,colors + 2
        LD   E,2
rot2:   LD   B,&7F
        OUT  (C),E
        LD   A,(HL)
        OR   &40
        OUT  (C),A
        INC  HL
        INC  E
        LD   A,E
        CP   16
        JR   NZ,rot2
        RET

; --- reads one keyboard line: D = line (0-9), A = columns (0 = pressed)
keyboard:
        LD   BC,&F40E           ; PPI A ← PSG register number 14
        OUT  (C),C
        LD   BC,&F6C0           ; PPI C: BDIR=1, BC1=1 → select register
        OUT  (C),C
        LD   BC,&F600           ; inactive
        OUT  (C),C
        LD   BC,&F792           ; PPI: port A as input
        OUT  (C),C
        LD   A,D
        OR   &40                ; BC1=1: read the PSG, + keyboard line number
        LD   B,&F6
        OUT  (C),A
        LD   B,&F4
        IN   A,(C)              ; columns of the line
        LD   BC,&F782           ; port A as output
        OUT  (C),C
        LD   BC,&F600
        OUT  (C),C
        RET

; --- MODE 2 text: DE = screen address, HL = 0-terminated string; HL points past it
text:   LD   A,(HL)
        INC  HL
        OR   A
        RET  Z
        PUSH HL
        PUSH DE
        LD   L,A
        LD   H,0
        ADD  HL,HL
        ADD  HL,HL
        ADD  HL,HL              ; character × 8
        LD   BC,FONT
        ADD  HL,BC
        LD   B,8
txl:    LD   A,(HL)             ; one line of the character = one MODE 2 byte
        LD   (DE),A
        INC  HL
        LD   A,D
        ADD  A,8                ; next raster line: +&800
        LD   D,A
        DJNZ txl
        POP  DE
        POP  HL
        INC  DE
        JR   text

; --- 16 vertical MODE 0 bars on the first 10 character rows
bars:   LD   B,10
        LD   HL,SCREEN
row:    PUSH BC
        PUSH HL
        LD   B,8
line:   PUSH BC
        PUSH HL
        LD   DE,patterns
        LD   B,16
bar:    LD   A,(DE)
        LD   C,5
five:   LD   (HL),A
        INC  HL
        DEC  C
        JR   NZ,five
        INC  DE
        DJNZ bar
        POP  HL
        LD   BC,&0800
        ADD  HL,BC
        POP  BC
        DJNZ line
        POP  HL
        LD   BC,80
        ADD  HL,BC
        POP  BC
        DJNZ row
        RET

patterns: DB &00,&C0,&0C,&CC,&30,&F0,&3C,&FC,&03,&C3,&0F,&CF,&33,&F3,&3F,&FF
; hardware colors: blue, bright white, then 14 hues
colors:
        DB   &04,&0B,&0C,&0E,&0A,&1A,&12,&02,&13,&17,&15,&1D,&0D,&07,&0F,&03

texts:  DW   SCREEN + 12 * 80
        DB   "MODE 2: 640 x 200, 2 colors, 80 columns - text drawn in pure assembly",0
        DW   SCREEN + 14 * 80
        DB   "The Z80 takes the interrupt at &0038 (lower ROM disabled). On every Gate Array",0
        DW   SCREEN + 15 * 80
        DB   "interrupt (300 Hz) it reads VSYNC on the PPI, counts, and writes the mode to",0
        DW   SCREEN + 16 * 80
        DB   "the Gate Array (port &7F00): MODE 0 at VSYNC, MODE 2 three interrupts later.",0
        DW   SCREEN + 18 * 80
        DB   "Top: MODE 0, 160 x 200, 16 colors (they cycle every 4 frames).",0
        DW   SCREEN + 19 * 80
        DB   "Music: AY-3-8912 written directly on VSYNC (A melody, B bass, C noise).",0
        DW   SCREEN + 21 * 80
        DB   "SPACE to return to BASIC, then type MODE 1.",0
        DW   0

; PSG periods = 62 500 / frequency (1 MHz clock ÷ 16)
per_melody:
        DW   119,106,95,159,142,127   ; C5 523 Hz, D5 587, E5 659, G4 392, A4 440, B4 494
per_bass:
        DW   478,638,716              ; C3 131 Hz, G2 98, F2 87
C5  EQU 0
D5  EQU 1
E5  EQU 2
G4  EQU 3
A4  EQU 4
B4  EQU 5
C3  EQU 0
G2  EQU 1
F2  EQU 2
; score: duration in frames, melody note, bass note; duration 0 = restart
N   EQU 12                      ; a quarter note = 12 frames (0.24 s)
score:
        ; "Au clair de la lune": C C C D | E D | C E D D | C
        DB   N,C5,C3
        DB   N,C5,C3
        DB   N,C5,C3
        DB   N,D5,G2
        DB   2*N,E5,C3
        DB   2*N,D5,G2
        DB   N,C5,C3
        DB   N,E5,C3
        DB   N,D5,G2
        DB   N,D5,G2
        DB   4*N,C5,C3
        DB   N,C5,C3
        DB   N,C5,C3
        DB   N,C5,C3
        DB   N,D5,G2
        DB   2*N,E5,C3
        DB   2*N,D5,G2
        DB   N,C5,C3
        DB   N,E5,C3
        DB   N,D5,G2
        DB   N,D5,G2
        DB   4*N,C5,C3
        ; D D D D | A A | D C B A | G
        DB   N,D5,G2
        DB   N,D5,G2
        DB   N,D5,G2
        DB   N,D5,G2
        DB   2*N,A4,F2
        DB   2*N,A4,F2
        DB   N,D5,G2
        DB   N,C5,C3
        DB   N,B4,G2
        DB   N,A4,F2
        DB   4*N,G4,G2
        ; C C C D | E D | C E D D | C
        DB   N,C5,C3
        DB   N,C5,C3
        DB   N,C5,C3
        DB   N,D5,G2
        DB   2*N,E5,C3
        DB   2*N,D5,G2
        DB   N,C5,C3
        DB   N,E5,C3
        DB   N,D5,G2
        DB   N,D5,G2
        DB   4*N,C5,C3
        DB 0

note:     DW   0
duration: DB   0
vol_a:    DB   0
vol_c:    DB   0
count:    DB   0
frames:   DB   0
saved:    DS   3
`,
  },
  {
    machine: 'min',
    name: 'led-chaser.asm',
    title: 'LED chaser on the 8 LEDs',
    source: `; =================================================
;  led-chaser.asm — minimal Z80
;  One LED moves; switch 0 reverses the direction
; =================================================
LEDS     EQU  &00           ; output port (74LS374)
SWITCHES EQU  &01           ; input port (74LS244)
pattern  EQU  &8000         ; variable in SRAM

        ORG  &0000          ; reset vector
start:  LD   SP,&A000       ; stack at the top of the SRAM
        LD   A,%00000001
loop:   OUT  (LEDS),A       ; light the current LED
        LD   (pattern),A    ; remember the pattern
        LD   DE,40          ; delay length
delay:  DEC  DE
        LD   A,D
        OR   E
        JR   NZ,delay
        IN   A,(SWITCHES)   ; read the switches
        BIT  0,A
        LD   A,(pattern)
        JR   NZ,right
        RLCA                ; next LED to the left
        JR   loop
right:  RRCA                ; to the right
        JR   loop
`,
  },
  {
    machine: 'min',
    name: 'bcd-counter.asm',
    title: 'Binary counter + BCD addition',
    source: `; =================================================
;  bcd-counter.asm — counts in BCD on the LEDs
;  DAA adjusts the addition to stay in decimal
; =================================================
LEDS    EQU  &00
count   EQU  &8000

        ORG  &0000
start:  LD   SP,&A000
        XOR  A
        LD   (count),A
next:   LD   A,(count)
        ADD  A,1
        DAA                 ; 09 + 1 → 10 (BCD)
        LD   (count),A
        OUT  (LEDS),A
        LD   B,20
pause:  DJNZ pause
        JR   next
`,
  },
  {
    machine: 'min',
    name: 'interrupt.asm',
    title: 'IM 1 interrupts (/INT button)',
    source: `; =================================================
;  interrupt.asm — each pulse on /INT
;  increments the LEDs (IM 1 mode: jump to &0038)
; =================================================
LEDS    EQU  &00
total   EQU  &8000

        ORG  &0000
start:  LD   SP,&A000
        XOR  A
        LD   (total),A
        OUT  (LEDS),A
        IM   1
        EI
idle:   HALT                ; sleeps until the next interrupt
        JR   idle

        ORG  &0038          ; IM 1 interrupt routine
isr:    PUSH AF
        LD   A,(total)
        INC  A
        LD   (total),A
        OUT  (LEDS),A
        POP  AF
        EI
        RETI
`,
  },
  {
    machine: 'min',
    name: 'multiplication.asm',
    title: '8 × 8-bit multiplication by shifts',
    source: `; =================================================
;  multiplication.asm — HL = D × E by shifts
;  result in SRAM, low byte on the LEDs
; =================================================
LEDS    EQU  &00
result  EQU  &8000

        ORG  &0000
start:  LD   SP,&A000
        LD   D,13           ; multiplicand
        LD   E,11           ; multiplier
        CALL mult
        LD   (result),HL    ; 13 × 11 = 143 = &008F
        LD   A,L
        OUT  (LEDS),A
done:   HALT

; HL = D × E  (B, DE modified)
mult:   LD   HL,0
        LD   A,D
        LD   D,0
        LD   B,8
bit:    RRA                 ; next multiplicand bit into C
        JR   NC,skip
        ADD  HL,DE
skip:   SLA  E
        RL   D              ; DE × 2
        DJNZ bit
        RET
`,
  },
];
