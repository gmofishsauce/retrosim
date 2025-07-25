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

#include "TspGen.h"

// Wire nets
uint64_t TspNets[NETS_ELEMENT_COUNT];

void *get_nets(void) {
	return (void*) TspNets;
}
uint32_t get_nets_element_size(void) {
	return sizeof(uint64_t);
}
uint32_t get_nets_element_count(void) {
	return NETS_ELEMENT_COUNT;
}
char *get_net_list_file_name(void) {
	return "TspNets.csv";
}
char *get_trace_file_name(void) {
	return "TspTrace.bin";
}
