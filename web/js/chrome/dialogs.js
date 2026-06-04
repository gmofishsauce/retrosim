// Modal file-navigation dialog for Save and Open (§6.11, FR-046-053). Uses the
// server's /files endpoint to browse directories (no native file picker).

import { listDir } from "../api.js";

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

function button(label, onClick) {
  const b = el("button", "tool-btn", label);
  b.addEventListener("click", onClick);
  return b;
}

function joinPath(dir, name) {
  return dir.replace(/\/+$/, "") + "/" + name;
}

// chooseGroupDialog asks the user to pick one pin group when a bus width matches
// more than one (FR-041b). Resolves to the chosen group name, or null on cancel.
export function chooseGroupDialog(groups) {
  return new Promise((resolve) => {
    const overlay = el("div", "dialog-overlay");
    const box = el("div", "dialog");
    overlay.appendChild(box);

    box.appendChild(el("div", "dialog-title", "Connect bus to group"));
    box.appendChild(
      el("div", "dialog-path", "More than one pin group matches the bus width:"),
    );
    const listEl = el("ul", "dialog-list");
    box.appendChild(listEl);
    for (const g of groups) {
      const li = el("li", "dialog-entry", `${g.name} (${g.pins.join(", ")})`);
      li.addEventListener("click", () => done(g.name));
      listEl.appendChild(li);
    }

    const buttons = el("div", "dialog-buttons");
    buttons.append(button("Cancel", () => done(null)));
    box.appendChild(buttons);

    function done(result) {
      overlay.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve(result);
    }
    function onKey(e) {
      if (e.key === "Escape") {
        e.stopPropagation();
        done(null);
      }
    }
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(overlay);
  });
}

// chooseBitDialog asks which bus bit to break out (FR-043a). Lists bits
// 0..width-1, labeled with the bit name when the bus has one. Resolves to the bit
// index, or null on cancel.
export function chooseBitDialog(bus) {
  return new Promise((resolve) => {
    const overlay = el("div", "dialog-overlay");
    const box = el("div", "dialog");
    overlay.appendChild(box);

    box.appendChild(el("div", "dialog-title", "Break out bus bit"));
    box.appendChild(el("div", "dialog-path", `Choose a bit (bus width ${bus.width}):`));
    const listEl = el("ul", "dialog-list");
    box.appendChild(listEl);
    for (let i = 0; i < bus.width; i++) {
      const named = bus.bitNames && bus.bitNames[i] != null;
      const li = el("li", "dialog-entry", named ? `${i}: ${bus.bitNames[i]}` : `${i}`);
      li.addEventListener("click", () => done(i));
      listEl.appendChild(li);
    }

    const buttons = el("div", "dialog-buttons");
    buttons.append(button("Cancel", () => done(null)));
    box.appendChild(buttons);

    function done(result) {
      overlay.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve(result);
    }
    function onKey(e) {
      if (e.key === "Escape") {
        e.stopPropagation();
        done(null);
      }
    }
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(overlay);
  });
}

// promptWidthDialog asks for a bus width (FR-038). Resolves to a positive integer,
// or null on cancel / invalid input.
export function promptWidthDialog(current) {
  return new Promise((resolve) => {
    const overlay = el("div", "dialog-overlay");
    const box = el("div", "dialog");
    overlay.appendChild(box);

    box.appendChild(el("div", "dialog-title", "Set bus width"));
    const row = el("div", "dialog-row");
    const input = el("input", "dialog-name");
    input.type = "number";
    input.min = "1";
    input.value = String(current);
    row.append(el("label", "dialog-label", "Width (bits):"), input);
    box.appendChild(row);

    const buttons = el("div", "dialog-buttons");
    buttons.append(button("Cancel", () => done(null)), button("OK", onOk));
    box.appendChild(buttons);

    function onOk() {
      const n = parseInt(input.value, 10);
      done(Number.isInteger(n) && n >= 1 ? n : null);
    }
    function done(result) {
      overlay.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve(result);
    }
    function onKey(e) {
      if (e.key === "Escape") {
        e.stopPropagation();
        done(null);
      } else if (e.key === "Enter") {
        e.stopPropagation();
        onOk();
      }
    }
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(overlay);
    input.focus();
    input.select();
  });
}

