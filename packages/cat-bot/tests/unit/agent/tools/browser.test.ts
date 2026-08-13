import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  run,
  extractDuckDuckGoResults,
  extractPageText,
  decodeEntities,
} from '@/engine/agent/tools/browser.js';

function makeFakeResponse(
  html: string,
  contentType = 'text/html; charset=utf-8',
) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => contentType },
    text: async () => html,
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('browser tool: HTML parsing helpers', () => {
  it('extracts titled results and unwraps the DDG uddg redirect', () => {
    const html = [
      '<div class="results">',
      '<div class="result"><h2 class="result__title">' +
        '<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=' +
        encodeURIComponent('https://example.com/article') +
        '&amp;rut=abc">Example &amp; Article</a></h2>',
      '<a class="result__snippet" href="//duckduckgo.com/l/?uddg=' +
        encodeURIComponent('https://example.com/article') +
        '">A snippet about it</a>',
      '</div>',
      '<div class="result"><h2 class="result__title">' +
        '<a rel="nofollow" class="result__a" href="https://other.dev/page">Second</a></h2>',
      '<a class="result__snippet" href="https://other.dev/page">Snippet two</a>',
      '</div>',
      '</div>',
    ].join('');

    const results = extractDuckDuckGoResults(html);
    expect(results).toHaveLength(2);
    expect(results[0]?.title).toBe('Example & Article');
    expect(results[0]?.url).toBe('https://example.com/article');
    expect(results[0]?.snippet).toBe('A snippet about it');
    expect(results[1]?.url).toBe('https://other.dev/page');
  });

  it('caps the number of parsed results', () => {
    let html = '';
    for (let i = 0; i < 10; i++) {
      html +=
        '<div><a class="result__a" href="https://x.dev/' +
        i +
        '">Result ' +
        i +
        '</a></div>';
    }
    expect(extractDuckDuckGoResults(html)).toHaveLength(6);
  });

  it('extracts readable text: strips scripts/nav, keeps block newlines, decodes entities', () => {
    const html = [
      '<html><head><title>ignored</title></head><body>',
      '<nav>Nav links</nav>',
      '<script>var x = 1;</script>',
      '<h1>Hello &amp; Welcome</h1>',
      '<p>First paragraph.</p>',
      '<p>Second paragraph with <b>bold</b> text.</p>',
      '<footer>Footer junk</footer>',
      '</body></html>',
    ].join('');

    const text = extractPageText(html);
    expect(text).toContain('Hello & Welcome');
    expect(text).toContain('First paragraph.');
    expect(text).toContain('Second paragraph with bold text.');
    expect(text).not.toContain('Nav links');
    expect(text).not.toContain('var x');
    expect(text).not.toContain('Footer junk');
  });

  it('decodes numeric and named entities', () => {
    expect(decodeEntities('a&#39;b &quot;c&quot; &#x1F600; &amp; more')).toBe(
      "a'b \"c\" 😀 & more",
    );
  });

  it('reports no readable text for an empty page', () => {
    expect(extractPageText('<html><body></body></html>')).toBe(
      'No readable text found on that page.',
    );
  });
});

describe('browser tool: run()', () => {
  it('errors without input', async () => {
    const out = await run({});
    expect(out).toContain('no input provided');
  });

  it('searches the web for a plain query', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeFakeResponse(
        '<div><a class="result__a" href="https://example.com/a">Title A</a>' +
          '<a class="result__snippet" href="https://example.com/a">Snippet A</a></div>',
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const out = await run({ input: 'latest ai news' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0]?.[0] ?? '');
    expect(url).toContain('html.duckduckgo.com/html/');
    expect(url).toContain(encodeURIComponent('latest ai news'));
    expect(out).toContain('[1] Title A');
    expect(out).toContain('https://example.com/a');
  });

  it('fetches and reads a full URL directly', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        makeFakeResponse('<html><body><p>Page content here.</p></body></html>'),
      );
    vi.stubGlobal('fetch', fetchMock);

    const out = await run({ input: 'https://example.com/docs' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/docs',
      expect.anything(),
    );
    expect(out).toContain('Page content here.');
  });

  it('returns a descriptive error on network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('fetch failed')),
    );
    const out = await run({ input: 'https://example.com' });
    expect(out).toContain('Browser error: fetch failed');
  });

  it('rejects non-http(s) URL schemes instead of fetching them', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const out = await run({ input: 'file:///etc/passwd' });
    expect(out).toContain('unsupported URL scheme');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
