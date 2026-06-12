// Tests for the server connection monitor (§6.12a, FR-089–FR-091; §11.1).
import { test } from "node:test";
import assert from "node:assert/strict";

import { startConnectionMonitor } from "./connection.js";

// harness builds a monitor with fully stubbed deps; beats are driven manually.
function harness({ dirty = false } = {}) {
  const calls = { conn: [], posts: [], saves: 0, pings: 0 };
  let pingOk = true;
  const store = { state: { dirty } };
  const monitor = startConnectionMonitor(
    {
      store,
      save: () => {
        calls.saves++;
      },
    },
    {
      pingFn: async () => {
        calls.pings++;
        if (!pingOk) throw new Error("refused");
      },
      setConn: (c) => calls.conn.push(c),
      post: (m) => calls.posts.push(m),
      schedule: () => null, // no timer; tests call beat() directly
    },
  );
  return { monitor, calls, store, setPing: (ok) => (pingOk = ok) };
}

test("flips disconnected after a failed beat and posts instructions once (FR-090)", async () => {
  const { monitor, calls, setPing } = harness();
  await monitor.beat(); // healthy: steady state, nothing reported
  assert.deepEqual(calls.conn, []);
  setPing(false);
  await monitor.beat();
  assert.deepEqual(calls.conn, [false]);
  assert.equal(calls.posts.length, 1);
  assert.match(calls.posts[0], /Do NOT reload/);
  await monitor.beat(); // still down: no repeat
  assert.deepEqual(calls.conn, [false]);
  assert.equal(calls.posts.length, 1);
});

test("flips connected on recovery and saves only when dirty (FR-091)", async () => {
  // Clean design: reconnect reports but does not save.
  const clean = harness({ dirty: false });
  clean.setPing(false);
  await clean.monitor.beat();
  clean.setPing(true);
  await clean.monitor.beat();
  assert.deepEqual(clean.calls.conn, [false, true]);
  assert.match(clean.calls.posts[1], /reconnected/);
  assert.equal(clean.calls.saves, 0);

  // Dirty design: reconnect saves.
  const dirty = harness({ dirty: true });
  dirty.setPing(false);
  await dirty.monitor.beat();
  dirty.setPing(true);
  await dirty.monitor.beat();
  assert.equal(dirty.calls.saves, 1);
});

test("overlapping heartbeats are not issued (FR-089)", async () => {
  const calls = { pings: 0 };
  let release;
  const monitor = startConnectionMonitor(
    { store: { state: { dirty: false } }, save: () => {} },
    {
      pingFn: () => {
        calls.pings++;
        return new Promise((resolve) => {
          release = resolve;
        });
      },
      setConn: () => {},
      post: () => {},
      schedule: () => null,
    },
  );
  const first = monitor.beat();
  await monitor.beat(); // in flight: skipped
  assert.equal(calls.pings, 1);
  release();
  await first;
  const second = monitor.beat(); // settled: next beat proceeds
  assert.equal(calls.pings, 2);
  release(); // settle the second ping so the test (and runner) can exit
  await second;
});
