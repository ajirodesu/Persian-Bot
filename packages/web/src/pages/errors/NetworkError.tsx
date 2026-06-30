/**
 * Network / Offline Error — Premium redesign
 *
 * Displayed when the REST API is entirely unreachable or the user's device
 * has lost internet connectivity. Supports both full-page and inline modes.
 */

interface NetworkErrorProps {
  /**
   * When true, renders in a compact card format rather than a full viewport
   * layout. Useful for inlining inside a dashboard widget or data table area.
   * @default false
   */
  inline?: boolean
}

export default function NetworkError({ inline = false }: NetworkErrorProps) {
  if (inline) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-6 text-center gap-6">
        {/* Icon */}
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-outline-variant/80 bg-surface-container-low">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-on-surface-variant"
            aria-hidden="true"
          >
            <line x1="1" y1="1" x2="23" y2="23" />
            <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
            <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
            <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
            <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
            <line x1="12" y1="20" x2="12.01" y2="20" />
          </svg>
        </div>

        <div className="flex flex-col gap-2">
          <h2 className="text-title-lg font-semibold text-on-surface tracking-tight">
            No connection
          </h2>
          <p className="text-body-sm text-on-surface-variant max-w-xs mx-auto leading-relaxed">
            Check your connection and try again.
          </p>
        </div>

        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-label-lg font-semibold bg-primary text-on-primary hover:opacity-90 transition-opacity duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface tracking-tight"
        >
          Try again
        </button>
      </div>
    )
  }

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
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[600px] w-[600px] rounded-full bg-warning/[0.03] blur-[100px]" />

      <div
        className="relative z-10 flex flex-col items-center gap-8 text-center max-w-lg"
        style={{ animation: 'fade-in-up 500ms var(--easing-emphasized-decelerate) both' }}
      >
        {/* Icon block */}
        <div className="flex h-20 w-20 items-center justify-center rounded-3xl border border-outline-variant/80 bg-surface-container-low shadow-elevation-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="36"
            height="36"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-on-surface-variant"
            aria-hidden="true"
          >
            <line x1="1" y1="1" x2="23" y2="23" />
            <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
            <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
            <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
            <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
            <line x1="12" y1="20" x2="12.01" y2="20" />
          </svg>
        </div>

        {/* Copy */}
        <div className="flex flex-col gap-3">
          <h1 className="text-headline-sm font-bold text-on-surface tracking-tight">
            You&apos;re offline
          </h1>
          <p className="text-body-md text-on-surface-variant leading-relaxed max-w-sm mx-auto">
            Check your internet connection and try again. Your data is safe
            and will sync automatically when you&apos;re back online.
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
            Try again
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

        {/* Status footnote */}
        <p className="text-label-xs text-on-surface-variant/40 font-mono tracking-widest">
          NO INTERNET CONNECTION
        </p>
      </div>
    </div>
  )
}
