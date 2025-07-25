/*
 * Copyright (c) Wholly Unnecessary Technologies 2025. All rights reserved.
 * This file was generated from a KiCad schematic. Do not edit.
 *
 * Tool: KiCad Eeschema 8.0.8 (schema version E)
 * From: /Users/jeff/go/src/github.com/gmofishsauce/wut4/sim/KiCad/Sample.kicad_sch
 * Date: 2025-06-10T13:48:51-0700
 *
 * sheet 1: / (Sample Schematic)
 */

#ifndef TSPGEN_H
#define TSPGEN_H

#include <stdint.h>
#include "api.h"

#define NETS_ELEMENT_COUNT 1
extern uint64_t TspNets[];

#define getnet(s)       GET1(TspNets, s)
#define setnet(s, v)    SET1(TspNets, s, v)
#define getbus(s, n)    GETN(TspNets, s, n)
#define setbus(s, n, v) SETN(TspNets, s, n, v)

// net N8_U2_3
#define N8_U2_3 0

#define U1_4 N8_U2_3
#define U2_3 N8_U2_3
#define U2_4 N8_U2_3

// net N9_U2_6
#define N9_U2_6 1

#define U1_5 N9_U2_6
#define U2_6 N9_U2_6
#define U2_9 N9_U2_6

// net N10_U2_8
#define N10_U2_8 2

#define U1_12 N10_U2_8
#define U2_12 N10_U2_8
#define U2_8 N10_U2_8

// net N11_U2_11
#define N11_U2_11 3

#define U1_13 N11_U2_11
#define U2_11 N11_U2_11

// net N12_U1_10_Q2
#define N12_U1_10_Q2 4

#define U1_10 N12_U1_10_Q2
#define U2_10 N12_U1_10_Q2

// net N13_U1_15_Q3
#define N13_U1_15_Q3 5

#define U1_15 N13_U1_15_Q3
#define U2_13 N13_U1_15_Q3

// net N14_U1_6_NOT_Q1
#define N14_U1_6_NOT_Q1 6

#define U1_6 N14_U1_6_NOT_Q1
#define U2_5 N14_U1_6_NOT_Q1

// net N17_NOT_POR
#define N17_NOT_POR 7

#define U1_1 N17_NOT_POR

// net B1
#define B1 8
#define B1_SIZE 4

#endif // TSPGEN_H
