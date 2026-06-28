// In-browser canonical design model and pure operations on it (§6.6, §7.5).
// Mutations are normally driven by Command objects (store.js), but the low-level
// operations live here so they are unit-testable in isolation.

import { rotateOffset, isRedundantBend } from "../geometry.js";
import {
  gateInputCount,
  pinSlot,
  symbolFootprint,
  pinSlotOffset,
} from "../engine/symbols.js";

// Text-note layout (FR-071f), in grid units. NOTE_PAD/NOTE_LINE/NOTE_FONT are
// shared with the renderer (canvas.js) so the auto-sized box matches the drawn
// text. NOTE_CHAR is an approximate average glyph advance used only for sizing
// (the proportional font is not measured in the DOM-free model); it is generous
// so typical text does not overflow the box.
export const NOTE_PAD = 0.3; // inner margin per side
export const NOTE_LINE = 1.1; // line height
export const NOTE_FONT = 0.85; // glyph height
const NOTE_CHAR = 0.5; // average glyph advance (sizing only)
const NOTE_MIN_W = 4; // empty-note minimum footprint
const NOTE_MIN_H = 2;

// noteSize returns a note's auto-sized footprint in whole grid units (FR-071f):
// wide enough for its longest line and tall enough for its line count, never
// below the minimum.
export function noteSize(text) {
  const lines = (text || "").split("\n");
  const cols = lines.reduce((m, l) => Math.max(m, l.length), 0);
  return {
    width: Math.max(NOTE_MIN_W, Math.ceil(2 * NOTE_PAD + cols * NOTE_CHAR)),
    height: Math.max(NOTE_MIN_H, Math.ceil(2 * NOTE_PAD + lines.length * NOTE_LINE)),
  };
}

// createDesign returns an empty design (FR-004/FR-045). It mirrors the save
// shape (§7.2) plus non-persisted id counters.
export function createDesign(name) {
  return {
    formatVersion: 1,
    name,
    components: [],
    wires: [],
    buses: [],
    vertices: [],
    nextWireId: 1,
    nextBusId: 1,
    nextVertexId: 1,
  };
}

