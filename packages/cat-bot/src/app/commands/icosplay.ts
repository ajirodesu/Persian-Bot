/**
 * /icosplay — Random Cosplay Photo (Pinterest)
 *
 * Fetches a random cosplay photo from Pinterest (Asian woman anime cosplay
 * by default) and sends it as an image with a persistent "🔁 Next Photo"
 * button.
 *
 * Pinterest has no free public API, so the command scrapes the server-
 * rendered HTML of the search page for `i.pinimg.com` image URLs, upgrades
 * the low-res `/236x/` thumbnails to full-resolution `/originals/` paths and
 * sends a randomly selected one.
 *
 * Usage:
 *   /icosplay                  — random Asian-woman anime cosplay photo
 *   /icosplay <search terms>   — random cosplay photo matching the query
 */

import type { ReplyOptions } from '@/engine/adapters/models/interfaces/index.js';
import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const SEARCH_PATH = '/search/pins/';
const RESOURCE_PATH = '/resource/BaseSearchResource/get/';
const REQUEST_TIMEOUT = 15000;
const MAX_ATTEMPTS = 3; // retries across regional mirrors before giving up

/** Default search query when the user runs /icosplay without arguments. */
const DEFAULT_QUERY = 'asian woman anime cosplay';

/**
 * Browser-like headers — Pinterest returns a login wall (or an empty shell)
 * to generic bot user-agents, so we present ourselves as a normal browser.
 */
const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

// ── Pinterest scraper ─────────────────────────────────────────────────────────

/** A single Pinterest pin's image URLs. */
interface PinImages {
  originals?: { url?: string };
  '736x'?: { url?: string };
  '564x'?: { url?: string };
  '500x'?: { url?: string };
  '236x'?: { url?: string };
}

/**
 * Runs an authenticated Pinterest search through the private BaseSearch
 * resource endpoint. The endpoint is gated behind a session cookie + CSRF
 * token, so a warm-up request first visits the home page to collect them.
 *
 * @param host - Regional Pinterest host (e.g. `www.pinterest.com`).
 * @param query - Search query.
 * @returns Full-size image URLs from the first page of results.
 */
async function fetchPinUrls(host: string, query: string): Promise<string[]> {
  const origin = `https://${host}`;

  // Warm up the session — Pinterest issues the session cookie + CSRF token
  // on any page load, which the resource endpoint then requires.
  const warmUp = await axios.get<string>(origin + '/', {
    timeout: REQUEST_TIMEOUT,
    headers: { ...BROWSER_HEADERS, Accept: 'text/html' },
    maxRedirects: 5,
  });
  const setCookies: string[] = Array.isArray(warmUp.headers['set-cookie'])
    ? (warmUp.headers['set-cookie'] as string[])
    : typeof warmUp.headers['set-cookie'] === 'string'
      ? [(warmUp.headers['set-cookie'] as string)]
      : [];
  const cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
  const csrfMatch = cookie.match(/csrftoken=([^;]+)/);
  const csrf = csrfMatch?.[1] ?? '';

  // The resource endpoint expects an `options` payload describing the search,
  // URL-encoded twice inside `data` (matching Pinterest's own request shape).
  const payload = JSON.stringify({
    options: { query, scope: 'pins', rs: 'typed', page_type: 'search' },
    context: {},
    _client_context: {},
  });
  const sourceUrl = `%2Fsearch%2Fpins%2F%3Fq%3D${encodeURIComponent(query)}%26rs%3Dtyped`;
  const body = `source_url=${sourceUrl}&data=${encodeURIComponent(payload)}`;

  const { data } = await axios.post<unknown>(origin + RESOURCE_PATH, body, {
    timeout: REQUEST_TIMEOUT,
    headers: {
      ...BROWSER_HEADERS,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: `${origin}${SEARCH_PATH}?q=${encodeURIComponent(query)}&rs=typed`,
      Cookie: cookie,
      'X-CSRFToken': csrf,
    },
  });

  const results = ((data as Record<string, unknown>)?.['resource_response'] as
    | { data?: { results?: unknown[] } }
    | undefined)?.['data']?.['results'];
  if (!Array.isArray(results)) return [];

  return results
    .map((pin) => {
      const images = (pin as { images?: PinImages } | null)?.images;
      if (!images) return '';
      return (
        images.originals?.url ||
        images['736x']?.url ||
        images['564x']?.url ||
        images['500x']?.url ||
        images['236x']?.url ||
        ''
      );
    })
    .filter((url): url is string => typeof url === 'string' && url.length > 0);
}

