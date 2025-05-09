/* Copyright (c) Jeff Berkowitz 2024. All rights reserved. */

#ifndef TYPES_H
#define TYPES_H

/* 456789012345678901234567890123456789012345678901234567890123456789012
 *      10        20        30        40        50        60        70 
 *
 * Four-state digital simulator: bits may be 0, 1, Undefined, or high-Z.
 * Undefs propagate and highz inputs become undefined outputs.
 */

typedef uint16_t index_t;
typedef uint16_t bits_t;

typedef struct bitvec {
    index_t owner;
    bits_t values;
    bits_t undefs;
    bits_t highzs;
} bitvec_t;

extern bitvec_t bv_undef;
extern bitvec_t bv_highz;
extern bitvec_t bv_ones;
extern bitvec_t bv_zeroes;

#define BV_ALL  ((bits_t)0xFFFF)
#define BV_NONE ((bits_t)0)

typedef uint8_t bit_t; // "bit", singular

#define BB_0    ((bit_t)0)   // bit is 0
#define BB_1    ((bit_t)1)   // bit is 1
#define BB_Z    ((bit_t)2)   // bit is Z
#define BB_U    ((bit_t)3)   // bit is U

#endif // TYPES_H
