// Modal file-navigation dialog for Save and Open (§6.11, FR-046-053). Uses the
// server's /files endpoint to browse directories (no native file picker).

import { listDir, loadVectorFile, saveVectorFile } from "../api.js";
import { compileBehavior } from "../engine/galasm.js";
import { loadRomContents } from "../engine/sim.js";
import {
  deriveColumns,
  runVectors,
  captureRow,
  validateVectors,
  serializeVectors,
  deserializeVectors,
  reconcileVectors,
  emptyRow,
} from "../engine/vectors.js";

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

// chooseRenderDialog previews an embedded sub-design's interface and lets the
// user pick its render style (FR-097a), defaulting to the child's own
// defaultRender (FR-096). Resolves to "ic" | "connector", or null on cancel.
export function chooseRenderDialog(iface, defaultRender = "ic") {
  return new Promise((resolve) => {
    const overlay = el("div", "dialog-overlay");
    const box = el("div", "dialog");
    overlay.appendChild(box);

    box.appendChild(el("div", "dialog-title", "Add sub-component"));
    box.appendChild(el("div", "dialog-path", `Interface — ${iface.length} pin(s):`));
    const listEl = el("ul", "dialog-list");
    for (const p of iface) {
      listEl.appendChild(
        el("li", "dialog-entry", `${p.label} — ${p.dir}${p.width > 1 ? " /" + p.width : ""}`),
      );
    }
    box.appendChild(listEl);

    let render = defaultRender === "connector" ? "connector" : "ic";
    const row = el("div", "dialog-row");
    row.appendChild(el("label", "dialog-label", "Render as:"));
    const choice = (val, label) => {
      const r = el("input");
      r.type = "radio";
      r.name = "subdesign-render";
      r.value = val;
      r.id = "render-" + val;
      if (val === render) r.checked = true;
      r.addEventListener("change", () => {
        if (r.checked) render = val;
      });
      const l = el("label", "dialog-label", label);
      l.htmlFor = r.id;
      const span = el("span");
      span.append(r, l);
      return span;
    };
    row.append(choice("ic", "IC rectangle"), choice("connector", "Connector strip"));
    box.appendChild(row);

    const buttons = el("div", "dialog-buttons");
    buttons.append(button("Cancel", () => done(null)), button("OK", () => done(render)));
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
      } else if (e.key === "Enter") {
        e.stopPropagation();
        done(render);
      }
    }
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(overlay);
  });
}

// GAL22V10 is the fixed physical skeleton of a 24-pin GAL22V10 (FR-066c): pin 1
// is the dedicated clock/input, pins 2–11 and 13 are inputs, pins 14–23 are the
// ten OLMC I/O pins; pins 12/24 are GND/VCC and (like every other part's power
// pins) are not represented. Only labels, per-OLMC direction, and the behavior
// vary between parts — this constant supplies everything else. Inputs sit on the
// left, OLMC pins on the right; `outline` gives the symbol a sensible size.
const GAL22V10 = {
  outline: [8, 14],
  inputs: [
    { name: "CLK", pos: 1, number: 1, clock: true },
    { name: "I2", pos: 2, number: 2 },
    { name: "I3", pos: 3, number: 3 },
    { name: "I4", pos: 4, number: 4 },
    { name: "I5", pos: 5, number: 5 },
    { name: "I6", pos: 6, number: 6 },
    { name: "I7", pos: 7, number: 7 },
    { name: "I8", pos: 8, number: 8 },
    { name: "I9", pos: 9, number: 9 },
    { name: "I10", pos: 10, number: 10 },
    { name: "I11", pos: 11, number: 11 },
    { name: "I13", pos: 12, number: 13 },
  ],
  // OLMC pins, top→bottom = DIP 14→23.
  olmcs: Array.from({ length: 10 }, (_, i) => ({
    name: "IO" + (14 + i),
    pos: i + 1,
    number: 14 + i,
  })),
};

// OLMC direction choices (FR-066c): input, combinational output, or registered
// output. `dir` is the YAML pin direction; combinational and registered outputs
// are both `out` pins (registered is expressed by a `.R` behavior equation).
const OLMC_DIRS = [
  { kind: "comb", label: "comb out", dir: "out" },
  { kind: "reg", label: "reg out", dir: "out" },
  { kind: "in", label: "input", dir: "in" },
];

