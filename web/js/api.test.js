import { test } from "node:test";
import assert from "node:assert/strict";

import { getComponents, createComponent } from "./api.js";

// stubFetch replaces globalThis.fetch, capturing each request and returning a
// fixed JSON body. node --test isolates files in separate processes, so the stub
// does not leak to other test files.
function stubFetch(response) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, statusText: "OK", json: async () => response };
  };
  return calls;
}

test("getComponents with no project requests the shared library alone (FR-121i)", async () => {
  const calls = stubFetch({ components: [{ id: "type-7400" }], warnings: [] });
  const res = await getComponents();
  assert.equal(calls[0].url, "/api/v1/components");
  assert.deepEqual(res, { components: [{ id: "type-7400" }], warnings: [] });
});

test("getComponents passes ?project= and returns { components, warnings } (FR-121i)", async () => {
  const calls = stubFetch({ components: [], warnings: ["w"] });
  const res = await getComponents("/data/proj");
  assert.equal(
    calls[0].url,
    "/api/v1/components?project=" + encodeURIComponent("/data/proj"),
  );
  assert.deepEqual(res, { components: [], warnings: ["w"] });
});

test("getComponents defaults warnings to [] when the server omits them", async () => {
  stubFetch({ components: [] });
  const res = await getComponents();
  assert.deepEqual(res.warnings, []);
});

test("createComponent posts the yaml and the current project dir (FR-007a/FR-121i)", async () => {
  const calls = stubFetch({ component: { id: "type-X" } });
  const created = await createComponent("yaml-text", "/data/proj");
  assert.equal(calls[0].url, "/api/v1/components");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    yaml: "yaml-text",
    project: "/data/proj",
  });
  assert.deepEqual(created, { id: "type-X" });
});
