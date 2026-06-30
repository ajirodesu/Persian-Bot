import { useState, useCallback } from 'react'
import { Copy, Check } from 'lucide-react'
import { cn } from '@/utils/cn.util'
import {
  forwardRefWithAs,
  type PolymorphicComponentPropsWithRef,
} from '@/utils/polymorphic.util'

/**
 * ClipboardButton visual style variants
 * - filled: Solid background with high emphasis
 * - tonal: Soft container background with medium emphasis
 * - outline: Bordered with transparent background (1px border, subtle)
 * - outline-2: Bordered with transparent background (2px border, bolder)
 * - text: No background or border, subtle hover
 * - link: Text-only, link-like appearance
 * - gradient: Eye-catching gradient background
 * - unstyled: No visual styling
 */
export type ClipboardButtonVariant =
  | 'filled'
  | 'tonal'
  | 'outline'
  | 'outline-2'
  | 'text'
  | 'link'
  | 'gradient'
  | 'unstyled'

/**
 * ClipboardButton color options
 * - primary/secondary/tertiary: Brand colors
 * - error/success/warning/info: Semantic status colors
 * - neutral: Uses on-surface color (for outline/text variants)
 */
export type ClipboardButtonColor =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'error'
  | 'success'
  | 'warning'
  | 'info'
  | 'neutral'

export type ClipboardButtonSize = 'sm' | 'md' | 'lg'

/**
 * Base props for ClipboardButton component (excluding HTML attributes)
 */
export type ClipboardButtonOwnProps = {
  /** Text content to copy to clipboard */
  text: string
  /** Visual variant style */
  variant?: ClipboardButtonVariant
  /** Color scheme */
  color?: ClipboardButtonColor
  /** Size of the button */
  size?: ClipboardButtonSize
  /** Duration in ms to show success state */
  successDuration?: number
  /** Callback when copy succeeds */
  onCopySuccess?: () => void
  /** Callback when copy fails */
  onCopyError?: (error: Error) => void
  /** Custom aria-label (defaults to "Copy to clipboard") */
  'aria-label'?: string
}

/**
 * Polymorphic ClipboardButton props - supports `as` prop for rendering as different elements
 * @example
 * ```tsx
 * <ClipboardButton text="Hello" as="div" />
 * ```
 */
export type ClipboardButtonProps<T extends React.ElementType = 'button'> =
  PolymorphicComponentPropsWithRef<T, ClipboardButtonOwnProps>

/**
 * Base button styles - square icon button
 */
const baseStyles =
  'relative inline-flex items-center justify-center rounded-lg font-medium transition-all duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-state-disabled active:scale-[0.95]'

/**
 * State layer for filled/tonal variants
 */
const stateLayerBase =
  'after:absolute after:inset-0 after:z-[1] after:rounded-lg after:pointer-events-none after:opacity-0 after:transition-opacity after:duration-fast after:will-change-[opacity] hover:after:opacity-state-hover active:after:opacity-state-pressed disabled:after:opacity-0'

/**
 * Size classes - square dimensions
 */
const sizeClasses: Record<ClipboardButtonSize, string> = {
  sm: 'w-8 h-8',
  md: 'w-10 h-10',
  lg: 'w-12 h-12',
}

/**
 * Icon size classes
 */
const iconSizeClasses: Record<ClipboardButtonSize, string> = {
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-6 w-6',
}

/**
 * Filled variant color classes
 */
