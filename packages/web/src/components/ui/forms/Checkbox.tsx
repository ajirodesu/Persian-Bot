import React, { useState } from 'react'
import { Check, Minus } from 'lucide-react'
import { cn } from '@/utils/cn.util'
import { useOptionalFieldContext } from '@/components/ui/forms/Field'

type CheckboxSize = 'sm' | 'md' | 'lg'
type CheckboxColor =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'error'
  | 'success'
  | 'warning'
  | 'info'

export interface CheckboxProps {
  /** Controlled checked state */
  checked?: boolean
  /** Default checked state for uncontrolled usage */
  defaultChecked?: boolean
  /** Callback when checked state changes */
  onChange?: (checked: boolean) => void
  /** Whether the checkbox is disabled (can be inherited from Field) */
  disabled?: boolean
  /** Label text displayed next to the checkbox */
  label?: string
  /** Size of the checkbox */
  size?: CheckboxSize
  /** Indeterminate state (useful for "select all" patterns) */
  indeterminate?: boolean
  /** Color variant for the checked state */
  color?: CheckboxColor
  /** Unique identifier */
  id?: string
  /** Form input name */
  name?: string
  /** Form input value */
  value?: string
  /** Additional CSS classes */
  className?: string
}

/**
 * Size configurations for the checkbox
 */
const sizeConfig = {
  sm: {
    container: 'w-4 h-4',
    icon: 'w-3 h-3',
    label: 'text-label-md',
    gap: 'gap-2',
  },
  md: {
    container: 'w-5 h-5',
    icon: 'w-3.5 h-3.5',
    label: 'text-body-md',
    gap: 'gap-2.5',
  },
  lg: {
    container: 'w-6 h-6',
    icon: 'w-4 h-4',
    label: 'text-body-lg',
    gap: 'gap-3',
  },
}

/**
 * Color classes for checked state
 */
const colorClasses: Record<CheckboxColor, string> = {
  primary: 'bg-primary border-primary',
  secondary: 'bg-secondary border-secondary',
  tertiary: 'bg-tertiary border-tertiary',
  error: 'bg-error border-error',
  success: 'bg-success border-success',
  warning: 'bg-warning border-warning',
  info: 'bg-info border-info',
}

/**
 * Icon color classes (text color on checked background)
 */
const iconColorClasses: Record<CheckboxColor, string> = {
  primary: 'text-on-primary',
  secondary: 'text-on-secondary',
  tertiary: 'text-on-tertiary',
  error: 'text-on-error',
  success: 'text-on-success',
  warning: 'text-on-warning',
  info: 'text-on-info',
}

/**
 * Focus ring color classes
 */
const focusRingClasses: Record<CheckboxColor, string> = {
  primary: 'focus-visible:ring-primary',
  secondary: 'focus-visible:ring-secondary',
  tertiary: 'focus-visible:ring-tertiary',
  error: 'focus-visible:ring-error',
  success: 'focus-visible:ring-success',
  warning: 'focus-visible:ring-warning',
  info: 'focus-visible:ring-info',
}

/**
 * Checkbox component with controlled/uncontrolled modes
 *
 * Features:
 * - Three sizes: sm, md, lg
 * - Seven color variants
 * - Controlled and uncontrolled modes
 * - Indeterminate state for "select all" patterns
 * - Optional label with click-to-toggle
 * - Full keyboard accessibility (Space, Enter)
 * - Integrates with Field compound component
 * - M3-compliant styling with proper state layers
 *
 * @example
 * ```tsx
 * // Basic usage
 * <Checkbox checked={accepted} onChange={setAccepted} />
 *
 * // With label
 * <Checkbox
 *   label="I accept the terms and conditions"
 *   checked={accepted}
 *   onChange={setAccepted}
 * />
 *
 * // Different sizes and colors
 * <Checkbox size="lg" color="success" label="Completed" />
 *
 * // Indeterminate state
 * <Checkbox
 *   indeterminate={someSelected && !allSelected}
 *   checked={allSelected}
 *   onChange={handleSelectAll}
 *   label="Select all"
 * />
 *
 * // With Field wrapper
 * <Field.Root invalid={!!error}>
 *   <Checkbox label="Subscribe to newsletter" name="subscribe" />
 *   <Field.ErrorText>{error}</Field.ErrorText>
 * </Field.Root>
 * ```
 */
const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  (
    {
      checked: controlledChecked,
      defaultChecked = false,
      onChange,
      disabled: disabledProp,
      label,
      size = 'md',
      indeterminate = false,
      color = 'primary',
      id: idProp,
      name,
      value,
      className,
    },
    ref,
  ) => {
    const [internalChecked, setInternalChecked] = useState(defaultChecked)

    // Get Field context if available
    const fieldContext = useOptionalFieldContext()

    // Use Field context values if available, otherwise use props
    const disabled = fieldContext?.disabled ?? disabledProp
    const inputId = fieldContext?.inputId ?? idProp

    const isControlled = controlledChecked !== undefined
    const checked = isControlled ? controlledChecked : internalChecked

    const generatedId = React.useId()
    const checkboxId = inputId || `checkbox-${generatedId}`

    const config = sizeConfig[size]

    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      if (disabled) return

      const newChecked = event.target.checked

      if (!isControlled) {
        setInternalChecked(newChecked)
      }

      onChange?.(newChecked)
    }

    const checkboxElement = (
      <span className="relative inline-flex items-center justify-center">
        {/* Hidden native input for form compatibility and accessibility */}
        <input
          ref={ref}
          type="checkbox"
          id={checkboxId}
          name={name}
          value={value}
          checked={checked}
          disabled={disabled}
          onChange={handleChange}
          className="sr-only peer"
          aria-checked={indeterminate ? 'mixed' : checked}
        />

        {/* Custom checkbox visual */}
        <span
          className={cn(
            // Base styles
            'inline-flex items-center justify-center rounded border-2 transition-all duration-fast ease-standard',
            config.container,
            // Unchecked state
            !checked && !indeterminate && 'border-outline bg-transparent',
            // Checked/indeterminate state
            (checked || indeterminate) && colorClasses[color],
            // Focus ring (triggered by peer focus)
            'peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-surface',
            focusRingClasses[color],
            // Hover state
            !disabled && 'cursor-pointer hover:border-on-surface/60',
            !disabled && (checked || indeterminate) && 'hover:opacity-90',
            // Disabled state
            disabled && 'opacity-state-disabled cursor-not-allowed',
          )}
          aria-hidden="true"
        >
          {/* Check icon */}
          {checked && !indeterminate && (
            <Check
              className={cn('absolute', config.icon, iconColorClasses[color])}
              strokeWidth={3}
            />
          )}
          {/* Indeterminate icon */}
          {indeterminate && (
            <Minus
              className={cn('absolute', config.icon, iconColorClasses[color])}
              strokeWidth={3}
            />
          )}
        </span>
      </span>
    )

    // If no label, return just the checkbox
    if (!label) {
      return (
        <span className={cn('inline-flex', className)}>{checkboxElement}</span>
      )
    }

    // With label, wrap in a label element for better UX
    return (
      <label
        htmlFor={checkboxId}
        className={cn(
          'inline-flex items-center',
          config.gap,
          disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
          className,
        )}
      >
        {checkboxElement}
        <span
          className={cn(
            'font-medium text-on-surface select-none',
            config.label,
          )}
        >
          {label}
        </span>
      </label>
    )
  },
)

Checkbox.displayName = 'Checkbox'

export default Checkbox
