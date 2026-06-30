import { cn } from '@/utils/cn.util'
import { forwardRefWithAs } from '@/utils/polymorphic.util'

// ============================================================================
// Types
// ============================================================================

export type StatusColor =
  | 'success'
  | 'error'
  | 'warning'
  | 'info'
  | 'primary'
  | 'secondary'
export type StatusSize = 'sm' | 'md' | 'lg'

// ============================================================================
// Style Maps
// ============================================================================

const indicatorColorClasses: Record<StatusColor, string> = {
  success: 'bg-success',
  error: 'bg-error',
  warning: 'bg-warning',
  info: 'bg-info',
  primary: 'bg-primary',
  secondary: 'bg-secondary',
}

const textColorClasses: Record<StatusColor, string> = {
  success: 'text-success',
  error: 'text-error',
  warning: 'text-warning',
  info: 'text-info',
  primary: 'text-primary',
  secondary: 'text-secondary',
}

const indicatorSizeClasses: Record<StatusSize, string> = {
  sm: 'h-1.5 w-1.5',
  md: 'h-2 w-2',
  lg: 'h-2.5 w-2.5',
}

const rootSizeClasses: Record<StatusSize, string> = {
  sm: 'text-label-sm gap-1.5',
  md: 'text-body-md gap-2',
  lg: 'text-body-lg gap-2.5',
}

// ============================================================================
// Root Component
// ============================================================================

export type StatusRootOwnProps = {
  colorPalette?: StatusColor
  size?: StatusSize
}

const StatusRoot = forwardRefWithAs<'span', StatusRootOwnProps>(
  (props, ref) => {
    const {
      as,
      colorPalette = 'success',
      size = 'md',
      className,
      children,
      ...rest
    } = props

    const Component = as || 'span'

    return (
      <Component
        ref={ref}
        className={cn(
          'inline-flex items-center font-medium',
          rootSizeClasses[size],
          textColorClasses[colorPalette],
          className,
        )}
        {...rest}
      >
        {children}
      </Component>
    )
  },
)

StatusRoot.displayName = 'Status.Root'

// ============================================================================
// Indicator Component
// ============================================================================

export type StatusIndicatorOwnProps = {
  colorPalette?: StatusColor
  size?: StatusSize
  pulse?: boolean
}

const StatusIndicator = forwardRefWithAs<'span', StatusIndicatorOwnProps>(
  (props, ref) => {
    const {
      as,
      colorPalette = 'success',
      size = 'md',
      pulse = false,
      className,
      ...rest
    } = props

    const Component = as || 'span'

    return (
      <Component
        ref={ref}
        className={cn(
          'inline-block rounded-full flex-shrink-0',
          indicatorSizeClasses[size],
          indicatorColorClasses[colorPalette],
          pulse && 'animate-pulse',
          className,
        )}
        aria-hidden="true"
        {...rest}
      />
    )
  },
)

StatusIndicator.displayName = 'Status.Indicator'

// ============================================================================
// Compound Export
// ============================================================================

const Status = {
  Root: StatusRoot,
  Indicator: StatusIndicator,
}

export default Status
