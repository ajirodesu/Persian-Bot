/**
 * /shotiv3 — Random TikTok Video + Pool Management (Aqua API)
 *
 * Third-generation "shoti" command, sourced from the Aqua API's
 * `/random/shoti2` endpoint — a distinct provider from the one /shotiv2
 * (shoti2.ts) uses (`/random/shoti`), despite the similar naming. Kept as
 * a separate command rather than replacing /shotiv2 so both endpoints stay
 * available as independent fallbacks for each other.
 *
 * Mixed access: the plain random-fetch path is open to everyone, same as
 * /shoti and /shotiv2. Only the `add` subcommand — which mutates the shared
 * video pool (password-gated on the API side too) — is restricted to system
 * admins. Because meta.role gates the whole command, meta.role is left at
 * ANYONE and the `add` path checks `isSystemAdmin()` itself before calling
 * the API.
 *
 * API: registered as 'aqua' in @/engine/lib/apis.lib.js
 *       (base https://aqua-api-w6dy.onrender.com)
 *   GET /random/shoti2?option=get
 *   GET /random/shoti2?option=add&url=<TikTok URL>&password=<...>
 *
 * GET (option=get) response shape:
 *   {
 *     operator:     string
 *     timestamp:    string  (ISO date)
 *     responseTime: string  ("1654ms")
 *     code:         number  (200 on success)
 *     message:      string
 *     data: {
 *       region:      string
 *       url:         string  (direct playable video URL)
 *       thumbnail:   string
 *       userInfo:    { userID: string; username: string; nickname: string }
 *       musicInfo:   { musicId: string; musicTitle: string; musicUrl: string }
 *     }
 *   }
 *
 * ADD (option=add) response shape:
 *   {
 *     operator:     string
 *     timestamp:    string
 *     responseTime: string
 *     code:         number  (200 on success)
 *     message:      string  ("Video added successfully")
 *   }
 *
 * ── Usage ─────────────────────────────────────────────────────────────────
 *   shotiv3              — Fetch and send a random TikTok video from the pool (anyone)
 *   shotiv3 add <url>    — Add a new TikTok video URL to the pool (system admin only)
 *
 * Delivers the random-fetch result inline: a plain reply on the initial
 * command, or an in-place edit of the existing message on a button
 * refresh. No loading placeholder is sent — the typing indicator covers
 * processing feedback. Attaches a persistent "🔁 More Shoti" button on
 * platforms with native button support so the user can fetch another
 * random video in-place without re-issuing the command. The `add`
 * subcommand has no button — it's a one-shot mutation.
 *
 * Aliases: /shotiv3
 * Access:  ANYONE (random fetch) / SYSTEM_ADMIN (add subcommand)
 * Cooldown: 10s
 */

import type { ReplyOptions } from '@/engine/adapters/models/interfaces/index.js';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import { createUrl } from '@/engine/lib/apis.lib.js';
import { isSystemAdmin } from '@/engine/repos/system-admin.repo.js';

// ── API constants ──────────────────────────────────────────────────────────────

/** Password required by the Aqua API to mutate the shoti2 video pool. */
const ADD_PASSWORD = 'ajiro2005';

/** Maximum wait for either API step (ms). */
const FETCH_TIMEOUT_MS = 20_000;

const SUBCOMMAND_ADD = 'add';

// ── API response types ───────────────────────────────────────────────────────

interface ShotiV3UserInfo {
  userID: string;
  username: string;
  nickname: string;
}

interface ShotiV3MusicInfo {
  musicId: string;
  musicTitle: string;
  musicUrl: string;
}

interface ShotiV3Data {
  region: string;
  url: string;
  thumbnail: string;
  userInfo: ShotiV3UserInfo;
  musicInfo: ShotiV3MusicInfo;
}

interface ShotiV3GetResponse {
  operator: string;
  timestamp: string;
  responseTime: string;
  code: number;
  message: string;
  data?: ShotiV3Data;
}

