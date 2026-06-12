// In-browser canonical design model and pure operations on it (§6.6, §7.5).
// Mutations are normally driven by Command objects (store.js), but the low-level
// operations live here so they are unit-testable in isolation.

import { rotateOffset } from "../geometry.js";
import {
  gateInputCount,
  pinSlot,
  symbolFootprint,
  pinSlotOffset,
} from "../engine/symbols.js";

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
function nextRefNum(components, re) {
  let max = 0;
  for (const c of components) {
    const m = re.exec(c.refdes);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

// addInstance places a component instance, assigning it a unique reference
// designator and a private copy of the type data (FR-011, FR-057). Built-in
// objects (FR-067) use a separate A-<n> series (FR-011a); ICs use U<n>, ignoring
// any trailing subunit letter so "U5A" counts as 5.
export function addInstance(design, type, x, y, rotation) {
  const refdes = type.builtin
    ? "A-" + nextRefNum(design.components, /^A-(\d+)$/)
    : "U" + nextRefNum(design.components, /^U(\d+)[A-Z]*$/);
  const inst = {
    refdes,
    type: type.name,
    x,
    y,
    rotation,
    typeData: structuredClone(type),
    overrides: {},
  };
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
    if (v.kind === "pin" && v.ref === inst.refdes && !pinNames.has(v.pin)) {
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
  if (v.kind === "pin") {
    const inst = design.components.find((c) => c.refdes === v.ref);
    if (!inst) throw new Error(`pin vertex ${v.id} references missing ${v.ref}`);
    return pinWorldPos(inst, v.pin);
  }
  return { x: v.x, y: v.y };
}

// findPinVertex returns the existing vertex for a component pin, or null. A pin
// has at most one vertex; fan-out is multiple wires sharing it (A2).
function findPinVertex(design, refdes, pin) {
  return (
    design.vertices.find(
      (v) => v.kind === "pin" && v.ref === refdes && v.pin === pin,
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
      return addVertex(design, {
        kind: "pin",
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

// groupBitWidth returns a pin group's width: its member pin count, since every
// pin is one bit (§7.1, A3). Throws if the group names a pin the type lacks.
function groupBitWidth(type, group) {
  for (const name of group.pins) {
    if (!type.pins.some((p) => p.name === name)) {
      throw new Error(`group ${group.name}: unknown pin ${name}`);
    }
  }
  return group.pins.length;
}

// matchingGroups returns the component type's pin groups whose width equals
// busWidth (FR-041). Zero matches → nearest-pin fallback (FR-043); one →
// auto-snap (FR-041a); more than one → user disambiguation (FR-041b).
export function matchingGroups(type, busWidth) {
  return (type.pinGroups ?? []).filter((g) => groupBitWidth(type, g) === busWidth);
}

// setBusWidth changes a bus's width (FR-038). Per-bit names that no longer match
// the new width are dropped (they will be re-adopted on a later snap, FR-037b).
export function setBusWidth(design, busId, width) {
  const bus = design.buses.find((b) => b.id === busId);
  if (!bus) throw new Error(`no such bus ${busId}`);
  bus.width = width;
  if (bus.bitNames && bus.bitNames.length !== width) bus.bitNames = null;
}

// expandGroupBitMap returns the per-bus-bit pin-name list for a group: one entry
// per member pin in declared order, since every pin is one bit (FR-042). Length
// equals the group's width (member pin count).
function expandGroupBitMap(type, group) {
  for (const name of group.pins) {
    if (!type.pins.some((p) => p.name === name)) {
      throw new Error(`group ${group.name}: unknown pin ${name}`);
    }
  }
  return [...group.pins];
}

// snapBusGroup connects a bus endpoint to a component's pin group (FR-042): it
// records a GroupConnection binding bus bit i to bitMap[i]. On the first snap of
// an as-yet-unnamed bus, the bus adopts the group's pin names in bit order
// (FR-037b). The group's bit-width must equal the bus width (the caller ensures
// this via matchingGroups, FR-041).
export function snapBusGroup(design, busId, vertexId, instanceRefdes, groupName) {
  const bus = design.buses.find((b) => b.id === busId);
  if (!bus) throw new Error(`no such bus ${busId}`);
  const inst = design.components.find((c) => c.refdes === instanceRefdes);
  if (!inst) throw new Error(`no such component ${instanceRefdes}`);
  const group = (inst.typeData.pinGroups ?? []).find((g) => g.name === groupName);
  if (!group) throw new Error(`${instanceRefdes} has no pin group ${groupName}`);
  const bitMap = expandGroupBitMap(inst.typeData, group);
  if (bitMap.length !== bus.width) {
    throw new Error(
      `group ${groupName} width ${bitMap.length} != bus width ${bus.width}`,
    );
  }
  bus.groupConnections.push({
    vertex: vertexId,
    instance: instanceRefdes,
    group: groupName,
    bitMap,
  });
  if (!bus.bitNames) bus.bitNames = [...bitMap];
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
// single-bit wire (FR-043a). It inserts a junction vertex at (x,y) on segment
// segIndex of the bus with `bit` set to the tapped lane, then starts a wire from
// that junction to dest. The wire becomes electrically part of that bus bit's net
// (FR-037a), derived by buildNets. Returns the new wire.
export function breakoutBit(design, busId, segIndex, x, y, bit, dest) {
  const bus = design.buses.find((b) => b.id === busId);
  if (!bus) throw new Error(`no such bus ${busId}`);
  if (bit < 0 || bit >= bus.width) {
    throw new Error(`bit ${bit} out of range (0..${bus.width - 1})`);
  }
  const j = branchWire(design, bus, segIndex, x, y);
  j.bit = bit;
  return addWire(design, { kind: "vertex", id: j.id }, dest);
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

// deleteInstance removes a component (FR-018a). Its pin vertices are converted to
// free vertices at their current world position so connected wires remain with a
// dangling end; cleanup then prunes any wire left fully disconnected (FR-030).
export function deleteInstance(design, refdes) {
  const i = design.components.findIndex((c) => c.refdes === refdes);
  if (i < 0) throw new Error(`no such component ${refdes}`);
  for (const v of design.vertices) {
    if (v.kind === "pin" && v.ref === refdes) {
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
