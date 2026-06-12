// Tests for the local backup snapshot + recovery (§6.12a, FR-092/FR-093; §11.1).
import { test } from "node:test";
import assert from "node:assert/strict";

import { startBackup, offerRecovery, BACKUP_KEY } from "./backup.js";
import { createStore } from "./store.js";
import { createDesign, addInstance, addWire } from "./model/design.js";
import { serializeDesign } from "./model/persist.js";
import { placeComponent } from "./commands.js";

// fakeStorage is a Map-backed localStorage stand-in.
function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

const NOT = {
  name: "NOTX",
  renderType: "unit",
  width: 2,
  height: 2,
  pins: [
    { name: "A", side: "left", position: 1, direction: "in" },
    { name: "Y", side: "right", position: 1, direction: "out" },
  ],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("dirty dispatch writes a debounced snapshot (FR-092)", async () => {
  const storage = fakeStorage();
  const store = createStore({ design: createDesign("snap test") });
  startBackup(store, { storage, debounceMs: 1, post: () => {} });

  store.dispatch(placeComponent(NOT, 4, 4, 0));
  assert.equal(storage.getItem(BACKUP_KEY), null); // not yet: debounced
  await sleep(20);
  const snap = JSON.parse(storage.getItem(BACKUP_KEY));
  assert.equal(snap.design.components.length, 1);
  assert.equal(snap.designName, "snap test");
  assert.equal(typeof snap.time, "number");
});

test("a landed save removes the snapshot immediately (FR-092)", async () => {
  const storage = fakeStorage();
  const store = createStore({ design: createDesign("snap test") });
  startBackup(store, { storage, debounceMs: 1, post: () => {} });

  store.dispatch(placeComponent(NOT, 4, 4, 0));
  await sleep(20);
  assert.notEqual(storage.getItem(BACKUP_KEY), null);
  store.markSaved("/designs/x.json"); // dirty clears
  assert.equal(storage.getItem(BACKUP_KEY), null); // removed without debounce
});

test("offerRecovery round-trips the design with path, name, dirty (FR-093)", () => {
  // Build a design with a component, a wire between its pins, and overrides.
  const d = createDesign("lost work");
  const inst = addInstance(d, NOT, 4, 4, 0);
  inst.overrides = { props: { foo: 7 } };
  addWire(
    d,
    { kind: "pin", refdes: inst.refdes, pin: "A" },
    { kind: "pin", refdes: inst.refdes, pin: "Y" },
  );
  const storage = fakeStorage();
  storage.setItem(
    BACKUP_KEY,
    JSON.stringify({
      design: serializeDesign(d),
      savePath: "/designs/lost.json",
      designName: "lost work",
      time: 1234567890,
    }),
  );

  const store = createStore({ design: createDesign("fresh") });
  let prompt = null;
  const recovered = offerRecovery(store, {
    storage,
    confirmFn: (msg) => {
      prompt = msg;
      return true;
    },
    post: () => {},
  });
  assert.equal(recovered, true);
  assert.match(prompt, /lost work/);
  assert.equal(store.design.components.length, 1);
  assert.equal(store.design.components[0].overrides.props.foo, 7);
  assert.equal(store.design.wires.length, 1);
  assert.equal(store.design.vertices.length, 2);
  assert.equal(store.state.savePath, "/designs/lost.json");
  assert.equal(store.state.designName, "lost work");
  assert.equal(store.state.dirty, true);
});

test("declining recovery discards the snapshot (FR-093)", () => {
  const storage = fakeStorage();
  storage.setItem(
    BACKUP_KEY,
    JSON.stringify({ design: serializeDesign(createDesign("old")), time: 1 }),
  );
  const store = createStore({ design: createDesign("fresh") });
  const recovered = offerRecovery(store, {
    storage,
    confirmFn: () => false,
    post: () => {},
  });
  assert.equal(recovered, false);
  assert.equal(storage.getItem(BACKUP_KEY), null);
  assert.equal(store.state.designName, "fresh"); // untouched
});

test("a throwing storage disables the writer without breaking dispatch (FR-092)", async () => {
  const posts = [];
  const storage = {
    getItem: () => null,
    setItem: () => {
      throw new Error("quota exceeded");
    },
    removeItem: () => {},
  };
  const store = createStore({ design: createDesign("snap test") });
  startBackup(store, { storage, debounceMs: 1, post: (m) => posts.push(m) });

  store.dispatch(placeComponent(NOT, 4, 4, 0));
  await sleep(20);
  store.dispatch(placeComponent(NOT, 8, 8, 0)); // editing continues
  await sleep(20);
  assert.equal(store.design.components.length, 2);
  assert.equal(posts.length, 1); // disabled after one report
  assert.match(posts[0], /backup disabled/i);
});
