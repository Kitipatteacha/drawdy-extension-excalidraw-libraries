import { HANDWRITING } from "./render";

// Sour Gummy, the handwriting font Drawdy draws every text on the board in,
// from Fontsource on jsDelivr (SIL Open Font License). Items are previewed
// in it so a thumbnail shows the text the way it lands on the board.
const BASE = "https://cdn.jsdelivr.net/npm/@fontsource-variable/sour-gummy@5.2.5/files/";

const FACES: [string, string][] = [
  [
    "sour-gummy-latin-wght-normal.woff2",
    "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
  ],
  [
    "sour-gummy-latin-ext-wght-normal.woff2",
    "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF",
  ],
];

let loading: Promise<void> | null = null;

/** Loads the font once. Resolves either way: text falls back if it fails. */
export function loadFonts(): Promise<void> {
  loading ??= Promise.all(
    FACES.map(async ([file, unicodeRange]) => {
      try {
        const face = new FontFace(HANDWRITING, `url(${BASE}${file})`, {
          weight: "100 900",
          unicodeRange,
        });
        document.fonts.add(await face.load());
      } catch {
        // The fallback fonts in render.ts take over.
      }
    }),
  ).then(() => {});
  return loading;
}
