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
