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
  V0,
  V1,
  VU,
  VZ,
} from "./galasm.js";
import { buildNets } from "../model/netlist.js";
import { BEHAVIORS } from "../builtins.js";
import { setAppState, postMessage, clearMessage } from "../chrome/statusbar.js";

// SETTLE_BOUND is the combinational settling bound (FR-085).
export const SETTLE_BOUND = 10000;

const SUBUNIT_PKG_RE = /^(U\d+)[A-Z]$/;

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
export function buildSimulation(design, { onMessage = () => {} } = {}) {
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
    const typeData = { name: typeName, pins, behavior: td0.behavior, gal: td0.gal };
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

  for (const inst of design.components) {
    if (inst.typeData.builtin) {
      // A text note (FR-071f) is a pure annotation with no pins and no behavior;
      // it is not a simulation entity, so skip it rather than flagging it unknown.
      if (inst.typeData.renderType === "note") continue;
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
      e.prevClock = cur;
    }

    const contribs = nets.map(() => []);
    const add = (netKey, v, weak, label) => {
      const n = netOfPin.get(netKey);
      if (n !== undefined && v !== VZ) contribs[n].push({ v, weak, label });
    };
    for (const e of entities) {
      if (e.kind === "builtin") {
        const ctx = { props: e.props, simTime, clockPeriod, state: e.inst.switchState };
        for (const c of e.behave(ctx)) {
          add(`${e.refdes}.${c.pin}`, c.value, !!c.weak, `${e.refdes}.${c.pin}`);
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

    let changed = false;
    for (let i = 0; i < nets.length; i++) {
      next[i] = resolveNet(i, contribs[i]);
      if (next[i] !== curr[i]) changed = true;
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
  };
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

  function run() {
    if (sim) return;
    // Clear any stale editing-time message before the run; compile/start-up
    // reports (FR-080, conflicts) posted below then survive into the run (FR-074).
    clearMessage();
    try {
      sim = buildSimulation(store.design, { onMessage: postMessage });
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
    if (!sim) return;
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
