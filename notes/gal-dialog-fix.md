hi Claude. There is a bug in the GAL editor. The editor has controls
in the top section allowing the user to set whether an output is
registered or combinational.  But this control does not result in
anything happening in the save file. Apparently the state of an
output--registered versus combinational--is inferred from the logic
equations, i.e.  whether they have ".R" or not. This is confusing,
Because if there is no such equation (yet) the state of the output
is lost when the file is saved--so the control for setting the
output type to "reg out" appears to the user to fail.  The dialog's
operation disagrees with my design process. I prefer to block out
the part's inputs and outputs and produce the logic equations later,
which means the part's save file may sit for a long time with only
pinouts and output types defined but no logic equations.

To fix this, it must be possible to save the design in this state
without loss of fidelity, meaning the saved design must retain the
pin output type definitions separately from the logic equations,
which may (at times) conflict with the pin definitions. Similarly,
it must be possible to define a clock input and connect the clock
signal to a part with no logic equations (yet). Currently, this
produces an error.

I think properly fixing this problem may require a major change to
the way the GAL design dialogue works. The pin definitions and
grouping must capture the use the user's intent and must be explicitly
saved in the save file to indicate it. Logic equations and the clock
pin definition need not match--and may be absent, or disagree
with--the definition of the outputs. It must always be possible to
save the current state of the editor in the file, and the error
message that directs the user to edit the YAML file by hand must
be removed.

The code that reads the YAML file should reject the file only when
it does not contain syntactically valid YAML. Otherwise, the reader
must accept semantically inconsistent files and populate the dialogue
boxas best it can. Errors must still be collected, but they should
be placed in a newly added dialog tab titled "Errors" containing a
scrolling text box to display the set of errors. When the design
has errors, a single line message in red should be displayed on
every tab in the dialog.  If the dialog box is closed in an error
state, the component itself should be drawn in the schematic in red
instead of blue, end it should have a mouse over a message saying
e.g. "component definition contains errors".  Also, the "Run" button
should give an error dialog stating that the design cannot be
executed because the definition of the specific component is
incomplete. Example message: "The design cannot be run because the
definition of U6 contains errors".

Fixing this bug may require changes to the save file format and may
require migration of some existing save files in `examples/`.

Now please think about this significant change to the specification
and ask me any clarifying questions you require before updating the
specs.
