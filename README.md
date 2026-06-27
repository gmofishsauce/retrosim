# retrosim

A full featured digital Simulator including user interface, "slow"(debug) simulator and generator for simulation engine. I know the world has many of these but I'm going to make this one just the way I like it.

retrosim is a localhost-only schematic editor: a JavaScript single-page app
(`web/`) served by a small Go server (`srv/`).

## Features

An incomplete list:

 - logical schematic editor (no power or ground, no resistors or capacitors).
 - 4-state simulator with full support for 3-state busses
 - TTL components mostly described by YAML files using GALasm for behavior (see [doc](specs/galasmManual.txt)).
 - interactive low speed simulator for debugging
 - generates higher speed simulator (C program) for any design.
 - Generate custom RAM, ROM, and 22V10 GAL designs in-app.
 - if you are a Claude user, create YAMLs for additional TTL chips using a Claude skill.
 
## What You Need

To run this program you must be able to pull the repository from Github and build the server using a recent Go compiler. When the server is built correctly it automatically serves the front end, (schematic editor and low speed "debug" simulator0 at [localhost:8137](localhost:8137).

### Windows Support (or lack of it)

This program has been entirely developed and tested on Mac. I have no idea how the build will work on Windows or whether there are portability issues in the code. All the code is written in Java script and Golang, so major issues are not expected. **If you are willing to give this a try it would be greatly appreciated**.

## Building and Running

Requires Go 1.24 or later. Build the server binary:

```sh
cd <your-path>/retrosim
./build-run
```

This produces the `retrosim` executable in the repository root and executes it. You should see something like this:

```
$ ./build-run 
2026/06/26 14:06:49 retrosim: data dir /<your-login>/Documents/retrosim
2026/06/26 14:06:49 retrosim: listening on http://127.0.0.1:8137
```
Now open <http://127.0.0.1:8137> in a
modern desktop Chrome or Firefox to use the editor. By default designs are saved
in `~/Documents/retrosim` on Mac (created if absent). I hope something similar will happen on Windows.

The `build-run` script does both steps — clean-rebuild then run — and forwards
any extra flags to the server.

## Documentation

See the [user manual](docs/user.md) for how to use the editor: building and
running, the canvas selection model, wiring and buses, files, the Refresh
button, the built-in components, and simulation.

## Known Issues

- high speed simulation generator is not yet written.
- test vector support is minimal.
- lots more editing user interface issues

## About 4-State Simulation


This discussion with Claude was captured after the "slow" simulator already existed.

**Author❯** I have a question about retrosim that is strictly for discussion (for now). I
  originally described the Simulator as having four states: 1, 0, U, and Z. But at     the same time I made a component called a "pull up". This implies a weak-1 state.    So does the existing ("slow") simulator Implement more than four states? This will
  become important when we write the generator for the C program or "fast"             simulator. Please discuss.

**Claude>**


⏺ I'll dig into how the slow simulator actually represents and resolves logic values
  before discussing — let me look at the simulation engine and the pull-up component.

  Searched for 3 patterns, read 1 file (ctrl+o to expand)

⏺ Now the pull-up builtin and how weak is produced:

  Searched for 2 patterns, read 1 file (ctrl+o to expand)

⏺ Good question — I dug through the engine, and the short answer is: the net value
  domain is exactly four states; "weak" is not a fifth value. But there is an extra
  dimension hiding in the model, and it lives on drivers, not on nets. That
  distinction is exactly what will matter for the C generator. Let me lay it out.

  What's actually four-state vs. not

  Net values: four, full stop. resolveNet (sim.js:190) only ever returns V0|V1|VU|VZ.
  There is no persisted "weak 1" anywhere. When a pull-up wins an otherwise-undriven
  net, the net resolves to a plain strong V1 — downstream gates reading it (via
  valueOfPin/readNet) cannot tell it apart from a 1 driven by a totem-pole output.
  This matches FR-077 exactly.

  Drivers: more than four. The extra information is the weak flag on each driver
  contribution ({v, weak, label}, sim.js:232–235). So the real driver alphabet is:

  contribution value ∈ {0, 1, U}   ×   strength ∈ {strong, weak}     + "absent" (Z)

  A pull-up is just {value: V1, weak: true} (builtins.js:282); a pull-down is {value:
  V0, weak: true}. Everything else (GAL outputs, switches) contributes weak: false.
  A tristated/unconnected output contributes nothing — add drops VZ (sim.js:234), so
  Z is "no contribution," not a value in the resolution pool.

  The resolution is tiered, and that's the real semantics

  resolveNet does a two-tier reduction (sim.js:190–215):

  1. Strong tier first. pool = strong.length ? strong : contribs. If any strong
  driver is present, the weak ones are discarded wholesale and never consulted.
  2. Within the chosen tier: agree → that value; 0 and 1 both present → conflict → U
  (reported, FR-082); any U present (and no 0/1 clash) → U.
  3. Empty pool → Z.

  So the "weak-1 state" you intuited is real, but it exists only transiently, inside
  the resolver, as a lower-priority tier — it collapses to one of the four net values
  before anyone reads it.

  Why this matters for the [future - jjb] fast/C generator

  FR-107 requires the C engine to agree with the slow engine on every net,
  bit-for-bit ("an optimization, not a different semantics"). So the generator can't
  just store 2-bit net values and combine them with the AND/OR pessimism rules — it
  must replicate the tiered resolution. Concretely:

  - Storage: 2 bits per net for the resolved value is enough. You do not need a fifth
  code.
  - But the combine step needs strength. You can't reduce a net with a single flat
  fold over four-state values. Each net needs, per step, something like two
  accumulators — a strong-tier result and a weak-tier result, each in {none, 0, 1, U}
  — then: strong != none ? strong : (weak != none ? weak : Z). That's the part
  people get wrong if they think "four states" means "four-state arithmetic is
  sufficient."
  - Three non-obvious rules to bake in:
    a. "Strong present" is judged by presence of a non-Z strong contribution,
  regardless of its value. A strong driver whose value is U (e.g. a tristate output
  with an uncertain enable — evalOutput returns VU, "pessimistic U not Z,"
  galasm.js:402) still counts as strong and therefore suppresses the pull-up,
  yielding U. So "pull-up + maybe-enabled-output" → U, not 1.
    b. Strong-vs-weak is never a conflict. Pull-up + strong 0 → silently 0 (real
  hardware agrees: the pull-up just loses). No red wire.
    c. Weak-vs-weak is a conflict. Pull-up + pull-down with no strong driver → U +
  conflict report (FR-083 → FR-082). So conflict detection has to run inside
  whichever tier decides, not globally.
  - Two-phase timing is also part of the contract. The slow sim evaluates all drivers
  against curr, resolves into next, then swaps (unit-delay, FR-078, sim.js:252–257).
  The fast sim has to reproduce that, or it won't agree on glitchy/oscillating nets.

  Suggested framing for the spec/generator

  I'd resist adding a fifth value. The cleaner mental model — and I think worth
  stating explicitly in the design doc before we write the generator — is:

  ▎ A net carries one of four values. A driver carries a value in {0,1,U} and a
  
  ▎ strength in {strong, weak}; "Z" denotes the absence of a drive. Net resolution is
  
  ▎ a strength-priority reduction: resolve the strong drivers if any are present,
  
  ▎ else the weak drivers, else Z; report a 0-vs-1 disagreement within the deciding
  
  ▎ tier as a conflict (U).

  That keeps FR-077/FR-107's "four states" honest while making the strength tier —
  the thing your pull-up needs — a first-class, explicitly-specified part of the
  resolver that the C codegen must implement.

  One thing I'd flag as worth pinning down now, since it's currently only implicit in
  the JS: the strong-U-suppresses-weak rule (point 1 above). It's a real semantic
  decision, it's not written in any FR, and the C generator author would have to
  reverse-engineer it from resolveNet. Want me to look at whether FR-083 should be
  tightened to state it explicitly? (Discussion only — I won't touch anything yet.)
  
  I did update FR-083.




