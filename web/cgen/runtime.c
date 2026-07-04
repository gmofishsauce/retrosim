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

#include <ctype.h>
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
static void mem_load_all(void); /* startup ROM content read (FR-117b) */
static void mem_reset(void); /* memory power-up: RAM U, ROM loaded bytes */
static void vcd_sample(void); /* per-step VCD change dump (--vcd, FR-118) */

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
  mem_load_all();
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

/* Simulated time in unit steps (1 ns each, FR-110), incremented by
 * rt_step exactly as sim.js's simTime: behaviors evaluate at the current
 * time, whose result lands in the next step's values (unit delay). Never
 * reset — monotonic over the whole run. */
static long sim_time;

/* freerun selects the time-driven built-in behaviors (FR-117a) over the
 * scripted vector-mode levels (FR-115e); set once by main(). */
static int freerun;

/* clock_period_eff is FR-071b's clockPeriod rule: the lone clock's
 * effective period when the design has exactly one clock generator, else
 * the 100 ns FR-071a default (sim.js §6.13, resolved once at Run). */
static int clock_period_eff(void) {
  return gen_clock_count == 1 ? gen_clocks[0].period_ns : 100;
}

/* drive_builtins deposits the runtime-owned drivers each step: weak pulls
 * (FR-083), input switches at their current level (FR-071c/FR-087a —
 * strong, never U or Z), clock generators, and power-on resets. In vector
 * mode clocks drive their scripted level and resets their released flag
 * (FR-115e; the vector runner owns both); in free-running mode (FR-117a)
 * both are computed from simulated time, mirroring builtins.js — the
 * clock's FR-084 square wave (low the first half of each period, period
 * clamped to ≥ 2 whole ns) and the reset's FR-071b window (asserted while
 * sim_time < cycles × clockPeriod). */
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
    if (freerun) {
      int period = c->period_ns < 2 ? 2 : c->period_ns;
      rt_contrib(c->net, sim_time % period < period / 2 ? RT_0 : RT_1, 0,
                 c->label);
    } else {
      rt_contrib(c->net, c->level, 0, c->label);
    }
  }
  for (int i = 0; i < gen_reset_count; i++) {
    const rt_reset *r = &gen_resets[i];
    int active = freerun ? sim_time < (long)r->cycles * clock_period_eff()
                         : !r->released;
    rt_contrib(r->r_net, active ? RT_1 : RT_0, 0, r->r_label);
    rt_contrib(r->rn_net, active ? RT_0 : RT_1, 0, r->rn_label);
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
  unsigned char *bytes; /* ROM contents loaded at startup (FR-117b), or NULL */
  long nbytes;          /* loaded byte count */
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
    mem_states[i].bytes = NULL;
    mem_states[i].nbytes = 0;
  }
}

/* ------------------------------------------------------------------ *
 *  ROM content loading at startup (--rom, FR-117b)
 * ------------------------------------------------------------------ *
 * ROM contents are not baked into the generated file: each ROM instance
 * is loaded here, once, before the first step — so a content file can
 * change without regenerating the program. Per ROM the source is a
 * --rom REFDES=FILE override when given, else the recorded content-file
 * path (rt_mem.rom_file) tried as recorded and then by basename in the
 * current working directory. Any failure reports to stderr and exits 2. */

/* --rom REFDES=FILE arguments, collected verbatim by main() before
 * rt_init and resolved by mem_load_all. */
static const char **rom_args;
static int rom_arg_count;

/* rom_read_file reads one content file per FR-114e: format by extension
 * (".bin" raw bytes; ".hex" whitespace-separated hex byte tokens, each
 * one or two hex digits), returning a malloc'd byte buffer. Returns NULL
 * only when the file cannot be opened; a format problem is a hard error
 * (exit 2) naming `who` — the flag or ROM the request came from. */
