import React, { createContext, useContext, useState } from 'react'
import { cn } from '@/utils/cn.util'

// ============================================================================
// Types
// ============================================================================

type TabsContextValue = {
  value: string
  onChange: (value: string) => void
  orientation: 'horizontal' | 'vertical'
  variant: TabsVariant
}

type TabsOrientation = 'horizontal' | 'vertical'
type TabsVariant =
  | 'line'
  | 'enclosed'
  | 'enclosed-colored'
  | 'soft-rounded'
  | 'solid-rounded'
  | 'unstyled'

// ============================================================================
// Context
// ============================================================================

const TabsContext = createContext<TabsContextValue | undefined>(undefined)

const useTabsContext = () => {
  const context = useContext(TabsContext)
  if (!context) {
    throw new Error('Tabs compound components must be used within Tabs.Root')
  }
  return context
}

// ============================================================================
// Root Component
// ============================================================================

export interface TabsRootProps {
  children: React.ReactNode
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
  orientation?: TabsOrientation
  className?: string
}

const TabsRoot: React.FC<TabsRootProps> = ({
  children,
  value: controlledValue,
  defaultValue = '',
  onChange,
  orientation = 'horizontal',
  className,
}) => {
  const [internalValue, setInternalValue] = useState(defaultValue)
  const [variant, setVariant] = useState<TabsVariant>('line')

  const isControlled = controlledValue !== undefined
  const value = isControlled ? controlledValue : internalValue

  const handleChange = (newValue: string) => {
    if (!isControlled) {
      setInternalValue(newValue)
    }
    onChange?.(newValue)
  }

  // Clone children to inject variant setter
  const childrenWithVariant = React.Children.map(children, (child) => {
    if (React.isValidElement(child) && child.type === TabsList) {
      return React.cloneElement(child, {
        onVariantChange: setVariant,
      } as Partial<TabsListProps>)
    }
    return child
  })

  const contextValue: TabsContextValue = {
    value,
    onChange: handleChange,
    orientation,
    variant,
  }

  return (
    <TabsContext.Provider value={contextValue}>
      <div
        className={cn(
          orientation === 'vertical' ? 'flex gap-6' : 'space-y-4',
          className,
        )}
      >
        {childrenWithVariant}
      </div>
    </TabsContext.Provider>
  )
}

TabsRoot.displayName = 'Tabs.Root'

// ============================================================================
// TabsList Component
// ============================================================================

export interface TabsListProps {
  children: React.ReactNode
  variant?: TabsVariant
  className?: string
  onVariantChange?: (variant: TabsVariant) => void
}

const variantClasses: Record<TabsVariant, string> = {
  line: 'border-b border-outline-variant',
  enclosed: 'bg-surface-container p-1 rounded-lg border border-outline-variant',
  'enclosed-colored':
    'bg-surface-container p-1 rounded-lg border border-outline-variant',
  'soft-rounded': 'bg-surface-container/50 p-1 rounded-full',
  'solid-rounded': 'bg-surface-container p-1 rounded-full',
  unstyled: '',
}

