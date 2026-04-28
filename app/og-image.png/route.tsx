import { ImageResponse } from 'next/og';

export const runtime = 'edge';

export async function GET(request: Request) {
  // Derive origin so image refs work in both dev and prod
  const { origin } = new URL(request.url);

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
          background: '#1E2D4A',
          fontFamily: 'system-ui, sans-serif',
          padding: '36px 60px',
          gap: 0,
        }}
      >
        {/* ── Icon (gas pump + gauge, transparent bg) ──────────── */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`${origin}/gascap-icon-raw.png`}
          width={148}
          height={148}
          style={{ display: 'block', marginBottom: 10 }}
        />

        {/* ── Wordmark ──────────────────────────────────────────── */}
        {/* Gas=teal, Cap=white, ™=orange — legible on navy */}
        <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 6 }}>
          <span
            style={{
              fontSize: 82,
              fontWeight: 900,
              color: '#1EB68F',
              letterSpacing: '-2px',
              lineHeight: 1,
            }}
          >
            Gas
          </span>
          <span
            style={{
              fontSize: 82,
              fontWeight: 900,
              color: 'white',
              letterSpacing: '-2px',
              lineHeight: 1,
            }}
          >
            Cap
          </span>
          <span
            style={{
              fontSize: 32,
              fontWeight: 900,
              color: '#FA7109',
              marginLeft: 5,
              lineHeight: 1,
            }}
          >
            ™
          </span>
        </div>

        {/* ── Tagline ───────────────────────────────────────────── */}
        <div
          style={{
            fontSize: 26,
            fontWeight: 600,
            color: 'rgba(255,255,255,0.60)',
            letterSpacing: '0.3px',
            marginBottom: 26,
          }}
        >
          Know Before You Go.
        </div>

        {/* ── Promotional banner ────────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            background: '#FA7109',
            borderRadius: 50,
            paddingTop: 15,
            paddingBottom: 15,
            paddingLeft: 42,
            paddingRight: 42,
            marginBottom: 24,
          }}
        >
          <span
            style={{
              fontSize: 27,
              fontWeight: 900,
              color: 'white',
              letterSpacing: '-0.2px',
            }}
          >
            ✨  Try GasCap Pro FREE for 30 days
          </span>
        </div>

        {/* ── Feature pills ─────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
          <div
            style={{
              background: 'rgba(255,255,255,0.10)',
              border: '1px solid rgba(255,255,255,0.18)',
              borderRadius: 40,
              padding: '9px 20px',
              fontSize: 18,
              color: 'rgba(255,255,255,0.82)',
              fontWeight: 600,
            }}
          >
            ⛽ Fuel Calculator
          </div>
          <div
            style={{
              background: 'rgba(255,255,255,0.10)',
              border: '1px solid rgba(255,255,255,0.18)',
              borderRadius: 40,
              padding: '9px 20px',
              fontSize: 18,
              color: 'rgba(255,255,255,0.82)',
              fontWeight: 600,
            }}
          >
            📍 Live Local Prices
          </div>
          <div
            style={{
              background: 'rgba(255,255,255,0.10)',
              border: '1px solid rgba(255,255,255,0.18)',
              borderRadius: 40,
              padding: '9px 20px',
              fontSize: 18,
              color: 'rgba(255,255,255,0.82)',
              fontWeight: 600,
            }}
          >
            📊 MPG Tracking
          </div>
        </div>

        {/* ── URL ──────────────────────────────────────────────── */}
        <div style={{ fontSize: 20, color: '#1EB68F', fontWeight: 700 }}>
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
