// Design rule check engine (§6.21, FR-124…FR-124d). This module is DOM-free and
// store-free: it takes a design, builds the netlist, and returns findings. All
// state, all DOM, and every store call live in chrome/drcpanel.js — which is what
// makes the whole rule catalog testable against hand-built designs with no
// browser (§11.1), the same division vectors.js/ndl.js use against their chrome.

import { buildNets } from "../model/netlist.js";
import { REF_SERIES } from "../model/design.js";
import { compileBehavior } from "./galasm.js";

// Severity ordering (FR-124b). Severity orders and colours the report and
// nothing else: there is no pass/fail verdict anywhere.
const SEVERITY_RANK = { error: 0, warning: 1, info: 2 };

// RULES is the whole catalog (FR-124a), in rule-id order. Each entry is a pure
// function (ctx) → Finding[]; adding a rule is one row plus one function, and
// nothing else dispatches on a rule id.
const RULES = [
  { id: "R1", fn: ruleR1 },
  { id: "R2", fn: ruleR2 },
  { id: "R3", fn: ruleR3 },
  { id: "R4", fn: ruleR4 },
  { id: "R5", fn: ruleR5 },
  { id: "R6", fn: ruleR6 },
  { id: "R7", fn: ruleR7 },
  { id: "R8", fn: ruleR8 },
  { id: "R9", fn: ruleR9 },
  { id: "R10", fn: ruleR10 },
];

// finding builds one Finding (FR-124c). `refs` is SORTED here, at construction,
// so a finding's identity is order-independent: two runs — and a run before and
// after an unrelated edit — produce byte-identical ref arrays, which is what
// lets a waiver match by set equality with no canonicalization at match time.
//
// The message gets its rule id appended here too, rather than in each of the ten
// rules: one place, so no rule can forget it or format it differently. The report
// also shows the rule in its own column (FR-124d) — the duplication is deliberate,
// since a message quoted or copied on its own has left that column behind.
function finding(rule, severity, message, refs) {
  return { rule, severity, message: `${message} (rule ${rule})`, refs: [...refs].sort() };
}

// packageOf groups sibling subunit instances into their package (FR-013a):
// "U5A".."U5D" are one package "U5", by exactly the scan pattern REF_SERIES.U
// already recognizes. Any other designator series is its own package.
function packageOf(refdes) {
  const m = REF_SERIES.U.exec(refdes);
  return m ? `U${m[1]}` : refdes;
}

// classify assigns a pin its rule-facing categories — the one thing in this
// module that is easy to get wrong. Pin `direction` (FR-062a) is NOT sufficient,
// because the pull-up and pull-down built-ins declare `direction: "out"`
// (builtins.js): a rule trusting direction alone would report an R1 output fight
// on every pulled-up open-collector net — the most common idiom in the target
// circuits — and R5 could never fire at all. Every rule consumes these
// categories, never `direction` (R1's combination table excepted, which needs to
// tell the strong kinds apart), so the trap is disarmed once rather than ten
// times.
//
//   weak   pull-up / pull-down host (FR-083)      → R4, R5
//   port   port / multi-bit port host (FR-094,    → suppresses R1, R3, R4, R9
//          FR-071e); a sheet boundary at every
//          width, never a defect (FR-124)
//   strong drives: out | tristate | bidir         → R1, R2, R4, R9
//   load   is driven: in | bidir                  → R3, R9
//
// `bidir` is deliberately BOTH strong and load — it drives and loads — which is
// what makes bidir+bidir normal in R1 and stops a bidirectional bus from being
// called load-less by R9.
function classify(inst, pin) {
  const renderType = inst.typeData?.renderType;
  const info = {
    key: `${inst.refdes}.${pin.name}`,
    refdes: inst.refdes,
    pinName: pin.name,
    direction: pin.direction,
    renderType,
    weak: false,
    port: false,
    strong: false,
    load: false,
  };
  if (renderType === "pullup" || renderType === "pulldown") {
    info.weak = true;
    return info;
  }
  if (renderType === "port" || renderType === "portN") {
    info.port = true;
    return info;
  }
  info.strong = pin.direction === "out" || pin.direction === "tristate" || pin.direction === "bidir";
  info.load = pin.direction === "in" || pin.direction === "bidir";
  return info;
}

