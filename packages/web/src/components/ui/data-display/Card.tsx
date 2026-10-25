import { cn } from '@/utils/cn.util'
import { forwardRefWithAs } from '@/utils/polymorphic.util'

// ============================================================================
// Types
// ============================================================================

/**
 * Card visual style variants
 * - elevated: Default card — flat surface with a hairline frame
 * - filled: Solid colored background
 * - outlined: Border-only style
 * - gradient: Flat low surface with an accent hairline (legacy key)
 */
export type CardVariant = 'elevated' | 'filled' | 'outlined' | 'gradient'

/**
 * Card color options (used with 'filled' and 'gradient' variants)
 * - neutral: Uses surface colors (default)
 * - primary/secondary/tertiary: Brand colors
 * - success/error/warning/info: Semantic status colors
 */
export type CardColor =
  | 'neutral'
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'success'
  | 'error'
  | 'warning'
  | 'info'

/**
 * Surface level controls the background color depth (for elevated variant)
 * Maps to Material Design 3 surface container hierarchy
 */
type SurfaceLevel =
  | 'surface'
  | 'lowest'
  | 'low'
  | 'default'
  | 'high'
  | 'highest'

/**
 * Shadow elevation level (0-5)
 * Maps to Material Design 3 elevation system
 */
type ShadowElevation = 0 | 1 | 2 | 3 | 4 | 5

/**
 * Padding size options
 */
type CardPadding = 'none' | 'sm' | 'md' | 'lg'

// ============================================================================
// Root Component
// ============================================================================

/**
 * Base props for Card.Root component (excluding HTML attributes)
 */
export type CardRootOwnProps = {
  /**
   * Visual variant style
   * @default 'elevated'
   *
   * - 'elevated': Default card — flat surface with a hairline frame
   * - 'filled': Solid colored background (uses color prop)
   * - 'outlined': Border-only with transparent background
   * - 'gradient': Flat low surface with an accent hairline (legacy key)
   */
  variant?: CardVariant
  /**
   * Color scheme - used with 'filled' and 'gradient' variants
   * @default 'neutral'
   */
  color?: CardColor
  /**
   * Surface level - controls background depth for 'elevated' variant
   * @default 'default'
   */
  surfaceLevel?: SurfaceLevel
  /**
   * Frame level (0-5). Retained for API compatibility: every level renders
   * the same flat `border border-hairline` and no shadow.
   * @default 0
   */
  shadowElevation?: ShadowElevation
  /**
   * Whether to show a border (for 'elevated' variant)
   * @default false
   */
  bordered?: boolean
  /**
   * Padding size
   * @default 'md'
   */
  padding?: CardPadding
  /**
   * Whether the card is interactive (clickable)
   * @default false
   */
  interactive?: boolean
  /**
   * @deprecated Use variant="gradient" and color prop instead
   */
  gradient?:
    | 'primary'
    | 'secondary'
    | 'tertiary'
    | 'success'
    | 'error'
    | 'warning'
    | 'info'
}


/**
 * Surface level to Tailwind class mapping
 */
const surfaceLevelClasses: Record<SurfaceLevel, string> = {
  surface: 'bg-surface-container',
  lowest: 'bg-surface-container-lowest',
  low: 'bg-surface-container-low',
  default: 'bg-surface',
  high: 'bg-surface-container-high',
  highest: 'bg-surface-container-highest',
}

/**
 * Elevation is flat in this system: every level paints the same hairline
 * frame and no shadow. Real shadows are reserved for overlays only.
 */
const elevationFrameClasses: Record<ShadowElevation, string> = {
  0: 'border border-hairline',
  1: 'border border-hairline',
  2: 'border border-hairline',
  3: 'border border-hairline',
  4: 'border border-hairline',
  5: 'border border-hairline',
}

/**
 * Padding size to Tailwind class mapping
 */
const paddingClasses: Record<CardPadding, string> = {
  none: '',
  sm: 'p-4',
  md: 'p-6',
  lg: 'p-8',
}

/**
 * Filled variant color classes
 */
const filledColorClasses: Record<CardColor, string> = {
  neutral: 'bg-surface-container-high text-on-surface',
  primary: 'bg-primary text-on-primary',
  secondary: 'bg-secondary text-on-secondary',
  tertiary: 'bg-tertiary text-on-tertiary',
  success: 'bg-success text-on-success',
  error: 'bg-error text-on-error',
  warning: 'bg-warning text-on-warning',
  info: 'bg-info text-on-info',
}

/**
 * Gradient variant color classes
 *
 * The variant key survives for API compatibility, but the system has no
 * ramps: it paints a flat low surface with a single accent hairline frame.
 * `color` no longer tints this variant.
 */
const gradientColorClasses: Record<CardColor, string> = {
  neutral: 'bg-surface-container-low text-on-surface border border-primary/40',
  primary: 'bg-surface-container-low text-on-surface border border-primary/40',
  secondary:
    'bg-surface-container-low text-on-surface border border-primary/40',
  tertiary: 'bg-surface-container-low text-on-surface border border-primary/40',
  success: 'bg-surface-container-low text-on-surface border border-primary/40',
  error: 'bg-surface-container-low text-on-surface border border-primary/40',
  warning: 'bg-surface-container-low text-on-surface border border-primary/40',
  info: 'bg-surface-container-low text-on-surface border border-primary/40',
}

