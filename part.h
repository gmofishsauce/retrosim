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

#define MAX_WIDTH 16    // Maximum number of bits a part can have
#define MAX_STATE 128   // Maximum number of state representations
#define MAX_PART 64     // Maximum number of parts
#define N_BIND   11     // Maximum input bindings in a part (see below)
#define MAX_BIND 256    // Maximum number of input bindings

/* about N_BIND: it pads out the part_t to exactly 64 bytes. Getting it
 * down to 32 bytes would be hard.
 */

#define BITS uint16_t
#define ALL_BITS ((uint16_t)0xFFFF)
#define NO_BITS  ((uint16_t)0)

typedef uint16_t INDEX;
typedef INDEX B_IDX;    // index of a bind_t
typedef INDEX P_IDX;    // index of a part_t
typedef void (*func_t)(P_IDX this);

typedef struct state {  // state of a part. 64 bits.
    BITS values;
    BITS undefs;
    BITS highzs;
    BITS spare;
} state_t;

extern state_t all_undef;
extern state_t all_highz;
extern state_t all_ones;
extern state_t all_zeroes;

typedef struct bind {   // bind some outputs to some inputs. 64 bits.
    P_IDX from;         // binding to the output of this part
    INDEX offset;       // offset of binding bit 0 in state
    INDEX n_bits;       // contiguous bits
    INDEX spare;        // reserved
} bind_t;

typedef struct part {     // A component. 64 bytes.
    char *name;
    func_t eval;
    func_t edge;
    state_t future;       // Combinational parts don't use this
    state_t output;       // Sequential parts: edge() sets from future
    INDEX next_bind;      // Next slot in inputs
    INDEX inputs[N_BIND]; // Max of N_BIND input binds.
} part_t;

extern bind_t binds[MAX_BIND];
extern part_t parts[MAX_PART];

P_IDX make_part(char *name, func_t eval, func_t edge);
void bind(P_IDX from, P_IDX to, INDEX offset, INDEX n_bits);
