/*
 * Copyright (c) (TODO owning company here) 2025. All rights reserved.
 * This file was generated from a KiCad schematic. Do not edit.
 *
 * Tool: KiCad Eeschema 8.0.8 (schema version E)
 * From: /Users/jeff/go/src/github.com/gmofishsauce/wut4/sim/KiCad/Sample.kicad_sch
 * Date: 2025-06-10T13:48:51-0700
 *
 * sheet 1: / (Sample Schematic)
 */
#include "TspGen.h"
// Wire nets
bitvec64_t TspWires;
// Resolver functions
// HAND EDIT: p2, p7, p11, p14 are B1-0 through B1-3.
// HAND EDIT: p3 is unconnected

/*
 * The transpiler generates two files, one .h and one .c file. These files
 * should never be edited. The .h file contains declarations for the wire
 * nets, component types, and components for the circuit. The .c file contains
 * definitions of the wire and component instances and, optionally, a comment
 * containing empty implementations of the resolver functions, which are
 * declared external in the .h file.
 *
 * The transpiler can write a proposed simulator core. Because its ability to
 * generate this file is limited, it does this only in response to a command
 * line option and only if the simulator core file does not exist - there is
 * no "force" option.
 *
 * Any wire that is connected to '0' or '1' is put in the defined set. Any
 * output of a part that is connect to POR or NOT_POR is also put in the
 * defined set. The algorithm then works forward, incrementally adding logic
 * elements all of whose inputs are in the defined set. The algorithm does
 * not distinguish between clocked and unclocked parts.
 */
void C74xx_74LS175_B1_resolver(void) {
}

void C74xx_74LS175_p6_resolver(void) {
    // TODO
}

void C74xx_74LS175_p10_resolver(void) {
    // TODO
}

void C74xx_74LS175_p15_resolver(void) {
    // TODO
}

void C74xx_74LS86_p3_resolver(void) {
    // TODO
}

void C74xx_74LS86_p6_resolver(void) {
    // TODO
}

void C74xx_74LS86_p8_resolver(void) {
    // TODO
}

void C74xx_74LS86_p11_resolver(void) {
    // TODO
}

