import { cn } from '@/utils/cn.util'
import {
  forwardRefWithAs,
  type PolymorphicComponentPropsWithRef,
} from '@/utils/polymorphic.util'

/**
 * Skeleton shape variants
 * - text: Single line text placeholder with rounded ends
 * - rectangular: Rectangle with sharp corners
 * - circular: Perfect circle
 * - rounded: Rectangle with rounded corners
 */
export type SkeletonVariant = 'text' | 'rectangular' | 'circular' | 'rounded'

/**
 * Skeleton animation types
 * - pulse: Opacity fades in and out (default)
 * - wave: Shimmer effect moving across (continuous)
 * - none: Static, no animation
 */
export type SkeletonAnimation = 'pulse' | 'wave' | 'none'

/**
 * Predefined text sizes matching typography scale
 */
export type SkeletonTextSize =
  | 'display-lg'
  | 'display-md'
  | 'display-sm'
  | 'headline-lg'
  | 'headline-md'
  | 'headline-sm'
  | 'title-lg'
  | 'title-md'
  | 'title-sm'
  | 'body-lg'
  | 'body-md'
  | 'body-sm'
  | 'label-lg'
  | 'label-md'
  | 'label-sm'

/**
 * Base props for Skeleton component (excluding HTML attributes)
 */
export type SkeletonOwnProps = {
  /**
   * Shape variant
   * @default 'text'
   */
  variant?: SkeletonVariant
  /**
   * Animation type
   * @default 'pulse'
   */
  animation?: SkeletonAnimation
  /**
   * Width of the skeleton
   * - For 'text' variant: defaults to '100%'
   * - For 'circular' variant: must equal height for perfect circle
   * - Accepts any valid CSS width value
   */
  width?: string | number
  /**
   * Height of the skeleton
   * - For 'text' variant: uses textSize if provided, else '1em'
   * - For 'circular' variant: must equal width for perfect circle
   * - Accepts any valid CSS height value
   */
  height?: string | number
  /**
   * Predefined text size (only for variant="text")
   * Maps to typography scale from design system
   */
  textSize?: SkeletonTextSize
  /**
   * Number of skeleton items to render (for lists)
   * @default 1
   */
  count?: number
  /**
   * Gap between multiple skeletons when count > 1
   * @default '0.5rem'
   */
  gap?: string | number
}

/**
 * Polymorphic Skeleton props - supports `as` prop for rendering as different elements
 * @example
 * ```tsx
 * <Skeleton as="span" />
 * <Skeleton as="li" />
 * ```
 */
export type SkeletonProps<T extends React.ElementType = 'div'> =
  PolymorphicComponentPropsWithRef<T, SkeletonOwnProps>

/**
 * Text size to height mapping based on typography scale
 * Values match line-height * font-size from globals.css
 */
const textSizeHeights: Record<SkeletonTextSize, string> = {
  'display-lg': '4rem', // 57px * 1.12
  'display-md': '3.25rem', // 45px * 1.16
  'display-sm': '2.75rem', // 36px * 1.22
  'headline-lg': '2.5rem', // 32px * 1.25
  'headline-md': '2.25rem', // 28px * 1.29
  'headline-sm': '2rem', // 24px * 1.33
  'title-lg': '1.75rem', // 22px * 1.27
  'title-md': '1.5rem', // 16px * 1.5
  'title-sm': '1.3125rem', // 14px * 1.5
  'body-lg': '1.8rem', // 18px * 1.6
  'body-md': '1.5rem', // 16px * 1.5
  'body-sm': '1.3125rem', // 14px * 1.5
  'label-lg': '1.3125rem', // 14px * 1.5
  'label-md': '1.21875rem', // 13px * 1.5
  'label-sm': '1.125rem', // 12px * 1.5
}

/**
 * Variant-specific base styles
 */
const variantClasses: Record<SkeletonVariant, string> = {
  text: 'rounded-full',
  rectangular: 'rounded-none',
  circular: 'rounded-full aspect-square',
  rounded: 'rounded-lg',
}

