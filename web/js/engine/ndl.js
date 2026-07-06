// NDL netlist exporter (§6.18, FR-119a). Renders an already-flattened design
// (§6.14) as an NDL netlist — the plain-text pinout/package/circuit language
// documented in docs/netlist-language.md. Pure and synchronous; connectivity
// comes from buildNets (§6.6), physical package data (power pins, NC pins)
// from the FR-062e `physical:` block carried in each instance's typeData.
//
// Output is deterministic for a given design — stable ordering throughout, no
// timestamps — so successive exports diff cleanly.

import { buildNets } from "../model/netlist.js";

// Subunit siblings (U1A..U1D) collapse to their shared package stem (U1); the
// prefix-tolerant form groups a flattened child's subunits under its own
// instance (X1/U3A → X1/U3), mirroring sim.js/cgen.js (§6.13/§6.17).
const SUBUNIT_PKG_RE = /^((?:.*\/)?U\d+)[A-Z]$/;

// Built-ins with no physical package (FR-119a f): exported as comment lines,
// never as pinouts/packages. Ports are NOT here — they become the connector.
// Text notes have no pins and are skipped entirely.
const VIRTUAL_TYPES = new Set([
  "indicator", "indicator8", "pullup", "pulldown", "clock", "reset", "switch",
]);

const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true });

