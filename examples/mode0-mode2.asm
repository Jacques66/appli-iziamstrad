; =================================================
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
