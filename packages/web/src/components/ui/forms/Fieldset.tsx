import React, { createContext, useContext, useId, useMemo } from 'react'
import { cn } from '@/utils/cn.util'

/**
 * Fieldset Context - shares state across compound components
 *
 * Unlike Field (for single inputs), Fieldset is designed for grouping
 * multiple related form controls like checkbox groups or radio groups.
 */
interface FieldsetContextValue {
  /** Whether the fieldset is in invalid state */
  invalid: boolean
  /** Whether the fieldset is disabled */
  disabled: boolean
  /** ID for the legend element */
  legendId: string
  /** ID for the description (helper text or error) */
  descriptionId: string
}

const FieldsetContext = createContext<FieldsetContextValue | undefined>(
  undefined,
)

/**
 * Hook to access Fieldset context
 * @throws Error if used outside of Fieldset.Root
 */
const useFieldsetContext = () => {
  const context = useContext(FieldsetContext)
  if (!context) {
    throw new Error(
      'Fieldset compound components must be used within Fieldset.Root',
    )
  }
  return context
}

/**
 * Hook to optionally access Fieldset context
 * Useful for components that can work both standalone and within Fieldset
 */
// eslint-disable-next-line react-refresh/only-export-components
export const useOptionalFieldsetContext = () => {
  return useContext(FieldsetContext)
}

// ============================================================================
// Fieldset.Root
// ============================================================================

interface FieldsetRootProps {
  /** Fieldset content */
  children: React.ReactNode
  /** Whether the fieldset is in invalid/error state */
  invalid?: boolean
  /** Whether all form controls within the fieldset are disabled */
  disabled?: boolean
  /** Additional CSS classes */
  className?: string
}

/**
 * Fieldset.Root - Semantic container for grouping related form controls
 *
 * Renders a native `<fieldset>` element for proper accessibility.
 * Use this for grouping checkbox groups, radio groups, or related inputs.
 *
 * Props cascade down to child components:
 * - invalid: Shows error styling and error text
 * - disabled: Disables all form controls within the fieldset
 *
 * @example
 * ```tsx
 * <Fieldset.Root invalid={hasErrors}>
 *   <Fieldset.Legend>Select your preferences</Fieldset.Legend>
 *   <Fieldset.Content>
 *     {checkboxes}
 *   </Fieldset.Content>
 *   <Fieldset.HelperText>Choose at least one option.</Fieldset.HelperText>
 *   <Fieldset.ErrorText>Please select at least one option.</Fieldset.ErrorText>
 * </Fieldset.Root>
 * ```
 */
function FieldsetRoot({
  children,
  invalid = false,
  disabled = false,
  className,
}: FieldsetRootProps) {
  const generatedId = useId()
  const legendId = `fieldset-legend-${generatedId}`
  const descriptionId = `fieldset-desc-${generatedId}`

  const contextValue = useMemo<FieldsetContextValue>(
    () => ({
      invalid,
      disabled,
      legendId,
      descriptionId,
    }),
    [invalid, disabled, legendId, descriptionId],
  )

  return (
    <FieldsetContext.Provider value={contextValue}>
      <fieldset
        className={cn(
          'relative w-full border-0 p-0 m-0',
          disabled && 'opacity-state-disabled',
          className,
        )}
        disabled={disabled}
        aria-describedby={descriptionId}
        aria-invalid={invalid || undefined}
      >
        {children}
      </fieldset>
    </FieldsetContext.Provider>
  )
}

// ============================================================================
// Fieldset.Legend
// ============================================================================

interface FieldsetLegendProps {
  /** Legend text content */
  children: React.ReactNode
  /** Additional CSS classes */
  className?: string
}

/**
 * Fieldset.Legend - Caption for the fieldset group
 *
 * Renders a native `<legend>` element for proper accessibility.
 * Screen readers will announce this as the group label.
 */
function FieldsetLegend({ children, className }: FieldsetLegendProps) {
  const { legendId, disabled } = useFieldsetContext()

  return (
    <legend
      id={legendId}
      className={cn(
        'text-title-md font-semibold text-on-surface mb-3 p-0',
        disabled && 'opacity-state-disabled',
        className,
      )}
    >
      {children}
    </legend>
  )
}

// ============================================================================
// Fieldset.Content
// ============================================================================

interface FieldsetContentProps {
  /** Content - typically form controls */
  children: React.ReactNode
  /** Additional CSS classes */
  className?: string
}