// galPartYaml serializes the authored part to component YAML (§7.3). Quoted
// scalars use JSON.stringify (valid YAML 1.2 double-quoted form); the behavior is
// emitted as a literal block scalar with each line indented two spaces.
export function galPartYaml({ partnumber, description, inputs, olmcs, groups, behavior }) {
  // Emit an explicit, immutable id (FR-066e) so the created part keys stably even
  // if its part-number display name is later edited; matches the library files
  // and the server's derive-when-absent rule (deriveComponentID).
  const lines = [
    `id: ${JSON.stringify("type-" + partnumber)}`,
    `type: "22V10"`,
    `gal: GAL22V10`,
    `partnumber: ${JSON.stringify(partnumber)}`,
  ];
  if (description) lines.push(`description: ${JSON.stringify(description)}`);
  if (olmcs.some((o) => o.kind === "reg")) {
    lines.push(`clock: ${JSON.stringify(inputs[0].name)}`); // pin-1 clock
  }
  lines.push(`outline: [${GAL22V10.outline[0]}, ${GAL22V10.outline[1]}]`, `pins:`);
  for (const p of inputs) {
    lines.push(`  - { name: ${JSON.stringify(p.name)}, side: left, pos: ${p.pos}, dir: in, number: ${p.number} }`);
  }
  for (const o of olmcs) {
    const dir = OLMC_DIRS.find((d) => d.kind === o.kind).dir;
    lines.push(`  - { name: ${JSON.stringify(o.name)}, side: right, pos: ${o.pos}, dir: ${dir}, number: ${o.number} }`);
  }
  // Pin groups (FR-066d/FR-063): members are stored by skeleton DIP number; emit
  // them resolved to current labels, ordered by physical pin layout (the bus bit
  // order). `inputs` then `olmcs` is exactly that layout order.
  if (groups && groups.length) {
    const layout = [...inputs, ...olmcs]; // pin-layout order
    const labelOf = new Map(layout.map((p) => [p.number, p.name]));
    const orderOf = new Map(layout.map((p, i) => [p.number, i]));
    lines.push(`groups:`);
    for (const g of groups) {
      const members = g.members
        .slice()
        .sort((a, b) => orderOf.get(a) - orderOf.get(b))
        .map((n) => JSON.stringify(labelOf.get(n)));
      lines.push(`  - { name: ${JSON.stringify(g.name)}, pins: [${members.join(", ")}] }`);
    }
  }
  if (behavior.trim()) {
    lines.push(`behavior: |`);
    for (const ln of behavior.replace(/\s+$/, "").split("\n")) lines.push(`  ${ln}`);
  }
  return lines.join("\n") + "\n";
}

// memDeviceYaml serializes a generated memory device type (memDeviceType output,
// builtins.js) to component YAML for persistence (FR-114f, §7.6). It emits the
// explicit pinout plus a `mem:` block; the server parses it like any component and
// the client's built-in behavior (FR-114d) binds from the round-tripped `mem` data
// on reload. Quoted scalars use JSON.stringify (valid YAML 1.2 double-quoted form).
export function memDeviceYaml(type) {
  const m = type.mem;
  const memFields = [
    `kind: ${m.kind}`,
    `addressBits: ${m.addressBits}`,
    `dataWidth: ${m.dataWidth}`,
    `locations: ${m.locations}`,
  ];
  if (m.romFile) memFields.push(`romFile: ${JSON.stringify(m.romFile)}`);

  // Emit the explicit, immutable id (FR-066e) so the device keys stably; `type` is
  // the YAML display-name field (§7.6), here the device's free-form name.
  const lines = [`id: ${JSON.stringify(type.id)}`, `type: ${JSON.stringify(type.name)}`];
  if (type.description) lines.push(`description: ${JSON.stringify(type.description)}`);
  lines.push(`mem: { ${memFields.join(", ")} }`);
  lines.push(`outline: [${type.width}, ${type.height}]`, `pins:`);
  for (const p of type.pins) {
    lines.push(
      `  - { name: ${JSON.stringify(p.name)}, side: ${p.side}, pos: ${p.position}, dir: ${p.direction} }`,
    );
  }
  if (type.pinGroups && type.pinGroups.length) {
    lines.push(`groups:`);
    for (const g of type.pinGroups) {
      const members = g.pins.map((n) => JSON.stringify(n)).join(", ");
      lines.push(`  - { name: ${JSON.stringify(g.name)}, pins: [${members}] }`);
    }
  }
  return lines.join("\n") + "\n";
}

// pinGroupGeometryError returns a reason string if the chosen members violate the
// pin-group geometry rule (FR-063a), else null. The bus-snap brace can only render
// a group whose pins are colinear on one edge with no foreign pin between them, so
// members must share a side and be contiguous (no non-member pin between them by
// `pos`). `pins` is the part's pins ({ number, label, side, pos }); `members` is
// the chosen DIP numbers. Pure and exported for testing; mirrors the server's
// validateGroupGeometry.
export function pinGroupGeometryError(pins, members) {
  const pinOf = new Map(pins.map((p) => [p.number, p]));
  const mp = members.map((n) => pinOf.get(n));
  const side = mp[0].side;
  if (mp.some((p) => p.side !== side)) return "All pins in a group must be on the same side.";
  const positions = mp.map((p) => p.pos);
  const lo = Math.min(...positions), hi = Math.max(...positions);
  const have = new Set(positions);
  const between = pins.find((p) => p.side === side && p.pos > lo && p.pos < hi && !have.has(p.pos));
  return between ? `Pins must be contiguous: "${between.label}" lies between the selected pins.` : null;
}

