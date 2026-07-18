// Sub-designs, ports & off-sheet connectors (§6.14, requirements §3.22).
//
// A separately-saved design can be embedded in a higher-level design as a single
// component (a "sub-design instance"). Its external interface is the set of its
// ports (FR-095); embedding resolves that interface into a synthetic, in-memory
// ComponentType (never saved) so the whole pin/vertex/wire/netlist/render
// pipeline serves hierarchy unchanged — only render style, navigation, and
// flattening are new. This module owns the pure interface/synthesis helpers and
// the simulator-facing flatten/wouldCycle (FR-102/FR-102a/FR-103, §6.14).

import { allocRefNum } from "./design.js";
import { buildNets } from "./netlist.js";
// Circular with persist.js (it imports placeholderTypeFromWiring): safe — both
// modules only call across the cycle at run time, never during evaluation.
import { deserializeDesign } from "./persist.js";

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

// effectivePortDir returns a port's effective direction (FR-094d): its in/out
// override when one is set *and* the derived direction (FR-094c) is bidir;
// otherwise the derived direction itself. A definite derived direction ignores
// any override (FR-094c's read-only guarantee), and an override on a port whose
// derivation is no longer bidir lies dormant rather than going stale.
export function effectivePortDir(design, portRefdes) {
  const derived = portDirection(design, portRefdes);
  if (derived !== "bidir") return derived;
  const inst = (design.components ?? []).find((c) => c.refdes === portRefdes);
  return inst?.dirOverride ?? derived;
}

