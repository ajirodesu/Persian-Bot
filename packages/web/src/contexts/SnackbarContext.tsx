import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useRef,
} from 'react'
import { SnackbarContainer } from '@/components/ui/feedback/Snackbar'
import type {
  SnackbarProps,
  SnackbarPosition,
  SnackbarVariant,
  SnackbarColor,
  SnackbarAction,
} from '@/components/ui/feedback/Snackbar'

// ============================================================================
// Types
// ============================================================================

export interface SnackbarOptions {
  /** Visual variant style */
  variant?: SnackbarVariant
  /** Color scheme (for tonal/filled variants) */
  color?: SnackbarColor
  /** Brief message to display */
  message: string
  /** Optional icon element to display on the left side */
  icon?: React.ReactNode
  /** Optional single action button */
  action?: SnackbarAction
  /** Show close/dismiss button */
  showClose?: boolean
  /** Duration in milliseconds before auto-dismiss (0 = no auto-dismiss) */
  duration?: number
}

interface SnackbarContextType {
  /** Current snackbar position */
  position: SnackbarPosition
  /** Update snackbar container position */
  setPosition: (position: SnackbarPosition) => void
  /** Show a snackbar notification */
  snackbar: (options: SnackbarOptions) => string
  /** Show a snackbar with just a message (convenience) */
  show: (message: string, action?: SnackbarAction) => string
  /** Show a success-colored snackbar */
  success: (message: string, action?: SnackbarAction) => string
  /** Show an error-colored snackbar */
  error: (message: string, action?: SnackbarAction) => string
  /** Show a warning-colored snackbar */
  warning: (message: string, action?: SnackbarAction) => string
  /** Show an info-colored snackbar */
  info: (message: string, action?: SnackbarAction) => string
  /** Dismiss the current snackbar */
  dismiss: () => void
}

// ============================================================================
// Context
// ============================================================================

const SnackbarContext = createContext<SnackbarContextType | undefined>(
  undefined,
)

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook to access snackbar functionality
 *
 * @throws Error if used outside of SnackbarProvider
 *
 * @example
 * ```tsx
 * const { snackbar, show, success, dismiss, setPosition } = useSnackbar()
 *
 * // Basic snackbar
 * show('Changes saved')
 *
 * // With action
 * show('Item deleted', { label: 'Undo', onClick: handleUndo })
 *
 * // Convenience methods
 * success('Upload complete')
 * error('Connection failed')
 *
 * // Full options
 * snackbar({
 *   variant: 'tonal',
 *   color: 'primary',
 *   message: 'Settings updated',
 *   duration: 5000,
 * })
 *
 * // Change position
 * setPosition('bottom-left')
 * ```
 */
// eslint-disable-next-line react-refresh/only-export-components
export const useSnackbar = (): SnackbarContextType => {
  const context = useContext(SnackbarContext)
  if (!context) {
    throw new Error('useSnackbar must be used within a SnackbarProvider')
  }
  return context
}

// ============================================================================
// Provider Props
// ============================================================================

export interface SnackbarProviderProps {
  /** Child components */
  children: React.ReactNode
  /** Default position for snackbars */
  position?: SnackbarPosition
  /** Default duration for snackbars (ms) */
  defaultDuration?: number
  /** Default variant for snackbars */
  defaultVariant?: SnackbarVariant
}

// ============================================================================
// Provider Component
// ============================================================================

/**
 * SnackbarProvider - Context provider for snackbar notifications
 *
 * Material Design recommends showing only one snackbar at a time.
 * When a new snackbar is triggered while one is displayed, the old
 * one is immediately dismissed and the new one appears.
 *
 * @example
 * ```tsx
 * <SnackbarProvider position="bottom-center" defaultDuration={4000}>
 *   <App />
 * </SnackbarProvider>
 *
 * // Inside any component:
 * const { show, success, setPosition } = useSnackbar()
 * show('Hello!')
 * success('Saved!')
 * setPosition('bottom-left')
 * ```
 */
