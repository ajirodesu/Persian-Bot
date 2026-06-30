import React from 'react'
import { X } from 'lucide-react'
import IconButton, {
  type IconButtonOwnProps,
} from '@/components/ui/buttons/IconButton'
import {
  forwardRefWithAs,
  type PolymorphicComponentPropsWithRef,
} from '@/utils/polymorphic.util'

/**
 * Base props for CloseButton component
 * Omits both 'icon' and 'aria-label' from IconButtonOwnProps
 * to make aria-label optional with a default value
 */
export type CloseButtonOwnProps = Omit<
  IconButtonOwnProps,
  'icon' | 'aria-label'
> & {
  className?: string
  'aria-label'?: string
}

/**
 * Polymorphic CloseButton props - inherits polymorphism from IconButton
 * @example
 * ```tsx
 * <CloseButton onClick={handleClose} />
 * <CloseButton as="a" href="#" aria-label="Close" />
 * ```
 */
export type CloseButtonProps<T extends React.ElementType = 'button'> =
  PolymorphicComponentPropsWithRef<T, CloseButtonOwnProps>

/**
 * CloseButton component - specialized IconButton for closing UI elements
 *
 * @example
 * ```tsx
 * <CloseButton onClick={handleClose} />
 * <CloseButton size="sm" variant="danger" />
 * <CloseButton aria-label="Close modal" />
 * <CloseButton as="a" href="#close" />
 * ```
 */
const CloseButton = forwardRefWithAs<'button', CloseButtonOwnProps>(
  (props, ref) => {
    const { as, 'aria-label': ariaLabel = 'Close', ...rest } = props
    return (
      <IconButton
        ref={ref}
        as={as as React.ElementType}
        icon={<X />}
        aria-label={ariaLabel}
        {...rest}
      />
    )
  },
)

CloseButton.displayName = 'CloseButton'

export default CloseButton
