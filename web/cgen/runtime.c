/* runtime.c — fast-engine C runtime implementation (design.md §6.17,
 * FR-116a). See runtime.h for the API and the gen_* interface the
 * generated <design>.c implements.
 *
 * Every semantic here re-expresses the editor's slow (debug) simulator —
 * the authoritative reference implementations are web/js/engine/sim.js
 * (net resolution, step loop) and web/js/engine/galasm.js (value
 * combination). The two engines must agree bit-for-bit (FR-107); when in
 * doubt, mirror those files.
 */

#include "runtime.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* ------------------------------------------------------------------ *
 *  Four-state combination (FR-077; galasm.js litValue/evalTerm/evalSum)
 * ------------------------------------------------------------------ */

/* A component reading Z treats it as U (FR-077): normalize before
 * combining, so the ops below only ever see 0/1/U — exactly what
 * galasm.js guarantees via litValue. */
static rt_val norm(rt_val v) { return v == RT_Z ? RT_U : v; }

/* AND: any 0 operand decides (0 AND U = 0); otherwise any U → U. */
rt_val rt_and(rt_val a, rt_val b) {
  a = norm(a);
  b = norm(b);
  if (a == RT_0 || b == RT_0) return RT_0;
  if (a == RT_U || b == RT_U) return RT_U;
  return RT_1;
}

/* OR: any 1 operand decides (1 OR U = 1); otherwise any U → U. */
rt_val rt_or(rt_val a, rt_val b) {
  a = norm(a);
  b = norm(b);
  if (a == RT_1 || b == RT_1) return RT_1;
  if (a == RT_U || b == RT_U) return RT_U;
  return RT_0;
}

/* NOT: U → U; else flip. */
rt_val rt_not(rt_val a) {
  a = norm(a);
  if (a == RT_U) return RT_U;
  return a == RT_0 ? RT_1 : RT_0;
}

/* Non-inverting buffer: just the read normalization (see norm above). */
rt_val rt_buf(rt_val a) { return norm(a); }

/* XOR (extended dialect, FR-079a): no controlling value, so any U
 * operand → U (full pessimism); else equal → 0, differ → 1. Mirrors
 * galasm.js xorValues. */
rt_val rt_xor(rt_val a, rt_val b) {
  a = norm(a);
  b = norm(b);
  if (a == RT_U || b == RT_U) return RT_U;
  return a == b ? RT_0 : RT_1;
}

/* ------------------------------------------------------------------ *
 *  Net state and contributions
 * ------------------------------------------------------------------ */

/* Double-buffered net values (FR-078): every evaluate reads `curr_buf`
 * (the previous step's values) while resolution writes `next_buf`; the
 * buffers swap at the end of each step. */
static rt_val *curr_buf;
static rt_val *next_buf;

/* Per-net conflict flag, so a bus conflict is reported once, on onset,
 * and re-armed when the conflict clears (FR-082; sim.js conflictedNets). */
static unsigned char *conflicted;

/* One step's driver contributions, bucketed per net as singly-linked
 * lists threaded through `link` (head[net] → first contribution index,
 * -1 terminates). Capacity gen_max_contribs is a generate-time bound, so
 * there is no reallocation in the step loop. */
struct contrib {
  rt_val v;           /* RT_0, RT_1, or RT_U (never RT_Z; see rt_contrib) */
  unsigned char weak; /* pull-up/pull-down tier (FR-083) */
  int label;          /* gen_labels index, for conflict reports */
  int link;           /* next contribution on the same net, or -1 */
};
static struct contrib *contribs;
static int *head;    /* per net */
static int ncontrib; /* used entries in contribs[] this step */

static void *xalloc(size_t n) {
  void *p = malloc(n ? n : 1); /* degenerate (empty) designs: never malloc(0) */
  if (!p) {
    fprintf(stderr, "out of memory\n");
    exit(2);
  }
  return p;
}

/* Per-input-column port stimulus (FR-115f): the current forced value for
 * an RT_COL_PORT column, or RT_Z when not driving. The vector runner sets
 * these row by row; drive_builtins deposits them each step. */
static rt_val *port_stim;

static void mem_alloc(void); /* memory store allocation (FR-114d) */
static void mem_reset(void); /* memory power-up: RAM U, ROM baked bytes */

/* reset_state returns every net to power-up Z and all generated state to
 * power-up via gen_init() — the C analogue of the slow simulator building
 * a fresh simulation, which the combinational vector path does per row
 * (FR-115c). */
