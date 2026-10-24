import { getStroke } from "perfect-freehand";
import rough from "roughjs";
import type { RoughCanvas } from "roughjs/bin/canvas";
import type { Options } from "roughjs/bin/core";

import { drawable } from "../src/excalidraw/classify";
import { pictureColor } from "../src/excalidraw/colors";
import {
  adjustedRoughness,
  bounds,
  center,
  cornerRadius,
  isFilled,
  Rect,
  rotate,
} from "../src/excalidraw/geometry";
import type { ExcalidrawElement, Point } from "../src/excalidraw/types";
import type { Theme } from "../src/panel/messages";

// Draws items the way Excalidraw does, with the same roughjs options and
// perfect-freehand strokes, for the thumbnails and for the pictures of
// items that can't be shapes. Mirrors Excalidraw's renderer closely enough
// that the seeds give the same wobble. Texts are the exception: they're
// drawn the way Drawdy draws them, since that's how they land on the board.

export const HANDWRITING = "DrawdyHandwriting";

/** Drawdy's text font, whatever font the item's author picked. */
const TEXT_FONT = `${HANDWRITING}, "Comic Sans MS", cursive`;

/** Drawdy's line height, as a share of the font size. */
const LINE_HEIGHT = 1.4;

function roughOptions(e: ExcalidrawElement, theme: Theme): Options {
  const solid = e.strokeStyle === "solid";
  const options: Options = {
    seed: e.seed,
    // Dashes and dots overlap themselves when drawn twice, and look thinner.
    disableMultiStroke: !solid,
    strokeWidth: solid ? e.strokeWidth : e.strokeWidth + 0.5,
    // Pinned so the wider dashed stroke doesn't change the fill.
    fillWeight: e.strokeWidth / 2,
    hachureGap: e.strokeWidth * 4,
    roughness: adjustedRoughness(e),
    stroke: pictureColor(e.strokeColor, theme, "stroke"),
    preserveVertices: e.roughness < 2,
  };
  if (e.strokeStyle === "dashed") options.strokeLineDash = [8, 8 + e.strokeWidth];
  if (e.strokeStyle === "dotted") options.strokeLineDash = [1.5, 6 + e.strokeWidth];
  if (isFilled(e)) {
    options.fill = pictureColor(e.backgroundColor, theme, "fill");
    options.fillStyle = e.fillStyle;
  }
  if (e.type === "ellipse") options.curveFitting = 1;
  return options;
}

function drawRectangle(rc: RoughCanvas, e: ExcalidrawElement, o: Options): void {
  const { width: w, height: h } = e;
  if (!e.roundness) {
    rc.draw(rc.generator.rectangle(0, 0, w, h, o));
    return;
  }
  const r = cornerRadius(Math.min(w, h), e);
  rc.draw(
    rc.generator.path(
      `M ${r} 0 L ${w - r} 0 Q ${w} 0, ${w} ${r} L ${w} ${h - r} ` +
        `Q ${w} ${h}, ${w - r} ${h} L ${r} ${h} Q 0 ${h}, 0 ${h - r} ` +
        `L 0 ${r} Q 0 0, ${r} 0`,
      o,
    ),
  );
}

function drawDiamond(rc: RoughCanvas, e: ExcalidrawElement, o: Options): void {
  const [tx, ty] = [e.width / 2, 0];
  const [rx, ry] = [e.width, e.height / 2];
  const [bx, by] = [e.width / 2, e.height];
  const [lx, ly] = [0, e.height / 2];
  if (!e.roundness) {
    rc.draw(rc.generator.polygon([[tx, ty], [rx, ry], [bx, by], [lx, ly]], o));
    return;
  }
  const v = cornerRadius(Math.abs(tx - lx), e);
  const hr = cornerRadius(Math.abs(ry - ty), e);
  rc.draw(
    rc.generator.path(
      `M ${tx + v} ${ty + hr} L ${rx - v} ${ry - hr} ` +
        `C ${rx} ${ry}, ${rx} ${ry}, ${rx - v} ${ry + hr} ` +
        `L ${bx + v} ${by - hr} C ${bx} ${by}, ${bx} ${by}, ${bx - v} ${by - hr} ` +
        `L ${lx + v} ${ly + hr} C ${lx} ${ly}, ${lx} ${ly}, ${lx + v} ${ly - hr} ` +
        `L ${tx - v} ${ty + hr} C ${tx} ${ty}, ${tx} ${ty}, ${tx + v} ${ty + hr}`,
      o,
    ),
  );
}

