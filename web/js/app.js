// Application bootstrap (§6.12). Creates the initial empty design and store,
// fetches the component library, builds the palette and canvas renderer, and
// only then removes the loading overlay so the canvas is not interactable until
// the library is ready (FR-003).

import { getComponents, getDefaults, createComponent, updateComponent, saveTextFile, fetchStaticText, loadDesign } from "./api.js";
import { flatten } from "./model/subdesign.js";
import {
  newGalPartDialog,
  galPartFromType,
  memDeviceDialog,
  memDeviceYaml,
  testVectorsPanel,
  openFileDialog,
  exportFormatDialog,
  designPropertiesDialog,
} from "./chrome/dialogs.js";
import { setPrimaryClockCmd, refreshTypesCmd } from "./commands.js";
import { generateC } from "./engine/cgen.js";
import { generateNDL } from "./engine/ndl.js";
import { BUILTINS, PIN_MARK_TOOL, memDeviceType } from "./builtins.js";
import { createDesign, typeIdentity } from "./model/design.js";
import { createStore } from "./store.js";
import { initCanvas } from "./engine/canvas.js";
import { initInteraction } from "./engine/interaction.js";
import { initToolbar } from "./chrome/toolbar.js";
import { makeFileOps } from "./chrome/fileops.js";
import { makeProjectOps } from "./chrome/project.js";
import { initProperties } from "./chrome/properties.js";
import { createConsolePanel } from "./chrome/console.js";
import { createDock } from "./chrome/dock.js";
import { createDrcPanel } from "./chrome/drcpanel.js";
import { openContextMenu } from "./chrome/contextmenu.js";
import { initStatusBar, postMessage } from "./chrome/statusbar.js";
import { createSim } from "./engine/sim.js";
import { startConnectionMonitor } from "./connection.js";
import { startBackup, offerRecovery } from "./backup.js";

// defaultDesignName builds "unnamed schematic <datetime>" from the local clock
// (FR-004, FR-045).
function defaultDesignName(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return `unnamed schematic ${date} ${time}`;
}

// isGal marks a GAL part (FR-066b): its display name is its part number (FR-005b).
const isGal = (type) => Boolean(type.partnumber);

// isMem marks a generator-defined memory device (FR-114c): a free-form display
// name like a GAL part (so it sorts into the trailing upper-region group), tagged
// by its `mem` spec block.
const isMem = (type) => Boolean(type.mem);

// displayName is a part's full, free-form external name shown on its tile and in
// its tooltip (FR-005/FR-005b): the part number for a GAL part, else the type
// name. It is divorced from the library id (typeIdentity).
const displayName = (type) => (isGal(type) ? type.partnumber : type.name);

// partTileText is the tile's visible label: the full display name, unabbreviated
// (FR-005). The CSS shrinks the font so a five-character name fits the tile.
const partTileText = (type) => displayName(type);

// partTileTip is the hover tooltip: the display name, then the description when
// present (FR-005a/FR-005b).
function partTileTip(type) {
  const head = displayName(type);
  return type.description ? `${head} — ${type.description}` : head;
}

// partOrder packs the upper region: 74-series ascending by their numeric part
// number, then GAL parts (FR-005b), each group then ordered by library id. The
// numeric key drops the "74" family prefix so the sort matches FR-006.
function partOrder(a, b) {
  // 74-series sort by their numeric part number; GAL parts and memory devices
  // (free-form names) fall after them (Infinity), then by library id.
  const sortNum = (t) => (isGal(t) || isMem(t) ? Infinity : Number(t.name.slice(2)));
  const an = sortNum(a);
  const bn = sortNum(b);
  if (an !== bn) return an - bn;
  const ai = typeIdentity(a), bi = typeIdentity(b);
  return ai < bi ? -1 : ai > bi ? 1 : 0;
}

