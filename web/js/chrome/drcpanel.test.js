import { test } from "node:test";
import assert from "node:assert/strict";

import { isStale, selectionRefs, waiverKeyOf, reportText } from "./drcpanel.js";
import { applyWaivers } from "../engine/drc.js";

// The DOM-free parts of the report tab (§6.21, §11.1): the staleness predicate,
// the ref → selection mapping, the active/waived partition the panel re-runs on
// every waive, and the Copy text. The strip, the rows, the reveal, and the note
// dialog are §11.2 manual items.

// --- staleness (FR-124i) ---

test("a fresh report is not stale; any design change makes it so (FR-124i)", () => {
  assert.equal(isStale(7, 7), false);
  assert.equal(isStale(8, 7), true);
  // A report that has never run is never stale — there is nothing to describe.
  assert.equal(isStale(0, null), false);
  assert.equal(isStale(99, null), false);
});

// Waiving goes through applyLive, which bumps designRev (§6.10), so it marks the
// report stale — correct and intended: the design really did change, and the
// banner costs nothing since every finding stays.
test("waiving marks the report stale rather than hiding the change (FR-124e/i)", () => {
  const checkedRev = 4;
  const afterWaive = checkedRev + 1; // applyLive bumped it
  assert.equal(isStale(afterWaive, checkedRev), true);
});

// --- refs → selection (FR-124f) ---

const kindOf = (id) => (id.startsWith("b") ? "bus" : "wire");

test("a pin ref selects its instance, and duplicates collapse (FR-124f)", () => {
  assert.deepEqual(selectionRefs(["U3.Q0", "U7.Y2"]), [
    { kind: "component", refdes: "U3" },
    { kind: "component", refdes: "U7" },
  ]);
  // Two pins of one part are one selected object, not two.
  assert.deepEqual(selectionRefs(["U5C.A", "U5C.B"]), [{ kind: "component", refdes: "U5C" }]);
});

test("an instance ref selects the instance; a conductor endpoint selects its conductor", () => {
  assert.deepEqual(selectionRefs(["A-1", "A-2"]), [
    { kind: "component", refdes: "A-1" },
    { kind: "component", refdes: "A-2" },
  ]);
  assert.deepEqual(selectionRefs(["w7:v31", "b2:v9"], kindOf), [
    { kind: "wire", id: "w7" },
    { kind: "bus", id: "b2" },
  ]);
});

test("a stale finding whose objects are gone selects nothing (FR-124i)", () => {
  // The conductor no longer exists, so the kind lookup answers null and the ref
  // is skipped — an empty selection, not a throw and not a wrong selection.
  assert.deepEqual(selectionRefs(["w7:v31"], () => null), []);
  assert.deepEqual(selectionRefs([]), []);
  assert.deepEqual(selectionRefs(undefined), []);
});

// --- the partition a waive re-runs (FR-124e) ---

const finding = (rule, severity, message, refs) => ({ rule, severity, message, refs });

const FINDINGS = [
  finding("R1", "error", "Output fight on net D: U1.D (out) vs U2.D (out)", ["U1.D", "U2.D"]),
  finding("R3", "warning", "Undriven input U3.A: it is connected to nothing", ["U3.A"]),
  finding("R8", "info", "U9 is placed but connected to nothing", ["U9"]),
];

test("waiving re-partitions the findings already in hand — it does not re-run", () => {
  const waivers = [{ rule: "R3", refs: ["U3.A"], note: "tied high on the board" }];
  const { active, waived, unmatched } = applyWaivers(FINDINGS, waivers);

  assert.deepEqual(
    active.map((f) => f.rule),
    ["R1", "R8"],
  );
  assert.deepEqual(
    waived.map((f) => f.rule),
    ["R3"],
  );
  assert.deepEqual(unmatched, []);

  // Un-waiving is the inverse: the same findings, the waiver gone.
  const back = applyWaivers(FINDINGS, []);
  assert.deepEqual(back.active, FINDINGS);
  assert.deepEqual(back.waived, []);
});

test("the panel's waiver key is the engine's, so a note is found by lookup", () => {
  const waivers = [{ rule: "R3", refs: ["U3.A"], note: "spare gate, intentional" }];
  const index = new Map(waivers.map((w) => [waiverKeyOf(w.rule, w.refs), w]));
  const found = FINDINGS[1];
  assert.equal(index.get(waiverKeyOf(found.rule, found.refs)).note, "spare gate, intentional");
  // Refs written in another order still match: the key sorts both sides.
  assert.equal(waiverKeyOf("R1", ["U2.D", "U1.D"]), waiverKeyOf("R1", ["U1.D", "U2.D"]));
});

// --- Copy (FR-124d) ---

test("Copy renders one finding per line, waived ones included and marked", () => {
  const waivers = [{ rule: "R3", refs: ["U3.A"], note: "tied high" }];
  const { active, waived } = applyWaivers(FINDINGS, waivers);
  const index = new Map(waivers.map((w) => [waiverKeyOf(w.rule, w.refs), w]));
  const text = reportText({
    designName: "cpu",
    when: "2026-08-03 09:00",
    active,
    waived,
    waiverOf: (f) => index.get(waiverKeyOf(f.rule, f.refs)) ?? null,
  });

  const lines = text.split("\n");
  assert.equal(lines[0], "Design rule check — cpu — 2026-08-03 09:00");
  assert.equal(lines[1], "ERROR R1 Output fight on net D: U1.D (out) vs U2.D (out)");
  assert.equal(lines[2], "INFO R8 U9 is placed but connected to nothing");
  assert.equal(lines[3], "WAIVED WARN R3 Undriven input U3.A: it is connected to nothing — tied high");
});

test("Copy of a clean report says so rather than emitting a bare header", () => {
  const text = reportText({ designName: "cpu", when: "now", active: [], waived: [] });
  assert.deepEqual(text.split("\n"), ["Design rule check — cpu — now", "No findings."]);
});
