import { useState, useCallback, createContext, useContext } from 'react'
import { cn } from '@/utils/cn.util'
import { forwardRefWithAs } from '@/utils/polymorphic.util'
import { Check } from 'lucide-react'

// ============================================================================
// Context
// ============================================================================

type StepsContextValue = {
  currentStep: number
  count: number
  goTo: (step: number) => void
  next: () => void
  prev: () => void
  orientation: 'horizontal' | 'vertical'
  size: 'sm' | 'md' | 'lg'
  colorPalette: string
}

const StepsContext = createContext<StepsContextValue | null>(null)

function useStepsContext() {
  const ctx = useContext(StepsContext)
  if (!ctx)
    throw new Error('Steps sub-components must be used within Steps.Root')
  return ctx
}

// ============================================================================
// Style Maps
// ============================================================================

const indicatorSizeClasses: Record<string, string> = {
  sm: 'h-6 w-6 text-label-sm',
  md: 'h-8 w-8 text-label-md',
  lg: 'h-10 w-10 text-label-lg',
}

const iconSizeClasses: Record<string, string> = {
  sm: 'h-3 w-3',
  md: 'h-4 w-4',
  lg: 'h-5 w-5',
}

// ============================================================================
// Root Component
// ============================================================================

export type StepsRootOwnProps = {
  count: number
  defaultStep?: number
  step?: number
  onStepChange?: (step: number) => void
  orientation?: 'horizontal' | 'vertical'
  size?: 'sm' | 'md' | 'lg'
  colorPalette?: string
}

const StepsRoot = forwardRefWithAs<'div', StepsRootOwnProps>((props, ref) => {
  const {
    as,
    count,
    defaultStep = 0,
    step: controlledStep,
    onStepChange,
    orientation = 'horizontal',
    size = 'md',
    colorPalette = 'primary',
    className,
    children,
    ...rest
  } = props

  const [internalStep, setInternalStep] = useState(defaultStep)
  const currentStep =
    controlledStep !== undefined ? controlledStep : internalStep
  const Component = as || 'div'

  const goTo = useCallback(
    (s: number) => {
      const clamped = Math.max(0, Math.min(count, s))
      if (controlledStep === undefined) setInternalStep(clamped)
      onStepChange?.(clamped)
    },
    [count, controlledStep, onStepChange],
  )

  const next = useCallback(() => goTo(currentStep + 1), [currentStep, goTo])
  const prev = useCallback(() => goTo(currentStep - 1), [currentStep, goTo])

  return (
    <StepsContext.Provider
      value={{
        currentStep,
        count,
        goTo,
        next,
        prev,
        orientation,
        size,
        colorPalette,
      }}
    >
      <Component
        ref={ref}
        className={cn('flex flex-col gap-4', className)}
        {...rest}
      >
        {children}
      </Component>
    </StepsContext.Provider>
  )
})

StepsRoot.displayName = 'Steps.Root'

// ============================================================================
// List Component
// ============================================================================

const StepsList = forwardRefWithAs<'div', object>((props, ref) => {
  const { as, className, children, ...rest } = props
  const { orientation } = useStepsContext()
  const Component = as || 'div'

  return (
    <Component
      ref={ref}
      className={cn(
        'flex',
        orientation === 'horizontal' ? 'flex-row items-center' : 'flex-col',
        className,
      )}
      {...rest}
    >
      {children}
    </Component>
  )
})

StepsList.displayName = 'Steps.List'

// ============================================================================
// Item Component
// ============================================================================

export type StepsItemOwnProps = {
  index: number
}

const StepsItem = forwardRefWithAs<'div', StepsItemOwnProps>((props, ref) => {
  const { as, index, className, children, ...rest } = props
  const { orientation } = useStepsContext()
  const Component = as || 'div'

  return (
    <Component
      ref={ref}
      className={cn(
        'flex items-center',
        orientation === 'horizontal' ? 'flex-row' : 'flex-row gap-3',
        className,
      )}
      data-index={index}
      {...rest}
    >
      {children}
    </Component>
  )
})

StepsItem.displayName = 'Steps.Item'

// ============================================================================
// Trigger Component
// ============================================================================

export type StepsTriggerOwnProps = {
  index?: number
}

const StepsTrigger = forwardRefWithAs<'button', StepsTriggerOwnProps>(
  (props, ref) => {
    const { as, index, className, children, ...rest } = props
    const { goTo } = useStepsContext()
    const Component = as || 'button'

    return (
      <Component
        ref={ref}
        type="button"
        onClick={() => index !== undefined && goTo(index)}
        className={cn('flex items-center gap-2 cursor-pointer', className)}
        {...rest}
      >
        {children}
      </Component>
    )
  },
)

StepsTrigger.displayName = 'Steps.Trigger'

// ============================================================================
// Indicator Component
// ============================================================================

export type StepsIndicatorOwnProps = {
  index: number
}

const StepsIndicator = forwardRefWithAs<'div', StepsIndicatorOwnProps>(
  (props, ref) => {
    const { as, index, className, ...rest } = props
    const { currentStep, size } = useStepsContext()
    const Component = as || 'div'

    const isComplete = currentStep > index
    const isActive = currentStep === index

    return (
      <Component
        ref={ref}
        className={cn(
          'rounded-full flex items-center justify-center font-semibold flex-shrink-0 transition-colors duration-fast',
          indicatorSizeClasses[size],
          isComplete && 'bg-primary text-on-primary',
          isActive &&
            'bg-primary text-on-primary ring-2 ring-primary/30 ring-offset-2 ring-offset-surface',
          !isComplete &&
            !isActive &&
            'bg-surface-container-high text-on-surface-variant border border-outline-variant',
          className,
        )}
        {...rest}
      >
        {isComplete ? <Check className={iconSizeClasses[size]} /> : index + 1}
      </Component>
    )
  },
)

