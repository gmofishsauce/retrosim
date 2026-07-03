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
// M1 scope (design §6.17): combinational designs. Registered outputs (.R)
// and memory devices are refused until M3; sub-design instances are refused
// per FR-116 deferred scope (fast-engine flattening is a later change).

import { compileBehavior } from "./galasm.js";
import { buildNets } from "../model/netlist.js";
import { deriveColumns } from "./vectors.js";

const SUBUNIT_PKG_RE = /^(U\d+)[A-Z]$/;

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
// (sub-design/memory/.R in M1 scope, behavior compile error) with all
// collected reasons, like buildSimulation's preflight. `romContent` is
// accepted for signature stability but unused until memory devices land (M3).
export function generateC(design, { romContent = null } = {}) {
  void romContent; // M3: baked ROM contents (FR-116a)
  const warnings = [];
  const errors = [];

  const nets = buildNets(design, (m) => warnings.push(m));
  const netOfPin = new Map(); // "refdes.pin" → net index
  nets.forEach((net, i) => {
    for (const pin of net.pins) netOfPin.set(pin, i);
  });
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
  const driveBlocks = []; // C fragments for gen_drive's body
  const pulls = [];
  const switches = [];
  const clocks = [];
  const resets = [];
  const switchIdx = new Map(); // refdes → gen_switches index
  const clockIdx = new Map(); // refdes → gen_clocks index
  const compileCache = new Map(); // type name → CompiledBehavior|null
  const reportedNoBehavior = new Set();
  const packages = new Map(); // shared U-number → [subunit insts]
  let driverCount = 0; // upper bound for gen_max_contribs

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
    const typeData = { name: typeName, pins, behavior: td0.behavior, gal: td0.gal };
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

    const refdesList = insts.map((i) => i.refdes).join(", ");
    if (c === null) {
      // No behavior block (FR-080) — a parse error is already in `errors`.
      if (!typeData.behavior) {
        if (!reportedNoBehavior.has(typeName)) {
          reportedNoBehavior.add(typeName);
          warnings.push(`${typeName}: no behavior defined; its outputs are U (FR-080)`);
        }
        const lines = [`  /* ${refdesList}: ${typeName} — no behavior, outputs U (FR-080) */`];
        for (const key of uPins) {
          lines.push(`  rt_contrib(${netOf(key)}, RT_U, 0, ${intern(key)}); /* ${key} */`);
          driverCount++;
        }
        driveBlocks.push(lines.join("\n"));
      }
      return;
    }

    for (const out of c.outputs) {
      if (out.kind === "R") {
        errors.push(
          `${typeName}: registered (.R) outputs are not yet supported by the C generator (design §6.17 M3)`,
        );
        return;
      }
    }

    // Expression lowering. A literal reads its net from curr: bare literals
    // normalize Z→U via rt_buf (galasm.js litValue), negated ones via rt_not;
    // an unconnected signal reads RT_Z, which normalizes to U identically.
    const litExpr = (lit) => {
      const n = netOf(pinOwner.get(lit.signal));
      const rd = n >= 0 ? `curr[${n}]` : `RT_Z`;
      const cm = n >= 0 ? lit.signal : `${lit.signal}:unconnected`;
      return lit.low ? `rt_not(${rd}) /* /${cm} */` : `rt_buf(${rd}) /* ${cm} */`;
    };
    // AND of a term's literals; the empty product (VCC) is true.
    const termExpr = (term) =>
      term.length === 0 ? "RT_1" : term.map(litExpr).reduce((a, b) => `rt_and(${a}, ${b})`);
    // OR of a sum's terms; the empty sum (GND) is false.
    const sumExpr = (terms) =>
      terms.length === 0 ? "RT_0" : terms.map(termExpr).reduce((a, b) => `rt_or(${a}, ${b})`);

    const lines = [`  /* ${refdesList}: ${typeName} */`];
    for (const out of c.outputs) {
      const key = pinOwner.get(out.signal);
      const lbl = intern(key);
      const net = netOf(key);
      lines.push(`  { /* ${key} */`);
      const body = [];
      body.push(`v = ${sumExpr(out.terms)};`);
      for (const group of out.xor ?? []) {
        body.push(`v = rt_xor(v, ${sumExpr(group)}); /* :+: */`);
      }
      if (out.lhsLow) body.push(`v = rt_not(v); /* declared active-low */`);
      if (out.enable) {
        // .T enable (FR-079/evalOutput): false → Z (no drive), U → U.
        lines.push(`    rt_val v;`);
        lines.push(`    rt_val e = ${termExpr(out.enable)}; /* .E */`);
        lines.push(`    if (e == RT_0) v = RT_Z;`);
        lines.push(`    else if (e == RT_U) v = RT_U;`);
        lines.push(`    else {`);
        for (const b of body) lines.push(`      ${b}`);
        lines.push(`    }`);
      } else {
        lines.push(`    rt_val v;`);
        for (const b of body) lines.push(`    ${b}`);
      }
      lines.push(`    rt_contrib(${net}, v, 0, ${lbl});`);
      lines.push(`  }`);
      driverCount++;
    }
    driveBlocks.push(lines.join("\n"));
  }

  for (const inst of design.components) {
    if (inst.childPath) {
      // FR-116 deferred scope: no fast-engine flattening yet.
      errors.push(
        `${inst.refdes}: sub-design instances are not supported by the C generator (FR-116)`,
      );
    } else if (inst.typeData.mem) {
      errors.push(
        `${inst.refdes}: memory devices are not yet supported by the C generator (design §6.17 M3)`,
      );
    } else if (inst.typeData.builtin) {
      const rt = inst.typeData.renderType;
      const refdes = inst.refdes;
      if (rt === "note" || rt === "indicator" || rt === "indicator8" || rt === "port" || rt === "portN") {
        // Annotations and probes: no drive (ports/indicators become columns).
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

  // --- Vector columns (FR-117; the FR-115b/FR-115f derivation) ---
  const cols = deriveColumns(design);
  warnings.push(...cols.warnings);
  const instByRefdes = new Map(design.components.map((c) => [c.refdes, c]));
  const incols = cols.inputs.map((col) => {
    // (refdes,pin) identity baked alongside the label so tv2txt can
    // reconcile a .tv file to the row format via --columns (design §6.17 M2).
    const id = { name: cstr(col.label), refdes: cstr(col.refdes), pin: cstr(col.pin) };
    if (col.kind === "clock") {
      return { kind: "RT_COL_CLOCK", ref: clockIdx.get(col.refdes), ...id, label: 0 };
    }
    if (instByRefdes.get(col.refdes)?.typeData?.renderType === "switch") {
      return { kind: "RT_COL_SWITCH", ref: switchIdx.get(col.refdes), ...id, label: 0 };
    }
    // A port column forces its net directly (FR-115f external stimulus).
    driverCount++;
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

  driverCount += pulls.length + switches.length + clocks.length + resets.length * 2;

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
  L.push(`const int gen_max_contribs = ${Math.max(driverCount, 1)};`);
  L.push(``);

  L.push(`/* --- built-in instances (behaviors live in runtime.c, FR-116a) --- */`);
  if (pulls.length) {
    L.push(`const rt_pull gen_pulls[] = {`);
    for (const p of pulls) L.push(`  { ${p.net}, ${p.value}, ${p.label} },`);
    L.push(`};`);
  } else {
    L.push(`const rt_pull gen_pulls[] = { { -1, RT_0, 0 } }; /* none */`);
  }
  L.push(`const int gen_pull_count = ${pulls.length};`);
  L.push(``);
  if (switches.length) {
    L.push(`rt_switch gen_switches[] = {`);
    for (const s of switches) L.push(`  { ${s.net}, ${s.level}, ${s.label} }, /* ${s.refdes} */`);
    L.push(`};`);
  } else {
    L.push(`rt_switch gen_switches[] = { { -1, RT_0, 0 } }; /* none */`);
  }
  L.push(`const int gen_switch_count = ${switches.length};`);
  L.push(``);
  if (clocks.length) {
    L.push(`rt_clock gen_clocks[] = {`);
    for (const c of clocks) {
      L.push(`  { ${c.net}, RT_0, ${c.period}, ${c.label} }, /* ${c.refdes} */`);
    }
    L.push(`};`);
  } else {
    L.push(`rt_clock gen_clocks[] = { { -1, RT_0, 0, 0 } }; /* none */`);
  }
  L.push(`const int gen_clock_count = ${clocks.length};`);
  L.push(``);
  if (resets.length) {
    L.push(`rt_reset gen_resets[] = {`);
    for (const r of resets) {
      L.push(
        `  { ${r.rNet}, ${r.rnNet}, ${r.cycles}, 0, ${r.rLabel}, ${r.rnLabel} }, /* ${r.refdes} */`,
      );
    }
    L.push(`};`);
  } else {
    L.push(`rt_reset gen_resets[] = { { -1, -1, 0, 0, 0, 0 } }; /* none */`);
  }
  L.push(`const int gen_reset_count = ${resets.length};`);
  L.push(``);

  L.push(`/* --- vector columns (FR-117; column order is the row format) --- */`);
  if (incols.length) {
    L.push(`const rt_incol gen_incols[] = {`);
    for (const c of incols) {
      L.push(`  { ${c.kind}, ${c.ref}, ${c.name}, ${c.refdes}, ${c.pin}, ${c.label} },`);
    }
    L.push(`};`);
  } else {
    L.push(`const rt_incol gen_incols[] = { { RT_COL_SWITCH, -1, "", "", "", 0 } }; /* none */`);
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

  L.push(`/* --- power-up state (FR-116a; reapplied per combinational row) --- */`);
  L.push(`void gen_init(void) {`);
  switches.forEach((s, i) => L.push(`  gen_switches[${i}].level = ${s.level}; /* ${s.refdes} baked state */`));
  clocks.forEach((c, i) => L.push(`  gen_clocks[${i}].level = RT_0;`));
  resets.forEach((r, i) => L.push(`  gen_resets[${i}].released = 0;`));
  L.push(`}`);
  L.push(``);
  L.push(`/* --- registered/memory state: none in this design (M1) --- */`);
  L.push(`void gen_latch(const rt_val *curr) { (void)curr; }`);
  L.push(``);
  L.push(`/* --- strong drivers, one fragment per instance (FR-081) --- */`);
  L.push(`void gen_drive(const rt_val *curr) {`);
  L.push(`  (void)curr;`);
  for (const b of driveBlocks) L.push(b);
  L.push(`}`);
  L.push(``);

  return { code: L.join("\n"), warnings };
}
