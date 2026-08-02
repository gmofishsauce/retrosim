// Menu/tool bar (§6.11, FR-004a): File/Edit/View pull-down menus on the left,
// then the modal tool buttons (Select/Wire/Bus) and Run/Stop on the right —
// plus the pause/step cluster while a sequential run is active (FR-076a). Tool
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

// Pause/step cluster glyphs (FR-076a): the conventional debugger set — pause
// is two vertical bars, continue a right-pointing triangle, step-cycle an
// arrow arcing over a dot (the "step over" idiom), step-unit an arrow dropping
// onto a dot (the "step into" idiom, for the smallest possible step).
const PAUSE_ICON =
  '<svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" fill="currentColor">' +
  '<rect x="4.5" y="4" width="4" height="12" rx="1"/>' +
  '<rect x="11.5" y="4" width="4" height="12" rx="1"/></svg>';

const CONTINUE_ICON =
  '<svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" fill="currentColor">' +
  '<path d="M6 4 L16 10 L6 16 Z"/></svg>';

const STEP_CYCLE_ICON =
  '<svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">' +
  '<path d="M4 12 A 6 6 0 0 1 16 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
  '<path d="M13.6 10.2 L18.8 10.2 L16.2 15 Z" fill="currentColor"/>' +
  '<circle cx="9" cy="16" r="2" fill="currentColor"/></svg>';

const STEP_UNIT_ICON =
  '<svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">' +
  '<line x1="10" y1="3" x2="10" y2="9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
  '<path d="M6.8 9 L13.2 9 L10 13.5 Z" fill="currentColor"/>' +
  '<circle cx="10" cy="16.5" r="2" fill="currentColor"/></svg>';

// Keyboard-accelerator hint formatting (FR-004b). The modifier is always
// Cmd (mac) / Ctrl (elsewhere); accelLabel renders the platform-appropriate text
// for a descriptor {key, shift?}.
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
function accelLabel({ key, shift }) {
  return IS_MAC
    ? `${shift ? "⇧" : ""}⌘${key}`
    : `Ctrl+${shift ? "Shift+" : ""}${key}`;
}

