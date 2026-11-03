'use client';

export function AnimatedBackground() {
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(56,189,248,0.07),transparent_70%)]" />

      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] rounded-full bg-[radial-gradient(circle,rgba(139,92,246,0.04),transparent_70%)] animate-glow-pulse" />

      <div className="absolute inset-0 opacity-[0.025]">
        <div
          className="absolute inset-[-60px] animate-grid-move"
          style={{
            backgroundImage: `
              linear-gradient(rgba(56,189,248,0.3) 1px, transparent 1px),
              linear-gradient(90deg, rgba(56,189,248,0.3) 1px, transparent 1px)
            `,
            backgroundSize: '60px 60px',
          }}
        />
      </div>

      <div
        className="absolute inset-[-50%] w-[200%] h-[200%] opacity-[0.012] animate-noise"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`,
          backgroundSize: '128px 128px',
        }}
      />

      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[400px] rounded-full bg-[radial-gradient(circle,rgba(56,189,248,0.03),transparent_60%)] animate-float" />
    </div>
  );
}
