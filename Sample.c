#include <stdint.h>
#include <stdio.h>
#include "api.h"
#include "TspGen.h"

void U1_rising_edge(void);
void N8_U2_3_clock_is_high(void);
void N9_U2_6_clock_is_high(void);
void N10_U2_8_clock_is_high(void);
void N11_U2_11_clock_is_high(void);

void initialize_simulation(void) {
    add_rising_edge_hook(&U1_rising_edge);
    add_clock_is_high_hook(&N8_U2_3_clock_is_high);
    add_clock_is_high_hook(&N9_U2_6_clock_is_high);
    add_clock_is_high_hook(&N10_U2_8_clock_is_high);
    add_clock_is_high_hook(&N11_U2_11_clock_is_high);
}

// Set internal state of outputs to bus B1
// These are from register U1, outputs Q0, Q1, Q2#, and Q3#.
void U1_rising_edge(void) {
    static uint64_t B1_state[1];
    if (GetPOR()) {
        SETN(B1_state, B1, B1_SIZE, 0x03);
    } else {
        SET1(B1_state, 0, getnet(U2_3));
        SET1(B1_state, 1, getnet(U2_6));
        SET1(B1_state, 2, NOT(getnet(U2_8)));
        SET1(B1_state, 3, NOT(getnet(U2_11)));
    }
    setbus(B1, B1_SIZE, GETN(B1_state, B1, B1_SIZE));
}

void N8_U2_3_clock_is_high(void) {
    uint64_t in1 = GetVCC();
    uint64_t in2 = getnet(B1+0);
    setnet(U2_3, ((in1&2)|(in2&2)) ? UNDEF : in1^in2);
}

void N9_U2_6_clock_is_high(void) {
    uint64_t in1 = getnet(U2_3);
    uint64_t in2 = getnet(B1+1);
    setnet(U2_6, ((in1&2)|(in2&2)) ? UNDEF : in1^in2);
}

void N10_U2_8_clock_is_high(void) {
    uint64_t in1 = getnet(U2_6);
    uint64_t in2 = getnet(B1+2);
    setnet(U2_6, ((in1&2)|(in2&2)) ? UNDEF : in1^in2);
}

void N11_U2_11_clock_is_high(void) {
    uint64_t in1 = getnet(U2_8);
    uint64_t in2 = getnet(B1+3);
    setnet(U2_8, ((in1&2)|(in2&2)) ? UNDEF : in1^in2);
}

