import React from 'react'
import { cn } from '@/utils/cn.util'
import {
  forwardRefWithAs,
  type PolymorphicComponentPropsWithRef,
} from '@/utils/polymorphic.util'

/**
 * Button visual style variants
 * - filled: Solid background with high emphasis
 * - tonal: Soft container background with medium emphasis
 * - outline: Bordered with transparent background (1px border)
 * - outline-2: Bordered with transparent background (2px border, bolder)
 * - text: No background or border, subtle hover
 * - link: Text-only, link-like appearance
 * - gradient: Eye-catching gradient background
 * - unstyled: No visual styling
 */
export type ButtonVariant =
  | 'filled'
  | 'tonal'
  | 'outline'
  | 'outline-2'
  | 'text'
  | 'link'
  | 'gradient'
  | 'unstyled'

/**
 * Button color options
 * - primary/secondary/tertiary: Brand colors
 * - error/success/warning/info: Semantic status colors
 * - neutral: Uses on-surface color (for outline/text variants)
 */
export type ButtonColor =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'error'
  | 'success'
  | 'warning'
  | 'info'
  | 'neutral'

export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg'

/**
 * Base props for Button component (excluding HTML attributes)
 */
export type ButtonOwnProps = {
  /** Visual variant style */
  variant?: ButtonVariant
  /** Color scheme - defaults based on variant if not specified */
  color?: ButtonColor
  /** Size of the button */
  size?: ButtonSize
  /** Show loading spinner and disable button */
  isLoading?: boolean
  /** Icon to display on the left side */
  leftIcon?: React.ReactNode
  /** Icon to display on the right side */
  rightIcon?: React.ReactNode
  /** Make button full width of container */
  fullWidth?: boolean
  /** Icon-only button (square aspect ratio, centered icon) */
  iconOnly?: boolean
  /** Render text with underline (only applies to link variant) */
  underline?: boolean
  /** Make button pill-shaped (fully rounded) */
  pill?: boolean
}

/**
 * Polymorphic Button props - supports `as` prop for rendering as different elements
 * @example
 * ```tsx
 * <Button as="a" href="/home">Link Button</Button>
 * <Button as={Link} to="/about">Router Link</Button>
 * ```
 */
export type ButtonProps<T extends React.ElementType = 'button'> =
  PolymorphicComponentPropsWithRef<T, ButtonOwnProps>

/**
 * Base button styles - shared across all variants
 * Note: rounded-lg is applied conditionally based on pill prop
 */
const baseStyles =
  'relative inline-flex items-center justify-center font-medium transition-all duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed active:scale-[0.98]'

/**
 * Base for link variant - no background, inline display
 * Note: rounded-sm is applied conditionally based on pill prop
 */
const linkBaseStyles =
  'relative inline-flex items-center justify-center font-medium transition-all duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed'

/**
 * State layer overlay structures
 * Uses rounded-[inherit] to match parent's border-radius (supports pill shape)
 */
const stateLayerBase =
  'after:absolute after:inset-0 after:z-[1] after:rounded-[inherit] after:pointer-events-none after:opacity-0 after:transition-opacity after:duration-fast after:will-change-[opacity] disabled:after:opacity-0'
const filledStateLayer = `${stateLayerBase} hover:after:opacity-state-hover active:after:opacity-state-pressed`
const gradientStateLayer = `${stateLayerBase} hover:after:opacity-[0.15] active:after:opacity-[0.25]`
const tonalStateLayer = filledStateLayer

/**
 * Disabled styles
 */
const disabledStyles =
  'disabled:opacity-state-disabled disabled:pointer-events-none'

/**
 * Color-specific classes for filled variant
 */
