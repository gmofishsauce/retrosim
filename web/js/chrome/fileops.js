// File-operation orchestration (§6.11): New / Open / Save / Save As, tying the
// store, the persistence model, the REST client, and the file dialog together.

import { createDesign } from "../model/design.js";
import {
  serializeDesign,
  deserializeDesign,
  FORMAT_VERSION,
} from "../model/persist.js";
import { designInterface, resolveSubDesigns } from "../model/subdesign.js";
import { placeSubDesign } from "../commands.js";
import { saveDesign as apiSave, loadDesign as apiLoad } from "../api.js";
import { openFileDialog, chooseRenderDialog } from "./dialogs.js";

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

// --- POSIX-style path helpers (the server uses forward slashes; the dev
// platform is macOS/Linux — Windows path handling is a follow-up). ---
const dirOf = (p) => p.replace(/\/[^/]*$/, "") || "/";
const baseOf = (p) => p.split(/[\\/]/).pop();

// relPath expresses an absolute target relative to a base directory, e.g.
// ("/a/designs", "/a/lib/c.json") → "../lib/c.json".
function relPath(fromDir, toPath) {
  const a = fromDir.replace(/\/+$/, "").split("/");
  const b = toPath.split("/");
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  const ups = a.slice(i).map(() => "..");
  return [...ups, ...b.slice(i)].join("/") || baseOf(toPath);
}

// resolveRel turns a child path stored relative to a base dir back into an
// absolute path, normalizing "." and "..".
function resolveRel(baseDir, rel) {
  const out = [];
  for (const seg of (baseDir + "/" + rel).split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return "/" + out.join("/");
}

export function makeFileOps({ store, dataDir, defaultName, onNavChange = () => {} }) {
  // navStack records the absolute paths of the sheets descended through, so the
  // user can step back up the chain (FR-100a). Session-only: not persisted, not
  // on the undo stack. A plain Open/New starts a fresh chain.
  const navStack = [];
  const notifyNav = () => onNavChange(navStack.length);
  // save writes the current design; prompts for a location on first save or
  // Save As (FR-046/047/048/049).
  async function save({ saveAs = false } = {}) {
    let path = store.state.savePath;
    if (saveAs || !path) {
      const suggested =
        store.state.savePath?.split("/").pop() ||
        sanitize(store.state.designName) + ".json";
      const res = await openFileDialog({
        mode: "save",
        startPath: dataDir,
        defaultName: suggested,
      });
      if (!res) return;
      path = res.path;
    }
    try {
      // The design adopts the chosen file's base name (FR-047a): override the
      // serialized name so the file matches, and update the store only after
      // the write succeeds.
      const name = path.split(/[\\/]/).pop().replace(/\.json$/i, "");
      await apiSave(path, { ...serializeDesign(store.design), name });
      store.markSaved(path, name);
    } catch (e) {
      toast("Save failed: " + e.message);
    }
  }

  // loadIntoStore loads the design at an absolute path and makes it the current
  // design, resolving its sub-designs' interfaces first (FR-098). Returns true on
  // success, false (with a toast) on failure. Shared by Open (FR-052) and
  // navigation (FR-100); it performs no unsaved-changes guard of its own.
  async function loadIntoStore(absPath) {
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
      // Resolve each sub-design's interface from its child file before the first
      // render (FR-098 loading): paths are stored relative to this design's dir.
      const baseDir = dirOf(absPath);
      await resolveSubDesigns(loaded, (childPath) => apiLoad(resolveRel(baseDir, childPath)), toast);
      store.replaceDesign(loaded, { savePath: absPath });
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
    const parentPath = store.state.savePath;
    if (!parentPath) return;
    const abs = resolveRel(dirOf(parentPath), childPath);
    if (await navigateTo(abs)) {
      navStack.push(parentPath);
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
  // canvas (FR-097/098, §6.14). The child path is stored relative to this
  // design's save dir, so the parent must be saved first (FR-097b).
  async function addSubDesign(x, y) {
    if (!store.state.savePath) {
      toast("Save this design before adding a sub-component");
      await save();
      if (!store.state.savePath) return; // save cancelled
    }
    const parentPath = store.state.savePath;
    const res = await openFileDialog({ mode: "open", startPath: dirOf(parentPath) });
    if (!res) return;
    if (res.path === parentPath) {
      toast("A design cannot embed itself");
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
    const childPath = relPath(dirOf(parentPath), res.path);
    const childName = baseOf(res.path).replace(/\.json$/i, "");
    store.dispatch(placeSubDesign({ childPath, render, iface, childName }, x, y));
  }

  // newDesign starts a fresh empty design, warning about unsaved changes
  // (FR-044/045/049a).
  function newDesign() {
    if (store.state.dirty && !window.confirm("Discard unsaved changes?")) return;
    store.replaceDesign(createDesign(defaultName()), { savePath: null });
    navStack.length = 0;
    notifyNav();
  }

  return { save, open, newDesign, addSubDesign, descend, back };
}
