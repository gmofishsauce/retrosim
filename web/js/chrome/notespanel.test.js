import { test } from "node:test";
import assert from "node:assert/strict";

import { needsSync, notesOf } from "./notespanel.js";

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

test("needsSync is false when the textarea already matches (the keystroke case)", () => {
  // The store notifies BECAUSE of the keystroke that produced this text, so the
  // subscriber must not write back — that would reset the caret to the end.
  assert.equal(needsSync("F codes 1..4 update the PC.", { notes: "F codes 1..4 update the PC." }), false);
});

test("needsSync is true when the design changed under the panel (load/replace)", () => {
  assert.equal(needsSync("old design's notes", { notes: "new design's notes" }), true);
});

test("needsSync is false for an empty area over a design with no notes", () => {
  // The commonest steady state; it must not write, or every notification would
  // touch the DOM for nothing.
  assert.equal(needsSync("", {}), false);
  assert.equal(needsSync("", { notes: "" }), false);
});

test("needsSync is true when replacing a noted design with an unnoted one", () => {
  // A design replacement rebinds the tab rather than closing it (FR-125), so
  // clearing the area is a real case, not a theoretical one.
  assert.equal(needsSync("notes from the design just closed", {}), true);
});

test("needsSync is true when a design arrives with notes into an empty area", () => {
  assert.equal(needsSync("", { notes: "loaded from the file" }), true);
});
