import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

/**
 * Last line of defence against a blank screen.
 *
 * Without this, any error thrown during render unmounts the whole tree and
 * the staff member is left staring at a white page with no idea what
 * happened — which is exactly what a discount larger than the line total
 * used to do. A crash should still be visible and recoverable at the
 * counter, not a dead end mid-sale.
 */
interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Technical detail goes to the console for a developer; the screen shows
    // something a shop assistant can act on.
    console.error('[ui] render failed', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="flex min-h-dvh items-center justify-center bg-cream-100 px-4">
        <div className="w-full max-w-md rounded-2xl border border-cream-300 bg-white p-6 text-center shadow-lg shadow-brand-900/[0.06]">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-warning-50">
            <AlertTriangle className="h-6 w-6 text-warning-700" />
          </span>
          <h1 className="mt-4 text-lg font-semibold text-brand-900">Something went wrong</h1>
          <p className="mt-2 text-sm leading-relaxed text-brand-700">
            This screen stopped working. Nothing you had already saved is affected — bills,
            payments and customers are stored the moment they are saved.
          </p>

          <button
            onClick={() => window.location.reload()}
            className="mt-5 inline-flex min-h-touch w-full items-center justify-center gap-2 rounded-lg bg-brand-700 px-4 text-sm font-medium text-white transition-colors hover:bg-brand-800"
          >
            <RotateCcw className="h-4 w-4" />
            Reload the app
          </button>

          <details className="mt-4 text-left">
            <summary className="cursor-pointer text-xs text-brand-600">
              Technical details (for support)
            </summary>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-cream-100 p-2 text-[11px] text-brand-800">
              {this.state.error.message}
            </pre>
          </details>
        </div>
      </div>
    )
  }
}
