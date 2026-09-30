/**
 * 500 Internal Server Error
 *
 * Fault-tolerant fallback. Safe to render even when the broader
 * application state has crashed. No useContext, no API calls,
 * no React Router dependency. Layout comes from the shared
 * ErrorShell — provider-free primitives only.
 */
import ErrorShell from './ErrorShell'
import { House, RefreshCw, TriangleAlert } from 'lucide-react'

export default function InternalServerError() {
  return (
    <ErrorShell
      code="500"
      title="Something went wrong"
      message="An unexpected error occurred on our end. The team has been notified. Try refreshing, or come back in a moment."
      icon={
        <TriangleAlert
          className="text-error"
          width={28}
          height={28}
          strokeWidth={1.5}
          aria-hidden="true"
        />
      }
      tint="error"
      actions={[
        {
          label: 'Refresh page',
          icon: <RefreshCw className="h-4 w-4" />,
          onClick: () => window.location.reload(),
        },
        {
          label: 'Back to home',
          icon: <House className="h-4 w-4" />,
          href: '/',
          primary: false,
        },
      ]}
    />
  )
}