/**
 * Fetches one random Pinterest image URL for the given query.
 *
 * Tries `www.pinterest.com` first, then falls back to regional mirrors
 * (`id`, `ru`, `br`) which often still accept the resource call when the
 * main domain throttles.
 *
 * @param query - Pinterest search query.
 * @returns A random full-size image URL, or null when nothing could be scraped.
 */
async function fetchRandomCosplayImage(query: string): Promise<string | null> {
  const hosts = ['www.pinterest.com', 'id.pinterest.com', 'ru.pinterest.com', 'br.pinterest.com'];

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const index = attempt % hosts.length;
    const host = hosts[index]!;
    try {
      const urls = await fetchPinUrls(host, query);
      if (!urls.length) continue;

      // Shuffle once so two rapid invocations rarely collide on the same pin.
      for (let i = urls.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [urls[i], urls[j]] = [urls[j]!, urls[i]!];
      }
      return urls[0] ?? null;
    } catch {
      // Network/parse error — try the next host on the next attempt.
    }
  }

  return null;
}

function extFromUrl(url: string): string {
  const extMatch = url.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i);
  return extMatch ? extMatch[1]! : 'jpg';
}

// ── Config ────────────────────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'icosplay',
  aliases: ['icoplay', 'acpl', 'acosplay'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Get a random Asian woman anime cosplay photo from Pinterest.',
  category: 'Anime',
  usage: '[search terms]',
  cooldown: 5,
  hasPrefix: true,
};

// ── Button Definition ─────────────────────────────────────────────────────────

const BUTTON_ID = { next: 'next' } as const;

/**
 * Button definitions exported as `button`.
 * onClick re-invokes onCommand so the existing message is replaced in-place.
 */
export const button = {
  [BUTTON_ID.next]: {
    label: '🔁 Next Photo',
    style: ButtonStyle.PRIMARY,
    onClick: async (ctx: AppCtx) => onCommand(ctx),
  },
};

// ── Command Entry Point ───────────────────────────────────────────────────────

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { native, button, session, args } = ctx;

  const isButtonAction = ctx.event['type'] === 'button_action';
  const loadingId = isButtonAction
    ? (ctx.event['messageID'] as string | undefined)
    : undefined;

  // Re-use the original query on a button refresh (stashed in the button's
  // persisted context when the message was first sent) so "🔁 Next Photo"
  // keeps searching for the same cosplay style the user originally asked for.
  const query = isButtonAction
    ? ((session.context as { query?: string }).query ?? DEFAULT_QUERY)
    : args.join(' ').trim() || DEFAULT_QUERY;

  // Delivers the final result: edits the existing (button-bearing) message
  // in place on a button refresh, or sends a plain reply otherwise. No
  // loading placeholder is sent — the typing indicator covers processing
  // feedback for the whole command duration.
  const deliver = async (payload: ReplyOptions): Promise<void> => {
    if (!loadingId) {
      await ctx.chat.replyMessage(payload);
      return;
    }
    // Always edit the original message in place — never delete it and send a
    // new one. A delete+resend fallback here would mean a failed refresh
    // silently replaces the message the user was looking at with a brand-new
    // one (breaks reply threads, moves it to the bottom of the chat, etc.).
    // If the edit itself fails, let the error propagate to the caller.
    await ctx.chat.editMessage({ ...payload, message_id_to_edit: loadingId });
  };
  const finish = deliver;
  const fail = (errorMessage: string): Promise<void> =>
    deliver({ style: MessageStyle.MARKDOWN, message: errorMessage });

  try {
    const imageUrl = await fetchRandomCosplayImage(query);

    if (!imageUrl) {
      await fail(
        [
          '⚠️ **No photos found.**',
          `Could not find any Pinterest results for \`${query}\`. Try different search terms or use the default (\`/icosplay\`).`,
        ].join('\n'),
      );
      return;
    }

    const caption = '👘 **Random Cosplay Photo**';

    // Reuse the active instance ID when refreshing via button so the button
    // slot is updated in-place and never disappears between clicks.
    const resolvedButtonId = isButtonAction
      ? session.id
      : button.generateID({ id: BUTTON_ID.next, public: true });

    // Persist (or refresh the TTL on) the resolved query so the next
    // "🔁 Next Photo" click can re-derive it from session.context.
    button.createContext({ id: resolvedButtonId, context: { query } });

    await finish({
      style: MessageStyle.MARKDOWN,
      message: caption,
      attachment_url: [
        { name: `icosplay.${extFromUrl(imageUrl)}`, url: imageUrl },
      ],
      ...(hasNativeButtons(native.platform) ? { button: [resolvedButtonId] } : {}),
    });
  } catch (err) {
    const error = err as { message?: string };
    await fail(
      `⚠️ **Error:** Something went wrong while fetching a cosplay photo: \`${error.message ?? 'Unknown error'}\``,
    );
  }
};
