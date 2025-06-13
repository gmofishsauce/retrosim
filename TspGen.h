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
#include <stdint.h>
#include "types.h"
// Wire nets
extern bitvec64_t TspWires;
#define GetGND() 0
#define GetVCC() 1
#define GetCLK() uint16_t TspGetClk(void)
#define GetPOR() uint16_t TspGetPor(void)
// N8_drv_U2_3
#define Set_N8_drv_U2_3(b)  (wires.values |= (((b)&0x1)<<0))
#define Get_N8_drv_U2_3()  ((wires.values & (0x1<<0))>>0)
#define SetZ_N8_drv_U2_3(b) (wires.highzs |= (((b)&0x1)<<0))
#define IsZ_N8_drv_U2_3()  ((wires.highzs & (0x1<<0))>>0)
#define SetU_N8_drv_U2_3(b) (wires.undefs |= (((b)&0x1)<<0))
#define IsU_N8_drv_U2_3()  ((wires.undefs & (0x1<<0))>>0)
// N9_drv_U2_6
#define Set_N9_drv_U2_6(b)  (wires.values |= (((b)&0x1)<<1))
#define Get_N9_drv_U2_6()  ((wires.values & (0x1<<1))>>1)
#define SetZ_N9_drv_U2_6(b) (wires.highzs |= (((b)&0x1)<<1))
#define IsZ_N9_drv_U2_6()  ((wires.highzs & (0x1<<1))>>1)
#define SetU_N9_drv_U2_6(b) (wires.undefs |= (((b)&0x1)<<1))
#define IsU_N9_drv_U2_6()  ((wires.undefs & (0x1<<1))>>1)
// N10_drv_U2_8
#define Set_N10_drv_U2_8(b)  (wires.values |= (((b)&0x1)<<2))
#define Get_N10_drv_U2_8()  ((wires.values & (0x1<<2))>>2)
#define SetZ_N10_drv_U2_8(b) (wires.highzs |= (((b)&0x1)<<2))
#define IsZ_N10_drv_U2_8()  ((wires.highzs & (0x1<<2))>>2)
#define SetU_N10_drv_U2_8(b) (wires.undefs |= (((b)&0x1)<<2))
#define IsU_N10_drv_U2_8()  ((wires.undefs & (0x1<<2))>>2)
// N11_drv_U2_11
#define Set_N11_drv_U2_11(b)  (wires.values |= (((b)&0x1)<<3))
#define Get_N11_drv_U2_11()  ((wires.values & (0x1<<3))>>3)
#define SetZ_N11_drv_U2_11(b) (wires.highzs |= (((b)&0x1)<<3))
#define IsZ_N11_drv_U2_11()  ((wires.highzs & (0x1<<3))>>3)
#define SetU_N11_drv_U2_11(b) (wires.undefs |= (((b)&0x1)<<3))
#define IsU_N11_drv_U2_11()  ((wires.undefs & (0x1<<3))>>3)
// N12_drv_U1_10_Q2
#define Set_N12_drv_U1_10_Q2(b)  (wires.values |= (((b)&0x1)<<4))
#define Get_N12_drv_U1_10_Q2()  ((wires.values & (0x1<<4))>>4)
#define SetZ_N12_drv_U1_10_Q2(b) (wires.highzs |= (((b)&0x1)<<4))
#define IsZ_N12_drv_U1_10_Q2()  ((wires.highzs & (0x1<<4))>>4)
#define SetU_N12_drv_U1_10_Q2(b) (wires.undefs |= (((b)&0x1)<<4))
#define IsU_N12_drv_U1_10_Q2()  ((wires.undefs & (0x1<<4))>>4)
// N13_drv_U1_15_Q3
#define Set_N13_drv_U1_15_Q3(b)  (wires.values |= (((b)&0x1)<<5))
#define Get_N13_drv_U1_15_Q3()  ((wires.values & (0x1<<5))>>5)
#define SetZ_N13_drv_U1_15_Q3(b) (wires.highzs |= (((b)&0x1)<<5))
#define IsZ_N13_drv_U1_15_Q3()  ((wires.highzs & (0x1<<5))>>5)
#define SetU_N13_drv_U1_15_Q3(b) (wires.undefs |= (((b)&0x1)<<5))
#define IsU_N13_drv_U1_15_Q3()  ((wires.undefs & (0x1<<5))>>5)
// N14_drv_U1_6_NOT_Q1
#define Set_N14_drv_U1_6_NOT_Q1(b)  (wires.values |= (((b)&0x1)<<6))
#define Get_N14_drv_U1_6_NOT_Q1()  ((wires.values & (0x1<<6))>>6)
#define SetZ_N14_drv_U1_6_NOT_Q1(b) (wires.highzs |= (((b)&0x1)<<6))
#define IsZ_N14_drv_U1_6_NOT_Q1()  ((wires.highzs & (0x1<<6))>>6)
#define SetU_N14_drv_U1_6_NOT_Q1(b) (wires.undefs |= (((b)&0x1)<<6))
#define IsU_N14_drv_U1_6_NOT_Q1()  ((wires.undefs & (0x1<<6))>>6)
// N17_NOT_POR
#define Set_N17_NOT_POR(b)  (wires.values |= (((b)&0x1)<<7))
#define Get_N17_NOT_POR()  ((wires.values & (0x1<<7))>>7)
#define SetZ_N17_NOT_POR(b) (wires.highzs |= (((b)&0x1)<<7))
#define IsZ_N17_NOT_POR()  ((wires.highzs & (0x1<<7))>>7)
#define SetU_N17_NOT_POR(b) (wires.undefs |= (((b)&0x1)<<7))
#define IsU_N17_NOT_POR()  ((wires.undefs & (0x1<<7))>>7)
// B1
#define Set_B1(b)  (wires.values |= (((b)&0xF)<<8))
#define Get_B1()  ((wires.values & (0xF<<8))>>8)
#define SetZ_B1(b) (wires.highzs |= (((b)&0xF)<<8))
#define IsZ_B1()  ((wires.highzs & (0xF<<8))>>8)
#define SetU_B1(b) (wires.undefs |= (((b)&0xF)<<8))
#define IsU_B1()  ((wires.undefs & (0xF<<8))>>8)
// Component types
typedef struct bitvec16_t C74xx_74LS175_t;
typedef struct bitvec16_t C74xx_74LS86_t;
typedef struct bitvec16_t CConnector_Generic_Conn_01x04_t;
// Resolver functions
extern void C74xx_74LS175_p2_resolver(void);
extern void C74xx_74LS175_p3_resolver(void);
extern void C74xx_74LS175_p6_resolver(void);
extern void C74xx_74LS175_p7_resolver(void);
extern void C74xx_74LS175_p10_resolver(void);
extern void C74xx_74LS175_p11_resolver(void);
extern void C74xx_74LS175_p14_resolver(void);
extern void C74xx_74LS175_p15_resolver(void);
extern void C74xx_74LS86_p3_resolver(void);
extern void C74xx_74LS86_p6_resolver(void);
extern void C74xx_74LS86_p8_resolver(void);
extern void C74xx_74LS86_p11_resolver(void);
