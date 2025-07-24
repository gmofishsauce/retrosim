/* Copyright (c) Jeff Berkowitz 2024. All rights reserved. */
/* 456789012345678901234567890123456789012345678901234567890123456789012
 *      10        20        30        40        50        60        70 
 */

extern void initialize_tracing(void);
extern void write_trace(void);
extern void close_trace(void);

typedef union {
    uint8_t bytes[8];
    int32_t ints[2];
    uint64_t all;
} header_t;

