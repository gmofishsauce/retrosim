// Projects (§6.19, FR-121 group): the client side of the current project —
// pure helpers plus the New/Open/Duplicate Project lifecycle ops
// (makeProjectOps), wired into the File menu by app.js. The server holds no
// open-project state; the store's `project` value is the single client copy.

import {
  projectInfo as apiProjectInfo,
  projectCreate as apiProjectCreate,
  projectDuplicate as apiProjectDuplicate,
  projectImport as apiProjectImport,
  listDir as apiListDir,
  loadDesign as apiLoadDesign,
} from "../api.js";
import { openFileDialog as fileDialog } from "./dialogs.js";
import { postMessage } from "./statusbar.js";
import { dirOf, baseOf, relPath, resolveRel, inDir } from "../model/persist.js";
import { designInterface } from "../model/subdesign.js";

// isManifestName reports whether a file name matches the project-manifest
// pattern `*-manifest.json` (FR-121a), case-insensitively — mirroring the
// server's IsManifestName (§6.5a). Used by the design-save validator
// (fileops.js) and resolveProjectPick.
export function isManifestName(name) {
  return /-manifest\.json$/i.test(name);
}

// resolveProjectPick maps an Open Project pick to { dir, designPath } —
// FR-121b's three accepted forms, each resolving to the containing folder as
// the project: a folder is the project itself; a manifest file names its
// folder; a design file names its folder and is itself opened. Pure.
export function resolveProjectPick({ path, isDir }) {
  if (isDir) return { dir: path, designPath: null };
  const dir = dirOf(path);
  return isManifestName(baseOf(path))
    ? { dir, designPath: null }
    : { dir, designPath: path };
}

// absoluteDataPaths scans a *saved* design object for absolute mem data paths
// (typeData.mem.romFile/ramFile), returning [{ refdes, path }]. By FR-121g an
// absolute mem path in a saved design is by construction outside its project,
// so this is exactly the Duplicate Project shared-data warning scan
// (FR-121f). Pure.
export function absoluteDataPaths(designObj) {
  const hits = [];
  for (const c of designObj.components ?? []) {
    const mem = c.typeData?.mem;
    if (!mem) continue;
    for (const key of ["romFile", "ramFile"]) {
      const p = mem[key];
      if (typeof p === "string" && p.startsWith("/")) {
        hits.push({ refdes: c.refdes, path: p });
      }
    }
  }
  return hits;
}

