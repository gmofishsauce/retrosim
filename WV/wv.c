/* Copyright (c) Jeff Berkowitz 2024. All rights reserved. */
/* 456789012345678901234567890123456789012345678901234567890123456789012
 *      10        20        30        40        50        60        70 
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

char* g_progname;

int main(int ac, char** av) {
    g_progname = av[0];
    header_t header;
    
    errno = 0;
    if (fread(&header, sizeof(header), 1, stdin) != 1) {
        fprintf(stderr, "%s: failed to read header (%s)\n", g_progname, strerror(errno));
        exit(2);
    }
    if (header.ints[0] != 0x80818283) {
        fprintf(stderr, "%s: bad magic number\nn", g_progname);
        exit(2);
    }
    int netlist_size = header.ints[1];
    char* netlist = malloc(netlist_size);
    errno = 0;
    if (fread(netlist, netlist_size, 1, stdin) != 1) {
        fprintf(stderr, "%s: failed to read netlist (%s)\n", g_progname, strerror(errno));
        exit(2);
    }
    netlist[netlist_size-1] = '\0';
    printf("NETLIST: %s\n", netlist);
}
