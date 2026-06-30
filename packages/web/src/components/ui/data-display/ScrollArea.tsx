import { cn } from '@/utils/cn.util'
import { forwardRefWithAs } from '@/utils/polymorphic.util'

// ============================================================================
// Types
// ============================================================================

export type ScrollAreaVariant = 'hover' | 'always'

// ============================================================================
// Root Component
// ============================================================================

export type ScrollAreaRootOwnProps = {
  maxH?: string
  maxW?: string
  variant?: ScrollAreaVariant
}

const ScrollAreaRoot = forwardRefWithAs<'div', ScrollAreaRootOwnProps>(
  (props, ref) => {
    const { as, maxH, maxW, className, children, style, ...rest } = props
    const Component = as || 'div'

    return (
      <Component
        ref={ref}
        className={cn('relative flex flex-col overflow-hidden', className)}
        style={{ maxHeight: maxH, maxWidth: maxW, ...style }}
        {...rest}
      >
        {children}
      </Component>
    )
  },
)

ScrollAreaRoot.displayName = 'ScrollArea.Root'

// ============================================================================
// Viewport Component
// ============================================================================

export type ScrollAreaViewportOwnProps = {
  variant?: ScrollAreaVariant
}

const ScrollAreaViewport = forwardRefWithAs<'div', ScrollAreaViewportOwnProps>(
  (props, ref) => {
    const { as, variant = 'hover', className, children, ...rest } = props
    const Component = as || 'div'

    // Scrollbar styling with explicit width control and Firefox support
    const scrollbarClasses =
      variant === 'hover'
        ? [
            'scrollbar-thin',
            '[&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar]:h-2',
            '[&::-webkit-scrollbar-track]:bg-transparent',
            '[&::-webkit-scrollbar-thumb]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full',
            'hover:[&::-webkit-scrollbar-thumb]:bg-on-surface/20',
            '[&::-webkit-scrollbar-thumb]:transition-colors',
          ].join(' ')
        : [
            'scrollbar-thin',
            '[&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar]:h-2',
            '[&::-webkit-scrollbar-track]:bg-surface-container-high [&::-webkit-scrollbar-track]:rounded-full',
            '[&::-webkit-scrollbar-thumb]:bg-on-surface/30 [&::-webkit-scrollbar-thumb]:rounded-full',
            'hover:[&::-webkit-scrollbar-thumb]:bg-on-surface/40',
          ].join(' ')

    return (
      <Component
        ref={ref}
        className={cn(
          'flex-1 min-h-0 overflow-auto',
          scrollbarClasses,
          className,
        )}
        {...rest}
      >
        {children}
      </Component>
    )
  },
)

ScrollAreaViewport.displayName = 'ScrollArea.Viewport'

// ============================================================================
// Compound Export
// ============================================================================

const ScrollArea = {
  Root: ScrollAreaRoot,
  Viewport: ScrollAreaViewport,
}

export default ScrollArea
