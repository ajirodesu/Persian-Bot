/**
 * Guardian — native Persian-Bot group moderation pipeline.
 *
 * Four stages, cheapest first (an LLM call per group message is neither
 * affordable nor fast enough):
 *
 *   Stage 0  gate    group chat? policy on? sender exempt? anything to judge?
 *   Stage 1  rules   deterministic allow/deny lists — settles most links
 *   Stage 2  agent   the ambiguous remainder only (via moderateMessage)
 *   Stage 3  enforce best-effort delete + warn reply, audit, rate caps
 *
 * Only stage 2 costs tokens, and the gate is ordered so ordinary chatter
 * never reaches it. Moderation failing never stops the rest of the pipeline.
 *
 * Enforcement is honest about the unified API: there is no cross-platform
 * mute primitive, so mute/ban verdicts map to delete + warn (never to
 * kicking members — too destructive for an automatic path). Delete itself is
 * best-effort: it succeeds where the platform grants the bot deletion rights
 * (Discord/Fluxer with rights, Telegram admin bots) and degrades to
 * warn + audit where it does not.
 *
 * Portions derived from Reze-Bot (MIT):
 *   https://github.com/GrandpaEJx/Reze-Bot
 * See THIRD_PARTY_NOTICES.md. Adapted to Persian-Bot conventions
 * (Role levels, AppCtx, db collections, Winston logging).
 */

import { getPolicy } from './policy-store.js';
import {
  moderateMessage,
  threadPolicyHandles,
  threadAuditPersister,
} from './service.js';
import { resolveSenderRole } from './service.js';
import { cachedIsThreadAdmin } from '@/engine/lib/auth-cache.lib.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';
import type { AppCtx } from '@/engine/types/controller.types.js';

/** A bug must not be able to empty a group. Enforcement stops above this. */
export const MAX_ENFORCEMENTS_PER_MINUTE = 5;
/** Warn the same member at most this often per thread (spam guard). */
const WARN_COOLDOWN_MS = 5 * 60 * 1000;
/** How many recent admin messages feed topical "related?" context. */
const CONTEXT_DEPTH = 8;
/** Context older than this is not evidence of the current topic. */
const CONTEXT_TTL_MS = 6 * 60 * 60 * 1000;

interface ContextEntry {
  text: string;
  ts: number;
}

// Scoped by owner:platform:session:thread — concurrent bot sessions sharing
// this process must never read each other's moderation context.
const chatContext = new Map<string, ContextEntry[]>();
const enforcementLog = new Map<string, number[]>();
const lastWarn = new Map<string, number>();

function scope(ctx: AppCtx, threadId: string): string {
  return `${ctx.native.userId ?? 'global'}:${ctx.native.platform}:${ctx.native.sessionId ?? 'global'}:${threadId}`;
}

/**
 * Remember something a privileged member said — what makes "delete promos,
 * but not links that follow an admin post" decidable.
 */
export function recordAdminContext(ctx: AppCtx, threadId: string, text: string): void {
  const clean = (text ?? '').trim();
  if (!clean) return;
  const key = scope(ctx, threadId);
  const list = chatContext.get(key) ?? [];
  list.push({ text: clean.slice(0, 500), ts: Date.now() });
  while (list.length > CONTEXT_DEPTH) list.shift();
  chatContext.set(key, list);
}

export function getAdminContext(ctx: AppCtx, threadId: string): string[] {
  const cutoff = Date.now() - CONTEXT_TTL_MS;
  const key = scope(ctx, threadId);
  const list = (chatContext.get(key) ?? []).filter((e) => e.ts >= cutoff);
  if (list.length === 0) chatContext.delete(key);
  else chatContext.set(key, list);
  return list.map((e) => e.text);
}

/** Drop buffers for chats that have gone quiet. */
export function pruneGuardianContext(): number {
  const cutoff = Date.now() - CONTEXT_TTL_MS;
  let dropped = 0;
  for (const [key, list] of chatContext) {
    const kept = list.filter((e) => e.ts >= cutoff);
    if (kept.length === 0) {
      chatContext.delete(key);
      dropped++;
    } else {
      chatContext.set(key, kept);
    }
  }
  return dropped;
}

/** Test seam. */
export function clearGuardianState(): void {
  chatContext.clear();
  enforcementLog.clear();
  lastWarn.clear();
}

function noteEnforcement(key: string): number {
  const now = Date.now();
  const windowStart = now - 60_000;
  const times = (enforcementLog.get(key) ?? []).filter((t) => t >= windowStart);
  times.push(now);
  enforcementLog.set(key, times);
  return times.length;
}

function recentEnforcements(key: string): number {
  const windowStart = Date.now() - 60_000;
  const times = (enforcementLog.get(key) ?? []).filter((t) => t >= windowStart);
  enforcementLog.set(key, times);
  return times.length;
}

export interface GuardianOutcome {
  /** False when the gate skipped the message entirely. */
  checked: boolean;
  /** 'gate' | 'rule' | 'agent' | 'consensus' (from the moderator). */
  stage: string;
  enforced: boolean;
  dryRun: boolean;
  action?: string;
  skipReason?: string;
}