// nextRefNum returns one more than the highest designator matching `re` (whose
// first capture group is the number), so designators increment past gaps left by
// deletions (FR-011, FR-011a).
export function nextRefNum(components, re) {
  let max = 0;
  for (const c of components) {
    const m = re.exec(c.refdes);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

// typeIdentity is a component type's immutable library identity (FR-066e, §7.2):
// its `id`, divorced from the free-form display name (`partnumber`/`name`). This
// is what an instance records as its `type` and what keys the palette, placement
// lookup, simulator behavior cache, and Refresh Types. Synthetic, id-less types
// (the ADD sentinel and sub-design interface types, §6.14) fall back to `name`,
// which is their identity.
export function typeIdentity(type) {
  return type.id ?? type.name;
}

// addInstance places a component instance, assigning it a unique reference
// designator and a private copy of the type data (FR-011, FR-057). Built-in
// objects (FR-067) use a separate A-<n> series (FR-011a); ICs use U<n>, ignoring
// any trailing subunit letter so "U5A" counts as 5.
export function addInstance(design, type, x, y, rotation) {
  // A text note (FR-071f) is a pure annotation: it consumes neither a U- nor an
  // A-number and shows no designator, but still needs a unique internal key for
  // selection/move/persist, drawn from a separate N-<n> series (FR-011a).
  const refdes =
    type.renderType === "note"
      ? "N-" + nextRefNum(design.components, /^N-(\d+)$/)
      : type.builtin
        ? "A-" + nextRefNum(design.components, /^A-(\d+)$/)
        : "U" + nextRefNum(design.components, /^U(\d+)[A-Z]*$/);
  const inst = {
    refdes,
    type: typeIdentity(type),
    x,
    y,
    rotation,
    typeData: structuredClone(type),
    overrides: {},
  };
  // The input switch carries per-instance state (FR-071c), defaulting to 0 on
  // placement (two states only, 0 and 1).
  if (type.renderType === "switch") inst.switchState = "0";
  // A text note carries its per-instance text (FR-071f), empty on placement.
  if (type.renderType === "note") inst.text = "";
  // A port carries its interface fields (FR-094, §7.2): a label defaulting to the
  // refdes (so a fresh port is its own net until the user names it), direction,
  // and bit width. The optional off-sheet target (FR-101) is added in phase 4.
  // A 1-wide port is always one bit (FR-094): it carries a label (default refdes)
  // and a derived direction, but no width field.
  if (type.renderType === "port") {
    inst.label = refdes;
    inst.portDir = "in";
  }
  // A multi-bit port (FR-071e) carries a label (default refdes) and its chosen
  // bit width, fixed at placement. The width-driven pins/group/footprint are
  // already baked into `type` by the drop dialog (§6.14), so the bit width is the
  // pin count; the interface (FR-095) and derived direction (FR-094c) read it.
  if (type.renderType === "portN") {
    inst.label = refdes;
    inst.width = type.pins.length;
  }
  design.components.push(inst);
  return inst;
}

// addSubunitPackage drops a subunit-rendered package (FR-013a): it allocates one
// U-number and creates one sibling instance per functional unit (refdes U<n>A,
// U<n>B, …), each with a per-unit typeData (only that unit's pins, plus the
// symbol footprint from §6.8a). Units are stacked vertically so they don't
// overlap on drop. Returns the created instances (caller groups them as one undo
// step). Power/ground aside, all geometry comes from the symbol module.
export function addSubunitPackage(design, type, x, y) {
  const num = nextRefNum(design.components, /^U(\d+)[A-Z]*$/);
  const letters = [];
  for (const p of type.pins) if (!letters.includes(p.unit)) letters.push(p.unit);

  const created = [];
  let offsetY = 0;
  for (const letter of letters) {
    const td = subunitTypeData(type, letter);
    const fp = { width: td.width, height: td.height };
    const inst = {
      refdes: "U" + num + letter,
      type: type.name,
      x,
      y: y + offsetY,
      rotation: 0,
      typeData: td,
      overrides: {},
    };
    design.components.push(inst);
    created.push(inst);
    offsetY += fp.height + 1;
  }
  return created;
}

// subunitTypeData builds one sibling's per-unit type data from a subunit
// package type: only that unit's pins, plus the symbol footprint (§6.8a).
// Shared by addSubunitPackage and refreshInstance (FR-088).
function subunitTypeData(type, letter) {
  const td = structuredClone(type);
  td.pins = td.pins.filter((p) => p.unit === letter);
  td.unit = letter;
  const fp = symbolFootprint(type.renderAs, gateInputCount(td));
  td.width = fp.width;
  td.height = fp.height;
  return td;
}

// refreshInstance re-copies type data from the library's current definition
// into one placed instance (FR-088), preserving refdes/position/rotation/
// wiring and overrides; override keys the new definition no longer declares
// are dropped. Returns {ok: true}, or {skip: reason} without touching the
// instance when the new definition is structurally incompatible: renderType
// changed, or a pin currently referenced by a wire/bus vertex is absent (for
// subunit siblings, absent from this instance's unit) — the wire-endpoint
// contract (§7.1a) must stay intact.
export function refreshInstance(design, inst, libType) {
  const oldRender = inst.typeData.renderType ?? "unit";
  const newRender = libType.renderType ?? "unit";
  if (newRender !== oldRender) {
    return { skip: `render type changed (${oldRender} → ${newRender})` };
  }

  const td =
    newRender === "subunit"
      ? subunitTypeData(libType, inst.typeData.unit)
      : structuredClone(libType);

  const pinNames = new Set(td.pins.map((p) => p.name));
  for (const v of design.vertices) {
    if (
      (v.kind === "pin" || v.kind === "connector") &&
      v.ref === inst.refdes &&
      !pinNames.has(v.pin)
    ) {
      return { skip: `wired pin ${v.pin} is gone from the new definition` };
    }
  }

  inst.typeData = td;
  if (inst.overrides.delays) {
    const declared = new Set(Object.keys(td.delays ?? {}));
    for (const k of Object.keys(inst.overrides.delays)) {
      if (!declared.has(k)) delete inst.overrides.delays[k];
    }
    if (Object.keys(inst.overrides.delays).length === 0) delete inst.overrides.delays;
  }
  if (inst.overrides.props) {
    const declared = new Set((td.properties ?? []).map((p) => p.name));
    for (const k of Object.keys(inst.overrides.props)) {
      if (!declared.has(k)) delete inst.overrides.props[k];
    }
    if (Object.keys(inst.overrides.props).length === 0) delete inst.overrides.props;
  }
  return { ok: true };
}

// pinOffset returns a pin's unrotated offset (grid units) from the instance
// origin. For subunit components it comes from the schematic-symbol geometry
// (§6.8a); otherwise from the pin's side and position along that side (§6.7).
function pinOffset(typeData, pin) {
  if (typeData.renderAs) {
    const { role, slot } = pinSlot(typeData, pin);
    return pinSlotOffset(typeData.renderAs, gateInputCount(typeData), role, slot);
  }
  switch (pin.side) {
    case "left":
      return { x: 0, y: pin.position };
    case "right":
      return { x: typeData.width, y: pin.position };
    case "top":
      return { x: pin.position, y: 0 };
    case "bottom":
      return { x: pin.position, y: typeData.height };
    default:
      throw new Error(`pin ${pin.name}: invalid side ${pin.side}`);
  }
}

// pinWorldPos returns a pin's world (grid) coordinate, applying the instance's
// rotation. Wires reference the pin's vertex, which is recomputed from this when
// the instance moves or rotates, so connected segments stretch (FR-018, §7.1a).
export function pinWorldPos(instance, pinName) {
  const pin = instance.typeData.pins.find((p) => p.name === pinName);
  if (!pin) {
    throw new Error(`unknown pin ${pinName} on ${instance.refdes}`);
  }
  const off = pinOffset(instance.typeData, pin);
  const r = rotateOffset(off.x, off.y, instance.rotation);
  return { x: instance.x + r.x, y: instance.y + r.y };
}

// PIN_RADIUS is the FR-013 connection-bubble radius in grid units, drawn
// tangent to the body (center one radius outside the pin's grid point).
export const PIN_RADIUS = 0.25;

// sideOutward is the unit vector pointing away from the body for a pin's side,
// before instance rotation.
export function sideOutward(side) {
  switch (side) {
    case "left":
      return { x: -1, y: 0 };
    case "right":
      return { x: 1, y: 0 };
    case "top":
      return { x: 0, y: -1 };
    case "bottom":
      return { x: 0, y: 1 };
    default:
      return { x: 0, y: 0 };
  }
}

// pinVisualPos returns a pin's *visual attachment point* (FR-013d): the bubble
// center for bubbled pins (one radius outward of the grid point, rotation-
// aware), the plain grid point for subunit pins. Drawing and hot-region use
// only — the grid point (pinWorldPos) remains the electrical and persisted
// wire-connection coordinate (FR-021/FR-059).
export function pinVisualPos(instance, pinName) {
  const w = pinWorldPos(instance, pinName);
  if (instance.typeData.renderType === "subunit") return w;
  const pin = instance.typeData.pins.find((p) => p.name === pinName);
  const out = sideOutward(pin.side);
  const r = rotateOffset(out.x, out.y, instance.rotation);
  return { x: w.x + r.x * PIN_RADIUS, y: w.y + r.y * PIN_RADIUS };
}

// BUS_BRACE_DEPTH is how far (grid units) a group-snap brace's apex juts beyond
// the group's pins (FR-042a). Integer so the apex stays on the grid.
export const BUS_BRACE_DEPTH = 2;

// busGroupBrace computes the curly-brace geometry for a bus snapped to the pins
// `pinNames` (a connection's claimed block, FR-041c — a sub-range of a group or a
// whole group) on instance `inst` (FR-042a): `a` and `b` are the visual attachment
// points of the block's two outermost pins (the brace tips), `apex` is the brace's
// point where the bus terminates, and `out` is the outward unit normal (rotation-
// aware). The apex's position along the pin row is taken from the block's **middle
// pin** (`floor(k/2)`), not the tip midpoint, so it lands on a grid point even when
// the block has an even pin count — the brace halves are then slightly asymmetric.
// Combined with the integer BUS_BRACE_DEPTH (and components always being on grid),
// the apex is a grid intersection. Pure geometry; used by the renderer and to place
// the snapped bus endpoint. The block's pins are assumed colinear along one edge.
export function busGroupBrace(inst, pinNames) {
  const first = inst.typeData.pins.find((p) => p.name === pinNames[0]);
  const o = sideOutward(first?.side);
  const out = rotateOffset(o.x, o.y, inst.rotation);
  // Rank the pins along the pin row (tangent, perpendicular to outward).
  const t = { x: -out.y, y: out.x };
  const named = pinNames.map((name) => ({ name, v: pinVisualPos(inst, name) }));
  named.sort((m, n) => m.v.x * t.x + m.v.y * t.y - (n.v.x * t.x + n.v.y * t.y));
  const a = named[0].v;
  const b = named[named.length - 1].v;
  // Apex on the grid: anchored at the middle pin's grid point, BUS_BRACE_DEPTH out.
  const g = pinWorldPos(inst, named[Math.floor(named.length / 2)].name);
  const apex = { x: g.x + out.x * BUS_BRACE_DEPTH, y: g.y + out.y * BUS_BRACE_DEPTH };
  return { a, b, apex, out };
}

// setOverride sets or clears a per-instance override (FR-020a/FR-020b/FR-058).
// `group` selects the override kind (§7.2): "delays" shadows the type's
// `delays[key]`, "props" shadows the default of the declared property `key`.
// Values are stored as `inst.overrides[group][key]`; a value of null clears the
// override, reverting to the type default.
export function setOverride(design, refdes, group, key, value) {
  if (group !== "delays" && group !== "props") {
    throw new Error(`unknown override group ${group}`);
  }
  const inst = design.components.find((c) => c.refdes === refdes);
  if (!inst) throw new Error(`no such component ${refdes}`);
  if (value === null) {
    if (inst.overrides[group]) {
      delete inst.overrides[group][key];
      if (Object.keys(inst.overrides[group]).length === 0) delete inst.overrides[group];
    }
    return;
  }
  if (!inst.overrides[group]) inst.overrides[group] = {};
  inst.overrides[group][key] = value;
}

// --- Connectivity: vertices and wires (§7.1a, §7.2) ---

// getVertex returns the vertex with the given id, or null.
export function getVertex(design, id) {
  return design.vertices.find((v) => v.id === id) ?? null;
}

// addVertex creates and registers a vertex with a fresh id.
function addVertex(design, props) {
  const v = { id: "v" + design.nextVertexId++, ...props };
  design.vertices.push(v);
  return v;
}

// vertexWorld returns a vertex's world coordinate. For pin vertices the position
// is DERIVED from the instance (so wires stretch when the instance moves/rotates,
// FR-018); junction/free vertices carry their own authoritative position (§7.1a).
export function vertexWorld(design, v) {
  if (v.kind === "pin" || v.kind === "connector") {
    const inst = design.components.find((c) => c.refdes === v.ref);
    if (!inst) throw new Error(`${v.kind} vertex ${v.id} references missing ${v.ref}`);
    return pinWorldPos(inst, v.pin);
  }
  return { x: v.x, y: v.y };
}

// findPinVertex returns the existing vertex for a component pin (or a port's
// connector point, §6.14), or null. A pin has at most one vertex; fan-out is
// multiple wires sharing it (A2).
function findPinVertex(design, refdes, pin) {
  return (
    design.vertices.find(
      (v) =>
        (v.kind === "pin" || v.kind === "connector") &&
        v.ref === refdes &&
        v.pin === pin,
    ) ?? null
  );
}

// resolveEndpoint turns an endpoint spec into a vertex, creating pin/free
// vertices as needed and reusing an existing pin vertex (for fan-out).
// Specs: {kind:"pin",refdes,pin} | {kind:"free",x,y} | {kind:"vertex",id}.
function resolveEndpoint(design, spec) {
  switch (spec.kind) {
    case "vertex": {
      const v = getVertex(design, spec.id);
      if (!v) throw new Error(`no such vertex ${spec.id}`);
      return v;
    }
    case "pin": {
      const existing = findPinVertex(design, spec.refdes, spec.pin);
      if (existing) return existing;
      const inst = design.components.find((c) => c.refdes === spec.refdes);
      if (!inst) throw new Error(`no such component ${spec.refdes}`);
      const w = pinWorldPos(inst, spec.pin);
      // A port's connection point is a `connector` vertex (FR-094, §7.1a): it
      // behaves like a pin vertex (position derived from the instance) but the
      // netlist unions same-label connectors into one net (§6.6 step 6).
      const kind = inst.typeData?.renderType === "port" ? "connector" : "pin";
      return addVertex(design, {
        kind,
        ref: spec.refdes,
        pin: spec.pin,
        x: w.x,
        y: w.y,
      });
    }
    case "free":
      return addVertex(design, { kind: "free", x: spec.x, y: spec.y });
    default:
      throw new Error(`bad endpoint kind ${spec.kind}`);
  }
}

// addWire creates a wire between two endpoints (FR-027). Its path is two node
// points referencing the endpoint vertices (A2), with any initial interior
// bends between them — the proposed route's corners (FR-027c), ordinary bend
// points thereafter; more are added later by editing. A degenerate wire whose
// endpoints resolve to the same vertex (e.g. a pin to itself) is rejected: it
// would be invisible, un-hit-testable, and would inflate that pin's net
// membership (§6.6).
export function addWire(design, a, b, bends = []) {
  const va = resolveEndpoint(design, a);
  const vb = resolveEndpoint(design, b);
  if (va === vb) throw new Error("wire endpoints resolve to the same vertex");
  const wire = {
    id: "w" + design.nextWireId++,
    path: [
      { t: "node", v: va.id },
      ...bends.map((p) => ({ t: "bend", x: p.x, y: p.y })),
      { t: "node", v: vb.id },
    ],
  };
  design.wires.push(wire);
  return wire;
}

// addBus creates a bus (a multi-bit conductor) between two endpoints (FR-035).
// A bus carries its width and, later, snap-connection metadata and per-bit names
// (FR-037/060). Path and endpoint handling mirror wires.
export function addBus(design, a, b, width, bends = []) {
  const va = resolveEndpoint(design, a);
  const vb = resolveEndpoint(design, b);
  if (va === vb) throw new Error("bus endpoints resolve to the same vertex");
  const bus = {
    id: "b" + design.nextBusId++,
    path: [
      { t: "node", v: va.id },
      ...bends.map((p) => ({ t: "bend", x: p.x, y: p.y })),
      { t: "node", v: vb.id },
    ],
    width,
    groupConnections: [],
    bitNames: null,
  };
  design.buses.push(bus);
  return bus;
}

// setBusWidth changes a bus's width (FR-038). Per-bit names that no longer match
// the new width are dropped (they will be re-adopted on a later snap, FR-037b).
export function setBusWidth(design, busId, width) {
  const bus = design.buses.find((b) => b.id === busId);
  if (!bus) throw new Error(`no such bus ${busId}`);
  bus.width = width;
  if (bus.bitNames && bus.bitNames.length !== width) bus.bitNames = null;
}

// usedGroupPins returns the set of `groupName` member-pin names on instance
// `refdes` already claimed by some bus's group connection (FR-041c): a pin is
// "used" if it appears in any groupConnection bitMap for that instance+group,
// across every bus.
function usedGroupPins(design, refdes, groupName) {
  const used = new Set();
  for (const b of design.buses) {
    for (const gc of b.groupConnections ?? []) {
      if (gc.instance === refdes && gc.group === groupName) {
        for (const name of gc.bitMap) used.add(name);
      }
    }
  }
  return used;
}

// groupFreeBlock returns the pack-low pin block a width-`width` bus would claim on
// `group` of instance `refdes` (FR-041c), or null if none fits. Scanning the
// group's pins in declared bit order and skipping pins already claimed
// (usedGroupPins), it returns the first `width` pins of the lowest contiguous run
// of unconnected pins that is at least `width` long. `width == null` (a fresh
// width-less bus, FR-042c) returns the lowest non-empty free run entire, whatever
// its size. Pure given the design snapshot. Throws if the group names a pin the
// type lacks.
export function groupFreeBlock(design, refdes, group, width) {
  const inst = design.components.find((c) => c.refdes === refdes);
  for (const name of group.pins) {
    if (!inst?.typeData.pins.some((p) => p.name === name)) {
      throw new Error(`group ${group.name}: unknown pin ${name}`);
    }
  }
  const used = usedGroupPins(design, refdes, group.name);
  let run = [];
  for (const name of group.pins) {
    if (used.has(name)) {
      if (width == null && run.length) return run; // lowest free run, any size
      run = [];
      continue;
    }
    run.push(name);
    if (width != null && run.length === width) return run; // pack-low claim
  }
  if (width == null) return run.length ? run : null;
  return null;
}

// groupsAcceptingBus returns the pin groups of `inst` that can accept a width-
// `width` bus, each paired with its pack-low claimed block: [{ group, block }]
// (FR-041/FR-041c). `width == null` (fresh bus, FR-042c) matches any group with a
// free run. Order follows the type's declared groups.
export function groupsAcceptingBus(design, inst, width) {
  const out = [];
  for (const group of inst.typeData.pinGroups ?? []) {
    const block = groupFreeBlock(design, inst.refdes, group, width);
    if (block) out.push({ group, block });
  }
  return out;
}

// snapBusGroup connects a bus endpoint to a component's pin group (FR-042): it
// claims the pack-low free block for the bus width (groupFreeBlock, FR-041c) and
// records a GroupConnection binding bus bit i to block[i]. The block is recomputed
// from current design state, so sequential snaps in one commit pack correctly. On
// the first snap of an as-yet-unnamed bus, the bus adopts the block's pin names in
// bit order (FR-037b).
export function snapBusGroup(design, busId, vertexId, instanceRefdes, groupName) {
  const bus = design.buses.find((b) => b.id === busId);
  if (!bus) throw new Error(`no such bus ${busId}`);
  const inst = design.components.find((c) => c.refdes === instanceRefdes);
  if (!inst) throw new Error(`no such component ${instanceRefdes}`);
  const group = (inst.typeData.pinGroups ?? []).find((g) => g.name === groupName);
  if (!group) throw new Error(`${instanceRefdes} has no pin group ${groupName}`);
  const block = groupFreeBlock(design, instanceRefdes, group, bus.width);
  if (!block) {
    throw new Error(
      `group ${groupName} has no free ${bus.width}-pin block for the bus`,
    );
  }
  bus.groupConnections.push({
    vertex: vertexId,
    instance: instanceRefdes,
    group: groupName,
    bitMap: block,
  });
  if (!bus.bitNames) bus.bitNames = [...block];
  return bus;
}

// setBusBitNames sets a bus's per-bit signal names (FR-037b); pass null to clear.
// names, when given, must have length equal to the bus width.
export function setBusBitNames(design, busId, names) {
  const bus = design.buses.find((b) => b.id === busId);
  if (!bus) throw new Error(`no such bus ${busId}`);
  if (names != null && names.length !== bus.width) {
    throw new Error(`expected ${bus.width} bit names, got ${names.length}`);
  }
  bus.bitNames = names == null ? null : [...names];
}

// breakoutBit taps a single bit of a bus and routes it on as an ordinary
// single-bit wire (FR-043a/FR-043b). It inserts a junction vertex at (x,y) on
// segment segIndex of the bus with `bit` set to the tapped lane, then starts a
// wire from that junction to dest, with any `bends` as its interior corners. The
// wire becomes electrically part of that bus bit's net (FR-037a), derived by
// buildNets. Returns the new wire. (A breakout *started* on a bus passes no
// bends — straight, FR-043a; a wire *terminated* on a bus passes the drawn
// route's corners, FR-043b, ordered junction→dest.)
export function breakoutBit(design, busId, segIndex, x, y, bit, dest, bends = []) {
  const bus = design.buses.find((b) => b.id === busId);
  if (!bus) throw new Error(`no such bus ${busId}`);
  if (bit < 0 || bit >= bus.width) {
    throw new Error(`bit ${bit} out of range (0..${bus.width - 1})`);
  }
  const j = branchWire(design, bus, segIndex, x, y);
  j.bit = bit;
  return addWire(design, { kind: "vertex", id: j.id }, dest, bends);
}

// deleteBus removes a bus and runs the connectivity cleanup (FR-033a).
export function deleteBus(design, busId) {
  const i = design.buses.findIndex((b) => b.id === busId);
  if (i < 0) throw new Error(`no such bus ${busId}`);
  design.buses.splice(i, 1);
  cleanup(design);
}

// insertBend splits segment segIndex of a wire/bus path by inserting an interior
// bend point at (x,y) (FR-031). A path of N points has N-1 segments; segIndex is
// in [0, N-2]. Returns the new bend's path index.
export function insertBend(wire, segIndex, x, y) {
  const segments = wire.path.length - 1;
  if (segIndex < 0 || segIndex >= segments) {
    throw new Error(`segment ${segIndex} out of range (0..${segments - 1})`);
  }
  const at = segIndex + 1;
  wire.path.splice(at, 0, { t: "bend", x, y });
  return at;
}

// branchWire starts a new branch from a point on segment segIndex of a host
// wire/bus (FR-034). It creates a junction vertex at (x,y) and inserts it into
// the host path as an interior node, then returns the junction so the caller can
// start a new wire from it. The junction is an electrical tie (FR-034b).
export function branchWire(design, hostWire, segIndex, x, y) {
  const segments = hostWire.path.length - 1;
  if (segIndex < 0 || segIndex >= segments) {
    throw new Error(`segment ${segIndex} out of range (0..${segments - 1})`);
  }
  const j = addVertex(design, { kind: "junction", x, y });
  hostWire.path.splice(segIndex + 1, 0, { t: "node", v: j.id });
  return j;
}

// branchAtPathPoint turns an existing interior path point into a junction: a bend
// is promoted to a junction node at its coordinate; an existing junction node is
// reused. Endpoints (pin/free nodes) cannot be branched this way. Returns the
// junction vertex (§6.6).
export function branchAtPathPoint(design, hostWire, index) {
  const p = hostWire.path[index];
  if (!p) throw new Error(`no path point at index ${index}`);
  if (p.t === "bend") {
    const j = addVertex(design, { kind: "junction", x: p.x, y: p.y });
    hostWire.path[index] = { t: "node", v: j.id };
    return j;
  }
  const v = getVertex(design, p.v);
  if (v && v.kind === "junction") return v;
  throw new Error(`cannot branch at a ${v ? v.kind : "missing"} endpoint`);
}

// moveBend repositions an interior bend point (FR-032). The index must reference
// a bend, not an endpoint node.
export function moveBend(wire, index, x, y) {
  const p = wire.path[index];
  if (!p || p.t !== "bend") {
    throw new Error(`path index ${index} is not a bend`);
  }
  p.x = x;
  p.y = y;
}

// moveVertex repositions a junction or free vertex (FR-032a). Pin/connector
// vertices are derived from their instance and cannot be moved this way. The
// vertex is the single shared copy of the point's grid position (§7.1a), so
// every conductor referencing it follows — keeping a branch connected.
export function moveVertex(design, vertexId, x, y) {
  const v = getVertex(design, vertexId);
  if (!v) throw new Error(`no vertex ${vertexId}`);
  if (v.kind !== "junction" && v.kind !== "free") {
    throw new Error(`cannot move a ${v.kind} vertex`);
  }
  v.x = x;
  v.y = y;
}

// deleteBend removes an interior bend, merging the two adjoining segments into
// one (FR-033). The index must reference a bend.
export function deleteBend(wire, index) {
  const p = wire.path[index];
  if (!p || p.t !== "bend") {
    throw new Error(`path index ${index} is not a bend`);
  }
  wire.path.splice(index, 1);
}

// --- Deletion and connectivity cleanup (§3.3 G2, FR-029/FR-030) ---

function allConductors(design) {
  return design.wires.concat(design.buses);
}

function removeVertexById(design, id) {
  const i = design.vertices.findIndex((v) => v.id === id);
  if (i >= 0) design.vertices.splice(i, 1);
}

function removeConductor(design, c) {
  let i = design.wires.indexOf(c);
  if (i >= 0) {
    design.wires.splice(i, 1);
    return;
  }
  i = design.buses.indexOf(c);
  if (i >= 0) design.buses.splice(i, 1);
}

// vertexRefCount counts how many conductor path nodes reference a vertex.
function vertexRefCount(design, id) {
  let n = 0;
  for (const c of allConductors(design)) {
    for (const p of c.path) {
      if (p.t === "node" && p.v === id) n++;
    }
  }
  return n;
}

function findSingleNodeRef(design, id) {
  for (const c of allConductors(design)) {
    for (let i = 0; i < c.path.length; i++) {
      const p = c.path[i];
      if (p.t === "node" && p.v === id) return { conductor: c, index: i };
    }
  }
  return null;
}

// conductorById returns the wire or bus with the given id, or null.
function conductorById(design, id) {
  return (
    design.wires.find((w) => w.id === id) ??
    design.buses.find((b) => b.id === id) ??
    null
  );
}

// groupSnappedVertices returns the set of vertex ids that are bus group-snap
// endpoints (FR-042): `free` in kind but electrically connected, so they are not
// dangling and never join-merge.
function groupSnappedVertices(design) {
  const s = new Set();
  for (const b of design.buses) {
    for (const gc of b.groupConnections ?? []) s.add(gc.vertex);
  }
  return s;
}

// endpointRefs returns every conductor endpoint (first/last path node) that
// references a vertex: [{conductor, index, isBus}].
function endpointRefs(design, vertexId) {
  const out = [];
  for (const c of allConductors(design)) {
    const last = c.path.length - 1;
    for (const i of last === 0 ? [0] : [0, last]) {
      const p = c.path[i];
      if (p && p.t === "node" && p.v === vertexId) {
        out.push({ conductor: c, index: i, isBus: design.buses.includes(c) });
      }
    }
  }
  return out;
}

// danglingEndAt returns the dangling endpoint a point lands on (FR-034c): a free,
// non-group-snapped vertex within `tol` (world units) that is the lone endpoint of
// exactly one conductor, with that conductor, whether it is a bus, and its width.
// Null when no such end is near. The wire/bus tools use this to join onto a
// dangling end instead of branching a junction (FR-034b).
export function danglingEndAt(design, pt, tol = 0.5) {
  const snapped = groupSnappedVertices(design);
  let best = null;
  let bestD2 = tol * tol;
  for (const v of design.vertices) {
    if (v.kind !== "free" || snapped.has(v.id)) continue;
    const dx = v.x - pt.x;
    const dy = v.y - pt.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > bestD2) continue;
    const refs = endpointRefs(design, v.id);
    if (refs.length !== 1) continue; // a dangling end belongs to exactly one conductor
    best = {
      vertex: v,
      conductor: refs[0].conductor,
      isBus: refs[0].isBus,
      width: refs[0].isBus ? refs[0].conductor.width : 1,
    };
    bestD2 = d2;
  }
  return best;
}

// pathPointCoord resolves a path point's world coordinate (bend carries its own;
// a node defers to its vertex).
function pathPointCoord(design, p) {
  return p.t === "bend" ? { x: p.x, y: p.y } : vertexWorld(design, getVertex(design, p.v));
}

// prunePath drops interior bend points that do not bend the conductor (FR-033c),
// keeping every node (ends/junctions) and the path endpoints.
function prunePath(design, conductor) {
  const path = conductor.path;
  if (path.length < 3) return;
  const out = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const prev = pathPointCoord(design, out[out.length - 1]);
    const cur = pathPointCoord(design, path[i]);
    const next = pathPointCoord(design, path[i + 1]);
    if (path[i].t === "bend" && isRedundantBend(prev, cur, next)) continue;
    out.push(path[i]);
  }
  out.push(path[path.length - 1]);
  conductor.path = out;
}