// pinGroupsDialog edits a GAL part's named pin groups (FR-066d). `pins` is the
// part's pins in layout order ({ number, label }); `groups` is the current list
// ({ name, members: [number] }). It works on a copy: list existing groups (each
// removable) and define more from a name + a checkbox subset. Resolves to the
// updated list on Done, or null on Cancel (discarding this session's edits).
export function pinGroupsDialog({ pins, groups }) {
  return new Promise((resolve) => {
    const working = groups.map((g) => ({ name: g.name, members: g.members.slice() }));
    const labelOf = new Map(pins.map((p) => [p.number, p.label]));

    const overlay = el("div", "dialog-overlay");
    const box = el("div", "dialog");
    overlay.appendChild(box);
    box.appendChild(el("div", "dialog-title", "Pin groups"));

    // Existing groups, each removable.
    const listEl = el("div", "dialog-list galdlg-pins");
    box.appendChild(listEl);
    function renderList() {
      listEl.replaceChildren();
      if (!working.length) {
        listEl.appendChild(el("div", "galdlg-section", "No groups yet."));
        return;
      }
      working.forEach((g, i) => {
        const row = el("div", "galdlg-row");
        const names = g.members.map((n) => labelOf.get(n)).join(", ");
        const text = el("span", "galdlg-grouptext", `${g.name} (${names})`);
        const rm = button("✕", () => {
          working.splice(i, 1);
          renderList();
        });
        row.append(rm, text);
        listEl.appendChild(row);
      });
    }
    renderList();

    // New-group form: name + a checkbox per pin (shown by current label).
    box.appendChild(el("div", "galdlg-section", "Define a group"));
    const nameInput = el("input", "dialog-name");
    nameInput.type = "text";
    nameInput.placeholder = "group name, e.g. D";
    const nameRow = el("div", "dialog-row");
    nameRow.append(el("label", "dialog-label", "Name:"), nameInput);
    box.appendChild(nameRow);

    const checks = el("div", "dialog-list galdlg-pins");
    const boxes = pins.map((p) => {
      const row = el("div", "galdlg-row");
      const cb = el("input");
      cb.type = "checkbox";
      cb.id = "grp-pin-" + p.number;
      const lab = el("label", "galdlg-grouptext", `${p.number}  ${p.label}`);
      lab.htmlFor = cb.id;
      row.append(cb, lab);
      checks.appendChild(row);
      return { number: p.number, cb };
    });
    box.appendChild(checks);

    const errEl = el("div", "galdlg-error");
    errEl.hidden = true;
    box.appendChild(errEl);

    function addGroup() {
      const name = nameInput.value.trim();
      if (!name) return showError("A group name is required.");
      if (working.some((g) => g.name === name)) return showError(`Group "${name}" already exists.`);
      const members = boxes.filter((b) => b.cb.checked).map((b) => b.number);
      if (!members.length) return showError("Select at least one pin.");
      const geomErr = pinGroupGeometryError(pins, members);
      if (geomErr) return showError(geomErr);
      working.push({ name, members });
      nameInput.value = "";
      for (const b of boxes) b.cb.checked = false;
      errEl.hidden = true;
      renderList();
    }
    function showError(msg) {
      errEl.textContent = msg;
      errEl.hidden = false;
    }

    const buttons = el("div", "dialog-buttons");
    buttons.append(
      button("Cancel", () => done(null)),
      button("Add group", addGroup),
      button("Done", () => done(working)),
    );
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
    nameInput.focus();
  });
}

