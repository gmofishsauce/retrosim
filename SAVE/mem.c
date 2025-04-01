/* Copyright (c) Jeff Berkowitz 2024. All rights reserved. */

/* 456789012345678901234567890123456789012345678901234567890123456789012
 *      10        20        30        40        50        60        70 
 */

#include "sim.h"

/* Memory state and accessors. Will try inlining later.
 *
 * There are three 64k x 16 static RAMs: General registers, special
 * registers, and memory management unit (MMU). They don't need to be
 * 64k each, but smaller RAMs don't exist.
 *
 * There is 2M x 16 main memory. It is byte addressable using a high
 * byte/low byte control.
 *
 * Each of these memories can be read or written once per cycle except
 * reg[], which supports two reads -or- one write in each cycle.
 */
static uint16_t reg[64 * 1024];
static uint16_t spr[64 * 1024];
static uint16_t mmu[64 * 1024];
static union {
    uint16_t word[2048 * 1024];
    uint8_t  byte[4096 * 1024];
} mem;

uint16_t rdreg(uint32_t at) {
    return reg[at];
}

void wrreg(uint32_t at, uint16_t v) {
    reg[at] = v;
}

uint16_t rdspr(uint32_t at) {
    return spr[at];
}

void wrspr(uint32_t at, uint16_t v) {
    spr[at] = v;
}

uint16_t rdmmu(uint32_t at) {
    return mmu[at];
}

void wrmmu(uint32_t at, uint16_t v) {
    mmu[at] = v;
}

uint16_t rdmem(uint32_t at) {
    return mem.word[at>>1];
}

void wrmem(uint32_t at, uint16_t v) {
    mem.word[at>>1] = v;
}

uint8_t rdmemb(uint32_t at) {
    return mem.byte[at];
}

void wrmemb(uint32_t at, uint8_t v) {
    mem.byte[at] = v;
}

