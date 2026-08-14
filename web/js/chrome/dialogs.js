// Modal file-navigation dialog for Save and Open (§6.11, FR-046-053). Uses the
// server's /files endpoint to browse directories (no native file picker).

import { listDir, loadDesign, loadVectorFile, saveVectorFile } from "../api.js";
import { setAppState } from "./statusbar.js";
import { compileBehavior } from "../engine/galasm.js";
import { loadRomContents } from "../engine/sim.js";
import { flatten } from "../model/subdesign.js";
import {
  deriveColumns,
  runVectors,
  captureVectors,
  validateVectors,
  serializeVectors,
  deserializeVectors,
  reconcileVectors,
  emptyRow,
  cloneRow,
  bitGroups,
  groupDigits,
  groupToHex,
  groupFromHex,
  groupActualHex,
  clockSources,
  isStateful,
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

// nextSymbol is the whole cycle rule behind the test-vector panel's cycling cell
// buttons (FR-115o): advance one place in the column's established symbol order
// and wrap. An unrecognized symbol (indexOf → -1) normalizes to opts[0] rather
// than throwing, so a cell holding something the column no longer offers is
// repaired by one click. Pure and DOM-free so it unit-tests beside tvPathFor.
export function nextSymbol(opts, cur) {
  return opts[(opts.indexOf(cur) + 1) % opts.length];
}

function joinPath(dir, name) {
  return dir.replace(/\/+$/, "") + "/" + name;
}

// POSIX path scraps used by the test-vector panel's document model (FR-115m);
// the design-side equivalents live in model/persist.js (dirOf/baseOf).
const baseName = (p) => p.split(/[\\/]/).pop();
const dirOfPath = (p) => p.replace(/\/[^/]*$/, "") || "/";

// tvPathFor is the pure name rule for the test-vector file a panel associates
// itself with (FR-115m/FR-115a): the design's sibling `<base>.tv` at the project
// root (FR-121h), falling back to the design's own directory and then to the
// data root, and to the design's display name when it has never been saved.
// Pure and DOM-free so it unit-tests beside applySaveExt.
export function tvPathFor({ project = null, savePath = null, designName = "", dataDir = "" } = {}) {
  const dir = project?.dir || (savePath ? dirOfPath(savePath) : dataDir) || "/";
  const base = savePath ? baseName(savePath).replace(/\.[^.]*$/, "") : designName || "vectors";
  return joinPath(dir, base + ".tv");
}

// confirmSaveDialog is the three-way unsaved-work prompt (FR-115m): the panel's
// counterpart of the design's "Discard unsaved changes?" confirm, with the Save
// choice a two-button confirm cannot offer. Resolves to "save" | "discard" |
// "cancel"; Escape and the overlay's Cancel both mean cancel.
export function confirmSaveDialog(name) {
  return new Promise((resolve) => {
    const overlay = el("div", "dialog-overlay");
    const box = el("div", "dialog");
    overlay.appendChild(box);
    box.appendChild(el("div", "dialog-title", "Unsaved test vectors"));
    box.appendChild(el("div", "dialog-path", `${name} has unsaved changes.`));

    const buttons = el("div", "dialog-buttons");
    buttons.append(
      button("Cancel", () => done("cancel")),
      button("Discard", () => done("discard")),
      button("Save", () => done("save")),
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
        done("cancel");
      }
    }
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(overlay);
  });
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

// chooseBusAlignDialog asks how to align an unequal-width bus join (FR-039b):
// which bit of the wider (width `wide`) bus lines up with bit 0 of the narrower
// (width `narrow`) bus. Offers each start k in 0..(wide-narrow). Resolves to the
// chosen offset k, or null on cancel.
export function chooseBusAlignDialog(wide, narrow) {
  return new Promise((resolve) => {
    const overlay = el("div", "dialog-overlay");
    const box = el("div", "dialog");
    overlay.appendChild(box);

    box.appendChild(el("div", "dialog-title", "Align bus connection"));
    box.appendChild(
      el(
        "div",
        "dialog-path",
        `Connect the width-${narrow} bus to which bits of the width-${wide} bus?`,
      ),
    );
    const listEl = el("ul", "dialog-list");
    box.appendChild(listEl);
    for (let k = 0; k <= wide - narrow; k++) {
      const hi = k + narrow - 1;
      const label = narrow === 1 ? `bit ${k}` : `bits ${k}–${hi}`;
      const li = el("li", "dialog-entry", `${label} (bit 0 ↔ wide bit ${k})`);
      li.addEventListener("click", () => done(k));
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

// promptNoteDialog asks for the optional note recorded with a design-rule waiver
// (FR-124e) — "tied high on the board", "spare gate, intentional". Resolves to
// the entered string (possibly empty, which the caller stores as no note at all)
// or to null when the user cancels, which abandons the waive entirely. `message`
// is the finding being waived, shown so the user can see what they are agreeing
// to hide.
export function promptNoteDialog(message) {
  return new Promise((resolve) => {
    const overlay = el("div", "dialog-overlay");
    const box = el("div", "dialog");
    overlay.appendChild(box);

    box.appendChild(el("div", "dialog-title", "Waive this finding"));
    // `dialog-path` is this module's existing style for a quoted context line;
    // reused rather than adding a near-identical class for one dialog.
    box.appendChild(el("div", "dialog-path", message));
    const row = el("div", "dialog-row");
    const input = el("input", "dialog-name");
    input.type = "text";
    input.placeholder = "optional";
    row.append(el("label", "dialog-label", "Note:"), input);
    box.appendChild(row);

    const buttons = el("div", "dialog-buttons");
    buttons.append(button("Cancel", () => done(null)), button("Waive", () => done(input.value)));
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
        done(input.value);
      }
    }
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(overlay);
    input.focus();
  });
}

// promptPortWidthDialog asks for a multi-bit port's bit width on placement
// (FR-071e). The width is constrained to [min, max] (2–16); resolves to an
// integer in range, or null on cancel / out-of-range input.
export function promptPortWidthDialog(def, min, max) {
  return new Promise((resolve) => {
    const overlay = el("div", "dialog-overlay");
    const box = el("div", "dialog");
    overlay.appendChild(box);

    box.appendChild(el("div", "dialog-title", "Multi-bit port width"));
    const row = el("div", "dialog-row");
    const input = el("input", "dialog-name");
    input.type = "number";
    input.min = String(min);
    input.max = String(max);
    input.value = String(def);
    row.append(el("label", "dialog-label", `Width (bits, ${min}–${max}):`), input);
    box.appendChild(row);

    const buttons = el("div", "dialog-buttons");
    buttons.append(button("Cancel", () => done(null)), button("OK", onOk));
    box.appendChild(buttons);

    function onOk() {
      const n = parseInt(input.value, 10);
      done(Number.isInteger(n) && n >= min && n <= max ? n : null);
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

// designPropertiesDialog presents the design-level properties (FR-076b) — for
// now exactly one control: the primary-clock selector over the design's clock
// generator instances (by refdes, with the display label when set, FR-011b).
// Resolves to the chosen clock's refdes, or null on cancel or when the design
// has no clock generator (the selector is disabled with an explanatory note).
export function designPropertiesDialog(design) {
  return new Promise((resolve) => {
    const overlay = el("div", "dialog-overlay");
    const box = el("div", "dialog");
    overlay.appendChild(box);

    box.appendChild(el("div", "dialog-title", "Design properties"));

    const clocks = (design.components ?? []).filter(
      (c) => c.typeData?.renderType === "clock",
    );
    const row = el("div", "dialog-row");
    row.appendChild(el("label", "dialog-label", "Primary clock:"));
    const sel = el("select");
    for (const c of clocks) {
      const o = el("option");
      o.value = c.refdes;
      o.textContent = c.label ? `${c.refdes} (${c.label})` : c.refdes;
      if (c.refdes === design.primaryClock) o.selected = true;
      sel.appendChild(o);
    }
    sel.disabled = clocks.length === 0;
    row.appendChild(sel);
    box.appendChild(row);
    if (clocks.length === 0) {
      box.appendChild(
        el("div", "dialog-path", "This design has no clock generator."),
      );
    }

    const buttons = el("div", "dialog-buttons");
    buttons.append(
      button("Cancel", () => done(null)),
      button("OK", () => done(clocks.length ? sel.value : null)),
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
      } else if (e.key === "Enter") {
        e.stopPropagation();
        done(clocks.length ? sel.value : null);
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

// NC_PIN_LABEL is the reserved no-connect pin label (FR-062f): typing it as a
// pin's label in this dialog declares that pin unused, which places a no-connect
// mark on every instance of the part (FR-071i).
const NC_PIN_LABEL = "NC";

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
export function galPartYaml({ partnumber, description, inputs, olmcs, groups, behavior, id }) {
  // Emit an explicit, immutable id (FR-066e) so the created part keys stably even
  // if its part-number display name is later edited; matches the library files
  // and the server's derive-when-absent rule (deriveComponentID). An edit passes
  // the existing id (FR-066f): the id is what the update addresses and what
  // placed instances record, so renaming the part number must not disturb it.
  const lines = [
    `id: ${JSON.stringify(id ?? "type-" + partnumber)}`,
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
    // A pin labeled NC is a declared no-connect (FR-062f): it carries no signal
    // and can head no equation, so its OLMC direction is meaningless and it is
    // emitted as a plain input. The dialog disables the direction control to
    // match.
    const dir = o.name === NC_PIN_LABEL ? "in" : OLMC_DIRS.find((d) => d.kind === o.kind).dir;
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

// GAL_DIALOG_KEYS are the ComponentType fields the New/Edit GAL part dialog
// models. A part carrying anything else cannot be round-tripped — Save rewrites
// the whole file from these fields, so an unmodelled key would be silently
// dropped — and galPartFromType refuses it rather than reducing the definition
// to what the dialog happens to understand (FR-066f).
const GAL_DIALOG_KEYS = new Set([
  "id", "name", "renderType", "width", "height", "pins", "pinGroups",
  "behavior", "clock", "gal", "partnumber", "description", "projectLocal",
]);

// REG_EQ_RE finds the outputs a behavior block registers (`IO14.R = …`), which
// is the only thing distinguishing a "reg out" OLMC from a "comb out" one — both
// emit `dir: out`, and the difference shows up solely in whether galPartYaml
// emits the `clock:` line. A regex rather than compileBehavior so a part whose
// equations no longer compile still opens for repair (the live validator, not
// the loader, is what refuses to save it).
const REG_EQ_RE = /(^|\n)\s*\/?\s*([A-Za-z][A-Za-z0-9]*)\s*\.\s*R\s*=/g;

// galPartFromType maps a loaded GAL ComponentType back onto the dialog's fields
// (FR-066f), the inverse of galPartYaml. Returns {partnumber, description,
// inputs, olmcs, groups, behavior} — the exact shapes gather() produces, with
// group members by skeleton DIP number so a rename cannot break a group — or
// {refuse: reason} for a definition the dialog cannot reproduce exactly. Pure
// (no DOM): the round trip type → fields → galPartYaml is unit-testable.
export function galPartFromType(type) {
  if (type.gal !== "GAL22V10") {
    return { refuse: type.gal ? `this dialog edits GAL22V10 parts; ${type.name} is a ${type.gal}` : "not a GAL part" };
  }
  if ((type.renderType ?? "unit") !== "unit") return { refuse: `render type ${type.renderType}` };
  const extra = Object.keys(type).filter((k) => !GAL_DIALOG_KEYS.has(k));
  if (extra.length) {
    return { refuse: `the definition carries ${extra.join(", ")}, which this dialog does not model and would drop` };
  }
  if (type.width !== GAL22V10.outline[0] || type.height !== GAL22V10.outline[1]) {
    return { refuse: `a custom outline (${type.width}×${type.height}), which this dialog would overwrite` };
  }

  // Pins must map one-for-one onto the skeleton: same count, same DIP numbers,
  // same sides. Anything else is a pinout this dialog cannot present.
  const skeleton = [
    ...GAL22V10.inputs.map((p) => ({ meta: p, side: "left" })),
    ...GAL22V10.olmcs.map((p) => ({ meta: p, side: "right" })),
  ];
  const pins = type.pins ?? [];
  if (pins.length !== skeleton.length) {
    return { refuse: `${pins.length} pins; the GAL22V10 skeleton has ${skeleton.length}` };
  }
  const byNumber = new Map();
  for (const p of pins) {
    if (p.unit || p.desc) return { refuse: `pin ${p.name} carries per-pin data this dialog does not model` };
    if (p.number == null) return { refuse: `pin ${p.name} has no pin number` };
    byNumber.set(p.number, p);
  }
  for (const s of skeleton) {
    const p = byNumber.get(s.meta.number);
    if (!p) return { refuse: `no pin numbered ${s.meta.number}` };
    if (p.side !== s.side || p.position !== s.meta.pos) {
      return { refuse: `pin ${p.name} (${s.meta.number}) is not where the skeleton puts it` };
    }
  }

  const behavior = type.behavior ?? "";
  const registered = new Set();
  for (const m of behavior.matchAll(REG_EQ_RE)) registered.add(m[2]);

  const inputs = GAL22V10.inputs.map((meta) => ({ ...meta, name: byNumber.get(meta.number).name }));
  const olmcs = GAL22V10.olmcs.map((meta) => {
    const p = byNumber.get(meta.number);
    const kind =
      p.direction === "in" ? "in" : registered.has(p.name) ? "reg" : "comb";
    return { ...meta, name: p.name, kind };
  });

  // The clock declaration is derived, not authored (galPartYaml emits it iff some
  // OLMC is registered, naming pin 1): one that disagrees would be rewritten.
  const wantClock = olmcs.some((o) => o.kind === "reg") ? inputs[0].name : "";
  if ((type.clock ?? "") !== wantClock) {
    return {
      refuse: wantClock
        ? `clock: ${type.clock || "(none)"} — this dialog emits clock: ${wantClock} for a registered part`
        : `clock: ${type.clock} on a part with no registered output`,
    };
  }

  // Groups come back as skeleton DIP numbers (FR-066d), the representation the
  // pin-groups sub-dialog uses, so a label edit cannot orphan a member.
  const numberOf = new Map(pins.map((p) => [p.name, p.number]));
  const groups = [];
  for (const g of type.pinGroups ?? []) {
    const members = [];
    for (const label of g.pins ?? []) {
      const n = numberOf.get(label);
      if (n == null) return { refuse: `pin group ${g.name} names ${label}, which is not a pin of this part` };
      members.push(n);
    }
    groups.push({ name: g.name, members });
  }

  return {
    id: type.id,
    partnumber: type.partnumber ?? "",
    description: type.description ?? "",
    inputs,
    olmcs,
    groups,
    behavior,
  };
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
  if (m.ramFile) {
    memFields.push(`ramFile: ${JSON.stringify(m.ramFile)}`);
    memFields.push(`ramLoad: ${!!m.ramLoad}`);
  }

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

// newGalPartDialog authors a new GAL22V10 part (FR-066c) and — opened with
// `part`, the fields galPartFromType produced from an existing definition —
// edits one (FR-066f). One dialog, one set of fields, one validation gate; the
// two differ only in the title, the button label, and what the caller's submit
// does with the YAML (create vs. update, FR-007a). It collects the part number,
// description, per-pin labels, per-OLMC direction, groups, and behavior, then
// calls submit(yaml) — which persists and returns the ComponentType. A submit
// failure (duplicate part number, refused update, validation error) is shown
// inline and the dialog stays open. Resolves to the created/updated component,
// or null on cancel.
export function newGalPartDialog({ submit, part = null }) {
  return new Promise((resolve) => {
    const editing = part != null;
    const overlay = el("div", "dialog-overlay");
    const box = el("div", "dialog");
    overlay.appendChild(box);
    box.appendChild(
      el("div", "dialog-title", (editing ? "Edit" : "New") + " GAL part — GAL22V10"),
    );

    const pnInput = el("input", "dialog-name");
    pnInput.type = "text";
    pnInput.placeholder = "e.g. PC-DECODE-A";
    if (editing) pnInput.value = part.partnumber;
    const pnRow = el("div", "dialog-row");
    pnRow.append(el("label", "dialog-label", "Part number:"), pnInput);
    box.appendChild(pnRow);

    const descInput = el("input", "dialog-name");
    descInput.type = "text";
    descInput.placeholder = "one-line description (optional)";
    if (editing) descInput.value = part.description;
    const descRow = el("div", "dialog-row");
    descRow.append(el("label", "dialog-label", "Description:"), descInput);
    box.appendChild(descRow);

    // Scrollable pin region: inputs (labels) and OLMC pins (label + direction).
    const pins = el("div", "dialog-list galdlg-pins");
    box.appendChild(pins);

    pins.appendChild(el("div", "galdlg-section", "Inputs (pins 1–13)"));
    const inputFields = GAL22V10.inputs.map((p, i) => {
      const row = el("div", "galdlg-row");
      const tag = el("span", "galdlg-pin", `${p.number}${p.clock ? " CLK" : ""}`);
      const input = el("input", "dialog-name");
      input.type = "text";
      input.value = editing ? part.inputs[i].name : p.name;
      row.append(tag, input);
      pins.appendChild(row);
      return { meta: p, input };
    });

    pins.appendChild(el("div", "galdlg-section", "I/O — OLMC (pins 14–23)"));
    const olmcFields = GAL22V10.olmcs.map((o, i) => {
      const row = el("div", "galdlg-row");
      const tag = el("span", "galdlg-pin", String(o.number));
      const input = el("input", "dialog-name");
      input.type = "text";
      input.value = editing ? part.olmcs[i].name : o.name;
      const sel = el("select", "galdlg-dir");
      for (const d of OLMC_DIRS) {
        const opt = el("option", null, d.label);
        opt.value = d.kind;
        sel.appendChild(opt);
      }
      sel.value = editing ? part.olmcs[i].kind : "comb";
      row.append(tag, input, sel);
      pins.appendChild(row);
      return { meta: o, input, sel };
    });

    // Pin groups (FR-066d): edited in a sub-dialog; tracked by skeleton DIP number
    // so a later relabel can't break a group.
    let groups = editing ? part.groups : [];
    let subOpen = false; // suppress this dialog's Escape while a sub-dialog is open
    // NC pins are excluded from the pin-group picker (FR-062f): a no-connect
    // carries no bit, and the server rejects a group naming one.
    const currentPins = () =>
      [
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
      ].filter((p) => p.label !== NC_PIN_LABEL);
    const groupsRow = el("div", "dialog-row");
    const groupsSummary = el("span", "dialog-label", "no pin groups");
    const showGroups = () => {
      groupsSummary.textContent = groups.length
        ? `${groups.length} group(s): ${groups.map((g) => g.name).join(", ")}`
        : "no pin groups";
    };
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
        showGroups();
      }
    });
    groupsRow.append(groupsBtn, groupsSummary);
    box.appendChild(groupsRow);

    box.appendChild(el("div", "galdlg-section", "Behavior (GALasm)"));
    const behavior = el("textarea", "galdlg-behavior");
    behavior.placeholder = "; sum-of-products equations, e.g.\n; IO14 = I2 * /I3 + I4";
    if (editing) behavior.value = part.behavior;
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

    const createBtn = button(editing ? "Save" : "Create", onOk);
    const buttons = el("div", "dialog-buttons");
    buttons.append(button("Cancel", () => done(null)), createBtn);
    box.appendChild(buttons);

    // An OLMC labeled NC has no direction to choose (FR-062f): the control is
    // disabled so the dialog says what the emitted YAML does.
    function syncNcDirs() {
      for (const f of olmcFields) f.sel.disabled = f.input.value.trim() === NC_PIN_LABEL;
    }

    // Re-validate live as labels, directions, or the behavior change (FR-066c).
    behavior.addEventListener("input", validate);
    for (const f of inputFields) f.input.addEventListener("input", validate);
    for (const f of olmcFields) {
      f.input.addEventListener("input", () => {
        syncNcDirs();
        validate();
      });
      f.sel.addEventListener("change", validate);
    }
    syncNcDirs();
    showGroups(); // an edited part arrives with its groups already defined
    validate(); // initial Create/Save-enabled state

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
      const yaml = galPartYaml({ ...g, groups, behavior: behavior.value, id: part?.id });
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
  // A RAM save file is optional (FR-114g); when set it must be .bin/.hex.
  if (spec.kind === "ram" && spec.ramFile && !/\.(bin|hex)$/i.test(spec.ramFile)) {
    return "RAM save file must be .bin or .hex";
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
    let ramFile = null; // optional RAM persistent save file (FR-114g)
    let ramLoad = false; // seed the RAM from ramFile at start-up (FR-114g)
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
        // re-initialize the class-specific file controls on a switch (FR-114a):
        // ROM's content file and RAM's optional save file are both discarded.
        romFile = null;
        ramFile = null;
        ramLoad = false;
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

      // RAM-only optional persistent save file + load-on-start (FR-114g). Neither
      // gates Create — a RAM with no save file is the historical default.
      if (kind === "ram") {
        const fileRow = el("div", "dialog-row");
        const fileLabel = el("span", "memdlg-file", ramFile || "no save file (not persistent)");
        const chooseBtn = button("Choose file…", async () => {
          const res = await openFileDialog({
            mode: "save",
            startPath,
            title: "Choose RAM save file (.bin / .hex)",
            exts: ["bin", "hex"],
            saveExt: "bin",
            saveExts: ["bin", "hex"],
          });
          if (res) {
            ramFile = res.path;
            fileLabel.textContent = ramFile;
            validate();
          }
        });
        const clearBtn = button("Clear", () => {
          ramFile = null;
          ramLoad = false;
          loadChk.checked = false;
          fileLabel.textContent = "no save file (not persistent)";
          validate();
        });
        fileRow.append(el("label", "dialog-label", "Save file:"), chooseBtn, clearBtn, fileLabel);
        dyn.appendChild(fileRow);

        const loadRow = el("div", "dialog-row");
        const loadChk = el("input");
        loadChk.type = "checkbox";
        loadChk.checked = ramLoad;
        loadChk.addEventListener("change", () => {
          ramLoad = loadChk.checked;
        });
        const loadLbl = el("label", "memdlg-radio");
        loadLbl.append(loadChk, document.createTextNode("Load save file at start-up"));
        loadRow.append(el("label", "dialog-label", ""), loadLbl);
        dyn.appendChild(loadRow);
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
        ...(kind === "ram" && ramFile ? { ramFile, ramLoad } : {}),
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
// Open-mode dialogs start at the last directory viewed in any file dialog,
// persisted across sessions in localStorage (FR-052a); a stored dir that no
// longer lists falls back to the caller's startPath.
const LAST_DIR_KEY = "sim.lastDir";

function readLastDir() {
  try {
    return window.localStorage.getItem(LAST_DIR_KEY);
  } catch {
    return null;
  }
}

function writeLastDir(path) {
  try {
    window.localStorage.setItem(LAST_DIR_KEY, path);
  } catch {
    // quota/privacy-mode failure: degrade to startPath behavior (FR-052a)
  }
}

// EXPORT_FORMATS drives the File ▸ Export… format choice (FR-119). One entry
// per netlist backend; NDL is the only one so far — the dialog exists so later
// formats (e.g. KiCad) are additive.
export const EXPORT_FORMATS = [
  { id: "ndl", label: "NDL netlist (.ndl)", ext: "ndl" },
];

// exportFormatDialog asks which export format to write (FR-119). Resolves to
// an EXPORT_FORMATS entry, or null on cancel.
export function exportFormatDialog() {
  return new Promise((resolve) => {
    const overlay = el("div", "dialog-overlay");
    const box = el("div", "dialog");
    overlay.appendChild(box);

    box.appendChild(el("div", "dialog-title", "Export design"));
    box.appendChild(el("div", "dialog-path", "Format:"));
    const select = document.createElement("select");
    select.className = "dialog-input";
    for (const f of EXPORT_FORMATS) {
      const opt = document.createElement("option");
      opt.value = f.id;
      opt.textContent = f.label;
      select.appendChild(opt);
    }
    box.appendChild(select);

    const buttons = el("div", "dialog-buttons");
    buttons.append(button("Cancel", () => done(null)));
    buttons.append(
      button("Export", () => done(EXPORT_FORMATS.find((f) => f.id === select.value))),
    );
    box.appendChild(buttons);

    function done(result) {
      overlay.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve(result ?? null);
    }
    function onKey(e) {
      if (e.key === "Escape") {
        e.stopPropagation();
        done(null);
      } else if (e.key === "Enter") {
        e.stopPropagation();
        done(EXPORT_FORMATS.find((f) => f.id === select.value));
      }
    }
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(overlay);
    select.focus();
  });
}

// applySaveExt normalizes a save-dialog file name's extension. It appends the
// default `saveExt` only when the (trimmed) name doesn't already end in one of
// the acceptable extensions (`saveExts`, defaulting to just `[saveExt]`) —
// case-insensitively — so a picker allowing several (e.g. .bin/.hex for a RAM
// save file, FR-114g) honors a typed "x.hex" instead of doubling it to
// "x.hex.bin". A null `saveExt` appends nothing — the typed name is used
// verbatim (the New/Duplicate Project location prompt names a directory,
// §6.19). An empty name is returned unchanged (the caller rejects it). Pure.
export function applySaveExt(name, saveExt, saveExts = null) {
  if (!name) return name;
  const accept = saveExts && saveExts.length ? saveExts : saveExt ? [saveExt] : [];
  const lower = name.toLowerCase();
  if (accept.some((e) => lower.endsWith("." + e.toLowerCase()))) return name;
  return saveExt ? name + "." + saveExt : name;
}

// Project-aware generalizations (§6.19, FR-121): `allowDir` (open mode) lets
// OK with no file selected resolve to the listed directory itself, for Open
// Project's folder pick (FR-121b); `includeManifests` lists `*-manifest.json`
// files (excluded by default, FR-121a); `ignoreLastDir` starts at the caller's
// startPath even in open mode (the FR-121b main-design picker, §3.1 A11)
// while still updating the remembered directory; and `validate(path)` (save
// mode) runs before the FR-049b overwrite guard — a non-null return shows on
// an inline error line and keeps the dialog open (FR-121a/FR-121e).
export function openFileDialog({ mode, startPath, defaultName = "", title, exts = null, saveExt = "json", saveExts = null, allowDir = false, includeManifests = false, ignoreLastDir = false, validate = null } = {}) {
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
      nameInput.addEventListener("input", () => setError(""));
    }

    // Inline error line for the save-mode validate hook (§6.19).
    const errEl = el("div", "dialog-error");
    errEl.hidden = true;
    box.appendChild(errEl);
    function setError(msg) {
      errEl.textContent = msg;
      errEl.hidden = !msg;
    }

    const buttons = el("div", "dialog-buttons");
    buttons.append(
      button("Cancel", () => done(null)),
      button(mode === "save" ? "Save" : "Open", onOk),
    );
    box.appendChild(buttons);

    function onOk() {
      if (mode === "save") {
        const name = applySaveExt(nameInput.value.trim(), saveExt, saveExts);
        if (!name) return;
        const path = joinPath(currentPath, name);
        // The caller's validator runs before the overwrite guard (§6.19):
        // a rejection keeps the dialog open with an inline message.
        if (validate) {
          const problem = validate(path);
          if (problem) {
            setError(problem);
            return;
          }
        }
        // Confirm before clobbering an existing file (FR-049b).
        if (existingFiles.has(name) && !window.confirm(`"${name}" already exists. Overwrite?`)) {
          return;
        }
        done({ path });
      } else if (selectedFile) {
        done({ path: selectedFile, isDir: false });
      } else if (allowDir) {
        // No file selected: the pick is the listed directory itself (FR-121b).
        done({ path: currentPath, isDir: true });
      }
    }

    async function navigate(path, fallback = null) {
      let listing;
      try {
        listing = await listDir(path, exts, { includeManifests });
      } catch (e) {
        if (fallback != null) return navigate(fallback);
        pathLabel.textContent = "error: " + e.message;
        return;
      }
      currentPath = listing.path;
      writeLastDir(listing.path);
      selectedFile = null;
      setError("");
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
    const lastDir = mode === "open" && !ignoreLastDir ? readLastDir() : null;
    if (lastDir) navigate(lastDir, startPath);
    else navigate(startPath);
  });
}

// testVectorsPanel is the test-vector table editor (§6.16, FR-115): a docked,
// modeless panel in the bottom third of the canvas area (FR-115b) — not a modal.
// Columns are auto-derived from the open design (input switches → 0/1 cells; clock
// generators → 0/1/C cells, FR-115e; indicator bits → H/L/X cells; ports by
// direction, FR-115f); the user fills rows, Runs them against the slow simulator
// (pass/fail per cell, FR-115d), Captures golden outputs, and Loads/Saves a `.tv`
// sibling file (FR-115a). A clocked design runs sequentially (FR-115e). While the
// panel is open the design is read-only (FR-115h). The panel edits one associated
// `.tv` document (FR-115m): it binds the design's sibling name on open, auto-loads
// it, saves back to it without a dialog, and guards a close that would lose edits.
// It is a TAB of the docked panel area (FR-123, §6.16a): the dock owns the host's
// `hidden` — an open tab sitting behind the Console must stay open while hidden,
// which is what keeps the FR-115h lock and a held run alive — and the tab's ✕ is
// the close control, so the header carries none.
// Returns { open, requestClose, isOpen, isDirty, releaseHold }.
export function testVectorsPanel({ store, dataDir }) {
  const host = document.getElementById("vec-panel");
  let openFlag = false;
  let held = false; // this panel is publishing a held sim view (FR-115l)
  let holdListener = null; // build()'s hook to refresh its Stop button
  // The document (FR-115m): the associated `.tv` path, whether the table has
  // been edited since it was last written or read, the header element naming it,
  // and build()'s handle to the load/save it owns (null when nothing is bound).
  let docPath = null;
  let docDirty = false;
  let titleEl = null;
  let ops = null;
  // Live-column tracking (FR-115h). The design can change under an open panel
  // now that the panel does not lock it, so the panel watches the store: a
  // `designRev` change means the design was edited at all, and a change to the
  // column signature means the table's SHAPE must change with it. `pendingRows`
  // hands a reconciled table to the next build().
  let unsubscribe = null;
  let lastDesignRev = -1;
  let lastColSig = null;
  let pendingRows = null;
  const isOpen = () => openFlag;
  const isDirty = () => openFlag && docDirty;
  const docName = () => (docPath ? baseName(docPath) : "These test vectors");

  // busy serializes the two async transitions (FR-115m): a second Simulate ▸ Test
  // Vectors click while the auto-load is in flight, or while the unsaved-vectors
  // prompt is up, must not start a second one.
  let busy = false;

  async function open() {
    if (openFlag || busy) return;
    busy = true;
    try {
      openFlag = true;
      // The host's visibility is the dock's (FR-123, §6.16a): setting the open
      // flag opens the tab, makes it frontmost, and reveals the area. It imposes
      // no edit lock — the design stays editable underneath (FR-115h).
      store.setVectorPanelOpen(true);
      build();
      // Prime the live-column tracking from the design we just built against, so
      // the first notification cannot look like a change (FR-115h), then watch
      // for real ones for as long as the panel is open.
      lastDesignRev = store.state.designRev ?? 0;
      lastColSig = columnSignature(deriveColumns(store.design));
      unsubscribe = store.subscribe(syncToDesign);
      await adopt();
    } finally {
      busy = false;
    }
  }

  // requestClose tears the panel down, guarding unsaved vector edits first
  // (FR-115m). Returns false when the close was abandoned — the user cancelled,
  // or the save they asked for failed — leaving the panel open and the document
  // modified. The dock calls this for the tab's ✕ and for Simulate ▸ Test Vectors
  // on an already-frontmost tab (FR-123): closing stays the panel's business
  // precisely because it can be refused, and the dock never touches the open flag
  // itself, so a cancelled close redraws the identical strip.
  async function requestClose() {
    if (!openFlag) return true;
    if (busy) return false; // a transition is already in flight
    if (docDirty && ops) {
      busy = true;
      try {
        const answer = await confirmSaveDialog(docName());
        if (answer === "cancel") return false;
        if (answer === "save" && !(await ops.save())) return false;
      } finally {
        busy = false;
      }
    }
    openFlag = false;
    clearHeld(); // the held display does not outlive the panel (FR-115l)
    holdListener = null; // the Stop button goes away with the panel's DOM
    // Stop tracking the design (FR-115h): a closed panel has no table to keep
    // current, and the next open primes itself afresh.
    unsubscribe?.();
    unsubscribe = null;
    lastDesignRev = -1;
    lastColSig = null;
    pendingRows = null;
    ops = null;
    titleEl = null;
    docPath = null;
    docDirty = false;
    // A real close drops the DOM — which is exactly what distinguishes it from
    // being hidden behind another tab, where the host keeps everything (FR-123).
    // Clearing the open flag closes the tab and hands the front to the most
    // recently used remaining one; the dock hides the area if none remains.
    host.replaceChildren();
    store.setVectorPanelOpen(false);
    return true;
  }

  // adopt binds the panel to the design's sibling `.tv` file and loads it when it
  // already exists (FR-115m). Existence is probed by listing the directory rather
  // than by loading and catching: a design with no vectors yet is the ordinary
  // case and must not open with a 404 in the error line, while a file that is
  // there but unreadable still reports through loadFrom.
  async function adopt() {
    docPath = tvPathFor({
      project: store.state.project,
      savePath: store.state.savePath,
      designName: store.design.name,
      dataDir,
    });
    docDirty = false;
    refreshTitle();
    if (!ops) return; // no bindable columns — nothing to load into
    let found = false;
    try {
      const listing = await listDir(dirOfPath(docPath), ["tv"]);
      found = listing.entries.some((e) => !e.isDir && e.name === baseName(docPath));
    } catch (_) {
      found = false; // unlistable directory: treat it as "no vectors yet"
    }
    if (found) await ops.loadFrom(docPath);
  }

  // refreshTitle names the document in the panel header, carrying the same `*`
  // modified marker as the design-name indicator (FR-049a/FR-115m).
  function refreshTitle() {
    if (!titleEl) return;
    const name = docPath ? baseName(docPath) : "(unsaved)";
    titleEl.textContent = `Test Vectors — ${name}${docDirty ? " *" : ""}`;
  }

  function setDirty(flag) {
    if (docDirty === flag) return;
    docDirty = flag;
    refreshTitle();
  }

  // hold publishes a finished run's retained simulation as the canvas display
  // view (FR-115l) — the same shape createSim.run() publishes (§6.13), so the
  // canvas draws indicator values and conflict-red with no change of its own.
  // A hold is an application state: the tray reads "held" (FR-073) and the
  // toolbar's Run/Stop becomes a live Stop that releases it (FR-115h).
  function hold(sim) {
    if (!sim) return clearHeld();
    held = true;
    store.setSim({
      valueOfPin: sim.valueOfPin,
      valueOfLane: sim.valueOfLane, // so the probe reads a held run (FR-087c)
      conflictedConductors: sim.conflictedConductors,
    });
    store.setVectorHold(true);
    setAppState("held"); // FR-073
    holdListener?.();
  }

  // clearHeld drops the retained simulation view this panel published to the
  // canvas (FR-115l). It clears only its own: a view left behind by a stopped
  // interactive run (FR-085) belongs to the simulator and is not ours to wipe.
  // The interactive simulator cannot be running here — a hold and a live run are
  // still mutually exclusive (FR-115h), the toolbar's Run being the Stop that
  // releases a hold rather than a start — so restoring the tray to "editing" can
  // never stomp a "simulating"/"paused" state.
  function clearHeld() {
    if (!held) return;
    held = false;
    store.setSim(null);
    store.setVectorHold(false);
    setAppState("editing"); // FR-073
    holdListener?.();
  }

  // columnSignature reduces a derived column set to the string that changes
  // exactly when the table's shape or headings would (FR-115h). Identity is
  // (refdes,pin) — the pair reconcileVectors aligns on — plus the label, since a
  // relabel (FR-011b) changes a heading without moving a cell.
  function columnSignature(cols) {
    const part = (list, kind) =>
      (list ?? []).map((c) => `${kind}:${c.refdes}:${c.pin}:${c.label}`).join(",");
    return `${part(cols.inputs, "i")}|${part(cols.io, "b")}|${part(cols.outputs, "o")}`;
  }

  // syncToDesign is the panel's reaction to a design edit (FR-115h). It runs on
  // every store notification while the panel is open, and does nothing at all
  // unless the design actually changed — the store notifies for selections, tool
  // changes, and tab switches too, none of which concern the table.
  //
  // lastDesignRev is updated BEFORE anything else, because the work below
  // notifies the store again (clearHeld publishes a null sim view), which
  // re-enters this function; the early return then makes that a no-op.
  function syncToDesign() {
    if (!openFlag) return;
    const rev = store.state.designRev ?? 0;
    if (rev === lastDesignRev) return;
    lastDesignRev = rev;

    // Any design edit invalidates values on display: a held run's schematic
    // values and the table's pass/fail painting both describe a circuit that no
    // longer exists (FR-115h, the rule FR-085 applies to the interactive view).
    clearHeld();

    const cols = deriveColumns(store.design);
    const sig = columnSignature(cols);
    if (sig === lastColSig) {
      // The netlist changed but the table's shape did not: nothing to reconcile,
      // and the user's cells stay exactly as authored.
      ops?.clearResults();
      return;
    }
    lastColSig = sig;

    // The bound I/O changed. Align the live table to the new columns by
    // (refdes,pin), reusing the `.tv` load path verbatim (FR-115a): a surviving
    // column keeps its cells, a new one arrives at its default (FR-115p/FR-115i),
    // and a dropped one takes its cells with it.
    const prev = ops?.snapshot() ?? null;
    const { rows: aligned, warnings } = prev
      ? reconcileVectors(prev, cols)
      : { rows: [], warnings: [] };
    pendingRows = aligned;
    build(); // re-derives columns, clocked, stateful, hex groups, and the DOM
    // The rows genuinely changed shape, so the file on disk no longer matches
    // them: dirty the document (FR-115m) rather than let the user close the tab
    // and silently lose a table nothing on disk describes.
    setDirty(true);
    if (warnings.length) {
      ops?.note(`Columns follow the design: ${warnings.join("; ")}`);
    }
  }

  // build (re)populates the panel from the current design. Called on open, and
  // again by syncToDesign() whenever the design's bound I/O changes underneath
  // (FR-115h): re-running it is what keeps `columns`, `clocked`, `stateful`, the
  // hex groups, and the DOM consistent with each other, rather than patching
  // each one separately. Rows survive across a rebuild through `pendingRows`,
  // which the caller fills with the reconciled table.
  function build() {
    const design = store.design;
    const columns = deriveColumns(design);
    // Sequential mode (FR-115e): a stateful design (a scripted clock source or a
    // transparent latch, FR-079d) runs its rows in order on persistent state and
    // shows a persistent notice; only a clock source adds 0/1/C cells and the
    // power-on preamble. A clock source is a clock generator or a port marked as
    // one (FR-094f) — indistinguishable to the panel.
    const clocked = clockSources(design).length > 0;
    const stateful = isStateful(design);
    // Rows carried over from a column reconciliation (FR-115h), else one blank
    // row to fill. Consumed once: a later rebuild gets whatever is current then.
    const rows = pendingRows?.length ? pendingRows : [emptyRow(columns)];
    pendingRows = null;
    let runResults = null; // [{ cells, pass }] aligned to rows, or null when stale
    let selRow = null; // selected row index for Run to Row (FR-115l), or null
    let runToBtn = null; // the Run to Row button, enabled only with a selection

    host.replaceChildren();
    // Header: the document's name and its modified `*` (FR-115m), and no ✕ — the
    // close control is the TAB's (FR-123), so the tab can stay labeled by its kind
    // while the file name stays here, inside the tab. No Escape-to-close either:
    // Escape stays a canvas gesture (FR-115b).
    const header = el("div", "vec-header");
    titleEl = el("div", "vec-title"); // names the document (FR-115m)
    header.appendChild(titleEl);
    refreshTitle();
    host.appendChild(header);

    const box = el("div", "vec-body");
    host.appendChild(box);

    // Nothing to drive or observe: no switches, no indicators, and no ports of
    // any direction (in/out or a bidir three-state bus, FR-115i).
    if (columns.inputs.length === 0 && columns.outputs.length === 0 && columns.io.length === 0) {
      const base =
        "This design has no input switches, indicators, or ports to bind. Place input switches (inputs) and state indicators (outputs), or wire ports (a bidir port binds as a three-state bus column), then reopen Test Vectors.";
      box.appendChild(
        el(
          "div",
          "vec-empty",
          columns.warnings.length ? `${base} (${columns.warnings.join("; ")})` : base,
        ),
      );
      return;
    }

    const summary = el("div", "vec-summary");
    // Persistent sequential-mode notice (FR-115e); unlike noteEl it is never
    // overwritten.
    const modeEl = el(
      "div",
      "vec-mode",
      "Sequential design: rows run in order on one simulation and state persists between rows. " +
        (clocked
          ? "Clock cells take 0/1/C — C applies one clock pulse (the default for a new row). " +
            "A power-on reset preamble runs before row 1."
          : "A transparent latch holds its value across rows (level-sensitive, no clock)."),
    );
    modeEl.hidden = !stateful;
    const noteEl = el("div", "vec-note");
    noteEl.hidden = true;
    const errEl = el("div", "galdlg-error");
    errEl.hidden = true;

    // --- bit groups (FR-115k) ---
    // A multi-bit port or 8-wide indicator contributes a run of one-bit columns;
    // each such group renders as a single MSB-first hex cell (the default) or as
    // its individual bits, toggled from the column header. The choice is live
    // only — cells stay one symbol per bit, so nothing downstream changes.
    const BUCKETS = { in: columns.inputs, out: columns.outputs, io: columns.io };
    const groupsOf = {
      in: bitGroups(columns.inputs),
      out: bitGroups(columns.outputs),
      io: bitGroups(columns.io),
    };
    const hexMode = new Map(); // "kind:refdes" → boolean
    for (const kind of ["in", "out", "io"]) {
      for (const g of groupsOf[kind]) hexMode.set(`${kind}:${g.refdes}`, true);
    }
    const isHex = (kind, g) => hexMode.get(`${kind}:${g.refdes}`) === true;
    const cellsOf = (row, kind) => (kind === "in" ? row.in : kind === "out" ? row.out : (row.io ??= []));
    const sliceOf = (row, kind, g) => cellsOf(row, kind).slice(g.start, g.start + g.width);

    // planFor lays one bucket out as a sequence of render items — a single
    // column, or a group shown as one hex cell or as `width` bit cells. Header
    // and body both walk it, so they can never disagree on the column count.
    function planFor(kind) {
      const byStart = new Map(groupsOf[kind].map((g) => [g.start, g]));
      const items = [];
      for (let i = 0; i < BUCKETS[kind].length; ) {
        const g = byStart.get(i);
        if (g) {
          items.push({ kind, group: g, hex: isHex(kind, g) });
          i += g.width;
        } else {
          items.push({ kind, ci: i });
          i++;
        }
      }
      return items;
    }

    // --- table ---
    const table = el("table", "vec-table");
    const thead = el("thead");
    table.appendChild(thead);
    const tbody = el("tbody");
    table.appendChild(tbody);

    const tableWrap = el("div", "vec-tablewrap");
    tableWrap.appendChild(table);
    box.append(tableWrap, summary, modeEl, noteEl, errEl);

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

    // radixButton toggles one group between hex and per-bit cells (FR-115k).
    // Turning hex on is refused when some row has no hex form — the cells are
    // the author's, and are never rewritten to fit the display.
    function radixButton(kind, g) {
      const hex = isHex(kind, g);
      const b = button(hex ? "bits" : "hex", () => {
        if (!hex) {
          const bad = rows.findIndex((r) => groupToHex(sliceOf(r, kind, g), kind) === null);
          if (bad >= 0) {
            return showError(
              `${g.base} row ${bad + 1} has no hexadecimal form ` +
                `(a digit mixing X with H/L, or a row mixing drive and expect cells)`,
            );
          }
          errEl.hidden = true;
        }
        hexMode.set(`${kind}:${g.refdes}`, !hex);
        render();
      });
      b.classList.add("vec-radix");
      b.title = hex ? `Show ${g.base} as individual bits` : `Show ${g.base} as hexadecimal`;
      return b;
    }

    // renderHead draws the single header row from the plans, so a radix toggle
    // keeps the labels and the body in step. There is no IN/OUT/IO band above it
    // (FR-115q): the bucket tints on the labels themselves carry that boundary,
    // and the row it cost is worth more in a panel this short.
    function renderHead() {
      thead.replaceChildren();
      // Column labels: a collapsed group reads base[msb:0]; an expanded one keeps
      // its per-bit labels and carries the toggle on its first bit.
      const labRow = el("tr");
      labRow.appendChild(el("th", "vec-rownum", "#"));
      const cls = { in: "vec-collabel", out: "vec-collabel vec-out", io: "vec-collabel vec-io" };
      for (const kind of ["in", "out", "io"]) {
        for (const it of planFor(kind)) {
          if (!it.group) {
            labRow.appendChild(el("th", cls[kind], BUCKETS[kind][it.ci].label));
            continue;
          }
          const g = it.group;
          if (it.hex) {
            const th = el("th", cls[kind], `${g.base}[${g.width - 1}:0]`);
            th.title = `${g.width}-bit group, hexadecimal (bit ${g.width - 1} is the most significant)`;
            th.appendChild(radixButton(kind, g));
            labRow.appendChild(th);
          } else {
            for (let k = 0; k < g.width; k++) {
              const th = el("th", cls[kind], BUCKETS[kind][g.start + k].label);
              if (k === 0) th.appendChild(radixButton(kind, g));
              labRow.appendChild(th);
            }
          }
        }
      }
      labRow.appendChild(el("th", "vec-corner"));
      thead.appendChild(labRow);
    }

    // ioRoleClass tints an io cell by the role its symbol selects (FR-115i).
    const ioRoleClass = (v) =>
      v === "0" || v === "1" ? "io-drive" : v === "X" ? "io-inert" : "io-expect";

    // bitCell renders one single-bit cell — the per-column control, unchanged by
    // grouping: it is what a plain column and an expanded group both use.
    function bitCell(kind, ci, row, ri) {
      const col = BUCKETS[kind][ci];
      const cells = cellsOf(row, kind);
      const td = el("td", kind === "in" ? "vec-cell" : `vec-cell vec-${kind}`);
      let opts;
      if (kind === "in") opts = col.kind === "clock" ? ["0", "1", "C"] : ["0", "1"]; // C = one pulse (FR-115e)
      else if (kind === "out") opts = ["H", "L", "X"];
      else opts = ["0", "1", "H", "L", "X"];
      if (kind === "io") {
        td.classList.add(ioRoleClass(cells[ci]));
        // An io cell keeps its drop-down (FR-115o): five symbols spanning two
        // different roles read better from a list than from a cycle, where
        // reaching X can cost four wrong values — each one a live edit.
        const sel = mkSelect(opts, cells[ci]);
        sel.addEventListener("change", () => {
          cells[ci] = sel.value;
          td.classList.remove("io-drive", "io-expect", "io-inert");
          td.classList.add(ioRoleClass(sel.value));
          touch();
        });
        td.appendChild(sel);
      } else {
        // Input, clock, and output cells cycle forward through the column's
        // symbol order (FR-115o). A native <button> is focusable and activated by
        // Space/Enter, so the keyboard clause needs no key handler of ours; the
        // data-cell key lets renderBody restore focus across a rebuild (below).
        const b = el("button", "vec-cycle", cells[ci]);
        b.dataset.cell = `${kind}:${ri}:${ci}`;
        b.title = `${opts.join(" → ")} → ${opts[0]}`;
        b.addEventListener("click", () => {
          cells[ci] = nextSymbol(opts, cells[ci]);
          b.textContent = cells[ci];
          touch(); // an ordinary cell edit: dirties, clears results and any hold
        });
        td.appendChild(b);
      }
      if (kind === "in") return td;
      const status = el("span", "vec-status");
      td.appendChild(status);
      const res = runResults?.[ri];
      const cell = kind === "out" ? res?.cells[ci] : res?.io[ci];
      if (cell && cell.drive === undefined) {
        td.classList.add(cell.pass ? "pass" : "fail");
        if (!cell.pass) status.textContent = `got ${cell.actual}`;
      }
      return td;
    }

    // hexCell renders one collapsed group as a single MSB-first hex field
    // (FR-115k) — plus, for a bidirectional group, the row's role. Committing
    // writes the group's per-bit cells; a rejected value leaves them untouched.
    function hexCell(kind, g, row, ri) {
      const td = el("td", kind === "in" ? "vec-cell vec-hex" : `vec-cell vec-${kind} vec-hex`);
      const cur = groupToHex(sliceOf(row, kind, g), kind); // never null: enforceHexModes ran
      const role = cur?.role ?? null;
      const inp = el("input", "vec-hexinput");
      inp.type = "text";
      inp.size = groupDigits(g.width);
      inp.maxLength = groupDigits(g.width);
      inp.value = cur?.text ?? "";

      // write parses the field under `asRole` and, on success, replaces the
      // group's cells; on failure it reports and restores the shown value.
      function write(asRole) {
        const parsed = groupFromHex(inp.value, { kind, width: g.width, role: asRole });
        if (parsed.error) {
          showError(`${g.base}: ${parsed.error}`);
          inp.value = groupToHex(sliceOf(row, kind, g), kind, asRole)?.text ?? "";
          return false;
        }
        errEl.hidden = true;
        const cells = cellsOf(row, kind);
        parsed.cells.forEach((s, k) => {
          cells[g.start + k] = s;
        });
        // Normalize (a5 → A5, 5 → 05), reading the group back in the role the
        // field is being edited under — an all-X expect group shows XX, not the
        // empty field its *ignore* classification would give.
        inp.value = groupToHex(sliceOf(row, kind, g), kind, asRole)?.text ?? "";
        touch();
        return true;
      }

      if (kind === "io") {
        // Drive / Expect / Ignore for the whole group this row (FR-115k).
        const roleSel = el("select", "vec-select vec-hexrole");
        for (const [v, t] of [["drive", "Drive"], ["expect", "Expect"], ["ignore", "Ignore"]]) {
          const op = el("option", null, t);
          op.value = v;
          roleSel.appendChild(op);
        }
        roleSel.value = role ?? "ignore";
        const applyRole = (r) => {
          inp.disabled = r === "ignore";
          td.classList.remove("io-drive", "io-expect", "io-inert");
          td.classList.add(r === "drive" ? "io-drive" : r === "ignore" ? "io-inert" : "io-expect");
        };
        applyRole(roleSel.value);
        roleSel.addEventListener("change", () => {
          // Re-read the current text under the new role; an empty field takes the
          // role's neutral value rather than erroring.
          if (roleSel.value !== "ignore" && inp.value.trim() === "") {
            inp.value = roleSel.value === "expect" ? "X".repeat(groupDigits(g.width)) : "0";
          }
          if (!write(roleSel.value)) {
            roleSel.value = role ?? "ignore";
            return;
          }
          applyRole(roleSel.value);
        });
        td.appendChild(roleSel);
        inp.addEventListener("change", () => write(roleSel.value));
      } else {
        inp.addEventListener("change", () => write(null));
      }
      td.appendChild(inp);

      if (kind === "in") return td;
      // Results per group (FR-115d/FR-115k): green only when every bit passes;
      // a driven io group is stimulus and is not scored.
      const status = el("span", "vec-status");
      td.appendChild(status);
      const res = runResults?.[ri];
      if (res) {
        const scored = (kind === "out" ? res.cells : res.io).slice(g.start, g.start + g.width);
        if (scored.every((c) => c.drive === undefined)) {
          const pass = scored.every((c) => c.pass);
          td.classList.add(pass ? "pass" : "fail");
          if (!pass) status.textContent = `got ${groupActualHex(scored.map((c) => c.actual))}`;
        }
      }
      return td;
    }

    function renderBody() {
      // A cell edit clears stale results, which rebuilds tbody — that would drop
      // focus mid-fill and defeat FR-115o's keyboard clause, so remember which
      // cycling button held focus and restore it after the rebuild. The key is a
      // data attribute rather than an index closure precisely because the button
      // it lands on is a different element than the one that had focus.
      const active = document.activeElement;
      const focusKey = active && tbody.contains(active) ? (active.dataset?.cell ?? null) : null;
      tbody.replaceChildren();
      // A removed row must never leave the selection dangling past the end
      // (FR-115l); clamping keeps a selection alive as the table shrinks.
      if (selRow !== null && selRow >= rows.length) selRow = rows.length ? rows.length - 1 : null;
      rows.forEach((row, ri) => {
        const tr = el("tr");
        if (ri === selRow) tr.classList.add("vec-rowsel");
        // The row number is the selection handle (FR-115l): clicking it selects
        // the row Run to Row runs through, clicking it again deselects.
        const numTd = el("td", "vec-rownum", String(ri + 1));
        numTd.title = "Select this row (Run to Row)";
        numTd.addEventListener("click", () => {
          selRow = selRow === ri ? null : ri;
          renderBody();
        });
        tr.appendChild(numTd);
        for (const kind of ["in", "out", "io"]) {
          for (const it of planFor(kind)) {
            if (!it.group) tr.appendChild(bitCell(kind, it.ci, row, ri));
            else if (it.hex) tr.appendChild(hexCell(kind, it.group, row, ri));
            else {
              for (let k = 0; k < it.group.width; k++) {
                tr.appendChild(bitCell(kind, it.group.start + k, row, ri));
              }
            }
          }
        }
        const delTd = el("td", "vec-cell");
        const del = button("✕", () => {
          rows.splice(ri, 1);
          if (rows.length === 0) rows.push(emptyRow(columns));
          touch();
          renderBody();
        });
        del.title = "Delete row";
        delTd.appendChild(del);
        tr.appendChild(delTd);
        tbody.appendChild(tr);
      });
      if (runToBtn) runToBtn.disabled = selRow === null;
      // No match (the row was deleted, or the group collapsed to hex) leaves
      // nothing focused, which is the pre-FR-115o behavior and never an error.
      if (focusKey) {
        tbody.querySelector(`.vec-cycle[data-cell="${CSS.escape(focusKey)}"]`)?.focus();
      }
    }

    // render redraws header and body together — a radix toggle changes both.
    function render() {
      renderHead();
      renderBody();
    }

    // enforceHexModes drops any group to per-bit display whose cells have no
    // hexadecimal form (FR-115k) — a digit mixing X with H/L, or an io row
    // mixing drive and release cells. Capture and Load are the paths that can
    // produce such cells; they are never rewritten to fit the display. Returns
    // the base labels of the groups it dropped.
    function enforceHexModes() {
      const dropped = [];
      for (const kind of ["in", "out", "io"]) {
        for (const g of groupsOf[kind]) {
          if (!isHex(kind, g)) continue;
          if (rows.every((r) => groupToHex(sliceOf(r, kind, g), kind) !== null)) continue;
          hexMode.set(`${kind}:${g.refdes}`, false);
          dropped.push(g.base);
        }
      }
      return dropped;
    }

    // clearResults drops stale pass/fail painting after any edit and repaints,
    // and with it the held schematic display (FR-115l) — a held state that no
    // longer corresponds to the table would mislead.
    function clearResults() {
      clearHeld();
      if (!runResults) return;
      runResults = null;
      summary.textContent = "";
      renderBody();
    }

    // touch is what an edit to the table's *content* does (FR-115m): it marks the
    // document modified and drops the now-stale results. Replacing the table from
    // a file calls clearResults directly, so a load never dirties; presentational
    // changes (radix toggle, row selection) call neither.
    function touch() {
      setDirty(true);
      clearResults();
    }

    // --- actions ---
    // runThrough runs the table from the start through row `through` (null = the
    // last row, i.e. plain Run) and holds the resulting state on the schematic
    // (FR-115l). Both run buttons funnel through here — they differ only in
    // where the run stops.
    async function runThrough(through) {
      errEl.hidden = true;
      const doc = { inputs: columns.inputs, outputs: columns.outputs, io: columns.io, rows };
      const check = validateVectors(doc);
      if (!check.ok) return showError(check.errors[0]);
      try {
        // Flatten sub-designs/peer sheets first (FR-102/FR-103, §6.14); the
        // columns stay bound to the top sheet, whose components the FlatDesign
        // shares, and child ROMs are preloaded from the flat design.
        const flat = await flatten(design, loadDesign, { rootPath: store.state.savePath });
        const romContent = await loadRomContents(flat);
        const res = runVectors(flat, doc, { romContent, through });
        runResults = res.rows;
        const at =
          res.through < rows.length - 1
            ? ` — held at row ${res.through + 1} of ${rows.length}`
            : "";
        summary.textContent = `${res.passed} of ${res.total} rows passed${at}`;
        summary.className = "vec-summary " + (res.passed === res.total ? "ok" : "err");
        hold(res.sim); // publish the state the run ended in (FR-115l)
        renderBody();
      } catch (e) {
        clearHeld(); // a failed run must not leave an older state on display
        showError(`cannot run vectors: ${e.message}`);
      }
    }

    const onRun = () => runThrough(null);
    const onRunTo = () => (selRow === null ? undefined : runThrough(selRow));

    async function onCapture() {
      errEl.hidden = true;
      try {
        // Same flatten-first boundary as onRun (FR-102/FR-103, §6.14).
        const flat = await flatten(design, loadDesign, { rootPath: store.state.savePath });
        const romContent = await loadRomContents(flat);
        // Whole-table capture: an ordered pass for a sequential design (FR-115e),
        // independent rows for a combinational one.
        const cap = captureVectors(flat, columns, rows.map((r) => r.in), {
          romContent,
          rowsIo: rows.map((r) => r.io ?? []),
        });
        rows.forEach((row, i) => {
          row.out = cap.out[i];
          row.io = cap.io[i];
        });
        touch(); // Capture rewrites the expected cells — an edit (FR-115m)
        // A captured U/Z bit lands as X and can leave a group with no hex form
        // (FR-115k); such a group falls back to per-bit rather than being edited.
        const dropped = enforceHexModes();
        render();
        if (dropped.length) showNote(`Captured; showing ${dropped.join(", ")} as bits (no hexadecimal form)`);
      } catch (e) {
        showError(`cannot capture: ${e.message}`);
      }
    }

    // writeTo writes the table to `path` and makes it the panel's document
    // (FR-115m). Returns whether the write landed — the guarded close and Load
    // both refuse to proceed on a failed save.
    async function writeTo(path) {
      try {
        await saveVectorFile(path, serializeVectors({ inputs: columns.inputs, outputs: columns.outputs, io: columns.io, rows }));
        docPath = path;
        setDirty(false);
        refreshTitle(); // Save As renames the document even when the flag did not move
        showNote(`Saved ${baseName(path)}`);
        return true;
      } catch (e) {
        showError(`cannot save: ${e.message}`);
        return false;
      }
    }

    // Save writes the associated file outright: no dialog and no overwrite
    // confirmation, the name having been chosen once already (FR-115m). Only a
    // panel with no association at all (which adopt() precludes) falls back to
    // Save As.
    async function onSave() {
      errEl.hidden = true;
      return docPath ? writeTo(docPath) : onSaveAs();
    }

    // Save As picks a new name and re-points the association at it (FR-115m) —
    // the file dialog, and its overwrite guard (FR-049b), belong here.
    async function onSaveAs() {
      errEl.hidden = true;
      const res = await openFileDialog({
        mode: "save",
        startPath: docPath ? dirOfPath(docPath) : dataDir,
        defaultName: docPath ? baseName(docPath) : "vectors.tv",
        title: "Save test vectors as (.tv)",
        exts: ["tv"],
        saveExt: "tv",
      });
      if (!res) return false;
      return writeTo(res.path);
    }

    // loadFrom replaces the table from a `.tv` file and makes that file the
    // panel's document (FR-115m). Shared by the Load button and the auto-load
    // on open, so both reconcile, re-render, and report identically.
    async function loadFrom(path) {
      try {
        const obj = await loadVectorFile(path);
        const fileDoc = deserializeVectors(obj);
        const { rows: aligned, warnings } = reconcileVectors(fileDoc, columns);
        rows.length = 0;
        for (const r of aligned) rows.push(r);
        if (rows.length === 0) rows.push(emptyRow(columns));
        clearResults(); // not touch(): a load is not an edit (FR-115m)
        runResults = null;
        summary.textContent = "";
        docPath = path;
        setDirty(false);
        refreshTitle();
        // A loaded file may hold cells with no hex form (FR-115k) — those groups
        // show as bits.
        const dropped = enforceHexModes();
        render();
        const asBits = dropped.length ? `; showing ${dropped.join(", ")} as bits` : "";
        if (warnings.length) {
          showNote(`Loaded with ${warnings.length} warning(s): ${warnings.join("; ")}${asBits}`);
        } else {
          showNote(`Loaded ${baseName(path)}${asBits}`);
        }
        return true;
      } catch (e) {
        showError(`cannot load: ${e.message}`);
        return false;
      }
    }

    async function onLoad() {
      errEl.hidden = true;
      // Loading over a modified document is guarded exactly as a close is
      // (FR-115m) — it discards the table just as thoroughly.
      if (docDirty) {
        const answer = await confirmSaveDialog(docName());
        if (answer === "cancel") return;
        if (answer === "save" && !(await onSave())) return;
      }
      const res = await openFileDialog({
        mode: "open",
        startPath: docPath ? dirOfPath(docPath) : dataDir,
        title: "Open test vectors (.tv)",
        exts: ["tv"],
      });
      if (!res) return;
      await loadFrom(res.path);
    }

    // Publish this build()'s document operations so open() can auto-load,
    // requestClose() can save, and syncToDesign() can invalidate or re-align the
    // table, without any of them reaching into this closure (FR-115m/FR-115h).
    ops = {
      loadFrom,
      save: onSave,
      clearResults, // drop stale pass/fail painting after a design edit
      note: showNote, // report reconciliation warnings in the notice line
      // snapshot renders the LIVE table in `.tv` shape so reconcileVectors can
      // align it to a new column set — the same call a Load makes, with the
      // in-memory table playing the part of the file (FR-115h).
      snapshot: () =>
        serializeVectors({
          inputs: columns.inputs,
          outputs: columns.outputs,
          io: columns.io,
          rows,
        }),
    };

    // --- buttons ---
    const buttons = el("div", "dialog-buttons");
    const addBtn = button("+ Row", () => {
      rows.push(emptyRow(columns));
      touch();
      renderBody();
    });
    // +Dup (FR-115j): append a copy of the highest-numbered row, so a working
    // row can be extended by editing the duplicate rather than retyping it.
    const dupBtn = button("+Dup", () => {
      const last = rows[rows.length - 1];
      rows.push(last ? cloneRow(last) : emptyRow(columns));
      touch();
      renderBody();
    });
    dupBtn.title = "Duplicate the last row";
    // Run to Row (FR-115l): runs from the start through the selected row and
    // leaves that row's state on the schematic for inspection.
    runToBtn = button("Run to Row", onRunTo);
    runToBtn.title = "Run through the selected row and hold its state";
    runToBtn.disabled = selRow === null;
    // Stop (FR-115l) releases a hold. The toolbar's Run/Stop does the same
    // thing (§6.16); this is the copy beside the buttons that create a hold.
    const stopBtn = button("Stop", clearHeld);
    stopBtn.title = "Release the held state and clear the display";
    stopBtn.disabled = !held;
    holdListener = () => {
      stopBtn.disabled = !held;
    };
    buttons.append(
      addBtn,
      dupBtn,
      button("Capture", onCapture),
      button("Run", onRun),
      runToBtn,
      stopBtn,
      button("Load", onLoad),
      button("Save", onSave),
      button("Save As", onSaveAs),
    );
    box.appendChild(buttons);

    // --- helpers ---
    function showError(msg) {
      errEl.textContent = msg;
      errEl.hidden = false;
    }
    function showNote(msg) {
      noteEl.textContent = msg;
      noteEl.hidden = false;
    }

    render();
    // Surface any port-binding warnings from column derivation (FR-115f), e.g. a
    // bidir port skipped for want of a direction override.
    if (columns.warnings.length) {
      showNote(`${columns.warnings.length} port warning(s): ${columns.warnings.join("; ")}`);
    }
  }

  // releaseHold is the toolbar's entry point to the same release the panel's
  // Stop button performs (FR-115l); harmless when nothing is held. isDirty is
  // the page-unload guard's view of the document (FR-115m/FR-049a).
  return { open, requestClose, isOpen, isDirty, releaseHold: clearHeld };
}
