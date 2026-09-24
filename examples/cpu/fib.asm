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
# PASSES.  The whole computation runs 10 times over (the literal in the movi at
# 0002 -- the assembler has no named constants), each pass rewriting the same
# memory, so the program doubles as a benchmark for the fast (C) simulator.
# One pass is about 1,050 clocks, so 10 passes reach the spin loop after about
# 10,500 clocks: under 0.2 s for the generated C built with `cc -O2` on an
# i7-9750H.  Built with no -O it runs much slower, and on the slow
# (debug) simulator even one pass takes over a minute -- set PASSES to 1 there.
# The remaining-pass count lives in Mem[0x0001].
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
#   r6  scratch, for the bit-15 test and for the pass count between passes
#   r7  count of numbers written

        lui     r0, 0           # 0000  r0 := 0 -- see above; must come first
        lui     r4, 0x8000      # 0001  r4 := 0x8000 -- bit 15 alone
        movi    r6, 10          # 0002  r6 := passes to run -- see PASSES above
                                # 0003    (movi is lui + addi, two words)
        sw      r6, r0, 1       # 0004  Mem[1] := passes still to run

again:
        movi    r5, 0x0100      # 0005  r5 := 0x0100 -- where the sequence goes
                                # 0006
        add     r1, r0, r0      # 0007  a := 0
        addi    r2, r0, 1       # 0008  b := 1
        add     r7, r0, r0      # 0009  count := 0

loop:
        sw      r2, r5, 0       # 000a  Mem[p] := b
        addi    r5, r5, 1       # 000b  p++
        addi    r7, r7, 1       # 000c  count++
        add     r3, r1, r2      # 000d  next := a + b
        nand    r6, r3, r4      # 000e  r6 := ~(next & 0x8000)
        nand    r6, r6, r6      # 000f  r6 := next & 0x8000
        beq     r6, r0, cont    # 0010  bit 15 clear -- next still fits
        beq     r0, r0, done    # 0011  bit 15 set -- next is over the limit

cont:
        add     r1, r0, r2      # 0012  a := b
        add     r2, r0, r3      # 0013  b := next
        beq     r0, r0, loop    # 0014

done:
        sw      r7, r0, 0       # 0015  Mem[0] := how many were written

# End of one pass.  Every register is spoken for inside the pass, so the pass
# counter lives in memory, at Mem[1]; r6 is free to borrow here because the
# bit-15 test is over.
        lw      r6, r0, 1       # 0016  r6 := passes still to run
        addi    r6, r6, -1      # 0017  one fewer
        sw      r6, r0, 1       # 0018
        beq     r6, r0, spin    # 0019  that was the last pass
        beq     r0, r0, again   # 001a

# Nothing halts this machine, so the program ends by spinning.  The add is not
# busy-work: the ALU result register drives the two hex displays, so recomputing
# the last Fibonacci number every time round parks it on screen instead of
# leaving whatever the branch happened to compute.
spin:
        add     r3, r0, r2      # 001b  r3 := the last Fibonacci number
        beq     r0, r0, spin    # 001c