/**
 * Outlined variant color classes
 */
const outlinedColorClasses: Record<CardColor, string> = {
  neutral: 'bg-transparent text-on-surface border-outline-variant',
  primary: 'bg-transparent text-on-surface border-primary',
  secondary: 'bg-transparent text-on-surface border-secondary',
  tertiary: 'bg-transparent text-on-surface border-tertiary',
  success: 'bg-transparent text-on-surface border-success',
  error: 'bg-transparent text-on-surface border-error',
  warning: 'bg-transparent text-on-surface border-warning',
  info: 'bg-transparent text-on-surface border-info',
}

/**
 * Card.Root - Container component for card content
 *
 * Uses composable variant + color props pattern (same as Button):
 * - variant: Controls visual style (elevated, filled, outlined, gradient)
 * - color: Controls color scheme (neutral, primary, secondary, etc.)
 *
 * @example
 * ```tsx
 * // Default elevated card
 * <Card.Root>
 *   <Card.Body>Content</Card.Body>
 * </Card.Root>
 *
 * // Elevated with a hairline frame
 * <Card.Root variant="elevated" surfaceLevel="low" shadowElevation={2}>
 *   <Card.Body>Elevated content</Card.Body>
 * </Card.Root>
 *
 * // Filled card with color
 * <Card.Root variant="filled" color="primary">
 *   <Card.Body>Filled content</Card.Body>
 * </Card.Root>
 *
 * // Flat accent-framed card (legacy gradient key)
 * <Card.Root variant="gradient" color="secondary">
 *   <Card.Title>Accent Card</Card.Title>
 *   <Card.Body>Content on a flat low surface</Card.Body>
 * </Card.Root>
 *
 * // Outlined card
 * <Card.Root variant="outlined" color="primary">
 *   <Card.Body>Outlined content</Card.Body>
 * </Card.Root>
 *
 * // Polymorphic usage
 * <Card.Root as="article">Article content</Card.Root>
 * <Card.Root as="a" href="/details">Clickable card</Card.Root>
 * ```
 */
const CardRoot = forwardRefWithAs<'div', CardRootOwnProps>((props, ref) => {
  const {
    as,
    variant = 'elevated',
    color = 'neutral',
    surfaceLevel = 'default',
    shadowElevation = 0,
    bordered = false,
    padding = 'md',
    interactive = false,
    gradient: deprecatedGradient,
    className,
    children,
    ...rest
  } = props

  const Component = as || 'div'
  // Handle deprecated gradient prop
  const effectiveVariant = deprecatedGradient ? 'gradient' : variant
  const effectiveColor = deprecatedGradient ? deprecatedGradient : color

  // Determine background/text classes based on variant
  const getVariantClasses = (): string => {
    switch (effectiveVariant) {
      case 'filled':
        return filledColorClasses[effectiveColor]
      case 'gradient':
        return gradientColorClasses[effectiveColor]
      case 'outlined':
        return cn('border', outlinedColorClasses[effectiveColor])
      case 'elevated':
      default:
        return cn(
          surfaceLevelClasses[surfaceLevel],
          'text-on-surface',
          bordered && 'border border-outline-variant',
        )
    }
  }

  // Determine if we should show the flat hairline frame
  const showFrame =
    effectiveVariant === 'elevated' || effectiveVariant === 'filled'

  return (
    <Component
      ref={ref}
      className={cn(
        // Base styles — small print-document radius driven by theme token
        'rounded-[var(--radius-card,0.75rem)]',
        // Flat frame on elevated/filled cards only — outlined cards already
        // carry their own semantic border color. Placed before the variant
        // classes so an explicit `bordered` color still wins.
        showFrame && elevationFrameClasses[shadowElevation],
        // Variant-specific styles
        getVariantClasses(),
        // Padding
        padding !== 'none' && paddingClasses[padding],
        // Interactive state — a border step, never a transform
        interactive &&
          'cursor-pointer hover:border-outline-variant transition-colors duration-fast ease-standard focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
        className,
      )}
      {...rest}
    >
      {children}
    </Component>
  )
})

CardRoot.displayName = 'Card.Root'

// ============================================================================
// Header Component
// ============================================================================

/**
 * Base props for Card.Header component
 */
export type CardHeaderOwnProps = {
  /**
   * Whether to show a divider below the header
   * @default false
   */
  withDivider?: boolean
}


/**
 * Card.Header - Header section for card title and actions
 */
const CardHeader = forwardRefWithAs<'div', CardHeaderOwnProps>((props, ref) => {
  const { as, withDivider = false, className, children, ...rest } = props
  const Component = as || 'div'
  return (
    <Component
      ref={ref}
      className={cn(
        'flex items-start justify-between',
        withDivider ? 'pb-4 mb-4 border-b border-current/20' : 'mb-4',
        className,
      )}
      {...rest}
    >
      {children}
    </Component>
  )
})