export const SnackbarProvider: React.FC<SnackbarProviderProps> = ({
  children,
  position: initialPosition = 'bottom-center',
  defaultDuration = 4000,
  defaultVariant = 'standard',
}) => {
  const [currentSnackbar, setCurrentSnackbar] = useState<SnackbarProps | null>(
    null,
  )
  const [position, setPositionState] =
    useState<SnackbarPosition>(initialPosition)
  const idCounter = useRef(0)

  /**
   * Update snackbar container position
   */
  const setPosition = useCallback((newPosition: SnackbarPosition) => {
    const validPositions: SnackbarPosition[] = [
      'top-left',
      'top-center',
      'top-right',
      'bottom-left',
      'bottom-center',
      'bottom-right',
    ]
    if (validPositions.includes(newPosition)) {
      setPositionState(newPosition)
    } else {
      console.error(`Invalid snackbar position: ${newPosition}`)
    }
  }, [])

  /**
   * Generate unique ID for snackbar
   */
  const generateId = useCallback((): string => {
    idCounter.current += 1
    return `snackbar-${Date.now()}-${idCounter.current}`
  }, [])

  /**
   * Show a snackbar (replaces any existing one)
   */
  const showSnackbar = useCallback(
    (options: SnackbarOptions): string => {
      const id = generateId()

      const snackbarData: SnackbarProps = {
        id,
        variant: options.variant ?? defaultVariant,
        color: options.color ?? 'neutral',
        message: options.message,
        icon: options.icon,
        action: options.action,
        showClose: options.showClose ?? false,
        duration: options.duration ?? defaultDuration,
      }

      // Replace any existing snackbar (Material Design: one at a time)
      setCurrentSnackbar(snackbarData)

      return id
    },
    [generateId, defaultVariant, defaultDuration],
  )

  /**
   * Dismiss the current snackbar
   */
  const dismissSnackbar = useCallback(() => {
    setCurrentSnackbar(null)
  }, [])

  /**
   * Convenience method - show with just message
   */
  const showMessage = useCallback(
    (message: string, action?: SnackbarAction): string => {
      return showSnackbar({ message, action })
    },
    [showSnackbar],
  )

  /**
   * Convenience method for success snackbar
   */
  const showSuccess = useCallback(
    (message: string, action?: SnackbarAction): string => {
      return showSnackbar({
        variant: 'tonal',
        color: 'success',
        message,
        action,
      })
    },
    [showSnackbar],
  )

  /**
   * Convenience method for error snackbar
   */
  const showError = useCallback(
    (message: string, action?: SnackbarAction): string => {
      return showSnackbar({
        variant: 'tonal',
        color: 'error',
        message,
        action,
      })
    },
    [showSnackbar],
  )

  /**
   * Convenience method for warning snackbar
   */
  const showWarning = useCallback(
    (message: string, action?: SnackbarAction): string => {
      return showSnackbar({
        variant: 'tonal',
        color: 'warning',
        message,
        action,
      })
    },
    [showSnackbar],
  )

  /**
   * Convenience method for info snackbar
   */
  const showInfo = useCallback(
    (message: string, action?: SnackbarAction): string => {
      return showSnackbar({
        variant: 'tonal',
        color: 'info',
        message,
        action,
      })
    },
    [showSnackbar],
  )

  /**
   * Context value - memoized to prevent unnecessary re-renders
   */
  const value = useMemo<SnackbarContextType>(
    () => ({
      position,
      setPosition,
      snackbar: showSnackbar,
      show: showMessage,
      success: showSuccess,
      error: showError,
      warning: showWarning,
      info: showInfo,
      dismiss: dismissSnackbar,
    }),
    [
      position,
      setPosition,
      showSnackbar,
      showMessage,
      showSuccess,
      showError,
      showWarning,
      showInfo,
      dismissSnackbar,
    ],
  )

  return (
    <SnackbarContext.Provider value={value}>
      {children}
      <SnackbarContainer
        position={position}
        snackbar={currentSnackbar}
        onDismiss={dismissSnackbar}
      />
    </SnackbarContext.Provider>
  )
}
