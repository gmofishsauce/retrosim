// Fast-engine C code generator (§6.17, FR-106/FR-109/FR-116a): emits the
// design-specific <design>.c that compiles against the fixed runtime pair
// (web/cgen/runtime.{h,c}) into a standalone simulator for one design.
//
// Pure and DOM-free (tests under node:test, like vectors.js). Reuses the
// single-source modules per FR-109: compileBehavior (galasm.js) for behavior
// lowering, buildNets (netlist.js) for connectivity, deriveColumns
// (vectors.js) for the baked vector column tables. The emitted code is only
// tables plus straight-line lowered logic — every runtime semantic lives in
// runtime.c (FR-116a).
//
// M3 scope (design §6.17): combinational designs, registered outputs (.R) —
// both the global clock: pin (incl. global AR/SP, FR-079) and per-output .CLK
// with async .ARST/.APRST (FR-079a) — and memory devices (RAM/ROM, FR-114d,
// contents baked at generate time). Sub-design instances are refused per
// FR-116 deferred scope (fast-engine flattening is a later change).

import { hasEquations } from "./galerrors.js";
import { compileBehavior } from "./galasm.js";
import { buildNets } from "../model/netlist.js";
import { deriveColumns } from "./vectors.js";
import { DECODER_OUTPUTS, DECODER_TERMS } from "../builtins.js";

// Hierarchical-prefix tolerant (FR-102/§6.14, mirroring sim.js): a flattened
// child's subunit `X1/U3A` groups under the full prefixed stem `X1/U3`, so a
// package never groups across sub-design instances.
const SUBUNIT_PKG_RE = /^((?:.*\/)?U\d+)[A-Z]$/;

// effectiveProps merges a type's declared property defaults with the
// instance's overrides (FR-020b); mirrors sim.js.
function effectiveProps(inst) {
  const props = {};
  for (const p of inst.typeData.properties ?? []) {
    props[p.name] = inst.overrides?.props?.[p.name] ?? p.default;
  }
  return props;
}