// joinFreeEnd merges the two conductors meeting at a dangling free vertex into one
// continuous conductor (FR-034c). No-op unless vertexId is a free, non-group-
// snapped vertex that is the endpoint of exactly two distinct conductors of the
// same type (and, for buses, equal width, FR-039a). The shared point becomes an
// interior bend of the joined conductor, pruned if collinear (FR-033c); the now-
// unused vertex is removed, so no junction and no dangling mark remain.
export function joinFreeEnd(design, vertexId) {
  const v = getVertex(design, vertexId);
  if (!v || v.kind !== "free" || groupSnappedVertices(design).has(vertexId)) return;
  const refs = endpointRefs(design, vertexId);
  if (refs.length !== 2) return;
  const [r1, r2] = refs;
  if (r1.conductor === r2.conductor) return; // a self-loop on one conductor
  if (r1.isBus !== r2.isBus) return; // type mismatch
  if (r1.isBus && r1.conductor.width !== r2.conductor.width) return; // FR-039a

  // Orient both paths so the shared vertex sits at keep's tail and drop's head,
  // then splice: keep (minus shared node) + bend at the shared point + drop
  // (minus shared node).
  const keep = r1.conductor;
  const drop = r2.conductor;
  const keepPath = r1.index === 0 ? [...keep.path].reverse() : [...keep.path];
  const dropPath = r2.index === 0 ? [...drop.path] : [...drop.path].reverse();
  keep.path = [
    ...keepPath.slice(0, -1),
    { t: "bend", x: v.x, y: v.y },
    ...dropPath.slice(1),
  ];
  // Carry the dropped bus's group connections onto the survivor (their vertices
  // are at the far ends and remain valid).
  if (r1.isBus && drop.groupConnections?.length) {
    keep.groupConnections = [...(keep.groupConnections ?? []), ...drop.groupConnections];
  }
  removeConductor(design, drop);
  removeVertexById(design, vertexId);
  prunePath(design, keep);
}

