import { StrictMode, Component } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// ── Global Error Boundary ────────────────────────────────────────────────────
// Catches any unhandled render errors and shows a recovery UI instead of
// a blank white screen. Users can click "Ανανέωση" to recover.
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('❌ App crashed:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          padding: 24,
          background: 'var(--bg-app, #eef1f7)',
          fontFamily: 'Inter, -apple-system, sans-serif',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 48 }}>😕</div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary, #0a0f1e)', margin: 0 }}>
            Κάτι πήγε στραβά
          </h2>
          <p style={{ fontSize: 14, color: 'var(--text-secondary, #64748b)', maxWidth: 280, margin: 0 }}>
            Η εφαρμογή αντιμετώπισε ένα απρόβλεπτο σφάλμα. Τα δεδομένα σου είναι ασφαλή.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 8,
              padding: '12px 28px',
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              color: '#fff',
              border: 'none',
              borderRadius: 14,
              fontWeight: 700,
              fontSize: 15,
              cursor: 'pointer',
              boxShadow: '0 4px 16px rgba(99,102,241,0.35)',
            }}
          >
            🔄 Ανανέωση
          </button>
          {import.meta.env.DEV && this.state.error && (
            <pre style={{
              marginTop: 16,
              padding: '12px 16px',
              background: 'rgba(239,68,68,0.08)',
              border: '1px solid rgba(239,68,68,0.2)',
              borderRadius: 10,
              fontSize: 11,
              color: '#ef4444',
              textAlign: 'left',
              maxWidth: 400,
              overflow: 'auto',
              maxHeight: 160,
            }}>
              {this.state.error.toString()}
            </pre>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Auto-update: reload when a new service worker takes over ─────────────────
// hadController = true means a SW was already running (this is an UPDATE, not first install).
// We only reload for updates — first-time installs should not trigger a reload.
if ('serviceWorker' in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  const doReload = () => { if (hadController && !reloading) { reloading = true; window.location.reload(); } };

  // SW posts SW_UPDATED after activate + claim
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'SW_UPDATED') doReload();
  });

  // Belt-and-suspenders: fires whenever the active controller changes
  navigator.serviceWorker.addEventListener('controllerchange', doReload);
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