// applyOverride folds a port instance's optional override into a derived
// direction, with the same bidir-only rule as effectivePortDir (FR-094d).
function applyOverride(dir, inst) {
  return dir === "bidir" && inst?.dirOverride ? inst.dirOverride : dir;
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
        dir: applyOverride(classifyPortNDir(nets, byRefdes, c.refdes, pinNames), c),
        width: pinNames.length,
      });
    } else {
      // A 1-wide port is always one bit (FR-094); it has no width field.
      byLabel.set(label, {
        label,
        dir: applyOverride(classifyPortDir(nets, byRefdes, label), c),
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

// ifaceSig canonicalizes an interface record for the FR-099c change comparison,
// so stored-JSON key order can never produce a false difference.
const ifaceSig = (iface) =>
  (iface ?? []).map((s) => `${s.label} ${s.dir} ${s.width}`).join("\n");

// resolveSubDesigns fills in (or refreshes) the in-memory synthetic typeData of
// every sub-design instance from its child file (FR-098 loading). It is the async
// load-time pass run after deserialize, since the synthetic interface isn't saved
// (§6.14). `loadChild(childPath) → Promise<savedObject>` returns the child's
// parsed save object; designInterface reads its ports directly, so the child need
// not be fully deserialized. A child that fails to load yields a broken-link
// placeholder (FR-099a); a connection to an interface pin the child no longer
// exposes is left dangling and reported (FR-099b).
// Returns `{ changed }` — the refdes of instances whose freshly resolved
// interface differs from their stored `iface` record (FR-099c). The record is
// updated (or first written, for a pre-FR-099c file — reported as unchanged);
// a broken child leaves it untouched, so restoration compares against the
// pre-break state.
export async function resolveSubDesigns(design, loadChild, onReport = () => {}) {
  const changed = [];
  for (const inst of design.components) {
    if (inst.kind !== "subdesign") continue;
    try {
      const child = await loadChild(inst.childPath);
      const iface = designInterface(child);
      if (inst.iface != null && ifaceSig(inst.iface) !== ifaceSig(iface)) {
        changed.push(inst.refdes);
      }
      inst.iface = iface;
      inst.typeData = synthTypeForInterface(iface, inst.render, inst.type);
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
  return { changed };
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

// --- Flattening (FR-102/FR-102a/FR-103, §6.14) ---------------------------
//
// flatten() produces a plain simulation-only design — never rendered, never
// saved — in which every sub-design instance is replaced by a prefixed copy of
// its child and every off-sheet target is joined across its peer sheets. The
// result feeds the existing buildNets+evaluation pipeline unchanged.

// POSIX path helpers — private copies of fileops.js's (model code must not
// import chrome). The server speaks forward slashes (§6.14 loading).
const dirOf = (p) => p.replace(/\/[^/]*$/, "") || "/";
const baseOf = (p) => p.split(/[\\/]/).pop();
function resolveRel(baseDir, rel) {
  const out = [];
  for (const seg of (baseDir + "/" + rel).split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return "/" + out.join("/");
}
const absolutize = (dir, p) => (p.startsWith("/") ? p : resolveRel(dir, p));

const isPortRT = (rt) => rt === "port" || rt === "portN";

// prefixSheet renames one sheet's contents in place under an instance-path or
// per-sheet prefix (FR-102/FR-103): component refdes, wire/bus/vertex ids and
// every reference to them, and port labels. Refdes prefixing keeps refdes.pin
// identity unique; id prefixing keeps copied conductors from colliding with
// (and conflictedConductors from ever matching) the parent's; label prefixing
// keeps buildNets' label-union (§6.6 step 6) within one sheet instance so
// same-label ports in different instances never join (FR-101a).
function prefixSheet(sheet, prefix) {
  for (const c of sheet.components) {
    c.refdes = prefix + c.refdes;
    if (isPortRT(c.typeData?.renderType) && c.label != null && c.label !== "") {
      c.label = prefix + c.label;
    }
  }
  for (const v of sheet.vertices) {
    v.id = prefix + v.id;
    if (v.kind === "pin" || v.kind === "connector") v.ref = prefix + v.ref;
  }
  for (const w of sheet.wires) {
    w.id = prefix + w.id;
    for (const p of w.path) if (p.t === "node") p.v = prefix + p.v;
  }
  for (const b of sheet.buses) {
    b.id = prefix + b.id;
    for (const p of b.path) if (p.t === "node") p.v = prefix + p.v;
    for (const gc of b.groupConnections ?? []) {
      gc.instance = prefix + gc.instance;
      if (gc.vertex) gc.vertex = prefix + gc.vertex;
    }
  }
}

// stitchMap maps an instance's interface pin names (the synthetic type's, as the
// parent wiring references them) to the owning child port's connection pin,
// prefixed (§6.14 stitching). First port per label wins, matching
// designInterface. A 1-wide pin targets the port's connector as a `connector`
// vertex so buildNets' label union still reaches a wireless owning port; a
// portN bit targets `Pk` as a plain `pin` vertex (shared-pin union, step 5).
function stitchMap(child, prefix) {
  const map = new Map();
  const seen = new Set();
  for (const c of child.components) {
    const rt = c.typeData?.renderType;
    if (!isPortRT(rt)) continue;
    const label = c.label;
    if (label == null || label === "" || seen.has(label)) continue;
    seen.add(label);
    if (rt === "portN") {
      (c.typeData.pins ?? []).forEach((p, k) =>
        map.set(`${label}${k}`, { vkind: "pin", ref: prefix + c.refdes, pin: p.name }),
      );
    } else {
      map.set(label, { vkind: "connector", ref: prefix + c.refdes, pin: "P" });
    }
  }
  return map;
}

// rewriteAttachments redirects every parent attachment on a sub-design instance
// — pin/connector vertices and bus group snaps — to the child port pins per the
// stitch map. A stale attachment (interface pin the child no longer exposes,
// FR-099b — already reported at load) is left dangling.
function rewriteAttachments(flat, xRef, map) {
  for (const v of flat.vertices) {
    if ((v.kind !== "pin" && v.kind !== "connector") || v.ref !== xRef) continue;
    const t = map.get(v.pin);
    if (t) {
      v.kind = t.vkind;
      v.ref = t.ref;
      v.pin = t.pin;
    } else {
      v.kind = "free";
      delete v.ref;
      delete v.pin;
    }
  }
  for (const b of flat.buses) {
    if (!b.groupConnections) continue;
    b.groupConnections = b.groupConnections.filter((gc) => {
      if (gc.instance !== xRef) return true;
      const t0 = map.get(gc.bitMap[0]);
      if (!t0) return false; // stale group snap: drop it
      gc.instance = t0.ref;
      gc.bitMap = gc.bitMap.map((n) => map.get(n)?.pin ?? n);
      return true;
    });
  }
}

// loadSheet loads and deserializes one sheet file, absolutizing its sub-designs'
// stored-relative childPaths against its own directory (as loadIntoStore does).
async function loadSheet(absPath, loadChild, who) {
  let sheet;
  try {
    sheet = deserializeDesign(await loadChild(absPath));
  } catch (e) {
    throw new Error(`${who}: cannot load ${absPath}: ${e.message}`);
  }
  const dir = dirOf(absPath);
  for (const c of sheet.components) {
    if (c.kind === "subdesign" && c.childPath) c.childPath = absolutize(dir, c.childPath);
  }
  return sheet;
}

// expandOne replaces one sub-design instance (already carrying its full prefix)
// with a prefixed copy of its child, stitching the parent's attachments to the
// child's ports, then recurses into the child's own instances. `pathChain` is
// the absolute file paths open along this expansion (cycle detection, FR-102a);
// `targets` collects off-sheet links for the FR-103 pass.
async function expandOne(flat, inst, pathChain, loadChild, targets) {
  const childAbs = inst.childPath;
  if (!childAbs) throw new Error(`sub-design ${inst.refdes}: no child path`);
  if (pathChain.includes(childAbs)) {
    throw new Error(
      `sub-design ${inst.refdes}: embedding cycle: ` +
        [...pathChain, childAbs].map(baseOf).join(" → "),
    );
  }
  const child = await loadSheet(childAbs, loadChild, `sub-design ${inst.refdes}`);
  const prefix = inst.refdes + "/";
  const map = stitchMap(child, prefix);
  prefixSheet(child, prefix);
  for (const c of child.components) {
    if (c.typeData?.renderType === "port" && c.target) {
      targets.push({ fromDir: dirOf(childAbs), fromRef: c.refdes, target: c.target });
    }
  }
  rewriteAttachments(flat, inst.refdes, map);
  flat.components = flat.components.filter((c) => c !== inst);
  flat.components.push(...child.components);
  flat.wires.push(...child.wires);
  flat.buses.push(...child.buses);
  flat.vertices.push(...child.vertices);
  for (const c of child.components) {
    if (c.kind === "subdesign") {
      await expandOne(flat, c, [...pathChain, childAbs], loadChild, targets);
    }
  }
}

// connectorVertexFor returns the connector vertex of a 1-wide port, creating
// one if the port is unwired (positions are irrelevant — a FlatDesign is never
// rendered).
function connectorVertexFor(flat, refdes, id) {
  const v = flat.vertices.find((x) => x.kind === "connector" && x.ref === refdes);
  if (v) return v.id;
  flat.vertices.push({ id, kind: "connector", ref: refdes, pin: "P", x: 0, y: 0 });
  return id;
}

// uniqueTag disambiguates a peer sheet's base-name tag on collision (FR-103).
function uniqueTag(base, used) {
  if (!used.has(base)) return base;
  let k = 2;
  while (used.has(base + k)) k++;
  return base + k;
}

// flatten builds the simulation-only FlatDesign (FR-102/FR-102a/FR-103, §6.14):
// sub-design instances expanded depth-first under instance-path prefixes, then
// off-sheet targets followed transitively (de-duplicated by absolute path,
// peer sheets merged under file-base-name tags) with each declared link joined
// by a synthetic two-node wire between the ports' connector vertices. Throws on
// an embedding cycle or an unloadable/unresolvable reference; a design with no
// sub-designs and no targets is returned as-is (identity pass, NFR-005).
// `loadChild(absPath) → Promise<savedObject>`; `rootPath` is the root design's
// absolute save path (null for an unsaved design — required only when targets
// must be resolved or a child could embed the root).
export async function flatten(rootDesign, loadChild, { rootPath = null } = {}) {
  const comps = rootDesign.components ?? [];
  const hasSub = comps.some((c) => c.kind === "subdesign");
  const hasTarget = comps.some((c) => c.typeData?.renderType === "port" && c.target);
  if (!hasSub && !hasTarget) return rootDesign;

  // Share the root's component objects — the running sim reads mutable
  // interactive state (switch clicks, FR-087b) off the retained instances, so
  // cloning them would deaden the top sheet. Clone what flatten rewrites
  // (wires/buses/vertices); sub-design entries are shallow-copied since they
  // are mutated (childPath normalization) and then replaced.
  const flat = {
    ...rootDesign,
    components: comps.map((c) => (c.kind === "subdesign" ? { ...c } : c)),
    wires: structuredClone(rootDesign.wires ?? []),
    buses: structuredClone(rootDesign.buses ?? []),
    vertices: structuredClone(rootDesign.vertices ?? []),
  };
  const targets = []; // { fromDir, fromRef, target:{file,label} }
  for (const c of flat.components) {
    if (c.kind === "subdesign" && c.childPath && rootPath) {
      c.childPath = absolutize(dirOf(rootPath), c.childPath); // in-memory paths are absolute already; normalize defensively
    }
    if (c.typeData?.renderType === "port" && c.target) {
      if (!rootPath) throw new Error(`port ${c.refdes}: an off-sheet target requires a saved design`);
      targets.push({ fromDir: dirOf(rootPath), fromRef: c.refdes, target: c.target });
    }
  }
  for (const inst of flat.components.filter((c) => c.kind === "subdesign")) {
    await expandOne(flat, inst, rootPath ? [rootPath] : [], loadChild, targets);
  }

  // Off-sheet peers (FR-103/FR-101a). The queue grows as loaded peers declare
  // their own targets; de-dup by absolute path bounds it (mutual peering is
  // legal, FR-102a).
  const sheets = new Map(); // absPath → tag ("" = the root sheet)
  if (rootPath) sheets.set(rootPath, "");
  const links = [];
  for (let i = 0; i < targets.length; i++) {
    const { fromDir, fromRef, target } = targets[i];
    const toAbs = absolutize(fromDir, target.file);
    let tag = sheets.get(toAbs);
    if (tag === undefined) {
      tag = uniqueTag(baseOf(toAbs).replace(/\.json$/i, ""), new Set(sheets.values()));
      sheets.set(toAbs, tag);
      const sheet = await loadSheet(toAbs, loadChild, `off-sheet connector ${fromRef}`);
      prefixSheet(sheet, tag + "/");
      for (const c of sheet.components) {
        if (c.typeData?.renderType === "port" && c.target) {
          targets.push({ fromDir: dirOf(toAbs), fromRef: c.refdes, target: c.target });
        }
      }
      flat.components.push(...sheet.components);
      flat.wires.push(...sheet.wires);
      flat.buses.push(...sheet.buses);
      flat.vertices.push(...sheet.vertices);
      for (const c of sheet.components) {
        if (c.kind === "subdesign") await expandOne(flat, c, [toAbs], loadChild, targets);
      }
    }
    links.push({ fromRef, toLabel: tag ? `${tag}/${target.label}` : target.label, toAbs, origLabel: target.label });
  }
  links.forEach(({ fromRef, toLabel, toAbs, origLabel }, n) => {
    const dst = flat.components.find(
      (c) => c.typeData?.renderType === "port" && c.label === toLabel,
    );
    if (!dst) {
      throw new Error(
        `off-sheet connector ${fromRef}: no port labeled ${origLabel} in ${baseOf(toAbs)}`,
      );
    }
    const a = connectorVertexFor(flat, fromRef, `link/v${n}a`);
    const b = connectorVertexFor(flat, dst.refdes, `link/v${n}b`);
    flat.wires.push({ id: `link/${n}`, path: [{ t: "node", v: a }, { t: "node", v: b }] });
  });
  return flat;
}

// wouldCycle reports whether embedding the child at childAbsPath into the design
// saved at parentAbsPath would create an embedding cycle (FR-097a/FR-102a): it
// walks the child's transitive embeds (saved objects; childPaths stored relative
// resolve against each file's directory) looking for the parent's path. A child
// that fails to load is skipped (a broken link is not a cycle, FR-099a).
export async function wouldCycle(childAbsPath, parentAbsPath, loadChild) {
  if (!parentAbsPath) return false;
  const seen = new Set();
  const stack = [childAbsPath];
  while (stack.length) {
    const p = stack.pop();
    if (p === parentAbsPath) return true;
    if (seen.has(p)) continue;
    seen.add(p);
    let obj;
    try {
      obj = await loadChild(p);
    } catch {
      continue;
    }
    const dir = dirOf(p);
    for (const c of obj.components ?? []) {
      if (c.kind === "subdesign" && c.childPath) stack.push(absolutize(dir, c.childPath));
    }
  }
  return false;
}

// addSubDesignInstance embeds a child design as a sub-design instance (FR-098).
// It allocates an X-<n> refdes (a third series beside U and A, FR-098a; the same
// child may be embedded repeatedly), stores the live relative child path and the
// chosen render style, and attaches the synthetic interface type as in-memory
// typeData (recomputed on load, never saved — FR-098). `childName` is the child's
// base name, shown as the body label; `iface` is designInterface(child).
export function addSubDesignInstance(design, { childPath, render, iface, childName }, x, y) {
  const refdes = "X" + allocRefNum(design, "X");
  const inst = {
    refdes,
    type: childName,
    kind: "subdesign",
    childPath,
    render,
    iface: structuredClone(iface), // last-resolved interface record (FR-099c)
    x,
    y,
    rotation: 0,
    typeData: synthTypeForInterface(iface, render, childName),
    overrides: {},
  };
  design.components.push(inst);
  return inst;
}
