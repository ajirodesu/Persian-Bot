/**
 * Session pre-warm — populates every hot-path LRU entry for active sessions
 * before the first command arrives.
 *
 * Extracted from engine/app.ts so the boot path, the idle refresh timer and
 * benchmarks share one implementation. All reads go through the same cached
 * repo functions the middleware chain uses, so a warmed cache is identical to
 * one filled by real traffic.
 */
import { Platforms } from '@/engine/modules/platform/platform.constants.js'
import { createBotCollectionManager } from '@/engine/lib/db-collection.lib.js'
import { setCachedSessionAdminOnly } from '@/engine/lib/admin-only-state.lib.js'
import {
  listBotAdmins,
  listBotPremiums,
} from '@/engine/repos/credentials.repo.js'
import {
  getBotSessionData,
  getBotNickname,
} from '@/engine/repos/session.repo.js'
import { isSystemAdmin } from '@/engine/repos/system-admin.repo.js'
import { getMaintenanceModeEnabled } from '@/engine/repos/maintenance-mode.repo.js'
import { findSessionCommands } from '@/engine/modules/session/bot-session-commands.repo.js'
import type { SessionConfigs } from '@/engine/modules/session/session-loader.util.js'

export interface PrewarmSession {
  userId: string
  platform: string
  sessionId: string
}

/** Flattens the platform config into the session tuples the caches are keyed by. */
export function collectPrewarmSessions(
  configs: SessionConfigs,
): PrewarmSession[] {
  return [
    ...configs.discord.map((s) => ({
      userId: s.userId,
      platform: Platforms.Discord,
      sessionId: s.sessionId,
    })),
    ...configs.telegram.map((s) => ({
      userId: s.userId,
      platform: Platforms.Telegram,
      sessionId: s.sessionId,
    })),
  ]
}

/**
 * Mirrors enforceAdminOnly's read logic exactly: cache false when no
 * session_settings collection exists, otherwise cache the stored flag.
 * Fail-open by design — a cold cache is always safe.
 */
async function warmSessionAdminOnly(session: PrewarmSession): Promise<void> {
  try {
    const botColl = createBotCollectionManager(
      session.userId,
      session.platform,
      session.sessionId,
    )
    if (await botColl.isCollectionExist('session_settings')) {
      const h = await botColl.getCollection('session_settings')
      const settings = await h.getAll()
      const enabled = settings['adminOnlyEnabled'] as
        | boolean
        | null
        | undefined
      if (enabled !== null && enabled !== undefined) {
        setCachedSessionAdminOnly(
          session.userId,
          session.platform,
          session.sessionId,
          enabled === true,
        )
      }
    } else {
      setCachedSessionAdminOnly(
        session.userId,
        session.platform,
        session.sessionId,
        false,
      )
    }
  } catch {
    // fail-open — a cold cache on the first message is always safe
  }
}

/**
 * Warms the given sessions concurrently. Every task is independent and
 * allSettled so one slow collection cannot delay the others.
 */
export async function prewarmSessionsFor(
  sessions: readonly PrewarmSession[],
): Promise<number> {
  const results = await Promise.allSettled([
    // Prime the global gates — both are read on every command dispatch.
    isSystemAdmin('__prewarm__'),
    getMaintenanceModeEnabled(),
    ...sessions.flatMap((s) => [
      listBotAdmins(s.userId, s.platform, s.sessionId),
      listBotPremiums(s.userId, s.platform, s.sessionId),
      getBotSessionData(s.userId, s.platform, s.sessionId),
      findSessionCommands(s.userId, s.platform, s.sessionId),
      getBotNickname(s.userId, s.platform, s.sessionId),
      warmSessionAdminOnly(s),
    ]),
  ])
  // Partial failures are tolerable (that key simply stays cold); an all-failed
  // warm-up means the DB was unreachable, so report failure and let the
  // controller back off instead of claiming the cache is warm.
  if (results.length > 0 && results.every((r) => r.status === 'rejected')) {
    throw new Error('Session pre-warm failed for every cache entry')
  }
  return sessions.length
}

/** Convenience wrapper for boot/idle refresh. */
export function prewarmSessions(configs: SessionConfigs): Promise<number> {
  return prewarmSessionsFor(collectPrewarmSessions(configs))
}
