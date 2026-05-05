import { Component, type ErrorInfo, type ReactNode } from 'react'
import { colors } from '../design/tokens'

interface Props {
  name: string
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  showDetails: boolean
}

export class PanelErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, showDetails: false }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[${this.props.name}] Panel error:`, error, info.componentStack)
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null, showDetails: false })
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          className="h-full flex items-center justify-center p-6"
          style={{ backgroundColor: colors.bg.surface }}
        >
          <div className="text-center max-w-sm">
            <p style={{ color: colors.text.primary }} className="text-sm font-medium mb-1">
              Something went wrong
            </p>
            <p style={{ color: colors.text.muted }} className="text-xs mb-4">
              The {this.props.name} panel encountered an error.
            </p>
            <button
              onClick={this.handleRetry}
              className="text-xs px-3 py-1.5 rounded-md transition-colors"
              style={{
                backgroundColor: colors.accent.muted,
                color: colors.accent.default,
                border: `0.5px solid ${colors.border.default}`
              }}
            >
              Retry
            </button>
            {this.state.error && (
              <button
                onClick={() => this.setState((s) => ({ showDetails: !s.showDetails }))}
                className="ml-2 text-xs px-3 py-1.5 rounded-md"
                style={{ color: colors.text.muted }}
              >
                {this.state.showDetails ? 'Hide details' : 'Show details'}
              </button>
            )}
            {this.state.showDetails && this.state.error && (
              <pre
                className="mt-3 text-left text-[11px] p-3 rounded overflow-auto max-h-40"
                style={{
                  backgroundColor: colors.bg.base,
                  color: colors.text.secondary,
                  fontFamily: '"JetBrains Mono", monospace'
                }}
              >
                {this.state.error.message}
                {'\n'}
                {this.state.error.stack}
              </pre>
            )}
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
