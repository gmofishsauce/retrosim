// Menu/tool bar (§6.11, FR-004a): File/Edit/View pull-down menus on the left,
// then the modal tool buttons (Select/Wire/Bus) and Run/Stop on the right. Tool
// buttons set the active tool via the interaction FSM; the active tool is
// highlighted by subscribing to the store. One menu is open at a time; an
// outside click or Escape closes it.

import { refreshTypesCmd } from "../commands.js";
import { postMessage } from "./statusbar.js";

// WIRE_ICON is the wire cursor's glyph (a centered diagonal line with an open
// dot at the active point, FR-025) reused as the Wire button's label.
const WIRE_ICON =
  '<svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">' +
  '<g stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none">' +
  '<line x1="3" y1="3" x2="7.4" y2="7.4"/>' +
  '<line x1="12.6" y1="12.6" x2="17" y2="17"/>' +
  '<circle cx="10" cy="10" r="2.2" stroke-width="1.5"/></g></svg>';

// Keyboard-accelerator hint formatting (FR-004b). The modifier is always
// Cmd (mac) / Ctrl (elsewhere); accelLabel renders the platform-appropriate text
// for a descriptor {key, shift?}.
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
function accelLabel({ key, shift }) {
  return IS_MAC
    ? `${shift ? "⇧" : ""}⌘${key}`
    : `Ctrl+${shift ? "Shift+" : ""}${key}`;
}