// buildContext derives everything the rules read, once. Note what it has to add
// on top of buildNets: that function returns only nets with at least one
// connected pin (§6.6), so a pin touching no conductor at all appears in no net
// and is collected separately here — R3's second source (FR-124a).
function buildContext(design, { fileExists, warnings }) {
  const nets = buildNets(design, (msg) => warnings.push(msg));
  const instances = design.components ?? [];

  const netOfPin = new Map(); // "U3.Y0" → net index
  nets.forEach((net, i) => {
    for (const key of net.pins) netOfPin.set(key, i);
  });

  const pinInfo = new Map(); // "U3.Y0" → PinInfo, for EVERY pin of every instance
  const instByRefdes = new Map();
  const packages = new Map(); // "U5" → [instance, …]
  const unconnectedPins = [];
  for (const inst of instances) {
    instByRefdes.set(inst.refdes, inst);
    const pkg = packageOf(inst.refdes);
    if (!packages.has(pkg)) packages.set(pkg, []);
    packages.get(pkg).push(inst);
    for (const pin of inst.typeData?.pins ?? []) {
      const info = classify(inst, pin);
      pinInfo.set(info.key, info);
      if (!netOfPin.has(info.key)) unconnectedPins.push(info);
    }
  }

  // Per-net pin categories. A net pin with no matching instance pin (only
  // reachable in a hand-edited file) is skipped rather than guessed at.
  const netPins = nets.map((net) => net.pins.map((key) => pinInfo.get(key)).filter(Boolean));

  return {
    design,
    nets,
    netPins,
    netOfPin,
    pinInfo,
    instances,
    instByRefdes,
    packages,
    unconnectedPins,
    fileExists,
    warnings,
    compileCache: new Map(), // R2 only: type+unit → CompiledBehavior|null
    signalPins: new Map(), // R2 only: refdes → (signal → YAML pin name)
  };
}

// netLabel quotes a net's CURRENT display name for readability only (FR-124c).
// No finding is ever identified by it: a net has no persistent identity and
// `pickName` changes when a label moves, so identity is the pin set in `refs`.
function netLabel(net) {
  return net.name ?? "(unnamed net)";
}

// R1's combination table (FR-124a), as unordered pairs of pin directions:
// out+out, out+tristate (the tri-state can never win), and out+bidir fight;
// tristate+tristate, tristate+bidir, and bidir+bidir do not — bidir+bidir is
// precisely what a bidirectional bus looks like, and flagging it would flag
// every correct one.
const R1_FIGHTS = new Set();
for (const [a, b] of [
  ["out", "out"],
  ["out", "tristate"],
  ["out", "bidir"],
]) {
  R1_FIGHTS.add(`${a}+${b}`);
  R1_FIGHTS.add(`${b}+${a}`);
}

// R1 (output fight) — one finding PER NET, not per pair, listing every pin that
// takes part in some fight: a net with three plain outputs is one problem, and
// three findings for it would be three copies of the same fix. Only `strong`
// pins are considered, which is what keeps a pull-up (weak, though it declares
// `direction: "out"`) and a port (a sheet boundary) out of the fight entirely.
function ruleR1(ctx) {
  const findings = [];
  ctx.netPins.forEach((pins, i) => {
    const strong = pins.filter((p) => p.strong);
    const involved = new Set();
    for (let a = 0; a < strong.length; a++) {
      for (let b = a + 1; b < strong.length; b++) {
        if (!R1_FIGHTS.has(`${strong[a].direction}+${strong[b].direction}`)) continue;
        involved.add(strong[a]);
        involved.add(strong[b]);
      }
    }
    if (involved.size === 0) return;
    const parts = [...involved].sort((x, y) => (x.key < y.key ? -1 : 1));
    findings.push(
      finding(
        "R1",
        "error",
        `Output fight on net ${netLabel(ctx.nets[i])}: ` +
          parts.map((p) => `${p.key} (${p.direction})`).join(" vs "),
        parts.map((p) => p.key),
      ),
    );
  });
  return findings;
}

