// Projects (§6.19, FR-121 group): the client side of the current project —
// pure helpers plus the New/Open/Duplicate Project lifecycle ops
// (makeProjectOps), wired into the File menu by app.js. The server holds no
// open-project state; the store's `project` value is the single client copy.

import {
  projectInfo as apiProjectInfo,
  projectCreate as apiProjectCreate,
  projectDuplicate as apiProjectDuplicate,
  listDir as apiListDir,
  loadDesign as apiLoadDesign,
} from "../api.js";
import { openFileDialog as fileDialog } from "./dialogs.js";
import { postMessage } from "./statusbar.js";
import { dirOf, baseOf } from "../model/persist.js";

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

// makeProjectOps builds the project lifecycle ops (§6.19). `freshDesign` is a
// factory for an FR-004-style empty design (app.js supplies it); deps are
// injectable for tests (the connection.js pattern).
export function makeProjectOps(
  { store, dataDir, fileops, freshDesign },
  {
    projectInfo = apiProjectInfo,
    projectCreate = apiProjectCreate,
    projectDuplicate = apiProjectDuplicate,
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
  }

  // dirtyGuard is the FR-049a unsaved-changes warning shared by the three
  // project navigations (they discard the canvas, FR-121b).
  function dirtyGuard() {
    return !store.state.dirty || confirm("Discard unsaved changes?");
  }

  // freshCanvas replaces the canvas with a fresh empty design in the (new)
  // current project (FR-121c) and starts a fresh navigation chain.
  function freshCanvas() {
    store.replaceDesign(freshDesign(), { savePath: null });
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

  // openProject opens a project picked as a folder, a manifest file, or a
  // design file (FR-121b). A picked design, or the manifest's main design,
  // opens immediately; otherwise the open-design dialog is presented rooted
  // at the project — and a cancel there cancels the whole action: no project
  // change, no canvas change (§3.1 A9).
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
      // No design named: pick one, rooted at the project (ignoreLastDir,
      // §3.1 A11). A projectless empty folder cannot be entered this way
      // (§3.1 A9); New Project is the flow that creates-and-enters one.
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

  return { setCurrentProject, newProject, openProject, duplicateProject };
}