const filledColorClasses: Record<ClipboardButtonColor, string> = {
  primary: cn(
    stateLayerBase,
    'bg-primary text-on-primary after:bg-on-primary focus-visible:ring-primary',
  ),
  secondary: cn(
    stateLayerBase,
    'bg-secondary text-on-secondary after:bg-on-secondary focus-visible:ring-secondary',
  ),
  tertiary: cn(
    stateLayerBase,
    'bg-tertiary text-on-tertiary after:bg-on-tertiary focus-visible:ring-tertiary',
  ),
  error: cn(
    stateLayerBase,
    'bg-error text-on-error after:bg-on-error focus-visible:ring-error',
  ),
  success: cn(
    stateLayerBase,
    'bg-success text-on-success after:bg-on-success focus-visible:ring-success',
  ),
  warning: cn(
    stateLayerBase,
    'bg-warning text-on-warning after:bg-on-warning focus-visible:ring-warning',
  ),
  info: cn(
    stateLayerBase,
    'bg-info text-on-info after:bg-on-info focus-visible:ring-info',
  ),
  neutral: cn(
    stateLayerBase,
    'bg-on-surface text-surface after:bg-surface focus-visible:ring-on-surface',
  ),
}

/**
 * Tonal variant color classes
 */
const tonalColorClasses: Record<ClipboardButtonColor, string> = {
  primary: cn(
    stateLayerBase,
    'bg-primary-container text-on-primary-container after:bg-on-primary-container focus-visible:ring-primary',
  ),
  secondary: cn(
    stateLayerBase,
    'bg-secondary-container text-on-secondary-container after:bg-on-secondary-container focus-visible:ring-secondary',
  ),
  tertiary: cn(
    stateLayerBase,
    'bg-tertiary-container text-on-tertiary-container after:bg-on-tertiary-container focus-visible:ring-tertiary',
  ),
  error: cn(
    stateLayerBase,
    'bg-error-container text-on-error-container after:bg-on-error-container focus-visible:ring-error',
  ),
  success: cn(
    stateLayerBase,
    'bg-success-container text-on-success-container after:bg-on-success-container focus-visible:ring-success',
  ),
  warning: cn(
    stateLayerBase,
    'bg-warning-container text-on-warning-container after:bg-on-warning-container focus-visible:ring-warning',
  ),
  info: cn(
    stateLayerBase,
    'bg-info-container text-on-info-container after:bg-on-info-container focus-visible:ring-info',
  ),
  neutral: cn(
    stateLayerBase,
    'bg-surface-container text-on-surface after:bg-on-surface focus-visible:ring-on-surface',
  ),
}

/**
 * Outline variant color classes (1px border - subtle)
 */
const outlineColorClasses: Record<ClipboardButtonColor, string> = {
  primary:
    'bg-transparent border border-primary text-primary hover:bg-primary/[var(--state-hover-opacity)] active:bg-primary/[var(--state-pressed-opacity)] focus-visible:ring-primary disabled:border-outline-variant',
  secondary:
    'bg-transparent border border-secondary text-secondary hover:bg-secondary/[var(--state-hover-opacity)] active:bg-secondary/[var(--state-pressed-opacity)] focus-visible:ring-secondary disabled:border-outline-variant',
  tertiary:
    'bg-transparent border border-tertiary text-tertiary hover:bg-tertiary/[var(--state-hover-opacity)] active:bg-tertiary/[var(--state-pressed-opacity)] focus-visible:ring-tertiary disabled:border-outline-variant',
  error:
    'bg-transparent border border-error text-error hover:bg-error/[var(--state-hover-opacity)] active:bg-error/[var(--state-pressed-opacity)] focus-visible:ring-error disabled:border-outline-variant',
  success:
    'bg-transparent border border-success text-success hover:bg-success/[var(--state-hover-opacity)] active:bg-success/[var(--state-pressed-opacity)] focus-visible:ring-success disabled:border-outline-variant',
  warning:
    'bg-transparent border border-warning text-warning hover:bg-warning/[var(--state-hover-opacity)] active:bg-warning/[var(--state-pressed-opacity)] focus-visible:ring-warning disabled:border-outline-variant',
  info: 'bg-transparent border border-info text-info hover:bg-info/[var(--state-hover-opacity)] active:bg-info/[var(--state-pressed-opacity)] focus-visible:ring-info disabled:border-outline-variant',
  neutral:
    'bg-transparent border border-outline text-on-surface hover:bg-on-surface/[var(--state-hover-opacity)] active:bg-on-surface/[var(--state-pressed-opacity)] focus-visible:ring-on-surface disabled:border-outline-variant',
}

