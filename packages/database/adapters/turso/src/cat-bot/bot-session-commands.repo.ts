import { tursoClient, intToBool } from '../client.js';
import { toPlatformNumericId } from '@cat-bot/engine/modules/platform/platform-id.util.js';

export async function upsertSessionCommands(
  userId: string,
  platform: string,
  sessionId: string,
  commandNames: string[],
): Promise<void> {
  if (!commandNames.length) return;
  const platformId = toPlatformNumericId(platform);
  // Build a multi-row VALUES list for a single INSERT statement.
  //
  // userId/platformId/sessionId are shared named params reused across every row —
  // libSQL (like Postgres) binds the same named parameter to the same value everywhere
  // it appears. Each command gets its own uniquely-named `:cmdN` slot.
  //
  // Single-statement equivalent of a find-then-createMany approach.
  // ON CONFLICT DO NOTHING preserves existing is_enable=0 rows (admin-disabled
  // commands are never overwritten — the skip is intentional, not a lost update).
  const values = commandNames
    .map((_, i) => `(:userId, :platformId, :sessionId, :cmd${i}, 1)`)
    .join(', ');
  const args: Record<string, string | number> = {
    userId,
    platformId,
    sessionId,
  };
  commandNames.forEach((name, i) => {
    args[`cmd${i}`] = name;
  });
  await tursoClient.execute({
    sql: `INSERT INTO bot_session_commands (user_id, platform_id, session_id, command_name, is_enable)
          VALUES ${values}
          ON CONFLICT (user_id, platform_id, session_id, command_name) DO NOTHING`,
    args,
  });
}

export async function findSessionCommands(
  userId: string,
  platform: string,
  sessionId: string,
): Promise<Array<{ commandName: string; isEnable: boolean }>> {
  const platformId = toPlatformNumericId(platform);
  const res = await tursoClient.execute({
    sql: `SELECT command_name, is_enable FROM bot_session_commands
          WHERE user_id = :userId AND platform_id = :platformId AND session_id = :sessionId
          ORDER BY command_name`,
    args: { userId, platformId, sessionId },
  });
  return (
    res.rows as unknown as Array<{
      command_name: string;
      is_enable: number;
    }>
  ).map((r) => ({
    commandName: r.command_name,
    isEnable: intToBool(r.is_enable),
  }));
}

export async function setCommandEnabled(
  userId: string,
  platform: string,
  sessionId: string,
  commandName: string,
  isEnable: boolean,
): Promise<void> {
  const platformId = toPlatformNumericId(platform);
  await tursoClient.execute({
    sql: `INSERT INTO bot_session_commands (user_id, platform_id, session_id, command_name, is_enable)
          VALUES (:userId, :platformId, :sessionId, :commandName, :isEnable)
          ON CONFLICT (user_id, platform_id, session_id, command_name)
          DO UPDATE SET is_enable = excluded.is_enable`,
    args: {
      userId,
      platformId,
      sessionId,
      commandName,
      isEnable: isEnable ? 1 : 0,
    },
  });
}

export async function isCommandEnabled(
  userId: string,
  platform: string,
  sessionId: string,
  commandName: string,
): Promise<boolean> {
  try {
    const platformId = toPlatformNumericId(platform);
    const res = await tursoClient.execute({
      sql: `SELECT is_enable FROM bot_session_commands
            WHERE user_id = :userId AND platform_id = :platformId AND session_id = :sessionId AND command_name = :commandName`,
      args: { userId, platformId, sessionId, commandName },
    });
    const row = res.rows[0] as { is_enable: number } | undefined;
    // Absent row = enabled — fail-open so a missing DB entry never silently disables commands.
    return row ? intToBool(row.is_enable) : true;
  } catch {
    return true;
  }
}
