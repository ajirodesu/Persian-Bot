/**
 * 404 Not Found — Premium redesign
 *
 * Deliberately isolated from all app contexts, providers, and API calls.
 * Renders correctly even if the router, auth context, or API is entirely down.
 */
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
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-on-surface-variant"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
                <line x1="11" y1="8" x2="11" y2="11" />
                <line x1="11" y1="14" x2="11.01" y2="14" />
              </svg>
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
          <a
            href="/"
            className="inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-label-lg font-semibold bg-primary text-on-primary hover:opacity-90 transition-opacity duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface tracking-tight"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
            Back to home
          </a>
          <button
            type="button"
            onClick={() => window.history.back()}
            className="inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-label-lg font-semibold border border-outline-variant bg-surface-container-low text-on-surface hover:border-outline transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface tracking-tight"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m12 19-7-7 7-7" />
              <path d="M19 12H5" />
            </svg>
            Go back
          </button>
        </div>

        {/* Error code footnote */}
        <p className="text-label-xs text-on-surface-variant/40 font-mono tracking-widest">
          ERROR 404 · NOT FOUND
        </p>
      </div>
    </div>
  )
}
