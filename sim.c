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

#include <unistd.h>
#include "sim.h"

int main(int ac, char** av) {
    
    int c;
    while ((c = getopt(ac, av, "q")) != -1) {
        switch (c) {
        case 'q':
            set_quiet(true);
            break;
        default:
            fatal("internal error: getopt");
        }
    }
    if (optind < ac) {
        fatal("unexpected option: %s", av[optind]);
    }

    msg("%s: firing up...\n", av[0]);
    msg("%s: done.\n", av[0]);
}