// rigidWiring returns the wiring interior to a group move (FR-018c): the bend
// points (`{wireId, index}`) and the junction/free vertex ids of every conductor
// network all of whose component connections are to a component in `movingRefdes`
// (a Set of refdes). A *component connection* is a pin/connector endpoint or a
// group-snapped bus endpoint (FR-042) — the latter is a `free` vertex but is bound
// to its component, so it counts toward the test and is carried by the move. Pin/
// connector vertices follow their components via derived position, so they are
// excluded from the returned set; junction/free vertices (including snapped bus
// endpoints) are listed because they must be shifted explicitly. A network with a
// connection on a non-moving component, or none at all, is left alone (it stretches
// per FR-018) — but a group-snapped endpoint on a moving component is still
// returned so a boundary bus stays attached and only stretches.
export function rigidWiring(design, movingRefdes) {
  const conductors = allConductors(design);
  // Map a group-snapped bus endpoint vertex id → its bound instance (FR-042), so
  // such a free vertex is treated as a connection to that component.
  const snapInst = new Map();
  for (const b of design.buses) {
    for (const gc of b.groupConnections ?? []) snapInst.set(gc.vertex, gc.instance);
  }

  // Union-find over conductor indices, joined where they share a vertex.
  const parent = conductors.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const byVertex = new Map();
  conductors.forEach((c, i) => {
    for (const p of c.path) {
      if (p.t !== "node") continue;
      if (!byVertex.has(p.v)) byVertex.set(p.v, []);
      byVertex.get(p.v).push(i);
    }
  });
  for (const list of byVertex.values())
    for (let k = 1; k < list.length; k++) parent[find(list[k])] = find(list[0]);

  // Group conductor indices into networks by their union-find root.
  const nets = new Map();
  conductors.forEach((_, i) => {
    const r = find(i);
    if (!nets.has(r)) nets.set(r, []);
    nets.get(r).push(i);
  });

  const bends = [];
  const vertices = new Set();
  for (const idxs of nets.values()) {
    let conns = 0; // component connections: pins/connectors + group-snapped endpoints
    let allMoving = true;
    for (const i of idxs)
      for (const p of conductors[i].path) {
        if (p.t !== "node") continue;
        const v = getVertex(design, p.v);
        const ref =
          v.kind === "pin" || v.kind === "connector" ? v.ref : snapInst.get(v.id);
        if (ref != null) {
          conns++;
          if (!movingRefdes.has(ref)) allMoving = false;
        }
      }
    if (conns === 0 || !allMoving) continue; // boundary or free-floating: stretch
    for (const i of idxs) {
      const c = conductors[i];
      c.path.forEach((p, idx) => {
        if (p.t === "bend") bends.push({ wireId: c.id, index: idx });
        else {
          // pin/connector vertices follow their instance (derived position), so
          // they are excluded from the rigid set; junction/free (incl. snapped bus
          // endpoints) move here.
          const k = getVertex(design, p.v).kind;
          if (k !== "pin" && k !== "connector") vertices.add(p.v);
        }
      });
    }
  }
  // Boundary buses (a group-snapped endpoint on a moving component, the rest
  // outside the moving set) are skipped above as stretching networks, but their
  // snapped endpoint must still follow its component (FR-018), so add those.
  for (const [vid, inst] of snapInst) {
    if (movingRefdes.has(inst)) vertices.add(vid);
  }
  return { bends, vertices: [...vertices] };
}

