/**
 * Author: AjiroDesu
 *
 * Form draft persistence.
 *
 * Auth forms must survive tab switches, app backgrounding, page reloads and
 * mobile tabs being discarded. This hook stores only non-sensitive values:
 * field contents are filtered through a denylist of secret keys (password,
 * confirmPassword, code, otp, token) before anything touches storage.
 *
 * Behaviour:
 * - restores synchronously on mount, before the first paint;
 * - writes are debounced (250ms) and flushed on pagehide / tab-hidden, so a
 *   frozen tab never loses the last keystroke;
 * - versioned + TTL'd, so stale shapes are discarded instead of applied;
 * - `clearDraft()` is the only way a draft disappears early (successful
 *   submit or explicit reset) — no blur/focus listener ever clears it.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DEFAULT_DRAFT_TTL_MS,
  DEFAULT_SENSITIVE_FIELDS,
  parseDraft,
  serializeDraft,
} from '@/lib/form-draft.lib'

const DEBOUNCE_MS = 250

type StorageKind = 'session' | 'local'

export interface UseFormDraftOptions<T extends object> {
  /** Stable identifier, e.g. "login", "signup", "reset". */
  key: string
  version?: number
  storage?: StorageKind
  ttlMs?: number
  /** Keys that must never be persisted. Defaults to the secret denylist. */
  sensitive?: readonly (keyof T)[]
  /** Values that are empty should not keep a draft alive. */
  isEmpty?: (values: T) => boolean
}

export interface UseFormDraftResult<T> {
  values: T
  setValues: React.Dispatch<React.SetStateAction<T>>
  clearDraft: () => void
  /** True when a previous draft was applied on mount. */
  restored: boolean
  /** Last persisted timestamp, or null when nothing is stored. */
  savedAt: number | null
}

function resolveStorage(kind: StorageKind): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage
  } catch {
    return null
  }
}

export function useFormDraft<T extends object>(
  initialValues: T,
  options: UseFormDraftOptions<T>,
): UseFormDraftResult<T> {
  const {
    key,
    version = 1,
    storage = 'session',
    ttlMs = DEFAULT_DRAFT_TTL_MS,
    isEmpty,
  } = options

  const storageKey = `catbot:form-draft:${key}:v${version}`
  const sensitive = (options.sensitive ?? DEFAULT_SENSITIVE_FIELDS) as readonly (keyof T)[]

  // Read storage exactly once, in a lazy state initializer, so the restored
  // values are available on the first paint and no ref is touched in render.
  const [initial] = useState<{
    values: T
    restored: boolean
    savedAt: number | null
  }>(() => {
    let values = initialValues
    let restored = false
    let savedAt: number | null = null
    const store = resolveStorage(storage)
    if (store) {
      try {
        const raw = store.getItem(storageKey)
        if (raw) {
          const parsed = parseDraft<T>({ raw, version, ttlMs })
          if (parsed) {
            values = { ...initialValues, ...parsed.values }
            restored = true
            savedAt = parsed.savedAt
          } else {
            store.removeItem(storageKey)
          }
        }
      } catch {
        store.removeItem(storageKey)
      }
    }
    return { values, restored, savedAt }
  })

  const [values, setValues] = useState<T>(initial.values)
  const [savedAt, setSavedAt] = useState<number | null>(initial.savedAt)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const persist = useCallback(
    (nextValues: T) => {
      const store = resolveStorage(storage)
      if (!store) return
      const empty = isEmpty ? isEmpty(nextValues) : false
      const savedAtNow = Date.now()
      const payload = empty
        ? null
        : serializeDraft({
            values: nextValues,
            sensitive,
            version,
            savedAt: savedAtNow,
          })
      if (payload === null) {
        store.removeItem(storageKey)
        setSavedAt(null)
        return
      }
      try {
        store.setItem(storageKey, payload)
        setSavedAt(savedAtNow)
      } catch {
        // Quota / private mode: drafts degrade to in-memory only.
      }
    },
    // `sensitive` is derived from options and stable for a given form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storage, storageKey, version, isEmpty],
  )

  const setValuesWithPersistence: React.Dispatch<
    React.SetStateAction<T>
  > = useCallback(
    (action) => {
      setValues((previous) => {
        const next =
          typeof action === 'function'
            ? (action as (prev: T) => T)(previous)
            : action
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => {
          timerRef.current = null
          persist(next)
        }, DEBOUNCE_MS)
        return next
      })
    },
    [persist],
  )

  // Flush on the way out; a hidden tab can be frozen without another tick.
  useEffect(() => {
    const flush = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      persist(values)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [persist, values])

  const clearDraft = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const store = resolveStorage(storage)
    try {
      store?.removeItem(storageKey)
    } catch {
      // nothing to clear
    }
    setSavedAt(null)
  }, [storage, storageKey])

  return {
    values,
    setValues: setValuesWithPersistence,
    clearDraft,
    restored: initial.restored,
    savedAt,
  }
}
