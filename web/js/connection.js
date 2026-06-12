// Server connection monitor (§6.12a, FR-089–FR-091). The design's single
// source of truth is the browser store and the server is stateless — every
// save transmits the complete design — so recovering from a server death
// needs no session transfer: detect the new instance at the same origin
// (NFR-002), then save. Heartbeat failures are the signal, never errors.

import { ping } from "./api.js";
import { setConnState, postMessage } from "./chrome/statusbar.js";

export const HEARTBEAT_MS = 3000; // ~3 s polling (FR-089)

const LOST_MSG =
  "Server connection lost — your work is retained in this tab. " +
  "Do NOT reload the page; restart the server at the same address and port.";

// startConnectionMonitor polls the server every intervalMs and reports state
// transitions: on loss, the connection tray flips to disconnected and the
// message tray posts the do-not-reload instructions (FR-090); on recovery it
// flips back and, if the design has unsaved changes, invokes `save` — the
// fileops action that writes to the known savePath or opens the Save dialog
// (FR-091). Deps are injectable for tests; a beat is skipped while the
// previous ping is still in flight. Returns {beat, stop}.
export function startConnectionMonitor(
  { store, save },
  {
    pingFn = ping,
    setConn = setConnState,
    post = postMessage,
    intervalMs = HEARTBEAT_MS,
    schedule = (fn, ms) => setInterval(fn, ms),
  } = {},
) {
  let connected = true; // the SPA was just served, so the server was up
  let inFlight = false;

  async function beat() {
    if (inFlight) return; // never overlap heartbeats
    inFlight = true;
    let ok;
    try {
      await pingFn();
      ok = true;
    } catch {
      ok = false;
    }
    inFlight = false;
    if (ok === connected) return; // steady state: report transitions only
    connected = ok;
    setConn(connected);
    if (!connected) {
      post(LOST_MSG);
    } else {
      post("Server reconnected.");
      if (store.state.dirty) save(); // FR-091; save handles its own errors
    }
  }

  const timer = schedule(beat, intervalMs);
  return { beat, stop: () => clearInterval(timer) };
}
