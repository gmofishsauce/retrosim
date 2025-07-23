/* Copyright (c) Jeff Berkowitz 2024. All rights reserved. */

// TODO: transpiler generate this file
//
#define MAX_HOOKS 10
#define ENABLE_TRACING 1

// If we're tracing, define some necessary symbols.
// If not, kill the warning about empty translation units.
#ifdef ENABLE_TRACING
#define TRACE_FILE_NAME "trace.bin"
#define NET_LIST_FILE_NAME "netlist.csv"
#else
#pragma clang diagnostic ignored "-Wempty-translation-unit"
#endif
