/**
 * Agent Command Guard — AI-readable constraint inspection for silent previews.
 *
 * Returns a structured verdict BEFORE a command runs, mirroring the
 * onCommand middleware pipeline (bans → permission → cooldown) plus the
 * Persian-Bot gates that matter for AI execution: dashboard command toggles,
 * platform filtering, maintenance mode, session/thread admin-only modes.
 * Unlike the middleware chain (chat replies + silent drops), the guard never
 * sends messages — the agent embeds the reason in its own reply.
 *
 * Fail strategy: bans/maintenance/admin-only fail-open (a DB outage must not
 * lock users out); permission checks fail-closed (a false grant bypasses the
 * owner's access control); cooldowns are checked but never consumed during
 * previews so evaluation never exhausts the user's rate limit.
 *
 * Portions derived from Cat-Bot (ISC) by John Lester:
 *   https://github.com/johnlester-0369/Cat-Bot
 *   (packages/cat-bot/src/engine/agent/agent-command-guard.lib.ts)
 * See THIRD_PARTY_NOTICES.md. Adapted to Persian-Bot conventions
 * (CommandMeta contract, five Role levels, session/thread admin-only modes).
 */

import { isUserBanned, isThreadBanned } from '@/engine/repos/banned.repo.js';
import { isBotAdmin, isBotPremium, listBotPremiums } from '@/engine/repos/credentials.repo.js';
import { isThreadAdmin } from '@/engine/repos/threads.repo.js';
import { isSystemAdmin } from '@/engine/repos/system-admin.repo.js';
import { isCommandEnabled } from '@/engine/modules/session/bot-session-commands.repo.js';
import { isPlatformAllowed } from '@/engine/modules/platform/platform-filter.util.js';
import { getMaintenanceModeEnabled } from '@/engine/repos/maintenance-mode.repo.js';
import { cooldownStore } from '@/engine/lib/cooldown.lib.js';
import { Role } from '@/engine/constants/role.constants.js';
import type { AppCtx } from '@/engine/types/controller.types.js';

export interface CommandGuardResult {
  /** Whether the command may be previewed for this user in this context. */
  allowed: boolean;
  /** Human-readable explanation the agent can quote. Null when allowed. */
  reason: string | null;
  details?: {
    /** Seconds remaining (cooldown blocks only). */
    cooldownRemainingSeconds?: number;
    /** Minimum role label required (permission blocks only). */
    requiredRole?: string;
    /** Which entity triggered the ban (ban blocks only). */
    bannedEntity?: 'user' | 'thread';
  };
}

const ROLE_LABEL: Record<number, string> = {
  [Role.ANYONE]: 'Anyone',
  [Role.THREAD_ADMIN]: 'Thread Administrator',
  [Role.PREMIUM]: 'Premium',
  [Role.BOT_ADMIN]: 'Bot Administrator',
  [Role.SYSTEM_ADMIN]: 'System Administrator',
};

/**
 * Inspect execution constraints for one command. Pure check — no chat
 * messages, no middleware advancement, no cooldown consumption.
 */
