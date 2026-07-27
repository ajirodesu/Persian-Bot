/**
 * Aqua Canvas API — shared REST contract for rankup.ts, welcome.ts, and goodbye.ts
 *
 * Centralises everything that would otherwise be duplicated across those three
 * modules:
 *
 *   - the default background mode/theme sent to the Aqua API
 *   - the strict platform allowlist ("Telegram" | "Discord")
 *   - input validation / sanitisation (string-only, non-empty)
 *   - the `createUrl('aqua', ...)` request + binary-image download flow
 *
 * Both `/canvas/rankup` and `/canvas/greet` return the rendered image directly
 * (binary), matching every other `/canvas/*` provider already wired up in this
 * codebase (see gojo.ts, text2image.ts) — so the response is downloaded and
 * handed back as a Buffer, never parsed as JSON.
 *
 * WHY ONE MODULE: the task spec explicitly forbids duplicating background
 * selection logic "in multiple places" and asks for platform-specific code to
 * stay shared — a single fetch helper per endpoint, both built on one
 * `downloadCanvasImage` primitive, is what keeps rankup/welcome/goodbye from
 * re-implementing the same default + fetch + validate flow three times.
 */

import axios from 'axios';
import { createUrl } from '@/engine/lib/apis.lib.js';

// ─── Platform allowlist ─────────────────────────────────────────────────────

/** The only two platform values the Aqua canvas endpoints accept. */
export const CANVAS_PLATFORMS = ['Telegram', 'Discord'] as const;
export type CanvasPlatform = (typeof CANVAS_PLATFORMS)[number];

/**
 * Maps this codebase's internal lowercase platform identifiers
 * (`Platforms.Discord` / `Platforms.Telegram`, see platform.constants.ts) to
 * the exact capitalised strings the Aqua REST contract requires. Anything not
 * explicitly listed here (webchat, already-capitalised input, typos, etc.) is
 * rejected — this is a strict allowlist, not a case-insensitive guess.
 */
const PLATFORM_ALLOWLIST: Readonly<Record<string, CanvasPlatform>> = {
  discord: 'Discord',
  telegram: 'Telegram',
};

/** Normalises a raw platform string against the strict allowlist, or returns null. */
export function normalizeCanvasPlatform(
  platform: string | undefined | null,
): CanvasPlatform | null {
  if (typeof platform !== 'string') return null;
  return PLATFORM_ALLOWLIST[platform.trim().toLowerCase()] ?? null;
}

// ─── Background defaults ────────────────────────────────────────────────────

/**
 * Default background mode + theme sent on every canvas call that doesn't
 * explicitly override them.
 *
 * The Aqua canvas API now generates backgrounds itself: `background=Dynamic`
 * fetches a themed photo server-side (trying Pixabay → Unsplash → Picsum in
 * order, actually attempting to load each candidate before falling through),
 * so it never renders blank and never needs a client-supplied image URL.
 *
 * This replaces the old hardcoded `CANVAS_BACKGROUND_POOL` +
 * `pickRandomBackground()` workaround, which only existed because the API
 * previously required a raw image URL and some proxied sources (e.g. Brave's
 * image-resize proxy) silently failed the backend's own server-side fetch.
 * That workaround is now obsolete and has been removed — one less thing to
 * keep in sync with the Aqua API's own image sourcing.
 */
export const DEFAULT_CANVAS_BACKGROUND = 'Dynamic' as const;
export const DEFAULT_CANVAS_BACKGROUND_THEME = 'Futuristic' as const;

// ─── Rankup accent color ────────────────────────────────────────────────────

/**
 * The full accent-color palette `/canvas/rankup` accepts (see NAMED_COLORS in
 * the Aqua API's rankup.ts) — used to pick a random accent color for every
 * rank-up card that doesn't explicitly request one.
 */
