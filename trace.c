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
static uint32_t nets_element_size;
static uint32_t nets_element_count;

// Write the header to the trace file. The trace file is open and remains so.
static int write_header(void) {

    // Copy the netlist file after the header, NUL terminate it, pad it out to an
    // 8-byte boundary with NUL chars, seek to 0 and write the header with the netlist
    // size. Seek to the end of the netlist and leave the file open to begin tracing.

    errno = 0;
    FILE* net_list_file = fopen(get_net_list_file_name(), "r");
    if (net_list_file == NULL) {
        msg("open netlist file failed: %s\n", strerror(errno));
        return 0;
    }

    uint32_t netlist_size = 0;
    fseek(trace_file, (long)sizeof(header_t), SEEK_SET);
    for (int b = fgetc(net_list_file); b != -1; b = fgetc(net_list_file), netlist_size++) {
        fputc(b, trace_file);
    }
    fclose(net_list_file);

    // Careful here: put a NUL char, -then- round up to 8-byte boundary with more NULs.
    fputc('\0', trace_file);
    netlist_size++;

    uint32_t round_up = sizeof(unsigned long long) - (netlist_size&0x7);
    netlist_size += round_up;
    for (; round_up > 0; --round_up) {
        fputc('\0', trace_file);
    }
    long start_of_trace = ftell(trace_file);
    if (start_of_trace != sizeof(header_t) + netlist_size) {
        msg("internal error: positioning trace writer: %ld %ld %ld\n",
            start_of_trace, sizeof(header_t), netlist_size);
        return 0;
    }

    fseek(trace_file, 0, SEEK_SET);
    header_t header;
    header.magic.b[0] = 0x83;
    header.magic.b[1] = 0x82;
    header.magic.b[2] = 0x81;
    header.magic.b[3] = 0x80;
    header.netlist_size = netlist_size;
    header.element_size = nets_element_size;
    header.element_count = nets_element_count;
    memset(header.reserved, 0, sizeof(header.reserved));

    errno = 0;
    if (fwrite(&header, sizeof(header_t), 1, trace_file) != 1) {
        msg("write_trace: write failed (%s)\n", strerror(errno));
        return 0;
    }

    // Position the trace file for writing and leave it open.
    fseek(trace_file, start_of_trace, SEEK_SET);
    return 1;
}

// Initialize the trace file. If error, leave trace_file null
// which safely disables the other tracing calls.
void initialize_tracing(void) {
    nets = get_nets();
    nets_element_size = get_nets_element_size();
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
    // fread() and fwrite() declare the -count- of elements as a size_t.
    // This is wrong, because a count is not a size, but we're stuck with it.
    if (trace_file && fwrite(nets, nets_element_size, (size_t)nets_element_count, trace_file) != (size_t)nets_element_count) {
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
