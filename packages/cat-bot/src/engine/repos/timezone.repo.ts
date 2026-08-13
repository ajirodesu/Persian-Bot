import {
  getUserTimezone as _getUserTimezone,
  upsertUserTimezone as _upsertUserTimezone,
} from 'database';

/** Dashboard-wide fallback when a user hasn't picked a timezone yet. */
const DEFAULT_TIMEZONE = 'UTC';

/** Validates an IANA timezone identifier via Intl — the same source the frontend's
 * searchable picker is built from, so anything the UI can select is accepted here. */
export function isValidTimezone(timezone: string): boolean {
  if (!timezone || typeof timezone !== 'string') return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** Returns the user's saved timezone, or null when they haven't set one. */
export async function getUserTimezone(userId: string): Promise<string | null> {
  if (!userId) return null;
  return _getUserTimezone(userId);
}

/** Returns the user's saved timezone, falling back to DEFAULT_TIMEZONE when unset. */
export async function getUserTimezoneOrDefault(userId: string): Promise<string> {
  if (!userId) return DEFAULT_TIMEZONE;
  const stored = await _getUserTimezone(userId);
  return stored && isValidTimezone(stored) ? stored : DEFAULT_TIMEZONE;
}

/** Validates and persists the user's timezone preference. */
export async function saveUserTimezone(
  userId: string,
  timezone: string,
): Promise<void> {
  if (!userId) throw new Error('Not authenticated');
  const trimmed = timezone.trim();
  if (!isValidTimezone(trimmed)) {
    throw new Error('Invalid timezone. Choose a value from the timezone list.');
  }
  await _upsertUserTimezone(userId, trimmed);
}
