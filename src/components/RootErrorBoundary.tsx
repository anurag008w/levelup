import { Component, type ReactNode } from 'react';

/**
 * Root safety net: any render crash anywhere in the tree lands here instead of
 * a permanent white screen. Offers a retry (state may recover on its own) and
 * a full data reset (recovers from corrupt stored state, e.g. a malformed
 * backup import) that preserves the login session so the user stays signed in.
 */
class RootErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean; message: string }> {
  state = { failed: false, message: '' };

  static getDerivedStateFromError(err: unknown): { failed: boolean; message: string } {
    return {
      failed: true,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  componentDidCatch(err: unknown, info: unknown): void {
    console.error('App crashed:', err, info);
  }

  private retry = (): void => {
    this.setState({ failed: false, message: '' });
  };

  private resetData = (): void => {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key === null) continue;
      if (key === 'levelup.auth.session') continue;
      if (key.startsWith('@levelup:') || key.startsWith('levelup:')) {
        localStorage.removeItem(key);
      }
    }
    location.reload();
  };

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          padding: 24,
          fontFamily: 'system-ui, sans-serif',
          background: '#121212',
          color: '#f2f2f2',
          textAlign: 'center',
        }}
      >
        <h1 style={{ fontSize: 22, margin: 0 }}>Kuch gadbad ho gayi</h1>
        <p style={{ margin: 0, opacity: 0.8 }}>
          App crash ho gayi. Neeche se wapas try karo, ya data reset kar ke relaunch karo.
        </p>
        {this.state.message ? (
          <pre
            style={{
              maxWidth: '90vw',
              overflow: 'auto',
              fontSize: 12,
              opacity: 0.6,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              margin: 0,
            }}
          >
            {this.state.message}
          </pre>
        ) : null}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button
            type="button"
            onClick={this.retry}
            style={{
              padding: '10px 18px',
              borderRadius: 8,
              border: 'none',
              background: '#4c8dff',
              color: '#fff',
              fontSize: 15,
              cursor: 'pointer',
            }}
          >
            Wapas try karo
          </button>
          <button
            type="button"
            onClick={this.resetData}
            style={{
              padding: '10px 18px',
              borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.3)',
              background: 'transparent',
              color: '#fff',
              fontSize: 15,
              cursor: 'pointer',
            }}
          >
            Data reset karke relaunch
          </button>
        </div>
      </div>
    );
  }
}

export default RootErrorBoundary;
