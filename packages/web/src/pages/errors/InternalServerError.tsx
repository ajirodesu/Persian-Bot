/**
 * 500 Internal Server Error — Premium redesign
 *
 * Fault-tolerant fallback. Safe to render even when the broader
 * application state has crashed. No useContext, no API calls,
 * no React Router dependency. Uses only provider-free shared
 * primitives (Button, lucide icons).
 */
import Button from '@/components/ui/buttons/Button'
import { House, RefreshCw, TriangleAlert } from 'lucide-react'

export default function InternalServerError() {
  return (
    <div
      role="main"
      className="min-h-screen flex flex-col items-center justify-center bg-surface text-on-surface px-6 py-16 relative overflow-hidden"
    >
      {/* Background atmosphere — error-tinted */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(circle, rgb(var(--color-outline-variant) / 0.3) 1px, transparent 1px)',
          backgroundSize: '36px 36px',
        }}
      />
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[600px] w-[600px] rounded-full bg-error/[0.04] blur-[100px]" />

      <div
        className="relative z-10 flex flex-col items-center gap-8 text-center max-w-lg"
        style={{ animation: 'fade-in-up 500ms var(--easing-emphasized-decelerate) both' }}
      >
        {/* Large display numeral */}
        <div className="relative select-none">
          <span
            className="block font-bold tracking-tight text-on-surface/[0.04]"
            style={{ fontSize: 'clamp(120px, 20vw, 200px)', lineHeight: 1 }}
            aria-hidden="true"
          >
            500
          </span>
          {/* Centred icon over the numeral */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-error/30 bg-error-container/40 shadow-elevation-2">
              <TriangleAlert
                className="text-error"
                width={28}
                height={28}
                strokeWidth={1.5}
                aria-hidden="true"
              />
            </div>
          </div>
        </div>

        {/* Copy */}
        <div className="flex flex-col gap-3">
          <h1 className="text-headline-sm font-bold text-on-surface tracking-tight">
            Something went wrong
          </h1>
          <p className="text-body-md text-on-surface-variant leading-relaxed max-w-sm mx-auto">
            An unexpected error occurred on our end. The team has been
            notified. Try refreshing, or come back in a moment.
          </p>
        </div>

        {/* Divider */}
        <div className="w-16 h-px bg-outline-variant/60" />

        {/* Actions */}
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <Button
            variant="filled"
            color="primary"
            size="lg"
            onClick={() => window.location.reload()}
            leftIcon={<RefreshCw className="h-4 w-4" />}
          >
            Refresh page
          </Button>
          <Button
            as="a"
            href="/"
            variant="outline"
            color="neutral"
            size="lg"
            leftIcon={<House className="h-4 w-4" />}
          >
            Back to home
          </Button>
        </div>

        {/* Error code footnote */}
        <p className="text-label-xs text-on-surface-variant/40 font-mono tracking-widest">
          ERROR 500 · INTERNAL SERVER ERROR
        </p>
      </div>
    </div>
  )
}
