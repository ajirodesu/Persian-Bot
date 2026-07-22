/**
 * Bot Database Controller — session-scoped user/group data management.
 *
 * Exposes read + write endpoints so the dashboard Database panel can:
 *   • List users and groups seen by this bot session (paginated + searchable)
 *   • Delete a user or group session record
 *   • Ban / unban a user or group
 *
 * Authentication: every handler calls requireSession() first and then
 * validates bot ownership via botService.getBot() before touching any data.
 * This prevents one user from accessing another user's session records.
 *
 * SQL: queries pool directly (same pg.Pool the adapter layer uses) to avoid
 * round-tripping through the LRU cache for admin reads and to support the
 * LIMIT / OFFSET / ILIKE search pattern not exposed by the engine repos.
 */

import type { Request, Response } from 'express';
import { requireSession } from '@/server/validators/auth-session.validator.js';
import { botService } from '@/server/services/bot.service.js';
import { pool } from 'database';
import {
  banUser,
  unbanUser,
  banThread,
  unbanThread,
} from '@/engine/repos/banned.repo.js';
import { dbChangeEmitter } from '@/engine/lib/db-change-emitter.lib.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Validates auth + bot ownership; returns { userId, sessionId, platform, platformId } or null on error. */
async function resolveSession(
  req: Request,
  res: Response,
): Promise<{ userId: string; sessionId: string; platform: string; platformId: number } | null> {
  const userId = await requireSession(req, res);
  if (!userId) return null;

  const sessionId = String(req.params.id ?? '');
  if (!sessionId) {
    res.status(400).json({ error: 'Missing session id' });
    return null;
  }

  try {
    const bot = await botService.getBot(userId, sessionId);
    if (!bot) {
      res.status(404).json({ error: 'Bot session not found' });
      return null;
    }
    return { userId, sessionId, platform: String(bot.platform), platformId: Number(bot.platformId) };
  } catch {
    res.status(404).json({ error: 'Bot session not found' });
    return null;
  }
}

// pool is exported as `any` from the database package (dynamic import barrel).
// We call it untyped and cast the result rows instead of using generic type params.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db: { query: (sql: string, params: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }> } = pool as any;

/** Status filter applied to the ban-state of a record. */
type StatusFilter = 'all' | 'active' | 'banned';

function parseStatusFilter(raw: unknown): StatusFilter {
  return raw === 'active' || raw === 'banned' ? raw : 'all';
}

/** SQL fragment (no leading AND) for a ban-state column, given the requested filter. */
function statusClause(banExpr: string, status: StatusFilter): string {
  if (status === 'active') return `${banExpr} = FALSE`;
  if (status === 'banned') return `${banExpr} = TRUE`;
  return '';
}

type SortDir = 'ASC' | 'DESC';

