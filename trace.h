/* Copyright (c) Jeff Berkowitz 2024. All rights reserved. */
/* 456789012345678901234567890123456789012345678901234567890123456789012
 *      10        20        30        40        50        60        70 
 */

extern void initialize_tracing(void);
extern void write_trace(void);
extern void close_trace(void);

typedef union {
    uint8_t b[4];
    uint32_t w;
} magic_t;

typedef struct {
    magic_t  magic;
    uint32_t netlist_size;
    uint32_t element_size;
    uint32_t element_count;
    uint32_t reserved[4];
} header_t;

