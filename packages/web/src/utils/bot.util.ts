import { PLATFORM_LABELS } from '@/constants/platform.constants'

// Local binding required before re-exporting so getPlatformLabel can read it below
export { PLATFORM_LABELS }

/**
 * Returns human-readable label for a given platform internal key.
 */
export function getPlatformLabel(platform: string): string {
  return PLATFORM_LABELS[platform] ?? platform
}

/**
 * Masks sensitive credentials so they aren't fully visible on screen.
 * Shows only the last 4 characters to allow operators to verify the ending matches
 * what they pasted, without exposing the full secret in the DOM.
 */
export function maskCredential(value: string): string {
  if (!value) return '—'
  return value.length > 4 ? '••••' + value.slice(-4) : '•'.repeat(value.length)
}
