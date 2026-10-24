import type { ExcalidrawElement } from "../excalidraw/types";

export type Theme = "light" | "dark";

/** Where an inserted item came from, kept in the elements' meta. */
export type Source = { library: string; item: string };

/**
 * A point in the panel's own pixels. While an item is dragged out of the
 * panel it lies outside the panel, over the board.
 */
export type PanelPoint = { x: number; y: number };

export type WebviewToDriver =
  | { type: "ready" }
  | {
      type: "insert-shapes";
      elements: ExcalidrawElement[];
      source: Source;
      /** Where the item was dropped; the middle of the view when absent. */
      at?: PanelPoint;
    }
  | {
      type: "insert-picture";
      png: ArrayBuffer;
      /** The picture's size on the board; the PNG has more pixels. */
      width: number;
      height: number;
      source: Source;
      at?: PanelPoint;
    };

export type DriverToWebview =
  | { type: "styling"; css: string; theme: Theme }
  | { type: "inserted"; ok: boolean; text: string };