// compiledFor returns one instance's compiled behavior (§6.13), or null when the
// type has none or does not compile — a built-in, a sub-design instance, or a
// hand-edited block with an error. R2 is the only caller, and it is silent
// wherever this is null rather than guessing (FR-124a). Cached per type AND per
// subunit letter, since sibling units of one package carry different pin sets.
function compiledFor(ctx, inst) {
  const key = `${inst.type}|${inst.typeData?.unit ?? ""}`;
  if (!ctx.compileCache.has(key)) {
    let compiled = null;
    try {
      compiled = compileBehavior(inst.typeData);
    } catch {
      compiled = null; // a parse error is "no behavior" here; Run reports it
    }
    ctx.compileCache.set(key, compiled);
  }
  return ctx.compileCache.get(key);
}

// signalPinOf maps a behavior signal back to the YAML pin name that owns it on
// THIS instance's type — the same stripping rule sim.js uses to build pinOwner
// (§6.13): a signal is the pin name with any leading "/" removed. Returns null
// for a signal that owns no pin (a buried registered node, FR-079c).
function signalPinOf(ctx, inst, signal) {
  let map = ctx.signalPins.get(inst.refdes);
  if (!map) {
    map = new Map();
    for (const pin of inst.typeData?.pins ?? []) {
      map.set(pin.name.startsWith("/") ? pin.name.slice(1) : pin.name, pin.name);
    }
    ctx.signalPins.set(inst.refdes, map);
  }
  return map.get(signal) ?? null;
}

// enableOf resolves one tri-state pin's enable to { net, low }, or null.
//
// The resolution is the whole point of R2 and the easy thing to get wrong: the
// enable literal's signal names a pin on the instance's OWN type, so two
// instances of one part have TEXTUALLY IDENTICAL enables while wired to entirely
// different nets. Comparing signal names would flag a '245 pair sharing /OE on
// different buses — correct design. So resolve signal → refdes.pinName → net
// index, exactly the mapping sim.js builds, and compare that.
//
// null when: the type has no compiled behavior, this pin heads no output, the
// output has no .E term, or — deliberately — the .E term has more than one
// literal. Multi-literal enables (/OE * /CS) are NOT compared even when
// identical: FR-124a draws the line at one net with one polarity, and every step
// past it is a step toward theorem-proving.
function enableOf(ctx, pin) {
  const inst = ctx.instByRefdes.get(pin.refdes);
  if (!inst) return null;
  const compiled = compiledFor(ctx, inst);
  if (!compiled) return null;
  const output = compiled.outputs.find((o) => o.pin === pin.pinName);
  if (!output?.enable || output.enable.length !== 1) return null;
  const [literal] = output.enable;
  const enablePin = signalPinOf(ctx, inst, literal.signal);
  if (enablePin === null) return null;
  const net = ctx.netOfPin.get(`${pin.refdes}.${enablePin}`);
  if (net === undefined) return null;
  return { net, low: !!literal.low };
}

