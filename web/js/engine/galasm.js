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
//                  xor: [ terms, … ],          // :+: groups XORed with terms (FR-079a)
//                  enable: [{signal, low}]|null,       // single .E term
//                  clk, arst, aprst: term|null } ],    // GAL20RA10 per-output (FR-079a)
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
// "internal" is the synthetic direction of a buried registered node (FR-079c):
// output-capable so it may head a .R equation, though it drives no pin.
const OUTPUT_DIRS = new Set(["out", "bidir", "tristate", "internal"]);

// GAL_DEVICES drives strict validation (FR-079b): the cheap, exact per-device
// limits. `ioPins` is the device's pin count minus the two power/ground pins
// (not represented in the YAML). `maxTerms` is the device's largest per-OLMC
// product-term capacity (the position-specific 22V10 profile is not enforced —
// physical OLMC pins are not assigned here). `ar` = supports AR/SP (22V10 only);
// `ra10` = supports per-output .CLK/.ARST/.APRST (GAL20RA10 only); `eOnReg` =
// allows .E on a registered output (the 16V8 forbids it, manual §6).
const GAL_DEVICES = {
  GAL16V8: { ioPins: 18, olmc: 8, maxTerms: 8, ar: false, ra10: false, eOnReg: false },
  GAL20V8: { ioPins: 22, olmc: 8, maxTerms: 8, ar: false, ra10: false, eOnReg: true },
  GAL22V10: { ioPins: 22, olmc: 10, maxTerms: 16, ar: true, ra10: false, eOnReg: true },
  GAL20RA10: { ioPins: 22, olmc: 10, maxTerms: 8, ar: false, ra10: true, eOnReg: true },
};

