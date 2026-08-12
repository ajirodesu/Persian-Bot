/**
 * browser Tool — Control a Chrome browser to search the web or visit a URL
 *
 * Ports project-canis's browser tool (mrepol742/project-canis
 * src/components/ai/tools/browser.ts) into Cat-Bot's native agent tool shape
 * (config + run, dynamically loaded by agent.ts).
 *
 * Uses `puppeteer-core` and works with no configuration: it auto-detects a
 * system Chrome, Chromium, or Edge binary across Windows/macOS/Linux. An
 * optional PUPPETEER_EXEC_PATH env var overrides detection, and
 * AGENT_BROWSER_HEADLESS (default "true") controls headless mode. Only when no
 * browser binary can be found does the tool report an error — it never crashes
 * the agent run.
 */

import fs from 'node:fs';
import os from 'node:os';
import puppeteer from 'puppeteer-core';
import { env } from '@/engine/config/env.config.js';

const CONTENT_LIMIT = 4000;

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const config = {
  name: 'browser',
  description:
    'Control a Chrome browser to search the web or visit a URL. ' +
    "Pass a plain search query to search Google (e.g. 'latest AI news'), " +
    "or pass a full URL to navigate directly (e.g. 'https://example.com'). " +
    'Returns search results or page text content.',
  parameters: {
    type: 'object',
    properties: {
      input: {
        type: 'string',
        description:
          "A search query (e.g. 'TypeScript best practices 2025') " +
          "or a full URL (e.g. 'https://developer.mozilla.org/en-US/docs/Web/API')",
      },
    },
    required: ['input'],
  },
};

// ============================================================================
// BROWSER SETUP
// ============================================================================

const CHROME_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-sync',
  '--disable-translate',
  '--mute-audio',
  '--no-first-run',
  '--safebrowsing-disable-auto-update',
  // Anti-detection: mask automation signals
  '--disable-blink-features=AutomationControlled',
  '--disable-infobars',
  '--window-size=1280,800',
  '--start-maximized',
];

// Matches a real Chrome 125 on Linux — keeps fingerprint consistent
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// Common install locations for a Chrome/Chromium/Edge binary, per platform.
// Keeping the env var optional lets the tool "just work" on a dev machine while
// still allowing explicit overrides in production.
function getBrowserCandidates(): string[] {
  const home = os.homedir();

  if (process.platform === 'win32') {
    const pf = process.env['PROGRAMFILES'] ?? 'C:\\Program Files';
    const pfx86 =
      process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)';
    const local = process.env['LOCALAPPDATA'] ?? `${home}\\AppData\\Local`;
    // Chrome, Edge, then Chromium — most common first.
    return [
      `${pf}\\Google\\Chrome\\Application\\chrome.exe`,
      `${pfx86}\\Google\\Chrome\\Application\\chrome.exe`,
      `${local}\\Google\\Chrome\\Application\\chrome.exe`,
      `${pf}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${pfx86}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${local}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${pf}\\Chromium\\Application\\chrome.exe`,
      `${pfx86}\\Chromium\\Application\\chrome.exe`,
    ];
  }

  if (process.platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];
  }

  // Linux and any other platform
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
    '/snap/bin/chromium',
    '/snap/bin/google-chrome',
    '/opt/google/chrome/chrome',
  ];
}

