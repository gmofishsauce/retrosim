/* Copyright (c) Jeff Berkowitz 2024. All rights reserved. */

#ifndef UTIL_H
#define UTIL_H

/* 456789012345678901234567890123456789012345678901234567890123456789012
 *      10        20        30        40        50        60        70 
 */

typedef enum {NONE, MIN, MED, MAX} debug_level;

extern void set_quiet(bool state);
extern void set_debug(debug_level level);
extern bool is_debug(debug_level level);
extern bool msg(const char* fmt, ...);
extern void fatal(const char* fmt, ...);

#define DEBUG // Comment out this line to eliminate code
#define DB(L, F, ...) (is_debug(L) && msg(F, __VA_ARGS__))

#endif // UTIL_H