const TabsList: React.FC<TabsListProps> = ({
  children,
  variant = 'line',
  className,
  onVariantChange,
}) => {
  const { orientation } = useTabsContext()
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = React.useState(false)
  const [canScrollRight, setCanScrollRight] = React.useState(false)

  // Notify parent about variant on mount and when it changes
  React.useEffect(() => {
    onVariantChange?.(variant)
  }, [variant, onVariantChange])

  // Track scroll overflow so we can paint inset shadow indicators.
  // ResizeObserver rechecks whenever the container or its content resizes
  // (window resize, dynamic tab additions) without a separate viewport listener.
  // Only runs for horizontal orientation — vertical tabs never overflow this axis.
  React.useEffect(() => {
    if (orientation !== 'horizontal') return

    const el = scrollRef.current
    if (!el) return

    const update = () => {
      setCanScrollLeft(el.scrollLeft > 0)
      // 1px tolerance absorbs sub-pixel rounding on HiDPI / fractional-zoom displays
      setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 1)
    }

    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)

    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [orientation])

  // Inset box-shadow is the background-agnostic scroll indicator strategy:
  //   • Desktop: the native scrollbar track also shows (scrollbar-hiding classes removed),
  //     giving two reinforcing cues.
  //   • Mobile (iOS / Android): browsers never render a persistent scrollbar track, so
  //     this inset vignette is the sole persistent visual affordance for touch users.
  // rgb() notation with opacity is used to avoid needing a CSS variable reference inside
  // an inline style string — works on both light and dark surfaces.
  const shadows: string[] = []
  if (canScrollLeft) shadows.push('inset 12px 0 8px -8px rgb(0 0 0 / 0.15)')
  if (canScrollRight) shadows.push('inset -12px 0 8px -8px rgb(0 0 0 / 0.15)')
  const scrollStyle: React.CSSProperties | undefined =
    orientation === 'horizontal' && shadows.length > 0
      ? { boxShadow: shadows.join(', ') }
      : undefined

  return (
    <div
      ref={scrollRef}
      role="tablist"
      aria-orientation={orientation}
      style={scrollStyle}
      className={cn(
        'flex',
        orientation === 'vertical' ? 'flex-col' : 'flex-row',
        // overflow-x-auto enables horizontal scroll. The scrollbar-hiding classes that
        // were here previously are intentionally removed: on desktop the native scrollbar
        // track acts as a secondary scroll indicator; on mobile it is always
        // overlay-and-fade, so the inset box-shadow above is the primary cue.
        orientation === 'horizontal' && 'overflow-x-auto',
        variant === 'line' && orientation === 'horizontal' && 'gap-6',
        variant === 'line' && orientation === 'vertical' && 'gap-2',
        variant === 'enclosed' && 'gap-1',
        variant === 'enclosed-colored' && 'gap-1',
        (variant === 'soft-rounded' || variant === 'solid-rounded') && 'gap-1',
        variant === 'unstyled' && 'gap-2',
        variantClasses[variant],
        className,
      )}
    >
      {children}
    </div>
  )
}

TabsList.displayName = 'Tabs.List'

// ============================================================================
// Tab Component
// ============================================================================

export interface TabProps {
  value: string
  children: React.ReactNode
  disabled?: boolean
  icon?: React.ReactNode
  className?: string
}

