; =================================================
;  mode0-mode2.asm — Amstrad CPC 6128, pur assembleur
;  Écran partagé : MODE 0 en haut (16 couleurs qui
;  tournent), MODE 2 en bas (80 colonnes de texte).
;
;  Aucun appel au firmware une fois lancé :
;   - la ROM basse est coupée et le Z80 trouve en &0038
;     (RAM) notre propre routine d'interruption (IM 1) ;
;   - le Gate Array interrompt toutes les 52 lignes ;
;     celle qui tombe pendant la VSYNC (PPI port B,
;     bit 0) remet le compteur à 0 → MODE 0 ;
;     la 3e suivante (vers la ligne 90) → MODE 2 ;
;   - le mode est écrit directement dans le Gate Array
;     (port &7Fxx, commande %100xxxmm) et pris en compte
;     à la synchro horizontale suivante ;
;   - le texte est dessiné octet par octet avec la police
;     copiée de la ROM (&3800) ;
;   - le clavier est lu par le PPI et le PSG (registre 14) ;
;   - la musique est jouée sur l'interruption de la VSYNC
;     (50 Hz) en écrivant directement les registres du
;     PSG AY-3-8912 : voix A mélodie (« Au clair de la
;     lune ») avec enveloppe de volume logicielle, voix B
;     basse, voix C bruit (charleston) sur chaque temps.
;
;  CALL &8000 · ESPACE pour revenir au BASIC (puis MODE 1)
; =================================================
GA_MODE0  EQU  &8C              ; %10001100 : mode 0, ROM basse et haute coupées
GA_MODE2  EQU  &8E              ; mode 2, ROM coupées
GA_BASIC  EQU  &85              ; mode 1, ROM basse coupée, ROM haute (BASIC) visible
ECRAN     EQU  &C000
POLICE    EQU  &9000            ; copie de la police de la ROM (2 Ko)

        ORG  &8000
