import { useCallback, useRef, useState } from 'react'

interface UseCopyToClipboardOptions {
  /** Milliseconds the `copied` flag stays true before resetting. */
  resetAfterMs?: number
}

interface UseCopyToClipboardReturn {
  copied: boolean
  copy: (text: string) => Promise<boolean>
}

/** Writes text to the clipboard, falling back to execCommand for
 *  insecure contexts and older iOS WebKit. Returns true on success. */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const el = document.createElement('textarea')
    el.value = text
    el.setAttribute('readonly', '')
    el.style.position = 'fixed'
    el.style.left = '-9999px'
    el.style.top = '0'
    document.body.appendChild(el)
    el.focus()
    el.select()
    el.setSelectionRange(0, el.value.length)
    const ok = document.execCommand('copy')
    document.body.removeChild(el)
    return ok
  } catch {
    return false
  }
}

export function useCopyToClipboard(
  options: UseCopyToClipboardOptions = {},
): UseCopyToClipboardReturn {
  const { resetAfterMs = 1500 } = options
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<number | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const copy = useCallback(
    async (text: string): Promise<boolean> => {
      const ok = await writeClipboard(text)
      if (!ok) return false
      setCopied(true)
      clearTimer()
      timerRef.current = window.setTimeout(() => setCopied(false), resetAfterMs)
      return true
    },
    [clearTimer, resetAfterMs],
  )

  return { copied, copy }
}