/**
 * Outline-2 variant color classes (2px border - bolder)
 */
const outline2ColorClasses: Record<ClipboardButtonColor, string> = {
  primary:
    'bg-transparent border-2 border-primary text-primary hover:bg-primary/[var(--state-hover-opacity)] active:bg-primary/[var(--state-pressed-opacity)] focus-visible:ring-primary disabled:border-outline-variant',
  secondary:
    'bg-transparent border-2 border-secondary text-secondary hover:bg-secondary/[var(--state-hover-opacity)] active:bg-secondary/[var(--state-pressed-opacity)] focus-visible:ring-secondary disabled:border-outline-variant',
  tertiary:
    'bg-transparent border-2 border-tertiary text-tertiary hover:bg-tertiary/[var(--state-hover-opacity)] active:bg-tertiary/[var(--state-pressed-opacity)] focus-visible:ring-tertiary disabled:border-outline-variant',
  error:
    'bg-transparent border-2 border-error text-error hover:bg-error/[var(--state-hover-opacity)] active:bg-error/[var(--state-pressed-opacity)] focus-visible:ring-error disabled:border-outline-variant',
  success:
    'bg-transparent border-2 border-success text-success hover:bg-success/[var(--state-hover-opacity)] active:bg-success/[var(--state-pressed-opacity)] focus-visible:ring-success disabled:border-outline-variant',
  warning:
    'bg-transparent border-2 border-warning text-warning hover:bg-warning/[var(--state-hover-opacity)] active:bg-warning/[var(--state-pressed-opacity)] focus-visible:ring-warning disabled:border-outline-variant',
  info: 'bg-transparent border-2 border-info text-info hover:bg-info/[var(--state-hover-opacity)] active:bg-info/[var(--state-pressed-opacity)] focus-visible:ring-info disabled:border-outline-variant',
  neutral:
    'bg-transparent border-2 border-outline text-on-surface hover:bg-on-surface/[var(--state-hover-opacity)] active:bg-on-surface/[var(--state-pressed-opacity)] focus-visible:ring-on-surface disabled:border-outline-variant',
}

/**
 * Text variant color classes
 */
const textColorClasses: Record<ClipboardButtonColor, string> = {
  primary:
    'bg-transparent text-primary hover:bg-primary/[var(--state-hover-opacity)] active:bg-primary/[var(--state-pressed-opacity)] focus-visible:ring-primary',
  secondary:
    'bg-transparent text-secondary hover:bg-secondary/[var(--state-hover-opacity)] active:bg-secondary/[var(--state-pressed-opacity)] focus-visible:ring-secondary',
  tertiary:
    'bg-transparent text-tertiary hover:bg-tertiary/[var(--state-hover-opacity)] active:bg-tertiary/[var(--state-pressed-opacity)] focus-visible:ring-tertiary',
  error:
    'bg-transparent text-error hover:bg-error/[var(--state-hover-opacity)] active:bg-error/[var(--state-pressed-opacity)] focus-visible:ring-error',
  success:
    'bg-transparent text-success hover:bg-success/[var(--state-hover-opacity)] active:bg-success/[var(--state-pressed-opacity)] focus-visible:ring-success',
  warning:
    'bg-transparent text-warning hover:bg-warning/[var(--state-hover-opacity)] active:bg-warning/[var(--state-pressed-opacity)] focus-visible:ring-warning',
  info: 'bg-transparent text-info hover:bg-info/[var(--state-hover-opacity)] active:bg-info/[var(--state-pressed-opacity)] focus-visible:ring-info',
  neutral:
    'bg-transparent text-on-surface hover:bg-on-surface/[var(--state-hover-opacity)] active:bg-on-surface/[var(--state-pressed-opacity)] focus-visible:ring-on-surface',
}

