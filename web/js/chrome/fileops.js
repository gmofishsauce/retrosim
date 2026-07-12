// File-operation orchestration (§6.11): New / Open / Save / Save As, tying the
// store, the persistence model, the REST client, and the file dialog together.

import { createDesign } from "../model/design.js";
import {
  serializeDesign,
  deserializeDesign,
  FORMAT_VERSION,
  dirOf,
  baseOf,
  relPath,
  resolveRel,
  relativizeDataPaths,
  absolutizeDataPaths,
} from "../model/persist.js";
import { designInterface, resolveSubDesigns, effectivePortDir, wouldCycle } from "../model/subdesign.js";
import { placeSubDesign } from "../commands.js";
import { saveDesign as apiSave, loadDesign as apiLoad } from "../api.js";
import { openFileDialog, chooseRenderDialog } from "./dialogs.js";
import { isManifestName } from "./project.js";
import { postMessage } from "./statusbar.js";
import { rerouteAttachedWires } from "../engine/router.js";

function toast(msg) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

function sanitize(name) {
  return (name || "untitled").replace(/[^\w .-]/g, "_");
}

// The POSIX-style path helpers (dirOf/baseOf/relPath/resolveRel) live in
// model/persist.js since the FR-121g data-path conversion (§6.19); imported
// above.

