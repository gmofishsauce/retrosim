/* Copyright (c) Jeff Berkowitz 2024. All rights reserved. */

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
 *
 * Bitbytes represent individual 4-state bits in a byte of storage. They
 * are intended for use in control paths where input and output bindings
 * are complex and functionality is simple, e.g. gates and controls.
 *
 * This is intended as a data-oriented design. Most of the simulation
 * model is stored in memory-aligned data structures that are
 * allocated from fixed sized pools (arrays) and referenced by small
 * indices (uint16_t's) rather than pointers.
 */

#define MAX_PART 64         // Maximum number of parts
#define MAX_BITVEC 128      // Maximum number of bitvecs
#define MAX_BITBYTES 256    // Maximum number of bitbytes
#define MAX_BIND 512        // Maximum number of input bindings

typedef uint8_t byte_t;
typedef uint16_t index_t;
typedef void (*func_t)(index_t part);

#define bits_t uint16_t
#define ALL_BITS ((uint16_t)0xFFFF)
#define NO_BITS  ((uint16_t)0)

/* Bit vector type */

typedef struct bitvec {
    bits_t values;
    bits_t undefs;
    bits_t highzs;
    bits_t spare;
} bitvec_t;

extern bitvec_t all_undef;
extern bitvec_t all_highz;
extern bitvec_t all_ones;
extern bitvec_t all_zeroes;

/* Bit byte type */

typedef uint16_t bitbyte_t;

#define BB_0    0   // bit is 0
#define BB_1    1   // bit is 1
#define BB_Z    2   // bit is Z
#define BB_U    3   // bit is U

typedef struct part {     // A component. 64 bytes.
    char *name;
    func_t eval;
    func_t edge;
    state_t future;       // Combinational parts don't use this
    state_t output;       // Sequential parts: edge() sets from future
    INDEX next_bind;      // Next slot in inputs
    INDEX inputs[N_BIND]; // Max of N_BIND input binds.
} part_t;

extern part_t parts[MAX_PART];

P_IDX make_part(char *name, func_t eval, func_t edge);
void bind(P_IDX from, P_IDX to, BYTE offset, BYTE n_bits);
