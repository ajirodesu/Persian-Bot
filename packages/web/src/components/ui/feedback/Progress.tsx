import React from 'react'
import { cn } from '@/utils/cn.util'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Progress indicator color options
 * - primary/secondary/tertiary: Brand colors
 * - error/success/warning/info: Semantic status colors
 * - neutral: Uses on-surface color
 */
export type ProgressColor =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'error'
  | 'success'
  | 'warning'
  | 'info'
  | 'neutral'

/**
 * Progress indicator size options
 */
export type ProgressSize = 'sm' | 'md' | 'lg' | 'xl'

/**
 * Base props shared by all progress indicator variants
 */
export interface ProgressBaseProps {
  /**
   * Color scheme
   * @default 'primary'
   */
  color?: ProgressColor
  /**
   * Size of the indicator
   * @default 'md'
   */
  size?: ProgressSize
  /**
   * Optional loading message to display below indicator
   */
  message?: string
  /**
   * Whether to render as full-screen centered indicator
   * @default false
   */
  fullScreen?: boolean
  /**
   * Additional CSS classes for the container
   */
  className?: string
}

/**
 * Props specific to Linear progress indicator
 */
export interface LinearProgressProps extends ProgressBaseProps {
  /**
   * Progress value (0-100). If provided, shows determinate progress.
   * If omitted, shows indeterminate animation.
   */
  value?: number
  /**
   * Whether to show the percentage value text
   * Only applicable in determinate mode (when value is provided)
   * @default false
   */
  showValue?: boolean
  /**
   * Whether to show animated stripes
   * @default false
   */
  striped?: boolean
  /**
   * Width of the progress bar container
   * @default 'w-full'
   */
  width?: string
}

// ============================================================================
// STYLE MAPPINGS
// ============================================================================

/**
 * Border color classes for circular variant (active spinner)
 */
const borderColorClasses: Record<ProgressColor, string> = {
  primary: 'border-primary',
  secondary: 'border-secondary',
  tertiary: 'border-tertiary',
  error: 'border-error',
  success: 'border-success',
  warning: 'border-warning',
  info: 'border-info',
  neutral: 'border-on-surface',
}

/**
 * Track border color classes for circular variant (background circle)
 * Uses 20% opacity to match Linear progress track pattern
 */
const trackBorderClasses: Record<ProgressColor, string> = {
  primary: 'border-primary/20',
  secondary: 'border-secondary/20',
  tertiary: 'border-tertiary/20',
  error: 'border-error/20',
  success: 'border-success/20',
  warning: 'border-warning/20',
  info: 'border-info/20',
  neutral: 'border-on-surface/20',
}

/**
 * Text color classes for messages
 */
const textColorClasses: Record<ProgressColor, string> = {
  primary: 'text-primary',
  secondary: 'text-secondary',
  tertiary: 'text-tertiary',
  error: 'text-error',
  success: 'text-success',
  warning: 'text-warning',
  info: 'text-info',
  neutral: 'text-on-surface',
}

/**
 * Background color classes for dots/pulse/bars variants
 */
const bgColorClasses: Record<ProgressColor, string> = {
  primary: 'bg-primary',
  secondary: 'bg-secondary',
  tertiary: 'bg-tertiary',
  error: 'bg-error',
  success: 'bg-success',
  warning: 'bg-warning',
  info: 'bg-info',
  neutral: 'bg-on-surface',
}

/**
 * Track background color classes for linear variant
 */
const trackBgClasses: Record<ProgressColor, string> = {
  primary: 'bg-primary/20',
  secondary: 'bg-secondary/20',
  tertiary: 'bg-tertiary/20',
  error: 'bg-error/20',
  success: 'bg-success/20',
  warning: 'bg-warning/20',
  info: 'bg-info/20',
  neutral: 'bg-on-surface/20',
}

/**
 * Size classes for circular variant
 */
const circularSizeClasses: Record<ProgressSize, string> = {
  sm: 'h-5 w-5 border-2',
  md: 'h-8 w-8 border-2',
  lg: 'h-12 w-12 border-[3px]',
  xl: 'h-16 w-16 border-4',
}

