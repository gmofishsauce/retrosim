/* Copyright (c) Jeff Berkowitz 2024. All rights reserved. */

/* 456789012345678901234567890123456789012345678901234567890123456789012
 *      10        20        30        40        50        60        70 
 */
#include <stdio.h>
#include <stdlib.h>
#include <stdarg.h>

#include "sim.h"
#define NO_RETURN __attribute__((noreturn))

static bool quiet = false;
static debug_level debug = NONE;

void set_quiet(bool state) {
    quiet = state;
}

void set_debug(debug_level state) {
    debug = state;
}

bool is_debug(debug_level level) {
#if defined(DEBUG)
    return level != NONE && level <= debug;
#else
    return (false);
#endif
}

bool msg(const char* fmt, ...) {
    if (!quiet) {
        va_list args;
        va_start(args, fmt);
        fputs(g_progname, stderr);
        fputs(": ", stderr);
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wformat-nonliteral"
        (void) vfprintf(stderr, fmt, args);
#pragma clang diagnostic pop
        va_end(args);
        fputs("\n", stderr);
    }
    return true;
}

void NO_RETURN fatal(const char* fmt, ...) {
    va_list args;
    va_start(args, fmt);
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wformat-nonliteral"
    (void) vfprintf(stderr, fmt, args);
#pragma clang diagnostic pop
    va_end(args);
    fputc('\n', stderr);
    exit(1);
}
