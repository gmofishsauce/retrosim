# risc16test.asm -- the regression program that examples/cpu/check-cpu.mjs runs.
#
# This is the assembly source for the ROM image that check-cpu.mjs otherwise
# carries as a hand-built hex table (its PROG constant).  Assembling it must
# reproduce that table word for word; the checker's expectations are keyed to
# these exact addresses, so do not insert or remove instructions without
# updating EXPECT in check-cpu.mjs to match.
#
#     asm/a risc16test.asm risc16test.hex
#
# Every one of the eight RiSC-16 instructions executes once, and the program
# also covers both branch directions, the sw -> lw memory round trip, and
# jalr's register-sourced jump with its link value.

        lui     r1, 0x40        # 0000  r1 := 1<<6 = 0x0040
        addi    r2, r1, 1       # 0001  r2 := 0x40 + 1 = 0x0041
        add     r3, r1, r2      # 0002  r3 := 0x40 + 0x41 = 0x0081
        nand    r4, r1, r1      # 0003  r4 := ~0x0040 = 0xffbf
        sw      r3, r1, 0       # 0004  Mem[0x40] := 0x0081
        lw      r5, r1, 0       # 0005  r5 := Mem[0x40] = 0x0081
        beq     r3, r5, skip    # 0006  equal, so 0007 is skipped
        lui     r1, 0           # 0007  must NOT execute
skip:
        jalr    r6, r2          # 0008  r6 := PC+1 = 0x0009, then PC := r2 = 0x0041

        .space  0x38            # 0009..0040  unused

target:
        add     r7, r6, r6      # 0041  r7 := 9 + 9 = 0x0012, proving the link
                                #       value actually reached r6
