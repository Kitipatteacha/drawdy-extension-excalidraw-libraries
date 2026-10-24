import { fitOf } from "../src/excalidraw/classify";
import { LibraryFormatError, parseLibrary } from "../src/excalidraw/parse";
import type { LibraryItem } from "../src/excalidraw/types";
import type { DriverToWebview, PanelPoint, Theme, WebviewToDriver } from "../src/panel/messages";
import {
  authorNames,
  CatalogError,
  LibraryInfo,
  loadIndex,
  loadLibrary,
  previewUrl,
} from "./catalog";
import { loadFonts } from "./fonts";
import { drawPicture, drawThumbnail } from "./render";

const api = acquireDrawdyApi();
const send = (message: WebviewToDriver, transfer?: Transferable[]): void =>
  api.postMessage(message, transfer);

const svg = (body: string, size = 16): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const ICONS = {
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', 15),
  back: svg('<path d="m15 18-6-6 6-6"/>'),
  file: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 18v-6M9 15l3-3 3 3"/>'),
  picture: svg('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>', 13),
  warn: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>', 22),
  empty: svg('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 17.5h7"/>', 22),
};

/* ------------------------------------------------------------------ */
/* DOM helpers                                                          */
/* ------------------------------------------------------------------ */

type Props = Record<string, string | boolean | EventListener | undefined>;

function h(tag: string, props: Props = {}, ...children: (Node | string | null)[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === false) continue;
    if (typeof value === "function") el.addEventListener(key.slice(2), value);
    else if (key === "html") el.innerHTML = String(value);
    else el.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children) if (child !== null) el.append(child);
  return el;
}

/* ------------------------------------------------------------------ */
/* State                                                                */
/* ------------------------------------------------------------------ */

type Sort = "popular" | "new" | "name";

type OpenLibrary = {
  title: string;
  byline: string;
  description: string;
  /** Null for a file opened from this device. */
  info: LibraryInfo | null;
  items: LibraryItem[] | null;
  error: string | null;
};

const state = {
  theme: "light" as Theme,
  query: "",
  sort: "popular" as Sort,
  index: null as LibraryInfo[] | null,
  indexError: null as string | null,
  library: null as OpenLibrary | null,
  browseScroll: 0,
};

/* ------------------------------------------------------------------ */
/* Frame                                                                */
/* ------------------------------------------------------------------ */

const fileInput = h("input", {
  type: "file",
  accept: ".excalidrawlib,.excalidraw,.json,application/json",
  hidden: true,
}) as HTMLInputElement;
const main = h("main");
const toastEl = h("div", { class: "toast", role: "alert" });

// Drawdy's panel already shows the name and icon above the webview, so the
// panel starts straight with its toolbar.
document.getElementById("app")!.append(main, toastEl, fileInput);

let toastTimer = 0;
/** Says something went wrong. Things that work show for themselves. */
function toast(text: string): void {
  toastEl.textContent = text;
  toastEl.classList.add("shown");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove("shown"), 4000);
}

const loading = (text: string): HTMLElement =>
  h("div", { class: "loading" }, text, h("div", { class: "progress" }, h("div")));

function problem(title: string, detail: string, retry?: () => void): HTMLElement {
  return h(
    "div",
    { class: "empty" },
    h("span", { html: ICONS.warn }),
    h("strong", {}, title),
    h("span", {}, detail),
    retry ? h("button", { class: "btn", onclick: retry }, "Try again") : null,
  );
}

/* ------------------------------------------------------------------ */
/* Browse                                                               */
/* ------------------------------------------------------------------ */

let listEl: HTMLElement | null = null;
let countEl: HTMLElement | null = null;

