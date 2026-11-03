import { PermitStatus } from '@/lib/types/listing';
import { ShieldCheck, Clock, ShieldAlert } from 'lucide-react';

interface Props {
  status: PermitStatus;
  className?: string;
  showIcon?: boolean;
}

export function PermitBadge({ status, className = '', showIcon = true }: Props) {
  const config: Record<PermitStatus, { label: string; classes: string; Icon: any }> = {
    verified: {
      label: 'Verified Permit',
      classes: 'bg-surface-0/90 text-surface-900 border-surface-200 backdrop-blur-md',
      Icon: ShieldCheck,
    },
    pending: {
      label: 'Permit Pending',
      classes: 'bg-surface-0/90 text-amber-700 border-amber-200 backdrop-blur-md',
      Icon: Clock,
    },
    unverified: {
      label: 'Unverified',
      classes: 'bg-surface-0/90 text-surface-500 border-surface-200 backdrop-blur-md',
      Icon: ShieldAlert,
    },
  };

  const { label, classes, Icon } = config[status];

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold tracking-wide border shadow-[0_2px_8px_rgba(0,0,0,0.08)] ${classes} ${className}`}
    >
      <Icon className="w-3 h-3" />
      {label}
    </span>
  );
}
