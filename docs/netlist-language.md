# NDL — a Netlist Description Language

*A specification reverse-engineered from a single example:*
*<https://gtoal.com/vectrex/joystick/netlist.txt> (G. Toal, USB-to-Vectrex
joystick adapter). There is no formal definition of this language; this
document describes the language **implied** by that example. Where the example
is ambiguous, this spec says so and states the most plausible interpretation.*

*This document is the format reference for the retrosim NDL exporter
(FR-119a, design.md §6.18).*

The author describes it as "an approximation to the sort of tools we used at
university in the 70's to describe, simulate, and lay out circuit boards."
It is a plain-text, line-oriented netlist format with three constructs:
**pinout** definitions (package types), **package** statements (instantiation),
and a **circuit** block (the connection list).

---

## 1. Lexical structure

- **Line-oriented.** One statement per line; there is no line-continuation
  syntax. The only way to put multiple statements on one line is the `;`
  separator inside a `circuit` block (§5).
- **Comments** start at `#` and run to end of line. They may occupy a whole
  line or trail a statement:

  ```
  # From DB9:
  pin 1 = Anode      # Input source
  ```

- **Blank lines** are ignored and used freely for visual grouping.
- **Whitespace** (spaces) separates tokens; leading indentation (two spaces
  inside blocks, by convention) is not significant. Extra spaces used for
  column alignment are ignored:

  ```
  PI.BCM.5  -> Opto1.Anode
  ```

- **Keywords** are lowercase: `pinout`, `pin`, `end`, `package`, `circuit`.
- **Case** is significant in names (`Digipot1`, `PB1`, `Vss` are written
  consistently; nothing in the example suggests case folding).

### 1.1 Names

Names are unusually permissive — essentially any run of characters that is not
whitespace and not one of the delimiters `=`, `;`, `#`. In particular a name
may:

| Feature | Examples |
|---|---|
| start with a digit | `3.3v`, `5v`, `0v` |
| start with `+` or `-` | `+5v`, `-5v` |
| contain embedded dots | `BCM.2`, `SPI0.MOSI`, `I2C1.SDA` |
| end with an apostrophe | `CS'`, `RS'`, `SHDN'` |
| contain underscores | `Trimpot_3386P1_103LF` |

**Convention:** a trailing `'` (prime) marks an **active-low** signal, the
plain-text stand-in for an overbar. It is part of the name — connections must
write it (`PI.5v -> Digipot1.SHDN'`).

**Restriction implied by pin references (§5.1):** *instance* names must not
contain dots, because the first dot in a pin reference is what separates the
instance from the pin name. Pin names may contain dots freely.

---

## 2. File organization

The example follows a strict declare-before-use order, which any processor
would presumably require:

1. `pinout` definitions — the package *types*
2. `package` statements — *instances* of those types
3. one `circuit` block — the connections between instance pins

---

## 3. `pinout` — defining a package type

```
pinout <TypeName>
  pin <number> = <name> [ = <name> ... ]
  ...
end <TypeName>
```

Declares a package type and names its pins. Example:

```
pinout PC817
  pin 1 = Anode      # Input source
  pin 2 = Cathode    # Input ground
  pin 3 = Emitter    # Output source
  pin 4 = Collector  # Output ground
end PC817
```

- **Pin numbers** are positive integers — the physical pin numbers of the
  package. The example lists them contiguously from 1 in every pinout (4, 14,
  3, 9 and 40 pins), but nothing suggests gaps would be illegal.
- **Aliases.** A pin may be given several equivalent names, chained with `=`:

  ```
  pin 24 = BCM.8 = SPI0.CE0
  pin 3  = BCM.2 = SDA.1 = I2C1.SDA
  ```

  Every alias is equally valid in a connection; the circuit block refers to
  the same header both as `PI.BCM.25` and as `PI.SPI0.CE0`.
- **Repeated names — rail classes.** The same name may be given to *many* pins
  of one pinout. The Raspberry Pi header has eight pins named `0v`, two named
  `5v`, two named `3.3v`. A reference to such a name (`PI.0v`) denotes the
  *class*: all like-named pins are electrically interchangeable (a power/ground
  rail), and a layout tool is free to satisfy the connection with whichever
  pin is convenient. This is the one place where a pin reference does not
  identify a unique physical pin.
- **The `end` tag.** The name after `end` is documentation only — the example
  gets it wrong three times out of five (`pinout PI … end MCP42010`,
  `pinout MCP42010 … end PI`, `pinout PC817 … end PC917`) with no apparent
  consequence. A robust implementation should nevertheless *check* that it
  matches the block name; see errata (§7).

The comments note that "in an automated layout system, these descriptions
would include the physical layout and coordinates of pins etc." — i.e. the
pinout block is the natural extension point for package geometry, but no such
syntax exists in the example.

---

## 4. `package` — instantiating packages

```
package <TypeName> <InstanceName> [ <InstanceName> ... ]
```

Creates one named instance per listed name, all of the given pinout type:

```
package PI PI
package MCP42010 Digipot1 Digipot2
package PC817 Opto1 Opto2 Opto3 Opto4 Opto5 Opto6 Opto7 Opto8
package Trimpot_3386P1_103LF RXHi RXLo RYHi RYLo LXHi LXLo LYHi LYLo
```

- One `package` line may create any number of instances.
- An instance may share its type's name (`package PI PI`) — type names and
  instance names live in separate namespaces.
- Instance names must contain no dots (§5.1).

---

## 5. `circuit` — the connection list

