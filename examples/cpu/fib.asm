# fib.asm -- Fibonacci numbers below 2^15-1, for the examples/cpu RiSC-16 CPU.
#
# Writes the Fibonacci sequence 1, 1, 2, 3, 5, ... to data memory for as long as
# the numbers stay below 2^15-1 = 32767, then stores how many it wrote and spins.
# The last number below the limit is F23 = 28657 (0x6ff1); the next, 46368, is
# over it.  So this fills Mem[0x0100..0x0116] with 23 words and leaves 23
# (0x0017) in Mem[0x0000].
#
#     asm/a examples/cpu/fib.asm fib.hex     # one 16-bit word per line
#
# The ROM image examples/cpu/cpurom.bin is this program, so opening
# examples/cpu/core.json and pressing RUN (or STEP) executes it.
#
# THE LIMIT TEST.  The machine has no compare and no shift -- only add, nand and
# beq -- but it does not need one here.  Every Fibonacci number below 32767 has
# bit 15 clear, and the first one that is not below it, 46368, has bit 15 set
# (there is no Fibonacci number in between).  So "is the next one too big?" is
# just "is bit 15 set?", which is two nands against a mask of 0x8000.
#
# r0 IS NOT ZERO UNTIL WE MAKE IT ZERO.  On this machine the register file is a
# pair of plain 8x16 RAMs (U3/U4 in core.json), and nothing hardwires register 0
# to zero -- it powers up undefined like the other seven.  Read it before writing
# it and every value downstream becomes U, which is why risc16test.asm uses only
# r1-r7.  This program leans on r0 as the architectural zero, so it starts by
# storing zero there: `lui r0, 0` writes the top 10 bits and clears the low 6.
#
# REGISTERS
#   r0  zero -- created by the first instruction, then left alone
#   r1  a     -- F(n-1)
#   r2  b     -- F(n), the number written this time round
#   r3  next  -- a + b, the candidate for the next round
#   r4  0x8000, the limit mask
#   r5  store pointer, walking up from 0x0100
#   r6  scratch, for the bit-15 test
#   r7  count of numbers written

        lui     r0, 0           # 0000  r0 := 0 -- see above; must come first
        lui     r4, 0x8000      # 0001  r4 := 0x8000 -- bit 15 alone
        movi    r5, 0x0100      # 0002  r5 := 0x0100 -- where the sequence goes
                                # 0003    (movi is lui + addi, two words)
        add     r1, r0, r0      # 0004  a := 0
        addi    r2, r0, 1       # 0005  b := 1
        add     r7, r0, r0      # 0006  count := 0

loop:
        sw      r2, r5, 0       # 0007  Mem[p] := b
        addi    r5, r5, 1       # 0008  p++
        addi    r7, r7, 1       # 0009  count++
        add     r3, r1, r2      # 000a  next := a + b
        nand    r6, r3, r4      # 000b  r6 := ~(next & 0x8000)
        nand    r6, r6, r6      # 000c  r6 := next & 0x8000
        beq     r6, r0, cont    # 000d  bit 15 clear -- next still fits
        beq     r0, r0, done    # 000e  bit 15 set -- next is over the limit

cont:
        add     r1, r0, r2      # 000f  a := b
        add     r2, r0, r3      # 0010  b := next
        beq     r0, r0, loop    # 0011

done:
        sw      r7, r0, 0       # 0012  Mem[0] := how many were written

# Nothing halts this machine, so the program ends by spinning.  The add is not
# busy-work: the ALU result register drives the two hex displays, so recomputing
# the last Fibonacci number every time round parks it on screen instead of
# leaving whatever the branch happened to compute.
spin:
        add     r3, r0, r2      # 0013  r3 := the last Fibonacci number
        beq     r0, r0, spin    # 0014
