/**
 * AI Agent — Command Constraint Guard
 *
 * Mirrors the real command pipeline's guards (platform filter, ban checks,
 * role enforcement, cooldown) without running the command itself. test_command
 * calls this before dispatching so the agent only previews commands the user
 * could actually run — and learns the reason when one is blocked.
 *
 * Cooldown behaviour: when `consumeCooldown` is false the active window is
 * reported but NOT consumed, so the agent can preview a command without
 * exhausting the user's rate limit. When true, a fresh window is recorded.
 */

import type { CommandModule } from '@/engine/types/controller.types.js';
import { isPlatformAllowed } from '@/engine/modules/platform/platform-filter.util.js';
import { isBotAdmin, isBotPremium } from '@/engine/repos/credentials.repo.js';
import { isThreadAdmin } from '@/engine/repos/threads.repo.js';
import { isSystemAdmin } from '@/engine/repos/system-admin.repo.js';
import { isUserBanned, isThreadBanned } from '@/engine/repos/banned.repo.js';
import { cooldownStore } from '@/engine/lib/cooldown.lib.js';
import { Role } from '@/engine/constants/role.constants.js';

export interface CommandGuardResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Checks every constraint the real pipeline would enforce for a command.
 * Fail-open on DB errors so a storage hiccup never blocks legitimate previews.
 */
export async function inspectCommandConstraints(
  mod: CommandModule | undefined,
  command: string,
  senderID: string,
  threadID: string,
  sessionUserId: string,
  platform: string,
  sessionId: string,
  consumeCooldown: boolean,
): Promise<CommandGuardResult> {
  if (!mod || typeof mod['onCommand'] !== 'function') {
    return { allowed: false, reason: `Command '${command}' not found.` };
  }

  const cfg = (mod['meta'] as Record<string, unknown> | undefined) ?? {};

  // 1. Platform filter — command declares unsupported platforms.
  if (!isPlatformAllowed(mod, platform)) {
    return {
      allowed: false,
      reason: `Command '${command}' is not supported on platform '${platform}'.`,
    };
  }

  // 2. Ban enforcement — banned users/threads are dropped silently in the real
  //    pipeline; the agent should not preview banned commands either.
  if (sessionUserId && sessionId && senderID) {
    try {
      const [userBanned, threadBanned] = await Promise.all([
        isUserBanned(sessionUserId, platform, sessionId, senderID),
        threadID ? isThreadBanned(sessionUserId, platform, sessionId, threadID) : Promise.resolve(false),
      ]);
      if (userBanned) {
        return { allowed: false, reason: `Command '${command}' blocked: you are banned from this bot.` };
      }
      if (threadBanned) {
        return { allowed: false, reason: `Command '${command}' blocked: this thread is banned from this bot.` };
      }
    } catch {
      // Fail-open — fall through to the role check.
    }
  }

  // 3. Role enforcement — mirrors the accessible-role set used by /help so the
  //    agent sees exactly the commands the user can reach (PREMIUM is a
  //    sub-admin tier, so a numeric ceiling would be wrong).
  const cmdRole = Number((cfg['role'] as number | undefined) ?? Role.ANYONE);
  if (cmdRole !== Role.ANYONE) {
    const accessibleRoles = new Set<number>([Role.ANYONE]);
    if (sessionUserId && sessionId && senderID) {
      try {
        const isSysAdmin = await isSystemAdmin(senderID);
        if (isSysAdmin) {
          accessibleRoles.add(Role.THREAD_ADMIN);
          accessibleRoles.add(Role.BOT_ADMIN);
          accessibleRoles.add(Role.PREMIUM);
          accessibleRoles.add(Role.SYSTEM_ADMIN);
        } else {
          const isAdmin = await isBotAdmin(sessionUserId, platform, sessionId, senderID);
          if (isAdmin) {
            accessibleRoles.add(Role.THREAD_ADMIN);
            accessibleRoles.add(Role.BOT_ADMIN);
            accessibleRoles.add(Role.PREMIUM);
          } else {
            const isPremium = await isBotPremium(sessionUserId, platform, sessionId, senderID);
            if (isPremium) {
              accessibleRoles.add(Role.THREAD_ADMIN);
              accessibleRoles.add(Role.PREMIUM);
            } else if (threadID) {
              const isThreadAdm = await isThreadAdmin(threadID, senderID);
              if (isThreadAdm) accessibleRoles.add(Role.THREAD_ADMIN);
            }
          }
        }
      } catch {
        // Fail-open — default to ANYONE-only.
      }
    }
    if (!accessibleRoles.has(cmdRole)) {
      return {
        allowed: false,
        reason: `Command '${command}' requires a higher role than you have.`,
      };
    }
  }

  // 4. Cooldown — report the active window without consuming it during preview.
  const cooldownSec = cfg['cooldown'];
  if (typeof cooldownSec === 'number' && cooldownSec > 0 && senderID) {
    const key = `${command}:${senderID}`;
    const now = Date.now();
    cooldownStore.pruneIfNeeded(now);
    const entry = cooldownStore.check(key, now);
    if (entry !== null) {
      const remainingSec = Math.ceil((entry.expiry - now) / 1000);
      return {
        allowed: false,
        reason: `Command '${command}' is on cooldown — ${remainingSec}s remaining.`,
      };
    }
    if (consumeCooldown) cooldownStore.record(key, now, cooldownSec * 1000);
  }

  return { allowed: true };
}
