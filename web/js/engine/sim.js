// Slow-simulator engine core (§6.13, FR-075–FR-086): compile-on-Run and the
// unit step. Unit-delay model (FR-078): 1 unit = 1 simulated ns; every step,
// all components compute from the previous step's net values (`curr`) into
// `next`, then the buffers swap — outputs respond exactly one unit after
// inputs, independent of evaluation order. The scheduler and Run/Stop UI
// wiring live in a separate layer (§6.13 createSim).

import {
  compileBehavior,
  evalOutput,
  snapshotFeedback,
  updateRegisters,
  updateLatches,
  V0,
  V1,
  VU,
  VZ,
} from "./galasm.js";
import { buildNets } from "../model/netlist.js";
import { debugPorts, flatten } from "../model/subdesign.js";
import { designDefinitionErrors, definitionErrorsMessage, hasEquations } from "./galerrors.js";
import { BEHAVIORS } from "../builtins.js";
import { createMemoryCore, parseRomBytes } from "./memory.js";
import { createUartCore } from "./uart.js";
import { readRomFile, writeRamFile, loadDesign } from "../api.js";
import { setAppState, postMessage, clearMessage } from "../chrome/statusbar.js";

// SETTLE_BOUND is the combinational settling bound (FR-085).
export const SETTLE_BOUND = 10000;

// Hierarchical-prefix tolerant (FR-102, §6.14): a flattened child's subunit
// `X1/U3A` groups under the full prefixed stem `X1/U3`, so a package never
// groups across sub-design instances.
const SUBUNIT_PKG_RE = /^((?:.*\/)?U\d+)[A-Z]$/;

// effectiveProps merges a type's declared property defaults with the
// instance's overrides (FR-020b).
function effectiveProps(inst) {
  const props = {};
  for (const p of inst.typeData.properties ?? []) {
    props[p.name] = inst.overrides?.props?.[p.name] ?? p.default;
  }
  return props;
}

