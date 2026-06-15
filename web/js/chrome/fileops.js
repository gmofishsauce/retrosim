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

export function makeFileOps({ store, dataDir, defaultName }) {
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

  // open navigates to and loads a design (FR-052), warning about unsaved
  // changes first (FR-049a).
  async function open() {
    if (store.state.dirty && !window.confirm("Discard unsaved changes?")) return;
    const res = await openFileDialog({ mode: "open", startPath: dataDir });
    if (!res) return;
    try {
      const obj = await apiLoad(res.path);
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
      const baseDir = dirOf(res.path);
      await resolveSubDesigns(loaded, (childPath) => apiLoad(resolveRel(baseDir, childPath)), toast);
      store.replaceDesign(loaded, { savePath: res.path });
    } catch (e) {
      toast("Open failed: " + e.message);
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
  }

  return { save, open, newDesign, addSubDesign };
}
