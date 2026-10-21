; =================================================
;  ecran-partage.asm — Amstrad CPC 6128
;  Écran partagé par interruptions : mode 0 en haut
;  (16 couleurs), mode 1 en bas (texte lisible).
;
;  Le Gate Array déclenche 6 interruptions par trame
;  (toutes les 52 lignes). On s'abonne à deux
;  événements du firmware :
;   - retour de trame (VSYNC) : remet le compteur à 0 ;
;   - horloge rapide (300 Hz, chaque interruption) :
;     1er top après la VSYNC → mode 0 (bordure haute),
;     4e top → mode 1 (vers la ligne 90).
;  Le Gate Array applique le nouveau mode à la
;  synchro horizontale suivante.
;
;  CALL &8000 : dessine les barres et installe
;  CALL &8003 : désinstalle et revient en mode 1
; =================================================
KL_NEW_FRAME_FLY    EQU &BCD7   ; HL = bloc, B = classe, C = ROM, DE = routine
KL_DEL_FRAME_FLY    EQU &BCDD   ; HL = bloc
KL_NEW_FAST_TICKER  EQU &BCE0   ; HL = bloc, B = classe, C = ROM, DE = routine
KL_DEL_FAST_TICKER  EQU &BCE6   ; HL = bloc
MC_SET_MODE         EQU &BD1C   ; A = mode, sans effacer l'écran
CLASSE              EQU &81     ; asynchrone, adresse « proche » en RAM

        ORG  &8000
        JP   installe
        JP   arrete

installe:
        CALL barres
        LD   HL,bloc_vbl
        LD   B,CLASSE
        LD   C,0
        LD   DE,sur_vbl
        CALL KL_NEW_FRAME_FLY
        LD   HL,bloc_300
        LD   B,CLASSE
        LD   C,0
        LD   DE,sur_300
        JP   KL_NEW_FAST_TICKER

arrete: LD   HL,bloc_vbl
        CALL KL_DEL_FRAME_FLY
        LD   HL,bloc_300
        CALL KL_DEL_FAST_TICKER
        LD   A,1
        JP   MC_SET_MODE

; --- événement « retour de trame » : une fois par trame, sur la VSYNC
sur_vbl:
        XOR  A
        LD   (compte),A
        RET

; --- événement « horloge rapide » : à chacune des 6 interruptions
sur_300:
        LD   A,(compte)
        INC  A
        LD   (compte),A
        CP   1
        JR   Z,haut
        CP   4
        RET  NZ
        LD   A,1               ; vers la ligne 90 : mode 1
        JP   MC_SET_MODE
haut:   XOR  A                 ; haut de l'écran : mode 0
        JP   MC_SET_MODE

; --- 16 barres verticales (encres 0 à 15) sur les 10 premières rangées
barres: LD   B,10
        LD   HL,&C000
rangee: PUSH BC
        PUSH HL
        LD   B,8               ; 8 lignes raster par rangée
ligne:  PUSH BC
        PUSH HL
        LD   DE,motifs
        LD   B,16
barre:  LD   A,(DE)
        LD   C,5               ; 5 octets = 10 pixels de mode 0
cinq:   LD   (HL),A
        INC  HL
        DEC  C
        JR   NZ,cinq
        INC  DE
        DJNZ barre
        POP  HL
        LD   BC,&0800          ; ligne raster suivante
        ADD  HL,BC
        POP  BC
        DJNZ ligne
        POP  HL
        LD   BC,80             ; rangée suivante
        ADD  HL,BC
        POP  BC
        DJNZ rangee
        RET

; octet de mode 0 dont les 2 pixels ont l'encre n (bits 7-6 = b0, 3-2 = b1, 5-4 = b2, 1-0 = b3)
motifs: DB   &00,&C0,&0C,&CC,&30,&F0,&3C,&FC,&03,&C3,&0F,&CF,&33,&F3,&3F,&FF

compte:   DB 0
bloc_vbl: DS 16                ; blocs d'événement du firmware
bloc_300: DS 16