export function initToolbar({ container, store, interaction, fileops, projectops, sim, library, reloadLibrary = async () => {}, onTestVectors, onConsole, onGenerateC, onExport, onDesignProperties, onReleaseHold = () => {} }) {
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
  // Design Properties… edits design-level properties — the primary clock
  // (FR-076b). Design-modifying, so disabled under either lock, like New.
  const designPropsItem = addItem(
    editMenu.panel,
    "Design Properties…",
    "Edit design-level properties (primary clock)",
    () => onDesignProperties?.(),
  );
  container.appendChild(editMenu.menu);

  // Zoom stays enabled while simulating (FR-087).
  const viewMenu = createMenu("View");
  addItem(viewMenu.panel, "Zoom In", "Zoom in", () => interaction.zoomBy(1.25), { key: "+" });
  addItem(viewMenu.panel, "Zoom Out", "Zoom out", () => interaction.zoomBy(0.8), { key: "-" });
  addItem(viewMenu.panel, "Fit to Screen", "Fit the design to the canvas", () =>
    interaction.fitToScreen(),
  );
  // View ▸ Console (FR-122c): NOT a plain toggle. It opens the Console tab if
  // closed, selects it if open behind another tab, and closes it only when it is
  // already frontmost (FR-123) — the rule lives in dock.menuInvoke, reached
  // through the onConsole callback, so the toolbar depends on no panel or dock
  // module. The Console imposes no edit lock, so the item stays enabled while
  // simulating (it is meant to be opened during a run); refresh() renders it
  // checked while its tab is open.
  const consoleItem = addItem(viewMenu.panel, "Console", "Show the simulator console output", () =>
    onConsole?.(),
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
  // store.state.simulating via refresh(). While a test-vector run is HELD
  // (FR-115l) the same button is the Stop that releases the hold — there is no
  // interactive simulation to stop in that state, so it never reaches sim.
  const runBtn = button("Run", "Run the simulation", () => {
    if (store.state.vectorHold) onReleaseHold();
    else if (sim.isRunning()) sim.stop();
    else sim.run();
  });
  container.appendChild(runBtn);

  // Probe (FR-087c): shown only while the schematic carries live values — a
  // running simulation or a held vector run. It supplants Select rather than
  // being a fourth persistent tool, so it just sets the tool and back again.
  const probeBtn = button("Probe", "Probe: click a point to read its logic state", () => {
    interaction.setTool(store.state.tool === "probe" ? "select" : "probe");
  });

  // Pause/step cluster (FR-076a): shown only while a run of a sequential
  // design is active; the step buttons work only while paused. Pause state is
  // engine-local (not store state), so the toggle handler refreshes the bar
  // itself — every other transition (start, stop) already flows through the
  // store subscription.
  const pauseBtn = iconButton(PAUSE_ICON, "Pause the simulation", () => {
    if (sim.isPaused()) sim.resume();
    else sim.pause();
    refresh();
  });
  const stepCycleBtn = iconButton(STEP_CYCLE_ICON, "Step one clock cycle", () =>
    sim.stepCycle());
  const stepUnitBtn = iconButton(STEP_UNIT_ICON, "Step one unit (1 ns)", () =>
    sim.stepUnit());
  container.append(pauseBtn, stepCycleBtn, stepUnitBtn, probeBtn);

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

  // iconButton is button() with an inline-SVG glyph and a matching aria-label
  // (the WIRE_ICON pattern, FR-025/FR-076a).
  function iconButton(icon, title, onClick) {
    const b = document.createElement("button");
    b.className = "tool-btn";
    b.innerHTML = icon;
    b.title = title;
    b.setAttribute("aria-label", title);
    b.addEventListener("click", onClick);
    return b;
  }

  function refresh() {
    const simming = store.state.simulating;
    const panelOpen = store.state.vectorPanelOpen;
    // `locked` is the simulation lock alone (FR-087). The test-vector panel used
    // to OR into it (FR-115h); since 2026-08-02 it does not, so every disable
    // below that reads `locked` is live again while the panel is open.
    const locked = store.isReadonly();
    // No-project state (FR-121c, §6.11): while no project is current the
    // design is the inert FR-004 placeholder — everything is disabled except
    // New Project…, Open Project…, Open, Select, and the View items.
    const noProject = !store.state.project;
    for (const t of tools) {
      toolEls[t.tool].classList.toggle("active", store.state.tool === t.tool);
      // Wire/Bus arm design mutations; Select stays usable (FR-087).
      if (t.tool !== "select") toolEls[t.tool].disabled = locked || noProject;
    }
    undoItem.disabled = locked || noProject || !store.canUndo();
    redoItem.disabled = locked || noProject || !store.canRedo();
    // Copy is read-only (allowed under either lock, FR-111); enabled when a
    // component is selected. Paste mutates: needs a clipboard and no lock.
    copyItem.disabled =
      noProject || !store.state.selection.some((r) => r.kind === "component");
    pasteItem.disabled = locked || noProject || !interaction.hasClipboard();
    designPropsItem.disabled = locked || noProject; // FR-076b
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
    // The Test Vectors item opens, selects, or closes its tab (FR-123), so it
    // stays enabled while the panel is open — one invocation to bring the tab
    // forward, another to close it; only a running simulation disables it
    // (FR-115b). Checked while its tab is open, frontmost or not.
    vectorsItem.disabled = simming || noProject;
    vectorsItem.classList.toggle("checked", panelOpen);
    // Generate C… is disabled while simulating (FR-116); Export… follows the
    // same rule (FR-119). An open test-vector panel no longer disables either
    // (FR-115h).
    generateItem.disabled = locked || noProject;
    exportItem.disabled = locked || noProject;
    // Run/Stop (FR-076/FR-115h). An open test-vector panel no longer disables
    // Run — that blanket disable existed only because the panel locked the
    // design, and the lock is gone (2026-08-02). What survives is the narrower
    // mutual exclusion: while a vector run is HELD (FR-115l) the button is the
    // Stop that RELEASES the hold, never a start, so a vector run and a live run
    // still cannot overlap. Stop stays usable while simulating.
    // Console is modeless output (FR-122c): always enabled, checked when open.
    consoleItem.classList.toggle("checked", store.state.consolePanelOpen);
    const holding = store.state.vectorHold;
    runBtn.disabled = noProject;
    runBtn.textContent = simming || holding ? "Stop" : "Run";
    runBtn.title = holding
      ? "Release the held test-vector state"
      : simming
        ? "Stop the simulation"
        : "Run the simulation";
    // Pause/step cluster (FR-076a): visible only during a sequential run; the
    // step buttons are enabled only while paused; the toggle swaps glyphs.
    const seqRun = simming && sim.isSequentialRun();
    const pausedNow = seqRun && sim.isPaused();
    pauseBtn.hidden = stepCycleBtn.hidden = stepUnitBtn.hidden = !seqRun;
    pauseBtn.innerHTML = pausedNow ? CONTINUE_ICON : PAUSE_ICON;
    const pauseTitle = pausedNow ? "Continue the simulation" : "Pause the simulation";
    pauseBtn.title = pauseTitle;
    pauseBtn.setAttribute("aria-label", pauseTitle);
    stepCycleBtn.disabled = stepUnitBtn.disabled = !pausedNow;
    // Probe (FR-087c): present exactly while the schematic carries live values.
    // This is also where the toolbar learns a run ended, so it drops probe mode
    // back to Select there — the FR's "reverts when the run stops or the hold is
    // released". The setTool re-enters refresh() once, with tool now "select".
    const liveValues = simming || holding;
    probeBtn.hidden = !liveValues;
    probeBtn.classList.toggle("active", store.state.tool === "probe");
    if (!liveValues && store.state.tool === "probe") interaction.setTool("select");
  }

  store.subscribe(refresh);
  refresh();
}