const filledColorClasses: Record<ButtonColor, string> = {
  primary:
    'bg-primary text-on-primary after:bg-on-primary focus-visible:ring-primary',
  secondary:
    'bg-secondary text-on-secondary after:bg-on-secondary focus-visible:ring-secondary',
  tertiary:
    'bg-tertiary text-on-tertiary after:bg-on-tertiary focus-visible:ring-tertiary',
  error: 'bg-error text-on-error after:bg-on-error focus-visible:ring-error',
  success:
    'bg-success text-on-success after:bg-on-success focus-visible:ring-success',
  warning:
    'bg-warning text-on-warning after:bg-on-warning focus-visible:ring-warning',
  info: 'bg-info text-on-info after:bg-on-info focus-visible:ring-info',
  neutral:
    'bg-on-surface text-surface after:bg-surface focus-visible:ring-on-surface',
}

/**
 * Color-specific classes for tonal variant
 */
const tonalColorClasses: Record<ButtonColor, string> = {
  primary:
    'bg-primary-container text-on-primary-container after:bg-on-primary-container focus-visible:ring-primary',
  secondary:
    'bg-secondary-container text-on-secondary-container after:bg-on-secondary-container focus-visible:ring-secondary',
  tertiary:
    'bg-tertiary-container text-on-tertiary-container after:bg-on-tertiary-container focus-visible:ring-tertiary',
  error:
    'bg-error-container text-on-error-container after:bg-on-error-container focus-visible:ring-error',
  success:
    'bg-success-container text-on-success-container after:bg-on-success-container focus-visible:ring-success',
  warning:
    'bg-warning-container text-on-warning-container after:bg-on-warning-container focus-visible:ring-warning',
  info: 'bg-info-container text-on-info-container after:bg-on-info-container focus-visible:ring-info',
  neutral:
    'bg-surface-container text-on-surface after:bg-on-surface focus-visible:ring-on-surface',
}

/**
 * Color-specific classes for outline variants (shared by outline and outline-2)
 */
const outlineColorClasses: Record<ButtonColor, string> = {
  primary:
    'border-primary text-primary hover:bg-primary/[var(--state-hover-opacity)] active:bg-primary/[var(--state-pressed-opacity)] focus-visible:ring-primary disabled:border-outline-variant',
  secondary:
    'border-secondary text-secondary hover:bg-secondary/[var(--state-hover-opacity)] active:bg-secondary/[var(--state-pressed-opacity)] focus-visible:ring-secondary disabled:border-outline-variant',
  tertiary:
    'border-tertiary text-tertiary hover:bg-tertiary/[var(--state-hover-opacity)] active:bg-tertiary/[var(--state-pressed-opacity)] focus-visible:ring-tertiary disabled:border-outline-variant',
  error:
    'border-error text-error hover:bg-error/[var(--state-hover-opacity)] active:bg-error/[var(--state-pressed-opacity)] focus-visible:ring-error disabled:border-outline-variant',
  success:
    'border-success text-success hover:bg-success/[var(--state-hover-opacity)] active:bg-success/[var(--state-pressed-opacity)] focus-visible:ring-success disabled:border-outline-variant',
  warning:
    'border-warning text-warning hover:bg-warning/[var(--state-hover-opacity)] active:bg-warning/[var(--state-pressed-opacity)] focus-visible:ring-warning disabled:border-outline-variant',
  info: 'border-info text-info hover:bg-info/[var(--state-hover-opacity)] active:bg-info/[var(--state-pressed-opacity)] focus-visible:ring-info disabled:border-outline-variant',
  neutral:
    'border-on-surface text-on-surface hover:bg-on-surface/[var(--state-hover-opacity)] active:bg-on-surface/[var(--state-pressed-opacity)] focus-visible:ring-on-surface disabled:border-outline-variant',
}

/**
 * Color-specific classes for text variant
 */
