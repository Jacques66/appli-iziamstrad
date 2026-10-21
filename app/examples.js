// Programmes d'exemple. machine : 'cpc' (code injecté en RAM, lancé par CALL) ou 'min' (EPROM en &0000, SRAM en &8000)
export const EXAMPLES = [
  {
    machine: 'cpc',
    name: 'bonjour.asm',
    title: 'Texte, bordure et bip avec le firmware',
    source: `; =================================================
;  bonjour.asm — Amstrad CPC 6128
;  Affiche un message, bordure rouge, puis bip.
;  F7 assemble, injecte en &4000 et tape CALL &4000
; =================================================
TXT_OUTPUT      EQU  &BB5A      ; firmware : affiche le caractère A
SCR_SET_BORDER  EQU  &BC38      ; firmware : couleur de bordure B,C

                ORG  &4000
start:          LD   HL,message
boucle:         LD   A,(HL)     ; caractère suivant
                OR   A          ; fin de chaîne ?
                JR   Z,bordure
                CALL TXT_OUTPUT
                INC  HL
                JR   boucle
bordure:        LD   B,6        ; rouge vif
                LD   C,B
                CALL SCR_SET_BORDER
                LD   A,7        ; BEL : bip du haut-parleur
                CALL TXT_OUTPUT
                RET
message:        DB   "Bonjour Z80 !",13,10,0
                END  start
`,
  },
  {
    machine: 'cpc',
    name: 'bandes.asm',
    title: 'Bandes de couleur synchronisées sur la VSYNC',
    source: `; =================================================
;  bandes.asm — change la couleur de la bordure
;  directement dans le Gate Array, 16 fois par trame.
;  Les interruptions sont coupées : Reset pour sortir.
; =================================================
GA      EQU  &7F00              ; port du Gate Array
PPI_B   EQU  &F500              ; port B du PPI (bit 0 = VSYNC)

        ORG  &4000
start:  DI                      ; timing maîtrisé
trame:  LD   B,PPI_B >> 8
attvbl: IN   A,(C)
        RRA                     ; VSYNC dans la retenue
        JR   NC,attvbl
        LD   HL,couleurs
        LD   E,16               ; 16 bandes
bande:  LD   BC,GA + &10        ; stylo 16 = bordure
        OUT  (C),C
        LD   A,(HL)
        OR   &40                ; commande « couleur »
        OUT  (C),A
        INC  HL
        LD   B,0                ; 256 × 4 µs ≈ 16 lignes
attente:
        DJNZ attente
        DEC  E
        JR   NZ,bande
        JR   trame
couleurs:
        DB   20,4,21,28,24,29,12,5,13,22,6,23,30,0,31,11
`,
  },
  {
    machine: 'cpc',
    name: 'gamme.asm',
    title: 'Gamme jouée en programmant le AY-3-8912',
    source: `; =================================================
;  gamme.asm — joue do ré mi fa sol la si do
;  en écrivant directement les registres du PSG.
;  Activez le son dans l'onglet Machine.
; =================================================
MC_SOUND_REGISTER EQU &BD34     ; A = registre, C = valeur
MC_WAIT_FLYBACK   EQU &BD19     ; attend la VSYNC (1/50 s)

        ORG  &4000
start:  LD   A,7
        LD   C,%00111110        ; mixeur : tonalité A seule
        CALL MC_SOUND_REGISTER
        LD   A,1
        LD   C,0                ; période, octet haut
        CALL MC_SOUND_REGISTER
        LD   A,8
        LD   C,15               ; volume maximal
        CALL MC_SOUND_REGISTER
        LD   HL,gamme
note:   LD   A,(HL)
        OR   A
        JR   Z,fin
        LD   C,A
        XOR  A                  ; registre 0 : période, octet bas
        CALL MC_SOUND_REGISTER
        INC  HL
        LD   B,12               ; 12 trames = 0,24 s
duree:  PUSH BC
        PUSH HL
        CALL MC_WAIT_FLYBACK
        POP  HL
        POP  BC
        DJNZ duree
        JR   note
fin:    LD   A,8
        LD   C,0                ; silence
        CALL MC_SOUND_REGISTER
        RET
; période = 62 500 / fréquence (horloge 1 MHz / 16)
gamme:  DB   239,213,190,179,159,142,127,119,0
`,
  },
  {
    machine: 'cpc',
    name: 'imprimante.asm',
    title: "Envoi d'un texte à l'imprimante",
    source: `; =================================================
;  imprimante.asm — envoie une ligne sur le port
;  Centronics (voir le papier dans l'onglet Machine)
; =================================================
MC_PRINT_CHAR   EQU  &BD2B      ; A = caractère ; retenue = envoyé

        ORG  &4000
start:  LD   HL,texte
suite:  LD   A,(HL)
        OR   A
        RET  Z
envoi:  LD   A,(HL)
        CALL MC_PRINT_CHAR
        JR   NC,envoi           ; imprimante occupée : on réessaie
        INC  HL
        JR   suite
texte:  DB   "Bonjour depuis le Z80A du CPC 6128 !",13,10,0
`,
  },
  {
    machine: 'cpc',
    name: 'ecran-partage.asm',
    title: "Écran partagé MODE 0 / MODE 1 par les interruptions du Gate Array",
    source: `; =================================================
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
`,
  },
  {
    machine: 'cpc',
    name: 'mode0-mode2.asm',
    title: "Écran partagé MODE 0 / MODE 2 en pur assembleur (interruption en &0038)",
    source: `; =================================================
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
`,
  },
  {
    machine: 'min',
    name: 'chenillard.asm',
    title: 'Chenillard sur les 8 LED',
    source: `; =================================================
;  chenillard.asm — Z80 minimal
;  Une LED se déplace ; l'interrupteur 0 inverse le sens
; =================================================
LEDS    EQU  &00            ; port de sortie (74LS374)
INTER   EQU  &01            ; port d'entrée (74LS244)
motif   EQU  &8000          ; variable en SRAM

        ORG  &0000          ; vecteur de reset
start:  LD   SP,&A000       ; pile en haut de la SRAM
        LD   A,%00000001
boucle: OUT  (LEDS),A       ; allume la LED courante
        LD   (motif),A      ; mémorise le motif
        LD   DE,40          ; durée d'attente
attente:
        DEC  DE
        LD   A,D
        OR   E
        JR   NZ,attente
        IN   A,(INTER)      ; lit les interrupteurs
        BIT  0,A
        LD   A,(motif)
        JR   NZ,droite
        RLCA                ; LED suivante vers la gauche
        JR   boucle
droite: RRCA                ; vers la droite
        JR   boucle
`,
  },
  {
    machine: 'min',
    name: 'compteur.asm',
    title: 'Compteur binaire + addition BCD',
    source: `; =================================================
;  compteur.asm — compte en BCD sur les LED
;  DAA corrige l'addition pour rester en décimal
; =================================================
LEDS    EQU  &00
compte  EQU  &8000

        ORG  &0000
start:  LD   SP,&A000
        XOR  A
        LD   (compte),A
suivant:
        LD   A,(compte)
        ADD  A,1
        DAA                 ; 09 + 1 → 10 (BCD)
        LD   (compte),A
        OUT  (LEDS),A
        LD   B,20
pause:  DJNZ pause
        JR   suivant
`,
  },
  {
    machine: 'min',
    name: 'interruption.asm',
    title: 'Interruptions IM 1 (bouton /INT)',
    source: `; =================================================
;  interruption.asm — chaque impulsion sur /INT
;  incrémente les LED (mode IM 1 : saut en &0038)
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
attente:
        HALT                ; dort jusqu'à la prochaine interruption
        JR   attente

        ORG  &0038          ; routine d'interruption IM 1
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
    title: 'Multiplication 8 × 8 bits par décalages',
    source: `; =================================================
;  multiplication.asm — HL = D × E par décalages
;  résultat en SRAM et octet bas sur les LED
; =================================================
LEDS    EQU  &00
resultat EQU &8000

        ORG  &0000
start:  LD   SP,&A000
        LD   D,13           ; multiplicande
        LD   E,11           ; multiplicateur
        CALL mult
        LD   (resultat),HL  ; 13 × 11 = 143 = &008F
        LD   A,L
        OUT  (LEDS),A
fin:    HALT

; HL = D × E  (B, DE modifiés)
mult:   LD   HL,0
        LD   A,D
        LD   D,0
        LD   B,8
bit:    RRA                 ; bit suivant du multiplicande dans C
        JR   NC,saute
        ADD  HL,DE
saute:  SLA  E
        RL   D              ; DE × 2
        DJNZ bit
        RET
`,
  },
];
