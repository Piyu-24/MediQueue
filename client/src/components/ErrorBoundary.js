import React from 'react';

/**
 * React Error Boundary — catches runtime errors in any child component tree.
 * Shows a friendly fallback instead of a white screen.
 *
 * Usage:
 *   <ErrorBoundary>
 *     <SomeComponent />
 *   </ErrorBoundary>
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    // In production you would send this to Sentry / similar
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        style={{
          minHeight: '60vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div
          style={{
            background: 'white',
            borderRadius: '1.5rem',
            boxShadow: '0 20px 60px rgba(0,0,0,0.10)',
            padding: '3rem',
            maxWidth: '480px',
            width: '100%',
            textAlign: 'center',
            border: '1px solid #fee2e2',
          }}
        >
          <div
            style={{
              width: '64px',
              height: '64px',
              background: '#fef2f2',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 1.5rem',
            }}
          >
            <svg width="32" height="32" fill="none" viewBox="0 0 24 24" stroke="#ef4444" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </div>

          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#111827', marginBottom: '0.75rem' }}>
            Something went wrong
          </h2>
          <p style={{ color: '#6b7280', fontSize: '0.9rem', marginBottom: '2rem', lineHeight: 1.6 }}>
            An unexpected error occurred in this section of the app.
            Your session is still active — try refreshing to continue.
          </p>

          {process.env.NODE_ENV === 'development' && this.state.error && (
            <details
              style={{
                textAlign: 'left',
                background: '#fef2f2',
                padding: '1rem',
                borderRadius: '0.75rem',
                marginBottom: '1.5rem',
                fontSize: '0.75rem',
                color: '#991b1b',
                cursor: 'pointer',
              }}
            >
              <summary style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
                Error details (dev only)
              </summary>
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>
                {this.state.error.toString()}
                {this.state.errorInfo?.componentStack}
              </pre>
            </details>
          )}

          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
            <button
              onClick={this.handleReset}
              style={{
                padding: '0.65rem 1.5rem',
                background: 'white',
                border: '2px solid #e5e7eb',
                borderRadius: '0.75rem',
                fontSize: '0.875rem',
                fontWeight: 600,
                cursor: 'pointer',
                color: '#374151',
              }}
            >
              Try Again
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '0.65rem 1.5rem',
                background: '#2563eb',
                border: 'none',
                borderRadius: '0.75rem',
                color: 'white',
                fontSize: '0.875rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Refresh Page
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
