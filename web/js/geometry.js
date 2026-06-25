// Geometry: grid snapping, viewport transforms, and 90-degree rotation math
// (§6.7). World/grid coordinates are integers in grid units and are canonical;
// pixel coordinates are derived from a viewport {pan:{x,y}, zoom}.

// Tunable constants (A5/OQ-004), kept in one place.
export const GRID_MM = 2; // nominal grid spacing (~2 mm at default zoom)
export const PX_PER_UNIT_DEFAULT = 8; // device pixels per grid unit at zoom 1
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4.0;

// rotateOffset rotates an integer pin offset (dx,dy) by rotation degrees
// (0/90/180/270) about the instance origin. 90-degree turns map integers to
// integers, so rotated pins stay on grid intersections (§6.7, FR-021).
export function rotateOffset(dx, dy, rotation) {
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return { x: -dy, y: dx };
    case 180:
      return { x: -dx, y: -dy };
    case 270:
      return { x: dy, y: -dx };
    default:
      return { x: dx, y: dy };
  }
}

// scaleFor returns device pixels per grid unit for a viewport.
export function scaleFor(viewport) {
  return PX_PER_UNIT_DEFAULT * viewport.zoom;
}

// worldToScreen converts world (grid) coordinates to pixel coordinates:
// screen = (world - pan) * scale.
export function worldToScreen(world, viewport) {
  const scale = scaleFor(viewport);
  return {
    x: (world.x - viewport.pan.x) * scale,
    y: (world.y - viewport.pan.y) * scale,
  };
}

// screenToWorld converts pixel coordinates to (fractional) world coordinates:
// world = screen / scale + pan.
export function screenToWorld(screen, viewport) {
  const scale = scaleFor(viewport);
  return {
    x: screen.x / scale + viewport.pan.x,
    y: screen.y / scale + viewport.pan.y,
  };
}

// snapToGrid maps a pixel point to the nearest integer grid intersection
// (FR-021).
export function snapToGrid(screen, viewport) {
  const w = screenToWorld(screen, viewport);
  return { x: Math.round(w.x), y: Math.round(w.y) };
}

// clampZoom constrains a zoom factor to [ZOOM_MIN, ZOOM_MAX] (A5).
export function clampZoom(zoom) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

// centerViewportOn returns a new viewport (zoom unchanged) panned so that
// worldPt sits at the center of a viewWidth × viewHeight viewport — the
// right-click-to-recenter gesture (FR-023b).
export function centerViewportOn(viewport, worldPt, viewWidth, viewHeight) {
  const scale = scaleFor(viewport);
  return {
    pan: {
      x: worldPt.x - viewWidth / 2 / scale,
      y: worldPt.y - viewHeight / 2 / scale,
    },
    zoom: viewport.zoom,
  };
}

// rectFromPoints returns the axis-aligned rectangle (min/max) spanning two points.
export function rectFromPoints(a, b) {
  return {
    minX: Math.min(a.x, b.x),
    maxX: Math.max(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxY: Math.max(a.y, b.y),
  };
}

// pointInRect reports whether a point lies within (inclusive) an axis-aligned rect.
export function pointInRect(p, rect) {
  return (
    p.x >= rect.minX && p.x <= rect.maxX && p.y >= rect.minY && p.y <= rect.maxY
  );
}

// segmentsIntersect reports whether segments p1-p2 and p3-p4 cross, using the
// orientation test (with collinear-overlap handling).
function segmentsIntersect(p1, p2, p3, p4) {
  const o = (a, b, c) =>
    Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  const onSeg = (a, b, c) =>
    Math.min(a.x, b.x) <= c.x &&
    c.x <= Math.max(a.x, b.x) &&
    Math.min(a.y, b.y) <= c.y &&
    c.y <= Math.max(a.y, b.y);
  const o1 = o(p1, p2, p3);
  const o2 = o(p1, p2, p4);
  const o3 = o(p3, p4, p1);
  const o4 = o(p3, p4, p2);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSeg(p1, p2, p3)) return true;
  if (o2 === 0 && onSeg(p1, p2, p4)) return true;
  if (o3 === 0 && onSeg(p3, p4, p1)) return true;
  if (o4 === 0 && onSeg(p3, p4, p2)) return true;
  return false;
}

// segmentIntersectsRect reports whether segment a-b touches an axis-aligned rect:
// either endpoint inside, or the segment crosses any of the rect's four edges.
export function segmentIntersectsRect(a, b, rect) {
  if (pointInRect(a, rect) || pointInRect(b, rect)) return true;
  const tl = { x: rect.minX, y: rect.minY };
  const tr = { x: rect.maxX, y: rect.minY };
  const br = { x: rect.maxX, y: rect.maxY };
  const bl = { x: rect.minX, y: rect.maxY };
  return (
    segmentsIntersect(a, b, tl, tr) ||
    segmentsIntersect(a, b, tr, br) ||
    segmentsIntersect(a, b, br, bl) ||
    segmentsIntersect(a, b, bl, tl)
  );
}

// COLLINEAR_EPS is the tolerance for the collinear-bend tests (FR-033c). Points
// lie on grid intersections (FR-021), so the test is effectively exact.
const COLLINEAR_EPS = 1e-9;

// isRedundantBend reports whether `cur` is a bend point that does not bend the
// conductor (FR-033c): it is collinear with `prev`→`next` (cross product within
// COLLINEAR_EPS) and lies within their bounding box, so removing it leaves the
// drawn shape unchanged.
export function isRedundantBend(prev, cur, next) {
  const cross = (cur.x - prev.x) * (next.y - prev.y) - (cur.y - prev.y) * (next.x - prev.x);
  if (Math.abs(cross) > COLLINEAR_EPS) return false;
  return (
    cur.x >= Math.min(prev.x, next.x) - COLLINEAR_EPS &&
    cur.x <= Math.max(prev.x, next.x) + COLLINEAR_EPS &&
    cur.y >= Math.min(prev.y, next.y) - COLLINEAR_EPS &&
    cur.y <= Math.max(prev.y, next.y) + COLLINEAR_EPS
  );
}

// pruneCollinearBends returns a copy of a polyline with its non-bending interior
// points removed (FR-033c). A single left-to-right pass compares each interior
// point against the last *kept* point and the next original point, so a run of
// collinear points collapses fully; the endpoints are always kept.
export function pruneCollinearBends(points) {
  if (points.length < 3) return [...points];
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    if (!isRedundantBend(out[out.length - 1], points[i], points[i + 1])) {
      out.push(points[i]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

// zoomAbout returns a new viewport scaled by factor while keeping the world point
// currently under `screen` fixed on screen (zoom-to-cursor). Zoom is clamped.
export function zoomAbout(viewport, screen, factor) {
  const zoom = clampZoom(viewport.zoom * factor);
  const newScale = PX_PER_UNIT_DEFAULT * zoom;
  const world = screenToWorld(screen, viewport);
  return {
    pan: { x: world.x - screen.x / newScale, y: world.y - screen.y / newScale },
    zoom,
  };
}