// newGalPartDialog authors a new GAL22V10 part (FR-066c). It presents the fixed
// skeleton and collects the part number, description, per-pin labels, per-OLMC
// direction, and behavior, then calls submit(yaml) — which persists and returns
// the created ComponentType (FR-007a). A submit failure (duplicate part number,
// validation error) is shown inline and the dialog stays open. Resolves to the
// created component, or null on cancel.
export function newGalPartDialog({ submit }) {
  return new Promise((resolve) => {
    const overlay = el("div", "dialog-overlay");
    const box = el("div", "dialog");
    overlay.appendChild(box);
    box.appendChild(el("div", "dialog-title", "New GAL part — GAL22V10"));

    const pnInput = el("input", "dialog-name");
    pnInput.type = "text";
    pnInput.placeholder = "e.g. PC-DECODE-A";
    const pnRow = el("div", "dialog-row");
    pnRow.append(el("label", "dialog-label", "Part number:"), pnInput);
    box.appendChild(pnRow);

    const descInput = el("input", "dialog-name");
    descInput.type = "text";
    descInput.placeholder = "one-line description (optional)";
    const descRow = el("div", "dialog-row");
    descRow.append(el("label", "dialog-label", "Description:"), descInput);
    box.appendChild(descRow);

    // Scrollable pin region: inputs (labels) and OLMC pins (label + direction).
    const pins = el("div", "dialog-list galdlg-pins");
    box.appendChild(pins);

    pins.appendChild(el("div", "galdlg-section", "Inputs (pins 1–13)"));
    const inputFields = GAL22V10.inputs.map((p) => {
      const row = el("div", "galdlg-row");
      const tag = el("span", "galdlg-pin", `${p.number}${p.clock ? " CLK" : ""}`);
      const input = el("input", "dialog-name");
      input.type = "text";
      input.value = p.name;
      row.append(tag, input);
      pins.appendChild(row);
      return { meta: p, input };
    });

    pins.appendChild(el("div", "galdlg-section", "I/O — OLMC (pins 14–23)"));
    const olmcFields = GAL22V10.olmcs.map((o) => {
      const row = el("div", "galdlg-row");
      const tag = el("span", "galdlg-pin", String(o.number));
      const input = el("input", "dialog-name");
      input.type = "text";
      input.value = o.name;
      const sel = el("select", "galdlg-dir");
      for (const d of OLMC_DIRS) {
        const opt = el("option", null, d.label);
        opt.value = d.kind;
        sel.appendChild(opt);
      }
      sel.value = "comb";
      row.append(tag, input, sel);
      pins.appendChild(row);
      return { meta: o, input, sel };
    });

    // Pin groups (FR-066d): edited in a sub-dialog; tracked by skeleton DIP number
    // so a later relabel can't break a group.
    let groups = [];
    let subOpen = false; // suppress this dialog's Escape while a sub-dialog is open
    const currentPins = () => [
      ...inputFields.map((f) => ({
        number: f.meta.number,
        label: f.input.value.trim() || f.meta.name,
        side: "left",
        pos: f.meta.pos,
      })),
      ...olmcFields.map((f) => ({
        number: f.meta.number,
        label: f.input.value.trim() || f.meta.name,
        side: "right",
        pos: f.meta.pos,
      })),
    ];
    const groupsRow = el("div", "dialog-row");
    const groupsSummary = el("span", "dialog-label", "no pin groups");
    const groupsBtn = button("Pin groups…", async () => {
      subOpen = true;
      let updated;
      try {
        updated = await pinGroupsDialog({ pins: currentPins(), groups });
      } finally {
        subOpen = false;
      }
      if (updated) {
        groups = updated;
        groupsSummary.textContent = groups.length
          ? `${groups.length} group(s): ${groups.map((g) => g.name).join(", ")}`
          : "no pin groups";
      }
    });
    groupsRow.append(groupsBtn, groupsSummary);
    box.appendChild(groupsRow);

    box.appendChild(el("div", "galdlg-section", "Behavior (GALasm)"));
    const behavior = el("textarea", "galdlg-behavior");
    behavior.placeholder = "; sum-of-products equations, e.g.\n; IO14 = I2 * /I3 + I4";
    box.appendChild(behavior);

    // Live strict-validation status (FR-066c): the same gate Run applies
    // (compileBehavior + validateStrict, §6.13), so a part that fails here can't
    // be created.
    const valEl = el("div", "galdlg-validate");
    valEl.hidden = true;
    box.appendChild(valEl);

    const errEl = el("div", "galdlg-error");
    errEl.hidden = true;
    box.appendChild(errEl);

    const createBtn = button("Create", onOk);
    const buttons = el("div", "dialog-buttons");
    buttons.append(button("Cancel", () => done(null)), createBtn);
    box.appendChild(buttons);

    // Re-validate live as labels, directions, or the behavior change (FR-066c).
    behavior.addEventListener("input", validate);
    for (const f of inputFields) f.input.addEventListener("input", validate);
    for (const f of olmcFields) {
      f.input.addEventListener("input", validate);
      f.sel.addEventListener("change", validate);
    }
    validate(); // initial Create-enabled state

    // gather reads the current field values into a part description.
    function gather() {
      return {
        partnumber: pnInput.value.trim(),
        description: descInput.value.trim(),
        inputs: inputFields.map((f) => ({ ...f.meta, name: f.input.value.trim() })),
        olmcs: olmcFields.map((f) => ({ ...f.meta, name: f.input.value.trim(), kind: f.sel.value })),
      };
    }

    // candidateTypeData assembles the in-memory ComponentType the strict gate
    // validates — pins carry their resolved direction so behavior signal/output
    // checks match what Run would see (§6.13).
    function candidateTypeData(g) {
      const pins = [
        ...g.inputs.map((p) => ({ name: p.name, direction: "in" })),
        ...g.olmcs.map((o) => ({
          name: o.name,
          direction: OLMC_DIRS.find((d) => d.kind === o.kind).dir,
        })),
      ];
      const reg = g.olmcs.some((o) => o.kind === "reg");
      return {
        name: g.partnumber || "22V10",
        gal: "GAL22V10",
        pins,
        behavior: behavior.value,
        clock: reg ? g.inputs[0].name : undefined,
      };
    }

    // validate runs the strict gate live; an empty behavior is allowed (a part may
    // be authored without logic). Returns whether the part may be created.
    function validate() {
      errEl.hidden = true; // clear any stale submit error on edit
      if (!behavior.value.trim()) {
        setStatus("", null);
        createBtn.disabled = false;
        return true;
      }
      try {
        compileBehavior(candidateTypeData(gather()));
        setStatus("✓ valid GAL22V10 behavior", "ok");
        createBtn.disabled = false;
        return true;
      } catch (e) {
        setStatus(e.message, "err");
        createBtn.disabled = true;
        return false;
      }
    }
    function setStatus(msg, kind) {
      valEl.textContent = msg;
      valEl.hidden = !msg;
      valEl.className = "galdlg-validate" + (kind ? " " + kind : "");
    }

    async function onOk() {
      const g = gather();
      if (!g.partnumber) return showError("A part number is required.");
      if (!validate()) return; // behavior must pass the strict gate (FR-066c)
      const yaml = galPartYaml({ ...g, groups, behavior: behavior.value });
      createBtn.disabled = true;
      try {
        const comp = await submit(yaml);
        done(comp);
      } catch (e) {
        createBtn.disabled = false;
        showError(e.message);
      }
    }
    function showError(msg) {
      errEl.textContent = msg;
      errEl.hidden = false;
    }
    function done(result) {
      overlay.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve(result);
    }
    function onKey(e) {
      if (subOpen) return; // the pin-groups sub-dialog owns Escape while open
      if (e.key === "Escape") {
        e.stopPropagation();
        done(null);
      }
    }
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(overlay);
    pnInput.focus();
  });
}

