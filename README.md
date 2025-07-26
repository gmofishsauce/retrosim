# sinter - simulation netlist transpiler/simulator

This isn't done yet - the overview that follows is aspirational.

## Quick overview

**Sinter** accepts a KiCad netlist export as input and generates C language
4-state digital simulator corresponding to the circuit. There are many
limitations on the schematic, and you may need to write functional code
for specific component behaviors.

To use **sinter**, you must have installed both C language and Go language
build environments. All C code, both hand-written and generated, is
warning-free C99 for maximum portability. Golang 1.23 or later is required.

The sinter transpiler is found in the **TSP/** subfolder. Use `go build` at
the command line in that directory. Place your KiCad-format netlist export
(e.g. `my.net`) in the repo root and `./TSP/tsp -g my.net`.

If successful, the transpiler will generate `my.c` in this directory, along
with `TspGen.c` and `TspGen.h`. Examine `my.c`. If your schematic used only
simple 74xxx series components, the functionality may have been supplied.
If not, you'll have to write code; see the **4-state Programming API**
section below for help.

Now build the simulator: `cc -o mysim *.c SIM/*.c`. Run the simulator for
a few cycles with the `-t` flag to create a trace file: `mysim -c 10 -t`.

Change to the `WV/` folder and cc -o wv wv.c. Now `./wv ../mytrace.bin | vcd` to see the waveforms. (Link to [the `vcd` utility](https://github.com/yne/vcd), which generates a waveform display on a terminal.)

Summary: your netlist export, transpiler-generated files, and simulation
outputs belong in the root of the repo. The transpiler, written in Golang,
is in **TSP/**. The simulator core is in **CORE/** and the `wv` utility, which translates the simulator's binary trace output to industry-semi-standard VCD files, is in **WV/**. The `vcd` utility can be used to display results.

## Command line flags

TODO

## 4-state programming API

TODO

## TODO list

### Sooner

 - DONE I/O for the simulator: vcd file generator (target https://github.com/yne/vcd)
 - DONE Real allocator for storage for nets (currently just allocates 32 nets)
 - 4-value logic functions using LUTs to avoid branches in code
 - 4-value logic API documentation
 - Better sample code
 - DONE? Fully reorganize repo as described above

### Later

 - Simulators for common 74xxx series components
 - Modify the transpiler to connect component simulators

