import React from 'react'
import { X } from 'lucide-react'
import { cn } from '@/utils/cn.util'
import {
  forwardRefWithAs,
  type PolymorphicComponentPropsWithRef,
} from '@/utils/polymorphic.util'

/**
 * Badge visual style variants
 * - tonal: Soft container backgrounds for subtle labeling
 * - filled: Solid backgrounds for high-emphasis badges
 * - outlined: Border-only style for minimal look
 */
export type BadgeVariant = 'tonal' | 'filled' | 'outlined'

/**
 * Badge color options
 * - default: Neutral/surface colors
 * - primary/secondary/tertiary: Brand colors
 * - success/error/warning/info: Semantic status colors
 */
export type BadgeColor =
  | 'default'
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'success'
  | 'error'
  | 'warning'
  | 'info'

export type BadgeSize = 'sm' | 'md' | 'lg'

/**
 * Base props for Badge component (excluding HTML attributes)
 */
export type BadgeOwnProps = {
  /** Visual variant style */
  variant?: BadgeVariant
  /** Color scheme */
  color?: BadgeColor
  /** Size of the badge */
  size?: BadgeSize
  /** Icon to display on the left side */
  leftIcon?: React.ReactNode
  /** Icon to display on the right side */
  rightIcon?: React.ReactNode
  /** Show a dot indicator instead of content */
  dot?: boolean
  /** Show dismiss/close button */
  dismissible?: boolean
  /** Callback when dismiss button is clicked */
  onDismiss?: () => void
  /** Make badge pill-shaped (more rounded) */
  pill?: boolean
}

/**
 * Polymorphic Badge props - supports `as` prop for rendering as different elements
 * @example
 * ```tsx
 * <Badge as="button" onClick={handleClick}>Clickable</Badge>
 * <Badge as="a" href="/tags/react">React</Badge>
 * ```
 */
export type BadgeProps<T extends React.ElementType = 'span'> =
  PolymorphicComponentPropsWithRef<T, BadgeOwnProps>

/**
 * Size styles for padding and typography
 */
const sizeStyles: Record<BadgeSize, string> = {
  sm: 'px-2 py-0.5 text-label-sm gap-1',
  md: 'px-2.5 py-1 text-label-md gap-1.5',
  lg: 'px-3 py-1.5 text-label-lg gap-2',
}

/**
 * Dot size classes
 */
const dotSizeClasses: Record<BadgeSize, string> = {
  sm: 'w-1.5 h-1.5',
  md: 'w-2 h-2',
  lg: 'w-2.5 h-2.5',
}

/**
 * Icon size classes
 */
const iconSizeClasses: Record<BadgeSize, string> = {
  sm: '[&>svg]:h-3 [&>svg]:w-3',
  md: '[&>svg]:h-3.5 [&>svg]:w-3.5',
  lg: '[&>svg]:h-4 [&>svg]:w-4',
}

/**
 * Tonal variant - soft container backgrounds
 */
const tonalStyles: Record<BadgeColor, string> = {
  default: 'bg-surface-container-high text-on-surface border-transparent',
  primary: 'bg-primary-container text-on-primary-container border-transparent',
  secondary:
    'bg-secondary-container text-on-secondary-container border-transparent',
  tertiary:
    'bg-tertiary-container text-on-tertiary-container border-transparent',
  success: 'bg-success-container text-on-success-container border-transparent',
  error: 'bg-error-container text-on-error-container border-transparent',
  warning: 'bg-warning-container text-on-warning-container border-transparent',
  info: 'bg-info-container text-on-info-container border-transparent',
}

/**
 * Filled variant - solid backgrounds
 */
const filledStyles: Record<BadgeColor, string> = {
  default: 'bg-on-surface text-surface border-transparent',
  primary: 'bg-primary text-on-primary border-transparent',
  secondary: 'bg-secondary text-on-secondary border-transparent',
  tertiary: 'bg-tertiary text-on-tertiary border-transparent',
  success: 'bg-success text-on-success border-transparent',
  error: 'bg-error text-on-error border-transparent',
  warning: 'bg-warning text-on-warning border-transparent',
  info: 'bg-info text-on-info border-transparent',
}

/**
 * Outlined variant - border only with transparent background
 */