function drawArrowhead(
  rc: RoughCanvas,
  e: ExcalidrawElement,
  o: Options,
  at: "start" | "end",
): void {
  const head = at === "start" ? e.startArrowhead : e.endArrowhead;
  const pts = e.points;
  if (!head || pts.length < 2) return;
  const [tip, prev] = at === "end" ? [pts[pts.length - 1], pts[pts.length - 2]] : [pts[0], pts[1]];
  const length = Math.hypot(tip[0] - prev[0], tip[1] - prev[1]);
  if (length === 0) return;
  const dir: Point = [(tip[0] - prev[0]) / length, (tip[1] - prev[1]) / length];

  const diamond = head.startsWith("diamond");
  const size = head === "arrow" ? 25 : diamond ? 12 : head.startsWith("crowfoot") ? 20 : 15;
  const reach = Math.min(size, length * (diamond ? 0.25 : 0.5));
  const back: Point = [tip[0] - dir[0] * reach, tip[1] - dir[1] * reach];
  const spread = ((head === "bar" ? 90 : head === "arrow" ? 20 : 25) * Math.PI) / 180;
  const left = rotate(back, tip, -spread);
  const right = rotate(back, tip, spread);

  const g = rc.generator;
  const line: Options = { ...o, roughness: Math.min(1, o.roughness ?? 0) };
  delete line.strokeLineDash;
  delete line.fill;
  const filled: Options = { ...line, fill: o.stroke, fillStyle: "solid" };

  switch (head) {
    case "bar":
      rc.draw(g.line(left[0], left[1], right[0], right[1], line));
      return;
    case "triangle":
    case "triangle_outline":
      rc.draw(g.polygon([tip, left, right], head === "triangle" ? filled : line));
      return;
    case "dot":
    case "circle":
    case "circle_outline": {
      const diameter = reach + e.strokeWidth - 2;
      rc.draw(g.circle(tip[0], tip[1], diameter, head === "circle_outline" ? line : filled));
      return;
    }
    case "diamond":
    case "diamond_outline": {
      const far: Point = [tip[0] - dir[0] * reach * 2, tip[1] - dir[1] * reach * 2];
      rc.draw(g.polygon([tip, left, far, right], head === "diamond" ? filled : line));
      return;
    }
    default: {
      if (head.startsWith("crowfoot")) {
        // The toes spread out at the end of the line.
        const side: Point = [-dir[1] * reach * 0.6, dir[0] * reach * 0.6];
        rc.draw(g.line(back[0], back[1], tip[0] + side[0], tip[1] + side[1], line));
        rc.draw(g.line(back[0], back[1], tip[0] - side[0], tip[1] - side[1], line));
        return;
      }
      rc.draw(g.line(left[0], left[1], tip[0], tip[1], line));
      rc.draw(g.line(right[0], right[1], tip[0], tip[1], line));
    }
  }
}

function drawLinear(rc: RoughCanvas, e: ExcalidrawElement, o: Options): void {
  if (e.points.length < 2) return;
  const g = rc.generator;
  const shape =
    e.roundness && !e.elbowed
      ? g.curve(e.points, o)
      : o.fill
        ? g.polygon(e.points, o)
        : g.linearPath(e.points, o);
  rc.draw(shape);
  if (e.type === "arrow") {
    drawArrowhead(rc, e, o, "start");
    drawArrowhead(rc, e, o, "end");
  }
}

function drawFreedraw(
  rc: RoughCanvas,
  ctx: CanvasRenderingContext2D,
  e: ExcalidrawElement,
  o: Options,
): void {
  if (e.points.length === 0) return;
  if (o.fill) rc.draw(rc.generator.curve(e.points, { ...o, stroke: "none" }));
  const input = e.simulatePressure
    ? e.points
    : e.points.map(([x, y], i) => [x, y, e.pressures[i] ?? 0.5]);
  const outline = getStroke(input, {
    simulatePressure: e.simulatePressure,
    size: e.strokeWidth * 4.25,
    thinning: 0.6,
    smoothing: 0.5,
    streamline: 0.5,
    easing: (t) => Math.sin((t * Math.PI) / 2),
    last: true,
  });
  if (outline.length === 0) return;
  const path = new Path2D();
  path.moveTo(outline[0][0], outline[0][1]);
  for (let i = 0; i < outline.length; i++) {
    const [x, y] = outline[i];
    const [nx, ny] = outline[(i + 1) % outline.length];
    path.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
  }
  path.closePath();
  ctx.fillStyle = o.stroke ?? "#1e1e1e";
  ctx.fill(path);
}