// buildSimulation compiles the design into a steppable simulation (§6.13).
// Throws Error on a preflight failure (behavior parse error, .R without
// clock:); posts non-fatal start-up reports (behavior-less types, FR-080)
// via onMessage. The returned object:
//   step()                   advance one unit (1 simulated ns)
//   simTime()                units stepped so far
//   lastStepChanged()        false once settled (no net changed, FR-085)
//   valueOfPin(refdes, pin)  V0|V1|VU|VZ (VZ for unconnected pins)
//   conflictedConductors()   Set of wire/bus ids on conflicted nets (FR-082)
//   hasClocks()              sequential (FR-086) vs combinational (FR-085)
//   unitsPerSecond()         pacing rate: max period × speed over clocks (FR-084)
//   setStimulus(entries)     replace the external stimulus list between steps
//
// `onConsole(byte)` (FR-122b) is the magic UART's standard-output sink: each
// qualified rising clock edge emits one latched byte here. Defaults to a no-op;
// the live editor run routes it to the Console panel (§6.20).
//
// `scriptedClocks` (FR-115e): suppress the time-based built-in behaviors — the
// clock's simTime square wave (FR-084) and the power-on reset's simTime window
// (FR-071b) — so the caller (the sequential vector runner, §6.16) owns those
// nets, driving them through the stimulus mechanism as scripted levels. The
// live editor run never passes it.
//
// `liveInputs(refdes) → instLike | undefined` (FR-087a) resolves an interactive
// built-in's RUN-TIME state: a click during a run records a copy of the instance
// in the store's sim view instead of writing the design (§6.10 setLiveInput), so
// each step reads the copy when there is one and the saved instance otherwise.
// Only the live editor run passes it; the vector runner and the parity harness
// read the instances, since a vector row and a generated program both start from
// the design as authored.
export function buildSimulation(
  design,
  { onMessage = () => {}, onConsole = () => {}, romContent = null, ramContent = null, stimulus = [], scriptedClocks = false, liveInputs = null } = {},
) {
  const nets = buildNets(design, onMessage);

  // (refdes, pin) → net index.
  const netOfPin = new Map();
  nets.forEach((net, i) => {
    for (const pin of net.pins) netOfPin.set(pin, i);
  });

  // Conductor lane ("wire:<id>" / "bus:<id>:<bit>", §6.6) → net index, the
  // conductor analogue of netOfPin. It is what lets the probe (FR-087c) read a
  // wire or one bit of a bus, which pin-keyed lookup alone cannot reach — and it
  // must key on lanes, not net.members: a bus id in `members` can span several
  // nets (one per bit), while each lane belongs to exactly one.
  const netOfLane = new Map();
  nets.forEach((net, i) => {
    for (const lane of net.lanes) netOfLane.set(lane, i);
  });

  // Single-node nets for unconnected pins (FR-081a). buildNets is a netlist
  // builder: it emits a net only where a conductor exists, so a pin nothing is
  // wired to is on no net at all. Top the array up here — in the engine, not in
  // buildNets, whose result is also saved (§7.2) and exported (§6.18), where a
  // net for an unconnected pin would be wrong. An unconnected output then drives
  // its own net and reads as its value (the probe, FR-087c; behavior feedback,
  // FR-079) instead of Z; an unconnected input's net has no contribution and
  // resolves to Z, exactly as the no-net path returned. Empty members/lanes keep
  // these nets out of conflictedConductors and unreachable by valueOfLane.
  for (const inst of design.components) {
    for (const p of inst.typeData?.pins ?? []) {
      const key = `${inst.refdes}.${p.name}`;
      if (netOfPin.has(key)) continue;
      netOfPin.set(key, nets.length);
      nets.push({ pins: [key], members: [], lanes: [] });
    }
  }

  // Sub-design interface pins (FR-087c, §6.14). flatten replaced each embedded
  // instance with its contents, so `X1.FTAB` names no component here — yet that
  // is exactly how the probe knows the pin, because X1 is what the user sees on
  // the sheet. flatten left the stitch behind in `pinAliases`; alias each entry
  // onto the net its child port joined, so valueOfPin answers for an interface
  // pin with the value on the wire attached to it. Aliases only ever ADD keys:
  // a real pin of that name (a peer sheet tagged like an X-refdes) keeps its own
  // net. Reading through the alias costs nothing at step time — this runs once,
  // at build.
  for (const [alias, real] of design.pinAliases ?? []) {
    if (netOfPin.has(alias)) continue;
    const n = netOfPin.get(real);
    if (n !== undefined) netOfPin.set(alias, n);
  }

  // --- Build evaluation entities ---
  const entities = [];
  const errors = [];
  const compileCache = new Map(); // type name → CompiledBehavior|null
  const reportedNoBehavior = new Set();
  const packages = new Map(); // shared U-number → [subunit insts]

  function compiled(typeName, typeData) {
    if (!compileCache.has(typeName)) {
      try {
        compileCache.set(typeName, compileBehavior(typeData));
      } catch (e) {
        errors.push(e.message);
        compileCache.set(typeName, null);
      }
    }
    return compileCache.get(typeName);
  }

  // makeGalasmEntity wraps one compiled behavior over one or more sibling
  // instances. `pins` is the union of the siblings' pins; pinOwner maps each
  // signal to the sibling refdes + YAML pin name that owns it (§6.13).
  function makeGalasmEntity(typeName, insts, pins) {
    // Carry `gal` so a GAL part's behavior is strict-validated at Run (FR-079b);
    // absent on 74-series, so they stay in the extended dialect (FR-079a).
    const td0 = insts[0].typeData;
    const typeData = {
      name: typeName,
      pins,
      // A block of nothing but comments is no behavior (FR-080), not a block
      // that fails to compile with "no equations found".
      behavior: hasEquations(td0.behavior) ? td0.behavior : "",
      gal: td0.gal,
      internal: td0.internal, // buried registered nodes (FR-079c)
    };
    const c = compiled(typeName, typeData);
    // c === null means either no behavior block (report once, FR-080) or a
    // parse error (already in `errors`; preflight will refuse to start).
    if (c === null && !typeData.behavior && !reportedNoBehavior.has(typeName)) {
      reportedNoBehavior.add(typeName);
      onMessage(`${typeName}: no behavior defined; its outputs are U (FR-080)`);
    }

    const pinOwner = new Map(); // signal → "refdes.pinName" net key
    // Output-capable pins driving U (FR-080): every one of a behavior-less type,
    // and each output pin of a GAL part that its behavior writes no equation for
    // — logic not yet written is unknown, not undriven.
    const uPins = [];
    const written = new Set((c?.outputs ?? []).map((o) => o.signal));
    const unwritten = [];
    for (const inst of insts) {
      for (const p of inst.typeData.pins) {
        const signal = p.name.startsWith("/") ? p.name.slice(1) : p.name;
        pinOwner.set(signal, `${inst.refdes}.${p.name}`);
        if (p.direction === "in") continue;
        if (c === null) {
          uPins.push(`${inst.refdes}.${p.name}`);
        } else if (td0.gal && !written.has(signal)) {
          uPins.push(`${inst.refdes}.${p.name}`);
          if (!unwritten.includes(p.name)) unwritten.push(p.name);
        }
      }
    }
    if (unwritten.length && !reportedNoBehavior.has(typeName)) {
      reportedNoBehavior.add(typeName);
      onMessage(`${typeName}: no equation for ${unwritten.join(", ")}; ${unwritten.length === 1 ? "it is" : "they are"} U (FR-080)`);
    }

    // Buried registered nodes (FR-079c): realize each as a driver-less virtual
    // net appended to the net array. curr/next, contribs, the resolve loop, and
    // changed-detection are all sized/indexed off nets.length, so the virtual net
    // rides along for free and inherits the one-unit-delay, four-state model. Its
    // synthetic key carries '#', so it matches no real (refdes,pin) query
    // (valueOfPin) and its empty members keep it out of conflictedConductors —
    // buried state stays invisible.
    for (const node of td0.internal ?? []) {
      const key = `${insts[0].refdes}.#${node}`;
      netOfPin.set(key, nets.length);
      nets.push({ pins: [], members: [], lanes: [] });
      pinOwner.set(node, key);
    }

    // Registered-output feedback snapshot (FR-079e): signal → the value that
    // output's macrocell presents, refilled by snapshotFeedback at the top of
    // every step. readNet answers from it ahead of the net, so a literal naming
    // one of this instance's own .R outputs reads the flip-flop rather than the
    // pin — the register then holds through tri-state.
    const fb = new Map();

    const e = {
      kind: "galasm",
      compiled: c,
      registers: new Map(),
      fb,
      prevClock: VU,
      clockNet: undefined,
      clockPrev: new Map(), // per-output .CLK previous values (FR-079a edge detection)
      pinOwner,
      uPins,
      readNet(signal) {
        if (fb.has(signal)) return fb.get(signal);
        const n = netOfPin.get(pinOwner.get(signal));
        return n === undefined ? VZ : curr[n];
      },
    };

    if (c) {
      // A .R output without its own .CLK uses the global clock: pin (FR-062d);
      // one carrying a .CLK is self-clocked (FR-079a) and needs no global clock.
      let needsGlobalClock = false;
      for (const out of c.outputs) {
        if (out.kind === "R") {
          e.registers.set(out.signal, VU); // power-up U (FR-079)
          if (!out.clk) needsGlobalClock = true;
        } else if (out.kind === "L") {
          // Transparent-latch store shares the registers map, powers up U, and
          // is level-gated — never needs a global clock (FR-079d).
          e.registers.set(out.signal, VU);
        }
      }
      if (needsGlobalClock) {
        const clockPin = insts[0].typeData.clock;
        if (!clockPin) {
          errors.push(`${typeName}: behavior uses .R but the type declares no clock: pin (FR-062d)`);
        } else {
          const owner = insts.find((i) => i.typeData.pins.some((p) => p.name === clockPin));
          e.clockNet = netOfPin.get(`${owner?.refdes}.${clockPin}`);
        }
      }
    }
    entities.push(e);
  }

  // makeMemoryEntity wraps a generated RAM/ROM (FR-114c/FR-114d) over its pure
  // behavior core (memory.js). The core reads input pins via `read`, which —
  // like the galasm readNet — returns the previous step's net value (curr), so
  // outputs follow inputs by one unit (FR-078). `w` is cached for the drive loop.
  function makeMemoryEntity(inst) {
    const refdes = inst.refdes;
    const mem = inst.typeData.mem;
    const read = (pinName) => {
      const n = netOfPin.get(`${refdes}.${pinName}`);
      return n === undefined ? VZ : curr[n];
    };
    const core = createMemoryCore(mem);
    // Seed a ROM's content (FR-114e), or a load-on-start RAM's saved content
    // (FR-114g), from the bytes fetched at Run; an unseeded RAM/ROM starts all-U.
    let seedBytes = null;
    let seedLabel = "ROM";
    if (mem.kind === "rom" && mem.romFile && romContent?.has(mem.romFile)) {
      seedBytes = romContent.get(mem.romFile);
    } else if (mem.kind === "ram" && mem.ramLoad && mem.ramFile && ramContent?.has(mem.ramFile)) {
      seedBytes = ramContent.get(mem.ramFile);
      seedLabel = "RAM save";
    }
    if (seedBytes) {
      const info = core.loadBytes(seedBytes);
      if (info.truncated) {
        onMessage(
          `${refdes}: ${seedLabel} file has ${info.fileWords} words, exceeding the device's ${info.capacity}; extra ignored`,
        );
      }
    }
    // A RAM with a save-file path is written back on Stop (FR-114g); carry the
    // path so createSim.stop() can dump the core. null for a ROM or an unsaved RAM.
    const ramFile = mem.kind === "ram" ? mem.ramFile || null : null;
    return { kind: "memory", refdes, w: mem.dataWidth, core, read, ramFile };
  }

  // makeUartEntity wraps a magic UART (FR-122b) over its pure behavior core
  // (uart.js). The core reads input pins via `read`, which — like the memory
  // entity's — returns the previous step's net value (curr), so it sees inputs
  // by one unit (FR-078). The UART drives no nets, so the entity carries no `w`
  // and deposits no contributions; it only emits bytes in the latch phase.
  function makeUartEntity(inst) {
    const refdes = inst.refdes;
    const read = (pinName) => {
      const n = netOfPin.get(`${refdes}.${pinName}`);
      return n === undefined ? VZ : curr[n];
    };
    return { kind: "uart", refdes, core: createUartCore(), read };
  }

  // makePassEntity wraps a switch element (transmission gate / relay,
  // FR-071g/FR-071h) as a kind:"pass" entity (§6.13, FR-083a). Unlike every
  // other entity it deposits no contributions: it carries only its control net
  // index and a list of contact records {a, b, closedWhen} over terminal net
  // indices, which the step loop turns into a per-step net merge. An unwired
  // terminal or control resolves to `undefined` (no net) and is handled in the
  // resolve phase (an unwired SPST throw simply never joins; an unwired control
  // reads Z→U and forces its terminals U).
  function makePassEntity(inst) {
    const refdes = inst.refdes;
    const netFor = (pin) => netOfPin.get(`${refdes}.${pin}`);
    if (inst.typeData.renderType === "tgate") {
      return {
        kind: "pass",
        refdes,
        control: netFor("EN"),
        contacts: [{ a: netFor("A"), b: netFor("B"), closedWhen: V1 }],
      };
    }
    // relay (FR-071h): SPDT changeover — COM–NO closed when energized, COM–NC
    // closed when released (complementary by construction).
    const com = netFor("COM");
    return {
      kind: "pass",
      refdes,
      control: netFor("COIL"),
      contacts: [
        { a: com, b: netFor("NO"), closedWhen: V1 },
        { a: com, b: netFor("NCC"), closedWhen: V0 },
      ],
    };
  }

  for (const inst of design.components) {
    if (inst.typeData.mem) {
      // A generated memory device (FR-114c) is not a `builtin` (so it keeps a
      // U-series refdes and the IC render), but its behavior is built-in, not
      // GALasm: route it to a dedicated memory entity rather than the galasm path.
      entities.push(makeMemoryEntity(inst));
    } else if (inst.typeData.builtin) {
      // A text note (FR-071f) is a pure annotation with no pins and no behavior;
      // it is not a simulation entity, so skip it rather than flagging it unknown.
      if (inst.typeData.renderType === "note") continue;
      // Switch elements (FR-071g/FR-071h) drive nothing; they merge nets instead
      // of depositing contributions, so they route to a pass entity (FR-083a),
      // not the BEHAVIORS source-drive path (they have no BEHAVIORS entry).
      if (inst.typeData.renderType === "tgate" || inst.typeData.renderType === "relay") {
        entities.push(makePassEntity(inst));
        continue;
      }
      // The magic UART (FR-122b) reads input nets and keeps state, so it routes
      // to a dedicated uart entity over the uart.js core rather than the
      // BEHAVIORS source-drive path (it has no BEHAVIORS entry and drives nothing).
      if (inst.typeData.renderType === "uart") {
        entities.push(makeUartEntity(inst));
        continue;
      }
      const behave = BEHAVIORS[inst.type];
      if (!behave) {
        errors.push(`${inst.refdes}: unknown built-in type ${inst.type}`);
        continue;
      }
      entities.push({
        kind: "builtin",
        refdes: inst.refdes,
        type: inst.type,
        // Input-net accessor for the behaviors that READ as well as drive (the
        // labeled decoder, FR-071k). Like the memory and UART entities' `read`
        // it answers from `curr` — the PREVIOUS step's net values — so such a
        // built-in's outputs follow its inputs by the standard one unit
        // (FR-078), and an unwired pin reads Z (→U through the term rules).
        read: (pinName) => {
          const n = netOfPin.get(`${inst.refdes}.${pinName}`);
          return n === undefined ? VZ : curr[n];
        },
        // renderType (e.g. "clock") for built-in identification independent of
        // the now-id-valued `type` (FR-066e).
        renderType: inst.typeData.renderType,
        behave,
        props: effectiveProps(inst),
        // Retain the live instance so behaviors can read mutable interactive
        // state each step (the switch's state, FR-087a/§6.13).
        inst,
      });
    } else if (inst.typeData.renderType === "subunit") {
      const m = SUBUNIT_PKG_RE.exec(inst.refdes);
      const key = m ? m[1] : inst.refdes;
      if (!packages.has(key)) packages.set(key, []);
      packages.get(key).push(inst);
    } else {
      makeGalasmEntity(inst.type, [inst], inst.typeData.pins);
    }
  }
  for (const insts of packages.values()) {
    makeGalasmEntity(insts[0].type, insts, insts.flatMap((i) => i.typeData.pins));
  }

  if (errors.length) throw new Error(errors.join("; "));

  // Switch elements (FR-083a): when none are placed the resolve phase runs per
  // net exactly as before (no union-find, zero cost for ordinary designs).
  const passEntities = entities.filter((e) => e.kind === "pass");

  // --- Mutable state ---
  let curr = new Uint8Array(nets.length).fill(VZ);
  let next = new Uint8Array(nets.length);
  let simTime = 0;
  let lastStepChanged = true;
  const conflictedNets = new Set();

  // View-mode sampling (FR-087d). `viewPeriod` is the primary clock's effective
  // period while view mode is on, else null; `sampled` holds the net values
  // captured at the unit step just before that clock's rising edge — the values
  // a registered input sees at the edge (FR-078). Sampling from inside step()
  // rather than from its callers is what makes the paced loop and STEP sample
  // identically. `speedCap` is view mode's 1 Hz pacing cap, applied in
  // unitsPerSecond so it can never reach the clock instances or the waveform.
  let viewPeriod = null;
  let sampled = null;
  let speedCap = null;

  function sampleView() {
    sampled = curr.slice();
  }

  // resolveNet implements FR-081–FR-083: enabled strong drivers win; weak
  // (pull-up/pull-down) contributions resolve only when no strong driver is
  // enabled; 0-vs-1 disagreement is a conflict → U, flagged and reported on
  // onset (FR-082); any U among the deciding drivers → U; none at all → Z.
  function resolveNet(i, contribs) {
    const strong = contribs.filter((c) => !c.weak);
    const pool = strong.length ? strong : contribs;
    if (pool.length === 0) {
      conflictedNets.delete(i);
      return VZ;
    }
    let zero = null;
    let one = null;
    let anyU = false;
    for (const c of pool) {
      if (c.v === V0) zero = c;
      else if (c.v === V1) one = c;
      else anyU = true;
    }
    if (zero && one) {
      if (!conflictedNets.has(i)) {
        conflictedNets.add(i);
        onMessage(`bus conflict: ${one.label} vs ${zero.label}`);
      }
      return VU;
    }
    conflictedNets.delete(i);
    if (anyU) return VU;
    return one ? V1 : V0;
  }

  // step advances one unit (FR-078): (1) latch .R registers on a strict 0→1
  // of each entity's clock net (FR-079); (2) evaluate every driver of every
  // net against curr (FR-081); (3) resolve into next; (4) swap.
  function step() {
    // View mode (FR-087d): capture the pre-edge state of every net at the
    // evaluation time of the primary clock's rising edge (the FR-084 waveform
    // rises where t % period === floor(period / 2)). Taken BEFORE this step
    // evaluates, so `curr` still holds the values the edge is about to latch.
    if (viewPeriod !== null && simTime % viewPeriod === Math.floor(viewPeriod / 2)) sampleView();
    for (const e of entities) {
      if (e.kind !== "galasm" || e.registers.size === 0) continue;
      // Global clock edge (for .R outputs without their own .CLK); per-output
      // .CLK edges are detected inside updateRegisters against e.clockPrev.
      const cur = e.clockNet === undefined ? VZ : curr[e.clockNet];
      const globalRose = e.prevClock === V0 && cur === V1;
      // Feedback snapshot first (FR-079e): both this phase and the drive phase
      // below read the instance's .R outputs from it, so they see the register
      // as of the end of the previous step — pre-edge here, and identical to
      // what the pin's net would have carried.
      snapshotFeedback(e.compiled, e.registers, e.fb);
      updateRegisters(e.compiled, e.readNet, e.registers, globalRose, e.clockPrev);
      // Transparent latches (FR-079d) update level-sensitively in the same
      // phase — no edge, so independent of the clock comparison above.
      updateLatches(e.compiled, e.readNet, e.registers);
      e.prevClock = cur;
    }
    // Memory writes (RAM WE/ rising edge, FR-114d) latch from curr too, alongside
    // register latching, before any contribution is evaluated. Magic UARTs latch
    // and emit on their CLK rising edge in the same phase (FR-122b), in entity
    // order (deterministic interleave across UARTs, for stable parity, §6.20).
    for (const e of entities) {
      if (e.kind === "memory") e.core.writeStep(e.read);
      else if (e.kind === "uart") e.core.clockStep(e.read, onConsole);
    }

    const contribs = nets.map(() => []);
    const add = (netKey, v, weak, label) => {
      const n = netOfPin.get(netKey);
      if (n !== undefined && v !== VZ) contribs[n].push({ v, weak, label });
    };
    for (const e of entities) {
      if (e.kind === "pass") {
        // Switch elements deposit no contributions — they merge nets in the
        // resolve phase instead (FR-083a).
        continue;
      }
      if (e.kind === "uart") {
        // The magic UART drives no nets (FR-122b); it emitted in the latch phase.
        continue;
      }
      if (e.kind === "builtin") {
        // Scripted-clock mode (FR-115e): the clock and reset built-ins' simTime-
        // based behaviors are suppressed; the caller drives their nets via the
        // stimulus list instead.
        if (scriptedClocks && (e.renderType === "clock" || e.renderType === "reset")) continue;
        // `state` is the EFFECTIVE interactive state (FR-087a): the run-time
        // copy a sim-time click produced, else the instance's saved setting.
        // `drive` (FR-094g) comes from the run-time copy ALONE — no fallback to
        // the instance, unlike `state`, because a port's debug drive is never
        // part of the design. A caller that passes no accessor (the vector
        // runner, the parity harness) therefore sees every port undriven no
        // matter what its instances carry, which is what those runs require.
        const live = liveInputs?.(e.refdes);
        const src = live ?? e.inst;
        const ctx = {
          props: e.props,
          simTime,
          clockPeriod,
          state: src.switchState,
          drive: live?.portDrive,
          read: e.read,
        };
        for (const c of e.behave(ctx)) {
          add(`${e.refdes}.${c.pin}`, c.value, !!c.weak, `${e.refdes}.${c.pin}`);
        }
      } else if (e.kind === "memory") {
        // Drive the data bus per the read/enable logic (FR-114d): a w-length
        // array of values, or null for high-impedance (drive nothing).
        const drive = e.core.dataDrive(e.read);
        if (drive) {
          for (let i = 0; i < e.w; i++) {
            add(`${e.refdes}.D${i}`, drive[i], false, `${e.refdes}.D${i}`);
          }
        }
      } else {
        if (e.compiled) {
          for (const out of e.compiled.outputs) {
            const key = e.pinOwner.get(out.signal);
            add(key, evalOutput(out, e.readNet, e.registers), false, key);
          }
        }
        for (const key of e.uPins) add(key, VU, false, key); // FR-080
      }
    }
    // External stimulus (FR-115f): strong-drive named nets by (refdes, pin)
    // with no placed component, e.g. a test-vector input port.
    for (const s of stimulus) {
      const key = `${s.refdes}.${s.pin}`;
      add(key, s.value, false, key);
    }

    let changed = false;
    if (passEntities.length === 0) {
      // No switch elements: resolve each net independently (FR-081–FR-083).
      for (let i = 0; i < nets.length; i++) {
        next[i] = resolveNet(i, contribs[i]);
        if (next[i] !== curr[i]) changed = true;
      }
    } else {
      // Switch elements (FR-083a): closed contacts merge their terminal nets for
      // this step. Read each control from curr (Z/undefined → U, preserving the
      // one-unit control-to-contact delay), union the nets joined by matching
      // closed contacts, and collect the terminals of U-position switches to
      // force U afterward.
      const parent = new Int32Array(nets.length);
      for (let i = 0; i < nets.length; i++) parent[i] = i;
      const find = (x) => {
        let r = x;
        while (parent[r] !== r) r = parent[r];
        while (parent[x] !== r) {
          const nx = parent[x];
          parent[x] = r;
          x = nx;
        }
        return r;
      };
      const union = (a, b) => {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent[ra] = rb;
      };
      const forceU = new Set();
      for (const e of passEntities) {
        const ctrl =
          e.control === undefined ? VU : curr[e.control] === VZ ? VU : curr[e.control];
        for (const c of e.contacts) {
          if (c.a === undefined || c.b === undefined) continue; // unwired throw
          if (ctrl === VU) {
            forceU.add(c.a);
            forceU.add(c.b);
          } else if (ctrl === c.closedWhen) {
            union(c.a, c.b);
          }
        }
      }
      // Bucket every net's contributions by its group root, then resolve once per
      // group and write the result to every member (FR-083a): strength tiers,
      // conflicts, and weak-pull rules apply across a closed contact for free.
      const membersByRoot = new Map();
      const contribsByRoot = new Map();
      for (let i = 0; i < nets.length; i++) {
        const r = find(i);
        if (!membersByRoot.has(r)) {
          membersByRoot.set(r, []);
          contribsByRoot.set(r, []);
        }
        membersByRoot.get(r).push(i);
        for (const c of contribs[i]) contribsByRoot.get(r).push(c);
      }
      for (const [r, members] of membersByRoot) {
        let val = resolveNet(r, contribsByRoot.get(r));
        // A U-position switch forces its terminals' whole group to U (FR-083a's
        // conservative rule), overriding the resolved value and any conflict.
        const forced = members.some((m) => forceU.has(m));
        if (forced) val = VU;
        const conflicted = !forced && conflictedNets.has(r);
        for (const m of members) {
          next[m] = val;
          if (next[m] !== curr[m]) changed = true;
          // Flag every member net's conductors on a merged-group conflict (FR-082).
          if (conflicted) conflictedNets.add(m);
          else conflictedNets.delete(m);
        }
      }
    }
    [curr, next] = [next, curr];
    simTime++;
    lastStepChanged = changed;
  }

  const clocks = entities.filter((e) => e.kind === "builtin" && e.renderType === "clock");
  // clockPeriod (FR-071b): the effective period of the design's clock when
  // exactly one is placed, else the 100 ns FR-071a default (no clock, or
  // several). Resolved once; consumed by the reset built-in's behavior ctx.
  const clockPeriod = clocks.length === 1 ? clocks[0].props.period : 100;

  return {
    step,
    simTime: () => simTime,
    lastStepChanged: () => lastStepChanged,
    valueOfPin(refdes, pin) {
      const n = netOfPin.get(`${refdes}.${pin}`);
      return n === undefined ? VZ : curr[n];
    },
    // valueOfLane reads a conductor's net by lane (FR-087c); a lane on no net
    // (an isolated conductor) reads Z, like an unconnected pin.
    valueOfLane(lane) {
      const n = netOfLane.get(lane);
      return n === undefined ? VZ : curr[n];
    },
    // sampledValueOfLane is valueOfLane's view-mode twin (FR-087d): the lane's
    // value as of the last sample rather than the current step. VZ before the
    // first sample, which the renderer draws as the gray "no level".
    sampledValueOfLane(lane) {
      if (sampled === null) return VZ;
      const n = netOfLane.get(lane);
      return n === undefined ? VZ : sampled[n];
    },
    // setViewSampling arms (with the primary clock's effective period) or
    // disarms view-mode sampling; sampleViewNow takes the immediate snapshot
    // FR-087d requires on entering the mode, so the sheet is never blank.
    setViewSampling(period) {
      viewPeriod = period;
      if (period === null) sampled = null;
    },
    sampleViewNow: sampleView,
    // setSpeedCap caps every clock's `speed` for pacing only (FR-087d): null
    // for no cap. It is applied in unitsPerSecond below, so nothing downstream
    // of the property — the clock behavior's waveform included — can see it and
    // the simulated result is identical to the uncapped run.
    setSpeedCap(cap) {
      speedCap = cap;
    },
    conflictedConductors() {
      const ids = new Set();
      for (const i of conflictedNets) {
        for (const m of nets[i].members) ids.add(m);
      }
      return ids;
    },
    hasClocks: () => clocks.length > 0,
    // Paced at period × speed units per wall second (FR-084), over the EFFECTIVE
    // period — the same Math.max(2, floor(...)) clamp the clock behavior and
    // clockInfo apply — so the pacing rate is derived from the waveform actually
    // generated rather than from a raw property the behavior would round. `speed`
    // may be fractional (FR-071a): 1/10 Hz on the default 100 ns period is a rate
    // of 10 units per second, which the frame loop's fractional `due` accumulator
    // carries across frames without needing whole steps each time.
    unitsPerSecond: () =>
      clocks.length
        ? Math.max(
            ...clocks.map(
              (c) =>
                Math.max(2, Math.floor(c.props.period)) *
                (speedCap === null ? c.props.speed : Math.min(c.props.speed, speedCap)),
            ),
          )
        : 0,
    // clockInfo lists every clock generator with its effective period — the
    // same clamp the clock behavior applies (§6.11 builtins) — for the
    // step-cycle edge computation (FR-076a), and its declared `speed`, which is
    // what view mode's 1 Hz cap reports on (FR-087d). These are the FLATTENED
    // run's clocks, so a clock inside an embedded sub-design is covered too.
    clockInfo: () =>
      clocks.map((c) => ({
        refdes: c.refdes,
        period: Math.max(2, Math.floor(c.props.period)),
        speed: c.props.speed,
      })),
    // setStimulus replaces the external stimulus list between steps (FR-115e):
    // a long-lived sequential vector run re-drives its inputs row by row (and
    // phase by phase within a C pulse) without rebuilding the simulation.
    setStimulus(entries) {
      stimulus = entries;
    },
    // persistentRams lists the RAMs to save on Stop (FR-114g): each RAM instance
    // carrying a save-file path, paired with a dumpBytes() over its current store.
    persistentRams() {
      return entities
        .filter((e) => e.kind === "memory" && e.ramFile)
        .map((e) => ({ refdes: e.refdes, ramFile: e.ramFile, dumpBytes: () => e.core.dumpBytes() }));
    },
  };
}

