// Unit tests for the design-replacement guard (§6.16/§11.1, FR-115m/FR-115h,
// OQ-002). fileops reaches the network through api.js, so the load path is
// exercised with a stubbed global fetch — enough to prove the guard runs before
// store.replaceDesign and that a refusal abandons the replacement.

import test from "node:test";
import assert from "node:assert/strict";

// fileops toasts through the DOM on both its success and failure paths; the
// guard's contract has nothing to do with either, so the module gets the
// smallest document that keeps those calls from throwing.
globalThis.document = {
  createElement: () => ({ className: "", textContent: "", remove() {}, appendChild() {} }),
  body: { appendChild() {} },
  getElementById: () => null,
};

import { makeFileOps } from "./fileops.js";

// A store double recording only what the guard's contract concerns: whether the
// design was replaced, and in what order relative to the guard.
function fakeStore(log) {
  const state = { design: { name: "before", components: [], wires: [], buses: [], vertices: [] },
                  designName: "before", savePath: "/p/before.json", dirty: false,
                  project: { dir: "/p", name: "p" }, selection: [] };
  return {
    state,
    get design() {
      return state.design;
    },
    replaceDesign(design, { savePath = null } = {}) {
      log.push("replaceDesign");
      state.design = design;
      state.designName = design.name;
      state.savePath = savePath;
    },
    subscribe: () => () => {},
    dispatch: () => {},
  };
}

// stubFetch answers the one call loadIntoStore makes (/design/load) with a
// minimal well-formed design. The endpoint wraps it as { design }, which is what
// api.js unwraps.
function stubFetch(body) {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ design: body }),
    text: async () => JSON.stringify({ design: body }),
  });
}

const LOADED = {
  formatVersion: 3,
  name: "after",
  components: [],
  wires: [],
  buses: [],
  vertices: [],
  nets: [],
};

function opsWith(log, beforeReplace) {
  const store = fakeStore(log);
  const ops = makeFileOps({
    store,
    dataDir: "/data",
    defaultName: () => "untitled",
    beforeReplace: async () => {
      log.push("guard");
      return beforeReplace();
    },
  });
  return { store, ops };
}

test("Open runs the replacement guard before replacing the design (FR-115m/OQ-002)", async () => {
  stubFetch(LOADED);
  const log = [];
  const { store, ops } = opsWith(log, () => true);
  assert.equal(await ops.loadIntoStore("/p/after.json"), true);
  assert.deepEqual(log, ["guard", "replaceDesign"]); // order is the contract
  assert.equal(store.state.design.name, "after");
});

test("a refused guard abandons the Open entirely (FR-115m/OQ-002)", async () => {
  stubFetch(LOADED);
  const log = [];
  const { store, ops } = opsWith(log, () => false);
  // The load reports failure, which is what open()/navigateTo() propagate.
  assert.equal(await ops.loadIntoStore("/p/after.json"), false);
  assert.deepEqual(log, ["guard"]); // never reached the replacement
  // Both halves of the pre-load state survive: the design AND its save path,
  // so the panel it belongs to stays bound to a design still on the canvas.
  assert.equal(store.state.design.name, "before");
  assert.equal(store.state.savePath, "/p/before.json");
});

test("File ▸ New runs the guard, and a refusal abandons it (FR-115m/OQ-002)", async () => {
  const log = [];
  const { store, ops } = opsWith(log, () => false);
  await ops.newDesign();
  assert.deepEqual(log, ["guard"]);
  assert.equal(store.state.design.name, "before");

  const log2 = [];
  const { store: store2, ops: ops2 } = opsWith(log2, () => true);
  await ops2.newDesign();
  assert.deepEqual(log2, ["guard", "replaceDesign"]);
  assert.equal(store2.state.design.name, "untitled");
});

test("guardReplace exposes the one hook for the project ops (§6.19)", async () => {
  const log = [];
  const { ops } = opsWith(log, () => true);
  assert.equal(await ops.guardReplace(), true);
  assert.deepEqual(log, ["guard"]);
});

test("with no guard supplied, a replacement proceeds unhindered", async () => {
  const log = [];
  const store = fakeStore(log);
  const ops = makeFileOps({ store, dataDir: "/data", defaultName: () => "untitled" });
  await ops.newDesign();
  assert.deepEqual(log, ["replaceDesign"]);
  assert.equal(await ops.guardReplace(), true);
});
