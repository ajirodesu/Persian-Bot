/**
 * Author: AjiroDesu
 *
 * Widget-level error boundary.
 *
 * A route boundary already exists; this is the smaller net for one panel.
 * A single failed widget renders an inline, retryable fallback while the rest
 * of the page keeps working — never a full-page crash.
 */
import React from 'react'
import { RefreshCw, TriangleAlert } from 'lucide-react'

interface WidgetErrorBoundaryProps {
  children: React.ReactNode
  /** Human name of the panel, e.g. "Live console". Used in the fallback. */
  label: string
  className?: string
  /** Changing this clears a caught error (e.g. on route change). */
  resetKey?: string | number
}

interface WidgetErrorBoundaryState {
  error: Error | null
  resetKey: number
}

export default class WidgetErrorBoundary extends React.Component<
  WidgetErrorBoundaryProps,
  WidgetErrorBoundaryState
> {
  state: WidgetErrorBoundaryState = { error: null, resetKey: 0 }

  static getDerivedStateFromError(error: Error): Partial<WidgetErrorBoundaryState> {
    return { error }
  }

  componentDidUpdate(previous: WidgetErrorBoundaryProps): void {
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null, resetKey: this.state.resetKey + 1 })
    }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // One line, no PII, no rethrown error — the route boundary handles fatal
    // cases; this path exists to keep the rest of the dashboard usable.
    console.warn(`[widget:${this.props.label}] render failed`, error, info.componentStack)
  }

  private retry = (): void => {
    this.setState((previous) => ({
      error: null,
      resetKey: previous.resetKey + 1,
    }))
  }

  render(): React.ReactNode {
    const { error } = this.state
    if (!error) {
      return <React.Fragment key={this.state.resetKey}>{this.props.children}</React.Fragment>
    }

    return (
      <div
        role="alert"
        className={
          this.props.className ??
          'border border-hairline bg-surface-container-low px-4 py-5'
        }
      >
        <div className="flex items-start gap-3">
          <TriangleAlert
            aria-hidden="true"
            className="mt-0.5 h-4 w-4 shrink-0 text-warning"
          />
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-warning">
              {this.props.label} failed to render
            </p>
            <p className="mt-1 text-body-sm text-on-surface-variant">
              The rest of the page is unaffected. Retry this panel; if it keeps
              failing, reload the page.
            </p>
          </div>
          <button
            type="button"
            onClick={this.retry}
            className="inline-flex min-h-8 shrink-0 items-center gap-1.5 border border-hairline px-2.5 font-mono text-[10px] uppercase tracking-[0.12em] text-on-surface hover:border-primary hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <RefreshCw aria-hidden="true" className="h-3 w-3" />
            Retry
          </button>
        </div>
      </div>
    )
  }
}