// loadRomContents fetches and parses every distinct ROM content file referenced
// by the design (FR-114e), returning a Map<path, byte stream> the build seeds
// into ROM cores. A file that is missing, the wrong type, or malformed is
// reported (FR-074) and skipped — that ROM then reads U — rather than aborting
// the run. Never throws. Shared by the live run (createSim) and the test-vector
// runner (§6.16), which need ROM-backed combinational logic to resolve.
export async function loadRomContents(design) {
  const content = new Map();
  const seen = new Set();
  for (const inst of design.components) {
    const mem = inst.typeData?.mem;
    if (!mem || mem.kind !== "rom" || !mem.romFile || seen.has(mem.romFile)) continue;
    seen.add(mem.romFile);
    const bytes = await fetchMemFile(inst.refdes, mem.romFile, "ROM");
    if (bytes) content.set(mem.romFile, bytes);
  }
  return content;
}

// loadRamContents fetches the persistent save file of every distinct RAM whose
// load-on-start flag is set (FR-114g), returning a Map<path, byte stream> the
// build seeds into RAM cores before the first step (overriding the all-U
// power-up). Same non-fatal handling as loadRomContents — a missing, wrong-type,
// or malformed file is reported and skipped, leaving that RAM all-U, so a first
// run before the file exists still runs. Deliberately **not** called by the
// vector runner (§6.16): a vector run resets RAM per row and never loads a save
// file (FR-115c).
export async function loadRamContents(design) {
  const content = new Map();
  const seen = new Set();
  for (const inst of design.components) {
    const mem = inst.typeData?.mem;
    if (!mem || mem.kind !== "ram" || !mem.ramLoad || !mem.ramFile || seen.has(mem.ramFile)) continue;
    seen.add(mem.ramFile);
    const bytes = await fetchMemFile(inst.refdes, mem.ramFile, "RAM save");
    if (bytes) content.set(mem.ramFile, bytes);
  }
  return content;
}

