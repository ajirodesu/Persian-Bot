import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/utils/cn.util'
import { useOptionalFieldContext } from '@/components/ui/forms/Field'

type SelectSize = 'sm' | 'md' | 'lg'
type SelectVariant = 'default' | 'filled'
type MenuPosition = 'left' | 'right'

export interface SelectOption {
  value: string
  label: string
  icon?: React.ReactNode
  disabled?: boolean
  divider?: boolean
}

export interface SelectProps {
  /** Array of options to display in the select */
  options: SelectOption[]
  /** Controlled value */
  value?: string
  /** Default value for uncontrolled usage */
  defaultValue?: string
  /** Callback when selection changes */
  onChange?: (value: string) => void
  /** Placeholder text when no option is selected */
  placeholder?: string
  /** Whether the select is disabled (can be inherited from Field) */
  disabled?: boolean
  /** Size variant */
  size?: SelectSize
  /** Visual variant */
  variant?: SelectVariant
  /** Menu alignment relative to button */
  menuPosition?: MenuPosition
  /** Whether select takes full width */
  fullWidth?: boolean
  /** Whether to show checkmark for selected option */
  showCheck?: boolean
  /** Make button pill-shaped (fully rounded) */
  pill?: boolean
  /** Additional CSS classes */
  className?: string
}

/**
 * Base button styles - shared across all variants
 * Note: rounded-lg removed - will be added conditionally with pill prop
 */
const buttonBase =
  'inline-flex items-center justify-between font-medium focus:outline-none disabled:opacity-state-disabled disabled:cursor-not-allowed transition-all duration-fast'

/**
 * Filled variant overlay structure
 * Uses after:rounded-[inherit] to match parent border-radius (supports pill shape)
 */
const filledStateLayer =
  'relative after:absolute after:inset-0 after:rounded-[inherit] after:pointer-events-none after:opacity-0 after:transition-opacity after:duration-fast hover:after:opacity-state-hover active:after:opacity-state-pressed'

/**
 * Variant classes
 */
const variantClasses: Record<SelectVariant, string> = {
  default:
    'bg-transparent text-on-surface border-2 border-outline-variant hover:bg-on-surface/[var(--state-hover-opacity)] active:bg-on-surface/[var(--state-pressed-opacity)] focus:border-primary',
  filled: cn(
    filledStateLayer,
    'bg-primary text-on-primary after:bg-on-primary border-2 border-transparent focus:border-on-primary/50 shadow-elevation-1 hover:shadow-elevation-2',
  ),
}

/**
 * Error state classes for default variant
 */
const errorStateClass = 'border-error focus:border-error'

const sizeClasses: Record<SelectSize, string> = {
  sm: 'px-3 py-1.5 text-body-sm gap-2',
  md: 'px-4 py-2.5 text-body-md gap-2',
  lg: 'px-5 py-3 text-body-lg gap-3',
}

const menuSizeClasses: Record<SelectSize, string> = {
  sm: 'text-body-sm',
  md: 'text-body-md',
  lg: 'text-body-lg',
}

/**
 * Select component - A focused select element with pill shape support
 *
 * This is a simplified select component designed to work with Field wrapper.
 * When used inside Field.Root, it automatically:
 * - Inherits invalid/disabled states
 * - Connects to aria-describedby for helper/error text
 *
 * Features:
 * - Two visual variants: default, filled
 * - Three sizes: sm, md, lg
 * - Icon support for options
 * - Keyboard navigation (Arrow keys, Enter, Escape, Home, End)
 * - Portal-based menu for proper stacking
 * - Full accessibility with ARIA attributes
 * - Integrates seamlessly with Field compound component
 * - Pill shape support via `pill` prop
 *
 * @example
 * ```tsx
 * // Standalone usage with pill
 * <Select
 *   options={[
 *     { value: 'us', label: 'United States' },
 *     { value: 'uk', label: 'United Kingdom' },
 *   ]}
 *   value={country}
 *   onChange={setCountry}
 *   pill
 * />
 *
 * // With Field wrapper (recommended)
 * <Field.Root invalid={!!error} required>
 *   <Field.Label>Country</Field.Label>
 *   <Select options={countries} value={country} onChange={setCountry} pill />
 *   <Field.HelperText>Select your country of residence.</Field.HelperText>
 *   <Field.ErrorText>{error}</Field.ErrorText>
 * </Field.Root>
 * ```
 */
