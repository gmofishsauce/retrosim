/* Copyright (c) Jeff Berkowitz 2024. All rights reserved. */

/* 456789012345678901234567890123456789012345678901234567890123456789012
 *      10        20        30        40        50        60        70 
 */
#include <stdio.h>
#include <stdlib.h>
#include <stdarg.h>

#include "sim.h"
#define NO_RETURN __attribute__((noreturn))

static bool quiet;

void set_quiet(bool state) {
    quiet = state;
}

void msg(const char* fmt, ...) {
    if (!quiet) {
        va_list args;
        va_start(args, fmt);
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wformat-nonliteral"
        (void) vfprintf(stderr, fmt, args);
#pragma clang diagnostic pop
        va_end(args);
    }
}

void NO_RETURN fatal(const char* fmt, ...) {
    va_list args;
    va_start(args, fmt);
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wformat-nonliteral"
    (void) vfprintf(stderr, fmt, args);
#pragma clang diagnostic pop
    va_end(args);
    exit(1);
}
