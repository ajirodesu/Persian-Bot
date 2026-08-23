import { useCallback, useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

/**
 * Session-Persisted Form Draft
 *
 * Keeps filled-in form state across mobile page evictions. When a phone
 * browser backgrounds the tab (user switches apps, locks the screen), Android
 * Chrome may DISCARD the page after a few minutes — returning then reloads
 * the document (the back/forward cache does not cover this case), and plain
 * useState resets every field to empty. Writing the draft to sessionStorage
 * on every change restores it transparently on remount.
 *
 * Why sessionStorage (not localStorage): the draft — which includes
 * password fields — lives only for the lifetime of the tab. It never
 * persists to disk beyond the session, is wiped when the tab closes, and is
 * invisible to other tabs. clearDraft() must be called on successful submit
 * so credentials don't outlive the form.
 */
export function useSessionFormDraft<T extends object>(
  key: string,
  initial: T,
): [T, Dispatch<SetStateAction<T>>, () => void] {
  const [form, setForm] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(key)
      if (raw) return { ...initial, ...(JSON.parse(raw) as Partial<T>) }
    } catch {
      /* Corrupt or blocked storage — fall back to the empty form. */
    }
    return initial
  })

  // Persist on every change — form drafts are tiny and typing is
  // low-frequency, so a debounce would only risk losing the last keystrokes.
  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(form))
    } catch {
      /* Storage full or blocked — persistence is best-effort. */
    }
  }, [key, form])

  const clearDraft = useCallback(() => {
    try {
      sessionStorage.removeItem(key)
    } catch {
      /* ignore */
    }
  }, [key])

  return [form, setForm, clearDraft]
}
