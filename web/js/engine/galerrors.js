// GAL definition errors (§6.14, FR-066j–FR-066m): the one answer to "does this
// GAL definition have errors?", shared by the New/Edit GAL part dialog's Errors
// tab, the canvas's red instances, and the Run / Generate C / test-vector
// refusals, so no two surfaces can disagree.
//
// A definition error is a *conflict*, never a gap (FR-066j): a declared output
// with no equation, a part with no behavior at all, or a clock with nothing
// registered yet are all normal states of a part in progress and yield nothing.
//
// Pure and DOM-free.

import { compileBehavior } from "./galasm.js";
import { signalOf } from "./galeq.js";

// hasEquations reports whether a behavior block holds any code at all, as
// opposed to nothing or only `;` comments — the latter is "no behavior", not a
// block that fails to compile.
export function hasEquations(behavior) {
  return !!behavior && behavior.replace(/;.*$/gm, "").trim() !== "";
}

// Memoized by type-data object: placed instances share one typeData until
// Refresh Types replaces it, so a sheet of many instances costs one check per
// type, and an edit — which always produces a new object — is never stale.
const cache = new WeakMap();

// galDefinitionErrors returns the definition errors of a component type, one
// message per error: [] for a non-GAL type, and for a GAL part the problems the
// server collected at load, then those the behavior compiler and strict device
// validator report, then the clock and declared-OLMC-type disagreements.
export function galDefinitionErrors(td) {
  if (!td?.gal) return [];
  let errs = cache.get(td);
  if (!errs) {
    errs = computeErrors(td);
    cache.set(td, errs);
  }
  return errs;
}

function computeErrors(td) {
  const errs = [...(td.loadErrors ?? [])];
  const pins = td.pins ?? [];
  const clockSig = td.clock ? signalOf(td.clock) : null;

  let compiled = null;
  if (hasEquations(td.behavior)) {
    const name = td.partnumber || td.name || "part";
    try {
      compiled = compileBehavior({ name, pins, behavior: td.behavior, gal: td.gal, internal: td.internal });
    } catch (e) {
      errs.push(e.message.startsWith(`${name}: `) ? e.message.slice(name.length + 2) : e.message);
    }
  }

  if (compiled) {
    if (!td.clock && compiled.outputs.some((o) => o.kind === "R" && !o.clk)) {
      errs.push("the behavior has a registered (.R) equation but the part declares no clock");
    }
    // The clock pin is implied by .R and may head no literal (FR-066g).
    if (clockSig) {
      const users = compiled.outputs.filter((o) => literalsOf(o).some((l) => l.signal === clockSig));
      if (users.length) {
        errs.push(
          `the clock pin ${td.clock} may not appear in an equation (used by ${users.map((o) => o.signal).join(", ")})`,
        );
      }
    }
    // Declared OLMC type vs. the equation written for that pin (FR-066i). A pin
    // without an olmc key has no declaration to disagree with.
    const bySignal = new Map(compiled.outputs.map((o) => [o.signal, o]));
    for (const p of pins) {
      const o = p.olmc && bySignal.get(signalOf(p.name));
      if (!o) continue;
      if (p.olmc === "reg" && o.kind !== "R") {
        errs.push(`${p.name} is declared a registered output but its equation is not registered (no .R)`);
      } else if (p.olmc === "comb" && o.kind === "R") {
        errs.push(`${p.name} is declared a combinational output but its equation is registered (.R)`);
      }
    }
  }

  const regNoClock = td.clock ? [] : pins.filter((p) => p.olmc === "reg").map((p) => p.name);
  if (regNoClock.length) {
    errs.push(`${regNoClock.join(", ")} ${regNoClock.length === 1 ? "is" : "are"} declared registered but the part has no clock`);
  }
  return errs;
}

// literalsOf collects every literal an output's equations read: its sum of
// products, XOR groups, and each single-term control (.E/.CLK/.ARST/.APRST/.G).
function literalsOf(out) {
  const lits = [];
  const walk = (x) => {
    if (!x) return;
    if (Array.isArray(x)) x.forEach(walk);
    else if (typeof x === "object" && "signal" in x) lits.push(x);
  };
  walk([out.terms, out.xor, out.enable, out.clk, out.arst, out.aprst, out.gate]);
  return lits;
}

// designDefinitionErrors reports which components of a *flattened* design
// (§6.14) have GAL definition errors, named as the user sees them on the root
// sheet (FR-066m): a part on the root sheet by its designator; a part inside an
// embedded sub-design by that sub-design instance, since flatten prefixes a
// child's refdes with the instance path ("X1/U6"); a part on a merged peer sheet
// by the sheet's tag. Each list is de-duplicated, in first-seen order.
export function designDefinitionErrors(flat, root = flat) {
  const rootByRefdes = new Map((root.components ?? []).map((c) => [c.refdes, c]));
  const parts = [];
  const subs = [];
  const sheets = [];
  const add = (list, v) => {
    if (!list.includes(v)) list.push(v);
  };
  for (const c of flat.components ?? []) {
    if (!galDefinitionErrors(c.typeData).length) continue;
    const slash = c.refdes.indexOf("/");
    if (slash < 0) {
      add(parts, c.label ?? c.refdes);
      continue;
    }
    const head = rootByRefdes.get(c.refdes.slice(0, slash));
    if (head?.kind === "subdesign") add(subs, head.label ?? head.refdes);
    else add(sheets, c.refdes.slice(0, slash));
  }
  return { parts, subs, sheets };
}

// definitionErrorsMessage words a refusal (FR-066m), or returns null when the
// design has no GAL definition errors. `lead` names what cannot happen, e.g.
// "The design cannot be run". One cause is one sentence; several are a list.
export function definitionErrorsMessage(lead, { parts, subs, sheets }) {
  const causes = [
    ...(parts.length === 1
      ? [`the definition of ${parts[0]} contains errors`]
      : parts.length
        ? [`the definitions of ${parts.join(", ")} contain errors`]
        : []),
    ...subs.map((s) => `sub-design ${s} contains errors`),
    ...sheets.map((s) => `sheet ${s} contains errors`),
  ];
  if (!causes.length) return null;
  if (causes.length === 1) return `${lead} because ${causes[0]}`;
  return `${lead} because:\n${causes.map((c) => `  • ${c}`).join("\n")}`;
}
