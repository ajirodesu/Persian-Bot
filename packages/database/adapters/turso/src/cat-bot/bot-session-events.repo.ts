import { tursoClient, intToBool } from '../client.js';
import { toPlatformNumericId } from '@cat-bot/engine/modules/platform/platform-id.util.js';

export async function upsertSessionEvents(
  userId: string,
  platform: string,
  sessionId: string,
  eventNames: string[],
): Promise<void> {
  if (!eventNames.length) return;
  const platformId = toPlatformNumericId(platform);
  // Same named-param reuse pattern as bot-session-commands: userId/platformId/sessionId
  // are shared constants across all rows; each eventName gets its own uniquely-named
  // `:evtN` slot. ON CONFLICT DO NOTHING preserves admin-set is_enable=0 rows (same
  // intent as a find-then-createMany approach, in a single DB round trip).
  const values = eventNames
    .map((_, i) => `(:userId, :platformId, :sessionId, :evt${i}, 1)`)
    .join(', ');
  const args: Record<string, string | number> = {
    userId,
    platformId,
    sessionId,
  };
  eventNames.forEach((name, i) => {
    args[`evt${i}`] = name;
  });
  await tursoClient.execute({
    sql: `INSERT INTO bot_session_events (user_id, platform_id, session_id, event_name, is_enable)
          VALUES ${values}
          ON CONFLICT (user_id, platform_id, session_id, event_name) DO NOTHING`,
    args,
  });
}

export async function findSessionEvents(
  userId: string,
  platform: string,
  sessionId: string,
): Promise<Array<{ eventName: string; isEnable: boolean }>> {
  const platformId = toPlatformNumericId(platform);
  const res = await tursoClient.execute({
    sql: `SELECT event_name, is_enable FROM bot_session_events
          WHERE user_id = :userId AND platform_id = :platformId AND session_id = :sessionId
          ORDER BY event_name`,
    args: { userId, platformId, sessionId },
  });
  return (
    res.rows as unknown as Array<{ event_name: string; is_enable: number }>
  ).map((r) => ({
    eventName: r.event_name,
    isEnable: intToBool(r.is_enable),
  }));
}

export async function setEventEnabled(
  userId: string,
  platform: string,
  sessionId: string,
  eventName: string,
  isEnable: boolean,
): Promise<void> {
  const platformId = toPlatformNumericId(platform);
  await tursoClient.execute({
    sql: `INSERT INTO bot_session_events (user_id, platform_id, session_id, event_name, is_enable)
          VALUES (:userId, :platformId, :sessionId, :eventName, :isEnable)
          ON CONFLICT (user_id, platform_id, session_id, event_name)
          DO UPDATE SET is_enable = excluded.is_enable`,
    args: {
      userId,
      platformId,
      sessionId,
      eventName,
      isEnable: isEnable ? 1 : 0,
    },
  });
}

export async function isEventEnabled(
  userId: string,
  platform: string,
  sessionId: string,
  eventName: string,
): Promise<boolean> {
  try {
    const platformId = toPlatformNumericId(platform);
    const res = await tursoClient.execute({
      sql: `SELECT is_enable FROM bot_session_events
            WHERE user_id = :userId AND platform_id = :platformId AND session_id = :sessionId AND event_name = :eventName`,
      args: { userId, platformId, sessionId, eventName },
    });
    const row = res.rows[0] as { is_enable: number } | undefined;
    return row ? intToBool(row.is_enable) : true;
  } catch {
    return true;
  }
}
