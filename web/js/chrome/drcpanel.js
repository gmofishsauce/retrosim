// The design-rule-check report tab (§6.21, FR-124d/e/f/g/i). A third tab kind of
// the docked panel area (FR-123) beside the test-vector panel and the Console.
//
// It is MODELESS and imposes no read-only lock: the design stays fully editable
// while the report is open, which is the entire point of a checker — read a
// finding, fix it, re-run, without dismissing anything. A report is session-only
// view state: closing the tab or reloading the page discards it, and waivers
// (FR-124e), which live in the design, are a check's only durable product.
//
// Everything decidable without a DOM lives in the pure helpers at the top of this
// file (and in engine/drc.js); createDrcPanel is the DOM and store glue over
// them, which is what makes drcpanel.test.js browser-free.

import { runDesignRuleCheck, applyWaivers } from "../engine/drc.js";
import { promptNoteDialog } from "./dialogs.js";
import { listDir } from "../api.js";

// SEVERITY_LABEL is the row prefix (FR-124d) and, lower-cased, the row's CSS
// modifier: `ERROR R1 Output fight on net DATA0: …`.
const SEVERITY_LABEL = { error: "ERROR", warning: "WARN", info: "INFO" };

// waiverKeyOf is the canonical identity of a finding for waiver lookup — the
// same rule + sorted-refs form engine/drc.js matches on (FR-124e). Findings sort
// their refs at construction, so this is a join, not a re-derivation.
export function waiverKeyOf(rule, refs) {
  return `${rule} ${[...refs].sort().join(",")}`;
}

// isStale reports whether the design has changed since the check ran (FR-124i).
// Split out as a pure predicate because it is the whole of the staleness rule:
// `designRev` already counts every design-mutating path (§6.10), so the report
// needs no new store state to know it is describing the past.
export function isStale(designRev, checkedRev) {
  return checkedRev !== null && designRev !== checkedRev;
}

// selectionRefs maps a finding's object refs (§6.21) to store selection refs
// (FR-016a/FR-031), reducing each to its OWNING object: a `refdes.pin` selects
// the instance, and a `conductorId:vertexId` endpoint selects its conductor.
// Duplicates collapse, so a finding naming two pins of one part selects it once.
// `conductorKind` decides wire vs bus from the conductor id, since the store's
// selection refs are typed.
export function selectionRefs(refs, conductorKind = () => "wire") {
  const out = [];
  const seen = new Set();
  const add = (ref, key) => {
    if (seen.has(key)) return;
    seen.add(key);
    out.push(ref);
  };
  for (const ref of refs ?? []) {
    const colon = ref.indexOf(":");
    if (colon >= 0) {
      const id = ref.slice(0, colon);
      const kind = conductorKind(id);
      if (kind) add({ kind, id }, `${kind}:${id}`);
      continue;
    }
    const dot = ref.indexOf(".");
    const refdes = dot < 0 ? ref : ref.slice(0, dot);
    add({ kind: "component", refdes }, `component:${refdes}`);
  }
  return out;
}

// reportText renders the whole report as plain text for Copy (FR-124d): one
// finding per line, active list first, then the waived ones marked as such so a
// pasted report is not silently missing them.
export function reportText({ designName, when, active, waived, waiverOf = () => null }) {
  const line = (f) => `${SEVERITY_LABEL[f.severity]} ${f.rule} ${f.message}`;
  const out = [`Design rule check — ${designName} — ${when}`];
  if (!active.length) out.push("No findings.");
  for (const found of active) out.push(line(found));
  for (const found of waived) {
    const note = waiverOf(found)?.note;
    out.push(`WAIVED ${line(found)}${note ? ` — ${note}` : ""}`);
  }
  return out.join("\n");
}

