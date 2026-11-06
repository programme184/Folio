import { Component, type ErrorInfo, type ReactNode } from 'react'
import { t } from '../lib/i18n'
import { isChunkLoadError, reloadForStaleBundle } from '../lib/renderer-recovery'

interface State { error: Error | null }

function label(key: 'app.crash.title' | 'app.crash.reload', fallback: string): string {
  try { return t(key) } catch { return fallback }
}

/** Keep a render failure from unmounting the whole window into a blank page. */
export class RootErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('renderer crashed', error, info.componentStack)
    if (isChunkLoadError(error)) reloadForStaleBundle()
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div role="alert" className="root-error">
        <h1>{label('app.crash.title', 'Something went wrong')}</h1>
        <p>{error.message}</p>
        <button type="button" onClick={() => window.location.reload()}>{label('app.crash.reload', 'Reload')}</button>
      </div>
    )
  }
}