export function initToolbar({ container, store, interaction, fileops, projectops, sim, library, reloadLibrary = async () => {}, onTestVectors, onGenerateC, onExport }) {
  const tools = [
    { tool: "select", label: "Select" },
    { tool: "wire", icon: WIRE_ICON },
    { tool: "bus", label: "Bus" },
  ];

  // Open menus, tracked so closeMenus() (FR-004a) can dismiss them. Declared
  // before createMenu is first called below.
  const menus = [];

  // --- Menus on the left: File, Edit, View (FR-004a) ---

  const fileMenu = createMenu("File");
  // Project lifecycle (FR-121b, §6.19): the project items sit above the
  // design items. Disabled while a simulation runs or under the test-vector
  // lock, like New/Open; Duplicate additionally needs a current project.
  const newProjectItem = addItem(fileMenu.panel, "New Project…",
    "Create a new project folder", () => projectops?.newProject());
  const openProjectItem = addItem(fileMenu.panel, "Open Project…",
    "Open a project by folder, manifest, or design file", () => projectops?.openProject());
  const dupProjectItem = addItem(fileMenu.panel, "Duplicate Project…",
    "Copy the current project to a new folder", () => projectops?.duplicateProject());
  const newItem = addItem(fileMenu.panel, "New", "New design", () =>
    fileops.newDesign());
  const openItem = addItem(fileMenu.panel, "Open", "Open design", () =>
    fileops.open(), { key: "O" });
  const saveItem = addItem(fileMenu.panel, "Save", "Save design", () =>
    fileops.save(), { key: "S" });
  const saveAsItem = addItem(fileMenu.panel, "Save As", "Save under a new name", () =>
    fileops.save({ saveAs: true }), { key: "S", shift: true });
  // Export… writes the design to a foreign netlist format (FR-119).
  const exportItem = addItem(
    fileMenu.panel,
    "Export…",
    "Export the design to a netlist format (NDL)",
    () => onExport?.(),
  );
  // Refresh Types re-copies type data from the loaded library into placed
  // instances (FR-088). It first rescans the current project's components/ for
  // externally-added/-edited project-local types (FR-121i) — reloadLibrary
  // refreshes the shared `library` array in place — then dispatches the refresh.
  const refreshItem = addItem(
    fileMenu.panel,
    "Refresh Types",
    "Re-copy type data from the loaded library into placed components",
    async () => {
      await reloadLibrary(store.state.project?.dir);
      store.dispatch(refreshTypesCmd(library, postMessage));
    },
  );
  container.appendChild(fileMenu.menu);

  // Copy/Paste etc. will land in the Edit menu later.
  const editMenu = createMenu("Edit");
  const undoItem = addItem(editMenu.panel, "Undo", "Undo (Ctrl/Cmd+Z)", () =>
    store.undo(), { key: "Z" });
  const redoItem = addItem(editMenu.panel, "Redo", "Redo (Shift+Ctrl/Cmd+Z)", () =>
    store.redo(), { key: "Z", shift: true });
  const copyItem = addItem(editMenu.panel, "Copy", "Copy selection (Ctrl/Cmd+C)", () =>
    interaction.copySelection(), { key: "C" });
  const pasteItem = addItem(editMenu.panel, "Paste", "Paste (Ctrl/Cmd+V)", () =>
    interaction.startPaste(), { key: "V" });
  container.appendChild(editMenu.menu);

  // Zoom stays enabled while simulating (FR-087).
  const viewMenu = createMenu("View");
  addItem(viewMenu.panel, "Zoom In", "Zoom in", () => interaction.zoomBy(1.25), { key: "+" });
  addItem(viewMenu.panel, "Zoom Out", "Zoom out", () => interaction.zoomBy(0.8), { key: "-" });
  addItem(viewMenu.panel, "Fit to Screen", "Fit the design to the canvas", () =>
    interaction.fitToScreen(),
  );
  container.appendChild(viewMenu.menu);

  // Simulate menu: the test-vector table editor (FR-115). Disabled while the
  // interactive simulator is running (FR-087/FR-115b).
  const simMenu = createMenu("Simulate");
  const vectorsItem = addItem(
    simMenu.panel,
    "Test Vectors…",
    "Author and run combinational test vectors",
    () => onTestVectors?.(),
  );
  // Generate C… emits the standalone C simulator (FR-116/§6.17).
  const generateItem = addItem(
    simMenu.panel,
    "Generate C…",
    "Generate a standalone C simulator for this design",
    () => onGenerateC?.(),
  );
  container.appendChild(simMenu.menu);

  container.appendChild(el("span", "tool-sep"));

  // --- Buttons on the right: Select, Wire, Bus, then Run (FR-004a) ---

  // Modal tools: the active one is highlighted (refresh); the Wire button
  // shows the wire-cursor icon instead of a label (FR-025).
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

  container.appendChild(el("span", "tool-sep"));

  // Run/Stop toggles the slow simulator (FR-076); the label tracks
  // store.state.simulating via refresh().
  const runBtn = button("Run", "Run the simulation", () => {
    if (sim.isRunning()) sim.stop();
    else sim.run();
  });
  container.appendChild(runBtn);

  // Menu widget (FR-004a). createMenu builds a .menu (trigger + drop panel);
  // addItem appends a clickable item. Only one menu is open at a time; an
  // outside click or Escape closes any open menu.
  function createMenu(label) {
    const menu = el("div", "menu");
    const trigger = document.createElement("button");
    trigger.className = "menu-trigger";
    trigger.type = "button";
    trigger.textContent = label;
    const panel = el("div", "menu-panel");
    panel.hidden = true;
    menu.append(trigger, panel);
    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      const wasOpen = !panel.hidden;
      closeMenus();
      if (!wasOpen) {
        // Re-evaluate item enablement at open time: Paste tracks the clipboard,
        // which is not store state and so does not drive the store subscription.
        refresh();
        panel.hidden = false;
        menu.classList.add("open");
      }
    });
    const entry = { menu, panel, trigger };
    menus.push(entry);
    return entry;
  }

  // addItem appends a clickable menu row: a label on the left and, when `accel`
  // is given, its keyboard-accelerator hint right-aligned (FR-004b).
  function addItem(panel, label, title, onClick, accel) {
    const b = document.createElement("button");
    b.className = "menu-item";
    b.type = "button";
    b.title = title;
    b.appendChild(el("span", "menu-item-label")).textContent = label;
    if (accel) b.appendChild(el("span", "menu-accel")).textContent = accelLabel(accel);
    b.addEventListener("click", () => {
      closeMenus();
      onClick();
    });
    panel.appendChild(b);
    return b;
  }

  function closeMenus() {
    for (const m of menus) {
      m.panel.hidden = true;
      m.menu.classList.remove("open");
    }
  }

  document.addEventListener("click", closeMenus);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenus();
  });

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
    const panelOpen = store.state.vectorPanelOpen;
    const locked = store.isReadonly(); // simming || panelOpen (FR-087/FR-115h)
    // No-project state (FR-121c, §6.11): while no project is current the
    // design is the inert FR-004 placeholder — everything is disabled except
    // New Project…, Open Project…, Open, Select, and the View items.
    const noProject = !store.state.project;
    for (const t of tools) {
      toolEls[t.tool].classList.toggle("active", store.state.tool === t.tool);
      // Wire/Bus arm design mutations; Select stays usable (FR-087/FR-115h).
      if (t.tool !== "select") toolEls[t.tool].disabled = locked || noProject;
    }
    undoItem.disabled = locked || noProject || !store.canUndo();
    redoItem.disabled = locked || noProject || !store.canRedo();
    // Copy is read-only (allowed under either lock, FR-111); enabled when a
    // component is selected. Paste mutates: needs a clipboard and no lock.
    copyItem.disabled =
      noProject || !store.state.selection.some((r) => r.kind === "component");
    pasteItem.disabled = locked || noProject || !interaction.hasClipboard();
    newItem.disabled = locked || noProject;
    openItem.disabled = locked; // live with no project: it establishes one (FR-121b)
    refreshItem.disabled = locked || noProject;
    saveItem.disabled = noProject; // otherwise live even while simulating (FR-087)
    saveAsItem.disabled = noProject;
    // The project items are disabled while a simulation runs and under the
    // test-vector lock, like New/Open (FR-121b); Duplicate also needs a
    // current project (nothing to duplicate).
    newProjectItem.disabled = locked;
    openProjectItem.disabled = locked;
    dupProjectItem.disabled = locked || noProject;
    // The Test Vectors item toggles the panel, so it stays enabled while the
    // panel is open (to close it); only a running simulation disables it
    // (FR-115b).
    vectorsItem.disabled = simming || noProject;
    // Generate C… is disabled under either lock (FR-116): while simulating
    // and while the vector panel is open. Export… follows the same rule
    // (FR-119).
    generateItem.disabled = locked || noProject;
    exportItem.disabled = locked || noProject;
    // Run and the panel are mutually exclusive (FR-115h): Run is disabled while
    // the panel is open. Stop stays usable while simulating.
    runBtn.disabled = panelOpen || noProject;
    runBtn.textContent = simming ? "Stop" : "Run";
    runBtn.title = simming ? "Stop the simulation" : "Run the simulation";
  }

  store.subscribe(refresh);
  refresh();
}