export function makeFileOps({ store, dataDir, defaultName, onNavChange = () => {}, onLoaded = () => {}, setCurrentProject = async () => {} }) {
  // navStack records the absolute paths of the sheets descended through, so the
  // user can step back up the chain (FR-100a). Session-only: not persisted, not
  // on the undo stack. A plain Open/New starts a fresh chain.
  const navStack = [];
  const notifyNav = () => onNavChange(navStack.length);

  // inProject reports whether an absolute path lies inside the current
  // project directory (FR-121d/FR-121e).
  const inProject = (p) => {
    const d = store.state.project?.dir.replace(/\/+$/, "");
    return !!d && (p === d || p.startsWith(d + "/"));
  };

  // noProject guards the fileops entry points that need a current project
  // (FR-121c) — defense in depth: the chrome already disables them and the
  // store lock refuses dispatches (§6.10/§6.11), but a bound key must not
  // bypass a disabled item (§6.19).
  function noProject(what) {
    if (store.state.project) return false;
    postMessage(`${what} needs an open project — use File ▸ New Project or Open Project`);
    return true;
  }

  // save writes the current design; prompts for a location on first save or
  // Save As (FR-046/047/048/049), rooted at the current project (FR-121e/
  // FR-121h) — the prompt effectively asks only for a name (FR-047).
  async function save({ saveAs = false } = {}) {
    if (noProject("Save")) return;
    let path = store.state.savePath;
    if (saveAs || !path) {
      const suggested =
        store.state.savePath?.split("/").pop() ||
        sanitize(store.state.designName) + ".json";
      const res = await openFileDialog({
        mode: "save",
        startPath: store.state.project.dir,
        defaultName: suggested,
        // The design-save validator (§6.19): a design may not be named like a
        // project manifest (FR-121a), and the save is confined to the current
        // project (FR-121e) — shown inline and posted to the tray (FR-074).
        validate: (p) => {
          let problem = null;
          if (isManifestName(baseOf(p))) {
            problem = `"${baseOf(p)}" matches the project-manifest pattern (*-manifest.json) — pick another name`;
          } else if (!inProject(p)) {
            problem = "a design saves inside its project — to fork the whole project use File ▸ Duplicate Project";
          }
          if (problem) postMessage("Save rejected: " + problem);
          return problem;
        },
      });
      if (!res) return;
      path = res.path;
    }
    try {
      // The design adopts the chosen file's base name (FR-047a): override the
      // serialized name so the file matches, and update the store only after
      // the write succeeds.
      const name = path.split(/[\\/]/).pop().replace(/\.json$/i, "");
      const out = { ...serializeDesign(store.design), name };
      // Sub-design child paths are absolute in memory (FR-098); write them
      // relative to this file's dir so the saved design stays portable. The
      // serialized sub-design entries are fresh objects (stripSubDesign), so
      // mutating them does not touch the live model.
      const baseDir = dirOf(path);
      for (const c of out.components) {
        if (c.kind === "subdesign" && c.childPath) {
          c.childPath = relPath(baseDir, c.childPath);
        }
      }
      // Persist each port's effective direction (FR-094c/FR-094d) without
      // mutating the live model: replace the port entries with copies carrying
      // the value. The dirOverride itself round-trips verbatim (FR-094d).
      const portDir = new Map();
      for (const c of store.design.components) {
        const rt = c.typeData?.renderType;
        if (rt === "port" || rt === "portN") {
          portDir.set(c.refdes, effectivePortDir(store.design, c.refdes));
        }
      }
      out.components = out.components.map((c) =>
        portDir.has(c.refdes) ? { ...c, portDir: portDir.get(c.refdes) } : c,
      );
      // In-project mem data paths (ROM content, RAM save) are written
      // design-dir-relative (FR-121g); copy-on-write, so the live model keeps
      // its absolute paths.
      relativizeDataPaths(out, baseDir, store.state.project.dir);
      await apiSave(path, out);
      store.markSaved(path, name);
      await recordMainDesign(path);
    } catch (e) {
      toast("Save failed: " + e.message);
    }
  }

  // recordMainDesign implements FR-121a's first-saved-design rule: when the
  // current project carries a manifest whose mainDesign is unset, the first
  // design saved into it is recorded as the main design — a read-modify-write
  // of the manifest over the design load/save endpoints (the `.tv` precedent,
  // §6.19). Non-fatal: any failure posts to the tray and the save stands.
  async function recordMainDesign(savedPath) {
    const project = store.state.project;
    if (!project?.manifestFile || project.mainDesign) return;
    try {
      const manifestPath = project.dir + "/" + project.manifestFile;
      const manifest = await apiLoad(manifestPath);
      const mainDesign = baseOf(savedPath);
      await apiSave(manifestPath, { ...manifest, mainDesign });
      store.setProject({ ...project, mainDesign });
    } catch (e) {
      postMessage("Could not record the main design in the project manifest: " + e.message);
    }
  }

  // loadIntoStore loads the design at an absolute path and makes it the current
  // design, resolving its sub-designs' interfaces first (FR-098). Returns true on
  // success, false (with a toast) on failure. Shared by Open (FR-052), Open
  // Project (§6.19, which prefetches `projectInfo`), and navigation (FR-100);
  // it performs no unsaved-changes guard of its own. On success the
  // containing-folder rule applies (§3.1 A10): a loaded design whose folder
  // differs from the current project's directory makes that folder current.
  async function loadIntoStore(absPath, { projectInfo } = {}) {
    try {
      const obj = await apiLoad(absPath);
      // Warn when the file is newer than this client understands (§7.4) but
      // load it anyway (forward-compat).
      if ((obj.formatVersion ?? 1) > FORMAT_VERSION) {
        toast(
          `Design format v${obj.formatVersion} is newer than this editor ` +
            `understands (v${FORMAT_VERSION}); loading anyway`,
        );
      }
      const loaded = deserializeDesign(obj);
      // Sub-design child paths are stored relative to this design's dir on disk
      // but held absolute in memory (FR-098): absolutize them before resolving
      // interfaces, so the live model carries absolute paths. Relative mem data
      // paths (ROM content, RAM save) absolutize the same way (FR-121g).
      const baseDir = dirOf(absPath);
      for (const inst of loaded.components) {
        if (inst.kind === "subdesign" && inst.childPath) {
          inst.childPath = resolveRel(baseDir, inst.childPath);
        }
      }
      absolutizeDataPaths(loaded, baseDir);
      // A legacy child reference outside the project still loads, renders, and
      // simulates (FR-121d) — the boundary violation is reported once per
      // offending path (FR-074). Containment is checked against this design's
      // own folder, which under the flat layout is its project root (§6.19).
      const outside = new Set();
      for (const inst of loaded.components) {
        if (inst.kind !== "subdesign" || !inst.childPath) continue;
        const d = baseDir.replace(/\/+$/, "");
        if (inst.childPath !== d && !inst.childPath.startsWith(d + "/")) {
          outside.add(inst.childPath);
        }
      }
      for (const p of outside) {
        postMessage(`Sub-design ${p} lies outside the project directory (legacy reference) — it still works, but new outside-project references are refused`);
      }
      const { changed } = await resolveSubDesigns(loaded, (childPath) => apiLoad(childPath), toast);
      // A child whose interface changed since this parent was saved re-lays-out
      // its pins; re-route the stale simple wires (FR-099c, load-time
      // normalization — before replaceDesign, so no dirty mark and no undo).
      for (const refdes of changed) {
        const n = rerouteAttachedWires(loaded, [refdes]);
        toast(`sub-design ${refdes}: interface changed; ${n} wire${n === 1 ? "" : "s"} re-routed`);
      }
      store.replaceDesign(loaded, { savePath: absPath });
      // Containing-folder rule (§3.1 A10, FR-121b): switching falls out of
      // this one shared load path. `projectInfo` avoids a duplicate fetch when
      // Open Project already resolved it.
      if (!store.state.project || dirOf(absPath) !== store.state.project.dir) {
        await setCurrentProject(dirOf(absPath), projectInfo);
      }
      onLoaded();
      return true;
    } catch (e) {
      toast("Open failed: " + e.message);
      return false;
    }
  }

  // navigateTo replaces the canvas with the design at an absolute path, behind
  // the FR-049a unsaved-changes guard (the navigation = a save-or-lose Open,
  // FR-100). Returns true once the new design is loaded, false if the user
  // cancelled or the load failed.
  async function navigateTo(absPath) {
    if (store.state.dirty && !window.confirm("Discard unsaved changes?")) return false;
    return loadIntoStore(absPath);
  }

  // descend opens the child design referenced by a sub-design instance (FR-100):
  // it resolves the child's relative path against the current design's save dir,
  // navigates to it, and on success pushes the parent onto the back-stack so the
  // user can return (FR-100a). A sub-design's parent is always saved (FR-097b).
  async function descend(childPath) {
    let parentPath = store.state.savePath;
    if (!parentPath) {
      // Phase-1 interim (FR-100a): returning re-opens the parent from its file,
      // so it must be saved before we can descend and come back to it.
      if (!window.confirm("Save this design first? It must be saved so you can return to it after opening the sub-component.")) {
        return;
      }
      await save();
      parentPath = store.state.savePath;
      if (!parentPath) return; // save cancelled
    }
    // childPath is already absolute in memory (FR-098).
    if (await navigateTo(childPath)) {
      navStack.push(parentPath);
      notifyNav();
    }
  }

  // followTarget navigates to a port's off-sheet target sheet (FR-101/FR-101b):
  // the target file is a bare filename in this design's own folder (FR-101), so
  // a never-saved design is prompted to save first — resolving the sibling name
  // needs a directory, and back (FR-100a) needs a file to return to (the same
  // interim rule as descend). On success the referring sheet joins the
  // back-stack exactly like a descent.
  async function followTarget(target) {
    if (!target?.file) return;
    let fromPath = store.state.savePath;
    if (!fromPath) {
      if (!window.confirm("Save this design first? Its location is needed to resolve the off-sheet target (and so you can return to it).")) {
        return;
      }
      await save();
      fromPath = store.state.savePath;
      if (!fromPath) return; // save cancelled
    }
    const abs = resolveRel(dirOf(fromPath), target.file);
    if (await navigateTo(abs)) {
      navStack.push(fromPath);
      notifyNav();
    }
  }

  // back returns to the parent sheet at the top of the back-stack (FR-100a),
  // itself a save-or-lose navigation; the entry is popped only once the parent
  // has loaded, so a cancelled back leaves the breadcrumb intact.
  async function back() {
    if (!navStack.length) return;
    if (await navigateTo(navStack[navStack.length - 1])) {
      navStack.pop();
      notifyNav();
    }
  }

  // open navigates to and loads a design (FR-052), warning about unsaved
  // changes first (FR-049a). A plain Open leaves the hierarchy, so the
  // back-stack is cleared.
  async function open() {
    if (store.state.dirty && !window.confirm("Discard unsaved changes?")) return;
    const res = await openFileDialog({ mode: "open", startPath: dataDir });
    if (!res) return;
    if (await loadIntoStore(res.path)) {
      navStack.length = 0;
      notifyNav();
    }
  }

  // addSubDesign embeds a child design as a sub-design instance at (x,y) on the
  // canvas (FR-097/098, §6.14). The child path is held absolute in memory and
  // relativized at save (FR-098), so embedding needs no saved parent (FR-097b).
  // The picker is seeded at the project root (FR-121h) and a child outside the
  // project is refused (FR-121d/FR-097a).
  async function addSubDesign(x, y) {
    if (noProject("Add sub-component")) return;
    const parentPath = store.state.savePath; // may be null (unsaved parent)
    const res = await openFileDialog({
      mode: "open",
      startPath: store.state.project.dir,
    });
    if (!res) return;
    if (!inProject(res.path)) {
      toast("Cannot embed: that design lies outside the current project");
      return;
    }
    if (parentPath && res.path === parentPath) {
      toast("A design cannot embed itself");
      return;
    }
    // Transitive check (FR-097a/FR-102a): refuse a child whose embed chain
    // leads back to this design, rather than letting Run discover the cycle.
    if (parentPath && (await wouldCycle(res.path, parentPath, apiLoad))) {
      toast("Cannot embed: that design (or one it embeds) embeds this design");
      return;
    }
    let obj;
    try {
      obj = await apiLoad(res.path);
    } catch (e) {
      toast("Load failed: " + e.message);
      return;
    }
    const iface = designInterface(obj);
    if (iface.length === 0) {
      toast("That design has no ports — nothing to embed");
      return;
    }
    const render = await chooseRenderDialog(iface, obj.defaultRender ?? "ic");
    if (!render) return;
    // Store the child's absolute path; it is relativized at save (FR-098).
    const childName = baseOf(res.path).replace(/\.json$/i, "");
    store.dispatch(placeSubDesign({ childPath: res.path, render, iface, childName }, x, y));
  }

  // newDesign starts a fresh empty design in the current project (FR-044),
  // warning about unsaved changes (FR-045/049a). The design belongs to the
  // project from creation (FR-121c); it is simply unsaved until FR-047.
  function newDesign() {
    if (noProject("New")) return;
    if (store.state.dirty && !window.confirm("Discard unsaved changes?")) return;
    store.replaceDesign(createDesign(defaultName()), { savePath: null });
    navStack.length = 0;
    notifyNav();
  }

  // clearNavStack starts a fresh navigation chain (§6.19): New/Open/Duplicate
  // Project replace the canvas outside the descend/back hierarchy.
  function clearNavStack() {
    navStack.length = 0;
    notifyNav();
  }

  return { save, open, newDesign, addSubDesign, descend, followTarget, back, loadIntoStore, clearNavStack };
}
