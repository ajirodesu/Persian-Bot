import { isUserBanned, isThreadBanned } from '@/engine/repos/banned.repo.js';
import { isBotAdmin, isBotPremium } from '@/engine/repos/credentials.repo.js';
import { isSystemAdmin } from '@/engine/repos/system-admin.repo.js';
import { isThreadAdmin } from '@/engine/repos/threads.repo.js';
import { cooldownStore } from '@/engine/lib/cooldown.lib.js';
import { Role } from '@/engine/constants/role.constants.js';
import { isBlockedCommand } from './lib/blocked-commands.lib.js';

/**
 * Agent Command Guard — AI-readable preflight validation.
 *
 * Ports Cat-Bot's `agent-command-guard.lib.ts` architecture to Persian-Bot's
 * `meta`-based command modules and 5-level role hierarchy
 * (ANYONE / THREAD_ADMIN / PREMIUM / BOT_ADMIN / SYSTEM_ADMIN).
 *
 * Unlike the onCommand middleware chain (which blocks via next() or sends
 * opaque chat replies the model cannot read), this guard returns a typed
 * result the agent embeds verbatim in its reply. Guard order mirrors the
 * middleware pipeline:
 *   1. platform restriction  — meta.platform allowlist
 *   2. enabled toggle        — dashboard disabled commands
 *   3. admin bypass          — system/bot admins skip bans + cooldown
 *   4. user / thread bans    — silent drop in middleware; explicit reason here
 *   5. role / permission     — fail-closed on DB errors
 *   6. cooldown              — remaining seconds surfaced for the reply
 *
 * The guard is advisory: final execution STILL passes through the real
 * middleware + dispatcher. Never weaken existing permissions.
 */

export interface CommandGuardResult {
  allowed: boolean;
  reason: string | null;
  details?: {
    cooldownRemainingSeconds?: number;
    requiredRole?: string;
    bannedEntity?: 'user' | 'thread';
  };
}

const ROLE_LABEL: Record<number, string> = {
  [Role.ANYONE]: 'All users',
  [Role.THREAD_ADMIN]: 'Thread Administrator',
  [Role.PREMIUM]: 'Premium users',
  [Role.BOT_ADMIN]: 'Bot Administrator',
  [Role.SYSTEM_ADMIN]: 'System Administrator',
};

export async function inspectCommandConstraints(
  mod: Record<string, unknown>,
  commandName: string,
  senderID: string,
  threadID: string,
  sessionUserId: string,
  platform: string,
  sessionId: string,
  consumeCooldown = true,
  commandEnabled = true,
): Promise<CommandGuardResult> {
  const meta = (mod['meta'] as Record<string, unknown> | undefined) ?? {};
  const canonicalName = (
    typeof meta['name'] === 'string' ? meta['name'] : commandName
  ).toLowerCase();

  // ── AI deny-list (shell / eval / configured) — never executable via AI ──
  if (isBlockedCommand(canonicalName)) {
    return {
      allowed: false,
      reason:
        'This command cannot be executed through the AI for security reasons.',
    };
  }

  // ── Platform restriction ─────────────────────────────────────────────
  const platforms = meta['platform'];
  if (Array.isArray(platforms) && platforms.length > 0) {
    if (!(platforms as unknown[]).includes(platform)) {
      return {
        allowed: false,
        reason: `This command is not available on ${platform}.`,
      };
    }
  }

  // ── Disabled toggle ──────────────────────────────────────────────────
  if (!commandEnabled) {
    return {
      allowed: false,
      reason: 'This command is currently disabled by the bot admin.',
    };
  }

  // ── Admin bypass (mirrors enforceNotBanned short-circuit) ────────────
  let isSystem = false;
  let isAdmin = false;
  if (senderID) {
    try {
      isSystem = await isSystemAdmin(senderID);
    } catch {
      // Fail-open — treat as non-admin; subsequent checks apply normally
    }
  }
  if (!isSystem && sessionUserId && sessionId && senderID) {
    try {
      isAdmin = await isBotAdmin(sessionUserId, platform, sessionId, senderID);
    } catch {
      // Fail-open
    }
  }
  const bypass = isSystem || isAdmin;

  if (!bypass) {
    // ── User / thread bans (fail-open on DB outage) ────────────────────
    if (senderID && sessionUserId && sessionId) {
      try {
        if (await isUserBanned(sessionUserId, platform, sessionId, senderID)) {
          return {
            allowed: false,
            reason:
              'You are currently banned from using bot commands in this session.',
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

  // ── Role gate (fail-closed — a false grant bypasses access control) ──
  const roleRequired =
    typeof meta['role'] === 'number' ? (meta['role'] as number) : Role.ANYONE;

  if (roleRequired !== Role.ANYONE && !isSystem) {
    let allowed = false;
    try {
      if (roleRequired === Role.THREAD_ADMIN) {
        allowed = await isThreadAdmin(threadID, senderID);
        if (!allowed && sessionUserId && sessionId) {
          allowed =
            (await isBotAdmin(sessionUserId, platform, sessionId, senderID)) ||
            (await isBotPremium(sessionUserId, platform, sessionId, senderID));
        }
      } else if (roleRequired === Role.PREMIUM) {
        if (sessionUserId && sessionId) {
          allowed =
            (await isBotAdmin(sessionUserId, platform, sessionId, senderID)) ||
            (await isBotPremium(sessionUserId, platform, sessionId, senderID));
        }
      } else if (roleRequired === Role.BOT_ADMIN) {
        if (sessionUserId && sessionId) {
          allowed = await isBotAdmin(
            sessionUserId,
            platform,
            sessionId,
            senderID,
          );
        }
      } else if (roleRequired === Role.SYSTEM_ADMIN) {
        allowed = false; // isSystem already handled above
      } else {
        allowed = true; // unknown role value — middleware treats as ANYONE
      }
    } catch {
      allowed = false; // fail-closed on DB error
    }
    if (!allowed) {
      const label = ROLE_LABEL[roleRequired] ?? 'elevated privileges';
      const reason =
        roleRequired === Role.BOT_ADMIN
          ? 'This command requires bot administrator privileges.'
          : roleRequired === Role.THREAD_ADMIN
            ? 'This command requires thread administrator privileges.'
            : roleRequired === Role.SYSTEM_ADMIN
              ? 'This command is restricted to system admins.'
              : roleRequired === Role.PREMIUM
                ? 'This command requires premium status.'
                : `This command requires ${label}.`;
      return {
        allowed: false,
        reason,
        details: { requiredRole: label },
      };
    }
  }

  // ── Cooldown (admins bypass; consumed at check time for real throttling) ──
  if (!bypass) {
    const cooldownSec =
      typeof meta['cooldown'] === 'number' ? (meta['cooldown'] as number) : 0;
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
      // Preview runs (test_command) must NOT exhaust the user's limit.
      if (consumeCooldown) {
        cooldownStore.record(key, now, cooldownSec * 1000);
      }
    }
  }

  return { allowed: true, reason: null };
}
