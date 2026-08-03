// The docked panel area (§6.16a, FR-123, FR-115n). Owns the tab strip at the
// bottom of #canvas-area, which tab's content is displayed, and the single
// divider that splits the area from the schematic canvas above it. One module
// owns the whole region so that adding a tab kind (a DRC report, say) is a TABS
// entry plus a host element, not a new layout.
//
// The dock never calls the canvas: it changes flex-basis, and the ResizeObserver
// canvas.js already installs (§6.13) refits at the unchanged viewport, so
// FR-115n's "re-extend, not rescale" is inherited rather than re-implemented.
//
// The dock never reads mode state either — not isReadonly(), not simulating, not
// vectorHold — so the divider drags and tabs switch under all of them (FR-115n
// and FR-123 "always available"), and it writes nothing to the store but the tab
// selection: resizing and switching set no dirty flag, release no hold, and clear
// no results.
//
// Closing stays the PANEL's business. The test-vector panel's close is guarded
// (FR-115m) and may be cancelled, so the dock calls requestClose() and never
// touches an open flag itself; a cancelled close leaves the flag set and the next
// render redraws the identical strip.

// DOCK_MIN is the FR-115n floor: neither the schematic above the divider nor the
// panel area below it may be dragged below a tenth of the canvas area.
// DOCK_DEFAULT is the bottom third FR-115b/FR-122c open at, now an initial value
// rather than a fixed height.
export const DOCK_MIN = 0.1;
export const DOCK_DEFAULT = 1 / 3;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// layout returns the fraction of #canvas-area the panel area actually gets: zero
// when no tab is open (the region is absent entirely, FR-123), else the stored
// fraction clamped so both it and the canvas host (1 - f) keep their tenth. Total
// over ANY stored fraction — including a remembered 0.99 — so no caller has to
// pre-validate. With the default this is 1/3, exactly the pre-FR-115n layout.
export function layout(frac, anyOpen) {
  return anyOpen ? clamp(frac, DOCK_MIN, 1 - DOCK_MIN) : 0;
}

// dragTo is the FR-115n drag as pure arithmetic on fractions: given the
// remembered fraction, whether any tab is open, and the fraction the pointer asks
// for, return the new remembered fraction. The schematic absorbs the change —
// there is nothing else to trade with, tabs never stacking (FR-123).
//
// A drag with no tab open is the identity: there is no grip to grab, and putting
// the guard here means the rule lives in the geometry, not only in the DOM.
export function dragTo(frac, anyOpen, want) {
  return anyOpen ? clamp(want, DOCK_MIN, 1 - DOCK_MIN) : frac;
}

// --- DOM ---

// TABS names the tab kinds. It supplies each tab's label and host; the STRIP
// ORDER is store.state.dockOrder (the order opened, FR-123), not this order. A
// future tab kind adds a row here, a host element in index.html, and an open flag
// in the store — nothing else in this module special-cases a tab.
const TABS = [
  { key: "vec", label: "Test Vectors", id: "vec-panel", flag: "vectorPanelOpen" },
  { key: "console", label: "Console", id: "console-panel", flag: "consolePanelOpen" },
  { key: "drc", label: "Design Rules", id: "drc-panel", flag: "drcPanelOpen" },
];

const byKey = (key) => TABS.find((t) => t.key === key) ?? null;