// MEM_WIDTHS are the data widths a generated memory device may have (FR-114).
export const MEM_WIDTHS = [4, 8, 16, 32];
// MEM_MAX_ADDR_BITS bounds the address-bit count (FR-114a): 2^24 = 16,777,216
// locations.
export const MEM_MAX_ADDR_BITS = 24;

// validateMemSpec checks a gathered memory-device spec (FR-114a) and returns
// null when valid, else a short reason string. Pure (no DOM) so it is unit-
// testable and shared by the dialog's live Create gate. `spec` is the shape
// memDeviceDialog.gather() produces.
export function validateMemSpec(spec) {
  if (!spec.name || !spec.name.trim()) return "a name is required";
  if (spec.kind !== "ram" && spec.kind !== "rom") return "choose RAM or ROM";
  if (!Number.isInteger(spec.addressBits) || spec.addressBits < 1) {
    return "address bits must be a positive integer";
  }
  if (spec.addressBits > MEM_MAX_ADDR_BITS) {
    return `address bits must be ≤ ${MEM_MAX_ADDR_BITS}`;
  }
  if (!MEM_WIDTHS.includes(spec.dataWidth)) {
    return `data width must be one of ${MEM_WIDTHS.join(", ")}`;
  }
  if (spec.kind === "rom") {
    if (!spec.romFile) return "choose a ROM content file";
    if (!/\.(bin|hex)$/i.test(spec.romFile)) return "ROM file must be .bin or .hex";
  }
  return null;
}