// shiftWiring translates the bend points and vertices named by `refs` (as
// returned by rigidWiring) by (dx,dy) — the interior-wiring move of FR-018c.
// Reversible by negating the offset.
export function shiftWiring(design, refs, dx, dy) {
  for (const { wireId, index } of refs.bends) {
    const p = conductorById(design, wireId).path[index];
    p.x += dx;
    p.y += dy;
  }
  for (const id of refs.vertices) {
    const v = getVertex(design, id);
    v.x += dx;
    v.y += dy;
  }
}

// cleanup restores connectivity invariants after a structural deletion (§3.3):
//   - a junction referenced by exactly one conductor is demoted: to a free
//     (dangling) vertex if it is that conductor's endpoint, or back to a plain
//     bend if it is interior;
//   - a conductor whose both endpoints are free is removed (FR-030) — but a
//     bus endpoint named by a groupConnections entry is connected (FR-041a/
//     FR-042) even though its vertex kind stays "free", so it is never swept;
//   - any vertex with no references is garbage-collected.
// It iterates to a fixed point because each step can enable the next.
export function cleanup(design) {
  for (let guard = 0; ; guard++) {
    let changed = false;

    // Vertices that are bus endpoints snap-connected to a pin group: connected
    // for FR-030 purposes despite kind === "free".
    const snapped = new Set();
    for (const b of design.buses) {
      for (const gc of b.groupConnections ?? []) snapped.add(gc.vertex);
    }

    for (const v of [...design.vertices]) {
      const rc = vertexRefCount(design, v.id);
      if (rc === 0) {
        removeVertexById(design, v.id);
        changed = true;
        continue;
      }
      if (v.kind === "junction" && rc === 1) {
        const ref = findSingleNodeRef(design, v.id);
        const last = ref.conductor.path.length - 1;
        if (ref.index === 0 || ref.index === last) {
          v.kind = "free"; // dangling endpoint (FR-029)
        } else {
          ref.conductor.path[ref.index] = { t: "bend", x: v.x, y: v.y };
          removeVertexById(design, v.id);
        }
        changed = true;
      }
    }

    for (const c of [...design.wires, ...design.buses]) {
      const a = getVertex(design, c.path[0].v);
      const b = getVertex(design, c.path[c.path.length - 1].v);
      const disconnected = (v) => v.kind === "free" && !snapped.has(v.id);
      if (a && b && disconnected(a) && disconnected(b)) {
        removeConductor(design, c);
        changed = true;
      }
    }

    if (!changed) break;
    if (guard > 1000) throw new Error("cleanup did not converge");
  }
}