const textColorClasses: Record<ButtonColor, string> = {
  primary:
    'text-primary hover:bg-primary/[var(--state-hover-opacity)] active:bg-primary/[var(--state-pressed-opacity)] focus-visible:ring-primary',
  secondary:
    'text-secondary hover:bg-secondary/[var(--state-hover-opacity)] active:bg-secondary/[var(--state-pressed-opacity)] focus-visible:ring-secondary',
  tertiary:
    'text-tertiary hover:bg-tertiary/[var(--state-hover-opacity)] active:bg-tertiary/[var(--state-pressed-opacity)] focus-visible:ring-tertiary',
  error:
    'text-error hover:bg-error/[var(--state-hover-opacity)] active:bg-error/[var(--state-pressed-opacity)] focus-visible:ring-error',
  success:
    'text-success hover:bg-success/[var(--state-hover-opacity)] active:bg-success/[var(--state-pressed-opacity)] focus-visible:ring-success',
  warning:
    'text-warning hover:bg-warning/[var(--state-hover-opacity)] active:bg-warning/[var(--state-pressed-opacity)] focus-visible:ring-warning',
  info: 'text-info hover:bg-info/[var(--state-hover-opacity)] active:bg-info/[var(--state-pressed-opacity)] focus-visible:ring-info',
  neutral:
    'text-on-surface hover:bg-on-surface/[var(--state-hover-opacity)] active:bg-on-surface/[var(--state-pressed-opacity)] focus-visible:ring-on-surface',
}

/**
 * Color-specific classes for link variant
 */
const linkColorClasses: Record<ButtonColor, string> = {
  primary:
    'text-primary hover:text-primary/80 active:text-primary/70 focus-visible:ring-primary',
  secondary:
    'text-secondary hover:text-secondary/80 active:text-secondary/70 focus-visible:ring-secondary',
  tertiary:
    'text-tertiary hover:text-tertiary/80 active:text-tertiary/70 focus-visible:ring-tertiary',
  error:
    'text-error hover:text-error/80 active:text-error/70 focus-visible:ring-error',
  success:
    'text-success hover:text-success/80 active:text-success/70 focus-visible:ring-success',
  warning:
    'text-warning hover:text-warning/80 active:text-warning/70 focus-visible:ring-warning',
  info: 'text-info hover:text-info/80 active:text-info/70 focus-visible:ring-info',
  neutral:
    'text-on-surface hover:text-on-surface/80 active:text-on-surface/70 focus-visible:ring-on-surface',
}

/**
 * Gradient variants - only supports primary, secondary, tertiary
 * Other colors fallback to primary gradient
 */
const gradientColorClasses: Record<ButtonColor, string> = {
  primary:
    '[background:var(--color-gradient-primary)] text-white after:bg-white focus-visible:ring-surface',
  secondary:
    '[background:var(--color-gradient-secondary)] text-white after:bg-white focus-visible:ring-surface',
  tertiary:
    '[background:var(--color-gradient-tertiary)] text-white after:bg-white focus-visible:ring-surface',
  // Semantic colors use error/success/warning/info gradients
  error:
    '[background:var(--color-gradient-error)] text-white after:bg-white focus-visible:ring-surface',
  success:
    '[background:var(--color-gradient-success)] text-white after:bg-white focus-visible:ring-surface',
  warning:
    '[background:var(--color-gradient-warning)] text-white after:bg-white focus-visible:ring-surface',
  info: '[background:var(--color-gradient-info)] text-white after:bg-white focus-visible:ring-surface',
  neutral:
    '[background:var(--color-gradient-primary)] text-white after:bg-white focus-visible:ring-surface',
}

/**
 * Get variant classes based on variant and color combination
 */
