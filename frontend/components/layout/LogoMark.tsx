import { useId } from 'react';

// Shared ADUalign brand mark. useId namespaces the gradient IDs so multiple
// instances on one page (e.g. Header + Footer) don't collide.
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  const id = useId();
  const left = `${id}-left`;
  const right = `${id}-right`;
  const center = `${id}-center`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <defs>
        <linearGradient id={left} x1="0%" y1="100%" x2="50%" y2="0%">
          <stop offset="0%" stopColor="#86D684" />
          <stop offset="100%" stopColor="#55A65E" />
        </linearGradient>
        <linearGradient id={right} x1="50%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#71C170" />
          <stop offset="100%" stopColor="#437755" />
        </linearGradient>
        <linearGradient id={center} x1="20%" y1="100%" x2="80%" y2="0%">
          <stop offset="0%" stopColor="#6BC46D" />
          <stop offset="100%" stopColor="#8EE08D" />
        </linearGradient>
      </defs>

      {/* Left side ribbon */}
      <path d="M 16 85 V 42 L 50 12 L 62 20 L 46 32 L 32 45 V 85 Z" fill={`url(#${left})`} />

      {/* Right side ribbon with sweeping bottom curve */}
      <path
        d="M 62 20 L 88 38 V 75 C 88 78, 80 88, 55 85 V 72 C 70 73, 74 65, 74 55 V 47 L 46 32 Z"
        fill={`url(#${right})`}
      />

      {/* Center ADU geometric 'L' shape block */}
      <path d="M 40 85 V 55 H 60 V 68 H 50 V 85 Z" fill={`url(#${center})`} />
    </svg>
  );
}
