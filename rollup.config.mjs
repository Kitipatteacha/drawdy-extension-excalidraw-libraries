// Builds the panel first, then embeds it in the driver as `WEBVIEW_HTML`,
// the way the presentation example does.

import resolve from "@rollup/plugin-node-resolve";
import terser from "@rollup/plugin-terser";
import typescript from "@rollup/plugin-typescript";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

const WEBVIEW_HTML_MODULE = "virtual:webview-html";

function webviewHtml() {
    return {
        name: "webview-html",
        resolveId(id) {
            return id === WEBVIEW_HTML_MODULE ? `\0${id}` : null;
        },
        load(id) {
            if (id !== `\0${WEBVIEW_HTML_MODULE}`) return null;
            const cssPath = join(root, "webview", "styles.css");
            const jsPath = join(root, "dist", "webview.js");
            this.addWatchFile(cssPath);
            this.addWatchFile(jsPath);
            const css = readFileSync(cssPath, "utf8");
            const js = readFileSync(jsPath, "utf8").replaceAll(
                "</script",
                "<\\/script"
            );
            const html =
                `<!doctype html><html><head><meta charset="utf-8"/>` +
                `<meta name="viewport" content="width=device-width, initial-scale=1"/>` +
                `<style id="styling">:root{/*__DRAWDY_STYLING__*/}</style>` +
                `<style>${css}</style></head><body><div id="app"></div>` +
                `<script>${js}</script></body></html>`;
            return `export const WEBVIEW_HTML = ${JSON.stringify(html)};`;
        },
    };
}

/** The panel, with roughjs and perfect-freehand, for the sandboxed iframe. */
const webview = {
    input: join(root, "webview", "index.ts"),
    output: {
        file: join(root, "dist", "webview.js"),
        format: "iife",
    },
    plugins: [
        typescript({ tsconfig: join(root, "tsconfig.json") }),
        resolve({ browser: true }),
        terser(),
    ],
};

const driver = {
    input: join(root, "src", "index.ts"),
    output: {
        file: join(root, "dist", "main.js"),
        format: "cjs",
        exports: "named",
    },
    plugins: [
        webviewHtml(),
        typescript({ tsconfig: join(root, "tsconfig.json") }),
    ],
};

export default [webview, driver];
