/**
 * Author: AjiroDesu
 *
 * Minimal top progress bar for route transitions.
 *
 * Driven by React Router's navigation state: appears while the next route
 * chunk resolves, completes and fades once it lands. Uses only the existing
 * primary accent — this is the single allowed new visual element for the
 * loading-experience pass. Fixed position, 2px, pointer-events-none, so it
 * can never shift layout or intercept input.
 */
import { useNavigation } from 'react-router-dom'
import { cn } from '@/utils/cn.util'

/**
 * Pure CSS state machine: the bar is always mounted off-screen-opacity, so
 * there is no timer, no state update, and no layout work — just two
 * composited transitions that run on the compositor.
 */
export default function RouteProgressBar() {
  const navigation = useNavigation()
  const busy = navigation.state !== 'idle'

  return (
    <div
      aria-hidden="true"
      className={cn(
        'fixed top-0 left-0 right-0 z-[999] h-0.5 pointer-events-none',
        'transition-opacity duration-200',
        busy ? 'opacity-100' : 'opacity-0 delay-300',
      )}
    >
      <div
        className={cn(
          'h-full bg-primary transition-[width] duration-300 ease-out',
          busy ? 'w-2/3' : 'w-full',
        )}
      />
    </div>
  )
}
