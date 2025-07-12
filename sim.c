/* Copyright (c) Jeff Berkowitz 2024. All rights reserved. */
/* 456789012345678901234567890123456789012345678901234567890123456789012
 *      10        20        30        40        50        60        70 
 *
 * WUT-4 simulator. There is an older emulator for an earlier version of
 * the instruction set in ../emul.
 *
 * System includes on Mac are in:
 * /Library/Developer/CommandLineTools/SDKs/MacOSX.sdk/usr/include/
 */

#include <stdlib.h>
#include <unistd.h>
#include "sim.h"
#include "types.h"

#include "TspGen.h"
#define public 

// TODO replace the word "resolver" with "hook" globally

static int simulate(void);
static int halt(void);
static void rising_edge(void);
static void clock_is_high(void);
static void falling_edge(void);
static void clock_is_low(void);

public int main(int ac, char** av) {
    int c;
    while ((c = getopt(ac, av, "qd:")) != -1) {
        switch (c) {
        case 'q':
            set_quiet(true);
            break;
        case 'd':
#if !defined(DEBUG)
            msg("warning: -d flag: debugging is not enabled");
#else
            set_debug((unsigned int)atoi(optarg));
#endif
            break;
        default:
            /* getopt() already printed the message */
            fatal("quit\n");
        }
    }
    if (optind < ac) {
        fatal("unexpected option: %s\n", av[optind]);
    }

    msg("%s: firing up...", av[0]);
    DB(MIN, "%s", "Debug MIN enabled");
    DB(MED, "%s", "Debug MED enabled");
    DB(MAX, "%s", "Debug MAX enabled");
    int exitCode = simulate();
    msg("%s: exit %d", av[0], exitCode);
    return exitCode;
}

public bitvec16_t bv16_ones   = { BV16_ALL,  BV16_NONE, BV16_NONE, 0};
public bitvec16_t bv16_zeroes = { BV16_NONE, BV16_NONE, BV16_NONE, 0};
public bitvec16_t bv16_undef  = { BV16_NONE, BV16_ALL,  BV16_NONE, 0};
public bitvec16_t bv16_highz  = { BV16_NONE, BV16_NONE, BV16_ALL, 0};

public bitvec64_t bv64_ones   = { BV64_ALL,  BV64_NONE, BV64_NONE, 0};
public bitvec64_t bv64_zeroes = { BV64_NONE, BV64_NONE, BV64_NONE, 0};
public bitvec64_t bv64_undef  = { BV64_NONE, BV64_ALL,  BV64_NONE, 0};
public bitvec64_t bv64_highz  = { BV64_NONE, BV64_NONE, BV64_ALL, 0};

// The cycle counter counts from 1, so the first cycle is "1"
// Everything related to cycles is 1-based. I may regret this.

static int cycle;
static int max_cycles = 10;
static int por_cycles = 2;

static uint16_t clock = 0;

// Whether to continue running.
// TODO mechanism for simulation code to halt the simulator
static int halt(void) {
    return cycle > max_cycles;
}

uint16_t TspGetClk(void) {
    return clock;
}

uint16_t TspGetPor(void) {
    return cycle <= por_cycles;
}

#define MAX_RESOLVERS 10 // for Sample.net: tsp can compute: TODO
typedef void (*handler_t)(void);
static handler_t rising_edge_resolvers[MAX_RESOLVERS];
static handler_t clock_is_high_resolvers[MAX_RESOLVERS];
static handler_t falling_edge_resolvers[MAX_RESOLVERS];
static handler_t clock_is_low_resolvers[MAX_RESOLVERS];

static inline void execute(handler_t* resolvers) {
    for (int i = 0; resolvers[i] != 0; i++) {
        (*resolvers[i])();
    }
}

static void rising_edge(void) {
    execute(rising_edge_resolvers);
}

static void clock_is_high(void) {
    execute(clock_is_high_resolvers);
}

static void falling_edge(void) {
    execute(falling_edge_resolvers);
}

static void clock_is_low(void) {
    execute(clock_is_low_resolvers);
}

// TODO how about some kind of registration scheme where
// components (really resolvers) would register themselves
// for each/any of the four events? Better, each resolver
// could provide a value that would cause registrations.

int simulate(void) { // return exit code, 0 for success or 2 for error

    for (cycle = 1; !halt(); cycle++) {
        rising_edge();
        clock = 1;
        clock_is_high();
        falling_edge();
        clock = 0;
        clock_is_low();
    }

    return 0;
}

