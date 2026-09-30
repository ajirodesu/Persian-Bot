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
import { useEffect, useState } from 'react'
import { useNavigation } from 'react-router-dom'
import { cn } from '@/utils/cn.util'

type Phase = 'hide' | 'run' | 'done'

export default function RouteProgressBar() {
  const navigation = useNavigation()
  const busy = navigation.state !== 'idle'
  const [phase, setPhase] = useState<Phase>('hide')

  useEffect(() => {
    if (busy) {
      setPhase('run')
      return
    }
    if (phase !== 'run') return
    setPhase('done')
    const t = setTimeout(() => setPhase('hide'), 350)
    return () => clearTimeout(t)
  }, [busy, phase])

  if (phase === 'hide') return null

  return (
    <div
      aria-hidden="true"
      className="fixed top-0 left-0 right-0 z-[999] h-0.5 pointer-events-none"
    >
      <div
        className={cn(
          'h-full bg-primary transition-[width,opacity] duration-300 ease-out',
          phase === 'run' ? 'w-2/3' : 'w-full opacity-0',
        )}
      />
    </div>
  )
}