// ADD_ICON: the lower-palette entry that opens the Add sub-component flow (§6.14).
const ADD_ICON =
  '<svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">' +
  '<rect x="4" y="4" width="28" height="28" rx="3" fill="#fff" stroke="#333" stroke-dasharray="3 2"/>' +
  '<line x1="18" y1="11" x2="18" y2="25" stroke="#333" stroke-width="2.5" stroke-linecap="round"/>' +
  '<line x1="11" y1="18" x2="25" y2="18" stroke="#333" stroke-width="2.5" stroke-linecap="round"/>' +
  "</svg>";

// toast surfaces a brief non-fatal message (duplicated in interaction/fileops;
// consolidation is an R5 cleanup for the refactor pass).
function toast(msg) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

// makeTile builds one draggable palette tile, recording it in `tiles` for the
// armed-state subscription. `content` is either {text} or {html} (an icon).
function makeTile(type, content, title, tiles) {
  const id =
    type.name === "add" || type.name === PIN_MARK_TOOL.id ? type.name : typeIdentity(type);
  const tile = document.createElement("div");
  tile.className = "palette-tile";
  if (content.html) tile.innerHTML = content.html;
  else tile.textContent = content.text;
  tile.title = title;
  tile.dataset.type = id; // library id; placement looks up by this (FR-066e)
  tile.draggable = true;
  tiles[id] = tile;
  return tile;
}

// renderPalette fills the two palette regions (FR-006a): loaded parts up top
// (74-series and authored GAL parts, FR-005b), built-in objects below, then wires
// the armed-tile highlight across both. Returns { addPart, replacePart, setParts }
// so an authored GAL part can be inserted or re-rendered live without a reload
// (FR-007a/FR-066f). `onTileMenu(type, x, y)` receives a part tile's right-click
// (FR-006b); it decides whether there is anything to offer.
function renderPalette({ partsEl, builtinsEl, components, builtins, store, onTileMenu }) {
  partsEl.replaceChildren();
  builtinsEl.replaceChildren();
  const tiles = {};

  // makePartTile is makeTile plus the upper region's context menu (FR-006b).
  // preventDefault always, so the browser menu never appears over the palette;
  // whether a menu opens is onTileMenu's call (no items ⇒ no menu). Right-click
  // never arms the tile — arming stays on click (FR-009).
  const makePartTile = (type) => {
    const tile = makeTile(type, { text: partTileText(type) }, partTileTip(type), tiles);
    tile.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      onTileMenu?.(type, e.clientX, e.clientY);
    });
    return tile;
  };

  // Upper-region parts kept sorted (FR-005b) so a live insert lands in order.
  const parts = [...components].sort(partOrder);
  for (const type of parts) partsEl.appendChild(makePartTile(type));
  // Action tile that opens the New GAL part dialog (FR-066c); not placeable, so
  // it is not draggable and not registered in `tiles`. Kept last so addPart's
  // index math (which addresses part tiles by position) stays valid.
  const newGalTile = document.createElement("div");
  newGalTile.className = "palette-tile galdlg-newtile";
  newGalTile.textContent = "NEW GAL";
  newGalTile.dataset.type = "newgal";
  newGalTile.title = "New GAL part (GAL22V10)";
  partsEl.appendChild(newGalTile);

  // Action tile that opens the New memory device dialog (FR-114); like the GAL
  // tile it is not placeable, so it is not draggable or registered in `tiles`,
  // and stays after the part tiles so addPart's index math holds.
  const newMemTile = document.createElement("div");
  newMemTile.className = "palette-tile galdlg-newtile";
  newMemTile.textContent = "NEW MEM";
  newMemTile.dataset.type = "mem";
  newMemTile.title = "New memory device (RAM/ROM)";
  partsEl.appendChild(newMemTile);

  // Built-ins: icon + descriptive tooltip per object (FR-067).
  for (const type of builtins) {
    builtinsEl.appendChild(makeTile(type, { html: type.icon }, type.title, tiles));
  }
  // The ADD entry embeds a saved design as a sub-design (§6.14, FR-097); it is
  // not a placeable component, so it carries the reserved type name "add".
  builtinsEl.appendChild(
    makeTile({ name: "add" }, { html: ADD_ICON }, "Add sub-component", tiles),
  );
  // The no-connect mark (FR-071i): it places no instance — it drops onto a pin of
  // a component already on the sheet — so it is not a built-in type (§6.22) and
  // carries its own reserved id. It is registered in `tiles` like a placeable one
  // so the armed highlight tracks it while the tool is active.
  builtinsEl.appendChild(
    makeTile({ name: PIN_MARK_TOOL.id }, { html: PIN_MARK_TOOL.icon }, PIN_MARK_TOOL.title, tiles),
  );

  // Reflect the armed click-to-place tile with a pressed-in look (FR-009a).
  store.subscribe((state) => {
    // The mark tool has no placeType — it is armed by its own tool state (FR-071i).
    const armed =
      state.tool === "place" ? state.placeType : state.tool === "markPin" ? PIN_MARK_TOOL.id : null;
    for (const [name, tile] of Object.entries(tiles)) {
      tile.classList.toggle("armed", name === armed);
    }
  });

  // addPart inserts a newly created part tile in sorted position (FR-007a); the
  // armed-state subscription above covers it since it shares the `tiles` map.
  function addPart(type) {
    const tile = makePartTile(type);
    let at = parts.findIndex((p) => partOrder(type, p) < 0);
    if (at < 0) at = parts.length;
    parts.splice(at, 0, type);
    partsEl.insertBefore(tile, partsEl.children[at] ?? null);
  }
  // replacePart re-renders one existing tile in place after its definition was
  // edited (FR-066f). The sort key is the immutable id (partOrder), so an edited
  // part never moves — only its label and tooltip can change, when the part
  // number or description was edited.
  function replacePart(type) {
    const id = typeIdentity(type);
    const at = parts.findIndex((p) => typeIdentity(p) === id);
    if (at < 0) return addPart(type);
    parts[at] = type;
    const tile = tiles[id];
    if (!tile) return;
    tile.textContent = partTileText(type);
    tile.title = partTileTip(type);
  }
  // setParts replaces the upper-region part tiles wholesale (FR-121i, §6.19): a
  // project switch discards the outgoing project's local parts and lays in the new
  // merged set. The NEW GAL / NEW MEM action tiles and the built-ins are untouched.
  function setParts(components) {
    for (const p of parts) {
      const id = typeIdentity(p);
      tiles[id]?.remove();
      delete tiles[id];
    }
    parts.length = 0;
    for (const type of [...components].sort(partOrder)) addPart(type);
  }
  return { addPart, replacePart, setParts };
}

