import { ImageResponse } from 'next/og';

export const alt = 'ADUalign — California ADU Feasibility';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Colors mirror tailwind.config.ts: surface-0/50 background, surface-900/500
// text, brand-600 accent, LogoMark gradient greens.
export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '80px',
        background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
        fontFamily: 'sans-serif',
        position: 'relative',
      }}
    >
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: '100%',
          height: '12px',
          background: '#16a34a',
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
        <svg width="88" height="88" viewBox="0 0 100 100" fill="none">
          <path d="M 16 85 V 42 L 50 12 L 62 20 L 46 32 L 32 45 V 85 Z" fill="#86D684" />
          <path
            d="M 62 20 L 88 38 V 75 C 88 78, 80 88, 55 85 V 72 C 70 73, 74 65, 74 55 V 47 L 46 32 Z"
            fill="#55A65E"
          />
          <path d="M 40 85 V 55 H 60 V 68 H 50 V 85 Z" fill="#8EE08D" />
        </svg>
        <div style={{ fontSize: 72, fontWeight: 800, letterSpacing: '-2px', color: '#0f172a' }}>
          ADUalign
        </div>
      </div>
      <div style={{ marginTop: 40, fontSize: 44, fontWeight: 700, color: '#16a34a' }}>
        California ADU Feasibility
      </div>
      <div style={{ marginTop: 20, fontSize: 28, color: '#64748b', maxWidth: 900 }}>
        Instant lot verdict, cost estimate, and permit guidance for any California address.
      </div>
    </div>,
    size,
  );
}