/** Returns the first existing browser executable, or null when none found. */
function detectBrowserExecutable(): string | null {
  for (const candidate of getBrowserCandidates()) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

async function launchBrowser() {
  const executablePath =
    env.PUPPETEER_EXEC_PATH?.trim() || detectBrowserExecutable();
  if (!executablePath) {
    throw new Error(
      'No Chrome/Chromium/Edge browser could be found on this system and ' +
        'PUPPETEER_EXEC_PATH is not set — install a browser or set ' +
        'PUPPETEER_EXEC_PATH to its executable to enable the browser tool.',
    );
  }
  // AGENT_BROWSER_HEADLESS defaults to "true"; any other value opens a visible window.
  const headless = env.AGENT_BROWSER_HEADLESS !== 'false';
  return puppeteer.launch({
    executablePath,
    headless,
    args: CHROME_ARGS,
  });
}

async function setupPage(browser: Awaited<ReturnType<typeof launchBrowser>>) {
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);

  // Mask navigator.webdriver and other automation tells
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    // Remove the Chrome automation flag from window.chrome
    window.chrome = { runtime: {} };
  });

  // Block heavy resources — we only need text
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const type = req.resourceType();
    if (['image', 'media', 'font'].includes(type)) {
      req.abort();
    } else {
      req.continue();
    }
  });
  return page;
}

async function extractGoogleResults(
  page: Awaited<ReturnType<typeof setupPage>>,
): Promise<string> {
  // Wait for either the results container or the main content
  await page
    .waitForSelector('#rso, #search, main', { timeout: 10_000 })
    .catch(() => {});

  const results = await page.evaluate(() => {
    const items: Array<{ title: string; url: string; snippet: string }> = [];

    // Each organic result lives in a div.g or a sibling container inside #rso
    const blocks = document.querySelectorAll(
      '#rso div.g, #rso [data-sokoban-container], #rso > div > div',
    );

    for (const block of Array.from(blocks)) {
      const h3 = block.querySelector('h3');
      const link = block.querySelector<HTMLAnchorElement>("a[href^='http']");
      // Snippet: try known class names, fall back to any paragraph text
      const snippetEl =
        block.querySelector('.VwiC3b, [data-sncf="1"], .yXK7lf, .lEBKkf') ??
        block.querySelector('span, p');

      if (!h3 || !link) continue;

      const title = h3.textContent?.trim() ?? '';
      const url = link.href;
      const snippet = snippetEl?.textContent?.trim() ?? '';

      if (title && url) {
        items.push({ title, url, snippet });
      }
      if (items.length >= 6) break;
    }

    return items;
  });

  if (results.length > 0) {
    return results
      .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`)
      .join('\n\n');
  }

  // Fallback: return raw text from the results area
  const fallback = await page.evaluate(() => {
    return (
      (document.querySelector('#search') as HTMLElement)?.innerText?.slice(0, 4000) ??
      (document.body as HTMLElement)?.innerText?.slice(0, 4000) ??
      ''
    );
  });

  return fallback.trim() || 'No results found.';
}

async function extractPageText(
  page: Awaited<ReturnType<typeof setupPage>>,
): Promise<string> {
  const text: string = await page.evaluate(() => {
    document
      .querySelectorAll(
        "script, style, nav, footer, header, aside, [aria-hidden='true']",
      )
      .forEach((el) => el.remove());
    return (document.body?.innerText ?? '').replace(/\s{3,}/g, '\n\n').trim();
  });

  if (!text) return 'No readable text found on that page.';

  return text.length > CONTENT_LIMIT
    ? text.slice(0, CONTENT_LIMIT) +
        `\n\n[...truncated at ${CONTENT_LIMIT} chars]`
    : text;
}

// ============================================================================
// TOOL RUN
// ============================================================================

export const run = async ({ input }: { input?: string }): Promise<string> => {
  const trimmed = (input ?? '').trim();
  const isUrl = /^https?:\/\//i.test(trimmed);

  const targetUrl = isUrl
    ? trimmed
    : `https://www.google.com/search?q=${encodeURIComponent(trimmed)}&hl=en`;

  let browser: Awaited<ReturnType<typeof launchBrowser>> | null = null;

  try {
    browser = await launchBrowser();
    const page = await setupPage(browser);

    await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 25_000,
    });

    const result = isUrl
      ? await extractPageText(page)
      : await extractGoogleResults(page);

    return result;
  } catch (err: unknown) {
    return `Browser error: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
};