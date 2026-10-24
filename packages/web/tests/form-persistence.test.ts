/**
 * Auth form draft tests — what may and may not survive a reload.
 *
 * Secrets never serialize, versions never cross, and stale drafts expire.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SENSITIVE_FIELDS,
  hasMeaningfulDraft,
  parseDraft,
  sanitizeDraftValues,
  serializeDraft,
} from '@/lib/form-draft.lib'

interface Draft {
  email: string
  rememberMe: boolean
  errors: { email?: string }
  password: string
  confirmPassword: string
}

const draft: Draft = {
  email: 'ajiro@example.com',
  rememberMe: true,
  errors: {},
  password: 'super-secret',
  confirmPassword: 'super-secret',
}

describe('sanitizeDraftValues', () => {
  it('keeps non-sensitive fields and drops every secret', () => {
    const safe = sanitizeDraftValues(draft, DEFAULT_SENSITIVE_FIELDS as readonly (keyof Draft)[])
    expect(safe).toEqual({
      email: 'ajiro@example.com',
      rememberMe: true,
      errors: {},
    })
    expect(JSON.stringify(safe)).not.toContain('super-secret')
  })

  it('does not mutate the source object', () => {
    sanitizeDraftValues(draft, ['password'])
    expect(draft.password).toBe('super-secret')
  })
})

describe('serializeDraft', () => {
  it('never writes a password even if a caller forgets the denylist', () => {
    const payload = serializeDraft({
      values: draft,
      sensitive: DEFAULT_SENSITIVE_FIELDS as readonly (keyof Draft)[],
      version: 1,
      savedAt: 1,
    })
    expect(payload).not.toBeNull()
    expect(payload).not.toContain('super-secret')
    expect(payload).toContain('ajiro@example.com')
  })

  it('returns null for an all-empty draft', () => {
    const payload = serializeDraft({
      values: { email: '', name: '', rememberMe: false },
      sensitive: [],
      version: 1,
      savedAt: 1,
    })
    expect(payload).toBeNull()
  })
})

describe('parseDraft', () => {
  const raw = JSON.stringify({
    version: 1,
    savedAt: 1_000,
    values: { email: 'ajiro@example.com', rememberMe: true },
  })

  it('restores a fresh draft of the expected version', () => {
    expect(parseDraft({ raw, version: 1, now: 2_000 })).toEqual({
      values: { email: 'ajiro@example.com', rememberMe: true },
      savedAt: 1_000,
    })
  })

  it('rejects an expired draft', () => {
    expect(
      parseDraft({ raw, version: 1, ttlMs: 500, now: 2_000 }),
    ).toBeNull()
  })

  it('rejects a foreign version and corrupt payloads', () => {
    expect(parseDraft({ raw, version: 2, now: 2_000 })).toBeNull()
    expect(parseDraft({ raw: '{broken', version: 1, now: 2_000 })).toBeNull()
    expect(parseDraft({ raw: 'null', version: 1, now: 2_000 })).toBeNull()
    expect(parseDraft({ raw: null, version: 1 })).toBeNull()
  })
})

describe('hasMeaningfulDraft', () => {
  it('treats blank strings and empty objects as empty', () => {
    expect(hasMeaningfulDraft({ email: '  ', errors: {} })).toBe(false)
    expect(hasMeaningfulDraft({ email: 'a', errors: {} })).toBe(true)
    expect(hasMeaningfulDraft({ rememberMe: true })).toBe(true)
  })
})