function getVariantClasses(variant: ButtonVariant, color: ButtonColor): string {
  switch (variant) {
    case 'filled':
      return cn(filledStateLayer, filledColorClasses[color], disabledStyles)
    case 'tonal':
      return cn(tonalStateLayer, tonalColorClasses[color], disabledStyles)
    case 'outline':
      return cn(
        'bg-transparent border',
        outlineColorClasses[color],
        disabledStyles,
      )
    case 'outline-2':
      return cn(
        'bg-transparent border-2',
        outlineColorClasses[color],
        disabledStyles,
      )
    case 'text':
      return cn('bg-transparent', textColorClasses[color], disabledStyles)
    case 'link':
      return cn('bg-transparent', linkColorClasses[color], disabledStyles)
    case 'gradient':
      return cn(gradientStateLayer, gradientColorClasses[color], disabledStyles)
    case 'unstyled':
      return 'bg-transparent border-0 p-0 shadow-none hover:shadow-none focus-visible:ring-primary'
    default:
      return cn(filledStateLayer, filledColorClasses.primary, disabledStyles)
  }
}

/**
 * Get default color for a variant
 */
function getDefaultColor(variant: ButtonVariant): ButtonColor {
  switch (variant) {
    case 'outline':
    case 'outline-2':
    case 'text':
      return 'neutral'
    default:
      return 'primary'
  }
}

/**
 * Size classes with accessible typography
 */
const sizeClasses: Record<ButtonSize, string> = {
  xs: 'px-2 py-1 text-label-md gap-1',
  sm: 'px-3 py-1.5 text-body-md gap-1.5',
  md: 'px-4 py-2 text-body-md gap-2',
  lg: 'px-5 py-3 text-body-lg gap-2.5',
}

/**
 * Icon-only size classes (square aspect ratio)
 */
const iconOnlySizeClasses: Record<ButtonSize, string> = {
  xs: 'p-1',
  sm: 'p-1.5',
  md: 'p-2',
  lg: 'p-3',
}

/**
 * Link variant size classes (no padding, just typography)
 */
const linkSizeClasses: Record<ButtonSize, string> = {
  xs: 'text-label-sm gap-1',
  sm: 'text-label-md gap-1.5',
  md: 'text-body-md gap-2',
  lg: 'text-body-lg gap-2.5',
}

/**
 * Loading spinner component
 */
const Spinner: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg
    className="animate-spin"
    width={size}
    height={size}
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

/**
 * Get spinner size based on button size
 */
const getSpinnerSize = (size: ButtonSize): number => {
  switch (size) {
    case 'xs':
      return 12
    case 'sm':
      return 14
    case 'md':
      return 16
    case 'lg':
      return 18
  }
}

/**
 * Get border radius class based on variant and pill prop
 */
function getBorderRadiusClass(variant: ButtonVariant, pill: boolean): string {
  if (variant === 'unstyled') return ''
  if (pill) return 'rounded-full'
  if (variant === 'link') return 'rounded-sm'
  return 'rounded-lg'
}

