/**
 * Minimal ambient DOM types for the agent `browser` tool's page.evaluate callbacks.
 *
 * This package targets Node (tsconfig lib: ["esnext"], types: ["node"]) — the DOM
 * lib is deliberately omitted so server code stays free of browser globals. But
 * puppeteer's browser-context callbacks legitimately touch the DOM, so only the
 * exact surface the browser tool uses is declared here, typed without `any`.
 */

declare const document: {
  querySelector(selectors: string): HTMLElement | null;
  querySelectorAll(selectors: string): HTMLElement[];
  body: HTMLElement | null;
};

declare const window: {
  chrome?: unknown;
};

declare const navigator: {
  webdriver: unknown;
  plugins: unknown;
  languages: unknown;
};

declare class HTMLElement {
  textContent: string | null;
  innerText: string;
  remove(): void;
  querySelector<T extends HTMLElement = HTMLElement>(
    selectors: string,
  ): T | null;
  querySelectorAll(selectors: string): HTMLElement[];
}

declare class HTMLAnchorElement extends HTMLElement {
  href: string;
}
