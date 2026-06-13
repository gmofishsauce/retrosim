// Local backup of unsaved work (§6.12a, FR-092/FR-093): a debounced snapshot
// of the working design in localStorage while unsaved changes exist, removed
// when a save lands, and offered for recovery at the next startup. Covers the
// loss modes reconnection cannot: page reload, tab close, browser crash.
// localStorage failures (quota, privacy mode) disable the writer with one
// message — they never interrupt editing.

import { serializeDesign, deserializeDesign } from "./model/persist.js";
import { postMessage } from "./chrome/statusbar.js";

export const BACKUP_KEY = "retrosim.backup";
export const DEBOUNCE_MS = 1000;

// startBackup subscribes to the store and maintains the snapshot (FR-092):
// while dirty, a debounced write of {design, savePath, designName, time};
// when dirty clears (save landed, or a clean design replaced it), the key is
// removed immediately. One fixed key: a second concurrent tab last-writer-wins
// (single-user localhost tool). Returns {flush, stop}; deps injectable for
// tests.
export function startBackup(
  store,
  { storage = window.localStorage, debounceMs = DEBOUNCE_MS, post = postMessage } = {},
) {
  let timer = null;
  let disabled = false;

  function flush() {
    timer = null;
    if (disabled) return;
    try {
      if (store.state.dirty) {
        storage.setItem(
          BACKUP_KEY,
          JSON.stringify({
            design: serializeDesign(store.design),
            savePath: store.state.savePath,
            designName: store.state.designName,
            time: Date.now(),
          }),
        );
      } else {
        storage.removeItem(BACKUP_KEY);
      }
    } catch (e) {
      disabled = true;
      post("Local backup disabled: " + e.message);
    }
  }

  const unsubscribe = store.subscribe(() => {
    if (disabled) return;
    if (timer) clearTimeout(timer);
    if (!store.state.dirty) {
      timer = null;
      flush(); // a save landed: drop the snapshot now, not after a debounce
    } else {
      timer = setTimeout(flush, debounceMs);
    }
  });

  return {
    flush,
    stop: () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    },
  };
}

// offerRecovery runs once at startup, before the default empty design is
// presented (FR-093): if a snapshot exists, a confirm dialog offers it by
// name and timestamp. Accept restores the design with its name and save path
// and unsaved-changes status set; decline (or a corrupt snapshot) discards
// the key. Returns true when a design was recovered.
export function offerRecovery(
  store,
  {
    storage = window.localStorage,
    confirmFn = (msg) => window.confirm(msg),
    post = postMessage,
  } = {},
) {
  let raw;
  try {
    raw = storage.getItem(BACKUP_KEY);
  } catch {
    return false; // storage unavailable: nothing to offer
  }
  if (!raw) return false;
  let snap;
  try {
    snap = JSON.parse(raw);
  } catch {
    storage.removeItem(BACKUP_KEY); // corrupt: discard rather than re-offer forever
    return false;
  }
  const name = snap.designName ?? snap.design?.name ?? "unnamed design";
  const when = snap.time ? new Date(snap.time).toLocaleString() : "an unknown time";
  if (
    !confirmFn(
      `Recover unsaved work?\n\n"${name}" (backed up ${when}) was not saved ` +
        "before the last session ended. OK restores it; Cancel discards it.",
    )
  ) {
    storage.removeItem(BACKUP_KEY);
    return false;
  }
  try {
    const design = deserializeDesign(snap.design);
    store.replaceDesign(design, { savePath: snap.savePath ?? null, dirty: true });
    return true;
  } catch (e) {
    storage.removeItem(BACKUP_KEY);
    post("Backup recovery failed: " + e.message);
    return false;
  }
}
