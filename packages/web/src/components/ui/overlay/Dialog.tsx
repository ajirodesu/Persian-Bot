import React, {
  createContext,
  useContext,
  useState,
  useRef,
  useEffect,
  useCallback,
} from 'react'
import { createPortal } from 'react-dom'
import CloseButton from '@/components/ui/buttons/CloseButton'
import { cn } from '@/utils/cn.util'

// ============================================================================
// Types
// ============================================================================

type DialogContextValue = {
  isOpen: boolean
  open: () => void
  close: () => void
  closeOnOverlayClick: boolean
  closeOnEsc: boolean
  triggerRef: React.RefObject<HTMLElement | null>
  contentRef: React.RefObject<HTMLDivElement | null>
}

type DialogSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'full' | 'cover'

// ============================================================================
// Context
// ============================================================================

const DialogContext = createContext<DialogContextValue | undefined>(undefined)

const useDialogContext = () => {
  const context = useContext(DialogContext)
  if (!context) {
    throw new Error(
      'Dialog compound components must be used within Dialog.Root',
    )
  }
  return context
}

// ============================================================================
// Root Component
// ============================================================================

export interface DialogRootProps {
  children: React.ReactNode
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  closeOnOverlayClick?: boolean
  closeOnEsc?: boolean
}

/**
 * Dialog.Root - Provider component that manages dialog state
 *
 * @example
 * ```tsx
 * <Dialog.Root open={isOpen} onOpenChange={setIsOpen}>
 *   <Dialog.Trigger asChild>
 *     <Button>Open Dialog</Button>
 *   </Dialog.Trigger>
 *   <Dialog.Positioner>
 *     <Dialog.Backdrop />
 *     <Dialog.Content>...</Dialog.Content>
 *   </Dialog.Positioner>
 * </Dialog.Root>
 * ```
 */
const DialogRoot: React.FC<DialogRootProps> = ({
  children,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  closeOnOverlayClick = true,
  closeOnEsc = true,
}) => {
  const [internalOpen, setInternalOpen] = useState(defaultOpen)
  const triggerRef = useRef<HTMLElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const previousActiveElement = useRef<HTMLElement | null>(null)

  const isControlled = controlledOpen !== undefined
  const isOpen = isControlled ? controlledOpen : internalOpen

  const open = useCallback(() => {
    if (!isControlled) {
      setInternalOpen(true)
    }
    onOpenChange?.(true)
  }, [isControlled, onOpenChange])

  const close = useCallback(() => {
    if (!isControlled) {
      setInternalOpen(false)
    }
    onOpenChange?.(false)
  }, [isControlled, onOpenChange])

  // Focus management and scroll lock
  useEffect(() => {
    if (isOpen) {
      previousActiveElement.current = document.activeElement as HTMLElement

      setTimeout(() => {
        contentRef.current?.focus()
      }, 100)

      document.body.style.overflow = 'hidden'

      return () => {
        document.body.style.overflow = ''

        if (previousActiveElement.current) {
          previousActiveElement.current.focus()
        }
      }
    }
  }, [isOpen])

  const value: DialogContextValue = {
    isOpen,
    open,
    close,
    closeOnOverlayClick,
    closeOnEsc,
    triggerRef,
    contentRef,
  }

  return (
    <DialogContext.Provider value={value}>{children}</DialogContext.Provider>
  )
}

// ============================================================================
// Trigger Component
// ============================================================================

export interface DialogTriggerProps {
  children: React.ReactNode
  asChild?: boolean
  className?: string
}

/**
 * Dialog.Trigger - Button that opens the dialog
 */
const DialogTrigger: React.FC<DialogTriggerProps> = ({
  children,
  asChild = false,
  className,
}) => {
  const { open, triggerRef } = useDialogContext()

  const handleClick = () => {
    open()
  }

  if (asChild) {
    const child = React.Children.only(children) as React.ReactElement<
      React.HTMLAttributes<HTMLElement>
    >

    return React.cloneElement(child, {
      ...child.props,
      onClick: (e: React.MouseEvent<HTMLElement>) => {
        child.props.onClick?.(e)
        handleClick()
      },
    } as React.HTMLAttributes<HTMLElement>)
  }

  return (
    <button
      ref={triggerRef as React.RefObject<HTMLButtonElement>}
      type="button"
      onClick={handleClick}
      className={className}
    >
      {children}
    </button>
  )
}

