// Right-click context menu (§6.11, FR-033b). Pure presentation: the caller
// supplies screen coordinates and an item list; this module renders, positions,
// and dismisses the menu. Items are { label, onClick, danger? } or { separator }.

let openMenu = null;

function closeMenu() {
  if (!openMenu) return;
  openMenu.remove();
  openMenu = null;
  document.removeEventListener("mousedown", onOutside, true);
  document.removeEventListener("keydown", onKey, true);
}

function onOutside(e) {
  if (openMenu && !openMenu.contains(e.target)) closeMenu();
}

function onKey(e) {
  if (e.key === "Escape") {
    e.stopPropagation();
    closeMenu();
  }
}

// openContextMenu shows a menu at (x, y) in client coordinates. Choosing an item
// closes the menu and runs its onClick; Escape or an outside click dismisses it.
export function openContextMenu(x, y, items) {
  closeMenu();
  const menu = document.createElement("div");
  menu.className = "context-menu";
  for (const item of items) {
    if (item.separator) {
      menu.appendChild(document.createElement("hr")).className = "context-sep";
      continue;
    }
    const mi = document.createElement("div");
    mi.className = "context-item" + (item.danger ? " danger" : "");
    mi.textContent = item.label;
    mi.addEventListener("click", () => {
      closeMenu();
      item.onClick();
    });
    menu.appendChild(mi);
  }

  menu.style.left = x + "px";
  menu.style.top = y + "px";
  document.body.appendChild(menu);

  // Nudge back on-screen if it overflows the viewport.
  const r = menu.getBoundingClientRect();
  if (r.right > window.innerWidth) menu.style.left = Math.max(0, x - r.width) + "px";
  if (r.bottom > window.innerHeight) menu.style.top = Math.max(0, y - r.height) + "px";

  openMenu = menu;
  document.addEventListener("mousedown", onOutside, true);
  document.addEventListener("keydown", onKey, true);
}
