import React from 'react'
import { cn } from '@/utils/cn.util'
import { useOptionalFieldContext } from '@/components/ui/forms/Field'

export interface CodeInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'size' | 'value' | 'onChange'
> {
  /** Code length to accept. Defaults to 6. */
  length?: number
  value: string
  onChange: (value: string) => void
  /** Invoked with the completed code when the input reaches `length` digits. */
  onComplete?: (value: string) => void
}

/**
 * CodeInput — a single-line numeric input for verification/reset codes.
 * Restricts input to digits, caps it at `length`, uses a numeric virtual
 * keyboard on mobile, and fires `onComplete` once `length` digits are present.
 */
const CodeInput = React.forwardRef<HTMLInputElement, CodeInputProps>(
  (
    {
      length = 6,
      value,
      onChange,
      onComplete,
      className,
      disabled: disabledProp,
      readOnly: readOnlyProp,
      id: idProp,
      ...props
    },
    ref,
  ) => {
    const fieldContext = useOptionalFieldContext()

    const inputId = fieldContext?.inputId ?? idProp
    const disabled = fieldContext?.disabled ?? disabledProp
    const readOnly = fieldContext?.readOnly ?? readOnlyProp
    const hasError = fieldContext?.invalid ?? false
    const hasSuccess = fieldContext?.success ?? false
    const descriptionId = fieldContext?.descriptionId

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value.replace(/\D/g, '').slice(0, length)
      onChange(next)
      if (next.length === length) onComplete?.(next)
    }

    const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
      const digits = e.clipboardData
        .getData('text')
        .replace(/\D/g, '')
        .slice(0, length)
      if (digits.length > 0) {
        e.preventDefault()
        onChange(digits)
        if (digits.length === length) onComplete?.(digits)
      }
    }

    return (
      <input
        ref={ref}
        id={inputId}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="one-time-code"
        maxLength={length}
        value={value}
        onChange={handleChange}
        onPaste={handlePaste}
        disabled={disabled}
        readOnly={readOnly}
        aria-invalid={hasError || undefined}
        aria-describedby={descriptionId}
        className={cn(
          'w-full text-center text-body-lg font-mono tracking-[0.35em] text-on-surface',
          'focus:outline-none focus:shadow-[var(--shadow-focus-ring,none)]',
          'disabled:opacity-state-disabled disabled:cursor-not-allowed placeholder:text-on-surface-variant',
          'bg-[var(--color-input-bg,transparent)] border-2 border-[var(--color-input-border,rgb(var(--color-outline-variant)))]',
          'focus:border-primary rounded-[var(--radius-input,0.5rem)] px-4 py-3',
          hasError
            ? 'border-error focus:border-error bg-error-container/30'
            : hasSuccess
              ? 'border-success focus:border-success bg-success-container/30'
              : undefined,
          className,
        )}
        {...props}
      />
    )
  },
)

CodeInput.displayName = 'CodeInput'

export default CodeInput