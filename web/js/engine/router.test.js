// Tests for the Manhattan route proposal (§6.9a, FR-027c; §11.1).
import { test } from "node:test";
import assert from "node:assert/strict";

import { proposeRoute } from "./router.js";
import { componentBBox } from "./hittest.js";
import { rotateOffset } from "../geometry.js";

// comp builds a minimal component instance; only the outline matters here.
function comp(x, y, width, height, rotation = 0, refdes = "U1") {
  return { refdes, x, y, rotation, typeData: { width, height, pins: [] } };
}

function design(...components) {
  return { components, wires: [], buses: [], vertices: [] };
}

// sgn normalizes Math.sign's -0 to +0 for strict equality.
const sgn = (v) => Math.sign(v) + 0;

// pointsAlong yields every integer grid point on the polyline, asserting each
// segment is axis-aligned (Manhattan) on the way.
function* pointsAlong(path) {
  yield path[0];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    assert.ok(a.x === b.x || a.y === b.y, `segment ${i} not Manhattan`);
    const dx = Math.sign(b.x - a.x);
    const dy = Math.sign(b.y - a.y);
    let { x, y } = a;
    while (x !== b.x || y !== b.y) {
      x += dx;
      y += dy;
      yield { x, y };
    }
  }
}

// assertValid checks the route contract: endpoints in place, Manhattan
// segments, corners-only interior (collinear merged), and no point on or
// inside any component outline except the endpoints themselves.
function assertValid(path, from, to, d) {
  assert.ok(path, "expected a route");
  assert.deepEqual({ x: path[0].x, y: path[0].y }, { x: from.x, y: from.y });
  const last = path[path.length - 1];
  assert.deepEqual({ x: last.x, y: last.y }, { x: to.x, y: to.y });
  for (let i = 2; i < path.length; i++) {
    const [a, b, c] = [path[i - 2], path[i - 1], path[i]];
    assert.ok(
      !((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)),
      `collinear interior point at index ${i - 1}`,
    );
  }
  const boxes = d.components.map(componentBBox);
  for (const p of pointsAlong(path)) {
    if ((p.x === from.x && p.y === from.y) || (p.x === to.x && p.y === to.y)) continue;
    for (const b of boxes) {
      assert.ok(
        p.x < b.minX || p.x > b.maxX || p.y < b.minY || p.y > b.maxY,
        `route point (${p.x},${p.y}) on a component outline`,
      );
    }
  }
}

test("open field: aligned endpoints route straight (FR-027c)", () => {
  const d = design();
  const path = proposeRoute(d, { x: 0, y: 0 }, { x: 10, y: 0 });
  assert.deepEqual(path, [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
  ]);
});

test("open field: diagonal endpoints route as a single L, not a staircase", () => {
  const d = design();
  const path = proposeRoute(d, { x: 0, y: 0 }, { x: 7, y: 5 });
  assertValid(path, { x: 0, y: 0 }, { x: 7, y: 5 }, d);
  assert.equal(path.length, 3, "expected exactly one corner");
});

test("detour: route avoids a component between the endpoints", () => {
  const d = design(comp(3, -3, 4, 6)); // bbox x 3..7, y -3..3
  const from = { x: 0, y: 0 };
  const to = { x: 10, y: 0 };
  const path = proposeRoute(d, from, to);
  assertValid(path, from, to, d);
});

test("same-component loop: output back to an input routes around the body", () => {
  const c = comp(0, 0, 4, 4);
  const d = design(c);
  const from = { x: 4, y: 2, escape: { x: 1, y: 0 } }; // right-side pin
  const to = { x: 0, y: 2, escape: { x: -1, y: 0 } }; // left-side pin
  const path = proposeRoute(d, from, to);
  assertValid(path, from, to, d);
  // First and last steps honor the pin escapes: the route leaves `from` along
  // its escape (+x) and enters `to` from its escape side (traveling -escape,
  // i.e. +x from the cell at (-1,2)).
  assert.equal(sgn(path[1].x - path[0].x), 1);
  assert.equal(path[1].y, path[0].y);
  const a = path[path.length - 2];
  const b = path[path.length - 1];
  assert.equal(sgn(b.x - a.x), -to.escape.x);
  assert.equal(b.y, a.y);
});

test("pin escape: first step follows the facing direction for all rotations", () => {
  for (const rotation of [0, 90, 180, 270]) {
    const c = comp(0, 0, 4, 4, rotation);
    const d = design(c);
    // Unrotated right-side pin at offset (4,2), facing (1,0).
    const off = rotateOffset(4, 2, rotation);
    const esc = rotateOffset(1, 0, rotation);
    const from = { x: c.x + off.x, y: c.y + off.y, escape: { x: esc.x, y: esc.y } };
    const to = { x: 20, y: 20 };
    const path = proposeRoute(d, from, to);
    assertValid(path, from, to, d);
    assert.equal(sgn(path[1].x - path[0].x), sgn(esc.x), `rotation ${rotation}`);
    assert.equal(sgn(path[1].y - path[0].y), sgn(esc.y), `rotation ${rotation}`);
  }
});

test("endpoint on a body edge is traversable without an escape", () => {
  const d = design(comp(0, 0, 4, 4));
  const from = { x: 4, y: 2 }; // on the outline, no escape given
  const to = { x: 10, y: 2 };
  const path = proposeRoute(d, from, to);
  assertValid(path, from, to, d);
});

test("boxed-in: escape cell inside another body yields null (fallback)", () => {
  // to's escape cell (9,2) lies inside the second component (bbox 5..9, 0..4).
  const d = design(comp(10, 0, 4, 4), comp(5, 0, 4, 4, 0, "U2"));
  const from = { x: 0, y: 6 };
  const to = { x: 10, y: 2, escape: { x: -1, y: 0 } };
  assert.equal(proposeRoute(d, from, to), null);
});

test("turn penalty: a longer 2-corner route beats a shorter slalom", () => {
  // Staggered teeth: T1 spans y -3..0 at x 3..4, T2 spans y 0..3 at x 6..7.
  // Slaloming between them (under T1 at y=1, over T2 at y=-1) is length 14
  // with 5 corners (cost 39); looping around at y=±4 is length 18 with 2
  // corners (cost 28). The turn penalty must pick the longer loop.
  const d = design(comp(3, -3, 1, 3), comp(6, 0, 1, 3, 0, "U2"));
  const from = { x: 0, y: 0 };
  const to = { x: 10, y: 0 };
  const path = proposeRoute(d, from, to);
  assertValid(path, from, to, d);
  assert.equal(path.length, 4, "expected exactly two corners");
});

test("degenerate input returns null, never throws", () => {
  const d = design();
  assert.equal(proposeRoute(d, { x: 3, y: 3 }, { x: 3, y: 3 }), null);
  assert.equal(proposeRoute(d, { x: NaN, y: 0 }, { x: 5, y: 0 }), null);
  assert.equal(proposeRoute(d, null, { x: 5, y: 0 }), null);
});

test("adjacent pins facing each other route as the direct segment", () => {
  const d = design();
  const from = { x: 0, y: 0, escape: { x: 1, y: 0 } };
  const to = { x: 1, y: 0, escape: { x: -1, y: 0 } };
  // A = (1,0) = T: the escape step alone reaches the destination.
  assert.deepEqual(proposeRoute(d, from, to), [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
  ]);
});
