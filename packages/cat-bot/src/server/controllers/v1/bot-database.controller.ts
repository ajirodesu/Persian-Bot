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
 * SQL: queries the active adapter directly (bypassing the engine repos' LRU
 * cache) to support the LIMIT / OFFSET / ILIKE search pattern the dashboard
 * needs. Written once in Postgres flavor and routed through dbQuery(), which
 * runs it as-is against neondb's pg.Pool or translates it to libSQL syntax
 * for turso — see database-query.lib.ts for why a single `pool` import can't
 * do this (pool is only defined when DATABASE_TYPE=neondb).
 */

import type { Request, Response } from 'express';
import { requireSession } from '@/server/validators/auth-session.validator.js';
import { botService } from '@/server/services/bot.service.js';
import { dbQuery } from '@/server/lib/database-query.lib.js';
import {
  banUser,
  unbanUser,
  banThread,
  unbanThread,
  banDiscordServer,
  unbanDiscordServer,
} from '@/engine/repos/banned.repo.js';
import { dbChangeEmitter } from '@/engine/lib/db-change-emitter.lib.js';
import { invalidateUserSessionCache } from '@/engine/repos/users.repo.js';
import { invalidateThreadSessionCache } from '@/engine/repos/threads.repo.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';

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

/** Status filter applied to the ban-state of a record. */
type StatusFilter = 'all' | 'active' | 'banned';

function parseStatusFilter(raw: unknown): StatusFilter {
  return raw === 'active' || raw === 'banned' ? raw : 'all';
}

/** Platform chat types that can carry a bot — used by the Telegram type filter. */
const CHAT_TYPES = ['group', 'supergroup', 'channel'] as const;

