/**
 * 404 Not Found
 *
 * Deliberately isolated from all app contexts, providers, and API calls.
 * Renders correctly even if the router, auth context, or API is entirely down.
 * Layout comes from the shared ErrorShell — provider-free primitives only.
 */
import ErrorShell from './ErrorShell'
import { House, ArrowLeft, SearchX } from 'lucide-react'

export default function NotFound() {
  return (
    <ErrorShell
      code="404"
      title="Page not found"
      message="The page you're looking for doesn't exist or may have been moved. Check the URL or head back home."
      icon={
        <SearchX
          className="text-on-surface-variant"
          width={28}
          height={28}
          strokeWidth={1.5}
          aria-hidden="true"
        />
      }
      tint="neutral"
      actions={[
        {
          label: 'Back to home',
          icon: <House className="h-4 w-4" />,
          href: '/',
        },
        {
          label: 'Go back',
          icon: <ArrowLeft className="h-4 w-4" />,
          onClick: () => window.history.back(),
          primary: false,
        },
      ]}
    />
  )
}
