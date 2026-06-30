import { cn } from '@/utils/cn.util'
import { forwardRefWithAs } from '@/utils/polymorphic.util'
import { TrendingUp, TrendingDown } from 'lucide-react'

// ============================================================================
// Types
// ============================================================================

export type StatSize = 'sm' | 'md' | 'lg'

// ============================================================================
// Style Maps
// ============================================================================

// ============================================================================
// Root Component
// ============================================================================

export type StatRootOwnProps = {
  size?: StatSize
}

const StatRoot = forwardRefWithAs<'div', StatRootOwnProps>((props, ref) => {
  const { as, size = 'md', className, children, ...rest } = props
  const Component = as || 'div'

  return (
    <Component
      ref={ref}
      className={cn('flex flex-col gap-1', className)}
      data-size={size}
      {...rest}
    >
      {children}
    </Component>
  )
})

StatRoot.displayName = 'Stat.Root'

// ============================================================================
// Label Component
// ============================================================================

const StatLabel = forwardRefWithAs<'span', object>((props, ref) => {
  const { as, className, children, ...rest } = props
  const Component = as || 'span'

  return (
    <Component
      ref={ref}
      className={cn(
        'text-on-surface-variant font-medium',
        'text-body-sm [div[data-size="sm"]_&]:text-label-sm [div[data-size="lg"]_&]:text-body-md',
        className,
      )}
      {...rest}
    >
      {children}
    </Component>
  )
})

StatLabel.displayName = 'Stat.Label'

// ============================================================================
// ValueText Component
// ============================================================================

const StatValueText = forwardRefWithAs<'span', object>((props, ref) => {
  const { as, className, children, ...rest } = props
  const Component = as || 'span'

  return (
    <Component
      ref={ref}
      className={cn(
        'text-on-surface font-bold',
        'text-headline-md [div[data-size="sm"]_&]:text-title-lg [div[data-size="lg"]_&]:text-display-sm',
        className,
      )}
      {...rest}
    >
      {children}
    </Component>
  )
})

StatValueText.displayName = 'Stat.ValueText'

// ============================================================================
// HelpText Component
// ============================================================================

const StatHelpText = forwardRefWithAs<'span', object>((props, ref) => {
  const { as, className, children, ...rest } = props
  const Component = as || 'span'

  return (
    <Component
      ref={ref}
      className={cn(
        'text-on-surface-variant',
        'text-body-sm [div[data-size="sm"]_&]:text-label-sm',
        className,
      )}
      {...rest}
    >
      {children}
    </Component>
  )
})

StatHelpText.displayName = 'Stat.HelpText'

// ============================================================================
// UpIndicator Component
// ============================================================================

export type StatIndicatorOwnProps = {
  type?: 'increase' | 'decrease'
}

const StatUpIndicator = forwardRefWithAs<'span', object>((props, ref) => {
  const { as, className, children, ...rest } = props
  const Component = as || 'span'

  return (
    <Component
      ref={ref}
      className={cn(
        'inline-flex items-center gap-1 text-success font-medium',
        'text-body-sm [div[data-size="sm"]_&]:text-label-sm',
        className,
      )}
      {...rest}
    >
      <TrendingUp className="h-4 w-4" />
      {children}
    </Component>
  )
})

StatUpIndicator.displayName = 'Stat.UpIndicator'

// ============================================================================
// DownIndicator Component
// ============================================================================

const StatDownIndicator = forwardRefWithAs<'span', object>((props, ref) => {
  const { as, className, children, ...rest } = props
  const Component = as || 'span'

  return (
    <Component
      ref={ref}
      className={cn(
        'inline-flex items-center gap-1 text-error font-medium',
        'text-body-sm [div[data-size="sm"]_&]:text-label-sm',
        className,
      )}
      {...rest}
    >
      <TrendingDown className="h-4 w-4" />
      {children}
    </Component>
  )
})

StatDownIndicator.displayName = 'Stat.DownIndicator'

// ============================================================================
// Compound Export
// ============================================================================

const Stat = {
  Root: StatRoot,
  Label: StatLabel,
  ValueText: StatValueText,
  HelpText: StatHelpText,
  UpIndicator: StatUpIndicator,
  DownIndicator: StatDownIndicator,
}

export default Stat
