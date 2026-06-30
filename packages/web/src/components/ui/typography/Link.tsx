import React from 'react'
import { cn } from '@/utils/cn.util'
import {
  forwardRefWithAs,
  type PolymorphicComponentPropsWithRef,
} from '@/utils/polymorphic.util'

/**
 * Link visual style variants
 * - default: Standard link with underline on hover
 * - underline: Always underlined for traditional link appearance
 * - subtle: Muted color, underline on hover (for secondary navigation)
 * - unstyled: No visual styling (for custom compositions)
 */
export type LinkVariant = 'default' | 'underline' | 'subtle' | 'unstyled'

/**
 * Link color options
 * - neutral: Uses on-surface-variant color (default, blends with text)
 * - primary/secondary/tertiary: Brand colors for emphasis
 * - error/success/warning/info: Semantic colors for contextual links
 */
export type LinkColor =
  | 'neutral'
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'error'
  | 'success'
  | 'warning'
  | 'info'

export type LinkSize = 'sm' | 'md' | 'lg'

/**
 * Base props for Link component (excluding HTML attributes)
 */
export type LinkOwnProps = {
  /** Visual variant style */
  variant?: LinkVariant
  /** Color scheme */
  color?: LinkColor
  /** Size of the link text */
  size?: LinkSize
  /** Icon to display on the left side */
  leftIcon?: React.ReactNode
  /** Icon to display on the right side */
  rightIcon?: React.ReactNode
  /** Whether to open in new tab (auto-detected for external URLs) */
  external?: boolean
  /** Disable the link */
  disabled?: boolean
}

/**
 * Polymorphic Link props - supports `as` prop for rendering as different elements
 * @example
 * ```tsx
 * <Link href="/home">Internal Link</Link>
 * <Link as={RouterLink} to="/about">Router Link</Link>
 * <Link href="https://example.com" external>External Link</Link>
 * ```
 */
export type LinkProps<T extends React.ElementType = 'a'> =
  PolymorphicComponentPropsWithRef<T, LinkOwnProps>

/**
 * Size classes for typography
 */
const sizeClasses: Record<LinkSize, string> = {
  sm: 'text-body-sm gap-1',
  md: 'text-body-md gap-1.5',
  lg: 'text-body-lg gap-2',
}

/**
 * Icon size classes matching text sizes
 */
const iconSizeClasses: Record<LinkSize, string> = {
  sm: '[&>svg]:h-3.5 [&>svg]:w-3.5',
  md: '[&>svg]:h-4 [&>svg]:w-4',
  lg: '[&>svg]:h-5 [&>svg]:w-5',
}

/**
 * Color classes for each color option
 */
const colorClasses: Record<LinkColor, string> = {
  neutral: 'text-on-surface-variant hover:text-on-surface',
  primary: 'text-primary hover:text-primary/80',
  secondary: 'text-secondary hover:text-secondary/80',
  tertiary: 'text-tertiary hover:text-tertiary/80',
  error: 'text-error hover:text-error/80',
  success: 'text-success hover:text-success/80',
  warning: 'text-warning hover:text-warning/80',
  info: 'text-info hover:text-info/80',
}

/**
 * Focus ring colors matching link colors
 */
const focusRingClasses: Record<LinkColor, string> = {
  neutral: 'focus-visible:ring-on-surface',
  primary: 'focus-visible:ring-primary',
  secondary: 'focus-visible:ring-secondary',
  tertiary: 'focus-visible:ring-tertiary',
  error: 'focus-visible:ring-error',
  success: 'focus-visible:ring-success',
  warning: 'focus-visible:ring-warning',
  info: 'focus-visible:ring-info',
}

/**
 * Variant-specific classes
 */
const variantClasses: Record<LinkVariant, string> = {
  default: 'no-underline hover:underline underline-offset-2',
  underline: 'underline underline-offset-2 hover:decoration-2',
  subtle:
    'no-underline hover:underline underline-offset-2 opacity-80 hover:opacity-100',
  unstyled: '',
}

/**
 * Detect if URL is external (starts with http/https or //)
 */
function isExternalUrl(href?: string): boolean {
  if (!href) return false
  return (
    href.startsWith('http://') ||
    href.startsWith('https://') ||
    href.startsWith('//')
  )
}

/**
 * Link component for navigation with consistent styling
 *
 * Uses composable variant + color props pattern (same as Button):
 * - variant: Controls visual style (default, underline, subtle, unstyled)
 * - color: Controls color scheme (neutral, primary, secondary, etc.)
 *
 * Supports polymorphic rendering for React Router integration or custom elements.
 * Auto-detects external URLs and adds appropriate security attributes.
 *
 * @example
 * ```tsx
 * // Basic internal link
 * <Link href="/about">About Us</Link>
 *
 * // With React Router
 * <Link as={RouterLink} to="/dashboard">Dashboard</Link>
 *
 * // External link (auto-detected)
 * <Link href="https://github.com">GitHub</Link>
 *
 * // Styled link
 * <Link href="/pricing" color="primary" variant="underline">
 *   View Pricing
 * </Link>
 *
 * // With icons
 * <Link href="/docs" leftIcon={<Book />} rightIcon={<ExternalLink />}>
 *   Documentation
 * </Link>
 *
 * // Disabled link
 * <Link href="/restricted" disabled>Restricted Area</Link>
 * ```
 */
const Link = forwardRefWithAs<'a', LinkOwnProps>((props, ref) => {
  const {
    as,
    variant = 'default',
    color = 'neutral',
    size = 'md',
    leftIcon,
    rightIcon,
    external: externalProp,
    disabled = false,
    className,
    children,
    href,
    ...rest
  } = props

  // Determine if link should open externally
  // Explicit prop takes precedence, otherwise auto-detect from URL
  const isExternal = externalProp ?? isExternalUrl(href as string)

  // Default to <a> for regular links, but allow polymorphic override
  const Component = as || 'a'

  // External link security attributes
  const externalProps = isExternal
    ? {
        target: '_blank',
        rel: 'noopener noreferrer',
      }
    : {}

  const computedClass = cn(
    // Base styles
    'inline-flex items-center font-medium transition-all duration-fast ease-standard',
    // Focus ring for accessibility
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-surface rounded-sm',
    // Variant styles (skip for unstyled)
    variant !== 'unstyled' && sizeClasses[size],
    variant !== 'unstyled' && iconSizeClasses[size],
    variant !== 'unstyled' && colorClasses[color],
    variant !== 'unstyled' && focusRingClasses[color],
    variant !== 'unstyled' && variantClasses[variant],
    // Disabled state
    disabled && 'opacity-50 cursor-not-allowed pointer-events-none',
    className,
  )

  return (
    <Component
      ref={ref}
      href={disabled ? undefined : href}
      className={computedClass}
      aria-disabled={disabled || undefined}
      {...externalProps}
      {...rest}
    >
      {leftIcon && (
        <span className="flex-shrink-0" aria-hidden="true">
          {leftIcon}
        </span>
      )}
      {children}
      {rightIcon && (
        <span className="flex-shrink-0" aria-hidden="true">
          {rightIcon}
        </span>
      )}
    </Component>
  )
})

Link.displayName = 'Link'

export default Link
