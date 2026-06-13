import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PX_PER_UNIT_DEFAULT,
  ZOOM_MIN,
  ZOOM_MAX,
  rotateOffset,
  scaleFor,
  worldToScreen,
  screenToWorld,
  snapToGrid,
  clampZoom,
  zoomAbout,
  centerViewportOn,
  rectFromPoints,
  pointInRect,
  segmentIntersectsRect,
} from "./geometry.js";

test("centerViewportOn places the world point at the view center (FR-023b)", () => {
  const vp = { pan: { x: 3, y: 4 }, zoom: 2 };
  const out = centerViewportOn(vp, { x: 10, y: 20 }, 800, 600);
  assert.equal(out.zoom, 2); // zoom unchanged
  const s = worldToScreen({ x: 10, y: 20 }, out);
  assert.deepEqual({ x: Math.round(s.x), y: Math.round(s.y) }, { x: 400, y: 300 });
});

test("rectFromPoints normalizes corners regardless of order", () => {
  assert.deepEqual(rectFromPoints({ x: 5, y: 8 }, { x: 1, y: 2 }), {
    minX: 1, maxX: 5, minY: 2, maxY: 8,
  });
});

test("pointInRect is inclusive of the boundary", () => {
  const r = { minX: 0, maxX: 10, minY: 0, maxY: 10 };
  assert.equal(pointInRect({ x: 5, y: 5 }, r), true);
  assert.equal(pointInRect({ x: 0, y: 10 }, r), true); // corner
  assert.equal(pointInRect({ x: 11, y: 5 }, r), false);
});

test("segmentIntersectsRect: inside, crossing, and outside", () => {
  const r = { minX: 0, maxX: 10, minY: 0, maxY: 10 };
  // endpoint inside
  assert.equal(segmentIntersectsRect({ x: 5, y: 5 }, { x: 20, y: 5 }, r), true);
  // passes through with both endpoints outside
  assert.equal(segmentIntersectsRect({ x: -5, y: 5 }, { x: 15, y: 5 }, r), true);
  // entirely outside, no crossing
  assert.equal(segmentIntersectsRect({ x: -5, y: -5 }, { x: -1, y: 20 }, r), false);
});

test("constants (A5)", () => {
  assert.equal(PX_PER_UNIT_DEFAULT, 8);
  assert.equal(ZOOM_MIN, 0.25);
  assert.equal(ZOOM_MAX, 4.0);
});

test("rotateOffset maps integer offsets to integers for all angles (§6.7)", () => {
  assert.deepEqual(rotateOffset(2, 1, 0), { x: 2, y: 1 });
  assert.deepEqual(rotateOffset(2, 1, 90), { x: -1, y: 2 });
  assert.deepEqual(rotateOffset(2, 1, 180), { x: -2, y: -1 });
  assert.deepEqual(rotateOffset(2, 1, 270), { x: 1, y: -2 });
});

test("scaleFor = PX_PER_UNIT_DEFAULT * zoom", () => {
  assert.equal(scaleFor({ pan: { x: 0, y: 0 }, zoom: 1 }), 8);
  assert.equal(scaleFor({ pan: { x: 0, y: 0 }, zoom: 2 }), 16);
});

test("worldToScreen applies pan then scale", () => {
  const vp = { pan: { x: 10, y: 20 }, zoom: 1 };
  assert.deepEqual(worldToScreen({ x: 12, y: 25 }, vp), { x: 16, y: 40 });
});

test("screenToWorld inverts worldToScreen", () => {
  const vp = { pan: { x: 10, y: 20 }, zoom: 1 };
  assert.deepEqual(screenToWorld({ x: 16, y: 40 }, vp), { x: 12, y: 25 });
});

test("world->screen->world round-trips integer grid points", () => {
  const vp = { pan: { x: 3, y: -7 }, zoom: 2 };
  for (const p of [{ x: 0, y: 0 }, { x: 5, y: 9 }, { x: -4, y: 2 }]) {
    assert.deepEqual(screenToWorld(worldToScreen(p, vp), vp), p);
  }
});

test("snapToGrid rounds a screen point to the nearest grid intersection", () => {
  const vp = { pan: { x: 0, y: 0 }, zoom: 1 }; // scale 8
  // 17/8 = 2.125 -> 2 ; 23/8 = 2.875 -> 3
  assert.deepEqual(snapToGrid({ x: 17, y: 23 }, vp), { x: 2, y: 3 });
});

test("clampZoom bounds to [ZOOM_MIN, ZOOM_MAX]", () => {
  assert.equal(clampZoom(0.1), ZOOM_MIN);
  assert.equal(clampZoom(10), ZOOM_MAX);
  assert.equal(clampZoom(1.5), 1.5);
});

test("zoomAbout keeps the world point under the cursor fixed", () => {
  const vp = { pan: { x: 3, y: -7 }, zoom: 1 };
  const sp = { x: 80, y: 40 };
  const before = screenToWorld(sp, vp);
  const nv = zoomAbout(vp, sp, 2);
  assert.equal(nv.zoom, 2);
  const after = screenToWorld(sp, nv);
  assert.ok(Math.abs(after.x - before.x) < 1e-9);
  assert.ok(Math.abs(after.y - before.y) < 1e-9);
});

test("zoomAbout clamps the resulting zoom", () => {
  const vp = { pan: { x: 0, y: 0 }, zoom: 1 };
  assert.equal(zoomAbout(vp, { x: 0, y: 0 }, 100).zoom, ZOOM_MAX);
  assert.equal(zoomAbout(vp, { x: 0, y: 0 }, 0.001).zoom, ZOOM_MIN);
});
