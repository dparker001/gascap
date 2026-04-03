'use client';

/**
 * Next.js global error boundary — catches errors in the root layout itself.
 * Must include <html> and <body> since it replaces the entire root layout.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#eef1f7', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1rem',
        }}>
          <div style={{
            background: '#fff',
            borderRadius: '1rem',
            boxShadow: '0 2px 16px rgba(0,0,0,0.08)',
            padding: '2rem',
            maxWidth: '360px',
            width: '100%',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>⛽</div>
            <h1 style={{ fontSize: '1.2rem', fontWeight: 900, color: '#1e293b', margin: '0 0 0.5rem' }}>
              GasCap™ ran into a problem
            </h1>
            <p style={{ fontSize: '0.875rem', color: '#64748b', margin: '0 0 1.5rem' }}>
              Something went wrong at the app level. Your data is safe.
            </p>
            <button
              onClick={reset}
              style={{
                width: '100%',
                padding: '0.75rem',
                background: '#f59e0b',
                color: '#1e293b',
                fontWeight: 900,
                fontSize: '0.875rem',
                border: 'none',
                borderRadius: '0.75rem',
                cursor: 'pointer',
                marginBottom: '0.75rem',
              }}
            >
              Try Again
            </button>
            <a
              href="/"
              style={{
                display: 'block',
                padding: '0.75rem',
                background: '#f1f5f9',
                color: '#475569',
                fontWeight: 700,
                fontSize: '0.875rem',
                borderRadius: '0.75rem',
                textDecoration: 'none',
              }}
            >
              Back to Home
            </a>
            {error.digest && (
              <p style={{ marginTop: '1rem', fontSize: '0.65rem', color: '#cbd5e1', fontFamily: 'monospace' }}>
                ref: {error.digest}
              </p>
            )}
          </div>
        </div>
      </body>
    </html>
  );
}
