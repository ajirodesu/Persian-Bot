/**
 * Author: AjiroDesu
 *
 * Cold-start (Render free-tier sleep) notice plumbing.
 *
 * The API client arms a 2s timer on the page's first request; if the
 * backend hasn't answered by then it is likely waking from sleep, so the
 * client calls notifySlowFirstRequest() exactly once per page load. The
 * ColdStartNotice component (mounted in App, inside SnackbarProvider)
 * turns that signal into a transient snackbar instead of a silent spinner.
 */
type SlowFirstRequestListener = () => void

let listener: SlowFirstRequestListener | null = null
let notified = false

export function onSlowFirstRequest(cb: SlowFirstRequestListener): () => void {
  listener = cb
  return () => {
    if (listener === cb) listener = null
  }
}

export function notifySlowFirstRequest(): void {
  if (notified) return
  notified = true
  listener?.()
}
