// GAL equation term table (§6.14, FR-066g): the model behind the New/Edit GAL
// part dialog's clicked sum-of-products grid, and both directions of its
// translation to the GALasm text a component's `behavior` block carries.
//
// Pure and DOM-free, so the whole translation is unit-testable without a dialog.
//
// Model:
//   table[olmcPinNumber] = {
//     mode: "eq" | "const0" | "const1",   // const0/const1 write = GND / = VCC
//     reg: boolean,                        // this output's equations write .R
//     note: string,                        // trailing ";" comment on line 1
//     rows: [ { [pinNumber]: "1" | "0" } ], // one AND term per row, sparse
//   }
//   kept: [ string ]                       // equations the table cannot hold,
//                                          // verbatim, in source order
// A row is sparse: a pin absent from it is the X (don't-care) cell, so an empty
// row is an empty object. Everything is keyed by **skeleton DIP pin number**,
// never by label — the rule that keeps a pin group intact across a rename
// (FR-066d) — so relabeling a pin carries every term that names it along.
//
// `reg` belongs to the output's *equations*, not to its pin: the OLMC type the
// user declares on the Part tab is a separate fact, and the two may disagree
// (FR-066i) — a disagreement is a definition error, never silently resolved.
//
// `pins` throughout is the dialog's current pin list, [{ number, name, dir,
// olmc }]: `dir` is "in"/"out" as the pin is currently configured, and `olmc`
// marks an OLMC pin (DIP 14–23), the only pins that may head an equation.

// The reserved no-connect label (FR-062f): such a pin bears no signal, gets no
// column, and may head no equation.
const NC = "NC";

// A signal name is the pin label with any leading "/" stripped (§7.6's
// physical-level convention): the slash states the pin's polarity, and an
// equation's right-hand side names the signal alone.
export const signalOf = (label) => (label.startsWith("/") ? label.slice(1) : label);

// CELL_CYCLE is the whole rule behind a cell button (FR-066g): X (absent) → 1
// (plain literal) → 0 (negated literal) → X. Absence is the sparse row's
// missing key, so the model stores only "1" and "0".
export function cycleCell(cur) {
  return cur === undefined || cur === "X" ? "1" : cur === "1" ? "0" : undefined;
}

// newOutput is an output's initial state: one empty row, no note, an equation
// (not a constant), registered as the caller says.
export function newOutput(reg = false) {
  return { mode: "eq", reg, note: "", rows: [{}] };
}

export const rowIsEmpty = (row) => Object.keys(row).length === 0;

// hasContent reports whether an output has anything to write: a constant mode,
// or at least one non-empty row. An output without content emits nothing, and
// its reg control still follows the pin's declared type (FR-066g).
export function hasContent(rec) {
  return !!rec && (rec.mode !== "eq" || rec.rows.some((r) => !rowIsEmpty(r)));
}

// normalizeRows keeps an equation output showing at least one row: deleting the
// last row leaves an empty one rather than nothing, since "no rows" and "all
// rows empty" mean the same thing to the emitter (FR-066g) and an output with
// no row at all would have no way back.
export function normalizeRows(rec) {
  if (!rec.rows.length) rec.rows = [{}];
  return rec;
}

// termText renders one row as an AND term, its literals in pin order, or null
// when the row is empty (which contributes nothing — an all-X row is *not* the
// always-true empty product, FR-066g: every added row is born all-X).
function termText(row, labelOf) {
  const nums = Object.keys(row)
    .map(Number)
    .sort((a, b) => a - b);
  if (!nums.length) return null;
  return nums.map((n) => (row[n] === "0" ? "!" : "") + signalOf(labelOf.get(n) ?? String(n))).join(" * ");
}

// tableToBehavior writes the GALasm block the table describes (FR-066g):
// outputs in pin order, one AND term per line, `*` between literals, `+`
// leading each continuation line (aligned under the first term), `!` for
// negation, `.R` from the output's own reg flag, and the left-hand side taken
// verbatim from the pin label so a "/ENF" pin heads "/ENF = …". An output with
// no surviving row emits nothing at all. An OLMC configured as an input still
// writes equations it holds — they are part of what the dialog saves, and the
// definition-error check reports them (FR-066j). The kept equations follow, in
// order, which also keeps an .E after the output it enables.
export function tableToBehavior(table, pins, kept = []) {
  const labelOf = new Map(pins.map((p) => [p.number, p.name]));
  const lines = [];
  const outs = pins.filter((p) => p.name !== NC).sort((a, b) => a.number - b.number);
  for (const p of outs) {
    const rec = table[p.number];
    if (!rec || !(p.dir === "out" || (p.olmc && hasContent(rec)))) continue;
    const lhs = p.name + (rec.reg ? ".R" : "");
    const note = rec.note && rec.note.trim() ? ` ; ${rec.note.trim()}` : "";
    if (rec.mode === "const0" || rec.mode === "const1") {
      lines.push(`${lhs} = ${rec.mode === "const1" ? "VCC" : "GND"}${note}`);
      continue;
    }
    const terms = (rec.rows ?? []).map((r) => termText(r, labelOf)).filter((t) => t !== null);
    if (!terms.length) continue;
    lines.push(`${lhs} = ${terms[0]}${note}`);
    const pad = " ".repeat(lhs.length + 1);
    for (const t of terms.slice(1)) lines.push(`${pad}+ ${t}`);
  }
  for (const k of kept) lines.push(...k.split("\n"));
  return lines.length ? lines.join("\n") + "\n" : "";
}