// NDL names must not contain whitespace or the delimiters = ; #
// (docs/netlist-language.md §1.1); anything else passes through.
function sanitizeName(s, fallback) {
  const t = (s ?? "").replace(/[\s=;#]+/g, "_").replace(/^_+|_+$/g, "");
  return t || fallback;
}

// Active-low rename: the YAML convention is a leading slash (/MR), the NDL
// convention a trailing prime (MR'). Only the leading slash translates.
function ndlPinName(name) {
  return name.startsWith("/") ? name.slice(1) + "'" : name;
}

// generateNDL(design, { name }) → { text, warnings }. `design` must already be
// flattened; a lingering sub-design instance is an internal error (FR-119).
export function generateNDL(design, { name = "design" } = {}) {
  const warnings = [];
  const circuitName = sanitizeName(name, "design");

  // ---- classify instances -------------------------------------------------
  const parts = []; // physical ICs incl. memory devices (unit/subunit)
  const ports = []; // port / portN instances → connector J1
  const virtuals = []; // clock/switch/indicator/pulls/reset → comments
  for (const inst of [...design.components].sort((x, y) => natural(x.refdes, y.refdes))) {
    const rt = inst.typeData?.renderType;
    if (inst.kind === "subdesign") {
      throw new Error(`internal: unflattened sub-design ${inst.refdes} in NDL export`);
    }
    if (rt === "note") continue;
    if (rt === "port" || rt === "portN") ports.push(inst);
    else if (VIRTUAL_TYPES.has(rt)) virtuals.push(inst);
    else if (inst.typeData) parts.push(inst);
    else warnings.push(`${inst.refdes}: no type data; skipped`);
  }

  // ---- types → pinouts (FR-119a a) ---------------------------------------
  // One pinout per distinct type id, named by display name (deduped). Types in
  // first-use order over the refdes-sorted parts. A saved subunit sibling's
  // typeData carries only its own unit's pins, so the package pinout is the
  // UNION of pins across every instance of the type (dedupe by name — the
  // §6.13 entity-building rule).
  const types = new Map(); // typeId -> { ndlName, pins, physical, displayName, pinNumber, invented }
  const usedTypeNames = new Set(["POWER"]); // reserve the synthetic names
  for (const inst of parts) {
    const id = inst.type ?? inst.typeData.name;
    const td = inst.typeData;
    if (!types.has(id)) {
      let ndlName = sanitizeName(td.name, "TYPE");
      for (let k = 2; usedTypeNames.has(ndlName); k++) {
        ndlName = `${sanitizeName(td.name, "TYPE")}_${k}`;
      }
      usedTypeNames.add(ndlName);
      types.set(id, {
        ndlName,
        displayName: td.name,
        pins: [],
        pinNames: new Set(),
        physical: td.physical ?? null,
        pinNumber: new Map(),
        invented: false,
      });
    }
    const t = types.get(id);
    for (const p of td.pins) {
      if (!t.pinNames.has(p.name)) {
        t.pinNames.add(p.name);
        t.pins.push(p);
      }
    }
    if (!t.physical && td.physical) t.physical = td.physical;
  }
  // Assign pin numbers per type: the recorded physical numbers where present,
  // else the lowest unused number (FR-062e degrade-gracefully; e.g. generated
  // memory devices carry no numbering).
  for (const [, t] of types) {
    const used = new Set();
    for (const p of t.pins) if (p.number != null) used.add(p.number);
    for (const pw of t.physical?.power ?? []) used.add(pw.number);
    for (const n of t.physical?.nc ?? []) used.add(n);
    let next = 1;
    for (const p of t.pins) {
      if (p.number != null) {
        t.pinNumber.set(p.name, p.number);
      } else {
        while (used.has(next)) next++;
        used.add(next);
        t.pinNumber.set(p.name, next);
        t.invented = true;
      }
    }
    if (t.invented) {
      warnings.push(`type ${t.displayName}: missing physical pin numbers; invented sequential numbers`);
    }
  }

  // ---- packages (FR-119a d) -----------------------------------------------
  // Exported instance name: subunit siblings collapse to their package stem.
  const exportedRef = new Map(); // refdes -> exported instance name
  const instancesByType = new Map(); // typeId -> ordered unique exported names
  for (const inst of parts) {
    const m = SUBUNIT_PKG_RE.exec(inst.refdes);
    const ename = m ? m[1] : inst.refdes;
    exportedRef.set(inst.refdes, ename);
    const id = inst.type ?? inst.typeData.name;
    if (!instancesByType.has(id)) instancesByType.set(id, []);
    const list = instancesByType.get(id);
    if (!list.includes(ename)) list.push(ename);
  }

  // ---- ports → connector J1 (FR-119a c) -----------------------------------
  // One pin per distinct 1-wide label; <label>0..(N-1) per portN. Same-label
  // 1-wide ports collapse (FR-094a). Pins in label order.
  const portRef = new Map(); // `${refdes}.${pin}` -> `J1.<name>`
  const connectorPins = []; // ordered distinct pin names
  const seenConnPin = new Set();
  const addConnPin = (pin) => {
    if (!seenConnPin.has(pin)) {
      seenConnPin.add(pin);
      connectorPins.push(pin);
    }
  };
  for (const inst of [...ports].sort(
    (x, y) => natural(x.label ?? x.refdes, y.label ?? y.refdes) || natural(x.refdes, y.refdes),
  )) {
    const label = sanitizeName(inst.label ?? inst.refdes, inst.refdes);
    if (inst.typeData.renderType === "port") {
      addConnPin(label);
      portRef.set(`${inst.refdes}.P`, `J1.${label}`);
    } else {
      const width = inst.typeData.pins.length;
      for (let i = 0; i < width; i++) {
        addConnPin(`${label}${i}`);
        portRef.set(`${inst.refdes}.P${i}`, `J1.${label}${i}`);
      }
    }
  }
  const connectorType = `${circuitName}_IO`;

  // ---- rails in use (FR-119a b) --------------------------------------------
  // Union of rail names across used types, in type order then entry order.
  const rails = [];
  for (const [, t] of types) {
    for (const pw of t.physical?.power ?? []) {
      const r = ndlPinName(pw.name);
      if (!rails.includes(r)) rails.push(r);
    }
  }

  // ---- emit pinouts/packages ----------------------------------------------
  const out = [];
  out.push("# NDL netlist — exported by retrosim (FR-119a)");
  out.push(`# design: ${name}`);
  out.push("# Generated file; the next export overwrites any edits.");
  out.push("");
  for (const [, t] of types) {
    out.push(`pinout ${t.ndlName}`);
    if (t.invented) {
      out.push("  # WARNING: type carries no physical pin numbers; numbers below are invented");
    }
    for (const p of t.pins) {
      out.push(`  pin ${t.pinNumber.get(p.name)} = ${ndlPinName(p.name)}`);
    }
    for (const pw of t.physical?.power ?? []) {
      out.push(`  pin ${pw.number} = ${ndlPinName(pw.name)}`);
    }
    for (const n of t.physical?.nc ?? []) {
      out.push(`  pin ${n} = NC`);
    }
    out.push(`end ${t.ndlName}`);
    out.push("");
  }
  if (connectorPins.length) {
    out.push(`# design ports (FR-095) as a connector`);
    out.push(`pinout ${connectorType}`);
    connectorPins.forEach((pin, i) => out.push(`  pin ${i + 1} = ${pin}`));
    out.push(`end ${connectorType}`);
    out.push("");
  }
  if (rails.length) {
    out.push("# power rails from the parts' physical: metadata (FR-062e); the");
    out.push("# schematic itself is logical and carries no power wiring");
    out.push("pinout POWER");
    rails.forEach((r, i) => out.push(`  pin ${i + 1} = ${r}`));
    out.push("end POWER");
    out.push("");
  }
  for (const [id, enames] of instancesByType) {
    out.push(`package ${types.get(id).ndlName} ${enames.join(" ")}`);
  }
  if (connectorPins.length) out.push(`package ${connectorType} J1`);
  if (rails.length) out.push("package POWER PWR");
  out.push("");

  // ---- circuit: nets → star statements (FR-119a e) -------------------------
  // Map a net pin ref to its exported form, or null when its instance is
  // virtual/unknown (those become comments). Also resolve the pin's direction
  // for driver-first star orientation.
  const partByRefdes = new Map(parts.map((p) => [p.refdes, p]));
  const virtualByRefdes = new Map(virtuals.map((v) => [v.refdes, v]));
  const splitRef = (ref) => {
    const i = ref.indexOf(".");
    return [ref.slice(0, i), ref.slice(i + 1)];
  };
  const mapRef = (ref) => {
    if (portRef.has(ref)) return { ref: portRef.get(ref), dir: "bidir" };
    const [refdes, pin] = splitRef(ref);
    const inst = partByRefdes.get(refdes);
    if (!inst) return null;
    const dir = inst.typeData.pins.find((p) => p.name === pin)?.direction ?? "in";
    return { ref: `${exportedRef.get(refdes)}.${ndlPinName(pin)}`, dir };
  };

  const nets = buildNets(design, (m) => warnings.push(m));
  const stmts = []; // { key, lines } sorted by key for determinism
  const virtualNets = new Map(); // virtual refdes -> [{pin, refs}]
  for (const net of nets) {
    const mapped = [];
    const seen = new Set();
    const virtualPins = [];
    for (const ref of [...net.pins].sort(natural)) {
      const m = mapRef(ref);
      if (m) {
        if (!seen.has(m.ref)) {
          seen.add(m.ref);
          mapped.push(m);
        }
      } else {
        const [refdes, pin] = splitRef(ref);
        if (virtualByRefdes.has(refdes)) virtualPins.push({ refdes, pin });
      }
    }
    // Driver-first star: prefer an out pin, then tristate/bidir, else first.
    const rank = { out: 0, tristate: 1, bidir: 2, in: 3 };
    mapped.sort((a, b) => rank[a.dir] - rank[b.dir] || natural(a.ref, b.ref));
    if (mapped.length >= 2) {
      const lines = [];
      if (net.name != null) lines.push(`  # net ${net.name}`);
      const drv = mapped[0];
      for (let i = 1; i < mapped.length; i++) {
        lines.push(`  ${drv.ref} -> ${mapped[i].ref}`);
      }
      stmts.push({ key: drv.ref, lines });
    }
    // Record virtual attachments against the net's exported refs (or its
    // name) so clock/switch/indicator connectivity survives as comments.
    for (const { refdes, pin } of virtualPins) {
      if (!virtualNets.has(refdes)) virtualNets.set(refdes, []);
      virtualNets.get(refdes).push({
        pin,
        refs: mapped.map((m) => m.ref),
        netName: net.name ?? null,
      });
    }
  }
  stmts.sort((a, b) => natural(a.key, b.key));

  out.push(`circuit ${circuitName}`);
  out.push("");
  for (const s of stmts) {
    out.push(...s.lines);
    out.push("");
  }
  if (rails.length) {
    out.push("  # power rail wiring (FR-062e physical: metadata)");
    for (const [id, enames] of instancesByType) {
      const power = types.get(id).physical?.power ?? [];
      for (const ename of enames) {
        for (const pw of power) {
          out.push(`  PWR.${ndlPinName(pw.name)} -> ${ename}.${ndlPinName(pw.name)}`);
        }
      }
    }
    out.push("");
  }
  if (virtuals.length) {
    out.push("  # virtual devices (no physical package; FR-119a f):");
    for (const v of virtuals) {
      const rt = v.typeData.renderType;
      const nets = virtualNets.get(v.refdes) ?? [];
      if (!nets.length) {
        out.push(`  # virtual: ${v.refdes} (${rt}) unconnected`);
        continue;
      }
      for (const n of nets) {
        const where = n.refs.length ? n.refs.join(" ") : `net ${n.netName ?? "(unnamed)"}`;
        out.push(`  # virtual: ${v.refdes} (${rt}) ${n.pin} -> ${where}`);
      }
    }
    out.push("");
  }
  out.push(`end ${circuitName}`);
  out.push("");

  return { text: out.join("\n"), warnings };
}