// ============================================================================
// Backdrop Component
// ============================================================================

export interface DialogBackdropProps {
  className?: string
}

/**
 * Dialog.Backdrop - Semi-transparent overlay behind the dialog
 */
const DialogBackdrop: React.FC<DialogBackdropProps> = ({ className }) => {
  const { isOpen, close, closeOnOverlayClick } = useDialogContext()

  const handleClick = () => {
    if (closeOnOverlayClick) {
      close()
    }
  }

  if (!isOpen) return null

  return (
    <div
      className={cn(
        // iOS-style vibrancy on the scrim (deliberate blur exception, see
        // tokens.css --surface-blur-*) + M3 shared-axis fade, biased toward
        // an emphasized-decelerate curve on entry per HIG sheet motion.
        'absolute inset-0 bg-scrim/50 [backdrop-filter:var(--surface-blur-sm)] animate-in fade-in duration-normal ease-[var(--easing-emphasized-decelerate)]',
        className,
      )}
      onClick={handleClick}
      aria-hidden="true"
    />
  )
}

// ============================================================================
// Positioner Component
// ============================================================================

export interface DialogPositionerProps {
  children: React.ReactNode
  className?: string
  position?: 'top' | 'center'
}

/**
 * Dialog.Positioner - Positions the dialog content within the viewport
 */
const DialogPositioner: React.FC<DialogPositionerProps> = ({
  children,
  className,
  position = 'top',
}) => {
  const { isOpen, close, closeOnOverlayClick, closeOnEsc } = useDialogContext()

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (closeOnOverlayClick && e.target === e.currentTarget) {
      close()
    }
  }

  // ESC key handler
  useEffect(() => {
    if (!isOpen || !closeOnEsc) return

    const handleEscKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close()
      }
    }

    document.addEventListener('keydown', handleEscKey)
    return () => {
      document.removeEventListener('keydown', handleEscKey)
    }
  }, [isOpen, closeOnEsc, close])

  if (!isOpen) return null

  const positionClasses = {
    top: 'items-start pt-16',
    center: 'items-center',
  }

  return createPortal(
    <div
      className={cn(
        // `h-[100dvh]` (dynamic viewport height) instead of relying on
        // `inset-0` alone keeps this overlay locked to the browser's
        // *actual visible* viewport as chrome (address bar / bottom nav —
        // e.g. Brave, Chrome, Safari on mobile) shows and hides, instead
        // of sizing against the larger "layout viewport" that leaves the
        // dialog's top/bottom edges hidden behind those bars.
        'fixed inset-0 h-[100dvh] z-modal flex justify-center p-4',
        // Safe-area padding stacked on top of the base 1rem padding so the
        // dialog still clears notches/home-indicators without ever
        // shrinking below the design system's minimum spacing.
        '[padding-top:max(1rem,env(safe-area-inset-top))]',
        '[padding-bottom:max(1rem,env(safe-area-inset-bottom))]',
        positionClasses[position],
        className,
      )}
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
    >
      {children}
    </div>,
    document.body,
  )
}

// ============================================================================
// Content Component
// ============================================================================

export interface DialogContentProps {
  children: React.ReactNode
  size?: DialogSize
  className?: string
}

// Below `sm` there is no width cap — the dialog fills the space the
// Positioner's p-4 gutters leave it, which is the exact same 1rem gutter
// the page content (and its card grids) use, so a mobile popup's left/
// right edges land flush with the cards behind it instead of floating a
// narrower, seemingly-random width in the middle of the screen. The cap
// only kicks in from `sm` up, once there's room for a true centered modal.
const sizeClasses: Record<DialogSize, string> = {
  xs: 'sm:max-w-[20rem]',
  sm: 'sm:max-w-[28rem]',
  md: 'sm:max-w-[32rem]',
  lg: 'sm:max-w-[42rem]',
  xl: 'sm:max-w-[56rem]',
  full: 'max-w-[calc(100vw-1rem)] max-h-[calc(100dvh-1rem)]',
  cover: 'max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)]',
}