/** Lines a text up in its Excalidraw box the way place.ts lines Drawdy's up. */
function drawText(ctx: CanvasRenderingContext2D, e: ExcalidrawElement, theme: Theme): void {
  const lines = e.text.replace(/\r\n?/g, "\n").split("\n");
  const lineHeight = e.fontSize * LINE_HEIGHT;
  const top = (e.height - lines.length * lineHeight) / 2;
  const align = e.textAlign === "center" || e.textAlign === "right" ? e.textAlign : "left";
  const x = align === "center" ? e.width / 2 : align === "right" ? e.width : 0;

  ctx.font = `${e.fontSize}px ${TEXT_FONT}`;
  ctx.fillStyle = pictureColor(e.strokeColor, theme, "stroke");
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  lines.forEach((line, i) => ctx.fillText(line, x, top + (i + 0.5) * lineHeight));
}

function drawElement(
  rc: RoughCanvas,
  ctx: CanvasRenderingContext2D,
  e: ExcalidrawElement,
  theme: Theme,
): void {
  ctx.save();
  ctx.globalAlpha *= e.opacity / 100;
  const [cx, cy] = center(e);
  ctx.translate(cx, cy);
  ctx.rotate(e.angle);
  ctx.translate(e.x - cx, e.y - cy);
  const o = roughOptions(e, theme);
  switch (e.type) {
    case "rectangle":
      drawRectangle(rc, e, o);
      break;
    case "diamond":
      drawDiamond(rc, e, o);
      break;
    case "ellipse":
      rc.draw(rc.generator.ellipse(e.width / 2, e.height / 2, e.width, e.height, o));
      break;
    case "line":
    case "arrow":
      drawLinear(rc, e, o);
      break;
    case "freedraw":
      drawFreedraw(rc, ctx, e, o);
      break;
    case "text":
      drawText(ctx, e, theme);
      break;
  }
  ctx.restore();
}

/** Room around an item for roughness and arrowheads. */
const PAD = 6;

/** Draws the part of an item inside `box` onto `canvas`, centred, at `scale`. */
function drawInto(
  canvas: HTMLCanvasElement,
  elements: ExcalidrawElement[],
  box: Rect,
  scale: number,
  theme: Theme,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // Centre the item in the canvas.
  ctx.translate(
    (canvas.width - box.width * scale) / 2,
    (canvas.height - box.height * scale) / 2,
  );
  ctx.scale(scale, scale);
  ctx.translate(-box.x, -box.y);
  const rc = rough.canvas(canvas);
  for (const e of drawable(elements)) {
    if (e.type !== "frame") drawElement(rc, ctx, e, theme);
  }
}

/** Draws an item to fill a square thumbnail of `size` css pixels. */
export function drawThumbnail(
  canvas: HTMLCanvasElement,
  elements: ExcalidrawElement[],
  size: number,
  theme: Theme,
): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  const box = bounds(drawable(elements));
  const inner = size - PAD * 2;
  // Small items aren't blown up past three times their size.
  const fit = Math.min(inner / Math.max(box.width, 1), inner / Math.max(box.height, 1), 3);
  drawInto(canvas, elements, box, fit * dpr, theme);
}

export type Picture = { png: ArrayBuffer; width: number; height: number };

/** Longest side of a picture, in pixels. */
const MAX_PIXELS = 4096;

/** A PNG of an item at twice its size, and its size on the board. */
export async function drawPicture(elements: ExcalidrawElement[], theme: Theme): Promise<Picture> {
  const box = bounds(drawable(elements));
  const width = Math.ceil(box.width + PAD * 2);
  const height = Math.ceil(box.height + PAD * 2);
  const scale = Math.min(2, MAX_PIXELS / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  drawInto(canvas, elements, box, scale, theme);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Couldn't make a picture.");
  return { png: await blob.arrayBuffer(), width, height };
}