static void reset_state(void) {
  memset(curr_buf, RT_Z, (size_t)gen_net_count);
  memset(next_buf, RT_Z, (size_t)gen_net_count);
  memset(conflicted, 0, (size_t)gen_net_count);
  gen_init();
  mem_reset();
}

void rt_init(void) {
  curr_buf = xalloc((size_t)gen_net_count);
  next_buf = xalloc((size_t)gen_net_count);
  conflicted = xalloc((size_t)gen_net_count);
  contribs = xalloc((size_t)gen_max_contribs * sizeof contribs[0]);
  head = xalloc((size_t)gen_net_count * sizeof head[0]);
  port_stim = xalloc((size_t)(gen_incol_count > 0 ? gen_incol_count : 1));
  memset(port_stim, RT_Z, (size_t)(gen_incol_count > 0 ? gen_incol_count : 1));
  mem_alloc();
  reset_state();
}

const rt_val *rt_curr(void) { return curr_buf; }

void rt_contrib(int net, rt_val v, int weak, int label) {
  if (net < 0 || v == RT_Z) return; /* disabled/unwired: not driving (FR-081) */
  if (ncontrib >= gen_max_contribs) {
    /* Cannot happen for correctly generated code: gen_max_contribs bounds
     * the total driver count. A trip here is a generator bug. */
    fprintf(stderr, "internal error: contribution buffer overflow\n");
    exit(2);
  }
  struct contrib *c = &contribs[ncontrib];
  c->v = norm(v);
  c->weak = (unsigned char)(weak != 0);
  c->label = label;
  c->link = head[net];
  head[net] = ncontrib++;
}

/* ------------------------------------------------------------------ *
 *  Net resolution (FR-081–FR-083, FR-108; sim.js resolveNet)
 * ------------------------------------------------------------------ */

/* resolve_net computes one net's next value from its contributions.
 * Enabled strong drivers win: weak (pull) contributions decide only when
 * there is no strong contribution at all — a strong U still suppresses
 * every weak driver (FR-083). Within the deciding tier: a 0-vs-1
 * disagreement is a bus conflict → U, reported to stderr on onset naming
 * two of the disagreeing drivers (FR-082/FR-108/FR-118); else any U → U;
 * else the agreed value. No contribution at all → Z. */
static rt_val resolve_net(int n) {
  /* One pass, tallying both tiers; then judge the deciding tier. */
  int s_zero = -1, s_one = -1, s_anyU = 0, s_count = 0;
  int w_zero = -1, w_one = -1, w_anyU = 0, w_count = 0;
  for (int i = head[n]; i != -1; i = contribs[i].link) {
    const struct contrib *c = &contribs[i];
    if (c->weak) {
      w_count++;
      if (c->v == RT_0) w_zero = c->label;
      else if (c->v == RT_1) w_one = c->label;
      else w_anyU = 1;
    } else {
      s_count++;
      if (c->v == RT_0) s_zero = c->label;
      else if (c->v == RT_1) s_one = c->label;
      else s_anyU = 1;
    }
  }

  int zero, one, anyU;
  if (s_count > 0) {
    zero = s_zero, one = s_one, anyU = s_anyU;
  } else if (w_count > 0) {
    zero = w_zero, one = w_one, anyU = w_anyU;
  } else {
    conflicted[n] = 0;
    return RT_Z;
  }

  if (zero >= 0 && one >= 0) {
    if (!conflicted[n]) {
      conflicted[n] = 1;
      fprintf(stderr, "bus conflict: %s vs %s\n", gen_labels[one],
              gen_labels[zero]);
    }
    return RT_U;
  }
  conflicted[n] = 0;
  if (anyU) return RT_U;
  return one >= 0 ? RT_1 : RT_0;
}

/* ------------------------------------------------------------------ *
 *  Built-in drivers (FR-116a; behaviors live here, instances are
 *  generated tables)
 * ------------------------------------------------------------------ */

/* drive_builtins deposits the runtime-owned drivers each step: weak pulls
 * (FR-083), input switches at their current level (FR-071c/FR-087a —
 * strong, never U or Z), clock generators at their scripted level
 * (FR-115e; the vector runner owns `level`), and power-on resets
 * (FR-071b: R=1,/R=0 while asserting, the inverse once released). */
