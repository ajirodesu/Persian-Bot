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
 * Size classes for circular variant
 */
const circularSizeClasses: Record<ProgressSize, string> = {
  sm: 'h-5 w-5 border-2',
  md: 'h-8 w-8 border-2',
  lg: 'h-12 w-12 border-[3px]',
  xl: 'h-16 w-16 border-4',
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
 *
 * **Colors:** primary, secondary, tertiary, error, success, warning, info, neutral
 *
 * **Sizes:** sm, md, lg, xl
 *
 * @example
 * ```tsx
 * // Basic usage
 * <Progress.Circular />
 *
 * // With options
 * <Progress.Circular color="success" size="lg" message="Loading..." />
 *
 * // Full screen mode
 * <Progress.Circular fullScreen message="Please wait..." />
 * ```
 */
const Progress = {
  Circular,
}

export default Progress

// Export individual components for flexibility
export { Circular }
