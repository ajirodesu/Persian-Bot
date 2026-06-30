import React from 'react'
import { cn } from '@/utils/cn.util'
import {
  forwardRefWithAs,
  type PolymorphicComponentPropsWithRef,
} from '@/utils/polymorphic.util'

type Variant =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'outline'
  | 'text'
  | 'danger'
type Size = 'sm' | 'md' | 'lg'

/**
 * Base props for IconButton component (excluding HTML attributes)
 */
export type IconButtonOwnProps = {
  icon: React.ReactNode
  variant?: Variant
  size?: Size
  isLoading?: boolean
  'aria-label': string
}

/**
 * Polymorphic IconButton props - supports `as` prop for rendering as different elements
 * @example
 * ```tsx
 * <IconButton as="a" href="/settings" icon={<Settings />} aria-label="Settings" />
 * ```
 */
export type IconButtonProps<T extends React.ElementType = 'button'> =
  PolymorphicComponentPropsWithRef<T, IconButtonOwnProps>

/**
 * Base icon button styles
 * Square aspect ratio with centered icon
 * Uses `relative` for proper state layer positioning
 */
const base =
  'relative inline-flex items-center justify-center rounded-lg transition-all duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-state-disabled disabled:pointer-events-none active:scale-[0.95]'

/**
 * Filled variant state layer structure
 * Uses ::after pseudo-element for M3-compliant state layers
 * - z-[1] ensures state layer is above background but below content
 * - will-change-[opacity] for smooth animation performance
 * - disabled:after:opacity-0 prevents state layer when disabled
 */
const filledStateLayer =
  'after:absolute after:inset-0 after:z-[1] after:rounded-lg after:pointer-events-none after:opacity-0 after:transition-opacity after:duration-fast after:will-change-[opacity] hover:after:opacity-state-hover active:after:opacity-state-pressed disabled:after:opacity-0'

/**
 * Variant classes using design system state opacity tokens
 *
 * Filled variants (primary, secondary, tertiary, danger):
 * - Use state layer overlay for hover/active states
 * - Background color with contrasting text
 *
 * Outline variant:
 * - Transparent background with border
 * - Uses direct background opacity for hover/active
 *
 * Text variant (default):
 * - Transparent background, no border
 * - Neutral on-surface text color
 * - Subtle background on hover/active for M3 compliance
 * - Focus ring uses on-surface for neutral appearance
 */
const variantClasses: Record<Variant, string> = {
  primary: cn(
    filledStateLayer,
    'bg-primary text-on-primary after:bg-on-primary focus-visible:ring-primary',
  ),
  secondary: cn(
    filledStateLayer,
    'bg-secondary text-on-secondary after:bg-on-secondary focus-visible:ring-secondary',
  ),
  tertiary: cn(
    filledStateLayer,
    'bg-tertiary text-on-tertiary after:bg-on-tertiary focus-visible:ring-tertiary',
  ),
  outline:
    'bg-transparent text-on-surface border-2 border-outline hover:bg-on-surface/[var(--state-hover-opacity)] active:bg-on-surface/[var(--state-pressed-opacity)] focus-visible:ring-on-surface',
  text: 'bg-transparent text-on-surface hover:bg-on-surface/[var(--state-hover-opacity)] active:bg-on-surface/[var(--state-pressed-opacity)] focus-visible:ring-on-surface',
  danger: cn(
    filledStateLayer,
    'bg-error text-on-error after:bg-on-error focus-visible:ring-error',
  ),
}

/**
 * Size classes - square dimensions for icon buttons
 */
const sizeClasses: Record<Size, string> = {
  sm: 'w-8 h-8',
  md: 'w-10 h-10',
  lg: 'w-12 h-12',
}

/**
 * Icon size mapping
 */
const iconSizeClasses: Record<Size, string> = {
  sm: '[&>svg]:w-4 [&>svg]:h-4',
  md: '[&>svg]:w-5 [&>svg]:h-5',
  lg: '[&>svg]:w-6 [&>svg]:h-6',
}

/**
 * Loading spinner for icon buttons
 */
const Spinner: React.FC<{ size: Size }> = ({ size }) => {
  const spinnerSize = size === 'sm' ? 16 : size === 'lg' ? 24 : 20
  return (
    <svg
      className="relative z-10 animate-spin"
      width={spinnerSize}
      height={spinnerSize}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
        strokeOpacity="0.25"
      />
      <path
        d="M22 12a10 10 0 00-10-10"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  )
}

/**
 * IconButton component with M3-compliant state layers
 *
 * Features:
 * - Transparent background by default (text variant)
 * - Neutral on-surface color for icons
 * - Proper hover, focus, and active states matching Button.tsx
 * - State layer uses ::after pseudo-element for filled variants
 * - Direct background opacity for text/outline variants
 * - Accessible focus ring with proper offset
 * - Square aspect ratio optimized for icons
 *
 * Requires aria-label for accessibility
 *
 * @example
 * ```tsx
 * // Default text variant - transparent, neutral color
 * <IconButton icon={<Menu />} aria-label="Open menu" />
 *
 * // With explicit text variant
 * <IconButton icon={<X />} variant="text" aria-label="Close" />
 *
 * // Outline variant with border
 * <IconButton icon={<Settings />} variant="outline" aria-label="Settings" />
 *
 * // Filled variants for emphasis
 * <IconButton icon={<Plus />} variant="primary" aria-label="Add" />
 * <IconButton icon={<Trash />} variant="danger" aria-label="Delete" />
 *
 * // Polymorphic usage
 * <IconButton as="a" href="/settings" icon={<Settings />} aria-label="Settings" />
 * ```
 */
const IconButton = forwardRefWithAs<'button', IconButtonOwnProps>(
  (props, ref) => {
    const {
      as,
      icon,
      variant = 'text',
      size = 'md',
      isLoading = false,
      className,
      disabled,
      type,
      'aria-label': ariaLabel,
      ...rest
    } = props

    const Component = as || 'button'
    const computedClass = cn(
      base,
      variantClasses[variant],
      sizeClasses[size],
      iconSizeClasses[size],
      className,
    )

    const isDisabled = Boolean(disabled || isLoading)

    return (
      <Component
        ref={ref}
        type={Component === 'button' ? (type ?? 'button') : undefined}
        disabled={Component === 'button' ? isDisabled : undefined}
        className={computedClass}
        aria-label={ariaLabel}
        aria-busy={isLoading || undefined}
        aria-disabled={isDisabled || undefined}
        {...rest}
      >
        {isLoading ? (
          <Spinner size={size} />
        ) : (
          <span className="relative z-10 flex items-center justify-center">
            {icon}
          </span>
        )}
      </Component>
    )
  },
)

IconButton.displayName = 'IconButton'

export default IconButton