// saveRamContents writes each persistent RAM's full contents to its save file on
// Stop (FR-114g). Formats by extension — `.hex` as space-separated two-digit hex
// byte tokens, `.bin` as the raw bytes (a bad extension is rejected server-side).
// Fire-and-forget per RAM: a write failure is reported (FR-074) but does not block
// the return to editing. `dumpBytes()` renders U (and unwritten cells) as 0.
export function saveRamContents(rams) {
  for (const ram of rams) {
    const body = ramFileBody(ram.ramFile, ram.dumpBytes());
    writeRamFile(ram.ramFile, body).catch((e) =>
      postMessage(`${ram.refdes}: cannot save RAM ${ram.ramFile}: ${e.message}`),
    );
  }
}

// ramFileBody renders a RAM's dumped bytes into the request body for its save
// file (FR-114g), by extension: `.hex` → space-separated two-digit hex byte
// tokens (a string); `.bin` (or anything else — the server rejects non-.bin/.hex)
// → the raw Uint8Array. Pure; the byte image already has U rendered as 0.
export function ramFileBody(ramFile, bytes) {
  if (ramFile.toLowerCase().endsWith(".hex")) {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(" ");
  }
  return bytes;
}

// fetchMemFile fetches and parses one memory file by extension (FR-114e/FR-114g):
// `.bin` verbatim, `.hex` decoded. A bad extension or a missing/malformed file is
// reported (FR-074) and yields null — never throws — so a load failure is
// non-fatal and that device stays all-U. Shared by loadRomContents/loadRamContents.
async function fetchMemFile(refdes, path, label) {
  const lower = path.toLowerCase();
  const format = lower.endsWith(".hex") ? "hex" : lower.endsWith(".bin") ? "bin" : null;
  if (!format) {
    postMessage(`${refdes}: ${label} file must be .bin or .hex: ${path}`);
    return null;
  }
  try {
    return parseRomBytes(await readRomFile(path), format);
  } catch (e) {
    postMessage(`${refdes}: cannot load ${label} ${path}: ${e.message}`);
    return null;
  }
}

