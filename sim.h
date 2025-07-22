/* Copyright (c) Jeff Berkowitz 2024. All rights reserved. */

#ifndef SIM_H
#define SIM_H

/* 456789012345678901234567890123456789012345678901234567890123456789012
 *      10        20        30        40        50        60        70 
 */

/* Only include system includes that are simple, generic, and don't
 * pollute the namespace too much. Include others directly in the .c
 * files that use them.
 */
#include <stdint.h>
#include <stdbool.h>

#include "util.h"

extern char* g_progname;

#endif // SIM_H
