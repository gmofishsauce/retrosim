/* Copyright (c) Jeff Berkowitz 2024. All rights reserved. */

#ifndef TYPES_H
#define TYPES_H

/* 456789012345678901234567890123456789012345678901234567890123456789012
 *      10        20        30        40        50        60        70 
 *
 * Four-state digital simulator: bits may be 0, 1, Undefined, or high-Z.
 * Undefs propagate and highz inputs become undefined outputs.
 *
 * There are two representations for simulated state: bitvecs and
 * bitbytes. In a bitvec, the four states are represented by bitmasks
 * similar to bitboards in chess. There are three bit vectors: values,
 * undefs, and highzs ("high-z's", pronounced "HIzees"). Bitvecs are
 * intended for use in datapath components where input and output
 * bindings are simple (a 16-bit register takes its input from the
 * 16-bit output of an ALU) and values are often computed results.
 * The three 16-bit fields leave 16 bits for an owner index in each
 * aligned 64-bit structure.
 *
 * Bitbytes represent individual 4-state bits in a byte of storage.
 * They are intended for use in control paths where input and output
 * bindings are complex and functionality is simple, e.g. gates and
 * controls. They are packaged in groups of 6 (48 bits) leaving two
 * bytes for an owner index in each aligned 64-bit structure. 
 *
 * Bit*_t's (bitvec_t's or bitbyte_t's) are used for both static and
 * dynamic storage, i.e. they may be either component outputs or wires.
 * The owner field of a bit*_t  type indexes a binding structure. This
 * is a bidirectional relationship that connects a sequential set of
 * bits (also called pins) on source and destination bit*_t's. Bindings
 * are also aligned, 64-bit structures.
 *
 * The owner field of a binding_t is an element (elem_t). Elements are
 * either wires (wire_t) or parts (part_t). 
 */

typedef uint16_t index_t;
typedef void (*func_t)(index_t part);

typedef uint16_t bits_t; // "bits", plural

typedef struct bitvec {
    index_t owner;
    bits_t values;
    bits_t undefs;
    bits_t highzs;
} bitvec_t;

extern bitvec_t all_undef;
extern bitvec_t all_highz;
extern bitvec_t all_ones;
extern bitvec_t all_zeroes;

#define ALL_BITS ((bits_t)0xFFFF)
#define NO_BITS  ((bits_t)0)

typedef uint8_t bit_t; // "bit", singular

#define BB_0    ((bit_t)0)   // bit is 0
#define BB_1    ((bit_t)1)   // bit is 1
#define BB_Z    ((bit_t)2)   // bit is Z
#define BB_U    ((bit_t)3)   // bit is U

typedef struct bitbyte {
    index_t owner;
    bit_t bits[6];
} bitbyte_t;

typedef struct binding {
    index_t source; // index of bit*_t
    index_t dest;   // index of bit*_t
    uint8_t src_pin;
    uint8_t dst_pin;
    uint8_t num_pin;
    uint8_t spare;
} binding_t;

#endif // TYPES_H
