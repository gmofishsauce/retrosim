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

// TODO visibility of declarations needs yet more thought ...
extern void init_tracing(void);
extern void write_trace(void);
extern void close_trace(void);
extern uint64_t TspNets[];

static FILE* trace_file;

typedef union {
    uint8_t bytes[8];
    int32_t ints[2];
    uint64_t all;
} header_t;

// Write the header to the trace file. The trace file is open.
static int write_header(void) {
    header_t header;
    header.all = 0ULL;

    // Write the netlist file after the header at offset 8, pad it out to an
    // 8-byte boundary with newlines, seek to 0 and write the header with the
    // netlist size. Then seek to the end of the netlist and begin tracing.
    // The eventual consumer must accept the blank lines we (may) add at the
    // end of the netlist.

    errno = 0;
    FILE* net_list_file = fopen(NET_LIST_FILE_NAME, "r");
    if (net_list_file == NULL) {
        msg("open netlist file failed: %s\n", strerror(errno));
        return 0;
    }
    fseek(trace_file, (long)sizeof(header), SEEK_SET);

    int trace_start = 0;
    for (int b = fgetc(net_list_file); b != -1; b = fgetc(net_list_file), trace_start++) {
        fputc(b, trace_file);
    }
    fclose(net_list_file);
    int round_up = sizeof(unsigned long long) - (trace_start&0x7);
    trace_start += round_up;
    for (; round_up > 0; --round_up) {
        fputc('\n', trace_file);
    }
    long start_of_trace = ftell(trace_file);
    fseek(trace_file, 0, SEEK_SET);

    header.bytes[0] = 0x83;
    header.bytes[1] = 0x82;
    header.bytes[2] = 0x81;
    header.bytes[3] = 0x80;
    header.ints[1] = trace_start;
    errno = 0;
    if (fwrite(&header, sizeof(header), 1, trace_file) != 1) {
        msg("write_trace: write failed (%s)\n", strerror(errno));
        return 0;
    }

    fseek(trace_file, start_of_trace, SEEK_SET);
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
        trace_file = NULL;
        return;
    }
}

// TODO The transpiler needs to generate these
#define TARGET_WORD_TYPE uint64_t
#define NETS_SIZE 1

void write_trace(void) {
    errno = 0;
    if (trace_file && fwrite(&TspNets, sizeof(TARGET_WORD_TYPE), NETS_SIZE, trace_file) != NETS_SIZE) {
        msg("write_trace: write failed (%s): tracing suspended", strerror(errno));
        fclose(trace_file);
        trace_file = NULL;
    }
}

void close_trace(void) {
    if (trace_file) {
        fclose(trace_file);
    }
}

#endif // ENABLE_TRACING