// deleteWire removes a wire and runs cleanup (FR-033a).
export function deleteWire(design, wireId) {
  const i = design.wires.findIndex((w) => w.id === wireId);
  if (i < 0) throw new Error(`no such wire ${wireId}`);
  design.wires.splice(i, 1);
  cleanup(design);
}

// deleteSegment removes a single path edge (segment `segIndex`) of a wire or bus
// (FR-033d), cutting the conductor into its leading and trailing parts. A cut bend
// point becomes a dangling free endpoint (FR-029); a cut node is kept. A part with
// fewer than two points is dropped, leaving its lone endpoint unconnected. The two
// parts inherit the conductor's width/bit names; each groupConnection (FR-042)
// stays with the part that keeps its vertex. cleanup() then demotes orphaned
// junctions and prunes fully-disconnected conductors (FR-030).
export function deleteSegment(design, conductorId, segIndex) {
  const conductor = conductorById(design, conductorId);
  if (!conductor) throw new Error(`no such conductor ${conductorId}`);
  const path = conductor.path;
  if (segIndex < 0 || segIndex >= path.length - 1) {
    throw new Error(`bad segment index ${segIndex}`);
  }
  const isBus = design.buses.includes(conductor);

  // The two cut points (the deleted edge's ends): a bend becomes a new free
  // endpoint, a node is kept as is.
  const cutPoint = (p) =>
    p.t === "bend"
      ? { t: "node", v: addVertex(design, { kind: "free", x: p.x, y: p.y }).id }
      : p;
  const lead = [...path.slice(0, segIndex), cutPoint(path[segIndex])];
  const trail = [cutPoint(path[segIndex + 1]), ...path.slice(segIndex + 2)];

  removeConductor(design, conductor);
  for (const part of [lead, trail]) {
    if (part.length < 2) continue; // a lone endpoint is simply left unconnected
    if (isBus) {
      const ids = new Set(part.filter((p) => p.t === "node").map((p) => p.v));
      design.buses.push({
        id: "b" + design.nextBusId++,
        path: part,
        width: conductor.width,
        groupConnections: (conductor.groupConnections ?? []).filter((gc) => ids.has(gc.vertex)),
        bitNames: conductor.bitNames,
      });
    } else {
      design.wires.push({ id: "w" + design.nextWireId++, path: part });
    }
  }
  cleanup(design);
}

