// Docked, modeless Console panel — the slow (debug) simulator's standard-output
// surface for the magic UART (§6.20, FR-122c). Structurally like the docked
// test-vector panel (§6.16) but modeless: it never contributes to the store's
// read-only lock (contrast FR-115h) and coexists with a running simulation,
// since it is a pure output view. A running UART's byte stream arrives through
// write(byte); the panel renders each byte legibly and appends it to a scrolling
// monospace region that sticks to the tail unless the user has scrolled up.
//
// The text-model logic (byte rendering, buffered/coalesced append, head-trim at
// the retained-history cap, and the sticky-tail decision) is factored into pure,
// DOM-free helpers so it is unit-testable (console.test.js); createConsolePanel
// is the thin DOM + requestAnimationFrame glue over the model.

// CONSOLE_MAX_CHARS bounds the retained history (FR-122c) so a long run cannot
// grow the view without bound; when exceeded the head is trimmed.
export const CONSOLE_MAX_CHARS = 200000;

// TRUNCATION_MARKER heads the retained text after a head-trim (FR-122c).
export const TRUNCATION_MARKER = "…output truncated…\n";

// renderByte maps one emitted byte (0..255) to its console rendering (FR-122c):
// printable ASCII (0x20–0x7E) verbatim, LF as a newline, TAB as a tab, CR
// ignored (empty), and every other byte (other control codes and 0x7F–0xFF) as
// the visible escape \xNN. Total over 0..255.
export function renderByte(b) {
  if (b === 0x0d) return ""; // CR ignored
  if (b === 0x0a) return "\n"; // LF → newline
  if (b === 0x09) return "\t"; // TAB → tab
  if (b >= 0x20 && b <= 0x7e) return String.fromCharCode(b);
  return "\\x" + b.toString(16).padStart(2, "0"); // \xNN
}

// shouldStickTail reports whether a scroll container is at (or within epsilon
// of) its bottom, i.e. whether a repaint should re-pin the view to the tail
// (FR-122c sticky-tail). Pure over a {scrollTop, clientHeight, scrollHeight}
// shape, so it takes either a real element or a test double.
export function shouldStickTail(el, epsilon = 2) {
  return el.scrollTop + el.clientHeight >= el.scrollHeight - epsilon;
}

// createConsoleModel is the pure text model behind the panel: bytes push into a
// pending buffer (coalescing many writes into one committed flush), flush
// commits the buffer to the visible text with a head-trim at `max`, and clear
// empties both. No DOM, no timing — the panel schedules flush() from rAF.
export function createConsoleModel({ max = CONSOLE_MAX_CHARS } = {}) {
  let text = ""; // committed text (mirrors the DOM body)
  let pending = ""; // rendered bytes buffered since the last flush
  let dirty = false; // a flush is needed (bytes buffered)

  return {
    // push appends one byte's rendering to the pending buffer (FR-122c). Many
    // pushes accumulate for a single later flush — the coalescing that keeps the
    // engine free of backpressure (no overrun).
    push(byte) {
      pending += renderByte(byte);
      dirty = true;
    },
    isDirty: () => dirty,
    // flush commits the pending buffer into the visible text, head-trimming to
    // `max` with the truncation marker when the cap is exceeded, then clears the
    // dirty flag. Returns the new full text (what the DOM body shows).
    flush() {
      text += pending;
      pending = "";
      if (text.length > max) {
        text = TRUNCATION_MARKER + text.slice(text.length - max + TRUNCATION_MARKER.length);
      }
      dirty = false;
      return text;
    },
    text: () => text,
    clear() {
      text = "";
      pending = "";
      dirty = false;
    },
  };
}

// createConsolePanel wires the model to the docked #console-panel DOM (FR-122c):
// write buffers a byte and schedules a single rAF repaint that flushes to the
// body (coalescing many bytes/frame into one update), sticky-tail autoscroll,
// Clear + close controls. Returns { write, clear, setOpen, isOpen }. Modeless:
// it never touches the store's read-only lock; app.js subscribes setOpen to
// store.state.consolePanelOpen.
export function createConsolePanel({ store }) {
  const host = document.getElementById("console-panel");
  const body = host.querySelector(".console-body");
  const model = createConsoleModel();
  let raf = null;

  function repaint() {
    raf = null;
    const stick = shouldStickTail(body);
    body.textContent = model.flush();
    if (stick) body.scrollTop = body.scrollHeight; // re-pin to the tail
  }
  function schedule() {
    if (raf === null) raf = requestAnimationFrame(repaint);
  }

  const api = {
    // write appends one emitted byte (FR-122b sink) and schedules a repaint.
    write(byte) {
      model.push(byte);
      schedule();
    },
    // clear empties the buffer and the DOM (Clear button and Run-start, FR-122c).
    clear() {
      model.clear();
      if (raf !== null) {
        cancelAnimationFrame(raf);
        raf = null;
      }
      body.textContent = "";
    },
    // setOpen shows/hides the docked panel; driven by consolePanelOpen (app.js).
    setOpen(open) {
      host.hidden = !open;
    },
    isOpen: () => !host.hidden,
  };

  host.querySelector(".console-clear").addEventListener("click", () => api.clear());
  host
    .querySelector(".console-close")
    .addEventListener("click", () => store.setConsolePanelOpen(false));

  return api;
}