CardHeader.displayName = 'Card.Header'

// ============================================================================
// Title Component
// ============================================================================

/**
 * Base props for Card.Title component
 */
export type CardTitleOwnProps = object


/**
 * Card.Title - Title text for the card
 * Inherits text color from parent (supports all variants)
 */
const CardTitle = forwardRefWithAs<'h3', CardTitleOwnProps>((props, ref) => {
  const { as, className, children, ...rest } = props
  const Component = as || 'h3'
  return (
    <Component
      ref={ref}
      className={cn(
        'text-title-lg font-semibold leading-tight',
        'text-inherit',
        className,
      )}
      {...rest}
    >
      {children}
    </Component>
  )
})

CardTitle.displayName = 'Card.Title'

// ============================================================================
// Description Component
// ============================================================================

/**
 * Base props for Card.Description component
 */
export type CardDescriptionOwnProps = object


/**
 * Card.Description - Subtitle or description text
 */
const CardDescription = forwardRefWithAs<'p', CardDescriptionOwnProps>(
  (props, ref) => {
    const { as, className, children, ...rest } = props
    const Component = as || 'p'
    return (
      <Component
        ref={ref}
        className={cn(
          'text-body-sm mt-1.5 leading-relaxed',
          'text-inherit opacity-80',
          className,
        )}
        {...rest}
      >
        {children}
      </Component>
    )
  },
)

CardDescription.displayName = 'Card.Description'

// ============================================================================
// Body Component
// ============================================================================

/**
 * Base props for Card.Body component
 */
export type CardBodyOwnProps = object


/**
 * Card.Body - Main content area of the card
 */
const CardBody = forwardRefWithAs<'div', CardBodyOwnProps>((props, ref) => {
  const { as, className, children, ...rest } = props
  const Component = as || 'div'
  return (
    <Component
      ref={ref}
      className={cn('text-body-md leading-relaxed', 'text-inherit', className)}
      {...rest}
    >
      {children}
    </Component>
  )
})

CardBody.displayName = 'Card.Body'

// ============================================================================
// Footer Component
// ============================================================================

/**
 * Base props for Card.Footer component
 */
export type CardFooterOwnProps = {
  /**
   * Whether to show a divider above the footer
   * @default false
   */
  withDivider?: boolean
  /**
   * Alignment of footer content
   * @default 'right'
   */
  align?: 'left' | 'center' | 'right' | 'between'
}


const alignClasses: Record<NonNullable<CardFooterOwnProps['align']>, string> = {
  left: 'justify-start',
  center: 'justify-center',
  right: 'justify-end',
  between: 'justify-between',
}

/**
 * Card.Footer - Footer section for actions
 */
const CardFooter = forwardRefWithAs<'div', CardFooterOwnProps>((props, ref) => {
  const {
    as,
    withDivider = false,
    align = 'right',
    className,
    children,
    ...rest
  } = props
  const Component = as || 'div'
  return (
    <Component
      ref={ref}
      className={cn(
        'flex items-center gap-3',
        alignClasses[align],
        withDivider ? 'pt-4 mt-4 border-t border-current/20' : 'mt-4',
        className,
      )}
      {...rest}
    >
      {children}
    </Component>
  )
})

CardFooter.displayName = 'Card.Footer'

// ============================================================================
// Compound Component Export
// ============================================================================

/**
 * Card compound component for displaying content in a contained format
 *
 * Uses composable variant + color props pattern (same as Button):
 * - variant: Controls visual style (elevated, filled, outlined, gradient)
 * - color: Controls color scheme when using filled/gradient variants
 *
 * @example
 * ```tsx
 * // Elevated card (default)
 * <Card.Root surfaceLevel="low" shadowElevation={1}>
 *   <Card.Header>
 *     <Card.Title>Card Title</Card.Title>
 *   </Card.Header>
 *   <Card.Body>Content</Card.Body>
 *   <Card.Footer>
 *     <Button>Action</Button>
 *   </Card.Footer>
 * </Card.Root>
 *
 * // Filled card
 * <Card.Root variant="filled" color="primary">
 *   <Card.Title>Filled Card</Card.Title>
 *   <Card.Body>Content with solid background</Card.Body>
 * </Card.Root>
 *
 * // Flat accent-framed card (legacy gradient key)
 * <Card.Root variant="gradient" color="secondary" shadowElevation={2}>
 *   <Card.Title>Accent Card</Card.Title>
 *   <Card.Body>Content on a flat low surface</Card.Body>
 * </Card.Root>
 *
 * // Outlined card
 * <Card.Root variant="outlined" color="primary">
 *   <Card.Title>Outlined Card</Card.Title>
 *   <Card.Body>Content with border only</Card.Body>
 * </Card.Root>
 * ```
 */
const Card = {
  Root: CardRoot,
  Header: CardHeader,
  Title: CardTitle,
  Description: CardDescription,
  Body: CardBody,
  Footer: CardFooter,
}

export default Card
