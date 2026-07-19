// Design persistence: convert the in-memory design to/from the JSON save shape
// (§7.2, FR-055/056). The saved file carries the connectivity collections plus a
// derived `nets` array for downstream tools (FR-059a); ids are authoritative and
// the counters are rebuilt on load.

import { createDesign, nextRefNum, REF_SERIES } from "./design.js";
import { buildNets } from "./netlist.js";
import { placeholderTypeFromWiring } from "./subdesign.js";

// --- POSIX-style path helpers (the server uses forward slashes; the dev
// platform is macOS/Linux — Windows path handling is a follow-up). Moved here
// from fileops.js (§6.19) so the model's data-path conversion below can share
// them; fileops re-imports them. ---
export const dirOf = (p) => p.replace(/\/[^/]*$/, "") || "/";
export const baseOf = (p) => p.split(/[\\/]/).pop();

// relPath expresses an absolute target relative to a base directory, e.g.
// ("/a/designs", "/a/lib/c.json") → "../lib/c.json".
export function relPath(fromDir, toPath) {
  const a = fromDir.replace(/\/+$/, "").split("/");
  const b = toPath.split("/");
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  const ups = a.slice(i).map(() => "..");
  return [...ups, ...b.slice(i)].join("/") || baseOf(toPath);
}

