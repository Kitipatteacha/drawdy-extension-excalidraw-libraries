export type Point = [number, number];

export type Roundness = { type: number; value?: number } | null;

/**
 * An Excalidraw element as `normalizeElement` leaves it: every field the
 * converter and the renderer read is set, whatever version wrote the file.
 */
export type ExcalidrawElement = {
  id: string;
  /** "rectangle", "ellipse", "diamond", "line", "arrow", "freedraw", "text", "frame", ... */
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Radians, clockwise, around the element's centre. */
  angle: number;
  strokeColor: string;
  backgroundColor: string;
  fillStyle: string;
  strokeWidth: number;
  strokeStyle: string;
  roughness: number;
  /** 0 to 100. */
  opacity: number;
  seed: number;
  roundness: Roundness;
  groupIds: string[];
  frameId: string | null;
  /** Lines, arrows and freedraw: relative to `x`, `y`. */
  points: Point[];
  pressures: number[];
  simulatePressure: boolean;
  startArrowhead: string | null;
  endArrowhead: string | null;
  elbowed: boolean;
  text: string;
  /** The text before wrapping to its container, for bound text. */
  originalText: string;
  fontSize: number;
  fontFamily: number;
  textAlign: string;
  verticalAlign: string;
  containerId: string | null;
  lineHeight: number;
  name: string | null;
};

export type LibraryItem = {
  id: string;
  /** Empty for unnamed items, which most v1 libraries are. */
  name: string;
  elements: ExcalidrawElement[];
};
