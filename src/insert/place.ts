import { DrawdyElementSchema } from "@drawdy/driver-protocol";

import { command, session } from "../drawdy-bridge/session";
import { drawable } from "../excalidraw/classify";
import { PlacedText, toDrawdy } from "../excalidraw/convert";
import { bounds, Rect } from "../excalidraw/geometry";
import type { ExcalidrawElement } from "../excalidraw/types";
import type { Source } from "../panel/messages";

export class InsertError extends Error {}

const metaOf = (source: Source): Record<string, unknown> => ({
  excalidrawLibrary: source.library,
  ...(source.item ? { excalidrawItem: source.item } : {}),
});

/** What's on screen, in board coordinates. */
async function viewport(): Promise<Rect> {
  const res = await command("command:camera:get-viewport-rect");
  if (!res) throw new InsertError("Couldn't find the middle of the board.");
  return res.rect;
}

/** Zooms out until an item that came out bigger than the screen fits on it. */
async function reveal(item: Rect, view: Rect): Promise<void> {
  if (item.width <= view.width * 0.9 && item.height <= view.height * 0.9) return;
  const camera = await command("command:camera:get-info");
  if (!camera) return;
  const margin = Math.max(item.width, item.height) * 0.05;
  await command("command:camera:fly-to-rect", {
    rect: {
      x: item.x - margin,
      y: item.y - margin,
      width: item.width + margin * 2,
      height: item.height + margin * 2,
    },
    flyDurationMs: 300,
    // Never zooms in past where the board is now.
    zoom: camera.zoom,
  });
}

async function add(elements: DrawdyElementSchema[]): Promise<void> {
  // Adding answers with nothing, so only null means it failed.
  if ((await command("command:scene:add-drawdy-elements", { elements })) === null) {
    throw new InsertError("Drawdy didn't take the item.");
  }
}

/**
 * Lines Drawdy's texts up with their Excalidraw boxes. Drawdy measures text
 * in its own font, so a centred or right-aligned text would otherwise drift
 * from where its author put it.
 */
async function alignTexts(texts: PlacedText[]): Promise<void> {
  if (texts.length === 0) return;
  const res = await command("command:scene:element-rects", {
    drawdyElementIds: texts.map((t) => t.id),
  });
  if (!res) return;
  const rects = new Map(res.rects.map((r) => [r.drawdyElementId, r.rect]));
  const updates = texts.flatMap(({ id, box, align }) => {
    const rect = rects.get(id);
    if (!rect) return [];
    const x =
      align === "center"
        ? box.x + (box.width - rect.width) / 2
        : align === "right"
          ? box.x + box.width - rect.width
          : box.x;
    const y = box.y + (box.height - rect.height) / 2;
    if (Math.abs(x - rect.x) < 0.5 && Math.abs(y - rect.y) < 0.5) return [];
    return [{ drawdyElementId: id, properties: { transform: { x, y } } }];
  });
  if (updates.length > 0) {
    await command("command:scene:update-drawdy-elements", { updates });
  }
}

/** A point on the board, in board coordinates. */
export type BoardPoint = { x: number; y: number };

const middle = (view: Rect): BoardPoint => ({ x: view.x + view.width / 2, y: view.y + view.height / 2 });

/**
 * Adds an item as Drawdy shapes centred on `at`, in board coordinates, or
 * in the middle of the view, selected.
 */
export async function insertShapes(
  elements: ExcalidrawElement[],
  source: Source,
  at?: BoardPoint,
): Promise<void> {
  const box = bounds(drawable(elements));
  const view = await viewport();
  const centre = at ?? middle(view);
  const dx = Math.round(centre.x - (box.x + box.width / 2));
  const dy = Math.round(centre.y - (box.y + box.height / 2));
  const converted = toDrawdy(elements, {
    dx,
    dy,
    generateId: session().generateId,
    meta: metaOf(source),
  });
  if (converted.ids.length === 0) throw new InsertError("This item has nothing to add.");
  for (const batch of converted.batches) await add(batch);
  await alignTexts(converted.texts);
  await command("command:scene:set-selection", { drawdyElementIds: converted.ids });
  await reveal({ ...box, x: box.x + dx, y: box.y + dy }, view);
}

/** Adds a picture of an item centred on `at`, or in the middle of the view, selected. */
export async function insertPicture(
  png: ArrayBuffer,
  width: number,
  height: number,
  source: Source,
  at?: BoardPoint,
): Promise<void> {
  const view = await viewport();
  const centre = at ?? middle(view);
  const rect = {
    x: Math.round(centre.x - width / 2),
    y: Math.round(centre.y - height / 2),
    width,
    height,
  };
  const id = session().generateId();
  await add([
    {
      type: "image",
      drawdyElementId: id,
      ...rect,
      blob: new Blob([png], { type: "image/png" }),
      meta: metaOf(source),
    },
  ]);
  await command("command:scene:set-selection", { drawdyElementIds: [id] });
  await reveal(rect, view);
}
