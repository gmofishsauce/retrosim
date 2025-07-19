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
#include <stdio.h> // temporary here, for debugging

#include "api.h"
#include "sim.h"

extern uint64_t TspNets[]; // XXX temporary here

static int simulate(void);
static int halt(void);
static void rising_edge(void);
static void clock_is_high(void);
static void falling_edge(void);
static void clock_is_low(void);

#define MAX_HOOKS 10 // TODO XXX tsp can compute
static handler_t rising_edge_hooks[MAX_HOOKS];
static handler_t clock_is_high_hooks[MAX_HOOKS];
static handler_t falling_edge_hooks[MAX_HOOKS];
static handler_t clock_is_low_hooks[MAX_HOOKS];

static int n_rising_edge_hooks = 0;
static int n_clock_is_high_hooks = 0;
static int n_falling_edge_hooks = 0;
static int n_clock_is_low_hooks = 0;

int main(int ac, char** av) {
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

// The cycle counter counts from 1, so the first cycle is "1"
// Everything related to cycles is 1-based. I may regret this.

static uint64_t cycle;
static uint64_t  max_cycles = 10;
static uint64_t  por_cycles = 2;
static uint16_t clock = 0;

uint16_t TspGetClk(void) {
    return clock;
}

uint16_t TspGetPor(void) {
    return cycle <= por_cycles;
}

// Whether to continue running.
// TODO mechanism for simulation code to halt the simulator
static int halt(void) {
    return cycle > max_cycles;
}

static inline void execute(handler_t* resolvers) {
    for (int i = 0; resolvers[i] != 0; i++) {
        (*resolvers[i])();
    }
}

static void rising_edge(void) {
    execute(rising_edge_hooks);
}

static void clock_is_high(void) {
    execute(clock_is_high_hooks);
}

static void falling_edge(void) {
    execute(falling_edge_hooks);
}

static void clock_is_low(void) {
    execute(clock_is_low_hooks);
}

void add_rising_edge_hook(handler_t fp) {
    rising_edge_hooks[n_rising_edge_hooks] = fp;
    n_rising_edge_hooks++;
}

void add_clock_is_high_hook(handler_t fp) {
    clock_is_high_hooks[n_clock_is_high_hooks] = fp;
    n_clock_is_high_hooks++;
}

void add_falling_edge_hook(handler_t fp) {
    falling_edge_hooks[n_rising_edge_hooks] = fp;
    n_falling_edge_hooks++;
}

void add_clock_is_low_rising_edge_hook(handler_t fp) {
    clock_is_low_hooks[n_clock_is_low_hooks] = fp;
    n_clock_is_low_hooks++;
}

int simulate(void) { // return exit code, 0 for success or 2 for error
    init();

    for (cycle = 1; !halt(); cycle++) {
        printf("cycle %llu:\n", cycle);
        rising_edge();
        printf("  after rising edge: 0x%llX\n", TspNets[0]);
        clock = 1;
        clock_is_high();
        printf("  after clock is high: 0x%llX\n", TspNets[0]);
        falling_edge();
        clock = 0;
        clock_is_low();
    }

    return 0;
}