interface ShotiV3AddResponse {
  operator: string;
  timestamp: string;
  responseTime: string;
  code: number;
  message: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Fetches a random shoti video's metadata from the Aqua API. */
async function fetchRandomShotiV3(): Promise<ShotiV3Data> {
  const url = createUrl('aqua', '/random/shoti2', { option: 'get' });
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(
      `Shoti API returned HTTP ${res.status} — the service may be temporarily unavailable.`,
    );
  }
  const data = (await res.json()) as ShotiV3GetResponse;
  if (data.code !== 200 || !data.data?.url) {
    throw new Error(data.message || 'No video was returned. Try again in a moment.');
  }
  return data.data;
}

/** Adds a new TikTok video URL to the Aqua API's shoti2 pool. */
async function addShotiV3(tiktokUrl: string): Promise<string> {
  const url = createUrl('aqua', '/random/shoti2', {
    option: 'add',
    url: tiktokUrl,
    password: ADD_PASSWORD,
  });
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(
      `Shoti API returned HTTP ${res.status} — the service may be temporarily unavailable.`,
    );
  }
  const data = (await res.json()) as ShotiV3AddResponse;
  if (data.code !== 200) {
    throw new Error(data.message || 'The video could not be added.');
  }
  return data.message;
}

/** Loosely validates a string is an http(s) URL before hitting the API. */
function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

// ── Command configuration ────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'shotiv3',
  aliases: [] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Sends a random TikTok video (Aqua API). `add <url>` (system admin only) adds one to the pool.',
  category: 'Media',
  usage: ['', '[add <tiktok url>]'],
  cooldown: 10,
  hasPrefix: true,
};

// ── Button definition ─────────────────────────────────────────────────────────

const BUTTON_ID = { refresh: 'refresh' } as const;

export const button = {
  [BUTTON_ID.refresh]: {
    label: '🔁 More Shoti',
    style: ButtonStyle.PRIMARY,
    onClick: async (ctx: AppCtx) => runShotiV3Get(ctx),
  },
};

// ── Random-fetch handler ─────────────────────────────────────────────────────

/**
 * Shared send/edit logic used by both the default (no-subcommand) path and
 * the button onClick (in-place refresh) — mirrors the /shotiv2 pattern.
 */
async function runShotiV3Get(ctx: AppCtx): Promise<void> {
  const { native, button, session } = ctx;

  const isButtonAction = ctx.event['type'] === 'button_action';
  const loadingId = isButtonAction
    ? (ctx.event['messageID'] as string | undefined)
    : undefined;
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
    const shoti = await fetchRandomShotiV3();
    const { region, url, userInfo, musicInfo } = shoti;

    // Reuse the active button instance ID on refresh so the button stays live;
    // otherwise mint a fresh one for the initial send.
    const buttonId = isButtonAction
      ? session.id
      : button.generateID({ id: BUTTON_ID.refresh, public: true });

    const caption = [
      `🎥 **Shoti**`,
      '',
      `👤 **Creator**: ${userInfo.nickname} (@${userInfo.username})`,
      `🌍 **Region**: ${region}`,
      `🎵 **Music**: ${musicInfo.musicTitle}`,
    ].join('\n');

    await finish({
      style: MessageStyle.MARKDOWN,
      message: caption,
      attachment_url: [{ name: 'shoti.mp4', url }],
      ...(hasNativeButtons(native.platform) ? { button: [buttonId] } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    await fail(`⚠️ Failed to fetch a Shoti video: ${message}`);
  }
}

// ── Add-subcommand handler ───────────────────────────────────────────────────

async function runShotiV3Add(ctx: AppCtx, tiktokUrl: string): Promise<void> {
  const { chat, event } = ctx;

  const senderID = event['senderID'] as string | undefined;
  if (!senderID || !(await isSystemAdmin(senderID))) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '⛔ Only system admins can add videos to the Shoti pool.',
    });
    return;
  }

  if (!isValidHttpUrl(tiktokUrl)) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '⚠️ That doesn\'t look like a valid URL.',
    });
    return;
  }

  try {
    const message = await addShotiV3(tiktokUrl);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `✅ ${message}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ Failed to add video: ${message}`,
    });
  }
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { args, usage } = ctx;
  const firstArg = (args[0] ?? '').toLowerCase();

  if (firstArg === SUBCOMMAND_ADD) {
    const tiktokUrl = args[1];
    if (!tiktokUrl) {
      await usage();
      return;
    }
    await runShotiV3Add(ctx, tiktokUrl);
    return;
  }

  await runShotiV3Get(ctx);
};
