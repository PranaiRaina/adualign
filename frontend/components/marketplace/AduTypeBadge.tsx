import { AduType } from '@/lib/types/listing';

interface Props {
  type: AduType;
  className?: string;
}

export function AduTypeBadge({ type, className = '' }: Props) {
  const config: Record<AduType, { label: string; classes: string }> = {
    detached: {
      label: 'Detached',
      classes: 'bg-indigo-100 text-indigo-800 border-indigo-200',
    },
    attached: {
      label: 'Attached',
      classes: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    },
    garage_conversion: {
      label: 'Garage',
      classes: 'bg-amber-100 text-amber-800 border-amber-200',
    },
    basement: {
      label: 'Basement',
      classes: 'bg-purple-100 text-purple-800 border-purple-200',
    },
    above_garage: {
      label: 'Above Garage',
      classes: 'bg-sky-100 text-sky-800 border-sky-200',
    },
    junior_adu: {
      label: 'Junior ADU',
      classes: 'bg-rose-100 text-rose-800 border-rose-200',
    },
  };

  const badgeConfig = config[type];
  if (!badgeConfig) {
    return (
      <span
        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border shadow-sm bg-slate-100 text-slate-700 border-slate-200 ${className}`}
      >
        ADU
      </span>
    );
  }

  const { label, classes } = badgeConfig;

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border shadow-sm ${classes} ${className}`}
    >
      {label}
    </span>
  );
}
