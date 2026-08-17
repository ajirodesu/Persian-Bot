/**
 * /connect — Create or connect a new bot on the current platform (PM/DM only)
 *
 * Port of project-canis's `connect` command (mrepol742/project-canis). In
 * canis, `/connect` spawned a new WhatsApp client for the caller; here it
 * creates a NEW bot session on the platform the user is currently chatting
 * from (Telegram / Discord / Fluxer) — the same path the Admin Dashboard's
 * "create bot" wizard uses (botService.createBot).
 *
 * The command refuses to run in groups/channels — it is ONLY available in
 * private chats (PM/DM) — and requires a bot admin role, since connecting a
 * new bot grants it credentials and spawns a live transport.
 *
 * The platform name shown to the user is derived dynamically from the
 * platform identifier itself (title-cased), never from a hardcoded label
 * table — new platforms need no edits here beyond the create-capable set.
 *
 * Flow (onReply, three collected fields — see examples/commands/example_reply.ts):
 *   User: /connect                                  (private chat only)
 *   Bot:  🤖 Create a new <Platform> bot
 *         Reply with a nickname for your new bot.
 *   User: [quotes the bot's message] My Bot
 *   Bot:  ✏️ Now reply with the command prefix for <My Bot> (default: /).
 *   User: [quotes the bot's message] !
 *   Bot:  🔑 Last step — reply with the bot token.
 *   User: [quotes the bot's message] 123456789:AA...
 *   Bot:  ✅ New bot connected!
 *         🤖 Name: My Bot · Platform: <Platform> · Prefix: !
 *         🆔 Session: <sessionId>
 *         The bot is starting now — manage it from the Admin Dashboard.
 *
 * Key mechanics:
 *   1. Each chat.replyMessage() returns the bot's message ID, and
 *      state.create() registers the next step keyed to the sender (private
 *      scope), so only they can advance the flow.
 *   2. Collected values (nickname → prefix → token) are carried forward via
 *      the state context between steps.
 *   3. dispatchOnReply matches each quote-reply and calls the matching
 *      onReply[step] handler, which finally creates the bot session under the
 *      caller's account namespace (native.userId) with the connecting user as
 *      its first admin.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import { botService } from '@/server/services/bot.service.js';
import type {
  CreateBotRequestDto,
  PlatformCredentials,
} from '@/server/dtos/bot.dto.js';

const STATE = {
  awaiting_nickname: 'awaiting_nickname',
  awaiting_prefix: 'awaiting_prefix',
  awaiting_token: 'awaiting_token',
} as const;

// ── Platform helpers (dynamic, no hardcoded labels) ───────────────────────────

/**
 * Platforms that can host a new bot session via botService.createBot.
 * Expressed in the canonical platform identifiers — the DISPLAY NAME is
 * derived dynamically (see platformDisplayName), never hardcoded here.
 */
const CONNECTABLE_PLATFORMS = new Set<string>([
  Platforms.Discord,
  Platforms.Telegram,
  Platforms.Fluxer,
]);

/** True when a new bot can be created on this platform. */
export function isConnectablePlatform(platform: string): boolean {
  return CONNECTABLE_PLATFORMS.has(platform);
}

/**
 * Human display name derived from the platform identifier itself
 * ('discord' → 'Discord', 'fluxer' → 'Fluxer', ...). No label table to keep
 * in sync — any future platform renders automatically.
 */
export function platformDisplayName(platform: string): string {
  if (!platform) return 'unknown platform';
  return platform.charAt(0).toUpperCase() + platform.slice(1);
}

// ── Field validation / normalisation ──────────────────────────────────────────

const MAX_NICKNAME_LENGTH = 32;

/**
 * Validates a bot nickname. Returns null when valid, or a reason key:
 * 'empty' when nothing was provided, 'too_long' when it exceeds the limit.
 */
export function validateNickname(
  nickname: string,
): null | 'empty' | 'too_long' {
  const n = String(nickname ?? '').trim();
  if (!n) return 'empty';
  if (n.length > MAX_NICKNAME_LENGTH) return 'too_long';
  return null;
}

/** Normalises a replied prefix: whitespace-stripped first token, '/' default. */
export function normalizePrefix(reply: string): string {
  const first = String(reply ?? '').trim().split(/\s+/)[0] ?? '';
  return first || '/';
}

/** Loose shape checks so a typo'd token is rejected before any API call. */
const TELEGRAM_TOKEN_RE = /^\d{6,12}:[A-Za-z0-9_-]{30,40}$/;
const DISCORD_TOKEN_RE =
  /^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{27,}$/;

/**
 * Validates a bot token for the given platform. Returns null when valid, or a
 * reason key describing the problem: 'empty' when nothing was provided,
 * 'telegram' / 'discord' when the format does not match that platform.
 */
