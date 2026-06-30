import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react'
import { cn } from '@/utils/cn.util'
import {
  forwardRefWithAs,
  type PolymorphicComponentPropsWithRef,
} from '@/utils/polymorphic.util'

/**
 * Alert visual style variants
 * - tonal: Soft container backgrounds for subtle feedback
 * - filled: Solid backgrounds for high-emphasis alerts
 * - outlined: Border-only style for minimal look
 * - gradient: Vibrant gradient backgrounds for maximum impact
 * - accent: Left border accent with subtle background
 */
export type AlertVariant =
  | 'tonal'
  | 'filled'
  | 'outlined'
  | 'gradient'
  | 'accent'

/**
 * Alert color options (semantic meaning)
 * - success: Positive feedback, confirmations
 * - error: Errors, failures, critical issues
 * - warning: Cautions, important notices
 * - info: Informational messages, tips
 */
export type AlertColor = 'success' | 'error' | 'warning' | 'info'

export type AlertSize = 'sm' | 'md' | 'lg'

export interface AlertAction {
  label: string
  onClick: () => void
  variant?: 'primary' | 'secondary'
}

/**
 * Base props for Alert component (excluding HTML attributes)
 */
export type AlertOwnProps = {
  /** Visual variant style */
  variant?: AlertVariant
  /** Color scheme - determines semantic meaning */
  color?: AlertColor
  /** Size of the alert */
  size?: AlertSize
  /** Alert title (required) */
  title: string
  /** Optional description message */
  message?: string
  /** Custom icon to override default color icon */
  icon?: React.ReactNode
  /** Hide the icon */
  hideIcon?: boolean
  /** Callback when close button is clicked */
  onClose?: () => void
  /** Action buttons to display */
  actions?: AlertAction[]
}

/**
 * Polymorphic Alert props - supports `as` prop for rendering as different elements
 * @example
 * ```tsx
 * <Alert as="section" title="Info" />
 * <Alert as="article" title="News" />
 * ```
 */
export type AlertProps<T extends React.ElementType = 'div'> =
  PolymorphicComponentPropsWithRef<T, AlertOwnProps>

/**
 * Default icons for each color
 */
const colorIcons: Record<AlertColor, React.ReactNode> = {
  success: <CheckCircle2 className="h-5 w-5 flex-shrink-0" />,
  error: <AlertCircle className="h-5 w-5 flex-shrink-0" />,
  warning: <AlertTriangle className="h-5 w-5 flex-shrink-0" />,
  info: <Info className="h-5 w-5 flex-shrink-0" />,
}

/**
 * Size-specific icon classes
 */
const sizeIconClasses: Record<AlertSize, string> = {
  sm: '[&>svg]:h-4 [&>svg]:w-4',
  md: '[&>svg]:h-5 [&>svg]:w-5',
  lg: '[&>svg]:h-6 [&>svg]:w-6',
}

/**
 * Size styles for padding and typography
 */
const sizeStyles: Record<AlertSize, string> = {
  sm: 'px-3 py-2 text-body-sm',
  md: 'px-4 py-3 text-body-md',
  lg: 'px-5 py-4 text-body-lg',
}

/**
 * Title size classes
 */
const titleSizeClasses: Record<AlertSize, string> = {
  sm: 'text-label-md',
  md: 'text-label-lg',
  lg: 'text-title-sm',
}

/**
 * Tonal variant - soft container backgrounds
 */
const tonalStyles: Record<AlertColor, string> = {
  success: 'bg-success-container text-on-success-container border-success/20',
  error: 'bg-error-container text-on-error-container border-error/20',
  warning: 'bg-warning-container text-on-warning-container border-warning/20',
  info: 'bg-info-container text-on-info-container border-info/20',
}

/**
 * Filled variant - solid backgrounds
 */
const filledStyles: Record<AlertColor, string> = {
  success: 'bg-success text-on-success border-transparent',
  error: 'bg-error text-on-error border-transparent',
  warning: 'bg-warning text-on-warning border-transparent',
  info: 'bg-info text-on-info border-transparent',
}

/**
 * Outlined variant - border only
 */
const outlinedStyles: Record<AlertColor, string> = {
  success: 'bg-transparent text-success border-success border-2',
  error: 'bg-transparent text-error border-error border-2',
  warning: 'bg-transparent text-warning border-warning border-2',
  info: 'bg-transparent text-info border-info border-2',
}

/**
 * Gradient variant - vibrant gradient backgrounds using CSS variables
 */
const gradientStyles: Record<AlertColor, string> = {
  success:
    'text-white border-transparent [background:var(--color-gradient-success)]',
  error:
    'text-white border-transparent [background:var(--color-gradient-error)]',
  warning:
    'text-white border-transparent [background:var(--color-gradient-warning)]',
  info: 'text-white border-transparent [background:var(--color-gradient-info)]',
}

/**
 * Accent variant - left border accent with tonal background
 */
const accentStyles: Record<AlertColor, string> = {
  success:
    'bg-success-container/50 text-on-success-container border-l-4 border-l-success border-y-0 border-r-0 rounded-l-none',
  error:
    'bg-error-container/50 text-on-error-container border-l-4 border-l-error border-y-0 border-r-0 rounded-l-none',
  warning:
    'bg-warning-container/50 text-on-warning-container border-l-4 border-l-warning border-y-0 border-r-0 rounded-l-none',
  info: 'bg-info-container/50 text-on-info-container border-l-4 border-l-info border-y-0 border-r-0 rounded-l-none',
}