static unsigned char *rom_read_file(const char *path, long *out_len, const char *who) {
  const char *ext = strrchr(path, '.');
  int hex = ext && strcmp(ext, ".hex") == 0;
  if (!hex && !(ext && strcmp(ext, ".bin") == 0)) {
    fprintf(stderr, "%s: \"%s\" must end in .bin or .hex (FR-114e)\n", who, path);
    exit(2);
  }
  FILE *f = fopen(path, "rb");
  if (!f) return NULL;
  /* Read the whole file (contents are small: at most 2^abits words). */
  long cap = 4096, len = 0;
  unsigned char *raw = xalloc((size_t)cap);
  size_t got;
  while ((got = fread(raw + len, 1, (size_t)(cap - len), f)) > 0) {
    len += (long)got;
    if (len == cap) {
      unsigned char *grown = xalloc((size_t)cap * 2);
      memcpy(grown, raw, (size_t)len);
      free(raw);
      raw = grown;
      cap *= 2;
    }
  }
  fclose(f);
  if (!hex) {
    *out_len = len;
    return raw;
  }
  /* Hex text: whitespace-separated byte tokens (FR-114e). Parse in place —
   * the byte stream is never longer than the text. */
  unsigned char *bytes = xalloc((size_t)(len > 0 ? len : 1));
  long n = 0, i = 0;
  while (i < len) {
    if (isspace(raw[i])) {
      i++;
      continue;
    }
    int v = 0, digits = 0;
    while (i < len && !isspace(raw[i])) {
      int c = raw[i];
      int d = c >= '0' && c <= '9'   ? c - '0'
              : c >= 'a' && c <= 'f' ? c - 'a' + 10
              : c >= 'A' && c <= 'F' ? c - 'A' + 10
                                     : -1;
      if (d < 0 || digits >= 2) {
        fprintf(stderr, "%s: malformed hex byte token in \"%s\"\n", who, path);
        exit(2);
      }
      v = v * 16 + d;
      digits++;
      i++;
    }
    bytes[n++] = (unsigned char)v;
  }
  free(raw);
  *out_len = n;
  return bytes;
}

/* mem_load_all resolves and loads every ROM's contents (FR-117b), and
 * validates every --rom argument. Called once by rt_init. */
static void mem_load_all(void) {
  /* Match each --rom REFDES=FILE to its ROM instance. */
  const char **override = xalloc((size_t)(gen_mem_count > 0 ? gen_mem_count : 1) * sizeof *override);
  for (int i = 0; i < gen_mem_count; i++) override[i] = NULL;
  for (int a = 0; a < rom_arg_count; a++) {
    const char *eq = strchr(rom_args[a], '=');
    if (!eq || eq == rom_args[a] || eq[1] == '\0') {
      fprintf(stderr, "--rom %s: expected REFDES=FILE\n", rom_args[a]);
      exit(2);
    }
    size_t rlen = (size_t)(eq - rom_args[a]);
    int found = -1;
    for (int i = 0; i < gen_mem_count; i++) {
      if (strncmp(gen_mems[i].refdes, rom_args[a], rlen) == 0 &&
          gen_mems[i].refdes[rlen] == '\0') {
        found = i;
        break;
      }
    }
    if (found < 0 || gen_mems[found].kind != RT_MEM_ROM) {
      fprintf(stderr, "--rom %s: no ROM instance \"%.*s\"\n", rom_args[a],
              (int)rlen, rom_args[a]);
      exit(2);
    }
    override[found] = eq + 1;
  }

  for (int i = 0; i < gen_mem_count; i++) {
    const rt_mem *m = &gen_mems[i];
    if (m->kind != RT_MEM_ROM) continue;
    char who[256];
    long len = 0;
    unsigned char *bytes;
    if (override[i]) {
      snprintf(who, sizeof who, "--rom %s=%s", m->refdes, override[i]);
      bytes = rom_read_file(override[i], &len, who);
      if (!bytes) {
        fprintf(stderr, "%s: cannot read \"%s\"\n", who, override[i]);
        exit(2);
      }
    } else if (m->rom_file) {
      /* The recorded path as-is, then its basename in the cwd (the file
       * placed beside where the program runs). */
      snprintf(who, sizeof who, "ROM %s", m->refdes);
      bytes = rom_read_file(m->rom_file, &len, who);
      const char *slash = strrchr(m->rom_file, '/');
      const char *base = slash ? slash + 1 : m->rom_file;
      if (!bytes && slash) bytes = rom_read_file(base, &len, who);
      if (!bytes) {
        fprintf(stderr,
                "ROM %s: cannot read \"%s\"%s%s%s; use --rom %s=FILE to supply the contents\n",
                m->refdes, m->rom_file, slash ? " or \"" : "", slash ? base : "",
                slash ? "\"" : "", m->refdes);
        exit(2);
      }
    } else {
      fprintf(stderr, "ROM %s: no content file recorded; use --rom %s=FILE to supply one\n",
              m->refdes, m->refdes);
      exit(2);
    }
    /* Over-capacity content is reported and ignored (FR-114e); mem_reset
     * truncates when seeding. */
    int nb = (m->width + 7) / 8;
    long capacity = 1L << m->abits;
    if (len / nb > capacity) {
      fprintf(stderr, "ROM %s: content exceeds capacity (%ld of %ld words used)\n",
              m->refdes, capacity, len / nb);
    }
    mem_states[i].bytes = bytes;
    mem_states[i].nbytes = len;
  }
  free(override);
}

