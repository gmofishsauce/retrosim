// refresh-types.js — batch Refresh Types (FR-088) for saved design files.
//
// Re-copies current component-library type data into every placed instance of
// every design file given (default: every .json under examples/), using the
// editor's own refreshInstance core (model/design.js) so the semantics — the
// per-unit subunit split, the wired-pin compatibility check, the overrides
// pruning, and the skip rules — are identical to File ▸ Refresh Types.
//
// The file is edited in place, minimally: only components[].typeData and
// overrides change. Wires, buses, vertices, ids, sub-design links, port
// directions, and the derived nets array are untouched — a type refresh does
// not alter connectivity (FR-088), so the saved nets stay valid (A4/FR-059a).
// Output formatting matches the server's design writes (2-space indent,
// trailing newline, §6.5) so diffs show only real changes.
//
// The library comes from the Go parser via `go run ./cmd/dumplib` (srv/), so
// no server needs to be running. Types absent from the library (user GAL
// parts kept elsewhere, sub-design interfaces) are left untouched and
// reported; built-ins (ports, clocks, indicators — client-defined, never in
// the server library) are skipped silently, as in the editor.
//
// Usage: node web/tools/refresh-types.js [file.json | dir] ...

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { refreshInstance, typeIdentity } from "../js/model/design.js";
import { migrate } from "../js/model/persist.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// ---- load the library through the real parser -----------------------------
let library;
try {
  const out = execFileSync("go", ["run", "./cmd/dumplib"], {
    cwd: join(root, "srv"),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  library = JSON.parse(out);
} catch (e) {
  console.error(`refresh-types: cannot dump component library: ${e.message}`);
  process.exit(1);
}
const byId = new Map(library.map((t) => [typeIdentity(t), t]));

// ---- collect target files ---------------------------------------------------
const args = process.argv.slice(2);
const targets = args.length ? args : [join(root, "examples")];
const files = [];
for (const t of targets) {
  const st = statSync(t);
  if (st.isDirectory()) {
    for (const name of readdirSync(t).sort()) {
      if (name.endsWith(".json")) files.push(join(t, name));
    }
  } else {
    files.push(t);
  }
}
if (!files.length) {
  console.error("refresh-types: no .json files found");
  process.exit(1);
}

// ---- refresh each file ------------------------------------------------------
let failures = 0;
for (const file of files) {
  let obj;
  let migrated = false;
  try {
    obj = JSON.parse(readFileSync(file, "utf8"));
    // Bring an older-format file up to the current version first (§7.4) —
    // notably the 1→2 type-id re-key (FR-066e), without which an old save's
    // display-name `type` fields match nothing in the library. This is the
    // same migrate() the editor runs on load, so the written file is exactly
    // what an open → Refresh Types → save round-trip would produce.
    const v = obj.formatVersion ?? 1;
    obj = migrate(obj);
    migrated = obj.formatVersion !== v;
  } catch (e) {
    console.error(`${file}: unreadable (${e.message})`);
    failures++;
    continue;
  }
  let refreshed = 0;
  const skipped = []; // incompatible instances (same rules as the editor)
  const missing = new Set(); // non-builtin types absent from the library
  const rekeyed = []; // instances whose stale `type` was healed from typeData.id
  let changed = migrated;
  for (const inst of obj.components ?? []) {
    if (inst.kind === "subdesign" || !inst.typeData) continue;
    if (inst.typeData.builtin) continue; // client-defined; never in the library
    let libType = byId.get(inst.type);
    if (!libType && inst.typeData.id && byId.has(inst.typeData.id)) {
      // Inconsistent instance: `type` carries an old display name while its
      // own typeData already has the FR-066e id (seen in 74381.json — a v2
      // file whose subunit gates predate the id re-key). Trust the embedded
      // id and heal the `type` field; the editor's Refresh Types would have
      // silently skipped these.
      libType = byId.get(inst.typeData.id);
      inst.type = inst.typeData.id;
      changed = true;
      rekeyed.push(inst.refdes);
    }
    if (!libType) {
      missing.add(inst.typeData.name ?? inst.type);
      continue;
    }
    const before = JSON.stringify([inst.typeData, inst.overrides]);
    const hadOverrides = inst.overrides !== undefined;
    inst.overrides ??= {}; // refreshInstance prunes overrides in place
    const r = refreshInstance(obj, inst, libType);
    if (r.ok) refreshed++;
    else skipped.push(`${inst.refdes} (${libType.partnumber || libType.name}): ${r.skip}`);
    if (!hadOverrides && Object.keys(inst.overrides).length === 0) {
      delete inst.overrides; // don't grow files that never had the field
    }
    if (JSON.stringify([inst.typeData, inst.overrides]) !== before) changed = true;
  }
  if (changed) {
    writeFileSync(file, JSON.stringify(obj, null, 2) + "\n");
  }
  const notes = [
    `refreshed ${refreshed}`,
    ...(migrated ? ["migrated"] : []),
    ...(rekeyed.length ? [`re-keyed stale type ids: ${rekeyed.join(", ")}`] : []),
    changed ? "written" : "unchanged",
    ...(skipped.length ? [`skipped: ${skipped.join("; ")}`] : []),
    ...(missing.size ? [`not in library: ${[...missing].join(", ")}`] : []),
  ];
  console.log(`${file}: ${notes.join(" — ")}`);
}
process.exit(failures ? 1 : 0);
