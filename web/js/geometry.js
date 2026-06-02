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
