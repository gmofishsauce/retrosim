/* Copyright (c) Jeff Berkowitz 2024. All rights reserved. */
/* 456789012345678901234567890123456789012345678901234567890123456789012
 *      10        20        30        40        50        60        70 
 *
 * Build: cc -o wv wv.c
 *
 * Translate a binary trace file written by sim to VCD format. Accepts
 * binary data on standard input to avoid complexities of knowing file
 * name. Write textual VCD file on stdout.
 */

#include <stdint.h>
#include <stdio.h>
#include <errno.h>
#include <string.h>
#include <stdlib.h>

#include "../trace.h"

static char* g_progname;
static int num_signals;

typedef struct signal {
    char* name;
    int pos;
    int size;
} signal_t;

// Read the signal definitions from the trace file into some allocated storage.
// The signal list follows the header.
static signal_t* get_signals(FILE* input) {
    header_t header;
    
    errno = 0;
    if (fread(&header, sizeof(header), 1, input) != 1) {
        fprintf(stderr, "%s: failed to read header (%s)\n", g_progname, strerror(errno));
        return NULL;
    }
    if (header.magic.w != 0x80818283) {
        fprintf(stderr, "%s: bad magic number\n", g_progname);
        return NULL;
    }
    uint32_t netlist_size = header.netlist_size;
    char* netlist = malloc(netlist_size);
    if (netlist == NULL) {
        fprintf(stderr, "%s: malloc failed\n", g_progname);
        return NULL;
    }
    errno = 0;
    if (fread(netlist, netlist_size, 1, input) != 1) {
        fprintf(stderr, "%s: failed to read netlist (%s)\n", g_progname, strerror(errno));
        return NULL;
    }
    // The netlist section is supposed to be terminated with 1 to 9 NULs.
    // But let's just make sure.
    netlist[netlist_size-1] = '\0';

    // Size an array of signal_t's, allocate it, and then fill it.
    // XXX - num_signals is global so the caller can get at it, ick.
    num_signals = 0;
    for (char* cp = netlist; *cp != '\0'; cp++) {
        if (*cp == '\n') {
            num_signals++;
        }
    }
    signal_t *signals = (signal_t*)calloc((size_t)num_signals, (size_t)sizeof(signal_t));
    if (signals == NULL) {
        fprintf(stderr, "%s: calloc failed\n", g_progname);
        return NULL;
    }

    signal_t *sp = signals;
    for (char *cp = netlist; *cp != '\0'; cp++, sp++) {
        if ((sp - signals) >= num_signals) {
            // The last newline in the file is not immediately
            // followed by a nul char.
            fprintf(stderr, "%s: bad signal list format\n", g_progname);
            return NULL;
        }
        sp->name = cp;
        while (*cp != ',' && *cp != '\0') {
            cp++;
        }
        if (*cp == '\0') {
            fprintf(stderr, "%s: incomplete line\n", g_progname);
            return NULL;
        }
        *cp++ = '\0'; // replace first comma in line with a nul

        if (sscanf(cp, "%d,%d\n", &sp->pos, &sp->size) != 2) {
            fprintf(stderr, "%s: failed to read numeric values in signals list\n", g_progname);
            return NULL;
        }

        // We know the newline is present because the sscanf() matched it.
        while (*cp != '\n') {
            cp++;
        }
    }

    return signals;
}

int main(int ac, char** av) {
    g_progname = av[0];
    if (ac != 2) {
        fprintf(stderr, "%s: usage: %s tracefile\n", g_progname, g_progname);
        exit(1);
    }

    errno = 0;
    FILE* trace_file = fopen(av[1], "r");
    if (trace_file == NULL) {
        fprintf(stderr, "%s: open \"%s\" failed: %s\n", g_progname, av[1], strerror(errno));
        exit(1);
    }

    signal_t *signals = get_signals(trace_file);
    for (signal_t *sp = signals; sp < &signals[num_signals]; ++sp) {
        printf("%s: %d %d\n", sp->name, sp->pos, sp->size);
    }
}

