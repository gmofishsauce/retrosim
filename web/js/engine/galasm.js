// GALasm behavior compiler (§6.13, FR-079). Compiles the equations-only
// dialect of specs/galasmManual.txt §5 — the behavior block of a component
// YAML — into an evaluatable form. Language rules only: the GAL22V10's
// physical capacity (pin count, OLMC pins, product-term limits) does NOT
// constrain a behavior block (manual §5).
//
// Polarity: the project's physical-level convention (design §7.6, stated in
// every behavior block's header): a signal name is the YAML pin name with any
// leading "/" stripped, every signal is implicitly declared active-high, and
// the YAML "/" prefix contributes nothing — the manual's §3.3 declaration/use
// XOR degenerates to the use-negation alone. Literal `/X` is true iff pin X
// reads LOW; LHS `/Y = term` drives pin Y LOW when the term is true.
//
// Compiled form (per type, cached by the caller):
//   {
//     outputs: [ { signal, pin, kind: "plain"|"T"|"R", lhsLow,
//                  terms: [[{signal, low}]],   // sum of products
//                  enable: [{signal, low}]|null } ],   // single .E term
//     ar: [{signal, low}]|null,   // async reset term (manual §3.6)
//     sp: [{signal, low}]|null,   // sync preset term
//   }
// A literal {signal, low} is true iff its net reads (low ? 0 : 1).
// `X = VCC` compiles to terms [[]] (the empty product, always true);
// `X = GND` compiles to terms [] (the empty sum, always false).

// Four-state net values (FR-077), shared with sim.js: logic 0/1, U
// (undefined), Z (high impedance — a tristate net with no enabled driver).
export const V0 = 0;
export const V1 = 1;
export const VU = 2;
export const VZ = 3;

const NAME_RE = /^[A-Za-z0-9]+$/;
const OUTPUT_DIRS = new Set(["out", "bidir", "tristate"]);

// tokenize strips ';' comments and splits the block into tokens: names and
// the single-character operators / ! * & + # = . (manual §2).
function tokenize(text) {
  const tokens = [];
  for (let line of text.split("\n")) {
    const semi = line.indexOf(";");
    if (semi >= 0) line = line.slice(0, semi);
    let i = 0;
    while (i < line.length) {
      const c = line[i];
      if (c === " " || c === "\t" || c === "\r") {
        i++;
      } else if ("/!*&+#=.".includes(c)) {
        tokens.push(c);
        i++;
      } else {
        let j = i;
        while (j < line.length && /[A-Za-z0-9]/.test(line[j])) j++;
        if (j === i) throw new Error(`illegal character ${JSON.stringify(c)}`);
        tokens.push(line.slice(i, j));
        i = j;
      }
    }
  }
  return tokens;
}

