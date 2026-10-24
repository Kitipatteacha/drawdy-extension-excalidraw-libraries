import type { ExcalidrawElement, LibraryItem, Point } from "./types";

// Library files come in two versions, and old ones predate fields newer
// Excalidraw relies on. Normalizing once here means the converter and the
// renderer never have to guess at a default, and use the same one when they
// do. The defaults follow Excalidraw's own `restoreElements`.

/** Line height per font family, for text written before it was stored. */
const DEFAULT_LINE_HEIGHT: Record<number, number> = {
  1: 1.25,
  2: 1.15,
  3: 1.2,
  5: 1.25,
  6: 1.25,
  7: 1.15,
  8: 1.25,
};

const num = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

const str = (v: unknown, fallback: string): string =>
  typeof v === "string" ? v : fallback;

function points(v: unknown): Point[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((p): Point[] =>
    Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])
      ? [[p[0], p[1]]]
      : [],
  );
}

/** A usable element from a raw one, or null for deleted or broken ones. */
export function normalizeElement(raw: unknown): ExcalidrawElement | null {
  if (typeof raw !== "object" || raw === null) return null;
  const e = raw as Record<string, unknown>;
  if (e.isDeleted === true) return null;
  if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) return null;

  // Excalidraw restores the legacy "draw" tool as a line.
  const type = e.type === "draw" ? "line" : str(e.type, "");
  const width = num(e.width, 0);
  const height = num(e.height, 0);
  const linear = type === "line" || type === "arrow";

  let roundness = (e.roundness ?? null) as ExcalidrawElement["roundness"];
  if (roundness === null && e.strokeSharpness === "round") {
    roundness = { type: type === "rectangle" ? 3 : 2 };
  }

  let pts = points(e.points);
  if (linear && pts.length < 2) pts = [[0, 0], [width, height]];

  const fontFamily = num(e.fontFamily, 1);
  const text = str(e.text, "");

  return {
    id: str(e.id, ""),
    type,
    x: e.x as number,
    y: e.y as number,
    width,
    height,
    angle: num(e.angle, 0),
    strokeColor: str(e.strokeColor, "#1e1e1e"),
    backgroundColor: str(e.backgroundColor, "transparent"),
    fillStyle: str(e.fillStyle, "hachure"),
    strokeWidth: num(e.strokeWidth, 1),
    strokeStyle: str(e.strokeStyle, "solid"),
    roughness: num(e.roughness, 1),
    opacity: num(e.opacity, 100),
    seed: num(e.seed, 1),
    roundness,
    groupIds: Array.isArray(e.groupIds) ? e.groupIds.filter((g) => typeof g === "string") : [],
    frameId: typeof e.frameId === "string" ? e.frameId : null,
    points: pts,
    pressures: Array.isArray(e.pressures) ? e.pressures.filter(Number.isFinite) : [],
    simulatePressure: e.simulatePressure !== false,
    startArrowhead: typeof e.startArrowhead === "string" ? e.startArrowhead : null,
    endArrowhead:
      typeof e.endArrowhead === "string"
        ? e.endArrowhead
        : e.endArrowhead === undefined && type === "arrow"
          ? "arrow"
          : null,
    elbowed: e.elbowed === true,
    text,
    originalText: str(e.originalText, text),
    fontSize: num(e.fontSize, 20),
    fontFamily,
    textAlign: str(e.textAlign, "left"),
    verticalAlign: str(e.verticalAlign, "top"),
    containerId: typeof e.containerId === "string" ? e.containerId : null,
    lineHeight: num(e.lineHeight, DEFAULT_LINE_HEIGHT[fontFamily] ?? 1.25),
    name: typeof e.name === "string" ? e.name : null,
  };
}

const normalizeAll = (raw: unknown): ExcalidrawElement[] =>
  Array.isArray(raw)
    ? raw.flatMap((e) => {
        const el = normalizeElement(e);
        return el ? [el] : [];
      })
    : [];

export class LibraryFormatError extends Error {}

/**
 * The items of a library file: a v1 `.excalidrawlib` (`library`), a v2 one
 * (`libraryItems`), or a whole `.excalidraw` scene as a single item.
 */
export function parseLibrary(json: unknown): LibraryItem[] {
  if (typeof json !== "object" || json === null) {
    throw new LibraryFormatError("This isn't an Excalidraw library.");
  }
  const data = json as Record<string, unknown>;
  let items: LibraryItem[];
  if (Array.isArray(data.libraryItems)) {
    items = data.libraryItems.map((raw, i) => {
      const item = (raw ?? {}) as Record<string, unknown>;
      return {
        id: str(item.id, `item-${i}`),
        name: str(item.name, ""),
        elements: normalizeAll(item.elements),
      };
    });
  } else if (Array.isArray(data.library)) {
    items = data.library.map((elements, i) => ({
      id: `item-${i}`,
      name: "",
      elements: normalizeAll(elements),
    }));
  } else if (Array.isArray(data.elements)) {
    items = [{ id: "scene", name: "", elements: normalizeAll(data.elements) }];
  } else {
    throw new LibraryFormatError("This isn't an Excalidraw library.");
  }
  return items.filter((item) => item.elements.length > 0);
}