const Tab: React.FC<TabProps> = ({
  value: tabValue,
  children,
  disabled = false,
  icon,
  className,
}) => {
  const { value, onChange, orientation, variant } = useTabsContext()
  const isActive = value === tabValue

  const handleClick = () => {
    if (!disabled) {
      onChange(tabValue)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return

    // Arrow key navigation
    const tabList = e.currentTarget.parentElement
    if (!tabList) return

    const tabs = Array.from(
      tabList.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ).filter((tab) => !tab.disabled)

    const currentIndex = tabs.indexOf(e.currentTarget)

    let nextIndex = currentIndex

    if (orientation === 'horizontal') {
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        nextIndex = (currentIndex + 1) % tabs.length
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        nextIndex = (currentIndex - 1 + tabs.length) % tabs.length
      }
    } else {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        nextIndex = (currentIndex + 1) % tabs.length
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        nextIndex = (currentIndex - 1 + tabs.length) % tabs.length
      }
    }

    if (e.key === 'Home') {
      e.preventDefault()
      nextIndex = 0
    } else if (e.key === 'End') {
      e.preventDefault()
      nextIndex = tabs.length - 1
    }

    if (nextIndex !== currentIndex) {
      tabs[nextIndex]?.focus()
      tabs[nextIndex]?.click()
    }
  }

  // Base styles that apply to all variants
  const baseStyles = cn(
    'relative inline-flex items-center gap-2 px-4 py-2 text-label-lg font-medium transition-all duration-fast',
    'whitespace-nowrap shrink-0',
    disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
  )

  // Focus styles based on variant
  const focusStyles = cn(
    'focus-visible:outline-none',
    // Line and unstyled variants: simple focus ring
    (variant === 'line' || variant === 'unstyled') &&
      'focus-visible:ring-2 focus-visible:ring-primary/20',
    // Enclosed variants: minimal focus, active state is already clear
    (variant === 'enclosed' || variant === 'enclosed-colored') &&
      'focus-visible:ring-1 focus-visible:ring-primary/20',
    // Rounded variants: focus ring that follows the shape
    (variant === 'soft-rounded' || variant === 'solid-rounded') &&
      'focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:ring-offset-1',
  )

  // Variant-specific styles
  const variantStyles = {
    line: cn(
      isActive
        ? 'text-on-surface'
        : 'text-on-surface-variant hover:text-on-surface',
      orientation === 'horizontal' && isActive && 'border-b-2 border-primary',
      orientation === 'vertical' &&
        isActive &&
        'border-l-2 border-primary bg-primary/8 rounded-r-lg',
      orientation === 'vertical' &&
        !isActive &&
        'hover:bg-on-surface/[var(--state-hover-opacity)] rounded-lg',
    ),
    enclosed: cn(
      'rounded-md',
      isActive
        ? 'bg-surface text-on-surface shadow-elevation-1'
        : 'text-on-surface-variant hover:text-on-surface hover:bg-on-surface/[var(--state-hover-opacity)]',
    ),
    'enclosed-colored': cn(
      'rounded-md',
      isActive
        ? 'bg-primary text-on-primary shadow-elevation-1'
        : 'text-on-surface-variant hover:text-on-surface hover:bg-on-surface/[var(--state-hover-opacity)]',
    ),
    'soft-rounded': cn(
      'rounded-full',
      isActive
        ? 'bg-surface text-on-surface shadow-elevation-1'
        : 'text-on-surface-variant hover:text-on-surface hover:bg-on-surface/[var(--state-hover-opacity)]',
    ),
    'solid-rounded': cn(
      'rounded-full',
      isActive
        ? 'bg-primary text-on-primary shadow-elevation-1'
        : 'text-on-surface-variant hover:text-on-surface hover:bg-on-surface/[var(--state-hover-opacity)]',
    ),
    unstyled: cn(
      isActive
        ? 'text-on-surface'
        : 'text-on-surface-variant hover:text-on-surface',
    ),
  }

  return (
    <button
      role="tab"
      type="button"
      aria-selected={isActive}
      aria-controls={`panel-${tabValue}`}
      id={`tab-${tabValue}`}
      tabIndex={isActive ? 0 : -1}
      disabled={disabled}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={cn(baseStyles, focusStyles, variantStyles[variant], className)}
    >
      {icon && <span className="flex items-center">{icon}</span>}
      <span>{children}</span>
    </button>
  )
}

Tab.displayName = 'Tabs.Tab'

// ============================================================================
// TabPanels Component
// ============================================================================

export interface TabPanelsProps {
  children: React.ReactNode
  className?: string
}

const TabPanels: React.FC<TabPanelsProps> = ({ children, className }) => {
  return <div className={cn('mt-4', className)}>{children}</div>
}

TabPanels.displayName = 'Tabs.Panels'

// ============================================================================
// TabPanel Component
// ============================================================================

export interface TabPanelProps {
  value: string
  children: React.ReactNode
  className?: string
}

const TabPanel: React.FC<TabPanelProps> = ({
  value: panelValue,
  children,
  className,
}) => {
  const { value } = useTabsContext()
  const isActive = value === panelValue

  if (!isActive) return null

  return (
    <div
      role="tabpanel"
      id={`panel-${panelValue}`}
      aria-labelledby={`tab-${panelValue}`}
      tabIndex={0}
      className={cn(
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:ring-offset-2 focus-visible:ring-offset-surface rounded-lg',
        'animate-in fade-in duration-normal',
        className,
      )}
    >
      {children}
    </div>
  )
}

TabPanel.displayName = 'Tabs.Panel'

// ============================================================================
// Compound Component Export
// ============================================================================

const Tabs = {
  Root: TabsRoot,
  List: TabsList,
  Tab: Tab,
  Panels: TabPanels,
  Panel: TabPanel,
}

export default Tabs
