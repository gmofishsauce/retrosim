import { test } from "node:test";
import assert from "node:assert/strict";

import { createStore } from "../store.js";
import {
  isManifestName,
  resolveProjectPick,
  absoluteDataPaths,
  makeProjectOps,
} from "./project.js";

// --- pure helpers (§6.19) ---

test("isManifestName mirrors the Go rule (FR-121a)", () => {
  for (const n of ["foo-manifest.json", "Foo-Manifest.JSON", "a-b-manifest.json", "x-MANIFEST.json"]) {
    assert.equal(isManifestName(n), true, n);
  }
  for (const n of ["manifest.json", "design.json", "foo-manifest.json.bak", "foo-manifest", ""]) {
    assert.equal(isManifestName(n), false, n);
  }
});

test("resolveProjectPick maps folder / manifest / design picks (FR-121b)", () => {
  assert.deepEqual(resolveProjectPick({ path: "/data/proj", isDir: true }), {
    dir: "/data/proj",
    designPath: null,
  });
  assert.deepEqual(resolveProjectPick({ path: "/data/proj/proj-manifest.json", isDir: false }), {
    dir: "/data/proj",
    designPath: null,
  });
  assert.deepEqual(resolveProjectPick({ path: "/data/proj/cpu.json", isDir: false }), {
    dir: "/data/proj",
    designPath: "/data/proj/cpu.json",
  });
});

test("absoluteDataPaths finds absolute mem paths, ignores relative and non-mem", () => {
  const design = {
    components: [
      { refdes: "U1", typeData: { mem: { kind: "rom", romFile: "/elsewhere/rom.hex" } } },
      { refdes: "U2", typeData: { mem: { kind: "ram", ramFile: "ram.bin" } } }, // relative: in-project
      { refdes: "U3", typeData: { name: "7400" } }, // non-mem
      { refdes: "U4", typeData: { mem: { kind: "ram", ramFile: "/shared/ram.bin" } } },
    ],
  };
  assert.deepEqual(absoluteDataPaths(design), [
    { refdes: "U1", path: "/elsewhere/rom.hex" },
    { refdes: "U4", path: "/shared/ram.bin" },
  ]);
});

// --- lifecycle ops with stubbed deps (the connection.js injection pattern) ---

// harness builds a store plus a makeProjectOps instance whose api/dialog deps
// are scripted: `dialogResults` is consumed by successive openFileDialog
// calls; api stubs come from `api`.
function harness({ dialogResults = [], api = {}, loadResult = true } = {}) {
  const posts = [];
  const loads = []; // loadIntoStore calls: { path, projectInfo }
  const reloads = []; // reloadLibrary calls: the project dir passed (FR-121i)
  const store = createStore({ design: { name: "d0" } });
  let navCleared = 0;
  const fileops = {
    loadIntoStore: async (path, opts = {}) => {
      loads.push({ path, projectInfo: opts.projectInfo });
      if (loadResult) {
        // The real loadIntoStore applies the containing-folder rule; the stub
        // mimics only the store effects the ops observe.
        store.replaceDesign({ name: "loaded" }, { savePath: path });
      }
      return loadResult;
    },
    clearNavStack: () => navCleared++,
  };
  const ops = makeProjectOps(
    // freshDesign mirrors app.js: named after the project when one is given
    // (FR-121b), else a stand-in for the FR-004 default.
    {
      store,
      dataDir: "/data",
      fileops,
      freshDesign: (name) => ({ name: name ?? "fresh" }),
      reloadLibrary: async (dir) => reloads.push(dir),
    },
    {
      openFileDialog: async () => dialogResults.shift() ?? null,
      post: (m) => posts.push(m),
      confirm: () => true,
      projectInfo: api.projectInfo ?? (async (dir) => ({ dir, name: "p", manifestFile: "", mainDesign: "", warnings: [] })),
      projectCreate: api.projectCreate ?? (async () => { throw new Error("unexpected create"); }),
      projectDuplicate: api.projectDuplicate ?? (async () => { throw new Error("unexpected duplicate"); }),
      listDir: api.listDir ?? (async () => ({ entries: [] })),
      loadDesign: api.loadDesign ?? (async () => ({ components: [] })),
    },
  );
  return { store, ops, posts, loads, reloads, navCleared: () => navCleared };
}

test("setCurrentProject records the info and posts each warning (FR-074/FR-121a)", async () => {
  const { store, ops, posts } = harness({
    api: {
      projectInfo: async (dir) => ({
        dir,
        name: "My CPU",
        manifestFile: "p-manifest.json",
        mainDesign: "cpu.json",
        warnings: ["w1", "w2"],
      }),
    },
  });
  await ops.setCurrentProject("/data/proj");
  assert.deepEqual(store.state.project, {
    dir: "/data/proj",
    name: "My CPU",
    manifestFile: "p-manifest.json",
    mainDesign: "cpu.json",
  });
  assert.equal(posts.length, 2);
});

test("setCurrentProject reloads the merged library for the incoming project (FR-121i)", async () => {
  const { ops, reloads } = harness();
  await ops.setCurrentProject("/data/proj");
  assert.deepEqual(reloads, ["/data/proj"]);
});

test("setCurrentProject degrades to the folder-name fallback on a fetch failure", async () => {
  const { store, ops, posts } = harness({
    api: { projectInfo: async () => { throw new Error("boom"); } },
  });
  await ops.setCurrentProject("/data/proj");
  assert.equal(store.state.project.name, "proj");
  assert.equal(posts.length, 1);
});

