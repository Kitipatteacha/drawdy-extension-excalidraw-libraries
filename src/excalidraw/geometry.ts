import type { ExcalidrawElement, Point } from "./types";

export type Rect = { x: number; y: number; width: number; height: number };

const isLinear = (e: ExcalidrawElement): boolean =>
  e.type === "line" || e.type === "arrow";

const hasPoints = (e: ExcalidrawElement): boolean =>
  isLinear(e) || e.type === "freedraw";

export const isRotated = (e: ExcalidrawElement): boolean =>
  Math.abs(e.angle % (2 * Math.PI)) > 1e-3;

export function rotate([x, y]: Point, [cx, cy]: Point, angle: number): Point {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [
    cx + (x - cx) * cos - (y - cy) * sin,
    cy + (x - cx) * sin + (y - cy) * cos,
  ];
}

/**
 * What Excalidraw rotates an element around: the middle of its box, which
 * for lines and freedraw is the box of its points.
 */
export function center(e: ExcalidrawElement): Point {
  if (hasPoints(e) && e.points.length > 0) {
    const xs = e.points.map((p) => p[0]);
    const ys = e.points.map((p) => p[1]);
    return [
      e.x + (Math.min(...xs) + Math.max(...xs)) / 2,
      e.y + (Math.min(...ys) + Math.max(...ys)) / 2,
    ];
  }
  return [e.x + e.width / 2, e.y + e.height / 2];
}

/** The points of a line or freedraw on the board, rotation applied. */
export function absolutePoints(e: ExcalidrawElement): Point[] {
  const c = center(e);
  return e.points.map(([px, py]) => rotate([e.x + px, e.y + py], c, e.angle));
}

export function isClosed(points: Point[]): boolean {
  if (points.length < 3) return false;
  const [a, b] = [points[0], points[points.length - 1]];
  return Math.abs(a[0] - b[0]) < 1 && Math.abs(a[1] - b[1]) < 1;
}

export const isTransparent = (color: string): boolean =>
  color === "transparent" || color === "" || /^#[0-9a-f]{6}00$/i.test(color);

/** Whether Excalidraw fills this element: boxes always, paths when closed. */
export function isFilled(e: ExcalidrawElement): boolean {
  if (isTransparent(e.backgroundColor)) return false;
  if (e.type === "line" || e.type === "freedraw") return isClosed(e.points);
  return e.type === "rectangle" || e.type === "ellipse" || e.type === "diamond";
}

/** Excalidraw's corner radius for a side of length `x`. */
export function cornerRadius(x: number, e: ExcalidrawElement): number {
  if (!e.roundness) return 0;
  if (e.roundness.type === 3) {
    const fixed = e.roundness.value ?? 32;
    return x <= fixed / 0.25 ? x * 0.25 : fixed;
  }
  return x * 0.25;
}

/**
 * Excalidraw's roughness, eased off for small shapes so they don't wobble
 * out of recognition.
 */
export function adjustedRoughness(e: ExcalidrawElement): number {
  const max = Math.max(e.width, e.height);
  const min = Math.min(e.width, e.height);
  if (
    (min >= 20 && max >= 50) ||
    (min >= 15 && e.roundness !== null && !isLinear(e)) ||
    (isLinear(e) && max >= 50)
  ) {
    return e.roughness;
  }
  return Math.min(e.roughness / (max < 10 ? 3 : 2), 2.5);
}

/** The outline of a box-shaped element, unrotated, as a closed polygon. */
export function boxOutline(e: ExcalidrawElement): Point[] {
  const { x, y, width: w, height: h } = e;
  if (e.type === "diamond") {
    return [
      [x + w / 2, y],
      [x + w, y + h / 2],
      [x + w / 2, y + h],
      [x, y + h / 2],
      [x + w / 2, y],
    ];
  }
  if (e.type === "ellipse") {
    const steps = 32;
    const out: Point[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * 2 * Math.PI;
      out.push([x + w / 2 + (w / 2) * Math.cos(t), y + h / 2 + (h / 2) * Math.sin(t)]);
    }
    return out;
  }
  const r = Math.min(cornerRadius(Math.min(w, h), e), w / 2, h / 2);
  if (r <= 0) {
    return [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
  }
  // A quarter circle per corner, clockwise from the top left.
  const corners: [Point, number][] = [
    [[x + w - r, y + r], -Math.PI / 2],
    [[x + w - r, y + h - r], 0],
    [[x + r, y + h - r], Math.PI / 2],
    [[x + r, y + r], Math.PI],
  ];
  const out: Point[] = [];
  for (const [[cx, cy], start] of corners) {
    for (let i = 0; i <= 4; i++) {
      const t = start + (i / 4) * (Math.PI / 2);
      out.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
    }
  }
  out.push(out[0]);
  return out;
}

/** The corners an element covers on the board, rotation applied. */
function extent(e: ExcalidrawElement): Point[] {
  if (hasPoints(e)) return absolutePoints(e);
  const c = center(e);
  const { x, y, width: w, height: h } = e;
  const corners: Point[] = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  return corners.map((p) => rotate(p, c, e.angle));
}

/** The box around elements, with room for their strokes. */
export function bounds(elements: ExcalidrawElement[]): Rect {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const e of elements) {
    // Arrowheads and freedraw strokes reach further than their points.
    const pad =
      e.type === "freedraw" ? e.strokeWidth * 2.5 : e.type === "text" ? 0 : e.strokeWidth / 2;
    for (const [px, py] of extent(e)) {
      x0 = Math.min(x0, px - pad);
      y0 = Math.min(y0, py - pad);
      x1 = Math.max(x1, px + pad);
      y1 = Math.max(y1, py + pad);
    }
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Drops points that repeat the one before them. */
export function dedupe(points: Point[]): Point[] {
  return points.filter(
    (p, i) =>
      i === 0 || Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) > 0.01,
  );
}

/** How close to a corner the first extra point of an edge sits. */
const CORNER = 0.5;

/** Where along an edge of length `length` it gets extra points. */
function stops(length: number): number[] {
  const near: number[] = [];
  for (let d = CORNER; d < length / 2; d *= 4) near.push(d);
  return [...near, ...near.map((d) => length - d).reverse()];
}

/**
 * The bends that make Drawdy draw `points` with straight edges.
 *
 * Drawdy curves a line through its bends (Catmull-Rom), which keeps a
 * segment straight when the points either side of it lie on the same edge.
 * So every edge gets points of its own, half a pixel from each corner and
 * then four times further each time towards its middle. The corner rounds
 * by less than a pixel, and the even growth keeps the curve from shooting
 * past the corner, as it would after a long step onto a short one.
 */
export function straightBends(points: Point[]): Point[] {
  const bends: Point[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i], points[i + 1]];
    if (i > 0) bends.push(a);
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length === 0) continue;
    for (const d of stops(length)) {
      const t = d / length;
      bends.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return bends;
}
