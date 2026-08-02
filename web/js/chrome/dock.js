// Docked-panel layout and dividers (§6.16a, FR-115n). Owns the vertical split of
// #canvas-area between the schematic canvas and the docked bottom panels, and
// makes each open panel's top edge a drag handle. The rule is written once, here,
// for BOTH panels — the console's divider trades area with the test-vector panel
// above it, so neither panel module could own it without reaching into the other.
//
// The dock never calls the canvas: it changes flex-basis, and the ResizeObserver
// canvas.js already installs (§6.13) refits at the unchanged viewport, so
// FR-115n's "re-extend, not rescale" is inherited rather than re-implemented.
//
// The dock never reads mode state either — not isReadonly(), not simulating, not
// vectorHold — so a divider drags under all of them (FR-115n "always available"),
// and it writes nothing to the store: resizing sets no dirty flag, releases no
// hold, and clears no results.

// DOCK_MIN is the FR-115n floor: no region — schematic, test-vector panel, or
// console — may be dragged below a tenth of the canvas area. DOCK_DEFAULT is the
// bottom third FR-115b/FR-122c open at, now an initial value rather than a fixed
// height.
export const DOCK_MIN = 0.1;
export const DOCK_DEFAULT = 1 / 3;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// layout returns the fractions actually applied, zero for a closed panel. It is
// total over ANY stored fractions — including two remembered 0.8s — so no caller
// has to pre-validate: the invariant vec >= MIN, console >= MIN, and canvas host
// = 1 - vec - console >= MIN holds for every input. With both panels open the vec
// panel (the top-most, whose divider bounds the schematic) is clamped first, so
// when two large fractions collide it is the bottom-most output view that yields.
// With the defaults this is the identity — 1/3, 1/3, and a 1/3 canvas, exactly
// the pre-FR-115n layout, so only dragging is new.
export function layout(frac, open) {
  const vecOpen = !!open.vec;
  const conOpen = !!open.console;
  if (!vecOpen && !conOpen) return { vec: 0, console: 0 };
  if (vecOpen && !conOpen) return { vec: clamp(frac.vec, DOCK_MIN, 1 - DOCK_MIN), console: 0 };
  if (!vecOpen && conOpen) return { vec: 0, console: clamp(frac.console, DOCK_MIN, 1 - DOCK_MIN) };
  const vec = clamp(frac.vec, DOCK_MIN, 1 - 2 * DOCK_MIN);
  return { vec, console: clamp(frac.console, DOCK_MIN, 1 - DOCK_MIN - vec) };
}

// dragTo is the FR-115n trade rule as pure arithmetic on fractions: given the
// remembered fractions, which panels are open, which divider moved, and the
// fraction the pointer asks for, return the new remembered fractions.
//
//   vec      — the console is held fixed and the SCHEMATIC absorbs the change.
//   console  — with the vec panel open, the SUM vec+console is held fixed, so the
//              schematic does not move and the vec panel yields; both remembered
//              fractions change, the user having just resized both panels.
//              With the vec panel closed it trades with the schematic instead.
//
// A drag on a closed panel's key is the identity: there is no divider to grab, and
// putting the guard here means "never resizes a panel that is not open" is
// enforced by the geometry rather than only by the DOM.
export function dragTo(frac, open, key, want) {
  if (!open[key]) return { ...frac };
  const applied = layout(frac, open);
  if (key === "vec") {
    return { ...frac, vec: clamp(want, DOCK_MIN, 1 - DOCK_MIN - applied.console) };
  }
  if (!open.vec) return { ...frac, console: clamp(want, DOCK_MIN, 1 - DOCK_MIN) };
  const total = applied.vec + applied.console;
  const con = clamp(want, DOCK_MIN, total - DOCK_MIN);
  return { ...frac, console: con, vec: total - con };
}

// --- DOM ---

const PANELS = [
  { key: "vec", id: "vec-panel", flag: "vectorPanelOpen", label: "Resize the test-vector panel" },
  { key: "console", id: "console-panel", flag: "consolePanelOpen", label: "Resize the console panel" },
];

