import { Component, type ErrorInfo, type ReactNode } from 'react'

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
        <div className="te-panel-error">
          <div className="te-panel-error__body">
            <p className="te-panel-error__title">Something went wrong</p>
            <p className="te-panel-error__desc">
              The {this.props.name} panel encountered an error.
            </p>
            <button onClick={this.handleRetry} className="te-panel-error__retry">
              Retry
            </button>
            {this.state.error && (
              <button
                onClick={() => this.setState((s) => ({ showDetails: !s.showDetails }))}
                className="te-panel-error__details-toggle"
              >
                {this.state.showDetails ? 'Hide details' : 'Show details'}
              </button>
            )}
            {this.state.showDetails && this.state.error && (
              <pre className="te-panel-error__stack">
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
