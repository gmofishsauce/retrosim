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
#define MAX_BIND 8      // Maximum number of input bindings per component

#if MACHINE_SIZE == 32
#define BITS uint32_t
#elif MACHINE_SIZE == 64
#define BITS uint64_t
#else
#error machine size must be 32 or 64
#endif

typedef uint16_t INDEX;

typedef INDEX S_IDX;    // index of a state_t
typedef INDEX B_IDX;    // index of a bind_t
typedef INDEX P_IDX;    // index of a part_t

typedef struct state {
    P_IDX part;
    BITS values;
    BITS undefs;
    BITS highzs;
} state_t;

typedef struct bind {
    S_IDX from;         // state being bound to
    INDEX offset;       // offset of binding bit 0 in state
    INDEX n_bits;       // contiguous bits
    INDEX spare;        // reserved
} bind_t;


typedef void (*func_t)(void);

typedef struct part {
    char *name;
    func_t eval;
    func_t edge;
    B_IDX inputs[MAX_BIND];
    S_IDX future;     // Combinational parts don't use
    S_IDX output;     // Sequential parts: edge() sets from future
#if MACHINE_SIZE == 64
    uint32_t spare;   // alignment
#endif
} part_t;

extern state_t state_pool[MAX_STATE];
extern bind_t bind_pool[MAX_BIND];
extern part_t part_pool[MAX_PART];

P_IDX make_part(char *name, func_t eval, func_t edge);
B_IDX bind(S_IDX from, P_IDX to, INDEX offset, INDEX n_bits);
