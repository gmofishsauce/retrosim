#include <unistd.h>
#include <stdlib.h>
#include <stdio.h>

typedef uint16_t index_t;
typedef uint16_t bits_t; // "bits", plural

typedef struct bitvec {
    index_t owner;
    bits_t values;
    bits_t undefs;
    bits_t highzs;
} bitvec_t;

extern bitvec_t all_ones;
extern bitvec_t all_zeroes;

#define ALL_BITS ((bits_t)0xFFFF)
#define NO_BITS  ((bits_t)0)

typedef struct binding {
    index_t source; // index of bit*_t
    index_t dest;   // index of bit*_t
    uint8_t src_pin;
    uint8_t dst_pin;
    uint8_t num_pin;
    uint8_t spare;
} binding_t;

struct elem;
typedef void (*resolver_t)(struct elem el);

typedef struct elem {
    char* name;          // wire or part net name
    resolver_t resolver;
    index_t bindings;    // index of input first binding
    uint8_t num_bind;    // number of input bindings
    uint8_t pad[5];      // to 64-bit boundary
} elem_t;

/*
bitvec_t all_ones   = {0, ALL_BITS, NO_BITS, NO_BITS };
bitvec_t all_zeroes = {0,  NO_BITS, NO_BITS, NO_BITS };
*/

/*
void print_sizes(void) {
    printf("sizeof(bitvec_t) = %lu", sizeof(bitvec_t));
    printf("sizeof(binding_t) = %lu", sizeof(binding_t));
    printf("sizeof(elem_t) = %lu", sizeof(elem_t));
}
*/

static void strong_pullup_resolver(elem_t el) {
    union {
        bitvec_t result;
        uint64_t all;
    } foo;
    foo.result.values = ALL_BITS;
    foo.result.undefs = NO_BITS;
    foo.result.highzs = NO_BITS;
    printf("RESULT: %llu\n", foo.all);
}

static elem_t strong_pullup = { "1 pullup", strong_pullup_resolver, /*zeroes*/ };

int main(int ac, char** av) {
    static elem_t el;
    strong_pullup_resolver(el);
}