/* mem_reset restores power-up: RAM all-U, ROM seeded from its loaded
 * contents (mem_load_all, FR-117b; little-endian, B=ceil(width/8) per
 * word; memory.js loadBytes, FR-114e), WE/ history unknown. Called per
 * fresh state (per combinational row) — it re-seeds from the bytes loaded
 * once at startup, never re-reading the file. */
static void mem_reset(void) {
  for (int i = 0; i < gen_mem_count; i++) {
    const rt_mem *m = &gen_mems[i];
    size_t cells = ((size_t)1 << m->abits) * (size_t)m->width;
    memset(mem_states[i].store, RT_U, cells);
    mem_states[i].prev_we = RT_U;
    if (mem_states[i].bytes) {
      int nbytes = (m->width + 7) / 8; /* B = ceil(width/8) */
      long capacity = 1L << m->abits;
      long file_words = mem_states[i].nbytes / nbytes;
      long loaded = file_words < capacity ? file_words : capacity;
      for (long k = 0; k < loaded; k++) {
        rt_val *word = &mem_states[i].store[(size_t)k * m->width];
        for (int b = 0; b < m->width; b++) {
          unsigned char byte = mem_states[i].bytes[k * nbytes + (b >> 3)];
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
  sim_time++;
  vcd_sample();
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
  /* Hidden clock (FR-116 hierarchy / FR-115e): a clock generator inside a
   * flattened sub-design or peer sheet carries a hierarchical label (it
   * contains '/'). Vector mode scripts clocks through top-sheet columns
   * only, so such a clock cannot be driven here — refuse. The free-running
   * mode (--cycles, FR-117a) drives it from simulated time normally. */
  for (int i = 0; i < gen_clock_count; i++) {
    if (strchr(gen_labels[gen_clocks[i].label], '/')) {
      fprintf(stderr,
              "clock %s is inside a sub-design; vector mode drives clocks on "
              "the top sheet only — run this design with --cycles N\n",
              gen_labels[gen_clocks[i].label]);
      exit(2);
    }
  }
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
 *  Free-running mode (--cycles N, FR-117a)
 * ------------------------------------------------------------------ */

/* incol_net resolves an input column to the net it observes: a switch or
 * clock column reads its instance's output net, a port column is the net
 * itself. */
static int incol_net(const rt_incol *c) {
  switch (c->kind) {
    case RT_COL_SWITCH: return gen_switches[c->ref].net;
    case RT_COL_CLOCK:  return gen_clocks[c->ref].net;
    case RT_COL_PORT:   return c->ref;
  }
  return -1;
}

void rt_run_free(long cycles) {
  freerun = 1;
  long total = cycles * (long)clock_period_eff();
  for (long i = 0; i < total; i++) rt_step();

  /* Final observable dump (FR-117a): the FR-118 observable set — input
   * columns then output columns, in column order. An unwired probe reads
   * Z, as in the vector runner. */
  for (int i = 0; i < gen_incol_count; i++) {
    int n = incol_net(&gen_incols[i]);
    printf("%s=%c\n", gen_incols[i].name, valchar(n >= 0 ? curr_buf[n] : RT_Z));
  }
  for (int i = 0; i < gen_outcol_count; i++) {
    int n = gen_outcols[i].net;
    printf("%s=%c\n", gen_outcols[i].name, valchar(n >= 0 ? curr_buf[n] : RT_Z));
  }
}

/* ------------------------------------------------------------------ *
 *  VCD trace (--vcd <file>, FR-118)
 * ------------------------------------------------------------------ *
 * A four-state VCD trace of the observable set — one scalar wire per
 * column (inputs then outputs), $timescale 1ns (one unit step, FR-110),
 * 0/1/U/Z mapped onto VCD 0/1/x/z. Works in both batch modes: rt_step
 * calls vcd_sample() every unit step, so the trace records every value
 * change at its simulated time. */

static FILE *vcd_fp;      /* open trace, or NULL (no --vcd) */
static rt_val *vcd_prev;  /* last dumped value per column */
static int vcd_ncols;     /* gen_incol_count + gen_outcol_count */

static char vcd_valchar(rt_val v) {
  switch (v) {
    case RT_0: return '0';
    case RT_1: return '1';
    case RT_Z: return 'z';
    default:   return 'x'; /* U */
  }
}

/* vcd_col_val reads observable column i (inputs first, then outputs);
 * an unwired column reads Z, as everywhere else. */
static rt_val vcd_col_val(int i) {
  int n = i < gen_incol_count ? incol_net(&gen_incols[i])
                              : gen_outcols[i - gen_incol_count].net;
  return n >= 0 ? curr_buf[n] : RT_Z;
}

/* vcd_id renders column index i as a VCD identifier code (bijective
 * base-94 over the printable characters '!'..'~'). */
static const char *vcd_id(int i) {
  static char buf[8];
  int k = 0;
  buf[k++] = (char)(33 + i % 94);
  for (i /= 94; i > 0; i /= 94) {
    i--;
    buf[k++] = (char)(33 + i % 94);
  }
  buf[k] = '\0';
  return buf;
}

/* vcd_name writes a column's display label as a VCD signal name,
 * whitespace replaced by '_' (a VCD identifier cannot contain spaces). */
static void vcd_name(const char *s) {
  for (; *s; s++) fputc(*s == ' ' || *s == '\t' ? '_' : *s, vcd_fp);
}

/* vcd_open writes the header — timescale, one $var per observable column
 * — and the initial #0 $dumpvars section with the power-up values. Called
 * after rt_init, before any step. Exits 2 when the file cannot be opened. */
static void vcd_open(const char *path) {
  vcd_fp = fopen(path, "w");
  if (!vcd_fp) {
    fprintf(stderr, "--vcd: cannot open %s\n", path);
    exit(2);
  }
  vcd_ncols = gen_incol_count + gen_outcol_count;
  vcd_prev = xalloc((size_t)(vcd_ncols > 0 ? vcd_ncols : 1));
  fprintf(vcd_fp, "$timescale 1ns $end\n");
  fprintf(vcd_fp, "$scope module design $end\n");
  for (int i = 0; i < vcd_ncols; i++) {
    fprintf(vcd_fp, "$var wire 1 %s ", vcd_id(i));
    vcd_name(i < gen_incol_count ? gen_incols[i].name
                                 : gen_outcols[i - gen_incol_count].name);
    fprintf(vcd_fp, " $end\n");
  }
  fprintf(vcd_fp, "$upscope $end\n$enddefinitions $end\n#0\n$dumpvars\n");
  for (int i = 0; i < vcd_ncols; i++) {
    vcd_prev[i] = vcd_col_val(i);
    fprintf(vcd_fp, "%c%s\n", vcd_valchar(vcd_prev[i]), vcd_id(i));
  }
  fprintf(vcd_fp, "$end\n");
}

/* vcd_sample dumps every column whose value changed this step, under a
 * #<time> stamp. Called by rt_step after the buffer swap, so curr_buf
 * holds the values at sim_time. No-op without --vcd. */
static void vcd_sample(void) {
  if (!vcd_fp) return;
  int stamped = 0;
  for (int i = 0; i < vcd_ncols; i++) {
    rt_val v = vcd_col_val(i);
    if (v == vcd_prev[i]) continue;
    if (!stamped) {
      fprintf(vcd_fp, "#%ld\n", sim_time);
      stamped = 1;
    }
    vcd_prev[i] = v;
    fprintf(vcd_fp, "%c%s\n", vcd_valchar(v), vcd_id(i));
  }
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
  long cycles = -1;            /* -1 = vector mode (no --cycles flag) */
  const char *vcd_path = NULL; /* --vcd trace file, or NULL */
  rom_args = xalloc((size_t)argc * sizeof *rom_args);
  for (int i = 1; i < argc; i++) {
    if (strcmp(argv[i], "--columns") == 0) {
      rt_dump_columns();
      return 0;
    } else if (strcmp(argv[i], "--cycles") == 0 && i + 1 < argc) {
      char *end;
      cycles = strtol(argv[++i], &end, 10);
      if (*end != '\0' || cycles <= 0) {
        fprintf(stderr, "--cycles: N must be a positive integer\n");
        return 2;
      }
    } else if (strcmp(argv[i], "--vcd") == 0 && i + 1 < argc) {
      vcd_path = argv[++i];
    } else if (strcmp(argv[i], "--rom") == 0 && i + 1 < argc) {
      rom_args[rom_arg_count++] = argv[++i]; /* resolved by mem_load_all (FR-117b) */
    } else {
      fprintf(stderr,
              "usage: %s [--columns | [--vcd FILE] [--rom REFDES=FILE] [--cycles N]] (vector rows on stdin otherwise)\n",
              argv[0]);
      return 2;
    }
  }
  rt_init();
  if (vcd_path) vcd_open(vcd_path); /* both modes trace (FR-118) */
  int status;
  if (cycles > 0) { /* free-running mode (FR-117a): stdin untouched */
    rt_run_free(cycles);
    status = 0;
  } else {
    status = rt_run_vectors() ? 1 : 0;
  }
  if (vcd_fp) fclose(vcd_fp);
  return status;
}