// validateStrict enforces a named GAL device's language subset and capacity
// (FR-079b). It is a pure accept/reject gate run only when `gal:` is set: it
// never alters the compiled form, so a block that passes evaluates identically
// to the extended dialect. The first violation throws via `fail` (preflight
// refuses to start). The product-term check counts terms as written (no
// minimization), so it is conservative — it may reject a block real GALasm
// would fit after reduction.
function validateStrict(typeData, compiled, fail) {
  const dev = GAL_DEVICES[typeData.gal];
  if (!dev) fail(`unknown gal device ${typeData.gal}`);
  const d = typeData.gal;
  for (const out of compiled.outputs) {
    if (out.xor.length) {
      fail(`${d} has no XOR operator (:+:) — XOR is extended-dialect only`);
    }
    if ((out.clk || out.arst || out.aprst) && !dev.ra10) {
      fail(`${d} has no per-output .CLK/.ARST/.APRST (GAL20RA10 only)`);
    }
    if (dev.ra10 && out.kind === "R" && !out.clk) {
      fail(`${d} registered output ${out.signal} requires a .CLK equation`);
    }
    if (out.kind === "R" && out.enable && !dev.eOnReg) {
      fail(`${d} does not allow .E on the registered output ${out.signal}`);
    }
    if (out.terms.length > dev.maxTerms) {
      fail(
        `${out.signal}: ${out.terms.length} product terms exceed ${d}'s ${dev.maxTerms}-term capacity ` +
          `(counted as written; no minimization)`,
      );
    }
  }
  if ((compiled.ar || compiled.sp) && !dev.ar) {
    fail(`${d} has no AR/SP (GAL22V10 only)`);
  }
  if (compiled.outputs.length > dev.olmc) {
    fail(`${compiled.outputs.length} outputs exceed ${d}'s ${dev.olmc} OLMCs`);
  }
  if (typeData.pins.length > dev.ioPins) {
    fail(`${typeData.pins.length} pins exceed ${d}'s ${dev.ioPins} usable I/O pins`);
  }
}

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
      } else if (c === ":") {
        // XOR is the multi-char token :+: (PALASM spelling, FR-079a).
        if (line.slice(i, i + 3) === ":+:") {
          tokens.push(":+:");
          i += 3;
        } else {
          throw new Error('illegal character ":" (XOR is spelled :+:)');
        }
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

  // Buried internal nodes (FR-079c): seed the signal table alongside the pins,
  // each with a synthetic "internal" direction (output-capable, above) and no
  // pin. Buried nodes and pins share one signal namespace, so the same lexical,
  // reserved-word, and collision rules that guard pin signals guard these.
  const internalNodes = typeData.internal ?? [];
  for (const node of internalNodes) {
    if (!NAME_RE.test(node) || node.length > 8) {
      fail(`internal node ${JSON.stringify(node)} is not a legal signal name`);
    }
    if (["AR", "SP", "VCC", "GND", "NC"].includes(node)) {
      fail(`internal node name ${node} is reserved`);
    }
    if (signals.has(node)) {
      fail(`internal node ${node} collides with an existing signal (a pin or another internal node)`);
    }
    signals.set(node, { pin: null, direction: "internal" });
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
      if (peek() === ":+:") fail(`${name} may not use XOR (:+:)`);
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
      if (!["T", "R", "E", "CLK", "ARST", "APRST"].includes(suffix)) {
        fail(`unknown suffix .${suffix} (want .T, .R, .E, .CLK, .ARST, or .APRST)`);
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
    // XOR groups (FR-079a): the output's value is `terms` XORed with each
    // :+:-joined sum-of-products group. Empty for the common (non-XOR) case.
    const xor = [];
    while (peek() === ":+:") {
      next();
      xor.push(parseRHS());
    }

    if (suffix === "E") {
      // .E: after its output's equation; only on .T/.R; one per pin; LHS not
      // negated; exactly one product term.
      const out = bySignal.get(name);
      if (!out) fail(`.E for ${name} before its output equation`);
      if (out.kind === "plain") fail(`.E on plain output ${name} (must be .T or .R)`);
      if (out.enable) fail(`two .E equations for ${name}`);
      if (lhsLow) fail(`.E left-hand side for ${name} may not be negated`);
      if (xor.length) fail(`.E for ${name} may not use XOR (:+:)`);
      if (terms.length !== 1) fail(`.E for ${name} takes exactly one product term`);
      out.enable = terms[0];
      continue;
    }

    // .CLK/.ARST/.APRST (GAL20RA10, FR-079a): per-output clock and async
    // reset/preset, each a single product term, after the output's .R equation.
    if (suffix === "CLK" || suffix === "ARST" || suffix === "APRST") {
      const out = bySignal.get(name);
      if (!out) fail(`.${suffix} for ${name} before its output equation`);
      if (out.kind !== "R") fail(`.${suffix} on ${name} requires a registered (.R) output`);
      if (lhsLow) fail(`.${suffix} left-hand side for ${name} may not be negated`);
      if (xor.length) fail(`.${suffix} for ${name} may not use XOR (:+:)`);
      if (terms.length !== 1) fail(`.${suffix} for ${name} takes exactly one product term`);
      const key = suffix === "CLK" ? "clk" : suffix === "ARST" ? "arst" : "aprst";
      if (out[key]) fail(`two .${suffix} equations for ${name}`);
      out[key] = terms[0];
      continue;
    }

    if (bySignal.has(name)) fail(`two output equations for ${name}`);
    const out = {
      signal: name,
      pin: sig.pin,
      kind: suffix ?? "plain",
      lhsLow,
      terms,
      xor,
      enable: null,
      clk: null, // per-output clock term (.CLK); null ⇒ uses the global clock: pin
      arst: null, // per-output async reset term (.ARST)
      aprst: null, // per-output async preset term (.APRST)
    };
    bySignal.set(name, out);
    outputs.push(out);
  }

  if (outputs.length === 0) fail("no equations found");

  // Every declared buried node must be defined by exactly one registered (.R)
  // equation (FR-079c). "Exactly one" already holds — a second equation for the
  // signal failed above as "two output equations". A missing definition, or one
  // that is plain/.T (never .E, which needs a prior .T/.R), is caught here.
  for (const node of internalNodes) {
    const out = bySignal.get(node);
    if (!out) fail(`internal node ${node} has no .R equation`);
    if (out.kind !== "R") fail(`internal node ${node} must be defined by a registered (.R) equation`);
  }

  const compiled = { outputs, ar, sp };
  // Strict device gate (FR-079b): only when `gal:` names a device. Never alters
  // `compiled` — a passing block evaluates identically to extended mode.
  if (typeData.gal) validateStrict(typeData, compiled, fail);
  return compiled;
}

// --- Evaluation (§6.13, FR-077 selective pessimism) ---
//
// readNet(signal) → V0|V1|VU|VZ is supplied by sim.js (signal → pin → net →
// current step's value). Z reads as U. Combination is selectively pessimistic,
// as real logic permits: 0 AND x = 0 and 1 OR x = 1 regardless of U operands;
// every other combination with a U operand yields U (FR-077, design §8 —
// reworked 2026-06-12 from strict pessimism, under which registered feedback
// could never be initialized: 0 AND U = U made a held clear/load ineffective).

// litValue: a literal is true iff its net reads (low ? 0 : 1); U if U/Z.
function litValue(lit, readNet) {
  const v = readNet(lit.signal);
  if (v === VU || v === VZ) return VU;
  return v === (lit.low ? V0 : V1) ? V1 : V0;
}

// evalTerm: AND of the term's literals; the empty product (VCC) is true.
// Any false literal decides the product (0 AND U = 0); otherwise any U
// literal makes it U.
export function evalTerm(term, readNet) {
  let sawU = false;
  for (const lit of term) {
    const v = litValue(lit, readNet);
    if (v === V0) return V0; // 0 dominates, even over U operands
    if (v === VU) sawU = true;
  }
  return sawU ? VU : V1;
}

// evalSum: OR of the terms; the empty sum (GND) is false. Any true term
// decides the sum (1 OR U = 1); otherwise any U term makes it U.
export function evalSum(terms, readNet) {
  let sawU = false;
  for (const term of terms) {
    const v = evalTerm(term, readNet);
    if (v === V1) return V1; // 1 dominates, even over U terms
    if (v === VU) sawU = true;
  }
  return sawU ? VU : V0;
}

// xorLow flips a 0/1 value when the LHS is negated; U passes through.
function xorLow(v, low) {
  if (v === VU || !low) return v;
  return v === V0 ? V1 : V0;
}

// xorValues: XOR of two 0/1/U values (FR-079a). XOR has no controlling value,
// so any U operand yields U (full pessimism); otherwise equal → 0, differ → 1.
function xorValues(a, b) {
  if (a === VU || b === VU) return VU;
  return a === b ? V0 : V1;
}

// evalCombinational: an output's combinational value — its sum-of-products
// (`terms`) XORed with each `:+:` group (`xor`, FR-079a). With no XOR groups
// this is exactly evalSum(terms).
export function evalCombinational(output, readNet) {
  let v = evalSum(output.terms, readNet);
  for (const group of output.xor ?? []) {
    v = xorValues(v, evalSum(group, readNet));
  }
  return v;
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
    output.kind === "R" ? registers.get(output.signal) : evalCombinational(output, readNet);
  return xorLow(v, output.lhsLow);
}

// updateRegisters advances one instance's .R registers for one unit step
// (called by sim.js *before* outputs are evaluated, every step). Registers come
// in two families (FR-079a/FR-062d):
//
//   • Global-clock registers — a .R output with no .CLK. They latch on
//     `globalRose` (sim.js detects the 0→1 of the type's `clock:` net); the
//     global SP sets them at that edge and the global AR resets them
//     asynchronously (manual §3.6). This is the GAL16V8/20V8/22V10 model.
//   • Per-output-clock registers — a .R output carrying a GAL20RA10 `.CLK`
//     term. Each latches on the rising edge of *its own* clock term (edge
//     detected here against `clockPrev`, a signal→prev-value map the entity
//     persists), and applies its own async `.APRST` (set) and `.ARST` (reset)
//     every step. The global SP/AR do not touch these.
//
// U on a reset/preset/clock forces the affected register U (pessimistic).
export function updateRegisters(compiled, readNet, registers, globalRose, clockPrev) {
  for (const out of compiled.outputs) {
    if (out.kind !== "R") continue;
    if (out.clk) {
      const cur = evalTerm(out.clk, readNet);
      const prev = clockPrev.get(out.signal);
      if (prev === V0 && cur === V1) {
        registers.set(out.signal, evalCombinational(out, readNet));
      }
      clockPrev.set(out.signal, cur);
      if (out.aprst) {
        const p = evalTerm(out.aprst, readNet);
        if (p !== V0) registers.set(out.signal, p === V1 ? V1 : VU);
      }
      if (out.arst) {
        const a = evalTerm(out.arst, readNet);
        if (a !== V0) registers.set(out.signal, a === V1 ? V0 : VU); // reset wins over preset
      }
    } else if (globalRose) {
      registers.set(out.signal, evalCombinational(out, readNet));
    }
  }

  // Global SP (synchronous preset) and AR (asynchronous reset) apply only to
  // global-clock registers (those without their own .CLK).
  if (globalRose && compiled.sp) {
    const s = evalTerm(compiled.sp, readNet);
    if (s !== V0) {
      for (const out of compiled.outputs) {
        if (out.kind === "R" && !out.clk) registers.set(out.signal, s === V1 ? V1 : VU);
      }
    }
  }
  if (compiled.ar) {
    const a = evalTerm(compiled.ar, readNet);
    if (a !== V0) {
      for (const out of compiled.outputs) {
        if (out.kind === "R" && !out.clk) registers.set(out.signal, a === V1 ? V0 : VU);
      }
    }
  }
}
