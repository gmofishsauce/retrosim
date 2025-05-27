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

int simulate(void);

int main(int ac, char** av) {
    int c;
    while ((c = getopt(ac, av, "qd:")) != -1) {
        switch (c) {
        case 'q':
            set_quiet(true);
            break;
        case 'd':
            set_debug((unsigned int)atoi(optarg));
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

bitvec16_t bv16_ones = { BV16_ALL, BV16_NONE, BV16_NONE, 0};
bitvec16_t bv16_zeroes = { BV16_NONE, BV16_NONE, BV16_NONE, 0};
bitvec16_t bv16_undef = { BV16_NONE, BV16_ALL, BV16_NONE, 0};
bitvec16_t bv16_highz = { BV16_NONE, BV16_NONE, BV16_ALL, 0};

bitvec64_t bv64_ones = { BV64_ALL, BV64_NONE, BV64_NONE, 0};
bitvec64_t bv64_zeroes = { BV64_NONE, BV64_NONE, BV64_NONE, 0};
bitvec64_t bv64_undef = { BV64_NONE, BV64_ALL, BV64_NONE, 0};
bitvec64_t bv64_highz = { BV64_NONE, BV64_NONE, BV64_ALL, 0};

int simulate(void) { // return exit code, 0 for success or 2 for error
    return 0;
}

