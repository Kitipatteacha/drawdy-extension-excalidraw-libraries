import { parseLibrary } from "../src/excalidraw/parse";
import type { LibraryItem } from "../src/excalidraw/types";

// The catalogue at libraries.excalidraw.com: an index of every library,
// how often each has been downloaded, and each library's file next to its
// preview. All are served with open CORS, so the panel reads them directly.

const SITE = "https://libraries.excalidraw.com";

export type Author = { name: string; url?: string };

export type LibraryInfo = {
  id: string;
  name: string;
  description: string;
  authors: Author[];
  /** The file's path under /libraries/. */
  source: string;
  /** The preview image's path under /libraries/. */
  preview: string;
  created: string;
  updated: string;
  /** Downloads to date, from the catalogue's stats; 0 when it has none. */
  downloads: number;
};

export class CatalogError extends Error {}

const fileUrl = (path: string): string =>
  `${SITE}/libraries/${path.split("/").map(encodeURIComponent).join("/")}`;

export const previewUrl = (info: LibraryInfo): string => fileUrl(info.preview);

export const authorNames = (authors: Author[]): string =>
  authors.map((a) => a.name).join(", ");

async function getJson(url: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new CatalogError("Couldn't reach libraries.excalidraw.com. Check your connection.");
  }
  if (!res.ok) throw new CatalogError(`libraries.excalidraw.com answered ${res.status}.`);
  try {
    return await res.json();
  } catch {
    throw new CatalogError("libraries.excalidraw.com sent something unreadable.");
  }
}

type Stats = Record<string, { total?: unknown }>;

/** The catalogue's stats key for a library, as libraries.excalidraw.com makes it. */
const statsKey = (source: string): string =>
  source.toLowerCase().replace(/\.excalidrawlib$/, "").replace(/\//g, "-");

/** Download counts. Optional: without them the libraries just show none. */
async function loadStats(): Promise<Stats> {
  try {
    const raw = await getJson(`${SITE}/stats.json`);
    return typeof raw === "object" && raw !== null ? (raw as Stats) : {};
  } catch {
    return {};
  }
}

function infoOf(raw: unknown, stats: Stats): LibraryInfo | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== "string" || typeof r.source !== "string") return null;
  const authors = Array.isArray(r.authors)
    ? r.authors.flatMap((a): Author[] =>
        a && typeof a.name === "string"
          ? [{ name: a.name, url: typeof a.url === "string" ? a.url : undefined }]
          : [],
      )
    : [];
  return {
    id: typeof r.id === "string" ? r.id : r.source,
    name: r.name,
    description: typeof r.description === "string" ? r.description : "",
    authors,
    source: r.source,
    preview: typeof r.preview === "string" ? r.preview : "",
    created: typeof r.created === "string" ? r.created : "",
    updated: typeof r.updated === "string" ? r.updated : "",
    downloads: Number(stats[statsKey(r.source)]?.total) || 0,
  };
}

let index: Promise<LibraryInfo[]> | null = null;

/** Every library in the catalogue. Fetched once; a failure can be retried. */
export function loadIndex(): Promise<LibraryInfo[]> {
  index ??= Promise.all([getJson(`${SITE}/libraries.json`), loadStats()]).then(([raw, stats]) => {
    if (!Array.isArray(raw)) throw new CatalogError("The catalogue didn't list any libraries.");
    return raw.flatMap((r) => {
      const info = infoOf(r, stats);
      return info ? [info] : [];
    });
  });
  index.catch(() => {
    index = null;
  });
  return index;
}

const libraries = new Map<string, Promise<LibraryItem[]>>();

/** A library's items. Fetched once per library; a failure can be retried. */
export function loadLibrary(info: LibraryInfo): Promise<LibraryItem[]> {
  let items = libraries.get(info.source);
  if (!items) {
    items = getJson(fileUrl(info.source)).then(parseLibrary);
    items.catch(() => libraries.delete(info.source));
    libraries.set(info.source, items);
  }
  return items;
}
