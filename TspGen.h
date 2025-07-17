/*
 * Copyright (c) (TODO owning company here) 2025. All rights reserved.
 * This file was generated from a KiCad schematic. Do not edit.
 *
 * Tool: KiCad Eeschema 8.0.8 (schema version E)
 * From: /Users/jeff/go/src/github.com/gmofishsauce/wut4/sim/KiCad/Sample.kicad_sch
 * Date: 2025-06-10T13:48:51-0700
 *
 * sheet 1: / (Sample Schematic)
 */

#include <stdint.h>
// Values of sibs. The values 0 and 1 represent themselves.
#define HIGHZ 2
#define UNDEF 3

// Constants
#define TARGET_WORD_SIZE 64 // must 16, 32, or 64
#define BITS_PER_SIB  2     // physical bits per sib; must be 2, 3, or 4
#define SIB_MASK 0x03ULL    // select a single sib
#define N_NETS 32           // computed by netlist transpiler
#define SIBS_PER_WORD 32    // E.g. 64/2 on 64-bit computers
#define SPW_LOG2 0x05       // lg2(SIBS_PER_WORD)
#define SPW_MASK 0x1FULL    // SPW - 1
extern uint64_t TspWires[];

#define WORD(s)          ((s)>>SPW_LOG2)       // index of word containing sib s
#define POS(s)           ((s)&SPW_MASK)        // position of sib s within word, 0..SIBS_PER_WORD
#define BITPOS(s)		(POS(s)*BITS_PER_SIB) // position of bit holding sib s within word
#define BOUND(v,m)		((v)&(m)) 		      // bound v in 0..m where m = 2^n-1 for some n
#define MASK(n)          ((1ULL<<(2*n))-1ULL)  // create right justified mask selecting n sibs (not bits)

// Get or set a single simulated bit
#define GETSIB(s)        ((TspWires[WORD(s)]>>BITPOS(s))&MASK(1))
#define SETSIB(s, v)     (TspWires[WORD(s)]&=~(MASK(1)<<BITPOS(s)),TspWires[WORD(s)]|=(BOUND(v,MASK(1))<<BITPOS(s)))
// Get or set a contiguous field of n sibs
#define GETSIBS(s, n)    ((TspWires[WORD(s)]>>BITPOS(s))&MASK(n))
#define SETSIBS(s, n, v) (TspWires[WORD(s)]&=~(MASK(n)<<BITPOS(s)),TspWires[WORD(s)]|=(BOUND(v,MASK(n))<<BITPOS(s)))

#define GetGND() 0
#define GetVCC() 1
extern uint16_t  TspGetClk(void);
#define GetCLK() TspGetClk()
extern uint16_t  TspGetPor(void);
#define GetPOR() TspGetPor()

// net N8_U2_3
#define N8_U2_3_POS 0
#define N8_U2_3_SZ 1
extern void N8_U2_3_resolver(void);

#define U1_4 N8_U2_3
#define U2_3 N8_U2_3
#define U2_4 N8_U2_3

// net N9_U2_6
#define N9_U2_6_POS 1
#define N9_U2_6_SZ 1
extern void N9_U2_6_resolver(void);

#define U1_5 N9_U2_6
#define U2_6 N9_U2_6
#define U2_9 N9_U2_6

// net N10_U2_8
#define N10_U2_8_POS 2
#define N10_U2_8_SZ 1
extern void N10_U2_8_resolver(void);

#define U1_12 N10_U2_8
#define U2_12 N10_U2_8
#define U2_8 N10_U2_8

// net N11_U2_11
#define N11_U2_11_POS 3
#define N11_U2_11_SZ 1
extern void N11_U2_11_resolver(void);

#define U1_13 N11_U2_11
#define U2_11 N11_U2_11

// net N12_U1_10_Q2
#define N12_U1_10_Q2_POS 4
#define N12_U1_10_Q2_SZ 1
extern void N12_U1_10_Q2_resolver(void);

#define U1_10 N12_U1_10_Q2
#define U2_10 N12_U1_10_Q2

// net N13_U1_15_Q3
#define N13_U1_15_Q3_POS 5
#define N13_U1_15_Q3_SZ 1
extern void N13_U1_15_Q3_resolver(void);

#define U1_15 N13_U1_15_Q3
#define U2_13 N13_U1_15_Q3

// net N14_U1_6_NOT_Q1
#define N14_U1_6_NOT_Q1_POS 6
#define N14_U1_6_NOT_Q1_SZ 1
extern void N14_U1_6_NOT_Q1_resolver(void);

#define U1_6 N14_U1_6_NOT_Q1
#define U2_5 N14_U1_6_NOT_Q1

// net N17_NOT_POR
#define N17_NOT_POR_POS 7
#define N17_NOT_POR_SZ 1
extern void N17_NOT_POR_resolver(void);

#define U1_1 N17_NOT_POR

// net B1
#define B1_POS 8
#define B1_SZ 4
extern void B1_resolver(void);
