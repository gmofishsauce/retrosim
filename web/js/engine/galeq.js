// GAL equation term table (§6.11, FR-066g): the model behind the New/Edit GAL
// part dialog's clicked sum-of-products grid, and both directions of its
// translation to the GALasm text a component's `behavior` block carries.
//
// Pure and DOM-free, so the whole translation is unit-testable without a dialog.
//
// Model:
//   table[olmcPinNumber] = {
//     mode: "eq" | "const0" | "const1",   // const0/const1 write = GND / = VCC
//     note: string,                        // trailing ";" comment on line 1
//     rows: [ { [pinNumber]: "1" | "0" } ], // one AND term per row, sparse
//   }
// A row is sparse: a pin absent from it is the X (don't-care) cell, so an empty
// row is an empty object. Everything is keyed by **skeleton DIP pin number**,
// never by label — the rule that keeps a pin group intact across a rename
// (FR-066d) — so relabeling a pin carries every term that names it along.
//
// `pins` throughout is the dialog's current pin list, [{ number, name, dir,
// reg }]: `dir` is "in"/"out" as the YAML will carry it, `reg` marks an OLMC
// whose equation heads `.R`.

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
// (not a constant).
export function newOutput() {
  return { mode: "eq", note: "", rows: [{}] };
}

export const rowIsEmpty = (row) => Object.keys(row).length === 0;

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
// negation, `.R` from the OLMC's direction, and the left-hand side taken
// verbatim from the pin label so a "/ENF" pin heads "/ENF = …". An output with
// no surviving row emits nothing at all.
export function tableToBehavior(table, pins) {
  const labelOf = new Map(pins.map((p) => [p.number, p.name]));
  const lines = [];
  const outs = pins
    .filter((p) => p.dir === "out" && p.name !== NC)
    .sort((a, b) => a.number - b.number);
  for (const p of outs) {
    const rec = table[p.number];
    if (!rec) continue;
    const lhs = p.name + (p.reg ? ".R" : "");
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
  return lines.length ? lines.join("\n") + "\n" : "";
}

// tableIssues reports the one rule the table can express but the device cannot
// (FR-066g): pin 1 of a registered part is its clock — named by `clock:` and
// implied by `.R` — and may appear in no equation. The dialog renders that
// column inert once an OLMC is registered, so this catches only a literal set
// before that happened, or one loaded from a file. Returns a message or null.
export function tableIssues(table, pins) {
  const clock = pins.find((p) => p.number === 1);
  if (!clock || !pins.some((p) => p.dir === "out" && p.reg)) return null;
  for (const num of Object.keys(table)) {
    const rec = table[num];
    if (rec.mode !== "eq") continue;
    if (rec.rows.some((r) => r[1] !== undefined)) {
      const label = pins.find((p) => p.number === Number(num))?.name ?? num;
      return `${clock.name} (pin 1) is the clock of a registered part and may not appear in an equation — clear it from ${label}`;
    }
  }
  return null;
}

// --- reading an existing block back into the table (FR-066f/FR-066g) ---

// lex splits the block into tokens, each tagged with its source line, and keeps
// the ";" comment text the table turns into per-output notes. galasm.js's own
// tokenizer discards both, which is why this one exists rather than being
// shared: line structure is how a comment finds its output.
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
// form (.E, .T, .L/.G, .CLK/.ARST/.APRST, :+:, AR, SP) falls out here as a
// refusal rather than being silently dropped by a write that reproduces only
// what the table understood.
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
    const startLine = toks[pos].line;
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
    eqs.push({ lhs, neg, reg: suffix === "R", rhs, startLine, endLine: toks[pos - 1].line });
  }
  return eqs;
}