// --- Step-cycle helpers (FR-076a). Pure over a buildSimulation instance. ---

// nextRisingEdge returns the earliest evaluation time ≥ t at which the FR-084
// waveform of a clock with the given effective period applies its rising edge
// (evaluation times t ≡ floor(period/2) mod period).
export function nextRisingEdge(t, period) {
  const half = Math.floor(period / 2);
  return t + ((((half - t) % period) + period) % period);
}

// isClockEdgeTime reports whether evaluating a step at time t applies a
// scheduled edge of any clock in `clocks` ([{refdes, period}], sim.clockInfo):
// the FR-084 waveform transitions where t % period is 0 (falling) or
// floor(period/2) (rising).
export function isClockEdgeTime(clocks, t) {
  return clocks.some((c) => {
    const m = t % c.period;
    return m === 0 || m === Math.floor(c.period / 2);
  });
}

// advanceOneCycle advances `sim` just past the next rising edge of the primary
// clock (effective period `primaryPeriod`) and settles (FR-076a): it steps
// through the edge-evaluation time, then keeps stepping until quiescence —
// stopping early one unit before the next scheduled edge of any clock, and
// bounded by the FR-085 oscillation bound (reported once via onMessage).
export function advanceOneCycle(sim, primaryPeriod, clocks, onMessage = () => {}) {
  const tEdge = nextRisingEdge(sim.simTime(), primaryPeriod);
  while (sim.simTime() <= tEdge) sim.step();
  let steps = 0;
  while (sim.lastStepChanged() && !isClockEdgeTime(clocks, sim.simTime())) {
    if (steps++ >= SETTLE_BOUND) {
      onMessage(
        `design did not settle within ${SETTLE_BOUND} ns; pausing evaluation (possible oscillation)`,
      );
      break;
    }
    sim.step();
  }
}

