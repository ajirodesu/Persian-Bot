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
// Square-track geometry: every size is an instrument toggle with a hairline
// rail and a rectangular thumb. `md` is the reference 40×22 track with an
// 18×18 thumb; sm/lg scale it down/up by one step.
const sizeConfig = {
  sm: {
    container: 'w-8 h-[18px]',
    thumb: 'w-3.5 h-3.5',
    translate: 'translate-x-[16px]',
    label: 'text-label-md',
  },
  md: {
    container: 'w-10 h-[22px]',
    thumb: 'w-[18px] h-[18px]',
    translate: 'translate-x-[20px]',
    label: 'text-body-md',
  },
  lg: {
    container: 'w-12 h-[26px]',
    thumb: 'w-[22px] h-[22px]',
    translate: 'translate-x-[24px]',
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
          // All three sizes (20/24/28px tall) are well under the 44px HIG
          // minimum. Unlike Checkbox's unlabeled case, this IS a real
          // <button onClick>, so the hit-slop ::before pattern actually
          // extends the clickable area (clicks on the pseudo-element's
          // painted region still target the button).
          'relative inline-flex items-center rounded-[var(--radius-compact)] transition-colors duration-fast focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary before:absolute before:left-1/2 before:top-1/2 before:h-[var(--touch-target-min)] before:w-[var(--touch-target-min)] before:-translate-x-1/2 before:-translate-y-1/2 before:content-[""]',
          config.container,
          // The unchecked track uses the input-boundary token: it is the one
          // neutral that clears 3:1 against the surface thumb, so the state
          // reads without relying on the label.
          checked ? 'bg-primary' : 'bg-[var(--color-input-border)]',
          disabled
            ? 'opacity-state-disabled cursor-not-allowed'
            : 'cursor-pointer',
          className,
        )}
      >
        <span className="sr-only">
          {label || (checked ? 'Enabled' : 'Disabled')}
        </span>

        {/* Thumb - uses on-primary when checked for proper contrast in both themes */}
        <span
          className={cn(
            'inline-block rounded-[1px] transition-transform duration-fast ease-standard',
            config.thumb,
            checked ? 'bg-on-primary' : 'bg-surface',
            checked ? config.translate : 'translate-x-[2px]',
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
