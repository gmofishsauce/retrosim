// Properties panel (§6.11, FR-020a, FR-020b): shows the selected component
// instance's type data (read-only) and lets the user override its propagation
// delays and declared properties for that instance only (FR-058). Edits
// dispatch setOverrideCmd through the store; the panel re-renders on every
// store notification.

import { setOverrideCmd, setSwitchStateCmd, setPortPropsCmd, setLabelCmd } from "../commands.js";
import { getVertex } from "../model/design.js";
import { portDirection } from "../model/subdesign.js";

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

function infoRow(label, value) {
  const row = el("div", "prop-row");
  row.append(el("span", "prop-label", label), el("span", "prop-value", value));
  return row;
}

// fmt renders a grid coordinate compactly (whole numbers bare, else two places).
function fmt(n) {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

// describeEndpoint resolves a conductor endpoint vertex to display text (FR-020d).
// Recomputed on every render so a renamed designator (FR-011b) is reflected.
function describeEndpoint(design, vertexId) {
  const v = getVertex(design, vertexId);
  if (!v) return "unconnected";

  // Component pin/connector: "<designator> <pin>".
  if (v.kind === "pin" || v.kind === "connector") {
    const inst = design.components.find((c) => c.refdes === v.ref);
    return `${inst?.label ?? v.ref} ${v.pin}`;
  }

  // Bus-breakout tap (FR-043a): a junction carrying a bit. Name it by the owning
  // bus's snapped pin-group (FR-042), falling back to the internal bus id.
  if (v.kind === "junction" && v.bit != null) {
    const bus = design.buses.find((b) =>
      b.path.some((p) => p.t === "node" && p.v === v.id),
    );
    const group = bus?.groupConnections?.[0]?.group ?? bus?.id ?? "bus";
    return `${group}[${v.bit}]`;
  }

  // Group-snapped bus endpoint (FR-042): a free vertex named by some bus's
  // groupConnections → "<designator> <group>".
  for (const b of design.buses) {
    const gc = (b.groupConnections ?? []).find((g) => g.vertex === v.id);
    if (gc) {
      const inst = design.components.find((c) => c.refdes === gc.instance);
      return `${inst?.label ?? gc.instance} ${gc.group}`;
    }
  }

  // A plain junction (FR-034) ties ≥2 conductors, so it is connected (FR-020d).
  if (v.kind === "junction") return `junction (${fmt(v.x)}, ${fmt(v.y)})`;

  // Dangling free end (FR-029).
  return `unconnected (${fmt(v.x)}, ${fmt(v.y)})`;
}

// docSection builds the read-only Documentation block (FR-105) from a type's
// documentation fields (FR-104), or returns null when the type carries none.
// The one-line description and datasheet link sit at the top; the per-pin roles
// live in a collapsed <details> so they never crowd the editable override fields.
function docSection(td) {
  const frag = document.createDocumentFragment();
  let any = false;

  if (td.description) {
    frag.appendChild(el("div", "prop-doc-desc", td.description));
    any = true;
  }

  const ds = td.datasheet;
  if (ds && ds.url) {
    const link = el("a", "prop-doc-link", ds.title || ds.vendor || "Datasheet");
    link.href = ds.url;
    link.target = "_blank";
    link.rel = "noopener";
    if (ds.vendor && ds.title) link.title = `${ds.vendor}: ${ds.title}`;
    const row = el("div", "prop-doc-row");
    row.appendChild(link);
    if (ds.rev) row.appendChild(el("span", "prop-doc-rev", ds.rev));
    frag.appendChild(row);
    any = true;
  }

  // Per-pin roles in a collapsed disclosure (the list can be long).
  const roles = (td.pins ?? []).filter((p) => p.desc);
  if (roles.length > 0) {
    const details = el("details", "prop-doc-details");
    details.appendChild(el("summary", null, "Pin roles"));
    const list = el("dl", "prop-doc-pins");
    for (const p of roles) {
      list.append(el("dt", null, p.name), el("dd", null, p.desc));
    }
    details.appendChild(list);
    frag.appendChild(details);
    any = true;
  }

  return any ? frag : null;
}

// initProperties wires the panel to the store. Returns nothing; lives for the
// app's lifetime.
export function initProperties({ container, store }) {
  function render() {
    container.replaceChildren();
    // The panel shows a single selected component; it is blank when the
    // selection is empty or holds more than one object (FR-020a/FR-016a).
    const sel = store.state.selection;
    const only = sel.length === 1 ? sel[0] : null;

    // A single selected wire or bus — or a single selected segment, which shows
    // its parent conductor (FR-031) — gets a read-only synthetic endpoint sheet
    // (FR-020d), generated dynamically from current design state.
    if (only && (only.kind === "wire" || only.kind === "bus" || only.kind === "segment")) {
      const design = store.design;
      const isWire =
        only.kind === "segment"
          ? design.wires.some((c) => c.id === only.id)
          : only.kind === "wire";
      const cond = (isWire ? design.wires : design.buses).find((c) => c.id === only.id);
      if (!cond) {
        container.appendChild(el("div", "prop-empty", "No component selected"));
        return;
      }
      const nodes = cond.path.filter((p) => p.t === "node");
      container.appendChild(el("div", "prop-title", isWire ? "Wire" : "Bus"));
      container.append(
        infoRow("From", describeEndpoint(design, nodes[0].v)),
        infoRow("To", describeEndpoint(design, nodes[nodes.length - 1].v)),
      );
      return;
    }

    const inst =
      only && only.kind === "component"
        ? store.design.components.find((c) => c.refdes === only.refdes)
        : null;
    if (!inst) {
      container.appendChild(el("div", "prop-empty", "No component selected"));
      return;
    }

    const td = inst.typeData;
    container.appendChild(el("div", "prop-title", inst.label ?? inst.refdes));
    container.append(
      // Display name from typeData (FR-005/FR-005b), not inst.type — the latter
      // is the internal library id (FR-066e).
      infoRow("Type", td.partnumber || td.name),
      infoRow("Size", `${td.width} × ${td.height}`),
      infoRow("Pins", String(td.pins.length)),
    );

    // Read-only documentation (FR-104, FR-105): always shown, never locked while
    // simulating since it edits nothing.
    const doc = docSection(td);
    if (doc) container.appendChild(doc);

    // The panel is read-only while a simulation runs (FR-087).
    const locked = store.state.simulating;

    // Editable designator label (FR-011b): free-form, duplicate-allowed text for
    // the displayed designator, defaulting to the refdes. Display-only — identity
    // stays the refdes — so no validation; a blank value clears it back to the
    // default. The text note shows no designator and so no field. Disabled while
    // simulating (FR-087), like the other edits.
    if (td.renderType !== "note") {
      const desRow = el("div", "prop-row");
      desRow.appendChild(el("label", "prop-label", "designator"));
      const desInput = el("input", "prop-input");
      desInput.type = "text";
      desInput.value = inst.label ?? inst.refdes;
      desInput.disabled = locked;
      desInput.addEventListener("change", () => {
        store.dispatch(setLabelCmd(inst.refdes, desInput.value));
      });
      desRow.appendChild(desInput);
      container.appendChild(desRow);
    }

    // Input switch state (FR-020c): a 1 / 0 selector for the switch's
    // per-instance state (inst.switchState), not an override. While simulating
    // the state is changed by clicking the switch instead (FR-087a), so the
    // control is disabled (locked).
    if (td.renderType === "switch") {
      container.appendChild(el("div", "prop-section", "State"));
      const row = el("div", "prop-row");
      row.appendChild(el("label", "prop-label", "state"));
      const select = el("select", "prop-input");
      for (const [val, text] of [["1", "1"], ["0", "0"]]) {
        const opt = el("option", null, text);
        opt.value = val;
        select.appendChild(opt);
      }
      const cur = inst.switchState === "1" ? "1" : "0";
      select.value = cur;
      select.disabled = locked;
      select.addEventListener("change", () => {
        store.dispatch(setSwitchStateCmd(inst.refdes, select.value));
      });
      row.appendChild(select);
      container.appendChild(row);
    }

    // Port interface fields (FR-094, §6.14): a port carries an editable signal
    // label (patched via setPortPropsCmd, disabled while simulating FR-087) and a
    // read-only derived direction (FR-094c). A 1-wide port is always one bit
    // (FR-094, no width); only the multi-bit portN shows a width — fixed at
    // placement (FR-071e), read-only.
    if (td.renderType === "port" || td.renderType === "portN") {
      container.appendChild(el("div", "prop-section", "Port"));

      const labelRow = el("div", "prop-row");
      labelRow.appendChild(el("label", "prop-label", "label"));
      const labelInput = el("input", "prop-input");
      labelInput.type = "text";
      labelInput.value = inst.label ?? "";
      labelInput.disabled = locked;
      labelInput.addEventListener("change", () => {
        const v = labelInput.value.trim();
        if (v === "") {
          render(); // reject empty label, restore display
          return;
        }
        store.dispatch(setPortPropsCmd(inst.refdes, { label: v }));
      });
      labelRow.appendChild(labelInput);
      container.appendChild(labelRow);

      // Direction is derived from the wiring (FR-094c) and updates live as the
      // panel re-renders on each store change. A definite (in/out) derivation is
      // read-only; only the genuinely ambiguous bidir case is user-settable via
      // the in/out/bidir override (FR-094d).
      const derivedDir = portDirection(store.design, inst.refdes);
      const dirRow = el("div", "prop-row");
      dirRow.appendChild(el("label", "prop-label", "direction"));
      if (derivedDir === "bidir") {
        const select = el("select", "prop-input");
        for (const val of ["in", "out", "bidir"]) {
          const opt = el("option", null, val);
          opt.value = val;
          select.appendChild(opt);
        }
        select.value = inst.dirOverride ?? "bidir";
        select.disabled = locked;
        select.addEventListener("change", () => {
          const v = select.value;
          store.dispatch(setPortPropsCmd(inst.refdes, { dirOverride: v === "bidir" ? null : v }));
        });
        dirRow.appendChild(select);
      } else {
        dirRow.appendChild(el("span", "prop-value", derivedDir));
      }
      container.appendChild(dirRow);

      // Only the multi-bit port has a width, fixed at placement (FR-071e), shown
      // read-only. A 1-wide port is always one bit (FR-094) — no width control.
      if (td.renderType === "portN") {
        const widthRow = el("div", "prop-row");
        widthRow.appendChild(el("label", "prop-label", "width"));
        widthRow.appendChild(el("span", "prop-value", String(inst.width ?? td.pins.length)));
        container.appendChild(widthRow);
      }
    }

    // overrideRow builds one editable numeric field whose value shadows the
    // type default via inst.overrides[group][key] (FR-020a/FR-020b/FR-058).
    function overrideRow(group, key, label, def, unit) {
      const ov = inst.overrides?.[group]?.[key];
      const overridden = ov != null;

      const row = el("div", "prop-row" + (overridden ? " overridden" : ""));
      row.appendChild(el("label", "prop-label", label));

      const input = el("input", "prop-input");
      input.type = "number";
      input.value = String(overridden ? ov : def);
      input.title = `type default: ${def} ${unit}`;
      input.disabled = locked;
      input.addEventListener("change", () => {
        const n = parseFloat(input.value);
        if (!Number.isFinite(n)) {
          render(); // reject invalid input, restore display
          return;
        }
        // Setting back to the type default clears the override.
        store.dispatch(setOverrideCmd(inst.refdes, group, key, n === def ? null : n));
      });
      row.appendChild(input);

      const reset = el("button", "prop-reset", "↺");
      reset.title = "Reset to type default";
      reset.disabled = !overridden || locked;
      reset.addEventListener("click", () =>
        store.dispatch(setOverrideCmd(inst.refdes, group, key, null)),
      );
      row.appendChild(reset);

      return row;
    }

    container.appendChild(el("div", "prop-section", "Propagation delays (ns)"));
    const delays = td.delays ?? {};
    const keys = Object.keys(delays);
    if (keys.length === 0) {
      container.appendChild(el("div", "prop-empty", "none defined for this type"));
    }
    for (const key of keys) {
      container.appendChild(overrideRow("delays", key, key, delays[key], "ns"));
    }

    // Declared properties (FR-020b), e.g. the clock's period/speed (FR-071a).
    const props = td.properties ?? [];
    if (props.length > 0) {
      container.appendChild(el("div", "prop-section", "Properties"));
      for (const p of props) {
        container.appendChild(
          overrideRow("props", p.name, `${p.name} (${p.unit})`, p.default, p.unit),
        );
      }
    }
  }

  store.subscribe(render);
  render();
}