async function main() {
  const overlay = document.getElementById("loading-overlay");

  // Open in select-tool mode with an empty, unsaved design (FR-004).
  const name = defaultDesignName();
  const design = createDesign(name);
  const store = createStore({
    design,
    designName: name,
    // A throwing command is contained by the store (§6.6/§6.10): surface it as
    // a non-fatal toast rather than killing the event handler mid-gesture.
    onError: (err) => toast("Operation failed: " + err.message),
    // Mutations refused while simulating go to the message tray (FR-087).
    onBlocked: (msg) => postMessage(msg),
  });

  // Keep the design-name label in sync, with an unsaved-changes marker (FR-049a).
  const nameEl = document.getElementById("design-name");
  store.subscribe(() => {
    nameEl.textContent = store.state.designName + (store.state.dirty ? " *" : "");
  });
  nameEl.textContent = name;

  // Current-project indicator (FR-121b): the project's display name, or
  // "(no project)" before one is current (FR-121c, §3.1 A8).
  const projectEl = document.getElementById("project-name");
  store.subscribe(() => {
    projectEl.textContent = store.state.project
      ? store.state.project.name
      : "(no project)";
  });
  document.getElementById("tool-mode").textContent = store.state.tool;

  // Warn before discarding unsaved changes on tab close (FR-049a, §6.10) —
  // the design's, and the test-vector panel's document (FR-115m). The panel is
  // constructed further down in main(), so the handler reads it through a
  // hoisted binding that is null until then.
  let vecPanel = null;
  window.addEventListener("beforeunload", (e) => {
    if (store.state.dirty || vecPanel?.isDirty()) e.preventDefault();
  });

  // Status bar (FR-072..FR-074); the state tray opens as "editing" (FR-073).
  initStatusBar(document.getElementById("statusbar"));

  const renderer = initCanvas(document.getElementById("canvas"), store);

  try {
    // Await the library (FR-003) and the server defaults before enabling the UI.
    // At startup no project is current (FR-121c), so this is the shared library
    // alone; the merged project-local library is (re)fetched by reloadLibrary when
    // a project becomes current (FR-121i, §6.19).
    const [{ components }, defaults] = await Promise.all([
      getComponents(),
      getDefaults().catch(() => ({ dataDir: "" })),
    ]);
    const palette = document.getElementById("palette");
    const paletteApi = renderPalette({
      partsEl: document.getElementById("palette-parts"),
      builtinsEl: document.getElementById("palette-builtins"),
      components,
      builtins: BUILTINS,
      store,
      // Right-click on a part tile (FR-006b). The one item today is offered for a
      // project-local GAL part alone: a shared-library part is not this project's
      // to change (FR-121i), a memory device has no editor yet, and a 74-series
      // part is library metadata, not authored here. Editing is a design edit in
      // the FR-087 sense, so it goes away while the simulator runs.
      onTileMenu: (type, x, y) => {
        if (!type.gal || !type.projectLocal || store.isReadonly()) return;
        openContextMenu(x, y, [
          { label: "Edit part definition…", onClick: () => onEditGalPart(type) },
        ]);
      },
    });
    // Built-ins are placeable too, so they must be findable by type identity.
    const library = [...components, ...BUILTINS];
    // addCreatedPart registers a newly authored GAL part (FR-007a): it joins the
    // placement library and gets a live palette tile, no reload (consumed by the
    // New GAL part dialog, §6.11).
    const addCreatedPart = (type) => {
      library.push(type);
      paletteApi.addPart(type);
    };
    // reloadLibrary refetches the merged shared ∪ project library for projectDir
    // and rebuilds the placement library + palette in place (FR-121i, §6.19): a
    // project switch discards the outgoing project's local parts, and Refresh Types
    // picks up externally-added/-edited project files. The `library` array keeps its
    // identity so interaction/toolbar (which hold the reference) see the new set.
    // Scan warnings post to the message tray (FR-074). Built-ins are always present.
    const reloadLibrary = async (projectDir) => {
      let components, warnings;
      try {
        ({ components, warnings } = await getComponents(projectDir));
      } catch (e) {
        postMessage(`Could not load component library: ${e.message}`);
        return;
      }
      library.length = 0;
      library.push(...components, ...BUILTINS);
      paletteApi.setParts(components);
      for (const w of warnings) postMessage("Component: " + w);
    };
    // Open the New GAL part dialog (FR-066c); on success register the part live.
    // The create writes into the current project's components/ (FR-007a/FR-121i).
    const onNewGalPart = async () => {
      const created = await newGalPartDialog({
        submit: (yaml) => createComponent(yaml, store.state.project?.dir),
      });
      if (created) {
        addCreatedPart(created);
        toast(`Added GAL part ${created.partnumber}`);
      }
    };
    // Open the Edit GAL part dialog on an existing project-local part (FR-066f):
    // the same dialog the create flow uses, populated by galPartFromType, saving
    // through the update endpoint (FR-007a). A definition the dialog cannot
    // reproduce exactly is refused here rather than opened and silently reduced.
    const onEditGalPart = async (type) => {
      const part = galPartFromType(type);
      if (part.refuse) {
        postMessage(
          `${type.partnumber || type.name}: cannot edit in the app — ${part.refuse}. ` +
            `Edit the YAML directly, then use File ▸ Refresh Types.`,
        );
        return;
      }
      const updated = await newGalPartDialog({
        part,
        submit: (yaml) => updateComponent(yaml, store.state.project?.dir),
      });
      if (!updated) return;
      // The edited definition replaces the loaded one (the id is immutable, so
      // this is an in-place swap), then the refresh carries it into the placed
      // instances of that type alone — one undo step, dropping and reporting any
      // connection to a pin the edit removed or renamed (FR-088).
      const id = typeIdentity(updated);
      const at = library.findIndex((t) => typeIdentity(t) === id);
      if (at >= 0) library[at] = updated;
      else library.push(updated);
      paletteApi.replacePart(updated);
      store.dispatch(refreshTypesCmd(library, postMessage, { typeId: id }));
      toast(`Updated GAL part ${updated.partnumber}`);
    };
    // Open the New memory device dialog (FR-114), persist the generated type to the
    // component library, and register it live — exactly like a new GAL part
    // (FR-114f/FR-007a). The built-in behavior binds from the round-tripped `mem`
    // block on reload (FR-114d), so a persisted device places and simulates.
    const onNewMemDevice = async () => {
      await memDeviceDialog({
        // The ROM-content / RAM save-file pickers seed at the project root
        // (FR-121h; read at invocation) but may navigate anywhere — data
        // files are exempt from the project boundary (FR-121d).
        startPath: store.state.project?.dir ?? defaults.dataDir,
        submit: async (spec) => {
          const type = memDeviceType(spec);
          // A built-in id collision is caught here: built-ins are not in the server
          // library, so the create endpoint cannot see them. Collisions with loaded
          // parts, GAL parts, or an earlier memory device are rejected by the
          // server's create (409). Either error surfaces inline (dialog stays open).
          if (BUILTINS.some((t) => typeIdentity(t) === type.id)) {
            throw new Error(`A component named "${type.name}" already exists.`);
          }
          const created = await createComponent(memDeviceYaml(type), store.state.project?.dir);
          addCreatedPart(created);
          toast(`Added memory device ${created.name}`);
          return created;
        },
      });
    };
    // fileops is built before interaction so the ADD tile can route through it.
    // Breadcrumb back control (FR-100a): shown only while the back-stack is
    // non-empty, i.e. after descending into a sub-design.
    const backBtn = document.getElementById("nav-back");
    const fileops = makeFileOps({
      store,
      dataDir: defaults.dataDir,
      defaultName: defaultDesignName,
      onNavChange: (depth) => {
        backBtn.hidden = depth === 0;
      },
      // FR-022a: frame the design after every load (interaction is created
      // just below, so the closure is safe — it only runs post-init).
      onLoaded: () => interaction.fitToScreen(),
      // The containing-folder rule (§3.1 A10): a loaded design's folder
      // becomes the current project (late-bound: projectops is built below
      // from this very fileops).
      setCurrentProject: (dir, info) => projectops.setCurrentProject(dir, info),
    });
    backBtn.addEventListener("click", () => fileops.back());
    // Project lifecycle ops (FR-121b, §6.19), wired to the File menu below.
    const projectops = makeProjectOps({
      store,
      dataDir: defaults.dataDir,
      fileops,
      // A project's initial design is named after the project (FR-121b);
      // the FR-004/FR-045 default covers the nameless case.
      freshDesign: (projName) => createDesign(projName ?? defaultDesignName()),
      // Reload the merged shared ∪ project library when the project changes
      // (FR-121i, §6.19): setCurrentProject calls this after recording the project.
      reloadLibrary,
    });
    const interaction = initInteraction({
      canvas: document.getElementById("canvas"),
      palette,
      store,
      renderer,
      library,
      fileops, // FR-004b: Open/Save/Save As keyboard accelerators
      onAddSubDesign: (x, y) => fileops.addSubDesign(x, y), // §6.14
      onOpenSubDesign: (childPath) => fileops.descend(childPath), // FR-100
      onFollowPortTarget: (target) => fileops.followTarget(target), // FR-101/FR-101b
      onNewGalPart, // FR-066c: upper-palette action tile
      onNewMemDevice, // FR-114: upper-palette action tile
    });
    // Heartbeat + reconnect (FR-089–FR-091, §6.12a): on recovery a dirty
    // design saves through the same path the toolbar Save uses.
    startConnectionMonitor({ store, save: fileops.save });
    // Offer recovery of unsaved work from a previous session (FR-093) before
    // the empty design is presented, then start the snapshot writer (FR-092)
    // — in that order, so a clean startup can't wipe the snapshot first.
    // An accepted recovery with a savePath also establishes its containing
    // folder as the current project (§6.12/§6.19); a pathless recovery sits
    // inert behind the dirty guard until a project is opened (FR-121c).
    if (offerRecovery(store) && store.state.savePath) {
      projectops.setCurrentProject(store.state.savePath.replace(/\/[^/]*$/, "") || "/");
    }
    startBackup(store);
    // Modeless Console panel (§6.20, FR-122c): the magic UART's standard-output
    // surface, and one tab of the docked area (FR-123). createSim routes each
    // UART's emitted byte to it and clears it at Run start. Its visibility is the
    // dock's — bytes accumulate whether its tab is frontmost, behind another, or
    // closed, and a byte arriving while it is not frontmost raises the tab's
    // unread dot.
    const consolePanel = createConsolePanel({ store });
    const sim = createSim({ store, renderer, consolePanel }); // slow simulator (§6.13)
    // The test-vector panel (FR-115b/§6.16), the other tab of the docked area;
    // opening it imposes the read-only lock (FR-115h), which holds while its tab
    // is open whether or not that tab is frontmost.
    vecPanel = testVectorsPanel({ store, dataDir: defaults.dataDir });
    // The design-rule-check report (FR-124g/§6.21), the third tab. Modeless like
    // the Console — it imposes no lock, the whole point being that the design
    // stays editable while its findings are on screen. It takes `interaction` for
    // one call: revealing the objects a clicked finding names (FR-124f).
    const drcPanel = createDrcPanel({ store, interaction });
    // The docked panel area (§6.16a, FR-123/FR-115n): the tab strip, which tab is
    // displayed, the shared height, and its draggable top edge. Constructed once,
    // after the three panels exist, since it drives them through their handles —
    // open() and the guarded requestClose(), so a cancelled close (FR-115m)
    // leaves the strip untouched. Neither panel module knows about tabs, and the
    // canvas learns about a resize through the ResizeObserver it already has,
    // not through a call.
    const dock = createDock({
      store,
      panels: { vec: vecPanel, console: consolePanel, drc: drcPanel },
    });
    // Both menu items open a closed tab, select a backgrounded one, and close
    // only a frontmost one (FR-123). Both halves are async for the vector panel
    // (FR-115m): open auto-loads the design's `.tv` sibling, close may prompt to
    // save it first.
    const onTestVectors = () => dock.menuInvoke("vec");
    const onConsole = () => dock.menuInvoke("console");
    // Tools ▸ Design Rule Check (FR-124/§6.21) is NOT a panel toggle and so does
    // NOT go through dock.menuInvoke: it runs the check, which opens the report
    // tab or selects it if it is backgrounded, and never closes it (FR-124g) —
    // a menu item that ran a check and then hid its own results would be
    // indefensible. The tab's ✕ closes it, like any other.
    const onDesignRuleCheck = () => drcPanel.run();
    // Tools ▸ Generate C… (FR-116/§6.17): emit the standalone C simulator —
    // the generated <design>.c plus verbatim copies of the fixed runtime pair —
    // into a user-chosen directory. Generation is read-only; refusals and
    // generator warnings post to the message tray (FR-074).
    const dirOf = (p) => p.replace(/\/[^/]*$/, "") || "/";
    const baseName = (p) => p.slice(p.lastIndexOf("/") + 1);
    const onGenerateC = async () => {
      let out;
      try {
        // Flatten sub-designs/peer sheets first (FR-116 hierarchy, §6.14);
        // columns still derive from the top sheet (columnsFrom).
        const flat = await flatten(store.design, loadDesign, {
          rootPath: store.state.savePath,
        });
        out = generateC(flat, { columnsFrom: store.design });
      } catch (e) {
        postMessage(`cannot generate: ${e.message}`);
        return;
      }
      const sp = store.state.savePath;
      const res = await openFileDialog({
        mode: "save",
        // Seeded at the project root (FR-121h): the same directory the former
        // dirOf(savePath) default produced, defined even for an unsaved design.
        startPath: store.state.project?.dir ?? (sp ? dirOf(sp) : defaults.dataDir),
        defaultName: (sp ? baseName(sp).replace(/\.[^.]*$/, "") : "design") + ".c",
        title: "Generate C simulator (.c)",
        exts: ["c"],
        saveExt: "c",
      });
      if (!res) return;
      try {
        const dir = dirOf(res.path);
        const [h, c] = await Promise.all([
          fetchStaticText("/cgen/runtime.h"),
          fetchStaticText("/cgen/runtime.c"),
        ]);
        await saveTextFile(res.path, out.code);
        await saveTextFile(`${dir}/runtime.h`, h);
        await saveTextFile(`${dir}/runtime.c`, c);
        for (const w of out.warnings) postMessage(w);
        postMessage(
          `generated ${baseName(res.path)} + runtime.c/runtime.h — compile: cc ${baseName(res.path)} runtime.c`,
        );
      } catch (e) {
        postMessage(`cannot generate: ${e.message}`);
      }
    };
    // File ▸ Export… (FR-119/§6.18): write the design to a foreign netlist
    // format. Format dialog (NDL only for now) → flatten (like Generate C) →
    // generate → save-mode file dialog → verbatim write. Read-only; refusals
    // and generator warnings post to the message tray (FR-074).
    const onExport = async () => {
      const format = await exportFormatDialog();
      if (!format) return;
      let out;
      try {
        const flat = await flatten(store.design, loadDesign, {
          rootPath: store.state.savePath,
        });
        // format.id is "ndl" — the only backend so far (FR-119a); a new
        // format adds an EXPORT_FORMATS entry and a case here.
        out = generateNDL(flat, { name: store.state.designName });
      } catch (e) {
        postMessage(`cannot export: ${e.message}`);
        return;
      }
      const sp = store.state.savePath;
      const res = await openFileDialog({
        mode: "save",
        // Seeded at the project root (FR-121h), like Generate C….
        startPath: store.state.project?.dir ?? (sp ? dirOf(sp) : defaults.dataDir),
        defaultName:
          (sp ? baseName(sp).replace(/\.[^.]*$/, "") : "design") + "." + format.ext,
        title: `Export ${format.label}`,
        exts: [format.ext],
        saveExt: format.ext,
      });
      if (!res) return;
      try {
        await saveTextFile(res.path, out.text);
        for (const w of out.warnings) postMessage(w);
        postMessage(`exported ${baseName(res.path)}`);
      } catch (e) {
        postMessage(`cannot export: ${e.message}`);
      }
    };
    // Edit ▸ Design Properties… (FR-076b): the primary-clock selector. OK with
    // a changed value dispatches SetPrimaryClock (undoable, FR-024).
    const onDesignProperties = async () => {
      const refdes = await designPropertiesDialog(store.design);
      if (refdes && refdes !== store.design.primaryClock) {
        store.dispatch(setPrimaryClockCmd(refdes));
      }
    };
    initToolbar({
      container: document.getElementById("tools"),
      store,
      interaction,
      fileops,
      projectops, // FR-121b: File ▸ New/Open/Duplicate Project
      sim,
      library, // for the Refresh Types action (FR-088)
      reloadLibrary, // Refresh Types rescans the project's components/ first (FR-121i)
      onTestVectors, // FR-115: Tools ▸ Test Vectors… (open/select/close, FR-123)
      onConsole, // FR-122c: View ▸ Console (open/select/close, FR-123)
      onReleaseHold: () => vecPanel.releaseHold(), // FR-115l: Stop releases a held vector run
      onGenerateC, // FR-116: Tools ▸ Generate C…
      onDesignRuleCheck, // FR-124: Tools ▸ Design Rule Check (runs; never closes)
      onExport, // FR-119: File ▸ Export…
      onDesignProperties, // FR-076b: Edit ▸ Design Properties…
    });
    // renderer: the probe sheet refreshes its values on canvas repaints (FR-087c).
    initProperties({ container: document.getElementById("properties"), store, renderer });
    overlay.classList.add("hidden");
  } catch (err) {
    overlay.classList.add("error");
    overlay.textContent =
      `Cannot reach server — is retrosim running? (${err.message})`;
  }
}

main();