/**
 * Link variant color classes
 */
const linkColorClasses: Record<ClipboardButtonColor, string> = {
  primary:
    'bg-transparent text-primary hover:text-primary/80 active:text-primary/70 focus-visible:ring-primary',
  secondary:
    'bg-transparent text-secondary hover:text-secondary/80 active:text-secondary/70 focus-visible:ring-secondary',
  tertiary:
    'bg-transparent text-tertiary hover:text-tertiary/80 active:text-tertiary/70 focus-visible:ring-tertiary',
  error:
    'bg-transparent text-error hover:text-error/80 active:text-error/70 focus-visible:ring-error',
  success:
    'bg-transparent text-success hover:text-success/80 active:text-success/70 focus-visible:ring-success',
  warning:
    'bg-transparent text-warning hover:text-warning/80 active:text-warning/70 focus-visible:ring-warning',
  info: 'bg-transparent text-info hover:text-info/80 active:text-info/70 focus-visible:ring-info',
  neutral:
    'bg-transparent text-on-surface hover:text-on-surface/80 active:text-on-surface/70 focus-visible:ring-on-surface',
}

/**
 * Gradient variants - uses design system gradient tokens
 */
const gradientColorClasses: Record<ClipboardButtonColor, string> = {
  primary:
    '[background:var(--color-gradient-primary)] text-white after:bg-white focus-visible:ring-surface',
  secondary:
    '[background:var(--color-gradient-secondary)] text-white after:bg-white focus-visible:ring-surface',
  tertiary:
    '[background:var(--color-gradient-tertiary)] text-white after:bg-white focus-visible:ring-surface',
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
 * State layer for gradient variant (different opacity values)
 */
const gradientStateLayer = `${stateLayerBase} hover:after:opacity-[0.15] active:after:opacity-[0.25]`

/**
 * Unstyled variant - no visual styling
 */
const unstyledClass =
  'bg-transparent border-0 p-0 shadow-none hover:shadow-none focus-visible:ring-primary'

/**
 * Map variant to color class record
 */
const variantColorMap: Record<
  ClipboardButtonVariant,
  Record<ClipboardButtonColor, string> | string
> = {
  filled: filledColorClasses,
  tonal: tonalColorClasses,
  outline: outlineColorClasses,
  'outline-2': outline2ColorClasses,
  text: textColorClasses,
  link: linkColorClasses,
  gradient: gradientColorClasses,
  unstyled: unstyledClass,
}

/**
 * Get variant classes based on variant and color combination
 */
function getVariantClasses(
  variant: ClipboardButtonVariant,
  color: ClipboardButtonColor,
): string {
  const variantStyles = variantColorMap[variant]

  if (variant === 'unstyled') {
    return unstyledClass
  }

  if (variant === 'gradient') {
    return cn(
      gradientStateLayer,
      (variantStyles as Record<ClipboardButtonColor, string>)[color],
    )
  }

  return (variantStyles as Record<ClipboardButtonColor, string>)[color]
}

/**
 * Get default color for a variant (matches Button component defaults)
 */
function getDefaultColor(
  variant: ClipboardButtonVariant,
): ClipboardButtonColor {
  switch (variant) {
    case 'outline':
    case 'outline-2':
    case 'text':
    case 'link':
      return 'neutral'
    default:
      return 'primary'
  }
}

/**
 * ClipboardButton - A simple button to copy text to clipboard
 *
 * Shows a copy icon that changes to a checkmark on successful copy,
 * then reverts back after a configurable duration.
 *
 * **Variants (8):**
 * - `filled` - Solid background (high emphasis)
 * - `tonal` - Soft container background (medium emphasis)
 * - `outline` - Bordered transparent background (1px border, subtle)
 * - `outline-2` - Bordered transparent background (2px border, bolder)
 * - `text` - No background or border, subtle hover
 * - `link` - Text-only, link-like appearance
 * - `gradient` - Eye-catching gradient background
 * - `unstyled` - No visual styling
 *
 * **Colors (8):**
 * - `primary`, `secondary`, `tertiary` - Brand colors
 * - `error`, `success`, `warning`, `info` - Semantic colors
 * - `neutral` - Uses on-surface color
 *
 * @example
 * ```tsx
 * // Basic usage (defaults: variant="text", color="neutral")
 * <ClipboardButton text="Hello, World!" />
 *
 * // Filled variants with different colors
 * <ClipboardButton text="Copy code" variant="filled" color="primary" />
 * <ClipboardButton text="Copy error" variant="filled" color="error" />
 *
 * // Tonal variants (soft container backgrounds)
 * <ClipboardButton text="Copy" variant="tonal" color="success" />
 *
 * // Outline variants (1px border - subtle)
 * <ClipboardButton text="Copy" variant="outline" />
 * <ClipboardButton text="Copy" variant="outline" color="primary" />
 *
 * // Outline-2 variants (2px border - bolder)
 * <ClipboardButton text="Copy" variant="outline-2" />
 * <ClipboardButton text="Copy" variant="outline-2" color="secondary" />
 *
 * // Gradient variants
 * <ClipboardButton text="Copy" variant="gradient" color="primary" />
 * <ClipboardButton text="Copy" variant="gradient" color="success" />
 *
 * // With callbacks
 * <ClipboardButton
 *   text={codeSnippet}
 *   onCopySuccess={() => toast('Copied!')}
 *   onCopyError={(err) => console.error(err)}
 * />
 *
 * // Polymorphic usage
 * <ClipboardButton text="Hello" as="div" />
 * ```
 */
const ClipboardButton = forwardRefWithAs<'button', ClipboardButtonOwnProps>(
  (props, ref) => {
    const {
      as,
      text,
      variant = 'text',
      color,
      size = 'md',
      successDuration = 2000,
      onCopySuccess,
      onCopyError,
      className,
      disabled,
      'aria-label': ariaLabel = 'Copy to clipboard',
      ...rest
    } = props

    const Component = as || 'button'
    const [isCopied, setIsCopied] = useState(false)

    // Resolve color with default based on variant (matches Button component logic)
    const resolvedColor = color ?? getDefaultColor(variant)

    const handleCopy = useCallback(async () => {
      if (disabled || isCopied) return

      try {
        await navigator.clipboard.writeText(text)
        setIsCopied(true)
        onCopySuccess?.()

        // Reset after duration
        setTimeout(() => {
          setIsCopied(false)
        }, successDuration)
      } catch (error) {
        const err =
          error instanceof Error
            ? error
            : new Error('Failed to copy to clipboard')
        onCopyError?.(err)
        console.error('Clipboard copy failed:', err)
      }
    }, [text, disabled, isCopied, successDuration, onCopySuccess, onCopyError])

    const variantClasses = getVariantClasses(variant, resolvedColor)
    const iconSize = iconSizeClasses[size]

    // Only add button-specific props if rendering as button
    const buttonProps =
      Component === 'button'
        ? {
            type: 'button' as const,
            disabled: disabled,
          }
        : {}

    return (
      <Component
        ref={ref}
        onClick={handleCopy}
        aria-label={isCopied ? 'Copied!' : ariaLabel}
        aria-live="polite"
        aria-disabled={disabled || undefined}
        className={cn(baseStyles, variantClasses, sizeClasses[size], className)}
        {...buttonProps}
        {...rest}
      >
        <span className="relative z-10 flex items-center justify-center">
          {isCopied ? (
            <Check className={iconSize} aria-hidden="true" />
          ) : (
            <Copy className={iconSize} aria-hidden="true" />
          )}
        </span>
      </Component>
    )
  },
)

ClipboardButton.displayName = 'ClipboardButton'

export default ClipboardButton
