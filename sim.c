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

// TODO replace the word "resolver" with "hook" globally
// TODO using function pointers for the resolvers allows
// code manipulate their order in search of a forward-only
// resolution order.

static int simulate(void);
static int halt(void);
static void rising_edge(void);
static void clock_is_high(void);
static void falling_edge(void);
static void clock_is_low(void);

#define MAX_RESOLVERS 10 // for Sample.net: tsp can compute: TODO
static handler_t rising_edge_resolvers[MAX_RESOLVERS];
static handler_t clock_is_high_resolvers[MAX_RESOLVERS];
static handler_t falling_edge_resolvers[MAX_RESOLVERS];
static handler_t clock_is_low_resolvers[MAX_RESOLVERS];

static int n_rising_edge_resolvers = 0;
static int n_clock_is_high_resolvers = 0;
static int n_falling_edge_resolvers = 0;
static int n_clock_is_low_resolvers = 0;

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

static unsigned long long cycle;
static unsigned long long  max_cycles = 10;
static unsigned long long  por_cycles = 2;
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

void add_rising_edge_resolver(handler_t fp) {
    rising_edge_resolvers[n_rising_edge_resolvers] = fp;
    n_rising_edge_resolvers++;
}

void add_clock_is_high_resolver(handler_t fp) {
    clock_is_high_resolvers[n_clock_is_high_resolvers] = fp;
    n_clock_is_high_resolvers++;
}

void add_falling_edge_resolver(handler_t fp) {
    falling_edge_resolvers[n_rising_edge_resolvers] = fp;
    n_falling_edge_resolvers++;
}

void add_clock_is_low_rising_edge_resolver(handler_t fp) {
    clock_is_low_resolvers[n_clock_is_low_resolvers] = fp;
    n_clock_is_low_resolvers++;
}

int simulate(void) { // return exit code, 0 for success or 2 for error

    /* working test code
    printf("setnet(0, UNDEF)\n");
    setnet(0, UNDEF);
    printf("setnet(3, 1)\n");
    setnet(3, 1);
    printf("getnet(0) returns 0x%llX\n", getnet(0));
    printf("getnet(3) returns 0x%llX\n", getnet(3));
    printf("TspWires[0] is 0x%llX\n", TspNets[0]);

    printf("setbus(4, 4, 0xA)\n");
    setbus(4, 4, 0xA);
    printf("getbus(4, 4) returns 0x%llx\n", getbus(4, 4));
    printf("TspWires[0] is 0x%llX\n", TspNets[0]);
    */

    TspNets[0] = 0;
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

