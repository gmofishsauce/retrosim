/* Copyright (c) Jeff Berkowitz 2024. All rights reserved. */

/* 456789012345678901234567890123456789012345678901234567890123456789012
 *      10        20        30        40        50        60        70 
 */

#include "sim.h"
#include "part.h"

part_t parts[MAX_PART];
static P_IDX next_part = 1; // 0 is reserved

bitvec_t all_undef = {NO_BITS, ALL_BITS, NO_BITS, 0};
bitvec_t all_highz = {NO_BITS, NO_BITS, ALL_BITS, 0};
bitvec_t all_ones = {ALL_BITS, NO_BITS, NO_BITS, 0};
bitvec_t all_zeroes = {NO_BITS, NO_BITS, NO_BITS, 0};

/* Make a combinational part. */
P_IDX make_part(char *name, func_t eval, func_t edge) {
    DB(MIN, "make_part %s\n", name);
    if (next_part >= MAX_PART) {
        fatal("cannot allocate memory: part %s\n", name);
    }
    P_IDX p = next_part++;
    parts[p].name = name;
    parts[p].eval = eval;
    parts[p].edge = edge;
    parts[p].output = all_undef;
    parts[p].future = all_undef;
    return p;
}

/* Bind some outputs of from state to the combo or seq input of part to. */
void bind(P_IDX from, P_IDX to, BYTE offset, BYTE n_bits) {
    DB(MIN, "bind outputs from %s to %s\n",
        parts[from].name, parts[to].name);
    if (next_bind >= MAX_BIND) {
        fatal("cannot allocate memory: bind to %s\n", parts[to].name);
    }
    if (parts[from].next_bind >= N_BIND) {
        fatal("too many input binds for %s\n", parts[from].name);
    }
    B_IDX b = next_bind++;
    binds[b].from = from;
    binds[b].offset = offset;
    binds[b].n_bits = n_bits;

    INDEX n = parts[to].next_bind++;
    parts[from].inputs[n] = b;
}
