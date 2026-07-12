# Proposed Enhancements for CPU Simulation

An assessment (2026-07-10, Claude Fable 5) of features that would make the
simulator easier, faster, and more likely to succeed at its real goal:
simulating hobbyist TTL CPUs. Based on a review of `specs/requirements.md`,
`specs/design.md`, the vision documents, and the notes folder (in particular
`specs/ai-open.md` and `notes/missed-components.md`).

None of these are approved requirements. If adopted, each should be folded
into `requirements.md`/`design.md` per the normal change process (new suffixed
FRs, CHANGELOG entry) before implementation.

## Where the app stands

The foundation for CPU work is genuinely strong: four-state simulation with
weak drivers and conflict detection (FR-077–FR-083a), hierarchy
(§3.22), sequential test vectors with scripted clocks and bidirectional bus
columns (§3.19a), RAM/ROM devices with runtime-loaded contents and persistence
(§3.17a), a parity-checked fast C engine with VCD output (§3.23), and the
extended GALasm dialect — XOR, per-output clocks, buried nodes
(FR-079a/FR-079c) — that unlocked most of the parts in
`notes/missed-components.md`.

What's missing is almost entirely on the **debugging and program-development
side** — the things a designer spends 90% of their time on once a CPU is
wired up and doesn't work.

## Suggestions, roughly in priority order

### 1. Simulation stepping and pause control (slow simulator)

Today the interactive run is Run/Stop with wall-clock pacing (FR-084/FR-086).
Debugging a CPU means asking "what happens on *this* clock edge?" Add:

- a **Pause** button,
- **Step one clock cycle**,
- **Step one unit**,
- ideally "run N cycles then pause."

This is cheap — the engine is already deterministic and double-buffered
(FR-078) — and it converts the live canvas from a demo into a debugger.
Nothing else pays off as fast.

### 2. Breakpoints / watch conditions

"Pause when net X goes 0→1", "pause when the ADDR bus equals 0xFFFC", "pause
on any write to RAM location N." Even a single condition slot lets the user
fast-forward a CPU to the interesting cycle instead of watching indicators
blink. Composes directly with #1.

### 3. An in-app trace viewer (logic-analyzer panel)

VCD exists only in the generated C engine (`--vcd`, FR-118). The docked-panel
idiom from test vectors (FR-115b) is the natural home for a waveform strip:
record the observable set (or user-picked nets) during a slow run, draw the
last few hundred cycles.

The cheaper 80% version: **VCD export from the slow simulator**, letting the
user open GTKWave. When a counter misbehaves on cycle 40,000, indicators
can't tell you; a trace can.

### 4. Memory inspector

A panel to view (hex dump) RAM/ROM contents live during a run, and edit RAM
while paused. For CPU bring-up this is as important as waveforms — the
designer is watching the stack, the zero page, the output buffer. The data
already sits in the mem built-in's state (FR-114d); this is pure UI.

### 5. "Why is this net U?" provenance

CPUs power up as a sea of U, and one uninitialized register that never clears
poisons everything downstream. A click action while paused — "trace this U
back to its sources" — walking the driver graph to the originating
register/pin would save hours per incident. No other tool class does this
well; it's a virtue unique to the four-state design (`sim-vision.md` already
makes exactly this argument about displaying U at all).

### 6. Program-development workflow (the assembler gap)

A CPU without programs is furniture, and today getting a program into a ROM
means producing `.bin`/`.hex` by hand elsewhere (FR-114e). Two options, both
partitioned by design:

- **Pre-run build hook.** An optional per-ROM "command" property (e.g.
  `customasm prog.asm -o prog.bin`) that the server runs before Run /
  vector-run, surfacing errors in the message tray. Keeps assemblers external
  (customasm is the de facto retro-hobbyist choice) and costs almost nothing.
- **Microcode compiler.** A small text format (field names → bit positions,
  one line per micro-op) compiled to ROM images. Hand-editing microcode as
  hex is the single most error-prone activity in TTL CPU building; even a
  minimal field compiler is a killer feature for this audience.

### 7. Server-side compile-and-run for the fast engine

FR-116 defers this deliberately, but for CPU-scale runs (millions of cycles)
the fast engine is the real simulator, and "generate, switch to terminal,
`cc`, run, read stdout" is friction paid dozens of times a day. A **Generate
& Run** action that compiles server-side and streams the transcript/VCD back
closes the loop.

### 8. Library gaps that matter specifically for CPUs

- **74181 ALU** (+ **74182** carry lookahead) — now expressible thanks to the
  extended dialect's XOR operator (FR-079a).
- **74189/74219** 16×4 register-file RAMs — or document "use the mem
  generator" as the intended path.
- The remaining structural limitation from `notes/missed-components.md`:
  **complementary Q//Q outputs on separate pins** (74151, 74175), which the
  buried-nodes work (FR-079c) did not address.
- A **hex bus probe** built-in — an indicator that snaps to a bus and shows
  its value in hex; reading a 16-bit address off 16 LEDs gets old
  immediately. Perhaps also a seven-segment display, for morale.

### 9. Static timing analysis (later, but cheap and unique)

FR-064 delay metadata exists and nothing consumes it. A report — longest
combinational path per clock domain, hence maximum clock frequency — is a
DAG longest-path computation over data the YAML files already carry, and
answers the question every homebrew CPU builder eventually asks: "how fast
can I clock this?"

## The AI partition

The instinct in `specs/ai-open.md` is right and should be elevated to a
principle: **the app never calls an AI; AI is just another client of the
app's public, text-based interfaces.** That gives the subscription partition
for free — no degraded mode, nothing to toggle, people without AI access use
the exact same app. Concretely:

- **Adopt the netlist-import endpoint** (`POST /api/v1/design/from-netlist`,
  already sketched in `ai-open.md`), or equivalently an **NDL importer** to
  mirror the FR-119a exporter. NDL is nearly ideal as an AI target:
  line-oriented, geometry-free, human-auditable, and the spec and validation
  rules are already written (`docs/netlist-language.md`). An AI — or a human
  with a text editor, or a script — writes connectivity; the app auto-places
  a rat's nest; a human routes it. The structured validation report in that
  proposal is the crucial part: it lets an AI iterate without a browser.
- **Ship an optional MCP server or CLI** (separate binary, or a flag on the
  existing server) exposing: import netlist, load/save design, run test
  vectors and return results, read the message tray. That turns an agent
  like Claude Code into a design partner — "here are the failing vectors,
  fix the netlist" loops — while the core app stays 100% AI-free. The
  `make-yaml-from-datasheet` skill is already this pattern: the AI lives in
  the agent tooling; the app only ever sees YAML.
- **AI-generated test vectors** fall out for free once vectors are drivable
  via API: the `.tv` format is JSON (§7.7), so "write vectors for a 4-bit
  ALU" is a pure text task any client can perform.

## If only three

**Stepping/pause (#1)**, **the trace viewer or slow-sim VCD (#3)**, and
**the netlist import endpoint** — the first two because debugging is where
CPU projects die, the last because it's small, already half-designed in
`ai-open.md`, and it's the door every AI feature walks through later.