test("newProject creates, enters, and starts a fresh design (FR-121b/FR-121c)", async () => {
  const h = harness({
    dialogResults: [{ path: "/data/newproj" }],
    api: {
      projectCreate: async (path) => ({
        dir: path,
        name: "newproj",
        manifestFile: "newproj-manifest.json",
        mainDesign: "",
        warnings: [],
      }),
    },
  });
  await h.ops.newProject();
  assert.equal(h.store.state.project.dir, "/data/newproj");
  // The initial design is named after the project (FR-121b), so the first
  // save prefills "newproj.json".
  assert.equal(h.store.state.design.name, "newproj");
  assert.equal(h.store.state.designName, "newproj");
  assert.equal(h.store.state.savePath, null);
  assert.equal(h.navCleared(), 1);
});

test("newProject aborts with a tray report on a create failure (e.g. 409)", async () => {
  const h = harness({
    dialogResults: [{ path: "/data/exists" }],
    api: { projectCreate: async () => { throw new Error("path already exists"); } },
  });
  await h.ops.newProject();
  assert.equal(h.store.state.project, null);
  assert.equal(h.store.state.design.name, "d0"); // canvas untouched
  assert.match(h.posts[0], /already exists/);
});

test("openProject cancel changes nothing (§3.1 A9)", async () => {
  // First cancel: the project pick itself.
  let h = harness({ dialogResults: [null] });
  await h.ops.openProject();
  assert.equal(h.store.state.project, null);
  assert.equal(h.loads.length, 0);

  // Second cancel: no main design, the rooted open-design dialog cancelled —
  // the whole action cancels: no project change, no canvas change.
  h = harness({ dialogResults: [{ path: "/data/proj", isDir: true }, null] });
  await h.ops.openProject();
  assert.equal(h.store.state.project, null);
  assert.equal(h.store.state.design.name, "d0");
  assert.equal(h.loads.length, 0);
});

test("openProject with a manifest naming a main design loads it directly (FR-121b)", async () => {
  const info = {
    dir: "/data/proj",
    name: "P",
    manifestFile: "p-manifest.json",
    mainDesign: "cpu.json",
    warnings: [],
  };
  const h = harness({
    dialogResults: [{ path: "/data/proj/p-manifest.json", isDir: false }],
    api: { projectInfo: async () => info },
  });
  await h.ops.openProject();
  assert.equal(h.loads.length, 1);
  assert.equal(h.loads[0].path, "/data/proj/cpu.json");
  assert.equal(h.loads[0].projectInfo, info); // prefetched: no duplicate fetch
});

test("openProject with a picked design file opens that design", async () => {
  const h = harness({
    dialogResults: [{ path: "/data/proj/alu.json", isDir: false }],
  });
  await h.ops.openProject();
  assert.equal(h.loads[0].path, "/data/proj/alu.json");
});

test("openProject with no main design picks via the rooted dialog", async () => {
  const h = harness({
    dialogResults: [
      { path: "/data/proj", isDir: true },
      { path: "/data/proj/alu.json", isDir: false },
    ],
  });
  await h.ops.openProject();
  assert.equal(h.loads[0].path, "/data/proj/alu.json");
});

test("duplicateProject warns once per shared absolute data path (FR-121f)", async () => {
  const h = harness({
    dialogResults: [{ path: "/data/copy" }, null], // destination; then design pick cancelled
    api: {
      projectDuplicate: async (src, dst) => ({
        dir: dst,
        name: "copy",
        manifestFile: "copy-manifest.json",
        mainDesign: "",
        warnings: [],
      }),
      listDir: async () => ({
        entries: [{ name: "a.json", isDir: false }, { name: "sub", isDir: true }],
      }),
      loadDesign: async () => ({
        components: [
          { refdes: "U1", typeData: { mem: { kind: "ram", ramFile: "/shared/ram.bin" } } },
          { refdes: "U2", typeData: { mem: { kind: "rom", romFile: "rom.hex" } } },
        ],
      }),
    },
  });
  h.store.setProject({ dir: "/data/orig", name: "orig", manifestFile: "", mainDesign: "" });
  await h.ops.duplicateProject();
  // The duplicate is current with a fresh, project-named design (the §3.1 A9
  // asymmetry: the copy already happened, so a cancelled pick does not roll
  // back).
  assert.equal(h.store.state.project.dir, "/data/copy");
  assert.equal(h.store.state.design.name, "copy");
  const shared = h.posts.filter((m) => /still shared/.test(m));
  assert.equal(shared.length, 1);
  assert.match(shared[0], /U1/);
  assert.match(shared[0], /\/shared\/ram\.bin/);
});

test("duplicateProject opens the copied main design when the manifest names one", async () => {
  const info = {
    dir: "/data/copy",
    name: "copy",
    manifestFile: "copy-manifest.json",
    mainDesign: "cpu.json",
    warnings: [],
  };
  const h = harness({
    dialogResults: [{ path: "/data/copy" }],
    api: { projectDuplicate: async () => info },
  });
  h.store.setProject({ dir: "/data/orig", name: "orig", manifestFile: "", mainDesign: "" });
  await h.ops.duplicateProject();
  assert.equal(h.loads[0].path, "/data/copy/cpu.json");
});

test("duplicateProject reports a copy failure as partial-left (FR-121f)", async () => {
  const h = harness({
    dialogResults: [{ path: "/data/copy" }],
    api: { projectDuplicate: async () => { throw new Error("disk full"); } },
  });
  h.store.setProject({ dir: "/data/orig", name: "orig", manifestFile: "", mainDesign: "" });
  await h.ops.duplicateProject();
  assert.equal(h.store.state.project.dir, "/data/orig"); // previous project stays current
  assert.match(h.posts[0], /disk full/);
  assert.match(h.posts[0], /manual cleanup/);
});

test("duplicateProject without a current project is a no-op", async () => {
  const h = harness();
  await h.ops.duplicateProject();
  assert.equal(h.loads.length, 0);
  assert.equal(h.posts.length, 0);
});