// --- reading an existing block back into the table (FR-066f/FR-066g) ---

// lex splits one equation chunk into tokens, each tagged with its source line,
// and keeps the ";" comment text the table turns into per-output notes.
// galasm.js's own tokenizer discards both, which is why this one exists rather
// than being shared.
function lex(text) {
  const toks = [];
  const comments = [];
  const lines = text.split("\n");
  for (let li = 0; li < lines.length; li++) {
    let line = lines[li];
    const semi = line.indexOf(";");
    if (semi >= 0) {
      const c = line.slice(semi + 1).trim();
      if (c) comments.push({ line: li, text: c });
      line = line.slice(0, semi);
    }
    let i = 0;
    while (i < line.length) {
      const c = line[i];
      if (c === " " || c === "\t" || c === "\r") {
        i++;
      } else if ("/!*&+#=.".includes(c)) {
        toks.push({ t: c, line: li });
        i++;
      } else if (c === ":") {
        if (line.slice(i, i + 3) === ":+:") {
          toks.push({ t: ":+:", line: li });
          i += 3;
        } else {
          throw new Error('illegal character ":"');
        }
      } else {
        let j = i;
        while (j < line.length && /[A-Za-z0-9]/.test(line[j])) j++;
        if (j === i) throw new Error(`illegal character ${JSON.stringify(c)}`);
        toks.push({ t: line.slice(i, j), line: li });
        i = j;
      }
    }
  }
  return { toks, comments };
}

// parseEquations recognizes exactly the two forms the table authors —
//   [/|!] NAME [.R] = <sum of products>
//   NAME [.R] = VCC | GND
// — and nothing else. The narrowness is the point (FR-066g): every unsupported
// form (.E, .T, .L/.G, .CLK/.ARST/.APRST, :+:, AR, SP) throws here, and its chunk
// is kept as written rather than being silently dropped by a write that
// reproduces only what the table understood.
function parseEquations(toks) {
  let pos = 0;
  const peek = () => toks[pos]?.t;
  const eqs = [];
  const NAME_RE = /^[A-Za-z0-9]+$/;

  const name = (what) => {
    const t = toks[pos++];
    if (!t || !NAME_RE.test(t.t)) throw new Error(`expected ${what}, got ${t ? JSON.stringify(t.t) : "end of block"}`);
    return t.t;
  };

  const literal = () => {
    let low = false;
    if (peek() === "/" || peek() === "!") {
      pos++;
      low = true;
    }
    return { name: name("a signal name"), low };
  };

  while (pos < toks.length) {
    let neg = false;
    if (peek() === "/" || peek() === "!") {
      pos++;
      neg = true;
    }
    const lhs = name("a left-hand-side name");
    if (lhs === "AR" || lhs === "SP") {
      throw new Error(`${lhs} equations are not authored by the equation table`);
    }
    let suffix = null;
    if (peek() === ".") {
      pos++;
      suffix = name("a suffix");
      if (suffix !== "R") {
        throw new Error(`.${suffix} equations are not authored by the equation table`);
      }
    }
    if (peek() !== "=") throw new Error(`expected = after ${lhs}`);
    pos++;

    const first = literal();
    let rhs;
    if (first.name === "VCC" || first.name === "GND") {
      if (first.low) throw new Error(`/${first.name} is not allowed`);
      if (["*", "&", "+", "#"].includes(peek())) throw new Error(`${first.name} may not be combined with operators`);
      rhs = { constant: first.name };
    } else {
      const terms = [[first]];
      while (["*", "&", "+", "#"].includes(peek())) {
        const op = toks[pos++].t;
        const lit = literal();
        if (lit.name === "VCC" || lit.name === "GND") {
          throw new Error(`${lit.name} may not be combined with operators`);
        }
        if (op === "*" || op === "&") terms[terms.length - 1].push(lit);
        else terms.push([lit]);
      }
      rhs = { terms };
    }
    if (peek() === ":+:") throw new Error("XOR (:+:) is not authored by the equation table");
    eqs.push({ lhs, neg, reg: suffix === "R", rhs });
  }
  return eqs;
}

