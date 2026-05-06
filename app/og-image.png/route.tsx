import { ImageResponse } from 'next/og';

export const runtime = 'edge';

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#1e3a5f',
          fontFamily: 'system-ui, sans-serif',
          padding: '60px',
        }}
      >
        {/* Icon */}
        <div
          style={{
            width: 100,
            height: 100,
            borderRadius: 24,
            background: '#f59e0b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 32,
          }}
        >
          <svg viewBox="0 0 24 24" width="56" height="56" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="6" width="11" height="16" rx="1.5" />
            <rect x="4" y="9" width="7" height="4" rx="0.75" />
            <path d="M13 8 L18 8 Q21 8 21 11 L21 16 Q21 18 19 18" />
            <circle cx="18.5" cy="18.5" r="1.5" />
          </svg>
        </div>

        {/* Logo text */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 20 }}>
          <span style={{ fontSize: 72, fontWeight: 900, color: 'white', letterSpacing: '-2px' }}>
            GasCap
          </span>
          <span style={{ fontSize: 28, fontWeight: 900, color: '#f59e0b', marginLeft: 4 }}>™</span>
        </div>

        {/* Tagline */}
        <div
          style={{
            fontSize: 32,
            fontWeight: 700,
            color: 'rgba(255,255,255,0.75)',
            textAlign: 'center',
            letterSpacing: '-0.5px',
          }}
        >
          Know Before You Go.
        </div>

        {/* Feature pills */}
        <div style={{ display: 'flex', gap: 16, marginTop: 40 }}>
          {['⛽ Fuel Calculator', '📍 Live Local Prices', '📊 MPG Tracking'].map((f) => (
            <div
              key={f}
              style={{
                background: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: 40,
                padding: '10px 22px',
                fontSize: 20,
                color: 'rgba(255,255,255,0.85)',
                fontWeight: 600,
              }}
            >
              {f}
            </div>
          ))}
        </div>

        {/* URL */}
        <div style={{ marginTop: 48, fontSize: 22, color: '#f59e0b', fontWeight: 700 }}>
          gascap.app
        </div>
      </div>
    ),
    {
      width:  1200,
      height: 630,
    },
  );
}
