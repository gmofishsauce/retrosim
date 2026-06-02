// Toolbar: tool buttons and undo/redo (§6.11). Tool buttons set the active tool
// via the interaction FSM; the active tool is highlighted by subscribing to the
// store. File ops, zoom/pan land in later slices.

export function initToolbar({ container, store, interaction }) {
  const tools = [
    { tool: "select", label: "Select" },
    { tool: "wire", label: "Wire" },
    { tool: "bus", label: "Bus" },
  ];

  const toolEls = {};
  for (const t of tools) {
    const b = document.createElement("button");
    b.className = "tool-btn";
    b.textContent = t.label;
    b.title = `${t.label} tool`;
    b.addEventListener("click", () => interaction.setTool(t.tool));
    container.appendChild(b);
    toolEls[t.tool] = b;
  }

  const sep = document.createElement("span");
  sep.className = "tool-sep";
  container.appendChild(sep);

  const undoBtn = button("Undo", "Undo (Ctrl/Cmd+Z)", () => store.undo());
  const redoBtn = button("Redo", "Redo (Shift+Ctrl/Cmd+Z)", () => store.redo());
  container.append(undoBtn, redoBtn);

  function button(label, title, onClick) {
    const b = document.createElement("button");
    b.className = "tool-btn";
    b.textContent = label;
    b.title = title;
    b.addEventListener("click", onClick);
    return b;
  }

  function refresh() {
    for (const t of tools) {
      toolEls[t.tool].classList.toggle("active", store.state.tool === t.tool);
    }
    undoBtn.disabled = !store.canUndo();
    redoBtn.disabled = !store.canRedo();
  }

  store.subscribe(refresh);
  refresh();
}
