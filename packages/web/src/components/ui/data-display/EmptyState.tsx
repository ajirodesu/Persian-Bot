import Button from '@/components/ui/buttons/Button'
import { cn } from '@/utils/cn.util'
import {
  forwardRefWithAs,
  type PolymorphicComponentPropsWithRef,
} from '@/utils/polymorphic.util'

type EmptyStateSize = 'sm' | 'md'

/**
 * Base props for EmptyState component (excluding HTML attributes)
 */
export type EmptyStateOwnProps = {
  icon?: React.ElementType
  title: string
  description?: string
  action?: {
    label: string
    onClick: () => void
    icon?: React.ReactNode
  }
  size?: EmptyStateSize
}

/**
 * Polymorphic EmptyState props - supports `as` prop for rendering as different elements
 * @example
 * ```tsx
 * <EmptyState as="section" title="No items" />
 * <EmptyState as="article" title="Nothing found" />
 * ```
 */
export type EmptyStateProps<T extends React.ElementType = 'div'> =
  PolymorphicComponentPropsWithRef<T, EmptyStateOwnProps>

/**
 * Size configuration for EmptyState variants
 * - sm: Compact size for use in dropdowns, comboboxes, small containers
 * - md: Default size for page-level or card-level empty states
 */
const sizeConfig: Record<
  EmptyStateSize,
  {
    wrapper: string
    iconWrapper: string
    icon: string
    title: string
    description: string
    buttonSize: 'sm' | 'md'
  }
> = {
  sm: {
    wrapper: 'p-6',
    iconWrapper: 'h-10 w-10 mb-3',
    icon: 'h-5 w-5',
    title: 'text-label-lg font-medium mb-1',
    description: 'text-body-sm mb-3',
    buttonSize: 'sm',
  },
  md: {
    wrapper: 'p-12',
    iconWrapper: 'h-16 w-16 mb-4',
    icon: 'h-8 w-8',
    title: 'text-title-lg font-semibold mb-2',
    description: 'text-body-md mb-4',
    buttonSize: 'md',
  },
}

/**
 * EmptyState component for displaying empty list states
 *
 * @example
 * ```tsx
 * // Default size for pages/cards
 * <EmptyState
 *   icon={Search}
 *   title="No results found"
 *   description="Try adjusting your filters"
 * />
 *
 * // Compact size for dropdowns/comboboxes
 * <EmptyState
 *   icon={Search}
 *   title="No options found"
 *   size="sm"
 * />
 *
 * // With action button
 * <EmptyState
 *   icon={Plus}
 *   title="No tasks yet"
 *   description="Create your first task to get started"
 *   action={{
 *     label: "Add Task",
 *     onClick: () => setModalOpen(true),
 *     icon: <Plus className="h-4 w-4" />
 *   }}
 * />
 *
 * // Polymorphic usage
 * <EmptyState as="section" title="No items" />
 * <EmptyState as="article" title="Nothing found" />
 * ```
 */
const EmptyState = forwardRefWithAs<'div', EmptyStateOwnProps>((props, ref) => {
  const {
    as,
    icon: Icon,
    title,
    description,
    action,
    size = 'md',
    className,
    ...rest
  } = props

  const Component = as || 'div'
  const config = sizeConfig[size]

  return (
    <Component
      ref={ref}
      className={cn(
        'bg-surface-container rounded-lg text-center',
        config.wrapper,
        className,
      )}
      {...rest}
    >
      <div className="max-w-sm mx-auto">
        {Icon && (
          <div
            className={cn(
              'rounded-full bg-on-surface/10 flex items-center justify-center mx-auto',
              config.iconWrapper,
            )}
          >
            <Icon className={cn('text-on-surface-variant', config.icon)} />
          </div>
        )}
        <h3 className={cn('text-on-surface', config.title)}>{title}</h3>
        {description && (
          <p className={cn('text-on-surface-variant', config.description)}>
            {description}
          </p>
        )}
        {action && (
          <Button
            variant="filled"
            color="primary"
            size={config.buttonSize}
            leftIcon={action.icon}
            onClick={action.onClick}
          >
            {action.label}
          </Button>
        )}
      </div>
    </Component>
  )
})

EmptyState.displayName = 'EmptyState'

export default EmptyState