// R2 (same-enable contention) — the only rule that reaches past the netlist into
// the compiled enable term. Two or more tri-state drivers on ONE net whose
// enables resolve to the same net with the same polarity are guaranteed to fight
// the moment that signal asserts. A driver contributing no resolvable enable
// silences no one: it simply takes no part.
function ruleR2(ctx) {
  const findings = [];
  ctx.netPins.forEach((pins, i) => {
    const tristate = pins.filter((p) => p.strong && p.direction === "tristate");
    if (tristate.length < 2) return;
    const byEnable = new Map(); // "netIndex|low" → PinInfo[]
    for (const pin of tristate) {
      const enable = enableOf(ctx, pin);
      if (!enable) continue;
      const key = `${enable.net}|${enable.low}`;
      if (!byEnable.has(key)) byEnable.set(key, { enable, pins: [] });
      byEnable.get(key).pins.push(pin);
    }
    for (const { enable, pins: sharing } of byEnable.values()) {
      if (sharing.length < 2) continue;
      const parts = [...sharing].sort((x, y) => (x.key < y.key ? -1 : 1));
      findings.push(
        finding(
          "R2",
          "error",
          `Same-enable contention on net ${netLabel(ctx.nets[i])}: ` +
            `${parts.map((p) => p.key).join(", ")} are all enabled by ` +
            `${netLabel(ctx.nets[enable.net])} ${enable.low ? "low" : "high"}`,
          parts.map((p) => p.key),
        ),
      );
    }
  });
  return findings;
}

// R3 (undriven input) — ONE finding class from two sources (FR-124a): a pin on a
// real but undrivable net, and a pin touching no conductor at all. They are the
// same defect to a user — an unconnected spare gate's inputs are undriven inputs
// — and the second source cannot come from the netlist at all, since buildNets
// returns only nets with at least one connected pin (§6.6); it comes from the
// pins-minus-nets subtraction buildContext already did.
//
// A net counts as DRIVEN by any strong pin, by a weak pull (a pulled-up net has
// a defined level), or by a port — a sheet boundary is presumed driven by the
// parent sheet and is never a defect (FR-124).
function ruleR3(ctx) {
  const findings = [];
  ctx.netPins.forEach((pins, i) => {
    if (pins.some((p) => p.strong || p.weak || p.port)) return;
    for (const pin of pins.filter((p) => p.load)) {
      findings.push(
        finding(
          "R3",
          "warning",
          `Undriven input ${pin.key}: net ${netLabel(ctx.nets[i])} has no driver`,
          [pin.key],
        ),
      );
    }
  });
  for (const pin of ctx.unconnectedPins) {
    if (!pin.load) continue;
    findings.push(
      finding("R3", "warning", `Undriven input ${pin.key}: it is connected to nothing`, [pin.key]),
    );
  }
  return findings;
}

// R4 (can-float net) — a 1-bit net whose every strong driver is tri-state, with
// no pull to hold it: it has no defined level once every driver is disabled.
//
// The 1-bit test is the net's, NOT the conductor's: a net is exempt exactly when
// it carries no `wire:` lane, i.e. it lives purely inside buses and is therefore
// one lane of a bus, where floating is normal TTL practice (FR-124a). A net that
// includes a plain wire is a lone signal and is checked — including a single lane
// broken out of a bus (FR-043a), whose net is ["wire:w1", "bus:b1:2"]: one bit,
// however wide the bus it was tapped from.
//
// Being net-scoped, the finding identifies itself by the net's PIN SET (FR-124c),
// not by a net name: a net has no persistent identity and its name moves with its
// labels.
function ruleR4(ctx) {
  const findings = [];
  ctx.netPins.forEach((pins, i) => {
    const net = ctx.nets[i];
    if (!net.lanes.some((lane) => lane.startsWith("wire:"))) return;
    const strong = pins.filter((p) => p.strong);
    if (strong.length === 0 || !strong.every((p) => p.direction === "tristate")) return;
    if (pins.some((p) => p.weak || p.port)) return;
    findings.push(
      finding(
        "R4",
        "warning",
        `Net ${netLabel(net)} can float: every driver on it is tri-state and ` +
          `nothing pulls it up or down`,
        pins.map((p) => p.key),
      ),
    );
  });
  return findings;
}