export function validateBotToken(
  platform: string,
  token: string,
): null | 'empty' | 'telegram' | 'discord' {
  const t = String(token ?? '').trim();
  if (!t) return 'empty';
  if (platform === Platforms.Telegram && !TELEGRAM_TOKEN_RE.test(t)) {
    return 'telegram';
  }
  if (platform === Platforms.Discord && !DISCORD_TOKEN_RE.test(t)) {
    return 'discord';
  }
  return null;
}

/**
 * Builds the platform-typed credentials for a new bot. Discord's client ID is
 * resolved from the token by botService.createBot, so it starts empty.
 */
export function buildConnectCredentials(
  platform: string,
  token: string,
): PlatformCredentials | null {
  switch (platform) {
    case Platforms.Telegram:
      return { platform: 'telegram', telegramToken: token };
    case Platforms.Discord:
      return { platform: 'discord', discordToken: token, discordClientId: '' };
    case Platforms.Fluxer:
      return { platform: 'fluxer', fluxerToken: token };
    default:
      return null;
  }
}

/**
 * Builds the create-bot request from the collected nickname + prefix + token,
 * with the connecting user as the new bot's first admin.
 */
export function buildConnectDto(
  platform: string,
  nickname: string,
  token: string,
  prefix: string,
  adminId: string,
): CreateBotRequestDto | null {
  const credentials = buildConnectCredentials(platform, token);
  if (!credentials) return null;
  return {
    botNickname: nickname,
    botPrefix: prefix,
    botAdmins: [adminId],
    botPremiums: [],
    credentials,
  };
}

// ── Token acquisition guidance (dynamic per platform, no hardcoded branches) ──

interface BotTokenGuide {
  /** Where the user obtains a bot token for this platform. */
  source: string;
  /** Short description/example of the token's shape. */
  example: string;
}

/**
 * Where a bot token comes from and what it looks like, keyed by platform id.
 * The chat replies look this up at runtime — the reply text never embeds a
 * platform branch, so a new platform needs no edits beyond its guide entry
 * here (and falls back to a generic hint when absent).
 */
const BOT_TOKEN_GUIDES: Record<string, BotTokenGuide> = {
  [Platforms.Telegram]: {
    source: 'BotFather (@BotFather)',
    example: '`123456789:AA...`',
  },
  [Platforms.Discord]: {
    source: 'the Discord Developer Portal',
    example: 'three dot-separated parts (e.g. `ABC... .DEF... .GHI...`)',
  },
  [Platforms.Fluxer]: {
    source: 'your Fluxer provider',
    example: 'any non-empty token string',
  },
};

/** Token guidance for a platform, or null when none is known. */
export function botTokenGuide(platform: string): BotTokenGuide | null {
  return BOT_TOKEN_GUIDES[platform] ?? null;
}

// ── Config ────────────────────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'connect',
  aliases: [] as string[],
  version: '1.0.0',
  role: Role.BOT_ADMIN,
  author: 'Cat-Bot',
  description: 'Create or connect a new bot on the current platform (private chats only).',
  category: 'Bot Admin',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

// ── Command Handler — step 1: request the bot nickname ────────────────────────

export const onCommand = async ({
  chat,
  event,
  state,
  native,
}: AppCtx): Promise<void> => {
  // PM/DM only — refuse everywhere else.
  if (event['isGroup']) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '🔒 This command only works in **private chats (PM/DM)**.',
    });
    return;
  }

  const platform = native.platform ?? '';
  if (!isConnectablePlatform(platform)) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message:
        '❌ Creating a new bot is not supported from this platform. Use the ' +
        'Admin Dashboard to connect it.',
    });
    return;
  }

  const senderID = event['senderID'] as string | undefined;
  if (!senderID) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ Could not identify your user ID on this platform.',
    });
    return;
  }

  const messageID = await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: [
      `🤖 **Create a new ${platformDisplayName(platform)} bot**`,
      'Reply with a nickname for your new bot.',
      '',
      '_You will become its first admin._',
    ].join('\n'),
  });

  // Guard: platforms whose replyMessage does not return a message ID cannot
  // support onReply — there is no stable key to register the pending state.
  if (!messageID) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message:
        '❌ Connect unavailable: this platform did not return a message ID from replyMessage().',
    });
    return;
  }

  state.create({
    id: state.generateID({ id: String(messageID) }),
    state: STATE.awaiting_nickname,
    context: {},
  });
};

// ── Reply Handlers ────────────────────────────────────────────────────────────