static void drive_builtins(void) {
  for (int i = 0; i < gen_pull_count; i++) {
    const rt_pull *p = &gen_pulls[i];
    rt_contrib(p->net, p->value, 1, p->label);
  }
  for (int i = 0; i < gen_switch_count; i++) {
    const rt_switch *s = &gen_switches[i];
    rt_contrib(s->net, s->level, 0, s->label);
  }
  for (int i = 0; i < gen_clock_count; i++) {
    const rt_clock *c = &gen_clocks[i];
    rt_contrib(c->net, c->level, 0, c->label);
  }
  for (int i = 0; i < gen_reset_count; i++) {
    const rt_reset *r = &gen_resets[i];
    rt_contrib(r->r_net, r->released ? RT_0 : RT_1, 0, r->r_label);
    rt_contrib(r->rn_net, r->released ? RT_1 : RT_0, 0, r->rn_label);
  }
  for (int i = 0; i < gen_incol_count; i++) {
    if (gen_incols[i].kind == RT_COL_PORT && port_stim[i] != RT_Z) {
      rt_contrib(gen_incols[i].ref, port_stim[i], 0, gen_incols[i].label);
    }
  }
}

/* ------------------------------------------------------------------ *
 *  Memory devices (FR-114d; memory.js createMemoryCore re-expressed).
 *  Runtime-owned: gen_mems is const wiring + baked ROM bytes; the mutable
 *  store (2^abits × width, RAM power-up U, ROM seeded) and WE/-edge state
 *  live here.
 * ------------------------------------------------------------------ */

static struct mem_state {
  rt_val *store;  /* (2^abits) * width, addressed word-major */
  rt_val prev_we; /* WE/ rising-edge detection (RAM) */
} *mem_states;

/* mem_rd reads a memory pin's net from curr, normalizing Z→U and treating
 * an unwired pin (net -1) as U (FR-077), exactly like memory.js's read. */
static rt_val mem_rd(const rt_val *curr, int net) {
  return net < 0 ? RT_U : norm(curr[net]);
}

/* mem_decode resolves A0(LSB)..A(abits-1) to an address, or -1 when any
 * address bit is not a clean 0/1 (undecodable, memory.js decodeAddr). */
static long mem_decode(const rt_mem *m, const rt_val *curr) {
  long addr = 0;
  for (int i = 0; i < m->abits; i++) {
    rt_val b = mem_rd(curr, m->addr[i]);
    if (b != RT_0 && b != RT_1) return -1;
    if (b == RT_1) addr += 1L << i;
  }
  return addr;
}

static void mem_alloc(void) {
  if (gen_mem_count <= 0) {
    mem_states = NULL;
    return;
  }
  mem_states = xalloc((size_t)gen_mem_count * sizeof mem_states[0]);
  for (int i = 0; i < gen_mem_count; i++) {
    size_t cells = ((size_t)1 << gen_mems[i].abits) * (size_t)gen_mems[i].width;
    mem_states[i].store = xalloc(cells);
  }
}

/* mem_reset restores power-up: RAM all-U, ROM seeded from its baked bytes
 * (little-endian, B=ceil(width/8) per word; memory.js loadBytes, FR-114e),
 * WE/ history unknown. Called per fresh state (per combinational row). */
static void mem_reset(void) {
  for (int i = 0; i < gen_mem_count; i++) {
    const rt_mem *m = &gen_mems[i];
    size_t cells = ((size_t)1 << m->abits) * (size_t)m->width;
    memset(mem_states[i].store, RT_U, cells);
    mem_states[i].prev_we = RT_U;
    if (m->rom) {
      int nbytes = (m->width + 7) / 8; /* B = ceil(width/8) */
      long capacity = 1L << m->abits;
      long file_words = m->rom_len / nbytes;
      long loaded = file_words < capacity ? file_words : capacity;
      for (long k = 0; k < loaded; k++) {
        rt_val *word = &mem_states[i].store[(size_t)k * m->width];
        for (int b = 0; b < m->width; b++) {
          unsigned char byte = m->rom[k * nbytes + (b >> 3)];
          word[b] = (byte >> (b % 8)) & 1 ? RT_1 : RT_0;
        }
      }
    }
  }
}

/* mem_write_all latches each RAM's data bus into the addressed cell on a
 * WE/ 0→1 edge (FR-114d; memory.js writeStep), sampling this step's values.
 * Called in the latch phase, before any contribution. A ROM never writes. */
