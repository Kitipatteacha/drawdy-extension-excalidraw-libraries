// Drawdy keeps colours as they look on its dark board and works out the
// light ones when it draws (see the editor's color-palette). Excalidraw's own
// palette has a dark twin there, so palette colours go over as that twin and
// come back exactly on a light board. Near-blacks become Drawdy's foreground,
// which flips with the theme. Anything else, like a brand colour in an
// icon, stays what its author picked, on either board.

const EXCALIDRAW_PALETTE = new Set([
  "#1e1e1e", "#ffffff", "#f8f9fa", "#e9ecef", "#ced4da", "#868e96", "#343a40",
  "#fff5f5", "#ffc9c9", "#ff8787", "#fa5252", "#e03131",
  "#fff0f6", "#fcc2d7", "#f783ac", "#e64980", "#c2255c",
  "#f8f0fc", "#eebefa", "#da77f2", "#be4bdb", "#9c36b5",
  "#f3f0ff", "#d0bfff", "#9775fa", "#7950f2", "#6741d9",
  "#e7f5ff", "#a5d8ff", "#4dabf7", "#228be6", "#1971c2",
  "#e3fafc", "#99e9f2", "#3bc9db", "#15aabf", "#0c8599",
  "#e6fcf5", "#96f2d7", "#38d9a9", "#12b886", "#099268",
  "#ebfbee", "#b2f2bb", "#69db7c", "#40c057", "#2f9e44",
  "#fff9db", "#ffec99", "#ffd43b", "#fab005", "#f08c00",
  "#fff4e6", "#ffd8a8", "#ffa94d", "#fd7e14", "#e8590c",
  "#f8f1ee", "#eaddd7", "#d2bab0", "#a18072", "#846358",
]);

/** Drawdy's foreground on a dark board; it turns dark on a light one. */
export const DARK_FOREGROUND = "oklch(0.93 0.005 260)";
/** The same foreground as a plain colour, for pictures. */
const DARK_FOREGROUND_HEX = "#e8e9ed";

const INVERT = 0.93;

const HUE_ROTATE_180 = (() => {
  const c = Math.cos(Math.PI);
  const s = Math.sin(Math.PI);
  return [
    0.213 + c * 0.787 - s * 0.213,
    0.715 - c * 0.715 - s * 0.715,
    0.072 - c * 0.072 + s * 0.928,
    0.213 - c * 0.213 + s * 0.143,
    0.715 + c * 0.285 + s * 0.14,
    0.072 - c * 0.072 - s * 0.283,
    0.213 - c * 0.213 - s * 0.787,
    0.715 - c * 0.715 + s * 0.715,
    0.072 + c * 0.928 + s * 0.072,
  ];
})();

type Hex = { rgb: [number, number, number]; alpha: string; opaque: string };

function parseHex(color: string): Hex | null {
  let hex = color.trim().toLowerCase().replace("#", "");
  if (!color.trim().startsWith("#")) return null;
  if (hex.length === 3 || hex.length === 4) {
    hex = [...hex].map((ch) => ch + ch).join("");
  }
  if ((hex.length !== 6 && hex.length !== 8) || !/^[0-9a-f]+$/.test(hex)) {
    return null;
  }
  return {
    rgb: [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ],
    alpha: hex.slice(6, 8),
    opaque: "#" + hex.slice(0, 6),
  };
}

const toHex = (v: number) =>
  Math.round(Math.max(0, Math.min(1, v)) * 255)
    .toString(16)
    .padStart(2, "0");

/** How Excalidraw shows a colour in dark mode: inverted, hue turned back. */
function darkModeColor({ rgb, alpha }: Hex): string {
  const [r, g, b] = rgb.map(
    (v) => Math.round(v * (1 - INVERT) + (255 - v) * INVERT) / 255,
  );
  const m = HUE_ROTATE_180;
  return (
    "#" +
    toHex(r * m[0] + g * m[1] + b * m[2]) +
    toHex(r * m[3] + g * m[4] + b * m[5]) +
    toHex(r * m[6] + g * m[7] + b * m[8]) +
    alpha
  );
}

const isBlackish = ({ rgb }: Hex): boolean =>
  Math.max(...rgb) <= 0x33 && Math.max(...rgb) - Math.min(...rgb) <= 8;

/** A stroke or text colour for a Drawdy element. */
export function drawdyStroke(color: string): string {
  const hex = parseHex(color);
  if (!hex) return color;
  if (hex.alpha === "00") return "transparent";
  if (isBlackish(hex)) return DARK_FOREGROUND;
  return EXCALIDRAW_PALETTE.has(hex.opaque) ? darkModeColor(hex) : color;
}

/** A fill colour for a Drawdy element. */
export function drawdyFill(color: string): string {
  const hex = parseHex(color);
  if (!hex) return color === "" ? "transparent" : color;
  if (hex.alpha === "00") return "transparent";
  if (isBlackish(hex)) return darkModeColor(parseHex("#1e1e1e" + hex.alpha)!);
  return EXCALIDRAW_PALETTE.has(hex.opaque) ? darkModeColor(hex) : color;
}

/**
 * A colour for a picture or thumbnail: as authored on a light board, and as
 * the shapes would show it on a dark one.
 */
export function pictureColor(
  color: string,
  theme: "light" | "dark",
  kind: "stroke" | "fill",
): string {
  if (theme === "light") return color;
  const mapped = kind === "stroke" ? drawdyStroke(color) : drawdyFill(color);
  return mapped === DARK_FOREGROUND ? DARK_FOREGROUND_HEX : mapped;
}
