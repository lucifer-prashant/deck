import React from 'react'

interface State { error: Error | null }

export default class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  reset = () => this.setState({ error: null })

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{
        position: 'fixed', inset: 0, padding: '24px',
        background: '#1e1e1e', color: '#f3f3f3', fontFamily: 'JetBrains Mono, monospace',
        fontSize: 13, overflow: 'auto', zIndex: 99999
      }}>
        <h2 style={{ color: '#ff6b6b', marginTop: 0 }}>Render error</h2>
        <pre style={{ whiteSpace: 'pre-wrap' }}>{this.state.error.message}</pre>
        <pre style={{ whiteSpace: 'pre-wrap', opacity: 0.7, fontSize: 11 }}>{this.state.error.stack}</pre>
        <button
          onClick={this.reset}
          style={{ marginTop: 16, padding: '6px 14px', background: '#0078d4', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
        >Reset UI</button>
      </div>
    )
  }
}