// compileBehavior compiles typeData.behavior, or returns null when the type
// declares no behavior block (FR-080). Throws Error with a message naming the
// type on any language-rule violation; sim.js surfaces these at Run preflight.
export function compileBehavior(typeData) {
  if (!typeData.behavior) return null;

  // Signal table from the YAML pin list. The "/" prefix is stripped for the
  // signal name and carries no polarity (physical-level convention above).
  const signals = new Map(); // signal -> { pin, direction }
  for (const p of typeData.pins) {
    const signal = p.name.startsWith("/") ? p.name.slice(1) : p.name;
    signals.set(signal, { pin: p.name, direction: p.direction });
  }

  const fail = (msg) => {
    throw new Error(`${typeData.name}: behavior: ${msg}`);
  };

  // Reserved names (manual §2) would collide with keyword handling below.
  for (const reserved of ["AR", "SP", "VCC", "GND", "NC"]) {
    if (signals.has(reserved)) fail(`pin name ${reserved} is reserved`);
  }

  let tokens;
  try {
    tokens = tokenize(typeData.behavior);
  } catch (e) {
    fail(e.message);
  }
  let pos = 0;
  const peek = (k = 0) => tokens[pos + k];
  const next = () => tokens[pos++];

  // parseName validates lexical rules: letters+digits, ≤8 chars (manual §2).
  function parseName(what) {
    const t = next();
    if (t === undefined) fail(`unexpected end of behavior (expected ${what})`);
    if (!NAME_RE.test(t)) fail(`expected ${what}, got ${JSON.stringify(t)}`);
    if (t.length > 8) fail(`name ${t} longer than 8 characters`);
    return t;
  }

  // parseLiteral: [/|!] NAME with the use-negation captured.
  function parseLiteral() {
    let useNeg = false;
    if (peek() === "/" || peek() === "!") {
      next();
      useNeg = true;
    }
    const name = parseName("a signal name");
    return { name, useNeg };
  }

  // resolveLiteral: under the physical-level convention, `low` is simply the
  // use-negation.
  function resolveLiteral({ name, useNeg }) {
    if (name === "AR" || name === "SP") fail(`${name} may not be used on a right-hand side`);
    if (name === "VCC" || name === "GND") fail(`${name} must be the entire right-hand side`);
    if (!signals.has(name)) fail(`unknown signal ${name}`);
    return { signal: name, low: useNeg };
  }

  // parseRHS: sum-of-products — literals joined by * within a term, terms
  // joined by +. The RHS ends when the token after a literal is not an
  // operator (i.e., the next equation's LHS begins). Returns terms or the
  // VCC/GND marker.
  function parseRHS() {
    const first = parseLiteral();
    if (first.name === "VCC" || first.name === "GND") {
      if (first.useNeg) fail(`/${first.name} is not allowed`);
      if (peek() === "*" || peek() === "&" || peek() === "+" || peek() === "#") {
        fail(`${first.name} may not be combined with operators`);
      }
      return first.name === "VCC" ? [[]] : [];
    }
    const terms = [[resolveLiteral(first)]];
    while (peek() === "*" || peek() === "&" || peek() === "+" || peek() === "#") {
      const op = next();
      const lit = parseLiteral();
      if (lit.name === "VCC" || lit.name === "GND") {
        fail(`${lit.name} may not be combined with operators`);
      }
      if (op === "*" || op === "&") terms[terms.length - 1].push(resolveLiteral(lit));
      else terms.push([resolveLiteral(lit)]);
    }
    return terms;
  }

  const outputs = []; // in declaration order
  const bySignal = new Map(); // signal -> output record (plain/T/R already seen)
  let ar = null;
  let sp = null;

  while (peek() !== undefined) {
    // LHS: [/|!] NAME [. suffix] =
    let useNeg = false;
    if (peek() === "/" || peek() === "!") {
      next();
      useNeg = true;
    }
    const name = parseName("a left-hand-side name");

    // AR / SP (manual §3.6): no suffix, no negation, single term, at most once.
    if (name === "AR" || name === "SP") {
      if (useNeg) fail(`${name} may not be negated`);
      if (peek() === ".") fail(`${name} takes no suffix`);
      if (next() !== "=") fail(`expected = after ${name}`);
      const terms = parseRHS();
      if (terms.length !== 1) fail(`${name} takes exactly one product term`);
      if (name === "AR") {
        if (ar) fail("AR defined twice");
        ar = terms[0];
      } else {
        if (sp) fail("SP defined twice");
        sp = terms[0];
      }
      continue;
    }

    let suffix = null;
    if (peek() === ".") {
      next();
      suffix = parseName("a suffix");
      if (suffix !== "T" && suffix !== "R" && suffix !== "E") {
        fail(`unknown suffix .${suffix} (want .T, .R, or .E)`);
      }
    }
    if (next() !== "=") fail(`expected = after ${suffix ? `${name}.${suffix}` : name}`);

    const sig = signals.get(name);
    if (!sig) fail(`unknown signal ${name} on a left-hand side`);
    if (!OUTPUT_DIRS.has(sig.direction)) {
      fail(`${name} is not an output-capable pin (dir ${sig.direction})`);
    }
    const lhsLow = useNeg;
    const terms = parseRHS();

    if (suffix === "E") {
      // .E: after its output's equation; only on .T/.R; one per pin; LHS not
      // negated; exactly one product term.
      const out = bySignal.get(name);
      if (!out) fail(`.E for ${name} before its output equation`);
      if (out.kind === "plain") fail(`.E on plain output ${name} (must be .T or .R)`);
      if (out.enable) fail(`two .E equations for ${name}`);
      if (lhsLow) fail(`.E left-hand side for ${name} may not be negated`);
      if (terms.length !== 1) fail(`.E for ${name} takes exactly one product term`);
      out.enable = terms[0];
      continue;
    }

    if (bySignal.has(name)) fail(`two output equations for ${name}`);
    const out = {
      signal: name,
      pin: sig.pin,
      kind: suffix ?? "plain",
      lhsLow,
      terms,
      enable: null,
    };
    bySignal.set(name, out);
    outputs.push(out);
  }

  if (outputs.length === 0) fail("no equations found");
  return { outputs, ar, sp };
}

