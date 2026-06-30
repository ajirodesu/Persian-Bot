import React, { createContext, useContext, useId, useMemo } from 'react'
import { AlertCircle, CheckCircle } from 'lucide-react'
import { cn } from '@/utils/cn.util'

/**
 * Field Context - shares state across compound components
 */
interface FieldContextValue {
  /** Unique ID for the field input */
  inputId: string
  /** ID for the description (helper text or error) */
  descriptionId: string
  /** Whether the field has an error */
  invalid: boolean
  /** Whether the field is in success state */
  success: boolean
  /** Whether the field is required */
  required: boolean
  /** Whether the field is disabled */
  disabled: boolean
  /** Whether the field is read-only */
  readOnly: boolean
}

const FieldContext = createContext<FieldContextValue | undefined>(undefined)

/**
 * Hook to access Field context
 * @throws Error if used outside of Field.Root
 */
const useFieldContext = () => {
  const context = useContext(FieldContext)
  if (!context) {
    throw new Error('Field compound components must be used within Field.Root')
  }
  return context
}

/**
 * Hook to optionally access Field context (for inputs that can work standalone)
 */
// eslint-disable-next-line react-refresh/only-export-components
export const useOptionalFieldContext = () => {
  return useContext(FieldContext)
}

// ============================================================================
// Field.Root
// ============================================================================

interface FieldRootProps {
  /** Field content */
  children: React.ReactNode
  /** Whether the field is in error state */
  invalid?: boolean
  /** Whether the field is in success state */
  success?: boolean
  /** Whether the field is required */
  required?: boolean
  /** Whether the field is disabled */
  disabled?: boolean
  /** Whether the field is read-only */
  readOnly?: boolean
  /** Additional CSS classes */
  className?: string
}

/**
 * Field.Root - Container component that provides context to all Field parts
 *
 * Props cascade down to child components:
 * - invalid: Shows error styling and error text
 * - success: Shows success styling
 * - required: Shows required indicator
 * - disabled: Disables the input
 * - readOnly: Makes input read-only
 *
 * @example
 * ```tsx
 * <Field.Root invalid={!!errors.email} required>
 *   <Field.Label>Email</Field.Label>
 *   <Input placeholder="Enter email" />
 *   <Field.HelperText>We'll never share your email.</Field.HelperText>
 *   <Field.ErrorText>{errors.email}</Field.ErrorText>
 * </Field.Root>
 * ```
 */
function FieldRoot({
  children,
  invalid = false,
  success = false,
  required = false,
  disabled = false,
  readOnly = false,
  className,
}: FieldRootProps) {
  const generatedId = useId()
  const inputId = `field-input-${generatedId}`
  const descriptionId = `field-desc-${generatedId}`

  const contextValue = useMemo<FieldContextValue>(
    () => ({
      inputId,
      descriptionId,
      invalid,
      success: success && !invalid, // error takes precedence
      required,
      disabled,
      readOnly,
    }),
    [inputId, descriptionId, invalid, success, required, disabled, readOnly],
  )

  return (
    <FieldContext.Provider value={contextValue}>
      <div className={cn('relative w-full', className)}>{children}</div>
    </FieldContext.Provider>
  )
}

// ============================================================================
// Field.Label
// ============================================================================

interface FieldLabelProps {
  /** Label text */
  children: React.ReactNode
  /** Additional CSS classes */
  className?: string
}

/**
 * Field.Label - Label component with automatic htmlFor binding
 *
 * Automatically:
 * - Sets htmlFor to the field input ID
 * - Shows required indicator when field is required
 * - Applies disabled styling when field is disabled
 */
function FieldLabel({ children, className }: FieldLabelProps) {
  const { inputId, required, disabled } = useFieldContext()

  return (
    <label
      htmlFor={inputId}
      className={cn(
        'block text-label-md font-medium text-on-surface mb-2',
        disabled && 'opacity-state-disabled',
        className,
      )}
    >
      {children}
      {required && <FieldRequiredIndicator />}
    </label>
  )
}

// ============================================================================
// Field.RequiredIndicator
// ============================================================================

interface FieldRequiredIndicatorProps {
  /** Custom indicator content (defaults to " *") */
  children?: React.ReactNode
  /** Fallback text when not required (e.g., "(optional)") */
  fallback?: React.ReactNode
  /** Additional CSS classes */
  className?: string
}

/**
 * Field.RequiredIndicator - Shows required or optional indicator
 *
 * Can be used standalone within Field.Label for custom positioning,
 * or automatically included when using Field.Label with required=true
 */
