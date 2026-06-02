// Application bootstrap (§6.12). Creates the initial empty design and store,
// fetches the component library, builds the palette and canvas renderer, and
// only then removes the loading overlay so the canvas is not interactable until
// the library is ready (FR-003).

import { getComponents } from "./api.js";
import { createDesign, addInstance } from "./model/design.js";
import { createStore } from "./store.js";
import { initCanvas } from "./engine/canvas.js";

// defaultDesignName builds "unnamed schematic <datetime>" from the local clock
// (FR-004, FR-045).
function defaultDesignName(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return `unnamed schematic ${date} ${time}`;
}

function renderPalette(paletteEl, components) {
  paletteEl.replaceChildren();
  for (const type of components) {
    const tile = document.createElement("div");
    tile.className = "palette-tile";
    tile.textContent = type.name; // FR-005: type name per tile
    tile.dataset.type = type.name;
    tile.draggable = true; // wired to placement in a later slice
    paletteEl.appendChild(tile);
  }
}

async function main() {
  const overlay = document.getElementById("loading-overlay");

  // Open in select-tool mode with an empty, unsaved design (FR-004).
  const name = defaultDesignName();
  const design = createDesign(name);
  const store = createStore({ design, designName: name });
  document.getElementById("design-name").textContent = name;
  document.getElementById("tool-mode").textContent = store.state.tool;

  const renderer = initCanvas(document.getElementById("canvas"), store);

  try {
    const components = await getComponents(); // FR-003: await before enabling UI
    renderPalette(document.getElementById("palette"), components);
    overlay.classList.add("hidden");

    // Dev hook: lets the renderer be exercised from the console before the
    // placement tool exists (removed once interaction lands).
    window.__wut4 = { store, design, renderer, components, addInstance };
  } catch (err) {
    overlay.classList.add("error");
    overlay.textContent =
      `Cannot reach server — is wut4-editor running? (${err.message})`;
  }
}

main();