// R5 (opposing pulls) — a net pulled both up and down. Its refs are the pull
// INSTANCES rather than their pins (§6.21): the object a user selects and fixes
// is the resistor, and a pull built-in has exactly one pin anyway.
function ruleR5(ctx) {
  const findings = [];
  ctx.netPins.forEach((pins, i) => {
    const weak = pins.filter((p) => p.weak);
    if (!weak.some((p) => p.renderType === "pullup")) return;
    if (!weak.some((p) => p.renderType === "pulldown")) return;
    const parts = [...weak].sort((x, y) => (x.refdes < y.refdes ? -1 : 1));
    findings.push(
      finding(
        "R5",
        "warning",
        `Opposing pulls on net ${netLabel(ctx.nets[i])}: ` +
          parts
            .map((p) => `${p.refdes} (${p.renderType === "pullup" ? "pull-up" : "pull-down"})`)
            .join(" vs "),
        [...new Set(parts.map((p) => p.refdes))],
      ),
    );
  });
  return findings;
}

// R6 (unconnected outputs) — judged PER PACKAGE, never per unit (FR-124a):
// connecting any one of U5A–U5D's outputs silences R6 for the whole 7400.
// Consequently a partially-used counter (Q0–Q3 wired, Q4–Q7 bare) is silent too,
// and an entirely unconnected spare unit in a used package is not an R6 finding
// — what is reported there is its floating inputs (R3), the genuine TTL hazard.
//
// The ≥1-output-capable-pin guard is essential, not a nicety: without it every
// magic UART (FR-122 — all inputs, no outputs) and every indicator is reported
// vacuously, on the strength of having no outputs to leave unconnected.
function ruleR6(ctx) {
  const findings = [];
  for (const [pkg, insts] of ctx.packages) {
    const outputs = [];
    for (const inst of insts) {
      for (const pin of inst.typeData?.pins ?? []) {
        const info = ctx.pinInfo.get(`${inst.refdes}.${pin.name}`);
        if (info?.strong) outputs.push(info);
      }
    }
    if (outputs.length === 0) continue;
    if (outputs.some((o) => ctx.netOfPin.has(o.key))) continue;
    findings.push(
      finding("R6", "warning", `No output of ${pkg} is connected to anything`, [
        ...new Set(insts.map((i) => i.refdes)),
      ]),
    );
  }
  return findings;
}

// R7 (dangling conductor end) — a wire or bus endpoint free IN SPACE. Like R3's
// second source this cannot come from the netlist: it is a property of the
// vertex graph (§7.1a), so it walks `kind === "free"` vertices and keeps those
// some conductor's path actually references (a free vertex nothing references is
// not a dangling end; it is nothing at all).
//
// `kind === "free"` is NOT the same question as "is this end unconnected", and
// the difference is the whole rule: `planBusEndpoint` (§6.9) returns
// `spec: { kind: "free" }` for a component target and records the connection in
// the bus's `groupConnections`, and `snapBusGroup` never touches the vertex kind
// — so every group-snapped bus end in every design is a `free` vertex sitting at
// the brace apex, fully connected. Counting those made R7 report 71 dangling ends
// on examples/notL4C381.json of which 69 were ordinary snaps, and a rule that is
// 97% noise is not read at all. The vertex kind answers who owns the position, not
// whether the end is connected; group snap is the one connection that leaves it
// unchanged, so it is the one exclusion.
//
// Severity is info because FR-018a permits real dangling ends deliberately — a
// wire drawn out to be finished later is not an error — and refs use the
// conductorId:vertexId form, the only rule that does, so the reveal can target the
// loose END rather than the whole conductor (FR-124f).
function ruleR7(ctx) {
  const snapped = new Set(); // bus ends connected to a pin group (FR-041/FR-042)
  for (const bus of ctx.design.buses ?? []) {
    for (const gc of bus.groupConnections ?? []) snapped.add(gc.vertex);
  }

  const byVertex = new Map(); // vertex id → [conductor id, …]
  for (const conductor of [...(ctx.design.wires ?? []), ...(ctx.design.buses ?? [])]) {
    for (const point of conductor.path ?? []) {
      if (point.t !== "node") continue;
      if (!byVertex.has(point.v)) byVertex.set(point.v, []);
      byVertex.get(point.v).push(conductor.id);
    }
  }
  const findings = [];
  for (const vertex of ctx.design.vertices ?? []) {
    if (vertex.kind !== "free" || snapped.has(vertex.id)) continue;
    const ids = byVertex.get(vertex.id);
    if (!ids) continue;
    const sorted = [...new Set(ids)].sort();
    findings.push(
      finding(
        "R7",
        "info",
        `Dangling end of ${sorted.join(", ")} at (${vertex.x}, ${vertex.y})`,
        sorted.map((id) => `${id}:${vertex.id}`),
      ),
    );
  }
  return findings;
}

