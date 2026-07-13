// Slow-simulator engine core (§6.13, FR-075–FR-086): compile-on-Run and the
// unit step. Unit-delay model (FR-078): 1 unit = 1 simulated ns; every step,
// all components compute from the previous step's net values (`curr`) into
// `next`, then the buffers swap — outputs respond exactly one unit after
// inputs, independent of evaluation order. The scheduler and Run/Stop UI
// wiring live in a separate layer (§6.13 createSim).

import {
  compileBehavior,
  evalOutput,
  updateRegisters,
  updateLatches,
  V0,
  V1,
  VU,
  VZ,
} from "./galasm.js";
import { buildNets } from "../model/netlist.js";
import { flatten } from "../model/subdesign.js";
import { BEHAVIORS } from "../builtins.js";
import { createMemoryCore, parseRomBytes } from "./memory.js";
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
// `scriptedClocks` (FR-115e): suppress the time-based built-in behaviors — the
// clock's simTime square wave (FR-084) and the power-on reset's simTime window
// (FR-071b) — so the caller (the sequential vector runner, §6.16) owns those
// nets, driving them through the stimulus mechanism as scripted levels. The
// live editor run never passes it.
export function buildSimulation(
  design,
  { onMessage = () => {}, romContent = null, ramContent = null, stimulus = [], scriptedClocks = false } = {},
) {
  const nets = buildNets(design, onMessage);

  // (refdes, pin) → net index.
  const netOfPin = new Map();
  nets.forEach((net, i) => {
    for (const pin of net.pins) netOfPin.set(pin, i);
  });

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
      behavior: td0.behavior,
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
    const uPins = []; // behavior-less: output-capable pins driving U
    for (const inst of insts) {
      for (const p of inst.typeData.pins) {
        const signal = p.name.startsWith("/") ? p.name.slice(1) : p.name;
        pinOwner.set(signal, `${inst.refdes}.${p.name}`);
        if (c === null && p.direction !== "in") {
          uPins.push(`${inst.refdes}.${p.name}`);
        }
      }
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
      nets.push({ pins: [], members: [] });
      pinOwner.set(node, key);
    }

    const e = {
      kind: "galasm",
      compiled: c,
      registers: new Map(),
      prevClock: VU,
      clockNet: undefined,
      clockPrev: new Map(), // per-output .CLK previous values (FR-079a edge detection)
      pinOwner,
      uPins,
      readNet(signal) {
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
        { a: com, b: netFor("NC"), closedWhen: V0 },
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
      const behave = BEHAVIORS[inst.type];
      if (!behave) {
        errors.push(`${inst.refdes}: unknown built-in type ${inst.type}`);
        continue;
      }
      entities.push({
        kind: "builtin",
        refdes: inst.refdes,
        type: inst.type,
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
    for (const e of entities) {
      if (e.kind !== "galasm" || e.registers.size === 0) continue;
      // Global clock edge (for .R outputs without their own .CLK); per-output
      // .CLK edges are detected inside updateRegisters against e.clockPrev.
      const cur = e.clockNet === undefined ? VZ : curr[e.clockNet];
      const globalRose = e.prevClock === V0 && cur === V1;
      updateRegisters(e.compiled, e.readNet, e.registers, globalRose, e.clockPrev);
      // Transparent latches (FR-079d) update level-sensitively in the same
      // phase — no edge, so independent of the clock comparison above.
      updateLatches(e.compiled, e.readNet, e.registers);
      e.prevClock = cur;
    }
    // Memory writes (RAM WE/ rising edge, FR-114d) latch from curr too, alongside
    // register latching, before any contribution is evaluated.
    for (const e of entities) {
      if (e.kind === "memory") e.core.writeStep(e.read);
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
      if (e.kind === "builtin") {
        // Scripted-clock mode (FR-115e): the clock and reset built-ins' simTime-
        // based behaviors are suppressed; the caller drives their nets via the
        // stimulus list instead.
        if (scriptedClocks && (e.renderType === "clock" || e.renderType === "reset")) continue;
        const ctx = { props: e.props, simTime, clockPeriod, state: e.inst.switchState };
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
      } else if (e.compiled) {
        for (const out of e.compiled.outputs) {
          const key = e.pinOwner.get(out.signal);
          add(key, evalOutput(out, e.readNet, e.registers), false, key);
        }
      } else {
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
    conflictedConductors() {
      const ids = new Set();
      for (const i of conflictedNets) {
        for (const m of nets[i].members) ids.add(m);
      }
      return ids;
    },
    hasClocks: () => clocks.length > 0,
    unitsPerSecond: () =>
      clocks.length
        ? Math.max(...clocks.map((c) => c.props.period * c.props.speed))
        : 0,
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
export function createSim({ store, renderer }) {
  let sim = null; // the running buildSimulation, or null
  let rafId = null;
  let timeoutId = null;
  let unsubLive = null; // live-input channel subscription during a run (FR-087b)
  let settling = false; // a combinational settling episode is in flight
  let starting = false; // a run is awaiting its async ROM preload (FR-114e)

  async function run() {
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
    // Load ROM contents (FR-114e) and load-on-start RAM saves (FR-114g) from the
    // server first; the build is sync.
    const romContent = await loadRomContents(design);
    if (!starting) return; // Stop() was hit during the async load — abort the start
    const ramContent = await loadRamContents(design);
    if (!starting) return; // Stop() was hit during the async RAM load — abort the start
    starting = false;
    try {
      sim = buildSimulation(design, { onMessage: postMessage, romContent, ramContent });
    } catch (err) {
      postMessage(`cannot simulate: ${err.message}`);
      return;
    }
    setAppState("simulating"); // FR-073/FR-076
    store.setSim({
      valueOfPin: sim.valueOfPin,
      conflictedConductors: sim.conflictedConductors,
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
    if (unsubLive) {
      unsubLive();
      unsubLive = null;
    }
    // state.sim is deliberately retained: final values stay displayed until
    // the next design modification (FR-085).
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
    const rate = sim.unitsPerSecond();
    let last = performance.now();
    let due = 0; // fractional steps carried between frames
    const frame = (now) => {
      if (!sim) return;
      due += ((now - last) / 1000) * rate;
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

  return {
    run,
    stop,
    isRunning: () => sim !== null,
  };
}
