/**
 * Author: AjiroDesu
 *
 * Route-level error boundary with retry.
 *
 * A crash in one lazy page (bad chunk, render exception) renders a
 * compact retry card built from the existing Alert primitive — sized to
 * the dashboard content column so the sidebar/header shell stays on
 * screen — instead of blanking the page or tripping the global 500 page.
 * Retry resets boundary state; navigating away and back also resets via
 * the location-keyed reset.
 */
import { Component, type ReactNode } from 'react'
import Alert from '@/components/ui/feedback/Alert'

interface RouteErrorBoundaryProps {
  children: ReactNode
  /** Remounts (clears) the boundary whenever this changes — pass the pathname. */
  resetKey: string
}

interface RouteErrorBoundaryState {
  hasError: boolean
}

export default class RouteErrorBoundary extends Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  state: RouteErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): RouteErrorBoundaryState {
    return { hasError: true }
  }

  componentDidUpdate(prevProps: RouteErrorBoundaryProps): void {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false })
    }
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false })
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="p-4 md:p-6 max-w-7xl w-full mx-auto">
          <Alert
            variant="outlined"
            color="error"
            title="This section failed to load"
            message="Something went wrong rendering this page. Your data is safe — try again."
            actions={[
              { label: 'Retry', onClick: this.handleRetry, variant: 'primary' },
            ]}
          />
        </div>
      )
    }
    return this.props.children
  }
}