/** Resolves a client-facing chat-type filter to a stored bot_threads.type value, or null for "any". */
function parseTypeFilter(raw: unknown): string | null {
  const value = String(raw ?? '');
  return (CHAT_TYPES as readonly string[]).includes(value) ? value : null;
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
        dbQuery(
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
        dbQuery(
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
   *
   * Discord guilds are recorded in bot_discord_server_session (keyed by server id),
   * not bot_threads_session — so the query branches per platform. All other platforms
   * (Telegram, webchat) keep using the thread-session tables.
   *
   * Non-Discord sessions accept an optional `type` query param that filters by the
   * persisted platform chat type (e.g. Telegram 'group' | 'supergroup' | 'channel')
   * so the dashboard can show every entity type the bot lives in side by side.
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

    const isDiscord = ctx.platform === Platforms.Discord;

    // Discord server sessions carry no platform_id column — the session id itself
    // uniquely identifies the guild scope, so the ban key omits it.
    const banExpr = isDiscord
      ? 'COALESCE(bdsb.is_banned, FALSE)'
      : 'COALESCE(btsb.is_banned, FALSE)';
    const extraClause = statusClause(banExpr, status);
    const whereExtra = extraClause ? ` AND ${extraClause}` : '';

    // Non-Discord platforms persist a platform chat type (Telegram group/supergroup/
    // channel) on bot_threads.type — filter on it when requested. The param is always
    // bound (null = no filter) so LIMIT/OFFSET keep fixed placeholder indices instead
    // of colliding with $5 when a type is supplied.
    const typeFilter = isDiscord ? null : parseTypeFilter(req.query.type);
    const typeSql = isDiscord ? '' : ' AND ($5 IS NULL OR bt.type = $5)';

    const sortColumn = resolveSortColumn(
      req.query.sortBy,
      isDiscord
        ? { name: 'bds.name', last_seen: 'bdss.last_updated_at' }
        : { name: 'bt.name', last_seen: 'bts.last_updated_at' },
      isDiscord ? 'bdss.last_updated_at' : 'bts.last_updated_at',
    );
    const sortDir = parseSortDir(req.query.sortDir);

    try {
      const [rowsResult, countResult] = await Promise.all([
        isDiscord
          ? dbQuery(
              `SELECT
                 bds.id,
                 bds.name,
                 CAST(1 AS BOOLEAN) AS is_group,
                 NULL AS type,
                 bds.member_count,
                 bds.avatar_url,
                 bdss.last_updated_at AS last_seen,
                 COALESCE(bdsb.is_banned, FALSE) AS is_banned,
                 bdsb.reason AS ban_reason
               FROM bot_discord_server_session bdss
               JOIN bot_discord_server bds ON bds.id = bdss.bot_server_id
               LEFT JOIN bot_discord_server_session_banned bdsb
                 ON bdsb.user_id      = bdss.user_id
                AND bdsb.session_id   = bdss.session_id
                AND bdsb.bot_server_id = bdss.bot_server_id
               WHERE bdss.user_id     = $1
                 AND bdss.session_id  = $2
                 AND (bds.name ILIKE $3 OR bds.id ILIKE $3)${whereExtra}
               ORDER BY ${sortColumn} ${sortDir} NULLS LAST, bdss.last_updated_at DESC NULLS LAST
               LIMIT $4 OFFSET $5`,
              [ctx.userId, ctx.sessionId, searchParam, limit, offset],
            )
          : dbQuery(
              `SELECT
                 bt.id,
                 bt.name,
                 bt.is_group,
                 bt.type,
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
                 AND (bt.name ILIKE $4 OR bt.id ILIKE $4)${whereExtra}${typeSql}
               ORDER BY ${sortColumn} ${sortDir} NULLS LAST, bts.last_updated_at DESC NULLS LAST
               LIMIT $6 OFFSET $7`,
              [ctx.userId, ctx.platformId, ctx.sessionId, searchParam, typeFilter, limit, offset],
            ),
        isDiscord
          ? dbQuery(
              `SELECT COUNT(*) AS count
               FROM bot_discord_server_session bdss
               JOIN bot_discord_server bds ON bds.id = bdss.bot_server_id
               LEFT JOIN bot_discord_server_session_banned bdsb
                 ON bdsb.user_id      = bdss.user_id
                AND bdsb.session_id   = bdss.session_id
                AND bdsb.bot_server_id = bdss.bot_server_id
               WHERE bdss.user_id     = $1
                 AND bdss.session_id  = $2
                 AND (bds.name ILIKE $3 OR bds.id ILIKE $3)${whereExtra}`,
              [ctx.userId, ctx.sessionId, searchParam],
            )
          : dbQuery(
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
                 AND (bt.name ILIKE $4 OR bt.id ILIKE $4)${whereExtra}${typeSql}`,
              [ctx.userId, ctx.platformId, ctx.sessionId, searchParam, typeFilter],
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
   * GET /api/v1/bots/:id/database/servers
   * Returns every Discord server (guild) this bot session has recorded — the
   * source for the Groups tab's server dropdown. Discord only.
   */
  async listServers(req: Request, res: Response): Promise<void> {
    const ctx = await resolveSession(req, res);
    if (!ctx) return;

    if (ctx.platform !== Platforms.Discord) {
      res.status(400).json({ error: 'Only Discord sessions support servers' });
      return;
    }

    try {
      const rowsResult = await dbQuery(
        `SELECT
           bds.id,
           bds.name,
           CAST(1 AS BOOLEAN) AS is_group,
           NULL AS type,
           bds.member_count,
           bds.avatar_url,
           bdss.last_updated_at AS last_seen,
           COALESCE(bdsb.is_banned, FALSE) AS is_banned,
           bdsb.reason AS ban_reason
         FROM bot_discord_server_session bdss
         JOIN bot_discord_server bds ON bds.id = bdss.bot_server_id
         LEFT JOIN bot_discord_server_session_banned bdsb
           ON bdsb.user_id       = bdss.user_id
          AND bdsb.session_id    = bdss.session_id
          AND bdsb.bot_server_id = bdss.bot_server_id
         WHERE bdss.user_id = $1 AND bdss.session_id = $2
         ORDER BY bds.name ASC NULLS LAST, bdss.last_updated_at DESC NULLS LAST`,
        [ctx.userId, ctx.sessionId],
      );

      res.json({
        servers: rowsResult.rows,
        total: rowsResult.rows.length,
      });
    } catch (err) {
      console.error('[BotDatabaseController.listServers]', err);
      res.status(500).json({ error: 'Failed to fetch servers' });
    }
  }

  /**
   * GET /api/v1/bots/:id/database/channels
   * Returns the channels belonging to ONE Discord server. The server must be
   * recorded against this bot session (bot_discord_server_session join), and
   * channels are filtered by their parent server_id — so a channel can never
   * appear outside its associated server context. Discord only.
   */
  async listChannels(req: Request, res: Response): Promise<void> {
    const ctx = await resolveSession(req, res);
    if (!ctx) return;

    if (ctx.platform !== Platforms.Discord) {
      res.status(400).json({ error: 'Only Discord sessions support channels' });
      return;
    }

    const serverId = String(req.query.serverId ?? '');
    if (!serverId) {
      res.status(400).json({ error: 'Missing serverId' });
      return;
    }

    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10));
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10)));
    const search = String(req.query.search ?? '').trim();
    const offset = (page - 1) * limit;
    const searchParam = search ? `%${search}%` : '%';

    try {
      const [rowsResult, countResult] = await Promise.all([
        dbQuery(
          `SELECT
             bdc.thread_id AS id,
             bdc.name,
             bdc.type,
             bdc.server_id,
             COALESCE(bdsb.is_banned, FALSE) AS is_banned,
             bdsb.reason AS ban_reason
           FROM bot_discord_channel bdc
           JOIN bot_discord_server_session bdss
             ON bdss.user_id = $1 AND bdss.session_id = $2 AND bdss.bot_server_id = bdc.server_id
           LEFT JOIN bot_discord_server_session_banned bdsb
             ON bdsb.user_id = $1 AND bdsb.session_id = $2 AND bdsb.bot_server_id = bdc.server_id
           WHERE bdc.server_id = $3
             AND (COALESCE(bdc.name, '') ILIKE $4 OR bdc.thread_id ILIKE $4)
           ORDER BY bdc.name ASC NULLS LAST
           LIMIT $5 OFFSET $6`,
          [ctx.userId, ctx.sessionId, serverId, searchParam, limit, offset],
        ),
        dbQuery(
          `SELECT COUNT(*) AS count
           FROM bot_discord_channel bdc
           JOIN bot_discord_server_session bdss
             ON bdss.user_id = $1 AND bdss.session_id = $2 AND bdss.bot_server_id = bdc.server_id
           WHERE bdc.server_id = $3
             AND (COALESCE(bdc.name, '') ILIKE $4 OR bdc.thread_id ILIKE $4)`,
          [ctx.userId, ctx.sessionId, serverId, searchParam],
        ),
      ]);

      const total = parseInt(String(countResult.rows[0]?.count ?? '0'), 10);

      res.json({
        channels: rowsResult.rows,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      });
    } catch (err) {
      console.error('[BotDatabaseController.listChannels]', err);
      res.status(500).json({ error: 'Failed to fetch channels' });
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
      await dbQuery(
        `DELETE FROM bot_users_session
         WHERE user_id = $1 AND platform_id = $2 AND session_id = $3 AND bot_user_id = $4`,
        [ctx.userId, ctx.platformId, ctx.sessionId, botUserId],
      );
      // The delete bypassed the repo layer, so the engine's LRU cache still holds
      // the stale sessionExists/updatedAt entries. Without eviction the next DM
      // from this user would be treated as "recently synced" and syncUser would
      // never re-run — the session row would never be recreated and the user
      // would stay invisible in the dashboard until the 15-min cache TTL expires.
      invalidateUserSessionCache(
        ctx.userId,
        ctx.platform,
        ctx.sessionId,
        botUserId,
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
   *
   * For Discord the group id is a server (guild) id, so the session link is removed
   * from bot_discord_server_session instead of bot_threads_session.
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
      if (ctx.platform === Platforms.Discord) {
        await dbQuery(
          `DELETE FROM bot_discord_server_session
           WHERE user_id = $1 AND session_id = $2 AND bot_server_id = $3`,
          [ctx.userId, ctx.sessionId, botThreadId],
        );
      } else {
        await dbQuery(
          `DELETE FROM bot_threads_session
           WHERE user_id = $1 AND platform_id = $2 AND session_id = $3 AND bot_thread_id = $4`,
          [ctx.userId, ctx.platformId, ctx.sessionId, botThreadId],
        );
      }
      // Same rationale as deleteUser: the raw delete bypassed the repo layer, so
      // evict the engine LRU cache to force a fresh DB read on the next message —
      // otherwise the group's stale cached timestamp suppresses the re-sync and
      // the session row is never recreated.
      invalidateThreadSessionCache(
        ctx.userId,
        ctx.platform,
        ctx.sessionId,
        botThreadId,
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
   * Bans a group from this bot session. Discord groups are keyed by server id.
   */
  async banGroup(req: Request, res: Response): Promise<void> {
    const ctx = await resolveSession(req, res);
    if (!ctx) return;

    const botThreadId = String(req.params.groupId ?? '');
    if (!botThreadId) {
      res.status(400).json({ error: 'Missing groupId' });
      return;
    }

     
    const reason = typeof req.body?.reason === 'string' ? (req.body.reason as string) : undefined;

    try {
      if (ctx.platform === Platforms.Discord) {
        await banDiscordServer(ctx.userId, ctx.sessionId, botThreadId, reason);
      } else {
        await banThread(ctx.userId, ctx.platform, ctx.sessionId, botThreadId, reason);
      }
      res.json({ success: true });
    } catch (err) {
      console.error('[BotDatabaseController.banGroup]', err);
      res.status(500).json({ error: 'Failed to ban group' });
    }
  }

  /**
   * DELETE /api/v1/bots/:id/database/groups/:groupId/ban
   * Lifts a group ban for this bot session. Discord groups are keyed by server id.
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
      if (ctx.platform === Platforms.Discord) {
        await unbanDiscordServer(ctx.userId, ctx.sessionId, botThreadId);
      } else {
        await unbanThread(ctx.userId, ctx.platform, ctx.sessionId, botThreadId);
      }
      res.json({ success: true });
    } catch (err) {
      console.error('[BotDatabaseController.unbanGroup]', err);
      res.status(500).json({ error: 'Failed to unban group' });
    }
  }
}

export const botDatabaseController = new BotDatabaseController();
