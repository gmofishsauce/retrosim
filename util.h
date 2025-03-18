/* Copyright (c) Jeff Berkowitz 2024. All rights reserved. */

/* 456789012345678901234567890123456789012345678901234567890123456789012
 *      10        20        30        40        50        60        70 
 */

typedef enum {NONE, MIN, MED, MAX} debug_level;

extern void set_quiet(bool state);
extern void set_debug(debug_level level);
extern bool is_debug(debug_level level);
extern bool msg(const char* fmt, ...);
extern void fatal(const char* fmt, ...);

#define DB(L, F, ...) (is_debug(L) && msg(F, __VA_ARGS__))

/* Uncomment the following to hopefully remove all debug as dead code
 * at high levels of optimization. Implementation in util.c. The idea
 * is that is_debug() becomes constant false, so a good optimizer can
 * eliminate the evaluation of the arguments to msg().
 *
#define NO_DEBUG 1
 */