// blockClosure computes the dependency closure of the design at `rootPath` —
// everything Import Block must copy for the block to work in another project
// (FR-121j, §6.19). It walks the *saved* form of each design with an injected
// `loadDesign(absPath)` (the `wouldCycle` pattern, §6.14), following both
// reference kinds: sub-design `childPath`s (stored relative to each parent,
// FR-098) and off-sheet `target.file`s (bare same-folder names, FR-101), which
// is exactly what `flatten` pulls in at Run (FR-102/FR-103).
//
// Returns:
//   designs    absolute paths, root first, each once, in discovery order
//   data       [{ src, rel }] for relative — hence in-project (FR-121g) — ROM
//              content / RAM save files; `rel` is preserved so the copied
//              design's reference still resolves
//   typeIds    every non-sub-design instance's typeData.id (the server decides
//              which are project-local and need copying — the merged palette
//              hides the tier here, FR-121i)
//   sharedData [{ design, refdes, path }] for absolute data paths, which stay
//              shared with the source project (the FR-121f warning)
//   warnings   non-fatal reports; the import proceeds
//   errors     fatal: the caller must not import
export async function blockClosure(rootPath, { loadDesign }) {
  const srcDir = dirOf(rootPath);
  const designs = [];
  const data = new Map(); // rel → absolute source
  const typeIds = new Set();
  const sharedData = [];
  const warnings = [];
  const errors = [];
  const seen = new Set();
  const queue = [{ path: rootPath, from: null }];

  while (queue.length) {
    const { path, from } = queue.shift();
    if (seen.has(path)) continue;
    seen.add(path);
    // Flat-source rule (FR-121j): every closure member must sit in the source
    // project root, since a copy to the destination root preserves only
    // same-folder references. The root satisfies this by definition.
    if (from && dirOf(path) !== srcDir) {
      errors.push(
        `${from} references ${path}, which is not a root-level file of ${srcDir} — ` +
          `move it beside ${from} (the project layout is flat) and import again`,
      );
      continue;
    }
    let obj;
    try {
      obj = await loadDesign(path);
    } catch (e) {
      if (from) {
        warnings.push(
          `${from} references ${baseOf(path)}, which cannot be read (${e.message}) — ` +
            `the link is already broken in the source and the copy keeps it that way`,
        );
      } else {
        errors.push(`cannot read ${path}: ${e.message}`);
      }
      continue;
    }
    if (!Array.isArray(obj?.components)) {
      const what = `${baseOf(path)} is not a design file`;
      if (from) warnings.push(`${from} references ${what} — not copied`);
      else errors.push(what);
      continue;
    }
    designs.push(path);
    // A port-less design has no interface, so it cannot be embedded (FR-095);
    // worth saying once, about the design the user actually picked.
    if (!from && designInterface(obj).length === 0) {
      warnings.push(`${baseOf(path)} has no ports, so it cannot be embedded as a sub-component`);
    }

    const here = baseOf(path);
    const dir = dirOf(path);
    for (const c of obj.components) {
      if (c.kind === "subdesign") {
        if (c.childPath) queue.push({ path: resolveRel(dir, c.childPath), from: here });
        continue; // a sub-design's typeData is synthetic and never saved (FR-098)
      }
      if (c.typeData?.id) typeIds.add(c.typeData.id);
      if (c.typeData?.renderType === "port" && c.target?.file) {
        queue.push({ path: resolveRel(dir, c.target.file), from: here });
      }
      const mem = c.typeData?.mem;
      if (!mem) continue;
      for (const key of ["romFile", "ramFile"]) {
        const p = mem[key];
        if (typeof p !== "string" || p === "") continue;
        if (p.startsWith("/")) {
          sharedData.push({ design: here, refdes: c.refdes, path: p });
          continue;
        }
        const abs = resolveRel(dir, p);
        if (!inDir(abs, srcDir)) {
          warnings.push(
            `${here}: ${c.refdes}'s data file ${p} resolves outside the source project — not copied`,
          );
          continue;
        }
        data.set(relPath(srcDir, abs), abs);
      }
    }
  }

  return {
    designs,
    data: [...data].map(([rel, src]) => ({ src, rel })),
    typeIds: [...typeIds],
    sharedData,
    warnings,
    errors,
  };
}

