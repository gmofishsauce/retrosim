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
} from "./geometry.js";

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