```
circuit <CircuitName>
  <connection> [ ; <connection> ... ]
  ...
end <CircuitName>
```

The body is a list of **connection statements**:

```
<pin-ref> -> <pin-ref>
```

for example:

```
PI.SPI0.SCLK -> Digipot1.SCK
```

### 5.1 Pin references

A pin reference is `Instance.PinName`, resolved by splitting at the **first**
dot: everything before it is the instance, everything after is the pin name —
which may itself contain dots. `PI.SPI0.CE0` is instance `PI`, pin
`SPI0.CE0`. Any alias of the pin may be used. A rail-class name (§3) refers
to any/all of the like-named pins.

### 5.2 Semantics: nets

Electrically a connection statement simply places two pins on the same **net**.
Nets merge transitively: `RightPort.0v` appears in seven statements, all of
which describe one ground net. The complete circuit is the set of nets that
results from taking the union of all connection statements.

The arrow direction carries **no electrical meaning** — it is documentation of
intent. The example consistently writes the *driver/source* on the left and
the *load/sink* on the right:

- power rail → device power pin: `PI.5v -> Digipot1.Vdd`
- output → input: `PI.SPI0.MOSI -> Digipot1.SI`
- wiper out → connector: `Digipot1.PW0 -> RightPort.X`
- current path through an LED: `PI.BCM.25 -> Opto0.Anode ; Opto0.Cathode -> PI.0v`

### 5.3 The `;` separator

A semicolon joins related connections on one line. The example uses it
exclusively for two-hop current paths through a component, which read as a
single gesture:

```
RightPort.B1 -> Opto0.Collector ; Opto0.Emitter -> RightPort.0v
```

### 5.4 Unconnected pins

A pin is left unconnected by simply not mentioning it. The example's
convention for *deliberately* unconnected pins is a comment in the shape of a
connection statement:

```
# Digipot1.SO -> unconnected
```

---

## 6. Grammar (EBNF)

```ebnf
file          = { blank | pinout-block | package-decl | circuit-block } ;

pinout-block  = "pinout" type-name EOL
                { pin-decl }
                "end" name EOL ;                (* name should match, unchecked *)
pin-decl      = "pin" integer "=" pin-name { "=" pin-name } EOL ;

package-decl  = "package" type-name instance-name { instance-name } EOL ;

circuit-block = "circuit" name EOL
                { connection { ";" connection } EOL }
                "end" name EOL ;
connection    = pin-ref "->" pin-ref ;
pin-ref       = instance-name "." pin-name ;    (* split at FIRST dot *)

type-name     = name ;                          (* no dots recommended *)
instance-name = name ;                          (* must contain no dots *)
pin-name      = name ;                          (* dots allowed *)
name          = ? one or more characters other than
                  whitespace, "=", ";", "#" ? ;
integer       = digit { digit } ;
```

A comment (`#` to end of line) and trailing whitespace may follow any line,
including inside blocks.

---

## 7. Errata in the example (and what a checker should catch)

The example was written for human readers ("in the absence of tools to
automate this") and contains errors that a language processor should flag.
They are worth listing because each one implies a useful validation rule:

1. **Mismatched `end` tags** — `pinout PI` ends with `end MCP42010`,
   `pinout MCP42010` ends with `end PI` (swapped), and `pinout PC817` ends
   with `end PC917` (typo). *Rule: `end` tag must equal the block's name.*
2. **Undeclared / unused instances** — the package line declares
   `Opto1`–`Opto8`, but the circuit uses `Opto0`–`Opto7`. `Opto0` is never
   declared; `Opto8` is never used. *Rules: every referenced instance must be
   declared; warn on declared-but-unused instances.*
3. **Copy-paste net errors** — the "X:" sections of both controllers connect
   the *Y* trimpot's wiper where the *X* one is meant:
   `RYLo.Mid -> Digipot1.PA0` (should be `RXLo.Mid`) and
   `LYLo.Mid -> Digipot2.PA0` (should be `LXLo.Mid`). The tell: `RXLo.Mid`
   and `LXLo.Mid` end up connected to nothing while `RYLo.Mid`/`LYLo.Mid`
   drive two digipot terminals each. *Rule: warn on unconnected non-NC pins —
   here it would have caught a real wiring bug.*
4. **Stale comment** — the secondary-controller section repeats the comment
   `# Digipot1.SO -> unconnected` where `Digipot2.SO` is meant. (Comments are
   free text; no rule applies, but it argues for making "unconnected" a real
   statement, e.g. `Digipot2.SO -> unconnected`, so the checker sees it.)

One asymmetry that is probably *not* an error: the Y-axis trimpots are wired
`+5v -> Right`, the X-axis ones `+5v -> Left` — most likely a deliberate
record of physical mounting orientation.

---

## 8. Complete miniature example

Everything in the language, in one small file:

```
# Blink: a GPIO driving an optocoupler LED.

pinout Header                 # package type
  pin 1 = 3.3v
  pin 2 = GPIO.4 = CLK        # aliases
  pin 3 = 0v
  pin 4 = 0v                  # repeated name = rail class
end Header

pinout PC817
  pin 1 = Anode
  pin 2 = Cathode
  pin 3 = Emitter
  pin 4 = Collector
end PC817

package Header HDR            # instances
package PC817 Opto1 Opto2

circuit Blink
  HDR.CLK -> Opto1.Anode ; Opto1.Cathode -> HDR.0v
  # Opto1.Emitter -> unconnected
  # Opto2 is a spare
end Blink
```
