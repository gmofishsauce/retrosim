/* Copyright (c) Jeff Berkowitz 2025. All rights reserved. */

#include "api.h"

uint64_t g_cycle;         // global: cycle counter 1..n

static uint64_t max_cycles = 10; // TODO set option (somehow?)
static uint64_t por_cycles = 2;  // TODO set option (somehow?)

uint16_t TspGetPor(void) {
    return g_cycle <= por_cycles;
}

// Whether to continue running.
void halt(void) {
    g_cycle = 1 + max_cycles; // TODO XXX
}

int is_running(void) {
    return g_cycle <= max_cycles;
}

inline uint64_t NOT(int sib) {
    return (sib&0x2) ? UNDEF : ~sib&1;
}