function matches(info: LibraryInfo, words: string[]): boolean {
  const hay = `${info.name} ${info.description} ${authorNames(info.authors)}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

function shownLibraries(all: LibraryInfo[]): LibraryInfo[] {
  const words = state.query.toLowerCase().split(/\s+/).filter(Boolean);
  const found = all.filter((info) => matches(info, words));
  switch (state.sort) {
    case "name":
      return found.sort((a, b) => a.name.localeCompare(b.name));
    case "new":
      return found.sort((a, b) => b.updated.localeCompare(a.updated) || a.name.localeCompare(b.name));
    case "popular":
      return found.sort((a, b) => b.downloads - a.downloads || a.name.localeCompare(b.name));
  }
}

/** Previews are a grid of items in cells this many pixels square. */
const PREVIEW_CELL = 144;
const PREVIEW_COLUMNS = 4;
const PREVIEW_ROWS = 2;

/**
 * The first rows of a library's preview, four items across, so the items
 * are big enough to make out rather than the whole grid shrunk to fit.
 */
function preview(info: LibraryInfo): HTMLElement {
  const well = h("div", { class: "preview" });
  const img = h("img", { src: previewUrl(info), alt: "", loading: "lazy" }) as HTMLImageElement;
  img.addEventListener("load", () => {
    const { naturalWidth: w, naturalHeight: h } = img;
    if (w % PREVIEW_CELL === 0 && h % PREVIEW_CELL === 0) {
      const rows = Math.min(h / PREVIEW_CELL, PREVIEW_ROWS);
      img.style.width = `${((w / PREVIEW_CELL) * 100) / PREVIEW_COLUMNS}%`;
      well.style.aspectRatio = `${PREVIEW_COLUMNS} / ${rows}`;
    } else {
      // Older previews aren't on the grid: fit the width, keep the top.
      well.style.aspectRatio = String(Math.max(w / h, PREVIEW_COLUMNS / PREVIEW_ROWS));
    }
  });
  img.addEventListener("error", () => well.remove());
  well.append(img);
  return well;
}

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

/** The authors and how often the library has been downloaded. */
function byline(info: LibraryInfo): string {
  const parts = [authorNames(info.authors)];
  if (info.downloads > 0) {
    parts.push(`${compact.format(info.downloads)} ${info.downloads === 1 ? "download" : "downloads"}`);
  }
  return parts.filter(Boolean).join(" · ");
}

function card(info: LibraryInfo): HTMLElement {
  return h(
    "button",
    { class: "card", onclick: () => openCatalogLibrary(info) },
    info.preview ? preview(info) : null,
    h(
      "div",
      { class: "card-text" },
      h("strong", {}, info.name),
      byline(info) ? h("span", { class: "by" }, byline(info)) : null,
      info.description ? h("p", { class: "desc" }, info.description) : null,
    ),
  );
}

function renderList(): void {
  if (!listEl || !countEl || !state.index) return;
  const shown = shownLibraries(state.index);
  const total = state.index.length;
  countEl.textContent = state.query
    ? `${shown.length} of ${total} libraries`
    : `${total} libraries`;
  listEl.replaceChildren(
    ...(shown.length
      ? shown.map(card)
      : [h("div", { class: "empty" }, h("span", { html: ICONS.empty }), h("strong", {}, "No library matches"), h("span", {}, "Try another word."))]),
  );
}

function renderBrowse(): void {
  listEl = countEl = null;
  if (state.indexError) {
    main.replaceChildren(
      problem("Couldn't load the libraries", state.indexError, () => {
        state.indexError = null;
        showBrowse();
      }),
    );
    return;
  }
  if (!state.index) {
    main.replaceChildren(loading("Loading the libraries…"));
    return;
  }

  const search = h("input", {
    type: "search",
    placeholder: "Search libraries",
    "aria-label": "Search libraries",
    value: state.query,
  }) as HTMLInputElement;
  search.value = state.query;
  search.addEventListener("input", () => {
    state.query = search.value;
    renderList();
  });
  const sort = h(
    "select",
    { "aria-label": "Sort libraries" },
    h("option", { value: "popular" }, "Popular"),
    h("option", { value: "new" }, "Newest"),
    h("option", { value: "name" }, "A–Z"),
  ) as HTMLSelectElement;
  sort.value = state.sort;
  sort.addEventListener("change", () => {
    state.sort = sort.value as Sort;
    renderList();
  });

  listEl = h("div", { class: "list" });
  countEl = h("span", {});
  main.replaceChildren(
    h(
      "div",
      { class: "view" },
      h(
        "div",
        { class: "toolbar" },
        h("label", { class: "search", html: ICONS.search }, search),
        h("button", {
          class: "icon-btn",
          title: "Open a library file",
          "aria-label": "Open a library file",
          html: ICONS.file,
          onclick: () => fileInput.click(),
        }),
      ),
      h("div", { class: "meta-row" }, countEl, sort),
      listEl,
      h(
        "div",
        { class: "credit" },
        "Shared by their authors at libraries.excalidraw.com under the MIT license.",
      ),
    ),
  );
  renderList();
  main.scrollTop = state.browseScroll;
}

function showBrowse(): void {
  state.library = null;
  renderBrowse();
  if (state.index || state.indexError) return;
  loadIndex().then(
    (index) => {
      state.index = index;
      if (!state.library) renderBrowse();
    },
    (err) => {
      state.indexError = err instanceof CatalogError ? err.message : "Something went wrong.";
      if (!state.library) renderBrowse();
    },
  );
}

/* ------------------------------------------------------------------ */
/* Library                                                              */
/* ------------------------------------------------------------------ */

type Tile = { el: HTMLElement; canvas: HTMLCanvasElement; item: LibraryItem; drawn: boolean };

const THUMB = 80;
let tiles: Tile[] = [];
let observer: IntersectionObserver | null = null;

const hasText = (item: LibraryItem): boolean => item.elements.some((e) => e.type === "text");

function draw(tile: Tile): void {
  drawThumbnail(tile.canvas, tile.item.elements, THUMB, state.theme);
  tile.drawn = true;
}

/** Draws thumbnails as they scroll into view, a frame's worth at a time. */
let queued: Tile[] = [];
let drawing = false;
function queueDraw(tile: Tile): void {
  queued.push(tile);
  if (drawing) return;
  drawing = true;
  const step = (): void => {
    const until = performance.now() + 10;
    while (queued.length && performance.now() < until) {
      const next = queued.shift()!;
      if (tiles.includes(next)) draw(next);
    }
    if (queued.length) requestAnimationFrame(step);
    else drawing = false;
  };
  requestAnimationFrame(step);
}

const pending: HTMLElement[] = [];

/** Adds an item to the board, dropped at `at` or in the middle of the view. */
async function insert(item: LibraryItem, tile: HTMLElement, at?: PanelPoint): Promise<void> {
  const library = state.library;
  if (!library) return;
  const fit = fitOf(item.elements);
  if (fit.kind === "empty") return;
  const source = { library: library.title, item: item.name };
  tile.classList.add("busy");
  pending.push(tile);
  try {
    if (fit.kind === "shapes") {
      send({ type: "insert-shapes", elements: item.elements, source, at });
      return;
    }
    if (hasText(item)) {
      await Promise.race([loadFonts(), new Promise((r) => setTimeout(r, 4000))]);
    }
    const picture = await drawPicture(item.elements, state.theme);
    send({ type: "insert-picture", ...picture, source, at }, [picture.png]);
  } catch {
    pending.splice(pending.indexOf(tile), 1);
    tile.classList.remove("busy");
    toast("Couldn't draw this item.");
  }
}

/* ------------------------------------------------------------------ */
/* Dragging an item onto the board                                      */
/* ------------------------------------------------------------------ */

/** Marks a drag as one of ours. Drawdy's board ignores types it doesn't know. */
const DRAG_TYPE = "application/x-drawdy-excalidraw-item";

const outsidePanel = (p: PanelPoint): boolean =>
  p.x < 0 || p.y < 0 || p.x > window.innerWidth || p.y > window.innerHeight;

/**
 * Lets an item be dragged out of the panel with the browser's own drag,
 * which, unlike pointer events, carries on outside the panel. The board
 * takes any drag, so the drag ends with a copy when it's let go over the
 * board and with none when it's cancelled or let go over the panel. Where it
 * ended comes from screen coordinates, the ones browsers agree on.
 */
function makeDraggable(tile: Tile): void {
  const el = tile.el;
  let offset: PanelPoint = { x: 0, y: 0 };
  el.draggable = true;
  el.addEventListener("dragstart", (e) => {
    if (!e.dataTransfer || el.classList.contains("busy")) {
      e.preventDefault();
      return;
    }
    if (!tile.drawn) draw(tile);
    offset = { x: e.screenX - e.clientX, y: e.screenY - e.clientY };
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData(DRAG_TYPE, tile.item.name);
    e.dataTransfer.setDragImage(tile.canvas, THUMB / 2, THUMB / 2);
    el.classList.add("dragging");
  });
  el.addEventListener("dragend", (e) => {
    el.classList.remove("dragging");
    if (e.dataTransfer?.dropEffect === "none") return;
    const at = { x: e.screenX - offset.x, y: e.screenY - offset.y };
    if (outsidePanel(at)) void insert(tile.item, el, at);
  });
}

function tileFor(item: LibraryItem, i: number): Tile {
  const fit = fitOf(item.elements);
  const asPicture = fit.kind === "picture";
  const label = item.name || `Item ${i + 1}`;
  const canvas = h("canvas", { width: String(THUMB), height: String(THUMB) }) as HTMLCanvasElement;
  // A div rather than a button: Firefox won't drag a button.
  const el = h(
    "div",
    {
      class: "tile",
      role: "button",
      tabindex: "0",
      title: asPicture ? `${label}: goes in as a picture, for ${fit.reason}` : label,
      "aria-label": `Add ${label}`,
    },
    h(
      "span",
      { class: "thumb" },
      canvas,
      asPicture ? h("span", { class: "badge", html: ICONS.picture }) : null,
    ),
    item.name ? h("span", { class: "name" }, item.name) : null,
  );
  const tile: Tile = { el, canvas, item, drawn: false };
  el.addEventListener("click", () => void insert(item, el));
  el.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    void insert(item, el);
  });
  makeDraggable(tile);
  return tile;
}

function renderLibrary(): void {
  const library = state.library;
  if (!library) return;
  observer?.disconnect();
  tiles = [];
  queued = [];
  const byline = library.byline || (library.info ? "" : "From a file on this device");
  const head = h(
    "div",
    { class: "lib-head" },
    h(
      "div",
      { class: "lib-bar" },
      h("button", {
        class: "icon-btn",
        title: "All libraries",
        "aria-label": "All libraries",
        html: ICONS.back,
        onclick: showBrowse,
      }),
      h("h2", { title: library.title }, library.title),
    ),
    byline ? h("span", { class: "by" }, byline) : null,
    library.description ? h("p", { class: "desc" }, library.description) : null,
  );

  let body: HTMLElement;
  if (library.error) {
    body = problem(
      "Couldn't open this library",
      library.error,
      library.info ? () => openCatalogLibrary(library.info!) : undefined,
    );
  } else if (!library.items) {
    body = loading("Opening the library…");
  } else {
    const items = library.items.filter((item) => fitOf(item.elements).kind !== "empty");
    if (items.length === 0) {
      body = h("div", { class: "empty" }, h("span", { html: ICONS.empty }), h("strong", {}, "Nothing to add"), h("span", {}, "This library has no shapes Drawdy can show."));
    } else {
      tiles = items.map(tileFor);
      const grid = h("div", { class: "grid" }, ...tiles.map((t) => t.el));
      body = h(
        "div",
        { class: "view" },
        h("div", { class: "meta-row" }, `${items.length} ${items.length === 1 ? "item" : "items"} · click one to add it`),
        grid,
      );
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const tile = tiles.find((t) => t.el === entry.target);
            if (tile && !tile.drawn) queueDraw(tile);
            observer?.unobserve(entry.target);
          }
        },
        { root: main, rootMargin: "200px" },
      );
      for (const tile of tiles) observer.observe(tile.el);
      if (items.some(hasText)) {
        void loadFonts().then(() => {
          for (const tile of tiles) if (tile.drawn && hasText(tile.item)) draw(tile);
        });
      }
    }
  }
  main.replaceChildren(h("div", { class: "view" }, head, body));
}

function openLibrary(library: OpenLibrary): void {
  if (!state.library) state.browseScroll = main.scrollTop;
  state.library = library;
  renderLibrary();
  main.scrollTop = 0;
}

function openCatalogLibrary(info: LibraryInfo): void {
  const library: OpenLibrary = {
    title: info.name,
    byline: info.authors.length ? `by ${authorNames(info.authors)}` : "",
    description: info.description,
    info,
    items: null,
    error: null,
  };
  openLibrary(library);
  loadLibrary(info).then(
    (items) => {
      library.items = items;
      if (state.library === library) renderLibrary();
    },
    (err) => {
      library.error =
        err instanceof CatalogError || err instanceof LibraryFormatError
          ? err.message
          : "Something went wrong.";
      if (state.library === library) renderLibrary();
    },
  );
}

async function openFile(file: File): Promise<void> {
  let items: LibraryItem[];
  try {
    items = parseLibrary(JSON.parse(await file.text()));
  } catch (err) {
    toast(err instanceof LibraryFormatError ? err.message : "That file isn't an Excalidraw library.");
    return;
  }
  openLibrary({
    title: file.name.replace(/\.(excalidrawlib|excalidraw|json)$/i, ""),
    byline: "",
    description: "",
    info: null,
    items,
    error: null,
  });
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (file) void openFile(file);
});

document.addEventListener("dragover", (e) => {
  if (!e.dataTransfer?.types.includes("Files")) return;
  e.preventDefault();
  document.body.classList.add("drop");
});
document.addEventListener("dragleave", (e) => {
  if (e.relatedTarget === null) document.body.classList.remove("drop");
});
document.addEventListener("drop", (e) => {
  e.preventDefault();
  document.body.classList.remove("drop");
  const file = e.dataTransfer?.files[0];
  if (file) void openFile(file);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && state.library) showBrowse();
});

/* ------------------------------------------------------------------ */
/* Driver messages                                                      */
/* ------------------------------------------------------------------ */

api.onMessage((raw) => {
  const message = raw as DriverToWebview;
  switch (message.type) {
    case "styling": {
      document.getElementById("styling")!.textContent = `:root{${message.css}}`;
      const changed = message.theme !== state.theme;
      state.theme = message.theme;
      document.documentElement.dataset.theme = message.theme;
      if (changed) for (const tile of tiles) if (tile.drawn) draw(tile);
      return;
    }
    case "inserted": {
      pending.shift()?.classList.remove("busy");
      // The item showing up selected on the board says it worked.
      if (!message.ok) toast(message.text);
      return;
    }
  }
});

showBrowse();
send({ type: "ready" });
