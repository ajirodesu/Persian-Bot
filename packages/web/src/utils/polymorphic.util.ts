import React from 'react'

/**
 * Polymorphic component utilities for creating components with the `as` prop pattern.
 *
 * This enables components to render as different HTML elements or React components
 * while maintaining full type safety.
 *
 * @example
 * ```tsx
 * // Define a polymorphic Button component
 * type ButtonOwnProps = { variant?: 'filled' | 'outlined' }
 * type ButtonProps<T extends React.ElementType = 'button'> =
 *   PolymorphicComponentPropsWithRef<T, ButtonOwnProps>
 *
 * const Button = forwardRefWithAs<'button', ButtonOwnProps>((props, ref) => {
 *   const { as: Component = 'button', variant = 'filled', ...rest } = props
 *   return <Component ref={ref} {...rest} />
 * })
 *
 * // Usage
 * <Button>Click me</Button>                    // renders as <button>
 * <Button as="a" href="/home">Go Home</Button> // renders as <a> with href support
 * <Button as={Link} to="/about">About</Button> // renders as React Router Link
 * ```
 */

/**
 * Extract the ref type from an element type
 */
export type PolymorphicRef<T extends React.ElementType> =
  React.ComponentPropsWithRef<T>['ref']

/**
 * Props for a polymorphic component without ref
 * - Includes the `as` prop
 * - Merges custom props with the element's native props
 * - Removes conflicting keys from native props
 */
export type PolymorphicComponentProps<
  T extends React.ElementType,
  Props = object,
> = {
  as?: T
} & Props &
  Omit<React.ComponentPropsWithoutRef<T>, keyof Props | 'as'>

/**
 * Props for a polymorphic component with ref support
 * - Includes everything from PolymorphicComponentProps
 * - Adds correctly typed ref
 */
export type PolymorphicComponentPropsWithRef<
  T extends React.ElementType,
  Props = object,
> = PolymorphicComponentProps<T, Props> & { ref?: PolymorphicRef<T> }

/**
 * Type for a polymorphic forwardRef component
 * This is used to properly type the component after wrapping with forwardRef
 */
export interface PolymorphicForwardRefComponent<
  DefaultElement extends React.ElementType,
  Props = object,
> {
  <T extends React.ElementType = DefaultElement>(
    props: PolymorphicComponentPropsWithRef<T, Props>,
  ): React.ReactNode
  displayName?: string
}

/**
 * Helper function to create a polymorphic component with forwardRef
 * This handles the TypeScript complexity of polymorphic refs
 */
export function forwardRefWithAs<
  DefaultElement extends React.ElementType,
  Props = object,
>(
  render: <T extends React.ElementType = DefaultElement>(
    props: PolymorphicComponentProps<T, Props>,
    ref: PolymorphicRef<T>,
  ) => React.ReactNode,
): PolymorphicForwardRefComponent<DefaultElement, Props> {
  return React.forwardRef(
    render as unknown as React.ForwardRefRenderFunction<unknown>,
  ) as unknown as PolymorphicForwardRefComponent<DefaultElement, Props>
}