function parseSortDir(raw: unknown): SortDir {
  return String(raw ?? '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
}

/** Resolves a client-facing sort key to a safe, whitelisted SQL column reference. */
function resolveSortColumn(raw: unknown, allowed: Record<string, string>, fallback: string): string {
  const key = String(raw ?? '');
  return Object.prototype.hasOwnProperty.call(allowed, key) ? (allowed[key] ?? fallback) : fallback;
}

/** Session key used to scope real-time change events — matches banned.repo.ts's convention. */
function sessionKey(ctx: { userId: string; platform: string; sessionId: string }): string {
  return `${ctx.userId}:${ctx.platform}:${ctx.sessionId}`;
}

// ── Controller ────────────────────────────────────────────────────────────────

export class BotDatabaseController {
  /**
   * GET /api/v1/bots/:id/database/users
   * Returns paginated list of users seen by this bot session.
   */
  async listUsers(req: Request, res: Response): Promise<void> {
    const ctx = await resolveSession(req, res);
    if (!ctx) return;

    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10));
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10)));
    const search = String(req.query.search ?? '').trim();
    const status = parseStatusFilter(req.query.status);
    const offset = (page - 1) * limit;
    const searchParam = search ? `%${search}%` : '%';

    const banExpr = 'COALESCE(busb.is_banned, FALSE)';
    const extraClause = statusClause(banExpr, status);
    const whereExtra = extraClause ? ` AND ${extraClause}` : '';

    const sortColumn = resolveSortColumn(
      req.query.sortBy,
      { name: 'bu.name', last_seen: 'bus.last_updated_at' },
      'bus.last_updated_at',
    );
    const sortDir = parseSortDir(req.query.sortDir);

    try {
      const [rowsResult, countResult] = await Promise.all([
        db.query(
          `SELECT
             bu.id,
             bu.name,
             bu.first_name,
             bu.username,
             bu.avatar_url,
             bus.last_updated_at AS last_seen,
             COALESCE(busb.is_banned, FALSE) AS is_banned,
             busb.reason AS ban_reason
           FROM bot_users_session bus
           JOIN bot_users bu ON bu.id = bus.bot_user_id
           LEFT JOIN bot_users_session_banned busb
             ON busb.user_id     = bus.user_id
            AND busb.platform_id = bus.platform_id
            AND busb.session_id  = bus.session_id
            AND busb.bot_user_id = bus.bot_user_id
           WHERE bus.user_id     = $1
             AND bus.platform_id = $2
             AND bus.session_id  = $3
             AND (bu.name ILIKE $4 OR bu.id ILIKE $4 OR COALESCE(bu.username, '') ILIKE $4)${whereExtra}
           ORDER BY ${sortColumn} ${sortDir} NULLS LAST, bus.last_updated_at DESC NULLS LAST
           LIMIT $5 OFFSET $6`,
          [ctx.userId, ctx.platformId, ctx.sessionId, searchParam, limit, offset],
        ),
        db.query(
          `SELECT COUNT(*) AS count
           FROM bot_users_session bus
           JOIN bot_users bu ON bu.id = bus.bot_user_id
           LEFT JOIN bot_users_session_banned busb
             ON busb.user_id     = bus.user_id
            AND busb.platform_id = bus.platform_id
            AND busb.session_id  = bus.session_id
            AND busb.bot_user_id = bus.bot_user_id
           WHERE bus.user_id     = $1
             AND bus.platform_id = $2
             AND bus.session_id  = $3
             AND (bu.name ILIKE $4 OR bu.id ILIKE $4 OR COALESCE(bu.username, '') ILIKE $4)${whereExtra}`,
          [ctx.userId, ctx.platformId, ctx.sessionId, searchParam],
        ),
      ]);

      const total = parseInt(String(countResult.rows[0]?.count ?? '0'), 10);

      res.json({
        users: rowsResult.rows,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      });
    } catch (err) {
      console.error('[BotDatabaseController.listUsers]', err);
      res.status(500).json({ error: 'Failed to fetch users' });
    }
  }

  /**
   * GET /api/v1/bots/:id/database/groups
   * Returns paginated list of groups/threads seen by this bot session.
   */
  async listGroups(req: Request, res: Response): Promise<void> {
    const ctx = await resolveSession(req, res);
    if (!ctx) return;

    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10));
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10)));
    const search = String(req.query.search ?? '').trim();
    const status = parseStatusFilter(req.query.status);
    const offset = (page - 1) * limit;
    const searchParam = search ? `%${search}%` : '%';

    const banExpr = 'COALESCE(btsb.is_banned, FALSE)';
    const extraClause = statusClause(banExpr, status);
    const whereExtra = extraClause ? ` AND ${extraClause}` : '';

    const sortColumn = resolveSortColumn(
      req.query.sortBy,
      { name: 'bt.name', last_seen: 'bts.last_updated_at' },
      'bts.last_updated_at',
    );
    const sortDir = parseSortDir(req.query.sortDir);

    try {
      const [rowsResult, countResult] = await Promise.all([
        db.query(
          `SELECT
             bt.id,
             bt.name,
             bt.is_group,
             bt.member_count,
             bt.avatar_url,
             bts.last_updated_at AS last_seen,
             COALESCE(btsb.is_banned, FALSE) AS is_banned,
             btsb.reason AS ban_reason
           FROM bot_threads_session bts
           JOIN bot_threads bt ON bt.id = bts.bot_thread_id
           LEFT JOIN bot_threads_session_banned btsb
             ON btsb.user_id      = bts.user_id
            AND btsb.platform_id  = bts.platform_id
            AND btsb.session_id   = bts.session_id
            AND btsb.bot_thread_id = bts.bot_thread_id
           WHERE bts.user_id     = $1
             AND bts.platform_id = $2
             AND bts.session_id  = $3
             AND (bt.name ILIKE $4 OR bt.id ILIKE $4)${whereExtra}
           ORDER BY ${sortColumn} ${sortDir} NULLS LAST, bts.last_updated_at DESC NULLS LAST
           LIMIT $5 OFFSET $6`,
          [ctx.userId, ctx.platformId, ctx.sessionId, searchParam, limit, offset],
        ),
        db.query(
          `SELECT COUNT(*) AS count
           FROM bot_threads_session bts
           JOIN bot_threads bt ON bt.id = bts.bot_thread_id
           LEFT JOIN bot_threads_session_banned btsb
             ON btsb.user_id      = bts.user_id
            AND btsb.platform_id  = bts.platform_id
            AND btsb.session_id   = bts.session_id
            AND btsb.bot_thread_id = bts.bot_thread_id
           WHERE bts.user_id     = $1
             AND bts.platform_id = $2
             AND bts.session_id  = $3
             AND (bt.name ILIKE $4 OR bt.id ILIKE $4)${whereExtra}`,
          [ctx.userId, ctx.platformId, ctx.sessionId, searchParam],
        ),
      ]);

      const total = parseInt(String(countResult.rows[0]?.count ?? '0'), 10);

      res.json({
        groups: rowsResult.rows,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      });
    } catch (err) {
      console.error('[BotDatabaseController.listGroups]', err);
      res.status(500).json({ error: 'Failed to fetch groups' });
    }
  }

  /**
   * DELETE /api/v1/bots/:id/database/users/:userId
   * Removes a user's session association with this bot.
   */
  async deleteUser(req: Request, res: Response): Promise<void> {
    const ctx = await resolveSession(req, res);
    if (!ctx) return;

    const botUserId = String(req.params.userId ?? '');
    if (!botUserId) {
      res.status(400).json({ error: 'Missing userId' });
      return;
    }

    try {
      await db.query(
        `DELETE FROM bot_users_session
         WHERE user_id = $1 AND platform_id = $2 AND session_id = $3 AND bot_user_id = $4`,
        [ctx.userId, ctx.platformId, ctx.sessionId, botUserId],
      );
      dbChangeEmitter.publish({
        key: sessionKey(ctx),
        type: 'user',
        action: 'delete',
        id: botUserId,
      });
      res.json({ success: true });
    } catch (err) {
      console.error('[BotDatabaseController.deleteUser]', err);
      res.status(500).json({ error: 'Failed to delete user' });
    }
  }

  /**
   * POST /api/v1/bots/:id/database/users/:userId/ban
   * Bans a user from this bot session.
   */
  async banUser(req: Request, res: Response): Promise<void> {
    const ctx = await resolveSession(req, res);
    if (!ctx) return;

    const botUserId = String(req.params.userId ?? '');
    if (!botUserId) {
      res.status(400).json({ error: 'Missing userId' });
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const reason = typeof req.body?.reason === 'string' ? (req.body.reason as string) : undefined;

    try {
      await banUser(ctx.userId, ctx.platform, ctx.sessionId, botUserId, reason);
      res.json({ success: true });
    } catch (err) {
      console.error('[BotDatabaseController.banUser]', err);
      res.status(500).json({ error: 'Failed to ban user' });
    }
  }

  /**
   * DELETE /api/v1/bots/:id/database/users/:userId/ban
   * Lifts a user ban for this bot session.
   */
  async unbanUser(req: Request, res: Response): Promise<void> {
    const ctx = await resolveSession(req, res);
    if (!ctx) return;

    const botUserId = String(req.params.userId ?? '');
    if (!botUserId) {
      res.status(400).json({ error: 'Missing userId' });
      return;
    }

    try {
      await unbanUser(ctx.userId, ctx.platform, ctx.sessionId, botUserId);
      res.json({ success: true });
    } catch (err) {
      console.error('[BotDatabaseController.unbanUser]', err);
      res.status(500).json({ error: 'Failed to unban user' });
    }
  }

  /**
   * DELETE /api/v1/bots/:id/database/groups/:groupId
   * Removes a group's session association with this bot.
   */
  async deleteGroup(req: Request, res: Response): Promise<void> {
    const ctx = await resolveSession(req, res);
    if (!ctx) return;

    const botThreadId = String(req.params.groupId ?? '');
    if (!botThreadId) {
      res.status(400).json({ error: 'Missing groupId' });
      return;
    }

    try {
      await db.query(
        `DELETE FROM bot_threads_session
         WHERE user_id = $1 AND platform_id = $2 AND session_id = $3 AND bot_thread_id = $4`,
        [ctx.userId, ctx.platformId, ctx.sessionId, botThreadId],
      );
      dbChangeEmitter.publish({
        key: sessionKey(ctx),
        type: 'group',
        action: 'delete',
        id: botThreadId,
      });
      res.json({ success: true });
    } catch (err) {
      console.error('[BotDatabaseController.deleteGroup]', err);
      res.status(500).json({ error: 'Failed to delete group' });
    }
  }

  /**
   * POST /api/v1/bots/:id/database/groups/:groupId/ban
   * Bans a group from this bot session.
   */
  async banGroup(req: Request, res: Response): Promise<void> {
    const ctx = await resolveSession(req, res);
    if (!ctx) return;

    const botThreadId = String(req.params.groupId ?? '');
    if (!botThreadId) {
      res.status(400).json({ error: 'Missing groupId' });
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const reason = typeof req.body?.reason === 'string' ? (req.body.reason as string) : undefined;

    try {
      await banThread(ctx.userId, ctx.platform, ctx.sessionId, botThreadId, reason);
      res.json({ success: true });
    } catch (err) {
      console.error('[BotDatabaseController.banGroup]', err);
      res.status(500).json({ error: 'Failed to ban group' });
    }
  }

  /**
   * DELETE /api/v1/bots/:id/database/groups/:groupId/ban
   * Lifts a group ban for this bot session.
   */
  async unbanGroup(req: Request, res: Response): Promise<void> {
    const ctx = await resolveSession(req, res);
    if (!ctx) return;

    const botThreadId = String(req.params.groupId ?? '');
    if (!botThreadId) {
      res.status(400).json({ error: 'Missing groupId' });
      return;
    }

    try {
      await unbanThread(ctx.userId, ctx.platform, ctx.sessionId, botThreadId);
      res.json({ success: true });
    } catch (err) {
      console.error('[BotDatabaseController.unbanGroup]', err);
      res.status(500).json({ error: 'Failed to unban group' });
    }
  }
}

export const botDatabaseController = new BotDatabaseController();