export const RANKUP_COLOR_POOL: readonly string[] = [
  'Cyan',
  'Blue',
  'Purple',
  'Pink',
  'Red',
  'Orange',
  'Yellow',
  'Green',
] as const;

/** Picks a random accent color from the full rankup palette. */
export function pickRandomRankupColor(): string {
  const index = Math.floor(Math.random() * RANKUP_COLOR_POOL.length);
  // Non-null assertion is safe: index is always within [0, length).
  return RANKUP_COLOR_POOL[index]!;
}

// ─── Validation ─────────────────────────────────────────────────────────────

/** Thrown when a canvas request is missing a required param or fails the platform allowlist. */
export class CanvasValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanvasValidationError';
  }
}

/**
 * Coerces a required field to a non-empty string. Numbers are stringified
 * (the Aqua API is a query-string contract, so `level: 24` and
 * `level: "24"` are equivalent on the wire); anything else — undefined,
 * null, empty string, whitespace-only string, non-finite number — is
 * rejected. This is the single sanitisation choke point every param passes
 * through before it reaches `createUrl`.
 */
function requireParamString(value: unknown, field: string): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new CanvasValidationError(`Invalid value for required param "${field}".`);
    }
    return String(value);
  }

  if (typeof value !== 'string' || !value.trim()) {
    throw new CanvasValidationError(`Missing or invalid required param "${field}".`);
  }

  return value.trim();
}

// ─── Binary image download (shared by both endpoints) ──────────────────────

/** Best-effort decode of a non-2xx response body for diagnostics. */
function describeErrorBody(data: ArrayBuffer): string {
  try {
    const text = Buffer.from(data).toString('utf8').trim().slice(0, 300);
    if (!text) return '(empty body)';

    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const reason = parsed['message'] ?? parsed['error'] ?? parsed['msg'];
      if (typeof reason === 'string') return reason;
    } catch {
      // not JSON — fall through to raw text
    }

    return text;
  } catch {
    return '(unreadable body)';
  }
}

/** Picks a sensible file extension from the response Content-Type header. */
function extFromContentType(contentType: unknown): string {
  const type = String(contentType ?? '').toLowerCase();
  if (type.includes('gif')) return 'gif';
  if (type.includes('webp')) return 'webp';
  if (type.includes('jpeg') || type.includes('jpg')) return 'jpg';
  return 'png';
}

export interface CanvasImage {
  buffer: Buffer;
  ext: string;
}

/**
 * Downloads a rendered canvas image (the Aqua endpoints respond with raw
 * image bytes, not JSON) and validates the response ourselves rather than
 * handing a bare URL to the platform attachment layer — mirrors the
 * `fetchEffectImage` pattern already used by popcat-avatar.ts.
 */
async function downloadCanvasImage(requestUrl: string, label: string): Promise<CanvasImage> {
  const response = await axios.get<ArrayBuffer>(requestUrl, {
    responseType: 'arraybuffer',
    timeout: 30_000,
    validateStatus: () => true,
  });

  if (response.status < 200 || response.status >= 300) {
    const reason = describeErrorBody(response.data);
    throw new Error(`${label} canvas API responded with status ${response.status}: ${reason}`);
  }

  const buffer = Buffer.from(response.data);
  if (!buffer.length) throw new Error(`${label} canvas API returned an empty image`);

  return { buffer, ext: extFromContentType(response.headers['content-type']) };
}

// ─── /canvas/rankup ─────────────────────────────────────────────────────────

export interface RankupCanvasParams {
  /** Raw platform identifier — either this codebase's internal lowercase form or already-capitalised. */
  platform: string;
  avatar: string;
  username: string;
  level: number | string;
  previousLevel: number | string;
  xpText: string;
  rank: number | string;
  /** Explicit background mode/URL override. Omit to use the default: "Dynamic" (see DEFAULT_CANVAS_BACKGROUND). */
  background?: string;
  /** Explicit background theme override — only relevant when background="Dynamic". Omit to use the default: "Futuristic". */
  backgroundTheme?: string;
  /** Explicit accent color override. Omit to get a random pick from RANKUP_COLOR_POOL. */
  color?: string;
}