// resolveRel turns a child path stored relative to a base dir back into an
// absolute path, normalizing "." and "..".
export function resolveRel(baseDir, rel) {
  const out = [];
  for (const seg of (baseDir + "/" + rel).split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return "/" + out.join("/");
}

// inDir reports whether absolute path p lies inside (or is) directory dir.
function inDir(p, dir) {
  const d = dir.replace(/\/+$/, "");
  return p === d || p.startsWith(d + "/");
}

// relativizeDataPaths converts a serialized design's in-project absolute mem
// data paths (a ROM's content file, a RAM's save file — typeData.mem.romFile/
// ramFile) to paths relative to the design's save directory (FR-121g, §6.19).
// Paths outside projectDir stay absolute (the loose data boundary, FR-121d).
// Copy-on-write: serializeDesign shares the live component objects, so a
// touched component is replaced by a patched copy (the portDir-stamping
// precedent, §6.14) and the in-memory model keeps its absolute paths.
export function relativizeDataPaths(serialized, baseDir, projectDir) {
  serialized.components = serialized.components.map((c) => {
    const mem = c.typeData?.mem;
    if (!mem) return c;
    const patch = {};
    for (const key of ["romFile", "ramFile"]) {
      const p = mem[key];
      if (typeof p === "string" && p.startsWith("/") && inDir(p, projectDir)) {
        patch[key] = relPath(baseDir, p);
      }
    }
    if (Object.keys(patch).length === 0) return c;
    return { ...c, typeData: { ...c.typeData, mem: { ...mem, ...patch } } };
  });
  return serialized;
}

// absolutizeDataPaths resolves a just-loaded design's relative mem data paths
// back to absolute against the design's directory (FR-121g), mutating the
// load copy in place — the counterpart of relativizeDataPaths. A legacy
// absolute in-project path loads as-is and comes back relative after its next
// save (relativization is unconditional at save time). Consumers (the sim
// run-time, the C generator) always see the absolute in-memory form.
export function absolutizeDataPaths(design, baseDir) {
  for (const c of design.components) {
    const mem = c.typeData?.mem;
    if (!mem) continue;
    for (const key of ["romFile", "ramFile"]) {
      const p = mem[key];
      if (typeof p === "string" && p !== "" && !p.startsWith("/")) {
        mem[key] = resolveRel(baseDir, p);
      }
    }
  }
  return design;
}

// FORMAT_VERSION is the save-file format this client writes and understands
// (§7.4). On load, a file from an older format version is migrated forward to
// this version through the MIGRATIONS chain (compatibility mode); a file from a
// newer version is loaded best-effort and the load flow warns (forward-compat,
// fileops.js). Bump this whenever the save shape changes and add the matching
// MIGRATIONS step.
export const FORMAT_VERSION = 3;

// MIGRATIONS upgrades a parsed save object across a single format version:
// MIGRATIONS[n] takes a version-n object and returns a version-(n+1) object
// (§7.4). migrate() applies the steps in order to bring any older file up to
// FORMAT_VERSION. It is empty while only version 1 exists; each future format
// change adds one entry keyed by the version it upgrades *from*.
const MIGRATIONS = {
  // 1→2 (FR-066e): re-key each instance's `type` from the old display name to the
  // type id. Pure textual transform (no library access): the id is derived from
  // the instance's own `typeData` with the same rule the library/built-ins use
  // (deriveComponentID / builtinId), so an old instance re-matches its type after
  // load. `refdes` (the identity) and all wiring references are untouched; the
  // editable `label` (§7.2) is lazy and needs no migration. Sub-design instances
  // carry a path-derived `type` and no `typeData`, so they are left unchanged.
  1: (obj) => ({
    ...obj,
    components: (obj.components ?? []).map((c) => {
      if (c.kind === "subdesign" || !c.typeData) return c;
      const id = "type-" + (c.typeData.partnumber || c.typeData.name);
      return { ...c, type: id, typeData: { ...c.typeData, id } };
    }),
  }),
  // 2→3 (FR-011c): add the per-series high-water refdes counters, initialized to
  // 1 + the highest number present in each series — exactly the value the pre-v3
  // allocation rule would compute. Pure textual transform; the file carries no
  // deletion history, so a number freed before this migration (and above every
  // survivor in its series) remains reusable one last time (§7.4).
  2: (obj) => ({
    ...obj,
    refCounters: Object.fromEntries(
      Object.entries(REF_SERIES).map(([s, re]) => [s, nextRefNum(obj.components ?? [], re)]),
    ),
  }),
};

// migrate normalizes a parsed save object to the current format version (§7.4).
// A file with no `formatVersion` is treated as the oldest understood version (1).
// An older file is upgraded by applying each MIGRATIONS step in turn, stamping
// the new `formatVersion` after each; a missing step is a legible error. A file
// already at — or beyond — the target is returned unchanged, so a newer-than-
// understood file loads best-effort (the load flow warns separately). `target`
// and `migrations` are injectable so the chain is testable before a real second
// version exists.
export function migrate(obj, { target = FORMAT_VERSION, migrations = MIGRATIONS } = {}) {
  let v = obj.formatVersion ?? 1;
  while (v < target) {
    const step = migrations[v];
    if (!step) {
      throw new Error(`cannot load design: no migration from save-format version ${v} to ${v + 1}`);
    }
    obj = { ...step(obj), formatVersion: v + 1 };
    v += 1;
  }
  return obj;
}

// serializeDesign returns the JSON-serializable save object. `nets` is recomputed
// here and treated as derived/non-authoritative (A4).
export function serializeDesign(design) {
  return {
    formatVersion: FORMAT_VERSION,
    name: design.name,
    ...(design.defaultRender ? { defaultRender: design.defaultRender } : {}),
    ...(design.primaryClock ? { primaryClock: design.primaryClock } : {}), // FR-076b, additive-optional
    components: design.components.map((c) =>
      c.kind === "subdesign" ? stripSubDesign(c) : c,
    ),
    wires: design.wires,
    buses: design.buses,
    vertices: design.vertices,
    // A design predating the counters (test-constructed) serializes the same
    // values the 2→3 migration would compute: 1 + each series' current maximum.
    refCounters:
      design.refCounters ??
      Object.fromEntries(
        Object.entries(REF_SERIES).map(([s, re]) => [s, nextRefNum(design.components, re)]),
      ),
    nets: buildNets(design),
  };
}

// stripSubDesign persists only a sub-design's live link and placement, never its
// synthetic interface typeData (re-derived on load by resolveSubDesigns, FR-098).
// `iface` — the last-resolved interface record — rides along solely for the
// FR-099c change comparison; it is never trusted for rendering or simulation.
function stripSubDesign(c) {
  const { refdes, label, type, kind, childPath, render, iface, x, y, rotation } = c;
  return { refdes, label, type, kind, childPath, render, iface, x, y, rotation };
}

// maxIdNum returns the highest numeric suffix among ids of the form `<prefix><n>`.
function maxIdNum(items, prefix) {
  let max = 0;
  for (const it of items) {
    if (typeof it.id === "string" && it.id.startsWith(prefix)) {
      const n = Number(it.id.slice(prefix.length));
      if (Number.isFinite(n)) max = Math.max(max, n);
    }
  }
  return max;
}

// repairStructure runs the load-time referential-integrity repair (§7.4,
// FR-060d): the server only checks that the payload is JSON, so a truncated or
// hand-edited file — or one an editor bug saved with stale references — must be
// caught here, not later as a per-frame throw deep in render/hit-test. Each
// unresolvable element is dropped and reported through onWarn (one legible
// message per drop), and the rest of the design loads; in dependency order:
// bad pin/connector vertices, then conductors whose path is short or references
// a missing (or just-dropped) vertex — dropped whole, never partially, which
// would silently change topology — then bus group connections whose instance,
// vertex, or any bitMap pin does not resolve (the bus itself remains).
function repairStructure(d, onWarn) {
  // Pin existence is checked against typeData, except for sub-design instances,
  // whose interface is resolved after load (resolveSubDesigns, §6.14).
  const hasPin = (inst, name) =>
    inst.kind === "subdesign" || inst.typeData?.pins?.some((p) => p.name === name);
  d.vertices = d.vertices.filter((v) => {
    if (v.kind !== "pin" && v.kind !== "connector") return true;
    const inst = d.components.find((c) => c.refdes === v.ref);
    const reason = !inst
      ? `references missing component ${v.ref}`
      : !hasPin(inst, v.pin)
        ? `references missing pin ${v.ref}.${v.pin}`
        : null;
    if (!reason) return true;
    onWarn(`dropped vertex ${v.id}: ${reason}`);
    return false;
  });
  const vertexIds = new Set(d.vertices.map((v) => v.id));
  for (const key of ["wires", "buses"]) {
    const kind = key === "wires" ? "wire" : "bus";
    d[key] = d[key].filter((c) => {
      const bad =
        Array.isArray(c.path) && c.path.length >= 2
          ? c.path.find((p) => p.t === "node" && !vertexIds.has(p.v))
          : null;
      const reason =
        !Array.isArray(c.path) || c.path.length < 2
          ? "path must have at least 2 points"
          : bad
            ? `references missing vertex ${bad.v}`
            : null;
      if (!reason) return true;
      onWarn(`dropped ${kind} ${c.id}: ${reason}`);
      return false;
    });
  }
  for (const b of d.buses) {
    if (!b.groupConnections) continue;
    b.groupConnections = b.groupConnections.filter((gc) => {
      const inst = d.components.find((c) => c.refdes === gc.instance);
      const badPin = inst ? (gc.bitMap ?? []).find((n) => !hasPin(inst, n)) : null;
      const reason = !inst
        ? `references missing component ${gc.instance}`
        : !vertexIds.has(gc.vertex)
          ? `references missing vertex ${gc.vertex}`
          : badPin != null
            ? `references missing pin ${gc.instance}.${badPin}`
            : null;
      if (!reason) return true;
      onWarn(`dropped bus ${b.id} group connection: ${reason}`);
      return false;
    });
  }
}

// deserializeDesign rebuilds a live design from a parsed save object, restoring
// the id counters past the loaded ids. The derived `nets` field is ignored.
// Structural inconsistencies are repaired best-effort — dropped and reported
// through onWarn (§7.4, FR-060d); only a missing migration step still throws
// (FR-060c).
export function deserializeDesign(obj, { onWarn = () => {} } = {}) {
  // Bring an older save forward to the current format before building the model,
  // so every load path (Open, backup recovery) sees one normalized shape (§7.4).
  obj = migrate(obj);
  const d = createDesign(obj.name ?? "untitled");
  if (obj.defaultRender) d.defaultRender = obj.defaultRender; // FR-096
  d.components = structuredClone(obj.components ?? []);
  d.wires = structuredClone(obj.wires ?? []);
  d.buses = structuredClone(obj.buses ?? []);
  d.vertices = structuredClone(obj.vertices ?? []);
  repairStructure(d, onWarn);
  // FR-076b: adopt the primary-clock reference; a dangling one (hand-edited or
  // corrupted file) is dropped with a warning, repair-style, rather than kept.
  if (obj.primaryClock) {
    const ok = d.components.some(
      (c) => c.refdes === obj.primaryClock && c.typeData?.renderType === "clock",
    );
    if (ok) d.primaryClock = obj.primaryClock;
    else onWarn(`dropped primary clock ${obj.primaryClock}: no such clock generator`);
  }
  // Sub-designs persist no typeData (live reference, FR-098). Give each a
  // wiring-derived placeholder so the design is always renderable; the load
  // flow's resolveSubDesigns (§6.14) then refines it from the child file (or
  // marks it broken). This also keeps a recovered snapshot renderable.
  for (const inst of d.components) {
    if (inst.kind === "subdesign" && !inst.typeData) {
      inst.typeData = placeholderTypeFromWiring(d, inst);
    }
  }
  d.nextWireId = maxIdNum(d.wires, "w") + 1;
  d.nextBusId = maxIdNum(d.buses, "b") + 1;
  d.nextVertexId = maxIdNum(d.vertices, "v") + 1;
  // Adopt the saved high-water refdes counters (FR-011c; present after migrate),
  // clamping each up to 1 + the series' current maximum — a lower value is
  // possible only in a hand-edited file and must not allocate a duplicate.
  d.refCounters = Object.fromEntries(
    Object.entries(REF_SERIES).map(([s, re]) => [
      s,
      Math.max(obj.refCounters?.[s] ?? 1, nextRefNum(d.components, re)),
    ]),
  );
  return d;
}
