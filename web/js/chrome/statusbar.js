// Status bar (§6.11, FR-072..FR-074, FR-089). A bottom-docked flex row of
// trays: a state tray at the lower-left corner showing the program's operating
// state ("editing" until the simulator exists), a message tray filling the
// remaining width showing the most recent posted message, and a connection
// tray at the right end showing the server connection state (FR-089). Status
// text is transient UI, not design state, so it does not flow through the
// store or the undo stack.

let stateEl = null;
let messageEl = null;
let connEl = null;

// initStatusBar builds the trays inside `container` (#statusbar).
export function initStatusBar(container) {
  stateEl = document.createElement("div");
  stateEl.className = "status-tray";
  stateEl.id = "status-state";
  stateEl.textContent = "editing";

  messageEl = document.createElement("div");
  messageEl.className = "status-tray";
  messageEl.id = "status-message";

  connEl = document.createElement("div");
  connEl.className = "status-tray";
  connEl.id = "status-conn";
  connEl.textContent = "connected"; // the SPA was just served, so the server was up

  container.replaceChildren(stateEl, messageEl, connEl);
}

// setAppState shows the program's current operating state (FR-073).
export function setAppState(text) {
  if (stateEl) stateEl.textContent = text;
}

// postMessage shows a message; it persists until replaced or cleared (FR-074).
export function postMessage(text) {
  if (messageEl) messageEl.textContent = text;
}

// clearMessage empties the message tray (FR-074).
export function clearMessage() {
  if (messageEl) messageEl.textContent = "";
}

// setConnState shows the server connection state (FR-089), driven by the
// connection monitor (§6.12a).
export function setConnState(connected) {
  if (!connEl) return;
  connEl.textContent = connected ? "connected" : "disconnected";
  connEl.classList.toggle("disconnected", !connected);
}
