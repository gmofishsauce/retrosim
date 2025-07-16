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
// Bit states (values of the 2-bit fields that each represent 1 wire net):
// The values 0 and 1 represent themselves
#define HIGHZ 2
#define UNDEF 3

// Wire nets
#define TARGET_WORD_SIZE 64 // must be a power of 2
#define BITS_PER_WIRE  2    // there are four bit states
#define N_WIRES 32          // computed by netlist transpiler
#define BITS_PER_WORD 32    // should be 64/2 on 64-bit (most) computers
#define BPW_LOG2 0x05       // lg2(BITS_PER_WORD)
#define BPW_MASK 0x1F       // BPW - 1
extern uint64_t TspWires[];

#define GETBIT(b)        (TspWires[(b)>>BPW_LOG2]>>(((b)&BPW_MASK)&1ULL))
#define SETBIT(b, v)     (((TspWires[(b)>>BPW_LOG2])&=~((uint64_t)(1ULL<<(b)))),((TspWires[(b)>>BPW_LOG2])|=((v)&1ULL)<<(b)))
#define GETBITS(b, n)    (((TspWires[(b)>>BPW_LOG2])>>((b)&BPW_MASK))&((1ULL<<(n))-1ULL))
#define SETBITS(b, n, v) (((TspWires[(b)>>BPW_LOG2])&=~(((uint64_t)((1ULL<<(n))-1ULL))<<(b))),((TspWires[(b)>>BPW_LOG2])|=((v)&(((1ULL<<(n))-1ULL)))<<(b)))

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
