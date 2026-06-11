# simulation engine vision statement

There will be two distinct simulation engines in the "sim" program:
The "slow" or "debug" simulation engine and the fast simulation
engine.  Think of them like an interpretive implementation and a
compiled implementation of the same program, where the program is
the schematic created on the editing canvas.  The "slow" engine
will be implemented on the editing canvas, making it "live", while
the fast engine is a code generator that creates a standalone C
simulation program from the schematic.

The slow simulator is triggered by a button in the tool bar labeled
"run".  When it is clicked, the button itself changes to say "stop",
andthe "mode" tray in the status bar changes to say "simulating".
This "slow" simulator is implemented in JavaScript in the program
front end.  It must read the behavior section of all the components
that participate in the schematic.  It must be prepared to implement
the behavior section  from the YAML file of each component that
appears in the schematic.

The simulator must work for both simple schematics containing only
combinational logic and for more conventional designs that will
contain a Clock generator and implement sequential synchronous
digital logic. In fact, a combinational-only simulation containing
no clock generator can be considered a single clock cycle after
which the simulation may update to display results and then terminate.
Any sequential simulation should run until stopped using the button
in the toolbar.

This simulator must represent all four states: "1", "0", undefined
(U), and high-impedence (3-state node with no driver enabled, Z).
Anythign with a "Z" input generates an undefined output, and anything
combined with an undefined value results in an undefined value.
Note that the built-in indicator component has a visual state for
undefined signals this would easily not be detectable in a real
circuit but being able to display it is one of the virtues of
simulation. And also note that all drivers of any three state
node must always be a valuated in order to detect bus conflicts,
which must be reported using some TBD visual mechanism.