/**
 * Size classes for dots variant (individual dot)
 */
const dotSizeClasses: Record<ProgressSize, string> = {
  sm: 'h-1.5 w-1.5',
  md: 'h-2 w-2',
  lg: 'h-3 w-3',
  xl: 'h-4 w-4',
}

/**
 * Gap between dots
 */
const dotGapClasses: Record<ProgressSize, string> = {
  sm: 'gap-1',
  md: 'gap-1.5',
  lg: 'gap-2',
  xl: 'gap-3',
}

/**
 * Size classes for pulse variant
 */
const pulseSizeClasses: Record<ProgressSize, string> = {
  sm: 'h-5 w-5',
  md: 'h-8 w-8',
  lg: 'h-12 w-12',
  xl: 'h-16 w-16',
}

/**
 * Size classes for bars variant
 */
const barSizeClasses: Record<ProgressSize, { width: string; height: string }> =
  {
    sm: { width: 'w-1', height: 'h-4' },
    md: { width: 'w-1.5', height: 'h-6' },
    lg: { width: 'w-2', height: 'h-8' },
    xl: { width: 'w-2.5', height: 'h-10' },
  }

/**
 * Gap between bars
 */
const barGapClasses: Record<ProgressSize, string> = {
  sm: 'gap-0.5',
  md: 'gap-1',
  lg: 'gap-1.5',
  xl: 'gap-2',
}

/**
 * Height classes for linear progress track
 */
const linearHeightClasses: Record<ProgressSize, string> = {
  sm: 'h-1',
  md: 'h-2',
  lg: 'h-3',
  xl: 'h-4',
}

/**
 * Text size classes for linear progress value display
 */
const linearValueTextClasses: Record<ProgressSize, string> = {
  sm: 'text-label-sm',
  md: 'text-label-md',
  lg: 'text-body-md',
  xl: 'text-body-lg',
}

// ============================================================================
// WRAPPER COMPONENT
// ============================================================================

interface WrapperProps {
  fullScreen: boolean
  message?: string
  color: ProgressColor
  className?: string
  children: React.ReactNode
}

/**
 * Shared wrapper component for all progress indicators
 */
const Wrapper: React.FC<WrapperProps> = ({
  fullScreen,
  message,
  color,
  className,
  children,
}) => {
  const content = (
    <div
      className={cn(
        'flex flex-col items-center justify-center',
        !fullScreen && className,
      )}
      role="status"
      aria-live="polite"
      aria-label={message || 'Loading'}
    >
      {children}
      {message && (
        <p
          className={cn(
            'mt-4 transition-colors duration-300',
            textColorClasses[color],
          )}
        >
          {message}
        </p>
      )}
    </div>
  )

  if (fullScreen) {
    return (
      <div
        className={cn(
          'min-h-screen flex items-center justify-center bg-surface transition-colors duration-300',
          className,
        )}
      >
        {content}
      </div>
    )
  }

  return content
}

// ============================================================================
// CIRCULAR COMPONENT (Spinner)
// ============================================================================

/**
 * Circular progress indicator - classic rotating spinner
 *
 * Features a complete background track circle with a muted color
 * and a spinning indicator on top for visual emphasis.
 *
 * @example
 * ```tsx
 * <Progress.Circular />
 * <Progress.Circular color="success" size="lg" />
 * <Progress.Circular message="Loading..." fullScreen />
 * ```
 */
const Circular: React.FC<ProgressBaseProps> = ({
  color = 'primary',
  size = 'md',
  message,
  fullScreen = false,
  className,
}) => {
  return (
    <Wrapper
      fullScreen={fullScreen}
      message={message}
      color={color}
      className={className}
    >
      <div className="relative">
        {/* Track - static background circle with muted color */}
        <div
          className={cn(
            'rounded-full',
            circularSizeClasses[size],
            trackBorderClasses[color],
          )}
          aria-hidden="true"
        />
        {/* Spinner - rotating indicator on top */}
        <div
          className={cn(
            'absolute inset-0 animate-spin rounded-full border-t-transparent',
            circularSizeClasses[size],
            borderColorClasses[color],
          )}
        />
      </div>
    </Wrapper>
  )
}

