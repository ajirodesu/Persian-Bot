/**
 * Datetime / Timezone Utility
 *
 * Single source of truth for:
 *   1. Building the searchable list of IANA timezones shown in TimezoneSelect.
 *   2. Formatting dates/times consistently across the dashboard (tables, logs,
 *      chat timestamps, admin views) using the account's selected timezone —
 *      see contexts/TimezoneContext.tsx for where that value comes from.
 *
 * Every formatter here accepts an explicit `timezone` argument rather than
 * reading a global — callers pull the value from `useTimezone()` so it's
 * obvious where the setting is coming from and the functions stay easy to
 * test/reuse outside React.
 */

/** The visitor's local timezone, resolved once by the browser/OS. Used as the
 * fallback whenever the account hasn't saved a preference yet. */
export function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** Validates an IANA timezone identifier the same way the backend does. */
export function isValidTimezone(timezone: string): boolean {
  if (!timezone) return false
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

export interface TimezoneOption {
  /** IANA identifier, e.g. "Asia/Manila" — the value persisted to the backend. */
  value: string
  /** Human-friendly city/area name, e.g. "Manila" */
  city: string
  /** Continent/region grouping, e.g. "Asia" */
  region: string
  /** Current UTC offset, e.g. "UTC+08:00" — recomputed live so DST is always correct. */
  offsetLabel: string
  /** Offset in minutes, used for sorting. */
  offsetMinutes: number
  /** Combined display label, e.g. "Manila (UTC+08:00)" */
  label: string
}

function getOffsetMinutes(timezone: string, at: Date): number {
  // en-US short numeric offset (e.g. "GMT+8", "GMT+5:30") parsed into minutes.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'shortOffset',
  }).formatToParts(at)
  const raw = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+0'
  const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(raw)
  if (!match) return 0
  const sign = match[1] === '-' ? -1 : 1
  const hours = Number(match[2] ?? 0)
  const minutes = Number(match[3] ?? 0)
  return sign * (hours * 60 + minutes)
}

function formatOffsetLabel(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? '-' : '+'
  const abs = Math.abs(offsetMinutes)
  const hours = String(Math.floor(abs / 60)).padStart(2, '0')
  const minutes = String(abs % 60).padStart(2, '0')
  return `UTC${sign}${hours}:${minutes}`
}

let cachedOptions: TimezoneOption[] | null = null

/**
 * Every IANA timezone the runtime knows about, with a live UTC offset and a
 * friendly label — built once and cached (offsets are recomputed per session,
 * which is accurate enough for a picker; DST edge-of-day drift is negligible).
 */
export function listTimezoneOptions(): TimezoneOption[] {
  if (cachedOptions) return cachedOptions

  const now = new Date()
  // Intl.supportedValuesOf is available in every browser Vite targets here
  // (Chromium/Firefox/Safari 2022+) and in Node 18+ for any SSR/build step.
  const ids: string[] =
    typeof Intl.supportedValuesOf === 'function'
      ? Intl.supportedValuesOf('timeZone')
      : FALLBACK_TIMEZONES

  const options = ids.map((id): TimezoneOption => {
    const [region, ...rest] = id.split('/')
    const city = (rest.length > 0 ? rest[rest.length - 1] : region).replace(
      /_/g,
      ' ',
    )
    const offsetMinutes = getOffsetMinutes(id, now)
    const offsetLabel = formatOffsetLabel(offsetMinutes)
    return {
      value: id,
      city,
      region: rest.length > 0 ? region : 'Other',
      offsetMinutes,
      offsetLabel,
      label: `${city} (${offsetLabel})`,
    }
  })

  options.sort((a, b) => a.offsetMinutes - b.offsetMinutes || a.city.localeCompare(b.city))
  cachedOptions = options
  return options
}

/** Small hand-picked fallback for the rare runtime without Intl.supportedValuesOf. */
const FALLBACK_TIMEZONES = [
  'UTC',
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Asia/Dubai',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Dhaka',
  'Asia/Bangkok',
  'Asia/Jakarta',
  'Asia/Singapore',
  'Asia/Manila',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Sydney',
  'Pacific/Auckland',
]

/** Formats an ISO/Date as "Jan 5, 2026, 09:41 AM" in the given timezone. */
export function formatDateTime(
  input: string | number | Date | null | undefined,
  timezone: string,
): string {
  if (!input) return '—'
  const date = input instanceof Date ? input : new Date(input)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-US', {
    timeZone: isValidTimezone(timezone) ? timezone : 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

/** Formats an ISO/Date as "Jan 5, 2026" in the given timezone. */
export function formatDate(
  input: string | number | Date | null | undefined,
  timezone: string,
): string {
  if (!input) return '—'
  const date = input instanceof Date ? input : new Date(input)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-US', {
    timeZone: isValidTimezone(timezone) ? timezone : 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}

/** Formats an ISO/Date as "Wed, Jan 5" in the given timezone (chat-room date dividers). */
export function formatShortDate(
  input: string | number | Date | null | undefined,
  timezone: string,
): string {
  if (!input) return '—'
  const date = input instanceof Date ? input : new Date(input)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-US', {
    timeZone: isValidTimezone(timezone) ? timezone : 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date)
}

/** Formats an ISO/Date as "09:41 AM" in the given timezone. */
export function formatTime(
  input: string | number | Date | null | undefined,
  timezone: string,
): string {
  if (!input) return '—'
  const date = input instanceof Date ? input : new Date(input)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-US', {
    timeZone: isValidTimezone(timezone) ? timezone : 'UTC',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}
