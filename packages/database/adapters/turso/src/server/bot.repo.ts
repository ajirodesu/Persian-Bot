import { tursoClient, intToBool } from '../client.js';
import {
  PLATFORM_TO_ID,
  ID_TO_PLATFORM,
  Platforms,
} from '@cat-bot/engine/modules/platform/platform.constants.js';
import type {
  CreateBotRequestDto,
  CreateBotResponseDto,
  GetBotListResponseDto,
  GetBotDetailResponseDto,
  UpdateBotRequestDto,
} from '@cat-bot/server/dtos/bot.dto.js';
import type { GetAdminBotListResponseDto } from '@cat-bot/server/dtos/admin.dto.js';
import { encrypt, decrypt } from '@cat-bot/engine/utils/crypto.util.js';

export class BotRepo {
  async create(
    userId: string,
    sessionId: string,
    dto: CreateBotRequestDto,
  ): Promise<CreateBotResponseDto> {
    const platformId = (PLATFORM_TO_ID as Record<string, number>)[
      dto.credentials.platform
    ];
    if (platformId === undefined)
      throw new Error(`Unknown platform ${dto.credentials.platform}`);

    const tx = await tursoClient.transaction('write');
    try {
      // is_running defaults to 1 via column default.
      await tx.execute({
        sql: `INSERT INTO bot_session (user_id, platform_id, session_id, nickname, prefix)
              VALUES (:userId, :platformId, :sessionId, :nickname, :prefix)`,
        args: {
          userId,
          platformId,
          sessionId,
          nickname: dto.botNickname,
          prefix: dto.botPrefix,
        },
      });

      for (const adminId of dto.botAdmins) {
        await tx.execute({
          sql: `INSERT INTO bot_admin (user_id, platform_id, session_id, admin_id) VALUES (:userId, :platformId, :sessionId, :adminId)`,
          args: { userId, platformId, sessionId, adminId },
        });
      }
      // Premium rows are optional on input; ?? [] guards callers that omit the field.
      for (const premiumId of dto.botPremiums ?? []) {
        await tx.execute({
          sql: `INSERT INTO bot_premium (user_id, platform_id, session_id, premium_id) VALUES (:userId, :platformId, :sessionId, :premiumId)`,
          args: { userId, platformId, sessionId, premiumId },
        });
      }

      const { credentials } = dto;
      if (credentials.platform === Platforms.Discord) {
        await tx.execute({
          sql: `INSERT INTO bot_credential_discord (user_id, platform_id, session_id, discord_token, discord_client_id)
                VALUES (:userId, :platformId, :sessionId, :discordToken, :discordClientId)`,
          args: {
            userId,
            platformId,
            sessionId,
            discordToken: encrypt(credentials.discordToken),
            discordClientId: credentials.discordClientId,
          },
        });
      } else if (credentials.platform === Platforms.Telegram) {
        await tx.execute({
          sql: `INSERT INTO bot_credential_telegram (user_id, platform_id, session_id, telegram_token)
                VALUES (:userId, :platformId, :sessionId, :telegramToken)`,
          args: {
            userId,
            platformId,
            sessionId,
            telegramToken: encrypt(credentials.telegramToken),
          },
        });
      } else {
        throw new Error(`Unknown platform: ${JSON.stringify(credentials)}`);
      }

      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }

    return {
      sessionId,
      userId,
      platformId,
      nickname: dto.botNickname,
      prefix: dto.botPrefix,
    };
  }