// splitChunks divides a behavior block into equation chunks, each a run of
// source lines (FR-066g): a chunk opens at a line whose code starts a new
// left-hand side and runs through its continuation lines — a line whose code
// begins with an operator, or follows one ending with an operator or `=`.
// Comment-only and blank lines belong to the equation below them (a comment
// written above an equation is about it); any after the last equation join it.
// A block of nothing but comments is one chunk of its own.
function splitChunks(text) {
  const chunks = [];
  let pending = [];
  let cur = null;
  for (const raw of text.split("\n")) {
    const semi = raw.indexOf(";");
    const code = (semi >= 0 ? raw.slice(0, semi) : raw).trim();
    if (!code) {
      pending.push(raw);
      continue;
    }
    if (cur && (/^[+*&#]/.test(code) || /[+*&#=]$/.test(cur.lastCode))) {
      cur.lines.push(...pending, raw);
    } else {
      cur = { lines: [...pending, raw], lastCode: "" };
      chunks.push(cur);
    }
    pending = [];
    cur.lastCode = code;
  }
  if (cur) cur.lines.push(...pending);
  else if (pending.some((l) => l.trim())) chunks.push({ lines: pending });
  // Blank lines at a chunk's edges carry nothing worth keeping verbatim.
  return chunks.map((c) => {
    const lines = c.lines.slice();
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    return lines.join("\n");
  });
}

// behaviorToTable is the inverse of tableToBehavior, and it refuses nothing
// (FR-066j): it returns { table, kept }, where each chunk the recognizer accepts
// becomes an output's rows and each it declines is kept verbatim. It declines
// only what the table cannot represent — never what it merely dislikes; the
// definition-error check (galerrors.js) judges the equations themselves.
export function behaviorToTable(text, pins) {
  const table = {};
  const kept = [];
  if (!text || !text.trim()) return { table, kept };

  // Signals resolve to pins by their slash-stripped label; an NC pin owns no
  // signal (FR-062f) and so is absent from the map.
  const bySignal = new Map();
  for (const p of pins) {
    if (p.name === NC) continue;
    bySignal.set(signalOf(p.name), p);
  }

  for (const chunk of splitChunks(text)) {
    const rec = chunkToOutput(chunk, bySignal, table);
    if (rec) table[rec.number] = rec.rec;
    else kept.push(chunk);
  }
  return { table, kept };
}

// chunkToOutput reads one chunk as one table output, or returns null when the
// table cannot hold it: not exactly one recognized equation, a left-hand side
// that is not an OLMC pin, a second equation for an output already read, an
// LHS negation that disagrees with the pin's label (polarity lives in the label,
// FR-066g, so re-emitting it would invert the output), an unknown signal,
// self-feedback, or a term naming one signal both ways alongside other terms.
function chunkToOutput(chunk, bySignal, table) {
  let lexed;
  let eqs;
  try {
    lexed = lex(chunk);
    eqs = parseEquations(lexed.toks);
  } catch {
    return null;
  }
  if (eqs.length !== 1) return null;
  const eq = eqs[0];
  const out = bySignal.get(eq.lhs);
  if (!out || !(out.olmc || out.dir === "out")) return null;
  if (table[out.number]) return null;
  if (eq.neg !== out.name.startsWith("/")) return null;

  const rec = { mode: "eq", reg: eq.reg, note: lexed.comments.map((c) => c.text).join(" "), rows: [] };
  if (eq.rhs.constant) {
    rec.mode = eq.rhs.constant === "VCC" ? "const1" : "const0";
    rec.rows = [{}];
    return { number: out.number, rec };
  }

  let contradiction = false;
  for (const term of eq.rhs.terms) {
    const row = {};
    for (const lit of term) {
      const p = bySignal.get(lit.name);
      if (!p || p.number === out.number) return null;
      const want = lit.low ? "0" : "1";
      // A literal repeated in the same polarity is idempotent and collapses onto
      // its one cell; in both polarities the term is always false, which one
      // cell cannot say.
      if (row[p.number] !== undefined && row[p.number] !== want) contradiction = true;
      row[p.number] = want;
    }
    rec.rows.push(row);
  }
  if (contradiction) {
    // The single-term contradiction is the idiom for a hard 0 ("S2 = F0 * !F0")
    // and loads as the constant it is; alongside other terms it is a term the
    // table cannot hold.
    if (eq.rhs.terms.length !== 1) return null;
    rec.mode = "const0";
    rec.rows = [{}];
  }
  normalizeRows(rec);
  return { number: out.number, rec };
}