export const onReply = {
  // Step 2: collect the nickname, then request the command prefix.
  [STATE.awaiting_nickname]: async ({
    chat,
    session,
    state,
    event,
    native,
  }: AppCtx): Promise<void> => {
    // Defensive re-check — the pending state was only created in a PM, but a
    // platform quirk must never let this complete in a group.
    if (event['isGroup']) {
      state.delete(session.id);
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '🔒 Private chats only — connection cancelled.',
      });
      return;
    }

    const platform = native.platform ?? '';
    const nickname = String(event['message'] ?? '').trim();

    // Remove the pending state before replying so a second quote on the same
    // prompt cannot re-trigger the handler after the step is complete.
    state.delete(session.id);

    if (!isConnectablePlatform(platform)) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message:
          '❌ Creating a new bot is not supported from this platform. Use the ' +
          'Admin Dashboard to connect it.',
      });
      return;
    }
    const nicknameError = validateNickname(nickname);
    if (nicknameError) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message:
          nicknameError === 'empty'
            ? '❌ No nickname received — run `/connect` again and reply with a nickname.'
            : `❌ That nickname is too long (max ${MAX_NICKNAME_LENGTH} chars) — run \`/connect\` again.`,
      });
      return;
    }

    const messageID = await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: [
        '✏️ **Now the command prefix**',
        `Reply with the prefix for **${nickname}**.`,
        '',
        'Default is `/` — just reply with `/` (or anything like `!`, `?`, `^`).',
      ].join('\n'),
    });
    if (!messageID) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message:
          '❌ Connect unavailable: this platform did not return a message ID from replyMessage().',
      });
      return;
    }

    state.create({
      id: state.generateID({ id: String(messageID) }),
      state: STATE.awaiting_prefix,
      // Carry the nickname forward to the prefix step.
      context: { nickname },
    });
  },

  // Step 3: collect the prefix, then request the bot token.
  [STATE.awaiting_prefix]: async ({
    chat,
    session,
    state,
    event,
    native,
  }: AppCtx): Promise<void> => {
    if (event['isGroup']) {
      state.delete(session.id);
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '🔒 Private chats only — connection cancelled.',
      });
      return;
    }

    const platform = native.platform ?? '';
    const nickname = String(session.context['nickname'] ?? '').trim();
    const prefix = normalizePrefix(String(event['message'] ?? ''));

    state.delete(session.id);

    if (!isConnectablePlatform(platform) || !nickname) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '❌ Connection expired — run `/connect` to start over.',
      });
      return;
    }

    const guide = botTokenGuide(platform);
    const messageID = await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: [
        `🔑 **Last step — the bot token**`,
        `Reply with the bot token for **${nickname}** (prefix \`${prefix}\`).`,
        '',
        guide
          ? `_Get it from ${guide.source} — it looks like ${guide.example}._`
          : '_Get the bot token for this platform, then reply with it._',
      ].join('\n'),
    });
    if (!messageID) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message:
          '❌ Connect unavailable: this platform did not return a message ID from replyMessage().',
      });
      return;
    }

    state.create({
      id: state.generateID({ id: String(messageID) }),
      state: STATE.awaiting_token,
      // Carry the nickname + prefix forward to the token step.
      context: { nickname, prefix },
    });
  },

  // Step 4: validate the token and create the new bot.
  [STATE.awaiting_token]: async ({
    chat,
    session,
    state,
    event,
    native,
  }: AppCtx): Promise<void> => {
    if (event['isGroup']) {
      state.delete(session.id);
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '🔒 Private chats only — connection cancelled.',
      });
      return;
    }

    const platform = native.platform ?? '';
    const nickname = String(session.context['nickname'] ?? '').trim();
    const prefix = String(session.context['prefix'] ?? '/').trim() || '/';
    const token = String(event['message'] ?? '').trim();
    const senderID = event['senderID'] as string | undefined;
    const guide = botTokenGuide(platform);

    state.delete(session.id);

    if (!isConnectablePlatform(platform) || !nickname) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '❌ Connection expired — run `/connect` to start over.',
      });
      return;
    }
    const invalid = validateBotToken(platform, token);
    if (invalid === 'empty') {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '❌ No token received — run `/connect` again and reply with your bot token.',
      });
      return;
    }
    if (invalid) {
      const hint = guide
        ? `It looks like ${guide.example} and comes from ${guide.source}.`
        : 'Double-check the token for this platform.';
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message:
          `❌ That does not look like a valid **${platformDisplayName(platform)}** bot token. ` +
          `${hint} Run \`/connect\` again to retry.`,
      });
      return;
    }
    if (!senderID) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '❌ Could not identify your user ID — connection cancelled.',
      });
      return;
    }

    const dto = buildConnectDto(platform, nickname, token, prefix, senderID);
    if (!dto) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '❌ Unsupported platform — connection cancelled.',
      });
      return;
    }

    const userId = native.userId ?? '';
    if (!userId) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '❌ Could not resolve your account namespace — connection cancelled.',
      });
      return;
    }

    try {
      const result = await botService.createBot(userId, dto);
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: [
          '✅ **New bot connected!**',
          `🤖 Name: **${nickname}** · Platform: **${platformDisplayName(platform)}** · Prefix: \`${prefix}\``,
          `🆔 Session: \`${result.sessionId}\``,
          '',
          'The bot is starting now — manage it from the **Admin Dashboard** (Bots).',
        ].join('\n'),
      });
    } catch (err) {
      const error = err as { message?: string };
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message:
          `⚠️ Failed to connect the new bot: \`${error.message ?? 'Unknown error'}\`. ` +
          'Double-check the token and run `/connect` to try again.',
      });
    }
  },
};