/**
 * Fieldset.Content - Container for the form controls within the fieldset
 *
 * Provides consistent spacing and layout for grouped form elements.
 */
function FieldsetContent({ children, className }: FieldsetContentProps) {
  const { disabled } = useFieldsetContext()

  return (
    <div
      className={cn(
        'flex flex-col gap-4',
        disabled && 'pointer-events-none',
        className,
      )}
    >
      {children}
    </div>
  )
}

// ============================================================================
// Fieldset.HelperText
// ============================================================================

interface FieldsetHelperTextProps {
  /** Helper text content */
  children: React.ReactNode
  /** Additional CSS classes */
  className?: string
}

/**
 * Fieldset.HelperText - Displays helper text below the fieldset content
 *
 * Automatically hidden when fieldset is in invalid state
 * (Fieldset.ErrorText shown instead)
 */
function FieldsetHelperText({ children, className }: FieldsetHelperTextProps) {
  const { descriptionId, invalid, disabled } = useFieldsetContext()

  // Hide helper text when showing error
  if (invalid) {
    return null
  }

  return (
    <p
      id={descriptionId}
      className={cn(
        'mt-3 text-body-sm text-on-surface-variant',
        disabled && 'opacity-state-disabled',
        className,
      )}
    >
      {children}
    </p>
  )
}

// ============================================================================
// Fieldset.ErrorText
// ============================================================================

interface FieldsetErrorTextProps {
  /** Error message content */
  children: React.ReactNode
  /** Additional CSS classes */
  className?: string
}

/**
 * Fieldset.ErrorText - Displays error message below the fieldset content
 *
 * Only rendered when fieldset is in invalid state (invalid=true)
 * Automatically sets role="alert" for accessibility
 */
function FieldsetErrorText({ children, className }: FieldsetErrorTextProps) {
  const { descriptionId, invalid } = useFieldsetContext()

  // Only show when invalid
  if (!invalid) {
    return null
  }

  return (
    <p
      id={descriptionId}
      role="alert"
      className={cn('mt-3 text-body-sm text-error', className)}
    >
      {children}
    </p>
  )
}

// ============================================================================
// Fieldset Compound Component Export
// ============================================================================

/**
 * Fieldset - Compound component for grouping related form controls
 *
 * Inspired by Chakra UI's Fieldset component pattern, this provides:
 * - Native `<fieldset>` and `<legend>` for semantic HTML
 * - Automatic ID generation and ARIA binding
 * - State cascading (invalid, disabled) to child components
 * - Proper accessibility for grouped form controls
 *
 * Use Fieldset for:
 * - Checkbox groups
 * - Radio groups
 * - Multiple related inputs that form a logical group
 *
 * Use Field for:
 * - Single form inputs
 * - Individual text fields, selects, etc.
 *
 * @example
 * ```tsx
 * // Basic usage with checkboxes
 * <Fieldset.Root>
 *   <Fieldset.Legend>Notification Preferences</Fieldset.Legend>
 *   <Fieldset.Content>
 *     <Checkbox>Email notifications</Checkbox>
 *     <Checkbox>SMS notifications</Checkbox>
 *     <Checkbox>Push notifications</Checkbox>
 *   </Fieldset.Content>
 *   <Fieldset.HelperText>Select your preferred methods.</Fieldset.HelperText>
 * </Fieldset.Root>
 *
 * // With validation error
 * <Fieldset.Root invalid={!hasSelection}>
 *   <Fieldset.Legend>Select Framework</Fieldset.Legend>
 *   <Fieldset.Content>
 *     {frameworks.map(fw => <Radio key={fw} value={fw}>{fw}</Radio>)}
 *   </Fieldset.Content>
 *   <Fieldset.HelperText>Choose your preferred framework.</Fieldset.HelperText>
 *   <Fieldset.ErrorText>Please select at least one option.</Fieldset.ErrorText>
 * </Fieldset.Root>
 *
 * // Disabled state
 * <Fieldset.Root disabled>
 *   <Fieldset.Legend>Locked Options</Fieldset.Legend>
 *   <Fieldset.Content>
 *     {options}
 *   </Fieldset.Content>
 * </Fieldset.Root>
 * ```
 */
// eslint-disable-next-line react-refresh/only-export-components
export const Fieldset = {
  Root: FieldsetRoot,
  Legend: FieldsetLegend,
  Content: FieldsetContent,
  HelperText: FieldsetHelperText,
  ErrorText: FieldsetErrorText,
}

export default Fieldset