// VIEW_MAX_HZ is view mode's pacing cap (FR-087d): the mode is for reading
// values by eye, which a clock faster than one cycle per real second defeats.
export const VIEW_MAX_HZ = 1;

// MAX_STEPS_PER_FRAME caps a paced frame's work so a huge period × speed
// cannot freeze the tab (§6.13).
const MAX_STEPS_PER_FRAME = 10000;

// COMBINATIONAL_BATCH steps between yields in the unpaced settling loop, so
// the tab stays live while a large design settles (FR-085).
const COMBINATIONAL_BATCH = 1000;

// createSim wires the engine to the application (§6.13): run()/stop() own the
// FR-076 transitions (state tray via setAppState, the store's transient
// simulating flag and display view, the toolbar relabel via the store
// notification). Both kinds run until stop(); neither auto-terminates.
// Combinational designs run a settling episode (unpaced) to quiescence then
// idle, re-settling on an interactive input (FR-085/FR-087b); designs with a
// clock run paced at period × speed units per wall second (FR-084, FR-086).
export function createSim({ store, renderer, consolePanel = null, onRefusal = postMessage }) {
  let sim = null; // the running buildSimulation, or null
  let rafId = null;
  let timeoutId = null;
  let unsubLive = null; // live-input channel subscription during a run (FR-087b)
  let settling = false; // a combinational settling episode is in flight
  let starting = false; // a run is awaiting its async ROM preload (FR-114e)
  let paused = false; // sequential run paused (FR-076a); never set for combinational

  // run({ paused }) starts a run (FR-076). `paused` starts it frozen at t = 0
  // instead of wall-clock paced — the STEP entry (FR-076a): the pacing loop must
  // never get a frame in before the first step, or the cycle the user asked to
  // watch is gone before it is drawn. Ignored for a combinational design, which
  // has no pacing to park.
  async function run({ paused: startPaused = false } = {}) {
    if (sim || starting) return;
    starting = true;
    // Clear any stale editing-time message before the run; compile/start-up
    // reports (FR-080, conflicts) posted below then survive into the run (FR-074).
    clearMessage();
    // Flatten sub-design instances and off-sheet links first (FR-102/FR-103);
    // a refusal (embedding cycle, unloadable child, FR-102a) reports via the
    // tray. A design with neither is returned as-is.
    let design;
    try {
      design = await flatten(store.design, loadDesign, { rootPath: store.state.savePath });
    } catch (err) {
      starting = false;
      postMessage(`cannot simulate: ${err.message}`);
      return;
    }
    if (!starting) return; // Stop() was hit during the async flatten
    // A GAL part with definition errors refuses the run outright (FR-066m),
    // before any preflight: `onRefusal` is the app's modal error dialog.
    const refusal = definitionErrorsMessage("The design cannot be run", designDefinitionErrors(design, store.design));
    if (refusal) {
      starting = false;
      onRefusal(refusal);
      return;
    }
    // Load ROM contents (FR-114e) and load-on-start RAM saves (FR-114g) from the
    // server first; the build is sync.
    const romContent = await loadRomContents(design);
    if (!starting) return; // Stop() was hit during the async load — abort the start
    const ramContent = await loadRamContents(design);
    if (!starting) return; // Stop() was hit during the async RAM load — abort the start
    starting = false;
    // Clear the Console panel at the start of each interactive Run (FR-122c),
    // beside the message-tray clear, and route the UART byte stream to it.
    consolePanel?.clear();
    const onConsole = consolePanel ? (b) => consolePanel.write(b) : undefined;
    try {
      sim = buildSimulation(design, {
        onMessage: postMessage,
        onConsole,
        romContent,
        ramContent,
        // Sim-time switch clicks land in the store's sim view, not the design
        // (FR-087a). Resolved per step, so the view published just below (and
        // replaced on the next Run) is always the one read.
        liveInputs: (refdes) => store.state.sim?.inputs?.[refdes],
      });
    } catch (err) {
      postMessage(`cannot simulate: ${err.message}`);
      return;
    }
    paused = startPaused && sim.hasClocks(); // FR-076a: STEP starts a run paused
    setAppState(paused ? "paused" : "simulating"); // FR-073/FR-076
    store.setSim({
      valueOfPin: sim.valueOfPin,
      valueOfLane: sim.valueOfLane, // conductor reads for the probe (FR-087c)
      sampledValueOfLane: sim.sampledValueOfLane, // view-mode colouring (FR-087d)
      conflictedConductors: sim.conflictedConductors,
      // Which ports this run accepts clicks on (FR-094g), resolved once from the
      // ROOT design — the sheet the user sees — not the flattened one. Carried on
      // the view so the renderer and the click FSM read one agreed answer, and so
      // Stop drops it with everything else.
      debugPorts: debugPorts(store.design),
    });
    store.setSimulating(true); // design read-only (FR-087); notifies chrome
    store.setSelection([]); // selection is locked during a run, so clear it (FR-087)
    // Re-evaluate after any live interactive input during the run (FR-087b).
    unsubLive = store.subscribeLive(wake);
    if (sim.hasClocks()) startPaced();
    else settle();
  }

  function stop() {
    starting = false; // cancel a run still awaiting its ROM preload (FR-114e)
    if (!sim) return;
    // Normal termination (FR-076): write back every persistent RAM before the
    // run is torn down (FR-114g). Reaching stop() *is* the normal-termination
    // signal — an abnormal end (tab/browser close, crash) never runs this, so
    // those changes are correctly lost.
    saveRamContents(sim.persistentRams());
    sim = null;
    if (rafId !== null) cancelAnimationFrame(rafId);
    if (timeoutId !== null) clearTimeout(timeoutId);
    rafId = timeoutId = null;
    settling = false;
    paused = false;
    if (unsubLive) {
      unsubLive();
      unsubLive = null;
    }
    // Drop the display view (FR-085): the schematic returns to its design-time
    // appearance in one move — indicators back to "?", clicked switches back to
    // their specified settings (their run-time state rides on this view,
    // FR-087a), conflict strokes gone, probe reading cleared. A run's results do
    // not outlive the run, precisely so nothing is left showing values the
    // on-screen inputs no longer explain.
    store.setSim(null);
    setAppState("editing");
    store.setSimulating(false);
    clearMessage(); // drop any leftover run-time message, e.g. the lock notice (FR-074)
    renderer.requestRender();
  }

  // Combinational (no clock generator): run one settling episode — unpaced
  // steps until the circuit reaches quiescence or the per-episode bound — then
  // idle (no timer, no CPU) without stopping the run (FR-085). The bound is per
  // episode (a local counter), not cumulative simTime, so it resets each wake.
  function settle() {
    if (!sim || settling) return; // an in-flight episode already absorbs new state
    settling = true;
    let episodeSteps = 0;
    const loop = () => {
      if (!sim) return; // stopped mid-batch
      for (let i = 0; i < COMBINATIONAL_BATCH; i++) {
        sim.step();
        episodeSteps++;
        if (!sim.lastStepChanged()) {
          // Quiescent: display and idle until the next interactive input wakes us.
          renderer.requestRender();
          settling = false;
          return;
        }
        if (episodeSteps >= SETTLE_BOUND) {
          postMessage(
            `design did not settle within ${SETTLE_BOUND} ns; pausing evaluation (possible oscillation)`,
          );
          renderer.requestRender();
          settling = false;
          return;
        }
      }
      renderer.requestRender();
      timeoutId = setTimeout(loop, 0); // yield to keep the tab live
    };
    loop();
  }

  // wake re-evaluates after a live input change (FR-087b). Combinational: start
  // a fresh settling episode if idle. Paced: a no-op — the rAF loop already
  // re-reads instance state each step.
  function wake() {
    if (!sim || sim.hasClocks()) return;
    settle();
  }

  // Sequential: advance period × speed units per wall second (FR-084).
  function startPaced() {
    let last = performance.now();
    let due = 0; // fractional steps carried between frames
    const frame = (now) => {
      if (!sim) return;
      if (paused) {
        // Frozen at a unit-step boundary (FR-076a). Re-anchoring `last` (and
        // dropping any fractional debt) every frame means resume never tries
        // to catch up the paused interval.
        last = now;
        due = 0;
        rafId = requestAnimationFrame(frame);
        return;
      }
      // Re-read the rate every frame rather than capturing it at run start:
      // view mode's 1 Hz cap (FR-087d) can change it mid-run. The fractional
      // `due` accumulator carries partial steps across a rate change exactly as
      // it carries them across frames (FR-071a).
      due += ((now - last) / 1000) * sim.unitsPerSecond();
      last = now;
      // Run the whole steps due, capped per frame; drop any backlog beyond
      // the cap (slow real time beats accruing unbounded debt).
      let n = Math.min(Math.floor(due), MAX_STEPS_PER_FRAME);
      due -= Math.floor(due);
      let changed = false;
      while (n-- > 0) {
        sim.step();
        if (sim.lastStepChanged()) changed = true;
      }
      if (changed) renderer.requestRender();
      rafId = requestAnimationFrame(frame);
    };
    rafId = requestAnimationFrame(frame);
  }

  // --- Pause & single-step (FR-076a/FR-076b); sequential runs only ---

  function pause() {
    if (!sim || !sim.hasClocks() || paused) return;
    paused = true;
    setAppState("paused"); // FR-073
  }

  function resume() {
    if (!sim || !paused) return;
    paused = false;
    setAppState("simulating");
  }

  // --- View mode (FR-087d); sequential runs only ---

  // setViewMode arms or disarms the whole of view mode on the running sim: the
  // pre-edge sampling (on the primary clock, FR-076b) and the 1 Hz pacing cap.
  // The store owns the flag itself — setSim(null) clears it, so Stop needs no
  // help here — and this is only the engine half. A combinational run has no
  // edge to sample and no pacing to cap, so it is a no-op there.
  function setViewMode(on) {
    if (!sim || !sim.hasClocks()) return;
    if (!on) {
      sim.setViewSampling(null);
      sim.setSpeedCap(null);
      renderer.requestRender();
      return;
    }
    const clocks = sim.clockInfo();
    sim.setViewSampling(primaryClock(clocks).period);
    sim.sampleViewNow(); // show something at once, rather than a blank sheet (FR-087d)
    // Report the cap only when it actually caps something (FR-087d).
    const fast = clocks.filter((c) => c.speed > VIEW_MAX_HZ);
    sim.setSpeedCap(VIEW_MAX_HZ);
    if (fast.length) {
      const which = fast.map((c) => `${c.refdes} at ${c.speed} Hz`).join(", ");
      postMessage(`view mode: clock speed limited to ${VIEW_MAX_HZ} Hz (${which})`);
    }
    renderer.requestRender();
  }

  // primaryClock resolves the design's primary clock (FR-076b) against the
  // running sim's clock entities: the design-level reference when it names one,
  // else the lowest-refdes clock — the reconcilePrimaryClock ordering, covering
  // a pre-FR-076b design that has clocks but no stored reference.
  function primaryClock(clocks) {
    const hit = clocks.find((c) => c.refdes === store.design.primaryClock);
    if (hit) return hit;
    const aNum = (r) => {
      const m = /^A-(\d+)$/.exec(r);
      return m ? Number(m[1]) : Infinity;
    };
    return clocks
      .slice()
      .sort((a, b) => aNum(a.refdes) - aNum(b.refdes) || (a.refdes < b.refdes ? -1 : 1))[0];
  }

  // stepCycle is the whole of the STEP button (FR-076a): it means "paused, one
  // clock cycle later", from whatever state the application is in. With no run
  // it starts one, paused; with a free-running one it pauses first; with a
  // paused one it just advances. It is async only because the start is (flatten
  // plus the ROM/RAM preloads) — the advance itself stays synchronous, a settle
  // being bounded well inside a frame. The advance is advanceOneCycle above:
  // just past the primary clock's next rising edge, then settle.
  async function stepCycle() {
    if (!sim) {
      if (starting) return; // a start is already in flight; this click is a repeat
      await run({ paused: true });
      if (!sim) return; // the start was refused, failed, or was stopped mid-flight
    } else if (!paused) {
      pause();
    }
    const clocks = sim.clockInfo();
    if (clocks.length === 0) return; // combinational: no cycle to step (FR-076a)
    advanceOneCycle(sim, primaryClock(clocks).period, clocks, postMessage);
    renderer.requestRender();
  }

  return {
    run,
    stop,
    isRunning: () => sim !== null,
    // FR-076a: the toolbar's Pause toggle is shown only for a sequential run,
    // and it is one of the two things that make STEP enabled.
    isSequentialRun: () => sim !== null && sim.hasClocks(),
    isPaused: () => paused,
    pause,
    resume,
    stepCycle,
    setViewMode,
  };
}
