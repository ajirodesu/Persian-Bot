import type { AppTheme } from '../contexts/ThemeContext'

/**
 * Favicon Theming — recolors the static /favicon.svg to match the active
 * theme's primary color at runtime.
 *
 * The favicon is served as its own document by the browser, so it has no
 * access to the app's CSS custom properties (--color-primary) or the
 * data-theme attribute on <html>. To keep it in sync with the app theme,
 * this fetches the base SVG once, swaps every fill color for the current
 * theme's primary hex, and points the <link rel="icon"> at a Blob URL.
 *
 * Hex values mirror --aurora-color-primary / --classic-color-primary in
 * src/styles/theme/*.css (kept in sync manually — there are only two
 * themes and the mapping rarely changes).
 */

const FAVICON_PRIMARY_HEX: Record<AppTheme, string> = {
  aurora: '#0AB4E8',
  classic: '#F0873C',
}

let svgTemplatePromise: Promise<string> | null = null

/** Fetches /favicon.svg once and normalizes every fill color to a placeholder. */
function getSvgTemplate(): Promise<string> {
  svgTemplatePromise ??= fetch('/favicon.svg')
    .then((res) => res.text())
    .then((raw) => raw.replace(/fill="#[0-9a-fA-F]{3,8}"/g, 'fill="__COLOR__"'))
  return svgTemplatePromise
}

let activeFaviconUrl: string | null = null

/** Recolors and applies the favicon for the given theme. Safe to call repeatedly. */
export async function applyFaviconTheme(theme: AppTheme): Promise<void> {
  try {
    const template = await getSvgTemplate()
    const svg = template.split('__COLOR__').join(FAVICON_PRIMARY_HEX[theme])
    const blob = new Blob([svg], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)

    const link =
      document.querySelector<HTMLLinkElement>("link[rel='icon']") ??
      document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'icon' }))

    link.type = 'image/svg+xml'
    link.href = url

    if (activeFaviconUrl) URL.revokeObjectURL(activeFaviconUrl)
    activeFaviconUrl = url
  } catch {
    // Non-critical — if theming fails, the static /favicon.svg (already linked
    // in index.html) keeps rendering, just without the theme tint.
  }
}
