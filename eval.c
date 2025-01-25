/* Copyright (c) Jeff Berkowitz 2024. All rights reserved. */

/* 456789012345678901234567890123456789012345678901234567890123456789012
 *      10        20        30        40        50        60        70 
 */

#include "sim.h"
#include "part.h"
#include "eval.h"

void eval_zeroes(P_IDX p) {
    parts[p].output = all_zeroes;
}

/*
void eval_ones(S_IDX s) {
    states[s].output = ALL_BITS;
}

void eval_and(S_IDX s) {
}
*/
