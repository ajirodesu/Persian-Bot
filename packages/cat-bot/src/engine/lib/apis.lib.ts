/**
 * Free APIs Registry — URL builder for third-party free API providers
 *
 * TypeScript port of the original CommonJS `APIs` / `createUrl` / `listUrl`
 * helper. Centralises the base URLs (and, where required, API keys) for a
 * set of free third-party API providers so command modules never hardcode
 * a provider's host or repeat query-string / API-key boilerplate.
 *
 * USAGE (inside any command module):
 *
 *   import { createUrl } from '@/engine/lib/apis.lib.js';
 *
 *   // Named provider — base URL is resolved from the registry below.
 *   // Replace '/api/whatever' with the actual path documented by that
 *   // provider — this module only owns the base URL / API-key wiring,
 *   // not any specific provider's endpoint paths.
 *   const url = createUrl('siputzx', '/api/whatever', { query: 'cats' }, 'apikey');
 *
 *   // Arbitrary absolute URL — falls back to using its own origin as the base.
 *   const url2 = createUrl('https://example.com', '/api/whatever', { q: '1' });
 *
 * WHY: A single, typed source of truth for provider base URLs means adding
 * a new free-API provider is a one-line registry edit rather than a
 * hardcoded string duplicated across every command that happens to use it.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/** A single registered API provider entry. */
export interface ApiDefinition {
  /** Root origin the provider serves requests from, e.g. "https://api.example.com" */
  baseURL: string;
  /** Optional API key, appended as a query param when `apiKeyParamName` is passed to createUrl(). */
  APIKey?: string;
}

/** Query parameter values accepted by URLSearchParams — kept permissive like the original. */
export type UrlParams = Record<string, string | number | boolean>;

// ── Registry ──────────────────────────────────────────────────────────────────

/**
 * Daftar API gratis — registry of free API providers.
 * Add new providers here; only `baseURL` is required, `APIKey` is optional.
 */
export const APIs = {
  alwayscodex: {
    baseURL: 'https://api.alwayscodex.my.id',
  },
  delirius: {
    baseURL: 'https://api.delirius.store',
  },
  kuroneko: {
    baseURL: 'https://api.danzy.web.id',
  },
  lexcode: {
    baseURL: 'https://api.lexcode.biz.id',
  },
  neo: {
    baseURL: 'https://www.neoapis.xyz',
  },
  neosoft: {
    baseURL: 'https://api.neosoft.best',
  },
  nexray: {
    baseURL: 'https://api.nexray.eu.cc',
  },
  sanka: {
    baseURL: 'https://www.sankavollerei.web.id',
    APIKey: 'planaai',
  },
  siputzx: {
    baseURL: 'https://api.siputzx.my.id',
  },
} as const satisfies Record<string, ApiDefinition>;

/** Union of every registered provider key, e.g. 'siputzx' | 'delirius' | ... */
export type ApiName = keyof typeof APIs;

// ── URL Builder ───────────────────────────────────────────────────────────────

/**
 * Builds a full request URL for a registered provider (by name) or an
 * arbitrary absolute URL string.
 *
 * @param apiNameOrURL   A key from the `APIs` registry (e.g. "siputzx"), or
 *                       any absolute URL string (its origin is used as the base).
 * @param endpoint       Path to resolve against the resolved base URL, e.g. "/api/anime".
 * @param params         Query parameters to attach to the request.
 * @param apiKeyParamName When provided AND the resolved provider has an `APIKey`,
 *                        the key is written into the query string under this param name.
 * @throws {TypeError} If `apiNameOrURL` is neither a registered provider name
 *                      nor a valid absolute URL.
 */
export function createUrl(
  apiNameOrURL: string,
  endpoint: string,
  params: UrlParams = {},
  apiKeyParamName?: string,
): string {
  const api: ApiDefinition | undefined = (APIs as Record<string, ApiDefinition>)[
    apiNameOrURL
  ];

  // Resolve base origin — either the registry entry or an arbitrary absolute URL.
  let baseURL: string;
  if (api) {
    baseURL = api.baseURL;
  } else {
    // Throws a native TypeError if apiNameOrURL isn't a valid absolute URL —
    // matches the behaviour of the original implementation.
    const url = new URL(apiNameOrURL);
    baseURL = url.origin;
  }

  const queryParams = new URLSearchParams(
    Object.fromEntries(
      Object.entries(params).map(([key, value]) => [key, String(value)]),
    ),
  );

  if (apiKeyParamName && api?.APIKey) {
    queryParams.set(apiKeyParamName, api.APIKey);
  }

  const apiUrl = new URL(endpoint, baseURL);
  apiUrl.search = queryParams.toString();

  return apiUrl.toString();
}

/**
 * Returns the full registry of configured free API providers.
 * Useful for building a "/apilist"-style command or for introspection/debugging.
 */
export function listUrl(): typeof APIs {
  return APIs;
}
