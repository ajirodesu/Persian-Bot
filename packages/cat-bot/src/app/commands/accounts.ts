/**
 * accounts.ts — /accounts — List Connected Bot Accounts
 *
 * Lists every bot session (account) registered to this deployment with its
 * platform, nickname (when set), command prefix, and live running status.
 * Adapted from mrepol742/project-canis's accounts.ts into Cat-Bot's native
 * module contract (meta + onCommand).
 *
 * In project-canis each row was a clientId plus a Root/User flag; here the
 * equivalent of a "connected account" is a bot_session row, and the
 * Root/User flag is replaced by the account's 🟢 Running / 🔴 Stopped status.
 *
 *   /accounts
 *   Bot: 👥 **Connected Accounts**
 *        ─────────────────
 *        1. 🎮 **Discord**
 *           👤 My Bot · ⚡ `!` · 🟢 Running
 *        2. ✈️ **Telegram**
 *           👤 N/A · 🔴 Stopped
 *        ─────────────────
 *        📊 **Total:** 2 · **Running:** 1
 *
 * Author: AjiroDesu
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import { findAllBotSessions } from '@/engine/repos/credentials.repo.js';
import { fromPlatformNumericId } from '@/engine/modules/platform/platform-id.util.js';

/** Horizontal rule — matches the HR used in help.ts. */
const HR = '─────────────────';

/** Per-platform icon for a friendlier account list. */
function platformIcon(platform: string): string {
  switch (platform) {
    case 'discord':
      return '🎮';
    case 'telegram':
      return '✈️';
    case 'webchat':
      return '🌐';
    default:
      return '🤖';
  }
}

/**
 * Resolves a stored numeric platform id to its icon + display name.
 * Unknown platforms render as a bare 🤖 icon with no name — never "Unknown".
 */
function resolvePlatform(platformId: number): { icon: string; name: string } {
  try {
    const name = fromPlatformNumericId(platformId);
    return { icon: platformIcon(name), name };
  } catch {
    return { icon: '🤖', name: '' };
  }
}

// ── Config ────────────────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'accounts',
  aliases: ['acc'] as string[],
  version: '1.0.0',
  role: Role.BOT_ADMIN,
  author: 'AjiroDesu',
  description: 'List all bot accounts currently connected in.',
  category: 'Info',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

// ── Command Handler ───────────────────────────────────────────────────────

export const onCommand = async ({ chat }: AppCtx): Promise<void> => {
  try {
    const sessions = (await findAllBotSessions()) as Array<
      Record<string, unknown>
    >;

    if (!sessions.length) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: [
          '👥 **Connected Accounts**',
          HR,
          '_No connected accounts found._',
        ].join('\n'),
      });
      return;
    }

    const lines = sessions.flatMap((raw, i) => {
      const session = raw as Record<string, unknown>;
      const platformId = Number(session['platformId'] ?? 0);
      const nickname = String(session['nickname'] ?? '');
      const prefix = String(session['prefix'] ?? '').trim();
      const isRunning = session['isRunning'] === true;

      const { icon, name } = resolvePlatform(platformId);
      const platformPart = name ? `${icon} **${name}**` : icon;
      const nick = nickname.trim() || 'N/A';
      const prefixPart = prefix ? ` · ⚡ \`${prefix}\`` : '';
      const status = isRunning ? '🟢 **Running**' : '🔴 **Stopped**';
      // Right-align numbers up to 99 so entries line up cleanly in monospace chat.
      const num = String(i + 1).padStart(2, ' ');

      return [
        `${num}. ${platformPart}`,
        `   👤 ${nick}${prefixPart} · ${status}`,
      ];
    });

    const total = sessions.length;
    const running = sessions.filter(
      (s) => (s as Record<string, unknown>)['isRunning'] === true,
    ).length;

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: [
        '👥 **Connected Accounts**',
        HR,
        ...lines,
        HR,
        `📊 **Total:** ${total} · **Running:** ${running}`,
      ].join('\n'),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ Failed to list accounts: _${message}_`,
    });
  }
};