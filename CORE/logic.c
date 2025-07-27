/* Copyright (c) Jeff Berkowitz 2024. All rights reserved. */
/* 456789012345678901234567890123456789012345678901234567890123456789012
 *      10        20        30        40        50        60        70 
 *
 * 4-state logical functions for use by component implementations.
 */

#include "api.h"

// Sibs (simulated bits) are 4-state bits. They take 2 bits to store.
// The type uint64_t propagates from the bit vector that is used by
// by the simulation core to represent values of all the nets.

#define X 3
#define SIB(v) (v&3)

extern uint8_t and4s_table[], or4s_table[], xor4s_table[], not4s_table[];

uint8_t and4s_table[] = {
/*         0  1  Z  X  */
/* 0 */    0, 0, 0, 0,
/* 1 */    0, 1, X, X,
/* Z */    0, X, X, X,
/* X */    0, X, X, X,
};

uint8_t or4s_table[] = {
/*         0  1  Z  X  */
/* 0 */    0, 1, X, X,
/* 1 */    1, 1, X, X,
/* Z */    X, X, X, X,
/* X */    X, X, X, X,
};

uint8_t xor4s_table[] = {
/*         0  1  Z  X  */
/* 0 */    0, 1, X, X,
/* 1 */    1, 0, X, X,
/* Z */    X, X, X, X,
/* X */    X, X, X, X,
};

uint8_t not4s_table[] = {
/*         0  1  Z  X  */
/* 0 */    1, 0, X, X,
};

inline sib_t and4s(sib_t a0, sib_t a1) {
    return (sib_t)and4s_table[SIB(a1)<<2|SIB(a0)];
}

inline sib_t or4s(sib_t a0, sib_t a1) {
    return (sib_t)or4s_table[SIB(a1)<<2|SIB(a0)];
}

inline sib_t xor4s(sib_t a0, sib_t a1) {
    return (sib_t)xor4s_table[SIB(a1)<<2|SIB(a0)];
}

inline sib_t not4s(sib_t a0) {
    return (sib_t)not4s_table[SIB(a0)];
}