export async function inspectPreviewConstraints(
  ctx: AppCtx,
  mod: Record<string, unknown>,
  commandName: string,
): Promise<CommandGuardResult> {
  const meta = mod['meta'] as Record<string, unknown> | undefined;
  const senderID = String(ctx.event['senderID'] ?? ctx.event['userID'] ?? '');
  const threadID = String(ctx.event['threadID'] ?? ctx.event['thread_id'] ?? '');
  const sessionUserId = ctx.native.userId ?? '';
  const sessionId = ctx.native.sessionId ?? '';
  const platform = ctx.native.platform;

  // ── Platform filter ──
  if (!isPlatformAllowed(mod, platform)) {
    return { allowed: false, reason: 'This command is not available on this platform.' };
  }

  // ── Dashboard toggle ──
  if (sessionUserId && sessionId) {
    try {
      const enabled = await isCommandEnabled(sessionUserId, platform, sessionId, commandName);
      if (!enabled) {
        return { allowed: false, reason: `The "${commandName}" command is disabled for this bot.` };
      }
    } catch {
      /* fail-open */
    }
  }

  // ── Maintenance mode (system admins bypass) ──
  try {
    if (await getMaintenanceModeEnabled()) {
      let sysAdmin = false;
      try {
        sysAdmin = senderID ? await isSystemAdmin(senderID) : false;
      } catch {
        sysAdmin = false;
      }
      if (!sysAdmin) {
        return { allowed: false, reason: 'The bot is in maintenance mode. Only system admins may use commands right now.' };
      }
    }
  } catch {
    /* fail-open */
  }

  // ── Bot admin bypass (mirrors enforceNotBanned short-circuit) ──
  let isAdmin = false;
  if (sessionUserId && sessionId && senderID) {
    try {
      isAdmin = await isBotAdmin(sessionUserId, platform, sessionId, senderID);
    } catch {
      isAdmin = false;
    }
  }

  if (!isAdmin) {
    if (senderID && sessionUserId && sessionId) {
      try {
        if (await isUserBanned(sessionUserId, platform, sessionId, senderID)) {
          return {
            allowed: false,
            reason: 'You are currently banned from using bot commands in this session.',
            details: { bannedEntity: 'user' },
          };
        }
      } catch {
        /* fail-open */
      }
    }
    if (threadID && sessionUserId && sessionId) {
      try {
        if (await isThreadBanned(sessionUserId, platform, sessionId, threadID)) {
          return {
            allowed: false,
            reason: 'This thread is currently banned from using bot commands.',
            details: { bannedEntity: 'thread' },
          };
        }
      } catch {
        /* fail-open */
      }
    }
  }

  // ── Permission matrix (mirrors enforcePermission; fail-closed) ──
  const roleRequired =
    typeof meta?.['role'] === 'number' ? (meta['role'] as number) : Role.ANYONE;

  if (roleRequired !== Role.ANYONE) {
    let sysAdmin: boolean;
    try {
      sysAdmin = senderID ? await isSystemAdmin(senderID) : false;
    } catch {
      sysAdmin = false;
    }
    if (!sysAdmin) {
      let allowed = false;
      try {
        if (roleRequired === Role.THREAD_ADMIN) {
          allowed = await isThreadAdmin(threadID, senderID);
          if (!allowed && sessionUserId && sessionId) {
            allowed = await isBotAdmin(sessionUserId, platform, sessionId, senderID);
          }
          if (!allowed && sessionUserId && sessionId) {
            try {
              allowed = (await listBotPremiums(sessionUserId, platform, sessionId)).includes(senderID);
            } catch {
              allowed = false;
            }
          }
        } else if (roleRequired === Role.BOT_ADMIN) {
          if (sessionUserId && sessionId) {
            allowed = await isBotAdmin(sessionUserId, platform, sessionId, senderID);
          }
        } else if (roleRequired === Role.PREMIUM) {
          if (sessionUserId && sessionId) {
            allowed = await isBotAdmin(sessionUserId, platform, sessionId, senderID);
            if (!allowed) {
              allowed = await isBotPremium(sessionUserId, platform, sessionId, senderID);
            }
          }
        } else if (roleRequired === Role.SYSTEM_ADMIN) {
          allowed = false;
        }
      } catch {
        allowed = false;
      }
      if (!allowed) {
        return {
          allowed: false,
          reason: `This command requires ${ROLE_LABEL[roleRequired] ?? 'elevated'} privileges.`,
          details: { requiredRole: ROLE_LABEL[roleRequired] ?? String(roleRequired) },
        };
      }
    }
  }

  // ── Session-wide admin-only ──
  if (sessionUserId && sessionId) {
    try {
      const botColl = ctx.db.bot;
      if (await botColl.isCollectionExist('session_settings')) {
        const settings = await (await botColl.getCollection('session_settings')).getAll();
        if (settings['adminOnlyEnabled'] === true) {
          const ignoreList = (settings['adminOnlyIgnoreList'] as string[] | undefined) ?? [];
          if (!ignoreList.includes(commandName) && !isAdmin) {
            let sysAdmin = false;
            try {
              sysAdmin = senderID ? await isSystemAdmin(senderID) : false;
            } catch {
              sysAdmin = false;
            }
            if (!sysAdmin) {
              return { allowed: false, reason: 'The bot is in admin-only mode. Only bot admins may use commands.' };
            }
          }
        }
      }
    } catch {
      /* fail-open */
    }
  }

  // ── Per-thread adminbox ──
  if (threadID && sessionUserId && sessionId) {
    try {
      const threadColl = ctx.db.threads.collection(threadID);
      if (await threadColl.isCollectionExist('adminbox_settings')) {
        const settings = await (await threadColl.getCollection('adminbox_settings')).getAll();
        if (settings['enabled'] === true) {
          const ignoreList = (settings['ignoreList'] as string[] | undefined) ?? [];
          if (!ignoreList.includes(commandName)) {
            let allowed = false;
            try {
              allowed = senderID ? await isSystemAdmin(senderID) : false;
            } catch {
              allowed = false;
            }
            if (!allowed && senderID) {
              try {
                allowed = await isBotAdmin(sessionUserId, platform, sessionId, senderID);
              } catch {
                allowed = false;
              }
            }
            if (!allowed && senderID) {
              try {
                allowed = await isThreadAdmin(threadID, senderID);
              } catch {
                allowed = false;
              }
            }
            if (!allowed) {
              return { allowed: false, reason: 'Only group admins can use the bot in this thread.' };
            }
          }
        }
      }
    } catch {
      /* fail-open */
    }
  }

  // ── Cooldown: checked, never consumed during previews ──
  if (!isAdmin) {
    const cooldownSec = typeof meta?.['cooldown'] === 'number' ? (meta['cooldown'] as number) : 0;
    if (cooldownSec > 0 && senderID) {
      const key = `${commandName}:${senderID}`;
      const now = Date.now();
      cooldownStore.pruneIfNeeded(now);
      const entry = cooldownStore.check(key, now);
      if (entry !== null) {
        const remainingSec = Math.ceil((entry.expiry - now) / 1000);
        return {
          allowed: false,
          reason: `This command is on cooldown. Please wait ${remainingSec} second${remainingSec !== 1 ? 's' : ''} before trying again.`,
          details: { cooldownRemainingSeconds: remainingSec },
        };
      }
    }
  }

  return { allowed: true, reason: null };
}