const outlinedStyles: Record<BadgeColor, string> = {
  default: 'bg-transparent text-on-surface border-outline',
  primary: 'bg-transparent text-primary border-primary',
  secondary: 'bg-transparent text-secondary border-secondary',
  tertiary: 'bg-transparent text-tertiary border-tertiary',
  success: 'bg-transparent text-success border-success',
  error: 'bg-transparent text-error border-error',
  warning: 'bg-transparent text-warning border-warning',
  info: 'bg-transparent text-info border-info',
}

/**
 * Dot color classes for each color
 */
const dotColorClasses: Record<BadgeColor, string> = {
  default: 'bg-on-surface-variant',
  primary: 'bg-primary',
  secondary: 'bg-secondary',
  tertiary: 'bg-tertiary',
  success: 'bg-success',
  error: 'bg-error',
  warning: 'bg-warning',
  info: 'bg-info',
}

/**
 * Map variant to style record
 */
const variantStyleMap: Record<BadgeVariant, Record<BadgeColor, string>> = {
  tonal: tonalStyles,
  filled: filledStyles,
  outlined: outlinedStyles,
}

/**
 * Badge component for labels, tags, and status indicators
 *
 * Uses composable variant + color props pattern (same as Button):
 * - variant: Controls visual style (tonal, filled, outlined)
 * - color: Controls color scheme (default, primary, secondary, etc.)
 *
 * @example
 * ```tsx
 * // Basic usage (defaults: variant="tonal", color="default")
 * <Badge>Default</Badge>
 *
 * // With variant and color
 * <Badge variant="filled" color="success">Active</Badge>
 *
 * // With icon
 * <Badge color="info" leftIcon={<Star size={12} />}>Featured</Badge>
 *
 * // Dot indicator
 * <Badge color="error" dot>3 notifications</Badge>
 *
 * // Dismissible
 * <Badge color="primary" dismissible onDismiss={() => {}}>
 *   Removable
 * </Badge>
 *
 * // Pill shape
 * <Badge variant="filled" color="secondary" pill>Pill Badge</Badge>
 *
 * // Polymorphic usage
 * <Badge as="button" onClick={handleClick}>Clickable</Badge>
 * <Badge as="a" href="/tags/react">React</Badge>
 * ```
 */
const Badge = forwardRefWithAs<'span', BadgeOwnProps>((props, ref) => {
  const {
    as,
    variant = 'tonal',
    color = 'default',
    size = 'md',
    leftIcon,
    rightIcon,
    dot = false,
    dismissible = false,
    onDismiss,
    pill = false,
    className,
    children,
    ...rest
  } = props

  const Component = as || 'span'
  const variantStyles = variantStyleMap[variant]
  const colorStyle = variantStyles[color]

  // Handle dismiss click without propagating
  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation()
    onDismiss?.()
  }

  return (
    <Component
      ref={ref}
      className={cn(
        // Base styles
        'inline-flex items-center justify-center font-medium border transition-colors duration-fast',
        // Border radius
        pill ? 'rounded-full' : 'rounded-md',
        // Size
        sizeStyles[size],
        // Variant and color
        colorStyle,
        // Icon sizing
        iconSizeClasses[size],
        className,
      )}
      {...rest}
    >
      {/* Dot indicator */}
      {dot && (
        <span
          className={cn(
            'rounded-full flex-shrink-0',
            dotSizeClasses[size],
            // Use color for dot, but for filled variant use current text color
            variant === 'filled' ? 'bg-current' : dotColorClasses[color],
          )}
          aria-hidden="true"
        />
      )}

      {/* Left icon */}
      {!dot && leftIcon && (
        <span className="flex-shrink-0" aria-hidden="true">
          {leftIcon}
        </span>
      )}

      {/* Content */}
      {children && <span className="truncate">{children}</span>}

      {/* Right icon */}
      {!dot && rightIcon && !dismissible && (
        <span className="flex-shrink-0" aria-hidden="true">
          {rightIcon}
        </span>
      )}

      {/* Dismiss button */}
      {dismissible && (
        <button
          type="button"
          onClick={handleDismiss}
          className={cn(
            'flex-shrink-0 rounded-sm hover:opacity-70 focus:outline-none focus:ring-1 focus:ring-current transition-opacity duration-fast ml-0.5 -mr-0.5',
          )}
          aria-label="Dismiss"
        >
          <X
            className={cn(
              size === 'sm'
                ? 'h-3 w-3'
                : size === 'lg'
                  ? 'h-4 w-4'
                  : 'h-3.5 w-3.5',
            )}
          />
        </button>
      )}
    </Component>
  )
})

Badge.displayName = 'Badge'

export default Badge
