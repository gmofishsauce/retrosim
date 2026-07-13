import { test } from "node:test";
import assert from "node:assert/strict";

import {
  renderByte,
  shouldStickTail,
  createConsoleModel,
  CONSOLE_MAX_CHARS,
  TRUNCATION_MARKER,
} from "./console.js";

test("renderByte: printable ASCII verbatim (FR-122c)", () => {
  assert.equal(renderByte(0x41), "A");
  assert.equal(renderByte(0x20), " "); // space, low edge of printable
  assert.equal(renderByte(0x7e), "~"); // ~, high edge of printable
});

test("renderByte: LF→newline, TAB→tab, CR ignored (FR-122c)", () => {
  assert.equal(renderByte(0x0a), "\n");
  assert.equal(renderByte(0x09), "\t");
  assert.equal(renderByte(0x0d), "");
});

test("renderByte: other control codes and 0x7F–0xFF as \\xNN (FR-122c)", () => {
  assert.equal(renderByte(0x00), "\\x00");
  assert.equal(renderByte(0x1b), "\\x1b"); // ESC
  assert.equal(renderByte(0x7f), "\\x7f"); // DEL
  assert.equal(renderByte(0xff), "\\xff");
});

test("renderByte is total over 0..255 (no throw, always a string)", () => {
  for (let b = 0; b <= 255; b++) assert.equal(typeof renderByte(b), "string");
});

test("model coalesces many pushes into one flush (FR-122c)", () => {
  const m = createConsoleModel();
  assert.equal(m.isDirty(), false);
  for (const b of [0x48, 0x69, 0x0a]) m.push(b); // "Hi\n"
  assert.equal(m.isDirty(), true); // buffered, not yet committed
  assert.equal(m.text(), ""); // nothing committed before flush
  const out = m.flush();
  assert.equal(out, "Hi\n");
  assert.equal(m.text(), "Hi\n");
  assert.equal(m.isDirty(), false); // one flush drained the buffer
});

test("model head-trims at the cap with a truncation marker (FR-122c)", () => {
  const max = 32;
  const m = createConsoleModel({ max });
  for (let i = 0; i < 100; i++) m.push(0x41); // 100 'A's, well past the cap
  const out = m.flush();
  assert.equal(out.length, max);
  assert.ok(out.startsWith(TRUNCATION_MARKER));
  assert.ok(out.endsWith("A"));
});

test("model default cap is CONSOLE_MAX_CHARS", () => {
  const m = createConsoleModel();
  const n = CONSOLE_MAX_CHARS + 500;
  for (let i = 0; i < n; i++) m.push(0x41);
  assert.equal(m.flush().length, CONSOLE_MAX_CHARS);
});

test("model clear empties the committed text and the buffer", () => {
  const m = createConsoleModel();
  m.push(0x41);
  m.flush();
  m.push(0x42); // buffered but not flushed
  m.clear();
  assert.equal(m.text(), "");
  assert.equal(m.isDirty(), false);
  assert.equal(m.flush(), ""); // the pending 'B' was dropped too
});

test("shouldStickTail: true at the bottom, false when scrolled up (FR-122c)", () => {
  // At the bottom: scrollTop + clientHeight == scrollHeight.
  assert.equal(shouldStickTail({ scrollTop: 900, clientHeight: 100, scrollHeight: 1000 }), true);
  // Within epsilon of the bottom still sticks.
  assert.equal(shouldStickTail({ scrollTop: 899, clientHeight: 100, scrollHeight: 1000 }), true);
  // Scrolled up to read earlier output: do not re-pin.
  assert.equal(shouldStickTail({ scrollTop: 500, clientHeight: 100, scrollHeight: 1000 }), false);
});
