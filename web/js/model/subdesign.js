// Sub-designs, ports & off-sheet connectors (§6.14, requirements §3.22).
//
// A separately-saved design can be embedded in a higher-level design as a single
// component (a "sub-design instance"). Its external interface is the set of its
// ports (FR-095); embedding resolves that interface into a synthetic, in-memory
// ComponentType (never saved) so the whole pin/vertex/wire/netlist/render
// pipeline serves hierarchy unchanged — only render style, navigation, and
// flattening are new. This module owns the pure interface/synthesis helpers;
// flattening for the simulator (FR-102) lands in a later step.

import { nextRefNum } from "./design.js";
import { buildNets } from "./netlist.js";

// netContribDir inspects one net's non-port pins and reports the direction that
// net contributes to a port on it (FR-094c): "bidir" if any pin is itself
// bidirectional/three-state (a RAM/ROM data line), else "out" if a plain output
// pin drives it, else null (no driver — contributes the "in" default).
function netContribDir(net, byRefdes) {
  let driven = false;
  for (const key of net.pins) {
    const i = key.lastIndexOf(".");
    const inst = byRefdes.get(key.slice(0, i));
    const rt = inst?.typeData?.renderType;
    if (!inst || rt === "port" || rt === "portN") continue;
    const dir = inst.typeData?.pins?.find((p) => p.name === key.slice(i + 1))?.direction;
    if (dir === "bidir" || dir === "tristate") return "bidir";
    if (dir === "out") driven = true;
  }
  return driven ? "out" : null;
}

// aggregateDir folds per-net contributions into one direction (FR-094c): bidir
// if any net is bidir, else output if any is output-driven, else input (also the
// empty / all-unconnected case).
function aggregateDir(contribs) {
  if (contribs.includes("bidir")) return "bidir";
  if (contribs.includes("out")) return "out";
  return "in";
}

// classifyPortDir derives a 1-wide port's direction (FR-094c). A connector label
// *names* its net (FR-094a) — the connector vertex itself is not listed among the
// net's component pins — so the net is found by name (input when unconnected).
function classifyPortDir(nets, byRefdes, label) {
  if (!label) return "in";
  const net = nets.find((n) => n.name === label);
  if (!net) return "in";
  return aggregateDir([netContribDir(net, byRefdes)]);
}

// classifyPortNDir derives a multi-bit port's single direction (FR-071e/FR-094c)
// by aggregating across its bit nets. Unlike the 1-wide port, a portN's P pins
// *are* net members (joined through the snapped bus/wire), so each bit's net is
// found by the pin key `<refdes>.<Pi>`.
function classifyPortNDir(nets, byRefdes, refdes, pinNames) {
  const contribs = [];
  for (const name of pinNames) {
    const net = nets.find((n) => n.pins.includes(`${refdes}.${name}`));
    if (net) contribs.push(netContribDir(net, byRefdes));
  }
  return aggregateDir(contribs);
}

// portDirection derives one port's direction from the current design wiring
// (FR-094c). Used by the properties panel for a live read-only display. Handles
// both the 1-wide port (by label) and the multi-bit port (by its P pins).
export function portDirection(design, portRefdes) {
  const byRefdes = new Map((design.components ?? []).map((c) => [c.refdes, c]));
  const inst = byRefdes.get(portRefdes);
  const nets = buildNets(design, () => {});
  if (inst?.typeData?.renderType === "portN") {
    return classifyPortNDir(nets, byRefdes, portRefdes, (inst.typeData.pins ?? []).map((p) => p.name));
  }
  return classifyPortDir(nets, byRefdes, inst?.label);
}

// designInterface returns a child design's external interface (FR-095): one pin
// per distinct port label — across both 1-wide `port`s and multi-bit `portN`s
// (FR-071e) — carrying that label's width and its direction derived from the
// child's wiring (FR-094c), in a deterministic order (by label). The first port
// seen for a label wins on a width disagreement.
export function designInterface(childDesign) {
  // A child may be a minimal/partial object (no wires/vertices yet); give
  // buildNets the arrays it expects so derivation never throws.
  const nets = buildNets(
    { wires: [], buses: [], vertices: [], components: [], ...childDesign },
    () => {},
  );
  const byRefdes = new Map((childDesign.components ?? []).map((c) => [c.refdes, c]));
  const byLabel = new Map();
  for (const c of childDesign.components ?? []) {
    // Identify ports by renderType, not the `type` field — the latter is now the
    // library id (FR-066e), e.g. "type-port", not the bare "port".
    const rt = c.typeData?.renderType;
    if (rt !== "port" && rt !== "portN") continue;
    const label = c.label;
    if (label == null || label === "") continue;
    if (byLabel.has(label)) continue;
    if (rt === "portN") {
      // A portN contributes one width-N pin; N is its P pin-group size, and its
      // direction aggregates across the nets its P pins join.
      const pinNames = (c.typeData.pins ?? []).map((p) => p.name);
      byLabel.set(label, {
        label,
        dir: classifyPortNDir(nets, byRefdes, c.refdes, pinNames),
        width: pinNames.length,
      });
    } else {
      // A 1-wide port is always one bit (FR-094); it has no width field.
      byLabel.set(label, {
        label,
        dir: classifyPortDir(nets, byRefdes, label),
        width: 1,
      });
    }
  }
  return [...byLabel.values()].sort((a, b) =>
    a.label < b.label ? -1 : a.label > b.label ? 1 : 0,
  );
}

const IC_WIDTH = 6; // grid units; wide enough for interior pin labels
const CONNECTOR_WIDTH = 3; // a tall, narrow strip (FR-099)