  async getById(
    userId: string,
    sessionId: string,
  ): Promise<GetBotDetailResponseDto | null> {
    const sessionRes = await tursoClient.execute({
      sql: `SELECT platform_id, nickname, prefix FROM bot_session
            WHERE user_id = :userId AND session_id = :sessionId LIMIT 1`,
      args: { userId, sessionId },
    });
    const sess = sessionRes.rows[0] as
      | { platform_id: number; nickname: string | null; prefix: string | null }
      | undefined;
    if (!sess) return null;

    const platform = (ID_TO_PLATFORM as Record<number, string>)[
      sess.platform_id
    ];
    if (!platform) return null;

    const adminsRes = await tursoClient.execute({
      sql: `SELECT admin_id FROM bot_admin WHERE user_id = :userId AND session_id = :sessionId ORDER BY admin_id`,
      args: { userId, sessionId },
    });
    const premiumsRes = await tursoClient.execute({
      sql: `SELECT premium_id FROM bot_premium WHERE user_id = :userId AND session_id = :sessionId ORDER BY premium_id`,
      args: { userId, sessionId },
    });

    let credentials: GetBotDetailResponseDto['credentials'];

    if (platform === Platforms.Discord) {
      const credRes = await tursoClient.execute({
        sql: `SELECT discord_token, discord_client_id FROM bot_credential_discord
              WHERE user_id = :userId AND session_id = :sessionId LIMIT 1`,
        args: { userId, sessionId },
      });
      const credRow = credRes.rows[0] as
        | { discord_token: string; discord_client_id: string }
        | undefined;
      if (!credRow) throw new Error('Missing credentials');
      credentials = {
        platform: Platforms.Discord,
        discordToken: decrypt(credRow.discord_token),
        discordClientId: credRow.discord_client_id,
      };
    } else if (platform === Platforms.Telegram) {
      const credRes = await tursoClient.execute({
        sql: `SELECT telegram_token FROM bot_credential_telegram
              WHERE user_id = :userId AND session_id = :sessionId LIMIT 1`,
        args: { userId, sessionId },
      });
      const credRow = credRes.rows[0] as { telegram_token: string } | undefined;
      if (!credRow) throw new Error('Missing credentials');
      credentials = {
        platform: Platforms.Telegram,
        telegramToken: decrypt(credRow.telegram_token),
      };
    } else {
      throw new Error(`Unknown platform ${platform}`);
    }

    return {
      sessionId,
      userId,
      platformId: sess.platform_id,
      platform,
      nickname: sess.nickname ?? '',
      prefix: sess.prefix ?? '',
      admins: (adminsRes.rows as unknown as Array<{ admin_id: string }>).map(
        (r) => r.admin_id,
      ),
      premiums: (
        premiumsRes.rows as unknown as Array<{ premium_id: string }>
      ).map((r) => r.premium_id),
      credentials,
    };
  }