// R8 (stray component) — an instance with no pin on any net: something placed
// and then forgotten. Suppressed for the whole package (the R6 grouping) as soon
// as any sibling unit is connected: an unwired spare gate in a used 7400 is not
// a stray component, and its real defect — floating inputs — is already R3
// (FR-124a). An instance with no pins at all is skipped, which is what keeps the
// text note (FR-071f) out of the report: it is an annotation, and being
// connected to nothing is its normal condition.
function ruleR8(ctx) {
  const findings = [];
  for (const insts of ctx.packages.values()) {
    const pinsOf = (inst) => inst.typeData?.pins ?? [];
    const connected = insts.some((inst) =>
      pinsOf(inst).some((pin) => ctx.netOfPin.has(`${inst.refdes}.${pin.name}`)),
    );
    if (connected) continue;
    for (const inst of insts) {
      if (pinsOf(inst).length === 0) continue;
      findings.push(
        finding("R8", "info", `${inst.refdes} is placed but connected to nothing`, [inst.refdes]),
      );
    }
  }
  return findings;
}

// R9 (no loads) — a net something drives that nothing listens to. R9 is
// NET-based where R6 is pin-and-package-based, which is why both exist: R6 goes
// quiet the moment an output is wired anywhere, so R9 is what catches a wire to
// nowhere, or a bus lane whose destination was deleted (FR-124a).
//
// A port pin suppresses it — the parent sheet is the load (FR-124) — and so does
// any load pin, which is why a bidir-only net is silent: `bidir` is in both
// categories, so such a net loads itself.
function ruleR9(ctx) {
  const findings = [];
  ctx.netPins.forEach((pins, i) => {
    if (!pins.some((p) => p.strong || p.weak)) return;
    if (pins.some((p) => p.load || p.port)) return;
    findings.push(
      finding(
        "R9",
        "info",
        `Net ${netLabel(ctx.nets[i])} drives nothing: no input pin is on it`,
        pins.map((p) => p.key),
      ),
    );
  });
  return findings;
}

// R10 (unresolvable port target) — the one rule that is not a pure function of
// the design, and the only reason runDesignRuleCheck is async.
//
// It probes through the injected `fileExists(file) → Promise<bool>|bool`. The
// engine passes the port's `target.file` VERBATIM — a bare sibling filename in
// the same folder (FR-101) — because resolving it needs the design's save
// directory, which lives in the store, not in the design; the caller that
// injects the probe is the one that knows the path. That keeps this module
// store-free.
//
// Two behaviors matter more than the finding itself:
//   - `fileExists === null` (no project, unit test, offline) reports NOTHING at
//     all. An unanswerable probe must never be turned into a finding (FR-124a).
//   - a probe that throws or rejects (server down, FR-089) reports nothing and
//     adds one warning; the other nine rules are unaffected, so a check is still
//     useful with no server.
function isPort(inst) {
  const renderType = inst.typeData?.renderType;
  return renderType === "port" || renderType === "portN";
}