start:  DI
        ; --- copie de la police : ROM basse visible le temps du LDIR
        LD   BC,&7F89           ; mode 1, ROM basse visible, ROM haute coupée
        OUT  (C),C
        LD   HL,&3800
        LD   DE,POLICE
        LD   BC,&0800
        LDIR
        LD   BC,&7F00 + GA_MODE0
        OUT  (C),C              ; ROM coupées : &0038 et &C000 sont en RAM
        ; --- écran à &C000 sans décalage (le BASIC a pu faire défiler l'écran)
        LD   BC,&BC0C
        OUT  (C),C
        LD   BC,&BD30
        OUT  (C),C
        LD   BC,&BC0D
        OUT  (C),C
        LD   BC,&BD00
        OUT  (C),C
        ; --- efface l'écran
        LD   HL,ECRAN
        LD   DE,ECRAN + 1
        LD   BC,&3FFF
        LD   (HL),0
        LDIR
        ; --- palette : encre 0 bleu, 1 blanc, 2 à 15 arc-en-ciel, bordure noire
        LD   HL,couleurs
        LD   E,0
pal:    LD   B,&7F
        OUT  (C),E              ; %000nnnnn : choisit l'encre n
        LD   A,(HL)
        OR   &40                ; %010ccccc : couleur matérielle
        OUT  (C),A
        INC  HL
        INC  E
        LD   A,E
        CP   16
        JR   NZ,pal
        LD   BC,&7F10           ; stylo 16 = bordure
        OUT  (C),C
        LD   A,&54              ; noir
        OUT  (C),A
        ; --- dessin : barres en haut, texte en bas
        CALL barres
        LD   HL,textes
ecrit:  LD   E,(HL)
        INC  HL
        LD   D,(HL)
        INC  HL
        LD   A,D
        OR   E
        JR   Z,installe
        CALL texte
        JR   ecrit
        ; --- notre routine d'interruption en &0038
installe:
        LD   HL,&0038
        LD   DE,sauve
        LD   BC,3
        LDIR                    ; garde les 3 octets du firmware
        LD   A,&C3              ; JP inter
        LD   (&0038),A
        LD   HL,inter
        LD   (&0039),HL
        CALL son_init
        IM   1
        EI

; --- boucle principale : couleurs qui tournent, ESPACE pour sortir
boucle: LD   HL,trames
        LD   A,(HL)
attend: CP   (HL)               ; attend la trame suivante
        JR   Z,attend
        AND  3
        CALL Z,tourne
        LD   D,5                ; ligne 5 de la matrice : ESPACE = bit 7
        DI                      ; l'interruption joue la musique par le même PPI
        CALL clavier
        EI
        BIT  7,A
        JR   NZ,boucle
sortie: DI
        CALL silence
        LD   HL,sauve
        LD   DE,&0038
        LD   BC,3
        LDIR                    ; rend &0038 au firmware
        LD   BC,&7F00 + GA_BASIC
        OUT  (C),C
        EI
        RET

; --- interruption du Gate Array (6 par trame)
inter:  PUSH AF
        PUSH BC
        LD   B,&F5              ; PPI port B
        IN   A,(C)
        RRA                     ; bit 0 = VSYNC → retenue
        LD   A,(compte)
        JR   NC,pas_vbl
        XOR  A                  ; interruption de la VSYNC
        LD   (compte),A
        LD   BC,&7F00 + GA_MODE0
        OUT  (C),C              ; haut de l'écran en MODE 0
        LD   A,(trames)
        INC  A
        LD   (trames),A
        PUSH DE
        PUSH HL
        CALL musique            ; une trame de musique (50 Hz)
        POP  HL
        POP  DE
        JR   fin
pas_vbl:
        INC  A
        LD   (compte),A
        CP   3
        JR   NZ,fin
        LD   BC,&7F00 + GA_MODE2
        OUT  (C),C              ; vers la ligne 90 : MODE 2
fin:    POP  BC
        POP  AF
        EI
        RET

; --- écrit E dans le registre A du PSG (bus du PSG relié au port A du PPI, BDIR/BC1 au port C)
psg:    LD   B,&F4
        OUT  (C),A              ; PPI A ← n° de registre
        LD   BC,&F6C0           ; BDIR=1 BC1=1 : sélection du registre
        OUT  (C),C
        LD   BC,&F600           ; inactif
        OUT  (C),C
        LD   B,&F4
        OUT  (C),E              ; PPI A ← valeur
        LD   BC,&F680           ; BDIR=1 BC1=0 : écriture
        OUT  (C),C
        LD   BC,&F600
        OUT  (C),C
        RET

son_init:
        LD   A,7
        LD   E,%00011100        ; tonalités A et B, bruit sur C ; port A en entrée (clavier)
        CALL psg
        LD   A,6
        LD   E,3                ; période du bruit
        CALL psg
        LD   HL,partition
        LD   (note),HL
        LD   A,1
        LD   (duree),A
        RET

silence:
        LD   A,8
        LD   E,0
        CALL psg
        LD   A,9
        CALL psg
        LD   A,10
        JP   psg

; --- une trame de musique : note suivante quand la durée est écoulée, puis enveloppes
musique:
        LD   HL,duree
        DEC  (HL)
        JR   NZ,enveloppe
        LD   HL,(note)
        LD   A,(HL)             ; durée en trames, 0 = reprise au début
        OR   A
        JR   NZ,joue
        LD   HL,partition
        LD   A,(HL)
joue:   LD   (duree),A
        INC  HL
        LD   A,(HL)             ; mélodie : n° de note
        INC  HL
        PUSH HL
        LD   HL,per_melodie
        CALL periode
        LD   A,0                ; R0/R1 : période de la voix A
        CALL psg
        LD   E,D
        LD   A,1
        CALL psg
        POP  HL
        LD   A,(HL)             ; basse : n° de note
        INC  HL
        LD   (note),HL
        LD   HL,per_basse
        CALL periode
        LD   A,2                ; R2/R3 : période de la voix B
        CALL psg
        LD   E,D
        LD   A,3
        CALL psg
        LD   A,15
        LD   (vol_a),A          ; attaque de la note
        LD   A,13
        LD   (vol_c),A          ; coup de charleston
enveloppe:
        LD   A,(vol_a)          ; décroissance de la mélodie jusqu'à 8
        CP   9
        JR   C,va
        DEC  A
        LD   (vol_a),A
va:     LD   E,A
        LD   A,8
        CALL psg
        LD   A,9
        LD   E,10               ; basse : volume fixe
        CALL psg
        LD   A,(vol_c)          ; charleston : très court
        SUB  4
        JR   NC,vc
        XOR  A
vc:     LD   (vol_c),A
        LD   E,A
        LD   A,10
        JP   psg

; --- DE = période n° A de la table HL
periode:
        ADD  A,A
        LD   C,A
        LD   B,0
        ADD  HL,BC
        LD   E,(HL)
        INC  HL
        LD   D,(HL)
        RET

; --- fait tourner les couleurs des encres 2 à 15
tourne: LD   HL,couleurs + 2
        LD   A,(HL)             ; décale la table d'un cran
        LD   DE,couleurs + 2
        INC  HL
        LD   BC,13
        LDIR
        LD   (DE),A
        LD   HL,couleurs + 2
        LD   E,2
tour2:  LD   B,&7F
        OUT  (C),E
        LD   A,(HL)
        OR   &40
        OUT  (C),A
        INC  HL
        INC  E
        LD   A,E
        CP   16
        JR   NZ,tour2
        RET

; --- lecture d'une ligne du clavier : D = ligne (0-9), A = colonnes (0 = enfoncée)
clavier:
        LD   BC,&F40E           ; PPI A ← n° de registre 14 du PSG
        OUT  (C),C
        LD   BC,&F6C0           ; PPI C : BDIR=1, BC1=1 → sélection du registre
        OUT  (C),C
        LD   BC,&F600           ; inactif
        OUT  (C),C
        LD   BC,&F792           ; PPI : port A en entrée
        OUT  (C),C
        LD   A,D
        OR   &40                ; BC1=1 : lecture du PSG, + n° de ligne clavier
        LD   B,&F6
        OUT  (C),A
        LD   B,&F4
        IN   A,(C)              ; colonnes de la ligne
        LD   BC,&F782           ; port A en sortie
        OUT  (C),C
        LD   BC,&F600
        OUT  (C),C
        RET

; --- texte en MODE 2 : DE = adresse écran, HL = chaîne terminée par 0 ; HL pointe après
texte:  LD   A,(HL)
        INC  HL
        OR   A
        RET  Z
        PUSH HL
        PUSH DE
        LD   L,A
        LD   H,0
        ADD  HL,HL
        ADD  HL,HL
        ADD  HL,HL              ; caractère × 8
        LD   BC,POLICE
        ADD  HL,BC
        LD   B,8
txl:    LD   A,(HL)             ; une ligne du caractère = un octet de MODE 2
        LD   (DE),A
        INC  HL
        LD   A,D
        ADD  A,8                ; ligne raster suivante : +&800
        LD   D,A
        DJNZ txl
        POP  DE
        POP  HL
        INC  DE
        JR   texte

; --- 16 barres verticales de MODE 0 sur les 10 premières rangées
barres: LD   B,10
        LD   HL,ECRAN
rangee: PUSH BC
        PUSH HL
        LD   B,8
ligne:  PUSH BC
        PUSH HL
        LD   DE,motifs
        LD   B,16
barre:  LD   A,(DE)
        LD   C,5
cinq:   LD   (HL),A
        INC  HL
        DEC  C
        JR   NZ,cinq
        INC  DE
        DJNZ barre
        POP  HL
        LD   BC,&0800
        ADD  HL,BC
        POP  BC
        DJNZ ligne
        POP  HL
        LD   BC,80
        ADD  HL,BC
        POP  BC
        DJNZ rangee
        RET

motifs: DB   &00,&C0,&0C,&CC,&30,&F0,&3C,&FC,&03,&C3,&0F,&CF,&33,&F3,&3F,&FF
; couleurs matérielles : bleu, blanc vif, puis 14 teintes
couleurs:
        DB   &04,&0B,&0C,&0E,&0A,&1A,&12,&02,&13,&17,&15,&1D,&0D,&07,&0F,&03

textes: DW   ECRAN + 12 * 80
        DB   "MODE 2 : 640 x 200, 2 couleurs, 80 colonnes - texte dessine en pur assembleur",0
        DW   ECRAN + 14 * 80
        DB   "Le Z80 prend l'interruption en &0038 (ROM basse coupee). A chaque interruption",0
        DW   ECRAN + 15 * 80
        DB   "du Gate Array (300 Hz), il lit la VSYNC sur le PPI, compte et ecrit le mode",0
        DW   ECRAN + 16 * 80
        DB   "dans le Gate Array (port &7F00) : MODE 0 a la VSYNC, MODE 2 trois plus tard.",0
        DW   ECRAN + 18 * 80
        DB   "En haut : MODE 0, 160 x 200, 16 couleurs (elles tournent toutes les 4 trames).",0
        DW   ECRAN + 19 * 80
        DB   "Musique : AY-3-8912 ecrit en direct sur la VSYNC (A melodie, B basse, C bruit).",0
        DW   ECRAN + 21 * 80
        DB   "ESPACE pour revenir au BASIC, puis tapez MODE 1.",0
        DW   0

; périodes du PSG = 62 500 / fréquence (horloge 1 MHz ÷ 16)
per_melodie:
        DW   119,106,95,159,142,127   ; do5 523 Hz, ré5 587, mi5 659, sol4 392, la4 440, si4 494
per_basse:
        DW   478,638,716              ; do3 131 Hz, sol2 98, fa2 87
DO5  EQU 0
RE5  EQU 1
MI5  EQU 2
SOL4 EQU 3
LA4  EQU 4
SI4  EQU 5
DO3  EQU 0
SOL2 EQU 1
FA2  EQU 2
; partition : durée en trames, note de la mélodie, note de la basse ; durée 0 = reprise
N   EQU 12                      ; une noire = 12 trames (0,24 s)
partition:
        ; « Au clair de la lune » : do do do ré | mi ré | do mi ré ré | do
        DB   N,DO5,DO3
        DB   N,DO5,DO3
        DB   N,DO5,DO3
        DB   N,RE5,SOL2
        DB   2*N,MI5,DO3
        DB   2*N,RE5,SOL2
        DB   N,DO5,DO3
        DB   N,MI5,DO3
        DB   N,RE5,SOL2
        DB   N,RE5,SOL2
        DB   4*N,DO5,DO3
        DB   N,DO5,DO3
        DB   N,DO5,DO3
        DB   N,DO5,DO3
        DB   N,RE5,SOL2
        DB   2*N,MI5,DO3
        DB   2*N,RE5,SOL2
        DB   N,DO5,DO3
        DB   N,MI5,DO3
        DB   N,RE5,SOL2
        DB   N,RE5,SOL2
        DB   4*N,DO5,DO3
        ; ré ré ré ré | la la | ré do si la | sol
        DB   N,RE5,SOL2
        DB   N,RE5,SOL2
        DB   N,RE5,SOL2
        DB   N,RE5,SOL2
        DB   2*N,LA4,FA2
        DB   2*N,LA4,FA2
        DB   N,RE5,SOL2
        DB   N,DO5,DO3
        DB   N,SI4,SOL2
        DB   N,LA4,FA2
        DB   4*N,SOL4,SOL2
        ; do do do ré | mi ré | do mi ré ré | do
        DB   N,DO5,DO3
        DB   N,DO5,DO3
        DB   N,DO5,DO3
        DB   N,RE5,SOL2
        DB   2*N,MI5,DO3
        DB   2*N,RE5,SOL2
        DB   N,DO5,DO3
        DB   N,MI5,DO3
        DB   N,RE5,SOL2
        DB   N,RE5,SOL2
        DB   4*N,DO5,DO3
        DB 0

note:   DW   0
duree:  DB   0
vol_a:  DB   0
vol_c:  DB   0
compte: DB   0
trames: DB   0
sauve:  DS   3
