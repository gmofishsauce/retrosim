import { test } from "node:test";
import assert from "node:assert/strict";

import { createStore } from "../store.js";
import {
  isManifestName,
  resolveProjectPick,
  absoluteDataPaths,
  blockClosure,
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
      projectImport: api.projectImport ?? (async () => { throw new Error("unexpected import"); }),
      // Default: a project that already holds a design, so openProject's
      // no-main-design path reaches the rooted picker (§3.1 A9). Tests of the
      // empty-project path override this.
      listDir: api.listDir ?? (async () => ({ entries: [{ name: "existing.json", isDir: false }] })),
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

test("openProject enters an empty project with a fresh canvas, no picker (§3.1 A9)", async () => {
  // Only the project pick is scripted: a second dialog would consume `null`
  // and cancel, so reaching the fresh canvas proves no picker was shown.
  const h = harness({
    dialogResults: [{ path: "/data/empty", isDir: true }],
    api: {
      projectInfo: async (dir) => ({
        dir,
        name: "empty",
        manifestFile: "empty-manifest.json",
        mainDesign: "",
        warnings: [],
      }),
      // A subdirectory alone is not a design: the layout is flat (FR-121).
      listDir: async () => ({ entries: [{ name: "components", isDir: true }] }),
    },
  });
  await h.ops.openProject();
  assert.equal(h.store.state.project.dir, "/data/empty");
  assert.equal(h.loads.length, 0);
  // Same ending as newProject: named after the project, unsaved, fresh chain.
  assert.equal(h.store.state.design.name, "empty");
  assert.equal(h.store.state.designName, "empty");
  assert.equal(h.store.state.savePath, null);
  assert.equal(h.navCleared(), 1);
});

test("openProject falls back to the picker when the listing fails (§3.1 A9)", async () => {
  const h = harness({
    dialogResults: [{ path: "/data/proj", isDir: true }, null],
    api: { listDir: async () => { throw new Error("permission denied"); } },
  });
  await h.ops.openProject();
  // The picker appeared and was cancelled: pre-amendment behavior, nothing changes.
  assert.equal(h.store.state.project, null);
  assert.equal(h.store.state.design.name, "d0");
  assert.equal(h.loads.length, 0);
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

// --- block import: the closure walk (FR-121j, §6.19) ---

// port builds a saved 1-wide port instance, optionally with an off-sheet target.
const port = (refdes, label, target = null) => ({
  refdes,
  label,
  typeData: { id: "type-port", renderType: "port", pins: [{ name: "P" }] },
  ...(target ? { target } : {}),
});

// SRC is a source project whose root block embeds two children (one of which
// embeds a grandchild the other also embeds — a diamond) and reaches a peer
// sheet through an off-sheet target.
const SRC = {
  "/a/alu/alu.json": {
    components: [
      { refdes: "X1", kind: "subdesign", childPath: "adder.json" },
      { refdes: "X2", kind: "subdesign", childPath: "mul.json" },
      { refdes: "U1", typeData: { id: "type-7400", mem: { kind: "rom", romFile: "rom.bin" } } },
      { refdes: "U2", typeData: { id: "type-GAL-A", mem: { kind: "ram", ramFile: "/shared/ram.bin" } } },
      port("P1", "CLK", { file: "sheet2.json", label: "CLK" }),
    ],
  },
  "/a/alu/adder.json": {
    components: [
      { refdes: "X1", kind: "subdesign", childPath: "gate.json" },
      { refdes: "U1", typeData: { id: "type-7400" } },
      port("P1", "A"),
    ],
  },
  "/a/alu/mul.json": {
    components: [{ refdes: "X1", kind: "subdesign", childPath: "gate.json" }, port("P1", "B")],
  },
  "/a/alu/gate.json": { components: [{ refdes: "U1", typeData: { id: "type-7402" } }, port("P1", "G")] },
  "/a/alu/sheet2.json": { components: [port("P1", "CLK")] },
};

const loaderFor = (files) => async (path) => {
  if (!(path in files)) throw new Error("no such file");
  return files[path];
};

test("blockClosure follows embeds and off-sheet targets, once each (FR-121j)", async () => {
  const c = await blockClosure("/a/alu/alu.json", { loadDesign: loaderFor(SRC) });
  assert.deepEqual(c.errors, []);
  assert.deepEqual(c.warnings, []);
  assert.deepEqual(c.designs, [
    "/a/alu/alu.json",
    "/a/alu/adder.json",
    "/a/alu/mul.json",
    "/a/alu/sheet2.json",
    "/a/alu/gate.json", // the diamond's shared grandchild, collected once
  ]);
  // Type ids de-duplicate across designs; sub-design instances contribute none
  // (their typeData is synthetic and unsaved, FR-098).
  assert.deepEqual(c.typeIds.sort(), ["type-7400", "type-7402", "type-GAL-A", "type-port"]);
});

test("blockClosure separates relative data files from shared absolute ones (FR-121g/FR-121f)", async () => {
  const c = await blockClosure("/a/alu/alu.json", { loadDesign: loaderFor(SRC) });
  assert.deepEqual(c.data, [{ src: "/a/alu/rom.bin", rel: "rom.bin" }]);
  assert.deepEqual(c.sharedData, [
    { design: "alu.json", refdes: "U2", path: "/shared/ram.bin" },
  ]);
});

test("blockClosure keeps a data file's relative sub-path (FR-121g)", async () => {
  const files = {
    "/a/alu/alu.json": {
      components: [
        port("P1", "A"),
        { refdes: "U1", typeData: { id: "type-ROM", mem: { romFile: "roms/prog.bin" } } },
        { refdes: "U2", typeData: { id: "type-ROM2", mem: { romFile: "../outside.bin" } } },
      ],
    },
  };
  const c = await blockClosure("/a/alu/alu.json", { loadDesign: loaderFor(files) });
  assert.deepEqual(c.data, [{ src: "/a/alu/roms/prog.bin", rel: "roms/prog.bin" }]);
  assert.deepEqual(c.errors, []);
  assert.equal(c.warnings.length, 1);
  assert.match(c.warnings[0], /outside the source project/);
});

test("blockClosure warns about a broken child link but still imports (FR-099a)", async () => {
  const files = {
    "/a/alu/alu.json": {
      components: [port("P1", "A"), { refdes: "X1", kind: "subdesign", childPath: "gone.json" }],
    },
  };
  const c = await blockClosure("/a/alu/alu.json", { loadDesign: loaderFor(files) });
  assert.deepEqual(c.errors, []);
  assert.deepEqual(c.designs, ["/a/alu/alu.json"]);
  assert.equal(c.warnings.length, 1);
  assert.match(c.warnings[0], /gone\.json/);
});

test("blockClosure errors on an unreadable or non-design root (FR-121j)", async () => {
  const missing = await blockClosure("/a/alu/gone.json", { loadDesign: loaderFor(SRC) });
  assert.equal(missing.designs.length, 0);
  assert.equal(missing.errors.length, 1);
  const notDesign = await blockClosure("/a/alu/x.json", {
    loadDesign: async () => ({ formatVersion: 1, rows: [] }),
  });
  assert.equal(notDesign.errors.length, 1);
  assert.match(notDesign.errors[0], /not a design file/);
});

test("blockClosure errors on a child outside the source project root (FR-121/FR-121j)", async () => {
  const files = {
    "/a/alu/alu.json": {
      components: [
        port("P1", "A"),
        { refdes: "X1", kind: "subdesign", childPath: "../other/lib.json" },
        { refdes: "X2", kind: "subdesign", childPath: "sub/deep.json" },
      ],
    },
    "/a/other/lib.json": { components: [] },
    "/a/alu/sub/deep.json": { components: [] },
  };
  const c = await blockClosure("/a/alu/alu.json", { loadDesign: loaderFor(files) });
  assert.equal(c.errors.length, 2);
  for (const e of c.errors) assert.match(e, /alu\.json references/);
});

test("blockClosure warns when the picked design has no ports (FR-095)", async () => {
  const files = { "/a/alu/alu.json": { components: [{ refdes: "U1", typeData: { id: "type-7400" } }] } };
  const c = await blockClosure("/a/alu/alu.json", { loadDesign: loaderFor(files) });
  assert.deepEqual(c.errors, []);
  assert.equal(c.warnings.length, 1);
  assert.match(c.warnings[0], /no ports/);
});

// --- importBlock, the op (FR-121j) ---

// importHarness sets a current project and records the plan sent to the server.
function importHarness({ pick = { path: "/a/alu/alu.json" }, files = SRC, projectImport } = {}) {
  const plans = [];
  const h = harness({
    dialogResults: [pick],
    api: {
      loadDesign: loaderFor(files),
      projectImport:
        projectImport ??
        (async (plan) => {
          plans.push(plan);
          return { designs: ["alu.json"], data: ["rom.bin"], components: [], warnings: [] };
        }),
    },
  });
  h.store.setProject({ dir: "/data/cpu", name: "cpu", manifestFile: "", mainDesign: "" });
  return { ...h, plans };
}

test("importBlock sends the closure as a copy plan and reloads the library (FR-121j)", async () => {
  const h = importHarness();
  await h.ops.importBlock();
  assert.equal(h.plans.length, 1);
  assert.equal(h.plans[0].srcProject, "/a/alu");
  assert.equal(h.plans[0].dst, "/data/cpu");
  assert.equal(h.plans[0].designs.length, 5);
  assert.deepEqual(h.plans[0].data, [{ src: "/a/alu/rom.bin", rel: "rom.bin" }]);
  assert.deepEqual(h.reloads, ["/data/cpu"]); // imported types reach the palette
  assert.ok(h.posts.some((m) => /Imported alu\.json into cpu/.test(m)));
  // The absolute RAM path is reported as still shared with the source.
  assert.ok(h.posts.some((m) => /\/shared\/ram\.bin.*shared with the source/.test(m)));
  // The canvas and the current project are untouched.
  assert.equal(h.store.state.project.dir, "/data/cpu");
  assert.equal(h.loads.length, 0);
});

test("importBlock refuses a design already in the current project (FR-121j)", async () => {
  const h = importHarness({ pick: { path: "/data/cpu/alu.json" } });
  await h.ops.importBlock();
  assert.equal(h.plans.length, 0);
  assert.match(h.posts[0], /already in this project/);
});

test("importBlock aborts on a closure error before calling the server (FR-121j)", async () => {
  const h = importHarness({
    files: {
      "/a/alu/alu.json": {
        components: [port("P1", "A"), { refdes: "X1", kind: "subdesign", childPath: "../other/x.json" }],
      },
    },
  });
  await h.ops.importBlock();
  assert.equal(h.plans.length, 0);
  assert.equal(h.reloads.length, 0);
  assert.match(h.posts.at(-1), /Import Block failed/);
});

test("importBlock reports a server collision and copies nothing (FR-121j)", async () => {
  const h = importHarness({
    projectImport: async () => {
      throw new Error("import refused: alu.json already exists in this project");
    },
  });
  await h.ops.importBlock();
  assert.equal(h.reloads.length, 0);
  assert.match(h.posts.at(-1), /Import Block failed: import refused: alu\.json already exists/);
});

test("importBlock does nothing when the pick is cancelled or no project is current", async () => {
  const cancelled = importHarness({ pick: null });
  await cancelled.ops.importBlock();
  assert.equal(cancelled.plans.length, 0);
  assert.equal(cancelled.posts.length, 0);

  const noProject = harness({ dialogResults: [{ path: "/a/alu/alu.json" }] });
  await noProject.ops.importBlock();
  assert.equal(noProject.posts.length, 0);
});
