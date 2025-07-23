/* Copyright (c) Jeff Berkowitz 2024. All rights reserved. */
/* 456789012345678901234567890123456789012345678901234567890123456789012
 *      10        20        30        40        50        60        70 
 */

#include "compile_options.h"

#ifdef ENABLE_TRACING
#include <errno.h>
#include <stdio.h>
#include <string.h>

#include "sim.h"

extern void init_tracing(void);
extern void write_trace(void);

static FILE* trace_file;

static int write_header(void) {
    union {
        uint8_t bytes[8];
        uint32_t ints[2];
    } header;

    FILE* net_list_file = fopen(NET_LIST_FILE_NAME, "r");
    if (net_list_file == NULL) {
        msg("open netlist file failed: %s\n", strerror(errno));
        return 0;
    }

    header.bytes[0] = 0x83;
    header.bytes[1] = 0x82;
    header.bytes[2] = 0x81;
    header.bytes[3] = 0x80;

    fclose(net_list_file);
    return 1;
}

void init_tracing(void) {
    errno = 0;
    trace_file = fopen(TRACE_FILE_NAME, "w");
    if (trace_file == NULL) {
        msg("open trace file failed: %s\n", strerror(errno));
        return;
    }
    if (!write_header()) {
        fclose(trace_file);
        return;
    }
}

void write_trace(void) {
    if (trace_file) {
        msg("tracing");
    }
}

#endif // ENABLE_TRACING
