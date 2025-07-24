/* Copyright (c) Jeff Berkowitz 2024. All rights reserved. */
/* 456789012345678901234567890123456789012345678901234567890123456789012
 *      10        20        30        40        50        60        70 
 */

#include <errno.h>
#include <stdio.h>
#include <string.h>

#include "sim.h"
#include "api.h"
#include "trace.h"

static FILE* trace_file;

// These values are used to write the data. They must be initialized
// from transpiler-generated code.
static void *nets;
static size_t nets_element_size;
static unsigned long nets_element_count;

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
    FILE* net_list_file = fopen(get_net_list_file_name(), "r");
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

void initialize_tracing(void) {
    nets = get_nets();
    nets_element_size = (size_t)get_nets_element_size();
    nets_element_count = get_nets_element_count();

    errno = 0;
    trace_file = fopen(get_trace_file_name(), "w");
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

void write_trace(void) {
    errno = 0;
    if (trace_file && fwrite(nets, nets_element_count, nets_element_size, trace_file) != nets_element_size) {
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
