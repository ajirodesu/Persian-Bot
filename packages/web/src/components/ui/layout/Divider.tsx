import { cn } from '@/utils/cn.util'
import {
  forwardRefWithAs,
  type PolymorphicComponentPropsWithRef,
} from '@/utils/polymorphic.util'

export type DividerOrientation = 'horizontal' | 'vertical'
export type DividerVariant = 'solid' | 'dashed' | 'dotted'
export type DividerColor =
  | 'default'
  | 'subtle'
  | 'primary'
  | 'secondary'
  | 'tertiary'
export type DividerSpacing = 'none' | 'sm' | 'md' | 'lg' | 'xl'
export type DividerLabelPosition = 'start' | 'center' | 'end'

/**
 * Base props for Divider component (excluding HTML attributes)
 */
export type DividerOwnProps = {
  /** Orientation of the divider */
  orientation?: DividerOrientation
  /** Border style variant */
  variant?: DividerVariant
  /** Color theme of the divider */
  color?: DividerColor
  /** Spacing (margin) around the divider */
  spacing?: DividerSpacing
  /** Optional label/text to display in the divider */
  label?: React.ReactNode
  /** Position of the label */
  labelPosition?: DividerLabelPosition
  /** Make the line thicker */
  thick?: boolean
}

/**
 * Polymorphic Divider props - supports `as` prop for rendering as different elements
 * @example
 * ```tsx
 * <Divider as="hr" />
 * <Divider as="span" orientation="vertical" />
 * ```
 */
export type DividerProps<T extends React.ElementType = 'div'> =
  PolymorphicComponentPropsWithRef<T, DividerOwnProps>

/**
 * Color classes for the divider line
 */
const colorClasses: Record<DividerColor, string> = {
  default: 'border-outline-variant',
  subtle: 'border-outline-variant/50',
  primary: 'border-primary',
  secondary: 'border-secondary',
  tertiary: 'border-tertiary',
}

/**
 * Spacing classes for horizontal orientation
 */
const horizontalSpacingClasses: Record<DividerSpacing, string> = {
  none: '',
  sm: 'my-2',
  md: 'my-4',
  lg: 'my-6',
  xl: 'my-8',
}

/**
 * Spacing classes for vertical orientation
 */
const verticalSpacingClasses: Record<DividerSpacing, string> = {
  none: '',
  sm: 'mx-2',
  md: 'mx-4',
  lg: 'mx-6',
  xl: 'mx-8',
}

/**
 * Border style classes
 */
const variantClasses: Record<DividerVariant, string> = {
  solid: 'border-solid',
  dashed: 'border-dashed',
  dotted: 'border-dotted',
}

/**
 * Label position classes for flexbox alignment
 */
const labelPositionClasses: Record<DividerLabelPosition, string> = {
  start: 'justify-start',
  center: 'justify-center',
  end: 'justify-end',
}

/**
 * Divider component for visual separation of content
 *
 * Features:
 * - 2 orientations: horizontal, vertical
 * - 3 border variants: solid, dashed, dotted
 * - 5 color options: default, subtle, primary, secondary, tertiary
 * - 5 spacing options: none, sm, md, lg, xl
 * - Optional label with positioning (start, center, end)
 * - Thick variant for emphasis
 * - Semantic HR element for horizontal dividers
 * - Accessible with proper ARIA attributes
 *
 * @example
 * ```tsx
 * // Basic horizontal divider
 * <Divider />
 *
 * // With spacing
 * <Divider spacing="lg" />
 *
 * // Dashed variant
 * <Divider variant="dashed" color="primary" />
 *
 * // With label
 * <Divider label="OR" />
 *
 * // Vertical divider
 * <div className="flex h-10 items-center">
 *   <span>Left</span>
 *   <Divider orientation="vertical" spacing="md" />
 *   <span>Right</span>
 * </div>
 *
 * // Thick divider
 * <Divider thick color="primary" />
 *
 * // Polymorphic usage
 * <Divider as="hr" />
 * <Divider as="span" orientation="vertical" />
 * ```
 */
const Divider = forwardRefWithAs<'div', DividerOwnProps>((props, ref) => {
  const {
    as,
    orientation = 'horizontal',
    variant = 'solid',
    color = 'default',
    spacing = 'md',
    label,
    labelPosition = 'center',
    thick = false,
    className,
    ...rest
  } = props

  const isHorizontal = orientation === 'horizontal'
  const hasLabel = label !== undefined && label !== null && isHorizontal

  // Thickness based on thick prop
  const borderWidth = thick ? 'border-2' : 'border'

  // Determine component to render
  // Default to 'hr' for horizontal without label, 'div' otherwise
  const defaultElement = isHorizontal && !hasLabel ? 'hr' : 'div'
  const Component = as || defaultElement

  // For horizontal dividers without labels
  if (isHorizontal && !hasLabel) {
    return (
      <Component
        ref={ref}
        className={cn(
          'w-full border-0 border-t',
          borderWidth,
          colorClasses[color],
          variantClasses[variant],
          horizontalSpacingClasses[spacing],
          className,
        )}
        role="separator"
        aria-orientation="horizontal"
        {...rest}
      />
    )
  }

  // For horizontal dividers with labels
  if (isHorizontal && hasLabel) {
    return (
      <Component
        ref={ref}
        className={cn(
          'flex items-center w-full',
          horizontalSpacingClasses[spacing],
          labelPositionClasses[labelPosition],
          className,
        )}
        role="separator"
        aria-orientation="horizontal"
        {...rest}
      >
        {/* Left line */}
        {(labelPosition === 'center' || labelPosition === 'end') && (
          <div
            className={cn(
              'border-t flex-1',
              borderWidth,
              colorClasses[color],
              variantClasses[variant],
              labelPosition === 'end' ? 'flex-grow' : '',
            )}
            aria-hidden="true"
          />
        )}

        {/* Label */}
        <span
          className={cn(
            'text-label-md text-on-surface-variant px-3 flex-shrink-0',
            labelPosition === 'start' && 'pl-0',
            labelPosition === 'end' && 'pr-0',
          )}
        >
          {label}
        </span>

        {/* Right line */}
        {(labelPosition === 'center' || labelPosition === 'start') && (
          <div
            className={cn(
              'border-t flex-1',
              borderWidth,
              colorClasses[color],
              variantClasses[variant],
              labelPosition === 'start' ? 'flex-grow' : '',
            )}
            aria-hidden="true"
          />
        )}
      </Component>
    )
  }

  // For vertical dividers
  return (
    <Component
      ref={ref}
      className={cn(
        'self-stretch border-l',
        borderWidth,
        colorClasses[color],
        variantClasses[variant],
        verticalSpacingClasses[spacing],
        className,
      )}
      role="separator"
      aria-orientation="vertical"
      {...rest}
    />
  )
})

Divider.displayName = 'Divider'

export default Divider
