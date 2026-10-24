import { DriverModule } from "@drawdy/driver-protocol";
import { WEBVIEW_HTML } from "virtual:webview-html";

import { enqueue } from "./drawdy-bridge/queue";
import {
  command,
  isOpen,
  open,
  post,
  session,
  stylingCss,
  updateStyling,
} from "./drawdy-bridge/session";
import { BoardPoint, InsertError, insertPicture, insertShapes } from "./insert/place";
import { LIBRARIES_SVG } from "./panel/icon";
import { PanelPoint, Source, WebviewToDriver } from "./panel/messages";

export const activate: DriverModule["activate"] = async ({
  manifest,
  issueCommand,
  generateId,
  styling,
}) => {
  open({
    manifest,
    issueCommand,
    generateId,
    styling,
    actionButtonId: `${manifest.driverId}:action-button`,
    webviewId: `${manifest.driverId}:webview`,
  });

  const button = await command("command:dom:create-action-button", {
    domElementId: session().actionButtonId,
    svg: LIBRARIES_SVG,
  });
  if (!button?.created) return;

  await command("subscription:dom:theme-changed");
  await command("subscription:dom:element-clicked", {
    domElementId: session().actionButtonId,
  });
  await command("subscription:webview:message", {
    webviewDomId: session().webviewId,
  });
};

const postStyling = (): void =>
  post({
    type: "styling",
    css: stylingCss(session().styling),
    theme: session().styling.theme,
  });

export const onEvent: DriverModule["onEvent"] = async (e) => {
  if (!isOpen()) return;
  switch (e.type) {
    case "subscription:dom:theme-changed": {
      updateStyling(e.body.styling);
      postStyling();
      return;
    }
    case "subscription:dom:element-clicked": {
      if (e.body.domElementId !== session().actionButtonId) return;
      await command("command:webview:create", {
        webviewDomId: session().webviewId,
        htmlContent: WEBVIEW_HTML.replace(
          "/*__DRAWDY_STYLING__*/",
          stylingCss(session().styling),
        ),
        // Keeps the catalogue and the open library while the panel is shut.
        keepStateWhenClosed: true,
      });
      return;
    }
    case "subscription:webview:message": {
      if (e.body.webviewDomId !== session().webviewId) return;
      const message = e.body.message;
      if (typeof message !== "object" || message === null) return;
      handleWebviewMessage(message as WebviewToDriver);
      return;
    }
    default:
      return;
  }
};

const itemName = (source: Source): string =>
  source.item ? `"${source.item}"` : "the item";

/** Runs an insert after the ones before it, and tells the panel how it went. */
function inserting(name: string, task: () => Promise<void>): void {
  enqueue(async () => {
    try {
      await task();
      post({ type: "inserted", ok: true, text: `Added ${name} to the board.` });
    } catch (err) {
      post({
        type: "inserted",
        ok: false,
        text: err instanceof InsertError ? err.message : `Couldn't add ${name}.`,
      });
    }
  });
}

/** Where the panel sits on the page, so its points can be put on the board. */
const panelRect = () => command("command:dom:element-rect", { elementId: session().webviewId });

/** The board point under a point in the panel, or null to use the middle. */
async function boardPoint(at: PanelPoint | undefined): Promise<BoardPoint | undefined> {
  if (!at) return undefined;
  const panel = await panelRect();
  if (!panel) throw new InsertError("Couldn't tell where the item was dropped.");
  const point = await command("command:camera:screen-to-canvas", {
    x: panel.x + at.x,
    y: panel.y + at.y,
  });
  if (!point) throw new InsertError("Couldn't tell where the item was dropped.");
  return point;
}

function handleWebviewMessage(message: WebviewToDriver): void {
  switch (message.type) {
    case "ready": {
      postStyling();
      return;
    }
    case "insert-shapes": {
      if (!Array.isArray(message.elements)) return;
      const { elements, source, at } = message;
      inserting(itemName(source), async () =>
        insertShapes(elements, source, await boardPoint(at)),
      );
      return;
    }
    case "insert-picture": {
      if (!(message.png instanceof ArrayBuffer)) return;
      const { png, width, height, source, at } = message;
      inserting(itemName(source), async () =>
        insertPicture(png, width, height, source, await boardPoint(at)),
      );
      return;
    }
  }
}
