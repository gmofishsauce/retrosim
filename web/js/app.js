// Application bootstrap (§6.12). Creates the initial empty design and store,
// fetches the component library, builds the palette and canvas renderer, and
// only then removes the loading overlay so the canvas is not interactable until
// the library is ready (FR-003).

import { getComponents, getDefaults } from "./api.js";
import { BUILTINS } from "./builtins.js";
import { createDesign } from "./model/design.js";
import { createStore } from "./store.js";
import { initCanvas } from "./engine/canvas.js";
import { initInteraction } from "./engine/interaction.js";
import { initToolbar } from "./chrome/toolbar.js";
import { makeFileOps } from "./chrome/fileops.js";
import { initProperties } from "./chrome/properties.js";
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

// label drops the leading "74" family prefix, leaving a 2-3 digit label (FR-005).
const paletteLabel = (name) => name.slice(2);

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
  const tile = document.createElement("div");
  tile.className = "palette-tile";
  if (content.html) tile.innerHTML = content.html;
  else tile.textContent = content.text;
  tile.title = title;
  tile.dataset.type = type.name; // full name; placement uses this (FR-005)
  tile.draggable = true;
  tiles[type.name] = tile;
  return tile;
}

// renderPalette fills the two palette regions (FR-006a): 74-series parts up top,
// built-in objects below, then wires the armed-tile highlight across both.
function renderPalette({ partsEl, builtinsEl, components, builtins, store }) {
  partsEl.replaceChildren();
  builtinsEl.replaceChildren();
  const tiles = {};

  // Parts: ascending by abbreviated part number, packed left→right top→bottom.
  const sorted = [...components].sort(
    (a, b) => Number(paletteLabel(a.name)) - Number(paletteLabel(b.name)),
  );
  for (const type of sorted) {
    partsEl.appendChild(
      makeTile(type, { text: paletteLabel(type.name) }, type.name, tiles),
    );
  }

  // Built-ins: icon + descriptive tooltip per object (FR-067).
  for (const type of builtins) {
    builtinsEl.appendChild(makeTile(type, { html: type.icon }, type.title, tiles));
  }

  // Reflect the armed click-to-place tile with a pressed-in look (FR-009a).
  store.subscribe((state) => {
    const armed = state.tool === "place" ? state.placeType : null;
    for (const [name, tile] of Object.entries(tiles)) {
      tile.classList.toggle("armed", name === armed);
    }
  });
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
  document.getElementById("tool-mode").textContent = store.state.tool;

  // Warn before discarding unsaved changes on tab close (FR-049a, §6.10).
  window.addEventListener("beforeunload", (e) => {
    if (store.state.dirty) e.preventDefault();
  });

  // Status bar (FR-072..FR-074); the state tray opens as "editing" (FR-073).
  initStatusBar(document.getElementById("statusbar"));

  const renderer = initCanvas(document.getElementById("canvas"), store);

  try {
    // Await the library (FR-003) and the server defaults before enabling the UI.
    const [components, defaults] = await Promise.all([
      getComponents(),
      getDefaults().catch(() => ({ dataDir: "" })),
    ]);
    const palette = document.getElementById("palette");
    renderPalette({
      partsEl: document.getElementById("palette-parts"),
      builtinsEl: document.getElementById("palette-builtins"),
      components,
      builtins: BUILTINS,
      store,
    });
    // Built-ins are placeable too, so they must be findable by type name.
    const library = [...components, ...BUILTINS];
    const interaction = initInteraction({
      canvas: document.getElementById("canvas"),
      palette,
      store,
      renderer,
      library,
    });
    const fileops = makeFileOps({
      store,
      dataDir: defaults.dataDir,
      defaultName: defaultDesignName,
    });
    // Heartbeat + reconnect (FR-089–FR-091, §6.12a): on recovery a dirty
    // design saves through the same path the toolbar Save uses.
    startConnectionMonitor({ store, save: fileops.save });
    // Offer recovery of unsaved work from a previous session (FR-093) before
    // the empty design is presented, then start the snapshot writer (FR-092)
    // — in that order, so a clean startup can't wipe the snapshot first.
    offerRecovery(store);
    startBackup(store);
    const sim = createSim({ store, renderer }); // slow simulator (§6.13)
    initToolbar({
      container: document.getElementById("tools"),
      store,
      interaction,
      fileops,
      sim,
      library, // for the Refresh Types action (FR-088)
    });
    initProperties({ container: document.getElementById("properties"), store });
    overlay.classList.add("hidden");
  } catch (err) {
    overlay.classList.add("error");
    overlay.textContent =
      `Cannot reach server — is retrosim running? (${err.message})`;
  }
}

main();