// noteFor collects the comments belonging to one equation: those inside its own
// lines, those on the lines leading up to it (a comment written above an
// equation is about it), and — for the last equation — any trailing ones.
function noteFor(comments, eqs, i) {
  const eq = eqs[i];
  const prevEnd = i === 0 ? -1 : eqs[i - 1].endLine;
  const isLast = i === eqs.length - 1;
  const mine = comments.filter(
    (c) => (c.line > prevEnd && c.line <= eq.endLine) || (isLast && c.line > eq.endLine),
  );
  return mine.map((c) => c.text).join(" ");
}

// behaviorToTable is the inverse of tableToBehavior and the Edit flow's second
// refusal surface (FR-066f): it returns { table } or { refuse: reason }. It
// declines only what the table cannot represent — never what it merely dislikes;
// the ordinary live gate (compileBehavior + validateStrict, §6.13) still judges
// the equations themselves.
export function behaviorToTable(text, pins) {
  const table = {};
  if (!text || !text.trim()) return { table };

  let lexed;
  let eqs;
  try {
    lexed = lex(text);
    eqs = parseEquations(lexed.toks);
  } catch (e) {
    return { refuse: e.message };
  }

  // Signals resolve to pins by their slash-stripped label; an NC pin owns no
  // signal (FR-062f) and so is absent from the map.
  const bySignal = new Map();
  for (const p of pins) {
    if (p.name === NC) continue;
    bySignal.set(signalOf(p.name), p);
  }

  for (let i = 0; i < eqs.length; i++) {
    const eq = eqs[i];
    const out = bySignal.get(eq.lhs);
    if (!out) return { refuse: `${eq.lhs} on a left-hand side is not a pin of this part` };
    if (out.dir !== "out") return { refuse: `${eq.lhs} heads an equation but is not an output pin` };
    if (table[out.number]) return { refuse: `two equations for ${eq.lhs}` };

    // Polarity lives in the pin label (FR-066g). An equation that disagrees with
    // its label would be re-emitted from the label and so would invert the
    // output — the one refusal that exists to prevent silent damage rather than
    // silent loss.
    const labelLow = out.name.startsWith("/");
    if (eq.neg !== labelLow) {
      return {
        refuse:
          `the equation for ${eq.lhs} is written ${eq.neg ? "active low" : "active high"} ` +
          `but its pin is labeled ${JSON.stringify(out.name)} — ` +
          `label the pin ${JSON.stringify(eq.neg ? "/" + eq.lhs : eq.lhs)} to say the same thing`,
      };
    }

    const rec = { mode: "eq", note: noteFor(lexed.comments, eqs, i), rows: [] };
    if (eq.rhs.constant) {
      rec.mode = eq.rhs.constant === "VCC" ? "const1" : "const0";
      rec.rows = [{}];
      table[out.number] = rec;
      continue;
    }

    let contradiction = null;
    for (const term of eq.rhs.terms) {
      const row = {};
      for (const lit of term) {
        const p = bySignal.get(lit.name);
        if (!p) return { refuse: `unknown signal ${lit.name} in the equation for ${eq.lhs}` };
        if (p.number === out.number) {
          return { refuse: `${eq.lhs} reads itself back; the equation table has no cell for self-feedback` };
        }
        const want = lit.low ? "0" : "1";
        const have = row[p.number];
        // A literal repeated in the same polarity is idempotent and collapses
        // onto its one cell; in both polarities the term is always false, which
        // one cell cannot say.
        if (have !== undefined && have !== want) contradiction = lit.name;
        row[p.number] = want;
      }
      rec.rows.push(row);
    }
    if (contradiction) {
      // The single-term contradiction is the idiom for a hard 0 ("S2 = F0 * !F0")
      // and loads as the constant it is; alongside other terms it is a term the
      // table cannot hold.
      if (eq.rhs.terms.length !== 1) {
        return {
          refuse:
            `the equation for ${eq.lhs} has a term naming ${contradiction} both ways ` +
            `(always false), which a row cannot express — write the output "always 0" instead`,
        };
      }
      rec.mode = "const0";
      rec.rows = [{}];
    }
    normalizeRows(rec);
    table[out.number] = rec;
  }
  return { table };
}