// --- Evaluation (§6.13, FR-077 strict pessimism) ---
//
// readNet(signal) → V0|V1|VU|VZ is supplied by sim.js (signal → pin → net →
// current step's value). Z reads as U; any U operand makes a result U — even
// where two-valued logic could decide (U AND 0 = U), per the stakeholder's
// rule (FR-077, design §8).

// litValue: a literal is true iff its net reads (low ? 0 : 1); U if U/Z.
function litValue(lit, readNet) {
  const v = readNet(lit.signal);
  if (v === VU || v === VZ) return VU;
  return v === (lit.low ? V0 : V1) ? V1 : V0;
}

// evalTerm: AND of the term's literals; the empty product (VCC) is true.
export function evalTerm(term, readNet) {
  let result = V1;
  for (const lit of term) {
    const v = litValue(lit, readNet);
    if (v === VU) return VU; // strict: U regardless of other literals
    if (v === V0) result = V0;
  }
  return result;
}

// evalSum: OR of the terms; the empty sum (GND) is false.
export function evalSum(terms, readNet) {
  let result = V0;
  for (const term of terms) {
    const v = evalTerm(term, readNet);
    if (v === VU) return VU; // strict: U regardless of other terms
    if (v === V1) result = V1;
  }
  return result;
}

// xorLow flips a 0/1 value when the LHS is negated; U passes through.
function xorLow(v, low) {
  if (v === VU || !low) return v;
  return v === V0 ? V1 : V0;
}

// evalOutput returns one output's driver contribution: V0/V1, VU, or VZ when
// a .T/.R enable is false. A plain/.T output drives its sum XOR lhsLow; a .R
// output presents its register XOR lhsLow (the sum is the D input, latched by
// updateRegisters). `registers` maps signal → V0|V1|VU for the instance's .R
// outputs (power-up VU, FR-079).
export function evalOutput(output, readNet, registers) {
  if (output.enable) {
    const e = evalTerm(output.enable, readNet);
    if (e === V0) return VZ;
    if (e === VU) return VU; // uncertain enable: pessimistic U, not Z
  }
  const v =
    output.kind === "R" ? registers.get(output.signal) : evalSum(output.terms, readNet);
  return xorLow(v, output.lhsLow);
}

// updateRegisters advances one instance's .R registers for one unit step
// (called by sim.js *before* outputs are evaluated). On a rising clock edge
// (clockRose, detected by sim.js as a strict 0→1 of the clock net) each
// register latches its sum-of-products D input; SP true at that edge sets all
// registers (manual §3.6). AR is asynchronous: evaluated every step, true
// resets all registers, U forces them U (pessimistic); it overrides the edge.
export function updateRegisters(compiled, readNet, registers, clockRose) {
  if (clockRose) {
    for (const out of compiled.outputs) {
      if (out.kind === "R") registers.set(out.signal, evalSum(out.terms, readNet));
    }
    if (compiled.sp) {
      const s = evalTerm(compiled.sp, readNet);
      if (s !== V0) {
        for (const out of compiled.outputs) {
          if (out.kind === "R") registers.set(out.signal, s === V1 ? V1 : VU);
        }
      }
    }
  }
  if (compiled.ar) {
    const a = evalTerm(compiled.ar, readNet);
    if (a !== V0) {
      for (const out of compiled.outputs) {
        if (out.kind === "R") registers.set(out.signal, a === V1 ? V0 : VU);
      }
    }
  }
}