// signalBits expands one interface signal into its one-bit pin names and, for a
// multi-bit signal, the pin group a matching-width bus snaps to (FR-095/FR-099).
// A pin is always one bit: width:1 → a single pin named by the label; width:N →
// pins `<label>0`..`<label>(N-1)` plus a group named `<label>`.
function signalBits(sig) {
  if ((sig.width ?? 1) <= 1) return { names: [sig.label], group: null };
  const names = Array.from({ length: sig.width }, (_, i) => `${sig.label}${i}`);
  return { names, group: { name: sig.label, pins: names } };
}

// synthTypeForInterface builds the in-memory synthetic ComponentType for an
// embedded sub-design (FR-099). Both render styles are plain rectangles, so the
// generic component renderer and the pin machinery work unchanged; only the pin
// layout differs:
//   "ic"        — inputs on the left, outputs on the right, bidir on the left.
//   "connector" — all interface pins ranked along the right edge, in label order.
// A multi-bit signal expands into N contiguous one-bit pins plus a pin group, so
// a matching bus snaps via the ordinary group machinery (FR-041/FR-042).
export function synthTypeForInterface(iface, render, name = "subdesign") {
  const pinGroups = [];
  const collect = (sig, side, pins) => {
    const { names, group } = signalBits(sig);
    for (const nm of names) pins.push({ name: nm, side, position: pins.length + 1, direction: sig.dir });
    if (group) pinGroups.push(group);
  };
  const withGroups = (type) => (pinGroups.length ? { ...type, pinGroups } : type);

  if (render === "connector") {
    const pins = [];
    for (const sig of iface) collect(sig, "right", pins);
    return withGroups({
      name,
      renderType: "unit",
      width: CONNECTOR_WIDTH,
      height: pins.length + 1,
      pins,
    });
  }
  // "ic": inputs (and bidir) left, outputs right; a signal's bits stay together.
  const left = [];
  const right = [];
  for (const sig of iface) {
    const toRight = sig.dir === "out";
    collect(sig, toRight ? "right" : "left", toRight ? right : left);
  }
  return withGroups({
    name,
    renderType: "unit",
    width: IC_WIDTH,
    height: Math.max(left.length, right.length) + 1,
    pins: [...left, ...right],
  });
}

// resolveSubDesigns fills in (or refreshes) the in-memory synthetic typeData of
// every sub-design instance from its child file (FR-098 loading). It is the async
// load-time pass run after deserialize, since the synthetic interface isn't saved
// (§6.14). `loadChild(childPath) → Promise<savedObject>` returns the child's
// parsed save object; designInterface reads its ports directly, so the child need
// not be fully deserialized. A child that fails to load yields a broken-link
// placeholder (FR-099a); a connection to an interface pin the child no longer
// exposes is left dangling and reported (FR-099b).
export async function resolveSubDesigns(design, loadChild, onReport = () => {}) {
  for (const inst of design.components) {
    if (inst.kind !== "subdesign") continue;
    try {
      const child = await loadChild(inst.childPath);
      inst.typeData = synthTypeForInterface(designInterface(child), inst.render, inst.type);
      delete inst.broken;
    } catch {
      inst.typeData = placeholderTypeFromWiring(design, inst);
      inst.broken = true;
      onReport(`sub-design ${inst.refdes}: cannot load ${inst.childPath}`);
      continue;
    }
    const have = new Set(inst.typeData.pins.map((p) => p.name));
    for (const v of design.vertices) {
      if (
        (v.kind === "pin" || v.kind === "connector") &&
        v.ref === inst.refdes &&
        !have.has(v.pin)
      ) {
        const gone = v.pin;
        v.kind = "free"; // dangling (FR-099b); v.x/v.y keep the last-known point
        delete v.ref;
        delete v.pin;
        onReport(`sub-design ${inst.refdes}: pin ${gone} is gone; left dangling`);
      }
    }
  }
}

// placeholderTypeFromWiring synthesizes a stand-in type for a sub-design whose
// interface is not (yet) resolved: its pins are exactly those the parent's wiring
// still references, so pin positions resolve and the wires render. Used both for
// a broken-link block (FR-099a, marked inst.broken) and, at load, to keep an
// as-yet-unresolved sub-design renderable (e.g. a recovered snapshot, §6.14).
export function placeholderTypeFromWiring(design, inst) {
  const names = [];
  for (const v of design.vertices) {
    if (
      (v.kind === "pin" || v.kind === "connector") &&
      v.ref === inst.refdes &&
      !names.includes(v.pin)
    ) {
      names.push(v.pin);
    }
  }
  const pins = names.map((name, i) => ({
    name,
    side: "left",
    position: i + 1,
    direction: "bidir",
  }));
  return { name: inst.type, renderType: "unit", width: 6, height: Math.max(2, pins.length + 1), pins };
}

// addSubDesignInstance embeds a child design as a sub-design instance (FR-098).
// It allocates an X-<n> refdes (a third series beside U and A, FR-098a; the same
// child may be embedded repeatedly), stores the live relative child path and the
// chosen render style, and attaches the synthetic interface type as in-memory
// typeData (recomputed on load, never saved — FR-098). `childName` is the child's
// base name, shown as the body label; `iface` is designInterface(child).
export function addSubDesignInstance(design, { childPath, render, iface, childName }, x, y) {
  const refdes = "X" + nextRefNum(design.components, /^X(\d+)$/);
  const inst = {
    refdes,
    type: childName,
    kind: "subdesign",
    childPath,
    render,
    x,
    y,
    rotation: 0,
    typeData: synthTypeForInterface(iface, render, childName),
    overrides: {},
  };
  design.components.push(inst);
  return inst;
}
