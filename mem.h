/* Copyright (c) Jeff Berkowitz 2024. All rights reserved. */

/* 456789012345678901234567890123456789012345678901234567890123456789012
 *      10        20        30        40        50        60        70 
 */

extern uint16_t rdreg(uint32_t at);
extern void wrreg(uint32_t at, uint16_t v);

extern uint16_t rdspr(uint32_t at);
extern void wrspr(uint32_t at, uint16_t v);

extern uint16_t rdmmu(uint32_t at);
extern void wrmmu(uint32_t at, uint16_t v);

extern uint16_t rdmem(uint32_t at);
extern void wrmem(uint32_t at, uint16_t v);

extern uint8_t rdmemb(uint32_t at);
extern void wrmemb(uint32_t at, uint8_t v);
