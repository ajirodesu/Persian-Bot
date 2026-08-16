/**
 * AI Agent — browser tool (DuckDuckGo-based, Bing fallback)
 *
 * Searches the web via DuckDuckGo's HTML endpoint (no API key, no browser
 * required) or fetches a page's readable text directly. Replaces the old
 * puppeteer/Chrome implementation — the agent no longer needs a local browser
 * or any environment configuration to browse.
 *
 * DuckDuckGo sometimes serves a CAPTCHA/anomaly page to automated clients
 * (IP-based, status 202). When that happens the tool automatically falls back
 * to Bing's HTML search, so the agent still gets results. Each response is
 * labeled with the engine that produced it.
 */

import axios from 'axios';
import type { ToolMeta, ToolContext } from '../agent-tool.types.js';

const CONTENT_LIMIT = 4000;
const MAX_RESULTS = 6;
const FETCH_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 3 * 1024 * 1024; // 3 MB — plenty for text extraction

// A real browser UA — search engines serve their standard layout to it.
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// Markers that identify a CAPTCHA / anomaly / challenge page instead of results.
// Word boundaries keep innocent matches (e.g. `challenges.cloudflare.com` in a
// page's JS bootstrap) from tripping the detector.
const CHALLENGE_RE =
  /\b(captcha|anomaly|challenge)\b|verify you are human|unusual traffic|If this issue persists/i;

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const meta: ToolMeta = {
  name: 'browser',
  description:
    'Search the web (DuckDuckGo, with Bing fallback) or fetch a page’s text. ' +
    "Pass a plain search query to search the web (e.g. 'latest AI news'), " +
    "or pass a full URL to read the page directly (e.g. 'https://example.com'). " +
    'Returns search results (title, link, snippet) or the page text content.',
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
// HTML helpers (dependency-free — no cheerio needed)
// ============================================================================

const ENTITY_MAP: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
};

/** Decodes HTML entities (named + numeric) in a string. */
function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) =>
      String.fromCodePoint(parseInt(dec, 10)),
    )
    .replace(/&([a-z]+);/gi, (match, name: string) => ENTITY_MAP[name] ?? match);
}

/** Removes script/style blocks and tags, collapses whitespace, decodes entities. */
function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Decodes a base64url string (DuckDuckGo ad links encode the target in `u=`). */
function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  try {
    return decodeURIComponent(
      Buffer.from(padded, 'base64').toString('utf8'),
    );
  } catch {
    return value;
  }
}

/**
 * Extracts the real destination from a DuckDuckGo result link. Organic links
 * use /l/?uddg=<urlencoded-url>; sponsored links use y.js?…&u=<base64url>.
 */
function resolveDuckDuckGoUrl(href: string): string {
  try {
    // The HTML endpoint escapes & as &amp; inside href attributes — decode
    // before parsing the query string so the u= param is found.
    const decoded = decodeEntities(href);
    const queryStart = decoded.indexOf('?');
    if (queryStart === -1) return decoded;
    const params = new URLSearchParams(decoded.slice(queryStart + 1));
    const uddg = params.get('uddg');
    if (uddg) {
      const target = decodeURIComponent(uddg);
      // Ad links: uddg points at a duckduckgo.com/y.js?…&u=<base64url>
      // tracker — resolve the real destination from its u= param.
      const innerQ = target.indexOf('?');
      if (innerQ !== -1) {
        const inner = new URLSearchParams(target.slice(innerQ + 1));
        const adTarget = inner.get('u');
        if (adTarget) return decodeBase64Url(adTarget);
      }
      return target;
    }
    const adTarget = params.get('u');
    if (adTarget) return decodeBase64Url(adTarget);
    return decoded;
  } catch {
    return href;
  }
}

/**
 * Extracts the real destination from a Bing result link. Organic links are
 * bing.com/ck/a redirects that carry the target URL base64-encoded in `u=`.
 * Bing sometimes prefixes the payload with `a1` — strip it if the direct
 * decode doesn't produce a URL.
 */
function resolveBingUrl(href: string): string {
  try {
    const decoded = decodeEntities(href);
    const queryStart = decoded.indexOf('?');
    if (queryStart === -1) return decoded;
    const params = new URLSearchParams(decoded.slice(queryStart + 1));
    const encoded = params.get('u');
    if (encoded) {
      const direct = Buffer.from(encoded, 'base64').toString('utf8');
      if (/^https?:\/\//i.test(direct)) return direct;
      const prefixed = Buffer.from(encoded.replace(/^a1/, ''), 'base64').toString('utf8');
      if (/^https?:\/\//i.test(prefixed)) return prefixed;
    }
    return decoded;
  } catch {
    return href;
  }
}

// ============================================================================
// DuckDuckGo search
// ============================================================================

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Parses DuckDuckGo's HTML search results. Result anchors carry class
 * `result__a` (title + redirect link) and `result__snippet` (snippet). The
 * redirect href encodes the real URL in the `uddg` query param.
 */
function parseDuckDuckGoResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const anchorRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRe =
    /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;

  const titles: Array<{ text: string; href: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = anchorRe.exec(html)) !== null) {
    const tag = match[0];
    const hrefMatch = /href="([^"]*)"/i.exec(tag);
    const text = htmlToText(match[1] ?? '');
    if (text && hrefMatch?.[1]) {
      titles.push({ text, href: hrefMatch[1] });
    }
  }

  const snippets: string[] = [];
  while ((match = snippetRe.exec(html)) !== null) {
    const text = htmlToText(match[1] ?? '');
    if (text) snippets.push(text);
  }

  titles.slice(0, MAX_RESULTS).forEach((t, i) => {
    results.push({
      title: t.text,
      url: resolveDuckDuckGoUrl(t.href),
      snippet: snippets[i] ?? '',
    });
  });
  return results;
}