// makeProjectOps builds the project lifecycle ops (§6.19). `freshDesign` is a
// factory for an FR-004-style empty design (app.js supplies it); deps are
// injectable for tests (the connection.js pattern).
export function makeProjectOps(
  { store, dataDir, fileops, freshDesign, reloadLibrary = async () => {} },
  {
    projectInfo = apiProjectInfo,
    projectCreate = apiProjectCreate,
    projectDuplicate = apiProjectDuplicate,
    projectImport = apiProjectImport,
    listDir = apiListDir,
    loadDesign = apiLoadDesign,
    openFileDialog = fileDialog,
    post = postMessage,
    confirm = (msg) => window.confirm(msg),
  } = {},
) {
  // setCurrentProject makes dir the current project: it fetches the server's
  // ProjectInfo when the caller has not already resolved it (Open/Duplicate
  // Project have), records the client mirror in the store, and posts each
  // manifest warning to the tray (FR-074: extra manifests, unparseable
  // manifest, dangling main design — FR-121a). An info fetch failure degrades
  // to the folder-name fallback — a project must stay usable with a broken
  // manifest (FR-121a) — with a tray report.
  async function setCurrentProject(dir, info) {
    if (!info) {
      try {
        info = await projectInfo(dir);
      } catch (e) {
        post(`Could not read project info for ${dir}: ${e.message}`);
        info = { dir, name: baseOf(dir), manifestFile: "", mainDesign: "", warnings: [] };
      }
    }
    for (const w of info.warnings ?? []) post("Project: " + w);
    store.setProject({
      dir,
      name: info.name,
      manifestFile: info.manifestFile,
      mainDesign: info.mainDesign,
    });
    // Reload the merged shared ∪ project component library for the incoming
    // project and rebuild the palette, discarding the outgoing project's local
    // parts (FR-121i). Scan warnings post to the tray inside reloadLibrary.
    await reloadLibrary(dir);
  }

  // dirtyGuard is the FR-049a unsaved-changes warning shared by the three
  // project navigations (they discard the canvas, FR-121b).
  function dirtyGuard() {
    return !store.state.dirty || confirm("Discard unsaved changes?");
  }

  // freshCanvas replaces the canvas with a fresh empty design in the (new)
  // current project (FR-121c) and starts a fresh navigation chain. The design
  // is named after the project (FR-121b — not the FR-045 default), so the
  // first save prefills `<project>.json`.
  function freshCanvas() {
    store.replaceDesign(freshDesign(store.state.project?.name), { savePath: null });
    fileops.clearNavStack();
  }

  // promptForProjectDir prompts for a location + name for a new project
  // directory (the New Project prompt, FR-121b, reused by Duplicate): a
  // save-mode dialog seeded at the data directory (FR-050), listing
  // directories only (exts ["-"], §6.5), appending no extension to the typed
  // name (saveExt null). Resolves to the absolute path or null on cancel.
  function promptForProjectDir(title) {
    return openFileDialog({
      mode: "save",
      title,
      startPath: dataDir,
      exts: ["-"],
      saveExt: null,
    });
  }

  // newProject creates a project directory with a fresh manifest and enters
  // it with a new empty design (FR-121b/FR-121c).
  async function newProject() {
    if (!dirtyGuard()) return;
    const res = await promptForProjectDir("New Project");
    if (!res) return;
    let info;
    try {
      info = await projectCreate(res.path);
    } catch (e) {
      post("New Project failed: " + e.message);
      return;
    }
    await setCurrentProject(info.dir, info);
    freshCanvas();
  }

  // hasDesigns reports whether a project directory holds at least one
  // root-level design file (§6.19). Subdirectories do not count: the project
  // layout is flat (FR-121). A listing failure answers true, which keeps the
  // caller on the picker path — the pre-2026-08-06 behavior (§3.1 A9).
  async function hasDesigns(dir) {
    try {
      const listing = await listDir(dir); // .json, manifests excluded
      return listing.entries.some((e) => !e.isDir);
    } catch {
      return true;
    }
  }

  // openProject opens a project picked as a folder, a manifest file, or a
  // design file (FR-121b). A picked design, or the manifest's main design,
  // opens immediately; otherwise, if the project holds any design, the
  // open-design dialog is presented rooted at the project — and a cancel there
  // cancels the whole action: no project change, no canvas change (§3.1 A9).
  // An empty project skips the picker and is entered with a fresh canvas, the
  // way New Project ends (§3.1 A9 as amended 2026-08-06): its picker would
  // have nothing to offer, and cancelling it left the project unreachable —
  // New Project cannot re-enter an existing directory either.
  async function openProject() {
    if (!dirtyGuard()) return;
    const res = await openFileDialog({
      mode: "open",
      title: "Open Project",
      startPath: dataDir,
      allowDir: true,
      includeManifests: true,
    });
    if (!res) return;
    const { dir, designPath: picked } = resolveProjectPick(res);
    let info;
    try {
      info = await projectInfo(dir);
    } catch (e) {
      post("Open Project failed: " + e.message);
      return;
    }
    let designPath = picked ?? (info.mainDesign ? dir + "/" + info.mainDesign : null);
    if (!designPath) {
      if (!(await hasDesigns(dir))) {
        // Empty project: enter it with a fresh design named after it, exactly
        // as newProject ends (§3.1 A9 as amended).
        await setCurrentProject(dir, info);
        freshCanvas();
        return;
      }
      // No design named: pick one, rooted at the project (ignoreLastDir,
      // §3.1 A11).
      const pick = await openFileDialog({
        mode: "open",
        startPath: dir,
        ignoreLastDir: true,
      });
      if (!pick) return; // cancel cancels the whole action
      designPath = pick.path;
    }
    // A successful load establishes the project via the containing-folder
    // rule with the prefetched info; a failure aborts with no state change.
    await fileops.loadIntoStore(designPath, { projectInfo: info });
  }

  // duplicateProject copies the entire current project directory to a new
  // one and enters the duplicate (FR-121f). The dirty guard runs first —
  // duplication copies files on disk, not the unsaved canvas. After entering,
  // the shared-data scan warns about absolute (outside-project) ROM/RAM paths
  // still shared with the original.
  async function duplicateProject() {
    const src = store.state.project;
    if (!src) return;
    if (!dirtyGuard()) return;
    const res = await promptForProjectDir("Duplicate Project");
    if (!res) return;
    let info;
    try {
      info = await projectDuplicate(src.dir, res.path);
    } catch (e) {
      post(`Duplicate Project failed: ${e.message} — any partially copied files at ${res.path} are left for manual cleanup`);
      return;
    }
    await setCurrentProject(info.dir, info);
    // Open per FR-121b. The copy has already happened, so — unlike Open
    // Project — a cancelled or failed pick leaves the duplicate current with
    // a fresh empty design (§3.1 A9's noted asymmetry).
    let opened = false;
    if (info.mainDesign) {
      opened = await fileops.loadIntoStore(info.dir + "/" + info.mainDesign, {
        projectInfo: info,
      });
    } else {
      const pick = await openFileDialog({
        mode: "open",
        startPath: info.dir,
        ignoreLastDir: true,
      });
      if (pick) opened = await fileops.loadIntoStore(pick.path, { projectInfo: info });
    }
    if (!opened) freshCanvas();
    await warnSharedDataPaths(info.dir);
  }

  // warnSharedDataPaths is Duplicate Project's shared-data scan (FR-121f):
  // every absolute ROM content / RAM save path referenced by any design in
  // the duplicate is still shared with the original — in particular a shared
  // RAM save file, which running the duplicate would overwrite (FR-114g).
  // Non-fatal throughout (tray only).
  async function warnSharedDataPaths(dir) {
    try {
      const listing = await listDir(dir); // designs only: manifests excluded by default
      for (const entry of listing.entries) {
        if (entry.isDir) continue;
        try {
          const obj = await loadDesign(dir + "/" + entry.name);
          for (const { refdes, path } of absoluteDataPaths(obj)) {
            post(
              `${entry.name}: ${refdes}'s data file ${path} is still shared with the original project`,
            );
          }
        } catch {
          // not a readable design (or not a design at all): skip
        }
      }
    } catch (e) {
      post("Shared-data scan of the duplicate failed: " + e.message);
    }
  }

  // importBlock copies a design from another project into this one together
  // with its dependency closure (FR-121j): the client walks the closure (it
  // owns the save format), the server preflights collisions and copies
  // byte-verbatim (it owns the library and the filesystem, §8). No dirty guard
  // — the canvas, the current design, and the current project are untouched.
  async function importBlock() {
    const dst = store.state.project;
    if (!dst) return;
    const res = await openFileDialog({
      mode: "open",
      title: "Import Block",
      startPath: dataDir,
    });
    if (!res) return;
    if (inDir(res.path, dst.dir)) {
      post(`Import Block: ${baseOf(res.path)} is already in this project`);
      return;
    }
    const closure = await blockClosure(res.path, { loadDesign });
    for (const w of closure.warnings) post("Import Block: " + w);
    if (closure.errors.length) {
      for (const e of closure.errors) post("Import Block failed: " + e);
      return;
    }
    let out;
    try {
      out = await projectImport({
        srcProject: dirOf(res.path),
        dst: dst.dir,
        designs: closure.designs,
        data: closure.data,
        typeIds: closure.typeIds,
      });
    } catch (e) {
      post("Import Block failed: " + e.message);
      return;
    }
    for (const w of out.warnings ?? []) post("Import Block: " + w);
    const copied = [...(out.designs ?? []), ...(out.data ?? []), ...(out.components ?? [])];
    post(
      `Imported ${baseOf(res.path)} into ${dst.name}: ` +
        `${copied.length} file${copied.length === 1 ? "" : "s"} — ${copied.join(", ")}`,
    );
    // Absolute data paths came along by reference only, exactly as Duplicate
    // Project reports (FR-121f/FR-121j).
    for (const { design, refdes, path } of closure.sharedData) {
      post(`${design}: ${refdes}'s data file ${path} is still shared with the source project`);
    }
    // Imported components/ types reach the palette without a Refresh Types.
    await reloadLibrary(dst.dir);
  }

  return { setCurrentProject, newProject, openProject, duplicateProject, importBlock };
}