static void mem_write_all(const rt_val *curr) {
  for (int i = 0; i < gen_mem_count; i++) {
    const rt_mem *m = &gen_mems[i];
    if (m->kind != RT_MEM_RAM) continue;
    rt_val we = mem_rd(curr, m->we);
    if (mem_states[i].prev_we == RT_0 && we == RT_1) {
      long addr = mem_decode(m, curr);
      if (addr >= 0) {
        rt_val *word = &mem_states[i].store[(size_t)addr * m->width];
        for (int b = 0; b < m->width; b++) word[b] = mem_rd(curr, m->data[b]);
      }
    }
    mem_states[i].prev_we = we;
  }
}

/* mem_drive_all deposits each memory's data-bus drive (FR-114d; memory.js
 * dataDrive): the CE//OE//WE/ gating deciding Z (drive nothing), the
 * addressed word (unwritten cells read U), or pessimistic U. Called in the
 * contribution phase. */
static void mem_drive_all(const rt_val *curr) {
  for (int i = 0; i < gen_mem_count; i++) {
    const rt_mem *m = &gen_mems[i];
    rt_val ce = mem_rd(curr, m->ce);
    rt_val oe = mem_rd(curr, m->oe);
    rt_val we = m->kind == RT_MEM_RAM ? mem_rd(curr, m->we) : RT_1;
    const rt_val *word = NULL; /* a word to drive, or... */
    int drive_u = 0;           /* ...drive U on every data pin, else Z (neither) */
    if (ce == RT_1) {
      /* deselected → Z (drive nothing) */
    } else if (ce != RT_0) {
      drive_u = 1; /* CE/ uncertain */
    } else if (m->kind == RT_MEM_RAM && we == RT_0) {
      /* write in progress: outputs disabled → Z */
    } else if (oe == RT_1) {
      /* output disabled → Z */
    } else if (oe == RT_0 && (m->kind == RT_MEM_ROM || we == RT_1)) {
      long addr = mem_decode(m, curr);
      if (addr < 0) drive_u = 1; /* undecodable → U */
      else word = &mem_states[i].store[(size_t)addr * m->width];
    } else {
      drive_u = 1; /* OE//WE/ uncertain */
    }
    if (word) {
      for (int b = 0; b < m->width; b++)
        rt_contrib(m->data[b], word[b], 0, m->data_label[b]);
    } else if (drive_u) {
      for (int b = 0; b < m->width; b++)
        rt_contrib(m->data[b], RT_U, 0, m->data_label[b]);
    }
  }
}

/* ------------------------------------------------------------------ *
 *  The unit step and settling (FR-078, FR-085, FR-110; sim.js step/settle)
 * ------------------------------------------------------------------ */

int rt_step(void) {
  /* (1) Latch registered (.R) and memory (RAM WE/) state from the previous
   * step's values, before any contribution is evaluated (FR-079/FR-114d). */
  gen_latch(curr_buf);
  mem_write_all(curr_buf);

  /* (2) Gather every driver's contribution, all computed from curr. */
  ncontrib = 0;
  memset(head, -1, (size_t)gen_net_count * sizeof head[0]);
  gen_drive(curr_buf);
  drive_builtins();
  mem_drive_all(curr_buf);

  /* (3) Resolve every net into next; (4) swap. */
  int changed = 0;
  for (int i = 0; i < gen_net_count; i++) {
    next_buf[i] = resolve_net(i);
    if (next_buf[i] != curr_buf[i]) changed = 1;
  }
  rt_val *t = curr_buf;
  curr_buf = next_buf;
  next_buf = t;
  return changed;
}

int rt_settle(void) {
  for (int steps = 1; steps <= RT_SETTLE_BOUND; steps++) {
    if (!rt_step()) return steps;
  }
  fprintf(stderr, "design did not settle within %d ns (possible oscillation)\n",
          RT_SETTLE_BOUND);
  return -1;
}

/* ------------------------------------------------------------------ *
 *  Vector runner (FR-117, FR-118; engine/vectors.js runVectors)
 * ------------------------------------------------------------------ */

/* Longest accepted input line. Symbols are single characters, so this
 * accommodates thousands of columns. */
#define RT_LINE_MAX 65536

static char valchar(rt_val v) {
  switch (v) {
    case RT_0: return '0';
    case RT_1: return '1';
    case RT_Z: return 'Z';
    default:   return 'U';
  }
}

static void parse_fail(int rowno, const char *msg) {
  fprintf(stderr, "row %d: %s\n", rowno, msg);
  exit(2);
}