/**
 * Builds and fetches a `/canvas/rankup` card via the Aqua REST API.
 * `createUrl('aqua', ...)` is the sole way the endpoint URL is constructed —
 * no direct image-loading logic exists outside this flow.
 */
export async function fetchRankupCanvas(params: RankupCanvasParams): Promise<CanvasImage> {
  const platform = normalizeCanvasPlatform(params.platform);
  if (!platform) {
    throw new CanvasValidationError(
      `Unsupported platform "${params.platform}" — must be one of: ${CANVAS_PLATFORMS.join(', ')}.`,
    );
  }

  const query = {
    platform,
    avatar: requireParamString(params.avatar, 'avatar'),
    username: requireParamString(params.username, 'username'),
    level: requireParamString(params.level, 'level'),
    previousLevel: requireParamString(params.previousLevel, 'previousLevel'),
    xpText: requireParamString(params.xpText, 'xpText'),
    rank: requireParamString(params.rank, 'rank'),
    background: params.background
      ? requireParamString(params.background, 'background')
      : DEFAULT_CANVAS_BACKGROUND,
    backgroundTheme: params.backgroundTheme
      ? requireParamString(params.backgroundTheme, 'backgroundTheme')
      : DEFAULT_CANVAS_BACKGROUND_THEME,
    color: params.color ? requireParamString(params.color, 'color') : pickRandomRankupColor(),
  };

  const url = createUrl('aqua', '/canvas/rankup', query);
  return downloadCanvasImage(url, 'Rankup');
}

// ─── /canvas/greet (welcome + goodbye) ──────────────────────────────────────

export type GreetType = 'Welcome' | 'Goodbye';

export interface GreetCanvasParams {
  type: GreetType;
  /** Raw platform identifier — either this codebase's internal lowercase form or already-capitalised. */
  platform: string;
  avatar: string;
  username: string;
  serverName: string;
  message: string;
  memberCount: number | string;
  /** Explicit background mode/URL override. Omit to use the default: "Dynamic" (see DEFAULT_CANVAS_BACKGROUND). */
  background?: string;
  /** Explicit background theme override — only relevant when background="Dynamic". Omit to use the default: "Futuristic". */
  backgroundTheme?: string;
}

/**
 * Builds and fetches a `/canvas/greet` card via the Aqua REST API — the same
 * endpoint backs both welcome.ts and goodbye.ts; only `type` differs.
 */
export async function fetchGreetCanvas(params: GreetCanvasParams): Promise<CanvasImage> {
  const platform = normalizeCanvasPlatform(params.platform);
  if (!platform) {
    throw new CanvasValidationError(
      `Unsupported platform "${params.platform}" — must be one of: ${CANVAS_PLATFORMS.join(', ')}.`,
    );
  }

  if (params.type !== 'Welcome' && params.type !== 'Goodbye') {
    throw new CanvasValidationError(
      `Unsupported greet type "${String(params.type)}" — must be "Welcome" or "Goodbye".`,
    );
  }

  const query = {
    type: params.type,
    platform,
    avatar: requireParamString(params.avatar, 'avatar'),
    username: requireParamString(params.username, 'username'),
    serverName: requireParamString(params.serverName, 'serverName'),
    message: requireParamString(params.message, 'message'),
    memberCount: requireParamString(params.memberCount, 'memberCount'),
    background: params.background
      ? requireParamString(params.background, 'background')
      : DEFAULT_CANVAS_BACKGROUND,
    backgroundTheme: params.backgroundTheme
      ? requireParamString(params.backgroundTheme, 'backgroundTheme')
      : DEFAULT_CANVAS_BACKGROUND_THEME,
  };

  const url = createUrl('aqua', '/canvas/greet', query);
  return downloadCanvasImage(url, 'Greet');
}