// memDeviceDialog authors a new memory device (RAM or ROM, FR-114/FR-114a). It
// collects the class, size (address bits → 2^n locations), data width, and — for
// ROM — a content file, validates them, and calls submit(spec). The pinout,
// behavior, file format, and persistence are deferred (FR-114b/OQ-013), so the
// caller's submit is presently a stub. `startPath` seats the ROM file browser.
// Resolves to submit's result, or null on cancel.
export function memDeviceDialog({ submit, startPath = "" }) {
  return new Promise((resolve) => {
    const overlay = el("div", "dialog-overlay");
    const box = el("div", "dialog");
    overlay.appendChild(box);
    box.appendChild(el("div", "dialog-title", "New memory device"));

    // Shared field state (preserved across class-driven rebuilds so a RAM/ROM
    // switch keeps the size/width the user already set).
    let kind = "ram";
    let addressBits = 8;
    let dataWidth = 8;
    let romFile = null;
    let nameEdited = false; // once the user types a name, stop auto-suggesting it

    // RAM/ROM radio (default RAM); changing it rebuilds the dynamic region.
    const classRow = el("div", "dialog-row");
    classRow.appendChild(el("label", "dialog-label", "Type:"));
    const radios = {};
    for (const k of ["ram", "rom"]) {
      const lbl = el("label", "memdlg-radio");
      const r = el("input");
      r.type = "radio";
      r.name = "mem-kind";
      r.value = k;
      r.checked = k === kind;
      r.addEventListener("change", () => {
        if (!r.checked) return;
        kind = k;
        romFile = null; // re-initialize: a class switch discards the chosen file
        syncName();
        rebuild();
      });
      radios[k] = r;
      lbl.append(r, document.createTextNode(k.toUpperCase()));
      classRow.appendChild(lbl);
    }
    box.appendChild(classRow);

    // Name (FR-114c): the free-form display name, which also derives the type's
    // library id. Pre-filled with a size-based suggestion that keeps tracking the
    // class/size/width until the user edits it, after which it is left alone.
    const suggestName = () => `${kind.toUpperCase()} ${2 ** addressBits}×${dataWidth}`;
    const nameInput = el("input", "dialog-name");
    nameInput.type = "text";
    nameInput.value = suggestName();
    nameInput.addEventListener("input", () => {
      nameEdited = true;
      validate();
    });
    const syncName = () => {
      if (!nameEdited) nameInput.value = suggestName();
    };
    const nameRow = el("div", "dialog-row");
    nameRow.append(el("label", "dialog-label", "Name:"), nameInput);
    box.appendChild(nameRow);

    // Dynamic region — fully rebuilt on a class change (FR-114).
    const dyn = el("div", "memdlg-dyn");
    box.appendChild(dyn);

    const errEl = el("div", "galdlg-error");
    errEl.hidden = true;
    box.appendChild(errEl);

    const createBtn = button("Create", onOk);
    const buttons = el("div", "dialog-buttons");
    buttons.append(button("Cancel", () => done(null)), createBtn);
    box.appendChild(buttons);

    // rebuild renders the class-specific controls into `dyn` (FR-114a).
    function rebuild() {
      dyn.replaceChildren();
      radios[kind].checked = true;

      // Address bits → locations.
      const addrRow = el("div", "dialog-row");
      const addrInput = el("input", "memdlg-num");
      addrInput.type = "number";
      addrInput.min = "1";
      addrInput.max = String(MEM_MAX_ADDR_BITS);
      addrInput.step = "1";
      addrInput.value = String(addressBits);
      const locLabel = el("span", "memdlg-hint");
      const refreshLoc = () => {
        const n = Number(addrInput.value);
        locLabel.textContent =
          Number.isInteger(n) && n >= 1 && n <= MEM_MAX_ADDR_BITS
            ? `= ${2 ** n} locations`
            : "—";
      };
      addrInput.addEventListener("input", () => {
        addressBits = Number(addrInput.value);
        refreshLoc();
        syncName();
        validate();
      });
      refreshLoc();
      addrRow.append(el("label", "dialog-label", "Address bits:"), addrInput, locLabel);
      dyn.appendChild(addrRow);

      // Data width.
      const widthRow = el("div", "dialog-row");
      const widthSel = el("select", "memdlg-sel");
      for (const w of MEM_WIDTHS) {
        const opt = el("option", null, String(w));
        opt.value = String(w);
        widthSel.appendChild(opt);
      }
      widthSel.value = String(dataWidth);
      widthSel.addEventListener("change", () => {
        dataWidth = Number(widthSel.value);
        syncName();
        validate();
      });
      widthRow.append(el("label", "dialog-label", "Data width (bits):"), widthSel);
      dyn.appendChild(widthRow);

      // ROM-only content file (FR-114a), chosen via the server-side browser.
      if (kind === "rom") {
        const fileRow = el("div", "dialog-row");
        const fileLabel = el("span", "memdlg-file", romFile || "no file chosen");
        const chooseBtn = button("Choose file…", async () => {
          const res = await openFileDialog({
            mode: "open",
            startPath,
            title: "Choose ROM content file (.bin / .hex)",
            exts: ["bin", "hex"],
          });
          if (res) {
            romFile = res.path;
            fileLabel.textContent = romFile;
            validate();
          }
        });
        fileRow.append(el("label", "dialog-label", "ROM file:"), chooseBtn, fileLabel);
        dyn.appendChild(fileRow);
      }

      validate();
    }

    // gather reads the current field state into a spec (FR-114a/FR-114c).
    function gather() {
      return {
        name: nameInput.value.trim(),
        kind,
        addressBits,
        locations: 2 ** addressBits,
        dataWidth,
        ...(kind === "rom" ? { romFile } : {}),
      };
    }

    // validate gates Create on the pure validator (FR-114a).
    function validate() {
      errEl.hidden = true;
      createBtn.disabled = validateMemSpec(gather()) !== null;
      return !createBtn.disabled;
    }

    async function onOk() {
      const spec = gather();
      const reason = validateMemSpec(spec);
      if (reason) return showError(reason);
      createBtn.disabled = true;
      try {
        done(await submit(spec));
      } catch (e) {
        createBtn.disabled = false;
        showError(e.message);
      }
    }
    function showError(msg) {
      errEl.textContent = msg;
      errEl.hidden = false;
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
    rebuild();
  });
}

// openFileDialog resolves to { path } on confirm, or null on cancel. `title`
// overrides the default heading (e.g. the ROM-content picker, FR-114a) — the
// browser itself is unchanged (it lists dirs + the server's filtered files).
export function openFileDialog({ mode, startPath, defaultName = "", title, exts = null, saveExt = "json" } = {}) {
  return new Promise((resolve) => {
    const overlay = el("div", "dialog-overlay");
    const box = el("div", "dialog");
    overlay.appendChild(box);

    box.appendChild(
      el("div", "dialog-title", title ?? (mode === "save" ? "Save design" : "Open design")),
    );
    const pathLabel = el("div", "dialog-path");
    const listEl = el("ul", "dialog-list");
    box.append(pathLabel, listEl);

    let currentPath = startPath;
    let selectedFile = null;
    let existingFiles = new Set(); // file names in the current dir, for the overwrite guard (FR-049b)

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
        if (!name.endsWith("." + saveExt)) name += "." + saveExt;
        // Confirm before clobbering an existing file (FR-049b).
        if (existingFiles.has(name) && !window.confirm(`"${name}" already exists. Overwrite?`)) {
          return;
        }
        done({ path: joinPath(currentPath, name) });
      } else if (selectedFile) {
        done({ path: selectedFile });
      }
    }

    async function navigate(path) {
      let listing;
      try {
        listing = await listDir(path, exts);
      } catch (e) {
        pathLabel.textContent = "error: " + e.message;
        return;
      }
      currentPath = listing.path;
      selectedFile = null;
      existingFiles = new Set(listing.entries.filter((e) => !e.isDir).map((e) => e.name));
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

// testVectorsDialog is the combinational test-vector table editor (§6.16, FR-115).
// Columns are auto-derived from the open design (input switches → 0/1 cells;
// indicator bits → H/L/X cells); the user fills rows, Runs them against the slow
// simulator (pass/fail per cell, FR-115d), Captures golden outputs from a sim run,
// and Loads/Saves a `.tv` sibling file (FR-115a). Resolves to null (no result).
export function testVectorsDialog({ store, dataDir }) {
  return new Promise((resolve) => {
    const design = store.design;
    const columns = deriveColumns(design);
    const rows = [emptyRow(columns)]; // start with one blank row to fill
    let runResults = null; // [{ cells, pass }] aligned to rows, or null when stale

    const overlay = el("div", "dialog-overlay");
    const box = el("div", "dialog vec-dialog");
    overlay.appendChild(box);
    box.appendChild(el("div", "dialog-title", "Test Vectors"));

    // A design with no switches and no indicators has nothing to drive or observe.
    if (columns.inputs.length === 0 && columns.outputs.length === 0) {
      box.appendChild(
        el(
          "div",
          "vec-empty",
          "This design has no input switches or indicators to bind. Place input switches (inputs) and state indicators (outputs), then reopen Test Vectors.",
        ),
      );
      const buttons = el("div", "dialog-buttons");
      buttons.append(button("Close", () => done()));
      box.appendChild(buttons);
      finish();
      return;
    }

    const summary = el("div", "vec-summary");
    const noteEl = el("div", "vec-note");
    noteEl.hidden = true;
    const errEl = el("div", "galdlg-error");
    errEl.hidden = true;

    // --- table ---
    const table = el("table", "vec-table");
    const thead = el("thead");
    // Group header: IN spanning inputs, OUT spanning outputs.
    const grpRow = el("tr");
    grpRow.appendChild(el("th", "vec-corner"));
    if (columns.inputs.length) {
      const th = el("th", "vec-group", "IN");
      th.colSpan = columns.inputs.length;
      grpRow.appendChild(th);
    }
    if (columns.outputs.length) {
      const th = el("th", "vec-group vec-group-out", "OUT");
      th.colSpan = columns.outputs.length;
      grpRow.appendChild(th);
    }
    grpRow.appendChild(el("th", "vec-corner"));
    thead.appendChild(grpRow);
    // Column labels.
    const labRow = el("tr");
    labRow.appendChild(el("th", "vec-rownum", "#"));
    for (const c of columns.inputs) labRow.appendChild(el("th", "vec-collabel", c.label));
    for (const c of columns.outputs) {
      labRow.appendChild(el("th", "vec-collabel vec-out", c.label));
    }
    labRow.appendChild(el("th", "vec-corner"));
    thead.appendChild(labRow);
    table.appendChild(thead);
    const tbody = el("tbody");
    table.appendChild(tbody);

    const tableWrap = el("div", "vec-tablewrap");
    tableWrap.appendChild(table);
    box.append(tableWrap, summary, noteEl, errEl);

    function mkSelect(opts, value) {
      const s = el("select", "vec-select");
      for (const o of opts) {
        const op = el("option", null, o);
        op.value = o;
        s.appendChild(op);
      }
      s.value = value;
      return s;
    }

    function renderBody() {
      tbody.replaceChildren();
      rows.forEach((row, ri) => {
        const tr = el("tr");
        tr.appendChild(el("td", "vec-rownum", String(ri + 1)));
        columns.inputs.forEach((col, ci) => {
          const td = el("td", "vec-cell");
          const sel = mkSelect(["0", "1"], row.in[ci]);
          sel.addEventListener("change", () => {
            row.in[ci] = sel.value;
            clearResults();
          });
          td.appendChild(sel);
          tr.appendChild(td);
        });
        columns.outputs.forEach((col, ci) => {
          const td = el("td", "vec-cell vec-out");
          const sel = mkSelect(["H", "L", "X"], row.out[ci]);
          sel.addEventListener("change", () => {
            row.out[ci] = sel.value;
            clearResults();
          });
          td.appendChild(sel);
          const status = el("span", "vec-status");
          td.appendChild(status);
          if (runResults && runResults[ri]) {
            const cell = runResults[ri].cells[ci];
            td.classList.add(cell.pass ? "pass" : "fail");
            if (!cell.pass) status.textContent = `got ${cell.actual}`;
          }
          tr.appendChild(td);
        });
        const delTd = el("td", "vec-cell");
        const del = button("✕", () => {
          rows.splice(ri, 1);
          if (rows.length === 0) rows.push(emptyRow(columns));
          clearResults();
          renderBody();
        });
        del.title = "Delete row";
        delTd.appendChild(del);
        tr.appendChild(delTd);
        tbody.appendChild(tr);
      });
    }

    // clearResults drops stale pass/fail painting after any edit and repaints.
    function clearResults() {
      if (!runResults) return;
      runResults = null;
      summary.textContent = "";
      renderBody();
    }

    // --- actions ---
    async function onRun() {
      errEl.hidden = true;
      const doc = { inputs: columns.inputs, outputs: columns.outputs, rows };
      const check = validateVectors(doc);
      if (!check.ok) return showError(check.errors[0]);
      try {
        const romContent = await loadRomContents(design);
        const res = runVectors(design, doc, { romContent });
        runResults = res.rows;
        summary.textContent = `${res.passed} of ${res.total} rows passed`;
        summary.className = "vec-summary " + (res.passed === res.total ? "ok" : "err");
        renderBody();
      } catch (e) {
        showError(`cannot run vectors: ${e.message}`);
      }
    }

    async function onCapture() {
      errEl.hidden = true;
      try {
        const romContent = await loadRomContents(design);
        for (const row of rows) {
          row.out = captureRow(design, columns, row.in, { romContent });
        }
        clearResults();
        renderBody();
      } catch (e) {
        showError(`cannot capture: ${e.message}`);
      }
    }

    async function onSave() {
      errEl.hidden = true;
      const res = await openFileDialog({
        mode: "save",
        startPath: defaultDir(),
        defaultName: defaultName(),
        title: "Save test vectors (.tv)",
        exts: ["tv"],
        saveExt: "tv",
      });
      if (!res) return;
      try {
        await saveVectorFile(res.path, serializeVectors({ inputs: columns.inputs, outputs: columns.outputs, rows }));
        showNote(`Saved ${baseName(res.path)}`);
      } catch (e) {
        showError(`cannot save: ${e.message}`);
      }
    }

    async function onLoad() {
      errEl.hidden = true;
      const res = await openFileDialog({
        mode: "open",
        startPath: defaultDir(),
        title: "Open test vectors (.tv)",
        exts: ["tv"],
      });
      if (!res) return;
      try {
        const obj = await loadVectorFile(res.path);
        const fileDoc = deserializeVectors(obj);
        const { rows: aligned, warnings } = reconcileVectors(fileDoc, columns);
        rows.length = 0;
        for (const r of aligned) rows.push(r);
        if (rows.length === 0) rows.push(emptyRow(columns));
        clearResults();
        runResults = null;
        summary.textContent = "";
        renderBody();
        if (warnings.length) {
          showNote(`Loaded with ${warnings.length} warning(s): ${warnings.join("; ")}`);
        } else {
          showNote(`Loaded ${baseName(res.path)}`);
        }
      } catch (e) {
        showError(`cannot load: ${e.message}`);
      }
    }

    // --- buttons ---
    const buttons = el("div", "dialog-buttons");
    const addBtn = button("+ Row", () => {
      rows.push(emptyRow(columns));
      clearResults();
      renderBody();
    });
    buttons.append(
      addBtn,
      button("Capture", onCapture),
      button("Run", onRun),
      button("Load", onLoad),
      button("Save", onSave),
      button("Close", () => done()),
    );
    box.appendChild(buttons);

    // --- helpers ---
    function defaultDir() {
      const sp = store.state.savePath;
      return sp ? sp.replace(/\/[^/]*$/, "") || "/" : dataDir;
    }
    function defaultName() {
      const sp = store.state.savePath;
      const base = sp ? baseName(sp).replace(/\.[^.]*$/, "") : design.name || "vectors";
      return base;
    }
    function baseName(p) {
      return p.split(/[\\/]/).pop();
    }
    function showError(msg) {
      errEl.textContent = msg;
      errEl.hidden = false;
    }
    function showNote(msg) {
      noteEl.textContent = msg;
      noteEl.hidden = false;
    }

    renderBody();
    finish();

    function finish() {
      document.addEventListener("keydown", onKey, true);
      document.body.appendChild(overlay);
    }
    function done() {
      overlay.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve(null);
    }
    function onKey(e) {
      if (e.key === "Escape") {
        e.stopPropagation();
        done();
      }
    }
  });
}