const Select: React.FC<SelectProps> = ({
  options,
  value: controlledValue,
  defaultValue,
  onChange,
  placeholder = 'Select an option',
  disabled: disabledProp = false,
  size = 'md',
  variant = 'default',
  menuPosition = 'left',
  fullWidth = true,
  showCheck = true,
  pill = false,
  className,
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const [internalValue, setInternalValue] = useState(defaultValue || '')
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const [menuRect, setMenuRect] = useState<{
    top: number
    left: number
    width: number
    openAbove: boolean
  } | null>(null)

  const selectRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLUListElement>(null)

  // Get Field context if available
  const fieldContext = useOptionalFieldContext()

  // Use Field context values if available, otherwise use props
  const disabled = fieldContext?.disabled ?? disabledProp
  const hasError = fieldContext?.invalid ?? false
  const descriptionId = fieldContext?.descriptionId
  const labelId = fieldContext?.inputId
    ? `${fieldContext.inputId}-label`
    : undefined

  const isControlled = controlledValue !== undefined
  const value = isControlled ? controlledValue : internalValue

  const selectedOption = options.find((opt) => opt.value === value)
  const enabledOptions = options.filter((opt) => !opt.disabled && !opt.divider)

  // Calculate menu position when opened
  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const updatePosition = () => {
        if (!buttonRef.current) return

        const rect = buttonRef.current.getBoundingClientRect()
        const scrollY = window.scrollY || window.pageYOffset
        const scrollX = window.scrollX || window.pageXOffset

        // Check available space above and below the trigger button.
        // 248 = max-h-60 (240px) + 8px gap — the full menu must fit before committing to a direction.
        const spaceBelow = window.innerHeight - rect.bottom
        const spaceAbove = rect.top
        const openAbove = spaceBelow < 248 && spaceAbove > spaceBelow

        setMenuRect({
          // When opening above, anchor top to the button's top edge so the CSS transform
          // can shift the menu upward by 100% of its own rendered height + the gap.
          // This avoids the need to pre-measure menu height before the portal renders.
          top: openAbove ? rect.top + scrollY : rect.bottom + scrollY + 8,
          left:
            menuPosition === 'left'
              ? rect.left + scrollX
              : rect.right + scrollX - rect.width,
          width: rect.width,
          openAbove,
        })
      }

      updatePosition()
      window.addEventListener('resize', updatePosition)

      return () => {
        window.removeEventListener('resize', updatePosition)
      }
    }
  }, [isOpen, menuPosition])

  // Close select when scrolling outside
  useEffect(() => {
    const handleScroll = (event: Event) => {
      if (!isOpen) return

      const target = event.target as Node | null

      if (target && menuRef.current && menuRef.current.contains(target)) {
        return
      }

      if (target && selectRef.current && selectRef.current.contains(target)) {
        return
      }

      setIsOpen(false)
      setFocusedIndex(-1)
    }

    if (isOpen) {
      window.addEventListener('scroll', handleScroll, true)
      return () => {
        window.removeEventListener('scroll', handleScroll, true)
      }
    }
  }, [isOpen])

  // Close select when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        selectRef.current &&
        !selectRef.current.contains(event.target as Node) &&
        menuRef.current &&
        !menuRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false)
        setFocusedIndex(-1)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return

    switch (e.key) {
      case 'Enter':
      case ' ':
        e.preventDefault()
        if (!isOpen) {
          setIsOpen(true)
          setFocusedIndex(0)
        } else if (focusedIndex >= 0 && enabledOptions[focusedIndex]) {
          handleSelect(enabledOptions[focusedIndex].value)
        }
        break

      case 'Escape':
        e.preventDefault()
        setIsOpen(false)
        setFocusedIndex(-1)
        buttonRef.current?.focus()
        break

      case 'ArrowDown':
        e.preventDefault()
        if (!isOpen) {
          setIsOpen(true)
          setFocusedIndex(0)
        } else {
          setFocusedIndex((prev) =>
            prev < enabledOptions.length - 1 ? prev + 1 : prev,
          )
        }
        break

      case 'ArrowUp':
        e.preventDefault()
        if (isOpen) {
          setFocusedIndex((prev) => (prev > 0 ? prev - 1 : 0))
        }
        break

      case 'Home':
        if (isOpen) {
          e.preventDefault()
          setFocusedIndex(0)
        }
        break

      case 'End':
        if (isOpen) {
          e.preventDefault()
          setFocusedIndex(enabledOptions.length - 1)
        }
        break

      case 'Tab':
        if (isOpen) {
          setIsOpen(false)
          setFocusedIndex(-1)
        }
        break
    }
  }

  // Scroll focused item into view
  useEffect(() => {
    if (isOpen && focusedIndex >= 0 && menuRef.current) {
      const focusedElement = menuRef.current.children[
        focusedIndex
      ] as HTMLElement
      if (focusedElement) {
        focusedElement.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [focusedIndex, isOpen])

  const handleSelect = (optionValue: string) => {
    if (!isControlled) {
      setInternalValue(optionValue)
    }
    onChange?.(optionValue)
    setIsOpen(false)
    setFocusedIndex(-1)
    buttonRef.current?.focus()
  }

  const toggleSelect = () => {
    if (!disabled) {
      setIsOpen((prev) => !prev)
      if (!isOpen) {
        setFocusedIndex(0)
      }
    }
  }

  const generatedId = React.useId()
  const menuId = `select-menu-${generatedId}`

  // Determine placeholder text color based on variant
  const getPlaceholderClass = () => {
    if (selectedOption) return ''

    if (variant === 'filled') {
      return 'text-on-primary/70'
    }

    return 'text-on-surface-variant'
  }

  // Border radius class based on pill prop
  const borderRadiusClass = pill ? 'rounded-full' : 'rounded-lg'

  // Render select menu via portal
  const selectMenu = isOpen && menuRect && (
    <ul
      ref={menuRef}
      id={menuId}
      role="listbox"
      aria-labelledby={labelId}
      style={{
        position: 'absolute',
        top: `${menuRect.top}px`,
        left: `${menuRect.left}px`,
        minWidth: `${menuRect.width}px`,
        // translateY(-100%) moves the menu up by its own rendered height; -8px adds the gap.
        // The button's top-edge anchor (set in updatePosition) makes this work without pre-measuring.
        transform: menuRect.openAbove
          ? 'translateY(calc(-100% - 8px))'
          : undefined,
        zIndex: 'var(--z-dropdown)',
      }}
      className={cn(
        'max-h-60 overflow-auto rounded-lg border border-outline-variant bg-surface shadow-elevation-2',
        menuSizeClasses[size],
      )}
    >
      {options.map((option, index) => {
        if (option.divider) {
          return (
            <li
              key={`divider-${index}`}
              role="separator"
              className="my-1 border-t border-outline-variant"
            />
          )
        }

        const enabledIndex = enabledOptions.findIndex(
          (opt) => opt.value === option.value,
        )
        const isFocused = enabledIndex === focusedIndex
        const isSelected = option.value === value

        return (
          <li
            key={option.value}
            role="option"
            aria-selected={isSelected}
            aria-disabled={option.disabled || undefined}
            className={cn(
              'flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors duration-fast',
              option.disabled
                ? 'opacity-state-disabled cursor-not-allowed'
                : 'hover:bg-on-surface/[var(--state-hover-opacity)] active:bg-on-surface/[var(--state-pressed-opacity)]',
              isFocused &&
                !option.disabled &&
                'bg-on-surface/[var(--state-hover-opacity)]',
              isSelected && 'text-primary font-medium',
            )}
            onClick={() => {
              if (!option.disabled) {
                handleSelect(option.value)
              }
            }}
            onMouseEnter={() => {
              if (!option.disabled) {
                setFocusedIndex(enabledIndex)
              }
            }}
          >
            {showCheck && (
              <span className="flex items-center shrink-0 w-4 h-4">
                {isSelected && <Check className="w-4 h-4" />}
              </span>
            )}

            {option.icon && (
              <span className="flex items-center shrink-0">{option.icon}</span>
            )}

            <span className="flex-1 truncate">{option.label}</span>
          </li>
        )
      })}
    </ul>
  )

  return (
    <div
      ref={selectRef}
      className={cn('relative', fullWidth && 'w-full', className)}
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleSelect}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        className={cn(
          buttonBase,
          borderRadiusClass,
          variantClasses[variant],
          sizeClasses[size],
          fullWidth && 'w-full',
          hasError && variant === 'default' && errorStateClass,
        )}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
        aria-controls={isOpen ? menuId : undefined}
        aria-invalid={hasError || undefined}
      >
        {/* Content wrapper with z-raised to stay above ::after state layer for filled variant */}
        <span className="relative z-raised flex items-center gap-2 truncate">
          {selectedOption?.icon && (
            <span className="flex items-center shrink-0">
              {selectedOption.icon}
            </span>
          )}
          <span className={getPlaceholderClass()}>
            {selectedOption?.label || placeholder}
          </span>
        </span>

        <ChevronDown
          className={cn(
            'relative z-raised transition-transform duration-fast shrink-0',
            isOpen && 'rotate-180',
            size === 'sm' && 'h-4 w-4',
            size === 'md' && 'h-5 w-5',
            size === 'lg' && 'h-6 w-6',
          )}
        />
      </button>

      {/* Render menu via portal */}
      {isOpen && createPortal(selectMenu, document.body)}
    </div>
  )
}

Select.displayName = 'Select'

export default Select