const SKIPPED = (reason: string): GuardianOutcome => ({
  checked: false,
  stage: 'gate',
  enforced: false,
  dryRun: false,
  skipReason: reason,
});

/**
 * Run the moderation pipeline for one incoming chat message.
 * Never throws for moderation reasons — failures degrade to skip.
 */
export async function guard(ctx: AppCtx): Promise<GuardianOutcome> {
  const event = ctx.event;
  if (event['aiInitiated'] === true) return SKIPPED('ai-initiated');

  const threadId = String(event['threadID'] ?? event['thread_id'] ?? '');
  const senderId = String(event['senderID'] ?? event['userID'] ?? '');
  if (!threadId || !senderId) return SKIPPED('missing ids');

  const isGroup = Boolean(event['isGroup'] ?? event['is_group'] ?? false);
  if (!isGroup) return SKIPPED('not a group');

  const text = String(event['message'] ?? event['body'] ?? '');
  if (!text.trim()) return SKIPPED('no text');

  // Never moderate the bot's own messages (self-moderation loops).
  try {
    const botId = ctx.bot.getID?.();
    if (botId && String(botId) === senderId) return SKIPPED('own message');
  } catch {
    /* best-effort identity check */
  }

  const handles = threadPolicyHandles(ctx, threadId);
  const policy = await getPolicy(threadId, handles).catch(() => null);
  if (!policy) return SKIPPED('policy unavailable');
  if (!policy.enabled) return SKIPPED('moderation disabled for this chat');
  if (policy.links.mode === 'off') return SKIPPED('link checking off');

  // ── Exemptions (cached lookups, cheapest last) ──
  let role: number;
  try {
    role = await resolveSenderRole(ctx, senderId);
  } catch {
    role = Role.ANYONE;
  }
  if (role >= Role.SYSTEM_ADMIN) return SKIPPED('system admin');
  if (policy.whitelist.includes(senderId)) return SKIPPED('whitelisted');

  const exempt = policy.links.exempt;
  if (exempt.includes('premium') && role >= Role.PREMIUM) return SKIPPED('premium');

  if (exempt.includes('admins')) {
    let isAdmin = role >= Role.BOT_ADMIN;
    if (!isAdmin) {
      try {
        isAdmin = await cachedIsThreadAdmin(ctx, threadId, senderId);
      } catch {
        isAdmin = false;
      }
    }
    if (isAdmin) {
      // An admin's message is also the topical context for "related?" calls.
      recordAdminContext(ctx, threadId, text);
      return SKIPPED('admin');
    }
  }

  // ── Stage 0/1/2: judge (rules first, agent only when needed) ──
  let outcome;
  try {
    outcome = await moderateMessage({
      threadId,
      senderId,
      text,
      senderRole: role,
      isGroup,
      ...(ctx.native.userId ? { userId: ctx.native.userId } : {}),
      policyHandles: handles,
      context: policy.links.allowIfRelatedToContext ? getAdminContext(ctx, threadId) : [],
      chatTitle: (event['threadName'] as string | undefined) ?? null,
      persistAudit: threadAuditPersister(ctx, threadId),
    });
  } catch (err) {
    logger.warn('[guardian] moderation pipeline failed', {
      error: (err as Error)?.message ?? String(err),
    });
    return SKIPPED('pipeline error');
  }

  if (outcome.action === 'allow' || outcome.action === 'flag') {
    return {
      checked: true,
      stage: outcome.stage,
      enforced: false,
      dryRun: true,
      action: outcome.action,
    };
  }

  const scopeKey = scope(ctx, threadId);

  // ── Runaway guard ──
  if (recentEnforcements(scopeKey) >= MAX_ENFORCEMENTS_PER_MINUTE) {
    logger.warn(`[guardian] enforcement rate cap hit in ${threadId} — standing down`);
    return { checked: true, stage: outcome.stage, enforced: false, dryRun: true, action: outcome.action };
  }

  // ── Enforce: best-effort delete + warn reply ──
  let deleted = false;
  const messageId = event['messageID'] as string | undefined;
  if (messageId) {
    try {
      await ctx.chat.unsendMessage(messageId);
      deleted = true;
    } catch {
      logger.warn(`[guardian] delete failed in ${threadId} (platform may not grant deletion rights)`);
    }
  }

  if (policy.links.enforcement.warn) {
    const warnKey = `${scopeKey}:${senderId}`;
    const last = lastWarn.get(warnKey) ?? 0;
    if (Date.now() - last >= WARN_COOLDOWN_MS) {
      lastWarn.set(warnKey, Date.now());
      try {
        await ctx.chat.replyMessage({
          style: MessageStyle.TEXT,
          message: `Warning: that message was removed (${outcome.reason})`,
        });
      } catch {
        /* non-critical */
      }
    }
  }

  noteEnforcement(scopeKey);
  logger.info('[guardian] enforced', {
    threadId,
    action: outcome.action,
    category: outcome.category,
    confidence: outcome.confidence,
    deleted,
  });

  return {
    checked: true,
    stage: outcome.stage,
    enforced: deleted,
    dryRun: false,
    action: outcome.action,
  };
}