/**
 * Dialog.Content - Container for dialog content with focus trap
 */
const DialogContent: React.FC<DialogContentProps> = ({
  children,
  size = 'md',
  className,
}) => {
  const { contentRef, isOpen } = useDialogContext()

  // Focus trap implementation
  useEffect(() => {
    if (!isOpen) return

    const handleTabKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return

      const content = contentRef.current
      if (!content) return

      const focusableElements = content.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )

      const firstElement = focusableElements[0]
      const lastElement = focusableElements[focusableElements.length - 1]

      if (event.shiftKey) {
        if (document.activeElement === firstElement) {
          lastElement?.focus()
          event.preventDefault()
        }
      } else {
        if (document.activeElement === lastElement) {
          firstElement?.focus()
          event.preventDefault()
        }
      }
    }

    document.addEventListener('keydown', handleTabKey)
    return () => {
      document.removeEventListener('keydown', handleTabKey)
    }
  }, [isOpen, contentRef])

  return (
    <div
      ref={contentRef}
      tabIndex={-1}
      className={cn(
        // Shape comes from the shared card-radius token, never a hardcoded
        // rounded-xl — keeps dialogs visually consistent with Card.tsx.
        // Elevation-3 is reserved for true overlays (per the M3 restraint
        // rule: resting surfaces stay flat, floating surfaces carry depth).
        // Entrance uses the iOS spring/deceleration curve rather than the
        // default linear-ish ease, so the sheet settles instead of snapping.
        'relative w-full bg-surface rounded-[var(--radius-card-lg)] shadow-elevation-3 border border-outline-variant overflow-hidden animate-in zoom-in-95 fade-in duration-normal ease-[var(--easing-emphasized-decelerate)]',
        sizeClasses[size],
        className,
      )}
    >
      {children}
    </div>
  )
}

// ============================================================================
// Close Trigger Component
// ============================================================================

export interface DialogCloseTriggerProps {
  children?: React.ReactNode
  asChild?: boolean
  className?: string
  size?: 'sm' | 'md' | 'lg'
}

/**
 * Dialog.CloseTrigger - Button that closes the dialog
 * Renders CloseButton by default, or wraps children with close behavior
 */
const DialogCloseTrigger: React.FC<DialogCloseTriggerProps> = ({
  children,
  asChild = false,
  className,
  size = 'md',
}) => {
  const { close } = useDialogContext()

  const handleClick = () => {
    close()
  }

  if (asChild && children) {
    const child = React.Children.only(children) as React.ReactElement<
      React.HTMLAttributes<HTMLElement>
    >

    return React.cloneElement(child, {
      ...child.props,
      onClick: (e: React.MouseEvent<HTMLElement>) => {
        child.props.onClick?.(e)
        handleClick()
      },
    } as React.HTMLAttributes<HTMLElement>)
  }

  // Default: Use CloseButton if no children provided
  if (!children) {
    return (
      <CloseButton
        onClick={handleClick}
        size={size}
        variant="text"
        className={cn('ml-auto', className)}
      />
    )
  }

  return (
    <button
      onClick={handleClick}
      type="button"
      className={cn(
        // Visual size stays compact (p-1.5, matches the header's density);
        // the ::before pseudo-element extends the actual hit area to the
        // 44×44 HIG minimum without affecting layout — small target,
        // generous tap zone, same pattern used in IconButton.tsx.
        'relative ml-auto p-1.5 rounded-[var(--radius-input)] text-on-surface-variant hover:text-on-surface hover:bg-on-surface/8 transition-colors duration-fast focus:outline-none focus-visible:ring-2 focus-visible:ring-primary before:absolute before:left-1/2 before:top-1/2 before:h-[var(--touch-target-min)] before:w-[var(--touch-target-min)] before:-translate-x-1/2 before:-translate-y-1/2 before:content-[""]',
        className,
      )}
      aria-label="Close dialog"
    >
      {children}
    </button>
  )
}