async function ruleR10(ctx) {
  if (typeof ctx.fileExists !== "function") return [];
  const findings = [];
  for (const inst of ctx.instances) {
    const file = inst.target?.file;
    if (!file || !isPort(inst)) continue;
    let exists;
    try {
      exists = await ctx.fileExists(file);
    } catch (e) {
      ctx.warnings.push(
        `R10: the file probe failed (${e.message}); off-sheet port targets were not checked`,
      );
      return [];
    }
    if (!exists) {
      findings.push(
        finding("R10", "info", `${inst.refdes} targets ${file}, which does not resolve`, [
          inst.refdes,
        ]),
      );
    }
  }
  return findings;
}

// runDesignRuleCheck is the engine's whole entry point (FR-124). It is async for
// one reason only: R10 probes the filesystem for a port's off-sheet target.
export async function runDesignRuleCheck(design, { fileExists = null } = {}) {
  const warnings = [];
  const ctx = buildContext(design, { fileExists, warnings });

  // A rule that throws costs only its own findings: ten independent rules should
  // not be an all-or-nothing pass, and a rule bug must not make the checker
  // useless (§6.21).
  const findings = [];
  for (const rule of RULES) {
    try {
      findings.push(...(await rule.fn(ctx)));
    } catch (e) {
      warnings.push(`${rule.id}: rule failed (${e.message}); its findings are omitted`);
    }
  }

  // Ordering (FR-124d): severity, then rule id, then the ref string. Sorting by
  // refs last is what makes the report stable — it depends only on refdes
  // strings, which are immutable (FR-011c), never on net names (volatile,
  // FR-037b) or array positions (which any edit perturbs).
  findings.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0) ||
      (a.refs.join(",") < b.refs.join(",") ? -1 : a.refs.join(",") > b.refs.join(",") ? 1 : 0),
  );

  return { findings, warnings };
}

// waiverKey is the canonical identity of a finding for waiver matching (FR-124e):
// its rule id plus its ref SET. Both sides are sorted, so set equality reduces to
// a string compare of the joined arrays — findings sort their refs at
// construction, and a waiver's are sorted here in case the file was hand-edited.
// The NUL separator keeps a rule id from running into the first ref.
function waiverKey(rule, refs) {
  return `${rule} ${[...refs].sort().join(",")}`;
}

// applyWaivers partitions findings against the design's waivers (FR-124e). Pure,
// so it is testable with no design file at all.
//
//   active     the findings to show as the work list
//   waived     the findings a waiver suppressed — still shown, greyed, in the
//              collapsed "Waived (N)" section; nothing a waiver suppresses
//              becomes unreachable
//   unmatched  the waivers that matched nothing, which the caller DROPS
//              (FR-124e): their objects are gone from the design
//
// A malformed waiver from a hand-edited file (no `rule`, `refs` not an array)
// simply matches nothing and lands in `unmatched`, so the ordinary drop path
// removes it — no validation pass, no error, no crash.
export function applyWaivers(findings, waivers = []) {
  const list = Array.isArray(waivers) ? waivers : [];
  const keyOfWaiver = new Map();
  for (const waiver of list) {
    if (waiver && typeof waiver.rule === "string" && Array.isArray(waiver.refs)) {
      keyOfWaiver.set(waiver, waiverKey(waiver.rule, waiver.refs));
    }
  }
  const keys = new Set(keyOfWaiver.values());

  const active = [];
  const waived = [];
  const matched = new Set();
  for (const found of findings) {
    const key = waiverKey(found.rule, found.refs);
    if (keys.has(key)) {
      waived.push(found);
      matched.add(key);
    } else {
      active.push(found);
    }
  }
  return { active, waived, unmatched: list.filter((w) => !matched.has(keyOfWaiver.get(w))) };
}
