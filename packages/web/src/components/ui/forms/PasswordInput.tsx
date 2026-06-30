import React, { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { cn } from '@/utils/cn.util'
import Input, { type InputProps } from '@/components/ui/forms/Input'

export interface PasswordInputProps extends Omit<
  InputProps,
  'type' | 'rightIcon'
> {
  /** Whether to show the visibility toggle button */
  showToggle?: boolean
  /** Initial visibility state (uncontrolled mode) */
  defaultVisible?: boolean
  /** Controlled visibility state */
  visible?: boolean
  /** Callback when visibility changes */
  onVisibilityChange?: (visible: boolean) => void
}

/**
 * Toggle button size classes match Input's internal icon sizing
 * Ensures consistent spacing with Input's existing icon slots
 */
const toggleButtonSizeClasses = {
  sm: 'p-1',
  md: 'p-1.5',
  lg: 'p-2',
}

const iconSizeClasses = {
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-6 w-6',
}

/**
 * PasswordInput component - Password input with visibility toggle
 *
 * Built on top of Input component to ensure consistent styling and behavior.
 * Adds password-specific features:
 * - Automatic type switching between 'password' and 'text'
 * - Visibility toggle button (Eye/EyeOff icon)
 * - Controlled and uncontrolled visibility modes
 *
 * Inherits all Input features:
 * - Two variants: default, subtle
 * - Seven accent colors: primary, secondary, tertiary, info, success, warning, error
 * - Three sizes: sm, md, lg
 * - Left icon support
 * - Pill shape option
 * - Full Field context integration
 * - All accessibility features
 *
 * @example
 * ```tsx
 * // Basic usage
 * <PasswordInput placeholder="Enter password" />
 *
 * // With Field wrapper (recommended)
 * <Field.Root invalid={!!error} required>
 *   <Field.Label>Password</Field.Label>
 *   <PasswordInput placeholder="Enter password" />
 *   <Field.HelperText>Must be at least 8 characters</Field.HelperText>
 *   <Field.ErrorText>{error}</Field.ErrorText>
 * </Field.Root>
 *
 * // With left icon and controlled visibility
 * <PasswordInput
 *   leftIcon={<Lock size={18} />}
 *   visible={showPassword}
 *   onVisibilityChange={setShowPassword}
 * />
 *
 * // Without toggle button
 * <PasswordInput showToggle={false} />
 * ```
 */
const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  (
    {
      showToggle = true,
      defaultVisible = false,
      visible: controlledVisible,
      onVisibilityChange,
      inputSize = 'md',
      disabled,
      ...inputProps
    },
    ref,
  ) => {
    // Uncontrolled visibility state
    const [internalVisible, setInternalVisible] = useState(defaultVisible)

    // Determine if visibility is controlled or uncontrolled
    const isVisibilityControlled = controlledVisible !== undefined
    const isVisible = isVisibilityControlled
      ? controlledVisible
      : internalVisible

    const toggleVisibility = () => {
      if (disabled) return

      const newVisible = !isVisible

      // Update internal state only if uncontrolled
      if (!isVisibilityControlled) {
        setInternalVisible(newVisible)
      }

      // Always call callback if provided
      onVisibilityChange?.(newVisible)
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        toggleVisibility()
      }
    }

    const VisibilityIcon = isVisible ? EyeOff : Eye

    // Create toggle button as rightIcon if showToggle is true
    const toggleButton = showToggle ? (
      <button
        type="button"
        onClick={toggleVisibility}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        className={cn(
          // Added pointer-events-auto to override the wrapper's pointer-events-none in Input.tsx
          'flex items-center justify-center rounded text-on-surface-variant transition-colors duration-fast pointer-events-auto',
          toggleButtonSizeClasses[inputSize],
          !disabled &&
            'hover:text-on-surface hover:bg-on-surface/[var(--state-hover-opacity)]',
          disabled && 'cursor-not-allowed opacity-state-disabled',
        )}
        aria-label={isVisible ? 'Hide password' : 'Show password'}
        title={isVisible ? 'Hide password' : 'Show password'}
        tabIndex={disabled ? -1 : 0}
      >
        <VisibilityIcon className={iconSizeClasses[inputSize]} />
      </button>
    ) : undefined

    return (
      <Input
        ref={ref}
        type={isVisible ? 'text' : 'password'}
        inputSize={inputSize}
        disabled={disabled}
        rightIcon={toggleButton}
        {...inputProps}
      />
    )
  },
)

PasswordInput.displayName = 'PasswordInput'

export default PasswordInput