/**
 * Animation-specific styles
 *
 * NOTE: Wave animation uses `linear` timing function for continuous,
 * seamless looping. Using `ease-in-out` would cause perceptible pauses
 * at the start/end of each animation cycle.
 */
const animationClasses: Record<SkeletonAnimation, string> = {
  pulse: 'animate-[skeleton_1.5s_ease-in-out_infinite]',
  wave: 'animate-[shimmer_2s_linear_infinite] bg-[length:200%_100%]',
  none: '',
}

/**
 * Convert numeric value to pixel string
 */
const toCssValue = (value: string | number | undefined): string | undefined => {
  if (value === undefined) return undefined
  return typeof value === 'number' ? `${value}px` : value
}

/**
 * Skeleton component for loading placeholders
 *
 * Provides visual feedback during content loading with various shapes
 * and animation styles. Fully accessible with proper ARIA attributes.
 *
 * @example
 * ```tsx
 * // Basic text skeleton
 * <Skeleton />
 *
 * // Text skeleton with specific size
 * <Skeleton textSize="headline-md" width="60%" />
 *
 * // Circular avatar skeleton
 * <Skeleton variant="circular" width={48} height={48} />
 *
 * // Rectangular image skeleton
 * <Skeleton variant="rectangular" width="100%" height={200} />
 *
 * // Multiple skeletons (list)
 * <Skeleton count={3} textSize="body-md" />
 *
 * // Wave animation (continuous shimmer)
 * <Skeleton animation="wave" width="80%" />
 *
 * // No animation (static)
 * <Skeleton animation="none" variant="rounded" height={100} />
 *
 * // Polymorphic usage
 * <Skeleton as="span" />
 * <Skeleton as="li" />
 * ```
 */
const Skeleton = forwardRefWithAs<'div', SkeletonOwnProps>((props, ref) => {
  const {
    as,
    variant = 'text',
    animation = 'pulse',
    width,
    height,
    textSize,
    count = 1,
    gap = '0.5rem',
    className,
    style,
    ...rest
  } = props

  const Component = as || 'div'
  // Determine dimensions
  const computedWidth =
    toCssValue(width) ?? (variant === 'text' ? '100%' : undefined)
  const computedHeight =
    toCssValue(height) ??
    (variant === 'text' && textSize ? textSizeHeights[textSize] : undefined) ??
    (variant === 'text' ? '1em' : undefined)

  // For circular, ensure aspect-square works
  const circularSize =
    variant === 'circular'
      ? (computedWidth ?? computedHeight ?? '2.5rem')
      : undefined

  // Base background classes - uses surface colors for shimmer gradient
  const backgroundClasses =
    animation === 'wave'
      ? 'bg-gradient-to-r from-surface-variant via-surface-container-lowest to-surface-variant'
      : 'bg-surface-variant'

  // Render single skeleton
  const renderSkeleton = (key?: number) => (
    <Component
      key={key}
      ref={key === undefined || key === 0 ? ref : undefined}
      role="status"
      aria-busy="true"
      aria-label="Loading..."
      className={cn(
        // Base styles
        'block',
        // Background
        backgroundClasses,
        // Variant shape
        variantClasses[variant],
        // Animation
        animationClasses[animation],
        // User className
        className,
      )}
      style={{
        width: variant === 'circular' ? circularSize : computedWidth,
        height: variant === 'circular' ? circularSize : computedHeight,
        ...style,
      }}
      {...rest}
    >
      {/* Screen reader text */}
      <span className="sr-only">Loading...</span>
    </Component>
  )

  // Single skeleton
  if (count === 1) {
    return renderSkeleton()
  }

  // Multiple skeletons
  return (
    <div
      className="flex flex-col"
      style={{ gap: toCssValue(gap) }}
      role="status"
      aria-busy="true"
      aria-label={`Loading ${count} items...`}
    >
      {Array.from({ length: count }, (_, i) => renderSkeleton(i))}
      <span className="sr-only">Loading {count} items...</span>
    </div>
  )
})

Skeleton.displayName = 'Skeleton'

export default Skeleton
