; =================================================
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
