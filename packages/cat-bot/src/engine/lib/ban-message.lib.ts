/**
 * Ban Message — formats the notice shown to a banned user/thread when they
 * try to use the bot (see enforceNotBanned in on-command.middleware.ts).
 *
 * Timestamps are rendered in env.TIMEZONE (an IANA identifier, e.g.
 * "Asia/Manila" — the default when TIMEZONE is unset). An invalid TIMEZONE
 * value falls back to Asia/Manila rather than throwing, so a typo in the
 * environment never breaks ban enforcement itself.
 */
import { env } from '@/engine/config/env.config.js';

const DEFAULT_TIMEZONE = 'Asia/Manila';

/** Validates an IANA timezone identifier by probing Intl — throws on garbage input. */
function isValidTimeZone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const resolvedTimeZone = isValidTimeZone(env.TIMEZONE)
  ? env.TIMEZONE
  : DEFAULT_TIMEZONE;

/** Formats `date` as e.g. "July 22, 2026 • 09:41 AM" in the configured timezone. */
function formatTimestamp(date: Date): string {
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
  now?: Date;
}): string {
  const { reason, userId, now = new Date() } = params;
  return (
    `🚫 Access Restricted\n\n` +
    `Your access to this bot has been suspended.\n\n` +
    `📝 Reason: ${reason?.trim() || DEFAULT_REASON}\n` +
    `⏰ Time: ${formatTimestamp(now)}\n` +
    `🆔 User ID: ${userId}`
  );
}

/** Builds the ban notice shown in a banned group/thread. */
export function formatGroupBanMessage(params: {
  reason: string | null;
  threadId: string;
  now?: Date;
}): string {
  const { reason, threadId, now = new Date() } = params;
  return (
    `🚫 Group Access Restricted\n\n` +
    `This group has been suspended from using this bot.\n\n` +
    `📝 Reason: ${reason?.trim() || DEFAULT_REASON}\n` +
    `⏰ Time: ${formatTimestamp(now)}\n` +
    `🧵 Thread ID: ${threadId}\n\n` +
    `ℹ️ Note: If you believe this is a mistake, please contact the bot administrator.`
  );
}