StepsIndicator.displayName = 'Steps.Indicator'

// ============================================================================
// Title Component
// ============================================================================

const StepsTitle = forwardRefWithAs<'span', object>((props, ref) => {
  const { as, className, children, ...rest } = props
  const Component = as || 'span'
  return (
    <Component
      ref={ref}
      className={cn('text-label-md font-medium text-on-surface', className)}
      {...rest}
    >
      {children}
    </Component>
  )
})

StepsTitle.displayName = 'Steps.Title'

// ============================================================================
// Description Component
// ============================================================================

const StepsDescription = forwardRefWithAs<'span', object>((props, ref) => {
  const { as, className, children, ...rest } = props
  const Component = as || 'span'
  return (
    <Component
      ref={ref}
      className={cn('text-label-sm text-on-surface-variant', className)}
      {...rest}
    >
      {children}
    </Component>
  )
})

StepsDescription.displayName = 'Steps.Description'

// ============================================================================
// Separator Component
// ============================================================================

const StepsSeparator = forwardRefWithAs<'div', { index?: number }>(
  (props, ref) => {
    const { as, index = 0, className, ...rest } = props
    const { currentStep, orientation } = useStepsContext()
    const Component = as || 'div'

    const isComplete = currentStep > index

    return (
      <Component
        ref={ref}
        className={cn(
          'transition-colors duration-fast',
          orientation === 'horizontal'
            ? cn(
                'flex-1 h-0.5 mx-2',
                isComplete ? 'bg-primary' : 'bg-outline-variant',
              )
            : cn(
                'w-0.5 min-h-[24px] ml-4',
                isComplete ? 'bg-primary' : 'bg-outline-variant',
              ),
          className,
        )}
        aria-hidden="true"
        {...rest}
      />
    )
  },
)

StepsSeparator.displayName = 'Steps.Separator'

// ============================================================================
// Content Component
// ============================================================================

export type StepsContentOwnProps = {
  index: number
}

const StepsContent = forwardRefWithAs<'div', StepsContentOwnProps>(
  (props, ref) => {
    const { as, index, className, children, ...rest } = props
    const { currentStep } = useStepsContext()
    const Component = as || 'div'

    if (currentStep !== index) return null

    return (
      <Component ref={ref} className={cn('py-4', className)} {...rest}>
        {children}
      </Component>
    )
  },
)

StepsContent.displayName = 'Steps.Content'

// ============================================================================
// CompletedContent Component
// ============================================================================

const StepsCompletedContent = forwardRefWithAs<'div', object>((props, ref) => {
  const { as, className, children, ...rest } = props
  const { currentStep, count } = useStepsContext()
  const Component = as || 'div'

  if (currentStep < count) return null

  return (
    <Component ref={ref} className={cn('py-4', className)} {...rest}>
      {children}
    </Component>
  )
})

StepsCompletedContent.displayName = 'Steps.CompletedContent'

// ============================================================================
// PrevTrigger / NextTrigger
// ============================================================================

const StepsPrevTrigger = forwardRefWithAs<'button', object>((props, ref) => {
  const { as, className, children, ...rest } = props
  const { prev, currentStep } = useStepsContext()
  const Component = as || 'button'

  return (
    <Component
      ref={ref}
      type="button"
      onClick={prev}
      disabled={currentStep <= 0}
      className={cn(
        'inline-flex items-center gap-1 px-4 py-2 rounded-lg text-label-md font-medium',
        'border border-outline-variant text-on-surface',
        'hover:bg-surface-container-high transition-colors duration-fast',
        'disabled:opacity-50 disabled:pointer-events-none',
        className,
      )}
      {...rest}
    >
      {children || 'Back'}
    </Component>
  )
})

StepsPrevTrigger.displayName = 'Steps.PrevTrigger'

const StepsNextTrigger = forwardRefWithAs<'button', object>((props, ref) => {
  const { as, className, children, ...rest } = props
  const { next, currentStep, count } = useStepsContext()
  const Component = as || 'button'

  return (
    <Component
      ref={ref}
      type="button"
      onClick={next}
      disabled={currentStep >= count}
      className={cn(
        'inline-flex items-center gap-1 px-4 py-2 rounded-lg text-label-md font-medium',
        'bg-primary text-on-primary',
        'hover:opacity-90 transition-opacity duration-fast',
        'disabled:opacity-50 disabled:pointer-events-none',
        className,
      )}
      {...rest}
    >
      {children || 'Next'}
    </Component>
  )
})

StepsNextTrigger.displayName = 'Steps.NextTrigger'

// ============================================================================
// Compound Export
// ============================================================================

const Steps = {
  Root: StepsRoot,
  List: StepsList,
  Item: StepsItem,
  Trigger: StepsTrigger,
  Indicator: StepsIndicator,
  Title: StepsTitle,
  Description: StepsDescription,
  Separator: StepsSeparator,
  Content: StepsContent,
  CompletedContent: StepsCompletedContent,
  PrevTrigger: StepsPrevTrigger,
  NextTrigger: StepsNextTrigger,
}

export default Steps
