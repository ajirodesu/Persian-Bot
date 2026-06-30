import React from 'react'
import { cn } from '@/utils/cn.util'
import { useOptionalFieldContext } from '@/components/ui/forms/Field'

type InputVariant = 'default' | 'subtle'
type InputSize = 'sm' | 'md' | 'lg'
type InputColor =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'info'
  | 'success'
  | 'warning'
  | 'error'

export interface InputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'size'
> {
  /** Visual variant of the input */
  variant?: InputVariant
  /** Accent color for focus border (overridden by Field context states) */
  color?: InputColor
  /** Size of the input field */
  inputSize?: InputSize
  /** Icon displayed on the left side of the input */
  leftIcon?: React.ReactNode
  /** Icon displayed on the right side of the input */
  rightIcon?: React.ReactNode
  /** Whether the input should take full width of its container */
  fullWidth?: boolean
  /** Make input pill-shaped (fully rounded) */
  pill?: boolean
}

/**
 * Base input styles - shared across all variants
 * All variants use border-2 for consistent sizing (no layout shift).
 */
const base =
  'w-full text-on-surface focus:outline-none disabled:opacity-state-disabled disabled:cursor-not-allowed placeholder:text-on-surface-variant transition-all duration-fast'

/**
 * Variant classes with consistent border-2 sizing
 */
const variantClasses: Record<InputVariant, string> = {
  default: 'bg-transparent border-2 border-outline-variant',
  subtle:
    'border-2 border-transparent bg-surface-container hover:bg-surface-container-high',
}

/**
 * Color classes for focus states
 */
const colorClasses: Record<InputColor, string> = {
  primary: 'focus:border-primary',
  secondary: 'focus:border-secondary',
  tertiary: 'focus:border-tertiary',
  info: 'focus:border-info',
  success: 'focus:border-success',
  warning: 'focus:border-warning',
  error: 'focus:border-error',
}

/**
 * Validation state classes from Field context
 */
const stateClasses = {
  error:
    'border-error text-on-surface focus:border-error bg-error-container/30',
  success:
    'border-success text-on-surface focus:border-success bg-success-container/30',
}

const sizeClasses: Record<InputSize, string> = {
  sm: 'px-3 py-1.5 text-body-sm',
  md: 'px-4 py-2.5 text-body-md',
  lg: 'px-5 py-3 text-body-lg',
}

const iconSizeClasses: Record<InputSize, string> = {
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-6 w-6',
}
/**
 * Border radius class based on pill prop
 */
const getBorderRadiusClass = (pill: boolean): string =>
  pill ? 'rounded-full' : 'rounded-lg'

/**
 * Input component - A focused input element
 *
 * This is a simplified input component designed to work with Field wrapper.
 * When used inside Field.Root, it automatically:
 * - Binds to the field's generated ID
 * - Inherits invalid/success/disabled/readOnly states
 * - Connects to aria-describedby for helper/error text
 *
 * Features:
 * - Two variants: default, subtle
 * - Seven accent colors: primary, secondary, tertiary, info, success, warning, error
 * - Three sizes: sm, md, lg
 * - Left and right icon support
 * - Full accessibility with proper ARIA attributes
 * - Integrates seamlessly with Field compound component
 *
 * @example
 * ```tsx
 * // Standalone usage (basic)
 * <Input placeholder="Enter text" />
 *
 * // With Field wrapper (recommended)
 * <Field.Root invalid={!!error} required>
 *   <Field.Label>Email</Field.Label>
 *   <Input placeholder="Enter email" leftIcon={<Mail size={18} />} />
 *   <Field.HelperText>We'll never share your email.</Field.HelperText>
 *   <Field.ErrorText>{error}</Field.ErrorText>
 * </Field.Root>
 *
 * // With icons and validation icon from Field
 * <Field.Root success>
 *   <Field.Label>Username</Field.Label>
 *   <div className="relative">
 *     <Input placeholder="Username" />
 *     <div className="absolute right-3 top-1/2 -translate-y-1/2">
 *       <Field.ValidationIcon />
 *     </div>
 *   </div>
 * </Field.Root>
 * ```
 */
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      variant = 'default',
      color = 'primary',
      inputSize = 'md',
      leftIcon,
      rightIcon,
      fullWidth = true,
      pill = false,
      className,
      disabled: disabledProp,
      readOnly: readOnlyProp,
      id: idProp,
      ...props
    },
    ref,
  ) => {
    // Get Field context if available
    const fieldContext = useOptionalFieldContext()

    // Use Field context values if available, otherwise use props
    const inputId = fieldContext?.inputId ?? idProp
    const disabled = fieldContext?.disabled ?? disabledProp
    const readOnly = fieldContext?.readOnly ?? readOnlyProp
    const hasError = fieldContext?.invalid ?? false
    const hasSuccess = fieldContext?.success ?? false
    const descriptionId = fieldContext?.descriptionId

    const computedClass = cn(
      getBorderRadiusClass(pill),
      base,
      variantClasses[variant],
      // Apply state classes if error/success from context, otherwise apply color classes
      hasError
        ? stateClasses.error
        : hasSuccess
          ? stateClasses.success
          : colorClasses[color],
      sizeClasses[inputSize],
      !!leftIcon && 'pl-10',
      !!rightIcon && 'pr-10',
      className,
    )

    return (
      <div className={cn('relative', fullWidth && 'w-full')}>
        {leftIcon && (
          <div
            className={cn(
              // Added justify-center to prevent padded icons from shifting off-center
              'absolute left-3 top-1/2 -translate-y-1/2 flex items-center justify-center text-on-surface-variant pointer-events-none z-10',
              iconSizeClasses[inputSize],
            )}
            aria-hidden="true"
          >
            {leftIcon}
          </div>
        )}

        <input
          ref={ref}
          id={inputId}
          className={computedClass}
          disabled={disabled}
          readOnly={readOnly}
          aria-invalid={hasError || undefined}
          aria-describedby={descriptionId}
          {...props}
        />

        {rightIcon && (
          <div
            className={cn(
              // Added justify-center for perfect alignment of interactive buttons that overflow the wrapper
              'absolute right-3 top-1/2 -translate-y-1/2 flex items-center justify-center text-on-surface-variant pointer-events-none z-10',
              iconSizeClasses[inputSize],
            )}
            // aria-hidden removed because rightIcon is often an interactive button that needs to be announced
          >
            {rightIcon}
          </div>
        )}
      </div>
    )
  },
)

Input.displayName = 'Input'

export default Input
