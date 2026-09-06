import { test } from "node:test";
import assert from "node:assert/strict";

import { needsSync, notesOf, resolveSubject, subjectName } from "./notespanel.js";

// --- notesOf: the one place "unset" is normalized (FR-125) ---

test("notesOf reads absent notes as the empty string", () => {
  assert.equal(notesOf({}), "");
  assert.equal(notesOf({ notes: undefined }), "");
  assert.equal(notesOf(null), "");
  assert.equal(notesOf(undefined), "");
});

test("notesOf returns the notes verbatim, whitespace and all", () => {
  assert.equal(notesOf({ notes: "  two lines\n\n  and a gap  " }), "  two lines\n\n  and a gap  ");
});

// --- needsSync: the caret-preservation rule (FR-125, §6.23) ---
//
// needsSync compares the textarea against the text on show, whatever names it —
// the design's notes, or a borrowed subject's (FR-125b) — so these cases pass
// `notesOf(design)` where the design is the subject.

test("needsSync is false when the textarea already matches (the keystroke case)", () => {
  // The store notifies BECAUSE of the keystroke that produced this text, so the
  // subscriber must not write back — that would reset the caret to the end.
  assert.equal(needsSync("F codes 1..4 update the PC.", notesOf({ notes: "F codes 1..4 update the PC." })), false);
});

test("needsSync is true when the design changed under the panel (load/replace)", () => {
  assert.equal(needsSync("old design's notes", notesOf({ notes: "new design's notes" })), true);
});

test("needsSync is false for an empty area over a design with no notes", () => {
  // The commonest steady state; it must not write, or every notification would
  // touch the DOM for nothing.
  assert.equal(needsSync("", notesOf({})), false);
  assert.equal(needsSync("", notesOf({ notes: "" })), false);
});

test("needsSync is true when replacing a noted design with an unnoted one", () => {
  // A design replacement rebinds the tab rather than closing it (FR-125), so
  // clearing the area is a real case, not a theoretical one.
  assert.equal(needsSync("notes from the design just closed", notesOf({})), true);
});

test("needsSync is true when a design arrives with notes into an empty area", () => {
  assert.equal(needsSync("", notesOf({ notes: "loaded from the file" })), true);
});

// --- subjectName: what the title line calls the notes on show (FR-125b) ---

test("subjectName is the design's own name when nothing is borrowed", () => {
  assert.equal(subjectName(null, { name: "cpu-decode" }), "cpu-decode");
});

test("subjectName names a borrowed subject by refdes and part or file", () => {
  assert.equal(subjectName({ refdes: "U7", name: "ADDRDEC" }, { name: "cpu-decode" }), "U7 — ADDRDEC");
  assert.equal(subjectName({ refdes: "X2", name: "alu.dsn" }, { name: "cpu-decode" }), "X2 — alu.dsn");
});

// --- resolveSubject: currency, and dying with its owner (FR-125b) ---

const sheet = { name: "cpu-decode", components: [{ refdes: "U7" }, { refdes: "X2" }] };
const lib = { "gal/addrdec": { notes: "A15 high selects ROM." } };
const findType = (id) => lib[id] ?? null;

test("resolveSubject returns null for no subject — the design's own notes", () => {
  assert.equal(resolveSubject(null, sheet, findType), null);
});

test("a type subject resolves through the LIVE library, not a placement copy", () => {
  // The point of storing the id rather than the text: an edit through the GAL
  // dialog reaches the pane on the next notification (FR-125b, FR-057).
  const subj = { kind: "type", refdes: "U7", name: "ADDRDEC", typeId: "gal/addrdec" };
  assert.equal(resolveSubject(subj, sheet, findType), "A15 high selects ROM.");
  lib["gal/addrdec"] = { notes: "Edited in the dialog." };
  assert.equal(resolveSubject(subj, sheet, findType), "Edited in the dialog.");
  lib["gal/addrdec"] = { notes: "A15 high selects ROM." };
});

test("a type with no notes resolves to the empty string, not to a fallback", () => {
  // Empty notes are an answer ("this part has none"), not a dead subject: the
  // menu item is offered whether or not notes exist (FR-125b).
  assert.equal(
    resolveSubject({ kind: "type", refdes: "U7", name: "P", typeId: "bare" }, { ...sheet }, () => ({})),
    "",
  );
});

test("a type gone from the library kills the subject", () => {
  const subj = { kind: "type", refdes: "U7", name: "ADDRDEC", typeId: "gal/vanished" };
  assert.equal(resolveSubject(subj, sheet, findType), null);
});

test("a child subject shows its snapshot, library or not", () => {
  const subj = { kind: "child", refdes: "X2", name: "alu.dsn", text: "Carry is ripple." };
  assert.equal(resolveSubject(subj, sheet, findType), "Carry is ripple.");
});

test("a component no longer on the sheet kills the subject (deletion, undo)", () => {
  const gone = { name: "cpu-decode", components: [{ refdes: "U1" }] };
  assert.equal(
    resolveSubject({ kind: "child", refdes: "X2", name: "alu.dsn", text: "x" }, gone, findType),
    null,
  );
  assert.equal(
    resolveSubject({ kind: "type", refdes: "U7", name: "ADDRDEC", typeId: "gal/addrdec" }, gone, findType),
    null,
  );
});
