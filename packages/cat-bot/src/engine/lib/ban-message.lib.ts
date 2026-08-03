/**
 * Ban Message — formats the notice shown to a banned user/thread when they
 * try to use the bot (see enforceNotBanned in on-command.middleware.ts).
 *
 * Timestamps are rendered in the timezone of the dashboard account that owns
 * the bot session (their Settings → Timezone preference), not a fixed
 * server-wide value. Callers pass the resolved IANA identifier in; an
 * invalid/unset value falls back to UTC rather than throwing, so a bad value
 * never breaks ban enforcement itself.
 */

const DEFAULT_TIMEZONE = 'UTC';

/** Validates an IANA timezone identifier by probing Intl — throws on garbage input. */
function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Formats `date` as e.g. "July 22, 2026 • 09:41 AM" in the given timezone. */
function formatTimestamp(date: Date, timeZone: string | null | undefined): string {
  const resolvedTimeZone = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIMEZONE;
  const datePart = new Intl.DateTimeFormat('en-US', {
    timeZone: resolvedTimeZone,
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
  const timePart = new Intl.DateTimeFormat('en-US', {
    timeZone: resolvedTimeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
  return `${datePart} • ${timePart}`;
}

const DEFAULT_REASON = 'No reason provided';

/** Builds the ban notice shown to an individually-banned user. */
export function formatUserBanMessage(params: {
  reason: string | null;
  userId: string;
  timezone?: string | null;
  now?: Date;
}): string {
  const { reason, userId, timezone, now = new Date() } = params;
  return (
    `🚫 Access Restricted\n\n` +
    `Your access to this bot has been suspended.\n\n` +
    `📝 Reason: ${reason?.trim() || DEFAULT_REASON}\n` +
    `⏰ Time: ${formatTimestamp(now, timezone)}\n` +
    `🆔 User ID: ${userId}`
  );
}

/** Builds the ban notice shown in a banned group/thread. */
export function formatGroupBanMessage(params: {
  reason: string | null;
  threadId: string;
  timezone?: string | null;
  now?: Date;
}): string {
  const { reason, threadId, timezone, now = new Date() } = params;
  return (
    `🚫 Group Access Restricted\n\n` +
    `This group has been suspended from using this bot.\n\n` +
    `📝 Reason: ${reason?.trim() || DEFAULT_REASON}\n` +
    `⏰ Time: ${formatTimestamp(now, timezone)}\n` +
    `🧵 Thread ID: ${threadId}\n\n` +
    `ℹ️ Note: If you believe this is a mistake, please contact the bot administrator.`
  );
}