// deleteInstance removes a component (FR-018a). Its pin vertices are converted to
// free vertices at their current world position so connected wires remain with a
// dangling end; cleanup then prunes any wire left fully disconnected (FR-030).
export function deleteInstance(design, refdes) {
  const i = design.components.findIndex((c) => c.refdes === refdes);
  if (i < 0) throw new Error(`no such component ${refdes}`);
  for (const v of design.vertices) {
    if ((v.kind === "pin" || v.kind === "connector") && v.ref === refdes) {
      const w = vertexWorld(design, v); // instance still present
      v.kind = "free";
      v.x = w.x;
      v.y = w.y;
      delete v.ref;
      delete v.pin;
    }
  }
  design.components.splice(i, 1);
  cleanup(design);
}

// packageSiblings returns every refdes belonging to the same physical package as
// `refdes`. For a subunit component (FR-018b) that is all siblings sharing its
// U-number (e.g. U5A…U5D); for a unit component it is just [refdes].
export function packageSiblings(design, refdes) {
  const inst = design.components.find((c) => c.refdes === refdes);
  if (!inst || inst.typeData?.renderType !== "subunit") return [refdes];
  const key = /^U\d+/.exec(refdes)?.[0];
  return design.components
    .filter(
      (c) =>
        c.typeData?.renderType === "subunit" && /^U\d+/.exec(c.refdes)?.[0] === key,
    )
    .map((c) => c.refdes);
}
