/* Copyright (c) Jeff Berkowitz 2024. All rights reserved. */

/* 456789012345678901234567890123456789012345678901234567890123456789012
 *      10        20        30        40        50        60        70 
 */

#include "sim.h"
#include "part.h"

/* The index 0 is generally reserved. */

state_t states[MAX_STATE];
static S_IDX next_state = 1;

bind_t binds[MAX_BIND];
static B_IDX next_bind = 1;

part_t parts[MAX_PART];
static P_IDX next_part = 1;

/* Make a state_t */
S_IDX make_state(P_IDX p) {
    DB(MIN, "make_state for part %s\n", parts[p].name);
    if (next_state >= MAX_STATE) {
        fatal("cannot allocate memory: state for %s\n", parts[p].name);
    }
    S_IDX s = next_state++;
    states[s].part = p;
    states[s].undefs = ALL_BITS;
    return s;
}

/* Make a sequential part. */
P_IDX make_seq(char *name, void (*eval)(void), void (*edge)(void)) {
    P_IDX p = make_comb(name, eval, edge);
    parts[p].future = make_state(p);
    return p;
}

/* Make a combinational part. */
P_IDX make_comb(char *name, void (*eval)(void), void (*edge)(void)) {
    DB(MIN, "make_part %s\n", name);
    if (next_part >= MAX_PART) {
        fatal("cannot allocate memory: part %s\n", name);
    }
    P_IDX p = next_part++;
    parts[p].name = name;
    parts[p].eval = eval;
    parts[p].edge = edge;
    parts[p].output = make_state(p);
    parts[p].future = 0;
    return p;
}

/* Bind some outputs of from state to the combo or seq input of part to. */
void bind(S_IDX from, P_IDX to, INDEX offset, INDEX n_bits) {
    part_t *pval = &parts[states[from].part];
    DB(MIN, "bind outputs from %s to %s\n",
        pval->name, parts[to].name);
    if (parts[to].next_bind >= MAX_BIND) {
        fatal("cannot allocate memory: bind to %s\n", parts[to].name);
    }
    if (pval->next_bind >= N_BIND) {
        fatal("too many input binds for %s\n", pval->name);
    }
    B_IDX b = next_bind++;
    binds[b].from = from;
    binds[b].offset = offset;
    binds[b].n_bits = n_bits;

    INDEX n = pval->next_bind++;
    pval->inputs[n] = b;
}
