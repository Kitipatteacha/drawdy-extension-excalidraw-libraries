import {
  DriverCommand,
  DriverCommandIssuer,
  DriverCommandRequest,
  DriverManifest,
  ModuleStyling,
} from "@drawdy/driver-protocol";

import type { DriverToWebview } from "../panel/messages";

export type Session = {
  manifest: DriverManifest;
  issueCommand: DriverCommandIssuer;
  generateId: () => string;
  styling: ModuleStyling;
  actionButtonId: string;
  webviewId: string;
};

let current: Session | null = null;

export const open = (session: Session): void => {
  current = session;
};

export const isOpen = (): boolean => current !== null;

export function session(): Session {
  if (current === null) throw new Error("driver used before activate");
  return current;
}

export const updateStyling = (styling: ModuleStyling): void => {
  session().styling = styling;
};

/* ------------------------------------------------------------------ */
/* Issuing commands                                                     */
/* ------------------------------------------------------------------ */

type CommandType = DriverCommandRequest["type"];

/** The `req` a command takes, or `undefined` for the ones that take none. */
type ReqOf<T extends CommandType> =
  Extract<DriverCommandRequest, { type: T }> extends { req: infer R }
    ? R
    : undefined;

/** The value a command answers with when it succeeds. */
type ValueOf<T extends CommandType> = Extract<
  Extract<DriverCommand, { type: T }>["res"],
  { error?: never }
>["value"];

let requestId = 0;
const nextRequestId = (): string => String(requestId++);

/**
 * Issues a command. Null when it failed; commands that answer with nothing
 * resolve to `undefined` when they succeed.
 */
export async function command<T extends CommandType>(
  type: T,
  ...rest: ReqOf<T> extends undefined ? [] : [req: ReqOf<T>]
): Promise<ValueOf<T> | null> {
  const active = session();
  const res = await active.issueCommand({
    type,
    driverId: active.manifest.driverId,
    requestId: nextRequestId(),
    req: rest[0],
  } as DriverCommandRequest);
  return res.res.error === undefined ? (res.res.value as ValueOf<T>) : null;
}

export function post(message: DriverToWebview): void {
  void command("command:webview:post-message", {
    webviewDomId: session().webviewId,
    message,
  });
}

/** The theme tokens as one `:root` declaration list for the panel. */
export const stylingCss = (styling: ModuleStyling): string =>
  `color-scheme: ${styling.theme};` +
  Object.entries(styling.tokens ?? {})
    .map(([name, value]) => `${name}: ${value};`)
    .join("");
