/**
 * Class Name Utility
 *
 * Utility for conditionally joining CSS class names together.
 * Filters out falsy values (false, null, undefined) to enable
 * conditional class name application.
 *
 * @param classes - Array of class names (strings) or conditional values (false, null, undefined)
 * @returns Joined string of valid class names
 *
 * @example
 * ```tsx
 * cn('base-class', isActive && 'active', 'another-class')
 * // Returns: 'base-class active another-class' (if isActive is true)
 *
 * cn('btn', false, null, undefined, 'primary')
 * // Returns: 'btn primary'
 * ```
 */
export function cn(
  ...classes: Array<string | false | null | undefined>
): string {
  return classes.filter(Boolean).join(' ')
}
