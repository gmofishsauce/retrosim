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
typedef void (*handler_t)(void);
static handler_t rising_edge_resolvers[MAX_RESOLVERS];
static handler_t clock_is_high_resolvers[MAX_RESOLVERS];
static handler_t falling_edge_resolvers[MAX_RESOLVERS];
static handler_t clock_is_low_resolvers[MAX_RESOLVERS];

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

public uint16_t TspGetClk(void) {
    return clock;
}

public uint16_t TspGetPor(void) {
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

#ifdef FIRST_ATTEMPT

// TODO how about some kind of registration scheme where
// components (really resolvers) would register themselves
// for each/any of the four events? Better, each resolver
// could provide a value that would cause registrations.
// TODO for now, just do it:
// static handler_t rising_edge_resolvers[MAX_RESOLVERS];
// static handler_t clock_is_high_resolvers[MAX_RESOLVERS];
// static handler_t falling_edge_resolvers[MAX_RESOLVERS];
// static handler_t clock_is_low_resolvers[MAX_RESOLVERS];

// TODO tension between per-net resolvers and per-component
// resolvers. The former probably required for combinational
// logic, the latter better for clocked devices.

// void N8_U2_3_resolver(void) {}
// void N9_U2_6_resolver(void) {}
// void N10_U2_8_resolver(void) {}
// void N11_U2_11_resolver(void) {}
// void N12_U1_10_Q2_resolver(void) {}
// void N13_U1_15_Q3_resolver(void) {}
// void N14_U1_6_NOT_Q1_resolver(void) {}
// void N17_NOT_POR_resolver(void) {}
// void B1_resolver(void) {}

static void U1_rising_edge(void);
static void N8_U2_3_clock_is_high(void);
static void N9_U2_6_clock_is_high(void);
static void N10_U2_8_clock_is_high(void);
static void N11_U2_11_clock_is_high(void);

// TODO it's hard to figure out the inputs
// of any part, because the nets are all
// named by outputs ("drivers")
// TODO need macros that are generalizations
// of this expression from TspGen.h:
// (wires.values |= (((b)&0x1)<<0))
// TODO so it seems stateful components don't
// really need internal state. They can just
// set their output nets on the rising edge.
// TODO would it be possible for tsp to write
// macros like PIN(N, VAL) that would allow
// setting the Nth pin of a component to a
// value?
static void U1_rising_edge(void) {
    if (GetPOR()) {
        
        Set_N12_U1_10_Q2(b)
        Set_N14_U1_6_NOT_Q1(b)
    } else {
    }
    if (!GetPOR()) {
        state.values |= Get_N8_U2_3() << 0;
        state.values |= Get_N9_U2_6() << 1;
        state.values |= Get_N10_U2_8() << 2;
        state.values |= Get_N11_U2_11() << 3:
        state.highzs |= IsZ_N8_U2_3() << 0;
        state.highzs |= IsZ_N9_U2_6() << 1;
        state.highzs |= IsZ_N10_U2_8() << 2;
        state.highzs |= IsZ_N11_U2_11() << 3;
        state.undefs |= IsU_N8_U2_3() << 0;
        state.undefs |= IsU_N9_U2_6() << 1;
        state.undefs |= IsU_N10_U2_8() << 2;
        state.undefs |= IsU_N11_U2_11() << 3;
    }
}

static void N8_U2_3_clock_is_high(void) {
    
}

static void N9_U2_6_clock_is_high(void) {
}

static void N10_U2_8_clock_is_high(void) {
}

static void N11_U2_11_clock_is_high(void) {
}

void register_resolvers(void);
void register_resolvers(void) {
    rising_edge_resolvers[0] = &U1_rising_edge;
    clock_is_high_resolvers[0] = &N8_U2_3_clock_is_high;
    clock_is_high_resolvers[1] = &N9_U2_6_clock_is_high;
    clock_is_high_resolvers[2] = &N10_U2_8_clock_is_high;
    clock_is_high_resolvers[3] = &N11_U2_11_clock_is_high;
}

#endif

#include <stdio.h>

int simulate(void) { // return exit code, 0 for success or 2 for error

    SETBITS(0,  4, 0xF);
    SETBITS(4,  4, 0xE);
    SETBITS(8,  4, 0xE);
    SETBITS(12, 4, 0xB);
    SETBITS(16, 4, 0xD);
    SETBITS(20, 4, 0xA);
    SETBITS(24, 4, 0xE);
    SETBITS(28, 4, 0xD);

    uint64_t b = GETBITS(0, 32);
    printf("GETBITS returns 0x%llX\n", b);
    printf("TspWires[0] is 0x%llX\n", TspWires[0]);

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

