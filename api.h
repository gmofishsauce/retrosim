/* Copyright (c) Jeff Berkowitz 2025. All rights reserved. */

#ifndef API_H
#define API_H

#include <stdint.h>

// Constants
#define TARGET_WORD_SIZE 64 // in theory can be 16 or 32 ... not tried.
#define BITS_PER_SIB  2     // physical bits per sib
#define SIB_MASK 0x03ULL    // select a single sib
#define SIBS_PER_WORD (TARGET_WORD_SIZE/BITS_PER_SIB)
#define SPW_LOG2 0x05       // lg2(SIBS_PER_WORD) (must match TARGET_WORD_SIZE)
#define SPW_MASK 0x1FULL    // SIBS_PER_WORD - 1 (must match TARGET_WORD_SIZE)

// Values of sibs. The values 0 and 1 represent themselves.
#define HIGHZ 2
#define UNDEF 3

#define WORD(s)          ((s)>>SPW_LOG2)       // array index of target word containing sib s
#define POS(s)           ((s)&SPW_MASK)        // position of sib s within word, 0..SIBS_PER_WORD
#define BITPOS(s)        (POS(s)*BITS_PER_SIB) // position of bit holding sib s within word
#define BOUND(v,m)       ((v)&(m)) 		       // bound v in 0..m where m = 2^n-1 for some n
#define MASK(n)          ((1ULL<<(BITS_PER_SIB*n))-1ULL) // mask selecting n sibs (not bits)

// Get or set a single sib in the variable sym, an array of WORDs
#define GET1(sym, s)       ((sym[WORD(s)]>>BITPOS(s))&MASK(1))
#define SET1(sym, s, v)    (sym[WORD(s)]&=~(MASK(1)<<BITPOS(s)),sym[WORD(s)]|=(BOUND(v,MASK(1))<<BITPOS(s)))

// Get or set n sibs in the variable sym, an array of WORDs
#define GETN(sym, s, n)    ((sym[WORD(s)]>>BITPOS(s))&MASK(n))
#define SETN(sym, s, n, v) (sym[WORD(s)]&=~(MASK(n)<<BITPOS(s)),sym[WORD(s)]|=(BOUND(v,MASK(n))<<BITPOS(s)))

// The aliases getnet() and setnet() for GET1() and SET1() are emitted
// into the generated .h file. Similarly for getbus() and setbus().

#define GetGND() 0
#define GetVCC() 1
extern uint16_t  TspGetClk(void);
#define GetCLK() TspGetClk()
extern uint16_t  TspGetPor(void);
#define GetPOR() TspGetPor()

// global variables
extern uint64_t g_cycle; // counts from 1 to n

extern void init(void);
extern void halt(void);
extern int is_running(void);

typedef void (*handler_t)(void);

extern void add_rising_edge_hook(handler_t fp);
extern void add_clock_is_high_hook(handler_t fp);
extern void add_falling_edge_hook(handler_t fp);
extern void add_clock_is_low_rising_edge_hook(handler_t fp);

uint64_t NOT(int sib);

#endif // API_H
