// File-operation orchestration (§6.11): New / Open / Save / Save As, tying the
// store, the persistence model, the REST client, and the file dialog together.

import { createDesign } from "../model/design.js";
import {
  serializeDesign,
  deserializeDesign,
  FORMAT_VERSION,
} from "../model/persist.js";
import { saveDesign as apiSave, loadDesign as apiLoad } from "../api.js";
import { openFileDialog } from "./dialogs.js";

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
      store.replaceDesign(deserializeDesign(obj), { savePath: res.path });
    } catch (e) {
      toast("Open failed: " + e.message);
    }
  }

  // newDesign starts a fresh empty design, warning about unsaved changes
  // (FR-044/045/049a).
  function newDesign() {
    if (store.state.dirty && !window.confirm("Discard unsaved changes?")) return;
    store.replaceDesign(createDesign(defaultName()), { savePath: null });
  }

  return { save, open, newDesign };
}
