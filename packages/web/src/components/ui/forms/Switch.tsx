import React, { useState } from 'react'
import { cn } from '@/utils/cn.util'

type SwitchSize = 'sm' | 'md' | 'lg'

export interface SwitchProps {
  checked?: boolean
  defaultChecked?: boolean
  onChange?: (checked: boolean) => void
  disabled?: boolean
  label?: string
  size?: SwitchSize
  id?: string
  name?: string
  className?: string
}

// Size configurations for the switch
const sizeConfig = {
  sm: {
    container: 'w-9 h-5',
    thumb: 'w-3 h-3',
    translate: 'translate-x-5',
    label: 'text-label-md',
  },
  md: {
    container: 'w-11 h-6',
    thumb: 'w-4 h-4',
    translate: 'translate-x-6',
    label: 'text-body-md',
  },
  lg: {
    container: 'w-14 h-7',
    thumb: 'w-5 h-5',
    translate: 'translate-x-8',
    label: 'text-body-lg',
  },
}

/**
 * Switch component for boolean on/off states
 *
 * Features:
 * - Three sizes: sm, md, lg
 * - Controlled and uncontrolled modes
 * - Optional label with click-to-toggle
 * - Full keyboard accessibility (Space, Enter)
 * - Disabled state
 * - M3-compliant colors
 *
 * @example
 * ```tsx
 * // Basic usage
 * <Switch checked={enabled} onChange={setEnabled} />
 *
 * // With label
 * <Switch
 *   label="Enable notifications"
 *   checked={notifications}
 *   onChange={setNotifications}
 * />
 *
 * // Different sizes
 * <Switch size="sm" label="Small switch" />
 * <Switch size="lg" label="Large switch" />
 * ```
 */
const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  (
    {
      checked: controlledChecked,
      defaultChecked = false,
      onChange,
      disabled = false,
      label,
      size = 'md',
      id,
      name,
      className,
    },
    ref,
  ) => {
    const [internalChecked, setInternalChecked] = useState(defaultChecked)

    const isControlled = controlledChecked !== undefined
    const checked = isControlled ? controlledChecked : internalChecked

    const generatedId = React.useId()
    const switchId = id || `switch-${generatedId}`

    const config = sizeConfig[size]

    const handleToggle = () => {
      if (disabled) return

      const newChecked = !checked

      if (!isControlled) {
        setInternalChecked(newChecked)
      }

      onChange?.(newChecked)
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (disabled) return

      // Support Space and Enter keys
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        handleToggle()
      }
    }

    const switchButton = (
      <button
        ref={ref}
        type="button"
        role="switch"
        id={switchId}
        name={name}
        aria-checked={checked}
        aria-disabled={disabled || undefined}
        disabled={disabled}
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
        className={cn(
          'relative inline-flex items-center rounded-full transition-colors duration-fast focus:outline-none focus:ring-2 focus:ring-primary/20 focus:ring-offset-2 focus:ring-offset-surface',
          config.container,
          checked ? 'bg-primary' : 'bg-outline',
          disabled
            ? 'opacity-state-disabled cursor-not-allowed'
            : 'cursor-pointer hover:opacity-90',
          className,
        )}
      >
        <span className="sr-only">
          {label || (checked ? 'Enabled' : 'Disabled')}
        </span>

        {/* Thumb - uses on-primary when checked for proper contrast in both themes */}
        <span
          className={cn(
            'inline-block rounded-full transition-all duration-fast ease-standard transform',
            config.thumb,
            checked ? 'bg-on-primary' : 'bg-surface',
            checked ? config.translate : 'translate-x-1',
          )}
          aria-hidden="true"
        />
      </button>
    )

    // If no label, return just the switch
    if (!label) {
      return switchButton
    }

    // With label, wrap in a label element for better UX
    return (
      <label
        htmlFor={switchId}
        className={cn(
          'inline-flex items-center gap-3',
          disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        )}
      >
        {switchButton}
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

Switch.displayName = 'Switch'

export default Switch
