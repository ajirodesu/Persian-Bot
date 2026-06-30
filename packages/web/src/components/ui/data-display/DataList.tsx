import { cn } from '@/utils/cn.util'
import { forwardRefWithAs } from '@/utils/polymorphic.util'

// ============================================================================
// Types
// ============================================================================

export type DataListSize = 'sm' | 'md' | 'lg'
export type DataListOrientation = 'horizontal' | 'vertical'

// ============================================================================
// Style Maps
// ============================================================================

const rootSizeClasses: Record<DataListSize, string> = {
  sm: 'text-body-sm gap-2',
  md: 'text-body-md gap-3',
  lg: 'text-body-lg gap-4',
}

// ============================================================================
// Root Component
// ============================================================================

export type DataListRootOwnProps = {
  size?: DataListSize
  orientation?: DataListOrientation
  divideY?: boolean
}

const DataListRoot = forwardRefWithAs<'dl', DataListRootOwnProps>(
  (props, ref) => {
    const {
      as,
      size = 'md',
      orientation = 'horizontal',
      divideY = false,
      className,
      children,
      ...rest
    } = props

    const Component = as || 'dl'

    return (
      <Component
        ref={ref}
        className={cn(
          'w-full',
          rootSizeClasses[size],
          divideY && 'divide-y divide-outline-variant',
          className,
        )}
        data-orientation={orientation}
        data-size={size}
        {...rest}
      >
        {children}
      </Component>
    )
  },
)

DataListRoot.displayName = 'DataList.Root'

// ============================================================================
// Item Component
// ============================================================================

export type DataListItemOwnProps = object

const DataListItem = forwardRefWithAs<'div', DataListItemOwnProps>(
  (props, ref) => {
    const { as, className, children, ...rest } = props
    const Component = as || 'div'

    return (
      <Component
        ref={ref}
        className={cn(
          'flex py-3 gap-4',
          '[dl[data-orientation="horizontal"]_&]:flex-row [dl[data-orientation="horizontal"]_&]:items-center',
          '[dl[data-orientation="vertical"]_&]:flex-col',
          className,
        )}
        {...rest}
      >
        {children}
      </Component>
    )
  },
)

DataListItem.displayName = 'DataList.Item'

// ============================================================================
// ItemLabel Component
// ============================================================================

export type DataListItemLabelOwnProps = {
  width?: string
}

const DataListItemLabel = forwardRefWithAs<'dt', DataListItemLabelOwnProps>(
  (props, ref) => {
    const { as, width, className, children, style, ...rest } = props
    const Component = as || 'dt'

    return (
      <Component
        ref={ref}
        className={cn(
          'text-on-surface-variant font-medium flex-shrink-0',
          className,
        )}
        style={{ width, minWidth: width, ...style }}
        {...rest}
      >
        {children}
      </Component>
    )
  },
)

DataListItemLabel.displayName = 'DataList.ItemLabel'

// ============================================================================
// ItemValue Component
// ============================================================================

export type DataListItemValueOwnProps = object

const DataListItemValue = forwardRefWithAs<'dd', DataListItemValueOwnProps>(
  (props, ref) => {
    const { as, className, children, ...rest } = props
    const Component = as || 'dd'

    return (
      <Component
        ref={ref}
        // min-w-0 overrides the browser's min-width:auto on flex items so flex-1
        // can actually shrink below content intrinsic width in constrained containers
        className={cn('text-on-surface flex-1 min-w-0', className)}
        {...rest}
      >
        {children}
      </Component>
    )
  },
)

DataListItemValue.displayName = 'DataList.ItemValue'

// ============================================================================
// Compound Export
// ============================================================================

const DataList = {
  Root: DataListRoot,
  Item: DataListItem,
  ItemLabel: DataListItemLabel,
  ItemValue: DataListItemValue,
}

export default DataList
