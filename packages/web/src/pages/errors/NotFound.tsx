/**
 * 404 Not Found — Premium redesign
 *
 * Deliberately isolated from all app contexts, providers, and API calls.
 * Renders correctly even if the router, auth context, or API is entirely down.
 * Uses only provider-free shared primitives (Button, lucide icons).
 */
import Button from '@/components/ui/buttons/Button'
import { House, ArrowLeft, SearchX } from 'lucide-react'

export default function NotFound() {
  return (
    <div
      role="main"
      className="min-h-screen flex flex-col items-center justify-center bg-surface text-on-surface px-6 py-16 relative overflow-hidden"
    >
      {/* Background atmosphere */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(circle, rgb(var(--color-outline-variant) / 0.3) 1px, transparent 1px)',
          backgroundSize: '36px 36px',
        }}
      />
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[600px] w-[600px] rounded-full bg-primary/[0.04] blur-[100px]" />

      <div
        className="relative z-10 flex flex-col items-center gap-8 text-center max-w-lg"
        style={{ animation: 'fade-in-up 500ms var(--easing-emphasized-decelerate) both' }}
      >
        {/* Large display numeral — the signature element */}
        <div className="relative select-none">
          <span
            className="block font-bold tracking-tight text-on-surface/[0.04]"
            style={{ fontSize: 'clamp(120px, 20vw, 200px)', lineHeight: 1 }}
            aria-hidden="true"
          >
            404
          </span>
          {/* Centred icon over the numeral */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-outline-variant/80 bg-surface-container-low shadow-elevation-2">
              <SearchX
                className="text-on-surface-variant"
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
            Page not found
          </h1>
          <p className="text-body-md text-on-surface-variant leading-relaxed max-w-sm mx-auto">
            The page you&apos;re looking for doesn&apos;t exist or may have
            been moved. Check the URL or head back home.
          </p>
        </div>

        {/* Divider */}
        <div className="w-16 h-px bg-outline-variant/60" />

        {/* Actions */}
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <Button
            as="a"
            href="/"
            variant="filled"
            color="primary"
            size="lg"
            leftIcon={<House className="h-4 w-4" />}
          >
            Back to home
          </Button>
          <Button
            variant="outline"
            color="neutral"
            size="lg"
            onClick={() => window.history.back()}
            leftIcon={<ArrowLeft className="h-4 w-4" />}
          >
            Go back
          </Button>
        </div>

        {/* Error code footnote */}
        <p className="text-label-xs text-on-surface-variant/40 font-mono tracking-widest">
          ERROR 404 · NOT FOUND
        </p>
      </div>
    </div>
  )
}
