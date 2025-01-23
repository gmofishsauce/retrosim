/* Copyright (c) Jeff Berkowitz 2024. All rights reserved. */

/* 456789012345678901234567890123456789012345678901234567890123456789012
 *      10        20        30        40        50        60        70 
 */

#include "sim.h"
#include "part.h"

state_t state_pool[MAX_STATE];
static INDEX next_state = 0;

bind_t bind_pool[MAX_BIND];
static INDEX next_bind = 0;

part_t part_pool[MAX_PART];
static INDEX next_part = 0;

/* Allocate a state_t */
S_IDX alloc_state(P_IDX part) {
    DB(MIN, "alloc_state for %s\n", part_pool[P_IDX].name);
    if (next_part >= MAX_PART) {
        fatal("cannot allocate memory: state for %s\n", part_pool[P_IDX].name);
    }
    state_t *result = &state_pool[next_part++];

}

/* Make a sequential part. */
P_IDX make_seq(char *name, void (*eval)(void), void (*edge)(void)) {
    P_IDX part = make_comb(name, eval, edge);
    part_pool[P_IDX].future = alloc_state(part);
    return P_IDX;
}

/* Make a combinational part. */
P_IDX make_comb(char *name, void (*eval)(void), void (*edge)(void)) {
    DB(MIN, "make_part %s\n", name);
    if (next_state >= MAX_STATE) {
        fatal("cannot allocate memory: state (%s)\n", name);
    }
    part_t *result = &part_pool[next_part++];
    result->name = name;
    result->eval = eval;
    result->edge = edge;
    return (P_IDX)(result - part_pool);
}

B_IDX bind(S_IDX from, P_IDX to, INDEX offset, INDEX n_bits) {
    DB(MIN, "bind outputs from %s to %s\n", 
}

