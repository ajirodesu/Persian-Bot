import React, { useState } from 'react'
import { cn } from '@/utils/cn.util'
import { useOptionalFieldContext } from '@/components/ui/forms/Field'

type TextareaVariant = 'default' | 'subtle'
type TextareaSize = 'sm' | 'md' | 'lg'
type TextareaColor =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'info'
  | 'success'
  | 'warning'
  | 'error'
type TextareaResize = 'none' | 'vertical' | 'horizontal' | 'both'

export interface TextareaProps extends Omit<
  React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  'size'
> {
  /** Visual variant of the textarea */
  variant?: TextareaVariant
  /** Accent color for focus border (overridden by Field context states) */
  color?: TextareaColor
  /** Size of the textarea field */
  textareaSize?: TextareaSize
  /** Resize behavior */
  resize?: TextareaResize
  /** Whether the textarea should take full width of its container */
  fullWidth?: boolean
  /** Auto-grow height based on content */
  autoGrow?: boolean
  /** Maximum height when autoGrow is enabled (in pixels) */
  maxAutoGrowHeight?: number
}

/**
 * Base textarea styles - shared across all variants
 */
const base =
  'w-full rounded-lg text-on-surface focus:outline-none disabled:opacity-state-disabled disabled:cursor-not-allowed placeholder:text-on-surface-variant transition-all duration-fast'

/**
 * Variant classes
 */
const variantClasses: Record<TextareaVariant, string> = {
  default: 'bg-transparent border-2 border-outline-variant',
  subtle:
    'border-2 border-transparent bg-surface-container hover:bg-surface-container-high',
}

/**
 * Color classes for focus states
 */
const colorClasses: Record<TextareaColor, string> = {
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

const sizeClasses: Record<TextareaSize, string> = {
  sm: 'px-3 py-1.5 text-body-sm',
  md: 'px-4 py-2.5 text-body-md',
  lg: 'px-5 py-3 text-body-lg',
}

const resizeClasses: Record<TextareaResize, string> = {
  none: 'resize-none',
  vertical: 'resize-y',
  horizontal: 'resize-x',
  both: 'resize',
}

/**
 * Textarea component - A multiline text input
 *
 * Designed to work with Field wrapper for form integration.
 * When used inside Field.Root, it automatically:
 * - Binds to the field's generated ID
 * - Inherits invalid/success/disabled/readOnly states
 * - Connects to aria-describedby for helper/error text
 *
 * Features:
 * - Two variants: default, subtle
 * - Seven accent colors
 * - Three sizes: sm, md, lg
 * - Configurable resize behavior
 * - Auto-grow option for dynamic height
 * - Full accessibility with proper ARIA attributes
 *
 * @example
 * ```tsx
 * // Basic usage
 * <Textarea placeholder="Enter your message" rows={4} />
 *
 * // With Field wrapper (recommended)
 * <Field.Root invalid={!!error} required>
 *   <Field.Label>Message</Field.Label>
 *   <Textarea placeholder="Enter your message" rows={4} />
 *   <Field.HelperText>Max 500 characters</Field.HelperText>
 *   <Field.ErrorText>{error}</Field.ErrorText>
 * </Field.Root>
 *
 * // Auto-grow textarea
 * <Textarea autoGrow maxAutoGrowHeight={300} placeholder="Start typing..." />
 * ```
 */
const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      variant = 'default',
      color = 'primary',
      textareaSize = 'md',
      resize = 'vertical',
      fullWidth = true,
      autoGrow = false,
      maxAutoGrowHeight = 400,
      className,
      disabled: disabledProp,
      readOnly: readOnlyProp,
      id: idProp,
      rows = 3,
      onChange,
      ...props
    },
    ref,
  ) => {
    const [internalHeight, setInternalHeight] = useState<number | undefined>(
      undefined,
    )
    const internalRef = React.useRef<HTMLTextAreaElement>(null)

    // Merge refs
    const textareaRef =
      (ref as React.RefObject<HTMLTextAreaElement>) || internalRef

    // Get Field context if available
    const fieldContext = useOptionalFieldContext()

    // Use Field context values if available, otherwise use props
    const inputId = fieldContext?.inputId ?? idProp
    const disabled = fieldContext?.disabled ?? disabledProp
    const readOnly = fieldContext?.readOnly ?? readOnlyProp
    const hasError = fieldContext?.invalid ?? false
    const hasSuccess = fieldContext?.success ?? false
    const descriptionId = fieldContext?.descriptionId

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (autoGrow && textareaRef.current) {
        // Reset height to auto to get the correct scrollHeight
        textareaRef.current.style.height = 'auto'
        const scrollHeight = textareaRef.current.scrollHeight
        const newHeight = Math.min(scrollHeight, maxAutoGrowHeight)
        setInternalHeight(newHeight)
        textareaRef.current.style.height = `${newHeight}px`
      }
      onChange?.(e)
    }

    const computedClass = cn(
      base,
      variantClasses[variant],
      hasError
        ? stateClasses.error
        : hasSuccess
          ? stateClasses.success
          : colorClasses[color],
      sizeClasses[textareaSize],
      !autoGrow && resizeClasses[resize],
      autoGrow && 'resize-none overflow-hidden',
      className,
    )

    return (
      <div className={cn('relative', fullWidth && 'w-full')}>
        <textarea
          ref={textareaRef}
          id={inputId}
          className={computedClass}
          disabled={disabled}
          readOnly={readOnly}
          rows={rows}
          onChange={handleChange}
          aria-invalid={hasError || undefined}
          aria-describedby={descriptionId}
          style={
            autoGrow && internalHeight ? { height: internalHeight } : undefined
          }
          {...props}
        />
      </div>
    )
  },
)

Textarea.displayName = 'Textarea'

export default Textarea
