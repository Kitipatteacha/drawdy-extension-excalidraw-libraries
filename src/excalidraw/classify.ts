import { isFilled, isRotated } from "./geometry";
import type { ExcalidrawElement } from "./types";

// Drawdy's extension API can't turn a box or a text. A turned box can go in
// as the closed line around it, but a closed line only fills solid, a
// drawing doesn't fill at all, and an arrow only points one way. Everything
// else in a library item has a Drawdy shape that looks the same. Items that
// need more go in as a picture instead, so they still look the way their
// author drew them.

/**
 * What the converter and the renderer draw. Images and embeds are left out:
 * library files carry no image data, and embeds don't belong in a library.
 */
const DRAWN_TYPES = new Set([
  "rectangle",
  "ellipse",
  "diamond",
  "line",
  "arrow",
  "freedraw",
  "text",
  "frame",
]);

export type Fit =
  | { kind: "shapes" }
  | { kind: "picture"; reason: string }
  | { kind: "empty" };

const isCircle = (e: ExcalidrawElement): boolean =>
  e.type === "ellipse" && Math.abs(e.width - e.height) < 0.5;

/** Why an element can't be a Drawdy shape, or null when it can. */
function obstacle(e: ExcalidrawElement): string | null {
  switch (e.type) {
    case "rectangle":
    case "diamond":
    case "ellipse":
      // A turned box becomes a closed line, which fills only solid.
      if (isRotated(e) && !isCircle(e) && isFilled(e) && e.fillStyle !== "solid") {
        return "a turned shape with a hatched fill";
      }
      return null;
    case "text":
      return isRotated(e) ? "turned text" : null;
    case "line":
      return isFilled(e) && e.fillStyle !== "solid" ? "a hatched fill" : null;
    case "freedraw":
      return isFilled(e) ? "a filled drawing" : null;
    case "arrow": {
      const start = e.startArrowhead;
      const end = e.endArrowhead;
      const plain =
        (start === null && (end === null || end === "arrow")) ||
        (end === null && start === "arrow");
      return plain ? null : "arrowheads Drawdy doesn't have";
    }
    default:
      return null;
  }
}

/** How an item goes onto the board. */
export function fitOf(elements: ExcalidrawElement[]): Fit {
  const drawn = elements.filter((e) => DRAWN_TYPES.has(e.type));
  if (drawn.filter((e) => e.type !== "frame").length === 0) {
    return { kind: "empty" };
  }
  for (const e of drawn) {
    const reason = obstacle(e);
    if (reason) return { kind: "picture", reason };
  }
  return { kind: "shapes" };
}

/** The elements worth drawing, in order. */
export const drawable = (elements: ExcalidrawElement[]): ExcalidrawElement[] =>
  elements.filter((e) => DRAWN_TYPES.has(e.type));
