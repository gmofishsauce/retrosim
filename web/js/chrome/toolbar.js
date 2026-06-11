// Toolbar: tool buttons and undo/redo (§6.11). Tool buttons set the active tool
// via the interaction FSM; the active tool is highlighted by subscribing to the
// store. File ops, zoom/pan land in later slices.

// WIRE_ICON is the wire cursor's glyph (a short lower-right→upper-left diagonal
// line, FR-025) reused as the Wire button's label.
const WIRE_ICON =
  '<svg width="18" height="18" viewBox="0 0 22 22" aria-hidden="true">' +
  '<line x1="5" y1="5" x2="17" y2="17" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>';

export function initToolbar({ container, store, interaction, fileops, sim }) {
  const tools = [
    { tool: "select", label: "Select" },
    { tool: "wire", icon: WIRE_ICON },
    { tool: "bus", label: "Bus" },
  ];

  const toolEls = {};
  for (const t of tools) {
    const b = document.createElement("button");
    b.className = "tool-btn";
    if (t.icon) {
      b.innerHTML = t.icon;
      b.setAttribute("aria-label", "Wire tool");
    } else {
      b.textContent = t.label;
    }
    b.title = `${t.label ?? "Wire"} tool`;
    b.addEventListener("click", () => interaction.setTool(t.tool));
    container.appendChild(b);
    toolEls[t.tool] = b;
  }

  const sep = document.createElement("span");
  sep.className = "tool-sep";
  container.appendChild(sep);

  container.append(
    button("−", "Zoom out", () => interaction.zoomBy(0.8)),
    button("+", "Zoom in", () => interaction.zoomBy(1.25)),
    Object.assign(document.createElement("span"), { className: "tool-sep" }),
  );

  const undoBtn = button("Undo", "Undo (Ctrl/Cmd+Z)", () => store.undo());
  const redoBtn = button("Redo", "Redo (Shift+Ctrl/Cmd+Z)", () => store.redo());
  container.append(undoBtn, redoBtn);

  container.appendChild(el("span", "tool-sep"));
  const newBtn = button("New", "New design", () => fileops.newDesign());
  const openBtn = button("Open", "Open design", () => fileops.open());
  container.append(
    newBtn,
    openBtn,
    button("Save", "Save design", () => fileops.save()),
    button("Save As", "Save under a new name", () => fileops.save({ saveAs: true })),
  );

  // Run/Stop toggles the slow simulator (FR-076); the label tracks
  // store.state.simulating via refresh().
  container.appendChild(el("span", "tool-sep"));
  const runBtn = button("Run", "Run the simulation", () => {
    if (sim.isRunning()) sim.stop();
    else sim.run();
  });
  container.appendChild(runBtn);

  function el(tag, className) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    return e;
  }

  function button(label, title, onClick) {
    const b = document.createElement("button");
    b.className = "tool-btn";
    b.textContent = label;
    b.title = title;
    b.addEventListener("click", onClick);
    return b;
  }

  function refresh() {
    const simming = store.state.simulating;
    for (const t of tools) {
      toolEls[t.tool].classList.toggle("active", store.state.tool === t.tool);
      // Wire/Bus arm design mutations; Select stays usable (FR-087).
      if (t.tool !== "select") toolEls[t.tool].disabled = simming;
    }
    undoBtn.disabled = simming || !store.canUndo();
    redoBtn.disabled = simming || !store.canRedo();
    newBtn.disabled = simming;
    openBtn.disabled = simming;
    runBtn.textContent = simming ? "Stop" : "Run";
    runBtn.title = simming ? "Stop the simulation" : "Run the simulation";
  }

  store.subscribe(refresh);
  refresh();
}