// promptBitNamesDialog edits a bus's per-bit names (FR-037b): one field per bit,
// prefilled with any current names. Resolves to { names } where names is a
// length-width array (or null when every field is blank, to clear names), or null
// on cancel.
export function promptBitNamesDialog(bus) {
  return new Promise((resolve) => {
    const overlay = el("div", "dialog-overlay");
    const box = el("div", "dialog");
    overlay.appendChild(box);

    box.appendChild(el("div", "dialog-title", "Edit bus bit names"));
    box.appendChild(el("div", "dialog-path", `One name per bit (bus width ${bus.width}):`));
    const listEl = el("div", "dialog-list");
    box.appendChild(listEl);
    const inputs = [];
    for (let i = 0; i < bus.width; i++) {
      const row = el("div", "dialog-row");
      const input = el("input", "dialog-name");
      input.type = "text";
      input.value = bus.bitNames && bus.bitNames[i] != null ? bus.bitNames[i] : "";
      row.append(el("label", "dialog-label", `bit ${i}:`), input);
      listEl.appendChild(row);
      inputs.push(input);
    }

    const buttons = el("div", "dialog-buttons");
    buttons.append(button("Cancel", () => done(null)), button("OK", onOk));
    box.appendChild(buttons);

    function onOk() {
      const names = inputs.map((i) => i.value.trim());
      done({ names: names.every((n) => n === "") ? null : names });
    }
    function done(result) {
      overlay.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve(result);
    }
    function onKey(e) {
      if (e.key === "Escape") {
        e.stopPropagation();
        done(null);
      }
    }
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(overlay);
    if (inputs[0]) inputs[0].focus();
  });
}

// openFileDialog resolves to { path } on confirm, or null on cancel.
export function openFileDialog({ mode, startPath, defaultName = "" }) {
  return new Promise((resolve) => {
    const overlay = el("div", "dialog-overlay");
    const box = el("div", "dialog");
    overlay.appendChild(box);

    box.appendChild(el("div", "dialog-title", mode === "save" ? "Save design" : "Open design"));
    const pathLabel = el("div", "dialog-path");
    const listEl = el("ul", "dialog-list");
    box.append(pathLabel, listEl);

    let currentPath = startPath;
    let selectedFile = null;

    let nameInput = null;
    if (mode === "save") {
      const row = el("div", "dialog-row");
      nameInput = el("input", "dialog-name");
      nameInput.type = "text";
      nameInput.value = defaultName;
      row.append(el("label", "dialog-label", "Name:"), nameInput);
      box.appendChild(row);
    }

    const buttons = el("div", "dialog-buttons");
    buttons.append(
      button("Cancel", () => done(null)),
      button(mode === "save" ? "Save" : "Open", onOk),
    );
    box.appendChild(buttons);

    function onOk() {
      if (mode === "save") {
        let name = nameInput.value.trim();
        if (!name) return;
        if (!name.endsWith(".json")) name += ".json";
        done({ path: joinPath(currentPath, name) });
      } else if (selectedFile) {
        done({ path: selectedFile });
      }
    }

    async function navigate(path) {
      let listing;
      try {
        listing = await listDir(path);
      } catch (e) {
        pathLabel.textContent = "error: " + e.message;
        return;
      }
      currentPath = listing.path;
      selectedFile = null;
      pathLabel.textContent = listing.path;
      listEl.replaceChildren();

      if (listing.parent && listing.parent !== listing.path) {
        const up = el("li", "dialog-entry dir", "\u{1F4C1} ..");
        up.addEventListener("click", () => navigate(listing.parent));
        listEl.appendChild(up);
      }
      for (const entry of listing.entries) {
        const li = el(
          "li",
          "dialog-entry " + (entry.isDir ? "dir" : "file"),
          (entry.isDir ? "\u{1F4C1} " : "\u{1F4C4} ") + entry.name,
        );
        if (entry.isDir) {
          li.addEventListener("click", () => navigate(joinPath(listing.path, entry.name)));
        } else {
          li.addEventListener("click", () => {
            selectedFile = joinPath(listing.path, entry.name);
            for (const c of listEl.children) c.classList.remove("selected");
            li.classList.add("selected");
            if (nameInput) nameInput.value = entry.name; // overwrite target
          });
          li.addEventListener("dblclick", () => {
            selectedFile = joinPath(listing.path, entry.name);
            onOk();
          });
        }
        listEl.appendChild(li);
      }
    }

    function done(result) {
      overlay.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve(result);
    }
    function onKey(e) {
      if (e.key === "Escape") {
        e.stopPropagation();
        done(null);
      }
    }
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(overlay);
    navigate(startPath);
  });
}