// createDrcPanel builds the report tab and returns the handle the dock expects
// (§6.16a) plus `run()`, which is the whole Tools ▸ Design Rule Check command.
// Returns an inert handle when the host is missing (headless/unit context),
// matching createDock's posture, so bootstrap order cannot break the page.
export function createDrcPanel({ store, interaction = null } = {}) {
  const host = typeof document === "undefined" ? null : document.getElementById("drc-panel");
  if (!host) {
    return { open() {}, requestClose() {}, isOpen: () => false, run() {} };
  }

  // The report itself: session-only, discarded when the tab closes (FR-124g).
  let findings = []; // every finding of the last run, waived ones included
  let active = [];
  let waived = [];
  let checkedRev = null; // store.state.designRev when the check ran (FR-124i)
  let when = "";
  let designName = "";
  let unsubscribe = null;

  // --- DOM, built once and refilled per run ---
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };

  const header = el("div", "drc-header");
  const title = el("div", "drc-title");
  const copyBtn = el("button", "drc-copy", "Copy");
  copyBtn.type = "button";
  copyBtn.title = "Copy the whole report as plain text";
  header.append(title, copyBtn);

  // The stale banner is built once and only ever has its `hidden` toggled — see
  // the subscriber below, which must not re-render the list.
  const stale = el("div", "drc-stale", "The design has changed since this check ran.");
  stale.hidden = true;

  const notices = el("div", "drc-notices"); // buildNets/probe warnings (§6.21)
  const list = el("div", "drc-list");
  const waivedBox = document.createElement("details");
  waivedBox.className = "drc-waived";
  const waivedSummary = document.createElement("summary");
  waivedBox.append(waivedSummary);
  const waivedList = el("div", "drc-list");
  waivedBox.append(waivedList);

  host.append(header, stale, notices, list, waivedBox);

  // --- rendering ---

  // waiverOf finds the waiver suppressing a finding, for its note and for
  // un-waiving. One Map per render, keyed the way the engine matches (FR-124e).
  let waiverIndex = new Map();
  function reindexWaivers() {
    waiverIndex = new Map();
    for (const waiver of store.design?.drcWaivers ?? []) {
      if (waiver && typeof waiver.rule === "string" && Array.isArray(waiver.refs)) {
        waiverIndex.set(waiverKeyOf(waiver.rule, waiver.refs), waiver);
      }
    }
  }
  const waiverOf = (found) => waiverIndex.get(waiverKeyOf(found.rule, found.refs)) ?? null;

  // row builds one finding row. The row carries its finding's identity in a data
  // attribute rather than a closure per row, so the click handlers below can be
  // delegated: a thousand-finding report costs two listeners, not two thousand.
  function row(found, { waivedRow }) {
    const wrap = el("div", `drc-row drc-${found.severity}${waivedRow ? " drc-row-waived" : ""}`);
    const btn = el("button", "drc-finding");
    btn.type = "button";
    btn.dataset.key = waiverKeyOf(found.rule, found.refs);
    btn.append(
      el("span", "drc-sev", SEVERITY_LABEL[found.severity]),
      el("span", "drc-rule", found.rule),
      el("span", "drc-msg", found.message),
    );
    wrap.append(btn);
    if (waivedRow) {
      const note = waiverOf(found)?.note;
      if (note) wrap.append(el("span", "drc-note", note));
    }
    const action = el("button", "drc-action", waivedRow ? "Un-waive" : "Waive");
    action.type = "button";
    action.dataset.key = btn.dataset.key;
    action.dataset.act = waivedRow ? "unwaive" : "waive";
    wrap.append(action);
    return wrap;
  }

  function render() {
    reindexWaivers();
    title.textContent =
      `${designName} — ${when}` + (store.state.dirty ? " — unsaved changes" : "");
    stale.hidden = !isStale(store.state.designRev ?? 0, checkedRev);

    list.replaceChildren();
    if (!active.length) {
      // FR-124d: a clean run still shows a result rather than an empty panel — a
      // check that sometimes displays nothing cannot be told from a broken menu
      // item. Note this reads "No findings" even when every finding is waived
      // (§12 OQ-014, open and deliberately not softened here).
      list.append(el("div", "drc-empty", "No findings."));
    }
    for (const found of active) list.append(row(found, { waivedRow: false }));

    waivedBox.hidden = waived.length === 0;
    waivedSummary.textContent = `Waived (${waived.length})`;
    waivedList.replaceChildren();
    for (const found of waived) waivedList.append(row(found, { waivedRow: true }));
  }

  function renderNotices(warnings) {
    notices.replaceChildren();
    notices.hidden = warnings.length === 0;
    for (const text of warnings) notices.append(el("div", "drc-notice", text));
  }

  // --- interaction ---

  const findingOf = (key) => findings.find((f) => waiverKeyOf(f.rule, f.refs) === key) ?? null;

  // Clicking a finding selects every object it names and reveals them (FR-124f).
  // On EVERY click, on or off screen, so the gesture has one predictable outcome.
  // A stale finding whose objects are gone selects nothing and moves the view not
  // at all rather than throwing (FR-124i).
  function reveal(found) {
    const conductorKind = (id) => {
      if (store.design?.wires?.some((w) => w.id === id)) return "wire";
      if (store.design?.buses?.some((b) => b.id === id)) return "bus";
      return null;
    };
    const refs = selectionRefs(found.refs, conductorKind);
    store.setSelection(refs);
    interaction?.revealRefs?.(found.refs);
  }

  // Waiving and un-waiving go through applyLive: they dirty the design — it
  // really did change — but stay OUT of the undo history (FR-124e). Ctrl+Z after
  // a waive should undo the user's last wire, not their last waiver, and un-waive
  // is the inverse control anyway. This is the FR-087a input-switch precedent.
  //
  // Neither re-runs the check: waiving changes what is DISPLAYED, not what is
  // true, and re-running is the one thing guaranteed to scroll the report out
  // from under the user. Both re-partition the findings already in hand.
  async function waive(found) {
    const note = await promptNoteDialog(`${found.rule} ${found.message}`);
    if (note === null) return; // cancelled: no waiver, no mutation
    const entry = {
      rule: found.rule,
      refs: [...found.refs],
      ...(note.trim() ? { note: note.trim() } : {}), // empty is absent, not ""
    };
    store.applyLive((design) => {
      (design.drcWaivers ??= []).push(entry);
    });
    repartition();
  }

  function unwaive(found) {
    const key = waiverKeyOf(found.rule, found.refs);
    store.applyLive((design) => {
      const list = design.drcWaivers ?? [];
      const i = list.findIndex(
        (w) =>
          w && typeof w.rule === "string" && Array.isArray(w.refs) && waiverKeyOf(w.rule, w.refs) === key,
      );
      if (i >= 0) list.splice(i, 1);
    });
    repartition();
  }

  function repartition() {
    const split = applyWaivers(findings, store.design?.drcWaivers ?? []);
    active = split.active;
    waived = split.waived;
    render();
  }

  // One delegated listener per list, on the container: rows carry their identity
  // in dataset, so re-rendering never re-binds anything.
  function onClick(e) {
    const action = e.target.closest(".drc-action");
    const found = findingOf((action ?? e.target.closest(".drc-finding"))?.dataset.key);
    if (!found) return;
    if (!action) reveal(found);
    else if (action.dataset.act === "waive") waive(found);
    else unwaive(found);
  }
  list.addEventListener("click", onClick);
  waivedList.addEventListener("click", onClick);

  copyBtn.addEventListener("click", () => {
    navigator.clipboard?.writeText(
      reportText({ designName, when, active, waived, waiverOf }),
    );
  });

  // Staleness is a subscription, not a poll (FR-124i) — and the subscriber
  // toggles the banner's `hidden` and NOTHING else. Re-rendering the findings on
  // every design change would lose the scroll position and the focused row while
  // the user is editing behind the report, which is exactly the workflow the tab
  // exists to allow. The findings stay, still clickable, until the next run.
  function watch() {
    unsubscribe ??= store.subscribe(() => {
      stale.hidden = !isStale(store.state.designRev ?? 0, checkedRev);
    });
  }

  // makeProbe supplies R10's `fileExists` (FR-124a). A port's off-sheet target is
  // a bare sibling filename in the SAME FOLDER as the design (FR-101) — the
  // resolution fileops.followTarget uses — so one listing of that folder answers
  // every target in the design, and the listing is fetched at most once per run.
  //
  // Returns null — no probe at all, so R10 reports NOTHING — when the design has
  // never been saved: with no directory there is nothing to resolve against, and
  // an unanswerable probe must never be turned into a finding.
  function makeProbe() {
    const savePath = store.state.savePath;
    if (!savePath) return null;
    const dir = savePath.replace(/\/[^/]*$/, "") || "/";
    let names = null;
    return async (file) => {
      if (names === null) {
        // A listing failure propagates: the engine turns it into one warning and
        // reports no R10 findings, leaving the other nine rules untouched.
        const listing = await listDir(dir);
        names = new Set((listing.entries ?? []).filter((e) => !e.isDir).map((e) => e.name));
      }
      return names.has(file);
    };
  }

  const api = {
    // open/requestClose are the dock's handle (§6.16a). requestClose is
    // UNGUARDED, unlike the test-vector tab: there is nothing to lose, since a
    // report regenerates in milliseconds and waivers are already in the design.
    open() {
      store.setDrcPanelOpen(true);
      watch();
    },
    requestClose() {
      store.setDrcPanelOpen(false);
      unsubscribe?.();
      unsubscribe = null;
      return true;
    },
    isOpen: () => !!store.state.drcPanelOpen,

    // run is the whole Tools ▸ Design Rule Check command (FR-124). It reads the
    // LIVE in-memory design, unsaved edits included: no save prompt, no refusal,
    // no write — the Export/Generate C policy (FR-119/FR-116).
    async run() {
      const design = store.design;
      const result = await runDesignRuleCheck(design, { fileExists: makeProbe() });
      findings = result.findings;
      // The report is anchored to the exact revision it describes (FR-124i),
      // recorded BEFORE any waiver mutation so a fresh report is never born stale.
      checkedRev = store.state.designRev ?? 0;
      designName = design?.name ?? store.state.designName ?? "untitled";
      when = new Date().toLocaleString();

      const split = applyWaivers(findings, design?.drcWaivers ?? []);
      active = split.active;
      waived = split.waived;
      // Dropping waivers that matched nothing (FR-124e) mutates the design
      // DIRECTLY — bypassing applyLive and every other store path — and notifies
      // nothing. Every store mutator sets `dirty` (§6.10 has no non-dirtying
      // path, by design), and a pure read of the design must not mark it
      // modified: the property FR-116 and FR-119 assert for Generate C and
      // Export. It is safe because what it removes is by construction
      // unreachable — an unmatched waiver names objects that no longer exist, so
      // nothing renders it, nothing indexes it, and no undo entry can reference
      // it. The dead entries leave the file at the next save for any other reason.
      if (split.unmatched.length && Array.isArray(design.drcWaivers)) {
        design.drcWaivers = design.drcWaivers.filter((w) => !split.unmatched.includes(w));
      }

      // Open, or select if open but backgrounded — NEVER close. The menu item is
      // a command, not a panel toggle, and a check that hid its own results would
      // be indefensible (FR-124g), so this deliberately does not route through
      // dock.menuInvoke("drc"), whose third branch closes a frontmost tab.
      if (!api.isOpen()) api.open();
      else store.setDockActive("drc");
      watch();

      renderNotices(result.warnings);
      render();
    },
  };

  return api;
}