/**
 * Map variant to style record
 */
const variantStyleMap: Record<AlertVariant, Record<AlertColor, string>> = {
  tonal: tonalStyles,
  filled: filledStyles,
  outlined: outlinedStyles,
  gradient: gradientStyles,
  accent: accentStyles,
}

/**
 * Action button styles based on variant and color
 */
const getActionButtonStyles = (
  variant: AlertVariant,
  color: AlertColor,
  actionVariant: 'primary' | 'secondary',
): string => {
  const base =
    'px-3 py-1.5 rounded-md text-label-md font-medium transition-all duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1'

  // For filled and gradient backgrounds, use inverse/light colors for buttons
  if (variant === 'filled' || variant === 'gradient') {
    if (actionVariant === 'primary') {
      return cn(base, 'bg-surface/20 hover:bg-surface/30 text-inherit')
    }
    return cn(base, 'hover:bg-surface/10 text-inherit')
  }

  // For other variants, use color-based styles
  const colorButtonMap: Record<AlertColor, string> = {
    success:
      actionVariant === 'primary'
        ? 'bg-success text-on-success hover:bg-success/90 focus-visible:ring-success'
        : 'text-success hover:bg-success/10 focus-visible:ring-success',
    error:
      actionVariant === 'primary'
        ? 'bg-error text-on-error hover:bg-error/90 focus-visible:ring-error'
        : 'text-error hover:bg-error/10 focus-visible:ring-error',
    warning:
      actionVariant === 'primary'
        ? 'bg-warning text-on-warning hover:bg-warning/90 focus-visible:ring-warning'
        : 'text-warning hover:bg-warning/10 focus-visible:ring-warning',
    info:
      actionVariant === 'primary'
        ? 'bg-info text-on-info hover:bg-info/90 focus-visible:ring-info'
        : 'text-info hover:bg-info/10 focus-visible:ring-info',
  }

  return cn(base, colorButtonMap[color])
}

/**
 * Alert component for displaying feedback messages
 *
 * Uses composable variant + color props pattern (same as Button):
 * - variant: Controls visual style (tonal, filled, outlined, gradient, accent)
 * - color: Controls semantic color scheme (success, error, warning, info)
 *
 * @example
 * ```tsx
 * // Basic usage (defaults: variant="tonal", color="info")
 * <Alert title="Information" />
 *
 * // With variant and color
 * <Alert
 *   variant="filled"
 *   color="error"
 *   title="Error occurred"
 *   message="Please try again later."
 * />
 *
 * // Gradient variant
 * <Alert
 *   variant="gradient"
 *   color="success"
 *   title="Payment successful"
 *   message="Your transaction has been processed."
 * />
 *
 * // With actions
 * <Alert
 *   variant="accent"
 *   color="warning"
 *   title="Unsaved changes"
 *   actions={[
 *     { label: 'Save', onClick: handleSave, variant: 'primary' },
 *     { label: 'Discard', onClick: handleDiscard, variant: 'secondary' },
 *   ]}
 * />
 *
 * // Polymorphic usage
 * <Alert as="section" title="Info" />
 * <Alert as="article" title="News" />
 * ```
 */
const Alert = forwardRefWithAs<'div', AlertOwnProps>((props, ref) => {
  const {
    as,
    variant = 'tonal',
    color = 'info',
    size = 'md',
    title,
    message,
    icon,
    hideIcon = false,
    onClose,
    actions,
    className,
    ...rest
  } = props

  const Component = as || 'div'
  const variantStyles = variantStyleMap[variant]
  const colorStyle = variantStyles[color]
  const displayIcon = icon ?? colorIcons[color]

  return (
    <Component
      ref={ref}
      className={cn(
        'rounded-lg border animate-in fade-in duration-fast flex items-start gap-3',
        sizeStyles[size],
        colorStyle,
        className,
      )}
      role="alert"
      aria-live={onClose ? 'polite' : undefined}
      {...rest}
    >
      {/* Icon */}
      {!hideIcon && (
        <div className={cn('flex-shrink-0 mt-0.5', sizeIconClasses[size])}>
          {displayIcon}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className={cn('font-semibold', titleSizeClasses[size])}>{title}</p>
        {message && (
          <p
            className={cn(
              'mt-1 opacity-90',
              size === 'sm' ? 'text-body-sm' : 'text-body-sm',
            )}
          >
            {message}
          </p>
        )}

        {/* Actions */}
        {actions && actions.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {actions.map((action, index) => (
              <button
                key={index}
                onClick={action.onClick}
                className={getActionButtonStyles(
                  variant,
                  color,
                  action.variant ?? 'secondary',
                )}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Close button */}
      {onClose && (
        <button
          onClick={onClose}
          className={cn(
            'flex-shrink-0 p-1 rounded-md hover:opacity-70 transition-opacity duration-fast',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current focus-visible:ring-offset-1',
          )}
          aria-label="Dismiss alert"
        >
          <X
            className={cn(
              size === 'sm'
                ? 'h-3.5 w-3.5'
                : size === 'lg'
                  ? 'h-5 w-5'
                  : 'h-4 w-4',
            )}
          />
        </button>
      )}
    </Component>
  )
})

Alert.displayName = 'Alert'

export default Alert
