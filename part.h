/* Copyright (c) Jeff Berkowitz 2024. All rights reserved. */

/* 456789012345678901234567890123456789012345678901234567890123456789012
 *      10        20        30        40        50        60        70 
 *
 * Four-state digital simulator. The four states are represented by
 * bitmasks similar to bitboards in chess. There are three bit vectors:
 * values, undefs, and highzs ("high-z's", pronounced "hizees"). Undefs
 * propagate and highz inputs become undefined outputs.
 *
 * The "physical" bit width of every simulated "part" is equal to the
 * width of a machine word on the computer running the simulator,
 * MACHINE_SIZE. In practice this is 32 or 64. The actual width, which
 * is less than or equal to the MACHINE_SIZE, is stored in the part.
 *
 * Parts have outputs in the form of state_t objects. The output of a
 * part is set when its eval() function is called or when its edge()
 * function is called. The decision is up to the part's implementation.
 * Sequential parts are created by having two state_t objects, one
 * holding the current output of the part, the other computed by eval()
 * with the next output that is transfered by edge().
 *
 * Parts have inputs in the form of bindings. Each binding specifies a
 * contiguous block of 1 to MACHINE_SIZE outputs of some other part.
 * Conceptually, calling eval() on a part causes it to evaluate its
 * inputs, which evaluate their inputs, and so on back to a sequential
 * part - even if that "part" is something like the default all-Z value
 * of an undriven bus. In reality, the code performs a topological sort
 * and finds a single evaluation order for all the parts.
 *
 * This is intended to become a data-oriented design. The computation
 * relies (or will rely) entirely on states and bindings. These are
 * allocated, only before simulation startup, from dense arrays which
 * will hopefully give good L1 cache locality.
 */

#define MAX_WIDTH 32    // Maximum number of bits a part can have
#define MACHINE_SIZE 64 // The actual number of bits (for alignment).
#define MAX_STATE 128   // Maximum number of state representations
#define MAX_PART 64     // Maximum number of parts
#define N_BIND   8      // Maximum input bindings in a part
#define MAX_BIND 256    // Maximum number of input bindings

#if MACHINE_SIZE == 32
#define BITS uint32_t
#define ALL_BITS ((uint32_t)0xFFFFFFFF)
#define NO_BITS  ((uint32_t)0)
#elif MACHINE_SIZE == 64
#define BITS uint64_t
#define ALL_BITS ((uint64_t)0xFFFFFFFFFFFFFFFF)
#define NO_BITS  ((uint64_t)0)
#else
#error machine size must be 32 or 64
#endif

typedef uint16_t INDEX;

typedef INDEX S_IDX;    // index of a state_t
typedef INDEX B_IDX;    // index of a bind_t
typedef INDEX P_IDX;    // index of a part_t
typedef void (*func_t)(void);

typedef struct state {
    BITS values;
    BITS undefs;
    BITS highzs;
    P_IDX part;
#if MACHINE_SIZE == 64
    uint8_t pad[6]; // alignment
#else
    uint8_t pad[2]; // alignment
#endif
} state_t;

typedef struct bind {
    S_IDX from;         // state being bound to
    INDEX offset;       // offset of binding bit 0 in state
    INDEX n_bits;       // contiguous bits
    INDEX spare;        // reserved
} bind_t;

typedef struct part {
    char *name;
    func_t eval;
    func_t edge;
    INDEX inputs[N_BIND]; // Max of N_BIND input binds.
    INDEX next_bind;      // Next slot in inputs
    S_IDX future;         // Combinational parts don't use this
    S_IDX output;         // Sequential parts: edge() sets from future
#if MACHINE_SIZE == 64
    uint16_t spare;       // alignment
#endif
} part_t;

extern state_t states[MAX_STATE];
extern bind_t binds[MAX_BIND];
extern part_t parts[MAX_PART];

P_IDX make_seq(char *name, func_t eval, func_t edge);
P_IDX make_comb(char *name, func_t eval, func_t edge);
S_IDX make_state(P_IDX part);
void bind(S_IDX from, P_IDX to, INDEX offset, INDEX n_bits);