// createDock wires the geometry above to the page. Constructed once in app.js
// main() after the panels exist. Returns an inert handle when the expected
// elements are missing (headless/unit context), so bootstrap order cannot break
// the page.
export function createDock({ store, area = null, panels = null } = {}) {
  const doc = typeof document === "undefined" ? null : document;
  const root = area ?? doc?.getElementById("canvas-area");
  const el = {};
  for (const p of PANELS) el[p.key] = panels?.[p.key] ?? doc?.getElementById(p.id);
  // A missing element — or no DOM at all — yields an inert handle rather than a
  // throw, so app.js bootstrap order cannot break the page.
  if (!doc || !root || PANELS.some((p) => !el[p.key])) return { destroy() {} };

  // The fractions live in module-instance state, not the store: a drag would
  // otherwise notify every subscriber (canvas, toolbar, properties, status bar)
  // up to 60 times a second for a change none of them can act on, and the store
  // is the design/command pipeline (§6.10), not a view-geometry cache. Nothing
  // persists them — no design file, no .tv, no localStorage — so a reload is back
  // to thirds, which is FR-115n's session-only clause by construction.
  let frac = { vec: DOCK_DEFAULT, console: DOCK_DEFAULT };

  root.style.position = "relative";

  // The grips are children of #canvas-area, NOT of the panels:
  // testVectorsPanel.build() calls host.replaceChildren() on every open, which
  // would delete a grip parked inside #vec-panel. Absolute positioning also keeps
  // the flex arithmetic exact (a grip in the flow would eat pixels the floors are
  // computed without) and lets one CSS rule serve both.
  const grips = {};
  for (const p of PANELS) {
    const g = document.createElement("div");
    g.className = "dock-grip";
    g.setAttribute("role", "separator");
    g.setAttribute("aria-orientation", "horizontal");
    g.setAttribute("aria-label", p.label);
    g.hidden = true;
    root.appendChild(g);
    grips[p.key] = g;
  }

  const openState = () => ({
    vec: !!store.state.vectorPanelOpen,
    console: !!store.state.consolePanelOpen,
  });

  // apply writes the applied fractions as flex-basis percentages. Percentages are
  // the point: they resolve against the canvas area's content height, so a window,
  // palette, properties, or status-bar resize rescales every region proportionally
  // with no listener and no JS at all — FR-115n's "a resize preserves the
  // proportion" holds by construction, and since the stored fractions already
  // satisfy the floors, so does the re-clamp. Each grip's `bottom` comes from the
  // same numbers, so a handle tracks its panel with no measurement.
  //
  // A grip sits on its panel's TOP edge — the boundary with whatever is above it
  // (FR-115n). `bottom` is measured from the bottom of #canvas-area, so that edge
  // is the total fraction of everything BELOW the divider: the panel's own
  // fraction plus any panel stacked beneath it. The vec panel sits above the
  // console, so its grip is at fv + fc; the console's is at fc.
  function apply() {
    const open = openState();
    const f = layout(frac, open);
    el.vec.style.flexBasis = `${f.vec * 100}%`;
    el.console.style.flexBasis = `${f.console * 100}%`;
    grips.vec.hidden = !open.vec;
    grips.console.hidden = !open.console;
    grips.vec.style.bottom = `${(f.vec + f.console) * 100}%`;
    grips.console.style.bottom = `${f.console * 100}%`;
  }

  let pending = null; // the fraction the pointer last asked for, awaiting a frame
  let raf = 0;

  for (const p of PANELS) {
    const grip = grips[p.key];
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
      const startFrac = layout(frac, openState())[p.key];
      document.body.classList.add("dock-dragging");

      const move = (ev) => {
        // Dragging UP grows the panel below the divider.
        pending = startFrac + (startY - ev.clientY) / height;
        if (raf) return;
        // Coalesce into one layout change per frame, no matter how fast the
        // pointer reports: the canvas ResizeObserver then fires at most once per
        // frame, and resize() is idempotent, so a continuous drag costs one
        // backing-store resize plus one redraw per frame — a pan gesture's price.
        raf = requestAnimationFrame(() => {
          raf = 0;
          frac = dragTo(frac, openState(), p.key, pending);
          apply();
        });
      };
      const end = () => {
        grip.removeEventListener("pointermove", move);
        grip.removeEventListener("pointerup", end);
        grip.removeEventListener("pointercancel", end);
        document.body.classList.remove("dock-dragging");
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        pending = null;
      };
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", end);
      grip.addEventListener("pointercancel", end);
    });
  }

  // Applying on EVERY store notification, not only when a flag changes, is
  // deliberate: it is a handful of style writes, and it makes the layout
  // self-healing after any DOM rebuild. subscribe is the only store call the dock
  // makes.
  const unsubscribe = store.subscribe(apply);
  apply();

  return {
    destroy() {
      unsubscribe?.();
      if (raf) cancelAnimationFrame(raf);
      for (const p of PANELS) grips[p.key].remove();
    },
  };
}
