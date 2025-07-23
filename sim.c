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

// TODO the transpiler needs to generate a "compile_options.h"
#include "compile_options.h"

#include "api.h"
#include "sim.h"

char* g_progname;

static int simulate(void);

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
    g_progname = av[0];
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

    msg("firing up...");
    DB(MIN, "%s", "Debug MIN enabled");
    DB(MED, "%s", "Debug MED enabled");
    DB(MAX, "%s", "Debug MAX enabled");
    int exitCode = simulate();
    msg("exit %d", exitCode);
    return exitCode;
}

// These add_ functions implement the API for adding functional
// code (component implementations) to the simulator.

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

static inline void execute(handler_t* resolvers) {
    for (int i = 0; resolvers[i] != 0; i++) {
        (*resolvers[i])();
    }
    WRITE_TRACE(); // disappears unless #defined.
}

int simulate(void) { // return exit code, 0 for success or 2 for error
    init();
    INIT_TRACING();

    for (g_cycle = 1; is_running(); g_cycle++) {
        execute(rising_edge_hooks);
        execute(clock_is_high_hooks);
        execute(falling_edge_hooks);
        execute(clock_is_low_hooks);
    }

    msg("terminating normally after %d cycle%s", g_cycle-1, (g_cycle-1 == 1) ? "" : "s");
    return 0;
}

