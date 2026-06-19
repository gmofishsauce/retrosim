// Modal file-navigation dialog for Save and Open (§6.11, FR-046-053). Uses the
// server's /files endpoint to browse directories (no native file picker).

import { listDir } from "../api.js";
import { compileBehavior } from "../engine/galasm.js";

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
  const lines = [`type: "22V10"`, `gal: GAL22V10`, `partnumber: ${JSON.stringify(partnumber)}`];
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
