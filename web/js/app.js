// Application bootstrap (§6.12). Creates the initial empty design and store,
// fetches the component library, builds the palette and canvas renderer, and
// only then removes the loading overlay so the canvas is not interactable until
// the library is ready (FR-003).

import { getComponents, getDefaults, createComponent } from "./api.js";
import { newGalPartDialog } from "./chrome/dialogs.js";
import { BUILTINS } from "./builtins.js";
import { createDesign, typeIdentity } from "./model/design.js";
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

// isGal marks a GAL part (FR-066b): its display name is its part number (FR-005b).
const isGal = (type) => Boolean(type.partnumber);

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
  const an = isGal(a) ? Infinity : Number(a.name.slice(2));
  const bn = isGal(b) ? Infinity : Number(b.name.slice(2));
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
  const id = type.name === "add" ? "add" : typeIdentity(type);
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
// the armed-tile highlight across both. Returns { addPart } so a newly authored
// GAL part can be inserted live without re-rendering (FR-007a).
function renderPalette({ partsEl, builtinsEl, components, builtins, store }) {
  partsEl.replaceChildren();
  builtinsEl.replaceChildren();
  const tiles = {};

  // Upper-region parts kept sorted (FR-005b) so a live insert lands in order.
  const parts = [...components].sort(partOrder);
  for (const type of parts) {
    partsEl.appendChild(
      makeTile(type, { text: partTileText(type) }, partTileTip(type), tiles),
    );
  }
  // Action tile that opens the New GAL part dialog (FR-066c); not placeable, so
  // it is not draggable and not registered in `tiles`. Kept last so addPart's
  // index math (which addresses part tiles by position) stays valid.
  const newGalTile = document.createElement("div");
  newGalTile.className = "palette-tile galdlg-newtile";
  newGalTile.textContent = "+ GAL";
  newGalTile.dataset.type = "newgal";
  newGalTile.title = "New GAL part (GAL22V10)";
  partsEl.appendChild(newGalTile);

  // Built-ins: icon + descriptive tooltip per object (FR-067).
  for (const type of builtins) {
    builtinsEl.appendChild(makeTile(type, { html: type.icon }, type.title, tiles));
  }
  // The ADD entry embeds a saved design as a sub-design (§6.14, FR-097); it is
  // not a placeable component, so it carries the reserved type name "add".
  builtinsEl.appendChild(
    makeTile({ name: "add" }, { html: ADD_ICON }, "Add sub-component", tiles),
  );

  // Reflect the armed click-to-place tile with a pressed-in look (FR-009a).
  store.subscribe((state) => {
    const armed = state.tool === "place" ? state.placeType : null;
    for (const [name, tile] of Object.entries(tiles)) {
      tile.classList.toggle("armed", name === armed);
    }
  });

  // addPart inserts a newly created part tile in sorted position (FR-007a); the
  // armed-state subscription above covers it since it shares the `tiles` map.
  function addPart(type) {
    const tile = makeTile(type, { text: partTileText(type) }, partTileTip(type), tiles);
    let at = parts.findIndex((p) => partOrder(type, p) < 0);
    if (at < 0) at = parts.length;
    parts.splice(at, 0, type);
    partsEl.insertBefore(tile, partsEl.children[at] ?? null);
  }
  return { addPart };
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
    const paletteApi = renderPalette({
      partsEl: document.getElementById("palette-parts"),
      builtinsEl: document.getElementById("palette-builtins"),
      components,
      builtins: BUILTINS,
      store,
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
    // Open the New GAL part dialog (FR-066c); on success register the part live.
    const onNewGalPart = async () => {
      const created = await newGalPartDialog({ submit: createComponent });
      if (created) {
        addCreatedPart(created);
        toast(`Added GAL part ${created.partnumber}`);
      }
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
    });
    backBtn.addEventListener("click", () => fileops.back());
    const interaction = initInteraction({
      canvas: document.getElementById("canvas"),
      palette,
      store,
      renderer,
      library,
      onAddSubDesign: (x, y) => fileops.addSubDesign(x, y), // §6.14
      onOpenSubDesign: (childPath) => fileops.descend(childPath), // FR-100
      onNewGalPart, // FR-066c: upper-palette action tile
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