function FieldRequiredIndicator({
  children,
  fallback,
  className,
}: FieldRequiredIndicatorProps) {
  const { required } = useFieldContext()

  if (!required && fallback) {
    return (
      <span
        className={cn('text-on-surface-variant font-normal ml-1', className)}
      >
        {fallback}
      </span>
    )
  }

  if (!required) {
    return null
  }

  return (
    <span className={cn('text-error ml-0.5', className)} aria-hidden="true">
      {children ?? ' *'}
    </span>
  )
}

// ============================================================================
// Field.HelperText
// ============================================================================

interface FieldHelperTextProps {
  /** Helper text content */
  children: React.ReactNode
  /** Additional CSS classes */
  className?: string
}

/**
 * Field.HelperText - Displays helper text below the input
 *
 * Automatically hidden when field is in error state (Field.ErrorText shown instead)
 */
function FieldHelperText({ children, className }: FieldHelperTextProps) {
  const { descriptionId, invalid, disabled } = useFieldContext()

  // Hide helper text when showing error
  if (invalid) {
    return null
  }

  return (
    <p
      id={descriptionId}
      className={cn(
        'mt-1.5 text-body-sm text-on-surface-variant',
        disabled && 'opacity-state-disabled',
        className,
      )}
    >
      {children}
    </p>
  )
}

// ============================================================================
// Field.ErrorText
// ============================================================================

interface FieldErrorTextProps {
  /** Error message content */
  children: React.ReactNode
  /** Additional CSS classes */
  className?: string
}

/**
 * Field.ErrorText - Displays error message below the input
 *
 * Only rendered when field is in error state (invalid=true)
 * Automatically sets role="alert" for accessibility
 */
function FieldErrorText({ children, className }: FieldErrorTextProps) {
  const { descriptionId, invalid } = useFieldContext()

  // Only show when invalid
  if (!invalid) {
    return null
  }

  return (
    <p
      id={descriptionId}
      role="alert"
      className={cn('mt-1.5 text-body-sm text-error', className)}
    >
      {children}
    </p>
  )
}

// ============================================================================
// Field.ValidationIcon
// ============================================================================

interface FieldValidationIconProps {
  /** Size of the icon */
  size?: 'sm' | 'md' | 'lg'
  /** Additional CSS classes */
  className?: string
}

const iconSizeClasses = {
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-6 w-6',
}

/**
 * Field.ValidationIcon - Shows check or error icon based on field state
 *
 * Useful for displaying validation state icons inside input containers
 */
function FieldValidationIcon({
  size = 'md',
  className,
}: FieldValidationIconProps) {
  const { invalid, success } = useFieldContext()

  if (!invalid && !success) {
    return null
  }

  const Icon = invalid ? AlertCircle : CheckCircle
  const colorClass = invalid ? 'text-error' : 'text-success'

  return (
    <Icon
      className={cn(iconSizeClasses[size], colorClass, className)}
      aria-hidden="true"
    />
  )
}

// ============================================================================
// Field Compound Component Export
// ============================================================================

/**
 * Field - Compound component for form field encapsulation
 *
 * Inspired by Chakra UI's Field component pattern, this provides:
 * - Automatic ID generation and binding
 * - State cascading (invalid, success, required, disabled, readOnly)
 * - Proper ARIA attributes
 * - Separation of concerns between label, input, and messages
 *
 * @example
 * ```tsx
 * // Basic usage
 * <Field.Root>
 *   <Field.Label>Email</Field.Label>
 *   <Input placeholder="Enter email" />
 *   <Field.HelperText>We'll never share your email.</Field.HelperText>
 * </Field.Root>
 *
 * // With validation
 * <Field.Root invalid={!!error} required>
 *   <Field.Label>Username</Field.Label>
 *   <Input placeholder="Choose username" />
 *   <Field.HelperText>Must be unique.</Field.HelperText>
 *   <Field.ErrorText>{error}</Field.ErrorText>
 * </Field.Root>
 *
 * // Success state
 * <Field.Root success>
 *   <Field.Label>Email</Field.Label>
 *   <Input defaultValue="valid@email.com" />
 *   <Field.HelperText>Email verified!</Field.HelperText>
 * </Field.Root>
 * ```
 */
// eslint-disable-next-line react-refresh/only-export-components
export const Field = {
  Root: FieldRoot,
  Label: FieldLabel,
  RequiredIndicator: FieldRequiredIndicator,
  HelperText: FieldHelperText,
  ErrorText: FieldErrorText,
  ValidationIcon: FieldValidationIcon,
}

export default Field