// cstr renders a JS string as a C string literal.
function cstr(s) {
  return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

// generateC compiles the design into the C source of its generated
// translation unit. Returns { code, warnings }; throws Error on a refusal
// (behavior compile error, unflattened input) with all collected reasons,
// like buildSimulation's preflight. `design` is the FlatDesign (§6.14) when
// the source is hierarchical — the caller flattens (FR-116 hierarchy) —
// and `columnsFrom` is the root design the baked column tables derive from:
// the root-for-columns / flat-for-netlist split the vector panel uses, so a
// top-sheet port's direction derives from the root wiring and a child's
// ports/switches/indicators never become columns. ROM contents are NOT
// baked: the emitted program reads each ROM's content file at startup
// (FR-117b), so only the instance's refdes and recorded content-file path
// are emitted.
export function generateC(design, { columnsFrom = design } = {}) {
  const warnings = [];
  const errors = [];

  const nets = buildNets(design, (m) => warnings.push(m));
  const netOfPin = new Map(); // "refdes.pin" → net index
  nets.forEach((net, i) => {
    for (const pin of net.pins) netOfPin.set(pin, i);
  });
  // Single-node nets for unconnected pins (FR-081a) — the same top-up sim.js
  // makes, in the same component/pin order, so the two engines' net indices and
  // net counts agree (FR-107).
  for (const inst of design.components) {
    for (const p of inst.typeData?.pins ?? []) {
      const key = `${inst.refdes}.${p.name}`;
      if (netOfPin.has(key)) continue;
      netOfPin.set(key, nets.length);
      nets.push({ pins: [key], members: [] });
    }
  }
  const netOf = (key) => netOfPin.get(key) ?? -1;

  // Label interning: gen_labels[] holds every "refdes.pin" driver/probe name
  // once; contributions reference labels by index (FR-108 conflict messages).
  const labels = [];
  const labelIdx = new Map();
  const intern = (key) => {
    if (!labelIdx.has(key)) {
      labelIdx.set(key, labels.length);
      labels.push(key);
    }
    return labelIdx.get(key);
  };

  // --- Walk the components (the same dispatch as buildSimulation, §6.13) ---
  // Evaluation units (design §6.17 M13): one per generated driver, each a
  // gen_eval case, with the nets and instance state its expression reads.
  const units = []; // { comment, lines, slot, nets:Set, states:Set }
  let deps = null; // the dependency collector while a unit is being lowered
  const useNet = (n) => {
    if (deps && n >= 0) deps.nets.add(n);
  };
  const useState = (key) => {
    if (deps) deps.states.add(key);
  };
  const beginUnit = () => {
    deps = { nets: new Set(), states: new Set() };
  };
  // endUnit files the unit being lowered; a driver on no net (slot null) drives
  // nothing and so needs no unit at all.
  const endUnit = (slot, comment, lines) => {
    const d = deps;
    deps = null;
    if (slot) units.push({ comment, lines, slot, ...d });
  };
  const pulls = [];
  const switches = [];
  const clocks = [];
  const resets = [];
  const regUnits = []; // registered galasm entities, global-clock family (FR-079)
  const latchUnits = []; // transparent-latch entities (.L/.G outputs, FR-079d)
  const mems = []; // memory devices (RAM/ROM, FR-114d)
  const uarts = []; // magic UART output devices (FR-122d)
  const switchIdx = new Map(); // refdes → gen_switches index
  const clockIdx = new Map(); // refdes → gen_clocks index
  const compileCache = new Map(); // type name → CompiledBehavior|null
  const reportedNoBehavior = new Set();
  const packages = new Map(); // shared U-number → [subunit insts]
  // Every driver, in the global contribution order (design §6.17 M12): the
  // gen_drive text in order, then the runtime's built-ins, then memory data
  // bits. Slots are numbered once all are known, so generated code refers to
  // a driver by a placeholder token until then.
  const drivers = []; // { net, label, weak }
  const driver = (net, label, weak = 0) => {
    if (net < 0) return null; // drives no net: no slot
    drivers.push({ net, label, weak });
    return `@S${drivers.length - 1}@`;
  };

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

  // lowerGalasm emits one compiled behavior over one or more sibling
  // instances as a gen_drive fragment (the code-emitting analogue of
  // sim.js makeGalasmEntity).
  function lowerGalasm(typeName, insts, pins) {
    const td0 = insts[0].typeData;
    const typeData = {
      name: typeName,
      pins,
      // Comments alone are no behavior (FR-080), exactly as in sim.js.
      behavior: hasEquations(td0.behavior) ? td0.behavior : "",
      gal: td0.gal,
      internal: td0.internal, // buried registered nodes (FR-079c)
    };
    const c = compiled(typeName, typeData);

    const pinOwner = new Map(); // signal → "refdes.pinName" net key
    const uPins = []; // behavior-less: output-capable pins driving U
    for (const inst of insts) {
      for (const p of inst.typeData.pins) {
        const signal = p.name.startsWith("/") ? p.name.slice(1) : p.name;
        pinOwner.set(signal, `${inst.refdes}.${p.name}`);
        if (c === null && p.direction !== "in") uPins.push(`${inst.refdes}.${p.name}`);
      }
    }

    // Buried registered nodes (FR-079c): mirror sim.js makeGalasmEntity — append
    // one placeholder virtual net per declared internal node (bumping
    // gen_net_count = nets.length below), map the node to a synthetic
    // "<refdes>.#<node>" key in netOfPin/pinOwner, and intern its label. The
    // buried .R output then lowers through the ordinary reg/drive paths below:
    // its D literals read curr[<vnet>] and its driver is a slot on <vnet>,
    // so curr[<vnet>] carries the one-unit-delayed buried value the runtime's
    // unchanged net resolve produces — the two engines agree on the exposed pins.
    for (const node of td0.internal ?? []) {
      const key = `${insts[0].refdes}.#${node}`;
      netOfPin.set(key, nets.length);
      nets.push({ pins: [], members: [] });
      pinOwner.set(node, key);
      intern(key);
    }

    const refdesList = insts.map((i) => i.refdes).join(", ");
    if (c === null) {
      // No behavior block (FR-080) — a parse error is already in `errors`.
      if (!typeData.behavior) {
        if (!reportedNoBehavior.has(typeName)) {
          reportedNoBehavior.add(typeName);
          warnings.push(`${typeName}: no behavior defined; its outputs are U (FR-080)`);
        }
        for (const key of uPins) {
          beginUnit();
          const slot = driver(netOf(key), intern(key));
          endUnit(slot, `${key}: ${typeName} — no behavior, U (FR-080)`, [`rt_drive(${slot}, RT_U);`]);
        }
      }
      return;
    }

    const hasReg = c.outputs.some((o) => o.kind === "R");

    // Registered-output slots (FR-079/FR-079a), mapped BEFORE any expression is
    // lowered: a literal naming one of this instance's own .R outputs reads the
    // feedback snapshot regprev_<tag>[k] rather than its net (FR-079e), and it
    // may appear in any equation — including one lowered ahead of its own
    // output's — so the whole map has to exist first.
    const regTag = hasReg ? insts[0].refdes.replace(/[^A-Za-z0-9_]/g, "_") : null;
    const regIdxOf = new Map(); // .R signal → its slot in reg_<tag>[]/regprev_<tag>[]
    for (const out of c.outputs) {
      if (out.kind === "R") regIdxOf.set(out.signal, regIdxOf.size);
    }

    // Expression lowering. A literal reads its net from curr: bare literals
    // normalize Z→U via rt_buf (galasm.js litValue), negated ones via rt_not;
    // an unconnected signal reads RT_Z, which normalizes to U identically. A
    // literal naming one of this instance's .R outputs reads regprev_<tag>[k]
    // instead — sim.js's fb map (FR-079e), filled at the top of gen_latch and so
    // in place for both the latch and the drive phase of the step.
    const litExpr = (lit) => {
      const k = regIdxOf.get(lit.signal);
      const n = k === undefined ? netOf(pinOwner.get(lit.signal)) : -1;
      if (k !== undefined) useState(`reg_${regTag}`);
      else useNet(n);
      const rd = k !== undefined ? `regprev_${regTag}[${k}]` : n >= 0 ? `curr[${n}]` : `RT_Z`;
      const cm =
        k !== undefined ? `${lit.signal}:register` : n >= 0 ? lit.signal : `${lit.signal}:unconnected`;
      return lit.low ? `rt_not(${rd}) /* /${cm} */` : `rt_buf(${rd}) /* ${cm} */`;
    };
    // AND of a term's literals; the empty product (VCC) is true.
    const termExpr = (term) =>
      term.length === 0 ? "RT_1" : term.map(litExpr).reduce((a, b) => `rt_and(${a}, ${b})`);
    // OR of a sum's terms; the empty sum (GND) is false.
    const sumExpr = (terms) =>
      terms.length === 0 ? "RT_0" : terms.map(termExpr).reduce((a, b) => `rt_or(${a}, ${b})`);
    // evalCombinational (galasm.js): the sum folded with its :+: XOR groups,
    // without the LHS-negation (applied at drive time by evalOutput/xorLow).
    const combExpr = (out) =>
      (out.xor ?? []).reduce((acc, g) => `rt_xor(${acc}, ${sumExpr(g)})`, sumExpr(out.terms));

    // Registered (.R) outputs: collect per-instance register state (mirrors
    // sim.js updateRegisters). Two families may coexist in one part (FR-079a):
    //   • global-clock — no .CLK; latch on the rising edge of the type's
    //     clock: pin; global AR/SP apply (FR-079).
    //   • per-output-clock — a .CLK term; latch on its own edge; async
    //     .APRST/.ARST apply every step (FR-079a). Global AR/SP do not touch it.
    // The D input latched is combExpr; the drive block reads back reg_<tag>[k].
    if (hasReg) {
      // Global clock net — needed only if some .R output uses the global clock.
      const needsGlobal = c.outputs.some((o) => o.kind === "R" && !o.clk);
      let clockNet = -1;
      if (needsGlobal) {
        const clockPin = td0.clock;
        if (!clockPin) {
          errors.push(`${typeName}: behavior uses .R but the type declares no clock: pin (FR-062d)`);
        } else {
          const owner = insts.find((i) => i.typeData.pins.some((p) => p.name === clockPin));
          clockNet = netOf(`${owner?.refdes}.${clockPin}`);
        }
      }
      const regs = []; // one per .R output, in output order (regIdxOf's order)
      for (const out of c.outputs) {
        if (out.kind !== "R") continue;
        const k = regs.length;
        regs.push({
          k,
          lhsLow: out.lhsLow, // applied when snapshotting regprev (FR-079e)
          dExpr: combExpr(out),
          clkExpr: out.clk ? termExpr(out.clk) : null, // per-output .CLK (FR-079a)
          aprstExpr: out.aprst ? termExpr(out.aprst) : null, // async preset
          arstExpr: out.arst ? termExpr(out.arst) : null, // async reset (wins over preset)
        });
      }
      regUnits.push({
        tag: regTag,
        clockNet,
        hasGlobal: needsGlobal,
        regs,
        globalIdxs: regs.filter((r) => !r.clkExpr).map((r) => r.k),
        spExpr: c.sp ? termExpr(c.sp) : null,
        arExpr: c.ar ? termExpr(c.ar) : null,
      });
    }

    // Transparent-latch (.L/.G) outputs (FR-079d): collect per-instance latch
    // state (mirrors sim.js updateLatches). Level-sensitive — no clock, no edge.
    // The stored value is combExpr captured while the .G gate is 1; the drive
    // block reads back latch_<tag>[k].
    let latchTag = null;
    const latchIdxOf = new Map(); // .L signal → its slot in latch_<tag>[]
    if (c.outputs.some((o) => o.kind === "L")) {
      latchTag = insts[0].refdes.replace(/[^A-Za-z0-9_]/g, "_");
      const latches = []; // one per .L output, in output order
      for (const out of c.outputs) {
        if (out.kind !== "L") continue;
        const k = latches.length;
        latchIdxOf.set(out.signal, k);
        latches.push({
          k,
          dExpr: combExpr(out),
          gateExpr: termExpr(out.gate),
          arstExpr: out.arst ? termExpr(out.arst) : null, // async clear to 0
        });
      }
      latchUnits.push({ tag: latchTag, latches });
    }

    for (const out of c.outputs) {
      const key = pinOwner.get(out.signal);
      const lbl = intern(key);
      const net = netOf(key);
      beginUnit();
      const lines = [];
      const body = [];
      if (out.kind === "R") {
        useState(`reg_${regTag}`);
        body.push(`v = reg_${regTag}[${regIdxOf.get(out.signal)}]; /* latched */`);
      } else if (out.kind === "L") {
        useState(`latch_${latchTag}`);
        body.push(`v = latch_${latchTag}[${latchIdxOf.get(out.signal)}]; /* transparent latch */`);
      } else {
        body.push(`v = ${sumExpr(out.terms)};`);
        for (const group of out.xor ?? []) {
          body.push(`v = rt_xor(v, ${sumExpr(group)}); /* :+: */`);
        }
      }
      if (out.lhsLow) body.push(`v = rt_not(v); /* declared active-low */`);
      if (out.enable) {
        // .T enable (FR-079/evalOutput): false → Z (no drive), U → U.
        lines.push(`rt_val v;`);
        lines.push(`rt_val e = ${termExpr(out.enable)}; /* .E */`);
        lines.push(`if (e == RT_0) v = RT_Z;`);
        lines.push(`else if (e == RT_U) v = RT_U;`);
        lines.push(`else {`);
        for (const b of body) lines.push(`  ${b}`);
        lines.push(`}`);
      } else {
        lines.push(`rt_val v;`);
        for (const b of body) lines.push(b);
      }
      const slot = driver(net, lbl);
      lines.push(`rt_drive(${slot}, v);`);
      endUnit(slot, `${key}: ${typeName}`, lines);
    }
    // A GAL output pin its behavior writes no equation for drives U (FR-080),
    // mirroring sim.js makeGalasmEntity: unwritten logic is unknown, not undriven.
    if (td0.gal) {
      const written = new Set(c.outputs.map((o) => o.signal));
      const unwritten = [];
      for (const inst of insts) {
        for (const p of inst.typeData.pins) {
          const signal = p.name.startsWith("/") ? p.name.slice(1) : p.name;
          if (p.direction === "in" || written.has(signal)) continue;
          const key = `${inst.refdes}.${p.name}`;
          beginUnit();
          const slot = driver(netOf(key), intern(key));
          endUnit(slot, `${key}: no equation (FR-080)`, [`rt_drive(${slot}, RT_U);`]);
          if (!unwritten.includes(p.name)) unwritten.push(p.name);
        }
      }
      if (unwritten.length && !reportedNoBehavior.has(typeName)) {
        reportedNoBehavior.add(typeName);
        warnings.push(`${typeName}: no equation for ${unwritten.join(", ")}; ${unwritten.length === 1 ? "it is" : "they are"} U (FR-080)`);
      }
    }
  }

  for (const inst of design.components) {
    if (inst.childPath) {
      // Internal guard (FR-116 hierarchy): the caller flattens before
      // generating, so an X-instance here means an unflattened design.
      errors.push(
        `${inst.refdes}: sub-design instance reached the generator unflattened (FR-116)`,
      );
    } else if (inst.target) {
      // Internal guard, as above: flatten resolves off-sheet links (FR-103).
      errors.push(
        `${inst.refdes}: off-sheet connector reached the generator unflattened (FR-116)`,
      );
    } else if (inst.typeData.mem) {
      // Memory device (FR-114d): collect wiring. The runtime owns the
      // behavior (runtime.c mem core), driven from this gen_mems entry; a
      // ROM's contents are read by the program at startup from its recorded
      // content-file path (FR-117b), not baked here.
      const mem = inst.typeData.mem;
      const refdes = inst.refdes;
      const isRam = mem.kind === "ram";
      const addr = [];
      for (let i = 0; i < mem.addressBits; i++) addr.push(netOf(`${refdes}.A${i}`));
      const data = [];
      const dataLabel = [];
      for (let i = 0; i < mem.dataWidth; i++) {
        data.push(netOf(`${refdes}.D${i}`));
        dataLabel.push(intern(`${refdes}.D${i}`));
      }
      mems.push({
        tag: refdes.replace(/[^A-Za-z0-9_]/g, "_"),
        kind: isRam ? "RT_MEM_RAM" : "RT_MEM_ROM",
        n: mem.addressBits,
        w: mem.dataWidth,
        addr,
        data,
        dataLabel,
        ce: netOf(`${refdes}.CE/`),
        oe: netOf(`${refdes}.OE/`),
        we: isRam ? netOf(`${refdes}.WE/`) : -1,
        refdes,
        romFile: !isRam && mem.romFile ? mem.romFile : null,
        // Persistent RAM (FR-114g/FR-117c): bake the save-file path and
        // load-on-start flag; the runtime loads at start-up and writes back.
        ramFile: isRam && mem.ramFile ? mem.ramFile : null,
        ramLoad: isRam && mem.ramFile && mem.ramLoad ? 1 : 0,
      });
    } else if (inst.typeData.builtin) {
      const rt = inst.typeData.renderType;
      const refdes = inst.refdes;
      if (
        rt === "note" ||
        rt === "indicator" ||
        rt === "indicator8" ||
        rt === "hexdisplay" ||
        rt === "port" ||
        rt === "portN"
      ) {
        // Annotations and probes: no drive (ports/indicators become columns).
      } else if (rt === "uart") {
        // Magic UART (FR-122d): collect its data/CS//CE//CLK net indices; the
        // runtime owns the latch/gate/emit (runtime.c uart core), driven from
        // this gen_uarts entry. It drives no nets, so it has no driver slot.
        const data = [];
        for (let i = 0; i < 8; i++) data.push(netOf(`${refdes}.D${i}`));
        uarts.push({
          tag: refdes.replace(/[^A-Za-z0-9_]/g, "_"),
          data,
          cs: netOf(`${refdes}.CS/`),
          ce: netOf(`${refdes}.CE/`),
          clk: netOf(`${refdes}.CLK`),
          refdes,
        });
      } else if (rt === "pullup" || rt === "pulldown") {
        pulls.push({
          net: netOf(`${refdes}.OUT`),
          value: rt === "pullup" ? "RT_1" : "RT_0",
          label: intern(`${refdes}.OUT`),
        });
      } else if (rt === "switch") {
        switchIdx.set(refdes, switches.length);
        switches.push({
          net: netOf(`${refdes}.OUT`),
          level: inst.switchState === "1" ? "RT_1" : "RT_0",
          label: intern(`${refdes}.OUT`),
          refdes,
        });
      } else if (rt === "clock") {
        clockIdx.set(refdes, clocks.length);
        clocks.push({
          net: netOf(`${refdes}.OUT`),
          period: effectiveProps(inst).period,
          label: intern(`${refdes}.OUT`),
          refdes,
        });
      } else if (rt === "reset") {
        resets.push({
          rNet: netOf(`${refdes}.R`),
          rnNet: netOf(`${refdes}./R`),
          cycles: effectiveProps(inst).cycles,
          rLabel: intern(`${refdes}.R`),
          rnLabel: intern(`${refdes}./R`),
          refdes,
        });
      } else if (rt === "decoder") {
        // Labeled 3-to-8 decoder (FR-071k): lowered straight into gen_drive from
        // the SAME literal terms the slow engine evaluates (DECODER_TERMS,
        // builtins.js), so the two engines cannot drift (FR-107). rt_buf/rt_not
        // supply litValue's Z-to-U normalization and rt_and evalTerm's selective
        // pessimism, exactly as the GALasm lowering above does. The display
        // strings are editor-only and have no fast-engine counterpart.
        const lit = (l) => {
          const n = netOf(`${refdes}.${l.signal}`);
          useNet(n);
          const rd = n >= 0 ? `curr[${n}]` : `RT_Z`;
          return `${l.low ? "rt_not" : "rt_buf"}(${rd}) /* ${l.low ? "/" : ""}${l.signal} */`;
        };
        DECODER_TERMS.forEach((term, i) => {
          const pin = DECODER_OUTPUTS[i];
          const key = `${refdes}.${pin}`;
          beginUnit();
          const expr = term.map(lit).reduce((a, b) => `rt_and(${a}, ${b})`);
          const slot = driver(netOf(key), intern(key));
          endUnit(slot, `${key}: labeled 3-to-8 decoder (FR-071k)`, [`rt_drive(${slot}, rt_not(${expr}));`]);
        });
      } else if (rt === "tgate" || rt === "relay") {
        // Switch elements (FR-071g/FR-071h): dynamic net merging (FR-083a) is
        // slow-engine-only for now — refuse rather than misbehave (FR-116).
        const kind = rt === "tgate" ? "transmission gate" : "relay";
        errors.push(`${refdes}: ${kind} not supported by the fast simulator (FR-116)`);
      } else {
        errors.push(`${refdes}: unknown built-in type ${inst.type}`);
      }
    } else if (inst.typeData.renderType === "subunit") {
      const m = SUBUNIT_PKG_RE.exec(inst.refdes);
      const key = m ? m[1] : inst.refdes;
      if (!packages.has(key)) packages.set(key, []);
      packages.get(key).push(inst);
    } else {
      lowerGalasm(inst.type, [inst], inst.typeData.pins);
    }
  }
  for (const insts of packages.values()) {
    lowerGalasm(insts[0].type, insts, insts.flatMap((i) => i.typeData.pins));
  }

  if (errors.length) throw new Error(errors.join("; "));

  // --- Vector columns (FR-117; the FR-115b/FR-115f derivation, from the
  // root design so only the top sheet contributes, FR-116 hierarchy) ---
  const cols = deriveColumns(columnsFrom);
  warnings.push(...cols.warnings);
  // Bidirectional (io) columns are slow-simulator only for now (FR-115i deferred
  // scope): the fast engine has no per-cycle force/release ABI yet, so they are
  // omitted with a warning and the FR-107 parity check skips them.
  if (cols.io.length) {
    warnings.push(
      `bidirectional bus columns are not yet supported by the fast C generator ` +
        `(FR-115i); omitted: ${cols.io.map((c) => c.label).join(", ")}`,
    );
  }
  const instByRefdes = new Map(design.components.map((c) => [c.refdes, c]));
  let clockPorts = 0; // clock-source port columns (FR-094f), counted while lowering
  const incols = cols.inputs.map((col) => {
    // (refdes,pin) identity baked alongside the label so tv2txt can
    // reconcile a .tv file to the row format via --columns (design §6.17 M2).
    // alow is the FR-115p stamp deriveColumns already applied (§6.16) — baked
    // rather than re-derived because the rule reads a portN's instance base
    // label, which the baked per-bit label cannot yield back (CS/ → CS/0). It
    // lets tv2txt default an omitted cell exactly as the panel does (M9).
    const id = {
      name: cstr(col.label),
      refdes: cstr(col.refdes),
      pin: cstr(col.pin),
      alow: col.activeLow ? 1 : 0,
    };
    if (col.kind === "clock") {
      if (clockIdx.has(col.refdes)) {
        return { kind: "RT_COL_CLOCK", ref: clockIdx.get(col.refdes), ...id, label: 0 };
      }
      // A clock-source port (FR-094f): a clock column whose refdes is a port, so
      // it has no gen_clocks entry. It forces its own net exactly like an
      // ordinary port column below, and the runner pulses it there. Deliberately
      // NOT lowered as a synthesized gen_clocks entry: that would make
      // gen_clock_count > 0 and hand the port a free-running FR-084 square wave
      // in --cycles mode (plus a clock_period vote) that the slow engine does not
      // have — a divergence outside vector mode, where no parity leg would catch
      // it. FR-094f keeps a marked port out of the free-running path entirely.
      clockPorts++;
      return {
        kind: "RT_COL_PORT_CLOCK",
        ref: netOf(`${col.refdes}.${col.pin}`),
        ...id,
        label: intern(`${col.refdes}.${col.pin}`),
      };
    }
    if (instByRefdes.get(col.refdes)?.typeData?.renderType === "switch") {
      return { kind: "RT_COL_SWITCH", ref: switchIdx.get(col.refdes), ...id, label: 0 };
    }
    // A port column forces its net directly (FR-115f external stimulus).
    return {
      kind: "RT_COL_PORT",
      ref: netOf(`${col.refdes}.${col.pin}`),
      ...id,
      label: intern(`${col.refdes}.${col.pin}`),
    };
  });
  const outcols = cols.outputs.map((col) => ({
    net: netOf(`${col.refdes}.${col.pin}`),
    name: cstr(col.label),
    refdes: cstr(col.refdes),
    pin: cstr(col.pin),
  }));

  // The runtime's own drivers, in its drive_builtins order, then memory data
  // bits (mem_drive_all) — the tail of the contribution order (M12).
  for (const p of pulls) p.slot = driver(p.net, p.label, 1);
  for (const s of switches) s.slot = driver(s.net, s.label);
  for (const c of clocks) c.slot = driver(c.net, c.label);
  for (const r of resets) {
    r.rSlot = driver(r.rNet, r.rLabel);
    r.rnSlot = driver(r.rnNet, r.rnLabel);
  }
  for (const c of incols) {
    c.slot = c.kind === "RT_COL_PORT" || c.kind === "RT_COL_PORT_CLOCK" ? driver(c.ref, c.label) : null;
  }
  for (const m of mems) m.dataSlot = m.data.map((n, b) => driver(n, m.dataLabel[b]));

  // Number the slots: a stable sort by net keeps each net's drivers contiguous
  // and in contribution order, which resolution relies on to name the first
  // 0- and 1-driver in a bus-conflict report (FR-108).
  const order = drivers.map((_, k) => k).sort((a, b) => drivers[a].net - drivers[b].net || a - b);
  const slotOf = new Array(drivers.length);
  order.forEach((k, slot) => (slotOf[k] = slot));
  const slotStart = new Array(nets.length + 1).fill(0);
  for (const d of drivers) slotStart[d.net + 1]++;
  for (let n = 0; n < nets.length; n++) slotStart[n + 1] += slotStart[n];
  // A placeholder token (from driver()) → its slot number, or -1 for none.
  const sl = (tok) => (tok ? slotOf[Number(tok.slice(2, -1))] : -1);
  const fillSlots = (text) => text.replace(/@S(\d+)@/g, (_, k) => String(slotOf[Number(k)]));

  // --- Emit ---
  const L = [];
  L.push(`/* ${design.name ?? "design"} — generated by retrosim (fast engine, specs §3.23).`);
  L.push(` * Compile with the runtime pair delivered alongside this file:`);
  L.push(` *   cc <this file> runtime.c`);
  L.push(` * Do not edit: regenerate from the design instead. */`);
  L.push(``);
  L.push(`#include "runtime.h"`);
  L.push(``);
  L.push(`const int gen_net_count = ${nets.length};`);
  L.push(``);
  if (labels.length) {
    L.push(`const char *const gen_labels[] = {`);
    labels.forEach((s, i) => L.push(`  ${cstr(s)},${i % 4 === 3 ? "" : ""}`));
    L.push(`};`);
  } else {
    L.push(`const char *const gen_labels[] = { "" }; /* none */`);
  }
  L.push(`const int gen_label_count = ${labels.length};`);
  L.push(``);

  // Driver slots (M12): per slot its net, label and tier, and the CSR table of
  // each net's slots [gen_net_slot_start[n], gen_net_slot_start[n+1]).
  const slotRows = (vals) => {
    const out = [];
    for (let i = 0; i < vals.length; i += 16) out.push(`  ${vals.slice(i, i + 16).join(", ")},`);
    return out;
  };
  const sorted = order.map((k) => drivers[k]);
  L.push(`/* --- driver slots (FR-116a, design §6.17 M12) --- */`);
  L.push(`const int gen_slot_count = ${drivers.length};`);
  L.push(`const int gen_net_slot_start[] = {`, ...slotRows(slotStart), `};`);
  if (drivers.length) {
    L.push(`const int gen_slot_net[] = {`, ...slotRows(sorted.map((d) => d.net)), `};`);
    L.push(`const int gen_slot_label[] = {`, ...slotRows(sorted.map((d) => d.label)), `};`);
    L.push(`const unsigned char gen_slot_weak[] = {`, ...slotRows(sorted.map((d) => d.weak)), `};`);
  } else {
    L.push(`const int gen_slot_net[] = { -1 }; /* none */`);
    L.push(`const int gen_slot_label[] = { 0 }; /* none */`);
    L.push(`const unsigned char gen_slot_weak[] = { 0 }; /* none */`);
  }
  L.push(``);

  // Evaluation units (M13): the net → reading-units fanout CSR, and per
  // instance-state array the units reading it (marked by gen_latch).
  const fan = nets.map(() => []);
  const stateDeps = new Map(); // "reg_<tag>" / "latch_<tag>" → [unit]
  units.forEach((u, i) => {
    for (const n of u.nets) fan[n].push(i);
    for (const k of u.states) {
      if (!stateDeps.has(k)) stateDeps.set(k, []);
      stateDeps.get(k).push(i);
    }
  });
  const fanStart = [0];
  for (const f of fan) fanStart.push(fanStart.at(-1) + f.length);
  L.push(`/* --- evaluation units (FR-110a, design §6.17 M13) --- */`);
  L.push(`const int gen_unit_count = ${units.length};`);
  L.push(`const int gen_net_fan_start[] = {`, ...slotRows(fanStart), `};`);
  if (fanStart.at(-1)) L.push(`const int gen_net_fan[] = {`, ...slotRows(fan.flat()), `};`);
  else L.push(`const int gen_net_fan[] = { -1 }; /* none */`);
  for (const [k, list] of stateDeps) {
    L.push(`static const int deps_${k}[] = { ${list.join(", ")} };`);
  }
  L.push(``);

  L.push(`/* --- built-in instances (behaviors live in runtime.c, FR-116a) --- */`);
  if (pulls.length) {
    L.push(`const rt_pull gen_pulls[] = {`);
    for (const p of pulls) L.push(`  { ${p.net}, ${p.value}, ${sl(p.slot)} },`);
    L.push(`};`);
  } else {
    L.push(`const rt_pull gen_pulls[] = { { -1, RT_0, -1 } }; /* none */`);
  }
  L.push(`const int gen_pull_count = ${pulls.length};`);
  L.push(``);
  if (switches.length) {
    L.push(`rt_switch gen_switches[] = {`);
    for (const s of switches) L.push(`  { ${s.net}, ${s.level}, ${sl(s.slot)} }, /* ${s.refdes} */`);
    L.push(`};`);
  } else {
    L.push(`rt_switch gen_switches[] = { { -1, RT_0, -1 } }; /* none */`);
  }
  L.push(`const int gen_switch_count = ${switches.length};`);
  L.push(``);
  if (clocks.length) {
    L.push(`rt_clock gen_clocks[] = {`);
    for (const c of clocks) {
      L.push(`  { ${c.net}, RT_0, ${c.period}, ${c.label}, ${sl(c.slot)} }, /* ${c.refdes} */`);
    }
    L.push(`};`);
  } else {
    L.push(`rt_clock gen_clocks[] = { { -1, RT_0, 0, 0, -1 } }; /* none */`);
  }
  L.push(`const int gen_clock_count = ${clocks.length};`);
  L.push(``);
  if (resets.length) {
    L.push(`rt_reset gen_resets[] = {`);
    for (const r of resets) {
      L.push(
        `  { ${r.rNet}, ${r.rnNet}, ${r.cycles}, 0, ${sl(r.rSlot)}, ${sl(r.rnSlot)} }, /* ${r.refdes} */`,
      );
    }
    L.push(`};`);
  } else {
    L.push(`rt_reset gen_resets[] = { { -1, -1, 0, 0, -1, -1 } }; /* none */`);
  }
  L.push(`const int gen_reset_count = ${resets.length};`);
  L.push(``);

  // Memory devices (FR-114d): per-instance pin-net/slot arrays, then the
  // gen_mems table referencing them. A ROM's refdes + content-file path are
  // baked for the runtime's startup load (FR-117b); a persistent RAM's
  // save-file path + load-on-start flag are baked for load/write-back
  // (FR-114g/FR-117c). No contents are baked.
  for (const m of mems) {
    L.push(`static const int mem_addr_${m.tag}[] = { ${m.addr.join(", ")} };`);
    L.push(`static const int mem_data_${m.tag}[] = { ${m.data.join(", ")} };`);
    L.push(`static const int mem_dslot_${m.tag}[] = { ${m.dataSlot.map(sl).join(", ")} };`);
  }
  if (mems.length) {
    L.push(`const rt_mem gen_mems[] = {`);
    for (const m of mems) {
      const romFile = m.romFile ? cstr(m.romFile) : "0";
      const ramFile = m.ramFile ? cstr(m.ramFile) : "0";
      L.push(
        `  { ${m.kind}, ${m.n}, ${m.w}, mem_addr_${m.tag}, mem_data_${m.tag}, mem_dslot_${m.tag}, ${m.ce}, ${m.oe}, ${m.we}, ${cstr(m.refdes)}, ${romFile}, ${ramFile}, ${m.ramLoad} }, /* ${m.tag} */`,
      );
    }
    L.push(`};`);
  } else {
    L.push(`const rt_mem gen_mems[] = { { 0, 0, 0, 0, 0, 0, -1, -1, -1, 0, 0, 0, 0 } }; /* none */`);
  }
  L.push(`const int gen_mem_count = ${mems.length};`);
  L.push(``);

  // Magic UARTs (FR-122d): per-instance data-net array, then the gen_uarts
  // table (data nets + CS//CE//CLK net indices + refdes). The runtime owns the
  // latch/gate/emit; the UART drives nothing, so it adds no driver.
  for (const u of uarts) {
    L.push(`static const int uart_data_${u.tag}[] = { ${u.data.join(", ")} };`);
  }
  if (uarts.length) {
    L.push(`const rt_uart gen_uarts[] = {`);
    for (const u of uarts) {
      L.push(
        `  { uart_data_${u.tag}, ${u.cs}, ${u.ce}, ${u.clk}, ${cstr(u.refdes)} }, /* ${u.tag} */`,
      );
    }
    L.push(`};`);
  } else {
    L.push(`const rt_uart gen_uarts[] = { { 0, -1, -1, -1, 0 } }; /* none */`);
  }
  L.push(`const int gen_uart_count = ${uarts.length};`);
  // gen_latch_count > 0 marks a transparent latch present (FR-079d): a
  // clock-less latch design is still STATEFUL, so the vector runner must run its
  // rows in order on persistent state (FR-115e), like a clocked design — the C
  // analogue of vectors.js isStateful (§6.16).
  const latchCount = latchUnits.reduce((n, u) => n + u.latches.length, 0);
  L.push(`const int gen_latch_count = ${latchCount};`);
  // gen_clockport_count > 0 marks a clock-source port present (FR-094f): another
  // way for a design to be STATEFUL with no clock generator placed, and the
  // runner's cue that some clock columns pulse through port_stim rather than
  // gen_clocks. Counted from the lowered columns above, not scanned separately.
  L.push(`const int gen_clockport_count = ${clockPorts};`);
  L.push(``);

  L.push(`/* --- vector columns (FR-117; column order is the row format) --- */`);
  if (incols.length) {
    L.push(`const rt_incol gen_incols[] = {`);
    for (const c of incols) {
      L.push(`  { ${c.kind}, ${c.ref}, ${c.name}, ${c.refdes}, ${c.pin}, ${sl(c.slot)}, ${c.alow} },`);
    }
    L.push(`};`);
  } else {
    L.push(`const rt_incol gen_incols[] = { { RT_COL_SWITCH, -1, "", "", "", -1, 0 } }; /* none */`);
  }
  L.push(`const int gen_incol_count = ${incols.length};`);
  L.push(``);
  if (outcols.length) {
    L.push(`const rt_outcol gen_outcols[] = {`);
    for (const c of outcols) L.push(`  { ${c.net}, ${c.name}, ${c.refdes}, ${c.pin} },`);
    L.push(`};`);
  } else {
    L.push(`const rt_outcol gen_outcols[] = { { -1, "", "", "" } }; /* none */`);
  }
  L.push(`const int gen_outcol_count = ${outcols.length};`);
  L.push(``);

  L.push(`/* --- registered state (FR-079/FR-079a .R outputs) --- */`);
  for (const u of regUnits) {
    L.push(`static rt_val reg_${u.tag}[${u.regs.length}];`);
    // Feedback snapshot (FR-079e), the C form of sim.js's per-entity fb map:
    // what this instance's own equations read in place of these outputs' nets.
    L.push(`static rt_val regprev_${u.tag}[${u.regs.length}];`);
    if (u.hasGlobal) L.push(`static rt_val prevClk_${u.tag};`);
    for (const r of u.regs) if (r.clkExpr) L.push(`static rt_val prevClk_${u.tag}_${r.k};`);
  }
  if (regUnits.length) L.push(``);
  L.push(`/* --- transparent-latch state (FR-079d .L outputs) --- */`);
  for (const u of latchUnits) L.push(`static rt_val latch_${u.tag}[${u.latches.length}];`);
  if (latchUnits.length) L.push(``);

  L.push(`/* --- power-up state (FR-116a; reapplied per combinational row) --- */`);
  L.push(`void gen_init(void) {`);
  switches.forEach((s, i) => L.push(`  gen_switches[${i}].level = ${s.level}; /* ${s.refdes} baked state */`));
  clocks.forEach((c, i) => L.push(`  gen_clocks[${i}].level = RT_0;`));
  resets.forEach((r, i) => L.push(`  gen_resets[${i}].released = 0;`));
  for (const u of regUnits) {
    for (const r of u.regs) L.push(`  reg_${u.tag}[${r.k}] = RT_U; /* power-up U (FR-079) */`);
    // U either way, negated LHS or not — matching an empty fb map reading Z→U.
    for (const r of u.regs) L.push(`  regprev_${u.tag}[${r.k}] = RT_U; /* FR-079e */`);
    if (u.hasGlobal) L.push(`  prevClk_${u.tag} = RT_U;`);
    for (const r of u.regs) if (r.clkExpr) L.push(`  prevClk_${u.tag}_${r.k} = RT_U;`);
  }
  for (const u of latchUnits) {
    for (const t of u.latches) L.push(`  latch_${u.tag}[${t.k}] = RT_U; /* power-up U (FR-079d) */`);
  }
  L.push(`}`);
  L.push(``);
  L.push(`/* --- registered latch: .R outputs (FR-079/FR-079a, sim.js updateRegisters) --- */`);
  // Every state store goes through rt_upd, so gen_latch can report whether the
  // phase changed anything: the free-run fixed-point test (FR-117d).
  L.push(`int gen_latch(const rt_val *curr) {`);
  L.push(`  int ch = 0;`);
  if (!regUnits.length && !latchUnits.length) L.push(`  (void)curr;`);
  // Each instance's block keeps its own change flag, so a change marks the
  // units reading that instance's state for re-evaluation (M13).
  const markState = (key) => {
    const list = stateDeps.get(key) ?? [];
    return list.length
      ? `  if (c) { ch = 1; rt_mark_units(deps_${key}, ${list.length}); }`
      : `  ch |= c;`;
  };
  for (const u of regUnits) {
    L.push(`  { int c = 0;`);
    // Feedback snapshot before this unit latches (FR-079e, sim.js
    // snapshotFeedback): the value each .R macrocell presents — the register
    // with its LHS negation, no .E gating — read by this instance's own
    // equations here and in gen_drive, which rt_step runs later in the step.
    for (const r of u.regs) {
      const v = r.lhsLow ? `rt_not(reg_${u.tag}[${r.k}])` : `reg_${u.tag}[${r.k}]`;
      L.push(`    c |= rt_upd(&regprev_${u.tag}[${r.k}], ${v});`);
    }
    if (u.hasGlobal) {
      const clk = u.clockNet >= 0 ? `curr[${u.clockNet}]` : `RT_Z`;
      L.push(`    rt_val gclk = ${clk}; /* global clock: pin */`);
      L.push(`    int grose = (prevClk_${u.tag} == RT_0 && gclk == RT_1);`);
      L.push(`    if (grose) {`);
      for (const k of u.globalIdxs) L.push(`      c |= rt_upd(&reg_${u.tag}[${k}], ${u.regs[k].dExpr});`);
      L.push(`    }`);
      if (u.spExpr) {
        L.push(`    if (grose) { rt_val s = ${u.spExpr}; if (s != RT_0) { /* global SP */`);
        for (const k of u.globalIdxs) L.push(`      c |= rt_upd(&reg_${u.tag}[${k}], (s == RT_1) ? RT_1 : RT_U);`);
        L.push(`    } }`);
      }
      if (u.arExpr) {
        L.push(`    { rt_val a = ${u.arExpr}; if (a != RT_0) { /* global AR (async) */`);
        for (const k of u.globalIdxs) L.push(`      c |= rt_upd(&reg_${u.tag}[${k}], (a == RT_1) ? RT_0 : RT_U);`);
        L.push(`    } }`);
      }
      L.push(`    c |= rt_upd(&prevClk_${u.tag}, gclk);`);
    }
    for (const r of u.regs) {
      if (!r.clkExpr) continue;
      L.push(`    { rt_val clk = ${r.clkExpr}; /* per-output .CLK */`);
      L.push(`      if (prevClk_${u.tag}_${r.k} == RT_0 && clk == RT_1) c |= rt_upd(&reg_${u.tag}[${r.k}], ${r.dExpr});`);
      L.push(`      c |= rt_upd(&prevClk_${u.tag}_${r.k}, clk);`);
      if (r.aprstExpr)
        L.push(`      { rt_val p = ${r.aprstExpr}; if (p != RT_0) c |= rt_upd(&reg_${u.tag}[${r.k}], (p == RT_1) ? RT_1 : RT_U); } /* .APRST */`);
      if (r.arstExpr)
        L.push(`      { rt_val a = ${r.arstExpr}; if (a != RT_0) c |= rt_upd(&reg_${u.tag}[${r.k}], (a == RT_1) ? RT_0 : RT_U); } /* .ARST wins */`);
      L.push(`    }`);
    }
    L.push(`  ${markState(`reg_${u.tag}`)}`);
    L.push(`  }`);
  }
  // Transparent latches (FR-079d, sim.js updateLatches): level-sensitive, in the
  // same phase as registers — .ARST clears first, then capture while .G is 1,
  // hold while 0, store U while U. No edge, no clock.
  for (const u of latchUnits) {
    L.push(`  { int c = 0;`);
    for (const t of u.latches) {
      L.push(`  { /* latch ${u.tag}[${t.k}] */`);
      if (t.arstExpr)
        L.push(`    { rt_val a = ${t.arstExpr}; if (a != RT_0) c |= rt_upd(&latch_${u.tag}[${t.k}], (a == RT_1) ? RT_0 : RT_U); } /* .ARST clear first */`);
      L.push(`    rt_val g = ${t.gateExpr}; /* .G gate */`);
      L.push(`    if (g == RT_1) c |= rt_upd(&latch_${u.tag}[${t.k}], ${t.dExpr}); /* transparent */`);
      L.push(`    else if (g == RT_U) c |= rt_upd(&latch_${u.tag}[${t.k}], RT_U); /* pessimism */`);
      L.push(`    /* g == RT_0: hold */`);
      L.push(`  }`);
    }
    L.push(`  ${markState(`latch_${u.tag}`)}`);
    L.push(`  }`);
  }
  L.push(`  return ch;`);
  L.push(`}`);
  L.push(``);
  L.push(`/* --- evaluation units: one generated driver each (FR-081, FR-110a) --- */`);
  L.push(`void gen_eval(int unit, const rt_val *curr) {`);
  L.push(`  (void)curr;`);
  L.push(`  switch (unit) {`);
  units.forEach((u, i) => {
    L.push(`  case ${i}: { /* ${u.comment} */`);
    for (const line of u.lines) L.push(`    ${fillSlots(line)}`);
    L.push(`    break;`);
    L.push(`  }`);
  });
  L.push(`  default: break;`);
  L.push(`  }`);
  L.push(`}`);
  L.push(``);

  return { code: L.join("\n"), warnings };
}
