/* Copyright (c) Jeff Berkowitz 2024. All rights reserved. */
/* 456789012345678901234567890123456789012345678901234567890123456789012
 *      10        20        30        40        50        60        70 
 */

#include "sim.h"
#include "types.h"

void print_sizes(void) {
    msg("sizeof(bitvec_t) = %d", sizeof(bitvec_t));
    msg("sizeof(bitbyte_t) = %d", sizeof(bitbyte_t));
    msg("sizeof(binding_t) = %d", sizeof(binding_t));
}
