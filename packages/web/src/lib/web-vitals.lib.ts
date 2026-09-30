/**
 * Author: AjiroDesu
 *
 * Dev-only Web Vitals reporter (LCP, INP, CLS, FCP, TTFB).
 *
 * Dynamically imports `web-vitals` so the library never ships to
 * production — zero production bytes. Call once from main.tsx; the
 * import.meta.env.DEV guard double-ensures it tree-shakes out of
 * production builds entirely.
 */
export async function reportWebVitalsDev(): Promise<void> {
  if (!import.meta.env.DEV) return
  try {
    const { onLCP, onINP, onCLS, onFCP, onTTFB } = await import('web-vitals')
    const log = (name: string, value: number, rating: string): void => {
      // eslint-disable-next-line no-console
      console.log(`[web-vitals] ${name}: ${Math.round(value)}ms (${rating})`)
    }
    onLCP((m) => log('LCP', m.value, m.rating))
    onINP((m) => log('INP', m.value, m.rating))
    onCLS((m) => log('CLS', m.value * 1000, m.rating))
    onFCP((m) => log('FCP', m.value, m.rating))
    onTTFB((m) => log('TTFB', m.value, m.rating))
  } catch {
    // web-vitals missing or unsupported browser — dev aid only, never throw
  }
}