/**
 * Returns `null` when DuckDuckGo answered with a CAPTCHA/anomaly page (so the
 * caller can fall back to Bing) instead of pretending there are no results.
 */
async function searchDuckDuckGo(query: string): Promise<string | null> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const { status, data } = await axios.get<string>(url, {
    timeout: FETCH_TIMEOUT_MS,
    maxContentLength: MAX_RESPONSE_BYTES,
    headers: { 'User-Agent': USER_AGENT },
  });

  if (status !== 200 || CHALLENGE_RE.test(data)) return null;

  const results = parseDuckDuckGoResults(data);
  if (results.length === 0) {
    // DuckDuckGo may serve a "no results" page — surface that clearly.
    const noResults =
      /No results\.|Unfortunately, there were no results/i.test(data);
    return noResults
      ? `No results found for "${query}". Try a different search.`
      : `Could not parse DuckDuckGo results for "${query}".`;
  }

  return (
    `DuckDuckGo results for "${query}":\n` +
    results
      .map(
        (r, i) =>
          `[${i + 1}] ${r.title}\n${r.url}${r.snippet ? `\n${r.snippet}` : ''}`,
      )
      .join('\n\n')
  );
}

// ============================================================================
// Bing fallback search (used when DuckDuckGo is CAPTCHA-blocked)
// ============================================================================

/** Parses Bing's organic results (`<li class="b_algo">` blocks). */
function parseBingResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const blockRe = /<li class="b_algo"[^>]*>([\s\S]*?)<\/li>/gi;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(html)) !== null && results.length < MAX_RESULTS) {
    const block = match[1] ?? '';
    const linkRe =
      /<h2[^>]*><a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a><\/h2>/i;
    const link = linkRe.exec(block);
    const href = link?.[1];
    const titleHtml = link?.[2];
    if (!href || !titleHtml) continue;
    const title = htmlToText(titleHtml);
    if (!title) continue;
    const snippetMatch = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(block);
    results.push({
      title,
      url: resolveBingUrl(href),
      snippet: snippetMatch ? htmlToText(snippetMatch[1] ?? '') : '',
    });
  }
  return results;
}

async function searchBing(query: string): Promise<string> {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${MAX_RESULTS}`;
  const { status, data } = await axios.get<string>(url, {
    timeout: FETCH_TIMEOUT_MS,
    maxContentLength: MAX_RESPONSE_BYTES,
    headers: {
      'User-Agent': USER_AGENT,
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  if (status !== 200 || CHALLENGE_RE.test(data)) {
    return `Search is blocked right now: both DuckDuckGo and Bing are serving CAPTCHA pages for this network. Try again later.`;
  }

  const results = parseBingResults(data);
  if (results.length === 0) {
    return `No results found for "${query}" on Bing. Try a different search.`;
  }

  return (
    `Bing results for "${query}" (DuckDuckGo is CAPTCHA-blocked on this network):\n` +
    results
      .map(
        (r, i) =>
          `[${i + 1}] ${r.title}\n${r.url}${r.snippet ? `\n${r.snippet}` : ''}`,
      )
      .join('\n\n')
  );
}

/** Searches DuckDuckGo, falling back to Bing whenever DDG is blocked. */
async function search(query: string): Promise<string> {
  try {
    const ddg = await searchDuckDuckGo(query);
    if (ddg !== null) return ddg;
  } catch {
    // Any DuckDuckGo failure (timeout, block, parse) → try Bing.
  }
  return searchBing(query);
}

// ============================================================================
// Direct page fetch
// ============================================================================

async function fetchPageText(url: string): Promise<string> {
  const { data } = await axios.get<string>(url, {
    timeout: FETCH_TIMEOUT_MS,
    maxContentLength: MAX_RESPONSE_BYTES,
    responseType: 'text',
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
    },
  });

  const text = htmlToText(data);
  if (!text) return 'No readable text found on that page.';
  return text.length > CONTENT_LIMIT
    ? text.slice(0, CONTENT_LIMIT) +
        `\n\n[...truncated at ${CONTENT_LIMIT} chars]`
    : text;
}

// ============================================================================
// TOOL RUN
// ============================================================================

export const initialize = async (
  { input }: { input?: string },
  _ctx: ToolContext,
): Promise<string> => {
  const trimmed = (input ?? '').trim();
  if (!trimmed) return 'No input provided. Pass a search query or a URL.';

  const isUrl = /^https?:\/\//i.test(trimmed);

  try {
    return isUrl ? await fetchPageText(trimmed) : await search(trimmed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Web error: ${msg}`;
  }
}