/**
 * Button component with composable variant and color props
 *
 * **Variants:**
 * - `filled` - Solid background (high emphasis)
 * - `tonal` - Soft container background (medium emphasis)
 * - `outline` - Bordered transparent background (1px border, subtle)
 * - `outline-2` - Bordered transparent background (2px border, bolder)
 * - `text` - No background or border, subtle hover
 * - `link` - Text-only, link-like appearance
 * - `gradient` - Eye-catching gradient background
 * - `unstyled` - No visual styling
 *
 * **Colors:**
 * - `primary`, `secondary`, `tertiary` - Brand colors
 * - `error`, `success`, `warning`, `info` - Semantic colors
 * - `neutral` - Uses on-surface color
 *
 * **Sizes:** xs, sm, md (default), lg
 *
 * **Pill Shape:** Use `pill` prop for fully rounded buttons
 *
 * @example
 * ```tsx
 * // Filled variants with different colors
 * <Button variant="filled" color="primary">Primary</Button>
 * <Button variant="filled" color="error">Delete</Button>
 *
 * // Tonal variants (soft container backgrounds)
 * <Button variant="tonal" color="primary">Tonal Primary</Button>
 * <Button variant="tonal" color="success">Success</Button>
 *
 * // Outline variants (1px border - subtle)
 * <Button variant="outline" color="neutral">Cancel</Button>
 * <Button variant="outline" color="primary">Learn More</Button>
 *
 * // Outline-2 variants (2px border - bolder)
 * <Button variant="outline-2" color="neutral">Cancel</Button>
 * <Button variant="outline-2" color="primary">Learn More</Button>
 *
 * // Gradient variants
 * <Button variant="gradient" color="primary">Gradient</Button>
 * <Button variant="gradient" color="secondary">Secondary Gradient</Button>
 *
 * // Pill-shaped buttons (fully rounded)
 * <Button variant="filled" pill>Pill Button</Button>
 * <Button variant="tonal" color="success" pill>Pill Tonal</Button>
 * <Button variant="outline" pill>Pill Outline</Button>
 * <Button variant="gradient" pill>Pill Gradient</Button>
 *
 * // Text variant
 * <Button variant="text">Text Button</Button>
 * <Button variant="text" color="primary">Primary Text</Button>
 *
 * // Link variant
 * <Button variant="link">Click here</Button>
 * <Button variant="link" underline>Underlined link</Button>
 *
 * // Icon-only button
 * <Button variant="text" iconOnly leftIcon={<X />} aria-label="Close" />
 *
 * // Pill icon-only button
 * <Button variant="filled" iconOnly pill leftIcon={<Plus />} aria-label="Add" />
 *
 * // With icons and loading
 * <Button leftIcon={<Icon />}>With Icon</Button>
 * <Button isLoading>Loading</Button>
 *
 * // Polymorphic usage - render as different elements
 * <Button as="a" href="/home">Link Button</Button>
 * <Button as={Link} to="/about">Router Link</Button>
 * ```
 */
const Button = forwardRefWithAs<'button', ButtonOwnProps>((props, ref) => {
  const {
    as,
    variant = 'filled',
    color,
    size = 'md',
    isLoading = false,
    leftIcon,
    rightIcon,
    fullWidth = false,
    iconOnly = false,
    underline = false,
    pill = false,
    children,
    className,
    disabled,
    type,
    ...rest
  } = props

  const Component = as || 'button'
  const isLinkVariant = variant === 'link'
  const isUnstyled = variant === 'unstyled'

  // Resolve color with default based on variant
  const resolvedColor = color ?? getDefaultColor(variant)

  // Determine which size classes to use
  const getSizeClasses = (): string => {
    if (isUnstyled) return ''
    if (iconOnly) return iconOnlySizeClasses[size]
    if (isLinkVariant) return linkSizeClasses[size]
    return sizeClasses[size]
  }

  const computedClass = cn(
    isLinkVariant ? linkBaseStyles : baseStyles,
    getBorderRadiusClass(variant, pill),
    getVariantClasses(variant, resolvedColor),
    !isUnstyled && getSizeClasses(),
    fullWidth && 'w-full',
    isLinkVariant && underline && 'underline underline-offset-2',
    className,
  )

  const isDisabled = Boolean(disabled || isLoading)

  return (
    <Component
      ref={ref}
      type={Component === 'button' ? (type ?? 'button') : undefined}
      disabled={Component === 'button' ? isDisabled : undefined}
      className={computedClass}
      aria-busy={isLoading || undefined}
      aria-disabled={isDisabled || undefined}
      {...rest}
    >
      {/* Content container with z-10 to stay above state layer (z-1) */}
      <span className="relative z-10 inline-flex items-center justify-center gap-[inherit]">
        {isLoading ? (
          <Spinner size={getSpinnerSize(size)} />
        ) : (
          leftIcon && (
            <span className="flex items-center shrink-0">{leftIcon}</span>
          )
        )}
        {!iconOnly && (
          <span className={isLoading ? 'sr-only' : undefined}>{children}</span>
        )}
        {!isLoading && rightIcon && (
          <span className="flex items-center shrink-0">{rightIcon}</span>
        )}
      </span>
    </Component>
  )
})

Button.displayName = 'Button'

export default Button