/* parse_row tokenizes one data line into per-column symbols, validating
 * shape and legality: gen_incol_count input symbols (0/1, plus C only in
 * a clock column, FR-115e), a lone "|", then gen_outcol_count expected
 * symbols (H/L/X). Any violation is a usage error: report and exit 2. */
static void parse_row(char *line, int rowno, char *in_syms, char *out_syms) {
  int nin = 0, nout = 0, seen_bar = 0;
  for (char *tok = strtok(line, " \t\r\n"); tok; tok = strtok(NULL, " \t\r\n")) {
    if (tok[1] != '\0') parse_fail(rowno, "malformed token (symbols are single characters)");
    char c = tok[0];
    if (c == '|') {
      if (seen_bar) parse_fail(rowno, "more than one | separator");
      seen_bar = 1;
    } else if (!seen_bar) {
      if (nin >= gen_incol_count) parse_fail(rowno, "too many input symbols");
      if (c == 'C' && gen_incols[nin].kind != RT_COL_CLOCK)
        parse_fail(rowno, "C is legal only in a clock column");
      if (c != '0' && c != '1' && c != 'C')
        parse_fail(rowno, "input symbol must be 0, 1, or C");
      in_syms[nin++] = c;
    } else {
      if (nout >= gen_outcol_count) parse_fail(rowno, "too many output symbols");
      if (c != 'H' && c != 'L' && c != 'X')
        parse_fail(rowno, "expected-output symbol must be H, L, or X");
      out_syms[nout++] = c;
    }
  }
  if (!seen_bar) parse_fail(rowno, "missing | separator");
  if (nin != gen_incol_count) parse_fail(rowno, "wrong input symbol count");
  if (nout != gen_outcol_count) parse_fail(rowno, "wrong expected-output symbol count");
}

/* apply_inputs drives the row's input symbols: a switch column sets its
 * instance's level, a clock column sets its scripted level (C reads as
 * low until pulsed, FR-115e), a port column arms the external-stimulus
 * force (FR-115f). Sets pulse[] per input column (1 = this clock column
 * has a C cell this row). */
static void apply_inputs(const char *in_syms, unsigned char *pulse) {
  for (int i = 0; i < gen_incol_count; i++) {
    const rt_incol *col = &gen_incols[i];
    char c = in_syms[i];
    pulse[i] = (unsigned char)(c == 'C');
    switch (col->kind) {
      case RT_COL_SWITCH:
        gen_switches[col->ref].level = c == '1' ? RT_1 : RT_0;
        break;
      case RT_COL_CLOCK:
        gen_clocks[col->ref].level = c == '1' ? RT_1 : RT_0;
        break;
      case RT_COL_PORT:
        port_stim[i] = c == '1' ? RT_1 : RT_0;
        break;
    }
  }
}

/* score_row reads each output column's settled net value and scores it
 * (FR-115c: H matches 1, L matches 0, X always passes; U and Z match
 * nothing), printing the row's transcript line (FR-118). Returns 1 if
 * the row failed. */
static int score_row(int rowno, const char *out_syms) {
  int fails = 0;
  for (int i = 0; i < gen_outcol_count; i++) {
    /* An unwired probe (net -1) reads Z, like the slow sim's valueOfPin. */
    rt_val v = gen_outcols[i].net >= 0 ? curr_buf[gen_outcols[i].net] : RT_Z;
    char e = out_syms[i];
    int ok = e == 'X' || (e == 'H' && v == RT_1) || (e == 'L' && v == RT_0);
    if (!ok) {
      if (!fails) printf("row %d: FAIL", rowno);
      printf(" %s=%c", gen_outcols[i].name, valchar(v));
      fails++;
    }
  }
  if (fails) printf("\n");
  else printf("row %d: pass\n", rowno);
  return fails != 0;
}

/* preamble runs the implicit power-on reset phase of a clocked design
 * (FR-115e; vectors.js sequential path): every reset asserted with all
 * clocks low, settle; then max(cycles) scripted pulses — all clocks high,
 * settle, low, settle — each reset releasing once its own `cycles` worth
 * of pulses have elapsed; final settle. A clocked design with no reset
 * built-in has no preamble. */