Circular.displayName = 'Progress.Circular'

// ============================================================================
// DOTS COMPONENT
// ============================================================================

/**
 * Dots progress indicator - three bouncing dots
 *
 * @example
 * ```tsx
 * <Progress.Dots />
 * <Progress.Dots color="secondary" size="lg" />
 * <Progress.Dots message="Processing..." />
 * ```
 */
const Dots: React.FC<ProgressBaseProps> = ({
  color = 'primary',
  size = 'md',
  message,
  fullScreen = false,
  className,
}) => {
  return (
    <Wrapper
      fullScreen={fullScreen}
      message={message}
      color={color}
      className={className}
    >
      <div className={cn('flex items-center', dotGapClasses[size])}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className={cn(
              'rounded-full animate-bounce',
              dotSizeClasses[size],
              bgColorClasses[color],
            )}
            style={{
              animationDelay: `${i * 0.15}s`,
              animationDuration: '0.6s',
            }}
          />
        ))}
      </div>
    </Wrapper>
  )
}

Dots.displayName = 'Progress.Dots'

// ============================================================================
// PULSE COMPONENT
// ============================================================================

/**
 * Pulse progress indicator - pulsing/breathing circle
 *
 * @example
 * ```tsx
 * <Progress.Pulse />
 * <Progress.Pulse color="tertiary" size="xl" />
 * <Progress.Pulse message="Syncing..." />
 * ```
 */
const Pulse: React.FC<ProgressBaseProps> = ({
  color = 'primary',
  size = 'md',
  message,
  fullScreen = false,
  className,
}) => {
  return (
    <Wrapper
      fullScreen={fullScreen}
      message={message}
      color={color}
      className={className}
    >
      <div className="relative">
        <div
          className={cn(
            'rounded-full animate-ping absolute opacity-75',
            pulseSizeClasses[size],
            bgColorClasses[color],
          )}
        />
        <div
          className={cn(
            'rounded-full',
            pulseSizeClasses[size],
            bgColorClasses[color],
          )}
        />
      </div>
    </Wrapper>
  )
}

Pulse.displayName = 'Progress.Pulse'

// ============================================================================
// BARS COMPONENT
// ============================================================================

/**
 * Bars progress indicator - three animated vertical bars
 *
 * @example
 * ```tsx
 * <Progress.Bars />
 * <Progress.Bars color="info" size="lg" />
 * <Progress.Bars message="Uploading..." />
 * ```
 */
const Bars: React.FC<ProgressBaseProps> = ({
  color = 'primary',
  size = 'md',
  message,
  fullScreen = false,
  className,
}) => {
  return (
    <Wrapper
      fullScreen={fullScreen}
      message={message}
      color={color}
      className={className}
    >
      <div className={cn('flex items-center', barGapClasses[size])}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className={cn(
              'rounded-sm animate-pulse',
              barSizeClasses[size].width,
              barSizeClasses[size].height,
              bgColorClasses[color],
            )}
            style={{
              animationDelay: `${i * 0.15}s`,
              animationDuration: '0.75s',
            }}
          />
        ))}
      </div>
    </Wrapper>
  )
}

Bars.displayName = 'Progress.Bars'

// ============================================================================
// LINEAR COMPONENT
// ============================================================================

/**
 * Linear progress indicator - horizontal progress bar
 *
 * Supports both determinate (with value) and indeterminate modes.
 * - Determinate: Shows filled progress based on value (0-100)
 * - Indeterminate: Shows animated sliding bar when value is not provided
 *
 * @example
 * ```tsx
 * // Indeterminate (no value)
 * <Progress.Linear />
 * <Progress.Linear color="success" size="lg" />
 *
 * // Determinate (with value)
 * <Progress.Linear value={75} />
 * <Progress.Linear value={50} showValue />
 *
 * // With options
 * <Progress.Linear value={60} striped showValue color="info" />
 * <Progress.Linear message="Uploading file..." />
 * ```
 */
