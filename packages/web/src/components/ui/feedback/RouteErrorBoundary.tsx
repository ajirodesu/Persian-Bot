/**
 * Author: AjiroDesu
 *
 * Route-level error boundary offering a full page reload.
 *
 * A crash in one lazy page (bad chunk, render exception) renders a
 * compact error card built from the existing Alert primitive — sized to
 * the dashboard content column so the sidebar/header shell stays on
 * screen — instead of blanking the page or tripping the global 500 page.
 *
 * Why reload instead of an in-place retry:
 * - `React.lazy` caches the first import promise; once a chunk import
 *   rejects (stale deploy / precache miss / offline), that lazy
 *   component re-throws forever and no in-page action can recover it —
 *   only a full page reload can.
 * - A render crash usually replays because the crashed subtree keeps
 *   its pre-crash state, so remounting it is not a reliable fix.
 *
 * Navigating away and back still resets the card via the
 * location-keyed reset.
 */
import { Component, Fragment, type ReactNode } from 'react'
import Alert from '@/components/ui/feedback/Alert'

interface RouteErrorBoundaryProps {
  children: ReactNode
  /** Remounts (clears) the boundary whenever this changes — pass the pathname. */
  resetKey: string
}

interface RouteErrorBoundaryState {
  hasError: boolean
  /**
   * Key of the children wrapper. Bumped on every reset so the crashed
   * subtree remounts with fresh state instead of replaying the crash.
   */
  remountKey: number
}

export default class RouteErrorBoundary extends Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  state: RouteErrorBoundaryState = {
    hasError: false,
    remountKey: 0,
  }

  static getDerivedStateFromError(): Partial<RouteErrorBoundaryState> {
    return { hasError: true }
  }

  componentDidUpdate(prevProps: RouteErrorBoundaryProps): void {
    // Reset from the location-keyed prop: navigating away and back starts
    // a clean slate with a fresh subtree, not a replay of the old crash.
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState((prev) => ({
        hasError: false,
        remountKey: prev.remountKey + 1,
      }))
    }
  }

  private handleReload = (): void => {
    // Full page reload — the only real recovery for a permanently
    // rejected `React.lazy` import (stale chunk / precache miss), and
    // for a render crash the remount alone cannot guarantee recovery.
    window.location.reload()
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="p-4 md:p-6 max-w-7xl w-full mx-auto">
          <Alert
            variant="outlined"
            color="error"
            title="This section failed to load"
            message="Something went wrong rendering this page. Your data is safe — reload the page to try again."
            actions={[
              {
                label: 'Reload page',
                onClick: this.handleReload,
                variant: 'primary',
              },
            ]}
          />
        </div>
      )
    }

    // Keyed wrapper: bumping `remountKey` on reset gives the recovered
    // subtree fresh state instead of rendering back into the crash.
    return (
      <Fragment key={this.state.remountKey}>{this.props.children}</Fragment>
    )
  }
}