static void preamble(void) {
  if (gen_reset_count == 0) return;
  int maxc = 0;
  for (int i = 0; i < gen_reset_count; i++) {
    gen_resets[i].released = gen_resets[i].cycles <= 0;
    if (gen_resets[i].cycles > maxc) maxc = gen_resets[i].cycles;
  }
  for (int i = 0; i < gen_clock_count; i++) gen_clocks[i].level = RT_0;
  rt_settle();
  for (int p = 1; p <= maxc; p++) {
    for (int i = 0; i < gen_clock_count; i++) gen_clocks[i].level = RT_1;
    rt_settle();
    for (int i = 0; i < gen_clock_count; i++) gen_clocks[i].level = RT_0;
    rt_settle();
    for (int i = 0; i < gen_reset_count; i++) {
      if (p >= gen_resets[i].cycles) gen_resets[i].released = 1;
    }
  }
  rt_settle();
}

int rt_run_vectors(void) {
  static char line[RT_LINE_MAX];
  char *in_syms = xalloc((size_t)(gen_incol_count > 0 ? gen_incol_count : 1));
  char *out_syms = xalloc((size_t)(gen_outcol_count > 0 ? gen_outcol_count : 1));
  unsigned char *pulse = xalloc((size_t)(gen_incol_count > 0 ? gen_incol_count : 1));
  int sequential = gen_clock_count > 0;
  int rowno = 0, failed = 0;

  /* Sequential (FR-115e): the rows run in order on this one persistent
   * state; the preamble runs once, before row 1. Combinational (FR-115c):
   * each row is independent — state is reset per row below. */
  if (sequential) {
    preamble();
    for (int i = 0; i < gen_reset_count; i++) gen_resets[i].released = 1;
  }

  while (fgets(line, sizeof line, stdin)) {
    if (!strchr(line, '\n') && !feof(stdin))
      parse_fail(rowno + 1, "input line too long");
    /* Skip blank lines and # comments. */
    char *p = line + strspn(line, " \t\r\n");
    if (*p == '\0' || *p == '#') continue;

    rowno++;
    parse_row(p, rowno, in_syms, out_syms);
    if (!sequential) reset_state();
    apply_inputs(in_syms, pulse);
    rt_settle();
    if (sequential) {
      /* Pulse this row's C clocks together: high, settle, low, settle. */
      int any = 0;
      for (int i = 0; i < gen_incol_count; i++) any |= pulse[i];
      if (any) {
        for (int i = 0; i < gen_incol_count; i++) {
          if (pulse[i]) gen_clocks[gen_incols[i].ref].level = RT_1;
        }
        rt_settle();
        for (int i = 0; i < gen_incol_count; i++) {
          if (pulse[i]) gen_clocks[gen_incols[i].ref].level = RT_0;
        }
        rt_settle();
      }
    }
    failed += score_row(rowno, out_syms);
  }

  printf("passed %d of %d rows\n", rowno - failed, rowno);
  free(in_syms);
  free(out_syms);
  free(pulse);
  return failed;
}

/* ------------------------------------------------------------------ *
 * Column dump (--columns, FR-115a / design §6.17 M2)                   *
 * ------------------------------------------------------------------ *
 * Prints the baked column set so tooling (tv2txt) can reconcile a .tv
 * file's columns to this program's positional row format (FR-117) by
 * (refdes,pin) — exactly reconcileVectors (§6.16) — without parsing the
 * generated .c or the design. One line per column, in row-format order:
 *
 *   DIR KIND REFDES PIN LABEL...
 *
 * DIR is IN or OUT; KIND is SWITCH/CLOCK/PORT (inputs) or PROBE (outputs);
 * REFDES and PIN are the column identity; LABEL is the display label — the
 * remainder of the line, so it may contain spaces. */
static const char *col_kind_name(rt_col_kind k) {
  switch (k) {
    case RT_COL_SWITCH: return "SWITCH";
    case RT_COL_CLOCK:  return "CLOCK";
    case RT_COL_PORT:   return "PORT";
  }
  return "?";
}

static void rt_dump_columns(void) {
  for (int i = 0; i < gen_incol_count; i++) {
    const rt_incol *c = &gen_incols[i];
    printf("IN %s %s %s %s\n", col_kind_name(c->kind), c->refdes, c->pin, c->name);
  }
  for (int i = 0; i < gen_outcol_count; i++) {
    const rt_outcol *c = &gen_outcols[i];
    printf("OUT PROBE %s %s %s\n", c->refdes, c->pin, c->name);
  }
}

int main(int argc, char **argv) {
  if (argc == 2 && strcmp(argv[1], "--columns") == 0) {
    rt_dump_columns();
    return 0;
  }
  rt_init();
  return rt_run_vectors() ? 1 : 0;
}