const Linear: React.FC<LinearProgressProps> = ({
  color = 'primary',
  size = 'md',
  message,
  fullScreen = false,
  className,
  value,
  showValue = false,
  striped = false,
  width = 'w-full',
}) => {
  // Determine if we're in determinate mode
  const isDeterminate = value !== undefined

  // Clamp value between 0 and 100
  const clampedValue = isDeterminate ? Math.min(100, Math.max(0, value)) : 0

  // Build the progress bar fill element
  const fillElement = (
    <div
      className={cn(
        'h-full rounded-full transition-all duration-300 ease-standard',
        bgColorClasses[color],
        // Indeterminate animation
        !isDeterminate &&
          'absolute animate-[progress_1.5s_ease-in-out_infinite]',
        !isDeterminate && 'w-1/3',
        // Striped pattern
        striped &&
          'bg-gradient-to-r from-transparent via-white/20 to-transparent bg-[length:20px_100%] animate-[shimmer_1s_linear_infinite]',
      )}
      style={isDeterminate ? { width: `${clampedValue}%` } : undefined}
    />
  )

  // The progress track
  const progressBar = (
    <div
      className={cn(
        'relative overflow-hidden rounded-full',
        linearHeightClasses[size],
        trackBgClasses[color],
        width,
      )}
      role="progressbar"
      aria-valuenow={isDeterminate ? clampedValue : undefined}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={
        message || (isDeterminate ? `${clampedValue}% complete` : 'Loading')
      }
    >
      {fillElement}
    </div>
  )

  // Content with optional value display
  const content = (
    <div className={cn('flex flex-col gap-2', width)}>
      {/* Value display above bar (if showValue and determinate) */}
      {isDeterminate && showValue && (
        <div className="flex justify-between items-center">
          <span
            className={cn(
              linearValueTextClasses[size],
              textColorClasses[color],
            )}
          >
            Progress
          </span>
          <span
            className={cn(
              linearValueTextClasses[size],
              'font-medium',
              textColorClasses[color],
            )}
          >
            {Math.round(clampedValue)}%
          </span>
        </div>
      )}
      {progressBar}
    </div>
  )

  // Use wrapper for message and fullScreen support
  if (message || fullScreen) {
    return (
      <Wrapper
        fullScreen={fullScreen}
        message={message}
        color={color}
        className={className}
      >
        {content}
      </Wrapper>
    )
  }

  // Simple inline render
  return (
    <div
      className={cn('flex flex-col items-center justify-center', className)}
      role="status"
      aria-live="polite"
    >
      {content}
    </div>
  )
}

Linear.displayName = 'Progress.Linear'

// ============================================================================
// COMPOUND COMPONENT EXPORT
// ============================================================================

/**
 * Progress indicator compound component
 *
 * A collection of loading/progress indicators with consistent API.
 * Uses compound component pattern for intuitive usage.
 *
 * **Variants:**
 * - `Progress.Circular` - Classic rotating spinner with background track
 * - `Progress.Dots` - Three bouncing dots
 * - `Progress.Pulse` - Pulsing/breathing circle
 * - `Progress.Bars` - Animated vertical bars
 * - `Progress.Linear` - Horizontal progress bar (determinate/indeterminate)
 *
 * **Colors:** primary, secondary, tertiary, error, success, warning, info, neutral
 *
 * **Sizes:** sm, md, lg, xl
 *
 * @example
 * ```tsx
 * // Basic usage
 * <Progress.Circular />
 * <Progress.Dots />
 * <Progress.Pulse />
 * <Progress.Bars />
 * <Progress.Linear />
 *
 * // Linear with value (determinate)
 * <Progress.Linear value={75} showValue />
 *
 * // Linear indeterminate with message
 * <Progress.Linear color="info" message="Loading data..." />
 *
 * // With options
 * <Progress.Circular color="success" size="lg" message="Loading..." />
 *
 * // Full screen mode
 * <Progress.Dots fullScreen message="Please wait..." />
 *
 * // In a container
 * <div className="h-32 flex items-center justify-center">
 *   <Progress.Pulse color="tertiary" />
 * </div>
 * ```
 */
const Progress = {
  Circular,
  Dots,
  Pulse,
  Bars,
  Linear,
}

export default Progress

// Export individual components for flexibility
export { Circular, Dots, Pulse, Bars, Linear }
