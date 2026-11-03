import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';

interface EligibilityBadgeProps {
  tier: 'GREEN' | 'YELLOW' | 'RED';
}

export function EligibilityBadge({ tier }: EligibilityBadgeProps) {
  const config = {
    GREEN: {
      bg: 'bg-emerald-100',
      text: 'text-emerald-800',
      border: 'border-emerald-200',
      icon: CheckCircle2,
      label: 'ELIGIBLE',
      glow: 'shadow-[0_0_30px_rgba(16,185,129,0.3)]',
    },
    YELLOW: {
      bg: 'bg-amber-100',
      text: 'text-amber-800',
      border: 'border-amber-200',
      icon: AlertTriangle,
      label: 'CONDITIONAL',
      glow: 'shadow-[0_0_30px_rgba(245,158,11,0.3)]',
    },
    RED: {
      bg: 'bg-rose-100',
      text: 'text-rose-800',
      border: 'border-rose-200',
      icon: XCircle,
      label: 'NOT ELIGIBLE',
      glow: 'shadow-[0_0_30px_rgba(244,63,94,0.3)]',
    },
  };

  const { bg, text, border, icon: Icon, label, glow } = config[tier];

  return (
    <div
      className={`inline-flex items-center gap-2 px-5 py-2 rounded-full border-2 ${bg} ${text} ${border} ${glow} animate-in fade-in zoom-in duration-500`}
    >
      <Icon className="w-6 h-6 animate-pulse" />
      <span className="font-extrabold tracking-widest text-lg">{label}</span>
    </div>
  );
}
