/**
 * Author: AjiroDesu
 *
 * Pure draft-storage helpers for auth forms.
 *
 * Kept outside the React hook so the persistence contract (secret denylist,
 * versioning, TTL) can be unit-tested without a DOM. Nothing here ever runs
 * for password fields: the denylist is applied before serialization.
 */

export const DEFAULT_DRAFT_TTL_MS = 24 * 60 * 60 * 1000

export const DEFAULT_SENSITIVE_FIELDS = [
  'password',
  'confirmPassword',
  'newPassword',
  'currentPassword',
  'code',
  'otp',
  'token',
] as const

export interface DraftEnvelope<T> {
  version: number
  savedAt: number
  values: Partial<T>
}

/** Drops secret keys from a draft before it is ever written. */
export function sanitizeDraftValues<T extends object>(
  values: T,
  sensitive: readonly (keyof T)[],
): Partial<T> {
  const output = { ...values } as Record<string, unknown>
  for (const key of sensitive) delete output[String(key)]
  return output as Partial<T>
}

/** True when at least one persisted value is meaningful (not blank). */
export function hasMeaningfulDraft<T extends object>(values: Partial<T>): boolean {
  return Object.values(values).some((value) => {
    if (typeof value === 'string') return value.trim().length > 0
    if (typeof value === 'boolean') return value
    if (typeof value === 'number') return true
    if (value === null || value === undefined) return false
    if (typeof value === 'object') return Object.keys(value).length > 0
    return true
  })
}

export function serializeDraft<T extends object>(options: {
  values: T
  sensitive: readonly (keyof T)[]
  version: number
  savedAt: number
}): string | null {
  const values = sanitizeDraftValues(options.values, options.sensitive)
  if (!hasMeaningfulDraft(values)) return null
  const envelope: DraftEnvelope<T> = {
    version: options.version,
    savedAt: options.savedAt,
    values,
  }
  return JSON.stringify(envelope)
}

/**
 * Parses a stored draft. Returns null for corrupt, stale or foreign-version
 * payloads — never throws, never partially applies a bad shape.
 */
export function parseDraft<T extends object>(options: {
  raw: string | null
  version: number
  ttlMs?: number
  now?: number
}): { values: Partial<T>; savedAt: number } | null {
  if (!options.raw) return null
  const now = options.now ?? Date.now()
  const ttlMs = options.ttlMs ?? DEFAULT_DRAFT_TTL_MS
  try {
    const envelope = JSON.parse(options.raw) as DraftEnvelope<T>
    if (
      envelope === null ||
      typeof envelope !== 'object' ||
      envelope.version !== options.version ||
      typeof envelope.savedAt !== 'number' ||
      envelope.values === null ||
      typeof envelope.values !== 'object'
    ) {
      return null
    }
    if (now - envelope.savedAt >= ttlMs) return null
    return { values: envelope.values, savedAt: envelope.savedAt }
  } catch {
    return null
  }
}
