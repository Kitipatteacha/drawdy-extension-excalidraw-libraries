import type { DrawdyElementSchema, FillStyle, StrokeDash, TextAlign } from "@drawdy/driver-protocol";

import { drawable } from "./classify";
import { drawdyFill, drawdyStroke } from "./colors";
import {
  absolutePoints,
  adjustedRoughness,
  bounds,
  boxOutline,
  center,
  cornerRadius,
  dedupe,
  isClosed,
  isFilled,
  isRotated,
  Rect,
  rotate,
  straightBends,
} from "./geometry";
import type { ExcalidrawElement, Point } from "./types";

/** A text to line up with its Excalidraw box once Drawdy has measured it. */
export type PlacedText = { id: string; box: Rect; align: TextAlign };

export type Converted = {
  /**
   * The elements in batches to add in order. Drawdy puts the lines of one
   * batch above everything else in it, so a batch ends where a shape has
   * to cover a line drawn before it. Each batch is one undo step, so they
   * end nowhere else.
   */
  batches: DrawdyElementSchema[][];
  texts: PlacedText[];
  /** Every element added, for selecting them afterwards. */
  ids: string[];
};

type Options = {
  /** Where the item's top left goes, in board coordinates. */
  dx: number;
  dy: number;
  generateId: () => string;
  meta: Record<string, unknown>;
};

const BOXES = new Set(["rectangle", "ellipse", "diamond"]);

const fillStyle = (style: string): FillStyle =>
  style === "solid" || style === "cross-hatch" ? style : "hachure";

const strokeDash = (style: string): StrokeDash =>
  style === "dashed" || style === "dotted" ? style : "solid";

const textAlign = (align: string): TextAlign =>
  align === "center" || align === "right" ? align : "left";

const verticalAlign = (align: string): "top" | "middle" | "bottom" =>
  align === "middle" || align === "bottom" ? align : "top";

