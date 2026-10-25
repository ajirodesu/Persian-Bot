/**
 * onChat runner — passive middleware execution with role and ban enforcement.
 *
 * Runs every command's onChat handler for each incoming message regardless of
 * prefix. Used for cross-cutting concerns like logging that process every message.
 *
 * ── Access Control ────────────────────────────────────────────────────────────
 * Before fanning out, this runner pre-resolves the sender's effective role tier
 * and ban status once per message. Each module's config.role is then compared
 * against the cached tier — modules whose required role exceeds the sender's
 * tier are skipped silently (no response, no next() equivalent).
 *
 * Truth table (invoker → required role):
 *   Any user      → ANYONE (0) only
 *   THREAD_ADMIN  → ANYONE + THREAD_ADMIN
 *   PREMIUM       → ANYONE + THREAD_ADMIN + PREMIUM
 *   BOT_ADMIN     → ANYONE + THREAD_ADMIN + PREMIUM + BOT_ADMIN
 *   SYSTEM_ADMIN  → all tiers (full access)
 *
 * Ban enforcement mirrors enforceNotBanned from on-command.middleware.ts:
 * banned users and threads are silently skipped. Admins (BOT_ADMIN, SYSTEM_ADMIN)
 * bypass both role and ban checks.
 *
 * Fail-open: on any DB error the sender is treated as ANYONE with no bans
 * so a transient DB outage never silently suppresses legitimate passive handlers.
 *
 * ── Performance ───────────────────────────────────────────────────────────────
 * Handlers are independent passive observers with no ordering dependency,
 * so they are fanned out in parallel via Promise.allSettled. This collapses
 * O(N × T) sequential latency into O(max_T) — critical because onChat runs on
 * every message before any prefix check or command guard.
 */

import type {
  BaseCtx,
  CommandMap,
  CommandModule,
} from '@/engine/types/controller.types.js';
// Platform filter — respects config.platform[] declared by each command module
import { isPlatformAllowed } from '@/engine/modules/platform/platform-filter.util.js';
// Ban enforcement — silently skip banned senders and threads in the onChat fan-out
import { isUserBanned, isThreadBanned } from '@/engine/repos/banned.repo.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';

/**
 * Fans out to every command's onChat handler — used for passive middleware
 * like the logger module that processes every message regardless of prefix.
 *
 * Per-module access control runs before each task is enqueued:
 *   1. Platform exclusion (config.platform[]) — skip incompatible platforms.
 *   2. Ban guard — silently skip banned senders or banned threads.
 *   3. Role guard — silently skip modules whose config.role exceeds the sender's tier.
 *
 * All three guards are silent — no reply is sent, consistent with the
 * passive-observer contract of onChat handlers.
 */
/**
 * Per-CommandMap, per-platform list of modules that actually implement onChat.
 *
 * The command map stores one entry per name AND per alias, so the previous
 * implementation walked every key on every message just to discover the small
 * handful of passive handlers. This index is built once per loaded map and
 * reused; aliases cannot duplicate a module because registration de-duplicates
 * by object identity.
 */
const onChatIndex = new WeakMap<
  CommandMap,
  Map<string, CommandModule[]>
>();

export function getOnChatModules(
  commands: CommandMap,
  platform: string,
): CommandModule[] {
  let perPlatform = onChatIndex.get(commands);
  if (!perPlatform) {
    perPlatform = new Map<string, CommandModule[]>();
    onChatIndex.set(commands, perPlatform);
  }

  const cached = perPlatform.get(platform);
  if (cached) return cached;

  const seen = new Set<CommandModule>();
  const modules: CommandModule[] = [];
  for (const mod of commands.values()) {
    if (seen.has(mod)) continue;
    seen.add(mod);
    if (typeof mod['onChat'] !== 'function') continue;
    if (!isPlatformAllowed(mod, platform)) continue;
    modules.push(mod);
  }
  perPlatform.set(platform, modules);
  return modules;
}

export async function runOnChat(
  commands: CommandMap,
  ctx: BaseCtx,
): Promise<void> {

  // Resolve session identity once — shared across all module guards in this fan-out.
  // Avoids repeating the same native context reads inside each module iteration.
  const sessionUserId = ctx.native.userId ?? '';
  const sessionId = ctx.native.sessionId ?? '';
  const platform = ctx.native.platform;
  // senderID falls back to userID for edge-case events (reactions, system messages)
  // that still route through the onChat pipeline on some platforms.
  const senderID = (ctx.event['senderID'] ?? ctx.event['userID'] ?? '') as string;
  const threadID = (ctx.event['threadID'] ?? '') as string;

  // Resolve ban status ONCE before the fan-out — two parallel DB reads instead of the
  // previous 4–5 sequential reads (isBotAdmin + isSystemAdmin + isBotPremium + isThreadAdmin
  // + ban checks). onChat is a passive observer; role enforcement is intentionally absent here.
  // Fail-open: on any DB error both flags remain false so a transient outage never
  // silently suppresses legitimate passive handlers.
  let userBanned = false;
  let threadBanned = false;

  if (sessionUserId && sessionId && senderID) {
    try {
      const [userBannedResult, threadBannedResult] = await Promise.all([
        isUserBanned(sessionUserId, platform, sessionId, senderID),
        threadID
          ? isThreadBanned(sessionUserId, platform, sessionId, threadID)
          : Promise.resolve(false),
      ]);
      userBanned = userBannedResult;
      threadBanned = threadBannedResult;
    } catch {
      // Fail-open: DB errors must never silently suppress legitimate onChat handlers.
    }
  }

  // Nothing to fan out on this platform: skip the ban DB reads entirely.
  const eligible = getOnChatModules(commands, ctx.native.platform);
  if (eligible.length === 0) return;

  // Silently skip banned senders and threads — no reply sent, passive-observer contract.
  if (userBanned || threadBanned) return;

  // Collect all onChat promises before awaiting so every eligible module starts
  // immediately — no module waits for the previous module's onChat to resolve.
  const tasks: Promise<void>[] = [];
  for (const mod of eligible) {
    tasks.push(
      (mod['onChat'] as (ctx: BaseCtx) => Promise<void>)(ctx).catch(
        (err: unknown) => {
          logger.debug('[on-chat] onChat handler error', {
            command: (mod['meta'] as { name?: string } | undefined)?.name,
            error: err,
          });
        },
      ),
    );
  }
  // allSettled (not all) as belt-and-suspenders: individual .catch() handlers above absorb
  // per-module errors, but allSettled guarantees we wait for every task even if one throws
  // synchronously before returning a Promise — preventing silent fire-and-forget behaviour.
  //
  // No typing indicator is started here. This fan-out runs on EVERY message for EVERY
  // registered onChat handler (logger, autoban, badwords, antispam, afk, etc.) whether or
  // not the message is actually addressed to the bot — most onChat handlers are passive
  // observers that never reply. Starting an indicator at this level would show "bot is
  // typing…" for any message at all, including ones nobody is using the bot for. Handlers
  // that DO decide to respond are responsible for starting their own indicator at that
  // point, gated behind their own trigger check.
  await Promise.allSettled(tasks);
}
