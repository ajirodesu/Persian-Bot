/**
 * 500 Internal Server Error — Premium redesign
 *
 * Fault-tolerant fallback. Safe to render even when the broader
 * application state has crashed. No useContext, no API calls,
 * no React Router dependency.
 */
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
                className="text-error"
                aria-hidden="true"
              >
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
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
          <button
            type="button"
            onClick={() => window.location.reload()}
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
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
              <path d="M8 16H3v5" />
            </svg>
            Refresh page
          </button>
          <a
            href="/"
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
              <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
            Back to home
          </a>
        </div>

        {/* Error code footnote */}
        <p className="text-label-xs text-on-surface-variant/40 font-mono tracking-widest">
          ERROR 500 · INTERNAL SERVER ERROR
        </p>
      </div>
    </div>
  )
}
