/* Copyright (c) Jeff Berkowitz 2024. All rights reserved. */

#ifndef TYPES_H
#define TYPES_H

#include <stdint.h>

/* 456789012345678901234567890123456789012345678901234567890123456789012
 *      10        20        30        40        50        60        70 
 *
 * Four-state digital simulator: bits may be 0, 1, Undefined, or high-Z.
 * Undefs propagate and highz inputs become undefined outputs.
 */

typedef uint16_t index_t;
typedef uint16_t bit16_t;
typedef uint64_t bit64_t;

typedef struct bitvec16 {
    bit16_t values;
    bit16_t undefs;
    bit16_t highzs;
    bit16_t spare;
} bitvec16_t;

typedef struct bitvec64 {
    bit64_t values;
    bit64_t undefs;
    bit64_t highzs;
    bit64_t spare;
} bitvec64_t;

extern bitvec16_t bv16_undef;
extern bitvec16_t bv16_highz;
extern bitvec16_t bv16_ones;
extern bitvec16_t bv16_zeroes;

extern bitvec64_t bv64_undef;
extern bitvec64_t bv64_highz;
extern bitvec64_t bv64_ones;
extern bitvec64_t bv64_zeroes;

#define BV16_ALL  ((bit16_t)0xFFFF)
#define BV16_NONE ((bit16_t)0)
#define BV64_ALL  ((bit64_t)0xFFFFFFFFFFFFFFFF)
#define BV64_NONE ((bit64_t)0)

#endif // TYPES_H
