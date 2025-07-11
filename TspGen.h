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
extern uint16_t TspGetClk(void);
#define GetCLK() TspGetClk()
extern uint16_t TspGetPor(void);
#define GetPOR() TspGetPor()
// N8_U2_3
#define Set_N8_U2_3(b)  (wires.values |= (((b)&0x1)<<0))
#define Get_N8_U2_3()  ((wires.values & (0x1<<0))>>0)
#define SetZ_N8_U2_3(b) (wires.highzs |= (((b)&0x1)<<0))
#define IsZ_N8_U2_3()  ((wires.highzs & (0x1<<0))>>0)
#define SetU_N8_U2_3(b) (wires.undefs |= (((b)&0x1)<<0))
#define IsU_N8_U2_3()  ((wires.undefs & (0x1<<0))>>0)
extern void N8_U2_3_resolver(void);
// N9_U2_6
#define Set_N9_U2_6(b)  (wires.values |= (((b)&0x1)<<1))
#define Get_N9_U2_6()  ((wires.values & (0x1<<1))>>1)
#define SetZ_N9_U2_6(b) (wires.highzs |= (((b)&0x1)<<1))
#define IsZ_N9_U2_6()  ((wires.highzs & (0x1<<1))>>1)
#define SetU_N9_U2_6(b) (wires.undefs |= (((b)&0x1)<<1))
#define IsU_N9_U2_6()  ((wires.undefs & (0x1<<1))>>1)
extern void N9_U2_6_resolver(void);
// N10_U2_8
#define Set_N10_U2_8(b)  (wires.values |= (((b)&0x1)<<2))
#define Get_N10_U2_8()  ((wires.values & (0x1<<2))>>2)
#define SetZ_N10_U2_8(b) (wires.highzs |= (((b)&0x1)<<2))
#define IsZ_N10_U2_8()  ((wires.highzs & (0x1<<2))>>2)
#define SetU_N10_U2_8(b) (wires.undefs |= (((b)&0x1)<<2))
#define IsU_N10_U2_8()  ((wires.undefs & (0x1<<2))>>2)
extern void N10_U2_8_resolver(void);
// N11_U2_11
#define Set_N11_U2_11(b)  (wires.values |= (((b)&0x1)<<3))
#define Get_N11_U2_11()  ((wires.values & (0x1<<3))>>3)
#define SetZ_N11_U2_11(b) (wires.highzs |= (((b)&0x1)<<3))
#define IsZ_N11_U2_11()  ((wires.highzs & (0x1<<3))>>3)
#define SetU_N11_U2_11(b) (wires.undefs |= (((b)&0x1)<<3))
#define IsU_N11_U2_11()  ((wires.undefs & (0x1<<3))>>3)
extern void N11_U2_11_resolver(void);
// N12_U1_10_Q2
#define Set_N12_U1_10_Q2(b)  (wires.values |= (((b)&0x1)<<4))
#define Get_N12_U1_10_Q2()  ((wires.values & (0x1<<4))>>4)
#define SetZ_N12_U1_10_Q2(b) (wires.highzs |= (((b)&0x1)<<4))
#define IsZ_N12_U1_10_Q2()  ((wires.highzs & (0x1<<4))>>4)
#define SetU_N12_U1_10_Q2(b) (wires.undefs |= (((b)&0x1)<<4))
#define IsU_N12_U1_10_Q2()  ((wires.undefs & (0x1<<4))>>4)
extern void N12_U1_10_Q2_resolver(void);
// N13_U1_15_Q3
#define Set_N13_U1_15_Q3(b)  (wires.values |= (((b)&0x1)<<5))
#define Get_N13_U1_15_Q3()  ((wires.values & (0x1<<5))>>5)
#define SetZ_N13_U1_15_Q3(b) (wires.highzs |= (((b)&0x1)<<5))
#define IsZ_N13_U1_15_Q3()  ((wires.highzs & (0x1<<5))>>5)
#define SetU_N13_U1_15_Q3(b) (wires.undefs |= (((b)&0x1)<<5))
#define IsU_N13_U1_15_Q3()  ((wires.undefs & (0x1<<5))>>5)
extern void N13_U1_15_Q3_resolver(void);
// N14_U1_6_NOT_Q1
#define Set_N14_U1_6_NOT_Q1(b)  (wires.values |= (((b)&0x1)<<6))
#define Get_N14_U1_6_NOT_Q1()  ((wires.values & (0x1<<6))>>6)
#define SetZ_N14_U1_6_NOT_Q1(b) (wires.highzs |= (((b)&0x1)<<6))
#define IsZ_N14_U1_6_NOT_Q1()  ((wires.highzs & (0x1<<6))>>6)
#define SetU_N14_U1_6_NOT_Q1(b) (wires.undefs |= (((b)&0x1)<<6))
#define IsU_N14_U1_6_NOT_Q1()  ((wires.undefs & (0x1<<6))>>6)
extern void N14_U1_6_NOT_Q1_resolver(void);
// N17_NOT_POR
#define Set_N17_NOT_POR(b)  (wires.values |= (((b)&0x1)<<7))
#define Get_N17_NOT_POR()  ((wires.values & (0x1<<7))>>7)
#define SetZ_N17_NOT_POR(b) (wires.highzs |= (((b)&0x1)<<7))
#define IsZ_N17_NOT_POR()  ((wires.highzs & (0x1<<7))>>7)
#define SetU_N17_NOT_POR(b) (wires.undefs |= (((b)&0x1)<<7))
#define IsU_N17_NOT_POR()  ((wires.undefs & (0x1<<7))>>7)
extern void N17_NOT_POR_resolver(void);
// B1
#define Set_B1(b)  (wires.values |= (((b)&0xF)<<8))
#define Get_B1()  ((wires.values & (0xF<<8))>>8)
#define SetZ_B1(b) (wires.highzs |= (((b)&0xF)<<8))
#define IsZ_B1()  ((wires.highzs & (0xF<<8))>>8)
#define SetU_B1(b) (wires.undefs |= (((b)&0xF)<<8))
#define IsU_B1()  ((wires.undefs & (0xF<<8))>>8)
extern void B1_resolver(void);
// Component types
typedef struct bitvec16_t C74xx_74LS175_t;
typedef struct bitvec16_t C74xx_74LS86_t;
typedef struct bitvec16_t CConnector_Generic_Conn_01x04_t;
