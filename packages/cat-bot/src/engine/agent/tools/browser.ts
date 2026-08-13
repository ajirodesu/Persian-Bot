/**
 * browser Tool — Web Search & Page Reader (Native, No Browser Binary)
 *
 * Converted from project-canis (src/components/ai/tools/browser.ts).
 *
 * The original drives a headless Chrome via puppeteer-core. Cat-Bot has no
 * Chrome dependency, so this port achieves the same two capabilities with
 * Node's built-in fetch — zero new dependencies, works identically on every
 * platform the bot runs on:
 *
 *   - Plain search query  → DuckDuckGo HTML search (no API key, no JS engine
 *     needed server-side), parsed into titled results with real destination
 *     URLs (the /l/?uddg= redirect is unwrapped).
 *   - Full URL (http/https) → fetched and reduced to readable page text.
 *
 * Reliability contract: never throws. Every failure path returns a descriptive
 * string the LLM can relay. Hard timeouts bound every network call.
 */

// ============================================================================
// CONSTANTS
// ============================================================================

const CONTENT_LIMIT = 4_000;
const FETCH_TIMEOUT_MS = 25_000;
const MAX_RESULTS = 6;
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// ============================================================================
// HTML HELPERS (pure — unit tested)
// ============================================================================

/** Decodes the common HTML entities found in search snippets and page text. */
export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_m, dec: string) =>
      String.fromCodePoint(parseInt(dec, 10)),
    )
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'");
}

/**
 * Reduces a raw HTML document to readable text: drops navigation/script noise,
 * preserves block boundaries as newlines, strips tags, decodes entities, and
 * collapses runs of whitespace (mirrors the original's extractPageText).
 */
export function extractPageText(html: string): string {
  let text = html
    // Drop non-content blocks entirely (script/style/include noise)
    .replace(
      /<(script|style|noscript|template|nav|footer|header|aside|iframe|svg)[^>]*>[\s\S]*?<\/\1>/gi,
      ' ',
    )
    // Preserve block boundaries as newlines
    .replace(
      /<\/(p|div|li|tr|section|article|blockquote|h[1-6]|table|ul|ol|pre)>/gi,
      '\n',
    )
    .replace(/<br\s*\/?>/gi, '\n')
    // Strip every remaining tag
    .replace(/<[^>]*>/g, ' ');

  text = decodeEntities(text)
    .replace(/[ \t]+/g, ' ')
    .replace(/\s{3,}/g, '\n\n')
    .trim();

  if (!text) return 'No readable text found on that page.';
  return text.length > CONTENT_LIMIT
    ? `${text.slice(0, CONTENT_LIMIT)}\n\n[...truncated at ${CONTENT_LIMIT} chars]`
    : text;
}

/**
 * Parses DuckDuckGo's HTML search results page into {title, url, snippet}
 * entries. The result URL is a /l/?uddg= redirect — unwrapped to the real
 * destination. Returns up to MAX_RESULTS entries.
 */
export function extractDuckDuckGoResults(
  html: string,
): Array<{ title: string; url: string; snippet: string }> {
  const results: Array<{ title: string; url: string; snippet: string }> = [];

  // Each organic result contains a <a class="result__a" ...>Title</a> block.
  // Splitting on that class yields one chunk per result (chunk[0] is preamble).
  const chunks = html.split('class="result__a"');
  for (let i = 1; i < chunks.length && results.length < MAX_RESULTS; i++) {
    const chunk = chunks[i] ?? '';

    const anchorEnd = chunk.indexOf('</a>');
    let title = '';
    if (anchorEnd !== -1) {
      // The chunk starts right AFTER 'class="result__a"' — the opening tag's
      // start was consumed by the split delimiter, so drop up to the first '>'
      // before stripping any remaining tags.
      let titleHtml = chunk.slice(0, anchorEnd);
      const tagEnd = titleHtml.indexOf('>');
      if (tagEnd !== -1) titleHtml = titleHtml.slice(tagEnd + 1);
      title = decodeEntities(titleHtml.replace(/<[^>]*>/g, '')).trim();
    }

    let url = '';
    const href = chunk.match(/href="([^"]+)"/);
    if (href?.[1]) {
      url = href[1];
      if (url.startsWith('//')) url = `https:${url}`;
      // Unwrap the DDG redirect to the real destination
      const uddg = url.match(/[?&]uddg=([^&]+)/);
      if (uddg?.[1]) {
        try {
          url = decodeURIComponent(uddg[1]);
        } catch {
          // Keep the redirect URL when decoding fails — still usable
        }
      }
    }

    const snippetMatch = chunk.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    const snippet = snippetMatch?.[1]
      ? decodeEntities(snippetMatch[1].replace(/<[^>]*>/g, '')).trim()
      : '';

    if (title && url) results.push({ title, url, snippet });
  }
  return results;
}

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const config = {
  name: 'browser',
  description:
    'Search the web or read a web page. ' +
    "Pass a plain search query to search the web (e.g. 'latest AI news 2026'), " +
    "or pass a full URL to fetch and read that page's text " +
    "(e.g. 'https://example.com'). Returns search results with titles, " +
    'destination URLs and snippets, or the readable text of the page.',
  parameters: {
    type: 'object',
    properties: {
      input: {
        type: ['string', 'null'],
        description:
          "A search query (e.g. 'TypeScript best practices') or a full URL " +
          "(e.g. 'https://developer.mozilla.org/en-US/docs/Web/API').",
      },
    },
    required: ['input'],
  },
};

// ============================================================================
// FETCH HELPERS
// ============================================================================

async function fetchWithTimeout(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'user-agent': USER_AGENT,
      'accept-language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
    throw new Error(`Unsupported content type: ${contentType || 'unknown'}`);
  }
  return res.text();
}

async function searchWeb(query: string): Promise<string> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=us-en`;
  const html = await fetchWithTimeout(url);
  const results = extractDuckDuckGoResults(html);
  if (results.length === 0) {
    // Fallback: surface whatever readable text the page held (e.g. captcha/blocked)
    const fallback = extractPageText(html);
    return fallback === 'No readable text found on that page.'
      ? 'No results found.'
      : `No structured results found. Raw page text:\n${fallback}`;
  }
  return results
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`)
    .join('\n\n');
}

async function visitPage(url: string): Promise<string> {
  const html = await fetchWithTimeout(url);
  return extractPageText(html);
}

// ============================================================================
// TOOL RUN
// ============================================================================

export const run = async ({
  input,
}: {
  input?: unknown;
}): Promise<string> => {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw) {
    return 'Browser error: no input provided. Pass a search query or a full URL (starting with http:// or https://).';
  }

  const isUrl = /^https?:\/\//i.test(raw);
  if (isUrl) {
    try {
      return await visitPage(raw);
    } catch (err) {
      return `Browser error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  // A scheme-prefixed input that is NOT http(s) (file://, ftp://, ...) is
  // rejected outright — only web destinations are ever fetched.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    return 'Browser error: unsupported URL scheme. Only http:// and https:// URLs can be fetched.';
  }

  try {
    return await searchWeb(raw);
  } catch (err) {
    return `Browser error: ${err instanceof Error ? err.message : String(err)}`;
  }
};