const isLine = (e: DrawdyElementSchema): boolean => e.type === "line" || e.type === "arrow";

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Whether the segment from `a` to `b` passes through `box`. */
function crosses([ax, ay]: Point, [bx, by]: Point, box: Rect): boolean {
  // Liang-Barsky: clip the segment to the box and see if anything is left.
  let [t0, t1] = [0, 1];
  const [dx, dy] = [bx - ax, by - ay];
  const sides: [number, number][] = [
    [-dx, ax - box.x],
    [dx, box.x + box.width - ax],
    [-dy, ay - box.y],
    [dy, box.y + box.height - ay],
  ];
  for (const [p, q] of sides) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

/**
 * What a line covers: its whole box when it's filled, and otherwise only
 * its stroke, so the shapes inside an outline aren't counted as under it.
 */
type Cover = { box: Rect; path: Point[] | null; pad: number };

function covers(cover: Cover, box: Rect): boolean {
  if (!overlaps(cover.box, box)) return false;
  if (!cover.path) return true;
  // Curves bow out a little between their points.
  const near = {
    x: box.x - cover.pad,
    y: box.y - cover.pad,
    width: box.width + cover.pad * 2,
    height: box.height + cover.pad * 2,
  };
  return cover.path.some((p, i) => i > 0 && crosses(cover.path![i - 1], p, near));
}

/** The from, to and bends of a Drawdy line through `points`. */
function route(points: Point[], curved: boolean) {
  const from = points[0];
  const to = points[points.length - 1];
  const bend = curved ? points.slice(1, -1) : straightBends(points);
  return bend.length > 0 ? { from, to, bend } : { from, to };
}

/**
 * Drawdy elements for an item whose `fitOf` is "shapes", moved by `dx`,
 * `dy`. Bound text becomes the label of its box, and all of it is one group.
 */
export function toDrawdy(elements: ExcalidrawElement[], options: Options): Converted {
  const { generateId, meta } = options;
  const items = drawable(elements).map((e) => ({ ...e, x: e.x + options.dx, y: e.y + options.dy }));

  const byId = new Map(items.map((e) => [e.id, e]));
  const labels = new Map<string, ExcalidrawElement>();
  for (const e of items) {
    const box = e.containerId ? byId.get(e.containerId) : undefined;
    if (e.type === "text" && box && BOXES.has(box.type) && !isRotated(box)) {
      labels.set(box.id, e);
    }
  }
  const labelIds = new Set([...labels.values()].map((t) => t.id));

  const frameIds = new Map<string, string>();
  for (const e of items) if (e.type === "frame") frameIds.set(e.id, generateId());

  const shown = items.filter((e) => e.type !== "frame" && !labelIds.has(e.id));
  const groupId = shown.length > 1 ? generateId() : undefined;

  const frames: DrawdyElementSchema[] = [];
  const rest: { el: DrawdyElementSchema; box: Rect; path?: Point[] }[] = [];
  const texts: PlacedText[] = [];

  for (const e of items) {
    if (labelIds.has(e.id)) continue;
    const box = bounds([e]);
    const frameId = e.frameId ? frameIds.get(e.frameId) : undefined;
    const common = {
      drawdyElementId: e.type === "frame" ? frameIds.get(e.id)! : generateId(),
      meta,
      ...(groupId && e.type !== "frame" ? { groupId } : {}),
      ...(frameId ? { frameId } : {}),
      opacity: e.opacity / 100,
      seed: e.seed,
    };
    const stroke = {
      strokeWidth: e.strokeWidth,
      strokeDash: strokeDash(e.strokeStyle),
      roughness: adjustedRoughness(e),
    };
    const fill = isFilled(e) ? drawdyFill(e.backgroundColor) : "transparent";

    switch (e.type) {
      case "frame": {
        frames.push({
          ...common,
          type: "frame",
          name: e.name ?? undefined,
          position: [e.x, e.y],
          width: e.width,
          height: e.height,
          rotation: 0,
          meta,
        });
        break;
      }
      case "rectangle":
      case "ellipse":
      case "diamond": {
        const circle = e.type === "ellipse" && Math.abs(e.width - e.height) < 0.5;
        if (isRotated(e) && !circle) {
          // Drawdy can't turn a box, so it goes in as the closed line
          // around it.
          const c = center(e);
          const outline = boxOutline(e).map((p) => rotate(p, c, e.angle));
          rest.push({
            el: {
              ...common,
              ...stroke,
              type: "line",
              ...route(outline, e.type === "ellipse"),
              color: drawdyStroke(e.strokeColor),
              ...(fill !== "transparent" ? { fillColor: fill } : {}),
            },
            box,
            ...(fill === "transparent" ? { path: outline } : {}),
          });
          break;
        }
        const label = labels.get(e.id);
        const strokeColor = drawdyStroke(e.strokeColor);
        const labelColor = label ? drawdyStroke(label.strokeColor) : strokeColor;
        rest.push({
          el: {
            ...common,
            ...stroke,
            type: "shape",
            componentType: e.type === "rectangle" ? "rect" : e.type === "ellipse" ? "circle" : "diamond",
            x: e.x,
            y: e.y,
            width: e.width,
            height: e.height,
            strokeColor,
            fillColor: fill,
            fillStyle: fillStyle(e.fillStyle),
            cornerRadius:
              e.type === "rectangle" ? cornerRadius(Math.min(e.width, e.height), e) : 0,
            ...(label
              ? {
                  text: label.originalText,
                  fontSize: label.fontSize,
                  textAlign: textAlign(label.textAlign),
                  textVerticalAlign: verticalAlign(label.verticalAlign),
                  ...(labelColor !== strokeColor ? { textColor: labelColor } : {}),
                }
              : {}),
          },
          box,
        });
        break;
      }
      case "line":
      case "arrow": {
        let points = dedupe(absolutePoints(e));
        if (points.length < 2) break;
        const closed = isClosed(e.points);
        if (closed) points[points.length - 1] = points[0];
        // A Drawdy arrow points at its end, so a start-only arrowhead
        // turns the line round.
        if (e.type === "arrow" && e.endArrowhead === null && e.startArrowhead !== null) {
          points = points.reverse();
        }
        const arrow = e.type === "arrow" && (e.endArrowhead !== null || e.startArrowhead !== null);
        rest.push({
          el: {
            ...common,
            ...stroke,
            type: arrow ? "arrow" : "line",
            ...route(points, e.roundness !== null && !e.elbowed),
            color: drawdyStroke(e.strokeColor),
            ...(fill !== "transparent" ? { fillColor: fill } : {}),
          },
          box,
          ...(fill === "transparent" ? { path: points } : {}),
        });
        break;
      }
      case "freedraw": {
        const points = absolutePoints(e);
        if (points.length === 0) break;
        // A dot is one point; Drawdy wants two.
        if (points.length === 1) points.push([points[0][0] + 0.01, points[0][1]]);
        const xs = points.map((p) => p[0]);
        const ys = points.map((p) => p[1]);
        rest.push({
          el: {
            ...common,
            type: "freedraw",
            points: points.flat(),
            width: Math.max(...xs) - Math.min(...xs),
            height: Math.max(...ys) - Math.min(...ys),
            strokeColor: drawdyStroke(e.strokeColor),
            // Matches what pasting Excalidraw into Drawdy does.
            strokeWidth: e.strokeWidth * 3,
            meta,
          },
          box,
        });
        break;
      }
      case "text": {
        const id = common.drawdyElementId;
        rest.push({
          el: {
            ...common,
            type: "text",
            x: e.x,
            y: e.y,
            text: e.text,
            fontSize: e.fontSize,
            color: drawdyStroke(e.strokeColor),
            textAlign: textAlign(e.textAlign),
          },
          box,
        });
        texts.push({
          id,
          box: { x: e.x, y: e.y, width: e.width, height: e.height },
          align: textAlign(e.textAlign),
        });
        break;
      }
    }
  }

  const batches: DrawdyElementSchema[][] = [];
  let batch: DrawdyElementSchema[] = [...frames];
  let lines: Cover[] = [];
  for (const { el, box, path } of rest) {
    if (!isLine(el) && lines.some((line) => covers(line, box))) {
      batches.push(batch);
      batch = [];
      lines = [];
    }
    batch.push(el);
    if (isLine(el)) {
      const pad = ("strokeWidth" in el ? (el.strokeWidth ?? 2) : 2) + 4;
      lines.push({ box, path: path ?? null, pad });
    }
  }
  if (batch.length > 0) batches.push(batch);

  return {
    batches,
    texts,
    ids: batches.flat().map((el) => el.drawdyElementId),
  };
}