  async update(
    userId: string,
    sessionId: string,
    dto: UpdateBotRequestDto,
    isCredentialsModified = false,
  ): Promise<void> {
    const platformId = (PLATFORM_TO_ID as Record<string, number>)[
      dto.credentials.platform
    ];

    const sessionRes = await tursoClient.execute({
      sql: `SELECT platform_id FROM bot_session WHERE user_id = :userId AND session_id = :sessionId LIMIT 1`,
      args: { userId, sessionId },
    });
    const sessRow = sessionRes.rows[0] as { platform_id: number } | undefined;
    if (!sessRow) throw new Error('Bot not found');
    // Guard: platform is immutable after creation — changing it would corrupt credential FKs.
    if (sessRow.platform_id !== platformId)
      throw new Error('Platform cannot be changed after bot creation.');

    const tx = await tursoClient.transaction('write');
    try {
      await tx.execute({
        sql: `UPDATE bot_session SET nickname = :nickname, prefix = :prefix
              WHERE user_id = :userId AND platform_id = :platformId AND session_id = :sessionId`,
        args: {
          userId,
          platformId,
          sessionId,
          nickname: dto.botNickname,
          prefix: dto.botPrefix,
        },
      });

      // Full admin list replacement — delete all then re-insert the full set.
      await tx.execute({
        sql: `DELETE FROM bot_admin WHERE user_id = :userId AND platform_id = :platformId AND session_id = :sessionId`,
        args: { userId, platformId, sessionId },
      });
      for (const adminId of dto.botAdmins) {
        await tx.execute({
          sql: `INSERT INTO bot_admin (user_id, platform_id, session_id, admin_id) VALUES (:userId, :platformId, :sessionId, :adminId)`,
          args: { userId, platformId, sessionId, adminId },
        });
      }

      // Full premium list replacement — delete all then re-insert mirrors the admin pattern.
      await tx.execute({
        sql: `DELETE FROM bot_premium WHERE user_id = :userId AND platform_id = :platformId AND session_id = :sessionId`,
        args: { userId, platformId, sessionId },
      });
      for (const premiumId of dto.botPremiums ?? []) {
        await tx.execute({
          sql: `INSERT INTO bot_premium (user_id, platform_id, session_id, premium_id) VALUES (:userId, :platformId, :sessionId, :premiumId)`,
          args: { userId, platformId, sessionId, premiumId },
        });
      }

      const { credentials } = dto;
      if (credentials.platform === Platforms.Discord) {
        const extra = isCredentialsModified
          ? ', is_command_register = 0, command_hash = NULL'
          : '';
        await tx.execute({
          sql: `UPDATE bot_credential_discord
                SET discord_token = :discordToken, discord_client_id = :discordClientId${extra}
                WHERE user_id = :userId AND platform_id = :platformId AND session_id = :sessionId`,
          args: {
            userId,
            platformId,
            sessionId,
            discordToken: encrypt(credentials.discordToken),
            discordClientId: credentials.discordClientId,
          },
        });
      } else if (credentials.platform === Platforms.Telegram) {
        const extra = isCredentialsModified
          ? ', is_command_register = 0, command_hash = NULL'
          : '';
        await tx.execute({
          sql: `UPDATE bot_credential_telegram
                SET telegram_token = :telegramToken${extra}
                WHERE user_id = :userId AND platform_id = :platformId AND session_id = :sessionId`,
          args: {
            userId,
            platformId,
            sessionId,
            telegramToken: encrypt(credentials.telegramToken),
          },
        });
      } else {
        throw new Error(`Unknown platform: ${JSON.stringify(credentials)}`);
      }

      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  }

  async list(userId: string): Promise<GetBotListResponseDto> {
    const res = await tursoClient.execute({
      sql: `SELECT session_id, platform_id, nickname, prefix FROM bot_session WHERE user_id = :userId`,
      args: { userId },
    });
    return {
      bots: (
        res.rows as unknown as Array<{
          session_id: string;
          platform_id: number;
          nickname: string | null;
          prefix: string | null;
        }>
      ).map((r) => ({
        sessionId: r.session_id,
        platformId: r.platform_id,
        platform:
          (ID_TO_PLATFORM as Record<number, string>)[r.platform_id] ?? '',
        nickname: r.nickname ?? '',
        prefix: r.prefix ?? '',
      })),
    };
  }

  async updateIsRunning(
    userId: string,
    sessionId: string,
    isRunning: boolean,
  ): Promise<void> {
    await tursoClient.execute({
      sql: `UPDATE bot_session SET is_running = :isRunning WHERE user_id = :userId AND session_id = :sessionId`,
      args: { userId, sessionId, isRunning: isRunning ? 1 : 0 },
    });
  }

  async getPlatformId(
    userId: string,
    sessionId: string,
  ): Promise<number | null> {
    const res = await tursoClient.execute({
      sql: `SELECT platform_id FROM bot_session WHERE user_id = :userId AND session_id = :sessionId LIMIT 1`,
      args: { userId, sessionId },
    });
    const row = res.rows[0] as { platform_id: number } | undefined;
    return row?.platform_id ?? null;
  }

  // Returns every bot session regardless of owner — admin-only view.
  async listAll(
    search: string = '',
    page: number = 1,
    limit: number = 10,
  ): Promise<GetAdminBotListResponseDto> {
    const offset = (page - 1) * limit;
    let whereClause = '';
    const queryArgs: Record<string, string | number> = {};

    if (search) {
      const searchPattern = `%${search}%`;
      queryArgs['search'] = searchPattern;

      const platformIdMatches: number[] = [];
      for (const [idStr, platStr] of Object.entries(ID_TO_PLATFORM)) {
        if ((platStr as string).toLowerCase().includes(search.toLowerCase())) {
          platformIdMatches.push(parseInt(idStr, 10));
        }
      }

      // SQLite's LIKE is case-insensitive for ASCII by default, matching Postgres ILIKE semantics here.
      whereClause = `WHERE bs.nickname LIKE :search OR u.name LIKE :search OR u.email LIKE :search`;
      if (platformIdMatches.length > 0) {
        whereClause += ` OR bs.platform_id IN (${platformIdMatches.join(',')})`;
      }
    }

    const countRes = await tursoClient.execute({
      sql: `
      SELECT COUNT(*) as count
      FROM bot_session bs
      LEFT JOIN "user" u ON u.id = bs.user_id
      ${whereClause}
    `,
      args: queryArgs,
    });

    const res = await tursoClient.execute({
      sql: `
      SELECT bs.user_id, bs.session_id, bs.platform_id, bs.nickname, bs.prefix, bs.is_running,
             u.name AS user_name,
             u.email AS user_email
      FROM bot_session bs
      LEFT JOIN "user" u ON u.id = bs.user_id
      ${whereClause}
      ORDER BY bs.user_id
      LIMIT :limit OFFSET :offset
    `,
      args: { ...queryArgs, limit, offset },
    });

    const statsRes = await tursoClient.execute(`
      SELECT platform_id,
             COUNT(*) as total,
             COUNT(*) FILTER (WHERE is_running = 1) as active
      FROM bot_session
      GROUP BY platform_id
    `);

    const total = Number(
      (countRes.rows[0] as { count: number | bigint } | undefined)?.count ??
        0,
    );

    let totalBots = 0;
    let activeBots = 0;
    const platformDist: Record<string, number> = {};
    const platformActiveDist: Record<string, number> = {};

    for (const b of statsRes.rows as unknown as Array<{
      platform_id: number;
      total: number | bigint;
      active: number | bigint;
    }>) {
      const platStr =
        (ID_TO_PLATFORM as Record<number, string>)[b.platform_id] ?? '';
      const t = Number(b.total);
      const a = Number(b.active);
      platformDist[platStr] = t;
      if (a > 0) platformActiveDist[platStr] = a;
      totalBots += t;
      activeBots += a;
    }

    return {
      bots: (
        res.rows as unknown as Array<{
          user_id: string;
          session_id: string;
          platform_id: number;
          nickname: string | null;
          prefix: string | null;
          is_running: number;
          user_name: string | null;
          user_email: string | null;
        }>
      ).map((r) => ({
        sessionId: r.session_id,
        userId: r.user_id,
        platformId: r.platform_id,
        platform:
          (ID_TO_PLATFORM as Record<number, string>)[r.platform_id] ?? '',
        nickname: r.nickname ?? '',
        prefix: r.prefix ?? '',
        isRunning: intToBool(r.is_running),
        userName: r.user_name ?? undefined,
        userEmail: r.user_email ?? undefined,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      stats: { totalBots, activeBots, platformDist, platformActiveDist },
    };
  }

  /**
   * Permanently removes every DB record tied to this bot session.
   * All deletes run inside a single transaction so a crash mid-way leaves no orphan rows.
   * Table names match the Turso/libSQL schema in client.ts initDb().
   */
  async deleteById(userId: string, sessionId: string): Promise<void> {
    const tx = await tursoClient.transaction('write');
    try {
      // Child rows with no FK dependency on bot_session — delete first.
      await tx.execute({
        sql: `DELETE FROM bot_session_commands WHERE user_id = :userId AND session_id = :sessionId`,
        args: { userId, sessionId },
      });
      await tx.execute({
        sql: `DELETE FROM bot_session_events WHERE user_id = :userId AND session_id = :sessionId`,
        args: { userId, sessionId },
      });
      await tx.execute({
        sql: `DELETE FROM bot_users_session_banned WHERE user_id = :userId AND session_id = :sessionId`,
        args: { userId, sessionId },
      });
      await tx.execute({
        sql: `DELETE FROM bot_threads_session_banned WHERE user_id = :userId AND session_id = :sessionId`,
        args: { userId, sessionId },
      });
      // Session tracking join tables — FK is to bot_users/bot_threads, not bot_session.
      await tx.execute({
        sql: `DELETE FROM bot_users_session WHERE user_id = :userId AND session_id = :sessionId`,
        args: { userId, sessionId },
      });
      await tx.execute({
        sql: `DELETE FROM bot_threads_session WHERE user_id = :userId AND session_id = :sessionId`,
        args: { userId, sessionId },
      });
      // Identity and credential rows.
      await tx.execute({
        sql: `DELETE FROM bot_admin WHERE user_id = :userId AND session_id = :sessionId`,
        args: { userId, sessionId },
      });
      await tx.execute({
        sql: `DELETE FROM bot_premium WHERE user_id = :userId AND session_id = :sessionId`,
        args: { userId, sessionId },
      });
      await tx.execute({
        sql: `DELETE FROM bot_credential_discord WHERE user_id = :userId AND session_id = :sessionId`,
        args: { userId, sessionId },
      });
      await tx.execute({
        sql: `DELETE FROM bot_credential_telegram WHERE user_id = :userId AND session_id = :sessionId`,
        args: { userId, sessionId },
      });
      // Parent session row last.
      await tx.execute({
        sql: `DELETE FROM bot_session WHERE user_id = :userId AND session_id = :sessionId`,
        args: { userId, sessionId },
      });
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  }
}

export const botRepo = new BotRepo();
