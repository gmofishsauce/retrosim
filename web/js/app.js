// Application bootstrap (§6.12). Creates the initial empty design and store,
// fetches the component library, builds the palette and canvas renderer, and
// only then removes the loading overlay so the canvas is not interactable until
// the library is ready (FR-003).

import { getComponents, getDefaults } from "./api.js";
import { createDesign } from "./model/design.js";
import { createStore } from "./store.js";
import { initCanvas } from "./engine/canvas.js";
import { initInteraction } from "./engine/interaction.js";
import { initToolbar } from "./chrome/toolbar.js";
import { makeFileOps } from "./chrome/fileops.js";
import { initProperties } from "./chrome/properties.js";

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

function renderPalette(paletteEl, components, store) {
  paletteEl.replaceChildren();
  const tiles = {};
  // Ascending by abbreviated part number, packed left→right top→bottom (FR-006).
  const sorted = [...components].sort(
    (a, b) => Number(paletteLabel(a.name)) - Number(paletteLabel(b.name)),
  );
  for (const type of sorted) {
    const tile = document.createElement("div");
    tile.className = "palette-tile";
    tile.textContent = paletteLabel(type.name); // FR-005: abbreviated label
    tile.title = type.name; // full name in tooltip (FR-005)
    tile.dataset.type = type.name;
    tile.draggable = true;
    paletteEl.appendChild(tile);
    tiles[type.name] = tile;
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
  const store = createStore({ design, designName: name });

  // Keep the design-name label in sync, with an unsaved-changes marker (FR-049a).
  const nameEl = document.getElementById("design-name");
  store.subscribe(() => {
    nameEl.textContent = store.state.designName + (store.state.dirty ? " *" : "");
  });
  nameEl.textContent = name;
  document.getElementById("tool-mode").textContent = store.state.tool;

  const renderer = initCanvas(document.getElementById("canvas"), store);

  try {
    // Await the library (FR-003) and the server defaults before enabling the UI.
    const [components, defaults] = await Promise.all([
      getComponents(),
      getDefaults().catch(() => ({ dataDir: "" })),
    ]);
    const palette = document.getElementById("palette");
    renderPalette(palette, components, store);
    const interaction = initInteraction({
      canvas: document.getElementById("canvas"),
      palette,
      store,
      renderer,
      library: components,
    });
    const fileops = makeFileOps({
      store,
      dataDir: defaults.dataDir,
      defaultName: defaultDesignName,
    });
    initToolbar({ container: document.getElementById("tools"), store, interaction, fileops });
    initProperties({ container: document.getElementById("properties"), store });
    overlay.classList.add("hidden");
  } catch (err) {
    overlay.classList.add("error");
    overlay.textContent =
      `Cannot reach server — is wut4-editor running? (${err.message})`;
  }
}

main();