// ============================================================================
// Header Component
// ============================================================================

export interface DialogHeaderProps {
  children: React.ReactNode
  className?: string
}

/**
 * Dialog.Header - Header section containing title and close button
 */
const DialogHeader: React.FC<DialogHeaderProps> = ({ children, className }) => {
  return (
    <div
      className={cn('flex items-center justify-between px-6 py-4', className)}
    >
      {children}
    </div>
  )
}

// ============================================================================
// Title Component
// ============================================================================

export interface DialogTitleProps {
  children: React.ReactNode
  className?: string
}

/**
 * Dialog.Title - Dialog title with proper heading semantics
 */
const DialogTitle: React.FC<DialogTitleProps> = ({ children, className }) => {
  return (
    <h2
      id="dialog-title"
      className={cn('text-title-lg font-semibold text-on-surface', className)}
    >
      {children}
    </h2>
  )
}

// ============================================================================
// Body Component
// ============================================================================

export interface DialogBodyProps {
  children: React.ReactNode
  className?: string
}

/**
 * Dialog.Body - Scrollable content area of the dialog
 */
const DialogBody: React.FC<DialogBodyProps> = ({ children, className }) => {
  return (
    <div
      className={cn(
        'px-6 pb-4 text-body-md text-on-surface overflow-y-auto max-h-[70dvh]',
        className,
      )}
    >
      {children}
    </div>
  )
}

// ============================================================================
// Footer Component
// ============================================================================

export interface DialogFooterProps {
  children: React.ReactNode
  className?: string
}

/**
 * Dialog.Footer - Footer section for action buttons
 */
const DialogFooter: React.FC<DialogFooterProps> = ({ children, className }) => {
  return (
    <div
      className={cn(
        'flex items-center justify-end gap-3 px-6 py-4 bg-surface',
        className,
      )}
    >
      {children}
    </div>
  )
}

// ============================================================================
// Compound Component Export
// ============================================================================

/**
 * Dialog compound component for modal dialogs
 *
 * Features:
 * - Compound component pattern for flexible composition
 * - Focus trap for accessibility
 * - Keyboard navigation (ESC to close, Tab cycling)
 * - Click outside to close (configurable)
 * - Portal rendering to document.body
 * - Scroll lock when open
 * - Full TypeScript support
 *
 * @example
 * ```tsx
 * <Dialog.Root open={isOpen} onOpenChange={setIsOpen}>
 *   <Dialog.Trigger asChild>
 *     <Button>Open Dialog</Button>
 *   </Dialog.Trigger>
 *   <Dialog.Positioner>
 *     <Dialog.Backdrop />
 *     <Dialog.Content size="md">
 *       <Dialog.Header>
 *         <Dialog.Title>Dialog Title</Dialog.Title>
 *         <Dialog.CloseTrigger />
 *       </Dialog.Header>
 *       <Dialog.Body>
 *         <p>Dialog content goes here.</p>
 *       </Dialog.Body>
 *       <Dialog.Footer>
 *         <Dialog.CloseTrigger asChild>
 *           <Button variant="text">Cancel</Button>
 *         </Dialog.CloseTrigger>
 *         <Button variant="primary">Confirm</Button>
 *       </Dialog.Footer>
 *     </Dialog.Content>
 *   </Dialog.Positioner>
 * </Dialog.Root>
 * ```
 */
const Dialog = {
  Root: DialogRoot,
  Trigger: DialogTrigger,
  Backdrop: DialogBackdrop,
  Positioner: DialogPositioner,
  Content: DialogContent,
  CloseTrigger: DialogCloseTrigger,
  Header: DialogHeader,
  Title: DialogTitle,
  Body: DialogBody,
  Footer: DialogFooter,
}

export default Dialog
