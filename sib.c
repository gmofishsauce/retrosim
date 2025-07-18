/* Copyright (c) Jeff Berkowitz 2025. All rights reserved. */

#include "logic.h"

inline uint64_t NOT(int sib) {
    return (sib&0x2) ? UNDEF : ~sib&1;
}