// createDock wires the geometry and the strip to the page. Constructed once in
// app.js main() after the panels exist; `panels` maps a tab key to that panel's
// handle ({ open, requestClose }). Returns an inert handle when the expected
// elements are missing (headless/unit context), so bootstrap order cannot break
// the page.
export function createDock({ store, area = null, panels = {} } = {}) {
  const doc = typeof document === "undefined" ? null : document;
  const root = area ?? doc?.getElementById("canvas-area");
  const dockEl = doc?.getElementById("dock");
  const stripEl = dockEl?.querySelector(".dock-tabs") ?? null;
  const hosts = {};
  for (const t of TABS) hosts[t.key] = doc?.getElementById(t.id) ?? null;
  if (!doc || !root || !dockEl || !stripEl || TABS.some((t) => !hosts[t.key])) {
    return { menuInvoke() {}, destroy() {} };
  }

  // The fraction lives in module-instance state, not the store: a drag would
  // otherwise notify every subscriber (canvas, toolbar, properties, status bar)
  // up to 60 times a second for a change none of them can act on, and the store
  // is the design/command pipeline (§6.10), not a view-geometry cache. Nothing
  // persists it — no design file, no .tv, no localStorage — so a reload is back
  // to a third, which is FR-115n's session-only clause by construction. ONE
  // fraction, shared by every tab: switching tabs never resizes the area.
  let frac = DOCK_DEFAULT;

  root.style.position = "relative";

  // The grip is a child of #canvas-area, NOT of #dock: the panels call
  // host.replaceChildren() on every open and the strip is rebuilt on every
  // selection change, either of which would delete a grip parked inside.
  // Absolute positioning also keeps the flex arithmetic exact — a grip in the
  // flow would eat pixels the floors are computed without.
  const grip = doc.createElement("div");
  grip.className = "dock-grip";
  grip.setAttribute("role", "separator");
  grip.setAttribute("aria-orientation", "horizontal");
  grip.setAttribute("aria-label", "Resize panel area");
  grip.hidden = true;
  root.appendChild(grip);

  const isOpen = (key) => !!store.state[byKey(key)?.flag];
  const anyOpen = () => TABS.some((t) => !!store.state[t.flag]);

  // --- the menu rule (FR-123) ---

  // menuInvoke is Simulate ▸ Test Vectors and View ▸ Console in one function:
  // open a closed tab, select an open-but-background one, and close it only when
  // it is already frontmost. A background tab is therefore never closed by the
  // item that would bring it forward. The tab's ✕ calls step 3 directly.
  function menuInvoke(key) {
    const panel = panels[key];
    if (!byKey(key) || !panel) return; // unknown key: a no-op, never a throw
    if (!isOpen(key)) panel.open();
    else if (store.state.dockActive !== key) store.setDockActive(key);
    else panel.requestClose();
  }

  // --- the strip ---

  // The strip is rebuilt only when its SIGNATURE changes, so a store notification
  // from an unrelated command (every design edit notifies) does not churn its DOM
  // or steal focus from a ✕ the user is tabbing to.
  let stripSig = null;

  function signature() {
    const { dockOrder = [], dockActive = null, dockUnread = {} } = store.state;
    return `${dockOrder.join(",")}|${dockActive}|${dockOrder.filter((k) => dockUnread[k]).join(",")}`;
  }

  function renderStrip() {
    const sig = signature();
    if (sig === stripSig) return;
    stripSig = sig;
    const { dockOrder = [], dockActive = null, dockUnread = {} } = store.state;
    const tabs = [];
    for (const key of dockOrder) {
      const spec = byKey(key);
      if (!spec) continue; // a key with no tab kind: skip rather than throw
      const tab = doc.createElement("button");
      tab.type = "button";
      tab.className = "dock-tab";
      tab.id = `dock-tab-${key}`;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(dockActive === key));
      tab.setAttribute("aria-controls", spec.id);
      // Pointer selection only: FR-123 adds no keyboard shortcut and no
      // arrow-key cycling, the same restraint FR-115n takes toward resizing.
      tab.addEventListener("click", () => store.setDockActive(key));

      const label = doc.createElement("span");
      label.className = "dock-tab-label";
      label.textContent = spec.label; // the KIND, never the document (FR-123)
      tab.appendChild(label);

      if (dockUnread[key]) {
        const dot = doc.createElement("span");
        dot.className = "dock-tab-dot";
        dot.title = "New output";
        dot.setAttribute("aria-label", "unread output");
        tab.appendChild(dot);
      }

      const close = doc.createElement("button");
      close.type = "button";
      close.className = "dock-tab-close";
      close.textContent = "✕";
      close.title = `Close ${spec.label}`;
      close.setAttribute("aria-label", `Close ${spec.label}`);
      close.addEventListener("click", (e) => {
        // Closing is never also a select — otherwise closing a background tab
        // would bring it forward on the way out.
        e.stopPropagation();
        panels[key]?.requestClose();
      });
      tab.appendChild(close);
      tabs.push(tab);
    }
    stripEl.replaceChildren(...tabs);
    // aria-labelledby is set here rather than in the markup so a host is only
    // ever associated with a tab that actually exists.
    for (const t of TABS) {
      if (dockOrder.includes(t.key)) hosts[t.key].setAttribute("aria-labelledby", `dock-tab-${t.key}`);
      else hosts[t.key].removeAttribute("aria-labelledby");
    }
  }

  // apply writes the applied fraction as a flex-basis percentage. Percentages are
  // the point: they resolve against the canvas area's content height, so a
  // window, palette, properties, or status-bar resize rescales every region
  // proportionally with no listener and no JS at all — FR-115n's "a resize
  // preserves the proportion" holds by construction, and since the stored
  // fraction already satisfies the floors, so does the re-clamp. The grip's
  // `bottom` comes from the same number, so the handle tracks the area's top edge
  // with no measurement.
  function apply() {
    const open = anyOpen();
    const f = layout(frac, open);
    dockEl.hidden = !open; // no tab open ⇒ the whole region is absent (FR-123)
    dockEl.style.flexBasis = `${f * 100}%`;
    grip.hidden = !open;
    grip.style.bottom = `${f * 100}%`;
    // Exactly one host is shown: the frontmost tab's. A hidden host keeps its
    // DOM, so a background tab keeps its rows, results, selection, held run,
    // console text, and scroll position (FR-123) with no teardown path to get
    // wrong. A dockActive naming a closed tab (only reachable by a bug) simply
    // shows nothing.
    for (const t of TABS) hosts[t.key].hidden = store.state.dockActive !== t.key;
    renderStrip();
  }

  // --- the drag ---

  let pending = null; // the fraction the pointer last asked for, awaiting a frame
  let raf = 0;

  grip.addEventListener("pointerdown", (e) => {
    const height = root.clientHeight;
    if (!height) return; // opened before layout: nothing to divide
    e.preventDefault();
    try {
      grip.setPointerCapture(e.pointerId);
    } catch {
      // A capture the browser refuses is ignored; the drag then simply ends at
      // the next pointerup on the grip.
    }
    const startY = e.clientY;
    const startFrac = layout(frac, anyOpen());
    doc.body.classList.add("dock-dragging");

    const move = (ev) => {
      // Dragging UP grows the panel area.
      pending = startFrac + (startY - ev.clientY) / height;
      if (raf) return;
      // Coalesce into one layout change per frame, no matter how fast the
      // pointer reports: the canvas ResizeObserver then fires at most once per
      // frame, and resize() is idempotent, so a continuous drag costs one
      // backing-store resize plus one redraw per frame — a pan gesture's price.
      raf = requestAnimationFrame(() => {
        raf = 0;
        frac = dragTo(frac, anyOpen(), pending);
        apply();
      });
    };
    const end = () => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", end);
      grip.removeEventListener("pointercancel", end);
      doc.body.classList.remove("dock-dragging");
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      pending = null;
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", end);
    grip.addEventListener("pointercancel", end);
  });

  // Applying on EVERY store notification, not only when a flag changes, is
  // deliberate: it is a handful of style writes plus a signature comparison, and
  // it makes the layout self-healing after any DOM rebuild. subscribe and
  // setDockActive are the only store calls the dock makes.
  const unsubscribe = store.subscribe(apply);
  apply();

  return {
    menuInvoke,
    destroy() {
      unsubscribe?.();
      if (raf) cancelAnimationFrame(raf);
      grip.remove();
    },
  };
}
